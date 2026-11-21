import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState } from '@common/types';

import { Task } from '../task';

vi.mock('@/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{}'),
    stat: vi.fn().mockRejectedValue(new Error('File not found')),
    readdir: vi.fn().mockResolvedValue([]),
    rm: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  stat: vi.fn().mockRejectedValue(new Error('File not found')),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils', () => ({
  fileExists: vi.fn().mockResolvedValue(false),
  filterIgnoredFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/constants', () => ({
  PROBE_BINARY_PATH: '/probe',
  AIDER_DESK_TASKS_DIR: '.aider-desk/tasks',
  AIDER_DESK_DIR: '.aider-desk',
  AIDER_DESK_TODOS_FILE: 'todos.json',
  AIDER_DESK_RULES_DIR: 'rules',
  AIDER_DESK_PROJECT_RULES_DIR: '.aider-desk/rules',
  AIDER_DESK_GLOBAL_RULES_DIR: '/home/.aider-desk/rules',
  AIDER_DESK_COMMANDS_DIR: '.aider-desk/commands',
  AIDER_DESK_PROMPTS_DIR: '.aider-desk/prompts',
  AIDER_DESK_BUILTIN_PROMPTS_DIR: '/resources/prompts',
  AIDER_DESK_GLOBAL_PROMPTS_DIR: '/home/.aider-desk/prompts',
  AIDER_DESK_AGENTS_DIR: '.aider-desk/agents',
  AIDER_DESK_TMP_DIR: '.aider-desk/tmp',
  AIDER_DESK_WATCH_FILES_LOCK: '.aider-desk/watch-files.lock',
  WORKTREE_BRANCH_PREFIX: 'aider-desk/task/',
  AIDER_DESK_MEMORY_FILE: '/data/memory.db',
  LOGS_DIR: '/logs',
}));

vi.mock('@/agent', () => ({
  Agent: class {
    run = vi.fn();
    dispose = vi.fn();
  },
  McpManager: class {},
  AgentProfileManager: class {},
}));

vi.mock('@/task/aider-manager', () => ({
  AiderManager: class {
    start = vi.fn();
    stop = vi.fn();
    dispose = vi.fn();
    sendUpdateAiderModels = vi.fn();
  },
}));

vi.mock('@/prompts', () => ({
  PromptsManager: class {},
}));

vi.mock('@/data-manager', () => ({
  DataManager: class {},
}));

vi.mock('@/telemetry', () => ({
  TelemetryManager: class {},
}));

vi.mock('@/models', () => ({
  ModelManager: class {},
}));

vi.mock('@/events', () => ({
  EventManager: class {},
}));

vi.mock('@/memory/memory-manager', () => ({
  MemoryManager: class {},
}));

vi.mock('@/git', () => ({
  GitManager: class {},
}));

vi.mock('@/custom-commands', () => ({
  CustomCommandManager: class {},
}));

vi.mock('@/skills/skill-manager', () => ({
  SkillManager: class {
    getSkills = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('@/store', () => ({
  Store: class {},
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

describe('Task close interrupt guard', () => {
  const buildTask = (overrides: Record<string, unknown> = {}) => {
    const mocks = {
      interruptResponse: vi.fn().mockResolvedValue(undefined),
      dispatchEvent: vi.fn().mockResolvedValue({}),
      kill: vi.fn().mockResolvedValue(undefined),
      sendClearTask: vi.fn(),
      agentIsRunning: vi.fn().mockReturnValue(false),
    };
    const task = Object.assign(Object.create(Task.prototype), {
      taskId: 'close-task',
      task: { state: DefaultTaskState.Todo },
      project: { baseDir: '/project' },
      extensionManager: { dispatchEvent: mocks.dispatchEvent },
      eventManager: { sendClearTask: mocks.sendClearTask },
      fileWatchGeneration: 0,
      fileWatchHandle: null,
      initialized: true,
      currentPromptContext: null,
      currentQuestion: null,
      isCompacting: false,
      agent: { isRunning: mocks.agentIsRunning },
      worktreeSetupPromise: null,
      interruptResponse: mocks.interruptResponse,
      resolveAgentRunPromises: vi.fn(),
      cleanupChunkBuffers: vi.fn(),
      aiderManager: { kill: mocks.kill },
      ...overrides,
    });
    return { task: task as unknown as Task, mocks };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips interruptResponse for an idle task in a terminal state', async () => {
    const { task, mocks } = buildTask();

    await task.close(false, false);

    expect(mocks.interruptResponse).not.toHaveBeenCalled();
    expect(mocks.dispatchEvent).toHaveBeenCalledWith('onTaskClosed', expect.anything(), expect.anything(), task);
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it.each([
    ['prompt in flight', { currentPromptContext: { id: 'prompt-context' } }],
    ['agent running', { agent: { isRunning: () => true } }],
    ['task compacting', { isCompacting: true }],
    ['question pending', { currentQuestion: { text: 'Proceed?' } }],
    ['stale InProgress state', { task: { state: DefaultTaskState.InProgress } }],
  ])('runs interruptResponse when closing with %s', async (_label, overrides) => {
    const { task, mocks } = buildTask(overrides);

    await task.close(false, false);

    expect(mocks.interruptResponse).toHaveBeenCalledExactlyOnceWith(undefined, true);
  });
});
