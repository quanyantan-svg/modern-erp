import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave A supplier profile', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-profile-'); });
  after(async () => fixture.close());

  test('admin can qualify supplier with effective commercial profile and history', async () => {
    const updated = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      procurementEnabled: true, outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: '2026-01-01', qualificationValidTo: '2027-12-31', defaultPaymentTermsDays: 45,
      defaultCurrency: 'CNY', supplierWipWarehouseId: 'warehouse-001', outsourcingQualificationNote: '通过委外审核',
    });
    assert.equal(updated.status, 200, updated.data.error);
    assert.equal(updated.data.profile.qualificationStatus, 'QUALIFIED');
    assert.equal(updated.data.profile.outsourcingEnabled, true);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM supplier_procurement_overrides WHERE supplier_id='supplier-001'").get().n, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SUPPLIER_PROCUREMENT_PROFILE' AND entity_id='supplier-001'").get().n, 1);
  });

  test('qualification validity is explicit and invalid intervals fail without mutation', async () => {
    const missing = await fixture.request('PATCH', '/api/suppliers/supplier-002/profile', fixture.tokens.admin, { qualificationStatus: 'QUALIFIED' });
    assert.equal(missing.status, 409);
    const inverted = await fixture.request('PATCH', '/api/suppliers/supplier-002/profile', fixture.tokens.admin, {
      qualificationStatus: 'QUALIFIED', qualificationValidFrom: '2027-12-31', qualificationValidTo: '2027-01-01',
    });
    assert.equal(inverted.status, 409);
    assert.equal(fixture.db.prepare("SELECT qualification_status status FROM suppliers WHERE id='supplier-002'").get().status, 'UNQUALIFIED');
  });

  test('non-config role cannot read or mutate supplier procurement profile', async () => {
    assert.equal((await fixture.request('GET', '/api/suppliers/supplier-001/profile', fixture.tokens.sales)).status, 403);
    assert.equal((await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.sales, { procurementEnabled: false })).status, 403);
  });
});
