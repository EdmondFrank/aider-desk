import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBunFetch, isMcpEndpoint, isProxyBypassed } from '../bun-fetch';

type InspectedInit = RequestInit & {
  proxy?: string;
  tls?: { rejectUnauthorized?: boolean; ca?: string[] | string };
};

const encode = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(value));

const streamingResponse = (source: UnderlyingSource<Uint8Array<ArrayBuffer>>): Response => new Response(new ReadableStream<Uint8Array<ArrayBuffer>>(source));

describe('isProxyBypassed', () => {
  it('always bypasses loopback', () => {
    expect(isProxyBypassed(new URL('http://127.0.0.1:9069/mcp'))).toBe(true);
    expect(isProxyBypassed(new URL('http://localhost:23456/api/settings'), '*')).toBe(true);
    expect(isProxyBypassed(new URL('http://[::1]:9069/mcp'))).toBe(true);
  });

  it('matches NO_PROXY domains, suffixes and ports', () => {
    expect(isProxyBypassed(new URL('https://api.example.com/v1'), 'example.com')).toBe(true);
    expect(isProxyBypassed(new URL('https://api.example.com/v1'), '.example.com')).toBe(true);
    expect(isProxyBypassed(new URL('https://api.example.com/v1'), 'other.com,example.com')).toBe(true);
    expect(isProxyBypassed(new URL('https://api.example.com/v1'), 'notexample.com')).toBe(false);
    expect(isProxyBypassed(new URL('http://10.0.0.5:9069/mcp'), '10.0.0.5:9069')).toBe(true);
    expect(isProxyBypassed(new URL('http://10.0.0.5:9069/mcp'), '10.0.0.5:1234')).toBe(false);
    expect(isProxyBypassed(new URL('https://api.example.com/v1'), '*')).toBe(true);
  });
});

describe('isMcpEndpoint', () => {
  it('recognizes hub, per-server and SSE paths', () => {
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/mcp-hub'))).toBe(true);
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/desktop/mcp'))).toBe(true);
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/desktop/mcp/'))).toBe(true);
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/mcp/session'))).toBe(true);
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/sse'))).toBe(true);
    expect(isMcpEndpoint(new URL('http://127.0.0.1:9069/openai/v1/chat/completions'))).toBe(false);
    expect(isMcpEndpoint(new URL('https://models.dev/api.json'))).toBe(false);
  });
});

describe('installBunFetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal('Bun', { version: 'test' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const install = (options: { streamIdleTimeoutMs?: number; responseHeadersTimeoutMs?: number } = {}) => {
    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response('ok')));
    vi.stubGlobal('fetch', mockFetch);

    const uninstall = installBunFetch(
      {
        getProxy: () => ({ url: 'http://127.0.0.1:7890', noProxy: 'localhost,10.0.0.5' }),
        getTlsPolicy: (origin) => (origin === 'https://llm.local' ? { rejectUnauthorized: false, ca: ['ca-pem'] } : undefined),
      },
      { streamIdleTimeoutMs: 0, responseHeadersTimeoutMs: 0, ...options },
    );

    return { mockFetch, uninstall };
  };

  it('leaves fetch untouched outside Bun', () => {
    vi.unstubAllGlobals();
    const before = globalThis.fetch;

    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined });

    expect(globalThis.fetch).toBe(before);
    expect(typeof uninstall).toBe('function');
  });

  it('applies the proxy to remote origins and bypasses loopback', async () => {
    const { mockFetch, uninstall } = install();

    await fetch('https://api.example.com/v1/models');
    await fetch('http://127.0.0.1:9069/mcp');

    const remoteInit = mockFetch.mock.calls[0][1] as InspectedInit;
    const localInit = mockFetch.mock.calls[1][1] as InspectedInit;

    expect(remoteInit.proxy).toBe('http://127.0.0.1:7890');
    expect(localInit.proxy).toBeUndefined();
    uninstall();
  });

  it('applies the registered TLS policy and lets a per-request override win', async () => {
    const { mockFetch, uninstall } = install();

    await fetch('https://llm.local/v1/models');
    await fetch('https://llm.local/v1/messages', { tls: { rejectUnauthorized: true } } as RequestInit);

    const policyInit = mockFetch.mock.calls[0][1] as InspectedInit;
    const overrideInit = mockFetch.mock.calls[1][1] as InspectedInit;

    expect(policyInit.tls).toEqual({ rejectUnauthorized: false, ca: ['ca-pem'] });
    expect(overrideInit.tls).toEqual({ rejectUnauthorized: true, ca: ['ca-pem'] });
    uninstall();
  });

  it('fails a stream that stops producing bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          streamingResponse({
            start(controller) {
              controller.enqueue(encode('first'));
            },
          }),
        ),
      ),
    );
    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined }, { streamIdleTimeoutMs: 30, responseHeadersTimeoutMs: 0 });

    const response = await fetch('http://127.0.0.1:1234/stream');
    const reader = response.body!.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    await expect(reader.read()).rejects.toThrow(/produced no data/);
    uninstall();
  });

  it('does not treat a silent MCP stream as stalled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          streamingResponse({
            start(controller) {
              controller.enqueue(encode('first'));
              setTimeout(() => {
                controller.enqueue(encode('later'));
                controller.close();
              }, 60);
            },
          }),
        ),
      ),
    );
    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined }, { streamIdleTimeoutMs: 20, responseHeadersTimeoutMs: 0 });

    const response = await fetch('http://127.0.0.1:9069/desktop/mcp');
    const reader = response.body!.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('later');
    uninstall();
  });

  it('cancels the upstream body when the consumer cancels', async () => {
    const upstreamCancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          streamingResponse({
            start(controller) {
              controller.enqueue(encode('chunk'));
            },
            cancel: upstreamCancel,
          }),
        ),
      ),
    );
    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined }, { streamIdleTimeoutMs: 0 });

    const response = await fetch('http://127.0.0.1:1234/stream');
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel('client gone');

    expect(upstreamCancel).toHaveBeenCalled();
    uninstall();
  });

  it('strips body-encoding headers and preserves status and custom headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('body', {
            status: 201,
            headers: { 'content-encoding': 'gzip', 'content-length': '999', 'x-test': 'yes' },
          }),
        ),
      ),
    );
    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined }, { streamIdleTimeoutMs: 0 });

    const response = await fetch('http://127.0.0.1:1234/resource');

    expect(response.status).toBe(201);
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('x-test')).toBe('yes');
    await response.text();
    uninstall();
  });

  it('surfaces a stalled response-header wait instead of hanging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      ),
    );
    const uninstall = installBunFetch({ getProxy: () => null, getTlsPolicy: () => undefined }, { streamIdleTimeoutMs: 0, responseHeadersTimeoutMs: 20 });

    await expect(fetch('https://slow.example.com')).rejects.toThrow(/did not receive response headers/);
    uninstall();
  });
});
