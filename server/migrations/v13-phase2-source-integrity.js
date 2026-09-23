// V1.3 Phase 2 — authoritative commercial provenance for logistics.
//
// Source columns stay nullable so upgraded V1.2 rows remain readable. New
// writes are required and validated by the API. SQLite cannot safely add
// REFERENCES clauses to existing tables without rebuilding them, so header
// FKs remain those already present and the additive line references are
// application-enforced. The indexes support source lookup and cumulative
// confirmed-quantity calculations.

export function migrateV13Phase2SourceIntegrity(db) {
  const addColumn = (sql) => {
    try { db.exec(sql); } catch (_) { /* already present */ }
  };

  addColumn('ALTER TABLE purchase_orders ADD COLUMN purchase_requisition_id TEXT');
  addColumn('ALTER TABLE purchase_order_items ADD COLUMN purchase_requisition_item_id TEXT');
  addColumn('ALTER TABLE purchase_receipt_items ADD COLUMN purchase_order_item_id TEXT');
  addColumn('ALTER TABLE sales_delivery_items ADD COLUMN sales_order_item_id TEXT');
  addColumn('ALTER TABLE return_order_items ADD COLUMN delivery_item_id TEXT');
  addColumn('ALTER TABLE purchase_return_items ADD COLUMN receipt_item_id TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_requisition
      ON purchase_orders(purchase_requisition_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_order_items_requisition_item
      ON purchase_order_items(purchase_requisition_item_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_order
      ON purchase_receipts(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_order_item
      ON purchase_receipt_items(purchase_order_item_id);
    CREATE INDEX IF NOT EXISTS idx_sales_deliveries_order
      ON sales_deliveries(sales_order_id);
    CREATE INDEX IF NOT EXISTS idx_sales_delivery_items_order_item
      ON sales_delivery_items(sales_order_item_id);
    CREATE INDEX IF NOT EXISTS idx_return_orders_delivery
      ON return_orders(delivery_id);
    CREATE INDEX IF NOT EXISTS idx_return_order_items_delivery_item
      ON return_order_items(delivery_item_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_receipt
      ON purchase_returns(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_receipt_item
      ON purchase_return_items(receipt_item_id);
  `);
}
