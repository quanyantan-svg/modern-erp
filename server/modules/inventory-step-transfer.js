// V21 — Step Transfer / In-Transit (Final Closure).
//
// Frozen by `solution.md §27.20` (Domain 5 Closure Design).
// In-transit quantity is DERIVED from execution facts (NOT a second balance).
//   in_transit_qty = issued - received - returned - cancelled
// All physical mutations route through applyInventoryMutation dispatcher.
// Over-receive is rejected by the dispatcher when the position has no stock;
// the step-transfer layer enforces the in-transit availability bound.

import { transaction, id as genId } from '../db.js';
import { ensureIndex } from '../lib/schema-ensure.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import {
  issuedCarryingValueCentsByPosition, receiveSingleLegInboundValue,
} from './inventory-single-leg-valuation.js';

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_step_transfer_in_transit'").get();
  if (exists) return;
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
  `);
  ensureIndex(db, 'idx_inventory_step_transfer_source', 'inventory_step_transfer_in_transit', 'source_transfer_id, product_id');
}

function getStepRow(db, sourceTransferId, productId, sourceWh, destWh) {
  return db.prepare(`
    SELECT * FROM inventory_step_transfer_in_transit
     WHERE source_transfer_id=? AND product_id=? AND warehouse_id_source=? AND warehouse_id_destination=?
  `).get(sourceTransferId, productId, sourceWh, destWh);
}

function computeInTransit(row) {
  return Number(row.issued_qty) - Number(row.received_qty) - Number(row.returned_qty) - Number(row.cancelled_qty);
}

export async function transferOut(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceTransferId','productId','quantity','fromWarehouseId','toWarehouseId','businessDate']);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  const transferId = String(body.sourceTransferId);
  const now = nowIso();
  const businessDate = body.businessDate || now.slice(0, 10);
  const stepId = genId();
  transaction(db, () => {
    ensureTable(db);
    getStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    // Physical OUT (BLOCK policy enforced by applyInventoryMutation).
    applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_OUT',
      sourceId: transferId,
      sourceItemId: stepId,
      businessDate,
      actor: { id: actor.id },
      movementKind: 'OUT',
      quantity,
      fromPosition: {
        productId: body.productId,
        warehouseId: body.fromWarehouseId,
        ownerType: 'ENTERPRISE',
        ownerId: null,
        stockStatus: 'AVAILABLE',
      },
      idempotencyKey: `STEP_OUT:${transferId}:${stepId}`,
      remark: `Step transfer out ${body.productId}`,
    });
    // Update or insert step row.
    const existing = getStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    if (existing) {
      db.prepare(`UPDATE inventory_step_transfer_in_transit SET issued_qty=issued_qty+? WHERE id=?`).run(quantity, existing.id);
    } else {
      db.prepare(`INSERT INTO inventory_step_transfer_in_transit(id, source_transfer_id, product_id, warehouse_id_source, warehouse_id_destination, issued_qty, received_qty, returned_qty, cancelled_qty, status, created_at) VALUES(?, ?, ?, ?, ?, ?, 0, 0, 0, 'IN_TRANSIT', ?)`).run(stepId, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId, quantity, now);
    }
    audit(db, actor.id, 'STEP_OUT', 'INVENTORY_STEP_TRANSFER', stepId, `Transfer Out ${quantity} ${body.productId}`);
  });
  return send(res, 201, { id: stepId, status: 'IN_TRANSIT' });
}

export async function transferIn(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceTransferId','productId','quantity','fromWarehouseId','toWarehouseId','businessDate']);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  const transferId = String(body.sourceTransferId);
  const now = nowIso();
  const businessDate = body.businessDate || now.slice(0, 10);
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    if (!stepRow) throw new HttpError(404, '未找到分步调拨记录，请先执行调出');
    const inTransit = computeInTransit(stepRow);
    if (quantity > inTransit) {
      throw new HttpError(409, `在途库存不足：可用 ${inTransit}，需求 ${quantity}`, {
        code: 'IN_TRANSIT_INSUFFICIENT',
        resolution: '请减少收货数量，或追加一笔调出',
      });
    }
    const stepItemId = stepRow.id;
    const applied = applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: transferId,
      sourceItemId: stepItemId,
      businessDate,
      actor: { id: actor.id },
      movementKind: 'IN',
      quantity,
      toPosition: {
        productId: body.productId,
        warehouseId: body.toWarehouseId,
        ownerType: 'ENTERPRISE',
        ownerId: null,
        stockStatus: 'AVAILABLE',
      },
      idempotencyKey: `STEP_IN:${stepItemId}:${quantity}:${now}`,
    });
    // 单腿入库腿的自持计值（Requirement §32.18 `IW-VAL-05`）：入库价值 = **调出腿**
    // 的权威账面价值（同一批货在途前的账面单价 × 本次入库数量）。
    const issuedCents = issuedCarryingValueCentsByPosition(db, {
      sourceType: 'INVENTORY_STEP_TRANSFER_OUT', sourceId: transferId,
      productId: body.productId, warehouseId: body.fromWarehouseId,
    });
    const issuedQuantity = Number(stepRow.issued_qty);
    const inbound = applied.movements.find((movement) => movement.direction === 'IN');
    receiveSingleLegInboundValue(db, {
      businessDate,
      productId: body.productId,
      warehouseId: body.toWarehouseId,
      quantity,
      valueCents: issuedQuantity > 0 ? Math.round((-issuedCents) * quantity / issuedQuantity) : 0,
      valuationBasis: 'STEP_TRANSFER_CARRYING',
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: transferId,
      sourceItemId: stepItemId,
      inventoryTransactionId: inbound?.transactionId || null,
      movementType: `INVENTORY_STEP_TRANSFER_IN_${Number(stepRow.received_qty) + 1}`,
    });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET received_qty=received_qty+? WHERE id=?`).run(quantity, stepRow.id);
    // If fully received → CLOSED
    const updated = getStepRow(db, transferId, body.productId, body.fromWarehouseId, body.toWarehouseId);
    if (computeInTransit(updated) === 0) {
      db.prepare(`UPDATE inventory_step_transfer_in_transit SET status='CLOSED', closed_at=? WHERE id=?`).run(now, stepRow.id);
    }
    audit(db, actor.id, 'STEP_IN', 'INVENTORY_STEP_TRANSFER', stepItemId, `Transfer In ${quantity} ${body.productId}`);
  });
  return send(res, 201, { ok: true });
}

export function cancelRemaining(db, res, actor, sourceTransferId, productId, fromWh, toWh) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getStepRow(db, sourceTransferId, productId, fromWh, toWh);
    if (!stepRow) throw new HttpError(404, '分步调拨单不存在');
    const inTransit = computeInTransit(stepRow);
    if (inTransit <= 0) throw new HttpError(409, '没有可取消的在途数量');
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET cancelled_qty=cancelled_qty+?, status='CLOSED', closed_at=? WHERE id=?`).run(inTransit, now, stepRow.id);
    audit(db, actor.id, 'STEP_CANCEL', 'INVENTORY_STEP_TRANSFER', stepRow.id, `Cancel remaining ${inTransit} ${productId}`);
  });
  return send(res, 200, { ok: true });
}

export function returnToSource(db, res, actor, sourceTransferId, productId, fromWh, toWh, quantity, businessDate) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new HttpError(400, '数量必须大于 0');
  const now = nowIso();
  const bizDate = businessDate || now.slice(0, 10);
  transaction(db, () => {
    ensureTable(db);
    const stepRow = getStepRow(db, sourceTransferId, productId, fromWh, toWh);
    if (!stepRow) throw new HttpError(404, '分步调拨单不存在');
    const inTransit = computeInTransit(stepRow);
    if (q > inTransit) throw new HttpError(409, `在途库存不足以退回来源仓：${inTransit} < ${q}`);
    const applied = applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: sourceTransferId,
      sourceItemId: stepRow.id,
      businessDate: bizDate,
      actor: { id: actor.id },
      movementKind: 'IN',
      quantity: q,
      toPosition: {
        productId,
        warehouseId: fromWh,
        ownerType: 'ENTERPRISE',
        ownerId: null,
        stockStatus: 'AVAILABLE',
      },
      idempotencyKey: `STEP_RETURN:${stepRow.id}:${q}:${now}`,
      remark: 'Return to source',
    });
    // 退回来源仓的单腿入库腿：价值同样取**调出腿**的权威账面价值
    // （Requirement §32.18 `IW-VAL-05`）——退回的是同一批货。
    const issuedCents = issuedCarryingValueCentsByPosition(db, {
      sourceType: 'INVENTORY_STEP_TRANSFER_OUT', sourceId: sourceTransferId,
      productId, warehouseId: fromWh,
    });
    const issuedQuantity = Number(stepRow.issued_qty);
    const inbound = applied.movements.find((movement) => movement.direction === 'IN');
    receiveSingleLegInboundValue(db, {
      businessDate: bizDate,
      productId,
      warehouseId: fromWh,
      quantity: q,
      valueCents: issuedQuantity > 0 ? Math.round((-issuedCents) * q / issuedQuantity) : 0,
      valuationBasis: 'STEP_TRANSFER_CARRYING',
      sourceType: 'INVENTORY_STEP_TRANSFER_IN',
      sourceId: sourceTransferId,
      sourceItemId: stepRow.id,
      inventoryTransactionId: inbound?.transactionId || null,
      movementType: `INVENTORY_STEP_TRANSFER_RETURN_${Number(stepRow.returned_qty) + 1}`,
    });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET returned_qty=returned_qty+? WHERE id=?`).run(q, stepRow.id);
    const updated = getStepRow(db, sourceTransferId, productId, fromWh, toWh);
    if (computeInTransit(updated) === 0) {
      db.prepare(`UPDATE inventory_step_transfer_in_transit SET status='CLOSED', closed_at=? WHERE id=?`).run(now, stepRow.id);
    }
    audit(db, actor.id, 'STEP_RETURN', 'INVENTORY_STEP_TRANSFER', stepRow.id, `Return ${q} ${productId}`);
  });
  return send(res, 200, { ok: true });
}

export function getInTransit(db, res, actor, sourceTransferId) {
  allowAny(actor, ['INVENTORY_VIEW', 'INVENTORY_TRANSFER_VIEW']);
  ensureTable(db);
  const rows = db.prepare(`
    SELECT source_transfer_id sourceTransferId, product_id productId,
           warehouse_id_source warehouseIdSource, warehouse_id_destination warehouseIdDestination,
           issued_qty issuedQty, received_qty receivedQty, returned_qty returnedQty, cancelled_qty cancelledQty, status,
           (issued_qty - received_qty - returned_qty - cancelled_qty) AS inTransitQty
      FROM inventory_step_transfer_in_transit
     WHERE source_transfer_id=?
  `).all(sourceTransferId);
  return send(res, 200, { stepTransfers: rows });
}
