import { resolve } from 'path';
import { builtinModules as builtins } from 'module';

import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Fork: AIDER_DESK_PORT still wins; this only supplies the lite default so the
// web server does not clash with the upstream/Electron default (24337).
const LITE_PORT_BANNER = "'use strict';\nif (!process.env.AIDER_DESK_PORT) { process.env.AIDER_DESK_PORT = '23456'; }";

export default defineConfig({
  define: {
    'process.env.POSTHOG_PUBLIC_API_KEY': JSON.stringify(process.env.POSTHOG_PUBLIC_API_KEY ?? ''),
  },
  resolve: {
    // Fork: Bun does not implement the `node:sqlite` builtin, so route it to a shim
    // that uses `node:sqlite` on Node and falls back to `bun:sqlite` on Bun.
    alias: [{ find: 'node:sqlite', replacement: resolve(__dirname, 'src/main/fork/node-sqlite.cjs') }],
  },
  build: {
    outDir: 'out/server',
    lib: {
      entry: {
        runner: resolve(__dirname, 'src/main/server/runner.ts'),
        'runner-lite': resolve(__dirname, 'src/main/fork/runner-lite.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [...builtins, /^bun:/, '@homebridge/node-pty-prebuilt-multiarch', '@probelabs/probe', '@huggingface/transformers', '@lancedb/lancedb'],
      output: {
        entryFileNames: '[name].js',
        // Fork: default the lite server to its own port. This must run before the
        // shared chunk (which computes SERVER_PORT from the env at load), so it is
        // emitted as a banner rather than set from module code.
        banner: (chunk) => (chunk.name === 'runner-lite' ? LITE_PORT_BANNER : ''),
      },
    },
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
  },
  plugins: [
    tsconfigPaths({
      projects: [resolve(__dirname, 'tsconfig.server.json')],
    }),
  ],
});
