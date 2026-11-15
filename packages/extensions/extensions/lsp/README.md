# LSP Integration

Automatic diagnostics remain **awaited after `power---file_edit` and `power---file_write`** and are appended to the same tool result. `lsp-find-references` provides symbol references using zero-based positions.

## Discovery

Servers start lazily. Relative paths and workspace identity use the task working directory, including its worktree, not the base checkout. Tasks in the same directory share clients; separate worktrees have separate clients. Closing the last task that used a workspace releases its clients. Project closure and extension unload also release clients.

Supported servers:

- TypeScript/JavaScript: `typescript-language-server --stdio`
- Deno: `deno lsp`
- Python: `pyright-langserver --stdio` (not the `pyright` CLI)
- Vue: `vue-language-server --stdio` or `volar --stdio`
- Rust: `rust-analyzer`
- Go: `gopls serve`
- Java: `jdtls`
- Lua: `lua-language-server`
- Svelte: `svelteserver --stdio`
- Astro: `astro-ls --stdio`
- C#: `omnisharp -lsp` or `OmniSharp -lsp`

Run `npm install` in the extension directory (the extension installer normally handles this). TypeScript and its language server are included as pinned dependencies, so JavaScript/TypeScript diagnostics work without installing anything in the project or downloading a server during an edit. The project's TypeScript version is preferred; the bundled version is a fallback.

Explicit commands take precedence, followed by workspace/ancestor executables and PATH. When none is available, the extension uses bundled dependencies or **automatically installs a pinned server** into `~/.aider-desk/cache/lsp`. The project and its dependency manifests are not modified. Node-based bundled/managed servers run through AiderDesk's Node runtime, including packaged Electron installations. Windows npm shims are launched with `cross-spawn`.

Automatic setup covers:

- Python, Vue, Svelte, Astro, and Deno: npm packages (requires npm on PATH for the first download).
- Rust: `rustup component add rust-analyzer` when rustup is available.
- Go: a pinned `gopls` installation using the installed Go toolchain and a private `GOBIN`.
- C#: a compatible pinned `csharp-ls` tool using an existing .NET SDK 8 or newer; existing OmniSharp installations are still preferred.
- Lua: the official pinned LuaLS release, with SHA-256 verification.
- Java: a pinned official Eclipse JDT LS distribution, using JDK 21 or newer. Each workspace/process gets a separate JDT data directory.

Installation is lazy, logged at info level, deduplicated across tasks and app instances, and limited to two concurrent installs per extension instance. First use can take up to the installation deadline. Completed installations are cached; failed installs are retried after discovery-cache expiry. Package lifecycle scripts are disabled. Archive downloads/extraction are bounded, and unsafe paths/links are rejected. Extension unload cancels its pending installers. Cancelling one task detaches its wait without cancelling a shared installation needed elsewhere.

The extension does not install operating-system toolchains, request administrator privileges, or run remote shell scripts. If npm, rustup, Go, .NET, or the required JDK is missing, or a download fails, the edit still succeeds but its result explicitly says **diagnostics unavailable / not verified**, with the reason. `autoInstall: false` disables new downloads but still permits bundled and cached servers.

Deno markers take precedence over TypeScript, including in nested packages. A missing Deno executable does not silently activate TypeScript instead. TypeScript can use an ancestor or global installation; otherwise the language server's own TypeScript discovery is used.

Vue/Svelte/Astro inspect package dependency declarations. Rust, Go, and Java inspect their project markers. C# matches real `.csproj`, `.sln`, `.slnx`, or `omnisharp.json` files, not literal wildcard filenames. `.slnx` discovery does not guarantee support by an older OmniSharp version.

Discovery first checks the task workspace, then walks upward from the edited file to that workspace for a suitable nested project. It does not recursively scan the repository. Dependency/executable resolution may use ancestors, but the server root remains inside the task workspace unless explicitly overridden. Discovery and failed starts are retried after the configured TTL; saving configuration resets clients and discovery caches.

## Awaited diagnostics

- File URLs use native URL conversion, including escaped characters, Windows drive paths, and UNC paths.
- Diagnostic waiters are installed before document notifications; there is no polling interval.
- Same-document operations are serialized. Unchanged content with current cached diagnostics avoids redundant notifications and waits.
- Published document versions are checked. Empty publications clear errors. Servers omitting diagnostic versions are supported on a best-effort basis: the protocol cannot reliably associate a delayed versionless publication with a particular edit.
- A diagnostic timeout is reported as **not verified**, not as a clean file or cached stale errors.
- Tool cancellation cancels the wait; explicit reference requests also forward JSON-RPC cancellation. One cancelled startup caller does not stop a shared startup needed by another caller.
- Structured edit outputs are retained under `result` when diagnostic enrichment is needed; the additional text is under `lspDiagnostics`. String outputs retain their existing append format.

The diagnostic deadline starts when notifying the server. Installation, the initialization handshake, and file synchronization are additional costs, bounded separately. An unchanged diagnostic set that is never republished can still require the full diagnostic deadline; generic progress/idle notifications are not treated as proof of correctness.

### First-edit and initialization timeouts

The default limits are 180 seconds for automatic installation (`installTimeoutMs`), 30 seconds for the LSP initialization request (`requestTimeoutMs`), and 3 seconds for diagnostics (`diagnosticTimeoutMs`). The diagnostic limit is the same for the first edit and subsequent edits; there is no separate cold-start diagnostic budget.

Completing the LSP `initialize` handshake does not mean project loading or indexing has finished. In a large workspace, the first edit can therefore report **"LSP diagnostics timed out; this edit has not been verified."** while a later edit succeeds after the server has warmed up.

- A **diagnostic timeout** keeps the server running. Late diagnostics for a still-tracked document may populate its cache, but do not change the already-completed tool result. The timed-out edit must not be treated as verified.
- An **initialization timeout** disposes the failed client and terminates its server. A later request can retry after `discoveryRetryMs` expires (30 seconds by default).
- To allow longer waits in large workspaces, increase `diagnosticTimeoutMs` in `config.json`; increase `requestTimeoutMs` only if the initialization handshake or other requests need more time. Saving configuration resets existing clients and caches, so the next request starts cold again.

All waits remain bounded and cancellable. A longer diagnostic timeout also increases the maximum delay when a server does not publish fresh diagnostics.

## Resource limits and configuration

Optional `config.json` alongside `index.ts` is validated on load. Defaults:

```json
{
  "autoInstall": true,
  "installTimeoutMs": 180000,
  "serverCacheDir": "",
  "diagnosticTimeoutMs": 3000,
  "requestTimeoutMs": 30000,
  "shutdownTimeoutMs": 1000,
  "maxServers": 4,
  "maxConcurrentStarts": 2,
  "maxOpenDocuments": 32,
  "maxDiagnosticsPerDocument": 200,
  "maxFileBytes": 2000000,
  "maxPendingOperations": 128,
  "idleTimeoutMs": 300000,
  "discoveryRetryMs": 30000,
  "workspaceRoots": {},
  "servers": {}
}
```

Limits apply per extension instance; document and pending-document limits apply per client, and manager startup queues have their own pending limit. Server limits bound top-level language-server clients, not subprocess counts or the memory an individual server chooses to allocate.

Idle documents are closed when space is needed. Only diagnostics for currently tracked documents are retained; unsolicited workspace-wide diagnostic floods are not cached. Active documents/clients are not evicted to satisfy capacity limits. If all capacity is active, the edit result reports that diagnostics are unavailable, without failing the underlying edit. Unused clients are also evicted after the idle timeout. File reads, diagnostic messages, and formatted output are bounded.

To select a nested solution root and a custom executable:

```json
{
  "workspaceRoots": {
    "/absolute/task/worktree": "services/backend"
  },
  "servers": {
    "csharp": {
      "command": "/absolute/path/to/OmniSharp",
      "args": ["-lsp"],
      "initializationOptions": {}
    }
  }
}
```

Workspace keys must match the absolute task directory. Relative root overrides resolve against it. Server overrides are keyed by the IDs `typescript`, `deno`, `python`, `vue`, `rust`, `go`, `java`, `lua`, `svelte`, `astro`, or `csharp`. An explicit server command bypasses automatic project-marker eligibility checks. Add server-specific solution-selection arguments when needed; no server is launched per discovered project file.

Shutdown is bounded, disposes connections/waiters, and terminates failed or unresponsive processes. Production POSIX servers use a process group for descendant cleanup; Windows force termination uses `tree-kill`.

## Verification and benchmarks

From the repository root, install this extension's dependencies if needed:

```sh
npm install --prefix packages/extensions/extensions/lsp --ignore-scripts --package-lock=false --workspaces=false
npm run build:extensions
npm run test --workspace=packages/extensions -- --no-color extensions/lsp/__tests__
npx tsc --noEmit -p packages/extensions/extensions/lsp/tsconfig.json
```

See [performance/README.md](performance/README.md) for reproducible before/after measurements, their limitations, and the large C# repository discovery result.
