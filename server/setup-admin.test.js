import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, describe, test } from 'node:test';
import { createDatabase, verifyPassword } from './db.js';
import { setupAdmin } from '../scripts/admin/setup-admin.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_ADMIN_SCRIPT = join(REPO, 'scripts', 'admin', 'setup-admin.mjs');

let workRoot;
let testCounter = 0;
let baseRoot;

beforeEach(() => {
  if (!baseRoot) {
    baseRoot = mkdtempSync(join(tmpdir(), 'modern-erp-setup-admin-test-'));
  }
  workRoot = join(baseRoot, `t${++testCounter}-${process.pid}-${Date.now()}`);
  mkdirSync(workRoot, { recursive: true });
});

after(() => {
  if (baseRoot) {
    try { rmSync(baseRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
});

function makeDb(name = 'erp.db', { production = false } = {}) {
  const dbPath = join(workRoot, name);
  // Best-effort cleanup of stale files (Windows holds file locks briefly).
  for (const stale of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(stale, { force: true }); } catch {}
  }
  // Simulate production: block demo seed so the DB starts empty
  // (NODE_ENV=production alone is insufficient because Node's test runner
  //  does not auto-set it and other tests in the suite may set ERP_SEED_DEMO).
  if (production) {
    process.env.NODE_ENV = 'production';
    process.env.ERP_SEED_DEMO = 'false';
  }
  try {
    const db = createDatabase(dbPath);
    db.close();
  } finally {
    if (production) {
      delete process.env.ERP_SEED_DEMO;
    }
  }
  return dbPath;
}

function runCli(args, env = {}) {
  try {
    const out = execSync(`node ${SETUP_ADMIN_SCRIPT} ${args}`, {
      cwd: REPO,
      env: { ...process.env, NODE_ENV: 'development', ...env },
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

describe('First Admin Bootstrap — empty production DB', () => {
  test('empty production DB can create first admin', () => {
    const dbPath = makeDb(`t1-${testCounter}.db`, { production: true });
    const result = setupAdmin({
      dbPath,
      username: 'admin',
      password: 'S3cure-Production-Pwd',
    });
    assert.equal(result.success, true, `setup failed: ${JSON.stringify(result)}`);
    assert.equal(result.username, 'admin');
  });

  test('created user has admin role', () => {
    const dbPath = makeDb(`t2-${testCounter}.db`, { production: true });
    setupAdmin({ dbPath, username: 'admin', password: 'S3cure-Production-Pwd' });
    const db = createDatabase(dbPath);
    const row = db.prepare(`
      SELECT u.username, r.code AS role_code
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = ?
    `).get('admin');
    db.close();
    assert.equal(row.role_code, 'ADMIN');
  });

  test('password uses existing secure hash mechanism (scrypt + verifyPassword)', () => {
    const dbPath = makeDb(`t3-${testCounter}.db`, { production: true });
    const pwd = 'S3cure-Production-Pwd';
    setupAdmin({ dbPath, username: 'admin', password: pwd });
    const db = createDatabase(dbPath);
    const row = db.prepare('SELECT password_hash, password_salt FROM users WHERE username=?').get('admin');
    db.close();
    assert.ok(row.password_hash, 'hash must be stored');
    assert.ok(row.password_salt, 'salt must be stored');
    assert.ok(verifyPassword(pwd, row.password_salt, row.password_hash));
    assert.equal(verifyPassword('wrong-password', row.password_salt, row.password_hash), false);
  });

  test('created admin can authenticate via existing login SQL pattern', () => {
    const dbPath = makeDb(`t4-${testCounter}.db`, { production: true });
    const pwd = 'S3cure-Production-Pwd';
    setupAdmin({ dbPath, username: 'admin', password: pwd });
    const db = createDatabase(dbPath);
    const row = db.prepare("SELECT id, username, password_hash, password_salt, active FROM users WHERE username = ?").get('admin');
    db.close();
    assert.ok(row, 'user must be retrievable by username');
    assert.equal(row.active, 1);
    assert.ok(verifyPassword(pwd, row.password_salt, row.password_hash), 'login verify must succeed');
  });

  test('no demo users or demo business data created by setup-admin', () => {
    const dbPath = makeDb(`t5-${testCounter}.db`, { production: true });
    setupAdmin({ dbPath, username: 'admin', password: 'S3cure-Production-Pwd' });
    const db = createDatabase(dbPath);
    const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const customerCount = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
    const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    const salesOrderCount = db.prepare('SELECT COUNT(*) c FROM sales_orders').get().c;
    db.close();
    assert.equal(userCount, 1, 'exactly one user (the admin we just created)');
    assert.equal(customerCount, 0, 'no demo customers created');
    assert.equal(productCount, 0, 'no demo products created');
    assert.equal(salesOrderCount, 0, 'no demo sales orders created');
  });
});

describe('First Admin Bootstrap — safety rules', () => {
  test('rejects known demo weak passwords', () => {
    const dbPath = makeDb(`safety1-${testCounter}.db`, { production: true });
    // Test all known demo passwords (some short, caught by length; others
    // long enough to specifically exercise the weak-password detector).
    const known = ['admin123', 'sales123', 'warehouse123', 'accounting123', 'review123'];
    for (const weak of known) {
      const r = setupAdmin({ dbPath, username: `u-${weak}`, password: weak });
      assert.equal(r.success, false, `must reject ${weak}: ${JSON.stringify(r)}`);
    }
  });

  test('rejects all known demo passwords (sales123, warehouse123, accounting123, review123)', () => {
    for (const bad of ['sales123', 'warehouse123', 'accounting123', 'review123']) {
      const dbPath = join(workRoot, `bad-${bad}-${testCounter}.db`);
      const result = setupAdmin({ dbPath, username: 'admin', password: bad });
      assert.equal(result.success, false, `must reject ${bad}`);
    }
  });

  test('rejects passwords shorter than minimum length', () => {
    const dbPath = makeDb(`safety2-${testCounter}.db`, { production: true });
    const result = setupAdmin({ dbPath, username: 'admin', password: 'short1!' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('长度'));
  });

  test('rejects duplicate username (does not overwrite)', () => {
    const dbPath = makeDb(`safety3-${testCounter}.db`, { production: true });
    setupAdmin({ dbPath, username: 'admin', password: 'S3cure-Production-Pwd' });
    const result = setupAdmin({ dbPath, username: 'admin', password: 'Another-Strong-Pwd' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('用户已存在'));
    const db = createDatabase(dbPath);
    const row = db.prepare('SELECT password_hash, password_salt FROM users WHERE username=?').get('admin');
    db.close();
    assert.ok(verifyPassword('S3cure-Production-Pwd', row.password_salt, row.password_hash));
  });

  test('rejects missing username', () => {
    const dbPath = makeDb(`safety4-${testCounter}.db`, { production: true });
    const result = setupAdmin({ dbPath, username: '', password: 'S3cure-Production-Pwd' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('username'));
  });

  test('rejects missing password', () => {
    const dbPath = makeDb(`safety5-${testCounter}.db`, { production: true });
    const result = setupAdmin({ dbPath, username: 'admin', password: '' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('password') || result.error.includes('密码'));
  });

  test('does not echo password to stdout', () => {
    const dbPath = makeDb(`safety6-${testCounter}.db`, { production: true });
    const pwd = 'S3cure-Production-Pwd-XYZ';
    const res = runCli(`--username admin --password ${pwd}`, { ERP_DB_PATH: dbPath });
    assert.notEqual(res.stdout.includes(pwd), true, 'password must NOT appear in stdout');
    assert.notEqual(res.stderr.includes(pwd), true, 'password must NOT appear in stderr');
  });

  test('CLI exits non-zero on validation failure', () => {
    const res = runCli('--username admin --password short', { ERP_DB_PATH: join(workRoot, 'no-cli.db') });
    assert.notEqual(res.status, 0, 'CLI must exit non-zero on validation failure');
  });
});

describe('First Admin Bootstrap — application startup non-interference', () => {
  test('normal server startup in NODE_ENV=production still does not auto-create admin', () => {
    // Simulate production startup: createDatabase with NODE_ENV=production
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ERP_SEED_DEMO;
      const dbPath = join(workRoot, 'prod-startup.db');
      createDatabase(dbPath).close();
      // Check no admin user was created
      const db = createDatabase(dbPath);
      const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      db.close();
      assert.equal(userCount, 0, 'production startup must NOT auto-create admin user');
    } finally {
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
  });

  test('setup-admin works under NODE_ENV=production', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ERP_SEED_DEMO;
      const dbPath = join(workRoot, 'prod-setup.db');

      const result = setupAdmin({
        dbPath,
        username: 'admin',
        password: 'S3cure-Production-Pwd',
      });
      assert.equal(result.success, true, `setup-admin must work in production: ${JSON.stringify(result)}`);
    } finally {
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('First Admin Bootstrap — CLI wiring', () => {
  test('package.json has setup-admin script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['setup-admin'], 'node scripts/admin/setup-admin.mjs');
  });

  test('script file exists', () => {
    assert.ok(existsSync(SETUP_ADMIN_SCRIPT));
  });
});

describe('First Admin Bootstrap — configured MySQL backend (no live MySQL required)', () => {
  test('backend=mysql calls createDatabase() with NO SQLite path and skips ensureDbDir', () => {
    const calls = [];
    const stubEnsureDbDir = (...args) => { calls.push({ name: 'ensureDbDir', args }); };
    const stubCreateDatabase = (...args) => {
      calls.push({ name: 'createDatabase', args });
      // Deliberately throw: we want to prove the dispatch without opening a real DB.
      throw new Error('STUB_MYSQL_NOT_OPENED');
    };

    const result = setupAdmin({
      backend: 'mysql',
      username: 'admin',
      password: 'S3cure-Production-Pwd',
      createDatabaseFn: stubCreateDatabase,
      ensureDbDirFn: stubEnsureDbDir,
    });

    assert.equal(result.success, false, 'must fail because the stub refused to open MySQL');
    assert.ok(result.error.includes('STUB_MYSQL_NOT_OPENED'),
      `expected stub failure surfaced, got: ${result.error}`);

    const ensureDbDirCalls = calls.filter((c) => c.name === 'ensureDbDir');
    assert.equal(ensureDbDirCalls.length, 0,
      'ensureDbDir must NOT run when backend is configured MySQL');

    const createDbCalls = calls.filter((c) => c.name === 'createDatabase');
    assert.equal(createDbCalls.length, 1, 'createDatabase must be invoked exactly once');
    assert.equal(createDbCalls[0].args.length, 0,
      'createDatabase must be called with NO SQLite path string when backend is mysql');
  });

  test('backend=mysql still rejects weak password and duplicate-username before opening DB', () => {
    const calls = [];
    const stubEnsureDbDir = (...args) => { calls.push({ name: 'ensureDbDir', args }); };
    const stubCreateDatabase = (...args) => {
      calls.push({ name: 'createDatabase', args });
      throw new Error('STUB_MYSQL_NOT_OPENED');
    };

    const weak = setupAdmin({
      backend: 'mysql',
      username: 'admin',
      password: 'warehouse123',
      createDatabaseFn: stubCreateDatabase,
      ensureDbDirFn: stubEnsureDbDir,
    });
    assert.equal(weak.success, false);
    assert.ok(weak.error.includes('弱'), `weak-password rejection must surface a 弱 password error: ${weak.error}`);
    assert.equal(calls.length, 0, 'weak-password rejection must short-circuit before any DB call');

    const missingUser = setupAdmin({
      backend: 'mysql',
      username: '',
      password: 'S3cure-Production-Pwd',
      createDatabaseFn: stubCreateDatabase,
      ensureDbDirFn: stubEnsureDbDir,
    });
    assert.equal(missingUser.success, false);
    assert.ok(missingUser.error.includes('username'));
    assert.equal(calls.length, 0, 'missing-username rejection must short-circuit before any DB call');
  });

  test('backend omitted (default sqlite) preserves original SQLite string path behavior', () => {
    const dbPath = makeDb(`mysql-default-${testCounter}.db`);
    const result = setupAdmin({
      dbPath,
      username: 'admin',
      password: 'S3cure-Production-Pwd',
      // backend, createDatabaseFn, ensureDbDirFn all default — must use SQLite.
    });
    assert.equal(result.success, true, `setup failed: ${JSON.stringify(result)}`);
    const db = createDatabase(dbPath);
    const row = db.prepare('SELECT username FROM users WHERE username = ?').get('admin');
    db.close();
    assert.ok(row, 'user must be persisted in SQLite default path');
  });
});
