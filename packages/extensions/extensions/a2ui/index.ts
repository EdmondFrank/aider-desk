import { z } from "zod";

import type {
  CommandDefinition,
  ExtensionContext,
  SkillDefinition,
  ToolDefinition,
  UIComponentDefinition,
} from "../../extensions.d.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BASIC_CATALOG_ID, validateShowUiMessages } from "./validate";

const metadata = {
  name: "A2UI",
  version: "0.1.0",
  description:
    "Generative UI cards in task chat via the A2UI protocol — the agent composes interactive interfaces from a locked component catalog",
  author: "wladimiiir",
  iconUrl:
    "https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/a2ui/icon.png",
  capabilities: ["tools", "ui", "commands"],
};

const inputSchema = z.object({
  messages: z
    .union([z.array(z.record(z.string(), z.unknown())), z.string()])
    .describe(
      "Array of A2UI v1.0 messages: exactly one createSurface (with inline components) followed by an optional updateDataModel. Pass it as a real JSON array; a JSON-encoded string of that array is also accepted and parsed automatically.",
    ),
});

export const parseMessagesInput = (
  input: unknown,
): { messages?: unknown[]; error?: string } => {
  const messages = (input as { messages?: unknown })?.messages;
  if (typeof messages !== "string") {
    return { messages: messages as unknown[] };
  }
  try {
    const parsed: unknown = JSON.parse(messages);
    if (!Array.isArray(parsed)) {
      return {
        error:
          'The "messages" argument was a JSON-encoded string, but its content is not an array. Send the array itself (or a JSON-encoded array).',
      };
    }
    return { messages: parsed };
  } catch {
    return {
      error:
        'The "messages" argument was received as a string that is not valid JSON. Pass "messages" as a real JSON array of A2UI message objects, not as a quoted/escaped string.',
    };
  }
};

const TOOL_RESULT_PREFIX = "A2UI card rendered";

const formatActionPrompt = (action: Record<string, unknown>): string => {
  const name = typeof action.name === "string" ? action.name : "unknown_action";
  const userMessage =
    typeof action.userMessage === "string" ? action.userMessage.trim() : "";
  const contextJson = JSON.stringify(action.context ?? {}, null, 2);
  const lines = [
    `The user clicked the "${name}" action on a UI card you rendered with the show_ui_message tool.`,
    userMessage ? `Action message: ${userMessage}` : "",
    "Action context:",
    "```json",
    contextJson,
    "```",
    "Respond to this action. If you need to show updated information or a follow-up form, render a new card with show_ui_message.",
  ];
  return lines.filter(Boolean).join("\n");
};

const createShowUiMessageTool = (): ToolDefinition => ({
  name: "show_ui_message",
  description: `Render a static interactive UI card in the chat for the user, generated with the A2UI protocol. Use it whenever structured or interactive content serves the user better than prose: confirmation forms, option pickers, result summaries with per-item actions, small dashboards, and similar. Do NOT use it for code blocks, diffs, or long explanations — plain text is better there.

Each call renders ONE static card in the conversation. Cards cannot be modified later: to show changed information, call the tool again with a new card.

The "messages" argument is an array of A2UI v1.0 wire messages:
1. Exactly one createSurface message (first) with:
   - surfaceId: short unique id for this card (e.g. "flight_summary")
   - components: FLAT array of component objects. Each has a unique "id", a "component" type and references children by ID ("child" for single child, "children" for arrays). Exactly one component must have id "root". NEVER nest components inline — always reference by id.
   - Do not set catalogId: the basic catalog is always used.
2. Optionally one updateDataModel message providing initial data values: { "surfaceId": <same>, "path": "/", "value": {...} }.

Available basic catalog components: Text (text, variant: caption|body), Button (child, variant: default|primary|borderless, action), Card (child), Row (children, justify, align), Column (children, justify, align), List (children, direction), Tabs (tabs: [{title, child}]), Modal (trigger, content), Divider, TextField (label, value, placeholder, variant: shortText|longText|number|obscured), CheckBox (label, value), ChoicePicker (label, options: [{label, value}], value, displayStyle: chips|checkbox), Slider (label, value, min, max, steps), DateTimeInput (value, enableDate, enableTime), Image (url), Icon (name), Video (url), AudioPlayer (url).

Data binding: bind any string/number/boolean property to the data model with { "@path": "/some/value" }. Build dynamic strings with { "@call": "formatString", "args": { "value": "Total: $\${/order/total}" } }.

Interactivity: components that change values (TextField, CheckBox, ChoicePicker, Slider, DateTimeInput) must be bound to a "@path" in the data model. Buttons trigger actions sent back to you when clicked:
{ "action": { "event": { "name": "confirm_order", "userMessage": "Order confirmed", "context": { "item": { "@path": "/order/item" } } } } }
The context bindings resolve to current values at click time, so the user's form input is included automatically.
Button rows: put action buttons in a Row with "align": "center" so borderless buttons align with boxed ones. Use variant "borderless" only for tertiary/low-emphasis actions (it renders as accent-colored text with no box or hover background).
This description covers the essentials only. For the full component reference (all props, binding functions, layout best practices), activate the "a2ui" skill via the skills__activate_skill tool — load it before building complex cards (tabs, modals, forms with many fields) or when a card fails validation.

Example — a small order card:
\`\`\`json
{
  "messages": [
    { "version": "1.0", "createSurface": {
      "surfaceId": "order_summary",
      "components": [
        { "id": "root", "component": "Card", "child": "col" },
        { "id": "col", "component": "Column", "children": ["title", "itemText", "qty", "confirmBtn"] },
        { "id": "title", "component": "Text", "text": "### Order summary" },
        { "id": "itemText", "component": "Text", "text": { "@call": "formatString", "args": { "value": "\${/order/item} × \${/order/qty}" } } },
        { "id": "qty", "component": "Slider", "label": "Quantity", "min": 1, "max": 10, "value": { "@path": "/order/qty" } },
        { "id": "confirmBtn", "component": "Button", "child": "confirmLabel", "variant": "primary",
          "action": { "event": { "name": "confirm_order", "context": { "qty": { "@path": "/order/qty" } } } } },
        { "id": "confirmLabel", "component": "Text", "text": "Confirm order" }
      ]
    } },
    { "version": "1.0", "updateDataModel": { "surfaceId": "order_summary", "path": "/", "value": { "order": { "item": "Mechanical keyboard", "qty": 2 } } } }
  ]
}
\`\`\`
`,
  inputSchema,
  execute: async (input) => {
    const parsed = parseMessagesInput(input);
    if (parsed.error) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error }],
      };
    }
    const result = validateShowUiMessages(parsed.messages);
    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: result.error }],
      };
    }
    const componentCount = (
      result.messages?.[0]?.createSurface?.components ?? []
    ).length;
    return {
      content: [
        {
          type: "text",
          text: `${TOOL_RESULT_PREFIX}: surface "${result.surfaceId}" with ${componentCount} component(s). The user can now interact with it; button clicks will be sent back to you as follow-up messages.`,
        },
      ],
    };
  },
});

const A2UI_OFFICIAL_SKILL_URL =
  "https://raw.githubusercontent.com/a2ui-project/a2ui/main/skills/a2ui/SKILL.md";

let remoteSkillContent: string | undefined;
let remoteSkillFetchInFlight = false;

const stripFrontmatter = (content: string): string =>
  content.startsWith("---\n")
    ? content.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
    : content.trim();

const isValidSkillContent = (content: string): boolean =>
  content.length > 500 && /A2UI/i.test(content.slice(0, 2000));

const fetchRemoteSkillContent = (): void => {
  if (remoteSkillFetchInFlight) {
    return;
  }
  remoteSkillFetchInFlight = true;
  fetch(A2UI_OFFICIAL_SKILL_URL, { signal: AbortSignal.timeout(5000) })
    .then((response) =>
      response.ok
        ? response.text()
        : Promise.reject(new Error(`HTTP ${response.status}`)),
    )
    .then((text) => {
      if (isValidSkillContent(text)) {
        remoteSkillContent = stripFrontmatter(text);
      }
    })
    .catch(() => {
      // Offline or unreachable: keep serving the bundled fallback; allow a retry on the next getSkills() call.
      remoteSkillFetchInFlight = false;
    });
};

fetchRemoteSkillContent();

export default class A2uiExtension {
  static metadata = metadata;

  getTools(_context: ExtensionContext): ToolDefinition[] {
    return [createShowUiMessageTool()];
  }

  getSkills(_context: ExtensionContext): SkillDefinition[] {
    fetchRemoteSkillContent();
    return [
      {
        name: "a2ui",
        description:
          "A2UI card authoring reference for the show_ui_message tool: complete basic catalog component schemas, data binding patterns, and layout best practices. Load when building or debugging a UI card.",
        location: "extension",
        content:
          remoteSkillContent ??
          readFileSync(join(__dirname, "a2ui-skill.md"), "utf-8"),
      },
    ];
  }

  getUIComponents(_context: ExtensionContext): UIComponentDefinition[] {
    return [
      {
        id: "a2ui-message",
        placement: "task-message",
        messageFilter: {
          types: ["tool"],
          serverName: "extensions",
          toolName: "show_ui_message",
        },
        jsx: readFileSync(join(__dirname, "A2uiMessage.jsx"), "utf-8"),
      },
    ];
  }

  getUIComponentsLibraries(): Record<string, string> {
    // Pinned esm.sh prebuilt bundles. The trailing "#" makes the library loader fetch the exact
    // artifact: the loader appends esm.sh build params (?external=...&bundle) which would 404
    // these non-react packages ("could not resolve build entry"), but a fragment is stripped
    // from the request by fetch. The artifacts are fully self-contained single-file bundles.
    return {
      a2uiWebCore: "@a2ui/web_core@0.15.0/es2022/v1_0.bundle.mjs#",
      a2uiMarkdown: "@a2ui/markdown-it@0.2.2/es2022/markdown-it.bundle.mjs#",
    };
  }

  async executeUIExtensionAction(
    _componentId: string,
    action: string,
    args: unknown[],
    context: ExtensionContext,
  ): Promise<unknown> {
    if (action !== "a2ui-action") {
      return { ok: false, error: `Unknown action "${action}"` };
    }
    const [payload] = args as [Record<string, unknown>];
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Missing action payload" };
    }

    const taskContext = context.getTaskContext();
    if (!taskContext) {
      return { ok: false, error: "No active task" };
    }

    await taskContext.runPrompt(formatActionPrompt(payload));
    return { ok: true };
  }

  getCommands(_context: ExtensionContext): CommandDefinition[] {
    return [
      {
        name: "a2ui-demo",
        description:
          "Demo: ask the agent to render a sample A2UI card with show_ui_message",
        execute: async (_args, context) => {
          const taskContext = context.getTaskContext();
          if (!taskContext) {
            return;
          }
          await taskContext.runPrompt(
            "Render a sample UI card with the show_ui_message tool to demonstrate your generative UI capability. " +
              'Make a small order form for a coffee shop: an order summary card titled "Coffee order" with a ChoicePicker for drink (latte, cappuccino, espresso), ' +
              'a Slider for sugar (0-3), a CheckBox for oat milk, and a primary Button "Place order" that triggers an action named "place_order" ' +
              "including the chosen drink, sugar and milk in its context. Show the current values with bound data paths.",
          );
        },
      },
    ];
  }
}
