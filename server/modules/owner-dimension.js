// V21 — Owner Dimension (Domain 5 Closure Wave A).
//
// Frozen by `solution.md §27.10 / §27.45` and `document.md §32.3.1 INV-05`.
//
// Owner ∈ {ENTERPRISE, SUPPLIER, CUSTOMER}; enterprise singleton uses
// owner_id = NULL. SUPPLIER / CUSTOMER reference their respective master.
// Polymorphic FK is enforced by application-level validation (see
// server/lib/inventory-position.js::validateOwner).
//
// This module is the read-only surface for owner dimension overview and
// is the seam that replaces `assertInventoryOwnerDimension()` in the
// Procurement & Outsourcing Domain (see solution.md §27.1 / §27.21).

import { allowAny, send } from '../lib/http.js';

export function listOwnerDimension(db, res, actor) {
  allowAny(actor, ['OWNER_DIMENSION_VIEW', 'INVENTORY_PARAMETERS_MANAGE']);
  // Aggregate by (owner_type, owner_id) — supports all 4 canonical combinations.
  const aggregates = db.prepare(`
    SELECT owner_type ownerType, owner_id ownerId,
           SUM(quantity) AS quantity,
           COUNT(*)      AS positionCount,
           COUNT(DISTINCT warehouse_id) AS warehouseCount,
           COUNT(DISTINCT product_id)   AS productCount
      FROM inventory
     WHERE active=1
     GROUP BY owner_type, owner_id
     ORDER BY owner_type, owner_id
  `).all().map((r) => ({
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    quantity: Number(r.quantity),
    positionCount: Number(r.positionCount),
    warehouseCount: Number(r.warehouseCount),
    productCount: Number(r.productCount),
  }));
  return send(res, 200, { ownerDimensions: aggregates });
}

export function listSupportedOwnerTypes() {
  return ['ENTERPRISE', 'SUPPLIER', 'CUSTOMER'];
}

export function ownerCombinationSupported(warehouseType, ownerType) {
  // warehouseType is one of 'enterprise' | 'supplier_wip' | 'entrusted'.
  if (warehouseType === 'enterprise' && ownerType === 'ENTERPRISE') return true;
  if (warehouseType === 'supplier_wip' && ownerType === 'ENTERPRISE') return true;
  if (warehouseType === 'enterprise' && ownerType === 'SUPPLIER') return true;
  if (warehouseType === 'enterprise' && ownerType === 'CUSTOMER') return true;
  return false;
}