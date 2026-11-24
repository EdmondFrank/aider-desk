/**
 * Preload/setup shim for runtimes without `zlib.createZstdDecompress` (added in Node 22.15 / 23.8;
 * Bun's `node:zlib` does not implement it either).
 *
 * `undici` 8.12+ calls `.bind()` on it at import time, so any process that loads `undici` dies with
 * "Cannot read properties of undefined (reading 'bind')" before any code runs. This stub only
 * satisfies that call site: actually decoding a `content-encoding: zstd` response fails loudly
 * instead of silently misbehaving.
 *
 * Loaded as a vitest setup file (see `vitest.config.*.ts`) and as a Bun preload before the lite
 * server entry point.
 */
const zlib = require('node:zlib');

if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = () => {
    throw new Error(`zstd decompression requires Node >= 22.19 / Bun with zstd support (running ${process.version})`);
  };
}