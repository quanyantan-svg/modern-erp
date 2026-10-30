// W11-A U3 — the Selector search semantics suite.
//
// Requirement : document.md R-U3-SEARCH-01 .. R-U3-SEARCH-12
// Design      : solution.md §37.54.39.7, §37.54.40.3, §37.54.40.4, §37.54.40.5, §37.54.40.7
//
// Every case here drives the REAL production selector, the REAL production
// writers and a REAL SQLite database. A source scan is never accepted as a
// proof of a database behaviour.
//
// The suite is registered in FULL and not in FAST: every case migrates a fresh
// database and drives the production writers.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createDatabase } from './db.js';
import { commitImport, stageCsvImport, validateImport } from './modules/commercial-golive.js';
import { createCustomer, updateCustomer } from './modules/customers.js';
import { createCreditProfile } from './modules/credit-profile.js';
import { listCreditQueryOptions } from './modules/credit-query-options.js';
import {
  SEARCH_FOLD_ESCAPE_CHARACTER,
  SEARCH_FOLD_VERSION,
  buildSearchPatterns,
  escapeSearchPattern,
  foldSearchText,
} from './lib/search-fold.js';
import {
  backfillSelectorSearchKeys,
  migrateW11ASelectorSearchKey,
  verifySelectorSearchKeys,
} from './migrations/sales-customer-wave11-a-selector-search-key.js';
import { migrateSalesCustomerWave9CreditFoundation } from './migrations/sales-customer-wave9-credit-foundation.js';
import { createTempDb } from './test-utils/temp-db.js';
import { databaseDigest } from './test-utils/wave11-a-credit-query-fixture.js';
import {
  ADMIN,
  CROSS_READER,
  CREDIT_OBJECT_TYPE,
  NO_CREDIT,
  PROFILE_FROM,
  SELF_ACTOR,
  UNMAPPED_ACTOR,
  invoke,
  invokeWithId,
  read,
  seedWorld,
} from './test-utils/wave11-sec-scope-fixture.js';

// The customer writer needs its own permission, the Credit Profile writer
// needs the credit management authority.
const CUSTOMER_ADMIN = Object.freeze({
  id: ADMIN.id,
  roleCode: ADMIN.roleCode,
  permissions: [...ADMIN.permissions, 'CUSTOMERS_MANAGE'],
});

let handle;
let db;

beforeEach(async () => {
  handle = createTempDb({ label: 'w11a-u3-search-semantics', production: true });
  db = handle.db;
  await seedWorld(db);
  // The shared W11-SEC fixture inserts its customers directly, so they carry
  // no derived key. The backfill is the production reconciliation and it makes
  // the whole database searchable, which is the state a deployment is in.
  backfillSelectorSearchKeys(db);
});

afterEach(() => handle?.cleanup());

const options = (actor, params = {}) => read(listCreditQueryOptions, db, actor, params);
const names = (result) => (result.body?.options || []).map((option) => option.customerName).sort();
const codes = (result) => (result.body?.options || []).map((option) => option.customerCode).sort();
const keyOf = (option) => `${option.customerId}:${option.creditObjectType}:${option.creditObjectId}`;

const WAVE9_PROFILE_BASE_COLUMNS = Object.freeze([
  'id', 'anchor_id', 'customer_id', 'salesperson_scope_key', 'salesperson_id',
  'credit_object_type', 'credit_object_id', 'credit_limit_cents', 'initial_state', 'status',
  'rating_grade', 'rating_effective_from', 'rating_effective_to', 'overdue_day_policy', 'rule_id',
  'effective_from', 'effective_to', 'created_at', 'created_by',
]);
const WAVE9_PROFILE_SEARCH_SUFFIX = Object.freeze([
  'credit_object_type_search_key', 'credit_object_id_search_key',
]);

function profileColumns(target) {
  return target.prepare('PRAGMA table_info(credit_profile)').all().map((row) => row.name);
}

function createWave9Prerequisites(target) {
  target.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE salesperson_profiles (id TEXT PRIMARY KEY);
  `);
}

function wave9OnlyDatabase() {
  const target = new DatabaseSync(':memory:');
  createWave9Prerequisites(target);
  migrateSalesCustomerWave9CreditFoundation(target);
  return target;
}

function malformedWave9ProfileDatabase({ primaryKey = true, customerTarget = 'customers', checks = 3 } = {}) {
  const target = new DatabaseSync(':memory:');
  createWave9Prerequisites(target);
  const checkSql = [
    "CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED'))",
    "CHECK((salesperson_scope_key='*' AND salesperson_id IS NULL) OR (salesperson_scope_key<>'*' AND salesperson_id IS NOT NULL AND salesperson_scope_key=salesperson_id))",
    'CHECK(effective_to IS NULL OR effective_to>=effective_from)',
  ].slice(0, checks).join(',');
  target.exec(`CREATE TABLE credit_profile (
    id TEXT ${primaryKey ? 'PRIMARY KEY ' : ''}NOT NULL,
    anchor_id TEXT NOT NULL REFERENCES credit_lock_anchors(id),
    customer_id TEXT NOT NULL REFERENCES ${customerTarget}(id),
    salesperson_scope_key TEXT NOT NULL,
    salesperson_id TEXT REFERENCES salesperson_profiles(id),
    credit_object_type TEXT NOT NULL,
    credit_object_id TEXT NOT NULL,
    credit_limit_cents BIGINT,
    initial_state TEXT NOT NULL,
    status TEXT NOT NULL,
    rating_grade TEXT,
    rating_effective_from TEXT,
    rating_effective_to TEXT,
    overdue_day_policy TEXT,
    rule_id TEXT REFERENCES credit_check_rules(id),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id)${checkSql ? `,${checkSql}` : ''}
  )`);
  return target;
}

async function createSearchableCustomer(code, name, { creditObjectId = null } = {}) {
  const created = await invoke(createCustomer, db, { code, name }, CUSTOMER_ADMIN, `se-customer-${code}`);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const profile = await invoke(createCreditProfile, db, {
    customerId: created.body.id,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: creditObjectId || `CREDIT-${code}`,
    creditLimitCents: 100000,
    initialState: 'NORMAL',
    status: 'ACTIVE',
    ratingGrade: 'A',
    overdueDayPolicy: '15',
    effectiveFrom: PROFILE_FROM,
  }, CUSTOMER_ADMIN, `se-profile-${code}`);
  assert.equal(profile.statusCode, 201, JSON.stringify(profile.body));
  return created.body.id;
}

// ---------------------------------------------------------------------------
// The fold itself: the language boundaries are asserted with real values.
// ---------------------------------------------------------------------------

test('SE-FOLD-01 the fold is script aware and folds only the Latin diacritics', () => {
  assert.equal(SEARCH_FOLD_VERSION, 'W11-A-SEARCH-FOLD-V1');
  assert.equal(foldSearchText('Müller GmbH'), 'MULLER GMBH');
  assert.equal(foldSearchText('muller'), 'MULLER');
  assert.equal(foldSearchText('MÜLLER'), 'MULLER');
  assert.equal(foldSearchText('Ångström AB'), 'ANGSTROM AB');
  assert.equal(foldSearchText('ångström'), 'ANGSTROM');
  assert.equal(foldSearchText('Ångström'), 'ANGSTROM');
  assert.equal(foldSearchText('straße'), 'STRASSE');
  assert.equal(foldSearchText('STRASSE'), 'STRASSE');
  assert.equal(foldSearchText('İstanbul'), 'ISTANBUL');
  assert.equal(foldSearchText('ıstanbul'), 'ISTANBUL');
  assert.equal(foldSearchText('istanbul'), 'ISTANBUL');
});

test('SE-FOLD-02 the fold preserves the semantic marks of the other scripts', () => {
  assert.equal(foldSearchText('中文客户'), '中文客户');
  assert.equal(foldSearchText('上海示例 客户'), '上海示例 客户');
  assert.equal(foldSearchText('हिन्दी'), 'हिन्दी');
  assert.ok(foldSearchText('हिन्दी').includes('्'), 'the Devanagari virama must survive');
  assert.equal(foldSearchText('नँ'), 'नँ');
  assert.equal(foldSearchText('ม้า'), 'ม้า');
  assert.ok(foldSearchText('ม้า').includes('้'), 'the Thai tone mark must survive');
  assert.equal(foldSearchText('ที่'), 'ที่');
  assert.equal(foldSearchText('שָׁלוֹם'), 'שָׁלוֹם');
  assert.equal(foldSearchText('مَرْحَبًا'), 'مَرْحَبًا');
  // The Greek tonos is preserved as a decomposed mark, exactly as it was stored.
  assert.ok(/\p{Mn}/u.test(foldSearchText('ά')), 'the Greek tonos must survive');
  assert.notEqual(foldSearchText('ά'), foldSearchText('α'), 'the Greek tonos changes the vowel');
  assert.ok(/\p{Mn}/u.test(foldSearchText('й')), 'the Cyrillic breve must survive');
  assert.notEqual(foldSearchText('й'), foldSearchText('и'), 'the Cyrillic breve changes the letter');
  assert.equal(foldSearchText('Müller 中文 GmbH'), 'MULLER 中文 GMBH');
  assert.equal(foldSearchText('Ångström 中文 AB'), 'ANGSTROM 中文 AB');
  assert.equal(foldSearchText('Ångström'), foldSearchText('Ångström'));
});

test('SE-FOLD-03 the pattern escaping makes the three special characters literal', () => {
  assert.equal(SEARCH_FOLD_ESCAPE_CHARACTER, '!');
  assert.equal(escapeSearchPattern('%'), '!%');
  assert.equal(escapeSearchPattern('_'), '!_');
  assert.equal(escapeSearchPattern('!'), '!!');
  assert.equal(escapeSearchPattern('\\'), '\\');
  assert.equal(escapeSearchPattern('a%b_c!d\\'), 'A!%B!_C!!D\\');
  assert.deepEqual(buildSearchPatterns('cus%'), { prefix: 'CUS!%%', contains: '%CUS!%%' });
  assert.deepEqual(buildSearchPatterns(''), { prefix: '%', contains: '%%' });
});

// ---------------------------------------------------------------------------
// SE-01 .. SE-14 — the business contracts.
// ---------------------------------------------------------------------------

test('SE-01 an accented customer name is found by its folded query', async () => {
  await createSearchableCustomer('CUS-MULLER', 'Müller GmbH');
  for (const query of ['muller', 'MÜLLER', 'müller', 'Muller']) {
    const result = await options(SELF_ACTOR, { q: query, limit: 100 });
    assert.equal(result.statusCode, 200, query);
    assert.deepEqual(names(result), ['Müller GmbH'], query);
    assert.equal(result.body.total, 1, query);
  }
  assert.equal(foldSearchText('Müller GmbH'), 'MULLER GMBH');
});

test('SE-02 a Nordic customer name is found by its folded query', async () => {
  await createSearchableCustomer('CUS-ANG', 'Ångström AB');
  for (const query of ['ångström', 'Ångström', 'ÅNGSTRÖM', 'angstrom']) {
    const result = await options(SELF_ACTOR, { q: query, limit: 100 });
    assert.equal(result.statusCode, 200, query);
    assert.deepEqual(names(result), ['Ångström AB'], query);
  }
});

test('SE-03 an ASCII mixed-case customer code is found by its lower and upper form', async () => {
  await createSearchableCustomer('Cus-W11-Mixed', 'Mixed Case Co');
  for (const query of ['cus-w11-mixed', 'CUS-W11-MIXED', 'Cus-W11-Mixed']) {
    const result = await options(SELF_ACTOR, { q: query, limit: 100 });
    assert.equal(result.statusCode, 200, query);
    assert.deepEqual(codes(result), ['CUS-W11-MIXED'], query);
  }
});

test('SE-04 a Unicode case variant is found', async () => {
  await createSearchableCustomer('CUS-UNICODE', 'Ångström AB');
  const result = await options(SELF_ACTOR, { q: 'ÅNGSTRÖM', limit: 100 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(names(result), ['Ångström AB']);
  const lower = await options(SELF_ACTOR, { q: 'ångström', limit: 100 });
  assert.deepEqual(names(lower), ['Ångström AB']);
});

test('SE-05 a percent sign is a literal character', async () => {
  await createSearchableCustomer('CUS-PCT', 'Fifty % Discount Co');
  await createSearchableCustomer('CUS-NOPCT', 'Plain Company');
  const result = await options(SELF_ACTOR, { q: '%', limit: 100 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(names(result), ['Fifty % Discount Co']);
  assert.equal(result.body.total, 1);
});

test('SE-06 an underscore is a literal character', async () => {
  await createSearchableCustomer('CUS-UND', 'Under_Score Co');
  await createSearchableCustomer('CUS-NOUND', 'Plain Company');
  const result = await options(SELF_ACTOR, { q: '_', limit: 100 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(names(result), ['Under_Score Co']);
  assert.equal(result.body.total, 1);
});

test('SE-07 a backslash is a literal character', async () => {
  await createSearchableCustomer('CUS-BS', 'Back\\Slash Co');
  await createSearchableCustomer('CUS-NOBS', 'Plain Company');
  const result = await options(SELF_ACTOR, { q: '\\', limit: 100 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(names(result), ['Back\\Slash Co']);
  assert.equal(result.body.total, 1);
  // The backslash must not escape the following character either.
  const escaped = await options(SELF_ACTOR, { q: 'Back\\Slash', limit: 100 });
  assert.deepEqual(names(escaped), ['Back\\Slash Co']);
});

test('SE-08 a multi-character containment works and the customer code stays a prefix match', async () => {
  await createSearchableCustomer('CUS-PREFIXONLY', 'Distinct Name Co', { creditObjectId: 'CREDIT-DISTINCT-OBJ' });
  const contained = await options(SELF_ACTOR, { q: 'stinct Na', limit: 100 });
  assert.deepEqual(codes(contained), ['CUS-PREFIXONLY']);
  const prefix = await options(SELF_ACTOR, { q: 'CUS-PREF', limit: 100 });
  assert.deepEqual(codes(prefix), ['CUS-PREFIXONLY']);
  // The code is a prefix position, so a code fragment that is not a prefix
  // does not match through the code. The name does not contain it either.
  const notAPrefix = await options(SELF_ACTOR, { q: 'PREFIXONLY', limit: 100 });
  assert.deepEqual(codes(notAPrefix), []);
});

test('SE-09 the five Credit Read Modes keep their authorized set under a search', async () => {
  await createSearchableCustomer('CUS-MODE', 'Mode Customer');
  const unauthorized = await options(SELF_ACTOR, { q: 'Mode', limit: 100 });
  assert.deepEqual(codes(unauthorized), ['CUS-MODE']);
  // An account without the Credit Read Scope receives nothing at all.
  const denied = await options(NO_CREDIT, { q: 'Mode', limit: 100 });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
  assert.equal(denied.body, null);
  // The aggregate only reader sees the aggregate scope and never a sub-limit.
  const aggregateOnly = await options(UNMAPPED_ACTOR, { q: 'Mode', limit: 100 });
  const aggregateOption = aggregateOnly.body.options.find((option) => option.customerCode === 'CUS-MODE');
  assert.ok(aggregateOption, 'the aggregate only reader must see the aggregate scope');
  assert.deepEqual(aggregateOption.availableScopeTypes, ['CUSTOMER_AGGREGATE']);
  // The cross group reader sees the same authorized projection.
  const crossGroup = await options(CROSS_READER, { q: 'Mode', limit: 100 });
  assert.deepEqual(codes(crossGroup), ['CUS-MODE']);
  // The self reader sees the aggregate scope of every authorized customer and
  // never the sub-limit of another salesperson.
  const self = await options(SELF_ACTOR, { q: 'Mode', limit: 100 });
  assert.deepEqual(self.body.options.map((option) => option.availableScopeTypes), [['CUSTOMER_AGGREGATE']]);
});

test('SE-10 the count, the pages and the rebuilt set agree under a filtered set', async () => {
  for (const index of [1, 2, 3, 4, 5]) {
    await createSearchableCustomer(`CUS-PAGE-${index}`, `Paged Company ${index}`);
  }
  const all = await options(ADMIN, { q: 'Paged', limit: 100 });
  assert.equal(all.body.total, 5);
  assert.equal(all.body.options.length, 5);
  const pages = [];
  for (let offset = 0; offset < all.body.total; offset += 1) {
    const page = await options(ADMIN, { q: 'Paged', limit: 1, offset });
    assert.equal(page.body.total, all.body.total);
    assert.equal(page.body.options.length, 1);
    pages.push(keyOf(page.body.options[0]));
  }
  assert.equal(new Set(pages).size, all.body.total, 'the pages must not overlap');
  assert.deepEqual(pages.slice().sort(), all.body.options.map(keyOf).sort());
});

test('SE-11 the order is stable, total and reproducible', async () => {
  await createSearchableCustomer('CUS-ORDER-B', 'Order B');
  await createSearchableCustomer('CUS-ORDER-A', 'Order A');
  const first = await options(ADMIN, { limit: 100 });
  const second = await options(ADMIN, { limit: 100 });
  assert.deepEqual(first.body.options.map(keyOf), second.body.options.map(keyOf));
  const ordered = first.body.options.map((option) => option.customerCode);
  assert.deepEqual(ordered, [...ordered].sort(), 'the order follows the folded customer code');
  // A repeated read with a different page size keeps the same sequence.
  const paged = await options(ADMIN, { limit: 2, offset: 1 });
  assert.deepEqual(paged.body.options.map(keyOf), first.body.options.slice(1, 3).map(keyOf));
  // Two customer codes that differ only in their original case fold to the
  // same key. The customer API normalizes the code, so only the golive import
  // can create the pair, and only a case sensitive unique key can store it.
  // The order must still be stable and must not depend on the insertion
  // order.
  const staged = stageCsvImport(db, {
    idempotencyKey: 'se-fold-collision',
    entityType: 'customers',
    actorId: ADMIN.id,
    csv: 'code,name\nCUS-Fold-A,Fold One\nCUS-FOLD-A,Fold Two\n',
  });
  assert.equal(validateImport(db, staged.id).valid, true);
  assert.equal(commitImport(db, staged.id).status, 'COMMITTED');
  const imported = db.prepare("SELECT id,code FROM customers WHERE code IN ('CUS-Fold-A','CUS-FOLD-A') ORDER BY id").all();
  assert.equal(imported.length, 2);
  for (const [index, customer] of imported.entries()) {
    const profile = await invoke(createCreditProfile, db, {
      customerId: customer.id, creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId: `CREDIT-COLLIDE-${index}`,
      creditLimitCents: 100000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
      overdueDayPolicy: '15', effectiveFrom: PROFILE_FROM,
    }, CUSTOMER_ADMIN, `se-collide-${index}`);
    assert.equal(profile.statusCode, 201);
  }
  assert.equal(foldSearchText('CUS-Fold-A'), foldSearchText('CUS-FOLD-A'), 'the two codes must collide');
  const collided = await options(ADMIN, { limit: 100 });
  const collidedOrder = collided.body.options.map(keyOf);
  assert.deepEqual(collidedOrder, (await options(ADMIN, { limit: 100 })).body.options.map(keyOf));
  const collidedCodes = collided.body.options.map((option) => option.customerCode);
  const firstIndex = collidedCodes.indexOf('CUS-FOLD-A');
  const secondIndex = collidedCodes.indexOf('CUS-Fold-A');
  assert.ok(firstIndex >= 0 && secondIndex >= 0, 'both collided customers must be projected');
  assert.ok(firstIndex < secondIndex, 'the original bytes decide the order of a colliding fold key');
});

test('SE-12 every measured search GET is zero-write', async () => {
  await createSearchableCustomer('CUS-ZERO', 'Zero Write Co');
  const before = databaseDigest(db);
  for (const query of ['Zero', '%', '_', '\\', 'muller']) {
    await options(SELF_ACTOR, { q: query, limit: 100 });
  }
  assert.equal(databaseDigest(db), before, 'a measured search GET must not change the database');
});

test('SE-13 the refused input contract is unchanged', async () => {
  for (const params of [
    { limit: '0' }, { limit: '101' }, { offset: '-1' },
    { businessDate: '29-10-2026' }, { customerId: 'cus-w11-self' }, { q: 'x'.repeat(101) },
  ]) {
    const result = await options(ADMIN, params);
    assert.equal(result.statusCode, 400, JSON.stringify(params));
  }
});

test('SE-14 the exact identity filter stays an equality comparison', async () => {
  const identity = (customerId, creditObjectId) => ({
    customerId, creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId,
  });
  const exact = await options(SELF_ACTOR, identity('cus-w11-self', 'CREDIT-CUS-W11-SELF'));
  assert.equal(exact.statusCode, 200);
  assert.equal(exact.body.total, 1);
  assert.equal(exact.body.options[0].customerId, 'cus-w11-self');
  // A different Credit Object identity of the same customer is a different
  // logical object and never matches.
  const other = await options(SELF_ACTOR, identity('cus-w11-self', 'CREDIT-CUS-W11-SELF-X'));
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.total, 0);
  // An unknown identity and an unauthorized identity stay indistinguishable.
  const unknown = await options(SELF_ACTOR, identity('cus-missing-u3', 'CREDIT-CUS-MISSING'));
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.body.options, []);
  assert.equal(unknown.body.total, 0);
});

// ---------------------------------------------------------------------------
// The migration lifecycle.
// ---------------------------------------------------------------------------

test('M01 the original Wave 9 V0 profile passes the exact base validator', () => {
  const target = wave9OnlyDatabase();
  try {
    assert.deepEqual(profileColumns(target), WAVE9_PROFILE_BASE_COLUMNS);
    assert.doesNotThrow(() => migrateSalesCustomerWave9CreditFoundation(target));
  } finally {
    target.close();
  }
});

test('M02 the approved V2 suffix passes Wave 9 without weakening its base contract', () => {
  assert.deepEqual(profileColumns(db), [...WAVE9_PROFILE_BASE_COLUMNS, ...WAVE9_PROFILE_SEARCH_SUFFIX]);
  assert.doesNotThrow(() => migrateSalesCustomerWave9CreditFoundation(db));
});

test('M03 V1 passes Wave 9 and the U3 migration completes it to verified V2', () => {
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_id_search_key');
  assert.deepEqual(profileColumns(db), [...WAVE9_PROFILE_BASE_COLUMNS, WAVE9_PROFILE_SEARCH_SUFFIX[0]]);
  assert.doesNotThrow(() => migrateSalesCustomerWave9CreditFoundation(db));
  const migrated = migrateW11ASelectorSearchKey(db);
  assert.ok(migrated.added.includes('credit_profile.credit_object_id_search_key'));
  assert.deepEqual(profileColumns(db), [...WAVE9_PROFILE_BASE_COLUMNS, ...WAVE9_PROFILE_SEARCH_SUFFIX]);
  assert.deepEqual(verifySelectorSearchKeys(db), {
    version: SEARCH_FOLD_VERSION,
    checked: verifySelectorSearchKeys(db).checked,
    missing: 0,
    stale: 0,
    samples: [],
  });
});

test('M04 a second-only suffix fails the Wave 9 validator', () => {
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_type_search_key');
  assert.deepEqual(profileColumns(db), [...WAVE9_PROFILE_BASE_COLUMNS, WAVE9_PROFILE_SEARCH_SUFFIX[1]]);
  assert.throws(
    () => migrateSalesCustomerWave9CreditFoundation(db),
    /credit_profile column identity\/order drifted/,
  );
});

test('M05 the approved columns in reverse order fail the Wave 9 validator', () => {
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_id_search_key');
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_type_search_key');
  db.exec('ALTER TABLE credit_profile ADD COLUMN credit_object_id_search_key TEXT COLLATE BINARY');
  db.exec('ALTER TABLE credit_profile ADD COLUMN credit_object_type_search_key TEXT COLLATE BINARY');
  assert.throws(
    () => migrateSalesCustomerWave9CreditFoundation(db),
    /credit_profile column identity\/order drifted/,
  );
});

test('M06 an unknown or third suffix column fails the Wave 9 validator', () => {
  db.exec('ALTER TABLE credit_profile ADD COLUMN unknown_search_extension TEXT');
  assert.throws(
    () => migrateSalesCustomerWave9CreditFoundation(db),
    /credit_profile column identity\/order drifted/,
  );
});

test('M07 a missing original Profile column fails even when the remaining order is stable', () => {
  const target = wave9OnlyDatabase();
  try {
    target.exec('ALTER TABLE credit_profile DROP COLUMN rating_grade');
    assert.throws(
      () => migrateSalesCustomerWave9CreditFoundation(target),
      /credit_profile column identity\/order drifted/,
    );
  } finally {
    target.close();
  }
});

test('M08 original PK, FK, CHECK and index drift each remain fail-closed', () => {
  for (const [label, options, pattern] of [
    ['primary key', { primaryKey: false }, /primary key drifted/],
    ['foreign key', { customerTarget: 'users' }, /customer_id foreign key drifted/],
    ['CHECK', { checks: 2 }, /CHECK set drifted/],
  ]) {
    const target = malformedWave9ProfileDatabase(options);
    try {
      assert.throws(() => migrateSalesCustomerWave9CreditFoundation(target), pattern, label);
    } finally {
      target.close();
    }
  }
  const indexTarget = wave9OnlyDatabase();
  try {
    indexTarget.exec('DROP INDEX ix_credit_profile_customer_scope');
    indexTarget.exec('CREATE INDEX ix_credit_profile_customer_scope ON credit_profile(customer_id,effective_from)');
    assert.throws(
      () => migrateSalesCustomerWave9CreditFoundation(indexTarget),
      /ix_credit_profile_customer_scope columns drifted/,
    );
  } finally {
    indexTarget.close();
  }
});

test('M09 SQLite reopen and repeated canonical replay preserve complete V2 and close cleanly', () => {
  const replayHandle = createTempDb({ label: 'w11a-u3-wave9-reopen', production: true });
  const path = replayHandle.dbPath;
  try {
    replayHandle.close();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reopened = createDatabase(path);
      try {
        assert.deepEqual(profileColumns(reopened), [...WAVE9_PROFILE_BASE_COLUMNS, ...WAVE9_PROFILE_SEARCH_SUFFIX]);
        const verification = verifySelectorSearchKeys(reopened);
        assert.equal(verification.missing, 0);
        assert.equal(verification.stale, 0);
        assert.equal(reopened.prepare("SELECT COUNT(*) count FROM credit_lock_anchors WHERE anchor_key='POLICY_SCOPE|GLOBAL|GLOBAL'").get().count, 1);
      } finally {
        reopened.close();
      }
    }
  } finally {
    replayHandle.cleanup();
  }
});

test('M11 an interrupted backfill retries to a clean verified V2 state', () => {
  db.prepare("UPDATE customers SET name_search_key=NULL WHERE id='cus-w11-self'").run();
  db.prepare('UPDATE credit_profile SET credit_object_id_search_key=NULL WHERE id=(SELECT id FROM credit_profile LIMIT 1)').run();
  const migrated = migrateW11ASelectorSearchKey(db);
  assert.ok(migrated.backfilled >= 2);
  const verification = verifySelectorSearchKeys(db);
  assert.equal(verification.missing, 0);
  assert.equal(verification.stale, 0);
});

test('M12 illegal SQLite Search Key type, nullability or collation fails before backfill', () => {
  const invalidDefinitions = [
    ['type', 'BLOB COLLATE BINARY'],
    ['nullability', "TEXT COLLATE BINARY NOT NULL DEFAULT ''"],
    ['collation', 'TEXT COLLATE NOCASE'],
  ];
  for (const [label, definition] of invalidDefinitions) {
    const invalidHandle = createTempDb({ label: `w11a-u3-invalid-${label}`, production: true });
    try {
      invalidHandle.db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_id_search_key');
      invalidHandle.db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_type_search_key');
      invalidHandle.db.exec(`ALTER TABLE credit_profile ADD COLUMN credit_object_type_search_key ${definition}`);
      invalidHandle.db.exec('ALTER TABLE credit_profile ADD COLUMN credit_object_id_search_key TEXT COLLATE BINARY');
      assert.throws(
        () => migrateW11ASelectorSearchKey(invalidHandle.db),
        /credit_profile\.credit_object_type_search_key physical definition invalid/,
        label,
      );
    } finally {
      invalidHandle.cleanup();
    }
  }
});

test('SE-MIG-01 the fresh SQLite database carries the four derived columns', () => {
  const customers = db.prepare('PRAGMA table_info(customers)').all()
    .filter((row) => row.name.endsWith('_search_key')).map((row) => row.name);
  assert.deepEqual(customers.sort(), ['code_search_key', 'name_search_key']);
  const profiles = db.prepare('PRAGMA table_info(credit_profile)').all()
    .filter((row) => row.name.endsWith('_search_key')).map((row) => row.name);
  assert.deepEqual(profiles.sort(), ['credit_object_id_search_key', 'credit_object_type_search_key']);
});

test('SE-MIG-02 the additive upgrade of an existing SQLite database backfills the stored rows', () => {
  db.exec('ALTER TABLE customers DROP COLUMN code_search_key');
  db.exec('ALTER TABLE customers DROP COLUMN name_search_key');
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_type_search_key');
  db.exec('ALTER TABLE credit_profile DROP COLUMN credit_object_id_search_key');
  const seeded = db.prepare("SELECT code,name FROM customers WHERE id='cus-w11-self'").get();
  const result = migrateW11ASelectorSearchKey(db);
  assert.ok(result.added.length >= 4);
  assert.ok(result.backfilled >= 1);
  const after = db.prepare("SELECT code,name,code_search_key,name_search_key FROM customers WHERE id='cus-w11-self'").get();
  assert.equal(after.code_search_key, foldSearchText(seeded.code));
  assert.equal(after.name_search_key, foldSearchText(seeded.name));
  const verification = verifySelectorSearchKeys(db);
  assert.equal(verification.missing, 0);
  assert.equal(verification.stale, 0);
});

test('SE-MIG-03 the migration is idempotent and a re-run converges', () => {
  const first = migrateW11ASelectorSearchKey(db);
  const second = migrateW11ASelectorSearchKey(db);
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.collationFixed, []);
  assert.equal(second.backfilled, 0, 'a healthy database is never rewritten');
  assert.equal(second.verified, first.verified);
});

test('SE-MIG-04 an interrupted backfill is repaired by the retry', () => {
  db.prepare("UPDATE customers SET name_search_key=NULL WHERE id='cus-w11-self'").run();
  db.prepare("UPDATE credit_profile SET credit_object_id_search_key=NULL WHERE id=(SELECT id FROM credit_profile LIMIT 1)").run();
  const before = databaseDigest(db);
  const repaired = migrateW11ASelectorSearchKey(db);
  assert.ok(repaired.backfilled >= 2);
  const verification = verifySelectorSearchKeys(db);
  assert.equal(verification.missing, 0);
  assert.equal(verification.stale, 0);
  assert.notEqual(databaseDigest(db), before, 'the repair must be a real write');
});

test('SE-MIG-05 a stale key is reconciled, never silently accepted', () => {
  db.prepare("UPDATE customers SET name_search_key='STALE' WHERE id='cus-w11-self'").run();
  const detected = verifySelectorSearchKeys(db);
  assert.equal(detected.stale, 1);
  const reconciled = backfillSelectorSearchKeys(db);
  assert.ok(reconciled.updated >= 1);
  const after = verifySelectorSearchKeys(db);
  assert.equal(after.stale, 0);
  assert.equal(after.missing, 0);
});

test('SE-MIG-06 the migration fails closed when a target table is missing', () => {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DROP TABLE credit_profile');
  assert.throws(
    () => migrateW11ASelectorSearchKey(db),
    /credit_profile/,
    'the migration must not swallow a missing table',
  );
});

test('SE-MIG-07 the customer backfill repairs a customer whose key was cleared', async () => {
  const created = await invoke(createCustomer, db, { code: 'CUS-BACKFILL', name: 'Backfill Co' }, CUSTOMER_ADMIN, 'se-backfill');
  assert.equal(created.statusCode, 201);
  const row = db.prepare('SELECT code,name,code_search_key,name_search_key FROM customers WHERE id=?').get(created.body.id);
  assert.equal(row.code_search_key, foldSearchText(row.code));
  db.prepare('UPDATE customers SET code_search_key=NULL,name_search_key=NULL WHERE id=?').run(created.body.id);
  const repaired = backfillSelectorSearchKeys(db);
  assert.ok(repaired.updated >= 1);
  const after = db.prepare('SELECT code_search_key,name_search_key FROM customers WHERE id=?').get(created.body.id);
  assert.equal(after.code_search_key, foldSearchText(row.code));
  assert.equal(after.name_search_key, foldSearchText(row.name));
});

test('SE-MIG-08 the Credit Profile backfill repairs a profile whose key was cleared', async () => {
  const created = await invoke(createCreditProfile, db, {
    customerId: 'cus-w11-self', creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId: 'CREDIT-BACKFILL-OBJECT',
    creditLimitCents: 100000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
    overdueDayPolicy: '15', effectiveFrom: PROFILE_FROM,
  }, CUSTOMER_ADMIN, 'se-profile-backfill');
  assert.equal(created.statusCode, 201);
  const row = db.prepare('SELECT credit_object_type,credit_object_id,credit_object_type_search_key,credit_object_id_search_key FROM credit_profile WHERE id=?')
    .get(created.body.profile.id);
  assert.equal(row.credit_object_type_search_key, foldSearchText(row.credit_object_type));
  assert.equal(row.credit_object_id_search_key, foldSearchText(row.credit_object_id));
  db.prepare('UPDATE credit_profile SET credit_object_type_search_key=NULL,credit_object_id_search_key=NULL WHERE id=?')
    .run(created.body.profile.id);
  const repaired = backfillSelectorSearchKeys(db);
  assert.ok(repaired.updated >= 1);
  const after = db.prepare('SELECT credit_object_type_search_key,credit_object_id_search_key FROM credit_profile WHERE id=?')
    .get(created.body.profile.id);
  assert.equal(after.credit_object_type_search_key, foldSearchText(row.credit_object_type));
  assert.equal(after.credit_object_id_search_key, foldSearchText(row.credit_object_id));
});

// ---------------------------------------------------------------------------
// The four production write paths.
// ---------------------------------------------------------------------------

test('SE-WRITER-01 the customer API writes the derived keys on create and on update', async () => {
  const created = await invoke(createCustomer, db, { code: 'CUS-WRITER', name: 'Writer Co' }, CUSTOMER_ADMIN, 'se-writer');
  assert.equal(created.statusCode, 201);
  const row = db.prepare('SELECT code,name,code_search_key,name_search_key FROM customers WHERE id=?').get(created.body.id);
  assert.equal(row.code_search_key, foldSearchText(row.code));
  assert.equal(row.name_search_key, foldSearchText(row.name));
  // An update that changes the code or the name recomputes the keys in the
  // same statement, so no stale key can survive.
  const updated = await invokeWithId(
    updateCustomer, db, { code: 'CUS-WRITER-RENAMED', name: 'Writer Renamed Co' }, CUSTOMER_ADMIN, created.body.id, 'se-writer-update',
  );
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  const after = db.prepare('SELECT code,name,code_search_key,name_search_key FROM customers WHERE id=?').get(created.body.id);
  assert.equal(after.code, 'CUS-WRITER-RENAMED');
  assert.equal(after.code_search_key, foldSearchText(after.code));
  assert.equal(after.name_search_key, foldSearchText(after.name));
});

test('SE-WRITER-02 the Credit Profile writer writes the derived Credit Object keys', async () => {
  const created = await invoke(createCreditProfile, db, {
    customerId: 'cus-w11-self', creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId: 'CREDIT-WRITER-OBJECT',
    creditLimitCents: 100000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
    overdueDayPolicy: '15', effectiveFrom: PROFILE_FROM,
  }, CUSTOMER_ADMIN, 'se-writer-profile');
  assert.equal(created.statusCode, 201);
  const row = db.prepare('SELECT credit_object_type,credit_object_id,credit_object_type_search_key,credit_object_id_search_key FROM credit_profile WHERE id=?')
    .get(created.body.profile.id);
  assert.equal(row.credit_object_type_search_key, foldSearchText(row.credit_object_type));
  assert.equal(row.credit_object_id_search_key, foldSearchText(row.credit_object_id));
});

test('SE-WRITER-03 the demo seed carries the derived keys', () => {
  const seededHandle = createTempDb({ label: 'w11a-u3-search-demo-seed' });
  try {
    const row = seededHandle.db.prepare("SELECT code,name,code_search_key,name_search_key FROM customers WHERE id='customer-001'").get();
    assert.ok(row, 'the demo seed customer must exist');
    assert.equal(row.code_search_key, foldSearchText(row.code));
    assert.equal(row.name_search_key, foldSearchText(row.name));
  } finally {
    seededHandle.cleanup();
  }
});

test('SE-WRITER-04 the customer CSV import writes the derived keys of a committed row', async () => {
  const staged = stageCsvImport(db, {
    idempotencyKey: 'se-csv-import',
    entityType: 'customers',
    actorId: ADMIN.id,
    csv: 'code,name\nCUS-CSV,CSV Import Co\n',
  });
  const validated = validateImport(db, staged.id);
  assert.equal(validated.valid, true);
  const committed = commitImport(db, staged.id);
  assert.equal(committed.status, 'COMMITTED');
  const row = db.prepare("SELECT id,code,name,code_search_key,name_search_key FROM customers WHERE code='CUS-CSV'").get();
  assert.ok(row, 'the committed import row must exist');
  assert.equal(row.code_search_key, foldSearchText(row.code));
  assert.equal(row.name_search_key, foldSearchText(row.name));
  // The Selector only projects a customer that owns a Credit Profile, so the
  // imported customer becomes searchable once it owns one.
  const profile = await invoke(createCreditProfile, db, {
    customerId: row.id, creditObjectType: CREDIT_OBJECT_TYPE, creditObjectId: 'CREDIT-CUS-CSV',
    creditLimitCents: 100000, initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A',
    overdueDayPolicy: '15', effectiveFrom: PROFILE_FROM,
  }, CUSTOMER_ADMIN, 'se-csv-profile');
  assert.equal(profile.statusCode, 201);
  const found = await options(ADMIN, { q: 'csv import', limit: 100 });
  assert.deepEqual(codes(found), ['CUS-CSV']);
});
