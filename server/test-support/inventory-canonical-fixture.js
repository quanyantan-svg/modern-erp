// V21 — Canonical Inventory Fixture Helper.
//
// Single source of truth for inventory row insert/update in test fixtures.
// Replaces legacy ON CONFLICT(warehouse_id, product_id) patterns that no
// longer apply under multidimensional position_key UNIQUE.
//
// Default canonical position (used by every frozen test fixture):
//   owner_type = ENTERPRISE
//   owner_id = NULL
//   stock_status = AVAILABLE
//   bin_id = NULL
//   lot_id = NULL
//   serial_id = NULL

import { computePositionKey } from '../lib/inventory-position.js';
import { id as genId } from '../db.js';

const DEFAULT_POSITION = {
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
};

export function buildCanonicalInventoryRow({
  warehouseId,
  productId,
  quantity = 0,
  position = {},
  rowId,
}) {
  const p = { ...DEFAULT_POSITION, ...position };
  return {
    id: rowId,
    warehouseId,
    productId,
    quantity,
    binId: p.binId ?? null,
    ownerType: p.ownerType ?? 'ENTERPRISE',
    ownerId: p.ownerId ?? null,
    stockStatus: p.stockStatus ?? 'AVAILABLE',
    lotId: p.lotId ?? null,
    serialId: p.serialId ?? null,
    positionKey: computePositionKey({
      productId,
      warehouseId,
      binId: p.binId,
      ownerType: p.ownerType,
      ownerId: p.ownerId,
      stockStatus: p.stockStatus,
      lotId: p.lotId,
      serialId: p.serialId,
    }),
  };
}

// Upsert one canonical inventory position. Replaces legacy INSERT OR IGNORE.
export function upsertCanonicalInventory(db, input) {
  const r = buildCanonicalInventoryRow(input);
  db.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at,
      position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(position_key) DO UPDATE SET
      quantity = excluded.quantity,
      updated_at = excluded.updated_at
  `).run(
    r.id || genId(),
    r.warehouseId,
    r.productId,
    r.quantity,
    new Date().toISOString(),
    r.positionKey,
    r.binId,
    r.ownerType,
    r.ownerId,
    r.stockStatus,
    r.lotId,
    r.serialId,
  );
  return r;
}

// Read current quantity at canonical position.
export function readCanonicalInventoryQuantity(db, { warehouseId, productId, position = {} }) {
  const r = buildCanonicalInventoryRow({ warehouseId, productId, quantity: 0, position });
  const row = db.prepare(`SELECT quantity FROM inventory WHERE position_key=? AND active=1`).get(r.positionKey);
  return row ? Number(row.quantity) : 0;
}

// Sum quantity across ALL canonical positions for (warehouse, product).
// Replaces legacy SUM(quantity) WHERE warehouse_id=? AND product_id=?
// (which still works since warehouse+product is part of the position_key).
export function sumCanonicalInventoryByWarehouseProduct(db, { warehouseId, productId }) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM inventory
     WHERE warehouse_id=? AND product_id=? AND active=1
  `).get(warehouseId, productId);
  return Number(row?.q || 0);
}