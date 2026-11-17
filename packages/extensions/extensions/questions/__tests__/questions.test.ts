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

const input = { question: 'Which approach?', options: ['Extend', 'Replace'] };
const instances: QuestionsExtension[] = [];

const setup = (project = '/project', id = 'task') => {
  const extension = new QuestionsExtension();
  instances.push(extension);
  const askResolvers: Array<(answer: string) => void> = [];
  const task = {
    data: { id },
    askQuestion: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          askResolvers.push(resolve);
        }),
    ),
    answerQuestion: vi.fn((answer: string, _userInput?: string) => {
      for (const resolve of askResolvers.splice(0)) {
        resolve(answer);
      }
      return Promise.resolve(true);
    }),
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
  const getQuestionnaireData = async () =>
    (await extension.getUIExtensionData('questions-questionnaire', context)) as {
      isActive: boolean;
      questions: { id: string; text: string }[];
    } | null;
  return { extension, task, context, tool, execute, getQuestionnaireData };
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
  it('registers a tool-message renderer only for the ask_question extension tool', () => {
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

  it('asks via the native flow and returns the selected option as the answer', async () => {
    const { task, execute } = setup();
    const pending = execute();
    expect(task.askQuestion).toHaveBeenCalledWith(
      input.question,
      expect.objectContaining({
        subject: 'Agent question',
        defaultAnswer: '1',
        answers: [
          { text: 'Extend', shortkey: '1' },
          { text: 'Replace', shortkey: '2' },
        ],
      }),
    );
    task.answerQuestion('2');
    await expect(pending).resolves.toEqual({ question: input.question, answer: 'Replace' });
  });

  it('returns the typed custom answer captured from the question-answered event', async () => {
    const { extension, task, execute, context } = setup();
    const pending = execute();
    await extension.onQuestionAnswered({ question: { text: input.question }, answer: 'n', userInput: 'Do both' } as never, context);
    task.answerQuestion('n', 'Do both');
    await expect(pending).resolves.toEqual({ question: input.question, answer: 'Do both' });
  });

  it('reports cancelled when the question resolves without an answer', async () => {
    const { task, execute } = setup();
    const pending = execute();
    task.answerQuestion('');
    await expect(pending).resolves.toEqual({ cancelled: true, reason: 'Question dismissed without an answer' });
  });

  it('rejects overlapping questions without replacing the active request', async () => {
    const { extension, execute, context } = setup();
    void execute();
    await expect(execute()).rejects.toThrow('already active');
    await expect(extension.getTools()[0].execute(input, undefined, context, {})).rejects.toThrow('already active');
  });

  it('blocks the tool while the /questions questionnaire is active', async () => {
    const { extension, execute, context } = setup();
    await extension.getCommands()[0].execute([], context);
    const data = await extension.getUIExtensionData('questions-questionnaire', context);
    expect(data).toMatchObject({ isActive: true, questions: [{ text: 'What is next?' }] });
    await expect(execute()).rejects.toThrow('already active');
  });

  it('cleans up on abort and rejects already aborted executions', async () => {
    const { task, execute } = setup();
    const controller = new AbortController();
    const pending = execute(controller.signal);
    controller.abort();
    expect(task.answerQuestion).toHaveBeenCalledWith('n');
    await expect(pending).resolves.toEqual({ cancelled: true, reason: 'Agent cancelled' });
    await expect(execute(controller.signal)).rejects.toThrow();
  });

  it.each(['onTaskClosed', 'onTaskDeleted'] as const)('releases the pending question on %s', async (method) => {
    const { extension, execute, context } = setup();
    const pending = execute();
    await extension[method]({ task: { id: 'task' } } as TaskClosedEvent, context);
    expect(await pending).toMatchObject({ cancelled: true });
  });

  it('resolves pending requests on unload', async () => {
    const { extension, execute } = setup();
    const pending = execute();
    await extension.onUnload();
    expect(await pending).toMatchObject({ cancelled: true });
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
    await expect(pending).resolves.toEqual({ cancelled: true, reason: 'Agent cancelled' });
  });

  it('isolates tasks and identical task IDs in different projects', async () => {
    const { extension, execute, context } = setup();
    const other = setup('/other');
    const otherTask = setup('/project', 'second');
    const first = execute();
    const second = extension.getTools()[0].execute(input, undefined, other.context, {});
    const third = extension.getTools()[0].execute(input, undefined, otherTask.context, {});
    await expect(execute()).rejects.toThrow('already active');
    await expect(extension.getTools()[0].execute(input, undefined, other.context, {})).rejects.toThrow('already active');
    await extension.onTaskClosed({ task: { id: 'task' } } as TaskClosedEvent, context);
    expect(await first).toMatchObject({ cancelled: true });
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
    const { extension, execute, context, task } = setup();
    void execute();
    await extension.getCommands()[0].execute([], context);
    expect(task.generateText).not.toHaveBeenCalled();
    await task.answerQuestion('1');
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
