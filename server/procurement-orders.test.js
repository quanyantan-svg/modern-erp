import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave C PR/PO governance and execution view', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-wavec-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function createApprovedOrder(extraItems = []) {
    const base = {
      supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000', supplierAddress: '测试地址', paymentTerms: '30 天',
    };
    const items = extraItems.length ? extraItems : [{ productId: 'product-001', quantity: 5, unitPriceCents: 1000 }];
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, { ...base, items });
    assert.equal(po.status, 201, po.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    return po.data.id;
  }

  test('PO business_type defaults to STANDARD_PURCHASE and legacy rows unchanged', async () => {
    const orderId = await createApprovedOrder();
    const row = fixture.db.prepare('SELECT business_type FROM purchase_orders WHERE id=?').get(orderId);
    assert.equal(row.business_type, 'STANDARD_PURCHASE');
    // Insert a legacy OUTSOURCE_PROCESSING entry directly to ensure that
    // listOpenRemainingBySupplierProduct excludes it.
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date,business_type)
      VALUES('legacy-ot','PO-LEGACY-OT','supplier-001','APPROVED',0,'legacy','user-admin',?,?,?,?,'OUTSOURCE_PROCESSING')`).run(now, now, isoDate(-1), isoDate(1));
    fixture.db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('legacy-ot-i','legacy-ot','product-001',10,500,5000,1)`).run();
    const execution = await fixture.request('GET', '/api/purchase-orders/legacy-ot/execution', fixture.tokens.admin);
    assert.equal(execution.status, 200, execution.data.error);
    assert.equal(execution.data.execution.businessType, 'OUTSOURCE_PROCESSING');
    assert.equal(execution.data.execution.aggregate.remaining, 10);
  });

  test('delivery schedule and canonical PO execution view are consistent', async () => {
    const orderId = await createApprovedOrder([{ productId: 'product-002', quantity: 20, unitPriceCents: 500 }]);
    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
    const schedule = await fixture.request('POST', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin, {
      orderItemId: itemId, plannedQuantity: 10, plannedDate: isoDate(7), upperTolerancePct: 5, lowerTolerancePct: 0,
    });
    assert.equal(schedule.status, 201, schedule.data.error);
    const list = await fixture.request('GET', `/api/purchase-orders/${orderId}/delivery-schedules`, fixture.tokens.admin);
    assert.equal(list.data.schedules.length, 1);
    const execution = await fixture.request('GET', `/api/purchase-orders/${orderId}/execution`, fixture.tokens.admin);
    assert.equal(execution.data.execution.aggregate.ordered, 20);
    assert.equal(execution.data.execution.aggregate.remaining, 20);
    assert.equal(execution.data.execution.items.length, 1);
  });

  test('PO Change ADD / MODIFY / CANCEL lifecycle guards executed quantity', async () => {
    const orderId = await createApprovedOrder([{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }]);
    const add = await fixture.request('POST', '/api/procurement/purchase-order-changes', fixture.tokens.admin, {
      orderId, action: 'ADD', payload: { productId: 'product-002', quantity: 3, unitPriceCents: 600, lineNo: 2 },
    });
    assert.equal(add.status, 201, add.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/purchase-order-changes/${add.data.id}/approve`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/purchase-order-changes/${add.data.id}/apply`, fixture.tokens.admin)).status, 200);
    const items = fixture.db.prepare('SELECT COUNT(*) n FROM purchase_order_items WHERE order_id=?').get(orderId).n;
    assert.equal(items, 2);

    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? AND product_id=?').get(orderId, 'product-001').id;
    // Insert a CONFIRMED receipt row directly to simulate executed quantity.
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('receipt-prc-wavec','PR-PO-CHG','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',0,?,'user-admin',?,?,'SEPARATE')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('receipt-item-prc','receipt-prc-wavec',?,'product-001',5,1000,5000,1)`).run(itemId);

    const belowExec = await fixture.request('POST', '/api/procurement/purchase-order-changes', fixture.tokens.admin, {
      orderId, action: 'MODIFY', payload: { orderItemId: itemId, quantity: 3, unitPriceCents: 1000 },
    });
    assert.equal(belowExec.status, 201, belowExec.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/purchase-order-changes/${belowExec.data.id}/approve`, fixture.tokens.admin)).status, 200);
    const belowApply = await fixture.request('POST', `/api/procurement/purchase-order-changes/${belowExec.data.id}/apply`, fixture.tokens.admin);
    assert.equal(belowApply.status, 409, JSON.stringify(belowApply.data));
  });

  test('canonical PO execution view excludes OUTSOURCE_PROCESSING from BUY supply', async () => {
    const orderId = await createApprovedOrder([{ productId: 'product-003', quantity: 8, unitPriceCents: 800 }]);
    // Insert OUTSOURCE_PROCESSING item that should NOT appear in execution.aggregate.remaining for BUY queries.
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date,business_type)
      VALUES('ot-buy-test','PO-OT-BUY','supplier-001','APPROVED',0,'ot','user-admin',?,?,?,?,'OUTSOURCE_PROCESSING')`).run(now, now, isoDate(-1), isoDate(1));
    fixture.db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('ot-buy-item','ot-buy-test','product-003',5,800,4000,1)`).run();
    // Verify listOpenRemainingBySupplierProduct is standard-only.
    const remaining = fixture.db.prepare(`SELECT COUNT(*) n FROM purchase_order_items WHERE order_id=? AND product_id='product-003'`).get(orderId).n;
    assert.equal(remaining, 1);
  });
});
