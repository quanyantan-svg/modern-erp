// Accounting & Analytics Domain Closure — AA-W5 fixed-asset lifecycle schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.5 AA-W5.1..AA-W5.19
// Design:    docs/design/accounting-analytics.md §31.5.1 / §31.8.1 / §31.8.2
//
// Additive + idempotent + SQLite / MySQL parity:
//   - `asset_types` / `asset_locations` / `depreciation_policies` become
//     dictionary / policy entities. The asset row **references** them instead
//     of carrying free text (§35.4.5 AA-W5.1 / AA-W5.2).
//   - `fixed_assets` becomes an asset card with a lifecycle status machine
//     (AA-W5.3). The legacy columns stay untouched (§35.6.8).
//   - Change requests / split-merge / loans / stocktakes / depreciation runs
//     / disposals get their own tables so the history is append-only.
//
// All money columns are safe-integer cents. No REAL / FLOAT column.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    const message = String(error.message || '').toLowerCase();
    if (!message.includes('duplicate column name') && !message.includes('already exists')) throw error;
  }
}

export function migrateFixedAssetsSchema(db) {
  // ---- dictionaries -------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_types (
      id                TEXT PRIMARY KEY,
      code              TEXT NOT NULL UNIQUE,
      name              TEXT NOT NULL,
      useful_life_months INTEGER,
      status            TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at        TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_locations (
      id         TEXT PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS depreciation_policies (
      id                 TEXT PRIMARY KEY,
      code               TEXT NOT NULL UNIQUE,
      name               TEXT NOT NULL,
      method             TEXT NOT NULL
                         CHECK(method IN ('STRAIGHT_LINE','DOUBLE_DECLINING','WORKLOAD')),
      useful_life_months INTEGER NOT NULL,
      residual_rate_bp   INTEGER NOT NULL DEFAULT 0,
      start_rule         TEXT NOT NULL
                         CHECK(start_rule IN ('FROM_PURCHASE','FROM_TRANSFER','NEXT_PERIOD')),
      status             TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at         TEXT NOT NULL
    );
  `);

  // ---- asset card ---------------------------------------------------------
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN card_no TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN asset_type_id TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN location_id TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN policy_id TEXT');
  addColumn(db, "ALTER TABLE fixed_assets ADD COLUMN card_status TEXT NOT NULL DEFAULT 'DRAFT'");
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN custodian_user_id TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN source_type TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN source_id TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN original_value_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN book_value_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN disposed_at TEXT');
  addColumn(db, 'ALTER TABLE fixed_assets ADD COLUMN activated_at TEXT');

  // ---- change requests ----------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_change_requests (
      id           TEXT PRIMARY KEY,
      asset_id     TEXT NOT NULL,
      request_no   TEXT NOT NULL UNIQUE,
      change_type  TEXT NOT NULL,
      status       TEXT NOT NULL
                   CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','EFFECTIVE')),
      before_json  TEXT NOT NULL,
      after_json   TEXT NOT NULL,
      reason       TEXT NOT NULL,
      submitted_by TEXT,
      submitted_at TEXT,
      approved_by  TEXT,
      approved_at  TEXT,
      created_at   TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_asset_change_requests_asset ON asset_change_requests(asset_id, status)');

  // ---- split / merge ------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_split_merge_records (
      id                TEXT PRIMARY KEY,
      asset_id          TEXT NOT NULL,
      action            TEXT NOT NULL CHECK(action IN ('SPLIT','MERGE')),
      status            TEXT NOT NULL,
      before_json       TEXT NOT NULL,
      after_json        TEXT NOT NULL,
      before_value_cents INTEGER NOT NULL,
      after_value_cents  INTEGER NOT NULL,
      reason            TEXT NOT NULL,
      created_by        TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );
  `);

  // ---- loans --------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_loans (
      id                TEXT PRIMARY KEY,
      asset_id          TEXT NOT NULL,
      loan_no           TEXT NOT NULL UNIQUE,
      borrower_user_id  TEXT,
      status            TEXT NOT NULL CHECK(status IN ('OPEN','RETURNED','OVERDUE')),
      loaned_at         TEXT NOT NULL,
      due_at            TEXT,
      returned_at       TEXT,
      created_at        TEXT NOT NULL
    );
  `);

  // ---- stocktakes ---------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_stocktakes (
      id           TEXT PRIMARY KEY,
      stocktake_no TEXT NOT NULL UNIQUE,
      period       TEXT NOT NULL,
      status       TEXT NOT NULL CHECK(status IN ('DRAFT','COMPLETED')),
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      completed_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_stocktake_items (
      id                  TEXT PRIMARY KEY,
      stocktake_id        TEXT NOT NULL,
      asset_id            TEXT NOT NULL,
      book_location_id    TEXT,
      actual_location_id  TEXT,
      book_custodian_id   TEXT,
      actual_custodian_id TEXT,
      difference_type     TEXT,
      status              TEXT NOT NULL,
      handled_at          TEXT,
      handled_by          TEXT
    );
  `);

  // ---- depreciation runs --------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_depreciation_runs (
      id          TEXT PRIMARY KEY,
      period      TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
      total_cents INTEGER NOT NULL DEFAULT 0,
      voucher_id  TEXT,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      created_by  TEXT NOT NULL
    );
  `);
  addColumn(db, 'ALTER TABLE asset_depreciations ADD COLUMN run_id TEXT');
  addColumn(db, 'ALTER TABLE asset_depreciations ADD COLUMN policy_id TEXT');
  addColumn(db, 'ALTER TABLE asset_depreciations ADD COLUMN voucher_id TEXT');
  addColumn(db, "ALTER TABLE asset_depreciations ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE asset_depreciations ADD COLUMN depreciation_type TEXT NOT NULL DEFAULT 'AUTO'");
  addColumn(db, 'ALTER TABLE asset_depreciations ADD COLUMN period TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_depreciations_asset_period ON asset_depreciations(asset_id, period)');

  // ---- disposals ----------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_disposals (
      id             TEXT PRIMARY KEY,
      disposal_no    TEXT NOT NULL UNIQUE,
      asset_id       TEXT NOT NULL,
      disposal_type  TEXT NOT NULL CHECK(disposal_type IN ('SCRAP','SALE','REDUCTION')),
      status         TEXT NOT NULL
                     CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','POSTED','REJECTED')),
      disposal_date  TEXT NOT NULL,
      proceeds_cents INTEGER NOT NULL DEFAULT 0,
      reason         TEXT NOT NULL,
      submitted_by   TEXT,
      submitted_at   TEXT,
      approved_by    TEXT,
      approved_at    TEXT,
      voucher_id     TEXT,
      created_at     TEXT NOT NULL
    );
  `);

  // ---- accounting subjects + role mappings ---------------------------------
  // The depreciation / disposal postings need authoritative accounts. They are
  // seeded idempotently so the capability works on a fresh database.
  const insertSubject = db.prepare(
    'INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,parent_id,active) VALUES(?,?,?,?,?,NULL,1)',
  );
  insertSubject.run('subject-1601', '1601', '固定资产', 'ASSET', 'DEBIT');
  insertSubject.run('subject-1602', '1602', '累计折旧', 'ASSET', 'CREDIT');
  insertSubject.run('subject-6602', '6602', '折旧费用', 'EXPENSE', 'DEBIT');
  insertSubject.run('subject-6603', '6603', '处置资产损益', 'EXPENSE', 'DEBIT');
  const mapRole = db.prepare(
    'INSERT OR IGNORE INTO account_role_mappings(role_code,subject_id,updated_by,updated_at) VALUES(?,?,?,?)',
  );
  const now = new Date().toISOString();
  mapRole.run('FIXED_ASSET_ORIGINAL', 'subject-1601', null, now);
  mapRole.run('ACCUMULATED_DEPRECIATION', 'subject-1602', null, now);
  mapRole.run('DEPRECIATION_EXPENSE', 'subject-6602', null, now);
  mapRole.run('DISPOSAL_GAIN_LOSS', 'subject-6603', null, now);
}
