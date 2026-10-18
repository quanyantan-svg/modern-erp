// Wave 6 — Sales Return / Replacement MySQL independent-session worker.
//
// Spawned by server/mysql-sales-customer-wave6-concurrency.integration.js. Each worker
// owns its own MySQL connection (registered via CREATE TEMPORARY TABLE /
// SELECT CONNECTION_ID()) so concurrent operations really do interleave on the
// server side. The worker exposes the bounded set of actions the integration
// suite needs:
//   - register
//   - hold-gate / release-gate      (mysql_transaction_gates row locks)
//   - confirm-return                (Option A SO_BACKED / NO_SOURCE)
//   - reverse-return                (Option C; header-only Idempotency-Key)
//   - inventory-out                 (independent product, used for OUT races)
//   - close
//
// §30.31.7 — every action runs in its own request path against canonical writers.
// The integration harness observes both sessions at the gate to guarantee real
// interleaving rather than fake same-connection races.

import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { confirmOptionAReturn, reverseOptionCReturn } from '../../server/modules/sales-return-canonical-writer.js';
import { applyInventoryMutation } from '../../server/lib/inventory-mutation.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
const actor = { id: '00000000-0000-4000-8000-000000000001', roleCode: 'ADMIN', permissions: [
  'RETURNS_MANAGE', 'SALES_MANAGE', 'ORDERS_CREATE', 'ORDERS_VIEW',
] };
let gateHeld = false;

function connectionId() { return Number(db.prepare('SELECT CONNECTION_ID() id').get().id); }
function processId() { return process.pid; }

function request(body, key, extraHeaders = {}) {
  return {
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
      ...extraHeaders,
    },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})); },
  };
}
function response() {
  return {
    statusCode: 0, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
}
async function invoke(fn) {
  const res = response();
  try {
    await fn(res);
    return { status: res.statusCode || 200, body: res.body, connectionId: connectionId(), processId: processId() };
  } catch (error) {
    return {
      status: error.status || 500,
      code: error.code || error.details?.code,
      message: error.message,
      transactionRetryExhausted: Boolean(error.transactionRetryExhausted),
      connectionId: connectionId(),
      processId: processId(),
    };
  }
}

async function execute(command) {
  if (command.action === 'register') {
    return { dialect: db.dialect, connectionId: connectionId(), processId: processId() };
  }
  if (command.action === 'hold-gate') {
    db.exec('START TRANSACTION');
    db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    gateHeld = true;
    return { held: true, connectionId: connectionId(), processId: processId() };
  }
  if (command.action === 'release-gate') {
    if (gateHeld) db.exec('COMMIT');
    gateHeld = false;
    return { released: true, connectionId: connectionId(), processId: processId() };
  }
  if (command.action === 'confirm-return') {
    return invoke((res) => confirmOptionAReturn(db, request(command.body, command.key), res, actor, command.returnId));
  }
  if (command.action === 'reverse-return') {
    // §30.31.6 Option C mandates an explicit non-empty Idempotency-Key header.
    // The harness always supplies command.key; missing-key is exercised by an explicit test.
    return invoke((res) => reverseOptionCReturn(db, request(command.body, command.key), res, actor, command.returnId));
  }
  if (command.action === 'inventory-out') {
    // Independent canonical OUT — used for Reverse-vs-OUT races. The application contract
    // is the same applyInventoryMutation dispatcher used by Sales Delivery, Scrap, etc.
    return invoke(async (res) => {
      if (command.lotId || command.serialId) {
        db.prepare(`INSERT IGNORE INTO tracked_source_allocations(
          id,source_type,source_id,source_item_id,product_id,lot_id,serial_id,quantity,posted,reversed,created_at
        ) VALUES(UUID(),'OTHER_ISSUE',?,?,?,?,?,?,1,0,?)`).run(
          command.sourceId, command.sourceItemId || command.sourceId, command.productId,
          command.lotId || null, command.serialId || null, Number(command.quantity), new Date().toISOString(),
        );
      }
      const result = applyInventoryMutation({
        db,
        sourceType: command.sourceType || 'OTHER_ISSUE',
        sourceId: command.sourceId,
        sourceItemId: command.sourceItemId || command.sourceId,
        sourceNo: command.sourceNo || `W6-RACE-${command.sourceId}`,
        businessDate: command.businessDate || new Date().toISOString().slice(0, 10),
        actor: { id: actor.id },
        movementKind: 'OUT',
        quantity: Number(command.quantity),
        fromPosition: {
          productId: command.productId, warehouseId: command.warehouseId,
          ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
          binId: null, lotId: command.lotId || null, serialId: command.serialId || null,
        },
        idempotencyKey: command.idempotencyKey || `w6-out-${command.sourceId}`,
        remark: 'Wave 6 MySQL race inventory OUT',
      });
      res.statusCode = 200; res.body = { movements: result.movements };
    });
  }
  if (command.action === 'close') {
    if (gateHeld) { try { db.exec('ROLLBACK'); } catch {} }
    db.close();
    return { closed: true };
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
