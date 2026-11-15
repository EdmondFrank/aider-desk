import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShutdownController } from '../shutdown';

import logger from '@/logger';

vi.mock('@/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('ShutdownController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks shutdown synchronously and shares cleanup and the deadline across callers', async () => {
    const controller = new ShutdownController();
    const pending = deferred();
    const cleanup = vi.fn(() => pending.promise);
    const exit = vi.fn();
    expect(controller.isShuttingDown).toBe(false);

    const first = controller.run(cleanup, exit);
    expect(controller.isShuttingDown).toBe(true);
    expect(controller.run(cleanup, exit)).toBe(first);
    await vi.advanceTimersByTimeAsync(4000);
    expect(controller.run(cleanup, exit)).toBe(first);
    await vi.advanceTimersByTimeAsync(6000);
    await first;

    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(controller.timedOut).toBe(true);
    pending.resolve();
  });

  it('clears timers after successful cleanup without forcing exit', async () => {
    const controller = new ShutdownController();
    const exit = vi.fn();
    await controller.run(async () => undefined, exit);
    expect(controller.isShuttingDown).toBe(true);
    expect(controller.timedOut).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports pending manager and task stages and excludes finished operations', async () => {
    const controller = new ShutdownController();
    const pending = deferred();
    const exit = vi.fn();
    const result = controller.run(async () => {
      await controller.track('finished', () => undefined);
      await controller.track('projectManager', () => controller.track('task.aiderKill', () => pending.promise, { baseDir: '/project', taskId: 'task-1' }));
    }, exit);

    await vi.advanceTimersByTimeAsync(5000);
    expect(logger.warn).toHaveBeenCalledWith('Application shutdown still pending', {
      pending: [
        expect.objectContaining({ operation: 'projectManager' }),
        expect.objectContaining({ operation: 'task.aiderKill', baseDir: '/project', taskId: 'task-1' }),
      ],
    });
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(logger.error).toHaveBeenCalledWith('Application shutdown timed out; forcing exit', {
      timeoutMs: 10_000,
      pending: [
        expect.objectContaining({ operation: 'projectManager' }),
        expect.objectContaining({ operation: 'task.aiderKill', baseDir: '/project', taskId: 'task-1' }),
      ],
    });
    expect(exit).toHaveBeenCalledOnce();
    pending.resolve();
  });

  it('logs rejected operations immediately while another operation is hung', async () => {
    const controller = new ShutdownController();
    const pending = deferred();
    const error = new Error('watcher close failed');
    const result = controller.run(async () => {
      await Promise.allSettled([
        controller.track(
          'watcher',
          () => {
            throw error;
          },
          { baseDir: '/project' },
        ),
        controller.track('hung', () => pending.promise),
      ]);
    }, vi.fn());

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith(
      'Error during cleanup:',
      expect.objectContaining({ operation: 'watcher', baseDir: '/project', error: error.message }),
    );
    pending.resolve();
    await result;
    expect(controller.timedOut).toBe(false);
  });

  it('clears timers if the cleanup rejects', async () => {
    const controller = new ShutdownController();
    const error = new Error('cleanup failed');
    await expect(
      controller.run(async () => {
        throw error;
      }, vi.fn()),
    ).rejects.toThrow(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
