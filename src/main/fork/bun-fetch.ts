import logger from '@/logger';

/**
 * Bun's native `fetch` ignores `undici`'s global dispatcher, so the proxy and
 * TLS policies configured by `NetworkManager` never reach the wire in the lite
 * profile. This module wraps `globalThis.fetch` and applies those settings per
 * request (Bun supports `proxy` and `tls` in `RequestInit`), adds an inactivity
 * watchdog so a silently stalled upstream stream does not hang for half an
 * hour, and cancels the underlying body when the consumer walks away.
 *
 * The watchdog and deterministic cancellation mirror `Exhub.ProxyClient`:
 * long-lived LLM streams must not hold a connection open after the consumer is
 * gone, and a stream that stops producing bytes must surface as an error.
 */

export type BunTlsPolicy = {
  rejectUnauthorized?: false;
  ca?: string[];
};

export type BunProxyConfig = {
  url: string;
  noProxy?: string;
};

export type BunNetworkHooks = {
  getProxy: () => BunProxyConfig | null;
  getTlsPolicy: (origin: string) => BunTlsPolicy | undefined;
};

export type BunFetchOptions = {
  /** Abort a response body that produces no bytes for this long. 0 disables. */
  streamIdleTimeoutMs?: number;
  /** Abort a request that has not received response headers within this long. 0 disables. */
  responseHeadersTimeoutMs?: number;
};

type BunRequestInit = RequestInit & {
  proxy?: string;
  tls?: {
    rejectUnauthorized?: boolean;
    ca?: string | string[];
  };
};

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000;
// Generous enough for a long non-streaming completion, which sends no headers
// until the provider is done; streaming requests answer immediately.
const DEFAULT_RESPONSE_HEADERS_TIMEOUT_MS = 300_000;

let activeHooks: BunNetworkHooks | null = null;
let installedCleanup: (() => void) | null = null;

export const isBunRuntime = (): boolean => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

const isLoopback = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
};

const stripLeadingDot = (value: string): string => (value.startsWith('.') ? value.slice(1) : value);

/**
 * MCP `GET /mcp` streams are silent by design (the server only answers
 * notifications, with sparse keep-alive pings), so the LLM stream watchdog must
 * not treat them as stalled. Their own transport timeout covers real failures.
 */
export const isMcpEndpoint = (url: URL): boolean => {
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/mcp-hub' || path.endsWith('/mcp') || path.endsWith('/sse') || path.includes('/mcp/');
};

export const isProxyBypassed = (url: URL, noProxy?: string): boolean => {
  if (isLoopback(url.hostname)) {
    return true;
  }
  if (!noProxy) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const port = url.port;

  return noProxy
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .some((entry) => {
      if (entry === '*') {
        return true;
      }

      const [rawHost, rawPort] = entry.split(':');
      if (rawPort && rawPort !== port) {
        return false;
      }

      const bypassHost = stripLeadingDot(rawHost);
      return host === bypassHost || host.endsWith(`.${bypassHost}`);
    });
};

const resolveUrl = (input: RequestInfo | URL): URL | null => {
  try {
    if (input instanceof URL) {
      return input;
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
      return new URL(input.url);
    }
    return new URL(input.toString());
  } catch {
    return null;
  }
};

const callerSignal = (input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined => {
  if (init?.signal) {
    return init.signal;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.signal;
  }
  return undefined;
};

const applyNetworkOptions = (init: BunRequestInit, url: URL, hooks: BunNetworkHooks): BunRequestInit => {
  let next = init;

  const proxy = hooks.getProxy();
  if (proxy && next.proxy === undefined && !isProxyBypassed(url, proxy.noProxy)) {
    next = { ...next, proxy: proxy.url };
  }

  if (url.protocol === 'https:') {
    const policy = hooks.getTlsPolicy(url.origin);
    if (policy) {
      next = { ...next, tls: { ...policy, ...next.tls } };
    }
  }

  return next;
};

const copyResponseMetadata = (source: Response, target: Response): void => {
  for (const [key, value] of [
    ['url', source.url],
    ['redirected', source.redirected],
    ['type', source.type],
  ] as const) {
    try {
      Object.defineProperty(target, key, { value, configurable: true });
    } catch {
      // Non-fatal: consumers that need these fields are rare and can fall back to the raw values.
    }
  }
};

const withoutBodyHeaders = (headers: Headers): Headers => {
  const next = new Headers(headers);
  next.delete('content-encoding');
  next.delete('content-length');
  return next;
};

const wrapStream = (response: Response, abort: AbortController, idleTimeoutMs: number, detach: () => void): Response => {
  const body = response.body;
  if (!body) {
    detach();
    return response;
  }

  const reader = body.getReader();
  let finished = false;

  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };

  const finish = (): void => {
    if (!finished) {
      finished = true;
      abort.signal.removeEventListener('abort', onAbort);
      detach();
    }
  };

  if (abort.signal.aborted) {
    onAbort();
  } else {
    abort.signal.addEventListener('abort', onAbort, { once: true });
  }

  const monitored = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            if (idleTimeoutMs > 0) {
              timer = setTimeout(() => reject(new Error(`Upstream stream produced no data for ${idleTimeoutMs}ms`)), idleTimeoutMs);
            }
          }),
        ]);

        if (result.done) {
          finish();
          controller.close();
          return;
        }

        controller.enqueue(result.value);
      } catch (error) {
        finish();
        abort.abort();
        try {
          await reader.cancel(error);
        } catch {
          // The source is already gone.
        }
        controller.error(error);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
    async cancel(reason) {
      finish();
      abort.abort();
      try {
        await reader.cancel(reason);
      } catch {
        // The source is already gone.
      }
    },
  });

  const wrapped = new Response(monitored, {
    status: response.status,
    statusText: response.statusText,
    headers: withoutBodyHeaders(response.headers),
  });
  copyResponseMetadata(response, wrapped);
  return wrapped;
};

const createWrappedFetch = (original: typeof fetch, getHooks: () => BunNetworkHooks, options: Required<BunFetchOptions>): typeof fetch => {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    if (!url) {
      return original(input, init);
    }

    const hooks = getHooks();

    const abort = new AbortController();
    const signal = callerSignal(input, init);
    let forwardedAbort = false;

    const forwardAbort = (): void => {
      forwardedAbort = true;
      abort.abort();
    };

    if (signal) {
      if (signal.aborted) {
        forwardAbort();
      } else {
        signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }

    const detach = (): void => {
      signal?.removeEventListener('abort', forwardAbort);
    };

    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    if (options.responseHeadersTimeoutMs > 0) {
      headerTimer = setTimeout(forwardAbort, options.responseHeadersTimeoutMs);
    }

    try {
      const response = await original(input, {
        ...applyNetworkOptions((init ?? {}) as BunRequestInit, url, hooks),
        signal: abort.signal,
      });

      if (headerTimer) {
        clearTimeout(headerTimer);
        headerTimer = undefined;
      }

      if (response.body) {
        const idleTimeoutMs = isMcpEndpoint(url) ? 0 : options.streamIdleTimeoutMs;
        return wrapStream(response, abort, idleTimeoutMs, detach);
      }

      detach();
      return response;
    } catch (error) {
      if (headerTimer) {
        clearTimeout(headerTimer);
      }
      detach();
      if (forwardedAbort && error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request to ${url.origin} did not receive response headers within ${options.responseHeadersTimeoutMs}ms`, { cause: error });
      }
      throw error;
    }
  };

  const originalWithPreconnect = original as typeof fetch & { preconnect?: (url: string | URL) => void };
  if (typeof originalWithPreconnect.preconnect === 'function') {
    (wrapped as typeof fetch & { preconnect?: (url: string | URL) => void }).preconnect = originalWithPreconnect.preconnect.bind(original);
  }

  return wrapped;
};

export const installBunFetch = (hooks: BunNetworkHooks, options: BunFetchOptions = {}): (() => void) => {
  if (!isBunRuntime()) {
    return () => undefined;
  }

  // Re-install cleanly (tests, or a hot reload) instead of stacking wrappers.
  installedCleanup?.();

  activeHooks = hooks;

  const resolvedOptions: Required<BunFetchOptions> = {
    streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    responseHeadersTimeoutMs: options.responseHeadersTimeoutMs ?? DEFAULT_RESPONSE_HEADERS_TIMEOUT_MS,
  };

  const original = globalThis.fetch;
  const wrapped = createWrappedFetch(original, () => activeHooks ?? hooks, resolvedOptions);

  globalThis.fetch = wrapped;

  const uninstall = (): void => {
    if (globalThis.fetch === wrapped) {
      globalThis.fetch = original;
    }
    if (installedCleanup === uninstall) {
      installedCleanup = null;
    }
    activeHooks = null;
  };
  installedCleanup = uninstall;

  logger.info('[Network:bun] fetch wrapped', {
    streamIdleTimeoutMs: resolvedOptions.streamIdleTimeoutMs,
    responseHeadersTimeoutMs: resolvedOptions.responseHeadersTimeoutMs,
  });

  return uninstall;
};
