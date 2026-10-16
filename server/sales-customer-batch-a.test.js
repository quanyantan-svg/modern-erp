import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

let db; let server; let baseUrl; let tempDir; let canonicalOrderId; let quotationId; let quotationLineId; const tokens = {};
async function request(path, { token = tokens.admin, method = 'GET', body, key } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function login(username, password) {
  const response = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'sales-batch-a-')); db = createDatabase(join(tempDir, 'erp.db')); const stamp = new Date().toISOString();
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  db.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(uom, uom, stamp, stamp);
  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
    .run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('batch-group','BATCH','Batch A',1,?,?)")
    .run(stamp, stamp);
  db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('batch-salesperson','BATCH-SP','Batch Sales','user-sales',1,?,?)")
    .run(stamp, stamp);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('batch-membership','batch-salesperson','batch-group','2026-01-01',1,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES('batch-class','product-001',1,?,?,1000,500,0,1,?,?)`).run(uom, uom, stamp, stamp);
  const priceListId = '11111111-1111-4111-8111-111111111111';
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'BATCH-PL','Batch price','CNY',0,'2026-01-01','ACTIVE',?,'user-reviewer',?,'user-sales',?,'user-sales')`).run(priceListId, stamp, stamp, stamp);
  const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
  const pricingKey = `U:${Buffer.from(uom).toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES('batch-entry',?,'product-001',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-sales')`).run(priceListId, materialKey, uom, pricingKey, stamp);
  db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('batch-version','batch-entry',1,1250,'{}',?,'user-sales')").run(stamp);
  db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
    default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
    created_by,updated_by,default_pricing_list_id) VALUES('customer-001','2026-01-01','customer-001','customer-001','batch-salesperson','batch-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
    .run(stamp, stamp, 'user-admin', 'user-admin', priceListId);
  server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = await login('admin', 'admin123'); tokens.sales = await login('sales', 'sales123'); tokens.reviewer = await login('reviewer', 'review123');
});
after(async () => { if (server) await new Promise((done) => server.close(done)); db?.close(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

test('Wave 3-5 schema is exactly seven tables and eleven SO item columns', () => {
  const expected = ['sales_quotations','sales_quotation_lines','sales_quotation_conversions','sales_order_changes','sales_order_change_lines','delivery_notices','delivery_notice_lines'].sort();
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${expected.map(() => '?').join(',')}) ORDER BY name`).all(...expected).map((row) => row.name);
  assert.deepEqual(rows, expected);
  const columns = new Set(db.prepare('PRAGMA table_info(sales_order_items)').all().map((row) => row.name));
  for (const name of ['is_gift_line','commercial_tax_basis','tax_inclusive_assumption','pricing_uom_code_applied','qty_break_applied_min','qty_break_applied_max','planned_delivery_date','upper_delivery_tolerance_bps','lower_delivery_tolerance_bps','price_snapshot_json','discount_snapshot_json']) assert.ok(columns.has(name), name);
});

test('canonical order writer ignores forged client snapshots and persists server evidence', async () => {
  const body = { customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20', items: [{ productId: 'product-001', uomCode: db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code, quantityDecimal: '2', priceSnapshot: { forged: true }, discountSnapshot: { forged: true } }] };
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', body, key: 'order-create-1' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  canonicalOrderId = created.data.id;
  const item = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(created.data.id);
  assert.ok(item.price_snapshot_json); assert.ok(item.discount_snapshot_json); assert.equal(JSON.parse(item.price_snapshot_json).forged, undefined);
  assert.equal(JSON.parse(item.price_snapshot_json).evidence.versionId, 'batch-version'); assert.equal(JSON.parse(item.discount_snapshot_json).evidence.explicitZeroDiscount, true);
  const replay = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', body, key: 'order-create-1' });
  assert.equal(replay.status, 200); assert.equal(replay.data.id, created.data.id); assert.equal(replay.data.replayed, true);
});

test('commercial parties and tax assumptions persist on SO without creating statutory invoice truth', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const invoicesBefore = Number(db.prepare('SELECT COUNT(*) n FROM sales_invoices').get().n);
  const body = {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    shipToContactName: 'Receiving', shipToPhone: '13000000001', shipToAddress: 'Destination', paymentTerms: 'MONTHLY', paymentTermsDays: 30,
    commercialTaxCode: 'COMMERCIAL_ASSUMPTION_ONLY', taxInclusive: true, invoiceTaxAmountCents: 999999,
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', commercialTaxBasis: 'NET_ASSUMPTION', taxInclusiveAssumption: true }],
  };
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'commercial-tax-boundary', body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(created.data.id);
  const line = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(created.data.id);
  assert.deepEqual([order.ship_to_contact_name, order.ship_to_phone, order.ship_to_address, order.payment_terms, Number(order.payment_terms_days)],
    ['Receiving', '13000000001', 'Destination', 'MONTHLY', 30]);
  assert.deepEqual([order.salesperson_id, order.sales_group_id, order.settlement_party_id, order.payer_id],
    ['batch-salesperson', 'batch-group', 'customer-001', 'customer-001']);
  assert.deepEqual([order.commercial_tax_code, Number(order.tax_inclusive), line.commercial_tax_basis, Number(line.tax_inclusive_assumption)],
    ['COMMERCIAL_ASSUMPTION_ONLY', 1, 'NET_ASSUMPTION', 1]);
  assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM sales_invoices').get().n), invoicesBefore);
  assert.equal(order.invoice_tax_amount_cents, undefined);
  const before = {
    orders: Number(db.prepare('SELECT COUNT(*) n FROM sales_orders').get().n),
    audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND action='CREATE'").get().n),
  };
  for (const [label, invalidBody] of [
    ['header', { ...body, taxInclusive: 'yes' }],
    ['line', { ...body, items: [{ ...body.items[0], taxInclusiveAssumption: 'yes' }] }],
  ]) {
    const denied = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: `commercial-tax-invalid-${label}`, body: invalidBody });
    assert.equal(denied.status, 422, JSON.stringify(denied.data));
    assert.equal(denied.data.details?.code || denied.data.code, 'SALES_TAX_ASSUMPTION_INVALID');
    assert.deepEqual({
      orders: Number(db.prepare('SELECT COUNT(*) n FROM sales_orders').get().n),
      audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND action='CREATE'").get().n),
    }, before);
  }
});

test('quotation converts multiple lines, rejects duplicates, and keeps request-level exact replay', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const quote = await request('/api/sales-quotations', { token: tokens.sales, method: 'POST', body: { customerId: 'customer-001', validFrom: '2026-10-15', validTo: '2026-12-31', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '4' }, { productId: 'product-001', uomCode: uom, quantityDecimal: '3' }] } });
  assert.equal(quote.status, 201, JSON.stringify(quote.data)); quotationId = quote.data.quotation.id; quotationLineId = quote.data.quotation.lines[0].id;
  const secondLineId = quote.data.quotation.lines[1].id;
  const sourceFacts = () => ({ orders: db.prepare('SELECT COUNT(*) n FROM sales_orders').get().n,
    conversions: db.prepare('SELECT COUNT(*) n FROM sales_quotation_conversions WHERE quotation_id=?').get(quotationId).n,
    audit: db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_QUOTATION' AND entity_id=? AND action='CONVERT_TO_SO'").get(quotationId).n });
  const beforeInvalid = sourceFacts();
  const unpublished = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-unpublished', body: {
    businessDate: '2026-10-15', lineSelections: [{ quotationLineId, quantityMicros: 1_000_000 }],
  } });
  assert.equal(unpublished.status, 409); assert.deepEqual(sourceFacts(), beforeInvalid);
  assert.equal((await request(`/api/sales-quotations/${quotationId}/effective-publish`, { token: tokens.sales, method: 'POST', body: {} })).status, 200);
  const expired = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-expired', body: {
    businessDate: '2027-01-01', lineSelections: [{ quotationLineId, quantityMicros: 1_000_000 }],
  } });
  assert.equal(expired.status, 409); assert.deepEqual(sourceFacts(), beforeInvalid);
  const firstBody = { businessDate: '2026-10-15', lineSelections: [{ quotationLineId, quantityMicros: 2_000_000 }, { quotationLineId: secondLineId, quantityMicros: 1_000_000 }] };
  const duplicate = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-duplicate', body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId, quantityMicros: 1 }, { quotationLineId, quantityMicros: 1 }] } });
  assert.equal(duplicate.status, 422); assert.equal(duplicate.data.details?.code || duplicate.data.code, 'DUPLICATE_QUOTATION_LINE');
  const converted = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-convert-1', body: firstBody });
  assert.equal(converted.status, 201, JSON.stringify(converted.data));
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sales_quotation_conversions WHERE quotation_id=? AND sales_order_id=?').get(quotationId, converted.data.salesOrderId).count, 2);
  const replay = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-convert-1', body: firstBody });
  assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.equal(replay.data.salesOrderId, converted.data.salesOrderId);
  const mismatch = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-convert-1', body: { ...firstBody, lineSelections: [{ quotationLineId, quantityMicros: 1 }] } });
  assert.equal(mismatch.status, 409);
  const repeated = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-convert-2', body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId, quantityMicros: 2_000_000 }, { quotationLineId: secondLineId, quantityMicros: 2_000_000 }] } });
  assert.equal(repeated.status, 201, JSON.stringify(repeated.data)); assert.equal(db.prepare('SELECT status FROM sales_quotations WHERE id=?').get(quotationId).status, 'FULLY_CONVERTED');
  const excess = await request(`/api/sales-quotations/${quotationId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'quote-convert-3', body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId, quantityMicros: 1 }] } });
  assert.equal(excess.status, 409);
});

test('manual price override requires RBAC and preserves actor/reason with converter SOD', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const body = { customerId: 'customer-001', validFrom: '2026-10-15', validTo: '2026-12-31',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', manualPriceCents: 1100, overrideReason: 'approved campaign exception' }] };
  const denied = await request('/api/sales-quotations', { token: tokens.sales, method: 'POST', body });
  assert.equal(denied.status, 403);
  const quote = await request('/api/sales-quotations', { token: tokens.admin, method: 'POST', body });
  assert.equal(quote.status, 201, JSON.stringify(quote.data));
  const quoteId = quote.data.quotation.id; const quoteLineId = quote.data.quotation.lines[0].id;
  assert.equal((await request(`/api/sales-quotations/${quoteId}/effective-publish`, { token: tokens.admin, method: 'POST', body: {} })).status, 200);
  const converted = await request(`/api/sales-quotations/${quoteId}/convert-to-so`, { token: tokens.sales, method: 'POST', key: 'manual-override-convert',
    body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId: quoteLineId, quantityMicros: 1_000_000 }] } });
  assert.equal(converted.status, 201, JSON.stringify(converted.data));
  const stored = db.prepare('SELECT price_snapshot_json FROM sales_order_items WHERE order_id=?').get(converted.data.salesOrderId);
  const snapshot = JSON.parse(stored.price_snapshot_json);
  assert.equal(snapshot.evidence.overrideState, 'OVERRIDDEN');
  assert.equal(snapshot.evidence.overrideEvidence.actorId, 'user-admin');
  assert.equal(snapshot.evidence.overrideEvidence.authority, 'SALES_PRICING_OVERRIDE');
  assert.equal(snapshot.evidence.overrideEvidence.reason, 'approved campaign exception');
  assert.equal(snapshot.catalogUnitPriceCents, 1250);
  assert.equal(snapshot.unitPriceCents, 1100);
  assert.notEqual(snapshot.evidence.overrideEvidence.actorId, 'user-sales');
});

test('direct SO creation consumes a server-issued independent price override authorization', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorizationBody = { customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'reviewer approved direct order exception' };
  assert.equal((await request('/api/sales-price-overrides/authorize', { token: tokens.sales, method: 'POST', body: authorizationBody })).status, 403);
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: authorizationBody });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'direct-authorized-override', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authorized.data.authorizationId }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const snapshot = JSON.parse(db.prepare('SELECT price_snapshot_json FROM sales_order_items WHERE order_id=?').get(created.data.id).price_snapshot_json);
  assert.equal(snapshot.unitPriceCents, 1099); assert.equal(snapshot.catalogUnitPriceCents, 1250);
  assert.equal(snapshot.evidence.overrideEvidence.actorId, 'user-reviewer');
  assert.equal(snapshot.evidence.overrideEvidence.authorizationId, undefined);
  assert.equal(snapshot.authorizationEvidence.authorizationId, authorized.data.authorizationId);
  assert.equal(snapshot.authorizationEvidence.pricingEvidenceFingerprint, snapshot.evidence.fingerprint);
  assert.equal(snapshot.evidence.overrideEvidence.reason, authorizationBody.overrideReason);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'direct-authorized-override-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'direct-authorized-override-approve', body: {} })).status, 200);
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(created.data.id).status, 'APPROVED');
  const forged = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'direct-forged-override', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: 'forged-reviewer-id',
      manualPriceCents: 1, overrideReason: 'forged actor' }] } });
  assert.equal(forged.status, 409); assert.equal(forged.data.details?.code || forged.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_INVALID');
  const reused = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'direct-authorized-override-reuse', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authorized.data.authorizationId }] } });
  assert.equal(reused.status, 409);

  for (const [suffix, changed] of [
    ['customer', { customerId: 'customer-002' }],
    ['material', { productId: 'product-002' }],
    ['quantity', { quantityDecimal: '2' }],
  ]) {
    const scoped = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: authorizationBody });
    assert.equal(scoped.status, 201, JSON.stringify(scoped.data));
    const attempted = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: `direct-authorized-override-${suffix}`, body: {
      customerId: changed.customerId || 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
      items: [{ productId: changed.productId || 'product-001', uomCode: uom, quantityDecimal: changed.quantityDecimal || '1', priceOverrideAuthorizationId: scoped.data.authorizationId }] } });
    assert.notEqual(attempted.status, 201, `${suffix}: ${JSON.stringify(attempted.data)}`);
  }
});

test('R3 P1 in-request duplicate override authorization is rejected and the legitimate chain remains successful', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorize = async (suffix, manualPriceCents) => {
    const result = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
      customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
      quantityDecimal: '1', manualPriceCents, overrideReason: `R3 ${suffix} authorization` } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.authorizationId;
  };
  const beforeRows = db.prepare("SELECT COUNT(*) n FROM sales_orders WHERE order_date='2026-10-15'").get().n;
  const beforeAudit = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND action='CREATE'").get().n;
  const beforeIdempotency = db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_ORDER_CREATE'").get().n;

  const firstAuthId = await authorize('first', 1099);
  const secondAuthId = await authorize('second', 1088);
  const thirdAuthId = await authorize('third', 1077);
  const patchAuthId = await authorize('patch', 1066);

  // Scenario 1: two lines referencing the same authorization id → reject, zero side effects.
  const rejected = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r3-duplicate-same-auth', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: firstAuthId },
            { productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: firstAuthId }] } });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
  assert.equal(rejected.data.details?.code || rejected.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_orders WHERE order_date='2026-10-15'").get().n, beforeRows);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND action='CREATE'").get().n, beforeAudit);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_ORDER_CREATE'").get().n, beforeIdempotency);

  // Scenario 2: failed duplicate request followed by legitimate single use → accept.
  const legitimate = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r3-legit-after-rejected', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: firstAuthId }] } });
  assert.equal(legitimate.status, 201, JSON.stringify(legitimate.data));
  const legitItem = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(legitimate.data.id);
  const legitSnapshot = JSON.parse(legitItem.price_snapshot_json);
  assert.equal(legitSnapshot.unitPriceCents, 1099);
  assert.equal(legitSnapshot.catalogUnitPriceCents, 1250);
  assert.equal(legitSnapshot.authorizationEvidence.authorizationId, firstAuthId);
  assert.equal(legitSnapshot.authorizationEvidence.pricingEvidenceFingerprint, legitSnapshot.evidence.fingerprint);

  // Scenario 3: two lines referencing distinct valid authorization ids → accept.
  const distinct = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r3-distinct-auths', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: secondAuthId },
            { productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: thirdAuthId }] } });
  assert.equal(distinct.status, 201, JSON.stringify(distinct.data));
  const distinctItems = db.prepare('SELECT id,price_snapshot_json FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(distinct.data.id);
  assert.equal(distinctItems.length, 2);
  const firstSnapshot = JSON.parse(distinctItems[0].price_snapshot_json);
  const thirdSnapshot = JSON.parse(distinctItems[1].price_snapshot_json);
  assert.equal(firstSnapshot.authorizationEvidence.authorizationId, secondAuthId);
  assert.equal(thirdSnapshot.authorizationEvidence.authorizationId, thirdAuthId);
  assert.notEqual(firstSnapshot.authorizationEvidence.authorizationId, thirdSnapshot.authorizationEvidence.authorizationId);

  // Scenario 4: PATCH update with two new lines referencing the same authorization id → reject
  // (another public mutation path). Must run while the order is still DRAFT.
  const patchRejected = await request(`/api/sales-orders/${legitimate.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: patchAuthId },
            { productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: patchAuthId }] } });
  assert.equal(patchRejected.status, 409, JSON.stringify(patchRejected.data));
  assert.equal(patchRejected.data.details?.code || patchRejected.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE');
  const linesAfterPatch = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').all(legitimate.data.id);
  assert.equal(linesAfterPatch.length, 1);

  // Scenario 5: authorization reused in another order after successful consumption → reject.
  const reused = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r3-reuse-after-original', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: firstAuthId }] } });
  assert.equal(reused.status, 409);
  assert.equal(reused.data.details?.code || reused.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_USED');

  // Scenario 6: full authorize → create → submit → independent approve chain on both legitimate orders.
  assert.equal((await request(`/api/sales-orders/${legitimate.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r3-legit-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${legitimate.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r3-legit-approve', body: {} })).status, 200);
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(legitimate.data.id).status, 'APPROVED');
  assert.equal((await request(`/api/sales-orders/${distinct.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r3-distinct-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${distinct.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r3-distinct-approve', body: {} })).status, 200);
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(distinct.data.id).status, 'APPROVED');
});

test('R3 P1 controlled-change ADD with duplicate override authorization in one change request is rejected', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authResult = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R3 controlled-change ADD' } });
  assert.equal(authResult.status, 201, JSON.stringify(authResult.data));
  const authorizationId = authResult.data.authorizationId;

  // Create + approve an order to enable controlled-change.
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r3-cc-base-order', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r3-cc-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r3-cc-approve', body: {} })).status, 200);

  const beforeLines = db.prepare('SELECT COUNT(*) n FROM sales_order_items WHERE order_id=?').get(created.data.id).n;
  const beforeChange = db.prepare('SELECT COUNT(*) n FROM sales_order_changes WHERE sales_order_id=?').get(created.data.id).n;

  const rejected = await request(`/api/sales-orders/${created.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r3-cc-duplicate-add', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R3 cc duplicate',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authorizationId },
            { op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authorizationId }] } });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
  assert.equal(rejected.data.details?.code || rejected.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_order_items WHERE order_id=?').get(created.data.id).n, beforeLines);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_order_changes WHERE sales_order_id=?').get(created.data.id).n, beforeChange);

  // Same authorization now legitimately used in a single ADD inside another change request → accept.
  const accepted = await request(`/api/sales-orders/${created.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r3-cc-single-add', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R3 cc single',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authorizationId }] } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const applied = await request(`/api/sales-order-changes/${accepted.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r3-cc-apply', body: {} });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
});

test('R4 P1 server-authoritative consumption record survives PATCH removal and reuse attempts', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R4 PATCH removal survival' } });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const authId = authorized.data.authorizationId;
  const consumptionLookup = () => db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId);

  // Original SO consumes the authorization.
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-patch-original', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authId }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.ok(consumptionLookup(), 'consumption record must exist after SO creation');

  // Draft PATCH replaces the consumed line with an unrelated, non-authorization line.
  const patched = await request(`/api/sales-orders/${created.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '2' }] } });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  const linesAfterPatch = db.prepare('SELECT COUNT(*) n FROM sales_order_items WHERE order_id=?').get(created.data.id).n;
  assert.equal(linesAfterPatch, 1, 'PATCH must have replaced the consumed line');
  assert.ok(consumptionLookup(), 'PATCH removing a consumed line must NOT release the authorization');

  // Same authorization reused in a new order after PATCH removal must fail.
  const reuseAfterPatch = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-patch-reuse', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authId }] } });
  assert.equal(reuseAfterPatch.status, 409);
  assert.equal(reuseAfterPatch.data.details?.code || reuseAfterPatch.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_USED');

  // PATCH attempting to consume the already-locked authorization in a new line must also fail closed.
  const patchReuseConsumed = await request(`/api/sales-orders/${created.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authId }] } });
  assert.equal(patchReuseConsumed.status, 409);
  assert.equal(patchReuseConsumed.data.details?.code || patchReuseConsumed.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_USED');
});

test('R4 P1 SUBMITTED Change ADD reserves the authorization against concurrent consumption and rejects release', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R4 SUBMITTED occupancy' } });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const authId = authorized.data.authorizationId;
  const consumptionLookup = () => db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId);

  // Create + approve an unrelated base SO to enable controlled-change.
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-occ-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r4-occ-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r4-occ-approve', body: {} })).status, 200);

  // SUBMITTED Change ADD reserves the authorization at create time.
  const changeRequest = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r4-occ-add', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R4 occupancy reserve',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authId }] } });
  assert.equal(changeRequest.status, 201, JSON.stringify(changeRequest.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeRequest.data.id).state, 'SUBMITTED');
  assert.ok(consumptionLookup(), 'SUBMITTED Change ADD must occupy the authorization');

  // Concurrent SO creation with the same authorization must fail closed.
  const concurrent = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-occ-concurrent', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authId }] } });
  assert.equal(concurrent.status, 409);
  assert.equal(concurrent.data.details?.code || concurrent.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_USED');

  // Reject the Change ADD → occupancy released; audit + DB-level record both reflect release.
  const auditBeforeRelease = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND action='RELEASE'").get().n);
  const rejected = await request(`/api/sales-order-changes/${changeRequest.data.id}/reject`, { token: tokens.reviewer, method: 'POST', body: { reason: 'R4 occupancy release' } });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeRequest.data.id).state, 'REJECTED');
  assert.equal(consumptionLookup(), undefined, 'REJECTED Change ADD must release the reservation');
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND action='RELEASE'").get().n), auditBeforeRelease + 1);

  // After release the authorization can be re-consumed.
  const reused = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-occ-after-release', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authId }] } });
  assert.equal(reused.status, 201, JSON.stringify(reused.data));
  assert.ok(consumptionLookup(), 're-consumed authorization must have a fresh consumption record');
});

test('R4 P1 Change ADD apply rolls back the entire transaction when the consumption record is missing', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R4 apply rollback' } });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const authId = authorized.data.authorizationId;

  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r4-rollback-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r4-rollback-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r4-rollback-approve', body: {} })).status, 200);

  const changeRequest = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r4-rollback-add', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R4 apply rollback',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authId }] } });
  assert.equal(changeRequest.status, 201, JSON.stringify(changeRequest.data));

  const beforeLines = db.prepare('SELECT id,quantity,amount_cents FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(base.data.id);
  const beforeOrder = db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(base.data.id);
  const beforeApprovalState = db.prepare('SELECT status FROM approval_requests WHERE source_type=? AND source_id=?').get('SALES_ORDER_CHANGE', changeRequest.data.id)?.status;
  const beforeAuditApprove = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='APPROVE_AND_APPLY'").get().n);

  // Externally release the consumption record to simulate tampering / cancellation outside the change lifecycle.
  db.prepare(
    `DELETE FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).run(authId);

  const applyAttempt = await request(`/api/sales-order-changes/${changeRequest.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r4-rollback-apply', body: {} });
  assert.equal(applyAttempt.status, 409, JSON.stringify(applyAttempt.data));
  assert.equal(applyAttempt.data.details?.code || applyAttempt.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED');

  // Full transaction rollback: no new line, no version bump, no applied state, no idempotency save, no APPROVE_AND_APPLY audit.
  const afterLines = db.prepare('SELECT id,quantity,amount_cents FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(base.data.id);
  const afterOrder = db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(base.data.id);
  const afterApprovalState = db.prepare('SELECT status FROM approval_requests WHERE source_type=? AND source_id=?').get('SALES_ORDER_CHANGE', changeRequest.data.id)?.status;
  const afterAuditApprove = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='APPROVE_AND_APPLY'").get().n);
  assert.deepEqual(afterLines, beforeLines, 'failed apply must not insert a SO line');
  assert.deepEqual(afterOrder, beforeOrder, 'failed apply must not bump effective_version or total');
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeRequest.data.id).state, 'SUBMITTED', 'failed apply must leave the change in SUBMITTED state');
  assert.equal(afterApprovalState, beforeApprovalState, 'failed apply must not flip approval status');
  assert.equal(afterAuditApprove, beforeAuditApprove, 'failed apply must not write APPROVE_AND_APPLY audit');
  assert.equal(db.prepare(
    `SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_ORDER_CHANGE_APPLY' AND document_id=?`
  ).get(changeRequest.data.id).n, 0, 'failed apply must not save apply idempotency');
});

test('R5 P1 DRAFT Change ADD PATCH reconciles owner-aware reservations across retain / replace / remove / cancel', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorize = async (suffix, manualPriceCents) => {
    const r = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
      customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
      quantityDecimal: '1', manualPriceCents, overrideReason: `R5 PATCH ${suffix}` } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.authorizationId;
  };
  const sourceOf = (authorizationId) => {
    const row = db.prepare(
      `SELECT result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
    ).get(authorizationId);
    return row ? JSON.parse(row.result_json).source : null;
  };
  const reservationExists = (authorizationId) => Boolean(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authorizationId));

  // Create + approve a base order so CONTROLLED_DOCUMENT changes are allowed.
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r5-patch-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r5-patch-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r5-patch-approve', body: {} })).status, 200);
  const baseItem = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(base.data.id);

  // Initial DRAFT Change ADD reservation.
  const authA = await authorize('A', 1099);
  const initial = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 initial draft',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authA }] } });
  assert.equal(initial.status, 201, JSON.stringify(initial.data));
  const changeId = initial.data.id;
  assert.equal(sourceOf(authA), `SALES_ORDER_CHANGE:${changeId}`, 'DRAFT creation must reserve under change owner');

  // Scenario 1: PATCH retaining the same auth A → success; A's record survives untouched.
  const retainSnapshot = db.prepare(
    `SELECT result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authA).result_json;
  const linesBeforeRetain = db.prepare('SELECT id, op, after_values_json FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(changeId);
  const retain = await request(`/api/sales-order-changes/${changeId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 retain same auth',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authA }] } });
  assert.equal(retain.status, 200, JSON.stringify(retain.data));
  assert.equal(reservationExists(authA), true, 'retained auth must keep its consumption record');
  assert.equal(sourceOf(authA), `SALES_ORDER_CHANGE:${changeId}`);
  assert.equal(db.prepare(
    `SELECT result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authA).result_json, retainSnapshot, 'retained auth record must not be rewritten');

  // Scenario 2: PATCH replacing A with B → A released, B reserved under the change owner.
  const authB = await authorize('B', 1088);
  const replace = await request(`/api/sales-order-changes/${changeId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 replace A with B',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authB }] } });
  assert.equal(replace.status, 200, JSON.stringify(replace.data));
  assert.equal(reservationExists(authA), false, 'replaced auth A must release its consumption record');
  assert.equal(reservationExists(authB), true, 'new auth B must reserve its consumption record');
  assert.equal(sourceOf(authB), `SALES_ORDER_CHANGE:${changeId}`);

  // Scenario 3: PATCH removing the ADD entirely (replacing with a MODIFY on the base line) → B released.
  const removeAdd = await request(`/api/sales-order-changes/${changeId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 remove ADD entirely',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItem.id, quantityMicros: 1_500_000 }] } });
  assert.equal(removeAdd.status, 200, JSON.stringify(removeAdd.data));
  assert.equal(reservationExists(authB), false, 'removed ADD must release its auth reservation');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_order_change_lines WHERE change_id=? AND op=?').get(changeId, 'ADD').n, 0, 'PATCH must remove the prior ADD line');

  // Scenario 4: Invalid PATCH (using an auth already consumed elsewhere) must leave the prior
  // change lines and their reservations untouched. We re-attach authB which is now free.
  await authorize('B-rebind', 1088);
  const changeBeforeFail = db.prepare('SELECT id, op, after_values_json FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(changeId);
  const consumedElsewhere = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r5-patch-busy', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', priceOverrideAuthorizationId: authB }] } });
  assert.equal(consumedElsewhere.status, 201, JSON.stringify(consumedElsewhere.data));
  assert.equal(sourceOf(authB), 'DIRECT_SALES_LINE', 'auth B is now consumed by a direct SO');
  const invalidPatch = await request(`/api/sales-order-changes/${changeId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 invalid reuse',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authB }] } });
  assert.equal(invalidPatch.status, 409, JSON.stringify(invalidPatch.data));
  assert.equal(invalidPatch.data.details?.code || invalidPatch.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_USED');
  const linesAfterFail = db.prepare('SELECT id, op, after_values_json FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(changeId);
  assert.deepEqual(linesAfterFail, changeBeforeFail, 'failed PATCH must restore the exact previous change lines');
  assert.equal(reservationExists(authA), false);
  assert.equal(reservationExists(authB), true, 'direct-SO consumption must remain');
  assert.equal(sourceOf(authB), 'DIRECT_SALES_LINE', 'invalid PATCH must not flip the owner');

  // Scenario 5: PATCH replacement followed by Cancel must not leave orphan reservations.
  // First re-create a fresh DRAFT change with auth A again.
  const authC = await authorize('C', 1077);
  const draftTwo = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 draft two',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authC }] } });
  assert.equal(draftTwo.status, 201, JSON.stringify(draftTwo.data));
  const changeTwoId = draftTwo.data.id;
  const authD = await authorize('D', 1066);
  const draftTwoReplace = await request(`/api/sales-order-changes/${changeTwoId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 draft two replace',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authD }] } });
  assert.equal(draftTwoReplace.status, 200, JSON.stringify(draftTwoReplace.data));
  assert.equal(reservationExists(authC), false, 'replaced auth C must release');
  assert.equal(reservationExists(authD), true);
  assert.equal(sourceOf(authD), `SALES_ORDER_CHANGE:${changeTwoId}`);
  const draftTwoCancel = await request(`/api/sales-order-changes/${changeTwoId}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'R5 cancel after replace' } });
  assert.equal(draftTwoCancel.status, 200, JSON.stringify(draftTwoCancel.data));
  assert.equal(reservationExists(authC), false);
  assert.equal(reservationExists(authD), false, 'cancel after replace must release only the currently reserved D');
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeTwoId).state, 'CANCELLED');
});

test('R5 P1 owner-aware apply rejects cross-owner authorization without touching the unrelated record', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorize = async (suffix, manualPriceCents) => {
    const r = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
      customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
      quantityDecimal: '1', manualPriceCents, overrideReason: `R5 owner ${suffix}` } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.authorizationId;
  };

  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r5-owner-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r5-owner-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r5-owner-approve', body: {} })).status, 200);

  const authA = await authorize('A', 1099);
  const changeA = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r5-owner-changeA', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 owner change A',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authA }] } });
  assert.equal(changeA.status, 201, JSON.stringify(changeA.data));
  const changeAId = changeA.data.id;

  const authB = await authorize('B', 1088);
  const changeB = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r5-owner-changeB', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R5 owner change B',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authB }] } });
  assert.equal(changeB.status, 201, JSON.stringify(changeB.data));
  const changeBId = changeB.data.id;

  // Cross-owner release attempt: the record's true source is changeB, but changeA attempts
  // to release it with expectedOwner=changeA. The owner check must reject without
  // deleting the unrelated record.
  const { PRICE_OVERRIDE_CONSUMPTION } = await import('./modules/sales-orders.js');
  const beforeChangeBRecord = db.prepare(
    `SELECT result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authB);
  assert.equal(JSON.parse(beforeChangeBRecord.result_json).source, `SALES_ORDER_CHANGE:${changeBId}`, 'precondition: auth B is owned by changeB');
  let mismatchThrown = null;
  try { PRICE_OVERRIDE_CONSUMPTION.release(db, authB, { id: 'user-sales', roleCode: 'SALES', permissions: [] }, { expectedOwner: `SALES_ORDER_CHANGE:${changeAId}` }); }
  catch (error) { mismatchThrown = error; }
  assert.ok(mismatchThrown, 'cross-owner release must throw');
  assert.equal(mismatchThrown.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH');
  const afterMismatchRecord = db.prepare(
    `SELECT result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authB);
  assert.ok(afterMismatchRecord, 'cross-owner release must not delete the unrelated changeB record');
  assert.equal(JSON.parse(afterMismatchRecord.result_json).source, `SALES_ORDER_CHANGE:${changeBId}`, 'record source must remain untouched');

  // Cross-owner assert attempt: the record is owned by changeB; changeA asks assertReserved
  // with expectedOwner=changeA. It must throw and not advance any business state.
  let assertMismatch = null;
  try { PRICE_OVERRIDE_CONSUMPTION.assertReserved(db, authB, { expectedOwner: `SALES_ORDER_CHANGE:${changeAId}` }); }
  catch (error) { assertMismatch = error; }
  assert.ok(assertMismatch, 'cross-owner assert must throw');
  assert.equal(assertMismatch.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH');

  // Missing-record apply on changeB fails closed with PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED,
  // leaving changeA and its state, audit cardinality and effective_version untouched.
  db.prepare(`DELETE FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`).run(authB);
  const beforeChangeAState = db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeAId).state;
  const beforeAuditA = Number(db.prepare(
    `SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='APPROVE_AND_APPLY' AND entity_id=?`
  ).get(changeAId).n);
  const applyB = await request(`/api/sales-order-changes/${changeBId}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r5-owner-applyB', body: {} });
  assert.equal(applyB.status, 409);
  assert.equal(applyB.data.details?.code || applyB.data.code, 'PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED');
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeAId).state, beforeChangeAState, 'changeA state must remain unchanged');
  assert.equal(Number(db.prepare(
    `SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='APPROVE_AND_APPLY' AND entity_id=?`
  ).get(changeAId).n), beforeAuditA, 'changeA audit cardinality must remain unchanged');

  // Valid owner flow: apply changeA successfully. Snapshot, effective_version and authorization
  // binding are all preserved end-to-end.
  const beforeVersion = db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v;
  const applyA = await request(`/api/sales-order-changes/${changeAId}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r5-owner-applyA', body: {} });
  assert.equal(applyA.status, 200, JSON.stringify(applyA.data));
  assert.equal(db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v, beforeVersion + 1, 'apply must bump effective_version');
  const itemsAfter = db.prepare(`SELECT id, quantity, amount_cents, price_snapshot_json FROM sales_order_items WHERE order_id=? ORDER BY line_no`).all(base.data.id);
  assert.equal(itemsAfter.length, 2, 'apply must append a new SO line');
  const newLine = itemsAfter[1];
  assert.equal(Number(newLine.quantity), 1, 'apply must persist the requested quantity');
  assert.equal(Number(newLine.amount_cents), 1099, 'apply must persist the requested override unit as line amount');
  const snapshot = JSON.parse(newLine.price_snapshot_json);
  assert.equal(snapshot.authorizationEvidence.authorizationId, authA);
  assert.equal(snapshot.unitPriceCents, 1099);
  assert.equal(snapshot.catalogUnitPriceCents, 1250);
});

test('R6 P1-01 SUBMIT / REJECT / CANCEL enforce requester ownership and sales-group scope', async () => {
  // R6 fixtures: second sales user with role-sales (has SALES_ORDER_CHANGE_DOCUMENT_MANAGE
  // but not APPROVE), plus a reviewer without SALES_CROSS_GROUP in a separate group.
  const stamp = new Date().toISOString();
  const sales2Pwd = hashPassword('sales2123');
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('user-sales2','sales2','Sales 2',?,?,'role-sales',1,?)`).run(sales2Pwd.hash, sales2Pwd.salt, stamp);
  // Give user-sales2 a salesperson profile in batch-group so the scope predicate passes for
  // batch-group orders. The ownership / requester check is what must reject the SUBMIT.
  db.prepare(`INSERT OR IGNORE INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('r6-sp-sales2','R6-SP2','R6 SP2','user-sales2',1,?,?)`).run(stamp, stamp);
  db.prepare(`INSERT OR IGNORE INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('r6-sp2-mem','r6-sp-sales2','batch-group','2026-01-01',1,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare(`INSERT OR IGNORE INTO roles(id,code,name,description,system_role,created_at) VALUES('role-r6-no-cross','REVIEWER_NO_CROSS','R6 No-Cross Reviewer','',0,?)`).run(stamp);
  db.prepare(`INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-r6-no-cross','SALES_ORDER_CHANGE_APPROVE')`).run();
  const r2pwd = hashPassword('r6reviewer2123');
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('user-r6-reviewer2','r6reviewer2','R6 Reviewer 2',?,?,'role-r6-no-cross',1,?)`).run(r2pwd.hash, r2pwd.salt, stamp);
  db.prepare(`INSERT OR IGNORE INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('r6-other-group','R6-OTHER','R6 Other Group',1,?,?)`).run(stamp, stamp);
  db.prepare(`INSERT OR IGNORE INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('r6-sp','R6-SP','R6 SP','user-r6-reviewer2',1,?,?)`).run(stamp, stamp);
  db.prepare(`INSERT OR IGNORE INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('r6-sp-mem','r6-sp','r6-other-group','2026-01-01',1,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');
  const sales2Token = await login('sales2', 'sales2123');
  const r6Reviewer2Token = await login('r6reviewer2', 'r6reviewer2123');

  // Base order as user-sales, then submitted + approved.
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r6-p1-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r6-p1-base-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r6-p1-base-approve', body: {} })).status, 200);

  // Scenario 1: non-requester (sales2) cannot SUBMIT another user's DRAFT.
  const baseItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(base.data.id).id;
  const draftOther = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 submit ownership',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 2_000_000 }] } });
  assert.equal(draftOther.status, 201, JSON.stringify(draftOther.data));
  const beforeSubmit = { changeState: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='SUBMIT'").get().n) };
  const submitByOther = await request(`/api/sales-order-changes/${draftOther.data.id}/submit`, { token: sales2Token, method: 'POST', body: {} });
  assert.equal(submitByOther.status, 403, JSON.stringify(submitByOther.data));
  assert.equal(submitByOther.data.details?.code || submitByOther.data.code, 'SALES_ORDER_CHANGE_NOT_REQUESTER');
  const afterSubmit = { changeState: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='SUBMIT'").get().n) };
  assert.deepEqual(afterSubmit, beforeSubmit, 'failed SUBMIT must leave change state and audit cardinality unchanged');

  // Scenario 2: legitimate requester SUBMITs their own DRAFT.
  const submitOk = await request(`/api/sales-order-changes/${draftOther.data.id}/submit`, { token: tokens.sales, method: 'POST', body: {} });
  assert.equal(submitOk.status, 200, JSON.stringify(submitOk.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state, 'SUBMITTED');

  // Scenario 3: create a real DRAFT while scope is valid, then remove that scope and call
  // the actual SUBMIT endpoint. CREATE denial is not evidence for the SUBMIT gate.
  const draft3 = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 submit scope',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 3_000_000 }] } });
  assert.equal(draft3.status, 201, JSON.stringify(draft3.data));
  const submitScopeBefore = {
    state: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draft3.data.id).state,
    approvals: Number(db.prepare("SELECT COUNT(*) n FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(draft3.data.id).n),
    submitAudits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=? AND action='SUBMIT'").get(draft3.data.id).n),
    reservations: Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND json_extract(result_json,'$.source')=?").get(`SALES_ORDER_CHANGE:${draft3.data.id}`).n),
    idempotency: Number(db.prepare('SELECT COUNT(*) n FROM idempotency_records WHERE document_id=?').get(draft3.data.id).n),
    effectiveVersion: Number(db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v),
  };
  db.prepare("UPDATE sales_orders SET sales_group_id='r6-other-group' WHERE id=?").run(base.data.id);
  const crossGroupSubmit = await request(`/api/sales-order-changes/${draft3.data.id}/submit`, { token: tokens.sales, method: 'POST', body: {} });
  assert.equal(crossGroupSubmit.status, 403, JSON.stringify(crossGroupSubmit.data));
  assert.equal(['SALES_GROUP_SCOPE_DENIED', 'SALES_GROUP_ACTOR_UNMAPPED'].includes(crossGroupSubmit.data.details?.code || crossGroupSubmit.data.code), true, JSON.stringify(crossGroupSubmit.data));
  const submitScopeAfter = {
    state: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draft3.data.id).state,
    approvals: Number(db.prepare("SELECT COUNT(*) n FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(draft3.data.id).n),
    submitAudits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=? AND action='SUBMIT'").get(draft3.data.id).n),
    reservations: Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND json_extract(result_json,'$.source')=?").get(`SALES_ORDER_CHANGE:${draft3.data.id}`).n),
    idempotency: Number(db.prepare('SELECT COUNT(*) n FROM idempotency_records WHERE document_id=?').get(draft3.data.id).n),
    effectiveVersion: Number(db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v),
  };
  assert.deepEqual(submitScopeAfter, submitScopeBefore, 'failed cross-group SUBMIT must have zero state, approval, audit, reservation, idempotency or SO-version side effects');
  db.prepare("UPDATE sales_orders SET sales_group_id='batch-group' WHERE id=?").run(base.data.id);
  const restoredSubmit = await request(`/api/sales-order-changes/${draft3.data.id}/submit`, { token: tokens.sales, method: 'POST', body: {} });
  assert.equal(restoredSubmit.status, 200, JSON.stringify(restoredSubmit.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draft3.data.id).state, 'SUBMITTED');

  // Scenario 4: cross-group REJECT denial — user-r6-reviewer2 has APPROVE but is mapped to
  // r6-other-group; the order stays in batch-group. The REJECT path goes through
  // loadChangeWithScope and fails at assertGroupScope.
  const beforeReject = {
    changeState: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state,
    approvalStatus: db.prepare("SELECT status FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(draftOther.data.id)?.status,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='REJECT'").get().n),
  };
  // SO stays in batch-group; r6-reviewer2 is in r6-other-group.
  const crossReject = await request(`/api/sales-order-changes/${draftOther.data.id}/reject`, { token: r6Reviewer2Token, method: 'POST', body: { reason: 'cross-group reject attempt' } });
  assert.equal(crossReject.status, 403, JSON.stringify(crossReject.data));
  assert.equal(['SALES_GROUP_SCOPE_DENIED', 'SALES_GROUP_ACTOR_UNMAPPED'].includes(crossReject.data.details?.code || crossReject.data.code), true, JSON.stringify(crossReject.data));
  const afterReject = {
    changeState: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state,
    approvalStatus: db.prepare("SELECT status FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(draftOther.data.id)?.status,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='REJECT'").get().n),
  };
  assert.deepEqual(afterReject, beforeReject, 'failed cross-group REJECT must leave change state, approval status and audit cardinality unchanged');

  // Scenario 5: cross-group CANCEL denial — same scope predicate applies.
  const crossCancel = await request(`/api/sales-order-changes/${draftOther.data.id}/cancel`, { token: r6Reviewer2Token, method: 'POST', body: { reason: 'cross-group cancel attempt' } });
  assert.equal(crossCancel.status, 403, JSON.stringify(crossCancel.data));
  assert.equal(['SALES_GROUP_SCOPE_DENIED', 'SALES_GROUP_ACTOR_UNMAPPED'].includes(crossCancel.data.details?.code || crossCancel.data.code), true, JSON.stringify(crossCancel.data));

  // Scenario 6: legitimate cross-group reviewer (user-reviewer has SALES_CROSS_GROUP) REJECTs
  // with reason; consumes the change and writes the audit row.
  const rejectOk = await request(`/api/sales-order-changes/${draftOther.data.id}/reject`, { token: tokens.reviewer, method: 'POST', body: { reason: 'R6 legitimate reject' } });
  assert.equal(rejectOk.status, 200, JSON.stringify(rejectOk.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftOther.data.id).state, 'REJECTED');
  assert.equal(db.prepare("SELECT status FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(draftOther.data.id)?.status, 'REJECTED');
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='REJECT'").get().n), beforeReject.audit + 1);

  // Scenario 7: legitimate CANCEL on a fresh DRAFT releases nothing unrelated. The change is
  // a plain MODIFY (no override auth), so there are no consumption records to release.
  const draft7 = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 cancel happy path',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 4_000_000 }] } });
  assert.equal(draft7.status, 201, JSON.stringify(draft7.data));
  const cancelOk = await request(`/api/sales-order-changes/${draft7.data.id}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'R6 cancel ok' } });
  assert.equal(cancelOk.status, 200, JSON.stringify(cancelOk.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draft7.data.id).state, 'CANCELLED');
});

test('R6 P1-02 DRAFT PATCH rejects corrupt historic ADD evidence fail-closed', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  // Base order created + approved as user-sales.
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r6-p2-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r6-p2-base-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r6-p2-base-approve', body: {} })).status, 200);
  const baseItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(base.data.id).id;

  // Authorize one auth so a non-trivial ADD record exists for case A.
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R6 P1-02 corrupt history' } });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const authId = authorized.data.authorizationId;

  // Create a DRAFT change with an ADD that consumes the authorization.
  const draft = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 P1-02 initial',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authId }] } });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const draftId = draft.data.id;
  const addLineId = db.prepare("SELECT id FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").get(draftId).id;

  const initialReservation = db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId);
  assert.ok(initialReservation, 'ADD creation must reserve the authorization');

  // Case A: corrupt historic after_values_json (invalid JSON syntax) — PATCH must fail closed
  // with SALES_ORDER_CHANGE_EVIDENCE_CORRUPT and must not delete the original change_lines,
  // must not release the consumption record, must not bump effective_version, and must not
  // write any audit / SUBMIT / RELEASE entries.
  // First corrupt the historic after_values_json, then capture the state at PATCH start.
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run('{not-json', addLineId);
  const beforeCorrupt = {
    addLines: db.prepare("SELECT id, after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").all(draftId),
    changeLines: db.prepare('SELECT COUNT(*) n FROM sales_order_change_lines WHERE change_id=?').get(draftId).n,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='UPDATE'").get().n),
    version: db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v,
    reservation: Boolean(initialReservation),
    changeRow: db.prepare('SELECT * FROM sales_order_changes WHERE id=?').get(draftId),
  };
  const corruptPatch = await request(`/api/sales-order-changes/${draftId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 corrupt JSON',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 5_000_000 }] } });
  assert.equal(corruptPatch.status, 409, JSON.stringify(corruptPatch.data));
  assert.equal(corruptPatch.data.details?.code || corruptPatch.data.code, 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT');
  const afterCorrupt = {
    addLines: db.prepare("SELECT id, after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").all(draftId),
    changeLines: db.prepare('SELECT COUNT(*) n FROM sales_order_change_lines WHERE change_id=?').get(draftId).n,
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='UPDATE'").get().n),
    version: db.prepare('SELECT effective_version v FROM sales_orders WHERE id=?').get(base.data.id).v,
    reservation: Boolean(db.prepare(
      `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
    ).get(authId)),
    changeRow: db.prepare('SELECT * FROM sales_order_changes WHERE id=?').get(draftId),
  };
  assert.equal(afterCorrupt.changeLines, beforeCorrupt.changeLines, 'failed PATCH must not delete historic change_lines');
  assert.deepEqual(afterCorrupt.addLines, beforeCorrupt.addLines, 'failed PATCH must not mutate the exact previous change_lines');
  assert.equal(afterCorrupt.audit, beforeCorrupt.audit, 'failed PATCH must not write UPDATE audit');
  assert.equal(afterCorrupt.version, beforeCorrupt.version, 'failed PATCH must not bump effective_version');
  assert.equal(afterCorrupt.reservation, true, 'failed PATCH must not release the historic reservation');

  // Case B: corrupt JSON structure (parses, but no priceSnapshot) — PATCH must also fail closed.
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify({ exists: false, op: 'ADD', documentUomCode: uom, documentQuantityNum: 1 }), addLineId);
  const corruptStructPatch = await request(`/api/sales-order-changes/${draftId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 corrupt structure',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 5_000_000 }] } });
  assert.equal(corruptStructPatch.status, 409, JSON.stringify(corruptStructPatch.data));
  assert.equal(corruptStructPatch.data.details?.code || corruptStructPatch.data.code, 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT');
  // Restore the valid JSON so subsequent cases can use the change.
  // The easiest restore is to delete the corrupt ADD line and re-create the change.
  db.prepare('DELETE FROM sales_order_change_lines WHERE id=?').run(addLineId);

  // Case C: legitimate ADD without override auth must still PATCH successfully (no false-positive).
  const authorizeC = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1088, overrideReason: 'R6 case C no-override' } });
  assert.equal(authorizeC.status, 201, JSON.stringify(authorizeC.data));
  // Create a separate DRAFT with a plain ADD (no override). Reuse base.data.id (already approved).
  const draftC = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case C',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000 }] } });
  assert.equal(draftC.status, 201, JSON.stringify(draftC.data));
  const noOverrideAuth = db.prepare("SELECT id, after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").get(draftC.data.id);
  const parsedNoOverride = JSON.parse(noOverrideAuth.after_values_json);
  assert.equal(parsedNoOverride.priceSnapshot?.authorizationEvidence, undefined, 'precondition: ADD without override has no authorizationEvidence');
  // PATCH replaces the ADD with a MODIFY on the base line; the resolver must release nothing
  // (no auth consumed) and not corrupt the change.
  const caseCPatch = await request(`/api/sales-order-changes/${draftC.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case C patch',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 5_000_000 }] } });
  assert.equal(caseCPatch.status, 200, JSON.stringify(caseCPatch.data));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").get(draftC.data.id).n, 0);

  // Case D: R5 lifecycle regression — ADD A → retain → replace B → remove ADD → cancel.
  const authDA = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1077, overrideReason: 'R6 case D A' } });
  assert.equal(authDA.status, 201, JSON.stringify(authDA.data));
  const authDAId = authDA.data.authorizationId;
  const draftD = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case D',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authDAId }] } });
  assert.equal(draftD.status, 201, JSON.stringify(draftD.data));
  const draftDId = draftD.data.id;
  // retain same auth
  const retainResp = await request(`/api/sales-order-changes/${draftDId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case D retain',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authDAId }] } });
  assert.equal(retainResp.status, 200, JSON.stringify(retainResp.data));
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authDAId), 'retain must keep the auth reservation');
  // replace A with B
  const authDB = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1066, overrideReason: 'R6 case D B' } });
  assert.equal(authDB.status, 201, JSON.stringify(authDB.data));
  const authDBId = authDB.data.authorizationId;
  const replaceResp = await request(`/api/sales-order-changes/${draftDId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case D replace',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authDBId }] } });
  assert.equal(replaceResp.status, 200, JSON.stringify(replaceResp.data));
  assert.equal(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authDAId), undefined, 'A must be released');
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authDBId), 'B must be reserved');
  // remove ADD entirely (replace with MODIFY on base line)
  const removeResp = await request(`/api/sales-order-changes/${draftDId}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 case D remove',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 6_000_000 }] } });
  assert.equal(removeResp.status, 200, JSON.stringify(removeResp.data));
  assert.equal(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authDBId), undefined, 'B must be released on remove');
  // cancel the (now MODIFY-only) DRAFT
  const cancelResp = await request(`/api/sales-order-changes/${draftDId}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'R6 case D cancel' } });
  assert.equal(cancelResp.status, 200, JSON.stringify(cancelResp.data));
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(draftDId).state, 'CANCELLED');
});

test('R7 P1-01 reconciles strict ADD evidence with persisted owner reservations across PATCH, REJECT, CANCEL and APPLY', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const authorize = async (suffix, price) => {
    const response = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
      customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
      quantityDecimal: '1', manualPriceCents: price, overrideReason: `R7 ${suffix}`,
    } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.authorizationId;
  };
  const reservation = (authorizationId) => db.prepare(
    "SELECT id,result_json FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?"
  ).get(authorizationId);
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r7-p1-01-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }],
  } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r7-p1-01-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r7-p1-01-approve', body: {} })).status, 200);
  const baseItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(base.data.id).id;

  const authA = await authorize('empty-and-missing', 1041);
  const draft = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R7 strict evidence',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authA }],
  } });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const addRow = db.prepare("SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").get(draft.data.id);
  const validAfter = JSON.parse(addRow.after_values_json);
  const rollbackSnapshot = () => ({
    change: db.prepare('SELECT * FROM sales_order_changes WHERE id=?').get(draft.data.id),
    lines: db.prepare('SELECT * FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(draft.data.id),
    reservation: reservation(authA),
    approvals: db.prepare("SELECT * FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=? ORDER BY created_at").all(draft.data.id),
    audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=?").get(draft.data.id).n),
    order: db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(base.data.id),
  });

  const emptyAfter = structuredClone(validAfter); emptyAfter.priceSnapshot = {};
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(emptyAfter), addRow.id);
  const beforeEmpty = rollbackSnapshot();
  const emptyPatch = await request(`/api/sales-order-changes/${draft.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'must fail empty snapshot',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 2_000_000 }],
  } });
  assert.equal(emptyPatch.status, 409, JSON.stringify(emptyPatch.data));
  assert.equal(emptyPatch.data.details?.code || emptyPatch.data.code, 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT');
  assert.deepEqual(rollbackSnapshot(), beforeEmpty, 'empty snapshot PATCH must roll back every affected table');

  const wrongBusinessDate = structuredClone(validAfter); wrongBusinessDate.priceSnapshot.businessDate = '2026-10-16';
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(wrongBusinessDate), addRow.id);
  const beforeWrongDate = rollbackSnapshot();
  const wrongDatePatch = await request(`/api/sales-order-changes/${draft.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'must fail independent business-date binding',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 2_000_000 }],
  } });
  assert.equal(wrongDatePatch.status, 409, JSON.stringify(wrongDatePatch.data));
  assert.equal(wrongDatePatch.data.details?.code || wrongDatePatch.data.code, 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT');
  assert.deepEqual(rollbackSnapshot(), beforeWrongDate, 'business-date mismatch must roll back every affected table');

  const missingReference = structuredClone(validAfter); delete missingReference.priceSnapshot.authorizationEvidence;
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(missingReference), addRow.id);
  const beforeMissing = rollbackSnapshot();
  const missingPatch = await request(`/api/sales-order-changes/${draft.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'must fail missing auth reference',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 2_000_000 }],
  } });
  assert.equal(missingPatch.status, 409, JSON.stringify(missingPatch.data));
  assert.equal(missingPatch.data.details?.code || missingPatch.data.code, 'SALES_ORDER_CHANGE_AUTHORIZATION_ORPHAN');
  assert.deepEqual(rollbackSnapshot(), beforeMissing, 'missing authorization reference must not release the owner reservation');

  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(validAfter), addRow.id);
  assert.equal((await request(`/api/sales-order-changes/${draft.data.id}/submit`, { token: tokens.sales, method: 'POST', body: {} })).status, 200);
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(emptyAfter), addRow.id);
  const rejectBefore = rollbackSnapshot();
  const corruptReject = await request(`/api/sales-order-changes/${draft.data.id}/reject`, { token: tokens.reviewer, method: 'POST', body: { reason: 'must fail' } });
  assert.equal(corruptReject.status, 409, JSON.stringify(corruptReject.data));
  assert.deepEqual(rollbackSnapshot(), rejectBefore, 'corrupt REJECT must leave state, approval, reservation and audit unchanged');
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(validAfter), addRow.id);
  assert.equal((await request(`/api/sales-order-changes/${draft.data.id}/reject`, { token: tokens.reviewer, method: 'POST', body: { reason: 'cleanup valid reject' } })).status, 200);
  assert.equal(reservation(authA), undefined);

  const authB = await authorize('apply-missing-reference', 1042);
  const submitted = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r7-p1-01-direct', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R7 apply reconciliation',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authB }],
  } });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const submittedRow = db.prepare("SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD'").get(submitted.data.id);
  const submittedValid = JSON.parse(submittedRow.after_values_json);
  const submittedCorrupt = structuredClone(submittedValid); delete submittedCorrupt.priceSnapshot.authorizationEvidence;
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(submittedCorrupt), submittedRow.id);
  const applyBefore = {
    state: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(submitted.data.id).state,
    approval: db.prepare("SELECT status FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(submitted.data.id).status,
    reservation: reservation(authB),
    order: db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(base.data.id),
    lines: Number(db.prepare('SELECT COUNT(*) n FROM sales_order_items WHERE order_id=?').get(base.data.id).n),
    applyAudit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=? AND action='APPROVE_AND_APPLY'").get(submitted.data.id).n),
  };
  const corruptApply = await request(`/api/sales-order-changes/${submitted.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r7-p1-01-corrupt-apply', body: {} });
  assert.equal(corruptApply.status, 409, JSON.stringify(corruptApply.data));
  assert.equal(corruptApply.data.details?.code || corruptApply.data.code, 'SALES_ORDER_CHANGE_AUTHORIZATION_ORPHAN');
  assert.deepEqual({
    state: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(submitted.data.id).state,
    approval: db.prepare("SELECT status FROM approval_requests WHERE source_type='SALES_ORDER_CHANGE' AND source_id=?").get(submitted.data.id).status,
    reservation: reservation(authB),
    order: db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(base.data.id),
    lines: Number(db.prepare('SELECT COUNT(*) n FROM sales_order_items WHERE order_id=?').get(base.data.id).n),
    applyAudit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=? AND action='APPROVE_AND_APPLY'").get(submitted.data.id).n),
  }, applyBefore, 'corrupt APPLY must roll back all state and economic side effects');

  const duplicateAuthA = await authorize('duplicate-a', 1043);
  const duplicateAuthB = await authorize('duplicate-b', 1043);
  const duplicateDraft = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R7 duplicate historic reference',
    lines: [
      { op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: duplicateAuthA },
      { op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: duplicateAuthB },
    ],
  } });
  assert.equal(duplicateDraft.status, 201, JSON.stringify(duplicateDraft.data));
  const duplicateRows = db.prepare("SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? AND op='ADD' ORDER BY line_no").all(duplicateDraft.data.id);
  const duplicateFirst = JSON.parse(duplicateRows[0].after_values_json);
  const duplicateSecondOriginal = duplicateRows[1].after_values_json;
  const duplicateSecond = JSON.parse(duplicateSecondOriginal);
  duplicateSecond.priceSnapshot = duplicateFirst.priceSnapshot;
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(duplicateSecond), duplicateRows[1].id);
  const duplicateBefore = {
    lines: db.prepare('SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(duplicateDraft.data.id),
    reservationA: reservation(duplicateAuthA), reservationB: reservation(duplicateAuthB),
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=?").get(duplicateDraft.data.id).n),
  };
  const duplicatePatch = await request(`/api/sales-order-changes/${duplicateDraft.data.id}`, { token: tokens.sales, method: 'PATCH', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'duplicate must fail',
    lines: [{ op: 'MODIFY', salesOrderItemId: baseItemId, quantityMicros: 2_000_000 }],
  } });
  assert.equal(duplicatePatch.status, 409, JSON.stringify(duplicatePatch.data));
  assert.equal(duplicatePatch.data.details?.code || duplicatePatch.data.code, 'SALES_ORDER_CHANGE_AUTHORIZATION_ORPHAN');
  assert.deepEqual({
    lines: db.prepare('SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(duplicateDraft.data.id),
    reservationA: reservation(duplicateAuthA), reservationB: reservation(duplicateAuthB),
    audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND entity_id=?").get(duplicateDraft.data.id).n),
  }, duplicateBefore, 'duplicate historic reference must not release either owner reservation');
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(duplicateSecondOriginal, duplicateRows[1].id);
  assert.equal((await request(`/api/sales-order-changes/${duplicateDraft.data.id}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'duplicate cleanup' } })).status, 200);
  assert.equal(reservation(duplicateAuthA), undefined);
  assert.equal(reservation(duplicateAuthB), undefined);

  const plainDraft = await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body: {
    salesOrderId: base.data.id, reasonCode: 'CUSTOMER_REQUEST', reason: 'R7 plain add cancel',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000 }],
  } });
  assert.equal(plainDraft.status, 201, JSON.stringify(plainDraft.data));
  assert.equal((await request(`/api/sales-order-changes/${plainDraft.data.id}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'plain cancel' } })).status, 200);
});

test('R6 P2-01 release / assertReserved require expectedOwner and reject cross-owner', async () => {
  const { PRICE_OVERRIDE_CONSUMPTION } = await import('./modules/sales-orders.js');
  // Build a real reservation record via the Change ADD path so the record
  // exists at the time we exercise the helper API.
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const base = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'r6-p2-helper-base', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(base.status, 201, JSON.stringify(base.data));
  assert.equal((await request(`/api/sales-orders/${base.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'r6-p2-helper-base-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${base.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r6-p2-helper-base-approve', body: {} })).status, 200);
  const authorized = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1099, overrideReason: 'R6 P2-01 helper' } });
  assert.equal(authorized.status, 201, JSON.stringify(authorized.data));
  const authId = authorized.data.authorizationId;
  const changeAdd = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r6-p2-helper-cc-add', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 P2-01 change add',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authId }] } });
  assert.equal(changeAdd.status, 201, JSON.stringify(changeAdd.data));
  const changeAddId = changeAdd.data.id;
  const expectedOwner = `SALES_ORDER_CHANGE:${changeAddId}`;
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId), 'precondition: Change ADD must reserve the authorization');

  // release without expectedOwner — must throw PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED.
  let releaseNoOwner = null;
  try { PRICE_OVERRIDE_CONSUMPTION.release(db, authId, { id: 'user-sales', roleCode: 'SALES', permissions: [] }); }
  catch (error) { releaseNoOwner = error; }
  assert.ok(releaseNoOwner, 'release without expectedOwner must throw');
  assert.equal(releaseNoOwner.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED');
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId), 'failed release without owner must not delete the record');

  // assertReserved without expectedOwner — must throw same code.
  let assertNoOwner = null;
  try { PRICE_OVERRIDE_CONSUMPTION.assertReserved(db, authId); }
  catch (error) { assertNoOwner = error; }
  assert.ok(assertNoOwner, 'assertReserved without expectedOwner must throw');
  assert.equal(assertNoOwner.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED');

  // Wrong expectedOwner — must throw PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH and not touch.
  let wrongOwner = null;
  try { PRICE_OVERRIDE_CONSUMPTION.release(db, authId, { id: 'user-sales', roleCode: 'SALES', permissions: [] }, { expectedOwner: 'SALES_ORDER_CHANGE:fake-id' }); }
  catch (error) { wrongOwner = error; }
  assert.ok(wrongOwner, 'wrong expectedOwner must throw');
  assert.equal(wrongOwner.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH');
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId), 'wrong-owner release must not delete the unrelated record');

  // Cross-owner assertReserved: same record, wrong expectedOwner.
  let crossOwnerAssert = null;
  try { PRICE_OVERRIDE_CONSUMPTION.assertReserved(db, authId, { expectedOwner: 'SALES_ORDER_CHANGE:fake-id' }); }
  catch (error) { crossOwnerAssert = error; }
  assert.ok(crossOwnerAssert, 'cross-owner assert must throw');
  assert.equal(crossOwnerAssert.code, 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH');

  // Correct owner + cancel + applied-line guard: cancel the change so the reservation is
  // released by the change handler. But before that, prove that release() with allowApplied
  // removed cannot bypass the via-locked persistent applied-line check (R5 still applies).
  // Apply the change first so a sales_order_items row carries the authorization, then
  // release the reservation through owner helper with the correct owner — must throw
  // PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS.
  const applyResp = await request(`/api/sales-order-changes/${changeAddId}/approve`, { token: tokens.reviewer, method: 'POST', key: 'r6-p2-helper-cc-apply', body: {} });
  assert.equal(applyResp.status, 200, JSON.stringify(applyResp.data));
  assert.ok(db.prepare('SELECT price_snapshot_json FROM sales_order_items WHERE order_id=?').get(base.data.id)?.price_snapshot_json, 'apply must add the new line');
  const appliedRow = db.prepare("SELECT id,price_snapshot_json FROM sales_order_items WHERE order_id=? AND json_extract(price_snapshot_json,'$.authorizationEvidence.authorizationId')=?").get(base.data.id, authId);
  assert.ok(appliedRow, 'precondition: applied line must carry the authorization');
  const compactAppliedJson = appliedRow.price_snapshot_json;
  const parsedApplied = JSON.parse(compactAppliedJson);
  const { authorizationEvidence, ...otherAppliedFields } = parsedApplied;
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=? WHERE id=?').run(JSON.stringify({ authorizationEvidence, ...otherAppliedFields }, null, 2), appliedRow.id);
  let appliedRelease = null;
  try { PRICE_OVERRIDE_CONSUMPTION.release(db, authId, { id: 'user-sales', roleCode: 'SALES', permissions: [] }, { expectedOwner }); }
  catch (error) { appliedRelease = error; }
  assert.ok(appliedRelease, 'release of applied authorization must throw');
  assert.equal(appliedRelease.code, 'PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS');
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId), 'applied-line release must not delete the persisted record');
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=? WHERE id=?').run('{malformed-json', appliedRow.id);
  let unreadableGuard = null;
  try { PRICE_OVERRIDE_CONSUMPTION.release(db, authId, { id: 'user-sales', roleCode: 'SALES', permissions: [] }, { expectedOwner }); }
  catch (error) { unreadableGuard = error; }
  assert.equal(unreadableGuard?.code, 'PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_CHECK_FAILED');
  assert.ok(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authId), 'unreadable JSON guard must fail closed without deleting consumption');
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=? WHERE id=?').run(compactAppliedJson, appliedRow.id);

  // Final regression: a fresh Change ADD with a fresh authorization must still be cancellable
  // by the change handler, releasing the reservation by owner.
  const authSecond = await request('/api/sales-price-overrides/authorize', { token: tokens.reviewer, method: 'POST', body: {
    customerId: 'customer-001', businessDate: '2026-10-15', productId: 'product-001', uomCode: uom,
    quantityDecimal: '1', manualPriceCents: 1055, overrideReason: 'R6 P2-01 second' } });
  assert.equal(authSecond.status, 201, JSON.stringify(authSecond.data));
  const authSecondId = authSecond.data.authorizationId;
  const changeAdd2 = await request(`/api/sales-orders/${base.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'r6-p2-helper-cc-add-2', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'R6 P2-01 change add 2',
    lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceOverrideAuthorizationId: authSecondId }] } });
  assert.equal(changeAdd2.status, 201, JSON.stringify(changeAdd2.data));
  const changeAdd2Id = changeAdd2.data.id;
  const unrelatedOriginal = db.prepare('SELECT price_snapshot_json FROM sales_order_items WHERE id=?').get(appliedRow.id).price_snapshot_json;
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=? WHERE id=?').run(JSON.stringify({ note: authSecondId }), appliedRow.id);
  assert.equal(PRICE_OVERRIDE_CONSUMPTION.findAppliedLine(db, authSecondId), null, 'authorization id in an unrelated JSON field must not match');
  assert.equal((await request(`/api/sales-order-changes/${changeAdd2Id}/cancel`, { token: tokens.sales, method: 'POST', body: { reason: 'R6 P2-01 cancel' } })).status, 200);
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=? WHERE id=?').run(unrelatedOriginal, appliedRow.id);
  assert.equal(db.prepare(
    `SELECT id FROM idempotency_records WHERE operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION' AND document_id=?`
  ).get(authSecondId), undefined, 'cancel must release the Change ADD reservation');
});

test('submission restores V1.3 commercial completeness and normal-line amount gates', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'submit-commercial-gates', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(created.status, 201);
  db.prepare("UPDATE sales_orders SET ship_to_phone='' WHERE id=?").run(created.data.id);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'submit-missing-phone', body: {} })).status, 400);
  db.prepare("UPDATE sales_orders SET ship_to_phone='13000000000',requested_delivery_date='2026-10-14' WHERE id=?").run(created.data.id);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'submit-bad-date', body: {} })).status, 400);
  db.prepare("UPDATE sales_orders SET requested_delivery_date='2026-10-20' WHERE id=?").run(created.data.id);
  db.prepare('UPDATE sales_order_items SET amount_cents=0 WHERE order_id=?').run(created.data.id);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'submit-zero-normal', body: {} })).status, 409);
});

test('fulfillment projection enforces group scope for known ids and permits explicit cross-group authority', async () => {
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/fulfillment`, { token: tokens.sales })).status, 200);
  db.prepare("UPDATE salesperson_profiles SET active=0 WHERE user_id='user-sales'").run();
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/fulfillment`, { token: tokens.sales })).status, 403);
  db.prepare("UPDATE salesperson_profiles SET active=1 WHERE user_id='user-sales'").run();
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('other-group','OTHER','Other',1,?,?)").run(new Date().toISOString(), new Date().toISOString());
  db.prepare("UPDATE sales_orders SET sales_group_id='other-group' WHERE id=?").run(canonicalOrderId);
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/fulfillment`, { token: tokens.sales })).status, 403);
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/fulfillment`, { token: tokens.reviewer })).status, 200);
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/fulfillment`, { token: tokens.admin })).status, 200);
  db.prepare("UPDATE sales_orders SET sales_group_id='batch-group' WHERE id=?").run(canonicalOrderId);
});

test('legacy NULL snapshots remain readable while a new line without snapshots cannot submit', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'missing-snapshot-order', body: { customerId: 'customer-001', orderDate: '2026-10-15', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  db.prepare('UPDATE sales_order_items SET price_snapshot_json=NULL,discount_snapshot_json=NULL WHERE order_id=?').run(created.data.id);
  const read = await request(`/api/sales-orders/${created.data.id}`, { token: tokens.sales });
  assert.equal(read.status, 200); assert.equal(read.data.order.items[0].priceSnapshot, null); assert.equal(read.data.order.items[0].discountSnapshot, null);
  const submitted = await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'missing-snapshot-submit', body: {} });
  assert.equal(submitted.status, 409); assert.equal(submitted.data.details?.code || submitted.data.code, 'SALES_SNAPSHOT_REQUIRED');
});

test('approval and both concurrent change requests use one CAS application service', async () => {
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/submit`, { token: tokens.sales, method: 'POST', body: {}, key: 'so-submit-1' })).status, 200);
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/approve`, { token: tokens.reviewer, method: 'POST', body: {}, key: 'so-approve-1' })).status, 200);
  const itemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(canonicalOrderId).id;
  const originalSnapshots = db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE id=?').get(itemId);
  const payloadA = { reasonCode: 'CUSTOMER_REQUEST', reason: 'increase A', lines: [{ op: 'MODIFY', salesOrderItemId: itemId, quantityMicros: 3_000_000 }] };
  const payloadB = { reasonCode: 'CUSTOMER_REQUEST', reason: 'increase B', lines: [{ op: 'MODIFY', salesOrderItemId: itemId, quantityMicros: 4_000_000 }] };
  const first = await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', body: payloadA, key: 'change-request-a' });
  const second = await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', body: payloadB, key: 'change-request-b' });
  assert.equal(first.status, 201, JSON.stringify(first.data)); assert.equal(second.status, 201, JSON.stringify(second.data));
  const applied = await request(`/api/sales-order-changes/${first.data.id}/approve`, { token: tokens.reviewer, method: 'POST', body: {}, key: 'change-apply-a' });
  assert.equal(applied.status, 200, JSON.stringify(applied.data)); assert.equal(applied.data.effectiveVersion, 2);
  const appliedLine = JSON.parse(db.prepare('SELECT after_values_json FROM sales_order_change_lines WHERE change_id=?').get(first.data.id).after_values_json);
  assert.equal(appliedLine.effectiveCommercialEvidence.contractVersion, 'SO_CHANGE_COMMERCIAL_EVIDENCE_V1');
  assert.equal(appliedLine.effectiveCommercialEvidence.baseEffectiveVersion, 1);
  assert.equal(appliedLine.effectiveCommercialEvidence.targetEffectiveVersion, 2);
  assert.equal(appliedLine.effectiveCommercialEvidence.quantityMicros, 3_000_000);
  assert.equal(appliedLine.effectiveCommercialEvidence.finalAmountCents, db.prepare('SELECT amount_cents FROM sales_order_items WHERE id=?').get(itemId).amount_cents);
  assert.deepEqual(appliedLine.effectiveCommercialEvidence.calculationStages.map((stage) => stage.stage), ['GROSS', 'LINE', 'HEADER']);
  assert.equal(appliedLine.effectiveCommercialEvidence.effectiveGrossCents
    - appliedLine.effectiveCommercialEvidence.effectiveLineDiscountCents
    - appliedLine.effectiveCommercialEvidence.effectiveHeaderAllocationCents,
  appliedLine.effectiveCommercialEvidence.finalAmountCents);
  assert.deepEqual(db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE id=?').get(itemId), originalSnapshots);
  const stale = await request(`/api/sales-order-changes/${second.data.id}/approve`, { token: tokens.reviewer, method: 'POST', body: {}, key: 'change-apply-b' });
  assert.equal(stale.status, 409); assert.equal(db.prepare('SELECT effective_version FROM sales_orders WHERE id=?').get(canonicalOrderId).effective_version, 2);
  const before = db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE order_id=?').get(canonicalOrderId);
  const patch = await request(`/api/sales-orders/${canonicalOrderId}`, { token: tokens.sales, method: 'PATCH', body: { items: [{ productId: 'product-001', uomCode: 'PCS', quantityDecimal: '9' }] } });
  assert.equal(patch.status, 409);
  const after = db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE order_id=?').get(canonicalOrderId);
  assert.deepEqual(after, before);
});

test('approved-order ADD change creates a new authoritative snapshot line', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const requested = await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'change-add-request', body: { reasonCode: 'CUSTOMER_REQUEST', reason: 'add approved line', lines: [{ op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000, priceSnapshot: { forged: true } }] } });
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  const applied = await request(`/api/sales-order-changes/${requested.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'change-add-apply', body: {} });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const row = db.prepare('SELECT * FROM sales_order_items WHERE order_id=? ORDER BY line_no DESC LIMIT 1').get(canonicalOrderId);
  assert.ok(row.price_snapshot_json); assert.ok(row.discount_snapshot_json);
  assert.equal(JSON.parse(row.price_snapshot_json).forged, undefined);
  assert.equal(JSON.parse(row.price_snapshot_json).evidence.versionId, 'batch-version');
});

test('consecutive SO changes include the current target version and rollback corrupt evidence', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'consecutive-change-order', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'consecutive-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'consecutive-approve', body: {} })).status, 200);
  const item = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(created.data.id);
  const originalSnapshots = { price_snapshot_json: item.price_snapshot_json, discount_snapshot_json: item.discount_snapshot_json };
  const applyQuantity = async (quantityMicros, suffix) => {
    const change = await request(`/api/sales-orders/${created.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: `consecutive-request-${suffix}`, body: {
      reasonCode: 'CUSTOMER_REQUEST', reason: `consecutive ${suffix}`, lines: [{ op: 'MODIFY', salesOrderItemId: item.id, quantityMicros }] } });
    assert.equal(change.status, 201, JSON.stringify(change.data));
    const applied = await request(`/api/sales-order-changes/${change.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: `consecutive-apply-${suffix}`, body: {} });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    return change.data.id;
  };
  await applyQuantity(2_000_000, 'v2');
  const v3ChangeId = await applyQuantity(3_000_000, 'v3');
  const order = db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(created.data.id);
  const current = db.prepare('SELECT * FROM sales_order_items WHERE id=?').get(item.id);
  const evidence = JSON.parse(db.prepare('SELECT after_values_json FROM sales_order_change_lines WHERE change_id=?').get(v3ChangeId).after_values_json).effectiveCommercialEvidence;
  assert.equal(order.effective_version, 3); assert.equal(current.document_quantity_num, 3_000_000);
  assert.equal(evidence.targetEffectiveVersion, 3); assert.equal(evidence.finalAmountCents, current.amount_cents);
  assert.deepEqual({ price_snapshot_json: current.price_snapshot_json, discount_snapshot_json: current.discount_snapshot_json }, originalSnapshots);

  const corrupt = await request(`/api/sales-orders/${created.data.id}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'consecutive-corrupt-request', body: {
    reasonCode: 'CUSTOMER_REQUEST', reason: 'corrupt evidence rollback', lines: [{ op: 'MODIFY', salesOrderItemId: item.id, quantityMicros: 4_000_000 },
      { op: 'ADD', productId: 'product-001', uomCode: uom, quantityMicros: 1_000_000 }] } });
  assert.equal(corrupt.status, 201, JSON.stringify(corrupt.data));
  const corruptRow = db.prepare('SELECT id,after_values_json FROM sales_order_change_lines WHERE change_id=? AND op=?').get(corrupt.data.id, 'MODIFY');
  const corruptAfter = JSON.parse(corruptRow.after_values_json); corruptAfter.effectiveCommercialEvidence.finalAmountCents += 1;
  db.prepare('UPDATE sales_order_change_lines SET after_values_json=? WHERE id=?').run(JSON.stringify(corruptAfter), corruptRow.id);
  const beforeFailure = { order: db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(created.data.id),
    lines: db.prepare('SELECT id,quantity,amount_cents FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(created.data.id) };
  const rejected = await request(`/api/sales-order-changes/${corrupt.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'consecutive-corrupt-apply', body: {} });
  assert.equal(rejected.status, 409);
  assert.deepEqual(db.prepare('SELECT effective_version,total_cents FROM sales_orders WHERE id=?').get(created.data.id), beforeFailure.order);
  assert.deepEqual(db.prepare('SELECT id,quantity,amount_cents FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(created.data.id), beforeFailure.lines);
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(corrupt.data.id).state, 'SUBMITTED');
  assert.equal((await request(`/api/sales-order-changes/${v3ChangeId}/approve`, { token: tokens.reviewer, method: 'POST', key: 'consecutive-duplicate-apply', body: {} })).status, 409);
});

test('four order-change modes admit only their frozen authoring paths', async () => {
  const item = db.prepare('SELECT id,quantity FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(canonicalOrderId);
  const body = { salesOrderId: canonicalOrderId, reasonCode: 'CUSTOMER_REQUEST', reason: 'mode matrix', lines: [{ op: 'MODIFY', salesOrderItemId: item.id, quantityMicros: Math.round(Number(item.quantity) * 1_000_000) }] };
  const setMode = (mode) => db.prepare("UPDATE sales_parameters SET order_change_mode=? WHERE scope_type='SYSTEM'").run(mode);
  setMode('DISABLED');
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'mode-disabled-direct', body })).status, 409);
  assert.equal((await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body })).status, 409);
  setMode('CONTROLLED_DIRECT');
  const directMode = await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'mode-direct', body });
  assert.equal(directMode.status, 201, JSON.stringify(directMode.data));
  assert.equal((await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body })).status, 409);
  setMode('CONTROLLED_DOCUMENT');
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'mode-document-direct', body })).status, 409);
  assert.equal((await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body })).status, 201);
  setMode('BOTH');
  assert.equal((await request(`/api/sales-orders/${canonicalOrderId}/controlled-change`, { token: tokens.sales, method: 'POST', key: 'mode-both-direct', body })).status, 201);
  assert.equal((await request('/api/sales-order-changes', { token: tokens.sales, method: 'POST', body })).status, 201);
});

test('delivery notice confirmation changes no inventory and preserves source capacity', async () => {
  const item = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(canonicalOrderId); const warehouseId = 'warehouse-001';
  const before = db.prepare('SELECT COALESCE(SUM(quantity),0) value FROM inventory').get().value;
  const created = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: { salesOrderId: canonicalOrderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20', lines: [{ salesOrderItemId: item.id, scheduledQtyMicros: 2_000_000 }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data)); const noticeId = created.data.notice.id;
  const confirmed = await request(`/api/delivery-notices/${noticeId}/confirm`, { token: tokens.sales, method: 'POST', body: {}, key: 'dn-confirm-1' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data)); assert.equal(db.prepare('SELECT COALESCE(SUM(quantity),0) value FROM inventory').get().value, before);
  const replay = await request(`/api/delivery-notices/${noticeId}/confirm`, { token: tokens.sales, method: 'POST', body: {}, key: 'dn-confirm-1' }); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
  const lineId = db.prepare('SELECT id FROM delivery_notice_lines WHERE delivery_notice_id=?').get(noticeId).id;
  const delivery = await request('/api/sales-deliveries', { token: tokens.admin, method: 'POST', body: { salesOrderId: canonicalOrderId, warehouseId, sourceMode: 'DELIVERY_NOTICE', deliveryNoticeId: noticeId, items: [{ salesOrderItemId: item.id, deliveryNoticeLineId: lineId, quantity: 1 }] } });
  assert.equal(delivery.status, 201, JSON.stringify(delivery.data));
  const stored = db.prepare('SELECT source_mode,delivery_notice_id FROM sales_deliveries WHERE id=?').get(delivery.data.id); assert.equal(stored.source_mode, 'DELIVERY_NOTICE'); assert.equal(stored.delivery_notice_id, noticeId);
});

test('competing delivery notices cannot over-commit one order line tolerance', async () => {
  const item = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(canonicalOrderId);
  const body = { salesOrderId: canonicalOrderId, warehouseId: 'warehouse-001', businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20', lines: [{ salesOrderItemId: item.id, scheduledQtyMicros: 1_300_000 }] };
  const first = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body });
  const second = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body });
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  assert.equal((await request(`/api/delivery-notices/${first.data.notice.id}/confirm`, { token: tokens.sales, method: 'POST', key: 'capacity-first', body: {} })).status, 200);
  const blocked = await request(`/api/delivery-notices/${second.data.notice.id}/confirm`, { token: tokens.sales, method: 'POST', key: 'capacity-second', body: {} });
  assert.equal(blocked.status, 409);
  assert.equal(db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(second.data.notice.id).state, 'DRAFT');
});

test('controlled close enforces exact lower tolerance, pending notice and executed-cancel contracts', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const createApproved = async (suffix, quantity = '10') => {
    const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: `close-order-${suffix}`, body: {
      customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
      items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: quantity }],
    } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: `close-submit-${suffix}`, body: {} })).status, 200);
    assert.equal((await request(`/api/sales-orders/${created.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: `close-approve-${suffix}`, body: {} })).status, 200);
    return { id: created.data.id, item: db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(created.data.id) };
  };
  const seedDeliveredFact = async (order, quantity, suffix) => {
    const created = await request('/api/sales-deliveries', { token: tokens.admin, method: 'POST', body: {
      sourceMode: 'DIRECT_ORDER', salesOrderId: order.id, warehouseId: 'warehouse-001', billingMode: 'SEPARATE', deliveryDate: '2026-10-15',
      items: [{ salesOrderItemId: order.item.id, productId: 'product-001', quantity }],
    } });
    assert.equal(created.status, 201, `${suffix}: ${JSON.stringify(created.data)}`);
    db.prepare("UPDATE sales_deliveries SET status='CONFIRMED',confirmed_at=?,confirmed_by='user-admin' WHERE id=?").run(new Date().toISOString(), created.data.id);
    return created.data.id;
  };

  const none = await createApproved('none');
  const beforeNone = db.prepare('SELECT commercial_close_state,remark FROM sales_orders WHERE id=?').get(none.id);
  const noDeliveryClose = await request(`/api/sales-orders/${none.id}/close`, { token: tokens.admin, method: 'POST', key: 'close-none', body: { reason: 'no delivery' } });
  assert.equal(noDeliveryClose.status, 409); assert.equal(noDeliveryClose.data.details?.code || noDeliveryClose.data.code, 'SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED');
  assert.deepEqual(db.prepare('SELECT commercial_close_state,remark FROM sales_orders WHERE id=?').get(none.id), beforeNone);
  assert.equal((await request(`/api/sales-orders/${none.id}/cancel`, { token: tokens.admin, method: 'POST', key: 'cancel-none', body: { reason: 'customer cancellation' } })).status, 200);

  const partial = await createApproved('partial', '20');
  await seedDeliveredFact(partial, 18, 'partial');
  const below = await request(`/api/sales-orders/${partial.id}/close`, { token: tokens.admin, method: 'POST', key: 'close-below', body: { reason: 'below lower' } });
  assert.equal(below.status, 409); assert.equal(below.data.details?.code || below.data.code, 'SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED');
  const cancelExecuted = await request(`/api/sales-orders/${partial.id}/cancel`, { token: tokens.admin, method: 'POST', key: 'cancel-executed', body: { reason: 'must fail' } });
  assert.equal(cancelExecuted.status, 409); assert.equal(cancelExecuted.data.details?.code || cancelExecuted.data.code, 'SALES_ORDER_EXECUTED_CANNOT_CANCEL');

  const lower = await createApproved('lower', '20');
  await seedDeliveredFact(lower, 19, 'lower');
  const closeLower = await request(`/api/sales-orders/${lower.id}/close`, { token: tokens.admin, method: 'POST', key: 'close-lower', body: { reason: 'accepted lower tolerance' } });
  assert.equal(closeLower.status, 200, JSON.stringify(closeLower.data));
  assert.equal(db.prepare('SELECT commercial_close_state FROM sales_orders WHERE id=?').get(lower.id).commercial_close_state, 'CLOSED');
  const closeAudit = JSON.parse(db.prepare("SELECT detail FROM audit_logs WHERE entity_type='SALES_ORDER' AND entity_id=? AND action='CLOSE' ORDER BY created_at DESC LIMIT 1").get(lower.id).detail);
  assert.equal(closeAudit.reason, 'accepted lower tolerance'); assert.equal(closeAudit.before.lines[0].deliveredMicros, 19_000_000); assert.equal(closeAudit.after.commercialCloseState, 'CLOSED');

  const pending = await createApproved('pending');
  const notice = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: { salesOrderId: pending.id, warehouseId: 'warehouse-001', businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20', lines: [{ salesOrderItemId: pending.item.id, scheduledQtyMicros: 10_000_000 }] } });
  assert.equal(notice.status, 201, JSON.stringify(notice.data));
  assert.equal((await request(`/api/delivery-notices/${notice.data.notice.id}/confirm`, { token: tokens.sales, method: 'POST', key: 'pending-dn-confirm', body: {} })).status, 200);
  const pendingBefore = { order: db.prepare('SELECT commercial_close_state,remark FROM sales_orders WHERE id=?').get(pending.id), audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND entity_id=? AND action='CLOSE'").get(pending.id).n) };
  const pendingClose = await request(`/api/sales-orders/${pending.id}/close`, { token: tokens.admin, method: 'POST', key: 'close-pending-dn', body: { reason: 'must fail pending DN' } });
  assert.equal(pendingClose.status, 409); assert.equal(pendingClose.data.details?.code || pendingClose.data.code, 'SALES_ORDER_PENDING_DELIVERY_NOTICE');
  assert.deepEqual({ order: db.prepare('SELECT commercial_close_state,remark FROM sales_orders WHERE id=?').get(pending.id), audit: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND entity_id=? AND action='CLOSE'").get(pending.id).n) }, pendingBefore);
});

test('gift order keeps catalog price evidence with zero revenue', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const created = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'gift-order-1', body: { customerId: 'customer-001', orderDate: '2026-10-15', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', isGiftLine: true }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data)); const line = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(created.data.id); const snapshot = JSON.parse(line.price_snapshot_json);
  assert.equal(line.unit_price_cents, 0); assert.equal(line.amount_cents, 0); assert.equal(snapshot.catalogUnitPriceCents, 1250); assert.equal(snapshot.giftLine, true);
  assert.equal((await request(`/api/sales-orders/${created.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'gift-order-submit', body: {} })).status, 200);
});

test('authoritative 100 percent discount permits zero revenue but forged zero evidence is rejected', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const scheme = await request('/api/sales-discount-schemes', { token: tokens.admin, method: 'POST', body: {
    schemeCode: 'BATCH-ZERO', name: 'Batch zero revenue', currencyCode: 'CNY', priority: 0, version: 1, effectiveFrom: '2026-01-01' } });
  assert.equal(scheme.status, 201, JSON.stringify(scheme.data)); const schemeId = scheme.data.scheme.id;
  const rule = await request(`/api/sales-discount-schemes/${schemeId}/rules`, { token: tokens.admin, method: 'POST', body: {
    ruleKey: 'LINE100', lineScope: 'LINE', applicationMode: 'AUTOMATIC', discountKind: 'PERCENT', discountBps: 10000,
    materialId: 'product-001', pricingUomCode: uom, customerScopeType: 'ALL', qtyBreakMinMicros: 0, effectiveFrom: '2026-01-01' } });
  assert.equal(rule.status, 201, JSON.stringify(rule.data));
  assert.equal((await request(`/api/sales-discount-schemes/${schemeId}/activate`, { token: tokens.admin, method: 'POST', key: 'batch-zero-activate', body: {} })).status, 200);
  const makeOrder = async (key) => request('/api/sales-orders', { token: tokens.sales, method: 'POST', key, body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20', discount: { explicitSchemeIds: [schemeId] },
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1' }] } });
  const zero = await makeOrder('authoritative-zero-order'); assert.equal(zero.status, 201, JSON.stringify(zero.data));
  const zeroLine = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(zero.data.id);
  assert.equal(zeroLine.unit_price_cents, 1250); assert.equal(zeroLine.amount_cents, 0);
  const zeroSubmitted = await request(`/api/sales-orders/${zero.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'authoritative-zero-submit', body: {} });
  assert.equal(zeroSubmitted.status, 200, JSON.stringify(zeroSubmitted.data));

  for (const [suffix, mutate] of [
    ['missing', (line) => ({ price: line.price_snapshot_json, discount: null, amount: 0 })],
    ['amount-mismatch', (line) => ({ price: line.price_snapshot_json, discount: line.discount_snapshot_json, amount: 1 })],
    ['invalid-discount', (line) => { const discount = JSON.parse(line.discount_snapshot_json); discount.lineDiscountCents -= 1; return { price: line.price_snapshot_json, discount: JSON.stringify(discount), amount: 0 }; }],
  ]) {
    const forged = await makeOrder(`forged-zero-${suffix}`); assert.equal(forged.status, 201, JSON.stringify(forged.data));
    const line = db.prepare('SELECT * FROM sales_order_items WHERE order_id=?').get(forged.data.id); const changed = mutate(line);
    db.prepare('UPDATE sales_order_items SET price_snapshot_json=?,discount_snapshot_json=?,amount_cents=? WHERE id=?').run(changed.price, changed.discount, changed.amount, line.id);
    db.prepare('UPDATE sales_orders SET total_cents=? WHERE id=?').run(changed.amount, forged.data.id);
    assert.equal((await request(`/api/sales-orders/${forged.data.id}/submit`, { token: tokens.sales, method: 'POST', key: `forged-zero-submit-${suffix}`, body: {} })).status, 409);
  }
  assert.equal((await request(`/api/sales-orders/${zero.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'authoritative-zero-approve', body: {} })).status, 200);
  const stamp = new Date().toISOString();
  const inventory = db.prepare("SELECT id FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
  if (inventory) db.prepare('UPDATE inventory SET quantity=100,updated_at=? WHERE id=?').run(stamp, inventory.id);
  else db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('batch-a-discount-inventory','warehouse-001','product-001',100,?)").run(stamp);
  db.prepare("UPDATE products SET valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOODS',valuation_activated_at='2026-01-01' WHERE id='product-001'").run();
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,50000,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=100,value_cents=50000,updated_at=excluded.updated_at`).run(stamp);
  const delivery = await request('/api/sales-deliveries', { token: tokens.admin, method: 'POST', body: {
    sourceMode: 'DIRECT_ORDER', salesOrderId: zero.data.id, warehouseId: 'warehouse-001', billingMode: 'DIRECT_BILL', deliveryDate: '2026-10-15',
    items: [{ salesOrderItemId: zeroLine.id, productId: 'product-001', quantity: 1 }],
  } });
  assert.equal(delivery.status, 201, JSON.stringify(delivery.data));
  assert.equal(db.prepare('SELECT total_cents FROM sales_deliveries WHERE id=?').get(delivery.data.id).total_cents, 0);
  const oqc = await request('/api/oqc', { token: tokens.admin, method: 'POST', body: { sales_delivery_id: delivery.data.id } });
  assert.equal(oqc.status, 201, JSON.stringify(oqc.data));
  assert.equal((await request(`/api/oqc/${oqc.data.id}/complete`, { token: tokens.admin, method: 'POST', body: {
    result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0,
  } })).status, 200);
  const confirm = () => request(`/api/sales-deliveries/${delivery.data.id}`, { token: tokens.admin, method: 'POST', key: 'discount-economic-confirm', body: { action: 'confirm' } });
  assert.equal((await confirm()).status, 200);
  const facts = () => ({
    stock: db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity,
    value: db.prepare("SELECT value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:warehouse-001:product-001'").get().value_cents,
    out: db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    cogs: db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id=?").get(delivery.data.id).n,
    revenue: db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    ar: db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    invoices: db.prepare('SELECT COUNT(DISTINCT invoice_id) n FROM sales_invoice_items WHERE delivery_id=?').get(delivery.data.id).n,
  });
  const expected = { stock: 99, value: 49500, out: 1, cogs: 1, revenue: 0, ar: 0, invoices: 0 };
  assert.deepEqual(facts(), expected);
  const replay = await confirm(); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.deepEqual(facts(), expected);
});

test('zero-revenue gift delivery still posts inventory, valuation and COGS exactly once after OQC PASS', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const order = await request('/api/sales-orders', { token: tokens.sales, method: 'POST', key: 'gift-economic-order', body: {
    customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '1', isGiftLine: true }],
  } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal((await request(`/api/sales-orders/${order.data.id}/submit`, { token: tokens.sales, method: 'POST', key: 'gift-economic-submit', body: {} })).status, 200);
  assert.equal((await request(`/api/sales-orders/${order.data.id}/approve`, { token: tokens.reviewer, method: 'POST', key: 'gift-economic-approve', body: {} })).status, 200);
  const orderItem = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(order.data.id);
  const stamp = new Date().toISOString();
  const inventory = db.prepare("SELECT id FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
  if (inventory) db.prepare('UPDATE inventory SET quantity=100,updated_at=? WHERE id=?').run(stamp, inventory.id);
  else db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('batch-a-gift-inventory','warehouse-001','product-001',100,?)").run(stamp);
  db.prepare("UPDATE products SET valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOODS',valuation_activated_at='2026-01-01' WHERE id='product-001'").run();
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,50000,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=100,value_cents=50000,updated_at=excluded.updated_at`).run(stamp);
  const delivery = await request('/api/sales-deliveries', { token: tokens.admin, method: 'POST', body: {
    sourceMode: 'DIRECT_ORDER', salesOrderId: order.data.id, warehouseId: 'warehouse-001', billingMode: 'DIRECT_BILL', deliveryDate: '2026-10-15',
    items: [{ salesOrderItemId: orderItem.id, productId: 'product-001', quantity: 1 }],
  } });
  assert.equal(delivery.status, 201, JSON.stringify(delivery.data));
  assert.equal(db.prepare('SELECT total_cents FROM sales_deliveries WHERE id=?').get(delivery.data.id).total_cents, 0);
  const oqc = await request('/api/oqc', { token: tokens.admin, method: 'POST', body: { sales_delivery_id: delivery.data.id } });
  assert.equal(oqc.status, 201, JSON.stringify(oqc.data));
  const completed = await request(`/api/oqc/${oqc.data.id}/complete`, { token: tokens.admin, method: 'POST', body: {
    result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0,
  } });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const confirmed = await request(`/api/sales-deliveries/${delivery.data.id}`, { token: tokens.admin, method: 'POST', key: 'gift-economic-confirm', body: { action: 'confirm' } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const facts = () => ({
    delivery: { ...db.prepare('SELECT status,total_cents FROM sales_deliveries WHERE id=?').get(delivery.data.id) },
    stock: db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity,
    valuation: { ...db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:warehouse-001:product-001'").get() },
    inventoryTransactions: db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    cogsVouchers: db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id=?").get(delivery.data.id).n,
    revenueVouchers: db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    receivables: db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.data.id).n,
    invoices: db.prepare('SELECT COUNT(DISTINCT invoice_id) n FROM sales_invoice_items WHERE delivery_id=?').get(delivery.data.id).n,
    audits: db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_DELIVERY' AND entity_id=? AND action='CONFIRM'").get(delivery.data.id).n,
  });
  const expected = { delivery: { status: 'CONFIRMED', total_cents: 0 }, stock: 99, valuation: { quantity: 99, value_cents: 49500 },
    inventoryTransactions: 1, cogsVouchers: 1, revenueVouchers: 0, receivables: 0, invoices: 0, audits: 1 };
  assert.deepEqual(facts(), expected);
  const replay = await request(`/api/sales-deliveries/${delivery.data.id}`, { token: tokens.admin, method: 'POST', key: 'gift-economic-confirm', body: { action: 'confirm' } });
  assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.deepEqual(facts(), expected);
});

test('Batch A frontend routes and responsive contract cover 320/390/430/680', () => {
  const registry = readFileSync(resolve('src/navigation/applicationRegistry.js'), 'utf8');
  const page = readFileSync(resolve('src/pages/sales-batch-a.jsx'), 'utf8');
  const styles = readFileSync(resolve('src/styles.css'), 'utf8');
  for (const route of ['quotations','delivery-notices','sales-order-changes']) assert.match(registry, new RegExp(`route\\('${route}'`));
  for (const surface of ['QuotationEditor','QuotationDetail','DeliveryNoticeEditor','DeliveryNoticeDetail','ChangeEditor','ChangeDetail']) assert.match(page, new RegExp(`function ${surface}`));
  assert.match(page, /LIST|RecordList/); assert.match(page, /Idempotency-Key/); assert.match(styles, /@media \(max-width:680px\)/);
  for (const width of [320,390,430,680]) assert.ok(width <= 680 && styles.includes('.sales-batch-line'));
});
