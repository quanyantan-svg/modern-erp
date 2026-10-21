// Wave 8 — four-table MySQL existing-schema fail-closed proof.
//
// The Wave 8 migration must reject an incompatible pre-existing structure using
// real `information_schema` metadata, never by counting tables, and must never
// repair it with DROP / rebuild / fabricated data.
//
// The CONTRACTS below are captured from a live `modern_erp_domain_test` database
// after the canonical snapshot reconciliation, so a passing fixture here
// describes the schema a real deployment actually has.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrateSalesCustomerWave8ServiceConsignment, SALES_WAVE8_TABLES } from './migrations/sales-customer-wave8-service-consignment.js';

// [name, data_type, character_maximum_length, is_nullable, column_default, collation_name]
const CONTRACTS = {
  service_fulfillments: {
    collation: 'utf8mb4_0900_ai_ci',
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
    checks: [
      '(`CONFIRMATION_QTY_MICROS` > 0)',
      '(`UNIT_PRICE_CENTS` >= 0)',
      '(`RECOGNITION_AMOUNT_CENTS` >= 0)',
      "(`CONFIRMATION_STATE` in ('PENDING','CONFIRMED','CANCELLED'))",
      '(`VERSION` >= 1)',
      '(((`CONFIRMATION_STATE` = _utf8mb4\\\'PENDING\\\') and (`CONFIRMED_AT` is null) and (`CANCELLED_AT` is null) and (`RECOGNITION_AMOUNT_CENTS` = 0) and (`FINANCE_SOURCE_ID` is null)) or ((`CONFIRMATION_STATE` = _utf8mb4\\\'CANCELLED\\\') and (`CANCELLED_BY` is not null) and (`RECOGNITION_AMOUNT_CENTS` = 0)) or ((`CONFIRMATION_STATE` = _utf8mb4\\\'CONFIRMED\\\') and (`CONFIRMED_AT` is not null) and (`CANCELLED_AT` is null) and (((`RECOGNITION_AMOUNT_CENTS` = 0) and (`FINANCE_SOURCE_ID` is null)) or ((`RECOGNITION_AMOUNT_CENTS` > 0) and (`FINANCE_SOURCE_ID` = `id`)))))',
    ],
    indexes: [
      ['fulfillment_no', ['fulfillment_no'], true],
      ['idx_service_fulfillments_item_state', ['sales_order_item_id', 'confirmation_state', 'id'], false],
      ['idx_service_fulfillments_order', ['sales_order_id', 'id'], false],
      ['idx_service_fulfillments_group_date', ['sales_group_id', 'business_date', 'id'], false],
    ],
    foreignKeys: [
      ['sales_order_id', 'sales_orders', 'id'], ['sales_order_item_id', 'sales_order_items', 'id'],
      ['product_id', 'products', 'id'], ['customer_id', 'customers', 'id'], ['sales_group_id', 'sales_groups', 'id'],
      ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
      ['confirmed_by', 'users', 'id'], ['cancelled_by', 'users', 'id'],
    ],
  },
  consignment_commodity_locations: {
    collation: 'utf8mb4_0900_ai_ci',
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['location_code', 'varchar', 128, 'NO', null],
      ['customer_id', 'varchar', 128, 'NO', null], ['name', 'longtext', 4294967295, 'NO', null],
      ['address_text', 'longtext', 4294967295, 'NO', "'"],
      ['physical_warehouse_id', 'varchar', 128, 'NO', null], ['physical_bin_id', 'varchar', 128, 'YES', null],
      ['active', 'bigint', null, 'NO', '1'], ['effective_from', 'longtext', 4294967295, 'NO', null],
      ['effective_to', 'longtext', 4294967295, 'YES', null], ['version', 'bigint', null, 'NO', '1'],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    primaryKey: ['id'],
    checks: ['(`ACTIVE` in (0,1))', '(`VERSION` >= 1)', '((`EFFECTIVE_TO` is null) or (`EFFECTIVE_TO` >= `EFFECTIVE_FROM`))'],
    indexes: [
      ['uq_consignment_location_customer_code', ['customer_id', 'location_code'], true],
      ['idx_consignment_location_mapping', ['physical_warehouse_id', 'physical_bin_id'], false],
    ],
    foreignKeys: [
      ['customer_id', 'customers', 'id'], ['physical_warehouse_id', 'warehouses', 'id'],
      ['physical_bin_id', 'warehouse_bins', 'id'], ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
    ],
  },
  consignment_commercial_documents: {
    collation: 'utf8mb4_0900_ai_ci',
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
    checks: [
      "(`STATUS` in ('DRAFT','INSTRUCTED','PARTIAL_SETTLED','SETTLED','RETURNED','CANCELLED'))",
      '(`VERSION` >= 1)',
      "(((`STATUS` = 'CANCELLED') and (`CANCELLED_AT` is not null) and (`CANCELLED_BY` is not null)) or ((`STATUS` <> 'CANCELLED') and (`CANCELLED_AT` is null) and (`CANCELLED_BY` is null)))",
    ],
    indexes: [
      ['document_no', ['document_no'], true],
      ['idx_consignment_documents_customer_state', ['customer_id', 'status', 'business_date'], false],
      ['idx_consignment_documents_group_date', ['sales_group_id', 'business_date', 'id'], false],
    ],
    foreignKeys: [
      ['customer_id', 'customers', 'id'], ['sales_group_id', 'sales_groups', 'id'],
      ['source_warehouse_id', 'warehouses', 'id'], ['created_by', 'users', 'id'],
      ['updated_by', 'users', 'id'], ['instructed_by', 'users', 'id'], ['cancelled_by', 'users', 'id'],
    ],
  },
  consignment_commercial_lines: {
    collation: 'utf8mb4_0900_ai_ci',
    columns: [
      ['id', 'varchar', 128, 'NO', null], ['document_id', 'varchar', 128, 'NO', null],
      ['line_no', 'bigint', null, 'NO', null], ['sales_order_item_id', 'varchar', 128, 'YES', null],
      ['product_id', 'varchar', 128, 'NO', null],
      ['consignment_commodity_location_id', 'varchar', 128, 'NO', null],
      ['lot_code', 'longtext', 4294967295, 'YES', null], ['lot_code_key', 'varchar', 128, 'NO', "'"],
      ['consigned_qty_micros', 'bigint', null, 'NO', null], ['settled_qty_micros', 'bigint', null, 'NO', '0'],
      ['returned_qty_micros', 'bigint', null, 'NO', '0'], ['settled_amount_cents', 'bigint', null, 'NO', '0'],
      ['returned_amount_cents', 'bigint', null, 'NO', '0'], ['unit_price_cents', 'bigint', null, 'NO', null],
      ['handoff_movement_group_id', 'varchar', 128, 'YES', null],
      ['last_finance_reference_id', 'varchar', 128, 'YES', null], ['version', 'bigint', null, 'NO', '1'],
      ['created_at', 'longtext', 4294967295, 'NO', null], ['updated_at', 'longtext', 4294967295, 'NO', null],
      ['created_by', 'varchar', 128, 'NO', null], ['updated_by', 'varchar', 128, 'NO', null],
    ],
    primaryKey: ['id'],
    checks: [
      '(`CONSIGNED_QTY_MICROS` > 0)',
      '(`SETTLED_QTY_MICROS` >= 0)',
      '(`RETURNED_QTY_MICROS` >= 0)',
      '(`SETTLED_AMOUNT_CENTS` >= 0)',
      '(`RETURNED_AMOUNT_CENTS` >= 0)',
      '(`UNIT_PRICE_CENTS` >= 0)',
      '(`VERSION` >= 1)',
      '((`SETTLED_QTY_MICROS` + `RETURNED_QTY_MICROS`) <= `CONSIGNED_QTY_MICROS`)',
      "(((`LOT_CODE` is null) and (`LOT_CODE_KEY` = '')) or ((`LOT_CODE` is not null) and (`LOT_CODE_KEY` <> '')))",
    ],
    indexes: [
      ['uq_consignment_lines_number', ['document_id', 'line_no'], true],
      ['uq_consignment_lines_identity', ['document_id', 'product_id', 'consignment_commodity_location_id', 'lot_code_key'], true],
      ['idx_consignment_lines_order_item', ['sales_order_item_id'], false],
      ['idx_consignment_lines_location', ['consignment_commodity_location_id', 'id'], false],
    ],
    foreignKeys: [
      ['document_id', 'consignment_commercial_documents', 'id'], ['sales_order_item_id', 'sales_order_items', 'id'],
      ['product_id', 'products', 'id'],
      ['consignment_commodity_location_id', 'consignment_commodity_locations', 'id'],
      ['created_by', 'users', 'id'], ['updated_by', 'users', 'id'],
    ],
  },
};

// lot_code_key is the byte-identity key and must be compared NO PAD binary,
// matching SQLite `COLLATE BINARY`.
const COLUMN_COLLATIONS = { 'consignment_commercial_lines.lot_code_key': 'utf8mb4_0900_bin' };

class MySqlWave8Fixture {
  constructor({ drift = null, lotKeyCollation = null, ambiguousLotKeys = [] } = {}) {
    this.dialect = 'mysql';
    this.execSql = [];
    this.tables = new Set(SALES_WAVE8_TABLES);
    this.snapshot = structuredClone(CONTRACTS);
    // A database created before the column-generator fix carries the table default.
    this.lotKeyCollation = lotKeyCollation;
    this.ambiguousLotKeys = ambiguousLotKeys;
    if (drift) this.#applyDrift(drift);
  }

  #applyDrift(drift) {
    const mutate = {
      missingUnique: (s) => {
        s.consignment_commercial_lines.indexes = s.consignment_commercial_lines.indexes.filter(([name]) => name !== 'uq_consignment_lines_number');
      },
      uniqueColumnsNarrowed: (s) => {
        const lines = s.consignment_commercial_lines;
        lines.indexes = lines.indexes.map(([name, columns, unique]) => (name === 'uq_consignment_lines_identity' ? [name, ['document_id', 'product_id'], unique] : [name, columns, unique]));
      },
      wrongNullability: (s) => {
        const row = s.consignment_commodity_locations.columns.find(([name]) => name === 'physical_bin_id');
        row[3] = row[3] === 'YES' ? 'NO' : 'YES';
      },
      wrongForeignKey: (s) => {
        const row = s.consignment_commercial_lines.foreignKeys.find(([name]) => name === 'document_id');
        row[1] = 'sales_orders';
      },
      extraForeignKey: (s) => { this.extraForeignKeys = ['line_no', 'products', 'id']; this.extraForeignKeysTable = 'consignment_commercial_lines'; },
      missingCheck: (s) => { s.consignment_commodity_locations.checks = s.consignment_commodity_locations.checks.slice(0, 2); },
      weakenedStateCheck: (s) => {
        s.service_fulfillments.checks = s.service_fulfillments.checks.map((clause) => (clause.includes('CONFIRMATION_STATE') && clause.startsWith('(`CONFIRMATION_STATE`') ? '(`CONFIRMATION_STATE` is not null)' : clause));
      },
      wrongTableCollation: (s) => { s.consignment_commercial_lines.collation = 'utf8mb4_general_ci'; },
      wrongColumnCollation: (s) => { this.columnCollationOverride = { table: 'consignment_commodity_locations', column: 'location_code', value: 'utf8mb4_general_ci' }; },
      wrongColumnType: (s) => {
        const row = s.consignment_commercial_documents.columns.find(([name]) => name === 'currency_code');
        row[1] = 'char';
      },
      wrongColumnLength: (s) => {
        const row = s.consignment_commercial_documents.columns.find(([name]) => name === 'document_no');
        row[2] = 64;
      },
      wrongDefault: (s) => {
        const row = s.consignment_commercial_documents.columns.find(([name]) => name === 'status');
        row[4] = 'OPEN';
      },
      reorderedColumns: (s) => { s.consignment_commercial_lines.columns.reverse(); },
      missingColumn: (s) => { s.consignment_commercial_lines.columns = s.consignment_commercial_lines.columns.filter(([name]) => name !== 'version'); },
      extraColumn: (s) => { s.consignment_commodity_locations.columns.push(['notes', 'longtext', 4294967295, 'YES', null]); },
      wrongPrimaryKey: (s) => { s.consignment_commodity_locations.primaryKey = ['location_code', 'id']; },
      indexOrder: (s) => {
        const lines = s.consignment_commercial_lines;
        lines.indexes = lines.indexes.map(([name, columns, unique]) => (name === 'idx_consignment_lines_location' ? [name, ['id', 'consignment_commodity_location_id'], unique] : [name, columns, unique]));
      },
      nonUniqueUnique: (s) => {
        const lines = s.consignment_commercial_lines;
        lines.indexes = lines.indexes.map(([name, columns, unique]) => (name === 'uq_consignment_lines_identity' ? [name, columns, false] : [name, columns, unique]));
      },
      missingIndex: (s) => {
        const service = s.service_fulfillments;
        service.indexes = service.indexes.filter(([name]) => name !== 'idx_service_fulfillments_order');
      },
    };
    if (!mutate[drift]) throw new Error(`unknown drift option ${drift}`);
    mutate[drift](this.snapshot);
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      all: (...p) => this.#all(normalized, p),
      get: (...p) => this.#get(normalized, p),
      run: () => { throw new Error('the metadata assertion layer must not mutate data'); },
    };
  }

  #columns(table) {
    const parity = COLUMN_COLLATIONS[`${table}.lot_code_key`];
    const override = this.columnCollationOverride?.table === table ? this.columnCollationOverride : null;
    return this.snapshot[table].columns.map(([name, data_type, character_maximum_length, is_nullable, column_default], offset) => ({
      name, position: offset + 1, data_type, character_maximum_length, is_nullable, column_default,
      collation_name: override?.column === name ? override.value
        : name === 'lot_code_key' ? (this.lotKeyCollation || parity) : 'utf8mb4_0900_ai_ci',
    }));
  }

  #all(sql, params) {
    if (sql.includes('information_schema.COLUMNS')) return this.#columns(params[0]);
    if (sql.includes('COUNT(DISTINCT BINARY lot_code_key)')) {
      return this.ambiguousLotKeys.map((group) => ({ ...group, ai_distinct: 1, binary_distinct: 2 }));
    }
    if (sql.includes("CONSTRAINT_NAME='PRIMARY'")) return this.snapshot[params[0]].primaryKey.map((name) => ({ name }));
    if (sql.includes('information_schema.KEY_COLUMN_USAGE') && sql.includes('REFERENCED_TABLE_NAME IS NOT NULL')) {
      const declared = this.snapshot[params[0]].foreignKeys;
      const extra = this.extraForeignKeys && SALES_WAVE8_TABLES.includes(params[0]) ? this.#extraFor(params[0]) : [];
      return [...declared, ...extra].map(([name, referenced_table, referenced_column]) => ({ name, referenced_table, referenced_column }));
    }
    if (sql.includes('information_schema.CHECK_CONSTRAINTS')) return this.#checks(params[0]);
    if (sql.includes('information_schema.STATISTICS')) {
      const [table, name] = params;
      const entry = this.snapshot[table].indexes.find(([indexName]) => indexName === name);
      return entry ? entry[1].map((column_name, offset) => ({ name: column_name, position: offset + 1, non_unique: entry[2] ? '0' : '1', sub_part: null })) : [];
    }
    if (sql.includes('information_schema.TABLES') && sql.includes('TABLE_NAME IN')) return [...this.tables].map((name) => ({ name }));
    throw new Error(`Unhandled fixture all(): ${sql}`);
  }

  #extraFor(table) {
    return this.extraForeignKeysTable === table ? [this.extraForeignKeys] : [];
  }

  #checks(table) {
    return this.snapshot[table].checks.map((check_clause) => ({ check_clause }));
  }

  #get(sql, params) {
    if (sql.includes('COLLATION_NAME collation') && sql.includes('information_schema.COLUMNS')) {
      const column = this.#columns(params[0]).find((row) => row.name === params[1]);
      return column ? { collation: column.collation_name } : undefined;
    }
    if (sql.includes('information_schema.TABLES') && sql.includes('TABLE_COLLATION')) {
      return this.tables.has(params[0]) ? { collation: this.snapshot[params[0]].collation } : undefined;
    }
    throw new Error(`Unhandled fixture get(): ${sql}`);
  }

  exec(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.execSql.push(normalized);
    // Every table already exists, so the CREATE statements are no-ops and the
    // declared indexes already exist. Any other DDL means the assertion layer
    // tried to repair instead of failing closed.
    if (/^CREATE (TABLE|.*INDEX)/i.test(normalized)) return;
    if (/^ALTER TABLE consignment_commercial_lines MODIFY COLUMN lot_code_key/i.test(normalized)) {
      this.lotKeyCollation = 'utf8mb4_0900_bin';
      return;
    }
    throw new Error(`Unexpected DDL in the metadata assertion layer: ${normalized}`);
  }
}

function migrate(drift) {
  const fixture = new MySqlWave8Fixture({ drift });
  migrateSalesCustomerWave8ServiceConsignment(fixture);
  return fixture;
}

describe('Wave 8 four-table MySQL existing-schema fail-closed', () => {
  test('a correct existing schema passes and repeated startup stays a no-op', () => {
    const fixture = migrate(null);
    assert.equal(fixture.execSql.length, 4, 'only the idempotent CREATE statements are issued; the assertion layer emits no DDL');
    assert.equal(migrate(null).execSql.length, 4, 'a repeated startup re-runs the same statements and still passes');
  });

  const rejections = [
    ['missingUnique', /uq_consignment_lines_number/],
    ['uniqueColumnsNarrowed', /uq_consignment_lines_identity column identity\/order/],
    ['missingIndex', /idx_service_fulfillments_order/],
    ['nonUniqueUnique', /uq_consignment_lines_identity uniqueness/],
    ['indexOrder', /idx_consignment_lines_location column identity\/order/],
    ['wrongNullability', /physical_bin_id nullability/],
    ['wrongForeignKey', /document_id foreign key/],
    ['extraForeignKey', /line_no has an unexpected foreign key/],
    ['missingCheck', /CHECK constraints, expected/],
    ['weakenedStateCheck', /missing the CONFIRMATION_STATE/],
    ['wrongTableCollation', /consignment_commercial_lines collation/],
    ['wrongColumnCollation', /location_code collation/],
    ['wrongColumnType', /currency_code type/],
    ['wrongColumnLength', /document_no length/],
    ['wrongDefault', /status default/],
    ['reorderedColumns', /consignment_commercial_lines column order/],
    ['missingColumn', /column set drifted.*version/],
    ['extraColumn', /column set drifted.*notes/],
    ['wrongPrimaryKey', /consignment_commodity_locations primary key/],
  ];

  for (const [drift, message] of rejections) {
    test(`an existing schema with ${drift} fails closed without repairing anything`, () => {
      const fixture = new MySqlWave8Fixture({ drift });
      assert.throws(() => migrateSalesCustomerWave8ServiceConsignment(fixture), message);
      const destructive = fixture.execSql.filter((sql) => /DROP|TRUNCATE|DELETE|ALTER|MODIFY/i.test(sql));
      assert.deepEqual(destructive, [], 'an incompatible schema is left exactly as found');
    });
  }

  test('a missing table is still reported by the bootstrap completeness check', () => {
    const fixture = new MySqlWave8Fixture({});
    fixture.tables.delete('consignment_commercial_lines');
    assert.throws(() => migrateSalesCustomerWave8ServiceConsignment(fixture), /Wave 8 schema bootstrap incomplete/);
  });

  test('a pre-fix database is converged to the binary LOT collation by one additive ALTER', () => {
    const fixture = new MySqlWave8Fixture({ lotKeyCollation: 'utf8mb4_0900_ai_ci' });
    migrateSalesCustomerWave8ServiceConsignment(fixture);
    const alter = fixture.execSql.filter((sql) => /MODIFY COLUMN lot_code_key/i.test(sql));
    assert.equal(alter.length, 1, 'exactly one bounded collation ALTER, no rebuild and no data repair');
    assert.match(alter[0], /COLLATE utf8mb4_0900_bin/);
    assert.equal(fixture.lotKeyCollation, 'utf8mb4_0900_bin');

    // Repeated startup must be a no-op.
    const replay = new MySqlWave8Fixture({ lotKeyCollation: 'utf8mb4_0900_bin' });
    migrateSalesCustomerWave8ServiceConsignment(replay);
    assert.deepEqual(replay.execSql.filter((sql) => /MODIFY COLUMN lot_code_key/i.test(sql)), []);
  });

  test('an ambiguous LOT identity fails closed before any DDL and never rewrites history', () => {
    const fixture = new MySqlWave8Fixture({
      lotKeyCollation: 'utf8mb4_0900_ai_ci',
      ambiguousLotKeys: [{ document_id: 'doc-1', product_id: 'p-1', consignment_commodity_location_id: 'loc-1' }],
    });
    assert.throws(() => migrateSalesCustomerWave8ServiceConsignment(fixture), /lot_code_key collation change is ambiguous.*doc-1\/p-1\/loc-1/s);
    assert.deepEqual(fixture.execSql.filter((sql) => /MODIFY COLUMN|UPDATE |DELETE |DROP /i.test(sql)), [],
      'an ambiguous database is left exactly as found');
    assert.equal(fixture.lotKeyCollation, 'utf8mb4_0900_ai_ci', 'the column was never changed');
  });

  test('any further collation drift beyond the LOT key is still refused', () => {
    const drifted = new MySqlWave8Fixture({ drift: 'wrongColumnCollation' });
    assert.throws(() => migrateSalesCustomerWave8ServiceConsignment(drifted), /location_code collation/);
  });
});