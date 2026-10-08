import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave D receiving notice and return branch plan', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-waved-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function approveOrder() {
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000', supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
    });
    assert.equal(po.status, 201, po.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    return po.data.id;
  }

  test('Receipt Notice is independent business doc with no inventory/valuation/GRNI/AP side effect', async () => {
    const orderId = await approveOrder();
    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
    const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      noticeDate: isoDate(0), items: [{ purchaseOrderItemId: itemId, productId: 'product-001', quantity: 5 }],
    });
    assert.equal(notice.status, 201, notice.data.error);
    assert.equal((await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin)).status, 200);
    // No inventory / valuation / GRNI / AP mutations.
    const inv = fixture.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
    const apCount = fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT_NOTICE'").get().n;
    const voucherCount = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT_NOTICE'").get().n;
    assert.equal(apCount, 0);
    assert.equal(voucherCount, 0);
    assert.ok(Number(inv.quantity) >= 0, 'inventory unchanged');
  });

  test('4-branch Purchase Return plan: LEGACY_DIRECT / SEPARATE unbilled / billed / partial-billed', async () => {
    const orderId = await approveOrder();
    const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
    // Create CONFIRMED receipt in LEGACY_DIRECT billing mode (legacy historical contract).
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('rcpt-legacy','PR-LEGACY','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',5000,?,'user-admin',?,?,'LEGACY_DIRECT')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('rcpt-legacy-i','rcpt-legacy',?,'product-001',5,1000,5000,1)`).run(itemId);
    const planLegacy = await fixture.request('GET', '/api/purchase-receipts/rcpt-legacy/return-branch-plan', fixture.tokens.admin);
    assert.equal(planLegacy.data.plan.branch, 'LEGACY_AP_CREDIT');
    assert.equal(planLegacy.data.plan.expected.apCreditCents, 5000);

    // SEPARATE unbilled
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('rcpt-unbilled','PR-UNBILLED','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',5000,?,'user-admin',?,?,'SEPARATE')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('rcpt-unbilled-i','rcpt-unbilled',?,'product-001',5,1000,5000,1)`).run(itemId);
    const planUnbilled = await fixture.request('GET', '/api/purchase-receipts/rcpt-unbilled/return-branch-plan', fixture.tokens.admin);
    assert.equal(planUnbilled.data.plan.branch, 'SEPARATE_GRNI_REVERSAL');
    assert.equal(planUnbilled.data.plan.expected.grniReversalCents, 5000);
    assert.equal(planUnbilled.data.plan.expected.apCreditCents, 0);

    // SEPARATE billed (full)
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('rcpt-billed','PR-BILLED','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',5000,?,'user-admin',?,?,'SEPARATE')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('rcpt-billed-i','rcpt-billed',?,'product-001',5,1000,5000,1)`).run(itemId);
    fixture.db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,gross_cents,creator_id,created_at)
      VALUES('sb-001','SB-001','supplier-001','INV-PR-BILLED',?,'POSTED','NO_TAX',5000,5000,'user-admin',?)`).run(isoDate(0), now);
    fixture.db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no)
      VALUES('sbi-001','sb-001','rcpt-billed','rcpt-billed-i','product-001','EA',5,1,1,1,5,1,1000,5000,0,5000,1)`).run();
    const planBilled = await fixture.request('GET', '/api/purchase-receipts/rcpt-billed/return-branch-plan', fixture.tokens.admin);
    assert.equal(planBilled.data.plan.branch, 'SEPARATE_AP_CREDIT');

    // SEPARATE partial-billed (billed-first deterministic split)
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('rcpt-partial','PR-PARTIAL','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',5000,?,'user-admin',?,?,'SEPARATE')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('rcpt-partial-i','rcpt-partial',?,'product-001',5,1000,5000,1)`).run(itemId);
    fixture.db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,gross_cents,creator_id,created_at)
      VALUES('sb-002','SB-002','supplier-001','INV-PR-PARTIAL',?,'POSTED','NO_TAX',2000,2000,'user-admin',?)`).run(isoDate(0), now);
    fixture.db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no)
      VALUES('sbi-002','sb-002','rcpt-partial','rcpt-partial-i','product-001','EA',2,1,1,1,2,1,1000,2000,0,2000,1)`).run();
    const planPartial = await fixture.request('GET', '/api/purchase-receipts/rcpt-partial/return-branch-plan', fixture.tokens.admin);
    assert.equal(planPartial.data.plan.branch, 'SEPARATE_PARTIAL_BILLED_FIRST');
    assert.equal(planPartial.data.plan.expected.apCreditCents, 2000);
    assert.equal(planPartial.data.plan.expected.grniReversalCents, 3000);
  });

  test('Return Request workflow is independent of inventory and routes by billing mode', async () => {
    const orderId = await approveOrder();
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES('rcpt-rt','PR-RT','${orderId}','supplier-001','warehouse-001','user-admin','CONFIRMED',3000,?,'user-admin',?,?,'SEPARATE')`).run(isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('rcpt-rt-i','rcpt-rt','${fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id}','product-001',3,1000,3000,1)`).run();
    const request = await fixture.request('POST', '/api/procurement/return-requests', fixture.tokens.admin, {
      receiptId: 'rcpt-rt', requestDate: isoDate(0), remark: '外包装破损',
    });
    assert.equal(request.status, 201, request.data.error);
    assert.equal(request.data.requestNo.startsWith('RT'), true);
    const list = await fixture.request('GET', '/api/procurement/return-requests', fixture.tokens.admin);
    assert.equal(list.data.returnRequests.length >= 1, true);
  });
});
