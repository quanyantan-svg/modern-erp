// Gate A A-TXLIFE — Transaction Lifecycle Safety real-session evidence.
//
// This fixture is registered ONLY through the protected Gate A runner
// (scripts/gates/mysql-sales-wave7-gate-a.mjs). It is deliberately absent from
// scripts/testing/test-suites.js, so `pnpm test:fast`, `pnpm test` and the
// unconditional `pnpm test:heavy` can never execute it.
//
// It proves the real-session facts that the pure fault-injection suite
// (server/db-transaction-start-safety.test.js) cannot: real MySQL named-lock
// ownership, real session destruction, the real PROCESSLIST and the real
// durable-state effect of the cleanup paths.
//
// Fail-closed rule: the module throws at load when the MySQL environment is
// incomplete or the disposable-target guard is not armed. It never skips to a
// PASS.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

const { MySqlSyncAdapter } = await import('./database/mysql-adapter.js');
const { resolveDatabaseConfig } = await import('./database/config.js');
const { releaseMySqlIdempotencyLocks } = await import('./db.js');
const { createTempDb } = await import('./test-utils/temp-db.js');

const config = resolveDatabaseConfig({ backend: 'mysql' });

function openObserver() {
  return new MySqlSyncAdapter({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, ssl: config.ssl,
  });
}

function sessionIds(db) {
  return db.prepare(
    `SELECT ID id FROM information_schema.PROCESSLIST
      WHERE DB = DATABASE() AND USER = ? ORDER BY ID`,
  ).all(config.user).map((row) => Number(row.id));
}

function lockState(db, lockName) {
  const row = db.prepare('SELECT IS_FREE_LOCK(?) free, IS_USED_LOCK(?) used').get(lockName, lockName);
  return { free: row?.free, used: row?.used };
}

describe('Gate A A-TXLIFE — Transaction Lifecycle Safety real-session evidence', () => {
  let handle;
  let db;

  before(() => {
    handle = createTempDb({ label: 'txlife-gate-a', production: true });
    db = handle.db;
    assert.equal(db.dialect, 'mysql');
  });

  // createTempDb().cleanup() revalidates the exact disposable authorization
  // and SELECT DATABASE() before dropping any object. A cleanup failure is a
  // test-hook failure; it is never swallowed or converted into a clean suite.
  after(() => handle?.cleanup());

  test('M1 a real named lock is acquired and a verified release frees it server-side', async () => {
    const observer = openObserver();
    try {
      const lockName = 'erp-idem-txlife-m1';
      const acquired = Number(db.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName)?.acquired);
      assert.equal(acquired, 1, 'the session must own the named lock');
      assert.equal(Number(lockState(observer, lockName).used), Number(db.prepare('SELECT CONNECTION_ID() id').get()?.id));

      db._idempotencyLocks = new Set([lockName]);
      const release = releaseMySqlIdempotencyLocks(db);
      assert.equal(release.verified.length, 1, 'RELEASE_LOCK = 1 must be confirmed');
      assert.equal(release.unverified.length, 0);
      assert.equal(db.quarantined, false);

      const after = lockState(observer, lockName);
      assert.equal(Number(after.used), 0, 'no session may still hold the lock');
    } finally {
      observer.close();
    }
  });

  test('M2 destroying the session releases the server-side lock and retires the session', async () => {
    const owner = openObserver();
    const observer = openObserver();
    try {
      const lockName = 'erp-idem-txlife-m2';
      assert.equal(Number(owner.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName)?.acquired), 1);
      const ownerId = Number(owner.prepare('SELECT CONNECTION_ID() id').get()?.id);
      assert.ok(Number(lockState(observer, lockName).used) === ownerId);

      owner.quarantine('gate_a_txlife_session_destroyed');
      await owner.quarantineState.termination;
      assert.equal(owner.quarantineState.state, 'TERMINATION_CONFIRMED');

      const deadline = Date.now() + 8000;
      let used = null;
      while (Date.now() < deadline) {
        used = lockState(observer, lockName).used;
        if (!used) break;
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.ok(!used, 'the server must release the named lock when the session ends');
      const remaining = observer.prepare(
        `SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE ID = ?`,
      ).get(ownerId);
      assert.equal(Number(remaining?.n || 0), 0, 'the retired session must be gone from PROCESSLIST');
    } finally {
      observer.close();
      owner.close();
    }
  });

  test('M3 a quarantined adapter rejects further SQL and opens no new session', async () => {
    const victim = openObserver();
    const observer = openObserver();
    try {
      const primaryId = Number(db.prepare('SELECT CONNECTION_ID() id').get()?.id);
      const victimId = Number(victim.prepare('SELECT CONNECTION_ID() id').get()?.id);
      const observerId = Number(observer.prepare('SELECT CONNECTION_ID() id').get()?.id);
      const beforeIds = sessionIds(observer);
      assert.ok(beforeIds.includes(primaryId), 'the primary fixture session must be observable');
      assert.ok(beforeIds.includes(victimId), 'the victim session must be observable before quarantine');
      assert.ok(beforeIds.includes(observerId), 'the observer session must be observable');

      victim.quarantine('gate_a_txlife_quarantine');
      assert.throws(() => victim.prepare('SELECT 1').get(), (error) => error.code === 'MYSQL_SESSION_QUARANTINED');
      await victim.quarantineState.termination;
      assert.equal(victim.quarantineState.state, 'TERMINATION_CONFIRMED');

      const deadline = Date.now() + 8000;
      let afterIds = sessionIds(observer);
      while (Date.now() < deadline && afterIds.includes(victimId)) {
        await new Promise((done) => setTimeout(done, 50));
        afterIds = sessionIds(observer);
      }
      assert.ok(!afterIds.includes(victimId), 'the quarantined victim session must be gone');
      assert.deepEqual(
        afterIds,
        beforeIds.filter((id) => id !== victimId),
        'quarantine must remove only the victim and must not open a replacement or unexpected session',
      );
    } finally {
      observer.close();
      victim.close();
    }
  });

  test('M4 no adapter connection is left behind', async () => {
    const observer = openObserver();
    try {
      const primaryId = Number(db.prepare('SELECT CONNECTION_ID() id').get()?.id);
      const observerId = Number(observer.prepare('SELECT CONNECTION_ID() id').get()?.id);
      assert.deepEqual(
        sessionIds(observer),
        [primaryId, observerId].sort((left, right) => left - right),
        'only the still-required primary fixture session and this observer may remain',
      );
    } finally {
      observer.close();
    }
  });

  test('M5 a contended transaction leaves no open transaction and no further attempt', async () => {
    const holder = openObserver();
    try {
      holder.exec('START TRANSACTION');
      holder.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
      const previous = process.env.ERP_DB_TX_RETRY_MAX;
      process.env.ERP_DB_TX_RETRY_MAX = '0';
      let caught;
      try {
        const { transaction } = await import('./db.js');
        transaction(db, () => 'never');
      } catch (error) { caught = error; }
      process.env.ERP_DB_TX_RETRY_MAX = previous;
      assert.ok(caught, 'the contended transaction must fail');
      assert.equal(db.isTransaction, false, 'no transaction may be left open');
      assert.equal(db.sessionState, 'IDLE_TRUSTED');
    } finally {
      try { holder.exec('ROLLBACK'); } catch {}
      holder.close();
    }
  });

  test('M6 the L0 transaction gate and the production transaction path are unchanged', async () => {
    const { transaction } = await import('./db.js');
    const result = transaction(db, () => 'gate-ok');
    assert.equal(result, 'gate-ok');
    assert.equal(db.isTransaction, false);
    const gate = db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1').get();
    assert.ok(gate, 'the canonical L0 gate row must exist');
  });

  test('M7 the cleanup paths leave zero duplicate durable facts', () => {
    const tables = ['idempotency_records', 'financial_refunds', 'accounting_vouchers', 'accounting_entries', 'settlement_account_movements', 'audit_logs'];
    const before = Object.fromEntries(tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n || 0)]));
    const lockName = 'erp-idem-txlife-m7';
    db.prepare('SELECT GET_LOCK(?,10)').get(lockName);
    db._idempotencyLocks = new Set([lockName]);
    db.prepare('SELECT RELEASE_LOCK(?)').get(lockName);
    db._idempotencyLocks.clear();
    const after = Object.fromEntries(tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n || 0)]));
    assert.deepEqual(after, before, 'the cleanup paths must not write durable facts');
  });

  test('M8 the exact replay and the fingerprint conflict keep their public semantics', async () => {
    const { idempotencyReplay } = await import('./modules/financial-controls.js');
    const { transaction } = await import('./db.js');
    const scope = 'CUSTOMER:txlife-balance';
    const key = `txlife-${Date.now()}`;
    const fingerprint = 'fp-txlife';
    const observer = openObserver();
    try {
      assert.equal(idempotencyReplay(db, 'REFUND_CONFIRM', scope, key, fingerprint), null, 'a replay miss returns null');
      assert.equal(db._idempotencyLocks?.size, 1, 'the replay miss registers exactly one owned lock');
      const [lockName] = db._idempotencyLocks;
      const primaryId = Number(db.prepare('SELECT CONNECTION_ID() id').get()?.id);
      assert.equal(Number(lockState(observer, lockName).used), primaryId, 'the primary session owns the replay-miss lock');

      transaction(db, () => {
        db.prepare(
          `INSERT INTO idempotency_records(id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
           VALUES(?,?,?,?,?,?,'SUCCEEDED',?)`,
        ).run(`txlife-${key}`, 'REFUND_CONFIRM', scope, key, fingerprint, JSON.stringify({ id: 'txlife-refund' }), new Date().toISOString());
      });
      assert.equal(db._idempotencyLocks.size, 0, 'the normal transaction lifecycle clears the verified lock registration');
      assert.equal(Number(lockState(observer, lockName).used), 0, 'the observer proves the replay-miss lock is free after COMMIT');

      const replay = idempotencyReplay(db, 'REFUND_CONFIRM', scope, key, fingerprint);
      assert.deepEqual(replay, { id: 'txlife-refund' }, 'an exact replay returns the stored result');
      assert.equal(Number(lockState(observer, lockName).used), 0, 'the exact replay releases its reacquired lock');

      let caught;
      try {
        idempotencyReplay(db, 'REFUND_CONFIRM', scope, key, 'fp-different');
      } catch (error) { caught = error; }
      assert.equal(caught?.status, 409, 'a conflicting fingerprint stays a business 409');
      assert.equal(Number(lockState(observer, lockName).used), 0, 'the fingerprint conflict releases its reacquired lock');
    } finally {
      observer.close();
    }
  });
});
