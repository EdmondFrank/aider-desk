import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

import { expect, it, vi } from 'vitest';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { ProviderProfile, SettingsData } from '@common/types';

vi.mock('@/utils', () => ({ getEffectiveEnvironmentVariable: vi.fn() }));
vi.mock('@/logger');

import { createOpencodeGoLlm, opencodeGoProviderStrategy } from '../opencode-go';

it('streams a live GLM-5.3 coding response with tool execution', async () => {
  const config = JSON.parse(await readFile(`${homedir()}/.config/aider-desk-dev/config.json`, 'utf8'));
  const profile = config.providers.find((entry: ProviderProfile) => entry.provider.name === 'opencode-go') as ProviderProfile;
  if (!profile) {
    throw new Error('No configured OpenCode Go provider');
  }
  const model = { id: 'glm-5.3', providerId: profile.id };
  const settings = config.settings as SettingsData;
  const discovery = await opencodeGoProviderStrategy.loadModels(profile, settings);
  console.log('Live model discovery:', JSON.stringify({ success: discovery.success, glm53Listed: discovery.models.some((entry) => entry.id === model.id) }));
  expect(discovery.success).toBe(true);
  expect(discovery.models.some((entry) => entry.id === model.id)).toBe(true);

  let toolExecuted = false;
  try {
    const result = streamText({
      model: createOpencodeGoLlm(profile, model, settings, process.cwd(), undefined, undefined, undefined, undefined, 'aiderdesk-glm53-live-smoke'),
      system:
        'You are a coding assistant reviewing a small TypeScript project. Use read_file before explaining a fix. Keep your final answer to one sentence. Do not modify files.',
      prompt: 'Review src/sum.ts using read_file and explain why sum(2, 3) is wrong and how to fix it.',
      tools: {
        read_file: tool({
          description: 'Read a file from the isolated test project.',
          inputSchema: z.object({ path: z.string() }),
          execute: async () => {
            toolExecuted = true;
            return 'export const sum = (a: number, b: number): number => a - b;';
          },
        }),
      },
      stopWhen: stepCountIs(3),
      maxOutputTokens: 2048,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90000),
    });
    let output = '';
    for await (const chunk of result.textStream) {
      output += chunk;
    }
    const usage = await result.totalUsage;
    console.log('Live GLM-5.3 result:', JSON.stringify({ output, toolExecuted, finishReason: await result.finishReason, usage }));
    expect(toolExecuted).toBe(true);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('+');
  } catch (error) {
    const safeError = error as { name?: string; statusCode?: number };
    throw new Error(`Live GLM-5.3 request failed: ${safeError.name || 'Error'}; HTTP status ${safeError.statusCode || 'unavailable'}`);
  }
}, 120000);
