// V22 — Finance Operations Wave B migration.
//
// New canonical finance tables (Wave B primary capabilities FO15 / FO28):
//   - finance_counterparty_transfers        (FO15; header)
//   - finance_counterparty_transfer_lines   (FO15; line)
//   - finance_bad_debt_provisions          (FO28)
//
// All migrations are additive / idempotent / SQLite + MySQL parity.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV22FinanceWaveBSettlement(db) {
  // -----------------------------------------------------------------
  // FO15 — Counterparty Transfer
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_counterparty_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      source_party_id TEXT NOT NULL,
      target_party_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','REVERSED')),
      creator_id TEXT NOT NULL,
      confirmer_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_finance_counterparty_transfer_side
      ON finance_counterparty_transfers(side, status, business_date);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_counterparty_transfer_lines (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      side TEXT NOT NULL,
      source_open_item_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      FOREIGN KEY (transfer_id) REFERENCES finance_counterparty_transfers(id),
      UNIQUE(transfer_id, source_open_item_id, side)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_counterparty_transfer_line_transfer
      ON finance_counterparty_transfer_lines(transfer_id);
  `);

  // -----------------------------------------------------------------
  // FO28 — Bad-debt provision (bounded AGING / INDIVIDUAL; not full IFRS / ECL).
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_bad_debt_provisions (
      id TEXT PRIMARY KEY,
      provision_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      method TEXT NOT NULL CHECK(method IN ('AGING','INDIVIDUAL')),
      open_item_id TEXT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','CONFIRMED','REVERSED','REJECTED')),
      creator_id TEXT NOT NULL,
      confirmer_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_finance_bad_debt_provisions_lookup
      ON finance_bad_debt_provisions(side, status, business_date);
  `);
}
