// Wave 7 real-MySQL worker. Every business action invokes the production
// module entry point on this worker's independent MySQL connection.

import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { requestReservationIntent } from '../../server/modules/sales-reservation-intent.js';
import { salesOrderAction } from '../../server/modules/sales-orders.js';
import { confirmSalesDelivery } from '../../server/app.js';
import { applyUnappliedBalance, createRefund } from '../../server/modules/financial-controls.js';
import { reverseSettlementDocument } from '../../server/modules/settlement.js';
import { evaluateSalesPrepaymentGate } from '../../server/modules/sales-prepayment-gate.js';
import { confirmServiceFulfillmentCommand } from '../../server/modules/service-fulfillment.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
const actor = {
  id: 'wave7-race-actor', roleCode: 'ADMIN', isSystemAdmin: true,
  permissions: ['SALES_MANAGE', 'SALES_VIEW', 'ORDERS_SUBMIT', 'SALES_DELIVERIES_MANAGE', 'COLLECTION_MANAGE', 'AR_VIEW'],
};
let gateHeld = false;
let parentHeld = false;

function connectionId() { return Number(db.prepare('SELECT CONNECTION_ID() id').get().id); }
function request(body, key = null) {
  const bytes = Buffer.from(JSON.stringify(body || {}));
  return { headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, async *[Symbol.asyncIterator]() { yield bytes; } };
}
function response() {
  return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value ? JSON.parse(value) : null; } };
}
async function invoke(fn) {
  const res = response();
  try {
    await fn(res);
    return { status: res.statusCode || 200, body: res.body, connectionId: connectionId() };
  } catch (error) {
    return { status: error.status || 500, code: error.code || error.details?.code, message: error.message, connectionId: connectionId() };
  }
}

function generateVoucher(adapter, sourceType, sourceId, entries, voucherActor, businessDate) {
  const voucherId = randomUUID();
  adapter.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at)
    VALUES(?,?,?,?,?,'',?,?)`).run(voucherId, `W7-${voucherId.slice(0, 8)}`, sourceType, sourceId, businessDate, voucherActor.id, new Date().toISOString());
  for (const entry of entries) {
    if (!entry.subjectId) throw new Error(`Missing accounting subject for ${sourceType}`);
    adapter.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), voucherId, entry.subjectId, entry.direction, entry.amountCents, entry.summary || sourceType);
  }
  return voucherId;
}

async function execute(command) {
  if (command.action === 'register') return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  if (command.action === 'hold-gate') {
    db.exec('START TRANSACTION');
    db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    gateHeld = true;
    return { held: true, connectionId: connectionId() };
  }
  if (command.action === 'release-gate') {
    if (gateHeld) db.exec('COMMIT');
    gateHeld = false;
    return { released: true, connectionId: connectionId() };
  }
  if (command.action === 'hold-parent') {
    db.exec('START TRANSACTION');
    const row = db.prepare('SELECT id FROM settlement_unapplied_balances WHERE id=? FOR UPDATE').get(command.balanceId);
    if (!row) throw new Error(`Missing parent balance: ${command.balanceId}`);
    parentHeld = true;
    return { held: true, connectionId: connectionId(), balanceId: row.id };
  }
  if (command.action === 'release-parent') {
    if (parentHeld) db.exec('ROLLBACK');
    parentHeld = false;
    return { released: true, connectionId: connectionId() };
  }
  if (command.action === 'request-reservation') {
    return invoke((res) => requestReservationIntent(db, request(command.body), res, actor));
  }
  if (command.action === 'evaluate-gate') {
    return invoke((res) => evaluateSalesPrepaymentGate(
      db, request(command.body || {}), res, actor, command.orderId, command.stage,
    ));
  }
  if (command.action === 'submit-order') {
    return invoke((res) => salesOrderAction(db, request(command.body || {}, command.key), res, actor, command.orderId, 'submit'));
  }
  if (command.action === 'confirm-delivery') {
    return invoke((res) => confirmSalesDelivery(db, request(command.body || { action: 'confirm' }, command.key), res, actor, command.deliveryId));
  }
  if (command.action === 'apply-unapplied') {
    return invoke((res) => applyUnappliedBalance(db, request(command.body, command.key), res, actor));
  }
  if (command.action === 'create-refund') {
    return invoke((res) => createRefund(db, request(command.body, command.key), res, actor, generateVoucher));
  }
  if (command.action === 'reverse-settlement') {
    return invoke((res) => reverseSettlementDocument(db, request(command.body, command.key), res, actor, 'COLLECTION', command.documentId, generateVoucher));
  }
  if (command.action === 'confirm-service') {
    try {
      const body = confirmServiceFulfillmentCommand(db, command.fulfillmentId, command.expectedVersion, actor, command.key);
      return { status: 200, body, connectionId: connectionId() };
    } catch (error) {
      return { status: error.status || 500, code: error.code || error.details?.code,
        message: error.message, details: error.details, connectionId: connectionId() };
    }
  }
  if (command.action === 'close') {
    if (gateHeld || parentHeld) { try { db.exec('ROLLBACK'); } catch {} }
    gateHeld = false; parentHeld = false;
    db.close();
    return { closed: true };
  }
  throw new Error(`Unknown Wave 7 worker action: ${command.action}`);
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
lines.on('close', () => { try { if (gateHeld || parentHeld) db.exec('ROLLBACK'); db.close(); } catch {} });
