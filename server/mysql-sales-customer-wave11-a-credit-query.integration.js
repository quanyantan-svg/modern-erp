// W11-A U2 — protected real-MySQL E3 acceptance.
// Flat top-level TAP only: the protected campaign parser rejects nested plans.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createDatabase, transaction } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  ADMIN, CROSS_READER, CREDIT_OBJECT_TYPE, DECIDER, HISTORICAL, NO_CREDIT, OTHER_ACTOR,
  PROFILE_FROM, SELF_ACTOR, TODAY, UNMAPPED_ACTOR, invoke, invokeWithId, read, readById,
} from './test-utils/wave11-sec-scope-fixture.js';
import {
  DEFAULT_EXPOSURE_STAGE, ONE_TIME_CEILING_CENTS, ONE_TIME_OVERRIDE_CENTS, ONE_TIME_PROPOSED_DELTA_CENTS,
  OTHER_SALESPERSON, SELF_CUSTOMER, SELF_SALESPERSON,
  contentDigest, databaseDigest, databaseSnapshot, ensureWave10OneTimeWorld,
  readExposure, scopeOf,
  seedCreditQueryWorld, writeAdvanceReceipt, writeStageRule, writeSubLimitProfile,
} from './test-utils/wave11-a-credit-query-fixture.js';
import { CREDIT_POLICY_HASH_VERSIONS, computePolicySnapshotFingerprint } from './modules/credit-policy.js';
import { evaluateCredit } from './modules/credit-check.js';
import { getCreditException, getCreditExposure, listCreditExceptions } from './modules/credit-query.js';
import {
  creditInput, seedSubmittedOrder,
} from './test-utils/wave10-mysql-acceptance-fixture.js';
import { decideCreditSpecialApproval, requestCreditSpecialApproval } from './modules/credit-special-approval.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

const STAGES = Object.freeze(['SO_SUBMIT', 'SO_APPROVE', 'SALES_DELIVERY_CONFIRM']);

// The exact stable business Profile keys of the two sub-limit scopes of
// `cus-w11-self`. The fixture derives every date from the server's current
// calendar day so that it never silently expires, so the effective-from part
// of the key must be derived from the fixture's own PROFILE_FROM constant and
// never hard-coded to one calendar day. The selection stays EXACT: it is never
// "the first SALESPERSON_SUB_LIMIT".
const SELF_SUB_LIMIT_PROFILE_KEY = `${SELF_CUSTOMER}:${SELF_SALESPERSON}:${PROFILE_FROM}`;
const OTHER_SUB_LIMIT_PROFILE_KEY = `${SELF_CUSTOMER}:${OTHER_SALESPERSON}:${PROFILE_FROM}`;
let mysqlHandle;
let mysqlDb;
let sqliteDb;
let sqliteDir;
let mysqlEvidence;
let sqliteEvidence;

// The amount evidence keeps the STABLE business Profile key. The raw
// credit_profile id is a per-engine UUID and can never identify a scope
// across engines; the customer / salesperson-scope-key / effective-from
// triple is the identity both engines agree on.
function amountView(scope, profileKey = null) {
  return {
    profileKey,
    scopeType: scope.scopeType,
    limitCents: scope.creditLimitCents,
    usedCents: scope.usedCents,
    remainingCents: scope.remainingCents,
    approvedSoCommitmentCents: scope.components.approvedSoCommitmentCents,
    deliveredNotSettledCents: scope.components.deliveredNotSettledCents,
    arOpenCents: scope.components.arOpenCents,
    eligiblePrepaymentCents: scope.components.eligiblePrepaymentCents,
  };
}

function buildIdentityContexts(db) {
  const rows = db.prepare(`SELECT cp.*,a.anchor_key FROM credit_profile cp
    JOIN credit_lock_anchors a ON a.id=cp.anchor_id`).all();
  return new Map(rows.map((profile) => [profile.id, {
    profileKey: `${profile.customer_id}:${profile.salesperson_scope_key}:${profile.effective_from}`,
    anchorKey: profile.anchor_key,
    creditLimitCents: profile.credit_limit_cents == null ? null : Number(profile.credit_limit_cents),
    status: profile.status,
    initialState: profile.initial_state,
    ratingGrade: profile.rating_grade,
    ratingEffectiveFrom: profile.rating_effective_from,
    ratingEffectiveTo: profile.rating_effective_to,
    overdueDayPolicy: profile.overdue_day_policy,
    ruleId: profile.rule_id,
    effectiveFrom: profile.effective_from,
    effectiveTo: profile.effective_to,
  }]));
}

function stableIdentity(identityContexts, scope) {
  const identity = scope.computedPolicyIdentity;
  const profile = identityContexts.get(identity.creditProfileId);
  assert.ok(profile, `missing prepared identity context for ${identity.creditProfileId}`);
  const semanticProfile = {
    scopeType: identity.scopeType,
    ...profile,
  };
  const normalizedProfileHash = contentDigest([semanticProfile]);
  return {
    customerId: identity.customerId,
    businessDate: identity.businessDate,
    stage: identity.stage,
    scopeType: identity.scopeType,
    profileKey: semanticProfile.profileKey,
    anchorKey: semanticProfile.anchorKey,
    parameterSetHash: identity.parameterSetHash,
    ruleSetHash: identity.ruleSetHash,
    normalizedProfileHash,
    normalizedFingerprint: computePolicySnapshotFingerprint({
      hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
      parameterSetHash: identity.parameterSetHash,
      ruleSetHash: identity.ruleSetHash,
      profileEffectiveStateHash: normalizedProfileHash,
    }),
    persisted: identity.persisted,
  };
}

async function createStableStageRule(db, stage) {
  const stableId = `w11-a-rule-${stage.toLowerCase().replaceAll('_', '-')}`;
  const rule = await writeStageRule(db, {
    ruleCode: `W11_A_${stage}`,
    businessStage: stage,
    key: `w11-a-rule-${stage}`,
  });
  db.prepare('UPDATE credit_check_rules SET id=? WHERE id=?').run(stableId, rule.id);
  return stableId;
}

function normalizeHistory(item, profileKeys) {
  // The stable projection carries every approved identity dimension: source
  // order, scope type, stage, business date, the STABLE business Profile key,
  // the proposed delta and the decision. Two Check Results of the same order
  // and scope on different dates, stages or profiles are therefore distinct
  // rows and can never be collapsed into one another.
  const breakdown = item.recordedBreakdown || {};
  const profileKey = profileKeys.get(item.creditProfileId)?.profileKey ?? 'UNATTRIBUTED';
  const proposedDeltaCents = Number(breakdown.proposedTotalCents || 0) - Number(breakdown.exposureCents || 0);
  return {
    key: [
      item.sourceOrderId, item.scopeType, item.stage, item.businessDate,
      profileKey, proposedDeltaCents, item.decision,
    ].join('|'),
    scopeType: item.scopeType,
    stage: item.stage,
    businessDate: item.businessDate,
    decision: item.decision,
    reasonCodes: item.reasonCodes,
    recordedBreakdown: item.recordedBreakdown,
    approval: item.approval ? {
      scopeType: item.approval.scopeType,
      decision: item.approval.decision,
      sourceSalesOrderId: item.approval.sourceSalesOrderId,
    } : null,
    sourceOrder: item.sourceOrder ? { id: item.sourceOrder.id, status: item.sourceOrder.status } : null,
    sourceDelivery: item.sourceDelivery ? { id: item.sourceDelivery.id, status: item.sourceDelivery.status } : null,
  };
}

async function historyView(db, actor, params = {}, { includeResultIds = false, profileKeys = new Map() } = {}) {
  const result = await read(listCreditExceptions, db, actor, params);
  if (result.statusCode !== 200) return { statusCode: result.statusCode, code: result.code };
  const view = {
    statusCode: 200,
    total: result.body.total,
    items: result.body.exceptions.map((item) => normalizeHistory(item, profileKeys)),
  };
  if (includeResultIds) view.resultIds = result.body.exceptions.map((item) => item.checkResultId);
  return view;
}

async function collectEngineEvidence(db) {
  await seedCreditQueryWorld(db);
  const approveRuleId = await createStableStageRule(db, 'SO_APPROVE');
  await createStableStageRule(db, 'SALES_DELIVERY_CONFIRM');
  await writeSubLimitProfile(db, { salespersonId: 'sp-other', ruleId: approveRuleId, key: 'w11-a-hidden-profile' });
  // The stable business identity of every Profile. It is read once, before any
  // measurement, so the amount evidence and the history projection can both
  // name a scope by a key both engines agree on.
  const identityContexts = buildIdentityContexts(db);

  const zeroBefore = databaseDigest(db);
  const zero = await readExposure(db, ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY });
  assert.equal(zero.statusCode, 200);
  assert.equal(databaseDigest(db), zeroBefore, 'zero-prepayment GET changed the database');

  // Preparation phase B. Finance and Credit Check writers run before the
  // final GET-only measurement baseline. evaluateCredit may provision anchors
  // and policy snapshots, so it must never sit inside the zero-write window.
  await writeAdvanceReceipt(db, { amountCents: 40000, businessDate: TODAY, key: 'w11-a-prepayment-40000' });
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
    authorizationContext: `${ADMIN.id}:mysql-e3`,
    consumeApprovals: false,
  }); });
  const checkAmounts = check.scopeResults.map((item) => ({
    scopeType: item.scopeType,
    exposureCents: item.exposureCents,
    availableCents: item.availableCents,
  }));
  const outOfScope = db.prepare(`SELECT id,sales_order_id,scope_type FROM credit_check_results
    WHERE sales_order_id='so-cus-w11-other' AND scope_type='SALESPERSON_SUB_LIMIT'`).get();
  assert.ok(outOfScope, 'the prepared out-of-scope history row must exist');

  // Final observation baseline. From here until measuredAfter, every business
  // operation is one of the three production GET handlers. All other work is
  // pure response normalization/assertion or the before/after observer itself.
  const measuredBefore = databaseSnapshot(db);
  const measuredDigestBefore = contentDigest(measuredBefore);
  const snapshotCountBefore = measuredBefore.credit_policy_snapshots.count;

  const stages = {};
  for (const stage of STAGES) {
    const admin = await readExposure(db, ADMIN, { customerId: SELF_CUSTOMER, businessDate: TODAY, stage });
    const self = await readExposure(db, SELF_ACTOR, { customerId: SELF_CUSTOMER, businessDate: TODAY, stage });
    assert.equal(admin.statusCode, 200);
    assert.equal(self.statusCode, 200);
    const stableScopes = (exposure) => exposure.scopes
      .map((scope) => {
        const identity = stableIdentity(identityContexts, scope);
        return { amount: amountView(scope, identity.profileKey), identity };
      })
      .sort((a, b) => a.identity.profileKey.localeCompare(b.identity.profileKey));
    const adminScopes = stableScopes(admin.body.exposure);
    const selfScopes = stableScopes(self.body.exposure);
    stages[stage] = {
      adminAmounts: adminScopes.map((scope) => scope.amount),
      adminIdentities: adminScopes.map((scope) => scope.identity),
      selfIdentities: selfScopes.map((scope) => scope.identity),
      rawAdmin: admin.body.exposure,
      rawSelf: self.body.exposure,
    };
  }

  const repeated = await readExposure(db, ADMIN, {
    customerId: SELF_CUSTOMER, businessDate: TODAY, stage: DEFAULT_EXPOSURE_STAGE,
  });
  const historical = await readExposure(db, ADMIN, {
    customerId: SELF_CUSTOMER, businessDate: HISTORICAL, stage: DEFAULT_EXPOSURE_STAGE,
  });
  const invalid = [];
  for (const params of [
    { customerId: SELF_CUSTOMER, businessDate: TODAY },
    { customerId: SELF_CUSTOMER, businessDate: TODAY, stage: '' },
    { customerId: SELF_CUSTOMER, businessDate: TODAY, stage: 'INVALID' },
  ]) {
    const result = await read(getCreditExposure, db, ADMIN, params);
    invalid.push({ statusCode: result.statusCode, code: result.code });
  }
  const denied = await read(getCreditExposure, db, NO_CREDIT, {
    customerId: SELF_CUSTOMER, businessDate: TODAY,
  });

  const histories = {};
  for (const [name, actor] of Object.entries({ ALL: ADMIN, CROSS_GROUP: CROSS_READER, AGGREGATE_ONLY: UNMAPPED_ACTOR, AGGREGATE_PLUS_SELF: SELF_ACTOR })) {
    histories[name] = await historyView(db, actor, {}, { profileKeys: identityContexts });
  }
  histories.DENY = await historyView(db, NO_CREDIT, {}, { profileKeys: identityContexts });
  const page0 = await historyView(db, ADMIN, { limit: 2, offset: 0 }, { includeResultIds: true, profileKeys: identityContexts });
  const page1 = await historyView(db, ADMIN, { limit: 2, offset: 2 }, { includeResultIds: true, profileKeys: identityContexts });
  const deniedDetail = await readById(getCreditException, db, SELF_ACTOR, outOfScope.id);
  const absentDetail = await readById(getCreditException, db, SELF_ACTOR, 'w11-a-no-such-result');

  const measuredAfter = databaseSnapshot(db);
  const measuredDigestAfter = contentDigest(measuredAfter);
  assert.deepEqual(measuredAfter, measuredBefore, 'measured GET-only phase changed the business database');
  for (const table of [
    'credit_policy_snapshots', 'credit_check_results', 'audit_logs',
    'payment_collections', 'settlement_unapplied_balances', 'balance_applications',
    'financial_refunds', 'settlement_reversal_items',
  ]) {
    assert.ok(measuredBefore[table], `${table} must exist in the production migration chain`);
    assert.deepEqual(measuredAfter[table], measuredBefore[table], `${table} changed during GET-only observation`);
  }
  assert.equal(measuredAfter.credit_policy_snapshots.count, snapshotCountBefore);

  const amountViews = (exposure) => exposure.scopes.map((scope) => amountView(
    scope,
    identityContexts.get(scope.computedPolicyIdentity.creditProfileId)?.profileKey ?? null,
  ));
  return {
    zero: amountViews(zero.body.exposure),
    stages,
    repeated: repeated.body.exposure,
    historical: amountViews(historical.body.exposure),
    invalid,
    denied: { statusCode: denied.statusCode, code: denied.code },
    histories,
    pages: [page0, page1],
    detail404: [deniedDetail, absentDetail].map((result) => ({ statusCode: result.statusCode, code: result.code, message: result.message })),
    checkAmounts,
    snapshotCountBefore,
    snapshotCountAfter: measuredAfter.credit_policy_snapshots.count,
    measuredDigestBefore,
    measuredDigestAfter,
  };
}

before(async () => {
  mysqlHandle = createTempDb({ label: 'w11-a-u2-mysql-e3', production: true });
  mysqlDb = mysqlHandle.db;
  assert.equal(mysqlDb.dialect, 'mysql', 'the E3 target must not fall back to SQLite');
  mysqlEvidence = await collectEngineEvidence(mysqlDb);

  sqliteDir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-a-e3-sqlite-'));
  sqliteDb = createDatabase(join(sqliteDir, 'reference.db'));
  sqliteEvidence = await collectEngineEvidence(sqliteDb);
});

after(() => {
  try { sqliteDb?.close(); } finally {
    if (sqliteDir) rmSync(sqliteDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    mysqlHandle?.cleanup();
  }
});

test('W11-A-E3-M1 the suite uses a real MySQL adapter and one shared production fixture', () => {
  assert.equal(mysqlDb.dialect, 'mysql');
  assert.ok(mysqlEvidence && sqliteEvidence);
});

test('W11-A-E3-M2 zero and 40000-cent prepayment amounts match the approved contract on both engines', () => {
  for (const evidence of [mysqlEvidence, sqliteEvidence]) {
    const zeroAggregate = evidence.zero.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
    const currentAggregate = evidence.stages.SO_SUBMIT.adminAmounts.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
    const currentSubLimit = evidence.stages.SO_SUBMIT.adminAmounts
      .find((scope) => scope.profileKey === SELF_SUB_LIMIT_PROFILE_KEY);
    const otherSubLimit = evidence.stages.SO_SUBMIT.adminAmounts
      .find((scope) => scope.profileKey === OTHER_SUB_LIMIT_PROFILE_KEY);
    assert.ok(currentSubLimit, `the ${SELF_SUB_LIMIT_PROFILE_KEY} sub-limit scope must be present`);
    assert.ok(otherSubLimit, `the ${OTHER_SUB_LIMIT_PROFILE_KEY} sub-limit scope must be present`);
    assert.equal(zeroAggregate.usedCents, 300000);
    assert.equal(zeroAggregate.eligiblePrepaymentCents, 0);
    assert.equal(currentAggregate.usedCents, 260000);
    assert.equal(currentAggregate.eligiblePrepaymentCents, 40000);
    assert.equal(currentAggregate.remainingCents, -160000);
    assert.equal(currentSubLimit.usedCents, 300000);
    assert.equal(currentSubLimit.eligiblePrepaymentCents, 0);
    assert.equal(otherSubLimit.usedCents, 0);
    assert.equal(otherSubLimit.eligiblePrepaymentCents, 0);
  }
  assert.deepEqual(mysqlEvidence.zero, sqliteEvidence.zero);
  assert.deepEqual(mysqlEvidence.stages.SO_SUBMIT.adminAmounts, sqliteEvidence.stages.SO_SUBMIT.adminAmounts);
});

test('W11-A-E3-M3 historical-date prepayment boundary and proposed-delta exclusion are identical', () => {
  assert.deepEqual(mysqlEvidence.historical, sqliteEvidence.historical);
  const historicalAggregate = mysqlEvidence.historical.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
  assert.equal(historicalAggregate.eligiblePrepaymentCents, 0);
  assert.equal(historicalAggregate.usedCents, 300000);
  const aggregateCheck = mysqlEvidence.checkAmounts.find((scope) => scope.scopeType === 'CUSTOMER_AGGREGATE');
  assert.equal(aggregateCheck.exposureCents, 260000);
  assert.equal(aggregateCheck.availableCents, -160000);
  assert.deepEqual(mysqlEvidence.checkAmounts, sqliteEvidence.checkAmounts);
});

test('W11-A-E3-M4 explicit stages select distinct rule identities with cross-engine parity', () => {
  const mysqlHashes = STAGES.map((stage) => mysqlEvidence.stages[stage].adminIdentities[0].ruleSetHash);
  assert.equal(new Set(mysqlHashes).size, STAGES.length);
  for (const stage of STAGES) {
    assert.deepEqual(mysqlEvidence.stages[stage].adminIdentities, sqliteEvidence.stages[stage].adminIdentities);
    assert.ok(mysqlEvidence.stages[stage].adminIdentities.every((identity) => identity.stage === stage));
  }
});

test('W11-A-E3-M5 missing empty invalid stage and DENY fail closed identically', () => {
  assert.deepEqual(mysqlEvidence.invalid, sqliteEvidence.invalid);
  assert.deepEqual(mysqlEvidence.invalid, Array(3).fill({ statusCode: 400, code: 'CREDIT_QUERY_INVALID_INPUT' }));
  assert.deepEqual(mysqlEvidence.denied, { statusCode: 403, code: 'CREDIT_SCOPE_DENIED' });
  assert.deepEqual(mysqlEvidence.denied, sqliteEvidence.denied);
});

test('W11-A-E3-M6 per-scope identity is viewer independent and unauthorized profiles do not leak', () => {
  for (const stage of STAGES) {
    const admin = mysqlEvidence.stages[stage];
    const ownAdmin = admin.adminIdentities.find((identity) => identity.profileKey.includes(':sp-self:'));
    const ownSelf = admin.selfIdentities.find((identity) => identity.profileKey.includes(':sp-self:'));
    assert.deepEqual(ownAdmin, ownSelf);
    assert.equal(admin.adminIdentities.length, 3);
    assert.equal(admin.selfIdentities.length, 2);
    assert.equal(admin.selfIdentities.some((identity) => identity.profileKey.includes(':sp-other:')), false);
  }
});

test('W11-A-E3-M7 dynamic identities remain deterministic and distinct from persisted history', () => {
  const first = mysqlEvidence.stages.SO_SUBMIT.rawAdmin;
  assert.deepEqual(mysqlEvidence.repeated, first);
  assert.ok(first.scopes.every((scope) => scope.computedPolicyIdentity));
  assert.ok(first.scopes.every((scope) => scope.computedPolicyIdentity.persisted === false));
  assert.ok(mysqlEvidence.histories.ALL.items.length > 0, 'persisted history must still exist');
  assert.equal(mysqlEvidence.snapshotCountBefore, mysqlEvidence.snapshotCountAfter);
});

test('W11-A-E3-M8 five-level history scope and stable business sequences match SQLite', () => {
  assert.deepEqual(mysqlEvidence.histories, sqliteEvidence.histories);
  assert.equal(mysqlEvidence.histories.ALL.statusCode, 200);
  assert.equal(mysqlEvidence.histories.CROSS_GROUP.statusCode, 200);
  assert.equal(mysqlEvidence.histories.AGGREGATE_ONLY.items.every((item) => item.scopeType === 'CUSTOMER_AGGREGATE'), true);
  assert.equal(mysqlEvidence.histories.DENY.statusCode, 403);
});

test('W11-A-E3-M9 pagination has no overlap and scoped/not-found details are indistinguishable', () => {
  const comparable = (pages) => pages.map(({ statusCode, total, items }) => ({ statusCode, total, items }));
  assert.deepEqual(comparable(mysqlEvidence.pages), comparable(sqliteEvidence.pages));
  for (const evidence of [mysqlEvidence, sqliteEvidence]) {
    assert.equal(evidence.pages[0].resultIds.some((id) => evidence.pages[1].resultIds.includes(id)), false);
    const projection = evidence.pages.flatMap((page) => page.items.map((item) => item.key));
    assert.equal(new Set(projection).size, projection.length, 'stable page projection must be unique before comparison');
  }
  assert.deepEqual(mysqlEvidence.detail404[0], mysqlEvidence.detail404[1]);
  assert.deepEqual(mysqlEvidence.detail404, sqliteEvidence.detail404);
});

test('W11-A-E3-M10 all measured GETs are repeatable and leave the complete database unchanged', () => {
  assert.equal(mysqlEvidence.snapshotCountBefore, mysqlEvidence.snapshotCountAfter);
  assert.equal(mysqlEvidence.measuredDigestBefore, mysqlEvidence.measuredDigestAfter);
  assert.equal(typeof mysqlEvidence.measuredDigestAfter, 'string');
  assert.equal(mysqlEvidence.measuredDigestAfter.length, 64);
});

// ---------------------------------------------------------------------------
// §37.54.22.10 — the real-MySQL ONE_TIME consumption cases (T-17, T-18)
//
// NOT_RUN in the implementation round: the real MySQL gate is forbidden in
// that round. These cases are registered for the separately authorized E3
// campaign. They MUST NOT be reported as PASS from SQLite, and the SQLite
// cases T-01..T-16 MUST NOT be presented as a substitute for them.
//
// T-17 proves the ONE_TIME single consumption ACROSS INDEPENDENT MySQL
// SESSIONS: the second session reads the consumption committed by the first
// one and is refused. It does not and cannot prove a simultaneous
// interleaving, because the MySQL transaction gate serializes application
// transactions by design (§37.54.22.7.3, first layer); the database unique
// constraint is the engine-independent backstop.
//
// THE COMPOSED DATABASE. These cases share ONE MySQL database with the
// Credit Query world of M1..M10. The two worlds are each correct in
// isolation, but two production resolvers treat their facts as GLOBAL:
//
//   * `readEffectiveParameter` refuses to choose between two ACTIVE versions
//     of one parameter code that are effective on the business date
//     (`CREDIT_EFFECTIVE_VERSION_AMBIGUOUS`);
//   * `effectiveRuleRows` collects EVERY effective rule of the stage and the
//     strongest outcome wins, so the shared world's mandatory SO_APPROVE BLOCK
//     rule would turn the ONE_TIME over-limit conclusion into a BLOCK.
//
// `ensureWave10OneTimeWorld` therefore composes the two worlds: it reconciles
// the parameter versions with the transition the production writer performs
// (`closePredecessorAndAssertRange`) and it evaluates the ONE_TIME cases at
// the stage whose effective rule set is releasable. Both are fixture facts;
// no production module, schema or migration is involved.
// ---------------------------------------------------------------------------

test('W11-A-E3-T17 the ONE_TIME approval is consumed at most once across independent MySQL sessions', async () => {
  assert.equal(mysqlDb.dialect, 'mysql');
  // The ONE_TIME world is prepared once per database and the preparation is
  // idempotent, so this case never depends on T-18 and T-18 never depends on
  // this case. The preparation reconciles the composed database: exactly ONE
  // effective CREDIT_MANAGEMENT_ENABLED version exists, and the ONE_TIME stage
  // carries a releasable rule set.
  const world = await ensureWave10OneTimeWorld(mysqlDb);
  const { businessDate, expiryBusinessDate } = world;
  seedSubmittedOrder(mysqlDb, { id: 'w11a-t17-order', cents: ONE_TIME_PROPOSED_DELTA_CENTS });

  const source = creditInput({
    orderId: 'w11a-t17-order', businessDate, stage: world.stage,
    proposedDeltaCents: ONE_TIME_PROPOSED_DELTA_CENTS,
  });
  let first;
  transaction(mysqlDb, () => { first = evaluateCredit(mysqlDb, source); });
  assert.equal(first.decision, 'SPECIAL_APPROVAL_REQUIRED');
  // The source row is THIS case's own result row. The composed database also
  // holds the shared world's over-limit results, so the row is identified by
  // this case's own check group and never by a global "first row" lookup.
  const sourceRow = mysqlDb.prepare("SELECT * FROM credit_check_results WHERE check_group_id=? AND decision='SPECIAL_APPROVAL_REQUIRED'").get(first.checkGroupId);
  assert.ok(sourceRow);

  const requested = await invoke(requestCreditSpecialApproval, mysqlDb, {
    sourceCreditCheckResultId: sourceRow.id, reason: 'T-17', requestedOverrideCents: ONE_TIME_OVERRIDE_CENTS,
    requestedCeilingCents: ONE_TIME_CEILING_CENTS, requestedExpiryBusinessDate: expiryBusinessDate, scopeMode: 'ONE_TIME',
  }, ADMIN, 'w11a-t17-request');
  assert.equal(requested.statusCode, 201, JSON.stringify(requested.body));
  // §36.6.6 — the requester and the approver may never be the same person, so
  // the decision is taken by the shared fixture's separate decider, exactly as
  // the shared Credit Query world decides its own approval.
  const decided = await invokeWithId(decideCreditSpecialApproval, mysqlDb, {
    decision: 'APPROVED', approvedOverrideCents: ONE_TIME_OVERRIDE_CENTS, approvedCeilingCents: ONE_TIME_CEILING_CENTS,
    approvedExpiryBusinessDate: expiryBusinessDate, reason: 'T-17 approved',
  }, DECIDER, requested.body.approval.id, 'w11a-t17-decide');
  assert.equal(decided.statusCode, 200, JSON.stringify(decided.body));
  const approvalId = requested.body.approval.id;

  // Session A consumes the approval on its own business action.
  let sessionA;
  transaction(mysqlDb, () => {
    sessionA = evaluateCredit(mysqlDb, { ...source, authorizationContext: 'w11a-t17-session-a' });
  });
  assert.equal(sessionA.decision, 'PASS');
  assert.equal(sessionA.consumedSpecialApprovalId, approvalId);

  // The facts session A committed. The cross-action refusal must change NONE of
  // them, so they are captured before session B runs and compared afterwards.
  const approvalBefore = mysqlDb.prepare('SELECT * FROM credit_special_approval WHERE id=?').get(approvalId);
  const sessionARowsBefore = mysqlDb
    .prepare('SELECT * FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type')
    .all(sessionA.checkGroupId);

  // Session B is an INDEPENDENT MySQL session against the same database.
  const { backend: _backend, ...config } = resolveDatabaseConfig({ backend: 'mysql' });
  const sessionB = new MySqlSyncAdapter(config);
  let sessionBOutcome = null;
  let sessionBError = null;
  try {
    transaction(sessionB, () => {
      sessionBOutcome = evaluateCredit(sessionB, { ...source, authorizationContext: 'w11a-t17-session-b' });
    });
  } catch (error) {
    sessionBError = error;
  } finally {
    sessionB.close();
  }
  // The cross-action refusal is an explicit BUSINESS conclusion, not a thrown
  // error. R-ONE-03-b fixes the shape: the decision stays
  // SPECIAL_APPROVAL_REQUIRED and the machine readable reason code rides on
  // the scope result. `assertCreditAllowsBusinessAction` — the PRODUCTION
  // caller — is the layer that converts this conclusion into a 409 and rolls
  // the caller's own transaction back; the evaluation engine itself returns
  // the refusal and never throws here. A thrown error would therefore be a
  // contract deviation, and it is asserted to be absent.
  assert.equal(sessionBError, null,
    `the cross-action refusal must be a returned business conclusion, not a thrown error: ${sessionBError?.message || ''}`);
  assert.ok(sessionBOutcome, 'the second business action must receive a conclusion');
  assert.notEqual(sessionBOutcome.decision, 'PASS', 'the second business action must not be released');
  assert.equal(sessionBOutcome.decision, 'SPECIAL_APPROVAL_REQUIRED');
  assert.notEqual(sessionBOutcome.checkGroupId, sessionA.checkGroupId,
    'a different authorization context is a different business action and therefore a different check group');

  // The refusal is explicit and machine readable on the scope that tried to
  // consume the approval (R-ONE-03-b).
  const refusedScopes = sessionBOutcome.scopeResults
    .filter((scope) => scope.reasonCodes.includes('SPECIAL_APPROVAL_ALREADY_CONSUMED'));
  assert.equal(refusedScopes.length, 1, 'exactly one scope must carry the explicit refusal reason code');
  assert.equal(refusedScopes[0].scopeType, sourceRow.scope_type,
    'the refused scope is the very scope the approval was granted for');
  assert.equal(refusedScopes[0].decision, 'SPECIAL_APPROVAL_REQUIRED');
  assert.equal(refusedScopes[0].approvalAvailable, false,
    'the already consumed approval must not be reported as available');
  // R-ONE-02-d — a scope that was not released must never name the approval
  // that another action consumed.
  assert.equal(refusedScopes[0].consumedSpecialApprovalId, null,
    'the refused scope must not name the approval consumed by another action');
  assert.equal(sessionBOutcome.consumedSpecialApprovalId, null,
    'the refused group must not name the approval consumed by another action');

  // R-ONE-03-c — the refusal must not change any existing fact: no second
  // consumption, no second CONSUME audit, no rewritten Check Result row and no
  // change to the approval itself.
  const consumptions = mysqlDb.prepare('SELECT * FROM credit_special_approval_consumption WHERE approval_id=?').all(approvalId);
  assert.equal(consumptions.length, 1, 'exactly one consumption may exist for a ONE_TIME approval');
  assert.equal(consumptions[0].consumption_key, 'SINGLE');
  assert.equal(consumptions[0].check_group_id, sessionA.checkGroupId);
  const audits = mysqlDb.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND action='CONSUME' AND entity_id=?")
    .get(approvalId);
  assert.equal(Number(audits.count), 1, 'exactly one CONSUME audit may exist for a ONE_TIME approval');
  assert.deepEqual(
    mysqlDb.prepare('SELECT * FROM credit_special_approval WHERE id=?').get(approvalId),
    approvalBefore,
    'the refused action must not change the approval row',
  );
  assert.deepEqual(
    mysqlDb.prepare('SELECT * FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type').all(sessionA.checkGroupId),
    sessionARowsBefore,
    'the refused action must not rewrite any existing Check Result row',
  );

  // Session A's legitimate replay still returns the very same conclusion and
  // still consumes nothing new (R-ONE-02-a).
  let sessionAReplay;
  transaction(mysqlDb, () => {
    sessionAReplay = evaluateCredit(mysqlDb, { ...source, authorizationContext: 'w11a-t17-session-a' });
  });
  assert.equal(sessionAReplay.decision, 'PASS');
  assert.equal(sessionAReplay.consumedSpecialApprovalId, approvalId);
  assert.equal(sessionAReplay.checkGroupId, sessionA.checkGroupId);
  assert.equal(Number(mysqlDb.prepare('SELECT COUNT(*) count FROM credit_special_approval_consumption WHERE approval_id=?').get(approvalId).count), 1,
    'the legitimate replay must not write a second consumption');
  assert.equal(Number(mysqlDb.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND action='CONSUME' AND entity_id=?").get(approvalId).count), 1,
    'the legitimate replay must not write a second CONSUME audit');
});

test('W11-A-E3-T18 the MySQL ledger refuses a second ONE_TIME consumption of the same approval', async () => {
  assert.equal(mysqlDb.dialect, 'mysql');
  // T-18 prepares its OWN consumed ONE_TIME approval through the PRODUCTION
  // writers. It reads no evidence of T-17 and it does not depend on T-17
  // having passed: the world preparation is idempotent, so T-18 seeds the
  // world itself whenever it is not there yet.
  const world = await ensureWave10OneTimeWorld(mysqlDb);
  const { businessDate, expiryBusinessDate } = world;
  const orderId = 'w11a-t18-order';
  seedSubmittedOrder(mysqlDb, { id: orderId, cents: ONE_TIME_PROPOSED_DELTA_CENTS });

  const source = creditInput({
    orderId, businessDate, stage: world.stage, proposedDeltaCents: ONE_TIME_PROPOSED_DELTA_CENTS,
  });
  let first;
  transaction(mysqlDb, () => { first = evaluateCredit(mysqlDb, source); });
  assert.equal(first.decision, 'SPECIAL_APPROVAL_REQUIRED');
  const sourceRow = mysqlDb.prepare("SELECT * FROM credit_check_results WHERE check_group_id=? AND decision='SPECIAL_APPROVAL_REQUIRED'").get(first.checkGroupId);
  assert.ok(sourceRow);

  const requested = await invoke(requestCreditSpecialApproval, mysqlDb, {
    sourceCreditCheckResultId: sourceRow.id, reason: 'T-18', requestedOverrideCents: ONE_TIME_OVERRIDE_CENTS,
    requestedCeilingCents: ONE_TIME_CEILING_CENTS, requestedExpiryBusinessDate: expiryBusinessDate, scopeMode: 'ONE_TIME',
  }, ADMIN, 'w11a-t18-request');
  assert.equal(requested.statusCode, 201, JSON.stringify(requested.body));
  const decided = await invokeWithId(decideCreditSpecialApproval, mysqlDb, {
    decision: 'APPROVED', approvedOverrideCents: ONE_TIME_OVERRIDE_CENTS, approvedCeilingCents: ONE_TIME_CEILING_CENTS,
    approvedExpiryBusinessDate: expiryBusinessDate, reason: 'T-18 approved',
  }, DECIDER, requested.body.approval.id, 'w11a-t18-decide');
  assert.equal(decided.statusCode, 200, JSON.stringify(decided.body));
  const approvalId = requested.body.approval.id;

  // The consumption this case inspects is produced by the PRODUCTION writer,
  // never by the test: the same approval, the same scope and the same
  // consumption key.
  let consumed;
  transaction(mysqlDb, () => {
    consumed = evaluateCredit(mysqlDb, { ...source, authorizationContext: 'w11a-t18-session-a' });
  });
  assert.equal(consumed.decision, 'PASS');
  assert.equal(consumed.consumedSpecialApprovalId, approvalId);
  assert.equal(
    Number(mysqlDb.prepare('SELECT COUNT(*) count FROM credit_special_approval_consumption WHERE approval_id=?').get(approvalId).count),
    1,
    'the production writer must have written exactly one consumption for this approval',
  );

  assert.throws(
    () => mysqlDb.prepare(`INSERT INTO credit_special_approval_consumption(id, approval_id, scope_mode,
        consumption_key, check_group_id, scope_type, business_date, consumed_at, consumed_by, audit_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'w11a-t18-second', approvalId, 'ONE_TIME', 'SINGLE', consumed.checkGroupId,
      'CUSTOMER_AGGREGATE', businessDate, new Date().toISOString(), null, null,
    ),
    /UNIQUE|constraint|duplicate/i,
    'the MySQL unique constraint is the engine-independent final defence',
  );
  assert.equal(
    Number(mysqlDb.prepare('SELECT COUNT(*) count FROM credit_special_approval_consumption WHERE approval_id=?').get(approvalId).count),
    1,
    'the refused INSERT must not create a second consumption record',
  );
  // The MySQL physical contract of the ledger, read from the catalog.
  const columns = mysqlDb.prepare(`SELECT COLUMN_NAME name, DATA_TYPE data_type, IS_NULLABLE nullable
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_special_approval_consumption'
    ORDER BY ORDINAL_POSITION`).all();
  assert.deepEqual(columns.map((row) => row.name), [
    'id', 'approval_id', 'scope_mode', 'consumption_key', 'check_group_id',
    'scope_type', 'business_date', 'consumed_at', 'consumed_by', 'audit_id',
  ]);
  const families = new Map(columns.map((row) => [row.name, row.data_type]));
  assert.equal(families.get('id'), 'varchar');
  assert.equal(families.get('approval_id'), 'varchar');
  assert.equal(families.get('consumption_key'), 'varchar');
  assert.equal(families.get('check_group_id'), 'varchar');
  assert.equal(families.get('scope_mode'), 'varchar');
  assert.equal(families.get('scope_type'), 'longtext');
  assert.equal(families.get('business_date'), 'longtext');
  assert.equal(families.get('consumed_at'), 'longtext');
  assert.equal(families.get('consumed_by'), 'varchar');
  assert.equal(families.get('audit_id'), 'varchar');
});
