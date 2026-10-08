import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

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
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    assert.equal(result.status, 200);
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

  test('Material position read model exposes per-line cumulative math', async () => {
    await qualifyOutsourceSupplier();
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0),
    });
    assert.equal(order.status, 201);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
    });
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(order.data.id).id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 5, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: isoDate(0),
    });
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
