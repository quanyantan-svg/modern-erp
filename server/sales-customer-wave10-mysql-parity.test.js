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
//
// §37.50 adds the `PT01`..`PT10` block at the end of this file: the offline
// reproduction of the two live parity failures and the negative regressions
// that keep a missing, a repeated or a changed CHECK constraint, and a genuine
// physical type divergence, detectable. It is equally not live evidence.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { mysqlTypeFamily, planMySqlAdditiveReconciliation, planMySqlIndexReconciliation } from './database/mysql-schema.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import {
  SALES_WAVE10_TABLES, UNIQUE_CONSTRAINTS, WAVE10_MYSQL_COLUMN_TYPES,
} from './migrations/sales-customer-wave10-credit-check.js';
import {
  assertCheckParity, assertIndexParity, CHECK_LITERAL_DIALECT, describeCheckClauseNormalization,
  extractCheckClauses, isBackendGeneratedIndexName, normalizeCheckClause, normalizedSqliteTable,
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

// ---------------------------------------------------------------------------
// §37.48 — the CHECK clause literal dialect.
//
// The protected Wave 10 Acceptance campaign failed `M-MIG-01` and `M-MIG-02`
// because the MySQL catalogue renders a string literal with its delimiters
// backslash-escaped, and the tokenizer refused every backslash. The four
// renderings below are the bytes that campaign captured, byte-for-byte, and
// the expected forms are the SQLite canonical forms the same campaign
// reported as expected.
//
// Capture provenance: server 8.0.37, server UUID
// 5d3c6a68-b8a5-11f1-8ce6-b025aa71d167, campaign of 2026-10-26, run
// `pnpm.cmd test:mysql:wave10` against
// `modern_erp_wave10_disposable_test`. The captured bytes are the catalogue
// rendering after the deterministic pre-normalization (backtick removal,
// charset-introducer removal, whitespace collapse and lowercasing), which is
// a fixed point of that pre-normalization, so they are exactly what the
// fixture reads again from the live catalogue. The live raw bytes are
// re-emitted by `server/mysql-sales-customer-wave10.integration.js` on its
// next protected run.
const CAPTURED_CHECK_RENDERINGS = Object.freeze([
  Object.freeze({
    table: 'credit_check_results',
    source: "decision IN ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED')",
    captured: "(decision in (\\'pass\\',\\'warning\\',\\'block\\',\\'special_approval_required\\'))",
    canonical: "decision in ('pass', 'warning', 'block', 'special_approval_required')",
  }),
  Object.freeze({
    table: 'credit_check_results',
    source: "scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')",
    captured: "(scope_type in (\\'customer_aggregate\\',\\'salesperson_sub_limit\\'))",
    canonical: "scope_type in ('customer_aggregate', 'salesperson_sub_limit')",
  }),
  Object.freeze({
    table: 'credit_lock_anchors',
    source: "anchor_type IN ('CREDIT_OBJECT','POLICY_SCOPE')",
    captured: "(anchor_type in (\\'credit_object\\',\\'policy_scope\\'))",
    canonical: "anchor_type in ('credit_object', 'policy_scope')",
  }),
  Object.freeze({
    table: 'credit_lock_anchors',
    source: "(anchor_type='CREDIT_OBJECT' AND customer_id IS NOT NULL AND credit_object_type IS NOT NULL"
      + " AND credit_object_id IS NOT NULL AND policy_scope_type IS NULL AND policy_scope_id IS NULL)"
      + " OR (anchor_type='POLICY_SCOPE' AND policy_scope_type IS NOT NULL AND policy_scope_id IS NOT NULL"
      + " AND customer_id IS NULL AND salesperson_id IS NULL AND credit_object_type IS NULL"
      + " AND credit_object_id IS NULL)",
    captured: "(((anchor_type = \\'credit_object\\') and (customer_id is not null) and (credit_object_type is not null)"
      + " and (credit_object_id is not null) and (policy_scope_type is null) and (policy_scope_id is null))"
      + " or ((anchor_type = \\'policy_scope\\') and (policy_scope_type is not null) and (policy_scope_id is not null)"
      + " and (customer_id is null) and (salesperson_id is null) and (credit_object_type is null)"
      + " and (credit_object_id is null)))",
    canonical: "(anchor_type = 'credit_object' and customer_id is not null and credit_object_type is not null"
      + " and credit_object_id is not null and policy_scope_type is null and policy_scope_id is null)"
      + " or (anchor_type = 'policy_scope' and policy_scope_type is not null and policy_scope_id is not null"
      + " and customer_id is null and salesperson_id is null and credit_object_type is null"
      + " and credit_object_id is null)",
  }),
]);

const ALL_CHECK_TABLES = Object.freeze([...SALES_WAVE9_TABLES, ...SALES_WAVE10_TABLES]);

test('T01 — a plain SQLite CHECK and its equivalent MySQL rendering normalize to one form', () => {
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
  for (const [source, rendering] of equivalents) {
    const expected = normalizeCheckClause(source, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.notEqual(expected.startsWith('raw: '), true, `${source} must parse`);
    assert.equal(normalizeCheckClause(rendering, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }), expected,
      `${rendering} must normalize like ${source}`);
  }
});

test('T02 — the captured MySQL escaped-literal rendering equals the SQLite canonical form', () => {
  for (const item of CAPTURED_CHECK_RENDERINGS) {
    const described = describeCheckClauseNormalization(item.captured, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG });
    assert.equal(described.form, 'canonical', `${item.table}: the captured rendering must parse: ${described.reason}`);
    assert.equal(described.reason, null, `${item.table}: a parsed clause keeps no failure reason`);
    assert.equal(described.canonical, item.canonical, `${item.table}: the captured rendering must normalize to the SQLite form`);
    const source = describeCheckClauseNormalization(item.source, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.equal(source.form, 'canonical', `${item.table}: the SQLite source must parse: ${source.reason}`);
    assert.equal(source.canonical, item.canonical, `${item.table}: the SQLite source must normalize to the expected form`);
    // The same captured bytes are NOT a SQLite source text: the dialect is
    // never auto-detected from the bytes.
    const crossed = describeCheckClauseNormalization(item.captured, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.equal(crossed.form, 'raw', `${item.table}: a catalogue rendering must not parse as a SQLite source`);
  }
});

test('T03 — a different IN member set or a different string value never compares equal', () => {
  const different = [
    ["decision IN ('PASS')", "decision IN ('PASS','BLOCK')"],
    ["scope_type IN ('CUSTOMER_AGGREGATE')", "scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')"],
    ["anchor_type IN ('CREDIT_OBJECT')", "anchor_type IN ('CREDIT_OBJECT','POLICY_SCOPE')"],
    ["a = 'x'", "a = 'y'"],
    ["a = 'x'", "a = 'xy'"],
  ];
  for (const [left, right] of different) {
    assert.notEqual(
      normalizeCheckClause(left, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      normalizeCheckClause(right, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      `${left} and ${right} are different constraints`,
    );
  }
  // A literal that differs only by case is the SAME value under the target
  // collation. Every Wave 9/10 column of the eight compared tables uses the
  // case-insensitive `utf8mb4_0900_ai_ci` collation, so this is an audited
  // property of the contract and not a conflation. It is pinned here on
  // purpose so it can never drift silently.
  assert.equal(
    normalizeCheckClause("a = 'PASS'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    normalizeCheckClause("a = 'pass'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    'a literal that differs only by case is the same value under the target collation',
  );
  const catalogueDifferent = [
    ["a = \\'x\\'", "a = \\'y\\'"],
    ["a in (\\'x\\')", "a in (\\'x\\',\\'y\\')"],
    ["a = \\'x\\'", "a = \\'xy\\'"],
  ];
  for (const [left, right] of catalogueDifferent) {
    assert.notEqual(
      normalizeCheckClause(left, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }),
      normalizeCheckClause(right, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }),
      `${left} and ${right} are different constraints`,
    );
  }
});

test('T04 — operator, AND/OR/NOT and NULL predicate differences are preserved', () => {
  const different = [
    ['a = 1', 'a <> 1'],
    ['a = 1', 'a >= 1'],
    ['a > 1', 'a >= 1'],
    ['a IS NULL OR b IS NULL', 'a IS NULL AND b IS NULL'],
    ['NOT (a = 1)', 'a = 1'],
    ['a IS NULL', 'a IS NOT NULL'],
    ['a = 1 AND b = 2', 'a = 1 OR b = 2'],
  ];
  for (const [left, right] of different) {
    assert.notEqual(
      normalizeCheckClause(left, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      normalizeCheckClause(right, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      `${left} and ${right} are different constraints`,
    );
  }
  // The operator and the predicate structure survive normalization unchanged.
  assert.equal(normalizeCheckClause('a >= 1'), "a >= '1'");
  assert.equal(normalizeCheckClause('a IS NOT NULL'), 'a is not null');
  assert.equal(normalizeCheckClause('a IS NULL'), 'a is null');
  assert.equal(normalizeCheckClause('not (a = 1)'), "not a = '1'");
  assert.equal(normalizeCheckClause('a = 1 and b = 2'), "a = '1' and b = '2'");
  assert.equal(normalizeCheckClause('a = 1 or b = 2'), "a = '1' or b = '2'");
  // A catalogue rendering keeps the same structure.
  assert.equal(
    normalizeCheckClause("a >= 1 and b in (\\'x\\',\\'y\\')", { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }),
    "a >= '1' and b in ('x', 'y')",
  );
});

test('T05 — quotes, doubled quotes, backslashes and abnormal quotes are never merged', () => {
  // The SQL-standard doubled quote denotes one literal quote and is not the
  // same value as the two characters.
  assert.notEqual(
    normalizeCheckClause("a = 'x''y'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    normalizeCheckClause("a = 'xy'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    'a doubled quote must not collapse into the plain characters',
  );
  assert.equal(
    normalizeCheckClause("a = 'x''y'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    "a = 'x'y'",
    'a doubled quote denotes exactly one literal quote',
  );
  // The same semantic value is equal across the two dialects.
  assert.equal(
    normalizeCheckClause("a = 'x'", { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
    normalizeCheckClause("a = \\'x\\'", { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }),
    'the same literal value is equal in both dialects',
  );
  // A lone backslash is refused in both dialects, in the content of a literal.
  for (const dialect of [CHECK_LITERAL_DIALECT.SQL_STANDARD, CHECK_LITERAL_DIALECT.MYSQL_CATALOG]) {
    const lone = describeCheckClauseNormalization(
      dialect === CHECK_LITERAL_DIALECT.SQL_STANDARD ? "a = 'x\\y'" : "a = \\'x\\y\\'",
      { dialect },
    );
    assert.equal(lone.form, 'raw', 'a backslash inside a literal must fail closed');
    assert.match(lone.reason, /escape/i, 'the refusal must name the escape');
  }
  // An abnormal quote inside a catalogue literal is refused, and a catalogue
  // rendering is never equal to a parsed form.
  const abnormal = describeCheckClauseNormalization("a = \\'x'y\\'", { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG });
  assert.equal(abnormal.form, 'raw', 'an unescaped quote inside a catalogue literal must fail closed');
  assert.match(abnormal.reason, /quote/i, 'the refusal must name the quote');
  assert.notEqual(abnormal.canonical, normalizeCheckClause('a = 1'), 'a raw form never equals a parsed form');
});

test('T06 — unsupported, unterminated and malformed input fails closed with a retained reason', () => {
  const cases = [
    ['unsupported syntax', 'a BETWEEN 1 AND 2', CHECK_LITERAL_DIALECT.SQL_STANDARD, 'raw'],
    ['unsupported token', 'a = 1 \\ 2', CHECK_LITERAL_DIALECT.SQL_STANDARD, 'raw'],
    ['unterminated literal', "a = 'x", CHECK_LITERAL_DIALECT.SQL_STANDARD, 'raw'],
    ['unterminated catalogue literal', "a = \\'x", CHECK_LITERAL_DIALECT.MYSQL_CATALOG, 'raw'],
    ['trailing tokens', 'a = 1 b', CHECK_LITERAL_DIALECT.SQL_STANDARD, 'raw'],
    ['truncated expression', 'a =', CHECK_LITERAL_DIALECT.SQL_STANDARD, 'raw'],
    ['empty clause', '', CHECK_LITERAL_DIALECT.SQL_STANDARD, 'empty'],
  ];
  for (const [label, text, dialect, expectedForm] of cases) {
    const described = describeCheckClauseNormalization(text, { dialect });
    assert.equal(described.form, expectedForm, `${label} must not parse`);
    assert.equal(typeof described.reason, 'string', `${label} must retain a reason`);
    assert.ok(described.reason.length > 0, `${label} must retain a non-empty reason`);
    if (expectedForm === 'raw') {
      assert.equal(described.canonical.startsWith('raw: '), true, `${label} must keep the distinguishable raw form`);
    } else {
      assert.equal(described.canonical, '', `${label} must keep its own empty form`);
    }
  }
  // Every refused form stays distinct from every parsed form.
  const parsed = normalizeCheckClause('a = 1', { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
  for (const [label, text, dialect] of cases) {
    const described = describeCheckClauseNormalization(text, { dialect });
    assert.notEqual(described.canonical, parsed, `${label} must not compare equal to a parsed form`);
  }
  // The diagnostic is bounded and carries no surrounding SQL.
  const described = describeCheckClauseNormalization('a = 1 \\ 2', { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
  assert.deepEqual(Object.keys(described).sort(), ['canonical', 'dialect', 'form', 'reason']);
  assert.ok(described.reason.length <= 120, 'the retained reason must stay bounded');
});

test('T07 — the approved CHECK cardinality of the eight tables is unchanged', () => {
  const sources = {
    ...Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, WAVE9_SOURCE])),
    ...Object.fromEntries(SALES_WAVE10_TABLES.map((table) => [table, WAVE10_SOURCE])),
  };
  let total = 0;
  for (const table of ALL_CHECK_TABLES) {
    const block = sqliteDdlBlock(sources[table], table);
    const checks = extractCheckClauses(block, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.equal(checks.length, APPROVED_CHECK_COUNTS[table], `${table}: the approved CHECK cardinality`);
    assert.ok(checks.length > 0, `${table}: the canonical CHECK set must not be empty`);
    for (const check of checks) {
      assert.notEqual(check.startsWith('raw: '), true, `${table}: every approved CHECK must have a canonical form`);
    }
    total += checks.length;
  }
  assert.equal(total, 23, 'the eight tables must keep exactly 23 approved CHECK constraints');
  // The two captured tables carry exactly the canonical forms the campaign
  // reported, so the fix did not change any approved constraint.
  const capturedByTable = new Map();
  for (const item of CAPTURED_CHECK_RENDERINGS) {
    if (!capturedByTable.has(item.table)) capturedByTable.set(item.table, []);
    capturedByTable.get(item.table).push(item.canonical);
  }
  for (const [table, expected] of capturedByTable) {
    const block = sqliteDdlBlock(sources[table], table);
    const checks = extractCheckClauses(block, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    for (const canonical of expected) {
      assert.ok(checks.includes(canonical), `${table}: the captured canonical form ${canonical} must still be present`);
    }
  }
});

test('T08 — the existing physical parity contracts are unchanged', () => {
  const sources = {
    ...Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, WAVE9_SOURCE])),
    ...Object.fromEntries(SALES_WAVE10_TABLES.map((table) => [table, WAVE10_SOURCE])),
  };
  for (const table of ALL_CHECK_TABLES) {
    const source = sources[table];
    const sqliteBlock = sqliteDdlBlock(source, table);
    const mysqlBlock = mysqlDdlBlock(source, table);
    assert.ok(sqliteBlock, `${table}: the canonical SQLite DDL must declare the table`);
    assert.ok(mysqlBlock, `${table}: the canonical live MySQL DDL must declare the table`);
    // The default dialect is the SQLite source dialect, and the explicit
    // dialect produces exactly the same result: nothing changed for the text
    // that already normalized.
    assert.deepEqual(
      extractCheckClauses(sqliteBlock),
      extractCheckClauses(sqliteBlock, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      `${table}: the default dialect must remain the SQLite source dialect`,
    );
    assert.deepEqual(
      extractCheckClauses(mysqlBlock),
      extractCheckClauses(mysqlBlock, { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD }),
      `${table}: the default dialect must remain the SQLite source dialect`,
    );
  }
  // The index parity contract still refuses a missing index, a changed column
  // order, a changed uniqueness and a renamed explicit index.
  const expected = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  const renamed = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [
      { name: 'uq_credit_check_results_group_scope', unique: true, columns: ['check_group_id', 'scope_type'] },
      { name: 'stage', unique: false, columns: ['stage', 'business_date'] },
    ],
  };
  assert.throws(() => assertIndexParity(expected, renamed, 'index parity'), /must keep its name/);
  // The physical column type family contract is unchanged.
  assert.equal(mysqlTypeFamily('VARCHAR(128)'), mysqlTypeFamily('VARCHAR(128)'));
});

// ---------------------------------------------------------------------------
// §37.50 — the Wave 10 Parity Oracle correction.
//
// Two confirmed defects of the acceptance oracle are corrected inside the
// acceptance test contract, and both are pinned here by an engine-neutral
// local regression.
//
// RC-1 — the CHECK comparison compared two differently ordered arrays of the
//         same set. The MySQL catalogue's order is a function of the server's
//         rendering, not of the schema. The comparison is now over the
//         normalized canonical forms as a multiset: order-insensitive, and
//         sensitive to the number of occurrences of each constraint.
//
// RC-2 — the oracle's indexed predicate was narrower than the production
//         generator's. A foreign-key source column counts as an indexed
//         column in the production rule, and the five foreign-key columns
//         whose names do not end in `_id` were therefore predicted `longtext`
//         — a type that InnoDB refuses for a foreign-key child column.
//
// The reader below is a pure source-text reader. It opens no database, reaches
// no MySQL server and produces no business result. It reconstructs the eight
// Wave 9/10 tables from the canonical migration sources in the shape that
// `captureSqliteSnapshot()` produces, so the fixture's
// `normalizedSqliteTable()` and the production generator's own exported
// reconciliation entry points both consume it unchanged.
//
// EVIDENCE LEVEL. Everything in this block is SOURCE_DERIVED. It is not live
// MySQL evidence, and it does not close `M-MIG-01` or `M-MIG-02`.
// ---------------------------------------------------------------------------

// The canonical source of every one of the eight tables.
const CANONICAL_SOURCE = Object.freeze({
  ...Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, WAVE9_SOURCE])),
  ...Object.fromEntries(SALES_WAVE10_TABLES.map((table) => [table, WAVE10_SOURCE])),
});

// The comma-separated definitions of a `CREATE TABLE` body, at depth zero.
// A quoted run is never split, so a comma inside a string literal or inside a
// parenthesized CHECK expression stays inside its definition.
function splitDefinitions(body) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// The body of a `CREATE TABLE` block, between the table's own parentheses.
function createTableBody(block) {
  return block.slice(block.indexOf('(') + 1, block.lastIndexOf(')'));
}

// One column definition of the canonical SQLite DDL.
function sqliteColumn(part) {
  const match = /^([A-Za-z0-9_]+)\s+([A-Za-z]+)([\s\S]*)$/.exec(part);
  if (!match) return null;
  const [, name, type, rest] = match;
  const declaredDefault = /\bDEFAULT\s+('(?:[^']|'')*'|NULL|CURRENT_TIMESTAMP|CURRENT_DATE|[-+]?\d+(?:\.\d+)?)/i.exec(rest);
  return {
    name,
    type: type.toUpperCase(),
    notnull: /\bNOT\s+NULL\b/i.test(rest) ? 1 : 0,
    dflt_value: declaredDefault ? declaredDefault[1] : null,
    pk: /\bPRIMARY\s+KEY\b/i.test(rest) ? 1 : 0,
  };
}

// The foreign key a canonical SQLite column declares. Every foreign key of
// the eight tables is declared without an action, so both sides carry the
// SQLite default of `NO ACTION`.
function sqliteForeignKey(part) {
  const match = /\bREFERENCES\s+([A-Za-z0-9_]+)\s*\(\s*([A-Za-z0-9_]+)\s*\)/i.exec(part);
  if (!match) return null;
  return { table: match[1], to: match[2], on_update: 'NO ACTION', on_delete: 'NO ACTION' };
}

// The declared index list of a canonical migration, read from its source.
function declaredIndexes(source) {
  const block = /const INDEXES = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(source);
  assert.ok(block, 'the canonical migration must declare its index list');
  const indexes = [];
  for (const match of block[1].matchAll(
    /\{\s*table:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*columns:\s*\[([^\]]*)\]\s*(?:,\s*unique:\s*(true|false))?\s*,?\s*\}/g,
  )) {
    indexes.push({
      table: match[1],
      name: match[2],
      columns: match[3].split(',').map((column) => column.trim().replace(/^'|'$/g, '')).filter(Boolean),
      unique: match[4] === 'true',
      origin: 'c',
    });
  }
  assert.ok(indexes.length > 0, 'the canonical migration must declare at least one index');
  return indexes;
}

// The table-level UNIQUE constraints of a canonical SQLite DDL. SQLite stores
// them on a nameless auto-index; the generator materializes them inline.
function tableLevelUniqueConstraints(block, table) {
  const constraints = [];
  for (const match of block.matchAll(/CONSTRAINT\s+([A-Za-z0-9_]+)\s+UNIQUE\s*\(([^)]*)\)/gi)) {
    constraints.push({
      table,
      name: match[1],
      columns: match[2].split(',').map((column) => column.trim().replace(/[`']/g, '')).filter(Boolean),
      unique: true,
      origin: 'u',
    });
  }
  return constraints;
}

const WAVE9_DECLARED_INDEXES = declaredIndexes(WAVE9_SOURCE);
const WAVE10_DECLARED_INDEXES = declaredIndexes(WAVE10_SOURCE);

// One reconstructed table, in the shape `captureSqliteSnapshot()` produces.
function sourceTable(name, source, indexes) {
  const block = sqliteDdlBlock(source, name);
  assert.ok(block, `${name}: the canonical SQLite DDL must declare the table`);
  const columns = [];
  const foreignKeys = [];
  for (const part of splitDefinitions(createTableBody(block))) {
    if (/^(CHECK|CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE)\b/i.test(part)) continue;
    const column = sqliteColumn(part);
    assert.ok(column, `${name}: the canonical SQLite DDL has an unreadable column definition`);
    columns.push(column);
    const foreignKey = sqliteForeignKey(part);
    if (foreignKey) foreignKeys.push({ from: column.name, ...foreignKey });
  }
  assert.ok(columns.length > 0, `${name}: the canonical SQLite DDL must declare columns`);
  return {
    name,
    sql: block,
    columns,
    foreignKeys,
    indexes: [
      ...indexes.filter((index) => index.table === name),
      ...tableLevelUniqueConstraints(block, name),
    ],
  };
}

// The eight Wave 9/10 tables, reconstructed from the canonical migration
// sources.
function sourceSnapshot() {
  const tables = [];
  for (const table of SALES_WAVE9_TABLES) tables.push(sourceTable(table, WAVE9_SOURCE, WAVE9_DECLARED_INDEXES));
  for (const table of SALES_WAVE10_TABLES) tables.push(sourceTable(table, WAVE10_SOURCE, WAVE10_DECLARED_INDEXES));
  return { tables };
}

// The production generator's own emitted DDL, through its two exported
// reconciliation entry points. Nothing here re-implements the generator: the
// tables and the declared indexes are exactly what the production code emits.
function generatedMySql(snapshot) {
  const statements = planMySqlAdditiveReconciliation(snapshot, { tables: new Set(), columns: new Map() });
  const tables = new Map();
  for (const statement of statements) {
    const match = /^CREATE TABLE IF NOT EXISTS `([A-Za-z0-9_]+)` \(/.exec(statement);
    assert.ok(match, 'the production generator must emit one CREATE TABLE per table');
    tables.set(match[1], statement);
  }
  const indexes = new Map();
  for (const statement of planMySqlIndexReconciliation(snapshot, new Map())) {
    const match = /^CREATE (UNIQUE )?INDEX `([A-Za-z0-9_]+)` ON `([A-Za-z0-9_]+)` \(([^)]*)\)$/.exec(statement);
    assert.ok(match, 'the production generator must emit one CREATE INDEX per declared index');
    const list = indexes.get(match[3]) || [];
    list.push({
      name: match[2],
      unique: Boolean(match[1]),
      columns: match[4].split(',').map((column) => column.trim().replace(/`/g, '')),
    });
    indexes.set(match[3], list);
  }
  return { tables, indexes };
}

// The column definitions of a generated `CREATE TABLE` body.
function generatedColumns(body) {
  const columns = [];
  for (const part of splitDefinitions(body)) {
    const match = /^`([A-Za-z0-9_]+)`\s+([A-Z]+(?:\(\d+\))?)([\s\S]*)$/i.exec(part);
    if (!match) continue;
    columns.push({
      name: match[1].toLowerCase(),
      type: match[2].toUpperCase(),
      family: match[2].toLowerCase().split('(')[0].trim(),
      nullable: !/\bNOT\s+NULL\b/i.test(match[3]),
      default: /\bDEFAULT\b/i.test(match[3]),
    });
  }
  return columns;
}

// The foreign keys of a generated `CREATE TABLE` body.
function generatedForeignKeys(body) {
  const foreignKeys = [];
  for (const part of splitDefinitions(body)) {
    const match = /^FOREIGN\s+KEY\s+\(`([A-Za-z0-9_]+)`\)\s+REFERENCES\s+`([A-Za-z0-9_]+)`\s+\(`([A-Za-z0-9_]+)`\)\s+ON\s+UPDATE\s+(.+?)\s+ON\s+DELETE\s+(.+)$/i.exec(part);
    if (!match) continue;
    foreignKeys.push({
      column: match[1],
      parentTable: match[2],
      parentColumn: match[3],
      onUpdate: match[4].toUpperCase(),
      onDelete: match[5].toUpperCase(),
    });
  }
  return foreignKeys;
}

// The primary key of a generated `CREATE TABLE` body.
function generatedPrimaryKey(body) {
  for (const part of splitDefinitions(body)) {
    const match = /^PRIMARY\s+KEY\s+\(([^)]*)\)$/i.exec(part);
    if (match) return match[1].split(',').map((column) => column.trim().replace(/`/g, ''));
  }
  return [];
}

// The inline UNIQUE constraints of a generated `CREATE TABLE` body.
function generatedInlineUnique(body) {
  const unique = [];
  for (const part of splitDefinitions(body)) {
    const match = /^UNIQUE\s+\(([^)]*)\)$/i.exec(part);
    if (!match) continue;
    unique.push(match[1].split(',').map((column) => column.trim().replace(/`/g, '')));
  }
  return unique;
}

// The CHECK constraints of a generated `CREATE TABLE` body.
function generatedChecks(body) {
  const checks = [];
  for (const part of splitDefinitions(body)) {
    if (!/^CHECK\s*\(/i.test(part)) continue;
    checks.push(part.replace(/^CHECK\s*\(/i, '').replace(/\)\s*$/, '').trim());
  }
  return checks;
}

const indexShape = (index) => `${index.unique ? 'unique' : 'index'}:${index.name}:${index.columns.join(',')}`;

const sameOrder = (left, right) => {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
};

// The five foreign-key columns whose names do not end in `_id`, so the `_id`
// suffix clause of the production mapper did not mask the predicate
// difference. The production generator produces `varchar` for all five.
const RC2_FOREIGN_KEY_COLUMNS = Object.freeze([
  Object.freeze(['credit_parameters', 'created_by']),
  Object.freeze(['credit_check_rules', 'created_by']),
  Object.freeze(['credit_profile', 'created_by']),
  Object.freeze(['credit_policy_snapshots', 'captured_by']),
  Object.freeze(['credit_profile_ratings', 'applied_by']),
]);

// ---------------------------------------------------------------------------
// PT01 — the captured live catalogue order.
//
// Capture provenance: the 2026-10-27 Full Acceptance campaign against
// `modern_erp_wave10_disposable_test`, server 8.0.37, server UUID
// 5d3c6a68-b8a5-11f1-8ce6-b025aa71d167, session sql_mode
// `IGNORE_SPACE,STRICT_ALL_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`,
// `backslashEscapesEnabled=true`. The bytes below are the raw catalogue
// renderings in the catalogue's own order, exactly as
// `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE` returned them.
//
// `node --test` doubles every backslash when it re-emits a subtest's stdout
// as a TAP comment, so the campaign transcript holds two backslashes where
// the live server returned one. The block below carries the live bytes: the
// campaign's own `WAVE10_CHECK_METADATA_EVIDENCE` records `form=canonical`
// for every one of these clauses, which is only possible for a single
// backslash before each quote.
// ---------------------------------------------------------------------------
const CAPTURED_CATALOGUE_CHECK_ORDER = Object.freeze({
  credit_lock_anchors: Object.freeze([
    Object.freeze("(((`anchor_type` = _utf8mb4\\'CREDIT_OBJECT\\') and (`customer_id` is not null) and (`credit_object_type` is not null) and (`credit_object_id` is not null) and (`policy_scope_type` is null) and (`policy_scope_id` is null)) or ((`anchor_type` = _utf8mb4\\'POLICY_SCOPE\\') and (`policy_scope_type` is not null) and (`policy_scope_id` is not null) and (`customer_id` is null) and (`salesperson_id` is null) and (`credit_object_type` is null) and (`credit_object_id` is null)))"),
    Object.freeze("(`anchor_type` in (_utf8mb4\\'CREDIT_OBJECT\\',_utf8mb4\\'POLICY_SCOPE\\'))"),
  ]),
  credit_parameters: Object.freeze([
    Object.freeze("((`effective_to` is null) or (`effective_to` >= `effective_from`))"),
    Object.freeze("(`status` in (_utf8mb4\\'DRAFT\\',_utf8mb4\\'ACTIVE\\',_utf8mb4\\'INACTIVE\\'))"),
  ]),
  credit_check_rules: Object.freeze([
    Object.freeze("((`effective_to` is null) or (`effective_to` >= `effective_from`))"),
    Object.freeze("(`business_stage` in (_utf8mb4\\'SO_SUBMIT\\',_utf8mb4\\'SO_APPROVE\\',_utf8mb4\\'SALES_DELIVERY_CONFIRM\\'))"),
    Object.freeze("(`check_timing` in (_utf8mb4\\'BEFORE_WRITE\\',_utf8mb4\\'AFTER_WRITE_DEFERRED\\'))"),
    Object.freeze("(`control_strength` in (_utf8mb4\\'WARNING\\',_utf8mb4\\'BLOCK\\'))"),
    Object.freeze("(`scenario` in (_utf8mb4\\'STANDARD\\',_utf8mb4\\'OVERRIDE_REQUEST\\',_utf8mb4\\'WARNING_ONLY\\',_utf8mb4\\'BLOCK\\'))"),
  ]),
  credit_profile: Object.freeze([
    Object.freeze("(((`salesperson_scope_key` = _utf8mb4\\'*\\') and (`salesperson_id` is null)) or ((`salesperson_scope_key` <> _utf8mb4\\'*\\') and (`salesperson_id` is not null) and (`salesperson_scope_key` = `salesperson_id`)))"),
    Object.freeze("((`effective_to` is null) or (`effective_to` >= `effective_from`))"),
    Object.freeze("(`status` in (_utf8mb4\\'ACTIVE\\',_utf8mb4\\'SUSPENDED\\',_utf8mb4\\'CLOSED\\'))"),
  ]),
  credit_policy_snapshots: Object.freeze([
    Object.freeze("(`scope_type` in (_utf8mb4\\'CUSTOMER_AGGREGATE\\',_utf8mb4\\'SALESPERSON_SUB_LIMIT\\'))"),
  ]),
  credit_profile_ratings: Object.freeze([
    Object.freeze("(((`rating_source_type` = _utf8mb4\\'INITIAL_ASSIGNED\\') and (`rating_source_key` = _utf8mb4\\'INITIAL_ASSIGNED\\') and (`evaluation_result_id` is null)) or ((`rating_source_type` = _utf8mb4\\'EVALUATED\\') and (`evaluation_result_id` is not null) and (`rating_source_key` = `evaluation_result_id`)))"),
    Object.freeze("((`superseded_at` is null) or (`superseded_at` >= `applied_at`))"),
    Object.freeze("(`rating_source_type` in (_utf8mb4\\'INITIAL_ASSIGNED\\',_utf8mb4\\'EVALUATED\\'))"),
  ]),
  credit_check_results: Object.freeze([
    Object.freeze("((`sales_order_id` is not null) or (`sales_delivery_id` is not null))"),
    Object.freeze("(`decision` in (_utf8mb4\\'PASS\\',_utf8mb4\\'WARNING\\',_utf8mb4\\'BLOCK\\',_utf8mb4\\'SPECIAL_APPROVAL_REQUIRED\\'))"),
    Object.freeze("(`scope_type` in (_utf8mb4\\'CUSTOMER_AGGREGATE\\',_utf8mb4\\'SALESPERSON_SUB_LIMIT\\'))"),
  ]),
  credit_special_approval: Object.freeze([
    Object.freeze("(((`decision` = _utf8mb4\\'PENDING\\') and (`decided_at` is null) and (`approver_id` is null)) or ((`decision` <> _utf8mb4\\'PENDING\\') and (`decided_at` is not null) and (`approver_id` is not null)))"),
    Object.freeze("(`decision` in (_utf8mb4\\'PENDING\\',_utf8mb4\\'APPROVED\\',_utf8mb4\\'REJECTED\\'))"),
    Object.freeze("(`scope_mode` in (_utf8mb4\\'ONE_TIME\\',_utf8mb4\\'TIME_BOUNDED\\',_utf8mb4\\'OBJECT_BOUNDED\\'))"),
    Object.freeze("(`scope_type` in (_utf8mb4\\'CUSTOMER_AGGREGATE\\',_utf8mb4\\'SALESPERSON_SUB_LIMIT\\'))"),
  ]),
});

// The catalogue order of the three tables whose order differs from the
// canonical order, in their canonical form. These are the permutations that
// broke `M-MIG-01` (the Wave 10 table) and `M-MIG-02` (the two Wave 9 tables).
const CAPTURED_DIVERGENT_ORDER = Object.freeze({
  credit_check_results: Object.freeze([
    'sales_order_id is not null or sales_delivery_id is not null',
    "decision in ('pass', 'warning', 'block', 'special_approval_required')",
    "scope_type in ('customer_aggregate', 'salesperson_sub_limit')",
  ]),
  credit_check_rules: Object.freeze([
    'effective_to is null or effective_to >= effective_from',
    "business_stage in ('so_submit', 'so_approve', 'sales_delivery_confirm')",
    "check_timing in ('before_write', 'after_write_deferred')",
    "control_strength in ('warning', 'block')",
    "scenario in ('standard', 'override_request', 'warning_only', 'block')",
  ]),
  credit_profile_ratings: Object.freeze([
    "(rating_source_type = 'initial_assigned' and rating_source_key = 'initial_assigned' and evaluation_result_id is null) or (rating_source_type = 'evaluated' and evaluation_result_id is not null and rating_source_key = evaluation_result_id)",
    'superseded_at is null or superseded_at >= applied_at',
    "rating_source_type in ('initial_assigned', 'evaluated')",
  ]),
});

test('PT01 — the captured live catalogue order is a permutation of the canonical CHECK set', () => {
  const divergent = [];
  for (const table of ALL_CHECK_TABLES) {
    const captured = CAPTURED_CATALOGUE_CHECK_ORDER[table];
    assert.ok(captured, `${table}: the captured catalogue order must be present`);
    const actual = captured.map((raw) => {
      const described = describeCheckClauseNormalization(raw, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG });
      assert.equal(described.form, 'canonical', `${table}: the captured rendering must parse: ${described.reason}`);
      assert.equal(described.reason, null, `${table}: a parsed clause keeps no failure reason`);
      return described.canonical;
    });
    const expected = extractCheckClauses(sqliteDdlBlock(CANONICAL_SOURCE[table], table),
      { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.equal(actual.length, expected.length, `${table}: the captured and the canonical CHECK count`);
    // The multiset is equal ...
    assert.deepEqual([...actual].sort(), [...expected].sort(), `${table}: the captured CHECK multiset`);
    // ... and the comparison that the oracle now uses accepts it.
    assert.doesNotThrow(() => assertCheckParity(expected, actual, table));
    if (!sameOrder(actual, expected)) {
      divergent.push(table);
      // The order-sensitive comparison is exactly what failed on the live
      // server, so it must still be able to fail.
      assert.throws(() => assert.deepEqual(actual, expected), assert.AssertionError,
        `${table}: the order-sensitive comparison must have failed`);
      assert.deepEqual(actual, CAPTURED_DIVERGENT_ORDER[table], `${table}: the captured permutation`);
    }
  }
  assert.deepEqual(divergent.sort(), ['credit_check_results', 'credit_check_rules', 'credit_profile_ratings'],
    'exactly three of the eight tables have a catalogue order that differs from the canonical order');
  // The five tables whose catalogue order coincides must never be reported as
  // divergent, and their sets are equal without any reordering.
  for (const table of ['credit_lock_anchors', 'credit_parameters', 'credit_profile', 'credit_policy_snapshots', 'credit_special_approval']) {
    assert.equal(divergent.includes(table), false, `${table}: the catalogue order coincides with the canonical order`);
  }
});

test('PT02 — a missing CHECK constraint fails the canonical comparison', () => {
  const expected = [...CAPTURED_DIVERGENT_ORDER.credit_check_results];
  const actual = [...expected].reverse();
  assert.doesNotThrow(() => assertCheckParity(expected, actual, 'PT02'));
  // The helper must not mutate the arrays it receives.
  assert.deepEqual(expected, CAPTURED_DIVERGENT_ORDER.credit_check_results, 'PT02: the expected array must be unchanged');
  assert.deepEqual(actual, [...CAPTURED_DIVERGENT_ORDER.credit_check_results].reverse(), 'PT02: the actual array must be unchanged');
  const missing = actual.slice(1);
  assert.throws(() => assertCheckParity(expected, missing, 'PT02'), /PT02: check-constraint parity/);
});

test('PT03 — a changed CHECK multiplicity fails the canonical comparison', () => {
  const expected = [...CAPTURED_DIVERGENT_ORDER.credit_check_results];
  const repeated = [...expected, expected[0]];
  assert.equal(repeated.length, expected.length + 1, 'PT03: the repeated constraint must be an extra occurrence');
  assert.throws(() => assertCheckParity(expected, repeated, 'PT03'), /PT03: check-constraint parity/);
  const dropped = expected.slice(1);
  assert.throws(() => assertCheckParity(expected, dropped, 'PT03'), /PT03: check-constraint parity/);
  // A constraint that occurs once on each side in a different order is
  // equal; the multiplicity, not the position, is what is compared.
  assert.doesNotThrow(() => assertCheckParity(expected, [...expected].reverse(), 'PT03'));
});

test('PT04 — a changed CHECK expression fails the canonical comparison', () => {
  const expected = [...CAPTURED_DIVERGENT_ORDER.credit_check_results];
  const changes = [
    ["decision in ('pass', 'warning', 'block', 'special_approval_required')",
      "decision in ('pass', 'warning', 'block')"],
    ["decision in ('pass', 'warning', 'block', 'special_approval_required')",
      "decision in ('pass', 'warning', 'block', 'special_approval_required', 'extra')"],
    ['sales_order_id is not null or sales_delivery_id is not null',
      'sales_order_id is not null and sales_delivery_id is not null'],
    ['sales_order_id is not null or sales_delivery_id is not null',
      'sales_order_id is null or sales_delivery_id is not null'],
    ["scope_type in ('customer_aggregate', 'salesperson_sub_limit')",
      "scope_type in ('customer_aggregate')"],
  ];
  for (const [from, to] of changes) {
    const changed = expected.map((clause) => (clause === from ? to : clause));
    assert.notEqual(changed.join('|'), expected.join('|'), `PT04: ${to} must be a different constraint`);
    assert.throws(() => assertCheckParity(expected, changed, 'PT04'), /PT04: check-constraint parity/);
  }
  // A `raw:` fallback form never compares equal to a parsed form.
  const unparsed = expected.map((clause) => (clause.startsWith("scope_type in") ? 'raw: scope_type between 1 and 2' : clause));
  assert.throws(() => assertCheckParity(expected, unparsed, 'PT04'), /PT04: check-constraint parity/);
});

test('PT05 — the oracle predicts the production physical type for all 117 columns', () => {
  const snapshot = sourceSnapshot();
  const generated = generatedMySql(snapshot);
  let total = 0;
  for (const table of snapshot.tables) {
    const expected = normalizedSqliteTable(table);
    const produced = generatedColumns(createTableBody(generated.tables.get(table.name)));
    assert.deepEqual(produced.map((column) => column.name), expected.columns.map((column) => column.name),
      `${table.name}: the oracle and the generator must declare the same columns in the same order`);
    for (const column of expected.columns) {
      const emitted = produced.find((item) => item.name === column.name);
      assert.ok(emitted, `${table.name}.${column.name}: the generator must emit the column`);
      assert.equal(column.type, emitted.family,
        `${table.name}.${column.name}: the oracle family must equal the generator family`);
      total += 1;
    }
  }
  assert.equal(total, 117, 'the eight tables must keep exactly 117 columns');
  // The five foreign-key columns whose names do not end in `_id`.
  for (const [table, column] of RC2_FOREIGN_KEY_COLUMNS) {
    const source = snapshot.tables.find((item) => item.name === table);
    assert.ok(source.foreignKeys.some((foreignKey) => foreignKey.from === column),
      `${table}.${column} must be a foreign-key source column`);
    assert.equal(source.indexes.some((index) => index.columns.includes(column)), false,
      `${table}.${column} must not be an indexed column on its own`);
    const expected = normalizedSqliteTable(source).columns.find((item) => item.name === column);
    assert.equal(expected.type, 'varchar', `${table}.${column}: the oracle must predict the varchar family`);
    const emitted = generatedColumns(createTableBody(generated.tables.get(table))).find((item) => item.name === column);
    assert.equal(emitted.family, 'varchar', `${table}.${column}: the generator must produce the varchar family`);
    // The production mapper itself, asked about a column that is not indexed,
    // produces `longtext`: the foreign-key contribution of the indexed
    // predicate is exactly what makes the prediction `varchar`.
    assert.equal(mysqlTypeFamily({ name: column, type: 'TEXT', notnull: 0, pk: 0 }, false, table), 'longtext',
      `${table}.${column}: the column is not indexed on its own`);
  }
});

test('PT06 — a plain, non-indexed, non-foreign-key TEXT column is still predicted longtext', () => {
  const snapshot = sourceSnapshot();
  const plain = [
    ['credit_parameters', 'value_text'],
    ['credit_check_rules', 'credit_item'],
    ['credit_profile', 'initial_state'],
    ['credit_policy_snapshots', 'scope_type'],
    ['credit_lock_anchors', 'created_at'],
    ['credit_profile_ratings', 'rating_grade'],
  ];
  for (const [table, column] of plain) {
    const source = snapshot.tables.find((item) => item.name === table);
    assert.equal(source.foreignKeys.some((foreignKey) => foreignKey.from === column), false,
      `${table}.${column} must not be a foreign-key source column`);
    assert.equal(source.indexes.some((index) => index.columns.includes(column)), false,
      `${table}.${column} must not be an indexed column`);
    const expected = normalizedSqliteTable(source).columns.find((item) => item.name === column);
    assert.equal(expected.type, 'longtext', `${table}.${column}: the oracle must still predict longtext`);
    assert.equal(mysqlTypeFamily({ name: column, type: 'TEXT', notnull: 0, pk: 0 }, false, table), 'longtext',
      `${table}.${column}: the production mapper must still produce longtext`);
  }
});

test('PT07 — the six Wave 9 tables keep their complete physical contract', () => {
  const snapshot = sourceSnapshot();
  const generated = generatedMySql(snapshot);
  let columns = 0;
  let foreignKeys = 0;
  let checks = 0;
  let declaredIndexes = 0;
  for (const table of SALES_WAVE9_TABLES) {
    const source = snapshot.tables.find((item) => item.name === table);
    const expected = normalizedSqliteTable(source);
    const body = createTableBody(generated.tables.get(table));
    const produced = generatedColumns(body);
    // Column names and order.
    assert.deepEqual(produced.map((column) => column.name), expected.columns.map((column) => column.name),
      `${table}: the column identity and order`);
    // Physical type family, nullability, default and primary-key ordinal.
    for (const column of expected.columns) {
      const emitted = produced.find((item) => item.name === column.name);
      assert.equal(column.type, emitted.family, `${table}.${column.name}: the physical type family`);
      assert.equal(column.nullable, emitted.nullable, `${table}.${column.name}: the nullability`);
      assert.equal(Boolean(column.default), emitted.default, `${table}.${column.name}: the default`);
      assert.equal(column.primaryOrdinal, column.name === 'id' ? 1 : 0, `${table}.${column.name}: the primary-key ordinal`);
      assert.equal(column.default, null, `${table}.${column.name}: the approved contract declares no default`);
    }
    // The single-column primary key of every table.
    assert.deepEqual(generatedPrimaryKey(body), ['id'], `${table}: the primary key`);
    // Foreign keys with their actions.
    const producedForeignKeys = generatedForeignKeys(body)
      .map((foreignKey) => `${foreignKey.column}->${foreignKey.parentTable}(${foreignKey.parentColumn}) ${foreignKey.onUpdate}/${foreignKey.onDelete}`)
      .sort();
    const sourceForeignKeys = source.foreignKeys
      .map((foreignKey) => `${foreignKey.from}->${foreignKey.table}(${foreignKey.to}) ${foreignKey.on_update}/${foreignKey.on_delete}`)
      .sort();
    assert.deepEqual(producedForeignKeys, sourceForeignKeys, `${table}: the foreign-key edges and their actions`);
    for (const foreignKey of expected.foreignKeys) {
      assert.equal(foreignKey.onUpdate, 'RESTRICT', `${table}.${foreignKey.column}: the normalized update action`);
      assert.equal(foreignKey.onDelete, 'RESTRICT', `${table}.${foreignKey.column}: the normalized delete action`);
    }
    // The CHECK expressions and their multiplicity.
    const producedChecks = generatedChecks(body).map((clause) => normalizeCheckClause(clause));
    assertCheckParity(expected.checks, producedChecks, table);
    assert.equal(expected.checks.length, APPROVED_CHECK_COUNTS[table], `${table}: the approved CHECK cardinality`);
    // The index identity, uniqueness and column order.
    const producedIndexes = (generated.indexes.get(table) || []).map(indexShape).sort();
    assert.deepEqual(producedIndexes, expected.indexes.map(indexShape).sort(), `${table}: the index contract`);
    // The canonical SQLite DDL and the canonical hand-written MySQL DDL are
    // two independent declarations of the same table.
    const handwritten = [...mysqlDdlColumns(mysqlDdlBlock(WAVE9_SOURCE, table)).keys()];
    assert.deepEqual(handwritten, expected.columns.map((column) => column.name),
      `${table}: the SQLite and the hand-written MySQL DDL must declare the same columns in the same order`);
    columns += expected.columns.length;
    foreignKeys += expected.foreignKeys.length;
    checks += expected.checks.length;
    declaredIndexes += expected.indexes.length;
  }
  assert.equal(columns, 76, 'the six Wave 9 tables must keep exactly 76 columns');
  assert.equal(foreignKeys, 15, 'the six Wave 9 tables must keep exactly 15 foreign-key edges');
  assert.equal(checks, 16, 'the six Wave 9 tables must keep exactly 16 CHECK constraints');
  assert.equal(declaredIndexes, 10, 'the six Wave 9 tables must keep exactly 10 declared indexes');
  const generatedIndexes = generatedMySql(snapshot).indexes;
  assert.equal(generatedIndexes.size, 8, 'the declared indexes must belong to the eight tables');
  const totalDeclared = [...generatedIndexes.values()].reduce((sum, list) => sum + list.length, 0);
  assert.equal(totalDeclared, 15, 'the eight tables must keep exactly 15 declared indexes');
  assert.equal([...generatedIndexes.keys()].every((table) => ALL_CHECK_TABLES.includes(table)), true,
    'every declared index must belong to one of the eight tables');
});

test('PT08 — the two Wave 10 tables keep their approved physical contract', () => {
  const snapshot = sourceSnapshot();
  const generated = generatedMySql(snapshot);
  let total = 0;
  for (const table of SALES_WAVE10_TABLES) {
    const contract = WAVE10_MYSQL_COLUMN_TYPES[table];
    const produced = generatedColumns(createTableBody(generated.tables.get(table)));
    assert.equal(produced.length, Object.keys(contract).length, `${table}: the approved column count`);
    for (const [column, type] of Object.entries(contract)) {
      const emitted = produced.find((item) => item.name === column);
      assert.ok(emitted, `${table}.${column}: the generator must emit the column`);
      assert.equal(emitted.type, type, `${table}.${column}: the generator physical type`);
      assert.equal(emitted.family, type.split('(')[0].toLowerCase(), `${table}.${column}: the generator physical family`);
      total += 1;
    }
    // The hand-written Wave 10 MySQL DDL still declares the same contract.
    const handwritten = mysqlDdlColumns(mysqlDdlBlock(WAVE10_SOURCE, table));
    assert.deepEqual([...handwritten.keys()].sort(), Object.keys(contract).sort(),
      `${table}: the hand-written MySQL DDL and the physical column contract must declare the same columns`);
    for (const [column, type] of Object.entries(contract)) {
      assert.equal(handwritten.get(column), type, `${table}.${column}: the hand-written MySQL type`);
    }
    // The two approved table-level UNIQUE constraints are materialized inline.
    const approvedUnique = UNIQUE_CONSTRAINTS.find((constraint) => constraint.table === table);
    assert.ok(approvedUnique, `${table}: the approved UNIQUE constraint must exist`);
    assert.deepEqual(generatedInlineUnique(createTableBody(generated.tables.get(table))),
      [[...approvedUnique.columns]],
      `${table}: the approved UNIQUE constraint`);
  }
  assert.equal(total, 41, 'the two Wave 10 tables must keep exactly 41 columns');
});

test('PT09 — the genuine generic versus hand-written type divergence is detected and is the only one', () => {
  const snapshot = sourceSnapshot();
  const generated = generatedMySql(snapshot);
  const divergences = [];
  for (const table of ALL_CHECK_TABLES) {
    const produced = generatedColumns(createTableBody(generated.tables.get(table)));
    const handwritten = mysqlDdlColumns(mysqlDdlBlock(CANONICAL_SOURCE[table], table));
    for (const column of produced) {
      const declared = String(handwritten.get(column.name) || '').toLowerCase().split('(')[0].trim();
      if (declared !== column.family) {
        divergences.push(`${table}.${column.name}: generic=${column.family} hand-written=${declared}`);
      }
    }
  }
  // The five foreign-key columns are not production DDL divergences: the
  // generic path and the hand-written path agree on all of them.
  for (const [table, column] of RC2_FOREIGN_KEY_COLUMNS) {
    assert.equal(divergences.some((entry) => entry.startsWith(`${table}.${column}:`)), false,
      `${table}.${column}: the generic and the hand-written path must agree`);
  }
  // The registered RC-3 divergence is the only one, and it is real.
  assert.deepEqual(divergences, ['credit_lock_anchors.policy_scope_id: generic=varchar hand-written=longtext'],
    'the registered divergence must be the only generic versus hand-written difference');
  // A table materialized from the hand-written DDL still fails the parity
  // comparison against the generic path.
  const source = snapshot.tables.find((item) => item.name === 'credit_lock_anchors');
  const expected = normalizedSqliteTable(source);
  const handwritten = mysqlDdlColumns(mysqlDdlBlock(WAVE9_SOURCE, 'credit_lock_anchors'));
  const handwrittenMaterialized = expected.columns.map((column) => ({
    ...column,
    type: String(handwritten.get(column.name) || '').toLowerCase().split('(')[0].trim(),
  }));
  const differing = expected.columns
    .filter((column, position) => handwrittenMaterialized[position].type !== column.type)
    .map((column) => `${column.name}: generic=${column.type} hand-written=${handwrittenMaterialized[expected.columns.indexOf(column)].type}`);
  assert.deepEqual(differing, ['policy_scope_id: generic=varchar hand-written=longtext'],
    'the hand-written materialization must differ on exactly the registered column');
  assert.throws(() => assert.deepEqual(handwrittenMaterialized, expected.columns), assert.AssertionError,
    'the hand-written materialization must not compare equal to the generic path');
});

test('PT10 — the existing parity regressions survive and the new block is not weakened', () => {
  // The approved CHECK cardinality of the eight tables is unchanged.
  let total = 0;
  for (const table of ALL_CHECK_TABLES) {
    const checks = extractCheckClauses(sqliteDdlBlock(CANONICAL_SOURCE[table], table),
      { dialect: CHECK_LITERAL_DIALECT.SQL_STANDARD });
    assert.equal(checks.length, APPROVED_CHECK_COUNTS[table], `${table}: the approved CHECK cardinality`);
    total += checks.length;
  }
  assert.equal(total, 23, 'the eight tables must keep exactly 23 approved CHECK constraints');
  // The index parity contract still refuses a renamed index.
  const expectedIndex = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'ix_credit_check_results_stage_date', unique: false, columns: ['stage', 'business_date'] }],
  };
  const renamedIndex = {
    name: 'credit_check_results', foreignKeys: [],
    indexes: [{ name: 'stage', unique: false, columns: ['stage', 'business_date'] }],
  };
  assert.throws(() => assertIndexParity(expectedIndex, renamedIndex, 'index parity'), /must keep its name/);
  // The physical column type family contract is unchanged.
  assert.equal(mysqlTypeFamily('VARCHAR(128)'), mysqlTypeFamily('VARCHAR(128)'));
  // The oracle's canonical CHECK comparison is used at every entry point, and
  // no order-sensitive CHECK comparison is left behind.
  const fixtureSource = read('server/test-utils/wave10-mysql-schema-fixture.js');
  const integrationSource = read('server/mysql-sales-customer-wave10.integration.js');
  for (const [name, source] of [['the schema fixture', fixtureSource], ['the acceptance integration', integrationSource]]) {
    assert.equal(/assert\.deepEqual\((?:actual|actualTable)\.checks\s*,/.test(source), false,
      `${name} must not compare the CHECK arrays in their catalogue order`);
  }
  assert.equal((fixtureSource.match(/assertCheckParity\(/g) || []).length, 3,
    'the schema fixture must define the helper and use it at its two comparison sites');
  assert.equal((integrationSource.match(/assertCheckParity\(/g) || []).length, 1,
    'the acceptance integration must use the helper at its M-MIG-01 comparison site');
  // The narrow index-only predicate is gone and the production rule is in place.
  assert.equal(/function indexedColumns\(/.test(fixtureSource), false,
    'the index-only indexed predicate must be gone');
  assert.equal(/function mysqlIndexedColumns\(/.test(fixtureSource), true,
    'the production indexed predicate must be in place');
  // The new block adds no skipped, todo or focused test.
  const paritySource = read('server/sales-customer-wave10-mysql-parity.test.js');
  const block = paritySource.slice(paritySource.indexOf('§37.50 — the Wave 10 Parity Oracle correction.'));
  assert.equal(/\b(?:test|it|describe)\.(?:skip|only|todo)\b/.test(block), false,
    'the new block must not skip, focus or mark a test as todo');
  assert.equal(/\b(?:skip|todo|only)\s*:/.test(block), false,
    'the new block must not declare a skipped, todo or focused test');
  assert.equal(/\{\s*(?:skip|todo|only)\s*:/.test(block), false,
    'the new block must not declare a skipped, todo or focused test');
  assert.equal((block.match(/^test\(/gm) || []).length, 10, 'the new block must declare exactly the ten PT regressions');
});
