import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, LogData, ResponseCompletedData, TaskData } from '@common/types';

import { TasksProvider } from '../TasksContext';

import { createMockApi } from '@/__tests__/mocks/api';
import { useApi } from '@/contexts/ApiContext';
import { useTaskActions } from '@/hooks/useTaskActions';
import { cleanupProcessingResponseMessage } from '@/hooks/useTaskResponseHandlers';
import { setMessages, updateTaskState, useTaskStore } from '@/stores/taskStore';

vi.mock('@/contexts/ApiContext', () => ({ useApi: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Thinking...' }) }));

const baseDir = '/thinking-reproduction';
const taskId = 'remote-task';
const task: TaskData = {
  id: taskId,
  baseDir,
  name: 'Task run from another client',
  state: DefaultTaskState.InProgress,
  mainModel: '',
  aiderTotalCost: 0,
  agentTotalCost: 0,
};

const response: ResponseCompletedData = {
  type: 'response-completed',
  baseDir,
  taskId,
  messageId: 'response-1',
  content: 'Finished response',
  timestamp: 1,
};

const messages = () => useTaskStore.getState().taskMessagesMap.get(taskId) || [];

const mountClient = (activeTaskId: string | null) =>
  render(
    <TasksProvider baseDir={baseDir} tasks={[task]} activeTaskId={activeTaskId}>
      <div />
    </TasksProvider>,
  );

describe('remote task completion: loading cleanup', () => {
  const api = createMockApi();
  let logListener: ((data: LogData) => void) | undefined;
  let responseListener: ((data: ResponseCompletedData) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue(api);
    useTaskStore.getState().unloadTask(taskId);
    setMessages(taskId, () => []);
    logListener = undefined;
    responseListener = undefined;
    api.addLogListener.mockImplementation((_baseDir, _taskId, callback) => {
      logListener = callback;
      return () => {
        logListener = undefined;
      };
    });
    api.addResponseCompletedListener.mockImplementation((_baseDir, _taskId, callback) => {
      responseListener = callback;
      return () => {
        responseListener = undefined;
      };
    });
    api.loadTask.mockResolvedValue({
      messages: [{ ...response, type: 'response-completed' }],
      files: [],
      todoItems: [],
      queuedPrompts: [],
      question: null,
      workingMode: 'local',
    });
  });

  afterEach(() => {
    cleanup();
    cleanupProcessingResponseMessage(taskId);
  });

  const sendFinalAgentStep = async () => {
    act(() => {
      responseListener?.(response);
      logListener?.({ baseDir, taskId, level: 'loading', timestamp: 2 });
    });
    await waitFor(() => expect(messages().some((message) => message.type === 'loading')).toBe(true));
  };

  it('clears Thinking when opening a previously unopened completed task', async () => {
    const client = mountClient(null);
    await sendFinalAgentStep();

    const completedTask = { ...task, state: DefaultTaskState.ReadyForReview };
    client.rerender(
      <TasksProvider baseDir={baseDir} tasks={[completedTask]} activeTaskId={null}>
        <div />
      </TasksProvider>,
    );
    expect(logListener).toBeUndefined();

    client.rerender(
      <TasksProvider baseDir={baseDir} tasks={[completedTask]} activeTaskId={taskId}>
        <div />
      </TasksProvider>,
    );
    const actions = renderHook(() => useTaskActions({ baseDir }));
    await act(async () => {
      await actions.result.current.loadTask(taskId);
    });

    expect(useTaskStore.getState().taskStateMap.get(taskId)?.loaded).toBe(true);
    expect(messages().find((message) => message.id === response.messageId)).toMatchObject({ finished: true });
    await waitFor(() => expect(messages().some((message) => message.type === 'loading')).toBe(false));
  });

  it.each([null, taskId])('clears Thinking for an already-loaded task with activeTaskId=%s', async (activeTaskId) => {
    updateTaskState(taskId, { loaded: true });
    const client = mountClient(activeTaskId);
    await sendFinalAgentStep();

    client.rerender(
      <TasksProvider baseDir={baseDir} tasks={[{ ...task, state: DefaultTaskState.ReadyForReview }]} activeTaskId={activeTaskId}>
        <div />
      </TasksProvider>,
    );

    expect(logListener).toBeDefined();
    await waitFor(() => expect(messages().some((message) => message.type === 'loading')).toBe(false));
  });

  it('clears pending loading messages even when completion arrives before the animation frame', async () => {
    const client = mountClient(null);

    act(() => {
      responseListener?.(response);
      logListener?.({ baseDir, taskId, level: 'loading', timestamp: 2 });
    });
    client.rerender(
      <TasksProvider baseDir={baseDir} tasks={[{ ...task, state: DefaultTaskState.ReadyForReview }]} activeTaskId={null}>
        <div />
      </TasksProvider>,
    );

    await waitFor(() => {
      expect(messages().find((message) => message.id === response.messageId)).toMatchObject({ finished: true });
      expect(messages().some((message) => message.type === 'loading')).toBe(false);
    });
  });
});
