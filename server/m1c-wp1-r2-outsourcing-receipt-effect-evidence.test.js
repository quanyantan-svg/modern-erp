// M1C-WP1-R2 focused regression suite.
//
// Contract source: M1-Core Active Design §5.2.2 / §9.1 / §9.3 / §10 / §13.1
// and the approved Requirement MC-REQ-09 / MC-REQ-11 / MC-REQ-12
// (docs/requirements/procurement-outsourcing.md §31.13).
//
// The defect under repair: resolveOutsourcingOrderCapacity() treated the mere
// existence of an iqc_inspections row as proof that a historical outsourcing
// receipt took effect. iqc_inspections.status defaults to PENDING and the
// result stays NULL until the inspection is completed, so an unfinished
// inspection made an unproven historical receipt look "已生效已确认" instead
// of failing closed (Active Design §10).
//
// Every positive case drives the production HTTP API. Direct SQL is only used
// for the isolated historical fixtures the production API cannot produce yet:
// a receipt detail line (M1C-WP-2 owns that writer) and an unfinished /
// cancelled / failed quality record.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApprovedProcessingPo, createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom, seedPurchasePrice, seedOutsourceSource } from './test-support/procurement-http-fixture.js';

describe('M1C-WP1-R2 — outsourcing historical receipt effect evidence fails closed', () => {
  let fixture;
  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp1-r2-');
    await seedPurchasePrice(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', unitPriceCents: 1000 }]);
  });
  after(async () => { await fixture.close(); });

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    assert.equal(result.status, 200, result.data.error);
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) }]);
  }

  async function createReleasedOutsourcingOrder(orderQuantity) {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0 }], `wp1r2-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity, businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    // 用料快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03）。
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    return order.data.id;
  }

  /** Isolated historical fixture: a receipt created BEFORE M1C-WP-2 existed.
   * The current production writer requires a CONFIRMED completion notice, a
   * source-locked processing PO and detail lines, so a pre-WP-2 receipt can
   * only be expressed as history. The suite is exactly about such history:
   * whether it proves the receipt effect. */
  function createHistoricalReceipt(orderId, quantity) {
    const id = `or-r2-${orderId}-${quantity}`;
    const day = isoDate(0);
    fixture.db.prepare(`INSERT INTO outsourcing_receipts(
        id,receipt_no,order_id,processing_po_id,quantity,received_date,supplier_id,business_status,
        processing_fee_cents,total_cost_cents,creator_id,created_at,updated_at)
      VALUES(?,?,?,NULL,?,?,?,'CONFIRMED',10000,10000,'user-admin',?,?)`)
      .run(id, id, orderId, quantity, day, 'supplier-001', day, day);
    insertReceiptItem(id, quantity);
    return id;
  }

  /** Isolated historical fixture: the production receipt writer does not emit
   * detail lines yet (M1C-WP-2 owns that writer), and the authoritative
   * quality gate requires at least one detail line. */
  function insertReceiptItem(receiptId, quantity) {
    const itemId = `ori-r2-${receiptId}`;
    fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
      VALUES(?,?,?,?,?,?)`).run(itemId, receiptId, 'product-001', quantity, 1000, 1);
    return itemId;
  }

  /** Isolated historical fixture: an unfinished, cancelled or failed quality
   * record. The production API only ever creates DRAFT records. */
  function insertHistoricalInspection(receiptId, { status, result = null, orderId = null, quantity = 10 }) {
    const id = `iqc-r2-${status}-${receiptId}`;
    const day = isoDate(0);
    fixture.db.prepare(`INSERT INTO iqc_inspections(id,iqc_no,supplier_id,outsourcing_receipt_id,source_type,status,result,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspection_type,inspection_date,remark,created_at,updated_at,outsourcing_order_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, `IQC-R2-${status}-${receiptId}`, 'supplier-001', receiptId, 'OUTSOURCING_RECEIPT', status, result,
      quantity, 0, 0, 0, 'NORMAL', day, '', day, day, orderId,
    );
    return id;
  }

  async function createOutsourceNotice(orderId, quantity) {
    return fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId,
      processingPoId: await createApprovedProcessingPo(fixture, orderId), warehouseId: 'warehouse-001',
      noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity }],
    });
  }

  function businessSnapshot() {
    const tables = [
      'receipt_notices', 'receipt_notice_items', 'receipt_notice_item_sources',
      'outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_cost_evidences',
      'iqc_inspections', 'inventory', 'inventory_transactions',
      'inventory_valuation_movements', 'inventory_valuation_balances',
    ];
    const snapshot = {};
    for (const table of tables) snapshot[table] = JSON.stringify(fixture.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    return snapshot;
  }

  function rejectAudits(entityType, entityId) {
    return Number(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type=? AND entity_id=? AND action='REJECT'").get(entityType, entityId).n);
  }

  // =========================================================================
  // A / B / C / D — an unfinished or invalid quality record proves nothing
  // =========================================================================
  describe('A-D an unfinished or invalid quality record is not effect evidence', () => {
    test('A a PENDING quality record does not prove a historical receipt (the defect)', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'PENDING', orderId });

      const rejected = await createOutsourceNotice(orderId, 10);
      assert.equal(rejected.status, 409, 'an unfinished inspection must not prove the receipt effect');
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
    });

    test('B a DRAFT quality record does not prove a historical receipt', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'DRAFT', orderId });

      const rejected = await createOutsourceNotice(orderId, 10);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
    });

    test('C a CANCELLED quality record does not prove a historical receipt', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'CANCELLED', orderId });

      const rejected = await createOutsourceNotice(orderId, 10);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
    });

    test('D a COMPLETED but FAILED quality record does not prove a historical receipt', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'COMPLETED', result: 'FAIL', orderId, quantity: 60 });

      const rejected = await createOutsourceNotice(orderId, 10);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
    });
  });

  // =========================================================================
  // E — a completed, effective quality decision proves the receipt
  // =========================================================================
  describe('E a completed quality decision proves the receipt effect', () => {
    test('E a completed PASS quality decision lets the receipt count as received capacity', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);

      const created = await fixture.request('POST', '/api/iqc', fixture.tokens.admin, { outsourcing_receipt_id: receiptId });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const completed = await fixture.request('POST', `/api/iqc/${created.data.id}/complete`, fixture.tokens.admin, {
        result: 'PASS', inspection_quantity: 60, passed_quantity: 60, failed_quantity: 0,
      });
      assert.equal(completed.status, 200, JSON.stringify(completed.data));

      // The proven receipt consumes 60 of the 100 ordered units: the notice
      // may take exactly the remaining 40 and nothing beyond it.
      const within = await createOutsourceNotice(orderId, 40);
      assert.equal(within.status, 201, JSON.stringify(within.data));
      const confirmed = await fixture.request('POST', `/api/receipt-notices/${within.data.id}/confirm`, fixture.tokens.admin);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

      const over = await createOutsourceNotice(orderId, 1);
      assert.equal(over.status, 409, JSON.stringify(over.data));
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED',
        'a proven receipt is a capacity bound, never an unproven history');
    });
  });

  // =========================================================================
  // F — real inventory / valuation / cost evidence is never misjudged
  // =========================================================================
  describe('F real effect evidence is not misjudged as unknown', () => {
    test('F1 a receipt confirmed through the production API keeps its inventory and cost evidence', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      // M1C-WP-2：生产收货写入器要求 CONFIRMED 完工通知、来源锁定的加工费 PO 与明细行。
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 30, `wp1-r2-f1-${orderId}`);
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
        orderId, ...outsourcingReceiptBody(source, 30, 10000), processingFeeCents: 10000,
      }, { 'idempotency-key': `wp1-r2-f1-receipt-${orderId}` });
      assert.equal(receipt.status, 201, receipt.data.error);
      const receiptId = receipt.data.id;
      const receiptConfirmed = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `wp1-r2-f1-effect-${orderId}` });
      assert.equal(receiptConfirmed.status, 200, JSON.stringify(receiptConfirmed.data));

      const movements = fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n;
      const evidence = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n;
      assert.ok(movements > 0 && evidence > 0, 'the confirmed receipt carries real effect evidence');

      // The proven receipt consumes 30 of the 100 ordered units.
      const within = await createOutsourceNotice(orderId, 70);
      assert.equal(within.status, 201, JSON.stringify(within.data));
      const confirmed = await fixture.request('POST', `/api/receipt-notices/${within.data.id}/confirm`, fixture.tokens.admin);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

      const over = await createOutsourceNotice(orderId, 1);
      assert.equal(over.status, 409, JSON.stringify(over.data));
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED',
        'real inventory and cost evidence are never misjudged as unknown');
    });

    test('F2 a historical receipt with only a valuation movement is still proven', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 40);
      const itemId = fixture.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receiptId).id;
      // Isolated historical fixture: a receipt whose only recorded effect is a
      // posted valuation movement.
      fixture.db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,quantity_delta,value_delta_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        `ivm-r2-${receiptId}`, isoDate(0), 'product-001', 'warehouse-001', 40, 40000,
        'MOVING_AVERAGE', 'OUTSOURCING_RECEIPT', 'OUTSOURCING_RECEIPT', receiptId, itemId, new Date().toISOString(),
      );

      const over = await createOutsourceNotice(orderId, 70);
      assert.equal(over.status, 409, JSON.stringify(over.data));
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED',
        'a real valuation movement is a proven effect, never an unproven history');

      const within = await createOutsourceNotice(orderId, 60);
      assert.equal(within.status, 201, JSON.stringify(within.data));
    });
  });

  // =========================================================================
  // G / H — the confirmation path and the zero side effect contract
  // =========================================================================
  describe('G-H the unproven capacity fails closed on both notice paths', () => {
    test('G an OUTSOURCE notice confirmation is rejected with the exact code when the history is unproven', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      // The notice is created while the order still has no receipt.
      const notice = await createOutsourceNotice(orderId, 10);
      assert.equal(notice.status, 201, JSON.stringify(notice.data));

      // A historical receipt with an unfinished inspection appears afterwards.
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'PENDING', orderId });

      const rejected = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin);
      assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');
      const row = fixture.db.prepare('SELECT status FROM receipt_notices WHERE id=?').get(notice.data.id);
      assert.equal(row.status, 'DRAFT', 'a rejected confirmation keeps the notice untouched');
      assert.equal(rejectAudits('RECEIPT_NOTICE', notice.data.id), 1, 'exactly one rejection audit');
    });

    test('H a rejected OUTSOURCE notice has zero business side effects and exactly one rejection audit', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const receiptId = createHistoricalReceipt(orderId, 60);
      insertHistoricalInspection(receiptId, { status: 'PENDING', orderId });

      const before = businessSnapshot();
      const auditsBefore = fixture.db.prepare("SELECT id FROM audit_logs WHERE action='REJECT'").all().map((row) => row.id);
      const rejected = await createOutsourceNotice(orderId, 10);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice creation fails`);
      }
      const added = fixture.db.prepare("SELECT id, detail FROM audit_logs WHERE action='REJECT'").all()
        .filter((row) => !auditsBefore.includes(row.id));
      assert.equal(added.length, 1, 'exactly one rejection audit');
      assert.match(added[0].detail, /RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN/);
    });
  });

  // =========================================================================
  // I — the standard purchase notice path is untouched
  // =========================================================================
  describe('I the standard purchase notice path is unaffected', () => {
    test('I a standard purchase notice still resolves its own capacity', async () => {
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
      const schedule = await fixture.request('POST', `/api/purchase-orders/${order.data.id}/delivery-schedules`, fixture.tokens.admin, {
        orderItemId: item.id, plannedQuantity: 10, plannedDate: isoDate(7), upperTolerancePct: 0, lowerTolerancePct: 0,
      });
      assert.equal(schedule.status, 201, schedule.data.error);

      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: order.data.id, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 4 }],
      });
      assert.equal(notice.status, 201, JSON.stringify(notice.data));
      const source = fixture.db.prepare('SELECT converted_quantity FROM receipt_notice_item_sources WHERE notice_item_id IN (SELECT id FROM receipt_notice_items WHERE notice_id=?)').get(notice.data.id);
      assert.equal(Number(source.converted_quantity), 0, 'a fresh standard purchase source row states an explicit 0');
    });
  });
});
