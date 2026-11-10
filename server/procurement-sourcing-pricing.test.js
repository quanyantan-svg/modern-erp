import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { allocateProportional, assertSupplierQualification } from './modules/procurement-sourcing.js';
import { resolvePurchaseLinePricing } from './modules/procurement-pricing.js';

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

  test('source effectivity and legal source query remain available', async () => {
    await qualifySupplier('supplier-002', isoDate(-365), isoDate(365));
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

    await qualifySupplier('supplier-002', isoDate(-180), isoDate(-30));
    assert.throws(() => assertSupplierQualification(fixture.db, 'supplier-002', 'PURCHASE', isoDate(0)),
      (error) => error.status === 409);
    const stillReadable = await fixture.request('GET', `/api/procurement/source-entries?productId=product-001&date=${isoDate(0)}`, fixture.tokens.admin);
    assert.equal(stillReadable.status, 200);
    assert.ok(stillReadable.data.sourceEntries.length >= 1);
  });

  test('supplier qualification follows source type and business date', async () => {
    const supplierId = 'supplier-003';
    const today = isoDate();
    const validFrom = isoDate(-60);
    const validTo = isoDate(60);
    const profile = async (procurementEnabled, outsourcingEnabled, from = validFrom, to = validTo) => {
      const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, {
        procurementEnabled, outsourcingEnabled, category: 'GENERAL',
        qualificationStatus: 'QUALIFIED', qualificationValidFrom: from, qualificationValidTo: to,
      });
      assert.equal(result.status, 200, result.data.error);
    };
    const denied = (type, date) => assert.throws(
      () => assertSupplierQualification(fixture.db, supplierId, type, date),
      (error) => error.status === 409,
    );

    await profile(false, true);
    denied('PURCHASE', today);
    assert.ok(assertSupplierQualification(fixture.db, supplierId, 'OUTSOURCE', today));
    const blockedSource = await fixture.request('POST', '/api/procurement/source-entries', fixture.tokens.admin, {
      supplierId, productId: 'product-003', sourceType: 'PURCHASE', effectiveFrom: today,
    });
    assert.equal(blockedSource.status, 409);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM source_list_entries WHERE supplier_id=? AND product_id=?').get(supplierId, 'product-003').n, 0);

    await profile(true, false);
    assert.ok(assertSupplierQualification(fixture.db, supplierId, 'PURCHASE', today));
    denied('OUTSOURCE', today);

    await profile(true, true, isoDate(10), isoDate(30));
    denied('PURCHASE', today);
    assert.ok(assertSupplierQualification(fixture.db, supplierId, 'PURCHASE', isoDate(15)));
    denied('PURCHASE', isoDate(31));

    await profile(true, true, isoDate(-60), isoDate(-10));
    assert.ok(assertSupplierQualification(fixture.db, supplierId, 'PURCHASE', isoDate(-20)), '历史业务日期按当日有效期判断');
    denied('PURCHASE', today);
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
    const listed = await fixture.request('GET', `/api/procurement/quotas?productId=product-002&sourceType=PURCHASE&date=${isoDate(0)}`, fixture.tokens.admin);
    assert.equal(listed.status, 200);
    assert.equal(listed.data.quotas.length, 3);
    const allocations = allocateProportional({ num: 100, den: 1 }, listed.data.quotas.map((quota) => ({ quota, proportion: quota.proportion })));
    assert.equal(allocations.reduce((acc, item) => acc + item.allocated.num / item.allocated.den, 0), 100);
  });

  test('closed decision write rejects ordinary user, admin, forged source and repeat without business effects', async () => {
    const body = {
      sourceType: 'PR', sourceId: 'PR-WAVE-B-001', procurementSourceType: 'PURCHASE',
      productId: 'product-001', businessDate: isoDate(0), quantity: 50,
    };
    const unauthorized = await fixture.request('POST', '/api/procurement/sourcing-decisions', fixture.tokens.sales, body);
    assert.equal(unauthorized.status, 403);
    fixture.db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-sales','PROCUREMENT_CONFIG_VIEW')").run();

    const tables = [
      'source_list_entries', 'source_list_versions', 'quota_assignments',
      'sourcing_decisions', 'sourcing_decision_allocations', 'purchase_requisitions',
      'purchase_orders', 'purchase_order_items', 'inventory', 'inventory_transactions',
      'inventory_valuation_movements', 'inventory_valuation_balances',
      'supplier_bills', 'account_payables', 'accounting_vouchers',
    ];
    const snapshot = () => Object.fromEntries(tables.map((name) => [name, fixture.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
    const before = snapshot();
    const auditCount = () => fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SOURCING_DECISION' AND action='REJECT' AND detail LIKE '%SOURCING_DECISION_WRITE_CLOSED%'").get().n;
    let rejected = auditCount();
    for (const [token, payload] of [
      [fixture.tokens.sales, body],
      [fixture.tokens.admin, body],
      [fixture.tokens.admin, { ...body, sourceId: 'FORGED-PR-NOT-FOUND' }],
      [fixture.tokens.admin, body],
    ]) {
      const response = await fixture.request('POST', '/api/procurement/sourcing-decisions', token, payload);
      assert.equal(response.status, 409, JSON.stringify(response.data));
      assert.equal(response.data.code, 'SOURCING_DECISION_WRITE_CLOSED');
      assert.deepEqual(snapshot(), before, '拒绝不得修改任何相关业务表字段');
      assert.equal(auditCount(), ++rejected, '每次业务拒绝恰好一条审计');
    }
    const sourceList = await fixture.request('GET', '/api/procurement/source-entries?productId=product-001', fixture.tokens.sales);
    assert.equal(sourceList.status, 200);
    const quotaList = await fixture.request('GET', '/api/procurement/quotas?productId=product-002', fixture.tokens.admin);
    assert.equal(quotaList.status, 200);
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
    const resolved = resolvePurchaseLinePricing(fixture.db, {
      supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
      documentUomCode: 'EA', documentQuantity: { num: 24, den: 1 },
      businessDate: isoDate(0), explicitPriceEntryId: entry.data.id,
    });
    assert.deepEqual(resolved.baseQuantity, { num: 24, den: 1 });
    assert.deepEqual(resolved.pricingQuantity, { num: 2, den: 1 });
    assert.equal(resolved.netCents, 2400);
    assert.equal(resolved.discountCents, 240);
    assert.equal(resolved.grossCents, 2160);
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
      items: [{ productId: 'product-001', quantity: 24, unitPriceCents: 1200, uomCode: 'EA' }],
    });
    assert.equal(po.status, 201, po.data.error);
    const pricedLine = fixture.db.prepare(`SELECT amount_cents,pricing_uom_code,pricing_quantity_num,pricing_quantity_den,
      price_entry_id,price_version,pricing_evidence_json FROM purchase_order_items WHERE order_id=?`).get(po.data.id);
    assert.equal(pricedLine.amount_cents, 2160);
    assert.equal(pricedLine.pricing_uom_code, 'BOX');
    assert.equal(pricedLine.pricing_quantity_num, 2);
    assert.equal(pricedLine.pricing_quantity_den, 1);
    assert.equal(pricedLine.price_entry_id, entry.data.id);
    assert.equal(JSON.parse(pricedLine.pricing_evidence_json).roundingContract, 'HALF_UP_CENT_V1');
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
