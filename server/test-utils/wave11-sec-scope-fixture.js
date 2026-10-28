// W11-SEC-01 — the shared Credit Read Scope fixture and evidence collector.
//
// This module owns the one fixture that the SQLite proof and the real-MySQL
// acceptance must share. It is backend neutral: it drives the production
// writers through whatever `db` handle it is given, so the same fixture, the
// same actors and the same business identities exist on both engines.
//
// Requirement : document.md §4 D2 (R-D2-1..R-D2-6), §4.1 `W11-SEC-01`
// Design      : solution.md §37.54.5.3, §37.54.7, §37.54.14.4
//
// EVIDENCE LEVEL. The evidence this module collects is the authorized id set
// and the returned order per actor and per read surface, the error status and
// code of every refused surface, the detail answers and the legacy response
// field sets. It never compares SQL text.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { hashPassword } from '../db.js';
import { createCreditProfile, getCreditProfile, listCreditProfiles } from '../modules/credit-profile.js';
import { evaluateCreditCheck, listCreditCheckResults } from '../modules/credit-check.js';
import {
  decideCreditSpecialApproval, getCreditSpecialApproval, listCreditSpecialApprovals, requestCreditSpecialApproval,
} from '../modules/credit-special-approval.js';
import { resolveCreditReadMode } from '../modules/credit-scope.js';

// ---------------------------------------------------------------------------
// Actors — each carries exactly the authority its scenario needs.
// ---------------------------------------------------------------------------

export const ADMIN = Object.freeze({
  id: 'w11-admin', roleCode: 'ADMIN',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE', 'SALES_CROSS_GROUP'],
});
export const CROSS_READER = Object.freeze({ id: 'w11-cross', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW', 'SALES_CROSS_GROUP'] });
export const SELF_ACTOR = Object.freeze({ id: 'w11-self', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
export const OTHER_ACTOR = Object.freeze({ id: 'w11-other', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
export const EXPIRED_ACTOR = Object.freeze({ id: 'w11-expired', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
export const FUTURE_ACTOR = Object.freeze({ id: 'w11-future', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
export const UNMAPPED_ACTOR = Object.freeze({ id: 'w11-unmapped', roleCode: 'WAREHOUSE', permissions: ['CREDIT_VIEW'] });
export const NO_CREDIT = Object.freeze({ id: 'w11-none', roleCode: 'WAREHOUSE', permissions: [] });
export const DECIDER = Object.freeze({ id: 'w11-decider', roleCode: 'SALES', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE'] });

export const ACTORS = Object.freeze([
  ADMIN, CROSS_READER, SELF_ACTOR, OTHER_ACTOR, EXPIRED_ACTOR, FUTURE_ACTOR, UNMAPPED_ACTOR, NO_CREDIT,
]);

// ---------------------------------------------------------------------------
// Calendar — the repository's "today" is the server's UTC calendar day. Every
// fixture date is derived from it, so the fixture keeps its meaning whenever
// it runs and never silently expires.
// ---------------------------------------------------------------------------

function shiftDays(dateText, days) {
  const probe = new Date(`${dateText}T00:00:00.000Z`);
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
}

export const TODAY = new Date().toISOString().slice(0, 10);
export const YESTERDAY = shiftDays(TODAY, -1);
export const HISTORICAL = shiftDays(YESTERDAY, -30);
export const PROFILE_FROM = shiftDays(HISTORICAL, -30);
export const FUTURE_DATE = shiftDays(TODAY, 365);

export const CREDIT_OBJECT_TYPE = 'SALES_ORDER';
export const AGGREGATE_LIMIT = 100000;
export const SUB_LIMIT = 50000;
export const PROPOSED_DELTA = 200000;

export const CUSTOMERS = Object.freeze([
  { id: 'cus-w11-self', salespersonId: 'sp-self', userId: 'w11-self' },
  { id: 'cus-w11-other', salespersonId: 'sp-other', userId: 'w11-other' },
  { id: 'cus-w11-expired', salespersonId: 'sp-expired', userId: 'w11-expired' },
  { id: 'cus-w11-future', salespersonId: 'sp-future', userId: 'w11-future' },
]);

export const SELF_PROFILE_KEY = 'cus-w11-self:sp-self';
export const OTHER_PROFILE_KEY = 'cus-w11-other:sp-other';
export const EXPIRED_PROFILE_KEY = 'cus-w11-expired:sp-expired';
export const SELF_RESULT_KEY = 'so-cus-w11-self:SALESPERSON_SUB_LIMIT';
export const OTHER_RESULT_KEY = 'so-cus-w11-other:SALESPERSON_SUB_LIMIT';
export const AGGREGATE_APPROVAL_KEY = 'approval:so-cus-w11-self:CUSTOMER_AGGREGATE';
export const SELF_APPROVAL_KEY = 'approval:so-cus-w11-self:SALESPERSON_SUB_LIMIT';
export const OTHER_APPROVAL_KEY = 'approval:so-cus-w11-other:SALESPERSON_SUB_LIMIT';
export const EXPIRED_APPROVAL_KEY = 'approval:so-cus-w11-expired:SALESPERSON_SUB_LIMIT';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export function response() {
  return {
    statusCode: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

export function request(body, key = 'w11-key') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

export async function invoke(handler, db, body, actor = ADMIN, key = 'w11-key') {
  const res = response();
  await handler(db, request(body, key), res, actor);
  return res;
}

// The decision handlers take the target id as their fifth positional
// argument, after the request, the response and the actor.
export async function invokeWithId(handler, db, body, actor, id, key = 'w11-key') {
  const res = response();
  await handler(db, request(body, key), res, actor, id);
  return res;
}

// A denied read never leaves the handler: the status and the error code are
// captured so an out-of-scope read and an absent read can be compared.
export async function read(handler, db, actor, params) {
  const res = response();
  try {
    await handler(db, res, actor, { searchParams: new URLSearchParams(params || {}) });
    return { statusCode: res.statusCode, body: res.body, code: null, message: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, message: error.message };
  }
}

export async function readById(handler, db, actor, id) {
  const res = response();
  try {
    await handler(db, res, actor, id);
    return { statusCode: res.statusCode, body: res.body, code: null, message: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, message: error.message };
  }
}

// ---------------------------------------------------------------------------
// Fixture — every Credit fact is produced by the production writers.
// ---------------------------------------------------------------------------

function seedUser(db, id, stamp) {
  const credential = hashPassword('w11-fixture-1234');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, id, id, credential.hash, credential.salt, stamp);
}

function seedCustomer(db, id, stamp) {
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES(?,?,?,'','','',1,?,?)`).run(id, id.toUpperCase(), id, stamp, stamp);
}

function seedSalesperson(db, id, userId, stamp) {
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES(?,?,?,?,1,?,?)`).run(id, id.toUpperCase(), id, userId, stamp, stamp);
}

function seedMembership(db, { id, salespersonId, effectiveFrom, effectiveTo }, stamp) {
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,
    effective_from,effective_to,created_at,updated_at) VALUES(?,?,'sg-w11',1,1,?,?,?,?)`)
    .run(id, salespersonId, effectiveFrom, effectiveTo, stamp, stamp);
}

function seedProduct(db, id, stamp) {
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,'','EA',10000,0,1,?,?)`).run(id, id.toUpperCase(), id, stamp, stamp);
}

// A DRAFT order never occupies credit exposure; it is only the source
// document the check is evaluated against.
function seedOrder(db, { id, customerId, salespersonId, orderDate }, stamp) {
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,
    reviewer_id,submitted_at,reviewed_at,created_at,updated_at,order_date,requested_delivery_date,payment_terms,
    ship_to_contact_name,ship_to_phone,ship_to_address,payment_terms_days,salesperson_id,sales_group_id,
    settlement_party_id,payer_id,required_prepayment_cents,reservation_intent_state,commercial_close_state,
    gift_summary_cents,effective_version)
    VALUES(?,?,?,'DRAFT',0,'','','w11-admin',NULL,NULL,NULL,?,?,?,?,'CASH','','','',0,?,'sg-w11',?,?,0,'NONE','OPEN',0,1)`)
    .run(id, id.toUpperCase(), customerId, stamp, stamp, orderDate, orderDate, salespersonId, customerId, customerId);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,'p-w11',1,?,?,1)`).run(`soi-${id}`, id, PROPOSED_DELTA, PROPOSED_DELTA);
}

function seedParameter(db, code, valueBool, stamp) {
  db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,created_at,created_by)
    VALUES(?,?,NULL,NULL,?,NULL,?,NULL,'ACTIVE',?,?)`).run(`param-${code}`, code, valueBool ? 1 : 0, PROFILE_FROM, stamp, 'w11-admin');
}

function seedRule(db, stamp) {
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
      recognition_mode,effective_from,effective_to,status,result_payload_json,created_at,created_by)
    VALUES('rule-w11-sec','W11_SEC_SO_OVERRIDE','SO_SUBMIT','OVERRIDE_REQUEST','BEFORE_WRITE','WARNING','ORDER_EXPOSURE',
      NULL,?,NULL,'ACTIVE','{}',?,?)`).run(PROFILE_FROM, stamp, 'w11-admin');
}

async function seedProfile(db, { customerId, salespersonId = null, creditLimitCents }) {
  const key = `profile-${customerId}-${salespersonId || 'aggregate'}`;
  const res = await invoke(createCreditProfile, db, {
    customerId,
    salespersonId,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${customerId.toUpperCase()}`,
    creditLimitCents,
    initialState: 'NORMAL',
    status: 'ACTIVE',
    ratingGrade: 'A',
    overdueDayPolicy: '15',
    effectiveFrom: PROFILE_FROM,
  }, ADMIN, key);
  assert.equal(res.statusCode, 201, `seed profile ${key}`);
  return res.body.profile;
}

async function runCheck(db, { customerId, salespersonId, orderId }) {
  const res = await invoke(evaluateCreditCheck, db, {
    customerId,
    salespersonId,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${customerId.toUpperCase()}`,
    stage: 'SO_SUBMIT',
    businessDate: HISTORICAL,
    proposedDeltaCents: PROPOSED_DELTA,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
    salesOrderId: orderId,
  }, ADMIN, `check-${orderId}`);
  assert.equal(res.statusCode, 200, `seed check ${orderId}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function seedApproval(db, resultId, key) {
  const res = await invoke(requestCreditSpecialApproval, db, {
    sourceCreditCheckResultId: resultId,
    reason: 'W11-SEC acceptance fixture',
    requestedOverrideCents: PROPOSED_DELTA,
    requestedCeilingCents: PROPOSED_DELTA,
    requestedExpiryBusinessDate: FUTURE_DATE,
    scopeMode: 'ONE_TIME',
  }, ADMIN, key);
  assert.equal(res.statusCode, 201, `seed approval ${key}: ${JSON.stringify(res.body)}`);
  return res.body.approval;
}

// Business identities — the comparable identity of a row across engines. The
// physical ids are random or hash derived and are never compared across
// engines.
export const profileKey = (profile) => `${profile.customerId}:${profile.salespersonScopeKey === '*' ? 'AGGREGATE' : profile.salespersonScopeKey}`;
export const resultKey = (row) => `${row.salesOrderId}:${row.scopeType}`;
export const approvalKey = (row) => `approval:${row.sourceSalesOrderId}:${row.scopeType}`;

export async function seedWorld(db) {
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('sg-w11','SG-W11','W11 Group','',1,?,?)`).run(stamp, stamp);
  for (const actor of [...ACTORS, DECIDER]) seedUser(db, actor.id, stamp);
  seedSalesperson(db, 'sp-self', 'w11-self', stamp);
  seedSalesperson(db, 'sp-other', 'w11-other', stamp);
  seedSalesperson(db, 'sp-expired', 'w11-expired', stamp);
  seedSalesperson(db, 'sp-future', 'w11-future', stamp);
  // A currently valid membership, an ended membership, and a membership that
  // has not started yet. `active` stays 1 on the last two so that only the
  // date window can decide the outcome.
  seedMembership(db, { id: 'mem-self', salespersonId: 'sp-self', effectiveFrom: PROFILE_FROM, effectiveTo: null }, stamp);
  seedMembership(db, { id: 'mem-other', salespersonId: 'sp-other', effectiveFrom: PROFILE_FROM, effectiveTo: null }, stamp);
  seedMembership(db, { id: 'mem-expired', salespersonId: 'sp-expired', effectiveFrom: PROFILE_FROM, effectiveTo: YESTERDAY }, stamp);
  seedMembership(db, { id: 'mem-future', salespersonId: 'sp-future', effectiveFrom: FUTURE_DATE, effectiveTo: null }, stamp);

  seedProduct(db, 'p-w11', stamp);
  seedParameter(db, 'CREDIT_MANAGEMENT_ENABLED', true, stamp);
  seedRule(db, stamp);

  const world = { profiles: new Map(), results: new Map(), approvals: new Map() };
  for (const customer of CUSTOMERS) {
    seedCustomer(db, customer.id, stamp);
    seedOrder(db, { id: `so-${customer.id}`, customerId: customer.id, salespersonId: customer.salespersonId, orderDate: HISTORICAL }, stamp);
    const aggregate = await seedProfile(db, { customerId: customer.id, creditLimitCents: AGGREGATE_LIMIT });
    const subLimit = await seedProfile(db, { customerId: customer.id, salespersonId: customer.salespersonId, creditLimitCents: SUB_LIMIT });
    world.profiles.set(profileKey(aggregate), aggregate);
    world.profiles.set(profileKey(subLimit), subLimit);
    await runCheck(db, { customerId: customer.id, salespersonId: customer.salespersonId, orderId: `so-${customer.id}` });
  }
  const rows = db.prepare('SELECT * FROM credit_check_results').all();
  assert.equal(rows.length, CUSTOMERS.length * 2, 'one aggregate and one sub-limit result per customer');
  for (const row of rows) {
    const key = resultKey({ salesOrderId: row.sales_order_id, scopeType: row.scope_type });
    world.results.set(key, { id: row.id, checkGroupId: row.check_group_id, scopeType: row.scope_type, salesOrderId: row.sales_order_id });
  }
  // One approval per scope type on two different orders: one aggregate (readable
  // by every CREDIT_VIEW holder) and one sub-limit (readable by its owner only).
  const aggregateRow = rows.find((row) => row.scope_type === 'CUSTOMER_AGGREGATE' && row.sales_order_id === 'so-cus-w11-self');
  const selfRow = rows.find((row) => row.scope_type === 'SALESPERSON_SUB_LIMIT' && row.sales_order_id === 'so-cus-w11-self');
  const otherRow = rows.find((row) => row.scope_type === 'SALESPERSON_SUB_LIMIT' && row.sales_order_id === 'so-cus-w11-other');
  const expiredRow = rows.find((row) => row.scope_type === 'SALESPERSON_SUB_LIMIT' && row.sales_order_id === 'so-cus-w11-expired');
  const aggregateApproval = await seedApproval(db, aggregateRow.id, 'approval-aggregate');
  world.approvals.set(AGGREGATE_APPROVAL_KEY, aggregateApproval);
  world.approvals.set(SELF_APPROVAL_KEY, await seedApproval(db, selfRow.id, 'approval-self'));
  world.approvals.set(OTHER_APPROVAL_KEY, await seedApproval(db, otherRow.id, 'approval-other'));
  world.approvals.set(EXPIRED_APPROVAL_KEY, await seedApproval(db, expiredRow.id, 'approval-expired'));
  // The decided approval exercises the PENDING / DECIDED group order of the
  // frozen Wave 10 listing. The requester and the approver are different
  // people, as the frozen SOD contract requires.
  const decided = await invokeWithId(decideCreditSpecialApproval, db, {
    decision: 'APPROVED',
    approvedOverrideCents: PROPOSED_DELTA,
    approvedCeilingCents: PROPOSED_DELTA,
    approvedExpiryBusinessDate: FUTURE_DATE,
    reason: 'W11-SEC acceptance decision',
  }, DECIDER, aggregateApproval.id, 'approval-decide');
  assert.equal(decided.statusCode, 200, `the fixture must be able to decide one approval: ${JSON.stringify(decided.body)}`);
  world.approvals.set(AGGREGATE_APPROVAL_KEY, decided.body.approval);

  pinOrderKeys(db, world);
  return world;
}

// Fixture normalization. The Credit Check Result writer stamps `evaluated_at`
// with the wall clock, so two runs of the same fixture would order those rows
// differently for reasons that have nothing to do with the scope contract.
// The pin removes that noise from the cross-engine ORDER BY comparison. No
// scope predicate, no hash, no fingerprint and no visibility rule reads
// `evaluated_at`; this is a fixture decision inside a disposable database,
// not a production change.
export function pinOrderKeys(db, world) {
  const ordered = [...world.results.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  ordered.forEach(([, row], index) => {
    db.prepare('UPDATE credit_check_results SET evaluated_at=? WHERE id=?')
      .run(`2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`, row.id);
  });
}

// ---------------------------------------------------------------------------
// Evidence collection — one canonical snapshot of what every actor may read
// on every Credit read surface.
// ---------------------------------------------------------------------------

export async function collectEvidence(db, world) {
  const profileUniverse = new Set(world.profiles.keys());
  const resultUniverse = new Set(world.results.keys());
  const approvalUniverse = new Set(world.approvals.keys());
  const evidence = {};

  for (const actor of ACTORS) {
    const mode = resolveCreditReadMode(db, actor).mode;

    const profiles = await read(listCreditProfiles, db, actor, {});
    const profileKeys = (profiles.body?.profiles || []).map(profileKey).filter((key) => profileUniverse.has(key));

    const profileDetails = {};
    for (const [key, profile] of world.profiles) {
      const detail = await readById(getCreditProfile, db, actor, profile.id);
      profileDetails[key] = { status: detail.statusCode, code: detail.code };
    }

    const results = await read(listCreditCheckResults, db, actor, {});
    const resultKeys = (results.body?.results || []).map(resultKey).filter((key) => resultUniverse.has(key));

    const approvals = await read(listCreditSpecialApprovals, db, actor, {});
    const approvalRows = approvals.body?.approvals || [];
    const approvalKeys = approvalRows.map(approvalKey).filter((key) => approvalUniverse.has(key));
    // The decision sequence is the engine-independent part of the frozen
    // listing order: the pending group always precedes the decided group.
    const decisions = approvalRows.map((row) => row.decision);

    const approvalDetails = {};
    for (const [key, approval] of world.approvals) {
      const detail = await readById(getCreditSpecialApproval, db, actor, approval.id);
      approvalDetails[key] = { status: detail.statusCode, code: detail.code };
    }

    evidence[actor.id] = {
      mode,
      profiles: { status: profiles.statusCode, code: profiles.code, keys: profileKeys },
      profileDetails,
      results: { status: results.statusCode, code: results.code, keys: resultKeys },
      approvals: { status: approvals.statusCode, code: approvals.code, keys: approvalKeys, decisions },
      approvalDetails,
      resultFields: Object.keys(results.body?.results?.[0] || {}).sort(),
      approvalFields: Object.keys(approvals.body?.approvals?.[0] || {}).sort(),
    };
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// The scope contract — asserted identically on both engines.
// ---------------------------------------------------------------------------

export function assertScopeContract(evidence, world, label = 'engine') {
  const aggregateProfileKeys = CUSTOMERS.map((customer) => `${customer.id}:AGGREGATE`);
  const aggregateResultKeys = CUSTOMERS.map((customer) => `so-${customer.id}:CUSTOMER_AGGREGATE`);

  // ADMIN and the cross-group reader see every scope.
  for (const actor of [ADMIN, CROSS_READER]) {
    const row = evidence[actor.id];
    assert.equal(row.mode, actor === ADMIN ? 'ALL' : 'CROSS_GROUP');
    assert.equal(row.profiles.status, 200);
    assert.equal(row.profiles.keys.length, CUSTOMERS.length * 2);
    assert.equal(row.results.keys.length, CUSTOMERS.length * 2);
    assert.equal(row.approvals.keys.length, 4);
  }

  // A currently valid membership reads the aggregate plus its own sub-limit.
  const self = evidence[SELF_ACTOR.id];
  assert.equal(self.mode, 'AGGREGATE_PLUS_SELF');
  assert.deepEqual([...self.profiles.keys].sort(), [...aggregateProfileKeys, SELF_PROFILE_KEY].sort());
  assert.deepEqual([...self.results.keys].sort(), [...aggregateResultKeys, SELF_RESULT_KEY].sort());
  assert.equal(self.profiles.keys.includes(OTHER_PROFILE_KEY), false);
  assert.equal(self.results.keys.includes(OTHER_RESULT_KEY), false);
  assert.equal(self.approvals.keys.includes(OTHER_APPROVAL_KEY), false);
  assert.equal(self.approvals.keys.includes(AGGREGATE_APPROVAL_KEY), true);
  assert.equal(self.approvals.keys.includes(SELF_APPROVAL_KEY), true);

  // An ended membership, a not-yet-started membership and an unmapped user
  // all read the aggregate only.
  for (const actor of [EXPIRED_ACTOR, FUTURE_ACTOR, UNMAPPED_ACTOR]) {
    const row = evidence[actor.id];
    assert.equal(row.mode, 'AGGREGATE_ONLY', `${label}: ${actor.id} must be aggregate only`);
    assert.deepEqual([...row.profiles.keys].sort(), [...aggregateProfileKeys].sort());
    assert.deepEqual([...row.results.keys].sort(), [...aggregateResultKeys].sort());
    assert.deepEqual([...row.approvals.keys].sort(), [AGGREGATE_APPROVAL_KEY]);
  }

  // No CREDIT_VIEW is refused before any query runs.
  const denied = evidence[NO_CREDIT.id];
  assert.equal(denied.mode, 'DENY');
  assert.equal(denied.profiles.status, 403);
  assert.equal(denied.profiles.code, 'CREDIT_SCOPE_DENIED');
  assert.equal(denied.results.status, 403);
  assert.equal(denied.results.code, 'CREDIT_SCOPE_DENIED');
  assert.equal(denied.approvals.status, 403);
  assert.equal(denied.approvals.code, 'CREDIT_SCOPE_DENIED');
  assert.deepEqual(denied.profiles.keys, []);
  assert.deepEqual(denied.results.keys, []);
  assert.deepEqual(denied.approvals.keys, []);
  // A denied reader is refused on the detail surfaces as well, before any
  // statement is prepared.
  for (const detail of Object.values(denied.profileDetails)) {
    assert.equal(detail.status, 403, `${label}: a denied reader must be refused on the profile detail`);
    assert.equal(detail.code, 'CREDIT_SCOPE_DENIED');
  }
  for (const detail of Object.values(denied.approvalDetails)) {
    assert.equal(detail.status, 403, `${label}: a denied reader must be refused on the approval detail`);
    assert.equal(detail.code, 'CREDIT_SCOPE_DENIED');
  }

  // List and detail agree in every mode: a row the collection hides is
  // unreachable by its id, and the answer is the ordinary not-found answer.
  for (const actor of ACTORS.filter((item) => item.id !== NO_CREDIT.id)) {
    const row = evidence[actor.id];
    for (const key of world.profiles.keys()) {
      const detail = row.profileDetails[key];
      if (row.profiles.keys.includes(key)) {
        assert.equal(detail.status, 200, `${label}: ${actor.id} must reach ${key}`);
      } else {
        assert.equal(detail.status, 404, `${label}: ${actor.id} must not reach ${key}`);
        assert.equal(detail.code, 'CREDIT_PROFILE_NOT_FOUND');
      }
    }
    for (const key of world.approvals.keys()) {
      const detail = row.approvalDetails[key];
      if (row.approvals.keys.includes(key)) {
        assert.equal(detail.status, 200, `${label}: ${actor.id} must reach ${key}`);
      } else {
        assert.equal(detail.status, 404, `${label}: ${actor.id} must not reach ${key}`);
        assert.equal(detail.code, 'CREDIT_SPECIAL_APPROVAL_NOT_FOUND');
      }
    }
  }

  // The legacy response field sets are unchanged by the remediation.
  assert.deepEqual(evidence[ADMIN.id].resultFields, [
    'businessDate', 'checkGroupId', 'componentBreakdown', 'creditLockAnchorId', 'creditPolicySnapshotId',
    'creditProfileId', 'decision', 'eligiblePrepaymentSourceIdentity', 'evaluatedAt', 'evaluatedBy',
    'id', 'policySnapshotFingerprint', 'profileEffectiveStateHash', 'proposedDeltaCents',
    'reasonCodes', 'recognitionMode', 'salesDeliveryId', 'salesOrderId', 'scopeType', 'stage',
  ]);
  assert.deepEqual(evidence[ADMIN.id].approvalFields, [
    'approvedCeilingCents', 'approvedExpiryBusinessDate', 'approvedOverrideCents',
    'approverId', 'auditId', 'authorityCeilingCents', 'decidedAt', 'decision', 'id', 'reason',
    'requestedCeilingCents', 'requestedExpiryBusinessDate', 'requestedOverrideCents', 'scopeMode',
    'scopeType', 'sourceCheckGroupId', 'sourceCreditCheckResultId', 'sourceCreditPolicySnapshotId',
    'sourcePolicySnapshotFingerprint', 'sourceProfileEffectiveStateHash', 'sourceSalesOrderId',
  ]);
}

// The cross-engine parity contract. The physical ids differ between two
// engines, so the compared identity is the business identity, and the
// compared order is the returned sequence of those identities.
export function assertEngineParity(mysqlEvidence, sqliteEvidence) {
  for (const actor of ACTORS) {
    const mine = mysqlEvidence[actor.id];
    const theirs = sqliteEvidence[actor.id];
    assert.equal(mine.mode, theirs.mode, `${actor.id}: the read mode must agree`);
    // Profile list — the frozen ordering has no wall-clock component.
    assert.deepEqual(mine.profiles.keys, theirs.profiles.keys, `${actor.id}: profile id set and order`);
    assert.equal(mine.profiles.status, theirs.profiles.status);
    assert.equal(mine.profiles.code, theirs.profiles.code);
    // Check Result list — `evaluated_at` is pinned by the fixture, so the
    // returned sequence is comparable in full.
    assert.deepEqual(mine.results.keys, theirs.results.keys, `${actor.id}: check result id set and order`);
    assert.equal(mine.results.status, theirs.results.status);
    assert.equal(mine.results.code, theirs.results.code);
    // Special Approval list — the within-group order is the random primary
    // key, so the group structure, the decision sequence and the set are
    // compared instead of the within-group sequence.
    assert.deepEqual([...mine.approvals.keys].sort(), [...theirs.approvals.keys].sort(), `${actor.id}: approval id set`);
    assert.deepEqual(mine.approvals.decisions, theirs.approvals.decisions, `${actor.id}: approval group order`);
    assert.equal(mine.approvals.status, theirs.approvals.status);
    assert.equal(mine.approvals.code, theirs.approvals.code);
    // Detail surfaces.
    assert.deepEqual(mine.profileDetails, theirs.profileDetails, `${actor.id}: profile detail`);
    assert.deepEqual(mine.approvalDetails, theirs.approvalDetails, `${actor.id}: approval detail`);
    // Legacy response field compatibility.
    assert.deepEqual(mine.resultFields, theirs.resultFields, `${actor.id}: result fields`);
    assert.deepEqual(mine.approvalFields, theirs.approvalFields, `${actor.id}: approval fields`);
  }
}
