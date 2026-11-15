# LSP before/after benchmarks

## Reproduce

From the repository root, install the extension dependencies and use an unchanged source revision as the baseline:

```sh
npm install --prefix packages/extensions/extensions/lsp --ignore-scripts --package-lock=false --workspaces=false
LSP_CSHARP_REPO=/absolute/path/to/large/csharp/repository \
  node packages/extensions/extensions/lsp/performance/compare.mjs 948929066bbb1149f7d4bea0278f259e4fb32d7c 3
```

`compare.mjs` extracts the original three implementation modules using `git show` into a temporary directory under the extension's ignored `node_modules`. It does not change the working tree's implementation. Each baseline/optimized trial runs in a fresh Node process, using the same dependencies and fake JSON-RPC server. Results are written to `results/baseline-N.json` and `results/optimized-N.json`; the temporary baseline sources are removed afterward.

Do not use a post-optimization revision as the baseline reference. The recorded baseline is `948929066bbb1149f7d4bea0278f259e4fb32d7c`. An initial baseline was captured before production edits; the matched trials were subsequently repeated against those original git sources after the benchmark workload was expanded.

## Workload

- Linux, Node v24.12.0; three alternating baseline/optimized trials.
- A fake server publishes versioned diagnostics after 5 ms, alternating errors and empty diagnostics across 80 distinct documents.
- Each server emits diagnostics for 2,000 unopened documents, exercising diagnostic retention.
- An explicit missed-publication probe: the original two-call API intentionally delays waiter registration by 30 ms after sending an update. The replacement atomic update/wait API registers before sending. This demonstrates the race, not a claim that every real edit saves three seconds.
- Eight simultaneous requests for the same root/language, then three additional workspaces. Distinct workspaces must remain isolated.
- Shutdown checks live child processes after a 100 ms settling period. The harness forcibly cleans up baseline leaks afterward.
- Host CPU, heap, RSS, and event-loop delay are measured independently from aggregate fake-server RSS. Linux `/proc` RSS is sampled every 20 ms; fake servers have no descendants.

## Recorded results

Medians across three runs:

- **Warm edit p50:** 50.45 ms baseline → 5.88 ms optimized.
- **Warm edit p95:** 51.23 ms → 6.49 ms. The fake server itself accounts for approximately 5 ms.
- **Missed-publication probe:** 3,030 ms → 6.01 ms, using the two APIs described above.
- **Same-workspace concurrent startup:** 8 processes → 1.
- **Additional workspaces:** 3 processes in both versions, confirming isolation rather than sharing unrelated roots.
- **Processes left alive after shutdown:** 7 → 0.
- **Retained diagnostic documents:** 2,081 → 32.
- **Retained open documents:** 81 → 32.
- **Peak aggregate fake-server RSS:** 679.69 MiB → 284.62 MiB, primarily from eliminating duplicate servers.
- **Peak host RSS:** 136.14 MiB → 92.20 MiB. Ranges were 130.08–164.88 MiB and 89.62–123.95 MiB respectively; GC/JIT and sampling make these less deterministic than retained object/process counts.
- **Host CPU during the workload:** 857.46 ms → 359.82 ms. This includes logging, protocol parsing, and cleanup, not just edit handling.
- **Shutdown:** 108.69 ms → 71.68 ms.
- **Event-loop p95:** 10.65 ms → 11.38 ms with 10 ms monitoring resolution. This does **not** demonstrate improved event-loop responsiveness; awaited timers were not synchronous event-loop blocking in the first place.

Raw records are generated locally under the ignored `results/` directory and are not committed. Re-running the command above produces all trials and environment/workload metadata. The earlier `baseline.json` and `optimized.json` snapshots used the initial 20-edit workload and are not used for this comparison.

## Large C# repository check

The supplied large C# repository was inspected without modifying its source files. It contains a `.slnx` solution at the root and many nested `.csproj` files.

- Original discovery skipped the repository.
- Corrected discovery recognizes the root as a C# workspace.
- Neither implementation started a real C# language server: `omnisharp`/`OmniSharp` is absent from PATH.
- The `dotnet` command is a workspace wrapper that rejects direct invocation; it was not bypassed.

**No real C# indexing, diagnostic-latency, or server-memory improvement is claimed.** These remain to be measured after installing/configuring a compatible OmniSharp server and selecting the intended solution. The fake-server memory measurements cannot predict a large solution's Roslyn/indexing memory use.

The optional repository probe only checks discovery/start availability; it is not an indexing benchmark. All edit workloads use temporary synthetic files that are removed afterward.

## Remaining platform validation

Native Windows drive/UNC regression tests are present but skipped on Linux. A Windows run is still required to validate npm shim launching, drive/UNC handling, and process-tree cleanup end to end. Native path round-trip tests for escaped filenames run on Linux as well.
