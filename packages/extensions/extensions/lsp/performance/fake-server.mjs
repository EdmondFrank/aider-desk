import { pathToFileURL } from 'node:url';

let buffer = Buffer.alloc(0);
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const diagnostic = {
  severity: 1,
  message: 'Benchmark error',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
};
const handle = (message) => {
  if (message.method === 'initialized' && process.env.LSP_FAKE_BLOCK_INPUT) {
    process.stdin.pause();
    setInterval(() => undefined, 1000);
  }
  if (message.method === 'exit') process.exit(0);
  if (message.id !== undefined) {
    if (process.env.LSP_FAKE_HANG === message.method) return;
    send({
      id: message.id,
      result: message.method === 'initialize' ? { capabilities: { textDocumentSync: 1 } } : null,
    });
  }
  if (message.method === 'textDocument/didOpen' || message.method === 'textDocument/didChange') {
    const document = message.params.textDocument;
    const text = document.text ?? message.params.contentChanges[0].text;
    if (text.includes('NO_PUBLICATION')) return;
    const publish = () =>
      send({
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: document.uri,
          ...(process.env.LSP_FAKE_VERSIONLESS ? {} : { version: document.version }),
          diagnostics: text.includes('ERROR') ? [diagnostic] : [],
        },
      });
    if (text.includes('STALE_VERSION')) {
      send({
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: document.uri,
          version: document.version - 1,
          diagnostics: [diagnostic],
        },
      });
    }
    setTimeout(publish, Number(process.env.LSP_FAKE_DELAY_MS ?? 5));
  }
  if (message.method === 'initialized' && process.env.LSP_FAKE_FLOOD) {
    for (let i = 0; i < Number(process.env.LSP_FAKE_FLOOD); i++) {
      send({
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: pathToFileURL(`/unopened/${i}.ts`).href,
          diagnostics: [diagnostic],
        },
      });
    }
  }
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const split = buffer.indexOf('\r\n\r\n');
    if (split === -1) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, split).toString())[1]);
    if (buffer.length < split + 4 + length) return;
    const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString());
    buffer = buffer.subarray(split + 4 + length);
    handle(message);
  }
});
