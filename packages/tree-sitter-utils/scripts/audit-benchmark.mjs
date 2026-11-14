import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

import { Minimatch } from 'minimatch';

const [modulePath, resultDirectory] = process.argv.slice(2);
if (!modulePath || !resultDirectory) throw new Error('Usage: node audit-benchmark.mjs <built-module> <benchmark-result-directory>');
const require = createRequire(import.meta.url);
const { RepoMapService } = require(path.resolve(modulePath));
const result = JSON.parse(await readFile(path.join(resultDirectory, 'results.json'), 'utf8'));
const map = await readFile(path.join(resultDirectory, 'cold.txt'), 'utf8');
const files = map.split('\n').filter((line) => line !== '...');
assert(files.length > 1000, 'The large-repository map should not be empty or limited to a handful of files');
assert(map.split('\n').length <= 2000);
assert.equal(new Set(files).size, files.length);
for (const file of files) {
  assert(!path.isAbsolute(file));
  assert(!['node_modules/**', '.git/**', 'dist/**', 'build/**'].some((pattern) => new Minimatch(pattern).match(file)));
  await access(path.join(result.root, file));
}
for (const scenario of ['warm-1', 'warm-2', 'concurrent-4']) {
  assert.equal(await readFile(path.join(resultDirectory, `${scenario}.txt`), 'utf8'), map);
}
const db = new DatabaseSync(path.join(result.cacheDir, 'cache.db'), {
  readOnly: true,
});
const cachedFiles = db
  .prepare('SELECT file_path FROM file_cache_v3 ORDER BY file_path')
  .all()
  .map((row) => row.file_path);
const definitionsByIdent = new Map();
const referencesByIdent = new Map();
let storedTags = 0;
let referenceOccurrences = 0;
for (const row of db.prepare('SELECT file_path, tags FROM file_cache_v3').iterate()) {
  const stored = JSON.parse(row.tags);
  storedTags += stored.tags.length;
  for (const [, name, kind, count] of stored.tags) {
    const index = kind === 'def' ? definitionsByIdent : referencesByIdent;
    let files = index.get(name);
    if (!files) index.set(name, (files = new Set()));
    files.add(row.file_path);
    if (kind === 'ref') referenceOccurrences += count ?? 1;
  }
}
let expandedEdges = 0;
for (const [name, definers] of definitionsByIdent) {
  const sources = referencesByIdent.get(name);
  if (!sources) continue;
  for (const source of sources) expandedEdges += definers.size - Number(definers.has(source));
}
const csharp = cachedFiles.filter((file) => file.endsWith('.cs'));
const samples = Array.from({ length: 100 }, (_, index) => csharp[Math.floor((index * csharp.length) / 100)]);
let definitionsChecked = 0;
let referencesChecked = 0;
let declarationsChecked = 0;
const select = db.prepare('SELECT tags FROM file_cache_v3 WHERE file_path = ?');
for (const file of samples) {
  const source = await readFile(file, 'utf8');
  const lines = source.split('\n');
  const stored = JSON.parse(select.get(file).tags);
  for (const [line, name, kind] of stored.tags) {
    assert(lines[line]?.includes(name), `${file}:${line + 1}: missing ${name}`);
    if (kind === 'def') definitionsChecked++;
    else referencesChecked++;
  }
  const declarations = [
    ...source.matchAll(
      /^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|ref|new|file)\s+)*(?:class|interface|record(?:\s+(?:class|struct))?|struct|enum)\s+(\w+)/gm,
    ),
  ];
  for (const declaration of declarations) {
    assert(
      stored.tags.some((tag) => tag[1] === declaration[1] && tag[2] === 'def'),
      `${file}: missing declaration ${declaration[1]}`,
    );
    declarationsChecked++;
  }
}
db.close();
const service = new RepoMapService({
  cachePath: path.join(result.cacheDir, 'cache.db'),
});
try {
  const selected = samples.slice(0, 8);
  const detailed = await service.getRepoMap({
    root: result.root,
    files: selected,
    maxLines: 2000,
  });
  assert(detailed.includes('└── ') || detailed.includes('├── '));
  let currentFile;
  let renderedLines = 0;
  for (const line of detailed.split('\n')) {
    if (!line) continue;
    if (line.endsWith(':') && !line.startsWith('├── ') && !line.startsWith('└── ')) {
      currentFile = line.slice(0, -1);
      assert(selected.includes(path.join(result.root, currentFile)));
    } else if (line.startsWith('├── ') || line.startsWith('└── ')) {
      assert(currentFile);
      const content = line.slice(4);
      if (content === '...') continue;
      const source = await readFile(path.join(result.root, currentFile), 'utf8');
      assert(
        source.split('\n').some((sourceLine) => {
          const trimmed = sourceLine.trim();
          return (trimmed.length > 100 ? trimmed.slice(0, 97) + '...' : trimmed) === content;
        }),
        `Rendered line does not match ${currentFile}: ${content}`,
      );
      renderedLines++;
    }
  }
  assert(renderedLines > 10);
  await writeFile(path.join(resultDirectory, 'detailed-sample.txt'), detailed);
  const audit = {
    cachedFiles: cachedFiles.length,
    cachedCsharpFiles: csharp.length,
    storedTags,
    referenceOccurrences,
    expandedEdges,
    listedFilesVerified: files.length,
    sampledCsharpFiles: samples.length,
    definitionsChecked,
    referencesChecked,
    declarationsChecked,
    renderedLinesVerified: renderedLines,
    warmAndConcurrentOutputIdentical: true,
  };
  await writeFile(path.join(resultDirectory, 'audit.json'), JSON.stringify(audit, null, 2));
  process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
} finally {
  service.dispose();
}
