import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticTimeoutError, LspClient } from '../lsp-client';
import { LspManager } from '../lsp-manager';
import { configSchema } from '../config';
import {
  CSharpServer,
  DenoServer,
  findBinary,
  findTsserverPath,
  findWorkspaceRoot,
  getServersForExtension,
  isCSharpProject,
  PythonServer,
  SERVERS,
  TypescriptServer,
  VueServer,
} from '../lsp-servers';
import LspExtension from '../index';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ExtensionContext, ToolFinishedEvent } from '@aiderdesk/extensions';
import type { LspConfig } from '../config';
import type { LspServerInfo } from '../lsp-servers';

const fakeServer = fileURLToPath(new URL('../performance/fake-server.mjs', import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];
const clients: LspClient[] = [];
const managers: LspManager[] = [];
const originalServers = [...SERVERS];
const context = { log: vi.fn() };
let root: string;

const server = (env: NodeJS.ProcessEnv = {}): LspServerInfo => ({
  id: 'test',
  languageId: 'typescript',
  extensions: ['.test'],
  spawn: vi.fn(async () => {
    const child = spawn(process.execPath, [fakeServer], {
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    children.push(child);
    return { process: child };
  }),
});

const makeClient = async (options: Partial<LspConfig> = {}, env: NodeJS.ProcessEnv = {}) => {
  const info = server(env);
  const handle = await info.spawn(root, context);
  const client = new LspClient({
    serverInfo: info,
    handle: handle!,
    rootDir: root,
    context,
    config: configSchema.parse(options),
  });
  clients.push(client);
  await client.initialize();
  return client;
};

const makeManager = (options: Partial<LspConfig> = {}) => {
  const manager = new LspManager(context, configSchema.parse(options));
  managers.push(manager);
  return manager;
};

const file = async (name = 'file.test', content = 'ERROR') => {
  const target = path.join(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'lsp-test-'));
  context.log.mockClear();
});

afterEach(async () => {
  await Promise.all([...clients.splice(0).map((client) => client.shutdown()), ...managers.splice(0).map((manager) => manager.shutdown())]);
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  SERVERS.splice(0, SERVERS.length, ...originalServers);
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe('awaited diagnostics', () => {
  it('round-trips escaped native paths and returns immediate diagnostics without polling', async () => {
    const client = await makeClient({}, { LSP_FAKE_DELAY_MS: '0' });
    const target = await file('space # percent % ü.test');
    expect(fileURLToPath(pathToFileURL(target))).toBe(target);
    expect(await client.updateAndGetDiagnostics(target, 1000)).toHaveLength(1);
    expect(await client.updateAndGetDiagnostics(target, 1000)).toHaveLength(1);
  });

  it('accepts unchanged errors and empty diagnostics clearing errors', async () => {
    const client = await makeClient();
    const target = await file();
    expect(await client.updateAndGetDiagnostics(target, 1000)).toHaveLength(1);
    await fs.writeFile(target, 'ERROR changed');
    expect(await client.updateAndGetDiagnostics(target, 1000)).toHaveLength(1);
    await fs.writeFile(target, 'clean');
    expect(await client.updateAndGetDiagnostics(target, 1000)).toEqual([]);
  });

  it('does not return stale errors on timeout', async () => {
    const client = await makeClient();
    const target = await file();
    await client.updateAndGetDiagnostics(target, 1000);
    await fs.writeFile(target, 'NO_PUBLICATION');
    await expect(client.updateAndGetDiagnostics(target, 30)).rejects.toBeInstanceOf(DiagnosticTimeoutError);
    expect(client.getDiagnostics(target)).toEqual([]);
  });

  it('ignores diagnostics for older document versions', async () => {
    const client = await makeClient();
    expect(await client.updateAndGetDiagnostics(await file('file.test', 'STALE_VERSION clean'), 1000)).toEqual([]);
  });

  it('ignores workspace-wide unsolicited diagnostics and bounds retained documents', async () => {
    const client = await makeClient({ maxOpenDocuments: 2 }, { LSP_FAKE_FLOOD: '1000' });
    const first = await file('first.test');
    await client.updateAndGetDiagnostics(first, 1000);
    await client.updateAndGetDiagnostics(await file('second.test'), 1000);
    await client.updateAndGetDiagnostics(await file('third.test'), 1000);
    expect(client.getDiagnostics(first)).toEqual([]);
    const state = client as unknown as {
      diagnostics: Map<string, unknown>;
      openFiles: Map<string, unknown>;
    };
    expect(state.openFiles.size).toBe(2);
    expect(state.diagnostics.size).toBe(2);
  });

  it('cancels a wait and leaves no diagnostic waiter behind', async () => {
    const client = await makeClient();
    const target = await file('file.test', 'NO_PUBLICATION');
    const controller = new AbortController();
    const result = client.updateAndGetDiagnostics(target, 3000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(result).rejects.toThrow('cancel');
    expect((client as unknown as { waiters: Map<string, unknown> }).waiters.size).toBe(0);
    await fs.writeFile(target, 'ERROR');
    expect(await client.updateAndGetDiagnostics(target, 1000)).toHaveLength(1);
  });

  it('serializes same-document updates and bounds concurrent operations', async () => {
    const client = await makeClient({ maxPendingOperations: 2 }, { LSP_FAKE_DELAY_MS: '30' });
    const target = await file();
    const first = client.updateAndGetDiagnostics(target, 1000);
    const second = client.updateAndGetDiagnostics(target, 1000);
    await expect(client.updateAndGetDiagnostics(target, 1000)).rejects.toThrow('limit');
    expect(await Promise.all([first, second])).toHaveLength(2);
  });

  it('rejects oversized files without retaining their content', async () => {
    const client = await makeClient({ maxFileBytes: 4 });
    await expect(client.updateAndGetDiagnostics(await file(), 1000)).rejects.toThrow('byte limit');
  });

  it('bounds reference requests and shutdown against an unresponsive server', async () => {
    const client = await makeClient({ requestTimeoutMs: 50, shutdownTimeoutMs: 50 }, { LSP_FAKE_HANG: 'textDocument/references' });
    await expect(client.findReferences(await file(), 0, 0)).rejects.toThrow('timed out');
    await client.shutdown();
    expect(client.alive).toBe(false);
  });
});

describe('client ownership and startup', () => {
  it('deduplicates startup for concurrent tasks using the same workspace', async () => {
    const info = server();
    SERVERS.unshift(info);
    const manager = makeManager();
    const results = await Promise.all(Array.from({ length: 8 }, () => manager.getClient('file.test', root)));
    expect(info.spawn).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBeInstanceOf(LspClient);
  });

  it('keeps different worktrees isolated', async () => {
    const info = server();
    SERVERS.unshift(info);
    const manager = makeManager();
    await fs.mkdir(path.join(root, 'worktree'));
    const first = await manager.getClient('file.test', root);
    const second = await manager.getClient('file.test', path.join(root, 'worktree'));
    expect(first).not.toBe(second);
    expect(info.spawn).toHaveBeenCalledTimes(2);
  });

  it('does not publish a client after shutdown races with startup', async () => {
    const info = server({ LSP_FAKE_HANG: 'initialize' });
    SERVERS.unshift(info);
    const manager = makeManager({ requestTimeoutMs: 100 });
    const result = expect(manager.getClient('file.test', root)).rejects.toThrow();
    await vi.waitFor(() => expect(info.spawn).toHaveBeenCalled());
    await manager.shutdown();
    await result;
    expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });

  it('allows discovery retry after negative-cache expiry', async () => {
    const info = server();
    const spawnClient = info.spawn;
    info.spawn = vi.fn().mockResolvedValueOnce(undefined).mockImplementation(spawnClient);
    SERVERS.unshift(info);
    const manager = makeManager({ discoveryRetryMs: 100 });
    expect(await manager.getClient('file.test', root)).toBeNull();
    expect(await manager.getClient('file.test', root)).toBeNull();
    expect(info.spawn).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(await manager.getClient('file.test', root)).toBeInstanceOf(LspClient);
  });

  it('evicts idle clients and never evicts an actively leased client at capacity', async () => {
    SERVERS.unshift(server());
    const manager = makeManager({ maxServers: 1, idleTimeoutMs: 100 });
    const target = await file();
    const result = manager.withClient(target, root, async (client) => {
      await fs.mkdir(path.join(root, 'other'));
      expect(await manager.getClient('other.test', path.join(root, 'other'))).toBeNull();
      return client;
    });
    const client = await result;
    await vi.waitFor(() => expect(client?.alive).toBe(false), {
      timeout: 1500,
    });
  });
});

describe('discovery', () => {
  it.each(['Example.csproj', 'Example.sln', 'Example.slnx'])('detects actual C# marker %s', async (marker) => {
    await file(marker, '');
    expect(await isCSharpProject(root)).toBe(true);
  });

  it('finds nested C# roots without scanning unrelated directories', async () => {
    const target = await file('nested/src/Example.cs', '');
    await file('nested/Example.csproj', '');
    expect(await findWorkspaceRoot(target, root, CSharpServer)).toBe(path.join(root, 'nested'));
  });

  it('makes Deno reachable and prevents TypeScript fallback in Deno projects', async () => {
    await file('deno.json', '{}');
    const candidates = getServersForExtension('.ts');
    expect(candidates[0]).toBe(DenoServer);
    expect(await DenoServer.matches!(root)).toBe(true);
    expect(await TypescriptServer.matches!(root)).toBe(false);
  });

  it('finds hoisted TypeScript and local workspace executables', async () => {
    const nested = path.join(root, 'packages', 'app');
    await fs.mkdir(nested, { recursive: true });
    const ts = await file('node_modules/typescript/lib/tsserver.js', '');
    const binary = await file('node_modules/.bin/pyright-langserver', '');
    await fs.chmod(binary, 0o755);
    expect(await findTsserverPath(nested)).toBe(ts);
    expect(await findBinary('pyright-langserver', nested)).toBe(binary);
  });

  it('finds PATH executables and does not use the pyright CLI as a server', async () => {
    const binary = await file('bin/pyright', '');
    await fs.chmod(binary, 0o755);
    vi.stubEnv('PATH', path.dirname(binary));
    await expect(
      PythonServer.spawn(root, context, configSchema.parse({ autoInstall: false, serverCacheDir: path.join(root, 'cache') })),
    ).rejects.toThrow('automatic installation is disabled');
    const languageServer = await file('bin/pyright-langserver', '');
    await fs.chmod(languageServer, 0o755);
    expect(await findBinary('pyright-langserver', root)).toBe(languageServer);
  });

  it('finds framework dependencies in a nested package', async () => {
    const target = await file('web/src/Example.vue', '');
    await file('web/package.json', '{"dependencies":{"vue":"3.0.0"}}');
    expect(await findWorkspaceRoot(target, root, VueServer)).toBe(path.join(root, 'web'));
  });
});

describe('edit integration', () => {
  it.each([false, true])('preserves the logger receiver with onLoad=%s', async (loaded) => {
    const logged = vi.fn();
    const createContext = (extensionName: string) => ({
      extensionName,
      log(message: string, level?: string) {
        logged(this.extensionName, message, level);
      },
      getProjectDir: () => root,
      getTaskContext: () => ({ data: { id: 'task' }, getTaskDir: () => root }),
    });
    const loadContext = createContext('load');
    const taskContext = createContext('task');
    SERVERS.unshift({
      ...server(),
      spawn: vi.fn(async () => {
        throw new Error('startup probe');
      }),
    });
    const extension = new LspExtension();
    try {
      if (loaded) await extension.onLoad(loadContext as unknown as ExtensionContext);
      await extension.onToolFinished(
        { toolName: 'power---file_edit', input: { filePath: await file() }, output: 'Edited' } as unknown as ToolFinishedEvent,
        taskContext as unknown as ExtensionContext,
      );
      expect(logged).toHaveBeenCalledWith(loaded ? 'load' : 'task', expect.stringMatching(/LSP test startup failed.*startup probe/), 'debug');
      expect(logged.mock.calls.some(([, message]) => message.includes("reading 'extensionName'"))).toBe(false);
    } finally {
      await extension.onUnload();
    }
  });

  it('awaits diagnostics in the same edit result using the worktree root', async () => {
    SERVERS.unshift(server());
    const target = await file('src/file.test');
    const extension = new LspExtension();
    const taskContext = {
      log: context.log,
      getProjectDir: () => path.dirname(root),
      getTaskContext: () => ({ data: { id: 'task' }, getTaskDir: () => root }),
    } as unknown as ExtensionContext;
    const event = {
      toolName: 'power---file_edit',
      input: { filePath: path.relative(root, target) },
      output: 'Edited',
    } as unknown as ToolFinishedEvent;
    try {
      const result = await extension.onToolFinished(event, taskContext);
      expect(result?.output).toContain('Edited');
      expect(result?.output).toContain('Benchmark error');
      await extension.onTaskClosed({ task: { id: 'task' } } as Parameters<LspExtension['onTaskClosed']>[0]);
      expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    } finally {
      await extension.onUnload();
    }
  });
});

describe('additional concurrency and platform regressions', () => {
  it('accepts versionless diagnostics as best-effort results', async () => {
    const client = await makeClient({}, { LSP_FAKE_VERSIONLESS: '1' });
    expect(await client.updateAndGetDiagnostics(await file(), 1000)).toHaveLength(1);
  });

  it('bounds simultaneously opened documents', async () => {
    const client = await makeClient({ maxOpenDocuments: 2 }, { LSP_FAKE_DELAY_MS: '30' });
    const files = await Promise.all(['a.test', 'b.test', 'c.test'].map((name) => file(name)));
    const results = await Promise.allSettled(files.map((target) => client.updateAndGetDiagnostics(target, 1000)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((client as unknown as { openFiles: Map<string, unknown> }).openFiles.size).toBe(2);
  });

  it('cancelling one shared startup waiter does not cancel another', async () => {
    const info = server();
    SERVERS.unshift(info);
    const manager = makeManager();
    const controller = new AbortController();
    const first = manager.getClient('file.test', root, controller.signal);
    const second = manager.getClient('file.test', root);
    controller.abort();
    await expect(first).rejects.toThrow();
    expect(await second).toBeInstanceOf(LspClient);
    expect(info.spawn).toHaveBeenCalledTimes(1);
  });

  it('queues distinct workspace starts under the startup concurrency limit', async () => {
    const info = server();
    const spawnServer = info.spawn;
    let active = 0;
    let peak = 0;
    info.spawn = async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        return await spawnServer(...args);
      } finally {
        active--;
      }
    };
    SERVERS.unshift(info);
    const manager = makeManager({ maxConcurrentStarts: 1 });
    const results = await Promise.all(
      ['one', 'two', 'three'].map(async (name) => {
        const workspace = path.join(root, name);
        await fs.mkdir(workspace);
        return manager.getClient('file.test', workspace);
      }),
    );
    expect(results.every((client) => client instanceof LspClient)).toBe(true);
    expect(peak).toBe(1);
  });

  it('does not fall back to TypeScript when a nested Deno server is unavailable', async () => {
    const target = await file('nested/main.ts', '');
    await file('nested/deno.json', '{}');
    vi.stubEnv('PATH', '');
    const fallback = {
      ...TypescriptServer,
      spawn: vi.fn(async () => undefined),
    };
    SERVERS.splice(0, SERVERS.length, DenoServer, fallback);
    expect(await makeManager().getClient(target, root)).toBeNull();
    expect(fallback.spawn).not.toHaveBeenCalled();
  });

  it('supports explicit server and workspace overrides without automatic installation', async () => {
    const workspace = path.join(root, 'nested');
    await fs.mkdir(workspace);
    const manager = makeManager({
      workspaceRoots: { [root]: workspace },
      servers: { csharp: { command: process.execPath, args: [fakeServer] } },
    });
    const client = await manager.getClient('example.cs', root);
    expect(client).toBeInstanceOf(LspClient);
    expect(client?.serverId).toBe('csharp');
  });

  it.skipIf(process.platform !== 'win32')('round-trips Windows drive and UNC file URLs', async () => {
    const { resolvePath } = await import('../paths');
    for (const native of ['C:\\repo\\space # %.cs', '\\\\server\\share\\file.cs']) {
      expect(resolvePath(root, fileURLToPath(pathToFileURL(native)))).toBe(resolvePath(root, native));
    }
    expect(resolvePath(root, 'c:\\repo\\file.cs')).toBe(resolvePath(root, 'C:\\repo\\file.cs'));
  });
});

describe('task lifecycle integration', () => {
  const taskContext = (id: string): ExtensionContext =>
    ({
      log: context.log,
      getProjectDir: () => root,
      getTaskContext: () => ({ data: { id }, getTaskDir: () => root }),
    }) as unknown as ExtensionContext;
  const edit = (target: string, signal?: AbortSignal) =>
    ({
      toolName: 'power---file_edit',
      input: { filePath: target },
      output: 'Edited',
      abortSignal: signal,
    }) as unknown as ToolFinishedEvent;

  it('closing one task preserves a server owned by another task', async () => {
    const info = server();
    SERVERS.unshift(info);
    const target = await file();
    const extension = new LspExtension();
    try {
      await extension.onToolFinished(edit(target), taskContext('one'));
      await extension.onToolFinished(edit(target), taskContext('two'));
      await extension.onTaskClosed({ task: { id: 'one' } } as Parameters<LspExtension['onTaskClosed']>[0]);
      expect(children[0].exitCode).toBeNull();
      expect((await extension.onToolFinished(edit(target), taskContext('two')))?.output).toContain('Benchmark error');
      expect(info.spawn).toHaveBeenCalledTimes(1);
    } finally {
      await extension.onUnload();
    }
  });

  it('propagates edit cancellation without appending stale diagnostics', async () => {
    SERVERS.unshift(server());
    const extension = new LspExtension();
    const target = await file('file.test', 'NO_PUBLICATION');
    const controller = new AbortController();
    try {
      const result = extension.onToolFinished(edit(target, controller.signal), taskContext('one'));
      setTimeout(() => controller.abort(), 50);
      expect(await result).toBeUndefined();
    } finally {
      await extension.onUnload();
    }
  });
});

describe('transport and document reuse', () => {
  it('uses increasing versions when an evicted document is reopened', async () => {
    const client = await makeClient({ maxOpenDocuments: 1 });
    const target = await file('first.test');
    await client.updateAndGetDiagnostics(target, 1000);
    const state = client as unknown as { openFiles: Map<string, number> };
    const firstVersion = state.openFiles.get(target)!;
    await client.updateAndGetDiagnostics(await file('other.test'), 1000);
    await client.updateAndGetDiagnostics(target, 1000);
    expect(state.openFiles.get(target)).toBeGreaterThan(firstVersion);
  });

  it('bounds writes when a server stops consuming stdin', async () => {
    const client = await makeClient({ requestTimeoutMs: 100, shutdownTimeoutMs: 100 }, { LSP_FAKE_BLOCK_INPUT: '1' });
    await expect(client.updateAndGetDiagnostics(await file('large.test', 'a'.repeat(1000000)), 1000)).rejects.toThrow('timed out');
    expect(client.alive).toBe(false);
  });
});

describe('discovery and late startup cancellation', () => {
  it('cancels stalled discovery without waiting for its deadline', async () => {
    const info = server();
    info.matches = vi.fn(() => new Promise<boolean>(() => undefined));
    SERVERS.unshift(info);
    const manager = makeManager();
    const controller = new AbortController();
    const result = expect(manager.getClient('file.test', root, controller.signal)).rejects.toThrow();
    await vi.waitFor(() => expect(info.matches).toHaveBeenCalled());
    controller.abort();
    await result;
    expect(info.spawn).not.toHaveBeenCalled();
  });

  it('cleans up a process returned after workspace shutdown', async () => {
    const info = server();
    const spawnServer = info.spawn;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    info.spawn = vi.fn(async (...args: Parameters<LspServerInfo['spawn']>) => {
      await gate;
      return spawnServer(...args);
    });
    SERVERS.unshift(info);
    const manager = makeManager();
    const result = expect(manager.getClient('file.test', root)).rejects.toThrow();
    await vi.waitFor(() => expect(info.spawn).toHaveBeenCalled());
    await manager.shutdownProject(root);
    await result;
    release();
    await vi.waitFor(
      () => {
        expect(children).toHaveLength(1);
        expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true);
      },
      { timeout: 3000 },
    );
  });
});
