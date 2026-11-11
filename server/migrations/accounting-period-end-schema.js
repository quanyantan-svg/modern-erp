// Accounting & Analytics Domain Closure — AA-W3 period-end / GL schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.3
//   AA-W3.1..AA-W3.17
// Design:    docs/design/accounting-analytics.md §31.3.1 / §31.8.1 / §31.8.2
//
// Additive + idempotent + SQLite / MySQL parity:
//   - `accounting_vouchers` gains the cashier-review columns (AA-28) and the
//     correction link (AA-27).
//   - `accounting_entries` gains the cash-flow dimension (AA-29).
//   - `voucher_corrections` is the canonical correction chain (AA-27).
//   - `period_end_definitions` / `period_end_runs` carry the period-end
//     transfer / amortization / accrual definitions and their execution
//     history (AA-30).
//   - `profit_transfer_runs` carries the real profit-and-loss transfer
//     (AA-32). It is also the authority the AA-W1 close checklist reads when
//     it evaluates PROFIT_NOT_TRANSFERRED.
//
// All new money columns are safe-integer cents. No REAL / FLOAT column is
// introduced anywhere in this migration.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    const message = String(error.message || '').toLowerCase();
    if (!message.includes('duplicate column name') && !message.includes("already exists")) throw error;
  }
}

export function migrateAccountingPeriodEndSchema(db) {
  // ---- AA-28 cashier review on the voucher ----
  addColumn(db, "ALTER TABLE accounting_vouchers ADD COLUMN cashier_review_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'");
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN cashier_reviewed_by TEXT');
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN cashier_reviewed_at TEXT');
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN cashier_review_reason TEXT');
  // ---- AA-27 correction link ----
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN correction_of_id TEXT');

  // ---- AA-29 cash-flow dimension on the entry ----
  addColumn(db, 'ALTER TABLE accounting_entries ADD COLUMN cash_flow_category TEXT');
  addColumn(db, 'ALTER TABLE accounting_entries ADD COLUMN cash_flow_item TEXT');
  addColumn(db, 'ALTER TABLE accounting_entries ADD COLUMN cash_flow_amount_cents INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS voucher_corrections (
      id                    TEXT PRIMARY KEY,
      original_voucher_id   TEXT NOT NULL,
      correction_type       TEXT NOT NULL
                            CHECK(correction_type IN ('REVERSAL','SUPPLEMENT','CORRECTION')),
      correction_voucher_id TEXT,
      difference_json       TEXT,
      reason                TEXT NOT NULL DEFAULT '',
      created_by            TEXT NOT NULL,
      created_at            TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_corrections_original ON voucher_corrections(original_voucher_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS period_end_definitions (
      id          TEXT PRIMARY KEY,
      def_type    TEXT NOT NULL CHECK(def_type IN ('TRANSFER','AMORTIZATION','ACCRUAL')),
      code        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      source_json TEXT NOT NULL,
      target_role TEXT NOT NULL,
      direction   TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
      amount_expr TEXT NOT NULL,
      valid_from  TEXT,
      valid_to    TEXT,
      status      TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS period_end_runs (
      id            TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      period        TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
      amount_cents  INTEGER NOT NULL DEFAULT 0,
      voucher_id    TEXT,
      error_code    TEXT,
      error_message TEXT,
      created_at    TEXT NOT NULL,
      UNIQUE(definition_id, period)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS profit_transfer_runs (
      id                 TEXT PRIMARY KEY,
      period             TEXT NOT NULL UNIQUE,
      status             TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','REVERSED')),
      voucher_id         TEXT,
      transferred_cents  INTEGER NOT NULL DEFAULT 0,
      reason             TEXT,
      created_by         TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      reversed_at        TEXT,
      reversed_by        TEXT
    );
  `);

  // ---- AA-W3.14 profit transfer equity subject ----
  // The profit-and-loss transfer needs a real equity account to carry the
  // net result. It is seeded (idempotently) so the transfer can run on a
  // fresh database without a manual setup step. `4103 本年利润` is the
  // standard account for the current-year result.
  db.prepare(
    "INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,parent_id,active) VALUES(?,?,?,?,?,NULL,1)",
  ).run('subject-4103', '4103', '本年利润', 'EQUITY', 'CREDIT');
  db.prepare(
    "INSERT OR IGNORE INTO account_role_mappings(role_code,subject_id,updated_by,updated_at) VALUES(?,?,?,?)",
  ).run('PROFIT_TRANSFER', 'subject-4103', null, new Date().toISOString());
}
