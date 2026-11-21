import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, MessageRole, type TaskData } from '@common/types';

import { Task } from '../task';
import { ContextManager } from '../context-manager';

import { DurabilityManager } from '@/agent/durability/durability-manager';
import { Project } from '@/project/project';
import { createMockAgentProfile } from '@/__tests__/mocks';

vi.mock('@/logger');

const createJournal = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE journal (id TEXT PRIMARY KEY, json TEXT NOT NULL)');
  const storage = {
    getAgentExecutions: () =>
      db
        .prepare('SELECT json FROM journal')
        .all()
        .map((row) => String(row.json)),
    saveAgentExecution: (_project: string, _task: string, id: string, json: string) => {
      db.prepare('INSERT OR REPLACE INTO journal VALUES (?, ?)').run(id, json);
    },
    deleteAgentExecution: (_project: string, _task: string, id: string) => {
      db.prepare('DELETE FROM journal WHERE id = ?').run(id);
    },
  };
  const manager = new DurabilityManager(storage, '/repro', 'task');
  manager.begin({ promptContext: { id: 'root' }, profile: createMockAgentProfile(), mode: 'agent', contextMessages: [], contextFiles: [] });
  return { db, storage, manager };
};

describe('Recovery findings deterministic reproductions', () => {
  it.each([DefaultTaskState.Interrupted, DefaultTaskState.ReadyForReview, DefaultTaskState.Todo])(
    'F2 reproduction: backend can report running while task state is %s',
    async (state) => {
      const task: Task = Object.assign(Object.create(Task.prototype), {
        taskId: 'task',
        project: { baseDir: '/repro' },
        task: { state: DefaultTaskState.InProgress },
        agent: { isRunning: () => true },
        isCompacting: false,
        getCurrentMode: () => 'agent',
        extensionManager: { dispatchEvent: vi.fn(async (_name: string, event: Record<string, unknown>) => event) },
        eventManager: { sendTaskUpdated: vi.fn() },
        syncFileWatching: vi.fn(),
      });
      await task.updateTask({ state }, false);
      expect(task.isPromptRunning()).toBe(true);
      expect(task.task.state === DefaultTaskState.InProgress).toBe(false);
      console.log(
        JSON.stringify({
          finding: 'F2',
          fixture: 'public updateTask changes state while agent remains running',
          state,
          backendRunning: task.isPromptRunning(),
          rendererProcessing: task.task.state === DefaultTaskState.InProgress,
        }),
      );
    },
  );

  it.each([
    { running: true, customCommand: false },
    { running: false, customCommand: false },
    { running: true, customCommand: true },
    { running: false, customCommand: true },
  ])('interrupts active work before redoing a prompt (running=$running, customCommand=$customCommand)', async ({ running, customCommand }) => {
    const { db, manager } = createJournal();
    try {
      const messages = [
        { id: 'user', role: MessageRole.User, content: 'Original request' },
        { id: 'reply', role: MessageRole.Assistant, content: 'Partial answer' },
      ];
      const agent = { isRunning: vi.fn(() => running), interrupt: vi.fn() };
      const runCustomCommand = vi.fn(async () => {
        expect(agent.isRunning()).toBe(false);
        expect(messages).toEqual([]);
        expect(manager.getRecoverableRoots()).toEqual([]);
      });
      const task: Task = Object.assign(Object.create(Task.prototype), {
        project: { baseDir: '/repro' },
        taskId: 'task',
        task: { state: DefaultTaskState.Interrupted },
        agent,
        durabilityManager: manager,
        queuedPrompts: [],
        agentRunResolves: [],
        extensionManager: { dispatchEvent: vi.fn(async (_name: string, event: Record<string, unknown>) => event) },
        subagentAbortControllers: {},
        resolutionAbortControllers: {},
        findMessageConnectors: vi.fn(() => []),
        promptFinished: vi.fn(),
        cleanupChunkBuffers: vi.fn(),
        contextManager: Object.assign(Object.create(ContextManager.prototype) as ContextManager, {
          taskId: 'task',
          messages,
          loaded: true,
          autosave: vi.fn(),
        }),
        tryCustomCommand: vi.fn(() => (customCommand ? runCustomCommand() : undefined)),
        sendTaskMessageRemoved: vi.fn(),
        updateContextInfo: vi.fn(async () => undefined),
        eventManager: { sendQueuedPromptsUpdated: vi.fn() },
      });
      const clear = vi.spyOn(manager, 'clear');
      const runPrompt = vi.spyOn(task, 'runPrompt').mockImplementation(async () => {
        expect(agent.isRunning()).toBe(false);
        expect(messages).toEqual([]);
        expect(manager.getRecoverableRoots()).toEqual([]);
        return [];
      });
      const interrupt = vi.spyOn(task, 'interruptResponse');
      const wait = vi.spyOn(task, 'waitForCurrentAgentToFinish');
      const redo = task.redoUserPrompt('user', 'agent', 'Revised request');
      if (running) {
        await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
        expect(interrupt).toHaveBeenCalledOnce();
        expect(agent.interrupt).toHaveBeenCalledOnce();
        expect(clear).not.toHaveBeenCalled();
        expect(messages).toHaveLength(2);
        expect(runPrompt).not.toHaveBeenCalled();
        expect(runCustomCommand).not.toHaveBeenCalled();
        agent.isRunning.mockReturnValue(false);
        task['resolveAgentRunPromises']();
      }
      await redo;
      expect(interrupt).toHaveBeenCalledTimes(running ? 1 : 0);
      expect(wait).toHaveBeenCalledTimes(running ? 1 : 0);
      if (customCommand) {
        expect(runCustomCommand).toHaveBeenCalledOnce();
        expect(runPrompt).not.toHaveBeenCalled();
      } else {
        expect(runPrompt).toHaveBeenCalledExactlyOnceWith('Revised request', 'agent', false, 'user', true, undefined);
      }
      expect(task.hasQueuedPrompts()).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS count FROM journal').get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it.each([DefaultTaskState.Interrupted, DefaultTaskState.InProgress])('F4 reproduction: missing task folder with state %s', async (state) => {
    const { db, manager, storage } = createJournal();
    try {
      const task: Task = Object.assign(Object.create(Task.prototype), {
        project: { baseDir: '/repro' },
        taskId: 'task',
        task: { id: 'task', baseDir: '/repro', name: 'Repro', state } as TaskData,
        durabilityManager: manager,
        initialized: true,
        stopFileWatching: vi.fn(),
        extensionManager: { dispatchEvent: vi.fn(async (_name: string, event: Record<string, unknown>) => event) },
        subagentAbortControllers: {},
        resolutionAbortControllers: {},
        findMessageConnectors: vi.fn(() => []),
        agent: { isRunning: vi.fn().mockReturnValue(false), interrupt: vi.fn() },
        promptFinished: vi.fn(),
        cleanupChunkBuffers: vi.fn(),
        resolveAgentRunPromises: vi.fn(),
        aiderManager: { kill: vi.fn(async () => undefined) },
      });
      const close = vi.spyOn(task, 'close');
      const tasks = new Map([['task', task]]);
      const project: Project = Object.assign(Object.create(Project.prototype), {
        tasks,
        deferredTasks: new Map(),
        tasksLoadingPromise: Promise.resolve(),
        getTaskIdsFromDisk: vi.fn(async () => []),
        indexTaskMetadata: vi.fn(async () => undefined),
        removeTaskWorktree: vi.fn(async () => undefined),
        eventManager: { sendTaskDeleted: vi.fn() },
      });
      await project.reloadTasks();
      expect(tasks.has('task')).toBe(state === DefaultTaskState.InProgress);
      expect(close.mock.calls.length).toBe(state === DefaultTaskState.InProgress ? 0 : 1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM journal').get()?.count).toBe(1);
      expect(new DurabilityManager(storage, '/repro', 'task').getRecoverableRoots()).toHaveLength(1);
      console.log(
        JSON.stringify({
          finding: 'F4',
          state,
          diskTaskIds: [],
          taskRetained: tasks.has('task'),
          closeCalls: close.mock.calls,
          journalRows: 1,
          recoverableAfterReload: new DurabilityManager(storage, '/repro', 'task').getRecoverableRoots().length,
        }),
      );
    } finally {
      db.close();
    }
  });
});
