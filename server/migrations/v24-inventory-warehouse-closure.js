// V24 Inventory & Warehouse Domain Closure — schema for the capabilities whose
// modules created their own tables at request time.
//
// The barcode foundation, the packing / container core, the lot adjustment and
// the form conversion each shipped with an `ensureTable()` helper that created
// its table on first use. That made the tables invisible to the canonical
// schema: they were absent from the migration set, absent from the MySQL
// snapshot and absent from every schema-parity and offline fixture. This
// migration lifts them into the migration set, where they belong, and adds the
// parameterized alert thresholds that Design §27.34 names.
//
// The `ensureTable()` helpers stay: they are idempotent and become no-ops.
//
// All statements are idempotent. The MySQL backend derives its schema from a
// live SQLite snapshot (server/database/mysql-schema.js), so a table created
// here reaches MySQL through that snapshot rather than through an in-place
// ALTER.

export function migrateV24InventoryWarehouseClosure(db) {
  db.exec(`
    -- INV-39 · bounded barcode foundation
    CREATE TABLE IF NOT EXISTS inventory_barcode_rules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_barcode_bindings (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES inventory_barcode_rules(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      UNIQUE(rule_id, entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_barcode_resolution_log (
      id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      resolution_json TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      resolved_by TEXT,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_barcode_bindings_barcode ON inventory_barcode_bindings(barcode);
    CREATE INDEX IF NOT EXISTS idx_inventory_barcode_resolution_log_resolved ON inventory_barcode_resolution_log(resolved_at);

    -- INV-44 · bounded packing / container core
    CREATE TABLE IF NOT EXISTS inventory_containers (
      id TEXT PRIMARY KEY,
      container_no TEXT NOT NULL UNIQUE,
      container_type TEXT NOT NULL,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SEALED','DISPATCHED','DESTROYED')),
      parent_container_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      FOREIGN KEY (parent_container_id) REFERENCES inventory_containers(id)
    );
    CREATE TABLE IF NOT EXISTS inventory_container_items (
      id TEXT PRIMARY KEY,
      container_id TEXT NOT NULL REFERENCES inventory_containers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      lot_id TEXT,
      serial_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      bin_id TEXT,
      position_key TEXT,
      FOREIGN KEY (lot_id) REFERENCES inventory_lots(id),
      FOREIGN KEY (serial_id) REFERENCES inventory_serials(id)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_container_items_container ON inventory_container_items(container_id);

    -- INV-18 · lot adjustment (split / merge / reclass)
    CREATE TABLE IF NOT EXISTS inventory_lot_adjustments (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('SPLIT','MERGE','RECLASS')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      source_lot_id TEXT,
      source_lot_code TEXT,
      target_lot_id TEXT,
      target_lot_code TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );

    -- INV-20 · inventory form / attribute conversion
    CREATE TABLE IF NOT EXISTS inventory_form_conversions (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      from_form TEXT NOT NULL,
      to_form TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      business_date TEXT NOT NULL,
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );

    -- INV-37 · parameterized alert thresholds (Design §27.34)
    CREATE TABLE IF NOT EXISTS inventory_alert_thresholds (
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      min_stock REAL,
      max_stock REAL,
      safety_stock REAL,
      reorder_point REAL,
      expiry_warn_days INTEGER NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (product_id, warehouse_id)
    );
  `);
}
