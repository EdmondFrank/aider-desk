import { resolve } from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { rendererStartupPlugin } from './scripts/renderer-startup-plugin';

// Standalone renderer build for the lite profile. Mirrors the `renderer` block of
// `electron.vite.config.ts` (startup loader, progress page, dev proxy) without any
// Electron tooling, so the web UI can be served by the headless server.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'src/renderer/public'),
  // Same relative base as the electron-vite renderer build: the startup plugin rewrites the
  // emitted index.html and expects `./assets/...` references.
  base: './',
  // The lite fork has no Python/Aider connector, so the UI must not offer aider-backed modes.
  // Single source of truth: the same `AIDER_DESK_LITE` env var the server entry point sets.
  define: {
    __LITE_FORK__: JSON.stringify(process.env.AIDER_DESK_LITE === 'true'),
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        progress: resolve(__dirname, 'src/renderer/progress.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['ghostty-web'],
    exclude: [],
  },
  plugins: [
    rendererStartupPlugin(),
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    tsconfigPaths({
      projects: [resolve(__dirname, 'tsconfig.web.json')],
    }),
  ],
  server: {
    host: '0.0.0.0',
    hmr: process.env.NO_HMR === 'true' ? false : undefined,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.AIDER_DESK_PORT || '23456'}`,
      },
      '/socket.io': {
        target: `http://127.0.0.1:${process.env.AIDER_DESK_PORT || '23456'}`,
        ws: true,
      },
    },
  },
});
