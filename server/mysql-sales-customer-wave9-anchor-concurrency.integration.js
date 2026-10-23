// Wave 9 Credit Lock Anchor — real MySQL multi-session convergence.
//
// Registered by scripts/gates/mysql-concurrency-gate.mjs; never run without
// that gate's disposable-database identity and explicit reset authorization.
//
// Design : solution.md §36.15.2.1 (group-free anchor identity), §36.14.3
//          (L2 POLICY_SCOPE / L3 CREDIT_OBJECT anchor lock order)
// Business: server/modules/credit-anchor.js ensureCreditLockAnchor, unmodified.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { creditObjectAnchorKey, policyScopeAnchorKey } from './modules/credit-anchor.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave9-worker.mjs');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Each Worker is a separate OS process holding one MySqlSyncAdapter, i.e. one
// dedicated MySQL session. close() is explicit, awaited, and confirms the
// child really exited rather than leaving an orphan connection behind.
class Worker {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.exited = new Promise((resolvePromise) => { this.child.once('exit', () => resolvePromise()); });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply;
      try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
  }

  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} timeout on ${command.action}: ${this.stderr}`)), 30_000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`, (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  async close() {
    try { await this.run({ action: 'close' }); } catch { /* the session may already be gone */ }
    try { this.child.stdin.end(); } catch { /* ignore */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const killer = setTimeout(() => { try { this.child.kill(); } catch { /* ignore */ } }, 5_000);
      await this.exited;
      clearTimeout(killer);
    }
  }
}

function connectionsStillOpen(db, ids) {
  const open = db.prepare(`SELECT COUNT(*) n FROM information_schema.PROCESSLIST
    WHERE ID IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return Number(open[0].n);
}

// A loser that reached the canonical identity can only have done so through the
// duplicate-key branch of ensureCreditLockAnchor, so the wait itself is the
// evidence that unique-key contention happened and was handled.
function waitAtAnchorInsert(db, ids) {
  for (let index = 0; index < 60; index += 1) {
    const rows = db.prepare(`SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID IN (${ids.map(() => '?').join(',')})`)
      .all(...ids);
    if (rows.length === ids.length && rows.every((row) => /credit_lock_anchors/i.test(String(row.INFO || '')) && /insert/i.test(String(row.INFO || '')))) {
      return true;
    }
    sleep(25);
  }
  return false;
}

function assertConverged(db, anchorKey, results) {
  assert.equal(results.length >= 2, true, 'the race needs at least two sessions');
  const ids = new Set(results.map((result) => result.data.id));
  assert.equal(ids.size, 1, `every session must observe one Anchor identity: ${JSON.stringify([...ids])}`);
  for (const result of results) assert.equal(result.data.anchorKey, anchorKey, 'every session must converge on the canonical anchor key');

  const stored = db.prepare('SELECT id FROM credit_lock_anchors WHERE anchor_key=?').all(anchorKey);
  assert.equal(stored.length, 1, 'exactly one Anchor identity exists for the key');
  assert.equal(stored[0].id, results[0].data.id, 'the stored identity is the one every session resolved');
  return stored[0].id;
}

describe('Sales & Customer Wave 9 — real MySQL Credit Lock Anchor convergence', () => {
  let handle;
  let db;
  let stamp;
  const openedConnections = new Set();

  before(() => {
    stamp = new Date().toISOString();
    handle = createTempDb({ label: 'sales-customer-wave9-anchor-concurrency', production: true });
    db = handle.db;
    // Fail closed: SQLite cannot prove MySQL unique-index convergence.
    assert.equal(db.dialect, 'mysql');
    assert.match(String(db.prepare('SELECT VERSION() version').get().version), /^8\./);
  });
  after(() => handle?.cleanup());

  async function spawnWorkers(names) {
    const workers = names.map((name) => new Worker(name));
    const registrations = await Promise.all(workers.map((worker) => worker.run({ action: 'register' })));
    for (const registration of registrations) {
      assert.equal(registration.dialect, 'mysql', 'each worker runs on a real MySQL adapter');
      openedConnections.add(registration.connectionId);
    }
    assert.equal(new Set(registrations.map((registration) => registration.connectionId)).size, workers.length,
      'every worker holds an independent MySQL connection');
    return { workers, registrations };
  }

  // Winner provisions first and keeps its transaction open; the losers then
  // block on uq_credit_lock_anchors_anchor_key until the winner commits.
  async function contendForAnchor(tag, shape, anchorKey) {
    const { workers, registrations } = await spawnWorkers([`w9-${tag}-winner`, `w9-${tag}-loser-a`, `w9-${tag}-loser-b`]);
    const [winner, loserA, loserB] = workers;
    let released = false;
    // Settle immediately so a losing session can never surface as an unhandled
    // rejection while the winner is still being committed.
    const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    try {
      for (const worker of workers) {
        assert.equal((await worker.run({ action: 'probe-anchor', anchorKey })).existed, false, `${tag}: the key must be a genuine first use`);
      }

      const winnerResult = await winner.run({ action: 'ensure-anchor-contended', shape, hold: true });
      assert.equal(winnerResult.status, 200, JSON.stringify(winnerResult));
      assert.equal(winnerResult.data.held, true, 'the winner keeps its transaction open');
      assert.equal(winnerResult.data.anchorKey, anchorKey, 'the winner resolves the canonical anchor key');

      const loserConnectionIds = [registrations[1].connectionId, registrations[2].connectionId];
      const pending = [
        settle(loserA.run({ action: 'ensure-anchor-contended', shape, hold: false })),
        settle(loserB.run({ action: 'ensure-anchor-contended', shape, hold: false })),
      ];

      const observed = waitAtAnchorInsert(db, loserConnectionIds);
      await winner.run({ action: 'commit' });
      released = true;
      assert.equal(observed, true, 'both losers must be waiting on the anchor unique key, not running serially');

      const outcomes = await Promise.all(pending);
      const rawResults = [];
      const recoveredResults = [];
      const deadlockVictims = [];
      for (const [index, outcome] of outcomes.entries()) {
        assert.equal(outcome.ok, true, `${tag}: a losing session failed: ${outcome.error?.message}`);
        if (outcome.value.status === 200) {
          rawResults.push(outcome.value);
          continue;
        }

        // Genuine same-key InnoDB contention may select a deadlock victim.
        // Preserve that 500/1213 evidence as a failed raw business attempt;
        // recovery is a separate, complete canonical transaction below.
        assert.equal(outcome.value.status, 500, `${tag}: ${JSON.stringify(outcome.value)}`);
        assert.equal(outcome.value.code, 'ER_LOCK_DEADLOCK', `${tag}: unexpected raw contender error`);
        assert.equal(outcome.value.errno, 1213, `${tag}: unexpected raw contender errno`);
        deadlockVictims.push(outcome.value);

        const recovered = await [loserA, loserB][index].run({ action: 'recover-anchor-after-deadlock', shape });
        assert.equal(recovered.status, 200, `${tag}: bounded recovery failed: ${JSON.stringify(recovered)}`);
        assert.equal(recovered.data.recovery.mode, 'NEW_CANONICAL_TRANSACTION');
        assert.equal(recovered.data.recovery.harnessAttempts, 1, 'the harness performs one bounded recovery invocation');
        assert.equal(recovered.data.recovery.originalDeadlock.status, 500, 'the original deadlock never becomes nominal success');
        assert.equal(recovered.data.recovery.originalDeadlock.code, 'ER_LOCK_DEADLOCK');
        assert.equal(recovered.data.recovery.originalDeadlock.errno, 1213);
        assert.equal(recovered.data.recovery.originalDeadlock.connectionId, outcome.value.connectionId,
          'recovery evidence belongs to the same deadlock-victim session');
        assert.equal(recovered.data.recovery.beforeCleanup.workerHeld, true,
          'the worker still records the interrupted raw transaction until explicit cleanup');
        assert.equal(recovered.data.recovery.beforeCleanup.adapterInTransaction, true,
          'the adapter still records the interrupted raw transaction until explicit cleanup');
        assert.equal(recovered.data.recovery.beforeCleanup.connectionId, outcome.value.connectionId,
          'the victim connection is still usable before explicit cleanup');
        assert.deepEqual(recovered.data.recovery.afterCleanup, {
          workerHeld: false,
          adapterInTransaction: false,
          rollbackAcknowledged: true,
          connectionId: outcome.value.connectionId,
        }, 'explicit ROLLBACK is acknowledged, clears local state and preserves the victim connection');
        assert.deepEqual(recovered.data.recovery.afterRecovery, {
          workerHeld: false,
          adapterInTransaction: false,
          connectionId: outcome.value.connectionId,
        }, 'the new canonical transaction completes on the same connection with no local transaction left open');
        recoveredResults.push(recovered);
      }
      assert.ok(rawResults.length >= 1,
        `${tag}: at least one raw contender must reach duplicate-key convergence; deadlock recovery cannot fake that evidence`);
      assert.equal(rawResults.length + deadlockVictims.length, 2, 'every raw contender has an explicit outcome');
      assert.equal(recoveredResults.length, deadlockVictims.length, 'every deadlock victim is recovered exactly once');
      const results = [winnerResult, ...rawResults, ...recoveredResults];

      // Each loser probed the key as absent before racing. Raw successes prove
      // the duplicate-key branch; deadlock victims retain their original 1213
      // evidence and only converge through a new complete transaction.
      for (const loser of [loserA, loserB]) {
        assert.equal((await loser.run({ action: 'probe-anchor', anchorKey })).existed, true, `${tag}: the key now exists`);
      }
      return assertConverged(db, anchorKey, results);
    } finally {
      if (!released) { try { await winner.run({ action: 'rollback' }); } catch { /* ignore */ } }
      await Promise.all(workers.map((worker) => worker.close()));
    }
  }

  test('concurrent first-use CREDIT_OBJECT provisioning converges on one Anchor identity', async () => {
    const customerId = `w9-race-c-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,'Race','','',1,?,?)`).run(customerId, customerId.toUpperCase(), 'Wave 9 Anchor Race', stamp, stamp);

    const shape = { anchorType: 'CREDIT_OBJECT', customerId, creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-RACE-OBJECT' };
    const anchorKey = creditObjectAnchorKey({ customerId, creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-RACE-OBJECT' });
    assert.equal(anchorKey, `CREDIT_OBJECT|SALES_ORDER|W9-RACE-OBJECT|CUSTOMER|${customerId}|SCOPE:AGGREGATE`);

    await contendForAnchor('credit-object', shape, anchorKey);

    const after = db.prepare('SELECT id FROM credit_lock_anchors WHERE customer_id=? AND credit_object_id=?').all(customerId, 'W9-RACE-OBJECT');
    assert.equal(after.length, 1, 'no duplicate identity survives the race');
    assert.equal(after[0].id, db.prepare('SELECT id FROM credit_lock_anchors WHERE anchor_key=?').get(anchorKey).id);
  });

  test('concurrent first-use POLICY_SCOPE provisioning converges on one Anchor identity', async () => {
    const shape = { anchorType: 'POLICY_SCOPE', policyScopeType: 'GLOBAL', policyScopeId: `W9-RACE-${randomUUID().slice(0, 8)}` };
    const anchorKey = policyScopeAnchorKey('GLOBAL', shape.policyScopeId);
    assert.equal(anchorKey, `POLICY_SCOPE|GLOBAL|${shape.policyScopeId}`);

    await contendForAnchor('policy-scope', shape, anchorKey);

    const stored = db.prepare('SELECT anchor_type,customer_id,salesperson_id,credit_object_type,credit_object_id,policy_scope_type,policy_scope_id FROM credit_lock_anchors WHERE anchor_key=?').get(anchorKey);
    assert.equal(stored.anchor_type, 'POLICY_SCOPE');
    assert.equal(stored.policy_scope_type, 'GLOBAL');
    for (const column of ['customer_id', 'salesperson_id', 'credit_object_type', 'credit_object_id']) {
      assert.equal(stored[column], null, `a POLICY_SCOPE anchor carries no ${column}`);
    }
  });

  test('the canonical transaction() path also converges under concurrency', async () => {
    const customerId = `w9-race-c-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,'Gated Race','','',1,?,?)`).run(customerId, customerId.toUpperCase(), 'Wave 9 Gated Anchor Race', stamp, stamp);

    const shape = { anchorType: 'CREDIT_OBJECT', customerId, salespersonId: null, creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-RACE-GATED' };
    const anchorKey = creditObjectAnchorKey({ customerId, creditObjectType: 'SALES_ORDER', creditObjectId: 'W9-RACE-GATED' });
    const { workers } = await spawnWorkers(['w9-gated-a', 'w9-gated-b', 'w9-gated-c']);
    try {
      const results = await Promise.all(workers.map((worker) => worker.run({ action: 'ensure-anchor-gated', shape })));
      for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
      assertConverged(db, anchorKey, results);
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
    }
  });

  test('no MySQL connection is leaked by any worker', async () => {
    assert.ok(openedConnections.size > 0, 'the suite really opened independent sessions');
    const ids = [...openedConnections];
    for (let index = 0; index < 80; index += 1) {
      if (connectionsStillOpen(db, ids) === 0) break;
      sleep(25);
    }
    assert.equal(connectionsStillOpen(db, ids), 0, 'every worker session must be closed');
  });
});
