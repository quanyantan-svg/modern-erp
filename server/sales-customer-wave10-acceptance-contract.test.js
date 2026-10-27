// Wave 10 acceptance-contract regressions (§37.49.7 AC-01..AC-11).
//
// The protected MySQL acceptance suites cannot run in a local gate, so every
// correction of the Wave 10 acceptance contract must be provable here, on the
// engine-neutral SQLite backend, without a MySQL server.
//
// Each case proves one thing:
//   AC-01 / AC-08  the negative reproduction of the two original defects —
//                  the old "delete the referenced rule" setup and the old
//                  "non-canonical anchor" setup are both refuted;
//   AC-02..AC-04  the corrected no-rule state produces the engine's
//                  non-enforced outcome, zero evidence, an intact referential
//                  contract, and a path that is provably distinct from the
//                  other-mode path and from the disabled path;
//   AC-05..AC-07  the date derivation is valid on every required cross-year
//                  business date, the old literal is refused by the production
//                  gate exactly where it must be, and the request and the
//                  decision carry one and the same expiry;
//   AC-09 / AC-10 the canonical anchor makes the production predecessor
//                  closure work, and the fixture no longer maintains a second
//                  anchor-key format;
//   AC-11         the approved Credit schema contracts are untouched.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { transaction } from './db.js';
import { creditObjectAnchorKey } from './modules/credit-anchor.js';
import { evaluateCredit } from './modules/credit-check.js';
import { createCreditProfile, resolveEffectiveCreditProfile } from './modules/credit-profile.js';
import { decideCreditSpecialApproval, requestCreditSpecialApproval } from './modules/credit-special-approval.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  creditInput, seedSubmittedOrder, seedWave10AcceptanceBase, wave10BusinessDate,
  wave10FutureBusinessDateFrom,
} from './test-utils/wave10-mysql-acceptance-fixture.js';
import { createTempDb } from './test-utils/temp-db.js';

const REQUESTER = Object.freeze({
  id: 'w10-race-creator', roleCode: 'ADMIN',
  permissions: ['CREDIT_SPECIAL_APPROVE'],
});
const APPROVER = Object.freeze({
  id: 'w10-race-approver', roleCode: 'ADMIN',
  permissions: ['CREDIT_SPECIAL_APPROVE', 'CREDIT_MANAGE', 'CREDIT_VIEW'],
});

// The four business dates the corrected derivation must survive.
const CROSS_YEAR_BASES = Object.freeze([
  ['2026-10-27', '2027-04-27'],
  ['2026-12-31', '2027-06-30'],
  ['2027-01-01', '2027-07-01'],
  ['2028-02-29', '2028-08-29'],
]);
// The hard-coded expiry the old suites carried. The production gate refuses a
// strictly earlier expiry, so this literal is only legal up to its own date.
const OLD_EXPIRY_LITERAL = '2026-12-31';
const OLD_LITERAL_ACCEPTED_BASES = Object.freeze(['2026-10-27', '2026-12-31']);

const AGGREGATE_SCOPE = { customerId: 'w10-race-customer', salespersonId: null, creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT' };
const SALESPERSON_SCOPE = { customerId: 'w10-race-customer', salespersonId: 'w10-race-sp-a', creditObjectType: 'SALES_ORDER', creditObjectId: 'W10-RACE-OBJECT' };

function response() {
  return { statusCode: null, body: null, setHeader() {}, end(value) { this.body = value ? JSON.parse(value) : null; } };
}

function request(body, key) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

async function invoke(handler, db, body, actor, key, ...tail) {
  const res = response();
  await handler(db, request(body, key), res, actor, ...tail);
  return res;
}

async function invokeFailure(handler, db, body, actor, key, ...tail) {
  try {
    const res = await invoke(handler, db, body, actor, key, ...tail);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status ?? null, body: null, code: error.code ?? null, error };
  }
}

// Every case gets its own disposable SQLite database in production mode, the
// same initialization mode the protected target uses.
async function withContractDb(label, options, body) {
  const handle = createTempDb({ label, production: true });
  try {
    const db = handle.db;
    migrateSalesCustomerDomain(db);
    await seedWave10AcceptanceBase(db, options);
    return await body(db);
  } finally {
    handle.cleanup();
  }
}

function runCheck(db, orderId, businessDate, recognitionMode = 'DIRECT_BUSINESS_OPEN_ITEM') {
  let outcome;
  transaction(db, () => {
    outcome = evaluateCredit(db, creditInput({ orderId, stage: 'SO_SUBMIT', proposedDeltaCents: 100000, businessDate, recognitionMode }));
  });
  return outcome;
}

// The engine's own applicability predicate, applied to the seeded rows. It is
// the only way to prove which filter emptied the applicable rule set.
function effectiveRuleCount(db, stage, businessDate) {
  return db.prepare(`SELECT COUNT(*) count FROM credit_check_rules WHERE business_stage=? AND status='ACTIVE'
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).get(stage, businessDate, businessDate).count;
}

function evidenceCounts(db) {
  return {
    results: db.prepare('SELECT COUNT(*) count FROM credit_check_results').get().count,
    snapshots: db.prepare('SELECT COUNT(*) count FROM credit_policy_snapshots').get().count,
    audits: db.prepare('SELECT COUNT(*) count FROM audit_logs').get().count,
    idempotency: db.prepare('SELECT COUNT(*) count FROM idempotency_records').get().count,
  };
}

function specialApprovalResult(db, checkGroupId) {
  return db.prepare("SELECT id,business_date FROM credit_check_results WHERE check_group_id=? AND decision='SPECIAL_APPROVAL_REQUIRED' ORDER BY id LIMIT 1")
    .get(checkGroupId);
}

// AC-01 — the negative reproduction of CB-1: the old setup deleted the rule
// row that the Profile still references, and the database refuses it.
test('AC-01 — the referenced Credit Rule cannot be deleted: the foreign key refuses it', async () => {
  await withContractDb('w10-ac-01', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, async (db) => {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_check_rules WHERE id='w10-race-rule'").get().count, 1);
    assert.throws(
      () => db.prepare("DELETE FROM credit_check_rules WHERE id='w10-race-rule'").run(),
      (error) => /FOREIGN KEY/i.test(String(error.message)),
      'the referenced rule must be refused by the foreign key',
    );
    assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_check_rules WHERE id='w10-race-rule'").get().count, 1,
      'the rule fact must survive the refused delete');
  });
});

// AC-02 — the corrected no-rule state: the engine's non-enforced outcome and
// no evidence at all.
test('AC-02 — the not-yet-effective rule yields the unenforced outcome and zero evidence', async () => {
  const businessDate = wave10BusinessDate();
  await withContractDb('w10-ac-02', { aggregateLimit: 50000, stage: 'SO_SUBMIT', ruleMode: 'NOT_YET_EFFECTIVE' }, async (db) => {
    seedSubmittedOrder(db, { id: 'ac02-order', status: 'DRAFT' });
    const before = evidenceCounts(db);
    const outcome = runCheck(db, 'ac02-order', businessDate);
    assert.equal(outcome.enforced, false);
    assert.equal(outcome.decision, 'PASS');
    assert.deepEqual(outcome.reasonCodes, ['NO_APPLICABLE_EFFECTIVE_RULE']);
    assert.equal(outcome.checkGroupId, null);
    assert.deepEqual(evidenceCounts(db), before, 'the evaluation must write no evidence at all');
    assert.equal(before.results, 0, 'no Credit Check result may exist');
    assert.equal(before.snapshots, 0, 'no policy snapshot may exist');
  });
});

// AC-03 — the rule fact stays real, dated, status-bearing and referenced.
test('AC-03 — the rule fact stays real, dated, status-bearing and referenced', async () => {
  const businessDate = wave10BusinessDate();
  await withContractDb('w10-ac-03', { aggregateLimit: 50000, stage: 'SO_SUBMIT', ruleMode: 'NOT_YET_EFFECTIVE' }, async (db) => {
    const rule = db.prepare("SELECT * FROM credit_check_rules WHERE id='w10-race-rule'").get();
    assert.ok(rule, 'the rule fact must exist');
    assert.equal(rule.rule_code, 'W10_RACE_RULE');
    assert.equal(rule.business_stage, 'SO_SUBMIT');
    assert.equal(rule.scenario, 'BLOCK');
    assert.equal(rule.control_strength, 'BLOCK');
    assert.equal(rule.credit_item, 'ORDER_EXPOSURE');
    assert.equal(rule.check_timing, 'BEFORE_WRITE');
    assert.equal(rule.status, 'ACTIVE');
    assert.equal(rule.effective_to, null);
    assert.equal(rule.created_by, 'w10-race-approver');
    assert.ok(rule.effective_from > businessDate, `the rule must not be effective on ${businessDate}`);
    const profile = db.prepare("SELECT rule_id FROM credit_profile WHERE id='w10-profile-agg'").get();
    assert.equal(profile.rule_id, 'w10-race-rule');
    assert.ok(db.prepare('SELECT id FROM credit_check_rules WHERE id=?').get(profile.rule_id),
      'the Profile reference must still resolve to an existing rule row');
  });
});

// AC-04 — the three unenforced paths are reached through different gates.
test('AC-04 — the three unenforced paths are reached through different gates', async () => {
  const businessDate = wave10BusinessDate();
  // (a) the no-rule path: the rule set offers no effective rule for this
  //     stage on this business date.
  await withContractDb('w10-ac-04a', { aggregateLimit: 50000, stage: 'SO_SUBMIT', ruleMode: 'NOT_YET_EFFECTIVE' }, async (db) => {
    seedSubmittedOrder(db, { id: 'ac04a-order', status: 'DRAFT' });
    assert.equal(effectiveRuleCount(db, 'SO_SUBMIT', businessDate), 0,
      'the no-rule state must offer no effective rule for the stage and the date');
    assert.deepEqual(runCheck(db, 'ac04a-order', businessDate).reasonCodes, ['NO_APPLICABLE_EFFECTIVE_RULE']);
  });
  // (b) the other-mode path: the rule IS offered for the stage and the date,
  //     and only the recognition-mode filter empties the applicable set.
  await withContractDb('w10-ac-04b', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, async (db) => {
    db.prepare("UPDATE credit_check_rules SET recognition_mode='INVOICE_DRIVEN_OPEN_ITEM' WHERE id='w10-race-rule'").run();
    seedSubmittedOrder(db, { id: 'ac04b-order', status: 'DRAFT' });
    assert.equal(effectiveRuleCount(db, 'SO_SUBMIT', businessDate), 1,
      'the other-mode state must still offer the rule for the stage and the date');
    assert.deepEqual(runCheck(db, 'ac04b-order', businessDate, 'DIRECT_BUSINESS_OPEN_ITEM').reasonCodes,
      ['NO_APPLICABLE_EFFECTIVE_RULE']);
  });
  // (c) the switch path is a third, earlier gate.
  await withContractDb('w10-ac-04c', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, async (db) => {
    db.prepare("UPDATE credit_parameters SET value_bool=0 WHERE code='CREDIT_MANAGEMENT_ENABLED'").run();
    seedSubmittedOrder(db, { id: 'ac04c-order', status: 'DRAFT' });
    assert.equal(effectiveRuleCount(db, 'SO_SUBMIT', businessDate), 1,
      'the disabled state must still offer the rule');
    assert.deepEqual(runCheck(db, 'ac04c-order', businessDate).reasonCodes, ['CREDIT_MANAGEMENT_DISABLED']);
  });
});

// AC-05 — the derived expiry is valid on every required cross-year business
// date, and the production gate accepts it.
test('AC-05 — the derived expiry is valid on every required cross-year business date', async () => {
  for (const [base, expected] of CROSS_YEAR_BASES) {
    const expiry = wave10FutureBusinessDateFrom(base);
    assert.equal(expiry, expected, `${base} must derive ${expected}`);
    assert.ok(expiry > base, `${expiry} must be strictly later than ${base}`);
  }
  await withContractDb('w10-ac-05', {
    aggregateLimit: 50000, stage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING',
  }, async (db) => {
    for (const [base] of CROSS_YEAR_BASES) {
      const expiry = wave10FutureBusinessDateFrom(base);
      seedSubmittedOrder(db, { id: `ac05-${base}-order`, status: 'DRAFT' });
      const outcome = runCheck(db, `ac05-${base}-order`, base);
      assert.equal(outcome.decision, 'SPECIAL_APPROVAL_REQUIRED');
      const result = specialApprovalResult(db, outcome.checkGroupId);
      assert.ok(result, `a source result must exist for ${base}`);
      assert.equal(result.business_date, base, 'the source result must carry the controlled business date');
      const res = await invoke(requestCreditSpecialApproval, db, {
        sourceCreditCheckResultId: result.id, reason: `AC-05 ${base}`, requestedOverrideCents: 50000,
        requestedCeilingCents: 100000, requestedExpiryBusinessDate: expiry, scopeMode: 'ONE_TIME',
      }, REQUESTER, `ac05-request-${base}`);
      assert.equal(res.statusCode, 201,
        `the production gate must accept the derived expiry for ${base}: ${JSON.stringify(res.body)}`);
    }
  });
});

// AC-06 — the negative reproduction of CB-2: the old hard-coded expiry is
// refused by the production gate exactly where it must be.
test('AC-06 — the old hard-coded expiry is refused by the production gate for the later bases', async () => {
  await withContractDb('w10-ac-06', {
    aggregateLimit: 50000, stage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING',
  }, async (db) => {
    for (const [base] of CROSS_YEAR_BASES) {
      seedSubmittedOrder(db, { id: `ac06-${base}-order`, status: 'DRAFT' });
      const outcome = runCheck(db, `ac06-${base}-order`, base);
      const result = specialApprovalResult(db, outcome.checkGroupId);
      assert.ok(result, `a source result must exist for ${base}`);
      const outcomeOfRequest = await invokeFailure(requestCreditSpecialApproval, db, {
        sourceCreditCheckResultId: result.id, reason: `AC-06 ${base}`, requestedOverrideCents: 50000,
        requestedCeilingCents: 100000, requestedExpiryBusinessDate: OLD_EXPIRY_LITERAL, scopeMode: 'ONE_TIME',
      }, REQUESTER, `ac06-request-${base}`);
      if (OLD_LITERAL_ACCEPTED_BASES.includes(base)) {
        assert.equal(outcomeOfRequest.code, null,
          `the old literal must still be accepted for ${base}: ${outcomeOfRequest.error?.message}`);
      } else {
        assert.equal(outcomeOfRequest.code, 'CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST',
          `the old literal must be refused for ${base}`);
      }
    }
  });
});

// AC-07 — the request and the decision carry one and the same expiry, and the
// approval keeps it as a live, bounded business attribute.
test('AC-07 — the request and the decision carry one and the same expiry', async () => {
  const businessDate = wave10BusinessDate();
  const expiry = wave10FutureBusinessDateFrom(businessDate);
  await withContractDb('w10-ac-07', {
    aggregateLimit: 50000, stage: 'SO_SUBMIT', scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING',
  }, async (db) => {
    seedSubmittedOrder(db, { id: 'ac07-order', status: 'DRAFT' });
    const outcome = runCheck(db, 'ac07-order', businessDate);
    const result = specialApprovalResult(db, outcome.checkGroupId);
    assert.ok(result);
    const requested = await invoke(requestCreditSpecialApproval, db, {
      sourceCreditCheckResultId: result.id, reason: 'AC-07', requestedOverrideCents: 50000,
      requestedCeilingCents: 100000, requestedExpiryBusinessDate: expiry, scopeMode: 'ONE_TIME',
    }, REQUESTER, 'ac07-request');
    assert.equal(requested.statusCode, 201, JSON.stringify(requested.body));
    assert.equal(requested.body.approval.requestedExpiryBusinessDate, expiry);
    const approvalId = requested.body.approval.id;
    const decided = await invoke(decideCreditSpecialApproval, db, {
      decision: 'APPROVED', approvedOverrideCents: 50000, approvedCeilingCents: 100000,
      approvedExpiryBusinessDate: expiry, reason: 'bounded',
    }, APPROVER, 'ac07-decide', approvalId);
    assert.equal(decided.statusCode, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.approval.requestedExpiryBusinessDate, expiry);
    assert.equal(decided.body.approval.approvedExpiryBusinessDate, expiry);
    const stored = db.prepare('SELECT requested_expiry_business_date,approved_expiry_business_date,decision FROM credit_special_approval WHERE id=?')
      .get(approvalId);
    assert.equal(stored.requested_expiry_business_date, expiry);
    assert.equal(stored.approved_expiry_business_date, expiry);
    assert.equal(stored.decision, 'APPROVED');
    assert.ok(stored.approved_expiry_business_date > businessDate,
      'the expiry must remain a bounded date later than the business date');
  });
});

// AC-08 — the negative reproduction of CB-3: with the old non-canonical anchor
// the production writer provisions a second anchor, the predecessor is never
// closed and the resolution becomes ambiguous.
test('AC-08 — the old non-canonical anchor leaves the predecessor open and the resolution ambiguous', async () => {
  const now = new Date().toISOString();
  await withContractDb('w10-ac-08', { aggregateLimit: 50000, salespersonLimit: 50000 }, async (db) => {
    db.prepare("DELETE FROM credit_profile WHERE id='w10-profile-a'").run();
    db.prepare("DELETE FROM credit_lock_anchors WHERE id='w10-anchor-a'").run();
    db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,credit_object_type,
      credit_object_id,policy_scope_type,policy_scope_id,created_at)
      VALUES('w10-anchor-a','CREDIT_OBJECT|SALES_ORDER|W10-RACE-OBJECT|CUSTOMER|w10-race-customer|SCOPE:w10-race-sp-a',
      'CREDIT_OBJECT','w10-race-customer','w10-race-sp-a','SALES_ORDER','W10-RACE-OBJECT',NULL,NULL,?)`).run(now);
    db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,
      credit_object_id,credit_limit_cents,initial_state,status,rating_grade,overdue_day_policy,rule_id,effective_from,created_at,created_by)
      VALUES('w10-profile-a','w10-anchor-a','w10-race-customer','w10-race-sp-a','w10-race-sp-a','SALES_ORDER','W10-RACE-OBJECT',
      200000,'NORMAL','ACTIVE','A','15','w10-race-rule','2026-01-01',?,'w10-race-approver')`).run(now);
    const created = await invoke(createCreditProfile, db, {
      ...SALESPERSON_SCOPE, creditLimitCents: 180000, initialState: 'NORMAL', status: 'ACTIVE',
      ratingGrade: 'A', overdueDayPolicy: '15', effectiveFrom: '2026-12-31',
    }, APPROVER, 'ac08-create');
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_lock_anchors WHERE customer_id='w10-race-customer' AND salesperson_id='w10-race-sp-a'").get().count, 2,
      'the old anchor must make the production writer provision a second anchor');
    const predecessor = db.prepare("SELECT effective_to FROM credit_profile WHERE id='w10-profile-a'").get();
    assert.equal(predecessor.effective_to, null, 'the old anchor must leave the predecessor open');
    let failure = null;
    try {
      resolveEffectiveCreditProfile(db, { ...SALESPERSON_SCOPE, businessDate: '2026-12-31' });
    } catch (error) { failure = error; }
    assert.ok(failure, 'the old anchor must make the resolution ambiguous');
    assert.equal(failure.code, 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS');
  });
});

// AC-09 — the canonical anchor makes the production predecessor closure work
// and both sides of the version boundary resolve to their own version.
test('AC-09 — the canonical anchor closes the predecessor and resolves both sides of the boundary', async () => {
  await withContractDb('w10-ac-09', { aggregateLimit: 50000, salespersonLimit: 50000 }, async (db) => {
    const created = await invoke(createCreditProfile, db, {
      ...SALESPERSON_SCOPE, creditLimitCents: 180000, initialState: 'NORMAL', status: 'ACTIVE',
      ratingGrade: 'A', overdueDayPolicy: '15', effectiveFrom: '2026-12-31',
    }, APPROVER, 'ac09-create');
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_lock_anchors WHERE customer_id='w10-race-customer' AND salesperson_id='w10-race-sp-a'").get().count, 1,
      'the canonical anchor must be reused, not duplicated');
    const predecessor = db.prepare("SELECT effective_from,effective_to FROM credit_profile WHERE id='w10-profile-a'").get();
    assert.equal(predecessor.effective_from, '2026-01-01');
    assert.equal(predecessor.effective_to, '2026-12-30',
      'the predecessor effective window must be closed to the day before the new version');
    const at = (businessDate) => resolveEffectiveCreditProfile(db, { ...SALESPERSON_SCOPE, businessDate });
    assert.equal(at('2026-12-30').id, 'w10-profile-a', 'the old version must resolve before the boundary');
    assert.equal(at('2026-12-31').id, created.body.profile.id, 'the new version must resolve on the boundary');
    assert.equal(at('2027-01-01').id, created.body.profile.id, 'the new version must stay effective after the boundary');
  });
});

// AC-10 — the fixture's seeded anchor keys are the production ones.
test('AC-10 — the fixture seeds the production anchor identity for both scopes', async () => {
  await withContractDb('w10-ac-10', { aggregateLimit: 50000, salespersonLimit: 50000 }, async (db) => {
    const aggregate = db.prepare("SELECT anchor_key FROM credit_lock_anchors WHERE id='w10-anchor-agg'").get().anchor_key;
    const salesperson = db.prepare("SELECT anchor_key FROM credit_lock_anchors WHERE id='w10-anchor-a'").get().anchor_key;
    assert.equal(aggregate, creditObjectAnchorKey(AGGREGATE_SCOPE));
    assert.equal(salesperson, creditObjectAnchorKey(SALESPERSON_SCOPE));
    assert.equal(aggregate, 'CREDIT_OBJECT|SALES_ORDER|W10-RACE-OBJECT|CUSTOMER|w10-race-customer|SCOPE:AGGREGATE',
      'the aggregate anchor key must stay byte-identical');
    assert.equal(salesperson, 'CREDIT_OBJECT|SALES_ORDER|W10-RACE-OBJECT|CUSTOMER|w10-race-customer|SCOPE:SALESPERSON|w10-race-sp-a',
      'the salesperson anchor key must carry the production scope form');
  });
});

// AC-11 — the approved Credit schema contracts are untouched.
test('AC-11 — the eight approved Credit tables keep their approved CHECK cardinality', async () => {
  const approved = Object.freeze({
    credit_lock_anchors: 2, credit_parameters: 2, credit_check_rules: 5, credit_profile: 3,
    credit_policy_snapshots: 1, credit_profile_ratings: 3, credit_check_results: 3, credit_special_approval: 4,
  });
  await withContractDb('w10-ac-11', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, async (db) => {
    let total = 0;
    for (const [table, count] of Object.entries(approved)) {
      const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql ?? '';
      const actual = (ddl.match(/\bCHECK\s*\(/gi) || []).length;
      assert.equal(actual, count, `${table}: the approved CHECK cardinality must not change`);
      total += actual;
    }
    assert.equal(total, 23, 'the approved Credit schema keeps exactly 23 CHECK constraints');
  });
});
