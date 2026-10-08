// Procurement & Outsourcing Domain — coherent additive migration chain.
//
// This file is intentionally the single schema entry point for the domain.
// Later waves extend it with additive tables/columns. Every operation must be
// repeatable on SQLite and through the canonical MySQL adapter.

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function safeAddColumn(db, table, column, ddl) {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

export function migrateProcurementOutsourcingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS procurement_parameters (
      id TEXT PRIMARY KEY,
      source_control_enabled INTEGER NOT NULL DEFAULT 1,
      quota_control_enabled INTEGER NOT NULL DEFAULT 0,
      requisition_policy TEXT NOT NULL DEFAULT 'OPEN',
      default_receipt_billing_mode TEXT NOT NULL DEFAULT 'SEPARATE',
      po_change_enabled INTEGER NOT NULL DEFAULT 1,
      receiving_tolerance_policy TEXT NOT NULL DEFAULT 'STRICT',
      return_policy TEXT NOT NULL DEFAULT 'STANDARD',
      prepayment_required_default INTEGER NOT NULL DEFAULT 0,
      numbering TEXT NOT NULL DEFAULT 'PERIOD_SEQ',
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      CHECK(id='DEFAULT'),
      CHECK(default_receipt_billing_mode IN ('SEPARATE','LEGACY_DIRECT','AUTO_BILL')),
      CHECK(receiving_tolerance_policy IN ('STRICT','SOFT_BAND'))
    );

    CREATE TABLE IF NOT EXISTS supplier_procurement_overrides (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      changed_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (changed_by) REFERENCES users(id),
      UNIQUE(supplier_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_procurement_overrides_effective
      ON supplier_procurement_overrides(supplier_id, effective_from, effective_to);

    CREATE TABLE IF NOT EXISTS buyers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchasing_groups (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS buyer_memberships (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      purchasing_group_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (buyer_id) REFERENCES buyers(id),
      FOREIGN KEY (purchasing_group_id) REFERENCES purchasing_groups(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(buyer_id, purchasing_group_id),
      CHECK(role IN ('MEMBER','LEAD'))
    );
    CREATE INDEX IF NOT EXISTS idx_buyer_memberships_group
      ON buyer_memberships(purchasing_group_id, buyer_id);

    CREATE TABLE IF NOT EXISTS source_list_entries (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(supplier_id, product_id, source_type, version),
      CHECK(source_type IN ('PURCHASE','OUTSOURCE'))
    );
    CREATE INDEX IF NOT EXISTS idx_source_list_resolution
      ON source_list_entries(product_id, source_type, enabled, effective_from, effective_to);

    CREATE TABLE IF NOT EXISTS source_list_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES source_list_entries(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(entry_id, version)
    );

    CREATE TABLE IF NOT EXISTS quota_assignments (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      proportion_num INTEGER NOT NULL,
      proportion_den INTEGER NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(supplier_id, product_id, source_type, version),
      CHECK(source_type IN ('PURCHASE','OUTSOURCE')),
      CHECK(proportion_num > 0),
      CHECK(proportion_den > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_quota_resolution
      ON quota_assignments(product_id, source_type, effective_from, effective_to);

    CREATE TABLE IF NOT EXISTS sourcing_decisions (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      procurement_source_type TEXT NOT NULL,
      product_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      business_date TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      override_reason TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(source_type IN ('PR','PO')),
      CHECK(procurement_source_type IN ('PURCHASE','OUTSOURCE')),
      CHECK(status IN ('DRAFT','APPLIED','OVERRIDDEN'))
    );
    CREATE INDEX IF NOT EXISTS idx_sourcing_decisions_source
      ON sourcing_decisions(source_type, source_id, created_at);

    CREATE TABLE IF NOT EXISTS sourcing_decision_allocations (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      source_list_entry_id TEXT,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_quantity_num INTEGER NOT NULL,
      source_quantity_den INTEGER NOT NULL,
      allocated_quantity_num INTEGER NOT NULL,
      allocated_quantity_den INTEGER NOT NULL,
      rule_reason TEXT NOT NULL,
      FOREIGN KEY (decision_id) REFERENCES sourcing_decisions(id),
      FOREIGN KEY (source_list_entry_id) REFERENCES source_list_entries(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(decision_id, source_list_entry_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_price_list_entries (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      pricing_uom_code TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(supplier_id, product_id, source_type, pricing_uom_code, version),
      CHECK(source_type IN ('PURCHASE','OUTSOURCE')),
      CHECK(status IN ('ACTIVE','INACTIVE')),
      CHECK(unit_price_cents >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_price_resolution
      ON purchase_price_list_entries(supplier_id, product_id, source_type, pricing_uom_code, status, effective_from, effective_to);

    CREATE TABLE IF NOT EXISTS purchase_price_list_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES purchase_price_list_entries(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(entry_id, version)
    );

    CREATE TABLE IF NOT EXISTS pricing_discount_schemes (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      basis TEXT NOT NULL,
      value_numerator INTEGER NOT NULL,
      denominator INTEGER NOT NULL,
      formula_json TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(supplier_id, product_id, source_type, version),
      CHECK(source_type IN ('PURCHASE','OUTSOURCE')),
      CHECK(basis IN ('PERCENT','FLAT')),
      CHECK(status IN ('ACTIVE','INACTIVE')),
      CHECK(value_numerator >= 0),
      CHECK(denominator > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_pricing_discount_resolution
      ON pricing_discount_schemes(supplier_id, product_id, source_type, status, effective_from, effective_to);
  `);

  safeAddColumn(db, 'suppliers', 'procurement_enabled', 'procurement_enabled INTEGER NOT NULL DEFAULT 1');
  safeAddColumn(db, 'suppliers', 'outsourcing_enabled', 'outsourcing_enabled INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'suppliers', 'supplier_category', "supplier_category TEXT NOT NULL DEFAULT 'GENERAL'");
  safeAddColumn(db, 'suppliers', 'qualification_status', "qualification_status TEXT NOT NULL DEFAULT 'UNQUALIFIED'");
  safeAddColumn(db, 'suppliers', 'qualification_valid_from', 'qualification_valid_from TEXT');
  safeAddColumn(db, 'suppliers', 'qualification_valid_to', 'qualification_valid_to TEXT');
  safeAddColumn(db, 'suppliers', 'default_payment_terms_days', 'default_payment_terms_days INTEGER');
  safeAddColumn(db, 'suppliers', 'default_currency', "default_currency TEXT NOT NULL DEFAULT 'CNY'");
  safeAddColumn(db, 'suppliers', 'supplier_wip_warehouse_id', 'supplier_wip_warehouse_id TEXT');
  safeAddColumn(db, 'suppliers', 'outsourcing_qualification_note', "outsourcing_qualification_note TEXT NOT NULL DEFAULT ''");

  safeAddColumn(db, 'purchase_orders', 'buyer_id', 'buyer_id TEXT');
  safeAddColumn(db, 'purchase_orders', 'purchasing_group_id', 'purchasing_group_id TEXT');
  safeAddColumn(db, 'purchase_orders', 'business_type', "business_type TEXT NOT NULL DEFAULT 'STANDARD_PURCHASE'");
  safeAddColumn(db, 'purchase_orders', 'source_outsourcing_order_id', 'source_outsourcing_order_id TEXT');
  safeAddColumn(db, 'purchase_orders', 'supplier_contact_snapshot', 'supplier_contact_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'supplier_address_snapshot', 'supplier_address_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'payment_terms_snapshot', 'payment_terms_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'prepayment_required', 'prepayment_required INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'purchase_order_items', 'is_gift_line', 'is_gift_line INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_notices (
      id TEXT PRIMARY KEY,
      notice_no TEXT NOT NULL UNIQUE,
      purchase_order_id TEXT,
      business_type TEXT NOT NULL DEFAULT 'STANDARD_PURCHASE',
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      notice_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      handler_id TEXT,
      remark TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(business_type IN ('STANDARD_PURCHASE','OUTSOURCE'))
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_notices_order ON receipt_notices(purchase_order_id, status);

    CREATE TABLE IF NOT EXISTS receipt_notice_items (
      id TEXT PRIMARY KEY,
      notice_id TEXT NOT NULL,
      purchase_order_item_id TEXT,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (notice_id) REFERENCES receipt_notices(id),
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_notice_items_notice ON receipt_notice_items(notice_id);

    CREATE TABLE IF NOT EXISTS purchase_order_delivery_schedules (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      planned_quantity REAL NOT NULL,
      planned_date TEXT NOT NULL,
      received_quantity REAL NOT NULL DEFAULT 0,
      upper_tolerance_pct REAL NOT NULL DEFAULT 0,
      lower_tolerance_pct REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_po_delivery_schedule ON purchase_order_delivery_schedules(order_item_id, planned_date);

    CREATE TABLE IF NOT EXISTS purchase_order_changes (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      payload_json TEXT NOT NULL,
      original_json TEXT,
      requested_json TEXT,
      applied_json TEXT,
      approver_id TEXT,
      approved_at TEXT,
      applied_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (approver_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(action IN ('ADD','MODIFY','CANCEL')),
      CHECK(status IN ('DRAFT','APPROVED','APPLIED','REJECTED'))
    );
    CREATE INDEX IF NOT EXISTS idx_po_changes_order ON purchase_order_changes(order_id, created_at);

    CREATE TABLE IF NOT EXISTS purchase_return_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      receipt_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      request_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      business_mode TEXT NOT NULL DEFAULT 'SEPARATE',
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_return_requests_receipt ON purchase_return_requests(receipt_id);
  `);

  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO procurement_parameters(
    id,source_control_enabled,quota_control_enabled,requisition_policy,
    default_receipt_billing_mode,po_change_enabled,receiving_tolerance_policy,
    return_policy,prepayment_required_default,numbering,updated_at
  ) VALUES('DEFAULT',1,0,'OPEN','SEPARATE',1,'STRICT','STANDARD',0,'PERIOD_SEQ',?)`).run(now);
}
