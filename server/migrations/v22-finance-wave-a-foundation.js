// V22 — Finance Operations Wave A foundation migration.
//
// document.md §33 + solution.md §28 design closure.
//
// Additive / idempotent / SQLite + MySQL parity.
//
// New canonical finance tables (Wave A primary capabilities FO01 / FO02 /
// FO03 / FO04 / FO05 / FO51 / FO52 / FO53):
//   - finance_parameters              (FO01)
//   - finance_recognition_policy      (FO02)
//   - finance_payment_terms           (FO03)
//   - finance_due_schedule_lines      (FO04; side+open_item_id portable identity)
//   - finance_settlement_schemes      (FO05)
//   - finance_business_close_state    (FO51/52/53 stable anchor; 3 seeded rows)
//   - finance_business_closures       (FO51/52/53 history rows)
//
// Additive columns on canonical open-item headers (FO09/10/11/12/13/14):
//   - account_receivables / account_payables:
//       recognition_mode, item_kind, conversion_state, provisional_origin_id,
//       converted_open_item_id, settlement_account_id
//
// finance_open_item_effects is a DERIVED SQL VIEW (created by the
// module, not by this migration); see
// server/modules/finance-open-item-effect-view.js.
//
// All migrations are additive-first / idempotent / reconcilable / fail-closed.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV22FinanceWaveAFoundation(db) {
  // -----------------------------------------------------------------
  // FO01 — finance_parameters
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_parameters (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_parameters_code ON finance_parameters(code);
  `);

  // -----------------------------------------------------------------
  // FO02 — finance_recognition_policy
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_recognition_policy (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      source_type TEXT NOT NULL,
      source_id TEXT,
      recognition_mode TEXT NOT NULL CHECK(recognition_mode IN (
        'DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'
      )),
      effective_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(side, source_type, source_id, effective_date)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_recognition_policy_lookup
      ON finance_recognition_policy(side, source_type, active, effective_date);
  `);

  // Seed three site-wide default policy rows.
  const seedDefaultPolicy = (side, sourceType, mode, now) => {
    const existing = db.prepare(
      `SELECT 1 FROM finance_recognition_policy WHERE side=? AND source_type=? AND source_id IS NULL AND effective_date=?`
    ).get(side, sourceType, '');
    if (existing) return;
    db.prepare(
      `INSERT INTO finance_recognition_policy(id, side, source_type, source_id, recognition_mode, effective_date, active, created_by, created_at)
       VALUES(?,?,?,NULL,?,?,1,'system',?)`
    ).run(`frp-seed-${side}-${sourceType}-${now}`, side, sourceType, mode, '', now);
  };
  const nowIso = new Date().toISOString();
  seedDefaultPolicy('AR', 'SALES_DELIVERY', 'DIRECT_BUSINESS_OPEN_ITEM', nowIso);
  seedDefaultPolicy('AR', 'SALES_INVOICE', 'INVOICE_DRIVEN_OPEN_ITEM', nowIso);
  seedDefaultPolicy('AP', 'PURCHASE_RECEIPT', 'PROVISIONAL_TO_FINANCIAL', nowIso);
  seedDefaultPolicy('AP', 'SUPPLIER_BILL', 'INVOICE_DRIVEN_OPEN_ITEM', nowIso);

  // -----------------------------------------------------------------
  // FO03 — finance_payment_terms
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_payment_terms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      days INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_payment_terms_code ON finance_payment_terms(code);
  `);

  // -----------------------------------------------------------------
  // FO04 — finance_due_schedule_lines (side + open_item_id portable identity)
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_due_schedule_lines (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      open_item_id TEXT NOT NULL,
      ar_open_item_id TEXT,
      ap_open_item_id TEXT,
      sequence INTEGER NOT NULL CHECK(sequence > 0),
      due_date TEXT NOT NULL,
      scheduled_amount_cents INTEGER NOT NULL CHECK(scheduled_amount_cents > 0),
      settled_amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','SETTLED','REVERSED')),
      created_at TEXT NOT NULL,
      CHECK (
        (side='AR' AND ar_open_item_id IS NOT NULL AND ap_open_item_id IS NULL) OR
        (side='AP' AND ap_open_item_id IS NOT NULL AND ar_open_item_id IS NULL)
      ),
      FOREIGN KEY (ar_open_item_id) REFERENCES account_receivables(id),
      FOREIGN KEY (ap_open_item_id) REFERENCES account_payables(id),
      UNIQUE(side, open_item_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_due_schedule_item
      ON finance_due_schedule_lines(side, open_item_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_finance_due_schedule_due
      ON finance_due_schedule_lines(due_date, status);
  `);

  // -----------------------------------------------------------------
  // FO05 — finance_settlement_schemes
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_settlement_schemes (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL CHECK(side IN ('AR','AP')),
      scheme_code TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      match_method TEXT NOT NULL DEFAULT 'AUTO' CHECK(match_method IN ('AUTO','MANUAL')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(side, scheme_code)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_settlement_schemes_lookup
      ON finance_settlement_schemes(side, active);
  `);

  // -----------------------------------------------------------------
  // FO51 / FO52 / FO53 — finance_business_close_state (stable anchor)
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_business_close_state (
      close_type TEXT PRIMARY KEY CHECK(close_type IN ('AR','AP','TREASURY')),
      closed_through_date TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);

  // Seed 3 stable anchor rows (idempotent).
  const seedClose = (closeType, now) => {
    db.prepare(
      `INSERT OR IGNORE INTO finance_business_close_state(close_type, closed_through_date, updated_at, updated_by)
       VALUES(?, '', ?, 'system')`
    ).run(closeType, now);
  };
  seedClose('AR', nowIso);
  seedClose('AP', nowIso);
  seedClose('TREASURY', nowIso);

  // -----------------------------------------------------------------
  // FO51 / FO52 / FO53 — finance_business_closures (history rows)
  // -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_business_closures (
      id TEXT PRIMARY KEY,
      close_type TEXT NOT NULL CHECK(close_type IN ('AR','AP','TREASURY')),
      closed_through_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','REOPENED')),
      closed_by TEXT,
      closed_at TEXT,
      reopened_by TEXT,
      reopened_at TEXT,
      reopen_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(close_type, closed_through_date, status)
    );
    CREATE INDEX IF NOT EXISTS idx_finance_business_closures_type
      ON finance_business_closures(close_type, status);
  `);

  // -----------------------------------------------------------------
  // FO09 / FO10 / FO11 / FO12 / FO13 — Additive columns on canonical
  // open-item headers (account_receivables / account_payables).
  // -----------------------------------------------------------------
  for (const table of ['account_receivables', 'account_payables']) {
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN recognition_mode TEXT
      CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'))`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN item_kind TEXT
      CHECK(item_kind IN ('FINAL','PROVISIONAL')) DEFAULT 'FINAL'`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN conversion_state TEXT
      CHECK(conversion_state IN ('OPEN','CONVERTED')) DEFAULT 'OPEN'`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN provisional_origin_id TEXT`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN converted_open_item_id TEXT`);
    addColumn(db, `ALTER TABLE ${table} ADD COLUMN settlement_account_id TEXT`);
  }
}
