// Accounting & Analytics Domain Closure — AA-W4 报表平台 schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.4
//   AA-W4.1..AA-W4.13
// Design:    docs/design/accounting-analytics.md §31.4 / §31.8
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

export function migrateAccountingReportingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_templates (
      id TEXT PRIMARY KEY,
      template_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'accounting-analytics',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      version_no INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_report_templates_status ON report_templates(status, template_code);

    CREATE TABLE IF NOT EXISTS report_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      name TEXT NOT NULL,
      level_no INTEGER NOT NULL DEFAULT 1,
      sort_no INTEGER NOT NULL,
      source_kind TEXT NOT NULL,
      source_json TEXT NOT NULL,
      formula_expr TEXT,
      is_total INTEGER NOT NULL DEFAULT 0,
      unit TEXT,
      dimension_json TEXT,
      UNIQUE(template_id, item_code)
    );
    CREATE INDEX IF NOT EXISTS idx_report_template_items_template ON report_template_items(template_id, sort_no);

    CREATE TABLE IF NOT EXISTS report_template_permissions (
      template_id TEXT NOT NULL,
      permission_code TEXT NOT NULL,
      PRIMARY KEY(template_id, permission_code)
    );

    CREATE TABLE IF NOT EXISTS report_instances (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL,
      version_no INTEGER NOT NULL DEFAULT 1,
      computed_at TEXT,
      submitted_at TEXT,
      submitted_by TEXT,
      approved_at TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(template_id, period, version_no)
    );
    CREATE INDEX IF NOT EXISTS idx_report_instances_period ON report_instances(period, template_id, version_no);

    CREATE TABLE IF NOT EXISTS report_instance_values (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      value_cents INTEGER,
      value_text TEXT,
      formula_text TEXT,
      error_code TEXT,
      error_message TEXT,
      UNIQUE(instance_id, item_code)
    );
    CREATE INDEX IF NOT EXISTS idx_report_instance_values_instance ON report_instance_values(instance_id, item_code);
  `);
}
