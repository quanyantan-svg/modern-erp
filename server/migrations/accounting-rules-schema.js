// Accounting & Analytics Domain Closure — AA-W2 voucher template & rule schema.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.2 AA-W2.1..AA-W2.9
// Design:    docs/design/accounting-analytics.md §31.2.1 / §31.8.1 / §31.8.2
//
// Additive + idempotent + SQLite / MySQL parity:
//   - `voucher_templates` gains the version / validity / condition columns.
//   - `voucher_template_items` is the normalized line-item table. The legacy
//     `entries_json` column is **kept** so the normalization stays reversible
//     (§31.8.2): unparseable legacy items are marked LEGACY_UNRESOLVED and
//     are never silently dropped.
//   - `accounting_rule_bindings` expresses the business-type → template
//     mapping as data, not as code (AA-W2.4).
//   - `accounting_generation_runs` records batch / scheduled generation
//     outcomes (AA-W2.8).
//
// All statements use only SQLite-compatible DDL; the MySQL bootstrap derives
// its schema from the same SQLite snapshot.

function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    const message = String(error.message || '').toLowerCase();
    if (!message.includes('duplicate column name') && !message.includes("already exists")) throw error;
  }
}

export function migrateAccountingRulesSchema(db) {
  // ---- voucher_templates extensions (AA-W2.3) ----
  addColumn(db, "ALTER TABLE voucher_templates ADD COLUMN version_no INTEGER NOT NULL DEFAULT 1");
  addColumn(db, 'ALTER TABLE voucher_templates ADD COLUMN valid_from TEXT');
  addColumn(db, 'ALTER TABLE voucher_templates ADD COLUMN valid_to TEXT');
  addColumn(db, "ALTER TABLE voucher_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
  addColumn(db, 'ALTER TABLE voucher_templates ADD COLUMN condition_expr TEXT');
  addColumn(db, 'ALTER TABLE voucher_templates ADD COLUMN dimension_json TEXT');
  addColumn(db, 'ALTER TABLE voucher_templates ADD COLUMN updated_at TEXT');

  // ---- normalized template items (AA-W2.1 / AA-W2.2) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS voucher_template_items (
      id             TEXT PRIMARY KEY,
      template_id    TEXT NOT NULL,
      line_no        INTEGER NOT NULL,
      summary        TEXT NOT NULL DEFAULT '',
      accounting_role TEXT NOT NULL DEFAULT '',
      subject_id     TEXT,
      direction      TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
      amount_source  TEXT NOT NULL DEFAULT '',
      amount_expr    TEXT,
      dimension_json TEXT,
      parse_status   TEXT NOT NULL DEFAULT 'RESOLVED'
                     CHECK(parse_status IN ('RESOLVED','LEGACY_UNRESOLVED')),
      UNIQUE(template_id, line_no)
    );
  `);

  // ---- rule bindings (AA-W2.4 / AA-W2.5) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_rule_bindings (
      id          TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      template_id TEXT NOT NULL,
      valid_from  TEXT NOT NULL,
      valid_to    TEXT,
      priority    INTEGER NOT NULL DEFAULT 100,
      status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounting_rule_bindings_match ON accounting_rule_bindings(source_type, event_type, status)');

  // ---- generation runs (AA-W2.8) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_generation_runs (
      id            TEXT PRIMARY KEY,
      run_type      TEXT NOT NULL CHECK(run_type IN ('SCHEDULED','BATCH','MANUAL')),
      period        TEXT,
      status        TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
      total_count   INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count  INTEGER NOT NULL DEFAULT 0,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      created_by    TEXT NOT NULL
    );
  `);

  // ---- accounting event source amount snapshot ----
  // The generation may happen long after the business fact was confirmed, so
  // the event carries an immutable snapshot of the source amounts. This keeps
  // the generated voucher tied to the fact as it was, not to a later re-read
  // of a mutable business document.
  addColumn(db, 'ALTER TABLE accounting_events ADD COLUMN source_amount_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE accounting_events ADD COLUMN source_tax_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE accounting_events ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0');

  // AA-W2 permissions. `VOUCHER_TEMPLATES_VIEW` / `_MANAGE` already exist in
  // the canonical permission table; the grants here converge an existing
  // database onto the same role contract as a fresh database.
  const grant = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)');
  for (const code of ['VOUCHER_TEMPLATES_VIEW', 'VOUCHER_TEMPLATES_MANAGE']) {
    grant.run('role-admin', code);
    grant.run('role-accounting', code);
  }
}

