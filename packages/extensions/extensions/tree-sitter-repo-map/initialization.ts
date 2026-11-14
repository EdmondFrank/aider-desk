import path from 'path';

export enum InitializationStatus {
  Initializing = 'initializing',
  Ready = 'ready',
  Cancelled = 'cancelled',
  Error = 'error',
}

type Waiter = {
  taskId: string;
  release: (ready: boolean) => void;
};

type Job = {
  status: InitializationStatus;
  controller: AbortController;
  completion: Promise<boolean>;
  waiters: Set<Waiter>;
  backgroundTasks: Set<string>;
  completedAt?: number;
};

export class RepositoryInitialization {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly prepare: (root: string, excludes: string[], signal: AbortSignal) => Promise<unknown>,
    private readonly changed: (key: string) => void,
    private readonly failed: (error: unknown) => void,
  ) {}

  start(root: string, excludes: string[], retry = false): string {
    root = path.resolve(root);
    const key = JSON.stringify([root, [...excludes].sort()]);
    const existing = this.jobs.get(key);
    if (existing && (!retry || existing.status === InitializationStatus.Initializing || existing.status === InitializationStatus.Ready)) return key;
    const job: Job = {
      status: InitializationStatus.Initializing,
      controller: new AbortController(),
      completion: Promise.resolve(false),
      waiters: new Set(),
      backgroundTasks: new Set(),
    };
    if (this.jobs.size >= 32) {
      for (const [oldKey, oldJob] of this.jobs) {
        if (oldJob.status !== InitializationStatus.Initializing && !oldJob.waiters.size) {
          this.jobs.delete(oldKey);
          break;
        }
      }
    }
    this.jobs.set(key, job);
    job.completion = Promise.resolve()
      .then(() => this.prepare(root, excludes, job.controller.signal))
      .then(() => {
        if (job.controller.signal.aborted) return false;
        job.status = InitializationStatus.Ready;
        job.completedAt = Date.now();
        return true;
      })
      .catch((error: unknown) => {
        if (!job.controller.signal.aborted) {
          job.status = InitializationStatus.Error;
          this.failed(error);
        }
        return false;
      })
      .finally(() => {
        if (this.jobs.get(key) === job) this.changed(key);
      });
    this.changed(key);
    return key;
  }

  state(key: string, taskId: string) {
    const job = this.jobs.get(key);
    if (!job) return null;
    return {
      key,
      status: job.status,
      waiting: [...job.waiters].some((waiter) => waiter.taskId === taskId),
      background: job.backgroundTasks.has(taskId),
      completedAt: job.completedAt,
    };
  }

  async wait(key: string, taskId: string, signal?: AbortSignal): Promise<boolean> {
    const job = this.jobs.get(key);
    if (!job || signal?.aborted) return false;
    if (job.status !== InitializationStatus.Initializing) return job.status === InitializationStatus.Ready;
    job.backgroundTasks.delete(taskId);
    let waiter: Waiter | undefined;
    const released = new Promise<boolean>((resolve) => {
      waiter = { taskId, release: resolve };
      job.waiters.add(waiter);
    });
    const abort = () => waiter!.release(false);
    signal?.addEventListener('abort', abort, { once: true });
    this.changed(key);
    try {
      return await Promise.race([job.completion, released]);
    } finally {
      signal?.removeEventListener('abort', abort);
      job.waiters.delete(waiter!);
      this.changed(key);
    }
  }

  background(key: string, taskId: string): void {
    const job = this.jobs.get(key);
    if (!job) return;
    job.backgroundTasks.add(taskId);
    for (const waiter of job.waiters) {
      if (waiter.taskId === taskId) waiter.release(false);
    }
    this.changed(key);
  }

  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job || job.status !== InitializationStatus.Initializing) return;
    job.status = InitializationStatus.Cancelled;
    job.controller.abort();
    for (const waiter of job.waiters) waiter.release(false);
    this.changed(key);
  }

  closeTask(taskId: string): void {
    for (const job of this.jobs.values()) {
      job.backgroundTasks.delete(taskId);
      for (const waiter of job.waiters) {
        if (waiter.taskId === taskId) waiter.release(false);
      }
    }
  }

  dispose(): void {
    for (const key of this.jobs.keys()) this.cancel(key);
    this.jobs.clear();
  }
}
