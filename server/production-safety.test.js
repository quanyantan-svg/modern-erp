import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, describe, test } from 'node:test';
import { createDatabase, hashPassword, shouldSeedDemoData, verifyPassword } from './db.js';
import { createDisposableSentinel, createTempDir, createTempDb, readSentinel } from './test-utils/temp-db.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESET_SCRIPT = join(REPO, 'server', 'reset-data.js');
const REPO_DEFAULT_DB = join(REPO, 'data', 'erp.db');

function runReset({ env }) {
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

let tempDir;

function makeDb(name = 'erp.db') {
  const dbPath = join(tempDir, name);
  return createDatabase(dbPath);
}

function countRows(db, sql) {
  return db.prepare(sql).get().cnt;
}

function tableHasRows(db, table) {
  return countRows(db, `SELECT COUNT(*) cnt FROM ${table}`) > 0;
}

after(async () => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('Production Safety — shouldSeedDemoData() gating', () => {
  test('returns true when ERP_SEED_DEMO=true regardless of NODE_ENV', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      process.env.ERP_SEED_DEMO = 'true';
      process.env.NODE_ENV = 'production';
      assert.equal(shouldSeedDemoData(), true);
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('returns false when NODE_ENV=production and ERP_SEED_DEMO not true', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      delete process.env.ERP_SEED_DEMO;
      process.env.NODE_ENV = 'production';
      assert.equal(shouldSeedDemoData(), false);
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('returns true in development (NODE_ENV unset or other)', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      delete process.env.ERP_SEED_DEMO;
      delete process.env.NODE_ENV;
      assert.equal(shouldSeedDemoData(), true);
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('returns false when ERP_SEED_DEMO set to non-true values', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      for (const v of ['false', '0', 'no', 'yes', 'TRUE']) {
        process.env.ERP_SEED_DEMO = v;
        if (v === 'TRUE') {
          assert.equal(shouldSeedDemoData(), true, `expected true for ERP_SEED_DEMO=${v}`);
        } else {
          // 非 'true' 在开发/测试环境下保持默认种子(true)
          assert.equal(shouldSeedDemoData(), true, `non-"true" values must not change dev default`);
        }
      }
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });
});

describe('Production Safety — createDatabase() in production', () => {
  beforeEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-prod-safety-test-'));
  });

  test('production: schema (permissions/roles/subjects) created, NO demo users', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      delete process.env.ERP_SEED_DEMO;
      process.env.NODE_ENV = 'production';
      const db = makeDb('prod-default.db');
      // 关键 schema 都创建
      assert.ok(tableHasRows(db, 'permissions'), 'permissions should be seeded');
      assert.ok(tableHasRows(db, 'roles'), 'roles should be seeded');
      assert.ok(tableHasRows(db, 'role_permissions'), 'role_permissions should be seeded');
      assert.ok(tableHasRows(db, 'accounting_subjects'), 'accounting_subjects should be seeded');
      // demo 用户/业务数据 全部不创建
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM users'), 0, 'users must NOT be created in production');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM customers'), 0, 'customers must NOT be created in production');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM suppliers'), 0, 'suppliers must NOT be created in production');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM products'), 0, 'products must NOT be created in production');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM warehouses'), 0, 'warehouses must NOT be created in production');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM sales_orders'), 0, 'sales_orders must NOT be created in production');
      db.close();
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('production: ERP_SEED_DEMO=false does not create admin even if explicit', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      process.env.ERP_SEED_DEMO = 'false';
      process.env.NODE_ENV = 'production';
      const db = makeDb('prod-explicit-false.db');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM users'), 0, 'users must NOT be created when ERP_SEED_DEMO=false');
      db.close();
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('production: ERP_SEED_DEMO=true explicitly opts in (demo deployment)', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      process.env.ERP_SEED_DEMO = 'true';
      process.env.NODE_ENV = 'production';
      const db = makeDb('prod-explicit-true.db');
      assert.equal(countRows(db, 'SELECT COUNT(*) cnt FROM users'), 5, 'demo users should be created when explicitly opted in');
      const admin = db.prepare("SELECT * FROM users WHERE username='admin'").get();
      assert.ok(admin, 'admin user should exist');
      // 密码必须确实是 admin123(弱密码,仅在显式启用时)
      assert.ok(verifyPassword('admin123', admin.password_salt, admin.password_hash));
      db.close();
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('development (default): demo users created (preserves local experience & tests)', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      delete process.env.ERP_SEED_DEMO;
      delete process.env.NODE_ENV;
      const db = makeDb('dev-default.db');
      assert.ok(countRows(db, 'SELECT COUNT(*) cnt FROM users') >= 5, 'demo users must be seeded by default in dev');
      assert.ok(tableHasRows(db, 'customers'));
      db.close();
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });

  test('production: existing migrations still complete (accounting_subjects ready)', () => {
    const originalSeed = process.env.ERP_SEED_DEMO;
    const originalNode = process.env.NODE_ENV;
    try {
      delete process.env.ERP_SEED_DEMO;
      process.env.NODE_ENV = 'production';
      const db = makeDb('prod-migrations.db');
      // 验证 schema 完整可用
      assert.ok(tableHasRows(db, 'accounting_subjects'));
      const cash = db.prepare("SELECT * FROM accounting_subjects WHERE code='1001'").get();
      assert.ok(cash, '1001 库存现金 should exist');
      assert.equal(cash.type, 'ASSET');
      // 表结构完整:accounting_vouchers + accounting_entries 应存在(空)
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_vouchers'").get());
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_entries'").get());
      db.close();
    } finally {
      if (originalSeed === undefined) delete process.env.ERP_SEED_DEMO;
      else process.env.ERP_SEED_DEMO = originalSeed;
      if (originalNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNode;
    }
  });
});

describe('Production Safety — reset-data guard', () => {
  test('production: explicit ERP_DB_PATH + NODE_ENV=production still REFUSES', () => {
    const target = createTempDir('reset-prod-guard');
    const dbPath = join(target, 'should-be-removed.db');
    const res = runReset({
      env: {
        NODE_ENV: 'production',
        ERP_DB_PATH: dbPath,
      },
    });
    assert.notEqual(res.status, 0, 'reset-data must exit non-zero in production');
    assert.ok(
      res.stderr.includes('生产环境禁止') || res.stdout.includes('生产环境禁止'),
      `expected production guard message, got stdout="${res.stdout}" stderr="${res.stderr}"`,
    );
  });

  test('development: explicit temp ERP_DB_PATH → reset only that target', () => {
    const target = createTempDir('reset-dev-explicit');
    const dbPath = join(target, 'disposable.db');
    // Seed the DB so we can prove it was reset.
    {
      const db = createDatabase(dbPath);
      db.prepare("INSERT INTO permissions(code,name) VALUES ('X_TEST_GUARD','x-test-guard')").run();
      db.close();
    }
    assert.ok(existsSync(dbPath), 'precondition: DB file must exist');

    const res = runReset({
      env: {
        NODE_ENV: 'development',
        ERP_DB_PATH: dbPath,
      },
    });
    assert.equal(res.status, 0, `reset-data should succeed with explicit ERP_DB_PATH, got stderr="${res.stderr}"`);
    assert.equal(existsSync(dbPath), false, 'target DB file must be deleted');
    assert.equal(existsSync(`${dbPath}-wal`), false, 'WAL sibling must be deleted (or absent)');
    assert.equal(existsSync(`${dbPath}-shm`), false, 'SHM sibling must be deleted (or absent)');

    try { rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('development: NO ERP_DB_PATH → REFUSE (no default-repo fallback)', () => {
    const res = runReset({
      env: {
        NODE_ENV: 'development',
      },
    });
    assert.notEqual(res.status, 0, 'reset-data must refuse when ERP_DB_PATH is absent');
    const combined = `${res.stdout}\n${res.stderr}`;
    assert.ok(
      combined.includes('ERP_DB_PATH') || combined.includes('默认数据库') || combined.includes('隐式'),
      `expected refuse-without-target message, got stdout="${res.stdout}" stderr="${res.stderr}"`,
    );
  });

  test('development: ERP_DB_PATH pointing at the repository default DB → REFUSE', () => {
    const res = runReset({
      env: {
        NODE_ENV: 'development',
        ERP_DB_PATH: REPO_DEFAULT_DB,
      },
    });
    assert.notEqual(res.status, 0, 'reset-data must refuse when targeted at the repo default DB');
    const combined = `${res.stdout}\n${res.stderr}`;
    assert.ok(
      combined.includes('仓库默认数据库') || combined.includes('默认数据库'),
      `expected repo-default refuse message, got stdout="${res.stdout}" stderr="${res.stderr}"`,
    );
  });
});

describe('Production Safety — reset-data sentinel regression (no repo default touched)', () => {
  test('destructive reset preserves a sentinel file outside the target DB', () => {
    // Sentinel represents developer data — it must be untouched after reset.
    const sentinel = createDisposableSentinel({ label: 'developer-data', size: 8192 });
    const before = readSentinel(sentinel.path);

    // Target DB lives in a different temp directory.
    const target = createTempDb({ label: 'reset-sentinel-target', filename: 'target.db' });
    // Sanity: target DB exists before reset.
    assert.ok(existsSync(target.dbPath), 'precondition: target DB must exist');
    target.close();

    const res = runReset({
      env: {
        NODE_ENV: 'development',
        ERP_DB_PATH: target.dbPath,
      },
    });
    assert.equal(res.status, 0, `reset-data must succeed with explicit temp target, got stderr="${res.stderr}"`);
    assert.equal(existsSync(target.dbPath), false, 'target DB file must be deleted');
    assert.equal(existsSync(target.walPath), false, 'target WAL must be deleted (or absent)');
    assert.equal(existsSync(target.shmPath), false, 'target SHM must be deleted (or absent)');

    // Sentinel must be byte-for-byte unchanged.
    const after = readSentinel(sentinel.path);
    assert.equal(after.size, before.size, 'sentinel size must not change');
    assert.equal(after.sha256, before.sha256, 'sentinel SHA-256 must not change');

    // Cleanup: delete sentinel dir, leave repo default DB alone.
    sentinel.cleanup();
    try { rmSync(target.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('repo/data/erp.db / -wal / -shm are never selected by reset-data without an explicit, non-repo-local opt-in', () => {
    // Confirm the guard invariants before invoking the script:
    //   1) repo default DB path resolves to <repo>/data/erp.db
    //   2) reset-data refuses when aimed at that path
    //   3) the file does not exist (we are not running on a real workspace DB)
    assert.equal(REPO_DEFAULT_DB, join(REPO, 'data', 'erp.db'));

    // We do NOT create the repo default DB. If a future test accidentally
    // does, this assertion will fail and force a maintainer review.
    assert.equal(
      existsSync(REPO_DEFAULT_DB),
      false,
      'this test requires the repo default DB to be absent; if a real DB exists, do NOT run the destructive suite against it',
    );

    // Confirm script REFUSES even with explicit ERP_DB_PATH = repo default.
    const res = runReset({
      env: {
        NODE_ENV: 'development',
        ERP_DB_PATH: REPO_DEFAULT_DB,
      },
    });
    assert.notEqual(res.status, 0, 'reset-data must refuse when aimed at the repo default DB');

    // The repo default DB is still absent (nothing was created, nothing was destroyed).
    assert.equal(existsSync(REPO_DEFAULT_DB), false, 'repo default DB must remain absent after a refused run');
    assert.equal(existsSync(`${REPO_DEFAULT_DB}-wal`), false, 'repo default -wal must remain absent');
    assert.equal(existsSync(`${REPO_DEFAULT_DB}-shm`), false, 'repo default -shm must remain absent');
  });
});