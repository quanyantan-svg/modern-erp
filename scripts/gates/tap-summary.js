// TAP summary parsing + fail-closed assertion. Extracted so that the
// parser and the strict-assertion helper are unit-testable without
// pulling in the MySQL concurrency gate's process.exit-on-missing-env
// side effects.
//
// Both functions are used by:
//   - scripts/gates/mysql-concurrency-gate.mjs (gate runtime)
//   - scripts/gate-tap-parser.test.js (unit coverage)
//
// All counters (`tests`, `suites`, `pass`, `fail`, `skipped`,
// `cancelled`, `todo`) MUST be Number.isSafeInteger. Counts that
// exceed Number.MAX_SAFE_INTEGER are rejected. duration_ms is a
// finite non-negative number (integer OR decimal).

const SAFE_INTEGER_RANGE_ERROR = 'value exceeds Number.MAX_SAFE_INTEGER or is not a safe integer';

export function parseTapSummary(captured) {
  const text = String(captured || '');
  const findSafeInt = (label) => {
    const match = text.match(new RegExp(`^#\\s+${label}\\s+(\\d+)\\s*$`, 'm'));
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const findNumber = (label) => {
    const match = text.match(new RegExp(`^#\\s+${label}\\s+(\\d+(?:\\.\\d+)?)\\s*$`, 'm'));
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    tests: findSafeInt('tests'),
    suites: findSafeInt('suites'),
    pass: findSafeInt('pass'),
    fail: findSafeInt('fail'),
    skipped: findSafeInt('skipped'),
    cancelled: findSafeInt('cancelled'),
    todo: findSafeInt('todo'),
    durationMs: findNumber('duration_ms'),
  };
}

export function assertTapSummaryStrict(label, summary) {
  const integerFields = ['tests', 'suites', 'pass', 'fail', 'skipped', 'cancelled', 'todo'];
  for (const key of integerFields) {
    if (!Number.isSafeInteger(summary[key])) {
      throw new Error(
        `MYSQL CONCURRENCY GATE: ${label} TAP summary field "${key}" is missing or not a safe integer (got ${summary[key]}); ${SAFE_INTEGER_RANGE_ERROR}; refusing to claim PASS.`,
      );
    }
    if (summary[key] < 0) {
      throw new Error(
        `MYSQL CONCURRENCY GATE: ${label} TAP summary field "${key}" is negative (${summary[key]}); refusing to claim PASS.`,
      );
    }
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(
      `MYSQL CONCURRENCY GATE: ${label} TAP summary field "duration_ms" is missing or not a finite non-negative number (got ${summary.durationMs}); refusing to claim PASS.`,
    );
  }
  if (summary.tests < 1) {
    throw new Error(`MYSQL CONCURRENCY GATE: ${label} reports tests=${summary.tests}; require >=1`);
  }
  if (summary.pass !== summary.tests) {
    throw new Error(
      `MYSQL CONCURRENCY GATE: ${label} reports pass=${summary.pass} but tests=${summary.tests}; pass must equal tests`,
    );
  }
  if (summary.fail !== 0) {
    throw new Error(`MYSQL CONCURRENCY GATE: ${label} reports fail=${summary.fail}; must be 0`);
  }
  if (summary.skipped !== 0) {
    throw new Error(`MYSQL CONCURRENCY GATE: ${label} reports skipped=${summary.skipped}; must be 0`);
  }
  if (summary.cancelled !== 0) {
    throw new Error(`MYSQL CONCURRENCY GATE: ${label} reports cancelled=${summary.cancelled}; must be 0`);
  }
  if (summary.todo !== 0) {
    throw new Error(`MYSQL CONCURRENCY GATE: ${label} reports todo=${summary.todo}; must be 0`);
  }
  return summary;
}