// M1C-WP2..WP7 precursor — 加工费 PO 正式可达生产路径合同矩阵。
//
// Contract source:
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §3 / §5.5 /
//     §6 / §7 / §8.1 / §9.5（M1C-D-PO01 已批准并融合）
//   - Amendment 候审快照 docs/reviews/m1/
//     procurement-outsourcing-m1-core-processing-po-design-amendment.md §2..§10
//
// Positive evidence is produced only through the production HTTP API. The
// suite owns one disposable temporary SQLite file and never touches a project,
// development or production database, and never touches MySQL.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProcurementFixture, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runtimeServerSources() {
  const base = resolve(root, 'server');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && !entry.endsWith('.test.js') && !entry.includes('.integration.js')) files.push(full);
    }
  };
  walk(base);
  return files.filter((file) => !file.includes(`${join('server', 'migrations')}`)).map((file) => ({ file, source: readFileSync(file, 'utf8') }));
}

describe('M1C processing PO canonical production path', () => {
  let fixture;
  let orderId;
  let adminCreatedOrderId;
  let normalizationOrderId;
  let raceOrderId;
  let processingPoId;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const businessBody = (overrides = {}) => ({
    unitPriceCents: 50, orderDate: isoDate(), expectedDeliveryDate: isoDate(7), paymentTerms: '30 days',
    supplierContactName: 'Supplier', supplierContactPhone: '13800000000', supplierAddress: 'Address',
    remark: 'processing', ...overrides,
  });

  const countAudits = (entityType, entityId = null) => fixture.db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id IS ?",
  ).get(entityType, entityId).n;

  const poSnapshot = () => ({
    orders: fixture.db.prepare('SELECT * FROM purchase_orders ORDER BY id').all(),
    items: fixture.db.prepare('SELECT * FROM purchase_order_items ORDER BY id').all(),
    audits: fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE' AND entity_type='PURCHASE_ORDER'").get().n,
  });

  const releaseOrder = async (quantity, token = fixture.tokens.admin) => {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0 }], `m1c-po-${Date.now()}-${Math.random()}`);
    const created = await fixture.request('POST', '/api/procurement/outsourcing/orders', token, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: quantity, unit: 'EA', businessDate: isoDate(), bomId,
    });
    assert.equal(created.status, 201, created.data.error);
    const id = created.data.id;
    // 用料快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03）。
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/material-list`, token, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, token, { action: 'CONFIRM_PLAN' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, token, { action: 'RELEASE' })).status, 200);
    return id;
  };

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-processing-po-');
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    assert.equal(qualified.status, 200, qualified.data.error);
    orderId = await releaseOrder(10);
    adminCreatedOrderId = await releaseOrder(4);
    normalizationOrderId = await releaseOrder(3);
    raceOrderId = await releaseOrder(5);
  });
  after(async () => fixture.close());

  test('通用 PO API 只创建标准 PO，客户端类型/来源字段一律 400', async () => {
    const forbidden = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      businessType: 'OUTSOURCE_PROCESSING', sourceOutsourcingOrderId: orderId,
      supplierId: 'supplier-001', items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 50 }],
    });
    assert.equal(forbidden.status, 400);
    assert.equal(forbidden.data.code, 'PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n, 0,
      '被拒的通用 PO 创建不得留下任何 PO');

    const snake = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      business_type: 'OUTSOURCE_PROCESSING', source_outsourcing_order_id: orderId,
      supplierId: 'supplier-001', items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 50 }],
    });
    assert.equal(snake.status, 400);
    assert.equal(snake.data.code, 'PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE');
  });

  test('显式创建得到单行 DRAFT 加工费 PO，来源快照正确且无自动审批与财务/库存副作用', async () => {
    const before = poSnapshot();
    const created = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'processing-po-1' });
    assert.equal(created.status, 201, created.data.error);
    processingPoId = created.data.id;

    const order = fixture.db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(processingPoId);
    assert.equal(order.status, 'DRAFT');
    assert.equal(order.business_type, 'OUTSOURCE_PROCESSING');
    assert.equal(order.source_outsourcing_order_id, orderId);
    assert.equal(order.supplier_id, 'supplier-001');
    assert.equal(order.total_cents, 500);
    assert.equal(order.reviewer_id, null, '创建不得自动审批');

    const items = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').all(processingPoId);
    assert.equal(items.length, 1, '加工费 PO 首期恰好一条来源锁定行');
    assert.equal(items[0].product_id, 'product-001');
    assert.equal(Number(items[0].quantity), 10);
    assert.equal(items[0].unit_price_cents, 50);
    assert.equal(items[0].amount_cents, 500);
    assert.equal(items[0].document_uom_code, 'EA');
    assert.equal(Number(items[0].document_quantity_num), 10);
    assert.equal(Number(items[0].document_quantity_den), 1);
    assert.equal(Number(items[0].base_quantity_num), 10);
    assert.equal(Number(items[0].base_quantity_den), 1);

    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_PROCESSING'").get().n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?", processingPoId).get().n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE' AND entity_type='PURCHASE_ORDER'").get().n,
      before.audits + 1, '成功创建恰好一条成功审计');
  });

  test('同 Key 同规范请求精确重放，同 Key 异内容与异 Key 同源均精确 409', async () => {
    const replay = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'processing-po-1' });
    assert.equal(replay.status, 200, replay.data.error);
    assert.equal(replay.data.id, processingPoId);
    assert.equal(replay.data.replayed, true);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE source_outsourcing_order_id=?').get(orderId).n, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE' AND entity_type='PURCHASE_ORDER'").get().n, 1,
      '精确重放不得新增成功审计');

    const conflict = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody({ unitPriceCents: 51 }), { 'idempotency-key': 'processing-po-1' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, 'PROCESSING_PO_IDEMPOTENCY_CONFLICT');

    const otherKey = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'processing-po-2' });
    assert.equal(otherKey.status, 409);
    assert.equal(otherKey.data.code, 'OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE source_outsourcing_order_id=?').get(orderId).n, 1,
      '同源终身唯一：不得产生第二张加工费 PO');
  });

  test('缺省可选文本与显式空串是等价规范输入，fingerprint 一致', async () => {
    const withoutRemark = {
      unitPriceCents: 60, orderDate: isoDate(), expectedDeliveryDate: isoDate(7), paymentTerms: '30 days',
      supplierContactName: 'Supplier', supplierContactPhone: '13800000000', supplierAddress: 'Address',
    };
    const created = await fixture.request('POST', `/api/procurement/outsourcing/orders/${normalizationOrderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, withoutRemark, { 'idempotency-key': 'normalization-1' });
    assert.equal(created.status, 201, created.data.error);
    const equivalent = await fixture.request('POST', `/api/procurement/outsourcing/orders/${normalizationOrderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, { ...withoutRemark, remark: '' }, { 'idempotency-key': 'normalization-1' });
    assert.equal(equivalent.status, 200, equivalent.data.error);
    assert.equal(equivalent.data.replayed, true);
    assert.equal(equivalent.data.id, created.data.id);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE source_outsourcing_order_id=?').get(normalizationOrderId).n, 1);
  });

  test('不同 Key 并发创建只有一方 201，另一方稳定 409 且无部分写入', async () => {
    const [left, right] = await Promise.all([
      fixture.request('POST', `/api/procurement/outsourcing/orders/${raceOrderId}/processing-fee-purchase-orders`,
        fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'race-a' }),
      fixture.request('POST', `/api/procurement/outsourcing/orders/${raceOrderId}/processing-fee-purchase-orders`,
        fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'race-b' }),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [201, 409], '并发下只有一方创建成功');
    const loser = left.status === 409 ? left : right;
    assert.equal(loser.data.code, 'OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS');
    const winnerId = fixture.db.prepare('SELECT id FROM purchase_orders WHERE source_outsourcing_order_id=?').get(raceOrderId).id;
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE source_outsourcing_order_id=?').get(raceOrderId).n, 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_order_items WHERE order_id=?').get(winnerId).n, 1,
      '失败方不得留下部分写入的行');
  });

  test('非创建人原位修改商业字段，Item ID 与来源快照永久稳定', async () => {
    const beforeItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
    const update = await fixture.request('PUT', `/api/purchase-orders/${processingPoId}`, fixture.tokens.sales, {
      supplierId: 'supplier-001', orderDate: isoDate(), expectedDeliveryDate: isoDate(8), paymentTerms: '45 days',
      supplierContactName: 'Updated', supplierContactPhone: '13900000000', supplierAddress: 'Updated address', remark: 'updated',
      items: [{ productId: 'product-001', quantity: 10, uomCode: beforeItem.document_uom_code, unitPriceCents: 60 }],
    });
    assert.equal(update.status, 200, update.data.error);
    const afterItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
    assert.equal(afterItem.id, beforeItem.id, 'Item ID 必须稳定');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_order_items WHERE order_id=?').get(processingPoId).n, 1);
    assert.equal(afterItem.unit_price_cents, 60);
    assert.equal(afterItem.amount_cents, 600);
    assert.equal(afterItem.product_id, beforeItem.product_id);
    assert.equal(afterItem.document_uom_code, beforeItem.document_uom_code);
    assert.equal(afterItem.document_quantity_num, beforeItem.document_quantity_num);
    assert.equal(afterItem.document_quantity_den, beforeItem.document_quantity_den);
    assert.equal(afterItem.conversion_numerator, beforeItem.conversion_numerator);
    assert.equal(afterItem.base_quantity_num, beforeItem.base_quantity_num);
    const header = fixture.db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(processingPoId);
    assert.equal(header.total_cents, 600);
    assert.equal(header.payment_terms, '45 days');
    assert.equal(header.business_type, 'OUTSOURCE_PROCESSING');
    assert.equal(header.source_outsourcing_order_id, orderId);
  });

  test('来源、数量、UOM 与业务类型篡改一律拒绝且零部分写入', async () => {
    const before = poSnapshot();
    const attempts = [
      { label: '数量', body: { items: [{ productId: 'product-001', quantity: 11, unitPriceCents: 60 }] } },
      { label: '产品', body: { items: [{ productId: 'product-002', quantity: 10, unitPriceCents: 60 }] } },
      { label: '单位', body: { items: [{ productId: 'product-001', quantity: 10, uomCode: 'KG', unitPriceCents: 60 }] } },
      { label: '供应商', body: { supplierId: 'supplier-002' } },
    ];
    for (const attempt of attempts) {
      const response = await fixture.request('PUT', `/api/purchase-orders/${processingPoId}`, fixture.tokens.sales, {
        supplierId: 'supplier-001', orderDate: isoDate(), expectedDeliveryDate: isoDate(8), paymentTerms: '45 days',
        supplierContactName: 'Updated', supplierContactPhone: '13900000000', supplierAddress: 'Updated address', remark: 'updated',
        items: [{ productId: 'product-001', quantity: 10, uomCode: 'EA', unitPriceCents: 60 }],
        ...attempt.body,
      });
      assert.equal(response.status, 409, `${attempt.label} 篡改必须被拒`);
      assert.ok(typeof response.data.code === 'string' && response.data.code.length > 0, `${attempt.label} 拒绝必须带稳定错误码`);
    }
    const typeAttempt = await fixture.request('PUT', `/api/purchase-orders/${processingPoId}`, fixture.tokens.sales, {
      supplierId: 'supplier-001', businessType: 'STANDARD_PURCHASE',
      items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 60 }],
    });
    assert.equal(typeAttempt.status, 400);
    assert.equal(typeAttempt.data.code, 'PURCHASE_ORDER_SOURCE_IMMUTABLE');

    const after = poSnapshot();
    assert.deepEqual(after.items, before.items, '拒绝路径不得留下任何行级写入');
    assert.deepEqual(after.orders, before.orders, '拒绝路径不得留下任何表头写入');
  });

  test('加工费 PO 在 PO Change create 阶段拒绝 ADD/MODIFY/CANCEL', async () => {
    for (const action of ['ADD', 'MODIFY', 'CANCEL']) {
      const change = await fixture.request('POST', '/api/procurement/purchase-order-changes', fixture.tokens.admin, {
        orderId: processingPoId, action, payload: { quantity: 10 },
      });
      assert.equal(change.status, 409, `${action} 在 create 阶段必须被拒`);
      assert.equal(change.data.code, 'PROCESSING_PO_CHANGE_NOT_ALLOWED');
    }
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_order_changes WHERE order_id=?').get(processingPoId).n, 0,
      '被拒的 PO Change 不得留下变更单');
  });

  test('非创建人提交、独立主体审批，创建人不得审批自己创建的 PO', async () => {
    const submit = await fixture.request('POST', `/api/purchase-orders/${processingPoId}/submit`, fixture.tokens.sales);
    assert.equal(submit.status, 200, submit.data.error);
    assert.equal(fixture.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(processingPoId).status, 'SUBMITTED');

    // 委外业务员没有审批权限 ⇒ 403；创建人自审规则在有审批权的主体上验证。
    const noApproveRight = await fixture.request('POST', `/api/purchase-orders/${processingPoId}/approve`, fixture.tokens.outsourcing);
    assert.equal(noApproveRight.status, 403, '无审批权限的主体必须 403');

    const approve = await fixture.request('POST', `/api/purchase-orders/${processingPoId}/approve`, fixture.tokens.reviewer);
    assert.equal(approve.status, 200, approve.data.error);
    assert.equal(fixture.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(processingPoId).status, 'APPROVED');

    const adminPo = await fixture.request('POST', `/api/procurement/outsourcing/orders/${adminCreatedOrderId}/processing-fee-purchase-orders`,
      fixture.tokens.admin, businessBody(), { 'idempotency-key': 'admin-created-po' });
    assert.equal(adminPo.status, 201, adminPo.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${adminPo.data.id}/submit`, fixture.tokens.admin)).status, 200);
    const selfApprove = await fixture.request('POST', `/api/purchase-orders/${adminPo.data.id}/approve`, fixture.tokens.admin);
    assert.equal(selfApprove.status, 409, '创建人不得审批自己创建的加工费 PO');
    assert.equal(fixture.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(adminPo.data.id).status, 'SUBMITTED');
  });

  test('OUTSOURCE 完工通知强制 APPROVED 加工费 PO 与唯一 PO Item 来源', async () => {
    const missingPo = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId, warehouseId: 'warehouse-001',
      noticeDate: isoDate(), items: [{ productId: 'product-001', quantity: 2 }], idempotencyKey: 'notice-missing-po',
    });
    assert.equal(missingPo.status, 400, '缺 processingPoId 必须 400');

    const unknownPo = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId: 'po-not-exists',
      warehouseId: 'warehouse-001', noticeDate: isoDate(),
      items: [{ productId: 'product-001', quantity: 2 }], idempotencyKey: 'notice-wrong-po',
    });
    assert.equal(unknownPo.status, 404);

    const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId: processingPoId,
      warehouseId: 'warehouse-001', noticeDate: isoDate(),
      items: [{ productId: 'product-001', quantity: 2 }], idempotencyKey: 'notice-processing-1',
    });
    assert.equal(notice.status, 201, notice.data.error);
    assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200,
      '完工通知必须确认后才可作为收货来源');
    const noticeItem = fixture.db.prepare('SELECT * FROM receipt_notice_items WHERE notice_id=?').get(notice.data.id);
    const poItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
    assert.equal(noticeItem.purchase_order_item_id, poItem.id, '通知行必须绑定加工费 PO 的唯一来源行');
  });

  test('403 / 409 / 400 的审计义务互不混淆', async () => {
    const authorizationBefore = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'").get().n;
    const forbidden = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.sales, businessBody(), { 'idempotency-key': 'processing-po-403' });
    assert.equal(forbidden.status, 403, '缺少 OUTSOURCING_MANAGE 必须 403');
    const authorizationAfter = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'").get().n;
    assert.equal(authorizationAfter, authorizationBefore + 1, '403 恰好新增 1 条授权拒绝审计');
    const authorizationAudit = fixture.db.prepare("SELECT * FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION' ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    assert.equal(authorizationAudit.entity_id, null, '403 审计不得包含业务单据标识');
    assert.ok(authorizationAudit.detail.includes('OUTSOURCING_MANAGE'), '403 审计必须含被拒权限');

    const domainBefore = countAudits('OUTSOURCING_ORDER', orderId);
    const invalid = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody({ unitPriceCents: -1 }), { 'idempotency-key': 'processing-po-400' });
    assert.equal(invalid.status, 400, '非法格式必须 400');
    assert.equal(countAudits('OUTSOURCING_ORDER', orderId), domainBefore, '400 不写 Domain 拒绝审计');

    const conflictBefore = countAudits('OUTSOURCING_ORDER', orderId);
    const conflict = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`,
      fixture.tokens.outsourcing, businessBody(), { 'idempotency-key': 'processing-po-already' });
    assert.equal(conflict.status, 409);
    assert.equal(countAudits('OUTSOURCING_ORDER', orderId), conflictBefore + 1, '409 恰好新增 1 条业务拒绝审计');
    const domainAudit = fixture.db.prepare("SELECT * FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(orderId);
    assert.ok(domainAudit.detail.includes('OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS'), '409 审计必须含精确 error code');
    assert.equal(domainAudit.entity_id, orderId, '409 审计必须含业务单据标识');
  });

  test('运行时 PO/Item Writer 与 Mutator 只有批准入口（zero-bypass proof）', () => {
    const sources = runtimeServerSources();
    const headerInserts = sources.filter(({ source }) => /INSERT INTO purchase_orders\b/.test(source));
    assert.equal(headerInserts.length, 1, '运行时 purchase_orders INSERT 只能有一处（canonical draft Writer）');
    assert.match(headerInserts[0].source, /export function createPurchaseOrderDraftCanonical\(/);

    const ordersSource = readFileSync(resolve(root, 'server/modules/procurement-orders.js'), 'utf8');
    assert.match(ordersSource, /export function updateOutsourcingProcessingPurchaseOrderCommercialFields\(/,
      '加工费 PO 必须有独立的原位商业更新器');
    const updater = ordersSource.match(/export function updateOutsourcingProcessingPurchaseOrderCommercialFields[\s\S]*?\r?\n}/)?.[0] || '';
    assert.ok(updater, '必须找到加工费 PO 商业更新器');
    assert.doesNotMatch(updater, /INSERT INTO|DELETE FROM/,
      '加工费 PO 商业更新器只允许原位 UPDATE，不得 INSERT/DELETE');
  });
});
