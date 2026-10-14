// Sales & Customer Wave 1 — canonical lock-wait observer.
//
// This is the SINGLE canonical implementation of the lock-wait
// observation logic. It is imported by both the live MySQL
// concurrency integration test
// (`server/mysql-sales-customer-wave1-concurrency.integration.js`)
// and the pure-function unit test
// (`server/concurrency-lock-observer.test.js`). There is no duplicate
// copy: any change to the contract happens here.
//
// The observer does NOT execute the gate reset, does NOT spawn
// child processes, does NOT require MySQL to import. The integration
// test wraps this module; the unit test wraps this module with a
// stub adapter.
//
// API:
//
//   observeLockWait(db, observers, options) → Promise<ObservationResult>
//
//   observers: {
//     alpha:   { connectionId: Number, threadId: Number|null },
//     beta:    { connectionId: Number, threadId: Number|null },
//     control: { connectionId: Number, threadId: Number|null },
//   }
//
//   options: {
//     pollAttempts?: Number (default 60),
//     pollIntervalMs?: Number (default 50),
//   }
//
// Result shape (one of four downgrade labels):
//
//   {
//     kind: 'PERFORMANCE_SCHEMA' | 'PROCESSLIST',
//     observed: boolean,
//     downgradeTo: 'LOCK_WAIT_OBSERVED' |
//                  'PARTIAL_LOCK_WAIT_OBSERVED' |
//                  'QUERY_ACTIVITY_OBSERVED' |
//                  'MULTI_SESSION_CONSISTENCY_VERIFIED' |
//                  null,
//     waiters: AlphaTableRow[],
//     attempts: Number,
//     notes: string[],
//   }
//
// Identity rules:
//
//   - performance_schema.data_lock_waits uses THREAD_ID.
//     REQUESTING_THREAD_ID and BLOCKING_THREAD_ID are NOT
//     CONNECTION_ID. The caller MUST pass threadId for performance.
//     When threadId is null the observer DOWNGRADES rather than
//     inventing a value.
//
//   - information_schema.PROCESSLIST uses CONNECTION_ID (ID column).
//     The SQL uses `AS ID` so the JS reads `row.ID`. Lower-case
//     aliases here would silently produce undefined JS keys and
//     misclassify idle connections as "non-Sleep".
//
//   - The two columns MUST NOT be substituted for each other. The
//     observer explicitly reads threadId for the perf query and
//     connectionId for the proc query.
//
// Downgrade contract:
//
//   - LOCK_WAIT_OBSERVED: BOTH alpha AND beta appear as waiters in
//     performance_schema.data_lock_waits against the control blocker.
//   - PARTIAL_LOCK_WAIT_OBSERVED: only one waiter is visible.
//   - QUERY_ACTIVITY_OBSERVED: PROCESSLIST shows non-Sleep state for
//     both threads; perf is empty or unavailable.
//   - MULTI_SESSION_CONSISTENCY_VERIFIED: no observation produced.
//
// Polling:
//
//   The observer polls information_schema.PROCESSLIST within a bounded
//   budget. A single empty sample does NOT abort — only exhausting
//   the entire budget aborts. This is necessary because InnoDB may
//   take a moment to surface the lock-wait to PROCESSLIST.

export const LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS = 60;
export const LOCK_OBSERVATION_DEFAULT_POLL_INTERVAL_MS = 50;

export const DOWNGRADE_LABELS = Object.freeze({
  LOCK_WAIT_OBSERVED: 'LOCK_WAIT_OBSERVED',
  PARTIAL_LOCK_WAIT_OBSERVED: 'PARTIAL_LOCK_WAIT_OBSERVED',
  QUERY_ACTIVITY_OBSERVED: 'QUERY_ACTIVITY_OBSERVED',
  MULTI_SESSION_CONSISTENCY_VERIFIED: 'MULTI_SESSION_CONSISTENCY_VERIFIED',
});

function safeInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// SQL constants — column aliases match JS read keys exactly. Any
// future change here MUST be reflected in the unit-test stub.
const PERF_LOCK_WAITS_SQL = `SELECT
    REQUESTING_THREAD_ID waiter,
    BLOCKING_THREAD_ID blocker,
    REQUESTING_ENGINE_TRANSACTION_ID waiter_tx,
    BLOCKING_ENGINE_TRANSACTION_ID blocker_tx
  FROM performance_schema.data_lock_waits
  WHERE REQUESTING_THREAD_ID IN (?, ?)
    AND BLOCKING_THREAD_ID = ?`;

const PROC_PROCESSLIST_SQL = `SELECT ID AS ID, COMMAND AS COMMAND, STATE AS STATE, INFO AS INFO
  FROM information_schema.PROCESSLIST WHERE ID IN (?, ?)`;

const SLEEP_PATTERN = /sleep/i;

// Validate the observer configuration up front. Failures here are
// configuration bugs, not test environment bugs.
function validateObservers(observers) {
  for (const key of ['alpha', 'beta', 'control']) {
    const o = observers && observers[key];
    if (!o || !Number.isInteger(Number(o.connectionId))) {
      throw new Error(
        `Lock observer: observer "${key}" must carry a numeric connectionId; got ${JSON.stringify(o)}`,
      );
    }
    if (o.threadId !== null && o.threadId !== undefined && !Number.isInteger(Number(o.threadId))) {
      throw new Error(
        `Lock observer: observer "${key}".threadId must be null or a safe integer; got ${JSON.stringify(o)}`,
      );
    }
  }
}

// Tier 1 — performance_schema.data_lock_waits. We require both
// alpha AND beta THREAD_IDs to appear as REQUESTING_THREAD_ID with
// the control THREAD_ID as BLOCKING_THREAD_ID. A single waiter
// row downgrades to PARTIAL_LOCK_WAIT_OBSERVED.
function queryPerformanceSchema(db, alphaThreadId, betaThreadId, controlThreadId) {
  let rows = [];
  let perfAvailable = true;
  try {
    rows = db.prepare(PERF_LOCK_WAITS_SQL).all(alphaThreadId, betaThreadId, controlThreadId);
  } catch (error) {
    perfAvailable = false;
    void error;
  }
  return { rows, perfAvailable };
}

// Tier 2 — information_schema.PROCESSLIST. Column aliases are
// upper-case to match the JS reads below. Lower-case aliases would
// produce undefined JS keys and falsely classify idle connections as
// "non-Sleep". The observation here is auxiliary evidence; it can
// never reach LOCK_WAIT_OBSERVED.
async function pollProcesslist(db, alphaConnectionId, betaConnectionId, attempts, intervalMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let procRows = [];
    let procAvailable = true;
    try {
      procRows = db.prepare(PROC_PROCESSLIST_SQL).all(alphaConnectionId, betaConnectionId);
    } catch (error) {
      procAvailable = false;
      void error;
    }
    if (!procAvailable) return { observed: false, attempts: attempt + 1 };
    const byId = new Map(procRows.map((row) => [Number(row.ID), row]));
    const alpha = byId.get(Number(alphaConnectionId));
    const beta = byId.get(Number(betaConnectionId));
    const bothActive = alpha && beta
      && alpha.COMMAND !== 'Sleep' && beta.COMMAND !== 'Sleep'
      && !SLEEP_PATTERN.test(String(alpha.STATE || ''))
      && !SLEEP_PATTERN.test(String(beta.STATE || ''));
    if (bothActive) {
      return {
        observed: true,
        attempts: attempt + 1,
        alpha,
        beta,
      };
    }
    sleepMs(intervalMs);
  }
  return { observed: false, attempts };
}

// Public entry point. Returns one of the four documented labels.
export async function observeLockWait(db, observers, options = {}) {
  validateObservers(observers);
  const pollAttempts = Number.isSafeInteger(options.pollAttempts)
    ? options.pollAttempts
    : LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS;
  const pollIntervalMs = Number.isSafeInteger(options.pollIntervalMs)
    ? options.pollIntervalMs
    : LOCK_OBSERVATION_DEFAULT_POLL_INTERVAL_MS;

  const alphaThreadId = observers.alpha.threadId;
  const betaThreadId = observers.beta.threadId;
  const controlThreadId = observers.control.threadId;
  const alphaConnectionId = observers.alpha.connectionId;
  const betaConnectionId = observers.beta.connectionId;

  // Tier 1 — only meaningful when all three threadIds are known.
  // When any threadId is null we cannot join data_lock_waits safely;
  // we MUST NOT fabricate a threadId from connectionId.
  const allThreadIdsKnown = Number.isInteger(alphaThreadId)
    && Number.isInteger(betaThreadId)
    && Number.isInteger(controlThreadId);
  if (allThreadIdsKnown) {
    const { rows, perfAvailable } = queryPerformanceSchema(
      db, alphaThreadId, betaThreadId, controlThreadId,
    );
    if (perfAvailable && rows.length >= 1) {
      const waiters = rows.map((row) => ({
        waiter: safeInteger(row.waiter),
        blocker: safeInteger(row.blocker),
        waiterTx: String(row.waiter_tx ?? ''),
        blockerTx: String(row.blocker_tx ?? ''),
      })).filter((w) => w.waiter !== null && w.blocker !== null);
      const alphaSeen = waiters.some((w) => w.waiter === Number(alphaThreadId));
      const betaSeen = waiters.some((w) => w.waiter === Number(betaThreadId));
      if (alphaSeen && betaSeen) {
        return {
          kind: 'PERFORMANCE_SCHEMA',
          observed: true,
          downgradeTo: null,
          waiters,
          attempts: 1,
        };
      }
      // One waiter only — never claim LOCK_WAIT_OBSERVED.
      return {
        kind: 'PERFORMANCE_SCHEMA',
        observed: false,
        downgradeTo: DOWNGRADE_LABELS.PARTIAL_LOCK_WAIT_OBSERVED,
        waiters,
        attempts: 1,
        notes: ['only one business worker appears as a waiter; the other may have committed'],
      };
    }
    if (!perfAvailable) {
      // performance_schema may not be readable. Fall through to
      // PROCESSLIST.
    } else {
      // perfAvailable but rows.length is 0. The workers may not yet
      // have been instrumented. We could fall through to PROCESSLIST
      // but the user wants bounded polling only — not an unbounded
      // fallback. We continue with Tier 2 below.
    }
  }

  // Tier 2 — PROCESSLIST (auxiliary evidence only).
  const proc = await pollProcesslist(db, alphaConnectionId, betaConnectionId, pollAttempts, pollIntervalMs);
  if (proc.observed) {
    return {
      kind: 'PROCESSLIST',
      observed: false,
      downgradeTo: DOWNGRADE_LABELS.QUERY_ACTIVITY_OBSERVED,
      attempts: proc.attempts,
      waiters: [
        {
          waiter: Number(proc.alpha.ID),
          blocker: Number(observers.control.connectionId),
          command: String(proc.alpha.COMMAND),
          state: String(proc.alpha.STATE || ''),
          infoSnippet: String(proc.alpha.INFO || '').slice(0, 120),
        },
        {
          waiter: Number(proc.beta.ID),
          blocker: Number(observers.control.connectionId),
          command: String(proc.beta.COMMAND),
          state: String(proc.beta.STATE || ''),
          infoSnippet: String(proc.beta.INFO || '').slice(0, 120),
        },
      ],
      notes: ['PROCESSLIST alone never proves a row-lock wait; no LOCK_WAIT_OBSERVED'],
    };
  }

  // Neither source produced a sufficient observation within the
  // bounded budget. Do NOT fabricate LOCK_WAIT_OBSERVED.
  const notes = [];
  if (!allThreadIdsKnown) notes.push('one or more threadIds unavailable; Tier 1 skipped');
  if (proc.attempts >= pollAttempts) notes.push(`PROCESSLIST polling exhausted ${proc.attempts} attempts`);
  return {
    kind: 'PROCESSLIST',
    observed: false,
    downgradeTo: DOWNGRADE_LABELS.MULTI_SESSION_CONSISTENCY_VERIFIED,
    attempts: proc.attempts,
    waiters: [],
    notes,
  };
}

// Tier 1 helper exported for unit tests that want to inject a
// processlist response queue (i.e. first N samples empty, then later
// samples have rows). The unit test should still call observeLockWait
// for the end-to-end contract.
export function queryPerformanceSchemaRows(db, alphaThreadId, betaThreadId, controlThreadId) {
  return queryPerformanceSchema(db, alphaThreadId, betaThreadId, controlThreadId);
}