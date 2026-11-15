import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRendererRecoveryHandler } from '../renderer-recovery';

import { ShutdownController } from '@/shutdown';

vi.mock('@/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('renderer recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const shutdown = new ShutdownController();
    const reload = vi.fn();
    const recovery = createRendererRecoveryHandler({ reload, isUnavailable: () => shutdown.isShuttingDown });
    return { shutdown, reload, recovery };
  };

  it('recovers crashes and unresponsive renderers before shutdown', async () => {
    const { recovery, reload } = setup();
    recovery.onProcessGone({ reason: 'crashed', exitCode: 1 });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledOnce();
    recovery.onUnresponsive();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('suppresses crash and unresponsive recovery once shutdown begins', async () => {
    const { recovery, reload, shutdown } = setup();
    const pending = shutdown.run(async () => undefined, vi.fn());
    recovery.onProcessGone({ reason: 'crashed', exitCode: 1 });
    recovery.onUnresponsive();
    await pending;
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('suppresses a scheduled recovery if shutdown begins during its delay', async () => {
    const { recovery, reload, shutdown } = setup();
    recovery.onProcessGone({ reason: 'crashed', exitCode: 1 });
    await vi.advanceTimersByTimeAsync(500);
    await shutdown.run(async () => undefined, vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not recover destroyed windows or clean exits', async () => {
    const reload = vi.fn();
    const destroyed = createRendererRecoveryHandler({ reload, isUnavailable: () => true });
    destroyed.onProcessGone({ reason: 'crashed', exitCode: 1 });
    destroyed.onUnresponsive();
    createRendererRecoveryHandler({ reload, isUnavailable: () => false }).onProcessGone({ reason: 'clean-exit', exitCode: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('preserves crash-loop protection', async () => {
    const { recovery, reload } = setup();
    for (let i = 0; i < 6; i++) {
      recovery.onProcessGone({ reason: 'crashed', exitCode: 1 });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(reload).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(30_000);
    recovery.onProcessGone({ reason: 'crashed', exitCode: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(6);
  });
});
