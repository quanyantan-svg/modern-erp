// Accounting & Analytics Domain Closure — AA-W6 存货核算深化 schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.6
//   AA-W6.1..AA-W6.16
// Design:    docs/design/accounting-analytics.md §31.6 / §31.8
//
// The migration is purely additive and idempotent: every table is created with
// `IF NOT EXISTS` and every column is added through the repository's portable
// `addColumn` helper, so SQLite and MySQL share one definition.
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

export function migrateInventoryCostingSchema(db) {
  // ── 核算范围（核算体系 / 组织 / 所有者维度） ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_scopes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      org_scope TEXT NOT NULL,
      owner_scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accounting_scopes_status ON accounting_scopes(status, code);
  `);

  // ── 计价配置（属性 > 类别 > 默认；同级按 priority 决胜） ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_costing_profiles (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_class TEXT,
      accounting_scope_id TEXT NOT NULL,
      valuation_method TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      effective_from TEXT,
      effective_to TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_costing_profiles_lookup
      ON product_costing_profiles(status, product_id, product_class, priority);
  `);

  // ── 暂估入库单与暂估差异调整 ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS provisional_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL UNIQUE,
      source_receipt_id TEXT NOT NULL,
      scope_id TEXT,
      estimate_cents INTEGER NOT NULL,
      basis TEXT NOT NULL,
      status TEXT NOT NULL,
      converted_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provisional_receipts_status ON provisional_receipts(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_provisional_receipts_source ON provisional_receipts(source_receipt_id);

    CREATE TABLE IF NOT EXISTS provisional_receipt_adjustments (
      id TEXT PRIMARY KEY,
      provisional_receipt_id TEXT NOT NULL,
      final_cents INTEGER NOT NULL,
      difference_cents INTEGER NOT NULL,
      voucher_id TEXT,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provisional_receipt_adjustments_receipt
      ON provisional_receipt_adjustments(provisional_receipt_id, created_at);
  `);

  // ── 采购费用归集、分摊规则与分摊结果 ───────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_expenses (
      id TEXT PRIMARY KEY,
      expense_no TEXT NOT NULL UNIQUE,
      expense_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      incurred_date TEXT NOT NULL,
      supplier_id TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_expenses_status ON purchase_expenses(status, incurred_date);

    CREATE TABLE IF NOT EXISTS purchase_expense_allocation_rules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      basis_type TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_expense_allocation_rules_status
      ON purchase_expense_allocation_rules(status, code);

    CREATE TABLE IF NOT EXISTS purchase_expense_allocations (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      target_product_id TEXT,
      target_scope_id TEXT,
      allocated_cents INTEGER NOT NULL,
      voucher_id TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_expense_allocations_expense
      ON purchase_expense_allocations(expense_id, created_at);
  `);

  // ── 成本调整与完工成本结转 ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_no TEXT NOT NULL UNIQUE,
      adjustment_type TEXT NOT NULL,
      product_id TEXT,
      scope_id TEXT,
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      voucher_id TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cost_adjustments_status ON cost_adjustments(status, created_at);

    CREATE TABLE IF NOT EXISTS production_cost_closings (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      period TEXT NOT NULL,
      wip_cents INTEGER NOT NULL,
      product_cost_cents INTEGER NOT NULL,
      variance_cents INTEGER NOT NULL,
      variance_target TEXT NOT NULL,
      voucher_id TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(production_order_id, period)
    );
    CREATE INDEX IF NOT EXISTS idx_production_cost_closings_period
      ON production_cost_closings(period, production_order_id);
  `);
}
