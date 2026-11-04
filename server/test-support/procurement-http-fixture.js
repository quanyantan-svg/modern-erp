import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';

export async function createProcurementFixture(prefix) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, token = null, body, extraHeaders = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  async function login(username, password) {
    const result = await request('POST', '/api/auth/login', null, { username, password });
    assert.equal(result.status, 200, result.data.error);
    return result.data.token;
  }

  const tokens = {
    admin: await login('admin', 'admin123'),
    sales: await login('sales', 'sales123'),
    reviewer: await login('reviewer', 'review123'),
    warehouse: await login('warehouse', 'warehouse123'),
    accounting: await login('accounting', 'accounting123'),
    outsourcing: await login('outsourcing', 'outsourcing123'),
    outsourcingReceiving: await login('outsourcingreceiving', 'outsourcingreceiving123'),
  };

  async function close() {
    await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { db, baseUrl, request, tokens, close };
}

// M1C-PO-P02：同一委外订单终身最多一张加工费 PO，因此测试夹具按订单缓存
// 已创建的加工费 PO，重复调用返回同一张，而不是重新创建。
const processingPoCache = new WeakMap();

export async function createApprovedProcessingPo(fixture, orderId, key = `${Date.now()}-${Math.random()}`) {
  const perFixture = processingPoCache.get(fixture) || new Map();
  processingPoCache.set(fixture, perFixture);
  if (perFixture.has(orderId)) return perFixture.get(orderId);
  const po = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`, fixture.tokens.admin, {
    unitPriceCents: 500, orderDate: new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), paymentTerms: '30 days',
    supplierContactName: 'Supplier', supplierContactPhone: '13800000000', supplierAddress: 'Address',
  }, { 'idempotency-key': `po-${key}` });
  assert.equal(po.status, 201, po.data.error);
  assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fixture.tokens.admin)).status, 200);
  assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
  perFixture.set(orderId, po.data.id);
  return po.data.id;
}

export async function prepareOutsourcingReceiptSource(fixture, orderId, quantity, key = `${Date.now()}-${Math.random()}`) {
  const processingPoId = await createApprovedProcessingPo(fixture, orderId, key);
  const poItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
  const order = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
    businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId,
    warehouseId: 'warehouse-001', noticeDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: order.product_id, quantity }], idempotencyKey: `notice-${key}`,
  });
  assert.equal(notice.status, 201, notice.data.error);
  assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
  const noticeItem = fixture.db.prepare('SELECT * FROM receipt_notice_items WHERE notice_id=?').get(notice.data.id);
  return {
    processingPoId, processingPoItemId: poItem.id, sourceNoticeId: notice.data.id,
    sourceNoticeItemId: noticeItem.id, productId: order.product_id,
    unitCode: poItem.document_uom_code || 'EA', warehouseId: 'warehouse-001',
  };
}

export function outsourcingReceiptBody(source, quantity, processingFeeCents, date = new Date().toISOString().slice(0, 10)) {
  return {
    quantity, receivedDate: date, businessDate: date, processingFeeCents,
    processingPoId: source.processingPoId, sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
    items: [{ productId: source.productId, quantity, unitCode: source.unitCode,
      unitPriceCents: Number(processingFeeCents || 0) && Number.isSafeInteger(Number(processingFeeCents) / quantity)
        ? Number(processingFeeCents) / quantity : 0,
      processingPoItemId: source.processingPoItemId, sourceNoticeItemId: source.sourceNoticeItemId }],
  };
}

export function seedApprovedOutsourceBom(fixture, productId, items, key = `${Date.now()}-${Math.random()}`, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  const bomId = `bom-outsource-${key}`;
  const now = new Date().toISOString();
  fixture.db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,approval_status,approved_by,approved_at)
    VALUES(?,?,'1','ACTIVE','','user-admin',?,?,'OUTSOURCE',?,'APPROVED','user-admin',?)`)
    .run(bomId, productId, now, now, effectiveFrom, now);
  const insert = fixture.db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no)
    VALUES(?,?,?,?,0,?)`);
  items.forEach((item, index) => insert.run(`bomi-${key}-${index + 1}`, bomId, item.productId, item.requiredQuantity, index + 1));
  return bomId;
}
