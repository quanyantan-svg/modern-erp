// M1C-WP-1 focused regression suite.
//
// Contract source: M1-Core Active Design §5.1 / §5.2 / §6 / §7 / §9 and the
// approved Requirement MC-REQ-02 / MC-REQ-09 / MC-REQ-11
// (docs/requirements/procurement-outsourcing.md §31.13).
//
// The positive path drives the PRODUCTION HTTP API end to end (notice
// creation -> conversion -> purchase receipt -> IQC -> receipt confirmation).
// Direct SQL is only used for the two fixtures the production API cannot
// produce: a legacy source row whose converted quantity is unproven, and a
// negative precondition. Nothing in this suite mocks a business success.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApprovedProcessingPo, createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('M1C-WP-1 — receipt notice sources, business-type scoped capacity and notice conversion', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-m1c-wp1-'); });
  after(async () => { await fixture.close(); });

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  let orderCounter = 0;

  async function createApprovedOrder(items, { supplierId = 'supplier-001' } = {}) {
    orderCounter += 1;
    const order = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId, orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
      supplierAddress: '测试地址', paymentTerms: '30 天', items,
    });
    assert.equal(order.status, 201, order.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${order.data.id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${order.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    const rows = fixture.db.prepare('SELECT id, product_id, quantity FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(order.data.id);
    return { orderId: order.data.id, itemIds: rows.map((row) => row.id), rows };
  }

  async function createSchedule(orderId, orderItemId, plannedQuantity, { upperTolerancePct = 0 } = {}) {
    const result = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin, {
      orderItemId, plannedQuantity, plannedDate: isoDate(7), upperTolerancePct, lowerTolerancePct: 0,
    });
    assert.equal(result.status, 201, result.data.error);
    return result.data.id;
  }

  function noticeSources(noticeId) {
    return fixture.db.prepare(`SELECT s.* FROM receipt_notice_item_sources s
      JOIN receipt_notice_items i ON i.id = s.notice_item_id
      WHERE i.notice_id=? ORDER BY s.id`).all(noticeId);
  }

  function rejectAudits(entityType, entityId) {
    return fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type=? AND entity_id=? AND action='REJECT'").get(entityType, entityId).n;
  }

  function businessSnapshot() {
    const tables = [
      'receipt_notices', 'receipt_notice_items', 'receipt_notice_item_sources',
      'purchase_receipts', 'purchase_receipt_items', 'inventory', 'inventory_transactions',
      'inventory_valuation_movements', 'inventory_valuation_balances', 'schedule_consumption_effects',
      'account_payables', 'accounting_vouchers',
    ];
    const snapshot = {};
    for (const table of tables) snapshot[table] = JSON.stringify(fixture.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    return snapshot;
  }

  async function passQuality(receiptId, quantity) {
    const created = await fixture.request('POST', '/api/iqc', fixture.tokens.warehouse, { purchase_receipt_id: receiptId });
    assert.equal(created.status, 201, created.data.error);
    const completed = await fixture.request('POST', `/api/iqc/${created.data.id}/complete`, fixture.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
    assert.equal(completed.status, 200, completed.data.error);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    assert.equal(result.status, 200, result.data.error);
  }

  async function createReleasedOutsourcingOrder(orderQuantity) {
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity, businessDate: isoDate(0),
    });
    assert.equal(order.status, 201, order.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    return order.data.id;
  }

  // =========================================================================
  // WP-1A — notice creation and line level source allocation
  // =========================================================================
  describe('WP-1A notice creation and line level source allocation', () => {
    test('A1 compatible single purchase order input is normalised into one authoritative source row with converted_quantity=0', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);

      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 4 }],
      });
      assert.equal(notice.status, 201, notice.data.error);

      const sources = noticeSources(notice.data.id);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].purchase_order_item_id, itemIds[0]);
      assert.equal(Number(sources[0].allocated_quantity), 4);
      assert.equal(sources[0].converted_quantity, 0, 'a freshly created source row states an explicit 0, never NULL');
      assert.ok(sources[0].delivery_schedule_id, 'the unique delivery schedule is bound deterministically');

      const header = fixture.db.prepare('SELECT purchase_order_id, business_type, status FROM receipt_notices WHERE id=?').get(notice.data.id);
      assert.equal(header.purchase_order_id, orderId);
      assert.equal(header.business_type, 'STANDARD_PURCHASE');
      assert.equal(header.status, 'DRAFT');
    });

    test('A2 one notice may allocate several purchase order lines of several purchase orders', async () => {
      const first = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const second = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1200 }]);
      await createSchedule(first.orderId, first.itemIds[0], 10);
      await createSchedule(second.orderId, second.itemIds[0], 10);

      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{
          productId: 'product-001', quantity: 6,
          sourceAllocations: [
            { purchaseOrderItemId: first.itemIds[0], allocatedQuantity: 4 },
            { purchaseOrderItemId: second.itemIds[0], allocatedQuantity: 2 },
          ],
        }],
      });
      assert.equal(notice.status, 201, notice.data.error);

      const sources = noticeSources(notice.data.id);
      assert.equal(sources.length, 2);
      assert.deepEqual(sources.map((source) => source.purchase_order_item_id).sort(), [first.itemIds[0], second.itemIds[0]].sort());
      for (const source of sources) assert.equal(source.converted_quantity, 0);
      const header = fixture.db.prepare('SELECT purchase_order_id FROM receipt_notices WHERE id=?').get(notice.data.id);
      assert.ok([first.orderId, second.orderId].includes(header.purchase_order_id), 'the header order is only a derived compatibility hint');
    });

    test('A3 the allocation total must equal the notice line quantity and the rejection leaves no trace', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const before = businessSnapshot();

      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{
          productId: 'product-001', quantity: 5,
          sourceAllocations: [{ purchaseOrderItemId: itemIds[0], allocatedQuantity: 4 }],
        }],
      });
      assert.equal(notice.status, 409);
      assert.equal(notice.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      assert.deepEqual(businessSnapshot(), before, 'a rejected notice leaves the business facts untouched');
    });

    test('A4 order, supplier, product and warehouse mismatches are rejected', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);

      const notApproved = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
        supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
        supplierAddress: '测试地址', paymentTerms: '30 天', items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
      });
      assert.equal(notApproved.status, 201);
      const unapprovedItem = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(notApproved.data.id).id;
      const unapproved = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: notApproved.data.id, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: unapprovedItem, productId: 'product-001', quantity: 1 }],
      });
      assert.equal(unapproved.status, 409);

      const supplierMismatch = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-002', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 1 }],
      });
      assert.equal(supplierMismatch.status, 409);

      const productMismatch = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-002', quantity: 1 }],
      });
      assert.equal(productMismatch.status, 409);

      const warehouseMismatch = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-does-not-exist',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 1 }],
      });
      assert.equal(warehouseMismatch.status, 400);
    });

    test('A5 a single delivery schedule is bound automatically, several schedules demand an explicit selection and zero schedule fails closed', async () => {
      const unique = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const uniqueSchedule = await createSchedule(unique.orderId, unique.itemIds[0], 10);
      const bound = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: unique.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: unique.itemIds[0], productId: 'product-001', quantity: 2 }],
      });
      assert.equal(bound.status, 201, bound.data.error);
      assert.equal(noticeSources(bound.data.id)[0].delivery_schedule_id, uniqueSchedule);

      const ambiguous = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const firstSchedule = await createSchedule(ambiguous.orderId, ambiguous.itemIds[0], 5);
      const secondSchedule = await createSchedule(ambiguous.orderId, ambiguous.itemIds[0], 5);
      const ambiguousNotice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: ambiguous.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: ambiguous.itemIds[0], productId: 'product-001', quantity: 2 }],
      });
      assert.equal(ambiguousNotice.status, 409);
      assert.equal(ambiguousNotice.data.code, 'RECEIPT_NOTICE_SCHEDULE_UNPROVEN');

      const explicit = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: ambiguous.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{
          productId: 'product-001', quantity: 2,
          sourceAllocations: [{ purchaseOrderItemId: ambiguous.itemIds[0], deliveryScheduleId: secondSchedule, allocatedQuantity: 2 }],
        }],
      });
      assert.equal(explicit.status, 201, explicit.data.error);
      assert.equal(noticeSources(explicit.data.id)[0].delivery_schedule_id, secondSchedule);
      assert.notEqual(secondSchedule, firstSchedule);

      const noSchedule = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const zeroSchedule = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: noSchedule.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: noSchedule.itemIds[0], productId: 'product-001', quantity: 2 }],
      });
      assert.equal(zeroSchedule.status, 409);
      assert.equal(zeroSchedule.data.code, 'RECEIPT_NOTICE_SCHEDULE_UNPROVEN');
    });

    test('A6 conflicting legacy and multi order source facts are rejected instead of silently preferring one', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const conflict = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{
          productId: 'product-001', quantity: 2, purchaseOrderItemId: itemIds[0],
          sourceAllocations: [{ purchaseOrderItemId: 'po-item-that-does-not-exist', allocatedQuantity: 2 }],
        }],
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, 'RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN');
    });

    test('A7 a failing source row rolls the whole notice creation back', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const before = businessSnapshot();
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0),
        items: [
          { productId: 'product-001', quantity: 2, purchaseOrderItemId: itemIds[0] },
          { productId: 'product-001', quantity: 2, purchaseOrderItemId: 'po-item-that-does-not-exist' },
        ],
      });
      assert.equal(notice.status, 400);
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice creation fails`);
      }
    });

    test('A8 an OUTSOURCE notice never writes a standard purchase source row', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId,
        processingPoId: await createApprovedProcessingPo(fixture, orderId), warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity: 10 }],
      });
      assert.equal(notice.status, 201, notice.data.error);
      assert.equal(noticeSources(notice.data.id).length, 0, 'the outsourcing chain keeps its own provenance');
    });
  });

  // =========================================================================
  // WP-1B — business type scoped capacity
  // =========================================================================
  describe('WP-1B business type scoped capacity', () => {
    test('B1 the outsourcing confirmation counts the quantity of this notice exactly once', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(100);
      const processingPoId = await createApprovedProcessingPo(fixture, orderId);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId, warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity: 60 }],
      });
      assert.equal(notice.status, 201, notice.data.error);
      const confirmed = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

      // The confirmed notice reserves 60 of the 100 ordered units exactly once:
      // confirming it again is refused and must change nothing.
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin);
      assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
      assert.equal(rejectAudits('RECEIPT_NOTICE', notice.data.id), 1, 'exactly one rejection audit');
      const row = fixture.db.prepare('SELECT status FROM receipt_notices WHERE id=?').get(notice.data.id);
      assert.equal(row.status, 'CONFIRMED', 'a rejected confirmation keeps the notice untouched');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice confirmation fails`);
      }

      // Only the remaining 40 of the 100 ordered units may still be notified.
      const over = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId, warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity: 60 }],
      });
      assert.equal(over.status, 409, JSON.stringify(over.data));
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
    });

    test('B2 an outsourcing notice capacity never uses a purchase order line capacity and the reverse holds as well', async () => {
      await qualifyOutsourceSupplier();
      const orderId = await createReleasedOutsourcingOrder(10);
      const before = businessSnapshot();
      const auditsBefore = fixture.db.prepare("SELECT id FROM audit_logs WHERE action='REJECT'").all().map((row) => row.id);
      const over = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId,
        processingPoId: await createApprovedProcessingPo(fixture, orderId), warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity: 11 }],
      });
      assert.equal(over.status, 409, 'the outsourcing order capacity is the only bound of an outsourcing notice');
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the notice creation fails`);
      }
      const addedAudits = fixture.db.prepare("SELECT id, detail FROM audit_logs WHERE action='REJECT'").all()
        .filter((row) => !auditsBefore.includes(row.id));
      assert.equal(addedAudits.length, 1, 'exactly one rejection audit');
      assert.match(addedAudits[0].detail, /RECEIPT_NOTICE_CAPACITY_EXCEEDED/, 'the rejection audit records the exact error code');

      const within = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        businessType: 'OUTSOURCE', outsourcingOrderId: orderId,
        processingPoId: await createApprovedProcessingPo(fixture, orderId), warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ productId: 'product-001', quantity: 5 }],
      });
      assert.equal(within.status, 201, within.data.error);
      assert.equal(noticeSources(within.data.id).length, 0, 'an outsourcing notice owns no standard purchase source row');

      const convert = await fixture.request('POST', `/api/receipt-notices/${within.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: 'not-a-source-row', quantity: 1 }], idempotencyKey: 'wp1-b2',
      });
      assert.equal(convert.status, 409, 'an outsourcing notice is never converted into a purchase receipt');
    });

    test('B3 a standard purchase notice may not exceed the purchase order line capacity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 5, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 5);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal(notice.status, 409);
      assert.equal(notice.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
    });
  });

  // =========================================================================
  // WP-1C — notice to purchase receipt conversion
  // =========================================================================
  describe('WP-1C notice to purchase receipt conversion', () => {
    test('C1 a converted notice creates a purchase receipt, accumulates the converted quantity and keeps the line level provenance', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal(notice.status, 201, notice.data.error);
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);

      const source = noticeSources(notice.data.id)[0];
      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 4 }], idempotencyKey: 'wp1-c1',
      });
      assert.equal(converted.status, 201, JSON.stringify(converted.data));
      assert.equal(converted.data.receipts.length, 1);
      const receiptId = converted.data.receipts[0].id;

      const receipt = fixture.db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
      assert.equal(receipt.source_notice_id, notice.data.id);
      assert.equal(receipt.purchase_order_id, orderId);
      assert.equal(receipt.status, 'DRAFT');
      const receiptItem = fixture.db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=?').get(receiptId);
      assert.equal(receiptItem.source_notice_item_source_id, source.id);
      assert.equal(receiptItem.purchase_order_item_id, itemIds[0]);
      assert.equal(receiptItem.delivery_schedule_id, source.delivery_schedule_id);
      assert.equal(Number(receiptItem.quantity), 4);

      assert.equal(Number(noticeSources(notice.data.id)[0].converted_quantity), 4);

      // The delivery schedule consumption ledger owns the consumption.
      const effect = fixture.db.prepare("SELECT * FROM schedule_consumption_effects WHERE business_event_type='PURCHASE_RECEIPT_CREATE' AND business_event_id=?").get(receiptId);
      assert.ok(effect, 'the receipt line registers a signed schedule consumption effect');
      assert.equal(Number(effect.signed_quantity), 4);
      assert.equal(effect.effect_state, 'EFFECTIVE');
      assert.equal(effect.reverses_effect_id, null);
      assert.ok(effect.request_fingerprint, 'the effect carries the approved request fingerprint');
    });

    test('C2 a partial conversion accumulates and a second conversion continues from the remaining capacity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];

      const first = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 2 }], idempotencyKey: 'wp1-partial-1',
      });
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(Number(noticeSources(notice.data.id)[0].converted_quantity), 2);

      const second = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 3 }], idempotencyKey: 'wp1-partial-2',
      });
      assert.equal(second.status, 201, JSON.stringify(second.data));
      assert.equal(Number(noticeSources(notice.data.id)[0].converted_quantity), 5, 'the converted quantity only grows');
      assert.notEqual(first.data.receipts[0].id, second.data.receipts[0].id);
    });

    test('C3 an idempotent replay neither duplicates the receipt nor the source accounting', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];
      const body = { items: [{ sourceId: source.id, quantity: 2 }], idempotencyKey: 'wp1-replay' };

      const first = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, body);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const replay = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, body);
      assert.equal(replay.status, 200);
      assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.receipts[0].id, first.data.receipts[0].id);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM purchase_receipts WHERE source_notice_id=?').get(notice.data.id).n, 1);
      assert.equal(Number(noticeSources(notice.data.id)[0].converted_quantity), 2, 'a replay never re-accumulates');

      const conflicting = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 3 }], idempotencyKey: 'wp1-replay',
      });
      assert.equal(conflicting.status, 409, 'the same idempotency key cannot carry a different request');
    });

    test('C4 cancelling a converted receipt never restores the converted source capacity and a re-conversion is refused', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];
      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 6 }], idempotencyKey: 'wp1-cancel',
      });
      assert.equal(converted.status, 201, JSON.stringify(converted.data));

      const cancelled = await fixture.request('POST', `/api/purchase-receipts/${converted.data.receipts[0].id}`, fixture.tokens.warehouse, { action: 'cancel' });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
      assert.equal(Number(noticeSources(notice.data.id)[0].converted_quantity), 6, 'the cancelled receipt does not restore the converted capacity');

      const again = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 1 }], idempotencyKey: 'wp1-cancel-again',
      });
      assert.equal(again.status, 409);
      assert.equal(again.data.code, 'RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN');
      assert.equal(rejectAudits('RECEIPT_NOTICE', notice.data.id), 1);
    });

    test('C5 a source row with an unproven historical converted quantity never provides conversion capacity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];
      // Legacy fixture: the historical converted quantity is unproven.
      fixture.db.prepare('UPDATE receipt_notice_item_sources SET converted_quantity=NULL WHERE id=?').run(source.id);

      const before = businessSnapshot();
      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 1 }], idempotencyKey: 'wp1-legacy-null',
      });
      assert.equal(converted.status, 409);
      assert.equal(converted.data.code, 'RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN');
      assert.deepEqual(businessSnapshot(), before, 'a refused conversion keeps every business fact unchanged');
      assert.equal(rejectAudits('RECEIPT_NOTICE', notice.data.id), 1);
    });

    test('C6 an illegal conversion changes no document, no inventory, no valuation and no schedule ledger', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];
      const before = businessSnapshot();

      const over = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 99 }], idempotencyKey: 'wp1-over',
      });
      assert.equal(over.status, 409);
      assert.equal(over.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay byte identical after a refused conversion`);
      }
      assert.equal(rejectAudits('RECEIPT_NOTICE', notice.data.id), 1, 'exactly one rejection audit');
    });

    test('C7 a multi purchase order notice converts into one receipt per purchase order with a per line trace', async () => {
      const first = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const second = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1200 }]);
      await createSchedule(first.orderId, first.itemIds[0], 10);
      await createSchedule(second.orderId, second.itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', noticeDate: isoDate(0),
        items: [{
          productId: 'product-001', quantity: 6,
          sourceAllocations: [
            { purchaseOrderItemId: first.itemIds[0], allocatedQuantity: 4 },
            { purchaseOrderItemId: second.itemIds[0], allocatedQuantity: 2 },
          ],
        }],
      });
      assert.equal(notice.status, 201, notice.data.error);
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const sources = noticeSources(notice.data.id);

      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: sources.map((source) => ({ sourceId: source.id, quantity: Number(source.allocated_quantity) })),
        idempotencyKey: 'wp1-multi',
      });
      assert.equal(converted.status, 201, JSON.stringify(converted.data));
      assert.equal(converted.data.receipts.length, 2, 'one receipt per purchase order');
      const orderIds = converted.data.receipts.map((receipt) => receipt.purchaseOrderId).sort();
      assert.deepEqual(orderIds, [first.orderId, second.orderId].sort());
      for (const source of sources) assert.equal(Number(noticeSources(notice.data.id).find((row) => row.id === source.id).converted_quantity), Number(source.allocated_quantity));
    });

    test('C8 the notice detail exposes the traceable converted and remaining quantities', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      const detail = await fixture.request('GET', `/api/receipt-notices/${notice.data.id}`, fixture.tokens.admin);
      assert.equal(detail.status, 200);
      const item = detail.data.receiptNotice.items[0];
      assert.equal(item.sources.length, 1);
      assert.equal(item.sources[0].allocatedQuantity, 6);
      assert.equal(item.sources[0].convertedQuantity, 0);
      assert.equal(item.sources[0].remainingQuantity, 6);
      assert.equal(item.sources[0].convertedProven, true);
    });
  });

  // =========================================================================
  // WP-1D — delivery schedule ledger and the untouched direct purchase path
  // =========================================================================
  describe('WP-1D delivery schedule ledger and the direct purchase receipt path', () => {
    test('D0 concurrent 6 vs 6 notice creation yields exact 201/409 and distinct numbers cannot mask capacity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const originalNow = Date.now;
      Date.now = () => 1_800_000_000_123;
      try {
        const body = (key) => ({
          purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
          noticeDate: isoDate(0), idempotencyKey: key,
          items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
        });
        const results = await Promise.all([
          fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, body('cr01-a')),
          fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, body('cr01-b')),
        ]);
        assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
        const rejected = results.find((result) => result.status === 409);
        assert.equal(rejected.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
        const rows = fixture.db.prepare('SELECT notice_no FROM receipt_notices WHERE purchase_order_id=? ORDER BY notice_no').all(orderId);
        assert.equal(rows.length, 1);
        assert.match(rows[0].notice_no, /^RN\d{10}$/);
      } finally {
        Date.now = originalNow;
      }
    });

    test('D1 the direct purchase order to purchase receipt path stays legal and consumes the schedule ledger', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      const scheduleId = await createSchedule(orderId, itemIds[0], 10);

      const created = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        receiptDate: isoDate(0), remark: '直接收货', billingMode: 'LEGACY_DIRECT',
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 4 }],
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));

      const receiptItem = fixture.db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=?').get(created.data.id);
      assert.equal(receiptItem.delivery_schedule_id, scheduleId, 'the unique delivery schedule is bound');
      const effect = fixture.db.prepare("SELECT * FROM schedule_consumption_effects WHERE business_event_type='PURCHASE_RECEIPT_CREATE' AND business_event_id=?").get(created.data.id);
      assert.equal(Number(effect.signed_quantity), 4);

      // The legacy cumulative column is never written: the ledger is the one
      // authoritative consumption source.
      const schedule = fixture.db.prepare('SELECT received_quantity FROM purchase_order_delivery_schedules WHERE id=?').get(scheduleId);
      assert.equal(Number(schedule.received_quantity), 0, 'the legacy cumulative field is not a second consumption counter');

      await passQuality(created.data.id, 4);
      const confirmed = await fixture.request('POST', `/api/purchase-receipts/${created.data.id}`, fixture.tokens.warehouse, { action: 'confirm' });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

      const inventory = fixture.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
      assert.ok(Number(inventory.quantity) >= 4, 'the inventory effect is written');
      const valuation = fixture.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(created.data.id).n;
      assert.ok(valuation >= 1, 'the valuation movement is written');
      const payable = fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(created.data.id).n;
      assert.equal(payable, 1, 'the financial recognition is written');
      const voucher = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(created.data.id).n;
      assert.equal(voucher, 1, 'the voucher is written');
      const quality = fixture.db.prepare("SELECT COUNT(*) n FROM iqc_inspections WHERE purchase_receipt_id=?").get(created.data.id).n;
      assert.equal(quality, 1, 'the IQC decision stays reachable and effective');

      const rejectsBefore = rejectAudits('PURCHASE_RECEIPT', created.data.id);
      const repeated = await fixture.request('POST', `/api/purchase-receipts/${created.data.id}`, fixture.tokens.warehouse,
        { action: 'confirm' }, { 'idempotency-key': `repeat-${created.data.id}` });
      assert.equal(repeated.status, 409);
      assert.equal(repeated.data.code, 'PURCHASE_RECEIPT_ALREADY_CONFIRMED');
      assert.equal(rejectAudits('PURCHASE_RECEIPT', created.data.id), rejectsBefore + 1);
    });

    test('D2 cancelling a draft purchase receipt releases its schedule reservation with a signed reversal effect', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const created = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        receiptDate: isoDate(0), billingMode: 'LEGACY_DIRECT',
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 3 }],
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const cancelled = await fixture.request('POST', `/api/purchase-receipts/${created.data.id}`, fixture.tokens.warehouse, { action: 'cancel' });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));

      const effects = fixture.db.prepare('SELECT * FROM schedule_consumption_effects WHERE business_event_id=? ORDER BY created_at,id').all(created.data.id);
      assert.equal(effects.length, 2);
      assert.equal(Number(effects[0].signed_quantity), 3);
      assert.equal(Number(effects[1].signed_quantity), -3);
      assert.equal(effects[1].reverses_effect_id, effects[0].id);
      assert.ok(effects[1].reverses_effect_key, 'the reversal carries its own key');
      assert.equal(effects[0].effect_state, 'EFFECTIVE', 'the original effect is never mutated');
      const net = fixture.db.prepare("SELECT COALESCE(SUM(signed_quantity),0) q FROM schedule_consumption_effects WHERE delivery_schedule_id=? AND effect_state='EFFECTIVE'").get(effects[0].delivery_schedule_id).q;
      assert.equal(Number(net), 0, 'the released reservation is not counted any more');
    });

    test('D3 the schedule capacity bounds the converted quantity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 4);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 5 }],
      });
      assert.equal(notice.status, 409, 'the schedule capacity bounds the allocation');
      assert.equal(notice.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
    });

    test('D4 the purchase order line remaining counts the notice allocation, so the direct path cannot steal a reserved quantity', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 8 }],
      });
      assert.equal(notice.status, 201, notice.data.error);

      const stolen = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        receiptDate: isoDate(0), billingMode: 'LEGACY_DIRECT',
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 5 }],
      });
      assert.equal(stolen.status, 409, 'the direct path respects the same purchase order line remaining');
      assert.equal(stolen.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');

      // Cancelling the notice releases its reservation again.
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/cancel`, fixture.tokens.admin)).status, 200);
      const released = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        receiptDate: isoDate(0), billingMode: 'LEGACY_DIRECT',
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 5 }],
      });
      assert.equal(released.status, 201, JSON.stringify(released.data));
    });

    test('D5 a receipt converted from a notice keeps its immutable source provenance', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 6 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = noticeSources(notice.data.id)[0];
      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 3 }], idempotencyKey: 'wp1-immutable',
      });
      assert.equal(converted.status, 201, JSON.stringify(converted.data));

      const patched = await fixture.request('PATCH', `/api/purchase-receipts/${converted.data.receipts[0].id}`, fixture.tokens.warehouse, {
        warehouseId: 'warehouse-001', receiptDate: isoDate(0),
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 9 }],
      });
      assert.equal(patched.status, 409, 'a converted receipt is not editable');
      const receiptItem = fixture.db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=?').get(converted.data.receipts[0].id);
      assert.equal(Number(receiptItem.quantity), 3);
      assert.equal(receiptItem.source_notice_item_source_id, source.id);
    });

    test('D6 the notice creation is idempotent under the same Idempotency-Key', async () => {
      const { orderId, itemIds } = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
      await createSchedule(orderId, itemIds[0], 10);
      const body = {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), idempotencyKey: 'wp1-notice-create',
        items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 2 }],
      };
      const first = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, body);
      assert.equal(first.status, 201, first.data.error);
      const replay = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, body);
      assert.equal(replay.status, 201);
      assert.equal(replay.data.id, first.data.id, 'a replay never creates a second notice');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM receipt_notices WHERE purchase_order_id=?').get(orderId).n, 1);

      const conflicting = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        ...body, items: [{ purchaseOrderItemId: itemIds[0], productId: 'product-001', quantity: 3 }],
      });
      assert.equal(conflicting.status, 409, 'the same idempotency key cannot carry a different request');
    });
  });
});
