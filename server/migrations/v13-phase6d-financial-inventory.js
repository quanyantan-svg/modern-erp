function addColumn(db, sql) {
  try { db.exec(sql); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

const SUBJECTS = [
  ['subject-008', '1403', '原材料', 'ASSET', 'DEBIT'],
  ['subject-009', '1404', '在制品', 'ASSET', 'DEBIT'],
  ['subject-010', '1406', '其他存货', 'ASSET', 'DEBIT'],
  ['subject-011', '6402', '存货盘盈盘亏', 'EXPENSE', 'DEBIT'],
  ['subject-012', '6403', '存货报废损失', 'EXPENSE', 'DEBIT'],
  ['subject-013', '6404', '材料价格差异', 'EXPENSE', 'DEBIT'],
  ['subject-014', '6405', '制造差异', 'EXPENSE', 'DEBIT'],
  ['subject-015', '5101', '人工吸收', 'EXPENSE', 'CREDIT'],
  ['subject-016', '5102', '制造费用吸收', 'EXPENSE', 'CREDIT'],
  ['subject-017', '6406', '采购退货差异', 'EXPENSE', 'DEBIT'],
];

const ROLE_CODES = [
  ['ACCOUNTS_RECEIVABLE', '1122'], ['ACCOUNTS_PAYABLE', '2202'], ['SALES_REVENUE', '6001'],
  ['RAW_MATERIAL_INVENTORY', '1403'], ['FINISHED_GOODS_INVENTORY', '1405'], ['OTHER_INVENTORY', '1406'],
  ['WIP', '1404'], ['COGS', '6401'], ['INVENTORY_GAIN_LOSS', '6402'],
  ['INVENTORY_SCRAP_EXPENSE', '6403'], ['MATERIAL_PRICE_VARIANCE', '6404'],
  ['MANUFACTURING_VARIANCE', '6405'], ['LABOR_ABSORPTION', '5101'],
  ['OVERHEAD_ABSORPTION', '5102'], ['PURCHASE_RETURN_VARIANCE', '6406'],
  ['CASH', '1001'], ['BANK', '1002'],
];

export function migrateV13Phase6DFinancialInventory(db) {
  addColumn(db, "ALTER TABLE products ADD COLUMN valuation_method TEXT NOT NULL DEFAULT 'MOVING_AVERAGE'");
  addColumn(db, "ALTER TABLE products ADD COLUMN inventory_classification TEXT NOT NULL DEFAULT 'OTHER_INVENTORY'");
  addColumn(db, 'ALTER TABLE products ADD COLUMN valuation_activated_at TEXT');
  addColumn(db, 'ALTER TABLE inventory_transactions ADD COLUMN business_date TEXT');
  addColumn(db, "ALTER TABLE inventory_transactions ADD COLUMN valuation_status TEXT NOT NULL DEFAULT 'LEGACY_UNVALUED'");
  addColumn(db, "ALTER TABLE accounting_vouchers ADD COLUMN voucher_origin TEXT NOT NULL DEFAULT 'MANUAL'");
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN reversal_of_id TEXT');
  addColumn(db, 'ALTER TABLE accounting_vouchers ADD COLUMN business_date TEXT');
  addColumn(db, 'ALTER TABLE inventory_period_closures ADD COLUMN close_checks_json TEXT');
  addColumn(db, 'ALTER TABLE inventory_period_closures ADD COLUMN reopen_reason TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS account_role_mappings (
      role_code TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES accounting_subjects(id),
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_valuation_movements (
      id TEXT PRIMARY KEY,
      business_date TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      lot_id TEXT REFERENCES inventory_lots(id),
      serial_id TEXT REFERENCES inventory_serials(id),
      quantity_delta REAL NOT NULL,
      value_delta_cents INTEGER NOT NULL,
      unit_cost_cents INTEGER,
      valuation_basis TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      inventory_transaction_id TEXT,
      production_order_id TEXT,
      reversal_of_id TEXT REFERENCES inventory_valuation_movements(id),
      status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','LEGACY_UNVALUED')),
      created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id,source_item_id,lot_id,serial_id,movement_type)
    );
    CREATE INDEX IF NOT EXISTS idx_valuation_date ON inventory_valuation_movements(business_date,product_id,warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_valuation_source ON inventory_valuation_movements(source_type,source_id,source_item_id);
    CREATE TABLE IF NOT EXISTS inventory_valuation_balances (
      balance_key TEXT PRIMARY KEY,
      valuation_method TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      lot_id TEXT REFERENCES inventory_lots(id),
      serial_id TEXT REFERENCES inventory_serials(id),
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      value_cents INTEGER NOT NULL DEFAULT 0 CHECK(value_cents >= 0),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_wip_movements (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      business_date TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_item_id TEXT NOT NULL DEFAULT '',
      voucher_id TEXT REFERENCES accounting_vouchers(id),
      reversal_of_id TEXT REFERENCES production_wip_movements(id),
      created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id,source_item_id,movement_type)
    );
    CREATE INDEX IF NOT EXISTS idx_wip_order_date ON production_wip_movements(production_order_id,business_date);
    CREATE TABLE IF NOT EXISTS inventory_control_reversals (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      reviewer_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_system_voucher_source
      ON accounting_vouchers(source_type,source_id) WHERE voucher_origin='SYSTEM';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_valuation_source_identity
      ON inventory_valuation_movements(source_type,source_id,source_item_id,COALESCE(lot_id,''),COALESCE(serial_id,''),movement_type);
  `);

  const insertSubject = db.prepare('INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES(?,?,?,?,?,1)');
  for (const subject of SUBJECTS) insertSubject.run(...subject);
  const now = new Date().toISOString();
  const map = db.prepare('INSERT OR IGNORE INTO account_role_mappings(role_code,subject_id,updated_at) SELECT ?,id,? FROM accounting_subjects WHERE code=?');
  for (const [role, code] of ROLE_CODES) map.run(role, now, code);

  db.exec(`
    UPDATE products SET valuation_method=CASE tracking_policy
      WHEN 'LOT' THEN 'LOT_SPECIFIC_POOL' WHEN 'SERIAL' THEN 'SPECIFIC_SERIAL' ELSE 'MOVING_AVERAGE' END
      WHERE valuation_activated_at IS NULL;
    UPDATE inventory_transactions SET business_date=substr(created_at,1,10) WHERE business_date IS NULL OR business_date='';
  `);
}
