function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

// Phase 6E introduces distinct control accounts so the immutable Phase 0–6D
// registry keeps its separation of concerns.  Each Phase 6E role maps to a
// dedicated subject (no collisions with ACCOUNTS_PAYABLE / ACCOUNTS_RECEIVABLE
// / MATERIAL_PRICE_VARIANCE).  Legacy 6E-rc1 collisions (OUTPUT_TAX → 2202,
// INPUT_TAX → 1122, GRNI → 2202, PURCHASE_PRICE_VARIANCE → 6404) are
// deliberately re-routed here.
const SUBJECTS = [
  ['subject-018', '222101', '应交税费-应交增值税-销项税额', 'LIABILITY', 'CREDIT'],
  ['subject-019', '222102', '应交税费-应交增值税-进项税额', 'ASSET', 'DEBIT'],
  ['subject-020', '1407', '在途物资', 'ASSET', 'DEBIT'],
  ['subject-021', '6407', '采购价格差异-商业', 'EXPENSE', 'DEBIT'],
];
const ROLES = [
  ['OUTPUT_TAX_PAYABLE', '222101'],
  ['INPUT_TAX_RECEIVABLE', '222102'],
  ['GRNI', '1407'],
  ['PURCHASE_PRICE_VARIANCE', '6407'],
];

export function migrateV13Phase6ECommercialGoLive(db) {
  addColumn(db, "ALTER TABLE sales_deliveries ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'SEPARATE'");
  addColumn(db, "ALTER TABLE purchase_receipts ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'SEPARATE'");
  addColumn(db, "ALTER TABLE products ADD COLUMN base_uom_code TEXT NOT NULL DEFAULT 'EA'");
  addColumn(db, 'ALTER TABLE products ADD COLUMN purchase_uom_code TEXT');
  addColumn(db, 'ALTER TABLE products ADD COLUMN sales_uom_code TEXT');
  addColumn(db, 'ALTER TABLE bom_items ADD COLUMN uom_code_snapshot TEXT');
  addColumn(db, 'ALTER TABLE bom_items ADD COLUMN conversion_numerator INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'ALTER TABLE bom_items ADD COLUMN conversion_denominator INTEGER NOT NULL DEFAULT 1');
  for (const table of ['sales_order_items','purchase_order_items','sales_delivery_items', 'purchase_receipt_items']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN document_uom_code TEXT`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN document_quantity_num INTEGER`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN document_quantity_den INTEGER NOT NULL DEFAULT 1`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN conversion_numerator INTEGER NOT NULL DEFAULT 1`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN conversion_denominator INTEGER NOT NULL DEFAULT 1`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN base_quantity_num INTEGER`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN base_quantity_den INTEGER NOT NULL DEFAULT 1`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS uoms (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_uom_conversions (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), uom_code TEXT NOT NULL REFERENCES uoms(code),
      base_uom_code TEXT NOT NULL REFERENCES uoms(code), numerator INTEGER NOT NULL CHECK(numerator>0),
      denominator INTEGER NOT NULL CHECK(denominator>0), active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1, effective_from TEXT NOT NULL, effective_to TEXT,
      created_at TEXT NOT NULL, UNIQUE(product_id,uom_code,version)
    );
    CREATE TABLE IF NOT EXISTS tax_codes (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, rate_numerator INTEGER NOT NULL CHECK(rate_numerator>=0),
      rate_denominator INTEGER NOT NULL CHECK(rate_denominator>0), active INTEGER NOT NULL DEFAULT 1,
      effective_from TEXT NOT NULL, effective_to TEXT, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(code,version)
    );
    CREATE TABLE IF NOT EXISTS document_sequences (
      document_type TEXT NOT NULL, period_key TEXT NOT NULL, next_value INTEGER NOT NULL CHECK(next_value>0),
      PRIMARY KEY(document_type,period_key)
    );
    CREATE TABLE IF NOT EXISTS document_number_allocations (
      idempotency_key TEXT PRIMARY KEY, document_type TEXT NOT NULL, document_no TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales_invoices (
      id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','POSTED','REVERSED','CANCELLED')),
      tax_mode TEXT NOT NULL CHECK(tax_mode IN ('NO_TAX','EXCLUSIVE','INCLUSIVE')),
      net_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0, gross_cents INTEGER NOT NULL DEFAULT 0,
      tax_snapshot_json TEXT NOT NULL DEFAULT '[]', creator_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      posted_by TEXT, posted_at TEXT, reversal_of_id TEXT REFERENCES sales_invoices(id), idempotency_key TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS sales_invoice_items (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES sales_invoices(id), delivery_id TEXT NOT NULL REFERENCES sales_deliveries(id),
      delivery_item_id TEXT NOT NULL REFERENCES sales_delivery_items(id), product_id TEXT NOT NULL REFERENCES products(id),
      document_uom_code TEXT NOT NULL, document_quantity_num INTEGER NOT NULL, document_quantity_den INTEGER NOT NULL,
      conversion_numerator INTEGER NOT NULL, conversion_denominator INTEGER NOT NULL,
      base_quantity_num INTEGER NOT NULL, base_quantity_den INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL, net_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL,
      tax_code TEXT, tax_rate_numerator INTEGER NOT NULL DEFAULT 0, tax_rate_denominator INTEGER NOT NULL DEFAULT 1,
      line_no INTEGER NOT NULL, UNIQUE(invoice_id,delivery_item_id,line_no)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_invoice_delivery ON sales_invoice_items(delivery_item_id);
    CREATE TABLE IF NOT EXISTS supplier_bills (
      id TEXT PRIMARY KEY, bill_no TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), supplier_invoice_no TEXT NOT NULL,
      bill_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','WAITING_MATCH','POSTED','REVERSED','CANCELLED')),
      tax_mode TEXT NOT NULL CHECK(tax_mode IN ('NO_TAX','EXCLUSIVE','INCLUSIVE')),
      net_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0, gross_cents INTEGER NOT NULL DEFAULT 0,
      grni_cents INTEGER NOT NULL DEFAULT 0, variance_cents INTEGER NOT NULL DEFAULT 0, tax_snapshot_json TEXT NOT NULL DEFAULT '[]',
      creator_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, posted_by TEXT, posted_at TEXT,
      reversal_of_id TEXT REFERENCES supplier_bills(id), idempotency_key TEXT UNIQUE,
      UNIQUE(supplier_id,supplier_invoice_no)
    );
    CREATE TABLE IF NOT EXISTS supplier_bill_items (
      id TEXT PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES supplier_bills(id), receipt_id TEXT REFERENCES purchase_receipts(id),
      receipt_item_id TEXT REFERENCES purchase_receipt_items(id), purchase_order_item_id TEXT, product_id TEXT NOT NULL REFERENCES products(id),
      document_uom_code TEXT NOT NULL, document_quantity_num INTEGER NOT NULL, document_quantity_den INTEGER NOT NULL,
      conversion_numerator INTEGER NOT NULL, conversion_denominator INTEGER NOT NULL,
      base_quantity_num INTEGER NOT NULL, base_quantity_den INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL, matched_unit_price_cents INTEGER, net_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL, tax_code TEXT,
      tax_rate_numerator INTEGER NOT NULL DEFAULT 0, tax_rate_denominator INTEGER NOT NULL DEFAULT 1,
      line_no INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_bill_receipt ON supplier_bill_items(receipt_item_id);
    CREATE TABLE IF NOT EXISTS commercial_credit_notes (
      id TEXT PRIMARY KEY, credit_no TEXT NOT NULL UNIQUE, side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      source_type TEXT NOT NULL CHECK(source_type IN ('SALES_INVOICE','SUPPLIER_BILL')), source_id TEXT NOT NULL,
      party_id TEXT NOT NULL, credit_date TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','POSTED','REVERSED')),
      net_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL, tax_snapshot_json TEXT NOT NULL,
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL, posted_by TEXT, posted_at TEXT, idempotency_key TEXT UNIQUE,
      adjustment_type TEXT NOT NULL DEFAULT 'OTHER' CHECK(adjustment_type IN ('RETURN','DISCOUNT','OTHER'))
    );
    CREATE TABLE IF NOT EXISTS opening_batches (
      id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('DRAFT','VALIDATED','SUBMITTED','APPROVED','POSTED')),
      go_live_date TEXT NOT NULL, creator_id TEXT NOT NULL, submitted_by TEXT, approved_by TEXT, posted_by TEXT,
      validation_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opening_batch_lines (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES opening_batches(id), line_type TEXT NOT NULL,
      party_id TEXT, product_id TEXT, warehouse_id TEXT, lot_code TEXT, serial_number TEXT,
      quantity_num INTEGER, quantity_den INTEGER NOT NULL DEFAULT 1, amount_cents INTEGER NOT NULL,
      debit_role TEXT, credit_role TEXT, reference_no TEXT, line_no INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS go_live_control (
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), status TEXT NOT NULL CHECK(status IN ('PREPARING','ACTIVE')),
      activated_batch_id TEXT, activated_by TEXT, activated_at TEXT
    );
    INSERT OR IGNORE INTO go_live_control(singleton_id,status) VALUES(1,'PREPARING');
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('STAGED','VALIDATED','COMMITTED')),
      idempotency_key TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS import_rows (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(id), row_number INTEGER NOT NULL,
      raw_json TEXT NOT NULL, normalized_json TEXT, errors_json TEXT NOT NULL DEFAULT '[]', UNIQUE(batch_id,row_number)
    );
  `);

  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES('EA','Each',?,?)").run(now, now);
  // Backfill Phase 6E dedicated subjects so re-opening existing databases
  // re-routes role mappings to the correct control accounts.  The legacy
  // 6E-rc1 mappings (OUTPUT_TAX → 2202 / INPUT_TAX → 1122 / GRNI → 2202 /
  // PURCHASE_PRICE_VARIANCE → 6404) collided with frozen control accounts and
  // are deliberately replaced here.  MATERIAL_PRICE_VARIANCE retains 6404
  // and stays Phase 6D-only inventory-side variance; PURCHASE_PRICE_VARIANCE
  // moves to its own 6407 commercial-discount/price-variance role.
  const insertSubject = db.prepare('INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES(?,?,?,?,?,1)');
  for (const subject of SUBJECTS) insertSubject.run(...subject);
  const upsertRole = db.prepare("INSERT OR REPLACE INTO account_role_mappings(role_code,subject_id,updated_at) SELECT ?,id,? FROM accounting_subjects WHERE code=?");
  for (const [name, code] of ROLES) upsertRole.run(name, now, code);

  db.exec("UPDATE products SET base_uom_code=COALESCE(NULLIF(unit,''),'EA'); UPDATE sales_order_items SET document_uom_code=COALESCE(document_uom_code,(SELECT base_uom_code FROM products p WHERE p.id=product_id),'EA'),document_quantity_num=COALESCE(document_quantity_num,CAST(quantity AS INTEGER)),document_quantity_den=COALESCE(document_quantity_den,1),base_quantity_num=COALESCE(base_quantity_num,CAST(quantity AS INTEGER)),base_quantity_den=COALESCE(base_quantity_den,1); UPDATE purchase_order_items SET document_uom_code=COALESCE(document_uom_code,(SELECT base_uom_code FROM products p WHERE p.id=product_id),'EA'),document_quantity_num=COALESCE(document_quantity_num,CAST(quantity AS INTEGER)),document_quantity_den=COALESCE(document_quantity_den,1),base_quantity_num=COALESCE(base_quantity_num,CAST(quantity AS INTEGER)),base_quantity_den=COALESCE(base_quantity_den,1); UPDATE sales_delivery_items SET document_uom_code=COALESCE(document_uom_code,(SELECT base_uom_code FROM products p WHERE p.id=product_id),'EA'),document_quantity_num=COALESCE(document_quantity_num,CAST(quantity AS INTEGER)),document_quantity_den=COALESCE(document_quantity_den,1),base_quantity_num=COALESCE(base_quantity_num,CAST(quantity AS INTEGER)),base_quantity_den=COALESCE(base_quantity_den,1); UPDATE purchase_receipt_items SET document_uom_code=COALESCE(document_uom_code,(SELECT base_uom_code FROM products p WHERE p.id=product_id),'EA'),document_quantity_num=COALESCE(document_quantity_num,CAST(quantity AS INTEGER)),document_quantity_den=COALESCE(document_quantity_den,1),base_quantity_num=COALESCE(base_quantity_num,CAST(quantity AS INTEGER)),base_quantity_den=COALESCE(base_quantity_den,1); UPDATE bom_items SET uom_code_snapshot=COALESCE(uom_code_snapshot,(SELECT base_uom_code FROM products p WHERE p.id=product_id),'EA')");

  // Only records that pre-date 6E retain the legacy direct-finance contract.
  db.exec("UPDATE sales_deliveries SET billing_mode='LEGACY_DIRECT' WHERE status='CONFIRMED' AND NOT EXISTS(SELECT 1 FROM sales_invoice_items i WHERE i.delivery_id=sales_deliveries.id); UPDATE purchase_receipts SET billing_mode='LEGACY_DIRECT' WHERE status='CONFIRMED' AND NOT EXISTS(SELECT 1 FROM supplier_bill_items i WHERE i.receipt_id=purchase_receipts.id)");
}