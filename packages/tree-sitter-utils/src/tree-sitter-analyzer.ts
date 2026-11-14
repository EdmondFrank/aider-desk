import * as path from 'path';

import { TreeSitterParser } from './tree-sitter-parser';
import { SymbolExtractor } from './symbol-extractor';
import { DependencyIndex } from './dependency-index';
import { TreeRenderer } from './tree-renderer';
import { CacheManager } from './cache-manager';
import { getAllFiles } from './file-utils';
import { RepoMapOptions, SymbolOptions, Symbol, ParseResult } from './types';

export class TreeSitterAnalyzer {
  private readonly parser = new TreeSitterParser();
  private readonly symbolExtractor = new SymbolExtractor(this.parser);
  private readonly treeRenderer = new TreeRenderer();
  private readonly cacheManager: CacheManager;
  private initialization: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private graph: DependencyIndex | undefined;
  private revision = -1;
  private outputs = new Map<string, string>();

  constructor(options: { cachePath?: string } = {}) {
    this.cacheManager = new CacheManager(options.cachePath);
    this.symbolExtractor.setCacheManager(this.cacheManager);
  }

  initialize(): Promise<void> {
    this.initialization ??= Promise.all([this.parser.initialize(), this.cacheManager.initialize()]).then(() => undefined);
    return this.initialization;
  }

  getRepoMap(options: RepoMapOptions): Promise<string> {
    const result = this.queue.then(() => this.generateRepoMap(options));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async generateRepoMap(options: RepoMapOptions): Promise<string> {
    options.signal?.throwIfAborted();
    await this.initialize();
    const root = path.resolve(options.root);
    const normalize = (files: Set<string> = new Set()): Set<string> =>
      new Set([...files].map((file) => path.relative(root, path.resolve(root, file)).replaceAll(path.sep, '/')));
    const mentionedFiles = normalize(options.mentionedFiles);
    const chatFiles = normalize(options.chatFiles);
    const mentionedIdents = options.mentionedIdents ?? new Set<string>();
    const files = options.files?.length ? options.files.map((file) => path.resolve(root, file)) : await getAllFiles(root, options.excludePatterns);
    options.signal?.throwIfAborted();
    const tags = await this.symbolExtractor.extractTags(files, root, options.signal, true);
    if (!tags.length) return '';
    if (this.revision !== this.symbolExtractor.revision) {
      this.graph = new DependencyIndex(tags);
      this.revision = this.symbolExtractor.revision;
      this.outputs.clear();
    }
    if (options.prepareOnly) return '';
    const key = JSON.stringify([[...mentionedFiles].sort(), [...mentionedIdents].sort(), [...chatFiles].sort(), options.maxLines]);
    const cached = this.outputs.get(key);
    if (cached !== undefined) return cached;
    options.signal?.throwIfAborted();
    const ranked = this.graph!.rank(mentionedFiles, mentionedIdents);
    options.signal?.throwIfAborted();
    const output = await this.treeRenderer.render(ranked, chatFiles, options.maxLines, root);
    options.signal?.throwIfAborted();
    if (this.outputs.size >= 8) this.outputs.delete(this.outputs.keys().next().value!);
    this.outputs.set(key, output);
    return output;
  }

  extractSymbols(filePaths: string[], options?: SymbolOptions): Promise<Symbol[]> {
    const result = this.queue.then(async () => {
      await this.initialize();
      if (options?.useCache === false) this.symbolExtractor.setCacheManager(null);
      try {
        const tags = await this.symbolExtractor.extractTags(filePaths, options?.rootDir);
        return tags.map((tag) => ({
          name: tag.name,
          kind: tag.kind,
          line: tag.line,
          file: tag.fname,
          relativeFile: tag.rel_fname,
        }));
      } finally {
        this.symbolExtractor.setCacheManager(this.cacheManager);
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    await this.initialize();
    const { detectLanguage } = await import('./language-detector');
    return {
      tags: await this.parser.parseFile(filePath),
      file: filePath,
      language: detectLanguage(filePath) || 'unknown',
    };
  }

  async dispose(): Promise<void> {
    await this.queue;
    await this.parser.dispose();
    this.cacheManager.close();
    this.graph = undefined;
    this.outputs.clear();
  }
}
