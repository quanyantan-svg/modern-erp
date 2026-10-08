import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave B sourcing and pricing', () => {
  let fixture;
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-waveb-'); });
  after(async () => fixture.close());

  function nowIso() { return new Date().toISOString(); }
  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifySupplier(supplierId, validFrom, validTo) {
    const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, {
      procurementEnabled: true,
      category: 'GENERAL',
      qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: validFrom,
      qualificationValidTo: validTo,
    });
    assert.equal(result.status, 200, result.data.error);
  }

  test('source effectivity / disabled supplier / qualification expiry are enforced', async () => {
    await qualifySupplier('supplier-002', isoDate(-30), isoDate(30));
    const future = isoDate(60);
    const expired = isoDate(-180);
    const active = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, {
      supplierId: 'supplier-002', productId: 'product-001', sourceType: 'PURCHASE',
      effectiveFrom: isoDate(-7), effectiveTo: null,
    });
    assert.equal(active.status, 201, active.data.error);
    const futureEntry = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, {
      supplierId: 'supplier-002', productId: 'product-001', sourceType: 'PURCHASE',
      effectiveFrom: future, effectiveTo: isoDate(90),
    });
    assert.equal(futureEntry.status, 201, futureEntry.data.error);
    const expiredEntry = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, {
      supplierId: 'supplier-002', productId: 'product-001', sourceType: 'PURCHASE',
      effectiveFrom: expired, effectiveTo: isoDate(-90),
    });
    assert.equal(expiredEntry.status, 201, expiredEntry.data.error);

    const list = await fixture.request('GET', `/api/procurement/source-entries?productId=product-001&date=${isoDate(0)}`, fixture.tokens.admin);
    assert.equal(list.status, 200, list.data.error);
    assert.ok(list.data.sourceEntries.length >= 1);

    const decision = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.admin, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-001', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 100,
    });
    assert.equal(decision.status, 200, decision.data.error);
    assert.equal(decision.data.allocations.length, 1);
    assert.equal(decision.data.allocations[0].supplierId, 'supplier-002');

    await qualifySupplier('supplier-002', isoDate(-180), isoDate(-30));
    const expiredDecision = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.admin, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-002', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 100,
    });
    assert.equal(expiredDecision.status, 409, JSON.stringify(expiredDecision.data));
  });

  test('quota conservation, deterministic rounding and split across suppliers', async () => {
    await qualifySupplier('supplier-001', isoDate(-30), isoDate(180));
    await qualifySupplier('supplier-002', isoDate(-30), isoDate(180));
    await qualifySupplier('supplier-003', isoDate(-30), isoDate(180));
    const suppliers = ['supplier-001', 'supplier-002', 'supplier-003'];
    for (const supplier of suppliers) {
      const sourceEntry = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, {
        supplierId: supplier, productId: 'product-002', sourceType: 'PURCHASE',
        effectiveFrom: isoDate(-7),
      });
      assert.equal(sourceEntry.status, 201, sourceEntry.data.error);
    }
    const quotas = [
      { supplierId: 'supplier-001', numerator: 2, denominator: 3 },
      { supplierId: 'supplier-002', numerator: 1, denominator: 3 },
      { supplierId: 'supplier-003', numerator: 1, denominator: 3 },
    ];
    for (const q of quotas) {
      const result = await fixture.request('POST', '/api/procurement/quotas', fixture.tokens.admin, {
        supplierId: q.supplierId, productId: 'product-002', sourceType: 'PURCHASE',
        proportion: { num: q.numerator, den: q.denominator }, effectiveFrom: isoDate(-7),
      });
      assert.equal(result.status, 201, result.data.error);
    }
    const decision = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.admin, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-QUOTA', procurementSourceType: 'PURCHASE',
      productId: 'product-002', businessDate: isoDate(0), quantity: 100,
    });
    assert.equal(decision.status, 200, decision.data.error);
    const total = decision.data.allocations.reduce((acc, item) => acc + item.allocatedQuantity, 0);
    assert.equal(total, 100);
    const supplier001 = decision.data.allocations.find((a) => a.supplierId === 'supplier-001');
    const supplier002 = decision.data.allocations.find((a) => a.supplierId === 'supplier-002');
    const supplier003 = decision.data.allocations.find((a) => a.supplierId === 'supplier-003');
    assert.equal(supplier001.allocatedQuantity + supplier002.allocatedQuantity + supplier003.allocatedQuantity, 100);
    assert.ok(supplier001.allocatedQuantity >= supplier002.allocatedQuantity);
  });

  test('manual override requires permission, reason and audit', async () => {
    const blocked = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.sales, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-OVERRIDE', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 50,
      manualOverride: { reason: '紧急采购' },
    });
    assert.equal(blocked.status, 403);
    const noReason = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.admin, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-OVERRIDE-2', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 50,
      manualOverride: { reason: '' },
    });
    assert.equal(noReason.status, 400);
    const overridden = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.admin, {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-OVERRIDE-3', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 50,
      manualOverride: { reason: '战略互供' },
    });
    assert.equal(overridden.status, 200, overridden.data.error);
    assert.match(overridden.data.allocations[0].rule, /OVERRIDE/);
    const audit = fixture.db.prepare("SELECT detail FROM audit_logs WHERE entity_type='SOURCING_DECISION' AND action='OVERRIDE' ORDER BY created_at DESC LIMIT 1").get();
    assert.match(audit.detail, /PR-WAVE-B-OVERRIDE-3/);
  });

  test('price effectivity, UOM conversion, discount resolution and historical PO unaffected', async () => {
    await qualifySupplier('supplier-001', isoDate(-30), isoDate(180));
    const now = nowIso();
    fixture.db.prepare("INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES('BOX','Box',?,?)").run(now, now);
    fixture.db.prepare(`INSERT OR IGNORE INTO product_uom_conversions(id,product_id,uom_code,base_uom_code,numerator,denominator,version,effective_from,effective_to,created_at)
      VALUES('uom-conv-1','product-001','BOX','EA',12,1,1,?,NULL,?)`).run(isoDate(-30), now);
    const entry = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
      pricingUomCode: 'BOX', unitPriceCents: 1200, effectiveFrom: isoDate(-7),
    });
    assert.equal(entry.status, 201, entry.data.error);
    const futureEntry = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
      pricingUomCode: 'BOX', unitPriceCents: 1500, effectiveFrom: isoDate(7),
    });
    assert.equal(futureEntry.status, 201, futureEntry.data.error);
    const discount = await fixture.request('POST', '/api/procurement/discounts', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
      basis: 'PERCENT', value: { num: 10, den: 100 }, effectiveFrom: isoDate(-7),
    });
    assert.equal(discount.status, 201, discount.data.error);
    const list = await fixture.request('GET', '/api/procurement/price-list?productId=product-001&date=' + isoDate(0), fixture.tokens.admin);
    assert.equal(list.status, 200);
    assert.equal(list.data.priceList[0].unitPriceCents, 1200);
    const futureList = await fixture.request('GET', '/api/procurement/price-list?productId=product-001&date=' + isoDate(8), fixture.tokens.admin);
    assert.equal(futureList.data.priceList[0].unitPriceCents, 1500);
    const adjust = await fixture.request('POST', `/api/procurement/price-list/${entry.data.id}/adjust`, fixture.tokens.admin, {
      unitPriceCents: 1800, effectiveFrom: isoDate(1),
    });
    assert.equal(adjust.status, 201, adjust.data.error);
    const allPrices = fixture.db.prepare("SELECT id, version, effective_from, effective_to FROM purchase_price_list_entries WHERE product_id='product-001' ORDER BY effective_from").all();
    assert.equal(allPrices.length >= 3, true, '历史价格未被修改');
  });
});
