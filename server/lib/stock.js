import { id } from '../db.js';

// Shared canonical inventory mutator.
//
// Inventory period-close (./modules/inventory-period-close.js) and the
// production / scrap / OQC / transfer flows must mutate the canonical
// `inventory` table through this single upsert. The previous code paths
// re-declared the helper locally (server/app.js, server/modules/
// inventory-extensions.js, server/modules/production-workflow.js) which
// duplicated the SQL three times. This module is the unique shared primitive.
//
// Behaviour:
//   - Insert a new (warehouse_id, product_id) row if missing.
//   - Otherwise add `quantityChange` to the existing quantity atomically
//     via ON CONFLICT, so concurrent mutations cannot lose updates.
//   - Returns the new balance for the row.
//
// Returns the balance as a JS Number, matching the original inline
// implementations so callers' comparisons (>= currentQuantity) are
// unaffected.
export function adjustInventory(db, warehouseId, productId, quantityChange, now) {
  db.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET
      quantity = inventory.quantity + excluded.quantity,
      updated_at = excluded.updated_at
  `).run(id(), warehouseId, productId, quantityChange, now);
  return Number(db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId).quantity);
}
