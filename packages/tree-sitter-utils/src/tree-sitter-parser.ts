import * as fs from 'fs/promises';
import * as path from 'path';

import { Parser, Language, Query } from 'web-tree-sitter';

import { Tag } from './types';
import { detectLanguage } from './language-detector';
import { downloadWasmForLanguage } from './wasm-downloader';
import { QUERIES_DIR } from './constants';

let runtimeInitialization: Promise<void> | undefined;

export class TreeSitterParser {
  private parser: Parser | null = null;
  private languages = new Map<string, Promise<{ language: Language; query: Query }>>();
  private initialization: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  initialize(): Promise<void> {
    this.initialization ??= this.initializeParser();
    return this.initialization;
  }

  private async initializeParser(): Promise<void> {
    runtimeInitialization ??= Parser.init();
    await runtimeInitialization;
    this.parser = new Parser();
  }

  private loadLanguage(name: string): Promise<{ language: Language; query: Query }> {
    let pending = this.languages.get(name);
    if (!pending) {
      pending = (async () => {
        const buffer = await downloadWasmForLanguage(name);
        if (!buffer) {
          throw new Error(`No WASM available for ${name}`);
        }
        const language = await Language.load(buffer);
        const source = await fs.readFile(path.join(QUERIES_DIR, `${name}-tags.scm`), 'utf-8');
        const query = new Query(language, source);
        if (name === 'c_sharp') {
          for (const capture of query.captureNames) {
            if (!capture.startsWith('name.')) query.disableCapture(capture);
          }
        }
        return { language, query };
      })();
      this.languages.set(name, pending);
      void pending.catch(() => this.languages.delete(name));
    }
    return pending;
  }

  parseFile(filePath: string, rootDir?: string, compactReferences = false): Promise<Tag[]> {
    const result = this.queue.then(() => this.parse(filePath, rootDir, compactReferences));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async parse(filePath: string, rootDir?: string, compactReferences = false): Promise<Tag[]> {
    await this.initialize();
    const name = detectLanguage(filePath);
    if (!name || !this.parser) {
      return [];
    }
    const { language, query } = await this.loadLanguage(name);
    const source = await fs.readFile(filePath, 'utf-8');
    this.parser.setLanguage(language);
    const tree = this.parser.parse(source);
    if (!tree) {
      throw new Error(`Unable to parse ${filePath}`);
    }
    try {
      const tags: Tag[] = [];
      const references = new Map<string, Tag>();
      const relative = rootDir ? path.relative(rootDir, filePath).replaceAll(path.sep, '/') : filePath;
      for (const match of query.matches(tree.rootNode)) {
        for (const capture of match.captures) {
          if (capture.name.startsWith('name.')) {
            const kind = capture.name.includes('definition') ? 'def' : 'ref';
            const name = capture.node.text;
            const previous = compactReferences && kind === 'ref' ? references.get(name) : undefined;
            if (previous) {
              previous.count = (previous.count ?? 1) + 1;
              continue;
            }
            const tag: Tag = {
              rel_fname: relative,
              fname: filePath,
              line: capture.node.startPosition.row,
              // Detach sliced node text so cached tags cannot retain entire source files.
              name: Buffer.from(name, 'utf8').toString('utf8'),
              kind,
            };
            tags.push(tag);
            if (compactReferences && kind === 'ref') references.set(tag.name, tag);
          }
        }
      }
      return tags;
    } finally {
      tree.delete();
    }
  }

  async dispose(): Promise<void> {
    await this.queue;
    for (const pending of this.languages.values()) {
      try {
        const { query } = await pending;
        query.delete();
      } catch {
        // Failed language loads have no query to release.
      }
    }
    this.languages.clear();
    this.parser?.delete();
    this.parser = null;
    this.initialization = undefined;
  }
}
