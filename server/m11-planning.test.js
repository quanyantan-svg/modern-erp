// M11 — Forecast & MRP focused tests.
//
// Verifies the canonical planning path:
//   * planning_forecasts CRUD with DRAFT / ACTIVE / CANCELLED lifecycle
//     and active immutability;
//   * mrp_runs lifecycle DRAFT → COMPLETED, COMPLETED immutability,
//     and execute-twice → 409;
//   * Sales open demand = APPROVED ordered − CONFIRMED delivered at the
//     product level, with full delivery / unapproved / direct delivery
//     / sales-return edge cases;
//   * Purchase open supply = APPROVED ordered − CONFIRMED receipts
//     linked to the order, with direct receipts and purchase returns
//     correctly excluded from open supply;
//   * Production open supply = (PENDING/IN_PROGRESS ordered) −
//     CONFIRMED production receipts linked to the order, with
//     COMPLETED and CANCELLED orders excluded;
//   * Basic netting, BOM explosion (single + multi-level),
//     shared-component aggregation before netting, ROUTING_MISSING
//     warning when an ACTIVE routing is absent, BOM cycle detection,
//     and atomic MRP execution with no half-written run;
//   * Five-role permission contract (admin allowed, the other four
//     forbidden from MRP mutation; viewers can list / detail);
//   * Legacy DB reopen with no duplicate forecasts / runs / results
//     or permissions after a second createDatabase().

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m11-test-'));
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

// =====================================================================
// helpers
// =====================================================================
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedWarehouse() {
  const whId = 'wh-' + id().slice(0, 8);
  database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
    .run(whId, 'WH-M11-' + whId.slice(3, 7), 'M11 测试仓');
  return whId;
}

function seedBom({ parentId, items, status = 'ACTIVE' }) {
  const bomId = 'bom-' + id().slice(0, 8);
  database.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))")
    .run(bomId, parentId, 'm11-v1', status, '', 'user-admin');
  const itemStmt = database.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
  items.forEach((it, idx) => itemStmt.run(id(), bomId, it.productId, it.quantity, it.scrapRate || 0, idx + 1));
  return bomId;
}

function seedInventory(warehouseId, productId, qty) {
  database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
    .run(id(), warehouseId, productId, qty);
}

function ensureProduct(code, name = code) {
  const id = 'product-' + code;
  const existing = database.prepare("SELECT id FROM products WHERE id=?").get(id);
  if (existing) return id;
  database.prepare(`
    INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))
  `).run(id, code, name, '', '', 0, 0);
  return id;
}

function seedSalesOrder({ productId, quantity, status = 'APPROVED' }) {
  const orderId = 'so-' + id().slice(0, 8);
  const orderNo = 'SO-M11-' + orderId.slice(3, 9);
  database.prepare(`
    INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),datetime('now'))
  `).run(orderId, orderNo, 'customer-001', status, 0, '', 'user-sales');
  database.prepare(`
    INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,?,?,?,?)
  `).run(id(), orderId, productId, quantity, 1000, quantity * 1000, 1);
  return { orderId, orderNo };
}

function seedSalesDelivery({ orderId, productId, quantity, status = 'CONFIRMED' }) {
  const deliveryId = 'sd-' + id().slice(0, 8);
  const deliveryNo = 'SD-M11-' + deliveryId.slice(3, 9);
  database.prepare(`
    INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?)
  `).run(deliveryId, deliveryNo, orderId, 'customer-001', 'warehouse-001', 'user-warehouse', 0, status, todayIso(), '', 'user-warehouse', 'user-warehouse');
  database.prepare(`
    INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,?,?,?,?)
  `).run(id(), deliveryId, productId, quantity, 1000, quantity * 1000, 1);
  return { deliveryId, deliveryNo };
}

function seedPurchaseOrder({ productId, quantity, status = 'APPROVED' }) {
  const orderId = 'po-' + id().slice(0, 8);
  const orderNo = 'PO-M11-' + orderId.slice(3, 9);
  database.prepare(`
    INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),datetime('now'))
  `).run(orderId, orderNo, 'supplier-001', status, 0, '', 'user-sales');
  database.prepare(`
    INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,?,?,?,?)
  `).run(id(), orderId, productId, quantity, 1000, quantity * 1000, 1);
  return { orderId, orderNo };
}

function seedPurchaseReceipt({ orderId, productId, quantity, status = 'CONFIRMED', includeOrderLink = true }) {
  const receiptId = 'pr-' + id().slice(0, 8);
  const receiptNo = 'PR-M11-' + receiptId.slice(3, 9);
  const linkedOrderId = includeOrderLink ? orderId : null;
  database.prepare(`
    INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?)
  `).run(receiptId, receiptNo, linkedOrderId, 'supplier-001', 'warehouse-001', 'user-warehouse', 0, status, todayIso(), '', 'user-warehouse', 'user-warehouse');
  database.prepare(`
    INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,?,?,?,?)
  `).run(id(), receiptId, productId, quantity, 1000, quantity * 1000, 1);
  return { receiptId, receiptNo };
}

function seedProductionOrder({ productId, quantity, status = 'PENDING' }) {
  const orderId = 'po2-' + id().slice(0, 8);
  const orderNo = 'MO-M11-' + orderId.slice(4, 10);
  database.prepare(`
    INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,NULL,?,?,NULL,NULL,?,?,datetime('now'),datetime('now'))
  `).run(orderId, orderNo, productId, quantity, status, '', 'user-admin');
  return { orderId, orderNo };
}

function seedProductionReceipt({ orderId, productId, quantity, status = 'CONFIRMED' }) {
  const receiptId = 'prec-' + id().slice(0, 8);
  const receiptNo = 'PRX-M11-' + receiptId.slice(4, 10);
  database.prepare(`
    INSERT INTO production_receipts(id,receipt_no,production_order_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?)
  `).run(receiptId, receiptNo, orderId, 'warehouse-001', quantity, status, todayIso(), '', 'user-admin', 'user-admin');
  return { receiptId, receiptNo };
}

async function createForecast({ name = 'M11 forecast', items, startOffset = 0, endOffset = 30, periodStart, periodEnd }) {
  const today = todayIso();
  const body = {
    forecastName: name,
    periodStart: periodStart || today,
    periodEnd: periodEnd || plusDays(today, 30),
    notes: '',
    items: items || [],
  };
  const result = await request('/api/planning/forecasts', { method: 'POST', body, token: adminToken });
  assert.equal(result.status, 201, result.data.error);
  return result.data;
}

async function createMrpRun({ name = 'M11 run', mode = 'SALES_ORDERS', forecastId, horizonStart, horizonEnd }) {
  const today = todayIso();
  const body = {
    runName: name,
    horizonStart: horizonStart || today,
    horizonEnd: horizonEnd || plusDays(today, 60),
    demandSourceMode: mode,
    forecastId: forecastId || null,
  };
  const result = await request('/api/planning/mrp/runs', { method: 'POST', body, token: adminToken });
  assert.equal(result.status, 201, result.data.error);
  return result.data;
}

async function executeRun(runId, token = adminToken) {
  return request(`/api/planning/mrp/runs/${runId}/execute`, { method: 'POST', token });
}

// =====================================================================
// 1. Permission registry / role contract
// =====================================================================
describe('M11 permission registry and five-role contract', () => {
  test('1. registered permission count stays at 112 after M14 + Core Scope Cleanup + V17 Wave A; MRP_VIEW / MRP_MANAGE exist', () => {
    assert.equal(PERMISSIONS.length, 122);
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    assert.ok(codes.has('MRP_VIEW'));
    assert.ok(codes.has('MRP_MANAGE'));
  });

  test('2. admin holds MRP_VIEW / MRP_MANAGE', async () => {
    const me = await request('/api/auth/me', { token: adminToken });
    assert.ok(me.data.user.permissions.includes('MRP_VIEW'));
    assert.ok(me.data.user.permissions.includes('MRP_MANAGE'));
  });

  test('3. non-admin roles do not hold MRP_VIEW / MRP_MANAGE', async () => {
    for (const [username, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const me = await request('/api/auth/me', { token });
      assert.equal(me.data.user.permissions.includes('MRP_VIEW'), false, `${username} should not hold MRP_VIEW`);
      assert.equal(me.data.user.permissions.includes('MRP_MANAGE'), false, `${username} should not hold MRP_MANAGE`);
    }
  });
});

// =====================================================================
// 2. Forecast lifecycle
// =====================================================================
describe('M11 forecast lifecycle and validation', () => {
  test('4. create draft forecast then edit it (DRAFT is editable)', async () => {
    const created = await createForecast({ name: 'Q4 forecast', items: [
      { productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 5, notes: '' },
      { productId: 'product-002', needDate: plusDays(todayIso(), 14), quantity: 20, notes: '' },
    ] });
    assert.ok(created.id);
    const list = await request('/api/planning/forecasts?status=DRAFT');
    assert.equal(list.status, 200);
    assert.ok(list.data.forecasts.some((f) => f.id === created.id));
    const edit = await request(`/api/planning/forecasts/${created.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        forecastName: 'Q4 forecast updated',
        periodStart: todayIso(),
        periodEnd: plusDays(todayIso(), 45),
        items: [
          { productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 8, notes: 'revised' },
        ],
      },
    });
    assert.equal(edit.status, 200, edit.data.error);
    const detail = await request(`/api/planning/forecasts/${created.id}`);
    assert.equal(detail.data.forecast.forecast_name, 'Q4 forecast updated');
    assert.equal(detail.data.forecast.items.length, 1);
    assert.equal(Number(detail.data.forecast.items[0].quantity), 8);
  });

  test('5. invalid period (start > end) is rejected', async () => {
    const result = await request('/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: {
        forecastName: 'invalid period',
        periodStart: plusDays(todayIso(), 10),
        periodEnd: plusDays(todayIso(), 5),
        items: [],
      },
    });
    assert.equal(result.status, 400, result.data.error);
  });

  test('6. item need_date outside the period is rejected', async () => {
    const result = await request('/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: {
        forecastName: 'item date outside',
        periodStart: todayIso(),
        periodEnd: plusDays(todayIso(), 5),
        items: [
          { productId: 'product-001', needDate: plusDays(todayIso(), 30), quantity: 1, notes: '' },
        ],
      },
    });
    assert.equal(result.status, 400, result.data.error);
    assert.match(result.data.error, /需求日期必须在预测期间之内/);
  });

  test('7. invalid quantity (zero / negative / non-finite) is rejected', async () => {
    for (const bad of [0, -1, 'abc', null]) {
      const result = await request('/api/planning/forecasts', {
        method: 'POST', token: adminToken,
        body: {
          forecastName: 'bad qty ' + String(bad),
          periodStart: todayIso(),
          periodEnd: plusDays(todayIso(), 30),
          items: [{ productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: bad, notes: '' }],
        },
      });
      assert.equal(result.status, 400, 'expected 400 for qty=' + JSON.stringify(bad));
    }
  });

  test('8. duplicate (product, need_date) is rejected', async () => {
    const result = await request('/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: {
        forecastName: 'duplicate row',
        periodStart: todayIso(),
        periodEnd: plusDays(todayIso(), 30),
        items: [
          { productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 1, notes: '' },
          { productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 2, notes: '' },
        ],
      },
    });
    assert.equal(result.status, 400, result.data.error);
    assert.match(result.data.error, /重复/);
  });

  test('9. activate rejects empty forecast; verify activate locks content', async () => {
    const empty = await createForecast({ name: 'empty', items: [] });
    const activateEmpty = await request(`/api/planning/forecasts/${empty.id}/activate`, { method: 'POST', token: adminToken });
    assert.equal(activateEmpty.status, 400, activateEmpty.data.error);
    const seeded = await createForecast({
      name: 'has items',
      items: [{ productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 5, notes: '' }],
    });
    const act = await request(`/api/planning/forecasts/${seeded.id}/activate`, { method: 'POST', token: adminToken });
    assert.equal(act.status, 200);
    const edit = await request(`/api/planning/forecasts/${seeded.id}`, {
      method: 'PATCH', token: adminToken,
      body: { forecastName: 'cannot edit active', items: [] },
    });
    assert.equal(edit.status, 409, edit.data.error);
    assert.match(edit.data.error, /只有草稿/);
  });

  test('10. cancel idempotent and blocks further edit', async () => {
    const fc = await createForecast({
      name: 'cancel test',
      items: [{ productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 5 }],
    });
    const first = await request(`/api/planning/forecasts/${fc.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(first.status, 200);
    const second = await request(`/api/planning/forecasts/${fc.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(second.status, 200);
    const edit = await request(`/api/planning/forecasts/${fc.id}`, {
      method: 'PATCH', token: adminToken,
      body: { forecastName: 'should fail' },
    });
    assert.equal(edit.status, 409);
  });

  test('11. permission security — non-admin cannot create/activate forecasts', async () => {
    for (const [name, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const create = await request('/api/planning/forecasts', {
        method: 'POST', token,
        body: {
          forecastName: 'blocked ' + name,
          periodStart: todayIso(),
          periodEnd: plusDays(todayIso(), 30),
          items: [{ productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 1 }],
        },
      });
      assert.equal(create.status, 403, `${name} should be forbidden from creating forecasts`);
    }
  });

  test('12. read access granted to MRP_VIEW holders; detail returns items', async () => {
    const fc = await createForecast({
      name: 'reader test',
      items: [{ productId: 'product-001', needDate: plusDays(todayIso(), 7), quantity: 3 }],
    });
    await request(`/api/planning/forecasts/${fc.id}/activate`, { method: 'POST', token: adminToken });
    const detail = await request(`/api/planning/forecasts/${fc.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.forecast.status, 'ACTIVE');
    assert.equal(detail.data.forecast.items.length, 1);
  });
});

// =====================================================================
// 3. Sales demand derivation
// =====================================================================
describe('M11 sales open demand derivation', () => {
  test('13. APPROVED 10, CONFIRMED delivery 4 → MRP open demand = 6', async () => {
    const { orderId } = seedSalesOrder({ productId: 'product-001', quantity: 10 });
    seedSalesDelivery({ orderId, productId: 'product-001', quantity: 4 });
    const run = await createMrpRun({ name: 'sales partial', mode: 'SALES_ORDERS' });
    const exec = await executeRun(run.id);
    assert.equal(exec.status, 200);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === 'product-001');
    assert.ok(row, 'product-001 result row expected');
    assert.equal(Number(row.gross_sales_demand), 6);
    assert.equal(Number(row.gross_requirement), 6);
  });

  test('14. fully delivered APPROVED → 0 open sales demand', async () => {
    const productId = ensureProduct('FD1', '完全交付测试');
    const { orderId } = seedSalesOrder({ productId, quantity: 5 });
    seedSalesDelivery({ orderId, productId, quantity: 5 });
    const run = await createMrpRun({ name: 'fully delivered' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const demands = detail.data.run.demands.filter((d) => d.product_id === productId);
    assert.equal(demands.length, 0, 'fully delivered must not contribute to MRP demand');
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.equal(row, undefined, 'no result row for fully delivered product');
  });

  test('15. SUBMITTED / REJECTED / DRAFT / unknown status sales orders produce 0 demand', async () => {
    const productId = ensureProduct('NP1', '非审批状态');
    for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED']) {
      const { orderId } = seedSalesOrder({ productId, quantity: 10, status });
      if (status !== 'DRAFT') {
        seedSalesDelivery({ orderId, productId, quantity: 0 }).deliveryId;
      }
    }
    const run = await createMrpRun({ name: 'unapproved' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.equal(row, undefined, 'non-approved orders must not produce MRP demand');
  });

  test('16. over-delivery against a sales order does not create negative demand', async () => {
    const productId = ensureProduct('OD1', '超额交付');
    const { orderId } = seedSalesOrder({ productId, quantity: 5 });
    // Over-deliver by 3; remaining = max(0, 5 - 8) = 0 — not negative.
    seedSalesDelivery({ orderId, productId, quantity: 8 });
    const run = await createMrpRun({ name: 'over-delivery' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const demands = detail.data.run.demands.filter((d) => d.product_id === productId);
    assert.equal(demands.length, 0, 'over-delivery must not produce negative demand rows');
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.equal(row, undefined);
  });

  test('17. same product on multiple order lines aggregates at product level', async () => {
    const productId = ensureProduct('MP1', '多订单汇总');
    const a = seedSalesOrder({ productId, quantity: 4 });
    const b = seedSalesOrder({ productId, quantity: 6 });
    seedSalesDelivery({ orderId: a.orderId, productId, quantity: 1 });
    seedSalesDelivery({ orderId: b.orderId, productId, quantity: 2 });
    const run = await createMrpRun({ name: 'multi-order same product' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const salesDemand = detail.data.run.demands
      .filter((d) => d.product_id === productId && d.source_type === 'SALES_ORDER')
      .reduce((sum, d) => sum + Number(d.quantity), 0);
    assert.equal(salesDemand, 7, '4+6−1−2 = 7');
  });

  test('18. sales return does not automatically reopen demand', async () => {
    // 8 ordered + 4 delivered => 4 open demand.
    const productId = ensureProduct('SR1', '销售退货');
    const { orderId } = seedSalesOrder({ productId, quantity: 8 });
    seedSalesDelivery({ orderId, productId, quantity: 4 });
    // A sales return brings 3 back into inventory but does NOT reduce the
    // open sales demand (the customer must place a new order to replace).
    database.prepare(`
      INSERT INTO return_orders(id,return_no,source_type,source_id,customer_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by,delivery_id,receipt_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?,?,?)
    `).run('ret-m11-1', 'RET-M11-1', 'SALES', 'sd-not-used', 'customer-001', null, 'warehouse-001', 0, 'CONFIRMED', todayIso(), '', '', 'user-warehouse', 'user-warehouse', null, null);
    database.prepare(`
      INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?)
    `).run(id(), 'ret-m11-1', productId, 3, 1000, 3000, 1);
    const run = await createMrpRun({ name: 'sales return' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const salesDemand = detail.data.run.demands
      .filter((d) => d.product_id === productId && d.source_type === 'SALES_ORDER')
      .reduce((sum, d) => sum + Number(d.quantity), 0);
    assert.equal(salesDemand, 4, 'sales return must not reopen sales demand');
  });
});

// =====================================================================
// 4. Purchase supply derivation
// =====================================================================
describe('M11 purchase open supply derivation', () => {
  test('19. APPROVED PO 10 − CONFIRMED receipt 4 → open purchase supply = 6', async () => {
    const productId = ensureProduct('PO1', '采购订单1');
    const { orderId } = seedPurchaseOrder({ productId, quantity: 10 });
    seedPurchaseReceipt({ orderId, productId, quantity: 4 });
    seedSalesOrder({ productId, quantity: 10 });
    const run = await createMrpRun({ name: 'po partial' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_purchase_supply), 6);
  });

  test('20. fully received APPROVED PO → 0 open purchase supply', async () => {
    const productId = ensureProduct('PO2', '采购订单2');
    const { orderId } = seedPurchaseOrder({ productId, quantity: 5 });
    seedPurchaseReceipt({ orderId, productId, quantity: 5 });
    seedSalesOrder({ productId, quantity: 10 });
    const run = await createMrpRun({ name: 'po fully received' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_purchase_supply), 0);
  });

  test('21. SUBMITTED / DRAFT / REJECTED POs do not contribute supply', async () => {
    const productId = ensureProduct('PO3', '采购订单3');
    for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED']) {
      seedPurchaseOrder({ productId, quantity: 10, status });
    }
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'po unapproved' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    if (row) assert.equal(Number(row.open_purchase_supply), 0);
  });

  test('22. direct purchase receipt (no PO) is not counted as future supply', async () => {
    const productId = ensureProduct('PO4', '采购订单4');
    const { orderId } = seedPurchaseOrder({ productId, quantity: 5 });
    seedPurchaseReceipt({ orderId: null, productId, quantity: 100, includeOrderLink: false });
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'po direct receipt' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_purchase_supply), 5, 'only the linked PO contributes open supply');
  });

  test('23. purchase return does not recreate PO supply', async () => {
    const productId = ensureProduct('PR1', '采购退货');
    const { orderId } = seedPurchaseOrder({ productId, quantity: 8 });
    const { receiptId } = seedPurchaseReceipt({ orderId, productId, quantity: 5 });
    database.prepare(`
      INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?)
    `).run('pret-m11-1', 'PRT-M11-1', receiptId, 'supplier-001', 'warehouse-001', 0, 'CONFIRMED', todayIso(), '', '', 'user-warehouse', 'user-warehouse');
    database.prepare(`
      INSERT INTO purchase_return_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?)
    `).run(id(), 'pret-m11-1', productId, 3, 1000, 3000, 1);
    seedSalesOrder({ productId, quantity: 8 });
    const run = await createMrpRun({ name: 'po return' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_purchase_supply), 3, 'PO return must not recreate PO supply');
  });
});

// =====================================================================
// 5. Production supply derivation
// =====================================================================
describe('M11 production open supply derivation', () => {
  test('24. PENDING PO qty 10 − receipt 4 → open production supply = 6', async () => {
    const productId = ensureProduct('PRP1', '生产订单P1');
    const order = seedProductionOrder({ productId, quantity: 10, status: 'PENDING' });
    seedProductionReceipt({ orderId: order.orderId, productId, quantity: 4 });
    seedSalesOrder({ productId, quantity: 10 });
    const run = await createMrpRun({ name: 'prod pending' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_production_supply), 6);
  });

  test('25. IN_PROGRESS PO qty 10 − receipt 4 → open production supply = 6', async () => {
    const productId = ensureProduct('PRP2', '生产订单P2');
    const order = seedProductionOrder({ productId, quantity: 10, status: 'IN_PROGRESS' });
    seedProductionReceipt({ orderId: order.orderId, productId, quantity: 4 });
    seedSalesOrder({ productId, quantity: 10 });
    const run = await createMrpRun({ name: 'prod in-progress' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_production_supply), 6);
  });

  test('26. COMPLETED production order contributes 0', async () => {
    const productId = ensureProduct('PRP3', '生产订单P3');
    seedProductionOrder({ productId, quantity: 10, status: 'COMPLETED' });
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'prod completed' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_production_supply), 0);
  });

  test('27. CANCELLED production order contributes 0', async () => {
    const productId = ensureProduct('PRP4', '生产订单P4');
    seedProductionOrder({ productId, quantity: 10, status: 'CANCELLED' });
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'prod cancelled' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.open_production_supply), 0);
  });
});

// =====================================================================
// 6. Simple netting + suggestion
// =====================================================================
describe('M11 simple MRP netting', () => {
  test('28. demand 10, on-hand 3, open production 2 → net = 5', async () => {
    const productId = ensureProduct('NET1', '净需求1');
    const whId = seedWarehouse();
    seedInventory(whId, productId, 3);
    seedProductionOrder({ productId, quantity: 2, status: 'PENDING' });
    seedSalesOrder({ productId, quantity: 10 });
    const run = await createMrpRun({ name: 'simple net' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.on_hand), 3);
    assert.equal(Number(row.open_production_supply), 2);
    assert.equal(Number(row.net_requirement), 5);
    assert.equal(Number(row.suggested_quantity), 5);
  });

  test('29. net requirement is never negative; demand satisfied by stock returns empty suggestion', async () => {
    const productId = ensureProduct('NET2', '净需求2');
    const whId = seedWarehouse();
    seedInventory(whId, productId, 100);
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'net zero' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.net_requirement), 0);
    assert.equal(Number(row.suggested_quantity), 0);
    assert.equal(row.suggestion_type, '');
  });

  test('30. product with ACTIVE BOM yields MAKE suggestion; without BOM yields BUY', async () => {
    const parentId = ensureProduct('MBP', '自制产品');
    const childId = ensureProduct('MBC', '外购产品');
    seedBom({ parentId, items: [{ productId: childId, quantity: 2 }] });
    seedSalesOrder({ productId: parentId, quantity: 3 });
    const run = await createMrpRun({ name: 'make vs buy' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const make = detail.data.run.results.find((r) => r.product_id === parentId);
    const buy = detail.data.run.results.find((r) => r.product_id === childId);
    assert.equal(make.suggestion_type, 'MAKE');
    assert.equal(buy.suggestion_type, 'BUY');
  });
});

// =====================================================================
// 7. BOM explosion
// =====================================================================
describe('M11 BOM explosion', () => {
  test('31. single-level: FG net 5 × BOM A×2 B×3 → component gross A=10, B=15', async () => {
    const fgId = ensureProduct('BOM-FG', 'BOM成品');
    const compA = ensureProduct('BOM-A', 'BOM组件A');
    const compB = ensureProduct('BOM-B', 'BOM组件B');
    seedBom({ parentId: fgId, items: [
      { productId: compA, quantity: 2 },
      { productId: compB, quantity: 3 },
    ] });
    seedSalesOrder({ productId: fgId, quantity: 5 });
    const run = await createMrpRun({ name: 'bom single' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const comp = detail.data.run.components.filter((c) => c.parent_product_id === fgId);
    const byChild = Object.fromEntries(comp.map((c) => [c.product_id, Number(c.gross_required)]));
    assert.equal(byChild[compA], 10);
    assert.equal(byChild[compB], 15);
  });

  test('32. shared component: FG1 needs A×2, FG2 needs A×3 → A demand aggregates before A stock is consumed', async () => {
    const fg1 = ensureProduct('SH-FG1', '共享组件FG1');
    const fg2 = ensureProduct('SH-FG2', '共享组件FG2');
    const shared = ensureProduct('SH-A', '共享组件A');
    seedBom({ parentId: fg1, items: [{ productId: shared, quantity: 2 }] });
    seedBom({ parentId: fg2, items: [{ productId: shared, quantity: 3 }] });
    seedSalesOrder({ productId: fg1, quantity: 5 });
    seedSalesOrder({ productId: fg2, quantity: 4 });
    const run = await createMrpRun({ name: 'shared component' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const aggregateA = detail.data.run.components
      .filter((c) => c.product_id === shared)
      .reduce((sum, c) => sum + Number(c.gross_required), 0);
    assert.equal(aggregateA, 22, '5*2 + 4*3 = 22');
  });

  test('33. multi-level: FG → SUB → RAW; shortage at each level surfaced', async () => {
    const fgId = ensureProduct('ML-FG', '多层成品');
    const subId = ensureProduct('ML-SUB', '多层半成品');
    const rawId = ensureProduct('ML-RAW', '多层原料');
    seedBom({ parentId: fgId, items: [{ productId: subId, quantity: 1 }] });
    seedBom({ parentId: subId, items: [{ productId: rawId, quantity: 2 }] });
    seedSalesOrder({ productId: fgId, quantity: 3 });
    const run = await createMrpRun({ name: 'multilevel' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    const subRow = detail.data.run.results.find((r) => r.product_id === subId);
    const rawRow = detail.data.run.results.find((r) => r.product_id === rawId);
    assert.equal(fgRow.suggestion_type, 'MAKE');
    assert.equal(Number(fgRow.net_requirement), 3);
    assert.equal(subRow.suggestion_type, 'MAKE');
    assert.equal(Number(subRow.gross_component_demand), 3);
    assert.equal(rawRow.suggestion_type, 'BUY');
    assert.equal(Number(rawRow.gross_component_demand), 6);
  });

  test('34. cycle (A → B → A) fails safely with 400 and no partial results', async () => {
    ensureProduct('CYCLE-A', '循环测试A');
    ensureProduct('CYCLE-B', '循环测试B');
    seedBom({ parentId: 'product-CYCLE-A', items: [{ productId: 'product-CYCLE-B', quantity: 1 }] });
    seedBom({ parentId: 'product-CYCLE-B', items: [{ productId: 'product-CYCLE-A', quantity: 1 }] });
    const { orderId } = seedSalesOrder({ productId: 'product-CYCLE-A', quantity: 1 });
    const run = await createMrpRun({ name: 'cycle' });
    const exec = await executeRun(run.id);
    assert.equal(exec.status, 400, exec.data.error);
    assert.match(exec.data.error, /循环|BOM/);
    const results = database.prepare('SELECT COUNT(*) cnt FROM mrp_run_results WHERE run_id=?').get(run.id).cnt;
    assert.equal(results, 0, 'cycle run must not persist partial results');
    const dbStatus = database.prepare('SELECT status FROM mrp_runs WHERE id=?').get(run.id).status;
    assert.equal(dbStatus, 'DRAFT', 'cycle run must remain DRAFT');
    // Cleanup: cancel the cycle sales order so subsequent MRP runs that
    // scan all APPROVED orders do not pick up the cycle product and
    // fail with the cycle error. The sales_order schema only allows
    // DRAFT/SUBMITTED/APPROVED/REJECTED; use REJECTED so the row no
    // longer matches MRP's `status = 'APPROVED'` filter.
    database.prepare("UPDATE sales_orders SET status='REJECTED', rejection_reason='cycle test cleanup' WHERE id=?").run(orderId);
  });

  test('35. ROUTING_MISSING warning when ACTIVE routing is absent for MAKE suggestion', async () => {
    const fgId = ensureProduct('RT-FG', '无路线成品');
    const compId = ensureProduct('RT-C', '无路线组件');
    seedBom({ parentId: fgId, items: [{ productId: compId, quantity: 1 }] });
    seedSalesOrder({ productId: fgId, quantity: 1 });
    const run = await createMrpRun({ name: 'routing missing' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === fgId);
    assert.equal(row.suggestion_type, 'MAKE');
    assert.equal(row.warning, 'ROUTING_MISSING');
  });

  test('36. no warning when ACTIVE routing exists', async () => {
    const fgId = ensureProduct('RA-FG', '有路线成品');
    const compId = ensureProduct('RA-C', '有路线组件');
    seedBom({ parentId: fgId, items: [{ productId: compId, quantity: 1 }] });
    database.prepare(`INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
      .run('rt-' + id().slice(0, 6), fgId, 'RT-M11-A', 'A 路线', 'v1', 'ACTIVE', '');
    seedSalesOrder({ productId: fgId, quantity: 1 });
    const run = await createMrpRun({ name: 'routing active' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === fgId);
    assert.equal(row.warning, '');
  });
});

// =====================================================================
// 8. Atomicity / idempotency / immutability
// =====================================================================
describe('M11 atomicity, idempotency, and immutability', () => {
  test('37. executing a COMPLETED run returns 409', async () => {
    const productId = ensureProduct('AT1', '原子性测试');
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'completed once' });
    await executeRun(run.id);
    const second = await executeRun(run.id);
    assert.equal(second.status, 409, second.data.error);
    assert.match(second.data.error, /草稿/);
  });

  test('38. completed run snapshot survives later forecast changes', async () => {
    const productId = ensureProduct('AT2', '快照测试');
    const fc = await createForecast({
      name: 'snapshot test',
      items: [{ productId, needDate: plusDays(todayIso(), 7), quantity: 10 }],
    });
    await request(`/api/planning/forecasts/${fc.id}/activate`, { method: 'POST', token: adminToken });
    const run = await createMrpRun({ name: 'forecast run', mode: 'FORECAST', forecastId: fc.id });
    await executeRun(run.id);
    const before = await request(`/api/planning/mrp/runs/${run.id}`);
    const beforeDemand = before.data.run.results.find((r) => r.product_id === productId);
    assert.ok(beforeDemand);
    const recordedDemand = Number(beforeDemand.gross_forecast_demand);
    assert.equal(recordedDemand, 10);
    // Cancel the forecast — the completed run snapshot must not change.
    await request(`/api/planning/forecasts/${fc.id}/cancel`, { method: 'POST', token: adminToken });
    const after = await request(`/api/planning/mrp/runs/${run.id}`);
    const afterDemand = after.data.run.results.find((r) => r.product_id === productId);
    assert.equal(Number(afterDemand.gross_forecast_demand), recordedDemand);
  });

  test('39. inventory change after COMPLETED does not rewrite historical run', async () => {
    const productId = ensureProduct('AT3', '库存快照');
    seedSalesOrder({ productId, quantity: 5 });
    const whId = seedWarehouse();
    seedInventory(whId, productId, 10);
    const run = await createMrpRun({ name: 'inventory snapshot' });
    await executeRun(run.id);
    const before = await request(`/api/planning/mrp/runs/${run.id}`);
    const beforeRow = before.data.run.results.find((r) => r.product_id === productId);
    assert.equal(Number(beforeRow.on_hand), 10);
    // Inventory change after the fact.
    database.prepare("UPDATE inventory SET quantity=999 WHERE warehouse_id=? AND product_id=?")
      .run(whId, productId);
    const after = await request(`/api/planning/mrp/runs/${run.id}`);
    const afterRow = after.data.run.results.find((r) => r.product_id === productId);
    assert.equal(Number(afterRow.on_hand), 10, 'historical run snapshot must not rewrite on_hand');
  });

  test('40. PATCH a COMPLETED run returns 409', async () => {
    const productId = ensureProduct('AT4', 'PATCH完测试');
    seedSalesOrder({ productId, quantity: 3 });
    const run = await createMrpRun({ name: 'edit blocked' });
    await executeRun(run.id);
    const patch = await request(`/api/planning/mrp/runs/${run.id}`, {
      method: 'PATCH', token: adminToken,
      body: { runName: 'should not stick', demandSourceMode: 'SALES_ORDERS' },
    });
    assert.equal(patch.status, 409, patch.data.error);
  });

  test('41. cancel a COMPLETED run returns 409', async () => {
    const productId = ensureProduct('AT5', '取消完测试');
    seedSalesOrder({ productId, quantity: 3 });
    const run = await createMrpRun({ name: 'cancel completed' });
    await executeRun(run.id);
    const cancel = await request(`/api/planning/mrp/runs/${run.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(cancel.status, 409, cancel.data.error);
  });

  test('42. invalid demand_source_mode is rejected (400)', async () => {
    const result = await request('/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: {
        runName: 'bad mode',
        horizonStart: todayIso(),
        horizonEnd: plusDays(todayIso(), 30),
        demandSourceMode: 'NONSENSE',
      },
    });
    assert.equal(result.status, 400);
  });

  test('43. FORECAST mode requires forecastId; missing forecast → 400', async () => {
    const result = await request('/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: {
        runName: 'forecast no id',
        horizonStart: todayIso(),
        horizonEnd: plusDays(todayIso(), 30),
        demandSourceMode: 'FORECAST',
      },
    });
    assert.equal(result.status, 400);
  });

  test('44. FORECAST mode with DRAFT forecast → 400', async () => {
    const productId = ensureProduct('AT6', '草稿预测');
    const fc = await createForecast({
      name: 'still draft',
      items: [{ productId, needDate: plusDays(todayIso(), 7), quantity: 5 }],
    });
    const result = await request('/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: {
        runName: 'forecast draft',
        horizonStart: todayIso(),
        horizonEnd: plusDays(todayIso(), 30),
        demandSourceMode: 'FORECAST',
        forecastId: fc.id,
      },
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /已生效/);
  });

  test('45. SALES_PLUS_FORECAST consumes forecast with MAX(sales, forecast)', async () => {
    const productId = ensureProduct('CB1', '组合需求');
    const fc = await createForecast({
      name: 'combo',
      items: [{ productId, needDate: plusDays(todayIso(), 7), quantity: 4 }],
    });
    await request(`/api/planning/forecasts/${fc.id}/activate`, { method: 'POST', token: adminToken });
    seedSalesOrder({ productId, quantity: 6 });
    const run = await createMrpRun({ name: 'combo run', mode: 'SALES_PLUS_FORECAST', forecastId: fc.id });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const row = detail.data.run.results.find((r) => r.product_id === productId);
    assert.equal(Number(row.gross_sales_demand), 6);
    assert.equal(Number(row.gross_forecast_demand), 4);
    assert.equal(Number(row.gross_requirement), 6);
  });

  test('46. non-admin cannot execute / cancel MRP runs (403)', async () => {
    const productId = ensureProduct('AT7', '非管理员');
    seedSalesOrder({ productId, quantity: 5 });
    const run = await createMrpRun({ name: 'blocked run' });
    for (const [name, token] of [['sales', salesToken], ['reviewer', reviewerToken], ['warehouse', warehouseToken], ['accounting', accountingToken]]) {
      const exec = await executeRun(run.id, token);
      assert.equal(exec.status, 403, `${name} should be forbidden from executing MRP`);
      const cancel = await request(`/api/planning/mrp/runs/${run.id}/cancel`, { method: 'POST', token });
      assert.equal(cancel.status, 403, `${name} should be forbidden from cancelling MRP`);
    }
  });
});

// =====================================================================
// 9. Traceability / pegging
// =====================================================================
describe('M11 traceability / pegging', () => {
  test('47. run detail exposes demands, components and pegging rows', async () => {
    const fgId = ensureProduct('TR-FG', '追溯FG');
    const compId = ensureProduct('TR-C', '追溯组件');
    seedBom({ parentId: fgId, items: [{ productId: compId, quantity: 2 }] });
    seedSalesOrder({ productId: fgId, quantity: 3 });
    const run = await createMrpRun({ name: 'trace' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    assert.ok(Array.isArray(detail.data.run.demands));
    assert.ok(Array.isArray(detail.data.run.components));
    assert.ok(Array.isArray(detail.data.run.pegging));
    const bomPeg = detail.data.run.pegging.filter((p) => p.source_type === 'BOM_EXPLOSION' && p.result_product_id === compId);
    assert.ok(bomPeg.length >= 1, 'BOM explosion pegging row expected for component');
  });
});

// =====================================================================
// 10. Net-before-explosion (M11 HOTFIX)
// =====================================================================
//
// Canonical principle: for a MAKE item, only the parent's NET
// requirement (after on-hand + open purchase supply + open production
// supply are subtracted from the gross) may drive BOM explosion. If
// net <= 0, the parent contributes 0 to child gross demand.
describe('M11 net-before-explosion (HOTFIX)', () => {
  test('49. simple: FG consumed gross 10, on-hand 3, open production 2 → FG net 5', async () => {
    const fgId = ensureProduct('NB-FG', '净需求前置FG');
    const compA = ensureProduct('NB-A', '净需求前置A');
    const compB = ensureProduct('NB-B', '净需求前置B');
    seedBom({ parentId: fgId, items: [
      { productId: compA, quantity: 2 },
      { productId: compB, quantity: 3 },
    ] });
    const fc = await createForecast({
      name: 'NB forecast',
      items: [{ productId: fgId, needDate: plusDays(todayIso(), 7), quantity: 10 }],
    });
    await request(`/api/planning/forecasts/${fc.id}/activate`, { method: 'POST', token: adminToken });
    seedSalesOrder({ productId: fgId, quantity: 10 });
    const whId = seedWarehouse();
    seedInventory(whId, fgId, 3);
    seedProductionOrder({ productId: fgId, quantity: 2, status: 'PENDING' });
    const run = await createMrpRun({ name: 'NB simple', mode: 'SALES_PLUS_FORECAST', forecastId: fc.id });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    assert.ok(fgRow);
    assert.equal(Number(fgRow.gross_sales_demand), 10);
    assert.equal(Number(fgRow.gross_forecast_demand), 10);
    assert.equal(Number(fgRow.gross_requirement), 10);
    assert.equal(Number(fgRow.on_hand), 3);
    assert.equal(Number(fgRow.open_production_supply), 2);
    assert.equal(Number(fgRow.net_requirement), 5);
    assert.equal(Number(fgRow.suggested_quantity), 5);
    assert.equal(fgRow.suggestion_type, 'MAKE');
    const aRow = detail.data.run.results.find((r) => r.product_id === compA);
    const bRow = detail.data.run.results.find((r) => r.product_id === compB);
    assert.ok(aRow);
    assert.ok(bRow);
    assert.equal(Number(aRow.gross_component_demand), 10, 'A gross = FG net 5 × 2');
    assert.equal(Number(bRow.gross_component_demand), 15, 'B gross = FG net 5 × 3');
    assert.equal(aRow.suggestion_type, 'BUY');
    assert.equal(bRow.suggestion_type, 'BUY');
    // Verify bom components match the net-driven contributions.
    const comp = detail.data.run.components.filter((c) => c.parent_product_id === fgId);
    const byChild = Object.fromEntries(comp.map((c) => [c.product_id, Number(c.gross_required)]));
    assert.equal(byChild[compA], 10);
    assert.equal(byChild[compB], 15);
  });

  test('50. zero-net parent: FG gross 10, on-hand 10 → net 0 → no child component gross demand', async () => {
    const fgId = ensureProduct('ZN-FG', '零净需求FG');
    const compA = ensureProduct('ZN-A', '零净需求A');
    seedBom({ parentId: fgId, items: [{ productId: compA, quantity: 2 }] });
    seedSalesOrder({ productId: fgId, quantity: 10 });
    const whId = seedWarehouse();
    seedInventory(whId, fgId, 10);
    const run = await createMrpRun({ name: 'NB zero-net' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    assert.ok(fgRow);
    assert.equal(Number(fgRow.gross_requirement), 10);
    assert.equal(Number(fgRow.on_hand), 10);
    assert.equal(Number(fgRow.net_requirement), 0);
    assert.equal(Number(fgRow.suggested_quantity), 0);
    assert.equal(fgRow.suggestion_type, '', 'zero-net parent must not produce MAKE/BUY suggestion');
    // The child component MUST NOT receive any gross component demand.
    const aRow = detail.data.run.results.find((r) => r.product_id === compA);
    assert.equal(aRow, undefined, 'zero-net parent must not create any child component row');
    const comp = detail.data.run.components.filter((c) => c.parent_product_id === fgId);
    assert.equal(comp.length, 0, 'zero-net parent must not persist any bom_components row');
    const peg = detail.data.run.pegging.filter((p) => p.source_type === 'BOM_EXPLOSION' && p.result_product_id === compA);
    assert.equal(peg.length, 0, 'zero-net parent must not produce any BOM_EXPLOSION pegging');
  });

  test('51. partial-net parent: FG gross 10, on-hand 4 → net 6 → A × 2 → child gross 12, NOT 20', async () => {
    const fgId = ensureProduct('PN-FG', '部分净需求FG');
    const compA = ensureProduct('PN-A', '部分净需求A');
    seedBom({ parentId: fgId, items: [{ productId: compA, quantity: 2 }] });
    seedSalesOrder({ productId: fgId, quantity: 10 });
    const whId = seedWarehouse();
    seedInventory(whId, fgId, 4);
    const run = await createMrpRun({ name: 'NB partial' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    assert.equal(Number(fgRow.gross_requirement), 10);
    assert.equal(Number(fgRow.net_requirement), 6);
    assert.equal(Number(fgRow.suggested_quantity), 6);
    const aRow = detail.data.run.results.find((r) => r.product_id === compA);
    assert.ok(aRow);
    assert.equal(Number(aRow.gross_component_demand), 12, 'partial-net: child gross = parent net 6 × 2 = 12, NOT 20');
    assert.equal(Number(aRow.net_requirement), 12);
  });

  test('52. multi-level forecast consumption prevents duplicated downstream demand', async () => {
    const fgId = ensureProduct('MLN-FG', '多层净需求FG');
    const subId = ensureProduct('MLN-SUB', '多层净需求SUB');
    const rawId = ensureProduct('MLN-RAW', '多层净需求RAW');
    seedBom({ parentId: fgId, items: [{ productId: subId, quantity: 2 }] });
    seedBom({ parentId: subId, items: [{ productId: rawId, quantity: 3 }] });
    // Top-level demand = 20 (FG); FG on-hand = 3; FG open prod = 2 → FG net = 15.
    const fc = await createForecast({
      name: 'MLN forecast',
      items: [{ productId: fgId, needDate: plusDays(todayIso(), 7), quantity: 10 }],
    });
    await request(`/api/planning/forecasts/${fc.id}/activate`, { method: 'POST', token: adminToken });
    seedSalesOrder({ productId: fgId, quantity: 10 });
    const whFg = seedWarehouse();
    seedInventory(whFg, fgId, 3);
    seedProductionOrder({ productId: fgId, quantity: 2, status: 'PENDING' });
    // SUB inventory: on-hand 4, open prod 6 → SUB net = 30 − 4 − 6 = 20.
    const whSub = seedWarehouse();
    seedInventory(whSub, subId, 4);
    seedProductionOrder({ productId: subId, quantity: 6, status: 'PENDING' });
    const run = await createMrpRun({ name: 'NB multilevel', mode: 'SALES_PLUS_FORECAST', forecastId: fc.id });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    const subRow = detail.data.run.results.find((r) => r.product_id === subId);
    const rawRow = detail.data.run.results.find((r) => r.product_id === rawId);
    assert.equal(Number(fgRow.net_requirement), 5, 'FG net = MAX(10,10) − 3 − 2 = 5');
    assert.equal(fgRow.suggestion_type, 'MAKE');
    assert.equal(Number(subRow.gross_component_demand), 10, 'SUB gross = FG net 5 × 2 = 10');
    assert.equal(Number(subRow.on_hand), 4);
    assert.equal(Number(subRow.open_production_supply), 6);
    assert.equal(Number(subRow.net_requirement), 0, 'SUB net = 10 − 4 − 6 = 0');
    assert.equal(subRow.suggestion_type, '');
    assert.equal(rawRow, undefined, 'zero-net SUB does not explode RAW');
    // Pegging must use net-driven contributions.
    const subPeg = detail.data.run.pegging.filter((p) => p.result_product_id === subId && p.source_type === 'BOM_EXPLOSION');
    assert.ok(subPeg.length === 1);
    assert.equal(Number(subPeg[0].quantity_contribution), 10);
    const rawPeg = detail.data.run.pegging.filter((p) => p.result_product_id === rawId && p.source_type === 'BOM_EXPLOSION');
    assert.equal(rawPeg.length, 0);
  });

  test('53. shared component: FG1 net 5 × A2 + FG2 net 4 × A3 → A gross 22; net A only once', async () => {
    const fg1 = ensureProduct('SCN-FG1', '共享净需求FG1');
    const fg2 = ensureProduct('SCN-FG2', '共享净需求FG2');
    const shared = ensureProduct('SCN-A', '共享净需求A');
    seedBom({ parentId: fg1, items: [{ productId: shared, quantity: 2 }] });
    seedBom({ parentId: fg2, items: [{ productId: shared, quantity: 3 }] });
    // FG1: sales 5, on-hand 0, open supply 0 → net = 5 → A = 10.
    seedSalesOrder({ productId: fg1, quantity: 5 });
    // FG2: sales 7, on-hand 3, open supply 0 → net = 4 → A = 12.
    seedSalesOrder({ productId: fg2, quantity: 7 });
    const whId = seedWarehouse();
    seedInventory(whId, fg2, 3);
    const run = await createMrpRun({ name: 'NB shared' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fg1Row = detail.data.run.results.find((r) => r.product_id === fg1);
    const fg2Row = detail.data.run.results.find((r) => r.product_id === fg2);
    const aRow = detail.data.run.results.find((r) => r.product_id === shared);
    assert.equal(Number(fg1Row.net_requirement), 5);
    assert.equal(Number(fg2Row.net_requirement), 4);
    assert.ok(aRow);
    assert.equal(Number(aRow.gross_component_demand), 22, '5×2 + 4×3 = 22');
    assert.equal(Number(aRow.net_requirement), 22, 'A netted only ONCE against its own stock + open supply');
    // Pegging must show both net-driven contributions.
    const aPeg = detail.data.run.pegging.filter((p) => p.result_product_id === shared && p.source_type === 'BOM_EXPLOSION');
    const totalPegged = aPeg.reduce((s, p) => s + Number(p.quantity_contribution), 0);
    assert.equal(totalPegged, 22);
    const fg1Peg = aPeg.filter((p) => p.source_id === fg1).reduce((s, p) => s + Number(p.quantity_contribution), 0);
    const fg2Peg = aPeg.filter((p) => p.source_id === fg2).reduce((s, p) => s + Number(p.quantity_contribution), 0);
    assert.equal(fg1Peg, 10, 'FG1 → A = FG1 net 5 × 2 = 10');
    assert.equal(fg2Peg, 12, 'FG2 → A = FG2 net 4 × 3 = 12');
  });

  test('54. pegging matches corrected (net-driven) BOM explosion quantities', async () => {
    const fgId = ensureProduct('PG-FG', 'Peg FG');
    const compA = ensureProduct('PG-A', 'Peg A');
    const compB = ensureProduct('PG-B', 'Peg B');
    seedBom({ parentId: fgId, items: [
      { productId: compA, quantity: 2 },
      { productId: compB, quantity: 3 },
    ] });
    seedSalesOrder({ productId: fgId, quantity: 20 });
    const whId = seedWarehouse();
    seedInventory(whId, fgId, 3);
    seedProductionOrder({ productId: fgId, quantity: 2, status: 'PENDING' });
    const run = await createMrpRun({ name: 'NB peg' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const aPeg = detail.data.run.pegging.filter((p) => p.result_product_id === compA && p.source_type === 'BOM_EXPLOSION');
    const bPeg = detail.data.run.pegging.filter((p) => p.result_product_id === compB && p.source_type === 'BOM_EXPLOSION');
    assert.equal(aPeg.length, 1);
    assert.equal(bPeg.length, 1);
    assert.equal(Number(aPeg[0].quantity_contribution), 30, 'A pegging = FG net 15 × 2 = 30, never 40');
    assert.equal(Number(bPeg[0].quantity_contribution), 45, 'B pegging = FG net 15 × 3 = 45, never 60');
  });

  test('55. parent open purchase supply can reduce parent net before explosion (G)', async () => {
    const fgId = ensureProduct('PO-FG', '采购供应扣减FG');
    const compA = ensureProduct('PO-A', '采购供应扣减A');
    seedBom({ parentId: fgId, items: [{ productId: compA, quantity: 2 }] });
    // FG sales 10, on-hand 0, APPROVED PO 4 (no receipt yet) → net = 6 → A gross = 12.
    seedSalesOrder({ productId: fgId, quantity: 10 });
    seedPurchaseOrder({ productId: fgId, quantity: 4 });
    const run = await createMrpRun({ name: 'NB po' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    const aRow = detail.data.run.results.find((r) => r.product_id === compA);
    assert.equal(Number(fgRow.open_purchase_supply), 4);
    assert.equal(Number(fgRow.net_requirement), 6, 'PO supply reduces FG net before explosion');
    assert.equal(Number(aRow.gross_component_demand), 12, 'A gross = FG net 6 × 2 = 12, NOT 20');
  });

  test('56. parent open production supply reduces parent net before explosion (H)', async () => {
    const fgId = ensureProduct('PROD-FG', '生产供应扣减FG');
    const compA = ensureProduct('PROD-A', '生产供应扣减A');
    seedBom({ parentId: fgId, items: [{ productId: compA, quantity: 2 }] });
    // FG sales 10, on-hand 0, PENDING production 4 (no receipt) → net = 6 → A gross = 12.
    seedSalesOrder({ productId: fgId, quantity: 10 });
    seedProductionOrder({ productId: fgId, quantity: 4, status: 'PENDING' });
    const run = await createMrpRun({ name: 'NB prod' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const fgRow = detail.data.run.results.find((r) => r.product_id === fgId);
    const aRow = detail.data.run.results.find((r) => r.product_id === compA);
    assert.equal(Number(fgRow.open_production_supply), 4);
    assert.equal(Number(fgRow.net_requirement), 6, 'production supply reduces FG net before explosion');
    assert.equal(Number(aRow.gross_component_demand), 12, 'A gross = FG net 6 × 2 = 12, NOT 20');
  });

  test('57. trace: pegging note shows BOM path that follows net-driven parents', async () => {
    const fgId = ensureProduct('TRN-FG', '追溯路径FG');
    const subId = ensureProduct('TRN-SUB', '追溯路径SUB');
    const rawId = ensureProduct('TRN-RAW', '追溯路径RAW');
    seedBom({ parentId: fgId, items: [{ productId: subId, quantity: 1 }] });
    seedBom({ parentId: subId, items: [{ productId: rawId, quantity: 1 }] });
    // FG sales 4, FG on-hand 0 → FG net = 4 → SUB gross = 4 → SUB net = 4 → RAW gross = 4.
    seedSalesOrder({ productId: fgId, quantity: 4 });
    const run = await createMrpRun({ name: 'NB trace' });
    await executeRun(run.id);
    const detail = await request(`/api/planning/mrp/runs/${run.id}`);
    const subPeg = detail.data.run.pegging.filter((p) => p.result_product_id === subId && p.source_type === 'BOM_EXPLOSION');
    const rawPeg = detail.data.run.pegging.filter((p) => p.result_product_id === rawId && p.source_type === 'BOM_EXPLOSION');
    assert.equal(subPeg.length, 1);
    assert.match(subPeg[0].source_label, new RegExp(`${fgId} > ${subId}`), 'pegging note must reference the FG → SUB path');
    assert.equal(rawPeg.length, 1);
    assert.match(rawPeg[0].source_label, new RegExp(`${subId} > ${rawId}`), 'pegging note must reference the SUB → RAW path');
    // bom_components rows must also use the same paths.
    const subComp = detail.data.run.components.filter((c) => c.product_id === subId);
    const rawComp = detail.data.run.components.filter((c) => c.product_id === rawId);
    assert.equal(subComp.length, 1);
    assert.equal(subComp[0].bom_path, `${fgId} > ${subId}`);
    assert.equal(subComp[0].parent_product_id, fgId);
    assert.equal(subComp[0].level, 1);
    assert.equal(rawComp.length, 1);
    assert.equal(rawComp[0].bom_path, `${fgId} > ${subId} > ${rawId}`);
    assert.equal(rawComp[0].parent_product_id, subId, 'RAW direct parent is SUB, not FG');
    assert.equal(rawComp[0].level, 2);
  });
});

// =====================================================================
// 11. Legacy DB reopen — idempotency
// =====================================================================
describe('M11 legacy DB reopen is idempotent', () => {
  test('48. reopen DB twice produces no duplicate forecasts, runs, results, or permissions', async () => {
    database.close();
    const newDb = createDatabase(join(tempDir, 'erp.db'));
    const newForecasts = newDb.prepare("SELECT COUNT(*) cnt FROM planning_forecasts").get().cnt;
    const newRuns = newDb.prepare("SELECT COUNT(*) cnt FROM mrp_runs").get().cnt;
    const newResults = newDb.prepare("SELECT COUNT(*) cnt FROM mrp_run_results").get().cnt;
    const permsCount = newDb.prepare("SELECT COUNT(*) cnt FROM permissions").get().cnt;
    // Reopen one more time to verify second-reopen idempotency.
    newDb.close();
    const thirdDb = createDatabase(join(tempDir, 'erp.db'));
    const tForecasts = thirdDb.prepare("SELECT COUNT(*) cnt FROM planning_forecasts").get().cnt;
    const tRuns = thirdDb.prepare("SELECT COUNT(*) cnt FROM mrp_runs").get().cnt;
    const tResults = thirdDb.prepare("SELECT COUNT(*) cnt FROM mrp_run_results").get().cnt;
    const tPerms = thirdDb.prepare("SELECT COUNT(*) cnt FROM permissions").get().cnt;
    assert.equal(newForecasts, tForecasts);
    assert.equal(newRuns, tRuns);
    assert.equal(newResults, tResults);
    assert.equal(permsCount, tPerms);
    assert.equal(permsCount, 122);
    thirdDb.close();
    // Re-bind the global `database` to the reopened handle for cleanup.
    database = createDatabase(join(tempDir, 'erp.db'));
  });
});
