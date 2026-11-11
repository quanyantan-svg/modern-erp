// Procurement Sourcing — additive schema for PRC-02 / PRC-04 / PRC-12 / PRC-16 / OUT-02.
//
// This file is a **coherent additive** migration: every operation is repeatable
// on SQLite and through the canonical MySQL adapter, and every statement only
// adds structure. It never drops a table, never rewrites a historical row and
// never infers a historical business fact.
//
// Contract sources:
//   - PRC-02 (supplier profile drives documents): the resolved payment terms
//     and the supplier category are frozen onto the purchase order as
//     *snapshots*, so a later profile change never rewrites history.
//   - PRC-04 (source list override): an override is a dated, reasoned,
//     audited grant — never a permanent bypass.
//   - PRC-12 (PR split / merge / supplier allocation): the conversion fact
//     table is append-only; it is the canonical record of "which requisition
//     line went to which purchase order line of which supplier, for how much".
//   - PRC-16 (delivery schedule lower tolerance): the close decision is a fact
//     with its own row, so the tolerated short-delivery difference is
//     recorded once and can be read back.

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function safeAddColumn(db, table, column, ddl) {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

export function migrateProcurementSourcingSchema(db) {
  db.exec(`
    -- ---------------------------------------------------------------------
    -- PRC-04 — source list override.
    --
    -- An override grants a supplier a source on a **bounded** date window.
    -- It never flips source_list_entries.enabled and never writes back the
    -- source list itself: the override is a separate, dated, reasoned and
    -- audited fact that the source-control resolver consults.
    -- ---------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS source_list_overrides (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(source_type IN ('PURCHASE','OUTSOURCE')),
      CHECK(status IN ('ACTIVE','EXPIRED','REVOKED')),
      CHECK(effective_to >= effective_from)
    );
    CREATE INDEX IF NOT EXISTS idx_source_list_overrides_resolution
      ON source_list_overrides(supplier_id, product_id, source_type, status, effective_from, effective_to);

    -- ---------------------------------------------------------------------
    -- PRC-12 — canonical PR conversion allocation fact.
    --
    -- Append-only. One row per (requisition line → purchase order line →
    -- supplier) allocation produced by the requisition-to-purchase-order
    -- conversion. The row carries the exact allocated quantity as a rational
    -- pair, so the conversion is reproducible without re-reading the mutable
    -- purchase order line.
    -- ---------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS pr_conversion_allocations (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL,
      requisition_item_id TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL,
      purchase_order_item_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      allocated_quantity_num INTEGER NOT NULL,
      allocated_quantity_den INTEGER NOT NULL,
      requisition_quantity_num INTEGER NOT NULL,
      requisition_quantity_den INTEGER NOT NULL,
      business_date TEXT NOT NULL,
      conversion_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id),
      FOREIGN KEY (requisition_item_id) REFERENCES purchase_requisition_items(id),
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(allocated_quantity_num > 0),
      CHECK(allocated_quantity_den > 0),
      CHECK(requisition_quantity_num > 0),
      CHECK(requisition_quantity_den > 0),
      UNIQUE(requisition_item_id, purchase_order_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_conversion_allocations_requisition
      ON pr_conversion_allocations(requisition_id, requisition_item_id, id);
    CREATE INDEX IF NOT EXISTS idx_pr_conversion_allocations_order
      ON pr_conversion_allocations(purchase_order_id, purchase_order_item_id);
  `);

  // -----------------------------------------------------------------------
  // PRC-02 — the resolved supplier-profile defaults are frozen onto the
  // purchase order. The columns are nullable: a historical order keeps
  // NULL and the reader falls back to the stored value; nothing is backfilled.
  // -----------------------------------------------------------------------
  safeAddColumn(db, 'purchase_orders', 'payment_terms_days_source', "payment_terms_days_source TEXT NOT NULL DEFAULT 'SUPPLIER_DEFAULT'");
  safeAddColumn(db, 'purchase_orders', 'supplier_category_snapshot', "supplier_category_snapshot TEXT");

  // -----------------------------------------------------------------------
  // PRC-16 — the delivery schedule close decision.
  //
  // `status` is a plain state column on the schedule itself (the schedule is
  // the business fact being closed); the close decisions table is the
  // immutable audit of *why* it was closed and how much short delivery was
  // tolerated.
  // -----------------------------------------------------------------------
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'status', "status TEXT NOT NULL DEFAULT 'OPEN'");
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'closed_at', 'closed_at TEXT');
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'closed_by', 'closed_by TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS po_delivery_schedule_closes (
      id TEXT PRIMARY KEY,
      delivery_schedule_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      planned_quantity REAL NOT NULL,
      received_quantity REAL NOT NULL,
      tolerated_short_quantity REAL NOT NULL,
      lower_tolerance_pct REAL NOT NULL,
      close_reason TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (delivery_schedule_id) REFERENCES purchase_order_delivery_schedules(id),
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(triggered_by IN ('EXPLICIT','RECEIPT_CONFIRM')),
      CHECK(tolerated_short_quantity >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_po_delivery_schedule_closes_schedule
      ON po_delivery_schedule_closes(delivery_schedule_id, created_at);
  `);
}
