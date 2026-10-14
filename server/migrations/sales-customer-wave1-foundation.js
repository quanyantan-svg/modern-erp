// Sales & Customer Wave 1 — Commercial Foundation.
// Eight Sales-owned tables only. No existing-table, Master, or Platform
// schema changes are permitted in this wave.

export const SALES_WAVE1_TABLES = Object.freeze([
  'sales_parameters',
  'sales_groups',
  'salesperson_profiles',
  'salesperson_group_memberships',
  'customer_commercial_extensions',
  'customer_material_xref',
  'sales_sellable_scope_rules',
  'product_commercial_classification',
]);

export function migrateSalesCustomerWave1Foundation(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_groups (
      id TEXT PRIMARY KEY,
      group_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS salesperson_profiles (
      id TEXT PRIMARY KEY,
      salesperson_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      user_id TEXT UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_parameters (
      scope_key TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('SYSTEM','DOCUMENT_TYPE')),
      document_type TEXT,
      sellable_control_enabled INTEGER NOT NULL CHECK(sellable_control_enabled IN (0,1)),
      customer_material_xref_enabled INTEGER NOT NULL CHECK(customer_material_xref_enabled IN (0,1)),
      sales_group_data_scope_enabled INTEGER NOT NULL CHECK(sales_group_data_scope_enabled IN (0,1)),
      delivery_schedule_enabled INTEGER NOT NULL CHECK(delivery_schedule_enabled IN (0,1)),
      delivery_quantity_control_enabled INTEGER NOT NULL CHECK(delivery_quantity_control_enabled IN (0,1)),
      order_change_mode TEXT NOT NULL CHECK(order_change_mode IN ('DISABLED','CONTROLLED_DIRECT','CONTROLLED_DOCUMENT','BOTH')),
      reservation_behavior TEXT NOT NULL CHECK(reservation_behavior IN ('DISABLED','INVENTORY_LOCK','MANUAL_RESERVATION','ON_HAND_RESERVATION','EXPECTED_SUPPLY_RESERVATION')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      CHECK((scope_type='SYSTEM' AND scope_key='SYSTEM' AND document_type IS NULL) OR
            (scope_type='DOCUMENT_TYPE' AND document_type IS NOT NULL)),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS salesperson_group_memberships (
      id TEXT PRIMARY KEY,
      salesperson_id TEXT NOT NULL,
      sales_group_id TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      CHECK(effective_to IS NULL OR effective_to >= effective_from),
      UNIQUE(salesperson_id, sales_group_id, effective_from),
      FOREIGN KEY (salesperson_id) REFERENCES salesperson_profiles(id),
      FOREIGN KEY (sales_group_id) REFERENCES sales_groups(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_commercial_extensions (
      customer_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      settlement_party_customer_id TEXT,
      payer_customer_id TEXT,
      default_salesperson_id TEXT,
      default_sales_group_id TEXT,
      default_payment_terms_days INTEGER CHECK(default_payment_terms_days IS NULL OR default_payment_terms_days >= 0),
      default_settlement_method TEXT,
      sellable_scope_mode TEXT NOT NULL CHECK(sellable_scope_mode IN ('ALL_SALES_ENABLED','RULE_CONTROLLED')),
      effective_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      PRIMARY KEY (customer_id, effective_from),
      CHECK(effective_to IS NULL OR effective_to >= effective_from),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (settlement_party_customer_id) REFERENCES customers(id),
      FOREIGN KEY (payer_customer_id) REFERENCES customers(id),
      FOREIGN KEY (default_salesperson_id) REFERENCES salesperson_profiles(id),
      FOREIGN KEY (default_sales_group_id) REFERENCES sales_groups(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_material_xref (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      customer_material_code TEXT,
      customer_material_name TEXT,
      commercial_uom_code TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(effective_to IS NULL OR effective_to >= effective_from),
      UNIQUE(customer_id, product_id, effective_from),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (commercial_uom_code) REFERENCES uoms(code)
    );

    CREATE TABLE IF NOT EXISTS sales_sellable_scope_rules (
      id TEXT PRIMARY KEY,
      scope_dimension TEXT NOT NULL CHECK(scope_dimension IN ('CUSTOMER_PRODUCT','SALESPERSON_PRODUCT','SALESPERSON_CUSTOMER')),
      customer_id TEXT,
      salesperson_id TEXT,
      product_id TEXT,
      effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY')),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      CHECK(effective_to IS NULL OR effective_to >= effective_from),
      CHECK(
        (scope_dimension='CUSTOMER_PRODUCT' AND customer_id IS NOT NULL AND salesperson_id IS NULL AND product_id IS NOT NULL) OR
        (scope_dimension='SALESPERSON_PRODUCT' AND customer_id IS NULL AND salesperson_id IS NOT NULL AND product_id IS NOT NULL) OR
        (scope_dimension='SALESPERSON_CUSTOMER' AND customer_id IS NOT NULL AND salesperson_id IS NOT NULL AND product_id IS NULL)
      ),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (salesperson_id) REFERENCES salesperson_profiles(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS product_commercial_classification (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL UNIQUE,
      sales_enabled INTEGER NOT NULL CHECK(sales_enabled IN (0,1)),
      sales_uom_code TEXT,
      pricing_uom_code TEXT,
      default_upper_delivery_tolerance_bps INTEGER NOT NULL DEFAULT 0 CHECK(default_upper_delivery_tolerance_bps >= 0),
      default_lower_delivery_tolerance_bps INTEGER NOT NULL DEFAULT 0 CHECK(default_lower_delivery_tolerance_bps >= 0 AND default_lower_delivery_tolerance_bps <= 10000),
      service_classification INTEGER NOT NULL DEFAULT 0 CHECK(service_classification IN (0,1)),
      service_kind TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      CHECK((service_classification=0 AND service_kind IS NULL) OR service_classification=1),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (sales_uom_code) REFERENCES uoms(code),
      FOREIGN KEY (pricing_uom_code) REFERENCES uoms(code),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

  `);

  // The MySQL bootstrap derives and reconciles indexes from the canonical
  // SQLite snapshot before this live registry runs. MySQL 8 does not accept
  // SQLite's CREATE INDEX IF NOT EXISTS syntax, so only SQLite executes this
  // idempotent index DDL here.
  if (db.dialect !== 'mysql') db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_memberships_effective
      ON salesperson_group_memberships(salesperson_id, active);
    CREATE INDEX IF NOT EXISTS idx_customer_commercial_effective
      ON customer_commercial_extensions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_material_xref_lookup
      ON customer_material_xref(customer_id, active);
    CREATE INDEX IF NOT EXISTS idx_sellable_scope_customer
      ON sales_sellable_scope_rules(scope_dimension, customer_id);
    CREATE INDEX IF NOT EXISTS idx_sellable_scope_salesperson
      ON sales_sellable_scope_rules(scope_dimension, salesperson_id);
    CREATE INDEX IF NOT EXISTS idx_sellable_scope_product
      ON sales_sellable_scope_rules(scope_dimension, product_id);
  `);
}
