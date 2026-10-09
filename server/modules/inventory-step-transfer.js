// V21 — Step Transfer / In-Transit (Wave B).
//
// Frozen by `solution.md §27.20` (Domain 5 Closure Design).
//
// in-transit quantity derived from execution facts:
//   in_transit_qty = issued_qty - received_qty - returned_qty - cancelled_qty
//
// inventory_step_transfer_in_transit holds execution facts ONLY.
// Not a second stock balance.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_step_transfer_in_transit (
      id TEXT PRIMARY KEY,
      source_transfer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      warehouse_id_source TEXT NOT NULL,
      warehouse_id_destination TEXT NOT NULL,
      issued_qty REAL NOT NULL,
      received_qty REAL NOT NULL DEFAULT 0,
      returned_qty REAL NOT NULL DEFAULT 0,
      cancelled_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK(status IN ('IN_TRANSIT','CLOSED','CANCELLED')),
      created_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY (source_transfer_id) REFERENCES inventory_transfers(id),
      FOREIGN KEY (warehouse_id_source) REFERENCES warehouses(id),
      FOREIGN KEY (warehouse_id_destination) REFERENCES warehouses(id)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_step_transfer_source ON inventory_step_transfer_in_transit(source_transfer_id, product_id);
  `);
}

function getOrCreateStepRow(db, sourceTransferId, productId, sourceWh, destWh) {
  let row = db.prepare(`
    SELECT * FROM inventory_step_transfer_in_transit
     WHERE source_transfer_id=? AND product_id=? AND warehouse_id_source=? AND warehouse_id_destination=?
  `).get(sourceTransferId, productId, sourceWh, destWh);
  if (row) return row;
  const id = genId();
  db.prepare(`
    INSERT INTO inventory_step_transfer_in_transit(id, source_transfer_id, product_id, warehouse_id_source, warehouse_id_destination, issued_qty, received_qty, returned_qty, cancelled_qty, status, created_at)
    VALUES(?, ?, ?, ?, ?, 0, 0, 0, 0, 'IN_TRANSIT', ?)
  `).run(id, sourceTransferId, productId, sourceWh, destWh, nowIso());
  return db.prepare(`SELECT * FROM inventory_step_transfer_in_transit WHERE id=?`).get(id);
}

export async function transferOut(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceTransferId','productId','quantity','fromWarehouseId','toWarehouseId','businessDate']);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, 'quantity 必须为正');
  const transferId = String(body.sourceTransferId);
  const stepTransfer = db.prepare(`SELECT * FROM inventory_transfers WHERE id=?`).get(transferId);
  if (!stepTransfer) throw new HttpError(404, '原调拨单不存在');
  if (stepTransfer.from_warehouse_id !== String(body.fromWarehouseId) || stepTransfer.to_warehouse_id !== String(body.toWarehouseId)) {
    throw new HttpError(400, '原调拨单方向与本次不一致');
  }
  const now = nowIso();
  const businessDate = body.businessDate || now.slice(0, 10);
  const stepId = genId();
  transaction(db, () => {
    ensureTable(db);
    getOrCreateStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_OUT',
      sourceId: transferId,
      sourceItemId: stepId,
      businessDate,
      actor: { id: actor.id },
      movementKind: 'OUT',
      quantity,
      fromPosition: { productId: body.productId, warehouseId: body.fromWarehouseId, stockStatus: 'AVAILABLE' },
      idempotencyKey: `STEP_OUT:${transferId}:${body.productId}:${quantity}:${now}`,
      remark: `Step transfer out ${body.productId}`,
    });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET issued_qty=issued_qty+? WHERE id=(SELECT id FROM inventory_step_transfer_in_transit WHERE source_transfer_id=? AND product_id=? AND warehouse_id_source=? AND warehouse_id_destination=?)`).run(quantity, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    audit(db, actor.id, 'STEP_OUT', 'INVENTORY_STEP_TRANSFER', stepId, `Transfer Out ${quantity} ${body.productId}`);
  });
  return send(res, 201, { id: stepId, status: 'IN_TRANSIT' });
}

export async function transferIn(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceTransferId','productId','quantity','fromWarehouseId','toWarehouseId','businessDate']);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, 'quantity 必须为正');
  const transferId = String(body.sourceTransferId);
  const now = nowIso();
  const businessDate = body.businessDate || now.slice(0, 10);
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getOrCreateStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    const inTransit = Number(stepRow.issued_qty) - Number(stepRow.received_qty) - Number(stepRow.returned_qty) - Number(stepRow.cancelled_qty);
    if (quantity > inTransit) throw new HttpError(409, `In-transit 可用量不足：${inTransit}，需收 ${quantity}`);
    applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: transferId,
      sourceItemId: stepRow.id,
      businessDate,
      actor: { id: actor.id },
      movementKind: 'IN',
      quantity,
      toPosition: { productId: body.productId, warehouseId: body.toWarehouseId, stockStatus: 'AVAILABLE' },
      idempotencyKey: `STEP_IN:${stepRow.id}:${quantity}:${now}`,
      remark: `Step transfer in ${body.productId}`,
    });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET received_qty=received_qty+? WHERE id=?`).run(quantity, stepRow.id);
    audit(db, actor.id, 'STEP_IN', 'INVENTORY_STEP_TRANSFER', stepRow.id, `Transfer In ${quantity} ${body.productId}`);
  });
  return send(res, 201, { ok: true });
}

export function cancelRemaining(db, res, actor, sourceTransferId, productId, fromWh, toWh) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getOrCreateStepRow(db, sourceTransferId, productId, fromWh, toWh);
    const inTransit = Number(stepRow.issued_qty) - Number(stepRow.received_qty) - Number(stepRow.returned_qty);
    if (inTransit <= 0) throw new HttpError(409, 'No in-transit remaining to cancel');
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET cancelled_qty=cancelled_qty+?, status='CLOSED', closed_at=? WHERE id=?`).run(inTransit, nowIso(), stepRow.id);
    audit(db, actor.id, 'STEP_CANCEL', 'INVENTORY_STEP_TRANSFER', stepRow.id, `Cancel remaining ${inTransit} ${productId}`);
  });
  return send(res, 200, { ok: true });
}

export function returnToSource(db, res, actor, sourceTransferId, productId, fromWh, toWh, quantity, businessDate) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new HttpError(400, 'quantity 必须为正');
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getOrCreateStepRow(db, sourceTransferId, productId, fromWh, toWh);
    const inTransit = Number(stepRow.issued_qty) - Number(stepRow.received_qty) - Number(stepRow.returned_qty);
    if (q > inTransit) throw new HttpError(409, `In-transit insufficient for return-to-source: ${inTransit} < ${q}`);
    applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: sourceTransferId,
      sourceItemId: stepRow.id,
      businessDate: businessDate || now.slice(0, 10),
      actor: { id: actor.id },
      movementKind: 'IN',
      quantity: q,
      toPosition: { productId, warehouseId: fromWh, stockStatus: 'AVAILABLE' },
      idempotencyKey: `STEP_RETURN:${stepRow.id}:${q}:${now}`,
      remark: `Return to source ${productId}`,
    });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET returned_qty=returned_qty+? WHERE id=?`).run(q, stepRow.id);
    audit(db, actor.id, 'STEP_RETURN', 'INVENTORY_STEP_TRANSFER', stepRow.id, `Return ${q} ${productId}`);
  });
  return send(res, 200, { ok: true });
}

export function getInTransit(db, res, actor, sourceTransferId) {
  const rows = db.prepare(`
    SELECT source_transfer_id, product_id, warehouse_id_source, warehouse_id_destination,
           issued_qty, received_qty, returned_qty, cancelled_qty, status,
           (issued_qty - received_qty - returned_qty - cancelled_qty) AS in_transit_qty
      FROM inventory_step_transfer_in_transit
     WHERE source_transfer_id=?
  `).all(sourceTransferId);
  return send(res, 200, { stepTransfers: rows });
}