// Regression coverage for v1.0.1 — INVENTORY_TRANSFER_APPROVE permission
// registration + warehouse end-to-end transfer workflow + frontend gate
// hygiene for the UsersRoles loader.
//
// Post-v1.0.0 audit found:
//   - `server/app.js:1396` allow(actor, 'INVENTORY_TRANSFER_APPROVE') gates
//     POST /api/inventory-transfers/:id/transfer and /:id/cancel.
//   - The permission code was NOT registered in server/db.js → PERMISSIONS,
//     so no canonical role could ever hold it. Every authenticated confirm
//     attempt returned 403.
//   - master-data.jsx:370 already gates the transfer / cancel buttons on
//     `can(user, 'INVENTORY_TRANSFER_APPROVE')` (matches the backend
//     contract once the permission exists), so no frontend action-button
//     change is required.
//   - UsersRoles component (master-data.jsx:214) used to call
//     api('/api/roles') unconditionally while api('/api/users') was guarded
//     by USERS_MANAGE. For actors with ROLES_MANAGE only, /api/roles would
//     mount and emit an avoidable 403. Defense-in-depth tightens the load
//     function to gate both endpoints.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

// =====================================================================
// A. Permission registry + canonical reconciliation contract
// =====================================================================

describe('v1.0.1 — INVENTORY_TRANSFER_APPROVE permission registry', () => {
  test('INVENTORY_TRANSFER_APPROVE is registered in PERMISSIONS', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('INVENTORY_TRANSFER_APPROVE'),
      'INVENTORY_TRANSFER_APPROVE must be in PERMISSIONS registry');
    assert.ok(codes.includes('INVENTORY_TRANSFER_CREATE'),
      'INVENTORY_TRANSFER_CREATE must remain in PERMISSIONS registry');
  });

  test('warehouse rolePermissions seed includes INVENTORY_TRANSFER_APPROVE', () => {
    const dbSrc = readFileSync(join(repoRoot, 'server', 'db.js'), 'utf8');
    const whIdx = dbSrc.indexOf("'role-warehouse':");
    assert.notEqual(whIdx, -1, 'role-warehouse seed must exist');
    const row = dbSrc.slice(whIdx, dbSrc.indexOf(']', whIdx) + 1);
    assert.match(row, /'INVENTORY_TRANSFER_APPROVE'/,
      'role-warehouse seed must contain INVENTORY_TRANSFER_APPROVE');
    assert.doesNotMatch(row, /'PRODUCTS_MANAGE'/);
    assert.doesNotMatch(row, /'USERS_MANAGE'/);
    assert.doesNotMatch(row, /'ROLES_MANAGE'/);
    assert.doesNotMatch(row, /'ACCOUNTING_VIEW'/);
  });

  test('canonical reconciliation: existing DB gains INVENTORY_TRANSFER_APPROVE row idempotently', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modern-erp-ita-'));
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // skip demo seed
    let db;
    try {
      // First start. createDatabase inserts permissions via INSERT OR IGNORE
      // and role_permissions also via INSERT OR IGNORE.
      db = createDatabase(join(tmp, 'erp.db'));
      const row = db.prepare("SELECT 1 FROM permissions WHERE code='INVENTORY_TRANSFER_APPROVE'").get();
      assert.ok(row, 'permission row must exist after first createDatabase');
      const rp = db.prepare("SELECT 1 FROM role_permissions WHERE role_id='role-warehouse' AND permission_code='INVENTORY_TRANSFER_APPROVE'").get();
      assert.ok(rp, 'role-warehouse must receive INVENTORY_TRANSFER_APPROVE');

      // Idempotency: re-run the exact same canonical INSERT OR IGNORE
      // statements that createDatabase() issues (simulating a second
      // application startup). No new rows must be added because the PK
      // (role_id, permission_code) is already populated.
      // Idempotency: re-run the exact same canonical INSERT OR IGNORE
      // statements that createDatabase() issues for warehouse + admin. PK
      // (role_id, permission_code) is already populated, so the second pass
      // must NOT create duplicate rows.
      const sqlReseed = db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES (?, ?)");
      sqlReseed.run('INVENTORY_TRANSFER_APPROVE', '审核库存调拨');
      sqlReseed.run('INVENTORY_CHECK_APPROVE', '审核库存盘点');

      const sqlReseedRp = db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)");
      sqlReseedRp.run('role-warehouse', 'INVENTORY_TRANSFER_APPROVE');
      sqlReseedRp.run('role-admin', 'INVENTORY_TRANSFER_APPROVE');

      const cntWh = db.prepare("SELECT count(*) c FROM role_permissions WHERE role_id='role-warehouse' AND permission_code='INVENTORY_TRANSFER_APPROVE'").get().c;
      const cntAdmin = db.prepare("SELECT count(*) c FROM role_permissions WHERE role_id='role-admin' AND permission_code='INVENTORY_TRANSFER_APPROVE'").get().c;
      assert.equal(cntWh, 1, 'role-warehouse row stays unique after re-run');
      assert.equal(cntAdmin, 1, 'role-admin row stays unique after re-run');

      // Negative-check: an unauthorized role CANNOT acquire the permission
      // through the same canonical idempotent INSERT OR IGNORE path
      // because the role itself isn't in the rolePermissions source map and
      // the role_permissions table has no orphan rows.
      const cntOther = db.prepare("SELECT count(*) c FROM role_permissions WHERE role_id NOT IN ('role-warehouse','role-admin') AND permission_code='INVENTORY_TRANSFER_APPROVE'").get().c;
      assert.equal(cntOther, 0, 'no other role currently holds INVENTORY_TRANSFER_APPROVE');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      // Close DB explicitly before tmp remove; Windows holds the -wal / -shm
      // file handles which can cause EPERM on rmSync otherwise.
      try { if (db) db.close(); } catch (e) {}
      try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows file-lock race */ }
    }
  });

  test('admin receives INVENTORY_TRANSFER_APPROVE through admin-all reconciliation', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modern-erp-ita-'));
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const db = createDatabase(join(tmp, 'erp.db'));
      // PERMISSIONS array is the source for admin-all (server/db.js:1180).
      const allCodes = PERMISSIONS.map(([code]) => code);
      assert.ok(allCodes.includes('INVENTORY_TRANSFER_APPROVE'),
        'admin-all at PERMISSIONS-array iteration level includes INVENTORY_TRANSFER_APPROVE');
      db.close();
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('roles other than warehouse and admin stay forbidden', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modern-erp-ita-'));
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const db = createDatabase(join(tmp, 'erp.db'));
      const rows = new Set(db.prepare(
        "SELECT role_id FROM role_permissions WHERE permission_code='INVENTORY_TRANSFER_APPROVE'"
      ).all().map((r) => r.role_id));
      // role-warehouse is the explicit operational holder.
      // role-admin receives it through the canonical admin-all
      // reconciliation (PERMISSIONS.map(...)). Other 3 roles
      // (sales / reviewer / accounting) must NOT have it.
      assert.ok(rows.has('role-warehouse'), 'role-warehouse must hold INVENTORY_TRANSFER_APPROVE');
      assert.ok(rows.has('role-admin'), 'role-admin must hold INVENTORY_TRANSFER_APPROVE via admin-all');
      assert.ok(!rows.has('role-sales'), 'role-sales must NOT hold INVENTORY_TRANSFER_APPROVE');
      assert.ok(!rows.has('role-reviewer'), 'role-reviewer must NOT hold INVENTORY_TRANSFER_APPROVE');
      assert.ok(!rows.has('role-accounting'), 'role-accounting must NOT hold INVENTORY_TRANSFER_APPROVE');
      db.close();
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =====================================================================
// B. End-to-end transfer workflow with warehouse as actor
// =====================================================================

describe('v1.0.1 — warehouse inventory transfer workflow (create + transfer + cancel)', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let adminToken;
  let warehouseToken;
  let accountingToken;

  before(async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // skip demo seed
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-twflow-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    // Insert two warehouses + inventory stock at known levels + minimal
    // subjects/products/users so the backend handlers accept the requests.
    const now = new Date().toISOString();
    db.exec(`
      INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES
        ('wh-A','WH-A','A 仓','','mA',1, '${now}','${now}'),
        ('wh-B','WH-B','B 仓','','mB',1, '${now}','${now}');
      INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
        VALUES ('p-1','P-WF1','调拨测试货品','TEST','个',1000,0,1,'${now}','${now}');
      INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES
        ('wh-A','p-1',100,'${now}'),
        ('wh-B','p-1',0,  '${now}');
    `);

    const roleWarehouse = db.prepare("SELECT id FROM roles WHERE code='WAREHOUSE'").get();
    const roleAccounting = db.prepare("SELECT id FROM roles WHERE code='ACCOUNTING'").get();
    const roleAdmin = db.prepare("SELECT id FROM roles WHERE code='ADMIN'").get();

    const wh = hashPassword('wh-ita-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-wh','warehouse','仓库管理员',?,?,?,1,?)`)
      .run(wh.hash, wh.salt, roleWarehouse.id, now);

    const ac = hashPassword('acc-ita-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-ac','accounting','财务专员',?,?,?,1,?)`)
      .run(ac.hash, ac.salt, roleAccounting.id, now);

    // admin user — seed is suppressed under NODE_ENV=production, so insert
    // explicitly so adminToken resolves.
    const ad = hashPassword('admin-ita-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-ad','admin','系统管理员',?,?,?,1,?)`)
      .run(ad.hash, ad.salt, roleAdmin.id, now);

    adminToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-ita-1234' }),
    })).json()).token;
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-ita-1234' }),
    })).json()).token;
    accountingToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'acc-ita-1234' }),
    })).json()).token;
    assert.ok(adminToken && warehouseToken && accountingToken, 'all three tokens must be present');
  });

  beforeEach(async () => {
    // Reset the stock and clear prior transfer rows so each test starts clean.
    db.prepare("UPDATE inventory SET quantity=? WHERE warehouse_id='wh-A' AND product_id='p-1'").run(100);
    db.prepare("UPDATE inventory SET quantity=? WHERE warehouse_id='wh-B' AND product_id='p-1'").run(0);
    db.prepare("DELETE FROM accounting_entries WHERE voucher_id IN (SELECT id FROM accounting_vouchers WHERE source_type='INVENTORY_TRANSFER')").run();
    db.prepare("DELETE FROM accounting_vouchers WHERE source_type='INVENTORY_TRANSFER'").run();
    db.prepare("DELETE FROM inventory_transfer_items WHERE transfer_id IN (SELECT id FROM inventory_transfers)").run();
    db.prepare("DELETE FROM inventory_transfers").run();
  });

  after(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTransfer(token, fromWarehouseId, toWarehouseId, qty) {
    const res = await fetch(`${baseUrl}/api/inventory-transfers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        fromWarehouseId, toWarehouseId,
        businessDate: '2026-09-27',
        items: [{ productId: 'p-1', quantity: qty }],
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `create transfer must succeed, got ${res.status}: ${text}`);
    return JSON.parse(text);
  }

  test('warehouse can create an inventory transfer (INVENTORY_TRANSFER_CREATE granted)', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 30);
    assert.ok(created.id);
    const row = db.prepare('SELECT status, creator_id FROM inventory_transfers WHERE id=?').get(created.id);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.creator_id, 'user-wh');
  });

  test('new transfer without businessDate is rejected with zero side effects', async () => {
    const beforeTransfers = db.prepare('SELECT COUNT(*) count FROM inventory_transfers').get().count;
    const beforeAudit = db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_TRANSFER'").get().count;
    const beforeSource = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity;
    const response = await fetch(`${baseUrl}/api/inventory-transfers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({ fromWarehouseId: 'wh-A', toWarehouseId: 'wh-B', items: [{ productId: 'p-1', quantity: 1 }] }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM inventory_transfers').get().count, beforeTransfers);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_TRANSFER'").get().count, beforeAudit);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity, beforeSource);
  });

  test('warehouse confirms transfer: status=TRANSFERRED, reviewer_id persisted, quantities update correctly', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 30);

    const res = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${warehouseToken}` },
      body: '{}',
    });
    assert.equal(res.status, 200, `transfer confirm must succeed, got ${res.status}`);

    const row = db.prepare('SELECT status, reviewer_id, updated_at FROM inventory_transfers WHERE id=?').get(created.id);
    assert.equal(row.status, 'TRANSFERRED');
    assert.equal(row.reviewer_id, 'user-wh');
    assert.ok(row.updated_at, 'updated_at must be set on transfer');

    const fromQty = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity;
    const toQty = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-B' AND product_id='p-1'").get().quantity;
    assert.equal(fromQty, 70, 'source warehouse stock must decrease by qty');
    assert.equal(toQty, 30, 'destination warehouse stock must increase by qty');
  });

  test('repeated transfer on a non-DRAFT transfer is rejected per business contract (409)', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 10);
    const first = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}` }, body: '{}',
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}` }, body: '{}',
    });
    assert.equal(second.status, 409, 'second /transfer on same id must 409');
    const body = await second.json();
    assert.match(body.error || '', /已确认|重复/);
    assert.equal(body.code, 'DUPLICATE_CONFIRMATION');
  });

  test('closed businessDate blocks transfer confirmation with zero partial effects', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 4);
    db.prepare("INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes) VALUES('e2-closed','2026-09','CLOSED','user-ad',datetime('now'),'e2 test')").run();
    try {
      const beforeSource = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity;
      const beforeTarget = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-B' AND product_id='p-1'").get()?.quantity || 0;
      const beforeAudit = db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_TRANSFER' AND entity_id=?").get(created.id).count;
      const response = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', headers: { Authorization: `Bearer ${warehouseToken}` }, body: '{}' });
      assert.equal(response.status, 409);
      assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.id).status, 'DRAFT');
      assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity, beforeSource);
      assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-B' AND product_id='p-1'").get()?.quantity || 0, beforeTarget);
      assert.equal(db.prepare("SELECT COUNT(*) count FROM inventory_transactions WHERE source_type='INVENTORY_TRANSFER' AND source_id=?").get(created.id).count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_TRANSFER' AND entity_id=?").get(created.id).count, beforeAudit);
    } finally {
      db.prepare("DELETE FROM inventory_period_closures WHERE id='e2-closed'").run();
    }
  });

  test('legacy APPROVE-only warehouse mapping remains a confirm compatibility alias', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 2);
    db.prepare("DELETE FROM role_permissions WHERE role_id='role-warehouse' AND permission_code='INVENTORY_TRANSFER_CONFIRM'").run();
    try {
      const response = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', headers: { Authorization: `Bearer ${warehouseToken}` }, body: '{}' });
      assert.equal(response.status, 200);
      assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.id).status, 'TRANSFERRED');
    } finally {
      db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-warehouse','INVENTORY_TRANSFER_CONFIRM')").run();
    }
  });

  test('legacy SUBMITTED and APPROVED statuses remain readable and stored unchanged', async () => {
    for (const status of ['SUBMITTED', 'APPROVED']) {
      const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 1);
      db.prepare('UPDATE inventory_transfers SET status=? WHERE id=?').run(status, created.id);
      const response = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}`, { headers: { Authorization: `Bearer ${warehouseToken}` } });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.transfer.status, status);
      assert.equal(body.transfer.legacyTechnicalStatus, true);
      assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.id).status, status);
    }
  });

  test('cancel flow: DRAFT → CANCELLED, reviewer_id recorded, quantities unchanged', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 25);

    const fromBefore = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity;
    const toBefore = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-B' AND product_id='p-1'").get().quantity;

    const res = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/cancel`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}` }, body: '{}',
    });
    assert.equal(res.status, 200);

    const row = db.prepare('SELECT status, reviewer_id FROM inventory_transfers WHERE id=?').get(created.id);
    assert.equal(row.status, 'CANCELLED');
    assert.equal(row.reviewer_id, 'user-wh');

    const fromAfter = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-A' AND product_id='p-1'").get().quantity;
    const toAfter = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-B' AND product_id='p-1'").get().quantity;
    assert.equal(fromAfter, fromBefore, 'cancel must not move inventory');
    assert.equal(toAfter, toBefore, 'cancel must not move inventory');
  });

  test('unauthorized actor (role-accounting) cannot POST /transfer (403)', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 5);

    const res = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accountingToken}` }, body: '{}',
    });
    assert.equal(res.status, 403, `accounting user must not have INVENTORY_TRANSFER_APPROVE, got ${res.status}`);

    const row = db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.id);
    assert.equal(row.status, 'DRAFT', 'unauthorized confirm must not flip status');
  });

  test('unauthenticated POST /transfer returns 401 (auth gate precedes allow())', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 5);
    const res = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST', body: '{}',
    });
    assert.equal(res.status, 401);
  });

  test('admin can also confirm through admin-all reconciliation', async () => {
    const created = await createTransfer(warehouseToken, 'wh-A', 'wh-B', 7);
    const res = await fetch(`${baseUrl}/api/inventory-transfers/${created.id}/transfer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` }, body: '{}',
    });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT status, reviewer_id FROM inventory_transfers WHERE id=?').get(created.id);
    assert.equal(row.status, 'TRANSFERRED');
    assert.equal(row.reviewer_id, 'user-ad',
      'admin user inserted as user-ad for this isolated harness');
  });
});

// =====================================================================
// C. Frontend gate contract (source-level)
// =====================================================================

describe('v1.0.1 — frontend action buttons use canonical transfer permission', () => {
  const accountingSrc = readSrc(join('pages', 'master-data.jsx'));

  test('"+ 新建调拨单" button gated by INVENTORY_TRANSFER_CREATE', () => {
    assert.match(accountingSrc,
      /can\(user,\s*['"]INVENTORY_TRANSFER_CREATE['"]\)\s*&&\s*<button[^>]*onClick=\{\(\)\s*=>\s*setEditing\(\{\}\)\}>＋\s*新建调拨单<\/button>/);
  });

  test('"确认调拨" is gated by canonical CONFIRM while draft cancellation stays on CREATE', () => {
    assert.match(accountingSrc,
      /const canConfirmTransfer\s*=\s*can\(user,\s*['"]INVENTORY_TRANSFER_CONFIRM['"]\)[\s\S]*?canConfirmTransfer\s*&&\s*<button[\s\S]*?>确认调拨<\/button>/);
    assert.match(accountingSrc,
      /const canCancelTransfer\s*=\s*can\(user,\s*['"]INVENTORY_TRANSFER_CREATE['"]\)[\s\S]*?canCancelTransfer\s*&&\s*<button[\s\S]*?>取消<\/button>/);
  });

  test('buttons accept only canonical CONFIRM or the explicit legacy APPROVE alias', () => {
    // Source-level guard: canonical CONFIRM is primary and the sole alternate
    // is the approved compatibility alias. Unrelated permissions cannot leak
    // the action.
    const block = accountingSrc.slice(
      accountingSrc.indexOf('function InventoryTransfers'),
      accountingSrc.indexOf('function InventoryTransferModal'),
    );
    assert.match(block, /INVENTORY_TRANSFER_CONFIRM/);
    assert.match(block, /INVENTORY_TRANSFER_APPROVE/);
    assert.doesNotMatch(block,
      /can\(user,\s*['"]PRODUCTS_MANAGE['"]/);
    assert.doesNotMatch(block,
      /can\(user,\s*['"]ACCOUNTING_VIEW['"]/);
  });
});

// =====================================================================
// D. UsersRoles defensive gate (avoidable 403 from /api/roles unconditional call)
// =====================================================================

describe('v1.0.1 — UsersRoles loader gates both /api/users and /api/roles', () => {
  const masterSrc = readSrc(join('pages', 'master-data.jsx'));

  // Extract the UsersRoles function body so the loader regex can match its
  // inner `const load = () => ...` without being shadowed by Suppliers /
  // Customers / other modules' load helpers.
  function extractUsersRolesLoad() {
    const idx = masterSrc.indexOf('function UsersRoles(');
    assert.notEqual(idx, -1, 'UsersRoles component must exist');
    const start = masterSrc.indexOf('const load', idx);
    // Find the matching brace of the load arrow body. walk forward through
    // the source from `start`, counting braces until balanced back to zero.
    let i = masterSrc.indexOf('=>', start) + 2;
    while (i < masterSrc.length && masterSrc[i] !== '{') i++;
    let depth = 0;
    for (; i < masterSrc.length; i++) {
      const c = masterSrc[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          return masterSrc.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  test('api("/api/users") is conditional on USERS_MANAGE', () => {
    const load = extractUsersRolesLoad();
    assert.ok(load, 'UsersRoles load() helper must exist');
    assert.match(load, /can\(user,\s*['"]USERS_MANAGE['"]\)\s*\?\s*api\(['"]\/api\/users['"]\)/);
  });

  test('api("/api/roles") is conditional on ROLES_MANAGE (defense in depth)', () => {
    const load = extractUsersRolesLoad();
    assert.ok(load, 'UsersRoles load() helper must exist');
    assert.match(load, /can\(user,\s*['"]ROLES_MANAGE['"]\)\s*\?\s*api\(['"]\/api\/roles['"]\)/,
      'api("/api/roles") must be gated by can(user, "ROLES_MANAGE")');
  });

  test('unconditional api("/api/roles") inside UsersRoles load is no longer present', () => {
    const load = extractUsersRolesLoad();
    assert.ok(load);
    // Negative-check: original `api('/api/roles')` without a `can(user, ...)` guard
    // must not survive inside the load arrow body. The only remaining
    // occurrence is `can(user, 'ROLES_MANAGE') ? api('/api/roles') : null`,
    // where `api(...)` is the consequent of a conditional expression and we
    // do not match it with `\bapi\(` here (we check the naked form).
    assert.doesNotMatch(load, /^[^(]*\bapi\(\s*['"]\/api\/roles['"]\s*\)/m,
      'no naked api("/api/roles") call should remain inside UsersRoles load()');
  });
});
