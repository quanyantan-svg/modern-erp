export const SALES_WAVE5_TABLES = Object.freeze(['delivery_notices', 'delivery_notice_lines']);
const DELIVERY_COLUMNS = Object.freeze([
  ['delivery_notice_id', 'TEXT REFERENCES delivery_notices(id)'],
  ['source_mode', "TEXT NOT NULL DEFAULT 'LEGACY_UNCLASSIFIED' CHECK(source_mode IN ('DIRECT_ORDER','DELIVERY_NOTICE','LEGACY_UNCLASSIFIED'))"],
]);
const DELIVERY_ITEM_COLUMNS = Object.freeze([['delivery_notice_line_id', 'TEXT REFERENCES delivery_notice_lines(id)']]);

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
  for (const [name] of definitions) if (!existing.has(name)) throw new Error(`Wave 5 MySQL bootstrap incomplete: ${table}.${name}`);
}

export function migrateSalesCustomerWave5Delivery(db) {
  if (db.dialect !== 'mysql') {
    db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_notices (
        id TEXT PRIMARY KEY, notice_no TEXT NOT NULL UNIQUE, sales_order_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','CONFIRMED','CANCELLED','CLOSED')),
        warehouse_id TEXT NOT NULL, ship_to_snapshot_json TEXT NOT NULL, planned_delivery_date TEXT NOT NULL,
        business_date TEXT NOT NULL, customer_id TEXT NOT NULL, customer_snapshot_json TEXT NOT NULL,
        close_reason TEXT NOT NULL DEFAULT '', creator_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        confirmed_at TEXT, confirmed_by TEXT, cancelled_at TEXT, cancelled_by TEXT,
        FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id), FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(creator_id) REFERENCES users(id),
        FOREIGN KEY(confirmed_by) REFERENCES users(id), FOREIGN KEY(cancelled_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS delivery_notice_lines (
        id TEXT PRIMARY KEY, delivery_notice_id TEXT NOT NULL, sales_order_item_id TEXT NOT NULL,
        scheduled_qty_micros INTEGER NOT NULL CHECK(scheduled_qty_micros>0),
        notified_qty_micros INTEGER NOT NULL DEFAULT 0 CHECK(notified_qty_micros>=0),
        cancelled_notified_qty_micros INTEGER NOT NULL DEFAULT 0 CHECK(cancelled_notified_qty_micros>=0),
        line_no INTEGER NOT NULL, UNIQUE(delivery_notice_id,sales_order_item_id), UNIQUE(delivery_notice_id,line_no),
        FOREIGN KEY(delivery_notice_id) REFERENCES delivery_notices(id), FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id)
      );
      CREATE INDEX IF NOT EXISTS idx_delivery_notice_so ON delivery_notices(sales_order_id,state);
      CREATE INDEX IF NOT EXISTS idx_delivery_notice_line_so ON delivery_notice_lines(sales_order_item_id);
    `);
    addSqliteColumns(db, 'sales_deliveries', DELIVERY_COLUMNS);
    addSqliteColumns(db, 'sales_delivery_items', DELIVERY_ITEM_COLUMNS);
    return;
  }
  assertColumns(db, 'sales_deliveries', DELIVERY_COLUMNS);
  assertColumns(db, 'sales_delivery_items', DELIVERY_ITEM_COLUMNS);
  const tables = db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)`).all(...SALES_WAVE5_TABLES).map((r) => r.name).sort();
  if (JSON.stringify(tables) !== JSON.stringify([...SALES_WAVE5_TABLES].sort())) throw new Error('Wave 5 MySQL bootstrap incomplete');
}
