// TAP parser + assertion tests for the MySQL concurrency gate.
//
// Runs without any MySQL connection. Imports parseTapSummary /
// assertTapSummaryStrict from scripts/gates/mysql-concurrency-gate.mjs.
//
// Each test covers a separate failure mode. The gate must fail closed
// (throw with a diagnostic) on every non-PASS path. These tests are
// the only reason parseTapSummary / assertTapSummaryStrict are
// exported; the gate's runtime path is exercised by the protected
// MySQL environment which is queued behind user authorisation.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseTapSummary, assertTapSummaryStrict } from './gates/tap-summary.js';

const LEGAL_DECIMAL = `
# tests 13
# suites 4
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 12345.678
`;

const LEGAL_INTEGER = `
# tests 7
# suites 2
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 800
`;

const MISSING_DURATION = `
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
`;

const MISSING_CANCELLED = `
# tests 5
# suites 1
# pass 5
# fail 0
# skipped 0
# todo 0
# duration_ms 12.3
`;

const SKIPPED_NONZERO = `
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 5
`;

const TODO_NONZERO = `
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 2
# duration_ms 5
`;

const PASS_NE_TESTS = `
# tests 5
# suites 1
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5
`;

const FAIL_NONZERO = `
# tests 5
# suites 1
# pass 5
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5
`;

const MALFORMED_DURATION = `
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms not-a-number
`;

const OVER_MAX_SAFE_INTEGER = `
# tests 9007199254740993
# suites 1
# pass 9007199254740993
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5
`;

const NEGATIVE_INTEGER = `
# tests -5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5
`;

describe('Gate TAP parser — legal and fail-closed coverage', () => {
  test('1) complete legal TAP with decimal duration parses and asserts PASS', () => {
    const summary = parseTapSummary(LEGAL_DECIMAL);
    assert.equal(summary.tests, 13);
    assert.equal(summary.pass, 13);
    assert.equal(summary.fail, 0);
    assert.equal(summary.durationMs, 12345.678);
    assert.doesNotThrow(() => assertTapSummaryStrict('decimal', summary));
  });

  test('2) complete legal TAP with integer duration parses and asserts PASS', () => {
    const summary = parseTapSummary(LEGAL_INTEGER);
    assert.equal(summary.tests, 7);
    assert.equal(summary.durationMs, 800);
    assert.doesNotThrow(() => assertTapSummaryStrict('integer', summary));
  });

  test('3) missing duration_ms fails closed (Number.isFinite false)', () => {
    const summary = parseTapSummary(MISSING_DURATION);
    assert.equal(summary.durationMs, null);
    assert.throws(() => assertTapSummaryStrict('missing-duration', summary),
      /duration_ms/i);
  });

  test('4) missing cancelled field fails closed (NaN integer)', () => {
    const summary = parseTapSummary(MISSING_CANCELLED);
    assert.equal(summary.cancelled, null);
    assert.throws(() => assertTapSummaryStrict('missing-cancelled', summary),
      /cancelled/i);
  });

  test('5) skipped > 0 fails closed', () => {
    const summary = parseTapSummary(SKIPPED_NONZERO);
    assert.equal(summary.skipped, 1);
    assert.throws(() => assertTapSummaryStrict('skipped-nonzero', summary),
      /skipped.*must be 0/i);
  });

  test('6) todo > 0 fails closed', () => {
    const summary = parseTapSummary(TODO_NONZERO);
    assert.equal(summary.todo, 2);
    assert.throws(() => assertTapSummaryStrict('todo-nonzero', summary),
      /todo.*must be 0/i);
  });

  test('7) pass != tests fails closed', () => {
    const summary = parseTapSummary(PASS_NE_TESTS);
    assert.equal(summary.pass, 4);
    assert.equal(summary.tests, 5);
    assert.throws(() => assertTapSummaryStrict('pass-mismatch', summary),
      /pass=4.*tests=5/i);
  });

  test('8) fail > 0 fails closed', () => {
    const summary = parseTapSummary(FAIL_NONZERO);
    assert.equal(summary.fail, 1);
    assert.throws(() => assertTapSummaryStrict('fail-nonzero', summary),
      /fail.*must be 0/i);
  });

  test('9) malformed duration fails closed (non-numeric token)', () => {
    const summary = parseTapSummary(MALFORMED_DURATION);
    assert.equal(summary.durationMs, null);
    assert.throws(() => assertTapSummaryStrict('malformed-duration', summary),
      /duration_ms/i);
  });

  test('10) counter exceeds Number.MAX_SAFE_INTEGER fails closed', () => {
    // 9007199254740993 > Number.MAX_SAFE_INTEGER (2^53 - 1). The
    // parser coerces it via Number() which rounds; the strict assertion
    // MUST reject any non-safe-integer counter value.
    const summary = parseTapSummary(OVER_MAX_SAFE_INTEGER);
    assert.equal(summary.tests, null, 'tests must be null when over MAX_SAFE_INTEGER');
    assert.throws(() => assertTapSummaryStrict('over-safe-int', summary),
      /safe integer|MAX_SAFE_INTEGER/i);
  });

  test('11) counter appears as a negative number fails closed', () => {
    // The parser filters non-negative integers via `n >= 0`. Negative
    // counters become null in the summary. The strict assertion must
    // reject null (safe-integer check).
    const summary = parseTapSummary(NEGATIVE_INTEGER);
    assert.equal(summary.tests, null, 'negative counter must be null');
    assert.throws(() => assertTapSummaryStrict('negative', summary),
      /safe integer|missing or not/i);
  });

  test('12) legal decimal duration_ms still asserts PASS', () => {
    // Existing path verified by case 1, repeated here with a different
    // decimal value to prove the decimal regex path is independent of
    // the integer path.
    const decimal = `
# tests 4
# suites 1
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 0.001
`;
    const summary = parseTapSummary(decimal);
    assert.equal(summary.durationMs, 0.001);
    assert.doesNotThrow(() => assertTapSummaryStrict('decimal-edge', summary));
  });
});