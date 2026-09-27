// V1.4-E2 — authoritative business-date columns + canonical CONFIRM permission.
//
// Implements solution.md §21.4.2 + §21.8 + §21.12 for the inventory family:
//   * `inventory_transfers.business_date` — nullable, idempotent column
//     addition. Legacy rows keep NULL and are reported as "业务日期缺失"
//     by the DTO layer; no created_at / updated_at backfill is performed.
//   * `inventory_checks.business_date` — same shape and intent for stocktake.
//   * `INVENTORY_TRANSFER_CONFIRM` permission code — seeded via the existing
//     PERMISSIONS array; canonical WAREHOUSE role gains the new permission.
//     `INVENTORY_TRANSFER_APPROVE` remains a deprecated compatibility alias
//     and continues to satisfy the confirm capability check (per §21.8.1).
//
// Strict scope (V1.4-E2 only):
//   * No `production_orders.completion_date` column.
//   * No `inventory_transactions.business_date_origin` column.
//   * No `period_key = closedThroughDate` semantics — E3 owns that.
//   * No automatic rewrite of legacy SUBMITTED / APPROVED transfer statuses.
//
// Idempotency: every DDL uses `IF NOT EXISTS` or guarded ALTER; reruns must
// not duplicate permissions, columns, or backfill NULL values with timestamps.

export function migrateV14E2BusinessDate(db) {
  // 1. inventory_transfers.business_date
  addNullableTextColumn(db, 'inventory_transfers', 'business_date');

  // 2. inventory_checks.business_date
  addNullableTextColumn(db, 'inventory_checks', 'business_date');
}

// Helper that mirrors the existing `addColumn` pattern in server/db.js but
// keeps the migration self-contained and observable in test logs.
function addNullableTextColumn(db, table, column) {
  // SQLite stores dates as TEXT per the canonical snapshot. The MySQL adapter
  // maps nullable TEXT to LONGTEXT, which is acceptable for a YYYY-MM-DD
  // string. New transfers / checks must populate the column at write time;
  // legacy rows retain NULL.
  const probe = db.prepare(`PRAGMA table_info(${table})`).all();
  if (probe.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

export function ensureV14E2ConfirmPermission(db) {
  // Idempotent permission seed: INSERT OR IGNORE on permissions table;
  // no duplicate creation on rerun.
  const probe = db.prepare('SELECT 1 FROM permissions WHERE code=?').get('INVENTORY_TRANSFER_CONFIRM');
  if (probe) return false;
  db.prepare('INSERT INTO permissions(code, name) VALUES (?, ?)').run('INVENTORY_TRANSFER_CONFIRM', '确认库存调拨');
  return true;
}

export function ensureV14E2CanonicalRolePermissions(db) {
  // Grant INVENTORY_TRANSFER_CONFIRM to the canonical WAREHOUSE role and
  // ensure ADMIN retains its full-permission set (reconciliation handles
  // ADMIN's wildcard grant elsewhere). Other roles are NOT given the
  // capability, matching §21.8.1: SALES, REVIEWER, ACCOUNTING must not
  // be able to confirm inventory transfer execution.
  db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)')
    .run('role-warehouse', 'INVENTORY_TRANSFER_CONFIRM');
}