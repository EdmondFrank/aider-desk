import { DatabaseSync, StatementSync } from 'node:sqlite';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { Tag } from './types';
import logger from './logger';

const getCacheDbPath = (): string => {
  const home = os.homedir();
  const directory =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches')
      : process.platform === 'win32'
        ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : path.join(home, '.cache');
  return path.join(directory, 'aiderdesk', 'tree-sitter', 'cache.db');
};

export class CacheManager {
  private db: DatabaseSync | null = null;
  private select: StatementSync | undefined;
  private insert: StatementSync | undefined;

  constructor(private readonly dbPath = getCacheDbPath()) {}

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 1000;');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS file_cache_v3 (
          file_path TEXT PRIMARY KEY,
          mtime REAL NOT NULL,
          fingerprint TEXT NOT NULL,
          tags TEXT NOT NULL
        )
      `);
      this.select = this.db.prepare('SELECT mtime, fingerprint, tags FROM file_cache_v3 WHERE file_path = ?');
      this.insert = this.db.prepare(`
        INSERT INTO file_cache_v3 (file_path, mtime, fingerprint, tags) VALUES (?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET mtime = excluded.mtime, fingerprint = excluded.fingerprint, tags = excluded.tags
      `);
    } catch (error) {
      logger.warn('[CacheManager] Persistent cache unavailable:', error);
      this.close();
    }
  }

  async getFileCache(file: string): Promise<{ tags: Tag[]; mtime: number; fingerprint: string } | null> {
    try {
      const result = this.select?.get(file) as { tags: string; mtime: number; fingerprint: string } | undefined;
      if (!result) return null;
      const stored = JSON.parse(result.tags) as {
        relative: string;
        tags: [number, string, Tag['kind'], number?][];
      };
      return {
        ...result,
        tags: stored.tags.map(([line, name, kind, count]) => ({
          fname: file,
          rel_fname: stored.relative,
          line,
          name,
          kind,
          count,
        })),
      };
    } catch (error) {
      logger.warn(`[CacheManager] Failed to read ${file}:`, error);
      return null;
    }
  }

  async setFileCache(file: string, mtime: number, tags: Tag[], fingerprint = String(mtime)): Promise<void> {
    try {
      this.insert?.run(
        file,
        mtime,
        fingerprint,
        JSON.stringify({
          relative: tags[0]?.rel_fname ?? file,
          tags: tags.map((tag) => [tag.line, tag.name, tag.kind, tag.count]),
        }),
      );
    } catch (error) {
      logger.warn(`[CacheManager] Failed to cache ${file}:`, error);
    }
  }

  async getFileMtime(file: string): Promise<number | null> {
    try {
      return (await fs.stat(file)).mtimeMs;
    } catch {
      return null;
    }
  }

  async clearCache(): Promise<void> {
    this.db?.exec('DELETE FROM file_cache_v3');
  }

  close(): void {
    this.select = undefined;
    this.insert = undefined;
    this.db?.close();
    this.db = null;
  }
}
