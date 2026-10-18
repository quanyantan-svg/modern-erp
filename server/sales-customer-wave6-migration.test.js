import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db.js';
import {
  migrateSalesCustomerWave6Returns,
  SALES_WAVE6_TABLES,
} from './migrations/sales-customer-wave6-returns.js';

function preWave6Sqlite({ conflictingColumn = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE warehouses (id TEXT PRIMARY KEY);
    CREATE TABLE products (id TEXT PRIMARY KEY);
    CREATE TABLE sales_orders (id TEXT PRIMARY KEY);
    CREATE TABLE sales_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity REAL NOT NULL);
    CREATE TABLE sales_deliveries (id TEXT PRIMARY KEY);
    CREATE TABLE sales_delivery_items (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL);
    CREATE TABLE return_orders (id TEXT PRIMARY KEY, return_no TEXT NOT NULL, creator_id TEXT NOT NULL);
    CREATE TABLE return_order_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      delivery_item_id TEXT${conflictingColumn ? ', sales_order_item_id TEXT' : ''}
    );
    INSERT INTO users(id) VALUES('legacy-user');
    INSERT INTO return_orders(id,return_no,creator_id) VALUES('legacy-return','LEGACY-1','legacy-user');
    INSERT INTO return_order_items(id,return_id,product_id,quantity) VALUES('legacy-item','legacy-return','legacy-product',1);
  `);
  return db;
}

test('Wave 6 SQLite upgrade and replay preserve legacy rows and install the real SO-line FK', () => {
  const db = preWave6Sqlite();
  try {
    migrateSalesCustomerWave6Returns(db);
    migrateSalesCustomerWave6Returns(db);
    const placeholders = SALES_WAVE6_TABLES.map(() => '?').join(',');
    assert.deepEqual(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders}) ORDER BY name`).all(...SALES_WAVE6_TABLES).map((row) => row.name),
      [...SALES_WAVE6_TABLES].sort(),
    );
    const legacyReturn = db.prepare('SELECT id,commercial_source_marker FROM return_orders WHERE id=?').get('legacy-return');
    assert.equal(legacyReturn.id, 'legacy-return');
    assert.equal(legacyReturn.commercial_source_marker, null);
    const legacyItem = db.prepare('SELECT id,sales_order_item_id FROM return_order_items WHERE id=?').get('legacy-item');
    assert.equal(legacyItem.id, 'legacy-item');
    assert.equal(legacyItem.sales_order_item_id, null);
    const fk = db.prepare('PRAGMA foreign_key_list(return_order_items)').all().find((row) => row.from === 'sales_order_item_id');
    assert.equal(fk?.table, 'sales_order_items');
    assert.equal(fk?.to, 'id');
    assert.throws(
      () => db.prepare('UPDATE return_order_items SET sales_order_item_id=? WHERE id=?').run('missing-line', 'legacy-item'),
      /FOREIGN KEY constraint failed/,
    );
  } finally {
    db.close();
  }
});

test('Wave 6 SQLite migration fails closed when a same-name source column lacks FK metadata', () => {
  const db = preWave6Sqlite({ conflictingColumn: true });
  try {
    assert.throws(() => migrateSalesCustomerWave6Returns(db), /SQLite FK incomplete/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM return_orders').get().count, 1);
  } finally {
    db.close();
  }
});

test('Wave 6 MySQL additive upgrade installs the §30.31.5 LOT frontier composite index when inventory_valuation_movements exists', () => {
  const db = new MySqlWave6Fixture();
  // Pre-existing inventory_valuation_movements table from the canonical schema.
  // The migration's conditional CREATE INDEX path probes for this table.
  db.tables.add('inventory_valuation_movements');
  migrateSalesCustomerWave6Returns(db);
  migrateSalesCustomerWave6Returns(db);
  const idx = db.indexes.get('inventory_valuation_movements');
  assert.ok(idx && idx.has('idx_valuation_movements_identity_status_created'),
    `composite index missing; have ${JSON.stringify([...(idx || [])])}`);
  const rows = idx.get('idx_valuation_movements_identity_status_created');
  assert.deepEqual(rows.map((row) => [row.column_name, row.sub_part]), [
    ['product_id', null], ['warehouse_id', null], ['lot_id', null], ['serial_id', null],
    ['status', 16], ['created_at', 64], ['id', null],
  ]);
  assert.equal(db.execSql.filter((sql) => sql.includes('idx_valuation_movements_identity_status_created')).length, 1,
    'replay must not create a duplicate LOT frontier index');
});

test('Wave 6 SQLite migration installs the §30.31.5 LOT frontier composite index when inventory_valuation_movements exists', () => {
  const db = preWave6Sqlite();
  try {
    // §30.31.5 / §30.31.7 required composite index for next-key locking on the LOT frontier.
    // Minimal valuation_movements table so the migration's conditional CREATE INDEX path runs.
    db.exec(`CREATE TABLE inventory_valuation_movements (
      id TEXT PRIMARY KEY, business_date TEXT, product_id TEXT, warehouse_id TEXT,
      lot_id TEXT, serial_id TEXT, quantity_delta REAL, value_delta_cents INTEGER,
      valuation_basis TEXT, movement_type TEXT, source_type TEXT, source_id TEXT,
      source_item_id TEXT, inventory_transaction_id TEXT, reversal_of_id TEXT,
      status TEXT, created_at TEXT NOT NULL, unit_cost_cents INTEGER, production_order_id TEXT
    )`);
    migrateSalesCustomerWave6Returns(db);
    // Replay must be a no-op.
    migrateSalesCustomerWave6Returns(db);
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='inventory_valuation_movements'`).all().map((row) => row.name);
    assert.ok(indexes.includes('idx_valuation_movements_identity_status_created'), `composite index missing; have ${JSON.stringify(indexes)}`);
  } finally {
    db.close();
  }
});

test('Wave 6 SQLite migration skips the composite index when inventory_valuation_movements is not yet bootstrapped', () => {
  const db = preWave6Sqlite();
  try {
    // §30.31.5 — when a minimal-F5 fixture only bootstraps reversal tables, the
    // conditional index creation path must skip silently and not error.
    migrateSalesCustomerWave6Returns(db);
    // No inventory_valuation_movements table → no error.
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_valuation_movements'`).all();
    assert.equal(tables.length, 0);
  } finally {
    db.close();
  }
});

test('Wave 6 fresh full SQLite bootstrap and replay preserve live reversal foreign keys', () => {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave6-migration-'));
  const path = join(temp, 'fresh.db');
  let db;
  try {
    db = createDatabase(path);
    migrateSalesCustomerWave6Returns(db);
    const itemFk = db.prepare('PRAGMA foreign_key_list(return_reversal_items)').all()
      .find((row) => row.from === 'reversal_id');
    const componentFk = db.prepare('PRAGMA foreign_key_list(credit_reversal_components)').all()
      .find((row) => row.from === 'return_reversal_id');
    assert.equal(itemFk?.table, 'return_reversals');
    assert.equal(componentFk?.table, 'return_reversals');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='return_reversals'").get().sql, /CHECK\(amount_cents >= 0\)/);
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='return_reversal_items'").get().sql, /CHECK\(amount_cents >= 0\)/);
  } finally {
    db?.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

class MySqlWave6Fixture {
  constructor({ conflictFk = false } = {}) {
    this.dialect = 'mysql';
    this.execSql = [];
    this.columns = new Map([
      ['return_orders', new Set()],
      ['return_order_items', new Set()],
      ['sales_order_replacements', new Set()],
      ['return_reversals', new Set()],
      ['return_reversal_items', new Set()],
      ['inventory_valuation_movements', new Set()],
    ]);
    this.tables = new Set();
    this.indexes = new Map();
    this.fk = conflictFk ? { constraint_name: 'unexpected', referenced_table: 'products', referenced_column: 'id' } : null;
    this.checks = new Map();
    // Pre-existing legacy CHECK constraints from v13-phase6a migration
    this.checks.set('return_reversals_chk_amount', { CONSTRAINT_NAME: 'return_reversals_chk_amount', CHECK_CLAUSE: 'amount_cents>0' });
    this.checks.set('return_reversal_items_chk_amount', { CONSTRAINT_NAME: 'return_reversal_items_chk_amount', CHECK_CLAUSE: 'amount_cents>0' });
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      all: (...params) => {
        if (normalized.includes('information_schema.STATISTICS')) {
          const [tableName, indexName] = params;
          const tableIndexes = this.indexes.get(tableName);
          if (!tableIndexes) return [];
          if (indexName) return (tableIndexes.get(indexName) || []).map((row) => ({ ...row }));
          return [...tableIndexes.values()].flat().map((row) => ({ ...row }));
        }
        if (normalized.includes('information_schema.COLUMNS')) {
          return [...(this.columns.get(params[0]) || [])].map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.KEY_COLUMN_USAGE')) {
          return this.fk && params && params[0] === 'return_order_items' && params[1] === 'sales_order_item_id' ? [{ ...this.fk }] : [];
        }
        if (normalized.includes('information_schema.TABLES')) {
          // For specific table name query (provenance existence check), filter by exact match
          if (params && params.length === 1 && typeof params[0] === 'string') {
            return [...this.tables].filter((name) => name === params[0]).map((name) => ({ name }));
          }
          // Bootstrap check binds all four Wave-6 table names. Return exactly those
          // to keep the comparison stable even when the fixture has pre-existing
          // canonical tables like inventory_valuation_movements.
          if (params && params.length >= 4) {
            return [...SALES_WAVE6_TABLES].map((name) => ({ name }));
          }
          return [...this.tables].sort().map((name) => ({ name }));
        }
        if (normalized.includes('information_schema.CHECK_CONSTRAINTS')) {
          // Filter by table + name OR by LIKE
          if (params && params.length >= 2) {
            const target = this.checks.get(params[1]);
            return target ? [target] : [];
          }
          // LIKE fallback — return all checks matching amount_cents for the given table
          const table = params && params[0];
          const all = [...this.checks.values()];
          return table ? all.filter((row) => row.CHECK_CLAUSE.includes('amount_cents')) : all;
        }
        throw new Error(`Unhandled all(): ${normalized}`);
      },
      get: (...params) => {
        if (normalized.includes('information_schema.TABLES')) {
          // Provenance existence check
          const target = (params && params[0]) || normalized.match(/TABLE_NAME='([^']+)'/i)?.[1];
          if (target && this.tables.has(target)) return { name: target };
          return null;
        }
        if (normalized.includes('information_schema.CHECK_CONSTRAINTS')) {
          const nameParam = params && params[1];
          return nameParam ? this.checks.get(nameParam) || null : null;
        }
        throw new Error(`Unhandled get(): ${normalized} ${params.join(',')}`);
      },
    };
  }

  exec(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.execSql.push(normalized);
    const table = normalized.match(/^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/i)?.[1];
    if (table) {
      this.tables.add(table);
      if (table === 'sales_order_replacements') {
        this.columns.get('sales_order_replacements').add('cancellation_state');
        this.checks.set('chk_sales_order_replacements_cancellation_state', {
          CONSTRAINT_NAME: 'chk_sales_order_replacements_cancellation_state',
          CHECK_CLAUSE: "cancellation_state IN ('ACTIVE','CANCELLED')",
        });
      }
      return;
    }
    if (/ALTER TABLE return_orders ADD COLUMN commercial_source_marker/i.test(normalized)) {
      this.columns.get('return_orders').add('commercial_source_marker'); return;
    }
    if (/ALTER TABLE return_order_items ADD COLUMN sales_order_item_id/i.test(normalized)) {
      this.columns.get('return_order_items').add('sales_order_item_id'); return;
    }
    if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(normalized)) {
      // §30.31.2 supporting indexes for the bounded provenance carrier.
      const m = normalized.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\S+)\s+ON\s+(\S+)\s*\((.+)\)$/i);
      if (m) {
        const indexName = m[2].replace(/[`'"]/g, '');
        const tableName = m[3].replace(/[`'"]/g, '');
        const columns = m[4].split(',').map((part, offset) => {
          const match = part.trim().match(/^`?([a-zA-Z0-9_]+)`?(?:\((\d+)\))?$/);
          if (!match) throw new Error(`Unparsed fixture index column: ${part}`);
          return {
            name: indexName,
            non_unique: m[1] ? 0 : 1,
            column_name: match[1],
            seq_in_index: offset + 1,
            sub_part: match[2] ? Number(match[2]) : null,
          };
        });
        if (!this.indexes.has(tableName)) this.indexes.set(tableName, new Map());
        this.indexes.get(tableName).set(indexName, columns);
      }
      return;
    }
    if (/DROP CONSTRAINT\s+(\w+)/i.test(normalized)) {
      const name = normalized.match(/DROP CONSTRAINT\s+(\w+)/i)[1];
      this.checks.delete(name);
      return;
    }
    if (/ADD CONSTRAINT\s+(\w+)\s+CHECK\s+\((.+)\)\s*$/i.test(normalized)) {
      const m = normalized.match(/ADD CONSTRAINT\s+(\w+)\s+CHECK\s+\((.+)\)\s*$/i);
      this.checks.set(m[1], { CONSTRAINT_NAME: m[1], CHECK_CLAUSE: m[2] });
      return;
    }
    if (normalized.includes('ADD CONSTRAINT fk_return_order_items_sales_order_item')) {
      this.fk = { constraint_name: 'fk_return_order_items_sales_order_item', referenced_table: 'sales_order_items', referenced_column: 'id' };
      return;
    }
    throw new Error(`Unhandled exec(): ${normalized}`);
  }
}

test('Wave 6 MySQL additive upgrade creates dialect-correct objects, FK and CHECK, then replays cleanly', () => {
  const db = new MySqlWave6Fixture();
  migrateSalesCustomerWave6Returns(db);
  db.checks.get('chk_return_orders_commercial_source_marker').CHECK_CLAUSE =
    "commercial_source_marker IS NULL OR commercial_source_marker IN (_utf8mb4\\'DELIVERY_BACKED\\',_utf8mb4\\'SO_BACKED\\',_utf8mb4\\'NO_SOURCE\\')";
  db.checks.get('chk_sales_order_replacements_cancellation_state').CHECK_CLAUSE =
    "cancellation_state IN (_utf8mb4\\'ACTIVE\\',_utf8mb4\\'CANCELLED\\')";
  migrateSalesCustomerWave6Returns(db);
  assert.deepEqual([...db.tables].sort(), [...SALES_WAVE6_TABLES].sort());
  assert.equal(db.columns.get('return_orders').has('commercial_source_marker'), true);
  assert.equal(db.columns.get('return_order_items').has('sales_order_item_id'), true);
  assert.equal(db.fk.referenced_table, 'sales_order_items');
  assert.equal(db.execSql.filter((sql) => sql.includes('ADD COLUMN commercial_source_marker')).length, 1);
  assert.equal(db.execSql.filter((sql) => sql.includes('ADD COLUMN sales_order_item_id')).length, 1);
  assert.equal(db.execSql.filter((sql) => sql.includes('ADD CONSTRAINT fk_return_order_items_sales_order_item')).length, 1);
});

test('Wave 6 MySQL migration rejects conflicting source-line FK metadata without replacing it', () => {
  const db = new MySqlWave6Fixture({ conflictFk: true });
  assert.throws(() => migrateSalesCustomerWave6Returns(db), /MySQL FK conflict/);
  assert.equal(db.fk.referenced_table, 'products');
});

test('Wave 6 MySQL migration fails closed on conflicting LOT frontier index metadata', () => {
  const db = new MySqlWave6Fixture();
  db.tables.add('inventory_valuation_movements');
  db.indexes.set('inventory_valuation_movements', new Map([[
    'idx_valuation_movements_identity_status_created',
    [{
      name: 'idx_valuation_movements_identity_status_created',
      non_unique: 1,
      column_name: 'product_id',
      seq_in_index: 1,
      sub_part: 64,
    }],
  ]]));
  assert.throws(() => migrateSalesCustomerWave6Returns(db), /MySQL index conflict/);
  assert.equal(db.execSql.some((sql) => sql.startsWith('DROP INDEX')), false);
});
