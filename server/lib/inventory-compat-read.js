// Inventory compatibility read adapter (Wave A — Domain 5 Closure).
//
// Frozen contract (solution.md §27.44):
//   All legacy `inventory(warehouse_id, product_id)` reads MUST aggregate
//   canonical positions instead of selecting one arbitrary row.
//   This adapter is the single read-side entry point.

export function aggregateInventoryByWarehouseProduct(db, { warehouseId, productId }) {
  const params = [];
  const where = ['active=1'];
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  if (productId)   { where.push('product_id=?');   params.push(productId); }
  const rows = db.prepare(`
    SELECT warehouse_id warehouseId, product_id productId,
           SUM(quantity)                                              AS totalQuantity,
           SUM(CASE WHEN stock_status='AVAILABLE' THEN quantity ELSE 0 END) AS availableQuantity,
           SUM(CASE WHEN owner_type='ENTERPRISE' THEN quantity ELSE 0 END)  AS enterpriseOwnedQuantity,
           SUM(CASE WHEN owner_type='SUPPLIER'   THEN quantity ELSE 0 END)  AS supplierOwnedQuantity,
           SUM(CASE WHEN owner_type='CUSTOMER'   THEN quantity ELSE 0 END)  AS customerOwnedQuantity,
           COUNT(*)                                                    AS positionCount
      FROM inventory
     WHERE ${where.join(' AND ')}
     GROUP BY warehouse_id, product_id
  `).all(...params);
  return rows.map((r) => ({
    warehouseId: r.warehouseId,
    productId: r.productId,
    totalQuantity: Number(r.totalQuantity),
    availableQuantity: Number(r.availableQuantity),
    enterpriseOwnedQuantity: Number(r.enterpriseOwnedQuantity),
    supplierOwnedQuantity: Number(r.supplierOwnedQuantity),
    customerOwnedQuantity: Number(r.customerOwnedQuantity),
    positionCount: Number(r.positionCount),
  }));
}

export function listCanonicalInventoryPositions(db, filters = {}) {
  const params = [];
  const where = ['1=1'];
  if (filters.warehouseId) { where.push('warehouse_id=?'); params.push(filters.warehouseId); }
  if (filters.productId)   { where.push('product_id=?');   params.push(filters.productId); }
  if (filters.binId)       { where.push('bin_id=?');       params.push(filters.binId); }
  if (filters.ownerType)   { where.push('owner_type=?');   params.push(String(filters.ownerType).toUpperCase()); }
  if (filters.ownerId)     { where.push('owner_id=?');     params.push(filters.ownerId); }
  if (filters.stockStatus) { where.push('stock_status=?'); params.push(String(filters.stockStatus).toUpperCase()); }
  if (filters.lotId)       { where.push('lot_id=?');       params.push(filters.lotId); }
  if (filters.serialId)    { where.push('serial_id=?');    params.push(filters.serialId); }
  if (filters.active === false) { where.push('active=0'); } else { where.push('active=1'); }
  return db.prepare(`
    SELECT id, position_key positionKey, warehouse_id warehouseId, product_id productId,
           bin_id binId, owner_type ownerType, owner_id ownerId,
           stock_status stockStatus, lot_id lotId, serial_id serialId,
           quantity, updated_at updatedAt
      FROM inventory
     WHERE ${where.join(' AND ')}
     ORDER BY position_key
  `).all(...params).map((r) => ({
    ...r,
    quantity: Number(r.quantity),
  }));
}