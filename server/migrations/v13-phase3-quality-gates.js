// V1.3 Phase 3 — authoritative IQC/OQC source links and immutable snapshots.
//
// Columns are nullable for legacy V1.2 rows. New writes are required by the
// API to populate the authoritative columns. SQLite supports an additive
// nullable REFERENCES column, which lets us preserve legacy history without
// fabricating source identifiers or rebuilding the tables.

export function migrateV13Phase3QualityGates(db) {
  const addColumn = (sql) => {
    try { db.exec(sql); } catch (_) { /* idempotent: column already exists */ }
  };

  addColumn('ALTER TABLE iqc_inspections ADD COLUMN purchase_receipt_id TEXT REFERENCES purchase_receipts(id)');
  addColumn("ALTER TABLE iqc_inspections ADD COLUMN inspection_date TEXT");
  addColumn("ALTER TABLE iqc_inspections ADD COLUMN defect_reason TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE iqc_inspections ADD COLUMN disposition TEXT NOT NULL DEFAULT ''");
  addColumn('ALTER TABLE iqc_inspections ADD COLUMN cancelled_at TEXT');
  addColumn('ALTER TABLE iqc_inspection_items ADD COLUMN purchase_receipt_item_id TEXT REFERENCES purchase_receipt_items(id)');
  addColumn('ALTER TABLE iqc_inspection_items ADD COLUMN snapshot_warehouse_id TEXT');
  addColumn("ALTER TABLE iqc_inspection_items ADD COLUMN snapshot_batch_no TEXT NOT NULL DEFAULT ''");
  addColumn('ALTER TABLE iqc_inspection_items ADD COLUMN snapshot_quantity REAL');

  addColumn('ALTER TABLE oqc_inspections ADD COLUMN sales_delivery_id TEXT REFERENCES sales_deliveries(id)');
  addColumn("ALTER TABLE oqc_inspections ADD COLUMN inspection_date TEXT");
  addColumn("ALTER TABLE oqc_inspections ADD COLUMN defect_reason TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE oqc_inspections ADD COLUMN disposition TEXT NOT NULL DEFAULT ''");
  addColumn('ALTER TABLE oqc_inspections ADD COLUMN cancelled_at TEXT');
  addColumn('ALTER TABLE oqc_inspection_items ADD COLUMN sales_delivery_item_id TEXT REFERENCES sales_delivery_items(id)');
  addColumn('ALTER TABLE oqc_inspection_items ADD COLUMN snapshot_warehouse_id TEXT');
  addColumn("ALTER TABLE oqc_inspection_items ADD COLUMN snapshot_batch_no TEXT NOT NULL DEFAULT ''");
  addColumn('ALTER TABLE oqc_inspection_items ADD COLUMN snapshot_quantity REAL');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iqc_receipt ON iqc_inspections(purchase_receipt_id);
    CREATE INDEX IF NOT EXISTS idx_iqc_receipt_item ON iqc_inspection_items(purchase_receipt_item_id);
    CREATE INDEX IF NOT EXISTS idx_oqc_delivery ON oqc_inspections(sales_delivery_id);
    CREATE INDEX IF NOT EXISTS idx_oqc_delivery_item ON oqc_inspection_items(sales_delivery_item_id);
  `);
}
