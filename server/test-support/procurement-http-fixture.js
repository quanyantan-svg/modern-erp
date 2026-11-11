import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';

export async function createProcurementFixture(prefix) {
  if (process.env.ERP_TEST_DB_BACKEND === 'mysql') {
    return createMySqlProcurementFixture(prefix);
  }
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

/**
 * The MySQL path of the procurement HTTP fixture.
 *
 * Inside a protected MySQL gate the schema is **already bootstrapped** by the
 * Root's BOOTSTRAP_CURRENT_SCHEMA child, so this process must never call
 * `createDatabase()` (that would re-run the migration/DDL chain outside the
 * approved operation scope) and must never drop the schema either — the
 * Root's CLEANUP_SCHEMA_POST_RUN child owns that. The fixture therefore opens
 * the identity-pinned existing session and, on close, only closes its own
 * connection.
 */
async function createMySqlProcurementFixture(prefix) {
  const { openOut001MySqlAdapter, deferMySqlCleanup } = await import('../test-utils/mysql-out001-target.js');
  const targetProofPath = String(process.env.ERP_OUT_001_TARGET_PROOF || '').trim();
  if (!targetProofPath) {
    throw new Error('PROCUREMENT FIXTURE: ERP_OUT_001_TARGET_PROOF is required on the MySQL path');
  }
  deferMySqlCleanup(`OUT-001 MySQL gate (${prefix}): the schema cleanup belongs to the Root CLEANUP_SCHEMA_POST_RUN child`);
  const { db } = openOut001MySqlAdapter({ targetProofPath });
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
    // Only this process's own connection is closed. The schema stays exactly
    // as the Root's cleanup child has to find it.
    db.close();
  }

  return { db, baseUrl, request, tokens, close };
}

/**
 * Give a supplier/product pair an effective OUTSOURCE source list entry.
 *
 * OUT-02：委外订单创建时必须消费有效 `source_type='OUTSOURCE'` 货源；货源
 * 控制的采购参数开关对委外同样生效。因此任何要创建委外订单的测试必须先
 * 表达这条业务事实 —— 与 `seedPurchasePrice` 表达采购价格事实同理。
 */
export async function seedOutsourceSource(fixture, entries, token = fixture.tokens.admin) {
  for (const entry of entries) {
    const result = await fixture.request('POST', '/api/procurement/source-entries', token, {
      supplierId: entry.supplierId,
      productId: entry.productId,
      sourceType: 'OUTSOURCE',
      effectiveFrom: entry.effectiveFrom || '2020-01-01',
    });
    assert.equal(result.status, 201, result.data.error);
  }
}

/**
 * Give a supplier/product pair an effective purchase price.
 *
 * An ordinary purchase order fails closed without an effective supplier price
 * (Active Design §26.36.3 / §31.16 PRC-DLV-02): the purchase price list IS
 * the commercial estimate source, so a test that creates a standard purchase
 * order must first express that business fact.
 */
export async function seedPurchasePrice(fixture, entries, token = fixture.tokens.admin) {
  for (const entry of entries) {
    const result = await fixture.request('POST', '/api/procurement/price-list', token, {
      supplierId: entry.supplierId,
      productId: entry.productId,
      sourceType: entry.sourceType || 'PURCHASE',
      pricingUomCode: entry.pricingUomCode || 'EA',
      unitPriceCents: entry.unitPriceCents,
      effectiveFrom: entry.effectiveFrom || '2020-01-01',
    });
    assert.equal(result.status, 201, result.data.error);
  }
}

/**
 * Insert one effective purchase price directly, for suites that own their own
 * HTTP server instead of the shared procurement fixture.
 *
 * The version and effective-window behaviour mirrors the production price
 * list writer: a new entry closes the previous open entry of the same
 * supplier / product / source / pricing unit and takes the next version, so
 * calling this twice behaves like a price adjustment.
 */
export function insertPurchasePrice(db, {
  id = `price-${Math.random().toString(36).slice(2)}`, supplierId, productId,
  pricingUomCode = 'EA', unitPriceCents, effectiveFrom = '2020-01-01',
}) {
  const version = Number(db.prepare(`SELECT COALESCE(MAX(version),0)+1 n FROM purchase_price_list_entries
    WHERE supplier_id=? AND product_id=? AND source_type='PURCHASE' AND pricing_uom_code=?`)
    .get(supplierId, productId, pricingUomCode).n);
  db.prepare(`UPDATE purchase_price_list_entries SET effective_to=? WHERE supplier_id=? AND product_id=?
      AND source_type='PURCHASE' AND pricing_uom_code=? AND effective_to IS NULL`)
    .run(effectiveFrom, supplierId, productId, pricingUomCode);
  db.prepare(`INSERT INTO purchase_price_list_entries(id,supplier_id,product_id,source_type,pricing_uom_code,unit_price_cents,status,effective_from,effective_to,version,created_by,created_at)
    VALUES(?,?,?,'PURCHASE',?,?,'ACTIVE',?,NULL,?,'user-admin',?)`)
    .run(id, supplierId, productId, pricingUomCode, unitPriceCents, effectiveFrom, version, new Date().toISOString());
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

/**
 * 委外用料快照的**唯一**建立入口（Requirement §31.15 / 已批准 `MC-REQ-03`）。
 *
 * 快照只能在 DRAFT 阶段首次形成：`CONFIRM_PLAN` 与 `RELEASE` 都要求快照已可证明，
 * 已确认计划或已下达的订单补建快照一律被后端拒绝。因此测试必须先建快照再推进状态。
 */
export async function snapshotOutsourcingMaterials(fixture, orderId, materials, token = fixture.tokens.admin) {
  const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, token, {
    items: materials.map((item) => ({
      productId: item.productId,
      sourceWarehouseId: item.sourceWarehouseId || 'warehouse-001',
    })),
  });
  assert.equal(snapshot.status, 200, snapshot.data.error);
  return snapshot.data;
}

/**
 * 委外订单的 DRAFT → 已下达 标准路径：先建用料快照，再确认计划、下达。
 * 动作名是精确合同（`CONFIRM_PLAN` / `RELEASE`），不再使用旧的 `NEXT`。
 */
export async function releaseOutsourcingOrder(fixture, orderId, {
  materials = [], token = fixture.tokens.admin,
} = {}) {
  if (materials.length) await snapshotOutsourcingMaterials(fixture, orderId, materials, token);
  const confirm = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, token, { action: 'CONFIRM_PLAN' });
  assert.equal(confirm.status, 200, confirm.data.error);
  const release = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, token, { action: 'RELEASE' });
  assert.equal(release.status, 200, release.data.error);
  return orderId;
}
