import { validatePayload } from '@a2ui/agent';
import { basicCatalog } from '@a2ui/web_core/v1_0';
import type { A2uiMessage, ValidationResult } from './types';

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
export const A2UI_VERSION = '1.0';

const AGENT_TO_RENDERER_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'callRendererFunction', 'deleteSurface'] as const;

const UNSUPPORTED_KEYS = new Set(['deleteSurface', 'callRendererFunction']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const messageKeyOf = (message: Record<string, unknown>): string | undefined =>
  Object.keys(message).find((key) => AGENT_TO_RENDERER_KEYS.includes(key as (typeof AGENT_TO_RENDERER_KEYS)[number]));

/**
 * Normalizes a raw `show_ui_message` input into a canonical single-surface A2UI payload:
 * - injects the basic catalog id when the createSurface omits it
 * - moves an inline `dataModel` out of createSurface into a trailing updateDataModel message
 * - strips extension-only fields
 */
export const normalizeMessages = (rawMessages: unknown[]): A2uiMessage[] => {
  const messages = rawMessages.map((message) => ({ ...(message as Record<string, unknown>) }) as unknown as A2uiMessage);
  const createIndex = messages.findIndex((message) => 'createSurface' in message);
  const createSurface = messages[createIndex].createSurface as Record<string, unknown>;

  if (!createSurface.catalogId) {
    createSurface.catalogId = BASIC_CATALOG_ID;
  }

  const inlineDataModel = createSurface.dataModel;
  if (isPlainObject(inlineDataModel)) {
    delete createSurface.dataModel;
    messages.splice(createIndex + 1, 0, {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: createSurface.surfaceId as string,
        path: '/',
        value: inlineDataModel,
      },
    });
  }

  return messages;
};

/**
 * Validates the input for the static single-surface message card rendered by this extension.
 * Returns the normalized payload on success or a model-readable error message on failure.
 */
export const validateShowUiMessages = (input: unknown): ValidationResult => {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'The "messages" argument must be a non-empty array of A2UI v1.0 messages.' };
  }

  for (const [index, entry] of input.entries()) {
    if (!isPlainObject(entry)) {
      return { ok: false, error: `messages[${index}] must be an object.` };
    }
    if (entry.version !== A2UI_VERSION) {
      return { ok: false, error: `messages[${index}] must have "version": "1.0".` };
    }
    const key = messageKeyOf(entry);
    if (!key) {
      return {
        ok: false,
        error: `messages[${index}] must contain exactly one agent-to-renderer message key (createSurface, updateComponents, or updateDataModel).`,
      };
    }
    if (UNSUPPORTED_KEYS.has(key)) {
      return {
        ok: false,
        error: `messages[${index}] uses "${key}", which is not supported by show_ui_message. Cards are static: emit a new card instead of deleting or calling renderer functions.`,
      };
    }
  }

  const createIndices = input.map((message, index) => ('createSurface' in message ? index : -1)).filter((index) => index >= 0);
  if (createIndices.length === 0) {
    return {
      ok: false,
      error: 'The messages array must contain exactly one createSurface message with inline components (each call renders a fresh static card).',
    };
  }
  if (createIndices.length > 1) {
    return { ok: false, error: 'Only one createSurface message is allowed per call — one static card per tool call.' };
  }
  const createIndex = createIndices[0];
  if (createIndex !== 0) {
    return { ok: false, error: 'The createSurface message must be the first message in the array.' };
  }

  const createSurface = input[createIndex].createSurface;
  if (!isPlainObject(createSurface) || typeof createSurface.surfaceId !== 'string' || !createSurface.surfaceId) {
    return { ok: false, error: 'createSurface must be an object with a non-empty "surfaceId" string.' };
  }
  if (createSurface.catalogId && createSurface.catalogId !== BASIC_CATALOG_ID) {
    return {
      ok: false,
      error: `Unsupported catalogId "${String(createSurface.catalogId)}". This renderer only provides the basic catalog (${BASIC_CATALOG_ID}); omit catalogId to use it.`,
    };
  }

  const surfaceId = createSurface.surfaceId;
  for (const [index, entry] of input.entries()) {
    const key = messageKeyOf(entry);
    if (key && key !== 'createSurface') {
      const payload = entry[key] as Record<string, unknown> | undefined;
      if (payload?.surfaceId !== undefined && payload.surfaceId !== surfaceId) {
        return {
          ok: false,
          error: `messages[${index}] targets surface "${String(payload.surfaceId)}" but this call creates surface "${surfaceId}". Cards are static: call show_ui_message again to render an updated card.`,
        };
      }
    }
  }

  let normalized: A2uiMessage[];
  try {
    normalized = normalizeMessages(input);
  } catch (error) {
    return { ok: false, error: `Failed to normalize messages: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    validatePayload([basicCatalog], normalized);
  } catch (error) {
    return {
      ok: false,
      error: `A2UI validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { ok: true, messages: normalized, surfaceId };
};
