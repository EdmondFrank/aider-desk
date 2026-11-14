import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoMap } from '@aiderdesk/tree-sitter-utils';

import TreeSitterRepoMapExtension from '../index';

import type { AgentStartedEvent, ExtensionContext } from '@aiderdesk/extensions';

vi.mock('@aiderdesk/tree-sitter-utils', () => ({ getRepoMap: vi.fn() }));
vi.mock('../config', () => ({ loadConfig: vi.fn(async () => ({ exclude: ['dist/**'], maxLines: 2000 })), saveConfig: vi.fn() }));

const component = 'repository-map-initialization';
const generator = vi.mocked(getRepoMap);
const instances: TreeSitterRepoMapExtension[] = [];

const setup = (includeRepoMap = true, root = '/repo') => {
  let resolve!: (value: string) => void;
  const warm = new Promise<string>((done) => {
    resolve = done;
  });
  generator.mockImplementation((_root, options) => (options?.prepareOnly ? warm : Promise.resolve('example.ts:\n│class Example {}')));
  const task = { data: { id: 'task' }, getTaskDir: () => root, getTaskAgentProfile: vi.fn(async () => ({ includeRepoMap })) };
  const context = {
    getTaskContext: () => task,
    getProjectDir: () => '/base-project',
    triggerUIDataRefresh: vi.fn(),
    log: vi.fn(),
  } as unknown as ExtensionContext;
  const extension = new TreeSitterRepoMapExtension();
  instances.push(extension);
  const event = { agentProfile: { includeRepoMap }, contextMessages: [], contextFiles: [], modelCallSettings: {} } as unknown as AgentStartedEvent;
  return { extension, context, task, event, resolve };
};

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.onUnload();
});

describe('repo-map extension initialization UI', () => {
  it('prewarms on open only for an enabled resolved profile, without waiting for generation', async () => {
    const { extension, context } = setup();
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    expect(generator).toHaveBeenCalledExactlyOnceWith('/repo', expect.objectContaining({ prepareOnly: true }));
    expect(await extension.getUIExtensionData(component, context)).toMatchObject({ status: 'initializing', waiting: false });
  });

  it('does no work when the profile is disabled or missing', async () => {
    const { extension, context, task } = setup(false);
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    expect(generator).not.toHaveBeenCalled();
    task.getTaskAgentProfile.mockResolvedValue(null as unknown as { includeRepoMap: boolean });
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    expect(generator).not.toHaveBeenCalled();
    expect(await extension.getUIExtensionData(component, context)).toBeNull();
  });

  it('responds to profile changes without reinitializing a cancelled checkout', async () => {
    const { extension, context, task } = setup(false);
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    task.getTaskAgentProfile.mockResolvedValue({ includeRepoMap: true });
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    const state = (await extension.getUIExtensionData(component, context)) as { key: string };
    await extension.executeUIExtensionAction(component, 'cancel', [state.key], context);
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    expect(generator).toHaveBeenCalledOnce();
    expect(await extension.getUIExtensionData(component, context)).toMatchObject({ status: 'cancelled' });
  });

  it('backgrounding starts the run without a map and preserves worker initialization', async () => {
    const { extension, context, event, resolve } = setup();
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    const running = extension.onAgentStarted(event, context);
    await vi.waitFor(async () => expect(await extension.getUIExtensionData(component, context)).toMatchObject({ waiting: true }));
    const state = (await extension.getUIExtensionData(component, context)) as { key: string };
    const signal = generator.mock.calls[0][1]?.signal;
    await extension.executeUIExtensionAction(component, 'background', [state.key], context);
    expect(await running).toMatchObject({ agentProfile: { includeRepoMap: false } });
    expect(signal?.aborted).toBe(false);
    expect(generator).toHaveBeenCalledOnce();
    resolve('');
    await vi.waitFor(async () => expect(await extension.getUIExtensionData(component, context)).toMatchObject({ status: 'ready' }));
    expect(await extension.onAgentStarted(event, context)).toMatchObject({
      agentProfile: { includeRepoMap: false },
      contextMessages: [
        expect.objectContaining({ role: 'user', content: expect.stringContaining('class Example') }),
        expect.objectContaining({ role: 'assistant' }),
      ],
    });
  });

  it('cancelling releases the agent without invoking the default repo-map fallback', async () => {
    const { extension, context, event } = setup();
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    const running = extension.onAgentStarted(event, context);
    await vi.waitFor(async () => expect(await extension.getUIExtensionData(component, context)).toMatchObject({ waiting: true }));
    const state = (await extension.getUIExtensionData(component, context)) as { key: string };
    await extension.executeUIExtensionAction(component, 'cancel', [state.key], context);
    expect(await running).toEqual({ agentProfile: { includeRepoMap: false } });
    expect(generator.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(generator).toHaveBeenCalledOnce();
  });

  it('ignores stale UI actions for a different checkout', async () => {
    const { extension, context } = setup();
    await extension.executeUIExtensionAction(component, 'initialize', [], context);
    await extension.executeUIExtensionAction(component, 'cancel', ['stale-key'], context);
    expect(await extension.getUIExtensionData(component, context)).toMatchObject({ status: 'initializing' });
  });

  it('aborting the run blocks it but does not cancel independent prewarming', async () => {
    const { extension, context, event } = setup();
    const controller = new AbortController();
    const running = extension.onAgentStarted({ ...event, modelCallSettings: { ...event.modelCallSettings, abortSignal: controller.signal } }, context);
    await vi.waitFor(async () => expect(await extension.getUIExtensionData(component, context)).toMatchObject({ waiting: true }));
    controller.abort();
    expect(await running).toEqual({ blocked: true });
    expect(generator.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });
});
