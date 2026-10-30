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
// The customer-name case and accent semantics are an OPEN business decision
// (`CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN`). This suite MEASURES that dimension
// on both engines and preserves the difference. It never asserts cross-engine
// equality on it, it never normalizes the two results into one, it never picks
// one engine as the business authority, and it never changes the production
// SQL, the schema or a collation.

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
  AMBIGUOUS_CUSTOMER, AMBIGUOUS_OBJECT, BACKSLASH_CUSTOMER, CASE_CUSTOMER, DUPLICATE_CUSTOMERS,
  DUPLICATE_NAME, MULTI_CUSTOMER, MULTI_OBJECTS, PERCENT_CUSTOMER, SUB_LIMIT_ONLY_CUSTOMER,
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

// The business contract does not define the case and accent semantics of a
// free-text customer name. The gate measures it and keeps it visible.
const OPEN_DECISION = 'CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN';

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
  semanticDecision: OPEN_DECISION,
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
    process.stdout.write(`# W11-A-U3-E3 EVIDENCE ${file} sha256=${sha256} semanticDecision=${OPEN_DECISION}\n`);
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

test('W11-A-U3-E3-S10 the ordering, the collation and the grouping are measured and stable', async () => {
  const mysqlFacts = readMySqlCollationFacts(mysqlDb);
  assert.ok(mysqlFacts, 'the read-only MySQL metadata probe must run on the MySQL side');
  assert.equal(readMySqlCollationFacts(sqliteDb), null, 'the SQLite side must not pretend to be MySQL');
  assert.ok(Number.isSafeInteger(Number(mysqlFacts.session.max_sort_length)), 'max_sort_length must be readable');
  assert.ok(Number(mysqlFacts.session.max_sort_length) >= 1024, 'the MySQL group-key boundary must be readable');
  assert.ok(
    Number(mysqlFacts.observed.max_bytes) <= 50,
    'the production writer bounds credit_object_type to 50 characters',
  );
  assert.ok(
    Number(mysqlFacts.observed.max_bytes) < Number(mysqlFacts.session.max_sort_length),
    'the group-key truncation boundary must be unreachable for the supported range',
  );

  const sqliteOrder = (await options(sqliteDb, ADMIN, { limit: 100 })).body.options.map(keyOf);
  const mysqlOrder = (await options(mysqlDb, ADMIN, { limit: 100 })).body.options.map(keyOf);
  const sqliteUnambiguous = sqliteOrder.filter((key) => COLLATION_UNAMBIGUOUS_OPTION_KEYS.includes(key));
  const mysqlUnambiguous = mysqlOrder.filter((key) => COLLATION_UNAMBIGUOUS_OPTION_KEYS.includes(key));
  assert.deepEqual(
    mysqlUnambiguous,
    sqliteUnambiguous,
    'the collation-unambiguous identities must keep the same relative order on both engines',
  );
  for (const [db, order] of [[sqliteDb, sqliteOrder], [mysqlDb, mysqlOrder]]) {
    const total = order.length;
    const paged = [];
    for (let offset = 0; offset < total; offset += 1) {
      const page = await options(db, ADMIN, { limit: 1, offset });
      assert.equal(page.body.total, total);
      assert.equal(page.body.options.length, 1);
      paged.push(keyOf(page.body.options[0]));
    }
    assert.deepEqual(paged, order, 'the stable pagination must reproduce the ordered set');
    assert.equal(new Set(paged).size, total, 'the stable pagination must not overlap');
  }

  const authorized = sortedKeys(await options(sqliteDb, SELF_ACTOR, { limit: 100 }));
  const measured = [
    { label: 'ascii-case-lower', q: 'cus-w11-case' },
    { label: 'ascii-case-upper', q: 'CUS-W11-CASE' },
    { label: 'unicode-case-lower', q: 'ångström' },
    { label: 'unicode-case-exact', q: 'Ångström' },
    { label: 'accent-folded', q: 'muller' },
    { label: 'accent-exact-lower', q: 'müller' },
    { label: 'accent-exact-capital', q: 'Müller' },
    { label: 'accent-upper-case', q: 'MÜLLER' },
    { label: 'backslash-escape', q: 'cus-w11-sel\\f' },
    { label: 'wildcard-percent', q: '%' },
    { label: 'wildcard-underscore', q: '_' },
  ];
  const findings = {};
  for (const probe of measured) {
    const sqliteResult = await options(sqliteDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    const mysqlResult = await options(mysqlDb, SELF_ACTOR, { q: probe.q, limit: 100 });
    assert.equal(sqliteResult.statusCode, 200, probe.label);
    assert.equal(mysqlResult.statusCode, 200, probe.label);
    const sqliteKeys = sortedKeys(sqliteResult);
    const mysqlKeys = sortedKeys(mysqlResult);
    assert.deepEqual(sqliteKeys.filter((key) => !authorized.includes(key)), [], `${probe.label} sqlite stays authorized`);
    assert.deepEqual(mysqlKeys.filter((key) => !authorized.includes(key)), [], `${probe.label} mysql stays authorized`);
    assert.equal(sqliteResult.body.total, sqliteKeys.length, `${probe.label} sqlite count`);
    assert.equal(mysqlResult.body.total, mysqlKeys.length, `${probe.label} mysql count`);
    findings[probe.label] = {
      q: probe.q,
      sqlite: sqliteKeys,
      mysql: mysqlKeys,
      divergent: JSON.stringify(sqliteKeys) !== JSON.stringify(mysqlKeys),
    };
  }
  assert.equal(Object.keys(findings).length, measured.length, 'every measured probe must be recorded');
  for (const finding of Object.values(findings)) {
    assert.ok(Array.isArray(finding.sqlite) && Array.isArray(finding.mysql), 'a measured probe keeps both engine results');
  }
  evidence.findings.collation = {
    semanticDecision: OPEN_DECISION,
    mysqlFacts,
    probes: findings,
    sqliteOrder,
    mysqlOrder,
    collationUnambiguousOrderMatches: JSON.stringify(sqliteUnambiguous) === JSON.stringify(mysqlUnambiguous),
  };
  evidence.cases.S10 = {
    semanticDecision: OPEN_DECISION,
    divergentProbes: Object.values(findings).filter((finding) => finding.divergent).map((finding) => finding.label),
  };
});
