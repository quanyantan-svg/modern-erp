// Wave 9 real-MySQL Credit authorization parity acceptance.
//
// Registered by scripts/gates/mysql-gate.mjs; never run without that gate's
// disposable-database identity and explicit reset authorization.
//
// The SQLite focused suite (server/sales-customer-wave9-credit-foundation.test.js)
// is NOT MySQL evidence: it opens node:sqlite handles, queries sqlite_master and
// spawns a node:sqlite anchor worker. This file exists so the same approved
// contracts execute through the production handlers on a real MySqlSyncAdapter
// session.
//
// Requirement : document.md §14 AP1-AP4.1, §14.5, §15 AP5, §15.8
// Design      : solution.md §36.15.2 - §36.15.11.1 (T-P*, T-G*)

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import {
  createCreditParameter, createCreditRule, listCreditParameters, listCreditRules,
  resolveCreditParameter, resolveCreditRule,
} from './modules/credit-policy.js';
import {
  createCreditProfile, getCreditProfile, listCreditProfiles, resolveEffectiveCreditProfile,
} from './modules/credit-profile.js';
import { creditObjectAnchorKey, listCreditAnchors, policyScopeAnchorKey, provisionCreditAnchor } from './modules/credit-anchor.js';
import { CREDIT_READ_MODE, resolveCreditProfileReadScope } from './modules/credit-scope.js';

// Fail closed. Loading this file without the disposable MySQL identity must
// fail the run, never silently skip its way to a PASS.
const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

// Each actor carries exactly the authority its scenario needs. The permission
// registry is flat: CREDIT_MANAGE implies neither read nor write, and
// SALES_CROSS_GROUP grants no Credit capability (AP4 / AP5).
const ADMIN = Object.freeze({ id: 'w9-user-admin', roleCode: 'ADMIN', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const FULL_THREE = Object.freeze({ id: 'w9-user-full', roleCode: 'CREDIT_ADMIN', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const VIEWER = Object.freeze({ id: 'w9-user-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const VIEWER_WITH_MANAGE = Object.freeze({ id: 'w9-user-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE'] });
const REVIEWER = Object.freeze({ id: 'w9-user-reviewer', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW'] });
const CROSS_READER = Object.freeze({ id: 'w9-user-reviewer', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW', 'SALES_CROSS_GROUP'] });
const CENTRAL_WRITER_NO_READ = Object.freeze({ id: 'w9-user-writer', roleCode: 'SALES', permissions: ['CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const CROSS_ONLY = Object.freeze({ id: 'w9-user-cross', roleCode: 'REVIEWER', permissions: ['SALES_CROSS_GROUP'] });
const MANAGE_ONLY = Object.freeze({ id: 'w9-user-mgr', roleCode: 'SALES', permissions: ['CREDIT_MANAGE'] });
const NO_CREDIT = Object.freeze({ id: 'w9-user-warehouse', roleCode: 'WAREHOUSE', permissions: [] });
const OTHER_SALES = Object.freeze({ id: 'w9-user-other-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });

const CREDIT_ENTITIES = "('CREDIT_PROFILE','CREDIT_PROFILE_RATING','CREDIT_PARAMETER','CREDIT_CHECK_RULE','CREDIT_LOCK_ANCHOR','CREDIT_POLICY_SNAPSHOT')";
const WAVE11_TABLES = ['credit_evaluation_result', 'credit_check_results', 'credit_special_approval'];
const ALL_ACTORS = [ADMIN, FULL_THREE, VIEWER, VIEWER_WITH_MANAGE, REVIEWER, CROSS_READER, CENTRAL_WRITER_NO_READ, CROSS_ONLY, MANAGE_ONLY, NO_CREDIT, OTHER_SALES];

function request(body, key) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

async function invoke(handler, db, body, actor, key) {
  const res = response();
  await handler(db, request(body, key), res, actor);
  return res;
}

// A permission denial must stay distinguishable from a business-validation
// failure, so denials are read as values instead of only as thrown errors.
async function denial(handler, db, body, actor, key) {
  try {
    await invoke(handler, db, body, actor, key);
    return { denied: false, status: 200, code: null };
  } catch (error) {
    return { denied: true, status: error.status, code: error.code || error.details?.code };
  }
}

async function read(handler, db, actor, params) {
  const res = response();
  try {
    await handler(db, res, actor, { searchParams: new URLSearchParams(params || {}) });
    return { statusCode: res.statusCode, body: res.body, code: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code };
  }
}

async function readById(handler, db, actor, id) {
  const res = response();
  try {
    await handler(db, res, actor, id);
    return { statusCode: res.statusCode, body: res.body, code: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code };
  }
}

// Side-effect snapshots are projections of scalar columns ordered by primary
// key. Nothing is compared through physical scan order and no JSON column is
// compared as text, so neither can manufacture a false diff.
function byId(db, sql, ...args) {
  return db.prepare(sql).all(...args)
    .map((row) => ({ ...row }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function footprint(db) {
  return {
    profiles: byId(db, 'SELECT id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,credit_object_id,credit_limit_cents,initial_state,status,rating_grade,rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,effective_from,effective_to,created_by FROM credit_profile'),
    ratings: byId(db, 'SELECT id,credit_profile_id,rating_source_type,rating_source_key,evaluation_result_id,rating_grade,applied_by,superseded_at FROM credit_profile_ratings'),
    anchors: byId(db, 'SELECT id,anchor_key,anchor_type,customer_id,salesperson_id,credit_object_type,credit_object_id,policy_scope_type,policy_scope_id FROM credit_lock_anchors'),
    parameters: byId(db, 'SELECT id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,superseded_by_id,created_by FROM credit_parameters'),
    rules: byId(db, 'SELECT id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,recognition_mode,effective_from,effective_to,status,created_by FROM credit_check_rules'),
    snapshots: byId(db, 'SELECT id,credit_lock_anchor_id,scope_type,credit_profile_id,snapshot_fingerprint,business_date,parameter_set_hash,rule_set_hash,profile_effective_state_hash,captured_by FROM credit_policy_snapshots'),
    audit: byId(db, `SELECT id,user_id,action,entity_type,entity_id,detail FROM audit_logs WHERE entity_type IN ${CREDIT_ENTITIES}`),
    idempotency: byId(db, 'SELECT id,operation_type,document_id,idempotency_key,request_fingerprint,status FROM idempotency_records'),
  };
}

let stamp;

function seedUser(db, id) {
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,'x','x','role-admin',1,?)`).run(id, id, id, stamp);
}

function seedCustomer(db, id) {
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES(?,?,?,'MySQL Credit','','',1,?,?)`).run(id, id.toUpperCase(), `MySQL Credit ${id}`, stamp, stamp);
}

function seedSalesGroup(db, { id, active = 1 }) {
  db.prepare('INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?)')
    .run(id, id.toUpperCase(), id, active, stamp, stamp);
}

function seedSalesperson(db, { id, userId, active = 1 }) {
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(id, id.toUpperCase(), id, userId, active, stamp, stamp);
}

function seedMembership(db, { id, salespersonId, salesGroupId, active = 1, effectiveFrom = '2020-01-01', effectiveTo = null }) {
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,created_by,updated_at)
    VALUES(?,?,?,1,?,?,?,?,NULL,?)`).run(id, salespersonId, salesGroupId, active, effectiveFrom, effectiveTo, stamp, stamp);
}

function profileBody(overrides = {}) {
  return {
    customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-OBJ',
    creditLimitCents: 500000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
    effectiveFrom: '2026-01-01', ...overrides,
  };
}

function parameterBody(overrides = {}) {
  return { code: 'CREDIT_MANAGEMENT_ENABLED', valueBool: false, effectiveFrom: '2026-01-01', status: 'ACTIVE', ...overrides };
}

function ruleBody(overrides = {}) {
  return {
    ruleCode: 'SO_LIMIT', businessStage: 'SO_SUBMIT', scenario: 'STANDARD', checkTiming: 'BEFORE_WRITE',
    controlStrength: 'BLOCK', creditItem: 'ORDER_EXPOSURE', effectiveFrom: '2026-01-01',
    status: 'ACTIVE', resultPayload: { outcome: 'BLOCK' }, ...overrides,
  };
}

// Aggregate, own sub-limit and a second salesperson's sub-limit under one
// shared active Sales Group, so same-group visibility is genuinely testable.
async function seedThreeScopeProfiles(db, tag) {
  seedCustomer(db, `w9-c-agg-${tag}`);
  seedCustomer(db, `w9-c-other-${tag}`);
  const aggregate = await invoke(createCreditProfile, db, profileBody({ customerId: `w9-c-agg-${tag}`, creditObjectId: `W9-OBJ-${tag}` }), ADMIN, `w9-seed-agg-${tag}`);
  const own = await invoke(createCreditProfile, db, profileBody({ customerId: `w9-c-agg-${tag}`, creditObjectId: `W9-OBJ-${tag}`, salespersonId: 'w9-salesperson-self', creditLimitCents: 125000 }), ADMIN, `w9-seed-own-${tag}`);
  const other = await invoke(createCreditProfile, db, profileBody({ customerId: `w9-c-other-${tag}`, creditObjectId: `W9-OBJ-${tag}`, salespersonId: 'w9-salesperson-other' }), ADMIN, `w9-seed-other-${tag}`);
  return { aggregate: aggregate.body.profile, own: own.body.profile, other: other.body.profile };
}

async function visibleProfileIds(db, actor, universe) {
  const listed = await read(listCreditProfiles, db, actor, {});
  assert.equal(listed.statusCode, 200, `${actor.roleCode}:${actor.permissions.join('+')} collection read`);
  return listed.body.profiles.filter((row) => universe.includes(row.id)).map((row) => row.id).sort();
}

describe('Sales & Customer Wave 9 — real MySQL Credit authorization parity', () => {
  let handle;
  let db;

  before(() => {
    stamp = new Date().toISOString();
    handle = createTempDb({ label: 'sales-customer-wave9-credit', production: true });
    db = handle.db;
    // Fail closed: a SQLite fallback here would invalidate every assertion below.
    assert.equal(db.dialect, 'mysql');
    // VIEWER/VIEWER_WITH_MANAGE and REVIEWER/CROSS_READER share one user id, so
    // the fixture is seeded per distinct id, not per actor object.
    for (const id of new Set(ALL_ACTORS.map((actor) => actor.id))) seedUser(db, id);
    seedSalesGroup(db, { id: 'w9-group' });
    seedSalesperson(db, { id: 'w9-salesperson-self', userId: VIEWER.id });
    seedSalesperson(db, { id: 'w9-salesperson-other', userId: OTHER_SALES.id });
    // Both memberships sit in the same active group, which is what makes the
    // "same group does not widen visibility" assertion meaningful.
    seedMembership(db, { id: 'w9-membership-self', salespersonId: 'w9-salesperson-self', salesGroupId: 'w9-group' });
    seedMembership(db, { id: 'w9-membership-other', salespersonId: 'w9-salesperson-other', salesGroupId: 'w9-group' });
    seedCustomer(db, 'w9-c-main');
  });
  after(() => handle?.cleanup());

  test('the suite runs on a real MySQL adapter against the six Wave 9 tables', () => {
    assert.equal(db.dialect, 'mysql');
    assert.match(String(db.prepare('SELECT VERSION() version').get().version), /^8\./);
    const selected = db.prepare('SELECT DATABASE() db').get().db;
    assert.equal(selected, process.env.ERP_DB_NAME);
    assert.ok(selected.length > 0, 'a real schema is selected');

    const tables = db.prepare(`SELECT TABLE_NAME name,ENGINE engine FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${SALES_WAVE9_TABLES.map(() => '?').join(',')}) ORDER BY TABLE_NAME`)
      .all(...SALES_WAVE9_TABLES);
    assert.deepEqual(tables.map((row) => row.name), [...SALES_WAVE9_TABLES].sort());
    for (const row of tables) assert.equal(row.engine, 'InnoDB', `${row.name} must be transactional`);

    const anchorUnique = db.prepare(`SELECT COLUMN_NAME column_name,NON_UNIQUE non_unique
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_lock_anchors'
      AND INDEX_NAME='uq_credit_lock_anchors_anchor_key' ORDER BY SEQ_IN_INDEX`).all();
    assert.deepEqual(anchorUnique.map((row) => row.column_name), ['anchor_key']);
    assert.ok(anchorUnique.every((row) => Number(row.non_unique) === 0));

    // Wave 11 evaluation identity must not exist in Wave 9.
    assert.deepEqual(
      db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN (${WAVE11_TABLES.map(() => '?').join(',')})`).all(...WAVE11_TABLES),
      [],
    );
  });

  test('AP1-AP4.1 all five resolver modes execute on MySQL with the approved predicate split', async () => {
    const ids = await seedThreeScopeProfiles(db, 'modes');
    const universe = [ids.aggregate.id, ids.own.id, ids.other.id];

    assert.equal(resolveCreditProfileReadScope(db, ADMIN, {}).mode, CREDIT_READ_MODE.ALL);
    assert.equal(resolveCreditProfileReadScope(db, CROSS_READER, {}).mode, CREDIT_READ_MODE.CROSS_GROUP);
    assert.equal(resolveCreditProfileReadScope(db, VIEWER, {}).mode, CREDIT_READ_MODE.AGGREGATE_PLUS_SELF);
    assert.equal(resolveCreditProfileReadScope(db, REVIEWER, {}).mode, CREDIT_READ_MODE.AGGREGATE_ONLY);
    for (const actor of [CROSS_ONLY, MANAGE_ONLY, NO_CREDIT]) {
      assert.throws(() => resolveCreditProfileReadScope(db, actor, {}),
        (error) => error.status === 403 && error.code === 'CREDIT_SCOPE_DENIED', `${actor.id} must resolve to DENY`);
    }

    // T-P18: AGGREGATE_ONLY binds nothing, so no substituted value can widen it.
    const aggregateOnly = resolveCreditProfileReadScope(db, REVIEWER, {});
    assert.deepEqual(aggregateOnly.predicateArgs, []);
    assert.equal(aggregateOnly.predicateSql.includes('?'), false);
    const plusSelf = resolveCreditProfileReadScope(db, VIEWER, {});
    assert.deepEqual(plusSelf.predicateArgs, ['w9-salesperson-self']);

    for (const [actor, expected] of [
      [ADMIN, [ids.aggregate.id, ids.own.id, ids.other.id]],
      [CROSS_READER, [ids.aggregate.id, ids.own.id, ids.other.id]],
      [VIEWER, [ids.aggregate.id, ids.own.id]],
      [REVIEWER, [ids.aggregate.id]],
    ]) {
      assert.deepEqual(await visibleProfileIds(db, actor, universe), [...expected].sort(), `${actor.roleCode} visible set`);
    }

    const aggregateOnlyRead = await read(listCreditProfiles, db, REVIEWER, {});
    assert.equal(aggregateOnlyRead.statusCode, 200, 'AGGREGATE_ONLY still returns rows');
    assert.ok(aggregateOnlyRead.body.profiles.some((row) => row.id === ids.aggregate.id), 'the aggregate row is present for an unmapped actor');

    for (const actor of [CROSS_ONLY, MANAGE_ONLY, NO_CREDIT]) {
      const listed = await read(listCreditProfiles, db, actor, {});
      assert.equal(listed.statusCode, 403, `${actor.id} must be denied`);
      assert.equal(listed.code, 'CREDIT_SCOPE_DENIED');
    }
  });

  test('AP3 same-group membership exposes no other salesperson sub-limit on MySQL', async () => {
    const ids = await seedThreeScopeProfiles(db, 'samegroup');
    assert.ok(
      Number(db.prepare('SELECT COUNT(*) n FROM salesperson_group_memberships WHERE sales_group_id=? AND active=1').get('w9-group').n) >= 2,
      'the shared group really holds more than one active member',
    );

    const visible = await visibleProfileIds(db, VIEWER, [ids.aggregate.id, ids.own.id, ids.other.id]);
    assert.ok(visible.includes(ids.own.id), 'own sub-limit is visible');
    assert.equal(visible.includes(ids.other.id), false, 'a same-group peer sub-limit stays hidden');
    assert.deepEqual(await visibleProfileIds(db, OTHER_SALES, [ids.aggregate.id, ids.own.id, ids.other.id]), [ids.aggregate.id, ids.other.id].sort(),
      'the peer sees its own sub-limit and never the first one');

    const restricted = await readById(getCreditProfile, db, VIEWER, ids.other.id);
    assert.equal(restricted.statusCode, 404);
    assert.equal(restricted.code, 'CREDIT_PROFILE_NOT_FOUND');
    assert.equal(restricted.body, null, 'a denial leaks no profile body');
  });

  test('N8 collection and detail permissions are equivalent in every mode and never enumerate', async () => {
    const ids = await seedThreeScopeProfiles(db, 'parity');
    const universe = [ids.aggregate.id, ids.own.id, ids.other.id];

    for (const actor of [ADMIN, CROSS_READER, VIEWER, REVIEWER]) {
      const listedIds = await visibleProfileIds(db, actor, universe);
      for (const id of universe) {
        const detail = await readById(getCreditProfile, db, actor, id);
        if (listedIds.includes(id)) assert.equal(detail.statusCode, 200, `${actor.roleCode} must reach ${id}`);
        else {
          assert.equal(detail.statusCode, 404, `${actor.roleCode} must not reach ${id} hidden from the collection`);
          assert.equal(detail.code, 'CREDIT_PROFILE_NOT_FOUND');
        }
      }
    }

    const restricted = await readById(getCreditProfile, db, VIEWER, ids.other.id);
    const missing = await readById(getCreditProfile, db, VIEWER, 'w9-profile-does-not-exist');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.code, restricted.code, 'absent and restricted rows must be indistinguishable');
    assert.equal(missing.body, null);
  });

  test('AP3 self-scope eligibility: inactive, expired, invalid and unmapped actors keep aggregate read', async () => {
    const ids = await seedThreeScopeProfiles(db, 'eligibility');
    const aggregateOnly = async (label) => {
      assert.deepEqual(await visibleProfileIds(db, VIEWER, [ids.aggregate.id, ids.own.id, ids.other.id]), [ids.aggregate.id],
        `${label} loses only the self sub-limit, never the aggregate read`);
    };

    db.prepare("UPDATE salesperson_profiles SET active=0 WHERE id='w9-salesperson-self'").run();
    await aggregateOnly('inactive salesperson profile');
    db.prepare("UPDATE salesperson_profiles SET active=1 WHERE id='w9-salesperson-self'").run();

    db.prepare("UPDATE salesperson_group_memberships SET effective_to='2021-01-01' WHERE id='w9-membership-self'").run();
    await aggregateOnly('expired membership');
    db.prepare("UPDATE salesperson_group_memberships SET effective_to=NULL WHERE id='w9-membership-self'").run();

    db.prepare("UPDATE salesperson_group_memberships SET effective_from='2999-01-01' WHERE id='w9-membership-self'").run();
    await aggregateOnly('not yet effective membership');
    db.prepare("UPDATE salesperson_group_memberships SET effective_from='2020-01-01' WHERE id='w9-membership-self'").run();

    db.prepare("UPDATE salesperson_group_memberships SET active=0 WHERE id='w9-membership-self'").run();
    await aggregateOnly('inactive membership');
    db.prepare("UPDATE salesperson_group_memberships SET active=1 WHERE id='w9-membership-self'").run();

    db.prepare("UPDATE sales_groups SET active=0 WHERE id='w9-group'").run();
    await aggregateOnly('inactive group');
    db.prepare("UPDATE sales_groups SET active=1 WHERE id='w9-group'").run();

    assert.deepEqual(await visibleProfileIds(db, REVIEWER, [ids.aggregate.id, ids.own.id, ids.other.id]), [ids.aggregate.id],
      'an unmapped CREDIT_VIEW holder reads the aggregate only');

    assert.deepEqual(await visibleProfileIds(db, VIEWER, [ids.aggregate.id, ids.own.id, ids.other.id]), [ids.aggregate.id, ids.own.id].sort(),
      'a valid own membership restores self-scope');
  });

  test('SC87 aggregate and sub-limit identities normalize to distinct scopes on MySQL', async () => {
    const ids = await seedThreeScopeProfiles(db, 'identity');
    const rows = db.prepare('SELECT * FROM credit_profile WHERE customer_id=? ORDER BY salesperson_scope_key').all('w9-c-agg-identity');
    const aggregate = rows.find((row) => row.salesperson_scope_key === '*');
    const sub = rows.find((row) => row.salesperson_scope_key !== '*');

    assert.equal(aggregate.salesperson_scope_key, '*');
    assert.equal(aggregate.salesperson_id, null);
    assert.equal(sub.salesperson_scope_key, 'w9-salesperson-self');
    assert.equal(sub.salesperson_scope_key, sub.salesperson_id);
    assert.notEqual(aggregate.anchor_id, sub.anchor_id, 'each scope owns a distinct anchor');
    assert.equal(ids.aggregate.scopeType, 'CUSTOMER_AGGREGATE');
    assert.equal(ids.own.scopeType, 'SALESPERSON_SUB_LIMIT');
    assert.equal(ids.aggregate.unlimited, false);
    assert.equal(ids.own.creditLimitCents, 125000);

    // Scope normalization is enforced as a physical MySQL CHECK, not only in code.
    assert.throws(() => db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
      credit_object_type,credit_object_id,credit_limit_cents,initial_state,status,rating_grade,rating_effective_from,
      effective_from,created_at,created_by) VALUES('w9-bad-scope',?,'w9-c-agg-identity','*','w9-salesperson-self',
      'SALES_ORDER','W9-BAD',1,'NORMAL','ACTIVE','A','2026-01-01','2026-01-01',?,?)`).run(aggregate.anchor_id, stamp, ADMIN.id),
    /check/i, 'a wildcard scope key may not carry a salesperson identity');
  });

  test('SC88 effective-dated resolution, predecessor closure, overlap rejection and overdue policy persist on MySQL', async () => {
    const first = await invoke(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-SC88', overdueDayPolicy: '30', effectiveFrom: '2026-01-01' }), ADMIN, 'w9-sc88-v1');
    const second = await invoke(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-SC88', overdueDayPolicy: '15', effectiveFrom: '2026-07-01' }), ADMIN, 'w9-sc88-v2');
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);

    assert.equal(db.prepare('SELECT effective_to FROM credit_profile WHERE id=?').get(first.body.profile.id).effective_to, '2026-06-30', 'the predecessor is closed, not deleted');
    assert.equal(db.prepare('SELECT overdue_day_policy FROM credit_profile WHERE id=?').get(first.body.profile.id).overdue_day_policy, '30');
    assert.equal(resolveEffectiveCreditProfile(db, { customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-SC88', businessDate: '2026-08-01' }).id, second.body.profile.id);
    assert.equal(resolveEffectiveCreditProfile(db, { customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-SC88', businessDate: '2026-03-01' }).id, first.body.profile.id);
    assert.equal(resolveEffectiveCreditProfile(db, { customerId: 'w9-c-main', salespersonId: 'w9-salesperson-self', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-SC88', businessDate: '2026-08-01' }), null,
      'an aggregate lookup never falls back across scope');

    const sub = await invoke(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-SC88', salespersonId: 'w9-salesperson-self', overdueDayPolicy: '45', effectiveFrom: '2026-01-01' }), ADMIN, 'w9-sc88-sub');
    assert.equal(resolveEffectiveCreditProfile(db, { customerId: 'w9-c-main', salespersonId: 'w9-salesperson-self', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-SC88', businessDate: '2026-08-01' }).id, sub.body.profile.id);
    assert.equal(Number(sub.body.profile.creditLimitCents), 500000);
    assert.equal(db.prepare('SELECT overdue_day_policy FROM credit_profile WHERE id=?').get(sub.body.profile.id).overdue_day_policy, '45',
      'each scope keeps its own overdue-day policy');

    const duplicateVersion = await denial(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-SC88', effectiveFrom: '2026-01-01' }), ADMIN, 'w9-sc88-dup');
    assert.equal(duplicateVersion.status, 409, 'the same scope and effective_from may not repeat');

    const before = footprint(db);
    const rejected = await denial(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-SC88', effectiveFrom: '2026-06-01', effectiveTo: '2027-06-01' }), ADMIN, 'w9-sc88-overlap');
    assert.equal(rejected.denied, true);
    assert.equal(rejected.status, 409);
    assert.deepEqual(footprint(db), before, 'a rejected overlap commits nothing on MySQL');
    assert.equal(db.isTransaction, false, 'the failed write left no open transaction');
  });

  test('SC89 initial rating provenance is recorded and rating evidence is append-only on MySQL', async () => {
    const created = await invoke(createCreditProfile, db, profileBody({
      customerId: 'w9-c-main', creditObjectId: 'W9-SC89', salespersonId: 'w9-salesperson-self',
      initialState: 'WATCH', status: 'ACTIVE', ratingGrade: 'B', effectiveFrom: '2026-01-01',
    }), ADMIN, 'w9-sc89-v1');
    await invoke(createCreditProfile, db, profileBody({
      customerId: 'w9-c-main', creditObjectId: 'W9-SC89', salespersonId: 'w9-salesperson-self',
      initialState: 'WATCH', status: 'ACTIVE', ratingGrade: 'C', effectiveFrom: '2026-07-01',
    }), ADMIN, 'w9-sc89-v2');

    assert.equal(created.body.profile.initialState, 'WATCH');
    assert.equal(created.body.profile.ratingGrade, 'B');
    assert.equal(created.body.profile.ratingEffectiveFrom, '2026-01-01');

    const ratings = db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=?').all(created.body.profile.id);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].rating_source_type, 'INITIAL_ASSIGNED');
    assert.equal(ratings[0].rating_source_key, 'INITIAL_ASSIGNED');
    assert.equal(ratings[0].rating_grade, 'B');
    assert.equal(ratings[0].evaluation_result_id, null, 'Wave 9 fabricates no evaluation result identity');
    assert.equal(ratings[0].superseded_at, null);

    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM credit_profile_ratings WHERE rating_source_type<>'INITIAL_ASSIGNED'").get().n), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM credit_profile_ratings WHERE evaluation_result_id IS NOT NULL').get().n), 0);
    assert.equal(
      Number(db.prepare('SELECT COUNT(*) n FROM credit_profile_ratings').get().n),
      Number(db.prepare('SELECT COUNT(*) n FROM credit_profile').get().n),
      'every version carries exactly one append-only rating row',
    );

    const v2 = db.prepare("SELECT * FROM credit_profile WHERE customer_id='w9-c-main' AND credit_object_id='W9-SC89' AND salesperson_scope_key='w9-salesperson-self' AND effective_from='2026-07-01'").get();
    assert.equal(v2.rating_grade, 'C', 'a new effective version does not rewrite the predecessor rating');

    const detail = await readById(getCreditProfile, db, ADMIN, created.body.profile.id);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.profile.ratings.length, 1, 'nested rating history follows the profile predicate');
    const restricted = await readById(getCreditProfile, db, REVIEWER, created.body.profile.id);
    assert.equal(restricted.statusCode, 404, 'a restricted sub-limit exposes no rating body either');
  });

  test('AP5 global configuration READ requires ADMIN or CREDIT_VIEW', async () => {
    const createdParameter = await invoke(createCreditParameter, db, {
      code: 'W9_READ_GATE', valueInt: 1, effectiveFrom: '2026-01-01', status: 'ACTIVE',
    }, ADMIN, 'w9-read-seed-p');
    assert.equal(createdParameter.statusCode, 201, 'the INTEGER parameter fixture is created');
    assert.deepEqual(
      {
        valueText: createdParameter.body.parameter.valueText,
        valueInt: createdParameter.body.parameter.valueInt,
        valueBool: createdParameter.body.parameter.valueBool,
        valueDate: createdParameter.body.parameter.valueDate,
      },
      { valueText: null, valueInt: 1, valueBool: null, valueDate: null },
      'the fixture persists exactly one typed parameter value',
    );
    const setupRead = await read(listCreditParameters, db, ADMIN, { code: 'W9_READ_GATE' });
    assert.equal(setupRead.statusCode, 200, 'ADMIN can read the INTEGER parameter fixture');
    assert.equal(setupRead.body.parameters.find((row) => row.code === 'W9_READ_GATE')?.valueInt, 1);
    await invoke(createCreditRule, db, ruleBody({ ruleCode: 'W9_READ_RULE' }), ADMIN, 'w9-read-seed-r');

    for (const actor of [ADMIN, FULL_THREE, VIEWER, VIEWER_WITH_MANAGE, REVIEWER, CROSS_READER]) {
      assert.equal((await read(listCreditParameters, db, actor, {})).statusCode, 200, `${actor.id} reads parameters`);
      assert.equal((await read(listCreditRules, db, actor, {})).statusCode, 200, `${actor.id} reads rules`);
    }
    for (const actor of [MANAGE_ONLY, CENTRAL_WRITER_NO_READ, CROSS_ONLY, NO_CREDIT]) {
      for (const handler of [listCreditParameters, listCreditRules]) {
        const result = await read(handler, db, actor, {});
        assert.equal(result.statusCode, 403, `${actor.id} must not read ${handler.name}`);
        assert.equal(result.code, 'CREDIT_PERMISSION_DENIED');
      }
    }
  });

  test('AP5 global configuration WRITE requires central management authority and grants no implicit read', async () => {
    await invoke(createCreditParameter, db, parameterBody({ code: 'W9_WRITE_GATE', valueBool: true }), ADMIN, 'w9-write-baseline-p');
    await invoke(createCreditRule, db, ruleBody({ ruleCode: 'W9_WRITE_RULE' }), ADMIN, 'w9-write-baseline-r');
    const before = footprint(db);

    for (const actor of [VIEWER, VIEWER_WITH_MANAGE, REVIEWER, CROSS_READER, MANAGE_ONLY, CROSS_ONLY, NO_CREDIT]) {
      const tag = `${actor.id}:${[...actor.permissions].sort().join('+')}`;
      const parameter = await denial(createCreditParameter, db, parameterBody({ code: 'W9_WRITE_GATE', valueBool: false, effectiveFrom: '2027-01-01' }), actor, `w9-deny-p-${tag}`);
      assert.equal(parameter.denied, true, `${actor.id} must not write parameters`);
      assert.equal(parameter.status, 403);
      assert.equal(parameter.code, 'CREDIT_MANAGEMENT_DENIED');
      const rule = await denial(createCreditRule, db, ruleBody({ ruleCode: 'W9_WRITE_RULE', controlStrength: 'WARNING', effectiveFrom: '2027-01-01' }), actor, `w9-deny-r-${tag}`);
      assert.equal(rule.denied, true, `${actor.id} must not write rules`);
      assert.equal(rule.status, 403);
      assert.equal(rule.code, 'CREDIT_MANAGEMENT_DENIED');
    }
    assert.equal(db.isTransaction, false, 'no denial opened a MySQL transaction');
    assert.deepEqual(footprint(db), before, 'denied configuration writes are a complete no-op on MySQL');

    // WRITE and READ are independent: management plus cross-group writes without CREDIT_VIEW.
    const writerOnly = await invoke(createCreditParameter, db, parameterBody({ code: 'W9_WRITE_GATE', valueBool: false, effectiveFrom: '2028-01-01' }), CENTRAL_WRITER_NO_READ, 'w9-writer-p');
    assert.equal(writerOnly.statusCode, 201, 'CREDIT_MANAGE + SALES_CROSS_GROUP writes without CREDIT_VIEW');
    const writerOnlyRead = await read(listCreditParameters, db, CENTRAL_WRITER_NO_READ, {});
    assert.equal(writerOnlyRead.statusCode, 403, 'that writer still cannot read');

    const allThree = await invoke(createCreditRule, db, ruleBody({ ruleCode: 'W9_WRITE_RULE', effectiveFrom: '2028-01-01' }), FULL_THREE, 'w9-full-r');
    assert.equal(allThree.statusCode, 201);
    assert.equal((await read(listCreditRules, db, FULL_THREE, {})).statusCode, 200);

    const adminWrite = await invoke(createCreditParameter, db, parameterBody({ code: 'W9_WRITE_GATE', valueBool: true, effectiveFrom: '2029-01-01' }), ADMIN, 'w9-admin-p');
    assert.equal(adminWrite.statusCode, 201);
    assert.equal(db.prepare("SELECT effective_to FROM credit_parameters WHERE code='W9_WRITE_GATE' AND effective_from='2026-01-01'").get().effective_to, '2027-12-31',
      'authorized version creation still closes its predecessor');
  });

  test('AP5 ordinary Sales cannot disable Credit Management or weaken BLOCK to WARNING', async () => {
    assert.ok(VIEWER_WITH_MANAGE.permissions.includes('CREDIT_MANAGE'), 'ordinary Sales really holds CREDIT_MANAGE');
    assert.equal(VIEWER_WITH_MANAGE.permissions.includes('SALES_CROSS_GROUP'), false, 'ordinary Sales really lacks SALES_CROSS_GROUP');

    await invoke(createCreditParameter, db, parameterBody({ code: 'W9_ENABLED', valueBool: true }), ADMIN, 'w9-enabled-baseline');
    await invoke(createCreditRule, db, ruleBody({ ruleCode: 'W9_STRENGTH', controlStrength: 'BLOCK' }), ADMIN, 'w9-strength-baseline');
    const before = footprint(db);

    assert.equal((await denial(createCreditParameter, db, parameterBody({ code: 'W9_ENABLED', valueBool: false, effectiveFrom: '2027-01-01' }), VIEWER_WITH_MANAGE, 'w9-attack-disable')).status, 403);
    assert.equal((await denial(createCreditRule, db, ruleBody({ ruleCode: 'W9_STRENGTH', controlStrength: 'WARNING', effectiveFrom: '2027-01-01' }), VIEWER_WITH_MANAGE, 'w9-attack-weaken')).status, 403);

    assert.deepEqual(footprint(db), before, 'the two named attacks changed nothing');
    assert.equal(Number(db.prepare("SELECT value_bool FROM credit_parameters WHERE code='W9_ENABLED' AND effective_from='2026-01-01'").get().value_bool), 1,
      'CREDIT_MANAGEMENT_ENABLED stays enabled');
    assert.equal(db.prepare("SELECT control_strength FROM credit_check_rules WHERE rule_code='W9_STRENGTH' AND effective_from='2026-01-01'").get().control_strength, 'BLOCK',
      'the BLOCK rule is not downgraded');
    assert.equal(db.prepare("SELECT effective_to FROM credit_parameters WHERE code='W9_ENABLED' ORDER BY effective_from LIMIT 1").get().effective_to, null,
      'the denied POST did not close the predecessor version');
  });

  test('SC83-SC86 control scope, timing and both rule strengths round-trip on MySQL', async () => {
    for (const strength of ['BLOCK', 'WARNING']) {
      await invoke(createCreditRule, db, ruleBody({ ruleCode: `W9_ROUNDTRIP_${strength}`, controlStrength: strength, resultPayload: { outcome: strength } }), ADMIN, `w9-rt-${strength}`);
      const resolved = resolveCreditRule(db, `W9_ROUNDTRIP_${strength}`, '2026-06-01');
      assert.equal(resolved.control_strength, strength);
      assert.deepEqual(JSON.parse(resolved.result_payload_json), { outcome: strength }, 'payload survives as structured data, not as a text shape');
    }
    await invoke(createCreditRule, db, ruleBody({ ruleCode: 'W9_AFTER_WRITE', checkTiming: 'AFTER_WRITE_DEFERRED', businessStage: 'SALES_DELIVERY_CONFIRM', scenario: 'OVERRIDE_REQUEST', creditItem: 'AR_BALANCE' }), ADMIN, 'w9-timing');
    const timing = resolveCreditRule(db, 'W9_AFTER_WRITE', '2026-06-01');
    assert.equal(timing.check_timing, 'AFTER_WRITE_DEFERRED');
    assert.equal(timing.business_stage, 'SALES_DELIVERY_CONFIRM');
    assert.equal(timing.scenario, 'OVERRIDE_REQUEST');
    assert.equal(timing.credit_item, 'AR_BALANCE');

    await invoke(createCreditParameter, db, { code: 'W9_SCOPE', valueText: 'CUSTOMER_AGGREGATE', effectiveFrom: '2026-01-01', status: 'ACTIVE' }, ADMIN, 'w9-scope-v1');
    await invoke(createCreditParameter, db, { code: 'W9_SCOPE', valueText: 'CUSTOMER_AGGREGATE,SALESPERSON_SUB_LIMIT', effectiveFrom: '2026-07-01', status: 'ACTIVE' }, ADMIN, 'w9-scope-v2');
    assert.equal(db.prepare("SELECT effective_to FROM credit_parameters WHERE code='W9_SCOPE' AND effective_from='2026-01-01'").get().effective_to, '2026-06-30');
    assert.equal(resolveCreditParameter(db, 'W9_SCOPE', '2026-03-01').value_text, 'CUSTOMER_AGGREGATE');
    assert.equal(resolveCreditParameter(db, 'W9_SCOPE', '2026-08-01').value_text, 'CUSTOMER_AGGREGATE,SALESPERSON_SUB_LIMIT');
    assert.equal(resolveCreditParameter(db, 'W9_SCOPE', '2025-12-31'), null, 'nothing is effective before the first effective_from');
    assert.equal((await denial(createCreditRule, db, ruleBody({ ruleCode: 'W9_BAD_STRENGTH', controlStrength: 'MAYBE' }), ADMIN, 'w9-bad-strength')).status, 400);
  });

  test('N10/N12 denied Profile and Anchor writes leave zero MySQL side effects', async () => {
    const before = footprint(db);
    for (const [handler, body, actor, key] of [
      [createCreditProfile, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-DENIED' }), VIEWER, 'w9-deny-profile-view'],
      [createCreditProfile, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-DENIED' }), VIEWER_WITH_MANAGE, 'w9-deny-profile-manage'],
      [createCreditProfile, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-DENIED' }), CROSS_ONLY, 'w9-deny-profile-cross'],
      [createCreditProfile, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-DENIED' }), MANAGE_ONLY, 'w9-deny-profile-manage-only'],
      [provisionCreditAnchor, { anchorType: 'CREDIT_OBJECT', customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-DENIED' }, VIEWER_WITH_MANAGE, 'w9-deny-anchor'],
      [provisionCreditAnchor, { anchorType: 'POLICY_SCOPE', policyScopeType: 'GLOBAL', policyScopeId: 'DENIED' }, CROSS_ONLY, 'w9-deny-policy-anchor'],
    ]) {
      const result = await denial(handler, db, body, actor, key);
      assert.equal(result.denied, true, `${actor.id} must not write ${handler.name}`);
      assert.equal(result.status, 403);
      assert.equal(result.code, 'CREDIT_MANAGEMENT_DENIED');
    }
    assert.equal(db.isTransaction, false, 'no denied write left an open MySQL transaction');
    assert.deepEqual(footprint(db), before, 'denied Profile and Anchor writes are a complete no-op');
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM credit_lock_anchors WHERE credit_object_id='W9-DENIED'").get().n), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM credit_lock_anchors WHERE policy_scope_id='DENIED'").get().n), 0);
  });

  test('AP4.1 an authorized central manager still writes profiles and provisions anchors', async () => {
    const written = await invoke(createCreditProfile, db, profileBody({ customerId: 'w9-c-main', creditObjectId: 'W9-AUTHORIZED', salespersonId: 'w9-salesperson-other' }), CENTRAL_WRITER_NO_READ, 'w9-allowed-profile');
    assert.equal(written.statusCode, 201, 'CREDIT_MANAGE + SALES_CROSS_GROUP writes a profile');

    const shape = { anchorType: 'CREDIT_OBJECT', customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-PROVISIONED' };
    const provisioned = await invoke(provisionCreditAnchor, db, shape, CENTRAL_WRITER_NO_READ, 'w9-allowed-anchor');
    assert.equal(provisioned.statusCode, 200);
    assert.equal(provisioned.body.anchor.anchorKey, creditObjectAnchorKey({ customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-PROVISIONED' }));

    const replay = await invoke(provisionCreditAnchor, db, shape, CENTRAL_WRITER_NO_READ, 'w9-allowed-anchor');
    assert.equal(replay.body.anchor.id, provisioned.body.anchor.id, 'an exact replay returns the same anchor identity');
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM credit_lock_anchors WHERE credit_object_id='W9-PROVISIONED'").get().n), 1);

    assert.equal((await read(listCreditAnchors, db, ADMIN, {})).statusCode, 200);
    assert.equal((await read(listCreditAnchors, db, CROSS_READER, {})).statusCode, 200);
    for (const actor of [VIEWER, VIEWER_WITH_MANAGE, REVIEWER, CROSS_ONLY, MANAGE_ONLY, NO_CREDIT]) {
      const denied = await read(listCreditAnchors, db, actor, {});
      assert.equal(denied.statusCode, 403, `anchor inventory escalates away from ${actor.id}`);
      assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
    }
  });

  test('anchor identity stays canonical and group-free on MySQL', () => {
    assert.equal(
      creditObjectAnchorKey({ customerId: 'w9-c-main', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-OBJ' }),
      'CREDIT_OBJECT|SALES_ORDER|W9-OBJ|CUSTOMER|w9-c-main|SCOPE:AGGREGATE',
    );
    assert.equal(
      creditObjectAnchorKey({ customerId: 'w9-c-main', salespersonId: 'w9-salesperson-self', creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-OBJ' }),
      'CREDIT_OBJECT|SALES_ORDER|W9-OBJ|CUSTOMER|w9-c-main|SCOPE:SALESPERSON|w9-salesperson-self',
    );
    assert.equal(policyScopeAnchorKey('GLOBAL', 'GLOBAL'), 'POLICY_SCOPE|GLOBAL|GLOBAL');
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM credit_lock_anchors WHERE anchor_key='POLICY_SCOPE|GLOBAL|GLOBAL'").get().n), 1,
      'the canonical global policy scope anchor exists exactly once');

    const groupCarriers = db.prepare("SELECT anchor_key FROM credit_lock_anchors WHERE anchor_key LIKE ?").all('%w9-group%');
    assert.deepEqual(groupCarriers, [], 'no anchor key embeds a Sales Group identity');
  });

  test('T-G16 a human read denial never makes a mandatory configuration inapplicable on MySQL', async () => {
    assert.equal(resolveCreditParameter(db, 'W9_ENABLED', '2026-06-01').code, 'W9_ENABLED');
    assert.equal(resolveCreditRule(db, 'W9_STRENGTH', '2026-06-01').control_strength, 'BLOCK');
    assert.equal((await read(listCreditRules, db, NO_CREDIT, {})).statusCode, 403, 'the human surface is denied');
    assert.equal(resolveCreditRule(db, 'W9_STRENGTH', '2026-06-01').control_strength, 'BLOCK',
      'engine resolution stays authoritative regardless of any human read scope');
  });

  test('T-P14 the engine resolver reaches a scope the human read surface hides on MySQL', async () => {
    const ids = await seedThreeScopeProfiles(db, 'engine');
    const hidden = resolveEffectiveCreditProfile(db, {
      customerId: 'w9-c-other-engine', salespersonId: 'w9-salesperson-other',
      creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-OBJ-engine', businessDate: '2026-06-01',
    });
    assert.equal(hidden.id, ids.other.id, 'the engine resolves a sub-limit a human read hides');
    assert.equal(hidden.salesperson_scope_key, 'w9-salesperson-other');
    assert.equal((await readById(getCreditProfile, db, VIEWER, ids.other.id)).statusCode, 404);
  });
});
