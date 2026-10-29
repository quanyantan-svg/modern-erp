// W11-A U2-1 — SC101 Credit Query / SC102 Credit Exception History.
//
// solution.md §37.54.8 (API, response structure, zero-side-effect contract),
// §37.54.14.2 (UAT-S-35 evidence map), §37.54.15.3 (package contract),
// document.md Stage B §6.2 / §6.3 / §7 / §8 (R101-1..R101-7, R102-1..R102-5,
// UAT-S-35-A1..A7, A-D2-1..A-D2-8).
//
// EVIDENCE LEVEL. Every assertion runs on one disposable SQLite connection per
// case, against the REAL schema produced by the production migration chain and
// the REAL production writers. It is NOT real-MySQL evidence: the W11-A MySQL
// gate belongs to the next, separately authorized round.
//
// The fixture is the W11-SEC fixture, reused unchanged. Its check results and
// its special approvals were produced by the production writers, so the
// exception history under test is the canonical one. The fixture writes happen
// during setup; the measured GET requests are what the zero-write proof
// watches, and the two are recorded separately.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { createTempDb } from './test-utils/temp-db.js';
import { transaction } from './db.js';
import {
  ADMIN,
  AGGREGATE_LIMIT,
  CROSS_READER,
  CREDIT_OBJECT_TYPE,
  EXPIRED_ACTOR,
  HISTORICAL,
  NO_CREDIT,
  OTHER_ACTOR,
  PROFILE_FROM,
  SELF_ACTOR,
  TODAY,
  UNMAPPED_ACTOR,
  invoke,
  read,
  readById,
  seedWorld,
} from './test-utils/wave11-sec-scope-fixture.js';
import { computeCreditExposure, evaluateCredit, __creditCheckInternals } from './modules/credit-check.js';
import { CREDIT_POLICY_HASH_VERSIONS, computePolicySnapshotFingerprint } from './modules/credit-policy.js';
import { getCreditException, getCreditExposure, listCreditExceptions } from './modules/credit-query.js';
import {
  DEFAULT_EXPOSURE_STAGE,
  OTHER_CUSTOMER,
  OTHER_SALESPERSON,
  OTHER_TOTAL_CENTS,
  SELF_CUSTOMER,
  SELF_SALESPERSON,
  SELF_TOTAL_CENTS,
  canonicalUsedCents,
  databaseDigest as digestDatabase,
  readExposure as readSharedExposure,
  scopeOf,
  seedCreditQueryWorld,
  writeAdvanceReceipt as writeSharedAdvanceReceipt,
  writeStageRule as writeSharedStageRule,
  writeSubLimitProfile as writeSharedSubLimitProfile,
} from './test-utils/wave11-a-credit-query-fixture.js';

const { sha256, canonicalJson } = __creditCheckInternals;

let handle;
let db;
let world;

beforeEach(async () => {
  handle = createTempDb({ label: 'w11a-u2-1', production: true });
  db = handle.db;
  world = await seedCreditQueryWorld(db);
});

afterEach(() => handle?.cleanup());

// A content digest over EVERY table in the database. The zero-write proof
// compares it before and after the measured requests.
function databaseDigest() {
  return digestDatabase(db);
}

function readExposure(actor, params = {}) {
  return readSharedExposure(db, actor, params);
}

async function writeAdvanceReceipt({ amountCents, businessDate, key }) {
  return writeSharedAdvanceReceipt(db, { amountCents, businessDate, key });
}

async function writeStageRule({ ruleCode, businessStage, key }) {
  return writeSharedStageRule(db, { ruleCode, businessStage, key });
}

async function writeSubLimitProfile({ salespersonId, ruleId, key }) {
  return writeSharedSubLimitProfile(db, { salespersonId, ruleId, key });
}

// ---------------------------------------------------------------------------
// UAT-S-35-A1 / R101-1 — limit / used / remaining share the Credit Check amount
// ---------------------------------------------------------------------------

test('UAT-S-35-A1 the exposure amount is exactly the canonical Credit Check amount', async () => {
  const read1 = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  assert.equal(read1.statusCode, 200, JSON.stringify(read1.body));
  const exposure = read1.body.exposure;

  const canonical = computeCreditExposure(db, { customerId: SELF_CUSTOMER, salespersonId: SELF_SALESPERSON, businessDate: TODAY });
  const aggregate = scopeOf(exposure, 'CUSTOMER_AGGREGATE');
  const subLimit = scopeOf(exposure, 'SALESPERSON_SUB_LIMIT');

  assert.ok(aggregate, 'the aggregate scope must be reported');
  assert.ok(subLimit, 'the sub-limit scope must be reported');
  assert.equal(aggregate.usedCents, canonicalUsedCents(canonical.aggregateComponents));
  assert.equal(subLimit.usedCents, canonicalUsedCents(canonical.salespersonComponents));

  // The amount is the one a real Credit Check would use for the same scope.
  let check;
  transaction(db, () => { check = evaluateCredit(db, {
    customerId: SELF_CUSTOMER,
    salespersonId: SELF_SALESPERSON,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${SELF_CUSTOMER.toUpperCase()}`,
    stage: 'SO_SUBMIT',
    businessDate: TODAY,
    proposedDeltaCents: 0,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
    sourceRef: { sourceType: 'SALES_ORDER', sourceId: `so-${SELF_CUSTOMER}` },
    actorId: 'w11-admin',
    authorizationContext: 'w11-admin',
    consumeApprovals: false,
  }); });
  const checkAggregate = check.scopeResults.find((item) => item.scopeType === 'CUSTOMER_AGGREGATE');
  const checkSubLimit = check.scopeResults.find((item) => item.scopeType === 'SALESPERSON_SUB_LIMIT');
  assert.ok(checkAggregate, 'the check must report the aggregate scope');
  assert.ok(checkSubLimit, 'the check must report the sub-limit scope');
  assert.equal(aggregate.usedCents, checkAggregate.exposureCents, 'the aggregate amount must equal the check amount');
  assert.equal(subLimit.usedCents, checkSubLimit.exposureCents, 'the sub-limit amount must equal the check amount');
  assert.equal(aggregate.creditLimitCents, checkAggregate.creditLimitCents);
  assert.equal(subLimit.creditLimitCents, checkSubLimit.creditLimitCents);
});

test('UAT-S-35-A1 remaining and over-limit follow the canonical arithmetic', async () => {
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  assert.equal(result.statusCode, 200);
  const aggregate = scopeOf(result.body.exposure, 'CUSTOMER_AGGREGATE');
  assert.equal(aggregate.creditLimitCents, AGGREGATE_LIMIT);
  assert.equal(aggregate.usedCents, SELF_TOTAL_CENTS);
  assert.equal(aggregate.remainingCents, AGGREGATE_LIMIT - SELF_TOTAL_CENTS);
  assert.equal(aggregate.overLimitCents, SELF_TOTAL_CENTS - AGGREGATE_LIMIT);
  assert.equal(aggregate.unlimited, false);
  // Every amount is an integer number of cents. No floating point money.
  for (const value of [aggregate.creditLimitCents, aggregate.usedCents, aggregate.remainingCents, aggregate.overLimitCents]) {
    assert.equal(Number.isInteger(value), true, `amount ${value} must be an integer`);
  }
});

test('CORRECTION T-A nonzero eligible prepayment matches the final Credit Check amount', async () => {
  await writeAdvanceReceipt({ amountCents: 40000, businessDate: TODAY, key: 'advance-u2-parity' });

  // Fixture preparation is complete before the measured GET. proposedDelta=0
  // keeps current used separate from a proposed total.
  let check;
  transaction(db, () => { check = evaluateCredit(db, {
    customerId: SELF_CUSTOMER,
    salespersonId: SELF_SALESPERSON,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${SELF_CUSTOMER.toUpperCase()}`,
    stage: DEFAULT_EXPOSURE_STAGE,
    businessDate: TODAY,
    proposedDeltaCents: 0,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
    sourceRef: { sourceType: 'SALES_ORDER', sourceId: `so-${SELF_CUSTOMER}` },
    actorId: ADMIN.id,
    authorizationContext: `${ADMIN.id}:prepayment-parity`,
    consumeApprovals: false,
  }); });
  const beforeGet = databaseDigest();
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  assert.equal(databaseDigest(), beforeGet, 'the measured GET must not write after fixture preparation');

  const aggregate = scopeOf(result.body.exposure, 'CUSTOMER_AGGREGATE');
  const subLimit = scopeOf(result.body.exposure, 'SALESPERSON_SUB_LIMIT');
  const checkAggregate = check.scopeResults.find((item) => item.scopeType === 'CUSTOMER_AGGREGATE');
  const checkSubLimit = check.scopeResults.find((item) => item.scopeType === 'SALESPERSON_SUB_LIMIT');

  assert.equal(aggregate.components.eligiblePrepaymentCents, 40000);
  assert.equal(aggregate.usedCents, 260000);
  assert.equal(aggregate.remainingCents, AGGREGATE_LIMIT - 260000);
  assert.equal(aggregate.usedCents, checkAggregate.exposureCents);
  assert.equal(aggregate.remainingCents, checkAggregate.availableCents);
  assert.equal(subLimit.components.eligiblePrepaymentCents, 0);
  assert.equal(subLimit.usedCents, 300000);
  assert.equal(subLimit.remainingCents, subLimit.creditLimitCents - 300000);
  assert.equal(subLimit.usedCents, checkSubLimit.exposureCents);
  assert.equal(subLimit.remainingCents, checkSubLimit.availableCents);
});

test('CORRECTION T-A eligible prepayment obeys the requested historical business date', async () => {
  await writeAdvanceReceipt({ amountCents: 40000, businessDate: TODAY, key: 'advance-u2-date' });
  const historical = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const current = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  const historicalAggregate = scopeOf(historical.body.exposure, 'CUSTOMER_AGGREGATE');
  const currentAggregate = scopeOf(current.body.exposure, 'CUSTOMER_AGGREGATE');
  assert.equal(historicalAggregate.components.eligiblePrepaymentCents, 0,
    'a later advance must not offset an earlier business-date exposure');
  assert.equal(historicalAggregate.usedCents, 300000);
  assert.equal(currentAggregate.components.eligiblePrepaymentCents, 40000);
  assert.equal(currentAggregate.usedCents, 260000);
  assert.equal(scopeOf(current.body.exposure, 'SALESPERSON_SUB_LIMIT').components.eligiblePrepaymentCents, 0);
});

test('R101-3 the aggregate and the sub-limit are separate scopes and never double counted', async () => {
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const aggregate = scopeOf(result.body.exposure, 'CUSTOMER_AGGREGATE');
  const subLimit = scopeOf(result.body.exposure, 'SALESPERSON_SUB_LIMIT');
  assert.notEqual(aggregate.creditProfileId, subLimit.creditProfileId, 'the two scopes are different profiles');
  assert.equal(aggregate.creditLimitCents, AGGREGATE_LIMIT);
  assert.notEqual(aggregate.creditLimitCents, subLimit.creditLimitCents, 'each scope reports its own limit');
  // The aggregate scope carries the whole customer obligation; the sub-limit
  // scope carries the salesperson obligation. They are reported separately and
  // the answer never merges them into one number.
  assert.equal(result.body.exposure.scopes.length, 2);
});

test('CORRECTION T-B explicit stage selects the effective rule set with no fallback', async () => {
  await writeStageRule({
    ruleCode: 'W11_U2_SO_APPROVE', businessStage: 'SO_APPROVE', key: 'rule-u2-so-approve',
  });
  const submit = await readExposure(ADMIN, {
    customerId: SELF_CUSTOMER, businessDate: TODAY, stage: 'SO_SUBMIT',
  });
  const approve = await readExposure(ADMIN, {
    customerId: SELF_CUSTOMER, businessDate: TODAY, stage: 'SO_APPROVE',
  });
  const submitIdentity = scopeOf(submit.body.exposure, 'CUSTOMER_AGGREGATE').computedPolicyIdentity;
  const approveIdentity = scopeOf(approve.body.exposure, 'CUSTOMER_AGGREGATE').computedPolicyIdentity;
  assert.equal(submit.body.exposure.stage, 'SO_SUBMIT');
  assert.equal(approve.body.exposure.stage, 'SO_APPROVE');
  assert.equal(submitIdentity.stage, 'SO_SUBMIT');
  assert.equal(approveIdentity.stage, 'SO_APPROVE');
  assert.notEqual(submitIdentity.ruleSetHash, approveIdentity.ruleSetHash,
    'different effective stage rules must have different rule-set identities');
});

test('CORRECTION T-B missing, empty and invalid exposure stages are refused', async () => {
  for (const params of [
    { customerId: SELF_CUSTOMER, businessDate: TODAY },
    { customerId: SELF_CUSTOMER, businessDate: TODAY, stage: '' },
    { customerId: SELF_CUSTOMER, businessDate: TODAY, stage: 'NOT_A_STAGE' },
  ]) {
    const result = await read(getCreditExposure, db, ADMIN, params);
    assert.equal(result.statusCode, 400, JSON.stringify(params));
    assert.equal(result.code, 'CREDIT_QUERY_INVALID_INPUT');
  }
  const denied = await read(getCreditExposure, db, NO_CREDIT, {
    customerId: SELF_CUSTOMER, businessDate: TODAY,
  });
  assert.equal(denied.statusCode, 403, 'DENY must be enforced before stage or Finance reads');
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
});

test('CORRECTION T-B source contains no implicit stage derivation', () => {
  const source = readFileSync(join(process.cwd(), 'server/modules/credit-query.js'), 'utf8');
  assert.equal(source.includes('resolveRuleStage'), false);
  assert.equal(source.includes('ORDER BY business_stage'), false);
  assert.equal(source.includes('CREDIT_CHECK_STAGES[0]'), false);
  assert.match(source, /CREDIT_CHECK_STAGES\.includes\(stage\)/);
});

// ---------------------------------------------------------------------------
// UAT-S-35-A2 / R101-2 — component breakdown with source identity
// ---------------------------------------------------------------------------

test('UAT-S-35-A2 the component breakdown carries the canonical components and the fact counts', async () => {
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const aggregate = scopeOf(result.body.exposure, 'CUSTOMER_AGGREGATE');
  assert.deepEqual(Object.keys(aggregate.components).sort(), [
    'ambiguousAttributionCents',
    'approvedSoCommitmentCents',
    'arOpenCents',
    'deliveredNotSettledCents',
    'eligiblePrepaymentCents',
  ]);
  assert.equal(aggregate.components.approvedSoCommitmentCents, SELF_TOTAL_CENTS);
  assert.equal(aggregate.components.arOpenCents, 0);
  assert.equal(aggregate.components.deliveredNotSettledCents, 0);
  assert.equal(aggregate.hasAmbiguousAttribution, false);
  assert.equal(aggregate.factCounts.orders, 1);
  assert.equal(aggregate.factCounts.deliveries, 0);
  assert.equal(aggregate.factCounts.receivables, 0);
});

test('UAT-S-35-A2 the historical breakdown is a different field from the live components', async () => {
  const result = await read(listCreditExceptions, db, ADMIN, {});
  assert.equal(result.statusCode, 200);
  const exception = result.body.exceptions[0];
  assert.ok(exception.recordedBreakdown, 'the persisted historical breakdown must be reported');
  // The live components live on the exposure response; the historical
  // breakdown lives on the exception. They are never mixed.
  const exposure = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  assert.ok(scopeOf(exposure.body.exposure, 'CUSTOMER_AGGREGATE').components);
  assert.notEqual(typeof exception.recordedBreakdown, 'undefined');
});

// ---------------------------------------------------------------------------
// UAT-S-35-A3 / R102-2 — exception categories, reason codes and filters
// ---------------------------------------------------------------------------

test('UAT-S-35-A3 the exception history exposes the decision and the reason codes', async () => {
  const result = await read(listCreditExceptions, db, ADMIN, {});
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.exceptions.length > 0);
  for (const exception of result.body.exceptions) {
    assert.ok(['PASS', 'WARNING', 'BLOCK', 'SPECIAL_APPROVAL_REQUIRED'].includes(exception.decision));
    assert.ok(Array.isArray(exception.reasonCodes));
    assert.ok(typeof exception.recordedBreakdown === 'object');
    assert.ok(exception.checkResultId);
    assert.ok(exception.checkGroupId);
  }
});

test('UAT-S-35-A3 the decision filter narrows the history and the total agrees', async () => {
  const all = await read(listCreditExceptions, db, ADMIN, {});
  const warnings = await read(listCreditExceptions, db, ADMIN, { decision: 'WARNING' });
  assert.equal(warnings.statusCode, 200);
  for (const exception of warnings.body.exceptions) {
    assert.equal(exception.decision, 'WARNING');
  }
  assert.equal(warnings.body.total, warnings.body.exceptions.length);
  assert.ok(warnings.body.total <= all.body.total);
});

test('UAT-S-35-A3 the approval association filter narrows the history', async () => {
  const withApproval = await read(listCreditExceptions, db, ADMIN, { hasApproval: 'true' });
  const withoutApproval = await read(listCreditExceptions, db, ADMIN, { hasApproval: 'false' });
  assert.equal(withApproval.statusCode, 200);
  assert.equal(withoutApproval.statusCode, 200);
  assert.ok(withApproval.body.exceptions.every((item) => item.approval !== null));
  assert.ok(withoutApproval.body.exceptions.every((item) => item.approval === null));
  assert.equal(withApproval.body.total + withoutApproval.body.total, (await read(listCreditExceptions, db, ADMIN, {})).body.total);
});

test('R102-1 the exception history is derived from the canonical check result and approval rows', async () => {
  const result = await read(listCreditExceptions, db, ADMIN, {});
  const checkRows = db.prepare('SELECT id,scope_type,decision FROM credit_check_results').all();
  const approvalRows = db.prepare('SELECT id,source_credit_check_result_id,decision FROM credit_special_approval').all();
  assert.equal(result.body.total, checkRows.length, 'the history is exactly the persisted check results');
  for (const exception of result.body.exceptions) {
    const source = checkRows.find((row) => row.id === exception.checkResultId);
    assert.ok(source, 'every reported exception maps to a persisted check result');
    assert.equal(exception.decision, source.decision);
    if (exception.approval) {
      const approval = approvalRows.find((row) => row.id === exception.approval.id);
      assert.ok(approval);
      assert.equal(approval.source_credit_check_result_id, exception.checkResultId,
        'the approval is only reachable through its trusted source check result');
    }
  }
});

// ---------------------------------------------------------------------------
// UAT-S-35-A4 / R101-5 — zero side effect, three evidence layers
// ---------------------------------------------------------------------------

test('UAT-S-35-A4 layer E1 — the query module contains no write path', () => {
  const source = readFileSync(join(process.cwd(), 'server/modules/credit-query.js'), 'utf8');
  const financeAdapter = readFileSync(join(process.cwd(), 'server/modules/sales-prepayment-finance-adapter.js'), 'utf8');
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  for (const forbidden of [
    'INSERT ', 'UPDATE ', 'DELETE ', 'CREATE ', 'ALTER ', 'DROP ',
    'transaction(', 'ensureCreditPolicySnapshot(', 'ensureCreditLockAnchor(',
    'evaluateCredit(', 'saveIdempotency(', 'audit(',
  ]) {
    assert.equal(code.includes(forbidden), false, `credit-query.js must not contain ${forbidden}`);
  }
  assert.match(source, /resolveEligiblePrepaymentForSalesGate\(db,[\s\S]*?lockMode: 'NONE'/,
    'SC101 must call the canonical Finance adapter without locks');
  assert.equal(source.includes('sourceBalanceIdentities'), false,
    'Finance balance identities must not be projected by SC101');
  assert.match(financeAdapter, /if \(lockMode === 'FOR_UPDATE'\) \{\s*lockParentBalances/,
    'the canonical adapter may lock only in its explicit FOR_UPDATE branch');
});

test('UAT-S-35-A4 layer E2 — the measured requests change no row and no content', async () => {
  const before = databaseDigest();
  const beforeCounts = db.prepare('SELECT COUNT(*) c FROM credit_check_results').get().c;
  const beforeSnapshots = db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c;
  const beforeProfiles = db.prepare('SELECT COUNT(*) c FROM credit_profile').get().c;
  const beforeAudit = db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c;

  await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  await readExposure(SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  await read(listCreditExceptions, db, ADMIN, {});
  await read(listCreditExceptions, db, SELF_ACTOR, { limit: '3', offset: '1' });
  await readById(getCreditException, db, ADMIN, world.results.get('so-cus-w11-self:SALESPERSON_SUB_LIMIT').id);
  await readById(getCreditException, db, SELF_ACTOR, world.results.get('so-cus-w11-other:SALESPERSON_SUB_LIMIT').id);

  assert.equal(databaseDigest(), before, 'the database content must be byte-for-byte unchanged');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM credit_check_results').get().c, beforeCounts);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c, beforeSnapshots,
    'no policy snapshot may be created by a read');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM credit_profile').get().c, beforeProfiles);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c, beforeAudit, 'no audit row may be written by a read');
});

test('UAT-S-35-A4 layer E2 — the same request twice returns the same answer and writes nothing', async () => {
  const first = await readExposure(SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const digestAfterFirst = databaseDigest();
  const second = await readExposure(SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  assert.deepEqual(second.body, first.body, 'the answer must be deterministic');
  assert.equal(databaseDigest(), digestAfterFirst, 'the repeat request must not write anything');

  const listFirst = await read(listCreditExceptions, db, ADMIN, {});
  const listSecond = await read(listCreditExceptions, db, ADMIN, {});
  assert.deepEqual(listSecond.body, listFirst.body, 'the history answer must be deterministic');
});

// ---------------------------------------------------------------------------
// UAT-S-35-A5 / R101-6 — the snapshot identity is linked, never created
// ---------------------------------------------------------------------------

test('UAT-S-35-A5 every scope has a computed policy identity and the read never persists it', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c;
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  assert.equal(result.body.exposure.policySnapshot, undefined, 'the viewer-dependent top-level identity is retired');
  for (const reportedScope of result.body.exposure.scopes) {
    const identity = reportedScope.computedPolicyIdentity;
    assert.equal(identity.customerId, SELF_CUSTOMER);
    assert.equal(identity.businessDate, HISTORICAL);
    assert.equal(identity.stage, DEFAULT_EXPOSURE_STAGE);
    assert.equal(identity.scopeType, reportedScope.scopeType);
    assert.equal(identity.creditProfileId, reportedScope.creditProfileId);
    assert.ok(identity.creditLockAnchorId);
    assert.equal(identity.hashContractVersion, CREDIT_POLICY_HASH_VERSIONS.V2);
    assert.equal(identity.fingerprintVersion, 'CSP2');
    assert.match(identity.fingerprint, /^CSP2:[0-9a-f]{64}$/, 'the dynamic fingerprint must carry the V2 prefix');
    assert.match(identity.profileEffectiveStateHash, /^[0-9a-f]{64}$/);
    assert.match(identity.parameterSetHash, /^[0-9a-f]{64}$/);
    assert.match(identity.ruleSetHash, /^[0-9a-f]{64}$/);
    assert.equal(typeof identity.persisted, 'boolean');

    const recomputed = computePolicySnapshotFingerprint({
      hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
      parameterSetHash: identity.parameterSetHash,
      ruleSetHash: identity.ruleSetHash,
      profileEffectiveStateHash: identity.profileEffectiveStateHash,
    });
    assert.equal(recomputed, identity.fingerprint, 'the fingerprint must be the pure canonical computation');
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c, before,
    'the read must not create a snapshot row');
});

test('UAT-S-35-A5 a historical conclusion links to its snapshot fingerprint and profile state', async () => {
  const result = await read(listCreditExceptions, db, ADMIN, {});
  const exception = result.body.exceptions[0];
  assert.match(exception.policySnapshotFingerprint, /^CSP[12]:[0-9a-f]{64}$/);
  assert.match(exception.profileEffectiveStateHash, /^[0-9a-f]{64}$/);
  const row = db.prepare('SELECT policy_snapshot_fingerprint,profile_effective_state_hash FROM credit_check_results WHERE id=?')
    .get(exception.checkResultId);
  assert.equal(exception.policySnapshotFingerprint, row.policy_snapshot_fingerprint,
    'the reported fingerprint is the one persisted with the historical decision');
  assert.equal(exception.profileEffectiveStateHash, row.profile_effective_state_hash);
});

test('CORRECTION T-C per-scope computed identity is independent of viewer-visible Profiles', async () => {
  const hiddenProfile = await writeSubLimitProfile({
    salespersonId: OTHER_SALESPERSON,
    ruleId: 'rule-w11-sec',
    key: 'profile-u2-viewer-hidden',
  });
  const ownProfile = db.prepare(`SELECT id FROM credit_profile
    WHERE customer_id=? AND salesperson_scope_key=? AND effective_from<=?
      AND (effective_to IS NULL OR effective_to>=?)`).get(
    SELF_CUSTOMER, SELF_SALESPERSON, TODAY, TODAY,
  );

  const admin = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  const self = await readExposure(SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  assert.equal(admin.statusCode, 200);
  assert.equal(self.statusCode, 200);
  assert.equal(admin.body.exposure.scopes.length, 3, 'ADMIN sees aggregate plus both sub-limits');
  assert.equal(self.body.exposure.scopes.length, 2, 'Self sees aggregate plus its own sub-limit');

  const adminAggregate = scopeOf(admin.body.exposure, 'CUSTOMER_AGGREGATE');
  const selfAggregate = scopeOf(self.body.exposure, 'CUSTOMER_AGGREGATE');
  assert.deepEqual(selfAggregate.computedPolicyIdentity, adminAggregate.computedPolicyIdentity,
    'another visible Profile must not change the aggregate identity');

  const adminOwn = admin.body.exposure.scopes.find((item) => item.creditProfileId === ownProfile.id);
  const selfOwn = self.body.exposure.scopes.find((item) => item.creditProfileId === ownProfile.id);
  assert.ok(adminOwn && selfOwn);
  assert.deepEqual(selfOwn.computedPolicyIdentity, adminOwn.computedPolicyIdentity,
    'the same authorized sub-limit identity must be viewer independent');
  assert.equal(JSON.stringify(self.body).includes(hiddenProfile.id), false,
    'the hidden Profile identity must not leak through any response field');
  assert.equal(self.body.exposure.scopes.some((item) => item.creditProfileId === hiddenProfile.id), false);
});

test('CORRECTION T-D computed identity stays distinct from history and exact persisted lookup is optional', async () => {
  const historyBefore = await read(listCreditExceptions, db, ADMIN, {});
  assert.ok(historyBefore.body.total > 0, 'historical Credit Checks already exist');

  const computedBefore = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  const aggregateBefore = scopeOf(computedBefore.body.exposure, 'CUSTOMER_AGGREGATE').computedPolicyIdentity;
  assert.equal(aggregateBefore.persisted, false,
    'no exact single-scope row does not mean that historical multi-scope checks do not exist');
  assert.equal(aggregateBefore.creditPolicySnapshotId, null);

  // Production Credit Check fixture preparation: an aggregate-only check
  // creates exactly the single-scope identity that SC101 computes.
  let aggregateOnlyCheck;
  transaction(db, () => { aggregateOnlyCheck = evaluateCredit(db, {
    customerId: SELF_CUSTOMER,
    salespersonId: null,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${SELF_CUSTOMER.toUpperCase()}`,
    stage: DEFAULT_EXPOSURE_STAGE,
    businessDate: TODAY,
    proposedDeltaCents: 0,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
    sourceRef: { sourceType: 'SALES_ORDER', sourceId: `so-${SELF_CUSTOMER}` },
    actorId: ADMIN.id,
    authorizationContext: `${ADMIN.id}:aggregate-only-snapshot`,
    consumeApprovals: false,
  }); });
  assert.equal(aggregateOnlyCheck.scopeResults.length, 1);
  const written = aggregateOnlyCheck.scopeResults[0];
  const snapshotCountBeforeGet = db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c;
  const computedAfter = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  const aggregateAfter = scopeOf(computedAfter.body.exposure, 'CUSTOMER_AGGREGATE').computedPolicyIdentity;
  assert.equal(aggregateAfter.persisted, true);
  assert.equal(aggregateAfter.creditPolicySnapshotId, written.creditPolicySnapshotId);
  assert.equal(aggregateAfter.fingerprint, written.policySnapshotFingerprint);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM credit_policy_snapshots').get().c, snapshotCountBeforeGet,
    'the GET links the exact row and never creates one');

  const historyAfter = await read(listCreditExceptions, db, ADMIN, {});
  const historical = historyAfter.body.exceptions.find((item) => item.checkResultId.endsWith(':CUSTOMER_AGGREGATE'));
  assert.ok(historical.policySnapshotFingerprint, 'history keeps its persisted identity field');
  assert.equal(historical.computedPolicyIdentity, undefined,
    'SC102 must never substitute the SC101 computed identity field');
});

// ---------------------------------------------------------------------------
// UAT-S-35-A6 / R102-5 — stable ordering, pagination and the scope total
// ---------------------------------------------------------------------------

test('UAT-S-35-A6 the ordering is total and stable and the pages tile without gaps or repeats', async () => {
  const all = await read(listCreditExceptions, db, ADMIN, {});
  assert.equal(all.body.total, all.body.exceptions.length);
  const ids = all.body.exceptions.map((item) => item.checkResultId);
  assert.equal(new Set(ids).size, ids.length, 'the ordering must not repeat a row');

  const seen = [];
  for (let offset = 0; offset < all.body.total; offset += 3) {
    const page = await read(listCreditExceptions, db, ADMIN, { limit: '3', offset: String(offset) });
    assert.equal(page.statusCode, 200);
    assert.equal(page.body.limit, 3);
    assert.equal(page.body.offset, offset);
    assert.equal(page.body.total, all.body.total, 'every page reports the same authorized total');
    for (const item of page.body.exceptions) seen.push(item.checkResultId);
  }
  assert.deepEqual(seen, ids, 'paging must reproduce the ordered set exactly, without a gap or a repeat');
});

test('UAT-S-35-A6 an invalid pagination is refused', async () => {
  for (const params of [{ limit: '0' }, { limit: '-1' }, { limit: 'abc' }, { offset: '-1' }, { offset: 'x' }, { limit: '5000' }]) {
    const result = await read(listCreditExceptions, db, ADMIN, params);
    assert.equal(result.statusCode, 400, `pagination ${JSON.stringify(params)} must be refused`);
    assert.equal(result.code, 'CREDIT_QUERY_INVALID_PAGINATION');
  }
});

test('UAT-S-35-A6 the total counts only the authorized rows', async () => {
  const admin = await read(listCreditExceptions, db, ADMIN, {});
  const self = await read(listCreditExceptions, db, SELF_ACTOR, {});
  const expired = await read(listCreditExceptions, db, EXPIRED_ACTOR, {});
  assert.ok(admin.body.total > self.body.total, 'the wider scope must see more rows');
  assert.ok(self.body.total > expired.body.total, 'the aggregate-only scope must see fewer rows');
  for (const page of [admin, self, expired]) {
    assert.equal(page.body.total, page.body.exceptions.length);
  }
});

// ---------------------------------------------------------------------------
// UAT-S-35-A7 / R101-7 / R102-4 — the five read modes
// ---------------------------------------------------------------------------

test('UAT-S-35-A7 the five read modes produce the canonical authorization matrix', async () => {
  const admin = await read(listCreditExceptions, db, ADMIN, {});
  const cross = await read(listCreditExceptions, db, CROSS_READER, {});
  const self = await read(listCreditExceptions, db, SELF_ACTOR, {});
  const other = await read(listCreditExceptions, db, OTHER_ACTOR, {});
  const expired = await read(listCreditExceptions, db, EXPIRED_ACTOR, {});
  const unmapped = await read(listCreditExceptions, db, UNMAPPED_ACTOR, {});
  const denied = await read(listCreditExceptions, db, NO_CREDIT, {});

  assert.equal(admin.statusCode, 200);
  assert.equal(cross.statusCode, 200);
  assert.equal(self.statusCode, 200);
  assert.equal(other.statusCode, 200);
  assert.equal(expired.statusCode, 200);
  assert.equal(unmapped.statusCode, 200);
  assert.equal(denied.statusCode, 403, 'a denied reader never reaches the query');
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');

  // ALL and CROSS_GROUP see every row; the aggregate-only modes see only the
  // aggregate rows; the self mode sees the aggregate rows plus its own.
  assert.equal(admin.body.total, cross.body.total);
  assert.equal(admin.body.total, 8, 'four customers, one aggregate and one sub-limit result each');
  assert.equal(expired.body.total, 4, 'the aggregate-only scope sees the aggregate rows only');
  assert.equal(unmapped.body.total, 4);
  assert.equal(self.body.total, 5, 'the self scope sees the aggregate rows plus its own sub-limit row');
  assert.equal(other.body.total, 5);
  for (const exception of expired.body.exceptions) {
    assert.equal(exception.scopeType, 'CUSTOMER_AGGREGATE');
  }
  for (const exception of self.body.exceptions) {
    if (exception.scopeType === 'SALESPERSON_SUB_LIMIT') {
      const profile = db.prepare('SELECT salesperson_scope_key FROM credit_profile WHERE id=?').get(exception.creditProfileId);
      assert.equal(profile.salesperson_scope_key, SELF_SALESPERSON, 'the self scope only reaches its own sub-limit row');
    }
  }
});

test('UAT-S-35-A7 the scope predicate narrows the exposure scopes as well', async () => {
  const admin = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const cross = await readExposure(CROSS_READER, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const self = await readExposure(SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const expired = await readExposure(EXPIRED_ACTOR, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  const denied = await readExposure(NO_CREDIT, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });

  assert.equal(admin.statusCode, 200);
  assert.equal(cross.statusCode, 200);
  assert.equal(self.statusCode, 200);
  assert.equal(expired.statusCode, 200);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');

  // The aggregate scope is readable by every CREDIT_VIEW holder; the sub-limit
  // scope of another salesperson is not.
  assert.ok(scopeOf(admin.body.exposure, 'CUSTOMER_AGGREGATE'));
  assert.ok(scopeOf(self.body.exposure, 'CUSTOMER_AGGREGATE'));
  assert.ok(scopeOf(expired.body.exposure, 'CUSTOMER_AGGREGATE'));
  assert.equal(scopeOf(expired.body.exposure, 'SALESPERSON_SUB_LIMIT'), null,
    'the aggregate-only mode must not see a sub-limit scope');
});

test('R101-7 a sub-limit scope of another salesperson is never reported', async () => {
  const result = await readExposure(SELF_ACTOR, {
    customerId: OTHER_CUSTOMER, businessDate: HISTORICAL, salespersonId: OTHER_SALESPERSON,
  });
  assert.equal(result.statusCode, 200);
  assert.ok(scopeOf(result.body.exposure, 'CUSTOMER_AGGREGATE'), 'the aggregate scope stays readable');
  assert.equal(scopeOf(result.body.exposure, 'SALESPERSON_SUB_LIMIT'), null,
    "another salesperson's sub-limit scope must not be reported");
});

// ---------------------------------------------------------------------------
// R101-4 / CORRECTION-1 — the business date never changes the authorization
// ---------------------------------------------------------------------------

test('R101-4 a historical business date does not restore a lapsed self scope', async () => {
  // The expired actor's membership ended yesterday, so its own sub-limit scope
  // is not visible today. Asking for a historical date must not bring it back.
  const today = await read(listCreditExceptions, db, EXPIRED_ACTOR, {});
  const historical = await read(listCreditExceptions, db, EXPIRED_ACTOR, { businessDateFrom: HISTORICAL });
  assert.equal(today.body.total, 4);
  assert.equal(historical.body.total, 4, 'a historical date must not widen the scope');

  const exposureToday = await readExposure(EXPIRED_ACTOR, { customerId: SELF_CUSTOMER });
  const exposureHistorical = await readExposure(EXPIRED_ACTOR, {
    customerId: SELF_CUSTOMER, businessDate: HISTORICAL,
  });
  assert.equal(scopeOf(exposureToday.body.exposure, 'SALESPERSON_SUB_LIMIT'), null);
  assert.equal(scopeOf(exposureHistorical.body.exposure, 'SALESPERSON_SUB_LIMIT'), null,
    'a historical business date must not restore the lapsed self scope');
});

test('R101-4 a future business date does not widen the scope either', async () => {
  const unfiltered = await read(listCreditExceptions, db, EXPIRED_ACTOR, {});
  const future = await read(listCreditExceptions, db, EXPIRED_ACTOR, { businessDateFrom: '2999-01-01' });
  assert.equal(future.statusCode, 200);
  assert.ok(future.body.total <= unfiltered.body.total, 'a future date must not widen the scope');
  assert.equal(future.body.total, 0, 'no persisted exception is dated in the future');
});

// ---------------------------------------------------------------------------
// R102-4 — the detail is not enumerable
// ---------------------------------------------------------------------------

test('R102-4 an out-of-scope detail is indistinguishable from an absent detail', async () => {
  const otherResultId = world.results.get('so-cus-w11-other:SALESPERSON_SUB_LIMIT').id;
  const outOfScope = await readById(getCreditException, db, SELF_ACTOR, otherResultId);
  const absent = await readById(getCreditException, db, SELF_ACTOR, 'no-such-check-result');
  assert.equal(outOfScope.statusCode, 404);
  assert.equal(absent.statusCode, 404);
  assert.equal(outOfScope.code, absent.code, 'the error code must not distinguish the two cases');
  assert.equal(outOfScope.message, absent.message, 'the error message must not distinguish the two cases');
  assert.equal(outOfScope.body, absent.body);
});

test('R102-4 a check group, a source id and an approval id cannot be used to bypass the scope', async () => {
  const otherResultId = world.results.get('so-cus-w11-other:SALESPERSON_SUB_LIMIT').id;
  const otherApproval = db.prepare('SELECT id FROM credit_special_approval WHERE source_credit_check_result_id=?').get(otherResultId);

  // The detail endpoint carries the very same scope predicate as the list, so
  // naming a foreign check result, its check group or its source document
  // cannot reach it.
  const byForeignResult = await readById(getCreditException, db, SELF_ACTOR, otherResultId);
  assert.equal(byForeignResult.statusCode, 404, 'a foreign check result must stay invisible');

  const byForeignSource = await read(listCreditExceptions, db, SELF_ACTOR, { customerId: OTHER_CUSTOMER });
  assert.ok(byForeignSource.body.total <= 1, 'a foreign customer must not widen the answer');
  // The aggregate scope of another customer IS readable by every CREDIT_VIEW
  // holder — that is the canonical scope contract. The sub-limit scope of
  // another customer is not, and the filter must not reach it.
  for (const exception of byForeignSource.body.exceptions) {
    assert.equal(exception.scopeType, 'CUSTOMER_AGGREGATE',
      'only the aggregate scope of another customer is visible');
  }

  if (otherApproval) {
    const approval = await readById(getCreditException, db, SELF_ACTOR, otherApproval.id);
    assert.equal(approval.statusCode, 404, 'an approval id must not reach a foreign check result');
  }

  // The wider scope still sees the very same rows, so the refusal above is a
  // scope decision and not a missing row.
  const admin = await read(listCreditExceptions, db, ADMIN, {});
  assert.ok(admin.body.total > 0);
});

test('R102-3 the history is never rewritten by a read', async () => {
  const before = db.prepare('SELECT id,decision,reason_codes_json,component_breakdown_json FROM credit_check_results ORDER BY id').all();
  const beforeApprovals = db.prepare('SELECT id,decision,scope_mode FROM credit_special_approval ORDER BY id').all();
  await read(listCreditExceptions, db, ADMIN, {});
  await readById(getCreditException, db, ADMIN, world.results.get('so-cus-w11-self:SALESPERSON_SUB_LIMIT').id);
  assert.deepEqual(
    db.prepare('SELECT id,decision,reason_codes_json,component_breakdown_json FROM credit_check_results ORDER BY id').all(),
    before,
  );
  assert.deepEqual(
    db.prepare('SELECT id,decision,scope_mode FROM credit_special_approval ORDER BY id').all(),
    beforeApprovals,
  );
});

test('SC102 returns versioned history verbatim and fails closed on an unknown or malformed identity prefix', async () => {
  const source = world.results.get('so-cus-w11-self:SALESPERSON_SUB_LIMIT').id;
  const original = db.prepare(`SELECT check_group_id,policy_snapshot_fingerprint
    FROM credit_check_results WHERE id=?`).get(source);

  for (const [column, invalidValue] of [
    ['check_group_id', `CCHK3:${'0'.repeat(64)}`],
    ['policy_snapshot_fingerprint', 'CSP2:not-a-digest'],
  ]) {
    db.prepare(`UPDATE credit_check_results SET ${column}=? WHERE id=?`).run(invalidValue, source);
    const measuredBefore = databaseDigest();
    const result = await readById(getCreditException, db, ADMIN, source);
    assert.equal(result.statusCode, 500);
    assert.equal(result.code, 'CREDIT_POLICY_IDENTITY_VERSION_INVALID');
    assert.deepEqual(databaseDigest(), measuredBefore, 'the failed GET must not repair or rewrite the invalid history');
    db.prepare(`UPDATE credit_check_results SET ${column}=? WHERE id=?`).run(original[column], source);
  }

  const restored = await readById(getCreditException, db, ADMIN, source);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.exception.checkGroupId, original.check_group_id);
  assert.equal(restored.body.exception.policySnapshotFingerprint, original.policy_snapshot_fingerprint);
});

test('R102-4 an unattributable history row is excluded from a restricted scope', async () => {
  const source = world.results.get('so-cus-w11-self:SALESPERSON_SUB_LIMIT').id;
  db.prepare(`INSERT INTO credit_check_results(id,check_group_id,scope_type,credit_lock_anchor_id,credit_profile_id,
      credit_policy_snapshot_id,policy_snapshot_fingerprint,profile_effective_state_hash,sales_order_id,sales_delivery_id,
      stage,business_date,proposed_delta_cents,recognition_mode,decision,reason_codes_json,component_breakdown_json,
      eligible_prepayment_source_identity,evaluated_at,evaluated_by)
    SELECT 'res-unattributable','CCHK2:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',scope_type,
      credit_lock_anchor_id,NULL,credit_policy_snapshot_id,
      policy_snapshot_fingerprint,profile_effective_state_hash,sales_order_id,sales_delivery_id,stage,business_date,0,
      recognition_mode,'WARNING','["OVER_LIMIT"]','{}',NULL,evaluated_at,evaluated_by
    FROM credit_check_results WHERE id=?`).run(source);

  const restricted = await read(listCreditExceptions, db, SELF_ACTOR, {});
  assert.equal(restricted.body.exceptions.every((item) => item.checkResultId !== 'res-unattributable'), true,
    'an unattributable row must be excluded from a restricted scope');
  const admin = await read(listCreditExceptions, db, ADMIN, {});
  assert.equal(admin.body.total, 9, 'the unrestricted scope still sees every persisted row');
});

// ---------------------------------------------------------------------------
// Invalid input and the missing profile contract
// ---------------------------------------------------------------------------

test('the invalid inputs are refused with the documented codes', async () => {
  const badDecision = await read(listCreditExceptions, db, ADMIN, { decision: 'NOT_A_DECISION' });
  assert.equal(badDecision.statusCode, 400);
  assert.equal(badDecision.code, 'CREDIT_QUERY_INVALID_INPUT');

  const badScopeType = await read(listCreditExceptions, db, ADMIN, { scopeType: 'NOT_A_SCOPE' });
  assert.equal(badScopeType.statusCode, 400);
  assert.equal(badScopeType.code, 'CREDIT_QUERY_INVALID_INPUT');

  const badApproval = await read(listCreditExceptions, db, ADMIN, { hasApproval: 'maybe' });
  assert.equal(badApproval.statusCode, 400);
  assert.equal(badApproval.code, 'CREDIT_QUERY_INVALID_INPUT');

  const missingCustomer = await readExposure(ADMIN, {});
  assert.equal(missingCustomer.statusCode, 400);
});

test('a customer without an enforceable profile is refused, never reported as a zero limit', async () => {
  const result = await readExposure(ADMIN, { customerId: 'cus-without-profile', businessDate: HISTORICAL });
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'CREDIT_PROFILE_MISSING');
  assert.equal(result.body, null, 'a missing profile must not be answered with a zero limit');
});

test('the exposure answer reports the requested customer and business date', async () => {
  const result = await readExposure(ADMIN, { customerId: SELF_CUSTOMER, businessDate: HISTORICAL });
  assert.equal(result.body.exposure.customerId, SELF_CUSTOMER);
  assert.equal(result.body.exposure.businessDate, HISTORICAL);
  assert.equal(result.body.exposure.stage, DEFAULT_EXPOSURE_STAGE);
});

// ---------------------------------------------------------------------------
// §37.54.22.6.3 — the consumption ledger does not change the SC101/SC102 reads
// ---------------------------------------------------------------------------

test('§37.54.22.6.3 the SC101/SC102 history reads are unchanged by the consumption ledger', async () => {
  // The ledger is created by the canonical migration chain, so the W11-A
  // fixture database carries it without any fixture-side DDL.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credit_special_approval_consumption'").all();
  assert.equal(tables.length, 1, 'the consumption ledger must exist through the canonical migration chain');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM credit_special_approval_consumption').get().count, 0,
    'a read-only fixture world carries no consumption');

  // The exception history projection is unchanged: it still reads the check
  // result and the approval, and it still exposes no consumption field.
  const source = world.results.get('so-cus-w11-self:SALESPERSON_SUB_LIMIT').id;
  const detail = await readById(getCreditException, db, ADMIN, source);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.exception.approval.scopeMode, 'ONE_TIME');
  assert.equal('consumedSpecialApprovalId' in detail.body.exception, false,
    'the exception history shape must not change');
  assert.equal('consumption' in detail.body.exception, false,
    'the exception history shape must not change');

  // A GET never writes. The measured database digest covers EVERY table, the
  // consumption ledger included.
  const before = digestDatabase(db);
  await read(listCreditExceptions, db, ADMIN, {});
  await readById(getCreditException, db, ADMIN, source);
  assert.equal(digestDatabase(db), before, 'the SC101/SC102 GETs must remain zero-write');
});
