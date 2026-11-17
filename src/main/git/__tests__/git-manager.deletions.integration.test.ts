import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { UpdatedFilesGroupMode } from '@common/types';

import { GitManager } from '../git-manager';

vi.unmock('fs');
vi.unmock('path');

const deletedPaths = ['text.txt', 'empty.txt', 'binary.bin', 'odd\tname\n.txt'];

describe('Updated Files deletions', () => {
  let projectPath: string;
  let manager: GitManager;

  beforeEach(async () => {
    vi.stubEnv('GIT_INDEX_FILE', undefined);
    projectPath = await mkdtemp(join(tmpdir(), 'aiderdesk-deletions-'));
    manager = new GitManager();
    const git = simpleGit(projectPath);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.invalid');
    await git.checkoutLocalBranch('main');
    for (const path of [...deletedPaths, 'cleared.txt', 'renamed.txt']) {
      const content = path === 'empty.txt' ? '' : path === 'binary.bin' ? Buffer.from([0, 1, 2, 3]) : `${path} content\n`;
      await writeFile(join(projectPath, path), content);
    }
    await git.add('.');
    await git.commit('initial');
    await git.checkoutLocalBranch('task');
  });

  afterEach(async () => {
    try {
      await rm(projectPath, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const deleteFiles = async () => {
    for (const path of deletedPaths) {
      await rm(join(projectPath, path));
    }
    await writeFile(join(projectPath, 'cleared.txt'), '');
    await simpleGit(projectPath).mv('renamed.txt', 'new-name.txt');
  };

  it.each([
    { mode: 'local' as const, group: UpdatedFilesGroupMode.Grouped, committed: false },
    { mode: 'worktree' as const, group: UpdatedFilesGroupMode.Grouped, committed: false },
    { mode: 'worktree' as const, group: UpdatedFilesGroupMode.Flat, committed: false },
    { mode: 'worktree' as const, group: UpdatedFilesGroupMode.Grouped, committed: true },
    { mode: 'worktree' as const, group: UpdatedFilesGroupMode.Flat, committed: true },
  ])('marks only deleted files in $mode/$group (committed: $committed)', async ({ mode, group, committed }) => {
    await deleteFiles();
    if (committed) {
      const git = simpleGit(projectPath);
      await git.add('-A');
      await git.commit('delete files');
      await writeFile(join(projectPath, 'text.txt'), 'recreated after deletion\n');
      await git.add('text.txt');
    }

    const files = await manager.getUpdatedFiles(projectPath, mode, 'main', group);
    const expectedDeletedPaths = committed && group === UpdatedFilesGroupMode.Flat ? deletedPaths.filter((path) => path !== 'text.txt') : deletedPaths;

    expect(
      files
        .filter((file) => file.isDeleted)
        .map((file) => file.path)
        .sort(),
    ).toEqual([...expectedDeletedPaths].sort());
    expect(files.find((file) => file.path === 'cleared.txt')).toMatchObject({ additions: 0, deletions: 1 });
    expect(files.find((file) => file.path === 'cleared.txt')?.isDeleted).toBeUndefined();
    expect(files.find((file) => file.path === 'new-name.txt')).toMatchObject({ previousPath: 'renamed.txt' });
    expect(files.find((file) => file.path === 'new-name.txt')?.isDeleted).toBeUndefined();
  });
});
