// M6 Production Workflow — focused tests for explicit material issue and
// production receipt documents. Verifies that:
//   * Production Order START / COMPLETE remain status transitions only
//     (zero inventory effect, zero voucher effect);
//   * Material Issue and Production Receipt are the canonical, atomic
//     stock-affecting documents for production;
//   * Five-role contract holds (admin only, sales/reviewer/warehouse/
//     accounting are forbidden from manufacturing mutations);
//   * The permission registry includes the subsequent M8 settlement additions;
//   * The legacy DB shape (no M6 tables) opens cleanly, M6 migration
//     is idempotent, and existing BOM/production_orders/inventory are
//     untouched;
//   * Mobile UI surfaces include 制令单 / 用料出库 / 生产入库 and exclude
//     fake / deferred production cards.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS, id } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;
let reviewerToken;
let warehouseToken;
let accountingToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m6-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  reviewerToken = await login('reviewer', 'review123');
  warehouseToken = await login('warehouse', 'warehouse123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  try { database.close(); } catch {}
  await new Promise((r) => setTimeout(r, 100));
  try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

function seedBomAndOrder() {
  const warehouseId = 'wh-' + id().slice(0, 8);
  database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
    .run(warehouseId, 'WH-M6-' + warehouseId.slice(3, 7), 'M6 测试仓 ' + warehouseId.slice(3, 7));
  const bomId = id();
  const invP2 = id();
  const invP3 = id();
  const invP1 = id();
  database.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))")
    .run(bomId, 'product-001', 'm6-v1', 'ACTIVE', '', 'user-admin');
  const itemStmt = database.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
  itemStmt.run(id(), bomId, 'product-002', 2, 0, 1);
  itemStmt.run(id(), bomId, 'product-003', 1, 0, 2);
  database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
    .run(invP2, warehouseId, 'product-002', 50);
  database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
    .run(invP3, warehouseId, 'product-003', 3);
  database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
    .run(invP1, warehouseId, 'product-001', 0);
  return { bomId, warehouseId };
}

function seedProductionOrder(quantity = 5, bomId = null) {
  const orderId = id();
  const orderNo = 'MO-M6-' + orderId.slice(0, 8);
  database.prepare("INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',NULL,NULL,?,?,datetime('now'),datetime('now'))")
    .run(orderId, orderNo, 'product-001', bomId, quantity, '', 'user-admin');
  return { orderId, orderNo };
}

// =====================================================================
// 1. Permission registry
// =====================================================================

describe('M6 permission registry', () => {
  test('1. PERMISSIONS registry has 100 entries including M6 and M8 permissions', () => {
    assert.equal(PERMISSIONS.length, 100);
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    assert.ok(codes.has('PRODUCTION_MATERIAL_ISSUE_MANAGE'));
    assert.ok(codes.has('PRODUCTION_RECEIPT_MANAGE'));
  });

  test('2. role-admin inherits both M6 perms via all-permissions mapping', async () => {
    const me = await request('/api/auth/me');
    assert.ok(me.data.user.permissions.includes('PRODUCTION_MATERIAL_ISSUE_MANAGE'));
    assert.ok(me.data.user.permissions.includes('PRODUCTION_RECEIPT_MANAGE'));
  });

  test('3. role-sales / role-reviewer / role-warehouse / role-accounting do not hold M6 perms', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const me = await request('/api/auth/me', { token });
      assert.equal(me.data.user.permissions.includes('PRODUCTION_MATERIAL_ISSUE_MANAGE'), false, `${username} should not hold PRODUCTION_MATERIAL_ISSUE_MANAGE`);
      assert.equal(me.data.user.permissions.includes('PRODUCTION_RECEIPT_MANAGE'), false, `${username} should not hold PRODUCTION_RECEIPT_MANAGE`);
    }
  });
});

// =====================================================================
// 2. Production Order START / COMPLETE — zero stock effect
// =====================================================================

describe('M6 production order START / COMPLETE preserve zero stock effect', () => {
  test('4. START changes status only — no inventory transaction, no stock mutation', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    const start = await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200);
    const order = database.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId);
    assert.equal(order.status, 'IN_PROGRESS');
    const p2 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-002');
    const p3 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-003');
    assert.equal(Number(p2.quantity), 50);
    assert.equal(Number(p3.quantity), 3);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_OUTPUT' AND source_id=?").get(orderId).cnt;
    assert.equal(txCount, 0, 'no production output inventory transaction should exist');
    const vouchers = database.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE source_type='PRODUCTION_ORDER' AND source_id=?").get(orderId).cnt;
    assert.equal(vouchers, 0, 'no manufacturing voucher should be generated');
  });

  test('5. COMPLETE changes status only — no inventory transaction, no stock mutation', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const complete = await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 200);
    const order = database.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId);
    assert.equal(order.status, 'COMPLETED');
    const p1 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-001');
    assert.equal(Number(p1.quantity), 0, 'completed order must not have increased finished goods');
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type IN ('PRODUCTION_OUTPUT','PRODUCTION_RECEIPT') AND source_id=?").get(orderId).cnt;
    assert.equal(txCount, 0);
  });
});

// =====================================================================
// 3. Material Issue — core contract
// =====================================================================

describe('M6 material issue contract', () => {
  test('6. creating DRAFT issues no inventory transaction', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: {
      productionOrderId: orderId,
      warehouseId,
      items: [
        { productId: 'product-002', plannedQuantity: 10, issueQuantity: 5 },
      ],
    } });
    assert.equal(create.status, 201, create.data.error);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE'").get().cnt;
    assert.equal(txCount, 0);
  });

  test('7. issue_no is unique across issues', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    const second = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    assert.notEqual(first.data.issueNo, second.data.issueNo);
  });

  test('8. zero / invalid issue quantity rejected with 400', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const zero = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 0 }] } });
    assert.equal(zero.status, 400);
    const invalid = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: -1 }] } });
    assert.equal(invalid.status, 400);
  });

  test('9. BOM prefill returns computed plannedQuantity from active BOM', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(4, bomId);
    const prefill = await request(`/api/production-material-issues/prefill-from-bom?productionOrderId=${orderId}`);
    assert.equal(prefill.status, 200);
    assert.equal(prefill.data.hasBom, true);
    const byProduct = Object.fromEntries(prefill.data.items.map((it) => [it.productId, it.plannedQuantity]));
    assert.equal(byProduct['product-002'], 8, '2 × 4 = 8 with 0% scrap');
    assert.equal(byProduct['product-003'], 4, '1 × 4 = 4 with 0% scrap');
  });

  test('10. no-BOM production order exposes empty prefill with hasBom=false', async () => {
    const { orderId } = seedProductionOrder(4, null);
    const prefill = await request(`/api/production-material-issues/prefill-from-bom?productionOrderId=${orderId}`);
    assert.equal(prefill.status, 200);
    assert.equal(prefill.data.hasBom, false);
    assert.deepEqual(prefill.data.items, []);
  });

  test('11. multi-item atomic rollback on insufficient stock — no partial movement', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const beforeP2 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-002').quantity;
    const beforeP3 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-003').quantity;
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [
      { productId: 'product-002', issueQuantity: 5 },
      { productId: 'product-003', issueQuantity: 999 },
    ] } });
    assert.equal(create.status, 201, create.data.error);
    const confirm = await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 409, confirm.data.error);
    assert.match(confirm.data.error, /库存不足/);
    const issue = database.prepare('SELECT status FROM production_material_issues WHERE id=?').get(create.data.id);
    assert.equal(issue.status, 'DRAFT');
    const afterP2 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-002').quantity;
    const afterP3 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-003').quantity;
    assert.equal(Number(afterP2), Number(beforeP2), 'p2 stock must be unchanged');
    assert.equal(Number(afterP3), Number(beforeP3), 'p3 stock must be unchanged');
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 0);
  });

  test('12. confirmation re-checks current stock — DRAFT snapshot is not trusted', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 49 }] } });
    assert.equal(create.status, 201, create.data.error);
    database.prepare("UPDATE inventory SET quantity=1 WHERE warehouse_id=? AND product_id=?").run(warehouseId, 'product-002');
    const confirm = await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 409, confirm.data.error);
    const issue = database.prepare('SELECT status FROM production_material_issues WHERE id=?').get(create.data.id);
    assert.equal(issue.status, 'DRAFT');
  });

  test('13. successful confirmation produces one OUT transaction per item with balance_after', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [
      { productId: 'product-002', issueQuantity: 5 },
      { productId: 'product-003', issueQuantity: 2 },
    ] } });
    assert.equal(create.status, 201, create.data.error);
    const confirm = await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 200, confirm.data.error);
    const tx = database.prepare("SELECT product_id, direction, quantity_change, balance_after, source_type, source_id, source_no FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=? ORDER BY product_id").all(create.data.id);
    assert.equal(tx.length, 2);
    for (const row of tx) {
      assert.equal(row.direction, 'OUT');
      assert.equal(row.source_type, 'PRODUCTION_MATERIAL_ISSUE');
      assert.equal(row.source_id, create.data.id);
      assert.ok(row.source_no.length > 0);
    }
    const p2tx = tx.find((row) => row.product_id === 'product-002');
    assert.equal(Number(p2tx.quantity_change), 5);
    assert.equal(Number(p2tx.balance_after), 45);
    const items = database.prepare('SELECT product_id, before_quantity, after_quantity FROM production_material_issue_items WHERE issue_id=? ORDER BY product_id').all(create.data.id);
    assert.deepEqual(items.map((it) => it.product_id), ['product-002', 'product-003']);
    assert.equal(Number(items.find((it) => it.product_id === 'product-002').before_quantity), 50);
    assert.equal(Number(items.find((it) => it.product_id === 'product-002').after_quantity), 45);
  });

  test('14. repeated confirm on a CONFIRMED issue is blocked', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    assert.equal(create.status, 201);
    await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    const again = await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(again.status, 409);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 1, 'second confirm must not create additional transactions');
  });

  test('15. cancelling a DRAFT issue produces no stock effect', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 5 }] } });
    const cancel = await request(`/api/production-material-issues/${create.data.id}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);
    const issue = database.prepare('SELECT status FROM production_material_issues WHERE id=?').get(create.data.id);
    assert.equal(issue.status, 'CANCELLED');
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 0);
  });

  test('16. cancelling a CONFIRMED issue is rejected', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    const cancel = await request(`/api/production-material-issues/${create.data.id}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 409);
    const issue = database.prepare('SELECT status FROM production_material_issues WHERE id=?').get(create.data.id);
    assert.equal(issue.status, 'CONFIRMED');
  });

  test('17. material issue may only be confirmed when production order is IN_PROGRESS', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    assert.equal(create.status, 201);
    const confirm = await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 409);
    assert.match(confirm.data.error, /开工|已开工|IN_PROGRESS/);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 0);
  });

  test('18. multiple confirmed material issues against the same production order are independent', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 2 }] } });
    const second = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 3 }] } });
    await request(`/api/production-material-issues/${first.data.id}/confirm`, { method: 'POST' });
    await request(`/api/production-material-issues/${second.data.id}/confirm`, { method: 'POST' });
    const p2 = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-002').quantity;
    assert.equal(Number(p2), 45);
  });

  test('19. listing material issues returns warehouse, items, creator and confirm actor', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    await request(`/api/production-material-issues/${create.data.id}/confirm`, { method: 'POST' });
    const list = await request('/api/production-material-issues');
    assert.equal(list.status, 200);
    const found = list.data.materialIssues.find((mi) => mi.id === create.data.id);
    assert.ok(found);
    assert.equal(found.status, 'CONFIRMED');
    assert.equal(found.confirmedByName, '系统管理员');
    assert.equal(found.itemCount, 1);
  });
});

// =====================================================================
// 4. Production Receipt — core contract
// =====================================================================

describe('M6 production receipt contract', () => {
  test('20. creating DRAFT receipt issues no inventory transaction', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    assert.equal(create.status, 201, create.data.error);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_RECEIPT' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 0);
  });

  test('21. receipt_no is unique across receipts', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 1 } });
    const second = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 1 } });
    assert.notEqual(first.data.receiptNo, second.data.receiptNo);
  });

  test('22. finished product is derived from production order, not from frontend', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    const detail = await request(`/api/production-receipts/${create.data.id}`);
    assert.equal(detail.data.productionReceipt.productCode, 'P001');
    assert.equal(detail.data.productionReceipt.productName, '高端笔记本电脑');
  });

  test('23. zero / negative quantity rejected with 400', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const zero = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 0 } });
    assert.equal(zero.status, 400);
    const negative = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: -1 } });
    assert.equal(negative.status, 400);
  });

  test('24. successful confirmation produces one IN transaction with balance_after', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 3 } });
    const confirm = await request(`/api/production-receipts/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 200, confirm.data.error);
    const tx = database.prepare("SELECT product_id, direction, quantity_change, balance_after, source_type, source_no FROM inventory_transactions WHERE source_type='PRODUCTION_RECEIPT' AND source_id=?").all(create.data.id);
    assert.equal(tx.length, 1);
    assert.equal(tx[0].product_id, 'product-001');
    assert.equal(tx[0].direction, 'IN');
    assert.equal(Number(tx[0].quantity_change), 3);
    assert.equal(Number(tx[0].balance_after), 3);
    assert.equal(tx[0].source_type, 'PRODUCTION_RECEIPT');
    assert.ok(tx[0].source_no.length > 0);
  });

  test('25. partial receipt — multiple confirmed receipts accumulate toward planned quantity', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(10, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 4 } });
    const second = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 6 } });
    await request(`/api/production-receipts/${first.data.id}/confirm`, { method: 'POST' });
    await request(`/api/production-receipts/${second.data.id}/confirm`, { method: 'POST' });
    const cumulative = database.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipts WHERE production_order_id=? AND status='CONFIRMED'").get(orderId).total;
    assert.equal(Number(cumulative), 10);
    const finished = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-001').quantity;
    assert.equal(Number(finished), 10);
  });

  test('26. overproduction beyond planned quantity is rejected', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(10, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 9 } });
    await request(`/api/production-receipts/${first.data.id}/confirm`, { method: 'POST' });
    const second = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    const confirm = await request(`/api/production-receipts/${second.data.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 409, confirm.data.error);
    assert.match(confirm.data.error, /超过|超出/);
    const receipt = database.prepare('SELECT status FROM production_receipts WHERE id=?').get(second.data.id);
    assert.equal(receipt.status, 'DRAFT');
    const finished = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, 'product-001').quantity;
    assert.equal(Number(finished), 9);
  });

  test('27. repeated confirm on a CONFIRMED receipt is blocked', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    await request(`/api/production-receipts/${create.data.id}/confirm`, { method: 'POST' });
    const again = await request(`/api/production-receipts/${create.data.id}/confirm`, { method: 'POST' });
    assert.equal(again.status, 409);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_RECEIPT' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 1);
  });

  test('28. cancelling a DRAFT receipt produces no stock effect', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 3 } });
    const cancel = await request(`/api/production-receipts/${create.data.id}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);
    const txCount = database.prepare("SELECT COUNT(*) cnt FROM inventory_transactions WHERE source_type='PRODUCTION_RECEIPT' AND source_id=?").get(create.data.id).cnt;
    assert.equal(txCount, 0);
  });

  test('29. cancelling a CONFIRMED receipt is rejected', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const create = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    await request(`/api/production-receipts/${create.data.id}/confirm`, { method: 'POST' });
    const cancel = await request(`/api/production-receipts/${create.data.id}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 409);
  });

  test('30. receipt detail exposes cumulative received excluding self', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(10, bomId);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const first = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 3 } });
    await request(`/api/production-receipts/${first.data.id}/confirm`, { method: 'POST' });
    const draft = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 4 } });
    const detail = await request(`/api/production-receipts/${draft.data.id}`);
    assert.equal(Number(detail.data.productionReceipt.cumulativeReceived), 3, 'cumulative excludes the draft itself');
  });
});

// =====================================================================
// 5. M6 voucher exclusion — no automatic WIP / manufacturing accounting
// =====================================================================

describe('M6 manufacturing actions do not generate accounting vouchers', () => {
  test('31. production order START / COMPLETE / Material Issue / Production Receipt create no vouchers', async () => {
    const { bomId, warehouseId } = seedBomAndOrder();
    const { orderId } = seedProductionOrder(5, bomId);
    const startCount = database.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE source_type IN ('PRODUCTION_ORDER','MATERIAL_ISSUE','PRODUCTION_RECEIPT') AND source_id=?").get(orderId).cnt;
    assert.equal(startCount, 0);
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } });
    const issue = await request('/api/production-material-issues', { method: 'POST', body: { productionOrderId: orderId, warehouseId, items: [{ productId: 'product-002', issueQuantity: 1 }] } });
    await request(`/api/production-material-issues/${issue.data.id}/confirm`, { method: 'POST' });
    const receipt = await request('/api/production-receipts', { method: 'POST', body: { productionOrderId: orderId, warehouseId, quantity: 2 } });
    await request(`/api/production-receipts/${receipt.data.id}/confirm`, { method: 'POST' });
    await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } });
    const total = database.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE source_type IN ('PRODUCTION_ORDER','MATERIAL_ISSUE','PRODUCTION_RECEIPT','PRODUCTION_OUTPUT')").get().cnt;
    assert.equal(total, 0, 'no manufacturing voucher must be generated across START/Issue/Receipt/COMPLETE');
  });
});

// =====================================================================
// 6. M6 Security — five-role contract + unauthenticated gating
// =====================================================================

describe('M6 security contract', () => {
  test('32. unauthenticated request to issue endpoints returns 401', async () => {
    const result = await request('/api/production-material-issues', { token: null });
    assert.equal(result.status, 401);
  });

  test('33. unauthenticated request to receipt endpoints returns 401', async () => {
    const result = await request('/api/production-receipts', { token: null });
    assert.equal(result.status, 401);
  });

  test('34. sales / reviewer / warehouse / accounting cannot list material issues', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const list = await request('/api/production-material-issues', { token });
      assert.equal(list.status, 403, `${username} must be forbidden from material issue list`);
    }
  });

  test('35. sales / reviewer / warehouse / accounting cannot create material issues', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const create = await request('/api/production-material-issues', { token, method: 'POST', body: { productionOrderId: 'x', warehouseId: 'warehouse-001', items: [{ productId: 'product-002', issueQuantity: 1 }] } });
      assert.equal(create.status, 403, `${username} must be forbidden from material issue create`);
    }
  });

  test('36. sales / reviewer / warehouse / accounting cannot list production receipts', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const list = await request('/api/production-receipts', { token });
      assert.equal(list.status, 403, `${username} must be forbidden from receipt list`);
    }
  });

  test('37. sales / reviewer / warehouse / accounting cannot create production receipts', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const create = await request('/api/production-receipts', { token, method: 'POST', body: { productionOrderId: 'x', warehouseId: 'warehouse-001', quantity: 1 } });
      assert.equal(create.status, 403, `${username} must be forbidden from receipt create`);
    }
  });

  test('38. permission reconciliation is idempotent across re-run', () => {
    database.exec("DELETE FROM role_permissions WHERE role_id='role-admin'");
    createDatabase(join(tempDir, 'erp.db')).close();
    const after = createDatabase(join(tempDir, 'erp.db'));
    after.close();
    database = createDatabase(join(tempDir, 'erp.db'));
    const rowCount = database.prepare("SELECT COUNT(*) cnt FROM role_permissions WHERE role_id='role-admin' AND permission_code='PRODUCTION_MATERIAL_ISSUE_MANAGE'").get().cnt;
    assert.equal(rowCount, 1, 'role-admin must receive the new permission exactly once after second startup');
  });
});

// =====================================================================
// 7. M6 Mobile UI surface — supported / deferred cards
// =====================================================================

describe('M6 mobile UI surface', () => {
  test('39. mobile manufacturing group exposes 制令单 / 用料出库 / 生产入库', () => {
    const meta = readFileSync(new URL('../src/navigation/applicationMetadata.js', import.meta.url), 'utf8');
    assert.match(meta, /'material-issues', mobileLabel: '用料出库'/);
    assert.match(meta, /'production-receipts', mobileLabel: '生产入库'/);
    assert.match(meta, /mobileLabel: '制令单'/);
  });

  test('40. mobile production cards are real — Production Order / Material Issue / Production Receipt route registration in App.jsx', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.match(app, /'material-issues': <MaterialIssues/);
    assert.match(app, /'production-receipts': <ProductionReceipts/);
    assert.match(app, /'material-issues', label: '用料出库'/);
    assert.match(app, /'production-receipts', label: '生产入库'/);
  });

  test('41. fake / deferred production cards (instruction / work center / output) are absent from mobile group', () => {
    const meta = readFileSync(new URL('../src/navigation/applicationMetadata.js', import.meta.url), 'utf8');
    const activeGroups = meta.slice(0, meta.indexOf('DEFERRED_MOBILE_APPLICATIONS'));
    assert.match(activeGroups, /mobileLabel: '计划预测'/);
    assert.match(activeGroups, /mobileLabel: 'MRP 物料需求计划'/);
    assert.doesNotMatch(activeGroups, /生产指令下达|production-instruction/);
    assert.doesNotMatch(activeGroups, /工作中心|work-center/);
    assert.doesNotMatch(activeGroups, /生产产出|production-output/);
  });

  test('42. mobile Material Issue / Production Receipt / Production Order are not in approval center', () => {
    const approvals = readFileSync(new URL('../src/components/MobileApprovalCenter.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(approvals, /material-issues|production-receipts|Material Issue|Production Receipt|用料出库|生产入库/);
    assert.doesNotMatch(approvals, /production-orders|productionOrderState|production-order-state/);
  });

  test('43. DEFERRED_MOBILE_APPLICATIONS no longer lists 用料出库 / 生产入库', () => {
    const meta = readFileSync(new URL('../src/navigation/applicationMetadata.js', import.meta.url), 'utf8');
    const block = meta.slice(meta.indexOf('DEFERRED_MOBILE_APPLICATIONS'));
    assert.doesNotMatch(block, /用料出库/);
    assert.doesNotMatch(block, /生产入库/);
  });

  test('44. inventory movement source list includes new PRODUCTION source types via production-workflow module', () => {
    const moduleSource = readFileSync(new URL('../server/modules/production-workflow.js', import.meta.url), 'utf8');
    assert.match(moduleSource, /PRODUCTION_MATERIAL_ISSUE/);
    assert.match(moduleSource, /PRODUCTION_RECEIPT/);
    const logisticsSource = readFileSync(new URL('../src/pages/logistics-finance.jsx', import.meta.url), 'utf8');
    assert.match(logisticsSource, /PRODUCTION_MATERIAL_ISSUE:.*用料出库/);
    assert.match(logisticsSource, /PRODUCTION_RECEIPT:.*生产入库/);
  });
});

// =====================================================================
// 8. Legacy DB safety — idempotent migration preserves BOM / PO / inventory
// =====================================================================

describe('M6 legacy DB safety', () => {
  test('45. opening a pre-M6 DB creates the new tables idempotently without duplicating existing rows', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'modern-erp-m6-legacy-'));
    const dbPath = join(legacyDir, 'erp.db');
    try {
      // Step 1: create fresh DB with all pre-M6 tables, seed one production order
      const legacy = createDatabase(dbPath);
      legacy.prepare("INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,remark,creator_id,created_at,updated_at) VALUES('legacy-po-1','MO-LEG-1','product-001',NULL,1,'PENDING','','user-admin',datetime('now'),datetime('now'))").run();
      legacy.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('legacy-inv-1','warehouse-002','product-005',5,datetime('now'))").run();
      legacy.close();

      // Step 2: re-open — M6 migration should create new tables; legacy rows preserved
      const reopened = createDatabase(dbPath);
      const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('production_material_issues','production_material_issue_items','production_receipts')").all().map((row) => row.name);
      assert.deepEqual(tables.sort(), ['production_material_issue_items', 'production_material_issues', 'production_receipts']);
      const po = reopened.prepare("SELECT order_no FROM production_orders WHERE id='legacy-po-1'").get();
      assert.equal(po.order_no, 'MO-LEG-1');
      const inv = reopened.prepare("SELECT quantity FROM inventory WHERE id='legacy-inv-1'").get();
      assert.equal(Number(inv.quantity), 5);

      // Step 3: third open — idempotent; no duplicate tables
      const third = createDatabase(dbPath);
      const tableCount = third.prepare("SELECT COUNT(*) cnt FROM sqlite_master WHERE type='table' AND name IN ('production_material_issues','production_material_issue_items','production_receipts')").get().cnt;
      assert.equal(tableCount, 3);
      // Best-effort cleanup (Windows file handles may keep WAL files locked briefly).
      try { third.close(); } catch {}
      try { reopened.close(); } catch {}
    } catch (e) {
      // Cleanup is best-effort; Windows EPERM on tmp dir cleanup is a known issue
      // and does not affect the test assertions.
      if (!String(e.message).includes('EPERM')) throw e;
    }
  });
});
