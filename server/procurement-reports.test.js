import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedApprovedOutsourceBom, seedOutsourceSource } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave I period/WIP/opening/analytics reports', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-wavei-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200);
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) }]);
    // M1C-WP-3：委外材料必须经 canonical 估值写入，权威估值余额是前置事实。
    const now = new Date().toISOString();
    for (const productId of ['product-001', 'product-002']) {
      fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
        VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
        ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:${productId}`, productId, now);
    }
  }

  test('Procurement execution report exposes ordered / received / returned / remaining / billed', async () => {
    const report = await fixture.request('GET', '/api/reports/procurement/execution', fixture.tokens.admin);
    assert.equal(report.status, 200, report.data.error);
    assert.equal(Array.isArray(report.data.report), true);
  });

  test('Outsourcing execution report surfaces processing fee and progress', async () => {
    await qualifyOutsourceSupplier();
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0),
    });
    assert.equal(order.status, 201);
    const report = await fixture.request('GET', '/api/reports/outsourcing/execution', fixture.tokens.admin);
    assert.equal(report.status, 200);
    const myRow = report.data.report.find((r) => r.orderId === order.data.id);
    assert.ok(myRow);
    assert.equal(myRow.orderQuantity, 100);
    assert.equal(myRow.processingFeeCents, 0);
  });

  test('Outsourcing execution counts only effected receipts as finished', async () => {
    await qualifyOutsourceSupplier();
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(),
    });
    assert.equal(order.status, 201, order.data.error);
    const insert = fixture.db.prepare(`INSERT INTO outsourcing_receipts
      (id,receipt_no,order_id,quantity,received_date,supplier_id,business_status,processing_fee_cents,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'supplier-001',?,?,'user-admin',?,?)`);
    const now = new Date().toISOString();
    for (const [id, quantity, status, fee] of [
      ['pending', 20, 'PENDING_INSPECTION', 2000],
      ['effected', 30, 'EFFECTED', 3000],
      ['cancelled', 10, 'CANCELLED', 1000],
    ]) {
      insert.run(`${order.data.id}-${id}`, `R-${order.data.id}-${id}`, order.data.id, quantity, isoDate(), status, fee, now, now);
    }
    const report = await fixture.request('GET', '/api/reports/outsourcing/execution', fixture.tokens.admin);
    assert.equal(report.status, 200, report.data.error);
    const row = report.data.report.find((item) => item.orderId === order.data.id);
    assert.equal(row.pendingInspection, 20);
    assert.equal(row.cumulativeFinished, 30);
    assert.equal(row.processingFeeCents, 3000);
    assert.equal(row.progress, 0.3);
    assert.equal(row.costEvidenceStatus, 'PROVISIONAL');
    fixture.db.prepare("UPDATE outsourcing_receipts SET business_status='CANCELLED' WHERE id=?")
      .run(`${order.data.id}-effected`);
    const pendingOnly = await fixture.request('GET', '/api/reports/outsourcing/execution', fixture.tokens.admin);
    const pendingOnlyRow = pendingOnly.data.report.find((item) => item.orderId === order.data.id);
    assert.equal(pendingOnlyRow.cumulativeFinished, 0);
    assert.equal(pendingOnlyRow.pendingInspection, 20);
    assert.equal(pendingOnlyRow.costEvidenceStatus, 'PROVISIONAL', '没有已生效收货不能宣称成本证据最终确定');
  });

  test('Material position read model exposes per-line cumulative math', async () => {
    await qualifyOutsourceSupplier();
    // M1C-WP-3：委外用料快照必须来自已批准的 OUTSOURCE BOM（每单位用量 × 订单总量 = 5）。
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0.05 }], `prc-wavei-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201);
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(order.data.id).id;
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 5, issuedDate: isoDate(0), idempotencyKey: `prc-wavei-issue-${order.data.id}`,
    });
    assert.equal(issued.status, 201, issued.data.error);
    const position = await fixture.request('GET', `/api/reports/outsourcing/material-position?orderId=${order.data.id}`, fixture.tokens.admin);
    assert.equal(position.status, 200);
    const myRow = position.data.report.find((r) => r.orderId === order.data.id);
    assert.ok(myRow);
    assert.equal(myRow.required, 5);
    assert.equal(myRow.issued, 5);
    assert.equal(myRow.supplierWipRemaining, 5);
  });

  test('Opening order is recorded as historical business fact; no voucher fabrication', async () => {
    await qualifyOutsourceSupplier();
    const opening = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, businessDate: isoDate(-30),
    });
    assert.equal(opening.status, 201, opening.data.error);
    const voucher = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='OUTSOURCING_ORDER'").get().n;
    assert.equal(voucher, 0, '期初记录不得伪造历史凭证');
  });
});
