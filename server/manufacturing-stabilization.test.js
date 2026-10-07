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

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-mfg-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Manufacturing surface and permissions', () => {
  test('live manufacturing and engineering BOM permissions are registered', () => {
    const registered = new Set(PERMISSIONS.map(([code]) => code));
    for (const permission of ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_START', 'PRODUCTION_ORDERS_COMPLETE', 'MRP_VIEW', 'MRP_MANAGE', 'WORK_CENTERS_VIEW', 'WORK_CENTERS_MANAGE', 'ROUTING_VIEW', 'ROUTING_MANAGE', 'PRODUCTION_COSTS_VIEW', 'PRODUCTION_COSTS_MANAGE']) {
      assert.ok(registered.has(permission), `${permission} must be registered`);
    }
    const manufacturing = readFileSync(new URL('../src/pages/manufacturing.jsx', import.meta.url), 'utf8');
    assert.match(manufacturing, /PRODUCTION_ORDERS_CREATE/);
    assert.match(manufacturing, /ENGINEERING_BOM_MANAGE/);
    assert.doesNotMatch(manufacturing, /can\(user, ['"]BOM_MANAGE['"]\)/);
    assert.doesNotMatch(manufacturing, /开发中/);
  });

  test('only admin receives manufacturing controls in the five-role contract', async () => {
    const admin = await request('/api/auth/me');
    assert.ok(admin.data.user.permissions.includes('PRODUCTION_ORDERS_CREATE'));
    for (const [username, password] of [['reviewer', 'review123'], ['warehouse', 'warehouse123'], ['accounting', 'accounting123']]) {
      const token = await login(username, password);
      const me = await request('/api/auth/me', { token });
      assert.equal(me.data.user.permissions.includes('PRODUCTION_ORDERS_CREATE'), false, username);
      const denied = await request('/api/boms', { token, method: 'POST', body: { productId: 'product-001', items: [{ productId: 'product-002', quantity: 1 }] } });
      assert.equal(denied.status, 403);
    }
  });

  test('production output remains deferred and is not publicly routed', async () => {
    const response = await request('/api/production-outputs', { method: 'POST', body: { orderId: 'x', quantity: 1 } });
    assert.equal(response.status, 404);
  });
});

describe('BOM supported UI contract', () => {
  let bomId;

  test('admin can list, create, detail, update and discontinue an ACTIVE BOM', async () => {
    const create = await request('/api/boms', {
      method: 'POST',
      body: {
        productId: 'product-001',
        version: 'mfg-test',
        remark: 'initial',
        items: [
          { productId: 'product-002', quantity: 2, scrapRate: 0.1 },
          { productId: 'product-003', quantity: 1, scrapRate: 0 },
        ],
      },
    });
    assert.equal(create.status, 200, create.data.error);
    bomId = create.data.id;

    const detail = await request(`/api/boms/${bomId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.bom.status, 'ACTIVE');
    assert.equal(detail.data.bom.items.length, 2);
    assert.deepEqual(detail.data.bom.items.map((item) => item.product_id), ['product-002', 'product-003']);

    const update = await request(`/api/boms/${bomId}`, {
      method: 'POST',
      body: { remark: 'updated', items: [{ productId: 'product-002', quantity: 3, scrapRate: 0.2 }] },
    });
    assert.equal(update.status, 200, update.data.error);
    const updated = await request(`/api/boms/${bomId}`);
    assert.equal(updated.data.bom.remark, 'updated');
    assert.equal(updated.data.bom.items.length, 1);
    assert.equal(updated.data.bom.items[0].quantity, 3);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM bom_items WHERE bom_id=?').get(bomId).count, 1);

    const discontinue = await request(`/api/boms/${bomId}`, { method: 'POST', body: { action: 'deactivate' } });
    assert.equal(discontinue.status, 200);
    const after = await request(`/api/boms/${bomId}`);
    assert.equal(after.data.bom.status, 'DISCONTINUED');
  });

  test('BOM validation rejects empty items, invalid quantities, duplicates and self references', async () => {
    const empty = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', items: [] } });
    assert.equal(empty.status, 400);
    const invalidQty = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', items: [{ productId: 'product-002', quantity: 0 }] } });
    assert.equal(invalidQty.status, 400);
    const duplicate = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', items: [{ productId: 'product-002', quantity: 1 }, { productId: 'product-002', quantity: 2 }] } });
    assert.equal(duplicate.status, 400);
    const recursive = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', items: [{ productId: 'product-001', quantity: 1 }] } });
    assert.equal(recursive.status, 400);
  });

  test('unsupported role cannot create BOM through the canonical production-order gate', async () => {
    const response = await request('/api/boms', { token: salesToken, method: 'POST', body: { productId: 'product-001', items: [{ productId: 'product-002', quantity: 1 }] } });
    assert.equal(response.status, 403);
  });
});

describe('Production order core hardening', () => {
  async function createOrder() {
    const bom = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', version: `order-${Date.now()}-${Math.random()}`, items: [{ productId: 'product-002', quantity: 1 }] } });
    assert.equal(bom.status, 200, bom.data.error);
    const response = await request('/api/production-orders', { method: 'POST', body: { productId: 'product-001', bomId: bom.data.id, quantity: 5, plannedStart: '2026-09-02' } });
    assert.equal(response.status, 200, response.data.error);
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED']) {
      const transition = await request(`/api/production-orders/${response.data.id}/state`, { method: 'POST', body: { target } });
      assert.equal(transition.status, 200, transition.data.error);
    }
    return response.data.id;
  }

  test('create, start, reconciliation-gated complete and valid zero-effect cancel preserve the workflow', async () => {
    const flowId = await createOrder();
    assert.equal((await request(`/api/production-orders/${flowId}`, { method: 'POST', body: { action: 'start' } })).status, 200);
    assert.equal((await request(`/api/production-orders/${flowId}`, { method: 'POST', body: { action: 'complete' } })).status, 409);
    const completed = await request(`/api/production-orders/${flowId}`);
    assert.equal(completed.data.order.status, 'IN_PROGRESS');
    assert.equal((await request(`/api/production-orders/${flowId}`, { method: 'POST', body: { action: 'cancel' } })).status, 200);

    const cancelId = await createOrder();
    assert.equal((await request(`/api/production-orders/${cancelId}`, { method: 'POST', body: { action: 'cancel' } })).status, 200);
    const cancelled = await request(`/api/production-orders/${cancelId}`);
    assert.equal(cancelled.data.order.status, 'CANCELLED');
  });

  test('unknown and repeated invalid transitions return business errors', async () => {
    const orderId = await createOrder();
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'pause' } })).status, 400);
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } })).status, 409);
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'cancel' } })).status, 200);
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } })).status, 409);
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'cancel' } })).status, 200);
  });
});

describe('MRP and routing stabilization', () => {
  test('legacy MRP plan execution is retired in favor of canonical Planning runs', async () => {
    const activeBom = await request('/api/boms', { method: 'POST', body: { productId: 'product-001', version: 'mrp-active', items: [{ productId: 'product-002', quantity: 2, scrapRate: 0 }] } });
    assert.equal(activeBom.status, 200, activeBom.data.error);
    const discontinuedBomId = id();
    database.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))")
      .run(discontinuedBomId, 'product-001', 'mrp-old', 'DISCONTINUED', '', 'user-admin');
    database.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,1)')
      .run(id(), discontinuedBomId, 'product-003', 99, 0);

    database.prepare("DELETE FROM inventory WHERE product_id=?").run('product-002');
    database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
      .run('inv-mrp-p002', 'warehouse-001', 'product-002', 5);
    database.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'),?)")
      .run('receipt-mrp-001', 'PR-MRP-001', 'supplier-001', 'warehouse-001', 'user-warehouse', 0, 'CONFIRMED', '2026-09-02', '', 'user-admin', 'user-admin');
    database.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)')
      .run('receipt-item-mrp-001', 'receipt-mrp-001', 'product-002', 3, 0, 0);
    database.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,submitted_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'))")
      .run('so-mrp-001', 'SO-MRP-001', 'customer-001', 'APPROVED', 0, '', 'user-sales');
    database.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)')
      .run('so-item-mrp-001', 'so-mrp-001', 'product-001', 10, 0, 0);

    const retired = await request('/api/mrp-plans', { method: 'POST', body: { plan_type: 'SALES_ORDER', planned_date: '2026-09-02' } });
    assert.equal(retired.status, 410);
    const canonical = await request('/api/planning/mrp/runs');
    assert.equal(canonical.status, 200, canonical.data.error);
    assert.deepEqual(canonical.data.runs, []);
  });

  test('legacy MRP generate endpoint fails explicitly instead of silently succeeding', async () => {
    const response = await request('/api/mrp-plans/generate', { method: 'POST', body: { plan_id: 'missing', demand_type: 'BAD' } });
    assert.equal(response.status, 410);
  });

  test('routing operations GET returns 200 for empty and populated data without b.bom_code', async () => {
    const empty = await request('/api/routing-operations');
    assert.equal(empty.status, 200, empty.data.error);
    const bom = await request('/api/boms', { method: 'POST', body: { productId: 'product-004', version: 'routing', items: [{ productId: 'product-002', quantity: 1 }] } });
    assert.equal(bom.status, 200);
    const center = await request('/api/work-centers', { method: 'POST', body: { code: 'WC-MFG', name: 'Manufacturing Test Center' } });
    assert.equal(center.status, 201, center.data.error);
    const op = await request('/api/routing-operations', { method: 'POST', body: { bom_id: bom.data.id, operation_no: 10, work_center_id: center.data.id, work_time_minutes: 30 } });
    assert.equal(op.status, 201, op.data.error);
    const populated = await request('/api/routing-operations');
    assert.equal(populated.status, 200, populated.data.error);
    assert.ok(populated.data.operations.some((row) => row.id === op.data.id && row.bom_version === 'routing'));
  });
});
