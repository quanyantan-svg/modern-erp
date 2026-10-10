import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { transaction } from '../../server/db.js';
import { allocateDocumentNumber } from '../../server/modules/commercial-golive.js';
import { idempotencyReplay, saveIdempotency } from '../../server/modules/financial-controls.js';
import { confirmInventoryTransfer } from '../../server/app.js';
import { closeInventoryPeriodCommand } from '../../server/modules/inventory-period-close.js';
import { applyInventoryMutation } from '../../server/lib/inventory-mutation.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replayOrConflict(key, payload) {
  const existing = db.prepare('SELECT payload,result_json FROM phase7b_concurrency_effects WHERE idempotency_key=?').get(key);
  if (!existing) return null;
  if (existing.payload !== payload) {
    const error = new Error('IDEMPOTENCY_KEY_CONFLICT');
    error.code = 'IDEMPOTENCY_KEY_CONFLICT';
    throw error;
  }
  return JSON.parse(existing.result_json);
}

function saveEffect(key, payload, resourceId, kind, result) {
  db.prepare(`INSERT INTO phase7b_concurrency_effects
    (idempotency_key,payload,resource_id,effect_kind,result_json,created_at)
    VALUES(?,?,?,?,?,?)`).run(key, payload, resourceId, kind, JSON.stringify(result), new Date().toISOString());
}

function execute(command) {
  if (command.action === 'inventory-mutation') {
    return applyInventoryMutation({
      ...command.input,
      db,
      actor: { id: command.actorId },
    });
  }
  if (command.action === 'inventory-step-receive') {
    return transaction(db, () => {
      const row = db.prepare(`SELECT * FROM inventory_step_transfer_in_transit WHERE id=? FOR UPDATE`).get(command.stepId);
      if (!row) throw Object.assign(new Error('STEP_TRANSFER_NOT_FOUND'), { code: 'STEP_TRANSFER_NOT_FOUND' });
      const remaining = Number(row.issued_qty) - Number(row.received_qty) - Number(row.returned_qty) - Number(row.cancelled_qty);
      if (Number(command.quantity) > remaining) {
        throw Object.assign(new Error('IN_TRANSIT_INSUFFICIENT'), { code: 'IN_TRANSIT_INSUFFICIENT' });
      }
      const result = applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_STEP_TRANSFER_IN',
        sourceId: row.source_transfer_id,
        sourceItemId: row.id,
        businessDate: command.businessDate,
        actor: { id: command.actorId },
        movementKind: 'IN',
        quantity: Number(command.quantity),
        toPosition: command.toPosition,
        idempotencyKey: command.idempotencyKey,
      });
      db.prepare(`UPDATE inventory_step_transfer_in_transit
        SET received_qty=received_qty+?, status=IF(issued_qty-received_qty-?-returned_qty-cancelled_qty=0,'CLOSED',status)
        WHERE id=?`).run(Number(command.quantity), Number(command.quantity), row.id);
      return result;
    });
  }
  if (command.action === 'inventory-lock-create') {
    return transaction(db, () => {
      const position = db.prepare('SELECT quantity FROM inventory WHERE position_key=? FOR UPDATE').get(command.positionKey);
      const onHand = Number(position?.quantity || 0);
      const locked = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks
        WHERE position_key=? AND status='ACTIVE' FOR UPDATE`).get(command.positionKey)?.q || 0);
      if (locked + Number(command.quantity) > onHand) {
        throw Object.assign(new Error('INVENTORY_LOCK_EXCEEDS_AVAILABLE'), { code: 'INVENTORY_LOCK_EXCEEDS_AVAILABLE' });
      }
      db.prepare(`INSERT INTO inventory_locks
        (id,product_id,warehouse_id,position_key,quantity,reason,status,locked_by,locked_at,source_type,source_id)
        VALUES(?,?,?,?,?,?,'ACTIVE',?,?,?,?)`).run(
        command.lockId, command.productId, command.warehouseId, command.positionKey,
        Number(command.quantity), 'MYSQL_RACE', command.actorId, new Date().toISOString(),
        'INVENTORY_LOCK', command.lockId,
      );
      return { committed: true, lockId: command.lockId };
    });
  }
  if (command.action === 'inventory-reserve') {
    return transaction(db, () => {
      db.prepare(`INSERT INTO planning_reservations
        (id,reservation_no,reservation_type,product_id,warehouse_id,quantity,status,created_by,created_at,updated_at,
         demand_source_type,demand_source_id,supply_source_type,supply_source_id,supply_source_line_id)
        VALUES(?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?)`).run(
        command.reservationId, command.reservationNo, 'STRONG', command.productId,
        command.warehouseId, Number(command.quantity), command.actorId,
        command.createdAt, command.createdAt, 'PLAN', command.reservationId,
        'PLANNED_ORDER', command.reservationId, `${command.reservationId}:line`,
      );
      return { committed: true };
    });
  }
  if (command.action === 'inventory-close-period') {
    return transaction(db, () => {
      db.prepare(`INSERT IGNORE INTO inventory_period_closures(id,period_key,status,closed_by,closed_at)
        VALUES(?,?,'CLOSED',?,?)`).run(command.closureId, command.periodKey, command.actorId, command.closedAt);
      return { committed: true };
    });
  }
  if (command.action === 'inventory-close-initialization') {
    return transaction(db, () => {
      const row = db.prepare('SELECT status FROM inventory_initialization WHERE id=? FOR UPDATE').get(command.initializationId);
      if (!row || row.status !== 'OPEN') throw Object.assign(new Error('INITIALIZATION_NOT_OPEN'), { code: 'INITIALIZATION_NOT_OPEN' });
      db.prepare(`UPDATE inventory_initialization SET status='CLOSED',closed_by=?,closed_at=? WHERE id=?`)
        .run(command.actorId, command.closedAt, command.initializationId);
      return { committed: true };
    });
  }
  if (command.action === 'inventory-period-close') {
    return closeInventoryPeriodCommand(db, { id: command.actorId }, {
      period: command.period, confirmWarnings: Boolean(command.confirmWarnings), notes: command.notes || '',
    }, { today: command.today });
  }
  if (command.action === 'inventory-transfer-confirm') {
    return confirmInventoryTransfer(db, { id: command.actorId }, command.transferId);
  }
  if (command.action === 'hold') {
    return transaction(db, () => {
      sleep(command.ms);
      return { held: command.ms };
    });
  }
  if (command.action === 'nonretry') {
    let attempts = 0;
    try {
      transaction(db, () => { attempts += 1; throw Object.assign(new Error('BUSINESS_RULE'), { code: 'BUSINESS_RULE' }); });
    } catch (error) { return { attempts, error: error.code }; }
  }
  if (command.action === 'number') {
    return transaction(db, () => ({ number: allocateDocumentNumber(db, command.documentType, command.date, command.key) }));
  }
  if (command.action === 'native-idempotency') {
    const replay = idempotencyReplay(db, command.operationType, command.documentId, command.key, command.fingerprint);
    if (replay) return { ...replay, replay: true };
    return transaction(db, () => {
      const current = db.prepare('SELECT used_quantity FROM phase7b_concurrency_resources WHERE id=? FOR UPDATE').get(command.resourceId);
      db.prepare('UPDATE phase7b_concurrency_resources SET used_quantity=used_quantity+1,version=version+1 WHERE id=?').run(command.resourceId);
      const result = { committed: true, ordinal: Number(current.used_quantity) + 1 };
      saveIdempotency(db, command.operationType, command.documentId, command.key, command.fingerprint, result);
      return result;
    });
  }
  if (command.action === 'consume') {
    const payload = JSON.stringify({ resourceId: command.resourceId, quantity: command.quantity, valueCents: command.valueCents || 0 });
    return transaction(db, () => {
      const replay = replayOrConflict(command.key, payload);
      if (replay) return { ...replay, replay: true };
      const row = db.prepare('SELECT available_quantity,available_value_cents FROM phase7b_concurrency_resources WHERE id=? FOR UPDATE').get(command.resourceId);
      if (!row || Number(row.available_quantity) < command.quantity || Number(row.available_value_cents) < (command.valueCents || 0)) {
        return { committed: false, reason: 'INSUFFICIENT_AVAILABLE' };
      }
      db.prepare(`UPDATE phase7b_concurrency_resources
        SET available_quantity=available_quantity-?, used_quantity=used_quantity+?,
            available_value_cents=available_value_cents-?, used_value_cents=used_value_cents+?, version=version+1
        WHERE id=?`).run(command.quantity, command.quantity, command.valueCents || 0, command.valueCents || 0, command.resourceId);
      const result = { committed: true, resourceId: command.resourceId, quantity: command.quantity, valueCents: command.valueCents || 0 };
      saveEffect(command.key, payload, command.resourceId, 'CONSUME', result);
      return result;
    });
  }
  if (command.action === 'transition') {
    const payload = JSON.stringify({ resourceId: command.resourceId, from: command.from, to: command.to });
    return transaction(db, () => {
      const replay = replayOrConflict(command.key, payload);
      if (replay) return { ...replay, replay: true };
      const row = db.prepare('SELECT status FROM phase7b_concurrency_resources WHERE id=? FOR UPDATE').get(command.resourceId);
      if (!row) throw new Error('RESOURCE_NOT_FOUND');
      if (row.status === command.to) return { committed: true, equivalent: true, status: row.status };
      if (row.status !== command.from) return { committed: false, reason: 'INVALID_STATUS', status: row.status };
      db.prepare('UPDATE phase7b_concurrency_resources SET status=?,version=version+1 WHERE id=?').run(command.to, command.resourceId);
      const result = { committed: true, status: command.to };
      saveEffect(command.key, payload, command.resourceId, 'TRANSITION', result);
      return result;
    });
  }
  if (command.action === 'post') {
    return transaction(db, () => {
      const period = db.prepare('SELECT status FROM phase7b_concurrency_resources WHERE id=? FOR UPDATE').get(command.periodId);
      if (period?.status !== 'OPEN') return { committed: false, reason: 'PERIOD_CLOSED' };
      if (command.delayMs) sleep(command.delayMs);
      db.prepare('UPDATE phase7b_concurrency_resources SET used_quantity=used_quantity+1,version=version+1 WHERE id=?').run(command.periodId);
      return { committed: true };
    });
  }
  if (command.action === 'normal-business') {
    return transaction(db, () => {
      const state = db.prepare('SELECT status FROM phase7b_concurrency_resources WHERE id=? FOR UPDATE').get(command.resourceId);
      if (state?.status !== 'ACTIVE') return { committed: false, reason: 'NOT_ACTIVE' };
      if (command.delayMs) sleep(command.delayMs);
      db.prepare('UPDATE phase7b_concurrency_resources SET used_quantity=used_quantity+1,version=version+1 WHERE id=?').run(command.resourceId);
      return { committed: true };
    });
  }
  throw new Error(`Unknown action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const result = execute(request.command);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: {
      message: error.message, code: error.code,
      errno: error.errno, sqlState: error.sqlState, sqlMessage: error.sqlMessage,
      transactionRetryExhausted: error.transactionRetryExhausted || false,
      transactionAttempts: error.transactionAttempts,
    } })}\n`);
  }
});
lines.on('close', () => db.close());
