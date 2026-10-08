import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave A parameters and receipt default', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-param-'); });
  after(async () => fixture.close());

  test('parameter singleton has approved defaults and authorization is fail closed', async () => {
    const admin = await fixture.request('GET', '/api/procurement/parameters', fixture.tokens.admin);
    assert.equal(admin.status, 200, admin.data.error);
    assert.deepEqual({
      sourceControlEnabled: admin.data.parameters.sourceControlEnabled,
      quotaEnabled: admin.data.parameters.quotaEnabled,
      defaultReceiptBillingMode: admin.data.parameters.defaultReceiptBillingMode,
      poChangeEnabled: admin.data.parameters.poChangeEnabled,
      receivingTolerancePolicy: admin.data.parameters.receivingTolerancePolicy,
    }, {
      sourceControlEnabled: true,
      quotaEnabled: false,
      defaultReceiptBillingMode: 'SEPARATE',
      poChangeEnabled: true,
      receivingTolerancePolicy: 'STRICT',
    });
    assert.equal((await fixture.request('GET', '/api/procurement/parameters', fixture.tokens.sales)).status, 403);
    assert.equal((await fixture.request('PATCH', '/api/procurement/parameters', fixture.tokens.sales, { quotaEnabled: true })).status, 403);
  });

  test('new purchase receipt defaults to SEPARATE while historical LEGACY_DIRECT stays unchanged', async () => {
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,billing_mode)
      VALUES('prc-legacy','PR-LEGACY-PRC','supplier-001','warehouse-001','user-admin',0,'DRAFT','2026-10-08','','user-admin',?,?,'LEGACY_DIRECT')`).run(now, now);
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000', supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 1000 }],
    });
    assert.equal(po.status, 201, po.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    const receipt = await fixture.request('POST', '/api/purchase-receipts', fixture.tokens.warehouse, {
      purchaseOrderId: po.data.id, supplierId: 'supplier-001', warehouseId: 'warehouse-001', receiptDate: '2026-10-09',
      items: [{ purchaseOrderItemId: fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(po.data.id).id, productId: 'product-001', quantity: 1, unitPriceCents: 1000 }],
    });
    assert.equal(receipt.status, 201, receipt.data.error);
    assert.equal(fixture.db.prepare('SELECT billing_mode mode FROM purchase_receipts WHERE id=?').get(receipt.data.id).mode, 'SEPARATE');
    assert.equal(fixture.db.prepare("SELECT billing_mode mode FROM purchase_receipts WHERE id='prc-legacy'").get().mode, 'LEGACY_DIRECT');
  });

  test('parameter update validates enums and records before/after audit without rewriting receipts', async () => {
    assert.equal((await fixture.request('PATCH', '/api/procurement/parameters', fixture.tokens.admin, { defaultReceiptBillingMode: 'INVALID' })).status, 400);
    const updated = await fixture.request('PATCH', '/api/procurement/parameters', fixture.tokens.admin, {
      quotaEnabled: true, requisitionPolicy: 'SOURCE_REQUIRED', defaultReceiptBillingMode: 'AUTO_BILL',
    });
    assert.equal(updated.status, 200, updated.data.error);
    assert.equal(updated.data.parameters.defaultReceiptBillingMode, 'AUTO_BILL');
    assert.equal(fixture.db.prepare("SELECT billing_mode mode FROM purchase_receipts WHERE id='prc-legacy'").get().mode, 'LEGACY_DIRECT');
    const audit = fixture.db.prepare("SELECT detail FROM audit_logs WHERE entity_type='PROCUREMENT_PARAMETER' ORDER BY created_at DESC LIMIT 1").get();
    assert.match(audit.detail, /before/);
    assert.match(audit.detail, /after/);
  });
});
