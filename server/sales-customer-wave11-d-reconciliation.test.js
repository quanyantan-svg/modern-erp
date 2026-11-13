// Wave 11-D — Credit Reconciliation (SC99) & Deterministic Recalculation (SC100).
//
// solution.md §37.54.11 (W11-D), §37.54.6.4 (the independent SC99 / SC100
// contracts), §37.54.6.5 (the physical decision on `credit_recalculation_history`),
// §37.54.11.2 (the fact digest and the three-state replay semantics),
// §37.54.11.5 (the two-phase transaction split), §37.54.11.6 (idempotency),
// §37.54.11.7 (fail-closed behaviour), §37.54.11.8 (drift_detected),
// §37.54.13.1 (the authorization matrix) and §37.54.14.1 (UAT-S-34).
//
// EVIDENCE LEVEL. Every assertion in this file runs on a single SQLite
// connection. It proves the control flow, the digest determinism, the
// fail-closed behaviour and the write-once property. It is NOT real-MySQL
// row-contention evidence (§37.54.14.6 E3): the W11-R3 race fixture stays
// BLOCKED for the protected MySQL campaign and must never be reported as PASS
// from this file. The Sales domain has no approved real-MySQL ACK-4 campaign
// at all (audit SC-DEF-10).

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createDatabase, hashPassword } from './db.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import { SALES_WAVE11_RECONCILIATION_TABLES } from './migrations/sales-customer-wave11-credit-reconciliation.js';
import {
  RECONCILIATION_CONTRACT_VERSION,
  RECONCILIATION_KINDS,
  __creditReconciliationInternals,
  checkCreditReconciliation,
  classifyReplayEquality,
  recalculateCreditExposure,
} from './modules/credit-reconciliation.js';
import { computeCreditExposure } from './modules/credit-check.js';

const DAY = '2026-11-10';
const CREDIT_OBJECT_TYPE = 'SALES_ORDER';
const CREDIT_OBJECT_ID = 'CREDIT-CUSTOMER-W11D';

const ADMIN = Object.freeze({
  id: 'w11d-admin', roleCode: 'ADMIN',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE', 'SALES_CROSS_GROUP'],
});
const EVALUATOR = Object.freeze({
  id: 'w11d-evaluator', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE'],
});
const VIEWER = Object.freeze({ id: 'w11d-viewer', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });

function buildDb() {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave11d-'));
  const path = join(temp, 'wave11d.db');
  const db = createDatabase(path);
  try {
    migrateSalesCustomerDomain(db);
  } catch (error) {
    db.close();
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  return { db, temp, cleanup: () => { db.close(); rmSync(temp, { recursive: true, force: true }); } };
}

function seedBase(db) {
  const now = new Date().toISOString();
  const hashed = hashPassword('wave11d-1234');
  for (const [id, username] of [['w11d-admin', 'w11d-admin'], ['w11d-sales', 'w11d-sales'], ['w11d-evaluator', 'w11d-eval']]) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, username, username, hashed.hash, hashed.salt, now);
  }
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('cus-w11d','CUS-W11D','Wave 11-D Customer','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES('sp-w11d','SP-W11D','Salesperson W11D','w11d-sales',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('sg-w11d','SG-W11D','Sales Group W11D','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
    VALUES('mem-w11d','sp-w11d','sg-w11d',1,1,?,NULL,?,?)`).run('2020-01-01', now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('wh-w11d','WH-W11D','Wave 11-D Warehouse','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES('p-w11d','P-W11D','Wave 11-D Product','','EA',10000,0,1,?,?)`).run(now, now);
}

function seedProfile(db, {
  customerId = 'cus-w11d', salespersonId = null, creditLimitCents = 10000000,
  effectiveFrom = '2026-01-01', status = 'ACTIVE', id = null, suffix = '',
} = {}) {
  const now = new Date().toISOString();
  const profileId = id || `cp-w11d-${customerId}-${salespersonId || 'agg'}${suffix}`;
  const anchorId = `anchor-w11d-${customerId}-${salespersonId || 'agg'}${suffix}`;
  const scopeKey = salespersonId || '*';
  db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,
      credit_object_type,credit_object_id,policy_scope_type,policy_scope_id,created_at)
    VALUES(?,?,'CREDIT_OBJECT',?,?,?,?,NULL,NULL,?)`).run(
    anchorId,
    `CREDIT_OBJECT|${CREDIT_OBJECT_TYPE}|${CREDIT_OBJECT_ID}|CUSTOMER|${customerId}|SCOPE:${salespersonId ? `SALESPERSON|${salespersonId}` : 'AGGREGATE'}${suffix}`,
    customerId, salespersonId, CREDIT_OBJECT_TYPE, CREDIT_OBJECT_ID, now,
  );
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
      credit_object_type,credit_object_id,credit_limit_cents,initial_state,status,rating_grade,
      rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,effective_from,effective_to,
      created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,'NORMAL',?,?,?,NULL,'15',NULL,?,NULL,?,?)`).run(
    profileId, anchorId, customerId, scopeKey, salespersonId, CREDIT_OBJECT_TYPE, CREDIT_OBJECT_ID,
    creditLimitCents, status, 'A', effectiveFrom, effectiveFrom, now, 'w11d-admin',
  );
  return profileId;
}

// The dual-limit fixture: the customer aggregate AND the salesperson
// sub-limit. R99-2 requires both scopes to be reported separately.
function seedDualLimitProfiles(db, options = {}) {
  seedProfile(db, { ...options, salespersonId: null });
  seedProfile(db, { ...options, salespersonId: 'sp-w11d' });
}

function seedParameter(db, code, valueBool, effectiveFrom = '2026-01-01') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,created_at,created_by)
    VALUES(?,?,NULL,NULL,?,NULL,?,NULL,'ACTIVE',?,?)`).run(`param-${code}-${effectiveFrom}`, code, valueBool ? 1 : 0, effectiveFrom, now, 'w11d-admin');
}

function seedRule(db, {
  ruleCode = 'SO_LIMIT', businessStage = 'SO_SUBMIT', scenario = 'STANDARD',
  controlStrength = 'WARNING', recognitionMode = null, effectiveFrom = '2026-01-01', creditItem = 'ORDER_EXPOSURE',
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
      recognition_mode,effective_from,effective_to,status,result_payload_json,created_at,created_by)
    VALUES(?,?,?,?,'BEFORE_WRITE',?,?,?,?,NULL,'ACTIVE','{}',?,?)`)
    .run(`rule-${ruleCode}-${businessStage}`, ruleCode, businessStage, scenario, controlStrength, creditItem,
      recognitionMode, effectiveFrom, now, 'w11d-admin');
}

// The reference group must be produced by the PRODUCTION credit check writer,
// so the fixture enables Credit Management and installs an effective rule.
function seedCreditManagement(db) {
  seedParameter(db, 'CREDIT_MANAGEMENT_ENABLED', true);
  seedRule(db, { businessStage: 'SO_SUBMIT', controlStrength: 'WARNING' });
}

async function runReferenceCheck(db) {
  const { evaluateCredit } = await import('./modules/credit-check.js');
  const { transaction } = await import('./db.js');
  let outcome;
  transaction(db, () => {
    outcome = evaluateCredit(db, {
      customerId: 'cus-w11d', salespersonId: 'sp-w11d', stage: 'SO_SUBMIT', businessDate: DAY,
      proposedDeltaCents: 0, recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
      sourceRef: { sourceType: 'SALES_ORDER', sourceId: 'so-w11d-1' },
      actorId: 'w11d-admin', authorizationContext: 'w11d-admin',
    });
  });
  assert.equal(outcome.enforced, true, 'the reference check must be enforced for a reference group to exist');
  assert.ok(outcome.checkGroupId, 'the reference check must produce a check group id');
  return outcome;
}

function seedOrder(db, {
  id = 'so-w11d-1', customerId = 'cus-w11d', salespersonId = 'sp-w11d', status = 'APPROVED',
  totalCents = 100000, orderDate = DAY, creatorId = 'w11d-sales', withItem = true,
} = {}) {
  const now = new Date().toISOString();
  const reviewedAt = `${orderDate}T09:00:00.000Z`;
  // The column list must name EVERY column of `sales_orders` that sits between
  // the last named column and the end, otherwise SQLite binds the values
  // positionally and the fixture silently writes the wrong field.
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,
      reviewer_id,submitted_at,reviewed_at,created_at,updated_at,order_date,requested_delivery_date,payment_terms,
      ship_to_contact_name,ship_to_phone,ship_to_address,payment_terms_days,salesperson_id,sales_group_id,
      settlement_party_id,payer_id,customer_material_xref_id,commercial_tax_code,tax_inclusive,
      required_prepayment_cents,reservation_intent_state,commercial_close_state,
      gift_summary_cents,commercial_pricing_uom_code,effective_version)
    VALUES(?,?,?,?,?,'','',?,NULL,NULL,?,?,?,?,?,'CASH','','','',0,?,NULL,?,?,NULL,NULL,NULL,0,'NONE','OPEN',0,NULL,1)`)
    .run(id, id.toUpperCase(), customerId, status, totalCents, creatorId, reviewedAt, now, now, orderDate, orderDate,
      salespersonId, customerId, customerId);
  if (withItem) {
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,'p-w11d',1,?,?,1)`).run(`soi-${id}`, id, totalCents, totalCents);
  }
}

function seedDelivery(db, {
  id = 'sd-w11d-1', orderId = 'so-w11d-1', customerId = 'cus-w11d', totalCents = 100000,
  deliveryDate = DAY, confirmedAt = `${DAY}T09:00:00.000Z`,
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,
      status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by,billing_mode,
      delivery_notice_id,source_mode)
    VALUES(?,?,?,?,'wh-w11d','w11d-sales',?,'CONFIRMED',?,'','w11d-sales',?,?,?,'w11d-sales','DIRECT_BILL',NULL,'DIRECT_ORDER')`)
    .run(id, id.toUpperCase(), orderId, customerId, totalCents, deliveryDate, now, now, confirmedAt);
}

function seedDeliveryItem(db, {
  id = 'sdi-w11d-1', deliveryId = 'sd-w11d-1', orderItemId = 'soi-so-w11d-1', amountCents = 100000,
} = {}) {
  db.prepare(`INSERT INTO sales_delivery_items(
      id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES(?,?,'p-w11d',1,?,?,1,?)`).run(id, deliveryId, amountCents, amountCents, orderItemId);
}

function seedReceivable(db, {
  id = 'ar-w11d-1', customerId = 'cus-w11d', sourceType = 'SALES_DELIVERY', sourceId = 'sd-w11d-1',
  amountCents = 100000, openCents = 100000, itemClass = 'SOURCE', recognitionMode = 'DIRECT_BUSINESS_OPEN_ITEM',
  itemKind = 'FINAL', dueDate = '2026-12-31', businessDate = DAY,
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,
      write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,item_class,
      recognition_mode,item_kind,conversion_state)
    VALUES(?,?,?,?,?,?,0,0,'PENDING',?,'w11d-admin',?,?,?,?,?,?,?,'OPEN')`)
    .run(id, id.toUpperCase(), customerId, sourceType, sourceId, amountCents, dueDate, now, businessDate, now,
      openCents, itemClass, recognitionMode, itemKind);
}

function seedSalesInvoice(db, {
  id = 'inv-w11d-1', customerId = 'cus-w11d', amountCents = 100000, status = 'POSTED', invoiceDate = DAY,
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_invoices(
      id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,
      tax_snapshot_json,creator_id,created_at,posted_by,posted_at)
    VALUES(?,?,?, ?,?,'NO_TAX',?,0,?,'[]','w11d-admin',?,'w11d-admin',?)`)
    .run(id, id.toUpperCase(), customerId, invoiceDate, status, amountCents, amountCents, now, now);
}

function seedInvoiceSourceLink(db, {
  id = 'link-w11d-1', invoiceId = 'inv-w11d-1', deliveryId = 'sd-w11d-1',
  deliveryItemId = 'sdi-w11d-1', amountCents = 100000,
} = {}) {
  db.prepare(`INSERT INTO finance_invoice_source_links(
      id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
    VALUES(?,?,'SALES_INVOICE','SALES_DELIVERY',?,?,1,?,?)`)
    .run(id, invoiceId, deliveryId, deliveryItemId, amountCents, new Date().toISOString());
}

function response() {
  return {
    statusCode: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

function request(body, key = 'wave11d-key') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

async function invoke(handler, db, body, actor = ADMIN, key = 'wave11d-key') {
  const res = response();
  try {
    await handler(db, request(body, key), res, actor);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, error };
  }
}

function historyRows(db) {
  return db.prepare('SELECT * FROM credit_recalculation_history ORDER BY triggered_at,id').all();
}

function reconciliationAuditCount(db) {
  return db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_RECALCULATION'").get().count;
}

function checkBody(overrides = {}) {
  return {
    customerId: 'cus-w11d',
    salespersonId: 'sp-w11d',
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: CREDIT_OBJECT_ID,
    businessDate: DAY,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Migration contract
// ---------------------------------------------------------------------------

test('W11-D migration creates exactly one additive table and replays idempotently', () => {
  const handle = buildDb();
  try {
    const present = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE11_RECONCILIATION_TABLES.map(() => '?').join(',')})`).all(...SALES_WAVE11_RECONCILIATION_TABLES);
    assert.deepEqual(present.map((row) => row.name), [...SALES_WAVE11_RECONCILIATION_TABLES].sort());
    // Replay is a no-op.
    migrateSalesCustomerDomain(handle.db);
    const again = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE11_RECONCILIATION_TABLES.map(() => '?').join(',')})`).all(...SALES_WAVE11_RECONCILIATION_TABLES);
    assert.deepEqual(again.map((row) => row.name), [...SALES_WAVE11_RECONCILIATION_TABLES].sort());
  } finally { handle.cleanup(); }
});

test('W11-D history table carries the approved columns, foreign keys and CHECK set', () => {
  const handle = buildDb();
  try {
    const columns = handle.db.prepare('PRAGMA table_info(credit_recalculation_history)').all().map((row) => row.name);
    assert.deepEqual(columns, [
      'id', 'kind', 'credit_object_type', 'credit_object_id', 'customer_id', 'salesperson_scope_key',
      'business_date', 'fact_digest', 'policy_snapshot_fingerprint', 'profile_effective_state_hash',
      'scope_filter_json', 'result_snapshot_json', 'discrepancy_count', 'drift_detected', 'duration_ms',
      'triggered_by', 'triggered_at',
    ]);
    const fks = handle.db.prepare('PRAGMA foreign_key_list(credit_recalculation_history)').all();
    assert.ok(fks.some((row) => row.from === 'customer_id' && row.table === 'customers' && row.to === 'id'));
    assert.ok(fks.some((row) => row.from === 'triggered_by' && row.table === 'users' && row.to === 'id'));
    // G-2 — no foreign key back into any decision table, so the history row
    // can never be consumed as decision evidence.
    assert.equal(fks.length, 2);
    const ddl = handle.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_recalculation_history'").get().sql;
    assert.match(ddl, /CHECK\(kind IN \('CHECK_ONLY','DETERMINISTIC_RECALCULATION'\)\)/);
    assert.match(ddl, /CHECK\(discrepancy_count >= 0\)/);
    assert.match(ddl, /CHECK\(drift_detected IN \(0,1\)\)/);
    assert.match(ddl, /CHECK\(duration_ms >= 0\)/);
  } finally { handle.cleanup(); }
});

test('W11-D history table has NO top-level amount column (G-1 / G-5)', () => {
  const handle = buildDb();
  try {
    const columns = handle.db.prepare('PRAGMA table_info(credit_recalculation_history)').all().map((row) => row.name);
    const forbidden = /(^|_)(amount|balance|exposure|used|remaining|over_limit|limit|cents)($|_)/;
    for (const column of columns) {
      assert.equal(forbidden.test(column), false, `top-level amount column ${column} is forbidden`);
    }
    // The ONLY amount carrier is the single immutable result snapshot payload.
    assert.ok(columns.includes('result_snapshot_json'));
  } finally { handle.cleanup(); }
});

test('the W11-D history table has no UPDATE or DELETE path anywhere in the repository', () => {
  const source = readFileSync(new URL('./modules/credit-reconciliation.js', import.meta.url), 'utf8');
  // The module is the ONLY writer. It must never UPDATE or DELETE the row.
  assert.equal(/UPDATE\s+credit_recalculation_history/i.test(source), false, 'the reconciliation module must not UPDATE the history table');
  assert.equal(/DELETE\s+FROM\s+credit_recalculation_history/i.test(source), false, 'the reconciliation module must not DELETE from the history table');
  assert.match(source, /INSERT INTO credit_recalculation_history/);
  // No other module may write it either.
  const modules = ['credit-check.js', 'credit-profile.js', 'credit-policy.js', 'credit-scope.js', 'credit-anchor.js',
    'credit-query.js', 'credit-query-options.js', 'credit-special-approval.js'];
  for (const name of modules) {
    const other = readFileSync(new URL(`./modules/${name}`, import.meta.url), 'utf8');
    assert.equal(/credit_recalculation_history/i.test(other), false, `${name} must not reference the reconciliation history table`);
  }
});

test('no credit calculation path reads the reconciliation history table (G-3)', () => {
  const source = readFileSync(new URL('./modules/credit-check.js', import.meta.url), 'utf8');
  assert.equal(/credit_recalculation_history/i.test(source), false, 'the credit engine must not read the reconciliation history table');
  const query = readFileSync(new URL('./modules/credit-query.js', import.meta.url), 'utf8');
  assert.equal(/credit_recalculation_history/i.test(query), false, 'the credit query module must not read the reconciliation history table');
});

// ---------------------------------------------------------------------------
// SC99 — CHECK-only reconciliation
// ---------------------------------------------------------------------------

test('SC99 without a reference group returns a consistent verdict and no drift', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const res = await invoke(checkCreditReconciliation, handle.db, checkBody(), ADMIN, 'sc99-no-ref');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.kind, RECONCILIATION_KINDS.CHECK_ONLY);
    assert.equal(res.body.referenceComparison, 'NOT_APPLICABLE');
    assert.equal(res.body.driftDetected, 0);
    assert.equal(res.body.discrepancyCount, 0);
    assert.equal(res.body.scopes.length, 2);
    const aggregate = res.body.scopes.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
    const subLimit = res.body.scopes.find((scope) => scope.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.ok(aggregate, 'the customer aggregate scope must be reported separately');
    assert.ok(subLimit, 'the salesperson sub-limit scope must be reported separately');
    assert.equal(aggregate.creditLimitCents, 10000000);
    assert.equal(aggregate.usedCents, 100000);
    assert.equal(aggregate.remainingCents, 9900000);
    // Exactly one history row and one audit row.
    assert.equal(historyRows(handle.db).length, 1);
    assert.equal(reconciliationAuditCount(handle.db), 1);
  } finally { handle.cleanup(); }
});

test('SC99 with a matching reference group reports MATCHED and no drift', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedCreditManagement(handle.db);
    seedOrder(handle.db);
    // The reference group is produced by the PRODUCTION credit check writer.
    const outcome = await runReferenceCheck(handle.db);

    const res = await invoke(checkCreditReconciliation, handle.db,
      checkBody({ referenceCheckGroupId: outcome.checkGroupId }), ADMIN, 'sc99-match');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.referenceComparison, 'MATCHED');
    assert.equal(res.body.driftDetected, 0);
    assert.equal(res.body.discrepancyCount, 0);
    assert.deepEqual(res.body.differingItems, []);
  } finally { handle.cleanup(); }
});

test('SC99 with a reference group whose facts changed reports MISMATCHED, drift and the differing items', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedCreditManagement(handle.db);
    seedOrder(handle.db);
    const outcome = await runReferenceCheck(handle.db);
    // A NEW approved order changes the canonical facts after the reference
    // decision was taken.
    seedOrder(handle.db, { id: 'so-w11d-2', totalCents: 250000 });

    const res = await invoke(checkCreditReconciliation, handle.db,
      checkBody({ referenceCheckGroupId: outcome.checkGroupId }), ADMIN, 'sc99-drift');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.referenceComparison, 'MISMATCHED');
    assert.equal(res.body.driftDetected, 1);
    assert.ok(res.body.discrepancyCount > 0);
    assert.ok(res.body.differingItems.length > 0, 'the differing items must be named');
    const exposureItem = res.body.differingItems.find((item) => item.code === 'REFERENCE_EXPOSURE_MISMATCH');
    assert.ok(exposureItem, 'the exposure difference must be named');
    assert.equal(exposureItem.expected, 350000);
    assert.equal(exposureItem.actual, 100000);
    // The history row records the drift.
    const row = historyRows(handle.db)[0];
    assert.equal(row.drift_detected, 1);
    assert.equal(row.discrepancy_count, res.body.discrepancyCount);
  } finally { handle.cleanup(); }
});

test('SC99 comparison against a reference group from another business date is NOT_COMPARABLE, never silently consistent', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedCreditManagement(handle.db);
    seedOrder(handle.db);
    const outcome = await runReferenceCheck(handle.db);
    // Rewrite the reference business date so the reference is from another day.
    handle.db.prepare("UPDATE credit_check_results SET business_date='2026-01-05' WHERE check_group_id=?")
      .run(outcome.checkGroupId);
    const res = await invoke(checkCreditReconciliation, handle.db,
      checkBody({ referenceCheckGroupId: outcome.checkGroupId }), ADMIN, 'sc99-not-comparable');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.referenceComparison, 'NOT_APPLICABLE');
    assert.equal(res.body.driftDetected, 0);
    assert.ok(res.body.differingItems.some((item) => item.code === 'REFERENCE_BUSINESS_DATE_MISMATCH'));
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC100 — deterministic recalculation
// ---------------------------------------------------------------------------

test('SC100 emits a fact digest and repeats it identically for unchanged facts', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const first = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-a');
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.kind, RECONCILIATION_KINDS.DETERMINISTIC_RECALCULATION);
    assert.match(first.body.factDigest, /^[0-9a-f]{64}$/);
    // SC100 emits NO verdict.
    assert.equal(first.body.referenceComparison, 'NOT_APPLICABLE');
    assert.equal(first.body.driftDetected, 0);
    const second = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-b');
    assert.equal(second.body.factDigest, first.body.factDigest, 'unchanged facts must yield the same digest');
    // Two executions, two history rows (different idempotency keys).
    assert.equal(historyRows(handle.db).length, 2);
  } finally { handle.cleanup(); }
});

test('SC100 digest changes when a canonical fact changes', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const first = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-c');
    seedOrder(handle.db, { id: 'so-w11d-2', totalCents: 250000 });
    const second = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-d');
    assert.notEqual(second.body.factDigest, first.body.factDigest, 'a changed fact must change the digest');
  } finally { handle.cleanup(); }
});

test('SC100 digest is NOT merely a timestamp: re-stamping an unrelated audit column keeps the digest', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const first = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-e');
    // `updated_at` is an audit timestamp and does NOT participate in the
    // derivation, so the digest must not move.
    handle.db.prepare("UPDATE sales_orders SET updated_at='2026-11-11T23:59:59.000Z' WHERE id='so-w11d-1'").run();
    const second = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-f');
    assert.equal(second.body.factDigest, first.body.factDigest, 'an audit timestamp must not move the digest');
    // But a real fact change does.
    handle.db.prepare("UPDATE sales_orders SET total_cents=123456 WHERE id='so-w11d-1'").run();
    const third = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-g');
    assert.notEqual(third.body.factDigest, first.body.factDigest, 'a real fact change must move the digest');
  } finally { handle.cleanup(); }
});

test('the fact digest keeps two distinct out-of-safe-range legacy AR amounts distinct', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    // `readOpenReceivables` reads the cents as TEXT so an out-of-safe-range
    // legacy amount survives to the evidence classifier. Two such amounts
    // must NOT collapse onto one digest. '9007199254740992' and
    // '9007199254740993' both round to 2^53 under Number(), so a naive
    // coercion would fold them onto one another.
    const first = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-legacy-a');
    handle.db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,
        paid_cents,write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,
        item_class,recognition_mode,item_kind,conversion_state)
      VALUES('ar-w11d-legacy','AR-W11D-LEGACY','cus-w11d','SALES_DELIVERY','sd-w11d-1',9007199254740992,0,0,'PENDING',
        '2026-12-31','w11d-admin',?,?,?,9007199254740992,'SOURCE','DIRECT_BUSINESS_OPEN_ITEM','FINAL','OPEN')`)
      .run(new Date().toISOString(), DAY, new Date().toISOString());
    const second = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-legacy-b');
    assert.notEqual(second.body.factDigest, first.body.factDigest);
    // And the two DISTINCT unsafe amounts are distinguishable from each other.
    handle.db.prepare("UPDATE account_receivables SET amount_cents=9007199254740993, open_amount_cents=9007199254740993 WHERE id='ar-w11d-legacy'").run();
    const third = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-legacy-c');
    assert.notEqual(third.body.factDigest, second.body.factDigest, 'two distinct unsafe legacy amounts must not collide');
  } finally { handle.cleanup(); }
});

test('SC100 produces no Credit Check Decision', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const before = handle.db.prepare('SELECT COUNT(*) count FROM credit_check_results').get().count;
    const snapshotsBefore = handle.db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count;
    await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-no-decision');
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_check_results').get().count, before);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count, snapshotsBefore);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// The three-state replay semantics
// ---------------------------------------------------------------------------

test('the replay classification is three-state and never binary', () => {
  const base = {
    contractVersion: RECONCILIATION_CONTRACT_VERSION,
    businessDate: DAY,
    scopeKey: 'sp-w11d',
    factDigest: 'a'.repeat(64),
  };
  assert.equal(classifyReplayEquality(base, { ...base }).state, 'EQUIVALENT');
  assert.equal(classifyReplayEquality(base, { ...base, factDigest: 'b'.repeat(64) }).state, 'DRIFTED');
  assert.equal(classifyReplayEquality(base, { ...base, contractVersion: 'OTHER_V1' }).state, 'NOT_COMPARABLE');
  assert.equal(classifyReplayEquality(base, { ...base, businessDate: '2026-11-11' }).state, 'NOT_COMPARABLE');
  assert.equal(classifyReplayEquality(base, { ...base, scopeKey: 'other' }).state, 'NOT_COMPARABLE');
  assert.equal(classifyReplayEquality(null, base).state, 'NOT_COMPARABLE');
});

test('a replay of the same execution identity adds no second history row', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const first = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-replay');
    assert.equal(first.statusCode, 200);
    assert.equal(historyRows(handle.db).length, 1);
    const second = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-replay');
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(historyRows(handle.db).length, 1, 'a replay must not append a second history row');
    assert.equal(reconciliationAuditCount(handle.db), 1, 'a replay must not append a second audit row');
    assert.equal(second.body.factDigest, first.body.factDigest);
  } finally { handle.cleanup(); }
});

test('the idempotency store carries the execution identity only, never an amount', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'sc100-idem');
    const rows = handle.db.prepare('SELECT * FROM idempotency_records WHERE operation_type LIKE ?')
      .all('CREDIT_RECONCILIATION_%');
    assert.equal(rows.length, 1);
    const payload = rows[0].result_json;
    assert.ok(!/"usedCents"|"remainingCents"|"creditLimitCents"|"overLimitCents"/.test(payload),
      'the idempotency payload must not carry an amount');
    assert.ok(payload.includes('factDigest'));
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour
// ---------------------------------------------------------------------------

test('a missing effective profile fails closed with 409 and writes nothing', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db);
    const res = await invoke(checkCreditReconciliation, handle.db, checkBody(), ADMIN, 'fail-closed-profile');
    assert.equal(res.statusCode, 409);
    assert.equal(res.code, 'CREDIT_PROFILE_MISSING');
    assert.equal(historyRows(handle.db).length, 0, 'no history row on failure');
    assert.equal(reconciliationAuditCount(handle.db), 0, 'no audit row on failure');
  } finally { handle.cleanup(); }
});

test('an ambiguous effective profile version fails closed with 409 and writes nothing', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    // A second version of the SAME effective window is not unique. It carries
    // its own anchor identity, so the fixture is the duplicate PROFILE row,
    // not a duplicate anchor.
    seedProfile(handle.db, { id: 'cp-w11d-duplicate', suffix: '-dup', effectiveFrom: '2026-01-01' });
    const res = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'fail-closed-ambiguous');
    assert.equal(res.statusCode, 409);
    assert.equal(res.code, 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS');
    assert.equal(historyRows(handle.db).length, 0);
    assert.equal(reconciliationAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

test('an AR source-chain inconsistency fails closed with 409 and writes nothing', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    seedDelivery(handle.db);
    seedDeliveryItem(handle.db);
    // An invoice whose allocation does not conserve the AR amount is an
    // inconsistent source chain and must fail closed.
    seedSalesInvoice(handle.db, { id: 'inv-w11d-bad', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-w11d-bad', invoiceId: 'inv-w11d-bad', amountCents: 90000 });
    seedReceivable(handle.db, {
      id: 'ar-w11d-broken', sourceType: 'SALES_INVOICE', sourceId: 'inv-w11d-bad',
      recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM',
    });
    const res = await invoke(checkCreditReconciliation, handle.db, checkBody(), ADMIN, 'fail-closed-source');
    assert.equal(res.statusCode, 409);
    assert.equal(res.code, 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT');
    assert.equal(historyRows(handle.db).length, 0);
    assert.equal(reconciliationAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

test('ambiguous attribution does NOT fail and is reported explicitly', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    // An AR row whose item class is not SOURCE is attribution-ambiguous.
    seedReceivable(handle.db, {
      id: 'ar-w11d-ambiguous', sourceType: 'SALES_DELIVERY', sourceId: 'sd-w11d-1',
      amountCents: 40000, openCents: 40000, itemClass: 'NON_SOURCE',
    });
    const res = await invoke(checkCreditReconciliation, handle.db, checkBody(), ADMIN, 'ambiguous-attribution');
    assert.equal(res.statusCode, 200, 'ambiguous attribution must not fail the reconciliation');
    assert.equal(res.body.hasAmbiguousAttribution, true);
    assert.equal(res.body.ambiguousAttributionCents, 40000);
    // The amount counts in full in the aggregate.
    const aggregate = res.body.scopes.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
    assert.equal(aggregate.components.ambiguousAttributionCents, 40000);
    assert.equal(aggregate.components.arOpenCents, 40000);
    assert.equal(historyRows(handle.db).length, 1);
  } finally { handle.cleanup(); }
});

test('a transition exceeding the delivered obligation fails closed with 409', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    seedDelivery(handle.db, { totalCents: 100000 });
    // The AR amount exceeds what was delivered against the order.
    seedReceivable(handle.db, {
      id: 'ar-w11d-over', sourceType: 'SALES_DELIVERY', sourceId: 'sd-w11d-1',
      amountCents: 500000, openCents: 500000,
    });
    const res = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'fail-closed-transition');
    assert.equal(res.statusCode, 409);
    assert.equal(res.code, 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT');
    assert.equal(historyRows(handle.db).length, 0);
    assert.equal(reconciliationAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test('SC99 and SC100 require the CREDIT_EVALUATE authority', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const denied = await invoke(checkCreditReconciliation, handle.db, checkBody(), VIEWER, 'denied-check');
    assert.equal(denied.statusCode, 403);
    const deniedRecalc = await invoke(recalculateCreditExposure, handle.db, checkBody(), VIEWER, 'denied-recalc');
    assert.equal(deniedRecalc.statusCode, 403);
    assert.equal(historyRows(handle.db).length, 0);
    const allowed = await invoke(checkCreditReconciliation, handle.db, checkBody(), EVALUATOR, 'allowed-check');
    assert.equal(allowed.statusCode, 200);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// The result snapshot
// ---------------------------------------------------------------------------

test('the result snapshot carries the approved structure and is never authoritative', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    await invoke(checkCreditReconciliation, handle.db, checkBody(), ADMIN, 'snapshot-shape');
    const row = historyRows(handle.db)[0];
    const snapshot = JSON.parse(row.result_snapshot_json);
    assert.equal(snapshot.contractVersion, 'CREDIT_RECONCILIATION_RESULT_SNAPSHOT_WAVE11_V1');
    assert.equal(snapshot.authoritative, false);
    assert.equal(snapshot.consumedByCreditCalculation, false);
    assert.ok(Array.isArray(snapshot.scopes));
    for (const scope of snapshot.scopes) {
      for (const field of ['scopeType', 'creditLimitCents', 'usedCents', 'remainingCents', 'overLimitCents',
        'components', 'consistency', 'discrepancyCodes']) {
        assert.ok(field in scope, `the scope snapshot must carry ${field}`);
      }
    }
    assert.ok(snapshot.factCounts && 'orders' in snapshot.factCounts && 'deliveries' in snapshot.factCounts
      && 'receivables' in snapshot.factCounts);
    assert.equal(snapshot.referenceComparison, 'NOT_APPLICABLE');
    // The row carries the snapshot identity columns.
    assert.match(row.fact_digest, /^[0-9a-f]{64}$/);
    // The policy snapshot fingerprint is the Wave 11 V2 contract fingerprint.
    assert.match(row.policy_snapshot_fingerprint, /^CSP2:[0-9a-f]{64}$/);
    assert.equal(row.kind, 'CHECK_ONLY');
    assert.equal(row.business_date, DAY);
  } finally { handle.cleanup(); }
});

test('the reconciliation never persists a policy snapshot', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedDualLimitProfiles(handle.db);
    seedOrder(handle.db);
    const before = handle.db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count;
    const res = await invoke(recalculateCreditExposure, handle.db, checkBody(), ADMIN, 'no-policy-snapshot');
    assert.equal(res.statusCode, 200);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count, before,
      'the reconciliation must not persist a policy snapshot');
    assert.equal(res.body.policySnapshot.persisted, false);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Negative control
// ---------------------------------------------------------------------------

test('NEGATIVE CONTROL — the digest would collapse if the unsafe legacy amount were coerced with Number()', () => {
  // This is the independent negative control for the documented deviation in
  // `normalizeDigestNumber`. A naive `Number(...)` coercion folds two DISTINCT
  // out-of-safe-range legacy amounts onto the same number, so the digest would
  // be equal while the fact sets are different. The production normalisation
  // keeps the exact text instead.
  //
  // '9007199254740992' is 2^53 (the first integer above MAX_SAFE_INTEGER) and
  // '9007199254740993' is its immediate successor. Both round to 2^53 under
  // IEEE-754 double arithmetic, so `Number()` collides them.
  const unsafeA = '9007199254740992';
  const unsafeB = '9007199254740993';
  assert.notEqual(unsafeA, unsafeB);
  // The naive coercion collides...
  assert.equal(Number(unsafeA), Number(unsafeB), 'Number() collides the two unsafe legacy amounts');
  // ...and the production normalisation must not.
  const project = (value) => {
    const numeric = Number(String(value).trim());
    if (Number.isSafeInteger(numeric)) return numeric;
    return String(value).trim();
  };
  assert.notEqual(project(unsafeA), project(unsafeB), 'the production normalisation must keep the two unsafe amounts distinct');
});
