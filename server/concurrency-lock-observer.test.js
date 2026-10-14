// Unit tests for the canonical Lock Observer
// (server/test-utils/sales-wave1-lock-observer.js). This file imports
// the SAME module the live integration test imports — there is no
// duplicate implementation. Any contract change must happen in the
// shared module; this file then exercises it.
//
// Coverage (negative + positive):
//   1. CONNECTION_ID and THREAD_ID values are distinct integers
//      (the integration test must resolve them separately).
//   2. PROCESSLIST uses CONNECTION_ID only — performance_schema uses
//      THREAD_ID only. The two MUST NOT be substituted.
//   3. The integration test never reads `row.id`; it reads `row.ID`.
//      A stub returning lowercase `id` must NOT be matched.
//   4. Idle / Sleep connections in PROCESSLIST must not become lock-wait
//      evidence.
//   5. A single-waiter row downgrades to PARTIAL_LOCK_WAIT_OBSERVED.
//   6. Two-waiter rows (alpha + beta both blocked on control) yields
//      LOCK_WAIT_OBSERVED.
//   7. The first sample may be empty but a later poll may produce
//      the observation — bounded polling, not one-shot.
//   8. performance_schema unavailable yields MULTI_SESSION_CONSISTENCY
//      _VERIFIED (PROCESSLIST downgrade).
//   9. Observation timeout must NOT claim a full LOCK_WAIT_OBSERVED
//      when the budget is exhausted.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  observeLockWait,
  LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS,
  DOWNGRADE_LABELS,
} from './test-utils/sales-wave1-lock-observer.js';

// Adapter stub. The shared module's SQL constants drive the dispatch
// in this stub — the column names in PERF_LOCK_WAITS_SQL and
// PROC_PROCESSLIST_SQL must match what the stub returns.
function makeStubDb({
  perfRows = [],
  procRowsSequence = [procRowsSequence_default],
  perfThrows = false,
  procThrows = false,
} = {}) {
  // Default PROCESSLIST row sequence is a function returning the
  // same rows every poll; tests can pass an array of sequences to
  // simulate "first empty, then rows" polling.
  let procIndex = 0;
  return {
    prepare(sql) {
      const lower = sql.toLowerCase();
      return {
        all() {
          if (lower.includes('from performance_schema.data_lock_waits')) {
            if (perfThrows) throw new Error('SELECT denied on performance_schema.data_lock_waits');
            return perfRows;
          }
          if (lower.includes('from information_schema.processlist')) {
            if (procThrows) throw new Error('SELECT denied on information_schema.processlist');
            const seq = procRowsSequence;
            const rows = typeof seq === 'function' ? seq(procIndex) : seq[procIndex] ?? seq[seq.length - 1];
            procIndex += 1;
            return rows;
          }
          throw new Error(`unknown query in stub: ${sql.slice(0, 80)}`);
        },
      };
    },
    _procIndex: () => procIndex,
  };
}

function procRowsSequence_default() {
  return [];
}

// Identifiers from the integration test before/after blocks.
const alphaConn = 1001;
const betaConn = 1002;
const controlConn = 1003;
// THREAD_IDs are NOT the same as CONNECTION_IDs. They live in
// performance_schema.threads and are assigned by the instrumented
// worker processes.
const alphaThreadId = 2001;
const betaThreadId = 2002;
const controlThreadId = 2003;

const observers = {
  alpha: { connectionId: alphaConn, threadId: alphaThreadId },
  beta: { connectionId: betaConn, threadId: betaThreadId },
  control: { connectionId: controlConn, threadId: controlThreadId },
};

describe('Shared Lock Observer — identity rules and downgrade coverage', () => {
  test('CONNECTION_ID and THREAD_ID values are distinct integers', () => {
    // The integration test passes { connectionId, threadId } pairs. They
    // MUST NOT be substituted; this test pins that they are integers
    // and distinct for the canonical observer shape.
    for (const role of ['alpha', 'beta', 'control']) {
      const o = observers[role];
      assert.ok(Number.isSafeInteger(o.connectionId),
        `${role}.connectionId must be a safe integer`);
      assert.ok(Number.isSafeInteger(o.threadId),
        `${role}.threadId must be a safe integer`);
      assert.notEqual(o.connectionId, o.threadId,
        `${role} CONNECTION_ID and THREAD_ID must be distinct identities`);
    }
    assert.notEqual(observers.alpha.threadId, observers.control.threadId,
      'alpha THREAD_ID and control THREAD_ID must be distinct');
  });

  test('PROCESSLIST uses CONNECTION_ID only; performance_schema uses THREAD_ID only', async () => {
    // The stub records the IDs that the observer actually passes. We
    // assert the dispatch passed the right IDs to each query.
    let perfSeenArgs = null;
    let procSeenArgs = null;
    const recordingDb = {
      prepare(sql) {
        const lower = sql.toLowerCase();
        return {
          all(...args) {
            if (lower.includes('from performance_schema.data_lock_waits')) {
              perfSeenArgs = args;
              return [];
            }
            if (lower.includes('from information_schema.processlist')) {
              procSeenArgs = args;
              return [];
            }
            throw new Error('unknown query in stub');
          },
        };
      },
    };
    const out = await observeLockWait(recordingDb, observers,
      { pollAttempts: 1, pollIntervalMs: 1 });
    // performance_schema.data_lock_waits is queried with THREAD_IDs.
    assert.deepEqual(perfSeenArgs, [alphaThreadId, betaThreadId, controlThreadId],
      `data_lock_waits must receive THREAD_IDs, got ${JSON.stringify(perfSeenArgs)}`);
    // information_schema.PROCESSLIST is queried with CONNECTION_IDs.
    assert.deepEqual(procSeenArgs, [alphaConn, betaConn],
      `PROCESSLIST must receive CONNECTION_IDs, got ${JSON.stringify(procSeenArgs)}`);
    // Performance schema returned empty; PROCESSLIST returned empty;
    // no observation produced. Must downgrade (never fabricate).
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.MULTI_SESSION_CONSISTENCY_VERIFIED);
  });

  test('a stub returning lowercase `id` does not produce a row match', async () => {
    // The integration test reads `row.ID` (upper-case alias). A stub
    // returning `{id: ...}` (lowercase) represents a buggy adapter; the
    // observer must NOT silently produce a match. The processlist
    // polling here returns rows with lowercase `id` keys; the observer
    // must downgrade because `row.ID` is undefined.
    const db = makeStubDb({
      procRowsSequence: [
        [{ id: alphaConn, COMMAND: 'Query', STATE: 'Sending data', INFO: 'SELECT 1' },
         { id: betaConn,  COMMAND: 'Query', STATE: 'Sending data', INFO: 'SELECT 1' }],
      ],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 1, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.notEqual(out.downgradeTo, DOWNGRADE_LABELS.QUERY_ACTIVITY_OBSERVED,
      `lower-case 'id' alias must not be matched: got ${out.downgradeTo}`);
  });

  test('idle (Sleep) connections do NOT yield LOCK_WAIT_OBSERVED', async () => {
    const db = makeStubDb({
      procRowsSequence: () => [
        { ID: alphaConn,  COMMAND: 'Sleep', STATE: '',          INFO: null },
        { ID: betaConn,   COMMAND: 'Sleep', STATE: '',          INFO: null },
      ],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 2, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.MULTI_SESSION_CONSISTENCY_VERIFIED);
    assert.deepEqual(out.waiters, []);
  });

  test('a single performance_schema.data_lock_waits row downgrades to PARTIAL_LOCK_WAIT_OBSERVED', async () => {
    const db = makeStubDb({
      perfRows: [
        { waiter: alphaThreadId, blocker: controlThreadId, waiter_tx: 'tx-w', blocker_tx: 'tx-b' },
      ],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 1, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.PARTIAL_LOCK_WAIT_OBSERVED);
    assert.equal(out.waiters.length, 1);
  });

  test('two performance_schema.data_lock_waits rows (alpha + beta both waiting) yields LOCK_WAIT_OBSERVED', async () => {
    const db = makeStubDb({
      perfRows: [
        { waiter: alphaThreadId, blocker: controlThreadId, waiter_tx: 'tx-a', blocker_tx: 'tx-c' },
        { waiter: betaThreadId,  blocker: controlThreadId, waiter_tx: 'tx-b', blocker_tx: 'tx-c' },
      ],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 1, pollIntervalMs: 1 });
    assert.equal(out.observed, true);
    assert.equal(out.kind, 'PERFORMANCE_SCHEMA');
    assert.equal(out.downgradeTo, null);
    const waiters = out.waiters.map((w) => w.waiter).sort();
    assert.deepEqual(waiters, [alphaThreadId, betaThreadId]);
  });

  test('first empty poll, second poll produces the observation (bounded polling)', async () => {
    // The observer must NOT conclude "no wait" after a single empty
    // sample. Subsequent polls within the budget may surface the
    // observation.
    const db = makeStubDb({
      procRowsSequence: [
        // First sample: empty
        [],
        // Second sample: both threads in active Query
        [
          { ID: alphaConn, COMMAND: 'Query', STATE: 'Sending data', INFO: 'SELECT 1' },
          { ID: betaConn,  COMMAND: 'Query', STATE: 'Sending data', INFO: 'SELECT 1' },
        ],
      ],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 5, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.QUERY_ACTIVITY_OBSERVED);
    assert.equal(out.attempts >= 2, true,
      `observer must poll at least twice; attempts=${out.attempts}`);
  });

  test('performance_schema unavailable yields MULTI_SESSION_CONSISTENCY_VERIFIED', async () => {
    const db = makeStubDb({
      perfThrows: true,
      procRowsSequence: () => [],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 2, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.MULTI_SESSION_CONSISTENCY_VERIFIED);
  });

  test('observation timeout does NOT fabricate a full LOCK_WAIT_OBSERVED', async () => {
    // The budget is exhausted with no observable evidence. The
    // observer MUST NOT escalate to LOCK_WAIT_OBSERVED; it downgrades.
    const db = makeStubDb({
      procRowsSequence: () => [],
    });
    const out = await observeLockWait(db, observers,
      { pollAttempts: 3, pollIntervalMs: 1 });
    assert.equal(out.observed, false);
    assert.notEqual(out.downgradeTo, null,
      `timeout must downgrade, never null; got ${out.downgradeTo}`);
    assert.notEqual(out.downgradeTo, DOWNGRADE_LABELS.LOCK_WAIT_OBSERVED,
      `timeout must NOT produce LOCK_WAIT_OBSERVED; got ${out.downgradeTo}`);
    assert.equal(out.attempts, 3, 'attempts must reflect the configured budget');
  });

  test('threadId=null for any worker downgrades to MULTI_SESSION_CONSISTENCY_VERIFIED without fabricating THREAD_IDs', async () => {
    // The integration test resolves CONNECTION_ID → THREAD_ID via
    // performance_schema.threads. If the mapping fails (privilege
    // error), threadId is null. The observer must NOT fabricate a
    // THREAD_ID from the CONNECTION_ID — it must skip Tier 1 entirely.
    let perfQueryArgs = null;
    const recordingDb = {
      prepare(sql) {
        const lower = sql.toLowerCase();
        return {
          all(...args) {
            if (lower.includes('from performance_schema.data_lock_waits')) {
              perfQueryArgs = args;
              return [];
            }
            if (lower.includes('from information_schema.processlist')) {
              return [];
            }
            throw new Error('unknown query in stub');
          },
        };
      },
    };
    const partialObservers = {
      alpha: { connectionId: alphaConn, threadId: null },
      beta: { connectionId: betaConn, threadId: betaThreadId },
      control: { connectionId: controlConn, threadId: controlThreadId },
    };
    const out = await observeLockWait(recordingDb, partialObservers,
      { pollAttempts: 1, pollIntervalMs: 1 });
    assert.equal(perfQueryArgs, null,
      `data_lock_waits must NOT be queried when any threadId is null; got ${JSON.stringify(perfQueryArgs)}`);
    assert.equal(out.observed, false);
    assert.equal(out.downgradeTo, DOWNGRADE_LABELS.MULTI_SESSION_CONSISTENCY_VERIFIED);
  });

  test('default poll budget matches the documented constant', () => {
    assert.equal(typeof LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS, 'number');
    assert.ok(LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS >= 1);
  });
});