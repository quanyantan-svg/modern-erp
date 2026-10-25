// Wave 10 real-MySQL independent-session production races.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertWave10ProjectionDeltaEmpty, captureWave10PersistenceProjection, creditInput,
  productionOrderBody, readAuthoritativeCapacity, runCoordinatedWave10Race, seedSubmittedOrder,
  wave10BusinessDate, wave10DeliveryRequest, wave10ProjectionDelta, wave10SalesCommitment,
  withWave10Race,
} from './test-utils/wave10-mysql-acceptance-fixture.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);

function approve(orderId, key) {
  return { action: 'order-action', orderAction: 'approve', orderId, body: { reason: 'Wave 10 race' }, key };
}
function evaluateEndpoint(orderId, { salespersonId = 'w10-race-sp-a', proposedDeltaCents = 100000, trace = false } = {}) {
  return { action: 'evaluate-endpoint', key: `check-${orderId}`, trace, body: {
    customerId: 'w10-race-customer', salespersonId, creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT',
    stage: 'SO_APPROVE', businessDate: wave10BusinessDate(), proposedDeltaCents,
    recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM', salesOrderId: orderId,
  } };
}
function httpStatus(row) { return row.statusCode ?? row.status; }
function success(row) { return httpStatus(row) === 200; }
function assertNoDuplicateEffects(db) {
  assert.deepEqual(db.prepare(`SELECT check_group_id,scope_type,COUNT(*) count FROM credit_check_results
    GROUP BY check_group_id,scope_type HAVING COUNT(*)>1`).all(), []);
  assert.deepEqual(db.prepare(`SELECT source_credit_check_result_id,COUNT(*) count FROM credit_special_approval
    GROUP BY source_credit_check_result_id HAVING COUNT(*)>1`).all(), []);
}
function assertOrderWinners(db, ids, expected) {
  const placeholders = ids.map(() => '?').join(',');
  assert.equal(Number(db.prepare(`SELECT COUNT(*) count FROM sales_orders WHERE id IN (${placeholders}) AND status='APPROVED'`).get(...ids).count), expected);
}

// §37.39.6.3 D.4 — these refusals are setup, authorization or environment
// failures. They must never be reported as the expected credit contention
// refusal, so a case that observes one of them fails instead of passing.
const FORBIDDEN_RACE_REFUSALS = Object.freeze([
  'CREDIT_PROFILE_MISSING', 'CREDIT_PROFILE_NOT_ENFORCEABLE', 'P5_SUB_LIMIT_ONLY',
  'CREDIT_CREDIT_OBJECT_AMBIGUOUS', 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT',
  'SALES_ORDER_APPROVE_PLAN_STALE', 'SALES_ORDER_APPROVE_RETRY_EXHAUSTED',
  'SALES_GROUP_SCOPE_DENIED', 'SALES_GROUP_ACTOR_UNMAPPED', 'SALES_DEFAULT_GROUP_INVALID',
]);
const FORBIDDEN_RACE_MESSAGES = Object.freeze(['只有待审批订单可以处理', '创建人不能审批自己的订单']);

function assertNotForbiddenRefusal(outcome, label) {
  assert.notEqual(httpStatus(outcome), 403, `${label}: a permission refusal is a setup failure: ${JSON.stringify(outcome)}`);
  assert.ok(!FORBIDDEN_RACE_REFUSALS.includes(outcome.code), `${label}: forbidden refusal ${outcome.code}`);
  assert.ok(!FORBIDDEN_RACE_MESSAGES.some((text) => String(outcome.message || '').includes(text)),
    `${label}: forbidden refusal message ${outcome.message}`);
  assert.notEqual(httpStatus(outcome), 503, `${label}: a retry-exhausted refusal is a setup failure: ${JSON.stringify(outcome)}`);
}

// §37.39.6.3 — the corrected M-R01 contract. The real production Sales Order
// approval path is the entry, so the authoritative commitment is created only
// by `approveSalesOrder` and the refusal is the existing HTTP 409 credit
// contention contract.
const M_R01_ORDER_CENTS = 100000;

test('M-R01 / R-SAL-12 — two production Sales Order approvals yield exactly one authoritative commitment', async () => {
  for (const [label, limit, classification, expectedWinners] of [
    ['both', 250000, 'BOTH_FIT', 2], ['one', 150000, 'ONLY_ONE_FITS', 1],
  ]) {
    await withWave10Race(`w10-r1-${label}`, { aggregateLimit: limit }, async (db, workers, registrations) => {
      const ids = [`w10-r1-${label}-a`, `w10-r1-${label}-b`];
      for (const id of ids) seedSubmittedOrder(db, { id, cents: M_R01_ORDER_CENTS });
      const businessDate = wave10BusinessDate();

      // §37.39.6.3 B — the classification comes from the authoritative Profile
      // limit and the canonical exposure, never from a seed constant.
      const capacity = readAuthoritativeCapacity(db, {
        businessDate, deltaA: M_R01_ORDER_CENTS, deltaB: M_R01_ORDER_CENTS,
      });
      assert.equal(capacity.classification, classification, 'the capacity classification must be computed from the authoritative exposure');
      assert.equal(capacity.exposureCents, 0, 'the fixture must start without committed exposure');
      assert.ok(capacity.limitCents > 0 && Number.isSafeInteger(capacity.limitCents));

      // §37.39.6.3 C — two independently identified SUBMITTED reference facts.
      const before = captureWave10PersistenceProjection(db);
      for (const id of ids) {
        const prepared = wave10SalesCommitment(db, id);
        assert.equal(prepared.status, 'SUBMITTED');
        assert.equal(prepared.reviewerId, null);
        assert.equal(prepared.reviewedAt, null);
        assert.equal(prepared.totalCents, M_R01_ORDER_CENTS);
      }

      const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
        approve(ids[0], ids[0]), approve(ids[1], ids[1]),
      ]);
      assert.ok(waits.length >= 2, `both contenders must be observably pending at the L0 coordination boundary: ${JSON.stringify(waits)}`);

      const succeededOutcomes = outcomes.filter(success);
      const refusedOutcomes = outcomes.filter((row) => !success(row));
      assert.equal(succeededOutcomes.length, expectedWinners, `expected ${expectedWinners} winner(s): ${JSON.stringify(outcomes)}`);

      const winners = succeededOutcomes.map((row) => row.body?.id);
      const losers = ids.filter((id) => !winners.includes(id));
      assert.equal(new Set(winners).size, winners.length, 'the approved commitments must be distinct orders');
      assert.equal(losers.length, ids.length - expectedWinners);

      // §37.39.6.3 D.2 — the refusal is the existing 409 credit contract.
      for (const refusal of refusedOutcomes) {
        assertNotForbiddenRefusal(refusal, 'M-R01 loser');
        assert.equal(httpStatus(refusal), 409, JSON.stringify(refusal));
        assert.equal(refusal.code, 'CREDIT_CHECK_BLOCKED', JSON.stringify(refusal));
        assert.equal(refusal.details?.decision, 'BLOCK', JSON.stringify(refusal.details));
        assert.ok(Array.isArray(refusal.details?.reasonCodes) && refusal.details.reasonCodes.includes('OVER_LIMIT'),
          `the refusal must carry OVER_LIMIT: ${JSON.stringify(refusal.details)}`);
        assert.ok(refusal.details?.checkGroupId, 'the refusal must carry the credit check group');
        assert.ok(Array.isArray(refusal.details?.scopeResults) && refusal.details.scopeResults.length > 0,
          'the refusal must carry the scope results');
      }

      const after = captureWave10PersistenceProjection(db);
      const delta = wave10ProjectionDelta(before, after);

      // §37.39.6.3 D.1 — the successful operation creates the authoritative
      // approved commitment, and the exposure window stays valid.
      for (const winnerId of winners) {
        const committed = wave10SalesCommitment(db, winnerId);
        assert.equal(committed.status, 'APPROVED');
        assert.equal(committed.reviewerId, 'w10-race-approver');
        assert.ok(committed.reviewedAt, 'the approved order must stamp reviewed_at');
        assert.ok(String(committed.reviewedAt).slice(0, 10) <= businessDate,
          `the exposure window requires date(reviewed_at) <= businessDate (${committed.reviewedAt} > ${businessDate})`);
        assert.equal(committed.commercialCloseState, 'OPEN');
      }
      assertOrderWinners(db, ids, expectedWinners);

      // §37.39.6.3 E — the refused transaction leaves an empty forbidden delta.
      for (const loserId of losers) {
        const refusedOrder = wave10SalesCommitment(db, loserId);
        assert.equal(refusedOrder.status, 'SUBMITTED', 'the refused order keeps its original state');
        assert.equal(refusedOrder.reviewerId, null);
        assert.equal(refusedOrder.reviewedAt, null);
        assert.deepEqual((delta.sales_orders || []).filter((row) => row.id === loserId), [],
          'the refused order row must be untouched');
      }
      assert.deepEqual(delta.credit_special_approval || [], [], 'the refused transaction consumes no Special Approval');
      assert.deepEqual(delta.sales_prepayment_requirements || [], [], 'the approve path invokes no prepayment gate phase');
      assert.deepEqual(delta.sales_prepayment_gate_results || [], [], 'the approve path invokes no prepayment gate phase');
      assert.deepEqual(delta.account_receivables || [], [], 'the approve path writes no Finance row');
      assert.deepEqual(delta.payment_collections || [], [], 'the approve path writes no Finance row');
      assert.deepEqual(delta.finance_invoice_source_links || [], [], 'the approve path writes no Finance row');

      // §37.39.6.1 — exact audit and idempotency cardinality for the winners.
      const creditRows = db.prepare(`SELECT check_group_id,scope_type,sales_order_id,decision,proposed_delta_cents,reason_codes_json
        FROM credit_check_results WHERE stage='SO_APPROVE' ORDER BY check_group_id,scope_type`).all();
      const groups = new Map();
      for (const row of creditRows) {
        assert.ok(winners.includes(row.sales_order_id), 'only the winner may own committed credit result rows');
        assert.equal(row.decision, 'PASS');
        assert.equal(Number(row.proposed_delta_cents), M_R01_ORDER_CENTS);
        assert.ok(JSON.parse(row.reason_codes_json || '[]').includes('WITHIN_LIMIT'));
        groups.set(row.check_group_id, (groups.get(row.check_group_id) || 0) + 1);
      }
      assert.equal(groups.size, winners.length, 'one credit check group per winner');
      assert.equal(new Set(groups.values()).size, 1, 'every winner must own the same applicable scope set');
      assertNoDuplicateEffects(db);

      assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='EVALUATE' AND entity_type='CREDIT_CHECK'").get().count),
        winners.length, 'exactly one credit evaluation audit per winner');
      assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='APPROVE' AND entity_type='SALES_ORDER'").get().count),
        winners.length, 'exactly one approval audit per winner');
      const idempotencyRows = db.prepare("SELECT * FROM idempotency_records WHERE operation_type='SALES_ORDER_APPROVE'").all();
      assert.equal(idempotencyRows.length, winners.length, 'exactly one idempotency record per winner');
      for (const row of idempotencyRows) {
        assert.ok(winners.includes(row.document_id), 'only the winner may own an approval idempotency record');
        assert.equal(row.status, 'SUCCEEDED');
      }

      // §37.39.6.3 D.3 — the combined commitment never exceeds the ceiling.
      const committedCents = winners.reduce((sum, id) => sum + wave10SalesCommitment(db, id).totalCents, 0);
      assert.ok(committedCents <= capacity.available, `committed ${committedCents} must not exceed available ${capacity.available}`);
      if (classification === 'ONLY_ONE_FITS') {
        assert.ok(M_R01_ORDER_CENTS * 2 > capacity.available, 'the ONLY_ONE_FITS precondition must hold against the actual capacity');
      }

      // §37.39.6.3 E — an exact replay returns the stored result and creates no
      // second economic, audit or idempotency effect.
      const replay = await workers[0].run(approve(winners[0], winners[0]));
      assert.equal(httpStatus(replay), 200, JSON.stringify(replay));
      assert.equal(replay.body?.replayed, true, 'an exact replay must return the stored result');
      assert.equal(replay.body?.id, winners[0]);
      const afterReplay = captureWave10PersistenceProjection(db);
      assertWave10ProjectionDeltaEmpty(after, afterReplay, 'M-R01 exact replay');
    });
  }
});

// §37.39.6.2 — the canonical Sales Order lifecycle. A committed APPROVED
// order is created, submitted and approved by production handlers only; a
// directly inserted APPROVED order is not a canonical fact.
async function canonicalApprovedOrder(workers, { key, salespersonId = 'w10-race-sp-a' }) {
  const creator = workers[0];
  const created = await creator.run({
    action: 'order-create', actorId: 'w10-race-creator', key: `${key}-create`,
    body: productionOrderBody({ salespersonId }),
  });
  assert.equal(httpStatus(created), 201, JSON.stringify(created));
  const orderId = created.body?.id;
  assert.ok(orderId, 'the production order creation must return the order id');
  const submitted = await creator.run({ action: 'order-action', orderAction: 'submit', orderId, key: `${key}-submit` });
  assert.equal(httpStatus(submitted), 200, JSON.stringify(submitted));
  const approved = await creator.run({ action: 'order-action', orderAction: 'approve', orderId, key: `${key}-approve` });
  assert.equal(httpStatus(approved), 200, JSON.stringify(approved));
  return orderId;
}

// The canonical Delivery transition. The Delivery is created and confirmed
// through the registered production HTTP routes, so the real authorization,
// inventory, transaction, COGS, Finance recognition, audit and idempotency
// contract is exercised instead of being simulated with direct SQL.
async function canonicalDelivery(db, worker, { orderId, orderItemId, quantity = 1, billingMode = 'SEPARATE', key }) {
  const created = await worker.run({
    action: 'http-request', method: 'POST', path: '/api/sales-deliveries',
    body: wave10DeliveryRequest({ orderId, orderItemId, quantity, billingMode }),
  });
  assert.equal(created.statusCode, 201, `canonical delivery creation failed: ${JSON.stringify(created.body)}`);
  const deliveryId = created.body?.id;
  assert.ok(deliveryId, 'the canonical delivery creation must return the delivery id');
  const confirmed = await worker.run({
    action: 'http-request', method: 'POST', path: `/api/sales-deliveries/${deliveryId}`,
    body: { action: 'confirm' }, headers: { 'idempotency-key': `${key || orderId}-delivery-confirm` },
  });
  assert.equal(confirmed.statusCode, 200, `canonical delivery confirmation failed: ${JSON.stringify(confirmed.body)}`);
  const deliveryItemId = db.prepare('SELECT id FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no,id LIMIT 1').get(deliveryId)?.id;
  assert.ok(deliveryItemId, 'the canonical delivery confirmation must produce its own delivery line');
  return { deliveryId, deliveryItemId };
}

test('M-R02 / R-SAL-13 — Special Approval decision versus standard approval leaves one effective authority', async () => {
  await withWave10Race('w10-r2', { aggregateLimit: 50000, scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' }, async (db, [a, b, c], registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r2-order', cents: 100000 });
    assert.equal((await a.run({ action: 'evaluate', input: creditInput({ orderId: 'w10-r2-order' }) })).status, 200);
    const result = db.prepare("SELECT * FROM credit_check_results WHERE decision='SPECIAL_APPROVAL_REQUIRED' ORDER BY id LIMIT 1").get();
    assert.ok(result);
    // The request is created through the production request entry, so the
    // approval is bound to the source result and its snapshot.
    const request = await a.run({ action: 'special-request', actorId: 'w10-race-creator', key: 'w10-r2-request', body: {
      sourceCreditCheckResultId: result.id, reason: 'R2', requestedOverrideCents: 50000,
      requestedCeilingCents: 100000, requestedExpiryBusinessDate: '2026-12-31', scopeMode: 'ONE_TIME',
    } });
    const approvalId = request.body?.approval?.id; assert.ok(approvalId);
    const { outcomes, waits } = await runCoordinatedWave10Race([a, b, c], registrations, [
      { action: 'special-decide', approvalId, key: 'w10-r2-decide', body: { decision: 'APPROVED', approvedOverrideCents: 50000, approvedCeilingCents: 100000, approvedExpiryBusinessDate: '2026-12-31' } },
      approve('w10-r2-order', 'w10-r2-approve'),
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    // Never zero winners, and never two effective authorities.
    assert.ok(outcomes.some(success), `the race must produce at least one winner: ${JSON.stringify(outcomes)}`);
    for (const outcome of outcomes.filter((row) => !success(row))) {
      assert.ok(outcome.code, 'the losing contender must fail with an explicit conflict, never silently');
      assert.ok(!FORBIDDEN_RACE_REFUSALS.includes(outcome.code), `forbidden refusal ${outcome.code}`);
    }
    const approval = db.prepare('SELECT * FROM credit_special_approval WHERE id=?').get(approvalId);
    const order = db.prepare("SELECT status FROM sales_orders WHERE id='w10-r2-order'").get();
    const consumes = Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='CONSUME' AND entity_type='CREDIT_SPECIAL_APPROVAL'").get().count);
    assert.ok(consumes <= 1, 'the Special Approval may be consumed at most once');
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='APPROVE' AND entity_type='SALES_ORDER'").get().count),
      order.status === 'APPROVED' ? 1 : 0, 'the order may be approved at most once');
    assert.ok(approval.decision === 'APPROVED' || order.status === 'APPROVED', 'exactly one effective authority must exist');
    assertNoDuplicateEffects(db);
  });
});

test('M-R03 / R-SAL-14 — invoice posting versus Credit evaluation observes exact OLD or NEW exposure without double count', async () => {
  await withWave10Race('w10-r3', { aggregateLimit: 300000 }, async (db, [a, b, c], registrations) => {
    // The approved order and its confirmed Delivery are canonical production
    // transitions. The Delivery uses the SEPARATE billing mode so the invoice
    // — not the Delivery confirmation — is the writer that recognizes the
    // Finance exposure.
    const orderId = await canonicalApprovedOrder([a], { key: 'w10-r3' });
    const committed = wave10SalesCommitment(db, orderId);
    assert.equal(committed.status, 'APPROVED');
    const obligation = committed.totalCents;
    const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no,id LIMIT 1').get(orderId).id;
    const delivery = await canonicalDelivery(db, a, { orderId, orderItemId, billingMode: 'SEPARATE', key: 'w10-r3' });
    const created = await b.run({ action: 'invoice-create', body: { customerId: 'w10-race-customer', invoiceDate: wave10BusinessDate(), taxMode: 'NO_TAX', items: [{ deliveryItemId: delivery.deliveryItemId, quantity: 1 }], idempotencyKey: 'w10-r3-invoice' } });
    const invoiceId = created.invoice?.id; assert.ok(invoiceId);
    const oldExposure = readAuthoritativeCapacity(db, { deltaA: 0, deltaB: 0 }).exposureCents;
    assert.equal(oldExposure, obligation, 'the canonical delivery must hold the obligation in the delivered stage');
    const { outcomes, waits } = await runCoordinatedWave10Race([a, b, c], registrations, [
      { action: 'evaluate', input: creditInput({ orderId, proposedDeltaCents: 0 }) },
      { action: 'invoice-post', invoiceId },
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.ok(outcomes.every(success), JSON.stringify(outcomes));
    const newExposure = readAuthoritativeCapacity(db, { deltaA: 0, deltaB: 0 }).exposureCents;
    const row = db.prepare("SELECT exposure_cents FROM credit_check_results WHERE scope_type='CUSTOMER_AGGREGATE' ORDER BY evaluated_at DESC LIMIT 1").get();
    assert.ok(row, 'the credit check must have written its aggregate scope row');
    assert.ok([oldExposure, newExposure].includes(Number(row.exposure_cents)),
      `the check must observe exactly the OLD or the NEW canonical exposure (${row.exposure_cents} vs ${oldExposure}/${newExposure})`);
    // The final stage is counted once: the same obligation may not appear in
    // the SO commitment stage and the AR stage at the same time.
    const components = readAuthoritativeCapacity(db, { deltaA: 0, deltaB: 0 }).components;
    assert.equal(components.approvedSoCommitmentCents + components.deliveredNotSettledCents + components.arOpenCents,
      obligation, 'the delivered obligation must be represented by exactly one stage');
    assert.equal(components.approvedSoCommitmentCents, 0, 'the fully delivered order leaves the SO commitment stage');
    assertNoDuplicateEffects(db);
  });
});

test('M-R04 / R-SAL-24 — Profile mutation and Credit Check use one complete OLD or NEW hash set', async () => {
  await withWave10Race('w10-r4', { aggregateLimit: 300000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r4-order' });
    const old = db.prepare("SELECT id FROM credit_profile WHERE id='w10-profile-agg'").get(); assert.ok(old);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      { action: 'evaluate', input: creditInput({ orderId: 'w10-r4-order' }) },
      { action: 'profile-create', key: 'w10-r4-profile', body: { customerId: 'w10-race-customer', creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT', creditLimitCents: 250000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A', overdueDayPolicy: '15', effectiveFrom: '2026-12-31' } },
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.ok(outcomes.every((row) => row.status < 500), JSON.stringify(outcomes));
    const rows = db.prepare(`SELECT check_group_id,credit_profile_id,policy_snapshot_fingerprint,profile_effective_state_hash
      FROM credit_check_results WHERE check_group_id IS NOT NULL`).all();
    assert.ok(rows.length > 0, 'the credit check must have written its evidence');
    const groups = new Map();
    for (const row of rows) {
      const key = row.check_group_id;
      const existing = groups.get(key) || { profiles: new Set(), fingerprints: new Set(), hashes: new Set() };
      existing.profiles.add(row.credit_profile_id);
      existing.fingerprints.add(row.policy_snapshot_fingerprint);
      existing.hashes.add(row.profile_effective_state_hash);
      groups.set(key, existing);
    }
    for (const [groupId, set] of groups) {
      assert.equal(set.profiles.size, 1, `${groupId}: the result rows must belong to one complete Profile version`);
      assert.equal(set.fingerprints.size, 1, `${groupId}: the result rows must share one policy snapshot fingerprint`);
      assert.equal(set.hashes.size, 1, `${groupId}: the result rows must share one profile effective-state hash`);
      assert.ok([old.id, ...db.prepare("SELECT id FROM credit_profile WHERE id<>'w10-profile-agg'").all().map((row) => row.id)].includes([...set.profiles][0]));
    }
    assertNoDuplicateEffects(db);
  });
});

test('M-R05 — two salespersons serialize on authoritative aggregate ONLY_ONE_FITS', async () => {
  await withWave10Race('w10-r5', { aggregateLimit: 150000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r5-a', salespersonId: 'w10-race-sp-a' });
    seedSubmittedOrder(db, { id: 'w10-r5-b', salespersonId: 'w10-race-sp-b' });
    const capacity = readAuthoritativeCapacity(db, { deltaA: 100000, deltaB: 100000 });
    assert.equal(capacity.classification, 'ONLY_ONE_FITS');
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [approve('w10-r5-a', 'w10-r5-a'), approve('w10-r5-b', 'w10-r5-b')]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.equal(outcomes.filter(success).length, 1, JSON.stringify(outcomes));
    assertOrderWinners(db, ['w10-r5-a', 'w10-r5-b'], 1);
    // The shared aggregate ceiling is conserved.
    const committed = Number(db.prepare("SELECT COALESCE(SUM(total_cents),0) total FROM sales_orders WHERE id IN ('w10-r5-a','w10-r5-b') AND status='APPROVED'").get().total);
    assert.ok(committed <= capacity.available, `the shared aggregate ceiling must be conserved (${committed} > ${capacity.available})`);
    assertNoDuplicateEffects(db);
  });
});

test('M-R06 — same-salesperson sub-limit is authoritative ONLY_ONE_FITS while aggregate is BOTH_FIT', async () => {
  await withWave10Race('w10-r6', { aggregateLimit: 500000, salespersonLimit: 150000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r6-a' }); seedSubmittedOrder(db, { id: 'w10-r6-b' });
    const aggregate = readAuthoritativeCapacity(db, { deltaA: 100000, deltaB: 100000 });
    const subLimit = readAuthoritativeCapacity(db, { salespersonId: 'w10-race-sp-a', deltaA: 100000, deltaB: 100000 });
    assert.equal(aggregate.classification, 'BOTH_FIT');
    assert.equal(subLimit.classification, 'ONLY_ONE_FITS');
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [approve('w10-r6-a', 'w10-r6-a'), approve('w10-r6-b', 'w10-r6-b')]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.equal(outcomes.filter(success).length, 1, JSON.stringify(outcomes));
    assertOrderWinners(db, ['w10-r6-a', 'w10-r6-b'], 1);
    const committed = Number(db.prepare("SELECT COALESCE(SUM(total_cents),0) total FROM sales_orders WHERE id IN ('w10-r6-a','w10-r6-b') AND status='APPROVED'").get().total);
    assert.ok(committed <= aggregate.available, 'the aggregate ceiling must be conserved');
    assert.ok(committed <= subLimit.available, 'the salesperson sub-limit ceiling must be conserved');
    assertNoDuplicateEffects(db);
  });
});

test('M-R07 — aggregate-scope authority cannot release a mandatory salesperson refusal', async () => {
  await withWave10Race('w10-r7', { aggregateLimit: 500000, salespersonLimit: 50000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r7-order', cents: 100000 });
    // The two scopes must be distinct authoritative rows before the release.
    const scopes = db.prepare(`SELECT id,scope_type,credit_limit_cents FROM credit_profile WHERE customer_id='w10-race-customer'
      ORDER BY salesperson_scope_key`).all();
    assert.equal(scopes.length, 2, 'the aggregate and the salesperson scope must both exist');
    assert.equal(new Set(scopes.map((row) => row.id)).size, 2, 'the two scopes must be distinct rows');
    assert.notEqual(Number(scopes[0].credit_limit_cents), Number(scopes[1].credit_limit_cents));
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [evaluateEndpoint('w10-r7-order'), approve('w10-r7-order', 'w10-r7-approve')]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    const refusals = outcomes.filter((row) => !success(row));
    assert.ok(refusals.length >= 1, JSON.stringify(outcomes));
    for (const refusal of refusals) {
      assert.equal(httpStatus(refusal), 409, JSON.stringify(refusal));
      assert.ok(!FORBIDDEN_RACE_REFUSALS.includes(refusal.code), `forbidden refusal ${refusal.code}`);
    }
    assert.equal(db.prepare("SELECT status FROM sales_orders WHERE id='w10-r7-order'").get().status, 'SUBMITTED');
    const after = captureWave10PersistenceProjection(db);
    assert.deepEqual(after.sales_orders, before.sales_orders);
    assertNoDuplicateEffects(db);
  });
});

test('M-R08 — dual-scope check and Profile mutation retain one coherent version set', async () => {
  await withWave10Race('w10-r8', { aggregateLimit: 500000, salespersonLimit: 200000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r8-order' });
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      { action: 'evaluate', input: creditInput({ orderId: 'w10-r8-order' }) },
      { action: 'profile-create', key: 'w10-r8-profile', body: { customerId: 'w10-race-customer', salespersonId: 'w10-race-sp-a', creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT', creditLimitCents: 180000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A', overdueDayPolicy: '15', effectiveFrom: '2026-12-31' } },
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.ok(outcomes.every((row) => row.status < 500), JSON.stringify(outcomes));
    const groups = db.prepare(`SELECT check_group_id,COUNT(DISTINCT profile_effective_state_hash) hashes,
      COUNT(DISTINCT policy_snapshot_fingerprint) fingerprints,COUNT(*) rows_count
      FROM credit_check_results GROUP BY check_group_id`).all();
    assert.ok(groups.length > 0, 'the credit check must have written its evidence');
    for (const row of groups) {
      assert.equal(Number(row.hashes), 1, 'the aggregate and the salesperson result rows must belong to one coherent version set');
      assert.equal(Number(row.fingerprints), 1, 'the aggregate and the salesperson result rows must share one policy snapshot');
      assert.equal(Number(row.rows_count), 2, 'both applicable scopes must be represented exactly once');
    }
    assertNoDuplicateEffects(db);
  });
});

test('M-R09 — the canonical SO→AR transition stays in the salesperson exposure and blocks the sub-limit', async () => {
  await withWave10Race('w10-r9', { aggregateLimit: 1000000, salespersonLimit: 110000 }, async (db, [a, b, c], registrations) => {
    // The approved order, its confirmed Delivery and the final unpaid AR are
    // all produced by canonical production writers. The Delivery uses the
    // LEGACY_DIRECT billing mode, so the Delivery confirmation itself is the
    // writer that recognizes the Finance exposure.
    const orderId = await canonicalApprovedOrder([a], { key: 'w10-r9-existing' });
    const committed = wave10SalesCommitment(db, orderId);
    assert.equal(committed.status, 'APPROVED');
    const obligation = committed.totalCents;
    const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no,id LIMIT 1').get(orderId).id;
    const delivery = await canonicalDelivery(db, a, {
      orderId, orderItemId, billingMode: 'LEGACY_DIRECT', key: 'w10-r9-existing',
    });
    // The canonical confirmation created the final AR that replaces the
    // delivered obligation.
    const receivable = db.prepare(`SELECT id,source_type,source_id,amount_cents,open_amount_cents,item_class,item_kind,status
      FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?`).get(delivery.deliveryId);
    assert.ok(receivable, 'the canonical delivery confirmation must create the Finance AR');
    assert.equal(Number(receivable.amount_cents), obligation);
    assert.equal(Number(receivable.open_amount_cents), obligation, 'the AR must stay unpaid');
    assert.equal(receivable.item_class, 'SOURCE');
    assert.equal(receivable.item_kind, 'FINAL');
    // The proposed commitment of the new order is a declared reference fact.
    seedSubmittedOrder(db, { id: 'w10-r9-new', cents: 20000 });
    const capacity = readAuthoritativeCapacity(db, { salespersonId: 'w10-race-sp-a', deltaA: 20000, deltaB: 20000 });
    assert.equal(capacity.exposureCents, obligation, 'the transition must leave the obligation in the AR stage');
    assert.equal(capacity.available, capacity.limitCents - obligation);
    assert.equal(capacity.classification, 'ONLY_ONE_FITS', 'the sub-limit classification must be computed from the actual exposure');
    assert.ok(capacity.exposureCents + 20000 > capacity.limitCents, 'the proposal must exceed the sub-limit');
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race([a, b, c], registrations, [
      evaluateEndpoint('w10-r9-new', { proposedDeltaCents: 20000 }),
      evaluateEndpoint('w10-r9-new', { proposedDeltaCents: 20000 }),
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    for (const outcome of outcomes) {
      assert.equal(httpStatus(outcome), 409, JSON.stringify(outcome));
      assert.equal(outcome.code, 'CREDIT_CHECK_BLOCKED', JSON.stringify(outcome));
      assert.ok(outcome.details?.reasonCodes?.includes('OVER_LIMIT'), `the refusal must be OVER_LIMIT: ${JSON.stringify(outcome.details)}`);
      assert.ok(!outcome.details?.reasonCodes?.includes('UNPROVEN_ATTRIBUTION'), 'the AR attribution must stay provable');
    }
    const after = captureWave10PersistenceProjection(db);
    assertWave10ProjectionDeltaEmpty(before, after, 'M-R09 blocked evaluations');
    assertNoDuplicateEffects(db);
  });
});

test('M-R10 — consolidated unproven AR attribution blocks the mandatory sub-limit', async () => {
  await withWave10Race('w10-r10', { aggregateLimit: 1000000, salespersonLimit: 60000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r10-order', cents: 10000 });
    // The unsupported attribution shape is created by the canonical Finance
    // writer. A MANUAL receivable has no Sales source chain, so the aggregate
    // counts it in full while the mandatory sub-limit cannot attribute it.
    const created = await workers[0].run({ action: 'finance-ar-create', key: 'w10-r10-ar', body: {
      customerId: 'w10-race-customer', amountCents: 50000, businessDate: wave10BusinessDate(), reason: 'Wave 10 consolidated AR',
    } });
    assert.equal(httpStatus(created), 200, JSON.stringify(created));
    const before = captureWave10PersistenceProjection(db);
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [
      evaluateEndpoint('w10-r10-order', { proposedDeltaCents: 10000 }),
      evaluateEndpoint('w10-r10-order', { proposedDeltaCents: 10000 }),
    ]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    for (const outcome of outcomes) {
      assert.equal(httpStatus(outcome), 409, JSON.stringify(outcome));
      assert.equal(outcome.code, 'CREDIT_CHECK_BLOCKED', JSON.stringify(outcome));
      assert.ok(outcome.details?.reasonCodes?.includes('UNPROVEN_ATTRIBUTION'), `the refusal must be UNPROVEN_ATTRIBUTION: ${JSON.stringify(outcome.details)}`);
      assert.ok(!outcome.details?.reasonCodes?.includes('OVER_LIMIT'), 'the refusal is an attribution failure, not a capacity failure');
    }
    const after = captureWave10PersistenceProjection(db);
    assertWave10ProjectionDeltaEmpty(before, after, 'M-R10 blocked evaluations');
    assertNoDuplicateEffects(db);
  });
});

test('M-R11 — prepayment-parent composition completes without a lock-order cycle', async () => {
  await withWave10Race('w10-r11', { aggregateLimit: 300000 }, async (db, workers, registrations) => {
    seedSubmittedOrder(db, { id: 'w10-r11-order', cents: 100000 });
    // Declared setup fact: the eligible Finance prepayment parent. The
    // canonical prepayment writer is a Finance settlement flow and is not
    // part of this case's production path.
    db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
      original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
      VALUES('w10-r11-prepay','CUSTOMER','PREPAYMENT','w10-race-customer','MANUAL','w10-r11','W10-R11',50000,
      ?,NULL,'OPEN','w10-race-approver',?)`).run(wave10BusinessDate(), new Date().toISOString());
    const { outcomes, waits } = await runCoordinatedWave10Race(workers, registrations, [approve('w10-r11-order', 'w10-r11-approve'), { action: 'evaluate', input: creditInput({ orderId: 'w10-r11-order' }) }]);
    assert.ok(waits.length >= 2, 'both contenders must be observably pending at the L0 coordination boundary');
    assert.ok(outcomes.every((row) => row.status < 500), JSON.stringify(outcomes));
    assertNoDuplicateEffects(db);
  });
});

test('M-R12 — N independent checks reuse one immutable snapshot without a snapshot-row lock', async () => {
  await withWave10Race('w10-r12', { aggregateLimit: 500000 }, async (db, workers, registrations) => {
    const contenders = workers.slice(0, 3);
    const coordinator = workers[workers.length - 1];
    seedSubmittedOrder(db, { id: 'w10-r12-order', cents: 100000 });
    const first = await contenders[0].run({ action: 'evaluate', input: creditInput({ orderId: 'w10-r12-order' }) });
    assert.equal(first.status, 200);
    const snapshot = db.prepare('SELECT id FROM credit_policy_snapshots ORDER BY id LIMIT 1').get(); assert.ok(snapshot);
    // The snapshot row is locked by an independent holder, so a check that
    // needed that row could not complete while it is held.
    assert.equal((await coordinator.run({ action: 'raw-snapshot-hold', snapshotId: snapshot.id })).held, true);
    const command = { action: 'evaluate', input: creditInput({ orderId: 'w10-r12-order' }) };
    const outcomes = await Promise.all(contenders.map((worker) => worker.run(command, 10_000)));
    await coordinator.run({ action: 'release', rollback: true });
    assert.ok(outcomes.every(success), JSON.stringify(outcomes));
    assert.equal(new Set(outcomes.map((row) => row.outcome.checkGroupId)).size, 1, 'every check must converge on one check group');
    const capacity = readAuthoritativeCapacity(db, { deltaA: 100000, deltaB: 100000 });
    assert.equal(capacity.classification, 'BOTH_FIT');
    assertNoDuplicateEffects(db);
  }, { workerCount: 4 });
});
