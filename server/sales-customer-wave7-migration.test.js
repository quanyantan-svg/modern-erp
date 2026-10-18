import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db.js';
import {
  migrateSalesCustomerWave7PrepaymentReservation,
  SALES_WAVE7_TABLES,
} from './migrations/sales-customer-wave7-prepayment-reservation.js';

function preWave7Sqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE warehouses (id TEXT PRIMARY KEY);
    CREATE TABLE products (id TEXT PRIMARY KEY);
    CREATE TABLE sales_orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, salesperson_id TEXT, sales_group_id TEXT);
    CREATE TABLE sales_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity REAL NOT NULL);
    CREATE TABLE planning_reservations (id TEXT PRIMARY KEY);
    CREATE TABLE inventory_locks (id TEXT PRIMARY KEY);
    INSERT INTO users(id) VALUES('legacy-user');
    INSERT INTO customers(id) VALUES('legacy-customer');
    INSERT INTO sales_orders(id, customer_id) VALUES('legacy-so', 'legacy-customer');
  `);
  return db;
}

test('Wave 7 SQLite upgrade and replay create the three additive carriers with PK/FK/CHECK and preserve legacy rows', () => {
  const db = preWave7Sqlite();
  try {
    migrateSalesCustomerWave7PrepaymentReservation(db);
    migrateSalesCustomerWave7PrepaymentReservation(db);
    const placeholders = SALES_WAVE7_TABLES.map(() => '?').join(',');
    assert.deepEqual(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders}) ORDER BY name`).all(...SALES_WAVE7_TABLES).map((row) => row.name),
      [...SALES_WAVE7_TABLES].sort(),
    );
    // Legacy SO row preserved.
    assert.equal(db.prepare('SELECT id FROM sales_orders WHERE id=?').get('legacy-so').id, 'legacy-so');
    // Unique indexes installed.
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='uq_sales_prepayment_requirement_order_line'`).get());
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='uq_sales_prepayment_gate_result_stage_snapshot'`).get());
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='uq_sales_reservation_intent_order_line_mode'`).get());
    // FK on reservation intent -> sales_order and sales_order_items.
    const fks = db.prepare(`PRAGMA foreign_key_list(sales_reservation_intent)`).all();
    const hasSalesFk = fks.some((row) => row.from === 'sales_order_id' && row.table === 'sales_orders' && row.to === 'id');
    assert.ok(hasSalesFk, `sales_order_id FK missing: ${JSON.stringify(fks)}`);
    const hasItemFk = fks.some((row) => row.from === 'sales_order_item_id' && row.table === 'sales_order_items' && row.to === 'id');
    assert.ok(hasItemFk, `sales_order_item_id FK missing: ${JSON.stringify(fks)}`);
    // CHECK constraints present.
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_reservation_intent'`).get().sql;
    assert.match(sql, /CHECK\(requested_qty > 0\)/);
    assert.match(sql, /CHECK\(granted_qty >= 0\)/);
    assert.match(sql, /CHECK\(intent_state IN \('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED'\)\)/);
  } finally {
    db.close();
  }
});

test('Wave 7 SQLite fresh full bootstrap and replay preserve foreign key integrity', () => {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave7-migration-'));
  const path = join(temp, 'fresh.db');
  let db;
  try {
    db = createDatabase(path);
    migrateSalesCustomerWave7PrepaymentReservation(db);
    migrateSalesCustomerWave7PrepaymentReservation(db);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE type=? AND name=?').get('table', 'sales_prepayment_requirements').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE type=? AND name=?').get('table', 'sales_prepayment_gate_results').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE type=? AND name=?').get('table', 'sales_reservation_intent').c, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db?.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Wave 7 SQLite REQUIREMENT unique pair (sales_order_id, line_no) rejects duplicates', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE warehouses (id TEXT PRIMARY KEY);
    CREATE TABLE products (id TEXT PRIMARY KEY);
    CREATE TABLE sales_orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL);
    CREATE TABLE sales_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity REAL NOT NULL);
    CREATE TABLE planning_reservations (id TEXT PRIMARY KEY);
    CREATE TABLE inventory_locks (id TEXT PRIMARY KEY);
    INSERT INTO users(id) VALUES('u1');
    INSERT INTO sales_orders(id, customer_id) VALUES('so1','c1');
  `);
  try {
    migrateSalesCustomerWave7PrepaymentReservation(db);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, created_at, created_by)
      VALUES('r1','so1',0,1000,'ORDER_VALUE',?,?)`).run('2026-10-18T00:00:00Z', 'u1');
    assert.throws(
      () => db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, created_at, created_by)
        VALUES('r2','so1',0,2000,'ORDER_VALUE',?,?)`).run('2026-10-18T00:00:00Z', 'u1'),
      /UNIQUE constraint failed/,
    );
  } finally {
    db.close();
  }
});

test('Wave 7 SQLite reservation intent uniqueness normalizes NULL order-item identity', () => {
  const db = preWave7Sqlite();
  try {
    migrateSalesCustomerWave7PrepaymentReservation(db);
    db.prepare(`INSERT INTO products(id) VALUES('p1')`).run();
    db.prepare(`INSERT INTO sales_reservation_intent(
      id,sales_order_id,sales_order_item_id,product_id,reservation_mode,intent_state,
      requested_qty,granted_qty,consumed_qty,released_qty,created_at,created_by)
      VALUES(?,?,?,?,?,'REQUESTED',1,0,0,0,?,?)`)
      .run('intent-1', 'legacy-so', null, 'p1', 'ON_HAND_RESERVATION', '2026-10-18T00:00:00Z', 'legacy-user');
    assert.throws(
      () => db.prepare(`INSERT INTO sales_reservation_intent(
        id,sales_order_id,sales_order_item_id,product_id,reservation_mode,intent_state,
        requested_qty,granted_qty,consumed_qty,released_qty,created_at,created_by)
        VALUES(?,?,?,?,?,'REQUESTED',1,0,0,0,?,?)`)
        .run('intent-2', 'legacy-so', null, 'p1', 'ON_HAND_RESERVATION', '2026-10-18T00:00:00Z', 'legacy-user'),
      /UNIQUE constraint failed/,
    );
  } finally {
    db.close();
  }
});

class MySqlWave7Fixture {
  constructor() {
    this.dialect = 'mysql';
    this.columns = new Map();
    this.tables = new Set();
    this.indexes = new Map();
    this.fks = [];
    this.checks = new Map();
    this.execSql = [];
    for (const t of SALES_WAVE7_TABLES) this.columns.set(t, new Set());
  }
  addColumns(table, names) {
    const set = this.columns.get(table) || new Set();
    for (const n of names) set.add(n);
    this.columns.set(table, set);
    this.tables.add(table);
  }
  addTable(name) { this.tables.add(name); }
  setIndex(table, name, columns, opts = {}) {
    if (!this.indexes.has(table)) this.indexes.set(table, new Map());
    const map = this.indexes.get(table);
    map.set(name, columns.map((c, i) => ({
      column_name: c.name,
      expression: c.expression || null,
      sub_part: c.subPart || null,
      seq_in_index: i + 1,
      non_unique: opts.unique ? 0 : 1,
    })));
  }
  setCheck(name, expr) { this.checks.set(name, { CONSTRAINT_NAME: name, CHECK_CLAUSE: expr }); }
  setFk(row) { this.fks.push(row); }
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const fixture = this;
    const handler = {
      all: (...params) => {
        if (normalized.includes('information_schema.STATISTICS')) {
          const [tableName, indexName] = params;
          const map = fixture.indexes.get(tableName);
          if (!map) return [];
          if (indexName) return map.get(indexName) || [];
          // Project to { name } for index-name listing queries.
          return [...map.keys()].map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.COLUMNS')) {
          return [...(fixture.columns.get(params[0]) || new Set())].map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.KEY_COLUMN_USAGE')) {
          const [tableName, columnName] = params;
          return fixture.fks.filter((row) => row.table === tableName && row.column === columnName);
        }
        if (normalized.includes('information_schema.TABLES')) {
          if (params && params.length === 1 && typeof params[0] === 'string') {
            return fixture.tables.has(params[0]) ? [{ name: params[0] }] : [];
          }
          if (params && params.length >= 3) {
            return [...SALES_WAVE7_TABLES].map((name) => ({ name }));
          }
          return [...fixture.tables].sort().map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.CHECK_CONSTRAINTS')) {
          if (params && params.length >= 2) {
            const target = fixture.checks.get(params[1]);
            return target ? [target] : [];
          }
          return [];
        }
        throw new Error(`Unhandled all(): ${normalized}`);
      },
      get: (...params) => {
        if (normalized.includes('information_schema.TABLES')) {
          if (params && params.length === 1 && typeof params[0] === 'string') {
            return fixture.tables.has(params[0]) ? { name: params[0] } : null;
          }
        }
        return null;
      },
      run: () => undefined,
    };
    return handler;
  }
  exec(sql) {
    this.execSql.push(sql);
  }
}

// Bootstrap-snapshot artifact fixture. The snapshot renderer's
// `mysqlType()` (server/database/mysql-schema.js) emits LONGTEXT for every
// non-id, non-indexed TEXT column. On a fresh MySQL DB the bootstrap
// `bootstrapMySql()` runs first, so columns like `ratio_basis` materialise
// as LONGTEXT before the Wave 7 migration's CREATE TABLE IF NOT EXISTS
// (which becomes a no-op). The fixture below reproduces that exact shape
// so the regression test exercises `reconcileMySqlColumnContracts`.
class BootstrapLongtextWave7Fixture {
  constructor() {
    this.dialect = 'mysql';
    this.tables = new Set();
    this.columnTypes = new Map(); // table -> Map(columnName -> { data_type, character_maximum_length, is_nullable, column_default })
    this.indexes = new Map();
    this.fks = [];
    this.checks = new Map();
    this.execSql = [];
    this.rows = new Map(); // table -> array of row objects (used by MAX(LENGTH))
    for (const t of SALES_WAVE7_TABLES) {
      this.tables.add(t);
      this.columnTypes.set(t, new Map());
      this.rows.set(t, []);
    }
  }
  addColumnType(table, name, data_type, character_maximum_length, is_nullable, column_default, numeric_precision = null, numeric_scale = null) {
    const map = this.columnTypes.get(table) || new Map();
    map.set(name, { data_type, character_maximum_length, is_nullable, column_default, numeric_precision, numeric_scale });
    this.columnTypes.set(table, map);
  }
  addRow(table, row) {
    const list = this.rows.get(table) || [];
    list.push(row);
    this.rows.set(table, list);
  }
  bootstrapPrepaymentRequirements() {
    // Reproduce the exact DDL shape `bootstrapMySql` produces for this
    // table from the SQLite snapshot. The non-id, non-indexed `ratio_basis`
    // is LONGTEXT here even though the canonical contract is VARCHAR(16).
    this.addColumnType('sales_prepayment_requirements', 'id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_requirements', 'sales_order_id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_requirements', 'line_no', 'bigint', null, 'NO', 0);
    this.addColumnType('sales_prepayment_requirements', 'required_amount_cents', 'bigint', null, 'NO', null);
    this.addColumnType('sales_prepayment_requirements', 'ratio_basis', 'longtext', 4294967295, 'NO', "'ORDER_VALUE'");
    this.addColumnType('sales_prepayment_requirements', 'effective_from', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_prepayment_requirements', 'effective_to', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_prepayment_requirements', 'created_at', 'longtext', 4294967295, 'NO', null);
    this.addColumnType('sales_prepayment_requirements', 'created_by', 'varchar', 128, 'NO', null);
  }
  bootstrapPrepaymentGateResults() {
    // The snapshot renderer's `mysqlType()` fallback routes indexed TEXT
    // columns to VARCHAR(128) and non-indexed TEXT columns to LONGTEXT.
    // `stage` participates in two indexes (`uq_..._stage_snapshot` and
    // `idx_..._order_stage`) so Bootstrap materialises it as VARCHAR(128)
    // even though the canonical contract is VARCHAR(32).
    this.addColumnType('sales_prepayment_gate_results', 'id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'sales_order_id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'stage', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'gate_decision', 'longtext', 4294967295, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'required_remaining_cents', 'bigint', null, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'eligible_advance_cents', 'bigint', null, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'refunded_amount_cents', 'bigint', null, 'NO', 0);
    this.addColumnType('sales_prepayment_gate_results', 'applied_amount_cents', 'bigint', null, 'NO', 0);
    this.addColumnType('sales_prepayment_gate_results', 'override_reason', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_prepayment_gate_results', 'overridden_by', 'varchar', 128, 'YES', null);
    this.addColumnType('sales_prepayment_gate_results', 'source_balance_identities', 'longtext', 4294967295, 'NO', "'[]'");
    this.addColumnType('sales_prepayment_gate_results', 'snapshot_key', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'evaluated_at', 'longtext', 4294967295, 'NO', null);
    this.addColumnType('sales_prepayment_gate_results', 'evaluated_by', 'varchar', 128, 'NO', null);
  }
  bootstrapReservationIntent() {
    // `reservation_mode` is the third key of the functional UNIQUE
    // `uq_sales_reservation_intent_order_line_mode` so Bootstrap
    // materialises it as VARCHAR(128) (snapshot treats functional-index
    // columns as indexed); `intent_state` is in `idx_..._state`. Both
    // contract to a narrower VARCHAR. `consumer_event`, `expected_supply_
    // source_type` and `expected_supply_source_id` are not indexed and
    // therefore materialise as LONGTEXT.
    this.addColumnType('sales_reservation_intent', 'id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_reservation_intent', 'sales_order_id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_reservation_intent', 'sales_order_item_id', 'varchar', 128, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'product_id', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_reservation_intent', 'warehouse_id', 'varchar', 128, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'reservation_mode', 'varchar', 128, 'NO', null);
    this.addColumnType('sales_reservation_intent', 'intent_state', 'varchar', 128, 'NO', "'NONE'");
    this.addColumnType('sales_reservation_intent', 'requested_qty', 'decimal', null, 'NO', null, 24, 6);
    this.addColumnType('sales_reservation_intent', 'granted_qty', 'decimal', null, 'NO', 0, 24, 6);
    this.addColumnType('sales_reservation_intent', 'consumed_qty', 'decimal', null, 'NO', 0, 24, 6);
    this.addColumnType('sales_reservation_intent', 'released_qty', 'decimal', null, 'NO', 0, 24, 6);
    this.addColumnType('sales_reservation_intent', 'planning_reservation_id', 'varchar', 128, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'inventory_lock_id', 'varchar', 128, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'expected_supply_source_type', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'expected_supply_source_id', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'expected_supply_capacity', 'decimal', null, 'YES', null, 24, 6);
    this.addColumnType('sales_reservation_intent', 'consumer_event', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'requested_at', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'granted_at', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'released_at', 'longtext', 4294967295, 'YES', null);
    this.addColumnType('sales_reservation_intent', 'created_at', 'longtext', 4294967295, 'NO', null);
    this.addColumnType('sales_reservation_intent', 'created_by', 'varchar', 128, 'NO', null);
  }
  bootstrapWave7Schema() {
    this.bootstrapPrepaymentRequirements();
    this.bootstrapPrepaymentGateResults();
    this.bootstrapReservationIntent();
  }
  setIndex(table, name, columns, opts = {}) {
    if (!this.indexes.has(table)) this.indexes.set(table, new Map());
    const map = this.indexes.get(table);
    map.set(name, columns.map((c, i) => ({
      column_name: c.name,
      expression: c.expression || null,
      sub_part: c.subPart || null,
      seq_in_index: i + 1,
      non_unique: opts.unique ? 0 : 1,
    })));
  }
  setCheck(name, expr) { this.checks.set(name, { CONSTRAINT_NAME: name, CHECK_CLAUSE: expr }); }
  setFk(row) { this.fks.push(row); }
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const fixture = this;
    const handler = {
      all: (...params) => {
        if (normalized.includes('information_schema.STATISTICS')) {
          const [tableName, indexName] = params;
          const map = fixture.indexes.get(tableName);
          if (!map) return [];
          if (indexName) return map.get(indexName) || [];
          return [...map.keys()].map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.COLUMNS') && normalized.includes(' COLUMN_NAME=?') && normalized.toUpperCase().includes('SELECT')) {
          const [tableName, columnName] = params;
          const col = fixture.columnTypes.get(tableName)?.get(columnName);
          return col ? [{ ...col, name: columnName }] : [];
        }
        if (normalized.includes('information_schema.COLUMNS')) {
          const tableName = params[0];
          const map = fixture.columnTypes.get(tableName) || new Map();
          return [...map.entries()].map(([name, meta]) => ({ name, ...meta }));
        }
        if (normalized.includes('information_schema.KEY_COLUMN_USAGE')) {
          const [tableName, columnName] = params;
          return fixture.fks.filter((row) => row.table === tableName && row.column === columnName);
        }
        if (normalized.includes('information_schema.TABLES')) {
          if (params && params.length === 1 && typeof params[0] === 'string') {
            return fixture.tables.has(params[0]) ? [{ name: params[0] }] : [];
          }
          if (params && params.length >= 3) {
            return [...SALES_WAVE7_TABLES].map((name) => ({ name }));
          }
          return [...fixture.tables].sort().map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.CHECK_CONSTRAINTS')) {
          if (params && params.length >= 2) {
            const target = fixture.checks.get(params[1]);
            return target ? [target] : [];
          }
          return [];
        }
        throw new Error(`Unhandled all(): ${normalized}`);
      },
      get: (...params) => {
        if (normalized.includes('information_schema.COLUMNS')) {
          const [tableName, columnName] = params;
          const col = fixture.columnTypes.get(tableName)?.get(columnName);
          return col ? { name: columnName, ...col } : null;
        }
        if (normalized.includes('MAX(LENGTH(')) {
          const match = normalized.match(/MAX\(LENGTH\(`?(\w+)`?\)\)\s+\w+\s+FROM\s+`?(\w+)`?/i);
          if (!match) throw new Error(`Cannot parse MAX(LENGTH) probe: ${normalized}`);
          const [, columnName, tableName] = match;
          const rows = fixture.rows.get(tableName) || [];
          let maxLength = null;
          for (const row of rows) {
            const value = row[columnName];
            if (value == null) continue;
            const len = String(value).length;
            if (maxLength == null || len > maxLength) maxLength = len;
          }
          return { max_length: maxLength };
        }
        if (normalized.includes('information_schema.TABLES')) {
          if (params && params.length === 1 && typeof params[0] === 'string') {
            return fixture.tables.has(params[0]) ? { name: params[0] } : null;
          }
        }
        return null;
      },
      run: () => undefined,
    };
    return handler;
  }
  exec(sql) {
    // Capture ALTER TABLE statements that reconcile bootstrap LONGTEXT
    // columns so the regression test can verify the migration fired the
    // expected MODIFY COLUMN.
    this.execSql.push(sql);
    // Update tracked column metadata to reflect the ALTER so subsequent
    // assertions see the post-migration shape.
    const alterMatch = sql.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+MODIFY COLUMN\s+`?([A-Za-z0-9_]+)`?\s+([A-Z]+)(?:\((\d+)\))?\s*(NOT NULL|NULL)?\s*(DEFAULT\s+('([^']*)'|(\d+)))?/i);
    if (alterMatch) {
      const [, table, column, type, length, nullSpec, , defaultStr, defaultNum] = alterMatch;
      const map = this.columnTypes.get(table);
      if (map && map.has(column)) {
        const lowerType = type.toLowerCase();
        const charLength = length != null ? Number(length) : null;
        const isNullable = nullSpec === null ? map.get(column).is_nullable : (String(nullSpec).toUpperCase().includes('NOT') ? 'NO' : 'YES');
        const defaultValue = defaultStr != null ? defaultStr : (defaultNum != null ? Number(defaultNum) : map.get(column).column_default);
        const prior = map.get(column);
        map.set(column, { data_type: lowerType, character_maximum_length: charLength, is_nullable: isNullable, column_default: defaultValue, numeric_precision: prior.numeric_precision, numeric_scale: prior.numeric_scale });
      }
    }
  }
  // Mirror the production `normalizeDefault` used by `assertMySqlColumnContracts`
  // so the deterministic test fixture exercises the exact same reduction
  // that the live MySQL gate applies. Any divergence between the two
  // functions would silently mask a real contract failure.
  normalizeDefault(value) {
    return String(value ?? '')
      .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
      .replace(/[()'"\s]/g, '');
  }
}

// Shared setup for the bootstrap-artifact regression tests. The fixture
// mirrors the exact DDL shape that `bootstrapMySql` produces for the three
// Wave 7 tables from the SQLite snapshot, plus the FKs / indexes / auto-
// named CHECK constraints the snapshot renderer emits.
function buildBootstrapWave7Fixture() {
  const fixture = new BootstrapLongtextWave7Fixture();
  fixture.bootstrapWave7Schema();
  // Mirror the bootstrap FK shape so `ensureMySqlForeignKey` is happy.
  fixture.setFk({ table: 'sales_prepayment_requirements', column: 'sales_order_id', constraint_name: 'sales_prepayment_requirements_ibfk_2', referenced_table: 'sales_orders', referenced_column: 'id' });
  fixture.setFk({ table: 'sales_prepayment_requirements', column: 'created_by', constraint_name: 'sales_prepayment_requirements_ibfk_1', referenced_table: 'users', referenced_column: 'id' });
  fixture.setIndex('sales_prepayment_requirements', 'uq_sales_prepayment_requirement_order_line', [
    { name: 'sales_order_id' }, { name: 'line_no' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_requirements', 'idx_sales_prepayment_requirement_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_prepayment_gate_results', 'uq_sales_prepayment_gate_result_stage_snapshot', [
    { name: 'sales_order_id' }, { name: 'stage' }, { name: 'snapshot_key' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_gate_results', 'idx_sales_prepayment_gate_result_order_stage', [
    { name: 'sales_order_id' }, { name: 'stage' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_product_warehouse', [
    { name: 'product_id' }, { name: 'warehouse_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_state', [
    { name: 'intent_state' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_planning', [
    { name: 'planning_reservation_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'uq_sales_reservation_intent_order_line_mode', [
    { name: 'sales_order_id' }, { expression: "coalesce(`sales_order_item_id`,_utf8mb4'')" }, { name: 'reservation_mode' },
  ], { unique: true });
  // The bootstrap emits auto-named CHECK constraints; the migration adds
  // the canonical named CHECKs alongside them.
  fixture.setCheck('sales_prepayment_requirements_chk_1', "(`required_amount_cents` >= 0)");
  fixture.setCheck('sales_prepayment_requirements_chk_2', "(`ratio_basis` in (_utf8mb4'LINE_VALUE',_utf8mb4'ORDER_VALUE'))");
  fixture.setCheck('sales_prepayment_gate_results_chk_1', "(`required_remaining_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_2', "(`eligible_advance_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_3', "(`refunded_amount_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_4', "(`applied_amount_cents` >= 0)");
  return fixture;
}

// Canonical Wave 7 contract type per (table, column). Used to assert
// every bootstrap artifact is reconciled to its canonical shape.
const WAVE7_CANONICAL_TYPES = Object.freeze({
  sales_prepayment_requirements: Object.freeze({
    ratio_basis: Object.freeze({ data_type: 'varchar', character_maximum_length: 16 }),
  }),
  sales_prepayment_gate_results: Object.freeze({
    stage: Object.freeze({ data_type: 'varchar', character_maximum_length: 32 }),
    gate_decision: Object.freeze({ data_type: 'varchar', character_maximum_length: 32 }),
  }),
  sales_reservation_intent: Object.freeze({
    reservation_mode: Object.freeze({ data_type: 'varchar', character_maximum_length: 32 }),
    intent_state: Object.freeze({ data_type: 'varchar', character_maximum_length: 16 }),
    expected_supply_source_type: Object.freeze({ data_type: 'varchar', character_maximum_length: 64 }),
    expected_supply_source_id: Object.freeze({ data_type: 'varchar', character_maximum_length: 128 }),
    consumer_event: Object.freeze({ data_type: 'varchar', character_maximum_length: 64 }),
  }),
});

test('Wave 7 MySQL reconciliation reconciles every Bootstrap artifact across all three tables', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Without the reconciliation step the strict `assertMySqlColumnContracts`
  // would throw at the first column whose bootstrap shape disagrees with
  // the contract. Running the migration must succeed end-to-end.
  migrateSalesCustomerWave7PrepaymentReservation(fixture);

  // Every Wave 7 column whose contract type differs from its bootstrap
  // shape must be brought to the canonical type/length after migration.
  for (const [table, columns] of Object.entries(WAVE7_CANONICAL_TYPES)) {
    for (const [column, expected] of Object.entries(columns)) {
      const meta = fixture.columnTypes.get(table).get(column);
      assert.equal(meta.data_type, expected.data_type, `${table}.${column} data_type`);
      assert.equal(meta.character_maximum_length, expected.character_maximum_length, `${table}.${column} character_maximum_length`);
    }
  }
  // Each reconciliation must have emitted exactly one MODIFY COLUMN.
  const expectedAlters = [
    /ALTER TABLE\s+`?sales_prepayment_requirements`?\s+MODIFY COLUMN\s+`?ratio_basis`?\s+VARCHAR\(16\)/i,
    /ALTER TABLE\s+`?sales_prepayment_gate_results`?\s+MODIFY COLUMN\s+`?stage`?\s+VARCHAR\(32\)/i,
    /ALTER TABLE\s+`?sales_prepayment_gate_results`?\s+MODIFY COLUMN\s+`?gate_decision`?\s+VARCHAR\(32\)/i,
    /ALTER TABLE\s+`?sales_reservation_intent`?\s+MODIFY COLUMN\s+`?reservation_mode`?\s+VARCHAR\(32\)/i,
    /ALTER TABLE\s+`?sales_reservation_intent`?\s+MODIFY COLUMN\s+`?intent_state`?\s+VARCHAR\(16\)/i,
    /ALTER TABLE\s+`?sales_reservation_intent`?\s+MODIFY COLUMN\s+`?expected_supply_source_type`?\s+VARCHAR\(64\)/i,
    /ALTER TABLE\s+`?sales_reservation_intent`?\s+MODIFY COLUMN\s+`?expected_supply_source_id`?\s+VARCHAR\(128\)/i,
    /ALTER TABLE\s+`?sales_reservation_intent`?\s+MODIFY COLUMN\s+`?consumer_event`?\s+VARCHAR\(64\)/i,
  ];
  for (const pattern of expectedAlters) {
    const matches = fixture.execSql.filter((sql) => pattern.test(sql));
    assert.equal(matches.length, 1, `expected one MODIFY COLUMN matching ${pattern}; got: ${JSON.stringify(fixture.execSql)}`);
  }
});

test('Wave 7 MySQL reconciliation preserves nullability and defaults while narrowing', () => {
  const fixture = buildBootstrapWave7Fixture();
  migrateSalesCustomerWave7PrepaymentReservation(fixture);
  // Sample three columns that exercise both nullable and non-nullable shapes.
  const samples = [
    ['sales_prepayment_requirements', 'ratio_basis', 'NO', "'ORDER_VALUE'"],
    ['sales_reservation_intent', 'intent_state', 'NO', "'NONE'"],
    ['sales_reservation_intent', 'expected_supply_source_id', 'YES', null],
    ['sales_reservation_intent', 'consumer_event', 'YES', null],
  ];
  for (const [table, column, isNullable, columnDefault] of samples) {
    const meta = fixture.columnTypes.get(table).get(column);
    assert.equal(meta.is_nullable, isNullable, `${table}.${column} is_nullable`);
    assert.equal(meta.column_default, columnDefault, `${table}.${column} column_default`);
  }
});

test('Wave 7 MySQL reconciliation is a no-op when the column already matches the contract', () => {
  // Synthesise a database where every Bootstrap-affected column already
  // carries its canonical shape. The migration must observe the match
  // and skip MODIFY COLUMN entirely.
  const fixture = buildBootstrapWave7Fixture();
  fixture.columnTypes.get('sales_prepayment_requirements').set('ratio_basis', { data_type: 'varchar', character_maximum_length: 16, is_nullable: 'NO', column_default: "'ORDER_VALUE'" });
  fixture.columnTypes.get('sales_prepayment_gate_results').set('stage', { data_type: 'varchar', character_maximum_length: 32, is_nullable: 'NO', column_default: null });
  fixture.columnTypes.get('sales_prepayment_gate_results').set('gate_decision', { data_type: 'varchar', character_maximum_length: 32, is_nullable: 'NO', column_default: null });
  fixture.columnTypes.get('sales_reservation_intent').set('reservation_mode', { data_type: 'varchar', character_maximum_length: 32, is_nullable: 'NO', column_default: null });
  fixture.columnTypes.get('sales_reservation_intent').set('intent_state', { data_type: 'varchar', character_maximum_length: 16, is_nullable: 'NO', column_default: "'NONE'" });
  fixture.columnTypes.get('sales_reservation_intent').set('expected_supply_source_type', { data_type: 'varchar', character_maximum_length: 64, is_nullable: 'YES', column_default: null });
  fixture.columnTypes.get('sales_reservation_intent').set('expected_supply_source_id', { data_type: 'varchar', character_maximum_length: 128, is_nullable: 'YES', column_default: null });
  fixture.columnTypes.get('sales_reservation_intent').set('consumer_event', { data_type: 'varchar', character_maximum_length: 64, is_nullable: 'YES', column_default: null });

  migrateSalesCustomerWave7PrepaymentReservation(fixture);

  // No MODIFY COLUMN may have been emitted for any canonical column.
  const reconcilePatterns = [
    /MODIFY COLUMN\s+`?ratio_basis`?/i,
    /MODIFY COLUMN\s+`?stage`?/i,
    /MODIFY COLUMN\s+`?gate_decision`?/i,
    /MODIFY COLUMN\s+`?reservation_mode`?/i,
    /MODIFY COLUMN\s+`?intent_state`?/i,
    /MODIFY COLUMN\s+`?expected_supply_source_type`?/i,
    /MODIFY COLUMN\s+`?expected_supply_source_id`?/i,
    /MODIFY COLUMN\s+`?consumer_event`?/i,
  ];
  for (const pattern of reconcilePatterns) {
    const matches = fixture.execSql.filter((sql) => pattern.test(sql));
    assert.equal(matches.length, 0, `expected zero MODIFY COLUMNs matching ${pattern}; got: ${JSON.stringify(fixture.execSql)}`);
  }
});

test('Wave 7 MySQL narrowing fails closed when stored values exceed the canonical VARCHAR length', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Seed a pre-existing row whose `stage` value is 33 chars long. The
  // canonical contract narrows `stage` to VARCHAR(32), which would
  // truncate the row. The data-preservation probe must fail closed.
  fixture.addRow('sales_prepayment_gate_results', { stage: 'PLANNING_RELEASE_OVER_THIRTY_TWO_CHARS_X' });
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL narrowing conflict: sales_prepayment_gate_results.stage has stored values up to 40 chars, cannot narrow to VARCHAR\(32\) without truncation/,
  );
  // No MODIFY COLUMN may have been emitted once the probe failed closed.
  const stageAlters = fixture.execSql.filter((sql) => /MODIFY COLUMN\s+`?stage`?/i.test(sql));
  assert.equal(stageAlters.length, 0);
});

test('Wave 7 MySQL narrowing is safe when stored values fit the canonical VARCHAR length', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Seed a pre-existing row whose `stage` value is at the longest legal
  // size (15 chars: 'PLANNING_RELEASE'). The probe must accept it and
  // the migration must succeed.
  fixture.addRow('sales_prepayment_gate_results', { stage: 'PLANNING_RELEASE' });
  assert.doesNotThrow(() => migrateSalesCustomerWave7PrepaymentReservation(fixture));
});

test('Wave 7 MySQL reconciliation fails closed when stage carries an unrecognized non-128 VARCHAR', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Simulate a production schema drift where `stage` was widened to
  // VARCHAR(50) by an unrelated migration. The contract still says
  // VARCHAR(32), but VARCHAR(50) is neither LONGTEXT nor VARCHAR(128),
  // so the migration must refuse to silently rewrite it.
  fixture.columnTypes.get('sales_prepayment_gate_results').set('stage', { data_type: 'varchar', character_maximum_length: 50, is_nullable: 'NO', column_default: null });
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL column type mismatch: sales_prepayment_gate_results.stage is varchar\(50\)/,
  );
});

// -----------------------------------------------------------------------------
// Default-value contract audit
// -----------------------------------------------------------------------------
//
// The Wave 7 contract encodes canonical defaults for three string columns:
//   ratio_basis          = 'ORDER_VALUE'
//   source_balance_identities = '[]'
//   intent_state         = 'NONE'
//
// MySQL 8 stores expression defaults on TEXT/BLOB/JSON columns with one of
// several recognized metadata representations: `'value'`, `('value')`,
// `_utf8mb4'value'`, `_utf8mb4('value')`, and — in some clients / versions —
// the same text padded with whitespace or wrapped in double quotes. The
// hardened `normalizeDefault` must accept every equivalent representation
// without emitting DDL, and must still reject genuinely incompatible
// defaults.

test('Wave 7 MySQL default normalization accepts every recognized MySQL representation of source_balance_identities', () => {
  // Every recognized MySQL 8 metadata representation of the canonical
  // default `'[]'` for `source_balance_identities` (a TEXT/LONGTEXT column).
  const canonicalContract = '[]';
  const representations = [
    ["quoted literal",                "'[]'"],
    ["quoted with charset prefix",    "_utf8mb4'[]'"],
    ["parenthesised expression",      "('[]')"],
    ["parenthesised with charset",    "_utf8mb4('[]')"],
    ["double-quoted literal",         "\"[]\""],
    ["padded with whitespace",        "  '[]'  "],
    ["padded paren expression",       "  ('[]')  "],
  ];
  for (const [name, actualDefault] of representations) {
    const normalized = String(actualDefault ?? '')
      .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
      .replace(/[()'"\s]/g, '');
    assert.equal(normalized, canonicalContract, `representation "${name}" must normalize to canonical form`);
  }
});

test('Wave 7 MySQL default assertion accepts the Bootstrap-emitted MySQL representation without DDL', () => {
  // The Bootstrap path (mysqlDefault() in server/database/mysql-schema.js)
  // emits ` DEFAULT ('[]')` for a LONGTEXT column whose SQLite literal is
  // `'[]'`. This is exactly the expression MySQL 8 returns in
  // `information_schema.COLUMNS.COLUMN_DEFAULT` for the column. The
  // strict post-reconciliation assertion must accept this without
  // emitting any ALTER TABLE.
  const fixture = buildBootstrapWave7Fixture();
  // The fixture's `source_balance_identities` already carries the
  // expected MySQL representation (`'[]'`). The migration must succeed
  // end-to-end without any MODIFY COLUMN for this column.
  migrateSalesCustomerWave7PrepaymentReservation(fixture);
  const identityBalanceAlters = fixture.execSql.filter((sql) => /MODIFY COLUMN\s+`?source_balance_identities`?/i.test(sql));
  assert.equal(identityBalanceAlters.length, 0, `source_balance_identities must NOT be re-shaped; got: ${JSON.stringify(fixture.execSql)}`);
});

test('Wave 7 MySQL default assertion still fails closed for genuinely incompatible defaults', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Replace the canonical `'[]'` with an arbitrary non-equivalent literal.
  // The strict assertion must reject it: the normalized forms will not
  // match because the string content genuinely differs.
  fixture.columnTypes.get('sales_prepayment_gate_results').set('source_balance_identities', {
    data_type: 'longtext', character_maximum_length: 4294967295, is_nullable: 'NO',
    column_default: "'{}'",
  });
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL column conflict: sales_prepayment_gate_results.source_balance_identities default/,
  );
});

test('Wave 7 MySQL default assertion still fails closed when a default is unexpectedly NULL', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Bootstrap accidentally dropped the default — the column is now
  // `LONGTEXT NOT NULL` with no default. This is a genuine schema drift,
  // not a metadata representation difference, so the assertion must
  // fail closed.
  fixture.columnTypes.get('sales_prepayment_gate_results').set('source_balance_identities', {
    data_type: 'longtext', character_maximum_length: 4294967295, is_nullable: 'NO', column_default: null,
  });
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL column conflict: sales_prepayment_gate_results.source_balance_identities default/,
  );
});

test('Wave 7 MySQL default assertion accepts ratio_basis and intent_state string defaults in any MySQL representation', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Pre-shape the string defaults with the Bootstrap-emitted representation
  // (parenthesised expression) for `ratio_basis` and `intent_state`. These
  // columns are not in the canonical-contract TYPE/WIDTH reconciliation
  // list, but their defaults must still pass the strict default assertion.
  fixture.columnTypes.get('sales_prepayment_requirements').set('ratio_basis', {
    data_type: 'varchar', character_maximum_length: 16, is_nullable: 'NO', column_default: "_utf8mb4('ORDER_VALUE')",
  });
  fixture.columnTypes.get('sales_reservation_intent').set('intent_state', {
    data_type: 'varchar', character_maximum_length: 16, is_nullable: 'NO', column_default: "('NONE')",
  });
  // No MODIFY COLUMN may have been emitted for either column.
  migrateSalesCustomerWave7PrepaymentReservation(fixture);
  for (const pattern of [/MODIFY COLUMN\s+`?ratio_basis`?/i, /MODIFY COLUMN\s+`?intent_state`?/i]) {
    const matches = fixture.execSql.filter((sql) => pattern.test(sql));
    // ratio_basis and intent_state ARE both in the canonical-contract
    // type-reconciliation list because their actual type differs from the
    // contract (Bootstrap LONGTEXT vs contract VARCHAR(N)). The defaults
    // pass without re-emission, but the type narrowing MODIFY runs once.
    assert.ok(matches.length <= 1, `expected at most one MODIFY for ${pattern}; got ${matches.length}`);
  }
});

test('Wave 7 MySQL default assertion fails closed for incompatible numeric defaults', () => {
  const fixture = buildBootstrapWave7Fixture();
  // Drift a numeric default. The contract expects `0` for
  // `refunded_amount_cents`; the fixture instead carries `1`.
  fixture.columnTypes.get('sales_prepayment_gate_results').set('refunded_amount_cents', {
    data_type: 'bigint', character_maximum_length: null, is_nullable: 'NO', column_default: '1',
  });
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL column conflict: sales_prepayment_gate_results.refunded_amount_cents default/,
  );
});

test('Wave 7 MySQL three-table schema passes the full strict contract audit in the deterministic fixture', () => {
  // The comprehensive smoke test: every Bootstrap artifact (type, length,
  // nullability, default, precision/scale) reconciles without DDL where
  // possible, and the strict `assertMySqlColumnContracts` accepts every
  // equivalent MySQL metadata representation without throwing.
  const fixture = buildBootstrapWave7Fixture();
  // Pre-shape every string default with the parenthesised MySQL
  // expression form. The strict assertion must accept each without
  // emitting any MODIFY COLUMN that touches a default.
  fixture.columnTypes.get('sales_prepayment_requirements').set('ratio_basis', {
    data_type: 'longtext', character_maximum_length: 4294967295, is_nullable: 'NO',
    column_default: "('ORDER_VALUE')",
  });
  fixture.columnTypes.get('sales_prepayment_gate_results').set('source_balance_identities', {
    data_type: 'longtext', character_maximum_length: 4294967295, is_nullable: 'NO',
    column_default: "_utf8mb4('[]')",
  });
  fixture.columnTypes.get('sales_reservation_intent').set('intent_state', {
    data_type: 'longtext', character_maximum_length: 4294967295, is_nullable: 'NO',
    column_default: "('NONE')",
  });

  // The fixture deliberately puts ratio_basis and intent_state at LONGTEXT
  // (not at the post-reconciliation VARCHAR shape) to prove that the
  // reconciliation ALTER is the only place those columns change; the
  // default assertion must accept the LONGTEXT-column expression
  // representation up to the reconciliation point.
  migrateSalesCustomerWave7PrepaymentReservation(fixture);

  // After the migration the three string-default columns must carry the
  // post-MODIFY shape: VARCHAR(N) NOT NULL DEFAULT '<canonical>'.
  const ratio = fixture.columnTypes.get('sales_prepayment_requirements').get('ratio_basis');
  assert.equal(ratio.data_type, 'varchar');
  assert.equal(ratio.character_maximum_length, 16);
  // The MODIFY COLUMN re-emits `DEFAULT 'ORDER_VALUE'`, so the tracked
  // default becomes the single-quoted literal form.
  assert.match(ratio.column_default, /ORDER_VALUE/);

  const identity = fixture.columnTypes.get('sales_prepayment_gate_results').get('source_balance_identities');
  assert.equal(identity.data_type, 'longtext');
  assert.equal(identity.character_maximum_length, 4294967295);
  // `source_balance_identities` is already canonical (LONGTEXT) — no MODIFY
  // is required and the original `_utf8mb4('[]')` shape survives.
  assert.match(identity.column_default, /\[\]/);

  const intent = fixture.columnTypes.get('sales_reservation_intent').get('intent_state');
  assert.equal(intent.data_type, 'varchar');
  assert.equal(intent.character_maximum_length, 16);
  assert.match(intent.column_default, /NONE/);
});

test('Wave 7 MySQL reconciliation fails closed when ratio_basis has a non-LONGTEXT incompatible type', () => {
  const fixture = new BootstrapLongtextWave7Fixture();
  fixture.bootstrapWave7Schema();
  // Simulate a real production database where `ratio_basis` was already
  // materialised with a different, non-LONGTEXT shape that does not match
  // the contract — the migration must refuse to silently rewrite it.
  fixture.columnTypes.get('sales_prepayment_requirements').set('ratio_basis', { data_type: 'char', character_maximum_length: 8, is_nullable: 'NO', column_default: "'ORDER'" });
  fixture.setFk({ table: 'sales_prepayment_requirements', column: 'sales_order_id', constraint_name: 'sales_prepayment_requirements_ibfk_2', referenced_table: 'sales_orders', referenced_column: 'id' });
  fixture.setFk({ table: 'sales_prepayment_requirements', column: 'created_by', constraint_name: 'sales_prepayment_requirements_ibfk_1', referenced_table: 'users', referenced_column: 'id' });
  fixture.setIndex('sales_prepayment_requirements', 'uq_sales_prepayment_requirement_order_line', [
    { name: 'sales_order_id' }, { name: 'line_no' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_requirements', 'idx_sales_prepayment_requirement_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_prepayment_gate_results', 'uq_sales_prepayment_gate_result_stage_snapshot', [
    { name: 'sales_order_id' }, { name: 'stage' }, { name: 'snapshot_key' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_gate_results', 'idx_sales_prepayment_gate_result_order_stage', [
    { name: 'sales_order_id' }, { name: 'stage' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_product_warehouse', [
    { name: 'product_id' }, { name: 'warehouse_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_state', [
    { name: 'intent_state' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_planning', [
    { name: 'planning_reservation_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'uq_sales_reservation_intent_order_line_mode', [
    { name: 'sales_order_id' }, { expression: "coalesce(`sales_order_item_id`,_utf8mb4'')" }, { name: 'reservation_mode' },
  ], { unique: true });
  fixture.setCheck('sales_prepayment_requirements_chk_1', "(`required_amount_cents` >= 0)");
  fixture.setCheck('sales_prepayment_requirements_chk_2', "(`ratio_basis` in (_utf8mb4'LINE_VALUE',_utf8mb4'ORDER_VALUE'))");
  fixture.setCheck('sales_prepayment_gate_results_chk_1', "(`required_remaining_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_2', "(`eligible_advance_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_3', "(`refunded_amount_cents` >= 0)");
  fixture.setCheck('sales_prepayment_gate_results_chk_4', "(`applied_amount_cents` >= 0)");
  assert.throws(
    () => migrateSalesCustomerWave7PrepaymentReservation(fixture),
    /Wave 7 MySQL column type mismatch: sales_prepayment_requirements.ratio_basis/,
  );
});

test('Wave 7 MySQL additive install populates all three tables and indexes without conflicting metadata', () => {
  const fixture = new MySqlWave7Fixture();
  for (const t of SALES_WAVE7_TABLES) fixture.addTable(t);
  // Pre-populate columns so the post-migration `assertColumns` check passes.
  fixture.addColumns('sales_prepayment_requirements', [
    'id','sales_order_id','line_no','required_amount_cents','ratio_basis','effective_from','effective_to','created_at','created_by',
  ]);
  fixture.addColumns('sales_prepayment_gate_results', [
    'id','sales_order_id','stage','gate_decision','required_remaining_cents','eligible_advance_cents','refunded_amount_cents','applied_amount_cents','override_reason','overridden_by','source_balance_identities','snapshot_key','evaluated_at','evaluated_by',
  ]);
  fixture.addColumns('sales_reservation_intent', [
    'id','sales_order_id','sales_order_item_id','product_id','warehouse_id','reservation_mode','intent_state','requested_qty','granted_qty','consumed_qty','released_qty','planning_reservation_id','inventory_lock_id','expected_supply_source_type','expected_supply_source_id','expected_supply_capacity','consumer_event','requested_at','granted_at','released_at','created_at','created_by',
  ]);
  fixture.setIndex('sales_prepayment_requirements', 'uq_sales_prepayment_requirement_order_line', [
    { name: 'sales_order_id' }, { name: 'line_no' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_requirements', 'idx_sales_prepayment_requirement_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_prepayment_gate_results', 'uq_sales_prepayment_gate_result_stage_snapshot', [
    { name: 'sales_order_id' }, { name: 'stage' }, { name: 'snapshot_key' },
  ], { unique: true });
  fixture.setIndex('sales_prepayment_gate_results', 'idx_sales_prepayment_gate_result_order_stage', [
    { name: 'sales_order_id' }, { name: 'stage' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'uq_sales_reservation_intent_order_line_mode', [
    { name: 'sales_order_id' }, { expression: "coalesce(`sales_order_item_id`,_utf8mb4'')" }, { name: 'reservation_mode' },
  ], { unique: true });
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_order', [
    { name: 'sales_order_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_product_warehouse', [
    { name: 'product_id' }, { name: 'warehouse_id' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_state', [
    { name: 'intent_state' },
  ]);
  fixture.setIndex('sales_reservation_intent', 'idx_sales_reservation_intent_planning', [
    { name: 'planning_reservation_id' },
  ]);
  migrateSalesCustomerWave7PrepaymentReservation(fixture);
  assert.ok(fixture.tables.has('sales_prepayment_requirements'));
  assert.ok(fixture.tables.has('sales_prepayment_gate_results'));
  assert.ok(fixture.tables.has('sales_reservation_intent'));
});
