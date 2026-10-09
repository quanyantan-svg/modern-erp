// V21 — Inventory Reports (Wave D).
//
// Frozen by `solution.md §27.32 / §27.33 / §27.34 / §27.36`.
// All quantities derived from canonical `inventory` + movements. NOT from
// stale `products.stock_quantity`.

import { aggregateInventoryByWarehouseProduct, listCanonicalInventoryPositions } from './inventory-compat-read.js';

export function instantInventoryQuery(db, filters = {}) {
  // Instant inventory aggregate — uses canonical SUM from inventory table.
  return aggregateInventoryByWarehouseProduct(db, filters);
}

export function inventoryLedger(db, { warehouseId, productId, fromDate, toDate }) {
  const params = [];
  const where = ['1=1'];
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  if (productId)   { where.push('product_id=?');   params.push(productId); }
  if (fromDate)   { where.push('business_date>=?'); params.push(fromDate); }
  if (toDate)     { where.push('business_date<=?'); params.push(toDate); }
  const rows = db.prepare(`
    SELECT source_type sourceType, source_id sourceId, source_no sourceNo,
           direction, quantity_change quantityChange, balance_after balanceAfter,
           business_date businessDate, created_at createdAt
      FROM inventory_transactions
     WHERE ${where.join(' AND ')}
     ORDER BY business_date DESC, created_at DESC
     LIMIT 500
  `).all(...params).map((r) => ({
    ...r,
    quantityChange: Number(r.quantityChange),
    balanceAfter: r.balanceAfter === null ? null : Number(r.balanceAfter),
  }));
  return rows;
}

export function inventoryAging(db, { warehouseId, asOfDate }) {
  const today = asOfDate || new Date().toISOString().slice(0, 10);
  // Aging buckets based on last receipt (last IN movement) per (warehouse, product)
  const rows = db.prepare(`
    SELECT i.warehouse_id warehouseId, i.product_id productId,
           i.quantity, i.position_key positionKey,
           MAX(t.business_date) AS lastReceiptDate
      FROM inventory i
      LEFT JOIN inventory_transactions t
        ON t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id
       AND t.direction='IN'
     WHERE i.active=1
     GROUP BY i.warehouse_id, i.product_id, i.quantity, i.position_key
  `).all();
  return rows.map((r) => {
    const days = r.lastReceiptDate
      ? Math.floor((Date.parse(today) - Date.parse(r.lastReceiptDate)) / 86_400_000)
      : null;
    let bucket = 'UNKNOWN';
    if (days === null) bucket = 'NO_RECEIPT';
    else if (days <= 30) bucket = '0-30';
    else if (days <= 90) bucket = '31-90';
    else if (days <= 180) bucket = '91-180';
    else if (days <= 365) bucket = '181-365';
    else bucket = '>365';
    return { ...r, quantity: Number(r.quantity), ageDays: days, ageBucket: bucket };
  });
}

export function slowMovingInventory(db, { thresholdDays = 180 } = {}) {
  const cutoff = new Date(Date.now() - thresholdDays * 86_400_000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT i.warehouse_id warehouseId, i.product_id productId,
           i.quantity,
           MAX(t.business_date) AS lastMovementDate
      FROM inventory i
      LEFT JOIN inventory_transactions t
        ON t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id
     WHERE i.active=1
     GROUP BY i.warehouse_id, i.product_id, i.quantity
  `).all();
  return rows.filter((r) => !r.lastMovementDate || r.lastMovementDate < cutoff)
    .map((r) => ({ ...r, quantity: Number(r.quantity) }));
}

export function inventoryAlerts(db) {
  // Negative-balance anomaly detector — surfaces positions where quantity < 0.
  const negative = db.prepare(`SELECT * FROM inventory WHERE quantity < 0 AND active=1`).all();
  return {
    negativeBalance: negative.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    asOf: new Date().toISOString(),
  };
}

export function inventoryPositionsList(db, filters) {
  return listCanonicalInventoryPositions(db, filters);
}