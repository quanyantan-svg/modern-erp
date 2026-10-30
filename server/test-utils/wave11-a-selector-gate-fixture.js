// W11-A U3 Selector MySQL Gate fixture.
//
// Requirement : document.md R-U3-GATE-01, R-U3-GATE-03, R-U3-GATE-04
// Design      : solution.md §37.54.36.3, §37.54.36.5
//
// The gate needs business identities that the shared W11-SEC world does not
// contain: a mixed-case customer code, an accented and a non-ASCII capital
// customer name, two Credit Objects on one customer, two customers that share
// one display name, a Profile whose sub-limit version is effective only before
// a historical date, a customer that owns only a sub-limit scope, and a
// customer whose effective version can be made ambiguous.
//
// The shared world is reused exactly as it is, so the frozen W11-A U2 E3 suite
// keeps its own data. Every Credit Profile is created through the production
// writer. The single direct insert is the ambiguous effective version, because
// the production writer deliberately refuses to create an overlapping version;
// it exists to prove that the READER fails closed, and the caller removes it
// again in the same test.

import assert from 'node:assert/strict';

import { foldSearchText } from '../lib/search-fold.js';
import { createCreditProfile } from '../modules/credit-profile.js';
import {
  ADMIN, CREDIT_OBJECT_TYPE, HISTORICAL, PROFILE_FROM, invoke, seedWorld,
} from './wave11-sec-scope-fixture.js';

export const CASE_CUSTOMER = 'cus-w11-case';
export const CASE_CODE = 'Cus-W11-Case';
export const CASE_NAME = 'Müller GmbH';

export const UNICODE_CUSTOMER = 'cus-w11-unicode';
export const UNICODE_CODE = 'CUS-W11-UNICODE';
export const UNICODE_NAME = 'Ångström AB';

export const PERCENT_CUSTOMER = 'cus-w11-percent';
export const PERCENT_CODE = 'CUS-W11-PERCENT';
export const PERCENT_NAME = 'Fifty % Discount Co';

export const UNDERSCORE_CUSTOMER = 'cus-w11-underscore';
export const UNDERSCORE_CODE = 'CUS-W11-UNDERSCORE';
export const UNDERSCORE_NAME = 'Under_Score Co';

export const BACKSLASH_CUSTOMER = 'cus-w11-backslash';
export const BACKSLASH_CODE = 'CUS-W11-BACKSLASH';
export const BACKSLASH_NAME = 'Back\\Slash Co';

export const MULTI_CUSTOMER = 'cus-w11-multi';
export const MULTI_CODE = 'CUS-W11-MULTI';
export const MULTI_OBJECTS = Object.freeze(['CREDIT-CUS-W11-MULTI-A', 'CREDIT-CUS-W11-MULTI-B']);

export const DUPLICATE_CUSTOMERS = Object.freeze([
  Object.freeze({ id: 'cus-w11-dup-a', code: 'CUS-W11-DUP-A' }),
  Object.freeze({ id: 'cus-w11-dup-b', code: 'CUS-W11-DUP-B' }),
]);
export const DUPLICATE_NAME = 'Shared Display Name';

export const WINDOW_CUSTOMER = 'cus-w11-window';
export const WINDOW_CODE = 'CUS-W11-WINDOW';
export const WINDOW_OBJECT = 'CREDIT-CUS-W11-WINDOW';
// The sub-limit version of the window customer ends on the historical date, so
// the DTO proves which effective version a business date selects.
export const WINDOW_SUB_LIMIT_END = HISTORICAL;

export const SUB_LIMIT_ONLY_CUSTOMER = 'cus-w11-subonly';
export const SUB_LIMIT_ONLY_CODE = 'CUS-W11-SUBONLY';
export const SUB_LIMIT_ONLY_OBJECT = 'CREDIT-CUS-W11-SUBONLY';

export const AMBIGUOUS_CUSTOMER = 'cus-w11-ambig';
export const AMBIGUOUS_CODE = 'CUS-W11-AMBIG';
export const AMBIGUOUS_OBJECT = 'CREDIT-CUS-W11-AMBIG';
export const AMBIGUOUS_ROW_ID = 'u3-selector-ambiguous';

const AGGREGATE_SCOPE = Object.freeze(['CUSTOMER_AGGREGATE']);
const SUB_LIMIT_SCOPE = Object.freeze(['SALESPERSON_SUB_LIMIT']);
const BOTH_SCOPES = Object.freeze(['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']);

export function selectorOptionKey(customerId, creditObjectType, creditObjectId) {
  return `${customerId}:${creditObjectType}:${creditObjectId}`;
}

const SHARED_ENTRIES = Object.freeze([
  Object.freeze({ customerId: 'cus-w11-self', creditObjectId: 'CREDIT-CUS-W11-SELF' }),
  Object.freeze({ customerId: 'cus-w11-other', creditObjectId: 'CREDIT-CUS-W11-OTHER' }),
  Object.freeze({ customerId: 'cus-w11-expired', creditObjectId: 'CREDIT-CUS-W11-EXPIRED' }),
  Object.freeze({ customerId: 'cus-w11-future', creditObjectId: 'CREDIT-CUS-W11-FUTURE' }),
]);

const ADDED_ENTRIES = Object.freeze([
  Object.freeze({ customerId: CASE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-CASE' }),
  Object.freeze({ customerId: UNICODE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-UNICODE' }),
  Object.freeze({ customerId: PERCENT_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-PERCENT' }),
  Object.freeze({ customerId: UNDERSCORE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-UNDERSCORE' }),
  Object.freeze({ customerId: BACKSLASH_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-BACKSLASH' }),
  Object.freeze({ customerId: MULTI_CUSTOMER, creditObjectId: MULTI_OBJECTS[0] }),
  Object.freeze({ customerId: MULTI_CUSTOMER, creditObjectId: MULTI_OBJECTS[1] }),
  Object.freeze({ customerId: DUPLICATE_CUSTOMERS[0].id, creditObjectId: 'CREDIT-CUS-W11-DUP-A' }),
  Object.freeze({ customerId: DUPLICATE_CUSTOMERS[1].id, creditObjectId: 'CREDIT-CUS-W11-DUP-B' }),
  Object.freeze({ customerId: WINDOW_CUSTOMER, creditObjectId: WINDOW_OBJECT }),
  Object.freeze({ customerId: AMBIGUOUS_CUSTOMER, creditObjectId: AMBIGUOUS_OBJECT }),
]);

const SUB_LIMIT_ONLY_ENTRY = Object.freeze({
  customerId: SUB_LIMIT_ONLY_CUSTOMER,
  creditObjectId: SUB_LIMIT_ONLY_OBJECT,
});

// The customers whose code is uppercase ASCII. Their relative order is defined
// by the same collation on both engines, so the cross-engine order assertion
// is made over exactly this set. The mixed-case customer is deliberately not
// part of it.
const COLLATION_UNAMBIGUOUS_CUSTOMERS = Object.freeze([
  'cus-w11-self', 'cus-w11-other', 'cus-w11-expired', 'cus-w11-future',
  'cus-w11-unicode', 'cus-w11-multi', 'cus-w11-dup-a', 'cus-w11-dup-b',
  'cus-w11-window', 'cus-w11-subonly', 'cus-w11-ambig',
]);

export const COLLATION_UNAMBIGUOUS_OPTION_KEYS = Object.freeze([
  ...SHARED_ENTRIES, ...ADDED_ENTRIES, SUB_LIMIT_ONLY_ENTRY,
].filter((entry) => COLLATION_UNAMBIGUOUS_CUSTOMERS.includes(entry.customerId))
  .map((entry) => selectorOptionKey(entry.customerId, CREDIT_OBJECT_TYPE, entry.creditObjectId)));

function buildExpectation(entries, scopeTypesFor) {
  return Object.fromEntries(entries.map((entry) => [
    selectorOptionKey(entry.customerId, CREDIT_OBJECT_TYPE, entry.creditObjectId),
    scopeTypesFor(entry.customerId),
  ]));
}

// The expected logical option set per actor. It is the single source of truth
// for both engines; the gate never derives an expectation from an engine
// result.
export function expectedSelectorOptions() {
  const all = [...SHARED_ENTRIES, ...ADDED_ENTRIES, SUB_LIMIT_ONLY_ENTRY];
  const selfVisible = [...SHARED_ENTRIES, ...ADDED_ENTRIES];
  const allScopes = (customerId) => {
    if (customerId === SUB_LIMIT_ONLY_CUSTOMER) return SUB_LIMIT_SCOPE;
    if (SHARED_ENTRIES.some((entry) => entry.customerId === customerId)) return BOTH_SCOPES;
    return AGGREGATE_SCOPE;
  };
  return Object.freeze({
    'w11-admin': buildExpectation(all, allScopes),
    'w11-cross': buildExpectation(all, allScopes),
    // sp-self owns the sub-limit of cus-w11-self and of the window customer.
    'w11-self': buildExpectation(selfVisible, (customerId) => (
      customerId === 'cus-w11-self' ? BOTH_SCOPES : AGGREGATE_SCOPE)),
    // sp-other owns the sub-limit of cus-w11-other and of the sub-limit-only
    // customer, so that customer is visible to this reader alone.
    'w11-other': buildExpectation([...selfVisible, SUB_LIMIT_ONLY_ENTRY], (customerId) => {
      if (customerId === 'cus-w11-other') return BOTH_SCOPES;
      if (customerId === SUB_LIMIT_ONLY_CUSTOMER) return SUB_LIMIT_SCOPE;
      return AGGREGATE_SCOPE;
    }),
    'w11-unmapped': buildExpectation(selfVisible, () => AGGREGATE_SCOPE),
    'w11-expired': buildExpectation(selfVisible, () => AGGREGATE_SCOPE),
    'w11-future': buildExpectation(selfVisible, () => AGGREGATE_SCOPE),
  });
}

export const SHARED_OPTION_KEYS = Object.freeze(SHARED_ENTRIES.map((entry) => (
  selectorOptionKey(entry.customerId, CREDIT_OBJECT_TYPE, entry.creditObjectId))));


export async function seedSelectorGateWorld(db) {
  await seedWorld(db);
  const stamp = new Date().toISOString();

  const insertCustomer = (id, code, name) => {
    // The derived search keys are written with the customer, exactly like the
    // production customer writer does, so the gate can search these rows.
    db.prepare(`INSERT INTO customers(id,code,name,code_search_key,name_search_key,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,?,?,'','','',1,?,?)`).run(id, code, name, foldSearchText(code), foldSearchText(name), stamp, stamp);
  };
  insertCustomer(CASE_CUSTOMER, CASE_CODE, CASE_NAME);
  insertCustomer(UNICODE_CUSTOMER, UNICODE_CODE, UNICODE_NAME);
  insertCustomer(PERCENT_CUSTOMER, PERCENT_CODE, PERCENT_NAME);
  insertCustomer(UNDERSCORE_CUSTOMER, UNDERSCORE_CODE, UNDERSCORE_NAME);
  insertCustomer(BACKSLASH_CUSTOMER, BACKSLASH_CODE, BACKSLASH_NAME);
  insertCustomer(MULTI_CUSTOMER, MULTI_CODE, 'Multi Object Customer');
  for (const duplicate of DUPLICATE_CUSTOMERS) insertCustomer(duplicate.id, duplicate.code, DUPLICATE_NAME);
  insertCustomer(WINDOW_CUSTOMER, WINDOW_CODE, 'Date Window Customer');
  insertCustomer(SUB_LIMIT_ONLY_CUSTOMER, SUB_LIMIT_ONLY_CODE, 'Sub Limit Only Customer');
  insertCustomer(AMBIGUOUS_CUSTOMER, AMBIGUOUS_CODE, 'Ambiguous Version Customer');

  const createProfile = async ({
    customerId, creditObjectId, salespersonId = null, effectiveFrom = PROFILE_FROM, effectiveTo = null,
  }) => {
    const key = `u3-selector|${customerId}|${creditObjectId}|${salespersonId || 'aggregate'}|${effectiveFrom}`;
    const result = await invoke(createCreditProfile, db, {
      customerId,
      salespersonId,
      creditObjectType: CREDIT_OBJECT_TYPE,
      creditObjectId,
      creditLimitCents: 100000,
      initialState: 'NORMAL',
      status: 'ACTIVE',
      ratingGrade: 'A',
      overdueDayPolicy: '15',
      effectiveFrom,
      effectiveTo,
    }, ADMIN, key);
    assert.equal(result.statusCode, 201, JSON.stringify(result.body));
    return result.body.profile;
  };

  await createProfile({ customerId: CASE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-CASE' });
  await createProfile({ customerId: UNICODE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-UNICODE' });
  await createProfile({ customerId: PERCENT_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-PERCENT' });
  await createProfile({ customerId: UNDERSCORE_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-UNDERSCORE' });
  await createProfile({ customerId: BACKSLASH_CUSTOMER, creditObjectId: 'CREDIT-CUS-W11-BACKSLASH' });
  await createProfile({ customerId: MULTI_CUSTOMER, creditObjectId: MULTI_OBJECTS[0] });
  await createProfile({ customerId: MULTI_CUSTOMER, creditObjectId: MULTI_OBJECTS[1] });
  await createProfile({ customerId: DUPLICATE_CUSTOMERS[0].id, creditObjectId: 'CREDIT-CUS-W11-DUP-A' });
  await createProfile({ customerId: DUPLICATE_CUSTOMERS[1].id, creditObjectId: 'CREDIT-CUS-W11-DUP-B' });
  await createProfile({ customerId: WINDOW_CUSTOMER, creditObjectId: WINDOW_OBJECT });
  await createProfile({
    customerId: WINDOW_CUSTOMER,
    creditObjectId: WINDOW_OBJECT,
    salespersonId: 'sp-self',
    effectiveTo: WINDOW_SUB_LIMIT_END,
  });
  await createProfile({
    customerId: SUB_LIMIT_ONLY_CUSTOMER,
    creditObjectId: SUB_LIMIT_ONLY_OBJECT,
    salespersonId: 'sp-other',
  });
  await createProfile({ customerId: AMBIGUOUS_CUSTOMER, creditObjectId: AMBIGUOUS_OBJECT });

  return Object.freeze({
    customers: Object.freeze([
      CASE_CUSTOMER, UNICODE_CUSTOMER, PERCENT_CUSTOMER, UNDERSCORE_CUSTOMER, BACKSLASH_CUSTOMER,
      MULTI_CUSTOMER, DUPLICATE_CUSTOMERS[0].id, DUPLICATE_CUSTOMERS[1].id,
      WINDOW_CUSTOMER, SUB_LIMIT_ONLY_CUSTOMER, AMBIGUOUS_CUSTOMER,
    ]),
    expectedOptions: expectedSelectorOptions(),
  });
}

// The production writer refuses an overlapping version, so the ambiguous state
// can only be produced by an explicit insert. The caller removes it again.
export function insertAmbiguousEffectiveVersion(db, { effectiveFrom = HISTORICAL } = {}) {
  const base = db.prepare(`SELECT * FROM credit_profile
    WHERE customer_id=? AND credit_object_type=? AND credit_object_id=? AND salesperson_scope_key='*'
    LIMIT 1`).get(AMBIGUOUS_CUSTOMER, CREDIT_OBJECT_TYPE, AMBIGUOUS_OBJECT);
  assert.ok(base, 'the ambiguous fixture needs its base aggregate version');
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
      credit_object_type,credit_object_id,credit_limit_cents,initial_state,status,rating_grade,
      rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,effective_from,effective_to,
      created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    AMBIGUOUS_ROW_ID, base.anchor_id, base.customer_id, base.salesperson_scope_key, base.salesperson_id,
    base.credit_object_type, base.credit_object_id, base.credit_limit_cents, base.initial_state, base.status,
    base.rating_grade, base.rating_effective_from, base.rating_effective_to, base.overdue_day_policy,
    base.rule_id, effectiveFrom, base.effective_to, new Date().toISOString(), ADMIN.id,
  );
  return AMBIGUOUS_ROW_ID;
}

export function removeAmbiguousEffectiveVersion(db) {
  db.prepare('DELETE FROM credit_profile WHERE id=?').run(AMBIGUOUS_ROW_ID);
}

// The read-only MySQL metadata probe. It never writes, it never changes a
// session variable and it never changes the schema or a collation.
export function readMySqlCollationFacts(db) {
  if (db.dialect !== 'mysql') return null;
  const session = db.prepare(`SELECT @@max_sort_length AS max_sort_length,
      @@collation_server AS collation_server, @@collation_connection AS collation_connection,
      @@sql_mode AS sql_mode, @@version AS server_version`).get();
  const collation = db.prepare(`SELECT COLLATION_NAME collation_name, PAD_ATTRIBUTE pad_attribute,
      IS_COMPILED is_compiled FROM information_schema.collations WHERE COLLATION_NAME=?`)
    .get('utf8mb4_0900_ai_ci');
  const columns = db.prepare(`SELECT COLUMN_NAME column_name, DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH character_maximum_length, COLLATION_NAME collation_name
    FROM information_schema.columns
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_profile'
      AND COLUMN_NAME IN ('customer_id','salesperson_scope_key','credit_object_type','credit_object_id','effective_from','effective_to')
    ORDER BY COLUMN_NAME`).all();
  const observed = db.prepare(`SELECT MAX(LENGTH(credit_object_type)) max_bytes,
      MAX(CHAR_LENGTH(credit_object_type)) max_chars, COUNT(*) row_count FROM credit_profile`).get();
  return { session, collation, columns, observed };
}
