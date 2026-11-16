import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QuestionsExtension from '../index';

import type { ExtensionContext, TaskClosedEvent } from '@aiderdesk/extensions';

const storage = vi.hoisted(() => ({ config: '' }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (path: string) => (path.endsWith('config.json') ? !!storage.config : actual.existsSync(path)),
    readFileSync: (path: string, encoding: 'utf-8') => (path.endsWith('config.json') ? storage.config : actual.readFileSync(path, encoding)),
    writeFileSync: (_path: string, content: string) => {
      storage.config = content;
    },
  };
});

const component = 'questions-ask-question';
const input = { question: 'Which approach?', options: ['Extend', 'Replace'] };
const instances: QuestionsExtension[] = [];

const setup = (project = '/project', id = 'task') => {
  const extension = new QuestionsExtension();
  instances.push(extension);
  const task = {
    data: { id },
    runPrompt: vi.fn(),
    addLogMessage: vi.fn(),
    addLoadingMessage: vi.fn(),
    getContextMessages: vi.fn(async () => [{ content: 'What is next?' }]),
    getTaskAgentProfile: vi.fn(async () => ({
      provider: 'test',
      model: 'test',
    })),
    generateText: vi.fn(async () => '["What is next?"]'),
  };
  const context = {
    getTaskContext: () => task,
    getProjectDir: () => project,
    triggerUIDataRefresh: vi.fn(),
    log: vi.fn(),
  } as unknown as ExtensionContext;
  const tool = extension.getTools()[0];
  const execute = (signal?: AbortSignal) => tool.execute(input, signal, context, {});
  const getData = async () =>
    (await extension.getUIExtensionData(component, context)) as {
      id: string;
      question: string;
      options: string[];
    } | null;
  return { extension, task, context, tool, execute, getData };
};

beforeEach(() => {
  storage.config = '';
});
afterEach(async () => {
  for (const extension of instances.splice(0)) {
    await extension.onUnload();
  }
});

describe('Questions extension tool', () => {
  it('registers a custom message renderer only for the ask_question extension tool', () => {
    const { extension } = setup();
    expect(extension.getUIComponents()).toContainEqual(
      expect.objectContaining({
        id: 'questions-ask-question-tool-message',
        placement: 'task-message',
        messageFilter: { types: ['tool'], serverName: 'extensions', toolName: 'ask_question' },
        jsx: expect.stringContaining('ExpandableMessageBlock'),
      }),
    );
  });

  it('renders in the input-above placement and returns the selected answer without starting a prompt', async () => {
    const { extension, execute, getData, context, task } = setup();
    expect(extension.getUIComponents()).toContainEqual(expect.objectContaining({ id: component, placement: 'task-input-above' }));
    const pending = execute();
    const data = await getData();
    expect(data).toMatchObject(input);
    expect(context.triggerUIDataRefresh).toHaveBeenCalledWith(component, 'task');
    await extension.executeUIExtensionAction(component, 'answer', [data!.id, 'Extend'], context);
    expect(await pending).toEqual({
      question: input.question,
      answer: 'Extend',
    });
    expect(await getData()).toBeNull();
    expect(task.runPrompt).not.toHaveBeenCalled();
  });

  it('ignores invalid answers and stale clicks, including clicks from a previous question', async () => {
    const { extension, execute, getData, context } = setup();
    const first = execute();
    const firstId = (await getData())!.id;
    expect(await extension.executeUIExtensionAction(component, 'answer', [firstId, 'Invalid'], context)).toMatchObject({ success: false });
    expect(await extension.executeUIExtensionAction(component, 'answer', ['stale', 'Extend'], context)).toMatchObject({ success: false });
    expect((await getData())!.id).toBe(firstId);
    await extension.executeUIExtensionAction(component, 'answer', [firstId, 'Extend'], context);
    await first;
    const second = execute();
    expect(await extension.executeUIExtensionAction(component, 'cancel', [firstId], context)).toMatchObject({ success: false });
    const secondId = (await getData())!.id;
    expect(secondId).not.toBe(firstId);
    await extension.executeUIExtensionAction(component, 'cancel', [secondId], context);
    expect(await second).toMatchObject({ cancelled: true });
  });

  it('rejects overlapping questions without replacing the active request', async () => {
    const { execute, getData } = setup();
    void execute();
    const id = (await getData())!.id;
    await expect(execute()).rejects.toThrow('already active');
    expect((await getData())!.id).toBe(id);
  });

  it('cancels on dismissal', async () => {
    const { extension, execute, getData, context } = setup();
    const pending = execute();
    await extension.executeUIExtensionAction(component, 'cancel', [(await getData())!.id], context);
    expect(await pending).toEqual({
      cancelled: true,
      reason: 'User dismissed the question',
    });
    expect(await getData()).toBeNull();
  });

  it('cleans up on abort and rejects already aborted executions', async () => {
    const { execute, getData } = setup();
    const controller = new AbortController();
    const pending = execute(controller.signal);
    controller.abort();
    expect(await pending).toEqual({
      cancelled: true,
      reason: 'Agent cancelled',
    });
    expect(await getData()).toBeNull();
    await expect(execute(controller.signal)).rejects.toThrow();
    expect(await getData()).toBeNull();
  });

  it.each(['onTaskClosed', 'onTaskDeleted'] as const)('cleans up on %s', async (method) => {
    const { extension, execute, getData, context } = setup();
    const pending = execute();
    await extension[method]({ task: { id: 'task' } } as TaskClosedEvent, context);
    expect(await pending).toMatchObject({ cancelled: true });
    expect(await getData()).toBeNull();
  });

  it('resolves pending requests on unload', async () => {
    const { extension, execute, getData } = setup();
    const pending = execute();
    await extension.onUnload();
    expect(await pending).toEqual({
      cancelled: true,
      reason: 'Extension unloaded',
    });
    expect(await getData()).toBeNull();
  });

  it('defaults tools on, persists the toggle, and rejects old tool references while disabled', async () => {
    const { extension, execute } = setup();
    expect(await extension.getConfigData()).toEqual({
      customModelId: '',
      toolsEnabled: true,
    });
    await extension.saveConfigData({ customModelId: 'provider/model' });
    await extension.saveConfigData({ toolsEnabled: false });
    expect(await extension.getConfigData()).toEqual({
      customModelId: 'provider/model',
      toolsEnabled: false,
    });
    expect(extension.getTools()).toEqual([]);
    expect(extension.getCommands()[0].name).toBe('questions');
    await expect(execute()).rejects.toThrow('disabled');
    await extension.saveConfigData({ toolsEnabled: true });
    expect(extension.getTools()[0].name).toBe('ask_question');
  });

  it('cancels an active question when tools are disabled', async () => {
    const { extension, execute } = setup();
    const pending = execute();
    await extension.saveConfigData({ toolsEnabled: false });
    expect(await pending).toEqual({
      cancelled: true,
      reason: 'Question tools disabled',
    });
  });

  it('isolates tasks and identical task IDs in different projects', async () => {
    const { extension, execute, context, getData } = setup();
    const other = setup('/other');
    const otherTask = setup('/project', 'second');
    const first = execute();
    const second = extension.getTools()[0].execute(input, undefined, other.context, {});
    const third = extension.getTools()[0].execute(input, undefined, otherTask.context, {});
    await extension.executeUIExtensionAction(component, 'cancel', [(await getData())!.id], context);
    expect(await first).toMatchObject({ cancelled: true });
    expect(await extension.getUIExtensionData(component, other.context)).toMatchObject(input);
    expect(await extension.getUIExtensionData(component, otherTask.context)).toMatchObject(input);
    await extension.onUnload();
    expect(await second).toMatchObject({ cancelled: true });
    expect(await third).toMatchObject({ cancelled: true });
  });

  it('keeps /questions free-form extraction and submission independent from the tool toggle', async () => {
    const { extension, context, task } = setup();
    await extension.saveConfigData({ toolsEnabled: false });
    await extension.getCommands()[0].execute([], context);
    const data = (await extension.getUIExtensionData('questions-questionnaire', context)) as { questions: { id: string; text: string }[] };
    expect(data.questions[0].text).toBe('What is next?');
    await extension.executeUIExtensionAction(
      'questions-questionnaire',
      'submit-answers',
      [
        data.questions.map((question) => ({
          ...question,
          answer: 'A free-form answer',
        })),
      ],
      context,
    );
    expect(task.runPrompt).toHaveBeenCalledWith(expect.stringContaining('A free-form answer'), 'agent');
  });

  it('prevents the command and tool from replacing each other', async () => {
    const { extension, execute, context, task, getData } = setup();
    void execute();
    await extension.getCommands()[0].execute([], context);
    expect(task.generateText).not.toHaveBeenCalled();
    await extension.executeUIExtensionAction(component, 'cancel', [(await getData())!.id], context);
    await extension.getCommands()[0].execute([], context);
    await expect(execute()).rejects.toThrow('already active');
  });

  it.each([
    { question: '', options: ['A', 'B'] },
    { question: 'Question', options: [] },
    { question: 'Question', options: ['A'] },
    { question: 'Question', options: ['A', ' '] },
    { question: 'Question', options: ['A', 'A'] },
  ])('validates the input: %j', async (invalid) => {
    const { tool, context } = setup();
    await expect(tool.execute(invalid, undefined, context, {})).rejects.toThrow();
  });

  it('rejects execution without a task', async () => {
    const { tool, context } = setup();
    const noTask = {
      ...context,
      getTaskContext: () => null,
    } as ExtensionContext;
    await expect(tool.execute(input, undefined, noTask, {})).rejects.toThrow('No active task');
  });
});
