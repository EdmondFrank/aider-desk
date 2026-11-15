import logger from '@/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

type CleanupDetails = Record<string, string>;

export class ShutdownController {
  private shutdownPromise?: Promise<void>;
  private startedAt?: number;
  private expired = false;
  private pending = new Map<symbol, { operation: string; startedAt: number; details: CleanupDetails }>();

  get isShuttingDown(): boolean {
    return this.startedAt !== undefined;
  }

  get timedOut(): boolean {
    return this.expired;
  }

  async track<T>(operation: string, run: () => T | Promise<T>, details: CleanupDetails = {}): Promise<T> {
    const id = Symbol(operation);
    const startedAt = performance.now();
    this.pending.set(id, { operation, startedAt, details });
    try {
      return await run();
    } catch (error) {
      logger.error('Error during cleanup:', {
        operation,
        ...details,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      this.pending.delete(id);
    }
  }

  private getPending() {
    const now = performance.now();
    return Array.from(this.pending.values(), ({ operation, startedAt, details }) => ({
      operation,
      ...details,
      durationMs: Math.round(now - startedAt),
    }));
  }

  run(cleanup: () => Promise<void>, forceExit: () => void): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.startedAt = performance.now();
    logger.info('Starting application shutdown', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    let deadline: ReturnType<typeof setTimeout>;
    const warning = setTimeout(() => {
      logger.warn('Application shutdown still pending', { pending: this.getPending() });
    }, SHUTDOWN_TIMEOUT_MS / 2);
    const timeout = new Promise<void>((resolve) => {
      deadline = setTimeout(() => {
        this.expired = true;
        logger.error('Application shutdown timed out; forcing exit', {
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
          pending: this.getPending(),
        });
        forceExit();
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
    });

    this.shutdownPromise = Promise.race([Promise.resolve().then(cleanup), timeout]).finally(() => {
      clearTimeout(deadline);
      clearTimeout(warning);
      if (!this.expired) {
        logger.info('Application shutdown finished', { durationMs: Math.round(performance.now() - this.startedAt!) });
      }
    });
    return this.shutdownPromise;
  }
}

export const shutdown = new ShutdownController();
