function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV13Phase5SettlementIntegrity(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration_markers (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const firstRun = !db.prepare("SELECT 1 FROM schema_migration_markers WHERE name='v13-phase5-settlement-integrity'").get();
  for (const table of ['customers', 'suppliers']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 0`);
  }
  for (const table of ['sales_orders', 'purchase_orders']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN payment_terms_days INTEGER`);
  }
  for (const table of ['account_receivables', 'account_payables']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN payment_terms_days INTEGER`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN return_credit_applied_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN discount_credit_applied_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN other_credit_applied_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN cash_allocation_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN open_amount_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN item_class TEXT NOT NULL DEFAULT 'LEGACY'`);
  }
  for (const table of ['payment_collections', 'payment_disbursements']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN external_reference TEXT NOT NULL DEFAULT ''`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN reversed_amount_cents INTEGER NOT NULL DEFAULT 0`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN reversal_status TEXT NOT NULL DEFAULT 'NONE'`);
  }
  addColumn(db, 'ALTER TABLE payment_collection_items ADD COLUMN reversed_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE payment_collection_items ADD COLUMN open_before_cents INTEGER');
  addColumn(db, 'ALTER TABLE payment_collection_items ADD COLUMN open_after_cents INTEGER');
  addColumn(db, 'ALTER TABLE payment_disbursement_items ADD COLUMN reversed_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE payment_disbursement_items ADD COLUMN open_before_cents INTEGER');
  addColumn(db, 'ALTER TABLE payment_disbursement_items ADD COLUMN open_after_cents INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_credit_adjustments (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('RETURN','DISCOUNT','OTHER')),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT NOT NULL DEFAULT '',
      target_open_item_id TEXT NOT NULL,
      party_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      applied_cents INTEGER NOT NULL CHECK(applied_cents >= 0),
      unapplied_cents INTEGER NOT NULL CHECK(unapplied_cents >= 0),
      reversed_cents INTEGER NOT NULL DEFAULT 0 CHECK(reversed_cents >= 0),
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reversed_by TEXT,
      reversed_at TEXT,
      reversal_date TEXT,
      reversal_reason TEXT NOT NULL DEFAULT '',
      UNIQUE(side, source_type, source_id),
      CHECK(amount_cents = applied_cents + unapplied_cents),
      CHECK(reversed_cents <= amount_cents)
    );
    CREATE INDEX IF NOT EXISTS idx_credit_target ON financial_credit_adjustments(side,target_open_item_id);
    CREATE INDEX IF NOT EXISTS idx_credit_party ON financial_credit_adjustments(side,party_id,status);

    CREATE TABLE IF NOT EXISTS settlement_reversals (
      id TEXT PRIMARY KEY,
      reversal_no TEXT NOT NULL UNIQUE,
      settlement_type TEXT NOT NULL CHECK(settlement_type IN ('COLLECTION','PAYMENT')),
      settlement_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED'),
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(settlement_type, settlement_id)
    );
  `);
  const duplicateVoucher = db.prepare('SELECT source_type,source_id,COUNT(*) n FROM accounting_vouchers GROUP BY source_type,source_id HAVING COUNT(*)>1 LIMIT 1').get();
  if (duplicateVoucher) throw new Error(`Phase 5 migration blocked: duplicate voucher source ${duplicateVoucher.source_type}/${duplicateVoucher.source_id}`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_source_unique ON accounting_vouchers(source_type,source_id)');

  // Legacy rows remain readable and explicitly classified. Only authoritative
  // positive Delivery/Receipt sources enter the V1.3 open-item model.
  if (firstRun) {
    db.exec(`
      UPDATE account_receivables
         SET item_class=CASE WHEN source_type='SALES_DELIVERY' AND amount_cents>0 THEN 'SOURCE' ELSE 'LEGACY' END;
      UPDATE account_payables
         SET item_class=CASE WHEN source_type='PURCHASE_RECEIPT' AND amount_cents>0 THEN 'SOURCE' ELSE 'LEGACY' END;
      UPDATE account_receivables
         SET cash_allocation_cents=paid_cents,
             open_amount_cents=MAX(0,amount_cents+adjustment_cents-paid_cents-write_off_cents)
       WHERE item_class='SOURCE';
      UPDATE account_payables
         SET cash_allocation_cents=paid_cents,
             open_amount_cents=MAX(0,amount_cents+adjustment_cents-paid_cents-write_off_cents)
       WHERE item_class='SOURCE';
      INSERT INTO schema_migration_markers(name,applied_at) VALUES('v13-phase5-settlement-integrity',datetime('now'));
    `);
  }
}
