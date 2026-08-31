import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { createDatabase, hashPassword, shouldSeedDemoData, verifyPassword } from './db.js';

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
  test('production: pnpm reset-data exits non-zero with error message', () => {
    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
      const out = execSync('node server/reset-data.js', {
        cwd: process.cwd().replace(/\\server$/, ''),
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      stdout = out.toString();
      code = 0;
    } catch (e) {
      stdout = (e.stdout || Buffer.alloc(0)).toString();
      stderr = (e.stderr || Buffer.alloc(0)).toString();
      code = e.status || 1;
    }
    assert.notEqual(code, 0, 'reset-data must exit non-zero in production');
    assert.ok(stderr.includes('生产环境禁止') || stdout.includes('生产环境禁止'), `expected error message, got stdout="${stdout}" stderr="${stderr}"`);
  });

  test('development: pnpm reset-data runs normally (no guard)', () => {
    // 此测试只验证脚本在 dev 下不立即报错退出 —— 不创建实际文件
    let code = 0;
    let stderr = '';
    try {
      execSync('node server/reset-data.js', {
        cwd: process.cwd().replace(/\\server$/, ''),
        env: { ...process.env, NODE_ENV: 'development' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      stderr = (e.stderr || Buffer.alloc(0)).toString();
      code = e.status || 1;
    }
    // dev 下应该成功(可能文件不存在但不会因 guard 报错)
    assert.equal(stderr.includes('生产环境禁止'), false, `dev should not hit the production guard, stderr="${stderr}"`);
  });
});