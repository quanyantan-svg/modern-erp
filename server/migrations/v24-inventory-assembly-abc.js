// V24 — Inventory Assembly / Disassembly documents (INV-17).
//
// Frozen by `solution.md §27.27` (Domain 5 Closure Design):
//   - Engineering / BOM is the STRUCTURE source; Inventory owns the physical
//     consume / produce movement. This migration adds only the additive
//     DOCUMENT tables — it does not add a second BOM truth and it does not
//     touch the canonical `inventory` balance.
//   - Status lifecycle: DRAFT → CONFIRMED.
//   - The BOM snapshot (id / version / effective window) is persisted with the
//     document so a confirmed assembly remains auditable after the engineering
//     BOM is revised.
//
// All statements are idempotent. The `ensureTable()` helper in
// `server/modules/inventory-assembly-disassembly.js` performs the same DDL at
// call time and becomes a no-op once this migration has run.

export function migrateV24InventoryAssemblyAbc(db) {
  db.exec(`
    -- INV-17 · assembly / disassembly document (header)
    CREATE TABLE IF NOT EXISTS inventory_assembly_orders (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      order_type TEXT NOT NULL CHECK(order_type IN ('ASSEMBLY','DISASSEMBLY')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      production_order_id TEXT,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL CHECK(quantity > 0),
      business_date TEXT NOT NULL,
      bom_id TEXT,
      bom_version TEXT,
      bom_effective_from TEXT,
      remark TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_assembly_orders_type ON inventory_assembly_orders(order_type, status);
    CREATE INDEX IF NOT EXISTS idx_inventory_assembly_orders_production ON inventory_assembly_orders(production_order_id);

    -- INV-17 · assembly / disassembly document (component lines, BOM snapshot)
    CREATE TABLE IF NOT EXISTS inventory_assembly_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES inventory_assembly_orders(id),
      line_no INTEGER NOT NULL,
      component_product_id TEXT NOT NULL REFERENCES products(id),
      bom_quantity REAL NOT NULL,
      scrap_rate REAL NOT NULL DEFAULT 0,
      required_quantity REAL NOT NULL,
      consumed_quantity REAL NOT NULL DEFAULT 0,
      produced_quantity REAL NOT NULL DEFAULT 0,
      lot_id TEXT,
      serial_id TEXT,
      bin_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_assembly_order_items_order ON inventory_assembly_order_items(order_id);
  `);
}
