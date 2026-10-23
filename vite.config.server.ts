import { resolve } from 'path';
import { builtinModules as builtins } from 'module';

import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

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
