# Repository-map performance and correctness

## Scope and environment

Measured directly through the map-generation library on Linux, Node v24.12.0, against `/home/wladimiiir/Projects/hivr.core-platform.hive.app.v2` at `311c0c8228` (27,325 tracked files). The baseline was built from AiderDesk `948929066` before changes.

No AiderDesk task, extension-event dispatch, model call, Python connector, renderer, or extension API was invoked by the benchmarks or tests. The target repository was read-only. Each cold run used an isolated temporary SQLite database; OS filesystem caches and existing WASM downloads were not cleared. This is a cold *tag-cache* benchmark, not a cold-machine benchmark.

Timings are local observations, not cross-platform guarantees: one completed cold run and two successive warm samples per reported implementation. Event-loop delay was sampled at 10 ms resolution. RSS includes the main process and its worker, not just the worker's JavaScript heap.

## Results

### Original implementation

- Cold: **11,667.6 ms**; maximum observed main-thread event-loop delay **758.1 ms**.
- Warm: **504.6 / 484.9 ms**; maximum delays **123.7 / 136.1 ms**.
- Four identical concurrent calls: **1,922.9 ms total**; maximum delay **362.5 ms**.
- Output: only **31 lines / 2,440 bytes**, with **18,557 logged errors** across the run. This output is not a correctness reference.
- A later repeated original-code trial did not complete within the 120-second command limit. Its timing is not included in the completed-run figures above. The original WASM/parser failures make cold behavior unreliable.

### Optimized implementation, fresh tag cache

- Cold: **122,832.5 ms**; maximum main-thread event-loop delay **12.2 ms**, p99 **10.35 ms**; peak process RSS **527.8 MiB**.
- Warm: **222.3 / 241.7 ms**; maximum delays **10.3 / 10.6 ms**.
- Four identical concurrent calls: **263.1 ms total**; maximum delay **12.2 ms**. These calls share one generation job.
- Output: **2,000 lines / 164,036 bytes**, identical across the cold, warm, and concurrent scenarios.

### New process, existing persistent tag cache

- First call, including worker creation and graph/ranking reconstruction: **1,338.0 ms**.
- Subsequent warm calls: **213.5 / 239.6 ms**.
- Four identical concurrent calls: **285.2 ms total**.
- Maximum event-loop delay across these scenarios: **11.1 ms**.
- Peak process RSS: approximately **401 MiB**.

Warm latency is about twice as fast as the broken original, and the four-request concurrent case is about seven times faster, while producing substantially more complete output. These are not equivalent-work cold-speed comparisons: the original omitted most of the project. **A complete initial parse still takes about two minutes.** Worker isolation removes the UI-thread stall, not the initial prompt's wait for a map. A persistent cache is important for this repository.

## Correctness evidence

The final isolated cache contained all **18,018 tracked C# files**, plus other supported files, for **18,324 files** total. Unsupported formats such as Razor are not added by this change.

The real-project audit checked:

- All **1,999 displayed filenames** exist under the requested root and satisfy the configured exclusion patterns.
- No duplicate filenames and no output-budget overflow.
- Exact output equality between cold, warm, and concurrent runs.
- **100 deterministic C# samples** spread across the cached file list: **635 definition tags** and **1,144 compact reference tags** point to source lines containing their captured names.
- **120 independently detected type declarations** in those samples have corresponding definition tags.
- A separate detailed map of eight sampled real files contains **40 rendered source lines**, each verified against its file's actual contents.

At the default 2,000-line budget, this large repository uses the existing filename-only rendering mode: 1,999 ranked filenames plus an ellipsis. Detailed symbol rendering is tested separately; the large output should not be mistaken for 2,000 symbol snippets.

The corpus has **5,382,720 reference occurrences**, stored as **402,731 tags** after per-file reference compaction. Expanding its symbol relations would create **2,714,505 symbol-specific edges**. The new implementation does not materialize those edges.

The 12 package tests additionally cover:

- Correct C# query compilation, modern primary constructors, records, structs, enums, methods, and references.
- Weighted PageRank agreement with the original expanded graph to ten decimal places on ten small fixtures, without personalization and with all nodes connected. Isolated definitions are intentionally retained by the new implementation.
- A compact graph representing nearly 100 million edges, without allocating an expanded graph.
- Reference-count preservation and actual file/identifier personalization.
- Root-relative rendering, line budgets, absolute chat-file exclusion, edits with restored modification time, additions, and deletions.
- Shared-checkout request coalescing, separate real Git worktrees, persistent-cache round trips, and glob exclusions that do not accidentally hide `Clock.cs` or `Dialog.cs`.
- Cancellation of one shared subscriber, cancellation/restart of abandoned work, and pre-aborted requests.

This is sampled source validation, not a claim of exhaustive language-semantic correctness for every symbol.

## Implementation

- `getRepoMap` delegates to a lazy, long-lived worker. Discovery, metadata checks, parsing, SQLite, dependency analysis, ranking, and rendering run there.
- Identical in-flight requests coalesce. The queue is bounded to 64 jobs. Requests are FIFO; one cold repository can still delay other requests, without blocking the main thread.
- Two checkout-root analyzers are retained with LRU eviction. Worktrees are separate roots. There are at most eight rendered results per analyzer, invalidated when its validated file snapshot changes.
- Every request still discovers files and checks metadata in the worker. There is no watcher or TTL-based stale-map assumption.
- SQLite caches use a new schema, compact tag encoding, prepared statements, and WAL mode. Old potentially poisoned cache entries are not reused. The benchmark cache occupies approximately 27 MiB.
- Compiled queries and language loads are reused, syntax trees are deleted, parsing is serialized per parser, and cached symbol strings are explicitly detached from source text. The string detachment reduced an intermediate implementation's process RSS from roughly 1.8 GiB to roughly 0.5 GiB.
- C# grammar 0.23.5 has a versioned download/cache filename, preventing an older unversioned grammar from silently missing primary constructors.
- The implicit weighted dependency representation preserves reference multiplicities and excludes self-edges. Uniform PageRank matches expanded graph behavior on the regression fixtures; personalization is now implemented explicitly instead of passing an unsupported option to graphology.
- Aborting one subscriber leaves shared work running. Abandoning active work terminates the worker; queued work can start in a replacement worker and persistent tags remain reusable. Idle workers expire after five minutes.
- Worker JavaScript old-generation heap is limited to 512 MiB; this is not a total-process RSS limit. Worker failures reject callers rather than falling back to main-thread computation.

The extension's thin caller now supplies the task checkout root and abort signal. No end-to-end extension API or packaged Electron interaction was benchmarked. The worker and query resources were confirmed present in `npm pack --dry-run`; packaged Electron runtime verification remains a separate check. The updated library must be shipped/resolved by the extension before installed users receive these changes.

## Reproduce

From the repository root:

```sh
npm run build:tree-sitter-utils
npm run test --workspace=packages/tree-sitter-utils -- --no-color
npm run typecheck --workspace=packages/tree-sitter-utils

node packages/tree-sitter-utils/scripts/benchmark.mjs \
  /path/to/repository \
  packages/tree-sitter-utils/dist/index.js \
  benchmarks/repo-map/current worker

node packages/tree-sitter-utils/scripts/audit-benchmark.mjs \
  packages/tree-sitter-utils/dist/index.js \
  benchmarks/repo-map/current
```

The benchmark's `results.json` includes its temporary `cacheDir`. Supply that directory as the final argument to another benchmark process to measure persistent-cache startup instead of a fresh tag cache. The script labels its first scenario `cold` in either case; distinguish these runs by whether a pre-existing cache was supplied.

`audit-benchmark.mjs` is intentionally specific to this large C# repository and the benchmark's default settings. The unit tests use isolated temporary fixtures and do not depend on the external project.

Raw local artifacts are under ignored `benchmarks/repo-map/`: `baseline-results`, `verified-worker-results`, `restarted-worker-results`, logs, generated maps, and the final `audit.json`.

## Remaining work

- Initial full parsing remains expensive, particularly with generated migration snapshots. Deliberately excluding generated/vendor files can reduce work, but must be an explicit configuration decision rather than silently dropping files.
- File discovery and metadata validation still scale with file count; watcher-assisted invalidation could reduce this with reconciliation and overflow handling.
- Validate Windows/Electron installed-extension execution and publication of the updated package.
- Multiple distinct cold requests are queued, not computed in an unbounded worker pool. Background prewarming or a prompt-start deadline would require an explicit freshness/fallback policy.
