import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReasoningSelectorExtension from '../index';
import { getReasoningPreference, saveReasoningPreference } from '../preferences';

import type { AgentStartedEvent, ExtensionContext, TaskCreatedEvent } from '@aiderdesk/extensions';

type Task = TaskCreatedEvent['task'];

const createTask = (updates: Partial<Task> = {}): Task => ({ id: 'task-1', currentMode: 'agent', ...updates }) as Task;

const createContext = (projectDir: string, task = createTask(), extension = new ReasoningSelectorExtension()) => {
  const profiles = [
    { id: 'default', provider: 'provider-a', model: 'model-a' },
    { id: 'other', provider: 'provider-b', model: 'model-b' },
  ];
  const projectSettings = { agentProfileId: 'default' };
  const context = {
    getProjectContext: () => ({
      baseDir: projectDir,
      getAgentProfiles: () => profiles,
      getProjectSettings: () => projectSettings,
    }),
    getTaskContext: () => ({
      data: task,
      updateTask: update,
    }),
    triggerUIDataRefresh: vi.fn(),
    log: vi.fn(),
  } as unknown as ExtensionContext;

  const update = async (updates: Partial<Task>) => {
    Object.assign(task, updates);
    const result = await extension.onTaskUpdated({ task }, context);
    if (result?.task) {
      Object.assign(task, result.task);
    }
    return task;
  };

  const prepare = async () => {
    const result = await extension.onTaskPrepared({ task }, context);
    if (result?.task) {
      Object.assign(task, result.task);
    }
  };
  const select = (value: unknown) => extension.executeUIExtensionAction('reasoning-selector', 'set-reasoning', [value], context);
  return {
    context,
    extension,
    task,
    profiles,
    projectSettings,
    update,
    prepare,
    select,
  };
};

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'reasoning-selector-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('reasoning preferences', () => {
  it('persists explicit choices by provider and model and reads them in a fresh extension instance', async () => {
    const setup = createContext(projectDir, createTask({ metadata: { unrelated: 'preserved' } }));
    await setup.select('high');

    expect(setup.task.metadata).toMatchObject({
      reasoningEffort: 'high',
      unrelated: 'preserved',
    });
    const contents = JSON.parse(await readFile(join(projectDir, '.aider-desk/reasoning-selector.json'), 'utf-8'));
    expect(contents).toEqual({
      version: 1,
      preferences: { 'provider-a': { 'model-a': 'high' } },
    });
    const reloaded = createContext(projectDir);
    const result = await reloaded.extension.onTaskCreated({ task: reloaded.task }, reloaded.context);
    expect(result?.task?.metadata?.reasoningEffort).toBe('high');
    expect(await readdir(join(projectDir, '.aider-desk'))).toEqual(['reasoning-selector.json']);
  });

  it('restores A → B → A without recording carried-over reasoning as a preference', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await setup.update({ provider: 'provider-a', model: 'model-b' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    expect(await getReasoningPreference(projectDir, 'provider-a', 'model-b')).toBe('');

    await setup.select('low');
    await setup.update({ model: 'model-a' });
    expect(setup.task.metadata?.reasoningEffort).toBe('high');
    await setup.update({ model: 'model-b' });
    expect(setup.task.metadata?.reasoningEffort).toBe('low');
    expect(setup.context.triggerUIDataRefresh).toHaveBeenCalledWith('reasoning-selector', 'task-1');
  });

  it('keeps the same model ID on different provider profiles independent', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await setup.update({ provider: 'provider-b', model: 'model-a' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    await setup.select('minimal');
    await setup.update({ provider: 'provider-a' });
    expect(setup.task.metadata?.reasoningEffort).toBe('high');
    await setup.update({ provider: 'provider-b' });
    expect(setup.task.metadata?.reasoningEffort).toBe('minimal');
  });

  it('restores preferences on profile switches without explicit model overrides', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await setup.update({ agentProfileId: 'other' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    await setup.select('low');
    await setup.update({ agentProfileId: 'default' });
    expect(setup.task.metadata?.reasoningEffort).toBe('high');
    await setup.update({ agentProfileId: 'other' });
    expect(setup.task.metadata?.reasoningEffort).toBe('low');
  });

  it('persists Use default across switches, extension reloads and new tasks', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await setup.select('');
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    const contents = JSON.parse(await readFile(join(projectDir, '.aider-desk/reasoning-selector.json'), 'utf-8'));
    expect(contents.preferences['provider-a']['model-a']).toBe('');
    await setup.update({ provider: 'provider-a', model: 'model-b' });
    await setup.select('low');
    await setup.update({ model: 'model-a' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();

    const reloaded = createContext(projectDir);
    const result = await reloaded.extension.onTaskCreated({ task: reloaded.task }, reloaded.context);
    expect(result?.task?.metadata?.reasoningEffort).toBeUndefined();
  });

  it('isolates projects', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    const other = createContext(join(projectDir, 'other-project'));
    const result = await other.extension.onTaskCreated({ task: other.task }, other.context);
    expect(result?.task?.metadata?.reasoningEffort).toBeUndefined();
    await other.select('low');
    expect(await getReasoningPreference(projectDir, 'provider-a', 'model-a')).toBe('high');
  });

  it('serializes concurrent writes without losing other model preferences', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => saveReasoningPreference(projectDir, 'provider-a', `model-${i}`, 'high')));
    for (let i = 0; i < 20; i++) {
      expect(await getReasoningPreference(projectDir, 'provider-a', `model-${i}`)).toBe('high');
    }
  });

  it('supports provider and model IDs which match object prototype properties', async () => {
    await saveReasoningPreference(projectDir, '__proto__', 'constructor', 'high');
    expect(await getReasoningPreference(projectDir, '__proto__', 'constructor')).toBe('high');
    expect(await getReasoningPreference(projectDir, 'constructor', 'toString')).toBe('');
  });

  it('does not change another existing task when a preference changes', async () => {
    const first = createContext(projectDir);
    const second = createContext(projectDir, createTask({ id: 'task-2' }));
    await first.select('high');
    await second.select('low');
    await first.update({ name: 'Rename only' });
    expect(first.task.metadata?.reasoningEffort).toBe('high');
    expect(await getReasoningPreference(projectDir, 'provider-a', 'model-a')).toBe('low');
  });
});

describe('task lifecycle and model resolution', () => {
  it.each([
    [{}, 'provider-a', 'model-a'],
    [{ agentProfileId: 'other' }, 'provider-b', 'model-b'],
    [
      {
        provider: 'explicit-provider',
        model: 'explicit-model',
        agentProfileId: 'other',
      },
      'explicit-provider',
      'explicit-model',
    ],
    [{ provider: 'incomplete-override' }, 'provider-a', 'model-a'],
  ])('resolves the effective model for new task %j', async (updates, provider, model) => {
    await saveReasoningPreference(projectDir, provider, model, 'high');
    const setup = createContext(projectDir, createTask(updates));
    const result = await setup.extension.onTaskCreated({ task: setup.task }, setup.context);
    expect(result?.task?.metadata?.reasoningEffort).toBe('high');
    expect(result?.task?.metadata?.reasoningSelectorModel).toBe(JSON.stringify([provider, model]));
  });

  it.each(['low', ''])('preserves explicitly supplied reasoning %j on creation without changing preferences', async (value) => {
    await saveReasoningPreference(projectDir, 'provider-a', 'model-a', 'high');
    const setup = createContext(projectDir, createTask({ metadata: { reasoningEffort: value, unrelated: true } }));
    const result = await setup.extension.onTaskCreated({ task: setup.task }, setup.context);
    expect(result?.task?.metadata).toMatchObject({
      reasoningEffort: value,
      unrelated: true,
    });
    expect(await getReasoningPreference(projectDir, 'provider-a', 'model-a')).toBe('high');
  });

  it('preserves legacy task reasoning on preparation and restores preferences only after switching', async () => {
    const setup = createContext(projectDir, createTask({ metadata: { reasoningEffort: 'medium', unrelated: true } }));
    await saveReasoningPreference(projectDir, 'provider-a', 'model-a', 'high');
    await setup.prepare();
    expect(setup.task.metadata?.reasoningEffort).toBe('medium');
    await setup.update({ name: 'Rename only' });
    expect(setup.task.metadata?.reasoningEffort).toBe('medium');
    await setup.update({ provider: 'provider-a', model: 'model-b' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    await setup.update({ model: 'model-a' });
    expect(setup.task.metadata).toMatchObject({
      reasoningEffort: 'high',
      unrelated: true,
    });
  });

  it('tracks a legacy task shown in the UI after hot-loading without mutating it on read', async () => {
    const setup = createContext(projectDir, createTask({ metadata: { reasoningEffort: 'medium' } }));
    await saveReasoningPreference(projectDir, 'provider-a', 'model-b', 'low');
    expect(await setup.extension.getUIExtensionData('reasoning-selector', setup.context)).toMatchObject({ reasoningEffort: 'medium' });
    expect(setup.task.metadata).toEqual({ reasoningEffort: 'medium' });
    await setup.update({ provider: 'provider-a', model: 'model-b' });
    expect(setup.task.metadata?.reasoningEffort).toBe('low');
    expect(await getReasoningPreference(projectDir, 'provider-a', 'model-a')).toBe('');
  });

  it('detects profile model changes when a task is prepared again', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await saveReasoningPreference(projectDir, 'provider-a', 'new-model', 'low');
    setup.profiles[0].model = 'new-model';
    await setup.prepare();
    expect(setup.task.metadata?.reasoningEffort).toBe('low');
  });

  it('restores identity from task metadata after an extension restart', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    const reloaded = createContext(projectDir, structuredClone(setup.task));
    await reloaded.update({ provider: 'provider-a', model: 'model-b' });
    await reloaded.select('low');
    await reloaded.update({ model: 'model-a' });
    expect(reloaded.task.metadata?.reasoningEffort).toBe('high');
  });

  it('does not save a choice when the effective model cannot be resolved', async () => {
    const setup = createContext(projectDir, createTask({ agentProfileId: 'missing' }));
    await expect(setup.select('high')).rejects.toThrow('Select a model');
    await expect(readFile(join(projectDir, '.aider-desk/reasoning-selector.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('clears the previous override when the effective model becomes unresolved', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    await setup.update({ agentProfileId: 'missing' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
  });
});

describe('validation and agent integration', () => {
  it('exposes the selected value to the UI and applies it without dropping other model call settings', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    expect(await setup.extension.getUIExtensionData('reasoning-selector', setup.context)).toMatchObject({ reasoningEffort: 'high', isAgentMode: true });
    const event = {
      modelCallSettings: { temperature: 0.5 },
    } as AgentStartedEvent;
    expect(await setup.extension.onAgentStarted(event, setup.context)).toEqual({
      modelCallSettings: { temperature: 0.5, reasoning: 'high' },
    });
    await setup.select('');
    expect(await setup.extension.onAgentStarted(event, setup.context)).toBeUndefined();
  });

  it('treats None as an explicit agent override rather than Use default', async () => {
    const setup = createContext(projectDir);
    await setup.select('none');
    expect(await setup.extension.onAgentStarted({ modelCallSettings: {} } as AgentStartedEvent, setup.context)).toEqual({
      modelCallSettings: { reasoning: 'none' },
    });
  });

  it.each(['unsupported', 42, null, undefined])('rejects invalid reasoning input %j', async (value) => {
    const setup = createContext(projectDir);
    await expect(setup.select(value)).rejects.toThrow('Invalid reasoning effort');
    expect(setup.task.metadata).toBeUndefined();
  });

  it('logs invalid preference files, uses default on switches, and refuses to overwrite the file', async () => {
    const setup = createContext(projectDir);
    await setup.select('high');
    const path = join(projectDir, '.aider-desk/reasoning-selector.json');
    await writeFile(path, '{broken');
    await setup.update({ provider: 'provider-a', model: 'model-b' });
    expect(setup.task.metadata?.reasoningEffort).toBeUndefined();
    expect(setup.context.log).toHaveBeenCalledWith(expect.stringContaining('could not read preferences'), 'warn');
    await expect(setup.select('low')).rejects.toThrow();
    expect(await readFile(path, 'utf-8')).toBe('{broken');
  });

  it('rejects invalid preference file schemas', async () => {
    await saveReasoningPreference(projectDir, 'provider-a', 'model-a', 'high');
    await writeFile(
      join(projectDir, '.aider-desk/reasoning-selector.json'),
      JSON.stringify({
        version: 1,
        preferences: { 'provider-a': { 'model-a': 'invalid' } },
      }),
    );
    await expect(getReasoningPreference(projectDir, 'provider-a', 'model-a')).rejects.toThrow('Invalid reasoning preferences');
  });

  it('hides the selector for Aider modes', async () => {
    const setup = createContext(projectDir, createTask({ currentMode: 'code' }));
    expect(await setup.extension.getUIExtensionData('reasoning-selector', setup.context)).toMatchObject({ isAgentMode: false });
  });
});
