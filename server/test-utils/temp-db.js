// server/test-utils/temp-db.js
//
// Canonical disposable test database helpers.
//
// Phase-0 process integrity rebuild. Every test that needs a database
// MUST go through these helpers. No test is allowed to point at the
// repository's default DB or any other persistent location.
//
// All helpers:
//   - create a fresh unique directory under os.tmpdir() (mkdtemp)
//   - never resolve a path inside the repository
//   - close database handles on cleanup
//   - delete the temp directory and any SQLite WAL / SHM siblings on cleanup
//   - provide a SHA-256 / size sentinel helper for cross-test guards

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db.js';
import { resolveDatabaseConfig } from '../database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultRepoDb = resolve(repoRoot, 'data', 'erp.db');

function assertNotRepoPath(path, label) {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be absolute: ${path}`);
  }
  const resolved = resolve(path);
  if (resolved === defaultRepoDb) {
    throw new Error(`${label} must NOT point at the repository default DB (${defaultRepoDb})`);
  }
  if (
    resolved === repoRoot ||
    resolved.startsWith(repoRoot + sep) ||
    resolved.startsWith(repoRoot + '/') ||
    resolved.startsWith(repoRoot + '\\')
  ) {
    throw new Error(`${label} must NOT live inside the repository (${repoRoot}): ${resolved}`);
  }
}

export function getRepoRoot() {
  return repoRoot;
}

export function getDefaultRepoDb() {
  return defaultRepoDb;
}

export function createTempDir(label = 'db') {
  const safeLabel = String(label).replace(/[^a-z0-9-]+/gi, '-').slice(0, 32) || 'db';
  return mkdtempSync(join(tmpdir(), `modern-erp-${safeLabel}-`));
}

/**
 * Open a fresh, fully-initialized disposable SQLite database inside a
 * unique temp directory.
 *
 * Returns a handle exposing:
 *   - dir:        the unique temp directory
 *   - dbPath:     absolute path of the .db file
 *   - walPath:    absolute path of the SQLite -wal sibling (may not exist yet)
 *   - shmPath:    absolute path of the SQLite -shm sibling (may not exist yet)
 *   - db:         open DatabaseSync handle
 *   - close():    close the DB handle
 *   - cleanup():  close + delete dir + WAL/SHM siblings
 */
export function createTempDb({
  label = 'db',
  filename,
  production = false,
} = {}) {
  if (process.env.ERP_TEST_DB_BACKEND === 'mysql') {
    if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
      throw new Error('MySQL integration tests require ERP_MYSQL_TEST_ALLOW_RESET=true');
    }
    const config = resolveDatabaseConfig({ backend: 'mysql' });
    if (!/(?:test|phase7a|disposable)/i.test(config.database)) {
      throw new Error(`Refusing MySQL test reset for non-test database: ${config.database}`);
    }
    const previousSeed = process.env.ERP_SEED_DEMO;
    const previousNode = process.env.NODE_ENV;
    if (production) {
      process.env.NODE_ENV = 'production';
      process.env.ERP_SEED_DEMO = 'false';
    }
    let db;
    try { db = createDatabase(config); }
    finally {
      if (production) {
        if (previousSeed === undefined) delete process.env.ERP_SEED_DEMO; else process.env.ERP_SEED_DEMO = previousSeed;
        if (previousNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNode;
      }
    }
    let closed = false;
    return {
      dir: null, dbPath: null, walPath: null, shmPath: null, db,
      close() { if (!closed) { db.close(); closed = true; } },
      cleanup() {
        if (closed) return;
        try {
          db.exec('SET FOREIGN_KEY_CHECKS=0');
          for (const row of db.prepare('SHOW TABLES').all()) {
            const table = Object.values(row)[0];
            if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsafe MySQL table name: ${table}`);
            db.exec(`DROP TABLE \`${table}\``);
          }
          db.exec('SET FOREIGN_KEY_CHECKS=1');
        } finally { db.close(); closed = true; }
      },
    };
  }
  const dir = createTempDir(label);
  const dbFilename = filename || `${label}.db`;
  const dbPath = join(dir, dbFilename);
  assertNotRepoPath(dbPath, 'temp DB path');

  // Best-effort cleanup of stale files from a prior interrupted run.
  for (const stale of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(stale, { force: true }); } catch { /* ignore */ }
  }

  const previousSeed = process.env.ERP_SEED_DEMO;
  const previousNode = process.env.NODE_ENV;
  if (production) {
    process.env.NODE_ENV = 'production';
    process.env.ERP_SEED_DEMO = 'false';
  }
  let db;
  try {
    db = createDatabase(dbPath);
  } finally {
    if (production) {
      if (previousSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = previousSeed;
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
    }
  }

  let closed = false;
  return {
    dir,
    dbPath,
    walPath: `${dbPath}-wal`,
    shmPath: `${dbPath}-shm`,
    db,
    close() {
      if (closed) return;
      closed = true;
      try { db.close(); } catch { /* ignore */ }
    },
    cleanup() {
      if (!closed) {
        try { db.close(); } catch { /* ignore */ }
        closed = true;
      }
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { /* ignore */ }
    },
  };
}

/**
 * Create a sentinel file outside the target so destructive tests can prove
 * the target path did not touch it. Returns path + size + SHA-256.
 */
export function createSentinelFile({
  label = 'sentinel',
  dir,
  size = 4096,
} = {}) {
  const targetDir = dir || createTempDir('sentinel');
  const safeLabel = String(label).replace(/[^a-z0-9-]+/gi, '-').slice(0, 32) || 'sentinel';
  const path = join(targetDir, `${safeLabel}.bin`);
  assertNotRepoPath(path, 'sentinel path');
  const bytes = randomBytes(size);
  writeFileSync(path, bytes);
  return {
    path,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    dir: targetDir,
  };
}

/**
 * Re-read the sentinel and return its current size + SHA-256.
 * Throws if the sentinel no longer exists.
 */
export function readSentinel(path) {
  if (!existsSync(path)) {
    throw new Error(`sentinel disappeared: ${path}`);
  }
  const bytes = readFileSync(path);
  return {
    path,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Create a sentinel inside a temp directory and ensure cleanup happens
 * via the returned disposable handle.
 */
export function createDisposableSentinel({ label = 'sentinel', size = 4096 } = {}) {
  const handle = createSentinelFile({ label, size });
  return {
    ...handle,
    cleanup() {
      try { rmSync(handle.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { /* ignore */ }
    },
  };
}

/**
 * Run `body` with a disposable temp DB. The handle is closed and the
 * directory removed before returning, regardless of errors.
 */
export function withTempDb(body, options = {}) {
  const handle = createTempDb(options);
  try {
    return body(handle);
  } finally {
    handle.cleanup();
  }
}

export const _testInternals = {
  assertNotRepoPath,
  defaultRepoDb,
  repoRoot,
};
