import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiCompressionMiddleware } from '../api-compression';

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(apiCompressionMiddleware());

  // Mirrors the run-prompt SSE route: headers plus a first frame, then a later event.
  app.get('/api/stream', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': connected\n\n');
    const timer = setTimeout(() => {
      res.write('event: response-chunk\ndata: {"chunk":"done"}\n\n');
      res.end();
    }, 250);
    res.on('close', () => clearTimeout(timer));
  });

  app.get('/api/payload', (_req, res) => {
    res.json({ padding: 'x'.repeat(4096) });
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('api compression', () => {
  it('does not compress server-sent events and delivers frames as they are written', async () => {
    const response = await fetch(`${base}/api/stream`, { headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'gzip' } });
    expect(response.headers.get('content-encoding')).toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // A compressed body would be flushed only on end, so the opening frame and
    // the delayed event would arrive together in the first read.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe(': connected\n\n');

    let rest = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      rest += decoder.decode(value);
    }
    expect(rest).toContain('event: response-chunk');
  });

  it('still compresses large JSON payloads', async () => {
    const response = await fetch(`${base}/api/payload`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect((await response.json()).padding).toHaveLength(4096);
  });
});
