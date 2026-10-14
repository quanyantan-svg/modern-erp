// Sales & Customer Wave 1 — REAL MySQL concurrency.
//
// PROOF STRATEGY:
//
//   1. Three independent MySQL connections are established by spawning
//      three child_process workers (alpha, beta, control). Each holds
//      its own MySqlSyncAdapter and therefore its own MySQL
//      connection / session. The `register` action on each worker
//      reports its `CONNECTION_ID()` for an explicit independence proof.
//
//   2. The control worker invokes `hold-gate`: it runs `START TRANSACTION`
//      followed by `SELECT gate_id FROM mysql_transaction_gates WHERE
//      gate_id=1 FOR UPDATE`. The control worker keeps that
//      transaction alive (no commit) until `release-gate` is received.
//      This holds the canonical transaction gate row in a real MySQL
//      row lock — no extra named lock, no fake mutex.
//
//   3. The two business workers (alpha, beta) invoke their race-write
//      actions in parallel. Each business worker calls the canonical
//      Wave-1 writer through canonical `transaction(db, work)`, which
//      also runs `SELECT gate_id FROM mysql_transaction_gates WHERE
//      gate_id=1 FOR UPDATE`. Because the control worker holds that
//      row lock, both business workers' gate SELECTs BLOCK at the row
//      lock until the control worker releases.
//
//   4. While the business workers are blocked at the gate, the main
//      test polls information_schema.PROCESSLIST for both
//      CONNECTION_IDs. Once both are observable, the
//      `LOCK_WAIT_OBSERVED` condition is established.
//
//   5. Test invokes `release-gate` on the control worker. The control
//      transaction commits, releasing the row lock. The business
//      workers unblock. The first to acquire the gate runs its
//      business mutation; the second acquires the gate after the
//      first commits, runs work, and the canonical writer throws the
//      domain-specific conflict.
//
//   6. Test asserts:
//        * one HTTP 201 with the canonical writer body
//        * one HTTP 409 carrying the EXACT domain conflict code
//        * no 500 / no retry-exhausted / no disconnect / no timeout
//        * the failing writer leaves NO business row and NO audit row
//        * the canonical transaction gate row is unchanged
//        * both worker CONNECTION_IDs differ from each other and from
//          the control's CONNECTION_ID
//
//   Distinction is explicit:
//
//        MULTI_SESSION_CONSISTENCY_VERIFIED
//          — three distinct CONNECTION_IDs, distinct processId per
//            worker, separate MySqlSyncAdapter per worker. Always
//            established.
//
//        LOCK_WAIT_OBSERVED
//          — at the moment of release, both business workers were
//            simultaneously observable in information_schema.PROCESSLIST.
//            Established when PROCESSLIST exposes both CONNECTION_IDs.
//            NOT established (the test marks it explicitly) when the
//            polling query cannot see the threads — e.g. because the
//            privilege set does not allow PROCESSLIST visibility or
//            because the threads already completed. The test never
//            fabricates LOCK_WAIT_OBSERVED.
//
//   No additional named mutex. No fixed sleep. No artificial barrier.
//   The synchronisation primitive is the canonical MySQL transaction
//   gate row lock.
//
// Run against real MySQL:
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… ERP_MYSQL_TEST_ALLOW_RESET=true \
//     pnpm test:mysql:concurrency

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import {
  observeLockWait,
  LOCK_OBSERVATION_DEFAULT_POLL_ATTEMPTS,
  LOCK_OBSERVATION_DEFAULT_POLL_INTERVAL_MS,
} from './test-utils/sales-wave1-lock-observer.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave1-worker.mjs');

class Wave1Worker {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let response;
      try { response = JSON.parse(line); }
      catch { return; }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(Object.assign(new Error(response.error.message), response.error));
    });
    this.child.on('exit', (code) => {
      // The child process has terminated. Reject any in-flight RPCs so
      // their callers see a concrete failure (no pending promise is
      // ever left unresolved). Also clear any timers associated with
      // those pending entries so the Node timer queue does not leak.
      for (const [, entry] of this.pending) {
        if (entry && entry.timer) {
          try { clearTimeout(entry.timer); } catch { /* ignore */ }
        }
      }
      for (const [, entry] of this.pending) {
        try { entry.reject(new Error(`worker ${name} exited ${code}: ${this.stderr}`)); }
        catch { /* ignore */ }
      }
      this.pending.clear();
    });
  }

  run(command, timeoutMs = WORKER_RPC_TIMEOUT_MS) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          try { clearTimeout(entry.timer); } catch { /* ignore */ }
          entry.reject(new Error(
            `worker ${this.name} RPC timed out after ${timeoutMs}ms: ${JSON.stringify(command)}`,
          ));
        }
      }, timeoutMs);
      const entry = {
        timer,
        resolve: (value) => {
          try { clearTimeout(timer); } catch { /* ignore */ }
          resolve(value);
        },
        reject: (error) => {
          try { clearTimeout(timer); } catch { /* ignore */ }
          reject(error);
        },
      };
      this.pending.set(id, entry);
      try {
        this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
      } catch (error) {
        this.pending.delete(id);
        try { clearTimeout(timer); } catch { /* ignore */ }
        reject(error);
      }
    });
  }

  async close() {
    try { await this.run({ action: 'close' }, WORKER_RPC_TIMEOUT_MS); } catch { /* ignore */ }
    try { this.child.stdin.end(); } catch { /* ignore */ }
  }
}

// Outcomes that the canonical MySQL transaction gate may produce but
// MUST NOT be accepted as a "business conflict" by the concurrency
// test. These are infrastructure / retry-exhausted errors and would
// mask a real bug.
const INFRASTRUCTURE_OUTCOMES = new Set([
  500, 502, 503, 504,
]);

function isInfrastructureOutcome(result) {
  if (!result) return true;
  if (result.status === undefined) return true;
  if (INFRASTRUCTURE_OUTCOMES.has(result.status)) return true;
  if (result.transactionRetryExhausted) return true;
  if (result.status >= 500) return true;
  return false;
}

const LOCK_OBSERVATION_POLL_ATTEMPTS = 60;
const LOCK_OBSERVATION_POLL_INTERVAL_MS = 50;

// Bounded RPC timeout for child_process worker requests. The gate
// release is the most critical — it MUST complete within this budget
// or the test fails. A test failure aborts the gate release; the
// runRace try/finally guarantees the gate is closed even if the
// control worker has crashed.
const WORKER_RPC_TIMEOUT_MS = 15_000;

// The lock-observation contract is implemented in
// server/test-utils/sales-wave1-lock-observer.js. The unit-test
// companion server/concurrency-lock-observer.test.js imports the
// SAME module. There is intentionally no duplicate implementation
// here.

describe('Sales & Customer Wave 1 — real MySQL multi-session concurrency (control-session lock + 3 races)', () => {
  let handle;
  let db;
  let workers;
  let registrations;
  let controlRegistration;

  before(async () => {
    handle = createTempDb({ label: 'sales-wave1-concurrency', production: true });
    db = handle.db;
    assert.equal(db.dialect, 'mysql', 'concurrency test must run on real MySQL');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('wave1-role','WAVE1','Wave1','','0',?)`).run(now);
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name) VALUES('wave1-actor','wave1-actor','Wave1 Actor','','','wave1-role',1,?,'Wave1 Actor')`).run(now);
    for (const [id, code, name] of [['wave1-customer', 'W1-C', 'Wave1 Customer'], ['wave1-customer-2', 'W1-C2', 'Wave1 Customer 2']]) {
      db.prepare('INSERT INTO customers(id,code,name,contact,phone,address,payment_terms_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?)').run(id, code, name, '', '', '', now, now);
    }
    db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES('wave1-group-a','W1-GA','A','',1,?,?),('wave1-group-b','W1-GB','B','',1,?,?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('wave1-person','W1-SP','Person',NULL,1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code) VALUES('wave1-product','W1-P','Product','EA',0,0,1,?,?,'EA')`).run(now, now);
    workers = [new Wave1Worker('alpha'), new Wave1Worker('beta'), new Wave1Worker('control')];
    // Independent session proof.
    registrations = {
      alpha: await workers[0].run({ action: 'register' }),
      beta: await workers[1].run({ action: 'register' }),
    };
    controlRegistration = await workers[2].run({ action: 'register' });
    for (const r of [registrations.alpha, registrations.beta, controlRegistration]) {
      assert.equal(r.dialect, 'mysql');
    }
    assert.notEqual(registrations.alpha.connectionId, registrations.beta.connectionId,
      'alpha and beta must hold two distinct CONNECTION_ID()s');
    assert.notEqual(registrations.alpha.connectionId, controlRegistration.connectionId,
      'alpha and control must hold two distinct CONNECTION_ID()s');
    assert.notEqual(registrations.beta.connectionId, controlRegistration.connectionId,
      'beta and control must hold two distinct CONNECTION_ID()s');
    assert.notEqual(registrations.alpha.processId, registrations.beta.processId,
      'alpha and beta must run in two distinct child processes');
    assert.notEqual(registrations.alpha.processId, controlRegistration.processId,
      'alpha and control must run in two distinct child processes');
  });

  after(async () => {
    if (workers) {
      for (const worker of workers) await worker.close();
    }
    handle?.cleanup();
  });

  beforeEach(() => {
    db.exec('SET FOREIGN_KEY_CHECKS=0');
    try {
      db.exec('DELETE FROM sales_sellable_scope_rules');
      db.exec('DELETE FROM salesperson_group_memberships');
      db.exec('DELETE FROM customer_commercial_extensions');
    } finally { db.exec('SET FOREIGN_KEY_CHECKS=1'); }
  });

  // Map CONNECTION_ID() → performance_schema THREAD_ID. THREAD_ID is
// the Performance Schema identity used by data_lock_waits and is NOT
// the same as CONNECTION_ID(). The mapping lives in
// performance_schema.threads. If the protected user cannot read this
// table, the function returns null and the caller must NOT fabricate
// THREAD_IDs from CONNECTION_IDs — that would silently corrupt the
// subsequent data_lock_waits join.
//
// We poll briefly because performance_schema.threads is updated by
// the instrumented worker threads asynchronously. A single immediate
// query may not see the threads yet.
// Format the observation as a short, machine-parseable summary string.
// The exact label MUST come from the observation contract — we never
// hard-code "LOCK_WAIT_OBSERVED" outside the observer.
function summariseObservation(race, observation) {
  if (observation.kind === 'PERFORMANCE_SCHEMA' && observation.observed) {
    return `LOCK_WAIT_OBSERVED (performance_schema.data_lock_waits): ${JSON.stringify(observation.waiters)}`;
  }
  if (observation.downgradeTo === 'PARTIAL_LOCK_WAIT_OBSERVED') {
    return `PARTIAL_LOCK_WAIT_OBSERVED (performance_schema.data_lock_waits, only one waiter): ${JSON.stringify(observation.waiters)}`;
  }
  if (observation.downgradeTo === 'QUERY_ACTIVITY_OBSERVED') {
    return `QUERY_ACTIVITY_OBSERVED (processlist only): ${JSON.stringify(observation.waiters)}`;
  }
  return `MULTI_SESSION_CONSISTENCY_VERIFIED (kind=${observation.kind}, downgradeTo=${observation.downgradeTo ?? 'none'})`;
}

// Map CONNECTION_ID() → performance_schema THREAD_ID. THREAD_ID is
// the Performance Schema identity used by data_lock_waits and is NOT
// the same as CONNECTION_ID(). The mapping lives in
// performance_schema.threads. If the protected user cannot read this
// table, the function returns null and the caller must NOT fabricate
// THREAD_IDs from CONNECTION_IDs — that would silently corrupt the
// subsequent data_lock_waits join.
//
// We poll briefly because performance_schema.threads is updated by
// the instrumented worker threads asynchronously. A single immediate
// query may not see the threads yet.
async function resolveConnectionIdToThreadId(db, connectionId) {
  for (let attempt = 0; attempt < LOCK_OBSERVATION_POLL_ATTEMPTS; attempt += 1) {
    try {
      const row = db.prepare(`SELECT THREAD_ID FROM performance_schema.threads
        WHERE PROCESSLIST_ID = ? AND TYPE = 'FOREGROUND'`).get(connectionId);
      if (row && Number.isSafeInteger(Number(row.THREAD_ID))) {
        return Number(row.THREAD_ID);
      }
    } catch (error) {
      // performance_schema may not be readable. Do not fabricate.
      void error;
      return null;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_OBSERVATION_POLL_INTERVAL_MS);
  }
  return null;
}

// Helper that runs a race using the control-session protocol.
//
// The control worker's gate lock is acquired in a try/finally so that
// any failure path (assertion error, worker crash, IPC timeout) ends
// with an explicit COMMIT/ROLLBACK. A dangling gate row lock would
// poison the next test.
async function runRace({ action, bodyA, bodyB }) {
  // Step 0 — resolve CONNECTION_ID → THREAD_ID for the three workers.
  // We do this BEFORE acquiring the gate so that we don't pollute
  // the timing window. The control worker thread is at risk of
  // returning a different THREAD_ID after we COMMIT its transaction,
  // so we cache it from the moment we know the control session is up.
  const alphaConn = registrations.alpha.connectionId;
  const betaConn = registrations.beta.connectionId;
  const controlConn = controlRegistration.connectionId;
  const [alphaThreadId, betaThreadId, controlThreadId] = await Promise.all([
    resolveConnectionIdToThreadId(db, alphaConn),
    resolveConnectionIdToThreadId(db, betaConn),
    resolveConnectionIdToThreadId(db, controlConn),
  ]);

  // Step 1 — control holds the gate row lock.
  let controlHeld = { held: false };
  try {
    controlHeld = await workers[2].run({ action: 'hold-gate' });
    assert.equal(controlHeld.held, true, 'control must hold the canonical gate row lock');

    // Step 2 — both business writers invoke their canonical writer;
    // their gate SELECT FOR UPDATE blocks because the control
    // transaction holds the row.
    const writerA = workers[0].run({ action, actorId: 'wave1-actor', body: bodyA });
    const writerB = workers[1].run({ action, actorId: 'wave1-actor', body: bodyB });

    // Step 3 — observe real lock-wait evidence via the shared module.
    // The module enforces the identity rules:
    //   - performance_schema.data_lock_waits uses THREAD_ID only
    //   - information_schema.PROCESSLIST uses CONNECTION_ID only
    //   - the two are NEVER substituted for each other
    // The observer downgrades (PARTIAL / QUERY_ACTIVITY / MULTI) rather
    // than fabricate LOCK_WAIT_OBSERVED when conditions are not met.
    const observers = {
      alpha: { connectionId: alphaConn, threadId: alphaThreadId },
      beta: { connectionId: betaConn, threadId: betaThreadId },
      control: { connectionId: controlConn, threadId: controlThreadId },
    };
    const observation = await observeLockWait(db, observers, {
      pollAttempts: LOCK_OBSERVATION_POLL_ATTEMPTS,
      pollIntervalMs: LOCK_OBSERVATION_POLL_INTERVAL_MS,
    });

    // Step 4 — release the gate. Both writers now race for the row lock.
    const controlReleased = await workers[2].run({ action: 'release-gate' });
    assert.equal(controlReleased.released, true, 'control must release the gate');

    const [aResult, bResult] = await Promise.all([writerA, writerB]);
    return { aResult, bResult, observation, controlHeld, controlReleased,
             threadIds: { alpha: alphaThreadId, beta: betaThreadId, control: controlThreadId } };
  } finally {
    // Belt-and-braces release. If Step 4 already succeeded, this is a
    // no-op (the worker holds no transaction). If any earlier step
    // threw, the control worker may still be holding the gate row
    // lock; this final RPC releases it.
    //
    // Two-stage cleanup:
    //   1. Try a normal release-gate RPC with bounded timeout.
    //   2. If the RPC fails (worker crash, RPC timeout), force-kill
    //      the control child process so the worker can never hold a
    //      gate row lock again. We do NOT swallow the original
    //      business error — it is re-thrown by the runner. The
    //      cleanup is best-effort.
    if (controlHeld && controlHeld.held) {
      try {
        await workers[2].run({ action: 'release-gate' });
      } catch (cleanupError) {
        // RPC failure — best-effort force-kill the control child so
        // the worker process and its MySQL session are terminated.
        try {
          if (workers[2] && workers[2].child && !workers[2].child.killed) {
            workers[2].child.kill('SIGKILL');
          }
        } catch { /* ignore secondary force-kill failure */ }
      }
    }
  }
}

  test('R-W1-01 two independent MySQL sessions racing customer interval creation', async () => {
    const { aResult, bResult, observation } = await runRace({
      action: 'create-customer-extension',
      bodyA: { customerId: 'wave1-customer', effectiveFrom: '2026-01-01', sellableScopeMode: 'ALL_SALES_ENABLED' },
      bodyB: { customerId: 'wave1-customer', effectiveFrom: '2026-06-01', sellableScopeMode: 'RULE_CONTROLLED' },
    });
    assert.equal(isInfrastructureOutcome(aResult), false,
      `alpha must not have an infrastructure error: ${JSON.stringify(aResult)}`);
    assert.equal(isInfrastructureOutcome(bResult), false,
      `beta must not have an infrastructure error: ${JSON.stringify(bResult)}`);
    const statuses = [aResult.status, bResult.status].sort();
    assert.deepEqual(statuses, [201, 409], `expected [201, 409] got ${JSON.stringify(statuses)}`);
    const conflict = aResult.status === 409 ? aResult : bResult;
    assert.equal(conflict.code, 'CUSTOMER_COMMERCIAL_INTERVAL_OVERLAP',
      `expected canonical CUSTOMER_COMMERCIAL_INTERVAL_OVERLAP code, got ${conflict.code}`);
    assert.equal(conflict.transactionRetryExhausted, false);
    assert.equal(aResult.connectionId, registrations.alpha.connectionId);
    assert.equal(bResult.connectionId, registrations.beta.connectionId);
    assert.notEqual(aResult.connectionId, bResult.connectionId);
    console.log(`R-W1-01 ${summariseObservation('R-W1-01', observation)}`);
    const auditCount = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CUSTOMER_COMMERCIAL_EXTENSION'").get().n);
    assert.equal(auditCount, 1, 'audit is committed atomically with the winning business row');
    const rowCount = Number(db.prepare("SELECT COUNT(*) n FROM customer_commercial_extensions WHERE customer_id='wave1-customer'").get().n);
    assert.equal(rowCount, 1, 'final row count is exactly one');
  });

  test('R-W1-02 two independent MySQL sessions racing default membership writes', async () => {
    const { aResult, bResult, observation } = await runRace({
      action: 'create-salesperson-membership',
      bodyA: { salespersonId: 'wave1-person', salesGroupId: 'wave1-group-a', effectiveFrom: '2026-01-01', isDefault: true, active: true },
      bodyB: { salespersonId: 'wave1-person', salesGroupId: 'wave1-group-b', effectiveFrom: '2026-01-01', isDefault: true, active: true },
    });
    assert.equal(isInfrastructureOutcome(aResult), false,
      `alpha must not have an infrastructure error: ${JSON.stringify(aResult)}`);
    assert.equal(isInfrastructureOutcome(bResult), false,
      `beta must not have an infrastructure error: ${JSON.stringify(bResult)}`);
    const statuses = [aResult.status, bResult.status].sort();
    assert.deepEqual(statuses, [201, 409], `expected [201, 409] got ${JSON.stringify(statuses)}`);
    const conflict = aResult.status === 409 ? aResult : bResult;
    assert.equal(conflict.code, 'SALESPERSON_DEFAULT_GROUP_INVALID',
      `expected canonical SALESPERSON_DEFAULT_GROUP_INVALID code, got ${conflict.code}`);
    assert.equal(conflict.transactionRetryExhausted, false);
    assert.notEqual(aResult.connectionId, bResult.connectionId);
    console.log(`R-W1-02 ${summariseObservation('R-W1-02', observation)}`);
    const rows = db.prepare("SELECT is_default FROM salesperson_group_memberships WHERE salesperson_id='wave1-person' AND active=1").all();
    assert.equal(rows.length, 1, 'final effective membership count is exactly one');
    assert.equal(Number(rows[0].is_default), 1, 'the surviving membership is the unique default');
    const auditCount = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALESPERSON_GROUP_MEMBERSHIP'").get().n);
    assert.equal(auditCount, 1, 'audit is committed atomically with the winning default');
  });

  test('R-W1-03 two independent MySQL sessions racing overlapping sellable rules', async () => {
    const { aResult, bResult, observation } = await runRace({
      action: 'create-sellable-scope-rule',
      bodyA: { scopeDimension: 'CUSTOMER_PRODUCT', customerId: 'wave1-customer-2', productId: 'wave1-product', effect: 'ALLOW', effectiveFrom: '2026-01-01', active: true },
      bodyB: { scopeDimension: 'CUSTOMER_PRODUCT', customerId: 'wave1-customer-2', productId: 'wave1-product', effect: 'ALLOW', effectiveFrom: '2026-02-01', active: true },
    });
    assert.equal(isInfrastructureOutcome(aResult), false,
      `alpha must not have an infrastructure error: ${JSON.stringify(aResult)}`);
    assert.equal(isInfrastructureOutcome(bResult), false,
      `beta must not have an infrastructure error: ${JSON.stringify(bResult)}`);
    const statuses = [aResult.status, bResult.status].sort();
    assert.deepEqual(statuses, [201, 409], `expected [201, 409] got ${JSON.stringify(statuses)}`);
    const conflict = aResult.status === 409 ? aResult : bResult;
    assert.equal(conflict.code, 'SELLABLE_SCOPE_INTERVAL_OVERLAP',
      `expected canonical SELLABLE_SCOPE_INTERVAL_OVERLAP code, got ${conflict.code}`);
    assert.equal(conflict.transactionRetryExhausted, false);
    assert.notEqual(aResult.connectionId, bResult.connectionId);
    console.log(`R-W1-03 ${summariseObservation('R-W1-03', observation)}`);
    const ruleCount = Number(db.prepare("SELECT COUNT(*) n FROM sales_sellable_scope_rules WHERE customer_id='wave1-customer-2'").get().n);
    assert.equal(ruleCount, 1, 'final rule count is exactly one');
    const auditCount = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_SELLABLE_SCOPE_RULE'").get().n);
    assert.equal(auditCount, 1, 'audit is committed atomically with the winning rule');
  });

  test('canonical MySQL transaction gate row remains intact after the races', () => {
    const gate = db.prepare('SELECT COUNT(*) n FROM mysql_transaction_gates WHERE gate_id=1').get();
    assert.equal(Number(gate.n), 1, 'transaction gate row must exist after races');
    const metadata = db.prepare('SELECT COUNT(*) n FROM mysql_backend_metadata').get();
    assert.equal(Number(metadata.n) >= 1, true, 'mysql_backend_metadata marker must remain');
  });
});