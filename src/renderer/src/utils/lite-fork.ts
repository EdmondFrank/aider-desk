// Injected as a build-time constant by the lite fork's renderer build (vite.config.renderer.ts).
// When absent (Electron build, tests), the app behaves like upstream.
export const isLiteFork = (): boolean => typeof __LITE_FORK__ !== 'undefined' && __LITE_FORK__;
