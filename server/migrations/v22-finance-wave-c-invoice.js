// V22 — Finance Operations Wave C migration.
//
// New canonical finance tables (Wave C primary capabilities FO31):
//   - finance_invoice_source_links   (FO31 invoice source cardinality)
//
// Additive columns on existing invoice tables (FO33 / FO34):
//   - sales_invoices / supplier_bills: credit_state, credited_amount_cents,
//     remaining_creditable_amount_cents
//
// All migrations are additive / idempotent / SQLite + MySQL parity.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV22FinanceWaveCInvoice(db) {
  // -----------------------------------------------------------------
  // FO31 — invoice source cardinality (finance_invoice_source_links)
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_invoice_source_links (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      invoice_side TEXT NOT NULL CHECK(invoice_side IN ('SALES_INVOICE','SUPPLIER_BILL')),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_line_id TEXT,
      invoiced_quantity INTEGER NOT NULL DEFAULT 0,
      invoiced_amount_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(invoice_id, invoice_side, source_type, source_id, source_line_id)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_invoice_source_links_invoice
      ON finance_invoice_source_links(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_finance_invoice_source_links_source
      ON finance_invoice_source_links(source_type, source_id);
  `);

  // -----------------------------------------------------------------
  // FO33 / FO34 — credit_state + credited_amount_cents on sales_invoices / supplier_bills
  // -----------------------------------------------------------------
  for (const table of ['sales_invoices', 'supplier_bills']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN credit_state TEXT NOT NULL DEFAULT 'NONE' CHECK(credit_state IN ('NONE','PARTIAL','FULL'))`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN credited_amount_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN remaining_creditable_amount_cents INTEGER NOT NULL DEFAULT 0`);
  }
}
