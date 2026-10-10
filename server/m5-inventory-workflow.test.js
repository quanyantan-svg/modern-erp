import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('M5 inventory workflow', () => {
  let tmp; let db; let server; let baseUrl; const tokens = {};
  const auth = (role) => role ? { authorization: `Bearer ${tokens[role]}` } : {};
  const request = (path, role, options = {}) => fetch(baseUrl + path, { ...options, headers: { ...auth(role), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const post = (path, role, body) => request(path, role, { method: 'POST', body: JSON.stringify(body || {}) });
  const patch = (path, role, body) => request(path, role, { method: 'PATCH', body: JSON.stringify(body) });
  const adjustment = (items = [{ productId: 'p1', quantityDelta: 5 }], extra = {}) => ({ warehouseId: 'wh', adjustmentDate: '2026-09-16', reason: '盘差纠正', items, ...extra });

  beforeEach(async () => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-m5-')); db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    const now = '2026-09-16T00:00:00.000Z';
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH','主仓','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh2','WH2','副仓','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p1','P1','货品一','','个',100,0,1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p2','P2','货品二','','箱',200,0,1,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p1', quantity: 10, position: {}, rowId: 'i1' });
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p2', quantity: 20, position: {}, rowId: 'i2' });
    for (const [name, role] of [['admin', 'role-admin'], ['warehouse', 'role-warehouse'], ['sales', 'role-sales'], ['reviewer', 'role-reviewer'], ['accounting', 'role-accounting']]) {
      const password = `${name}-m5-password`; const hashed = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(`u-${name}`, name, name, hashed.hash, hashed.salt, role, now);
    }
    server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['admin', 'warehouse', 'sales', 'reviewer', 'accounting']) {
      const response = await post('/api/auth/login', null, { username: name, password: `${name}-m5-password` }); tokens[name] = (await response.json()).token;
    }
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done())); db.close(); rmSync(tmp, { recursive: true, force: true });
  });

  test('inventory query filters canonical rows and detail returns bounded movements', async () => {
    const byWarehouse = await (await request('/api/inventory?warehouse=wh', 'warehouse')).json();
    const byProduct = await (await request('/api/inventory?product=p1', 'warehouse')).json();
    assert.equal(byWarehouse.inventory.length, 2); assert.equal(byProduct.inventory.length, 1);
    assert.equal(new Set(byWarehouse.inventory.map((row) => `${row.warehouse_id}/${row.product_id}`)).size, 2);
    const detail = await (await request('/api/inventory/wh/p1', 'warehouse')).json();
    assert.equal(detail.stock.quantity, 10); assert.ok(detail.transactions.length <= 20);
  });

  test('draft accepts positive and sufficient negative deltas without stock, transaction or voucher effect', async () => {
    const response = await post('/api/inventory-adjustments', 'warehouse', adjustment([{ productId: 'p1', quantityDelta: 5 }, { productId: 'p2', quantityDelta: -3 }]));
    assert.equal(response.status, 201); const created = await response.json(); assert.match(created.adjustmentNo, /^IA-/);
    assert.deepEqual(db.prepare('SELECT product_id,quantity FROM inventory WHERE warehouse_id=? ORDER BY product_id').all('wh').map((row) => [row.product_id, row.quantity]), [['p1', 10], ['p2', 20]]);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM inventory_transactions WHERE source_type='INVENTORY_ADJUSTMENT'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM accounting_vouchers WHERE source_type='INVENTORY_ADJUSTMENT'").get().count, 0);
  });

  test('adjustment number is unique and zero, invalid quantity and missing reason are rejected', async () => {
    const first = await (await post('/api/inventory-adjustments', 'admin', adjustment())).json();
    const second = await (await post('/api/inventory-adjustments', 'admin', adjustment())).json();
    assert.notEqual(first.adjustmentNo, second.adjustmentNo);
    assert.equal((await post('/api/inventory-adjustments', 'admin', adjustment([{ productId: 'p1', quantityDelta: 0 }]))).status, 400);
    assert.equal((await post('/api/inventory-adjustments', 'admin', adjustment([{ productId: 'p1', quantityDelta: 'bad' }]))).status, 400);
    assert.equal((await post('/api/inventory-adjustments', 'admin', adjustment(undefined, { reason: '' }))).status, 400);
  });

  test('draft edit is atomic, preserves identity and has no stock effect', async () => {
    const created = await (await post('/api/inventory-adjustments', 'warehouse', adjustment())).json();
    const response = await patch(`/api/inventory-adjustments/${created.id}`, 'warehouse', adjustment([{ productId: 'p1', quantityDelta: -2 }], { reason: '改后原因' }));
    assert.equal(response.status, 200); const detail = await (await request(`/api/inventory-adjustments/${created.id}`, 'warehouse')).json();
    assert.equal(detail.inventoryAdjustment.adjustment_no, created.adjustmentNo); assert.equal(detail.inventoryAdjustment.items[0].quantityDelta, -2);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id='i1'").get().quantity, 10);
  });

  test('confirm recalculates stock and writes exactly one trace row per item', async () => {
    const created = await (await post('/api/inventory-adjustments', 'warehouse', adjustment([{ productId: 'p1', quantityDelta: 5 }, { productId: 'p2', quantityDelta: -3 }]))).json();
    db.prepare("UPDATE inventory SET quantity=12 WHERE id='i1'").run();
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/confirm`, 'warehouse')).status, 200);
    assert.deepEqual(db.prepare('SELECT product_id,quantity FROM inventory WHERE warehouse_id=? ORDER BY product_id').all('wh').map((row) => [row.product_id, row.quantity]), [['p1', 17], ['p2', 17]]);
    const lines = db.prepare('SELECT product_id,before_quantity,quantity_delta,after_quantity FROM inventory_adjustment_items WHERE adjustment_id=? ORDER BY line_no').all(created.id);
    assert.deepEqual(lines.map((row) => [row.product_id, row.before_quantity, row.quantity_delta, row.after_quantity]), [['p1', 12, 5, 17], ['p2', 20, -3, 17]]);
    const tx = db.prepare("SELECT direction,quantity_change,balance_after,source_type,source_id,source_no FROM inventory_transactions WHERE source_id=? ORDER BY product_id").all(created.id);
    assert.deepEqual(tx.map((row) => [row.direction, row.quantity_change, row.balance_after, row.source_type, row.source_id, row.source_no]), [['IN', 5, 17, 'INVENTORY_ADJUSTMENT', created.id, created.adjustmentNo], ['OUT', 3, 17, 'INVENTORY_ADJUSTMENT', created.id, created.adjustmentNo]]);
  });

  test('one insufficient line rolls back every stock and movement change', async () => {
    const created = await (await post('/api/inventory-adjustments', 'warehouse', adjustment([{ productId: 'p1', quantityDelta: 5 }, { productId: 'p2', quantityDelta: -999 }]))).json();
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/confirm`, 'warehouse')).status, 409);
    assert.deepEqual(db.prepare('SELECT product_id,quantity FROM inventory WHERE warehouse_id=? ORDER BY product_id').all('wh').map((row) => [row.product_id, row.quantity]), [['p1', 10], ['p2', 20]]);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM inventory_transactions WHERE source_id=?').get(created.id).count, 0);
    assert.equal(db.prepare('SELECT status FROM inventory_adjustments WHERE id=?').get(created.id).status, 'DRAFT');
  });

  test('repeated confirmation is a controlled 409 and never duplicates stock movement', async () => {
    const created = await (await post('/api/inventory-adjustments', 'admin', adjustment())).json();
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/confirm`, 'admin')).status, 200);
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/confirm`, 'admin')).status, 409);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id='i1'").get().quantity, 15);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM inventory_transactions WHERE source_id=?').get(created.id).count, 1);
    assert.equal((await patch(`/api/inventory-adjustments/${created.id}`, 'admin', adjustment())).status, 409);
  });

  test('cancelled draft has no effect and cancelled or confirmed documents are immutable', async () => {
    const created = await (await post('/api/inventory-adjustments', 'warehouse', adjustment())).json();
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/cancel`, 'warehouse')).status, 200);
    assert.equal((await post(`/api/inventory-adjustments/${created.id}/confirm`, 'warehouse')).status, 409);
    assert.equal((await patch(`/api/inventory-adjustments/${created.id}`, 'warehouse', adjustment())).status, 409);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id='i1'").get().quantity, 10);
  });

  test('adjustment permission is narrow: warehouse/admin allowed and other roles forbidden', async () => {
    assert.equal((await request('/api/inventory-adjustments', 'warehouse')).status, 200);
    assert.equal((await request('/api/inventory-adjustments', 'admin')).status, 200);
    for (const role of ['sales', 'reviewer', 'accounting']) assert.equal((await request('/api/inventory-adjustments', role)).status, 403, role);
    assert.equal((await request('/api/inventory-adjustments')).status, 401);
    const grants = db.prepare("SELECT r.code roleCode FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE rp.permission_code='INVENTORY_ADJUSTMENT_MANAGE' ORDER BY r.code").all().map((row) => row.roleCode);
    assert.deepEqual(grants, ['ADMIN', 'WAREHOUSE']);
  });

  test('movement filters expose friendly adjustment trace fields', async () => {
    const created = await (await post('/api/inventory-adjustments', 'warehouse', adjustment())).json(); await post(`/api/inventory-adjustments/${created.id}/confirm`, 'warehouse');
    assert.equal((await request('/api/inventory-transactions?warehouse=wh&product=p1&direction=IN&type=INVENTORY_ADJUSTMENT&startDate=2026-01-01&endDate=2026-12-31', 'warehouse')).status, 200);
    const source = readFileSync(resolve(repoRoot, 'src/pages/logistics-finance.jsx'), 'utf8');
    assert.match(source, /INVENTORY_ADJUSTMENT:\s*["']库存调整/); assert.match(source, /来源单号/); assert.doesNotMatch(source, /label=\{item\.tx_type\}/);
  });

  test('mobile inventory information architecture stays in scope and uses correct terminology', () => {
    const source = readFileSync(resolve(repoRoot, 'src/pages/master-data.jsx'), 'utf8');
    for (const label of ['库存', '调拨', '盘点', '调整', '库存异动']) assert.match(source, new RegExp(label));
    const inventorySection = source.slice(source.indexOf('export function Inventory('), source.indexOf('function InventoryChecks('));
    assert.doesNotMatch(inventorySection, /库存报废|库存月结|审批调整|审核通过/);
    for (const label of ['提交审批', '前往审批中心', '确认调拨', '确认调整']) assert.match(source, new RegExp(label));
    assert.match(source, /INVENTORY_ADJUSTMENT_MANAGE/);
  });

  test('adjustment schema and permission reconciliation are idempotent and preserve inventory', () => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_adjustments'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_inventory_adjustment_items_document'").get());
    assert.equal(db.prepare("SELECT COUNT(*) count FROM permissions WHERE code='INVENTORY_ADJUSTMENT_MANAGE'").get().count, 1);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id='i1'").get().quantity, 10);
  });
});
