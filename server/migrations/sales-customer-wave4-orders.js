export const SALES_WAVE4_TABLES = Object.freeze(['sales_order_changes', 'sales_order_change_lines']);

const ORDER_COLUMNS = Object.freeze([
  ['salesperson_id', 'TEXT REFERENCES salesperson_profiles(id)'], ['sales_group_id', 'TEXT REFERENCES sales_groups(id)'],
  ['settlement_party_id', 'TEXT REFERENCES customers(id)'], ['payer_id', 'TEXT REFERENCES customers(id)'],
  ['customer_material_xref_id', 'TEXT REFERENCES customer_material_xref(id)'], ['commercial_tax_code', 'TEXT'],
  ['tax_inclusive', 'INTEGER CHECK(tax_inclusive IS NULL OR tax_inclusive IN (0,1))'],
  ['required_prepayment_cents', 'INTEGER CHECK(required_prepayment_cents IS NULL OR required_prepayment_cents>=0)'],
  ['reservation_intent_state', "TEXT DEFAULT 'NONE' CHECK(reservation_intent_state IN ('NONE','REQUESTED','GRANTED','RELEASED'))"],
  ['commercial_close_state', "TEXT NOT NULL DEFAULT 'OPEN' CHECK(commercial_close_state IN ('OPEN','CLOSED','CANCELLED'))"],
  ['gift_summary_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK(gift_summary_cents>=0)'], ['commercial_pricing_uom_code', 'TEXT'],
  ['effective_version', 'INTEGER NOT NULL DEFAULT 1 CHECK(effective_version>=1)'],
]);
const ITEM_COLUMNS = Object.freeze([
  ['is_gift_line', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_gift_line IN (0,1))'], ['commercial_tax_basis', 'TEXT'],
  ['tax_inclusive_assumption', 'INTEGER CHECK(tax_inclusive_assumption IS NULL OR tax_inclusive_assumption IN (0,1))'],
  ['pricing_uom_code_applied', 'TEXT'], ['qty_break_applied_min', 'INTEGER'], ['qty_break_applied_max', 'INTEGER'],
  ['planned_delivery_date', 'TEXT'], ['upper_delivery_tolerance_bps', 'INTEGER CHECK(upper_delivery_tolerance_bps IS NULL OR upper_delivery_tolerance_bps>=0)'],
  ['lower_delivery_tolerance_bps', 'INTEGER CHECK(lower_delivery_tolerance_bps IS NULL OR lower_delivery_tolerance_bps BETWEEN 0 AND 10000)'],
  ['price_snapshot_json', 'TEXT'], ['discount_snapshot_json', 'TEXT'],
]);

function columns(db, table) {
  if (db.dialect === 'mysql') return new Set(db.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table).map((r) => r.name));
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}
function addSqliteColumns(db, table, definitions) {
  const existing = columns(db, table);
  for (const [name, ddl] of definitions) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}
function assertColumns(db, table, definitions) {
  const existing = columns(db, table);
  for (const [name] of definitions) if (!existing.has(name)) throw new Error(`Wave 4 MySQL bootstrap incomplete: ${table}.${name}`);
}

export function migrateSalesCustomerWave4Orders(db) {
  if (db.dialect !== 'mysql') {
    addSqliteColumns(db, 'sales_orders', ORDER_COLUMNS);
    addSqliteColumns(db, 'sales_order_items', ITEM_COLUMNS);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_order_changes (
        id TEXT PRIMARY KEY, change_no TEXT NOT NULL UNIQUE, sales_order_id TEXT NOT NULL,
        change_path TEXT NOT NULL CHECK(change_path IN ('CONTROLLED_DIRECT','CONTROLLED_DOCUMENT')),
        state TEXT NOT NULL CHECK(state IN ('DRAFT','SUBMITTED','REJECTED','CANCELLED','APPLIED')),
        reason_code TEXT NOT NULL, reason_text TEXT NOT NULL, before_snapshot_hash TEXT NOT NULL, after_snapshot_hash TEXT NOT NULL,
        base_effective_version INTEGER NOT NULL, target_effective_version INTEGER NOT NULL,
        parameter_scope_key TEXT NOT NULL, parameter_snapshot_hash TEXT NOT NULL, order_change_mode_snapshot TEXT NOT NULL,
        request_idempotency_key TEXT, application_idempotency_key TEXT,
        requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, approver_id TEXT, approved_at TEXT, applied_by TEXT, applied_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(target_effective_version=base_effective_version+1), UNIQUE(sales_order_id,request_idempotency_key),
        UNIQUE(application_idempotency_key), FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
        FOREIGN KEY(requested_by) REFERENCES users(id), FOREIGN KEY(approver_id) REFERENCES users(id), FOREIGN KEY(applied_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS sales_order_change_lines (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, line_no INTEGER NOT NULL,
        op TEXT NOT NULL CHECK(op IN ('ADD','MODIFY','CANCEL')), sales_order_item_id TEXT,
        before_values_json TEXT NOT NULL, after_values_json TEXT NOT NULL,
        qty_delta_micros INTEGER NOT NULL DEFAULT 0, amount_delta_cents INTEGER NOT NULL DEFAULT 0,
        delivered_before_micros INTEGER NOT NULL DEFAULT 0, delivered_after_micros INTEGER NOT NULL DEFAULT 0,
        constraint_check_result TEXT NOT NULL, UNIQUE(change_id,line_no),
        FOREIGN KEY(change_id) REFERENCES sales_order_changes(id), FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_order_changes_order ON sales_order_changes(sales_order_id,state);
    `);
    return;
  }
  assertColumns(db, 'sales_orders', ORDER_COLUMNS);
  assertColumns(db, 'sales_order_items', ITEM_COLUMNS);
  const tables = db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)`).all(...SALES_WAVE4_TABLES).map((r) => r.name).sort();
  if (JSON.stringify(tables) !== JSON.stringify([...SALES_WAVE4_TABLES].sort())) throw new Error('Wave 4 MySQL bootstrap incomplete');
}
