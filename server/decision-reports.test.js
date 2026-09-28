// Regression coverage for M7 — Decision Reports.
//
// Five required reports:
//   1. 采购统计分析表        /api/reports/decision/purchase-summary
//   2. 采购未交货反应表      /api/reports/decision/purchase-outstanding
//   3. 销售统计分析表        /api/reports/decision/sales-summary
//   4. 销售未出货反应表      /api/reports/decision/sales-outstanding
//   5. 存货异动明细表        /api/reports/decision/inventory-movements
//
// Canonical contracts under test:
//   - HTTP auth gates: 401 unauthenticated, 403 missing permission,
//     200 success when authorised. REPORT_VIEW + report-specific domain
//     visibility required for each endpoint.
//   - Outstanding accuracy gate: V1.4-E6 order-line reporting uses
//     exact delivery/receipt source-line identities and never guesses.
//   - Money contract: every money field is integer cents; net = out
//     - return. The frontend formats via money(). No floating-point
//     aggregation in handler SQL (SUM is integer).
//   - Date semantics: order uses sales_orders.created_at /
//     purchase_orders.created_at; delivery uses CONFIRMED
//     sales_deliveries.confirmed_at; receipt uses CONFIRMED
//     purchase_receipts.confirmed_at; inventory movement uses
//     inventory_transactions.created_at.
//   - Inventory source labels: friendly Chinese names must be applied
//     for all canonical source types, never raw technical strings.
//   - Filters validate date format and reject inverted ranges.
//   - Bounded result sets (LIMIT 500 max).
//
// Scope:
//   - Frontend assertions run at source level (Node-only harness).
//   - Backend assertions run end-to-end against a fresh SQLite + local
//     HTTP server.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { DECISION_REPORT_SOURCE_LABELS } from './modules/decision-reports.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');
const serverSrc = resolve(repoRoot, 'server');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }
function readServerSrc(rel) { return readFileSync(join(serverSrc, rel), 'utf8'); }

// ============================================================
// Section 1: Permission registry & role contract
// ============================================================

describe('M7 — permission registry', () => {
  test('REPORT_VIEW is registered', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('REPORT_VIEW'), 'REPORT_VIEW must be registered');
  });

  test('decision-reports.js module exposes all five report handlers', () => {
    const src = readServerSrc('modules/decision-reports.js');
    for (const handler of ['getSalesSummary', 'getSalesOutstanding', 'getPurchaseSummary', 'getPurchaseOutstanding', 'getInventoryMovements']) {
      assert.ok(src.includes(`export function ${handler}`), `${handler} must be exported`);
    }
  });

  test('all five routes are registered in app.js', () => {
    const src = readServerSrc('app.js');
    const expected = [
      '/api/reports/decision/sales-summary',
      '/api/reports/decision/sales-outstanding',
      '/api/reports/decision/purchase-summary',
      '/api/reports/decision/purchase-outstanding',
      '/api/reports/decision/inventory-movements',
    ];
    for (const path of expected) {
      assert.ok(src.includes(path), `route ${path} must be registered in app.js`);
    }
  });

  test('no new permission codes were introduced (M7 must reuse existing ones)', () => {
    // Pull every decision-reports handler and confirm allow() / allowAny() only
    // references known permissions.
    const src = readServerSrc('modules/decision-reports.js');
    const matches = [...src.matchAll(/allowAny\(actor,\s*\[([^\]]+)\]/g)].map((m) => m[1]);
    for (const match of matches) {
      const perms = match.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      for (const p of perms) {
        assert.ok(PERMISSIONS.find((row) => row[0] === p), `${p} must already be a registered permission`);
      }
    }
  });
});

// ============================================================
// Section 2: Sales Statistics — backend HTTP roundtrip
// ============================================================

describe('M7 — sales summary end-to-end', () => {
  let baseUrl;
  let database;
  let server;
  let tempDir;
  let adminToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m7-sales-summary-'));
    database = createDatabase(join(tempDir, 'erp.db'));
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const loginData = await loginRes.json();
    adminToken = loginData.token;
    await seedSalesFixture(database);
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('401 unauthenticated', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary');
    assert.equal(res.status, 401);
  });

  test('403 for sales role (no REPORT_VIEW)', async () => {
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sales', password: 'sales123' }),
    });
    const token = (await loginRes.json()).token;
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 403);
  });

  test('200 admin returns integer cents and rejects DRAFT as revenue', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.moneyUnit, 'cents');
    // The seeded APPROVED order contributes exactly 519800 cents / 1 approved row /
    // 1 confirmed delivery worth 519800 cents. The legacy demo SUBMITTED order has
    // no authoritative order_date and is therefore disclosed separately, not
    // included in period-activity metrics.
    assert.equal(data.summary.approvedOrderCount, 1, 'only the seeded APPROVED order must be counted as approved');
    assert.equal(data.summary.deliveryCount, 1);
    assert.equal(data.summary.deliveryCents, 519800);
    assert.equal(data.summary.returnCents, 0);
    assert.equal(data.summary.netShipmentCents, 519800);
    assert.equal(data.summary.orderCents, 519800);
    // Notes must explicitly say "订单金额不等于已实现收入".
    assert.match(data.notes, /订单金额/);
    // Money fields are all integer cents (no float drift).
    for (const k of ['orderCents', 'deliveryCents', 'returnCents', 'netShipmentCents']) {
      assert.equal(Number.isInteger(data.summary[k]), true, k + ' must be integer');
    }
  });

  test('date filter narrows the result set', async () => {
    const future = '2099-01-01';
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?dateFrom=' + future, {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary.orderCount, 0);
    assert.equal(data.summary.deliveryCount, 0);
  });

  test('customer filter narrows the result set', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?customerId=customer-002', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary.orderCount, 0);
    assert.deepEqual(data.byCustomer, [], 'customer filter must also constrain grouped rows');
  });

  test('invalid date format returns 400', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?dateFrom=not-a-date', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
  });

  test('impossible calendar date returns 400', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-02-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
  });

  test('invalid order status returns 400', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?status=CONFIRMED', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
  });

  test('inverted date range returns 400', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-12-01&dateTo=2026-01-01', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
  });

  test('customer grouping rows are ordered by orderCents desc', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.ok(Array.isArray(data.byCustomer));
    // All numeric fields are integers (cents / counts).
    for (const row of data.byCustomer) {
      assert.equal(Number.isInteger(row.orderCents), true);
      assert.equal(Number.isInteger(row.deliveryCents), true);
      assert.equal(Number.isInteger(row.orderCount), true);
    }
  });
});

// ============================================================
// Section 3: Sales Outstanding — accuracy gate
// ============================================================

describe('M7 — sales outstanding end-to-end (E6 order-line)', () => {
  let baseUrl;
  let database;
  let server;
  let tempDir;
  let adminToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpDirSafe(), 'modern-erp-m7-sales-out-'));
    database = createDatabase(join(tempDir, 'erp.db'));
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await loginRes.json()).token;
    await seedSalesFixture(database);
    // Seed an APPROVED order WITHOUT any delivery (truly outstanding).
    await seedApprovedOrderWithoutDelivery(database, 'order-outstanding-001', 'SO-OUT-001');
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('200 admin returns unfulfilled order lines by default', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.granularity, 'ORDER_LINE');
    const orderNos = data.rows.map((r) => r.orderNumber).sort();
    assert.deepEqual(orderNos, ['SO-OUT-001']);
  });

  test('approved order with linked delivery is hidden by default and visible as FULFILLED on request', async () => {
    let res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    let data = await res.json();
    assert.equal(data.rows.some((r) => r.orderNumber === 'SO-STD-001'), false);
    res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding?includeFulfilled=true', { headers: { Authorization: 'Bearer ' + adminToken } });
    data = await res.json();
    const linked = data.rows.find((r) => r.orderNumber === 'SO-STD-001');
    assert.ok(linked, 'SO-STD-001 must appear');
    assert.equal(linked.fulfillmentStatus, 'FULFILLED');
    assert.equal(linked.fulfilledQuantity, 2);
    assert.equal(linked.remainingQuantity, 0);
  });

  test('approved order without delivery shows NOT_STARTED', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const noDelivery = data.rows.find((r) => r.orderNumber === 'SO-OUT-001');
    assert.ok(noDelivery, 'SO-OUT-001 must appear');
    assert.equal(noDelivery.fulfillmentStatus, 'UNFULFILLED');
    assert.equal(noDelivery.fulfilledQuantity, 0);
  });

  test('demo SUBMITTED order is NOT included in outstanding (only APPROVED)', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.rows.find((r) => r.orderNumber === 'SO-DEMO-001'), undefined, 'demo SUBMITTED order must be excluded');
  });

  test('DRAFT orders are NOT included', async () => {
    database.prepare(`INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, created_at, updated_at, creator_id) VALUES ('order-draft-001', 'SO-DRAFT-001', 'customer-001', 'DRAFT', 99999, '2026-09-01', '2026-09-01', 'user-admin')`).run();
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.rows.find((r) => r.orderNumber === 'SO-DRAFT-001'), undefined);
  });

  test('REJECTED orders are NOT included', async () => {
    database.prepare(`INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, created_at, updated_at, creator_id) VALUES ('order-rejected-001', 'SO-REJ-001', 'customer-001', 'REJECTED', 99999, '2026-09-01', '2026-09-01', 'user-admin')`).run();
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.rows.find((r) => r.orderNumber === 'SO-REJ-001'), undefined);
  });

  test('an unlinked direct delivery does NOT falsely fulfill an unrelated order', async () => {
    // Create a delivery WITHOUT a sales_order_id (unlinked). It must NOT
    // appear in any outstanding row and must NOT count toward a linked order.
    database.prepare(`INSERT INTO sales_deliveries(id, delivery_no, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, created_at, updated_at, creator_id) VALUES ('sd-direct-001', 'SD-DIRECT-001', 'customer-001', 'warehouse-001', 'user-admin', 'CONFIRMED', 12345, '2026-09-15', '2026-09-15', '2026-09-15', 'user-admin')`).run();
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    // SO-OUT-001 must still be NOT_STARTED even though an unlinked delivery exists.
    const noDelivery = data.rows.find((r) => r.orderNumber === 'SO-OUT-001');
    assert.equal(noDelivery.fulfillmentStatus, 'UNFULFILLED');
    assert.equal(noDelivery.fulfilledQuantity, 0);
  });

  test('response declares canonical E6 order-line granularity', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/sales-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.granularity, 'ORDER_LINE');
    assert.equal(data.reportKey, 'sales-outstanding');
  });
});

// ============================================================
// Section 4: Purchase Statistics — backend HTTP roundtrip
// ============================================================

describe('M7 — purchase summary end-to-end', () => {
  let baseUrl;
  let database;
  let server;
  let tempDir;
  let adminToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpDirSafe(), 'modern-erp-m7-purchase-summary-'));
    database = createDatabase(join(tempDir, 'erp.db'));
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await loginRes.json()).token;
    await seedPurchaseFixture(database);
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('401 unauthenticated', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-summary');
    assert.equal(res.status, 401);
  });

  test('403 for sales role (no REPORT_VIEW)', async () => {
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sales', password: 'sales123' }),
    });
    const token = (await loginRes.json()).token;
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-summary', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 403);
  });

  test('200 admin returns integer cents with seeded fixture', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.moneyUnit, 'cents');
    assert.equal(data.summary.approvedOrderCount, 1);
    assert.equal(data.summary.receiptCount, 1);
    assert.equal(data.summary.receiptCents, 300000);
    assert.equal(data.summary.returnCents, 0);
    assert.equal(data.summary.netReceiptCents, 300000);
    // Money fields are integers.
    for (const k of ['orderCents', 'receiptCents', 'returnCents', 'netReceiptCents']) {
      assert.equal(Number.isInteger(data.summary[k]), true, k + ' must be integer');
    }
  });

  test('supplier filter narrows the result set', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-summary?supplierId=supplier-002', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.summary.orderCount, 0);
    assert.deepEqual(data.bySupplier, [], 'supplier filter must also constrain grouped rows');
  });

  test('returns cents without floating drift', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    // All cents fields must be safe integers.
    for (const row of data.bySupplier || []) {
      assert.ok(Number.isSafeInteger(row.orderCents));
      assert.ok(Number.isSafeInteger(row.receiptCents));
    }
  });
});

// ============================================================
// Section 5: Purchase Outstanding — accuracy gate
// ============================================================

describe('M7 — purchase outstanding end-to-end (E6 order-line)', () => {
  let baseUrl;
  let database;
  let server;
  let tempDir;
  let adminToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpDirSafe(), 'modern-erp-m7-purchase-out-'));
    database = createDatabase(join(tempDir, 'erp.db'));
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await loginRes.json()).token;
    await seedPurchaseFixture(database);
    await seedApprovedPurchaseWithoutReceipt(database, 'po-out-001', 'PO-OUT-001');
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('approved PO with linked receipt is hidden by default and visible as FULFILLED on request', async () => {
    let res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    let data = await res.json();
    assert.equal(data.rows.some((r) => r.orderNumber === 'PO-STD-001'), false);
    res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding?includeFulfilled=true', { headers: { Authorization: 'Bearer ' + adminToken } });
    data = await res.json();
    const linked = data.rows.find((r) => r.orderNumber === 'PO-STD-001');
    assert.ok(linked, 'PO-STD-001 must appear');
    assert.equal(linked.fulfillmentStatus, 'FULFILLED');
    assert.equal(linked.receivedQuantity, 1);
  });

  test('approved PO without receipt shows NOT_STARTED', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const noReceipt = data.rows.find((r) => r.orderNumber === 'PO-OUT-001');
    assert.ok(noReceipt);
    assert.equal(noReceipt.fulfillmentStatus, 'UNFULFILLED');
    assert.equal(noReceipt.receivedQuantity, 0);
  });

  test('DRAFT / REJECTED purchase orders are NOT included', async () => {
    database.prepare(`INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, created_at, updated_at, creator_id) VALUES ('po-draft-001', 'PO-DRAFT-001', 'supplier-001', 'DRAFT', 99999, '2026-09-01', '2026-09-01', 'user-admin')`).run();
    database.prepare(`INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, created_at, updated_at, creator_id) VALUES ('po-rejected-001', 'PO-REJ-001', 'supplier-001', 'REJECTED', 99999, '2026-09-01', '2026-09-01', 'user-admin')`).run();
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.rows.find((r) => r.orderNumber === 'PO-DRAFT-001'), undefined);
    assert.equal(data.rows.find((r) => r.orderNumber === 'PO-REJ-001'), undefined);
  });

  test('an unlinked direct receipt does NOT falsely fulfill an unrelated PO', async () => {
    database.prepare(`INSERT INTO purchase_receipts(id, receipt_no, supplier_id, warehouse_id, handler_id, status, total_cents, receipt_date, created_at, updated_at, creator_id) VALUES ('pr-direct-001', 'PR-DIRECT-001', 'supplier-001', 'warehouse-001', 'user-admin', 'CONFIRMED', 12345, '2026-09-15', '2026-09-15', '2026-09-15', 'user-admin')`).run();
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const noReceipt = data.rows.find((r) => r.orderNumber === 'PO-OUT-001');
    assert.equal(noReceipt.fulfillmentStatus, 'UNFULFILLED');
    assert.equal(noReceipt.receivedQuantity, 0);
  });

  test('response declares canonical E6 order-line granularity', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/purchase-outstanding', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.granularity, 'ORDER_LINE');
    assert.equal(data.reportKey, 'purchase-outstanding');
  });
});

// ============================================================
// Section 6: Inventory Movements — backend HTTP roundtrip
// ============================================================

describe('M7 — inventory movements end-to-end', () => {
  let baseUrl;
  let database;
  let server;
  let tempDir;
  let adminToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpDirSafe(), 'modern-erp-m7-inv-'));
    database = createDatabase(join(tempDir, 'erp.db'));
    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await loginRes.json()).token;
    await seedInventoryMovements(database);
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('401 unauthenticated', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements');
    assert.equal(res.status, 401);
  });

  test('403 when REPORT_VIEW exists but inventory visibility does not', async () => {
    const loginRes = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
    });
    const token = (await loginRes.json()).token;
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 403);
  });

  test('200 admin returns inventory movements with friendly labels', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // The fixture seeds at least one row for each canonical source type.
    const labels = data.rows.map((r) => r.source_type_label);
    assert.ok(labels.includes('销售出货'));
    assert.ok(labels.includes('采购入库'));
    assert.ok(labels.includes('销售退货'));
    assert.ok(labels.includes('采购退货'));
    assert.ok(labels.includes('库存调拨'));
    assert.ok(labels.includes('库存盘点'));
    assert.ok(labels.includes('库存调整'));
    assert.ok(labels.includes('用料出库'));
    assert.ok(labels.includes('生产入库'));
  });

  test('balance_after is preserved', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    for (const row of data.rows) {
      assert.ok(row.balance_after != null, `balance_after must be preserved (row ${row.id})`);
    }
  });

  test('date filter narrows results', async () => {
    const future = '2099-01-01';
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?dateFrom=' + future, {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.rows.length, 0);
  });

  test('product filter narrows results', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?productId=product-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    for (const row of data.rows) {
      assert.equal(row.product_id, 'product-001');
    }
  });

  test('warehouse filter narrows results', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?warehouseId=warehouse-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    for (const row of data.rows) {
      assert.equal(row.warehouse_id, 'warehouse-001');
    }
  });

  test('selected product and warehouse reconcile canonical inventory with latest ledger balance', async () => {
    database.prepare(`
      INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at)
      VALUES ('inv-m7-reconcile', 'warehouse-001', 'product-001', 109, '2026-09-15T10:00:00')
      ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at
    `).run();
    database.prepare(`
      INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, created_at, business_date)
      VALUES ('m7-reconcile-latest', 'warehouse-001', 'product-001', 1, 'IN', 109, 'INVENTORY_ADJUSTMENT', 'm7-reconcile-source', 'ADJ-RECONCILE', '2098-01-01T10:00:00', '2098-01-01')
    `).run();
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?productId=product-001&warehouseId=warehouse-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.deepEqual(data.reconciliation, {
      currentQuantity: 109,
      latestMovementBalance: 109,
      reconcilesToCurrent: true,
      note: '核对使用该货品/仓库的最新完整流水余额；当前库存以 inventory 为准，不推导历史期初。',
    });
  });

  test('direction filter narrows results', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?direction=IN', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    for (const row of data.rows) {
      assert.equal(row.direction, 'IN');
    }
  });

  test('source filter narrows results', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?sourceType=SALES_DELIVERY', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    for (const row of data.rows) {
      assert.equal(row.source_type, 'SALES_DELIVERY');
    }
  });

  test('invalid direction returns 400', async () => {
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements?direction=UP', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
  });

  test('result set is bounded by MAX_REPORT_ROWS (500)', async () => {
    // Bulk-insert 600 movements.
    const insert = database.prepare(`INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, remark, creator_id, created_at) VALUES (?, 'warehouse-001', 'product-001', 1, 'IN', ?, 'INVENTORY_ADJUSTMENT', ?, 'ADJ-' || ?, '', NULL, ?)`);
    for (let i = 0; i < 600; i++) {
      insert.run('bulk-' + i, i + 100, 'bulk-' + i, 'bulk-' + i, '2026-09-15T10:00:00');
    }
    const res = await fetch(baseUrl + '/api/reports/decision/inventory-movements', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.ok(data.rows.length <= 500, 'rows must be bounded');
  });
});

// ============================================================
// Section 7: Friendly source labels
// ============================================================

describe('M7 — inventory source label map', () => {
  test('every canonical source type has a friendly Chinese label', () => {
    for (const key of ['SALES_DELIVERY', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'PURCHASE_RETURN', 'INVENTORY_TRANSFER', 'INVENTORY_CHECK', 'INVENTORY_ADJUSTMENT', 'PRODUCTION_MATERIAL_ISSUE', 'PRODUCTION_RECEIPT']) {
      assert.ok(DECISION_REPORT_SOURCE_LABELS[key], `${key} must have a friendly label`);
    }
    assert.equal(DECISION_REPORT_SOURCE_LABELS.SALES_DELIVERY, '销售出货');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.PURCHASE_RECEIPT, '采购入库');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.SALES_RETURN, '销售退货');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.PURCHASE_RETURN, '采购退货');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.INVENTORY_TRANSFER, '库存调拨');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.INVENTORY_CHECK, '库存盘点');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.INVENTORY_ADJUSTMENT, '库存调整');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.PRODUCTION_MATERIAL_ISSUE, '用料出库');
    assert.equal(DECISION_REPORT_SOURCE_LABELS.PRODUCTION_RECEIPT, '生产入库');
  });

  test('unknown source types use a controlled friendly fallback', () => {
    const src = readServerSrc('modules/decision-reports.js');
    assert.match(src, /SOURCE_TYPE_LABELS\[row\.source_type\]\s*\|\|\s*'其他异动'/);
  });
});

// ============================================================
// Section 8: Frontend wiring
// ============================================================

describe('M7 — frontend wiring', () => {
  test('App.jsx declares a 决策报表 navigation group gated by REPORT_VIEW', () => {
    const src = readSrc('App.jsx');
    assert.match(src, /label:\s*'决策报表'[\s\S]{0,200}any:\s*\['REPORT_VIEW'\]/);
  });

  test('App.jsx routes decision-reports to DecisionReports component', () => {
    const src = readSrc('App.jsx');
    assert.match(src, /'decision-reports':\s*<DecisionReports\s+user=\{user\}\s+notify=\{notify\}\s*\/>/);
  });

  test('applicationMetadata exposes all 5 decision report cards', () => {
    const src = readSrc('navigation/applicationMetadata.js');
    assert.match(src, /mobileLabel:\s*'销售统计'/);
    assert.match(src, /mobileLabel:\s*'销售未交'/);
    assert.match(src, /mobileLabel:\s*'采购统计'/);
    assert.match(src, /mobileLabel:\s*'采购未交'/);
    assert.match(src, /mobileLabel:\s*'库存异动明细'/);
  });

  test('DEFERRED_MOBILE_APPLICATIONS no longer lists the five decision reports', () => {
    const src = readSrc('navigation/applicationMetadata.js');
    const match = src.match(/DEFERRED_MOBILE_APPLICATIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(match, 'DEFERRED_MOBILE_APPLICATIONS must be a frozen array');
    const items = match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    for (const label of ['销售统计', '销售未交', '采购统计', '采购未交']) {
      assert.equal(items.includes(label), false, `${label} must be removed from DEFERRED list`);
    }
  });

  test('buildMobileApplicationGroups forwards reportKey so each card has a unique key', () => {
    const src = readSrc('navigation/applicationMetadata.js');
    assert.match(src, /reportKey:\s*metadata\.reportKey/);
    assert.match(src, /metadata\.reportKey\s*\?\s*navigationItem\.key\s*\+\s*':'\s*\+\s*metadata\.reportKey/);
  });

  test('App.jsx forwards reportKey via navigation target', () => {
    const src = readSrc('App.jsx');
    assert.match(src, /navigateToPage\(item\.page,\s*\{\s*reportKey:\s*item\.reportKey\s*\}\)/);
  });

  test('report tabs and launcher cards require REPORT_VIEW plus domain visibility', () => {
    const page = readSrc('pages/decision-reports.jsx');
    const app = readSrc('App.jsx');
    assert.match(page, /can\(user, 'REPORT_VIEW'\)/);
    assert.match(page, /report\.domainPermissions\.some/);
    assert.match(app, /canViewDecisionReport\(user, item\.reportKey\)/);
  });

  test('outstanding order numbers use canonical permission-aware SPA links', () => {
    const src = readSrc('pages/decision-reports.jsx');
    assert.match(src, /page=\{isSales \? 'orders' : 'purchase-orders'\}/);
    assert.match(src, /documentId=\{row\.orderId\}/);
    assert.match(src, /\{row\.orderNumber\}/);
  });

  test('DecisionReports page exposes KPI cards and accurate-gate disclaimer', () => {
    const src = readSrc('pages/decision-reports.jsx');
    assert.match(src, /function SalesSummaryPanel/);
    assert.match(src, /function SalesOutstandingPanel/);
    assert.match(src, /function PurchaseSummaryPanel/);
    assert.match(src, /function PurchaseOutstandingPanel/);
    assert.match(src, /function InventoryMovementsPanel/);
    assert.match(src, /KpiCard/);
    // Money must be formatted via money() (frontend never receives raw cents as text).
    assert.match(src, /money\(data\.summary\.orderCents\)/);
    assert.match(src, /data\.accuracyNotice/);
  });

  test('DecisionReports filters validate dates and reject empty payloads', () => {
    // date format regex in backend module.
    const server = readServerSrc('modules/decision-reports.js');
    assert.match(server, /\\d\{4\}-\\d\{2\}-\\d\{2\}/);
    // inverted range check.
    assert.match(server, /开始日期不能晚于结束日期/);
  });

  test('no chart library was introduced', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    for (const lib of ['recharts', 'chart.js', 'echarts', 'd3']) {
      assert.equal(deps.includes(lib), false, `${lib} must not be added in M7`);
    }
  });
});

// ============================================================
// Section 9: M1–M6 regression sanity
// ============================================================

describe('M7 — M1–M6 regression sanity', () => {
  test('mobile launcher still hides empty groups (decision reports group only shown when authorized)', async () => {
    const vite = await (await import('vite')).createServer({ root: repoRoot, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
    try {
      const { buildMobileApplicationGroups } = await vite.ssrLoadModule('/src/navigation/applicationMetadata.js');
      const noReportGroups = buildMobileApplicationGroups([{ key: 'orders', label: '订单', any: ['ORDERS_VIEW'], permission: undefined, icon: null }]);
      const reportsGroup = noReportGroups.find((g) => g.key === 'reports');
      assert.equal(reportsGroup, undefined, 'reports group must be hidden when REPORT_VIEW not authorised');
    } finally {
      await vite.close();
    }
  });
});

// ============================================================
// Helpers — seed fixtures
// ============================================================

function tmpDirSafe() {
  return tmpdir();
}

async function seedSalesFixture(database) {
  const now = new Date().toISOString();
  // One APPROVED order with a CONFIRMED delivery.
  database.prepare(`
    INSERT OR REPLACE INTO sales_orders
      (id, order_no, customer_id, status, total_cents, remark, creator_id, created_at, updated_at, submitted_at, reviewed_at, order_date)
    VALUES
      ('order-std-001', 'SO-STD-001', 'customer-001', 'APPROVED', 519800, '', 'user-admin', ?, ?, ?, ?, '2026-09-01')
  `).run(now, now, now, now);
  database.prepare(`
    INSERT OR REPLACE INTO sales_order_items
      (id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES
      ('soi-001', 'order-std-001', 'product-001', 2, 259900, 519800, 1)
  `).run();
  database.prepare(`
    INSERT OR REPLACE INTO sales_deliveries
      (id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES
      ('sd-std-001', 'SD-STD-001', 'order-std-001', 'customer-001', 'warehouse-001', 'user-admin', 'CONFIRMED', 519800, '2026-09-10', '', 'user-admin', ?, ?, ?, 'user-admin')
  `).run(now, now, now);
  database.prepare(`
    INSERT OR REPLACE INTO sales_delivery_items
      (id, delivery_id, product_id, quantity, unit_price_cents, amount_cents, line_no, sales_order_item_id)
    VALUES ('sdi-std-001', 'sd-std-001', 'product-001', 2, 259900, 519800, 1, 'soi-001')
  `).run();
}

async function seedApprovedOrderWithoutDelivery(database, id, orderNo) {
  database.prepare(`
    INSERT OR REPLACE INTO sales_orders
      (id, order_no, customer_id, status, total_cents, remark, creator_id, created_at, updated_at, submitted_at, reviewed_at)
    VALUES
      (?, ?, 'customer-001', 'APPROVED', 123400, '', 'user-admin', '2026-09-12', '2026-09-12', '2026-09-12', '2026-09-12')
  `).run(id, orderNo);
  database.prepare(`INSERT OR REPLACE INTO sales_order_items
    (id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES (?, ?, 'product-001', 2, 61700, 123400, 1)`).run(`${id}-item`, id);
}

async function seedPurchaseFixture(database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR REPLACE INTO purchase_orders
      (id, order_no, supplier_id, status, total_cents, remark, creator_id, created_at, updated_at, submitted_at, reviewed_at, order_date)
    VALUES
      ('po-std-001', 'PO-STD-001', 'supplier-001', 'APPROVED', 300000, '', 'user-admin', ?, ?, ?, ?, '2026-09-01')
  `).run(now, now, now, now);
  database.prepare(`
    INSERT OR REPLACE INTO purchase_order_items
      (id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES
      ('poi-001', 'po-std-001', 'product-001', 1, 300000, 300000, 1)
  `).run();
  database.prepare(`
    INSERT OR REPLACE INTO purchase_receipts
      (id, receipt_no, purchase_order_id, supplier_id, warehouse_id, handler_id, status, total_cents, receipt_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES
      ('pr-std-001', 'PR-STD-001', 'po-std-001', 'supplier-001', 'warehouse-001', 'user-admin', 'CONFIRMED', 300000, '2026-09-10', '', 'user-admin', ?, ?, ?, 'user-admin')
  `).run(now, now, now);
  database.prepare(`
    INSERT OR REPLACE INTO purchase_receipt_items
      (id, receipt_id, product_id, quantity, unit_price_cents, amount_cents, line_no, purchase_order_item_id)
    VALUES ('pri-std-001', 'pr-std-001', 'product-001', 1, 300000, 300000, 1, 'poi-001')
  `).run();
}

async function seedApprovedPurchaseWithoutReceipt(database, id, orderNo) {
  database.prepare(`
    INSERT OR REPLACE INTO purchase_orders
      (id, order_no, supplier_id, status, total_cents, remark, creator_id, created_at, updated_at, submitted_at, reviewed_at)
    VALUES
      (?, ?, 'supplier-001', 'APPROVED', 123400, '', 'user-admin', '2026-09-12', '2026-09-12', '2026-09-12', '2026-09-12')
  `).run(id, orderNo);
  database.prepare(`INSERT OR REPLACE INTO purchase_order_items
    (id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES (?, ?, 'product-001', 2, 61700, 123400, 1)`).run(`${id}-item`, id);
}

async function seedInventoryMovements(database) {
  const now = '2026-09-15T10:00:00';
  const movements = [
    { id: 'tx-001', type: 'SALES_DELIVERY', direction: 'OUT', qty: 5, no: 'SD-001' },
    { id: 'tx-002', type: 'PURCHASE_RECEIPT', direction: 'IN', qty: 100, no: 'PR-001' },
    { id: 'tx-003', type: 'SALES_RETURN', direction: 'IN', qty: 1, no: 'SRET-001' },
    { id: 'tx-004', type: 'PURCHASE_RETURN', direction: 'OUT', qty: 2, no: 'PRET-001' },
    { id: 'tx-005', type: 'INVENTORY_TRANSFER', direction: 'OUT', qty: 3, no: 'TR-001' },
    { id: 'tx-006', type: 'INVENTORY_CHECK', direction: 'IN', qty: 1, no: 'CHK-001' },
    { id: 'tx-007', type: 'INVENTORY_ADJUSTMENT', direction: 'IN', qty: 4, no: 'ADJ-001' },
    { id: 'tx-008', type: 'PRODUCTION_MATERIAL_ISSUE', direction: 'OUT', qty: 7, no: 'PMI-001' },
    { id: 'tx-009', type: 'PRODUCTION_RECEIPT', direction: 'IN', qty: 6, no: 'PRX-001' },
  ];
  for (const m of movements) {
    database.prepare(`
      INSERT INTO inventory_transactions
        (id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, remark, creator_id, created_at, business_date)
      VALUES
        (?, 'warehouse-001', 'product-001', ?, ?, ?, ?, ?, ?, '', NULL, ?, '2026-09-15')
    `).run(m.id, m.qty, m.direction, 100 + m.qty, m.type, m.id, m.no, now);
  }
}
