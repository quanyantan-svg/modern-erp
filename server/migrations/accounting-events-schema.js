// Accounting & Analytics Domain Closure — AA-W1 schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.1 (AA-W1.1..AA-W1.18)
// Design:    docs/design/accounting-analytics.md §31.1 / §31.8
//
// New tables:
//   - accounting_events               会计事件台账（业务事实 → 凭证的唯一归一关系层）
//   - accounting_event_attempts       生成尝试留痕（重试 / 失败原因）
//   - accounting_reconciliation_runs  业务↔GL 对账快照头
//   - accounting_reconciliation_items 对账快照明细（逐项差异与解释）
//   - accounting_close_check_snapshots 期末检查快照
//
// All statements are additive / idempotent / SQLite + MySQL parity.
// `source_item_id` is NOT NULL DEFAULT '' so the natural unique key works on
// both engines (a NULL member would defeat UNIQUE semantics in SQL).
//
// Permissions added here are seeded into the canonical `permissions` table and
// granted through `role_permissions`, so existing databases and freshly
// created databases converge on the same RBAC contract.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

const NEW_PERMISSIONS = [
  ['ACCOUNTING_SUBJECTS_VIEW', '查看会计科目'],
  ['ACCOUNTING_SUBJECTS_MANAGE', '维护会计科目'],
  ['ACCOUNTING_EVENTS_VIEW', '查看会计事件与未生成清单'],
  ['ACCOUNTING_EVENTS_REPAIR', '修复会计事件（重试 / 跳过 / 恢复）'],
  ['ACCOUNTING_RECONCILIATION_VIEW', '查看业务财务对账'],
  ['VOUCHER_CASHIER_REVIEW', '出纳复核'],
  ['ACCOUNTING_PERIOD_END_MANAGE', '执行期末转账 / 摊销 / 计提 / 损益结转'],
  ['CASH_FLOW_VIEW', '查看现金流量表'],
  ['REPORT_TEMPLATE_VIEW', '查看报表模板'],
  ['REPORT_TEMPLATE_MANAGE', '维护报表模板'],
  ['REPORT_INSTANCE_VIEW', '查看报表实例'],
  ['REPORT_INSTANCE_SUBMIT', '提交报表实例'],
  ['REPORT_INSTANCE_APPROVE', '审核报表实例'],
  ['ACCOUNTING_RULE_RUN', '执行凭证批量 / 调度生成'],
  ['FIXED_ASSET_DEPRECIATE', '计提固定资产折旧'],
  ['FIXED_ASSET_DISPOSE', '处置固定资产'],
  ['INVENTORY_COST_VIEW', '查看存货核算'],
  ['INVENTORY_COST_MANAGE', '维护存货核算'],
  ['MANAGEMENT_ACCOUNTING_VIEW', '查看经营会计'],
  ['MANAGEMENT_ACCOUNTING_MANAGE', '维护经营会计'],
];

const ROLE_ACCOUNTING_GRANTS = [
  'ACCOUNTING_SUBJECTS_VIEW',
  'ACCOUNTING_SUBJECTS_MANAGE',
  'ACCOUNTING_EVENTS_VIEW',
  'ACCOUNTING_EVENTS_REPAIR',
  'ACCOUNTING_RECONCILIATION_VIEW',
  'VOUCHER_CASHIER_REVIEW',
  'ACCOUNTING_PERIOD_END_MANAGE',
  'CASH_FLOW_VIEW',
  'REPORT_TEMPLATE_VIEW',
  'REPORT_TEMPLATE_MANAGE',
  'REPORT_INSTANCE_VIEW',
  'REPORT_INSTANCE_SUBMIT',
  'REPORT_INSTANCE_APPROVE',
  'ACCOUNTING_RULE_RUN',
  'FIXED_ASSET_DEPRECIATE',
  'INVENTORY_COST_VIEW',
  'INVENTORY_COST_MANAGE',
  'MANAGEMENT_ACCOUNTING_VIEW',
  'MANAGEMENT_ACCOUNTING_MANAGE',
];

export function migrateAccountingEventsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_events (
      id                 TEXT PRIMARY KEY,
      event_type         TEXT NOT NULL,
      source_type        TEXT NOT NULL,
      source_id          TEXT NOT NULL,
      source_item_id     TEXT NOT NULL DEFAULT '',
      business_date      TEXT NOT NULL,
      period             TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK(status IN ('PENDING','GENERATED','SKIPPED','FAILED','REVERSED')),
      rule_code          TEXT,
      template_id        TEXT,
      voucher_id         TEXT,
      attempt_count      INTEGER NOT NULL DEFAULT 0,
      last_error_code    TEXT,
      last_error_message TEXT,
      skip_reason        TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      UNIQUE(event_type, source_type, source_id, source_item_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_event_attempts (
      id            TEXT PRIMARY KEY,
      event_id      TEXT NOT NULL,
      attempt_no    INTEGER NOT NULL,
      outcome       TEXT NOT NULL CHECK(outcome IN ('SUCCESS','FAILED','SKIPPED')),
      error_code    TEXT,
      error_message TEXT,
      voucher_id    TEXT,
      created_at    TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_reconciliation_runs (
      id          TEXT PRIMARY KEY,
      run_key     TEXT NOT NULL UNIQUE,
      period      TEXT,
      as_of_date  TEXT NOT NULL,
      status      TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      created_by  TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_reconciliation_items (
      id               TEXT PRIMARY KEY,
      run_id           TEXT NOT NULL,
      check_code       TEXT NOT NULL,
      severity         TEXT NOT NULL CHECK(severity IN ('BLOCKING','WARNING','INFO')),
      status           TEXT NOT NULL CHECK(status IN ('PASS','FAIL')),
      difference_cents INTEGER NOT NULL DEFAULT 0,
      affected_json    TEXT,
      explanation      TEXT NOT NULL,
      UNIQUE(run_id, check_code)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_close_check_snapshots (
      id            TEXT PRIMARY KEY,
      period        TEXT NOT NULL,
      closure_id    TEXT,
      checklist_json TEXT NOT NULL,
      passed        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_accounting_events_status ON accounting_events(status, period)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounting_events_source ON accounting_events(source_type, source_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounting_event_attempts_event ON accounting_event_attempts(event_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounting_close_check_snapshots_period ON accounting_close_check_snapshots(period)');

  // Defensive: a pre-existing database created by an earlier build of this
  // migration may lack the NOT NULL default on source_item_id.
  addColumn(db, 'ALTER TABLE accounting_events ADD COLUMN source_item_id TEXT NOT NULL DEFAULT \'\'');

  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions(code, name) VALUES (?, ?)');
  for (const permission of NEW_PERMISSIONS) insertPermission.run(...permission);

  const grant = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)');
  for (const [code] of NEW_PERMISSIONS) grant.run('role-admin', code);
  for (const code of ROLE_ACCOUNTING_GRANTS) grant.run('role-accounting', code);
}
