// One process = one dedicated MySQL session. All business actions call the
// production Wave 10 handlers/services; raw locking is exposed separately and
// is never reported as production outcome evidence.
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { serializeError } from '../../server/lib/http.js';
import { transaction } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { evaluateCredit, evaluateCreditCheck } from '../../server/modules/credit-check.js';
import { createCreditProfile } from '../../server/modules/credit-profile.js';
import { createCreditParameter, createCreditRule } from '../../server/modules/credit-policy.js';
import { decideCreditSpecialApproval, requestCreditSpecialApproval } from '../../server/modules/credit-special-approval.js';
import { createSalesOrder, salesOrderAction } from '../../server/modules/sales-orders.js';
import { createManualAccountReceivable } from '../../server/modules/finance-ar-open-item.js';
import { createSalesInvoice, postSalesInvoice } from '../../server/modules/commercial-golive.js';
import { createWave10MysqlLifecycle } from '../../server/test-utils/mysql-wave10-campaign-target.js';
import { W10_TEST_CREDENTIALS, wave10HttpRequest } from '../../server/test-utils/wave10-mysql-acceptance-fixture.js';

const { backend: _backend, ...config } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(config);
const mysqlLifecycle = createWave10MysqlLifecycle();
mysqlLifecycle.verify(db, config);
let held = false;
let prepared = null;
const actor = Object.freeze({
  id: 'w10-race-approver', roleCode: 'ADMIN', permissions: [
    'CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE',
    'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'ORDERS_REJECT', 'SALES_MANAGE', 'SALES_CROSS_GROUP',
    'FINANCE_INVOICE_MANAGE',
  ],
});

function request(body, key) {
  const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key || '' };
  return req;
}
function response() {
  return { statusCode: null, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value ? JSON.parse(value) : null; } };
}
async function handlerCall(handler, body, key, tail, adapter = db) {
  const res = response();
  const commandActor = tail.actor || actor;
  await handler(adapter, request(body, key), res, commandActor, ...tail.args);
  return { statusCode: res.statusCode, body: res.body };
}
function actorFor(command) { return command.actorId ? Object.freeze({ ...actor, id: command.actorId }) : actor; }

// The canonical production HTTP dispatch. The worker authenticates through the
// real login endpoint and then drives the real application handler, so the
// production authentication, authorization, validation, transaction, audit and
// idempotency contract is exercised end to end.
let sessionToken = null;
async function workerSessionToken(app) {
  if (sessionToken) return sessionToken;
  const outcome = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/auth/login',
    body: { username: W10_TEST_CREDENTIALS.username, password: W10_TEST_CREDENTIALS.password },
  });
  if (outcome.statusCode !== 200 || !outcome.body?.token) {
    throw new Error(`Wave 10 worker login refused with status ${outcome.statusCode}`);
  }
  sessionToken = outcome.body.token;
  return sessionToken;
}
// The refusal contract is the production one. The worker serializes the
// raised HttpError with the same canonical serializer the HTTP layer uses, so
// the observed status, code, message and details are the real public contract
// and never a worker-specific paraphrase.
function failure(error) {
  if (error && typeof error.status === 'number') {
    const safe = serializeError(error, 'wave10-worker');
    return {
      status: safe.status,
      statusCode: safe.status,
      code: safe.code,
      message: safe.message,
      details: safe.details ?? null,
      body: safe,
    };
  }
  return {
    status: 500,
    statusCode: 500,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: null,
    body: null,
  };
}

function tracedAdapter() {
  const trace = [];
  const normalize = (sql) => String(sql).replace(/\s+/g, ' ').trim().slice(0, 500);
  const adapter = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (sql) => { trace.push(normalize(sql)); return target.prepare(sql); };
      if (property === 'exec') return (sql) => { trace.push(normalize(sql)); return target.exec(sql); };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { adapter, trace };
}

async function execute(command) {
  if (command.action === 'register') return { dialect: db.dialect, connectionId: Number(db.prepare('SELECT CONNECTION_ID() id').get().id) };
  if (command.action === 'prepare') {
    if (prepared) throw new Error('Wave 10 worker already has a prepared action');
    prepared = command.command;
    return { status: 200, ready: true, action: prepared?.action };
  }
  if (command.action === 'go') {
    if (!prepared) throw new Error('Wave 10 worker has no prepared action');
    const next = prepared; prepared = null;
    return execute(next);
  }
  let traced = { adapter: db, trace: null };
  try {
    traced = command.trace ? tracedAdapter() : traced;
    const adapter = traced.adapter;
    let result;
    if (command.action === 'evaluate') {
      let outcome;
      transaction(adapter, () => { outcome = evaluateCredit(adapter, command.input); });
      result = { status: 200, outcome };
    }
    else if (command.action === 'evaluate-endpoint') result = { status: 200, ...(await handlerCall(evaluateCreditCheck, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'order-action') {
      result = { status: 200, ...(await handlerCall(salesOrderAction, command.body || {}, command.key, { actor: actorFor(command), args: [command.orderId, command.orderAction] }, adapter)) };
    }
    else if (command.action === 'http-request') {
      // The real production application handler. A business refusal is a
      // normal HTTP response here, not an exception, so the observed status
      // and body are the production contract.
      const app = createApp(db);
      const token = command.token || await workerSessionToken(app);
      const outcome = await wave10HttpRequest(app, {
        method: command.method || 'POST', path: command.path, body: command.body,
        token, headers: command.headers || {},
      });
      result = { status: outcome.statusCode, statusCode: outcome.statusCode, body: outcome.body };
    }
    else if (command.action === 'order-create') {
      result = { status: 201, ...(await handlerCall(createSalesOrder, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    }
    else if (command.action === 'profile-create') result = { status: 201, ...(await handlerCall(createCreditProfile, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'parameter-create') result = { status: 201, ...(await handlerCall(createCreditParameter, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'rule-create') result = { status: 201, ...(await handlerCall(createCreditRule, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'special-request') result = { status: 201, ...(await handlerCall(requestCreditSpecialApproval, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'special-decide') result = { status: 200, ...(await handlerCall(decideCreditSpecialApproval, command.body, command.key, { actor: actorFor(command), args: [command.approvalId] }, adapter)) };
    else if (command.action === 'finance-ar-create') result = { status: 200, ...(await handlerCall(createManualAccountReceivable, command.body, command.key, { actor: actorFor(command), args: [] }, adapter)) };
    else if (command.action === 'invoice-create') result = { status: 201, invoice: createSalesInvoice(adapter, { ...command.body, actorId: actorFor(command).id }) };
    else if (command.action === 'invoice-post') result = { status: 200, invoice: postSalesInvoice(adapter, command.invoiceId, actorFor(command).id) };
    else if (command.action === 'raw-lock') {
      db.exec('START TRANSACTION'); held = true;
      db.prepare(`SELECT id FROM credit_lock_anchors WHERE id=? FOR UPDATE`).get(command.anchorId);
      result = { status: 200, held: true };
    }
    else if (command.action === 'raw-gate-hold') {
      db.exec('START TRANSACTION'); held = true;
      db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
      result = { status: 200, held: true };
    }
    else if (command.action === 'raw-snapshot-hold') {
      db.exec('START TRANSACTION'); held = true;
      db.prepare('SELECT id FROM credit_policy_snapshots WHERE id=? FOR UPDATE').get(command.snapshotId);
      result = { status: 200, held: true };
    }
    else if (command.action === 'observe-waits') {
      result = { status: 200, waits: db.prepare(`SELECT requesting_thread.PROCESSLIST_ID waiter_connection_id,
        blocking_thread.PROCESSLIST_ID holder_connection_id,requesting_lock.OBJECT_NAME object_name
        FROM performance_schema.data_lock_waits waits
        JOIN performance_schema.data_locks requesting_lock ON requesting_lock.ENGINE_LOCK_ID=waits.REQUESTING_ENGINE_LOCK_ID
        JOIN performance_schema.data_locks blocking_lock ON blocking_lock.ENGINE_LOCK_ID=waits.BLOCKING_ENGINE_LOCK_ID
        JOIN performance_schema.threads requesting_thread ON requesting_thread.THREAD_ID=waits.REQUESTING_THREAD_ID
        JOIN performance_schema.threads blocking_thread ON blocking_thread.THREAD_ID=waits.BLOCKING_THREAD_ID
        WHERE requesting_lock.OBJECT_SCHEMA=DATABASE()`).all() };
    }
    else if (command.action === 'release') {
      if (held) db.exec(command.rollback ? 'ROLLBACK' : 'COMMIT');
      held = false;
      result = { status: 200, released: true };
    }
    else if (command.action === 'close') {
      if (held) db.exec('ROLLBACK');
      held = false; db.close(); result = { status: 200, closed: true };
    }
    else throw new Error(`Unknown Wave 10 worker action: ${command.action}`);
    return traced.trace ? { ...result, trace: traced.trace } : result;
  } catch (error) {
    if (held) { try { db.exec('ROLLBACK'); } catch {} held = false; }
    const result = failure(error);
    return traced.trace ? { ...result, trace: traced.trace } : result;
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  let envelope;
  try {
    envelope = JSON.parse(line);
    const result = await execute(envelope.command);
    process.stdout.write(`${JSON.stringify({ id: envelope.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: envelope?.id, ok: false, error: { message: error.message, code: error.code } })}\n`);
  }
});
lines.on('close', () => { try { if (held) db.exec('ROLLBACK'); } catch {} try { db.close(); } catch {} });
