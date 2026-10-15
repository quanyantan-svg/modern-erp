export const SALES_WAVE3_TABLES = Object.freeze([
  'sales_quotations', 'sales_quotation_lines', 'sales_quotation_conversions',
]);

function assertMySqlTables(db) {
  const rows = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?) ORDER BY TABLE_NAME`)
    .all(...SALES_WAVE3_TABLES).map((row) => row.table_name);
  if (JSON.stringify(rows) !== JSON.stringify([...SALES_WAVE3_TABLES].sort())) {
    throw new Error('Wave 3 MySQL bootstrap incomplete');
  }
}

export function migrateSalesCustomerWave3Quotation(db) {
  if (db.dialect === 'mysql') return assertMySqlTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_quotations (
      id TEXT PRIMARY KEY, quotation_no TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
      salesperson_id TEXT, sales_group_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','EFFECTIVE','EXPIRED','CLOSED','FULLY_CONVERTED')),
      currency_code TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
      payment_terms TEXT NOT NULL DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 0,
      commercial_tax_code TEXT, tax_inclusive INTEGER CHECK(tax_inclusive IS NULL OR tax_inclusive IN (0,1)),
      total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents>=0), converted_total_cents INTEGER NOT NULL DEFAULT 0 CHECK(converted_total_cents>=0),
      remark TEXT NOT NULL DEFAULT '', close_reason TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL, reviewer_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      published_at TEXT, closed_at TEXT,
      CHECK(valid_to>=valid_from), FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(salesperson_id) REFERENCES salesperson_profiles(id), FOREIGN KEY(sales_group_id) REFERENCES sales_groups(id),
      FOREIGN KEY(creator_id) REFERENCES users(id), FOREIGN KEY(reviewer_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_quotation_lines (
      id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL, line_no INTEGER NOT NULL,
      material_id TEXT NOT NULL, commercial_uom_code TEXT NOT NULL, quantity_micros INTEGER NOT NULL CHECK(quantity_micros>0),
      converted_qty_micros INTEGER NOT NULL DEFAULT 0 CHECK(converted_qty_micros>=0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
      pricing_evidence_json TEXT NOT NULL, discount_snapshot_json TEXT NOT NULL,
      tax_basis_assumption TEXT, planned_delivery_date TEXT,
      upper_delivery_tolerance_bps INTEGER NOT NULL DEFAULT 0 CHECK(upper_delivery_tolerance_bps>=0),
      lower_delivery_tolerance_bps INTEGER NOT NULL DEFAULT 0 CHECK(lower_delivery_tolerance_bps BETWEEN 0 AND 10000),
      remark TEXT NOT NULL DEFAULT '', UNIQUE(quotation_id,line_no),
      FOREIGN KEY(quotation_id) REFERENCES sales_quotations(id), FOREIGN KEY(material_id) REFERENCES products(id),
      FOREIGN KEY(commercial_uom_code) REFERENCES uoms(code)
    );
    CREATE TABLE IF NOT EXISTS sales_quotation_conversions (
      id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL, quotation_line_id TEXT NOT NULL,
      sales_order_id TEXT NOT NULL, sales_order_item_id TEXT NOT NULL,
      converted_qty_micros INTEGER NOT NULL CHECK(converted_qty_micros>0),
      converted_unit_price_cents INTEGER NOT NULL CHECK(converted_unit_price_cents>=0),
      converted_amount_cents INTEGER NOT NULL CHECK(converted_amount_cents>=0), converted_uom_code TEXT NOT NULL,
      business_date TEXT NOT NULL, converted_at TEXT NOT NULL, converted_by TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      UNIQUE(quotation_line_id,sales_order_item_id), UNIQUE(quotation_id,idempotency_key),
      FOREIGN KEY(quotation_id) REFERENCES sales_quotations(id), FOREIGN KEY(quotation_line_id) REFERENCES sales_quotation_lines(id),
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id), FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
      FOREIGN KEY(converted_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_quotations_scope ON sales_quotations(sales_group_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_quote_conversion_capacity ON sales_quotation_conversions(quotation_line_id);
  `);
}
