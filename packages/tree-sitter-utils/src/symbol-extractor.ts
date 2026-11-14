import * as fs from 'fs/promises';
import * as path from 'path';

import { Tag } from './types';
import { TreeSitterParser } from './tree-sitter-parser';
import { isLanguageSupported } from './language-detector';
import { CacheManager } from './cache-manager';
import logger from './logger';

export class SymbolExtractor {
  private cacheManager: CacheManager | null = null;
  private memory = new Map<string, { fingerprint: string; tags: Tag[] }>();
  private lastRoot: string | undefined;
  private lastFiles = '';
  revision = 0;

  constructor(private readonly parser: TreeSitterParser) {}

  setCacheManager(cacheManager: CacheManager | null): void {
    this.cacheManager = cacheManager;
  }

  async extractTags(files: string[], rootDir?: string, signal?: AbortSignal, compactReferences = false): Promise<Tag[]> {
    const allTags: Tag[] = [];
    const supported = files.filter(isLanguageSupported);
    const fileKey = JSON.stringify([compactReferences, supported]);
    if (this.lastRoot !== rootDir || this.lastFiles !== fileKey) {
      this.revision++;
      this.memory.clear();
      this.lastRoot = rootDir;
      this.lastFiles = fileKey;
    }
    for (let i = 0; i < supported.length; i += 50) {
      signal?.throwIfAborted();
      const results = await Promise.all(
        supported.slice(i, i + 50).map(async (file) => {
          try {
            const before = await fs.stat(file);
            const fingerprint = `${compactReferences}:${before.mtimeMs}:${before.ctimeMs}:${before.size}`;
            const memory = this.memory.get(file);
            if (this.cacheManager && memory?.fingerprint === fingerprint) {
              return memory.tags;
            }
            this.revision++;
            const cached = await this.cacheManager?.getFileCache(file);
            let tags: Tag[];
            if (cached?.fingerprint === fingerprint) {
              const relative = rootDir ? path.relative(rootDir, file).replaceAll(path.sep, '/') : file;
              tags = cached.tags.map((tag) => ({
                ...tag,
                rel_fname: relative,
              }));
            } else {
              tags = await this.parser.parseFile(file, rootDir, compactReferences);
              const after = await fs.stat(file);
              if (`${compactReferences}:${after.mtimeMs}:${after.ctimeMs}:${after.size}` !== fingerprint) {
                return tags;
              }
              await this.cacheManager?.setFileCache(file, before.mtimeMs, tags, fingerprint);
            }
            this.memory.set(file, { fingerprint, tags });
            return tags;
          } catch (error) {
            this.revision++;
            this.memory.delete(file);
            logger.error(`[SymbolExtractor] Error processing ${file}:`, error);
            return [];
          }
        }),
      );
      for (const tags of results) {
        for (const tag of tags) allTags.push(tag);
      }
    }
    signal?.throwIfAborted();
    return allTags;
  }

  filterDefinitions(tags: Tag[]): Tag[] {
    return tags.filter((tag) => tag.kind === 'def');
  }

  filterReferences(tags: Tag[]): Tag[] {
    return tags.filter((tag) => tag.kind === 'ref');
  }

  groupTagsByFile(tags: Tag[]): Map<string, Tag[]> {
    const grouped = new Map<string, Tag[]>();
    for (const tag of tags) {
      const fileTags = grouped.get(tag.rel_fname) || [];
      fileTags.push(tag);
      grouped.set(tag.rel_fname, fileTags);
    }
    return grouped;
  }
}
