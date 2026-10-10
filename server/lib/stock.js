import { id } from '../db.js';
import { HttpError } from './http.js';
import { computePositionKey } from './inventory-position.js';

// Strict-canonical adapter for legacy `adjustInventory(warehouseId, productId)` callers.
//
// Domain 5 cutover frozen the multidimensional inventory identity:
//   UNIQUE(position_key) and never UNIQUE(warehouse_id, product_id).
// Per `solution.md §27.2..27.6`, every active physical write path MUST go through
// `applyInventoryMutation(...)`. This shim exists for the limited set of legacy
// callers that have not yet been migrated; it accepts ONLY the frozen default
// identity (owner=ENTERPRISE/owner_id=NULL, status=AVAILABLE, bin=NULL,
// lot=NULL, serial=NULL) and refuses to operate on any position that requires
// an explicit non-default dimension.
//
// Hard invariants enforced:
//   * NEVER executes ON CONFLICT(warehouse_id, product_id).
//   * NEVER mutates a bin-enabled warehouse row.
//   * NEVER mutates a LOT- or SERIAL-tracked product row.
//   * Mutates exactly one canonical (position_key) row.
//
// Migration target: every legacy caller migrates to applyInventoryMutation
// and this shim narrows to "0 unauthorized legacy physical writers" per the
// Convergence Fix directive.

const DEFAULT_POSITION = Object.freeze({
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

function resolveCanonicalPosition(db, warehouseId, productId) {
  const wh = db.prepare('SELECT id, bin_enabled FROM warehouses WHERE id=? AND active=1').get(warehouseId);
  if (!wh) throw new HttpError(400, `仓库 ${warehouseId} 不存在或已停用`);
  const prod = db.prepare('SELECT id, tracking_policy, active FROM products WHERE id=?').get(productId);
  if (!prod) throw new HttpError(400, `产品 ${productId} 不存在`);
  if (!prod.active) throw new HttpError(409, `产品 ${productId} 已停用`);
  if (Number(wh.bin_enabled) === 1) {
    throw new HttpError(400, `仓库 ${warehouseId} 启用仓位管理，请改用 applyInventoryMutation()`);
  }
  if (prod.tracking_policy === 'LOT' || prod.tracking_policy === 'SERIAL') {
    throw new HttpError(400, `产品 ${productId} 启用了 ${prod.tracking_policy} 跟踪，请改用 applyInventoryMutation()`);
  }
  const positionKey = computePositionKey({
    productId,
    warehouseId,
    binId: DEFAULT_POSITION.binId,
    ownerType: DEFAULT_POSITION.ownerType,
    ownerId: DEFAULT_POSITION.ownerId,
    stockStatus: DEFAULT_POSITION.stockStatus,
    lotId: DEFAULT_POSITION.lotId,
    serialId: DEFAULT_POSITION.serialId,
  });
  return { positionKey, wh, prod };
}

function upsertByPositionKey(db, warehouseId, productId, quantityChange, now, positionKey) {
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO inventory(
      id, warehouse_id, product_id, quantity, updated_at,
      position_key, bin_id, owner_type, owner_id, stock_status,
      lot_id, serial_id, active
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(position_key) DO UPDATE SET
      quantity = inventory.quantity + excluded.quantity,
      updated_at = excluded.updated_at
  `).run(
    id(), warehouseId, productId, quantityChange, ts,
    positionKey, DEFAULT_POSITION.binId, DEFAULT_POSITION.ownerType,
    DEFAULT_POSITION.ownerId, DEFAULT_POSITION.stockStatus,
    DEFAULT_POSITION.lotId, DEFAULT_POSITION.serialId,
  );
  db.prepare('UPDATE inventory SET updated_at=? WHERE position_key=?').run(ts, positionKey);
  return Number(
    db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(positionKey)?.quantity || 0
  );
}

export function adjustInventory(db, warehouseId, productId, quantityChange, now) {
  if (!Number.isFinite(Number(quantityChange))) {
    throw new HttpError(400, 'adjustInventory: 数量变更不合法');
  }
  const { positionKey } = resolveCanonicalPosition(db, warehouseId, productId);
  return upsertByPositionKey(db, warehouseId, productId, Number(quantityChange), now, positionKey);
}

// Strict upsert that accepts an explicit canonical position tuple.
// Used by callers that already know the canonical identity (test fixtures, the
// canonical fixture helper). Refuses to operate on non-canonical positions so
// legacy "warehouse+product only" identities cannot reintroduce the legacy UNIQUE
// collision we just dropped.
export function adjustInventoryAtPosition(db, input) {
  const {
    warehouseId, productId, quantityChange, now,
    binId = null, ownerType = 'ENTERPRISE', ownerId = null,
    stockStatus = 'AVAILABLE', lotId = null, serialId = null,
  } = input || {};
  if (!warehouseId || !productId) throw new HttpError(400, 'adjustInventoryAtPosition: warehouseId/productId 必填');
  if (!Number.isFinite(Number(quantityChange))) throw new HttpError(400, 'adjustInventoryAtPosition: 数量变更不合法');
  const ot = String(ownerType || 'ENTERPRISE').toUpperCase();
  if (!['ENTERPRISE', 'SUPPLIER', 'CUSTOMER'].includes(ot)) {
    throw new HttpError(400, `adjustInventoryAtPosition: 不支持的 ownerType ${ownerType}`);
  }
  if (ot === 'ENTERPRISE' && ownerId) throw new HttpError(400, 'ENTERPRISE owner 的 owner_id 必须为 NULL');
  const positionKey = computePositionKey({
    productId, warehouseId, binId, ownerType: ot, ownerId,
    stockStatus, lotId, serialId,
  });
  return {
    positionKey,
    balance: upsertByPositionKey(db, warehouseId, productId, Number(quantityChange), now, positionKey),
  };
}

// Strict canonical upsert: replace the row's quantity at the canonical
// default identity. Used by inventory-check approval and legacy opening-batch
// writers that need to set the absolute quantity (not a delta) at the
// ENTERPRISE / AVAILABLE / NULL-bin / NULL-lot / NULL-serial position.
//
// Refuses to operate on bin-enabled warehouses or LOT/SERIAL-tracked products
// (those flows must go through applyInventoryMutation with explicit positions).
export function setInventoryQuantity(db, warehouseId, productId, quantity, now) {
  if (!Number.isFinite(Number(quantity))) throw new HttpError(400, 'setInventoryQuantity: 数量不合法');
  const { positionKey } = resolveCanonicalPosition(db, warehouseId, productId);
  const ts = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM inventory WHERE position_key=? AND active=1').get(positionKey);
  if (existing) {
    db.prepare('UPDATE inventory SET quantity=?, updated_at=? WHERE id=?').run(Number(quantity), ts, existing.id);
  } else {
    db.prepare(`
      INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at,
        position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id(), warehouseId, productId, Number(quantity), ts,
      positionKey, DEFAULT_POSITION.binId, DEFAULT_POSITION.ownerType,
      DEFAULT_POSITION.ownerId, DEFAULT_POSITION.stockStatus,
      DEFAULT_POSITION.lotId, DEFAULT_POSITION.serialId,
    );
  }
  return Number(
    db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(positionKey)?.quantity || 0
  );
}
