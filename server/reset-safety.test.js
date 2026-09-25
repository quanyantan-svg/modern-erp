// server/reset-safety.test.js
//
// Phase-0 reset-target safety matrix. Every test in this file exercises
// server/reset-data.js through a child process invocation and asserts one
// invariant in the destructive-reset contract.
//
// Coverage matrix:
//   A. reset-data without ERP_DB_PATH                         → REFUSE
//   B. explicit temporary ERP_DB_PATH                          → reset only that DB
//   C. production path with unsafe / missing production guard  → REFUSE
//   D. temporary target reset does not touch sibling DB files
//   E. temporary target reset does not touch repository default data DB
//   F. malformed / non-absolute path behaviour is safe
//   G. WAL / SHM cleanup applies only to the explicitly selected DB

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import { createDatabase } from './db.js';
import {
  createDisposableSentinel,
  createTempDb,
  createTempDir,
  readSentinel,
} from './test-utils/temp-db.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESET_SCRIPT = join(REPO, 'server', 'reset-data.js');
const REPO_DEFAULT_DB = join(REPO, 'data', 'erp.db');
const RESET_SOURCE = readFileSync(RESET_SCRIPT, 'utf8');
const tempDirs = new Set();

test('current guidance does not advertise the historical V1.2 production reset script', () => {
  assert.doesNotMatch(RESET_SOURCE, /scripts\/production-full-data-reset\.mjs/);
  assert.match(RESET_SOURCE, /不提供可直接执行的 V1\.3 生产全量重置工具/);
  assert.match(RESET_SOURCE, /一次性开发\/测试数据库/);
});

function runReset(env) {
  try {
    const out = execFileSync('node', [RESET_SCRIPT], {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: out.toString(), stderr: '' };
  } catch (e) {
    return {
      status: e.status ?? 1,
      stdout: (e.stdout || Buffer.alloc(0)).toString(),
      stderr: (e.stderr || Buffer.alloc(0)).toString(),
    };
  }
}

function track(dir) {
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* ignore */ }
  }
  tempDirs.clear();
});

function seed(dbPath) {
  const db = createDatabase(dbPath);
  db.prepare("INSERT OR IGNORE INTO permissions(code,name) VALUES ('X_RESET_SAFETY','reset-safety-marker')").run();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  db.close();
}

describe('A. reset-data without ERP_DB_PATH → REFUSE', () => {
  test('NODE_ENV unset → exits non-zero and never touches the repo default DB', () => {
    delete process.env.ERP_DB_PATH;
    delete process.env.NODE_ENV;
    const beforeExists = existsSync(REPO_DEFAULT_DB);
    const res = runReset({});
    assert.notEqual(res.status, 0, 'reset-data must refuse without ERP_DB_PATH');
    const combined = `${res.stdout}\n${res.stderr}`;
    assert.ok(
      combined.includes('ERP_DB_PATH') || combined.includes('默认数据库') || combined.includes('隐式'),
      `expected refuse-without-target message, got stdout="${res.stdout}" stderr="${res.stderr}"`,
    );
    assert.equal(existsSync(REPO_DEFAULT_DB), beforeExists, 'repo default DB presence must not change');
  });

  test('NODE_ENV=development → still refuses without ERP_DB_PATH', () => {
    const res = runReset({ NODE_ENV: 'development' });
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes('ERP_DB_PATH') || res.stdout.includes('ERP_DB_PATH'));
  });
});

describe('B. explicit temporary ERP_DB_PATH → reset only that DB', () => {
  test('resets the target DB and leaves siblings untouched', () => {
    const target = createTempDb({ label: 'reset-b-target', filename: 'target.db' });
    seed(target.dbPath);
    assert.ok(existsSync(target.dbPath));
    const sibling = track(createTempDir('reset-b-sibling'));
    const siblingPath = join(sibling, 'sibling.db');
    seed(siblingPath);
    assert.ok(existsSync(siblingPath));

    target.close();
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: target.dbPath });
    assert.equal(res.status, 0, `must succeed, got stderr="${res.stderr}"`);
    assert.equal(existsSync(target.dbPath), false, 'target DB must be deleted');
    assert.equal(existsSync(siblingPath), true, 'sibling DB must remain untouched');
  });

  test('target without -wal / -shm still succeeds and is removed', () => {
    const dir = track(createTempDir('reset-b-clean'));
    const dbPath = join(dir, 'no-wal.db');
    seed(dbPath);
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: dbPath });
    assert.equal(res.status, 0, `must succeed, got stderr="${res.stderr}"`);
    assert.equal(existsSync(dbPath), false);
  });
});

describe('C. production path / unsafe production guards → REFUSE', () => {
  test('NODE_ENV=production refuses even with explicit ERP_DB_PATH', () => {
    const dir = track(createTempDir('reset-c-prod-env'));
    const dbPath = join(dir, 'should-not-touch.db');
    seed(dbPath);
    assert.ok(existsSync(dbPath));
    const res = runReset({ NODE_ENV: 'production', ERP_DB_PATH: dbPath });
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes('生产环境禁止') || res.stdout.includes('生产环境禁止'));
    assert.equal(existsSync(dbPath), true, 'production guard must not delete the temp target either');
  });

  test('path containing "production" requires ERP_RESET_PRODUCTION_OK=YES', () => {
    const dir = track(createTempDir('reset-c-prod-path'));
    const dbPath = join(dir, 'my-production-db.db');
    seed(dbPath);
    const withoutSentinel = runReset({ NODE_ENV: 'development', ERP_DB_PATH: dbPath });
    assert.notEqual(withoutSentinel.status, 0, 'production-like path must refuse without sentinel');
    assert.equal(existsSync(dbPath), true, 'refusal must leave the file alone');

    // With the sentinel, the script accepts the path and deletes it.
    const withSentinel = runReset({
      NODE_ENV: 'development',
      ERP_DB_PATH: dbPath,
      ERP_RESET_PRODUCTION_OK: 'YES',
    });
    assert.equal(withSentinel.status, 0, `with sentinel must succeed, got stderr="${withSentinel.stderr}"`);
    assert.equal(existsSync(dbPath), false, 'with sentinel the file must be deleted');
  });

  test('NODE_ENV=production + path containing "production" + ERP_RESET_PRODUCTION_OK=YES still refuses', () => {
    const dir = track(createTempDir('reset-c-prod-strict'));
    const dbPath = join(dir, 'strict-production.db');
    seed(dbPath);
    const res = runReset({
      NODE_ENV: 'production',
      ERP_DB_PATH: dbPath,
      ERP_RESET_PRODUCTION_OK: 'YES',
    });
    assert.notEqual(res.status, 0, 'NODE_ENV=production must always refuse');
    assert.equal(existsSync(dbPath), true);
  });
});

describe('D. temporary target reset does not touch sibling DB files', () => {
  test('resets only the explicit target; leaves every other sibling file untouched', () => {
    const root = createTempDir('reset-d-siblings');
    track(root);
    const targetPath = join(root, 'target.db');
    const siblingPaths = [
      join(root, 'sibling-1.db'),
      join(root, 'sibling-2.db'),
      join(root, 'sub', 'sibling-3.db'),
    ];
    seed(targetPath);
    for (const path of siblingPaths) {
      mkdirSyncSafe(dirname(path));
      seed(path);
    }

    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: targetPath });
    assert.equal(res.status, 0);
    assert.equal(existsSync(targetPath), false, 'target must be deleted');
    for (const path of siblingPaths) {
      assert.equal(existsSync(path), true, `sibling must be untouched: ${path}`);
    }
  });

  test('resets only the target; leaves a sentinel file in the same directory untouched', () => {
    const sentinel = createDisposableSentinel({ label: 'sibling-sentinel', size: 2048 });
    const target = createTempDb({ label: 'reset-d-target', filename: 'target.db' });
    const before = readSentinel(sentinel.path);
    seed(target.dbPath);
    target.close();

    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: target.dbPath });
    assert.equal(res.status, 0);
    assert.equal(existsSync(target.dbPath), false);

    const after = readSentinel(sentinel.path);
    assert.equal(after.size, before.size, 'sibling sentinel size unchanged');
    assert.equal(after.sha256, before.sha256, 'sibling sentinel SHA-256 unchanged');
  });
});

describe('E. temporary target reset does not touch repository default data DB', () => {
  test('repo default DB path is computed correctly', () => {
    assert.equal(REPO_DEFAULT_DB, join(REPO, 'data', 'erp.db'));
  });

  test('reset-data never resolves to the repo default DB on its own', () => {
    assert.equal(existsSync(REPO_DEFAULT_DB), false, 'precondition: repo default DB absent');
    const res = runReset({ NODE_ENV: 'development' });
    assert.notEqual(res.status, 0, 'reset must refuse without explicit target');
    assert.equal(existsSync(REPO_DEFAULT_DB), false);
  });

  test('reset-data refuses if a caller points ERP_DB_PATH at the repo default DB', () => {
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: REPO_DEFAULT_DB });
    assert.notEqual(res.status, 0);
    const combined = `${res.stdout}\n${res.stderr}`;
    assert.ok(combined.includes('仓库默认数据库') || combined.includes('默认数据库'));
    assert.equal(existsSync(REPO_DEFAULT_DB), false);
  });

  test('reset-data refuses if ERP_DB_PATH points anywhere inside the repository', () => {
    const insidePath = join(REPO, 'data', 'inside-erp.db');
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: insidePath });
    assert.notEqual(res.status, 0, 'must refuse paths inside the repo');
    assert.equal(existsSync(insidePath), false);
  });
});

describe('F. malformed / non-absolute path behaviour is safe', () => {
  test('relative path is rejected', () => {
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: 'data/erp.db' });
    assert.notEqual(res.status, 0, 'relative path must be rejected');
    const combined = `${res.stdout}\n${res.stderr}`;
    assert.ok(combined.includes('绝对路径') || combined.includes('绝对'));
  });

  test('empty string ERP_DB_PATH is rejected', () => {
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: '' });
    assert.notEqual(res.status, 0);
  });

  test('whitespace-only ERP_DB_PATH is rejected', () => {
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: '   ' });
    assert.notEqual(res.status, 0);
  });

  test('parent-traversal-style absolute path that collapses to repo default is rejected', () => {
    // <repo>/foo/../data/erp.db collapses to <repo>/data/erp.db which is the
    // repository default DB. The repo-default guard must catch this even
    // though the caller's input was not literally "the repo default DB".
    const collapse = resolve(REPO, 'foo', '..', 'data', 'erp.db');
    assert.equal(collapse, REPO_DEFAULT_DB, 'precondition: collapsed path must equal repo default DB');
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: collapse });
    assert.notEqual(res.status, 0, `must refuse repo-default via traversal, got stderr="${res.stderr}"`);
    assert.equal(existsSync(collapse), false);
  });

  test('absolute path that lives inside the repo (not at the default) is rejected', () => {
    // <repo>/data/some-internal.db is inside the repository but is not the
    // default DB. The "must live outside the repository" guard must catch it.
    const insideRepo = join(REPO, 'data', 'some-internal-inside-repo.db');
    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: insideRepo });
    assert.notEqual(res.status, 0, 'must refuse paths inside the repo');
    assert.equal(existsSync(insideRepo), false);
  });
});

describe('G. WAL / SHM cleanup applies only to the explicitly selected DB', () => {
  test('reset of target deletes target + -wal + -shm; sibling -wal / -shm untouched', () => {
    const root = track(createTempDir('reset-g-siblings'));
    const targetPath = join(root, 'target.db');
    const siblingPath = join(root, 'sibling.db');
    seed(targetPath);
    seed(siblingPath);
    // SQLite's auto-checkpoint can collapse the WAL/SHM on close. To make
    // the test deterministic we explicitly write the sibling -wal/-shm
    // artifacts after seeding; the target also gets explicit artifacts so
    // the script's delete logic has something to remove.
    for (const path of [targetPath, siblingPath]) {
      writeFileSync(`${path}-wal`, 'wal-bytes');
      writeFileSync(`${path}-shm`, 'shm-bytes');
    }
    assert.ok(existsSync(`${siblingPath}-wal`));
    assert.ok(existsSync(`${siblingPath}-shm`));

    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: targetPath });
    assert.equal(res.status, 0);
    for (const path of [targetPath, `${targetPath}-wal`, `${targetPath}-shm`]) {
      assert.equal(existsSync(path), false, `${path} must be deleted`);
    }
    for (const path of [siblingPath, `${siblingPath}-wal`, `${siblingPath}-shm`]) {
      assert.equal(existsSync(path), true, `${path} must be preserved`);
    }
  });

  test('reset of target without -wal / -shm still removes the target cleanly', () => {
    const dir = track(createTempDir('reset-g-clean'));
    const targetPath = join(dir, 'clean.db');
    seed(targetPath);
    try { rmSync(`${targetPath}-wal`, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${targetPath}-shm`, { force: true }); } catch { /* ignore */ }
    assert.equal(existsSync(`${targetPath}-wal`), false);
    assert.equal(existsSync(`${targetPath}-shm`), false);

    const res = runReset({ NODE_ENV: 'development', ERP_DB_PATH: targetPath });
    assert.equal(res.status, 0);
    assert.equal(existsSync(targetPath), false);
  });

  test('script does NOT delete repository default DB -wal/-shm even if they exist as artifacts', () => {
    const walPath = `${REPO_DEFAULT_DB}-wal`;
    const shmPath = `${REPO_DEFAULT_DB}-shm`;
    try { writeFileSync(walPath, 'stray-wal'); } catch { /* may fail on Windows; ok */ }
    try { writeFileSync(shmPath, 'stray-shm'); } catch { /* may fail on Windows; ok */ }
    const walBefore = existsSync(walPath);
    const shmBefore = existsSync(shmPath);

    const refused1 = runReset({ NODE_ENV: 'development' });
    assert.notEqual(refused1.status, 0);
    const refused2 = runReset({ NODE_ENV: 'development', ERP_DB_PATH: REPO_DEFAULT_DB });
    assert.notEqual(refused2.status, 0);

    assert.equal(existsSync(walPath), walBefore, 'repo default -wal artifact unchanged after refused runs');
    assert.equal(existsSync(shmPath), shmBefore, 'repo default -shm artifact unchanged after refused runs');

    try { rmSync(walPath, { force: true }); } catch { /* ignore */ }
    try { rmSync(shmPath, { force: true }); } catch { /* ignore */ }
  });
});

function mkdirSyncSafe(dir) {
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}
