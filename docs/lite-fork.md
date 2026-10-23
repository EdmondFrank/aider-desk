# AiderDesk Lite Fork

This fork turns AiderDesk into a **lean, headless web server** that runs directly on
[Bun](https://bun.sh) (or Node) — no Electron, no Python/Aider bootstrap, and a much
smaller memory/CPU footprint with near-instant startup.

It is designed to keep **upstream sync cheap**: almost everything new lives in
`src/main/fork/`, and the changes to shared upstream files are small and isolated.

---

## Quick start

```bash
# Prerequisite: Bun >= 1.3 available as `bun` (see Requirements)
ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install   # skip the ~200MB Electron binary
npm run build:lite                            # builds renderer + server bundles
npm run start:lite                            # -> http://localhost:24337
```

Open <http://localhost:24337> in a browser.

Prefer Node? `npm run start:lite:node` (Node's native `node:sqlite` is used).

---

## Requirements

| Requirement | Why |
| --- | --- |
| **Bun ≥ 1.3** | Bun 1.2.0 (e.g. some Homebrew builds) **segfaults** on this bundle. Check with `bun --version`; the official installer (`~/.bun/bin/bun`) is fine. |
| `--conditions=module-sync` | Bun cannot `require()` ESM-only packages that only export a `module-sync` condition (e.g. `file-type`). Already baked into `start:lite`. |
| Node ≥ 22.5 (optional) | Node path needs `node:sqlite` (shipped natively; experimental). |

---

## What changed

### New files (no upstream conflict)

| File | Purpose |
| --- | --- |
| `src/main/fork/runner-lite.ts` | The lean server entry point. Identical to upstream `src/main/server/runner.ts` except it **never bootstraps Python/Aider** and disables the memory/embeddings subsystem. |
| `src/main/fork/node-sqlite.cjs` | Runtime shim for the `node:sqlite` builtin: uses `node:sqlite` on Node, `bun:sqlite` on Bun. Aliased in the server vite config. |
| `vite.config.renderer.ts` | Standalone renderer build (replaces `electron-vite`) so the SPA can be served without any Electron tooling. |
| `docs/lite-fork.md` | This document. |

### Modified files (small, isolated — review on upstream merge)

| File | Change |
| --- | --- |
| `package.json` | Added `build:renderer`, `build:lite`, `start:lite`, `start:lite:node`; `prebuild:server` now runs the standalone renderer build instead of `electron-vite build`; trimmed `postinstall` to drop the Electron-only steps. |
| `vite.config.server.ts` | Aliases `node:sqlite` to the shim, marks `/^bun:/` external, and emits **two** entries (`runner` and `runner-lite`). |
| `src/main/telemetry/telemetry-manager.ts` | Only loads OpenTelemetry/PostHog when telemetry is enabled **and** a PostHog key is configured (upstream loaded OpenTelemetry unconditionally). |
| `src/main/terminal/terminal-manager.ts` | `@homebridge/node-pty-prebuilt-multiarch` is now lazily imported on first terminal use, so the native module is never loaded when unused. |

**No upstream files are deleted.**

---

## Architecture

```
src/main/server/runner.ts   (upstream)  ─┐
                                          ├─ vite.config.server.ts ─▶ out/server/runner.js
src/main/fork/runner-lite.ts (this fork) ─┘                          out/server/runner-lite.js
```

- Both entries call the same `initManagers(store)` and share the whole app.
- `runner-lite` skips `performStartUp()` (the uv/venv/`pip install aider-chat` bootstrap)
  and forces `settings.memory.enabled = false`.
- The HTTP layer is unchanged: `ServerController` serves the built SPA, REST API
  (`/api/*`) and the socket.io event bridge that the browser UI relies on
  (`ConnectorManager`). That bridge is kept even though the Python *Aider connector*
  is gone — it is the web UI's real-time channel.

### Enabled vs disabled in the lite profile

| Enabled (kept) | Disabled / avoided |
| --- | --- |
| Agent mode (the default task mode) | Python / `aider-chat` + connector bootstrap |
| MCP servers | Memory embeddings (LanceDB + ONNX) |
| Extensions | OpenTelemetry / PostHog telemetry |
| Git integration, worktrees | Electron auto-updater / version polling |
| socket.io event bridge | Cloudflare tunnel (lazy — only if started) |
| Terminal (native module lazily loaded) | `node-pty` at startup |

---

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `AIDER_DESK_PORT` | `24337` | HTTP port. |
| `AIDER_DESK_DATA_DIR` | app data dir | Where settings, DBs and logs live. |
| `AIDER_DESK_PROJECTS` | – | Comma-separated project paths to open at startup. |
| `AIDER_DESK_MEMORY_ENABLED` | `false` (lite) | Set to `true` to re-enable memory embeddings. |
| `AIDER_DESK_USERNAME` / `AIDER_DESK_PASSWORD` | – | Enable HTTP Basic Auth. |
| `AIDER_DESK_READONLY` | `false` | Read-only mode (requires `AIDER_DESK_PROJECTS`). |

`AIDER_DESK_HEADLESS=true` is forced by the lite entry.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run build:renderer` | Build the SPA into `out/renderer`. |
| `npm run build:server` | Build `out/server/runner.js` + `out/server/runner-lite.js` and copy `resources/`. |
| `npm run build:lite` | `build:renderer` + `build:server`. |
| `npm run start:lite` | Run the lite server with Bun. |
| `npm run start:lite:node` | Run the lite server with Node. |
| `npm run start:server` | (Upstream) run `out/server/runner.js` — still tries to bootstrap Python/Aider. |

---

## Measured results (macOS arm64)

| Metric | Value |
| --- | --- |
| Process start → HTTP ready | ~1.2–1.5 s |
| App bring-up after entry runs | **~88 ms** |
| Memory footprint — Bun | **~407 MB** (Node: ~643 MB) |
| Idle CPU | ~0.2% |
| Bare Bun baseline | ~22 MB |

Most of the residual memory is the eagerly-loaded AI-provider SDK graph (~135 MB by
itself). See *Optional next steps*.

---

## Upstream sync guide

1. Work on a dedicated branch and keep `git config rerere.enabled true` so repeated
   conflict resolutions are remembered.
2. Merge `origin/main` periodically. Conflicts are expected in **at most** the four
   modified files above plus `package.json` — everything else is additive.
3. Generated/ignored artefacts are already in `.gitignore`
   (`out/`, `node_modules/`, `resources/*/probe*`, `packages/extensions/extensions.d.ts`) —
   do not commit them.
4. To temporarily remove the fork behaviour, build/run upstream instead:
   `npm run build:server && npm run start:server`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find package 'file-type'` | Run with `--conditions=module-sync` (use `npm run start:lite`). |
| Bun crashes with a segmentation fault right after startup | Bun is 1.2.0 — upgrade to ≥ 1.3. |
| `Unable to load a SQLite implementation` | Runtime has neither `node:sqlite` nor `bun:sqlite`; check the Bun/Node version. |
| `Failed to start server. Is port 24337 in use?` | Another instance is running; set `AIDER_DESK_PORT`. |
| `[NetworkManager] Failed to clear proxy` | Harmless under Bun (undici global-dispatcher difference); only matters if you use a proxy. |
| Agent code search fails | `probe` binary missing from `resources/<platform>/probe`; the `postinstall` download can fail offline — copy a binary from a global `@probelabs/probe` install. |

---

## Optional next steps

- **Lazy-load AI providers** — `model-manager.ts` statically imports all ~28 provider
  strategies, pulling in every `@ai-sdk/*`, AWS and Google SDK at startup. Deferring
  these would cut ~100 MB+ and shave startup, at the cost of touching ~29 shared files
  (higher merge conflict).
- **Remove Electron entirely** — delete `src/main/index.ts`, `ipc-handlers.ts`,
  `window-manager.ts`, `progress-window.ts`, `src/preload/`, `electron.vite.config.ts`,
  `electron-builder.yml` and the Electron dev dependencies.
- **Shrink the renderer bundle** — the main SPA chunk is ~20 MB; code-splitting heavy
  viewers (diff/mermaid/shiki) would improve browser load time.