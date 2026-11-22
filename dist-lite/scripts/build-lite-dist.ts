/**
 * Compile the lite server bundle (out/server/runner-lite.js) into a standalone
 * executable with the Bun runtime embedded. Run after `npm run build:lite`.
 *
 *   bun dist-lite/scripts/build-lite-dist.ts [slug]
 *
 * slug defaults to the host platform (darwin-arm64, linux-x64, ...).
 */
import { existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const DIST_DIR = path.resolve(HERE, '..');
const OUT_DIR = path.join(DIST_DIR, 'out');
const ENTRY = path.join(ROOT, 'out', 'server', 'runner-lite.js');
const RENDERER = path.join(ROOT, 'out', 'renderer', 'index.html');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const hostSlug = (): string => {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  return `${os}-${arch}`;
};

const slug = process.argv[2] ?? hostSlug();
const outfile = path.join(OUT_DIR, `aiderdesk-lite-${slug}`);

// Loaded lazily after boot (terminal, memory embeddings, semantic search), so
// they stay external and out of the binary. The launcher points at real copies.
const EXTERNALS = ['@homebridge/node-pty-prebuilt-multiarch', '@huggingface/transformers', '@lancedb/lancedb', '@probelabs/probe'];

// istextorbinary resolves its extension lists through the `editions` autoloader,
// which cannot resolve its own package from inside a compiled executable. Point
// the three packages at their plain compiled editions instead.
const EDITION_ALIASES: Record<string, string> = {
  istextorbinary: path.join(NODE_MODULES, 'istextorbinary', 'edition-es2022', 'index.js'),
  textextensions: path.join(NODE_MODULES, 'textextensions', 'edition-es2022', 'index.js'),
  binaryextensions: path.join(NODE_MODULES, 'binaryextensions', 'edition-es2022', 'index.js'),
};

if (!existsSync(ENTRY) || !existsSync(RENDERER)) {
  console.error('error: missing build output — run `npm run build:lite` first');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const started = performance.now();
const result = await Bun.build({
  entrypoints: [ENTRY],
  target: `bun-${slug}`,
  conditions: ['module-sync'],
  external: EXTERNALS,
  plugins: [
    {
      name: 'editions-alias',
      setup(build) {
        build.onResolve({ filter: /^(istextorbinary|textextensions|binaryextensions)$/ }, (args) => ({ path: EDITION_ALIASES[args.path] }));
      },
    },
  ],
  compile: { outfile },
});

for (const log of result.logs) {
  (log.level === 'error' ? console.error : console.log)(log.message);
}
if (!result.success) {
  console.error('error: bundle failed');
  process.exit(1);
}

const size = statSync(outfile).size / (1024 * 1024);
console.log(`built ${path.relative(ROOT, outfile)} (${size.toFixed(0)} MB) in ${((performance.now() - started) / 1000).toFixed(1)}s`);
