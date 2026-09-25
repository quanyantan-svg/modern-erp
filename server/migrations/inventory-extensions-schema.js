// M13 — Inventory Extensions.
//
// Two new feature families layered on top of the existing canonical
// inventory ledger (`inventory` + `inventory_transactions`):
//
//   1. Inventory Scrap (`inventory_scraps` + `inventory_scrap_items`)
//      - Operational stock destruction document.
//      - DRAFT -> CONFIRMED, with CANCELLED reachable only from DRAFT.
//      - CONFIRMED is terminal and immutable: a single confirm path
//        decreases inventory and writes exactly one canonical
//        inventory_transactions row (direction=OUT,
//        source_type='INVENTORY_SCRAP', source_id=scrap_id). The same
//        scrap header cannot be confirmed twice (409).
//      - Idempotent on repeated confirm requests.
//
//   2. Inventory Month-End (`inventory_period_closures` +
//      `inventory_period_snapshots`)
//      - Records an inventory period closing state.
//      - Closing is a control operation only: it does NOT mutate
//        `inventory` or write `inventory_transactions`; it writes a
//        read-only snapshot derived from the canonical ledger.
//      - Snapshot reconstruction: closing_quantity at period_end =
//        current_inventory.quantity − net canonical inventory
//        movements strictly AFTER period_end, applied per
//        (warehouse, product). period_in/period_out are derived from
//        inventory_transactions whose created_at falls inside the
//        period.
//      - Forward chronological close: after the first closure exists,
//        new closes must be strictly later than the latest CLOSED
//        period's period_key.
//      - REOPEN allowed only on the latest CLOSED period; opening an
//        older period underneath a newer one is rejected (409).
//      - Reclose rebuilds the snapshot for that exact period in a
//        single transaction; no duplicate snapshot rows accumulate.
//
// All new tables are append-only by convention. SCRAP does not enter
// the M3 Approval Center; MONTH-END does not enter Approval Center
// and is intentionally distinct from the accounting `period_closures`
// table.

import { randomBytes } from 'node:crypto';

const newId = () => `id-${randomBytes(8).toString('hex')}`;

export function migrateInventoryExtensionsSchema(db) {
  // ---------- Inventory Scrap ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_scraps (
      id TEXT PRIMARY KEY,
      scrap_no TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      scrap_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      confirmed_by TEXT,
      cancelled_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id),
      FOREIGN KEY (cancelled_by) REFERENCES users(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_scraps_status
      ON inventory_scraps(status);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_scraps_date
      ON inventory_scraps(scrap_date);
  `);

  // Multi-warehouse document support: each scrap line carries its own
  // warehouse_id so that one document can combine scrap across
  // warehouses, matching existing inventory document conventions.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_scrap_items (
      id TEXT PRIMARY KEY,
      scrap_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      reason TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL,
      FOREIGN KEY (scrap_id) REFERENCES inventory_scraps(id) ON DELETE CASCADE,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_scrap_items_scrap
      ON inventory_scrap_items(scrap_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_scrap_items_wh
      ON inventory_scrap_items(warehouse_id, product_id);
  `);

  // ---------- Inventory Period Closures ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_period_closures (
      id TEXT PRIMARY KEY,
      period_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CLOSED'
        CHECK(status IN ('CLOSED','REOPENED')),
      closed_by TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      reopened_by TEXT,
      reopened_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (closed_by) REFERENCES users(id),
      FOREIGN KEY (reopened_by) REFERENCES users(id)
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_period_closures_period
      ON inventory_period_closures(period_key);
  `);

  // Per-warehouse-per-product closing snapshot. One row per
  // (closure_id, warehouse_id, product_id) — never duplicated because
  // each re-close rebuilds the snapshot set inside one transaction.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_period_snapshots (
      id TEXT PRIMARY KEY,
      closure_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      closing_quantity REAL NOT NULL,
      period_in_quantity REAL NOT NULL,
      period_out_quantity REAL NOT NULL,
      FOREIGN KEY (closure_id) REFERENCES inventory_period_closures(id) ON DELETE CASCADE,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_period_snapshots_closure_wh_product
      ON inventory_period_snapshots(closure_id, warehouse_id, product_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_period_snapshots_closure
      ON inventory_period_snapshots(closure_id);
  `);
}

export function makeInventoryExtensionId() {
  return newId();
}
