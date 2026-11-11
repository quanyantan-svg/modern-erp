// Accounting & Analytics Domain Closure — AA-W7 经营会计 schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.7
//   AA-W7.1..AA-W7.12
// Design:    docs/design/accounting-analytics.md §31.7 / §31.8
//
// Purely additive and idempotent: every table is created with `IF NOT EXISTS`
// and every column is added through the repository's portable `addColumn`
// helper, so SQLite and MySQL share one definition.
//
// Money is always a safe-integer cent amount; no REAL / FLOAT column is
// introduced anywhere in this file.

function addColumn(db, sql) {
  const match = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i.exec(sql);
  if (!match) return;
  const [, table, column] = match;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return;
  db.exec(sql);
}

export function migrateManagementAccountingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS management_books (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      legal_entity TEXT NOT NULL,
      base_currency TEXT NOT NULL DEFAULT 'CNY',
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_management_books_status ON management_books(status, code);

    CREATE TABLE IF NOT EXISTS profit_centers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      management_book_id TEXT NOT NULL,
      org_unit TEXT,
      owner_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profit_centers_book ON profit_centers(management_book_id, status, code);

    CREATE TABLE IF NOT EXISTS internal_settlement_prices (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      from_profit_center_id TEXT,
      to_profit_center_id TEXT,
      price_cents INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_internal_settlement_prices_lookup
      ON internal_settlement_prices(product_id, status, valid_from);

    CREATE TABLE IF NOT EXISTS operating_ledger_entries (
      id TEXT PRIMARY KEY,
      management_book_id TEXT NOT NULL,
      profit_center_id TEXT,
      period TEXT NOT NULL,
      business_date TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT,
      account_code TEXT NOT NULL,
      debit_cents INTEGER NOT NULL DEFAULT 0,
      credit_cents INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operating_ledger_entries_period
      ON operating_ledger_entries(management_book_id, period, profit_center_id);
    -- 归集幂等：同一来源事实只允许进入经营台账一次。
    CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_ledger_source
      ON operating_ledger_entries(management_book_id, source_kind, source_id, account_code, profit_center_id);

    CREATE TABLE IF NOT EXISTS cost_collection_plans (
      id TEXT PRIMARY KEY,
      management_book_id TEXT NOT NULL,
      period TEXT NOT NULL,
      source_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cost_collection_plans_period
      ON cost_collection_plans(management_book_id, period);

    CREATE TABLE IF NOT EXISTS allocation_rules (
      id TEXT PRIMARY KEY,
      management_book_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      basis_type TEXT NOT NULL,
      driver_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_allocation_rules_book ON allocation_rules(management_book_id, status, code);

    CREATE TABLE IF NOT EXISTS allocation_results (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      source_json TEXT NOT NULL,
      target_profit_center_id TEXT NOT NULL,
      allocated_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_allocation_results_plan ON allocation_results(plan_id, created_at);

    CREATE TABLE IF NOT EXISTS internal_settlements (
      id TEXT PRIMARY KEY,
      management_book_id TEXT NOT NULL,
      period TEXT NOT NULL,
      from_profit_center_id TEXT NOT NULL,
      to_profit_center_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_internal_settlements_period
      ON internal_settlements(management_book_id, period);

    CREATE TABLE IF NOT EXISTS operating_period_closures (
      id TEXT PRIMARY KEY,
      management_book_id TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL,
      closed_by TEXT,
      closed_at TEXT,
      reopen_reason TEXT,
      reopened_by TEXT,
      reopened_at TEXT,
      UNIQUE(management_book_id, period)
    );
  `);
}
