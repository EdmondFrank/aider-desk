import { Model, ProviderProfile, SettingsData, TlsPolicyRegistrar } from '@common/types';
import { isOpenCodeGoProvider, LlmProvider, OpenCodeGoProvider } from '@common/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { app } from 'electron';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { omit } from 'lodash';

import { getDefaultModelInfo, getDefaultUsageReport } from './default';

import type { LanguageModel, ModelMessage, ToolSet } from 'ai';

import { AiderModelMapping, LlmProviderStrategy, LoadModelsResponse } from '@/models';
import { getEffectiveEnvironmentVariable } from '@/utils';

const ENDPOINT_BASE_URL = 'https://opencode.ai/inference/go';
const OPENAI_BASE_URL = `${ENDPOINT_BASE_URL}/openai/v1`;
const ANTHROPIC_BASE_URL = `${ENDPOINT_BASE_URL}/anthropic/v1`;
const GOOGLE_BASE_URL = `${ENDPOINT_BASE_URL}/google/v1beta`;

interface OpenCodeGoModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenCodeGoModelsResponse {
  object: string;
  data: OpenCodeGoModel[];
}

enum ModelEndpointType {
  OpenAIResponses = 'openai-responses',
  Anthropic = 'anthropic',
  Gemini = 'gemini',
  OpenAICompatible = 'openai-compatible',
}

const MODEL_ENDPOINT_TYPES: Record<string, ModelEndpointType> = {
  'minimax-m3': ModelEndpointType.Anthropic,
  'minimax-m2.7': ModelEndpointType.Anthropic,
  'minimax-m2.5': ModelEndpointType.Anthropic,
};

const getModelEndpointType = (modelId: string): ModelEndpointType => {
  if (MODEL_ENDPOINT_TYPES[modelId]) {
    return MODEL_ENDPOINT_TYPES[modelId];
  }
  if (modelId.startsWith('claude-') || modelId.startsWith('qwen')) {
    return ModelEndpointType.Anthropic;
  }
  if (modelId.startsWith('gemini-')) {
    return ModelEndpointType.Gemini;
  }
  if (modelId.startsWith('grok-') || modelId.startsWith('gpt-') || modelId.startsWith('muse-')) {
    return ModelEndpointType.OpenAIResponses;
  }
  return ModelEndpointType.OpenAICompatible;
};

const loadOpencodeGoModels = async (profile: ProviderProfile, settings: SettingsData): Promise<LoadModelsResponse> => {
  if (!isOpenCodeGoProvider(profile.provider)) {
    return { models: [], success: false };
  }

  const provider = profile.provider as OpenCodeGoProvider;
  const apiKey = provider.apiKey;
  const apiKeyEnv = getEffectiveEnvironmentVariable('OPENCODE_GO_API_KEY', settings);
  const effectiveApiKey = apiKey || apiKeyEnv?.value || '';

  if (!effectiveApiKey) {
    return { models: [], success: false };
  }

  try {
    const response = await fetch(`${ENDPOINT_BASE_URL}/v1/models`, {
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
        'User-Agent': `AiderDesk/${app.getVersion()}`,
      },
    });
    if (!response.ok) {
      const errorMsg = `OpenCode Go models API response failed: ${response.status} ${response.statusText} ${await response.text()}`;
      return { models: [], success: false, error: errorMsg };
    }

    const data = (await response.json()) as OpenCodeGoModelsResponse;
    const models =
      data.data?.map((model: OpenCodeGoModel) => {
        return {
          id: model.id,
          providerId: profile.id,
        } satisfies Model;
      }) || [];

    return { models, success: true };
  } catch (error) {
    const errorMsg = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unknown error loading OpenCode Go models';
    return { models: [], success: false, error: errorMsg };
  }
};

export const hasOpencodeGoEnvVars = (settings: SettingsData): boolean => {
  return !!getEffectiveEnvironmentVariable('OPENCODE_GO_API_KEY', settings, undefined)?.value;
};

export const getOpencodeGoAiderMapping = (provider: ProviderProfile, modelId: string, settings: SettingsData, projectDir: string): AiderModelMapping => {
  const opencodeGoProvider = provider.provider as OpenCodeGoProvider;
  const endpointType = getModelEndpointType(modelId);
  const envVars: Record<string, string> = {};
  const effectiveVar = getEffectiveEnvironmentVariable('OPENCODE_GO_API_KEY', settings, projectDir);
  const apiKey = opencodeGoProvider.apiKey || effectiveVar?.value;

  if (endpointType === ModelEndpointType.Anthropic) {
    if (apiKey) {
      envVars.ANTHROPIC_API_KEY = apiKey;
    }
    envVars.ANTHROPIC_BASE_URL = `${ENDPOINT_BASE_URL}/anthropic`;

    return {
      modelName: `anthropic/${modelId}`,
      environmentVariables: envVars,
    };
  }

  if (apiKey) {
    envVars.OPENAI_API_KEY = apiKey;
  }
  envVars.OPENAI_API_BASE = OPENAI_BASE_URL;

  return {
    modelName: `openai/${modelId}`,
    environmentVariables: envVars,
  };
};

// === LLM Creation Functions ===
export const createOpencodeGoLlm = (
  profile: ProviderProfile,
  model: Model,
  settings: SettingsData,
  projectDir: string,
  _toolSet?: ToolSet,
  _systemPrompt?: string,
  _providerMetadata?: unknown,
  _tlsRegistrar?: TlsPolicyRegistrar,
  sessionId?: string,
): LanguageModel => {
  const provider = profile.provider as OpenCodeGoProvider;
  let apiKey = provider.apiKey;

  if (!apiKey) {
    const effectiveVar = getEffectiveEnvironmentVariable('OPENCODE_GO_API_KEY', settings, projectDir);
    if (effectiveVar) {
      apiKey = effectiveVar.value;
    }
  }

  if (!apiKey) {
    throw new Error('OpenCode Go API key is required in Providers settings or Aider environment variables (OPENCODE_GO_API_KEY)');
  }

  const headers: Record<string, string> = {
    'User-Agent': `AiderDesk/${app.getVersion()}`,
    ...profile.headers,
    ...(sessionId ? { 'x-opencode-session': sessionId } : {}),
  };

  const modelId = model.id;
  const endpointType = getModelEndpointType(modelId);

  switch (endpointType) {
    case ModelEndpointType.OpenAIResponses: {
      const openai = createOpenAI({
        apiKey,
        baseURL: OPENAI_BASE_URL,
        headers,
      });
      return openai.responses(modelId);
    }
    case ModelEndpointType.Anthropic: {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        headers,
      });
      return anthropic(modelId);
    }
    case ModelEndpointType.Gemini: {
      const google = createGoogle({
        apiKey,
        baseURL: GOOGLE_BASE_URL,
        headers,
      });
      return google(modelId);
    }
    default: {
      const compatible = createOpenAICompatible({
        name: 'opencode-go',
        apiKey,
        baseURL: OPENAI_BASE_URL,
        headers,
      });
      return compatible(modelId);
    }
  }
};

// Grok's upstream rejects the `item_reference` input items that @ai-sdk/openai emits for
// Responses history parts carrying OpenAI item IDs. Stripping that metadata makes the SDK
// inline full content instead while keeping store (and thus caching behavior) at its default.
const normalizeOpencodeGoMessages = (llmProvider: LlmProvider, model: Model, messages: ModelMessage[]): ModelMessage[] => {
  if (!isOpenCodeGoProvider(llmProvider)) {
    return messages;
  }

  if (getModelEndpointType(model.id) !== ModelEndpointType.OpenAIResponses || !model.id.startsWith('grok')) {
    return messages;
  }

  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return message;
    }

    const content = message.content.map((part) => {
      const next = { ...part };
      if (next.providerMetadata) {
        next.providerMetadata = omit(next.providerMetadata, 'openai');
      }
      if (next.providerOptions) {
        next.providerOptions = omit(next.providerOptions, 'openai');
      }
      return next;
    });

    return { ...message, content } as typeof message;
  });
};

// === Complete Strategy Implementation ===
export const opencodeGoProviderStrategy: LlmProviderStrategy = {
  // Core LLM functions
  createLlm: createOpencodeGoLlm,
  getUsageReport: getDefaultUsageReport,

  // Model discovery functions
  loadModels: loadOpencodeGoModels,
  hasEnvVars: hasOpencodeGoEnvVars,
  getAiderMapping: getOpencodeGoAiderMapping,
  getModelInfo: getDefaultModelInfo,

  // Message normalization
  normalizeMessages: normalizeOpencodeGoMessages,
};
