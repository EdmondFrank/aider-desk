import { mkdtemp, writeFile, rm, mkdir, readFile, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { RepoMapService } from '../dist/index';
import { TreeSitterAnalyzer } from '../src/tree-sitter-analyzer';
import { TreeSitterParser } from '../src/tree-sitter-parser';
import { TreeRenderer } from '../src/tree-renderer';
import { GraphBuilder } from '../src/graph-builder';
import { PageRankCalculator } from '../src/pagerank';
import { DependencyIndex } from '../src/dependency-index';
import type { Tag } from '../src/types';

const directories: string[] = [];
const disposables: { dispose: () => void | Promise<void> }[] = [];
const fixture = async (name = 'Alpha'): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'repo-map-test-'));
  directories.push(root);
  await writeFile(
    path.join(root, 'model.cs'),
    `namespace Demo;\npublic class ${name} { public void Execute() {} }\npublic record Payload(int Value);\npublic struct ValueType {}\npublic enum State { Ready }\npublic sealed class PrimaryConstructor(string message) : Exception(message);\n`,
  );
  await writeFile(
    path.join(root, 'consumer.cs'),
    `namespace Demo;\npublic class Consumer { public void Run() { new ${name}().Execute(); new ${name}().Execute(); } }\n`,
  );
  return root;
};
const analyzerFor = (root: string): TreeSitterAnalyzer => {
  const analyzer = new TreeSitterAnalyzer({
    cachePath: path.join(root, 'cache.db'),
  });
  disposables.push(analyzer);
  return analyzer;
};
const serviceFor = (root: string): RepoMapService => {
  const service = new RepoMapService({
    cachePath: path.join(root, 'worker-cache.db'),
  });
  disposables.push(service);
  return service;
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const disposable of disposables.splice(0)) await disposable.dispose();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('repository map generation without the extension API', () => {
  it('prewarms analysis without ranking or rendering, then reuses parsed files for the run', async () => {
    const root = await fixture();
    const analyzer = analyzerFor(root);
    const parse = vi.spyOn(TreeSitterParser.prototype, 'parseFile');
    const render = vi.spyOn(TreeRenderer.prototype, 'render');
    const rank = vi.spyOn(DependencyIndex.prototype, 'rank');
    expect(await analyzer.getRepoMap({ root, prepareOnly: true })).toBe('');
    expect(parse).toHaveBeenCalled();
    const calls = parse.mock.calls.length;
    expect(rank).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(await analyzer.getRepoMap({ root, maxLines: 100 })).toContain('class Alpha');
    expect(parse).toHaveBeenCalledTimes(calls);
    expect(rank).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it('extracts C# declarations and references and reuses compiled queries safely', async () => {
    const root = await fixture();
    const parser = new TreeSitterParser();
    disposables.push(parser);
    const files = ['model.cs', 'consumer.cs'];
    const tags = (await Promise.all(Array.from({ length: 50 }, (_, index) => parser.parseFile(path.join(root, files[index % 2]), root)))).flat();
    for (const name of ['Alpha', 'Execute', 'Payload', 'ValueType', 'State', 'PrimaryConstructor', 'Consumer', 'Run']) {
      expect(tags.some((tag) => tag.kind === 'def' && tag.name === name)).toBe(true);
    }
    expect(tags.some((tag) => tag.kind === 'ref' && tag.name === 'Alpha')).toBe(true);
    for (const tag of tags) {
      const lines = (await readFile(tag.fname, 'utf8')).split('\n');
      expect(lines[tag.line]).toContain(tag.name);
    }
  });

  it('matches expanded weighted PageRank, including repeated references and self-edge exclusion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const tags: Tag[] = [];
      for (let file = 0; file < 8; file++) {
        for (let symbol = 0; symbol < 4; symbol++) {
          const base = {
            fname: `${file}.cs`,
            rel_fname: `${file}.cs`,
            name: `getValue${symbol}`,
            line: symbol,
          };
          if ((file + symbol + seed) % 3 === 0) tags.push({ ...base, kind: 'def' });
          for (let ref = 0; ref < (file + symbol * seed) % 5; ref++) tags.push({ ...base, kind: 'ref' });
        }
      }
      const { graph } = new GraphBuilder().buildDependencyGraph(tags);
      const expected = new PageRankCalculator().calculate(graph, tags);
      const actual = new DependencyIndex(tags).rank();
      const byDefinition = new Map(expected.map((tag) => [`${tag.rel_fname}:${tag.name}`, tag.rank]));
      expect(actual).toHaveLength(expected.length);
      for (const tag of actual) expect(tag.rank).toBeCloseTo(byDefinition.get(`${tag.rel_fname}:${tag.name}`)!, 10);
    }
  });

  it('ranks an implicit hundred-million-edge graph without expanding it', () => {
    const tags: Tag[] = [];
    for (let index = 0; index < 10000; index++) {
      const base = { fname: `${index}.cs`, rel_fname: `${index}.cs`, name: 'CommonMethod', line: 0 };
      tags.push({ ...base, kind: 'def' }, { ...base, kind: 'ref', count: 100 });
    }
    const ranked = new DependencyIndex(tags).rank();
    expect(ranked).toHaveLength(10000);
    expect(ranked.every((tag) => Number.isFinite(tag.rank) && tag.rank > 0)).toBe(true);
  });

  it('applies file and identifier personalization rather than silently ignoring it', () => {
    const tags: Tag[] = ['Alpha', 'Bravo'].map((name) => ({ name, fname: `${name}.cs`, rel_fname: `${name}.cs`, line: 0, kind: 'def' }));
    const index = new DependencyIndex(tags);
    expect(index.rank(new Set(['Bravo.cs']))[0].name).toBe('Bravo');
    expect(index.rank(new Set(), new Set(['Bravo']))[0].name).toBe('Bravo');
  });

  it('preserves weights when references are compacted', async () => {
    const root = await fixture();
    const parser = new TreeSitterParser();
    disposables.push(parser);
    const files = ['model.cs', 'consumer.cs'];
    const full = (await Promise.all(files.map((file) => parser.parseFile(path.join(root, file), root)))).flat();
    const compact = (await Promise.all(files.map((file) => parser.parseFile(path.join(root, file), root, true)))).flat();
    expect(compact.length).toBeLessThan(full.length);
    expect(new DependencyIndex(compact).rank()).toEqual(new DependencyIndex(full).rank());
  });

  it('renders from the requested root, observes edits with restored mtime, and removes deleted files', async () => {
    const root = await fixture();
    const analyzer = analyzerFor(root);
    const options = { root, maxLines: 100 };
    const first = await analyzer.getRepoMap(options);
    expect(first).toContain('public class Alpha');
    expect(first).toContain('public class Consumer');
    expect(await analyzer.getRepoMap(options)).toEqual(first);
    const file = path.join(root, 'model.cs');
    const { stat } = await import('fs/promises');
    const original = await stat(file);
    await writeFile(file, 'public class Bravo {}\n');
    await utimes(file, original.atime, original.mtime);
    const changed = await analyzer.getRepoMap(options);
    expect(changed).toContain('public class Bravo');
    expect(changed).not.toContain('public class Alpha');
    await rm(file);
    expect(await analyzer.getRepoMap(options)).not.toContain('model.cs');
  });

  it('supports isolated definitions and normalized chat-file exclusion within the line budget', async () => {
    const root = await fixture();
    const analyzer = analyzerFor(root);
    expect(await analyzer.getRepoMap({ root, files: ['model.cs'], maxLines: 100 })).toContain('public class Alpha');
    const map = await analyzer.getRepoMap({
      root,
      chatFiles: new Set([path.join(root, 'model.cs')]),
      maxLines: 100,
    });
    expect(map).not.toContain('model.cs');
    expect(map).toContain('consumer.cs');
    for (const maxLines of [1, 2, 3, 4, 5, 10]) {
      const limited = await analyzer.getRepoMap({ root, maxLines });
      expect(limited.split('\n').length).toBeLessThanOrEqual(maxLines);
    }
  });

  it('reuses an unchanged snapshot but rebuilds when a new source file appears', async () => {
    const root = await fixture();
    const analyzer = analyzerFor(root);
    const rank = vi.spyOn(DependencyIndex.prototype, 'rank');
    const first = await analyzer.getRepoMap({ root, maxLines: 100 });
    expect(await analyzer.getRepoMap({ root, maxLines: 100 })).toBe(first);
    expect(rank).toHaveBeenCalledTimes(1);
    await mkdir(path.join(root, 'added'));
    await writeFile(path.join(root, 'added', 'extra.cs'), 'public class Extra {}');
    expect(await analyzer.getRepoMap({ root, maxLines: 100 })).toContain('Extra');
    expect(rank).toHaveBeenCalledTimes(2);
  });

  it('shares identical concurrent jobs and keeps different checkout roots isolated', async () => {
    const root = await fixture('Alpha');
    const other = await fixture('Bravo');
    const service = serviceFor(root);
    const outputs = await Promise.all(Array.from({ length: 4 }, () => service.getRepoMap({ root, maxLines: 100 })));
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toContain('public class Alpha');
    const second = await service.getRepoMap({ root: other, maxLines: 100 });
    expect(second).toContain('public class Bravo');
    expect(second).not.toContain('public class Alpha');
    expect(await service.getRepoMap({ root, maxLines: 100 })).toEqual(outputs[0]);
  });

  it('isolates real Git worktrees and applies glob exclusions without excluding Dialog or Clock', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'Clock.cs'), 'public class Clock {}');
    await writeFile(path.join(root, 'Dialog.cs'), 'public class Dialog {}');
    await mkdir(path.join(root, 'build'));
    await writeFile(path.join(root, 'build', 'generated.cs'), 'public class Generated {}');
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.name', 'Repository Map Test');
    await git.addConfig('user.email', 'repo-map@example.invalid');
    await git.add('.');
    await git.commit('fixture');
    const workspace = await mkdtemp(path.join(tmpdir(), 'repo-map-worktree-'));
    directories.push(workspace);
    const checkout = path.join(workspace, 'checkout');
    await git.raw(['worktree', 'add', '-b', 'alternate', checkout]);
    await writeFile(path.join(checkout, 'model.cs'), 'public class Bravo {}');
    const service = serviceFor(root);
    const original = await service.getRepoMap({ root, maxLines: 100 });
    expect(original).toContain('public class Alpha');
    expect(original).toContain('public class Clock');
    expect(original).toContain('public class Dialog');
    expect(original).not.toContain('Generated');
    const alternate = await service.getRepoMap({ root: checkout, maxLines: 100 });
    expect(alternate).toContain('public class Bravo');
    expect(alternate).not.toContain('public class Alpha');
    const excluded = await service.getRepoMap({ root, maxLines: 100, excludePatterns: ['{Clock,Dialog}.cs'] });
    expect(excluded).not.toContain('public class Clock');
    expect(excluded).not.toContain('public class Dialog');
  });

  it('reuses compact tags from a persistent cache in a new analyzer', async () => {
    const root = await fixture();
    const first = analyzerFor(root);
    const expected = await first.getRepoMap({ root, maxLines: 100 });
    await first.dispose();
    disposables.splice(disposables.indexOf(first), 1);
    const second = analyzerFor(root);
    expect(await second.getRepoMap({ root, maxLines: 100 })).toBe(expected);
  });

  it('cancels one subscriber without affecting another and restarts abandoned workers', async () => {
    const root = await fixture();
    const service = serviceFor(root);
    const first = new AbortController();
    const cancelled = service.getRepoMap({ root, signal: first.signal });
    const surviving = service.getRepoMap({ root });
    first.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    expect(await surviving).toContain('Alpha');
    const second = new AbortController();
    const abandoned = service.getRepoMap({ root, signal: second.signal });
    second.abort();
    await expect(abandoned).rejects.toThrow('cancelled');
    expect(await service.getRepoMap({ root })).toContain('Alpha');
    const preAborted = AbortSignal.abort();
    await expect(service.getRepoMap({ root, signal: preAborted })).rejects.toThrow('cancelled');
  });
});
