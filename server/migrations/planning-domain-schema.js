// Planning Domain Closure — additive, idempotent schema.
// Historical MRP/instruction tables are preserved. Core business entities
// (scheme, consumption, planned order, reservation) use relational rows;
// JSON is limited to immutable configuration/log snapshots.

function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
  }
}

export function migratePlanningDomainSchema(db) {
  // Legacy product planning attributes are preserved as compatibility
  // projections. Ensure they exist before seeding the canonical policy rows.
  addColumn(db, 'ALTER TABLE products ADD COLUMN reorder_point REAL DEFAULT 0');
  addColumn(db, 'ALTER TABLE products ADD COLUMN min_stock REAL DEFAULT 0');
  addColumn(db, 'ALTER TABLE products ADD COLUMN max_stock REAL DEFAULT 0');
  addColumn(db, 'ALTER TABLE products ADD COLUMN lead_time_days INTEGER DEFAULT 7');
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_parameters (
      id TEXT PRIMARY KEY,
      reservation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reservation_enabled IN (0,1)),
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planning_material_policies (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL UNIQUE,
      safety_stock REAL NOT NULL DEFAULT 0 CHECK(safety_stock >= 0),
      reorder_point REAL NOT NULL DEFAULT 0 CHECK(reorder_point >= 0),
      maximum_stock REAL NOT NULL DEFAULT 0 CHECK(maximum_stock >= 0),
      economic_order_quantity REAL NOT NULL DEFAULT 0 CHECK(economic_order_quantity >= 0),
      lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_time_days >= 0),
      supply_strategy TEXT NOT NULL DEFAULT 'AUTO' CHECK(supply_strategy IN ('AUTO','MAKE','BUY','OUTSOURCE')),
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planning_schemes (
      id TEXT PRIMARY KEY,
      scheme_code TEXT NOT NULL UNIQUE,
      scheme_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','INACTIVE')),
      horizon_days INTEGER NOT NULL DEFAULT 90 CHECK(horizon_days > 0),
      calculation_scope_mode TEXT NOT NULL DEFAULT 'GLOBAL' CHECK(calculation_scope_mode IN ('GLOBAL','SELECTED','PRECISE_SELECTED')),
      reservation_release_policy TEXT NOT NULL DEFAULT 'KEEP_ALL' CHECK(reservation_release_policy IN ('KEEP_ALL','RELEASE_WEAK')),
      merge_policy TEXT NOT NULL DEFAULT 'PRODUCT_DATE',
      release_make INTEGER NOT NULL DEFAULT 1 CHECK(release_make IN (0,1)),
      release_buy INTEGER NOT NULL DEFAULT 1 CHECK(release_buy IN (0,1)),
      release_outsource INTEGER NOT NULL DEFAULT 0 CHECK(release_outsource IN (0,1)),
      force_supply_strategy TEXT CHECK(force_supply_strategy IS NULL OR force_supply_strategy IN ('MAKE','BUY','OUTSOURCE')),
      include_overdue_supply INTEGER NOT NULL DEFAULT 0 CHECK(include_overdue_supply IN (0,1)),
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planning_scheme_demand_sources (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('SALES_ORDER','FORECAST','SAFETY_STOCK','BOM_COMPONENT')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      UNIQUE(scheme_id, source_type),
      FOREIGN KEY(scheme_id) REFERENCES planning_schemes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planning_scheme_supply_sources (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('ON_HAND','PURCHASE_ORDER','PRODUCTION_ORDER','PLANNED_ORDER')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      UNIQUE(scheme_id, source_type),
      FOREIGN KEY(scheme_id) REFERENCES planning_schemes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planning_scheme_warehouses (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      participates INTEGER NOT NULL DEFAULT 1 CHECK(participates IN (0,1)),
      UNIQUE(scheme_id, warehouse_id),
      FOREIGN KEY(scheme_id) REFERENCES planning_schemes(id) ON DELETE CASCADE,
      FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
    );

    CREATE TABLE IF NOT EXISTS forecast_consumptions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      forecast_item_id TEXT NOT NULL,
      sales_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sales_need_date TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(forecast_item_id) REFERENCES planning_forecast_items(id),
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS mrp_run_source_selections (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_line_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, source_type, source_id, source_line_id),
      FOREIGN KEY(run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mrp_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('DEMAND','SUPPLY')),
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_line_id TEXT,
      warehouse_id TEXT,
      quantity REAL NOT NULL CHECK(quantity >= 0),
      status TEXT NOT NULL DEFAULT '',
      firm INTEGER NOT NULL DEFAULT 0 CHECK(firm IN (0,1)),
      metadata TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
    );

    CREATE TABLE IF NOT EXISTS mrp_run_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('STARTED','COMPLETED','WARNING','FAILED')),
      message TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planned_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL CHECK(source_type IN ('MRP','MANUAL')),
      mrp_run_id TEXT,
      mrp_result_id TEXT,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      need_date TEXT,
      planned_supply_date TEXT,
      supply_type TEXT NOT NULL CHECK(supply_type IN ('MAKE','BUY','OUTSOURCE')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','RELEASED','CLOSED','CANCELLED')),
      released_quantity REAL NOT NULL DEFAULT 0 CHECK(released_quantity >= 0),
      reservation_state TEXT NOT NULL DEFAULT 'NONE',
      release_state TEXT NOT NULL DEFAULT 'NOT_RELEASED',
      target_change_reason TEXT NOT NULL DEFAULT '',
      merged_into_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      released_at TEXT,
      UNIQUE(mrp_result_id),
      FOREIGN KEY(mrp_run_id) REFERENCES mrp_runs(id),
      FOREIGN KEY(mrp_result_id) REFERENCES mrp_run_results(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(merged_into_id) REFERENCES planned_orders(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planned_order_source_links (
      id TEXT PRIMARY KEY,
      planned_order_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_line_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY(planned_order_id) REFERENCES planned_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planned_order_byproducts (
      id TEXT PRIMARY KEY,
      planned_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY(planned_order_id) REFERENCES planned_orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS planning_reservations (
      id TEXT PRIMARY KEY,
      reservation_no TEXT NOT NULL UNIQUE,
      reservation_type TEXT NOT NULL CHECK(reservation_type IN ('STRONG','WEAK','MANUAL')),
      demand_source_type TEXT NOT NULL,
      demand_source_id TEXT NOT NULL,
      demand_source_line_id TEXT,
      supply_source_type TEXT NOT NULL CHECK(supply_source_type IN ('ON_HAND','PLANNED_ORDER','PURCHASE_ORDER','PRODUCTION_ORDER','EXPECTED')),
      supply_source_id TEXT,
      supply_source_line_id TEXT,
      product_id TEXT NOT NULL,
      warehouse_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      priority INTEGER NOT NULL DEFAULT 100,
      release_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED','CONSUMED','CANCELLED')),
      mrp_run_id TEXT,
      scheme_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY(mrp_run_id) REFERENCES mrp_runs(id),
      FOREIGN KEY(scheme_id) REFERENCES planning_schemes(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planning_cascade_changes (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('SALES_ORDER','FORECAST')),
      source_id TEXT NOT NULL,
      requested_quantity REAL,
      requested_date TEXT,
      preview_snapshot TEXT NOT NULL,
      preview_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PREVIEWED' CHECK(status IN ('PREVIEWED','APPLIED','BLOCKED','CANCELLED')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS planning_outsource_handoffs (
      id TEXT PRIMARY KEY,
      planned_order_id TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      need_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','CANCELLED')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(planned_order_id) REFERENCES planned_orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_forecast_consumptions_run ON forecast_consumptions(run_id);
    CREATE INDEX IF NOT EXISTS idx_mrp_run_events_run_date ON mrp_run_events(run_id,event_date);
    CREATE INDEX IF NOT EXISTS idx_mrp_run_logs_run ON mrp_run_logs(run_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_planned_orders_status_date ON planned_orders(status,need_date);
    CREATE INDEX IF NOT EXISTS idx_planned_order_sources_order ON planned_order_source_links(planned_order_id);
    CREATE INDEX IF NOT EXISTS idx_planning_reservations_supply ON planning_reservations(product_id,supply_source_type,supply_source_id,status);
    CREATE INDEX IF NOT EXISTS idx_planning_reservations_demand ON planning_reservations(demand_source_type,demand_source_id,status);
  `);

  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN scheme_id TEXT");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN scheme_snapshot TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN calculation_scope_mode TEXT NOT NULL DEFAULT 'GLOBAL'");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN config_snapshot TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN started_at TEXT");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN failed_at TEXT");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN error_code TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN error_message TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE mrp_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE mrp_run_results ADD COLUMN supply_type TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE mrp_run_results ADD COLUMN safety_stock REAL NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE production_instruction_items ADD COLUMN planned_order_id TEXT");
  addColumn(db, "ALTER TABLE purchase_instruction_items ADD COLUMN planned_order_id TEXT");

  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO planning_parameters(id,reservation_enabled,created_at,updated_at)
    VALUES('DEFAULT',1,?,?)`).run(now, now);
  const insertPolicy = db.prepare(`INSERT OR IGNORE INTO planning_material_policies(
    id,product_id,safety_stock,reorder_point,maximum_stock,economic_order_quantity,lead_time_days,supply_strategy,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'AUTO',?,?)`);
  for (const product of db.prepare(`SELECT id,COALESCE(min_stock,0) safety_stock,COALESCE(reorder_point,0) reorder_point,
    COALESCE(max_stock,0) maximum_stock,COALESCE(lead_time_days,0) lead_time_days FROM products`).all()) {
    insertPolicy.run(`planning-policy-${product.id}`, product.id, Number(product.safety_stock), Number(product.reorder_point),
      Number(product.maximum_stock), 0, Number(product.lead_time_days), now, now);
  }
}
