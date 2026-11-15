import path from 'node:path';

export const resolvePath = (root: string, file = '.'): string => {
  const resolved = path.resolve(root, file);
  if (process.platform !== 'win32') return resolved;
  return resolved.replace(/^[a-z]:/i, (drive) => drive.toUpperCase()).replace(/^\\\\[^\\]+/, (host) => host.toLowerCase());
};
