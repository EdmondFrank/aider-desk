/// <reference types="vite/client" />

import { ApplicationAPI } from '@common/api';

declare global {
  interface Window {
    api: ApplicationAPI;
  }

  // Injected by vite.config.renderer.ts; true for the lite (headless, no-Python) build.
  const __LITE_FORK__: boolean;
}

export {};
