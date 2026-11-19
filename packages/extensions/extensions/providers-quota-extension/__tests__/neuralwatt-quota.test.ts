import type { ExtensionContext, PromptFinishedEvent } from '@aiderdesk/extensions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProvidersQuotaExtension from '../index';

const context = {
  getProviders: () => [{ provider: { name: 'neuralwatt', apiKey: 'test-key' } }],
  triggerUIDataRefresh: vi.fn(),
} as unknown as ExtensionContext;

const balance = {
  credits_remaining_usd: 32.68,
  total_credits_usd: 52.34,
  accounting_method: 'energy',
};

const dailyFreeEnergy = {
  kwh_included: 0.15,
  kwh_used: 0.042,
  kwh_remaining: 0.108,
  reset_at: '2026-04-17T00:00:00Z',
  model_labels: ['DeepSeek-V4-Flash'],
};

const extension = new ProvidersQuotaExtension();

const getQuota = (response: Record<string, unknown>) => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ balance, ...response })));
  return extension.getUIExtensionData('providers-quota-indicator', context);
};

describe('Neuralwatt quota', () => {
  afterEach(async () => {
    await extension.onPromptFinished({} as PromptFinishedEvent, context);
    vi.unstubAllGlobals();
  });

  it('returns daily free energy with pay-as-you-go credits', async () => {
    const data = await getQuota({ subscription: null, daily_free_energy: dailyFreeEnergy });

    expect(data).toMatchObject({
      neuralwatt: { isSubscription: false, creditsRemaining: 32.68, dailyFreeEnergy },
    });
  });

  it('preserves exhausted daily free energy with subscription usage', async () => {
    const exhausted = { ...dailyFreeEnergy, kwh_used: 0.15, kwh_remaining: 0 };
    const data = await getQuota({
      subscription: { status: 'active', kwh_used: 14, kwh_included: 20 },
      daily_free_energy: exhausted,
    });

    expect(data).toMatchObject({
      neuralwatt: { isSubscription: true, kwhPercentage: 70, dailyFreeEnergy: exhausted },
    });
  });

  it.each([{}, { daily_free_energy: null }])('normalizes an unavailable allowance to null (%j)', async (response) => {
    const data = await getQuota({ subscription: null, ...response });

    expect(data).toMatchObject({ neuralwatt: { isSubscription: false, creditsRemaining: 32.68, dailyFreeEnergy: null } });
  });
});
