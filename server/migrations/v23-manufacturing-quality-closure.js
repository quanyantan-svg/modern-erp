// V23 Manufacturing & Quality Domain Closure — additive schema for the
// 2026-11-12 remediation round.
//
// Everything here is additive or a CHECK-constraint widening:
//   - production_order_operations: status gains 'OUTSOURCED' (the outsourced
//     boundary needs a state of its own; see Design §24.12) and the three
//     outsource hand-off columns.
//   - production_inspections: inspection_type gains the additional controlled
//     inspection kinds (Requirement §29.4 Product Inspection), plus the
//     sampling columns that let a production inspection reuse the QCP
//     sampling policy and the WAIVED provenance columns.
//   - inspection_plans: qcp_id links the plan to the quality control point
//     that says WHEN inspection is required and HOW MUCH to sample
//     (Requirement §29.4 Inspection Plan ↔ QCP when/what).
//   - production_order_items: material_list_remark carries the controlled-edit
//     note of a material list line (Requirement §29.4 Material List lifecycle).
//   - production_receipts: quality waiver provenance.
//
// All statements are idempotent. The MySQL backend derives its schema from a
// live SQLite snapshot (server/database/mysql-schema.js), so a widened CHECK
// constraint propagates to MySQL through the snapshot rather than through an
// in-place ALTER.

function columnExists(db, table, column) {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  return pragma.some((row) => row.name === column);
}

function addColumn(db, table, column, ddl) {
  if (columnExists(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
}

// The outsourced operation boundary needs a status of its own: the internal
// completion guard refuses OUTSOURCED operations, so the operation must be
// able to carry that state.
function extendOperationOutsourceStatus(db) {
  const sql = tableSql(db, 'production_order_operations');
  if (!sql) return;
  if (sql.includes("'OUTSOURCED'") && sql.includes('outsource_supplier_id')) return;
  db.exec('DROP TABLE IF EXISTS production_order_operations_v23_new');
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_order_operations_v23_new (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      routing_snapshot_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      operation_code TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      work_center_id TEXT,
      work_center_code TEXT NOT NULL DEFAULT '',
      work_center_name TEXT NOT NULL DEFAULT '',
      setup_seconds INTEGER NOT NULL DEFAULT 0 CHECK(setup_seconds >= 0),
      run_seconds_per_unit REAL NOT NULL DEFAULT 0 CHECK(run_seconds_per_unit >= 0),
      expected_yield_bps INTEGER NOT NULL DEFAULT 10000 CHECK(expected_yield_bps BETWEEN 0 AND 10000),
      labor_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(labor_rate_cents_per_hour >= 0),
      overhead_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(overhead_rate_cents_per_hour >= 0),
      daily_capacity_minutes INTEGER NOT NULL DEFAULT 480 CHECK(daily_capacity_minutes >= 0),
      planned_input_quantity REAL NOT NULL CHECK(planned_input_quantity >= 0),
      planned_date TEXT,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','SUBMITTED','APPROVED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED','SKIPPED','OUTSOURCED')),
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      plan_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(plan_status IN ('NOT_STARTED','SUBMITTED','APPROVED','RELEASED','EXECUTABLE')),
      plan_submitted_by TEXT,
      plan_submitted_at TEXT,
      plan_approved_by TEXT,
      plan_approved_at TEXT,
      plan_released_by TEXT,
      plan_released_at TEXT,
      control_code_id TEXT,
      control_code TEXT NOT NULL DEFAULT '',
      control_participates_scheduling INTEGER NOT NULL DEFAULT 1,
      control_reporting_method TEXT NOT NULL DEFAULT 'MANUAL',
      control_inspection_method TEXT NOT NULL DEFAULT 'NONE',
      is_outsource INTEGER NOT NULL DEFAULT 0,
      quality_policy TEXT NOT NULL DEFAULT 'NONE',
      topology TEXT NOT NULL DEFAULT 'LINEAR' CHECK(topology IN ('LINEAR','NETWORK','PARALLEL','SPLIT','MERGE','ALTERNATE')),
      topology_meta TEXT NOT NULL DEFAULT '{}',
      outsource_supplier_id TEXT,
      outsource_handed_off_by TEXT,
      outsource_handed_off_at TEXT,
      UNIQUE(production_order_id, sequence_no),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (routing_snapshot_id) REFERENCES production_order_routing_snapshots(id),
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id),
      FOREIGN KEY (outsource_supplier_id) REFERENCES suppliers(id)
    );
  `);
  const columns = db.prepare('PRAGMA table_info(production_order_operations)').all().map((row) => row.name);
  const shared = columns.filter((name) => !['outsource_supplier_id', 'outsource_handed_off_by', 'outsource_handed_off_at'].includes(name));
  const list = shared.map((name) => `"${name}"`).join(',');
  db.exec(`INSERT INTO production_order_operations_v23_new (${list}) SELECT ${list} FROM production_order_operations`);
  db.exec('DROP TABLE production_order_operations');
  db.exec('ALTER TABLE production_order_operations_v23_new RENAME TO production_order_operations');
  db.exec('CREATE INDEX IF NOT EXISTS idx_production_order_operations_order ON production_order_operations(production_order_id, sequence_no)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_production_order_operations_capacity ON production_order_operations(work_center_id, planned_date)');
}

// The inspection kind becomes a controlled vocabulary the server validates,
// and the inspection carries the sampling decision it was created under plus
// the provenance of a WAIVED result.
function extendProductionInspectionVocabulary(db) {
  const sql = tableSql(db, 'production_inspections');
  if (!sql) return;
  if (!sql.includes("'FIRST_ARTICLE'") && !sql.includes('sampling_mode')) {
    db.exec('DROP TABLE IF EXISTS production_inspections_v23_new');
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_inspections_v23_new (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        production_order_id TEXT NOT NULL,
        production_operation_id TEXT,
        source_type TEXT NOT NULL CHECK(source_type IN ('OPERATION_REPORT','PRODUCTION_RECEIPT')),
        source_id TEXT NOT NULL,
        plan_id TEXT,
        inspection_type TEXT NOT NULL DEFAULT 'NORMAL' CHECK(inspection_type IN ('NORMAL','SAMPLING','FULL','FIRST_ARTICLE','PATROL','FINAL','REGRESSION','REWORK')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED','CANCELLED')),
        result TEXT,
        business_date TEXT NOT NULL,
        inspector_id TEXT,
        creator_id TEXT,
        confirmed_at TEXT,
        cancelled_at TEXT,
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sampling_mode TEXT NOT NULL DEFAULT 'FULL',
        sampling_value REAL,
        sample_quantity REAL,
        waived_by TEXT,
        waived_at TEXT,
        waive_reason TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (production_operation_id) REFERENCES production_order_operations(id),
        FOREIGN KEY (plan_id) REFERENCES inspection_plans(id),
        FOREIGN KEY (inspector_id) REFERENCES users(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (waived_by) REFERENCES users(id)
      );
    `);
    const columns = db.prepare('PRAGMA table_info(production_inspections)').all().map((row) => row.name);
    const added = ['sampling_mode', 'sampling_value', 'sample_quantity', 'waived_by', 'waived_at', 'waive_reason'];
    const shared = columns.filter((name) => !added.includes(name));
    const list = shared.map((name) => `"${name}"`).join(',');
    db.exec(`INSERT INTO production_inspections_v23_new (${list}) SELECT ${list} FROM production_inspections`);
    db.exec('DROP TABLE production_inspections');
    db.exec('ALTER TABLE production_inspections_v23_new RENAME TO production_inspections');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_inspections_order ON production_inspections(production_order_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_inspections_source ON production_inspections(source_type, source_id)');
    return;
  }
  addColumn(db, 'production_inspections', 'sampling_mode', "sampling_mode TEXT NOT NULL DEFAULT 'FULL'");
  addColumn(db, 'production_inspections', 'sampling_value', 'sampling_value REAL');
  addColumn(db, 'production_inspections', 'sample_quantity', 'sample_quantity REAL');
  addColumn(db, 'production_inspections', 'waived_by', 'waived_by TEXT');
  addColumn(db, 'production_inspections', 'waived_at', 'waived_at TEXT');
  addColumn(db, 'production_inspections', 'waive_reason', "waive_reason TEXT NOT NULL DEFAULT ''");
}

export function migrateV23ManufacturingQualityClosure(db) {
  extendOperationOutsourceStatus(db);
  extendProductionInspectionVocabulary(db);
  addColumn(db, 'inspection_plans', 'qcp_id', 'qcp_id TEXT');
  addColumn(db, 'production_order_items', 'material_list_remark', "material_list_remark TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'production_order_items', 'material_list_edited_at', 'material_list_edited_at TEXT');
  addColumn(db, 'production_receipts', 'quality_waived_by', 'quality_waived_by TEXT');
  addColumn(db, 'production_receipts', 'quality_waived_at', 'quality_waived_at TEXT');
  addColumn(db, 'production_receipts', 'quality_waive_reason', "quality_waive_reason TEXT NOT NULL DEFAULT ''");
  // The operation transfer record: the audit trail of a quantity handed from
  // one operation to the next (Requirement §29.4 Operation Transfer Scan).
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_operation_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      production_order_id TEXT NOT NULL,
      source_operation_id TEXT NOT NULL,
      target_operation_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      business_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (source_operation_id) REFERENCES production_order_operations(id),
      FOREIGN KEY (target_operation_id) REFERENCES production_order_operations(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_production_operation_transfers_source ON production_operation_transfers(source_operation_id, status);
    CREATE INDEX IF NOT EXISTS idx_production_operation_transfers_order ON production_operation_transfers(production_order_id);
  `);
}
