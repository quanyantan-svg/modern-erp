// W11-A U3 Selector — protected real-MySQL E3 acceptance.
//
// Requirement : document.md R-U3-GATE-01 .. R-U3-GATE-06
// Design      : solution.md §37.54.36.4, §37.54.36.5, §37.54.36.6
//
// Flat top-level TAP only: the protected campaign parser rejects nested plans.
// Exactly ten top-level tests, S01 .. S10, no describe, no skip, no todo.
//
// The suite verifies ONE production surface, `GET /api/credit/query-options`,
// through the real handler. It never simulates an authorization decision: the
// read scope is always resolved by the production resolver. It never rewrites
// SC101, SC102, the OVERDUE evidence or the ONE_TIME approval semantics.
//
// The customer-name search semantics are an APPROVED business decision
// (document.md R-U3-SEARCH-01, R-U3-SEARCH-02, R-U3-SEARCH-07, R-U3-SEARCH-08
// and R-U3-SEARCH-09). The case, accent and Unicode folding, the literal
// treatment of `%`, `_` and `\`, the deterministic ordering and the stable
// pagination are contracts of the business, so this suite ASSERTS cross-engine
// equality on them. A difference on an approved dimension is an acceptance
// failure and never a recorded observation.
//
// One dimension stays outside the approved search semantics: the exact
// identity filter of the selector compares the customer, the Credit Object
// type and the Credit Object identity under the collation of the identity
// column, which is case-insensitive on MySQL and case-sensitive on SQLite.
// R-U3-SEARCH-03 keeps that filter an equality comparison, so the difference
// is DISCLOSED and measured, it is never asserted as equal, and this suite
// never widens the business identity equality policy.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { createDatabase } from './db.js';
import { migrateSalesCustomerWave9CreditFoundation } from './migrations/sales-customer-wave9-credit-foundation.js';
import { migrateW11ASelectorSearchKey, verifySelectorSearchKeys } from './migrations/sales-customer-wave11-a-selector-search-key.js';
import { listCreditQueryOptions } from './modules/credit-query-options.js';
import { createTempDb } from './test-utils/temp-db.js';
import { databaseDigest } from './test-utils/wave11-a-credit-query-fixture.js';
import {
  ADMIN, CROSS_READER, CREDIT_OBJECT_TYPE, EXPIRED_ACTOR, FUTURE_ACTOR, HISTORICAL,
  NO_CREDIT, OTHER_ACTOR, SELF_ACTOR, TODAY, UNMAPPED_ACTOR, read,
} from './test-utils/wave11-sec-scope-fixture.js';
import {
  AMBIGUOUS_CUSTOMER, AMBIGUOUS_OBJECT, BACKSLASH_CUSTOMER, CASE_CUSTOMER, COLLATION_UNAMBIGUOUS_OPTION_KEYS,
  DUPLICATE_CUSTOMERS, DUPLICATE_NAME, MULTI_CUSTOMER, MULTI_OBJECTS, PERCENT_CUSTOMER, SUB_LIMIT_ONLY_CUSTOMER,
  SUB_LIMIT_ONLY_OBJECT, UNDERSCORE_CUSTOMER, UNICODE_CUSTOMER, WINDOW_CUSTOMER, WINDOW_OBJECT,
  expectedSelectorOptions, insertAmbiguousEffectiveVersion, readMySqlCollationFacts,
  removeAmbiguousEffectiveVersion, seedSelectorGateWorld, selectorOptionKey,
} from './test-utils/wave11-a-selector-gate-fixture.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

// The approved search semantics. The former open decision
// `CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN` was retired by R-U3-SEARCH-01,
// R-U3-SEARCH-02, R-U3-SEARCH-07, R-U3-SEARCH-08 and R-U3-SEARCH-09, and this
// gate now asserts the approved contract instead of measuring a difference.
const APPROVED_SEARCH_SEMANTICS = 'CUSTOMER_NAME_SEARCH_SEMANTICS_APPROVED';

// The one dimension that stays outside the approved search semantics. It is
// the identity domain, not the search domain, and R-U3-SEARCH-03 keeps the
// exact identity filter an equality comparison.
const RESIDUAL_IDENTITY_COLLATION_RISK = 'RESIDUAL_EXACT_IDENTITY_COLLATION_RISK';

const APPROVED_DTO_FIELDS = Object.freeze([
  'customerId', 'customerCode', 'customerName', 'customerActive',
  'creditObjectType', 'creditObjectId', 'availableScopeTypes',
]);

const CASE_KEY = selectorOptionKey(CASE_CUSTOMER, CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-CASE');
const UNICODE_KEY = selectorOptionKey(UNICODE_CUSTOMER, CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-UNICODE');
const PERCENT_KEY = selectorOptionKey(PERCENT_CUSTOMER, CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-PERCENT');
const UNDERSCORE_KEY = selectorOptionKey(UNDERSCORE_CUSTOMER, CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-UNDERSCORE');
const BACKSLASH_KEY = selectorOptionKey(BACKSLASH_CUSTOMER, CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-BACKSLASH');
const SELF_KEY = selectorOptionKey('cus-w11-self', CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-SELF');
const OTHER_KEY = selectorOptionKey('cus-w11-other', CREDIT_OBJECT_TYPE, 'CREDIT-CUS-W11-OTHER');
const WINDOW_KEY = selectorOptionKey(WINDOW_CUSTOMER, CREDIT_OBJECT_TYPE, WINDOW_OBJECT);

let mysqlHandle;
let mysqlDb;
let sqliteDb;
let sqliteDir;
let compatibilityEvidence;
const evidence = {
  startedAt: new Date().toISOString(),
  campaign: 'W11-A U3 SELECTOR MYSQL E3 ACCEPTANCE',
  semanticDecision: APPROVED_SEARCH_SEMANTICS,
  residualRisk: RESIDUAL_IDENTITY_COLLATION_RISK,
  cases: {},
  findings: {},
};

function options(db, actor, params = {}) {
  return read(listCreditQueryOptions, db, actor, params);
}

function keyOf(option) {
  return selectorOptionKey(option.customerId, option.creditObjectType, option.creditObjectId);
}

function sortedKeys(result) {
  return result.body.options.map(keyOf).sort();
}

function scopeTypesOf(result) {
  return Object.fromEntries(result.body.options.map((option) => [keyOf(option), option.availableScopeTypes]));
}

// The read-only physical definition probe of the four derived search key
// columns. The MySQL side reads the catalogue; the SQLite side reads the table
// definition and the declared collation. It never writes and never changes a
// collation.
const SEARCH_KEY_COLUMN_TARGETS = Object.freeze([
  Object.freeze({ table: 'customers', columns: Object.freeze(['code_search_key', 'name_search_key']) }),
  Object.freeze({ table: 'credit_profile', columns: Object.freeze(['credit_object_type_search_key', 'credit_object_id_search_key']) }),
]);

function readSearchKeyColumnDefinitions(db) {
  const definitions = [];
  if (db.dialect === 'mysql') {
    for (const target of SEARCH_KEY_COLUMN_TARGETS) {
      const rows = db.prepare(`SELECT COLUMN_NAME name, DATA_TYPE data_type, IS_NULLABLE is_nullable,
          COLLATION_NAME collation_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
          AND COLUMN_NAME IN (${target.columns.map(() => '?').join(',')})
        ORDER BY ORDINAL_POSITION`).all(target.table, ...target.columns);
      for (const row of rows) {
        definitions.push({
          table: target.table,
          name: row.name,
          dataType: String(row.data_type).toLowerCase(),
          nullable: row.is_nullable === 'YES',
          collation: row.collation_name,
        });
      }
    }
    return definitions;
  }
  for (const target of SEARCH_KEY_COLUMN_TARGETS) {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(target.table)?.sql || '';
    for (const column of db.prepare(`PRAGMA table_info(${target.table})`).all()) {
      if (!target.columns.includes(column.name)) continue;
      const escaped = column.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const canonical = new RegExp(
        `(?:\\(|,)\\s*${escaped}\\s+TEXT\\s+COLLATE\\s+BINARY(?:\\s+NULL)?(?=,|\\))`,
        'i',
      ).test(ddl);
      definitions.push({
        table: target.table,
        name: column.name,
        dataType: String(column.type).toLowerCase(),
        nullable: Number(column.notnull) === 0,
        collation: canonical ? 'BINARY' : 'DEFAULT',
      });
    }
  }
  return definitions;
}

function writeEvidence() {
  try {
    const dir = process.env.U3_SELECTOR_EVIDENCE_DIR
      || join(tmpdir(), `modern-erp-w11a-u3-selector-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'selector-mysql-e3-evidence.json');
    evidence.completedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(evidence, null, 2));
    const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
    // A TAP diagnostic, never a TAP record: the first word is not one of the
    // reserved summary names, so the strict parser cannot read it as a record.
    process.stdout.write(`# W11-A-U3-E3 EVIDENCE ${file} sha256=${sha256} semanticDecision=${APPROVED_SEARCH_SEMANTICS}\n`);
  } catch (error) {
    process.stdout.write(`# W11-A-U3-E3 EVIDENCE WRITE FAILED ${error.message}\n`);
  }
}

function exerciseMySqlAdditiveCompatibility(target) {
  const columns = () => target.prepare(`SELECT COLUMN_NAME name,DATA_TYPE data_type,
      IS_NULLABLE is_nullable,COLLATION_NAME collation_name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_profile'
    ORDER BY ORDINAL_POSITION`).all();
  const searchColumns = () => columns().filter((column) => column.name.endsWith('_search_key'));

  // M10/V2 — fresh bootstrap and live Wave 9 replay accept the complete
  // suffix. This executes before the business fixture writes any Profile.
  migrateSalesCustomerWave9CreditFoundation(target);
  assert.deepEqual(searchColumns().map((column) => column.name), [
    'credit_object_type_search_key', 'credit_object_id_search_key',
  ]);

  // M03/V1 — model a durable first ALTER TABLE followed by an interruption.
  // Wave 9 accepts the exact prefix and U3 completes, backfills and verifies
  // V2 before the adapter is used by the Selector fixture.
  target.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_id_search_key');
  assert.deepEqual(searchColumns().map((column) => column.name), ['credit_object_type_search_key']);
  migrateSalesCustomerWave9CreditFoundation(target);
  const recovered = migrateW11ASelectorSearchKey(target);
  assert.ok(recovered.added.includes('credit_profile.credit_object_id_search_key'));
  const recoveredVerification = verifySelectorSearchKeys(target);
  assert.equal(recoveredVerification.missing, 0);
  assert.equal(recoveredVerification.stale, 0);

  // M12 — an existing binary but non-LONGTEXT definition is not silently
  // accepted. Restore the disposable target explicitly and prove the
  // production migration returns to a valid V2 before the campaign proceeds.
  target.exec(`ALTER TABLE credit_profile MODIFY COLUMN credit_object_type_search_key
    VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL`);
  assert.throws(
    () => migrateW11ASelectorSearchKey(target),
    /credit_profile\.credit_object_type_search_key physical definition invalid/,
  );
  target.exec(`ALTER TABLE credit_profile MODIFY COLUMN credit_object_type_search_key
    LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL`);
  migrateW11ASelectorSearchKey(target);

  const finalColumns = searchColumns();
  assert.deepEqual(finalColumns.map((column) => ({
    name: column.name,
    dataType: column.data_type,
    nullable: column.is_nullable,
    collation: column.collation_name,
  })), [
    { name: 'credit_object_type_search_key', dataType: 'longtext', nullable: 'YES', collation: 'utf8mb4_0900_bin' },
    { name: 'credit_object_id_search_key', dataType: 'longtext', nullable: 'YES', collation: 'utf8mb4_0900_bin' },
  ]);
  return {
    M03: 'V1_TO_V2_PASS',
    M10: 'FRESH_BOOTSTRAP_AND_LIVE_REPLAY_PASS',
    M12: 'ILLEGAL_TYPE_REFUSED_AND_V2_RESTORED',
    finalColumns,
  };
}

before(async () => {
  mysqlHandle = createTempDb({ label: 'w11-a-u3-selector-mysql-e3', production: true });
  mysqlDb = mysqlHandle.db;
  assert.equal(mysqlDb.dialect, 'mysql', 'the gate target must not fall back to SQLite');
  compatibilityEvidence = exerciseMySqlAdditiveCompatibility(mysqlDb);
  await seedSelectorGateWorld(mysqlDb);

  sqliteDir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-a-u3-selector-sqlite-'));
  sqliteDb = createDatabase(join(sqliteDir, 'reference.db'));
  await seedSelectorGateWorld(sqliteDb);
});

after(() => {
  writeEvidence();
  try { sqliteDb?.close(); } finally {
    if (sqliteDir) rmSync(sqliteDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    mysqlHandle?.cleanup();
  }
});

test('W11-A-U3-E3-S01 the suite uses a real MySQL adapter and one shared production fixture', async () => {
  assert.equal(mysqlDb.dialect, 'mysql');
  assert.notEqual(sqliteDb.dialect, 'mysql');
  assert.equal(compatibilityEvidence.M03, 'V1_TO_V2_PASS');
  assert.equal(compatibilityEvidence.M10, 'FRESH_BOOTSTRAP_AND_LIVE_REPLAY_PASS');
  assert.equal(compatibilityEvidence.M12, 'ILLEGAL_TYPE_REFUSED_AND_V2_RESTORED');
  const sqliteBefore = databaseDigest(sqliteDb);
  const mysqlBefore = databaseDigest(mysqlDb);
  const sqliteResult = await options(sqliteDb, ADMIN, { limit: 100 });
  const mysqlResult = await options(mysqlDb, ADMIN, { limit: 100 });
  assert.equal(sqliteResult.statusCode, 200);
  assert.equal(mysqlResult.statusCode, 200);
  assert.deepEqual(sortedKeys(mysqlResult), sortedKeys(sqliteResult));
  assert.equal(mysqlResult.body.total, sqliteResult.body.total);
  assert.equal(databaseDigest(sqliteDb), sqliteBefore, 'the SQLite reference reads must stay zero-write');
  assert.equal(databaseDigest(mysqlDb), mysqlBefore, 'the MySQL reads must stay zero-write');
  evidence.cases.S01 = {
    sqliteTotal: sqliteResult.body.total,
    mysqlTotal: mysqlResult.body.total,
    identicalOptionSets: true,
    additiveCompatibility: compatibilityEvidence,
  };
});

test('W11-A-U3-E3-S02 the five-level Credit Read Mode projects the same logical options on both engines', async () => {
  const expected = expectedSelectorOptions();
  const readers = [ADMIN, CROSS_READER, SELF_ACTOR, OTHER_ACTOR, UNMAPPED_ACTOR, EXPIRED_ACTOR, FUTURE_ACTOR];
  const observed = {};
  for (const actor of readers) {
    const sqliteResult = await options(sqliteDb, actor, { limit: 100 });
    const mysqlResult = await options(mysqlDb, actor, { limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, actor.id);
    assert.equal(mysqlResult.statusCode, 200, actor.id);
    const wanted = expected[actor.id];
    assert.deepEqual(sortedKeys(sqliteResult), Object.keys(wanted).sort(), `${actor.id} sqlite option set`);
    assert.deepEqual(sortedKeys(mysqlResult), Object.keys(wanted).sort(), `${actor.id} mysql option set`);
    assert.deepEqual(scopeTypesOf(sqliteResult), wanted, `${actor.id} sqlite scope types`);
    assert.deepEqual(scopeTypesOf(mysqlResult), wanted, `${actor.id} mysql scope types`);
    assert.equal(sqliteResult.body.total, Object.keys(wanted).length, `${actor.id} sqlite count`);
    assert.equal(mysqlResult.body.total, Object.keys(wanted).length, `${actor.id} mysql count`);
    observed[actor.id] = { total: mysqlResult.body.total };
  }
  for (const db of [sqliteDb, mysqlDb]) {
    const denied = await options(db, NO_CREDIT, { limit: 100 });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
    assert.equal(denied.body, null, 'a denied reader must not receive any customer identity');
  }
  assert.deepEqual(SELF_ACTOR.permissions, ['CREDIT_VIEW']);
  assert.equal(SELF_ACTOR.permissions.includes('CUSTOMERS_VIEW'), false);
  assert.equal(SELF_ACTOR.permissions.includes('CREDIT_MANAGE'), false);
  evidence.cases.S02 = { readModes: observed, denied: 'CREDIT_SCOPE_DENIED' };
});

test('W11-A-U3-E3-S03 the logical COUNT, the list and the grouping share one authorized set', async () => {
  for (const db of [sqliteDb, mysqlDb]) {
    const all = await options(db, ADMIN, { limit: 100 });
    assert.equal(all.statusCode, 200);
    assert.equal(all.body.total, all.body.options.length, 'the count must equal the number of logical options');
    for (const option of all.body.options) {
      assert.deepEqual(Object.keys(option).sort(), APPROVED_DTO_FIELDS.slice().sort());
    }
    const selfOptions = all.body.options.filter((option) => option.customerId === 'cus-w11-self');
    assert.equal(selfOptions.length, 1, 'two Profile versions of one logical object are one option');
    assert.deepEqual(selfOptions[0].availableScopeTypes, ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']);
    const multi = all.body.options.filter((option) => option.customerId === MULTI_CUSTOMER);
    assert.equal(multi.length, 2, 'two Credit Objects stay two logical options');
    assert.deepEqual(multi.map((option) => option.creditObjectId).sort(), MULTI_OBJECTS.slice().sort());
    const duplicates = all.body.options.filter((option) => option.customerName === DUPLICATE_NAME);
    assert.equal(duplicates.length, 2, 'the same display name stays two logical customers');
    assert.deepEqual(
      duplicates.map((option) => option.customerId).sort(),
      DUPLICATE_CUSTOMERS.map((customer) => customer.id).sort(),
    );
    const pages = [];
    for (let offset = 0; offset < all.body.total; offset += 1) {
      const page = await options(db, ADMIN, { limit: 1, offset });
      assert.equal(page.statusCode, 200);
      assert.equal(page.body.total, all.body.total, 'every page reports the same authorized total');
      assert.equal(page.body.options.length, 1);
      pages.push(keyOf(page.body.options[0]));
    }
    assert.equal(new Set(pages).size, all.body.total, 'the pages must not overlap');
    assert.deepEqual(pages.slice().sort(), sortedKeys(all), 'the pages must rebuild the unpaginated set');
  }
});

test('W11-A-U3-E3-S04 the customer and Credit Object search matches the authorized set on both engines', async () => {
  const authorized = sortedKeys(await options(sqliteDb, SELF_ACTOR, { limit: 100 }));
  const defined = [
    { label: 'ascii-code-lower', q: 'cus-w11-case', expected: [CASE_KEY] },
    { label: 'ascii-code-upper', q: 'CUS-W11-CASE', expected: [CASE_KEY] },
    { label: 'ascii-code-mixed', q: 'Cus-W11-Case', expected: [CASE_KEY] },
    { label: 'ascii-other-code', q: 'cus-w11-other', expected: [OTHER_KEY] },
    { label: 'credit-object-identity', q: 'CREDIT-CUS-W11-SELF', expected: [SELF_KEY] },
    { label: 'unauthorized-target', q: 'cus-w11-subonly', expected: [] },
  ];
  for (const probe of defined) {
    const sqliteResult = await options(sqliteDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    const mysqlResult = await options(mysqlDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, probe.label);
    assert.equal(mysqlResult.statusCode, 200, probe.label);
    assert.deepEqual(sortedKeys(sqliteResult), probe.expected, `${probe.label} sqlite result`);
    assert.deepEqual(sortedKeys(mysqlResult), probe.expected, `${probe.label} mysql result`);
    assert.equal(sqliteResult.body.total, probe.expected.length, probe.label);
    assert.equal(mysqlResult.body.total, probe.expected.length, probe.label);
  }
  // The literal behaviour is now a business contract: `%`, `_` and `\` are
  // ordinary characters, so a query that contains one selects only the rows
  // whose own text contains that character.
  const literal = [
    { label: 'literal-percent', q: '%', expected: [PERCENT_KEY] },
    { label: 'literal-underscore', q: '_', expected: [UNDERSCORE_KEY] },
    { label: 'literal-backslash', q: '\\', expected: [BACKSLASH_KEY] },
    { label: 'literal-escaped-backslash', q: 'cus-w11-sel\\f', expected: [] },
  ];
  for (const probe of literal) {
    const sqliteResult = await options(sqliteDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    const mysqlResult = await options(mysqlDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, probe.label);
    assert.equal(mysqlResult.statusCode, 200, probe.label);
    assert.deepEqual(sortedKeys(sqliteResult), probe.expected, `${probe.label} sqlite result`);
    assert.deepEqual(sortedKeys(mysqlResult), probe.expected, `${probe.label} mysql result`);
    assert.deepEqual(sortedKeys(mysqlResult).filter((key) => !authorized.includes(key)), [], probe.label);
  }
  // The Unicode folding is now a business contract as well: the four probes
  // that the previous execution measured as divergent are strict assertions.
  const unicode = [
    { label: 'accent-folded', q: 'muller', expected: [CASE_KEY] },
    { label: 'accent-exact-lower', q: 'müller', expected: [CASE_KEY] },
    { label: 'accent-upper-case', q: 'MÜLLER', expected: [CASE_KEY] },
    { label: 'unicode-case-lower', q: 'ångström', expected: [UNICODE_KEY] },
    { label: 'unicode-case-exact', q: 'Ångström', expected: [UNICODE_KEY] },
  ];
  for (const probe of unicode) {
    const sqliteResult = await options(sqliteDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    const mysqlResult = await options(mysqlDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, probe.label);
    assert.equal(mysqlResult.statusCode, 200, probe.label);
    assert.deepEqual(sortedKeys(sqliteResult), probe.expected, `${probe.label} sqlite result`);
    assert.deepEqual(sortedKeys(mysqlResult), probe.expected, `${probe.label} mysql result`);
  }
  evidence.cases.S04 = {
    definedProbes: defined.map((probe) => probe.label),
    literalProbes: literal.map((probe) => probe.label),
    unicodeProbes: unicode.map((probe) => probe.label),
    authorizedOptionCount: authorized.length,
  };
});

test('W11-A-U3-E3-S05 the exact identity filter and the invalid input contract are identical', async () => {
  const identityOf = (customerId, creditObjectId) => ({
    customerId, creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId,
  });
  for (const db of [sqliteDb, mysqlDb]) {
    const exact = await options(db, SELF_ACTOR, identityOf('cus-w11-self', 'CREDIT-CUS-W11-SELF'));
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.body.total, 1);
    assert.equal(exact.body.options.length, 1);
    assert.equal(exact.body.options[0].customerId, 'cus-w11-self');
    const otherObject = await options(db, SELF_ACTOR, identityOf(MULTI_CUSTOMER, MULTI_OBJECTS[1]));
    assert.equal(otherObject.statusCode, 200);
    assert.equal(otherObject.body.total, 1);
    assert.equal(otherObject.body.options[0].creditObjectId, MULTI_OBJECTS[1]);
    const wrongType = await options(db, SELF_ACTOR, {
      customerId: 'cus-w11-self', creditObjectType: 'CONTRACT', creditObjectId: 'CREDIT-CUS-W11-SELF',
    });
    assert.equal(wrongType.statusCode, 200);
    assert.equal(wrongType.body.total, 0, 'a different Credit Object type is a different logical object');
  }
  const invalidInputs = [
    { limit: '0' }, { limit: '101' }, { offset: '-1' },
    { businessDate: '29-10-2026' }, { customerId: 'cus-w11-self' }, { q: 'x'.repeat(101) },
  ];
  for (const params of invalidInputs) {
    const sqliteResult = await options(sqliteDb, ADMIN, params);
    const mysqlResult = await options(mysqlDb, ADMIN, params);
    assert.equal(sqliteResult.statusCode, 400, JSON.stringify(params));
    assert.equal(mysqlResult.statusCode, 400, JSON.stringify(params));
    assert.equal(mysqlResult.code, sqliteResult.code, `the refusal code must match across engines: ${JSON.stringify(params)}`);
  }
});

test('W11-A-U3-E3-S06 the effective-date window and the revoked membership match SC101', async () => {
  for (const db of [sqliteDb, mysqlDb]) {
    const historical = await options(db, SELF_ACTOR, { businessDate: HISTORICAL, limit: 100 });
    const current = await options(db, SELF_ACTOR, { businessDate: TODAY, limit: 100 });
    assert.equal(historical.statusCode, 200);
    assert.equal(current.statusCode, 200);
    const historicalWindow = historical.body.options.find((option) => keyOf(option) === WINDOW_KEY);
    const currentWindow = current.body.options.find((option) => keyOf(option) === WINDOW_KEY);
    assert.deepEqual(historicalWindow.availableScopeTypes, ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']);
    assert.deepEqual(currentWindow.availableScopeTypes, ['CUSTOMER_AGGREGATE']);
    const expired = await options(db, EXPIRED_ACTOR, { businessDate: HISTORICAL, limit: 100 });
    assert.equal(expired.statusCode, 200);
    const expiredOption = expired.body.options.find((option) => option.customerId === 'cus-w11-expired');
    assert.deepEqual(expiredOption.availableScopeTypes, ['CUSTOMER_AGGREGATE']);
    assert.equal(
      expired.body.options.some((option) => option.availableScopeTypes.includes('SALESPERSON_SUB_LIMIT')),
      false,
      'a revoked self membership must not be restored by a historical business date',
    );
  }
});

test('W11-A-U3-E3-S07 an ambiguous effective Profile answers 409 on both engines', async () => {
  for (const db of [sqliteDb, mysqlDb]) {
    insertAmbiguousEffectiveVersion(db);
    try {
      const ambiguous = await options(db, ADMIN, {
        customerId: AMBIGUOUS_CUSTOMER,
        creditObjectType: CREDIT_OBJECT_TYPE,
        creditObjectId: AMBIGUOUS_OBJECT,
      });
      assert.equal(ambiguous.statusCode, 409);
      assert.equal(ambiguous.code, 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS');
      assert.equal(ambiguous.body, null, 'the refusal must not disclose the version count');
    } finally {
      removeAmbiguousEffectiveVersion(db);
    }
    const restored = await options(db, ADMIN, {
      customerId: AMBIGUOUS_CUSTOMER,
      creditObjectType: CREDIT_OBJECT_TYPE,
      creditObjectId: AMBIGUOUS_OBJECT,
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.total, 1);
  }
});

test('W11-A-U3-E3-S08 an unknown exact identity is indistinguishable from an unauthorized one', async () => {
  for (const db of [sqliteDb, mysqlDb]) {
    const unknown = await options(db, SELF_ACTOR, {
      customerId: 'cus-missing-customer',
      creditObjectType: CREDIT_OBJECT_TYPE,
      creditObjectId: 'CREDIT-CUS-MISSING',
    });
    const unauthorized = await options(db, SELF_ACTOR, {
      customerId: SUB_LIMIT_ONLY_CUSTOMER,
      creditObjectType: CREDIT_OBJECT_TYPE,
      creditObjectId: SUB_LIMIT_ONLY_OBJECT,
    });
    assert.equal(unknown.statusCode, 200);
    assert.equal(unauthorized.statusCode, 200);
    assert.deepEqual(unknown.body, unauthorized.body, 'the two refusals must be indistinguishable');
    assert.deepEqual(unknown.body.options, []);
    assert.equal(unknown.body.total, 0);
    const visible = await options(db, SELF_ACTOR, { limit: 100 });
    assert.equal(
      visible.body.options.some((option) => option.customerId === SUB_LIMIT_ONLY_CUSTOMER),
      false,
      'the scope predicate must be applied before the projection',
    );
  }
});

test('W11-A-U3-E3-S09 every measured GET is repeatable and leaves the database unchanged', async () => {
  for (const db of [sqliteDb, mysqlDb]) {
    const before = databaseDigest(db);
    const first = await options(db, SELF_ACTOR, { limit: 100 });
    const second = await options(db, SELF_ACTOR, { limit: 100 });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(first.body, second.body, 'two identical reads must be identical');
    assert.deepEqual(first.body.options.map(keyOf), second.body.options.map(keyOf));
    assert.equal(databaseDigest(db), before, 'a measured GET must not change the database');
  }
});

test('W11-A-U3-E3-S10 the ordering, the pagination and the search probes are identical on both engines', async () => {
  // ---- the live MySQL metadata, read only ----
  const mysqlFacts = readMySqlCollationFacts(mysqlDb);
  assert.ok(mysqlFacts, 'the read-only MySQL metadata probe must run on the MySQL side');
  assert.equal(readMySqlCollationFacts(sqliteDb), null, 'the SQLite side must not pretend to be MySQL');
  assert.ok(Number.isSafeInteger(Number(mysqlFacts.session.max_sort_length)), 'max_sort_length must be readable');
  assert.ok(
    Number.isSafeInteger(Number(mysqlFacts.session.max_sort_length))
      && Number(mysqlFacts.session.max_sort_length) >= 1024,
    'the MySQL group-key boundary must be readable',
  );
  assert.ok(
    Number(mysqlFacts.observed.max_bytes) <= 50,
    'the production writer bounds credit_object_type to 50 characters',
  );
  assert.ok(
    Number(mysqlFacts.observed.max_bytes) < Number(mysqlFacts.session.max_sort_length),
    'the group-key truncation boundary must be unreachable for the supported range',
  );

  // ---- the physical definition of the four derived search key columns ----
  const sqliteKeyColumns = readSearchKeyColumnDefinitions(sqliteDb);
  const mysqlKeyColumns = readSearchKeyColumnDefinitions(mysqlDb);
  assert.equal(sqliteKeyColumns.length, 4, 'the SQLite side exposes exactly four derived search key columns');
  assert.equal(mysqlKeyColumns.length, 4, 'the MySQL side exposes exactly four derived search key columns');
  for (const definition of sqliteKeyColumns) {
    assert.equal(definition.dataType, 'text', `${definition.table}.${definition.name} sqlite type`);
    assert.equal(definition.nullable, true, `${definition.table}.${definition.name} sqlite nullability`);
    assert.equal(definition.collation, 'BINARY', `${definition.table}.${definition.name} sqlite collation`);
  }
  for (const definition of mysqlKeyColumns) {
    assert.equal(definition.dataType, 'longtext', `${definition.table}.${definition.name} mysql type`);
    assert.equal(definition.nullable, true, `${definition.table}.${definition.name} mysql nullability`);
    assert.equal(definition.collation, 'utf8mb4_0900_bin', `${definition.table}.${definition.name} mysql collation`);
  }

  // ---- A. the full ordered option set is identical on both engines ----
  const sqliteOrder = (await options(sqliteDb, ADMIN, { limit: 100 })).body.options.map(keyOf);
  const mysqlOrder = (await options(mysqlDb, ADMIN, { limit: 100 })).body.options.map(keyOf);
  assert.equal(sqliteOrder.length, mysqlOrder.length, 'both engines must project the same number of logical options');
  assert.deepEqual(mysqlOrder, sqliteOrder, 'the full ordered option set must be identical on both engines');

  // The compared order must actually contain the identities that make the
  // ordering hard: the fold collision, the original mixed case, the two
  // customers that share one display name and the customer that owns two
  // Credit Objects.
  assert.ok(sqliteOrder.includes(CASE_KEY), 'the mixed-case customer must be part of the compared order');
  assert.ok(sqliteOrder.includes(UNICODE_KEY), 'the accented customer must be part of the compared order');
  assert.ok(sqliteOrder.includes(PERCENT_KEY), 'the percent customer must be part of the compared order');
  assert.ok(sqliteOrder.includes(UNDERSCORE_KEY), 'the underscore customer must be part of the compared order');
  assert.ok(sqliteOrder.includes(BACKSLASH_KEY), 'the backslash customer must be part of the compared order');
  assert.equal(
    sqliteOrder.filter((key) => key.startsWith(`${MULTI_CUSTOMER}:`)).length,
    2,
    'the customer with two Credit Objects must contribute two ordered identities',
  );
  assert.equal(
    sqliteOrder.filter((key) => DUPLICATE_CUSTOMERS.some((customer) => key.startsWith(`${customer.id}:`))).length,
    2,
    'the two customers that share one display name must contribute two ordered identities',
  );

  // The collation-unambiguous subset keeps the same relative order as well.
  const sqliteUnambiguous = sqliteOrder.filter((key) => COLLATION_UNAMBIGUOUS_OPTION_KEYS.includes(key));
  const mysqlUnambiguous = mysqlOrder.filter((key) => COLLATION_UNAMBIGUOUS_OPTION_KEYS.includes(key));
  assert.deepEqual(
    mysqlUnambiguous,
    sqliteUnambiguous,
    'the collation-unambiguous identities must keep the same relative order on both engines',
  );

  // ---- B. the pagination is exactly equal on both engines ----
  const paginationSlices = [];
  for (const limit of [1, 2, 3, 5, 7, 13]) {
    const sqliteSlices = [];
    const mysqlSlices = [];
    for (let offset = 0; offset < sqliteOrder.length; offset += limit) {
      const sqlitePage = await options(sqliteDb, ADMIN, { limit, offset });
      const mysqlPage = await options(mysqlDb, ADMIN, { limit, offset });
      assert.equal(sqlitePage.statusCode, 200, `limit=${limit} offset=${offset}`);
      assert.equal(mysqlPage.statusCode, 200, `limit=${limit} offset=${offset}`);
      assert.equal(sqlitePage.body.total, mysqlPage.body.total, `limit=${limit} offset=${offset} total`);
      assert.equal(sqlitePage.body.total, sqliteOrder.length, `limit=${limit} offset=${offset} authorized total`);
      assert.equal(
        sqlitePage.body.options.length,
        mysqlPage.body.options.length,
        `limit=${limit} offset=${offset} page size`,
      );
      sqliteSlices.push(sqlitePage.body.options.map(keyOf));
      mysqlSlices.push(mysqlPage.body.options.map(keyOf));
    }
    const sqliteFlat = sqliteSlices.flat();
    const mysqlFlat = mysqlSlices.flat();
    assert.deepEqual(mysqlFlat, sqliteFlat, `limit=${limit} the page slices must be identical on both engines`);
    assert.equal(new Set(sqliteFlat).size, sqliteOrder.length, `limit=${limit} the pages must not repeat an option`);
    assert.equal(sqliteFlat.length, sqliteOrder.length, `limit=${limit} the pages must not omit an option`);
    assert.deepEqual(sqliteFlat, sqliteOrder, `limit=${limit} the pages must rebuild the full ordered sequence`);
    paginationSlices.push({
      limit,
      sliceCount: sqliteSlices.length,
      first: sqliteSlices[0],
      last: sqliteSlices[sqliteSlices.length - 1],
    });
  }

  // ---- C. every approved search probe is identical on both engines ----
  const authorized = sortedKeys(await options(sqliteDb, SELF_ACTOR, { limit: 100 }));
  const probes = [
    { label: 'ascii-case-lower', q: 'cus-w11-case', expected: [CASE_KEY] },
    { label: 'ascii-case-upper', q: 'CUS-W11-CASE', expected: [CASE_KEY] },
    { label: 'unicode-case-lower', q: 'ångström', expected: [UNICODE_KEY] },
    { label: 'unicode-case-exact', q: 'Ångström', expected: [UNICODE_KEY] },
    { label: 'accent-folded', q: 'muller', expected: [CASE_KEY] },
    { label: 'accent-exact-lower', q: 'müller', expected: [CASE_KEY] },
    { label: 'accent-exact-capital', q: 'Müller', expected: [CASE_KEY] },
    { label: 'accent-upper-case', q: 'MÜLLER', expected: [CASE_KEY] },
    { label: 'backslash-escape', q: 'cus-w11-sel\\f', expected: [] },
    { label: 'wildcard-percent', q: '%', expected: [PERCENT_KEY] },
    { label: 'wildcard-underscore', q: '_', expected: [UNDERSCORE_KEY] },
  ];
  const findings = {};
  for (const probe of probes) {
    const sqliteResult = await options(sqliteDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    const mysqlResult = await options(mysqlDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, probe.label);
    assert.equal(mysqlResult.statusCode, 200, probe.label);
    const sqliteKeys = sortedKeys(sqliteResult);
    const mysqlKeys = sortedKeys(mysqlResult);
    assert.deepEqual(sqliteKeys, probe.expected, `${probe.label} sqlite must equal the approved expectation`);
    assert.deepEqual(mysqlKeys, probe.expected, `${probe.label} mysql must equal the approved expectation`);
    assert.deepEqual(mysqlKeys, sqliteKeys, `${probe.label} mysql must equal sqlite`);
    assert.deepEqual(sqliteKeys.filter((key) => !authorized.includes(key)), [], `${probe.label} sqlite stays authorized`);
    assert.deepEqual(mysqlKeys.filter((key) => !authorized.includes(key)), [], `${probe.label} mysql stays authorized`);
    assert.equal(sqliteResult.body.total, probe.expected.length, `${probe.label} sqlite count`);
    assert.equal(mysqlResult.body.total, probe.expected.length, `${probe.label} mysql count`);
    findings[probe.label] = {
      q: probe.q,
      expected: probe.expected,
      sqlite: sqliteKeys,
      mysql: mysqlKeys,
      divergent: JSON.stringify(sqliteKeys) !== JSON.stringify(mysqlKeys),
    };
  }
  assert.equal(Object.keys(findings).length, probes.length, 'every approved probe must be recorded');
  for (const finding of Object.values(findings)) {
    assert.ok(Array.isArray(finding.sqlite) && Array.isArray(finding.mysql), 'a measured probe keeps both engine results');
  }
  // A divergence on an approved search dimension is an acceptance failure.
  const divergentProbes = Object.values(findings).filter((finding) => finding.divergent).map((finding) => finding.label);
  assert.deepEqual(divergentProbes, [], 'no approved search probe may diverge between the two engines');

  // ---- D. the residual identity collation risk, disclosed and not asserted ----
  // The exact identity filter compares under the collation of the identity
  // column. That is the identity domain, not the approved search semantics,
  // and R-U3-SEARCH-03 keeps the filter an equality comparison. The behaviour
  // is measured and recorded, it is never asserted to be equal, and the
  // identity equality policy is not widened here.
  const caseVariantIdentity = {
    customerId: 'CUS-W11-SELF',
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: 'CREDIT-CUS-W11-SELF',
  };
  const sqliteIdentity = await options(sqliteDb, SELF_ACTOR, caseVariantIdentity);
  const mysqlIdentity = await options(mysqlDb, SELF_ACTOR, caseVariantIdentity);
  assert.equal(sqliteIdentity.statusCode, 200);
  assert.equal(mysqlIdentity.statusCode, 200);

  evidence.findings.collation = {
    semanticDecision: APPROVED_SEARCH_SEMANTICS,
    mysqlFacts,
    probes: findings,
    divergentProbes,
    sqliteOrder,
    mysqlOrder,
    fullOrderIdentical: JSON.stringify(sqliteOrder) === JSON.stringify(mysqlOrder),
    collationUnambiguousOrderMatches: JSON.stringify(sqliteUnambiguous) === JSON.stringify(mysqlUnambiguous),
    paginationSlices,
    searchKeyColumnDefinitions: { sqlite: sqliteKeyColumns, mysql: mysqlKeyColumns },
  };
  evidence.findings.residualIdentityCollation = {
    risk: RESIDUAL_IDENTITY_COLLATION_RISK,
    status: 'DISCLOSED_MEASURED_NOT_ASSERTED_EQUAL',
    dimension: 'the exact identity filter of the selector',
    requirement: 'R-U3-SEARCH-03 keeps the exact identity filter an equality comparison',
    note: 'the identity columns are utf8mb4_0900_ai_ci on MySQL and BINARY on SQLite, so a case-variant identity can resolve on one engine and not on the other. This is the identity domain, not the approved search semantics. It is recorded here, it is not part of the approved probe set, and this suite never widens the business identity equality policy.',
    caseVariantIdentity,
    sqlite: { total: sqliteIdentity.body.total, options: sqliteIdentity.body.options.map(keyOf) },
    mysql: { total: mysqlIdentity.body.total, options: mysqlIdentity.body.options.map(keyOf) },
    enginesAgree: JSON.stringify(sqliteIdentity.body.options.map(keyOf)) === JSON.stringify(mysqlIdentity.body.options.map(keyOf)),
  };
  evidence.cases.S10 = {
    semanticDecision: APPROVED_SEARCH_SEMANTICS,
    residualRisk: RESIDUAL_IDENTITY_COLLATION_RISK,
    fullOrderIdentical: true,
    divergentProbes,
    paginationPageSizes: paginationSlices.map((slice) => slice.limit),
    approvedProbeCount: probes.length,
  };
});