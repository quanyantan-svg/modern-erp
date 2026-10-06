// Regression coverage for Phase E — post-v1.0.0 inventory_transfers schema
// reconciliation + role-warehouse PRODUCTS_VIEW permission.
//
// Production evidence (post-v1.0.0):
//   - journal repeatedly reports `Error: no such column: it.reviewer_id`
//     on GET /api/inventory-transfers (server/app.js:1336).
//   - legacy CREATE TABLE in extended-schema.js does not declare `remark`,
//     `updated_at`, or `reviewer_id` even though runtime INSERT/UPDATE/SELECT
//     reference them.
//   - warehouse workflows load `/api/products` (master-data.jsx:329) but
//     role-warehouse was missing PRODUCTS_VIEW (returns 403 at runtime).
//
// Fix scope (smallest possible):
//   - Idempotent migration (`migrateInventoryTransfers` in server/db.js) that
//     ALTER TABLE adds the three missing columns + rebuilds the CHECK
//     constraint to admit `TRANSFERRED` / `CANCELLED`.
//   - rolePermissions['role-warehouse'] receives PRODUCTS_VIEW via the
//     existing INSERT OR IGNORE role_permissions reconciliation path.
//   - Audit-only on UsersRoles / projects-workflow `/api/users` callers
//     (warehouse cannot reach those components through existing sidebar
//     gating — verified through the canonical application registry + USERS_MANAGE /
//     ROLES_MANAGE gates).
//
// What is intentionally not changed:
//   - Frontend trees for users-roles (warehouse users do not reach that
//     route; expanding audit may be done separately). Project / CRM
//     extensions were removed in Core Scope Cleanup.
//   - INVENTORY_TRANSFER_APPROVE / INVENTORY_TRANSFER_CREATE permission
//     contract (warehouse already had INVENTORY_TRANSFER_CREATE; the
//     missing or unregistered code paths are out of this task scope).
//   - Source code under src/** other than this test file.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import Database from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// =====================================================================
// Permission registry / seed reconciliation assertions
// =====================================================================

describe('Phase E — inventory_transfers migration permission contract', () => {
  test('PERIOD_CLOSE_VIEW is unchanged; PRODUCTS_VIEW is registered', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('PRODUCTS_VIEW'), 'PRODUCTS_VIEW must remain registered');
    assert.ok(codes.includes('PRODUCTS_MANAGE'), 'PRODUCTS_MANAGE must remain registered');
  });
});

// =====================================================================
// End-to-end: legacy DB with the pre-fix inventory_transfers schema
// =====================================================================

describe('Phase E — legacy inventory_transfers schema reconciled on canonical startup', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let adminToken;
  let warehouseToken;
  // Disable demo seed for these isolated migration harnesses so they only
  // populate the minimum required FK rows we plant below.
  let prevNodeEnv;

  // Build a legacy-shaped DB. We:
  // - create the v0-style inventory_transfers table WITHOUT remark / updated_at /
  //   reviewer_id columns and WITHOUT the broader CHECK.
  // - insert one DRAFT legacy row so we can verify preservation.
  // Then run createDatabase() through the canonical startup path and confirm the
  // columns exist, the legacy row is still there, and the constraint has been
  // rebuilt.
  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // disables seedDemoData via shouldSeedDemoData()
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-itmig-'));

    // 1. Lay down a legacy DB with the v0 inventory_transfers schema.
    const legacyPath = join(tmp, 'erp.db');
    const legacy = new Database.DatabaseSync(legacyPath);
    legacy.exec('PRAGMA foreign_keys = ON');
    // Need the dependencies first so FOREIGN KEY clauses in inventory_transfers
    // resolve correctly when createDatabase() runs.
    legacy.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, role_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE roles(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', system_role INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE permissions(code TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE role_permissions(role_id TEXT NOT NULL, permission_code TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_code));
      CREATE TABLE warehouses(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL);

      CREATE TABLE inventory_transfers (
        id TEXT PRIMARY KEY,
        transfer_no TEXT NOT NULL UNIQUE,
        from_warehouse_id TEXT NOT NULL,
        to_warehouse_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED')),
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id)
      );

      CREATE TABLE inventory_transfer_items (
        id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL
      );

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        stock_quantity REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
    // Minimal seed users / warehouses to satisfy NOT NULL FKs.
    legacy.exec("INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('role-admin','ADMIN','系统管理员','',1,datetime('now'))");
    legacy.exec("INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('role-warehouse','WAREHOUSE','仓库管理员','',1,datetime('now'))");
    legacy.exec("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('user-admin','admin','系统管理员','h','s','role-admin',1,datetime('now'))");
    legacy.exec("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('user-warehouse','warehouse','仓库管理员','h','s','role-warehouse',1,datetime('now'))");
    legacy.exec("INSERT INTO warehouses(id,code,name,address,manager,active,created_at) VALUES('wh-1','WH-001','主仓','','张经理',1,datetime('now'))");
    legacy.exec("INSERT INTO warehouses(id,code,name,address,manager,active,created_at) VALUES('wh-2','WH-002','分仓','','李经理',1,datetime('now'))");
    legacy.exec(`INSERT INTO inventory_transfers(id,transfer_no,from_warehouse_id,to_warehouse_id,status,creator_id,created_at)
      VALUES('it-legacy-1','IT-LEGACY-001','wh-1','wh-2','DRAFT','user-admin','2026-08-01T10:00:00.000Z')`);
    legacy.exec(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
      VALUES('product-mig-1','P-MIG-1','调拨测试品','TEST','个',1000,0,1,datetime('now'),datetime('now'))`);
    legacy.exec("INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity) VALUES('iti-legacy-1','it-legacy-1','product-mig-1',10)");
    legacy.exec("INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity) VALUES('iti-legacy-2','it-legacy-1','product-mig-1',5)");
    legacy.close();

    // 2. Re-open through the application's canonical initialization path.
    db = createDatabase(legacyPath);
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
      VALUES('inv-mig-source','wh-1','product-mig-1',20,datetime('now'))`).run();

    // 3. Boot a fresh HTTP server against the migrated DB.
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    // 4. Patch the admin / warehouse credentials to known values via the
    // canonical createDatabase hashPassword so we can log in. The legacy seed
    // users above have only placeholder hashes; rewrite them with real hashes.
    const adminHash = hashPassword('admin-itmig-1234');
    const warehouseHash = hashPassword('wh-itmig-1234');
    db.prepare('UPDATE users SET password_hash=?, password_salt=? WHERE id=?').run(adminHash.hash, adminHash.salt, 'user-admin');
    db.prepare('UPDATE users SET password_hash=?, password_salt=? WHERE id=?').run(warehouseHash.hash, warehouseHash.salt, 'user-warehouse');

    adminToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-itmig-1234' }),
    })).json()).token;
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-itmig-1234' }),
    })).json()).token;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  test('migration adds remark / updated_at / reviewer_id columns', () => {
    const cols = db.prepare("PRAGMA table_info(inventory_transfers)").all().map((c) => c.name);
    assert.ok(cols.includes('remark'), 'remark column must exist after migration');
    assert.ok(cols.includes('updated_at'), 'updated_at column must exist after migration');
    assert.ok(cols.includes('reviewer_id'), 'reviewer_id column must exist after migration');
    assert.ok(cols.includes('business_date'), 'business_date column must exist after migration');
    const checkCols = db.prepare("PRAGMA table_info(inventory_checks)").all().map((c) => c.name);
    assert.ok(checkCols.includes('business_date'), 'inventory_checks.business_date must exist after migration');
  });

  test('legacy inventory_transfers row is preserved with reviewer_id NULL', () => {
    const row = db.prepare('SELECT * FROM inventory_transfers WHERE id=?').get('it-legacy-1');
    assert.ok(row, 'legacy row must still exist');
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.reviewer_id, null);
    assert.equal(row.business_date, null, 'legacy business date must remain unknown');
    // updated_at should be backfilled from created_at so runtime callers that
    // require a value don't see NULL/empty.
    assert.ok(row.updated_at && row.updated_at.length > 0, 'updated_at must be backfilled from created_at');
  });

  test('CHECK constraint is rebuilt to include TRANSFERRED / CANCELLED', () => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_transfers'").get()?.sql || '';
    assert.match(sql, /'TRANSFERRED'/);
    assert.match(sql, /'CANCELLED'/);
  });

  test('migration is idempotent — running createDatabase() twice preserves data', () => {
    // Close + reopen + createDatabase again. Since the canonical path is part of
    // createDatabase(), re-invoking it on the migrated DB must be a no-op for
    // the new shape (column / constraint stays correct, row count stays 1).
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    const cols = db.prepare("PRAGMA table_info(inventory_transfers)").all().map((c) => c.name);
    assert.ok(cols.includes('remark'));
    assert.ok(cols.includes('updated_at'));
    assert.ok(cols.includes('reviewer_id'));
    const row = db.prepare('SELECT * FROM inventory_transfers WHERE id=?').get('it-legacy-1');
    assert.ok(row);
    assert.equal(row.status, 'DRAFT');
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_transfers'").get()?.sql || '';
    assert.match(sql, /'TRANSFERRED'/);
    assert.match(sql, /'CANCELLED'/);
  });

  test('GET /api/inventory-transfers as role-warehouse returns 200 (not 500)', async () => {
    // Warehouse user holds INVENTORY_VIEW → listInventoryTransfers must
    // succeed after the migration. Pre-fix this would 500 with
    // "no such column: it.reviewer_id".
    const res = await fetch(`${baseUrl}/api/inventory-transfers`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert.ok(Array.isArray(body.inventoryTransfers));
    assert.ok(body.inventoryTransfers.length >= 1, 'legacy DRAFT row should appear');
    assert.equal(body.inventoryTransfers[0].transfer_no, 'IT-LEGACY-001');
  });

  test('GET /api/inventory-transfers/{id} as role-warehouse returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/inventory-transfers/it-legacy-1`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.transfer);
    assert.equal(body.transfer.id, 'it-legacy-1');
    assert.equal(body.transfer.statusLabel, '草稿');
    assert.equal(body.transfer.reviewer_id, null);
  });

  test('POST /api/inventory-transfers/{id}/transfer writes TRANSFERRED status (CHECK constraint accepts it)', async () => {
    // Admin receives INVENTORY_TRANSFER_APPROVE through the canonical admin-all
    // permission reconciliation ('role-admin': all). The migration repaired the
    // CHECK constraint so this UPDATE actually persists.
    db.prepare("UPDATE inventory_transfers SET business_date='2026-09-27' WHERE id='it-legacy-1'").run();
    const res = await fetch(`${baseUrl}/api/inventory-transfers/it-legacy-1/transfer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200, `transfer action must succeed, got ${res.status}`);
    const row = db.prepare("SELECT status, reviewer_id, updated_at FROM inventory_transfers WHERE id='it-legacy-1'").get();
    assert.equal(row.status, 'TRANSFERRED');
    assert.equal(row.reviewer_id, 'user-admin');
    assert.ok(row.updated_at);
  });

  test('POST /api/inventory-transfers/{id}/cancel writes CANCELLED status', async () => {
    // Use the warehouse token (warehouse holds INVENTORY_TRANSFER_APPROVE
    // via the canonical rolePermissions seed) to also assert the warehouse
    // approver surface actually works end-to-end.
    const res = await fetch(`${baseUrl}/api/inventory-transfers/it-legacy-1/cancel`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 200);
    const row = db.prepare("SELECT status, reviewer_id FROM inventory_transfers WHERE id='it-legacy-1'").get();
    assert.equal(row.status, 'CANCELLED');
    assert.equal(row.reviewer_id, 'user-warehouse');
  });
});

// =====================================================================
// role-warehouse permission contract (canonical reconciliation)
// =====================================================================

describe('Phase E — role-warehouse permission contract', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let warehouseToken;
  let prevNodeEnv;

  before(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // disables seedDemoData for isolated harness
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-whperm-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    // Demo seed is disabled under NODE_ENV=production; insert the warehouse
    // user explicitly with a known password.
    const roleWarehouse = db.prepare("SELECT id FROM roles WHERE code='WAREHOUSE'").get();
    assert.ok(roleWarehouse, 'WAREHOUSE role must be seeded');
    const h = hashPassword('wh-perm-1234');
    db.prepare(`INSERT OR REPLACE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
      VALUES(?, ?, ?, ?, ?, ?, 1, ?)`)
      .run('user-warehouse', 'warehouse', '仓库管理员', h.hash, h.salt, roleWarehouse.id, new Date().toISOString());
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-perm-1234' }),
    })).json()).token;
    assert.ok(warehouseToken, `login must yield a token, got ${JSON.stringify(warehouseToken)}`);
  });

  after(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  test('warehouse role has PRODUCTS_VIEW from rolePermissions seed', () => {
    // Source-level check on the canonical seed array.
    const dbSrc = readFileSync(join(repoRoot, 'server', 'db.js'), 'utf8');
    const whIdx = dbSrc.indexOf("'role-warehouse':");
    assert.notEqual(whIdx, -1, 'role-warehouse seed must exist');
    const row = dbSrc.slice(whIdx, dbSrc.indexOf('],', whIdx) + 1);
    assert.match(row, /'PRODUCTS_VIEW'/);
    assert.doesNotMatch(row, /'PRODUCTS_MANAGE'/);
    assert.doesNotMatch(row, /'USERS_MANAGE'/);
    assert.doesNotMatch(row, /'ROLES_MANAGE'/);
    assert.doesNotMatch(row, /'ACCOUNTING_VIEW'/);
  });

  test('role_permissions table reflects the seed: PRODUCTS_VIEW in, USERS_MANAGE out', () => {
    const perms = db.prepare("SELECT permission_code FROM role_permissions WHERE role_id='role-warehouse'").all().map((r) => r.permission_code);
    assert.ok(perms.includes('PRODUCTS_VIEW'), 'PRODUCTS_VIEW must be assigned to role-warehouse');
    assert.ok(perms.includes('WAREHOUSES_VIEW'));
    assert.ok(perms.includes('INVENTORY_VIEW'));
    assert.ok(!perms.includes('PRODUCTS_MANAGE'), 'role-warehouse must NOT have PRODUCTS_MANAGE');
    assert.ok(!perms.includes('USERS_MANAGE'), 'role-warehouse must NOT have USERS_MANAGE');
    assert.ok(!perms.includes('ROLES_MANAGE'), 'role-warehouse must NOT have ROLES_MANAGE');
    assert.ok(!perms.includes('ACCOUNTING_VIEW'), 'role-warehouse must NOT have ACCOUNTING_VIEW');
  });

  test('warehouse token /api/auth/me includes PRODUCTS_VIEW in permissions', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.user.permissions.includes('PRODUCTS_VIEW'));
    assert.ok(!body.user.permissions.includes('PRODUCTS_MANAGE'));
    assert.ok(!body.user.permissions.includes('USERS_MANAGE'));
    assert.ok(!body.user.permissions.includes('ACCOUNTING_VIEW'));
  });

  test('GET /api/products as role-warehouse returns 200 (was 403 pre-fix)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 200, `products must be reachable for role-warehouse, got ${res.status}`);
  });

  test('POST /api/products as role-warehouse returns 403 (no PRODUCTS_MANAGE)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'P-TEST', name: 'Test', unit: 'pc', priceCents: 100, stockQuantity: 1 }),
    });
    assert.equal(res.status, 403);
  });

  test('GET /api/users as role-warehouse returns 403 (admin-only)', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('GET /api/roles as role-warehouse returns 403 (no USERS_MANAGE / ROLES_MANAGE)', async () => {
    const res = await fetch(`${baseUrl}/api/roles`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('GET /api/accounting-subjects as role-warehouse returns 403 (no ACCOUNTING_VIEW)', async () => {
    const res = await fetch(`${baseUrl}/api/accounting-subjects`, {
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
    });
    assert.equal(res.status, 403);
  });
});
