import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createJiti } from 'jiti';

const directory = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const source = process.env.LSP_SOURCE_ROOT ?? path.dirname(directory);
const { LspClient } = await jiti.import(path.join(source, 'lsp-client.ts'));
const { LspManager } = await jiti.import(path.join(source, 'lsp-manager.ts'));
const { SERVERS, CSharpServer, isCSharpProject } = await jiti.import(path.join(source, 'lsp-servers.ts'));
const root = await mkdtemp(path.join(tmpdir(), 'lsp-benchmark-'));
const children = [];
let logs = 0;
const context = { log: () => logs++, getProjectDir: () => root };
const server = {
  id: 'benchmark',
  languageId: 'typescript',
  extensions: ['.bench'],
  spawn: async () => {
    const child = spawn(process.execPath, [path.join(directory, 'fake-server.mjs')], {
      stdio: 'pipe',
      env: { ...process.env, LSP_FAKE_FLOOD: '2000' },
    });
    children.push(child);
    return { process: child };
  },
};
SERVERS.unshift(server);
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let peakHostRss = process.memoryUsage().rss;
let peakServerRss = 0;
let sampling = false;
const sample = async () => {
  if (sampling) return;
  sampling = true;
  try {
    peakHostRss = Math.max(peakHostRss, process.memoryUsage().rss);
    const values = await Promise.all(
      children.map(async (child) => {
        try {
          return Number(/VmRSS:\s+(\d+)/.exec(await readFile(`/proc/${child.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
        } catch {
          return 0;
        }
      }),
    );
    peakServerRss = Math.max(
      peakServerRss,
      values.reduce((a, b) => a + b, 0),
    );
  } finally {
    sampling = false;
  }
};
const sampler = setInterval(sample, 20);
global.gc?.();
const cpu = process.cpuUsage();
const timings = [];
const measurements = {};
let client;
let manager;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const timed = async (name, action) => {
  const start = performance.now();
  const result = await action();
  measurements[name] = Math.round((performance.now() - start) * 100) / 100;
  return result;
};
try {
  client = new LspClient({
    serverInfo: server,
    handle: await server.spawn(),
    rootDir: root,
    context,
  });
  await timed('initializeMs', () => client.initialize());
  for (let i = 0; i < 80; i++) {
    const file = path.join(root, `file-${i}.bench`);
    await writeFile(file, i % 2 ? 'ERROR' : 'clean');
    const start = performance.now();
    if (client.updateAndGetDiagnostics) await client.updateAndGetDiagnostics(file, 3000);
    else {
      await client.notifyFileChanged(file);
      await client.waitForDiagnostics(file, 3000);
    }
    timings.push(performance.now() - start);
  }
  const raceFile = path.join(root, 'race.bench');
  await writeFile(raceFile, 'ERROR');
  await timed('alreadyPublishedMs', async () => {
    if (client.updateAndGetDiagnostics) await client.updateAndGetDiagnostics(raceFile, 3000);
    else {
      await client.notifyFileChanged(raceFile);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await client.waitForDiagnostics(raceFile, 3000);
    }
  });
  measurements.retainedDiagnosticDocuments = client.diagnostics?.size;
  measurements.retainedOpenDocuments = client.openFiles?.size;
  manager = new LspManager(context);
  const before = children.length;
  await timed('parallelStartupMs', () => Promise.all(Array.from({ length: 8 }, () => manager.getClient('parallel.bench', root))));
  measurements.parallelStartupProcesses = children.length - before;
  await timed('worktreeStartupMs', () =>
    Promise.all(
      Array.from({ length: 3 }, async (_, i) => {
        const workspace = path.join(root, `worktree-${i}`);
        await (await import('node:fs/promises')).mkdir(workspace);
        return manager.getClient('parallel.bench', workspace);
      }),
    ),
  );
  measurements.worktreeProcesses = children.length - before - measurements.parallelStartupProcesses;
  await timed('shutdownMs', async () => {
    await client.shutdown();
    await manager.shutdown();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  measurements.liveProcessesAfterShutdown = children.filter((child) => child.exitCode === null && child.signalCode === null).length;
  const repo = process.env.LSP_CSHARP_REPO;
  if (repo) {
    if (isCSharpProject) measurements.csharpProjectDetected = await isCSharpProject(repo);
    const handle = await timed('csharpDiscoveryMs', () => CSharpServer.spawn(repo, context));
    measurements.csharpServerStarted = Boolean(handle);
    handle?.process.kill();
  }
  await sample();
  console.log(
    JSON.stringify(
      {
        label: process.argv[2] ?? 'run',
        node: process.version,
        platform: process.platform,
        workload: {
          warmEdits: 80,
          diagnosticFlood: 2000,
          parallelRequests: 8,
          worktrees: 3,
          deadlineMs: 3000,
        },
        warmEditMs: {
          p50: percentile(timings, 0.5),
          p95: percentile(timings, 0.95),
        },
        measurements,
        host: {
          peakRssBytes: peakHostRss,
          heapUsedBytes: process.memoryUsage().heapUsed,
          cpuMicroseconds: process.cpuUsage(cpu),
          eventLoopP95Ms: loop.percentile(95) / 1e6,
        },
        fakeServers: {
          peakAggregateRssBytes: peakServerRss,
          spawned: children.length,
        },
        logCalls: logs,
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(sampler);
  loop.disable();
  for (const child of children) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}
