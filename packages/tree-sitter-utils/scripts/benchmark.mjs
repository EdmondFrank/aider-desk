import { createRequire } from 'node:module';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [root, modulePath, outputDir, engine = 'direct', persistentCache] = process.argv.slice(2);
if (!root || !modulePath || !outputDir) {
  throw new Error('Usage: node benchmark.mjs <repository> <built-module> <output-directory>');
}
const require = createRequire(import.meta.url);
const lib = require(path.resolve(modulePath));
const cacheDir = persistentCache ? path.resolve(persistentCache) : await mkdtemp(path.join(tmpdir(), 'repo-map-benchmark-'));
await mkdir(outputDir, { recursive: true });
const errors = [];
console.log = () => {};
console.debug = () => {};
console.warn = () => {};
console.error = (...args) => errors.push(args.map(String).join(' '));
const Generator = engine === 'worker' ? lib.RepoMapService : lib.TreeSitterAnalyzer;
const analyzer = new Generator({ cachePath: path.join(cacheDir, 'cache.db') });
// Baseline versions do not accept constructor options.
if (analyzer.cacheManager) analyzer.cacheManager.dbPath = path.join(cacheDir, 'cache.db');
const phases = {};
for (const [name, object, method] of [
  ['extract', analyzer.symbolExtractor, 'extractTags'],
  ['graph', analyzer.graphBuilder, 'buildDependencyGraph'],
  ['rank', analyzer.pageRankCalculator, 'calculate'],
  ['render', analyzer.treeRenderer, 'render'],
]) {
  if (!object) continue;
  const original = object[method].bind(object);
  object[method] = (...args) => {
    const start = performance.now();
    const result = original(...args);
    const record = () => {
      phases[name] = (phases[name] || 0) + performance.now() - start;
    };
    if (result instanceof Promise) return result.finally(record);
    record();
    return result;
  };
}
const options = {
  root: path.resolve(root),
  maxLines: 2000,
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
  mentionedFiles: new Set(),
  mentionedIdents: new Set(),
  chatFiles: new Set(),
};
const results = [];
for (const scenario of ['cold', 'warm-1', 'warm-2', 'concurrent-4']) {
  for (const key of Object.keys(phases)) delete phases[key];
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  await new Promise((resolve) => setTimeout(resolve, 25));
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);
  const start = performance.now();
  const maps = await Promise.all(Array.from({ length: scenario === 'concurrent-4' ? 4 : 1 }, () => analyzer.getRepoMap(options)));
  const elapsedMs = performance.now() - start;
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  await new Promise((resolve) => setTimeout(resolve, 25));
  delay.disable();
  await writeFile(path.join(outputDir, `${scenario}.txt`), maps[0]);
  results.push({
    scenario,
    elapsedMs,
    peakRssMiB: peakRss / 1024 / 1024,
    eventLoopMaxMs: delay.max / 1e6,
    eventLoopP99Ms: delay.percentile(99) / 1e6,
    bytes: Buffer.byteLength(maps[0]),
    lines: maps[0].split('\n').length,
    concurrentIdentical: maps.every((map) => map === maps[0]),
    phases: { ...phases },
  });
  process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
}
await analyzer.dispose?.();
analyzer.cacheManager?.close();
await writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ root, engine, node: process.version, cacheDir, results, errors }, null, 2));
