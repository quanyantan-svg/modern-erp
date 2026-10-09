// V1.6-OUT — Procurement & Outsourcing final-acceptance additive closure.
//
// Scope (per AGENTS.md §4: additive only, idempotent, no rewrite):
//   * OUT-05  planning handoff exactly-once consumption columns
//   * OUT-17  OUTSOURCE discriminator on receipt_notices / receipt_notice_items
//   * OUT-18  OUTSOURCING_RECEIPT canonical Quality source adapter columns
//
// Strict non-scope: no DROP, no rewrite of historical rows, no migration of
// business tables outside the four canonical tables touched by this file.
// Idempotent on every column / index addition; rerun-safe.

function safeAddColumn(db, table, ddl) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); }
  catch (_error) { /* already present */ }
}

function safeIndex(db, sql) {
  try { db.exec(sql); } catch (_error) { /* already exists */ }
}

export function migrateV14OutProcurementFinalAcceptance(db) {
  // ---- OUT-05: planning_outsource_handoffs exactly-once consumption ----
  safeAddColumn(db, 'planning_outsource_handoffs', "target_outsourcing_order_id TEXT");
  safeAddColumn(db, 'planning_outsource_handoffs', "consumed_at TEXT");
  safeAddColumn(db, 'planning_outsource_handoffs', "consumed_by TEXT");
  // Status already includes PENDING/ACCEPTED/CANCELLED in legacy schema;
  // we need CONSUMED as the canonical consumer-side state. SQLite cannot
  // ALTER a CHECK constraint — the constraint is updated by recreating
  // the table when missing. The legacy 'ACCEPTED' state is preserved so
  // historical rows remain readable; new outbound flow uses 'CONSUMED'.
  const handoffSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='planning_outsource_handoffs'").get()?.sql || '';
  if (!/CONSUMED/.test(handoffSql)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS planning_outsource_handoffs_new (
        id TEXT PRIMARY KEY,
        planned_order_id TEXT NOT NULL UNIQUE,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        need_date TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','CONSUMED','CANCELLED')),
        target_outsourcing_order_id TEXT,
        consumed_at TEXT,
        consumed_by TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(planned_order_id) REFERENCES planned_orders(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(created_by) REFERENCES users(id),
        FOREIGN KEY(target_outsourcing_order_id) REFERENCES outsourcing_orders(id),
        FOREIGN KEY(consumed_by) REFERENCES users(id)
      );
    `);
    db.exec(`INSERT INTO planning_outsource_handoffs_new(id,planned_order_id,product_id,quantity,need_date,status,target_outsourcing_order_id,consumed_at,consumed_by,created_by,created_at)
      SELECT id,planned_order_id,product_id,quantity,need_date,status,target_outsourcing_order_id,consumed_at,consumed_by,created_by,created_at FROM planning_outsource_handoffs`);
    db.exec('DROP TABLE planning_outsource_handoffs');
    db.exec('ALTER TABLE planning_outsource_handoffs_new RENAME TO planning_outsource_handoffs');
    safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_planning_outsource_handoffs_status ON planning_outsource_handoffs(status)');
    safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_planning_outsource_handoffs_target ON planning_outsource_handoffs(target_outsourcing_order_id)');
  } else {
    safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_planning_outsource_handoffs_status ON planning_outsource_handoffs(status)');
    safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_planning_outsource_handoffs_target ON planning_outsource_handoffs(target_outsourcing_order_id)');
  }

  // ---- OUT-17: receipt_notices OUTSOURCE discriminator ----
  // purchase_order_id is left in place for STANDARD_PURCHASE rows (legacy FK).
  // For OUTSOURCE rows we capture outsourcing_order_id + processing_po_id.
  // The legacy CHECK keeps 'STANDARD_PURCHASE' / 'OUTSOURCE' enum.
  safeAddColumn(db, 'receipt_notices', "outsourcing_order_id TEXT");
  safeAddColumn(db, 'receipt_notices', "processing_po_id TEXT");
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_receipt_notices_outsourcing_order ON receipt_notices(outsourcing_order_id)');
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_receipt_notices_business_type ON receipt_notices(business_type)');

  safeAddColumn(db, 'receipt_notice_items', "outsourcing_order_id TEXT");
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_receipt_notice_items_outsourcing_order ON receipt_notice_items(outsourcing_order_id)');

  // ---- OUT-18: IQC source-type OUTSOURCING_RECEIPT ----
  safeAddColumn(db, 'iqc_inspections', "outsourcing_receipt_id TEXT");
  safeAddColumn(db, 'iqc_inspections', "outsourcing_order_id TEXT");
  safeAddColumn(db, 'iqc_inspections', "source_type TEXT NOT NULL DEFAULT 'PURCHASE_RECEIPT'");
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_iqc_inspections_outsourcing_receipt ON iqc_inspections(outsourcing_receipt_id)');
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_iqc_inspections_source_type ON iqc_inspections(source_type)');
  // source_type on oqc_inspections lets create() keep its INSERT shape
  // uniform across IQC + OQC; the value is always 'SALES_DELIVERY' today.
  safeAddColumn(db, 'oqc_inspections', "source_type TEXT NOT NULL DEFAULT 'SALES_DELIVERY'");
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_oqc_inspections_source_type ON oqc_inspections(source_type)');

  // Expand logistics_quality_policy_snapshots CHECK to include the new
  // OUTSOURCING_RECEIPT discriminator. The legacy table only allowed
  // PURCHASE_RECEIPT / SALES_DELIVERY which would 409 any OUTSOURCING
  // policy freeze (defeating freezeQualityPolicy from authoritative-quality).
  // Migration is idempotent: skip when OUTSOURCING_RECEIPT already present.
  const lqpsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='logistics_quality_policy_snapshots'").get()?.sql || '';
  if (!/OUTSOURCING_RECEIPT/.test(lqpsSql)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS logistics_quality_policy_snapshots_new (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('PURCHASE_RECEIPT','SALES_DELIVERY','OUTSOURCING_RECEIPT')),
        source_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        qcp_id TEXT REFERENCES quality_control_points(id),
        qcp_version INTEGER,
        inspection_required INTEGER NOT NULL CHECK(inspection_required IN (0,1)),
        sampling_mode TEXT NOT NULL,
        sampling_value REAL,
        waiver_reason TEXT,
        resolved_at TEXT NOT NULL,
        UNIQUE(source_type,source_item_id)
      );
    `);
    db.exec(`INSERT INTO logistics_quality_policy_snapshots_new(id,source_type,source_id,source_item_id,product_id,qcp_id,qcp_version,inspection_required,sampling_mode,sampling_value,waiver_reason,resolved_at)
      SELECT id,source_type,source_id,source_item_id,product_id,qcp_id,qcp_version,inspection_required,sampling_mode,sampling_value,waiver_reason,resolved_at FROM logistics_quality_policy_snapshots`);
    db.exec('DROP TABLE logistics_quality_policy_snapshots');
    db.exec('ALTER TABLE logistics_quality_policy_snapshots_new RENAME TO logistics_quality_policy_snapshots');
    safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_quality_snapshot_source ON logistics_quality_policy_snapshots(source_type,source_id)');
  }

  // Add canonical source-item FK column to support OUTSOURCING_RECEIPT on
  // iqc_inspection_items. The legacy table lacked an explicit
  // outsourcing_receipt_item_id FK, so we add it as nullable.
  safeAddColumn(db, 'iqc_inspection_items', "outsourcing_receipt_item_id TEXT");
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_iqc_inspection_items_outsourcing_item ON iqc_inspection_items(outsourcing_receipt_item_id)');
}
