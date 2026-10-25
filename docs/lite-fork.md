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
npm run start:lite                            # -> http://localhost:23456
```

Open <http://localhost:23456> in a browser.

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
| `package.json` | Added `build:renderer`, `build:lite`, `start:lite`, `start:lite:node`, `download:probe`; `prebuild:server` now runs the standalone renderer build instead of `electron-vite build`; `postinstall` drops the Electron-only steps **and the `probe` download** (the lite profile has no `probe` dependency — run `npm run download:probe` to opt back in); `build:extensions` uses `cd packages/extensions && npm run build` because Bun rewrites `npm` → `bun` in scripts and ignores npm's `--workspace` flag. |
| `vite.config.server.ts` | Aliases `node:sqlite` to the shim, marks `/^bun:/` external, emits **two** entries (`runner` and `runner-lite`), and injects a per-entry `banner` that defaults the lite server's port to `23456` (it must be baked in before the shared chunk computes `SERVER_PORT`). |
| `src/main/telemetry/telemetry-manager.ts` | Only loads OpenTelemetry/PostHog when telemetry is enabled **and** a PostHog key is configured (upstream loaded OpenTelemetry unconditionally). |
| `src/main/terminal/terminal-manager.ts` | `@homebridge/node-pty-prebuilt-multiarch` is now lazily imported on first terminal use, so the native module is never loaded when unused. |
| `src/main/utils/probe.ts` | Throws a clear error when the `probe` binary is absent instead of an opaque shell `ENOENT`. |
| `.gitignore` | Also ignores top-level `resources/probe-*` archives (upstream only ignored `resources/*/probe*`). |

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
| Agent mode — search tools degrade with a clear error | `probe` binary (semantic code / task search) |

---

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `AIDER_DESK_PORT` | `23456` (lite; upstream is `24337`) | HTTP port. |
| `AIDER_DESK_DATA_DIR` | `~/Library/Application Support/aider-desk-dev-nodejs` (non-Electron) | Where settings, DBs and logs live. See *Migrating from the Electron release*. |
| `AIDER_DESK_PROJECTS` | – | Comma-separated project paths to open at startup. |
| `AIDER_DESK_MEMORY_ENABLED` | `false` (lite) | Set to `true` to re-enable memory embeddings. |
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
AIDER_DESK_DATA_DIR="$HOME/Library/Application Support/aider-desk" npm run start:lite:node
```

Caveats when sharing a directory the Electron app also uses:

- The lite entry calls `disableMemory()` and **writes `config.json`**, so memory gets
  turned off for the Electron app too. Set `AIDER_DESK_MEMORY_ENABLED=true` to keep it
  enabled, or copy `config.json` into a separate directory instead (below).
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
2. Merge `origin/main` periodically. Conflicts are expected only in the files
   listed under *Modified files* above — everything else is additive.
3. Generated/ignored artefacts are already in `.gitignore`
   (`out/`, `node_modules/`, `resources/probe-*`, `resources/*/probe*`, `packages/extensions/extensions.d.ts`) —
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
| Agent code search fails | The lite profile does not install `probe` (removed from `postinstall`). Run `npm run download:probe` to fetch it into `resources/<platform>/probe`; the tools return a clear "binary not found" message until then. |
| Install fails with `CACError: Unknown option `--workspace`` (or spawns the Electron build) | Bun rewrites `npm` → `bun` inside scripts and ignores npm's `--workspace`. `build:extensions` uses `cd packages/extensions && npm run build`; use Bun ≥ 1.3. |
| `patch-package` fails: `Failed to apply patch for package …` | A stale `node_modules` from a previous install already has the patch applied. Run `rm -rf node_modules && bun install`. |

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