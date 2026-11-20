import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AutonomyMode, ContextCompactionType, DefaultTaskState, ModelModality } from '@common/types';

import { Agent } from '../agent';

import type { LanguageModelV4GenerateResult, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { AgentStepFinishedEvent } from '@common/extensions';
import type { TaskSettings } from '@common/types';
import type { Task } from '@/task';

import { createMockAgentProfile, createMockSettings } from '@/__tests__/mocks';
import logger from '@/logger';

vi.mock('@/logger');

const quotaError = () =>
  new APICallError({
    message: 'usage limit reached',
    statusCode: 429,
    url: 'https://example.test',
    requestBodyValues: {},
    isRetryable: false,
  });

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const textResponse = (text: string, providerMetadata?: Record<string, Record<string, string>>): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage,
  warnings: [],
  providerMetadata,
});

const modelStream = (...parts: LanguageModelV4StreamPart[]) => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  }),
});

const textStream = (text: string) =>
  modelStream(
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  );

const createHarness = ({
  streamingDisabled = false,
  primaryModel,
  backupModel,
  extraProviders = [],
  onAgentStepFinished,
  onAgentStarted,
  abortController,
  isSubagent = false,
}: {
  streamingDisabled?: boolean;
  primaryModel: MockLanguageModelV4;
  backupModel?: MockLanguageModelV4;
  extraProviders?: { id: string; name: string; disabled?: boolean; provider: { name: string } }[];
  onAgentStepFinished?: (event: AgentStepFinishedEvent) => Promise<Partial<AgentStepFinishedEvent> | void> | Partial<AgentStepFinishedEvent> | void;
  onAgentStarted?: (event: Record<string, unknown>) => Record<string, unknown> | void;
  abortController?: AbortController;
  isSubagent?: boolean;
}) => {
  const providers = [
    { id: 'primary', name: 'Primary', provider: { name: 'openai' } },
    { id: 'backup', name: 'Backup', provider: { name: 'anthropic' } },
    ...extraProviders,
  ];
  const createLlm = vi.fn(
    (
      provider: { id: string },
      modelName?: unknown,
      settings?: unknown,
      projectDir?: unknown,
      toolSet?: unknown,
      systemPrompt?: unknown,
      providerMetadata?: unknown,
    ) => {
      void [modelName, settings, projectDir, toolSet, systemPrompt, providerMetadata];
      return provider.id === 'backup' ? backupModel : primaryModel;
    },
  );
  const normalizeMessages = vi.fn((_provider, _model, messages) => messages);
  const getModelSettings = vi.fn((providerId: string, modelId: string) =>
    modelId === 'missing'
      ? undefined
      : {
          id: modelId,
          providerId,
          maxOutputTokens: providerId === 'backup' ? 2048 : 1024,
          temperature: providerId === 'backup' ? 0.2 : 0.7,
        },
  );
  const getCacheControl = vi.fn((provider: { id: string }) => (provider.id === 'backup' ? { anthropic: { cacheControl: { type: 'ephemeral' } } } : undefined));
  const getProviderOptions = vi.fn((provider: { id: string }) => ({ [provider.id]: { tag: provider.id } }));
  const getProviderParameters = vi.fn((provider: { id: string }) => ({ topP: provider.id === 'backup' ? 0.9 : 1 }));

  const modelManager = {
    getProviders: vi.fn(() => providers),
    getCacheControl,
    getProviderParameters,
    getProviderOptions,
    getModelSettings,
    createLlm,
    normalizeMessages,
    isStreamingDisabled: vi.fn(() => streamingDisabled),
    isToolCallStreamingDisabled: vi.fn(() => false),
    isRetryable: vi.fn(() => false),
    getUsageReport: vi.fn(() => ({ sentTokens: 1, receivedTokens: 1, messageCost: 0 })),
    getModelModalities: vi.fn(() => ({ input: new Set([ModelModality.Text]), output: new Set([ModelModality.Text]) })),
    getProviderModelInfo: vi.fn(() => undefined),
  };

  const stepFinishedEvents: AgentStepFinishedEvent[] = [];
  const extensionManager = {
    dispatchEvent: vi.fn(async (eventName: string, event: Record<string, unknown>) => {
      if (eventName === 'onAgentStarted' && onAgentStarted) {
        return { ...event, ...onAgentStarted(event) };
      }
      if (eventName === 'onAgentStepFinished') {
        const typedEvent = event as unknown as AgentStepFinishedEvent;
        stepFinishedEvents.push(typedEvent);
        if (onAgentStepFinished) {
          return { ...event, ...(await onAgentStepFinished(typedEvent)) };
        }
      }
      return event;
    }),
    getTools: vi.fn(() => []),
  };

  const agent = new Agent(
    {
      getUserId: vi.fn(() => 'user-1'),
      getSettings: vi.fn(() =>
        createMockSettings({
          taskSettings: {
            contextCompactingThreshold: { percentage: 0, tokens: 0 },
            contextCompactionType: ContextCompactionType.Compact,
          } as TaskSettings,
        }),
      ),
    } as never,
    { getProjectProfiles: vi.fn(() => []) } as never,
    { getMcpServerTools: vi.fn(async () => ({})) } as never,
    { getProjectServers: vi.fn(() => ({})), getMergedServers: vi.fn(() => ({})) } as never,
    modelManager as never,
    { captureAgentRun: vi.fn() } as never,
    { isMemoryEnabled: vi.fn(() => false), getMemoryEmbeddingProgress: vi.fn(() => ({ status: 'idle' })) } as never,
    { getSystemPrompt: vi.fn(async () => 'System prompt') } as never,
    extensionManager as never,
  );

  const task = {
    taskId: 'task-1',
    task: {
      id: 'task-1',
      name: 'Fallback test',
      state: DefaultTaskState.InProgress,
      autonomyMode: AutonomyMode.Autonomous,
      provider: 'primary',
      model: 'primary-model',
      lastAgentProviderMetadata: { primary: { sessionId: 'secret' } },
    },
    project: { baseDir: '/tmp/project' },
    getProjectDir: vi.fn(() => '/tmp/project'),
    getTaskDir: vi.fn(() => '/tmp/project'),
    getContextFiles: vi.fn(async () => []),
    getRepoMap: vi.fn(() => ''),
    addLogMessage: vi.fn(),
    updateTask: vi.fn(async () => undefined),
    processResponseMessage: vi.fn(async () => undefined),
    addToolMessage: vi.fn(),
    addContextMessage: vi.fn(async () => undefined),
    removeMessage: vi.fn(),
    sendToolApprovalRequest: vi.fn(),
    startToolInput: vi.fn(),
    processToolInputDelta: vi.fn(),
    finishToolInput: vi.fn(),
    resetContext: vi.fn(),
    updateTaskData: vi.fn(),
  } as unknown as Task;

  const profile = createMockAgentProfile({
    provider: 'primary',
    model: 'primary-model',
    isSubagent,
    useAiderTools: false,
    usePowerTools: false,
    useSubagents: false,
    useTaskTools: false,
    useMemoryTools: false,
    useSkillsTools: false,
    useTodoTools: false,
    useExtensionTools: false,
    enabledServers: [],
    includeContextFiles: false,
    includeRepoMap: false,
    maxIterations: 5,
    temperature: undefined,
    maxTokens: undefined,
  });

  const run = (tools: Record<string, unknown> = {}) => {
    const getAvailableTools = vi.spyOn(agent as unknown as { getAvailableTools: () => Promise<Record<string, unknown>> }, 'getAvailableTools');
    getAvailableTools.mockResolvedValue(tools);
    return {
      getAvailableTools,
      promise: agent.runAgent(task, profile, 'Solve it', 'agent', undefined, [], [], 'System prompt', true, abortController?.signal),
    };
  };

  return {
    agent,
    task,
    profile,
    modelManager,
    extensionManager,
    stepFinishedEvents,
    createLlm,
    normalizeMessages,
    getCacheControl,
    getProviderOptions,
    getProviderParameters,
    run,
  };
};

describe('Agent onAgentStepFinished continuation and model switching', () => {
  it('switches to a fallback model on streaming quota error without leaking primary metadata or headers', async () => {
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Fallback reply'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      onAgentStarted: (event) => ({
        modelCallSettings: {
          ...(event.modelCallSettings as Record<string, unknown>),
          headers: { 'x-primary-only': 'secret' },
        },
      }),
      onAgentStepFinished: (event) => {
        if (event.error) {
          return { continue: true, modelId: 'backup/fallback-model' };
        }
        return undefined;
      },
    });

    const { getAvailableTools, promise } = harness.run();
    const messages = await promise;

    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(harness.createLlm).toHaveBeenCalledTimes(2);
    expect(harness.createLlm.mock.calls[0][6]).toEqual({ primary: { sessionId: 'secret' } });
    expect(harness.createLlm.mock.calls[1][6]).toBeUndefined();
    expect(getAvailableTools).toHaveBeenCalledTimes(2);
    expect(harness.normalizeMessages).toHaveBeenCalledWith(expect.objectContaining({ id: 'backup' }), 'fallback-model', expect.any(Array));
    expect(harness.getCacheControl).toHaveBeenCalledWith(expect.objectContaining({ id: 'backup' }), 'fallback-model');
    expect(harness.getProviderOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'backup' }), 'fallback-model', undefined);
    expect(harness.getProviderParameters).toHaveBeenCalledWith(expect.objectContaining({ id: 'backup' }), 'fallback-model', undefined);
    expect(backupModel.doStreamCalls[0].headers?.['x-primary-only']).toBeUndefined();
    expect(harness.task.task.provider).toBe('primary');
    expect(harness.task.task.model).toBe('primary-model');
    expect(harness.task.addLogMessage).toHaveBeenCalledWith('warning', 'Model request failed. Continuing with Backup / fallback-model.', false, undefined);
    expect(harness.task.addLogMessage).not.toHaveBeenCalledWith('error', expect.anything(), expect.anything(), expect.anything());
  });

  it('switches on non-streaming (generateText) quota error and skips persisting fallback providerMetadata', async () => {
    const primaryModel = new MockLanguageModelV4({
      doGenerate: async () => {
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doGenerate: async () => textResponse('Backup generate reply', { backup: { id: 'should-not-persist' } }),
    });

    const harness = createHarness({
      streamingDisabled: true,
      primaryModel,
      backupModel,
      onAgentStepFinished: (event) => (event.error ? { continue: true, modelId: 'backup/fallback-model' } : undefined),
    });

    const { promise } = harness.run();
    const messages = await promise;

    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(backupModel.doGenerateCalls).toHaveLength(1);
    expect(harness.task.updateTask).not.toHaveBeenCalledWith(expect.objectContaining({ lastAgentProviderMetadata: expect.anything() }), false);
  });

  it('continues from a failed second step without replaying the completed first tool step', async () => {
    const toolExecute = vi.fn(async () => 'tool-output');
    let primaryCalls = 0;
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        primaryCalls++;
        if (primaryCalls === 1) {
          return modelStream(
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'demo---run', input: '{}' },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
          );
        }
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Finished after tool'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      onAgentStepFinished: (event) => {
        if (event.error && !event.hasOutput && !event.hasToolCalls) {
          return { continue: true, modelId: 'backup/fallback-model' };
        }
        return undefined;
      },
    });

    const { promise } = harness.run({
      'demo---run': {
        description: 'Run once',
        inputSchema: z.object({}),
        execute: toolExecute,
      },
    });
    await promise;

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(backupModel.doStreamCalls).toHaveLength(1);
    const errorEvent = harness.stepFinishedEvents.find((event) => event.error);
    expect(errorEvent?.hasOutput).toBe(false);
    expect(errorEvent?.hasToolCalls).toBe(false);
  });

  it('reports hasOutput=true when a stream fails after emitting text', async () => {
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Partial output' });
            controller.enqueue({ type: 'error', error: quotaError() });
            controller.close();
          },
        }),
      }),
    });

    const harness = createHarness({
      primaryModel,
    });

    const { promise } = harness.run();
    await promise;

    expect(harness.stepFinishedEvents).toHaveLength(1);
    expect(harness.stepFinishedEvents[0].error).toBeDefined();
    expect(harness.stepFinishedEvents[0].hasOutput).toBe(true);
    expect(harness.stepFinishedEvents[0].hasToolCalls).toBe(false);
    expect(harness.task.updateTask).toHaveBeenCalledWith({ state: DefaultTaskState.Interrupted });
  });

  it('reports hasToolCalls=true when a tool throws during non-streaming execution', async () => {
    const primaryModel = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'demo---fail', input: '{}' }],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      }),
    });

    const harness = createHarness({
      streamingDisabled: true,
      primaryModel,
    });

    const { promise } = harness.run({
      'demo---fail': {
        description: 'Fail during execution',
        inputSchema: z.object({}),
        execute: async () => {
          throw quotaError();
        },
      },
    });
    await promise;

    expect(harness.stepFinishedEvents[0]?.hasToolCalls).toBe(true);
  });

  it('falls back to normal error handling when the requested fallback provider is disabled', async () => {
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        throw quotaError();
      },
    });

    const harness = createHarness({
      primaryModel,
      extraProviders: [{ id: 'disabled-provider', name: 'Disabled', disabled: true, provider: { name: 'anthropic' } }],
      onAgentStepFinished: (event) => (event.error ? { continue: true, modelId: 'disabled-provider/model' } : undefined),
    });

    const { promise } = harness.run();
    await promise;

    expect(harness.createLlm).toHaveBeenCalledTimes(1);
    expect(harness.task.addLogMessage).toHaveBeenCalledWith('error', expect.stringContaining('usage limit reached'), false, undefined);
    expect(harness.task.updateTask).toHaveBeenCalledWith({ state: DefaultTaskState.Interrupted });
  });

  it('switches model for the next step on a non-error tool-calls step without requiring continue', async () => {
    const toolExecute = vi.fn(async () => 'done');
    const primaryModel = new MockLanguageModelV4({
      doStream: async () =>
        modelStream(
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'demo---step', input: '{}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ),
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Answered by backup'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      onAgentStepFinished: (event) => {
        if (event.providerId === 'primary' && event.finishReason === 'tool-calls') {
          return { modelId: 'backup/escalated-model' };
        }
        return undefined;
      },
    });

    const { promise } = harness.run({
      'demo---step': {
        description: 'Tool step',
        inputSchema: z.object({}),
        execute: toolExecute,
      },
    });
    await promise;

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(backupModel.doStreamCalls).toHaveLength(1);
    expect(harness.stepFinishedEvents.map((e) => e.providerId)).toEqual(['primary', 'backup']);
  });

  it('allows an extension to force continuation with a new model after a stop step, or stop early with continue=false', async () => {
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => textStream('First draft'),
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Reviewed final'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      onAgentStepFinished: (event) => {
        if (event.iterationCount === 1) {
          return { continue: true, modelId: 'backup/reviewer' };
        }
        return { continue: false };
      },
    });

    const { promise } = harness.run();
    const messages = await promise;

    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);
    expect(backupModel.doStreamCalls).toHaveLength(1);
  });

  it('does not continue if aborted during onAgentStepFinished', async () => {
    const abortController = new AbortController();
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Should not run'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      abortController,
      onAgentStepFinished: (event) => {
        if (event.error) {
          abortController.abort();
          return { continue: true, modelId: 'backup/fallback-model' };
        }
        return undefined;
      },
    });

    const { promise } = harness.run();
    await promise;

    expect(backupModel.doStreamCalls).toHaveLength(0);
    expect(harness.createLlm).toHaveBeenCalledTimes(1);
  });

  it('supports fallback for subagent runs', async () => {
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Subagent fallback reply'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      isSubagent: true,
      onAgentStepFinished: (event) => (event.error ? { continue: true, modelId: 'backup/fallback-model' } : undefined),
    });

    const { promise } = harness.run();
    const messages = await promise;

    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(backupModel.doStreamCalls).toHaveLength(1);
  });

  it('logs the underlying provider error and re-evaluates compaction for the switched model without advancing iterationCount', async () => {
    vi.mocked(logger.warn).mockClear();
    let primaryCall = 0;
    const primaryModel = new MockLanguageModelV4({
      doStream: async () => {
        primaryCall++;
        if (primaryCall === 1) {
          return modelStream(
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'demo---step', input: '{}' },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
          );
        }
        throw quotaError();
      },
    });
    const backupModel = new MockLanguageModelV4({
      doStream: async () => textStream('Compacted fallback reply'),
    });

    const harness = createHarness({
      primaryModel,
      backupModel,
      onAgentStepFinished: (event) => (event.error ? { continue: true, modelId: 'backup/small-context' } : undefined),
    });
    harness.profile.autoCompactThresholdPercentage = 80;
    harness.profile.autoCompactionType = ContextCompactionType.Smart;
    harness.modelManager.getUsageReport.mockReturnValue({ sentTokens: 5000, receivedTokens: 500, messageCost: 0 });
    harness.modelManager.getModelSettings.mockImplementation((providerId: string, modelId: string) => ({
      id: modelId,
      providerId,
      maxInputTokens: providerId === 'backup' ? 4000 : 100000,
      maxOutputTokens: 1024,
      temperature: 0.5,
    }));
    const smartCompactConversation = vi.fn(async (msgs) => msgs);
    (harness.task as unknown as { smartCompactConversation: typeof smartCompactConversation }).smartCompactConversation = smartCompactConversation;

    const { promise } = harness.run({
      'demo---step': {
        description: 'Tool step',
        inputSchema: z.object({}),
        execute: async () => 'done',
      },
    });
    await promise;

    expect(smartCompactConversation).toHaveBeenCalledTimes(1);
    expect(harness.extensionManager.dispatchEvent.mock.calls.filter(([name]) => name === 'onAgentStepStarted')).toHaveLength(2);
    expect(harness.stepFinishedEvents.map((e) => e.iterationCount)).toEqual([1, 2, 2]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Model step failed; continuing as requested by extension',
      expect.objectContaining({ providerId: 'backup', model: 'small-context', switchedModel: true }),
    );
  });
});
