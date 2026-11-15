export const withDeadline = async <T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LSP operation timed out after ${timeoutMs}ms`)), timeoutMs);
        abort = () => reject(signal?.reason ?? new Error('LSP operation cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) {
      signal?.removeEventListener('abort', abort);
    }
  }
};
