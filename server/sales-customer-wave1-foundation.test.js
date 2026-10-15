import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { SALES_WAVE1_TABLES } from './migrations/sales-customer-wave1-foundation.js';
import { SALES_WAVE2_TABLES } from './migrations/sales-customer-wave2-pricing.js';
import { assertSellableProduct, resolveCustomerMaterialXref } from './modules/sales-commercial-foundation.js';
import { resolveSalesParameters } from './modules/sales-parameters.js';

let baseUrl; let database; let server; let tempDir;
let adminToken; let salesToken; let reviewerToken; let accountingToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'sales-wave1-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  reviewerToken = await login('reviewer', 'review123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  database.close(); rmSync(tempDir, { recursive: true, force: true });
});

describe('Sales & Customer Wave 1 — Commercial Foundation', () => {
  test('preserves exactly eight Wave 1 tables alongside the bounded Wave 2 schema', () => {
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sales_parameters','sales_groups','salesperson_profiles','salesperson_group_memberships','customer_commercial_extensions','customer_material_xref','sales_sellable_scope_rules','product_commercial_classification') ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(names, [...SALES_WAVE1_TABLES].sort());
    for (const [table, forbidden] of Object.entries({
      products: ['sales_enabled', 'service_classification'],
      users: ['salesperson_code', 'sales_group_code'],
    })) {
      const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
      for (const column of forbidden) assert.equal(columns.has(column), false, `${table}.${column} must remain absent`);
    }
    const wave2 = database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE2_TABLES.map(() => '?').join(',')}) ORDER BY name`).all(...SALES_WAVE2_TABLES).map((row) => row.name);
    assert.deepEqual(wave2, [...SALES_WAVE2_TABLES].sort());
    const extensionColumns = new Set(database.prepare('PRAGMA table_info(customer_commercial_extensions)').all().map((row) => row.name));
    assert.equal(extensionColumns.has('default_pricing_list_id'), true);
    assert.equal(extensionColumns.has('default_discount_scheme_id'), true);
  });

  test('parameter resolver is fail-closed and applies DOCUMENT_TYPE over SYSTEM', async () => {
    assert.throws(() => resolveSalesParameters(database, 'SALES_ORDER'), /参数缺失/);
    const system = await request('/api/sales/parameters', { method: 'PUT', body: {
      scopeType: 'SYSTEM', sellableControlEnabled: false, customerMaterialXrefEnabled: true,
      salesGroupDataScopeEnabled: false, deliveryScheduleEnabled: false, deliveryQuantityControlEnabled: false,
      orderChangeMode: 'DISABLED', reservationBehavior: 'DISABLED', active: true,
    } });
    assert.equal(system.status, 200, JSON.stringify(system.data));
    assert.equal(resolveSalesParameters(database, 'SALES_ORDER').customerMaterialXrefEnabled, true);
    const exact = await request('/api/sales/parameters', { method: 'PUT', body: {
      scopeType: 'DOCUMENT_TYPE', documentType: 'SALES_ORDER', sellableControlEnabled: true,
      customerMaterialXrefEnabled: true, salesGroupDataScopeEnabled: true, deliveryScheduleEnabled: true,
      deliveryQuantityControlEnabled: true, orderChangeMode: 'CONTROLLED_DOCUMENT', reservationBehavior: 'MANUAL_RESERVATION', active: true,
    } });
    assert.equal(exact.status, 200, JSON.stringify(exact.data));
    assert.equal(resolveSalesParameters(database, 'SALES_ORDER').orderChangeMode, 'CONTROLLED_DOCUMENT');
    assert.throws(() => resolveSalesParameters(database, 'UNREGISTERED'), /未注册/);
  });

  test('backend permissions separate parameter administration from commercial maintenance', async () => {
    const parameterDenied = await request('/api/sales/parameters', { token: salesToken, method: 'PUT', body: {} });
    assert.equal(parameterDenied.status, 403);
    const accountingDenied = await request('/api/customer-commercial-extensions', { token: accountingToken, method: 'POST', body: {} });
    assert.equal(accountingDenied.status, 403);
    const reviewerDenied = await request('/api/sales/groups', { token: reviewerToken, method: 'POST', body: { groupCode: 'NO', name: 'No' } });
    assert.equal(reviewerDenied.status, 403);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM sales_groups WHERE group_code='NO'").get().n, 0);
  });

  test('salesperson can exist without login and membership enforces exactly one effective default', async () => {
    const groupA = await request('/api/sales/groups', { token: salesToken, method: 'POST', body: { groupCode: 'EAST', name: '华东销售组' } });
    const groupB = await request('/api/sales/groups', { token: salesToken, method: 'POST', body: { groupCode: 'WEST', name: '华西销售组' } });
    const person = await request('/api/sales/salespersons', { token: salesToken, method: 'POST', body: { salespersonCode: 'SP-001', name: '销售员甲' } });
    assert.equal(person.status, 201); assert.equal(person.data.salesperson.userId, null);
    const invalid = await request('/api/sales/memberships', { token: salesToken, method: 'POST', body: { salespersonId: person.data.salesperson.id, salesGroupId: groupA.data.salesGroup.id, effectiveFrom: '2026-01-01', isDefault: false } });
    assert.equal(invalid.status, 409);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM salesperson_group_memberships WHERE salesperson_id=?').get(person.data.salesperson.id).n, 0, 'failed membership must roll back');
    const first = await request('/api/sales/memberships', { token: salesToken, method: 'POST', body: { salespersonId: person.data.salesperson.id, salesGroupId: groupA.data.salesGroup.id, effectiveFrom: '2026-01-01', isDefault: true } });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const second = await request('/api/sales/memberships', { token: salesToken, method: 'POST', body: { salespersonId: person.data.salesperson.id, salesGroupId: groupB.data.salesGroup.id, effectiveFrom: '2026-01-01', isDefault: false } });
    assert.equal(second.status, 201, JSON.stringify(second.data));
  });

  test('customer commercial intervals reject overlap and controlled supersession closes the prior version atomically', async () => {
    const initial = await request('/api/customer-commercial-extensions', { token: salesToken, method: 'POST', body: {
      customerId: 'customer-001', effectiveFrom: '2026-01-01', settlementPartyCustomerId: 'customer-001', payerCustomerId: 'customer-001',
      defaultPaymentTermsDays: 30, sellableScopeMode: 'ALL_SALES_ENABLED',
    } });
    assert.equal(initial.status, 201, JSON.stringify(initial.data));
    const overlap = await request('/api/customer-commercial-extensions', { token: salesToken, method: 'POST', body: {
      customerId: 'customer-001', effectiveFrom: '2026-06-01', defaultPaymentTermsDays: 60, sellableScopeMode: 'RULE_CONTROLLED',
    } });
    assert.equal(overlap.status, 409);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM customer_commercial_extensions WHERE customer_id='customer-001'").get().n, 1);
    const superseded = await request('/api/customer-commercial-extensions', { token: salesToken, method: 'POST', body: {
      customerId: 'customer-001', effectiveFrom: '2026-06-01', defaultPaymentTermsDays: 60,
      sellableScopeMode: 'RULE_CONTROLLED', supersedeCurrent: true,
    } });
    assert.equal(superseded.status, 201, JSON.stringify(superseded.data));
    const old = database.prepare("SELECT effective_to FROM customer_commercial_extensions WHERE customer_id='customer-001' AND effective_from='2026-01-01'").get();
    assert.equal(old.effective_to, '2026-05-31');
  });

  test('xref supports multiple product candidates but resolver requires explicit product selection', async () => {
    const products = database.prepare('SELECT id FROM products WHERE active=1 ORDER BY code LIMIT 2').all();
    assert.equal(products.length, 2);
    for (const product of products) {
      const created = await request('/api/customer-material-xref', { token: salesToken, method: 'POST', body: {
        customerId: 'customer-001', productId: product.id, customerMaterialCode: 'CUST-MULTI', effectiveFrom: '2026-01-01', active: true,
      } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
    }
    assert.throws(() => resolveCustomerMaterialXref(database, { customerId: 'customer-001', customerMaterialCode: 'CUST-MULTI', businessDate: '2026-10-14' }), /显式选择/);
    assert.equal(resolveCustomerMaterialXref(database, { customerId: 'customer-001', customerMaterialCode: 'CUST-MULTI', productId: products[1].id, businessDate: '2026-10-14' }).productId, products[1].id);
  });

  test('classification is explicit and sellable rules enforce ALLOW dimensions with DENY precedence', async () => {
    const product = database.prepare('SELECT id,base_uom_code FROM products WHERE active=1 ORDER BY code LIMIT 1').get();
    const now = new Date().toISOString();
    database.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(product.base_uom_code, product.base_uom_code, now, now);
    const person = database.prepare("SELECT id FROM salesperson_profiles WHERE salesperson_code='SP-001'").get();
    const classified = await request('/api/sales/product-classifications', { token: salesToken, method: 'PUT', body: {
      productId: product.id, salesEnabled: true, defaultUpperDeliveryToleranceBps: 500,
      defaultLowerDeliveryToleranceBps: 0, serviceClassification: false, active: true,
    } });
    assert.equal(classified.status, 200, JSON.stringify(classified.data));
    const rules = [
      ['CUSTOMER_PRODUCT', { customerId: 'customer-001', productId: product.id }],
      ['SALESPERSON_PRODUCT', { salespersonId: person.id, productId: product.id }],
      ['SALESPERSON_CUSTOMER', { salespersonId: person.id, customerId: 'customer-001' }],
    ];
    for (const [scopeDimension, keys] of rules) {
      const result = await request('/api/sales/sellable-scope-rules', { token: salesToken, method: 'POST', body: { scopeDimension, ...keys, effect: 'ALLOW', effectiveFrom: '2026-01-01', active: true } });
      assert.equal(result.status, 201, JSON.stringify(result.data));
    }
    assert.equal(assertSellableProduct(database, { customerId: 'customer-001', salespersonId: person.id, productId: product.id, businessDate: '2026-10-14' }).salesEnabled, true);
    const deny = await request('/api/sales/sellable-scope-rules', { token: salesToken, method: 'POST', body: { scopeDimension: 'CUSTOMER_PRODUCT', customerId: 'customer-001', productId: product.id, effect: 'DENY', effectiveFrom: '2026-01-01', active: true } });
    assert.equal(deny.status, 201);
    assert.throws(() => assertSellableProduct(database, { customerId: 'customer-001', salespersonId: person.id, productId: product.id, businessDate: '2026-10-14' }), /DENY/);
  });

  test('successful mutations write transactional audits', () => {
    for (const entity of ['SALES_PARAMETER', 'SALES_GROUP', 'SALESPERSON', 'SALESPERSON_GROUP_MEMBERSHIP', 'CUSTOMER_COMMERCIAL_EXTENSION', 'CUSTOMER_MATERIAL_XREF', 'SALES_SELLABLE_SCOPE_RULE', 'PRODUCT_COMMERCIAL_CLASSIFICATION']) {
      assert.ok(database.prepare('SELECT 1 FROM audit_logs WHERE entity_type=? LIMIT 1').get(entity), `${entity} audit missing`);
    }
  });

  test('Salesperson SoD: SALES actor cannot bind a salesperson to themselves and cannot change their own default', async () => {
    // salesToken is the Sales role. We must NOT be able to write a salesperson
    // profile whose userId == 'user-sales', nor mutate that profile's
    // membership default. ADMIN must still be able to do both.
    const selfAssigned = await request('/api/sales/salespersons', { token: salesToken, method: 'POST', body: {
      salespersonCode: 'SP-SELF', name: '自指派销售员', userId: 'user-sales',
    } });
    assert.equal(selfAssigned.status, 403, 'Sales role cannot self-assign salesperson');
    assert.equal(selfAssigned.data.code, 'SALESPERSON_SELF_ASSIGNMENT_DENIED');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM salesperson_profiles WHERE salesperson_code='SP-SELF'").get().n, 0,
      'failed self-assignment must leave no business row');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALESPERSON' AND entity_id IS NULL").get().n, 0,
      'failed self-assignment must not write a SALESPERSON audit row');

    // Pre-seed a salesperson bound to user-sales via ADMIN, so the SALES
    // actor later cannot mutate the default membership of their own profile.
    const adminAssigned = await request('/api/sales/salespersons', { method: 'POST', body: {
      salespersonCode: 'SP-LINKED', name: '已绑定销售员', userId: 'user-sales',
    } });
    assert.equal(adminAssigned.status, 201, JSON.stringify(adminAssigned.data));
    const linkedId = adminAssigned.data.salesperson.id;
    const groupA = await request('/api/sales/groups', { method: 'POST', body: { groupCode: 'SODA', name: 'SoD-Group-A' } });
    const groupB = await request('/api/sales/groups', { method: 'POST', body: { groupCode: 'SODB', name: 'SoD-Group-B' } });
    // The seeded ADMIN baseline already has SP-001 + default group A
    // from earlier tests. SALES actor cannot create another default
    // membership for the profile bound to their own login.
    const selfDefault = await request('/api/sales/memberships', { token: salesToken, method: 'POST', body: {
      salespersonId: linkedId, salesGroupId: groupB.data.salesGroup.id, effectiveFrom: '2026-01-01', isDefault: true,
    } });
    assert.equal(selfDefault.status, 403, 'Sales role cannot change their own default group');
    assert.equal(selfDefault.data.code, 'SALESPERSON_SELF_DEFAULT_DENIED');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM salesperson_group_memberships WHERE salesperson_id=?").get(linkedId).n, 0,
      'failed self-default must roll back without inserting a membership');
    // ADMIN still maintains linked memberships for the same salesperson.
    const adminDefault = await request('/api/sales/memberships', { method: 'POST', body: {
      salespersonId: linkedId, salesGroupId: groupA.data.salesGroup.id, effectiveFrom: '2026-01-01', isDefault: true,
    } });
    assert.equal(adminDefault.status, 201, JSON.stringify(adminDefault.data));
    assert.equal(adminDefault.data.membership.isDefault, true);
  });

  test('canonical UoM contract: future / expired / inactive / wrong-product / missing-base conversions are rejected', async () => {
    // Seed an alternate UoM "BOX" with explicit conversion anchors
    // targeting product-001 (base EA). Three anchors represent the
    // valid / future / expired cases.
    const now = new Date().toISOString();
    // Register every UoM the test references. The demo seed sets
    // products.base_uom_code = unit, so some product base_uom codes
    // (e.g. '台' for product-001) must be present in `uoms` before the
    // conversion rows can be inserted.
    for (const code of ['EA', 'BOX', 'CS', '台', '个', 'BOX-INACTIVE', 'CS-FUTURE', 'CS-EXPIRED', 'WRONGPROD']) {
      database.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(code, code, now, now);
    }
    const product = database.prepare('SELECT id,base_uom_code FROM products WHERE active=1 ORDER BY code LIMIT 1').get();
    // The UNIQUE(product_id, uom_code, version) constraint means each
    // (product_id, uom_code) tuple can hold a single versioned row. We
    // therefore use different uom_codes for the valid / inactive and
    // future / expired scenarios.
    const inserts = [
      // version 1 = the in-force valid BOX conversion
      ['w1-conv-valid', product.id, 'BOX', product.base_uom_code, 1, 12, 1, 1, '2026-01-01', null],
      // version 2 = future-only CS conversion anchored at 2099
      ['w1-conv-future', product.id, 'CS', product.base_uom_code, 1, 24, 1, 2, '2099-01-01', null],
      // version 3 = expired CS conversion closed in 2020
      ['w1-conv-expired', product.id, 'CS', product.base_uom_code, 1, 50, 1, 3, '2020-01-01', '2020-12-31'],
      // version 4 = inactive BOX conversion (active=0)
      ['w1-conv-inactive', product.id, 'BOX', product.base_uom_code, 1, 6, 0, 4, '2026-01-01', null],
    ];
    for (const [id, productId, uomCode, baseUomCode, num, den, active, version, from, to] of inserts) {
      database.prepare(`INSERT OR REPLACE INTO product_uom_conversions
        (id,product_id,uom_code,base_uom_code,numerator,denominator,active,version,effective_from,effective_to,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, productId, uomCode, baseUomCode, num, den, active, version, from, to, now);
    }
    // Wrong-product conversion anchored to a different product so the
    // test product cannot use it. Use a new uom_code distinct from
    // the test product's rows so the UNIQUE constraint does not
    // collide.
    const otherProduct = database.prepare('SELECT id FROM products WHERE active=1 AND id<>? ORDER BY code LIMIT 1').get(product.id);
    database.prepare(`INSERT OR REPLACE INTO product_uom_conversions
      (id,product_id,uom_code,base_uom_code,numerator,denominator,active,version,effective_from,effective_to,created_at)
      VALUES('w1-conv-wrongproduct',?,?,?,1,8,1,1,'2026-01-01',NULL,?)`).run(otherProduct.id, 'WRONGPROD', product.base_uom_code, now);

    // Positive: BASE uom is always acceptable
    const baseClass = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: product.base_uom_code, pricingUomCode: product.base_uom_code,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(baseClass.status, 200, JSON.stringify(baseClass.data));

    // Positive: ALT uom has a valid in-force conversion → 200
    const altOk = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: 'BOX', pricingUomCode: 'BOX',
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(altOk.status, 200, JSON.stringify(altOk.data));

    // Negative: future-only conversion must reject — today is before 2099.
    const altFuture = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: 'CS', pricingUomCode: null,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(altFuture.status, 409, JSON.stringify(altFuture.data));
    assert.equal(altFuture.data.code, 'SALES_UOM_CONVERSION_UNAVAILABLE');

    // Negative: inactive conversion (BOX→1:6) must reject — the active=1
    // version (BOX→1:12) wins, so we still accept BOX; assert with CS
    // already closed so the only CS row is expired.
    const altExpired = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: 'CS', pricingUomCode: null,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(altExpired.status, 409, JSON.stringify(altExpired.data));
    assert.equal(altExpired.data.code, 'SALES_UOM_CONVERSION_UNAVAILABLE');

    // Negative: missing Master base_uom_code → SALES_UOM_UNAVAILABLE.
    // The schema enforces NOT NULL on base_uom_code, so we simulate
    // "missing" with the empty string and assert the assertion
    // catches the absence before any conversion is consulted.
    database.prepare("UPDATE products SET base_uom_code='' WHERE id=?").run(product.id);
    const noBase = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: null, pricingUomCode: null,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(noBase.status, 409, JSON.stringify(noBase.data));
    assert.equal(noBase.data.code, 'SALES_UOM_UNAVAILABLE');
    database.prepare('UPDATE products SET base_uom_code=? WHERE id=?').run(product.base_uom_code, product.id);

    // Negative: inactive conversion (BOX-INACTIVE) must reject.
    const altInactive = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: 'BOX-INACTIVE', pricingUomCode: null,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(altInactive.status, 409, JSON.stringify(altInactive.data));
    assert.equal(altInactive.data.code, 'SALES_UOM_CONVERSION_UNAVAILABLE');

    // Negative: wrong-product conversion (WRONGPROD anchored to
    // otherProduct) must reject for the test product.
    const altWrongProduct = await request('/api/sales/product-classifications', { method: 'PUT', body: {
      productId: product.id, salesEnabled: true,
      salesUomCode: 'WRONGPROD', pricingUomCode: null,
      defaultUpperDeliveryToleranceBps: 0, defaultLowerDeliveryToleranceBps: 0,
      serviceClassification: false, active: true,
    } });
    assert.equal(altWrongProduct.status, 409, JSON.stringify(altWrongProduct.data));
    assert.equal(altWrongProduct.data.code, 'SALES_UOM_CONVERSION_UNAVAILABLE');

    // Negative: xref commercial_uom_code must also satisfy the same contract
    // on its effective_from anchor. Use the future-only CS conversion
    // anchored to a 2099 start date; an xref starting today must reject.
    const xrefFuture = await request('/api/customer-material-xref', { method: 'POST', body: {
      customerId: 'customer-001', productId: product.id,
      customerMaterialCode: 'CUST-FUTURE-UOM', commercialUomCode: 'CS', effectiveFrom: '2026-01-01', active: true,
    } });
    assert.equal(xrefFuture.status, 409, JSON.stringify(xrefFuture.data));
    assert.equal(xrefFuture.data.code, 'SALES_UOM_CONVERSION_UNAVAILABLE');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM customer_material_xref WHERE customer_material_code='CUST-FUTURE-UOM'").get().n, 0);
  });

  test('Read authorization: only CUSTOMERS_VIEW actor is forbidden to read commercial data', async () => {
    // A reviewer holds only CUSTOMERS_VIEW (per the canonical role mapping
    // in server/db.js seed). They MUST NOT see commercial extensions,
    // xref, sellable scope or product classification.
    const paths = [
      `/api/customer-commercial-extensions?customerId=customer-001`,
      `/api/customer-material-xref?customerId=customer-001`,
      `/api/sales/sellable-scope-rules`,
      `/api/sales/product-classifications`,
    ];
    for (const path of paths) {
      const denied = await request(path, { token: reviewerToken });
      assert.equal(denied.status, 403, `reviewer must not read ${path}: ${JSON.stringify(denied.data)}`);
    }
    // SALES role holds SALES_FOUNDATION_* and is allowed to read.
    for (const path of paths) {
      const allowed = await request(path, { token: salesToken });
      assert.equal(allowed.status, 200, `sales must read ${path}: ${JSON.stringify(allowed.data)}`);
    }
    // ACCOUNTING has no Sales-side permission either.
    for (const path of paths) {
      const deniedAccounting = await request(path, { token: accountingToken });
      assert.equal(deniedAccounting.status, 403, `accounting must not read ${path}: ${JSON.stringify(deniedAccounting.data)}`);
    }
  });

  test('Read authorization: negative mutation attempts leave no business row and no audit', async () => {
    const before = (table) => Number(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
    const auditBefore = Number(database.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CUSTOMER_COMMERCIAL_EXTENSION'").get().n);
    const extBefore = before('customer_commercial_extensions');
    const denied = await request('/api/customer-commercial-extensions', { token: reviewerToken, method: 'POST', body: {
      customerId: 'customer-001', effectiveFrom: '2026-12-01', sellableScopeMode: 'ALL_SALES_ENABLED',
    } });
    assert.equal(denied.status, 403);
    assert.equal(before('customer_commercial_extensions'), extBefore, 'reviewer must not create extensions');
    const auditAfter = Number(database.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CUSTOMER_COMMERCIAL_EXTENSION'").get().n);
    assert.equal(auditAfter, auditBefore, 'denied mutations must not write audit rows');
  });
});
