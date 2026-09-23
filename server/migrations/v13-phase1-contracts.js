// V1.3 Phase 1 — Process Integrity Foundations
//
// Additive schema for the canonical five-role + money + date +
// commercial contract. All new columns are either TEXT with a default
// of '' or nullable TEXT. No historical dates are fabricated; legacy
// rows are simply not subject to the new submission invariants, which
// are enforced by the application layer against the new columns only.
//
// Affected tables:
//   - sales_orders          (order date, requested delivery date, ship-to / payment snapshot)
//   - purchase_orders       (order date, expected delivery date, supplier / payment snapshot)
//   - purchase_requisitions (explicit request/document date; required_date already exists)
//
// Affected application invariants:
//   - SO SUBMIT requires order_date, requested_delivery_date, ship_to_*, payment_terms
//   - PO SUBMIT requires order_date, expected_delivery_date (>= order_date),
//     supplier_contact_*, supplier_address, payment_terms, unit price > 0
//   - PR item unit_price_cents is allowed to be 0 (estimate), but the
//     generated PO inherits it and PO SUBMIT blocks <= 0.
//   - MRP openSalesDemand uses sales_orders.requested_delivery_date.
//     Workflow timestamps are a read-only compatibility fallback only
//     for legacy rows where both V1.3 business-date columns are null.
//
// V1.3 Phase 1 also reconciles the canonical five role-permission
// contracts on legacy DBs: rows that should NOT be on a role are
// removed (e.g. role-sales losing PURCHASE_RECEIPTS_MANAGE) and rows
// that SHOULD be on a role are added (e.g. role-reviewer gaining
// INVENTORY_CHECK_APPROVE). The reconciliation is idempotent across
// multiple createDatabase opens and never removes a permission that
// admin inherits from all-permissions.

const V13_DESIRED_ROLE_PERMISSIONS = {
  'role-sales': [
    'DASHBOARD_VIEW', 'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE',
    'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'PRODUCTS_VIEW',
    'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT',
    'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT',
    'PURCHASE_REQUISITION_VIEW', 'PURCHASE_REQUISITION_MANAGE',
    'CRM_VIEW', 'CRM_MANAGE',
  ],
  'role-reviewer': [
    'DASHBOARD_VIEW', 'CUSTOMERS_VIEW', 'PRODUCTS_VIEW',
    'ORDERS_VIEW', 'ORDERS_APPROVE',
    'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_APPROVE',
    'WAREHOUSES_VIEW', 'INVENTORY_VIEW',
    'PURCHASE_RECEIPTS_VIEW', 'SALES_DELIVERIES_VIEW', 'RETURNS_VIEW',
    'PURCHASE_REQUISITION_VIEW', 'PURCHASE_REQUISITION_APPROVE',
    'INVENTORY_CHECK_APPROVE',
  ],
  'role-warehouse': [
    'DASHBOARD_VIEW', 'PRODUCTS_VIEW',
    'WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE', 'INVENTORY_VIEW',
    'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE',
    'INVENTORY_ADJUSTMENT_MANAGE',
    'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE',
    'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE',
    'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE',
    'RETURNS_VIEW', 'RETURNS_MANAGE',
    'IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE',
    'PRODUCTION_MATERIAL_ISSUE_MANAGE', 'PRODUCTION_RECEIPT_MANAGE',
  ],
  'role-accounting': [
    'DASHBOARD_VIEW', 'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW',
    'ORDERS_VIEW', 'PURCHASE_ORDERS_VIEW',
    'CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE',
    'BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE',
    'BILLS_VIEW', 'BILLS_MANAGE',
    'FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE',
    'AR_VIEW', 'COLLECTION_MANAGE',
    'AP_VIEW', 'PAYMENT_MANAGE',
    'SALES_DISCOUNT_MANAGE', 'PURCHASE_DISCOUNT_MANAGE',
  ],
};

function reconcileV13RolePermissions(db) {
  // Only reconcile the four non-admin roles; admin inherits every
  // registered permission via all-permissions in seed() and is
  // therefore authoritative by definition.
  const knownCodes = new Set(
    db.prepare('SELECT code FROM permissions').all().map((row) => row.code),
  );
  const removeStmt = db.prepare(
    'DELETE FROM role_permissions WHERE role_id = ? AND permission_code = ?',
  );
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)',
  );
  for (const [roleId, desired] of Object.entries(V13_DESIRED_ROLE_PERMISSIONS)) {
    const desiredSet = new Set(desired);
    const current = db.prepare(
      'SELECT permission_code FROM role_permissions WHERE role_id = ?',
    ).all(roleId).map((row) => row.permission_code);
    const currentSet = new Set(current);
    // Remove rows that are no longer in the desired set (and exist as
    // registered permission codes — never delete unknown rows to keep
    // future permission migration behavior non-destructive).
    for (const code of current) {
      if (!desiredSet.has(code) && knownCodes.has(code)) {
        removeStmt.run(roleId, code);
      }
    }
    // Add rows that are in the desired set but missing.
    for (const code of desired) {
      if (knownCodes.has(code) && !currentSet.has(code)) {
        insertStmt.run(roleId, code);
      }
    }
  }
}

export function migrateV13Phase1Contracts(db) {
  const addColumn = (sql) => {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  };

  // ---- sales_orders: business date + ship-to / payment snapshot ----
  addColumn("ALTER TABLE sales_orders ADD COLUMN order_date TEXT");
  addColumn("ALTER TABLE sales_orders ADD COLUMN requested_delivery_date TEXT");
  addColumn("ALTER TABLE sales_orders ADD COLUMN payment_terms TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE sales_orders ADD COLUMN ship_to_contact_name TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE sales_orders ADD COLUMN ship_to_phone TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE sales_orders ADD COLUMN ship_to_address TEXT NOT NULL DEFAULT ''");

  // ---- purchase_orders: business date + supplier / payment snapshot ----
  addColumn("ALTER TABLE purchase_orders ADD COLUMN order_date TEXT");
  addColumn("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT");
  addColumn("ALTER TABLE purchase_orders ADD COLUMN payment_terms TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE purchase_orders ADD COLUMN supplier_contact_name TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE purchase_orders ADD COLUMN supplier_contact_phone TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE purchase_orders ADD COLUMN supplier_address TEXT NOT NULL DEFAULT ''");

  // ---- purchase_requisitions: explicit document date ----
  // Nullable for legacy rows: created_at is not fabricated into a contractual
  // business date. New documents populate this field at the API boundary.
  addColumn("ALTER TABLE purchase_requisitions ADD COLUMN request_date TEXT");

  // Lightweight indexes for the new date and status combinations used
  // by approval / MRP scans. Existing indexes on id / order_no / status
  // already cover most reads.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_orders_requested_delivery
      ON sales_orders(requested_delivery_date);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_delivery
      ON purchase_orders(expected_delivery_date);
  `);

  // Reconcile the four non-admin canonical role contracts so a legacy
  // DB opened after V1.3 deployment is fully on the new five-role model.
  reconcileV13RolePermissions(db);
}
