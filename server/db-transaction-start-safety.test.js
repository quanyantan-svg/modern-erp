// Transaction Lifecycle Safety — deterministic fault-injection coverage.
//
// document.md §5.4.1-§5.4.2, solution.md §37.30-§37.31.
//
// These cases prove CONTROL FLOW and the Worker/adapter contract only. They
// never open a real MySQL connection, so they prove nothing about real InnoDB
// behaviour, real server-side lock release or real contention. The protected
// real-session evidence is the A-TXLIFE fixture
// (server/mysql-transaction-start-safety.integration.js) which runs only
// through the guarded Gate A runner.
//
// The fake database below is a stub of the MySQL adapter contract, not a
// re-implementation of it: it models `sessionState`, `sessionEpoch`,
// `isTransaction`, `quarantine()` and the `RELEASE_LOCK` result so that the
// lifecycle logic in server/db.js is exercised against the same vocabulary the
// real adapter publishes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MYSQL_TRANSACTION_ADMISSION_REFUSED,
  readTransaction,
  releaseMySqlIdempotencyLocks,
  transaction,
} from './db.js';
import { idempotencyReplay } from './modules/financial-controls.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureUrl = new URL('./database/test-fixtures/delayed-exec-mysql-worker.js', import.meta.url);

const RETRYABLE_MYSQL_ERROR = Object.assign(new Error('Deadlock found when trying to get lock'), {
  code: 'ER_LOCK_DEADLOCK',
  errno: 1213,
  sqlState: '40001',
});

// --- fake MySQL adapter contract -------------------------------------------

function createFakeMySqlDb(options = {}) {
  const {
    sessionState = 'IDLE_TRUSTED',
    sessionEpoch = 1,
    releaseOutcome = 1,
    releaseError = null,
    releaseEpochBump = 0,
    beginError = null,
    commitError = null,
    rollbackError = null,
    gateRow = { gate_id: 1 },
    idempotencyRow = undefined,
    idempotencyError = null,
  } = options;

  const events = [];
  const state = { beginError, commitError, rollbackError };
  const db = {
    dialect: 'mysql',
    isTransaction: false,
    sessionState,
    sessionEpoch,
    quarantined: false,
    quarantineReason: null,
    quarantineState: null,
    admissionRefusalCount: 0,
    _idempotencyLocks: new Set(),
    events,
    exec(sql) {
      events.push(sql);
      const head = String(sql).trim().toUpperCase();
      if (head.startsWith('BEGIN')) {
        if (state.beginError) { const error = state.beginError; state.beginError = null; throw error; }
        db.isTransaction = true;
        db.sessionState = 'ACTIVE';
        return { ok: true };
      }
      if (head.startsWith('COMMIT')) {
        if (state.commitError) { const error = state.commitError; state.commitError = null; throw error; }
        db.isTransaction = false;
        db.sessionState = 'IDLE_TRUSTED';
        return { ok: true };
      }
      if (head.startsWith('ROLLBACK')) {
        if (state.rollbackError) { const error = state.rollbackError; state.rollbackError = null; throw error; }
        db.isTransaction = false;
        db.sessionState = 'IDLE_TRUSTED';
        return { ok: true };
      }
      return { ok: true };
    },
    prepare(sql) {
      events.push(sql);
      return {
        get(...params) {
          if (/GET_LOCK/i.test(sql)) { events.push(`GET_LOCK:${params[0]}`); return { acquired: 1 }; }
          if (/RELEASE_LOCK/i.test(sql)) {
            events.push(`RELEASE_LOCK:${params[0]}`);
            if (releaseError) throw releaseError;
            if (releaseEpochBump) db.sessionEpoch += releaseEpochBump;
            return { released: releaseOutcome };
          }
          if (/idempotency_records/i.test(sql)) {
            if (idempotencyError) throw idempotencyError;
            return idempotencyRow;
          }
          if (/mysql_transaction_gates/i.test(sql)) { events.push('GATE_ACQUIRED'); return gateRow; }
          return {};
        },
      };
    },
    quarantine(reason) {
      db.quarantined = true;
      db.quarantineReason = reason;
      db.sessionState = 'QUARANTINED';
      db.quarantineState = { reason, state: 'TERMINATION_PENDING', termination: Promise.resolve() };
      return db.quarantineState;
    },
  };
  return db;
}

function createFakeSqliteDb(options = {}) {
  const { beginError = null } = options;
  const events = [];
  const db = {
    dialect: 'sqlite',
    isTransaction: false,
    sessionState: undefined,
    events,
    exec(sql) {
      events.push(sql);
      if (String(sql).trim().toUpperCase().startsWith('BEGIN')) {
        if (beginError) throw beginError;
        db.isTransaction = true;
      } else if (/COMMIT|ROLLBACK/.test(String(sql).trim().toUpperCase())) {
        db.isTransaction = false;
      }
      return { ok: true };
    },
    prepare(sql) {
      events.push(sql);
      return { get() { return { gate_id: 1 }; } };
    },
  };
  return db;
}

// --- A1 ---------------------------------------------------------------------

test('A1 normal BEGIN runs the L0 gate, the work and COMMIT, and verifies the release', () => {
  const db = createFakeMySqlDb();
  db._idempotencyLocks.add('lock-1');
  const result = transaction(db, () => 'ok');
  assert.equal(result, 'ok');
  assert.deepEqual(db.events, [
    'BEGIN IMMEDIATE',
    'SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE',
    'GATE_ACQUIRED',
    'COMMIT',
    'SELECT RELEASE_LOCK(?) released',
    'RELEASE_LOCK:lock-1',
  ]);
  assert.equal(db._idempotencyLocks.size, 0);
  assert.equal(db.quarantined, false);
  assert.equal(db.admissionRefusalCount, 0);
});

// --- A2 ---------------------------------------------------------------------

test('A2 a foreign or pre-existing transaction refuses BEGIN and quarantines the adapter', () => {
  const db = createFakeMySqlDb({ sessionState: 'ACTIVE' });
  let caught;
  try { transaction(db, () => 'never'); } catch (error) { caught = error; }
  assert.ok(caught, 'the admission must fail closed');
  assert.equal(caught.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
  assert.equal(caught.reason, 'SESSION_TRANSACTION_ACTIVE');
  assert.ok(!db.events.includes('BEGIN IMMEDIATE'), 'no BEGIN may be issued');
  assert.ok(!db.events.some((event) => String(event).startsWith('ROLLBACK')), 'a foreign transaction must never be rolled back');
  assert.equal(db.quarantined, true);
  assert.equal(db.admissionRefusalCount, 1);
});

test('A2b an uncertain session and a quarantined adapter also refuse BEGIN', () => {
  const uncertain = createFakeMySqlDb({ sessionState: 'UNCERTAIN' });
  let caught;
  try { transaction(uncertain, () => 'never'); } catch (error) { caught = error; }
  assert.equal(caught.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
  assert.equal(caught.reason, 'SESSION_STATE_UNCERTAIN');
  assert.equal(uncertain.quarantined, true);

  const quarantined = createFakeMySqlDb({ sessionState: 'QUARANTINED' });
  quarantined.quarantined = true;
  let caughtQuarantined;
  try { transaction(quarantined, () => 'never'); } catch (error) { caughtQuarantined = error; }
  assert.equal(caughtQuarantined.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
  assert.equal(caughtQuarantined.reason, 'ADAPTER_QUARANTINED');
  assert.ok(!quarantined.events.includes('BEGIN IMMEDIATE'));
});

// --- A3 ---------------------------------------------------------------------

test('A3 a known BEGIN failure preserves the original exception and issues no COMMIT or ROLLBACK', () => {
  const startupError = Object.assign(new Error('MySQL deadlock on start'), { code: 'ER_LOCK_DEADLOCK' });
  const db = createFakeMySqlDb({ beginError: startupError });
  db._idempotencyLocks.add('lock-1');
  let caught;
  try { transaction(db, () => 'never'); } catch (error) { caught = error; }
  assert.equal(caught, startupError, 'the original exception instance must be preserved');
  assert.ok(!db.events.includes('COMMIT'));
  assert.ok(!db.events.some((event) => String(event).startsWith('ROLLBACK')));
  assert.equal(caught.transactionRetryExhausted, undefined);
  assert.equal(caught.transactionAttempts, undefined);
});

// --- A4 ---------------------------------------------------------------------

test('A4 a BEGIN timeout quarantines the adapter and issues no further statement', async () => {
  const adapter = new MySqlSyncAdapter({}, { workerUrl: fixtureUrl, requestTimeoutMs: 2000 });
  try {
    adapter.requestTimeoutMs = 50;
    let caught;
    try { transaction(adapter, () => 'never'); } catch (error) { caught = error; }
    assert.ok(caught, 'the timeout must propagate');
    assert.equal(caught.mysqlRequestTimeout, true);
    assert.equal(adapter.quarantined, true);
    assert.equal(adapter.quarantineState.reason, 'transaction_start_timeout');
    assert.equal(adapter.sessionState, 'QUARANTINED');
    assert.throws(() => adapter.prepare('SELECT 1').get(), (error) => error.code === 'MYSQL_SESSION_QUARANTINED');
  } finally {
    adapter.close();
  }
});

// --- A5 ---------------------------------------------------------------------

test('A5 an owned GET_LOCK at startup failure is released and verified', () => {
  const db = createFakeMySqlDb({ beginError: new Error('start refused') });
  db._idempotencyLocks.add('erp-idem-abc');
  let caught;
  try { transaction(db, () => 'never'); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.ok(db.events.includes('RELEASE_LOCK:erp-idem-abc'));
  assert.equal(db._idempotencyLocks.size, 0);
  assert.equal(db.quarantined, false);
});

// --- A6 / A7 / A8 -----------------------------------------------------------

test('A6 RELEASE_LOCK = 1 is a confirmed release and keeps the adapter reusable', () => {
  const db = createFakeMySqlDb({ releaseOutcome: 1 });
  db._idempotencyLocks.add('lock-1');
  const result = releaseMySqlIdempotencyLocks(db);
  assert.equal(result.verified.length, 1);
  assert.equal(result.unverified.length, 0);
  assert.equal(db._idempotencyLocks.size, 0);
  assert.equal(db.quarantined, false);
});

test('A7 RELEASE_LOCK = 0 and NULL are not verified and quarantine the adapter', () => {
  for (const outcome of [0, null]) {
    const db = createFakeMySqlDb({ releaseOutcome: outcome });
    db._idempotencyLocks.add('lock-1');
    const result = releaseMySqlIdempotencyLocks(db);
    assert.equal(result.verified.length, 0);
    assert.equal(result.unverified.length, 1);
    assert.equal(result.quarantined, true);
    assert.equal(db.quarantined, true);
    assert.equal(db._idempotencyLocks.size, 1, 'unresolved ownership must stay registered');
  }
});

test('A8 a RELEASE_LOCK exception is not verified and quarantines the adapter', () => {
  const db = createFakeMySqlDb({ releaseError: new Error('driver exception') });
  db._idempotencyLocks.add('lock-1');
  const result = releaseMySqlIdempotencyLocks(db);
  assert.equal(result.verified.length, 0);
  assert.equal(result.unverified[0].outcome, 'ERROR');
  assert.equal(db.quarantined, true);
  assert.equal(db._idempotencyLocks.size, 1);
});

// --- A9 / A10 ---------------------------------------------------------------

test('A9 a normal COMMIT releases the registered lock through the verified contract', () => {
  const db = createFakeMySqlDb();
  db._idempotencyLocks.add('lock-1');
  transaction(db, () => 'committed');
  assert.ok(db.events.includes('RELEASE_LOCK:lock-1'));
  assert.equal(db._idempotencyLocks.size, 0);
  assert.equal(db.quarantined, false);
});

test('A10 a COMMIT success followed by a release failure keeps the committed result and quarantines the connection', () => {
  const db = createFakeMySqlDb({ releaseOutcome: 0 });
  db._idempotencyLocks.add('lock-1');
  const result = transaction(db, () => 'committed');
  assert.equal(result, 'committed', 'the committed success must still be returned');
  assert.equal(db.quarantined, true);
  assert.equal(db.quarantineReason, 'idempotency_lock_release_unverified');
  assert.equal(db._idempotencyLocks.size, 1);
  assert.ok(!db.events.some((event) => String(event).includes('work')), 'the committed work is never re-run');
});

// --- A11 / A12 --------------------------------------------------------------

test('A11 a proven rollback admits the existing inner retry', () => {
  const db = createFakeMySqlDb();
  let calls = 0;
  const result = transaction(db, () => {
    calls += 1;
    if (calls === 1) throw RETRYABLE_MYSQL_ERROR;
    return 'second attempt';
  });
  assert.equal(result, 'second attempt');
  assert.equal(calls, 2);
  assert.equal(db.events.filter((event) => event === 'BEGIN IMMEDIATE').length, 2);
  assert.equal(db.events.filter((event) => event === 'ROLLBACK').length, 1);
  assert.equal(db.quarantined, false);
});

test('A12 a failed rollback admits no further BEGIN and keeps the primary exception', () => {
  const db = createFakeMySqlDb({ rollbackError: new Error('rollback refused') });
  let calls = 0;
  let caught;
  try {
    transaction(db, () => { calls += 1; throw RETRYABLE_MYSQL_ERROR; });
  } catch (error) { caught = error; }
  assert.equal(calls, 1);
  assert.equal(caught, RETRYABLE_MYSQL_ERROR, 'the primary business exception must be preserved');
  assert.equal(db.events.filter((event) => event === 'BEGIN IMMEDIATE').length, 1, 'no further BEGIN may be issued');
  assert.equal(db.quarantined, true);
  assert.equal(db.quarantineReason, 'rollback_failed');
  assert.equal(caught.transactionRetryExhausted, undefined, 'a terminal rollback failure is not a retry exhaustion');
});

// --- A13 --------------------------------------------------------------------

test('A13 a read-transaction startup failure preserves the original error and releases no named lock', () => {
  const startupError = new Error('read start refused');
  const db = createFakeMySqlDb({ beginError: startupError });
  db._idempotencyLocks.add('outer-lock');
  let caught;
  try { readTransaction(db, () => 'never'); } catch (error) { caught = error; }
  assert.equal(caught, startupError);
  assert.ok(!db.events.some((event) => String(event).startsWith('ROLLBACK')), 'no foreign transaction may be rolled back');
  assert.ok(!db.events.includes('RELEASE_LOCK:outer-lock'), 'the read path releases no named lock');
  assert.equal(db._idempotencyLocks.size, 1);
});

test('A13b a normal read transaction keeps the L0 shared lock and its result semantics', () => {
  const db = createFakeMySqlDb();
  const result = readTransaction(db, () => 7);
  assert.equal(result, 7);
  assert.deepEqual(db.events, [
    'BEGIN',
    'SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 LOCK IN SHARE MODE',
    'GATE_ACQUIRED',
    'COMMIT',
  ]);
});

// --- A14 --------------------------------------------------------------------

test('A14 a Finance replay hit releases the lock through the verified contract and keeps the 200 replay', () => {
  const db = createFakeMySqlDb({
    idempotencyRow: { request_fingerprint: 'fp-1', result_json: JSON.stringify({ id: 'refund-1', refundNo: 'CREF-1' }) },
  });
  const replay = idempotencyReplay(db, 'REFUND_CONFIRM', 'CUSTOMER:balance-1', 'key-1', 'fp-1');
  assert.deepEqual(replay, { id: 'refund-1', refundNo: 'CREF-1' });
  const lockName = db.events.find((event) => String(event).startsWith('GET_LOCK:')).slice('GET_LOCK:'.length);
  assert.ok(db.events.includes(`RELEASE_LOCK:${lockName}`), 'the acquired lock must be released');
  assert.equal(db._idempotencyLocks.size, 0);
  assert.equal(db.quarantined, false);
});

test('A14b a Finance replay miss retains the lock for the transaction lifecycle', () => {
  const db = createFakeMySqlDb({ idempotencyRow: undefined });
  const replay = idempotencyReplay(db, 'REFUND_CONFIRM', 'CUSTOMER:balance-1', 'key-1', 'fp-1');
  assert.equal(replay, null);
  assert.equal(db._idempotencyLocks.size, 1, 'a replay miss must not release the lock early');
  assert.ok(!db.events.some((event) => String(event).startsWith('RELEASE_LOCK:')));
});

test('A14c a Finance fingerprint conflict keeps the 409 and releases through the shared contract', () => {
  const db = createFakeMySqlDb({
    idempotencyRow: { request_fingerprint: 'fp-other', result_json: '{}' },
  });
  let caught;
  try {
    idempotencyReplay(db, 'REFUND_CONFIRM', 'CUSTOMER:balance-1', 'key-1', 'fp-1');
  } catch (error) { caught = error; }
  assert.equal(caught.status, 409);
  assert.equal(caught.code, 'BUSINESS_RULE_BLOCKED');
  assert.equal(db._idempotencyLocks.size, 0);
});

test('A14d a Finance lookup exception keeps the original error and retires the connection when the release is unverified', () => {
  const lookupError = new Error('idempotency lookup failed');
  const db = createFakeMySqlDb({ idempotencyError: lookupError, releaseOutcome: 0 });
  let caught;
  try {
    idempotencyReplay(db, 'REFUND_CONFIRM', 'CUSTOMER:balance-1', 'key-1', 'fp-1');
  } catch (error) { caught = error; }
  assert.equal(caught, lookupError, 'the original lookup exception must be preserved');
  assert.equal(db.quarantined, true);
  assert.equal(db._idempotencyLocks.size, 1);
});

// --- A15 / A16 / A17 / A18 --------------------------------------------------

test('A15 a Worker completion that arrives after the adapter timed out cannot publish transaction state', async () => {
  const adapter = new MySqlSyncAdapter({}, { workerUrl: fixtureUrl, requestTimeoutMs: 2000 });
  try {
    const lateCompletion = new Promise((done) => {
      adapter.worker.on('message', (message) => {
        if (message?.event === 'exec-completed') done(message);
      });
    });
    adapter.requestTimeoutMs = 50;
    assert.throws(() => adapter.exec('BEGIN IMMEDIATE'), /timed out/);
    assert.equal(adapter.isTransaction, false, 'the abandoned generation must not publish transaction state');
    assert.equal(adapter.sessionState, 'UNCERTAIN');
    const completed = await lateCompletion;
    assert.equal(completed.classification, 'BEGIN');
    assert.equal(adapter.isTransaction, false, 'the late completion must stay discarded');
  } finally {
    adapter.close();
  }
});

test('A16 a quarantined adapter rejects every further business statement', async () => {
  const adapter = new MySqlSyncAdapter({}, { workerUrl: fixtureUrl, requestTimeoutMs: 2000 });
  try {
    adapter.quarantine('test_quarantine');
    assert.equal(adapter.quarantined, true);
    assert.throws(() => adapter.prepare('SELECT 1').get(), (error) => error.code === 'MYSQL_SESSION_QUARANTINED');
    assert.throws(() => adapter.exec('BEGIN IMMEDIATE'), (error) => error.code === 'MYSQL_SESSION_QUARANTINED');
  } finally {
    adapter.close();
  }
});

test('A17 the bounded teardown reports PENDING and then CONFIRMED', async () => {
  const adapter = new MySqlSyncAdapter({}, { workerUrl: fixtureUrl, requestTimeoutMs: 2000 });
  try {
    const state = adapter.quarantine('test_teardown');
    assert.equal(state.state, 'TERMINATION_PENDING');
    await state.termination;
    assert.equal(state.state, 'TERMINATION_CONFIRMED');
    assert.equal(adapter.sessionState, 'TERMINATED');
  } finally {
    adapter.close();
  }
});

test('A18 a quarantined adapter dispatches no further Worker message', async () => {
  const adapter = new MySqlSyncAdapter({}, { workerUrl: fixtureUrl, requestTimeoutMs: 2000 });
  try {
    const received = [];
    adapter.worker.on('message', (message) => {
      if (message?.event === 'request-received') received.push(message.action);
    });
    await new Promise((done) => setTimeout(done, 20));
    const before = received.length;
    adapter.quarantine('test_no_reconnect');
    assert.throws(() => adapter.prepare('SELECT 1').get(), (error) => error.code === 'MYSQL_SESSION_QUARANTINED');
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(received.length, before, 'a quarantined adapter must not dispatch another Worker message');
  } finally {
    adapter.close();
  }
});

// --- A19 --------------------------------------------------------------------

test('A19 the original exception identity is stable across the lifecycle paths', () => {
  const startupError = new Error('identity-start');
  const db = createFakeMySqlDb({ beginError: startupError });
  let caught;
  try { transaction(db, () => 'never'); } catch (error) { caught = error; }
  assert.equal(caught, startupError);

  const workError = new Error('identity-work');
  const second = createFakeMySqlDb();
  let caughtWork;
  try { transaction(second, () => { throw workError; }); } catch (error) { caughtWork = error; }
  assert.equal(caughtWork, workError);
});

// --- A20 --------------------------------------------------------------------

test('A20 a session epoch mismatch is never read as a confirmed release', () => {
  const db = createFakeMySqlDb({ releaseOutcome: 0, releaseEpochBump: 1 });
  db._idempotencyLocks.add('lock-1');
  db._idempotencyLockEpoch = 1;
  const result = releaseMySqlIdempotencyLocks(db);
  assert.equal(result.verified.length, 0, 'a replaced session is never a confirmed release');
  assert.equal(result.sessionReplaced, true);
  assert.equal(result.unverified[0].outcome, 'SESSION_REPLACED');
  assert.equal(db.quarantined, false, 'the owning session is gone, so the lock cannot survive on a reused connection');
});

// --- A21 --------------------------------------------------------------------

test('A21 valid workflows never trigger an admission refusal', () => {
  const db = createFakeMySqlDb();
  transaction(db, () => 'ok');
  assert.equal(db.admissionRefusalCount, 0);
});

// --- A22 --------------------------------------------------------------------

test('A22 the L0 transaction gate is unchanged and still precedes the business work', () => {
  const source = readFileSync(resolve(repoRoot, 'server/db.js'), 'utf8');
  assert.match(source, /SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE/);
  assert.match(source, /SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 LOCK IN SHARE MODE/);
  const gateIndex = source.indexOf('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE');
  const workIndex = source.indexOf('const result = work();');
  assert.ok(gateIndex > 0 && workIndex > gateIndex, 'the L0 gate must still be acquired before the business work');
  const lockOrder = readFileSync(resolve(repoRoot, 'server/modules/sales-prepayment-finance-adapter.js'), 'utf8');
  assert.match(lockOrder, /lockSuffix\(db\)/);
  assert.match(lockOrder, /FOR UPDATE/);
});

// --- A23 --------------------------------------------------------------------

test('A23 SQLite semantics are unchanged: no release, no quarantine, no ROLLBACK on a BEGIN failure', () => {
  const db = createFakeSqliteDb();
  const result = transaction(db, () => 'ok');
  assert.equal(result, 'ok');
  assert.deepEqual(db.events, ['BEGIN IMMEDIATE', 'COMMIT']);

  const startupError = new Error('sqlite begin refused');
  const failing = createFakeSqliteDb({ beginError: startupError });
  let caught;
  try { transaction(failing, () => 'never'); } catch (error) { caught = error; }
  assert.equal(caught, startupError);
  assert.deepEqual(failing.events, ['BEGIN IMMEDIATE'], 'SQLite keeps its literal BEGIN statement');
});

// --- A24 --------------------------------------------------------------------

test('A24 the canonical Finance write order and the M24 replay ordering are unchanged', () => {
  const source = readFileSync(resolve(repoRoot, 'server/modules/financial-controls.js'), 'utf8');
  const replayIndex = source.indexOf('idempotencyReplay(db,');
  const transactionIndex = source.indexOf('transaction(db, () => {');
  assert.ok(replayIndex > 0 && transactionIndex > replayIndex, 'idempotencyReplay still precedes the transaction');
  assert.match(source, /const replay = idempotencyReplay\(db, 'REFUND_CONFIRM', idempotencyScope, key, fingerprint\); if \(replay\) return send\(res, 200, \{ \.\.\.replay, replayed: true \}\);/);
  assert.match(source, /同一幂等键不能用于不同请求内容/);
  assert.match(source, /lockName = `erp-idem-/);
});
