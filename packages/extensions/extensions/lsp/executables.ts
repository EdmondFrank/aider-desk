import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';

export const exists = async (file: string): Promise<boolean> => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

export const ancestors = (directory: string): string[] => {
  const result: string[] = [];
  let current = path.resolve(directory);
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      return result;
    }
    current = parent;
  }
};

export const findBinary = async (name: string, rootDir: string): Promise<string | undefined> => {
  const directories = [
    ...ancestors(rootDir).map((directory) => path.join(directory, 'node_modules', '.bin')),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ];
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, `${name}${suffix}`);
      try {
        await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if ((await fs.stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }
  return undefined;
};

export const findTsserverPath = async (rootDir: string): Promise<string | undefined> => {
  for (const directory of ancestors(rootDir)) {
    const candidate = path.join(directory, 'node_modules', 'typescript', 'lib', 'tsserver.js');
    if (await exists(candidate)) {
      return candidate;
    }
  }
  const binary = await findBinary('tsserver', rootDir);
  if (binary) {
    const real = await fs.realpath(binary);
    const directory = path.dirname(real);
    for (const candidate of [
      path.resolve(directory, '../lib/tsserver.js'),
      path.join(directory, 'node_modules/typescript/lib/tsserver.js'),
      path.resolve(directory, '../lib/node_modules/typescript/lib/tsserver.js'),
    ]) {
      if (await exists(candidate)) return candidate;
    }
  }
  return undefined;
};
