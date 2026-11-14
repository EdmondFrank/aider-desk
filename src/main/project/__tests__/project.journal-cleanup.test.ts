import fs from 'fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, type TaskData } from '@common/types';

import { Project } from '../project';

import type { Dirent } from 'fs';

import { INTERNAL_TASK_ID } from '@/task';

vi.mock('@/logger');
vi.mock('@/project/migrations', () => ({ migrateSessionsToTasks: vi.fn() }));
vi.mock('fs/promises');

type ProjectInternals = {
  loadTasks: () => Promise<void>;
  prepareTask: (taskId: string) => Promise<void>;
};

const directory = (name: string): Dirent => ({ name, isDirectory: () => true }) as Dirent;

const createTask = (state?: DefaultTaskState) => ({
  taskId: 'task',
  task: { state },
  recoverDurableExecutions: vi.fn(async () => undefined),
  durabilityManager: { clear: vi.fn() },
});

describe('Project startup journal cleanup', () => {
  const cleanupAgentExecutions = vi.fn(() => 0);
  const prepareTask = vi.fn(async () => undefined);
  const metadata = new Map<string, Partial<TaskData>>();
  let internals: ProjectInternals;

  beforeEach(() => {
    vi.clearAllMocks();
    metadata.clear();
    const project: Project = Object.assign(Object.create(Project.prototype), {
      baseDir: '/project',
      tasks: new Map(),
      deferredTasks: new Map(),
      dataManager: { cleanupAgentExecutions },
      prepareInternalTask: vi.fn(async () => undefined),
      prepareTask,
    });
    internals = project as unknown as ProjectInternals;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const taskId = String(filePath).split('/').at(-2)!;
      return JSON.stringify(metadata.get(taskId) ?? {});
    });
    vi.mocked(fs.readdir).mockImplementation(async () => [...metadata.keys()].map(directory) as never);
  });

  it('retains only InProgress tasks, including archived ones, before preparing tasks', async () => {
    metadata.set('running', { state: DefaultTaskState.InProgress });
    metadata.set('archived-running', { state: DefaultTaskState.InProgress, archived: true });
    metadata.set('interrupted', { state: DefaultTaskState.Interrupted });
    metadata.set('archived-interrupted', { state: DefaultTaskState.Interrupted, archived: true });
    metadata.set('review', { state: DefaultTaskState.ReadyForReview });
    metadata.set('todo', { state: DefaultTaskState.Todo });
    metadata.set('done', { state: DefaultTaskState.Done });
    metadata.set('unspecified', {});
    metadata.set(INTERNAL_TASK_ID, {});

    await internals.loadTasks();

    expect(cleanupAgentExecutions).toHaveBeenCalledExactlyOnceWith('/project', ['running', 'archived-running']);
    expect(cleanupAgentExecutions.mock.invocationCallOrder[0]).toBeLessThan(prepareTask.mock.invocationCallOrder[0]);
    expect(prepareTask).toHaveBeenCalledWith('archived-running');
    expect(prepareTask).not.toHaveBeenCalledWith('archived-interrupted');
  });

  it('cleans all journals when no task folders remain', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(Object.assign(new Error('Missing tasks directory'), { code: 'ENOENT' }));

    await internals.loadTasks();

    expect(fs.access).toHaveBeenCalledWith('/project');
    expect(cleanupAgentExecutions).toHaveBeenCalledExactlyOnceWith('/project', []);
  });

  it('does not clean journals when the project directory is unavailable', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(Object.assign(new Error('Missing project'), { code: 'ENOENT' }));
    vi.mocked(fs.access).mockRejectedValue(Object.assign(new Error('Missing project'), { code: 'ENOENT' }));

    await internals.loadTasks();

    expect(cleanupAgentExecutions).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EIO', 'ENOTDIR'])('does not clean journals when task enumeration fails with %s', async (code) => {
    vi.mocked(fs.readdir).mockRejectedValue(Object.assign(new Error('Cannot enumerate tasks'), { code }));

    await internals.loadTasks();

    expect(cleanupAgentExecutions).not.toHaveBeenCalled();
    expect(prepareTask).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EIO', 'invalid-json'])('preserves journals when metadata cannot be read (%s)', async (code) => {
    metadata.set('unknown', {});
    if (code === 'invalid-json') {
      vi.mocked(fs.readFile).mockResolvedValue('invalid JSON');
    } else {
      vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('Cannot read settings'), { code }));
    }

    await internals.loadTasks();

    expect(cleanupAgentExecutions).toHaveBeenCalledExactlyOnceWith('/project', ['unknown']);
    expect(prepareTask).not.toHaveBeenCalled();
  });

  it('cleans journals for an existing task with missing settings and no recoverable state', async () => {
    metadata.set('unsaved', {});
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('Missing settings'), { code: 'ENOENT' }));

    await internals.loadTasks();

    expect(cleanupAgentExecutions).toHaveBeenCalledExactlyOnceWith('/project', []);
  });
});

describe('Project recovery state gating', () => {
  it('recovers only InProgress tasks and clears all other instantiated task journals', async () => {
    const running = createTask(DefaultTaskState.InProgress);
    const interrupted = createTask(DefaultTaskState.Interrupted);
    const archivedInterrupted = { ...createTask(DefaultTaskState.Interrupted), task: { state: DefaultTaskState.Interrupted, archived: true } };
    const done = createTask(DefaultTaskState.Done);
    const review = createTask(DefaultTaskState.ReadyForReview);
    const todo = createTask(DefaultTaskState.Todo);
    const unspecified = createTask();
    const project: Project = Object.assign(Object.create(Project.prototype), {
      baseDir: '/project',
      tasks: new Map([
        ['running', running],
        ['interrupted', interrupted],
        ['archived-interrupted', archivedInterrupted],
        ['done', done],
        ['review', review],
        ['todo', todo],
        ['unspecified', unspecified],
      ]),
      tasksLoadingPromise: Promise.resolve(),
      customCommandManager: { start: vi.fn(async () => undefined) },
      promptsManager: { watchProject: vi.fn(async () => undefined) },
      agentProfileManager: { initializeForProject: vi.fn(async () => undefined) },
      mcpConfigManager: { initializeForProject: vi.fn(async () => undefined) },
      extensionManager: { reloadProjectExtensions: vi.fn(async () => undefined), dispatchEvent: vi.fn(async () => undefined) },
      eventManager: { sendProjectStarted: vi.fn() },
      sendInputHistoryUpdatedEvent: vi.fn(async () => undefined),
    });

    await project.start();

    expect(running.recoverDurableExecutions).toHaveBeenCalledOnce();
    expect(running.durabilityManager.clear).not.toHaveBeenCalled();
    for (const task of [interrupted, archivedInterrupted, done, review, todo, unspecified]) {
      expect(task.recoverDurableExecutions).not.toHaveBeenCalled();
      expect(task.durabilityManager.clear).toHaveBeenCalledOnce();
    }
  });
});
