// Sales & Customer 域真实 MySQL 8 campaign 的竞态 worker。
//
// 一个进程 = 一个独立的 MySQL 会话。每个业务动作都调用生产模块的入口，raw lock
// 只作为竞态编排手段暴露，绝不作为生产结果证据。
//
// 该 worker 是 `mysql-concurrency-sales-wave7-worker.mjs` 与
// `mysql-concurrency-sales-wave10-worker.mjs` 的**独立实现**：本域 campaign 的
// 证据链不依赖任何其它 campaign 的 worker 行为，夹具动作名也带 SALES_CUSTOMER
// 前缀。

import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { serializeError } from '../../server/lib/http.js';
import { confirmSalesDelivery } from '../../server/app.js';
import { evaluateCreditCheck } from '../../server/modules/credit-check.js';
import { decideCreditSpecialApproval, requestCreditSpecialApproval } from '../../server/modules/credit-special-approval.js';
import { createCreditEvaluationSheet, finalizeCreditEvaluationSheet, scoreCreditEvaluationSheet } from '../../server/modules/credit-evaluation.js';
import { salesOrderAction } from '../../server/modules/sales-orders.js';
import { applySalesOrderChange } from '../../server/modules/sales-order-changes.js';
import { transaction } from '../../server/db.js';
import { convertSalesQuotation, createSalesQuotation, salesQuotationAction } from '../../server/modules/sales-quotations.js';
import {
  consumeReservationIntent, grantReservationIntent, releaseReservationIntent,
} from '../../server/modules/sales-reservation-intent.js';

// The worker opens the SAME database the suite opened.
//
// Inside the ACK-4 campaign that is the leased MySQL target. Outside the
// campaign — the offline SQLite validation mode — the suite hands the worker
// the temporary SQLite file through `ERP_SALES_CUSTOMER_RACE_DB_PATH`. The
// offline mode exists only to prove the fixtures and the assertions are
// self-consistent; it is NEVER real-MySQL evidence.
//
// The offline branch OPENS the existing database. It never runs the migration
// chain again: the schema is already bootstrapped by the suite, and a second
// migration would both be wrong and would lock the shared SQLite file.
const offlineDbPath = String(process.env.ERP_SALES_CUSTOMER_RACE_DB_PATH || '').trim();
let db;
if (offlineDbPath) {
  db = new DatabaseSync(offlineDbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 20000;');
} else {
  const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
  db = new MySqlSyncAdapter(mysqlConfig);
}

// The actor carries exactly the authority the raced scenarios need. The
// permission set is the union of the production authorities the scenarios
// exercise; no scenario may be authorized by a permission it does not use.
const ACTOR = Object.freeze({
  id: 'sales-customer-race-actor', roleCode: 'ADMIN', isSystemAdmin: true,
  permissions: [
    'CREDIT_VIEW', 'CREDIT_MANAGE', 'CREDIT_EVALUATE', 'CREDIT_SPECIAL_APPROVE',
    'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'ORDERS_REJECT',
    'SALES_MANAGE', 'SALES_CROSS_GROUP', 'SALES_QUOTATION_MANAGE',
    'SALES_ORDER_CHANGE_DIRECT_REQUEST', 'SALES_ORDER_CHANGE_APPROVE',
    'SALES_DELIVERIES_MANAGE',
  ],
});

let gateHeld = false;

// The session identity of this worker.
//
// On MySQL the identity is the real server-side connection id, so the suite can
// observe the contenders in `information_schema.PROCESSLIST`. SQLite has no
// server-side sessions, so the offline validation mode uses the worker pid:
// the suite only requires that the three workers are DISTINCT, and the
// campaign mode is the one that carries the real contention evidence.
function connectionId() {
  if (db.dialect === 'mysql') return Number(db.prepare('SELECT CONNECTION_ID() id').get().id);
  return process.pid;
}

// The performance_schema THREAD_ID of this session. It is a DIFFERENT
// identity from the connection id, and the lock-wait graph is keyed by it:
// `performance_schema.data_lock_waits` reports REQUESTING_THREAD_ID and
// BLOCKING_THREAD_ID, while `information_schema.PROCESSLIST` is keyed by the
// connection id. The two must never be substituted for one another.
//
// The dedicated test account holds SELECT on `performance_schema.threads`, so
// the mapping is readable. On SQLite there is no server-side session and no
// thread id; the offline validation mode is explicitly not contention
// evidence.
function threadId() {
  if (db.dialect !== 'mysql') return null;
  const row = db.prepare(`SELECT THREAD_ID id FROM performance_schema.threads
    WHERE PROCESSLIST_ID = CONNECTION_ID() LIMIT 1`).get();
  return row ? Number(row.id) : null;
}

function request(body, key = null) {
  const bytes = Buffer.from(JSON.stringify(body || {}), 'utf8');
  return {
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    async *[Symbol.asyncIterator]() { yield bytes; },
  };
}

function response() {
  return {
    statusCode: 0, headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}

// The refusal contract is the production one. The observed status, code and
// message are serialized with the same canonical serializer the HTTP layer
// uses, so a refusal is never a worker-specific paraphrase.
function failure(error) {
  if (error && typeof error.status === 'number') {
    const safe = serializeError(error, 'sales-customer-domain-races-worker');
    return {
      status: safe.status, statusCode: safe.status, code: safe.code,
      message: safe.message, details: safe.details ?? null, body: safe,
    };
  }
  return {
    status: 500, statusCode: 500, code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: error?.stack ? String(error.stack).slice(0, 800) : null,
    body: null,
  };
}

async function invoke(handler, command) {
  const res = response();
  const actor = command.actorId ? { ...ACTOR, id: command.actorId } : ACTOR;
  try {
    await handler(db, request(command.body, command.key), res, actor, ...(command.args || []));
    return { status: res.statusCode || 200, statusCode: res.statusCode || 200, body: res.body, connectionId: connectionId() };
  } catch (error) {
    return { ...failure(error), connectionId: connectionId() };
  }
}

async function execute(command) {
  if (command.action === 'register') {
    return { dialect: db.dialect, connectionId: connectionId(), threadId: threadId(), processId: process.pid };
  }
  if (command.action === 'hold-gate') {
    // The L0 coordination gate: the production transaction() helper acquires
    // this row first, so every contender is observably pending here before it
    // touches a business row.
    //
    // The gate row is a MySQL-only object. On SQLite the offline validation
    // mode cannot hold it; the suite skips the gate in that mode and the
    // result is explicitly NOT contention evidence.
    if (db.dialect !== 'mysql') {
      return { held: false, unsupported: true, connectionId: connectionId() };
    }
    db.exec('START TRANSACTION');
    const gate = db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    if (!gate) throw new Error('SALES_CUSTOMER_RACE_GATE_UNAVAILABLE');
    gateHeld = true;
    return { held: true, connectionId: connectionId() };
  }
  if (command.action === 'release-gate') {
    if (gateHeld) db.exec('COMMIT');
    gateHeld = false;
    return { released: true, connectionId: connectionId() };
  }
  if (command.action === 'close') {
    if (gateHeld) { try { db.exec('ROLLBACK'); } catch { /* already closed */ } }
    gateHeld = false;
    db.close();
    return { closed: true };
  }

  // --- Sales Order --------------------------------------------------------
  if (command.action === 'order-action') {
    return invoke(salesOrderAction, { ...command, args: [command.orderId, command.orderAction] });
  }
  if (command.action === 'order-change-apply') {
    try {
      // The production route applies the change INSIDE a transaction, and the
      // transaction helper takes the L0 coordination gate first. Calling the
      // function bare would bypass that gate, and the two contenders would
      // then be free to run one after the other — the race would degenerate
      // into two sequential calls and prove nothing.
      let result;
      transaction(db, () => {
        result = applySalesOrderChange(
          db, command.changeId, Number(command.expectedBaseVersion), command.key,
          command.actorId ? { ...ACTOR, id: command.actorId } : ACTOR,
        );
      });
      return { status: 200, statusCode: 200, body: result, connectionId: connectionId() };
    } catch (error) {
      return { ...failure(error), connectionId: connectionId() };
    }
  }

  // --- Sales Quotation ----------------------------------------------------
  if (command.action === 'quotation-create') {
    return invoke(createSalesQuotation, { ...command, args: [] });
  }
  if (command.action === 'quotation-publish') {
    return invoke(salesQuotationAction, { ...command, args: [command.quotationId, 'effective-publish'] });
  }
  if (command.action === 'quotation-convert') {
    return invoke(convertSalesQuotation, { ...command, args: [command.quotationId] });
  }

  // --- Sales Delivery -----------------------------------------------------
  if (command.action === 'delivery-confirm') {
    return invoke(confirmSalesDelivery, { ...command, args: [command.deliveryId] });
  }

  // --- Credit -------------------------------------------------------------
  if (command.action === 'credit-evaluate') {
    return invoke(evaluateCreditCheck, { ...command, args: [] });
  }
  if (command.action === 'special-request') {
    return invoke(requestCreditSpecialApproval, { ...command, args: [] });
  }
  if (command.action === 'special-decide') {
    return invoke(decideCreditSpecialApproval, { ...command, args: [command.approvalId] });
  }
  if (command.action === 'evaluation-sheet-score') {
    return invoke(scoreCreditEvaluationSheet, { ...command, args: [command.sheetId] });
  }
  if (command.action === 'evaluation-sheet-finalize') {
    return invoke(finalizeCreditEvaluationSheet, { ...command, args: [command.sheetId] });
  }
  if (command.action === 'evaluation-sheet-create') {
    return invoke(createCreditEvaluationSheet, { ...command, args: [] });
  }

  // --- Reservation Intent -------------------------------------------------
  if (command.action === 'reservation-grant') {
    return invoke(grantReservationIntent, { ...command, args: [command.intentId] });
  }
  if (command.action === 'reservation-consume') {
    return invoke(consumeReservationIntent, { ...command, args: [command.intentId] });
  }
  if (command.action === 'reservation-release') {
    return invoke(releaseReservationIntent, { ...command, args: [command.intentId] });
  }

  throw new Error(`Unknown Sales & Customer domain race worker action: ${command.action}`);
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
lines.on('close', () => {
  try { if (gateHeld) db.exec('ROLLBACK'); } catch { /* connection already gone */ }
  try { db.close(); } catch { /* connection already gone */ }
});
