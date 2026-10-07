// V17 Master & Engineering Domain Closure — Wave E: ECO schema.
//
// New tables:
//   engineering_change_orders
//   engineering_change_items
//
// All additive. Existing tables untouched. Historical production snapshots
// remain immutable (we never mutate production_orders.bom_id or
// production_order_routing_snapshots from an ECO apply).

function columnExists(db, table, column) {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  return pragma.some((row) => row.name === column);
}

function safeAddColumn(db, table, column, ddl) {
  if (columnExists(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function migrateEngineeringChangeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engineering_change_orders (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      change_type TEXT NOT NULL DEFAULT 'IMMEDIATE' CHECK(change_type IN ('IMMEDIATE','EFFECTIVE_DATE','USE_UP_OLD')),
      effective_date TEXT,
      version_upgrade INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','WITHDRAWN','APPLIED','CANCELLED')),
      target_bom_id TEXT,
      creator_id TEXT NOT NULL,
      approver_id TEXT,
      approved_at TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (target_bom_id) REFERENCES boms(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_change_items (
      id TEXT PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      op_type TEXT NOT NULL CHECK(op_type IN ('ADD_COMPONENT','MODIFY_COMPONENT','DELETE_COMPONENT','INVALIDATE_COMPONENT','MODIFY_HEADER')),
      product_id TEXT,
      quantity REAL,
      scrap_rate REAL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      from_product_id TEXT,
      to_product_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (change_order_id) REFERENCES engineering_change_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (from_product_id) REFERENCES products(id),
      FOREIGN KEY (to_product_id) REFERENCES products(id),
      UNIQUE (change_order_id, line_no)
    );

    CREATE INDEX IF NOT EXISTS idx_engineering_change_orders_status
      ON engineering_change_orders(status);
    CREATE INDEX IF NOT EXISTS idx_engineering_change_items_change
      ON engineering_change_items(change_order_id);
  `);

  // Link BOMs back to the ECO that produced them when applicable.
  if (tableExists(db, 'boms')) {
    safeAddColumn(db, 'boms', 'eco_change_id', 'eco_change_id TEXT');
  }
  if (tableExists(db, 'bom_items')) {
    safeAddColumn(db, 'bom_items', 'eco_change_id', 'eco_change_id TEXT');
  }
}