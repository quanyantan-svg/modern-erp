import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave E VMI business layer with owner-dimension canonical path', () => {
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

  // V21 — positive canonical assertions: VMI receipt creates a SUPPLIER-owned
  // position distinct from ENTERPRISE stock; consumption reduces supplier
  // stock; ownership transfer moves quantity from SUPPLIER to ENTERPRISE
  // without duplicating evidence. The legacy fail-closed helper
  // assertInventoryOwnerDimension was removed because the owner dimension is
  // now available (V21 Wave A migration).
  test('VMI receipt creates a SUPPLIER-owned position separated from ENTERPRISE stock', async () => {
    const beforeRows = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001' AND active=1`
    ).get();
    const beforeTotal = Number(beforeRows.total);

    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 50, receivedDate: isoDate(0),
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const receiptId = receipt.data.id;

    const confirm = await fixture.request('POST', `/api/procurement/vmi/receipts/${receiptId}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));

    // The supplier-owned position must exist with the received quantity.
    const supplierPos = fixture.db.prepare(
      `SELECT quantity, owner_type, owner_id, stock_status, position_key
         FROM inventory
        WHERE warehouse_id='warehouse-001'
          AND product_id='product-001'
          AND owner_type='SUPPLIER'
          AND owner_id='supplier-001'
          AND active=1`
    ).get();
    assert.ok(supplierPos, 'SUPPLIER-owned position must exist after VMI receipt confirm');
    assert.equal(Number(supplierPos.quantity), 50, 'supplier position quantity must equal received quantity');
    assert.equal(supplierPos.stock_status, 'AVAILABLE');

    // The ENTERPRISE-owned position must remain unchanged.
    const enterprisePos = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    assert.equal(Number(enterprisePos.total), beforeTotal, 'ENTERPRISE stock must not change on VMI receipt');

    // Total physical stock = sum across all owners.
    const totalPos = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001' AND active=1`
    ).get();
    assert.equal(Number(totalPos.total), beforeTotal + 50, 'total stock must reflect the VMI receipt addition');
  });

  test('VMI consumption reduces SUPPLIER stock and never touches ENTERPRISE stock', async () => {
    const supplierBefore = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    const enterpriseBefore = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    assert.equal(Number(supplierBefore.total), 50, 'precondition: supplier stock from prior test');

    // Find the supplier-owned receipt.
    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-001' AND warehouse_id='warehouse-001' AND business_status='CONFIRMED' LIMIT 1`
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, quantity: 20, consumedDate: isoDate(0), destination: 'PRODUCTION',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));

    const supplierAfter = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    const enterpriseAfter = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    assert.equal(Number(supplierAfter.total), Number(supplierBefore.total) - 20, 'supplier stock decreases by consumed quantity');
    assert.equal(Number(enterpriseAfter.total), Number(enterpriseBefore.total), 'ENTERPRISE stock is invariant under supplier consumption');
  });

  test('VMI ownership transfer conserves quantity, moves it to ENTERPRISE, and is idempotent on second attempt', async () => {
    const supplierBefore = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    const enterpriseBefore = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    const totalBefore = supplierBefore.total + enterpriseBefore.total;

    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-001' AND warehouse_id='warehouse-001' AND business_status='CONFIRMED' LIMIT 1`
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const transfer = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 10, settlementAmountCents: 10000, transferDate: isoDate(0),
    });
    assert.equal(transfer.status, 201, JSON.stringify(transfer.data));
    const transferId = transfer.data.id;

    const supplierAfter = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    const enterpriseAfter = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    const totalAfter = Number(supplierAfter.total) + Number(enterpriseAfter.total);

    // Ownership change is a paired MOVE: SUPPLIER decreases by 10,
    // ENTERPRISE increases by 10. Total stock is conserved.
    assert.equal(Number(supplierAfter.total), Number(supplierBefore.total) - 10, 'supplier stock decreases by transfer quantity');
    assert.equal(Number(enterpriseAfter.total), Number(enterpriseBefore.total) + 10, 'enterprise stock increases by transfer quantity');
    assert.equal(totalAfter, totalBefore, 'total stock conserved across ownership transfer');

    // Exactly one ownership transfer row exists for this receipt.
    const transferRows = fixture.db.prepare(
      `SELECT COUNT(*) n FROM vmi_ownership_transfers WHERE vmi_receipt_id=? AND business_status<>'CANCELLED'`
    ).get(receipt.id);
    assert.equal(Number(transferRows.n), 1, 'exactly one ownership transfer is recorded');

    // A second attempt with the same receipt is rejected (idempotency /
    // "no double ownership change").
    const duplicate = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 5, settlementAmountCents: 5000, transferDate: isoDate(0),
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));

    // The total is still conserved (no duplicate evidence, no extra write).
    const supplierFinal = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    const enterpriseFinal = fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get();
    assert.equal(Number(supplierFinal.total), Number(supplierAfter.total), 'no extra supplier mutation on rejected duplicate');
    assert.equal(Number(enterpriseFinal.total), Number(enterpriseAfter.total), 'no extra enterprise mutation on rejected duplicate');

    // Summary endpoint still surfaces the aggregated read model.
    const summary = await fixture.request('GET', '/api/procurement/vmi/summary/supplier-001', fixture.tokens.admin);
    assert.equal(summary.status, 200, summary.data.error);
  });
});
