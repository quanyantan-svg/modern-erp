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

// INV-37 — canonical inventory alerts.
//
// The thresholds come from `inventory_alert_thresholds` (the parameterized
// table Design §27.34 names), and the quantities come from the canonical
// inventory rows. The stale `products.stock_quantity` is NOT an inventory
// fact and is never used here.
export function inventoryAlerts(db, { warehouseId = null, today = null } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const params = [];
  const where = ["i.active=1"];
  if (warehouseId) { where.push('i.warehouse_id=?'); params.push(warehouseId); }
  const thresholds = db.prepare(`
    SELECT t.product_id productId, t.warehouse_id warehouseId,
           t.min_stock minStock, t.max_stock maxStock, t.safety_stock safetyStock,
           t.reorder_point reorderPoint, t.expiry_warn_days expiryWarnDays,
           p.code productCode, p.name productName
      FROM inventory_alert_thresholds t
      JOIN products p ON p.id=t.product_id
     ORDER BY p.code
  `).all();
  const thresholdByKey = new Map(thresholds.map((t) => [`${t.productId}|${t.warehouseId}`, t]));
  const positions = db.prepare(`
    SELECT i.warehouse_id warehouseId, i.product_id productId,
           i.bin_id binId, i.owner_type ownerType, i.owner_id ownerId,
           i.stock_status stockStatus, i.lot_id lotId, i.serial_id serialId,
           SUM(i.quantity) quantity,
           MIN(l.expiry_date) earliestExpiry
      FROM inventory i
      LEFT JOIN inventory_lots l ON l.id=i.lot_id
     WHERE ${where.join(' AND ')}
     GROUP BY i.warehouse_id, i.product_id, i.bin_id, i.owner_type, i.owner_id,
              i.stock_status, i.lot_id, i.serial_id
  `).all(...params);
  const alerts = [];
  const warnDays = 30;
  for (const position of positions) {
    const threshold = thresholdByKey.get(`${position.productId}|${position.warehouseId}`);
    const available = position.stockStatus === 'AVAILABLE' ? Number(position.quantity) : 0;
    if (threshold) {
      if (threshold.minStock !== null && threshold.minStock !== undefined && available < Number(threshold.minStock)) {
        alerts.push({ type: 'MIN_STOCK_ALERT', productId: position.productId, warehouseId: position.warehouseId, availableQuantity: available, threshold: Number(threshold.minStock) });
      }
      if (threshold.maxStock !== null && threshold.maxStock !== undefined && available > Number(threshold.maxStock)) {
        alerts.push({ type: 'MAX_STOCK_ALERT', productId: position.productId, warehouseId: position.warehouseId, availableQuantity: available, threshold: Number(threshold.maxStock) });
      }
      if (threshold.safetyStock !== null && threshold.safetyStock !== undefined && available < Number(threshold.safetyStock)) {
        alerts.push({ type: 'SAFETY_STOCK_ALERT', productId: position.productId, warehouseId: position.warehouseId, availableQuantity: available, threshold: Number(threshold.safetyStock) });
      }
      if (threshold.reorderPoint !== null && threshold.reorderPoint !== undefined && available < Number(threshold.reorderPoint)) {
        alerts.push({ type: 'REORDER_ALERT', productId: position.productId, warehouseId: position.warehouseId, availableQuantity: available, threshold: Number(threshold.reorderPoint) });
      }
      if (position.earliestExpiry) {
        const days = Math.floor((Date.parse(day) - Date.parse(position.earliestExpiry)) / 86_400_000);
        const warn = threshold.expiryWarnDays ?? warnDays;
        if (days <= Number(warn)) {
          alerts.push({ type: 'EXPIRY_ALERT', productId: position.productId, warehouseId: position.warehouseId, expiryDate: position.earliestExpiry, daysRemaining: days, threshold: Number(warn) });
        }
      }
    }
    if (Number(position.quantity) < 0) {
      alerts.push({ type: 'NEGATIVE_BALANCE_ANOMALY', productId: position.productId, warehouseId: position.warehouseId, availableQuantity: available, threshold: 0 });
    }
  }
  // The negative-balance anomaly is also surfaced on its own, so the callers
  // that read `negativeBalance` keep working while the alert list becomes the
  // single canonical surface.
  const negativeBalance = positions
    .filter((position) => Number(position.quantity) < 0)
    .map((position) => ({ ...position, quantity: Number(position.quantity) }));
  return { alerts, thresholdCount: thresholds.length, negativeBalance, asOf: day };
}

export function legacyInventoryAlerts(db) {
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