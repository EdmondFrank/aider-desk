import path from 'node:path';
import fs from 'node:fs/promises';

import spawn from 'cross-spawn';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import { DEFAULT_CONFIG } from './config';
import { ensureServer, extensionDirectory, runInstaller } from './installation';

import { ancestors, exists, findBinary, findTsserverPath } from './executables';

export { ancestors, findBinary, findTsserverPath } from './executables';

import type { ExtensionContext } from '@aiderdesk/extensions';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LspConfig } from './config';

export type LspLogContext = Pick<ExtensionContext, 'log'>;

export interface LspServerHandle {
  process: ChildProcessWithoutNullStreams;
  initializationOptions?: Record<string, unknown>;
  processGroup?: boolean;
}

export interface LspServerInfo {
  id: string;
  languageId: string;
  extensions: string[];
  matches?(rootDir: string): Promise<boolean>;
  prepare?(rootDir: string, context: LspLogContext, config: LspConfig): Promise<void>;
  spawn(rootDir: string, context: LspLogContext, config?: LspConfig): Promise<LspServerHandle | undefined>;
}

const hasDependency = async (rootDir: string, name: string): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
    return Boolean(manifest.dependencies?.[name] || manifest.devDependencies?.[name] || manifest.peerDependencies?.[name]);
  } catch {
    return false;
  }
};

const hasMarker = async (rootDir: string, names: string[]): Promise<boolean> => {
  return (await Promise.all(names.map((name) => exists(path.join(rootDir, name))))).some(Boolean);
};

export const isCSharpProject = async (rootDir: string): Promise<boolean> => {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && (entry.name === 'omnisharp.json' || /\.(csproj|sln|slnx)$/i.test(entry.name)));
  } catch {
    return false;
  }
};

const isDenoProject = (rootDir: string) => hasMarker(rootDir, ['deno.json', 'deno.jsonc']);

const start = async (
  command: string,
  args: string[],
  rootDir: string,
  context: LspLogContext,
  env?: NodeJS.ProcessEnv,
): Promise<ChildProcessWithoutNullStreams> => {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  }) as ChildProcessWithoutNullStreams;
  child.stderr.resume();
  child.on('error', (error) => context.log(`LSP process error: ${error.message}`, 'debug'));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('LSP spawn timed out'));
    }, 10000);
    child.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return child;
};

interface ServerDefinition {
  id: string;
  languageId: string;
  extensions: string[];
  binaries: string[];
  args: string[];
  matches?: (rootDir: string) => Promise<boolean>;
  options?: (rootDir: string) => Promise<Record<string, unknown> | undefined>;
}

const resolveCommand = async (definition: ServerDefinition, rootDir: string, context: LspLogContext, config: LspConfig) => {
  const override = config.servers[definition.id];
  if (override) return { command: override.command, args: override.args, env: undefined };
  for (const name of definition.binaries) {
    const command = await findBinary(name, rootDir);
    if (command) {
      if (definition.id === 'rust' && config.autoInstall) {
        try {
          await runInstaller(command, ['--version'], rootDir, AbortSignal.timeout(10000));
        } catch {
          break;
        }
      }
      return { command, args: name === 'csharp-ls' ? [] : definition.args, env: undefined };
    }
  }
  const managed = await ensureServer(definition.id, context, config);
  const args = [...managed.args];
  if (definition.id === 'java') {
    const workspace = createHash('sha256').update(rootDir).digest('hex').slice(0, 16);
    args.push(
      '-data',
      path.join(config.serverCacheDir || path.join(homedir(), '.aider-desk', 'cache', 'lsp'), 'java-workspaces', `${workspace}-${process.pid}`),
    );
  } else if (definition.id !== 'csharp') args.push(...definition.args);
  return { ...managed, args };
};

const defineServer = (definition: ServerDefinition): LspServerInfo => ({
  id: definition.id,
  languageId: definition.languageId,
  extensions: definition.extensions,
  matches: definition.matches,
  async prepare(rootDir, context, config) {
    await resolveCommand(definition, rootDir, context, config);
  },
  async spawn(rootDir, context, config = DEFAULT_CONFIG) {
    const override = config.servers[definition.id];
    if (!override && definition.matches && !(await definition.matches(rootDir))) return undefined;
    const resolved = await resolveCommand(definition, rootDir, context, config);
    const initializationOptions = override?.initializationOptions ?? (await definition.options?.(rootDir));
    return {
      process: await start(resolved.command, resolved.args, rootDir, context, resolved.env),
      initializationOptions,
      processGroup: process.platform !== 'win32',
    };
  },
});

const tsOptions = async (rootDir: string): Promise<Record<string, unknown> | undefined> => {
  const server = (await findTsserverPath(rootDir)) ?? (await findTsserverPath(extensionDirectory));
  return server ? { typescript: { tsdk: path.dirname(server) } } : undefined;
};

const tsExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
export const DenoServer = defineServer({
  id: 'deno',
  languageId: 'typescript',
  extensions: tsExtensions,
  binaries: ['deno'],
  args: ['lsp'],
  matches: isDenoProject,
  options: async () => ({ enable: true, lint: true }),
});
export const TypescriptServer = defineServer({
  id: 'typescript',
  languageId: 'typescript',
  extensions: tsExtensions,
  binaries: ['typescript-language-server'],
  args: ['--stdio'],
  matches: async (root) => !(await isDenoProject(root)),
  options: async (root) => {
    const server = (await findTsserverPath(root)) ?? (await findTsserverPath(extensionDirectory));
    return server ? { tsserver: { path: server } } : undefined;
  },
});
export const PythonServer = defineServer({
  id: 'python',
  languageId: 'python',
  extensions: ['.py', '.pyi', '.pyw'],
  binaries: ['pyright-langserver'],
  args: ['--stdio'],
});
export const VueServer = defineServer({
  id: 'vue',
  languageId: 'vue',
  extensions: ['.vue'],
  binaries: ['vue-language-server', 'volar'],
  args: ['--stdio'],
  matches: (root) => hasDependency(root, 'vue'),
  options: async (root) => ({ ...(await tsOptions(root)), vue: { hybridMode: false } }),
});
export const RustServer = defineServer({
  id: 'rust',
  languageId: 'rust',
  extensions: ['.rs'],
  binaries: ['rust-analyzer'],
  args: [],
  matches: (root) => hasMarker(root, ['Cargo.toml']),
});
export const GoServer = defineServer({
  id: 'go',
  languageId: 'go',
  extensions: ['.go'],
  binaries: ['gopls'],
  args: ['serve'],
  matches: (root) => hasMarker(root, ['go.mod']),
});
export const JavaServer = defineServer({
  id: 'java',
  languageId: 'java',
  extensions: ['.java', '.gradle', '.groovy'],
  binaries: ['jdtls'],
  args: [],
  matches: (root) => hasMarker(root, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']),
});
export const LuaServer = defineServer({
  id: 'lua',
  languageId: 'lua',
  extensions: ['.lua'],
  binaries: ['lua-language-server'],
  args: [],
});
export const SvelteServer = defineServer({
  id: 'svelte',
  languageId: 'svelte',
  extensions: ['.svelte'],
  binaries: ['svelteserver'],
  args: ['--stdio'],
  matches: (root) => hasDependency(root, 'svelte'),
});
export const AstroServer = defineServer({
  id: 'astro',
  languageId: 'astro',
  extensions: ['.astro'],
  binaries: ['astro-ls'],
  args: ['--stdio'],
  matches: (root) => hasDependency(root, 'astro'),
  options: tsOptions,
});
export const CSharpServer = defineServer({
  id: 'csharp',
  languageId: 'csharp',
  extensions: ['.cs', '.csx'],
  binaries: ['omnisharp', 'OmniSharp', 'csharp-ls'],
  args: ['-lsp'],
  matches: isCSharpProject,
});

export const SERVERS: LspServerInfo[] = [
  DenoServer,
  TypescriptServer,
  PythonServer,
  VueServer,
  RustServer,
  GoServer,
  JavaServer,
  LuaServer,
  SvelteServer,
  AstroServer,
  CSharpServer,
];
export const getServersForExtension = (extension: string): LspServerInfo[] =>
  SERVERS.filter((server) => server.extensions.includes(extension.toLowerCase()));
export const getServerForExtension = (extension: string): LspServerInfo | undefined => getServersForExtension(extension)[0];
export const getServerForLanguageId = (languageId: string): LspServerInfo | undefined => SERVERS.find((server) => server.languageId === languageId);

export const findWorkspaceRoot = async (file: string, workspace: string, server: LspServerInfo): Promise<string> => {
  if (!server.matches || (await server.matches(workspace))) {
    return workspace;
  }
  for (const directory of ancestors(path.dirname(file))) {
    const relative = path.relative(workspace, directory);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      break;
    }
    if (await server.matches(directory)) {
      return directory;
    }
    if (directory === workspace) {
      break;
    }
  }
  return workspace;
};
