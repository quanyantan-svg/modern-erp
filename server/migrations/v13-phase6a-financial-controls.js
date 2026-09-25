function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV13Phase6AFinancialControls(db) {
  for (const table of ['payment_collections', 'payment_disbursements']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN settlement_account_id TEXT`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN unapplied_amount_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN explicit_unapplied INTEGER NOT NULL DEFAULT 0`);
  }
  addColumn(db, 'ALTER TABLE period_closures ADD COLUMN reopen_reason TEXT');

  // Phase 5 allowed only one all-or-nothing reversal. Preserve those rows while
  // widening the history to multiple precise partial reversals.
  const reversalSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settlement_reversals'").get()?.sql || '';
  if (reversalSql.includes('UNIQUE(settlement_type, settlement_id)')) {
    db.exec(`
      ALTER TABLE settlement_reversals RENAME TO settlement_reversals_phase5;
      CREATE TABLE settlement_reversals (
        id TEXT PRIMARY KEY, reversal_no TEXT NOT NULL UNIQUE,
        settlement_type TEXT NOT NULL CHECK(settlement_type IN ('COLLECTION','PAYMENT')),
        settlement_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        business_date TEXT NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED'),
        creator_id TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO settlement_reversals SELECT * FROM settlement_reversals_phase5;
      DROP TABLE settlement_reversals_phase5;
      CREATE INDEX idx_settlement_reversal_source ON settlement_reversals(settlement_type,settlement_id);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settlement_unapplied_balances (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL CHECK(side IN ('CUSTOMER','SUPPLIER')),
      balance_type TEXT NOT NULL CHECK(balance_type IN ('PREPAYMENT','CREDIT')),
      party_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      source_no TEXT NOT NULL DEFAULT '', original_amount_cents INTEGER NOT NULL CHECK(original_amount_cents > 0),
      business_date TEXT NOT NULL, settlement_account_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','EXHAUSTED','REVERSED')),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_unapplied_party ON settlement_unapplied_balances(side,party_id,status);
    INSERT OR IGNORE INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
      SELECT 'p6-credit-'||id,CASE side WHEN 'AR' THEN 'CUSTOMER' ELSE 'SUPPLIER' END,'CREDIT',party_id,source_type,id,source_no,unapplied_cents,business_date,NULL,'OPEN',created_by,created_at
      FROM financial_credit_adjustments WHERE status='CONFIRMED' AND unapplied_cents>0;

    CREATE TABLE IF NOT EXISTS balance_applications (
      id TEXT PRIMARY KEY, application_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      balance_kind TEXT NOT NULL CHECK(balance_kind IN ('PREPAYMENT','CREDIT')),
      balance_id TEXT NOT NULL, target_open_item_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL, reversed_by TEXT, reversed_at TEXT, reversal_reason TEXT,
      FOREIGN KEY(balance_id) REFERENCES settlement_unapplied_balances(id)
    );
    CREATE INDEX IF NOT EXISTS idx_balance_application_target ON balance_applications(side,target_open_item_id,status);

    CREATE TABLE IF NOT EXISTS financial_refunds (
      id TEXT PRIMARY KEY, refund_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('CUSTOMER','SUPPLIER')),
      balance_id TEXT NOT NULL, party_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      settlement_account_id TEXT NOT NULL, payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK','CASH')),
      reference TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(balance_id) REFERENCES settlement_unapplied_balances(id)
    );
    CREATE TABLE IF NOT EXISTS financial_refund_reversals (
      id TEXT PRIMARY KEY, reversal_no TEXT NOT NULL UNIQUE, refund_id TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL, creator_id TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(refund_id) REFERENCES financial_refunds(id)
    );

    CREATE TABLE IF NOT EXISTS settlement_reversal_items (
      id TEXT PRIMARY KEY, reversal_id TEXT NOT NULL,
      component_type TEXT NOT NULL CHECK(component_type IN ('ALLOCATION','UNAPPLIED')),
      original_component_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      FOREIGN KEY(reversal_id) REFERENCES settlement_reversals(id),
      UNIQUE(reversal_id,component_type,original_component_id)
    );

    CREATE TABLE IF NOT EXISTS financial_write_offs (
      id TEXT PRIMARY KEY, write_off_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')), open_item_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','CONFIRMED','REJECTED')),
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT,
      confirmer_id TEXT, confirmed_at TEXT, rejection_reason TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_write_off_source ON financial_write_offs(side,open_item_id,status);
    CREATE TABLE IF NOT EXISTS financial_write_off_reversals (
      id TEXT PRIMARY KEY, reversal_no TEXT NOT NULL UNIQUE, write_off_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL, creator_id TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(write_off_id) REFERENCES financial_write_offs(id)
    );

    CREATE TABLE IF NOT EXISTS return_reversals (
      id TEXT PRIMARY KEY, reversal_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('SALES','PURCHASE')), return_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED'),
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_return_reversal_source ON return_reversals(side,return_id);
    CREATE TABLE IF NOT EXISTS return_reversal_items (
      id TEXT PRIMARY KEY, reversal_id TEXT NOT NULL, original_return_item_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      FOREIGN KEY(reversal_id) REFERENCES return_reversals(id),
      UNIQUE(reversal_id,original_return_item_id)
    );
    CREATE TABLE IF NOT EXISTS credit_reversal_components (
      id TEXT PRIMARY KEY, credit_id TEXT NOT NULL, return_reversal_id TEXT NOT NULL,
      applied_cents INTEGER NOT NULL DEFAULT 0 CHECK(applied_cents >= 0),
      unapplied_cents INTEGER NOT NULL DEFAULT 0 CHECK(unapplied_cents >= 0),
      UNIQUE(return_reversal_id),
      FOREIGN KEY(credit_id) REFERENCES financial_credit_adjustments(id),
      FOREIGN KEY(return_reversal_id) REFERENCES return_reversals(id)
    );

    CREATE TABLE IF NOT EXISTS settlement_account_movements (
      id TEXT PRIMARY KEY, settlement_account_id TEXT NOT NULL,
      source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      voucher_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id)
    );
    CREATE TABLE IF NOT EXISTS settlement_account_balance_baselines (
      settlement_account_id TEXT PRIMARY KEY, baseline_cents INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settlement_account_balance_baselines(settlement_account_id,baseline_cents,captured_at)
      SELECT id,balance_cents,datetime('now') FROM bank_accounts;

    CREATE TABLE IF NOT EXISTS idempotency_records (
      id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, document_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
      result_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status='SUCCEEDED'),
      created_at TEXT NOT NULL,
      UNIQUE(operation_type,document_id,idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS period_reopen_history (
      id TEXT PRIMARY KEY, period_closure_id TEXT NOT NULL, period TEXT NOT NULL,
      previous_closed_by TEXT, previous_closed_at TEXT, reason TEXT NOT NULL,
      reopened_by TEXT NOT NULL, reopened_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_migration_markers(name,applied_at)
      VALUES('v13-phase6a-financial-controls',datetime('now'));
  `);
}
