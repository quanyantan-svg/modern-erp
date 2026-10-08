import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave A buyers, purchasing groups and gift PO', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-buyers-'); });
  after(async () => fixture.close());

  test('buyer/group membership is permission guarded and auditable', async () => {
    assert.equal((await fixture.request('GET', '/api/buyers', fixture.tokens.sales)).status, 403);
    const buyer = await fixture.request('POST', '/api/buyers', fixture.tokens.admin, { code: 'BUYER-01', name: '采购员一', userId: 'user-sales' });
    const group = await fixture.request('POST', '/api/purchasing-groups', fixture.tokens.admin, { code: 'PG-01', name: '采购一组' });
    assert.equal(buyer.status, 201, buyer.data.error);
    assert.equal(group.status, 201, group.data.error);
    const member = await fixture.request('POST', `/api/purchasing-groups/${group.data.id}/members`, fixture.tokens.admin, { buyerId: buyer.data.id, role: 'LEAD' });
    assert.equal(member.status, 201, member.data.error);
    const groups = await fixture.request('GET', '/api/purchasing-groups', fixture.tokens.admin);
    assert.equal(groups.data.purchasingGroups[0].memberships[0].role, 'LEAD');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type IN ('BUYER','PURCHASING_GROUP','BUYER_MEMBERSHIP')").get().n, 3);
  });

  test('gift line with zero price submits, normal zero-price line remains blocked', async () => {
    const base = {
      supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000', supplierAddress: '测试地址', paymentTerms: '30 天',
    };
    const gift = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      ...base, items: [{ productId: 'product-001', quantity: 2, unitPriceCents: 0, isGiftLine: true }],
    });
    assert.equal(gift.status, 201, gift.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${gift.data.id}/submit`, fixture.tokens.admin)).status, 200);
    const giftLine = fixture.db.prepare('SELECT is_gift_line isGift,unit_price_cents price,amount_cents amount FROM purchase_order_items WHERE order_id=?').get(gift.data.id);
    assert.deepEqual({ ...giftLine }, { isGift: 1, price: 0, amount: 0 });

    const normal = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      ...base, items: [{ productId: 'product-001', quantity: 2, unitPriceCents: 0 }],
    });
    assert.equal(normal.status, 201, normal.data.error);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${normal.data.id}/submit`, fixture.tokens.admin)).status, 400);
  });

  test('gift flag cannot mask a non-zero commercial price', async () => {
    const response = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 1, isGiftLine: true }],
    });
    assert.equal(response.status, 400);
  });
});
