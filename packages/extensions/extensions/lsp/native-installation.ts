import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { Unpack } from 'tar';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import extractZip from 'extract-zip';

import type { ServerCommand } from './installation';

type Run = (command: string, args: string[], cwd: string, signal: AbortSignal, env?: NodeJS.ProcessEnv) => Promise<string>;
type Runtime = (name: string, directory: string) => Promise<string>;

const download = async (url: string, file: string, signal: AbortSignal, expectedHash?: string): Promise<void> => {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Downloading language server failed: HTTP ${response.status}`);
  const maxBytes = 200000000;
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Language-server archive exceeds the download limit');
  const handle = await fs.open(file, 'w');
  const reader = response.body.getReader();
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > maxBytes) throw new Error('Language-server archive exceeds the download limit');
      hash.update(chunk.value);
      await handle.write(chunk.value);
    }
    if (expectedHash && hash.digest('hex') !== expectedHash) throw new Error('Language-server archive checksum mismatch');
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
};

export const extractArchive = async (archive: string, directory: string): Promise<void> => {
  let size = 0;
  let count = 0;
  const checkSize = (bytes: number) => {
    size += bytes;
    if (++count > 100000 || size > 1000000000) throw new Error('Language-server archive exceeds extraction limits');
  };
  if (archive.endsWith('.zip')) {
    await extractZip(archive, {
      dir: directory,
      onEntry: (entry) => {
        checkSize(entry.uncompressedSize);
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('Links are not allowed in language-server archives');
      },
    });
  } else {
    const unpack = new Unpack({
      cwd: directory,
      strict: true,
      filter: (name, entry) => {
        try {
          checkSize(entry.size);
          if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || ('type' in entry && ['SymbolicLink', 'Link'].includes(entry.type))) {
            throw new Error('Unsafe path or link in language-server archive');
          }
          return true;
        } catch (error) {
          unpack.abort(error instanceof Error ? error : new Error(String(error)));
          return false;
        }
      },
    });
    await pipeline(createReadStream(archive), unpack);
  }
};

const installLua = async (directory: string, signal: AbortSignal): Promise<ServerCommand> => {
  const version = '3.19.2';
  const platforms = ['linux', 'darwin', 'win32'];
  if (
    !platforms.includes(process.platform) ||
    !['x64', 'arm64'].includes(process.arch) ||
    (process.platform === 'win32' && process.arch === 'arm64')
  ) {
    throw new Error(`No automatic Lua language-server download for ${process.platform}/${process.arch}`);
  }
  const suffix = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const name = `lua-language-server-${version}-${process.platform}-${process.arch}.${suffix}`;
  const response = await fetch(`https://api.github.com/repos/LuaLS/lua-language-server/releases/tags/${version}`, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Lua release lookup failed: HTTP ${response.status}`);
  const release = (await response.json()) as { assets: { name: string; browser_download_url: string; digest?: string }[] };
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (
    !asset?.digest?.startsWith('sha256:') ||
    !asset.browser_download_url.startsWith(`https://github.com/LuaLS/lua-language-server/releases/download/${version}/`)
  ) {
    throw new Error('No checksum-verified Lua language-server asset is available');
  }
  const archive = path.join(directory, name);
  await download(asset.browser_download_url, archive, signal, asset.digest.slice(7));
  await extractArchive(archive, directory);
  await fs.unlink(archive);
  const command = path.join(directory, 'bin', process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server');
  if (process.platform !== 'win32') await fs.chmod(command, 0o755);
  return { command, args: [] };
};

const installJava = async (directory: string, signal: AbortSignal, run: Run, runtime: Runtime): Promise<ServerCommand> => {
  const java = await runtime('java', directory);
  const version = await run(java, ['-version'], directory, signal);
  const major = Number(version.match(/version "(\d+)/)?.[1]);
  if (!major || major < 21) throw new Error('Automatic Java language-server setup requires JDK 21 or newer on PATH.');
  const archive = path.join(directory, 'jdtls.tar.gz');
  const url = 'https://download.eclipse.org/jdtls/milestones/1.50.0/jdt-language-server-1.50.0-202509041425.tar.gz';
  await download(url, archive, signal);
  await extractArchive(archive, directory);
  await fs.unlink(archive);
  const jar = (await fs.readdir(path.join(directory, 'plugins'))).find(
    (name) => name.startsWith('org.eclipse.equinox.launcher_') && name.endsWith('.jar'),
  );
  if (!jar) throw new Error('Installed Java language server is missing its launcher');
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : undefined;
  if (!platform) throw new Error(`Unsupported Java language-server platform: ${process.platform}`);
  let configuration = path.join(directory, `config_${platform}${process.arch === 'arm64' ? '_arm' : ''}`);
  try {
    await fs.access(configuration);
  } catch {
    configuration = path.join(directory, `config_${platform}`);
  }
  return {
    command: java,
    args: [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Xmx1G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens',
      'java.base/java.util=ALL-UNNAMED',
      '--add-opens',
      'java.base/java.lang=ALL-UNNAMED',
      '-jar',
      path.join(directory, 'plugins', jar),
      '-configuration',
      configuration,
    ],
  };
};

export const installArchiveServer = (id: string, directory: string, signal: AbortSignal, run: Run, runtime: Runtime): Promise<ServerCommand> =>
  id === 'lua' ? installLua(directory, signal) : installJava(directory, signal, run, runtime);
