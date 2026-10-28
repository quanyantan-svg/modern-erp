// W11-SEC-01 — Credit Read Scope remediation.
//
// document.md §4 D2 (R-D2-1..R-D2-6) and §4.1 `W11-SEC-01`; solution.md
// §37.54.5.3 (the scope predicate model) and §37.54.7 (the W11-SEC-01 design
// closure, including CORRECTION-1).
//
// The suite covers four read surfaces that share one canonical authorization
// decision:
//
//   GET /api/credit/profiles            (Wave 9 — Profile list)
//   GET /api/credit/profiles/:id        (Wave 9 — Profile detail)
//   GET /api/credit/check-results       (Wave 10 — Check Result list)
//   GET /api/credit/special-approvals   (Wave 10 — Special Approval list)
//   GET /api/credit/special-approvals/:id (Wave 10 — Special Approval detail)
//
// EVIDENCE LEVEL. Every assertion here runs on one disposable SQLite database
// per case. It proves the scope contract and the fail-closed behaviour on
// SQLite. It is NOT MySQL evidence: the cross-dialect permission matrix, the
// ordering equivalence and the `total` equivalence stay NOT_RUN and are
// reserved for a separately authorized MySQL gate. A SQLite PASS must never be
// reported as a W11-SEC-01 acceptance PASS.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { createCreditProfile, getCreditProfile, listCreditProfiles } from './modules/credit-profile.js';
import { evaluateCreditCheck, listCreditCheckResults } from './modules/credit-check.js';
import { getCreditSpecialApproval, listCreditSpecialApprovals, requestCreditSpecialApproval } from './modules/credit-special-approval.js';
import { CREDIT_READ_MODE, creditScopePredicate, resolveCreditReadMode } from './modules/credit-scope.js';

// ---------------------------------------------------------------------------
// Calendar helpers — the repository's "today" is the server's UTC calendar day.
// The historical fixture dates are derived from it so the suite keeps its
// meaning whenever it runs: the ended membership always ends before today and
// the historical business date always falls inside both the membership window
// and the effective window of the seeded Credit Profile.
// ---------------------------------------------------------------------------

function shiftDays(dateText, days) {
  const probe = new Date(`${dateText}T00:00:00.000Z`);
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = shiftDays(TODAY, -1);
const HISTORICAL = shiftDays(YESTERDAY, -30);
const PROFILE_FROM = shiftDays(HISTORICAL, -30);
const FUTURE_DATE = shiftDays(TODAY, 365);

const ADMIN = Object.freeze({
  id: 'w11-admin', roleCode: 'ADMIN',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE', 'SALES_CROSS_GROUP'],
});
const CROSS_READER = Object.freeze({ id: 'w11-cross', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW', 'SALES_CROSS_GROUP'] });
const SELF_ACTOR = Object.freeze({ id: 'w11-self', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const OTHER_ACTOR = Object.freeze({ id: 'w11-other', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const EXPIRED_ACTOR = Object.freeze({ id: 'w11-expired', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const FUTURE_ACTOR = Object.freeze({ id: 'w11-future', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const UNMAPPED_ACTOR = Object.freeze({ id: 'w11-unmapped', roleCode: 'WAREHOUSE', permissions: ['CREDIT_VIEW'] });
const NO_CREDIT = Object.freeze({ id: 'w11-none', roleCode: 'WAREHOUSE', permissions: [] });

const CREDIT_OBJECT_TYPE = 'SALES_ORDER';
const AGGREGATE_LIMIT = 100000;
const SUB_LIMIT = 50000;
const PROPOSED_DELTA = 200000;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function response() {
  return {
    statusCode: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

function request(body, key = 'w11-key') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

async function invoke(handler, db, body, actor = ADMIN, key = 'w11-key') {
  const res = response();
  await handler(db, request(body, key), res, actor);
  return res;
}

// A denied read never leaves the handler: the status and the error code are
// captured so an out-of-scope read and an absent read can be compared.
async function read(handler, db, actor, params) {
  const res = response();
  try {
    await handler(db, res, actor, { searchParams: new URLSearchParams(params || {}) });
    return { statusCode: res.statusCode, body: res.body, code: null, message: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, message: error.message };
  }
}

async function readById(handler, db, actor, id) {
  const res = response();
  try {
    await handler(db, res, actor, id);
    return { statusCode: res.statusCode, body: res.body, code: null, message: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, message: error.message };
  }
}

// ---------------------------------------------------------------------------
// Fixtures — every Credit fact is produced by the production writers, so the
// suite never asserts against a structure the application cannot create.
// ---------------------------------------------------------------------------

function seedUser(db, id) {
  const hashed = hashPassword('w11-1234');
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, id, id, hashed.hash, hashed.salt, new Date().toISOString());
}

function seedCustomer(db, id) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES(?,?,?,'','','',1,?,?)`).run(id, id.toUpperCase(), id, now, now);
}

function seedSalesperson(db, id, userId) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES(?,?,?,?,1,?,?)`).run(id, id.toUpperCase(), id, userId, now, now);
}

function seedMembership(db, { id, salespersonId, effectiveFrom, effectiveTo }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,
    effective_from,effective_to,created_at,updated_at) VALUES(?,?,'sg-w11',1,1,?,?,?,?)`)
    .run(id, salespersonId, effectiveFrom, effectiveTo, now, now);
}

function seedProduct(db, id) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,'','EA',10000,0,1,?,?)`).run(id, id.toUpperCase(), id, now, now);
}

function seedOrder(db, { id, customerId, salespersonId, orderDate }) {
  const now = new Date().toISOString();
  const reviewedAt = `${orderDate}T09:00:00.000Z`;
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,
      reviewer_id,submitted_at,reviewed_at,created_at,updated_at,order_date,requested_delivery_date,payment_terms,
      ship_to_contact_name,ship_to_phone,ship_to_address,payment_terms_days,salesperson_id,sales_group_id,
      settlement_party_id,payer_id,required_prepayment_cents,reservation_intent_state,commercial_close_state,
      gift_summary_cents,effective_version)
    VALUES(?,?,?,'DRAFT',0,'','',?,NULL,NULL,?,?,?,?,?,'CASH','','','',0,?,'sg-w11',?,?,0,'NONE','OPEN',0,1)`)
    .run(id, id.toUpperCase(), customerId, 'w11-admin', reviewedAt, now, now, orderDate, orderDate,
      salespersonId, customerId, customerId);
}

function seedParameter(db, code, valueBool) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,created_at,created_by)
    VALUES(?,?,NULL,NULL,?,NULL,?,NULL,'ACTIVE',?,?)`).run(`param-${code}`, code, valueBool ? 1 : 0, PROFILE_FROM, now, 'w11-admin');
}

function seedRule(db, { ruleCode, scenario, controlStrength }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
      recognition_mode,effective_from,effective_to,status,result_payload_json,created_at,created_by)
    VALUES(?,?,'SO_SUBMIT',?,'BEFORE_WRITE',?,'ORDER_EXPOSURE',NULL,?,NULL,'ACTIVE','{}',?,?)`)
    .run(`rule-${ruleCode}`, ruleCode, scenario, controlStrength, PROFILE_FROM, now, 'w11-admin');
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
  assert.equal(res.statusCode, 200, `seed check ${orderId}`);
  return res.body;
}

async function seedApproval(db, resultId, key) {
  const res = await invoke(requestCreditSpecialApproval, db, {
    sourceCreditCheckResultId: resultId,
    reason: '申请超限放行',
    requestedOverrideCents: PROPOSED_DELTA,
    requestedCeilingCents: PROPOSED_DELTA,
    requestedExpiryBusinessDate: FUTURE_DATE,
    scopeMode: 'ONE_TIME',
  }, ADMIN, key);
  assert.equal(res.statusCode, 201, `seed approval ${key}`);
  return res.body.approval;
}

// One customer per salesperson under test. Every customer owns an aggregate
// profile; four of them also own a salesperson sub-limit profile, so each
// check produces one aggregate result row and one sub-limit result row.
const CUSTOMERS = Object.freeze([
  { id: 'cus-w11-self', salespersonId: 'sp-self', userId: 'w11-self' },
  { id: 'cus-w11-other', salespersonId: 'sp-other', userId: 'w11-other' },
  { id: 'cus-w11-expired', salespersonId: 'sp-expired', userId: 'w11-expired' },
  { id: 'cus-w11-future', salespersonId: 'sp-future', userId: 'w11-future' },
]);

async function seedCreditWorld(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('sg-w11','SG-W11','W11 Group','',1,?,?)`).run(now, now);
  for (const actor of [ADMIN, CROSS_READER, SELF_ACTOR, OTHER_ACTOR, EXPIRED_ACTOR, FUTURE_ACTOR, UNMAPPED_ACTOR, NO_CREDIT]) {
    seedUser(db, actor.id);
  }
  seedSalesperson(db, 'sp-self', 'w11-self');
  seedSalesperson(db, 'sp-other', 'w11-other');
  seedSalesperson(db, 'sp-expired', 'w11-expired');
  seedSalesperson(db, 'sp-future', 'w11-future');
  // A currently valid membership, an ended membership, and a membership that
  // has not started yet. `active` stays 1 on the last two so that only the
  // date window can decide the outcome.
  seedMembership(db, { id: 'mem-self', salespersonId: 'sp-self', effectiveFrom: PROFILE_FROM, effectiveTo: null });
  seedMembership(db, { id: 'mem-other', salespersonId: 'sp-other', effectiveFrom: PROFILE_FROM, effectiveTo: null });
  seedMembership(db, { id: 'mem-expired', salespersonId: 'sp-expired', effectiveFrom: PROFILE_FROM, effectiveTo: YESTERDAY });
  seedMembership(db, { id: 'mem-future', salespersonId: 'sp-future', effectiveFrom: FUTURE_DATE, effectiveTo: null });

  seedProduct(db, 'p-w11');
  seedParameter(db, 'CREDIT_MANAGEMENT_ENABLED', true);
  seedRule(db, { ruleCode: 'W11_SO_OVERRIDE', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' });

  const world = { profiles: {}, results: [], approvals: {} };
  for (const customer of CUSTOMERS) {
    seedCustomer(db, customer.id);
    seedOrder(db, { id: `so-${customer.id}`, customerId: customer.id, salespersonId: customer.salespersonId, orderDate: HISTORICAL });
    world.profiles[`${customer.id}:aggregate`] = await seedProfile(db, { customerId: customer.id, creditLimitCents: AGGREGATE_LIMIT });
    world.profiles[`${customer.id}:${customer.salespersonId}`] = await seedProfile(db, {
      customerId: customer.id, salespersonId: customer.salespersonId, creditLimitCents: SUB_LIMIT,
    });
    await runCheck(db, { customerId: customer.id, salespersonId: customer.salespersonId, orderId: `so-${customer.id}` });
  }
  const resultRows = db.prepare('SELECT * FROM credit_check_results ORDER BY evaluated_at DESC, id DESC').all();
  assert.equal(resultRows.length, CUSTOMERS.length * 2, 'one aggregate and one sub-limit result per customer');
  world.results = resultRows;

  const aggregate = resultRows.filter((row) => row.scope_type === 'CUSTOMER_AGGREGATE');
  const subLimit = resultRows.filter((row) => row.scope_type === 'SALESPERSON_SUB_LIMIT');
  assert.equal(aggregate.length, CUSTOMERS.length);
  assert.equal(subLimit.length, CUSTOMERS.length);

  const aggregateOf = (customerId) => aggregate.find((row) => row.sales_order_id === `so-${customerId}`);
  const subLimitOf = (customerId) => subLimit.find((row) => row.sales_order_id === `so-${customerId}`);
  world.aggregateResults = Object.fromEntries(CUSTOMERS.map((customer) => [customer.id, aggregateOf(customer.id)]));
  world.subLimitResults = Object.fromEntries(CUSTOMERS.map((customer) => [customer.id, subLimitOf(customer.id)]));

  world.approvals.aggregate = await seedApproval(db, aggregateOf('cus-w11-self').id, 'approval-aggregate');
  world.approvals.self = await seedApproval(db, subLimitOf('cus-w11-self').id, 'approval-self');
  world.approvals.other = await seedApproval(db, subLimitOf('cus-w11-other').id, 'approval-other');
  world.approvals.expired = await seedApproval(db, subLimitOf('cus-w11-expired').id, 'approval-expired');
  return world;
}

async function withWorld(body) {
  const handle = createTempDb({ label: 'w11-sec-scope' });
  try {
    const world = await seedCreditWorld(handle.db);
    return await body(handle.db, world);
  } finally { handle.cleanup(); }
}

function ids(rows, key = 'id') {
  return rows.map((row) => row[key]).sort();
}

// ---------------------------------------------------------------------------
// 1. The canonical authorization decision
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.5.3 — one resolver decides all five modes and never reads a caller-supplied date', async () => {
  await withWorld(async (db) => {
    assert.equal(resolveCreditReadMode(db, ADMIN).mode, CREDIT_READ_MODE.ALL);
    assert.equal(resolveCreditReadMode(db, CROSS_READER).mode, CREDIT_READ_MODE.CROSS_GROUP);
    assert.equal(resolveCreditReadMode(db, SELF_ACTOR).mode, CREDIT_READ_MODE.AGGREGATE_PLUS_SELF);
    assert.equal(resolveCreditReadMode(db, OTHER_ACTOR).mode, CREDIT_READ_MODE.AGGREGATE_PLUS_SELF);
    assert.equal(resolveCreditReadMode(db, UNMAPPED_ACTOR).mode, CREDIT_READ_MODE.AGGREGATE_ONLY);
    assert.equal(resolveCreditReadMode(db, EXPIRED_ACTOR).mode, CREDIT_READ_MODE.AGGREGATE_ONLY);
    assert.equal(resolveCreditReadMode(db, FUTURE_ACTOR).mode, CREDIT_READ_MODE.AGGREGATE_ONLY);
    assert.equal(resolveCreditReadMode(db, NO_CREDIT).mode, CREDIT_READ_MODE.DENY);

    const self = resolveCreditReadMode(db, SELF_ACTOR);
    assert.equal(self.selfSalespersonId, 'sp-self');
    assert.equal(self.authorizationDate, TODAY, 'the authorization date is the server UTC calendar day');

    // The projection is pure: it renders the mode it is given and binds only
    // the self scope value of that mode.
    assert.deepEqual(creditScopePredicate(CREDIT_READ_MODE.ALL, { aggregateExpr: 'A', selfExpr: 'S' }), { sql: '1=1', args: [] });
    assert.deepEqual(creditScopePredicate(CREDIT_READ_MODE.CROSS_GROUP, { aggregateExpr: 'A', selfExpr: 'S' }), { sql: '1=1', args: [] });
    assert.deepEqual(creditScopePredicate(CREDIT_READ_MODE.AGGREGATE_ONLY, { aggregateExpr: 'A', selfExpr: 'S' }), { sql: '(A)', args: [] });
    assert.deepEqual(creditScopePredicate(CREDIT_READ_MODE.AGGREGATE_PLUS_SELF, { aggregateExpr: 'A', selfExpr: 'S', selfValue: 'sp-self' }),
      { sql: '(A OR S)', args: ['sp-self'] });
    // A denied mode never renders an unscoped predicate.
    assert.throws(() => creditScopePredicate(CREDIT_READ_MODE.DENY, { aggregateExpr: 'A', selfExpr: 'S' }),
      (error) => error.status === 403 && error.code === 'CREDIT_SCOPE_DENIED');
  });
});

// ---------------------------------------------------------------------------
// 2. Positive authorization matrix
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.10 — the five modes read exactly their own scope on every Credit read surface', async () => {
  await withWorld(async (db, world) => {
    const aggregateResultIds = ids(world.results.filter((row) => row.scope_type === 'CUSTOMER_AGGREGATE'));
    const subLimitResultIds = ids(world.results.filter((row) => row.scope_type === 'SALESPERSON_SUB_LIMIT'));
    const selfSubLimitId = world.results.find((row) => row.sales_order_id === 'so-cus-w11-self').id;

    // ADMIN — every scope on every surface.
    const adminResults = await read(listCreditCheckResults, db, ADMIN, {});
    assert.equal(adminResults.statusCode, 200);
    assert.deepEqual(ids(adminResults.body.results), [...aggregateResultIds, ...subLimitResultIds].sort());
    const adminApprovals = await read(listCreditSpecialApprovals, db, ADMIN, {});
    assert.equal(adminApprovals.statusCode, 200);
    assert.equal(adminApprovals.body.approvals.length, 4);
    const adminProfiles = await read(listCreditProfiles, db, ADMIN, {});
    assert.equal(adminProfiles.statusCode, 200);
    assert.equal(adminProfiles.body.profiles.length, CUSTOMERS.length * 2);

    // CREDIT_VIEW + SALES_CROSS_GROUP — every scope.
    const crossResults = await read(listCreditCheckResults, db, CROSS_READER, {});
    assert.equal(crossResults.statusCode, 200);
    assert.deepEqual(ids(crossResults.body.results), [...aggregateResultIds, ...subLimitResultIds].sort());
    const crossApprovals = await read(listCreditSpecialApprovals, db, CROSS_READER, {});
    assert.equal(crossApprovals.body.approvals.length, 4);
    const crossProfiles = await read(listCreditProfiles, db, CROSS_READER, {});
    assert.equal(crossProfiles.body.profiles.length, CUSTOMERS.length * 2);

    // CREDIT_VIEW + a currently valid membership — aggregate plus own
    // sub-limit, and nothing of another salesperson.
    const selfResults = await read(listCreditCheckResults, db, SELF_ACTOR, {});
    assert.equal(selfResults.statusCode, 200);
    assert.deepEqual(ids(selfResults.body.results), [...aggregateResultIds, selfSubLimitId].sort());
    const selfApprovals = await read(listCreditSpecialApprovals, db, SELF_ACTOR, {});
    assert.deepEqual(ids(selfApprovals.body.approvals), [world.approvals.aggregate.id, world.approvals.self.id].sort());
    const selfProfiles = await read(listCreditProfiles, db, SELF_ACTOR, {});
    const expectedSelfProfileIds = CUSTOMERS
      .flatMap((customer) => [
        world.profiles[`${customer.id}:aggregate`].id,
        customer.salespersonId === 'sp-self' ? world.profiles[`${customer.id}:sp-self`].id : null,
      ])
      .filter(Boolean)
      .sort();
    assert.deepEqual(ids(selfProfiles.body.profiles), expectedSelfProfileIds,
      'a valid membership reads the aggregate plus its own sub-limit only');

    // CREDIT_VIEW without any salesperson mapping — aggregate only.
    const unmappedResults = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, {});
    assert.deepEqual(ids(unmappedResults.body.results), aggregateResultIds);
    const unmappedApprovals = await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, {});
    assert.deepEqual(ids(unmappedApprovals.body.approvals), [world.approvals.aggregate.id]);
    const unmappedProfiles = await read(listCreditProfiles, db, UNMAPPED_ACTOR, {});
    assert.deepEqual(ids(unmappedProfiles.body.profiles), CUSTOMERS.map((customer) => world.profiles[`${customer.id}:aggregate`].id).sort());

    // No CREDIT_VIEW — every surface refuses before it queries.
    for (const actor of [NO_CREDIT]) {
      const deniedResults = await read(listCreditCheckResults, db, actor, {});
      assert.equal(deniedResults.statusCode, 403);
      assert.equal(deniedResults.code, 'CREDIT_SCOPE_DENIED');
      const deniedApprovals = await read(listCreditSpecialApprovals, db, actor, {});
      assert.equal(deniedApprovals.statusCode, 403);
      assert.equal(deniedApprovals.code, 'CREDIT_SCOPE_DENIED');
      const deniedApprovalDetail = await readById(getCreditSpecialApproval, db, actor, world.approvals.aggregate.id);
      assert.equal(deniedApprovalDetail.statusCode, 403);
      assert.equal(deniedApprovalDetail.code, 'CREDIT_SCOPE_DENIED');
      const deniedProfiles = await read(listCreditProfiles, db, actor, {});
      assert.equal(deniedProfiles.statusCode, 403);
      assert.equal(deniedProfiles.code, 'CREDIT_SCOPE_DENIED');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. CORRECTION-1 — a historical date never restores a revoked scope
// ---------------------------------------------------------------------------

test('W11-SEC-01 CORRECTION-1 — an ended membership never regains the self scope through a historical date', async () => {
  await withWorld(async (db, world) => {
    const expiredSubLimitProfile = world.profiles['cus-w11-expired:sp-expired'];
    const aggregateProfileIds = CUSTOMERS.map((customer) => world.profiles[`${customer.id}:aggregate`].id).sort();

    // No date at all.
    const noDate = await read(listCreditProfiles, db, EXPIRED_ACTOR, {});
    assert.equal(noDate.statusCode, 200);
    assert.deepEqual(ids(noDate.body.profiles), aggregateProfileIds, 'an ended membership grants aggregate only');

    // A historical date inside the ended membership window and inside the
    // effective window of the profile. Before the fix this re-granted
    // AGGREGATE_PLUS_SELF and exposed the sub-limit row.
    const historical = await read(listCreditProfiles, db, EXPIRED_ACTOR, { businessDate: HISTORICAL });
    assert.equal(historical.statusCode, 200);
    assert.deepEqual(ids(historical.body.profiles), aggregateProfileIds,
      'a historical business date must not restore the revoked self scope');
    assert.equal(historical.body.profiles.some((row) => row.id === expiredSubLimitProfile.id), false);

    // A future date.
    const future = await read(listCreditProfiles, db, EXPIRED_ACTOR, { businessDate: FUTURE_DATE });
    assert.equal(future.statusCode, 200);
    assert.deepEqual(ids(future.body.profiles), aggregateProfileIds,
      'a future business date must not grant a scope the actor never had');

    // The same holds on the Wave 10 read surfaces.
    const otherSubLimitResult = world.results.find((row) => row.sales_order_id === 'so-cus-w11-other').id;
    for (const params of [{}, { businessDate: HISTORICAL }, { businessDate: FUTURE_DATE }]) {
      const results = await read(listCreditCheckResults, db, EXPIRED_ACTOR, params);
      assert.equal(results.statusCode, 200);
      assert.equal(results.body.results.some((row) => row.id === otherSubLimitResult.id), false,
        `a sub-limit result leaked for ${JSON.stringify(params)}`);
      assert.equal(results.body.results.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);
      const approvals = await read(listCreditSpecialApprovals, db, EXPIRED_ACTOR, params);
      assert.equal(approvals.statusCode, 200);
      assert.equal(approvals.body.approvals.some((row) => row.id === world.approvals.other.id), false,
        `a sub-limit approval leaked for ${JSON.stringify(params)}`);
      assert.equal(approvals.body.approvals.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);
    }

    // The aggregate read policy is untouched: an aggregate row stays visible.
    const aggregateStillVisible = await read(listCreditCheckResults, db, EXPIRED_ACTOR, {});
    assert.equal(aggregateStillVisible.body.results.length, CUSTOMERS.length);
    const aggregateApprovalVisible = await read(listCreditSpecialApprovals, db, EXPIRED_ACTOR, {});
    assert.deepEqual(ids(aggregateApprovalVisible.body.approvals), [world.approvals.aggregate.id]);
  });
});

test('W11-SEC-01 CORRECTION-1 — a membership that has not started yet grants nothing, on any date', async () => {
  await withWorld(async (db, world) => {
    const futureSubLimitProfile = world.profiles['cus-w11-future:sp-future'];
    const aggregateProfileIds = CUSTOMERS.map((customer) => world.profiles[`${customer.id}:aggregate`].id).sort();
    for (const params of [{}, { businessDate: HISTORICAL }, { businessDate: FUTURE_DATE }]) {
      const listed = await read(listCreditProfiles, db, FUTURE_ACTOR, params);
      assert.equal(listed.statusCode, 200);
      assert.deepEqual(ids(listed.body.profiles), aggregateProfileIds, `scope widened for ${JSON.stringify(params)}`);
      assert.equal(listed.body.profiles.some((row) => row.id === futureSubLimitProfile.id), false);
    }
  });
});

test('W11-SEC-01 — a currently valid membership keeps its own scope on a historical date', async () => {
  await withWorld(async (db, world) => {
    const ownProfile = world.profiles['cus-w11-self:sp-self'];
    const otherProfile = world.profiles['cus-w11-other:sp-other'];
    const listed = await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: HISTORICAL });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.profiles.some((row) => row.id === ownProfile.id), true,
      'a valid membership keeps the own sub-limit on a historical date');
    assert.equal(listed.body.profiles.some((row) => row.id === otherProfile.id), false,
      'a historical date never reaches another salesperson scope');
  });
});

test('W11-SEC-01 — the historical date still filters data, it only stops granting scope', async () => {
  await withWorld(async (db, world) => {
    const ownProfile = world.profiles['cus-w11-self:sp-self'];
    const beforeEffective = await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: shiftDays(PROFILE_FROM, -1) });
    assert.equal(beforeEffective.statusCode, 200);
    assert.equal(beforeEffective.body.profiles.some((row) => row.id === ownProfile.id), false,
      'the effective-date data filter still applies');
    const onEffective = await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: PROFILE_FROM });
    assert.equal(onEffective.body.profiles.some((row) => row.id === ownProfile.id), true);
  });
});

// ---------------------------------------------------------------------------
// 4. Profile detail agrees with the collection
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.4 — the Profile detail uses the same scope as the collection', async () => {
  await withWorld(async (db, world) => {
    for (const actor of [ADMIN, CROSS_READER, SELF_ACTOR, OTHER_ACTOR, UNMAPPED_ACTOR, EXPIRED_ACTOR]) {
      const listed = await read(listCreditProfiles, db, actor, {});
      const reachable = [];
      for (const row of listed.body.profiles) {
        const detail = await readById(getCreditProfile, db, actor, row.id);
        assert.equal(detail.statusCode, 200, `collection/detail mismatch for ${row.id}`);
        reachable.push(row.id);
      }
      for (const profile of Object.values(world.profiles)) {
        if (reachable.includes(profile.id)) continue;
        const detail = await readById(getCreditProfile, db, actor, profile.id);
        assert.equal(detail.statusCode, 404, `a hidden profile stayed reachable (${actor.id} -> ${profile.id})`);
        assert.equal(detail.code, 'CREDIT_PROFILE_NOT_FOUND');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Single-point bypass closure
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.5 — a source id, a check group or a business filter never reaches an out-of-scope row', async () => {
  await withWorld(async (db, world) => {
    // One check group holds two result rows: the customer aggregate row and
    // the salesperson sub-limit row. A restricted reader may reach the
    // aggregate row of that group but never the sub-limit row beside it.
    const otherGroup = world.subLimitResults['cus-w11-other'].check_group_id;
    const otherAggregateId = world.aggregateResults['cus-w11-other'].id;
    const otherSubLimitId = world.subLimitResults['cus-w11-other'].id;

    // Direct check group id.
    const byGroup = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { checkGroupId: otherGroup });
    assert.equal(byGroup.statusCode, 200);
    assert.deepEqual(ids(byGroup.body.results), [otherAggregateId],
      'a check group id reaches the aggregate row of the group but never its sub-limit row');

    // Direct source id, both source kinds.
    const byOrder = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { sourceType: 'SALES_ORDER', sourceId: 'so-cus-w11-other' });
    assert.deepEqual(ids(byOrder.body.results), [otherAggregateId]);
    const byDelivery = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { sourceType: 'SALES_DELIVERY', sourceId: 'so-cus-w11-other' });
    assert.deepEqual(ids(byDelivery.body.results), [],
      'a delivery source id never matches a sales order row');

    // The business filters never widen the scope either.
    const byStage = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { stage: 'SO_SUBMIT' });
    assert.equal(byStage.body.results.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);
    const byDecision = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { decision: 'SPECIAL_APPROVAL_REQUIRED' });
    assert.equal(byDecision.body.results.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);

    // The approval list filters the same way.
    const approvalsByOrder = await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, { salesOrderId: 'so-cus-w11-other' });
    assert.deepEqual(approvalsByOrder.body.approvals, [],
      'the sub-limit approval of that order stays out of reach');
    const approvalsByScope = await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, { scopeType: 'SALESPERSON_SUB_LIMIT' });
    assert.deepEqual(approvalsByScope.body.approvals, [], 'a scope type filter must not expose a sub-limit approval');
    const approvalsByDecision = await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, { decision: 'PENDING' });
    assert.deepEqual(ids(approvalsByDecision.body.approvals), [world.approvals.aggregate.id]);

    // A legitimate filter still narrows within the authorized scope.
    const selfResults = await read(listCreditCheckResults, db, SELF_ACTOR, { checkGroupId: otherGroup });
    assert.deepEqual(ids(selfResults.body.results), [otherAggregateId]);
    const ownGroup = world.subLimitResults['cus-w11-self'].check_group_id;
    const ownGroupResults = await read(listCreditCheckResults, db, SELF_ACTOR, { checkGroupId: ownGroup });
    assert.equal(ownGroupResults.body.results.length, 2, 'the own check group stays readable');
    assert.equal(ownGroupResults.body.results.some((row) => row.id === otherSubLimitId), false);
  });
});

// ---------------------------------------------------------------------------
// 6. Fail closed on relations that cannot be attributed
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.5.3 — a result whose Credit Profile cannot be attributed is excluded, never downgraded to aggregate', async () => {
  await withWorld(async (db, world) => {
    // The schema allows a result without a Credit Profile. Such a row cannot
    // be attributed to any scope, so a restricted reader must not see it —
    // and least of all as an aggregate row.
    const template = world.results.find((row) => row.scope_type === 'CUSTOMER_AGGREGATE');
    db.prepare(`INSERT INTO credit_check_results(id, check_group_id, scope_type, credit_lock_anchor_id,
        credit_profile_id, credit_policy_snapshot_id, policy_snapshot_fingerprint, profile_effective_state_hash,
        sales_order_id, sales_delivery_id, stage, business_date, proposed_delta_cents, recognition_mode,
        decision, reason_codes_json, component_breakdown_json, eligible_prepayment_source_identity,
        evaluated_at, evaluated_by)
      VALUES(?,?,'CUSTOMER_AGGREGATE',?,NULL,?,?,?,?,NULL,'SO_SUBMIT',?,?,'DIRECT_BUSINESS_OPEN_ITEM',
        'SPECIAL_APPROVAL_REQUIRED','[]',?,NULL,?,?)`).run(
      'w11-result-no-profile', 'w11-group-no-profile', template.credit_lock_anchor_id,
      template.credit_policy_snapshot_id, template.policy_snapshot_fingerprint, template.profile_effective_state_hash,
      template.sales_order_id, HISTORICAL, PROPOSED_DELTA,
      JSON.stringify({ contractVersion: 'CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1', proposedTotalCents: PROPOSED_DELTA, creditLimitCents: AGGREGATE_LIMIT }),
      new Date().toISOString(), 'w11-admin',
    );

    for (const actor of [UNMAPPED_ACTOR, SELF_ACTOR, EXPIRED_ACTOR]) {
      const listed = await read(listCreditCheckResults, db, actor, {});
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.body.results.some((row) => row.id === 'w11-result-no-profile'), false,
        `an unattributable result leaked to ${actor.id}`);
    }
    // The unrestricted modes still see it: the remediation only narrows.
    const admin = await read(listCreditCheckResults, db, ADMIN, {});
    assert.equal(admin.body.results.some((row) => row.id === 'w11-result-no-profile'), true);
    const cross = await read(listCreditCheckResults, db, CROSS_READER, {});
    assert.equal(cross.body.results.some((row) => row.id === 'w11-result-no-profile'), true);

    // An approval bound to that unattributable result fails closed as well.
    const approval = await seedApproval(db, 'w11-result-no-profile', 'approval-no-profile');
    for (const actor of [UNMAPPED_ACTOR, SELF_ACTOR]) {
      const listed = await read(listCreditSpecialApprovals, db, actor, {});
      assert.equal(listed.body.approvals.some((row) => row.id === approval.id), false,
        `an approval of an unattributable result leaked to ${actor.id}`);
      const detail = await readById(getCreditSpecialApproval, db, actor, approval.id);
      assert.equal(detail.statusCode, 404);
    }
    const adminApproval = await readById(getCreditSpecialApproval, db, ADMIN, approval.id);
    assert.equal(adminApproval.statusCode, 200);

    // The approval table cannot hold an orphan: the source link is NOT NULL
    // and carries a foreign key onto the check result.
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(credit_special_approval)').all();
    assert.ok(foreignKeys.some((row) => row.from === 'source_credit_check_result_id'
      && row.table === 'credit_check_results' && row.to === 'id'));
    const columns = db.prepare('PRAGMA table_info(credit_special_approval)').all();
    const source = columns.find((row) => row.name === 'source_credit_check_result_id');
    assert.equal(source.notnull, 1, 'an orphan approval is structurally impossible');
  });
});

// ---------------------------------------------------------------------------
// 7. Pagination, ordering and counts never leak the out-of-scope size
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.6 — the returned rows are counted and ordered inside the authorized scope', async () => {
  await withWorld(async (db, world) => {
    const aggregateIds = ids(world.results.filter((row) => row.scope_type === 'CUSTOMER_AGGREGATE'));
    const listed = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, {});
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(Object.keys(listed.body), ['results'], 'the frozen response shape is unchanged');
    assert.equal(listed.body.results.length, aggregateIds.length, 'the count is the scoped count, not the global count');
    assert.equal(listed.body.results.some((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT'), false);

    // The ordering is a total order over the scoped rows and never mentions an
    // out-of-scope row.
    const admin = await read(listCreditCheckResults, db, ADMIN, {});
    const adminIds = admin.body.results.map((row) => row.id);
    assert.equal(new Set(adminIds).size, adminIds.length, 'the order is deterministic');
    const scopedIds = listed.body.results.map((row) => row.id);
    assert.deepEqual(scopedIds, adminIds.filter((id) => scopedIds.includes(id)),
      'the scoped order is the restricted order of the unrestricted list');

    // The approval list counts and orders the same way, and PENDING stays
    // in front of the decided approvals.
    const approvals = await read(listCreditSpecialApprovals, db, ADMIN, {});
    assert.deepEqual(Object.keys(approvals.body), ['approvals']);
    assert.equal(approvals.body.approvals.length, 4);
    assert.equal(approvals.body.approvals[0].decision, 'PENDING',
      'a pending approval stays in front of the decided ones');
    const scopedApprovals = await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, {});
    assert.equal(scopedApprovals.body.approvals.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 8. Non-enumerability
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.7 — an out-of-scope object is indistinguishable from an absent one', async () => {
  await withWorld(async (db, world) => {
    const outOfScope = await readById(getCreditSpecialApproval, db, UNMAPPED_ACTOR, world.approvals.other.id);
    const absent = await readById(getCreditSpecialApproval, db, UNMAPPED_ACTOR, 'w11-approval-does-not-exist');
    assert.equal(outOfScope.statusCode, 404);
    assert.equal(absent.statusCode, 404);
    assert.equal(outOfScope.code, absent.code);
    assert.equal(outOfScope.message, absent.message);
    assert.equal(outOfScope.body, absent.body);

    // The same for a Profile that belongs to another salesperson.
    const hiddenProfile = await readById(getCreditProfile, db, UNMAPPED_ACTOR, world.profiles['cus-w11-other:sp-other'].id);
    const missingProfile = await readById(getCreditProfile, db, UNMAPPED_ACTOR, 'w11-profile-does-not-exist');
    assert.equal(hiddenProfile.statusCode, 404);
    assert.equal(missingProfile.statusCode, 404);
    assert.equal(hiddenProfile.code, missingProfile.code);
    assert.equal(hiddenProfile.message, missingProfile.message);
  });
});

// ---------------------------------------------------------------------------
// 9. The remediation is read-only
// ---------------------------------------------------------------------------

test('W11-SEC-01 §37.54.7.9 — the remediation changes no business fact', async () => {
  await withWorld(async (db) => {
    const snapshot = () => ({
      results: db.prepare('SELECT * FROM credit_check_results ORDER BY id').all(),
      approvals: db.prepare('SELECT * FROM credit_special_approval ORDER BY id').all(),
      profiles: db.prepare('SELECT * FROM credit_profile ORDER BY id').all(),
      ratings: db.prepare('SELECT * FROM credit_profile_ratings ORDER BY id').all(),
      audits: db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
      snapshots: db.prepare('SELECT * FROM credit_policy_snapshots ORDER BY id').all(),
    });
    const before = snapshot();
    await read(listCreditCheckResults, db, UNMAPPED_ACTOR, {});
    await read(listCreditSpecialApprovals, db, UNMAPPED_ACTOR, {});
    await readById(getCreditSpecialApproval, db, SELF_ACTOR, 'w11-approval-does-not-exist');
    await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: HISTORICAL });
    assert.deepEqual(snapshot(), before, 'a read never writes a Credit fact');
  });
});

// ---------------------------------------------------------------------------
// 10. The regression that proves the bypass is really closed
// ---------------------------------------------------------------------------

test('W11-SEC-01 — the historical-date bypass is closed on the exact request that used to work', async () => {
  await withWorld(async (db, world) => {
    const expiredSubLimitProfile = world.profiles['cus-w11-expired:sp-expired'];
    const attack = await read(listCreditProfiles, db, EXPIRED_ACTOR, { businessDate: HISTORICAL });
    assert.equal(attack.statusCode, 200);
    const exposed = attack.body.profiles.some((row) => row.id === expiredSubLimitProfile.id
      || row.salespersonId === 'sp-expired');
    assert.equal(exposed, false,
      'GET /api/credit/profiles?businessDate=<historical> must not restore the revoked sub-limit scope');

    // The same request by a currently valid member keeps its own scope, so
    // the tightening did not remove a legitimate read.
    const legitimate = await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: HISTORICAL });
    assert.equal(legitimate.body.profiles.some((row) => row.id === world.profiles['cus-w11-self:sp-self'].id), true);
  });
});

// ---------------------------------------------------------------------------
// 11. The frozen Wave 10 surfaces keep their response shape
// ---------------------------------------------------------------------------

test('W11-SEC-01 — the frozen Wave 10 read surfaces keep their response shape and their ordering', async () => {
  await withWorld(async (db) => {
    const results = await read(listCreditCheckResults, db, ADMIN, {});
    assert.equal(results.statusCode, 200);
    assert.deepEqual(Object.keys(results.body), ['results']);
    assert.deepEqual(Object.keys(results.body.results[0]).sort(), [
      'businessDate', 'checkGroupId', 'componentBreakdown', 'creditLockAnchorId', 'creditPolicySnapshotId',
      'creditProfileId', 'decision', 'eligiblePrepaymentSourceIdentity', 'evaluatedAt', 'evaluatedBy',
      'id', 'policySnapshotFingerprint', 'profileEffectiveStateHash', 'proposedDeltaCents',
      'reasonCodes', 'recognitionMode', 'salesDeliveryId', 'salesOrderId', 'scopeType', 'stage',
    ]);
    const approvals = await read(listCreditSpecialApprovals, db, ADMIN, {});
    assert.equal(approvals.statusCode, 200);
    assert.deepEqual(Object.keys(approvals.body), ['approvals']);
    assert.deepEqual(Object.keys(approvals.body.approvals[0]).sort(), [
      'approvedCeilingCents', 'approvedExpiryBusinessDate', 'approvedOverrideCents',
      'approverId', 'auditId', 'authorityCeilingCents', 'decidedAt', 'decision', 'id', 'reason',
      'requestedCeilingCents', 'requestedExpiryBusinessDate', 'requestedOverrideCents', 'scopeMode',
      'scopeType', 'sourceCheckGroupId', 'sourceCreditCheckResultId', 'sourceCreditPolicySnapshotId',
      'sourcePolicySnapshotFingerprint', 'sourceProfileEffectiveStateHash', 'sourceSalesOrderId',
    ]);
  });
});
