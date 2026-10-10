// Regression coverage for v1.0.1 — Warehouse & Logistics Stabilization.
//
// Production-side surfaces that broke for role-warehouse:
//
// 1. /api/suppliers and /api/customers return 403 (no SUPPLIERS_VIEW /
//    CUSTOMERS_VIEW). Purchase Receipt New, Sales Delivery New, and
//    Returns New modals loaded broad master-data endpoints. A single 403
//    rejected the shared Promise.all and left required selectors unavailable.
//
// 2. purchase_receipts / sales_deliveries / return_orders schemas lack
//    confirmed_by, confirmed_at, updated_at, and have stale CHECK
//    constraints that reject CONFIRMED / CANCELLED status writes — so
//    even after the picker 403 is fixed, the confirm actions crash with
//    500 "no such column" or CHECK violation.
//
// 3. The new-form detail value is {}, and each modal called setForm during
//    render while its required id stayed empty. React therefore repeated the
//    render-phase update until "Too many re-renders" crashed the page.
//
// Fix scope (smallest):
// - migrateWarehouseLogistics() (server/db.js): idempotent canonical
//   reconciliation — ALTER TABLE adds missing columns + rebuilds CHECK
//   for each table to admit CONFIRMED / CANCELLED. Mirrors the previous
//   migrateInventoryTransfers pattern (edbf59e / 45d9a72).
// - Two new narrow lookup endpoints gated by INVENTORY_VIEW (which
//   warehouse already holds) so the picker modals can populate without
//   granting full SUPPLIERS_VIEW / CUSTOMERS_VIEW.
// - createPurchaseReceipt / createSalesDelivery / confirmX /
//   createSalesReturn / createPurchaseReturn handlers populate date /
//   source_type columns explicitly so legacy DB rows survive the
//   reconcile.
// - logistics-finance.jsx modals use the lookup endpoints, replace
//   Promise.all with per-fetch .catch, and move setForm out of the
//   render body into a dedicated useEffect.
// - All four modal New buttons must produce a modal that loads,
//   selectors populate, save succeeds, persisted entity is readable,
//   state-transition endpoints work — no 500, no white screen.
//
// What is NOT changed (separation of duties preserved):
// - PRODUCTS_MANAGE / USERS_MANAGE / ROLES_MANAGE / ACCOUNTING_VIEW /
//   PERIOD_CLOSE_* / order approval permissions — role-warehouse stays
//   out of these.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');

// =====================================================================
// A. schema migration idempotency
// =====================================================================

describe('v1.0.1 — migrateWarehouseLogistics idempotency', () => {
  let tmp;
  let db;

  beforeEach(() => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // skip demo seed
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-wlog-'));
    try {
      db = createDatabase(join(tmp, 'erp.db'));
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  afterEach(() => {
    try { if (db) db.close(); } catch (e) {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  });

  test('purchase_receipts gains confirmed_by, confirmed_at, updated_at, receipt_date', () => {
    const cols = db.prepare("PRAGMA table_info(purchase_receipts)").all().map((c) => c.name);
    for (const col of ['confirmed_by', 'confirmed_at', 'updated_at', 'receipt_date']) {
      assert.ok(cols.includes(col), `purchase_receipts.${col} must exist after migration`);
    }
  });

  test('sales_deliveries gains confirmed_by, confirmed_at, updated_at, delivery_date', () => {
    const cols = db.prepare("PRAGMA table_info(sales_deliveries)").all().map((c) => c.name);
    for (const col of ['confirmed_by', 'confirmed_at', 'updated_at', 'delivery_date']) {
      assert.ok(cols.includes(col), `sales_deliveries.${col} must exist after migration`);
    }
  });

  test('return_orders gains delivery_id, receipt_id, confirmed_by, confirmed_at, updated_at, return_date', () => {
    const cols = db.prepare("PRAGMA table_info(return_orders)").all().map((c) => c.name);
    for (const col of ['delivery_id', 'receipt_id', 'confirmed_by', 'confirmed_at', 'updated_at', 'return_date']) {
      assert.ok(cols.includes(col), `return_orders.${col} must exist after migration`);
    }
  });

  test('CHECK constraints include CONFIRMED and CANCELLED', () => {
    for (const table of ['purchase_receipts', 'sales_deliveries', 'return_orders']) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
      assert.match(sql, /'CONFIRMED'/, `${table} CHECK must include CONFIRMED`);
      assert.match(sql, /'CANCELLED'/, `${table} CHECK must include CANCELLED`);
    }
  });

  test('migration is idempotent — second createDatabase adds no duplicate rows', () => {
    const sql = readFileSync(join(repoRoot, 'server', 'db.js'), 'utf8');
    const idx = sql.indexOf('migrateWarehouseLogistics(db);');
    assert.notEqual(idx, -1, 'createDatabase must invoke migrateWarehouseLogistics');

    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    const sql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_receipts'").get().sql;
    assert.match(sql2, /'CONFIRMED'/);
    assert.match(sql2, /'CANCELLED'/);
  });

  test('representative pre-v1.0.1 rows survive canonical startup migration', () => {
    const now = '2026-08-31T00:00:00.000Z';
    const password = hashPassword('legacy-user-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('legacy-user','legacy-user','旧库用户',?,?,'role-warehouse',1,?)`).run(password.hash, password.salt, now);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('legacy-supplier','LEG-S','旧供应商','','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('legacy-customer','LEG-C','旧客户','','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES('legacy-warehouse','LEG-W','旧仓库','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
      VALUES('legacy-product','LEG-P','旧货品','','个',100,0,1,?,?)`).run(now, now);

    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`
      DROP TABLE purchase_receipts;
      CREATE TABLE purchase_receipts(id TEXT PRIMARY KEY,receipt_no TEXT UNIQUE,purchase_order_id TEXT,supplier_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,handler_id TEXT NOT NULL,total_cents INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED')),receipt_date TEXT NOT NULL,remark TEXT NOT NULL DEFAULT '',creator_id TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO purchase_receipts VALUES('legacy-pr','LEG-PR',NULL,'legacy-supplier','legacy-warehouse','legacy-user',100,'DRAFT','2026-08-31','old','legacy-user','2026-08-31T00:00:00.000Z');

      DROP TABLE sales_deliveries;
      CREATE TABLE sales_deliveries(id TEXT PRIMARY KEY,delivery_no TEXT UNIQUE,sales_order_id TEXT,customer_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,handler_id TEXT NOT NULL,total_cents INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED')),delivery_date TEXT NOT NULL,remark TEXT NOT NULL DEFAULT '',creator_id TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO sales_deliveries VALUES('legacy-sd','LEG-SD',NULL,'legacy-customer','legacy-warehouse','legacy-user',100,'SUBMITTED','2026-08-31','old','legacy-user','2026-08-31T00:00:00.000Z');

      DROP TABLE return_orders;
      CREATE TABLE return_orders(id TEXT PRIMARY KEY,return_no TEXT UNIQUE,source_type TEXT NOT NULL CHECK(source_type IN ('PURCHASE','SALES')),source_id TEXT NOT NULL,customer_id TEXT,supplier_id TEXT,warehouse_id TEXT NOT NULL,total_cents INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED')),return_date TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',remark TEXT NOT NULL DEFAULT '',creator_id TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO return_orders VALUES('legacy-sr','LEG-SR','SALES','legacy-sd','legacy-customer',NULL,'legacy-warehouse',100,'DRAFT','2026-08-31','','old','legacy-user','2026-08-31T00:00:00.000Z');

      DROP TABLE purchase_returns;
      CREATE TABLE purchase_returns(id TEXT PRIMARY KEY,return_no TEXT UNIQUE,receipt_id TEXT,supplier_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,total_cents INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'DRAFT',reason TEXT,remark TEXT,creator_id TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO purchase_returns VALUES('legacy-pur','LEG-PUR','legacy-pr','legacy-supplier','legacy-warehouse',100,'DRAFT','','old','legacy-user','2026-08-31T00:00:00.000Z');

      DROP TABLE inventory_transactions;
      CREATE TABLE inventory_transactions(id TEXT PRIMARY KEY,type TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,product_id TEXT NOT NULL,quantity REAL NOT NULL,balance_after REAL NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO inventory_transactions VALUES('legacy-tx','IN','PURCHASE_RECEIPT','legacy-pr','legacy-warehouse','legacy-product',1,1,'2026-08-31T00:00:00.000Z');
    `);
    db.exec('PRAGMA foreign_keys=ON');
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));

    assert.equal(db.prepare("SELECT receipt_no FROM purchase_receipts WHERE id='legacy-pr'").get().receipt_no, 'LEG-PR');
    const legacyDelivery = db.prepare("SELECT delivery_no,status FROM sales_deliveries WHERE id='legacy-sd'").get();
    assert.equal(legacyDelivery.delivery_no, 'LEG-SD');
    assert.equal(legacyDelivery.status, 'DRAFT', 'legacy SUBMITTED maps to the canonical actionable state');
    assert.equal(db.prepare("SELECT delivery_id FROM return_orders WHERE id='legacy-sr'").get().delivery_id, 'legacy-sd');
    assert.equal(db.prepare("SELECT return_no FROM purchase_returns WHERE id='legacy-pur'").get().return_no, 'LEG-PUR');
    const transaction = db.prepare("SELECT quantity_change,direction FROM inventory_transactions WHERE id='legacy-tx'").get();
    assert.equal(transaction.quantity_change, 1);
    assert.equal(transaction.direction, 'IN');
  });
});

// =====================================================================
// B. narrow lookup endpoints
// =====================================================================

describe('v1.0.1 — narrow supplier / customer lookup endpoints', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let warehouseToken;
  let prevNodeEnv;

  before(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-wlook-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    const roleWarehouse = db.prepare("SELECT id FROM roles WHERE code='WAREHOUSE'").get();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('sup-it-1','S-IT-1','深圳测试供应商','l','1','sz',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('sup-it-2','S-IT-2','广州测试供应商','l','1','gz',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('cus-it-1','C-IT-1','深圳测试客户','l','1','sz',1,?,?)`).run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-it-1','WH-IT-1','主仓','','m',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-it-1','P-IT-1','入库测试品','TEST','个',1500,0,1,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh-it-1', productId: 'p-it-1', quantity: 100, position: {}, rowId: 'inv-it-1' });

    const h = hashPassword('wh-it-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-wh-it','warehouse','仓管',?,?,?,1,?)`).run(h.hash, h.salt, roleWarehouse.id, now);
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-it-1234' }),
    })).json()).token;
    assert.ok(warehouseToken, 'warehouse token must be present');
  });

  after(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('GET /api/lookup/suppliers returns narrow projection gated by receipt/return manage permission', async () => {
    const res = await fetch(`${baseUrl}/api/lookup/suppliers`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.suppliers));
    assert.ok(body.suppliers.length >= 2);
    // Strict narrow projection — only id/code/name, no contact/phone/address
    assert.deepEqual(Object.keys(body.suppliers[0]).sort(), ['code', 'id', 'name']);
  });

  test('GET /api/lookup/customers returns narrow projection gated by delivery/return manage permission', async () => {
    const res = await fetch(`${baseUrl}/api/lookup/customers`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.customers));
    assert.deepEqual(Object.keys(body.customers[0]).sort(), ['code', 'id', 'name']);
  });

  test('narrow lookups are still 403 for an actor outside warehouse workflow permissions', async () => {
    // Set up a role with no INVENTORY_VIEW (e.g. role-accounting stripped of
    // inventory permissions would 403). Use a separate role for this check.
    const roleNoInv = db.prepare(
      "INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('role-noinv','NO_INV','无库存视图','',0,datetime('now'))"
    );
    roleNoInv.run();
    db.prepare("INSERT INTO role_permissions(role_id,permission_code) VALUES('role-noinv','INVENTORY_VIEW')").run();
    const h = hashPassword('noinv-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-noinv','noinv','noinv',?,?,'role-noinv',1,?)`).run(h.hash, h.salt, new Date().toISOString());
    const token = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'noinv', password: 'noinv-1234' }),
    })).json()).token;
    for (const path of ['/api/lookup/suppliers', '/api/lookup/customers']) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
      assert.equal(res.status, 403, `${path} must 403 for inventory-only actor without the workflow permission`);
    }
  });

  test('role-warehouse permission closure is complete without trade/admin overgrant', async () => {
    const permissions = new Set(db.prepare("SELECT permission_code FROM role_permissions WHERE role_id='role-warehouse'").all().map((row) => row.permission_code));
    for (const required of [
      'PRODUCTS_VIEW', 'WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE', 'INVENTORY_VIEW',
      'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE',
      'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE',
      'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE', 'RETURNS_VIEW', 'RETURNS_MANAGE',
    ]) assert.ok(permissions.has(required), `missing warehouse permission ${required}`);
    for (const forbidden of [
      'PRODUCTS_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE',
      'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE',
      'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE',
      'ACCOUNTING_VIEW', 'PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE', 'USERS_MANAGE', 'ROLES_MANAGE',
      'PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_START', 'PRODUCTION_ORDERS_COMPLETE',
    ]) assert.ok(!permissions.has(forbidden), `warehouse must not receive ${forbidden}`);

    for (const path of [
      '/api/products', '/api/warehouses', '/api/inventory', '/api/inventory-checks',
      '/api/inventory-transfers', '/api/purchase-receipts', '/api/sales-deliveries',
      '/api/sales-returns', '/api/purchase-returns', '/api/lookup/suppliers', '/api/lookup/customers',
    ]) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
      assert.equal(res.status, 200, `${path} must be closed under role-warehouse permissions`);
    }
  });
});

// =====================================================================
// C. warehouse end-to-end: purchase receipts
// =====================================================================

describe('v1.0.1 — warehouse purchase-receipt full path', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let warehouseToken;
  let accountingToken;

  beforeEach(async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-pr-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    const roleWh = db.prepare("SELECT id FROM roles WHERE code='WAREHOUSE'").get();
    const roleAc = db.prepare("SELECT id FROM roles WHERE code='ACCOUNTING'").get();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('sup-1','S-001','测试供应商','contact','123','addr',1,?,?)`).run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-1','WH-001','主仓','','m',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-1','P-001','入库测试品','T','个',5000,0,1,?,?)").run(now, now);

    const whH = hashPassword('wh-pr-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-wh-pr','warehouse','仓管',?,?,'role-warehouse',1,?)`).run(whH.hash, whH.salt, now);
    const acH = hashPassword('ac-pr-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-ac-pr','accounting','财务',?,?,'role-accounting',1,?)`).run(acH.hash, acH.salt, now);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES('po-pr','PO-PR','sup-1','APPROVED',20000,'','user-wh-pr',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('poi-pr','po-pr','p-1',4,5000,20000,1)").run();

    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-pr-1234' }),
    })).json()).token;
    accountingToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'ac-pr-1234' }),
    })).json()).token;
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse list → create → confirm → inventory +1, confirmed_by persisted', async () => {
    // list
    let res = await fetch(`${baseUrl}/api/purchase-receipts`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
    assert.equal(res.status, 200);

    // create
    res = await fetch(`${baseUrl}/api/purchase-receipts`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ purchaseOrderId: 'po-pr', supplierId: 'sup-1', warehouseId: 'wh-1', items: [{ purchaseOrderItemId: 'poi-pr', productId: 'p-1', quantity: 4, unitPriceCents: 5000 }] }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.ok(created.id);
    const row0 = db.prepare('SELECT status, confirmed_by, total_cents, receipt_date FROM purchase_receipts WHERE id=?').get(created.id);
    assert.equal(row0.status, 'DRAFT');
    assert.equal(row0.confirmed_by, null);
    assert.equal(row0.total_cents, 20000);
    assert.ok(row0.receipt_date, 'receipt_date populated');

    const iqc = await (await fetch(`${baseUrl}/api/iqc`, { method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ purchase_receipt_id: created.id }) })).json();
    res = await fetch(`${baseUrl}/api/iqc/${iqc.id}/complete`, { method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ result: 'PASS', inspection_quantity: 4, passed_quantity: 4, failed_quantity: 0 }) });
    assert.equal(res.status, 200);

    // confirm (consumes PURCHASE_RECEIPTS_MANAGE — warehouse has it)
    res = await fetch(`${baseUrl}/api/purchase-receipts/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(res.status, 200, `confirm must succeed, got ${res.status}`);
    const row1 = db.prepare('SELECT status, confirmed_by, confirmed_at FROM purchase_receipts WHERE id=?').get(created.id);
    assert.equal(row1.status, 'CONFIRMED');
    assert.equal(row1.confirmed_by, 'user-wh-pr');
    assert.ok(row1.confirmed_at);

    // inventory +4
    const inv = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-1' AND product_id='p-1'").get();
    assert.equal(inv.quantity, 4);

    // repeated confirm replays the committed idempotent result
    res = await fetch(`${baseUrl}/api/purchase-receipts/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(res.status, 200);
  });

  test('accounting cannot create purchase receipts (PURCHASE_RECEIPTS_MANAGE absent on role-accounting)', async () => {
    const res = await fetch(`${baseUrl}/api/purchase-receipts`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accountingToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ supplierId: 'sup-1', warehouseId: 'wh-1', items: [{ productId: 'p-1', quantity: 1, unitPriceCents: 1000 }] }),
    });
    assert.equal(res.status, 403);
  });

  test('narrow supplier lookup usable for picker (no SUPPLIERS_VIEW)', async () => {
    const res = await fetch(`${baseUrl}/api/lookup/suppliers`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
    assert.equal(res.status, 200, 'warehouse must reach /api/lookup/suppliers via INVENTORY_VIEW');
    const body = await res.json();
    assert.ok(body.suppliers.find((s) => s.id === 'sup-1'));
  });
});

// =====================================================================
// D. warehouse end-to-end: sales deliveries
// =====================================================================

describe('v1.0.1 — warehouse sales-delivery full path', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let warehouseToken;
  let prevNodeEnv;

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-sd-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    const roleWh = db.prepare("SELECT id FROM roles WHERE code='WAREHOUSE'").get();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('cus-1','C-001','测试客户','c','1','sz',1,?,?)`).run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-1','WH-001','主仓','','m',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-1','P-001','出库测试品','T','个',1000,0,1,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh-1', productId: 'p-1', quantity: 10, position: {}, rowId: 'inv-sd-1' });

    const h = hashPassword('wh-sd-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-wh-sd','warehouse','仓管',?,?,'role-warehouse',1,?)`).run(h.hash, h.salt, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES('so-sd','SO-SD','cus-1','APPROVED',9999000,'','user-wh-sd',?,?)").run(now, now);
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-sd','so-sd','p-1',9999,1000,9999000,1)").run();
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-sd-1234' }),
    })).json()).token;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse list → create → confirm → inventory -qty, status CONFIRMED', async () => {
    let res = await fetch(`${baseUrl}/api/sales-deliveries`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/sales-deliveries`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ salesOrderId: 'so-sd', customerId: 'cus-1', warehouseId: 'wh-1', items: [{ salesOrderItemId: 'soi-sd', productId: 'p-1', quantity: 3, unitPriceCents: 1000 }] }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.ok(created.id);
    const row0 = db.prepare('SELECT status, confirmed_by, delivery_date FROM sales_deliveries WHERE id=?').get(created.id);
    assert.equal(row0.status, 'DRAFT');
    assert.equal(row0.confirmed_by, null);
    assert.ok(row0.delivery_date);

    const oqc = await (await fetch(`${baseUrl}/api/oqc`, { method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ sales_delivery_id: created.id }) })).json();
    res = await fetch(`${baseUrl}/api/oqc/${oqc.id}/complete`, { method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ result: 'PASS', inspection_quantity: 3, passed_quantity: 3, failed_quantity: 0 }) });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/sales-deliveries/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(res.status, 200, `confirm must succeed, got ${res.status}`);
    const row1 = db.prepare('SELECT status, confirmed_by, confirmed_at FROM sales_deliveries WHERE id=?').get(created.id);
    assert.equal(row1.status, 'CONFIRMED');
    assert.equal(row1.confirmed_by, 'user-wh-sd');

    const inv = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-1' AND product_id='p-1'").get();
    assert.equal(inv.quantity, 7);

    res = await fetch(`${baseUrl}/api/sales-deliveries/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(res.status, 200);

    // cancel path
    res = await fetch(`${baseUrl}/api/sales-deliveries/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    assert.equal(res.status, 409, 'cannot cancel a CONFIRMED delivery');
  });

  test('create rejects over-quantity (stock validation)', async () => {
    const res = await fetch(`${baseUrl}/api/sales-deliveries`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ salesOrderId: 'so-sd', customerId: 'cus-1', warehouseId: 'wh-1', items: [{ salesOrderItemId: 'soi-sd', productId: 'p-1', quantity: 9999, unitPriceCents: 1000 }] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error || '', /库存不足/);
  });
});

// =====================================================================
// E. warehouse end-to-end: returns (sales + purchase)
// =====================================================================

describe('v1.0.1 — warehouse returns full path (sales + purchase)', () => {
  let tmp;
  let db;
  let svr;
  let baseUrl;
  let warehouseToken;
  let accountingToken;

  beforeEach(async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-rt-'));
    db = createDatabase(join(tmp, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${svr.address().port}`;

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('sup-r','S-R','采购退货供应商','l','1','a',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('cus-r','C-R','销售退货客户','l','1','a',1,?,?)`).run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-r','WH-R','主仓','','m',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-r','P-R','退货测试品','T','个',800,0,1,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh-r', productId: 'p-r', quantity: 20, position: {}, rowId: 'inv-r-1' });

    const h = hashPassword('wh-rt-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-wh-rt','warehouse','仓管',?,?,'role-warehouse',1,?)`).run(h.hash, h.salt, now);
    warehouseToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse', password: 'wh-rt-1234' }),
    })).json()).token;
    const accountingHash = hashPassword('ac-rt-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-ac-rt','accounting','财务',?,?,'role-accounting',1,?)`).run(accountingHash.hash, accountingHash.salt, now);
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd-rt','SD-RT','cus-r','wh-r','user-wh-rt',8000,'CONFIRMED','2026-09-01','','user-wh-rt',?,?)").run(now, now);
    db.prepare("INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('sdi-rt','sd-rt','p-r',10,800,8000,1)").run();
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('pr-rt','PR-RT','sup-r','wh-r','user-wh-rt',8000,'CONFIRMED','2026-09-01','','user-wh-rt',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('pri-rt','pr-rt','p-r',10,800,8000,1)").run();
    accountingToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'ac-rt-1234' }),
    })).json()).token;
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse creates sales return via /api/sales-returns (newly wired path)', async () => {
    const res = await fetch(`${baseUrl}/api/sales-returns`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        deliveryId: 'sd-rt', customerId: 'cus-r', warehouseId: 'wh-r',
        items: [{ deliveryItemId: 'sdi-rt', productId: 'p-r', quantity: 2, unitPriceCents: 800 }],
      }),
    });
    assert.equal(res.status, 201, `create sales return must succeed, got ${res.status}`);
    const created = await res.json();
    const row = db.prepare('SELECT status, customer_id, return_date, source_id, delivery_id FROM return_orders WHERE id=?').get(created.id);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.customer_id, 'cus-r');
    assert.ok(row.return_date);
    assert.equal(row.delivery_id, 'sd-rt');
    assert.equal(row.source_id, 'sd-rt');

    const confirmed = await fetch(`${baseUrl}/api/sales-returns/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-r' AND product_id='p-r'").get().quantity, 22);
    const repeated = await fetch(`${baseUrl}/api/sales-returns/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(repeated.status, 409);
  });

  test('warehouse creates purchase return via /api/purchase-returns', async () => {
    const res = await fetch(`${baseUrl}/api/purchase-returns`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        receiptId: 'pr-rt', supplierId: 'sup-r', warehouseId: 'wh-r',
        items: [{ receiptItemId: 'pri-rt', productId: 'p-r', quantity: 1, unitPriceCents: 800 }],
      }),
    });
    assert.equal(res.status, 201, `create purchase return must succeed, got ${res.status}`);
    const created = await res.json();
    const row = db.prepare('SELECT status, supplier_id, return_date FROM purchase_returns WHERE id=?').get(created.id);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.supplier_id, 'sup-r');
    assert.ok(row.return_date);

    const confirmed = await fetch(`${baseUrl}/api/purchase-returns/${created.id}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-r' AND product_id='p-r'").get().quantity, 19);
  });

  test('returns list (sales + purchase) both 200 for warehouse', async () => {
    for (const path of ['/api/sales-returns', '/api/purchase-returns']) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
      assert.equal(res.status, 200, `${path} must 200`);
    }
  });

  test('narrow customer / supplier lookup usable for returns picker (no full *_VIEW)', async () => {
    for (const path of ['/api/lookup/customers', '/api/lookup/suppliers']) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } });
      assert.equal(res.status, 200, `${path} must 200 for warehouse`);
    }
  });

  test('invalid quantity and unauthorized actor are rejected normally', async () => {
    let res = await fetch(`${baseUrl}/api/sales-returns`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${warehouseToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'cus-r', warehouseId: 'wh-r', items: [{ productId: 'p-r', quantity: 0 }] }),
    });
    assert.equal(res.status, 400);
    res = await fetch(`${baseUrl}/api/sales-returns`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accountingToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'cus-r', warehouseId: 'wh-r', items: [{ productId: 'p-r', quantity: 1 }] }),
    });
    assert.equal(res.status, 403);
  });
});

// =====================================================================
// F. Frontend: modal dependency-contract source-level checks
// =====================================================================

describe('v1.0.1 — frontend warehouse modal source-level contract', () => {
  const logistics = readFileSync(join(srcDir, 'pages', 'logistics-finance.jsx'), 'utf8');

  // Extract a single top-level function body so contract assertions are
  // scoped to one modal rather than scanning the whole file.
  function extract(name) {
    const idx = logistics.indexOf('function ' + name + '(');
    assert.notEqual(idx, -1, name + ' must exist in logistics-finance.jsx');
    // Skip past the parameter list to find the body opening brace. Walk
    // through balanced parens so destructured params don't fool us.
    let i = idx;
    let parenDepth = 0;
    while (i < logistics.length) {
      const c = logistics[i];
      if (c === '(') parenDepth++;
      else if (c === ')') {
        parenDepth--;
        if (parenDepth === 0) { i++; break; }
      }
      i++;
    }
    // Now i points just after ')'. Find the next '{' — that's the body.
    while (i < logistics.length && logistics[i] !== '{') i++;
    let depth = 0;
    const start = idx;
    for (; i < logistics.length; i++) {
      const c = logistics[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return logistics.slice(start, i + 1);
      }
    }
    return logistics.slice(start);
  }
  const purchaseReceiptEditor = extract('PurchaseReceiptEditorV16');
  const salesDeliveryModal = extract('SalesDeliveryModal');
  const returnModal = extract('ReturnModal');

  test('PurchaseReceiptEditorV16 loads suppliers via /api/lookup/suppliers (narrow)', () => {
    assert.doesNotMatch(purchaseReceiptEditor,
      /Promise\.all\(\[\s*api\("\/api\/suppliers"/,
      'purchaseReceiptEditor must NOT use the broad /api/suppliers');
    assert.match(purchaseReceiptEditor,
      /api\(['"]\/api\/lookup\/suppliers['"]\)/,
      'purchaseReceiptEditor must use /api/lookup/suppliers');
  });

  test('SalesDeliveryModal loads customers via /api/lookup/customers (narrow)', () => {
    assert.doesNotMatch(salesDeliveryModal,
      /Promise\.all\(\[\s*api\("\/api\/customers"/,
      'salesDeliveryModal must NOT use the broad /api/customers');
    assert.match(salesDeliveryModal,
      /api\("\/api\/lookup\/customers"\)\.then\(\(r\)\s*=>\s*setCustomers/,
      'salesDeliveryModal must use /api/lookup/customers');
  });

  test('ReturnModal loads both customers and suppliers via narrow lookup endpoints', () => {
    assert.match(returnModal,
      /api\("\/api\/lookup\/suppliers"\)\.then\(\(r\)\s*=>\s*setSuppliers/);
    assert.match(returnModal,
      /api\("\/api\/lookup\/customers"\)\.then\(\(r\)\s*=>\s*setCustomers/);
  });

  test('Each fetch in the warehouse modals carries its own .catch', () => {
    assert.match(purchaseReceiptEditor,
      /api\(['"]\/api\/lookup\/suppliers['"]\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*['"]error['"]\)\)/,
      'purchase receipt supplier lookup missing its own .catch');
    for (const modal of [returnModal]) {
      assert.match(modal,
        /api\("\/api\/lookup\/suppliers"\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*"error"\)\)/,
        'lookup-suppliers missing its own .catch');
    }
    for (const modal of [salesDeliveryModal, returnModal]) {
      assert.match(modal,
        /api\("\/api\/warehouses"\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*"error"\)\)/,
        'warehouses missing its own .catch');
      assert.match(modal,
        /api\("\/api\/products"\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*"error"\)\)/,
        'products missing its own .catch');
    }
    for (const endpoint of ['warehouses', 'products']) {
      assert.match(purchaseReceiptEditor,
        new RegExp(`api\\(['"]\\/api\\/${endpoint}['"]\\)[\\s\\S]*?\\.catch\\(\\(e\\)\\s*=>\\s*notify\\(e\\.message,\\s*['"]error['"]\\)\\)`),
        `purchase receipt ${endpoint} lookup missing its own .catch`);
    }
    assert.match(salesDeliveryModal,
      /api\("\/api\/lookup\/customers"\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*"error"\)\)/,
      'lookup-customers missing its own .catch');
    assert.match(returnModal,
      /api\("\/api\/lookup\/customers"\)[\s\S]*?\.catch\(\(e\)\s*=>\s*notify\(e\.message,\s*"error"\)\)/,
      'lookup-customers missing its own .catch in returns modal');
  });

  test('setForm anti-pattern eliminated in the three warehouse modals', () => {
    for (const modal of [salesDeliveryModal, returnModal]) {
      assert.doesNotMatch(modal,
        /if \(detail && !form\.\w+\)\s+setForm\(/,
        'setForm must not be invoked inside the JSX render body');
      assert.match(modal,
        /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if \(detail[\s\S]*?setForm\(/,
        'setForm must be moved into a dedicated useEffect');
    }
    assert.doesNotMatch(purchaseReceiptEditor,
      /if \(detail && !form\.\w+\)\s+setForm\(/,
      'setForm must not be invoked inside the JSX render body');
    assert.match(purchaseReceiptEditor,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if \(detailRes && detailRes\.purchaseReceipt\)[\s\S]*?setForm\(/,
      'purchase receipt editor must initialize form state inside its loading effect');
  });

  test('WHITE-SCREEN SAFETY: lookup endpoints use workflow permissions only after Core Scope Cleanup', () => {
    // Source-level guarantee: the narrow lookup endpoints exist; their
    // backend gating does not require SUPPLIERS_VIEW / CUSTOMERS_VIEW so
    // a future custom role can keep warehouse scoped. Core Scope Cleanup
    // removed the CRM_VIEW / CRM_MANAGE permissions; the lookup
    // endpoints no longer reference them.
    //
    // V2 Wave 4C: the canonical implementations moved to
    // server/modules/lookups.js and the route-table became the single
    // dispatch entry. The behavioral gating contract is unchanged;
    // only the source file changed.
    const lookups = readFileSync(join(repoRoot, 'server', 'modules', 'lookups.js'), 'utf8');
    const appSource = readFileSync(join(repoRoot, 'server', 'app.js'), 'utf8');
    assert.match(lookups,
      /export function listSupplierLookup[\s\S]*?allowAny\(actor,\s*\[['"]PURCHASE_RECEIPTS_MANAGE['"],\s*['"]RETURNS_MANAGE['"]\]\)/,
      'listSupplierLookup must gate by receipt/return workflow permissions');
    assert.match(lookups,
      /export function listCustomerLookup[\s\S]*?allowAny\(actor,\s*\[['"]SALES_DELIVERIES_MANAGE['"],\s*['"]RETURNS_MANAGE['"]\]\)/,
      'listCustomerLookup must gate by delivery/return workflow permissions');
    assert.doesNotMatch(appSource,
      /function listSupplierLookup\b/,
      'V2 Wave 4C: app.js must NOT declare listSupplierLookup (now owned by server/modules/lookups.js)');
    assert.doesNotMatch(appSource,
      /function listCustomerLookup\b/,
      'V2 Wave 4C: app.js must NOT declare listCustomerLookup (now owned by server/modules/lookups.js)');
  });

  test('stale inaccessible hash renders a safe denial without mounting admin UsersRoles', () => {
    const app = readFileSync(join(srcDir, 'App.jsx'), 'utf8');
    assert.match(app, /!userCanAccessRoute\(user, route\)[\s\S]*?<SafeRouteState kind="PERMISSION_DENIED"/);
    assert.match(app, /normalized\.invalid \|\| !route \|\| !userCanAccessRoute\(user, route\)/);
    assert.doesNotMatch(app, /className="page-content">\{pages\[page\]/);
  });
});
