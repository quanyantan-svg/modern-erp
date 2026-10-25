// Wave 10 — Credit Check + Credit Special Approval.
//
// solution.md §36.6 / §36.3 / §36.14 / §36.8.3, document.md §34.3.21..§34.3.23,
// invariants S14 / S15 / S16, UAT-S-31 / UAT-S-32 / UAT-S-33 and the race
// requirements R-SAL-12 / R-SAL-13 / R-SAL-14.
//
// EVIDENCE LEVEL. Every assertion in this file runs on a single SQLite
// connection. It proves the control flow, the dialect intent and the business
// arithmetic. It is NOT real-MySQL row-contention evidence (§37.10 D/E): the
// race fixtures W10-R1..W10-R12 and R-SAL-12/13/14 stay BLOCKED for the
// protected MySQL Gate B campaign and must never be reported as PASS from
// this file.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createDatabase, hashPassword, transaction } from './db.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import { SALES_WAVE10_TABLES } from './migrations/sales-customer-wave10-credit-check.js';
import { createCreditParameter, createCreditRule } from './modules/credit-policy.js';
import { createCreditProfile } from './modules/credit-profile.js';
import {
  computeCreditExposure,
  evaluateCredit,
  isCreditManagementEnabled,
  lockCreditPrepaymentParents,
  resolveApplicableCreditScopes,
  resolveCustomerCreditObject,
} from './modules/credit-check.js';
import {
  decideCreditSpecialApproval,
  requestCreditSpecialApproval,
} from './modules/credit-special-approval.js';
import {
  assertObservedExposure, parseCreditExposureCents, readCreditExposureCents,
  selectCreditExposureRow,
} from './test-utils/wave10-credit-result.js';
import { salesOrderAction } from './modules/sales-orders.js';

const DAY = '2026-10-24';
const CREDIT_OBJECT_TYPE = 'SALES_ORDER';
const CREDIT_OBJECT_ID = 'CREDIT-CUSTOMER-W10';

const ADMIN = Object.freeze({
  id: 'w10-admin', roleCode: 'ADMIN',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE', 'SALES_CROSS_GROUP'],
});
const EVALUATOR = Object.freeze({
  id: 'w10-evaluator', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE'],
});
const VIEWER = Object.freeze({ id: 'w10-viewer', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });

function buildDb() {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave10-'));
  const path = join(temp, 'wave10.db');
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
  const hashed = hashPassword('wave10-1234');
  for (const [id, username] of [['w10-admin', 'w10-admin'], ['w10-evaluator', 'w10-eval'], ['w10-sales', 'w10-sales']]) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, username, username, hashed.hash, hashed.salt, now);
  }
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('cus-w10','CUS-W10','Wave 10 Customer','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES('sp-w10','SP-W10','Salesperson W10','w10-sales',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES('sp-w10-b','SP-W10-B','Salesperson W10 B','w10-admin',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('sg-w10','SG-W10','Sales Group W10','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
    VALUES('mem-w10','sp-w10','sg-w10',1,1,?,NULL,?,?)`).run('2020-01-01', now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
    VALUES('mem-w10-b','sp-w10-b','sg-w10',0,1,?,NULL,?,?)`).run('2020-01-01', now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('wh-w10','WH-W10','Wave 10 Warehouse','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES('p-w10','P-W10','Wave 10 Product','','EA',10000,0,1,?,?)`).run(now, now);
  // The default source document of the shared check fixture. It stays DRAFT so
  // that it never occupies credit exposure.
  seedOrder(db, { id: 'so-w10-1', status: 'DRAFT', totalCents: 0, salespersonId: 'sp-w10' });
}

function response() {
  return {
    statusCode: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

function request(body, key = 'wave10-key') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

async function invoke(handler, db, body, actor = ADMIN, key = 'wave10-key') {
  const res = response();
  await handler(db, request(body, key), res, actor);
  return res;
}

async function invokeFailure(handler, db, body, actor = ADMIN, key = 'wave10-key') {
  try {
    const res = await invoke(handler, db, body, actor, key);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, error };
  }
}

async function invokeWithId(handler, db, body, actor, id, key = 'wave10-key') {
  const res = response();
  try {
    await handler(db, request(body, key), res, actor, id);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, error };
  }
}

async function invokeOrderAction(db, body, actor, orderId, action, key) {
  const res = response();
  try {
    await salesOrderAction(db, request(body, key), res, actor, orderId, action);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, error };
  }
}

function seedParameter(db, code, valueBool, effectiveFrom = '2026-01-01') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,created_at,created_by)
    VALUES(?,?,NULL,NULL,?,NULL,?,NULL,'ACTIVE',?,?)`).run(`param-${code}-${effectiveFrom}`, code, valueBool ? 1 : 0, effectiveFrom, now, 'w10-admin');
}

function seedRule(db, {
  ruleCode = 'SO_LIMIT', businessStage = 'SO_SUBMIT', scenario = 'STANDARD',
  controlStrength = 'BLOCK', recognitionMode = null, effectiveFrom = '2026-01-01', creditItem = 'ORDER_EXPOSURE',
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
      recognition_mode,effective_from,effective_to,status,result_payload_json,created_at,created_by)
    VALUES(?,?,?,?,'BEFORE_WRITE',?,?,?,?,NULL,'ACTIVE','{}',?,?)`)
    .run(`rule-${ruleCode}-${businessStage}`, ruleCode, businessStage, scenario, controlStrength, creditItem,
      recognitionMode, effectiveFrom, now, 'w10-admin');
}

async function seedProfile(db, {
  customerId = 'cus-w10', salespersonId = null, creditLimitCents = 1000000,
  overdueDayPolicy = '15', effectiveFrom = '2026-01-01', status = 'ACTIVE',
} = {}) {
  const res = await invoke(createCreditProfile, db, {
    customerId,
    salespersonId,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: CREDIT_OBJECT_ID,
    creditLimitCents,
    initialState: 'NORMAL',
    status,
    ratingGrade: 'A',
    overdueDayPolicy,
    effectiveFrom,
  }, ADMIN, `profile-${customerId}-${salespersonId || 'agg'}-${effectiveFrom}`);
  assert.equal(res.statusCode, 201);
  return res.body.profile;
}

function seedOrder(db, {
  id = 'so-w10-1', customerId = 'cus-w10', salespersonId = 'sp-w10', status = 'APPROVED',
  totalCents = 100000, orderDate = DAY, creatorId = 'w10-sales', withItem = true,
} = {}) {
  const now = new Date().toISOString();
  // §36.3.2.1 — the exposure window reads `SUBSTR(reviewed_at,1,10)<=businessDate`.
  // The approval stamp therefore has to sit on the order's own business date;
  // a wall-clock stamp would fall outside the window on any later calendar day
  // and would silently drop the approved commitment from the exposure.
  const reviewedAt = `${orderDate}T09:00:00.000Z`;
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,
      reviewer_id,submitted_at,reviewed_at,created_at,updated_at,order_date,requested_delivery_date,payment_terms,
      ship_to_contact_name,ship_to_phone,ship_to_address,payment_terms_days,salesperson_id,sales_group_id,
      settlement_party_id,payer_id,required_prepayment_cents,reservation_intent_state,commercial_close_state,
      gift_summary_cents,effective_version)
    VALUES(?,?,?,?,?,'','',?,NULL,NULL,?,?,?,?,?,'CASH','','','',0,?,NULL,?,?,0,'NONE','OPEN',0,1)`)
    .run(id, id.toUpperCase(), customerId, status, totalCents, creatorId, reviewedAt, now, now, orderDate, orderDate,
      salespersonId, customerId, customerId);
  if (withItem) {
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,'p-w10',1,?,?,1)`).run(`soi-${id}`, id, totalCents, totalCents);
  }
}

function seedDelivery(db, {
  id = 'sd-w10-1', orderId = 'so-w10-1', customerId = 'cus-w10', totalCents = 100000,
  deliveryDate = DAY, confirmedAt = `${DAY}T09:00:00.000Z`, billingMode = 'DIRECT_BILL',
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,
      status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by,billing_mode,
      delivery_notice_id,source_mode)
    VALUES(?,?,?,?,'wh-w10','w10-sales',?,'CONFIRMED',?,'','w10-sales',?,?,?,'w10-sales',?,NULL,'DIRECT_ORDER')`)
    .run(id, id.toUpperCase(), orderId, customerId, totalCents, deliveryDate, now, now, confirmedAt, billingMode);
}

function seedDeliveryItem(db, {
  id = 'sdi-w10-1', deliveryId = 'sd-w10-1', orderItemId = 'soi-so-w10-1', amountCents = 100000,
} = {}) {
  db.prepare(`INSERT INTO sales_delivery_items(
      id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES(?,?,'p-w10',1,?,?,1,?)`).run(id, deliveryId, amountCents, amountCents, orderItemId);
}

function seedSalesInvoice(db, {
  id = 'inv-w10-1', customerId = 'cus-w10', amountCents = 100000, status = 'POSTED', invoiceDate = DAY,
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_invoices(
      id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,
      tax_snapshot_json,creator_id,created_at,posted_by,posted_at)
    VALUES(?,?,?, ?,?,'NO_TAX',?,0,?,'[]','w10-admin',?,'w10-admin',?)`)
    .run(id, id.toUpperCase(), customerId, invoiceDate, status, amountCents, amountCents, now, now);
}

function seedInvoiceSourceLink(db, {
  id = 'link-w10-1', invoiceId = 'inv-w10-1', deliveryId = 'sd-w10-1',
  deliveryItemId = 'sdi-w10-1', amountCents = 100000,
} = {}) {
  db.prepare(`INSERT INTO finance_invoice_source_links(
      id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
    VALUES(?,?,'SALES_INVOICE','SALES_DELIVERY',?,?,1,?,?)`)
    .run(id, invoiceId, deliveryId, deliveryItemId, amountCents, new Date().toISOString());
}

function seedReceivable(db, {
  id = 'ar-w10-1', customerId = 'cus-w10', sourceType = 'SALES_DELIVERY', sourceId = 'sd-w10-1',
  amountCents = 100000, openCents = 100000, itemClass = 'SOURCE', recognitionMode = 'DIRECT_BUSINESS_OPEN_ITEM',
  itemKind = 'FINAL', dueDate = '2026-11-30', businessDate = DAY,
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,
      write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,item_class,
      recognition_mode,item_kind,conversion_state)
    VALUES(?,?,?,?,?,?,0,0,'PENDING',?,'w10-admin',?,?,?,?,?,?,?,'OPEN')`)
    .run(id, id.toUpperCase(), customerId, sourceType, sourceId, amountCents, dueDate, now, businessDate, now,
      openCents, itemClass, recognitionMode, itemKind);
}

function seedPrepayment(db, { id = 'sub-w10-1', customerId = 'cus-w10', amountCents = 50000, businessDate = DAY } = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
      original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
    VALUES(?,'CUSTOMER','PREPAYMENT',?,'MANUAL',?,'MANUAL-W10',?,?,NULL,'OPEN','w10-admin',?)`)
    .run(id, customerId, id, amountCents, businessDate, now);
}

function creditCheckRows(db) {
  return db.prepare('SELECT * FROM credit_check_results ORDER BY scope_type').all();
}

function creditAuditCount(db) {
  return db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_CHECK'").get().count;
}

function checkInput(overrides = {}) {
  return {
    customerId: 'cus-w10',
    salespersonId: 'sp-w10',
    stage: 'SO_SUBMIT',
    businessDate: DAY,
    proposedDeltaCents: 0,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
    sourceRef: { sourceType: 'SALES_ORDER', sourceId: 'so-w10-1' },
    actorId: 'w10-admin',
    authorizationContext: 'w10-admin',
    ...overrides,
  };
}

function runCheck(db, overrides = {}) {
  let outcome;
  transaction(db, () => { outcome = evaluateCredit(db, checkInput(overrides)); });
  return outcome;
}

// ---------------------------------------------------------------------------
// Migration contract
// ---------------------------------------------------------------------------

test('Wave 10 migration creates exactly two additive tables and replays idempotently', () => {
  const handle = buildDb();
  try {
    const present = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE10_TABLES.map(() => '?').join(',')})`).all(...SALES_WAVE10_TABLES);
    assert.deepEqual(present.map((row) => row.name), [...SALES_WAVE10_TABLES].sort());
    const wave11 = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN
      ('credit_evaluation_indicator','credit_evaluation_scheme','credit_evaluation_model',
       'credit_evaluation_scoring_sheet','credit_evaluation_result','credit_recalculation_history')`).all();
    assert.deepEqual(wave11, [], 'Wave 11 tables must not be created by the Wave 10 migration');
    // Replay is a no-op.
    migrateSalesCustomerDomain(handle.db);
    const again = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE10_TABLES.map(() => '?').join(',')})`).all(...SALES_WAVE10_TABLES);
    assert.deepEqual(again.map((row) => row.name), [...SALES_WAVE10_TABLES].sort());
  } finally { handle.cleanup(); }
});

test('Wave 10 tables carry the approved keys, foreign keys and CHECK constraints', () => {
  const handle = buildDb();
  try {
    const resultColumns = handle.db.prepare('PRAGMA table_info(credit_check_results)').all().map((row) => row.name);
    assert.deepEqual(resultColumns, [
      'id', 'check_group_id', 'scope_type', 'credit_lock_anchor_id', 'credit_profile_id', 'credit_policy_snapshot_id',
      'policy_snapshot_fingerprint', 'profile_effective_state_hash', 'sales_order_id', 'sales_delivery_id', 'stage',
      'business_date', 'proposed_delta_cents', 'recognition_mode', 'decision', 'reason_codes_json',
      'component_breakdown_json', 'eligible_prepayment_source_identity', 'evaluated_at', 'evaluated_by',
    ]);
    const resultFks = handle.db.prepare('PRAGMA foreign_key_list(credit_check_results)').all();
    for (const [column, target] of [['credit_lock_anchor_id', 'credit_lock_anchors'], ['credit_policy_snapshot_id', 'credit_policy_snapshots'], ['sales_order_id', 'sales_orders'], ['sales_delivery_id', 'sales_deliveries']]) {
      assert.ok(resultFks.some((row) => row.from === column && row.table === target && row.to === 'id'), `missing FK ${column} -> ${target}`);
    }
    const approvalFks = handle.db.prepare('PRAGMA foreign_key_list(credit_special_approval)').all();
    assert.ok(approvalFks.some((row) => row.from === 'source_credit_check_result_id' && row.table === 'credit_check_results' && row.to === 'id'));
    const approvalSql = handle.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_special_approval'").get().sql;
    assert.match(approvalSql, /UNIQUE \(source_credit_check_result_id\)/);
    const resultSql = handle.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_check_results'").get().sql;
    assert.match(resultSql, /UNIQUE \(check_group_id, scope_type\)/);
    assert.match(resultSql, /sales_order_id IS NOT NULL OR sales_delivery_id IS NOT NULL/);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// §36.6.3 step 1 — the Credit Management gate and the fail-closed rule
// ---------------------------------------------------------------------------

test('S15 — Credit Management disabled leaves the business path untouched', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', false);
    assert.equal(isCreditManagementEnabled(handle.db, DAY), false);
    const outcome = runCheck(handle.db);
    assert.equal(outcome.enforced, false);
    assert.equal(outcome.decision, 'PASS');
    assert.equal(creditCheckRows(handle.db).length, 0);
    assert.equal(creditAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

test('S15 — a stage without any effective rule is not credit-controlled', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    const outcome = runCheck(handle.db);
    assert.equal(outcome.enforced, false);
    assert.deepEqual(outcome.reasonCodes, ['NO_APPLICABLE_EFFECTIVE_RULE']);
    assert.equal(creditCheckRows(handle.db).length, 0);
    assert.equal(creditAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

test('S15 — a missing mandatory profile fails closed and leaves no evidence', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    let failure = null;
    try {
      transaction(handle.db, () => { evaluateCredit(handle.db, checkInput()); });
    } catch (error) { failure = error; }
    assert.ok(failure, 'a missing mandatory profile must fail closed');
    assert.equal(failure.status, 409);
    assert.equal(failure.code, 'CREDIT_PROFILE_MISSING');
    assert.equal(creditCheckRows(handle.db).length, 0);
    assert.equal(creditAuditCount(handle.db), 0);
  } finally { handle.cleanup(); }
});

test('B-9 O2 — SUSPENDED and CLOSED aggregate Profiles fail closed with the status-specific error', async () => {
  for (const status of ['SUSPENDED', 'CLOSED']) {
    const handle = buildDb();
    try {
      seedBase(handle.db);
      seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
      seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
      await seedProfile(handle.db, { status });
      assert.throws(
        () => transaction(handle.db, () => evaluateCredit(handle.db, checkInput())),
        (error) => error.status === 409 && error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE'
          && error.details?.profileStatus === status && error.details?.scopeType === 'CUSTOMER_AGGREGATE',
      );
      assert.equal(creditCheckRows(handle.db).length, 0);
      assert.equal(creditAuditCount(handle.db), 0);
    } finally { handle.cleanup(); }
  }
});

test('B-9 O2 — a non-ACTIVE salesperson Profile cannot fall back to the ACTIVE aggregate', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db);
    await seedProfile(handle.db, { salespersonId: 'sp-w10', status: 'SUSPENDED' });
    assert.throws(
      () => transaction(handle.db, () => evaluateCredit(handle.db, checkInput())),
      (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE'
        && error.details?.scopeType === 'SALESPERSON_SUB_LIMIT',
    );
    assert.equal(creditCheckRows(handle.db).length, 0);
  } finally { handle.cleanup(); }
});

test('B-9 O2 — a later effective ACTIVE Profile restores eligibility without falling back', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { status: 'SUSPENDED', effectiveFrom: '2026-01-01' });
    await seedProfile(handle.db, { status: 'ACTIVE', effectiveFrom: DAY });
    const outcome = runCheck(handle.db);
    assert.equal(outcome.decision, 'PASS');
    assert.equal(outcome.scopeResults[0].creditProfileId,
      handle.db.prepare('SELECT id FROM credit_profile WHERE effective_from=?').get(DAY).id);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// UAT-S-32 — the decision semantics
// ---------------------------------------------------------------------------

test('UAT-S-32 — a within-limit scope is PASS and commits one result row plus its audit', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 100000 });
    assert.equal(outcome.decision, 'PASS');
    const rows = creditCheckRows(handle.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope_type, 'CUSTOMER_AGGREGATE');
    assert.equal(rows[0].decision, 'PASS');
    assert.equal(rows[0].proposed_delta_cents, 100000);
    assert.equal(creditAuditCount(handle.db), 1);
  } finally { handle.cleanup(); }
});

test('UAT-S-32 — an over-limit scope is BLOCK and the business refusal rolls the evidence back', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    let failure = null;
    try {
      transaction(handle.db, () => {
        const outcome = evaluateCredit(handle.db, checkInput({ proposedDeltaCents: 200000 }));
        assert.equal(outcome.decision, 'BLOCK');
        throw new Error('unreachable');
      });
    } catch (error) { failure = error; }
    assert.ok(failure);
    assert.equal(creditCheckRows(handle.db).length, 0, 'a refused decision must leave no credit_check_results row');
    assert.equal(creditAuditCount(handle.db), 0, 'a refused decision must leave no audit row');
  } finally { handle.cleanup(); }
});

test('UAT-S-32 — a WARNING rule yields WARNING and never refuses', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    assert.equal(outcome.decision, 'WARNING');
    assert.equal(creditCheckRows(handle.db)[0].decision, 'WARNING');
  } finally { handle.cleanup(); }
});

test('UAT-S-32 — an OVERRIDE_REQUEST scenario yields SPECIAL_APPROVAL_REQUIRED', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    assert.equal(outcome.decision, 'SPECIAL_APPROVAL_REQUIRED');
    assert.equal(creditCheckRows(handle.db)[0].decision, 'SPECIAL_APPROVAL_REQUIRED');
  } finally { handle.cleanup(); }
});

test('§36.3.1 — a salesperson sub-limit profile without the P5 permission fails closed', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedParameter(handle.db, 'CREDIT_SUB_LIMIT_ONLY_ALLOWED', false);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 100000 });
    let failure = null;
    try { runCheck(handle.db); } catch (error) { failure = error; }
    assert.ok(failure);
    assert.equal(failure.code, 'P5_SUB_LIMIT_ONLY');
    assert.equal(creditCheckRows(handle.db).length, 0);
  } finally { handle.cleanup(); }
});

test('§36.3.1 — a salesperson-only scope is enforceable when P5 permits it', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedParameter(handle.db, 'CREDIT_SUB_LIMIT_ONLY_ALLOWED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 50000 });
    assert.equal(outcome.decision, 'PASS');
    assert.deepEqual(outcome.scopeResults.map((row) => row.scopeType), ['SALESPERSON_SUB_LIMIT']);
  } finally { handle.cleanup(); }
});

test('P3 — both scopes must pass; an aggregate PASS never releases a sub-limit BLOCK', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 50000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    assert.equal(outcome.decision, 'BLOCK');
    const byScope = Object.fromEntries(outcome.scopeResults.map((row) => [row.scopeType, row]));
    assert.equal(byScope.CUSTOMER_AGGREGATE.decision, 'PASS');
    assert.equal(byScope.SALESPERSON_SUB_LIMIT.decision, 'BLOCK');
    const rows = creditCheckRows(handle.db);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.check_group_id)).size, 1, 'one logical check shares one check_group_id');
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// §36.3.2 / UAT-S-31 — the PURE_DERIVED exposure projection
// ---------------------------------------------------------------------------

test('UAT-S-31 — an approved SO commitment counts once and never twice', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-a', totalCents: 40000, salespersonId: 'sp-w10' });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.approvedSoCommitmentCents, 40000);
    assert.equal(exposure.aggregateComponents.arOpenCents, 0);
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 0);
  } finally { handle.cleanup(); }
});

test('UAT-S-31 — the SO commitment transitions to the delivered stage exactly once', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-a', totalCents: 40000, salespersonId: 'sp-w10' });
    seedDelivery(handle.db, { id: 'sd-a', orderId: 'so-a', totalCents: 40000 });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.approvedSoCommitmentCents, 0, 'the delivered portion leaves the SO commitment stage');
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 40000);
    assert.equal(exposure.aggregateComponents.arOpenCents, 0);
    const total = exposure.aggregateComponents.approvedSoCommitmentCents
      + exposure.aggregateComponents.deliveredNotSettledCents
      + exposure.aggregateComponents.arOpenCents;
    assert.equal(total, 40000, 'the obligation is counted exactly once');
  } finally { handle.cleanup(); }
});

test('UAT-S-31 — a final AR open item replaces the delivered stage and is never added to it', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-a', totalCents: 40000, salespersonId: 'sp-w10' });
    seedDelivery(handle.db, { id: 'sd-a', orderId: 'so-a', totalCents: 40000 });
    seedReceivable(handle.db, { id: 'ar-a', sourceType: 'SALES_DELIVERY', sourceId: 'sd-a', amountCents: 40000, openCents: 40000 });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.approvedSoCommitmentCents, 0);
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 0);
    assert.equal(exposure.aggregateComponents.arOpenCents, 40000);
  } finally { handle.cleanup(); }
});

test('UAT-S-31 — a settled AR open item is released and no longer occupies exposure', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-a', totalCents: 40000, salespersonId: 'sp-w10' });
    seedDelivery(handle.db, { id: 'sd-a', orderId: 'so-a', totalCents: 40000 });
    seedReceivable(handle.db, { id: 'ar-a', sourceType: 'SALES_DELIVERY', sourceId: 'sd-a', amountCents: 40000, openCents: 0 });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.arOpenCents, 0);
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 0);
  } finally { handle.cleanup(); }
});

test('§36.3.2 — the eligible prepayment is an aggregate-only offset', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 1000000 });
    seedPrepayment(handle.db, { amountCents: 30000 });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.eligiblePrepaymentCents, 0, 'the projection itself never offsets; the check applies the Finance offset');
    const outcome = runCheck(handle.db);
    const aggregate = outcome.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const salesperson = outcome.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(aggregate.exposureCents, -30000);
    assert.equal(salesperson.exposureCents, 0, 'prepayment never reduces a salesperson sub-limit');
  } finally { handle.cleanup(); }
});

test('§36.3.2.1 — a provably attributable AR open item counts in full in the sub-limit', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-a', totalCents: 50000, salespersonId: 'sp-w10' });
    seedDelivery(handle.db, { id: 'sd-a', orderId: 'so-a', totalCents: 50000 });
    seedReceivable(handle.db, { id: 'ar-a', sourceType: 'SALES_DELIVERY', sourceId: 'sd-a', amountCents: 50000, openCents: 50000 });
    const outcome = runCheck(handle.db);
    const salesperson = outcome.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(salesperson.exposureCents, 50000);
  } finally { handle.cleanup(); }
});

test('W10-R9 / W10-R10 — an ambiguous AR blocks the mandatory sub-limit while the aggregate counts it in full', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 1000000 });
    // A consolidated AR carries no Sales source chain, so no order stage can
    // be released from it and the aggregate counts the ambiguous amount in
    // full.
    seedReceivable(handle.db, {
      id: 'ar-a', sourceType: 'MANUAL', sourceId: 'cus-w10', amountCents: 50000, openCents: 50000, itemClass: 'LEGACY',
    });
    const outcome = runCheck(handle.db);
    const aggregate = outcome.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const salesperson = outcome.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(aggregate.exposureCents, 50000);
    assert.equal(salesperson.decision, 'BLOCK');
    assert.ok(salesperson.reasonCodes.includes('UNPROVEN_ATTRIBUTION'));
    assert.equal(outcome.decision, 'BLOCK');
  } finally { handle.cleanup(); }
});

test('W10-R9 — the sub-limit survives the SO to AR transition', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 60000 });
    seedOrder(handle.db, { id: 'so-old', totalCents: 50000, salespersonId: 'sp-w10' });
    seedDelivery(handle.db, { id: 'sd-old', orderId: 'so-old', totalCents: 50000 });
    seedReceivable(handle.db, { id: 'ar-old', sourceType: 'SALES_DELIVERY', sourceId: 'sd-old', amountCents: 50000, openCents: 50000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 20000 });
    const aggregate = outcome.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const salesperson = outcome.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(salesperson.exposureCents, 50000);
    assert.equal(salesperson.proposedTotalCents, 70000);
    assert.equal(salesperson.decision, 'BLOCK');
    assert.equal(aggregate.exposureCents, 50000);
    assert.equal(aggregate.proposedTotalCents, 70000);
    assert.equal(aggregate.decision, 'PASS');
    assert.equal(outcome.decision, 'BLOCK');
  } finally { handle.cleanup(); }
});

test('B-10 O1 — an old unresolved approved SO remains reserved across arbitrary age boundaries', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-old', totalCents: 100000, orderDate: '2010-01-01' });
    handle.db.prepare("UPDATE sales_orders SET reviewed_at='2010-01-02T00:00:00.000Z' WHERE id='so-old'").run();
    const now = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    const future = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: '2036-10-24' });
    assert.equal(now.aggregateComponents.approvedSoCommitmentCents, 100000);
    assert.equal(future.aggregateComponents.approvedSoCommitmentCents, 100000);
  } finally { handle.cleanup(); }
});

test('B-10 O1 — canonical cancel releases only undelivered commitment; controlled close preserves delivered exposure', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-cancel', totalCents: 100000 });
    handle.db.prepare("UPDATE sales_orders SET commercial_close_state='CANCELLED' WHERE id='so-cancel'").run();
    seedOrder(handle.db, { id: 'so-close', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-close', orderId: 'so-close', totalCents: 40000 });
    handle.db.prepare("UPDATE sales_orders SET commercial_close_state='CLOSED' WHERE id='so-close'").run();
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.approvedSoCommitmentCents, 0);
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 40000);
  } finally { handle.cleanup(); }
});

test('S14 — Mode B invoice AR releases the delivered bucket exactly once', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-mode-b', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-mode-b', orderId: 'so-mode-b', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-mode-b', deliveryId: 'sd-mode-b', orderItemId: 'soi-so-mode-b', amountCents: 100000 });
    seedSalesInvoice(handle.db, { id: 'inv-mode-b', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-mode-b', invoiceId: 'inv-mode-b', deliveryId: 'sd-mode-b', deliveryItemId: 'sdi-mode-b', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-mode-b', sourceType: 'SALES_INVOICE', sourceId: 'inv-mode-b', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.deepEqual(exposure.aggregateComponents, {
      approvedSoCommitmentCents: 0, deliveredNotSettledCents: 0, arOpenCents: 100000,
      eligiblePrepaymentCents: 0, ambiguousAttributionCents: 0,
    });
    assert.equal(exposure.salespersonComponents.arOpenCents, 100000);
  } finally { handle.cleanup(); }
});

test('S14 — Mode C conversion replaces provisional/delivered exposure with one final AR', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-mode-c', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-mode-c', orderId: 'so-mode-c', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-mode-c', deliveryId: 'sd-mode-c', orderItemId: 'soi-so-mode-c', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-prov-c', sourceType: 'SALES_DELIVERY', sourceId: 'sd-mode-c', recognitionMode: 'PROVISIONAL_TO_FINANCIAL', itemKind: 'PROVISIONAL' });
    const before = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(before.aggregateComponents.arOpenCents, 100000);
    assert.equal(before.aggregateComponents.deliveredNotSettledCents, 0);
    handle.db.prepare("UPDATE account_receivables SET conversion_state='CONVERTED',open_amount_cents=0 WHERE id='ar-prov-c'").run();
    seedSalesInvoice(handle.db, { id: 'inv-mode-c', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-mode-c', invoiceId: 'inv-mode-c', deliveryId: 'sd-mode-c', deliveryItemId: 'sdi-mode-c', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-final-c', sourceType: 'SALES_INVOICE', sourceId: 'inv-mode-c', recognitionMode: 'PROVISIONAL_TO_FINANCIAL' });
    const after = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(after.aggregateComponents.deliveredNotSettledCents, 0);
    assert.equal(after.aggregateComponents.arOpenCents, 100000);
  } finally { handle.cleanup(); }
});

test('S14 — a 40000 partial invoice conserves 60000 delivered plus 40000 AR', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-partial', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-partial', orderId: 'so-partial', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-partial', deliveryId: 'sd-partial', orderItemId: 'soi-so-partial', amountCents: 100000 });
    seedSalesInvoice(handle.db, { id: 'inv-partial', amountCents: 40000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-partial', invoiceId: 'inv-partial', deliveryId: 'sd-partial', deliveryItemId: 'sdi-partial', amountCents: 40000 });
    seedReceivable(handle.db, { id: 'ar-partial', sourceType: 'SALES_INVOICE', sourceId: 'inv-partial', amountCents: 40000, openCents: 40000, recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 60000);
    assert.equal(exposure.aggregateComponents.arOpenCents, 40000);
  } finally { handle.cleanup(); }
});

test('S14 — partially collected invoice AR remains attributable when every source has one salesperson', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-collected', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-collected', orderId: 'so-collected', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-collected', deliveryId: 'sd-collected', orderItemId: 'soi-so-collected', amountCents: 100000 });
    seedSalesInvoice(handle.db, { id: 'inv-collected', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-collected', invoiceId: 'inv-collected', deliveryId: 'sd-collected', deliveryItemId: 'sdi-collected', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-collected', sourceType: 'SALES_INVOICE', sourceId: 'inv-collected', amountCents: 100000, openCents: 40000, recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.arOpenCents, 40000);
    assert.equal(exposure.salespersonComponents.arOpenCents, 40000);
    assert.equal(exposure.hasAmbiguousAttribution, false);
  } finally { handle.cleanup(); }
});

test('S14 — a partially settled multi-salesperson invoice is not apportioned and blocks attribution proof', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-multi-a', totalCents: 50000, salespersonId: 'sp-w10' });
    seedOrder(handle.db, { id: 'so-multi-b', totalCents: 50000, salespersonId: 'sp-w10-b' });
    seedDelivery(handle.db, { id: 'sd-multi-a', orderId: 'so-multi-a', totalCents: 50000 });
    seedDelivery(handle.db, { id: 'sd-multi-b', orderId: 'so-multi-b', totalCents: 50000 });
    seedDeliveryItem(handle.db, { id: 'sdi-multi-a', deliveryId: 'sd-multi-a', orderItemId: 'soi-so-multi-a', amountCents: 50000 });
    seedDeliveryItem(handle.db, { id: 'sdi-multi-b', deliveryId: 'sd-multi-b', orderItemId: 'soi-so-multi-b', amountCents: 50000 });
    seedSalesInvoice(handle.db, { id: 'inv-multi', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-multi-a', invoiceId: 'inv-multi', deliveryId: 'sd-multi-a', deliveryItemId: 'sdi-multi-a', amountCents: 50000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-multi-b', invoiceId: 'inv-multi', deliveryId: 'sd-multi-b', deliveryItemId: 'sdi-multi-b', amountCents: 50000 });
    seedReceivable(handle.db, { id: 'ar-multi', sourceType: 'SALES_INVOICE', sourceId: 'inv-multi', amountCents: 100000, openCents: 40000, recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY });
    assert.equal(exposure.aggregateComponents.arOpenCents, 40000);
    assert.equal(exposure.aggregateComponents.deliveredNotSettledCents, 0);
    assert.equal(exposure.salespersonComponents.arOpenCents, 0);
    assert.equal(exposure.ambiguousAttributionCents, 40000);
  } finally { handle.cleanup(); }
});

test('S14 — missing or inconsistent invoice allocation evidence fails closed', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedOrder(handle.db, { id: 'so-bad-link', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-bad-link', orderId: 'so-bad-link', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-bad-link', deliveryId: 'sd-bad-link', orderItemId: 'soi-so-bad-link', amountCents: 100000 });
    seedSalesInvoice(handle.db, { id: 'inv-bad-link', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-bad-link', invoiceId: 'inv-bad-link', deliveryId: 'sd-bad-link', deliveryItemId: 'sdi-bad-link', amountCents: 90000 });
    seedReceivable(handle.db, { id: 'ar-bad-link', sourceType: 'SALES_INVOICE', sourceId: 'inv-bad-link', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    assert.throws(
      () => computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY }),
      (error) => error.status === 409 && error.code === 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT',
    );
  } finally { handle.cleanup(); }
});

test('S14 — an unknown invoice source and a cross-customer source link both fail closed', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedSalesInvoice(handle.db, { id: 'inv-no-links', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-no-links', sourceType: 'SALES_INVOICE', sourceId: 'inv-no-links', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    assert.throws(
      () => computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY }),
      (error) => error.code === 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT' && error.details?.reason === 'INVOICE_SOURCE_LINK_MISSING',
    );
    handle.db.prepare("DELETE FROM account_receivables WHERE id='ar-no-links'").run();

    const now = new Date().toISOString();
    handle.db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('cus-other','CUS-OTHER','Other Customer','','','',1,?,?)`).run(now, now);
    seedOrder(handle.db, { id: 'so-other', customerId: 'cus-other', totalCents: 100000 });
    seedDelivery(handle.db, { id: 'sd-other', orderId: 'so-other', customerId: 'cus-other', totalCents: 100000 });
    seedDeliveryItem(handle.db, { id: 'sdi-other', deliveryId: 'sd-other', orderItemId: 'soi-so-other', amountCents: 100000 });
    seedSalesInvoice(handle.db, { id: 'inv-cross', amountCents: 100000 });
    seedInvoiceSourceLink(handle.db, { id: 'link-cross', invoiceId: 'inv-cross', deliveryId: 'sd-other', deliveryItemId: 'sdi-other', amountCents: 100000 });
    seedReceivable(handle.db, { id: 'ar-cross', sourceType: 'SALES_INVOICE', sourceId: 'inv-cross', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    assert.throws(
      () => computeCreditExposure(handle.db, { customerId: 'cus-w10', salespersonId: 'sp-w10', businessDate: DAY }),
      (error) => error.code === 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT' && error.details?.reason === 'CROSS_CUSTOMER_SOURCE_LINK',
    );
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Recognition mode partition
// ---------------------------------------------------------------------------

test('Recognition mode partition — a mode-scoped rule applies only to its own mode', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { ruleCode: 'INVOICE_ONLY', businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    const direct = runCheck(handle.db, { recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM', proposedDeltaCents: 2000000 });
    assert.equal(direct.decision, 'PASS', 'a rule scoped to another recognition mode does not apply');
    assert.equal(direct.enforced, false);
    assert.deepEqual(direct.reasonCodes, ['NO_APPLICABLE_EFFECTIVE_RULE']);
    assert.equal(creditCheckRows(handle.db).length, 0);
    assert.equal(creditAuditCount(handle.db), 0);
    const invoice = runCheck(handle.db, { recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM', proposedDeltaCents: 2000000 });
    assert.equal(invoice.decision, 'BLOCK');
  } finally { handle.cleanup(); }
});

test('Recognition mode coverage — global plus mode-specific rules retain the strongest applicable outcome', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { ruleCode: 'GLOBAL_WARNING', businessStage: 'SO_SUBMIT', scenario: 'WARNING_ONLY', controlStrength: 'WARNING' });
    seedRule(handle.db, { ruleCode: 'MODE_BLOCK', businessStage: 'SO_SUBMIT', scenario: 'BLOCK', controlStrength: 'BLOCK', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const direct = runCheck(handle.db, { recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM', proposedDeltaCents: 200000 });
    assert.equal(direct.decision, 'WARNING');
    const invoice = runCheck(handle.db, { recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM', proposedDeltaCents: 200000 });
    assert.equal(invoice.decision, 'BLOCK');
  } finally { handle.cleanup(); }
});

test('Recognition mode partition — the three frozen V22 modes are all accepted', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    for (const mode of ['DIRECT_BUSINESS_OPEN_ITEM', 'INVOICE_DRIVEN_OPEN_ITEM', 'PROVISIONAL_TO_FINANCIAL']) {
      const outcome = runCheck(handle.db, { recognitionMode: mode });
      assert.equal(outcome.recognitionMode, mode);
      assert.equal(outcome.decision, 'PASS');
    }
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Idempotency and replay
// ---------------------------------------------------------------------------

test('§36.6.3 step 2 — an exact replay resolves the same check group without a second effect', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    const first = runCheck(handle.db, { proposedDeltaCents: 100000 });
    const second = runCheck(handle.db, { proposedDeltaCents: 100000 });
    assert.equal(first.checkGroupId, second.checkGroupId);
    assert.equal(second.replayed, true);
    assert.equal(creditCheckRows(handle.db).length, 1);
    assert.equal(creditAuditCount(handle.db), 1);
  } finally { handle.cleanup(); }
});

test('§36.6.3 step 2 — a changed exposure produces a new decision instead of a stale replay', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    const first = runCheck(handle.db, { proposedDeltaCents: 100000 });
    seedOrder(handle.db, { id: 'so-later', totalCents: 950000, salespersonId: 'sp-w10' });
    const second = runCheck(handle.db, { proposedDeltaCents: 100000 });
    assert.notEqual(first.checkGroupId, second.checkGroupId);
    assert.equal(second.decision, 'BLOCK');
    assert.equal(creditCheckRows(handle.db).length, 2);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// UAT-S-33 / S16 / R-SAL-13 — the Credit Special Approval
// ---------------------------------------------------------------------------

async function prepareApprovalScenario(db, { scopeMode = 'ONE_TIME', decision = 'APPROVED' } = {}) {
  seedBase(db);
  seedParameter(db, 'CREDIT_MANAGEMENT_ENABLED', true);
  seedRule(db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
  await seedProfile(db, { creditLimitCents: 100000 });
  const outcome = runCheck(db, { proposedDeltaCents: 200000 });
  assert.equal(outcome.decision, 'SPECIAL_APPROVAL_REQUIRED');
  const result = creditCheckRows(db)[0];
  const requestRes = await invoke(requestCreditSpecialApproval, db, {
    sourceCreditCheckResultId: result.id,
    reason: '客户战略订单，申请超限放行',
    requestedOverrideCents: 100000,
    requestedCeilingCents: 200000,
    requestedExpiryBusinessDate: '2026-12-31',
    scopeMode,
  }, EVALUATOR, 'approval-request-1');
  assert.equal(requestRes.statusCode, 201);
  const decideRes = await invokeWithId(decideCreditSpecialApproval, db, {
    decision,
    approvedOverrideCents: 100000,
    approvedCeilingCents: 200000,
    approvedExpiryBusinessDate: '2026-12-31',
    reason: '已核实客户资信',
  }, ADMIN, requestRes.body.approval.id, 'approval-decide-1');
  assert.equal(decideRes.statusCode, 200);
  return { approval: requestRes.body.approval, result, decide: decideRes.body.approval };
}

test('UAT-S-33 — an approved special approval releases exactly its own scope', async () => {
  const handle = buildDb();
  try {
    const { approval, decide } = await prepareApprovalScenario(handle.db);
    assert.equal(decide.decision, 'APPROVED');
    assert.equal(decide.approvedCeilingCents, 200000);
    assert.equal(decide.approvedOverrideCents, 100000);
    assert.equal(approval.decision, 'PENDING');
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    assert.equal(outcome.decision, 'PASS');
    assert.ok(outcome.scopeResults[0].reasonCodes.includes('SPECIAL_APPROVAL_CONSUMED'));
    assert.equal(outcome.consumedSpecialApprovalId, approval.id);
  } finally { handle.cleanup(); }
});

test('B-9 O2 — an approved Special Approval cannot cross a newly non-ACTIVE Profile fence', async () => {
  const handle = buildDb();
  try {
    await prepareApprovalScenario(handle.db);
    handle.db.prepare("UPDATE credit_profile SET status='SUSPENDED'").run();
    assert.throws(
      () => transaction(handle.db, () => evaluateCredit(handle.db, checkInput({ proposedDeltaCents: 200000 }))),
      (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE',
    );
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND action='CONSUME'").get().count, 0);
  } finally { handle.cleanup(); }
});

test('W10-R7 / S16 — an approval on the aggregate scope never releases the sub-limit scope', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    await seedProfile(handle.db, { salespersonId: 'sp-w10', creditLimitCents: 50000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    assert.equal(outcome.decision, 'SPECIAL_APPROVAL_REQUIRED');
    const aggregate = outcome.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const salesperson = outcome.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(aggregate.decision, 'SPECIAL_APPROVAL_REQUIRED');
    assert.equal(salesperson.decision, 'SPECIAL_APPROVAL_REQUIRED');

    // Approve the aggregate scope only.
    const aggregateRow = creditCheckRows(handle.db).find((row) => row.scope_type === 'CUSTOMER_AGGREGATE');
    const requestRes = await invoke(requestCreditSpecialApproval, handle.db, {
      sourceCreditCheckResultId: aggregateRow.id,
      reason: '客户战略订单，申请超限放行',
      requestedOverrideCents: 100000,
      requestedCeilingCents: 200000,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    }, EVALUATOR, 'aggregate-approval');
    assert.equal(requestRes.statusCode, 201);
    const decideRes = await invokeWithId(decideCreditSpecialApproval, handle.db, {
      decision: 'APPROVED',
      approvedOverrideCents: 100000,
      approvedCeilingCents: 200000,
      approvedExpiryBusinessDate: '2026-12-31',
    }, ADMIN, requestRes.body.approval.id, 'aggregate-decide');
    assert.equal(decideRes.statusCode, 200);

    const after = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const releasedAggregate = after.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const stillBlocked = after.scopeResults.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.equal(releasedAggregate.decision, 'PASS');
    assert.equal(stillBlocked.decision, 'SPECIAL_APPROVAL_REQUIRED', 'an aggregate approval never releases a sub-limit scope');
    assert.equal(after.decision, 'SPECIAL_APPROVAL_REQUIRED');
  } finally { handle.cleanup(); }
});

test('S16 — a requester may never approve their own request', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const result = creditCheckRows(handle.db)[0];
    const requestRes = await invoke(requestCreditSpecialApproval, handle.db, {
      sourceCreditCheckResultId: result.id,
      reason: '申请超限放行',
      requestedOverrideCents: 100000,
      requestedCeilingCents: 200000,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    }, ADMIN, 'sod-request');
    assert.equal(requestRes.statusCode, 201);
    const decide = await invokeWithId(decideCreditSpecialApproval, handle.db, {
      decision: 'APPROVED',
      approvedOverrideCents: 100000,
      approvedCeilingCents: 200000,
      approvedExpiryBusinessDate: '2026-12-31',
    }, ADMIN, requestRes.body.approval.id, 'sod-decide');
    assert.equal(decide.statusCode, 409);
    assert.equal(decide.code, 'CREDIT_SPECIAL_APPROVAL_SOD');
  } finally { handle.cleanup(); }
});

test('S16 — the requested ceiling may never exceed the frozen authority ceiling', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const result = creditCheckRows(handle.db)[0];
    const failure = await invokeFailure(requestCreditSpecialApproval, handle.db, {
      sourceCreditCheckResultId: result.id,
      reason: '申请超限放行',
      requestedOverrideCents: 999999999,
      requestedCeilingCents: 999999999,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    }, EVALUATOR, 'ceiling-request');
    assert.equal(failure.statusCode, 409);
    assert.equal(failure.code, 'CREDIT_SPECIAL_APPROVAL_AUTHORITY_EXCEEDED');
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_special_approval').get().count, 0);
  } finally { handle.cleanup(); }
});

test('S16 — an expiry in the past is refused', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const result = creditCheckRows(handle.db)[0];
    const failure = await invokeFailure(requestCreditSpecialApproval, handle.db, {
      sourceCreditCheckResultId: result.id,
      reason: '申请超限放行',
      requestedOverrideCents: 100000,
      requestedCeilingCents: 200000,
      requestedExpiryBusinessDate: '2020-01-01',
      scopeMode: 'ONE_TIME',
    }, EVALUATOR, 'expiry-request');
    assert.equal(failure.statusCode, 409);
    assert.equal(failure.code, 'CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST');
  } finally { handle.cleanup(); }
});

test('§36.6.6 — a duplicate request for the same check result is refused', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const result = creditCheckRows(handle.db)[0];
    const body = {
      sourceCreditCheckResultId: result.id,
      reason: '申请超限放行',
      requestedOverrideCents: 100000,
      requestedCeilingCents: 200000,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    };
    const first = await invoke(requestCreditSpecialApproval, handle.db, body, EVALUATOR, 'dup-1');
    assert.equal(first.statusCode, 201);
    const second = await invokeFailure(requestCreditSpecialApproval, handle.db, body, EVALUATOR, 'dup-2');
    assert.equal(second.statusCode, 409);
    assert.equal(second.code, 'CREDIT_SPECIAL_APPROVAL_ALREADY_REQUESTED');
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_special_approval').get().count, 1);
  } finally { handle.cleanup(); }
});

test('§34.7 P2 — the negative authorization tests for the Wave 10 endpoints', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 200000 });
    const result = creditCheckRows(handle.db)[0];
    const body = {
      sourceCreditCheckResultId: result.id,
      reason: '申请超限放行',
      requestedOverrideCents: 100000,
      requestedCeilingCents: 200000,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    };
    const denied = await invokeFailure(requestCreditSpecialApproval, handle.db, body, VIEWER, 'denied-request');
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.code, 'CREDIT_SPECIAL_APPROVAL_DENIED');
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_special_approval').get().count, 0);
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL'").get().count, 0);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Business path integration — SO Approve
// ---------------------------------------------------------------------------

test('§36.6.1 — Sales Order Approve is credit-controlled and a refusal leaves no evidence', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_APPROVE', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 100000 });
    seedOrder(handle.db, { id: 'so-approve', status: 'SUBMITTED', totalCents: 500000, salespersonId: 'sp-w10', creatorId: 'w10-sales' });
    handle.db.prepare("UPDATE sales_orders SET reviewed_at=NULL, submitted_at=? WHERE id='so-approve'").run(new Date().toISOString());
    const approver = { id: 'w10-admin', roleCode: 'ADMIN', permissions: ['ORDERS_APPROVE', 'CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE'] };
    const failure = await invokeOrderAction(handle.db, { reason: '同意' }, approver, 'so-approve', 'approve', 'approve-blocked');
    assert.ok(failure.error, 'the approval must be refused');
    assert.equal(failure.error.status, 409);
    assert.equal(failure.error.code, 'CREDIT_CHECK_BLOCKED');
    assert.equal(handle.db.prepare("SELECT status FROM sales_orders WHERE id='so-approve'").get().status, 'SUBMITTED');
    assert.equal(creditCheckRows(handle.db).length, 0, 'a refused approval leaves no credit_check_results row');
    assert.equal(creditAuditCount(handle.db), 0, 'a refused approval leaves no Credit audit row');
  } finally { handle.cleanup(); }
});

test('§36.6.1 — Sales Order Approve inside the credit ceiling commits its evidence', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_APPROVE', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    seedOrder(handle.db, { id: 'so-approve', status: 'SUBMITTED', totalCents: 500000, salespersonId: 'sp-w10', creatorId: 'w10-sales' });
    const approver = { id: 'w10-admin', roleCode: 'ADMIN', permissions: ['ORDERS_APPROVE', 'CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE'] };
    const res = await invokeOrderAction(handle.db, { reason: '同意' }, approver, 'so-approve', 'approve', 'approve-ok');
    assert.equal(res.statusCode, 200);
    assert.equal(handle.db.prepare("SELECT status FROM sales_orders WHERE id='so-approve'").get().status, 'APPROVED');
    const rows = creditCheckRows(handle.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stage, 'SO_APPROVE');
    assert.equal(rows[0].proposed_delta_cents, 500000);
    assert.equal(creditAuditCount(handle.db), 1);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('§36.3.1 — the scope resolver is a pure function of the supplied profile rows', () => {
  const aggregate = { id: 'p-agg', status: 'ACTIVE' };
  const salesperson = { id: 'p-sp', status: 'ACTIVE' };
  assert.deepEqual(resolveApplicableCreditScopes({ aggregateProfile: aggregate, salespersonProfile: null }).scopes.map((s) => s.scopeType), ['CUSTOMER_AGGREGATE']);
  assert.deepEqual(
    resolveApplicableCreditScopes({ aggregateProfile: aggregate, salespersonProfile: salesperson, salespersonId: 'sp' }).scopes.map((s) => s.scopeType),
    ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT'],
  );
  assert.equal(resolveApplicableCreditScopes({ aggregateProfile: null, salespersonProfile: null }).applicable, false);
  const onlySub = resolveApplicableCreditScopes({ aggregateProfile: null, salespersonProfile: salesperson, salespersonId: 'sp', subLimitOnlyAllowed: false });
  assert.equal(onlySub.applicable, false);
  assert.equal(onlySub.failClosed[0].code, 'P5_SUB_LIMIT_ONLY');
});

test('§36.4 — the Credit Check acquires the Finance PREPAYMENT parent lock through the frozen pattern', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedPrepayment(handle.db, { id: 'sub-lock-1' });
    const planned = lockCreditPrepaymentParents(handle.db, { customerId: 'cus-w10', businessDate: DAY });
    assert.deepEqual(planned, ['sub-lock-1']);
  } finally { handle.cleanup(); }
});

test('§36.4 — the credit object is resolved from the effective profiles', () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    const fallback = resolveCustomerCreditObject(handle.db, { customerId: 'cus-w10', businessDate: DAY });
    assert.deepEqual(fallback, { creditObjectType: 'CUSTOMER', creditObjectId: 'cus-w10' });
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// REVIEW-P1-01 — the persisted exposure breakdown and the assertion read path
//
// `credit_check_results` has no `exposure_cents` column. The production
// writer stores the observed exposure inside `component_breakdown_json`, so
// the assertion must read that document of one exact check group. This test
// runs the real production writer on SQLite and proves that the persisted
// document and the assertion read path describe the same fact.
// ---------------------------------------------------------------------------

test('REVIEW-P1-01 — the persisted exposure breakdown carries the exposure the assertion reads', async () => {
  const handle = buildDb();
  try {
    seedBase(handle.db);
    seedParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', true);
    seedRule(handle.db, { businessStage: 'SO_SUBMIT', controlStrength: 'BLOCK' });
    await seedProfile(handle.db, { creditLimitCents: 1000000 });
    // A committed approved order occupies the approved-commitment stage.
    seedOrder(handle.db, { id: 'so-w10-exp', status: 'APPROVED', totalCents: 120000 });
    const outcome = runCheck(handle.db, { proposedDeltaCents: 0 });
    assert.equal(outcome.decision, 'PASS');

    // The persisted row is found by the check group the production evaluation
    // returned — never by the newest row.
    const rows = handle.db.prepare(`SELECT check_group_id,scope_type,component_breakdown_json
      FROM credit_check_results`).all();
    const row = selectCreditExposureRow(rows, outcome.checkGroupId, 'CUSTOMER_AGGREGATE');
    assert.equal(row.check_group_id, outcome.checkGroupId);
    assert.equal(row.scope_type, 'CUSTOMER_AGGREGATE');

    // The persisted breakdown holds the observed exposure, and it is the very
    // amount the production exposure projection reports for that scope.
    const persisted = parseCreditExposureCents(row.component_breakdown_json);
    const exposure = computeCreditExposure(handle.db, { customerId: 'cus-w10', businessDate: DAY });
    const components = exposure.aggregateComponents;
    const projected = Number(components.approvedSoCommitmentCents || 0)
      + Number(components.deliveredNotSettledCents || 0)
      + Number(components.arOpenCents || 0)
      - Number(components.eligiblePrepaymentCents || 0);
    assert.equal(persisted, projected, 'the persisted exposure must equal the production exposure projection');
    assert.equal(persisted, 120000, 'the committed approved commitment is the observed exposure');

    // The same read path through the database returns the same fact, and the
    // assertion accepts it against the authoritative OLD/NEW exposures.
    const observed = readCreditExposureCents(handle.db, outcome.checkGroupId, 'CUSTOMER_AGGREGATE');
    assert.equal(observed.exposureCents, persisted);
    assertObservedExposure(observed.exposureCents, [120000, 120000], 'the persisted exposure');

    // A wrong check group and a wrong amount are both detected.
    assert.throws(
      () => selectCreditExposureRow(rows, 'group-that-does-not-exist', 'CUSTOMER_AGGREGATE'),
      /WAVE10_CREDIT_EXPOSURE_ROW_MISSING/,
    );
    assert.throws(() => assertObservedExposure(observed.exposureCents + 1, [120000, 120000]), /exactly the OLD or the NEW/);
  } finally { handle.cleanup(); }
});
