# AiderDesk Lite Fork

This fork turns AiderDesk into a **lean, headless web server** that runs directly on
[Bun](https://bun.sh) — no Electron, no Node entry point, no Python/Aider bootstrap, and a
much smaller memory/CPU footprint with near-instant startup.

It is based on upstream **0.91.0** and targeted at the Bun runtime only.

It is designed to keep **upstream sync cheap**: almost everything new lives in
`src/main/fork/`, and the changes to shared upstream files are small and isolated.

---

## Quick start

```bash
# Prerequisite: Bun >= 1.3 available as `bun` (see Requirements)
npm run install:lite                           # bun install: skips the ~200MB Electron binary + optional deps
npm run build:lite                             # builds renderer + server bundles
npm run start:lite                             # -> http://localhost:23456
```

`install:lite` is `ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --omit=optional`. The only
optional dependency is `cloudflared` (the Electron tunnel; never used here, and its
postinstall downloads a ~40 MB binary). A plain `bun install` still works — it just installs
`cloudflared` too. Keep in mind that `--omit=optional` also skips optional dependencies added
upstream later; install those explicitly if one ever becomes mandatory.

Open <http://localhost:23456> in a browser.

Bun is the only supported runtime: the fork has no Node entry point.

---

## Requirements

| Requirement | Why |
| --- | --- |
| **Bun ≥ 1.3** | Bun 1.2.0 (e.g. some Homebrew builds) **segfaults** on this bundle. Check with `bun --version`; the official installer (`~/.bun/bin/bun`) is fine. Homebrew installs into `/opt/homebrew/bin`, which can precede `~/.bun/bin` on `PATH`, so `which -a bun` may still show 1.2.0 — put `$HOME/.bun/bin` first. |
| `--conditions=module-sync` | Bun cannot `require()` ESM-only packages that only export a `module-sync` condition (e.g. `file-type`). Already baked into `start:lite`. |

---

## What changed

### New files (no upstream conflict)

| File | Purpose |
| --- | --- |
| `src/main/fork/runner-lite.ts` | The lean server entry point. Identical to upstream `src/main/server/runner.ts` except it **never bootstraps Python/Aider** and disables the memory/embeddings subsystem. |
| `src/main/fork/node-sqlite.cjs` | Runtime shim exposing the `node:sqlite` `DatabaseSync` API over `bun:sqlite` (Bun has no `node:sqlite` builtin). Aliased in the server vite config. |
| `scripts/zlib-zstd-shim.cjs` | Stubs `zlib.createZstdDecompress` for runtimes that lack it — `undici` 8.12+ calls `.bind()` on it at import, which otherwise kills every process that loads it. Loaded as a vitest setup file and as a Bun preload before the lite entry. |
| `vite.config.renderer.ts` | Standalone renderer build (replaces `electron-vite`) so the SPA can be served without any Electron tooling. Mirrors the 0.91.0 `renderer` config: startup-loader plugin, `progress.html` entry, esbuild minify and the `/api` + `/socket.io` dev proxy, plus the `__LITE_FORK__` define. |
| `docs/lite-fork.md` | This document. |

### Modified files (small, isolated — review on upstream merge)

| File | Change |
| --- | --- |
| `package.json` | Added `install:lite`, `build:renderer`, `build:lite`, `start:lite`, `download:probe`; `prebuild:server` now runs the standalone renderer build instead of `electron-vite build`; `postinstall` drops the Electron-only steps **and the `probe` download** (the lite profile has no `probe` dependency — run `npm run download:probe` to opt back in); `build:extensions` uses `cd packages/extensions && npm run build` because Bun rewrites `npm` → `bun` in scripts and ignores npm's `--workspace` flag; `cloudflared` moved from `dependencies` to `optionalDependencies` so `install:lite` can skip its ~40 MB postinstall while the lazy import keeps the build working without it; `build:renderer` sets `AIDER_DESK_LITE=true`, the renderer's single source of truth. |
| `vitest.config.node.ts`, `vitest.config.web.ts` | Preload `scripts/zlib-zstd-shim.cjs` so `undici` imports do not crash the test runner on runtimes without zstd. |
| `vite.config.server.ts` | Aliases `node:sqlite` to the shim, marks `/^bun:/` external, emits **two** entries (`runner` and `runner-lite`), and injects a per-entry `banner` that defaults the lite server's port to `23456` (it must be baked in before the shared chunk computes `SERVER_PORT`). |
| `src/main/telemetry/telemetry-manager.ts` | In the lite profile only, skips loading the heavy OpenTelemetry module when no PostHog key and no tracing exporter (`LANGFUSE_*` / `POSTHOG_API_KEY` env) is configured. Tracing still initializes and flushes on shutdown, as 0.91.0 expects. |
| `src/main/terminal/terminal-manager.ts` | `@homebridge/node-pty-prebuilt-multiarch` is now lazily imported on first terminal use, so the native module is never loaded when unused. |
| `src/main/utils/probe.ts` | Throws a clear error when the `probe` binary is absent instead of an opaque shell `ENOENT`. |
| `src/main/server/cloudflare-tunnel-manager.ts` | Imports `cloudflared` lazily at `start()` (with a local type) and throws a clear error when the package is missing, so the dependency can be optional. |
| `src/main/store/store.ts` | Aider-backed modes (`code`/`ask`/`architect`/`context`) are mapped to `agent` **when read** while `AIDER_DESK_LITE=true`. Nothing is written, so the same data dir opened with the full build still shows the user's own choice. |
| `src/main/task/task.ts` | `shouldStartAider()` refuses to spawn the connector in the lite profile and explains why once per project (warning level) instead of failing later; `getCurrentMode()` reads a task persisted in an aider mode as `agent` (read-time only, nothing written); `restartAiderConnector()` stays inert with a log message; the aider spawn in `updateTask()`'s mode-change path is skipped. |
| `vite.config.renderer.ts`, `src/renderer/src/utils/lite-fork.ts` | `__LITE_FORK__` is defined from `process.env.AIDER_DESK_LITE === 'true'`; the UI then hides aider modes, hides the Aider onboarding path and pre-selects the agent path. |
| `.gitignore` | Also ignores top-level `resources/probe-*` archives (upstream only ignored `resources/*/probe*`). |
| `.husky/pre-commit` | Runs `bun x lint-staged && bun run typecheck && bun run test` — Bun is the profile's runtime, so the hooks go through Bun. |
| `src/renderer/src/components/Workspace/DiffFilesSidebar.tsx`, `UpdatedFilesDiffModal.tsx`, `src/renderer/src/components/common/DiffViewer/PierreDiffViewer.tsx`, `packages/common/src/locales/*.json` | Collapsible file list with a mobile drawer and unified diff on phones (fork feature, carried from the 0.90.0 branch). |
| `packages/extensions/extensions/code-mode-lua/` | UI extension rendering `mcp-hub` `code_mode` tool messages with Lua highlighting (fork feature). |

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
| socket.io event bridge | Cloudflare tunnel (`cloudflared` is not installed; the tunnel API is browser-unsupported) |
| Terminal (native module lazily loaded) | `node-pty` at startup |
| Agent mode — search tools degrade with a clear error | `probe` binary (semantic code / task search) |

---

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `AIDER_DESK_PORT` | `23456` (lite; upstream is `24337`) | HTTP port. |
| `AIDER_DESK_DATA_DIR` | `~/Library/Application Support/aider-desk-dev-nodejs` (non-Electron) | Where settings, DBs and logs live. See *Migrating from the Electron release*. |
| `AIDER_DESK_PROJECTS` | – | Comma-separated project paths to open at startup. |
| `AIDER_DESK_MEMORY_ENABLED` | `false` (lite) | Set to `true` to re-enable memory embeddings. |
| `AIDER_DESK_LITE` | `true` in the lite build | Set by the lite entry point and by `build:renderer`. Baked into the renderer bundle as `__LITE_FORK__` (hides aider modes) and read at runtime to map saved aider modes to `agent`. |
| `AIDER_DESK_USERNAME` / `AIDER_DESK_PASSWORD` | – | Enable HTTP Basic Auth. |
| `AIDER_DESK_READONLY` | `false` | Read-only mode (requires `AIDER_DESK_PROJECTS`). |

`AIDER_DESK_HEADLESS=true` is forced by the lite entry.

---

## Migrating from the Electron release

The Electron release and the lite server keep their machine-wide data in **different
directories**, so a fresh lite server starts with no providers, projects or settings:

| Build | Data dir |
| --- | --- |
| Electron release (`~/aider-desk.app`) | `~/Library/Application Support/aider-desk` |
| Lite server, non-Electron (`NODE_ENV != production`) | `~/Library/Application Support/aider-desk-dev-nodejs` |
| Lite server, `NODE_ENV=production` | `~/Library/Application Support/aider-desk-nodejs` |

The non-Electron path resolves through `env-paths`, which appends its default `-nodejs`
suffix — so `NODE_ENV=production` alone does **not** land in the Electron directory. To
reuse an existing install, point `AIDER_DESK_DATA_DIR` at it explicitly:

```bash
AIDER_DESK_DATA_DIR="$HOME/Library/Application Support/aider-desk" npm run start:lite
```

Caveats when sharing a directory the Electron app also uses:

- The lite entry calls `disableMemory()` and **writes `config.json`**, so memory gets
  turned off for the Electron app too. Set `AIDER_DESK_MEMORY_ENABLED=true` to keep it
  enabled, or copy `config.json` into a separate directory instead (below).
- Task/project modes are **not** rewritten: an `aider`-backed mode saved by the full build is
  mapped to `agent` when read, so switching back to the Electron app keeps your choice.
- Do not run both builds against the same directory at the same time — `config.json`
  is last-writer-wins.

Nothing else needs migrating:

| Data | Where | Action |
| --- | --- | --- |
| Global config — agents, skills, commands, hooks, extensions, `mcp-servers.json`, prompts, rules | `~/.aider-desk` (`AIDER_DESK_HOME_DIR`) | none — already shared by every build |
| Projects, tasks, sessions, per-project extensions | `<project>/.aider-desk/` | none — travels with the project |
| `openProjects` / `recentProjects`, settings, providers | `<data dir>/config.json` | comes along with the data dir |
| Usage/cost history (`messages` table) | `<data dir>/aider-desk.db` | comes along with the data dir |
| `python-venv/`, `aider-connector/`, `mcp-server/`, `memory.db/`, `logs/` | Electron data dir | unused by the lite profile |
| Electron caches (`Cache/`, `GPUCache/`, `Cookies`, …) | Electron data dir | unused — the lite profile's own `cache/` collides with Electron's `Cache/` on a case-insensitive filesystem |

To leave the release untouched, copy the portable files into a separate directory and
point `AIDER_DESK_DATA_DIR` at the copy:

```bash
LITE="$HOME/Library/Application Support/aider-desk-lite"
mkdir -p "$LITE"
cp "$HOME/Library/Application Support/aider-desk/"{config.json,models.json,aider-desk.db} "$LITE/"
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run build:renderer` | Build the SPA into `out/renderer`. |
| `npm run build:server` | Build `out/server/runner.js` + `out/server/runner-lite.js` and copy `resources/` (its `prebuild:server` hook runs `build:renderer` first). |
| `npm run build:lite` | `build:renderer` + `build:server`. |
| `npm run start:lite` | Run the lite server with Bun. |
| `npm run start:server` | (Upstream) run `out/server/runner.js` — still tries to bootstrap Python/Aider. |

---

## Measured results (macOS arm64)

| Metric | Value |
| --- | --- |
| Process start → HTTP ready | ~1.2–1.5 s |
| App bring-up after entry runs | **~88 ms** |
| Memory footprint — Bun | **~407 MB** |
| Idle CPU | ~0.2% |
| Bare Bun baseline | ~22 MB |

Most of the residual memory is the eagerly-loaded AI-provider SDK graph (~135 MB by
itself). See *Optional next steps*.

---

## Upstream sync guide

1. Work on a dedicated branch and keep `git config rerere.enabled true` so repeated
   conflict resolutions are remembered.
2. Merge `origin/main` periodically. Conflicts are expected only in the files
   listed under *Modified files* above — everything else is additive.
3. Reinstall after every upstream bump — `npm run install:lite`. Pinned versions move with
   upstream, and a `node_modules` left over from the previous version fails `typecheck` on the
   SDK types (see *Troubleshooting*).
4. Generated/ignored artefacts are already in `.gitignore`
   (`out/`, `node_modules/`, `resources/probe-*`, `resources/*/probe*`, `packages/extensions/extensions.d.ts`) —
   do not commit them.
5. To temporarily remove the fork behaviour, build/run upstream instead:
   `npm run build:server && npm run start:server`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find package 'file-type'` | Run with `--conditions=module-sync` (use `npm run start:lite`). |
| Bun crashes with a segmentation fault right after startup | Bun is 1.2.0 — upgrade to ≥ 1.3. |
| `Unable to load a SQLite implementation` | Bun has no `node:sqlite` and the `bun:sqlite` fallback failed; check `bun --version` (≥ 1.3). |
| `Failed to load extension …: No such built-in module: node:sqlite` | Extensions are executed by `jiti` outside the bundled server, so the `node:sqlite` alias does not reach them. Extensions that import `node:sqlite` (e.g. via `@aiderdesk/tree-sitter-utils`) cannot run on Bun yet; disable them or open that project in the full build. |
| `Failed to start server. Is port 23456 in use?` | Another instance is running; set `AIDER_DESK_PORT`. |
| `[NetworkManager] Failed to clear proxy` | Harmless under Bun (undici global-dispatcher difference); only matters if you use a proxy. |
| Agent code search fails | The lite profile does not install `probe` (removed from `postinstall`). Run `npm run download:probe` to fetch it into `resources/<platform>/probe`; the tools return a clear "binary not found" message until then. |
| Install fails with `CACError: Unknown option `--workspace`` (or spawns the Electron build) | Bun rewrites `npm` → `bun` inside scripts and ignores npm's `--workspace`. `build:extensions` uses `cd packages/extensions && npm run build`; use Bun ≥ 1.3. |
| `patch-package` fails: `Failed to apply patch for package …` | A stale `node_modules` from a previous install already has the patch applied. Run `rm -rf node_modules && bun install`. |
| `typecheck` fails with SDK type drift (e.g. a value of type `interrupted` not assignable to `FinishReason \| null`) | `node_modules` is left over from the previous version. Run `npm run install:lite` after every upstream bump — 0.91.0 pins `ai` 7.0.157, and a `node_modules` left from 0.90.0 (7.0.156) keeps the older `FinishReason` union and extension event types. |

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