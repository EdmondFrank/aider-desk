/**
 * Tests for the lite fork's Aider guard in `Task.shouldStartAider`.
 *
 * The lite profile ships without the Python/Aider connector, so a task whose mode (or agent
 * profile) asks for Aider must be refused with a single explanation per project instead of
 * spawning a connector that does not exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  execWithShellPath: vi.fn(),
  getEnvironmentVariablesForAider: vi.fn().mockReturnValue({}),
  isDirectory: vi.fn().mockResolvedValue(false),
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
  // Mirrors `isLiteFork()` in src/main/constants.ts.
  isLiteFork: () => process.env.AIDER_DESK_LITE === 'true',
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
  EventManager: class {
    sendTaskUpdated = vi.fn();
    sendTaskCreated = vi.fn();
    sendTaskDeleted = vi.fn();
  },
}));

vi.mock('@/memory/memory-manager', () => ({
  MemoryManager: class {},
}));

vi.mock('@/git', () => ({
  GitManager: class {},
  GitError: class GitError extends Error {},
}));

vi.mock('@/custom-commands', () => ({
  CustomCommandManager: class {},
}));

vi.mock('@/store', () => ({
  Store: class {},
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

import { Task } from '../task';

describe('Task.shouldStartAider in the lite profile', () => {
  const mockProject = { baseDir: '/test/project', id: 'project-id', name: 'Test Project' };
  const originalLiteEnv = process.env.AIDER_DESK_LITE;

  const createTask = (baseDir = mockProject.baseDir, taskData: Record<string, unknown> = {}) =>
    new Task(
      { ...mockProject, baseDir } as any,
      'test-task-id',
      { getSettings: vi.fn(() => ({ language: 'en' })) } as any,
      {} as any,
      {} as any,
      {} as any,
      { getProfile: vi.fn(() => null) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { isInitialized: vi.fn(() => false) } as any,
      {} as any,
      { workingMode: 'local', name: 'Test task', ...taskData } as any,
    );

  const prepareTask = (mode: string, profile: Record<string, unknown> | null, baseDir?: string) => {
    const task = createTask(baseDir);
    vi.spyOn(task as any, 'getCurrentMode').mockReturnValue(mode);
    vi.spyOn(task as any, 'getTaskAgentProfile').mockResolvedValue(profile);
    const addLogMessage = vi.spyOn(task as any, 'addLogMessage').mockImplementation(() => undefined);
    return { task, addLogMessage };
  };

  const shouldStart = (task: Task) => (task as any).shouldStartAider() as Promise<boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalLiteEnv === undefined) {
      delete process.env.AIDER_DESK_LITE;
    } else {
      process.env.AIDER_DESK_LITE = originalLiteEnv;
    }
  });

  it('refuses an aider mode in the lite profile and explains it once', async () => {
    process.env.AIDER_DESK_LITE = 'true';
    const { task, addLogMessage } = prepareTask('code', null, '/test/lite-refuse');

    await expect(shouldStart(task)).resolves.toBe(false);

    expect(addLogMessage).toHaveBeenCalledTimes(1);
    expect(addLogMessage).toHaveBeenCalledWith('warning', expect.stringContaining('not available in the lite build'));
  });

  it('does not repeat the notice for a second task in the same project', async () => {
    process.env.AIDER_DESK_LITE = 'true';
    const first = prepareTask('code', null, '/test/lite-dedupe');
    const second = prepareTask('code', null, '/test/lite-dedupe');

    await expect(shouldStart(first.task)).resolves.toBe(false);
    await expect(shouldStart(second.task)).resolves.toBe(false);

    expect(first.addLogMessage).toHaveBeenCalledTimes(1);
    expect(second.addLogMessage).not.toHaveBeenCalled();
  });

  it('refuses agent profiles that ask for Aider tools even in agent mode', async () => {
    process.env.AIDER_DESK_LITE = 'true';
    const { task, addLogMessage } = prepareTask('agent', { id: 'profile-1', useAiderTools: true }, '/test/lite-tools');

    await expect(shouldStart(task)).resolves.toBe(false);
    expect(addLogMessage).toHaveBeenCalledTimes(1);
  });

  it('refuses agent profiles that ask for the repo map', async () => {
    process.env.AIDER_DESK_LITE = 'true';
    const { task } = prepareTask('agent', { id: 'profile-1', includeRepoMap: true }, '/test/lite-repomap');

    await expect(shouldStart(task)).resolves.toBe(false);
  });

  it('does not start Aider for a plain agent task in the lite profile, and stays quiet about it', async () => {
    process.env.AIDER_DESK_LITE = 'true';
    const { task, addLogMessage } = prepareTask('agent', { id: 'profile-1' }, '/test/lite-allow');

    await expect(shouldStart(task)).resolves.toBe(false);
    expect(addLogMessage).not.toHaveBeenCalled();
  });

  it('still starts Aider in the full build', async () => {
    process.env.AIDER_DESK_LITE = 'false';
    const { task, addLogMessage } = prepareTask('code', null, '/test/full-build');

    await expect(shouldStart(task)).resolves.toBe(true);
    expect(addLogMessage).not.toHaveBeenCalled();
  });

  it('still starts Aider for an agent profile that asks for Aider tools in the full build', async () => {
    process.env.AIDER_DESK_LITE = 'false';
    const { task } = prepareTask('agent', { id: 'profile-1', useAiderTools: true }, '/test/full-build-tools');

    await expect(shouldStart(task)).resolves.toBe(true);
  });

  describe('getCurrentMode in the lite profile', () => {
    it('reads a task persisted in an aider mode as agent', () => {
      process.env.AIDER_DESK_LITE = 'true';
      const task = createTask('/test/lite-mode', { currentMode: 'code' });

      expect((task as any).getCurrentMode()).toBe('agent');
    });

    it('keeps a non-aider mode', () => {
      process.env.AIDER_DESK_LITE = 'true';
      const task = createTask('/test/lite-mode-agent', { currentMode: 'agent' });

      expect((task as any).getCurrentMode()).toBe('agent');
    });

    it('keeps the aider mode in the full build', () => {
      process.env.AIDER_DESK_LITE = 'false';
      const task = createTask('/test/full-mode', { currentMode: 'architect' });

      expect((task as any).getCurrentMode()).toBe('architect');
    });
  });

  describe('restartAiderConnector in the lite profile', () => {
    it('does not start the connector and explains why', async () => {
      process.env.AIDER_DESK_LITE = 'true';
      const task = createTask('/test/lite-restart', { currentMode: 'agent' });
      const addLogMessage = vi.spyOn(task as any, 'addLogMessage').mockImplementation(() => undefined);
      const start = vi.spyOn((task as any).aiderManager, 'start').mockResolvedValue(undefined);

      await task.restartAiderConnector();

      expect(start).not.toHaveBeenCalled();
      expect(addLogMessage).toHaveBeenCalledWith('warning', expect.stringContaining('not available in the lite build'));
    });

    it('restarts the connector in the full build', async () => {
      process.env.AIDER_DESK_LITE = 'false';
      const task = createTask('/test/full-restart', { currentMode: 'agent' });
      const start = vi.spyOn((task as any).aiderManager, 'start').mockResolvedValue(undefined);

      await task.restartAiderConnector();

      expect(start).toHaveBeenCalledWith(true);
    });
  });
});
