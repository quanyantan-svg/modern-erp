// W11-A U3-A/U3-B local contract suite.
// U3-A cases exercise the real SQLite schema and canonical Credit read scope.
// U3-B cases are appended only after the U3-A checkpoint passes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';

import { createApp } from './app.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  ADMIN,
  CROSS_READER,
  CREDIT_OBJECT_TYPE,
  EXPIRED_ACTOR,
  HISTORICAL,
  NO_CREDIT,
  PROFILE_FROM,
  SELF_ACTOR,
  TODAY,
  UNMAPPED_ACTOR,
  read,
  seedWorld,
} from './test-utils/wave11-sec-scope-fixture.js';
import { databaseDigest } from './test-utils/wave11-a-credit-query-fixture.js';
import { listCreditQueryOptions } from './modules/credit-query-options.js';
import { foldSearchText } from './lib/search-fold.js';
import {
  APPLICATION_LAUNCHER_GROUPS,
  applicationRouteFor,
  userCanAccessRoute,
} from '../src/navigation/applicationRegistry.js';
import { parseRouteLocation, serializeRouteLocation } from '../src/navigation/routeLocation.js';

let handle;
let db;

beforeEach(async () => {
  handle = createTempDb({ label: 'w11a-u3-query-options', production: true });
  db = handle.db;
  await seedWorld(db);
});

afterEach(() => handle?.cleanup());

const options = (actor, params = {}) => read(listCreditQueryOptions, db, actor, params);
const identity = (customerId) => ({
  customerId,
  creditObjectType: CREDIT_OBJECT_TYPE,
  creditObjectId: `CREDIT-${customerId.toUpperCase()}`,
});

test('U3-A CREDIT_VIEW-only gets the minimal aggregate+self projection without customer permissions', async () => {
  assert.deepEqual(SELF_ACTOR.permissions, ['CREDIT_VIEW']);
  const result = await options(SELF_ACTOR, { businessDate: TODAY });
  assert.equal(result.statusCode, 200);
  const own = result.body.options.find((row) => row.customerId === 'cus-w11-self');
  assert.deepEqual(own.availableScopeTypes, ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']);
  assert.deepEqual(Object.keys(own).sort(), [
    'availableScopeTypes', 'creditObjectId', 'creditObjectType', 'customerActive',
    'customerCode', 'customerId', 'customerName',
  ]);
  assert.equal(result.body.options.some((row) => row.customerId === 'cus-w11-other'), true,
    'aggregate rows remain visible without leaking the other salesperson sub-limit');
  assert.equal(JSON.stringify(result.body).includes('creditLimitCents'), false);
  assert.equal(JSON.stringify(result.body).includes('contact'), false);
});

test('U3-A five-level scope projection is fail-closed and derives scope types only from authorized rows', async () => {
  const admin = await options(ADMIN, { businessDate: TODAY });
  const cross = await options(CROSS_READER, { businessDate: TODAY });
  const self = await options(SELF_ACTOR, { businessDate: TODAY });
  const aggregateOnly = await options(UNMAPPED_ACTOR, { businessDate: TODAY });
  const denied = await options(NO_CREDIT, { businessDate: TODAY });

  assert.equal(admin.statusCode, 200);
  assert.deepEqual(cross.body, admin.body);
  assert.equal(self.body.options.find((row) => row.customerId === 'cus-w11-other')
    .availableScopeTypes.includes('SALESPERSON_SUB_LIMIT'), false);
  assert.ok(aggregateOnly.body.options.every((row) => (
    row.availableScopeTypes.length === 1 && row.availableScopeTypes[0] === 'CUSTOMER_AGGREGATE'
  )));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
});

test('U3-A revoked self membership is not restored by a historical business date', async () => {
  const historical = await options(EXPIRED_ACTOR, { businessDate: HISTORICAL, ...identity('cus-w11-expired') });
  assert.equal(historical.statusCode, 200);
  assert.equal(historical.body.options.length, 1);
  assert.deepEqual(historical.body.options[0].availableScopeTypes, ['CUSTOMER_AGGREGATE']);
});

test('U3-A effective-date semantics match SC101 across historical versions and status values', async () => {
  const now = new Date().toISOString();
  const current = db.prepare("SELECT * FROM credit_profile WHERE customer_id='cus-w11-self' AND salesperson_scope_key='*'").get();
  db.prepare('UPDATE credit_profile SET effective_to=? WHERE id=?').run(TODAY, current.id);
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
      credit_object_type,credit_object_id,credit_object_type_search_key,credit_object_id_search_key,
      credit_limit_cents,initial_state,status,rating_grade,
      rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,effective_from,effective_to,
      created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'u3-version-future', current.anchor_id, current.customer_id, '*', null,
    current.credit_object_type, current.credit_object_id,
    foldSearchText(current.credit_object_type), foldSearchText(current.credit_object_id), current.credit_limit_cents,
    current.initial_state, 'SUSPENDED', current.rating_grade, TODAY, null,
    current.overdue_day_policy, current.rule_id, '2999-01-01', null, now, ADMIN.id,
  );

  const historical = await options(ADMIN, { businessDate: HISTORICAL, ...identity('cus-w11-self') });
  const today = await options(ADMIN, { businessDate: TODAY, ...identity('cus-w11-self') });
  const future = await options(ADMIN, { businessDate: '2999-01-01', ...identity('cus-w11-self') });
  assert.equal(historical.body.options.length, 1);
  assert.equal(today.body.options.length, 1);
  assert.equal(future.body.options.length, 1, 'SUSPENDED remains effective because frozen SC101 has no status filter');
});

test('U3-A supports multiple Credit Objects and deduplicates aggregate/sub-limit versions into logical options', async () => {
  const base = db.prepare("SELECT * FROM credit_profile WHERE customer_id='cus-w11-self' AND salesperson_scope_key='*'").get();
  const now = new Date().toISOString();
  for (const [id, anchorId, scopeKey, salespersonId] of [
    ['u3-obj-agg', 'u3-anchor-agg', '*', null],
    ['u3-obj-self', 'u3-anchor-self', 'sp-self', 'sp-self'],
  ]) {
    db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,
        credit_object_type,credit_object_id,policy_scope_type,policy_scope_id,created_at)
      VALUES(?,?,'CREDIT_OBJECT','cus-w11-self',?,'CONTRACT','CONTRACT-U3',NULL,NULL,?)`)
      .run(anchorId, `U3|${anchorId}`, salespersonId, now);
    db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
        credit_object_type,credit_object_id,credit_object_type_search_key,credit_object_id_search_key,
        credit_limit_cents,initial_state,status,rating_grade,
        rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,effective_from,effective_to,
        created_at,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, anchorId, base.customer_id, scopeKey, salespersonId, 'CONTRACT', 'CONTRACT-U3',
      foldSearchText('CONTRACT'), foldSearchText('CONTRACT-U3'),
      base.credit_limit_cents, base.initial_state, 'CLOSED', base.rating_grade, PROFILE_FROM, null,
      base.overdue_day_policy, base.rule_id, PROFILE_FROM, null, now, ADMIN.id,
    );
  }
  const result = await options(SELF_ACTOR, { businessDate: TODAY, customerId: 'cus-w11-self', creditObjectType: 'CONTRACT', creditObjectId: 'CONTRACT-U3' });
  assert.equal(result.body.total, 1);
  assert.equal(result.body.options.length, 1);
  assert.deepEqual(result.body.options[0].availableScopeTypes, ['CUSTOMER_AGGREGATE', 'SALESPERSON_SUB_LIMIT']);
});

test('U3-A customer search, logical COUNT and stable pagination share the authorized set', async () => {
  // A rename maintains the derived search keys in the same statement, exactly
  // like the production customer writer does.
  db.prepare("UPDATE customers SET code='ALPHA-U3',name='Alpha 客户',code_search_key=?,name_search_key=? WHERE id='cus-w11-self'")
    .run(foldSearchText('ALPHA-U3'), foldSearchText('Alpha 客户'));
  const search = await options(SELF_ACTOR, { businessDate: TODAY, q: 'Alpha' });
  assert.equal(search.body.total, 1);
  assert.equal(search.body.options[0].customerId, 'cus-w11-self');

  const all = await options(SELF_ACTOR, { businessDate: TODAY, limit: 100 });
  const seen = [];
  for (let offset = 0; offset < all.body.total; offset += 1) {
    const page = await options(SELF_ACTOR, { businessDate: TODAY, limit: 1, offset });
    assert.equal(page.body.total, all.body.total);
    seen.push(`${page.body.options[0].customerId}:${page.body.options[0].creditObjectType}:${page.body.options[0].creditObjectId}`);
  }
  assert.equal(new Set(seen).size, all.body.total);
});

test('U3-A exact unknown identity returns an empty non-enumerating page', async () => {
  const result = await options(SELF_ACTOR, { businessDate: TODAY, ...identity('missing-customer') });
  assert.deepEqual(result.body.options, []);
  assert.equal(result.body.total, 0);
});

test('U3-A refuses malformed input and ambiguous effective Profiles', async () => {
  for (const params of [
    { limit: '0' }, { limit: '101' }, { offset: '-1' }, { businessDate: '29-10-2026' },
    { customerId: 'cus-w11-self' }, { q: 'x'.repeat(101) },
  ]) {
    const result = await options(ADMIN, params);
    assert.equal(result.statusCode, 400, JSON.stringify(params));
  }

  const base = db.prepare("SELECT * FROM credit_profile WHERE customer_id='cus-w11-self' AND salesperson_scope_key='*'").get();
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,
      credit_object_type,credit_object_id,credit_object_type_search_key,credit_object_id_search_key,
      credit_limit_cents,initial_state,status,rating_grade,rating_effective_from,rating_effective_to,
      overdue_day_policy,rule_id,effective_from,effective_to,created_at,created_by)
    SELECT 'u3-ambiguous',anchor_id,customer_id,salesperson_scope_key,
      salesperson_id,credit_object_type,credit_object_id,credit_object_type_search_key,
      credit_object_id_search_key,credit_limit_cents,initial_state,status,rating_grade,
      rating_effective_from,rating_effective_to,overdue_day_policy,rule_id,?,effective_to,
      created_at,created_by FROM credit_profile WHERE id=?`).run(HISTORICAL, base.id);
  const ambiguous = await options(ADMIN, { businessDate: TODAY, ...identity('cus-w11-self') });
  assert.equal(ambiguous.statusCode, 409);
  assert.equal(ambiguous.code, 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS');
});

test('U3-A measured GETs are zero-write and the owner contains no write path', async () => {
  const before = databaseDigest(db);
  await options(SELF_ACTOR, { businessDate: TODAY, q: 'cus' });
  await options(ADMIN, { businessDate: HISTORICAL, limit: 2, offset: 1 });
  assert.equal(databaseDigest(db), before);

  const source = readFileSync(new URL('./modules/credit-query-options.js', import.meta.url), 'utf8');
  const executable = source.split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  assert.doesNotMatch(executable, /\b(?:transaction|audit|saveIdempotency)\s*\(/);
});

test('U3-B registry owns one CREDIT_VIEW-only contextual route, screen, launcher and detail target', () => {
  const route = applicationRouteFor('credit-query');
  assert.equal(route.enabled, true);
  assert.equal(route.domain, 'sales-customer');
  assert.equal(route.classification, 'CONTEXTUAL');
  assert.equal(route.parentRoute, 'customers');
  assert.deepEqual(route.access, { permission: 'CREDIT_VIEW' });
  assert.equal(route.screen.modulePath, '../pages/credit-query.jsx');
  assert.equal(route.screen.exportName, 'default');
  assert.equal(route.targetContract.pathParam, 'documentId');
  assert.equal(userCanAccessRoute({ permissions: ['CREDIT_VIEW'] }, route), true);
  assert.equal(userCanAccessRoute({ permissions: ['CUSTOMERS_VIEW'] }, route), false);
  assert.equal(userCanAccessRoute({ permissions: [] }, route), false);

  const sales = APPLICATION_LAUNCHER_GROUPS.find((group) => group.key === 'sales-customer');
  const tile = sales.items.find((item) => item.routeKey === 'credit-query');
  assert.equal(tile.label, '信用额度与例外');
  assert.equal(tile.group, 'sales-customer');
});

test('U3-B direct and deep links use canonical RouteLocation round-trip and reject illegal query authority', () => {
  const list = parseRouteLocation('#credit-query');
  assert.equal(list.routeKey, 'credit-query');
  assert.deepEqual(list.target, {});
  assert.equal(serializeRouteLocation(list), '#credit-query');

  const detail = parseRouteLocation('#credit-query/check%2Fresult%201');
  assert.equal(detail.routeKey, 'credit-query');
  assert.equal(detail.target.documentId, 'check/result 1');
  assert.equal(serializeRouteLocation(detail), '#credit-query/check%2Fresult%201');

  const tampered = parseRouteLocation('#credit-query?customerId=unauthorized');
  assert.equal(tampered.invalid, true);
  assert.equal(serializeRouteLocation(tampered), '#dashboard');
});

test('U3-B SC101 source uses only approved read APIs and renders aggregate/sub-limit facts and policy identity', () => {
  const source = readFileSync(new URL('../src/pages/credit-query.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/credit\/query-options\?/);
  assert.match(source, /\/api\/credit\/exposure\?/);
  assert.doesNotMatch(source, /\/api\/customers(?:[?'"`/]|$)/);
  assert.match(source, /CUSTOMER_AGGREGATE/);
  assert.match(source, /SALESPERSON_SUB_LIMIT/);
  for (const field of ['creditLimitCents', 'usedCents', 'remainingCents', 'overLimitCents', 'components', 'factCounts', 'computedPolicyIdentity']) {
    assert.ok(source.includes(field), `${field} must remain visible in SC101`);
  }
  assert.match(source, /业务日期/);
  assert.match(source, /信用检查阶段/);
  assert.match(source, /不设上限/);
});

test('U3-B SC102 source preserves five server categories, authorized pagination and neutral 404 detail', () => {
  const source = readFileSync(new URL('../src/pages/credit-query.jsx', import.meta.url), 'utf8');
  for (const category of ['OVER_LIMIT', 'OVERDUE', 'WARNING', 'BLOCK', 'SPECIAL_APPROVAL']) {
    assert.match(source, new RegExp(`['"]${category}['"]`));
  }
  for (const parameter of ['category', 'decision', 'scopeType', 'stage', 'businessDateFrom', 'businessDateTo', 'hasApproval', 'limit', 'offset']) {
    assert.ok(source.includes(parameter), `${parameter} server filter must remain wired`);
  }
  assert.match(source, /\/api\/credit\/exceptions\?/);
  assert.match(source, /\/api\/credit\/exceptions\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(source, /记录不存在或无权查看/);
  assert.match(source, /不会自动扩大授权范围/);
  assert.doesNotMatch(source, /\.filter\([^\n]*(?:category|decision|scopeType)/,
    'business filtering must not be replaced by client-side filtering');
});

test('U3-B historical-to-current flow resolves authorized Profile detail and never relabels historical amounts as live', () => {
  const source = readFileSync(new URL('../src/pages/credit-query.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/credit\/profiles\/\$\{encodeURIComponent\(row\.creditProfileId\)\}/);
  assert.match(source, /历史信用检查/);
  assert.match(source, /当前额度查询/);
  assert.match(source, /与历史记录严格分离/);
  assert.match(source, /按当前日期重新查询额度/);
  assert.match(source, /status === 'UNKNOWN'/);
  assert.match(source, /未知[^\n]*未取得完整历史证据/);
  assert.doesNotMatch(source, /recordedBreakdown\s*\.\s*(?:usedCents|remainingCents)/);
});

test('U3-B async and responsive contracts clear protected results, abort stale reads and cover target widths', () => {
  const source = readFileSync(new URL('../src/pages/credit-query.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /sequence\.current\[name\] \+= 1/);
  assert.match(source, /setExposure\(null\)/);
  assert.match(source, /setCurrentExposure\(null\)/);
  assert.match(source, /setDetailState\(\{ row: null, loading: true, error: '' \}\)/);
  assert.match(source, /按相同条件重试/);
  assert.match(source, /current\('(?:selector|exposure|history|detail|current)'/);
  assert.match(css, /\.credit-query\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*680px;[^}]*overflow-x:\s*clip;/s);
  assert.match(css, /@media \(max-width:\s*430px\)/);
  assert.match(css, /@media \(max-width:\s*340px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css.slice(css.indexOf('W11-A U3')), /linear-gradient|backdrop-filter|box-shadow/);
});

test('U3-C B06 HTTP adapter decodes one canonical identity layer and preserves scope-safe failures', async () => {
  db.prepare("UPDATE users SET role_id='role-sales' WHERE id IN ('w11-self','w11-other')").run();
  db.prepare("UPDATE users SET role_id='role-warehouse' WHERE id='w11-none'").run();

  // Preserve one actual historical row under the frozen CCHK1 grammar so the
  // HTTP boundary proves both persisted identity generations.
  const legacySource = db.prepare(`SELECT r.id FROM credit_check_results r
    JOIN credit_profile cp ON cp.id=r.credit_profile_id
    WHERE cp.customer_id='cus-w11-future' AND r.scope_type='CUSTOMER_AGGREGATE'
      AND NOT EXISTS (SELECT 1 FROM credit_special_approval a WHERE a.source_credit_check_result_id=r.id)
    LIMIT 1`).get();
  assert.ok(legacySource);
  const legacyGroupId = `CCHK1:${'a'.repeat(64)}`;
  const legacyResultId = `${legacyGroupId}:CUSTOMER_AGGREGATE`;
  db.prepare('UPDATE credit_check_results SET id=?,check_group_id=? WHERE id=?')
    .run(legacyResultId, legacyGroupId, legacySource.id);

  const server = createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'w11-fixture-1234' }),
    });
    assert.equal(response.status, 200, username);
    return (await response.json()).token;
  };
  const request = async (path, token) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const neutral = (result) => ({ status: result.status, code: result.body?.code, message: result.body?.message });

  try {
    const selfToken = await login('w11-self');
    const adminToken = await login('w11-admin');
    const deniedToken = await login('w11-none');
    const list = await request('/api/credit/exceptions?limit=100&offset=0', selfToken);
    assert.equal(list.status, 200);
    const aggregate = list.body.exceptions.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    const subLimit = list.body.exceptions.find((row) => row.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.ok(aggregate && subLimit);

    const before = databaseDigest(db);
    for (const row of [aggregate, subLimit]) {
      const encoded = await request(`/api/credit/exceptions/${encodeURIComponent(row.checkResultId)}`, selfToken);
      const lowerCaseEncoding = await request(`/api/credit/exceptions/${row.checkResultId.replaceAll(':', '%3a')}`, selfToken);
      const unencoded = await request(`/api/credit/exceptions/${row.checkResultId}`, selfToken);
      for (const result of [encoded, lowerCaseEncoding, unencoded]) {
        assert.equal(result.status, 200);
        assert.equal(result.body.exception.checkResultId, row.checkResultId);
        assert.equal(result.body.exception.checkGroupId, row.checkGroupId);
        assert.equal(result.body.exception.scopeType, row.scopeType);
        assert.deepEqual(result.body.exception.recordedBreakdown, row.recordedBreakdown);
      }
    }

    const legacy = await request(`/api/credit/exceptions/${encodeURIComponent(legacyResultId)}`, adminToken);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.exception.checkResultId, legacyResultId);
    assert.equal(legacy.body.exception.checkGroupId, legacyGroupId);

    const unauthorizedId = db.prepare(`SELECT r.id FROM credit_check_results r
      JOIN credit_profile cp ON cp.id=r.credit_profile_id
      WHERE cp.customer_id='cus-w11-other' AND r.scope_type='SALESPERSON_SUB_LIMIT' LIMIT 1`).get().id;
    const unknown = await request(`/api/credit/exceptions/${encodeURIComponent(`CCHK2:${'f'.repeat(64)}:CUSTOMER_AGGREGATE`)}`, selfToken);
    const unauthorized = await request(`/api/credit/exceptions/${encodeURIComponent(unauthorizedId)}`, selfToken);
    assert.deepEqual(neutral(unauthorized), neutral(unknown));
    assert.deepEqual(neutral(unknown), {
      status: 404, code: 'CREDIT_EXCEPTION_NOT_FOUND', message: unknown.body.message,
    });

    for (const unsafe of [
      '%', '%25', '%2F', '%5C', '..%2Fsecret',
      encodeURIComponent(encodeURIComponent(aggregate.checkResultId)),
      'CCHK2:not-a-digest:CUSTOMER_AGGREGATE',
    ]) {
      const result = await request(`/api/credit/exceptions/${unsafe}`, selfToken);
      assert.deepEqual(neutral(result), neutral(unknown), unsafe);
    }

    const denied = await request(`/api/credit/exceptions/${encodeURIComponent(aggregate.checkResultId)}`, deniedToken);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'CREDIT_SCOPE_DENIED');
    assert.equal(databaseDigest(db), before, 'SC102 Detail GET variants must remain zero-write');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
