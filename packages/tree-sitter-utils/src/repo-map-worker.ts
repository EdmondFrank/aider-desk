import { parentPort, workerData } from 'worker_threads';

import { TreeSitterAnalyzer } from './tree-sitter-analyzer';
import type { RepoMapRequest, RepoMapResponse } from './repo-map-service';

const analyzers = new Map<string, TreeSitterAnalyzer>();
const configuration = workerData as { cachePath?: string };

parentPort!.on('message', async (request: RepoMapRequest) => {
  try {
    const root = request.options.root;
    let analyzer = analyzers.get(root);
    if (!analyzer) {
      if (analyzers.size >= 2) {
        const oldest = analyzers.keys().next().value!;
        await analyzers.get(oldest)!.dispose();
        analyzers.delete(oldest);
      }
      analyzer = new TreeSitterAnalyzer(configuration);
    }
    analyzers.delete(root);
    analyzers.set(root, analyzer);
    const output = await analyzer.getRepoMap(request.options);
    parentPort!.postMessage({
      id: request.id,
      output,
    } satisfies RepoMapResponse);
  } catch (error) {
    parentPort!.postMessage({
      id: request.id,
      error: String(error),
    } satisfies RepoMapResponse);
  }
});
