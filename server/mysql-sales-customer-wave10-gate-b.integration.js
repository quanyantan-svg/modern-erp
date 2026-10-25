// Gate B: seven fixed case owners. Except for B-COMPOSE's declared STATIC_INTENT,
// evidence is emitted only after real production-entry and persistence assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { emitGateBEvidence } from '../scripts/gates/mysql-sales-wave10-gate-b.mjs';
import { GATE_B_CASES } from '../scripts/gates/mysql-sales-wave10-manifest.mjs';
import {
  captureWave10PersistenceProjection, creditInput, productionOrderBody,
  readAuthoritativeCapacity, runCoordinatedWave10Race, seedSubmittedOrder,
  wave10ProjectionDelta, withWave10Race,
} from './test-utils/wave10-mysql-acceptance-fixture.js';

const required = [
  'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
  'ERP_MYSQL_WAVE10_CAMPAIGN_ID', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE',
];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceById = new Map(GATE_B_CASES.map((item) => [item.id, item]));

function emitCase(caseId, details) {
  const declared = evidenceById.get(caseId);
  assert.ok(declared, `${caseId}: manifest declaration required`);
  emitGateBEvidence({
    caseId, level: declared.evidence, suiteId: declared.owner,
    runId: process.env.ERP_MYSQL_WAVE10_CAMPAIGN_ID, details,
  });
}

function endpoint(orderId, { stage = 'SO_APPROVE', salespersonId = 'w10-race-sp-a', proposedDeltaCents = 100000, trace = false } = {}) {
  return { action: 'evaluate-endpoint', key: `gate-b-check-${orderId}`, trace, body: {
    customerId: 'w10-race-customer', salespersonId, creditObjectType: 'SALES_ORDER',
    creditObjectId: 'W10-RACE-OBJECT', stage, businessDate: '2026-10-25', proposedDeltaCents,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM', salesOrderId: orderId,
  } };
}

function orderAction(orderId, action, key, actorId) {
  return { action: 'order-action', orderAction: action, orderId, body: { reason: `Gate B ${action}` }, key, actorId };
}

function succeeded(row) {
  return row.status === 200 && (row.statusCode === undefined || row.statusCode === 200);
}

function assertNoDuplicateCreditRows(db) {
  assert.deepEqual(db.prepare(`SELECT check_group_id,scope_type,COUNT(*) count FROM credit_check_results
    GROUP BY check_group_id,scope_type HAVING COUNT(*)>1`).all(), []);
}

// §37.39.7 — a production-outcome Gate B case proves the real refusal
// contract and the zero delta of the refused contender, not only a count.
function assertProductionContentionOutcome(db, outcomes, loserOrderIds, before) {
  const refused = outcomes.filter((row) => !succeeded(row));
  assert.equal(refused.length, loserOrderIds.length, JSON.stringify(outcomes));
  for (const refusal of refused) {
    assert.equal(refusal.statusCode ?? refusal.status, 409, JSON.stringify(refusal));
    assert.equal(refusal.code, 'CREDIT_CHECK_BLOCKED', JSON.stringify(refusal));
    assert.ok(refusal.details?.reasonCodes?.includes('OVER_LIMIT'), JSON.stringify(refusal.details));
    assert.ok(refusal.details?.checkGroupId, 'the refusal must carry the credit check group');
  }
  const after = captureWave10PersistenceProjection(db);
  for (const loserId of loserOrderIds) {
    assert.deepEqual((wave10ProjectionDelta(before, after).sales_orders || []).filter((row) => row.id === loserId), [],
      'the refused order row must be untouched');
  }
  assert.deepEqual((wave10ProjectionDelta(before, after).credit_special_approval || []), []);
  return after;
}

test('M-B01 B-COMPOSE — production composition retains the declared L1/L2-L8 intent', () => {
  const credit = readFileSync(resolve(root, 'server/modules/credit-check.js'), 'utf8');
  const orders = readFileSync(resolve(root, 'server/modules/sales-orders.js'), 'utf8');
  assert.match(orders, /afterParentLock:[\s\S]*assertCreditAllowsBusinessAction/);
  assert.match(credit, /L2[\s\S]*POLICY_SCOPE[\s\S]*L3 \/ L4[\s\S]*L5/);
  const evaluation = credit.slice(credit.indexOf('export function evaluateCredit'), credit.indexOf('export function lockCreditPrepaymentParents'));
  assert.doesNotMatch(evaluation, /UPDATE sales_orders|UPDATE account_receivables/);
  emitCase('B-COMPOSE', { contract: 'L1?-L2-L3-L4-L5-L6/L7-L8', runtimeClaim: false });
});

test('M-B02 B-M9 — manual Credit Check versus submit on one production-created DRAFT order', async () => {
  let evidence;
  await withWave10Race('gate-b-m9', { aggregateLimit: 500000, stage: 'SO_SUBMIT' }, async (db, workers, registrations) => {
    const created = await workers[0].run({
      action: 'order-create', actorId: 'w10-race-creator', key: 'gate-b-m9-create',
      body: productionOrderBody(),
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created));
    const orderId = created.body?.id;
    assert.ok(orderId);
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      endpoint(orderId, { stage: 'SO_SUBMIT' }),
      orderAction(orderId, 'submit', 'gate-b-m9-submit', 'w10-race-creator'),
    ]);
    assert.ok(outcomes.every(succeeded), JSON.stringify(outcomes));
    assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(orderId).status, 'SUBMITTED');
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='SALES_ORDER' AND entity_id=? AND action='SUBMIT'").get(orderId).count), 1);
    assertNoDuplicateCreditRows(db);
    const after = captureWave10PersistenceProjection(db);
    assert.notDeepEqual(after.sales_orders, before.sales_orders);
    evidence = { orderId, waits: waits.length, outcomes: outcomes.map((row) => row.statusCode ?? row.status) };
  });
  emitCase('B-M9', evidence);
});

test('M-B03 B-M10 — two salesperson approvals conserve authoritative aggregate ONLY_ONE_FITS', async () => {
  let evidence;
  await withWave10Race('gate-b-m10', { aggregateLimit: 150000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'gate-b-m10-a', salespersonId: 'w10-race-sp-a' });
    seedSubmittedOrder(db, { id: 'gate-b-m10-b', salespersonId: 'w10-race-sp-b' });
    const capacity = readAuthoritativeCapacity(db, { deltaA: 100000, deltaB: 100000 });
    assert.equal(capacity.classification, 'ONLY_ONE_FITS');
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      orderAction('gate-b-m10-a', 'approve', 'gate-b-m10-a'),
      orderAction('gate-b-m10-b', 'approve', 'gate-b-m10-b'),
    ]);
    const winners = outcomes.filter(succeeded).length;
    assert.equal(winners, 1, JSON.stringify(outcomes));
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM sales_orders WHERE id IN ('gate-b-m10-a','gate-b-m10-b') AND status='APPROVED'").get().count), 1);
    assert.ok(100000 <= capacity.available && 200000 > capacity.available);
    const winnerId = outcomes.find(succeeded).body.id;
    const loserIds = ['gate-b-m10-a', 'gate-b-m10-b'].filter((id) => id !== winnerId);
    assertProductionContentionOutcome(db, outcomes, loserIds, before);
    assertNoDuplicateCreditRows(db);
    evidence = { classification: capacity.classification, available: capacity.available, winners, waits: waits.length };
  });
  emitCase('B-M10', evidence);
});

test('M-B04 B-M11 — Profile version mutation versus active production check is OLD-or-NEW coherent', async () => {
  let evidence;
  await withWave10Race('gate-b-m11', { aggregateLimit: 300000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'gate-b-m11-order' });
    const oldId = db.prepare("SELECT id FROM credit_profile WHERE id='w10-profile-agg'").get().id;
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      { action: 'evaluate', input: creditInput({ orderId: 'gate-b-m11-order' }) },
      { action: 'profile-create', key: 'gate-b-m11-profile', body: {
        customerId: 'w10-race-customer', creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT',
        creditLimitCents: 250000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
        overdueDayPolicy: '15', effectiveFrom: '2026-10-25',
      } },
    ]);
    assert.ok(outcomes.every((row) => row.status < 500), JSON.stringify(outcomes));
    const check = outcomes[0];
    assert.equal(check.status, 200);
    const group = db.prepare(`SELECT DISTINCT credit_profile_id,profile_effective_state_hash,policy_snapshot_fingerprint
      FROM credit_check_results WHERE check_group_id=?`).all(check.outcome.checkGroupId);
    assert.equal(group.length, 1);
    const currentId = db.prepare("SELECT id FROM credit_profile WHERE effective_from='2026-10-25' AND salesperson_scope_key='*'").get()?.id;
    assert.ok([oldId, currentId].includes(group[0].credit_profile_id));
    evidence = { profileId: group[0].credit_profile_id, hash: group[0].profile_effective_state_hash, waits: waits.length };
  });
  emitCase('B-M11', evidence);
});

test('M-B05 B-M12 — production Special Approval decision stays bound to its source snapshot during policy mutation', async () => {
  let evidence;
  await withWave10Race('gate-b-m12', { aggregateLimit: 50000, scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'gate-b-m12-order', cents: 100000 });
    const evaluated = await workers[0].run({ action: 'evaluate', input: creditInput({ orderId: 'gate-b-m12-order' }) });
    assert.equal(evaluated.outcome?.decision, 'SPECIAL_APPROVAL_REQUIRED');
    const result = db.prepare("SELECT * FROM credit_check_results WHERE check_group_id=? AND decision='SPECIAL_APPROVAL_REQUIRED' ORDER BY id LIMIT 1").get(evaluated.outcome.checkGroupId);
    assert.ok(result);
    const requested = await workers[0].run({ action: 'special-request', actorId: 'w10-race-creator', key: 'gate-b-m12-request', body: {
      sourceCreditCheckResultId: result.id, reason: 'Gate B M12', requestedOverrideCents: 50000,
      requestedCeilingCents: 100000, requestedExpiryBusinessDate: '2026-12-31', scopeMode: 'ONE_TIME',
    } });
    const approvalId = requested.body?.approval?.id;
    assert.ok(approvalId);
    const sourceFingerprint = result.policy_snapshot_fingerprint;
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      { action: 'special-decide', approvalId, key: 'gate-b-m12-decide', body: {
        decision: 'APPROVED', approvedOverrideCents: 50000, approvedCeilingCents: 100000,
        approvedExpiryBusinessDate: '2026-12-31', reason: 'bounded approval',
      } },
      { action: 'parameter-create', key: 'gate-b-m12-policy', body: {
        code: 'CREDIT_MANAGEMENT_ENABLED', valueBool: true, effectiveFrom: '2026-10-25', status: 'ACTIVE',
      } },
    ]);
    assert.ok(outcomes.every((row) => row.status < 500), JSON.stringify(outcomes));
    const approval = db.prepare('SELECT * FROM credit_special_approval WHERE id=?').get(approvalId);
    assert.equal(approval.source_policy_snapshot_fingerprint, sourceFingerprint);
    assert.ok(['APPROVED', 'PENDING'].includes(approval.decision));
    evidence = { approvalId, decision: approval.decision, sourceFingerprint, waits: waits.length };
  });
  emitCase('B-M12', evidence);
});

test('M-B06 B-M15 — empty-parent production approvals produce exactly one aggregate winner', async () => {
  let evidence;
  await withWave10Race('gate-b-m15', { aggregateLimit: 150000 }, async (db, workers, registrations) => {
    assert.equal(Number(db.prepare(`SELECT COUNT(*) count FROM settlement_unapplied_balances
      WHERE party_id='w10-race-customer' AND side='CUSTOMER' AND balance_type='PREPAYMENT' AND status='OPEN'`).get().count), 0);
    seedSubmittedOrder(db, { id: 'gate-b-m15-a', salespersonId: 'w10-race-sp-a' });
    seedSubmittedOrder(db, { id: 'gate-b-m15-b', salespersonId: 'w10-race-sp-b' });
    const capacity = readAuthoritativeCapacity(db, { deltaA: 100000, deltaB: 100000 });
    assert.equal(capacity.classification, 'ONLY_ONE_FITS');
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      orderAction('gate-b-m15-a', 'approve', 'gate-b-m15-a'),
      orderAction('gate-b-m15-b', 'approve', 'gate-b-m15-b'),
    ]);
    const winners = outcomes.filter(succeeded).length;
    assert.equal(winners, 1, JSON.stringify(outcomes));
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM sales_orders WHERE id IN ('gate-b-m15-a','gate-b-m15-b') AND status='APPROVED'").get().count), 1);
    const winnerId = outcomes.find(succeeded).body.id;
    const loserIds = ['gate-b-m15-a', 'gate-b-m15-b'].filter((id) => id !== winnerId);
    assertProductionContentionOutcome(db, outcomes, loserIds, before);
    assertNoDuplicateCreditRows(db);
    evidence = { emptyParents: true, classification: capacity.classification, available: capacity.available, winners, waits: waits.length };
  });
  emitCase('B-M15', evidence);
});

test('M-B07 B-M19C — missing Profile rejects at the real pre-lock guard with complete zero delta', async () => {
  let evidence;
  await withWave10Race('gate-b-m19c', { aggregateLimit: 300000 }, async (db, workers) => {
    seedSubmittedOrder(db, { id: 'gate-b-m19c-order', cents: 100000 });
    db.prepare('DELETE FROM credit_profile_ratings').run();
    db.prepare('DELETE FROM credit_profile').run();
    assert.equal(Number(db.prepare(`SELECT COUNT(*) count FROM settlement_unapplied_balances
      WHERE party_id='w10-race-customer' AND side='CUSTOMER' AND balance_type='PREPAYMENT' AND status='OPEN'`).get().count), 0);
    const before = captureWave10PersistenceProjection(db);
    const outcome = await workers[0].run(endpoint('gate-b-m19c-order', { trace: true }));
    assert.equal(outcome.status, 409, JSON.stringify(outcome));
    assert.equal(outcome.code, 'CREDIT_PROFILE_MISSING');
    assert.ok(outcome.details?.reasonCodes?.includes('CREDIT_PROFILE_MISSING'), JSON.stringify(outcome.details));
    // The trace must show the real stop boundary: the Profile resolution is
    // reached, and the L2-L5 lock chain is never entered.
    assert.ok(outcome.trace.some((sql) => /FROM credit_profile\b/i.test(sql)), 'trace must reach Profile resolution');
    assert.equal(outcome.trace.some((sql) => /SELECT id FROM credit_lock_anchors WHERE id=\?/i.test(sql)), false,
      'missing Profile must stop before the L2-L5 anchor/profile lock chain');
    assert.equal(outcome.trace.some((sql) => /credit_profile WHERE id=\?.*FOR UPDATE/i.test(sql)), false,
      'missing Profile must stop before the L5 Credit Profile lock');
    assert.equal(outcome.trace.some((sql) => /INSERT INTO credit_check_results/i.test(sql)), false,
      'a refused check must not write a Credit Check result');
    assert.equal(outcome.trace.some((sql) => /INSERT INTO audit_logs/i.test(sql)), false,
      'a refused check must not write an audit fact');
    const after = captureWave10PersistenceProjection(db);
    assert.deepEqual(after, before, 'B-M19C must leave the complete authoritative projection unchanged');
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM credit_check_results").get().count), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM idempotency_records").get().count), 0);
    evidence = {
      error: outcome.code,
      stopBoundary: 'PRE_LOCK_PROFILE_GUARD',
      reachedL2L5: false,
      projectionFamilies: 6,
    };
  });
  emitCase('B-M19C', evidence);
});
