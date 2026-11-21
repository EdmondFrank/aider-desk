# ADR-0044: Message Preparation Pipeline — Mandatory Transformations and Request-Time Optimization

## Status

Accepted (2026-11-21)

## Context

Every agent model call needs its prompt shaped before it reaches the provider: non-model `log` messages must be stripped, runtime reminders injected, tool results cleaned of internal UI fields, subagent payloads collapsed to their final answer, consecutive user messages merged, duplicate sequential tool-call loops interrupted, image tool results converted into user messages for cross-provider compatibility, cache breakpoints annotated, and attachments unsupported by the target model filtered. At the same time, persisted `ContextMessage` history ([ADR-0010](0010-context-compaction-and-optimization.md)) must remain the authoritative, replayable record — per-request shaping must never mutate or write back to what is stored.

The SDK boundary conversion ([ADR-0005](0005-vercel-ai-sdk-as-agent-runtime.md)) happens in `agent.ts` (`prepareMessages` assembles repo-map/context-file messages and casts `ContextMessage[]` to `ModelMessage[]`); everything after it is per-request, ephemeral shaping. This pipeline replaces the earlier `optimizer.ts` referenced in [ADR-0010](0010-context-compaction-and-optimization.md) and grew into a contractual stage structure once extensions required stable override points ([ADR-0029](../extensions/0029-lifecycle-hook-extension-system.md), "Message-preparation hook semantics amendment").

The concrete home of this pipeline is `prepareMessagesForModel` in `src/main/agent/message-preparation/index.ts`, composed of focused stage modules: `reminders.ts`, `transformations.ts`, `optimizations.ts`, `provider-compatibility.ts`, `cache-control.ts`, `modality-validation.ts`, and `tool-results.ts`.

## Decision Drivers

- **Must** keep persisted `ContextMessage` history authoritative — preparation clones inputs on entry and never mutates or persists to stored history
- **Must** run mandatory, unconditional transformations (internal tool-result cleanup, subagent result collapse, consecutive-user-message merging) on every pipeline invocation
- **Must** give extensions stable override points with defined stage boundaries, gating rules, and snapshot semantics
- **Must** keep cross-provider compatibility and model-capability attachment filtering isolated from core agent flows
- **Should** keep mandatory transformations conceptually distinct from optional optimization and cache annotation

## Considered Options

### Option A — Ad-hoc shaping at each call site

- **Pros**: Simple to start; each caller shapes exactly what it needs.
- **Cons**: Call sites in `agent.ts` (main run loop, `generateFromContext`, `generateText`, `generateObject`, `estimateTokens`) drift apart; extensions cannot hook one consistent point; provider fixes get duplicated.

### Option B — Single ordered pipeline with distinct stage kinds and extension hooks

- **Pros**: One entry point (`prepareMessagesForModel`) shared across `agent.ts` prompt-preparation sites; stages are testable in isolation; extension hooks wrap mutating stages with explicit before/after snapshots.
- **Cons**: Stage order becomes a contract — reordering is a breaking change; new cross-cutting behavior requires deciding which stage kind it belongs to.

## Decision

Outgoing model prompts in `agent.ts` are prepared by the ordered `prepareMessagesForModel` pipeline in `src/main/agent/message-preparation/index.ts`. Prepared messages are ephemeral: inputs are `cloneDeep`'d on entry, never persisted, and never written back to stored history.

### Ordered stages

1. **Entry `log` filter, index remapping, and clone** (`index.ts`): filters out non-model `role: 'log'` messages, remaps `userRequestMessageIndex` into the filtered array (`reminderIndex`), and `cloneDeep`s the result so caller-owned message objects are never mutated.
2. **Important reminders** (`reminders.ts` → `addImportantReminders`) + **`onImportantReminders` hook**: when `task`, `profile`, and a valid `reminderIndex` pointing to a `user` message are present, builds `<Reminder>` blocks (TODO tools, automatic subagents, plan-approval requirement for non-autonomous non-subagent tasks, worktree directory notice, memory retrieve/store guidance), dispatches `onImportantReminders` (when `extensionManager` is provided), and appends `<ThisIsImportant>` to that user message.
3. **Mandatory transformations** (`transformations.ts` → `transformMessages`) + **`onTransformMessages` hook**: unconditional shaping —
   - strips internal UI fields (`responses`, `promptContext`) from `aider` `run_prompt` JSON tool results (tool names via [ADR-0008](0008-tool-group-namespacing-contracts.md) constants);
   - collapses `subagents` `run_task` JSON tool results to the subagent's final text via `tool-results.ts` (`getSubagentFinalText`, supporting both `{ messages }` and legacy array shapes);
   - merges consecutive `user` messages into one (`mergeConsecutiveUserMessages`) so providers rejecting adjacent user roles continue working when injected notes (e.g. `<compacted-edits>` compaction notes) sit beside a user prompt.
   Followed by `onTransformMessages` (with pre/post snapshots; mandatory transformations are not reapplied after hooks).
4. **Optional optimization** (`optimizations.ts` → `optimizeMessages`) + **`onOptimizeMessages` hook**: detects duplicate sequential tool calls (`assistant(call) → tool(result) → assistant(call) → tool(result)` with identical `toolName` and serialized `input`) and replaces the duplicate tool result with an error message to break model loops, exempting results with file/image outputs (`hasFileOutput`) so repeated media/screenshot calls are preserved. Followed by `onOptimizeMessages` (receives transformation output as `originalMessages`).
5. **Provider compatibility** (`provider-compatibility.ts` → `convertImageToolResults`): runs unconditionally for all providers, extracting image/file parts from MCP or native `content`-type tool results into a following synthetic `user` message and replacing the tool result output with text (falling back to `'Image rendered.'`).
6. **Cache annotation** (`cache-control.ts` → `applyCacheControl`) + **`onApplyCacheControl` hook**: annotates the final message (or its last content part when `placement === 'message-part'`) with model-aware cache options ([ADR-0013](../model-integration/0013-provider-adapter-registry.md)). `onApplyCacheControl` always dispatches when `extensionManager && task` are provided, even when `cacheControl` is `undefined` or `messages` is empty.
7. **Post-hook `log` filter** (`index.ts`): strips any `role: 'log'` messages an extension hook may have reintroduced.
8. **Attachment/modality validation** (`modality-validation.ts` → `filterAttachmentsForModel`): runs last (non-overridable by extensions) when `options` is provided and `resolveModalities` returns a defined capability map. Removes unsupported image/audio/video/PDF or binary attachments from `user` messages, appends inline `[Attachment omitted]` text notes, patches a preceding tool result's `'Image rendered.'` placeholder when the stripped attachment came from `convertImageToolResults`, and logs a task warning only when `options.allowWarnings` is true.

### Load-bearing ordering dependencies

- **Reminders before `transformMessages`**: `reminderIndex` is computed pre-merge (paired with `isInitialUserRequest` in `agent.ts`) and `<ThisIsImportant>` is appended before `mergeConsecutiveUserMessages` can collapse adjacent user messages and shift indices.
- **`optimizeMessages` before `convertImageToolResults`**: `hasFileOutput` inspects tool results for media parts before `convertImageToolResults` extracts them into synthetic `user` messages.
- **`convertImageToolResults` before `applyCacheControl`**: `applyCacheControl` annotates the final message; it must land on the synthetic image `user` message when one is appended.
- **`convertImageToolResults` before `filterAttachmentsForModel`**: modality filtering scans `user` messages only and relies on `convertImageToolResults`'s `'Image rendered.'` placeholder to patch the preceding tool result when omitting extracted media.

### Hook gating, call sites, and exceptions

- **Hook gating**: `onTransformMessages`, `onOptimizeMessages`, and `onApplyCacheControl` dispatch only when both `extensionManager` and `task` are supplied; `onImportantReminders` dispatches inside `addImportantReminders` whenever `extensionManager` is supplied and reminders run. Hook contract semantics are owned by the [ADR-0029](../extensions/0029-lifecycle-hook-extension-system.md) amendment.
- **Call sites in `agent.ts`**: main run loop (`allowAttachmentWarnings = true` on the first iteration only), `generateFromContext`, `generateText` and `generateObject` (pass `task = null, profile = null, userRequestMessageIndex = -1`, skipping reminders and hooks), and `estimateTokens` (passes `extensionManager = undefined, allowWarnings = false`, skipping hooks and warnings).
- **Documented exceptions**:
  - Generic tool-call error repair in `agent.ts` invokes `generateOnce` directly on the in-flight messages without calling `prepareMessagesForModel`.
  - Post-usage-report trailing token estimation in `agent.ts` calls `convertImageToolResults` directly rather than running the full pipeline.
- **Shared helpers outside the pipeline**: `tool-results.ts` (`getSubagentMessages`, `getSubagentFinalText`) is also imported by `src/main/task/context-manager.ts`, and `classifyAttachmentMediaType` (`modality-validation.ts`) is imported by `src/main/agent/utils.ts`.

## Rationale

A single ordered pipeline satisfies all drivers simultaneously: mandatory transformations stay mandatory because prompt preparation flows through one entry point; persisted history stays clean because entry `cloneDeep` isolates caller-owned structures; extensions get predictable boundaries because each hook brackets one stage with explicit snapshots; and modality safety stays enforceable because attachment filtering runs last, after all hooks. Separating unconditional transformations from optional optimizations keeps the two concerns legible and mirrors the persisted-compaction vs. request-time split in [ADR-0010](0010-context-compaction-and-optimization.md).

## Consequences

### Positive

- Prompt-building call sites in `agent.ts` share one tested preparation path with explicit opt-out parameters (`task`, `extensionManager`, `options.allowWarnings`)
- Extension hooks have stable, documented boundaries (`onImportantReminders`, `onTransformMessages`, `onOptimizeMessages`, `onApplyCacheControl`)
- Cross-provider image extraction (`provider-compatibility.ts`) and capability-based attachment filtering (`modality-validation.ts`) stay isolated from transformations and call sites
- Stages are independently unit-tested across `src/main/agent/__tests__/message-preparation.test.ts`, `provider-compatibility.test.ts`, and `modality-validation.test.ts`

### Negative

- Stage order is a contract with tight inter-stage dependencies; adding or reordering stages requires updating this ADR and [ADR-0029](../extensions/0029-lifecycle-hook-extension-system.md) together
- New cross-cutting behavior requires a judgment call between this pipeline and SDK middlewares ([ADR-0005](0005-vercel-ai-sdk-as-agent-runtime.md))
- Helper exports (`tool-results.ts`, `classifyAttachmentMediaType`) are shared with non-pipeline modules (`context-manager.ts`, `agent/utils.ts`), coupling their signatures beyond the pipeline

### Risks & Mitigations

- Risk: a stage mutates messages shared with persisted history or hook baselines — Mitigation: `prepareMessagesForModel` `cloneDeep`s on entry and before each hooked stage's `originalMessages` snapshot (note: later unhooked stages such as `filterAttachmentsForModel` mutate the already-cloned pipeline array in place, e.g. `patchImageRenderedPlaceholder`, so callers passing arrays directly to stage helpers must pass copies)
- Risk: extensions reintroduce shapes that mandatory transformations removed (e.g. consecutive user messages) or `role: 'log'` entries — Mitigation: hooks own their output and transformations are deliberately not reapplied; a second `isModelMessage` filter runs after `onApplyCacheControl` to strip reintroduced `log` messages, and `filterAttachmentsForModel` runs after all hooks
- Risk: stage drift — pipeline logic duplicated ad hoc elsewhere — Mitigation: guardrail below forbids ad-hoc prompt shaping outside `prepareMessagesForModel` (except the documented narrow exceptions above)

## Guardrails for Agents

### Do

- Add new unconditional request shaping to `transformMessages` (`message-preparation/transformations.ts`); add optional, heuristic request-time adjustments to `optimizations.ts` — decide "mandatory vs optional" explicitly
- Rely on the entry/snapshot `cloneDeep` boundaries and treat persisted `ContextMessage` history as read-only; if adding a new hooked stage, pass an isolated `originalMessages` snapshot
- Preserve the inter-stage ordering dependencies (reminders before user-message merging, `optimizeMessages` before `convertImageToolResults`, `convertImageToolResults` before `applyCacheControl` and `filterAttachmentsForModel`) and extend `message-preparation.test.ts`, `provider-compatibility.test.ts`, or `modality-validation.test.ts`
- Invoke `prepareMessagesForModel` for model prompts in `agent.ts`; keep `userRequestMessageIndex` aligned with `isInitialUserRequest` and gate user-facing attachment warnings via `options.allowWarnings`
- Put cross-provider message-format conversions in `provider-compatibility.ts` and model-capability attachment filtering in `modality-validation.ts` (keyed by `resolveModalities`)
- Check non-pipeline callers (`context-manager.ts`, `agent/utils.ts`) before changing exports in `tool-results.ts` or `modality-validation.ts`

### Don't

- Never mutate persisted context messages during preparation — request-side stages work on copies only
- Never persist prepared messages or write prepared output back into stored history
- Never reapply mandatory transformations after the `onTransformMessages` hook
- Never move `filterAttachmentsForModel` or the post-hook `log` filter ahead of extension hooks
- Never reorder or insert pipeline stages without updating this ADR and the [ADR-0029](../extensions/0029-lifecycle-hook-extension-system.md) hook-semantics amendment in the same change
- Never shape prompts ad hoc at call sites or in response-layer middlewares (`middlewares/` is for streaming/response behavior per [ADR-0005](0005-vercel-ai-sdk-as-agent-runtime.md))

## Related Decisions

- [ADR-0005: Vercel AI SDK as Agent Runtime](0005-vercel-ai-sdk-as-agent-runtime.md) — SDK boundary and the `middlewares/` vs `message-preparation/` split
- [ADR-0008: Tool Group Namespacing as Stable Contract](0008-tool-group-namespacing-contracts.md) — tool-name constants used to target transformations
- [ADR-0010: Context Compaction and Prompt Optimization](0010-context-compaction-and-optimization.md) — persisted compaction vs this request-time pipeline (replaces `optimizer.ts` referenced there)
- [ADR-0013: Model Provider Adapter Registry](../model-integration/0013-provider-adapter-registry.md) — model-aware cache annotation and modality inputs
- [ADR-0029: Lifecycle-Hook Extension System](../extensions/0029-lifecycle-hook-extension-system.md) — owns the hook semantics amendment for this pipeline
