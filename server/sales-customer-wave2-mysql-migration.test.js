import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  migrateSalesCustomerWave2Pricing,
  SALES_WAVE2_TABLES,
} from './migrations/sales-customer-wave2-pricing.js';

const CONTRACTS = Object.freeze({
  sales_price_lists: {
    primaryKey: ['id'], unique: [['price_list_code']], checkCount: 3,
    foreignKeys: [['activated_by','users','id'],['created_by','users','id'],['fallback_price_list_id','sales_price_lists','id'],['retired_by','users','id'],['updated_by','users','id']],
  },
  sales_price_list_entries: {
    primaryKey: ['id'], unique: [['price_list_id','material_identity_key','customer_scope_key','pricing_identity_key']], checkCount: 8,
    foreignKeys: [['created_by','users','id'],['customer_id','customers','id'],['material_id','products','id'],['price_list_id','sales_price_lists','id'],['pricing_uom_code','uoms','code']],
  },
  sales_price_list_versions: {
    primaryKey: ['id'], unique: [['entry_id','version']], checkCount: 2,
    foreignKeys: [['created_by','users','id'],['entry_id','sales_price_list_entries','id']],
  },
  sales_discount_schemes: {
    primaryKey: ['id'], unique: [['scheme_code']], checkCount: 4,
    foreignKeys: [['activated_by','users','id'],['created_by','users','id'],['fallback_scheme_id','sales_discount_schemes','id'],['retired_by','users','id'],['updated_by','users','id']],
  },
  sales_discount_scheme_rules: {
    primaryKey: ['id'], unique: [['scheme_id','rule_key','rule_version']], checkCount: 11,
    foreignKeys: [['created_by','users','id'],['customer_id','customers','id'],['material_id','products','id'],['pricing_uom_code','uoms','code'],['scheme_id','sales_discount_schemes','id']],
  },
});

const DEFAULTS = Object.freeze({
  default_pricing_list_id: ['fk_customer_commercial_default_price_list', 'sales_price_lists'],
  default_discount_scheme_id: ['fk_customer_commercial_default_discount_scheme', 'sales_discount_schemes'],
});

class MySqlMigrationFixture {
  constructor({ missingTable, missingColumn, badDefaultFk, badPrimaryKey } = {}) {
    this.dialect = 'mysql';
    this.execSql = [];
    this.tables = new Set(SALES_WAVE2_TABLES);
    if (missingTable) this.tables.delete(missingTable);
    this.columns = new Set(Object.keys(DEFAULTS));
    if (missingColumn) this.columns.delete(missingColumn);
    this.defaultFks = new Map(Object.entries(DEFAULTS).map(([column, [name, target]], index) => [
      column,
      { constraint_name: `${badDefaultFk === column ? 'bad' : 'customer_commercial_extensions_ibfk'}_${index + 8}`, target_table: badDefaultFk === column ? 'users' : target, target_column: 'id' },
    ]));
    this.badPrimaryKey = badPrimaryKey;
    this.triggers = new Map();
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      all: (...params) => this.#all(normalized, params),
      get: (...params) => this.#get(normalized, params),
    };
  }

  #all(sql, params) {
    if (sql.includes('information_schema.COLUMNS') && sql.includes('SELECT COLUMN_NAME column_name')) {
      return [...this.columns].map((column_name) => ({ column_name }));
    }
    if (sql.includes('information_schema.TABLES')) {
      return [...this.tables].sort().map((table_name) => ({ table_name }));
    }
    if (sql.includes("CONSTRAINT_NAME='PRIMARY'")) {
      const table = params[0];
      const columns = this.badPrimaryKey === table ? ['wrong_id'] : CONTRACTS[table].primaryKey;
      return columns.map((column_name) => ({ column_name }));
    }
    if (sql.includes("TABLE_NAME='customer_commercial_extensions'") && sql.includes('REFERENCED_TABLE_NAME IS NOT NULL')) {
      const row = this.defaultFks.get(params[0]);
      return row ? [{ ...row }] : [];
    }
    if (sql.includes('information_schema.KEY_COLUMN_USAGE') && sql.includes('REFERENCED_TABLE_NAME IS NOT NULL')) {
      return CONTRACTS[params[0]].foreignKeys.map(([column_name, target_table, target_column]) => ({ column_name, target_table, target_column }));
    }
    if (sql.includes('information_schema.STATISTICS')) {
      return CONTRACTS[params[0]].unique.flatMap((columns, group) => columns.map((column_name, index) => ({
        index_name: `unique_${group}`, column_name, sequence_no: index + 1,
      })));
    }
    if (sql.includes('information_schema.TRIGGERS')) {
      const trigger = this.triggers.get(params[0]);
      return trigger ? [{ ...trigger }] : [];
    }
    throw new Error(`Unhandled fixture all(): ${sql}`);
  }

  #get(sql, params) {
    if (sql.includes('SELECT IS_NULLABLE is_nullable')) {
      return this.columns.has(params[0]) ? { is_nullable: 'YES' } : undefined;
    }
    if (sql.includes("CONSTRAINT_TYPE='CHECK'")) return { count: CONTRACTS[params[0]].checkCount };
    if (sql.startsWith('SELECT 1 FROM information_schema.TRIGGERS')) {
      return this.triggers.has(params[0]) ? { 1: 1 } : undefined;
    }
    throw new Error(`Unhandled fixture get(): ${sql}`);
  }

  exec(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.execSql.push(normalized);
    if (/^CREATE TABLE/i.test(normalized) || /ADD COLUMN/i.test(normalized)) {
      throw new Error(`MySQL live registry executed forbidden SQLite DDL: ${normalized}`);
    }
    const drop = normalized.match(/DROP FOREIGN KEY `([^`]+)`/i);
    if (drop) {
      for (const [column, metadata] of this.defaultFks) {
        if (metadata.constraint_name === drop[1]) this.defaultFks.delete(column);
      }
      return;
    }
    const add = normalized.match(/ADD CONSTRAINT (\w+) FOREIGN KEY \((\w+)\) REFERENCES (\w+)\(id\)/i);
    if (add) {
      this.defaultFks.set(add[2], { constraint_name: add[1], target_table: add[3], target_column: 'id' });
      return;
    }
    const trigger = normalized.match(/^CREATE TRIGGER (\w+) BEFORE (INSERT|UPDATE) ON sales_price_list_entries/i);
    if (trigger) {
      this.triggers.set(trigger[1], {
        action_timing: 'BEFORE', event_manipulation: trigger[2], event_object_table: 'sales_price_list_entries', action_statement: normalized,
      });
      return;
    }
    throw new Error(`Unhandled fixture exec(): ${normalized}`);
  }
}

test('MySQL live registry verifies bootstrap metadata, canonicalises equivalent FK names, and replays without SQLite table DDL', () => {
  const db = new MySqlMigrationFixture();
  migrateSalesCustomerWave2Pricing(db);
  migrateSalesCustomerWave2Pricing(db);

  assert.deepEqual([...db.defaultFks.entries()].map(([column, row]) => [column, row.constraint_name]).sort(), [
    ['default_discount_scheme_id', 'fk_customer_commercial_default_discount_scheme'],
    ['default_pricing_list_id', 'fk_customer_commercial_default_price_list'],
  ]);
  assert.equal(db.triggers.size, 2);
  assert.equal(db.execSql.filter((sql) => /^CREATE TRIGGER/i.test(sql)).length, 2);
  assert.equal(db.execSql.some((sql) => /^CREATE TABLE/i.test(sql) || /ADD COLUMN/i.test(sql)), false);
});

test('MySQL live registry fails closed before mutation when a bootstrap table is missing', () => {
  const db = new MySqlMigrationFixture({ missingTable: 'sales_price_lists' });
  assert.throws(() => migrateSalesCustomerWave2Pricing(db), /bootstrap incomplete/);
  assert.deepEqual(db.execSql, []);
});

test('MySQL customer defaults never use SQLite ADD COLUMN and missing bootstrap columns fail closed', () => {
  const db = new MySqlMigrationFixture({ missingColumn: 'default_pricing_list_id' });
  assert.throws(() => migrateSalesCustomerWave2Pricing(db), /missing customer default column/);
  assert.equal(db.execSql.some((sql) => /ADD COLUMN/i.test(sql)), false);
});

test('unexpected MySQL FK or key metadata fails closed', () => {
  const badFk = new MySqlMigrationFixture({ badDefaultFk: 'default_pricing_list_id' });
  assert.throws(() => migrateSalesCustomerWave2Pricing(badFk), /customer default FK metadata mismatch/);
  const badPk = new MySqlMigrationFixture({ badPrimaryKey: 'sales_price_lists' });
  assert.throws(() => migrateSalesCustomerWave2Pricing(badPk), /primary-key metadata mismatch/);
});

test('protected MySQL gates retain executable fresh, upgrade, and concurrency evidence', () => {
  const freshGate = readFileSync(new URL('../scripts/gates/mysql-gate.mjs', import.meta.url), 'utf8');
  const concurrencyGate = readFileSync(new URL('../scripts/gates/mysql-concurrency-gate.mjs', import.meta.url), 'utf8');
  assert.match(freshGate, /server\/mysql-sales-customer-wave0\.integration\.js/);
  assert.match(concurrencyGate, /server\/mysql-sales-customer-wave1-upgrade\.integration\.js/);
  assert.match(concurrencyGate, /server\/mysql-sales-customer-wave2-concurrency\.integration\.js/);
});
