// V22 — Finance Operations Wave D migration.
//
// New canonical finance tables (Wave D primary capabilities FO39 / FO42 /
// FO44 / FO45 / FO47 / FO48):
//   - finance_treasury_movements           (FO39 canonical treasury movement)
//   - finance_notes                       (FO42 / FO43 notes)
//   - finance_payment_requests           (FO44)
//   - finance_cash_counts                 (FO45 header)
//   - finance_cash_count_lines            (FO45 line)
//   - finance_bank_statement_imports      (FO47)
//   - finance_bank_reconciliations        (FO48 header)
//   - finance_bank_reconciliation_matches (FO48 line)
//
// Additive columns on bank_accounts (FO37/38 additive extend).
//
// All migrations are additive / idempotent / SQLite + MySQL parity.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV22FinanceWaveDTreasury(db) {
  // -----------------------------------------------------------------
  // FO37 / FO38 — bank_accounts additive extend (canonical settlement account master)
  // -----------------------------------------------------------------
  addColumn(db, 'ALTER TABLE bank_accounts ADD COLUMN code TEXT');
  addColumn(db, 'ALTER TABLE bank_accounts ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE bank_accounts ADD COLUMN accounting_role TEXT NOT NULL DEFAULT ""');
  addColumn(db, 'ALTER TABLE bank_accounts ADD COLUMN accounting_subject_id TEXT');
  // `code IS NULL` is the one-time legacy-row marker. Preserve the former
  // authoritative balance as the canonical opening before balance_cents is
  // converted to a derived projection, then give every legacy row a stable
  // code. Re-running the migration cannot absorb later movements into opening.
  db.exec(`UPDATE bank_accounts SET opening_balance_cents=balance_cents WHERE code IS NULL`);
  db.exec(`UPDATE bank_accounts SET code=id WHERE code IS NULL`);
  addColumn(db, 'CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_code ON bank_accounts(code) WHERE code IS NOT NULL');

  // CASH is an operational settlement account, never an implicit GL subject.
  // A deterministic compatibility row lets legacy clients that submitted the
  // 1001 subject id resolve to the new canonical account identity.
  const cashAccount = db.prepare("SELECT id FROM bank_accounts WHERE account_type='CASH' ORDER BY created_at,id LIMIT 1").get();
  if (!cashAccount) {
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO bank_accounts(
      id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,
      code,opening_balance_cents,accounting_role,accounting_subject_id)
      VALUES('finance-cash-default','现金','CASH-DEFAULT','库存现金','CASH',0,'CNY',1,?,?,
      'CASH-DEFAULT',0,'CASH','subject-001')`).run(createdAt, createdAt);
  }

  // -----------------------------------------------------------------
  // FO39 — canonical treasury movement ledger
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_treasury_movements (
      id TEXT PRIMARY KEY,
      settlement_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      business_date TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      counterparty_type TEXT NOT NULL DEFAULT '',
      counterparty_id TEXT NOT NULL DEFAULT '',
      external_reference TEXT NOT NULL DEFAULT '',
      reversal_of_movement_id TEXT,
      movement_group_id TEXT NOT NULL,
      accounting_event_id TEXT,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
      idempotency_key TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_treasury_movement_account
      ON finance_treasury_movements(settlement_account_id, business_date);
    CREATE INDEX IF NOT EXISTS idx_finance_treasury_movement_group
      ON finance_treasury_movements(movement_group_id);
  `);

  // -----------------------------------------------------------------
  // FO42 / FO43 — notes
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_notes (
      id TEXT PRIMARY KEY,
      note_no TEXT NOT NULL UNIQUE,
      direction TEXT NOT NULL CHECK(direction IN ('RECEIVABLE','PAYABLE')),
      face_amount_cents INTEGER NOT NULL CHECK(face_amount_cents > 0),
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      drawer_name TEXT NOT NULL DEFAULT '',
      payee_name TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      holder_id TEXT,
      status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED','HELD','ENDORSED','DISCOUNTED','SETTLED','CANCELLED')),
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_notes_lookup ON finance_notes(direction, status);
  `);

  // -----------------------------------------------------------------
  // FO44 — payment requests
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_payment_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      party_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','EXECUTED','CANCELLED')),
      creator_id TEXT NOT NULL,
      approver_id TEXT,
      executor_id TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      executed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_finance_payment_requests_status
      ON finance_payment_requests(side, status, business_date);
  `);

  // -----------------------------------------------------------------
  // FO45 — cash count header + lines
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_cash_counts (
      id TEXT PRIMARY KEY,
      count_no TEXT NOT NULL UNIQUE,
      settlement_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
      count_date TEXT NOT NULL,
      book_amount_cents INTEGER NOT NULL,
      physical_amount_cents INTEGER NOT NULL,
      difference_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED')),
      creator_id TEXT NOT NULL,
      confirmer_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_finance_cash_counts_account
      ON finance_cash_counts(settlement_account_id, count_date);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_cash_count_lines (
      id TEXT PRIMARY KEY,
      count_id TEXT NOT NULL,
      denomination TEXT NOT NULL,
      count_quantity INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (count_id) REFERENCES finance_cash_counts(id),
      UNIQUE(count_id, denomination)
    );
  `);

  // -----------------------------------------------------------------
  // FO47 — bank statement import batches
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_bank_statement_imports (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IMPORTED','FAILED')),
      imported_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(file_name, fingerprint)
    );
  `);

  // -----------------------------------------------------------------
  // FO48 — bank reconciliation header + matches
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_bank_reconciliations (
      id TEXT PRIMARY KEY,
      settlement_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
      statement_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RECONCILED','CLOSED')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(settlement_account_id, statement_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_bank_reconciliation_matches (
      id TEXT PRIMARY KEY,
      reconciliation_id TEXT NOT NULL REFERENCES finance_bank_reconciliations(id),
      statement_line_id TEXT NOT NULL,
      treasury_movement_id TEXT NOT NULL,
      matched_amount_cents INTEGER NOT NULL CHECK(matched_amount_cents > 0),
      match_method TEXT NOT NULL DEFAULT 'AUTO' CHECK(match_method IN ('AUTO','MANUAL')),
      matched_by TEXT NOT NULL,
      matched_at TEXT NOT NULL,
      UNIQUE(reconciliation_id, statement_line_id, treasury_movement_id)
    );
  `);
}
