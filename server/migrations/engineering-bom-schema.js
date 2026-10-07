// V17 Master & Engineering Domain Closure — Wave B: BOM Governance.
//
// Adds additive columns to `boms` and `bom_items`:
//   boms.purpose, effective_from, effective_to, approval_status, approved_by,
//          approved_at, change_request_id.
//   bom_items.is_selectable, is_replaceable, is_modifiable, config_group,
//             config_constraint, eco_change_id, source_change_id.
//
// All migrations are idempotent. Existing rows are backfilled with safe
// defaults so the legacy ACTIVE / DISCONTINUED path keeps producing results.

function columnExists(db, table, column) {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  return pragma.some((row) => row.name === column);
}

function safeAddColumn(db, table, column, ddl) {
  if (columnExists(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function migrateEngineeringBomSchema(db) {
  if (tableExists(db, 'boms')) {
    safeAddColumn(db, 'boms', 'purpose', "purpose TEXT NOT NULL DEFAULT 'GENERAL' CHECK(purpose IN ('GENERAL','SELF_MAKE','OUTSOURCE'))");
    safeAddColumn(db, 'boms', 'effective_from', 'effective_from TEXT');
    safeAddColumn(db, 'boms', 'effective_to', 'effective_to TEXT');
    safeAddColumn(db, 'boms', 'approval_status', "approval_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(approval_status IN ('DRAFT','PENDING','APPROVED','REJECTED','WITHDRAWN'))");
    safeAddColumn(db, 'boms', 'approved_by', 'approved_by TEXT');
    safeAddColumn(db, 'boms', 'approved_at', 'approved_at TEXT');
    safeAddColumn(db, 'boms', 'change_request_id', 'change_request_id TEXT');

    // Backfill: legacy rows that were implicitly ACTIVE without an
    // approval_status get APPROVED with approved_at=created_at so the
    // resolver contract (ACTIVE + APPROVED) remains valid without
    // rewriting history. Only NULL values are touched; existing
    // explicit statuses are preserved.
    db.exec(`UPDATE boms SET approval_status='APPROVED', approved_at=COALESCE(approved_at, created_at) WHERE approval_status IS NULL`);
  }
  if (tableExists(db, 'bom_items')) {
    safeAddColumn(db, 'bom_items', 'is_selectable', 'is_selectable INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'bom_items', 'is_replaceable', 'is_replaceable INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'bom_items', 'is_modifiable', 'is_modifiable INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'bom_items', 'config_group', 'config_group TEXT');
    safeAddColumn(db, 'bom_items', 'config_constraint', 'config_constraint TEXT NOT NULL DEFAULT ""');
    safeAddColumn(db, 'bom_items', 'eco_change_id', 'eco_change_id TEXT');
    safeAddColumn(db, 'bom_items', 'source_change_id', 'source_change_id TEXT');
  }

  // Indexes to keep the cycle / tree / where-used queries fast.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_boms_product_purpose_status
      ON boms(product_id, purpose, status, approval_status);
    CREATE INDEX IF NOT EXISTS idx_bom_items_product
      ON bom_items(product_id);
  `);
}