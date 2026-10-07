import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, id } from './db.js';
import { allocateForecastConsumption, assertStrongReservationAvailability, materializePlannedOrders } from './modules/planning-domain.js';

let db;
let server;
let baseUrl;
let token;
const actor = { id: 'user-admin', permissions: [] };

before(async () => {
  db = createDatabase(':memory:');
  server = createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  token = (await response.json()).token;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}

describe('B3120 Planning Domain Closure', () => {
  test('schema and permissions are additive and available', () => {
    for (const table of ['planning_schemes', 'forecast_consumptions', 'planned_orders', 'planning_reservations', 'mrp_run_events', 'mrp_run_logs']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    }
    const permissions = new Set(db.prepare('SELECT code FROM permissions').all().map((row) => row.code));
    assert.ok(permissions.has('PLANNING_CONFIG_MANAGE'));
    assert.ok(permissions.has('PLANNED_ORDER_RELEASE'));
    assert.ok(permissions.has('PLANNING_RESERVATION_MANAGE'));
  });

  test('forecast consumption is deterministic and preserves allocation evidence', () => {
    const result = allocateForecastConsumption(
      [{ productId: 'P1', orderId: 'SO2', needDate: '2026-10-12', quantity: 6 }, { productId: 'P1', orderId: 'SO1', needDate: '2026-10-10', quantity: 5 }],
      [{ productId: 'P1', itemId: 'F2', needDate: '2026-10-20', quantity: 4 }, { productId: 'P1', itemId: 'F1', needDate: '2026-10-01', quantity: 10 }],
    );
    assert.deepEqual(result.allocations.map((row) => [row.salesOrderId, row.forecastItemId, row.quantity]), [
      ['SO1', 'F1', 5], ['SO2', 'F1', 5], ['SO2', 'F2', 1],
    ]);
    assert.equal(result.forecastRemainders.find((row) => row.itemId === 'F2').remaining, 3);
  });

  test('MRP shortage becomes one traceable planned order and is idempotent', () => {
    const product = db.prepare('SELECT id FROM products WHERE active=1 LIMIT 1').get();
    const runId = id(); const resultId = id(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO mrp_runs(id,run_code,run_name,horizon_start,horizon_end,demand_source_mode,status,summary,created_by,created_at,updated_at,completed_at)
      VALUES(?,?,?,'2026-10-01','2026-10-31','SALES_ORDERS','COMPLETED','{}','user-admin',?,?,?)`).run(runId, `T-${runId}`, 'closure', now, now, now);
    db.prepare(`INSERT INTO mrp_run_results(id,run_id,product_id,gross_requirement,net_requirement,suggestion_type,suggested_quantity,need_by_date,supply_type)
      VALUES(?,?,?,?,?,'BUY',?,'2026-10-15','OUTSOURCE')`).run(resultId, runId, product.id, 7, 7, 7);
    assert.equal(materializePlannedOrders(db, runId, actor), 1);
    assert.equal(materializePlannedOrders(db, runId, actor), 0);
    const order = db.prepare('SELECT * FROM planned_orders WHERE mrp_result_id=?').get(resultId);
    assert.equal(order.supply_type, 'OUTSOURCE');
    assert.equal(order.status, 'DRAFT');
  });

  test('strong reservation prevents another demand from consuming reserved stock', () => {
    const product = db.prepare('SELECT id FROM products WHERE active=1 LIMIT 1').get();
    const warehouse = db.prepare('SELECT id FROM warehouses WHERE active=1 LIMIT 1').get();
    db.prepare('UPDATE inventory SET quantity=10 WHERE warehouse_id=? AND product_id=?').run(warehouse.id, product.id);
    if (!db.prepare('SELECT 1 FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouse.id, product.id)) {
      db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)').run(id(), warehouse.id, product.id, 10, new Date().toISOString());
    }
    db.prepare(`INSERT INTO planning_reservations(id,reservation_no,reservation_type,demand_source_type,demand_source_id,supply_source_type,product_id,warehouse_id,quantity,status,created_by,created_at,updated_at)
      VALUES(?,?,'STRONG','SALES_ORDER','SO-A','ON_HAND',?,?,8,'ACTIVE','user-admin',?,?)`).run(id(), `R-${id()}`, product.id, warehouse.id, new Date().toISOString(), new Date().toISOString());
    assert.throws(() => assertStrongReservationAvailability(db, { productId: product.id, warehouseId: warehouse.id, quantity: 3, demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-B' }), /强预留/);
    assert.doesNotThrow(() => assertStrongReservationAvailability(db, { productId: product.id, warehouseId: warehouse.id, quantity: 8, demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-A' }));
  });

  test('scheme lifecycle and manual planned-order release work through canonical HTTP routes', async () => {
    const product = db.prepare('SELECT id FROM products WHERE active=1 LIMIT 1').get();
    const scheme = await request('/api/planning/schemes', { method: 'POST', body: { schemeCode: `SCH-${Date.now()}`, schemeName: 'Closure scheme', horizonDays: 30 } });
    assert.equal(scheme.status, 201, scheme.data.error);
    const activated = await request(`/api/planning/schemes/${scheme.data.id}/activate`, { method: 'POST' });
    assert.equal(activated.status, 200, activated.data.error);
    const created = await request('/api/planning/planned-orders', { method: 'POST', body: { productId: product.id, quantity: 5, supplyType: 'BUY', needDate: '2026-10-20' } });
    assert.equal(created.status, 201, created.data.error);
    assert.equal((await request(`/api/planning/planned-orders/${created.data.id}/confirm`, { method: 'POST' })).status, 200);
    const released = await request(`/api/planning/planned-orders/${created.data.id}/release`, { method: 'POST' });
    assert.equal(released.status, 201, released.data.error);
    assert.equal(released.data.type, 'BUY');
    assert.ok(db.prepare('SELECT 1 FROM purchase_instruction_items WHERE planned_order_id=?').get(created.data.id));
    const workbench = await request('/api/planning/workbench');
    assert.equal(workbench.status, 200, workbench.data.error);
    assert.ok(Array.isArray(workbench.data.workbench.rows));

    const warehouse = db.prepare('SELECT id FROM warehouses WHERE active=1 LIMIT 1').get();
    const reservation = await request('/api/planning/reservations', { method: 'POST', body: {
      reservationType: 'WEAK', demandSourceType: 'SALES_ORDER', demandSourceId: 'SO-HTTP',
      supplySourceType: 'EXPECTED', productId: product.id, warehouseId: warehouse.id, quantity: 2,
    } });
    assert.equal(reservation.status, 201, reservation.data.error);
    assert.equal((await request(`/api/planning/reservations/${reservation.data.id}/release`, { method: 'POST' })).status, 200);
  });
});
