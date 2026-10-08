import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave E VMI business layer with owner-dimension fail-closed', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-wavee-'); });
  after(async () => fixture.close());

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
  }

  test('VMI agreement requires qualified outsource-enabled supplier', async () => {
    await qualifyOutsourceSupplier();
    const noQualified = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-002', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(0),
    });
    assert.equal(noQualified.status, 409, JSON.stringify(noQualified.data));
    const valid = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(0),
    });
    assert.equal(valid.status, 201, valid.data.error);
  });

  test('VMI receipt fails closed without Inventory owner dimension', async () => {
    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 50, receivedDate: isoDate(0),
    });
    assert.equal(receipt.status, 409, JSON.stringify(receipt.data));
    assert.match(receipt.data.error, /INVENTORY_OWNER_DIMENSION_UNAVAILABLE/);
  });

  test('VMI ownership transfer is idempotent and pending settlement summary', async () => {
    const now = new Date().toISOString();
    // Simulate a CONFIRMED VMI receipt directly bypassing inventory owner check (test fixture bypass).
    fixture.db.prepare(`INSERT INTO vmi_receipts(id,receipt_no,supplier_id,warehouse_id,product_id,quantity,received_date,business_status,handler_id,remark,creator_id,created_at,updated_at)
      VALUES('vmi-rcpt-1','VMI-RCPT-TEST-1','supplier-001','warehouse-001','product-001',100,?,'CONFIRMED','user-admin','bypass for test','user-admin',?,?)`).run(isoDate(0), now, now);
    const transfer = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: 'vmi-rcpt-1', settlementQuantity: 30, settlementAmountCents: 30000, transferDate: isoDate(0),
    });
    // Without Inventory owner dimension, this also fails closed.
    assert.equal(transfer.status, 409, JSON.stringify(transfer.data));
    assert.match(transfer.data.error, /INVENTORY_OWNER_DIMENSION_UNAVAILABLE/);
    // Summary endpoint should still surface aggregated read model.
    const summary = await fixture.request('GET', '/api/procurement/vmi/summary/supplier-001', fixture.tokens.admin);
    assert.equal(summary.status, 200, summary.data.error);
  });
});
