import * as path from 'path';
import { Worker } from 'worker_threads';

import { RepoMapOptions } from './types';

export type RepoMapRequest = {
  id: number;
  options: Omit<RepoMapOptions, 'signal'>;
};

export type RepoMapResponse = {
  id: number;
  output?: string;
  error?: string;
};

type Subscriber = {
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

type Job = RepoMapRequest & {
  key: string;
  subscribers: Set<Subscriber>;
};

export class RepoMapService {
  private worker: Worker | undefined;
  private active: Job | undefined;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private sequence = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: { cachePath?: string } = {}) {}

  getRepoMap(options: RepoMapOptions): Promise<string> {
    if (options.signal?.aborted) return Promise.reject(new Error('Repository map cancelled', { cause: options.signal.reason }));
    const root = path.resolve(options.root);
    const { signal, ...serializable } = options;
    const request = { ...serializable, root };
    const key = JSON.stringify([
      root,
      request.files,
      request.excludePatterns,
      request.maxLines,
      request.prepareOnly,
      [...(request.mentionedFiles ?? [])].sort(),
      [...(request.mentionedIdents ?? [])].sort(),
      [...(request.chatFiles ?? [])].sort(),
    ]);
    let job = this.jobs.get(key);
    if (!job) {
      if (this.jobs.size >= 64) return Promise.reject(new Error('Repository map queue is full'));
      job = {
        id: ++this.sequence,
        key,
        options: request,
        subscribers: new Set(),
      };
      this.jobs.set(key, job);
      this.queue.push(job);
    }
    const pending = job;
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        subscriber.cleanup();
        pending.subscribers.delete(subscriber);
        reject(new Error('Repository map cancelled', { cause: signal?.reason }));
        if (!pending.subscribers.size) {
          this.jobs.delete(pending.key);
          this.queue = this.queue.filter((queued) => queued !== pending);
          if (this.active === pending) {
            this.stopWorker();
            this.active = undefined;
          }
          this.schedule();
        }
      };
      const subscriber: Subscriber = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      pending.subscribers.add(subscriber);
      signal?.addEventListener('abort', abort, { once: true });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    clearTimeout(this.idleTimer);
    this.active = next;
    try {
      if (!this.worker) {
        const worker = new Worker(path.join(__dirname, 'repo-map-worker.js'), {
          workerData: this.options,
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        });
        this.worker = worker;
        worker.on('message', (response: RepoMapResponse) => {
          if (this.worker !== worker || this.active?.id !== response.id) return;
          this.finish(response);
        });
        worker.on('error', (error) => {
          if (this.worker !== worker) return;
          this.stopWorker();
          if (this.active) this.finish({ id: this.active.id, error: error.message });
        });
        worker.on('exit', (code) => {
          if (this.worker !== worker) return;
          this.worker = undefined;
          if (this.active)
            this.finish({
              id: this.active.id,
              error: `Repository map worker exited (${code})`,
            });
        });
      }
      this.worker.ref();
      this.worker.postMessage({
        id: next.id,
        options: next.options,
      } satisfies RepoMapRequest);
    } catch (error) {
      this.stopWorker();
      this.finish({ id: next.id, error: String(error) });
    }
  }

  private finish(response: RepoMapResponse): void {
    const job = this.active;
    if (!job) return;
    this.jobs.delete(job.key);
    this.active = undefined;
    for (const subscriber of job.subscribers) {
      subscriber.cleanup();
      if (response.error !== undefined) subscriber.reject(new Error(response.error));
      else subscriber.resolve(response.output ?? '');
    }
    this.worker?.unref();
    this.idleTimer = setTimeout(() => this.stopWorker(), 5 * 60 * 1000);
    this.idleTimer.unref();
    this.schedule();
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.stopWorker();
    for (const job of this.jobs.values()) {
      for (const subscriber of job.subscribers) {
        subscriber.cleanup();
        subscriber.reject(new Error('Repository map service disposed'));
      }
    }
    this.jobs.clear();
    this.queue = [];
    this.active = undefined;
  }
}
