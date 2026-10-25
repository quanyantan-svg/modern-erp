import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { test } from 'node:test';
import { createDatabase } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import { createCreditParameter, createCreditRule, ensureCreditPolicySnapshot, listCreditParameters, listCreditRules, resolveCreditParameter, resolveCreditRule } from './modules/credit-policy.js';
import { createCreditProfile, getCreditProfile, listCreditProfiles, resolveEffectiveCreditProfile } from './modules/credit-profile.js';
import { listCreditAnchors, provisionCreditAnchor } from './modules/credit-anchor.js';
import { CREDIT_READ_MODE, resolveCreditProfileReadScope } from './modules/credit-scope.js';
import { applicationRouteFor } from '../src/navigation/applicationRegistry.js';

// Each actor carries exactly the authority its scenario needs. Central write
// authority is ADMIN or CREDIT_MANAGE + SALES_CROSS_GROUP (document.md §14
// AP4.1 / §15 AP5); CREDIT_MANAGE alone grants neither read nor write, and
// SALES_CROSS_GROUP grants no Credit capability at all (AP4).
const ADMIN = Object.freeze({ id: 'user-admin', roleCode: 'ADMIN', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const MANAGER = ADMIN;
const FULL_THREE = Object.freeze({ id: 'user-full', roleCode: 'CREDIT_ADMIN', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const VIEWER = Object.freeze({ id: 'user-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
const VIEWER_WITH_MANAGE = Object.freeze({ id: 'user-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE'] });
const REVIEWER = Object.freeze({ id: 'user-reviewer', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW'] });
const CROSS_READER = Object.freeze({ id: 'user-reviewer', roleCode: 'REVIEWER', permissions: ['CREDIT_VIEW', 'SALES_CROSS_GROUP'] });
const CENTRAL_WRITER_NO_READ = Object.freeze({ id: 'user-writer', roleCode: 'SALES', permissions: ['CREDIT_MANAGE', 'SALES_CROSS_GROUP'] });
const CROSS_ONLY = Object.freeze({ id: 'user-cross', roleCode: 'REVIEWER', permissions: ['SALES_CROSS_GROUP'] });
const MANAGE_ONLY = Object.freeze({ id: 'user-mgr', roleCode: 'SALES', permissions: ['CREDIT_MANAGE'] });
const NO_CREDIT = Object.freeze({ id: 'user-warehouse', roleCode: 'WAREHOUSE', permissions: [] });
const UNMAPPED_SALES = Object.freeze({ id: 'user-warehouse', roleCode: 'WAREHOUSE', permissions: ['CREDIT_VIEW'] });
const OTHER_SALES = Object.freeze({ id: 'user-other-sales', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });

// The Wave 10 tables are no longer out of scope: they are created by the
// Wave 10 migration, which the canonical registry now runs after Wave 9. The
// Wave 11 tables remain out of scope for every wave up to and including 10.
const OUT_OF_SCOPE_TABLES = Object.freeze([
  'credit_evaluation_indicator',
  'credit_evaluation_scheme', 'credit_evaluation_model', 'credit_evaluation_scoring_sheet',
  'credit_evaluation_result', 'credit_recalculation_history',
]);

const CREDIT_AUDIT = "entity_type IN ('CREDIT_PROFILE','CREDIT_PROFILE_RATING','CREDIT_PARAMETER','CREDIT_CHECK_RULE','CREDIT_LOCK_ANCHOR')";

function request(body, key = 'wave9-test-key') {
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

async function invoke(handler, db, body, actor = MANAGER, key) {
  const res = response();
  await handler(db, request(body, key), res, actor);
  return res;
}

// Reads never throw out of the handler contract, so the status is captured
// instead. A denied read and an absent object must be indistinguishable.
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

function seedSalesperson(db, { id = 'salesperson-wave9', userId = 'user-sales', active = 1 } = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(id, id.toUpperCase(), id, userId, active, now, now);
}

function seedSalesGroup(db, { id = 'group-wave9', active = 1 } = {}) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, id.toUpperCase(), id, null, active, now, now);
}

function seedMembership(db, { salespersonId, salesGroupId = 'group-wave9', active = 1, effectiveFrom = '2020-01-01', effectiveTo = null }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
    VALUES(?,?,?,1,?,?,?,?,?)`).run(`membership-${salespersonId}`, salespersonId, salesGroupId, active, effectiveFrom, effectiveTo, now, now);
}

function seedUser(db, id, roleId = 'role-sales') {
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,'x','x',?,1,?)`).run(id, id, id, roleId, new Date().toISOString());
}

function seedCustomer(db, id = 'customer-001') {
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO customers(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)")
    .run(id, id.toUpperCase(), id, now, now);
}

function profileBody(overrides = {}) {
  return {
    customerId: 'customer-001', creditObjectType: 'SALES_ORDER', creditObjectId: 'CREDIT-CUSTOMER-001',
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

function counts(db, tables) {
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
}

function auditCount(db) {
  return db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE ${CREDIT_AUDIT}`).get().count;
}

function sideEffects(db) {
  return {
    ...counts(db, ['credit_profile', 'credit_profile_ratings', 'credit_policy_snapshots', 'credit_lock_anchors', 'credit_parameters', 'credit_check_rules']),
    audit: auditCount(db),
    idempotency: db.prepare('SELECT COUNT(*) count FROM idempotency_records').get().count,
  };
}

function workerResult(dbPath, shape) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./test-utils/wave9-anchor-worker.js', import.meta.url), { workerData: { dbPath, shape } });
    let message;
    worker.once('message', (value) => { message = value; });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`anchor worker exited ${code}`));
      else if (!message) reject(new Error('anchor worker exited without a result'));
      else if (message.error) reject(new Error(message.error));
      else resolve(message);
    });
  });
}

// Full identity fixture: two salespersons in one active group.
function seedIdentity(db) {
  seedCustomer(db, 'customer-001');
  seedCustomer(db, 'customer-002');
  seedSalesGroup(db);
  seedUser(db, 'user-other-sales');
  seedUser(db, 'user-writer');
  seedUser(db, 'user-full');
  seedSalesperson(db, { id: 'salesperson-wave9', userId: 'user-sales' });
  seedSalesperson(db, { id: 'salesperson-other', userId: 'user-other-sales' });
  seedMembership(db, { salespersonId: 'salesperson-wave9' });
  seedMembership(db, { salespersonId: 'salesperson-other' });
}

test('Wave 9 creates exactly the six approved tables and replays idempotently', () => {
  const handle = createTempDb({ label: 'sales-wave9-schema' });
  try {
    const present = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SALES_WAVE9_TABLES.map(() => '?').join(',')}) ORDER BY name`).all(...SALES_WAVE9_TABLES);
    assert.deepEqual(present.map((row) => row.name), [...SALES_WAVE9_TABLES].sort());
    const absent = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${OUT_OF_SCOPE_TABLES.map(() => '?').join(',')})`).all(...OUT_OF_SCOPE_TABLES);
    assert.deepEqual(absent, []);
    assert.doesNotThrow(() => createDatabase(handle.dbPath).close());
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM credit_lock_anchors WHERE anchor_key='POLICY_SCOPE|GLOBAL|GLOBAL'").get().count, 1);
  } finally { handle.cleanup(); }
});

test('concurrent first-use provisioning converges on one stable credit-object anchor', async () => {
  const handle = createTempDb({ label: 'sales-wave9-anchor' });
  const shape = { anchorType: 'CREDIT_OBJECT', customerId: 'customer-001', creditObjectType: 'SALES_ORDER', creditObjectId: 'SO-W9-CONCURRENT' };
  try {
    handle.close();
    const [left, right] = await Promise.all([workerResult(handle.dbPath, shape), workerResult(handle.dbPath, shape)]);
    assert.equal(left.id, right.id);
    const verify = createDatabase(handle.dbPath);
    try {
      assert.equal(verify.prepare('SELECT COUNT(*) count FROM credit_lock_anchors WHERE anchor_key=?').get(left.anchorKey).count, 1);
    } finally { verify.close(); }
  } finally { handle.cleanup(); }
});

test('aggregate and salesperson profiles use distinct normalized scopes with immutable initial rating provenance', async () => {
  const handle = createTempDb({ label: 'sales-wave9-profile' });
  try {
    seedIdentity(handle.db);
    const aggregate = await invoke(createCreditProfile, handle.db, profileBody(), MANAGER, 'profile-aggregate');
    const replay = await invoke(createCreditProfile, handle.db, profileBody(), MANAGER, 'profile-aggregate');
    const sublimit = await invoke(createCreditProfile, handle.db, profileBody({
      salespersonId: 'salesperson-wave9', creditObjectId: 'CREDIT-CUSTOMER-001', creditLimitCents: 125000,
    }), MANAGER, 'profile-salesperson');
    assert.equal(aggregate.statusCode, 201);
    assert.equal(replay.body.profile.id, aggregate.body.profile.id);
    assert.equal(sublimit.body.profile.scopeType, 'SALESPERSON_SUB_LIMIT');
    assert.equal(aggregate.body.profile.salespersonScopeKey, '*');
    assert.notEqual(aggregate.body.profile.anchorId, sublimit.body.profile.anchorId);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_profile').get().count, 2);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_profile_ratings').get().count, 2);
    const rating = handle.db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=?').get(aggregate.body.profile.id);
    assert.equal(rating.rating_source_type, 'INITIAL_ASSIGNED');
    assert.equal(rating.rating_source_key, 'INITIAL_ASSIGNED');
    assert.equal(rating.evaluation_result_id, null);
    assert.equal(resolveEffectiveCreditProfile(handle.db, { customerId: 'customer-001', creditObjectType: 'SALES_ORDER', creditObjectId: 'CREDIT-CUSTOMER-001', businessDate: '2026-06-01' }).id, aggregate.body.profile.id);
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type IN ('CREDIT_PROFILE','CREDIT_PROFILE_RATING')").get().count, 4);
  } finally { handle.cleanup(); }
});

test('effective-dated parameter and rule writers close predecessors, reject overlaps, and roll back on conflict', async () => {
  const handle = createTempDb({ label: 'sales-wave9-policy' });
  try {
    await invoke(createCreditParameter, handle.db, { code: 'OVERDUE_DAYS', valueInt: 30, effectiveFrom: '2026-01-01', status: 'ACTIVE' }, MANAGER, 'parameter-v1');
    await invoke(createCreditParameter, handle.db, { code: 'OVERDUE_DAYS', valueInt: 45, effectiveFrom: '2026-07-01', status: 'ACTIVE' }, MANAGER, 'parameter-v2');
    assert.equal(handle.db.prepare("SELECT effective_to FROM credit_parameters WHERE code='OVERDUE_DAYS' AND effective_from='2026-01-01'").get().effective_to, '2026-06-30');
    assert.equal(resolveCreditParameter(handle.db, 'OVERDUE_DAYS', '2026-08-01').value_int, 45);
    await invoke(createCreditRule, handle.db, ruleBody({ effectiveTo: '2026-12-31' }), MANAGER, 'rule-v1');
    await invoke(createCreditRule, handle.db, ruleBody({ effectiveFrom: '2027-01-01' }), MANAGER, 'rule-v2');
    await assert.rejects(() => invoke(createCreditRule, handle.db, ruleBody({ effectiveFrom: '2026-06-01', effectiveTo: '2027-06-01' }), MANAGER, 'rule-overlap'), (error) => error.status === 409);
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM credit_check_rules WHERE rule_code='SO_LIMIT'").get().count, 2);
    assert.equal(handle.db.prepare("SELECT effective_to FROM credit_check_rules WHERE rule_code='SO_LIMIT'").get().effective_to, '2026-12-31');
  } finally { handle.cleanup(); }
});

test('policy snapshots reuse identical evidence without updates and permissions fail closed', async () => {
  const handle = createTempDb({ label: 'sales-wave9-snapshot' });
  try {
    const profile = await invoke(createCreditProfile, handle.db, profileBody({ creditObjectId: 'SNAPSHOT-OBJECT' }), MANAGER, 'snapshot-profile');
    const input = {
      creditLockAnchorId: profile.body.profile.anchorId, scopeType: 'CUSTOMER_AGGREGATE',
      creditProfileId: profile.body.profile.id, businessDate: '2026-10-22',
      parameterSetHash: 'a'.repeat(64), ruleSetHash: 'b'.repeat(64), profileEffectiveStateHash: 'c'.repeat(64),
      capturedBy: MANAGER.id, notes: { source: 'wave9-test' },
    };
    const first = ensureCreditPolicySnapshot(handle.db, input);
    const second = ensureCreditPolicySnapshot(handle.db, { ...input, notes: { source: 'ignored-on-reuse' } });
    assert.equal(second.id, first.id);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count, 1);
    assert.deepEqual(JSON.parse(handle.db.prepare('SELECT notes_json FROM credit_policy_snapshots WHERE id=?').get(first.id).notes_json), { source: 'wave9-test' });
    await assert.rejects(() => invoke(createCreditProfile, handle.db, profileBody({ creditObjectId: 'DENIED' }), VIEWER, 'denied-profile'), (error) => error.status === 403);
    await assert.rejects(() => invoke(provisionCreditAnchor, handle.db, { anchorType: 'POLICY_SCOPE', policyScopeType: 'GLOBAL', policyScopeId: 'DENIED' }, VIEWER, 'denied-anchor'), (error) => error.status === 403);
    assert.equal(handle.db.prepare("SELECT COUNT(*) count FROM credit_lock_anchors WHERE policy_scope_id='DENIED'").get().count, 0);
    const source = await readFile(new URL('./modules/credit-policy.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /UPDATE\s+credit_policy_snapshots/i);
    assert.doesNotMatch(source, /credit_policy_snapshots[^;]*FOR\s+UPDATE/i);
  } finally { handle.cleanup(); }
});

test('Wave 9 exposes one contextual route and only foundation APIs', async () => {
  const route = applicationRouteFor('credit-foundation');
  assert.equal(route.enabled, true);
  assert.equal(route.level, 'contextual');
  assert.equal(route.parentRoute, 'customers');
  assert.deepEqual(route.access.any, ['CREDIT_VIEW', 'CREDIT_MANAGE']);
  assert.deepEqual(route.launcherEntries, []);
  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  for (const path of [
    '/api/credit/policy/parameters', '/api/credit/policy/rules', '/api/credit/anchors',
    '/api/credit/anchors/provision', '/api/credit/profiles',
  ]) assert.match(appSource, new RegExp(path.replaceAll('/', '\\/')));
  // The Wave 10 Credit Check and Credit Special Approval surfaces now exist.
  // The Wave 11 evaluation surface does not.
  assert.doesNotMatch(appSource, /\/api\/credit\/evaluations/);
});

// --- Profile authorization: five read modes (document.md §14 AP1-AP4.1) ---

async function seedTwoProfiles(db) {
  seedIdentity(db);
  const aggregate = await invoke(createCreditProfile, db, profileBody({ customerId: 'customer-001' }), ADMIN, 'auth-aggregate');
  const own = await invoke(createCreditProfile, db, profileBody({ customerId: 'customer-001', salespersonId: 'salesperson-wave9', creditLimitCents: 125000 }), ADMIN, 'auth-own');
  const other = await invoke(createCreditProfile, db, profileBody({ customerId: 'customer-002', salespersonId: 'salesperson-other' }), ADMIN, 'auth-other');
  return {
    aggregate: aggregate.body.profile,
    own: own.body.profile,
    other: other.body.profile,
  };
}

test('AP1-AP4.1 Profile read modes: ADMIN, cross-group, self-scope, aggregate-only, denial', async () => {
  const handle = createTempDb({ label: 'wave9-profile-modes' });
  try {
    const ids = await seedTwoProfiles(handle.db);
    const all = { aggregate: ids.aggregate.id, own: ids.own.id, other: ids.other.id };

    const admin = await read(listCreditProfiles, handle.db, ADMIN, {});
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.body.profiles.length, 3, 'ADMIN sees every scope');

    const cross = await read(listCreditProfiles, handle.db, CROSS_READER, {});
    assert.equal(cross.statusCode, 200);
    assert.equal(cross.body.profiles.length, 3, 'CREDIT_VIEW + SALES_CROSS_GROUP sees every scope');

    const selfScoped = await read(listCreditProfiles, handle.db, VIEWER, {});
    assert.equal(selfScoped.statusCode, 200);
    assert.deepEqual(selfScoped.body.profiles.map((row) => row.id).sort(), [ids.aggregate.id, ids.own.id].sort());
    assert.equal(selfScoped.body.profiles.some((row) => row.id === ids.other.id), false, 'same-group other salesperson hidden');

    const unmapped = await read(listCreditProfiles, handle.db, REVIEWER, {});
    assert.equal(unmapped.statusCode, 200, 'unmapped CREDIT_VIEW actor keeps aggregate access');
    assert.deepEqual(unmapped.body.profiles.map((row) => row.id), [ids.aggregate.id]);

    const crossOnly = await read(listCreditProfiles, handle.db, CROSS_ONLY, {});
    assert.equal(crossOnly.statusCode, 403);
    assert.equal(crossOnly.code, 'CREDIT_SCOPE_DENIED');

    const manageOnly = await read(listCreditProfiles, handle.db, MANAGE_ONLY, {});
    assert.equal(manageOnly.statusCode, 403, 'CREDIT_MANAGE alone does not imply CREDIT_VIEW');

    const noCredit = await read(listCreditProfiles, handle.db, NO_CREDIT, {});
    assert.equal(noCredit.statusCode, 403);

    assert.deepEqual(all, { aggregate: ids.aggregate.id, own: ids.own.id, other: ids.other.id });
  } finally { handle.cleanup(); }
});

test('AP3 self-scope eligibility: inactive, expired and unmapped actors keep aggregate read', async () => {
  const handle = createTempDb({ label: 'wave9-selfscope' });
  try {
    const ids = await seedTwoProfiles(handle.db);

    handle.db.prepare("UPDATE salesperson_profiles SET active=0 WHERE id='salesperson-wave9'").run();
    const inactive = await read(listCreditProfiles, handle.db, VIEWER, {});
    assert.equal(inactive.statusCode, 200);
    assert.deepEqual(inactive.body.profiles.map((row) => row.id), [ids.aggregate.id]);
    handle.db.prepare("UPDATE salesperson_profiles SET active=1 WHERE id='salesperson-wave9'").run();

    handle.db.prepare("UPDATE salesperson_group_memberships SET effective_to='2021-01-01' WHERE salesperson_id='salesperson-wave9'").run();
    const expired = await read(listCreditProfiles, handle.db, VIEWER, {});
    assert.equal(expired.statusCode, 200);
    assert.deepEqual(expired.body.profiles.map((row) => row.id), [ids.aggregate.id]);
    handle.db.prepare("UPDATE salesperson_group_memberships SET effective_to=NULL WHERE salesperson_id='salesperson-wave9'").run();

    handle.db.prepare("UPDATE salesperson_group_memberships SET active=0 WHERE salesperson_id='salesperson-wave9'").run();
    const inactiveMembership = await read(listCreditProfiles, handle.db, VIEWER, {});
    assert.equal(inactiveMembership.statusCode, 200);
    assert.deepEqual(inactiveMembership.body.profiles.map((row) => row.id), [ids.aggregate.id]);
    handle.db.prepare("UPDATE salesperson_group_memberships SET active=1 WHERE salesperson_id='salesperson-wave9'").run();

    const restored = await read(listCreditProfiles, handle.db, VIEWER, {});
    assert.equal(restored.body.profiles.length, 2, 'valid own membership restores self-scope');

    const unmapped = await read(listCreditProfiles, handle.db, UNMAPPED_SALES, {});
    assert.equal(unmapped.statusCode, 200, 'a CREDIT_VIEW holder with no salesperson mapping still reads aggregate');
    assert.deepEqual(unmapped.body.profiles.map((row) => row.id), [ids.aggregate.id]);
  } finally { handle.cleanup(); }
});

test('AP3 direct-ID is non-enumerating and collection/detail agree in every mode', async () => {
  const handle = createTempDb({ label: 'wave9-direct-id' });
  try {
    const ids = await seedTwoProfiles(handle.db);

    const ownDetail = await readById(getCreditProfile, handle.db, VIEWER, ids.own.id);
    assert.equal(ownDetail.statusCode, 200);
    assert.equal(ownDetail.body.profile.salespersonId, 'salesperson-wave9');

    const aggregateDetail = await readById(getCreditProfile, handle.db, VIEWER, ids.aggregate.id);
    assert.equal(aggregateDetail.statusCode, 200);

    const restricted = await readById(getCreditProfile, handle.db, VIEWER, ids.other.id);
    assert.equal(restricted.statusCode, 404);
    assert.equal(restricted.code, 'CREDIT_PROFILE_NOT_FOUND');

    const missing = await readById(getCreditProfile, handle.db, VIEWER, 'profile-does-not-exist');
    assert.equal(missing.statusCode, 404, 'absent and restricted must be indistinguishable');
    assert.equal(missing.code, restricted.code);

    for (const actor of [ADMIN, CROSS_READER, VIEWER, REVIEWER]) {
      const listed = await read(listCreditProfiles, handle.db, actor, {});
      const reachable = [];
      for (const row of listed.body.profiles) {
        const detail = await readById(getCreditProfile, handle.db, actor, row.id);
        assert.equal(detail.statusCode, 200, `collection/detail mismatch for ${row.id}`);
        reachable.push(row.id);
      }
      for (const hidden of Object.values(ids).map((profile) => profile.id)) {
        if (reachable.includes(hidden)) continue;
        const detail = await readById(getCreditProfile, handle.db, actor, hidden);
        assert.equal(detail.statusCode, 404, `a profile hidden from the collection is unreachable by ID (${actor.id} -> ${hidden}, code=${detail.code})`);
      }
    }
  } finally { handle.cleanup(); }
});

test('AP4.1 central management authority governs Profile and Anchor writes', async () => {
  const handle = createTempDb({ label: 'wave9-write-authority' });
  try {
    seedIdentity(handle.db);
    const before = sideEffects(handle.db);

    await assert.rejects(() => invoke(createCreditProfile, handle.db, profileBody(), VIEWER, 'denied-view'), (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
    await assert.rejects(() => invoke(createCreditProfile, handle.db, profileBody(), VIEWER_WITH_MANAGE, 'denied-manage'), (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
    await assert.rejects(() => invoke(createCreditProfile, handle.db, profileBody(), CROSS_ONLY, 'denied-cross'), (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
    await assert.rejects(() => invoke(provisionCreditAnchor, handle.db, { anchorType: 'CREDIT_OBJECT', customerId: 'customer-002', creditObjectType: 'SALES_ORDER', creditObjectId: 'DENIED' }, VIEWER_WITH_MANAGE, 'denied-anchor'), (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
    assert.deepEqual(sideEffects(handle.db), before, 'denied writes leave zero business, audit and idempotency side effects');

    const allowed = await invoke(createCreditProfile, handle.db, profileBody(), CENTRAL_WRITER_NO_READ, 'allowed-writer');
    assert.equal(allowed.statusCode, 201, 'CREDIT_MANAGE + SALES_CROSS_GROUP writes without CREDIT_VIEW');
    const adminWrite = await invoke(createCreditProfile, handle.db, profileBody({ customerId: 'customer-002' }), ADMIN, 'admin-write');
    assert.equal(adminWrite.statusCode, 201);
    const secondVersion = await invoke(createCreditProfile, handle.db, profileBody({ effectiveFrom: '2026-09-01' }), ADMIN, 'admin-version-2');
    assert.equal(secondVersion.statusCode, 201, 'authorized writer still creates effective-dated versions');
  } finally { handle.cleanup(); }
});

test('AP3 anchor inventory escalates rather than filters', async () => {
  const handle = createTempDb({ label: 'wave9-anchor-read' });
  try {
    seedIdentity(handle.db);
    await invoke(createCreditProfile, handle.db, profileBody(), ADMIN, 'anchor-aggregate');
    await invoke(createCreditProfile, handle.db, profileBody({ salespersonId: 'salesperson-wave9' }), ADMIN, 'anchor-sub');

    assert.equal((await read(listCreditAnchors, handle.db, ADMIN, {})).statusCode, 200);
    assert.equal((await read(listCreditAnchors, handle.db, CROSS_READER, {})).statusCode, 200);

    for (const actor of [VIEWER, VIEWER_WITH_MANAGE, CROSS_ONLY, NO_CREDIT, REVIEWER]) {
      const result = await read(listCreditAnchors, handle.db, actor, {});
      assert.equal(result.statusCode, 403, `anchor inventory must not be visible to ${actor.id}`);
      assert.equal(result.code, 'CREDIT_SCOPE_DENIED');
    }
  } finally { handle.cleanup(); }
});

// --- AP5 global configuration authority (document.md §15) ---

test('AP5 global configuration READ requires ADMIN or CREDIT_VIEW', async () => {
  const handle = createTempDb({ label: 'wave9-config-read' });
  try {
    await invoke(createCreditParameter, handle.db, parameterBody(), ADMIN, 'config-seed-p');
    await invoke(createCreditRule, handle.db, ruleBody(), ADMIN, 'config-seed-r');

    for (const actor of [ADMIN, FULL_THREE, VIEWER, REVIEWER, CROSS_READER]) {
      const parameters = await read(listCreditParameters, handle.db, actor, {});
      const rules = await read(listCreditRules, handle.db, actor, {});
      assert.equal(parameters.statusCode, 200, `${actor.id} reads parameters`);
      assert.equal(rules.statusCode, 200, `${actor.id} reads rules`);
      assert.equal(parameters.body.parameters.length, 1);
      assert.equal(rules.body.rules.length, 1);
    }

    for (const actor of [MANAGE_ONLY, CENTRAL_WRITER_NO_READ, CROSS_ONLY, NO_CREDIT]) {
      for (const handler of [listCreditParameters, listCreditRules]) {
        const result = await read(handler, handle.db, actor, {});
        assert.equal(result.statusCode, 403, `${actor.id} must not read configuration`);
        assert.equal(result.code, 'CREDIT_PERMISSION_DENIED');
      }
    }
  } finally { handle.cleanup(); }
});

test('AP5 global configuration WRITE requires central management authority with zero side effects', async () => {
  const handle = createTempDb({ label: 'wave9-config-write' });
  try {
    seedIdentity(handle.db);
    await invoke(createCreditParameter, handle.db, parameterBody({ valueBool: true }), ADMIN, 'baseline-param');
    await invoke(createCreditRule, handle.db, ruleBody(), ADMIN, 'baseline-rule');
    const before = sideEffects(handle.db);

    const deniedWriters = [VIEWER, VIEWER_WITH_MANAGE, REVIEWER, CROSS_READER, MANAGE_ONLY, CROSS_ONLY, NO_CREDIT];
    for (const actor of deniedWriters) {
      await assert.rejects(() => invoke(createCreditParameter, handle.db, parameterBody({ valueBool: false, effectiveFrom: '2027-01-01' }), actor, `deny-param-${actor.id}`),
        (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
      await assert.rejects(() => invoke(createCreditRule, handle.db, ruleBody({ controlStrength: 'WARNING', effectiveFrom: '2027-01-01' }), actor, `deny-rule-${actor.id}`),
        (e) => e.status === 403 && e.code === 'CREDIT_MANAGEMENT_DENIED');
    }
    assert.deepEqual(sideEffects(handle.db), before, 'no denied write created a row, audit entry or idempotency record');

    assert.equal(handle.db.prepare("SELECT value_bool FROM credit_parameters WHERE code='CREDIT_MANAGEMENT_ENABLED' AND effective_from='2026-01-01'").get().value_bool, 1,
      'ordinary Sales cannot disable Credit Management');
    assert.equal(handle.db.prepare("SELECT control_strength FROM credit_check_rules WHERE rule_code='SO_LIMIT' AND effective_from='2026-01-01'").get().control_strength, 'BLOCK',
      'ordinary Sales cannot downgrade BLOCK to WARNING');
    assert.equal(handle.db.prepare("SELECT effective_to FROM credit_parameters WHERE code='CREDIT_MANAGEMENT_ENABLED'").get().effective_to, null,
      'denied POST did not close the predecessor version');

    const authorizedDates = { [ADMIN.id]: '2027-01-01', [FULL_THREE.id]: '2028-01-01', [CENTRAL_WRITER_NO_READ.id]: '2029-01-01' };
    for (const actor of [ADMIN, FULL_THREE, CENTRAL_WRITER_NO_READ]) {
      const date = authorizedDates[actor.id];
      assert.equal((await invoke(createCreditParameter, handle.db, parameterBody({ effectiveFrom: date, valueBool: false }), actor, `ok-param-${actor.id}`)).statusCode, 201);
      assert.equal((await invoke(createCreditRule, handle.db, ruleBody({ effectiveFrom: date }), actor, `ok-rule-${actor.id}`)).statusCode, 201);
    }
    assert.equal(handle.db.prepare("SELECT effective_to FROM credit_parameters WHERE code='CREDIT_MANAGEMENT_ENABLED' AND effective_from='2026-01-01'").get().effective_to, '2026-12-31',
      'authorized version creation still closes the predecessor');
  } finally { handle.cleanup(); }
});

test('internal credit resolvers stay actor-independent', async () => {
  const handle = createTempDb({ label: 'wave9-internal-resolver' });
  try {
    await invoke(createCreditParameter, handle.db, parameterBody({ valueBool: true }), ADMIN, 'resolver-param');
    await invoke(createCreditRule, handle.db, ruleBody(), ADMIN, 'resolver-rule');
    assert.equal(resolveCreditParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', '2026-06-01').value_bool, 1);
    assert.equal(resolveCreditRule(handle.db, 'SO_LIMIT', '2026-06-01').control_strength, 'BLOCK');
    const source = await readFile(new URL('./modules/credit-policy.js', import.meta.url), 'utf8');
    for (const name of ['resolveCreditParameter', 'resolveCreditRule', 'ensureCreditPolicySnapshot', 'effectiveRows']) {
      const signature = source.slice(source.indexOf(`function ${name}`), source.indexOf(`function ${name}`) + 200);
      assert.doesNotMatch(signature, /actor/, `${name} must not take an actor`);
    }
  } finally { handle.cleanup(); }
});

// solution.md §36.15.11 T-P14: the Wave 10 engine consumes every mandatory scope,
// so the resolver must stay unfiltered even where a human read is restricted.
test('T-P14 the engine resolver is actor-free and still reaches a restricted sub-limit scope', async () => {
  const handle = createTempDb({ label: 'wave9-engine-resolver' });
  try {
    const ids = await seedTwoProfiles(handle.db);
    const sub = resolveEffectiveCreditProfile(handle.db, {
      customerId: 'customer-002', salespersonId: 'salesperson-other',
      creditObjectType: 'SALES_ORDER', creditObjectId: 'CREDIT-CUSTOMER-001', businessDate: '2026-06-01',
    });
    assert.equal(sub.id, ids.other.id, 'the engine resolves a sub-limit the human read surface hides');
    assert.equal(sub.salesperson_scope_key, 'salesperson-other');
    assert.equal(resolveEffectiveCreditProfile(handle.db, {
      customerId: 'customer-002', creditObjectType: 'SALES_ORDER', creditObjectId: 'CREDIT-CUSTOMER-001', businessDate: '2026-06-01',
    }), null, 'an aggregate lookup must not fall back across scope into a sub-limit');
    const source = await readFile(new URL('./modules/credit-profile.js', import.meta.url), 'utf8');
    const start = source.indexOf('export function resolveEffectiveCreditProfile');
    assert.doesNotMatch(source.slice(start, start + 400), /actor/, 'the engine resolver must not take an actor');
  } finally { handle.cleanup(); }
});

// solution.md §36.15.11 T-P18 / §36.15.6.1: AGGREGATE_ONLY is a constant fragment
// with nothing bound, so no substituted value can widen it.
test('T-P18 AGGREGATE_ONLY binds no value and no self id can widen the scope', async () => {
  const handle = createTempDb({ label: 'wave9-scope-predicate' });
  try {
    seedIdentity(handle.db);
    const aggregateOnly = resolveCreditProfileReadScope(handle.db, REVIEWER, {});
    assert.equal(aggregateOnly.mode, CREDIT_READ_MODE.AGGREGATE_ONLY);
    assert.deepEqual(aggregateOnly.predicateArgs, [], 'a constant fragment leaves nothing to substitute');
    assert.equal(aggregateOnly.predicateSql.includes('?'), false, 'AGGREGATE_ONLY must carry no bind placeholder');

    const plusSelf = resolveCreditProfileReadScope(handle.db, VIEWER, {});
    assert.equal(plusSelf.mode, CREDIT_READ_MODE.AGGREGATE_PLUS_SELF);
    assert.deepEqual(plusSelf.predicateArgs, ['salesperson-wave9'], 'only the actor own canonical id is bound');
    assert.equal((plusSelf.predicateSql.match(/\?/g) || []).length, 1, 'exactly one placeholder');

    assert.equal(resolveCreditProfileReadScope(handle.db, ADMIN, {}).mode, CREDIT_READ_MODE.ALL);
    assert.equal(resolveCreditProfileReadScope(handle.db, CROSS_READER, {}).mode, CREDIT_READ_MODE.CROSS_GROUP);
    assert.throws(() => resolveCreditProfileReadScope(handle.db, CROSS_ONLY, {}),
      (error) => error.status === 403 && error.code === 'CREDIT_SCOPE_DENIED');

    const source = await readFile(new URL('./modules/credit-scope.js', import.meta.url), 'utf8');
    assert.match(source, /selfSalespersonId === AGGREGATE_SCOPE_KEY/,
      'the wildcard sentinel must throw rather than collapse AGGREGATE_PLUS_SELF into AGGREGATE_ONLY');
  } finally { handle.cleanup(); }
});

// --- SC83-SC89 corrected capability evidence (UAT-S-29 / UAT-S-30) ---

test('SC83 Credit Management enabled/disabled, scope and effective dating survive an authorized new version', async () => {
  const handle = createTempDb({ label: 'wave9-sc83' });
  try {
    await invoke(createCreditParameter, handle.db, parameterBody({ valueBool: true, effectiveFrom: '2026-01-01' }), ADMIN, 'sc83-on');
    assert.equal(resolveCreditParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', '2026-06-01').value_bool, 1);
    assert.equal(resolveCreditParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', '2025-12-31'), null);

    await invoke(createCreditParameter, handle.db, parameterBody({ valueBool: false, effectiveFrom: '2026-09-01' }), ADMIN, 'sc83-off');
    assert.equal(resolveCreditParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', '2026-06-01').value_bool, 1, 'old value still effective before the new version');
    assert.equal(resolveCreditParameter(handle.db, 'CREDIT_MANAGEMENT_ENABLED', '2026-10-01').value_bool, 0, 'new value effective after the new version');
    assert.equal(handle.db.prepare("SELECT effective_to FROM credit_parameters WHERE code='CREDIT_MANAGEMENT_ENABLED' AND effective_from='2026-01-01'").get().effective_to, '2026-08-31');

    const history = handle.db.prepare("SELECT effective_from,value_bool FROM credit_parameters WHERE code='CREDIT_MANAGEMENT_ENABLED' ORDER BY effective_from").all();
    assert.equal(history.length, 2, 'historical predecessor preserved');

    const before = sideEffects(handle.db);
    await assert.rejects(() => invoke(createCreditParameter, handle.db, parameterBody({ valueBool: false, effectiveFrom: '2026-09-01' }), VIEWER, 'sc83-denied'), (e) => e.status === 403);
    assert.deepEqual(sideEffects(handle.db), before);
  } finally { handle.cleanup(); }
});

test('SC84 and SC86 control timing and both rule result types are configurable and resolvable', async () => {
  const handle = createTempDb({ label: 'wave9-sc84-sc86' });
  try {
    for (const strength of ['BLOCK', 'WARNING']) {
      await invoke(createCreditRule, handle.db, ruleBody({ ruleCode: `RULE_${strength}`, controlStrength: strength, resultPayload: { outcome: strength } }), ADMIN, `sc86-${strength}`);
      const resolved = resolveCreditRule(handle.db, `RULE_${strength}`, '2026-06-01');
      assert.equal(resolved.control_strength, strength);
      assert.deepEqual(JSON.parse(resolved.result_payload_json), { outcome: strength });
    }
    await invoke(createCreditRule, handle.db, ruleBody({ ruleCode: 'RULE_AFTER_WRITE', checkTiming: 'AFTER_WRITE_DEFERRED', businessStage: 'SALES_DELIVERY_CONFIRM', scenario: 'OVERRIDE_REQUEST', creditItem: 'AR_BALANCE' }), ADMIN, 'sc84-timing');
    const timing = resolveCreditRule(handle.db, 'RULE_AFTER_WRITE', '2026-06-01');
    assert.equal(timing.check_timing, 'AFTER_WRITE_DEFERRED');
    assert.equal(timing.business_stage, 'SALES_DELIVERY_CONFIRM');
    assert.equal(timing.scenario, 'OVERRIDE_REQUEST');
    assert.equal(timing.credit_item, 'AR_BALANCE');

    await assert.rejects(() => invoke(createCreditRule, handle.db, ruleBody({ ruleCode: 'BAD_STRENGTH', controlStrength: 'MAYBE' }), ADMIN, 'sc86-invalid'), (e) => e.status === 400);
  } finally { handle.cleanup(); }
});

test('SC87 aggregate and sub-limit identities are distinct and cannot be confused', async () => {
  const handle = createTempDb({ label: 'wave9-sc87' });
  try {
    seedIdentity(handle.db);
    const aggregate = await invoke(createCreditProfile, handle.db, profileBody(), ADMIN, 'sc87-agg');
    const sublimit = await invoke(createCreditProfile, handle.db, profileBody({ salespersonId: 'salesperson-wave9' }), ADMIN, 'sc87-sub');

    assert.equal(aggregate.body.profile.scopeType, 'CUSTOMER_AGGREGATE');
    assert.equal(aggregate.body.profile.salespersonScopeKey, '*');
    assert.equal(aggregate.body.profile.salespersonId, null);
    assert.equal(sublimit.body.profile.scopeType, 'SALESPERSON_SUB_LIMIT');
    assert.equal(sublimit.body.profile.salespersonScopeKey, 'salesperson-wave9');
    assert.equal(sublimit.body.profile.salespersonId, 'salesperson-wave9');

    const stored = handle.db.prepare('SELECT * FROM credit_profile ORDER BY salesperson_scope_key').all();
    assert.equal(stored.length, 2);
    assert.equal(stored.filter((row) => row.salesperson_scope_key === '*').length, 1);
    assert.equal(stored.filter((row) => row.salesperson_scope_key === 'salesperson-wave9').length, 1);
    for (const row of stored) {
      if (row.salesperson_scope_key === '*') assert.equal(row.salesperson_id, null);
      else assert.equal(row.salesperson_scope_key, row.salesperson_id);
    }
    assert.notEqual(aggregate.body.profile.id, sublimit.body.profile.id);
    assert.notEqual(aggregate.body.profile.anchorId, sublimit.body.profile.anchorId);
  } finally { handle.cleanup(); }
});

test('SC88 predecessor closure, overlap rejection, overdue policy and rollback', async () => {
  const handle = createTempDb({ label: 'wave9-sc88' });
  try {
    seedIdentity(handle.db);
    const first = await invoke(createCreditProfile, handle.db, profileBody({ overdueDayPolicy: '30', effectiveFrom: '2026-01-01' }), ADMIN, 'sc88-v1');
    await invoke(createCreditProfile, handle.db, profileBody({ overdueDayPolicy: '15', effectiveFrom: '2026-07-01' }), ADMIN, 'sc88-v2');

    assert.equal(handle.db.prepare('SELECT effective_to FROM credit_profile WHERE id=?').get(first.body.profile.id).effective_to, '2026-06-30');
    assert.equal(handle.db.prepare('SELECT overdue_day_policy FROM credit_profile WHERE id=?').get(first.body.profile.id).overdue_day_policy, '30');
    assert.equal(resolveEffectiveCreditProfile(handle.db, { customerId: 'customer-001', creditObjectType: 'SALES_ORDER', creditObjectId: 'CREDIT-CUSTOMER-001', businessDate: '2026-08-01' }).overdue_day_policy, '15');

    const before = handle.db.prepare('SELECT COUNT(*) count FROM credit_profile').get().count;
    await assert.rejects(() => invoke(createCreditProfile, handle.db, profileBody({ effectiveFrom: '2026-06-01', effectiveTo: '2027-06-01' }), ADMIN, 'sc88-overlap'), (e) => e.status === 409);
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_profile').get().count, before, 'rejected overlap rolls back');
    assert.equal(handle.db.prepare('SELECT COUNT(*) count FROM credit_profile_ratings').get().count, before);
    assert.equal(handle.db.prepare('SELECT effective_to FROM credit_profile WHERE id=?').get(first.body.profile.id).effective_to, '2026-06-30');
  } finally { handle.cleanup(); }
});

test('SC89 initial state, status, rule linkage and immutable rating history', async () => {
  const handle = createTempDb({ label: 'wave9-sc89' });
  try {
    seedIdentity(handle.db);
    await invoke(createCreditRule, handle.db, ruleBody({ ruleCode: 'LINKED_RULE' }), ADMIN, 'sc89-rule');
    const created = await invoke(createCreditProfile, handle.db, profileBody({
      initialState: 'WATCH', status: 'ACTIVE', ratingGrade: 'B', ruleId: null,
    }), ADMIN, 'sc89-profile');

    assert.equal(created.body.profile.initialState, 'WATCH');
    assert.equal(created.body.profile.status, 'ACTIVE');
    assert.equal(created.body.profile.ratingGrade, 'B');
    assert.equal(created.body.profile.ratingEffectiveFrom, '2026-01-01');

    const ratings = handle.db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=?').all(created.body.profile.id);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].rating_source_type, 'INITIAL_ASSIGNED');
    assert.equal(ratings[0].rating_source_key, 'INITIAL_ASSIGNED');
    assert.equal(ratings[0].rating_grade, 'B');
    assert.equal(ratings[0].evaluation_result_id, null, 'no synthetic evaluation result in Wave 9');
    assert.equal(ratings[0].superseded_at, null);

    const detail = await readById(getCreditProfile, handle.db, ADMIN, created.body.profile.id);
    assert.equal(detail.body.profile.ratings.length, 1, 'nested rating history follows profile access');

    const moduleSources = await Promise.all(['credit-profile.js', 'credit-anchor.js', 'credit-policy.js']
      .map((name) => readFile(new URL(`./modules/${name}`, import.meta.url), 'utf8')));
    for (const source of moduleSources) {
      assert.doesNotMatch(source, /UPDATE\s+credit_profile_ratings/i, 'no module may rewrite applied rating history');
    }
  } finally { handle.cleanup(); }
});