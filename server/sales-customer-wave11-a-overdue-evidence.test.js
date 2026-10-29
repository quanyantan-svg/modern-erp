// W11-A OVERDUE Evidence Foundation — forward-only SQLite acceptance.
//
// The frozen Wave 10 and U2 test files remain byte-identical. This independent
// suite proves the additive evidence writer, UNKNOWN compatibility and SC102
// category predicates against the production migration chain and handlers.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { transaction } from './db.js';
import { getCreditException, listCreditExceptions } from './modules/credit-query.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  ADMIN, HISTORICAL, NO_CREDIT, SELF_ACTOR, TODAY, read, readById,
} from './test-utils/wave11-sec-scope-fixture.js';
import {
  SELF_CUSTOMER, SELF_SALESPERSON, databaseDigest, runObservedCreditCheck,
  seedCreditQueryWorld, seedObservedReceivable, shiftCreditDate,
} from './test-utils/wave11-a-credit-query-fixture.js';

let handle;
let db;

beforeEach(async () => {
  handle = createTempDb({ label: 'w11a-overdue', production: true });
  db = handle.db;
  await seedCreditQueryWorld(db);
});

afterEach(() => handle?.cleanup());

function resultRows(checkGroupId) {
  return db.prepare('SELECT * FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type').all(checkGroupId);
}

function evidenceOf(checkGroupId, scopeType) {
  const row = resultRows(checkGroupId).find((item) => item.scope_type === scopeType);
  assert.ok(row, `missing ${scopeType}`);
  return JSON.parse(row.component_breakdown_json).overdueEvidence;
}

function updateDueDate(dueDate) {
  db.prepare("UPDATE account_receivables SET due_date=? WHERE id='ar-w11-overdue'").run(dueDate);
}

test('E-01 due-date and grace boundaries produce exact aggregate/sub-limit evidence', () => {
  seedObservedReceivable(db, { dueDate: TODAY });
  const boundary = runObservedCreditCheck(db, { authorizationContext: 'e01-due-date' });
  assert.equal(evidenceOf(boundary.checkGroupId, 'CUSTOMER_AGGREGATE').status, 'PROVEN_NOT_OVERDUE');
  assert.equal(evidenceOf(boundary.checkGroupId, 'SALESPERSON_SUB_LIMIT').status, 'PROVEN_NOT_OVERDUE');

  updateDueDate(shiftCreditDate(TODAY, -15));
  const graceBoundary = runObservedCreditCheck(db, { authorizationContext: 'e01-grace-boundary' });
  assert.equal(evidenceOf(graceBoundary.checkGroupId, 'CUSTOMER_AGGREGATE').status, 'PROVEN_OVERDUE');
  assert.equal(evidenceOf(graceBoundary.checkGroupId, 'SALESPERSON_SUB_LIMIT').status, 'PROVEN_NOT_OVERDUE');

  updateDueDate(shiftCreditDate(TODAY, -16));
  const overdue = runObservedCreditCheck(db, { authorizationContext: 'e01-overdue' });
  const aggregate = evidenceOf(overdue.checkGroupId, 'CUSTOMER_AGGREGATE');
  const subLimit = evidenceOf(overdue.checkGroupId, 'SALESPERSON_SUB_LIMIT');
  assert.deepEqual([aggregate.status, aggregate.overdueOpenAmountCents], ['PROVEN_OVERDUE', 100000]);
  assert.deepEqual([subLimit.status, subLimit.overdueOpenAmountCents], ['PROVEN_OVERDUE', 100000]);
  assert.equal(aggregate.evidenceVersion, 'CREDIT_OVERDUE_EVIDENCE_V1');
  assert.match(aggregate.evidenceDigest, /^[0-9a-f]{64}$/);
  assert.equal(aggregate.sourceFacts[0].openItemId, 'ar-w11-overdue');
});

test('E-02 current Finance changes create new evidence while old Results remain immutable', () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  const first = runObservedCreditCheck(db, { authorizationContext: 'e02-open' });
  const firstJson = db.prepare("SELECT component_breakdown_json value FROM credit_check_results WHERE check_group_id=? AND scope_type='CUSTOMER_AGGREGATE'")
    .get(first.checkGroupId).value;

  // Fixture mutations model the reconciled canonical header after confirmed
  // partial settlement, full settlement and a later authorized reversal. The
  // production writer remains the sole owner outside this disposable test DB.
  db.prepare("UPDATE account_receivables SET paid_cents=60000,open_amount_cents=40000,status='PARTIAL' WHERE id='ar-w11-overdue'").run();
  const partial = runObservedCreditCheck(db, { authorizationContext: 'e02-partial' });
  assert.equal(evidenceOf(partial.checkGroupId, 'CUSTOMER_AGGREGATE').overdueOpenAmountCents, 40000);

  db.prepare("UPDATE account_receivables SET paid_cents=100000,open_amount_cents=0,status='COMPLETED' WHERE id='ar-w11-overdue'").run();
  const settled = runObservedCreditCheck(db, { authorizationContext: 'e02-settled' });
  assert.equal(evidenceOf(settled.checkGroupId, 'CUSTOMER_AGGREGATE').status, 'PROVEN_NOT_OVERDUE');

  db.prepare("UPDATE account_receivables SET paid_cents=0,open_amount_cents=100000,status='PENDING' WHERE id='ar-w11-overdue'").run();
  const reversed = runObservedCreditCheck(db, { authorizationContext: 'e02-reversed' });
  assert.equal(evidenceOf(reversed.checkGroupId, 'CUSTOMER_AGGREGATE').overdueOpenAmountCents, 100000);
  assert.equal(db.prepare("SELECT component_breakdown_json value FROM credit_check_results WHERE check_group_id=? AND scope_type='CUSTOMER_AGGREGATE'")
    .get(first.checkGroupId).value, firstJson, 'the first historical evidence must stay byte-identical');
});

test('E-03 attribution, missing due date and missing sub-limit policy stay explicit', () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,
      write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,item_class,
      recognition_mode,item_kind,conversion_state)
    VALUES('ar-w11-unknown','AR-W11-UNKNOWN',?,'MANUAL','manual-w11',50000,0,0,'PENDING','',?, ?,?,?,50000,
      'SOURCE','DIRECT_BUSINESS_OPEN_ITEM','FINAL','OPEN')`)
    .run(SELF_CUSTOMER, ADMIN.id, now, TODAY, now);
  const mixed = runObservedCreditCheck(db, { authorizationContext: 'e03-mixed' });
  const aggregate = evidenceOf(mixed.checkGroupId, 'CUSTOMER_AGGREGATE');
  const subLimit = evidenceOf(mixed.checkGroupId, 'SALESPERSON_SUB_LIMIT');
  assert.deepEqual([aggregate.status, aggregate.completeness], ['PROVEN_OVERDUE', 'PARTIAL']);
  assert.deepEqual([subLimit.status, subLimit.completeness], ['PROVEN_OVERDUE', 'PARTIAL']);
  assert.equal(aggregate.unknownSourceCount, 1);

  db.prepare("UPDATE credit_profile SET overdue_day_policy=NULL WHERE salesperson_scope_key=?").run(SELF_SALESPERSON);
  db.prepare("DELETE FROM credit_parameters WHERE code='CREDIT_SUB_LIMIT_OVERDUE_DAYS'").run();
  const noPolicy = runObservedCreditCheck(db, { authorizationContext: 'e03-no-policy' });
  assert.equal(evidenceOf(noPolicy.checkGroupId, 'SALESPERSON_SUB_LIMIT').gracePolicy.source, 'UNDEFINED');
  assert.equal(evidenceOf(noPolicy.checkGroupId, 'SALESPERSON_SUB_LIMIT').completeness, 'PARTIAL');
});

test('E-04 a backdated businessDate cannot turn current open amount into historical proof', () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(HISTORICAL, -20), businessDate: HISTORICAL });
  const historical = runObservedCreditCheck(db, {
    businessDate: HISTORICAL,
    authorizationContext: 'e04-backdated',
  });
  for (const scopeType of ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']) {
    const evidence = evidenceOf(historical.checkGroupId, scopeType);
    assert.equal(evidence.status, 'UNKNOWN');
    assert.equal(evidence.completeness, 'PARTIAL');
    assert.equal(evidence.overdueOpenAmountCents, 0);
  }
});

test('E-05 exact replay preserves evidence and rollback leaves no partial Result', () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  const first = runObservedCreditCheck(db, { authorizationContext: 'e05-replay' });
  const before = resultRows(first.checkGroupId).map((row) => row.component_breakdown_json);
  const replay = runObservedCreditCheck(db, { authorizationContext: 'e05-replay' });
  assert.equal(replay.replayed, true);
  assert.deepEqual(resultRows(first.checkGroupId).map((row) => row.component_breakdown_json), before);

  const countBefore = db.prepare('SELECT COUNT(*) count FROM credit_check_results').get().count;
  assert.throws(() => transaction(db, () => {
    runObservedCreditCheck(db, { authorizationContext: 'e05-rollback', proposedDeltaCents: 1 });
    throw new Error('ROLLBACK_PROBE');
  }), /ROLLBACK_PROBE/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM credit_check_results').get().count, countBefore);
});

test('E-06 five server categories are exact, overlapping and invalid input is deterministic', async () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  runObservedCreditCheck(db, { authorizationContext: 'e06-categories', proposedDeltaCents: 200000 });
  const overdue = await read(listCreditExceptions, db, ADMIN, { category: 'OVERDUE' });
  assert.equal(overdue.statusCode, 200);
  assert.ok(overdue.body.total >= 1);
  assert.ok(overdue.body.exceptions.every((row) => row.categories.includes('OVERDUE')));
  assert.ok(overdue.body.exceptions.every((row) => !row.recordedBreakdown.overdueEvidence.sourceFacts));

  for (const category of ['OVER_LIMIT', 'WARNING', 'BLOCK', 'SPECIAL_APPROVAL']) {
    const result = await read(listCreditExceptions, db, ADMIN, { category });
    assert.equal(result.statusCode, 200, category);
    assert.ok(result.body.exceptions.every((row) => row.categories.includes(category)), category);
  }
  const invalid = await read(listCreditExceptions, db, ADMIN, { category: 'OVERDUE_POLICY_UNDEFINED' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.code, 'CREDIT_QUERY_INVALID_INPUT');
});

test('E-07 category COUNT/pagination share authorization and GET remains zero-write', async () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  runObservedCreditCheck(db, { authorizationContext: 'e07-page-a' });
  runObservedCreditCheck(db, { authorizationContext: 'e07-page-b', proposedDeltaCents: 1 });
  const before = databaseDigest(db);
  const all = await read(listCreditExceptions, db, ADMIN, { category: 'OVERDUE', limit: 1, offset: 0 });
  const next = await read(listCreditExceptions, db, ADMIN, { category: 'OVERDUE', limit: 1, offset: 1 });
  assert.ok(all.body.total >= 2);
  assert.equal(all.body.total, next.body.total);
  assert.notEqual(all.body.exceptions[0].checkResultId, next.body.exceptions[0].checkResultId);
  const self = await read(listCreditExceptions, db, SELF_ACTOR, { category: 'OVERDUE' });
  assert.ok(self.body.total <= all.body.total);
  const denied = await read(listCreditExceptions, db, NO_CREDIT, { category: 'OVERDUE' });
  assert.equal(denied.statusCode, 403);
  assert.equal(databaseDigest(db), before, 'category GETs must be zero-write');
});

test('E-08 old rows are UNKNOWN, malformed new evidence fails closed, and detail stays non-enumerable', async () => {
  const oldRow = db.prepare('SELECT id,component_breakdown_json FROM credit_check_results ORDER BY id LIMIT 1').get();
  const oldBreakdown = JSON.parse(oldRow.component_breakdown_json);
  delete oldBreakdown.overdueEvidence;
  db.prepare('UPDATE credit_check_results SET component_breakdown_json=? WHERE id=?')
    .run(JSON.stringify(oldBreakdown), oldRow.id);
  const old = await read(listCreditExceptions, db, ADMIN, { limit: 200 });
  assert.ok(old.body.exceptions.some((row) => row.overdueEvidence.status === 'UNKNOWN'
    && row.overdueEvidence.reason === 'EVIDENCE_NOT_CAPTURED'));

  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });
  const check = runObservedCreditCheck(db, { authorizationContext: 'e08-invalid' });
  const row = resultRows(check.checkGroupId)[0];
  const breakdown = JSON.parse(row.component_breakdown_json);
  breakdown.overdueEvidence.evidenceVersion = 'CREDIT_OVERDUE_EVIDENCE_BROKEN';
  db.prepare('UPDATE credit_check_results SET component_breakdown_json=? WHERE id=?')
    .run(JSON.stringify(breakdown), row.id);
  const invalid = await readById(getCreditException, db, ADMIN, row.id);
  assert.equal(invalid.statusCode, 500);
  assert.equal(invalid.code, 'CREDIT_OVERDUE_EVIDENCE_INVALID');
  const hidden = await readById(getCreditException, db, SELF_ACTOR, 'does-not-exist');
  assert.equal(hidden.statusCode, 404);
  assert.equal(hidden.code, 'CREDIT_EXCEPTION_NOT_FOUND');
});

test('E-09 UTC-date mismatch and illegal monetary observations degrade to UNKNOWN', () => {
  seedObservedReceivable(db, { dueDate: shiftCreditDate(TODAY, -20) });

  const future = runObservedCreditCheck(db, {
    businessDate: shiftCreditDate(TODAY, 1),
    authorizationContext: 'e09-next-utc-day',
  });
  assert.equal(evidenceOf(future.checkGroupId, 'CUSTOMER_AGGREGATE').status, 'UNKNOWN');

  db.prepare("UPDATE account_receivables SET open_amount_cents=-1 WHERE id='ar-w11-overdue'").run();
  const negative = runObservedCreditCheck(db, { authorizationContext: 'e09-negative' });
  const negativeEvidence = evidenceOf(negative.checkGroupId, 'CUSTOMER_AGGREGATE');
  assert.equal(negativeEvidence.status, 'UNKNOWN');
  assert.equal(negativeEvidence.sourceFacts[0].observedOpenAmountCents, -1);

  db.prepare("UPDATE account_receivables SET open_amount_cents=9007199254740992 WHERE id='ar-w11-overdue'").run();
  const unsafe = runObservedCreditCheck(db, { authorizationContext: 'e09-unsafe' });
  const unsafeEvidence = evidenceOf(unsafe.checkGroupId, 'CUSTOMER_AGGREGATE');
  assert.equal(unsafeEvidence.status, 'UNKNOWN');
  assert.equal(unsafeEvidence.sourceFacts[0].observedOpenAmountCents, null);
});
