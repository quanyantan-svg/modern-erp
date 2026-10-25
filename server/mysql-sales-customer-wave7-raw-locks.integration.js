// Gate A A-RAW: independent-session InnoDB business-row lock evidence.
// These fixtures bypass production transaction() only to expose L1/L6/L7/L8.
// They assert lock/wait order, never production business outcomes.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave7-raw-worker.mjs');

class RawSession {
  constructor(name) {
    this.name = name; this.pending = new Map(); this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(Object.assign(new Error(reply.error?.message || 'raw worker error'), reply.error || {}));
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`));
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} timeout: ${JSON.stringify(command)}`)), 15_000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

async function observeLockWait(db, { holderId, waiterId, table }) {
  const deadline = Date.now() + 8_000;
  const sql = `SELECT requesting_thread.PROCESSLIST_ID waiter_connection_id,
      blocking_thread.PROCESSLIST_ID holder_connection_id,requesting_lock.OBJECT_NAME object_name
    FROM performance_schema.data_lock_waits waits
    JOIN performance_schema.data_locks requesting_lock ON requesting_lock.ENGINE_LOCK_ID=waits.REQUESTING_ENGINE_LOCK_ID
    JOIN performance_schema.data_locks blocking_lock ON blocking_lock.ENGINE_LOCK_ID=waits.BLOCKING_ENGINE_LOCK_ID
    JOIN performance_schema.threads requesting_thread ON requesting_thread.THREAD_ID=waits.REQUESTING_THREAD_ID
    JOIN performance_schema.threads blocking_thread ON blocking_thread.THREAD_ID=waits.BLOCKING_THREAD_ID
    WHERE requesting_thread.PROCESSLIST_ID=? AND blocking_thread.PROCESSLIST_ID=?
      AND requesting_lock.OBJECT_SCHEMA=DATABASE() AND requesting_lock.OBJECT_NAME=? LIMIT 1`;
  while (Date.now() < deadline) {
    let row;
    try { row = db.prepare(sql).get(waiterId, holderId, table); }
    catch (error) {
      throw Object.assign(new Error(`MYSQL_LOCK_WAIT_EVIDENCE_UNAVAILABLE: ${error?.code || error?.message}`), {
        code: 'MYSQL_LOCK_WAIT_EVIDENCE_UNAVAILABLE', cause: error,
      });
    }
    if (row) {
      assert.equal(Number(row.waiter_connection_id), waiterId);
      assert.equal(Number(row.holder_connection_id), holderId);
      assert.equal(row.object_name, table);
      return row;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Object.assign(new Error(`MYSQL_LOCK_WAIT_NOT_OBSERVED: ${table}`), { code: 'MYSQL_LOCK_WAIT_NOT_OBSERVED' });
}

function isDeadlock(error) {
  return error?.code === 'ER_LOCK_DEADLOCK' || Number(error?.errno) === 1213 || error?.sqlState === '40001';
}

describe('Gate A A-RAW — Wave 7 independent InnoDB row-lock order', () => {
  let handle; let db;
  const fixtures = new Map();

  before(() => {
    handle = createTempDb({ label: 'sales-wave7-gate-a-raw', production: true });
    db = handle.db;
    assert.equal(db.dialect, 'mysql');
    assert.match(String(db.prepare('SELECT VERSION() version').get().version), /^8\./);
    const engine = db.prepare("SELECT ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_orders'").get();
    assert.equal(engine.engine, 'InnoDB');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('gate-a-raw-user','gate-a-raw-user','Gate A Raw','x','x','role-admin',1,?)").run(now);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('gate-a-raw-customer','GATE-A-RAW','Gate A Raw','','','',1,?,?)").run(now, now);
    for (const name of ['M1', 'M7', 'M13', 'M14']) {
      const key = name.toLowerCase();
      const row = {
        parent: `gate-a-${key}-parent`, result: `gate-a-${key}-result`,
        requirement: `gate-a-${key}-requirement`, order: `gate-a-${key}-order`,
      };
      db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,'gate-a-raw-customer','DRAFT',10000,'gate-a-raw-user',?,?)")
        .run(row.order, `GATE-A-${name}`, now, now);
      db.prepare("INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by) VALUES(?,?,0,10000,'ORDER_VALUE',?,'gate-a-raw-user')")
        .run(row.requirement, row.order, now);
      db.prepare("INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,required_remaining_cents,eligible_advance_cents,refunded_amount_cents,applied_amount_cents,source_balance_identities,snapshot_key,evaluated_at,evaluated_by) VALUES(?,?,'PLANNING_RELEASE','PASS',10000,10000,0,0,'[]',?,?, 'gate-a-raw-user')")
        .run(row.result, row.order, `gate-a-${key}-snapshot`, now);
      db.prepare("INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,status,created_by,created_at) VALUES(?,'CUSTOMER','PREPAYMENT','gate-a-raw-customer','GATE_A_RAW',?,?,10000,'2026-10-24','OPEN','gate-a-raw-user',?)")
        .run(row.parent, row.parent, `GATE-A-${name}`, now);
      fixtures.set(name, row);
    }
  });
  after(() => handle?.cleanup());

  async function sessions(label) {
    const left = new RawSession(`${label}-left`); const right = new RawSession(`${label}-right`);
    const [l, r] = await Promise.all([left.run({ action: 'register' }), right.run({ action: 'register' })]);
    assert.notEqual(l.connectionId, r.connectionId);
    assert.match(l.version, /^8\./); assert.match(r.version, /^8\./);
    assert.equal(l.isolation.toUpperCase().replaceAll('_', '-'), 'READ-COMMITTED');
    assert.equal(r.isolation.toUpperCase().replaceAll('_', '-'), 'READ-COMMITTED');
    return { left, right, l, r };
  }

  async function proveLegacyCycle(name, leftFirst, rightFirst) {
    const row = fixtures.get(name); const pair = await sessions(`${name}-legacy`);
    try {
      await Promise.all([pair.left.run({ action: 'begin' }), pair.right.run({ action: 'begin' })]);
      await pair.left.run({ action: 'lock', target: leftFirst, id: row[leftFirst] });
      await pair.right.run({ action: 'lock', target: rightFirst, id: row[rightFirst] });
      const leftWait = pair.left.run({ action: 'lock', target: rightFirst, id: row[rightFirst] });
      await observeLockWait(db, { holderId: pair.r.connectionId, waiterId: pair.l.connectionId,
        table: rightFirst === 'parent' ? 'settlement_unapplied_balances' : 'sales_prepayment_gate_results' });
      const rightCycle = pair.right.run({ action: 'lock', target: leftFirst, id: row[leftFirst] });
      const outcomes = await Promise.allSettled([leftWait, rightCycle]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && isDeadlock(outcome.reason)).length, 1,
        `${name}: legacy inverse order must produce exactly one InnoDB deadlock victim`);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    } finally {
      await Promise.allSettled([
        pair.left.run({ action: 'rollback' }), pair.right.run({ action: 'rollback' }),
      ]);
      await Promise.all([pair.left.close(), pair.right.close()]);
    }
  }

  async function proveCorrectedOrder(name, order) {
    const row = fixtures.get(name); const pair = await sessions(`${name}-corrected`);
    try {
      await Promise.all([pair.left.run({ action: 'begin' }), pair.right.run({ action: 'begin' })]);
      await pair.left.run({ action: 'lock', target: order[0], id: row[order[0]] });
      const rightWait = pair.right.run({ action: 'lock', target: order[0], id: row[order[0]] });
      const tableByTarget = {
        parent: 'settlement_unapplied_balances', result: 'sales_prepayment_gate_results',
      };
      await observeLockWait(db, { holderId: pair.l.connectionId, waiterId: pair.r.connectionId,
        table: tableByTarget[order[0]] });
      for (const target of order.slice(1)) await pair.left.run({ action: 'lock', target, id: row[target] });
      await pair.left.run({ action: 'commit' });
      await rightWait;
      for (const target of order.slice(1)) await pair.right.run({ action: 'lock', target, id: row[target] });
      await pair.right.run({ action: 'commit' });
    } finally {
      await Promise.allSettled([
        pair.left.run({ action: 'rollback' }), pair.right.run({ action: 'rollback' }),
      ]);
      await Promise.all([pair.left.close(), pair.right.close()]);
    }
  }

  test('M1: legacy Result→Parent cycle deadlocks; corrected Parent→Result→Requirement serializes', async () => {
    await proveLegacyCycle('M1', 'result', 'parent');
    await proveCorrectedOrder('M1', ['parent', 'result', 'requirement']);
  });
  test('M7: legacy Sales→Parent cycle deadlocks; corrected Parent→Result→Requirement→Sales serializes', async () => {
    await proveLegacyCycle('M7', 'order', 'parent');
    await proveCorrectedOrder('M7', ['parent', 'result', 'requirement', 'order']);
  });
  test('M13: empty-parent legacy Sales→Result cycle deadlocks; corrected Result→Requirement→Sales serializes', async () => {
    await proveLegacyCycle('M13', 'order', 'result');
    await proveCorrectedOrder('M13', ['result', 'requirement', 'order']);
  });
  test('M14: empty-parent legacy Sales→Result cycle deadlocks; corrected Result→Requirement→Sales serializes', async () => {
    await proveLegacyCycle('M14', 'order', 'result');
    await proveCorrectedOrder('M14', ['result', 'requirement', 'order']);
  });
});

