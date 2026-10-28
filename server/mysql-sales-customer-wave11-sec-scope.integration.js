// W11-SEC-01 — real-MySQL Credit Read Scope acceptance (independent gate).
//
// Requirement : document.md §4 D2 (R-D2-1..R-D2-6), §4.1 `W11-SEC-01`
// Design      : solution.md §37.54.5.3 (scope predicate model), §37.54.7
//               (W11-SEC-01 design closure, incl. CORRECTION-1), §37.54.14.4
//
// Registered by scripts/gates/mysql-sales-wave11-sec-gate.mjs and run only
// inside the protected disposable-MySQL campaign. Loading this file without
// that target identity must fail the run — it must never silently skip its
// way to a PASS.
//
// EVIDENCE LEVEL. This file produces REAL_MYSQL_PROVEN evidence for the
// canonical Credit Read Scope on the five Credit read surfaces, and it
// compares the SQLite and the real-MySQL authorized id sets and their order
// on the same fixture. It is NOT a Wave 10 re-acceptance and it does not
// run, replace or depend on the Wave 10 campaign.
//
// The fixture, the actors and the evidence collector live in
// server/test-utils/wave11-sec-scope-fixture.js so that the SQLite proof and
// the real-MySQL acceptance execute exactly the same code on exactly the same
// fixture. The comparison is therefore a comparison of two engines and never
// of two fixtures.
//
// TAP SHAPE. The protected runner parses the transcript strictly and requires
// ONE top-level plan whose size equals the top-level test count, so the cases
// are declared as flat top-level tests — the same shape as the Wave 10
// acceptance suite that the same runner parses. A `describe` wrapper would
// nest the plan one level deeper and the transcript would be rejected.
//
// Failure handling: the shared setup runs in a top-level `before` hook and
// the disposable target is released in a top-level `after` hook, so a failed
// setup still leaves the schema clean.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createDatabase } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  ADMIN, CUSTOMERS, EXPIRED_ACTOR, EXPIRED_PROFILE_KEY, HISTORICAL, OTHER_ACTOR, OTHER_APPROVAL_KEY,
  OTHER_PROFILE_KEY, OTHER_RESULT_KEY, SELF_ACTOR, SELF_PROFILE_KEY, UNMAPPED_ACTOR,
  assertEngineParity, assertScopeContract, collectEvidence, invoke, read, readById, seedWorld,
} from './test-utils/wave11-sec-scope-fixture.js';
import { getCreditSpecialApproval, listCreditSpecialApprovals, requestCreditSpecialApproval } from './modules/credit-special-approval.js';
import { listCreditCheckResults } from './modules/credit-check.js';
import { listCreditProfiles } from './modules/credit-profile.js';

// Fail closed. Loading this file without the disposable MySQL identity must
// fail the run, never silently skip its way to a PASS.
const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

let handle;
let db;
let world;
let mysqlEvidence;
let sqliteEvidence;

before(async () => {
  handle = createTempDb({ label: 'w11-sec-scope-mysql', production: true });
  db = handle.db;
  // Fail closed: a SQLite fallback here would invalidate every assertion.
  assert.equal(db.dialect, 'mysql');
  world = await seedWorld(db);
  mysqlEvidence = await collectEvidence(db, world);

  // The SQLite reference runs the same fixture through the same production
  // handlers in the same process, so the comparison is a comparison of two
  // engines and not of two fixtures.
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-sec-sqlite-'));
  const sqliteDb = createDatabase(join(dir, 'w11-sec-reference.db'));
  try {
    const sqliteWorld = await seedWorld(sqliteDb);
    sqliteEvidence = await collectEvidence(sqliteDb, sqliteWorld);
  } finally {
    sqliteDb.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

after(() => handle?.cleanup());

test('W11-SEC-M1 the target is a real MySQL session and the fixture is complete', () => {
  assert.equal(db.dialect, 'mysql');
  assert.equal(world.profiles.size, CUSTOMERS.length * 2);
  assert.equal(world.results.size, CUSTOMERS.length * 2);
  assert.equal(world.approvals.size, 4);
});

test('W11-SEC-M2 the canonical scope contract holds on the real MySQL session', () => {
  assertScopeContract(mysqlEvidence, world, 'mysql');
});

test('W11-SEC-M3 the authorized id sets and their order are identical on SQLite and MySQL', () => {
  assertEngineParity(mysqlEvidence, sqliteEvidence);
});

test('W11-SEC-M4 a pending approval precedes the decided one on both engines', () => {
  const mysqlDecisions = mysqlEvidence[ADMIN.id].approvals.decisions;
  const sqliteDecisions = sqliteEvidence[ADMIN.id].approvals.decisions;
  assert.equal(mysqlDecisions[mysqlDecisions.length - 1], 'APPROVED',
    'the decided approval sits behind the pending ones on MySQL');
  assert.deepEqual(mysqlDecisions, sqliteDecisions, 'the NULL ordering is engine independent');
});

test('W11-SEC-M5 a historical business date never restores a revoked self scope on MySQL', async () => {
  for (const params of [{ businessDate: HISTORICAL }, { businessDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) }, {}]) {
    const listed = await read(listCreditProfiles, db, EXPIRED_ACTOR, params);
    assert.equal(listed.statusCode, 200);
    const keys = listed.body.profiles.map((profile) => `${profile.customerId}:${profile.salespersonScopeKey === '*' ? 'AGGREGATE' : profile.salespersonScopeKey}`);
    assert.equal(keys.includes(EXPIRED_PROFILE_KEY), false,
      `the ended membership regained its scope for ${JSON.stringify(params)}`);
    assert.equal(keys.includes(OTHER_PROFILE_KEY), false,
      `another salesperson scope leaked for ${JSON.stringify(params)}`);
    const results = await read(listCreditCheckResults, db, EXPIRED_ACTOR, params);
    assert.equal(results.body.results.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);
    const approvals = await read(listCreditSpecialApprovals, db, EXPIRED_ACTOR, params);
    assert.equal(approvals.body.approvals.every((row) => row.scopeType === 'CUSTOMER_AGGREGATE'), true);
  }
  // A currently valid membership keeps its own scope on a historical date.
  const legitimate = await read(listCreditProfiles, db, SELF_ACTOR, { businessDate: HISTORICAL });
  const legitimateKeys = legitimate.body.profiles.map((profile) => `${profile.customerId}:${profile.salespersonScopeKey === '*' ? 'AGGREGATE' : profile.salespersonScopeKey}`);
  assert.equal(legitimateKeys.includes(SELF_PROFILE_KEY), true);
});

test('W11-SEC-M6 a check group, a source id and an approval id never bypass the scope on MySQL', async () => {
  const otherResult = world.results.get(OTHER_RESULT_KEY);
  const otherApproval = world.approvals.get(OTHER_APPROVAL_KEY);
  const byGroup = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { checkGroupId: otherResult.checkGroupId });
  assert.equal(byGroup.statusCode, 200);
  assert.equal(byGroup.body.results.some((row) => row.id === otherResult.id), false);
  const bySource = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { sourceType: 'SALES_ORDER', sourceId: 'so-cus-w11-other' });
  assert.equal(bySource.body.results.some((row) => row.id === otherResult.id), false);
  const byApproval = await readById(getCreditSpecialApproval, db, UNMAPPED_ACTOR, otherApproval.id);
  assert.equal(byApproval.statusCode, 404);
  assert.equal(byApproval.code, 'CREDIT_SPECIAL_APPROVAL_NOT_FOUND');
  // The out-of-scope answer and the absent answer are identical.
  const absent = await readById(getCreditSpecialApproval, db, UNMAPPED_ACTOR, 'w11-approval-does-not-exist');
  assert.equal(absent.statusCode, byApproval.statusCode);
  assert.equal(absent.code, byApproval.code);
  assert.equal(absent.message, byApproval.message);
  // A filter that selects nothing stays an empty result, not an error.
  const empty = await read(listCreditCheckResults, db, UNMAPPED_ACTOR, { checkGroupId: 'w11-no-such-group' });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.results, []);
});

test('W11-SEC-M7 a result whose Credit Profile cannot be attributed fails closed on MySQL', async () => {
  const template = db.prepare("SELECT * FROM credit_check_results WHERE scope_type='CUSTOMER_AGGREGATE' LIMIT 1").get();
  db.prepare(`INSERT INTO credit_check_results(id, check_group_id, scope_type, credit_lock_anchor_id,
      credit_profile_id, credit_policy_snapshot_id, policy_snapshot_fingerprint, profile_effective_state_hash,
      sales_order_id, sales_delivery_id, stage, business_date, proposed_delta_cents, recognition_mode,
      decision, reason_codes_json, component_breakdown_json, eligible_prepayment_source_identity,
      evaluated_at, evaluated_by)
    VALUES(?,?,'CUSTOMER_AGGREGATE',?,NULL,?,?,?,?,NULL,'SO_SUBMIT',?,?,'DIRECT_BUSINESS_OPEN_ITEM',
      'SPECIAL_APPROVAL_REQUIRED','[]',?,NULL,?,?)`).run(
    'w11-mysql-result-no-profile', 'w11-mysql-group-no-profile', template.credit_lock_anchor_id,
    template.credit_policy_snapshot_id, template.policy_snapshot_fingerprint, template.profile_effective_state_hash,
    template.sales_order_id, HISTORICAL, 200000,
    JSON.stringify({
      contractVersion: 'CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1',
      proposedTotalCents: 200000,
      creditLimitCents: 100000,
    }),
    new Date().toISOString(), 'w11-admin',
  );
  for (const actor of [UNMAPPED_ACTOR, SELF_ACTOR, EXPIRED_ACTOR]) {
    const listed = await read(listCreditCheckResults, db, actor, {});
    assert.equal(listed.body.results.some((row) => row.id === 'w11-mysql-result-no-profile'), false,
      `an unattributable result leaked to ${actor.id}`);
  }
  const admin = await read(listCreditCheckResults, db, ADMIN, {});
  assert.equal(admin.body.results.some((row) => row.id === 'w11-mysql-result-no-profile'), true,
    'the unrestricted modes still see it');
  // An approval bound to that unattributable result fails closed as well.
  const requested = await invoke(requestCreditSpecialApproval, db, {
    sourceCreditCheckResultId: 'w11-mysql-result-no-profile',
    reason: 'W11-SEC acceptance fixture',
    requestedOverrideCents: 200000,
    requestedCeilingCents: 200000,
    requestedExpiryBusinessDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    scopeMode: 'ONE_TIME',
  }, { id: 'w11-admin', roleCode: 'ADMIN', permissions: ['CREDIT_VIEW', 'CREDIT_SPECIAL_APPROVE'] }, 'approval-no-profile');
  assert.equal(requested.statusCode, 201);
  const approvalId = requested.body.approval.id;
  for (const actor of [UNMAPPED_ACTOR, SELF_ACTOR]) {
    const listed = await read(listCreditSpecialApprovals, db, actor, {});
    assert.equal(listed.body.approvals.some((row) => row.id === approvalId), false);
    const detail = await readById(getCreditSpecialApproval, db, actor, approvalId);
    assert.equal(detail.statusCode, 404);
  }
  const adminDetail = await readById(getCreditSpecialApproval, db, ADMIN, approvalId);
  assert.equal(adminDetail.statusCode, 200);
});

test('W11-SEC-M8 an approval is visible only through its trusted source check result', async () => {
  const selfApproval = world.approvals.get('approval:so-cus-w11-self:SALESPERSON_SUB_LIMIT');
  const detail = await readById(getCreditSpecialApproval, db, SELF_ACTOR, selfApproval.id);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.approval.sourceCreditCheckResultId, selfApproval.sourceCreditCheckResultId);
  const source = db.prepare('SELECT scope_type FROM credit_check_results WHERE id=?')
    .get(detail.body.approval.sourceCreditCheckResultId);
  assert.equal(source.scope_type, detail.body.approval.scopeType,
    'the approval scope type and its source result must agree');
  // The same approval is out of reach for every other restricted reader.
  for (const actor of [UNMAPPED_ACTOR, EXPIRED_ACTOR, OTHER_ACTOR]) {
    const denied = await readById(getCreditSpecialApproval, db, actor, selfApproval.id);
    assert.equal(denied.statusCode, 404, `${actor.id} must not reach the sub-limit approval`);
  }
});

test('W11-SEC-M9 the remediation writes no Credit fact on MySQL', async () => {
  const snapshot = () => ({
    results: db.prepare('SELECT id,scope_type,decision,business_date,evaluated_at FROM credit_check_results ORDER BY id').all(),
    approvals: db.prepare('SELECT id,decision,requested_ceiling_cents,authority_ceiling_cents FROM credit_special_approval ORDER BY id').all(),
    profiles: db.prepare('SELECT id,salesperson_scope_key,credit_limit_cents,rating_grade FROM credit_profile ORDER BY id').all(),
    audits: db.prepare('SELECT id,action,entity_type FROM audit_logs ORDER BY id').all(),
  });
  const before = snapshot();
  await collectEvidence(db, world);
  assert.deepEqual(snapshot(), before, 'a read never writes a Credit fact');
});
