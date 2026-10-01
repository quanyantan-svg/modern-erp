import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
let tempDir;
let db;
let server;
let baseUrl;
let adminToken;

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await response.json()).token;
}

async function get(path, token = adminToken) {
  const response = await fetch(baseUrl + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const contentType = response.headers.get('content-type') || '';
  return { response, body: contentType.includes('application/json') ? await response.json() : await response.text() };
}

function salesOrder(id, no, date, items, customerId = 'customer-001') {
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date)
    VALUES(?,?,?,'APPROVED',0,'','user-admin','2026-09-01','2026-09-01','2026-09-01',?)`).run(id, no, customerId, date);
  items.forEach((item, index) => db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?, ?,100,0,?)`).run(item.id, id, item.productId || 'product-001', item.quantity, index + 1));
}

function salesDelivery(id, no, orderId, date, items, customerId = 'customer-001') {
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,?,?,?,'warehouse-001','user-admin','CONFIRMED',0,?,'','user-admin','2026-09-01','2026-09-01','2026-09-01','user-admin')`).run(id, no, orderId, customerId, date);
  items.forEach((item, index) => db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES(?,?,?, ?,100,0,?,?)`).run(item.id, id, item.productId || 'product-001', item.quantity, index + 1, item.sourceId || null));
}

function purchaseOrder(id, no, date, items, supplierId = 'supplier-001') {
  db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date)
    VALUES(?,?,?,'APPROVED',0,'','user-admin','2026-09-01','2026-09-01','2026-09-01',?)`).run(id, no, supplierId, date);
  items.forEach((item, index) => db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?, ?,100,0,?)`).run(item.id, id, item.productId || 'product-001', item.quantity, index + 1));
}

function purchaseReceipt(id, no, orderId, date, items, supplierId = 'supplier-001') {
  db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,?,?,?,'warehouse-001','user-admin','CONFIRMED',0,?,'','user-admin','2026-09-01','2026-09-01','2026-09-01','user-admin')`).run(id, no, orderId, supplierId, date);
  items.forEach((item, index) => db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id)
    VALUES(?,?,?, ?,100,0,?,?)`).run(item.id, id, item.productId || 'product-001', item.quantity, index + 1, item.sourceId || null));
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e6-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');

  salesOrder('e6-so-zero', 'E6-SO-001', '2026-09-15', [{ id: 'e6-soi-zero', quantity: 100 }]);
  salesOrder('e6-so-part', 'E6-SO-002', '2026-09-10', [{ id: 'e6-soi-part', quantity: 100 }]);
  salesDelivery('e6-sd-part-a', 'E6-SD-001', 'e6-so-part', '2026-09-02', [{ id: 'e6-sdi-part-a', sourceId: 'e6-soi-part', quantity: 25 }]);
  salesDelivery('e6-sd-part-b', 'E6-SD-002', 'e6-so-part', '2026-09-03', [{ id: 'e6-sdi-part-b', sourceId: 'e6-soi-part', quantity: 35 }]);
  salesOrder('e6-so-full', 'E6-SO-003', '2026-09-01', [{ id: 'e6-soi-full', quantity: 100 }]);
  salesDelivery('e6-sd-full', 'E6-SD-003', 'e6-so-full', '2026-09-04', [{ id: 'e6-sdi-full', sourceId: 'e6-soi-full', quantity: 100 }]);
  salesOrder('e6-so-same', 'E6-SO-004', '2026-10-10', [{ id: 'e6-soi-same-1', quantity: 50 }, { id: 'e6-soi-same-2', quantity: 50 }]);
  salesDelivery('e6-sd-same', 'E6-SD-004', 'e6-so-same', '2026-09-05', [{ id: 'e6-sdi-same', sourceId: 'e6-soi-same-1', quantity: 20 }]);
  salesOrder('e6-so-missing', 'E6-SO-005', null, [{ id: 'e6-soi-missing', quantity: 5 }]);
  salesOrder('e6-so-legacy', 'E6-SO-006', '2026-09-05', [{ id: 'e6-soi-legacy', quantity: 10 }]);
  salesDelivery('e6-sd-legacy', 'E6-SD-006', 'e6-so-legacy', '2026-09-05', [{ id: 'e6-sdi-legacy', quantity: 4 }]);
  salesOrder('e6-so-over', 'E6-SO-007', '2026-09-08', [{ id: 'e6-soi-over', quantity: 1.5 }]);
  salesDelivery('e6-sd-over', 'E6-SD-007', 'e6-so-over', '2026-09-06', [{ id: 'e6-sdi-over', sourceId: 'e6-soi-over', quantity: 1.75 }]);

  purchaseOrder('e6-po-zero', 'E6-PO-001', '2026-09-15', [{ id: 'e6-poi-zero', quantity: 100 }]);
  purchaseOrder('e6-po-part', 'E6-PO-002', '2026-09-10', [{ id: 'e6-poi-part', quantity: 100 }]);
  purchaseReceipt('e6-pr-part-a', 'E6-PR-001', 'e6-po-part', '2026-09-02', [{ id: 'e6-pri-part-a', sourceId: 'e6-poi-part', quantity: 60 }]);
  purchaseOrder('e6-po-full', 'E6-PO-003', '2026-09-01', [{ id: 'e6-poi-full', quantity: 100 }]);
  purchaseReceipt('e6-pr-full', 'E6-PR-003', 'e6-po-full', '2026-09-04', [{ id: 'e6-pri-full', sourceId: 'e6-poi-full', quantity: 100 }]);
  purchaseOrder('e6-po-same', 'E6-PO-004', '2026-10-10', [{ id: 'e6-poi-same-1', quantity: 50 }, { id: 'e6-poi-same-2', quantity: 50 }]);
  purchaseReceipt('e6-pr-same', 'E6-PR-004', 'e6-po-same', '2026-09-05', [{ id: 'e6-pri-same', sourceId: 'e6-poi-same-1', quantity: 20 }]);
  purchaseOrder('e6-po-legacy', 'E6-PO-006', '2026-09-05', [{ id: 'e6-poi-legacy', quantity: 10 }]);
  purchaseReceipt('e6-pr-legacy', 'E6-PR-006', 'e6-po-legacy', '2026-09-05', [{ id: 'e6-pri-legacy', quantity: 4 }]);

  db.prepare(`INSERT INTO return_orders(id,return_no,source_type,source_id,customer_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-sret','E6-SRET-001','SALES','e6-sd-full','customer-001','warehouse-001',0,'CONFIRMED','2026-09-07','','','user-admin','2026-09-07','2026-09-07','2026-09-07','user-admin')`).run();
  db.prepare(`INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,delivery_item_id)
    VALUES('e6-sreti','e6-sret','product-001',20,100,0,1,'e6-sdi-full')`).run();
  db.prepare(`INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-pret','E6-PRET-001','e6-pr-full','supplier-001','warehouse-001',0,'CONFIRMED','2026-09-07','','','user-admin','2026-09-07','2026-09-07','2026-09-07','user-admin')`).run();
  db.prepare(`INSERT INTO purchase_return_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,receipt_item_id)
    VALUES('e6-preti','e6-pret','product-001',20,100,0,1,'e6-pri-full')`).run();
});

after(async () => {
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V1.4-E6 sales line fulfillment', () => {
  test('zero, partial, exact-line attribution and no cross-line leakage', async () => {
    const { body } = await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-28');
    const zero = body.rows.find((row) => row.orderItemId === 'e6-soi-zero');
    const partial = body.rows.find((row) => row.orderItemId === 'e6-soi-part');
    const line1 = body.rows.find((row) => row.orderItemId === 'e6-soi-same-1');
    const line2 = body.rows.find((row) => row.orderItemId === 'e6-soi-same-2');
    assert.deepEqual([zero.orderedQuantity, zero.fulfilledQuantity, zero.remainingQuantity, zero.fulfillmentStatus], [100, 0, 100, 'UNFULFILLED']);
    assert.deepEqual([partial.fulfilledQuantity, partial.remainingQuantity, partial.fulfillmentStatus, partial.contributionCount], [60, 40, 'PARTIAL', 2]);
    assert.equal(line1.fulfilledQuantity, 20);
    assert.equal(line2.fulfilledQuantity, 0);
  });

  test('fulfilled hidden by default, show-fulfilled restores it, and return does not reopen', async () => {
    const hidden = (await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-28')).body;
    assert.equal(hidden.rows.some((row) => row.orderItemId === 'e6-soi-full'), false);
    const shown = (await get('/api/reports/decision/sales-outstanding?includeFulfilled=true&asOfDate=2026-09-28')).body;
    const full = shown.rows.find((row) => row.orderItemId === 'e6-soi-full');
    assert.deepEqual([full.fulfilledQuantity, full.remainingQuantity, full.fulfillmentStatus], [100, 0, 'FULFILLED']);
  });

  test('overdue, today boundary, future and missing commitment sorting are deterministic', async () => {
    const { body } = await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-15');
    const partial = body.rows.find((row) => row.orderItemId === 'e6-soi-part');
    const today = body.rows.find((row) => row.orderItemId === 'e6-soi-zero');
    const future = body.rows.find((row) => row.orderItemId === 'e6-soi-same-2');
    const missing = body.rows.find((row) => row.orderItemId === 'e6-soi-missing');
    assert.deepEqual([partial.overdue, partial.overdueDays], [true, 5]);
    assert.deepEqual([today.overdue, today.overdueDays], [false, null]);
    assert.equal(future.overdue, false);
    assert.deepEqual([missing.commitmentDate, missing.overdueDays], [null, null]);
    assert.ok(body.rows.indexOf(partial) < body.rows.indexOf(today));
    assert.ok(body.rows.indexOf(future) < body.rows.indexOf(missing));
  });

  test('legacy source-incomplete and over-fulfillment stay explicit without guessed quantities', async () => {
    const { body } = await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-28');
    const legacy = body.rows.find((row) => row.orderItemId === 'e6-soi-legacy');
    const over = body.rows.find((row) => row.orderItemId === 'e6-soi-over');
    assert.deepEqual([legacy.fulfilledQuantity, legacy.remainingQuantity, legacy.accuracyStatus, legacy.legacyReason], [0, 10, 'LIMITED', 'LEGACY_SOURCE_MISSING']);
    assert.ok(body.legacyUnattributed.count >= 1);
    assert.deepEqual([over.remainingQuantity, over.fulfillmentStatus, over.accuracyStatus, over.overFulfilledQuantity], [0, 'OVER_FULFILLED', 'INCONSISTENT', 0.25]);
  });
});

describe('V1.4-E6 purchase line fulfillment', () => {
  test('zero, partial and exact-line attribution', async () => {
    const { body } = await get('/api/reports/decision/purchase-outstanding?asOfDate=2026-09-28');
    const zero = body.rows.find((row) => row.orderItemId === 'e6-poi-zero');
    const partial = body.rows.find((row) => row.orderItemId === 'e6-poi-part');
    const line1 = body.rows.find((row) => row.orderItemId === 'e6-poi-same-1');
    const line2 = body.rows.find((row) => row.orderItemId === 'e6-poi-same-2');
    assert.deepEqual([zero.orderedQuantity, zero.receivedQuantity, zero.remainingQuantity, zero.fulfillmentStatus], [100, 0, 100, 'UNFULFILLED']);
    assert.deepEqual([partial.receivedQuantity, partial.remainingQuantity, partial.fulfillmentStatus], [60, 40, 'PARTIAL']);
    assert.equal(line1.receivedQuantity, 20);
    assert.equal(line2.receivedQuantity, 0);
  });

  test('fulfilled return does not reopen purchase obligation', async () => {
    const shown = (await get('/api/reports/decision/purchase-outstanding?includeFulfilled=true&asOfDate=2026-09-28')).body;
    const full = shown.rows.find((row) => row.orderItemId === 'e6-poi-full');
    assert.deepEqual([full.receivedQuantity, full.remainingQuantity, full.fulfillmentStatus], [100, 0, 'FULFILLED']);
  });

  test('legacy receipt line is not guessed', async () => {
    const { body } = await get('/api/reports/decision/purchase-outstanding?asOfDate=2026-09-28');
    const legacy = body.rows.find((row) => row.orderItemId === 'e6-poi-legacy');
    assert.deepEqual([legacy.receivedQuantity, legacy.remainingQuantity, legacy.accuracyStatus], [0, 10, 'LIMITED']);
  });
});

describe('V1.4-E6 contribution API, auth and export', () => {
  test('sales contribution drill-down returns exact documents and sums to the main row', async () => {
    const main = (await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-28')).body.rows.find((row) => row.orderItemId === 'e6-soi-part');
    const { response, body } = await get('/api/reports/sales-outstanding/lines/e6-soi-part/contributions');
    assert.equal(response.status, 200);
    assert.deepEqual(body.contributions.map((row) => row.sourceDocumentNumber), ['E6-SD-001', 'E6-SD-002']);
    assert.equal(body.contributions.reduce((sum, row) => sum + row.quantity, 0), main.executedQuantity);
  });

  test('purchase contribution drill-down returns exact receipt evidence', async () => {
    const { body } = await get('/api/reports/purchase-outstanding/lines/e6-poi-part/contributions');
    assert.deepEqual([body.executedQuantity, body.contributions[0].sourceDocumentNumber, body.contributions[0].businessDate], [60, 'E6-PR-001', '2026-09-02']);
  });

  test('legacy detail is informational and never fabricates a contribution', async () => {
    const { body } = await get('/api/reports/sales-outstanding/lines/e6-soi-legacy/contributions');
    assert.deepEqual(body.contributions, []);
    assert.equal(body.accuracyStatus, 'LIMITED');
    assert.equal(body.informationalItems[0].code, 'LEGACY_SOURCE_MISSING');
  });

  test('unsupported key, report mismatch, missing line and permission denial use safe errors', async () => {
    let result = await get('/api/reports/anything/lines/e6-soi-part/contributions');
    assert.deepEqual([result.response.status, result.body.code], [400, 'UNSUPPORTED_REPORT_KEY']);
    result = await get('/api/reports/purchase-outstanding/lines/e6-soi-part/contributions');
    assert.deepEqual([result.response.status, result.body.code], [404, 'REPORT_LINE_NOT_FOUND']);
    result = await get('/api/reports/sales-outstanding/lines/missing/contributions');
    assert.deepEqual([result.response.status, result.body.code], [404, 'REPORT_LINE_NOT_FOUND']);
    const salesToken = await login('sales', 'sales123');
    result = await get('/api/reports/sales-outstanding/lines/e6-soi-part/contributions', salesToken);
    assert.equal(result.response.status, 403);
  });

  test('screen and export share fulfilled visibility and line fields', async () => {
    let result = await get('/api/reports/decision/sales-outstanding/export?asOfDate=2026-09-28');
    assert.equal(result.response.status, 200);
    assert.doesNotMatch(result.body, /E6-SO-003/);
    assert.match(result.body, /销售订单,行号,客户编码,客户名称,产品编码,产品名称,订货数量,已出货,剩余数量/);
    result = await get('/api/reports/decision/sales-outstanding/export?includeFulfilled=true&asOfDate=2026-09-28');
    assert.match(result.body, /E6-SO-003/);
  });

  test('initial UI query is summary-only and contribution loading is explicitly lazy/mobile-safe', () => {
    const page = readFileSync(resolve(root, 'src/pages/decision-reports.jsx'), 'utf8');
    const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
    const p7Css = readFileSync(resolve(root, 'src/styles/v16-decision-reports.css'), 'utf8');
    // V1.6 P7 replaces ContributionDisclosure / ResponsiveBusinessList with the
    // dedicated FulfillmentContributionSheet + FulfillmentReportRowV16 grammar;
    // the contribution endpoint and '剩余数量' semantics are preserved.
    assert.match(page, /FulfillmentContributionSheet/);
    assert.match(page, /\/contributions`\)/);
    assert.match(page, /剩余数量/);
    assert.doesNotMatch(page, /ResponsiveBusinessList/);
    // The legacy desktop CSS hooks are preserved in src/styles.css for any
    // other consumer that still references ResponsiveBusinessList.
    assert.match(css, /@media \(max-width: 767\.98px\)[\s\S]*\.fulfillment-row--header \{ display: none; \}/);
    assert.match(css, /\.fulfillment-list \.responsive-business-list__desktop \{ display: none; \}/);
    // P7 introduces its own scoped CSS without relying on legacy desktop hooks.
    assert.match(p7Css, /\.v16-decision-reports__fulfillment-row/);
  });
});
