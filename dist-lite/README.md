# AiderDesk Lite — distributable build

Turns the lite fork (`docs/lite-fork.md`) into a **self-contained executable**: the Bun
runtime, the server bundles and every JavaScript dependency are embedded, so a target
machine needs no Node, Bun, Python, `aider-chat` or `node_modules`. Assets and the one
native module that is used at runtime (node-pty, for terminals) travel next to it.

Built artifact: `out/aiderdesk-lite-<slug>` (~135 MB), plus a staged tarball
`release/aiderdesk-lite-<version>-<slug>.tar.gz` (~70 MB without probe, ~125 MB with it).

```bash
./build.sh                        # renderer + server bundles, compile -> out/
./package.sh                      # stage + tar + sha256 -> release/
./install.sh                      # from the unpacked tarball -> ~/.local/{bin,lib}/aiderdesk-lite
```

## Requirements

| Requirement | Why |
| --- | --- |
| Bun ≥ 1.3 on the **build** machine | `Bun.build({ compile })` and `--conditions=module-sync` |
| `npm run install:lite` run once | the bundle is built from the repo's `node_modules` |
| `xcode-select --install` (macOS) | `codesign` for the ad-hoc signature the binary needs on Apple Silicon |

The **target** needs nothing but a shell (and `git` for project/git features).

## Targets

`[slug]` is `darwin-arm64`, `darwin-x64`, `linux-x64` or `linux-arm64`; the default is the
host. Cross-builds are possible but only smoke-tested on the host:

```bash
./build.sh linux-x64              # bun can emit a linux-x64 executable from macOS
./package.sh 0.91.0 linux-x64
```

`bun-linux-x64-baseline` (pre-AVX2 CPUs) is not wired in; pass a matching slug if needed.

## What goes into the tarball

```
aiderdesk-lite-<version>-<slug>/
  aiderdesk-lite                  standalone executable (Bun embedded)
  run.sh                          sets the asset/env defaults, then execs the binary
  renderer/                       SPA built by vite (out/renderer)
  resources/
    prompts/  skills/  icon.png   built-ins the lite profile reads
    macos|linux/probe             semantic code search (WITH_PROBE=0 to skip, ~53 MB)
  node_modules/
    @homebridge/node-pty-...      terminal support, native build for the target only
    zod  @aiderdesk/extensions    shared runtimes for extensions loaded through jiti
  install.sh  README.md  GUIDELINE.md  VERSION  package.json
```

Not shipped, because the lite profile never uses them: `resources/connector/` (Python),
`resources/*/uv`, the Electron app, `@huggingface/transformers` and `@lancedb/lancedb`
(memory embeddings are disabled).

## Environment

`run.sh` defaults (all overridable):

| Variable | Default |
| --- | --- |
| `AIDER_DESK_PORT` | `23456` |
| `AIDER_DESK_DATA_DIR` | `~/.local/share/aider-desk-lite` |
| `AIDER_DESK_RENDERER_DIR` | `<install>/renderer` |
| `AIDER_DESK_RESOURCES_DIR` | `<install>/resources` |
| `AIDER_DESK_NODE_PTY_PATH` | `<install>/node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/index.js` |
| `AIDER_DESK_RUNTIME_MODULES_DIR` | `<install>/node_modules` |

See `docs/lite-fork.md` for the rest (`AIDER_DESK_PROJECTS`, basic auth, readonly mode).

## Fork changes required by the dist

Two shared files resolve runtime paths from the environment so the compiled binary can
reach modules that cannot be embedded:

| File | Change |
| --- | --- |
| `src/main/terminal/terminal-manager.ts` | `loadPty()` imports `AIDER_DESK_NODE_PTY_PATH` when set; `.node` addons cannot be resolved from inside a compiled executable. |
| `src/main/extensions/extension-loader.ts` | jiti's `zod` / `@aiderdesk/extensions` aliases resolve from `AIDER_DESK_RUNTIME_MODULES_DIR` when set, because `require.resolve()` is baked to the build machine's absolute paths. |

## Known limitations

- **Unresolved externals at runtime**: `@huggingface/transformers` and `@lancedb/lancedb`
  are not shipped. Memory embeddings are off by default in the lite profile; enabling them
  (`AIDER_DESK_MEMORY_ENABLED=true`) fails in the dist build.
- **`probe`**: skipped with `WITH_PROBE=0`; agent code search then reports the existing
  "binary not found" error.
- **Extensions importing `node:sqlite`** still cannot run on Bun (pre-existing lite
  limitation, jiti runs outside the bundle).
- **Signing**: only an ad-hoc signature is applied. Gatekeeper still blocks the binary if
  it arrives with a quarantine flag (browser download, AirDrop) — `xattr -d
  com.apple.quarantine` on the install dir, or distribute via `curl`/`scp`/a tarball.
- **Startup cost**: the bundle loads the whole AI-provider graph, ~1.2–1.5 s to HTTP ready
  and ~400 MB RSS, same as `npm run start:lite`.

## Rebuilding after an upstream bump

```bash
npm run install:lite
./build.sh && ./package.sh
```

The executable version tracks `package.json`; `package.sh` reads it unless you pass one.