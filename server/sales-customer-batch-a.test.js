import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

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

test('quotation converts multiple lines, rejects duplicates, and keeps request-level exact replay', async () => {
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  const quote = await request('/api/sales-quotations', { token: tokens.sales, method: 'POST', body: { customerId: 'customer-001', validFrom: '2026-10-15', validTo: '2026-12-31', items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '4' }, { productId: 'product-001', uomCode: uom, quantityDecimal: '3' }] } });
  assert.equal(quote.status, 201, JSON.stringify(quote.data)); quotationId = quote.data.quotation.id; quotationLineId = quote.data.quotation.lines[0].id;
  const secondLineId = quote.data.quotation.lines[1].id;
  assert.equal((await request(`/api/sales-quotations/${quotationId}/effective-publish`, { token: tokens.sales, method: 'POST', body: {} })).status, 200);
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
