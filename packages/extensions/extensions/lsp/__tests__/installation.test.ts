import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { c as createTar } from 'tar';

import { extractArchive } from '../native-installation';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelInstallations, ensureServer, extensionDirectory } from '../installation';
import { configSchema } from '../config';
import { LspManager } from '../lsp-manager';
import { TypescriptServer, SERVERS } from '../lsp-servers';
import LspExtension from '../index';

import type { ExtensionContext, ToolFinishedEvent } from '@aiderdesk/extensions';

let directory: string;
let cache: string;
const context = { log: vi.fn() };

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'lsp-install-test-'));
  cache = path.join(directory, 'cache');
});

afterEach(async () => {
  cancelInstallations();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

const fakeNpm = async (mode = 'success'): Promise<void> => {
  const bin = path.join(directory, 'bin');
  await fs.mkdir(bin);
  const script = path.join(bin, 'npm.cjs');
  await fs.writeFile(
    script,
    `
const fs = require('fs'); const path = require('path');
const prefix = process.argv[process.argv.indexOf('--prefix') + 1];
fs.appendFileSync(${JSON.stringify(path.join(directory, 'calls'))}, 'install\\n');
fs.writeFileSync(${JSON.stringify(path.join(directory, 'pid'))}, String(process.pid));
if (${JSON.stringify(mode)} === 'fail') { console.error('registry unavailable'); process.exit(1); }
if (${JSON.stringify(mode)} === 'hang') { setInterval(() => {}, 1000); }
else {
  const packageDir = path.join(prefix, 'node_modules', 'pyright'); fs.mkdirSync(packageDir, {recursive: true});
  fs.writeFileSync(path.join(packageDir, 'langserver.index.js'), 'process.exit(0);');
}
`,
  );
  const command = path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  await fs.writeFile(
    command,
    process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
  );
  await fs.chmod(command, 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
};

describe('automatic language-server setup', () => {
  it('runs bundled TypeScript without a project server, npm, or an edit-time download', async () => {
    vi.stubEnv('PATH', '');
    const command = await ensureServer('typescript', context, configSchema.parse({ autoInstall: false, serverCacheDir: cache }));
    expect(command.command).toBe(process.execPath);
    expect(command.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(command.args[0]).toBe(path.join(extensionDirectory, 'node_modules/typescript-language-server/lib/cli.mjs'));
    await expect(fs.stat(cache)).rejects.toThrow();
  });

  it('starts a real bundled server and reports an error in a project with no node_modules', async () => {
    const file = path.join(directory, 'example.ts');
    await fs.writeFile(file, 'export const value: number = "wrong";\n');
    vi.stubEnv('PATH', '');
    const manager = new LspManager(context, configSchema.parse({ autoInstall: false, serverCacheDir: cache, diagnosticTimeoutMs: 10000 }));
    try {
      const diagnostics = await manager.withClient(file, directory, (client) => client.updateAndGetDiagnostics(file, 10000));
      expect(diagnostics?.some((diagnostic) => diagnostic.message.includes("Type 'string' is not assignable to type 'number'"))).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it('allows first-use setup to exceed the RPC deadline without consuming that deadline', async () => {
    const definition = {
      id: 'setup-test',
      languageId: 'typescript',
      extensions: ['.setup-test'],
      prepare: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
      spawn: async () => ({
        process: spawn(process.execPath, [fileURLToPath(new URL('../performance/fake-server.mjs', import.meta.url))], { stdio: 'pipe' }),
      }),
    };
    SERVERS.unshift(definition);
    const manager = new LspManager(context, configSchema.parse({ requestTimeoutMs: 250, installTimeoutMs: 2000 }));
    try {
      expect(await manager.getClient('example.setup-test', directory)).not.toBeNull();
    } finally {
      await manager.shutdown();
      SERVERS.splice(SERVERS.indexOf(definition), 1);
    }
  });

  it('deduplicates concurrent installs, caches success, and reuses it with downloads disabled', async () => {
    await fakeNpm();
    const config = configSchema.parse({ serverCacheDir: cache });
    const commands = await Promise.all(Array.from({ length: 8 }, () => ensureServer('python', context, config)));
    expect(new Set(commands.map((command) => command.args[0])).size).toBe(1);
    expect((await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(await ensureServer('python', context, { ...config, autoInstall: false })).toEqual(commands[0]);
  });

  it('reinstalls a damaged cached Node server instead of trusting the executable alone', async () => {
    await fakeNpm();
    const config = configSchema.parse({ serverCacheDir: cache });
    const command = await ensureServer('python', context, config);
    await fs.unlink(command.args[0]);
    await ensureServer('python', context, config);
    expect((await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('reports npm failure and retries without caching a broken installation as ready', async () => {
    await fakeNpm('fail');
    const config = configSchema.parse({ serverCacheDir: cache });
    await expect(ensureServer('python', context, config)).rejects.toThrow('registry unavailable');
    await expect(ensureServer('python', context, config)).rejects.toThrow('registry unavailable');
    expect((await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('kills a hanging installer on timeout and releases its installation lock', async () => {
    await fakeNpm('hang');
    await expect(ensureServer('python', context, configSchema.parse({ serverCacheDir: cache, installTimeoutMs: 300 }))).rejects.toThrow('timed out');
    const pid = Number(await fs.readFile(path.join(directory, 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await fs.readdir(cache)).filter((entry) => entry.endsWith('.lock'))).toEqual([]);
  });

  it('deduplicates installations across separate app processes using the cache lock', async () => {
    await fakeNpm();
    const source = fileURLToPath(new URL('../installation.ts', import.meta.url));
    const configFile = fileURLToPath(new URL('../config.ts', import.meta.url));
    const jiti = createRequire(import.meta.url).resolve('jiti');
    const code = `
      const { createJiti } = require(${JSON.stringify(jiti)});
      const jiti = createJiti(${JSON.stringify(source)}, { moduleCache: false });
      (async () => {
        const { ensureServer } = await jiti.import(${JSON.stringify(source)});
        const { configSchema } = await jiti.import(${JSON.stringify(configFile)});
        await ensureServer('python', { log() {} }, configSchema.parse({ serverCacheDir: ${JSON.stringify(cache)} }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    await Promise.all([promisify(execFile)(process.execPath, ['-e', code]), promisify(execFile)(process.execPath, ['-e', code])]);
    expect((await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
  }, 15000);

  it('rejects parent paths and links in server archives before extraction', async () => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'extracted');
    await fs.mkdir(source);
    await fs.mkdir(target);
    await fs.writeFile(path.join(source, 'safe'), 'ok');
    const archive = path.join(directory, 'unsafe.tar.gz');
    await createTar({ file: archive, cwd: source, gzip: true, prefix: '../escaped' }, ['safe']);
    await expect(extractArchive(archive, target)).rejects.toThrow('Unsafe path');
    await expect(fs.stat(path.join(directory, 'escaped', 'safe'))).rejects.toThrow();
    if (process.platform !== 'win32') {
      await fs.symlink('../../outside', path.join(source, 'link'));
      await createTar({ file: archive, cwd: source, gzip: true }, ['link']);
      await expect(extractArchive(archive, target)).rejects.toThrow('Unsafe path');
    }
  });

  it('provides a useful prerequisite error without trying to install system toolchains', async () => {
    vi.stubEnv('PATH', '');
    await expect(ensureServer('go', context, configSchema.parse({ serverCacheDir: cache }))).rejects.toThrow('requires go on PATH');
  });

  it('preserves explicit commands instead of installing an alternative', async () => {
    await TypescriptServer.prepare!(
      directory,
      context,
      configSchema.parse({ autoInstall: false, serverCacheDir: cache, servers: { typescript: { command: 'custom-server', args: ['--stdio'] } } }),
    );
    await expect(fs.stat(cache)).rejects.toThrow();
  });

  it('reports setup failures in the edit result instead of silently skipping verification', async () => {
    const extension = new LspExtension();
    const manager = new LspManager(context, configSchema.parse({ autoInstall: false, serverCacheDir: cache }));
    vi.spyOn(manager, 'withClient').mockRejectedValue(new Error('registry unavailable'));
    Object.assign(extension, { manager });
    const ctx = { log: context.log, getProjectDir: () => directory, getTaskContext: () => undefined } as unknown as ExtensionContext;
    const event = {
      toolName: 'power---file_edit',
      input: { filePath: 'example.ts' },
      output: 'Successfully edited example.ts',
    } as unknown as ToolFinishedEvent;
    try {
      const result = await extension.onToolFinished(event, ctx);
      expect(result?.output).toContain('Successfully edited example.ts');
      expect(result?.output).toContain('this edit has not been verified. registry unavailable');
    } finally {
      await extension.onUnload();
    }
  });
});
