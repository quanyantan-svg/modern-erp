// Sales & Customer Wave 8 — Service Fulfillment + Consignment.
// Exactly four additive business tables. No historical row is rewritten.

import { mysqlIndexColumnList } from '../database/mysql-schema.js';

export const SALES_WAVE8_TABLES = Object.freeze([
  'service_fulfillments',
  'consignment_commodity_locations',
  'consignment_commercial_documents',
  'consignment_commercial_lines',
]);

const INDEXES = Object.freeze([
  { table: 'service_fulfillments', name: 'idx_service_fulfillments_item_state', columns: ['sales_order_item_id', 'confirmation_state', 'id'] },
  { table: 'service_fulfillments', name: 'idx_service_fulfillments_order', columns: ['sales_order_id', 'id'] },
  { table: 'service_fulfillments', name: 'idx_service_fulfillments_group_date', columns: ['sales_group_id', 'business_date', 'id'] },
  { table: 'consignment_commodity_locations', name: 'uq_consignment_location_customer_code', columns: ['customer_id', 'location_code'], unique: true },
  { table: 'consignment_commodity_locations', name: 'idx_consignment_location_mapping', columns: ['physical_warehouse_id', 'physical_bin_id'] },
  { table: 'consignment_commercial_documents', name: 'idx_consignment_documents_customer_state', columns: ['customer_id', 'status', 'business_date'] },
  { table: 'consignment_commercial_documents', name: 'idx_consignment_documents_group_date', columns: ['sales_group_id', 'business_date', 'id'] },
  { table: 'consignment_commercial_lines', name: 'uq_consignment_lines_number', columns: ['document_id', 'line_no'], unique: true },
  { table: 'consignment_commercial_lines', name: 'uq_consignment_lines_identity', columns: ['document_id', 'product_id', 'consignment_commodity_location_id', 'lot_code_key'], unique: true },
  { table: 'consignment_commercial_lines', name: 'idx_consignment_lines_order_item', columns: ['sales_order_item_id'] },
  { table: 'consignment_commercial_lines', name: 'idx_consignment_lines_location', columns: ['consignment_commodity_location_id', 'id'] },
]);

function sqlite(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_fulfillments (
      id TEXT PRIMARY KEY NOT NULL,
      fulfillment_no TEXT NOT NULL UNIQUE,
      sales_order_id TEXT NOT NULL,
      sales_order_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      sales_group_id TEXT,
      confirmation_qty_micros INTEGER NOT NULL CHECK(confirmation_qty_micros > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
      recognition_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(recognition_amount_cents >= 0),
      business_date TEXT NOT NULL,
      confirmation_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(confirmation_state IN ('PENDING','CONFIRMED','CANCELLED')),
      finance_recognition_mode TEXT,
      finance_open_item_id TEXT,
      finance_source_type TEXT,
      finance_source_id TEXT,
      confirmed_at TEXT,
      confirmed_by TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      CHECK(
        (confirmation_state='PENDING' AND confirmed_at IS NULL AND confirmed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL)
        OR (confirmation_state='CANCELLED' AND confirmed_at IS NULL AND confirmed_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL)
        OR (confirmation_state='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND ((recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL) OR (recognition_amount_cents>0 AND finance_recognition_mode='DIRECT_BUSINESS_OPEN_ITEM' AND finance_open_item_id IS NOT NULL AND finance_source_type='SERVICE_FULFILLMENT' AND finance_source_id=id)))
      ),
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(sales_group_id) REFERENCES sales_groups(id),
      FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id),
      FOREIGN KEY(confirmed_by) REFERENCES users(id), FOREIGN KEY(cancelled_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS consignment_commodity_locations (
      id TEXT PRIMARY KEY NOT NULL, location_code TEXT NOT NULL, customer_id TEXT NOT NULL,
      name TEXT NOT NULL, address_text TEXT NOT NULL DEFAULT '', physical_warehouse_id TEXT NOT NULL,
      physical_bin_id TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      effective_from TEXT NOT NULL, effective_to TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
      CHECK(effective_to IS NULL OR effective_to>=effective_from),
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(physical_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY(physical_bin_id) REFERENCES warehouse_bins(id), FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS consignment_commercial_documents (
      id TEXT PRIMARY KEY NOT NULL, document_no TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
      sales_group_id TEXT, source_warehouse_id TEXT NOT NULL, instruction_date TEXT NOT NULL, business_date TEXT NOT NULL,
      currency_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','INSTRUCTED','PARTIAL_SETTLED','SETTLED','RETURNED','CANCELLED')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), instructed_at TEXT, instructed_by TEXT,
      cancelled_at TEXT, cancelled_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
      CHECK((status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL) OR (status<>'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL)),
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(sales_group_id) REFERENCES sales_groups(id),
      FOREIGN KEY(source_warehouse_id) REFERENCES warehouses(id), FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id), FOREIGN KEY(instructed_by) REFERENCES users(id), FOREIGN KEY(cancelled_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS consignment_commercial_lines (
      id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, line_no INTEGER NOT NULL, sales_order_item_id TEXT,
      product_id TEXT NOT NULL, consignment_commodity_location_id TEXT NOT NULL, lot_code TEXT,
      lot_code_key TEXT COLLATE BINARY NOT NULL DEFAULT '', consigned_qty_micros INTEGER NOT NULL CHECK(consigned_qty_micros>0),
      settled_qty_micros INTEGER NOT NULL DEFAULT 0 CHECK(settled_qty_micros>=0), returned_qty_micros INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty_micros>=0),
      settled_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(settled_amount_cents>=0), returned_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(returned_amount_cents>=0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0), handoff_movement_group_id TEXT, last_finance_reference_id TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
      CHECK(settled_qty_micros+returned_qty_micros<=consigned_qty_micros),
      CHECK((lot_code IS NULL AND lot_code_key='') OR (lot_code IS NOT NULL AND lot_code_key<>'')),
      FOREIGN KEY(document_id) REFERENCES consignment_commercial_documents(id), FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(consignment_commodity_location_id) REFERENCES consignment_commodity_locations(id),
      FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id)
    );
  `);
  for (const index of INDEXES) db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns.join(',')})`);
}

function mysql(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS service_fulfillments (
    id VARCHAR(128) NOT NULL PRIMARY KEY, fulfillment_no VARCHAR(128) NOT NULL UNIQUE, sales_order_id VARCHAR(128) NOT NULL,
    sales_order_item_id VARCHAR(128) NOT NULL, product_id VARCHAR(128) NOT NULL, customer_id VARCHAR(128) NOT NULL, sales_group_id VARCHAR(128) NULL,
    confirmation_qty_micros BIGINT NOT NULL, unit_price_cents BIGINT NOT NULL, recognition_amount_cents BIGINT NOT NULL DEFAULT 0,
    business_date VARCHAR(10) NOT NULL, confirmation_state VARCHAR(16) NOT NULL DEFAULT 'PENDING', finance_recognition_mode VARCHAR(64) NULL,
    finance_open_item_id VARCHAR(128) NULL, finance_source_type VARCHAR(64) NULL, finance_source_id VARCHAR(128) NULL,
    confirmed_at LONGTEXT NULL, confirmed_by VARCHAR(128) NULL, cancelled_at LONGTEXT NULL, cancelled_by VARCHAR(128) NULL,
    version INT NOT NULL DEFAULT 1, created_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL, updated_by VARCHAR(128) NOT NULL,
    CONSTRAINT chk_service_fulfillment_qty CHECK(confirmation_qty_micros>0 AND unit_price_cents>=0 AND recognition_amount_cents>=0 AND version>=1),
    CONSTRAINT chk_service_fulfillment_state CHECK(confirmation_state IN ('PENDING','CONFIRMED','CANCELLED')),
    CONSTRAINT chk_service_fulfillment_evidence CHECK((confirmation_state='PENDING' AND confirmed_at IS NULL AND confirmed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL) OR (confirmation_state='CANCELLED' AND confirmed_at IS NULL AND confirmed_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL) OR (confirmation_state='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND ((recognition_amount_cents=0 AND finance_recognition_mode IS NULL AND finance_open_item_id IS NULL AND finance_source_type IS NULL AND finance_source_id IS NULL) OR (recognition_amount_cents>0 AND finance_recognition_mode='DIRECT_BUSINESS_OPEN_ITEM' AND finance_open_item_id IS NOT NULL AND finance_source_type='SERVICE_FULFILLMENT' AND finance_source_id=id)))),
    CONSTRAINT fk_service_fulfillment_order FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id), CONSTRAINT fk_service_fulfillment_item FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
    CONSTRAINT fk_service_fulfillment_product FOREIGN KEY(product_id) REFERENCES products(id), CONSTRAINT fk_service_fulfillment_customer FOREIGN KEY(customer_id) REFERENCES customers(id),
    CONSTRAINT fk_service_fulfillment_group FOREIGN KEY(sales_group_id) REFERENCES sales_groups(id), CONSTRAINT fk_service_fulfillment_creator FOREIGN KEY(created_by) REFERENCES users(id),
    CONSTRAINT fk_service_fulfillment_updater FOREIGN KEY(updated_by) REFERENCES users(id), CONSTRAINT fk_service_fulfillment_confirmer FOREIGN KEY(confirmed_by) REFERENCES users(id),
    CONSTRAINT fk_service_fulfillment_canceller FOREIGN KEY(cancelled_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS consignment_commodity_locations (
    id VARCHAR(128) NOT NULL PRIMARY KEY, location_code VARCHAR(128) NOT NULL, customer_id VARCHAR(128) NOT NULL, name VARCHAR(255) NOT NULL,
    address_text LONGTEXT NOT NULL, physical_warehouse_id VARCHAR(128) NOT NULL, physical_bin_id VARCHAR(128) NULL, active TINYINT(1) NOT NULL DEFAULT 1,
    effective_from VARCHAR(10) NOT NULL, effective_to VARCHAR(10) NULL, version INT NOT NULL DEFAULT 1, created_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL,
    created_by VARCHAR(128) NOT NULL, updated_by VARCHAR(128) NOT NULL, CONSTRAINT chk_consignment_location CHECK(active IN (0,1) AND version>=1 AND (effective_to IS NULL OR effective_to>=effective_from)),
    CONSTRAINT fk_consignment_location_customer FOREIGN KEY(customer_id) REFERENCES customers(id), CONSTRAINT fk_consignment_location_warehouse FOREIGN KEY(physical_warehouse_id) REFERENCES warehouses(id),
    CONSTRAINT fk_consignment_location_bin FOREIGN KEY(physical_bin_id) REFERENCES warehouse_bins(id), CONSTRAINT fk_consignment_location_creator FOREIGN KEY(created_by) REFERENCES users(id),
    CONSTRAINT fk_consignment_location_updater FOREIGN KEY(updated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS consignment_commercial_documents (
    id VARCHAR(128) NOT NULL PRIMARY KEY, document_no VARCHAR(128) NOT NULL UNIQUE, customer_id VARCHAR(128) NOT NULL, sales_group_id VARCHAR(128) NULL,
    source_warehouse_id VARCHAR(128) NOT NULL, instruction_date VARCHAR(10) NOT NULL, business_date VARCHAR(10) NOT NULL, currency_code VARCHAR(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT', version INT NOT NULL DEFAULT 1, instructed_at LONGTEXT NULL, instructed_by VARCHAR(128) NULL,
    cancelled_at LONGTEXT NULL, cancelled_by VARCHAR(128) NULL, created_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL, updated_by VARCHAR(128) NOT NULL,
    CONSTRAINT chk_consignment_document_state CHECK(status IN ('DRAFT','INSTRUCTED','PARTIAL_SETTLED','SETTLED','RETURNED','CANCELLED') AND version>=1 AND ((status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL) OR (status<>'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL))),
    CONSTRAINT fk_consignment_document_customer FOREIGN KEY(customer_id) REFERENCES customers(id), CONSTRAINT fk_consignment_document_group FOREIGN KEY(sales_group_id) REFERENCES sales_groups(id),
    CONSTRAINT fk_consignment_document_warehouse FOREIGN KEY(source_warehouse_id) REFERENCES warehouses(id), CONSTRAINT fk_consignment_document_creator FOREIGN KEY(created_by) REFERENCES users(id),
    CONSTRAINT fk_consignment_document_updater FOREIGN KEY(updated_by) REFERENCES users(id), CONSTRAINT fk_consignment_document_instructor FOREIGN KEY(instructed_by) REFERENCES users(id),
    CONSTRAINT fk_consignment_document_canceller FOREIGN KEY(cancelled_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS consignment_commercial_lines (
    id VARCHAR(128) NOT NULL PRIMARY KEY, document_id VARCHAR(128) NOT NULL, line_no INT NOT NULL, sales_order_item_id VARCHAR(128) NULL,
    product_id VARCHAR(128) NOT NULL, consignment_commodity_location_id VARCHAR(128) NOT NULL, lot_code VARCHAR(255) NULL,
    lot_code_key VARCHAR(128) COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '', consigned_qty_micros BIGINT NOT NULL, settled_qty_micros BIGINT NOT NULL DEFAULT 0,
    returned_qty_micros BIGINT NOT NULL DEFAULT 0, settled_amount_cents BIGINT NOT NULL DEFAULT 0, returned_amount_cents BIGINT NOT NULL DEFAULT 0,
    unit_price_cents BIGINT NOT NULL, handoff_movement_group_id VARCHAR(128) NULL, last_finance_reference_id VARCHAR(128) NULL, version INT NOT NULL DEFAULT 1,
    created_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL, updated_by VARCHAR(128) NOT NULL,
    CONSTRAINT chk_consignment_line_capacity CHECK(consigned_qty_micros>0 AND settled_qty_micros>=0 AND returned_qty_micros>=0 AND settled_amount_cents>=0 AND returned_amount_cents>=0 AND unit_price_cents>=0 AND version>=1 AND settled_qty_micros+returned_qty_micros<=consigned_qty_micros),
    CONSTRAINT chk_consignment_line_lot CHECK((lot_code IS NULL AND lot_code_key='') OR (lot_code IS NOT NULL AND lot_code_key<>'')),
    CONSTRAINT fk_consignment_line_document FOREIGN KEY(document_id) REFERENCES consignment_commercial_documents(id), CONSTRAINT fk_consignment_line_order_item FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
    CONSTRAINT fk_consignment_line_product FOREIGN KEY(product_id) REFERENCES products(id), CONSTRAINT fk_consignment_line_location FOREIGN KEY(consignment_commodity_location_id) REFERENCES consignment_commodity_locations(id),
    CONSTRAINT fk_consignment_line_creator FOREIGN KEY(created_by) REFERENCES users(id), CONSTRAINT fk_consignment_line_updater FOREIGN KEY(updated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  for (const index of INDEXES) {
    const rows = db.prepare(`SELECT INDEX_NAME name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`).all(index.table, index.name);
    if (!rows.length) db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${index.name} ON ${index.table} (${mysqlIndexColumnList(index.table, index)})`);
  }
}

// ---------------------------------------------------------------------------
// §35.18.2 — when a Wave 8 table already exists, its full physical contract is
// asserted against live `information_schema` metadata. A drifted pre-existing
// structure fails closed. This layer never issues DDL: it will not DROP,
// rebuild, clean or fabricate history, so an incompatible database is left
// exactly as found for an operator decision.
//
// The expected shape below is what the canonical MySQL bootstrap actually
// realizes. These four tables are always created by the shared snapshot
// reconciliation before this migration runs, so the `mysql()` DDL block above is
// a no-op on any real database and its hand-written types/collation are NOT what
// exists. Asserting the snapshot-reconciled reality is what makes drift visible.
//
// Constraint identity is therefore asserted by meaning, not by name: MySQL
// auto-names CHECK and FOREIGN KEY constraints (`_chk_N`, `_ibfk_N`), so a name
// comparison would be meaningless. Columns, defaults, collations, primary keys,
// foreign-key targets, the exact CHECK clause set and the declared indexes are
// all still compared strictly.
// ---------------------------------------------------------------------------

const TABLE_COLLATION = 'utf8mb4_0900_ai_ci';

// [name, data_type, character_maximum_length, is_nullable, column_default]
const LOT_KEY_COLUMN = 'lot_code_key';
const LOT_KEY_COLLATION = 'utf8mb4_0900_bin';
const MYSQL_TABLE_CONTRACTS = Object.freeze({
  service_fulfillments: {
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['fulfillment_no', 'varchar', 128, 'NO', null],
      ['sales_order_id', 'varchar', 128, 'NO', null], ['sales_order_item_id', 'varchar', 128, 'NO', null],
      ['product_id', 'varchar', 128, 'NO', null], ['customer_id', 'varchar', 128, 'NO', null],
      ['sales_group_id', 'varchar', 128, 'YES', null],
      ['confirmation_qty_micros', 'bigint', null, 'NO', null], ['unit_price_cents', 'bigint', null, 'NO', null],
      ['recognition_amount_cents', 'bigint', null, 'NO', '0'], ['business_date', 'varchar', 128, 'NO', null],
      ['confirmation_state', 'varchar', 128, 'NO', 'PENDING'],
      ['finance_recognition_mode', 'longtext', 4294967295, 'YES', null],
      ['finance_open_item_id', 'varchar', 128, 'YES', null], ['finance_source_type', 'longtext', 4294967295, 'YES', null],
      ['finance_source_id', 'varchar', 128, 'YES', null], ['confirmed_at', 'longtext', 4294967295, 'YES', null],
      ['confirmed_by', 'varchar', 128, 'YES', null], ['cancelled_at', 'longtext', 4294967295, 'YES', null],
      ['cancelled_by', 'varchar', 128, 'YES', null], ['version', 'bigint', null, 'NO', '1'],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    primaryKey: ['id'],
    foreignKeys: [
      ['sales_order_id', 'sales_orders', 'id'], ['sales_order_item_id', 'sales_order_items', 'id'],
      ['product_id', 'products', 'id'], ['customer_id', 'customers', 'id'], ['sales_group_id', 'sales_groups', 'id'],
      ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
      ['confirmed_by', 'users', 'id'], ['cancelled_by', 'users', 'id'],
    ],
    checks: [
      'CONFIRMATION_QTY_MICROS',
      'UNIT_PRICE_CENTS',
      'RECOGNITION_AMOUNT_CENTS',
      'CONFIRMATION_STATE',
      'VERSION',
      'STATE_EVIDENCE',
    ],
    uniques: [{ name: 'fulfillment_no', columns: ['fulfillment_no'] }],
  },
  consignment_commodity_locations: {
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['location_code', 'varchar', 128, 'NO', null],
      ['customer_id', 'varchar', 128, 'NO', null], ['name', 'longtext', 4294967295, 'NO', null],
      ['address_text', 'longtext', 4294967295, 'NO', ''],
      ['physical_warehouse_id', 'varchar', 128, 'NO', null], ['physical_bin_id', 'varchar', 128, 'YES', null],
      ['active', 'bigint', null, 'NO', '1'], ['effective_from', 'longtext', 4294967295, 'NO', null],
      ['effective_to', 'longtext', 4294967295, 'YES', null], ['version', 'bigint', null, 'NO', '1'],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    primaryKey: ['id'],
    foreignKeys: [
      ['customer_id', 'customers', 'id'], ['physical_warehouse_id', 'warehouses', 'id'],
      ['physical_bin_id', 'warehouse_bins', 'id'], ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
    ],
    checks: ['ACTIVE', 'VERSION', 'EFFECTIVE_RANGE'],
    uniques: [{ name: 'uq_consignment_location_customer_code', columns: ['customer_id', 'location_code'] }],
  },
  consignment_commercial_documents: {
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['document_no', 'varchar', 128, 'NO', null],
      ['customer_id', 'varchar', 128, 'NO', null], ['sales_group_id', 'varchar', 128, 'YES', null],
      ['source_warehouse_id', 'varchar', 128, 'NO', null],
      ['instruction_date', 'longtext', 4294967295, 'NO', null], ['business_date', 'varchar', 128, 'NO', null],
      ['currency_code', 'longtext', 4294967295, 'NO', null],
      ['status', 'varchar', 128, 'NO', 'DRAFT'], ['version', 'bigint', null, 'NO', '1'],
      ['instructed_at', 'longtext', 4294967295, 'YES', null], ['instructed_by', 'varchar', 128, 'YES', null],
      ['cancelled_at', 'longtext', 4294967295, 'YES', null], ['cancelled_by', 'varchar', 128, 'YES', null],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    primaryKey: ['id'],
    foreignKeys: [
      ['customer_id', 'customers', 'id'], ['sales_group_id', 'sales_groups', 'id'],
      ['source_warehouse_id', 'warehouses', 'id'], ['created_by', 'users', 'id'],
      ['updated_by', 'users', 'id'], ['instructed_by', 'users', 'id'], ['cancelled_by', 'users', 'id'],
    ],
    checks: [
      'STATUS',
      'VERSION',
      'CANCEL_EVIDENCE_PAIRING',
    ],
    uniques: [{ name: 'document_no', columns: ['document_no'] }],
  },
  consignment_commercial_lines: {
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['document_id', 'varchar', 128, 'NO', null],
      ['line_no', 'bigint', null, 'NO', null], ['sales_order_item_id', 'varchar', 128, 'YES', null],
      ['product_id', 'varchar', 128, 'NO', null],
      ['consignment_commodity_location_id', 'varchar', 128, 'NO', null],
      ['lot_code', 'longtext', 4294967295, 'YES', null], ['lot_code_key', 'varchar', 128, 'NO', ''],
      ['consigned_qty_micros', 'bigint', null, 'NO', null], ['settled_qty_micros', 'bigint', null, 'NO', '0'],
      ['returned_qty_micros', 'bigint', null, 'NO', '0'], ['settled_amount_cents', 'bigint', null, 'NO', '0'],
      ['returned_amount_cents', 'bigint', null, 'NO', '0'], ['unit_price_cents', 'bigint', null, 'NO', null],
      ['handoff_movement_group_id', 'varchar', 128, 'YES', null],
      ['last_finance_reference_id', 'varchar', 128, 'YES', null], ['version', 'bigint', null, 'NO', '1'],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    // Byte-identity key: compared with a NO PAD binary collation so lot identity never
    // folds under a case/accent-insensitive or trailing-space comparison.
    columnCollations: { lot_code_key: LOT_KEY_COLLATION },
    primaryKey: ['id'],
    foreignKeys: [
      ['document_id', 'consignment_commercial_documents', 'id'], ['sales_order_item_id', 'sales_order_items', 'id'],
      ['product_id', 'products', 'id'],
      ['consignment_commodity_location_id', 'consignment_commodity_locations', 'id'],
      ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
    ],
    checks: [
      'CONSIGNED_QTY_MICROS',
      'SETTLED_QTY_MICROS',
      'RETURNED_QTY_MICROS',
      'SETTLED_AMOUNT_CENTS',
      'RETURNED_AMOUNT_CENTS',
      'UNIT_PRICE_CENTS',
      'VERSION',
      'CAPACITY',
      'LOT_CODE_KEY_PAIRING',
    ],
    uniques: [
      { name: 'uq_consignment_lines_number', columns: ['document_id', 'line_no'] },
      { name: 'uq_consignment_lines_identity', columns: ['document_id', 'product_id', 'consignment_commodity_location_id', 'lot_code_key'] },
    ],
  },
});

// §35.18.2 / §35.22.4 — `lot_code_key` is a byte-identity key. SQLite declares it
// `COLLATE BINARY`; MySQL must reach byte-exact parity. `utf8mb4_0900_bin` is NO PAD, which is
// the correct MySQL match (utf8mb4_bin is PAD SPACE and would treat trailing spaces as equal).
// The fresh-install path is the column generator in `database/mysql-schema.js`; this additive
// step reconciles databases created before that fix, without a rebuild and without data repair.

function reconcileLotKeyCollation(db) {
  const current = db.prepare(`SELECT COLLATION_NAME collation FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`).get('consignment_commercial_lines', LOT_KEY_COLUMN);
  if (!current) throw conflict('consignment_commercial_lines.lot_code_key is missing');
  if (current.collation === LOT_KEY_COLLATION) return false;
  // Read-only ambiguity probe. A group where the ai_ci collation folds values that binary
  // separates would newly violate uq_consignment_lines_identity once the collation changes.
  // Never merge, delete, case-fold or re-identify: ambiguity is an operator decision.
  const ambiguous = db.prepare(`SELECT document_id,product_id,consignment_commodity_location_id,
      COUNT(DISTINCT ${LOT_KEY_COLUMN}) ai_distinct, COUNT(DISTINCT BINARY ${LOT_KEY_COLUMN}) binary_distinct
    FROM consignment_commercial_lines
    GROUP BY document_id,product_id,consignment_commodity_location_id
    HAVING ai_distinct <> binary_distinct`).all();
  if (ambiguous.length) {
    throw new Error(`Wave 8 MySQL schema conflict: ${LOT_KEY_COLUMN} collation change is ambiguous `
      + `(${ambiguous.length} identity group(s) fold under utf8mb4_0900_ai_ci but separate under binary); `
      + `groups=${ambiguous.map((row) => `${row.document_id}/${row.product_id}/${row.consignment_commodity_location_id}`).join(',')}`);
  }
  db.exec(`ALTER TABLE consignment_commercial_lines MODIFY COLUMN ${LOT_KEY_COLUMN} VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE ${LOT_KEY_COLLATION} NOT NULL DEFAULT ''`);
  return true;
}

// MySQL 8 renders the same string default in several equivalent metadata shapes
// (`_utf8mb4\'x\'`, `('x')`, `'x'`). Compare the canonical form so a
// representation difference is not mistaken for a contract violation.
const normalizeDefault = (value) => String(value ?? '')
  .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
  .replace(/[()'"\s\\]/g, '');

const normalizeCheck = (value) => String(value ?? '')
  .replace(/`/g, '')
  .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
  // MySQL escapes quotes inside a CHECK expression text; the backslash is
  // syntactic and carries no meaning for the constraint.
  .replace(/\\/g, '')
  .replace(/\s+/g, ' ')
  .toUpperCase()
  .trim();

// Each declared CHECK is matched by the substrings its clause must carry, rather
// than by byte equality, so the assertion survives MySQL's parenthesization
// while still refusing a constraint that does not enforce the required domain.
const CHECK_MATCHERS = Object.freeze({
  CONFIRMATION_QTY_MICROS: ['CONFIRMATION_QTY_MICROS > 0'],
  UNIT_PRICE_CENTS: ['UNIT_PRICE_CENTS >= 0'],
  RECOGNITION_AMOUNT_CENTS: ['RECOGNITION_AMOUNT_CENTS >= 0'],
  CONFIRMATION_STATE: ["CONFIRMATION_STATE IN ('PENDING','CONFIRMED','CANCELLED')"],
  VERSION: ['VERSION >= 1'],
  STATE_EVIDENCE: ["CONFIRMATION_STATE = 'PENDING'", "CONFIRMATION_STATE = 'CANCELLED'", "CONFIRMATION_STATE = 'CONFIRMED'", 'FINANCE_SOURCE_ID IS NULL', 'FINANCE_SOURCE_ID = ID'],
  ACTIVE: ['ACTIVE IN (0,1)'],
  EFFECTIVE_RANGE: ['EFFECTIVE_TO IS NULL', 'EFFECTIVE_TO >= EFFECTIVE_FROM'],
  STATUS: ["STATUS IN ('DRAFT','INSTRUCTED','PARTIAL_SETTLED','SETTLED','RETURNED','CANCELLED')"],
  CANCEL_EVIDENCE_PAIRING: ["STATUS = 'CANCELLED'", 'CANCELLED_AT IS NOT NULL', 'CANCELLED_BY IS NOT NULL', "STATUS <> 'CANCELLED'", 'CANCELLED_AT IS NULL'],
  CONSIGNED_QTY_MICROS: ['CONSIGNED_QTY_MICROS > 0'],
  SETTLED_QTY_MICROS: ['SETTLED_QTY_MICROS >= 0'],
  RETURNED_QTY_MICROS: ['RETURNED_QTY_MICROS >= 0'],
  SETTLED_AMOUNT_CENTS: ['SETTLED_AMOUNT_CENTS >= 0'],
  RETURNED_AMOUNT_CENTS: ['RETURNED_AMOUNT_CENTS >= 0'],
  CAPACITY: ['SETTLED_QTY_MICROS + RETURNED_QTY_MICROS', 'CONSIGNED_QTY_MICROS'],
  LOT_CODE_KEY_PAIRING: ['LOT_CODE IS NULL', "LOT_CODE_KEY = ''", 'LOT_CODE IS NOT NULL', "LOT_CODE_KEY <> ''"],
});

function conflict(message) { return new Error(`Wave 8 MySQL schema conflict: ${message}`); }

function assertColumnContracts(db, table, contract) {
  const rows = db.prepare(`SELECT COLUMN_NAME name, DATA_TYPE data_type, IS_NULLABLE is_nullable,
      COLUMN_DEFAULT column_default, CHARACTER_MAXIMUM_LENGTH character_maximum_length, COLLATION_NAME collation_name
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`).all(table);
  if (!rows.length) throw conflict(`${table} is missing`);
  const actualOrder = rows.map((row) => row.name);
  const declared = contract.columns.map(([name]) => name);
  const unexpected = actualOrder.filter((name) => !declared.includes(name));
  const missing = declared.filter((name) => !actualOrder.includes(name));
  if (unexpected.length || missing.length) {
    throw conflict(`${table} column set drifted (missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'})`);
  }
  if (JSON.stringify(actualOrder) !== JSON.stringify(declared)) throw conflict(`${table} column order drifted`);

  for (const [name, type, charLength, nullable, defaultValue] of contract.columns) {
    const row = rows.find((candidate) => candidate.name === name);
    if (String(row.data_type).toLowerCase() !== type) throw conflict(`${table}.${name} type is ${row.data_type}, expected ${type}`);
    if (row.is_nullable !== nullable) throw conflict(`${table}.${name} nullability is ${row.is_nullable}, expected ${nullable}`);
    if (charLength != null && Number(row.character_maximum_length) !== charLength) {
      throw conflict(`${table}.${name} length is ${row.character_maximum_length}, expected ${charLength}`);
    }
    const defaultMatches = defaultValue == null
      ? row.column_default == null
      : normalizeDefault(row.column_default) === normalizeDefault(String(defaultValue));
    if (!defaultMatches) throw conflict(`${table}.${name} default is ${JSON.stringify(row.column_default)}, expected ${JSON.stringify(defaultValue)}`);
    const expectedCollation = contract.columnCollations?.[name] ?? TABLE_COLLATION;
    if (row.collation_name && row.collation_name !== expectedCollation) {
      throw conflict(`${table}.${name} collation is ${row.collation_name}, expected ${expectedCollation}`);
    }
  }
}

function assertPrimaryKey(db, table, expected) {
  const rows = db.prepare(`SELECT COLUMN_NAME name FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`).all(table);
  const actual = rows.map((row) => row.name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw conflict(`${table} primary key is [${actual}], expected [${expected}]`);
}

function assertForeignKeys(db, table, expected) {
  const rows = db.prepare(`SELECT COLUMN_NAME name, REFERENCED_TABLE_NAME referenced_table, REFERENCED_COLUMN_NAME referenced_column
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`).all(table);
  const byColumn = new Map(rows.map((row) => [row.name, row]));
  for (const [column, referencedTable, referencedColumn] of expected) {
    const row = byColumn.get(column);
    if (!row || row.referenced_table !== referencedTable || row.referenced_column !== referencedColumn) {
      throw conflict(`${table}.${column} foreign key does not reference ${referencedTable}.${referencedColumn}`);
    }
  }
  for (const row of rows) {
    if (!expected.some(([column]) => column === row.name)) throw conflict(`${table}.${row.name} has an unexpected foreign key`);
  }
}

function assertChecks(db, table, declared) {
  const rows = db.prepare(`SELECT CHECK_CLAUSE check_clause FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='CHECK')`).all(table);
  const normalized = rows.map((row) => normalizeCheck(row.check_clause));
  if (normalized.length !== declared.length) {
    throw conflict(`${table} has ${normalized.length} CHECK constraints, expected ${declared.length}`);
  }
  for (const check of declared) {
    const required = CHECK_MATCHERS[check];
    if (!required) throw conflict(`${table} declares unknown CHECK ${check}`);
    const satisfied = normalized.some((clause) => required.every((fragment) => clause.includes(fragment)));
    if (!satisfied) throw conflict(`${table} is missing the ${check} constraint`);
  }
}

function assertIndexShape(db, table, name, expectedColumns, unique) {
  const rows = db.prepare(`SELECT COLUMN_NAME name, NON_UNIQUE non_unique, SUB_PART sub_part
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX`).all(table, name);
  if (!rows.length) throw conflict(`${table} is missing ${unique ? 'UNIQUE index' : 'index'} ${name}`);
  if (!rows.every((row) => Number(row.non_unique) === (unique ? 0 : 1))) throw conflict(`${table}.${name} uniqueness drifted`);
  const actual = rows.map((row) => ({ name: row.name, subPart: row.sub_part == null ? null : Number(row.sub_part) }));
  const expected = mysqlIndexColumnList(table, { table, name, columns: expectedColumns })
    .split(',')
    .map((part) => {
      const match = part.match(/^`([^`]+)`(?:\((\d+)\))?$/);
      return { name: match?.[1], subPart: match?.[2] ? Number(match[2]) : null };
    });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw conflict(`${table}.${name} column identity/order drifted (actual=${actual.map((c) => c.name).join(',')}; expected=${expected.map((c) => c.name).join(',')})`);
  }
}

function assertMySqlWave8Schema(db) {
  for (const table of SALES_WAVE8_TABLES) {
    const contract = MYSQL_TABLE_CONTRACTS[table];
    const definition = db.prepare(`SELECT TABLE_COLLATION collation FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).get(table);
    if (!definition) throw conflict(`${table} is missing`);
    if (definition.collation !== TABLE_COLLATION) throw conflict(`${table} collation is ${definition.collation}, expected ${TABLE_COLLATION}`);
    assertColumnContracts(db, table, contract);
    assertPrimaryKey(db, table, contract.primaryKey);
    assertForeignKeys(db, table, contract.foreignKeys);
    assertChecks(db, table, contract.checks);
    for (const declared of contract.uniques) assertIndexShape(db, table, declared.name, declared.columns, true);
  }
  for (const index of INDEXES.filter((entry) => !entry.unique)) {
    assertIndexShape(db, index.table, index.name, index.columns, false);
  }
}

export function migrateSalesCustomerWave8ServiceConsignment(db) {
  if (!db) throw new Error('migrateSalesCustomerWave8ServiceConsignment: db missing');
  if (db.dialect === 'mysql') mysql(db); else sqlite(db);
  const present = db.dialect === 'mysql'
    ? db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)`).all(...SALES_WAVE8_TABLES).map((row) => row.name)
    : db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?)`).all(...SALES_WAVE8_TABLES).map((row) => row.name);
  if (present.length !== SALES_WAVE8_TABLES.length) throw new Error('Wave 8 schema bootstrap incomplete');
  // Fresh install, additive upgrade and repeated startup all converge here: the
  // tables are asserted even when they were just created, so CREATE TABLE IF NOT
  // EXISTS cannot silently adopt a drifted pre-existing structure.
  if (db.dialect === 'mysql') { reconcileLotKeyCollation(db); assertMySqlWave8Schema(db); }
}
