// V21 — Inventory Lock / Unlock (Wave B).
//
// Frozen by `solution.md §27.15` (Domain 5 Closure Design).
// Lock truth lives ONLY in `inventory_locks`. Inventory table MUST NOT own
// `is_locked` Boolean.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { computePositionKey } from '../lib/inventory-position.js';

function nowIso() { return new Date().toISOString(); }

function rowToLock(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    positionKey: row.position_key,
    quantity: Number(row.quantity),
    reason: row.reason,
    status: row.status,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    releasedBy: row.released_by,
    releasedAt: row.released_at,
    sourceType: row.source_type,
    sourceId: row.source_id,
  };
}

export async function createInventoryLock(db, req, res, actor) {
  allow(actor, 'INVENTORY_LOCK_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['productId','warehouseId','positionKey','quantity','reason','sourceType','sourceId']);
  const productId   = String(body.productId ?? '').trim();
  const warehouseId = String(body.warehouseId ?? '').trim();
  const quantity    = Number(body.quantity);
  const reason      = String(body.reason ?? '').trim();
  const sourceType  = String(body.sourceType ?? 'INVENTORY_LOCK').trim();
  const sourceId    = String(body.sourceId ?? '').trim() || `${sourceType}-${Date.now()}`;
  const positionKey = body.positionKey ? String(body.positionKey) : computePositionKey({
    productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  if (!productId || !warehouseId || !Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '产品 / 仓库 / 数量必填');
  if (!reason) throw new HttpError(400, '锁定原因必填');
  // Validate against lockable on_hand
  const onHand = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1 AND stock_status='AVAILABLE'`).get(productId, warehouseId)?.q || 0);
  const alreadyLocked = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE position_key=? AND status='ACTIVE'`).get(positionKey)?.q || 0);
  if (alreadyLocked + quantity > onHand) {
    throw new HttpError(409, `锁库数量超过可锁量：可用 ${onHand - alreadyLocked}，需锁 ${quantity}`);
  }
  const lockId = genId();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_locks(id, product_id, warehouse_id, position_key, quantity, reason, status, locked_by, locked_at, source_type, source_id)
      VALUES(?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `).run(lockId, productId, warehouseId, positionKey, quantity, reason, actor.id, now, sourceType, sourceId);
    audit(db, actor.id, 'INVENTORY_LOCK_CREATE', 'INVENTORY_LOCK', lockId, `锁定 ${quantity} ${productId}@${warehouseId}`);
  });
  return send(res, 201, { id: lockId, status: 'ACTIVE' });
}

export function releaseInventoryLock(db, res, actor, lockId) {
  allow(actor, 'INVENTORY_LOCK_MANAGE');
  const lock = db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(lockId);
  if (!lock) throw new HttpError(404, '锁定不存在');
  if (lock.status !== 'ACTIVE') throw new HttpError(409, `锁定状态为 ${lock.status}，不可重复解锁`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_locks SET status='RELEASED', released_by=?, released_at=? WHERE id=?`).run(actor.id, now, lockId);
    audit(db, actor.id, 'INVENTORY_LOCK_RELEASE', 'INVENTORY_LOCK', lockId, `解锁 ${lock.quantity} ${lock.product_id}@${lock.warehouse_id}`);
  });
  return send(res, 200, { id: lockId, status: 'RELEASED' });
}

export function listInventoryLocks(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_LOCK_VIEW', 'INVENTORY_LOCK_MANAGE']);
  const productId = url.searchParams.get('productId');
  const warehouseId = url.searchParams.get('warehouseId');
  const status = url.searchParams.get('status');
  const params = [];
  const where = ['1=1'];
  if (productId)   { where.push('product_id=?');   params.push(productId); }
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  if (status)      { where.push('status=?');        params.push(status); }
  const rows = db.prepare(`
    SELECT * FROM inventory_locks WHERE ${where.join(' AND ')} ORDER BY locked_at DESC LIMIT 200
  `).all(...params).map(rowToLock);
  return send(res, 200, { locks: rows });
}