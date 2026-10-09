// V21 — Direct Transfer (Wave B).
//
// Frozen by `solution.md §27.19` (Domain 5 Closure Design).
// Direct transfer writes a paired OUT + IN through applyInventoryMutation.
// Movement_kind = MOVE; movement_group_id shared.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';

function nowIso() { return new Date().toISOString(); }

function readTransfer(db, transferId) {
  return db.prepare(`SELECT * FROM inventory_transfers WHERE id=?`).get(transferId);
}

function readItems(db, transferId) {
  return db.prepare(`SELECT * FROM inventory_transfer_items WHERE transfer_id=? ORDER BY line_no, id`).all(transferId);
}

export async function createInventoryTransfer(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CREATE');
  const body = await readJson(req);
  assertAllowedFields(body, ['fromWarehouseId','toWarehouseId','items','remark','businessDate']);
  const fromWarehouseId = String(body.fromWarehouseId ?? '').trim();
  const toWarehouseId = String(body.toWarehouseId ?? '').trim();
  if (!fromWarehouseId || !toWarehouseId) throw new HttpError(400, '调出 / 调入仓库必填');
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, '调出 / 调入仓库不可相同');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '至少一行明细');
  const businessDate = body.businessDate || new Date().toISOString().slice(0, 10);
  const transferId = genId();
  const transferNo = `IT-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_transfers(id, transfer_no, from_warehouse_id, to_warehouse_id, status, remark, creator_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    `).run(transferId, transferNo, fromWarehouseId, toWarehouseId, body.remark || '', actor.id, now, now);
    let lineNo = 1;
    for (const item of body.items) {
      const productId = String(item.productId ?? '').trim();
      const quantity = Number(item.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, `第${lineNo}行产品或数量无效`);
      db.prepare(`
        INSERT INTO inventory_transfer_items(id, transfer_id, product_id, quantity, line_no)
        VALUES(?, ?, ?, ?, ?)
      `).run(genId(), transferId, productId, quantity, lineNo++);
    }
    audit(db, actor.id, 'CREATE', 'INVENTORY_TRANSFER', transferId, `创建直接调拨 ${transferNo}`);
  });
  return send(res, 201, { id: transferId, transferNo, status: 'DRAFT' });
}

export function confirmInventoryTransfer(db, res, actor, transferId) {
  allow(actor, 'INVENTORY_TRANSFER_CONFIRM');
  const transfer = readTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '调拨单不存在');
  if (transfer.status !== 'DRAFT') throw new HttpError(409, `状态 ${transfer.status} 不可确认`);
  const items = readItems(db, transferId);
  if (!items.length) throw new HttpError(409, '调拨单没有明细');
  const now = nowIso();
  transaction(db, () => {
    for (const item of items) {
      applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_TRANSFER',
        sourceId: transferId,
        sourceItemId: item.id,
        sourceNo: transfer.transfer_no,
        businessDate: transfer.business_date || now.slice(0, 10),
        actor: { id: actor.id },
        movementKind: 'MOVE',
        quantity: item.quantity,
        fromPosition: { productId: item.product_id, warehouseId: transfer.from_warehouse_id, stockStatus: 'AVAILABLE' },
        toPosition:   { productId: item.product_id, warehouseId: transfer.to_warehouse_id,   stockStatus: 'AVAILABLE' },
        idempotencyKey: `INVENTORY_TRANSFER:${transferId}:${item.id}`,
        remark: `直接调拨 ${transfer.transfer_no}`,
      });
    }
    db.prepare(`UPDATE inventory_transfers SET status='TRANSFERRED', updated_at=? WHERE id=?`).run(now, transferId);
    audit(db, actor.id, 'CONFIRM', 'INVENTORY_TRANSFER', transferId, `确认直接调拨 ${transfer.transfer_no}`);
  });
  return send(res, 200, { ok: true, status: 'TRANSFERRED' });
}