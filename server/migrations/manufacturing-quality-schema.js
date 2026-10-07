// V18 Manufacturing & Quality Domain Closure — additive schema.
//
// All changes are additive only:
//  - New tables:  inspection_items, inspection_detection_values,
//    inspection_instruments, inspection_plans, inspection_plan_items,
//    production_inspections, production_inspection_items,
//    production_material_supplements, production_material_supplement_items,
//    production_batch_issues, production_batch_issue_orders,
//    production_batch_issue_items, production_byproducts, production_byproduct_receipts.
//  - Additive columns on existing tables:
//      production_orders: extend status enum + lifecycle columns + material list lifecycle
//      production_order_items: material_list_status (additive)
//      production_order_operations: plan_status + control_code snapshot fields
//                                   + is_outsource / quality_policy / topology
//      production_material_returns: reason_code
//      production_receipts: quality_state / quality_inspection_id / nonconforming
//      production_operation_reports: released_quantity / inspection_id
//
//  All idempotent.

function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    const message = String(error.message || '').toLowerCase();
    if (!message.includes('duplicate column name') && !message.includes('already exists')) throw error;
  }
}

function extendProductionOrdersStatus(db) {
  // Rebuild CHECK constraint to include new lifecycle values.
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_orders'").get()?.sql || '';
  if (sql.includes("'SUBMITTED'") && sql.includes("'RELEASED'")) return;
  try {
    db.exec('DROP TABLE IF EXISTS production_orders_new');
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_orders_new (
        id TEXT PRIMARY KEY,
        order_no TEXT NOT NULL UNIQUE,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('DRAFT','PENDING','SUBMITTED','APPROVED','REJECTED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')),
        planned_start TEXT,
        planned_finish TEXT,
        actual_start TEXT,
        actual_finish TEXT,
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        bom_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'MANUAL',
        production_instruction_id TEXT,
        production_instruction_item_id TEXT,
        bom_version_snapshot TEXT NOT NULL DEFAULT '',
        routing_id_snapshot TEXT,
        routing_version_snapshot TEXT NOT NULL DEFAULT '',
        submitted_by TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        released_by TEXT,
        released_at TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        rejection_reason TEXT NOT NULL DEFAULT '',
        material_list_status TEXT NOT NULL DEFAULT 'GENERATED',
        material_list_approved_by TEXT,
        material_list_approved_at TEXT,
        material_list_released_by TEXT,
        material_list_released_at TEXT,
        FOREIGN KEY (creator_id) REFERENCES users(id)
      );
    `);
    db.exec(`INSERT INTO production_orders_new
      (id,order_no,product_id,quantity,status,planned_start,planned_finish,actual_start,actual_finish,remark,creator_id,created_at,updated_at,bom_id,source_type,production_instruction_id,production_instruction_item_id,bom_version_snapshot,routing_id_snapshot,routing_version_snapshot)
      SELECT id,order_no,product_id,quantity,CASE WHEN status='PENDING' THEN 'SUBMITTED' ELSE status END,planned_start,planned_finish,actual_start,actual_finish,remark,creator_id,created_at,updated_at,bom_id,source_type,production_instruction_id,production_instruction_item_id,bom_version_snapshot,routing_id_snapshot,routing_version_snapshot
      FROM production_orders`);
    db.exec('DROP TABLE production_orders');
    db.exec('ALTER TABLE production_orders_new RENAME TO production_orders');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_orders_product ON production_orders(product_id)');
  } catch (e) {
    throw new Error(`migrateProductionOrdersStatus failed: ${e.message}`, { cause: e });
  }
}

function extendProductionOrderOperationsStatus(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_order_operations'").get()?.sql || '';
  if (sql.includes("'SUBMITTED'") && sql.includes("'SKIPPED'")) return;
  try {
    db.exec('DROP TABLE IF EXISTS production_order_operations_new');
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_order_operations_new (
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
        run_seconds_per_unit INTEGER NOT NULL DEFAULT 0 CHECK(run_seconds_per_unit >= 0),
        expected_yield_bps INTEGER NOT NULL DEFAULT 10000 CHECK(expected_yield_bps BETWEEN 0 AND 10000),
        labor_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(labor_rate_cents_per_hour >= 0),
        overhead_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(overhead_rate_cents_per_hour >= 0),
        daily_capacity_minutes INTEGER NOT NULL DEFAULT 480 CHECK(daily_capacity_minutes >= 0),
        planned_input_quantity REAL NOT NULL CHECK(planned_input_quantity >= 0),
        planned_date TEXT,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','SUBMITTED','APPROVED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED','SKIPPED')),
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
        UNIQUE(production_order_id, sequence_no),
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (routing_snapshot_id) REFERENCES production_order_routing_snapshots(id),
        FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
      );
    `);
    db.exec(`INSERT INTO production_order_operations_new
      (id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_id,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,completed_by,completed_at,created_at,updated_at)
      SELECT id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_id,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,completed_by,completed_at,created_at,updated_at
      FROM production_order_operations`);
    db.exec('DROP TABLE production_order_operations');
    db.exec('ALTER TABLE production_order_operations_new RENAME TO production_order_operations');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_order_operations_order ON production_order_operations(production_order_id, sequence_no)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_production_order_operations_capacity ON production_order_operations(work_center_id, planned_date)');
  } catch (e) {
    throw new Error(`extendProductionOrderOperationsStatus failed: ${e.message}`, { cause: e });
  }
}

export function migrateManufacturingQualitySchema(db) {
  // 1) Production orders lifecycle extension
  extendProductionOrdersStatus(db);
  // additive columns
  addColumn(db, "ALTER TABLE production_order_items ADD COLUMN material_list_status TEXT NOT NULL DEFAULT 'GENERATED'");
  addColumn(db, 'ALTER TABLE production_material_returns ADD COLUMN reason_code TEXT NOT NULL DEFAULT ""');
  addColumn(db, "ALTER TABLE production_receipts ADD COLUMN quality_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED'");
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN quality_inspection_id TEXT');
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN quality_plan_id TEXT');
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN nonconforming INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN nonconforming_reason TEXT NOT NULL DEFAULT ""');
  addColumn(db, 'ALTER TABLE production_receipts ADD COLUMN byproduct_header_id TEXT');
  addColumn(db, "ALTER TABLE production_operation_reports ADD COLUMN released_quantity REAL NOT NULL DEFAULT 0");
  addColumn(db, 'ALTER TABLE production_operation_reports ADD COLUMN inspection_id TEXT');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN control_code_id TEXT');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN control_code TEXT NOT NULL DEFAULT ""');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN control_participates_scheduling INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN control_reporting_method TEXT NOT NULL DEFAULT "MANUAL"');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN control_inspection_method TEXT NOT NULL DEFAULT "NONE"');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN is_outsource INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN quality_policy TEXT NOT NULL DEFAULT "NONE"');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN topology TEXT NOT NULL DEFAULT "LINEAR"');

  // 2) Production order operations plan_status + control code snapshot
  extendProductionOrderOperationsStatus(db);

  // 3) New tables
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inspection_items (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        analysis_method TEXT NOT NULL DEFAULT '',
        standard TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inspection_items_code ON inspection_items(code);
      CREATE INDEX IF NOT EXISTS idx_inspection_items_active ON inspection_items(active);

      CREATE TABLE IF NOT EXISTS inspection_detection_values (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES inspection_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_inspection_detection_values_item_id ON inspection_detection_values(item_id);

      CREATE TABLE IF NOT EXISTS inspection_instruments (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        specification TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inspection_instruments_code ON inspection_instruments(code);

      CREATE TABLE IF NOT EXISTS inspection_plans (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('PRODUCT','MATERIAL')),
        target_id TEXT,
        product_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_inspection_plans_target ON inspection_plans(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_inspection_plans_product ON inspection_plans(product_id);

      CREATE TABLE IF NOT EXISTS inspection_plan_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        criterion_name TEXT NOT NULL,
        specification TEXT NOT NULL DEFAULT '',
        result_type TEXT NOT NULL DEFAULT 'PASS_FAIL' CHECK(result_type IN ('PASS_FAIL','NUMERIC','TEXT')),
        min_value REAL,
        max_value REAL,
        unit TEXT NOT NULL DEFAULT '',
        instrument_id TEXT,
        required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(plan_id, sequence),
        FOREIGN KEY (plan_id) REFERENCES inspection_plans(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES inspection_items(id),
        FOREIGN KEY (instrument_id) REFERENCES inspection_instruments(id)
      );
      CREATE INDEX IF NOT EXISTS idx_inspection_plan_items_plan ON inspection_plan_items(plan_id);

      CREATE TABLE IF NOT EXISTS production_inspections (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        production_order_id TEXT NOT NULL,
        production_operation_id TEXT,
        source_type TEXT NOT NULL CHECK(source_type IN ('OPERATION_REPORT','PRODUCTION_RECEIPT')),
        source_id TEXT NOT NULL,
        plan_id TEXT,
        inspection_type TEXT NOT NULL DEFAULT 'NORMAL' CHECK(inspection_type IN ('NORMAL','SAMPLING','FULL')),
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
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (production_operation_id) REFERENCES production_order_operations(id),
        FOREIGN KEY (plan_id) REFERENCES inspection_plans(id),
        FOREIGN KEY (inspector_id) REFERENCES users(id),
        FOREIGN KEY (creator_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_production_inspections_order ON production_inspections(production_order_id, status);
      CREATE INDEX IF NOT EXISTS idx_production_inspections_operation ON production_inspections(production_operation_id);
      CREATE INDEX IF NOT EXISTS idx_production_inspections_source ON production_inspections(source_type, source_id);

      CREATE TABLE IF NOT EXISTS production_inspection_items (
        id TEXT PRIMARY KEY,
        inspection_id TEXT NOT NULL,
        plan_item_id TEXT,
        criterion_name TEXT NOT NULL,
        specification TEXT NOT NULL DEFAULT '',
        result_type TEXT NOT NULL DEFAULT 'PASS_FAIL',
        min_value REAL,
        max_value REAL,
        unit TEXT NOT NULL DEFAULT '',
        instrument_id TEXT,
        pass_fail_result TEXT,
        numeric_result REAL,
        text_result TEXT,
        passed INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (inspection_id) REFERENCES production_inspections(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_item_id) REFERENCES inspection_plan_items(id),
        FOREIGN KEY (instrument_id) REFERENCES inspection_instruments(id)
      );
      CREATE INDEX IF NOT EXISTS idx_production_inspection_items_insp ON production_inspection_items(inspection_id);

      CREATE TABLE IF NOT EXISTS production_material_supplements (
        id TEXT PRIMARY KEY,
        supplement_no TEXT NOT NULL UNIQUE,
        production_order_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('MANUAL','RETURN_LINK')),
        source_id TEXT,
        warehouse_id TEXT NOT NULL,
        reason_code TEXT NOT NULL CHECK(reason_code IN ('SHORTAGE','YIELD_LOSS','QUALITY_REPLACEMENT','OTHER')),
        remark TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
        supplement_date TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pms_order ON production_material_supplements(production_order_id, status);

      CREATE TABLE IF NOT EXISTS production_material_supplement_items (
        id TEXT PRIMARY KEY,
        supplement_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        before_quantity REAL,
        after_quantity REAL,
        line_no INTEGER NOT NULL,
        FOREIGN KEY (supplement_id) REFERENCES production_material_supplements(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pms_items_supplement ON production_material_supplement_items(supplement_id);

      CREATE TABLE IF NOT EXISTS production_batch_issues (
        id TEXT PRIMARY KEY,
        batch_no TEXT NOT NULL UNIQUE,
        warehouse_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
        issue_date TEXT NOT NULL,
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pbi_status ON production_batch_issues(status);

      CREATE TABLE IF NOT EXISTS production_batch_issue_orders (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL,
        order_status TEXT NOT NULL,
        error_message TEXT,
        FOREIGN KEY (batch_id) REFERENCES production_batch_issues(id) ON DELETE CASCADE,
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pbio_batch ON production_batch_issue_orders(batch_id);

      CREATE TABLE IF NOT EXISTS production_batch_issue_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        order_issue_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        planned_quantity REAL NOT NULL DEFAULT 0,
        issue_quantity REAL NOT NULL,
        line_no INTEGER NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES production_batch_issues(id) ON DELETE CASCADE,
        FOREIGN KEY (order_issue_id) REFERENCES production_batch_issue_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pbit_batch ON production_batch_issue_items(batch_id);

      CREATE TABLE IF NOT EXISTS production_byproducts (
        id TEXT PRIMARY KEY,
        production_order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        planned_quantity REAL NOT NULL DEFAULT 0,
        actual_quantity REAL NOT NULL DEFAULT 0,
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (creator_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_production_byproducts_order ON production_byproducts(production_order_id);

      CREATE TABLE IF NOT EXISTS production_byproduct_receipts (
        id TEXT PRIMARY KEY,
        receipt_no TEXT NOT NULL UNIQUE,
        byproduct_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
        receipt_date TEXT NOT NULL,
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        FOREIGN KEY (byproduct_id) REFERENCES production_byproducts(id),
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pbr_byproduct ON production_byproduct_receipts(byproduct_id);
      CREATE INDEX IF NOT EXISTS idx_pbr_order ON production_byproduct_receipts(production_order_id);
    `);
    addColumn(db, 'ALTER TABLE production_inspections ADD COLUMN creator_id TEXT');
  } catch (e) {
    throw new Error(`migrateManufacturingQualitySchema tables failed: ${e.message}`, { cause: e });
  }
}
