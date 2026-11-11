// Procurement & Outsourcing sourcing capabilities — PRC-02 / PRC-04 / PRC-12 /
// PRC-16 / OUT-02.
//
// Contract sources:
//   - PRC-02 (docs/requirements/procurement-outsourcing.md §31.3.1)：供应商采购
//     档案的付款结算默认值与品类必须驱动单据；历史订单快照不被改写。
//   - PRC-04：货源控制启用时无有效货源不得静默使用；override = 权限 + 原因 +
//     审计 + 有界日期区间。
//   - PRC-12：请购转采购订单必须写 canonical 分配事实与审计；数量守恒。
//   - PRC-16：交货计划 lower tolerance 自动关单，判定公式只有一份。
//   - OUT-02：委外订单必须消费有效 OUTSOURCE 货源；与采购共用同一货源控制。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { assertSourceControl, resolveEffectiveSource } from './modules/procurement-policy.js';

describe('Procurement sourcing capabilities — PRC-02 / PRC-04 / PRC-12 / PRC-16 / OUT-02', () => {
  let fixture;
  before(async () => {
    fixture = await createProcurementFixture('modern-erp-prc-sourcing-');
    for (const supplierId of ['supplier-001', 'supplier-002', 'supplier-003']) {
      for (const [productId, unitPriceCents] of [['product-001', 1000], ['product-002', 600], ['product-003', 800]]) {
        const price = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
          supplierId, productId, sourceType: 'PURCHASE', pricingUomCode: 'EA',
          unitPriceCents, effectiveFrom: '2026-01-01',
        });
        assert.equal(price.status, 201, price.data.error);
      }
    }
  });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  /** 设置供应商采购档案（品类 / 资质 / 付款默认值）。 */
  async function setProfile(supplierId, profile) {
    const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, profile);
    assert.equal(result.status, 200, result.data.error);
    return result.data.profile;
  }

  async function qualifyGeneralSupplier(supplierId, extra = {}) {
    return setProfile(supplierId, {
      procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL',
      qualificationStatus: 'QUALIFIED', qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
      ...extra,
    });
  }

  async function qualifyOutsourceSupplier(supplierId, extra = {}) {
    return setProfile(supplierId, {
      procurementEnabled: false, outsourcingEnabled: true, category: 'OUTSOURCE',
      qualificationStatus: 'QUALIFIED', qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
      supplierWipWarehouseId: 'warehouse-002',
      ...extra,
    });
  }

  async function createSourceEntry(body) {
    const result = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, body);
    assert.equal(result.status, 201, result.data.error);
    return result.data;
  }

  /**
   * 采购入库确认前的质量门禁：创建并完成一条 IQC PASS。
   * 这是既有 canonical 质量链路（POST /api/iqc + complete），不是测试造数捷径。
   */
  async function passQualityGate(receiptId, quantity) {
    const iqc = await fixture.request('POST', '/api/iqc', fixture.tokens.warehouse, { purchase_receipt_id: receiptId });
    assert.equal(iqc.status, 201, iqc.data.error);
    const completed = await fixture.request('POST', `/api/iqc/${iqc.data.id}/complete`, fixture.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
    assert.equal(completed.status, 200, completed.data.error);
  }

  // =========================================================================
  // PRC-02
  // =========================================================================

  test('PRC-02: payment terms days come from the supplier profile and the origin is frozen', async () => {
    await qualifyGeneralSupplier('supplier-001', { defaultPaymentTermsDays: 45 });
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7), paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 2, unitPriceCents: 1000 }],
    });
    assert.equal(po.status, 201, po.data.error);
    const row = fixture.db.prepare('SELECT payment_terms_days, payment_terms_days_source FROM purchase_orders WHERE id=?').get(po.data.id);
    assert.equal(Number(row.payment_terms_days), 45, '客户端未指定时，付款天数取供应商采购档案默认值');
    assert.equal(row.payment_terms_days_source, 'SUPPLIER_DEFAULT');

    // 客户端显式指定时以其为准，并留痕。
    const explicit = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7), paymentTerms: '30 天',
      paymentTermsDays: 15,
      items: [{ productId: 'product-001', quantity: 2, unitPriceCents: 1000 }],
    });
    assert.equal(explicit.status, 201, explicit.data.error);
    const explicitRow = fixture.db.prepare('SELECT payment_terms_days, payment_terms_days_source FROM purchase_orders WHERE id=?').get(explicit.data.id);
    assert.equal(Number(explicitRow.payment_terms_days), 15);
    assert.equal(explicitRow.payment_terms_days_source, 'CLIENT');

    // 档案后续变化不得改写历史订单快照。
    await qualifyGeneralSupplier('supplier-001', { defaultPaymentTermsDays: 90 });
    const unchanged = fixture.db.prepare('SELECT payment_terms_days FROM purchase_orders WHERE id=?').get(po.data.id);
    assert.equal(Number(unchanged.payment_terms_days), 45, '历史订单的付款天数快照不被档案变更改写');
  });

  test('PRC-02: supplier category drives the document — the outsourcing side is category-gated, the purchase side is qualification-gated', async () => {
    await qualifyOutsourceSupplier('supplier-002');
    const rejected = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-002', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7), paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 1000 }],
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    // 品类不再禁止普通采购；普通采购由采购资质门禁把关。委外类供应商若未启用
    // 采购业务，就不能承接普通采购订单。
    assert.equal(rejected.data.code, 'PURCHASE_SUPPLIER_NOT_QUALIFIED');
    const count = fixture.db.prepare("SELECT COUNT(*) n FROM purchase_orders WHERE supplier_id='supplier-002'").get().n;
    assert.equal(count, 0, '被拒绝的采购订单零副作用');

    // 普通类供应商不得承接委外加工费采购订单：委外订单创建即被品类门禁拒绝。
    // 该供应商先取得有效 OUTSOURCE 货源（货源不是拒绝原因），再把品类改为
    // 普通类，证明拒绝确实来自品类门禁。
    await qualifyOutsourceSupplier('supplier-003');
    await createSourceEntry({
      supplierId: 'supplier-003', productId: 'product-001', sourceType: 'OUTSOURCE', effectiveFrom: isoDate(-7),
    });
    await setProfile('supplier-003', {
      outsourcingEnabled: true, category: 'GENERAL',
      qualificationStatus: 'QUALIFIED', qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    const rejectedOutsourcing = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-003', productId: 'product-001', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(rejectedOutsourcing.status, 409, JSON.stringify(rejectedOutsourcing.data));
    assert.equal(rejectedOutsourcing.data.code, 'SUPPLIER_CATEGORY_NOT_OUTSOURCE');
    const outsourcingCount = fixture.db.prepare("SELECT COUNT(*) n FROM outsourcing_orders WHERE supplier_id='supplier-003'").get().n;
    assert.equal(outsourcingCount, 0, '被拒绝的委外订单零副作用');
  });

  // =========================================================================
  // PRC-04
  // =========================================================================

  test('PRC-04: override requires permission, a reason and a bounded date window, and writes one audit', async () => {
    await qualifyGeneralSupplier('supplier-001');
    // 无货源：override 前必须被拒。
    const before = fixture.db.prepare("SELECT COUNT(*) n FROM source_list_overrides").get().n;
    const unauthorized = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.sales, {
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
      reason: '紧急采购', effectiveFrom: isoDate(0), effectiveTo: isoDate(7),
    });
    assert.equal(unauthorized.status, 403, JSON.stringify(unauthorized.data));
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM source_list_overrides").get().n, before, '无权限时零副作用');

    // 原因必填。
    const noReason = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
      reason: '   ', effectiveFrom: isoDate(0), effectiveTo: isoDate(7),
    });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.data));
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM source_list_overrides").get().n, before);

    // 区间非法。
    const badWindow = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
      reason: '紧急采购', effectiveFrom: isoDate(7), effectiveTo: isoDate(0),
    });
    assert.equal(badWindow.status, 400, JSON.stringify(badWindow.data));
    assert.equal(badWindow.data.code, 'SOURCE_OVERRIDE_WINDOW_INVALID');

    // 正例：权限 + 原因 + 区间 + 审计。
    const created = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
      reason: '紧急采购：供应商尚未完成货源建档', effectiveFrom: isoDate(0), effectiveTo: isoDate(7),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const overrideId = created.data.id;
    const row = fixture.db.prepare('SELECT * FROM source_list_overrides WHERE id=?').get(overrideId);
    assert.equal(row.supplier_id, 'supplier-001');
    assert.equal(row.product_id, 'product-002');
    assert.equal(row.source_type, 'PURCHASE');
    assert.equal(row.effective_from, isoDate(0));
    assert.equal(row.effective_to, isoDate(7));
    assert.equal(row.reason, '紧急采购：供应商尚未完成货源建档');
    assert.equal(row.status, 'ACTIVE');
    const auditRow = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='SOURCE_LIST_OVERRIDE' AND entity_id=? AND action='OVERRIDE'").get(overrideId);
    assert.ok(auditRow, 'override 必须写审计');
    const detail = JSON.parse(auditRow.detail);
    assert.equal(detail.supplierId, 'supplier-001');
    assert.equal(detail.productId, 'product-002');
    assert.equal(detail.sourceType, 'PURCHASE');
    assert.equal(detail.effectiveFrom, isoDate(0));
    assert.equal(detail.effectiveTo, isoDate(7));
    assert.equal(detail.reason, '紧急采购：供应商尚未完成货源建档');

    // 重叠区间必须被拒（区间唯一）。
    const overlap = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
      reason: '重复放行', effectiveFrom: isoDate(3), effectiveTo: isoDate(10),
    });
    assert.equal(overlap.status, 409, JSON.stringify(overlap.data));
    assert.equal(overlap.data.code, 'SOURCE_OVERRIDE_OVERLAP');
  });

  test('PRC-04: an override releases the supplier only inside its own date window', async () => {
    // supplier-003 / product-003 在 override 区间外不得被使用。
    await qualifyGeneralSupplier('supplier-003');
    const created = await fixture.request('POST', '/api/procurement/source-entries/override', fixture.tokens.admin, {
      supplierId: 'supplier-003', productId: 'product-003', sourceType: 'PURCHASE',
      reason: '一次性应急放行', effectiveFrom: isoDate(0), effectiveTo: isoDate(2),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    // 区间内：货源控制放行，并证明放行依据是 override。
    const inside = resolveEffectiveSource(fixture.db, {
      supplierId: 'supplier-003', productId: 'product-003', sourceType: 'PURCHASE', businessDate: isoDate(1),
    });
    assert.ok(inside, 'override 区间内必须有有效货源');
    assert.equal(inside.kind, 'OVERRIDE');
    assert.equal(inside.sourceId, created.data.id);

    // 区间之外：货源控制仍然拒绝（override 不是永久放行）。
    const outside = resolveEffectiveSource(fixture.db, {
      supplierId: 'supplier-003', productId: 'product-003', sourceType: 'PURCHASE', businessDate: isoDate(5),
    });
    assert.equal(outside, null, 'override 区间外没有有效货源');
    assert.throws(
      () => assertSourceControl(fixture.db, {
        supplierId: 'supplier-003', productId: 'product-003', businessDate: isoDate(5), sourceType: 'PURCHASE',
      }),
      (error) => error.status === 409 && error.code === 'PURCHASE_SOURCE_REQUIRED',
    );

    // 端到端：区间外的请购转采购订单仍被货源控制拒绝。
    const { itemId } = await createApprovedRequisition(2, 'product-003');
    const rejected = await fixture.request('POST', '/api/purchase-requisitions/batch-generate-purchase-orders', fixture.tokens.admin, {
      orderDate: isoDate(5),
      items: [{ purchaseRequisitionItemId: itemId, supplierId: 'supplier-003', quantity: 2 }],
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'PURCHASE_SOURCE_REQUIRED');
  });

  // =========================================================================
  // PRC-12
  // =========================================================================

  async function createApprovedRequisition(quantity, productId = 'product-002') {
    const created = await fixture.request('POST', '/api/purchase-requisitions', fixture.tokens.admin, {
      requestDate: isoDate(0), requiredDate: isoDate(10),
      items: [{ productId, quantity, unitPriceCents: 600 }],
    });
    assert.equal(created.status, 201, created.data.error);
    const id = created.data.id;
    assert.equal((await fixture.request('POST', `/api/purchase-requisitions/${id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-requisitions/${id}/approve`, fixture.tokens.reviewer)).status, 200);
    const item = fixture.db.prepare('SELECT id FROM purchase_requisition_items WHERE requisition_id=?').get(id);
    return { requisitionId: id, itemId: item.id };
  }

  test('PRC-12: the requisition → purchase order conversion writes an immutable allocation fact and one audit', async () => {
    await qualifyGeneralSupplier('supplier-001');
    await qualifyGeneralSupplier('supplier-002');
    await createSourceEntry({
      supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE', effectiveFrom: isoDate(-7),
    });
    await createSourceEntry({
      supplierId: 'supplier-002', productId: 'product-002', sourceType: 'PURCHASE', effectiveFrom: isoDate(-7),
    });
    const { requisitionId, itemId } = await createApprovedRequisition(10);

    // 一条请购明细拆到两个供应商：既有 batch converter 不允许同一批次重复
    // 选择同一请购明细，因此拆单以**两次转换**完成；每一次转换都写自己的
    // 分配事实。
    const first = await fixture.request('POST', '/api/purchase-requisitions/batch-generate-purchase-orders', fixture.tokens.admin, {
      orderDate: isoDate(0),
      items: [{ purchaseRequisitionItemId: itemId, supplierId: 'supplier-001', quantity: 6 }],
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.purchaseOrders.length, 1);
    const second = await fixture.request('POST', '/api/purchase-requisitions/batch-generate-purchase-orders', fixture.tokens.admin, {
      orderDate: isoDate(0),
      items: [{ purchaseRequisitionItemId: itemId, supplierId: 'supplier-002', quantity: 4 }],
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal(second.data.purchaseOrders.length, 1);

    const facts = fixture.db.prepare('SELECT * FROM pr_conversion_allocations WHERE requisition_item_id=? ORDER BY supplier_id').all(itemId);
    assert.equal(facts.length, 2, '每个 (请购明细 → 采购订单明细 → 供应商) 一条分配事实');
    const total = facts.reduce((sum, row) => sum + Number(row.allocated_quantity_num) / Number(row.allocated_quantity_den), 0);
    assert.ok(Math.abs(total - 10) < 1e-9, `分配量守恒，实际 ${total}`);
    for (const fact of facts) {
      assert.equal(fact.requisition_id, requisitionId);
      assert.equal(fact.created_by, 'user-admin');
      assert.equal(fact.business_date, isoDate(0));
      assert.ok(fact.purchase_order_item_id, '分配事实必须指向具体的采购订单行');
      assert.equal(Number(fact.requisition_quantity_num), 10);
    }
    // 分配事实必须与真实的采购订单行一致。
    for (const fact of facts) {
      const line = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(fact.purchase_order_item_id);
      assert.ok(line, '分配事实引用的采购订单行必须真实存在');
      assert.equal(line.purchase_requisition_item_id, itemId);
      assert.equal(line.supplier_id ?? fact.supplier_id, fact.supplier_id);
      assert.ok(Math.abs(Number(line.quantity) - Number(fact.allocated_quantity_num) / Number(fact.allocated_quantity_den)) < 1e-9);
    }
    const audits = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='PR_CONVERSION' AND action='ALLOCATE'").all();
    assert.ok(audits.length >= 1, '转换必须写一次可追溯审计');
    const suppliers = new Set();
    for (const row of audits) {
      const detail = JSON.parse(row.detail);
      assert.deepEqual(detail.requisitionIds, [requisitionId]);
      for (const allocation of detail.supplierAllocations) suppliers.add(allocation.supplierId);
    }
    assert.deepEqual([...suppliers].sort(), ['supplier-001', 'supplier-002'], '审计必须说清拆到了哪几个供应商');
  });

  test('PRC-12: the cumulative allocation of one requisition line never exceeds its quantity', async () => {
    await qualifyGeneralSupplier('supplier-001');
    const { itemId } = await createApprovedRequisition(5, 'product-003');
    await createSourceEntry({
      supplierId: 'supplier-001', productId: 'product-003', sourceType: 'PURCHASE', effectiveFrom: isoDate(-7),
    });
    const first = await fixture.request('POST', '/api/purchase-requisitions/batch-generate-purchase-orders', fixture.tokens.admin, {
      orderDate: isoDate(0),
      items: [{ purchaseRequisitionItemId: itemId, supplierId: 'supplier-001', quantity: 5 }],
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const allocated = fixture.db.prepare('SELECT COUNT(*) n FROM pr_conversion_allocations WHERE requisition_item_id=?').get(itemId).n;
    assert.equal(allocated, 1);

    // 再转一次：既有的 remaining 保护必须仍然生效（可转数量为 0）。
    const second = await fixture.request('POST', '/api/purchase-requisitions/batch-generate-purchase-orders', fixture.tokens.admin, {
      orderDate: isoDate(0),
      items: [{ purchaseRequisitionItemId: itemId, supplierId: 'supplier-001', quantity: 5 }],
    });
    assert.equal(second.status, 409, JSON.stringify(second.data));
    const allocatedAfter = fixture.db.prepare('SELECT COUNT(*) n FROM pr_conversion_allocations WHERE requisition_item_id=?').get(itemId).n;
    assert.equal(allocatedAfter, 1, '被拒绝的转换不得写分配事实');
  });

  // =========================================================================
  // PRC-16
  // =========================================================================

  test('PRC-16: lower-tolerance auto-close closes the schedule and records the tolerated short delivery', async () => {
    await qualifyGeneralSupplier('supplier-001');
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(14), paymentTerms: '30 天',
      items: [{ productId: 'product-002', quantity: 10, unitPriceCents: 600 }],
    });
    assert.equal(po.status, 201, po.data.error);
    const orderId = po.data.id;
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/approve`, fixture.tokens.reviewer)).status, 200);
    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;

    const schedule = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin, {
      orderItemId: itemId, plannedQuantity: 10, plannedDate: isoDate(7),
      plannedDateFrom: isoDate(5), plannedDateTo: isoDate(9), sequenceNo: 1,
      upperTolerancePct: 5, lowerTolerancePct: 10,
    });
    assert.equal(schedule.status, 201, schedule.data.error);
    const scheduleId = schedule.data.id;

    // 尚未收货：不可关单，fail closed。
    const tooEarly = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules/${scheduleId}/close`, fixture.tokens.admin, {});
    assert.equal(tooEarly.status, 409, JSON.stringify(tooEarly.data));
    assert.equal(tooEarly.data.code, 'PO_DELIVERY_SCHEDULE_NOT_CLOSEABLE');

    // 收货 9 件：累计已确认收货 9 >= 10 × (1 − 10%) = 9，且已无可收量。
    const receipt = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.admin, {
      purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      receiptDate: isoDate(7),
      items: [{ purchaseOrderItemId: itemId, productId: 'product-002', quantity: 9, unitPriceCents: 600, deliveryScheduleId: scheduleId }],
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    await passQualityGate(receipt.data.id, 9);
    assert.equal((await fixture.request('POST', `/api/purchase-receipts/${receipt.data.id}`, fixture.tokens.admin, { action: 'confirm' }, { 'idempotency-key': `prc-close-${orderId}` })).status, 200);

    // 收货确认后 canonical 写者触发同一判定：计划已关闭。
    const closed = fixture.db.prepare('SELECT status, closed_at, closed_by FROM purchase_order_delivery_schedules WHERE id=?').get(scheduleId);
    assert.equal(closed.status, 'CLOSED', '收货确认后由 canonical 写者触发自动关单');
    assert.ok(closed.closed_at);
    assert.equal(closed.closed_by, 'user-admin');
    const closeRow = fixture.db.prepare('SELECT * FROM po_delivery_schedule_closes WHERE delivery_schedule_id=?').get(scheduleId);
    assert.ok(closeRow, '关单必须留下可读的事实');
    assert.equal(closeRow.triggered_by, 'RECEIPT_CONFIRM');
    assert.equal(Number(closeRow.planned_quantity), 10);
    assert.ok(Math.abs(Number(closeRow.received_quantity) - 9) < 1e-9);
    assert.ok(Math.abs(Number(closeRow.tolerated_short_quantity) - 1) < 1e-9, '短交 1 件作为已容忍差异记录');
    assert.equal(Number(closeRow.lower_tolerance_pct), 10);
  });

  test('PRC-16: a schedule below the lower tolerance cannot be closed', async () => {
    await qualifyGeneralSupplier('supplier-001');
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(14), paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }],
    });
    assert.equal(po.status, 201, po.data.error);
    const orderId = po.data.id;
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/approve`, fixture.tokens.reviewer)).status, 200);
    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
    const schedule = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin, {
      orderItemId: itemId, plannedQuantity: 10, plannedDate: isoDate(7), upperTolerancePct: 5, lowerTolerancePct: 20,
    });
    assert.equal(schedule.status, 201, schedule.data.error);
    const scheduleId = schedule.data.id;

    // 收货 8 件 < 10 × (1 − 20%) = 8 … 恰好等于下界；再收 1 件后仍低于下界时用 7 件验证。
    const receipt = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.admin, {
      purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      receiptDate: isoDate(7),
      items: [{ purchaseOrderItemId: itemId, productId: 'product-001', quantity: 7, unitPriceCents: 1000, deliveryScheduleId: scheduleId }],
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    await passQualityGate(receipt.data.id, 7);
    assert.equal((await fixture.request('POST', `/api/purchase-receipts/${receipt.data.id}`, fixture.tokens.admin, { action: 'confirm' }, { 'idempotency-key': `prc-low-${orderId}` })).status, 200);

    const row = fixture.db.prepare('SELECT status FROM purchase_order_delivery_schedules WHERE id=?').get(scheduleId);
    assert.equal(row.status, 'OPEN', '低于下容差的交货计划不得自动关单');
    const rejected = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules/${scheduleId}/close`, fixture.tokens.admin, {});
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'PO_DELIVERY_SCHEDULE_NOT_CLOSEABLE');
    const closeCount = fixture.db.prepare('SELECT COUNT(*) n FROM po_delivery_schedule_closes WHERE delivery_schedule_id=?').get(scheduleId).n;
    assert.equal(closeCount, 0, '被拒绝的关单不得写事实');
  });

  // =========================================================================
  // OUT-02
  // =========================================================================

  test('OUT-02: an outsourcing order without an effective OUTSOURCE source is rejected with zero side effects', async () => {
    await qualifyOutsourceSupplier('supplier-001');
    const before = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n;
    const rejected = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-004', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'OUTSOURCE_SOURCE_REQUIRED');
    const after = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n;
    assert.equal(after, before, '被拒绝的委外订单零副作用');
    const rejects = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='OUTSOURCING_ORDER' AND action='REJECT' AND detail LIKE '%OUTSOURCE_SOURCE_REQUIRED%'").get().n;
    assert.ok(rejects >= 1, '业务拒绝必须写一条拒绝审计');
  });

  test('OUT-02: with an effective OUTSOURCE source the outsourcing order is created', async () => {
    await qualifyOutsourceSupplier('supplier-002');
    await createSourceEntry({
      supplierId: 'supplier-002', productId: 'product-004', sourceType: 'OUTSOURCE', effectiveFrom: isoDate(-7),
    });
    const created = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-002', productId: 'product-004', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = fixture.db.prepare('SELECT supplier_id, product_id, status FROM outsourcing_orders WHERE id=?').get(created.data.id);
    assert.equal(row.supplier_id, 'supplier-002');
    assert.equal(row.product_id, 'product-004');
    assert.equal(row.status, 'DRAFT');

    // PURCHASE 货源不能替代 OUTSOURCE 货源。
    const wrongType = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-002', productId: 'product-005', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(wrongType.status, 409, JSON.stringify(wrongType.data));
    assert.equal(wrongType.data.code, 'OUTSOURCE_SOURCE_REQUIRED');
  });

  test('OUT-02: the purchase source-control parameter switch also governs outsourcing', async () => {
    await qualifyOutsourceSupplier('supplier-003');
    await createSourceEntry({
      supplierId: 'supplier-003', productId: 'product-005', sourceType: 'OUTSOURCE', effectiveFrom: isoDate(-7),
    });
    // 关闭货源控制：委外不再要求有效货源（同一参数、同一判定）。
    const off = await fixture.request('PATCH', '/api/procurement/parameters', fixture.tokens.admin, { sourceControlEnabled: false });
    assert.equal(off.status, 200, off.data.error);
    const allowed = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-003', productId: 'product-005', orderQuantity: 5, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.data));
    // 重新打开：委外再次要求有效货源。
    const on = await fixture.request('PATCH', '/api/procurement/parameters', fixture.tokens.admin, { sourceControlEnabled: true });
    assert.equal(on.status, 200, on.data.error);
    const blocked = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-003', productId: 'product-004', orderQuantity: 5, unit: 'EA', businessDate: isoDate(0),
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
    assert.equal(blocked.data.code, 'OUTSOURCE_SOURCE_REQUIRED');
  });
});
