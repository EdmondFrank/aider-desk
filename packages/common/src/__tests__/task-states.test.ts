import { describe, expect, it } from 'vitest';

import { BUILT_IN_TASK_STATE_DEFINITIONS, isManuallySelectableTaskState, isValidTaskStateDefinition, mergeTaskStateDefinitions } from '../task-states';
import { DefaultTaskState } from '../types';

const valid = { id: 'custom-status_1', name: 'Custom status', color: '#ab12ef', priority: 25 };

describe('task-state validation', () => {
  it.each(['#abc', '#abcd', '#a1b2c3', '#a1b2c3d4', '#ABCDEF'])('accepts safe hex color %s', (color) => {
    expect(isValidTaskStateDefinition({ ...valid, color, priority: -0.5 })).toBe(true);
  });

  it.each([
    null,
    undefined,
    false,
    [],
    {},
    { ...valid, id: '' },
    { ...valid, id: ' has spaces ' },
    { ...valid, id: 'a.b' },
    { ...valid, name: '' },
    { ...valid, name: ' ' },
    { ...valid, name: ' padded ' },
    { ...valid, color: 'red' },
    { ...valid, color: 'var(--color-text-primary)' },
    { ...valid, color: '#ab' },
    { ...valid, color: 'url(https://example.com)' },
    { ...valid, priority: NaN },
    { ...valid, priority: Infinity },
    { ...valid, priority: '10' },
  ])('rejects invalid input %#', (input) => {
    expect(isValidTaskStateDefinition(input)).toBe(false);
  });

  it('preserves operational-state restrictions without restricting custom states', () => {
    expect(BUILT_IN_TASK_STATE_DEFINITIONS.filter(isManuallySelectableTaskState).map((state) => state.id)).toEqual([
      DefaultTaskState.Todo,
      DefaultTaskState.ReadyForImplementation,
      DefaultTaskState.MoreInfoNeeded,
      DefaultTaskState.ReadyForReview,
      DefaultTaskState.Done,
    ]);
    expect(isManuallySelectableTaskState(valid)).toBe(true);
  });
});

describe('mergeTaskStateDefinitions', () => {
  it('includes all built-ins without custom states', () => {
    expect(mergeTaskStateDefinitions([])).toEqual(BUILT_IN_TASK_STATE_DEFINITIONS);
  });

  it('interleaves custom states by priority and breaks ties by ID', () => {
    const states = mergeTaskStateDefinitions([
      { ...valid, id: 'z' },
      { ...valid, id: 'a' },
      { ...valid, id: 'first', priority: -5 },
      { ...valid, id: 'last', priority: 100 },
    ]);
    expect(states.map((state) => state.id)).toEqual([
      'first',
      DefaultTaskState.Todo,
      DefaultTaskState.ReadyForImplementation,
      'a',
      'z',
      DefaultTaskState.InProgress,
      DefaultTaskState.Interrupted,
      DefaultTaskState.Delegated,
      DefaultTaskState.MoreInfoNeeded,
      DefaultTaskState.ReadyForReview,
      DefaultTaskState.Done,
      'last',
    ]);
  });

  it('preserves built-ins and the first custom definition for duplicate IDs', () => {
    const states = mergeTaskStateDefinitions([{ ...valid, id: DefaultTaskState.Todo }, valid, { ...valid, name: 'Duplicate' }]);
    expect(states.find((state) => state.id === DefaultTaskState.Todo)).toEqual(BUILT_IN_TASK_STATE_DEFINITIONS[0]);
    expect(states.filter((state) => state.id === valid.id)).toEqual([valid]);
  });

  it('returns copies without mutating input definitions or their order', () => {
    const customStates = [
      { ...valid, priority: 100 },
      { ...valid, id: 'first', priority: -5 },
    ];
    const original = customStates.map((state) => ({ ...state }));
    const states = mergeTaskStateDefinitions(customStates);
    states.find((state) => state.id === valid.id)!.name = 'Changed custom';
    states.find((state) => state.id === DefaultTaskState.Todo)!.name = 'Changed built-in';
    expect(customStates).toEqual(original);
    expect(BUILT_IN_TASK_STATE_DEFINITIONS[0].name).toBe('Todo');
  });
});
