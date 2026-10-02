import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let server;
let baseUrl;
let db;
let tempDir;
let adminToken;
let sequence = 0;
const at = '2026-10-02T08:00:00.000Z';

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}

function seedDelivery() {
  const n = ++sequence;
  const orderId = `r6-so-${n}`;
  const orderItemId = `r6-soi-${n}`;
  const deliveryId = `r6-sd-${n}`;
  const deliveryItemId = `r6-sdi-${n}`;
  db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,total_cents,status,creator_id,created_at,updated_at) VALUES(?,?,?,1000,'APPROVED','user-sales',?,?)").run(orderId, `SO-R6-${n}`, 'customer-001', at, at);
  db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(orderItemId, orderId, 'product-001', 2, 500, 1000);
  db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES(?,?,?,?,?,?,1000,'DRAFT',?,?, 'user-warehouse',?,?, 'SEPARATE')")
    .run(deliveryId, `SD-R6-${n}`, orderId, 'customer-001', 'warehouse-001', 'user-warehouse', '2026-10-15', 'UAT-002 fixture', at, at);
  db.prepare('INSERT INTO sales_delivery_items(id,delivery_id,sales_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?,1)')
    .run(deliveryItemId, deliveryId, orderItemId, 'product-001', 2, 500, 1000);
  return { deliveryId, deliveryItemId, orderId, orderItemId };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-uat-r6-oqc-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
});

after(async () => {
  await new Promise((done) => server.close(() => done()));
  db.close();
});

describe('UAT-002 OQC contextual navigation', () => {
  test('1. source contract: createQuality uses /api/oqc and captures inspectionId', () => {
    const source = readFileSync(resolve('src/pages/logistics-finance.jsx'), 'utf8');
    assert.match(source, /\/api\/oqc',\s*\{\s*method:\s*'POST',\s*body:\s*\{\s*sales_delivery_id:\s*value\.id\s*\}\s*\}\);/);
    assert.match(source, /navigateToPage\('oqc',\s*\{\s*documentId:\s*inspectionId/);
  });

  test('2. source contract: goOqc uses qualityState.inspectionId', () => {
    const source = readFileSync(resolve('src/pages/logistics-finance.jsx'), 'utf8');
    assert.match(source, /detail\?\.qualityState\?\.inspectionId/);
    assert.match(source, /qualityStateCode === 'INSPECTION_DRAFT'/);
    assert.match(source, /OQC_VIEW/);
  });

  test('3. source contract: QualityPage auto-opens inspection when target.documentId is provided', () => {
    const source = readFileSync(resolve('src/pages/quality.jsx'), 'utf8');
    assert.match(source, /useAppNavigation/);
    assert.match(source, /target\?\.documentId/);
    assert.match(source, /api\(`\/api\/\$\{kind\}\/\$\{targetId\}`\)/);
    assert.match(source, /返回\{kind === 'iqc' \? '采购入库' : '销售出库'\}/);
    assert.match(source, /onReturnToSource/);
  });

  test('3b. IQC regression keeps direct inspection context for the existing create/go/return flow', () => {
    const source = readFileSync(resolve('src/pages/logistics-finance.jsx'), 'utf8');
    assert.match(source, /documentType: 'IQC_INSPECTION'/);
    assert.match(source, /sourcePage: 'purchase-receipts'/);
  });

  test('4. creating OQC returns a single authoritative draft inspection and updates delivery state', async () => {
    const f = seedDelivery();
    const created = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(typeof created.data.id, 'string');
    const detail = await request(`/api/sales-deliveries/${f.deliveryId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.salesDelivery.qualityState.code, 'INSPECTION_DRAFT');
    assert.equal(detail.data.salesDelivery.qualityState.inspectionId, created.data.id);
  });

  test('5. second OQC creation for the same delivery is blocked by the canonical guard', async () => {
    const f = seedDelivery();
    const first = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(first.status, 201);
    const second = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(second.status, 409, JSON.stringify(second.data));
  });

  test('6. completing OQC as PASS allows sales delivery confirmation', async () => {
    const f = seedDelivery();
    const created = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(created.status, 201);
    const complete = await request(`/api/oqc/${created.data.id}/complete`, { method: 'POST', body: { result: 'PASS', passed_quantity: 2, failed_quantity: 0, inspection_quantity: 2 } });
    assert.equal(complete.status, 200, JSON.stringify(complete.data));
    const confirm = await request(`/api/sales-deliveries/${f.deliveryId}`, { method: 'POST', body: { action: 'confirm' } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
  });

  test('7. failing OQC blocks sales delivery confirmation', async () => {
    const f = seedDelivery();
    const created = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(created.status, 201);
    const complete = await request(`/api/oqc/${created.data.id}/complete`, { method: 'POST', body: { result: 'FAIL', passed_quantity: 0, failed_quantity: 2, inspection_quantity: 2, defect_reason: '外观破损', disposition: 'HOLD' } });
    assert.equal(complete.status, 200, JSON.stringify(complete.data));
    const confirm = await request(`/api/sales-deliveries/${f.deliveryId}`, { method: 'POST', body: { action: 'confirm' } });
    assert.equal(confirm.status, 409, JSON.stringify(confirm.data));
  });

  test('8. inspection detail endpoint returns inspection for contextual open', async () => {
    const f = seedDelivery();
    const created = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(created.status, 201);
    const detail = await request(`/api/oqc/${created.data.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.inspection.id, created.data.id);
    assert.equal(detail.data.inspection.sales_delivery_id, f.deliveryId);
  });

  test('9. FAIL inspection can be followed by one authoritative retest draft', async () => {
    const f = seedDelivery();
    const first = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    const failed = await request(`/api/oqc/${first.data.id}/complete`, { method: 'POST', body: { result: 'FAIL', passed_quantity: 0, failed_quantity: 2, inspection_quantity: 2, defect_reason: '外观破损', disposition: 'HOLD' } });
    assert.equal(failed.status, 200, JSON.stringify(failed.data));
    const retest = await request('/api/oqc', { method: 'POST', body: { sales_delivery_id: f.deliveryId } });
    assert.equal(retest.status, 201, JSON.stringify(retest.data));
    assert.notEqual(retest.data.id, first.data.id);
    const detail = await request(`/api/sales-deliveries/${f.deliveryId}`);
    assert.equal(detail.data.salesDelivery.qualityState.code, 'INSPECTION_DRAFT');
    assert.equal(detail.data.salesDelivery.qualityState.inspectionId, retest.data.id);
  });
});
