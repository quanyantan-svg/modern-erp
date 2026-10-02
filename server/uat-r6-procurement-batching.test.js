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
let reviewerToken;
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

function ensureSupplier(id, code, name) {
  db.prepare('INSERT OR IGNORE INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
    .run(id, code, name, '林女士', '0592-5550000', '福建省厦门市软件园', at, at);
}

function ensureProduct(id, code, name, priceCents) {
  db.prepare("INSERT OR IGNORE INTO products(id,code,name,unit,price_cents,active,created_at,updated_at) VALUES(?,?,?,'PCS',?,1,?,?)")
    .run(id, code, name, priceCents, at, at);
}

function seedApprovedRequisition(lines) {
  const n = ++sequence;
  const requisitionId = `r6-batch-req-${n}`;
  db.prepare("INSERT INTO purchase_requisitions(id,requisition_no,status,request_date,required_date,notes,creator_id,reviewer_id,created_at,updated_at) VALUES(?,?,'APPROVED','2026-10-02','2026-10-20','UAT-005','user-sales','user-reviewer',?,?)")
    .run(requisitionId, `PREQ-R6-${n}`, at, at);
  const result = [];
  lines.forEach((line, index) => {
    const itemId = `r6-batch-item-${n}-${index + 1}`;
    const amount = line.quantity * line.unitPriceCents;
    db.prepare('INSERT INTO purchase_requisition_items(id,requisition_id,product_id,quantity,preferred_supplier_id,unit_price_cents,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(itemId, requisitionId, line.productId, line.quantity, line.supplierId || null, line.unitPriceCents, amount, at);
    result.push({ ...line, itemId });
  });
  return { requisitionId, items: result };
}

async function batch(items) {
  return request('/api/purchase-requisitions/batch-generate-purchase-orders', {
    method: 'POST',
    body: { paymentTerms: '月结 30 天', items },
  });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-uat-r6-batching-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  ensureSupplier('r6-supplier-a', 'SUP-HX', '深圳华芯电子科技有限公司');
  ensureSupplier('r6-supplier-b', 'SUP-MX', '苏州敏芯传感科技有限公司');
  ensureProduct('r6-pcb', 'RM-PCB-200', 'TC200控制主板', 12800);
  ensureProduct('r6-lcd', 'RM-LCD-240', '2.4寸LCD显示模组', 8600);
  ensureProduct('r6-sensor', 'RM-SENSOR-TH01', '数字温湿度传感器', 3500);
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  reviewerToken = await login('reviewer', 'review123');
});

after(async () => {
  await new Promise((done) => server.close(() => done()));
  db.close();
});

describe('UAT-005 procurement batching', () => {
  test('1. same supplier multiple products become one multi-line PO with source identities', async () => {
    const source = seedApprovedRequisition([
      { productId: 'r6-pcb', quantity: 30, unitPriceCents: 12800, supplierId: 'r6-supplier-a' },
      { productId: 'r6-lcd', quantity: 25, unitPriceCents: 8600, supplierId: 'r6-supplier-a' },
    ]);
    const response = await batch(source.items.map((item) => ({ purchaseRequisitionItemId: item.itemId, supplierId: item.supplierId, quantity: item.quantity })));
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(response.data.purchaseOrders.length, 1);
    const po = await request(`/api/purchase-orders/${response.data.purchaseOrders[0].id}`);
    assert.equal(po.status, 200);
    assert.equal(po.data.order.items.length, 2);
    assert.deepEqual(new Set(po.data.order.items.map((item) => item.purchaseRequisitionItemId)), new Set(source.items.map((item) => item.itemId)));
  });

  test('2. different suppliers become separate POs and never share a header', async () => {
    const source = seedApprovedRequisition([
      { productId: 'r6-pcb', quantity: 30, unitPriceCents: 12800, supplierId: 'r6-supplier-a' },
      { productId: 'r6-sensor', quantity: 40, unitPriceCents: 3500, supplierId: 'r6-supplier-b' },
    ]);
    const response = await batch(source.items.map((item) => ({ purchaseRequisitionItemId: item.itemId, supplierId: item.supplierId, quantity: item.quantity })));
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(response.data.purchaseOrders.length, 2);
    assert.deepEqual(new Set(response.data.purchaseOrders.map((order) => order.supplierId)), new Set(['r6-supplier-a', 'r6-supplier-b']));
    for (const order of response.data.purchaseOrders) {
      const supplierIds = db.prepare('SELECT DISTINCT po.supplier_id supplierId FROM purchase_orders po JOIN purchase_order_items i ON i.order_id=po.id WHERE po.id=?').all(order.id);
      assert.equal(supplierIds.length, 1);
      assert.equal(supplierIds[0].supplierId, order.supplierId);
    }
  });

  test('3. partial conversion preserves remaining quantity and prevents over-conversion atomically', async () => {
    const source = seedApprovedRequisition([{ productId: 'r6-pcb', quantity: 10, unitPriceCents: 12800, supplierId: 'r6-supplier-a' }]);
    const first = await batch([{ purchaseRequisitionItemId: source.items[0].itemId, supplierId: 'r6-supplier-a', quantity: 4 }]);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const detail = await request(`/api/purchase-requisitions/${source.requisitionId}`);
    assert.equal(detail.data.requisition.items[0].orderedQuantity, 4);
    assert.equal(detail.data.requisition.items[0].remainingQuantity, 6);
    const before = Number(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n);
    const excessive = await batch([{ purchaseRequisitionItemId: source.items[0].itemId, supplierId: 'r6-supplier-a', quantity: 7 }]);
    assert.equal(excessive.status, 409, JSON.stringify(excessive.data));
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n), before);
    const rest = await batch([{ purchaseRequisitionItemId: source.items[0].itemId, supplierId: 'r6-supplier-a', quantity: 6 }]);
    assert.equal(rest.status, 201, JSON.stringify(rest.data));
  });

  test('4. preferred-supplier conflict rolls back the whole batch', async () => {
    const source = seedApprovedRequisition([
      { productId: 'r6-pcb', quantity: 3, unitPriceCents: 12800, supplierId: 'r6-supplier-a' },
      { productId: 'r6-lcd', quantity: 2, unitPriceCents: 8600, supplierId: 'r6-supplier-a' },
    ]);
    const before = Number(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n);
    const response = await batch([
      { purchaseRequisitionItemId: source.items[0].itemId, supplierId: 'r6-supplier-a', quantity: 3 },
      { purchaseRequisitionItemId: source.items[1].itemId, supplierId: 'r6-supplier-b', quantity: 2 },
    ]);
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n), before);
  });

  test('5. grouped PO follows normal approval and supports a multi-line purchase receipt', async () => {
    const source = seedApprovedRequisition([
      { productId: 'r6-pcb', quantity: 3, unitPriceCents: 12800, supplierId: 'r6-supplier-a' },
      { productId: 'r6-lcd', quantity: 2, unitPriceCents: 8600, supplierId: 'r6-supplier-a' },
    ]);
    const grouped = await batch(source.items.map((item) => ({ purchaseRequisitionItemId: item.itemId, supplierId: item.supplierId, quantity: item.quantity })));
    const orderId = grouped.data.purchaseOrders[0].id;
    const submit = await request(`/api/purchase-orders/${orderId}/submit`, { method: 'POST', body: {} });
    assert.equal(submit.status, 200, JSON.stringify(submit.data));
    const approve = await request(`/api/purchase-orders/${orderId}/approve`, { token: reviewerToken, method: 'POST', body: {} });
    assert.equal(approve.status, 200, JSON.stringify(approve.data));
    const order = (await request(`/api/purchase-orders/${orderId}`)).data.order;
    const receipt = await request('/api/purchase-receipts', { method: 'POST', body: {
      purchaseOrderId: orderId,
      supplierId: order.supplierId,
      warehouseId: 'warehouse-001',
      receiptDate: '2026-10-20',
      items: order.items.map((item) => ({ purchaseOrderItemId: item.id, productId: item.productId, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
    } });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const receiptDetail = await request(`/api/purchase-receipts/${receipt.data.id}`);
    assert.equal(receiptDetail.status, 200, JSON.stringify(receiptDetail.data));
    assert.equal(receiptDetail.data.purchaseReceipt.items.length, 2);
  });

  test('6. source contract exposes user-assisted batch grouping without a new supplier schema', () => {
    const frontend = readFileSync(resolve('src/pages/planning-documents.jsx'), 'utf8');
    const backend = readFileSync(resolve('server/modules/planning-documents.js'), 'utf8');
    assert.match(frontend, /批量生成采购订单/);
    assert.match(frontend, /batch-generate-purchase-orders/);
    assert.match(frontend, /paymentTerms: paymentTerms\.trim\(\)/);
    assert.match(frontend, /const requisitionKey = requisitions\.map/);
    assert.match(frontend, /\}, \[requisitionKey\]\);/);
    assert.match(backend, /purchase_requisition_item_id/);
    assert.match(backend, /groups\.set\(assignment\.supplierId/);
    assert.match(backend, /UPDATE purchase_requisition_items SET quantity=quantity WHERE id=\?/);
    assert.doesNotMatch(backend, /preferred_supplier.*ALTER TABLE/i);
  });
});
