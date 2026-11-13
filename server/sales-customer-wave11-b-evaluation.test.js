// Wave 11-B / W11-C — Credit Evaluation Foundation, bounded multi-scorer and
// rating application (SC103–SC107).
//
// solution.md §37.54.9 / §37.54.10 / §37.54.12; document.md Stage B §6.4 /
// §6.5 (R103-1..R107-9), UAT-S-36.
//
// EVIDENCE LEVEL. Every assertion in this file runs on a single SQLite
// connection against the production migration chain and the production
// writers. It proves the control flow, the dialect intent and the business
// arithmetic. It is NOT real-MySQL row-contention evidence: the W11-R1 /
// W11-R2 independent-session races stay BLOCKED for the protected MySQL
// campaign and must never be reported as PASS from this file.
//
// THE HAND-COMPUTED EXPECTATION. The scoring arithmetic is asserted against
// an integer that was computed BY HAND from the §37.54.9.2 formula, not
// captured from the implementation. See `EXPECTED_TOTAL_SCORE_MILLI` below.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { createCreditProfile } from './modules/credit-profile.js';
import {
  applyCreditEvaluationResult,
  assertConfigurationNotReferenced,
  createCreditEvaluationIndicator,
  createCreditEvaluationModel,
  createCreditEvaluationScheme,
  createCreditEvaluationSheet,
  finalizeCreditEvaluationSheet,
  getCreditEvaluationSheet,
  listCreditEvaluationIndicators,
  listCreditEvaluationModels,
  listCreditEvaluationSchemes,
  listCreditEvaluationSheets,
  modelMaxTotalMilli,
  modelTotalScoreMilli,
  resolveGrade,
  retireCreditEvaluationConfiguration,
  scoreCreditEvaluationSheet,
  weightedContributionMilli,
} from './modules/credit-evaluation.js';

// The actors carry exactly the authority each scenario needs. Central write
// authority is ADMIN or CREDIT_MANAGE + SALES_CROSS_GROUP (document.md §14
// AP4.1); CREDIT_EVALUATE alone authorises scoring and finalising but NEVER
// a rating application (R-D3-1 / A-D3-1).
const ADMIN = Object.freeze({
  id: 'w11b-admin', roleCode: 'ADMIN',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'SALES_CROSS_GROUP'],
});
const EVALUATOR = Object.freeze({
  id: 'w11b-evaluator', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE'],
});
const SECOND_EVALUATOR = Object.freeze({
  id: 'w11b-evaluator-2', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE'],
});
const OUTSIDE_EVALUATOR = Object.freeze({
  id: 'w11b-outsider', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE'],
});
const VIEWER = Object.freeze({ id: 'w11b-viewer', roleCode: 'SALES', permissions: ['CREDIT_VIEW'] });
// CREDIT_EVALUATE alone — explicitly NOT sufficient for a rating application.
const EVALUATOR_ONLY = Object.freeze({
  id: 'w11b-eval-only', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_EVALUATE'],
});
// CREDIT_MANAGE without the cross-group authority — also NOT sufficient.
const MANAGE_ONLY = Object.freeze({
  id: 'w11b-manage-only', roleCode: 'SALES',
  permissions: ['CREDIT_VIEW', 'CREDIT_MANAGE'],
});

const BUSINESS_DATE = '2026-06-30';
const CUSTOMER_ID = 'cus-w11b';
const CREDIT_OBJECT_TYPE = 'SALES_ORDER';
const CREDIT_OBJECT_ID = 'CREDIT-CUSTOMER-W11B';

function response() {
  return {
    statusCode: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

function request(body, key = 'w11b-key') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

async function invoke(handler, db, body, actor = ADMIN, key = 'w11b-key', ...rest) {
  const res = response();
  await handler(db, request(body, key), res, actor, ...rest);
  return res;
}

async function invokeFailure(handler, db, body, actor = ADMIN, key = 'w11b-key', ...rest) {
  try {
    const res = await invoke(handler, db, body, actor, key, ...rest);
    return { statusCode: res.statusCode, body: res.body, code: null, error: null };
  } catch (error) {
    return { statusCode: error.status, body: null, code: error.code, error };
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

function seedIdentity(db) {
  const now = new Date().toISOString();
  const hashed = hashPassword('w11b-1234');
  for (const id of ['w11b-admin', 'w11b-evaluator', 'w11b-evaluator-2', 'w11b-outsider', 'w11b-viewer', 'w11b-eval-only', 'w11b-manage-only']) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, id, id, hashed.hash, hashed.salt, now);
  }
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES(?,?,?,'','','',1,?,?)`).run(CUSTOMER_ID, 'CUS-W11B', 'Wave 11-B Customer', now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES('sp-w11b','SP-W11B','Salesperson W11B','w11b-evaluator',1,?,?)`).run(now, now);
}

// ---------------------------------------------------------------------------
// The evaluation fixture.
//
// Indicator A (QUALITATIVE): max 100000 milli, options STRONG=100000,
// ADEQUATE=60000, WEAK=20000.
// Indicator B (QUANTITATIVE): max 100000 milli, bands
//   [0, 40000) -> 20000, [40000, 80000) -> 60000, [80000, 100000] -> 100000.
//
// Model M1: A weight 6000, B weight 4000 (sum 10000).
// Scheme S1: A grade [0, 40000], B grade [40001, 70000], C grade [70001, 100000].
//   The model's full score is round_half_up(100000*6000/10000) + round_half_up(100000*4000/10000)
//   = 60000 + 40000 = 100000, so the bands tile [0, 100000] exactly.
//
// THE HAND-COMPUTED EXPECTATION.
//   Evaluator 1 scores A = STRONG -> 100000, B = 90000 -> band [80000,100000] -> 100000.
//   Evaluator 2 scores A = ADEQUATE -> 60000, B = 50000 -> band [40000,80000) -> 60000.
//
//   Aggregated achieved scores (mean, round half up, pure integer):
//     A: (100000 + 60000) = 160000; floor((160000 + 1) / 2) = floor(80000.5) = 80000
//     B: (100000 + 60000) = 160000; floor((160000 + 1) / 2) = 80000
//
//   Contributions (§37.54.9.2, round half up):
//     A: floor((80000 * 6000 + 5000) / 10000) = floor((480000000 + 5000) / 10000)
//        = floor(480005000 / 10000) = floor(48000.5) = 48000
//     B: floor((80000 * 4000 + 5000) / 10000) = floor((320000000 + 5000) / 10000)
//        = floor(320005000 / 10000) = floor(32000.5) = 32000
//
//   total_score_milli = 48000 + 32000 = 80000
//   max_total_milli   = 60000 + 40000 = 100000
//   grade              = C  (70001 <= 80000 <= 100000)
// ---------------------------------------------------------------------------
const EXPECTED_TOTAL_SCORE_MILLI = 80000;
const EXPECTED_MAX_SCORE_MILLI = 100000;
const EXPECTED_GRADE = 'C';

const INDICATOR_A = Object.freeze({
  code: 'IND_A', name: 'Qualitative Indicator A', indicatorKind: 'QUALITATIVE',
  description: 'qualitative', maxScoreMilli: 100000,
  inputSpec: { kind: 'QUALITATIVE', options: [
    { value: 'STRONG', scoreMilli: 100000 },
    { value: 'ADEQUATE', scoreMilli: 60000 },
    { value: 'WEAK', scoreMilli: 20000 },
  ] },
});
const INDICATOR_B = Object.freeze({
  code: 'IND_B', name: 'Quantitative Indicator B', indicatorKind: 'QUANTITATIVE',
  description: 'quantitative', maxScoreMilli: 100000,
  inputSpec: { kind: 'QUANTITATIVE', bands: [
    { min: 0, max: 40000, scoreMilli: 20000 },
    { min: 40001, max: 80000, scoreMilli: 60000 },
    { min: 80001, max: 100000, scoreMilli: 100000 },
  ] },
});
const SCHEME = Object.freeze({
  code: 'SCHEME_ABC', name: 'Scheme ABC',
  gradeBoundaries: [
    { grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 },
    { grade: 'B', minScoreMilli: 40001, maxScoreMilli: 70000 },
    { grade: 'C', minScoreMilli: 70001, maxScoreMilli: 100000 },
  ],
});

async function seedProfile(db, overrides = {}) {
  return invoke(createCreditProfile, db, {
    customerId: CUSTOMER_ID, creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId: CREDIT_OBJECT_ID,
    creditLimitCents: 1000000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'B',
    effectiveFrom: '2026-01-01', ...overrides,
  }, ADMIN, `w11b-profile-${Math.random()}`);
}

async function seedConfiguration(db, { effectiveFrom = '2026-01-01', weights } = {}) {
  const indicatorA = await invoke(createCreditEvaluationIndicator, db, {
    ...INDICATOR_A, effectiveFrom,
  }, ADMIN, `w11b-ind-a-${effectiveFrom}`);
  const indicatorB = await invoke(createCreditEvaluationIndicator, db, {
    ...INDICATOR_B, effectiveFrom,
  }, ADMIN, `w11b-ind-b-${effectiveFrom}`);
  const scheme = await invoke(createCreditEvaluationScheme, db, {
    ...SCHEME, effectiveFrom,
  }, ADMIN, `w11b-scheme-${effectiveFrom}`);
  const modelWeights = weights || {
    [indicatorA.body.indicator.id]: 6000,
    [indicatorB.body.indicator.id]: 4000,
  };
  const model = await invoke(createCreditEvaluationModel, db, {
    code: 'MODEL_1', name: 'Model 1', schemeId: scheme.body.scheme.id,
    indicatorWeights: modelWeights, effectiveFrom,
  }, ADMIN, `w11b-model-${effectiveFrom}`);
  return {
    indicatorA: indicatorA.body.indicator,
    indicatorB: indicatorB.body.indicator,
    scheme: scheme.body.scheme,
    model: model.body.model,
  };
}

async function seedSheet(db, { config, allowedEvaluatorIds = [EVALUATOR.id, SECOND_EVALUATOR.id], overrides = {} } = {}) {
  return invoke(createCreditEvaluationSheet, db, {
    modelId: config.model.id,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: CREDIT_OBJECT_ID,
    customerId: CUSTOMER_ID,
    businessDate: BUSINESS_DATE,
    allowedEvaluatorIds,
    ...overrides,
  }, EVALUATOR, `w11b-sheet-${Math.random()}`);
}

// ---------------------------------------------------------------------------
// SC103 / R103-1..R103-3 — the indicator.
// ---------------------------------------------------------------------------

test('SC103 indicator creation, validation and the effective-dated version contract', async () => {
  const handle = createTempDb({ label: 'w11b-sc103' });
  try {
    seedIdentity(handle.db);
    const created = await invoke(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-ind-1');
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.indicator.code, 'IND_A');
    assert.equal(created.body.indicator.indicatorKind, 'QUALITATIVE');
    assert.equal(created.body.indicator.maxScoreMilli, 100000);
    assert.equal(created.body.indicator.status, 'ACTIVE');
    assert.equal(created.body.indicator.effectiveTo, null);

    // NEGATIVE CONTROL 1: the max score must be a POSITIVE integer.
    const badMax = await invokeFailure(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, code: 'IND_BAD', effectiveFrom: '2026-01-01', maxScoreMilli: 0,
    }, ADMIN, 'w11b-ind-bad-max');
    assert.equal(badMax.statusCode, 400);
    assert.equal(badMax.code, 'CREDIT_EVALUATION_INDICATOR_INVALID');

    // NEGATIVE CONTROL 2: the indicator kind is a closed enum.
    const badKind = await invokeFailure(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, code: 'IND_BAD2', effectiveFrom: '2026-01-01', indicatorKind: 'MIXED',
    }, ADMIN, 'w11b-ind-bad-kind');
    assert.equal(badKind.statusCode, 400);

    // The same effective date is refused: the version already exists.
    const duplicate = await invokeFailure(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-ind-dup');
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.code, 'CREDIT_EVALUATION_VERSION_EXISTS');

    // The predecessor is terminated: the new version starts on 2026-07-01
    // and the predecessor's effective_to is tightened to 2026-06-30.
    const next = await invoke(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, name: 'Indicator A v2', effectiveFrom: '2026-07-01',
    }, ADMIN, 'w11b-ind-2');
    assert.equal(next.statusCode, 201);
    assert.equal(handle.db.prepare('SELECT effective_to FROM credit_evaluation_indicator WHERE id=?')
      .get(created.body.indicator.id).effective_to, '2026-06-30');

    // At most one effective version per business date.
    const atBoundary = handle.db.prepare(`SELECT COUNT(*) count FROM credit_evaluation_indicator
      WHERE code='IND_A' AND effective_from<='2026-07-01' AND (effective_to IS NULL OR effective_to>='2026-07-01')`).get();
    assert.equal(Number(atBoundary.count), 1);

    // NEGATIVE CONTROL 3: an interval overlap is refused. The new version
    // starts BEFORE the predecessor ends, so the intervals would overlap.
    const overlap = await invokeFailure(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, name: 'Indicator A v3', effectiveFrom: '2026-03-01', effectiveTo: '2026-12-31',
    }, ADMIN, 'w11b-ind-overlap');
    assert.equal(overlap.statusCode, 409);
    assert.equal(overlap.code, 'CREDIT_EVALUATION_INTERVAL_OVERLAP');

    // The audit row exists with the approved identity.
    const audits = handle.db.prepare(`SELECT * FROM audit_logs WHERE entity_type='CREDIT_EVALUATION_INDICATOR'`).all();
    assert.equal(audits.length, 2);
    assert.ok(audits.every((row) => row.action === 'CREATE_VERSION'));
  } finally { handle.cleanup(); }
});

test('SC103 referenced indicator is immutable; ACTIVE -> RETIRED is the only permitted UPDATE', async () => {
  const handle = createTempDb({ label: 'w11b-immutable' });
  try {
    seedIdentity(handle.db);
    const config = await seedConfiguration(handle.db);
    // The indicator is referenced by the model, so it may not be updated in
    // place.
    assert.throws(() => assertConfigurationNotReferenced(handle.db, 'INDICATOR', config.indicatorA.id),
      (error) => error.status === 409 && error.code === 'CREDIT_EVALUATION_INDICATOR_INVALID');
    // The scheme is referenced by the model.
    assert.throws(() => assertConfigurationNotReferenced(handle.db, 'SCHEME', config.scheme.id),
      (error) => error.status === 409 && error.code === 'CREDIT_EVALUATION_SCHEME_INVALID');
    // The model is not referenced by any sheet yet.
    assert.doesNotThrow(() => assertConfigurationNotReferenced(handle.db, 'MODEL', config.model.id));

    // The one-way status migration is permitted.
    const retired = await invoke(retireCreditEvaluationConfiguration, handle.db, { status: 'RETIRED' }, ADMIN,
      'w11b-retire', 'INDICATOR', config.indicatorA.id);
    assert.equal(retired.statusCode, 200);
    assert.equal(handle.db.prepare('SELECT status FROM credit_evaluation_indicator WHERE id=?').get(config.indicatorA.id).status, 'RETIRED');

    // NEGATIVE CONTROL: the migration is one-way. RETIRED -> ACTIVE is
    // refused, and so is a second RETIRED.
    const secondRetire = await invokeFailure(retireCreditEvaluationConfiguration, handle.db, { status: 'RETIRED' }, ADMIN,
      'w11b-retire-2', 'INDICATOR', config.indicatorA.id);
    assert.equal(secondRetire.statusCode, 409);
    assert.equal(secondRetire.code, 'CREDIT_EVALUATION_INDICATOR_INVALID');
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC104 / R104-1..R104-3 — the scheme.
// ---------------------------------------------------------------------------

test('SC104 scheme grade bands must tile [0, maxTotalMilli] with no gap and no overlap', async () => {
  const handle = createTempDb({ label: 'w11b-sc104' });
  try {
    seedIdentity(handle.db);
    const created = await invoke(createCreditEvaluationScheme, handle.db, {
      ...SCHEME, effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-scheme-1');
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.scheme.gradeBoundaries.length, 3);

    // NEGATIVE CONTROL 1: a gap in the tiling.
    const gap = await invokeFailure(createCreditEvaluationScheme, handle.db, {
      code: 'SCHEME_GAP', name: 'Gap', effectiveFrom: '2026-01-01',
      gradeBoundaries: [
        { grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 },
        { grade: 'B', minScoreMilli: 50000, maxScoreMilli: 100000 },
      ],
    }, ADMIN, 'w11b-scheme-gap');
    assert.equal(gap.statusCode, 400);
    assert.equal(gap.code, 'CREDIT_EVALUATION_SCHEME_INVALID');

    // NEGATIVE CONTROL 2: an overlap in the tiling.
    const overlap = await invokeFailure(createCreditEvaluationScheme, handle.db, {
      code: 'SCHEME_OVERLAP', name: 'Overlap', effectiveFrom: '2026-01-01',
      gradeBoundaries: [
        { grade: 'A', minScoreMilli: 0, maxScoreMilli: 50000 },
        { grade: 'B', minScoreMilli: 40000, maxScoreMilli: 100000 },
      ],
    }, ADMIN, 'w11b-scheme-overlap');
    assert.equal(overlap.statusCode, 400);
    assert.equal(overlap.code, 'CREDIT_EVALUATION_SCHEME_INVALID');

    // NEGATIVE CONTROL 3: the tiling does not start at 0.
    const notFromZero = await invokeFailure(createCreditEvaluationScheme, handle.db, {
      code: 'SCHEME_NONZERO', name: 'NonZero', effectiveFrom: '2026-01-01',
      gradeBoundaries: [{ grade: 'A', minScoreMilli: 1, maxScoreMilli: 100000 }],
    }, ADMIN, 'w11b-scheme-nonzero');
    assert.equal(notFromZero.statusCode, 400);

    // NEGATIVE CONTROL 4: the scheme does not cover the model's full score.
    // A scheme whose top band stops at 70000 cannot cover the 100000 full
    // score of the model.
    const tooSmall = await invokeFailure(createCreditEvaluationScheme, handle.db, {
      code: 'SCHEME_SMALL', name: 'Small', effectiveFrom: '2026-01-01',
      gradeBoundaries: [
        { grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 },
        { grade: 'B', minScoreMilli: 40001, maxScoreMilli: 70000 },
      ],
    }, ADMIN, 'w11b-scheme-small');
    assert.equal(tooSmall.statusCode, 201, 'the scheme alone may be narrower; the model proves the tiling');

    const indicatorA = await invoke(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_A, effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-ind-a');
    const indicatorB = await invoke(createCreditEvaluationIndicator, handle.db, {
      ...INDICATOR_B, effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-ind-b');
    const narrowModel = await invokeFailure(createCreditEvaluationModel, handle.db, {
      code: 'MODEL_NARROW', name: 'Narrow', schemeId: tooSmall.body.scheme.id,
      indicatorWeights: { [indicatorA.body.indicator.id]: 6000, [indicatorB.body.indicator.id]: 4000 },
      effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-model-narrow');
    assert.equal(narrowModel.statusCode, 400);
    assert.equal(narrowModel.code, 'CREDIT_EVALUATION_SCHEME_INVALID');
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC105 / R105-1 / R105-2 — the model and the weight rule.
// ---------------------------------------------------------------------------

test('SC105 model weights must be integer milli-weights summing to exactly 10000', async () => {
  const handle = createTempDb({ label: 'w11b-sc105' });
  try {
    seedIdentity(handle.db);
    const config = await seedConfiguration(handle.db);
    assert.equal(config.model.indicatorWeights[config.indicatorA.id], 6000);
    assert.equal(config.model.indicatorWeights[config.indicatorB.id], 4000);

    // NEGATIVE CONTROL 1: the sum is not 10000.
    const badSum = await invokeFailure(createCreditEvaluationModel, handle.db, {
      code: 'MODEL_BAD', name: 'Bad', schemeId: config.scheme.id,
      indicatorWeights: { [config.indicatorA.id]: 6000, [config.indicatorB.id]: 3000 },
      effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-model-bad');
    assert.equal(badSum.statusCode, 400);
    assert.equal(badSum.code, 'CREDIT_EVALUATION_WEIGHT_INVALID');

    // NEGATIVE CONTROL 2: a negative weight is refused, and the set is NOT
    // silently normalised to 10000.
    const negative = await invokeFailure(createCreditEvaluationModel, handle.db, {
      code: 'MODEL_NEG', name: 'Neg', schemeId: config.scheme.id,
      indicatorWeights: { [config.indicatorA.id]: -1, [config.indicatorB.id]: 10001 },
      effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-model-neg');
    assert.equal(negative.statusCode, 400);
    assert.equal(negative.code, 'CREDIT_EVALUATION_WEIGHT_INVALID');

    // NEGATIVE CONTROL 3: a fractional weight is refused (no floats).
    const fractional = await invokeFailure(createCreditEvaluationModel, handle.db, {
      code: 'MODEL_FRAC', name: 'Frac', schemeId: config.scheme.id,
      indicatorWeights: { [config.indicatorA.id]: 6000.5, [config.indicatorB.id]: 3999.5 },
      effectiveFrom: '2026-01-01',
    }, ADMIN, 'w11b-model-frac');
    assert.equal(fractional.statusCode, 400);

    // NEGATIVE CONTROL 4: the weight sum is never silently normalised.
    const stored = handle.db.prepare("SELECT COUNT(*) count FROM credit_evaluation_model WHERE code='MODEL_BAD'").get();
    assert.equal(Number(stored.count), 0);

    // The model references the indicators BY INDICATOR ROW ID (§37.54.9.1 (5)).
    const raw = handle.db.prepare('SELECT indicator_weights_json FROM credit_evaluation_model WHERE id=?').get(config.model.id);
    const weights = JSON.parse(raw.indicator_weights_json);
    assert.ok(Object.prototype.hasOwnProperty.call(weights, config.indicatorA.id));
    assert.ok(Object.prototype.hasOwnProperty.call(weights, config.indicatorB.id));
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC105 / R105-2 / R105-6 — the integer scoring arithmetic.
//
// THE HAND-COMPUTED EXPECTATION IS ASSERTED EXACTLY, WITH NO TOLERANCE.
// ---------------------------------------------------------------------------

test('SC105 the integer scoring arithmetic is exact — the hand-computed expectation', async () => {
  const handle = createTempDb({ label: 'w11b-arith' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config });
    const sheetId = sheet.body.sheet.id;

    // Evaluator 1: A = STRONG (100000), B = 90000 -> band [80001,100000] -> 100000.
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 90000 },
      ],
    }, EVALUATOR, 'w11b-score-1', sheetId);
    // Evaluator 2: A = ADEQUATE (60000), B = 50000 -> band [40001,80000] -> 60000.
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'ADEQUATE' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, SECOND_EVALUATOR, 'w11b-score-2', sheetId);

    const finalized = await invoke(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize', sheetId);
    assert.equal(finalized.statusCode, 200);
    const result = finalized.body.result;
    assert.equal(result.totalScoreMilli, EXPECTED_TOTAL_SCORE_MILLI);
    assert.equal(result.maxScoreMilli, EXPECTED_MAX_SCORE_MILLI);
    assert.equal(result.ratingGrade, EXPECTED_GRADE);
    assert.equal(result.evaluatorCount, 2);

    // The pure arithmetic helpers reproduce the same integers.
    const entries = [
      { achievedMilli: 80000, weightMilli: 6000, maxScoreMilli: 100000 },
      { achievedMilli: 80000, weightMilli: 4000, maxScoreMilli: 100000 },
    ];
    assert.equal(weightedContributionMilli(80000, 6000), 48000);
    assert.equal(weightedContributionMilli(80000, 4000), 32000);
    assert.equal(modelTotalScoreMilli(entries), EXPECTED_TOTAL_SCORE_MILLI);
    assert.equal(modelMaxTotalMilli(entries), EXPECTED_MAX_SCORE_MILLI);
    assert.equal(resolveGrade([
      { grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 },
      { grade: 'B', minScoreMilli: 40001, maxScoreMilli: 70000 },
      { grade: 'C', minScoreMilli: 70001, maxScoreMilli: 100000 },
    ], EXPECTED_TOTAL_SCORE_MILLI).grade, EXPECTED_GRADE);

    // The round-half-up boundary: floor((achieved*weight + 5000) / 10000).
    // achieved=1, weight=5000 -> floor((5000+5000)/10000) = 1 (not 0, not 2).
    assert.equal(weightedContributionMilli(1, 5000), 1);
    // achieved=1, weight=4000 -> floor((4000+5000)/10000) = 0.
    assert.equal(weightedContributionMilli(1, 4000), 0);
    // achieved=3, weight=5000 -> floor((15000+5000)/10000) = 2 (exactly .5).
    assert.equal(weightedContributionMilli(3, 5000), 2);
    // achieved=5, weight=2000 -> floor((10000+5000)/10000) = 1 (exactly .5).
    assert.equal(weightedContributionMilli(5, 2000), 1);

    // NEGATIVE CONTROL: the result is NOT reproducible with a float-based
    // half-up rounding on a .5 boundary. A float `Math.round` would give a
    // different answer for the 5/2000 case only if the arithmetic drifted;
    // the integer path is exact.
    assert.notEqual(weightedContributionMilli(5, 2000), 2);
  } finally { handle.cleanup(); }
});

test('SC105 an out-of-enum or out-of-band input is refused with no clamping', async () => {
  const handle = createTempDb({ label: 'w11b-range' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config, allowedEvaluatorIds: [EVALUATOR.id] });
    const sheetId = sheet.body.sheet.id;

    // NEGATIVE CONTROL 1: a qualitative value that is not in the enum.
    const badQualitative = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'EXCELLENT' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, EVALUATOR, 'w11b-score-bad-q', sheetId);
    assert.equal(badQualitative.statusCode, 400);
    assert.equal(badQualitative.code, 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE');

    // NEGATIVE CONTROL 2: a quantitative value ABOVE the top band is
    // refused, never clamped to the top band's score.
    const aboveBand = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 150000 },
      ],
    }, EVALUATOR, 'w11b-score-above', sheetId);
    assert.equal(aboveBand.statusCode, 400);
    assert.equal(aboveBand.code, 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE');

    // NEGATIVE CONTROL 3: a quantitative value BELOW the bottom band is
    // refused, never clamped to the bottom band's score.
    const belowBand = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: -1 },
      ],
    }, EVALUATOR, 'w11b-score-below', sheetId);
    assert.equal(belowBand.statusCode, 400);
    assert.equal(belowBand.code, 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE');

    // The refused submissions left NO partial payload behind.
    const row = handle.db.prepare('SELECT sheet_data_json,evaluator_count FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId);
    assert.equal(Number(row.evaluator_count), 0);
    assert.deepEqual(JSON.parse(row.sheet_data_json), { evaluators: [] });
  } finally { handle.cleanup(); }
});

test('SC105 a missing or duplicate indicator is refused at finalize', async () => {
  const handle = createTempDb({ label: 'w11b-missing' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);

    // MISSING INDICATOR: the evaluator submits only one of the two model
    // indicators. The submission itself is accepted (the sheet is not yet
    // final), but the finalize refuses it. A missing indicator is never
    // counted as a zero.
    const missingSheet = await seedSheet(handle.db, { config, allowedEvaluatorIds: [EVALUATOR.id] });
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [{ indicatorId: config.indicatorA.id, inputValue: 'STRONG' }],
    }, EVALUATOR, 'w11b-score-partial', missingSheet.body.sheet.id);
    const missing = await invokeFailure(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR,
      'w11b-finalize-missing', missingSheet.body.sheet.id);
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.code, 'CREDIT_EVALUATION_MISSING_INDICATOR');
    // No result row was produced.
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) count FROM credit_evaluation_result').get().count), 0);

    // DUPLICATE INDICATOR: the same indicator is submitted twice inside one
    // evaluation.
    const duplicateSheet = await seedSheet(handle.db, { config, allowedEvaluatorIds: [EVALUATOR.id] });
    const duplicate = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorA.id, inputValue: 'WEAK' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, EVALUATOR, 'w11b-score-duplicate', duplicateSheet.body.sheet.id);
    assert.equal(duplicate.statusCode, 400);
    assert.equal(duplicate.code, 'CREDIT_EVALUATION_DUPLICATE_INDICATOR');
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC106 / R106-1..R106-5 — the bounded multi-scorer sheet.
// ---------------------------------------------------------------------------

test('SC106 the sheet lifecycle: create -> score -> finalize, with the bounded scorer set', async () => {
  const handle = createTempDb({ label: 'w11b-sc106' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config });
    const sheetId = sheet.body.sheet.id;
    assert.equal(sheet.body.sheet.status, 'DRAFT');
    assert.equal(sheet.body.sheet.customerId, CUSTOMER_ID);
    assert.equal(sheet.body.sheet.profileScopeKey, '*');
    assert.equal(sheet.body.sheet.evaluatorCount, 0);
    // The sheet binds the Credit Profile VERSION effective at the business
    // date, never an anchor.
    assert.ok(sheet.body.sheet.creditProfileId);

    // A scorer OUTSIDE the allowed set is refused.
    const outside = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, OUTSIDE_EVALUATOR, 'w11b-score-outside', sheetId);
    assert.equal(outside.statusCode, 403);
    assert.equal(outside.code, 'CREDIT_SHEET_NOT_ALLOWED_SCORER');

    // Finalize before every allowed scorer submitted is refused, and the
    // status is NOT advanced automatically.
    const early = await invokeFailure(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize-early', sheetId);
    assert.equal(early.statusCode, 409);
    assert.equal(early.code, 'CREDIT_SHEET_NOT_FINALIZED');
    assert.equal(handle.db.prepare('SELECT status FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId).status, 'DRAFT');

    // Evaluator 1 submits. A SECOND submission by the same evaluator is
    // refused.
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, EVALUATOR, 'w11b-score-1', sheetId);
    const repeat = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'WEAK' },
        { indicatorId: config.indicatorB.id, inputValue: 50000 },
      ],
    }, EVALUATOR, 'w11b-score-repeat', sheetId);
    assert.equal(repeat.statusCode, 409);
    assert.equal(repeat.code, 'CREDIT_SHEET_STATE_INVALID');

    // The sheet is still finalizable: evaluator 2 has not submitted yet.
    const stillEarly = await invokeFailure(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize-early-2', sheetId);
    assert.equal(stillEarly.statusCode, 409);
    assert.equal(stillEarly.code, 'CREDIT_SHEET_NOT_FINALIZED');

    // Evaluator 2 submits, then the finalize succeeds.
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'ADEQUATE' },
        { indicatorId: config.indicatorB.id, inputValue: 90000 },
      ],
    }, SECOND_EVALUATOR, 'w11b-score-2', sheetId);
    const finalized = await invoke(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize', sheetId);
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.body.sheet.status, 'FINALIZED');
    assert.equal(finalized.body.result.totalScoreMilli, EXPECTED_TOTAL_SCORE_MILLI);
    assert.equal(finalized.body.result.ratingGrade, EXPECTED_GRADE);

    // Exactly ONE aggregate result per sheet.
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) count FROM credit_evaluation_result WHERE sheet_id=?').get(sheetId).count), 1);

    // A second finalize is refused.
    const second = await invokeFailure(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize-2', sheetId);
    assert.equal(second.statusCode, 409);
    assert.equal(second.code, 'CREDIT_SHEET_STATE_INVALID');
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) count FROM credit_evaluation_result WHERE sheet_id=?').get(sheetId).count), 1);

    // A submission AFTER the finalize is refused.
    const lateScore = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      entries: [{ indicatorId: config.indicatorA.id, inputValue: 'STRONG' }],
    }, EVALUATOR, 'w11b-score-late', sheetId);
    assert.equal(lateScore.statusCode, 409);
    assert.equal(lateScore.code, 'CREDIT_SHEET_STATE_INVALID');
  } finally { handle.cleanup(); }
});

test('SC106 the scoring endpoint accepts NO target parameter and cannot be re-targeted', async () => {
  const handle = createTempDb({ label: 'w11b-target' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config });
    const sheetId = sheet.body.sheet.id;

    // A request carrying a target parameter is REFUSED outright: the
    // scoring endpoint accepts no target parameters at all.
    const withTarget = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      customerId: 'cus-other', entries: [],
    }, EVALUATOR, 'w11b-score-target', sheetId);
    assert.equal(withTarget.statusCode, 400);
    assert.match(withTarget.error.message, /不支持的字段/);

    // A request with a salesperson target is refused too.
    const withSalesperson = await invokeFailure(scoreCreditEvaluationSheet, handle.db, {
      salespersonId: 'sp-other', entries: [],
    }, EVALUATOR, 'w11b-score-target-2', sheetId);
    assert.equal(withSalesperson.statusCode, 400);

    // The sheet's target is unchanged by the refused requests.
    const row = handle.db.prepare('SELECT customer_id,profile_scope_key,credit_object_type,credit_object_id FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId);
    assert.equal(row.customer_id, CUSTOMER_ID);
    assert.equal(row.profile_scope_key, '*');
    assert.equal(row.credit_object_type, CREDIT_OBJECT_TYPE);
    assert.equal(row.credit_object_id, CREDIT_OBJECT_ID);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// SC107 / R107-2..R107-6 — the rating application.
// ---------------------------------------------------------------------------

test('SC107 the rating application requires write-class authority and is the ONLY rating effect', async () => {
  const handle = createTempDb({ label: 'w11b-sc107' });
  try {
    seedIdentity(handle.db);
    const profile = await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config, allowedEvaluatorIds: [EVALUATOR.id] });
    const sheetId = sheet.body.sheet.id;
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 90000 },
      ],
    }, EVALUATOR, 'w11b-score', sheetId);
    const finalized = await invoke(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize', sheetId);
    const resultId = finalized.body.result.id;

    // NEGATIVE CONTROL 1: CREDIT_EVALUATE alone is NOT sufficient.
    const evaluatorOnly = await invokeFailure(applyCreditEvaluationResult, handle.db, {}, EVALUATOR_ONLY,
      'w11b-apply-eval', resultId);
    assert.equal(evaluatorOnly.statusCode, 403);
    assert.equal(evaluatorOnly.code, 'CREDIT_MANAGEMENT_DENIED');

    // NEGATIVE CONTROL 2: CREDIT_MANAGE without the cross-group authority is
    // NOT sufficient either.
    const manageOnly = await invokeFailure(applyCreditEvaluationResult, handle.db, {}, MANAGE_ONLY,
      'w11b-apply-manage', resultId);
    assert.equal(manageOnly.statusCode, 403);
    assert.equal(manageOnly.code, 'CREDIT_MANAGEMENT_DENIED');

    // The refused applications left NO rating effect.
    const before = handle.db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=?').all(profile.body.profile.id);
    assert.equal(before.length, 1);
    assert.equal(before[0].rating_source_type, 'INITIAL_ASSIGNED');
    assert.equal(before[0].superseded_at, null);
    assert.equal(handle.db.prepare('SELECT rating_grade FROM credit_profile WHERE id=?').get(profile.body.profile.id).rating_grade, 'B');

    // The authorised application succeeds.
    const applied = await invoke(applyCreditEvaluationResult, handle.db, {}, ADMIN, 'w11b-apply', resultId);
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.body.rating.businessSource, 'EVALUATION_APPLIED');
    assert.equal(applied.body.rating.physicalSourceType, 'EVALUATED');
    assert.equal(applied.body.rating.physicalSourceKey, resultId);

    const after = handle.db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=? ORDER BY applied_at,id').all(profile.body.profile.id);
    assert.equal(after.length, 2);
    const previous = after.find((row) => row.rating_source_type === 'INITIAL_ASSIGNED');
    const current = after.find((row) => row.rating_source_type === 'EVALUATED');
    // The previous rating history row keeps its grade, applied_at and
    // applied_by; ONLY superseded_at moved.
    assert.equal(previous.rating_grade, 'B');
    assert.ok(previous.superseded_at, 'the previous rating is superseded');
    assert.equal(current.rating_grade, EXPECTED_GRADE);
    assert.equal(current.evaluation_result_id, resultId);
    assert.equal(current.rating_source_key, resultId);
    assert.equal(current.superseded_at, null);

    // The profile's inline projection matches the current rating row.
    const profileRow = handle.db.prepare('SELECT rating_grade,rating_effective_from,rating_effective_to FROM credit_profile WHERE id=?').get(profile.body.profile.id);
    assert.equal(profileRow.rating_grade, EXPECTED_GRADE);
    assert.equal(profileRow.rating_effective_from, BUSINESS_DATE);

    // The result row records its application.
    const resultRow = handle.db.prepare('SELECT * FROM credit_evaluation_result WHERE id=?').get(resultId);
    assert.equal(resultRow.applied_to_profile_id, profile.body.profile.id);
    assert.ok(resultRow.applied_at);
    assert.equal(resultRow.applied_by, ADMIN.id);

    // The sheet is APPLIED.
    assert.equal(handle.db.prepare('SELECT status FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId).status, 'APPLIED');

    // A SECOND application is refused, and there is no second effect.
    const second = await invokeFailure(applyCreditEvaluationResult, handle.db, {}, ADMIN, 'w11b-apply-2', resultId);
    assert.equal(second.statusCode, 409);
    assert.equal(second.code, 'CREDIT_EVALUATION_RESULT_ALREADY_APPLIED');
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) count FROM credit_profile_ratings WHERE credit_profile_id=?').get(profile.body.profile.id).count), 2);

    // The audit identity is distinct from SCORE and FINALIZE.
    const audits = handle.db.prepare(`SELECT action FROM audit_logs WHERE entity_type='CREDIT_EVALUATION_RESULT'`).all();
    assert.deepEqual(audits.map((row) => row.action).sort(), ['APPLY', 'FINALIZE']);
  } finally { handle.cleanup(); }
});

test('SC107 a changed profile version between the sheet and the apply is refused, never silently rebound', async () => {
  const handle = createTempDb({ label: 'w11b-rebind' });
  try {
    seedIdentity(handle.db);
    const profile = await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    const sheet = await seedSheet(handle.db, { config, allowedEvaluatorIds: [EVALUATOR.id] });
    const sheetId = sheet.body.sheet.id;
    await invoke(scoreCreditEvaluationSheet, handle.db, {
      entries: [
        { indicatorId: config.indicatorA.id, inputValue: 'STRONG' },
        { indicatorId: config.indicatorB.id, inputValue: 90000 },
      ],
    }, EVALUATOR, 'w11b-score', sheetId);
    const finalized = await invoke(finalizeCreditEvaluationSheet, handle.db, {}, EVALUATOR, 'w11b-finalize', sheetId);
    const resultId = finalized.body.result.id;

    // A NEW Credit Profile version becomes effective on the sheet's business
    // date. The result was bound to the previous version, so the apply must
    // fail closed.
    await seedProfile(handle.db, { effectiveFrom: BUSINESS_DATE, ratingGrade: 'A' });
    const changed = await invokeFailure(applyCreditEvaluationResult, handle.db, {}, ADMIN, 'w11b-apply-changed', resultId);
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.code, 'CREDIT_RATING_TARGET_PROFILE_CHANGED');

    // No rating effect was produced.
    const ratings = handle.db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=?').all(profile.body.profile.id);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].rating_source_type, 'INITIAL_ASSIGNED');
    assert.equal(handle.db.prepare('SELECT applied_to_profile_id FROM credit_evaluation_result WHERE id=?').get(resultId).applied_to_profile_id, null);
  } finally { handle.cleanup(); }
});

test('SC107 the read surfaces are scoped and the configuration reads are CREDIT_VIEW', async () => {
  const handle = createTempDb({ label: 'w11b-read' });
  try {
    seedIdentity(handle.db);
    await seedProfile(handle.db);
    const config = await seedConfiguration(handle.db);
    await seedSheet(handle.db, { config });

    const sheets = await read(listCreditEvaluationSheets, handle.db, VIEWER, {});
    assert.equal(sheets.statusCode, 200);
    assert.equal(sheets.body.sheets.length, 1);

    const indicators = await read(listCreditEvaluationIndicators, handle.db, VIEWER, {});
    assert.equal(indicators.statusCode, 200);
    assert.equal(indicators.body.indicators.length, 2);

    const schemes = await read(listCreditEvaluationSchemes, handle.db, VIEWER, {});
    assert.equal(schemes.statusCode, 200);
    assert.equal(schemes.body.schemes.length, 1);

    const models = await read(listCreditEvaluationModels, handle.db, VIEWER, {});
    assert.equal(models.statusCode, 200);
    assert.equal(models.body.models.length, 1);

    // NEGATIVE CONTROL: a caller without CREDIT_VIEW is refused.
    const noView = await read(listCreditEvaluationIndicators, handle.db, { id: 'x', roleCode: 'SALES', permissions: [] }, {});
    assert.equal(noView.statusCode, 403);
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// The static source-level contract.
//
// §37.54.10.6: `rating_grade` / `rating_effective_from` /
// `rating_effective_to` appear in no INSERT or UPDATE in
// `server/modules/credit-*.js` outside `applyCreditRating`.
// ---------------------------------------------------------------------------

test('the single rating writer is enforced at the source level', async () => {
  const sources = await Promise.all(['credit-profile.js', 'credit-anchor.js', 'credit-policy.js',
    'credit-check.js', 'credit-scope.js', 'credit-query.js', 'credit-query-options.js',
    'credit-special-approval.js', 'credit-evaluation.js', 'credit-reconciliation.js']
    .map((name) => readFile(new URL(`./modules/${name}`, import.meta.url), 'utf8')));

  // The static contract of Design §37.54.10.6 is about the `credit_profile`
  // table's three rating columns (`rating_grade` / `rating_effective_from` /
  // `rating_effective_to`): they may only be written inside `applyCreditRating`.
  //
  // `credit_evaluation_result.rating_grade` is a DIFFERENT column. The Design
  // §37.54.10.5 and the DDL at §37.54.12.3 give the result row its own grade
  // attribute, and §37.54.10.6 scopes the contract to
  // `credit_profile.rating_grade`. The assertion therefore targets the
  // `credit_profile` table, and separately proves that the two effective-date
  // columns are written to no other table at all.
  const ratingColumns = /rating_grade|rating_effective_from|rating_effective_to/i;
  for (const source of sources) {
    // Every INSERT / UPDATE statement in the module sources.
    const statements = source.match(/\b(?:INSERT\s+INTO|UPDATE)\s+[a-z_]+[\s\S]{0,600}?;/gi) || [];
    for (const statement of statements) {
      if (!ratingColumns.test(statement)) continue;
      const target = statement.match(/\b(?:INSERT\s+INTO|UPDATE)\s+([a-z_]+)/i)?.[1]?.toLowerCase();
      // Only `credit_profile` carries the profile rating columns.
      if (target !== 'credit_profile') continue;
      // The only permitted occurrence is inside `applyCreditRating`.
      const allowed = /UPDATE\s+credit_profile\s+SET\s+rating_grade/i.test(statement);
      assert.ok(allowed,
        `a rating column is written to credit_profile outside applyCreditRating:\n${statement.slice(0, 200)}`);
    }
  }

  // The two effective-date columns belong to `credit_profile` alone: no other
  // table in the Credit model may carry them, so no second write path can hide
  // behind an unrelated table name.
  for (const source of sources) {
    const statements = source.match(/\b(?:INSERT\s+INTO|UPDATE)\s+[a-z_]+[\s\S]{0,600}?;/gi) || [];
    for (const statement of statements) {
      const target = statement.match(/\b(?:INSERT\s+INTO|UPDATE)\s+([a-z_]+)/i)?.[1]?.toLowerCase();
      if (target === 'credit_profile') continue;
      assert.doesNotMatch(statement, /rating_effective_from|rating_effective_to/i,
        `the profile rating effective-date columns must not be written to ${target}`);
    }
  }

  // The `credit_profile_ratings` UPDATE may only move `superseded_at`.
  for (const source of sources) {
    const updates = source.match(/UPDATE\s+credit_profile_ratings[\s\S]{0,400}?;/gi) || [];
    for (const statement of updates) {
      assert.doesNotMatch(statement, /rating_grade|applied_at|applied_by|evaluation_result_id/i,
        'no module may rewrite applied rating history values');
      assert.match(statement, /superseded_at/i,
        'the only permitted change to applied rating history is the superseded_at migration');
    }
  }
});

test('the W11-B / W11-C tables exist and the deferred FK is enabled', async () => {
  const handle = createTempDb({ label: 'w11b-schema' });
  try {
    const tables = handle.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name LIKE 'credit_evaluation%' ORDER BY name`).all().map((row) => row.name);
    assert.deepEqual(tables, [
      'credit_evaluation_indicator',
      'credit_evaluation_model',
      'credit_evaluation_result',
      'credit_evaluation_scheme',
      'credit_evaluation_scoring_sheet',
    ]);
    const fks = handle.db.prepare('PRAGMA foreign_key_list(credit_profile_ratings)').all();
    assert.ok(fks.some((row) => row.from === 'evaluation_result_id' && row.table === 'credit_evaluation_result'),
      'the deferred FK is enabled');
    // The Wave 9 CHECK is intact: the EVALUATED branch still requires a
    // non-null evaluation_result_id equal to the source key.
    const ddl = handle.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_profile_ratings'").get().sql;
    assert.match(ddl, /rating_source_type='EVALUATED' AND evaluation_result_id IS NOT NULL/);
    assert.match(ddl, /rating_source_key=evaluation_result_id/);
  } finally { handle.cleanup(); }
});
