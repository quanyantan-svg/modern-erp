// SC78 / SC80 / SC81 — Sales Reporting closure.
//
// Requirement: docs/requirements/sales-customer/01-domain-closure.md
//   §34.3.16  SC78 Sales Execution Reports (Quotation / SO / Delivery
//             Notice / Sales Delivery / Return / Replacement)
//             SC80 Sales Gross Profit (与 Inventory / Finance valuation
//             evidence 集成)
//             SC81 Sales Ranking (customer / material / salesperson /
//             sales group)
//   "Reporting 必须消费 canonical facts；不允许 reporting shadow ledger."
//
// Audit ledger: docs/audits/sales-customer-capability-audit-20261113.md
//   §3.1 CAP-27 · SC-DEF-04 (SC80 零实现) · SC-DEF-05 (SC81 零实现)
//   · SC-DEF-06 (SC78 只覆盖 6 类单据中的 3 类)
//
// Contract under test:
//   * SC78 — the sales summary report carries execution evidence for all
//     six document families. The pre-existing `summary` block keeps its
//     original fields and semantics; the new `execution` block is purely
//     additive.
//   * SC80 — gross profit = revenue - cost, both in integer cents.
//     Revenue comes from the canonical revenue documents; cost comes from
//     the canonical Inventory / Finance valuation evidence
//     (inventory_valuation_movements). There is no second valuation engine
//     and no reporting-side ledger.
//   * SC81 — ranking over four dimensions (customer / material /
//     salesperson / sales group) by gross profit.
//   * Money is always integer cents; no floats.
//   * 401 unauthenticated / 403 missing permission / 400 invalid
//     dimension or unknown report view.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

const DAY = '2026-09-10';
const LATER_DAY = '2026-09-20';
// The reporting window that contains every "in-window" fixture document.
const WINDOW_FROM = '2026-09-01';
const WINDOW_TO = '2026-09-15';
// The gross-profit / ranking reports are exercised inside the same window
// so the late fixture documents never leak into the assertions.
const IN_WINDOW = `dateFrom=${WINDOW_FROM}&dateTo=${WINDOW_TO}`;

function startIsolatedServer() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-reporting-'));
  const database = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(database, { distDir: resolve('dist') }));
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      resolveListen({
        tempDir,
        database,
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function stopIsolatedServer(ctx) {
  ctx.server.closeAllConnections?.();
  await new Promise((resolveClose) => ctx.server.close(() => resolveClose()));
  ctx.database.close();
  rmSync(ctx.tempDir, { recursive: true, force: true });
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

async function getJson(baseUrl, path, token) {
  const res = await fetch(baseUrl + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ------------------------------------------------------------------
// Fixture — canonical facts only.
//
// Nothing here writes a report-side ledger or a cached balance: every row
// is a canonical business document or a canonical valuation movement.
// ------------------------------------------------------------------

function seedReportingFixture(db) {
  const now = '2026-09-01T00:00:00.000Z';

  // --- Sales organisation (canonical wave-1 master data) ---
  db.prepare(`INSERT OR IGNORE INTO sales_groups(id, group_code, name, description, active, created_at, updated_at)
    VALUES('sg-001', 'SG-001', '华东销售组', NULL, 1, ?, ?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO salesperson_profiles(id, salesperson_code, user_id, name, active, created_at, updated_at)
    VALUES('sp-001', 'SP-001', 'user-sales', '销售员甲', 1, ?, ?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO salesperson_profiles(id, salesperson_code, user_id, name, active, created_at, updated_at)
    VALUES('sp-002', 'SP-002', 'user-admin', '销售员乙', 1, ?, ?)`).run(now, now);

  // --- Orders ---
  // ord-normal: a normal revenue-bearing order, customer-001, salesperson sp-001.
  db.prepare(`INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id,
      created_at, updated_at, submitted_at, reviewed_at, order_date, salesperson_id, sales_group_id)
    VALUES('ord-normal', 'SO-NORMAL-001', 'customer-001', 'APPROVED', 100000, '', 'user-admin', ?, ?, ?, ?, ?, 'sp-001', 'sg-001')`)
    .run(now, now, now, now, DAY);
  db.prepare(`INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no, is_gift_line)
    VALUES('oi-normal', 'ord-normal', 'product-001', 2, 50000, 100000, 1, 0)`).run();
  // ord-gift: a gift line — zero selling price, zero revenue, but the
  // inventory is still consumed and the COGS is still posted.
  db.prepare(`INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id,
      created_at, updated_at, submitted_at, reviewed_at, order_date, salesperson_id, sales_group_id)
    VALUES('ord-gift', 'SO-GIFT-001', 'customer-001', 'APPROVED', 0, '', 'user-admin', ?, ?, ?, ?, ?, 'sp-001', 'sg-001')`)
    .run(now, now, now, now, DAY);
  db.prepare(`INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no, is_gift_line)
    VALUES('oi-gift', 'ord-gift', 'product-001', 1, 0, 0, 1, 1)`).run();
  // ord-other: a second customer / second salesperson / second product.
  db.prepare(`INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id,
      created_at, updated_at, submitted_at, reviewed_at, order_date, salesperson_id, sales_group_id)
    VALUES('ord-other', 'SO-OTHER-001', 'customer-002', 'APPROVED', 40000, '', 'user-admin', ?, ?, ?, ?, ?, 'sp-002', 'sg-001')`)
    .run(now, now, now, now, DAY);
  db.prepare(`INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no, is_gift_line)
    VALUES('oi-other', 'ord-other', 'product-002', 1, 40000, 40000, 1, 0)`).run();

  // --- Deliveries ---
  // del-normal: revenue 100000, COGS 60000 (valuation movement below).
  db.prepare(`INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id,
      total_cents, status, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES('del-normal', 'SD-NORMAL-001', 'ord-normal', 'customer-001', 'warehouse-001', 'user-admin',
      100000, 'CONFIRMED', ?, '', 'user-admin', ?, ?, ?, 'user-admin')`).run(DAY, now, now, now);
  db.prepare(`INSERT INTO sales_delivery_items(id, delivery_id, product_id, quantity, unit_price_cents, amount_cents, line_no, sales_order_item_id)
    VALUES('di-normal', 'del-normal', 'product-001', 2, 50000, 100000, 1, 'oi-normal')`).run();
  // del-gift: revenue 0, COGS 20000 — the gift still costs money.
  db.prepare(`INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id,
      total_cents, status, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES('del-gift', 'SD-GIFT-001', 'ord-gift', 'customer-001', 'warehouse-001', 'user-admin',
      0, 'CONFIRMED', ?, '', 'user-admin', ?, ?, ?, 'user-admin')`).run(DAY, now, now, now);
  db.prepare(`INSERT INTO sales_delivery_items(id, delivery_id, product_id, quantity, unit_price_cents, amount_cents, line_no, sales_order_item_id)
    VALUES('di-gift', 'del-gift', 'product-001', 1, 0, 0, 1, 'oi-gift')`).run();
  // del-other: revenue 40000, COGS 50000 (deliberately loss-making).
  db.prepare(`INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id,
      total_cents, status, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES('del-other', 'SD-OTHER-001', 'ord-other', 'customer-002', 'warehouse-001', 'user-admin',
      40000, 'CONFIRMED', ?, '', 'user-admin', ?, ?, ?, 'user-admin')`).run(DAY, now, now, now);
  db.prepare(`INSERT INTO sales_delivery_items(id, delivery_id, product_id, quantity, unit_price_cents, amount_cents, line_no, sales_order_item_id)
    VALUES('di-other', 'del-other', 'product-002', 1, 40000, 40000, 1, 'oi-other')`).run();
  // del-outside: a delivery outside every reporting window — the date
  // filter must exclude it.
  db.prepare(`INSERT INTO sales_deliveries(id, delivery_no, sales_order_id, customer_id, warehouse_id, handler_id,
      total_cents, status, delivery_date, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES('del-outside', 'SD-OUTSIDE-001', NULL, 'customer-001', 'warehouse-001', 'user-admin',
      777000, 'CONFIRMED', ?, '', 'user-admin', ?, ?, ?, 'user-admin')`).run(LATER_DAY, now, now, now);
  db.prepare(`INSERT INTO sales_delivery_items(id, delivery_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES('di-outside', 'del-outside', 'product-001', 1, 777000, 777000, 1)`).run();

  // --- Canonical valuation evidence (Inventory / Finance) ---
  // A COGS issue movement stores a NEGATIVE value_delta_cents (stock value
  // leaves the balance).
  db.prepare(`INSERT INTO inventory_valuation_movements(id, business_date, product_id, warehouse_id, lot_id, serial_id,
      quantity_delta, value_delta_cents, unit_cost_cents, valuation_basis, movement_type, source_type, source_id,
      source_item_id, inventory_transaction_id, production_order_id, reversal_of_id, status, created_at)
    VALUES('vm-normal', ?, 'product-001', 'warehouse-001', NULL, NULL, -2, -60000, 30000, 'MOVING_AVERAGE',
      'SALES_DELIVERY_COGS', 'SALES_DELIVERY', 'del-normal', 'di-normal', NULL, NULL, NULL, 'POSTED', ?)`).run(DAY, now);
  db.prepare(`INSERT INTO inventory_valuation_movements(id, business_date, product_id, warehouse_id, lot_id, serial_id,
      quantity_delta, value_delta_cents, unit_cost_cents, valuation_basis, movement_type, source_type, source_id,
      source_item_id, inventory_transaction_id, production_order_id, reversal_of_id, status, created_at)
    VALUES('vm-gift', ?, 'product-001', 'warehouse-001', NULL, NULL, -1, -20000, 20000, 'MOVING_AVERAGE',
      'SALES_DELIVERY_COGS', 'SALES_DELIVERY', 'del-gift', 'di-gift', NULL, NULL, NULL, 'POSTED', ?)`).run(DAY, now);
  db.prepare(`INSERT INTO inventory_valuation_movements(id, business_date, product_id, warehouse_id, lot_id, serial_id,
      quantity_delta, value_delta_cents, unit_cost_cents, valuation_basis, movement_type, source_type, source_id,
      source_item_id, inventory_transaction_id, production_order_id, reversal_of_id, status, created_at)
    VALUES('vm-other', ?, 'product-002', 'warehouse-001', NULL, NULL, -1, -50000, 50000, 'MOVING_AVERAGE',
      'SALES_DELIVERY_COGS', 'SALES_DELIVERY', 'del-other', 'di-other', NULL, NULL, NULL, 'POSTED', ?)`).run(DAY, now);

  // --- Returns ---
  // ret-normal: a confirmed sales return that reverses 30000 revenue and
  // 15000 of cost.
  db.prepare(`INSERT INTO return_orders(id, return_no, source_type, source_id, customer_id, supplier_id, warehouse_id,
      total_cents, status, return_date, reason, remark, creator_id, created_at, updated_at, confirmed_at, confirmed_by)
    VALUES('ret-normal', 'SRET-001', 'SALES', 'del-normal', 'customer-001', NULL, 'warehouse-001',
      30000, 'CONFIRMED', ?, '质量原因', '', 'user-admin', ?, ?, ?, 'user-admin')`).run(DAY, now, now, now);
  db.prepare(`INSERT INTO return_order_items(id, return_id, product_id, quantity, unit_price_cents, amount_cents, line_no, delivery_item_id)
    VALUES('ri-normal', 'ret-normal', 'product-001', 1, 30000, 30000, 1, 'di-normal')`).run();
  // A COGS reversal movement stores a POSITIVE value_delta_cents (stock
  // value comes back).
  db.prepare(`INSERT INTO inventory_valuation_movements(id, business_date, product_id, warehouse_id, lot_id, serial_id,
      quantity_delta, value_delta_cents, unit_cost_cents, valuation_basis, movement_type, source_type, source_id,
      source_item_id, inventory_transaction_id, production_order_id, reversal_of_id, status, created_at)
    VALUES('vm-ret', ?, 'product-001', 'warehouse-001', NULL, NULL, 1, 15000, 15000, 'MOVING_AVERAGE',
      'SALES_RETURN_COGS_REVERSAL', 'SALES_RETURN', 'ret-normal', 'ri-normal', NULL, NULL, NULL, 'POSTED', ?)`).run(DAY, now);

  // --- Service fulfillment (pure service: revenue, no COGS at all) ---
  // The canonical CONFIRMED-state CHECK requires the DIRECT_BUSINESS_OPEN_ITEM
  // recognition mode together with its open item / source identity. The
  // recognition amount is what the gross-profit report reads as service
  // revenue; no inventory movement and no COGS movement is ever created for
  // a pure service line.
  db.prepare(`INSERT INTO service_fulfillments(id, fulfillment_no, sales_order_id, sales_order_item_id, product_id,
      customer_id, sales_group_id, confirmation_qty_micros, unit_price_cents, recognition_amount_cents,
      business_date, confirmation_state, finance_recognition_mode, finance_open_item_id, finance_source_type,
      finance_source_id, confirmed_at, confirmed_by, cancelled_at, cancelled_by, version, created_at, updated_at,
      created_by, updated_by)
    VALUES('sf-service', 'SF-001', 'ord-normal', 'oi-normal', 'product-003', 'customer-001', 'sg-001',
      1000000, 25000, 25000, ?, 'CONFIRMED', 'DIRECT_BUSINESS_OPEN_ITEM', 'ao-sf-001', 'SERVICE_FULFILLMENT',
      'sf-service', ?, 'user-admin', NULL, NULL, 1, ?, ?, 'user-admin', 'user-admin')`)
    .run(DAY, now, now, now);

  // --- SC78: the three execution families that were missing ---
  db.prepare(`INSERT INTO sales_quotations(id, quotation_no, customer_id, salesperson_id, sales_group_id, status,
      currency_code, valid_from, valid_to, payment_terms, payment_terms_days, total_cents, converted_total_cents,
      remark, close_reason, creator_id, reviewer_id, created_at, updated_at, published_at, closed_at)
    VALUES('quo-001', 'QT-001', 'customer-001', 'sp-001', 'sg-001', 'EFFECTIVE', 'CNY', ?, ?, '', 0,
      90000, 0, '', '', 'user-admin', 'user-admin', ?, ?, ?, NULL)`).run(DAY, DAY, now, now, now);
  // A DRAFT quotation is not an executed document and must not be counted.
  db.prepare(`INSERT INTO sales_quotations(id, quotation_no, customer_id, salesperson_id, sales_group_id, status,
      currency_code, valid_from, valid_to, payment_terms, payment_terms_days, total_cents, converted_total_cents,
      remark, close_reason, creator_id, reviewer_id, created_at, updated_at, published_at, closed_at)
    VALUES('quo-draft', 'QT-DRAFT-001', 'customer-001', 'sp-001', 'sg-001', 'DRAFT', 'CNY', ?, ?, '', 0,
      500000, 0, '', '', 'user-admin', 'user-admin', ?, ?, ?, NULL)`).run(DAY, DAY, now, now, now);
  // A quotation outside the reporting window must be excluded by the date filter.
  db.prepare(`INSERT INTO sales_quotations(id, quotation_no, customer_id, salesperson_id, sales_group_id, status,
      currency_code, valid_from, valid_to, payment_terms, payment_terms_days, total_cents, converted_total_cents,
      remark, close_reason, creator_id, reviewer_id, created_at, updated_at, published_at, closed_at)
    VALUES('quo-late', 'QT-LATE-001', 'customer-001', 'sp-001', 'sg-001', 'EFFECTIVE', 'CNY', ?, ?, '', 0,
      600000, 0, '', '', 'user-admin', 'user-admin', ?, ?, ?, NULL)`).run(LATER_DAY, LATER_DAY, now, now, now);

  db.prepare(`INSERT INTO delivery_notices(id, notice_no, sales_order_id, state, warehouse_id, ship_to_snapshot_json,
      planned_delivery_date, business_date, customer_id, customer_snapshot_json, close_reason, creator_id, created_at,
      updated_at, confirmed_at, confirmed_by, cancelled_at, cancelled_by)
    VALUES('dn-001', 'DN-001', 'ord-normal', 'CONFIRMED', 'warehouse-001', '{}', ?, ?, 'customer-001', '{}', '',
      'user-admin', ?, ?, ?, 'user-admin', NULL, NULL)`).run(DAY, DAY, now, now, now);
  // A DRAFT notice is not an executed document.
  db.prepare(`INSERT INTO delivery_notices(id, notice_no, sales_order_id, state, warehouse_id, ship_to_snapshot_json,
      planned_delivery_date, business_date, customer_id, customer_snapshot_json, close_reason, creator_id, created_at,
      updated_at, confirmed_at, confirmed_by, cancelled_at, cancelled_by)
    VALUES('dn-draft', 'DN-DRAFT-001', 'ord-normal', 'DRAFT', 'warehouse-001', '{}', ?, ?, 'customer-001', '{}', '',
      'user-admin', ?, ?, NULL, NULL, NULL, NULL)`).run(DAY, DAY, now, now);

  db.prepare(`INSERT INTO sales_order_replacements(id, replacement_no, source_return_id, cancellation_state,
      created_at, creator_id, closed_at, closed_by)
    VALUES('rep-001', 'REP-001', 'ret-normal', 'ACTIVE', ?, 'user-admin', NULL, NULL)`).run(now);
  db.prepare(`INSERT INTO sales_order_replacement_lines(id, replacement_id, line_no, source_return_item_id,
      replacement_material_id, replacement_quantity, replacement_uom_code, business_date, created_at)
    VALUES('rl-001', 'rep-001', 1, 'ri-normal', 'product-001', 1, '台', ?, ?)`).run(DAY, now);
}

// ============================================================
// SC78 — Sales Execution Reports
// ============================================================

describe('SC78 — sales execution reports cover all six document families', () => {
  let ctx;
  let adminToken;

  before(async () => {
    ctx = await startIsolatedServer();
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
    seedReportingFixture(ctx.database);
  });

  after(async () => { await stopIsolatedServer(ctx); });

  test('the execution block carries all six document families', async () => {
    const { status, data } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary', adminToken);
    assert.equal(status, 200);
    assert.ok(data.execution, 'execution block must exist');
    assert.deepEqual(
      data.execution.documentFamilies,
      ['quotation', 'salesOrder', 'deliveryNotice', 'salesDelivery', 'return', 'replacement'],
    );
    assert.equal(data.execution.families.length, 6);
  });

  test('each family carries the canonical document count', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?dateFrom=${WINDOW_FROM}&dateTo=${WINDOW_TO}`, adminToken);
    const byKey = Object.fromEntries(data.execution.families.map((family) => [family.key, family]));
    // One EFFECTIVE quotation in the window (the DRAFT one and the late one are excluded).
    assert.equal(byKey.quotation.documentCount, 1);
    assert.equal(byKey.quotation.amountCents, 90000);
    // Three orders are in the window (ord-normal, ord-gift, ord-other).
    assert.equal(byKey.salesOrder.documentCount, 3);
    // One CONFIRMED delivery notice (the DRAFT one is excluded).
    assert.equal(byKey.deliveryNotice.documentCount, 1);
    // Three CONFIRMED deliveries in the window (del-outside is on LATER_DAY).
    assert.equal(byKey.salesDelivery.documentCount, 3);
    // One CONFIRMED sales return.
    assert.equal(byKey.return.documentCount, 1);
    assert.equal(byKey.return.amountCents, 30000);
    // One ACTIVE replacement with one line.
    assert.equal(byKey.replacement.documentCount, 1);
    assert.equal(byKey.replacement.lineCount, 1);
  });

  test('families that carry no amount are explicitly marked NONE, never a silent zero', async () => {
    const { data } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary', adminToken);
    const byKey = Object.fromEntries(data.execution.families.map((family) => [family.key, family]));
    assert.equal(byKey.deliveryNotice.amountBasis, 'NONE');
    assert.equal(byKey.replacement.amountBasis, 'NONE');
    // A family that DOES carry money must not be marked NONE.
    assert.notEqual(byKey.quotation.amountBasis, 'NONE');
    assert.notEqual(byKey.salesDelivery.amountBasis, 'NONE');
  });

  test('the pre-existing summary block is unchanged (additive only)', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?dateFrom=${WINDOW_FROM}&dateTo=${WINDOW_TO}`, adminToken);
    for (const key of ['orderCount', 'orderCents', 'approvedOrderCount', 'deliveryCount', 'deliveryCents', 'returnCount', 'returnCents', 'netShipmentCents']) {
      assert.ok(Object.prototype.hasOwnProperty.call(data.summary, key), `summary.${key} must still exist`);
      assert.equal(Number.isInteger(data.summary[key]), true, `summary.${key} must stay integer cents`);
    }
    // 3 deliveries in window, 1 return in window.
    assert.equal(data.summary.deliveryCount, 3);
    assert.equal(data.summary.returnCount, 1);
    assert.equal(data.summary.netShipmentCents, 100000 + 0 + 40000 - 30000);
  });

  test('date filters narrow the execution families', async () => {
    const { data } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?dateFrom=2026-09-15&dateTo=2026-09-25', adminToken);
    const byKey = Object.fromEntries(data.execution.families.map((family) => [family.key, family]));
    // Only the late quotation and the late delivery fall into this window.
    assert.equal(byKey.quotation.documentCount, 1);
    assert.equal(byKey.salesOrder.documentCount, 0);
    assert.equal(byKey.salesDelivery.documentCount, 1);
    assert.equal(byKey.deliveryNotice.documentCount, 0);
    assert.equal(byKey.return.documentCount, 0);
    assert.equal(byKey.replacement.documentCount, 0);
  });

  test('customer filter narrows the execution families', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?customerId=customer-002&dateFrom=${WINDOW_FROM}&dateTo=${WINDOW_TO}`, adminToken);
    const byKey = Object.fromEntries(data.execution.families.map((family) => [family.key, family]));
    assert.equal(byKey.salesOrder.documentCount, 1);
    assert.equal(byKey.salesDelivery.documentCount, 1);
    assert.equal(byKey.quotation.documentCount, 0);
    assert.equal(byKey.return.documentCount, 0);
  });

  // NEGATIVE: a family count must not include a non-executed document.
  test('NEGATIVE — DRAFT quotations and DRAFT delivery notices are never counted as execution evidence', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?dateFrom=${WINDOW_FROM}&dateTo=${WINDOW_TO}`, adminToken);
    const byKey = Object.fromEntries(data.execution.families.map((family) => [family.key, family]));
    // The fixture holds quo-draft (500000) and dn-draft. If a regression
    // counted DRAFT documents, the quotation amount would be 590000 and the
    // notice count 2.
    assert.equal(byKey.quotation.amountCents, 90000);
    assert.equal(byKey.deliveryNotice.documentCount, 1);
  });
});

// ============================================================
// SC80 — Sales Gross Profit
// ============================================================

describe('SC80 — sales gross profit consumes canonical valuation evidence', () => {
  let ctx;
  let adminToken;

  before(async () => {
    ctx = await startIsolatedServer();
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
    seedReportingFixture(ctx.database);
  });

  after(async () => { await stopIsolatedServer(ctx); });

  test('gross profit equals revenue minus cost, in integer cents', async () => {
    const { status, data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.equal(status, 200);
    assert.equal(data.reportKey, 'sales-gross-profit');
    assert.equal(data.capability, 'SC80');
    for (const key of ['revenueCents', 'costCents', 'grossProfitCents']) {
      assert.equal(Number.isInteger(data.summary[key]), true, `${key} must be integer cents`);
    }
    assert.equal(data.summary.grossProfitCents, data.summary.revenueCents - data.summary.costCents);
  });

  test('revenue and cost components are exactly the canonical facts', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    const components = data.components;
    // Revenue: delivery 100000 + 0 + 40000, service 25000, return -30000.
    assert.equal(components.deliveryRevenueCents, 140000);
    assert.equal(components.serviceRevenueCents, 25000);
    assert.equal(components.returnRevenueCents, -30000);
    // Cost: delivery COGS 60000 + 20000 + 50000, return reversal -15000.
    assert.equal(components.deliveryCostCents, 130000);
    assert.equal(components.returnCostCents, -15000);
    // A pure service line produces no COGS at all, so its cost is 0 with an
    // explicit basis — not an assumed zero.
    assert.equal(components.serviceCostCents, 0);
    assert.equal(data.serviceLineCount, 1);
    assert.equal(data.noCogsApplicableLineCount, 1);
    // Totals.
    assert.equal(data.summary.revenueCents, 140000 + 25000 - 30000);
    assert.equal(data.summary.costCents, 130000 - 15000);
    assert.equal(data.summary.grossProfitCents, 135000 - 115000);
  });

  test('a gift line is not treated as free inventory: revenue 0 but the cost still lands', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.equal(data.giftBearingLineCount, 1, 'the gift line must be disclosed as cost-bearing');
    // The gift line is identified by the canonical `is_gift_line` flag on
    // the source order line, not by its amount. The fixture has exactly
    // one gift line and no other zero-revenue cost-bearing line.
    assert.equal(data.zeroRevenueCostBearingLineCount, 0);
    const giftFlag = ctx.database.prepare('SELECT is_gift_line FROM sales_order_items WHERE id=?').get('oi-gift');
    assert.equal(Number(giftFlag.is_gift_line), 1, 'the fixture gift line carries the canonical gift flag');
    // Removing the gift cost (20000) from the totals would overstate the
    // gross profit; the report must keep it.
    assert.equal(data.components.deliveryCostCents, 60000 + 20000 + 50000);
    assert.equal(data.summary.grossProfitCents, 20000);
  });

  test('a pure service delivery contributes revenue but no COGS', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.equal(data.components.serviceRevenueCents, 25000);
    assert.equal(data.components.serviceCostCents, 0);
    // There is no SALES_DELIVERY_COGS movement for the service document.
    const movements = ctx.database.prepare(
      "SELECT COUNT(*) AS n FROM inventory_valuation_movements WHERE source_type = 'SERVICE_FULFILLMENT'",
    ).get().n;
    assert.equal(Number(movements), 0, 'the fixture must not contain a service COGS movement');
  });

  test('the report declares which revenue and cost components were included', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.ok(Array.isArray(data.componentSources) && data.componentSources.length >= 5);
    const keys = data.componentSources.map((component) => component.key);
    for (const key of ['deliveryRevenue', 'serviceRevenue', 'returnRevenue', 'deliveryCost', 'returnCost']) {
      assert.ok(keys.includes(key), `component source ${key} must be declared`);
    }
    assert.match(data.notes, /inventory_valuation_movements/);
  });

  test('date filters narrow the gross profit period', async () => {
    const { data } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?report=gross-profit&dateFrom=2026-09-15&dateTo=2026-09-25', adminToken);
    // Only the late delivery (del-outside) falls into this window. It has
    // revenue but no COGS movement, so it is disclosed as a line with no
    // cost evidence rather than being silently dropped.
    assert.equal(data.summary.lineCount, 1);
    assert.equal(data.summary.revenueCents, 777000);
    assert.equal(data.summary.costCents, 0);
    assert.equal(data.summary.grossProfitCents, 777000);
    assert.equal(data.noCogsPostedLineCount, 1);
    assert.equal(data.accuracy, 'LIMITED');
    // The in-window documents must be gone.
    const inWindow = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.equal(inWindow.data.summary.lineCount, 5);
  });

  test('customer filters narrow the gross profit period', async () => {
    const { data } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?report=gross-profit&customerId=customer-002', adminToken);
    assert.equal(data.summary.revenueCents, 40000);
    assert.equal(data.summary.costCents, 50000);
    assert.equal(data.summary.grossProfitCents, -10000);
  });

  // NEGATIVE: if the gift cost were dropped, gross profit would be 40000
  // instead of 20000.
  test('NEGATIVE — dropping the gift cost would change the gross profit; the report must keep it', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.notEqual(data.summary.grossProfitCents, 40000);
    assert.equal(data.summary.grossProfitCents, 20000);
  });

  // NEGATIVE: a zero-revenue line WITHOUT the canonical gift flag (an
  // authoritative 100% discount, for example) must NOT be reported as a
  // gift. Amount-based inference would mislabel it.
  test('NEGATIVE — a zero-revenue line without the canonical gift flag is not reported as a gift', async () => {
    // Turn the fixture gift line into an ordinary zero-revenue line by
    // clearing the canonical flag, and confirm the report stops calling it
    // a gift while still keeping its cost.
    ctx.database.prepare('UPDATE sales_order_items SET is_gift_line = 0 WHERE id = ?').run('oi-gift');
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    assert.equal(data.giftBearingLineCount, 0, 'without the canonical flag the line is not a gift');
    assert.equal(data.zeroRevenueCostBearingLineCount, 1, 'it is disclosed as a zero-revenue cost-bearing line');
    // The cost is still counted, so the gross profit is unchanged.
    assert.equal(data.components.deliveryCostCents, 60000 + 20000 + 50000);
    assert.equal(data.summary.grossProfitCents, 20000);
    // Restore the canonical flag for any later assertion in this suite.
    ctx.database.prepare('UPDATE sales_order_items SET is_gift_line = 1 WHERE id = ?').run('oi-gift');
  });

  // NEGATIVE: an unknown report view must be rejected instead of silently
  // returning the summary payload.
  test('NEGATIVE — an unknown report view is rejected with 400', async () => {
    const { status } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?report=shadow-ledger', adminToken);
    assert.equal(status, 400);
  });
});

// ============================================================
// SC81 — Sales Ranking
// ============================================================

describe('SC81 — sales ranking over four canonical dimensions', () => {
  let ctx;
  let adminToken;

  before(async () => {
    ctx = await startIsolatedServer();
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
    seedReportingFixture(ctx.database);
  });

  after(async () => { await stopIsolatedServer(ctx); });

  test('an unknown dimension is rejected with 400', async () => {
    const { status } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?report=ranking&dimension=warehouse', adminToken);
    assert.equal(status, 400);
  });

  test('a missing dimension is rejected with 400', async () => {
    const { status } = await getJson(ctx.baseUrl, '/api/reports/decision/sales-summary?report=ranking', adminToken);
    assert.equal(status, 400);
  });

  test('the customer dimension ranks by gross profit', async () => {
    const { status, data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=customer&${IN_WINDOW}`, adminToken);
    assert.equal(status, 200);
    assert.equal(data.capability, 'SC81');
    assert.equal(data.dimension, 'customer');
    assert.equal(data.metric, 'GROSS_PROFIT');
    const customer001 = data.rows.find((row) => row.id === 'customer-001');
    const customer002 = data.rows.find((row) => row.id === 'customer-002');
    assert.ok(customer001, 'customer-001 must appear');
    assert.ok(customer002, 'customer-002 must appear');
    // customer-001: revenue 100000 + 0 + 25000 - 30000 = 95000;
    //              cost    60000 + 20000 - 15000 = 65000;
    //              profit  30000.
    assert.equal(customer001.revenueCents, 95000);
    assert.equal(customer001.costCents, 65000);
    assert.equal(customer001.grossProfitCents, 30000);
    // customer-002: revenue 40000, cost 50000, profit -10000.
    assert.equal(customer002.revenueCents, 40000);
    assert.equal(customer002.costCents, 50000);
    assert.equal(customer002.grossProfitCents, -10000);
    assert.equal(customer001.rank, 1);
    assert.equal(customer002.rank, 2);
  });

  test('the material dimension ranks by gross profit', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=material&${IN_WINDOW}`, adminToken);
    assert.equal(data.dimension, 'material');
    const product001 = data.rows.find((row) => row.id === 'product-001');
    const product002 = data.rows.find((row) => row.id === 'product-002');
    const product003 = data.rows.find((row) => row.id === 'product-003');
    assert.ok(product001 && product002 && product003);
    // product-001: revenue 100000 + 0 - 30000 = 70000; cost 60000 + 20000 - 15000 = 65000; profit 5000.
    assert.equal(product001.grossProfitCents, 5000);
    // product-002: revenue 40000, cost 50000, profit -10000.
    assert.equal(product002.grossProfitCents, -10000);
    // product-003 is the pure service line: revenue 25000, cost 0, profit 25000.
    assert.equal(product003.revenueCents, 25000);
    assert.equal(product003.costCents, 0);
    assert.equal(product003.grossProfitCents, 25000);
    // product-003 (25000) ranks above product-001 (5000).
    assert.equal(product003.rank, 1);
    assert.equal(product001.rank, 2);
    assert.equal(product002.rank, 3);
  });

  test('the salesperson dimension ranks by gross profit', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=salesperson&${IN_WINDOW}`, adminToken);
    assert.equal(data.dimension, 'salesperson');
    const sp001 = data.rows.find((row) => row.id === 'sp-001');
    const sp002 = data.rows.find((row) => row.id === 'sp-002');
    assert.ok(sp001 && sp002);
    // sp-001 owns customer-001's lines: profit 30000.
    assert.equal(sp001.grossProfitCents, 30000);
    // sp-002 owns customer-002's lines: profit -10000.
    assert.equal(sp002.grossProfitCents, -10000);
    assert.equal(sp001.rank, 1);
    assert.equal(sp002.rank, 2);
  });

  test('the sales group dimension ranks by gross profit', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=salesGroup&${IN_WINDOW}`, adminToken);
    assert.equal(data.dimension, 'salesGroup');
    const group = data.rows.find((row) => row.id === 'sg-001');
    assert.ok(group, 'the sales group must appear');
    // Both orders belong to sg-001: 30000 + (-10000) = 20000.
    assert.equal(group.grossProfitCents, 20000);
    assert.equal(group.rank, 1);
  });

  test('every ranking metric value is an integer cent amount', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=customer&${IN_WINDOW}`, adminToken);
    for (const row of data.rows) {
      for (const key of ['revenueCents', 'costCents', 'grossProfitCents', 'lineCount', 'rank']) {
        assert.equal(Number.isInteger(row[key]), true, `${key} must be an integer`);
      }
    }
  });

  test('the ranking agrees with the gross profit report on the same period', async () => {
    const grossProfit = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=gross-profit&${IN_WINDOW}`, adminToken);
    const ranking = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=customer&${IN_WINDOW}`, adminToken);
    const rankedTotal = ranking.data.rows.reduce((sum, row) => sum + row.grossProfitCents, 0);
    assert.equal(rankedTotal, grossProfit.data.summary.grossProfitCents);
  });

  // NEGATIVE: if the ranking silently dropped the loss-making customer,
  // the total would still match — so the negative control is that the
  // loss-making bucket must be present AND ranked last.
  test('NEGATIVE — the loss-making customer must still be present and ranked last', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=customer&${IN_WINDOW}`, adminToken);
    const loss = data.rows.find((row) => row.id === 'customer-002');
    assert.ok(loss, 'the loss-making customer must not be dropped');
    assert.equal(loss.grossProfitCents, -10000);
    assert.equal(loss.rank, data.rows.length);
  });

  // NEGATIVE: a ranking that ignored the cost side would rank the
  // loss-making customer first (it has revenue).
  test('NEGATIVE — the ranking must be driven by gross profit, not by revenue', async () => {
    const { data } = await getJson(ctx.baseUrl, `/api/reports/decision/sales-summary?report=ranking&dimension=customer&${IN_WINDOW}`, adminToken);
    const byRevenue = [...data.rows].sort((left, right) => right.revenueCents - left.revenueCents);
    assert.equal(byRevenue[0].id, 'customer-001');
    assert.notEqual(data.rows[0].id, byRevenue[0].id === data.rows[0].id ? null : 'customer-002');
    assert.equal(data.rows[0].id, 'customer-001');
  });
});

// ============================================================
// HTTP auth gates
// ============================================================

describe('SC78 / SC80 / SC81 — HTTP authorization gates', () => {
  let ctx;
  let adminToken;

  before(async () => {
    ctx = await startIsolatedServer();
    adminToken = await login(ctx.baseUrl, 'admin', 'admin123');
    seedReportingFixture(ctx.database);
  });

  after(async () => { await stopIsolatedServer(ctx); });

  test('401 unauthenticated for every new view', async () => {
    for (const path of [
      '/api/reports/decision/sales-summary',
      '/api/reports/decision/sales-summary?report=gross-profit',
      '/api/reports/decision/sales-summary?report=ranking&dimension=customer',
    ]) {
      const { status } = await getJson(ctx.baseUrl, path, null);
      assert.equal(status, 401, `${path} must require authentication`);
    }
  });

  test('403 for the sales role (no REPORT_VIEW)', async () => {
    const salesToken = await login(ctx.baseUrl, 'sales', 'sales123');
    for (const path of [
      '/api/reports/decision/sales-summary',
      '/api/reports/decision/sales-summary?report=gross-profit',
      '/api/reports/decision/sales-summary?report=ranking&dimension=customer',
    ]) {
      const { status } = await getJson(ctx.baseUrl, path, salesToken);
      assert.equal(status, 403, `${path} must require REPORT_VIEW`);
    }
  });

  test('200 for the admin on every new view', async () => {
    for (const path of [
      '/api/reports/decision/sales-summary',
      '/api/reports/decision/sales-summary?report=gross-profit',
      '/api/reports/decision/sales-summary?report=ranking&dimension=material',
    ]) {
      const { status } = await getJson(ctx.baseUrl, path, adminToken);
      assert.equal(status, 200, `${path} must succeed for the admin`);
    }
  });

  test('the gross profit CSV export carries the same canonical line facts', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary/export?report=gross-profit', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /单据类型/);
    assert.match(text, /SD-GIFT-001/);
    assert.match(text, /NO_COGS_APPLICABLE/);
  });

  test('the ranking CSV export carries the ranked rows', async () => {
    const res = await fetch(ctx.baseUrl + '/api/reports/decision/sales-summary/export?report=ranking&dimension=customer', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /名次/);
    assert.match(text, /毛利（分）/);
  });
});
