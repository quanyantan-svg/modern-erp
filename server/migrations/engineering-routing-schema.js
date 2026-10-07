// V17 Master & Engineering Domain Closure — Wave D: Routing Enrichment
// + Topology.
//
// Additive migration only. Existing tables and columns are not touched.
// New topology links table for parallel / split / merge / alternate
// sequence metadata on top of the canonical product_routings /
// product_routing_operations tables. Existing legacy `routing_operations`
// table is preserved.

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

export function migrateEngineeringRoutingSchema(db) {
  if (tableExists(db, 'product_routings')) {
    safeAddColumn(db, 'product_routings', 'topology_type', "topology_type TEXT NOT NULL DEFAULT 'LINEAR' CHECK(topology_type IN ('LINEAR','NETWORK'))");
  }
  if (tableExists(db, 'product_routing_operations')) {
    safeAddColumn(db, 'product_routing_operations', 'operation_id', 'operation_id TEXT');
    safeAddColumn(db, 'product_routing_operations', 'control_code_id', 'control_code_id TEXT');
    safeAddColumn(db, 'product_routing_operations', 'activity_id', 'activity_id TEXT');
    safeAddColumn(db, 'product_routing_operations', 'resource_id', 'resource_id TEXT');
    safeAddColumn(db, 'product_routing_operations', 'equipment_id', 'equipment_id TEXT');
    safeAddColumn(db, 'product_routing_operations', 'is_outsource', 'is_outsource INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'product_routing_operations', 'quality_policy', 'quality_policy TEXT NOT NULL DEFAULT ""');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_routing_operation_links (
      id TEXT PRIMARY KEY,
      routing_id TEXT NOT NULL,
      parent_operation_id TEXT NOT NULL,
      child_operation_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'PARALLEL' CHECK(link_type IN ('PARALLEL','SPLIT','MERGE','ALTERNATE')),
      sequence_no INTEGER NOT NULL DEFAULT 1 CHECK(sequence_no > 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (routing_id) REFERENCES product_routings(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_operation_id) REFERENCES product_routing_operations(id) ON DELETE CASCADE,
      FOREIGN KEY (child_operation_id) REFERENCES product_routing_operations(id) ON DELETE CASCADE,
      UNIQUE (routing_id, parent_operation_id, child_operation_id, link_type)
    );

    CREATE INDEX IF NOT EXISTS idx_product_routing_operation_links_routing
      ON product_routing_operation_links(routing_id);
  `);
}