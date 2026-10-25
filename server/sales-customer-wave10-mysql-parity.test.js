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
import {
  assertObservedExposure, parseCreditExposureCents, selectCreditExposureRow,
  W10_EXPOSURE_BREAKDOWN_CONTRACT,
} from './test-utils/wave10-credit-result.js';

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

// ---------------------------------------------------------------------------
// REVIEW-P1-01 — the persisted exposure breakdown and the assertion read path
//
// `credit_check_results` has no `exposure_cents` column. The production
// writer stores the observed exposure inside `component_breakdown_json`, so
// the assertion must read that document of one exact check group.
// ---------------------------------------------------------------------------

test('the persisted exposure breakdown yields the observed exposure', () => {
  const breakdown = JSON.stringify({
    contractVersion: W10_EXPOSURE_BREAKDOWN_CONTRACT,
    exposureCents: 100000,
    availableCents: 900000,
    proposedTotalCents: 100000,
    overLimitCents: 0,
    creditLimitCents: 1000000,
    components: { approvedSoCommitmentCents: 100000, deliveredNotSettledCents: 0, arOpenCents: 0, eligiblePrepaymentCents: 0 },
    exposureDigest: 'digest',
    consumedSpecialApprovalId: null,
  });
  assert.equal(parseCreditExposureCents(breakdown), 100000);
});

test('the persisted exposure breakdown rejects a missing field, a wrong contract and a wrong amount', () => {
  assert.throws(
    () => parseCreditExposureCents(JSON.stringify({ contractVersion: W10_EXPOSURE_BREAKDOWN_CONTRACT })),
    /WAVE10_CREDIT_EXPOSURE_CENTS_INVALID/,
  );
  assert.throws(
    () => parseCreditExposureCents(JSON.stringify({ contractVersion: 'SOMETHING_ELSE', exposureCents: 1 })),
    /WAVE10_CREDIT_EXPOSURE_BREAKDOWN_CONTRACT/,
  );
  assert.throws(
    () => parseCreditExposureCents(JSON.stringify({ contractVersion: W10_EXPOSURE_BREAKDOWN_CONTRACT, exposureCents: 1.5 })),
    /WAVE10_CREDIT_EXPOSURE_CENTS_INVALID/,
  );
  assert.throws(
    () => parseCreditExposureCents(JSON.stringify({ contractVersion: W10_EXPOSURE_BREAKDOWN_CONTRACT, exposureCents: '100' })),
    /WAVE10_CREDIT_EXPOSURE_CENTS_INVALID/,
  );
  assert.throws(() => parseCreditExposureCents('not json'), /WAVE10_CREDIT_EXPOSURE_BREAKDOWN_UNREADABLE/);
  assert.throws(() => parseCreditExposureCents(null), /WAVE10_CREDIT_EXPOSURE_BREAKDOWN_UNREADABLE/);
});

test('the exposure row is correlated by check group and scope, never by recency', () => {
  const rows = [
    { check_group_id: 'group-a', scope_type: 'CUSTOMER_AGGREGATE', component_breakdown_json: '{}' },
    { check_group_id: 'group-a', scope_type: 'SALESPERSON_SUB_LIMIT', component_breakdown_json: '{}' },
    { check_group_id: 'group-b', scope_type: 'CUSTOMER_AGGREGATE', component_breakdown_json: '{}' },
  ];
  assert.equal(selectCreditExposureRow(rows, 'group-a', 'CUSTOMER_AGGREGATE').check_group_id, 'group-a');
  // A different check group is not the row of this decision.
  assert.throws(() => selectCreditExposureRow(rows, 'group-c', 'CUSTOMER_AGGREGATE'), /WAVE10_CREDIT_EXPOSURE_ROW_MISSING/);
  // A different scope is not the row of this scope.
  assert.throws(() => selectCreditExposureRow(rows, 'group-a', 'OTHER_SCOPE'), /WAVE10_CREDIT_EXPOSURE_ROW_MISSING/);
  // A duplicated scope row is ambiguous and is never silently resolved.
  assert.throws(
    () => selectCreditExposureRow([...rows, rows[0]], 'group-a', 'CUSTOMER_AGGREGATE'),
    /WAVE10_CREDIT_EXPOSURE_ROW_AMBIGUOUS/,
  );
});

test('the observed exposure must be exactly the OLD or the NEW canonical exposure', () => {
  assert.equal(assertObservedExposure(100000, [100000, 200000]), 100000);
  assert.equal(assertObservedExposure(200000, [100000, 200000]), 200000);
  assert.throws(() => assertObservedExposure(150000, [100000, 200000]), /exactly the OLD or the NEW canonical exposure/);
  assert.throws(() => assertObservedExposure(0, [100000, 200000]), /exactly the OLD or the NEW canonical exposure/);
  assert.throws(() => assertObservedExposure(1.5, [100000, 200000]), /legal cents amount/);
});

// ---------------------------------------------------------------------------
// REVIEW-P1-02 — the index contract
// ---------------------------------------------------------------------------

test('a UNIQUE index is never filtered out by the foreign-key support rule', () => {
  // A UNIQUE index on a foreign-key column carries business semantics: it is
  // a uniqueness constraint, not a redundant support index. It must stay in
  // the comparison even though its name equals its first column.
  const expected = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [{ name: 'credit_profile_id', unique: true, columns: ['credit_profile_id'] }],
  };
  const actual = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [],
  };
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'), /index shape parity/);
});

test('a declared index renamed to its first column name must fail', () => {
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] }],
  };
  const actual = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'stage', unique: false, columns: ['stage', 'business_date'] }],
  };
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'), /must keep its name/);
});

test('a declared UNIQUE index renamed to its first column name must fail', () => {
  // A UNIQUE index that is not one of the two approved Wave 10 table-level
  // constraints keeps its name contract, even when the new name happens to
  // equal the first column.
  const expected = {
    name: 'credit_check_rules', foreignKeys: [],
    indexes: [{ name: 'uq_credit_check_rules_version', unique: true, columns: ['rule_code', 'effective_from'] }],
  };
  const actual = {
    name: 'credit_check_rules', foreignKeys: [],
    indexes: [{ name: 'rule_code', unique: true, columns: ['rule_code', 'effective_from'] }],
  };
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'), /must keep its name/);
});

test('the approved Wave 10 table-level UNIQUE may carry a backend-generated name', () => {
  const expected = {
    name: 'credit_special_approval', foreignKeys: [],
    indexes: [{ name: 'uq_credit_special_approval_source', unique: true, columns: ['source_credit_check_result_id'] }],
  };
  const actual = {
    name: 'credit_special_approval', foreignKeys: [],
    indexes: [{ name: 'source_credit_check_result_id', unique: true, columns: ['source_credit_check_result_id'] }],
  };
  assert.doesNotThrow(() => assertIndexParity(expected, actual, 'index parity'));
});

test('an extra index that is not allowed must fail', () => {
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
  const actual = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_extra', unique: false, columns: ['evaluated_at'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'), /index shape parity/);
});

test('a duplicated index must fail', () => {
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'ix_credit_check_results_group', unique: false, columns: ['check_group_id'] }],
  };
  const actual = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'ix_credit_check_results_group', unique: false, columns: ['check_group_id'] },
      { name: 'ix_credit_check_results_group_2', unique: false, columns: ['check_group_id'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'), /index shape parity/);
});

test('a non-unique foreign-key support index may differ between the backends', () => {
  const expected = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [{ name: 'ix_credit_check_results_group', unique: false, columns: ['check_group_id'] }],
  };
  const actual = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [
      { name: 'ix_credit_check_results_group', unique: false, columns: ['check_group_id'] },
      { name: 'credit_profile_id', unique: false, columns: ['credit_profile_id'] },
    ],
  };
  assert.doesNotThrow(() => assertIndexParity(expected, actual, 'index parity'));
});

// ---------------------------------------------------------------------------
// REVIEW-FOLLOWUP-01 — the approved UNIQUE constraint name exception
//
// The exception is bounded to the two canonical Wave 10 table-level UNIQUE
// constraints, and each side may present only one of their two legitimate
// cross-dialect representations: the canonical migration-declared name or a
// backend-generated name. An arbitrary alias is neither.
// ---------------------------------------------------------------------------

const APPROVED_UNIQUE = Object.freeze({
  table: 'credit_check_results',
  name: 'uq_credit_check_results_group_scope',
  columns: Object.freeze(['check_group_id', 'scope_type']),
});

function uniqueTable(name, indexName) {
  return {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: indexName, unique: true, columns: [...APPROVED_UNIQUE.columns] }],
  };
}

test('REVIEW-FOLLOWUP-01 — the canonical approved UNIQUE name passes on both sides', () => {
  const expected = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  const actual = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  assert.doesNotThrow(() => assertIndexParity(expected, actual, 'index parity'));
});

test('REVIEW-FOLLOWUP-01 — the approved backend-generated UNIQUE name passes in either direction', () => {
  const canonical = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  const generated = uniqueTable('credit_check_results', 'check_group_id');
  // The backend-generated name may sit on the actual side ...
  assert.doesNotThrow(() => assertIndexParity(canonical, generated, 'index parity'));
  // ... or on the expected side, which is the fresh-versus-upgrade direction
  // of assertEquivalentCreditMetadata.
  assert.doesNotThrow(() => assertIndexParity(generated, canonical, 'index parity'));
});

test('REVIEW-FOLLOWUP-01 — an arbitrary renamed approved UNIQUE on the actual side fails', () => {
  const expected = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  const actual = uniqueTable('credit_check_results', 'unapproved_random_name');
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'),
    /must keep its canonical name or a backend-generated name \(actual: unapproved_random_name\)/);
});

test('REVIEW-FOLLOWUP-01 — an arbitrary renamed approved UNIQUE on the expected side fails', () => {
  const expected = uniqueTable('credit_check_results', 'unapproved_random_name');
  const actual = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  assert.throws(() => assertIndexParity(expected, actual, 'index parity'),
    /must keep its canonical name or a backend-generated name \(expected: unapproved_random_name\)/);
});

test('REVIEW-FOLLOWUP-01 — an arbitrary alias is rejected even when the columns and uniqueness match', () => {
  // The identity of the constraint is the approved name, not the table, the
  // uniqueness flag and the ordered column set alone.
  const expected = uniqueTable('credit_check_results', 'uq_credit_check_results_group_scope');
  for (const alias of ['unapproved_random_name', 'UQ_CREDIT_CHECK_RESULTS_GROUP_SCOPE_2', 'credit_check_results_group_scope', 'scope_type']) {
    const actual = uniqueTable('credit_check_results', alias);
    assert.throws(() => assertIndexParity(expected, actual, 'index parity'),
      /must keep its canonical name or a backend-generated name/,
      `the alias ${alias} must be rejected`);
  }
  // The backend's own collision suffix is a legitimate generated name and is
  // therefore accepted.
  const collided = uniqueTable('credit_check_results', 'check_group_id_2');
  assert.doesNotThrow(() => assertIndexParity(expected, collided, 'index parity'));
});

test('REVIEW-FOLLOWUP-01 — the foreign-key supporting-index exception is unchanged', () => {
  const expected = {
    name: 'credit_check_results',
    foreignKeys: [{ column: 'credit_profile_id', parentTable: 'credit_profile', parentColumn: 'id' }],
    indexes: [{ name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] }],
  };
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

test('REVIEW-FOLLOWUP-01 — missing, extra, duplicated, reordered and de-uniqued indexes still fail', () => {
  const base = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  const withoutUnique = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] }],
  };
  assert.throws(() => assertIndexParity(base, withoutUnique, 'index parity'), /index shape parity/);

  const reordered = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['scope_type', 'check_group_id'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(base, reordered, 'index parity'), /index shape parity/);

  const deUniqued = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: false, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(base, deUniqued, 'index parity'), /index shape parity/);

  const extra = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      ...base.indexes,
      { name: 'ix_credit_check_results_extra', unique: false, columns: ['evaluated_at'] },
    ],
  };
  assert.throws(() => assertIndexParity(base, extra, 'index parity'), /index shape parity/);

  const duplicated = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      ...base.indexes,
      { name: 'ix_credit_check_results_stage_date_2', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(base, duplicated, 'index parity'), /index shape parity/);
});

test('REVIEW-FOLLOWUP-01 — an explicitly named non-exempt UNIQUE keeps exact name equality', () => {
  const expected = {
    name: 'credit_check_rules', foreignKeys: [],
    indexes: [{ name: 'uq_credit_check_rules_version', unique: true, columns: ['rule_code', 'effective_from'] }],
  };
  for (const alias of ['rule_code', 'unapproved_random_name', 'effective_from']) {
    const actual = {
      name: 'credit_check_rules', foreignKeys: [],
      indexes: [{ name: alias, unique: true, columns: ['rule_code', 'effective_from'] }],
    };
    assert.throws(() => assertIndexParity(expected, actual, 'index parity'),
      /must keep its name/,
      `the alias ${alias} must be rejected`);
  }
});
