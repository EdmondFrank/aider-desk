'use strict';

// Fork-only: Bun does not implement the `node:sqlite` builtin (and older Bun
// releases lack `process.getBuiltinModule`). This shim exposes the subset of the
// `DatabaseSync` API used by the app, delegating to `node:sqlite` on Node and
// falling back to `bun:sqlite` on Bun. It is wired in via a vite alias in
// `vite.config.server.ts`.
//
// `createRequire` is used instead of a bare `require('bun:sqlite')` so the
// bundler does not hoist the `bun:sqlite` lookup to module scope (which would
// break the Node runtime).
const { createRequire } = require('module');

const tryRequire = (specifier) => {
  try {
    return createRequire(__filename)(specifier);
  } catch {
    return undefined;
  }
};

const createBunDatabaseSync = (Database) =>
  class BunDatabaseSync {
    constructor(path) {
      this.db = new Database(path);
    }

    exec(sql) {
      this.db.exec(sql);
    }

    prepare(sql) {
      return this.db.prepare(sql);
    }

    close() {
      this.db.close();
    }
  };

const loadDatabaseSync = () => {
  const nodeSqlite = tryRequire('node:sqlite');
  if (nodeSqlite && nodeSqlite.DatabaseSync) {
    return nodeSqlite.DatabaseSync;
  }

  const bunSqlite = tryRequire('bun:sqlite');
  if (bunSqlite && bunSqlite.Database) {
    return createBunDatabaseSync(bunSqlite.Database);
  }

  throw new Error('Unable to load a SQLite implementation (tried node:sqlite and bun:sqlite).');
};

module.exports = { DatabaseSync: loadDatabaseSync() };