// M14 — Sales Discount + Purchase Discount schema migration.
//
// Two new feature families layered on top of the existing canonical
// AR/AP subledgers (account_receivables / account_payables):
//
//   1. Sales Discount (`sales_discounts`)
//      - Operational finance adjustment document. DRAFT -> CONFIRMED
//        or CANCELLED. CONFIRMED is terminal.
//      - Source: must reference an authoritative POSITIVE receivable
//        row belonging to the same customer. The discount is the
//        source-side cap for further economic reductions on that AR.
//      - On confirm: creates exactly one negative AR adjustment row
//        (via ensureSubledger with effectCents = -amount_cents), and
//        a canonical reversal voucher.
//
//   2. Purchase Discount (`purchase_discounts`)
//      - Symmetric for suppliers and account_payables.
//
// All new tables are append-only by convention. Discounts do not enter
// the M3 Approval Center. Discounts do not enter the inventory ledger.
// M14 modifies settlement safety: customer-level / supplier-level net
// balance gates now reject over-collection / over-payment when a
// discount creates a credit. The migration is non-destructive and
// idempotent.

export function migrateDiscountsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_discounts (
      id TEXT PRIMARY KEY,
      discount_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      source_receivable_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      confirmed_by TEXT,
      cancelled_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (source_receivable_id) REFERENCES account_receivables(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id),
      FOREIGN KEY (cancelled_by) REFERENCES users(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_discounts_customer ON sales_discounts(customer_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_discounts_source ON sales_discounts(source_receivable_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_discounts_status ON sales_discounts(status);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_discounts (
      id TEXT PRIMARY KEY,
      discount_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      source_payable_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      confirmed_by TEXT,
      cancelled_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (source_payable_id) REFERENCES account_payables(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id),
      FOREIGN KEY (cancelled_by) REFERENCES users(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_discounts_supplier ON purchase_discounts(supplier_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_discounts_source ON purchase_discounts(source_payable_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_discounts_status ON purchase_discounts(status);`);
}