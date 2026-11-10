import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

// VMI-01..05 合同回归（Active Design §26.34.6 / Requirement §31.14.3）。
//
// 关键合同：
//   - VMI 协议是 VMI 业务事实本身：业务日期上必须**恰好一个**有效协议；
//   - VMI 资格基准是**采购侧**资质，不等同委外资质；
//   - 收货与消耗必须绑定协议并使用外部幂等键；
//   - 消耗容量必须同时满足「本收货剩余」与「canonical 供应商物权库存」两个不变量；
//   - 汇总只暴露未调整毛余额与对账差额，不暴露物权转移或结算口径。
describe('Procurement Wave E VMI business layer with owner-dimension canonical path', () => {
  let fixture;

  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-wavee-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function setProfile(supplierId, profile) {
    const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, {
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), qualificationStatus: 'QUALIFIED', ...profile,
    });
    assert.equal(result.status, 200, result.data.error);
  }

  function supplierOwnedTotal(supplierId = 'supplier-001') {
    return Number(fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id=? AND active=1`
    ).get(supplierId).total);
  }

  function enterpriseOwnedTotal() {
    return Number(fixture.db.prepare(
      `SELECT COALESCE(SUM(quantity),0) total FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='ENTERPRISE' AND active=1`
    ).get().total);
  }

  test('VMI-01 协议资格用采购侧基准，且同一绑定不得有重叠有效期', async () => {
    // 只有委外资质、没有采购资质的供应商不得建立 VMI 协议。
    await setProfile('supplier-002', { procurementEnabled: false, outsourcingEnabled: true, category: 'OUTSOURCE' });
    const outsourceOnly = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-002', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(0),
    });
    assert.equal(outsourceOnly.status, 409, JSON.stringify(outsourceOnly.data));
    assert.equal(outsourceOnly.data.code, 'VMI_SUPPLIER_NOT_QUALIFIED');

    // 未取得资质同样拒绝。
    await setProfile('supplier-003', { procurementEnabled: true, qualificationStatus: 'UNQUALIFIED' });
    const unqualified = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-003', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(0),
    });
    assert.equal(unqualified.status, 409, JSON.stringify(unqualified.data));

    // 只有采购资质、不需要委外资质即可建立 VMI 协议。
    await setProfile('supplier-001', { procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL' });
    const valid = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(0), effectiveTo: isoDate(30),
    });
    assert.equal(valid.status, 201, valid.data.error);

    const overlapping = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(10), effectiveTo: isoDate(40),
    });
    assert.equal(overlapping.status, 409, JSON.stringify(overlapping.data));
    assert.equal(overlapping.data.code, 'VMI_AGREEMENT_OVERLAP');

    const nonOverlapping = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(31), effectiveTo: isoDate(60),
    });
    assert.equal(nonOverlapping.status, 201, JSON.stringify(nonOverlapping.data));
  });

  test('VMI-02 收货必须绑定唯一有效协议并使用外部幂等键', async () => {
    const noKey = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 5, receivedDate: isoDate(0),
    });
    assert.equal(noKey.status, 400, JSON.stringify(noKey.data));
    assert.equal(noKey.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const noAgreement = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-002',
      quantity: 5, receivedDate: isoDate(0), idempotencyKey: 'vmi-no-agreement',
    });
    assert.equal(noAgreement.status, 409, JSON.stringify(noAgreement.data));
    assert.equal(noAgreement.data.code, 'VMI_AGREEMENT_NOT_FOUND');

    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 50, receivedDate: isoDate(0), idempotencyKey: 'vmi-receipt-1',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const bound = fixture.db.prepare('SELECT agreement_id FROM vmi_receipts WHERE id=?').get(receipt.data.id);
    assert.ok(bound.agreement_id, '收货必须写入可证明的协议绑定');

    const replay = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 50, receivedDate: isoDate(0), idempotencyKey: 'vmi-receipt-1',
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.data.id, receipt.data.id, '同键同载荷必须精确重放');
    assert.equal(replay.data.replayed, true);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_receipts WHERE idempotency_key=?').get('vmi-receipt-1').n, 1);

    const conflict = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: 49, receivedDate: isoDate(0), idempotencyKey: 'vmi-receipt-1',
    });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_receipts WHERE idempotency_key=?').get('vmi-receipt-1').n, 1);

    const enterpriseBefore = enterpriseOwnedTotal();
    const confirm = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    const supplierPos = fixture.db.prepare(
      `SELECT quantity, owner_type, owner_id, stock_status
         FROM inventory
        WHERE warehouse_id='warehouse-001' AND product_id='product-001'
          AND owner_type='SUPPLIER' AND owner_id='supplier-001' AND active=1`
    ).get();
    assert.ok(supplierPos, 'SUPPLIER-owned position must exist after VMI receipt confirm');
    assert.equal(Number(supplierPos.quantity), 50, 'supplier position quantity must equal received quantity');
    assert.equal(supplierPos.stock_status, 'AVAILABLE');
    assert.equal(enterpriseOwnedTotal(), enterpriseBefore, 'ENTERPRISE stock must not change on VMI receipt');
  });

  test('VMI-03 消耗必须幂等且不得超过本收货剩余容量', async () => {
    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-001' AND warehouse_id='warehouse-001' AND business_status='CONFIRMED' LIMIT 1`
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const noKey = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, quantity: 5, consumedDate: isoDate(0), destination: 'PRODUCTION',
    });
    assert.equal(noKey.status, 400, JSON.stringify(noKey.data));
    assert.equal(noKey.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const supplierBefore = supplierOwnedTotal();
    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, quantity: 20, consumedDate: isoDate(0), destination: 'PRODUCTION',
      idempotencyKey: 'vmi-consumption-1',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));
    assert.equal(supplierOwnedTotal(), supplierBefore - 20, 'supplier stock decreases by consumed quantity');

    const replay = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, quantity: 20, consumedDate: isoDate(0), destination: 'PRODUCTION',
      idempotencyKey: 'vmi-consumption-1',
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.data.replayed, true);
    assert.equal(supplierOwnedTotal(), supplierBefore - 20, '精确重放不得二次扣减');

    // 超出本收货剩余容量时拒绝，且业务事实零变化。
    const movementsBefore = fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n;
    const overdraw = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, quantity: 40, consumedDate: isoDate(0), destination: 'PRODUCTION',
      idempotencyKey: 'vmi-consumption-overdraw',
    });
    assert.equal(overdraw.status, 409, JSON.stringify(overdraw.data));
    assert.equal(overdraw.data.code, 'VMI_CONSUMPTION_CAPACITY_EXCEEDED');
    assert.equal(supplierOwnedTotal(), supplierBefore - 20, '被拒绝的消耗不得改变物权库存');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, movementsBefore, '被拒绝的消耗不得写库存流水');
  });

  test('VMI-04 汇总只暴露未调整毛余额与对账差额', async () => {
    const summary = await fixture.request('GET', '/api/procurement/vmi/summary/supplier-001', fixture.tokens.admin);
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    const row = summary.data.summary.find((item) => item.productId === 'product-001');
    assert.ok(row, '汇总必须给出该货品的行');
    assert.equal(row.received, 50);
    assert.equal(row.consumed, 20);
    assert.equal(row.grossRemaining, 30);
    assert.equal(row.canonicalSupplierOwnedQuantity, 30);
    assert.equal(row.reconciliationStatus, 'RECONCILED');
    assert.equal(row.pendingSettlement, undefined, '不得暴露未裁定的待结算口径');
    assert.equal(row.transferred, undefined, '不得暴露物权转移口径');
    assert.equal(row.settlementAmountCents, undefined, '不得暴露结算金额');
  });

  test('VMI-05 物权释放与结算在政策批准前一律拒绝且零副作用', async () => {
    const supplierBefore = supplierOwnedTotal();
    const enterpriseBefore = enterpriseOwnedTotal();
    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-001' AND warehouse_id='warehouse-001' AND business_status='CONFIRMED' LIMIT 1`
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const transfer = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 10, settlementAmountCents: 10000, transferDate: isoDate(0),
    });
    assert.equal(transfer.status, 409, JSON.stringify(transfer.data));
    assert.equal(transfer.data.code, 'VMI_SETTLEMENT_POLICY_PENDING');
    assert.equal(supplierOwnedTotal(), supplierBefore);
    assert.equal(enterpriseOwnedTotal(), enterpriseBefore);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_ownership_transfers WHERE vmi_receipt_id=?').get(receipt.id).n, 0);
  });
});
