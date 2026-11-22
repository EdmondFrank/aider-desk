import { describe, expect, it } from 'vitest';

import { BASIC_CATALOG_ID, normalizeMessages, validateShowUiMessages } from '../validate.ts';
import { parseMessagesInput } from '../index.ts';

const validCard = {
  messages: [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'test_card',
        components: [
          { id: 'root', component: 'Card', child: 'col' },
          { id: 'col', component: 'Column', children: ['title', 'btn'] },
          { id: 'title', component: 'Text', text: 'Hello' },
          { id: 'btn', component: 'Button', child: 'btnLabel', action: { event: { name: 'go', context: {} } } },
          { id: 'btnLabel', component: 'Text', text: 'Go' },
        ],
      },
    },
    { version: '1.0', updateDataModel: { surfaceId: 'test_card', path: '/', value: { count: 1 } } },
  ],
};

describe('parseMessagesInput', () => {
  it('accepts a JSON-encoded string of the messages array (small models stringify nested arrays)', () => {
    const stringified = JSON.stringify(validCard.messages);
    const parsed = parseMessagesInput({ messages: stringified });
    expect(parsed.error).toBeUndefined();
    expect(parsed.messages).toEqual(validCard.messages);
  });

  it('passes through a real array unchanged', () => {
    const parsed = parseMessagesInput({ messages: validCard.messages });
    expect(parsed.error).toBeUndefined();
    expect(parsed.messages).toEqual(validCard.messages);
  });

  it('rejects a JSON-encoded string whose content is not an array', () => {
    const parsed = parseMessagesInput({ messages: JSON.stringify({ version: '1.0' }) });
    expect(parsed.error).toContain('not an array');
  });

  it('rejects a string that is not valid JSON', () => {
    const parsed = parseMessagesInput({ messages: 'nope' });
    expect(parsed.error).toContain('not valid JSON');
  });
});

describe('validateShowUiMessages', () => {
  it('accepts a valid single-surface card', () => {
    const result = validateShowUiMessages(validCard.messages);
    expect(result.ok).toBe(true);
    expect(result.surfaceId).toBe('test_card');
  });

  it('rejects non-array and empty input', () => {
    expect(validateShowUiMessages(undefined).ok).toBe(false);
    expect(validateShowUiMessages([]).ok).toBe(false);
    expect(validateShowUiMessages('nope').ok).toBe(false);
  });

  it('rejects messages with wrong version or unknown keys', () => {
    const wrongVersion = [{ version: 'v0.9', createSurface: { surfaceId: 's' } }];
    expect(validateShowUiMessages(wrongVersion).ok).toBe(false);

    const noKey = [{ version: '1.0', somethingElse: {} }];
    expect(validateShowUiMessages(noKey).ok).toBe(false);
  });

  it('rejects update-only payload without createSurface', () => {
    const result = validateShowUiMessages([
      { version: '1.0', updateDataModel: { surfaceId: 'other', path: '/a', value: 1 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exactly one createSurface');
  });

  it('rejects multiple createSurface messages', () => {
    const result = validateShowUiMessages([validCard.messages[0], validCard.messages[0]]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('one createSurface');
  });

  it('rejects createSurface that is not the first message', () => {
    const result = validateShowUiMessages([
      { version: '1.0', updateDataModel: { surfaceId: 's', path: '/', value: {} } },
      { version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('first message');
  });

  it('rejects unsupported deleteSurface and callRendererFunction messages', () => {
    const withDelete = [
      ...validCard.messages,
      { version: '1.0', deleteSurface: { surfaceId: 'test_card' } },
    ];
    expect(validateShowUiMessages(withDelete).ok).toBe(false);

    const withRpc = [
      ...validCard.messages,
      { version: '1.0', callRendererFunction: { functionCallId: 'c1', callFunction: { '@call': 'x', catalogId: BASIC_CATALOG_ID } } },
    ];
    expect(validateShowUiMessages(withRpc).ok).toBe(false);
  });

  it('rejects update messages targeting a different surface', () => {
    const result = validateShowUiMessages([
      validCard.messages[0],
      { version: '1.0', updateDataModel: { surfaceId: 'other_surface', path: '/', value: {} } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('static');
  });

  it('rejects unsupported catalog ids', () => {
    const result = validateShowUiMessages([
      { version: '1.0', createSurface: { surfaceId: 's', catalogId: 'https://example.com/catalog.json', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('catalogId');
  });

  it('rejects components missing from the catalog via A2UI validation', () => {
    const result = validateShowUiMessages([
      { version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'FancyWidget' }] } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('A2UI validation failed');
  });

  it('normalizes missing catalogId and inline dataModel', () => {
    const result = validateShowUiMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: { '@path': '/msg' } }],
          dataModel: { msg: 'hi' },
        },
      },
    ]);
    expect(result.ok).toBe(true);
    const messages = result.messages ?? [];
    expect(messages[0].createSurface?.catalogId).toBe(BASIC_CATALOG_ID);
    expect(messages[0].createSurface?.dataModel).toBeUndefined();
    expect(messages[1]?.updateDataModel?.value).toEqual({ msg: 'hi' });
  });

  it('normalizeMessages injects the basic catalog id', () => {
    const [first] = normalizeMessages([{ version: '1.0', createSurface: { surfaceId: 's' } }]);
    expect(first.createSurface?.catalogId).toBe(BASIC_CATALOG_ID);
  });
});
