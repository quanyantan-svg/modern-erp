import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { audit } from '../../server/lib/audit.js';
import { transaction } from '../../server/db.js';
import { convertSalesQuotation } from '../../server/modules/sales-quotations.js';
import { applySalesOrderChange } from '../../server/modules/sales-order-changes.js';
import { deliveryNoticeAction } from '../../server/modules/delivery-notices.js';
import { lockAndConsumeSalesDeliveryCapacity } from '../../server/modules/sales-delivery-source.js';
import { salesOrderAction } from '../../server/modules/sales-orders.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
const actor = { id: '00000000-0000-4000-8000-000000000001', roleCode: 'ADMIN', permissions: [
  'ORDERS_CREATE', 'ORDERS_APPROVE', 'ORDERS_VIEW', 'SALES_MANAGE', 'SALES_ORDER_CHANGE_APPROVE',
] };
let gateHeld = false;

function connectionId() { return Number(db.prepare('SELECT CONNECTION_ID() id').get().id); }
function request(body, key) {
  return { headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})); } };
}
function response() {
  return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; } };
}
async function invoke(fn) {
  const res = response();
  try {
    await fn(res);
    return { status: res.statusCode || 200, body: res.body, connectionId: connectionId(), processId: process.pid };
  } catch (error) {
    return { status: error.status || 500, code: error.code || error.details?.code, message: error.message,
      transactionRetryExhausted: Boolean(error.transactionRetryExhausted), connectionId: connectionId(), processId: process.pid };
  }
}

async function execute(command) {
  if (command.action === 'register') return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  if (command.action === 'hold-gate') {
    db.exec('START TRANSACTION');
    db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    gateHeld = true;
    return { held: true, connectionId: connectionId(), processId: process.pid };
  }
  if (command.action === 'release-gate') {
    if (gateHeld) db.exec('COMMIT');
    gateHeld = false;
    return { released: true, connectionId: connectionId(), processId: process.pid };
  }
  if (command.action === 'convert-quotation') return invoke((res) => convertSalesQuotation(db,
    request(command.body, command.key), res, actor, command.quotationId));
  if (command.action === 'apply-change') return invoke(async (res) => {
    const result = transaction(db, () => applySalesOrderChange(db, command.changeId, command.expectedBaseVersion, command.key, actor));
    res.statusCode = 200; res.body = result;
  });
  if (command.action === 'confirm-notice') return invoke((res) => deliveryNoticeAction(db,
    request({}, command.key), res, actor, command.noticeId, 'confirm'));
  if (command.action === 'consume-delivery-capacity') return invoke(async (res) => {
    const result = transaction(db, () => {
      const value = lockAndConsumeSalesDeliveryCapacity(db, command.deliveryId);
      const changed = db.prepare("UPDATE sales_deliveries SET status='CONFIRMED',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=? AND status='DRAFT'")
        .run(new Date().toISOString(), actor.id, new Date().toISOString(), command.deliveryId);
      if (Number(changed.changes ?? changed.affectedRows) !== 1) throw Object.assign(new Error('Delivery is no longer draft'), { status: 409, code: 'SALES_DELIVERY_STALE' });
      audit(db, actor.id, 'CONFIRM_CAPACITY', 'SALES_DELIVERY', command.deliveryId, 'Batch A MySQL canonical capacity proof');
      return value;
    });
    res.statusCode = 200; res.body = { id: command.deliveryId, orderId: result.order.id };
  });
  if (command.action === 'close-order') return invoke((res) => salesOrderAction(db,
    request({ reason: command.reason || 'race close' }, command.key), res, actor, command.orderId, 'close'));
  if (command.action === 'close') {
    if (gateHeld) { try { db.exec('ROLLBACK'); } catch {} }
    db.close(); return { closed: true };
  }
  throw new Error(`Unknown action: ${command.action}`);
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
lines.on('close', () => { try { if (gateHeld) db.exec('ROLLBACK'); db.close(); } catch {} });
