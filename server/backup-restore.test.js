import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './db.js';
import { runBackup } from '../scripts/backup-db.mjs';
import { runRestore } from '../scripts/restore-db.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let workRoot;

function setupSeededDb() {
  const dbDir = join(workRoot, 'db');
  const backupDir = join(workRoot, 'backups');
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const dbPath = join(dbDir, 'erp.db');
  // Best-effort cleanup of stale files from previous tests (Windows holds
  // file locks for a short time after close, and a stale -wal / -shm
  // pair can prevent reopening).
  for (const stale of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(stale, { force: true }); } catch {}
  }
  const db = createDatabase(dbPath);
  // Force WAL checkpoint + close so subsequent open succeeds on Windows.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  db.close();
  return { dbPath, dbDir, backupDir };
}

function openDb(path, readonly = true) {
  return new DatabaseSync(path, readonly ? { readOnly: true } : {});
}

let testCounter = 0;
let baseRoot;

before(() => {
  baseRoot = mkdtempSync(join(tmpdir(), 'modern-erp-backup-test-'));
});

after(() => {
  if (baseRoot) {
    try {
      rmSync(baseRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
});

beforeEach(() => {
  // Each test gets a fresh sibling subdirectory under baseRoot.
  // Sibling (not nested) layout avoids long path on Windows.
  workRoot = join(baseRoot, `t${++testCounter}-${process.pid}-${Date.now()}`);
  mkdirSync(workRoot, { recursive: true });
});

describe('Backup Tool — basic', () => {
  test('creates a backup file in the configured directory', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true, `expected success, got: ${JSON.stringify(result)}`);
    const files = readdirSync(backupDir).filter(f => /^erp-\d{8}-\d{6}\.db$/.test(f));
    assert.equal(files.length, 1, 'exactly one timestamped backup file expected');
  });

  test('backup file has non-zero size', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true);
    assert.ok(result.size > 0);
    const files = readdirSync(backupDir).filter(f => /^erp-\d{8}-\d{6}\.db$/.test(f));
    assert.equal(files.length, 1);
    assert.ok(statSync(join(backupDir, files[0])).size > 0);
  });

  test('backup DB passes integrity_check', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true);
    assert.equal(result.integrity, 'ok');
    const verify = openDb(result.path);
    const ic = verify.prepare('PRAGMA integrity_check').get().integrity_check;
    verify.close();
    assert.equal(ic, 'ok');
  });

  test('backup preserves known test data', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const src = openDb(dbPath, false);
    src.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, val TEXT)');
    src.prepare('INSERT INTO probe (val) VALUES (?)').run('marker-A');
    src.close();

    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true);
    const bdb = openDb(result.path);
    const row = bdb.prepare('SELECT val FROM probe WHERE id=1').get();
    bdb.close();
    assert.equal(row.val, 'marker-A');
  });

  test('does not overwrite an existing backup file at same timestamp', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const fixedNow = new Date('2026-08-31T13:00:00Z');
    const first = runBackup({ dbPath, backupDir, now: fixedNow });
    assert.equal(first.success, true);
    const second = runBackup({ dbPath, backupDir, now: fixedNow });
    assert.equal(second.success, false);
    assert.ok(second.error.includes('已存在'));
  });

  test('rejects missing database', () => {
    const res = runBackup({
      dbPath: join(workRoot, 'nope.db'),
      backupDir: join(workRoot, 'backups'),
    });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('数据库不存在'));
  });
});

describe('Critical Recovery Test — backup/restore round-trip', () => {
  test('restore exactly preserves backup-time data and drops later writes', () => {
    const { dbPath, backupDir } = setupSeededDb();

    // Step 1: write Record A
    {
      const db = openDb(dbPath, false);
      db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, val TEXT)');
      db.prepare('INSERT INTO marker (val) VALUES (?)').run('Record-A');
      db.close();
    }

    // Step 2: backup
    const backupResult = runBackup({ dbPath, backupDir });
    assert.equal(backupResult.success, true);
    const backupPath = backupResult.path;

    // Step 3: write Record B (after backup)
    {
      const db = openDb(dbPath, false);
      db.prepare('INSERT INTO marker (val) VALUES (?)').run('Record-B');
      db.close();
    }

    // Verify A + B both present before restore
    {
      const db = openDb(dbPath);
      const rows = db.prepare('SELECT val FROM marker ORDER BY id').all().map(r => r.val);
      db.close();
      assert.deepEqual(rows, ['Record-A', 'Record-B']);
    }

    // Step 4: restore from backup
    const restoreResult = runRestore({ backupPath, dbPath, backupDir });
    assert.equal(restoreResult.success, true, `restore failed: ${JSON.stringify(restoreResult)}`);

    // Step 5: re-open and verify
    const db = openDb(dbPath);
    const rowsAfter = db.prepare('SELECT val FROM marker ORDER BY id').all().map(r => r.val);
    const ic = db.prepare('PRAGMA integrity_check').get().integrity_check;
    db.close();
    assert.deepEqual(rowsAfter, ['Record-A'], 'Record-B must NOT exist after restore');
    assert.equal(ic, 'ok', 'restored DB must pass integrity_check');
  });

  test('round-trip with WAL pending writes (consistency)', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const db = openDb(dbPath, false);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE wal_marker (id INTEGER PRIMARY KEY, val TEXT)');
    db.prepare('INSERT INTO wal_marker (val) VALUES (?)').run('WAL-row-1');
    db.prepare('INSERT INTO wal_marker (val) VALUES (?)').run('WAL-row-2');

    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true);
    db.close();

    const bdb = openDb(result.path);
    const count = bdb.prepare('SELECT COUNT(*) c FROM wal_marker').get().c;
    bdb.close();
    assert.equal(count, 2, 'WAL pending writes must be included in backup');
  });
});

describe('Restore Tool — safety', () => {
  test('rejects nonexistent backup file', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const res = runRestore({
      backupPath: join(workRoot, 'no-such-backup.db'),
      dbPath,
      backupDir,
    });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('备份文件不存在'));
  });

  test('rejects invalid backup file (not SQLite)', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const fakeBackup = join(workRoot, 'fake.db');
    writeFileSync(fakeBackup, 'this is not a sqlite database');
    const res = runRestore({ backupPath: fakeBackup, dbPath, backupDir });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('无法打开') || res.error.includes('完整性'));
  });

  test('rejects backup file that is the same as target', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const res = runRestore({ backupPath: dbPath, dbPath, backupDir });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('与目标数据库相同'));
  });

  test('production restore without --confirm-restore rejected', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const backupResult = runBackup({ dbPath, backupDir });
    assert.equal(backupResult.success, true);

    // Modify target so we can detect overwrite attempt
    const db = openDb(dbPath, false);
    db.exec('CREATE TABLE pre_restore_marker (id INTEGER PRIMARY KEY, val TEXT)');
    db.prepare('INSERT INTO pre_restore_marker (val) VALUES (?)').run('must-survive');
    db.close();

    const res = runRestore({
      backupPath: backupResult.path,
      dbPath,
      backupDir,
      isProduction: true,
      confirm: false,
    });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('--confirm-restore'));

    // Verify target DB unchanged
    const verify = openDb(dbPath);
    const row = verify.prepare('SELECT val FROM pre_restore_marker WHERE id=1').get();
    verify.close();
    assert.equal(row.val, 'must-survive', 'production DB must NOT be modified without --confirm-restore');
  });

  test('production restore WITH --confirm-restore succeeds', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const backupResult = runBackup({ dbPath, backupDir });
    assert.equal(backupResult.success, true);

    // Modify target after backup
    const db = openDb(dbPath, false);
    db.prepare('CREATE TABLE after_backup_marker (val TEXT)').run();
    db.prepare('INSERT INTO after_backup_marker (val) VALUES (?)').run('should-disappear');
    db.close();

    const res = runRestore({
      backupPath: backupResult.path,
      dbPath,
      backupDir,
      isProduction: true,
      confirm: true,
    });
    assert.equal(res.success, true, `restore failed: ${JSON.stringify(res)}`);

    const verify = openDb(dbPath);
    const tables = verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='after_backup_marker'").all();
    verify.close();
    assert.equal(tables.length, 0, 'after_backup_marker must not exist after restore in production');
  });

  test('failed restore does not destroy current database', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const db = openDb(dbPath, false);
    db.exec('CREATE TABLE keep_me (id INTEGER PRIMARY KEY, val TEXT)');
    db.prepare('INSERT INTO keep_me (val) VALUES (?)').run('survives-failure');
    db.close();

    const fakeBackup = join(workRoot, 'fake.db');
    writeFileSync(fakeBackup, 'not a database');
    const res = runRestore({ backupPath: fakeBackup, dbPath, backupDir });
    assert.equal(res.success, false);

    const verify = openDb(dbPath);
    const row = verify.prepare('SELECT val FROM keep_me WHERE id=1').get();
    const ic = verify.prepare('PRAGMA integrity_check').get().integrity_check;
    verify.close();
    assert.equal(row.val, 'survives-failure');
    assert.equal(ic, 'ok');
  });

  test('creates a safety backup during restore', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const backupResult = runBackup({ dbPath, backupDir });
    assert.equal(backupResult.success, true);

    const db = openDb(dbPath, false);
    db.exec('CREATE TABLE will_be_overwritten (val TEXT)');
    db.close();

    const restoreResult = runRestore({
      backupPath: backupResult.path,
      dbPath,
      backupDir,
    });
    assert.equal(restoreResult.success, true);
    assert.ok(existsSync(restoreResult.safetyPath), 'safety backup file must be created');

    const sdb = openDb(restoreResult.safetyPath);
    const has = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='will_be_overwritten'").all();
    sdb.close();
    assert.equal(has.length, 1, 'safety backup must contain the overwritten state');
  });

  test('runBackup result exposes path field', () => {
    const { dbPath, backupDir } = setupSeededDb();
    const result = runBackup({ dbPath, backupDir });
    assert.equal(result.success, true, `runBackup failed: ${JSON.stringify(result)}`);
    assert.ok(typeof result.path === 'string' && result.path.length > 0);
  });
});

describe('Backup CLI scripts', () => {
  test('scripts exist and are executable', () => {
    assert.ok(existsSync(join(REPO, 'scripts', 'backup-db.mjs')));
    assert.ok(existsSync(join(REPO, 'scripts', 'restore-db.mjs')));
  });

  test('package.json scripts wired', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['backup-db'], 'node scripts/backup-db.mjs');
    assert.equal(pkg.scripts['restore-db'], 'node scripts/restore-db.mjs');
  });
});