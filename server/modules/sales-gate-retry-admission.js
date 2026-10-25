const DEFAULT_GATE_ATTEMPTS_BUDGET_MS = 15_000;
const MIN_GATE_ATTEMPTS_BUDGET_MS = 1_000;
const MAX_GATE_ATTEMPTS_BUDGET_MS = 60_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

export function parseGateAttemptsBudgetMs(rawValue) {
  if (rawValue == null) return DEFAULT_GATE_ATTEMPTS_BUDGET_MS;
  if (typeof rawValue !== 'string') return DEFAULT_GATE_ATTEMPTS_BUDGET_MS;
  const value = rawValue.trim();
  if (!CANONICAL_POSITIVE_DECIMAL.test(value)) return DEFAULT_GATE_ATTEMPTS_BUDGET_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    && parsed >= MIN_GATE_ATTEMPTS_BUDGET_MS
    && parsed <= MAX_GATE_ATTEMPTS_BUDGET_MS
    ? parsed
    : DEFAULT_GATE_ATTEMPTS_BUDGET_MS;
}

export function startGateRetryAdmission(
  rawValue,
  readMonotonicNs = process.hrtime.bigint,
) {
  if (typeof readMonotonicNs !== 'function') {
    throw new TypeError('readMonotonicNs must be a function');
  }
  const startedAtNs = readMonotonicNs();
  if (typeof startedAtNs !== 'bigint') {
    throw new TypeError('readMonotonicNs must return a bigint');
  }
  return Object.freeze({
    budgetMs: parseGateAttemptsBudgetMs(rawValue),
    startedAtNs,
    readMonotonicNs,
  });
}

export function isGateRetryAdmissionExpired(admission) {
  const currentNs = admission.readMonotonicNs();
  if (typeof currentNs !== 'bigint') {
    throw new TypeError('readMonotonicNs must return a bigint');
  }
  const elapsedNs = currentNs - admission.startedAtNs;
  return elapsedNs >= BigInt(admission.budgetMs) * NANOSECONDS_PER_MILLISECOND;
}
