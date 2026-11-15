import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import spawn from 'cross-spawn';
import treeKill from 'tree-kill';

import { withDeadline } from './async';
import { exists, findBinary } from './executables';
import { installArchiveServer } from './native-installation';

import type { LspConfig } from './config';
import type { LspLogContext } from './lsp-servers';

export interface ServerCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

interface NodePackage {
  name: string;
  version: string;
  binary: string;
}

export const NODE_SERVERS: Record<string, NodePackage[]> = {
  typescript: [
    { name: 'typescript-language-server', version: '4.3.4', binary: 'lib/cli.mjs' },
    { name: 'typescript', version: '5.9.3', binary: '' },
  ],
  python: [{ name: 'pyright', version: '1.1.414', binary: 'langserver.index.js' }],
  vue: [
    { name: '@vue/language-server', version: '2.2.12', binary: 'bin/vue-language-server.js' },
    { name: 'typescript', version: '5.9.3', binary: '' },
  ],
  svelte: [{ name: 'svelte-language-server', version: '0.18.6', binary: 'bin/server.js' }],
  astro: [
    { name: '@astrojs/language-server', version: '2.17.3', binary: 'bin/nodeServer.js' },
    { name: 'typescript', version: '5.9.3', binary: '' },
  ],
  deno: [{ name: 'deno', version: '2.9.6', binary: 'bin.cjs' }],
};

export const extensionDirectory = path.dirname(fileURLToPath(import.meta.url));
export const nodeCommand = (entry: string): ServerCommand => ({ command: process.execPath, args: [entry], env: { ELECTRON_RUN_AS_NODE: '1' } });
const installations = new Map<string, { promise: Promise<ServerCommand>; controller: AbortController }>();
let runningInstalls = 0;
const installSlots = new Set<() => void>();

const withInstallSlot = async (operation: () => Promise<ServerCommand>, signal: AbortSignal): Promise<ServerCommand> => {
  while (runningInstalls >= 2) {
    let release: () => void = () => undefined;
    const available = new Promise<void>((resolve) => {
      release = resolve;
      installSlots.add(resolve);
    });
    try {
      await withDeadline(available, 900000, signal);
    } finally {
      installSlots.delete(release);
    }
  }
  signal.throwIfAborted();
  runningInstalls++;
  try {
    return await operation();
  } finally {
    runningInstalls--;
    for (const release of installSlots) release();
    installSlots.clear();
  }
};

export const runInstaller = async (
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = {},
): Promise<string> => {
  signal.throwIfAborted();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.stdin?.end();
  let output = '';
  const capture = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const terminate = () => {
    if (!child.pid) return;
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* The installer may already have exited. */
      }
    } else {
      treeKill(child.pid, 'SIGKILL', () => undefined);
    }
  };
  signal.addEventListener('abort', terminate, { once: true });
  if (signal.aborted) terminate();
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 && !signal.aborted ? resolve() : reject(signal.reason ?? new Error(`${path.basename(command)} failed (${code}): ${output}`)),
      );
    });
    return output.trim();
  } finally {
    signal.removeEventListener('abort', terminate);
  }
};

const acquireLock = async (directory: string, signal: AbortSignal): Promise<() => Promise<void>> => {
  const lock = `${directory}.lock`;
  await fs.mkdir(path.dirname(directory), { recursive: true });
  while (true) {
    signal.throwIfAborted();
    try {
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
      return () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const { pid } = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')) as { pid: number };
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') await fs.rm(lock, { recursive: true, force: true });
        }
      } catch {
        if (Date.now() - (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 10000)
          await fs.rm(lock, { recursive: true, force: true });
      }
      await withDeadline(
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 100);
          timer.unref();
        }),
        1000,
        signal,
      );
    }
  }
};

const runtime = async (name: string, directory: string): Promise<string> => {
  const executable = await findBinary(name, directory);
  if (!executable) throw new Error(`Automatic LSP setup requires ${name} on PATH. Install its runtime/toolchain and retry.`);
  return executable;
};

const install = async (id: string, directory: string, signal: AbortSignal): Promise<ServerCommand> => {
  const packages = NODE_SERVERS[id];
  if (packages) {
    const npm = await runtime('npm', directory);
    await runInstaller(
      npm,
      [
        'install',
        '--prefix',
        directory,
        '--no-audit',
        '--no-fund',
        '--ignore-scripts',
        '--workspaces=false',
        '--package-lock=false',
        '--save-exact',
        ...packages.map((p) => `${p.name}@${p.version}`),
      ],
      directory,
      signal,
    );
    const entry = path.join(directory, 'node_modules', packages[0].name, packages[0].binary);
    if (!(await exists(entry))) throw new Error(`Installed ${packages[0].name} did not provide ${packages[0].binary}`);
    return nodeCommand(entry);
  }
  if (id === 'rust') {
    const rustup = await runtime('rustup', directory);
    await runInstaller(rustup, ['component', 'add', 'rust-analyzer'], directory, signal);
    return { command: await runInstaller(rustup, ['which', 'rust-analyzer'], directory, signal), args: [] };
  }
  if (id === 'go') {
    const go = await runtime('go', directory);
    await runInstaller(go, ['install', 'golang.org/x/tools/gopls@v0.20.0'], directory, signal, { GOBIN: directory });
    return { command: path.join(directory, process.platform === 'win32' ? 'gopls.exe' : 'gopls'), args: [] };
  }
  if (id === 'csharp') {
    const dotnet = await runtime('dotnet', directory);
    const sdk = await runInstaller(dotnet, ['--version'], directory, signal);
    const major = Number.parseInt(sdk, 10);
    if (!Number.isFinite(major) || major < 8) throw new Error('Automatic C# setup requires the .NET SDK 8 or newer.');
    const version = major >= 10 ? '0.28.0' : major >= 9 ? '0.20.0' : '0.16.0';
    await runInstaller(dotnet, ['tool', 'install', '--tool-path', directory, 'csharp-ls', '--version', version], directory, signal);
    return {
      command: path.join(directory, process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls'),
      args: [],
      env: { DOTNET_ROLL_FORWARD: 'LatestMajor' },
    };
  }
  if (id === 'java' || id === 'lua') return installArchiveServer(id, directory, signal, runInstaller, runtime);
  throw new Error(`No automatic installer is available for ${id}. Configure a server executable.`);
};

const isReady = async (command: ServerCommand): Promise<boolean> => {
  if (typeof command.command !== 'string' || !Array.isArray(command.args) || !(await exists(command.command))) return false;
  return command.env?.ELECTRON_RUN_AS_NODE !== '1' || (typeof command.args[0] === 'string' && (await exists(command.args[0])));
};

const installOnce = async (id: string, directory: string, context: LspLogContext, signal: AbortSignal): Promise<ServerCommand> => {
  const release = await acquireLock(directory, signal);
  const ready = path.join(directory, 'ready.json');
  try {
    try {
      const command = JSON.parse(await fs.readFile(ready, 'utf8')) as ServerCommand;
      if (await isReady(command)) return command;
    } catch {
      /* Incomplete installations are retried under the lock. */
    }
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
    context.log(`Installing ${id} language server automatically. First-use setup may take a few minutes.`, 'info');
    const command = await install(id, directory, signal);
    signal.throwIfAborted();
    await fs.writeFile(ready, JSON.stringify(command));
    context.log(`${id} language server installation completed.`, 'info');
    return command;
  } finally {
    await release();
  }
};

export const ensureServer = async (id: string, context: LspLogContext, config: LspConfig): Promise<ServerCommand> => {
  const packages = NODE_SERVERS[id];
  if (packages) {
    const bundled = path.join(extensionDirectory, 'node_modules', packages[0].name, packages[0].binary);
    if (await exists(bundled)) return nodeCommand(bundled);
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(packages ?? { id, installer: 1 }))
    .digest('hex')
    .slice(0, 12);
  const directory = path.join(
    config.serverCacheDir || path.join(homedir(), '.aider-desk', 'cache', 'lsp'),
    `${id}-${process.platform}-${process.arch}-${fingerprint}`,
  );
  try {
    const ready = JSON.parse(await fs.readFile(path.join(directory, 'ready.json'), 'utf8')) as ServerCommand;
    if (await isReady(ready)) return ready;
  } catch {
    /* A missing cache is installed below. */
  }
  if (!config.autoInstall) throw new Error(`${id} language server is missing and automatic installation is disabled.`);
  let active = installations.get(directory);
  if (!active) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Installing ${id} timed out after ${config.installTimeoutMs}ms`)),
      config.installTimeoutMs,
    );
    const promise = withInstallSlot(() => installOnce(id, directory, context, controller.signal), controller.signal).finally(() => {
      clearTimeout(timer);
      installations.delete(directory);
    });
    active = { promise, controller };
    installations.set(directory, active);
  }
  return active.promise;
};

export const cancelInstallations = (): void => {
  for (const installation of installations.values()) installation.controller.abort(new Error('LSP extension unloaded during installation'));
};
