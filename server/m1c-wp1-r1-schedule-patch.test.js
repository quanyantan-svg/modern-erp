// M1C-WP1-R1 focused regression suite.
//
// Contract source: M1-Core Active Design §5.1 / §5.2 / §6 / §9 and the
// approved Requirement MC-REQ-02 / MC-REQ-09 / MC-REQ-11
// (docs/requirements/procurement-outsourcing.md §31.13).
//
// The defect under repair: the WP-1 delivery schedule consumption ledger and
// the pre-existing direct purchase receipt draft PATCH path disagree. The
// PATCH path rebuilds the receipt lines through the canonical writer, which
// gives the lines NEW identities, but it neither reverses the positive
// schedule effect of the previous lines nor registers an effect for the new
// lines. The ledger therefore stops describing the draft.
//
// Every positive case drives the production HTTP API.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedPurchasePrice } from './test-support/procurement-http-fixture.js';

describe('M1C-WP1-R1 — delivery schedule ledger and purchase receipt draft PATCH consistency', () => {
  let fixture;
  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp1-r1-');
    await seedPurchasePrice(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', unitPriceCents: 1000 }]);
  });
  after(async () => { await fixture.close(); });

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function createApprovedOrder(quantity, unitPriceCents = 1000) {
    const order = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
      supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity, unitPriceCents }],
    });
    assert.equal(order.status, 201, order.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${order.data.id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${order.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    const item = fixture.db.prepare('SELECT id, product_id, quantity FROM purchase_order_items WHERE order_id=? ORDER BY line_no').get(order.data.id);
    return { orderId: order.data.id, itemId: item.id, productId: item.product_id };
  }

  async function createSchedule(orderId, orderItemId, plannedQuantity, { upperTolerancePct = 0 } = {}) {
    const result = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin, {
      orderItemId, plannedQuantity, plannedDate: isoDate(7), upperTolerancePct, lowerTolerancePct: 0,
    });
    assert.equal(result.status, 201, result.data.error);
    return result.data.id;
  }

  async function createDirectReceipt(order, quantity) {
    const created = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
      purchaseOrderId: order.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      receiptDate: isoDate(0), billingMode: 'LEGACY_DIRECT',
      items: [{ purchaseOrderItemId: order.itemId, productId: order.productId, quantity }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data;
  }

  async function patchReceipt(receiptId, order, quantity, extra = {}) {
    return fixture.request('PATCH', `/api/purchase-receipts/${receiptId}`, fixture.tokens.warehouse, {
      purchaseOrderId: order.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      receiptDate: isoDate(0),
      items: [{ purchaseOrderItemId: order.itemId, productId: order.productId, quantity }],
      ...extra,
    });
  }

  function effects(receiptId) {
    return fixture.db.prepare('SELECT * FROM schedule_consumption_effects WHERE business_event_id=? ORDER BY created_at,id').all(receiptId);
  }

  function netScheduleConsumption(scheduleId) {
    return Number(fixture.db.prepare(`SELECT COALESCE(SUM(signed_quantity),0) q FROM schedule_consumption_effects
      WHERE delivery_schedule_id=? AND effect_state='EFFECTIVE'`).get(scheduleId).q);
  }

  function draftItems(receiptId) {
    return fixture.db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  }

  function businessSnapshot() {
    const tables = [
      'purchase_receipts', 'purchase_receipt_items', 'schedule_consumption_effects',
      'logistics_quality_policy_snapshots', 'tracked_source_allocations',
      'inventory', 'inventory_transactions', 'inventory_valuation_movements', 'inventory_valuation_balances',
    ];
    const snapshot = {};
    for (const table of tables) snapshot[table] = JSON.stringify(fixture.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    return snapshot;
  }

  function rejectAudits(receiptId) {
    return Number(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='REJECT'").get(receiptId).n);
  }

  async function passQuality(receiptId, quantity) {
    const created = await fixture.request('POST', '/api/iqc', fixture.tokens.warehouse, { purchase_receipt_id: receiptId });
    assert.equal(created.status, 201, created.data.error);
    const completed = await fixture.request('POST', `/api/iqc/${created.data.id}/complete`, fixture.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
    assert.equal(completed.status, 200, completed.data.error);
  }

  // =========================================================================
  // A / B / C — the PATCH must rebind the schedule consumption atomically
  // =========================================================================
  describe('A-C PATCH rebinds the schedule consumption atomically', () => {
    test('A a PATCH that changes the quantity leaves the net schedule consumption equal to the new quantity', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 10);
      const receipt = await createDirectReceipt(order, 2);
      assert.equal(netScheduleConsumption(scheduleId), 2, 'the creation reserves the schedule');

      const patched = await patchReceipt(receipt.id, order, 5);
      assert.equal(patched.status, 200, JSON.stringify(patched.data));

      const items = draftItems(receipt.id);
      assert.equal(items.length, 1);
      assert.equal(Number(items[0].quantity), 5);
      assert.equal(items[0].delivery_schedule_id, scheduleId, 'the rebuilt line keeps its schedule binding');
      assert.equal(netScheduleConsumption(scheduleId), 5, 'the net schedule consumption follows the draft quantity');
      const rows = effects(receipt.id);
      const positive = rows.filter((row) => Number(row.signed_quantity) > 0);
      const negative = rows.filter((row) => Number(row.signed_quantity) < 0);
      assert.equal(positive.length, 2, 'the superseded positive effect is still on record');
      assert.equal(negative.length, 1, 'the superseded positive effect carries a reversal');
      assert.equal(negative[0].reverses_effect_id, positive[0].id);
      assert.equal(positive[0].effect_state, 'EFFECTIVE', 'the original effect is never mutated');
    });

    test('B cancelling after a PATCH releases every effect and leaves the net consumption at zero', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 10);
      const receipt = await createDirectReceipt(order, 2);
      assert.equal((await patchReceipt(receipt.id, order, 5)).status, 200);

      const cancelled = await fixture.request('POST', `/api/purchase-receipts/${receipt.id}`, fixture.tokens.warehouse, { action: 'cancel' });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));

      const rows = effects(receipt.id);
      const positive = rows.filter((row) => Number(row.signed_quantity) > 0);
      const negative = rows.filter((row) => Number(row.signed_quantity) < 0);
      assert.equal(positive.length, 2);
      assert.equal(negative.length, 2, 'every positive effect has exactly one reversal');
      for (const row of positive) {
        const reversal = negative.find((candidate) => candidate.reverses_effect_id === row.id);
        assert.ok(reversal, `positive effect ${row.id} must carry a reversal`);
        assert.equal(Number(reversal.signed_quantity), -Number(row.signed_quantity));
      }
      assert.equal(netScheduleConsumption(scheduleId), 0, 'the released reservation is not counted any more');
      const total = rows.reduce((sum, row) => sum + Number(row.signed_quantity), 0);
      assert.equal(total, 0, 'the signed ledger sums to zero');
    });

    test('C a PATCH that keeps the quantity still rebinds the lines and leaves no orphaned positive consumption', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 10);
      const receipt = await createDirectReceipt(order, 2);
      const before = draftItems(receipt.id)[0].id;

      const patched = await patchReceipt(receipt.id, order, 2);
      assert.equal(patched.status, 200, JSON.stringify(patched.data));
      const after = draftItems(receipt.id)[0];
      assert.notEqual(after.id, before, 'the canonical writer rebuilds the line identity');

      assert.equal(netScheduleConsumption(scheduleId), 2, 'the net consumption still matches the draft quantity');
      const liveItemIds = new Set(draftItems(receipt.id).map((item) => item.id));
      const rows = effects(receipt.id);
      const positive = rows.filter((row) => Number(row.signed_quantity) > 0);
      assert.equal(positive.length, 2);
      const orphans = positive.filter((row) => !liveItemIds.has(row.business_event_item_id));
      assert.equal(orphans.length, 1, 'only the superseded effect refers to a replaced line');
      for (const orphan of orphans) {
        const reversal = rows.find((row) => row.reverses_effect_id === orphan.id);
        assert.ok(reversal, 'an orphaned positive effect must be reversed');
      }
    });
  });

  // =========================================================================
  // D / E — both capacity bounds are re-checked against the aggregate state
  // =========================================================================
  describe('D-E PATCH re-checks the order line and the schedule capacity', () => {
    test('D a PATCH cannot use the stale ledger to exceed the schedule ceiling, and the refusal changes nothing', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 5);
      const other = await createDirectReceipt(order, 3);
      const receipt = await createDirectReceipt(order, 2);
      assert.equal(netScheduleConsumption(scheduleId), 5, 'the schedule is fully reserved');

      const before = businessSnapshot();
      const patched = await patchReceipt(receipt.id, order, 4);
      assert.equal(patched.status, 409, JSON.stringify(patched.data));
      assert.equal(patched.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      assert.equal(netScheduleConsumption(scheduleId), 5, 'the refused PATCH leaves the ledger untouched');
      assert.equal(Number(draftItems(receipt.id)[0].quantity), 2);
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay byte identical after a refused PATCH`);
      }
      assert.equal(rejectAudits(receipt.id), 1, 'exactly one rejection audit');
      assert.equal(rejectAudits(other.id), 0);

      // The unchanged draft stays consistent and still confirms.
      await passQuality(receipt.id, 2);
      const confirmed = await fixture.request('POST', `/api/purchase-receipts/${receipt.id}`, fixture.tokens.warehouse, { action: 'confirm' });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
      assert.equal(netScheduleConsumption(scheduleId), 5, 'the confirmed receipt keeps the reserved quantity');
    });

    test('E the PATCH capacity check counts the other notice sources and the other receipts', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 10);
      // A receipt notice reserves 6 of the order line and of the schedule.
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: order.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: order.itemId, productId: order.productId, quantity: 6 }],
      });
      assert.equal(notice.status, 201, notice.data.error);
      // Another direct receipt occupies 2 of the same schedule.
      const other = await createDirectReceipt(order, 2);
      assert.equal(netScheduleConsumption(scheduleId), 2);
      const receipt = await createDirectReceipt(order, 2);
      assert.equal(netScheduleConsumption(scheduleId), 4);

      // 6 (notice) + 2 (other receipt) + 3 (this receipt) = 11 > 10 schedule.
      const refused = await patchReceipt(receipt.id, order, 3);
      assert.equal(refused.status, 409, JSON.stringify(refused.data));
      assert.equal(refused.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      assert.equal(netScheduleConsumption(scheduleId), 4, 'the refused PATCH changes no consumption');

      // The order line bound counts the notice reservation as well: the order
      // line holds 10, the notice reserved 6, so 6 + 5 > 10 is refused even
      // though the schedule would still fit.
      const orderLineRefused = await patchReceipt(receipt.id, order, 5);
      assert.equal(orderLineRefused.status, 409, JSON.stringify(orderLineRefused.data));
      assert.equal(orderLineRefused.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');

      // 2 + 2 stays inside both bounds.
      const allowed = await patchReceipt(receipt.id, order, 2);
      assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
      assert.equal(netScheduleConsumption(scheduleId), 4);
      assert.equal(other.id !== receipt.id, true);
    });
  });

  // =========================================================================
  // F / G — the untouched paths stay legal and the refusal is auditable
  // =========================================================================
  describe('F-G untouched paths and rejection audit', () => {
    test('F a refused PATCH writes exactly one business rejection audit and no business side effect', async () => {
      const order = await createApprovedOrder(10);
      const scheduleId = await createSchedule(order.orderId, order.itemId, 3);
      const receipt = await createDirectReceipt(order, 2);
      const before = businessSnapshot();

      const refused = await patchReceipt(receipt.id, order, 9);
      assert.equal(refused.status, 409, JSON.stringify(refused.data));
      assert.equal(refused.data.code, 'RECEIPT_NOTICE_CAPACITY_EXCEEDED');
      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay byte identical after a refused PATCH`);
      }
      assert.equal(rejectAudits(receipt.id), 1, 'exactly one rejection audit');
      assert.equal(netScheduleConsumption(scheduleId), 2, 'the ledger is untouched');
    });

    test('G the direct purchase order path stays legal and a notice converted draft still refuses PATCH', async () => {
      const order = await createApprovedOrder(10);
      await createSchedule(order.orderId, order.itemId, 10);
      const receipt = await createDirectReceipt(order, 2);
      assert.equal((await patchReceipt(receipt.id, order, 3)).status, 200);
      await passQuality(receipt.id, 3);
      const confirmed = await fixture.request('POST', `/api/purchase-receipts/${receipt.id}`, fixture.tokens.warehouse, { action: 'confirm' });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
      const payable = fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n;
      assert.equal(payable, 1, 'the direct path still posts the payable');

      // A receipt converted from a receipt notice keeps its immutable provenance.
      const noticeOrder = await createApprovedOrder(10);
      await createSchedule(noticeOrder.orderId, noticeOrder.itemId, 10);
      const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
        purchaseOrderId: noticeOrder.orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        noticeDate: isoDate(0), items: [{ purchaseOrderItemId: noticeOrder.itemId, productId: noticeOrder.productId, quantity: 4 }],
      });
      assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
      const source = fixture.db.prepare('SELECT * FROM receipt_notice_item_sources WHERE notice_item_id IN (SELECT id FROM receipt_notice_items WHERE notice_id=?)').get(notice.data.id);
      const converted = await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fixture.tokens.admin, {
        items: [{ sourceId: source.id, quantity: 4 }], idempotencyKey: 'wp1-r1-g',
      });
      assert.equal(converted.status, 201, JSON.stringify(converted.data));
      const refused = await patchReceipt(converted.data.receipts[0].id, noticeOrder, 2);
      assert.equal(refused.status, 409, JSON.stringify(refused.data));
      assert.equal(Number(fixture.db.prepare('SELECT converted_quantity FROM receipt_notice_item_sources WHERE id=?').get(source.id).converted_quantity), 4);
    });
  });
});
