// PRC-17 Prepayment Requirement — additive schema migration.
//
// Requirement §31.3.1 PRC-17 / Active Design §26.9.
//
// Ownership boundary encoded by this schema:
//   * Procurement owns the Prepayment Requirement document and its lines
//     (`prepayment_requirements` / `prepayment_requirement_items`).
//   * Finance owns the actual Payment / Allocation. No payment table is
//     created here: the canonical `payment_disbursements` +
//     `payment_disbursement_items` tables remain the only payment engine.
//
// The handoff reference `finance_handoff_id` points at the canonical Finance
// settlement document created through `server/modules/settlement.js` when the
// requirement is posted. `source_type='PREPAYMENT_REQUIREMENT'` is carried by
// the canonical Finance subledger row (`account_payables.source_type`),
// never by a Procurement-owned payment table.

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

export function migrateProcurementPrepaymentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prepayment_requirements (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      requirement_no TEXT NOT NULL UNIQUE,
      prepayment_pct_basis_numerator INTEGER NOT NULL CHECK(prepayment_pct_basis_numerator > 0),
      prepayment_pct_basis_denominator INTEGER NOT NULL CHECK(prepayment_pct_basis_denominator > 0),
      due_date TEXT NOT NULL,
      expected_payment_cents INTEGER NOT NULL CHECK(expected_payment_cents > 0),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
      finance_handoff_id TEXT,
      finance_payment_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'PREPAYMENT_REQUIREMENT',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      posted_by TEXT,
      posted_at TEXT,
      cancelled_by TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_prepayment_requirements_po
      ON prepayment_requirements(po_id, sequence_no);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prepayment_requirements_po_sequence
      ON prepayment_requirements(po_id, sequence_no);

    CREATE TABLE IF NOT EXISTS prepayment_requirement_items (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      order_item_id TEXT,
      product_id TEXT NOT NULL,
      quantity_num INTEGER NOT NULL CHECK(quantity_num > 0),
      quantity_den INTEGER NOT NULL CHECK(quantity_den > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
      expected_payment_cents INTEGER NOT NULL CHECK(expected_payment_cents > 0),
      due_date TEXT NOT NULL,
      FOREIGN KEY (requirement_id) REFERENCES prepayment_requirements(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_prepayment_requirement_items_requirement
      ON prepayment_requirement_items(requirement_id, line_no);
  `);

  // Additive hardening for databases created before this migration existed.
  // `requirement_no` is deliberately NOT backfilled here: it carries a UNIQUE
  // constraint and a DEFAULT '' would collide on the second row of an already
  // populated table. The column only ever appears together with the table.
  safeAddColumn(db, 'prepayment_requirements', 'finance_payment_id', 'finance_payment_id TEXT');
  safeAddColumn(db, 'prepayment_requirements', 'source_type', "source_type TEXT NOT NULL DEFAULT 'PREPAYMENT_REQUIREMENT'");
  safeAddColumn(db, 'prepayment_requirements', 'posted_by', 'posted_by TEXT');
  safeAddColumn(db, 'prepayment_requirements', 'posted_at', 'posted_at TEXT');
  safeAddColumn(db, 'prepayment_requirements', 'cancelled_by', 'cancelled_by TEXT');
  safeAddColumn(db, 'prepayment_requirements', 'cancelled_at', 'cancelled_at TEXT');
}
