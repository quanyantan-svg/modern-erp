import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { SALES_WAVE2_TABLES } from './migrations/sales-customer-wave2-pricing.js';

let database; let server; let baseUrl; let tempDir; let baseUom;
const tokens = {};
async function request(path, { token = tokens.admin, method = 'GET', body, key } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function login(name, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username: name, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.token;
}
before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'sales-wave2-')); database = createDatabase(join(tempDir, 'erp.db'));
  baseUom = database.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const stamp = new Date().toISOString();
  database.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(baseUom, baseUom, stamp, stamp);
  server = createServer(createApp(database, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = await login('admin', 'admin123'); tokens.sales = await login('sales', 'sales123');
  tokens.reviewer = await login('reviewer', 'review123'); tokens.accounting = await login('accounting', 'accounting123'); tokens.warehouse = await login('warehouse', 'warehouse123');
});
after(async () => { await new Promise((done) => server.close(done)); database.close(); rmSync(tempDir, { recursive: true, force: true }); });

test('Wave 2 schema is exactly five tables, two nullable FKs, short UNIQUE and two identity triggers', () => {
  const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE2_TABLES.map(() => '?').join(',')}) ORDER BY name`).all(...SALES_WAVE2_TABLES).map((row) => row.name);
  assert.deepEqual(tables, [...SALES_WAVE2_TABLES].sort());
  const columns = database.prepare('PRAGMA table_info(customer_commercial_extensions)').all();
  for (const name of ['default_pricing_list_id','default_discount_scheme_id']) assert.equal(columns.find((column) => column.name === name)?.notnull, 0);
  const fks = database.prepare('PRAGMA foreign_key_list(customer_commercial_extensions)').all();
  assert.ok(fks.some((fk) => fk.from === 'default_pricing_list_id' && fk.table === 'sales_price_lists'));
  assert.ok(fks.some((fk) => fk.from === 'default_discount_scheme_id' && fk.table === 'sales_discount_schemes'));
  const indexes = database.prepare('PRAGMA index_list(sales_price_list_entries)').all();
  const business = indexes.find((index) => index.origin === 'u');
  assert.deepEqual(database.prepare(`PRAGMA index_info('${business.name}')`).all().map((row) => row.name), ['price_list_id','material_identity_key','customer_scope_key','pricing_identity_key']);
  const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_sales_price_entries_identity_b_' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(triggers, ['trg_sales_price_entries_identity_bi','trg_sales_price_entries_identity_bu']);
});

test('exact three-permission role matrix is enforced by backend', async () => {
  assert.equal((await request('/api/sales-price-lists', { token: tokens.sales })).status, 200);
  assert.equal((await request('/api/sales-price-lists', { token: tokens.reviewer })).status, 200);
  assert.equal((await request('/api/sales-price-lists', { token: tokens.accounting })).status, 200);
  assert.equal((await request('/api/sales-price-lists', { token: tokens.warehouse })).status, 403);
  const body = { priceListCode:'DENIED',name:'Denied',currencyCode:'CNY',priority:0,effectiveFrom:'2026-01-01' };
  assert.equal((await request('/api/sales-price-lists', { token: tokens.reviewer, method:'POST', body })).status, 403);
  assert.equal((await request('/api/sales-price-lists', { token: tokens.accounting, method:'POST', body })).status, 403);
});

let priceListId; let entryId; let pricingEvidence;
test('price list identity, versions, activation replay and pure resolver are authoritative', async () => {
  const created = await request('/api/sales-price-lists', { token: tokens.sales, method:'POST', body:{priceListCode:'PL-BASE',name:'标准价目表',currencyCode:'CNY',priority:1,effectiveFrom:'2026-01-01'} });
  assert.equal(created.status, 201, JSON.stringify(created.data)); priceListId = created.data.priceList.id;
  const entry = await request(`/api/sales-price-lists/${priceListId}/entries`, { token: tokens.sales, method:'POST', body:{materialId:'product-001',customerScopeType:'ALL',pricingUomCode:baseUom,qtyBreakMinMicros:0,qtyBreakMaxMicros:null,effectiveFrom:'2026-01-01',unitPriceCents:333} });
  assert.equal(entry.status, 201, JSON.stringify(entry.data)); entryId = entry.data.priceList.entries[0].id;
  const row = database.prepare('SELECT * FROM sales_price_list_entries WHERE id=?').get(entryId);
  assert.equal(row.material_identity_key, 'M:' + Buffer.from('product-001').toString('hex').toUpperCase()); assert.equal(row.customer_scope_key, 'A');
  assert.throws(() => database.prepare('UPDATE sales_price_list_entries SET material_identity_key=? WHERE id=?').run('M:BAD',entryId), /IDENTITY/);
  const overlap = await request(`/api/sales-price-lists/${priceListId}/entries`, { token: tokens.sales, method: 'POST', body: { materialId: 'product-001', customerScopeType: 'ALL', pricingUomCode: baseUom, qtyBreakMinMicros: 1, qtyBreakMaxMicros: 2_000_000, effectiveFrom: '2026-06-01', unitPriceCents: 999 } });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.data.code, 'PRICE_ENTRY_RANGE_OVERLAP');
  const version = await request(`/api/sales-price-lists/${priceListId}/entries/${entryId}/versions`, { token:tokens.sales,method:'POST',body:{unitPriceCents:350} });
  assert.equal(version.status,201,JSON.stringify(version.data)); assert.equal(version.data.priceList.versions.length,2);
  const activated = await request(`/api/sales-price-lists/${priceListId}/activate`, { token:tokens.sales,method:'POST',body:{},key:'pl-activate-1' });
  assert.equal(activated.status,200,JSON.stringify(activated.data));
  const replay = await request(`/api/sales-price-lists/${priceListId}/activate`, { token:tokens.sales,method:'POST',body:{},key:'pl-activate-1' });
  assert.equal(replay.status,200); assert.equal(replay.data.replayed,true);
  const auditBefore = database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n; const idemBefore = database.prepare('SELECT COUNT(*) n FROM idempotency_records').get().n;
  const resolved = await request('/api/sales-pricing/resolve', { token:tokens.sales,method:'POST',body:{customerId:'customer-001',materialId:'product-001',pricingUomCode:baseUom,quantityDecimal:'2.000000',businessDate:'2026-10-14',explicitPriceListIds:[priceListId]} });
  assert.equal(resolved.status,200,JSON.stringify(resolved.data)); pricingEvidence=resolved.data.pricing; assert.equal(pricingEvidence.resolvedPriceCents,350); assert.equal(pricingEvidence.normalizedPricingQuantityMicros,2_000_000);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,auditBefore); assert.equal(database.prepare('SELECT COUNT(*) n FROM idempotency_records').get().n,idemBefore);
  const salesOverride = await request('/api/sales-pricing/resolve',{token:tokens.sales,method:'POST',body:{customerId:'customer-001',materialId:'product-001',pricingUomCode:baseUom,quantityDecimal:'1',businessDate:'2026-10-14',explicitPriceListIds:[priceListId],manualPriceCents:1,overrideReason:'test'}}); assert.equal(salesOverride.status,403);
  const reviewerOverride = await request('/api/sales-pricing/resolve',{token:tokens.reviewer,method:'POST',body:{customerId:'customer-001',materialId:'product-001',pricingUomCode:baseUom,quantityDecimal:'1',businessDate:'2026-10-14',explicitPriceListIds:[priceListId],manualPriceCents:1,overrideReason:'approved preview'}}); assert.equal(reviewerOverride.status,200,JSON.stringify(reviewerOverride.data));
});

test('root precedence, customer specificity, fallback, duplicate and cycle handling are deterministic', async () => {
  const makeList = async (code, fallbackPriceListId = null) => {
    const result = await request('/api/sales-price-lists', { token: tokens.sales, method: 'POST', body: {
      priceListCode: code, name: code, currencyCode: 'CNY', priority: 0, fallbackPriceListId, effectiveFrom: '2026-01-01',
    } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.priceList.id;
  };
  const addEntry = async (listId, materialId, cents, customerId = null) => {
    const pricingUomCode = database.prepare('SELECT base_uom_code FROM products WHERE id=?').get(materialId).base_uom_code;
    const stamp = new Date().toISOString();
    database.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)')
      .run(pricingUomCode, pricingUomCode, stamp, stamp);
    const result = await request(`/api/sales-price-lists/${listId}/entries`, { token: tokens.sales, method: 'POST', body: {
      materialId, customerId, customerScopeType: customerId ? 'CUSTOMER' : 'ALL',
      pricingUomCode,
      qtyBreakMinMicros: 0, effectiveFrom: '2026-01-01', unitPriceCents: cents,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
  };
  const activate = async (listId, key) => {
    const result = await request(`/api/sales-price-lists/${listId}/activate`, { token: tokens.sales, method: 'POST', body: {}, key });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };

  const fallbackId = await makeList('PL-FALLBACK');
  await addEntry(fallbackId, 'product-001', 111);
  await activate(fallbackId, 'activate-fallback');
  const rootId = await makeList('PL-PRECEDENCE', fallbackId);
  await addEntry(rootId, 'product-001', 222);
  await addEntry(rootId, 'product-001', 333, 'customer-001');
  await activate(rootId, 'activate-precedence');
  const customerSpecific = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-001', materialId: 'product-001', pricingUomCode: baseUom,
    quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [rootId],
  } });
  assert.equal(customerSpecific.status, 200, JSON.stringify(customerSpecific.data));
  assert.equal(customerSpecific.data.pricing.resolvedPriceCents, 333);
  const listWide = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-002', materialId: 'product-001', pricingUomCode: baseUom,
    quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [rootId],
  } });
  assert.equal(listWide.status, 200, JSON.stringify(listWide.data));
  assert.equal(listWide.data.pricing.resolvedPriceCents, 222);

  const depthRootId = await makeList('PL-DEPTH', fallbackId);
  await addEntry(depthRootId, 'product-002', 999);
  await activate(depthRootId, 'activate-depth');
  const fallback = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-001', materialId: 'product-001', pricingUomCode: baseUom,
    quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [depthRootId],
  } });
  assert.equal(fallback.status, 200, JSON.stringify(fallback.data));
  assert.equal(fallback.data.pricing.resolvedPriceCents, 111);
  const duplicate = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-001', materialId: 'product-001', pricingUomCode: baseUom,
    quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [rootId, rootId],
  } });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.data.code, 'DUPLICATE_ROOT');

  database.prepare('UPDATE sales_price_lists SET fallback_price_list_id=? WHERE id=?').run(depthRootId, fallbackId);
  const productFiveUom = database.prepare("SELECT base_uom_code FROM products WHERE id='product-005'").get().base_uom_code;
  const stamp = new Date().toISOString();
  database.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)')
    .run(productFiveUom, productFiveUom, stamp, stamp);
  const cycle = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-001', materialId: 'product-005', pricingUomCode: productFiveUom,
    quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [depthRootId],
  } });
  assert.equal(cycle.status, 409);
  assert.equal(cycle.data.code, 'FALLBACK_CYCLE');
  database.prepare('UPDATE sales_price_lists SET fallback_price_list_id=NULL WHERE id=?').run(fallbackId);
});

test('Master rational UoM conversion is authoritative and unavailable conversions fail closed', async () => {
  const stamp = new Date().toISOString();
  for (const [code, active] of [['W2BOX', 1], ['W2MISS', 1], ['W2OFF', 0], ['W2OLD', 1], ['W2AMB', 1]]) {
    database.prepare('INSERT INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(code, code, active, stamp, stamp);
  }
  const conversions = [
    ['w2-box-v1', 'W2BOX', 3, 2, 1, 1, '2026-01-01', null],
    ['w2-old-v1', 'W2OLD', 2, 1, 1, 1, '2025-01-01', '2025-12-31'],
    ['w2-amb-v1', 'W2AMB', 2, 1, 1, 1, '2026-01-01', null],
    ['w2-amb-v2', 'W2AMB', 3, 1, 1, 2, '2026-02-01', null],
  ];
  for (const [conversionId, uomCode, numerator, denominator, active, version, from, to] of conversions) {
    database.prepare(`INSERT INTO product_uom_conversions
      (id,product_id,uom_code,base_uom_code,numerator,denominator,active,version,effective_from,effective_to,created_at)
      VALUES(?,'product-001',?,?,?,?,?,?,?,?,?)`)
      .run(conversionId, uomCode, baseUom, numerator, denominator, active, version, from, to, stamp);
  }
  const created = await request('/api/sales-price-lists', { token: tokens.sales, method: 'POST', body: {
    priceListCode: 'PL-UOM', name: 'UoM', currencyCode: 'CNY', priority: 0, effectiveFrom: '2026-01-01',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const listId = created.data.priceList.id;
  const entry = await request(`/api/sales-price-lists/${listId}/entries`, { token: tokens.sales, method: 'POST', body: {
    materialId: 'product-001', customerScopeType: 'ALL', pricingUomCode: 'W2BOX', qtyBreakMinMicros: 0,
    effectiveFrom: '2026-01-01', unitPriceCents: 150,
  } });
  assert.equal(entry.status, 201, JSON.stringify(entry.data));
  assert.equal((await request(`/api/sales-price-lists/${listId}/activate`, { token: tokens.sales, method: 'POST', body: {}, key: 'activate-uom-list' })).status, 200);
  const converted = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
    customerId: 'customer-001', materialId: 'product-001', pricingUomCode: baseUom,
    quantityDecimal: '3', businessDate: '2026-10-14', explicitPriceListIds: [listId],
  } });
  assert.equal(converted.status, 200, JSON.stringify(converted.data));
  assert.equal(converted.data.pricing.normalizedPricingQuantityMicros, 2_000_000);
  assert.deepEqual({
    numerator: converted.data.pricing.pricingUomEvidence.numerator,
    denominator: converted.data.pricing.pricingUomEvidence.denominator,
  }, { numerator: 3, denominator: 2 });

  for (const [uomCode, expectedCode] of [
    ['W2MISS', 'SALES_UOM_CONVERSION_UNAVAILABLE'],
    ['W2OFF', 'SALES_UOM_UNAVAILABLE'],
    ['W2OLD', 'SALES_UOM_CONVERSION_UNAVAILABLE'],
    ['W2AMB', 'SALES_UOM_CONVERSION_UNAVAILABLE'],
  ]) {
    const result = await request('/api/sales-pricing/resolve', { token: tokens.sales, method: 'POST', body: {
      customerId: 'customer-001', materialId: 'product-001', pricingUomCode: uomCode,
      quantityDecimal: '1', businessDate: '2026-10-14', explicitPriceListIds: [listId],
    } });
    assert.equal(result.status, 409, `${uomCode}: ${JSON.stringify(result.data)}`);
    assert.equal(result.data.code, expectedCode);
  }
});

let schemeId; let manualRuleId;
test('LINE/HEADER constraints, current rule version and deterministic discount allocation', async () => {
  const scheme=await request('/api/sales-discount-schemes',{token:tokens.sales,method:'POST',body:{schemeCode:'DS-BASE',name:'标准折扣',currencyCode:'CNY',priority:0,version:1,effectiveFrom:'2026-01-01'}});assert.equal(scheme.status,201,JSON.stringify(scheme.data));schemeId=scheme.data.scheme.id;
  const invalidHeader=await request(`/api/sales-discount-schemes/${schemeId}/rules`,{token:tokens.sales,method:'POST',body:{ruleKey:'BAD',lineScope:'HEADER',applicationMode:'AUTOMATIC',discountKind:'PERCENT',discountBps:1000,materialId:'product-001',customerScopeType:'ALL',qtyBreakMinMicros:0,effectiveFrom:'2026-01-01'}});assert.equal(invalidHeader.status,422);assert.equal(database.prepare("SELECT COUNT(*) n FROM sales_discount_scheme_rules WHERE rule_key='BAD'").get().n,0);
  const line=await request(`/api/sales-discount-schemes/${schemeId}/rules`,{token:tokens.sales,method:'POST',body:{ruleKey:'LINE10',lineScope:'LINE',applicationMode:'AUTOMATIC',discountKind:'PERCENT',discountBps:1000,materialId:'product-001',pricingUomCode:baseUom,customerScopeType:'ALL',qtyBreakMinMicros:0,effectiveFrom:'2026-01-01'}});assert.equal(line.status,201,JSON.stringify(line.data));
  const manualLine=await request(`/api/sales-discount-schemes/${schemeId}/rules`,{token:tokens.sales,method:'POST',body:{ruleKey:'MANUAL5',lineScope:'LINE',applicationMode:'MANUAL',discountKind:'PERCENT',discountBps:500,materialId:'product-001',pricingUomCode:baseUom,customerScopeType:'ALL',qtyBreakMinMicros:0,effectiveFrom:'2026-01-01'}});assert.equal(manualLine.status,201,JSON.stringify(manualLine.data));manualRuleId=manualLine.data.scheme.rules.find((rule)=>rule.rule_key==='MANUAL5').id;
  const header=await request(`/api/sales-discount-schemes/${schemeId}/rules`,{token:tokens.sales,method:'POST',body:{ruleKey:'HEAD10',lineScope:'HEADER',applicationMode:'AUTOMATIC',discountKind:'PERCENT',discountBps:1000,customerScopeType:'ALL',qtyBreakMinMicros:0,qtyBreakMaxMicros:null,effectiveFrom:'2026-01-01'}});assert.equal(header.status,201,JSON.stringify(header.data));
  const activated=await request(`/api/sales-discount-schemes/${schemeId}/activate`,{token:tokens.sales,method:'POST',body:{},key:'ds-activate-1'});assert.equal(activated.status,200,JSON.stringify(activated.data));
  const auditBefore=database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;const resolved=await request('/api/sales-discounts/resolve',{token:tokens.sales,method:'POST',body:{customerId:'customer-001',businessDate:'2026-10-14',explicitSchemeIds:[schemeId],lines:[{lineId:'L1',lineNo:1,materialId:'product-001',requestedUomCode:baseUom,quantityDecimal:'2',explicitPriceListIds:[priceListId],expectedPricingEvidence:pricingEvidence}],manualRuleSelections:[]}});assert.equal(resolved.status,200,JSON.stringify(resolved.data));assert.equal(resolved.data.discount.lineDiscountCentsByLine.L1,70);assert.equal(resolved.data.discount.headerDiscountCentsTotal,63);assert.equal(resolved.data.discount.totalDiscountCents,133);assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,auditBefore);
  const mismatch=structuredClone(pricingEvidence);mismatch.resolvedPriceCents=999;const rejected=await request('/api/sales-discounts/resolve',{token:tokens.sales,method:'POST',body:{customerId:'customer-001',businessDate:'2026-10-14',explicitSchemeIds:[schemeId],lines:[{lineId:'L1',lineNo:1,materialId:'product-001',requestedUomCode:baseUom,quantityDecimal:'2',explicitPriceListIds:[priceListId],expectedPricingEvidence:mismatch}],manualRuleSelections:[]}});assert.equal(rejected.status,409);
  const deniedManual=await request('/api/sales-discounts/resolve',{token:tokens.sales,method:'POST',body:{customerId:'customer-001',businessDate:'2026-10-14',explicitSchemeIds:[schemeId],lines:[{lineId:'M1',lineNo:1,materialId:'product-001',requestedUomCode:baseUom,quantityDecimal:'2',explicitPriceListIds:[priceListId]}],manualRuleSelections:[{lineId:'M1',ruleId:manualRuleId}],overrideReason:'sales cannot override'}});assert.equal(deniedManual.status,403);
  const missingReason=await request('/api/sales-discounts/resolve',{token:tokens.reviewer,method:'POST',body:{customerId:'customer-001',businessDate:'2026-10-14',explicitSchemeIds:[schemeId],lines:[{lineId:'M1',lineNo:1,materialId:'product-001',requestedUomCode:baseUom,quantityDecimal:'2',explicitPriceListIds:[priceListId]}],manualRuleSelections:[{lineId:'M1',ruleId:manualRuleId}]}});assert.equal(missingReason.status,422);
  const approvedManual=await request('/api/sales-discounts/resolve',{token:tokens.reviewer,method:'POST',body:{customerId:'customer-001',businessDate:'2026-10-14',explicitSchemeIds:[schemeId],lines:[{lineId:'M1',lineNo:1,materialId:'product-001',requestedUomCode:baseUom,quantityDecimal:'2',explicitPriceListIds:[priceListId]}],manualRuleSelections:[{lineId:'M1',ruleId:manualRuleId}],overrideReason:'review approved'}});assert.equal(approvedManual.status,200,JSON.stringify(approvedManual.data));assert.equal(approvedManual.data.discount.manualOverride.actorId,'user-reviewer');
});

test('commercial amount uses HALF_UP and rejects unsafe integer overflow', async () => {
  const halfUpResult = await request('/api/sales-discounts/resolve', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-14', explicitSchemeIds: [schemeId],
    lines: [{ lineId: 'ROUND', lineNo: 1, materialId: 'product-001', requestedUomCode: baseUom,
      quantityDecimal: '0.500000', explicitPriceListIds: [priceListId], manualPriceCents: 1 }],
    manualRuleSelections: [], overrideReason: 'half-up boundary',
  } });
  assert.equal(halfUpResult.status, 200, JSON.stringify(halfUpResult.data));
  assert.equal(halfUpResult.data.discount.finalLineCentsByLine.ROUND, 1);
  assert.equal(halfUpResult.data.discount.roundingEvidence.contract, 'HALF_UP_CENT_V1');

  const overflow = await request('/api/sales-discounts/resolve', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-14', explicitSchemeIds: [schemeId],
    lines: [{ lineId: 'OVERFLOW', lineNo: 1, materialId: 'product-001', requestedUomCode: baseUom,
      quantityDecimal: '9007199254.740991', explicitPriceListIds: [priceListId], manualPriceCents: Number.MAX_SAFE_INTEGER }],
    manualRuleSelections: [], overrideReason: 'overflow probe',
  } });
  assert.equal(overflow.status, 409);
  assert.equal(overflow.data.code, 'SAFE_INTEGER_REQUIRED');
});

test('unsafe draft deletion preserves immutable price versions and rolls back audit', async () => {
  const created = await request('/api/sales-price-lists', { token: tokens.sales, method: 'POST', body: { priceListCode: 'PL-HISTORY', name: '历史保留', currencyCode: 'CNY', priority: 0, effectiveFrom: '2026-01-01' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const listId = created.data.priceList.id;
  const added = await request(`/api/sales-price-lists/${listId}/entries`, { token: tokens.sales, method: 'POST', body: { materialId: 'product-001', customerScopeType: 'ALL', pricingUomCode: baseUom, qtyBreakMinMicros: 0, qtyBreakMaxMicros: null, effectiveFrom: '2026-01-01', unitPriceCents: 100 } });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  const draftEntryId = added.data.priceList.entries[0].id;
  const auditBefore = database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
  const deleteEntry = await request(`/api/sales-price-lists/${listId}/entries/${draftEntryId}`, { token: tokens.sales, method: 'DELETE' });
  assert.equal(deleteEntry.status, 409);
  assert.equal(deleteEntry.data.code, 'PRICE_HISTORY_PRESERVATION_REQUIRED');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM sales_price_list_versions WHERE entry_id=?').get(draftEntryId).n, 1);
  const deleteList = await request(`/api/sales-price-lists/${listId}`, { token: tokens.sales, method: 'DELETE' });
  assert.equal(deleteList.status, 409);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM sales_price_lists WHERE id=?').get(listId).n, 1);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, auditBefore);
});

test('identity guards reject lowercase forged keys and preserve the original row', () => {
  const source = database.prepare('SELECT * FROM sales_price_list_entries WHERE id=?').get(entryId);
  assert.throws(() => database.prepare(`INSERT INTO sales_price_list_entries(
    id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,qty_break_max_micros,effective_from,effective_to,created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'forged-entry', source.price_list_id, source.material_id, null, 'ALL', source.material_identity_key.toLowerCase(), 'A',
    source.pricing_uom_code, source.pricing_identity_key, 0, null, '2027-01-01', null, new Date().toISOString(), source.created_by,
  ), /IDENTITY/);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM sales_price_list_entries WHERE id='forged-entry'").get().n, 0);
});

test('denied configuration writes are audited while denied and successful resolvers stay zero-write', async () => {
  const auditBefore = database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
  const denied = await request('/api/sales-price-lists', { token: tokens.accounting, method: 'POST', body: { priceListCode: 'DENIED-AUDIT', name: 'Denied', currencyCode: 'CNY', priority: 0, effectiveFrom: '2026-01-01' } });
  assert.equal(denied.status, 403);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, auditBefore + 1);
  const deniedAudit = database.prepare("SELECT action,entity_type FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT 1").get();
  assert.equal(deniedAudit.action, 'AUTH_DENIED');
  assert.equal(deniedAudit.entity_type, 'SALES_PRICING');
  const afterDenied = database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
  const resolverDenied = await request('/api/sales-pricing/resolve', { token: tokens.warehouse, method: 'POST', body: {} });
  assert.equal(resolverDenied.status, 403);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, afterDenied);
});

test('disabled current rule version does not resurrect older discount history', async () => {
  const scheme = await request('/api/sales-discount-schemes', { token: tokens.sales, method: 'POST', body: { schemeCode: 'DS-DISABLED', name: '禁用版本', currencyCode: 'CNY', priority: 0, version: 1, effectiveFrom: '2026-01-01' } });
  assert.equal(scheme.status, 201, JSON.stringify(scheme.data));
  const id = scheme.data.scheme.id;
  const v1 = await request(`/api/sales-discount-schemes/${id}/rules`, { token: tokens.sales, method: 'POST', body: { ruleKey: 'CURRENT', lineScope: 'LINE', applicationMode: 'AUTOMATIC', discountKind: 'PERCENT', discountBps: 1000, materialId: 'product-001', pricingUomCode: baseUom, customerScopeType: 'ALL', qtyBreakMinMicros: 0, effectiveFrom: '2026-01-01' } });
  assert.equal(v1.status, 201, JSON.stringify(v1.data));
  const v2 = await request(`/api/sales-discount-schemes/${id}/rules/CURRENT/versions`, { token: tokens.sales, method: 'POST', body: { enabled: false, effectiveFrom: '2026-06-01' } });
  assert.equal(v2.status, 201, JSON.stringify(v2.data));
  assert.equal((await request(`/api/sales-discount-schemes/${id}/activate`, { token: tokens.sales, method: 'POST', body: {}, key: 'disabled-scheme-activate' })).status, 200);
  const resolved = await request('/api/sales-discounts/resolve', { token: tokens.sales, method: 'POST', body: { customerId: 'customer-001', businessDate: '2026-10-14', explicitSchemeIds: [id], lines: [{ lineId: 'D1', lineNo: 1, materialId: 'product-001', requestedUomCode: baseUom, quantityDecimal: '2', explicitPriceListIds: [priceListId] }], manualRuleSelections: [] } });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
  assert.equal(resolved.data.discount.totalDiscountCents, 0);
  assert.deepEqual(resolved.data.discount.appliedRuleEvidence, []);
});

test('pricing evidence assertion compares nested immutable UoM evidence, not selected scalar fields only', async () => {
  const forged = structuredClone(pricingEvidence);
  forged.requestedUomEvidence.id = 'forged-conversion';
  const result = await request('/api/sales-discounts/resolve', { token: tokens.sales, method: 'POST', body: { customerId: 'customer-001', businessDate: '2026-10-14', explicitSchemeIds: [schemeId], lines: [{ lineId: 'F1', lineNo: 1, materialId: 'product-001', requestedUomCode: baseUom, quantityDecimal: '2', explicitPriceListIds: [priceListId], expectedPricingEvidence: forged }], manualRuleSelections: [] } });
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'PRICING_EVIDENCE_MISMATCH');
});

test('lifecycle replay is exact, changed payload conflicts, and retirement is terminal', async () => {
  const auditBeforeConflict = database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
  const activationConflict = await request(`/api/sales-price-lists/${priceListId}/activate`, {
    token: tokens.sales, method: 'POST', body: { changed: true }, key: 'pl-activate-1',
  });
  assert.equal(activationConflict.status, 409);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, auditBeforeConflict);

  const retired = await request(`/api/sales-price-lists/${priceListId}/retire`, {
    token: tokens.sales, method: 'POST', body: {}, key: 'pl-retire-1',
  });
  assert.equal(retired.status, 200, JSON.stringify(retired.data));
  assert.equal(retired.data.status, 'RETIRED');
  const replay = await request(`/api/sales-price-lists/${priceListId}/retire`, {
    token: tokens.sales, method: 'POST', body: {}, key: 'pl-retire-1',
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  const changedReplay = await request(`/api/sales-price-lists/${priceListId}/retire`, {
    token: tokens.sales, method: 'POST', body: { changed: true }, key: 'pl-retire-1',
  });
  assert.equal(changedReplay.status, 409);
  const reactivate = await request(`/api/sales-price-lists/${priceListId}/activate`, {
    token: tokens.sales, method: 'POST', body: {}, key: 'pl-reactivate-after-retire',
  });
  assert.equal(reactivate.status, 409);
  assert.equal(database.prepare('SELECT status FROM sales_price_lists WHERE id=?').get(priceListId).status, 'RETIRED');
});
