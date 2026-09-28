// V1.4-E5 — focused tests for:
//   C02 bounded business-object lookup (`/api/lookups/business-entities`)
//   BusinessEntitySelector internal state machine
//   C01 authoritative business dates for sales / purchase / inventory
//      reports (period-activity semantics, cross-month, legacy missing)
//   Date-range boundaries (inclusive start / inclusive end)
//   Unfulfilled report date basis (requested / expected delivery date,
//     with legacy missing values called out explicitly)
//   Export consistency (same filter / same date semantics / resolved
//     entity label echoed in the file header; no UUID leakage)
//
// These tests are deliberately split into small, focused suites so a
// future regression in any single area points to the failing slice
// without burying the cause.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { __ENTITY_REGISTRY, __USAGE_ENTITY_TYPES, __USAGE_PERMISSIONS } from './modules/lookups.js';

// ---------- shared helpers ----------

function startIsolatedServer() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e5-'));
  const database = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(database, { distDir: resolve('dist') }));
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolveListen({ tempDir, database, server, baseUrl });
    });
  });
}

async function login(baseUrl, username, password) {
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login for ${username} must succeed`);
  return (await res.json()).token;
}

async function seedBase(database) {
  // canonical master data so the lookup endpoint has rows to enumerate.
  database.prepare(`
    INSERT INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at)
    VALUES
      ('cust-001', 'E5-C001', '客户甲', '张一', '010-1', '北京', 1, '2026-01-01', '2026-01-01'),
      ('cust-002', 'E5-C002', '客户乙', '张二', '010-2', '上海', 1, '2026-01-01', '2026-01-01'),
      ('cust-003', 'E5-C003-LEGACY', '历史停用客户', '张三', '010-3', '广州', 0, '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO suppliers(id, code, name, contact, phone, address, active, created_at, updated_at)
    VALUES
      ('supp-001', 'E5-S001', '供应商甲', '李一', '020-1', '苏州', 1, '2026-01-01', '2026-01-01'),
      ('supp-002', 'E5-S002', '供应商乙', '李二', '020-2', '杭州', 0, '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO products(id, code, name, unit, price_cents, tracking_policy, active, created_at, updated_at)
    VALUES
      ('prod-001', 'E5-P001', '产品甲', '件', 1000, 'NONE', 1, '2026-01-01', '2026-01-01'),
      ('prod-002', 'E5-P002', '产品乙', '件', 2000, 'NONE', 1, '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at)
    VALUES
      ('wh-001', 'E5-W001', '主仓', '北京', '王一', 1, '2026-01-01', '2026-01-01'),
      ('wh-002', 'E5-W002', '辅仓', '上海', '王二', 1, '2026-01-01', '2026-01-01')
  `).run();
}

async function stopIsolatedServer(ctx) {
  ctx.server.closeAllConnections?.();
  await new Promise((resolveClose) => ctx.server.close(() => resolveClose()));
  ctx.database.close();
  rmSync(ctx.tempDir, { recursive: true, force: true });
}

// ============================================================
// C02 — bounded business-object lookup
// ============================================================

test('C02 lookup exposes only the four canonical entity types', () => {
  assert.deepEqual(Object.keys(__ENTITY_REGISTRY).sort(), ['CUSTOMER', 'PRODUCT', 'SUPPLIER', 'WAREHOUSE']);
});

test('C02 lookup rejects TRANSACTION_* usages and any unknown usage', () => {
  assert.deepEqual(Object.keys(__USAGE_PERMISSIONS).sort(), ['REPORT_INVENTORY', 'REPORT_PURCHASE', 'REPORT_SALES']);
  assert.deepEqual(__USAGE_ENTITY_TYPES.REPORT_SALES, ['CUSTOMER']);
  assert.deepEqual(__USAGE_ENTITY_TYPES.REPORT_PURCHASE, ['SUPPLIER']);
  assert.deepEqual(__USAGE_ENTITY_TYPES.REPORT_INVENTORY, ['PRODUCT', 'WAREHOUSE']);
});

test('C02 selector transports only a selected canonical id and clear removes the restriction', () => {
  const source = readFileSync(resolve('src/components/business-entity-selector.jsx'), 'utf8');
  assert.match(source, /onChange\(item\.id, item\)/, 'selection must transport the canonical entity id');
  assert.match(source, /onChange\('', null\)/, 'clear must remove the dimension restriction');
  assert.doesNotMatch(source, /onChange\(query/, 'free-text search must never become the report filter value');
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
});

test('C02 selector has an explicit narrow-screen search panel without horizontal overflow', () => {
  const css = readFileSync(resolve('src/styles.css'), 'utf8');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.business-entity-selector__panel\s*\{[^}]*position:fixed/);
  assert.match(css, /\.business-entity-selector__panel\s*\{[^}]*min-width:240px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?min-width:0/);
});

test.describe('C02 lookup HTTP roundtrip', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('401 without auth', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES');
    assert.equal(res.status, 401);
  });

  test('403 when actor lacks REPORT_VIEW', async () => {
    // WAREHOUSE has no REPORT_VIEW by default — login as warehouse and check.
    const token = await login(ctx.baseUrl, 'warehouse', 'warehouse123');
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 403);
  });

  test('customer code search returns matching active and inactive entities', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&q=E5-C', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 'CUSTOMER');
    assert.equal(data.usage, 'REPORT_SALES');
    const codes = data.items.map((row) => row.code).sort();
    assert.deepEqual(codes, ['E5-C001', 'E5-C002', 'E5-C003-LEGACY']);
    const inactive = data.items.find((row) => row.id === 'cust-003');
    assert.equal(inactive.active, 0);
    assert.match(inactive.label, /（已停用）$/);
  });

  test('customer name fragment search works case-insensitively', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&q=客户', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.items.length, 3);
  });

  test('supplier code/name search via REPORT_PURCHASE usage', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=SUPPLIER&usage=REPORT_PURCHASE&q=E5-S', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const codes = data.items.map((row) => row.code).sort();
    assert.deepEqual(codes, ['E5-S001', 'E5-S002']);
  });

  test('product code/name search via REPORT_INVENTORY usage', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=PRODUCT&usage=REPORT_INVENTORY&q=E5-P', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const codes = data.items.map((row) => row.code).sort();
    assert.deepEqual(codes, ['E5-P001', 'E5-P002']);
  });

  test('warehouse code/name search via REPORT_INVENTORY usage', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=WAREHOUSE&usage=REPORT_INVENTORY&q=E5-W', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const codes = data.items.map((row) => row.code).sort();
    assert.deepEqual(codes, ['E5-W001', 'E5-W002']);
  });

  test('historical hydration via selectedId surfaces inactive rows even past the limit', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&limit=1&selectedId=cust-003', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.items.length >= 1);
    const hydrated = data.items.find((row) => row.id === 'cust-003');
    assert.ok(hydrated, 'selectedId hydration must surface inactive historical entity');
    assert.equal(hydrated.active, 0);
  });

  test('unknown selectedId is not injected into lookup results', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&selectedId=does-not-exist', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.some((item) => item.id === 'does-not-exist'), false);
  });

  test('TRANSACTION_* usage is rejected with stable code', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=TRANSACTION_CREATE', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'BUSINESS_ENTITY_USAGE_UNSUPPORTED');
    assert.ok(data.resolution);
  });

  test('unknown entity type is rejected with stable code', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=BLAH&usage=REPORT_SALES', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'VALIDATION');
  });

  test('entity type cannot be enumerated through an unrelated report usage', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_INVENTORY', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'BUSINESS_ENTITY_TYPE_UNSUPPORTED');
  });

  test('limit is bounded and bounded result indicates hasMore', async () => {
    const res = await fetch(ctx.baseUrl + '/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&limit=2', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.items.length, 2);
    assert.equal(data.hasMore, true);
  });
});

// ============================================================
// C01 — sales statistics period-activity semantics
// ============================================================

test.describe('C01 sales statistics — period-activity semantics', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('order cross-month: order business date 2026-09-30, created 2026-10-01 belongs to September', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date, requested_delivery_date)
      VALUES ('so-cross', 'SO-CROSS-001', 'cust-001', 'APPROVED', 50000, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-30', '2026-10-15')
    `).run();
    const resSep = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-09-30&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataSep = await resSep.json();
    assert.equal(dataSep.summary.orderCount, 1, 'September must include the Sep 30 business order date');

    const resOct = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-10-01&dateTo=2026-10-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataOct = await resOct.json();
    assert.equal(dataOct.summary.orderCount, 0, 'October must not include the row merely because it was created in October');
  });

  test('shipment cross-month: October shipment belongs to October shipment metric even if order is September', async () => {
    // September order.
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date, requested_delivery_date)
      VALUES ('so-sep', 'SO-SEP-001', 'cust-001', 'APPROVED', 80000, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-15', '2026-10-10')
    `).run();
    // October shipment for that order.
    ctx.database.prepare(`
      INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
      VALUES ('sd-oct', 'SD-OCT-001', 'so-sep', 'cust-001', 'wh-001', 'user-admin', 'CONFIRMED', 80000, '2026-10-10', '', 'user-admin', '2026-10-10T09:00:00', '2026-10-10T09:00:00', '2026-10-10T11:00:00', 'user-admin')
    `).run();
    const resSep = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-09-15&dateTo=2026-09-15', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataSep = await resSep.json();
    assert.equal(dataSep.summary.deliveryCount, 0, 'September delivery metric must NOT include October shipment');
    assert.equal(dataSep.summary.orderCount, 1, 'September order metric must include the September order');

    const resOct = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-10-01&dateTo=2026-10-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataOct = await resOct.json();
    assert.equal(dataOct.summary.deliveryCount, 1, 'October delivery metric must include the October shipment');
  });

  test('delivery business date remains authoritative when confirmed_at is missing', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
      VALUES ('sd-nullconfirmed', 'SD-NULL-001', 'so-sep', 'cust-001', 'wh-001', 'user-admin', 'CONFIRMED', 80000, '2026-10-15', '', 'user-admin', '2026-10-15T09:00:00', '2026-10-15T09:00:00', NULL, NULL)
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-10-01&dateTo=2026-10-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.summary.deliveryCount, 2, 'both confirmed shipments use delivery_date, not confirmed_at');
    assert.equal(data.legacyMissing.deliveryWithoutDate, 0);
  });

  test('date boundaries are inclusive on both ends', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date)
      VALUES ('so-start', 'SO-START-001', 'cust-002', 'APPROVED', 1000, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-01')
    `).run();
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date)
      VALUES ('so-end', 'SO-END-001', 'cust-002', 'APPROVED', 1000, 'user-admin', '2026-10-01T23:00:00', '2026-10-01T23:00:00', '2026-09-30')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?dateFrom=2026-09-01&dateTo=2026-09-30&customerId=cust-002', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.summary.orderCount, 2, 'both start-day and end-day orders must be included');
  });

  test('customer filter accepts canonical id and echoes resolved code/name', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?customerId=cust-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.filters.customer.code, 'E5-C001');
    assert.equal(data.filters.customer.name, '客户甲');
    assert.equal(data.filters.customer.id, 'cust-001');
  });

  test('unknown customer id is rejected with BUSINESS_ENTITY_NOT_FOUND', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary?customerId=does-not-exist', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'BUSINESS_ENTITY_NOT_FOUND');
    assert.ok(data.resolution);
  });

  test('response includes dateBasis metadata describing which date each metric uses', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.ok(data.dateBasis);
    assert.match(data.dateBasis.order, /订单日期/);
    assert.match(data.dateBasis.shipment, /出货日期/);
    assert.match(data.dateBasis.return, /退货日期/);
  });
});

// ============================================================
// C01 — purchase statistics period-activity semantics
// ============================================================

test.describe('C01 purchase statistics — period-activity semantics', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('order cross-month: October PO does not leak into September order metric', async () => {
    ctx.database.prepare(`
      INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, creator_id, created_at, updated_at, order_date, expected_delivery_date)
      VALUES ('po-cross', 'PO-CROSS-001', 'supp-001', 'APPROVED', 60000, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-30', '2026-10-15')
    `).run();
    const resSep = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?dateFrom=2026-09-30&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataSep = await resSep.json();
    assert.equal(dataSep.summary.orderCount, 1);
    const resOct = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?dateFrom=2026-10-01&dateTo=2026-10-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataOct = await resOct.json();
    assert.equal(dataOct.summary.orderCount, 0);
  });

  test('receipt cross-month: October receipt belongs to October receipt metric even if PO is September', async () => {
    ctx.database.prepare(`
      INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, creator_id, created_at, updated_at, order_date, expected_delivery_date)
      VALUES ('po-sep', 'PO-SEP-001', 'supp-001', 'APPROVED', 60000, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-15', '2026-10-10')
    `).run();
    ctx.database.prepare(`
      INSERT INTO purchase_receipts(id, receipt_no, purchase_order_id, supplier_id, warehouse_id, handler_id, status, total_cents, receipt_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
      VALUES ('pr-oct', 'PR-OCT-001', 'po-sep', 'supp-001', 'wh-001', 'user-admin', 'CONFIRMED', 60000, '2026-10-10', '', 'user-admin', '2026-10-10T09:00:00', '2026-10-10T09:00:00', '2026-10-10T11:00:00', 'user-admin')
    `).run();
    const resSep = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?dateFrom=2026-09-15&dateTo=2026-09-15', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataSep = await resSep.json();
    assert.equal(dataSep.summary.orderCount, 1);
    assert.equal(dataSep.summary.receiptCount, 0, 'September receipt metric must NOT include October receipt');

    const resOct = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?dateFrom=2026-10-01&dateTo=2026-10-31', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataOct = await resOct.json();
    assert.equal(dataOct.summary.receiptCount, 1);
  });

  test('supplier filter accepts canonical id and echoes resolved code/name', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?supplierId=supp-002', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.filters.supplier.code, 'E5-S002');
    assert.equal(data.filters.supplier.name, '供应商乙');
    assert.equal(data.filters.supplier.active, 0, 'historical inactive supplier must be selectable');
  });

  test('unknown supplier id is rejected with BUSINESS_ENTITY_NOT_FOUND', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary?supplierId=does-not-exist', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'BUSINESS_ENTITY_NOT_FOUND');
  });

  test('response includes dateBasis metadata describing which date each metric uses', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-summary', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.ok(data.dateBasis);
    assert.match(data.dateBasis.order, /订单日期/);
    assert.match(data.dateBasis.receipt, /入库日期/);
    assert.match(data.dateBasis.return, /退货日期/);
  });
});

// ============================================================
// C01 — authoritative inventory transaction business_date
// ============================================================

test.describe('C01 inventory movements — authoritative transaction business date', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('authoritative transaction business_date, not created_at, controls the movement period', async () => {
    // The movement is created in October but carries a September business date.
    ctx.database.prepare(`
      INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
      VALUES ('sd-confirmsep', 'SD-CS-001', NULL, 'cust-001', 'wh-001', 'user-admin', 'CONFIRMED', 0, '2026-09-30', '', 'user-admin', '2026-10-15T09:00:00', '2026-10-15T09:00:00', '2026-10-15T11:00:00', 'user-admin')
    `).run();
    ctx.database.prepare(`
      INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, remark, creator_id, created_at, business_date)
      VALUES ('tx-sd-confirmsep', 'wh-001', 'prod-001', 5, 'OUT', 95, 'SALES_DELIVERY', 'sd-confirmsep', 'SD-CS-001', '', NULL, '2026-10-15T09:00:00', '2026-09-30')
    `).run();

    // Filtering by September must include this row even though created_at is in October.
    const resSep = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements?dateFrom=2026-09-01&dateTo=2026-09-30&productId=prod-001&warehouseId=wh-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(resSep.status, 200);
    const dataSep = await resSep.json();
    const tx = dataSep.rows.find((row) => row.id === 'tx-sd-confirmsep');
    assert.ok(tx, 'transaction must appear in September when filtered by business_date');
    assert.equal(tx.businessDate, '2026-09-30');
    assert.equal(tx.businessDateMissing, 0);

    // Filtering by October must NOT include this row.
    const resOct = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements?dateFrom=2026-10-01&dateTo=2026-10-31&productId=prod-001&warehouseId=wh-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const dataOct = await resOct.json();
    const txOct = dataOct.rows.find((row) => row.id === 'tx-sd-confirmsep');
    assert.equal(txOct, undefined, 'transaction must NOT appear in October when filtered by business_date');
  });

  test('legacy missing: inventory transaction without business_date is disclosed explicitly', async () => {
    ctx.database.prepare(`
      INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, remark, creator_id, created_at)
      VALUES ('tx-orphan', 'wh-001', 'prod-001', 1, 'IN', 1, 'INVENTORY_ADJUSTMENT', 'orphan-source', 'ADJ-ORPHAN', '', NULL, '2026-09-15T10:00:00')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements?productId=prod-001&warehouseId=wh-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const tx = data.rows.find((row) => row.id === 'tx-orphan');
    assert.ok(tx, 'orphan transaction must still be returned for audit');
    assert.equal(tx.businessDate, null);
    assert.equal(tx.businessDateMissing, 1);
    assert.ok(data.legacyMissing.withoutBusinessDate >= 1);
  });

  test('warehouse and product filters accept canonical id and echo resolved code/name', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements?productId=prod-002&warehouseId=wh-002', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.filters.product.code, 'E5-P002');
    assert.equal(data.filters.product.name, '产品乙');
    assert.equal(data.filters.warehouse.code, 'E5-W002');
    assert.equal(data.filters.warehouse.name, '辅仓');
  });

  test('inventory movements dateBasis metadata names the authoritative ledger column', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    assert.equal(data.dateBasis.column, 'inventory_transactions.business_date');
    assert.match(data.dateBasis.flow, /库存交易台账业务日期/);
  });
});

// ============================================================
// Unfulfilled report — commitment date shown as 业务日期缺失
// ============================================================

test.describe('E5 unfulfilled reports — authoritative commitment dates', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('sales-outstanding uses requested_delivery_date and inclusive boundaries', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date, requested_delivery_date)
      VALUES ('so-out', 'SO-OUT-001', 'cust-001', 'APPROVED', 12300, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-15', '2026-09-30')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-outstanding?dateFrom=2026-09-30&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const row = data.rows.find((item) => item.id === 'so-out');
    assert.equal(row.commitmentDateMissing, false);
    assert.equal(row.commitmentDate, '2026-09-30');
    assert.match(data.dateBasis.rangeFilter, /要求交期/);
  });

  test('purchase-outstanding uses expected_delivery_date and inclusive boundaries', async () => {
    ctx.database.prepare(`
      INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, creator_id, created_at, updated_at, order_date, expected_delivery_date)
      VALUES ('po-out', 'PO-OUT-001', 'supp-001', 'APPROVED', 12300, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-15', '2026-09-30')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/purchase-outstanding?dateFrom=2026-09-30&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    const data = await res.json();
    const row = data.rows.find((item) => item.id === 'po-out');
    assert.equal(row.commitmentDateMissing, false);
    assert.equal(row.commitmentDate, '2026-09-30');
    assert.match(data.dateBasis.rangeFilter, /预计到货日/);
  });

  test('legacy missing commitment date is explicit and excluded from precise ranges', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date)
      VALUES ('so-out-legacy', 'SO-OUT-LEGACY', 'cust-001', 'APPROVED', 100, 'user-admin', '2026-09-01', '2026-09-01', '2026-09-01')
    `).run();
    const allResponse = await fetch(ctx.baseUrl + '/api/reports/decision/sales-outstanding', { headers: { Authorization: 'Bearer ' + adminToken } });
    const allData = await allResponse.json();
    const legacy = allData.rows.find((item) => item.id === 'so-out-legacy');
    assert.equal(legacy.commitmentDate, null);
    assert.equal(legacy.commitmentDateMissing, true);
    const rangedResponse = await fetch(ctx.baseUrl + '/api/reports/decision/sales-outstanding?dateFrom=2026-09-01&dateTo=2026-09-30', { headers: { Authorization: 'Bearer ' + adminToken } });
    const rangedData = await rangedResponse.json();
    assert.equal(rangedData.rows.some((item) => item.id === 'so-out-legacy'), false);
  });
});

// ============================================================
// Export consistency
// ============================================================

test.describe('E5 export consistency — same filters, same semantics, resolved labels', () => {
  let ctx;
  let adminToken;

  test.before(async () => {
    ctx = await startIsolatedServer();
    await seedBase(ctx.database);
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date, requested_delivery_date)
      VALUES ('so-export', 'SO-EXP-001', 'cust-001', 'APPROVED', 99900, 'user-admin', '2026-10-01T09:00:00', '2026-10-01T09:00:00', '2026-09-15', '2026-09-30')
    `).run();
  });

  test.after(async () => {
    await stopIsolatedServer(ctx);
  });

  test('sales-summary export echoes resolved customer label and date basis', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary/export?customerId=cust-001&dateFrom=2026-09-01&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sales-summary\.csv"/);
    const body = await res.text();
    assert.match(body, /# 客户: E5-C001 · 客户甲/);
    assert.match(body, /# 期间: 2026-09-01 至 2026-09-30/);
    assert.match(body, /# 口径: 订单按 order_date/);
    assert.match(body, /订单,SO-EXP-001/);
  });

  test('sales-outstanding export marks commitment date as 业务日期缺失', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, creator_id, created_at, updated_at, order_date)
      VALUES ('so-out-exp', 'SO-OUT-EXP-001', 'cust-001', 'APPROVED', 12300, 'user-admin', '2026-09-15T09:00:00', '2026-09-15T09:00:00', '2026-09-15')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-outstanding/export?customerId=cust-001', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /业务日期缺失/);
    assert.match(body, /SO-OUT-EXP-001/);
  });

  test('inventory-movements export resolves product and warehouse labels and surfaces business date or legacy missing', async () => {
    ctx.database.prepare(`
      INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id, status, total_cents, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
      VALUES ('sd-exp', 'SD-EXP-001', 'so-export', 'cust-001', 'wh-001', 'user-admin', 'CONFIRMED', 99900, '2026-09-30', '', 'user-admin', '2026-09-30T09:00:00', '2026-09-30T09:00:00', '2026-09-30T11:00:00', 'user-admin')
    `).run();
    ctx.database.prepare(`
      INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, remark, creator_id, created_at, business_date)
      VALUES ('tx-exp', 'wh-001', 'prod-001', 5, 'OUT', 95, 'SALES_DELIVERY', 'sd-exp', 'SD-EXP-001', '', NULL, '2026-09-30T09:00:00', '2026-09-30')
    `).run();
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/inventory-movements/export?productId=prod-001&warehouseId=wh-001&dateFrom=2026-09-01&dateTo=2026-09-30', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /# 产品: E5-P001 · 产品甲/);
    assert.match(body, /# 仓库: E5-W001 · 主仓/);
    assert.match(body, /2026-09-30/);
    assert.match(body, /SD-EXP-001/);
  });

  test('export rejects unsupported format', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'VALIDATION');
  });

  test('export of unknown customer id returns BUSINESS_ENTITY_NOT_FOUND, not a CSV', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary/export?customerId=does-not-exist', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'BUSINESS_ENTITY_NOT_FOUND');
  });
});
