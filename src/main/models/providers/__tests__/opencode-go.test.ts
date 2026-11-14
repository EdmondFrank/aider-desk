import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeGoProvider } from '@common/agent';
import { Model, ProviderProfile, SettingsData } from '@common/types';

const mockCreateOpenAI = vi.fn();
const mockOpenAiResponses = vi.fn();
const mockCreateAnthropic = vi.fn();
const mockAnthropicModel = vi.fn();
const mockCreateOpenAICompatible = vi.fn();
const mockCompatibleModel = vi.fn();
const mockCreateGoogle = vi.fn();
const mockGoogleModel = vi.fn();

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => {
    mockCreateOpenAI(...args);
    return { responses: mockOpenAiResponses };
  },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => {
    mockCreateAnthropic(...args);
    return mockAnthropicModel;
  },
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (...args: unknown[]) => {
    mockCreateOpenAICompatible(...args);
    return mockCompatibleModel;
  },
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogle: (...args: unknown[]) => {
    mockCreateGoogle(...args);
    return mockGoogleModel;
  },
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3' },
}));

vi.mock('@/logger');
vi.mock('@/utils', () => ({
  getEffectiveEnvironmentVariable: vi.fn(),
}));

import { createOpencodeGoLlm, getOpencodeGoAiderMapping, opencodeGoProviderStrategy } from '../opencode-go';

const profile: ProviderProfile = {
  id: 'opencode-go-profile',
  provider: {
    name: 'opencode-go',
    apiKey: 'test-api-key',
  } as OpenCodeGoProvider,
};

const settings = {} as SettingsData;

describe('createOpencodeGoLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes x-opencode-session header when sessionId is provided (openai-responses)', () => {
    const model: Model = { id: 'grok-4.5', providerId: 'opencode-go-profile' };
    createOpencodeGoLlm(profile, model, settings, '/project', undefined, undefined, undefined, undefined, 'test-session-123');

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        headers: {
          'User-Agent': 'AiderDesk/1.2.3',
          'x-opencode-session': 'test-session-123',
        },
      }),
    );
  });

  it('includes x-opencode-session header when sessionId is provided (anthropic)', () => {
    const model: Model = { id: 'minimax-m3', providerId: 'opencode-go-profile' };
    createOpencodeGoLlm(profile, model, settings, '/project', undefined, undefined, undefined, undefined, 'test-session-456');

    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        headers: {
          'User-Agent': 'AiderDesk/1.2.3',
          'x-opencode-session': 'test-session-456',
        },
      }),
    );
  });

  it('includes x-opencode-session header when sessionId is provided (openai-compatible)', () => {
    const model: Model = { id: 'other-model', providerId: 'opencode-go-profile' };
    createOpencodeGoLlm(profile, model, settings, '/project', undefined, undefined, undefined, undefined, 'test-session-789');

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        headers: {
          'User-Agent': 'AiderDesk/1.2.3',
          'x-opencode-session': 'test-session-789',
        },
      }),
    );
  });

  it('does NOT include x-opencode-session header when sessionId is not provided', () => {
    const model: Model = { id: 'grok-4.5', providerId: 'opencode-go-profile' };
    createOpencodeGoLlm(profile, model, settings, '/project');

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        headers: { 'User-Agent': 'AiderDesk/1.2.3' },
      }),
    );
    const calledHeaders = mockCreateOpenAI.mock.calls[0][0].headers;
    expect(calledHeaders).not.toHaveProperty('x-opencode-session');
  });

  it('preserves existing profile headers when adding x-opencode-session', () => {
    const profileWithHeaders: ProviderProfile = {
      ...profile,
      headers: {
        'User-Agent': 'AiderDesk/1.2.3',
        'custom-header': 'custom-value',
      },
    };
    const model: Model = { id: 'grok-4.5', providerId: 'opencode-go-profile' };
    createOpencodeGoLlm(profileWithHeaders, model, settings, '/project', undefined, undefined, undefined, undefined, 'session-abc');

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'User-Agent': 'AiderDesk/1.2.3',
          'custom-header': 'custom-value',
          'x-opencode-session': 'session-abc',
        },
      }),
    );
  });
});

describe('OpenCode Go model endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['grok-4.7', 'gpt-6-luna', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'])(
    'routes %s to OpenAI Responses',
    (modelId) => {
      createOpencodeGoLlm(profile, { id: modelId, providerId: profile.id }, settings, '/project');

      expect(mockCreateOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://opencode.ai/inference/go/openai/v1' }));
      expect(mockOpenAiResponses).toHaveBeenCalledWith(modelId);
    },
  );

  it.each(['claude-haiku-5-5', 'minimax-m3', 'minimax-m2.7', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'])('routes %s to Anthropic Messages', (modelId) => {
    createOpencodeGoLlm(profile, { id: modelId, providerId: profile.id }, settings, '/project');

    expect(mockCreateAnthropic).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://opencode.ai/inference/go/anthropic/v1' }));
    expect(mockAnthropicModel).toHaveBeenCalledWith(modelId);
  });

  it('routes Gemini to the Google endpoint with session and custom headers', () => {
    const model: Model = { id: 'gemini-4-argon', providerId: profile.id };
    createOpencodeGoLlm(
      { ...profile, headers: { 'custom-header': 'custom-value' } },
      model,
      settings,
      '/project',
      undefined,
      undefined,
      undefined,
      undefined,
      'google-session',
    );

    expect(mockCreateGoogle).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://opencode.ai/inference/go/google/v1beta',
        headers: {
          'User-Agent': 'AiderDesk/1.2.3',
          'custom-header': 'custom-value',
          'x-opencode-session': 'google-session',
        },
      }),
    );
    expect(mockGoogleModel).toHaveBeenCalledWith(model.id);
  });

  it.each([
    'minimax-m3.1-flash',
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'kimi-k3.1-pro',
    'kimi-k3',
    'kimi-k2.7-code',
    'longcat-2.0',
    'deepseek-v4.1-flash',
    'deepseek-v4-pro',
    'mimo-v2.6-flash',
    'mimo-v2.6-pro',
    'mimo-v2.5',
    'mimo-v2.5-pro',
    'hy4',
    'hy4-preview',
    'hy3',
    'step-5-preview',
    'beam-free',
    'iceman-contributor-free',
    'longcat-2.5-free',
    'unknown-model',
  ])('routes %s to Chat Completions', (modelId) => {
    createOpencodeGoLlm(profile, { id: modelId, providerId: profile.id }, settings, '/project');

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://opencode.ai/inference/go/openai/v1' }));
    expect(mockCompatibleModel).toHaveBeenCalledWith(modelId);
    expect(mockCreateAnthropic).not.toHaveBeenCalled();
  });

  it('loads models from the current discovery endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gemini-4-argon' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await opencodeGoProviderStrategy.loadModels(profile, settings);

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/inference/go/v1/models', {
      headers: {
        Authorization: `Bearer ${(profile.provider as OpenCodeGoProvider).apiKey}`,
        'User-Agent': 'AiderDesk/1.2.3',
      },
    });
    expect(result).toEqual({ success: true, models: [{ id: 'gemini-4-argon', providerId: profile.id }] });
  });

  it.each(['claude-haiku-5-5', 'qwen3.8-flash', 'minimax-m3'])('maps %s to the Anthropic Aider endpoint', (modelId) => {
    expect(getOpencodeGoAiderMapping(profile, modelId, settings, '/project')).toEqual({
      modelName: `anthropic/${modelId}`,
      environmentVariables: {
        ANTHROPIC_API_KEY: (profile.provider as OpenCodeGoProvider).apiKey,
        ANTHROPIC_BASE_URL: 'https://opencode.ai/inference/go/anthropic',
      },
    });
  });

  it.each(['minimax-m3.1-flash', 'gpt-6-luna', 'gemini-4-argon', 'glm-5.3'])('maps %s to the translated OpenAI Aider endpoint', (modelId) => {
    expect(getOpencodeGoAiderMapping(profile, modelId, settings, '/project')).toEqual({
      modelName: `openai/${modelId}`,
      environmentVariables: {
        OPENAI_API_KEY: (profile.provider as OpenCodeGoProvider).apiKey,
        OPENAI_API_BASE: 'https://opencode.ai/inference/go/openai/v1',
      },
    });
  });
});
