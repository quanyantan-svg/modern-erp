// M1C-WP2–WP6-R1 focused regression suite — 委外收货的完工通知行剩余容量与
// 加工费金额输入。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13
//     MC-REQ-02（OUTSOURCE 容量上界 = 通知行剩余 × 委外订单剩余可收量）、
//     MC-REQ-05（重复消费不得重复计入通知数量）、MC-REQ-09（容量检查必须在事务内
//     以权威口径比较，比较总量包含本次数量）、MC-REQ-11（业务零副作用 +
//     业务门禁拒绝审计恰好 1 条；400 输入失败不写 Domain 审计）、
//     MC-REQ-12（历史不可证明的事实 fail closed）
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §5.2.2
//     （OUTSOURCE 容量上界）、§9.1 QTY-2、§9.2（零副作用域与拒绝审计边界）、
//     §9.3（错误码与零副作用）、§10（历史数据 fail closed）
//
// Defect under repair (P0-01): `createOutsourcingReceipt()` only compared the
// requested line quantity against the notice line quantity. The capacity a
// notice line still offers was never reduced by the receipts that already
// consumed it, so the same completion notice could be received from again and
// again while the outsourcing order still had remaining quantity.
//
// Defect under repair (P1): `processingFeeCents` / `unitPriceCents` were
// coerced with `Number(x || 0)`, so NaN / Infinity / negative / unsafe values
// and illegal strings could reach the receipt header and the finished goods
// valuation.
//
// Positive evidence is produced only through the production HTTP API. Direct
// SQL is used only for the isolated historical fixture the production API
// cannot express (a receipt whose detail line records no notice line source).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createApprovedProcessingPo, createProcurementFixture, outsourcingReceiptBody, seedApprovedOutsourceBom,
} from './test-support/procurement-http-fixture.js';

describe('M1C-WP2–WP6-R1 — outsourcing notice line capacity and processing fee amount', () => {
  let fixture;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const SNAPSHOT_TABLES = [
    'receipt_notices', 'receipt_notice_items', 'receipt_notice_item_sources',
    'outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_cost_evidences',
    'inventory', 'inventory_transactions',
    'inventory_valuation_movements', 'inventory_valuation_balances',
  ];

  function businessSnapshot() {
    const snapshot = {};
    for (const table of SNAPSHOT_TABLES) {
      snapshot[table] = JSON.stringify(fixture.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    }
    return snapshot;
  }

  function rejectAudits(entityType, entityId) {
    return Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id=?",
    ).get(entityType, entityId).n);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
      ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:product-001`, 'product-001', now);
  }

  async function releaseOrder(quantity) {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0 }], `wp2r1-cap-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: quantity, unit: 'EA',
      businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const orderId = order.data.id;
    // 用料快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03）。
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`,
      fixture.tokens.admin, { action: 'CONFIRM_PLAN' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`,
      fixture.tokens.admin, { action: 'RELEASE' })).status, 200);
    return orderId;
  }

  /** A confirmed OUTSOURCE completion notice with its own notice line. */
  async function createOutsourceNotice(orderId, quantity, key) {
    const processingPoId = await createApprovedProcessingPo(fixture, orderId, key);
    const poItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
    const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId,
      warehouseId: 'warehouse-001', noticeDate: isoDate(0),
      items: [{ productId: 'product-001', quantity }], idempotencyKey: `notice-${key}`,
    });
    assert.equal(notice.status, 201, JSON.stringify(notice.data));
    const confirmed = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const noticeItem = fixture.db.prepare('SELECT * FROM receipt_notice_items WHERE notice_id=?').get(notice.data.id);
    return {
      processingPoId, processingPoItemId: poItem.id, sourceNoticeId: notice.data.id,
      sourceNoticeItemId: noticeItem.id, productId: 'product-001',
      unitCode: poItem.document_uom_code || 'EA', warehouseId: 'warehouse-001',
    };
  }

  function receiptBody(orderId, source, quantity, processingFeeCents) {
    return {
      orderId, quantity, receivedDate: isoDate(0), businessDate: isoDate(0),
      processingPoId: source.processingPoId, sourceNoticeId: source.sourceNoticeId,
      warehouseId: source.warehouseId, processingFeeCents,
      ...outsourcingReceiptBody(source, quantity, processingFeeCents),
    };
  }

  async function createReceipt(orderId, source, quantity, processingFeeCents, key) {
    return fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving,
      receiptBody(orderId, source, quantity, processingFeeCents), { 'idempotency-key': key });
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp2-wp6-r1-capacity-');
    await qualifyOutsourceSupplier();
  });
  after(async () => { await fixture.close(); });

  // =========================================================================
  // P0-01 — the completion notice line capacity is a real, consumed bound
  // =========================================================================
  describe('P0-01 the notice line capacity bounds the receipt', () => {
    test('P0-01-1 the same notice line cannot be received from twice while the order still has quantity', async () => {
      const orderId = await releaseOrder(10);
      const noticeA = await createOutsourceNotice(orderId, 4, `p0-01-1-a-${orderId}`);
      const noticeB = await createOutsourceNotice(orderId, 4, `p0-01-1-b-${orderId}`);

      const first = await createReceipt(orderId, noticeA, 4, 400, `p0-01-1-first-${orderId}`);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(fixture.db.prepare('SELECT business_status status FROM outsourcing_receipts WHERE id=?')
        .get(first.data.id).status, 'PENDING_INSPECTION');

      const before = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);

      // The outsourcing order still has 6 of 10 units of remaining capacity, so
      // only the notice line bound can refuse this receipt.
      const second = await createReceipt(orderId, noticeA, 4, 400, `p0-01-1-second-${orderId}`);
      assert.equal(second.status, 409, JSON.stringify(second.data));
      assert.equal(second.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice line capacity is exceeded`);
      }
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore + 1,
        'exactly one business rejection audit for the refused receipt');
      const rejection = fixture.db.prepare(
        "SELECT detail FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 1",
      ).get(orderId);
      assert.match(rejection.detail, /RECEIPT_NOTICE_CAPACITY_EXCEEDED/,
        'the rejection audit records the exact error code');

      // The other legitimate completion notice is a separate source and stays
      // receivable on its own capacity.
      const other = await createReceipt(orderId, noticeB, 4, 400, `p0-01-1-other-${orderId}`);
      assert.equal(other.status, 201, JSON.stringify(other.data));

      const usage = fixture.db.prepare(`SELECT ori.source_notice_item_source_id notice_item_id, SUM(ori.quantity) quantity
        FROM outsourcing_receipt_items ori JOIN outsourcing_receipts orc ON orc.id = ori.receipt_id
        WHERE orc.order_id=? GROUP BY ori.source_notice_item_source_id`).all(orderId);
      const byNotice = new Map(usage.map((row) => [row.notice_item_id, Number(row.quantity)]));
      assert.equal(byNotice.get(noticeA.sourceNoticeItemId), 4, 'notice A consumed exactly its own 4 units');
      assert.equal(byNotice.get(noticeB.sourceNoticeItemId), 4, 'notice B consumed exactly its own 4 units');
    });

    test('P0-01-2 partial receipts fill the notice line exactly and then refuse one more unit', async () => {
      const orderId = await releaseOrder(10);
      const noticeA = await createOutsourceNotice(orderId, 4, `p0-01-2-a-${orderId}`);

      const first = await createReceipt(orderId, noticeA, 2, 200, `p0-01-2-first-${orderId}`);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const second = await createReceipt(orderId, noticeA, 2, 200, `p0-01-2-second-${orderId}`);
      assert.equal(second.status, 201, JSON.stringify(second.data));

      const before = businessSnapshot();
      const third = await createReceipt(orderId, noticeA, 1, 200, `p0-01-2-third-${orderId}`);
      assert.equal(third.status, 409, JSON.stringify(third.data));
      assert.equal(third.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice line capacity is exceeded`);
      }
    });

    test('P0-01-3 a receipt whose notice line source cannot be proven fails closed', async () => {
      const orderId = await releaseOrder(10);
      const noticeA = await createOutsourceNotice(orderId, 4, `p0-01-3-a-${orderId}`);

      // Isolated historical fixture: a receipt detail line that records no
      // completion notice line source. The remaining capacity of any notice
      // line of this order can then no longer be proven (MC-REQ-12).
      const receiptId = `or-r1-unproven-${orderId}`;
      const now = new Date().toISOString();
      fixture.db.prepare(`INSERT INTO outsourcing_receipts(
          id,receipt_no,order_id,processing_po_id,quantity,received_date,supplier_id,business_status,
          processing_fee_cents,total_cost_cents,creator_id,created_at,updated_at)
        VALUES(?,?,?,NULL,1,?,'supplier-001','CONFIRMED',0,0,'user-admin',?,?)`)
        .run(receiptId, receiptId, orderId, isoDate(0), now, now);
      fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
        VALUES(?,?,'product-001',1,0,1)`).run(`ori-r1-unproven-${orderId}`, receiptId);

      const before = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);
      const refused = await createReceipt(orderId, noticeA, 4, 400, `p0-01-3-refused-${orderId}`);
      assert.equal(refused.status, 409, JSON.stringify(refused.data));
      assert.equal(refused.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the source capacity is unproven`);
      }
      assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore + 1,
        'exactly one business rejection audit');
    });

    test('P0-01-4 the standard purchase receipt path is unaffected', async () => {
      const order = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
        supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
        supplierAddress: '测试地址', paymentTerms: '30 天',
        items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }],
      });
      assert.equal(order.status, 201, order.data.error);
      await fixture.request('POST', `/api/purchase-orders/${order.data.id}/submit`, fixture.tokens.admin);
      await fixture.request('POST', `/api/purchase-orders/${order.data.id}/approve`, fixture.tokens.reviewer);
      const item = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY line_no').get(order.data.id);
      await fixture.request('POST', `/api/purchase-orders/${order.data.id}/delivery-schedules`, fixture.tokens.admin, {
        orderItemId: item.id, plannedQuantity: 10, plannedDate: isoDate(7), upperTolerancePct: 0, lowerTolerancePct: 0,
      });
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: order.data.id, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 4 }],
      });
      assert.equal(notice.status, 201, JSON.stringify(notice.data));
      const source = fixture.db.prepare(
        'SELECT converted_quantity FROM receipt_notice_item_sources WHERE notice_item_id IN (SELECT id FROM receipt_notice_items WHERE notice_id=?)',
      ).get(notice.data.id);
      assert.equal(Number(source.converted_quantity), 0,
        'the standard purchase source model keeps its own explicit converted quantity');
    });
  });

  // =========================================================================
  // P1 — the processing fee amount input
  // =========================================================================
  describe('P1 the processing fee amount is a validated non-negative safe integer amount', () => {
    const invalidHeaders = [
      ['an illegal string', 'abc'],
      ['the NaN string', 'NaN'],
      ['the Infinity string', 'Infinity'],
      ['a negative amount', -100],
      ['a fractional amount', 1.5],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
      ['a boolean', true],
      ['an object', { cents: 1 }],
    ];

    for (const [label, value] of invalidHeaders) {
      test(`P1-1 a header processing fee given as ${label} is refused with 400 and leaves no business fact`, async () => {
        const orderId = await releaseOrder(10);
        const notice = await createOutsourceNotice(orderId, 4, `p1-header-${orderId}-${label}`);
        const before = businessSnapshot();
        const rejectsBefore = rejectAudits('OUTSOURCING_ORDER', orderId);

        const refused = await createReceipt(orderId, notice, 2, value, `p1-header-refused-${orderId}-${label}`);
        assert.equal(refused.status, 400, JSON.stringify(refused.data));
        assert.equal(refused.data.code, 'OUTSOURCING_RECEIPT_AMOUNT_INVALID');

        const after = businessSnapshot();
        for (const table of Object.keys(before)) {
          assert.equal(after[table], before[table], `${table} must stay untouched when the amount input is invalid`);
        }
        assert.equal(rejectAudits('OUTSOURCING_ORDER', orderId), rejectsBefore,
          'a 400 input failure writes no Domain rejection audit');
      });
    }

    test('P1-2 an invalid detail unit price is refused with 400 and leaves no business fact', async () => {
      const orderId = await releaseOrder(10);
      const notice = await createOutsourceNotice(orderId, 4, `p1-item-${orderId}`);
      const before = businessSnapshot();
      const body = receiptBody(orderId, notice, 2, 200);
      body.items[0].unitPriceCents = '12.50';
      const refused = await fixture.request('POST', '/api/procurement/outsourcing/receipts',
        fixture.tokens.outsourcingReceiving, body, { 'idempotency-key': `p1-item-refused-${orderId}` });
      assert.equal(refused.status, 400, JSON.stringify(refused.data));
      assert.equal(refused.data.code, 'OUTSOURCING_RECEIPT_AMOUNT_INVALID');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the amount input is invalid`);
      }
    });

    test('P1-3 a canonical integer amount string is accepted and reaches the receipt and the cost evidence verbatim', async () => {
      const orderId = await releaseOrder(10);
      const notice = await createOutsourceNotice(orderId, 4, `p1-accepted-${orderId}`);
      const body = receiptBody(orderId, notice, 2, '500');
      const created = await fixture.request('POST', '/api/procurement/outsourcing/receipts',
        fixture.tokens.outsourcingReceiving, body, { 'idempotency-key': `p1-accepted-receipt-${orderId}` });
      assert.equal(created.status, 201, JSON.stringify(created.data));

      const receipt = fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(created.data.id);
      assert.equal(Number(receipt.processing_fee_cents), 500);
      assert.equal(Number(receipt.total_cost_cents), 500);

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${created.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `p1-accepted-effect-${orderId}` });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));
      const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(created.data.id);
      assert.equal(Number(evidence.processing_fee_provisional_cents), 500,
        'the approved processing fee amount reaches the cost evidence unchanged');
    });

    test('P1-4 an omitted processing fee keeps the approved default of zero cents', async () => {
      const orderId = await releaseOrder(10);
      const notice = await createOutsourceNotice(orderId, 4, `p1-default-${orderId}`);
      const body = receiptBody(orderId, notice, 2, 0);
      delete body.processingFeeCents;
      delete body.items[0].unitPriceCents;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/receipts',
        fixture.tokens.outsourcingReceiving, body, { 'idempotency-key': `p1-default-receipt-${orderId}` });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const receipt = fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(created.data.id);
      assert.equal(Number(receipt.processing_fee_cents), 0);
      assert.equal(Number(receipt.total_cost_cents), 0);
    });
  });
});
