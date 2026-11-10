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
      ON source_list_entries(product_id, source_type, enabled);

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
      ON quota_assignments(product_id, source_type);

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
      ON purchase_price_list_entries(supplier_id, product_id, pricing_uom_code, status);

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
      ON pricing_discount_schemes(supplier_id, product_id, status);
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
  const duplicateProcessingSource = db.prepare(`SELECT source_outsourcing_order_id source_id, COUNT(*) duplicate_count
    FROM purchase_orders WHERE source_outsourcing_order_id IS NOT NULL
    GROUP BY source_outsourcing_order_id HAVING COUNT(*) > 1 LIMIT 1`).get();
  if (duplicateProcessingSource) {
    throw new Error(`PROCESSING_PO_SOURCE_HISTORY_CONFLICT:${duplicateProcessingSource.source_id}:${duplicateProcessingSource.duplicate_count}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_source_outsourcing ON purchase_orders(source_outsourcing_order_id)');
  safeAddColumn(db, 'purchase_orders', 'supplier_contact_snapshot', 'supplier_contact_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'supplier_address_snapshot', 'supplier_address_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'payment_terms_snapshot', 'payment_terms_snapshot TEXT');
  safeAddColumn(db, 'purchase_orders', 'prepayment_required', 'prepayment_required INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'purchase_orders', 'version', 'version INTEGER NOT NULL DEFAULT 1');
  // 商业快照：结算供应商与付款供应商默认等于供货供应商，可被显式覆盖（PRC-14）。
  safeAddColumn(db, 'purchase_orders', 'settlement_supplier_id', 'settlement_supplier_id TEXT');
  safeAddColumn(db, 'purchase_orders', 'payee_supplier_id', 'payee_supplier_id TEXT');
  safeAddColumn(db, 'purchase_order_items', 'is_gift_line', 'is_gift_line INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'purchase_order_items', 'version', 'version INTEGER NOT NULL DEFAULT 1');
  safeAddColumn(db, 'purchase_order_items', 'execution_status', "execution_status TEXT NOT NULL DEFAULT 'OPEN'");
  safeAddColumn(db, 'purchase_order_items', 'pricing_uom_code', 'pricing_uom_code TEXT');
  safeAddColumn(db, 'purchase_order_items', 'pricing_quantity_num', 'pricing_quantity_num INTEGER');
  safeAddColumn(db, 'purchase_order_items', 'pricing_quantity_den', 'pricing_quantity_den INTEGER');
  safeAddColumn(db, 'purchase_order_items', 'price_entry_id', 'price_entry_id TEXT');
  safeAddColumn(db, 'purchase_order_items', 'price_version', 'price_version INTEGER');
  safeAddColumn(db, 'purchase_order_items', 'pricing_evidence_json', 'pricing_evidence_json TEXT');
  // 价格与折扣来源：价格来源已是 price_entry_id，折扣来源单独冻结（PRC-09 / PRC-14）。
  safeAddColumn(db, 'purchase_order_items', 'pricing_discount_scheme_id', 'pricing_discount_scheme_id TEXT');
  safeAddColumn(db, 'purchase_order_items', 'discount_source', 'discount_source TEXT');

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

    CREATE TABLE IF NOT EXISTS po_change_items (
      id TEXT PRIMARY KEY,
      change_id TEXT NOT NULL,
      order_item_id TEXT,
      line_no INTEGER NOT NULL,
      action TEXT NOT NULL,
      requested_json TEXT NOT NULL,
      snapshot_before_json TEXT,
      snapshot_after_json TEXT,
      FOREIGN KEY (change_id) REFERENCES purchase_order_changes(id),
      FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id),
      CHECK(action IN ('ADD','MODIFY','CANCEL')),
      UNIQUE(change_id, line_no)
    );
    CREATE INDEX IF NOT EXISTS idx_po_change_items_change ON po_change_items(change_id, line_no);

    CREATE TABLE IF NOT EXISTS purchase_order_item_versions (
      id TEXT PRIMARY KEY,
      order_item_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      source_change_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (source_change_id) REFERENCES purchase_order_changes(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(order_item_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_order_item_versions_order ON purchase_order_item_versions(order_id, order_item_id, version);

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



    CREATE TABLE IF NOT EXISTS vmi_agreements (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      min_stock REAL NOT NULL DEFAULT 0,
      max_stock REAL NOT NULL DEFAULT 0,
      reorder_level REAL NOT NULL DEFAULT 0,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      CHECK(max_stock >= min_stock)
    );
    CREATE INDEX IF NOT EXISTS idx_vmi_agreements_effective ON vmi_agreements(supplier_id, product_id);
    -- VMI Agreement 是 VMI 业务事实本身：同一 supplier+warehouse+product 在
    -- 任一业务日期至多存在一个有效协议；区间重叠只能靠事务内检测证明，
    -- 普通组合 UNIQUE 判定不了重叠。
    CREATE INDEX IF NOT EXISTS idx_vmi_agreements_binding ON vmi_agreements(supplier_id, warehouse_id, product_id, effective_from);

    CREATE TABLE IF NOT EXISTS vmi_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      received_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'PENDING',
      handler_id TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(business_status IN ('PENDING','CONFIRMED','CONSUMED','TRANSFERRED','CANCELLED'))
    );
    CREATE INDEX IF NOT EXISTS idx_vmi_receipts_supplier ON vmi_receipts(supplier_id, product_id, warehouse_id);

    CREATE TABLE IF NOT EXISTS vmi_consumptions (
      id TEXT PRIMARY KEY,
      consumption_no TEXT NOT NULL UNIQUE,
      vmi_receipt_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      consumed_date TEXT NOT NULL,
      destination TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      business_status TEXT NOT NULL DEFAULT 'PENDING',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vmi_receipt_id) REFERENCES vmi_receipts(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(business_status IN ('PENDING','CONFIRMED','CANCELLED'))
    );
    CREATE INDEX IF NOT EXISTS idx_vmi_consumptions_receipt ON vmi_consumptions(vmi_receipt_id);

    CREATE TABLE IF NOT EXISTS vmi_ownership_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      vmi_receipt_id TEXT NOT NULL,
      settlement_quantity REAL NOT NULL,
      settlement_amount_cents INTEGER NOT NULL,
      transfer_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'PENDING',
      supplier_bill_id TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vmi_receipt_id) REFERENCES vmi_receipts(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(business_status IN ('PENDING','CONFIRMED','CANCELLED'))
    );
    CREATE INDEX IF NOT EXISTS idx_vmi_ownership_transfers_receipt ON vmi_ownership_transfers(vmi_receipt_id);

    CREATE TABLE IF NOT EXISTS outsourcing_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      order_quantity REAL NOT NULL,
      required_quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'EA',
      source_type TEXT NOT NULL,
      planning_handoff_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      business_date TEXT NOT NULL,
      expected_completion_date TEXT,
      bom_id TEXT,
      bom_version INTEGER,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      UNIQUE(planning_handoff_id),
      CHECK(source_type IN ('PLANNING','MANUAL')),
      CHECK(status IN ('DRAFT','PLAN_CONFIRMED','RELEASED','COMPLETED','CLOSED','CANCELLED'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_orders_supplier ON outsourcing_orders(supplier_id, status);

    CREATE TABLE IF NOT EXISTS outsourcing_material_list (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      required_quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      issued_quantity REAL NOT NULL DEFAULT 0,
      supplemented_quantity REAL NOT NULL DEFAULT 0,
      returned_quantity REAL NOT NULL DEFAULT 0,
      backflushed_quantity REAL NOT NULL DEFAULT 0,
      bom_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_material_list_order ON outsourcing_material_list(order_id);

    CREATE TABLE IF NOT EXISTS outsourcing_issues (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      material_list_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      issued_date TEXT NOT NULL,
      from_warehouse_id TEXT NOT NULL,
      to_warehouse_id TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      idempotency_key TEXT UNIQUE,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_issues_order ON outsourcing_issues(order_id);

    CREATE TABLE IF NOT EXISTS outsourcing_supplements (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      material_list_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      supplement_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS outsourcing_returns (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      material_list_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      from_warehouse_id TEXT NOT NULL,
      to_warehouse_id TEXT NOT NULL,
      return_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS outsourcing_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      processing_po_id TEXT,
      quantity REAL NOT NULL,
      received_date TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      processing_fee_cents INTEGER NOT NULL DEFAULT 0,
      backflush_material_value_cents INTEGER NOT NULL DEFAULT 0,
      total_cost_cents INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (processing_po_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_receipts_order ON outsourcing_receipts(order_id);

    CREATE TABLE IF NOT EXISTS outsourcing_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (receipt_id) REFERENCES outsourcing_receipts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_receipt_items_receipt ON outsourcing_receipt_items(receipt_id);

    CREATE TABLE IF NOT EXISTS outsourcing_cost_evidences (
      id TEXT PRIMARY KEY,
      outsourcing_receipt_id TEXT NOT NULL UNIQUE,
      processing_po_id TEXT,
      material_consumed_value_cents INTEGER NOT NULL DEFAULT 0,
      processing_fee_provisional_cents INTEGER NOT NULL DEFAULT 0,
      processing_fee_actual_cents INTEGER,
      variance_cents INTEGER,
      basis_status TEXT NOT NULL DEFAULT 'PROVISIONAL',
      calculated_at TEXT NOT NULL,
      FOREIGN KEY (outsourcing_receipt_id) REFERENCES outsourcing_receipts(id),
      FOREIGN KEY (processing_po_id) REFERENCES purchase_orders(id),
      CHECK(basis_status IN ('PROVISIONAL','FINAL'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_cost_evidences_receipt
      ON outsourcing_cost_evidences(outsourcing_receipt_id);

    CREATE TABLE IF NOT EXISTS outsourcing_finished_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT NOT NULL UNIQUE,
      outsourcing_receipt_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      return_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (outsourcing_receipt_id) REFERENCES outsourcing_receipts(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS outsourcing_finished_return_credits (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      supplier_bill_id TEXT NOT NULL,
      supplier_bill_item_id TEXT NOT NULL,
      commercial_credit_note_id TEXT NOT NULL,
      billed_quantity REAL NOT NULL,
      credit_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (return_id) REFERENCES outsourcing_finished_returns(id),
      FOREIGN KEY (supplier_bill_id) REFERENCES supplier_bills(id),
      FOREIGN KEY (supplier_bill_item_id) REFERENCES supplier_bill_items(id),
      FOREIGN KEY (commercial_credit_note_id) REFERENCES commercial_credit_notes(id),
      UNIQUE(return_id, supplier_bill_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_finished_return_credits_return
      ON outsourcing_finished_return_credits(return_id);

    CREATE TABLE IF NOT EXISTS outsourcing_wip_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      source_order_id TEXT NOT NULL,
      target_order_id TEXT NOT NULL,
      material_list_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      transfer_date TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (target_order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS outsourcing_period_differences (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      material_list_id TEXT NOT NULL,
      expected_quantity REAL NOT NULL,
      actual_quantity REAL NOT NULL,
      difference_quantity REAL NOT NULL,
      period_key TEXT NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'PREVIEW',
      applied_supplement_id TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      CHECK(business_status IN ('PREVIEW','ALLOCATED','APPLIED','CANCELLED'))
    );

    CREATE TABLE IF NOT EXISTS receipt_notice_item_sources (
      id TEXT PRIMARY KEY,
      notice_item_id TEXT NOT NULL,
      purchase_order_item_id TEXT NOT NULL,
      delivery_schedule_id TEXT,
      allocated_quantity REAL NOT NULL CHECK(allocated_quantity > 0),
      converted_quantity REAL,
      source_trace_json TEXT NOT NULL DEFAULT '{}',
      business_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notice_item_id) REFERENCES receipt_notice_items(id),
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (delivery_schedule_id) REFERENCES purchase_order_delivery_schedules(id),
      UNIQUE(notice_item_id, purchase_order_item_id),
      CHECK(converted_quantity IS NULL OR (converted_quantity >= 0 AND converted_quantity <= allocated_quantity))
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_notice_item_sources_notice
      ON receipt_notice_item_sources(notice_item_id, id);
    CREATE INDEX IF NOT EXISTS idx_receipt_notice_item_sources_capacity
      ON receipt_notice_item_sources(purchase_order_item_id, delivery_schedule_id, id);

    CREATE TABLE IF NOT EXISTS schedule_consumption_effects (
      id TEXT PRIMARY KEY,
      purchase_order_item_id TEXT NOT NULL,
      delivery_schedule_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      business_event_type TEXT NOT NULL,
      business_event_id TEXT NOT NULL,
      business_event_item_id TEXT NOT NULL,
      signed_quantity REAL NOT NULL CHECK(signed_quantity <> 0),
      reverses_effect_id TEXT,
      reverses_effect_key TEXT NOT NULL,
      effect_state TEXT NOT NULL DEFAULT 'EFFECTIVE' CHECK(effect_state IN ('EFFECTIVE','VOIDED')),
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      business_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
      FOREIGN KEY (delivery_schedule_id) REFERENCES purchase_order_delivery_schedules(id),
      FOREIGN KEY (reverses_effect_id) REFERENCES schedule_consumption_effects(id),
      UNIQUE(business_event_type, business_event_id, business_event_item_id, reverses_effect_key),
      CHECK((signed_quantity > 0 AND reverses_effect_id IS NULL AND reverses_effect_key = '')
         OR (signed_quantity < 0 AND reverses_effect_id IS NOT NULL AND reverses_effect_key <> ''))
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_consumption_effects_capacity
      ON schedule_consumption_effects(purchase_order_item_id, delivery_schedule_id, effect_state, id);
    CREATE INDEX IF NOT EXISTS idx_schedule_consumption_effects_reversal
      ON schedule_consumption_effects(reverses_effect_id, effect_state, id);

    CREATE TABLE IF NOT EXISTS outsourcing_wip_identity_effects (
      id TEXT PRIMARY KEY,
      material_list_id TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      identity_type TEXT NOT NULL CHECK(identity_type IN ('LOT','SERIAL','NONE')),
      lot_id TEXT,
      serial_id TEXT,
      effect_direction TEXT NOT NULL CHECK(effect_direction IN ('SUPPLY','CONSUME')),
      signed_quantity REAL NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('ISSUE','SUPPLEMENT','TRANSFER_IN','RETURN','BACKFLUSH','TRANSFER_OUT')),
      business_event_id TEXT NOT NULL,
      business_event_item_id TEXT NOT NULL,
      source_effect_id TEXT,
      business_date TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (source_effect_id) REFERENCES outsourcing_wip_identity_effects(id),
      UNIQUE(event_type, business_event_id, business_event_item_id, identity_key),
      CHECK((identity_type='LOT' AND lot_id IS NOT NULL AND serial_id IS NULL)
         OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL)
         OR (identity_type='NONE' AND lot_id IS NULL AND serial_id IS NULL)),
      CHECK((effect_direction='SUPPLY' AND signed_quantity > 0)
         OR (effect_direction='CONSUME' AND signed_quantity < 0))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_wip_identity_effects_balance
      ON outsourcing_wip_identity_effects(material_list_id, identity_key, created_at, id);

    CREATE TABLE IF NOT EXISTS outsourcing_wip_identity_effect_allocations (
      id TEXT PRIMARY KEY,
      effect_id TEXT NOT NULL,
      source_supply_effect_id TEXT NOT NULL,
      allocation_kind TEXT NOT NULL CHECK(allocation_kind IN ('CONSUMPTION','TRANSFER_ORIGIN')),
      allocated_quantity REAL NOT NULL CHECK(allocated_quantity > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (effect_id) REFERENCES outsourcing_wip_identity_effects(id),
      FOREIGN KEY (source_supply_effect_id) REFERENCES outsourcing_wip_identity_effects(id),
      UNIQUE(effect_id, source_supply_effect_id, allocation_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_wip_allocations_source
      ON outsourcing_wip_identity_effect_allocations(source_supply_effect_id, effect_id);

    CREATE TABLE IF NOT EXISTS outsourcing_wip_identity_balances (
      material_list_id TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      identity_type TEXT NOT NULL CHECK(identity_type IN ('LOT','SERIAL','NONE')),
      lot_id TEXT,
      serial_id TEXT,
      evidence_state TEXT NOT NULL CHECK(evidence_state IN ('TRACKED','QUANTITY_ONLY')),
      supplied_quantity REAL NOT NULL DEFAULT 0 CHECK(supplied_quantity >= 0),
      consumed_quantity REAL NOT NULL DEFAULT 0 CHECK(consumed_quantity >= 0),
      available_quantity REAL NOT NULL DEFAULT 0 CHECK(available_quantity >= 0),
      last_effect_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(material_list_id, identity_key),
      FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
      FOREIGN KEY (last_effect_id) REFERENCES outsourcing_wip_identity_effects(id),
      CHECK((identity_type='LOT' AND lot_id IS NOT NULL AND serial_id IS NULL AND evidence_state='TRACKED')
         OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL AND evidence_state='TRACKED')
         OR (identity_type='NONE' AND lot_id IS NULL AND serial_id IS NULL AND evidence_state='QUANTITY_ONLY')),
      CHECK(available_quantity = supplied_quantity - consumed_quantity)
    );
  `);

  // 每一张 VMI 收货都必须能证明它绑定了哪一份有效协议。历史行保持 NULL，
  // 由后续 Confirm / Consumption 读时 fail closed，不推定绑定、不回填。
  safeAddColumn(db, 'vmi_receipts', 'agreement_id', 'agreement_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vmi_receipts_agreement ON vmi_receipts(agreement_id)');

    // 退货申请是业务意图层：它必须能说清“退什么、为什么退、退多少”，并且在
    // 未入库货物上根本不存在来源行（Design §26.14 PRC-24）。
    safeAddColumn(db, 'purchase_return_requests', 'source_type', "source_type TEXT NOT NULL DEFAULT 'PURCHASE_RECEIPT'");
    safeAddColumn(db, 'purchase_return_requests', 'source_id', 'source_id TEXT');
    safeAddColumn(db, 'purchase_return_requests', 'request_type', "request_type TEXT NOT NULL DEFAULT 'COMMERCIAL'");
    safeAddColumn(db, 'purchase_return_requests', 'reason_code', 'reason_code TEXT');
    safeAddColumn(db, 'purchase_return_requests', 'reason_text', 'reason_text TEXT');
    safeAddColumn(db, 'purchase_return_requests', 'replenishment_method', 'replenishment_method TEXT');
    safeAddColumn(db, 'purchase_return_requests', 'business_date', 'business_date TEXT');
    safeAddColumn(db, 'purchase_return_requests', 'posted_return_id', 'posted_return_id TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS purchase_return_request_items (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      receipt_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity_num INTEGER NOT NULL,
      quantity_den INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (request_id) REFERENCES purchase_return_requests(id),
      FOREIGN KEY (receipt_item_id) REFERENCES purchase_receipt_items(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      CHECK(quantity_num > 0),
      CHECK(quantity_den > 0),
      UNIQUE(request_id, line_no)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_return_request_items_request ON purchase_return_request_items(request_id, line_no)');
    // 正式转换后的采购退货单必须能回链它的业务意图来源。
    safeAddColumn(db, 'purchase_returns', 'return_request_id', 'return_request_id TEXT');

  // 交期区间与批次序号：多次交货的 earliest/latest 边界（PRC-16）。
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'planned_date_from', 'planned_date_from TEXT');
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'planned_date_to', 'planned_date_to TEXT');
  safeAddColumn(db, 'purchase_order_delivery_schedules', 'sequence_no', 'sequence_no INTEGER');

  safeAddColumn(db, 'purchase_order_changes', 'scope', "scope TEXT NOT NULL DEFAULT 'LINE'");
  safeAddColumn(db, 'purchase_order_changes', 'order_version_before', 'order_version_before INTEGER');
  safeAddColumn(db, 'purchase_order_changes', 'idempotency_key', 'idempotency_key TEXT');
  safeAddColumn(db, 'purchase_order_changes', 'request_fingerprint', 'request_fingerprint TEXT');
  safeAddColumn(db, 'purchase_order_changes', 'snapshot_before_json', 'snapshot_before_json TEXT');
  safeAddColumn(db, 'purchase_order_changes', 'snapshot_after_json', 'snapshot_after_json TEXT');
  safeAddColumn(db, 'purchase_order_changes', 'applied_by', 'applied_by TEXT');
  safeAddColumn(db, 'purchase_order_changes', 'updated_at', 'updated_at TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_po_change_idempotency ON purchase_order_changes(created_by, idempotency_key)');

  // M1C-WP-0 is schema-only: these additive columns never infer or backfill
  // historical business facts. NULL remains the fail-closed legacy state.
  safeAddColumn(db, 'purchase_receipts', 'source_notice_id', 'source_notice_id TEXT');
  safeAddColumn(db, 'purchase_receipt_items', 'source_notice_item_source_id', 'source_notice_item_source_id TEXT');
  safeAddColumn(db, 'purchase_receipt_items', 'delivery_schedule_id', 'delivery_schedule_id TEXT');
  safeAddColumn(db, 'outsourcing_receipts', 'warehouse_id', 'warehouse_id TEXT');
  safeAddColumn(db, 'outsourcing_receipts', 'source_notice_id', 'source_notice_id TEXT');
  safeAddColumn(db, 'outsourcing_receipts', 'business_date', 'business_date TEXT');
  safeAddColumn(db, 'outsourcing_receipts', 'version', 'version INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'outsourcing_receipt_items', 'delivery_schedule_id', 'delivery_schedule_id TEXT');
  safeAddColumn(db, 'outsourcing_receipt_items', 'lot_id', 'lot_id TEXT');
  safeAddColumn(db, 'outsourcing_receipt_items', 'serial_id', 'serial_id TEXT');
  safeAddColumn(db, 'outsourcing_receipt_items', 'unit_code', "unit_code TEXT NOT NULL DEFAULT 'EA'");
  safeAddColumn(db, 'outsourcing_receipt_items', 'processing_po_item_id', 'processing_po_item_id TEXT');
  safeAddColumn(db, 'outsourcing_receipt_items', 'source_notice_item_source_id', 'source_notice_item_source_id TEXT');
  safeAddColumn(db, 'outsourcing_material_list', 'source_warehouse_id', 'source_warehouse_id TEXT');
  safeAddColumn(db, 'outsourcing_material_list', 'legacy_unverified_wip_quantity', 'legacy_unverified_wip_quantity REAL');
  safeAddColumn(db, 'outsourcing_material_list', 'identity_evidence_state', "identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'");

  // Item-level commercial source for Supplier Bill (extending canonical supplier_bill_items).
  safeAddColumn(db, 'supplier_bill_items', 'commercial_source_type', "commercial_source_type TEXT");
  safeAddColumn(db, 'supplier_bill_items', 'commercial_source_id', 'commercial_source_id TEXT');
  safeAddColumn(db, 'supplier_bill_items', 'commercial_source_item_id', 'commercial_source_item_id TEXT');
  safeAddColumn(db, 'supplier_bill_items', 'source_outsourcing_receipt_item_id', 'source_outsourcing_receipt_item_id TEXT');
  safeAddColumn(db, 'supplier_bill_items', 'source_outsourcing_po_line_id', 'source_outsourcing_po_line_id TEXT');
  safeAddColumn(db, 'supplier_bill_items', 'source_outsourcing_receipt_id', 'source_outsourcing_receipt_id TEXT');
  safeAddColumn(db, 'supplier_bills', 'source_outsourcing_receipt_id', 'source_outsourcing_receipt_id TEXT');

  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO procurement_parameters(
    id,source_control_enabled,quota_control_enabled,requisition_policy,
    default_receipt_billing_mode,po_change_enabled,receiving_tolerance_policy,
    return_policy,prepayment_required_default,numbering,updated_at
  ) VALUES('DEFAULT',1,0,'OPEN','SEPARATE',1,'STRICT','STANDARD',0,'PERIOD_SEQ',?)`).run(now);
}
