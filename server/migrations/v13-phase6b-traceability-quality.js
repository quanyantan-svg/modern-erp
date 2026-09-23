// V1.3 Phase 6B — physical inventory identity and versioned quality policy.
// The migration is additive and deliberately leaves legacy movements untracked.

export function migrateV13Phase6BTraceabilityQuality(db) {
  const add = (sql) => { try { db.exec(sql); } catch (_) { /* idempotent */ } };

  add("ALTER TABLE products ADD COLUMN tracking_policy TEXT NOT NULL DEFAULT 'NONE' CHECK(tracking_policy IN ('NONE','LOT','SERIAL'))");
  add('ALTER TABLE products ADD COLUMN shelf_life_days INTEGER');
  add('ALTER TABLE products ADD COLUMN tracking_effective_at TEXT');
  add('ALTER TABLE inventory_transactions ADD COLUMN lot_id TEXT REFERENCES inventory_lots(id)');
  add('ALTER TABLE inventory_transactions ADD COLUMN serial_id TEXT REFERENCES inventory_serials(id)');
  add('ALTER TABLE iqc_inspection_items ADD COLUMN tracking_snapshot TEXT');
  add('ALTER TABLE oqc_inspection_items ADD COLUMN tracking_snapshot TEXT');
  add('ALTER TABLE iqc_inspections ADD COLUMN quality_policy_snapshot_id TEXT REFERENCES logistics_quality_policy_snapshots(id)');
  add('ALTER TABLE oqc_inspections ADD COLUMN quality_policy_snapshot_id TEXT REFERENCES logistics_quality_policy_snapshots(id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_tracking_policy_history (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      old_policy TEXT NOT NULL,
      new_policy TEXT NOT NULL,
      shelf_life_days INTEGER,
      reason TEXT NOT NULL,
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_policy_history_product ON product_tracking_policy_history(product_id,changed_at);

    CREATE TABLE IF NOT EXISTS inventory_lots (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      lot_code TEXT NOT NULL,
      manufacture_date TEXT,
      expiry_date TEXT,
      supplier_lot_reference TEXT,
      created_source_type TEXT NOT NULL,
      created_source_id TEXT NOT NULL,
      created_source_item_id TEXT,
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','HOLD','CONSUMED','DELIVERED','SCRAPPED')),
      created_at TEXT NOT NULL,
      UNIQUE(product_id,lot_code)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_lots_product ON inventory_lots(product_id,status,expiry_date);

    CREATE TABLE IF NOT EXISTS inventory_lot_balances (
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      lot_id TEXT NOT NULL REFERENCES inventory_lots(id),
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(warehouse_id,lot_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lot_balance_product_warehouse ON inventory_lot_balances(product_id,warehouse_id);

    CREATE TABLE IF NOT EXISTS inventory_serials (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      serial_number TEXT NOT NULL,
      lot_id TEXT REFERENCES inventory_lots(id),
      manufacture_date TEXT,
      expiry_date TEXT,
      created_source_type TEXT NOT NULL,
      created_source_id TEXT NOT NULL,
      created_source_item_id TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(lifecycle_state IN ('AVAILABLE','HOLD','CONSUMED','DELIVERED','SCRAPPED')),
      current_warehouse_id TEXT REFERENCES warehouses(id),
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(product_id,serial_number)
    );
    CREATE INDEX IF NOT EXISTS idx_serial_product_location ON inventory_serials(product_id,current_warehouse_id,lifecycle_state);

    CREATE TABLE IF NOT EXISTS tracked_source_allocations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      lot_id TEXT REFERENCES inventory_lots(id),
      planned_lot_code TEXT,
      serial_id TEXT REFERENCES inventory_serials(id),
      planned_serial_number TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      manufacture_date TEXT,
      expiry_date TEXT,
      supplier_lot_reference TEXT,
      posted INTEGER NOT NULL DEFAULT 0 CHECK(posted IN (0,1)),
      reversed INTEGER NOT NULL DEFAULT 0 CHECK(reversed IN (0,1)),
      created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id,source_item_id,lot_id,serial_id,planned_lot_code,planned_serial_number)
    );
    CREATE INDEX IF NOT EXISTS idx_tracked_alloc_source ON tracked_source_allocations(source_type,source_id,source_item_id);

    CREATE TABLE IF NOT EXISTS tracked_inventory_movements (
      id TEXT PRIMARY KEY,
      transaction_id TEXT REFERENCES inventory_transactions(id),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_item_id TEXT,
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT','MOVE')),
      quantity REAL NOT NULL CHECK(quantity > 0),
      lot_id TEXT REFERENCES inventory_lots(id),
      serial_id TEXT REFERENCES inventory_serials(id),
      business_date TEXT NOT NULL,
      reversed INTEGER NOT NULL DEFAULT 0 CHECK(reversed IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracked_movement_identity ON tracked_inventory_movements(lot_id,serial_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_post ON tracked_inventory_movements(source_type,source_id,source_item_id,lot_id,serial_id,direction) WHERE reversed=0;

    CREATE TABLE IF NOT EXISTS tracked_identity_hold_history (
      id TEXT PRIMARY KEY,
      identity_type TEXT NOT NULL CHECK(identity_type IN ('LOT','SERIAL')),
      identity_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('HOLD','RELEASE')),
      reason TEXT NOT NULL,
      operator_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hold_history_identity ON tracked_identity_hold_history(identity_type,identity_id,created_at);

    CREATE TABLE IF NOT EXISTS production_genealogy_allocations (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      output_receipt_id TEXT NOT NULL REFERENCES production_receipts(id),
      output_lot_id TEXT REFERENCES inventory_lots(id),
      output_serial_id TEXT REFERENCES inventory_serials(id),
      material_issue_id TEXT NOT NULL REFERENCES production_material_issues(id),
      material_issue_item_id TEXT NOT NULL REFERENCES production_material_issue_items(id),
      input_lot_id TEXT REFERENCES inventory_lots(id),
      input_serial_id TEXT REFERENCES inventory_serials(id),
      allocated_quantity REAL NOT NULL CHECK(allocated_quantity > 0),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVERSED')),
      reversed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_genealogy_output ON production_genealogy_allocations(output_lot_id,output_serial_id,status);
    CREATE INDEX IF NOT EXISTS idx_genealogy_input ON production_genealogy_allocations(input_lot_id,input_serial_id,status);

    CREATE TABLE IF NOT EXISTS quality_control_points (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('PURCHASE_RECEIPT','SALES_DELIVERY')),
      scope TEXT NOT NULL CHECK(scope IN ('GLOBAL','PRODUCT')),
      product_id TEXT REFERENCES products(id),
      inspection_required INTEGER NOT NULL CHECK(inspection_required IN (0,1)),
      sampling_mode TEXT NOT NULL CHECK(sampling_mode IN ('FULL','FIXED_QUANTITY','PERCENTAGE')),
      sampling_value REAL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      version INTEGER NOT NULL,
      remarks TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(code,version)
    );
    CREATE INDEX IF NOT EXISTS idx_qcp_resolution ON quality_control_points(operation_type,scope,product_id,active,effective_from,effective_to);

    CREATE TABLE IF NOT EXISTS quality_control_criteria (
      id TEXT PRIMARY KEY,
      qcp_id TEXT NOT NULL REFERENCES quality_control_points(id),
      sequence INTEGER NOT NULL,
      criterion_name TEXT NOT NULL,
      specification TEXT NOT NULL DEFAULT '',
      result_type TEXT NOT NULL CHECK(result_type IN ('PASS_FAIL','NUMERIC','TEXT')),
      min_value REAL,
      max_value REAL,
      unit TEXT,
      required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
      UNIQUE(qcp_id,sequence)
    );

    CREATE TABLE IF NOT EXISTS logistics_quality_policy_snapshots (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('PURCHASE_RECEIPT','SALES_DELIVERY')),
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
    CREATE INDEX IF NOT EXISTS idx_quality_snapshot_source ON logistics_quality_policy_snapshots(source_type,source_id);

    CREATE TABLE IF NOT EXISTS inspection_criteria_snapshots (
      id TEXT PRIMARY KEY,
      inspection_type TEXT NOT NULL CHECK(inspection_type IN ('IQC','OQC')),
      inspection_id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      criterion_name TEXT NOT NULL,
      specification TEXT NOT NULL DEFAULT '',
      result_type TEXT NOT NULL,
      min_value REAL,
      max_value REAL,
      unit TEXT,
      required INTEGER NOT NULL,
      pass_fail_result TEXT,
      numeric_result REAL,
      text_result TEXT,
      passed INTEGER,
      completed_at TEXT,
      UNIQUE(inspection_type,inspection_id,source_item_id,sequence)
    );

    INSERT OR IGNORE INTO quality_control_points(id,code,name,operation_type,scope,product_id,inspection_required,sampling_mode,sampling_value,active,effective_from,effective_to,version,remarks,created_by,created_at)
      SELECT 'qcp-global-incoming-v1','QCP-IN-GLOBAL','来料检验默认规则','PURCHASE_RECEIPT','GLOBAL',NULL,1,'FULL',NULL,1,'2000-01-01',NULL,1,'Phase 3 安全默认：必须检验','user-admin',datetime('now')
      WHERE EXISTS(SELECT 1 FROM users WHERE id='user-admin');
    INSERT OR IGNORE INTO quality_control_points(id,code,name,operation_type,scope,product_id,inspection_required,sampling_mode,sampling_value,active,effective_from,effective_to,version,remarks,created_by,created_at)
      SELECT 'qcp-global-outgoing-v1','QCP-OUT-GLOBAL','出货检验默认规则','SALES_DELIVERY','GLOBAL',NULL,1,'FULL',NULL,1,'2000-01-01',NULL,1,'Phase 3 安全默认：必须检验','user-admin',datetime('now')
      WHERE EXISTS(SELECT 1 FROM users WHERE id='user-admin');
  `);
}
