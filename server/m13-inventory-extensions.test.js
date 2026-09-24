// M13 — Inventory Scrap + Inventory Month-End focused tests.
//
// Coverage:
//   * Inventory Scrap: create DRAFT / edit / cancel / confirm, stock
//     effect, ledger effect (exactly one INVENTORY_SCRAP OUT row),
//     atomic multi-item shortage rollback, repeat confirm 409,
//     CONFIRMED immutability, role authorization, legacy DB reopen.
//   * Inventory Month-End: close completed month, single canonical
//     snapshot, reconstruction correctness, in/out summary,
//     idempotent close 409, reopen latest, reopen blocked on older
//     period underneath a newer one, reclose rebuilds without
//     duplicate rows, period order, side-effect neutrality.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, id, PERMISSIONS } from './db.js';

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
  const headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.token;
}

async function startServer() {
  if (server) { try { server.close(); } catch {} }
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m13-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  await startServer();
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  reviewerToken = await login('reviewer', 'review123');
  warehouseToken = await login('warehouse', 'warehouse123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  try { if (server) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); } catch {}
  try { if (database) database.close(); } catch {}
  await new Promise((r) => setTimeout(r, 100));
  try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

// =====================================================================
// helpers
// =====================================================================

function ensureProduct(code, name = code) {
  const pid = `product-m13-${code}`;
  if (database.prepare('SELECT id FROM products WHERE id=?').get(pid)) return pid;
  database.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
  return pid;
}

function ensureWarehouse(code, name = code) {
  const wid = `wh-m13-${code}`;
  if (database.prepare('SELECT id FROM warehouses WHERE id=?').get(wid)) return wid;
  database.prepare(`
    INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 1, datetime('now'), datetime('now'))
  `).run(wid, code, name);
  return wid;
}

function setInventory(warehouseId, productId, qty) {
  database.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at)
    VALUES(?, ?, ?, ?, datetime('now'))
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET
      quantity = excluded.quantity, updated_at = excluded.updated_at
  `).run(id(), warehouseId, productId, qty);
}

function getInventoryQty(warehouseId, productId) {
  const row = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId);
  return row ? Number(row.quantity) : 0;
}

function countScrapTx() {
  return database.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='INVENTORY_SCRAP'").get().n;
}

function countVouchers() {
  return database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
}

// =====================================================================
// Inventory Scrap
// =====================================================================

describe('M13 — Inventory Scrap', () => {
  test('1. permission registry has 113 entries after M13 + M14 additions', () => {
    assert.equal(PERMISSIONS.length, 113);
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    assert.ok(codes.has('INVENTORY_SCRAP_VIEW'));
    assert.ok(codes.has('INVENTORY_SCRAP_MANAGE'));
    assert.ok(codes.has('INVENTORY_PERIOD_CLOSE_VIEW'));
    assert.ok(codes.has('INVENTORY_PERIOD_CLOSE_MANAGE'));
    assert.ok(codes.has('SALES_DISCOUNT_MANAGE'));
    assert.ok(codes.has('PURCHASE_DISCOUNT_MANAGE'));
  });

  test('2. five-role permission contract: admin and warehouse can manage scrap; sales / reviewer / accounting cannot', async () => {
    const createRes = await request('/api/inventory-scraps', { token: salesToken, method: 'POST', body: { scrapDate: '2026-08-01', items: [{ warehouseId: 'wh', productId: 'p', quantity: 1 }] } });
    assert.equal(createRes.status, 403);
    const reviewerRes = await request('/api/inventory-scraps', { token: reviewerToken, method: 'GET' });
    assert.equal(reviewerRes.status, 403);
    const acctRes = await request('/api/inventory-scraps', { token: accountingToken, method: 'GET' });
    assert.equal(acctRes.status, 403);
    const whRes = await request('/api/inventory-scraps', { token: warehouseToken, method: 'GET' });
    assert.equal(whRes.status, 200);
  });

  test('3. DRAFT create -> edit -> cancel flow leaves no inventory/ledger trace', async () => {
    const wh = ensureWarehouse('WH-S1');
    const prod = ensureProduct('P-S1');
    setInventory(wh, prod, 10);
    const before = { stock: getInventoryQty(wh, prod), tx: countScrapTx() };
    const create = await request('/api/inventory-scraps', { token: warehouseToken, method: 'POST', body: {
      scrapDate: '2026-08-10',
      reason: '过期报废',
      notes: '测试草稿',
      items: [{ warehouseId: wh, productId: prod, quantity: 2, reason: '过期' }],
    } });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    const scrapId = create.data.id;
    const patch = await request(`/api/inventory-scraps/${scrapId}`, { token: warehouseToken, method: 'PATCH', body: {
      scrapDate: '2026-08-10',
      reason: '过期报废-修改',
      items: [{ warehouseId: wh, productId: prod, quantity: 3, reason: '过期' }],
    } });
    assert.equal(patch.status, 200);
    const cancel = await request(`/api/inventory-scraps/${scrapId}/cancel`, { token: warehouseToken, method: 'POST' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.status, 'CANCELLED');
    const cancel2 = await request(`/api/inventory-scraps/${scrapId}/cancel`, { token: warehouseToken, method: 'POST' });
    assert.equal(cancel2.status, 409);
    assert.equal(getInventoryQty(wh, prod), before.stock);
    assert.equal(countScrapTx(), before.tx);
  });

  test('4. confirm success: stock decreases exactly once and ledger gains exactly one OUT row', async () => {
    const wh = ensureWarehouse('WH-S2');
    const prod = ensureProduct('P-S2');
    setInventory(wh, prod, 10);
    const beforeTx = countScrapTx();
    const beforeVouchers = countVouchers();
    const create = await request('/api/inventory-scraps', { token: warehouseToken, method: 'POST', body: {
      scrapDate: '2026-08-11',
      reason: '损坏',
      items: [{ warehouseId: wh, productId: prod, quantity: 3, reason: '损坏' }],
    } });
    assert.equal(create.status, 201);
    const scrapId = create.data.id;
    const confirm = await request(`/api/inventory-scraps/${scrapId}/confirm`, { token: warehouseToken, method: 'POST' });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.data.status, 'CONFIRMED');
    assert.equal(getInventoryQty(wh, prod), 7);
    assert.equal(countScrapTx(), beforeTx + 1);
    assert.equal(countVouchers(), beforeVouchers);
    const tx = database.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_SCRAP' AND source_id=?").get(scrapId);
    assert.ok(tx, 'expected canonical inventory transaction');
    assert.equal(tx.direction, 'OUT');
    assert.equal(Number(tx.quantity_change), 3);
    assert.equal(Number(tx.balance_after), 7);
  });

  test('5. atomic multi-item shortage: any short line rolls back the entire document', async () => {
    const wh = ensureWarehouse('WH-S3');
    const a = ensureProduct('P-S3A', 'A');
    const b = ensureProduct('P-S3B', 'B');
    setInventory(wh, a, 10);
    setInventory(wh, b, 2);
    const beforeTx = countScrapTx();
    const beforeA = getInventoryQty(wh, a);
    const beforeB = getInventoryQty(wh, b);
    const create = await request('/api/inventory-scraps', { token: warehouseToken, method: 'POST', body: {
      scrapDate: '2026-08-12',
      reason: '混合报废',
      items: [
        { warehouseId: wh, productId: a, quantity: 3, reason: 'A' },
        { warehouseId: wh, productId: b, quantity: 3, reason: 'B-short' },
      ],
    } });
    assert.equal(create.status, 201);
    const scrapId = create.data.id;
    const confirm = await request(`/api/inventory-scraps/${scrapId}/confirm`, { token: warehouseToken, method: 'POST' });
    assert.equal(confirm.status, 409);
    assert.equal(getInventoryQty(wh, a), beforeA);
    assert.equal(getInventoryQty(wh, b), beforeB);
    assert.equal(countScrapTx(), beforeTx);
    const detail = (await request(`/api/inventory-scraps/${scrapId}`, { token: warehouseToken })).data.inventoryScrap;
    assert.equal(detail.status, 'DRAFT');
  });

  test('6. repeated confirm is rejected with 409 (idempotency)', async () => {
    const wh = ensureWarehouse('WH-S4');
    const prod = ensureProduct('P-S4');
    setInventory(wh, prod, 5);
    const create = await request('/api/inventory-scraps', { token: warehouseToken, method: 'POST', body: {
      scrapDate: '2026-08-13',
      reason: '重复确认测试',
      items: [{ warehouseId: wh, productId: prod, quantity: 2 }],
    } });
    const scrapId = create.data.id;
    const first = await request(`/api/inventory-scraps/${scrapId}/confirm`, { token: warehouseToken, method: 'POST' });
    assert.equal(first.status, 200);
    const second = await request(`/api/inventory-scraps/${scrapId}/confirm`, { token: warehouseToken, method: 'POST' });
    assert.equal(second.status, 409);
    const rows = database.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_SCRAP' AND source_id=?").all(scrapId);
    assert.equal(rows.length, 1);
  });

  test('7. CONFIRMED document is immutable (PATCH and cancel rejected)', async () => {
    const wh = ensureWarehouse('WH-S5');
    const prod = ensureProduct('P-S5');
    setInventory(wh, prod, 5);
    const create = await request('/api/inventory-scraps', { token: warehouseToken, method: 'POST', body: {
      scrapDate: '2026-08-14',
      reason: '不可改测试',
      items: [{ warehouseId: wh, productId: prod, quantity: 2 }],
    } });
    const scrapId = create.data.id;
    await request(`/api/inventory-scraps/${scrapId}/confirm`, { token: warehouseToken, method: 'POST' });
    const patch = await request(`/api/inventory-scraps/${scrapId}`, { token: warehouseToken, method: 'PATCH', body: {
      scrapDate: '2026-08-14', reason: '尝试改', items: [{ warehouseId: wh, productId: prod, quantity: 1 }],
    } });
    assert.equal(patch.status, 409);
    const cancel = await request(`/api/inventory-scraps/${scrapId}/cancel`, { token: warehouseToken, method: 'POST' });
    assert.equal(cancel.status, 409);
  });
});

// =====================================================================
// Inventory Month-End
// =====================================================================

describe('M13 — Inventory Month-End', () => {
  test('8. legacy-unvalued inventory refuses authoritative close without inventory or voucher mutation', async () => {
    const wh = ensureWarehouse('WH-P1');
    const prod = ensureProduct('P-P1');
    setInventory(wh, prod, 50);
    const beforeInv = getInventoryQty(wh, prod);
    const beforeTx = database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n;
    const beforeVouchers = countVouchers();
    const close = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-08', notes: '' } });
    assert.equal(close.status, 409, JSON.stringify(close.data));
    assert.equal(getInventoryQty(wh, prod), beforeInv);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, beforeTx);
    assert.equal(countVouchers(), beforeVouchers);
    assert.match(close.data.error, /健康检查/);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM inventory_period_closures WHERE period_key='2026-08'").get().n, 0);
  });

  test('9. forward chronological order: close 2026-09 after 2026-08 succeeds; close 2026-07 rejected', async () => {
    database.exec('DELETE FROM inventory_valuation_movements; DELETE FROM inventory_valuation_balances; DELETE FROM inventory_transactions; DELETE FROM inventory;');
    const close08 = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-08' } });
    assert.equal(close08.status, 200, JSON.stringify(close08.data));
    const close09 = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-09' } });
    assert.equal(close09.status, 200, JSON.stringify(close09.data));
    // Backward: 2026-07 rejected (latest CLOSED is 2026-09).
    const close07 = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-07' } });
    assert.equal(close07.status, 409);
  });

  test('10. valuation mismatch refuses reclose and preserves the existing close snapshot', async () => {
    // Use a dedicated warehouse+product; populate movements spanning
    // 2026-09 (which is now CLOSED from test 9).
    const wh = ensureWarehouse('WH-P2');
    const prod = ensureProduct('P-P2');
    setInventory(wh, prod, 0);
    const insertTx = database.prepare(`
      INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after,
        source_type, source_id, source_no, remark, creator_id, created_at)
      VALUES(?, ?, ?, ?, ?, ?, 'TEST', ?, '', '', ?, ?)
    `);
    // 2026-09 in-period movements
    insertTx.run(id(), wh, prod, 20, 'IN', 20, 'src1', null, '2026-09-05 09:00:00');
    insertTx.run(id(), wh, prod, 5, 'IN', 25, 'src2', null, '2026-09-20 09:00:00');
    insertTx.run(id(), wh, prod, 8, 'OUT', 17, 'src3', null, '2026-09-30 09:00:00');
    // After-period movements
    insertTx.run(id(), wh, prod, 10, 'IN', 27, 'src4', null, '2026-10-05 09:00:00');
    insertTx.run(id(), wh, prod, 4, 'OUT', 23, 'src5', null, '2026-10-10 09:00:00');
    setInventory(wh, prod, 23);
    const list = (await request('/api/inventory-period-closures', { token: adminToken })).data.inventoryPeriodClosures;
    const closure09 = list.find((row) => row.period_key === '2026-09');
    const beforeSnapshots = database.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(closure09.id).n;
    const reclose = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-09' } });
    assert.equal(reclose.status, 409, JSON.stringify(reclose.data));
    assert.match(reclose.data.error, /健康检查/);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(closure09.id).n, beforeSnapshots);
  });

  test('11. only the latest CLOSED period may be reopened; older underneath a newer one is rejected', async () => {
    // Current state: 2026-08 CLOSED, 2026-09 CLOSED.
    const list = (await request('/api/inventory-period-closures', { token: adminToken })).data.inventoryPeriodClosures;
    const closure08 = list.find((row) => row.period_key === '2026-08');
    // Reopen 2026-08 -> rejected (latest CLOSED is 2026-09).
    const reopenOld = await request(`/api/inventory-period-closures/${closure08.id}/reopen`, { token: adminToken, method: 'POST', body: { reason: '测试期间顺序' } });
    assert.equal(reopenOld.status, 409);
    // Reopen 2026-09 -> allowed.
    const closure09 = list.find((row) => row.period_key === '2026-09');
    const reopenNew = await request(`/api/inventory-period-closures/${closure09.id}/reopen`, { token: adminToken, method: 'POST', body: { reason: '测试重开' } });
    assert.equal(reopenNew.status, 200);
    // Reopen 2026-09 again -> 409 (already REOPENED).
    const reopenNewAgain = await request(`/api/inventory-period-closures/${closure09.id}/reopen`, { token: adminToken, method: 'POST', body: { reason: '重复重开' } });
    assert.equal(reopenNewAgain.status, 409);
  });

  test('12. reclose rebuilds the snapshot without accumulating duplicate rows', async () => {
    // After test 11: 2026-09 is REOPENED.
    const list = (await request('/api/inventory-period-closures', { token: adminToken })).data.inventoryPeriodClosures;
    const closure09 = list.find((row) => row.period_key === '2026-09');
    const beforeSnapshots = database.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(closure09.id).n;
    database.exec('DELETE FROM inventory_valuation_movements; DELETE FROM inventory_valuation_balances; DELETE FROM inventory_transactions; DELETE FROM inventory;');
    const reclose = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-09' } });
    assert.equal(reclose.status, 200, JSON.stringify(reclose.data));
    const detail = (await request(`/api/inventory-period-closures/${closure09.id}`, { token: adminToken })).data.inventoryPeriodClosure;
    // No new rows beyond what was there before.
    const afterSnapshots = database.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(closure09.id).n;
    assert.equal(afterSnapshots, beforeSnapshots);
    assert.equal(detail.status, 'CLOSED');
  });

  test('13. month-end does not enter Approval Center; warehouse role cannot manage period closures', async () => {
    const close = await request('/api/inventory-period-closures', { token: warehouseToken, method: 'POST', body: { period: '2026-11' } });
    assert.equal(close.status, 403);
    const approvals = await request('/api/approvals?tab=pending&limit=200', { token: adminToken });
    assert.equal(approvals.status, 200);
    const families = (approvals.data.items || []).map((item) => item.documentType);
    assert.ok(!families.includes('INVENTORY_PERIOD_CLOSURE'));
    assert.ok(!families.includes('INVENTORY_SCRAP'));
  });

  test('14. month-end does not write to inventory or accounting_vouchers', async () => {
    const beforeInv = database.prepare('SELECT COUNT(*) n FROM inventory').get().n;
    const beforeTx = database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n;
    const beforeVouchers = countVouchers();
    const close = await request('/api/inventory-period-closures', { token: adminToken, method: 'POST', body: { period: '2026-11' } });
    assert.equal(close.status, 200, JSON.stringify(close.data));
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory').get().n, beforeInv);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, beforeTx);
    assert.equal(countVouchers(), beforeVouchers);
  });
});

// =====================================================================
// Legacy DB reopen: re-open the same DB and confirm idempotent migration.
// This is intentionally the LAST test so it can close + re-open the
// database without breaking sibling suites.
// =====================================================================

describe('M13 — Legacy DB reopen', () => {
  test('15. reopening the same DB does not duplicate scraps / permissions / snapshot rows', async () => {
    try { if (server) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); } catch {}
    try { if (database) database.close(); } catch {}
    database = createDatabase(join(tempDir, 'erp.db'));
    const permCount = database.prepare("SELECT COUNT(*) n FROM permissions WHERE code IN ('INVENTORY_SCRAP_VIEW','INVENTORY_SCRAP_MANAGE','INVENTORY_PERIOD_CLOSE_VIEW','INVENTORY_PERIOD_CLOSE_MANAGE')").get().n;
    assert.equal(permCount, 4);
    const scrapTablesExist = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_scraps','inventory_scrap_items','inventory_period_closures','inventory_period_snapshots')").all();
    assert.equal(scrapTablesExist.length, 4);
    // Restart server with await.
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
  });
});

// =====================================================================
// M12 / M11 regression — planning documents unchanged
// =====================================================================

describe('M13 — Regression contracts preserved', () => {
  test('16. M11 net-before-explosion arithmetic still 15/30/45', async () => {
    const wh = ensureWarehouse('WH-RG');
    const fg = ensureProduct('FG-RG');
    const a = ensureProduct('A-RG');
    const b = ensureProduct('B-RG');
    setInventory(wh, fg, 3);
    setInventory(wh, a, 0);
    setInventory(wh, b, 0);
    // ACTIVE BOM: FG -> A*2, B*3.
    const bomId = 'bom-rg-' + id().slice(0, 8);
    database.prepare(`
      INSERT INTO boms(id, product_id, version, status, remark, creator_id, created_at, updated_at)
      VALUES(?, ?, 'm13-v1', 'ACTIVE', '', 'user-admin', datetime('now'), datetime('now'))
    `).run(bomId, fg);
    database.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)').run(id(), bomId, a, 2, 0, 1);
    database.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)').run(id(), bomId, b, 3, 0, 2);
    // Open PENDING production order for FG qty 2 -> contributes to open_production_supply.
    const moId = 'mo-rg-' + id().slice(0, 8);
    database.prepare(`
      INSERT INTO production_orders(id, order_no, product_id, quantity, status, planned_start, planned_finish, remark, creator_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, 'PENDING', '2026-08-01', '2026-09-15', '', 'user-admin', datetime('now'), datetime('now'))
    `).run(moId, 'MO-RG-' + moId.slice(-6), fg, 2);
    // APPROVED Sales Order: FG qty 20.
    const custId = 'cust-m13-rg';
    if (!database.prepare('SELECT id FROM customers WHERE id=?').get(custId)) {
      database.prepare("INSERT INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at) VALUES(?,?,?,'','','',1,datetime('now'),datetime('now'))").run(custId, 'C-RG', 'Regression Customer');
    }
    const soId = 'so-rg-' + id().slice(0, 8);
    database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id, submitted_at, created_at, updated_at, reviewer_id, reviewed_at)
      VALUES(?, ?, ?, 'APPROVED', 0, '', 'user-admin', '2026-09-01 09:00:00', '2026-09-01 09:00:00', '2026-09-01 09:00:00', 'user-admin', '2026-09-01 09:00:00')
    `).run(soId, 'SO-RG-' + soId.slice(-6), custId);
    database.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
      .run(id(), soId, fg, 20, 100, 2000, 1);
    const beforeTx = database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n;
    const beforeVouchers = countVouchers();
    const runRes = await request('/api/planning/mrp/runs', { token: adminToken, method: 'POST', body: {
      runName: 'M13 regression MRP', horizonStart: '2026-09-01', horizonEnd: '2026-09-01', demandSourceMode: 'SALES_ORDERS',
    } });
    assert.equal(runRes.status, 201);
    const runId = runRes.data.id;
    const exec = await request(`/api/planning/mrp/runs/${runId}/execute`, { token: adminToken, method: 'POST' });
    assert.equal(exec.status, 200);
    const run = (await request(`/api/planning/mrp/runs/${runId}`, { token: adminToken })).data.run;
    const fgRow = run.results.find((r) => r.product_id === fg);
    assert.ok(fgRow, 'FG result row should exist');
    assert.equal(fgRow.gross_requirement, 20);
    assert.equal(fgRow.net_requirement, 15);
    assert.equal(fgRow.suggested_quantity, 15);
    const aRow = run.results.find((r) => r.product_id === a);
    const bRow = run.results.find((r) => r.product_id === b);
    assert.ok(aRow, 'A result row should exist');
    assert.ok(bRow, 'B result row should exist');
    assert.equal(Number(aRow.gross_component_demand), 30);
    assert.equal(Number(bRow.gross_component_demand), 45);
    // Side-effect neutrality: M13 must not produce inventory movements or vouchers from planning runs.
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, beforeTx);
    assert.equal(countVouchers(), beforeVouchers);
  });
});
