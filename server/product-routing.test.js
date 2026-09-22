import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, id, PERMISSIONS } from './db.js';

let tempDir;
let db;
let server;
let baseUrl;
let tokens;

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.token;
}

async function request(path, { token = tokens.admin, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
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

function routingBody(overrides = {}) {
  return {
    productId: 'product-004',
    routingCode: 'ROUTE-DEMO-V1',
    routingName: '演示成品标准工序',
    version: 'V1',
    status: 'ACTIVE',
    notes: 'planning only',
    operations: [
      { sequenceNo: 30, operationCode: 'INSPECT', operationName: '检验', workCenter: '检验工位', setupMinutes: 3, runMinutesPerUnit: 1 },
      { sequenceNo: 10, operationCode: 'CUT', operationName: '下料', workCenter: '下料工位', setupMinutes: 5, runMinutesPerUnit: 2 },
      { sequenceNo: 20, operationCode: 'ASSEMBLE', operationName: '装配', workCenter: '装配工位', setupMinutes: 8, runMinutesPerUnit: 4 },
      { sequenceNo: 40, operationCode: 'PACK', operationName: '包装', workCenter: '包装工位', setupMinutes: 0, runMinutesPerUnit: 0.5 },
    ],
    ...overrides,
  };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-routing-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokens = {
    admin: await login('admin', 'admin123'),
    sales: await login('sales', 'sales123'),
    reviewer: await login('reviewer', 'review123'),
    warehouse: await login('warehouse', 'warehouse123'),
    accounting: await login('accounting', 'accounting123'),
  };
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('M10 schema and legacy safety', () => {
  test('canonical tables, checks and one-active index exist', () => {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    assert.ok(tables.has('product_routings'));
    assert.ok(tables.has('product_routing_operations'));
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_product_routings_one_active'").get();
    assert.match(index.sql, /WHERE status='ACTIVE'/);
  });

  test('legacy BOM-bound operations migrate once as inactive historical routing', () => {
    const path = join(tempDir, 'legacy.db');
    let legacy = createDatabase(path);
    const bomId = id();
    legacy.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'ACTIVE','',?,datetime('now'),datetime('now'))")
      .run(bomId, 'product-001', 'LEGACY-V1', 'user-admin');
    legacy.prepare("INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,active,created_at) VALUES(?,?,?,'PRODUCTION',0,1,0,1,datetime('now'))")
      .run('legacy-wc', 'LEG-WC', '历史工作中心');
    legacy.prepare('INSERT INTO routing_operations(id,bom_id,operation_no,work_center_id,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('legacy-op', bomId, 10, 'legacy-wc', 12, 4, 0, 0, 'legacy note');
    legacy.close();

    legacy = createDatabase(path);
    const migrated = legacy.prepare("SELECT * FROM product_routings WHERE id=?").get(`legacy-routing-${bomId}`);
    assert.equal(migrated.product_id, 'product-001');
    assert.equal(migrated.status, 'INACTIVE');
    assert.equal(legacy.prepare('SELECT COUNT(*) count FROM product_routing_operations WHERE routing_id=?').get(migrated.id).count, 1);
    legacy.close();

    legacy = createDatabase(path);
    assert.equal(legacy.prepare('SELECT COUNT(*) count FROM product_routings WHERE id=?').get(`legacy-routing-${bomId}`).count, 1);
    assert.equal(legacy.prepare('SELECT COUNT(*) count FROM product_routing_operations WHERE routing_id=?').get(`legacy-routing-${bomId}`).count, 1);
    legacy.close();
  });
});

describe('M10 permission and role contract', () => {
  test('reuses registered ROUTING_VIEW and ROUTING_MANAGE without changing permission count', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.equal(codes.length, 113);
    assert.ok(codes.includes('ROUTING_VIEW'));
    assert.ok(codes.includes('ROUTING_MANAGE'));
  });

  test('admin can manage and four non-admin roles cannot view or mutate routing master data', async () => {
    assert.equal((await request('/api/product-routings')).status, 200);
    for (const role of ['sales', 'reviewer', 'warehouse', 'accounting']) {
      assert.equal((await request('/api/product-routings', { token: tokens[role] })).status, 403, role);
      assert.equal((await request('/api/product-routings', { token: tokens[role], method: 'POST', body: routingBody() })).status, 403, role);
    }
  });
});

describe('M10 routing lifecycle and validation', () => {
  let routingId;

  test('admin creates, lists and reads a routing with deterministic operation order', async () => {
    const effectsBefore = {
      inventory: db.prepare('SELECT COUNT(*) count FROM inventory_transactions').get().count,
      vouchers: db.prepare('SELECT COUNT(*) count FROM accounting_vouchers').get().count,
    };
    const created = await request('/api/product-routings', { method: 'POST', body: routingBody() });
    assert.equal(created.status, 201, created.data.error);
    routingId = created.data.id;
    const list = await request('/api/product-routings?search=%E6%BC%94%E7%A4%BA&product_id=product-004&status=ACTIVE');
    assert.equal(list.status, 200);
    assert.equal(list.data.routings.length, 1);
    assert.equal(list.data.routings[0].operation_count, 4);
    const detail = await request(`/api/product-routings/${routingId}`);
    assert.deepEqual(detail.data.routing.operations.map((operation) => operation.sequence_no), [10, 20, 30, 40]);
    assert.deepEqual({
      inventory: db.prepare('SELECT COUNT(*) count FROM inventory_transactions').get().count,
      vouchers: db.prepare('SELECT COUNT(*) count FROM accounting_vouchers').get().count,
    }, effectsBefore);
    const approvals = readFileSync(new URL('./modules/approvals.js', import.meta.url), 'utf8');
    assert.doesNotMatch(approvals, /PRODUCT_ROUTING|product_routings/);
  });

  test('missing product, invalid code and missing operation name return 400', async () => {
    assert.equal((await request('/api/product-routings', { method: 'POST', body: routingBody({ productId: 'missing', routingCode: 'MISSING' }) })).status, 400);
    assert.equal((await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'bad code', status: 'INACTIVE' }) })).status, 400);
    assert.equal((await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'NO-NAME', status: 'INACTIVE', operations: [{ sequenceNo: 10, operationCode: 'OP10' }] }) })).status, 400);
  });

  test('duplicate sequence and negative planning times are rejected', async () => {
    const duplicate = routingBody({ routingCode: 'DUP-SEQ', status: 'INACTIVE', operations: [
      { sequenceNo: 10, operationCode: 'A', operationName: 'A' }, { sequenceNo: 10, operationCode: 'B', operationName: 'B' },
    ] });
    assert.equal((await request('/api/product-routings', { method: 'POST', body: duplicate })).status, 409);
    assert.equal((await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'NEG-SETUP', status: 'INACTIVE', operations: [{ sequenceNo: 10, operationCode: 'A', operationName: 'A', setupMinutes: -1 }] }) })).status, 400);
    assert.equal((await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'NEG-RUN', status: 'INACTIVE', operations: [{ sequenceNo: 10, operationCode: 'A', operationName: 'A', runMinutesPerUnit: -1 }] }) })).status, 400);
  });

  test('only one active routing per product is allowed', async () => {
    const conflict = await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'ROUTE-DEMO-V2', version: 'V2', operations: [], status: 'ACTIVE' }) });
    assert.equal(conflict.status, 409);
    const inactive = await request('/api/product-routings', { method: 'POST', body: routingBody({ routingCode: 'ROUTE-DEMO-V2', version: 'V2', operations: [], status: 'INACTIVE' }) });
    assert.equal(inactive.status, 201);
    assert.equal((await request(`/api/product-routings/${inactive.data.id}/activate`, { method: 'POST' })).status, 409);
  });

  test('operation create, edit, reorder and delete endpoints work without inferring database id order', async () => {
    const created = await request(`/api/product-routings/${routingId}/operations`, { method: 'POST', body: { sequenceNo: 50, operationCode: 'STORE', operationName: '入库准备', setupMinutes: 0, runMinutesPerUnit: 1 } });
    assert.equal(created.status, 201, created.data.error);
    assert.equal((await request(`/api/product-routings/${routingId}/operations/${created.data.id}`, { method: 'PATCH', body: { sequenceNo: 25, operationCode: 'STORE', operationName: '中间检验', setupMinutes: 1, runMinutesPerUnit: 2 } })).status, 200);
    const ordered = await request(`/api/product-routings/${routingId}`);
    assert.deepEqual(ordered.data.routing.operations.map((operation) => operation.sequence_no), [10, 20, 25, 30, 40]);
    assert.equal((await request(`/api/product-routings/${routingId}/operations/${created.data.id}`, { method: 'DELETE' })).status, 200);
  });

  test('inactive routing remains readable but no longer appears as production order active relation', async () => {
    const order = await request('/api/production-orders', { method: 'POST', body: { productId: 'product-004', quantity: 1, plannedStart: '2026-09-18' } });
    assert.equal(order.status, 200, order.data.error);
    const related = await request(`/api/production-orders/${order.data.id}`);
    assert.equal(related.data.order.activeRoutingId, routingId);
    assert.equal((await request(`/api/product-routings/${routingId}/deactivate`, { method: 'POST' })).status, 200);
    const inactive = await request(`/api/product-routings/${routingId}`);
    assert.equal(inactive.data.routing.status, 'INACTIVE');
    const noRelation = await request(`/api/production-orders/${order.data.id}`);
    assert.equal(noRelation.data.order.activeRoutingId, null);
  });
});

describe('M10 frontend and navigation contracts', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/pages/product-routing.jsx', import.meta.url), 'utf8');
  const metadata = readFileSync(new URL('../src/navigation/applicationMetadata.js', import.meta.url), 'utf8');
  const overview = readFileSync(new URL('../src/pages/business-overview.jsx', import.meta.url), 'utf8');
  const manufacturing = readFileSync(new URL('../src/pages/manufacturing.jsx', import.meta.url), 'utf8');

  test('canonical SPA navigation and mobile application metadata expose the admin-only application', () => {
    assert.match(app, /key: 'product-routings'.*ROUTING_VIEW.*ROUTING_MANAGE/);
    assert.match(app, /'product-routings': <ProductRoutings/);
    assert.match(metadata, /page: 'product-routings', mobileLabel: '制品工序标准'/);
    assert.doesNotMatch(page, /location\.hash|window\.location/);
  });

  test('canonical list, detail cards and editor are present without duplicate variants or execution semantics', () => {
    for (const contract of ['RecordList', 'RecordCard', 'routing-operation-card', 'routing-operation-editor', 'sequenceNo', 'setupMinutes', 'runMinutesPerUnit']) assert.match(page, new RegExp(contract));
    assert.doesNotMatch(page, /routing-list-mobile|routing-list-desktop/);
    assert.doesNotMatch(page, /drag|drop|labor reporting|machine reporting/i);
  });

  test('product, production-order and business overview integrations use product routing as sibling master data', () => {
    assert.match(overview, /\['制品工序标准', 'product-routings'\]/);
    assert.match(manufacturing, /activeRoutingId/);
    assert.match(manufacturing, /page="product-routings"/);
  });
});
