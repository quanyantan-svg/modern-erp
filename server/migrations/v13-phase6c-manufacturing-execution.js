function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

export function migrateV13Phase6CManufacturingExecution(db) {
  addColumn(db, 'ALTER TABLE products ADD COLUMN standard_manufacturing_cost_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE work_centers ADD COLUMN daily_capacity_minutes INTEGER NOT NULL DEFAULT 480');
  addColumn(db, 'ALTER TABLE work_centers ADD COLUMN labor_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE work_centers ADD COLUMN overhead_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE product_routing_operations ADD COLUMN work_center_id TEXT');
  addColumn(db, 'ALTER TABLE product_routing_operations ADD COLUMN setup_seconds INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE product_routing_operations ADD COLUMN run_seconds_per_unit INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE product_routing_operations ADD COLUMN expected_yield_bps INTEGER NOT NULL DEFAULT 10000');
  addColumn(db, 'ALTER TABLE product_routing_operations ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN source_operation_id TEXT');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN work_center_id TEXT');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN setup_seconds INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN run_seconds_per_unit INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN expected_yield_bps INTEGER NOT NULL DEFAULT 10000');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN labor_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN overhead_rate_cents_per_hour INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ALTER TABLE production_order_routing_snapshots ADD COLUMN daily_capacity_minutes INTEGER NOT NULL DEFAULT 480');

  db.exec(`
    CREATE TABLE IF NOT EXISTS production_order_operations (
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
      status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','CANCELLED')),
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(production_order_id, sequence_no),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (routing_snapshot_id) REFERENCES production_order_routing_snapshots(id),
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_production_order_operations_order ON production_order_operations(production_order_id, sequence_no);
    CREATE INDEX IF NOT EXISTS idx_production_order_operations_capacity ON production_order_operations(work_center_id, planned_date);

    CREATE TABLE IF NOT EXISTS production_operation_reports (
      id TEXT PRIMARY KEY,
      report_no TEXT NOT NULL UNIQUE,
      production_order_id TEXT NOT NULL,
      production_operation_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      good_quantity REAL NOT NULL DEFAULT 0 CHECK(good_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK(scrap_quantity >= 0),
      labor_seconds INTEGER CHECK(labor_seconds IS NULL OR labor_seconds >= 0),
      machine_seconds INTEGER CHECK(machine_seconds IS NULL OR machine_seconds >= 0),
      scrap_reason TEXT,
      remark TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      operator_id TEXT NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (production_operation_id) REFERENCES production_order_operations(id),
      FOREIGN KEY (operator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_operation_reports_operation ON production_operation_reports(production_operation_id, status);

    CREATE TABLE IF NOT EXISTS production_operation_report_reversals (
      id TEXT PRIMARY KEY,
      reversal_no TEXT NOT NULL UNIQUE,
      original_report_id TEXT NOT NULL,
      production_order_id TEXT NOT NULL,
      production_operation_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      good_quantity REAL NOT NULL DEFAULT 0 CHECK(good_quantity >= 0),
      scrap_quantity REAL NOT NULL DEFAULT 0 CHECK(scrap_quantity >= 0),
      labor_seconds INTEGER NOT NULL DEFAULT 0 CHECK(labor_seconds >= 0),
      machine_seconds INTEGER NOT NULL DEFAULT 0 CHECK(machine_seconds >= 0),
      reason TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (original_report_id) REFERENCES production_operation_reports(id),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (production_operation_id) REFERENCES production_order_operations(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_operation_report_reversals_report ON production_operation_report_reversals(original_report_id);

    CREATE TABLE IF NOT EXISTS production_cost_baselines (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL UNIQUE,
      standard_material_cents INTEGER NOT NULL,
      standard_labor_cents INTEGER NOT NULL,
      standard_overhead_cents INTEGER NOT NULL,
      standard_total_cents INTEGER NOT NULL,
      standard_unit_cents INTEGER NOT NULL,
      component_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id)
    );

    CREATE TABLE IF NOT EXISTS production_cost_summaries (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('PROVISIONAL','FINAL')),
      material_cost_cents INTEGER NOT NULL,
      labor_cost_cents INTEGER NOT NULL,
      overhead_cost_cents INTEGER,
      total_cost_cents INTEGER,
      unit_cost_cents INTEGER,
      material_quality TEXT NOT NULL CHECK(material_quality IN ('AUTHORITATIVE','PARTIAL','ESTIMATED')),
      overhead_complete INTEGER NOT NULL DEFAULT 0,
      good_quantity REAL NOT NULL DEFAULT 0,
      scrap_quantity REAL NOT NULL DEFAULT 0,
      yield_bps INTEGER NOT NULL DEFAULT 0,
      total_variance_cents INTEGER,
      finalized_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id)
    );
  `);

  db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-accounting','PRODUCTION_COSTS_VIEW')").run();

  db.exec(`
    UPDATE product_routing_operations
       SET setup_seconds=CAST(ROUND(setup_minutes*60) AS INTEGER),
           run_seconds_per_unit=CAST(ROUND(run_minutes_per_unit*60) AS INTEGER)
     WHERE setup_seconds=0 AND run_seconds_per_unit=0;
    UPDATE work_centers SET daily_capacity_minutes=CAST(ROUND(capacity_hours*60) AS INTEGER)
     WHERE daily_capacity_minutes=480 AND capacity_hours<>8;
  `);
}
