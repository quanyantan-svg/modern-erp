// Planning Domain Closure — remediation round evidence (2026-11-12).
//
// Covers the capabilities that the 2026-11-12 domain audit found missing or
// partial, plus the defects it registered:
//
//   PL-07 / PL-08  warehouse scope participates in the netting
//   PL-17 / PL-19  time-phased events and the safety-stock floor
//   PL-24 / PL-25  substitute consumption and the substitute suggestion query
//   PL-31          manual reservation against a bounded expected supply
//   PL-36          planned order batch maintenance
//   PL-38          planned order byproducts
//   PL-42/44/45    supply-demand reports, order trace and reservation trace
//
// Every case is an HTTP-level contract test against the canonical routes.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, id } from './db.js';

let db;
let server;
let baseUrl;
let token;

before(async () => {
  db = createDatabase(':memory:');
  server = createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  token = (await response.json()).token;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

const nowIso = () => new Date().toISOString();
const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function ensureProduct(code, name = code) {
  const existing = db.prepare('SELECT id FROM products WHERE code=?').get(code);
  if (existing) return existing.id;
  const productId = id();
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,'','',0,0,1,?,?)`).run(productId, code, name, nowIso(), nowIso());
  return productId;
}

function ensureWarehouse(code) {
  const existing = db.prepare('SELECT id FROM warehouses WHERE code=?').get(code);
  if (existing) return existing.id;
  const warehouseId = id();
  db.prepare('INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)')
    .run(warehouseId, code, code, nowIso(), nowIso());
  return warehouseId;
}

function seedInventory(warehouseId, productId, quantity) {
  db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)')
    .run(id(), warehouseId, productId, quantity, nowIso());
}

function seedSalesOrder({ productId, quantity, needDate }) {
  const orderId = id();
  const orderNo = `SO-${orderId.slice(0, 8)}`;
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,requested_delivery_date,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,'customer-001','APPROVED',0,?,'','user-sales',?,?,?,?)`)
    .run(orderId, orderNo, needDate, nowIso(), nowIso(), nowIso(), nowIso());
  db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,1000,?,1)')
    .run(id(), orderId, productId, quantity, quantity * 1000);
  return { orderId, orderNo };
}

function seedBom({ parentId, items }) {
  const bomId = id();
  db.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,'rmd-v1','ACTIVE','','user-admin',?,?)")
    .run(bomId, parentId, nowIso(), nowIso());
  items.forEach((item, index) => {
    db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)')
      .run(id(), bomId, item.productId, item.quantity, index + 1);
  });
  return bomId;
}

async function createRun({ name, schemeId, horizonStart, horizonEnd, mode = 'SALES_ORDERS', forecastId = null }) {
  const created = await request('/api/planning/mrp/runs', {
    method: 'POST',
    body: { runName: name, horizonStart, horizonEnd, demandSourceMode: mode, schemeId, forecastId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const executed = await request(`/api/planning/mrp/runs/${created.data.id}/execute`, { method: 'POST' });
  assert.equal(executed.status, 200, JSON.stringify(executed.data));
  const detail = await request(`/api/planning/mrp/runs/${created.data.id}`);
  return detail.data.run;
}

describe('Planning Domain Closure — remediation round (2026-11-12)', () => {
  test('PL-07 / PL-08: the scheme warehouse participation scopes the netting', async () => {
    const productId = ensureProduct('RMD-SCOPE');
    const warehouseA = ensureWarehouse('RMD-WH-A');
    const warehouseB = ensureWarehouse('RMD-WH-B');
    seedInventory(warehouseB, productId, 50);
    seedSalesOrder({ productId, quantity: 10, needDate: plusDays(7) });
    const scheme = await request('/api/planning/schemes', {
      method: 'POST',
      body: {
        schemeCode: `RMD-SCOPE-${Date.now()}`, schemeName: '范围方案', horizonDays: 30,
        warehouses: [warehouseA], demandSources: ['SALES_ORDER'],
      },
    });
    assert.equal(scheme.status, 201, JSON.stringify(scheme.data));
    await request(`/api/planning/schemes/${scheme.data.id}/activate`, { method: 'POST' });
    const run = await createRun({
      name: 'scope', schemeId: scheme.data.id,
      horizonStart: new Date().toISOString().slice(0, 10), horizonEnd: plusDays(30),
    });
    const row = run.results.find((item) => item.product_id === productId);
    assert.ok(row, 'the scoped product must have a result row');
    assert.equal(Number(row.on_hand), 0, 'stock outside the participating warehouses must not count');
    assert.equal(Number(row.net_requirement), 10, 'the full demand stays a requirement');
  });

  test('PL-19: the safety stock is one floor requirement per product, not one per bucket', async () => {
    const productId = ensureProduct('RMD-FLOOR');
    const warehouseId = ensureWarehouse('RMD-WH-FLOOR');
    seedInventory(warehouseId, productId, 0);
    seedSalesOrder({ productId, quantity: 4, needDate: plusDays(5) });
    seedSalesOrder({ productId, quantity: 6, needDate: plusDays(15) });
    db.prepare(`INSERT INTO planning_material_policies(id,product_id,safety_stock,reorder_point,maximum_stock,economic_order_quantity,lead_time_days,supply_strategy,created_at,updated_at)
      VALUES(?,?,5,0,0,0,0,'AUTO',?,?) ON CONFLICT(product_id) DO UPDATE SET safety_stock=5`)
      .run(`policy-${productId}`, productId, nowIso(), nowIso());
    const scheme = await request('/api/planning/schemes', {
      method: 'POST',
      body: {
        schemeCode: `RMD-FLOOR-${Date.now()}`, schemeName: '安全库存方案', horizonDays: 30,
        demandSources: ['SALES_ORDER', 'SAFETY_STOCK'],
      },
    });
    assert.equal(scheme.status, 201, JSON.stringify(scheme.data));
    await request(`/api/planning/schemes/${scheme.data.id}/activate`, { method: 'POST' });
    const run = await createRun({
      name: 'floor', schemeId: scheme.data.id,
      horizonStart: new Date().toISOString().slice(0, 10), horizonEnd: plusDays(30),
    });
    const row = run.results.find((item) => item.product_id === productId);
    assert.ok(row);
    assert.equal(Number(row.gross_requirement), 10, 'the floor never inflates the transactional gross demand');
    assert.equal(Number(row.safety_stock), 5);
    // One floor requirement for the product and horizon: 10 demand + 5 floor.
    assert.equal(Number(row.net_requirement), 15, 'the floor is applied once, not once per demand bucket');
  });

  test('PL-17: the run records the dated demand and supply event stream', async () => {
    const productId = ensureProduct('RMD-EVENTS');
    const warehouseId = ensureWarehouse('RMD-WH-EVENTS');
    seedInventory(warehouseId, productId, 4);
    seedSalesOrder({ productId, quantity: 9, needDate: plusDays(9) });
    const run = await createRun({
      name: 'events',
      horizonStart: new Date().toISOString().slice(0, 10), horizonEnd: plusDays(30),
    });
    const demand = run.events.filter((event) => event.direction === 'DEMAND' && event.product_id === productId);
    assert.ok(demand.length >= 1, 'the demand event must be recorded');
    assert.equal(Number(demand[0].quantity), 9);
    assert.ok(demand[0].event_date, 'the demand event carries its date');
    assert.equal(typeof demand[0].metadata.projectedBalance, 'number', 'the event carries the projected balance');
    assert.equal(typeof demand[0].metadata.floorGap, 'number');
    const row = run.results.find((item) => item.product_id === productId);
    assert.equal(Number(row.net_requirement), 5, 'the aggregate requirement stays authoritative');
  });

  test('PL-24 / PL-25: a shortage produces a conservative substitute suggestion', async () => {
    const primaryId = ensureProduct('RMD-SUB-PRIMARY');
    const substituteId = ensureProduct('RMD-SUB-ALTERNATE');
    seedSalesOrder({ productId: primaryId, quantity: 12, needDate: plusDays(6) });
    const schemeId = id();
    const now = nowIso();
    db.prepare(`INSERT INTO engineering_substitute_schemes(id,code,name,strategy,method,active,notes,created_at,updated_at)
      VALUES(?,?,?,'MANUAL','REPLACE',1,'',?,?)`).run(schemeId, `RMD-SUB-${Date.now()}`, '人工替代方案', now, now);
    db.prepare(`INSERT INTO engineering_substitutes(id,scheme_id,primary_product_id,substitute_product_id,priority,ratio,active,notes,created_at,updated_at)
      VALUES(?,?,?,?,1,2,1,'',?,?)`).run(id(), schemeId, primaryId, substituteId, now, now);
    const run = await createRun({
      name: 'substitute',
      horizonStart: new Date().toISOString().slice(0, 10), horizonEnd: plusDays(30),
    });
    const row = run.results.find((item) => item.product_id === primaryId);
    assert.ok(row);
    assert.equal(Number(row.net_requirement), 12, 'the primary shortage is not silently reduced');
    const suggestions = await request(`/api/planning/reports/substitute-suggestions?runId=${run.id}`);
    assert.equal(suggestions.status, 200, JSON.stringify(suggestions.data));
    const suggestion = suggestions.data.suggestions.find((item) => item.primary_product_id === primaryId);
    assert.ok(suggestion, 'a substitute suggestion must be recorded');
    assert.equal(suggestion.substitute_product_id, substituteId);
    assert.equal(suggestion.strategy, 'MANUAL');
    assert.equal(suggestion.method, 'REPLACE');
    assert.equal(suggestion.quantity_basis, 'RATIO 2');
    assert.equal(Number(suggestion.suggested_quantity), 0, 'a MANUAL strategy never substitutes automatically');
  });

  test('PL-31: a manual reservation against an expected supply stays bounded', async () => {
    const productId = ensureProduct('RMD-EXPECTED');
    const warehouseId = ensureWarehouse('RMD-WH-EXPECTED');
    const first = await request('/api/planning/reservations', {
      method: 'POST',
      body: {
        reservationType: 'MANUAL', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-EXP',
        supplySourceType: 'EXPECTED', supplySourceId: 'EXP-SUPPLY-1', expectedSupplyQuantity: 5,
        productId, warehouseId, quantity: 3, releaseDate: plusDays(20),
      },
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const second = await request('/api/planning/reservations', {
      method: 'POST',
      body: {
        reservationType: 'MANUAL', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-EXP-2',
        supplySourceType: 'EXPECTED', supplySourceId: 'EXP-SUPPLY-1', expectedSupplyQuantity: 5,
        productId, warehouseId, quantity: 2,
      },
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    const over = await request('/api/planning/reservations', {
      method: 'POST',
      body: {
        reservationType: 'MANUAL', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-EXP-3',
        supplySourceType: 'EXPECTED', supplySourceId: 'EXP-SUPPLY-1', expectedSupplyQuantity: 5,
        productId, warehouseId, quantity: 1,
      },
    });
    assert.equal(over.status, 409, 'the expected supply capacity must not be exceeded');
    const conflict = await request('/api/planning/reservations', {
      method: 'POST',
      body: {
        reservationType: 'MANUAL', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-EXP-4',
        supplySourceType: 'EXPECTED', supplySourceId: 'EXP-SUPPLY-1', expectedSupplyQuantity: 99,
        productId, warehouseId, quantity: 1,
      },
    });
    assert.equal(conflict.status, 409, 'the expected capacity of one identity is fixed');
  });

  test('PL-36: batch maintenance confirms atomically and rolls back on a version conflict', async () => {
    const productId = ensureProduct('RMD-BATCH');
    const first = await request('/api/planning/planned-orders', {
      method: 'POST', body: { productId, quantity: 5, supplyType: 'BUY', needDate: plusDays(10) },
    });
    const second = await request('/api/planning/planned-orders', {
      method: 'POST', body: { productId, quantity: 6, supplyType: 'BUY', needDate: plusDays(11) },
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(second.status, 201, JSON.stringify(second.data));
    const preview = await request('/api/planning/planned-orders/batch/preview', {
      method: 'POST', body: { action: 'CONFIRM', orderIds: [first.data.id, second.data.id] },
    });
    assert.equal(preview.status, 201, JSON.stringify(preview.data));
    const applied = await request(`/api/planning/planned-orders/batch/${preview.data.id}/apply`, {
      method: 'POST', body: { hash: preview.data.hash },
    });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    assert.equal(applied.data.applied.length, 2);
    assert.equal(db.prepare('SELECT status FROM planned_orders WHERE id=?').get(first.data.id).status, 'CONFIRMED');
    assert.equal(db.prepare('SELECT status FROM planned_orders WHERE id=?').get(second.data.id).status, 'CONFIRMED');
    // A stale preview must fail the WHOLE batch, not half of it.
    const third = await request('/api/planning/planned-orders', {
      method: 'POST', body: { productId, quantity: 7, supplyType: 'BUY', needDate: plusDays(12) },
    });
    const fourth = await request('/api/planning/planned-orders', {
      method: 'POST', body: { productId, quantity: 8, supplyType: 'BUY', needDate: plusDays(13) },
    });
    const stale = await request('/api/planning/planned-orders/batch/preview', {
      method: 'POST', body: { action: 'CANCEL', orderIds: [third.data.id, fourth.data.id] },
    });
    assert.equal(stale.status, 201, JSON.stringify(stale.data));
    await request(`/api/planning/planned-orders/${third.data.id}/confirm`, { method: 'POST' });
    const rejected = await request(`/api/planning/planned-orders/batch/${stale.data.id}/apply`, {
      method: 'POST', body: { hash: stale.data.hash },
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(db.prepare('SELECT status FROM planned_orders WHERE id=?').get(fourth.data.id).status, 'DRAFT',
      'a conflicting batch must not apply any row');
    const replay = await request(`/api/planning/planned-orders/batch/${stale.data.id}/apply`, {
      method: 'POST', body: { hash: stale.data.hash },
    });
    assert.equal(replay.status, 409);
  });

  test('PL-38: a planned order carries its planned byproducts', async () => {
    const productId = ensureProduct('RMD-BYPRODUCT-PARENT');
    const byproductId = ensureProduct('RMD-BYPRODUCT');
    const created = await request('/api/planning/planned-orders', {
      method: 'POST',
      body: { productId, quantity: 4, supplyType: 'MAKE', needDate: plusDays(8), byproducts: [{ productId: byproductId, quantity: 2 }] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const detail = await request(`/api/planning/planned-orders/${created.data.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.plannedOrder.byproducts.length, 1);
    assert.equal(detail.data.plannedOrder.byproducts[0].product_id, byproductId);
    assert.equal(Number(detail.data.plannedOrder.byproducts[0].quantity), 2);
  });

  test('a shared component is netted once, so the level below it is not under-ordered', async () => {
    // Regression for the 2026-11-12 finding: the BOM walk recursed per
    // parent, so a shared component had its own stock netted once per
    // parent. The level below it was then under-ordered (6 instead of 14).
    const fg1 = ensureProduct('RMD-SHARED-FG1');
    const fg2 = ensureProduct('RMD-SHARED-FG2');
    const middle = ensureProduct('RMD-SHARED-A');
    const raw = ensureProduct('RMD-SHARED-RAW');
    const warehouseId = ensureWarehouse('RMD-WH-SHARED');
    seedBom({ parentId: fg1, items: [{ productId: middle, quantity: 2 }] });
    seedBom({ parentId: fg2, items: [{ productId: middle, quantity: 3 }] });
    seedBom({ parentId: middle, items: [{ productId: raw, quantity: 1 }] });
    // FG1 net 5 -> middle demand 10; FG2 net 4 -> middle demand 12.
    seedSalesOrder({ productId: fg1, quantity: 5, needDate: plusDays(6) });
    seedSalesOrder({ productId: fg2, quantity: 7, needDate: plusDays(6) });
    seedInventory(warehouseId, fg2, 3);
    // The shared component has its own stock: 8.
    seedInventory(warehouseId, middle, 8);
    const run = await createRun({
      name: 'shared',
      horizonStart: new Date().toISOString().slice(0, 10), horizonEnd: plusDays(30),
    });
    const middleRow = run.results.find((item) => item.product_id === middle);
    assert.ok(middleRow, 'the shared component must have a result row');
    assert.equal(Number(middleRow.gross_component_demand), 22, '5x2 + 4x3 = 22');
    assert.equal(Number(middleRow.net_requirement), 14, 'the shared stock is netted once: 22 - 8');
    const rawRow = run.results.find((item) => item.product_id === raw);
    assert.ok(rawRow, 'the level below the shared component must be planned');
    assert.equal(Number(rawRow.gross_component_demand), 14, 'the level below is driven by the netted shared component, not by two partial nets');
  });

  test('PL-42 / PL-44 / PL-45: the supply-demand reports and the reservation trace are distinct', async () => {
    const productId = ensureProduct('RMD-REPORT');
    const warehouseId = ensureWarehouse('RMD-WH-REPORT');
    seedInventory(warehouseId, productId, 3);
    seedSalesOrder({ productId, quantity: 8, needDate: plusDays(11) });
    const order = await request('/api/planning/planned-orders', {
      method: 'POST', body: { productId, quantity: 5, supplyType: 'BUY', needDate: plusDays(14) },
    });
    await request(`/api/planning/planned-orders/${order.data.id}/confirm`, { method: 'POST' });
    const reservation = await request('/api/planning/reservations', {
      method: 'POST',
      body: {
        reservationType: 'WEAK', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-REPORT',
        supplySourceType: 'PLANNED_ORDER', supplySourceId: order.data.id,
        productId, warehouseId, quantity: 2,
      },
    });
    assert.equal(reservation.status, 201, JSON.stringify(reservation.data));

    const status = await request('/api/planning/reports/supply-demand-status');
    assert.equal(status.status, 200, JSON.stringify(status.data));
    const statusRow = status.data.rows.find((row) => row.id === productId);
    assert.ok(statusRow);
    assert.ok(statusRow.bucketCount >= 1, 'the status report carries the time buckets');
    assert.equal(typeof statusRow.exception, 'string');

    const summary = await request('/api/planning/reports/supply-demand-summary');
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    assert.ok(summary.data.totals);
    assert.ok(summary.data.totals.products >= 1);
    assert.equal(typeof summary.data.totals.shortageProducts, 'number');
    assert.equal(summary.data.rows[0].bucketCount, undefined, 'the summary row is the quantitative view');
    assert.equal(typeof status.data.rows[0].bucketCount, 'number', 'the status row is the exception view');

    const detail = await request('/api/planning/reports/supply-demand-detail');
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    const detailRow = detail.data.rows.find((row) => row.id === productId);
    assert.ok(Array.isArray(detailRow.buckets));
    assert.ok(detailRow.events.demand.length >= 1, 'the detail report carries the demand events');
    assert.ok(detailRow.events.supply.length >= 1, 'the detail report carries the supply events');

    const trace = await request('/api/planning/reports/order-supply-demand');
    assert.equal(trace.status, 200, JSON.stringify(trace.data));
    const traceRow = trace.data.traces.find((row) => row.product.id === productId);
    assert.ok(traceRow, 'the order trace must cover the product');
    assert.ok(traceRow.demandSources.length >= 1, 'the order trace shows the demand source');
    assert.ok(traceRow.plannedOrders.length >= 1, 'the order trace shows the planned order');

    const reservationTrace = await request('/api/planning/reports/reservation-trace');
    assert.equal(reservationTrace.status, 200, JSON.stringify(reservationTrace.data));
    const traced = reservationTrace.data.traces.find((row) => row.supplySourceId === order.data.id);
    assert.ok(traced, 'the reverse trace groups the reservations by their supply');
    assert.equal(Number(traced.reservedQuantity), 2);
    assert.equal(traced.demands.length, 1);
    assert.equal(traced.demands[0].demandSourceId, 'SO-REPORT');

    const reservationDetail = await request(`/api/planning/reservations/${reservation.data.id}`);
    assert.equal(reservationDetail.status, 200, JSON.stringify(reservationDetail.data));
    assert.equal(reservationDetail.data.demand.type, 'SALES_ORDER');
    assert.equal(reservationDetail.data.demand.document, null);
    assert.equal(reservationDetail.data.supply.type, 'PLANNED_ORDER');
    assert.equal(reservationDetail.data.supply.document.id, order.data.id);
  });
});
