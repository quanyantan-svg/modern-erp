import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isGateRetryAdmissionExpired,
  parseGateAttemptsBudgetMs,
  startGateRetryAdmission,
} from './modules/sales-gate-retry-admission.js';

function clock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('F2-01/F2-04: missing and empty budget values use the exact 15000 ms default', () => {
  assert.equal(parseGateAttemptsBudgetMs(undefined), 15_000);
  assert.equal(parseGateAttemptsBudgetMs(null), 15_000);
  assert.equal(parseGateAttemptsBudgetMs(''), 15_000);
  assert.equal(parseGateAttemptsBudgetMs('   '), 15_000);
});

test('F2-02/F2-03: the inclusive 1000..60000 ms bounds are accepted', () => {
  assert.equal(parseGateAttemptsBudgetMs('1000'), 1_000);
  assert.equal(parseGateAttemptsBudgetMs('60000'), 60_000);
  assert.equal(parseGateAttemptsBudgetMs(' 15000 '), 15_000);
});

test('F2-04/F2-05: malformed, noncanonical, unsafe and out-of-range values fall back', () => {
  for (const value of [
    '999', '60001', '0', '-1000', '+1000', '01000', '1000.0', '1e3',
    '9007199254740993', '１０００', '1_000', '1000ms', 1000, {}, [],
  ]) {
    assert.equal(parseGateAttemptsBudgetMs(value), 15_000, `fallback for ${String(value)}`);
  }
});

test('F2-06: elapsed time immediately below the budget permits admission', () => {
  const admission = startGateRetryAdmission('1000', clock(5n, 999_999_999n + 5n));
  assert.equal(admission.budgetMs, 1_000);
  assert.equal(isGateRetryAdmissionExpired(admission), false);
});

test('F2-07: elapsed time equal to the budget rejects admission', () => {
  const admission = startGateRetryAdmission('1000', clock(17n, 1_000_000_017n));
  assert.equal(isGateRetryAdmissionExpired(admission), true);
});

test('F2-08: elapsed time greater than the budget rejects admission', () => {
  const admission = startGateRetryAdmission('1000', clock(0n, 1_000_000_001n));
  assert.equal(isGateRetryAdmissionExpired(admission), true);
});

test('F2-19: one admission instance retains its parsed budget and original start', () => {
  const admission = startGateRetryAdmission('1000', clock(100n, 500_000_100n, 999_999_999n + 100n, 1_000_000_100n));
  assert.ok(Object.isFrozen(admission));
  assert.equal(isGateRetryAdmissionExpired(admission), false);
  assert.equal(isGateRetryAdmissionExpired(admission), false);
  assert.equal(isGateRetryAdmissionExpired(admission), true);
  assert.equal(admission.startedAtNs, 100n);
  assert.equal(admission.budgetMs, 1_000);
});

test('F2 helper rejects a non-function clock or a clock that does not return bigint', () => {
  assert.throws(() => startGateRetryAdmission('1000', null), TypeError);
  assert.throws(() => startGateRetryAdmission('1000', () => 0), TypeError);
  const admission = startGateRetryAdmission('1000', clock(0n, 1));
  assert.throws(() => isGateRetryAdmissionExpired(admission), TypeError);
});
