// Wave 10 — cross-dialect MySQL parity helpers.
//
// solution.md §37.39.8.2 (normalized cross-dialect metadata), §36.2.7 / §36.2.8
// (the two Wave 10 tables), document.md §34.3.21..§34.3.23.
//
// EVIDENCE LEVEL. Every assertion in this file is pure. It parses the
// canonical migration DDL and exercises the normalization and comparison
// helpers. It opens no database connection, reaches no MySQL server and
// produces no business result.
//
// It is NOT the real-MySQL metadata evidence. M-MIG-01..M-MIG-08 remain the
// only evidence for the live cross-dialect parity and stay blocked for the
// protected MySQL campaign; a green result in this file never closes them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { mysqlTypeFamily } from './database/mysql-schema.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import {
  SALES_WAVE10_TABLES, WAVE10_MYSQL_COLUMN_TYPES,
} from './migrations/sales-customer-wave10-credit-check.js';
import {
  assertIndexParity, extractCheckClauses, isBackendGeneratedIndexName, normalizeCheckClause,
} from './test-utils/wave10-mysql-schema-fixture.js';

const repoRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const WAVE9_SOURCE = read('server/migrations/sales-customer-wave9-credit-foundation.js');
const WAVE10_SOURCE = read('server/migrations/sales-customer-wave10-credit-check.js');

// The approved CHECK cardinality of every Wave 9/10 table. It is the count
// the migrations themselves assert on both engines.
const APPROVED_CHECK_COUNTS = Object.freeze({
  credit_lock_anchors: 2,
  credit_parameters: 2,
  credit_check_rules: 5,
  credit_profile: 3,
  credit_policy_snapshots: 1,
  credit_profile_ratings: 3,
  credit_check_results: 3,
  credit_special_approval: 4,
});

// The paren-balanced body of one `CREATE TABLE` statement.
function tableBlock(ddl, table) {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = ddl.indexOf(marker);
  if (start < 0) return null;
  const open = ddl.indexOf('(', start);
  let depth = 0;
  let quote = '';
  for (let index = open; index < ddl.length; index += 1) {
    const char = ddl[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === "'") { quote = char; continue; }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return ddl.slice(start, index + 1);
    }
  }
  return null;
}

function sqliteDdlBlock(source, table) {
  const ddl = /const SQLITE_DDL = `([\s\S]*?)`;/.exec(source);
  assert.ok(ddl, 'the canonical SQLite DDL must be declared');
  return tableBlock(ddl[1], table);
}

function mysqlDdlBlock(source, table) {
  const live = source.slice(source.indexOf('function mysql(db)'));
  return tableBlock(live, table);
}

// The column definitions of a live MySQL `CREATE TABLE`, in declaration order.
function mysqlDdlColumns(block) {
  const body = block.slice(block.indexOf('(') + 1, block.lastIndexOf(')'));
  const columns = new Map();
  let depth = 0;
  let quote = '';
  let current = '';
  const parts = [];
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'") { quote = char; current += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  for (const part of parts) {
    const match = /^\s*`?([A-Za-z0-9_]+)`?\s+([A-Z]+(?:\(\d+\))?)/i.exec(part);
    if (!match) continue;
    if (/^(CONSTRAINT|CHECK|PRIMARY|FOREIGN|UNIQUE|KEY)$/i.test(match[1])) continue;
    columns.set(match[1].toLowerCase(), match[2].toUpperCase());
  }
  return columns;
}

test('the canonical SQLite CHECK set and the live MySQL CHECK set normalize to one form', () => {
  const sources = { ...Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, WAVE9_SOURCE])), ...Object.fromEntries(SALES_WAVE10_TABLES.map((table) => [table, WAVE10_SOURCE])) };
  for (const table of [...SALES_WAVE9_TABLES, ...SALES_WAVE10_TABLES]) {
    const source = sources[table];
    const sqliteBlock = sqliteDdlBlock(source, table);
    const mysqlBlock = mysqlDdlBlock(source, table);
    assert.ok(sqliteBlock, `${table}: the canonical SQLite DDL must declare the table`);
    assert.ok(mysqlBlock, `${table}: the canonical live MySQL DDL must declare the table`);
    const sqliteChecks = extractCheckClauses(sqliteBlock);
    const mysqlChecks = extractCheckClauses(mysqlBlock);
    assert.equal(sqliteChecks.length, APPROVED_CHECK_COUNTS[table], `${table}: the SQLite CHECK cardinality`);
    assert.deepEqual(mysqlChecks, sqliteChecks, `${table}: the SQLite and MySQL CHECK sets must normalize to one form`);
  }
});

test('the CHECK normalizer maps an equivalent MySQL rendering to the SQLite form', () => {
  const equivalents = [
    ["decision IN ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED')",
      "(decision in ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED'))"],
    ['sales_order_id IS NOT NULL OR sales_delivery_id IS NOT NULL',
      '((sales_order_id is not null) or (sales_delivery_id is not null))'],
    ["scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')",
      "(scope_type in ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT'))"],
    ['effective_to IS NULL OR effective_to>=effective_from',
      '((effective_to is null) or (effective_to >= effective_from))'],
    ["(anchor_type='CREDIT_OBJECT' AND customer_id IS NOT NULL) OR (anchor_type='POLICY_SCOPE' AND customer_id IS NULL)",
      "(((anchor_type = 'CREDIT_OBJECT') and (customer_id is not null)) or ((anchor_type = 'POLICY_SCOPE') and (customer_id is null)))"],
  ];
  for (const [sqlite, mysql] of equivalents) {
    assert.equal(normalizeCheckClause(mysql), normalizeCheckClause(sqlite), `${mysql} must normalize like ${sqlite}`);
  }
});

test('the CHECK normalizer keeps a genuinely different constraint apart', () => {
  const different = [
    ['a = 1', 'a <> 1'],
    ['a = 1', 'a = 2'],
    ['a = 1', 'b = 1'],
    ["decision IN ('PASS')", "decision IN ('PASS','BLOCK')"],
    ['a IS NULL OR b IS NULL', 'a IS NULL AND b IS NULL'],
    ['a > 1', 'a >= 1'],
    ['NOT (a = 1)', 'a = 1'],
  ];
  for (const [left, right] of different) {
    assert.notEqual(normalizeCheckClause(left), normalizeCheckClause(right), `${left} and ${right} are different constraints`);
  }
});

test('the Wave 10 physical column contract equals the canonical live MySQL DDL', () => {
  for (const table of SALES_WAVE10_TABLES) {
    const columns = mysqlDdlColumns(mysqlDdlBlock(WAVE10_SOURCE, table));
    const contract = WAVE10_MYSQL_COLUMN_TYPES[table];
    assert.deepEqual([...columns.keys()].sort(), [...Object.keys(contract)].sort(),
      `${table}: the live MySQL DDL and the physical column contract must declare the same columns`);
    for (const [column, type] of Object.entries(contract)) {
      assert.equal(columns.get(column), type, `${table}.${column}: the live MySQL DDL type`);
    }
  }
});

test('the canonical generator produces the approved Wave 10 physical families', () => {
  for (const table of SALES_WAVE10_TABLES) {
    for (const [column, type] of Object.entries(WAVE10_MYSQL_COLUMN_TYPES[table])) {
      const family = mysqlTypeFamily({ name: column, type: 'TEXT', notnull: 1, pk: 0 }, false, table);
      assert.equal(family, type.split('(')[0].toLowerCase(), `${table}.${column}: the generator physical family`);
    }
  }
});

test('a backend-generated index name is not part of the cross-backend contract', () => {
  assert.equal(isBackendGeneratedIndexName('check_group_id', ['check_group_id', 'scope_type']), true);
  assert.equal(isBackendGeneratedIndexName('check_group_id_2', ['check_group_id', 'scope_type']), true);
  assert.equal(isBackendGeneratedIndexName('source_credit_check_result_id', ['source_credit_check_result_id']), true);
  assert.equal(isBackendGeneratedIndexName('uq_credit_check_results_group_scope', ['check_group_id', 'scope_type']), false);
  assert.equal(isBackendGeneratedIndexName('ix_credit_check_results_group', ['check_group_id']), false);
});

test('the index parity accepts a backend-generated name for the same constraint', () => {
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
  const actual = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'check_group_id', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
  assert.doesNotThrow(() => assertIndexParity(expected, actual, 'index parity'));
});

test('the index parity rejects a missing index, a changed order, a changed uniqueness and a renamed explicit index', () => {
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  const missing = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
  assert.throws(() => assertIndexParity(expected, missing, 'index parity'), /index shape parity/);

  const reordered = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['scope_type', 'check_group_id'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, reordered, 'index parity'), /index shape parity/);

  const notUnique = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: false, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, notUnique, 'index parity'), /index shape parity/);

  const renamed = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_date_stage', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, renamed, 'index parity'), /must keep its name/);
});

test('a foreign key supporting index is derived from the compared foreign-key set', () => {
  const expected = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [{ name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
  // The MySQL server materializes a supporting index for the foreign key
  // unless another index already covers it. That choice is InnoDB's, and the
  // foreign-key set itself is compared separately.
  const actual = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'credit_profile_id', unique: false, columns: ['credit_profile_id'] },
    ],
  };
  assert.doesNotThrow(() => assertIndexParity(expected, actual, 'index parity'));
});
