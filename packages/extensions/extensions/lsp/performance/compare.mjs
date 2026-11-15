import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const extension = path.dirname(directory);
const reference = process.argv[2] ?? 'HEAD';
const trials = Number(process.argv[3] ?? 3);
const baseline = await fs.mkdtemp(path.join(extension, 'node_modules', '.baseline-'));
const results = path.join(directory, 'results');
await fs.mkdir(results, { recursive: true });
const revision = (await execute('git', ['rev-parse', reference], { cwd: extension })).stdout.trim();
try {
  for (const name of ['lsp-client.ts', 'lsp-manager.ts', 'lsp-servers.ts']) {
    const source = await execute('git', ['show', `${reference}:packages/extensions/extensions/lsp/${name}`], { cwd: extension });
    await fs.writeFile(path.join(baseline, name), source.stdout);
  }
  for (let trial = 1; trial <= trials; trial++) {
    for (const label of ['baseline', 'optimized']) {
      const run = await execute(process.execPath, ['--expose-gc', path.join(directory, 'run.mjs'), label], {
        cwd: extension,
        env: {
          ...process.env,
          LSP_SOURCE_ROOT: label === 'baseline' ? baseline : extension,
        },
        timeout: 120000,
        maxBuffer: 1000000,
      });
      const result = {
        ...JSON.parse(run.stdout),
        baselineRevision: revision,
        trial,
      };
      await fs.writeFile(path.join(results, `${label}-${trial}.json`), JSON.stringify(result, null, 2));
      console.log(
        `${label} trial ${trial}: p50=${result.warmEditMs.p50.toFixed(2)}ms, retained=${result.measurements.retainedDiagnosticDocuments}, leaked=${result.measurements.liveProcessesAfterShutdown}`,
      );
    }
  }
} finally {
  await fs.rm(baseline, { recursive: true, force: true });
}
