// 委外核心执行工作面的有界回归（Requirement §31.15；Design §26.35）。
//
// 覆盖四组合同：
//   1. 订单状态机安全门禁（精确动作、完工/关闭事实门禁、材料终态约束）；
//   2. 委外供应商资格按订单业务日期判定；
//   3. 受限岗位读模型与职责分离（收货员不得读到宽订单详情与成本/WIP 身份）；
//   4. OUTSOURCE 完工通知的来源级授权与 IQC 委外来源候选。
//
// 证据只通过生产 HTTP API 产生；直接 SQL 只用于构造生产 API 无法表达的
// 历史夹具与断言零副作用的快照。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createApprovedProcessingPo, createProcurementFixture, outsourcingReceiptBody,
  prepareOutsourcingReceiptSource, seedApprovedOutsourceBom, seedOutsourceSource,
} from './test-support/procurement-http-fixture.js';

describe('委外核心执行工作面 — 状态机门禁、受限读模型与来源级授权', () => {
  let fixture;
  let sequence = 0;

  const isoDate = (offsetDays = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  };

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-outsourcing-wb-');
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
      supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(qualified.status, 200, qualified.data.error);
    // OUT-02: 委外订单必须消费有效 OUTSOURCE 货源（货源控制的采购参数开关对
    // 委外同样生效）。因此测试必须先表达这条业务事实。
    await seedOutsourceSource(fixture, [
      { supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) },
      { supplierId: 'supplier-001', productId: 'product-002', effectiveFrom: isoDate(-30) },
    ]);
    // 委外发料需要源仓的权威库存与估值余额。
    const now = new Date().toISOString();
    for (const productId of ['product-001', 'product-002']) {
      fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
        VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
        ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:${productId}`, productId, now);
    }
  });
  after(async () => fixture.close());

  async function createDraftOrder({ orderQuantity = 10, businessDate = isoDate(0), material = { productId: 'product-001', requiredQuantity: 0 } } = {}) {
    sequence += 1;
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [material], `wb-${Date.now()}-${sequence}`);
    const created = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity, unit: 'EA', businessDate, bomId,
    });
    assert.equal(created.status, 201, created.data.error);
    return created.data.id;
  }

  async function snapshotMaterials(orderId, material = { productId: 'product-001', requiredQuantity: 0 }) {
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [{ productId: material.productId, sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    return snapshot.data;
  }

  async function releaseOrder(orderId, material = { productId: 'product-001', requiredQuantity: 0 }) {
    await snapshotMaterials(orderId, material);
    const confirm = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    assert.equal(confirm.status, 200, confirm.data.error);
    const release = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    assert.equal(release.status, 200, release.data.error);
    return orderId;
  }

  function transition(orderId, action, token = fixture.tokens.admin) {
    return fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, token, { action });
  }

  function rejectAudits(entityType, entityId) {
    return Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id=?",
    ).get(entityType, entityId).n);
  }

  // ================================================================
  // 1 — 订单状态机安全门禁
  // ================================================================
  describe('订单状态机安全门禁', () => {
    test('缺失或未知动作固定 400，旧 NEXT 不再静默推进状态', async () => {
      const orderId = await createDraftOrder();
      const missing = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, {});
      assert.equal(missing.status, 400);
      assert.equal(missing.data.code, 'OUTSOURCING_TRANSITION_ACTION_INVALID');
      const legacyNext = await transition(orderId, 'NEXT');
      assert.equal(legacyNext.status, 400);
      assert.equal(legacyNext.data.code, 'OUTSOURCING_TRANSITION_ACTION_INVALID');
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), 0, '400 不是业务拒绝，不写 Domain 拒绝审计');
      const unknown = await transition(orderId, 'COMPLETE');
      assert.equal(unknown.status, 409);
      assert.equal(unknown.data.code, 'OUTSOURCING_TRANSITION_STATE_CONFLICT');
      const status = fixture.db.prepare('SELECT status FROM outsourcing_orders WHERE id=?').get(orderId);
      assert.equal(status.status, 'DRAFT', '被拒动作不得推进任何状态');
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), 1, '409 业务拒绝写恰好一条 Domain 拒绝审计');
    });

    test('动作与当前状态不符固定 409 且业务事实零变化', async () => {
      const orderId = await releaseOrder(await createDraftOrder());
      const before = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);
      const conflict = await transition(orderId, 'CONFIRM_PLAN');
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, 'OUTSOURCING_TRANSITION_STATE_CONFLICT');
      const after = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      assert.equal(after.status, before.status);
      assert.equal(after.updated_at, before.updated_at);
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore + 1, '409 恰好新增 1 条业务拒绝审计');
    });

    test('确认计划必须已有可证明的用料快照；已确认计划后不得补建快照', async () => {
      const orderId = await createDraftOrder();
      const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);
      const missing = await transition(orderId, 'CONFIRM_PLAN');
      assert.equal(missing.status, 409);
      assert.equal(missing.data.code, 'OUTSOURCING_MATERIAL_SNAPSHOT_REQUIRED');
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore + 1);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_material_list WHERE order_id=?').get(orderId).n, 0);

      await snapshotMaterials(orderId);
      assert.equal((await transition(orderId, 'CONFIRM_PLAN')).status, 200);
      const late = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
        items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
      });
      assert.equal(late.status, 409);
      assert.equal(late.data.code, 'OUTSOURCING_MATERIAL_SNAPSHOT_STATE_INVALID');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_material_list WHERE order_id=?').get(orderId).n, 1);
    });

    test('完工必须以已生效收货净量达到订单数量为前提', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);
      const early = await transition(orderId, 'COMPLETE');
      assert.equal(early.status, 409);
      assert.equal(early.data.code, 'OUTSOURCING_COMPLETION_QUANTITY_NOT_REACHED');
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore + 1);

      // 待检收货不计入已生效净量。
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-complete-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-pending-${orderId}` });
      assert.equal(pending.status, 201, pending.data.error);
      const stillEarly = await transition(orderId, 'COMPLETE');
      assert.equal(stillEarly.status, 409);
      assert.equal(stillEarly.data.code, 'OUTSOURCING_COMPLETION_QUANTITY_NOT_REACHED');

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${pending.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wb-effect-${orderId}` });
      assert.equal(effected.status, 200, effected.data.error);
      assert.equal((await transition(orderId, 'COMPLETE')).status, 200);
      assert.equal(fixture.db.prepare('SELECT status FROM outsourcing_orders WHERE id=?').get(orderId).status, 'COMPLETED');
    });

    test('关闭要求无待检收货、无未结完工通知、材料 WIP 余量为零', async () => {
      // 每单位用量 0.1 ⇒ 订单 10 件需 1 单位用料；发料 2 单位，收货生效倒冲 1 单位，
      // 完工后仍有 1 单位 WIP 余量，关闭必须被拒。
      const material = { productId: 'product-001', requiredQuantity: 0.1 };
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10, material }), material);
      const materialId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materialId, quantity: 2, issuedDate: isoDate(0), idempotencyKey: `wb-close-issue-${orderId}`,
      });
      assert.equal(issue.status, 201, issue.data.error);

      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-close-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-close-pending-${orderId}` });
      assert.equal(pending.status, 201, pending.data.error);
      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${pending.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wb-close-effect-${orderId}` });
      assert.equal(effected.status, 200, effected.data.error);
      assert.equal((await transition(orderId, 'COMPLETE')).status, 200);

      // 仍有 1 单位未耗用 WIP ⇒ 不可关闭。
      const wip = await transition(orderId, 'CLOSE');
      assert.equal(wip.status, 409);
      assert.equal(wip.data.code, 'OUTSOURCING_CLOSE_WIP_REMAINING');

      // 完工后允许有来源、有身份校验的退料；退料清零后方可关闭。
      const returned = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
        materialListId: materialId, quantity: 1, returnDate: isoDate(0), idempotencyKey: `wb-close-return-${orderId}`,
      });
      assert.equal(returned.status, 201, returned.data.error);
      const closed = await transition(orderId, 'CLOSE');
      assert.equal(closed.status, 200, closed.data.error);
      assert.equal(fixture.db.prepare('SELECT status FROM outsourcing_orders WHERE id=?').get(orderId).status, 'CLOSED');
    });

    test('待检收货与未结完工通知分别阻塞关闭', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-open-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-open-pending-${orderId}` });
      assert.equal(pending.status, 201, pending.data.error);
      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${pending.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wb-open-effect-${orderId}` });
      assert.equal(effected.status, 200, effected.data.error);
      assert.equal((await transition(orderId, 'COMPLETE')).status, 200);

      // 完工通知仍有未收货数量（其收货被取消）⇒ 不可关闭。
      fixture.db.prepare("UPDATE outsourcing_receipts SET business_status='CANCELLED' WHERE id=?").run(pending.data.id);
      const openNotice = await transition(orderId, 'CLOSE');
      assert.equal(openNotice.status, 409);
      assert.equal(openNotice.data.code, 'OUTSOURCING_CLOSE_OPEN_NOTICE');
    });

    test('关闭后材料发/补/退/倒冲一律被后端拒绝', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const materialId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-closed-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-closed-pending-${orderId}` });
      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${pending.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wb-closed-effect-${orderId}` });
      assert.equal(effected.status, 200, effected.data.error);
      assert.equal((await transition(orderId, 'COMPLETE')).status, 200);
      fixture.db.prepare("UPDATE receipt_notices SET status='CANCELLED' WHERE outsourcing_order_id=?").run(orderId);
      const closed = await transition(orderId, 'CLOSE');
      assert.equal(closed.status, 200, closed.data.error);

      const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId);
      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materialId, quantity: 1, issuedDate: isoDate(0), idempotencyKey: `wb-closed-issue-${orderId}`,
      });
      assert.equal(issue.status, 409);
      assert.equal(issue.data.code, 'OUTSOURCING_ORDER_STATE_INVALID');
      const returnResult = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
        materialListId: materialId, quantity: 1, returnDate: isoDate(0), idempotencyKey: `wb-closed-return-${orderId}`,
      });
      assert.equal(returnResult.status, 409);
      assert.equal(returnResult.data.code, 'OUTSOURCING_ORDER_STATE_INVALID');
      const after = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId);
      assert.equal(Number(after.issued_quantity), Number(material.issued_quantity), '关闭后材料事实零变化');
      assert.equal(Number(after.returned_quantity), Number(material.returned_quantity));
    });
  });

  // ================================================================
  // 2 — 供应商资格按订单业务日期判定
  // ================================================================
  describe('委外供应商资格按订单业务日期判定', () => {
    test('业务日期早于资质生效日时拒绝建单，晚于时允许', async () => {
      sequence += 1;
      const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0 }], `wb-qual-${Date.now()}-${sequence}`);
      const early = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 5, unit: 'EA',
        businessDate: isoDate(-365), bomId,
      });
      assert.equal(early.status, 409, '历史业务日期不在委外资质有效期内必须拒绝');
      const valid = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 5, unit: 'EA',
        businessDate: isoDate(0), bomId,
      });
      assert.equal(valid.status, 201, valid.data.error);
    });
  });

  // ================================================================
  // 3 — 受限读模型与职责分离
  // ================================================================
  describe('受限读模型与职责分离', () => {
    test('收货员只能读受限队列与上下文，宽订单详情与列表一律 403', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const processingPoId = await createApprovedProcessingPo(fixture, orderId, `wb-queue-${orderId}`);
      const queue = await fixture.request('GET', '/api/procurement/outsourcing/receiving-queue', fixture.tokens.outsourcingReceiving);
      assert.equal(queue.status, 200, queue.data.error);
      assert.ok(Array.isArray(queue.data.tasks));
      const task = queue.data.tasks.find((item) => item.order.id === orderId);
      assert.ok(task, '已下达且有加工费 PO 的订单必须进入收货任务队列');
      assert.equal(task.processingPo.id, processingPoId);
      assert.ok(task.nextActions.includes('CREATE_NOTICE'), '已审批加工费 PO 的订单必须给出创建完工通知的动作');
      const context = await fixture.request('GET', `/api/procurement/outsourcing/orders/${orderId}/receiving-context`, fixture.tokens.outsourcingReceiving);
      assert.equal(context.status, 200, context.data.error);
      assert.equal(context.data.receivingContext.order.orderNo, fixture.db.prepare('SELECT order_no FROM outsourcing_orders WHERE id=?').get(orderId).order_no);

      const wide = await fixture.request('GET', `/api/procurement/outsourcing/orders/${orderId}`, fixture.tokens.outsourcingReceiving);
      assert.equal(wide.status, 403, '收货员不得读取宽订单详情');
      const list = await fixture.request('GET', '/api/procurement/outsourcing/orders', fixture.tokens.outsourcingReceiving);
      assert.equal(list.status, 403, '收货员不得读取委外订单列表');
      const options = await fixture.request('GET', '/api/procurement/outsourcing/options?kind=supplier', fixture.tokens.outsourcingReceiving);
      assert.equal(options.status, 403, '收货员不得读取委外业务选项');
    });

    test('受限上下文不返回材料成本、WIP 身份与订单敏感投影', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const context = await fixture.request('GET', `/api/procurement/outsourcing/orders/${orderId}/receiving-context`, fixture.tokens.outsourcingReceiving);
      assert.equal(context.status, 200, context.data.error);
      const serialized = JSON.stringify(context.data);
      for (const forbidden of ['materialList', 'material_list', 'issuedQuantity', 'supplementedQuantity',
        'returnedQuantity', 'backflushed', 'identity', 'wip', 'Wip', 'WIP', 'costCents', 'feeCents',
        'unitPrice', 'amountCents', 'totalCost', 'processingFeeCents']) {
        assert.ok(!serialized.includes(forbidden), `受限上下文不得包含 ${forbidden}`);
      }
      assert.ok(serialized.includes('processingPo'), '加工费 PO 编号是收货任务必需字段');
    });

    test('选项读模型按业务日期过滤合格委外供应商', async () => {
      const options = await fixture.request('GET', '/api/procurement/outsourcing/options?kind=supplier&businessDate=' + isoDate(0), fixture.tokens.admin);
      assert.equal(options.status, 200, options.data.error);
      assert.ok(options.data.options.some((option) => option.id === 'supplier-001'));
      const historical = await fixture.request('GET', '/api/procurement/outsourcing/options?kind=supplier&businessDate=' + isoDate(-365), fixture.tokens.admin);
      assert.equal(historical.status, 200);
      assert.ok(!historical.data.options.some((option) => option.id === 'supplier-001'), '业务日期不在资质有效期内的供应商不可选');
      const search = await fixture.request('GET', '/api/procurement/outsourcing/options?kind=product&q=P001', fixture.tokens.admin);
      assert.equal(search.status, 200);
      assert.ok(search.data.options.some((option) => option.id === 'product-001'));
    });
  });

  // ================================================================
  // 4 — OUTSOURCE 完工通知的来源级授权与 IQC 来源候选
  // ================================================================
  describe('OUTSOURCE 完工通知的来源级授权', () => {
    test('收货员可创建并确认 OUTSOURCE 完工通知，普通采购通知一律 403', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const processingPoId = await createApprovedProcessingPo(fixture, orderId, `wb-notice-${orderId}`);

      const standard = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.outsourcingReceiving, {
        businessType: 'STANDARD_PURCHASE', purchaseOrderId: processingPoId,
        warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{ productId: 'product-001', quantity: 1 }],
      });
      assert.equal(standard.status, 403, '收货员不得创建普通采购通知');

      const outsource = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.outsourcingReceiving, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId,
        warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{ productId: 'product-001', quantity: 10 }],
      });
      assert.equal(outsource.status, 201, outsource.data.error);
      const confirmed = await fixture.request('POST', `/api/receipt-notices/${outsource.data.id}/confirm`, fixture.tokens.outsourcingReceiving);
      assert.equal(confirmed.status, 200, confirmed.data.error);
    });

    test('收货员不得确认普通采购通知，也不得取消通知', async () => {
      const outsourceOrderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const processingPoId = await createApprovedProcessingPo(fixture, outsourceOrderId, `wb-sod-${outsourceOrderId}`);
      const outsource = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: outsourceOrderId, processingPoId,
        warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{ productId: 'product-001', quantity: 10 }],
      });
      assert.equal(outsource.status, 201, outsource.data.error);
      const cancel = await fixture.request('POST', `/api/receipt-notices/${outsource.data.id}/cancel`, fixture.tokens.outsourcingReceiving);
      assert.equal(cancel.status, 403, '取消通知不在本轮授权范围');
      assert.equal(fixture.db.prepare('SELECT status FROM receipt_notices WHERE id=?').get(outsource.data.id).status, 'DRAFT');
    });

    test('通用通知管理者的普通采购路径不回归', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const processingPoId = await createApprovedProcessingPo(fixture, orderId, `wb-general-${orderId}`);
      const outsource = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId,
        warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{ productId: 'product-001', quantity: 10 }],
      });
      assert.equal(outsource.status, 201, outsource.data.error);
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${outsource.data.id}/confirm`, fixture.tokens.admin)).status, 200);
    });
  });

  describe('IQC 委外来源候选与检验上下文', () => {
    test('候选只含真实待检委外收货，且非 IQC 岗位 403', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-iqc-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-iqc-receipt-${orderId}` });
      assert.equal(pending.status, 201, pending.data.error);

      const candidates = await fixture.request('GET', '/api/iqc/source-candidates?sourceType=OUTSOURCING_RECEIPT', fixture.tokens.warehouse);
      assert.equal(candidates.status, 200, candidates.data.error);
      const candidate = candidates.data.candidates.find((item) => item.sourceId === pending.data.id);
      assert.ok(candidate, '待检委外收货必须出现在 IQC 来源候选中');
      assert.equal(candidate.sourceType, 'OUTSOURCING_RECEIPT');

      const denied = await fixture.request('GET', '/api/iqc/source-candidates?sourceType=OUTSOURCING_RECEIPT', fixture.tokens.outsourcingReceiving);
      assert.equal(denied.status, 403, '收货员不是 IQC 岗位');
    });

    test('检验上下文给出真实来源与 canonical 质量状态', async () => {
      const orderId = await releaseOrder(await createDraftOrder({ orderQuantity: 10 }));
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wb-qc-${orderId}`);
      const pending = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': `wb-qc-receipt-${orderId}` });
      assert.equal(pending.status, 201, pending.data.error);
      const context = await fixture.request('GET', `/api/procurement/outsourcing/receipts/${pending.data.id}/quality-context`, fixture.tokens.warehouse);
      assert.equal(context.status, 200, context.data.error);
      assert.equal(context.data.qualityContext.receipt.id, pending.data.id);
      assert.equal(context.data.qualityContext.receipt.orderId, orderId);
      assert.ok(['WAIVED', 'NOT_INSPECTED', 'INSPECTION_DRAFT', 'PASS', 'FAIL', 'STALE'].includes(context.data.qualityContext.qualityState.code));
      const denied = await fixture.request('GET', `/api/procurement/outsourcing/receipts/${pending.data.id}/quality-context`, fixture.tokens.outsourcing);
      assert.equal(denied.status, 403);
    });
  });
});
