function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV13Phase4ProductionIntegrity(db) {
  addColumn(db, "ALTER TABLE production_orders ADD COLUMN source_type TEXT NOT NULL DEFAULT 'MANUAL'");
  addColumn(db, 'ALTER TABLE production_orders ADD COLUMN production_instruction_id TEXT');
  addColumn(db, 'ALTER TABLE production_orders ADD COLUMN production_instruction_item_id TEXT');
  addColumn(db, "ALTER TABLE production_orders ADD COLUMN bom_version_snapshot TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'ALTER TABLE production_orders ADD COLUMN routing_id_snapshot TEXT');
  addColumn(db, "ALTER TABLE production_orders ADD COLUMN routing_version_snapshot TEXT NOT NULL DEFAULT ''");

  addColumn(db, 'ALTER TABLE production_order_items ADD COLUMN bom_item_id TEXT');
  addColumn(db, 'ALTER TABLE production_order_items ADD COLUMN quantity_per_unit REAL');
  addColumn(db, 'ALTER TABLE production_order_items ADD COLUMN scrap_rate_snapshot REAL NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_material_issue_items ADD COLUMN requirement_line_id TEXT');
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN product_id TEXT');
  addColumn(db, 'ALTER TABLE inventory_transactions ADD COLUMN source_line_id TEXT');

  // The former M12 unique index made partial instruction conversion impossible.
  db.exec('DROP INDEX IF EXISTS idx_production_instruction_items_production_order');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_po_instruction ON production_orders(production_instruction_id);
    CREATE INDEX IF NOT EXISTS idx_po_instruction_item ON production_orders(production_instruction_item_id);
    CREATE INDEX IF NOT EXISTS idx_poi_order_product ON production_order_items(order_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_pmii_requirement ON production_material_issue_items(requirement_line_id);

    CREATE TABLE IF NOT EXISTS production_order_routing_snapshots (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      routing_id TEXT,
      sequence_no INTEGER NOT NULL,
      operation_code TEXT NOT NULL DEFAULT '',
      operation_name TEXT NOT NULL,
      work_center TEXT NOT NULL DEFAULT '',
      setup_minutes REAL NOT NULL DEFAULT 0,
      run_minutes_per_unit REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(production_order_id, sequence_no),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (routing_id) REFERENCES product_routings(id)
    );

    CREATE TABLE IF NOT EXISTS production_material_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT NOT NULL UNIQUE,
      original_issue_id TEXT NOT NULL,
      production_order_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      return_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      FOREIGN KEY (original_issue_id) REFERENCES production_material_issues(id),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS production_material_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      original_issue_item_id TEXT NOT NULL,
      requirement_line_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      before_quantity REAL,
      after_quantity REAL,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (return_id) REFERENCES production_material_returns(id) ON DELETE CASCADE,
      FOREIGN KEY (original_issue_item_id) REFERENCES production_material_issue_items(id),
      FOREIGN KEY (requirement_line_id) REFERENCES production_order_items(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pmr_order ON production_material_returns(production_order_id);
    CREATE INDEX IF NOT EXISTS idx_pmri_issue_item ON production_material_return_items(original_issue_item_id);

    CREATE TABLE IF NOT EXISTS production_receipt_reversals (
      id TEXT PRIMARY KEY,
      reversal_no TEXT NOT NULL UNIQUE,
      original_receipt_id TEXT NOT NULL,
      production_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      reversal_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      before_quantity REAL,
      after_quantity REAL,
      FOREIGN KEY (original_receipt_id) REFERENCES production_receipts(id),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_prr_order ON production_receipt_reversals(production_order_id);
    CREATE INDEX IF NOT EXISTS idx_prr_receipt ON production_receipt_reversals(original_receipt_id);
  `);

  // Existing order items already are snapshots. Fill the new basis only when
  // it can be reconstructed exactly from the order's captured total.
  db.exec(`
    UPDATE production_order_items
       SET quantity_per_unit = quantity / (SELECT quantity FROM production_orders WHERE id=order_id)
     WHERE quantity_per_unit IS NULL
       AND (SELECT quantity FROM production_orders WHERE id=order_id) > 0;
    UPDATE production_orders
       SET bom_version_snapshot = COALESCE((SELECT version FROM boms WHERE id=production_orders.bom_id), '')
     WHERE bom_version_snapshot='';
    UPDATE production_receipts
       SET product_id=(SELECT product_id FROM production_orders WHERE id=production_receipts.production_order_id)
     WHERE product_id IS NULL;
  `);
}
