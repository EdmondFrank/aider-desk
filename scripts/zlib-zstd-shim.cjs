/**
 * Preload for Node versions without `zlib.createZstdDecompress` (added in Node 22.15 / 23.8).
 *
 * `undici` 8.12+ (pinned 8.12.3 by AiderDesk 0.90.0) calls `.bind()` on it at import time, so on an
 * older Node every process that loads `undici` dies with "Cannot read properties of undefined
 * (reading 'bind')" before any code runs. This stub only satisfies that call site: actually decoding
 * a `content-encoding: zstd` response fails loudly instead of silently misbehaving.
 */
const zlib = require('node:zlib');

if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = () => {
    throw new Error(`zstd decompression requires Node >= 22.19 (running ${process.version})`);
  };
}