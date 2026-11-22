# A2UI Extension

Let the agent render interactive UI cards — forms, confirmations, option pickers, and structured summaries — directly in AiderDesk task chat using the [A2UI protocol](https://a2ui.org), instead of relying only on plain-text back-and-forth.

![Result card with data bindings and actions](https://raw.githubusercontent.com/magiksoft/aider-desk/main/packages/extensions/extensions/a2ui/screenshots/files-card.png)

![Interactive form card](https://raw.githubusercontent.com/magiksoft/aider-desk/main/packages/extensions/extensions/a2ui/screenshots/deploy-form.png)

## What it's good for

- **Collecting structured input**: deployment parameters, config options, migration settings, or multi-field forms instead of answering a wall of text questions.
- **Confirmation & review steps**: summarizing planned changes or options with clear action buttons (approve, adjust, cancel).
- **Actionable results**: presenting structured summaries, checklists, or small dashboards with per-item buttons that trigger follow-up agent actions.
- **Not meant for**: code blocks, diffs, long prose explanations (plain markdown is better), or live-updating dashboards.

## Features

- **`show_ui_message` tool**: gives the agent a safe, schema-validated way to compose cards from the A2UI v1.0 basic component catalog — text/markdown, buttons, cards, rows/columns, lists, tabs, modals, text fields, checkboxes, chip/checkbox choice pickers, sliders, date/time pickers, and media.
- **Interactive round-trip**: clicking a button on a card captures the current values of any inputs on that card and sends the action back to the agent as a follow-up message.
- **Theme-native & persistent**: cards automatically adapt to your active AiderDesk theme and remain rendered in chat history across restarts.
- **Built-in `a2ui` skill**: ships a reference skill teaching the agent the full component catalog, data bindings, and layout best practices (fetched from the official A2UI repo with a bundled offline fallback).
- **`/a2ui-demo` command**: quickly test the extension by having the agent render a sample interactive coffee-order card.

## Installation

Install from **Settings → Extensions** in AiderDesk, or via CLI:

```bash
npx @aiderdesk/extensions install a2ui
```

## Usage

1. Install and enable the extension, and make sure the `show_ui_message` tool is enabled in your agent profile (enabled by default when extension tools are allowed).
2. Run `/a2ui-demo` in any task to verify rendering and test the interactive button loop.
3. In normal tasks, the agent can call `show_ui_message` whenever a card fits better than prose — or you can ask explicitly (for example, *"Give me a form to configure the release options"*).
4. Fill in fields and click a button on the card to send your choices back to the agent.

## Limitations & Notes

- **Static cards**: each `show_ui_message` call renders one static card. Cards do not update in place; clicking a button starts a follow-up agent turn, and the agent can emit a new card to show updated state.
- **Network requirement**: the card renderer loads `@a2ui/web_core` and `@a2ui/markdown-it` bundles from `esm.sh` at runtime, so rendering requires access to `esm.sh` (at least until cached).
- **Model support**: complex cards work best with stronger tool-calling models. Payloads are validated before rendering so the agent gets clear feedback if a card schema needs fixing.

## Technical Details

- **Validation & normalization**: `show_ui_message` validates incoming A2UI v1.0 payloads in the main process via `@a2ui/agent`'s `validatePayload` against `basicCatalog`, injecting the default `catalogId` and normalizing inline `dataModel` blocks.
- **Renderer**: a `task-message` UI component loads `@a2ui/web_core` and `@a2ui/markdown-it` via `getUIComponentsLibraries` (pinned esm.sh prebuilt bundles using a trailing `#` to avoid build-query resolution errors for non-React packages). It registers the basic catalog web components directly from `@a2ui/web_core` (avoiding `@a2ui/lit` so reactive signals share a single `web_core` instance), runs a `MessageProcessor` per card, and mounts the resolved root node (`NodeResolver` + `element.node = rootNode`).
- **Actions**: card events flow through `executeUIExtensionAction` with the surface's current data model snapshot and are queued via `TaskContext.runPrompt`.
- **API usage**: `getTools`, `getSkills`, `getUIComponents`, `getUIComponentsLibraries`, `executeUIExtensionAction`, `getCommands`, `TaskContext.runPrompt`
- **Dependencies**: `@a2ui/agent` (main-process validation), `@a2ui/web_core` (`basicCatalog` + runtime renderer via esm.sh), `@a2ui/markdown-it` (runtime markdown rendering via esm.sh)

## References

- [A2UI overview](https://a2ui.org/concepts/overview/)
- [A2UI messages](https://a2ui.org/concepts/messages/)
- [Basic catalog v1.0](https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json)
