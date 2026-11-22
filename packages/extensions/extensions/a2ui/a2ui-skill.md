# A2UI Card Authoring Reference

Detailed reference for building UI cards with the `show_ui_message` tool (A2UI v1.0 protocol, basic catalog). The tool description covers the essentials; this skill documents every component, binding pattern, and layout rule.

## Message structure

`messages` is an array of A2UI v1.0 messages. Exactly one `createSurface` (first message) with a flat `components` list; optionally followed by `updateDataModel` messages for initial values. The card renders once, statically — to show changed information later, emit a new card.

```json
{ "version": "1.0", "createSurface": {
  "surfaceId": "unique_id",
  "components": [
    { "id": "root", "component": "Card", "child": "col" },
    { "id": "col", "component": "Column", "children": ["t1", "b1"] },
    { "id": "t1", "component": "Text", "text": "Hello" },
    { "id": "b1", "component": "Button", "child": "bt", "action": { "event": { "name": "go" } } },
    { "id": "bt", "component": "Text", "text": "Go" }
  ]
} }
```

Rules:
- The flat component list must contain exactly one component with id `root`.
- Components reference children by id: `child` (single) or `children` (array) — never nest components inline.
- Every component needs a unique `id`; use short, semantic ids.
- Choose a descriptive, unique `surfaceId` (e.g. `issue_overview`, `deploy_form`).

## Data binding

- `{"@path": "/some/value"}` — two-way binding to the data model. Resolves to the current value; form inputs write back to the path at interaction time.
- `{"@call": "formatString", "args": {"value": "Total: ${/order/total}"}}` — dynamic strings; `${/path}` interpolates data model values.
- Other built-in functions: `formatNumber`, `formatCurrency`, `formatDate`.
- Set initial values with a trailing message: `{ "version": "1.0", "updateDataModel": { "surfaceId": "s1", "path": "/", "value": { "count": 2 } } }`.
- Paths are JSON Pointer (RFC 6901): `/user/name`, `/items/0/id`.

## Components (basic catalog)

- **Text** — `text` (string or binding), `variant`: `body` (default) | `caption`. Supports simple markdown (`###` headings, `**bold**`, lists).
- **Button** — `child` (usually a Text label), `variant`: `default` (boxed) | `primary` (accent fill, main action) | `borderless` (accent text, tertiary only — no box, no hover), `action`. One `primary` per card.
- **Card** — `child`. Visual container; the root is usually a Card wrapping a Column.
- **Row** — `children`, `justify`, `align` (`center` recommended for action button rows so borderless buttons align with boxed ones).
- **Column** — `children`, `justify`, `align`. Primary vertical layout.
- **List** — `children`, `direction`. For repeating item stacks.
- **Tabs** — `tabs: [{ "title": "...", "child": "<id>" }]`. Switchable panels.
- **Modal** — `trigger` (child id), `content` (child id). Overlay opened by the trigger.
- **Divider** — no props. Horizontal separator.
- **TextField** — `label`, `value` (bind `@path`), `placeholder`, `variant`: `shortText` | `longText` | `number` | `obscured` (secrets).
- **CheckBox** — `label`, `value` (bind, boolean).
- **ChoicePicker** — `label`, `options: [{ "label", "value" }]`, `value` (bind), `displayStyle`: `chips` | `checkbox`.
- **Slider** — `label`, `value` (bind, number), `min`, `max`, `steps`.
- **DateTimeInput** — `value` (bind), `enableDate`, `enableTime`.
- **Image** — `url`. **Icon** — `name`. **Video** — `url`. **AudioPlayer** — `url`.

## Actions

```json
{ "id": "confirmBtn", "component": "Button", "child": "lbl", "variant": "primary",
  "action": { "event": { "name": "confirm_order", "userMessage": "Order confirmed",
    "context": { "item": { "@path": "/order/item" }, "qty": { "@path": "/order/qty" } } } } }
```

- `name` — short snake_case identifier; the agent receives it plus the resolved `context` values and the full current data model.
- `userMessage` — optional human-readable confirmation shown in the follow-up.
- Bind every form field the action depends on; bindings resolve at click time.

## Layout best practices

- Root: `Card` → `Column` with everything inside.
- Group related controls in Rows; keep cards compact — they render inside the chat message flow at ~13px body text.
- Summaries up to a few paragraphs; long explanations belong in plain chat text, not cards.
- Number the follow-up choices with buttons rather than asking the user to type.
