import * as path from 'path';

import { glob } from 'glob';
import { Minimatch } from 'minimatch';
import { simpleGit } from 'simple-git';

import logger from './logger';

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'out/**',
  'coverage/**',
  '*.min.js',
  '*.min.css',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const getAllFilesFromGit = async (baseDir: string): Promise<string[] | null> => {
  try {
    const result = await simpleGit(baseDir).raw(['ls-files', '-z']);
    return result
      .split(String.fromCharCode(0))
      .filter(Boolean)
      .map((file) => path.resolve(baseDir, file));
  } catch (error) {
    logger.debug('Git discovery unavailable, falling back to filesystem', error);
    return null;
  }
};

export const getAllFiles = async (baseDir: string, excludePatterns: string[] = []): Promise<string[]> => {
  const ignore = [...DEFAULT_IGNORE_PATTERNS, ...excludePatterns];
  const matchers = ignore.map((pattern) => ({
    regex: new Minimatch(pattern, { dot: true }).makeRe(),
    basename: !pattern.includes('/'),
  }));
  const gitFiles = await getAllFilesFromGit(baseDir);
  if (gitFiles !== null) {
    return gitFiles.filter((file) => {
      const relative = path.relative(baseDir, file).split(path.sep).join('/');
      const basename = path.basename(file);
      return !matchers.some((matcher) => matcher.regex && matcher.regex.test(matcher.basename ? basename : relative));
    });
  }
  try {
    return await glob('**/*', { cwd: baseDir, nodir: true, absolute: true, dot: false, ignore });
  } catch (error) {
    logger.error('Failed to discover repository files:', error);
    return [];
  }
};
