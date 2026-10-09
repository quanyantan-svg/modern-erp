// V21 — Inventory availability projection (Wave B).
//
// Frozen by `solution.md §27.13 / §27.14` (Domain 5 Closure Design).
//
// position-level + planning-level availability. Three reservation quantities
// from Planning frozen semantics: STRONG + WEAK + MANUAL.

export function computeAvailability(db, { productId, warehouseId, scope }) {
  // position-level
  const onHand = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM inventory
     WHERE product_id=? AND warehouse_id=? AND active=1
       AND stock_status='AVAILABLE'
       AND (stock_status='AVAILABLE')
  `).get(productId, warehouseId)?.q || 0);

  const activeLocked = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks
     WHERE product_id=? AND warehouse_id=? AND status='ACTIVE'
  `).get(productId, warehouseId)?.q || 0);

  const positionFreePhysical = Math.max(0, onHand - activeLocked);

  // Planning-level (read-only aggregate over planning_reservations)
  const activeReservedTotal = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM planning_reservations
     WHERE product_id=? AND warehouse_id=? AND status='ACTIVE'
       AND reservation_type IN ('STRONG','WEAK','MANUAL')
  `).get(productId, warehouseId)?.q || 0);

  const hardReserved = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM planning_reservations
     WHERE product_id=? AND warehouse_id=? AND status='ACTIVE'
       AND reservation_type IN ('STRONG','MANUAL')
  `).get(productId, warehouseId)?.q || 0);

  const softReserved = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) q FROM planning_reservations
     WHERE product_id=? AND warehouse_id=? AND status='ACTIVE'
       AND reservation_type='WEAK'
  `).get(productId, warehouseId)?.q || 0);

  return {
    eligibleOnHand: onHand,
    activeLocked,
    positionFreePhysical,
    activeReservedTotal,
    hardReserved,
    softReserved,
    availableForNewReservation: positionFreePhysical - activeReservedTotal,
    availableForUnrelatedExecution: positionFreePhysical - hardReserved,
  };
}