// v13-phase7c-performance.js
//
// Phase 7C performance indexes. Justified directly by the EXPLAIN
// evidence captured by scripts/mysql-phase7c-slow-query-diagnostics.mjs
// against the populated disposable Phase 7C dataset. No speculative
// indexes — each index here corresponds to a measured production
// query-plan finding.
//
// 1. inventory_transactions(warehouse_id, product_id, created_at)
//
//    Supports the per-row correlated subquery in
//    server/app.js:1768-1770 listInventory():
//
//      (SELECT MAX(t.created_at) FROM inventory_transactions t
//       WHERE t.warehouse_id=i.warehouse_id
//         AND t.product_id=i.product_id)
//
//    Column order is the canonical equality-columns-first, then
//    aggregation-column pattern. With (warehouse_id, product_id)
//    both equality filters, MySQL can seek directly to the matching
//    range; created_at as the trailing index column means MySQL
//    reads MAX(created_at) without a separate filesort.
//
// 2. inventory_transactions(created_at)
//
//    Supports listInventoryTransactions (server/app.js:4105):
//
//      SELECT ... FROM inventory_transactions t ...
//      ORDER BY t.created_at DESC LIMIT 200
//      [optional sargable created_at >= ? / < ? filter]
//
//    Lets MySQL traverse the index in reverse and stop at 200 rows, and
//    supports the date-range path without applying a function to the column.
//
// 3. inventory_transactions(warehouse_id, created_at) and
//    inventory_transactions(product_id, created_at)
//
//    These are the two independent equality filters exposed by the real UI.
//    Each keeps created_at adjacent to its equality key, allowing MySQL to
//    read the newest 200 matching rows without sorting a large warehouse or
//    product range. The existing (warehouse_id, product_id, created_at) index
//    remains necessary for the inventory MAX(created_at) lookup and handles
//    the combined warehouse+product filter. No indexes are added for the
//    low-cardinality direction filter or leading-wildcard search.
//
// 4. sales_order_items(order_id)
//
//    Supports the per-row correlated count subquery in orderRows()
//    (server/app.js:1318-1330 listOrders()):
//
//      (SELECT count(*) FROM sales_order_items i WHERE i.order_id=so.id)
//
//    Without this index the subquery drives a 35K × 90K index-less
//    scan and is the dominant cost of the /api/orders 60-second
//    timeout. sales_deliveries.sales_order_id is already indexed
//    by settlement-core.js:36 so no new index is needed there.
//
// Every statement is CREATE INDEX IF NOT EXISTS, so this migration is
// safely re-runnable and idempotent on existing Phase 7C disposable
// databases.

export function migrateV13Phase7cPerformance(db) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_txn_wh_pr_created ON inventory_transactions(warehouse_id, product_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_txn_created      ON inventory_transactions(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_txn_wh_created   ON inventory_transactions(warehouse_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_txn_pr_created   ON inventory_transactions(product_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_soi_order            ON sales_order_items(order_id)');
}
