import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { listCreditWorkReferences } from './modules/credit-work-references.js';
import { createTempDb } from './test-utils/temp-db.js';
import { ADMIN, NO_CREDIT, SELF_ACTOR, read, seedWorld } from './test-utils/wave11-sec-scope-fixture.js';

let handle;
let db;

beforeEach(async () => {
  handle = createTempDb({ label: 'credit-work-references', production: true });
  db = handle.db;
  await seedWorld(db);
});

afterEach(() => handle?.cleanup());

const options = (actor, kind, params = {}) => read(listCreditWorkReferences, db, actor, { kind, ...params });

test('work references project labels instead of exposing raw entity rows', async () => {
  for (const kind of ['PROFILE_CONTEXT', 'SALESPERSON', 'SALES_ORDER', 'EVALUATOR']) {
    const result = await options(ADMIN, kind);
    assert.equal(result.statusCode, 200, kind);
    assert.equal(result.body.kind, kind);
    assert.ok(result.body.items.length > 0, kind);
    assert.deepEqual(Object.keys(result.body.items[0]).sort(), ['active', 'code', 'id', 'name', 'secondaryText']);
  }
});

test('read scope is applied before profile and source-document choices', async () => {
  const selfEvaluator = { ...SELF_ACTOR, permissions: [...SELF_ACTOR.permissions, 'CREDIT_EVALUATE'] };
  const profile = await options(SELF_ACTOR, 'PROFILE_CONTEXT');
  const orders = await options(selfEvaluator, 'SALES_ORDER');
  assert.equal(profile.statusCode, 200);
  assert.equal(orders.statusCode, 200);
  assert.equal(profile.body.items.some((row) => row.id === 'cus-w11-self'), true);
  assert.equal(orders.body.items.some((row) => row.id === 'so-cus-w11-self'), true);

  const denied = await options(NO_CREDIT, 'PROFILE_CONTEXT');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'CREDIT_SCOPE_DENIED');
});

test('total and paging are taken on the authorized relation', async () => {
  const all = await options(ADMIN, 'PROFILE_CONTEXT');
  assert.equal(all.body.total, all.body.items.length, 'an unpaged relation reports its own total');

  const first = await options(ADMIN, 'PROFILE_CONTEXT', { limit: 2, offset: 0 });
  const next = await options(ADMIN, 'PROFILE_CONTEXT', { limit: 2, offset: 2 });
  assert.equal(first.body.limit, 2);
  assert.equal(first.body.offset, 0);
  assert.equal(first.body.items.length, 2);
  assert.equal(first.body.total, all.body.total);
  assert.equal(next.body.total, all.body.total);
  const firstIds = first.body.items.map((row) => row.id);
  const nextIds = next.body.items.map((row) => row.id);
  assert.equal(firstIds.some((id) => nextIds.includes(id)), false, 'two pages must not repeat a row');

  const beyond = await options(ADMIN, 'PROFILE_CONTEXT', { limit: 2, offset: 999 });
  assert.equal(beyond.body.items.length, 0);
  assert.equal(beyond.body.total, all.body.total, 'an empty page still reports the authorized total');

  const invalid = await options(ADMIN, 'PROFILE_CONTEXT', { limit: 0 });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.code, 'CREDIT_WORK_REFERENCE_INPUT_INVALID');
});

test('a selected id is hydrated on the authorized relation', async () => {
  const selected = await options(ADMIN, 'PROFILE_CONTEXT', { q: '没有匹配的客户', selectedId: 'cus-w11-self' });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.body.items.length, 1);
  assert.equal(selected.body.items[0].id, 'cus-w11-self');
  assert.equal(selected.body.total, 4, 'hydration never changes the authorized total');

  // An id that does not exist is absent exactly like an id the caller may not
  // read: neither is enumerable and neither is an error.
  const missing = await options(ADMIN, 'PROFILE_CONTEXT', { selectedId: 'cus-not-here' });
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.body.items.some((row) => row.id === 'cus-not-here'), false);
  assert.equal(missing.body.total, 4);
});

test('a row outside the authorized relation is never hydrated or counted', async () => {
  const selfDecider = { ...SELF_ACTOR, permissions: [...SELF_ACTOR.permissions, 'CREDIT_SPECIAL_APPROVE'] };
  const visible = await options(selfDecider, 'CHECK_RESULT');
  assert.equal(visible.statusCode, 200);
  // Four customer aggregates plus the actor's own salesperson sub-limit.
  assert.equal(visible.body.total, 5);

  const admin = await options(ADMIN, 'CHECK_RESULT');
  const foreign = admin.body.items.find((row) => row.id.endsWith(':SALESPERSON_SUB_LIMIT') && row.code === 'SO-CUS-W11-OTHER');
  assert.ok(foreign, 'the fixture must own another salesperson sub-limit result');

  const hydrated = await options(selfDecider, 'CHECK_RESULT', { selectedId: foreign.id });
  assert.equal(hydrated.statusCode, 200);
  assert.equal(hydrated.body.items.some((row) => row.id === foreign.id), false);
  assert.equal(hydrated.body.total, visible.body.total, 'an unreadable row never moves the total');
});

test('reference endpoint is read-only and UI removes delivery-stage annotations and raw-id entry', () => {
  const server = readFileSync(new URL('./modules/credit-work-references.js', import.meta.url), 'utf8');
  const foundation = readFileSync(new URL('../src/pages/credit-foundation.jsx', import.meta.url), 'utf8');
  const check = readFileSync(new URL('../src/pages/credit-check.jsx', import.meta.url), 'utf8');
  const evaluation = readFileSync(new URL('../src/pages/credit-evaluation.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  for (const source of [foundation, check, evaluation]) {
    assert.doesNotMatch(source, /销售与客户 · Wave \d+/);
    assert.doesNotMatch(source, /<span>客户 ID<\/span>|<span>销售员 ID/);
  }
  assert.match(foundation, /信用额度（元/);
  assert.match(check, /本次敞口增量（元）/);
  assert.match(evaluation, /BusinessReferenceSelector descriptor=\{creditWorkReferences\.evaluator\(\)\} label="评分人" multiple/);
  assert.match(evaluation, /allowedEvaluatorIds: form\.allowedEvaluatorIds/);
});
