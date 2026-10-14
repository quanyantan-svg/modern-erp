// Sales & Customer Wave 2 — pricing and order-time discount.
// Exactly five new business tables plus two nullable customer-commercial FKs.

export const SALES_WAVE2_TABLES = Object.freeze([
  'sales_price_lists',
  'sales_price_list_entries',
  'sales_price_list_versions',
  'sales_discount_schemes',
  'sales_discount_scheme_rules',
]);

const DEFAULT_FKS = Object.freeze([
  ['fk_customer_commercial_default_price_list', 'default_pricing_list_id', 'sales_price_lists'],
  ['fk_customer_commercial_default_discount_scheme', 'default_discount_scheme_id', 'sales_discount_schemes'],
]);

function sqliteColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function mysqlColumns(db, table) {
  return new Set(db.prepare(`SELECT COLUMN_NAME column_name FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table).map((row) => row.column_name));
}

function ensureCustomerDefaults(db) {
  const columns = db.dialect === 'mysql'
    ? mysqlColumns(db, 'customer_commercial_extensions')
    : sqliteColumns(db, 'customer_commercial_extensions');
  for (const [, column, target] of DEFAULT_FKS) {
    if (!columns.has(column)) {
      db.exec(`ALTER TABLE customer_commercial_extensions ADD COLUMN ${column} TEXT REFERENCES ${target}(id)`);
    }
  }
  if (db.dialect !== 'mysql') return;
  for (const [name, column, target] of DEFAULT_FKS) {
    const metadata = db.prepare(`SELECT CONSTRAINT_NAME constraint_name, REFERENCED_TABLE_NAME target_table,
      REFERENCED_COLUMN_NAME target_column FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_commercial_extensions'
        AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME`).all(column);
    if (metadata.length) {
      if (metadata.length !== 1 || metadata[0].constraint_name !== name
        || metadata[0].target_table !== target || metadata[0].target_column !== 'id') {
        throw new Error(`Wave 2 customer default FK metadata mismatch for ${column}`);
      }
    } else {
      db.exec(`ALTER TABLE customer_commercial_extensions ADD CONSTRAINT ${name}
        FOREIGN KEY (${column}) REFERENCES ${target}(id)`);
    }
    const columnMetadata = db.prepare(`SELECT IS_NULLABLE is_nullable FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_commercial_extensions' AND COLUMN_NAME=?`).get(column);
    if (columnMetadata?.is_nullable !== 'YES') {
      throw new Error(`Wave 2 customer default column must remain nullable: ${column}`);
    }
  }
}

function assertTriggerMetadata(db, name, event, requiredFragments) {
  if (db.dialect === 'mysql') {
    const rows = db.prepare(`SELECT ACTION_TIMING action_timing, EVENT_MANIPULATION event_manipulation,
      EVENT_OBJECT_TABLE event_object_table, ACTION_STATEMENT action_statement
      FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?`).all(name);
    const row = rows[0];
    const statement = String(row?.action_statement || '').toUpperCase().replace(/\s+/g, ' ');
    if (rows.length !== 1 || row.action_timing !== 'BEFORE' || row.event_manipulation !== event
      || row.event_object_table !== 'sales_price_list_entries'
      || requiredFragments.some((fragment) => !statement.includes(fragment))) {
      throw new Error(`Wave 2 identity trigger metadata mismatch: ${name}`);
    }
    return;
  }
  const rows = db.prepare("SELECT tbl_name table_name,sql FROM sqlite_master WHERE type='trigger' AND name=?").all(name);
  const sql = String(rows[0]?.sql || '').toUpperCase().replace(/\s+/g, ' ');
  if (rows.length !== 1 || rows[0].table_name !== 'sales_price_list_entries'
    || !sql.includes(`BEFORE ${event}`)
    || requiredFragments.some((fragment) => !sql.includes(fragment))) {
    throw new Error(`Wave 2 identity trigger metadata mismatch: ${name}`);
  }
}

function ensureIdentityTriggers(db) {
  if (db.dialect === 'mysql') {
    const create = (name, event, extra) => {
      const exists = db.prepare(`SELECT 1 FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?`).get(name);
      if (exists) return;
      db.exec(`CREATE TRIGGER ${name} BEFORE ${event} ON sales_price_list_entries FOR EACH ROW
        BEGIN
          IF OCTET_LENGTH(NEW.material_id) NOT BETWEEN 1 AND 63
            OR OCTET_LENGTH(NEW.pricing_uom_code) NOT BETWEEN 1 AND 32
            OR (NEW.customer_id IS NOT NULL AND OCTET_LENGTH(NEW.customer_id) NOT BETWEEN 1 AND 63)
            OR BINARY NEW.material_identity_key <> BINARY CONCAT('M:',HEX(NEW.material_id))
            OR BINARY NEW.customer_scope_key <> BINARY (CASE WHEN NEW.customer_scope_type='ALL' AND NEW.customer_id IS NULL THEN 'A' ELSE CONCAT('C:',HEX(NEW.customer_id)) END)
            OR BINARY NEW.pricing_identity_key <> BINARY CONCAT('U:',HEX(NEW.pricing_uom_code),'|Q:',LPAD(CAST(NEW.qty_break_min_micros AS CHAR),16,'0'),'|D:',REPLACE(NEW.effective_from,'-',''))
            ${extra}
          THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SALES_PRICE_ENTRY_IDENTITY_MISMATCH'; END IF;
        END`);
    };
    create('trg_sales_price_entries_identity_bi', 'INSERT', '');
    create('trg_sales_price_entries_identity_bu', 'UPDATE', `OR NOT (
      OLD.price_list_id <=> NEW.price_list_id AND OLD.material_id <=> NEW.material_id
      AND OLD.customer_id <=> NEW.customer_id AND OLD.customer_scope_type <=> NEW.customer_scope_type
      AND OLD.pricing_uom_code <=> NEW.pricing_uom_code
      AND OLD.qty_break_min_micros <=> NEW.qty_break_min_micros
      AND OLD.material_identity_key <=> NEW.material_identity_key
      AND OLD.customer_scope_key <=> NEW.customer_scope_key
      AND OLD.pricing_identity_key <=> NEW.pricing_identity_key
      AND OLD.effective_from <=> NEW.effective_from)`);
    assertTriggerMetadata(db, 'trg_sales_price_entries_identity_bi', 'INSERT', [
      'BINARY NEW.MATERIAL_IDENTITY_KEY', "HEX(NEW.MATERIAL_ID)", 'OCTET_LENGTH(NEW.MATERIAL_ID)',
    ]);
    assertTriggerMetadata(db, 'trg_sales_price_entries_identity_bu', 'UPDATE', [
      'BINARY NEW.MATERIAL_IDENTITY_KEY', 'OLD.PRICE_LIST_ID <=> NEW.PRICE_LIST_ID', 'OCTET_LENGTH(NEW.MATERIAL_ID)',
    ]);
    return;
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_sales_price_entries_identity_bi
    BEFORE INSERT ON sales_price_list_entries
    WHEN length(CAST(NEW.material_id AS BLOB)) NOT BETWEEN 1 AND 63
      OR length(CAST(NEW.pricing_uom_code AS BLOB)) NOT BETWEEN 1 AND 32
      OR (NEW.customer_id IS NOT NULL AND length(CAST(NEW.customer_id AS BLOB)) NOT BETWEEN 1 AND 63)
      OR NEW.material_identity_key <> 'M:' || hex(NEW.material_id)
      OR NEW.customer_scope_key <> CASE WHEN NEW.customer_scope_type='ALL' AND NEW.customer_id IS NULL THEN 'A' ELSE 'C:' || hex(NEW.customer_id) END
      OR NEW.pricing_identity_key <> 'U:' || hex(NEW.pricing_uom_code) || '|Q:' || printf('%016d',NEW.qty_break_min_micros) || '|D:' || replace(NEW.effective_from,'-','')
    BEGIN SELECT RAISE(ABORT,'SALES_PRICE_ENTRY_IDENTITY_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS trg_sales_price_entries_identity_bu
    BEFORE UPDATE ON sales_price_list_entries
    WHEN NEW.price_list_id IS NOT OLD.price_list_id OR NEW.material_id IS NOT OLD.material_id
      OR NEW.customer_id IS NOT OLD.customer_id OR NEW.customer_scope_type IS NOT OLD.customer_scope_type
      OR NEW.pricing_uom_code IS NOT OLD.pricing_uom_code
      OR NEW.qty_break_min_micros IS NOT OLD.qty_break_min_micros
      OR NEW.material_identity_key IS NOT OLD.material_identity_key
      OR NEW.customer_scope_key IS NOT OLD.customer_scope_key
      OR NEW.pricing_identity_key IS NOT OLD.pricing_identity_key
      OR NEW.effective_from IS NOT OLD.effective_from
      OR length(CAST(NEW.material_id AS BLOB)) NOT BETWEEN 1 AND 63
      OR length(CAST(NEW.pricing_uom_code AS BLOB)) NOT BETWEEN 1 AND 32
      OR (NEW.customer_id IS NOT NULL AND length(CAST(NEW.customer_id AS BLOB)) NOT BETWEEN 1 AND 63)
      OR NEW.material_identity_key <> 'M:' || hex(NEW.material_id)
      OR NEW.customer_scope_key <> CASE WHEN NEW.customer_scope_type='ALL' AND NEW.customer_id IS NULL THEN 'A' ELSE 'C:' || hex(NEW.customer_id) END
      OR NEW.pricing_identity_key <> 'U:' || hex(NEW.pricing_uom_code) || '|Q:' || printf('%016d',NEW.qty_break_min_micros) || '|D:' || replace(NEW.effective_from,'-','')
    BEGIN SELECT RAISE(ABORT,'SALES_PRICE_ENTRY_IDENTITY_IMMUTABLE'); END;
  `);
  assertTriggerMetadata(db, 'trg_sales_price_entries_identity_bi', 'INSERT', [
    'HEX(NEW.MATERIAL_ID)', 'LENGTH(CAST(NEW.MATERIAL_ID AS BLOB))',
  ]);
  assertTriggerMetadata(db, 'trg_sales_price_entries_identity_bu', 'UPDATE', [
    'NEW.PRICE_LIST_ID IS NOT OLD.PRICE_LIST_ID', 'HEX(NEW.MATERIAL_ID)',
  ]);
}

export function migrateSalesCustomerWave2Pricing(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_price_lists (
      id TEXT PRIMARY KEY CHECK(length(id)=36 AND id=lower(id)),
      price_list_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      currency_code TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
      fallback_price_list_id TEXT, effective_from TEXT NOT NULL, effective_to TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
      activated_at TEXT, activated_by TEXT, retired_at TEXT, retired_by TEXT,
      created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT,
      CHECK(effective_to IS NULL OR effective_to>=effective_from),
      FOREIGN KEY(fallback_price_list_id) REFERENCES sales_price_lists(id),
      FOREIGN KEY(activated_by) REFERENCES users(id), FOREIGN KEY(retired_by) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_price_list_entries (
      id TEXT PRIMARY KEY, price_list_id TEXT NOT NULL, material_id TEXT NOT NULL,
      customer_id TEXT, customer_scope_type TEXT NOT NULL CHECK(customer_scope_type IN ('ALL','CUSTOMER')),
      material_identity_key TEXT NOT NULL CHECK(length(material_identity_key)<=128),
      customer_scope_key TEXT NOT NULL CHECK(length(customer_scope_key)<=128),
      pricing_uom_code TEXT NOT NULL,
      pricing_identity_key TEXT NOT NULL CHECK(length(pricing_identity_key)<=128),
      qty_break_min_micros INTEGER NOT NULL CHECK(qty_break_min_micros>=0 AND qty_break_min_micros<=9007199254740991),
      qty_break_max_micros INTEGER CHECK(qty_break_max_micros IS NULL OR (qty_break_max_micros>=qty_break_min_micros AND qty_break_max_micros<=9007199254740991)),
      effective_from TEXT NOT NULL, effective_to TEXT, created_at TEXT NOT NULL, created_by TEXT,
      CHECK(effective_to IS NULL OR effective_to>=effective_from),
      CHECK((customer_scope_type='ALL' AND customer_id IS NULL AND customer_scope_key='A') OR
            (customer_scope_type='CUSTOMER' AND customer_id IS NOT NULL AND customer_scope_key LIKE 'C:%')),
      UNIQUE(price_list_id,material_identity_key,customer_scope_key,pricing_identity_key),
      FOREIGN KEY(price_list_id) REFERENCES sales_price_lists(id), FOREIGN KEY(material_id) REFERENCES products(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(pricing_uom_code) REFERENCES uoms(code),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_price_list_versions (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0 AND unit_price_cents<=9007199254740991),
      snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT,
      UNIQUE(entry_id,version), FOREIGN KEY(entry_id) REFERENCES sales_price_list_entries(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_discount_schemes (
      id TEXT PRIMARY KEY CHECK(length(id)=36 AND id=lower(id)), scheme_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, currency_code TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
      fallback_scheme_id TEXT, effective_from TEXT NOT NULL, effective_to TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
      activated_at TEXT, activated_by TEXT, retired_at TEXT, retired_by TEXT,
      created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT,
      CHECK(effective_to IS NULL OR effective_to>=effective_from),
      FOREIGN KEY(fallback_scheme_id) REFERENCES sales_discount_schemes(id),
      FOREIGN KEY(activated_by) REFERENCES users(id), FOREIGN KEY(retired_by) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_discount_scheme_rules (
      id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL, rule_key TEXT NOT NULL,
      rule_version INTEGER NOT NULL CHECK(rule_version>=1), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      material_id TEXT, customer_id TEXT,
      customer_scope_type TEXT NOT NULL CHECK(customer_scope_type IN ('ALL','CUSTOMER')),
      customer_scope_key TEXT NOT NULL, pricing_uom_code TEXT,
      line_scope TEXT NOT NULL CHECK(line_scope IN ('LINE','HEADER')),
      application_mode TEXT NOT NULL CHECK(application_mode IN ('AUTOMATIC','MANUAL')),
      discount_kind TEXT NOT NULL CHECK(discount_kind IN ('PERCENT','AMOUNT')),
      discount_bps INTEGER, discount_amount_cents INTEGER, priority INTEGER NOT NULL DEFAULT 0,
      qty_break_min_micros INTEGER NOT NULL DEFAULT 0,
      qty_break_max_micros INTEGER, effective_from TEXT NOT NULL, effective_to TEXT,
      created_at TEXT NOT NULL, created_by TEXT,
      CHECK(effective_to IS NULL OR effective_to>=effective_from),
      CHECK((customer_scope_type='ALL' AND customer_id IS NULL AND customer_scope_key='A') OR
            (customer_scope_type='CUSTOMER' AND customer_id IS NOT NULL AND customer_scope_key LIKE 'C:%')),
      CHECK((discount_kind='PERCENT' AND discount_bps BETWEEN 0 AND 10000 AND discount_amount_cents IS NULL) OR
            (discount_kind='AMOUNT' AND discount_bps IS NULL AND discount_amount_cents>=0)),
      CHECK(qty_break_min_micros>=0 AND (qty_break_max_micros IS NULL OR qty_break_max_micros>=qty_break_min_micros)),
      CHECK(line_scope='LINE' OR (material_id IS NULL AND pricing_uom_code IS NULL AND qty_break_min_micros=0 AND qty_break_max_micros IS NULL)),
      UNIQUE(scheme_id,rule_key,rule_version),
      FOREIGN KEY(scheme_id) REFERENCES sales_discount_schemes(id), FOREIGN KEY(material_id) REFERENCES products(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(pricing_uom_code) REFERENCES uoms(code),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);
  ensureCustomerDefaults(db);
  ensureIdentityTriggers(db);
  if (db.dialect !== 'mysql') db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_price_entries_resolve ON sales_price_list_entries(price_list_id,material_id,customer_id);
    CREATE INDEX IF NOT EXISTS idx_sales_price_versions_entry ON sales_price_list_versions(entry_id,version);
    CREATE INDEX IF NOT EXISTS idx_sales_discount_rules_resolve ON sales_discount_scheme_rules(scheme_id,line_scope,customer_id);
  `);
}
