import { describe, expect, it, vi } from 'vitest';

import { InitializationStatus, RepositoryInitialization } from '../initialization';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const setup = () => {
  const pending = deferred();
  const prepare = vi.fn((_root: string, _excludes: string[], signal: AbortSignal) => {
    signal.throwIfAborted();
    return pending.promise;
  });
  const changed = vi.fn();
  const failed = vi.fn();
  const initialization = new RepositoryInitialization(prepare, changed, failed);
  return { initialization, pending, prepare, changed, failed };
};

describe('repository initialization', () => {
  it('shares work for the same checkout and excludes but isolates worktrees', async () => {
    const { initialization, pending, prepare } = setup();
    const key = initialization.start('/repo', ['dist/**', 'build/**']);
    expect(initialization.start('/repo', ['build/**', 'dist/**'])).toBe(key);
    expect(initialization.start('/worktree', ['dist/**', 'build/**'])).not.toBe(key);
    expect(initialization.start('/repo', ['other/**'])).not.toBe(key);
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(3);
    pending.resolve();
    expect(await initialization.wait(key, 'task')).toBe(true);
    initialization.dispose();
  });

  it('backgrounding releases only this task and does not abort initialization', async () => {
    const { initialization, pending, prepare } = setup();
    const key = initialization.start('/repo', []);
    const first = initialization.wait(key, 'first');
    const second = initialization.wait(key, 'second');
    expect(initialization.state(key, 'first')?.waiting).toBe(true);
    initialization.background(key, 'first');
    expect(await first).toBe(false);
    expect(initialization.state(key, 'second')?.waiting).toBe(true);
    expect(prepare.mock.calls[0][2].aborted).toBe(false);
    pending.resolve();
    expect(await second).toBe(true);
    expect(initialization.state(key, 'first')?.status).toBe(InitializationStatus.Ready);
  });

  it('cancels shared initialization, releases all waiters and requires explicit retry', async () => {
    const { initialization, pending, prepare } = setup();
    const key = initialization.start('/repo', []);
    const first = initialization.wait(key, 'first');
    const second = initialization.wait(key, 'second');
    await Promise.resolve();
    initialization.cancel(key);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(prepare.mock.calls[0][2].aborted).toBe(true);
    initialization.start('/repo', []);
    expect(prepare).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.resolve();
    expect(await initialization.wait(key, 'third')).toBe(false);
    initialization.start('/repo', [], true);
    expect(await initialization.wait(key, 'third')).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('aborting an agent releases the wait without stopping prewarming', async () => {
    const { initialization, pending, prepare } = setup();
    const controller = new AbortController();
    const key = initialization.start('/repo', []);
    const waiting = initialization.wait(key, 'task', controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
    expect(prepare.mock.calls[0][2].aborted).toBe(false);
    pending.resolve();
    expect(await initialization.wait(key, 'next')).toBe(true);
  });

  it('closing a task releases its wait but preserves shared work', async () => {
    const { initialization, pending } = setup();
    const key = initialization.start('/repo', []);
    const first = initialization.wait(key, 'first');
    const second = initialization.wait(key, 'second');
    initialization.closeTask('first');
    expect(await first).toBe(false);
    pending.resolve();
    expect(await second).toBe(true);
  });

  it('handles failure without unhandled rejections and permits retry', async () => {
    const { initialization, pending, failed } = setup();
    const key = initialization.start('/repo', []);
    pending.reject(new Error('Worker failed'));
    expect(await initialization.wait(key, 'task')).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
    expect(initialization.state(key, 'task')?.status).toBe(InitializationStatus.Error);
  });

  it('disposal aborts pending work and releases all waiting tasks', async () => {
    const { initialization, prepare } = setup();
    const key = initialization.start('/repo', []);
    const waiting = initialization.wait(key, 'task');
    await Promise.resolve();
    initialization.dispose();
    expect(await waiting).toBe(false);
    expect(prepare.mock.calls[0][2].aborted).toBe(true);
    expect(initialization.state(key, 'task')).toBeNull();
  });
});
