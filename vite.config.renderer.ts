import { resolve } from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Standalone renderer build (replaces the electron-vite `renderer` target) so the
// web UI can be served by the headless server without any Electron tooling.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'src/renderer/public'),
  // The lite fork has no Python/Aider connector, so the UI must not offer aider-backed modes.
  // Single source of truth: the same `AIDER_DESK_LITE` env var the server entry point sets.
  define: {
    __LITE_FORK__: JSON.stringify(process.env.AIDER_DESK_LITE === 'true'),
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
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
  },
});
