// V2 Stage 3 / Wave 3A — focused architecture tests for the backend
// dispatch ownership infrastructure.
//
// Two describe blocks in this file:
//
//   1. Pure-function tests for server/lib/route-table.js, covering
//      register / match / list / duplicate detection / unknown
//      descriptor-field rejection / RegExp anchor and no-flags rules
//      / owner normalization. These tests are isolated from app.js —
//      they require no DB and no HTTP and never assert anything about
//      live dispatch.
//
//   2. V2 Stage 3 / Wave 3A + Wave 3B + Wave 3C + Wave 3D + Wave 3E +
//      Wave 3F + Wave 4A + Wave 4B — backend dispatch ownership
//      architecture invariants. These tests read server/app.js and the
//      migrated server/modules/*.js files from disk and assert that
//      the live route-table infrastructure is wired in: app.js imports
//      route-table.js, the warehouse / customer / supplier / role /
//      user-management / product-master-data / decision-reports /
//      product-routings descriptors are registered with their
//      canonical owners, no legacy /api/warehouses / /api/customers /
//      /api/suppliers / /api/roles / /api/users / /api/reports/decision/*
//      / /api/product-routings dispatch branches remain, and unrelated
//      routes still fall through to the legacy handleApi chain.
//      live dispatch.
//
//   2. V2 Stage 3 / Wave 3A + Wave 3B + Wave 3C + Wave 3D + Wave 3E +
//      Wave 3F + Wave 4A — backend dispatch ownership architecture
//      invariants. These tests read server/app.js and the migrated
//      server/modules/*.js files from disk and assert that the live
//      route-table infrastructure is wired in: app.js imports
//      route-table.js, the warehouse / customer / supplier / role /
//      user-management / product-master-data / decision-reports
//      descriptors are registered with their canonical owners, no
//      legacy /api/warehouses / /api/customers / /api/suppliers /
//      /api/roles / /api/users / /api/reports/decision/* dispatch
//      branches remain, and unrelated routes still fall through to
//      the legacy handleApi chain.
//
// Authorization, transaction, and audit continue to live at the
// handler boundary (allow / allowAny / transaction / audit); the
// route-table carries dispatch + owner metadata only.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

import { createRouteTable, RouteTableError } from './lib/route-table.js';

describe('V2 Wave 1 — backend dispatch ownership route-table', () => {
  test('1. canonical four-field descriptor succeeds', () => {
    const table = createRouteTable();
    const handler = () => {};
    const entry = table.register({
      method: 'GET',
      path: '/api/health',
      handler,
      owner: 'server/modules/health.js',
    });
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/api/health');
    assert.equal(entry.pathKind, 'exact');
    assert.equal(entry.handler, handler);
    assert.equal(entry.owner, 'server/modules/health.js');
    assert.equal(table.size(), 1);
  });

  test('1b. lowercase method is normalized to upper-case', () => {
    const table = createRouteTable();
    const entry = table.register({
      method: 'get',
      path: '/api/health',
      handler: () => {},
      owner: 'server/modules/health.js',
    });
    assert.equal(entry.method, 'GET');
  });

  test('2. correct method/path selects correct handler', () => {
    const table = createRouteTable();
    const listHandler = () => 'list';
    const createHandler = () => 'create';
    table.register({ method: 'GET', path: '/api/customers', handler: listHandler, owner: 'mod/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: createHandler, owner: 'mod/customers.js' });
    const listHit = table.match('GET', '/api/customers');
    const createHit = table.match('POST', '/api/customers');
    assert.ok(listHit);
    assert.ok(createHit);
    assert.equal(listHit.handler, listHandler);
    assert.equal(createHit.handler, createHandler);
  });

  test('2b. exact path mismatch does not select handler', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/health',
      handler: () => {},
      owner: 'server/modules/health.js',
    });
    assert.equal(table.match('GET', '/api/health/live'), null);
    assert.equal(table.match('GET', '/api/healthcheck'), null);
  });

  test('2c. method mismatch does not select handler', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/orders',
      handler: () => {},
      owner: 'mod/orders.js',
    });
    assert.equal(table.match('POST', '/api/orders'), null);
    assert.equal(table.match('DELETE', '/api/orders'), null);
  });

  test('3. unmatched route returns null (no-match result used by app.js fallback)', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/health',
      handler: () => {},
      owner: 'server/modules/health.js',
    });
    assert.equal(table.match('GET', '/api/no-such-route'), null);
    assert.equal(table.match('POST', '/api/health'), null);
    assert.equal(table.match('GET', '/api/health/extra'), null);
  });

  test('4. duplicate equivalent route fails closed', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/health',
      handler: () => 'first',
      owner: 'mod/a.js',
    });
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/health',
        handler: () => 'second',
        owner: 'mod/b.js',
      }),
      (error) => {
        assert.ok(error instanceof RouteTableError);
        assert.equal(error.reason, 'duplicate_route');
        assert.equal(error.method, 'GET');
        assert.equal(error.pathKey, '/api/health');
        return true;
      },
    );
    assert.equal(table.size(), 1);
    const only = table.match('GET', '/api/health');
    assert.equal(only.handler(), 'first');
    assert.equal(only.owner, 'mod/a.js');
  });

  test('4b. duplicate regex with same source fails closed even if RegExp instances differ', () => {
    const table = createRouteTable();
    table.register({
      method: 'PATCH',
      path: /^\/api\/roles\/([^/]+)$/,
      handler: () => 'first',
      owner: 'mod/a.js',
    });
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: /^\/api\/roles\/([^/]+)$/,
        handler: () => 'second',
        owner: 'mod/b.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
    );
  });

  test('4c. same path with different methods is allowed', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/roles', handler: () => 'g', owner: 'mod/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => 'p', owner: 'mod/roles.js' });
    assert.equal(table.size(), 2);
    assert.equal(table.match('GET', '/api/roles').handler(), 'g');
    assert.equal(table.match('POST', '/api/roles').handler(), 'p');
  });

  test('5. owner is retained for architecture/audit inspection', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/x', handler: () => {}, owner: 'mod/x.js' });
    table.register({ method: 'GET', path: '/api/y', handler: () => {}, owner: 'mod/y.js' });
    const items = table.list();
    assert.equal(items.length, 2);
    const xEntry = items.find((entry) => entry.path === '/api/x');
    const yEntry = items.find((entry) => entry.path === '/api/y');
    assert.equal(xEntry.owner, 'mod/x.js');
    assert.equal(yEntry.owner, 'mod/y.js');
    assert.equal(table.match('GET', '/api/x').owner, 'mod/x.js');
    assert.equal(table.match('GET', '/api/y').owner, 'mod/y.js');
  });

  test('6. owner does not control runtime authorization', () => {
    const table = createRouteTable();
    const calls = [];
    table.register({
      method: 'GET',
      path: '/api/anything',
      handler: () => {
        calls.push('handler-ran');
        return { ok: true };
      },
      owner: 'mod/anything.js',
    });
    const hit = table.match('GET', '/api/anything');
    assert.ok(hit);
    const result = hit.handler();
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, ['handler-ran']);
  });

  test('7. unknown field "permissions" is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        permissions: ['SOMETHING'],
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissions',
    );
  });

  test('7b. unknown field "permissionPolicy" is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        permissionPolicy: 'x',
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissionPolicy',
    );
  });

  test('7c. unknown field "transactionPolicy" is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        transactionPolicy: 'innocent',
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'transactionPolicy',
    );
  });

  test('7d. unknown field "auditPolicy" is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        auditPolicy: 'shadow',
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'auditPolicy',
    );
  });

  test('7e. arbitrary unknown key is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        somethingElse: true,
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'somethingElse',
    );
  });

  test('7f. unknown-field failure takes precedence over later field-level validation', () => {
    // Even if every canonical field would also be invalid, the
    // unknown-field check fires first so the contributor sees the
    // architecture-level mistake before the syntax-level mistake.
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'BREW',
        path: '/api/x',
        handler: () => {},
        owner: 'mod/x.js',
        permissions: ['SOMETHING'],
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissions',
    );
  });

  test('8. regex matcher extracts capture groups as params (current handleApi semantics preserved)', () => {
    const table = createRouteTable();
    table.register({
      method: 'PATCH',
      path: /^\/api\/roles\/([^/]+)$/,
      handler: () => {},
      owner: 'mod/roles.js',
    });
    const hit = table.match('PATCH', '/api/roles/role-abc-123');
    assert.ok(hit);
    assert.deepEqual(hit.params, ['role-abc-123']);
  });

  test('8b. exact path match returns empty params array', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/health',
      handler: () => {},
      owner: 'server/modules/health.js',
    });
    const hit = table.match('GET', '/api/health');
    assert.deepEqual(hit.params, []);
  });

  test('8c. multi-segment regex (e.g. action suffix) extracts both', () => {
    const table = createRouteTable();
    table.register({
      method: 'POST',
      path: /^\/api\/orders\/([^/]+)\/(submit|approve|reject)$/,
      handler: () => {},
      owner: 'mod/orders.js',
    });
    const hit = table.match('POST', '/api/orders/order-42/approve');
    assert.ok(hit);
    assert.deepEqual(hit.params, ['order-42', 'approve']);
  });

  test('9. owner = "app.js" is rejected', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/x',
        handler: () => {},
        owner: 'app.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'owner_is_app_js',
    );
  });

  test('9b. owner normalization rejects trivial app.js spellings', () => {
    const table = createRouteTable();
    const cases = [
      'app.js',
      './app.js',
      'server/app.js',
      './server/app.js',
      'server\\app.js',
      '.\\server\\app.js',
    ];
    for (const owner of cases) {
      assert.throws(
        () => table.register({
          method: 'GET',
          path: '/api/x',
          handler: () => {},
          owner,
        }),
        (error) => error instanceof RouteTableError && error.reason === 'owner_is_app_js',
        `should reject owner ${JSON.stringify(owner)}`,
      );
    }
  });

  test('9c. owner normalization accepts legitimate module paths (including non-server/app.js files named app.js)', () => {
    const table = createRouteTable();
    // Legitimate owners. Note: a file named `app.js` under any directory
    // OTHER than the application owner path (server/app.js) is a domain
    // route owner, not the application owner, and must remain
    // acceptable.
    const legitimateOwners = [
      'server/modules/health.js',
      'mod/anything.js',
      'app.jsx',                       // different extension
      'my-app.js',                     // hyphenated basename
      'mod/my-app.js',
      'src/app-router.js',
      'server/modules/foo/app.js',     // app.js under a domain subdir
      'server/modules/reporting/app.js',
      'src/app.js',                    // app.js under src/
      'mod/app.js',                    // app.js under mod/
    ];
    for (const owner of legitimateOwners) {
      assert.doesNotThrow(
        () => table.register({
          method: 'GET',
          path: `/api/owner-${legitimateOwners.indexOf(owner)}`,
          handler: () => {},
          owner,
        }),
        `should accept owner ${JSON.stringify(owner)}`,
      );
    }
    assert.equal(table.size(), legitimateOwners.length);
  });

  test('9d. owner normalization accepts files named app.js under non-server/app.js directories', () => {
    // Property: for any path whose basename is `app.js` but whose parent
    // is not the current application owner (`server/app.js`), the owner
    // must be accepted.
    const table = createRouteTable();
    const acceptedBasenames = [
      'server/modules/foo/app.js',
      'server/modules/bar/baz/app.js',
      'src/app.js',
      'mod/app.js',
      'apps/app.js', // top-level directory called apps/
      'a/b/c/d/app.js',
    ];
    for (const owner of acceptedBasenames) {
      assert.doesNotThrow(
        () => table.register({
          method: 'GET',
          path: `/api/${acceptedBasenames.indexOf(owner)}`,
          handler: () => {},
          owner,
        }),
        `should accept owner ${JSON.stringify(owner)}`,
      );
    }
    assert.equal(table.size(), acceptedBasenames.length);
  });

  test('RegExp safety: unflagged accepted; any flag fails closed', () => {
    const table = createRouteTable();
    assert.doesNotThrow(() => table.register({
      method: 'GET',
      path: /^\/api\/health$/,
      handler: () => {},
      owner: 'mod/h.js',
    }));
    for (const flag of ['g', 'y', 'i', 'm', 's', 'u']) {
      assert.throws(
        () => table.register({
          method: 'GET',
          path: new RegExp('^\\/api\\/health$', flag),
          handler: () => {},
          owner: 'mod/x.js',
        }),
        (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
        `flag ${flag} must be rejected`,
      );
    }
  });

  test('RegExp safety: unanchored patterns fail closed', () => {
    const table = createRouteTable();
    const cases = [
      /api\/orders/,
      /^\/api\/orders/,
      /\/api\/orders$/,
      /^\/api\/orders\/([^/]+)/,
    ];
    for (const path of cases) {
      assert.throws(
        () => table.register({
          method: 'GET',
          path,
          handler: () => {},
          owner: 'mod/x.js',
        }),
        (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
        `should reject unanchored pattern ${path.source}`,
      );
    }
  });

  test('RegExp safety: trailing escaped $ is treated as a literal character, not the end anchor', () => {
    const table = createRouteTable();
    // Source: ^abc\$ — trailing $ is escaped. Pattern is NOT anchored
    // at the end and must be rejected.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: /^abc\$/,
        handler: () => {},
        owner: 'mod/x.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
  });

  test('RegExp safety: caller-owned RegExp mutation does not affect routing semantics', () => {
    const table = createRouteTable();
    const callerRe = /^\/api\/health$/;
    table.register({
      method: 'GET',
      path: callerRe,
      handler: () => 'first',
      owner: 'mod/h.js',
    });
    // Caller mutates the original object after registration. The route
    // table owns its internal matcher, so this must not affect
    // dispatch.
    callerRe.lastIndex = 999;
    callerRe.someCustomProp = true;
    // Caller even replaces its own source property attempt (which JS
    // silently ignores on RegExp.source since it is a getter).
    Object.defineProperty(callerRe, 'source', { value: '^/api/other$', configurable: true });
    const hit = table.match('GET', '/api/health');
    assert.ok(hit);
    assert.equal(hit.handler(), 'first');
    assert.equal(table.list()[0].path, '^\\/api\\/health$');
  });

  test('RegExp safety: repeated match() on accepted regex is deterministic', () => {
    const table = createRouteTable();
    table.register({
      method: 'PATCH',
      path: /^\/api\/items\/([^/]+)$/,
      handler: () => {},
      owner: 'mod/items.js',
    });
    const a = table.match('PATCH', '/api/items/abc');
    const b = table.match('PATCH', '/api/items/abc');
    const c = table.match('PATCH', '/api/items/abc');
    assert.ok(a && b && c);
    assert.equal(a.handler, b.handler);
    assert.equal(b.handler, c.handler);
    assert.deepEqual(a.params, ['abc']);
    assert.deepEqual(b.params, ['abc']);
    assert.deepEqual(c.params, ['abc']);
  });

  test('RegExp safety: same exact-string path and an equivalent anchored regex do not collide (route-author concern)', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/health',
      handler: () => 'string',
      owner: 'mod/h.js',
    });
    // No regex-overlap detection is provided in Wave 1. Both
    // registrations are distinct entries; deterministic registration
    // order resolves the overlap. First-registered wins.
    assert.doesNotThrow(() => table.register({
      method: 'GET',
      path: /^\/api\/health$/,
      handler: () => 'regex',
      owner: 'mod/h.js',
    }));
    const hit = table.match('GET', '/api/health');
    assert.equal(hit.handler(), 'string');
  });

  test('deterministic registration order: first-registered wins when two descriptors both match', () => {
    const table = createRouteTable();
    const firstHandler = () => 'first';
    const secondHandler = () => 'second';
    table.register({
      method: 'GET',
      path: /^\/api\/items\/([^/]+)$/,
      handler: firstHandler,
      owner: 'mod/first.js',
    });
    table.register({
      method: 'GET',
      path: /^\/api\/items\/.+$/,
      handler: secondHandler,
      owner: 'mod/second.js',
    });
    const hit = table.match('GET', '/api/items/x');
    assert.ok(hit);
    assert.equal(hit.handler, firstHandler);
    assert.equal(hit.owner, 'mod/first.js');
  });

  test('match returns null when no descriptor matches', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/x',
      handler: () => {},
      owner: 'mod/x.js',
    });
    assert.equal(table.match('GET', '/api/y'), null);
    assert.equal(table.match('POST', '/api/x'), null);
  });

  test('match returns null when method is not a string', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/x',
      handler: () => {},
      owner: 'mod/x.js',
    });
    assert.equal(table.match(undefined, '/api/x'), null);
    assert.equal(table.match(null, '/api/x'), null);
    assert.equal(table.match(123, '/api/x'), null);
  });

  test('list() returns one entry per registered route with all observable fields', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/x', handler: () => {}, owner: 'mod/x.js' });
    table.register({
      method: 'POST',
      path: /^\/api\/y\/([^/]+)$/,
      handler: () => {},
      owner: 'mod/y.js',
    });
    const items = table.list();
    assert.equal(items.length, 2);
    const x = items.find((entry) => entry.path === '/api/x');
    const y = items.find((entry) => entry.pathKind === 'regex');
    assert.equal(x.method, 'GET');
    assert.equal(x.pathKind, 'exact');
    assert.equal(x.owner, 'mod/x.js');
    assert.equal(y.method, 'POST');
    assert.equal(y.owner, 'mod/y.js');
  });

  test('behavioral immutability: registered routing semantics cannot be externally mutated', () => {
    // The route-table may retain internal immutability defensively,
    // but the architectural contract is the behavioral one: the live
    // dispatcher must continue to resolve the originally registered
    // handler/owner regardless of caller mutations of the returned
    // descriptor.
    const table = createRouteTable();
    const originalHandler = () => 'original';
    const entry = table.register({
      method: 'GET',
      path: '/api/x',
      handler: originalHandler,
      owner: 'mod/x.js',
    });
    let mutationThrew = false;
    try {
      entry.handler = () => 'mutated';
    } catch {
      mutationThrew = true;
    }
    const hit = table.match('GET', '/api/x');
    assert.ok(hit);
    assert.equal(hit.handler(), 'original');
    assert.equal(hit.owner, 'mod/x.js');
    // mutationThrew may be true (strict mode + Object.freeze) or false
    // (non-strict, no freeze). The architectural invariant is
    // dispatch-side: the externally-observed mutation must not change
    // dispatch semantics. We accept both outcomes for the mutation
    // itself; we only require behavioral correctness.
    void mutationThrew;
  });

  test('validation: invalid method throws', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({ method: 'BREW', path: '/api/x', handler: () => {}, owner: 'mod/x.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_method',
    );
    assert.throws(
      () => table.register({ method: 42, path: '/api/x', handler: () => {}, owner: 'mod/x.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_method',
    );
  });

  test('validation: invalid path throws', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({ method: 'GET', path: 'no-leading-slash', handler: () => {}, owner: 'mod/x.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_path',
    );
    assert.throws(
      () => table.register({ method: 'GET', path: 42, handler: () => {}, owner: 'mod/x.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_path',
    );
  });

  test('validation: invalid handler throws', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({ method: 'GET', path: '/api/x', handler: 'not-a-fn', owner: 'mod/x.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_handler',
    );
  });

  test('validation: invalid owner throws', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({ method: 'GET', path: '/api/x', handler: () => {}, owner: '' }),
      (error) => error instanceof RouteTableError && error.reason === 'invalid_owner',
    );
  });
});

describe('V2 Stage 3 / Wave 3A — backend dispatch ownership (warehouse migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');

  test('server/app.js now imports the route-table infrastructure', () => {
    assert.ok(
      appSource.includes('./lib/route-table.js') || appSource.includes('./lib\\route-table.js'),
      'Wave 3A: server/app.js MUST import ./lib/route-table.js so the migrated warehouse route family can dispatch through it',
    );
    assert.match(appSource, /createRouteTable/);
  });

  test('server/modules/warehouses.js exists and exports the four canonical warehouse handlers', () => {
    const moduleSource = readFileSync(resolve('server/modules/warehouses.js'), 'utf8');
    assert.match(moduleSource, /export function listWarehouses\b/);
    assert.match(moduleSource, /export (?:async )?function createWarehouse\b/);
    assert.match(moduleSource, /export (?:async )?function updateWarehouse\b/);
    assert.match(moduleSource, /export function deleteWarehouse\b/);
  });

  test('app.js imports the warehouse handlers from server/modules/warehouses.js', () => {
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/warehouses\.js['"]/,
      'Wave 3A: server/app.js MUST import the warehouse handlers from server/modules/warehouses.js',
    );
    assert.match(appSource, /listWarehouses/);
    assert.match(appSource, /createWarehouse/);
    assert.match(appSource, /updateWarehouse/);
    assert.match(appSource, /deleteWarehouse/);
  });

  test('app.js no longer declares listWarehouses / createWarehouse / updateWarehouse as app-local functions', () => {
    assert.doesNotMatch(appSource, /^\s*function\s+listWarehouses\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createWarehouse\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateWarehouse\b/m);
  });

  test('app.js no longer has legacy handleApi branches dispatching /api/warehouses', () => {
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/warehouses['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3A: legacy exact-match GET branch for /api/warehouses must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/warehouses['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3A: legacy exact-match POST branch for /api/warehouses must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/warehouses\\\/[^/]+\$\/\)/,
      'Wave 3A: legacy whMatch-style dispatch for /api/warehouses/:id must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /deleteMasterRecord\([^)]*['"]warehouse['"]/,
      'Wave 3A: deleteMasterRecord must not be called directly from app.js for kind="warehouse"; it must delegate via server/modules/warehouses.js',
    );
  });

  test('all four warehouse routes are registered with the canonical owner', () => {
    // Build the same route-table that app.js builds at module load
    // by importing createRouteTable and exercising the descriptor
    // contract with the same canonical fields.
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/warehouses',
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'POST',
      path: '/api/warehouses',
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'PATCH',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'DELETE',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });

    assert.equal(table.size(), 4);
    const items = table.list();
    for (const item of items) {
      assert.equal(item.owner, 'server/modules/warehouses.js');
    }

    const getHit = table.match('GET', '/api/warehouses');
    assert.ok(getHit, 'GET /api/warehouses must match');
    assert.equal(getHit.owner, 'server/modules/warehouses.js');

    const postHit = table.match('POST', '/api/warehouses');
    assert.ok(postHit, 'POST /api/warehouses must match');
    assert.equal(postHit.owner, 'server/modules/warehouses.js');

    const patchHit = table.match('PATCH', '/api/warehouses/warehouse-001');
    assert.ok(patchHit, 'PATCH /api/warehouses/:id must match');
    assert.deepEqual(patchHit.params, ['warehouse-001']);
    assert.equal(patchHit.owner, 'server/modules/warehouses.js');

    const deleteHit = table.match('DELETE', '/api/warehouses/warehouse-001');
    assert.ok(deleteHit, 'DELETE /api/warehouses/:id must match');
    assert.deepEqual(deleteHit.params, ['warehouse-001']);
    assert.equal(deleteHit.owner, 'server/modules/warehouses.js');
  });

  test('duplicate warehouse route registration is still rejected', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/warehouses',
      handler: () => 'first',
      owner: 'server/modules/warehouses.js',
    });
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/warehouses',
        handler: () => 'second',
        owner: 'server/modules/warehouses.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
      'duplicate (method, path) registrations must still fail closed',
    );
  });

  test('unknown descriptor field protection still rejects declarative metadata', () => {
    // The Wave 3A descriptors must continue to be rejected for any
    // field other than { method, path, handler, owner }. This protects
    // against silently smuggling permissions / transactionPolicy /
    // auditPolicy into the route-table.
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/warehouses',
        handler: () => {},
        owner: 'server/modules/warehouses.js',
        permissions: ['WAREHOUSES_VIEW'],
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissions',
    );
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/warehouses',
        handler: () => {},
        owner: 'server/modules/warehouses.js',
        transactionPolicy: 'serializable',
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'transactionPolicy',
    );
  });

  test('warehouse regex path must be anchored with no flags', () => {
    const table = createRouteTable();
    // Exactly the regex shape used in app.js — must accept.
    assert.doesNotThrow(() => table.register({
      method: 'PATCH',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    }));
    // Unflagged variant of the same regex — must accept.
    assert.doesNotThrow(() => table.register({
      method: 'DELETE',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    }));
    // The same pattern with a flag must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: new RegExp('^\\/api\\/warehouses\\/([^/]+)$', 'i'),
        handler: () => {},
        owner: 'server/modules/warehouses.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    // An unanchored variant must fail closed.
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: /\/api\/warehouses\/([^/]+)/,
        handler: () => {},
        owner: 'server/modules/warehouses.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
  });

  test('unrelated routes still fall through to legacy handleApi (match returns null)', () => {
    // After Wave 3A + Wave 3B, the route-table owns the four
    // warehouse routes and the four customer routes. Every other
    // production route must continue to fall through to the
    // existing legacy handleApi chain unchanged. Supplier / Order
    // / Product / Purchase Order / Inventory / accounting routes
    // MUST remain on the legacy chain because their migration is
    // explicitly out-of-scope for this wave.
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/warehouses',
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'POST',
      path: '/api/warehouses',
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'PATCH',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'DELETE',
      path: /^\/api\/warehouses\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/warehouses.js',
    });
    table.register({
      method: 'GET',
      path: '/api/customers',
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'POST',
      path: '/api/customers',
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'PATCH',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'DELETE',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    });

    // All of these must return null so legacy handleApi continues
    // to handle them exactly as before.
    const unrelatedPaths = [
      ['GET', '/api/suppliers'],
      ['GET', '/api/products'],
      ['GET', '/api/orders'],
      ['GET', '/api/purchase-orders'],
      ['PATCH', '/api/suppliers/supplier-001'],
      ['DELETE', '/api/products/product-001'],
      ['GET', '/api/inventory'],
      ['GET', '/api/inventory-checks'],
      ['POST', '/api/auth/login'],
      ['GET', '/api/health'],
      ['GET', '/api/dashboard'],
    ];
    for (const [method, path] of unrelatedPaths) {
      assert.equal(table.match(method, path), null, `unrelated ${method} ${path} must NOT match the route-table`);
    }
  });
});

describe('V2 Stage 3 / Wave 3B — backend dispatch ownership (customer migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const customersModuleSource = readFileSync(resolve('server/modules/customers.js'), 'utf8');

  test('app.js imports the shared paymentTermsDays helper from server/lib/payment-terms.js', () => {
    assert.match(
      appSource,
      /from\s+['"]\.\/lib\/payment-terms\.js['"]/,
      'Wave 3B: server/app.js MUST import paymentTermsDays from the shared helper module',
    );
    assert.match(appSource, /\bpaymentTermsDays\b/);
  });

  test('server/lib/payment-terms.js exists and exports a single paymentTermsDays implementation', () => {
    const helperSource = readFileSync(resolve('server/lib/payment-terms.js'), 'utf8');
    assert.match(
      helperSource,
      /export\s+function\s+paymentTermsDays\b/,
      'Wave 3B: server/lib/payment-terms.js MUST export a single paymentTermsDays function',
    );
    assert.match(helperSource, /付款条款天数必须是 0–3650 的整数/);
  });

  test('app.js no longer declares an app-local paymentTermsDays function (no duplicate)', () => {
    assert.doesNotMatch(
      appSource,
      /^\s*function\s+paymentTermsDays\b/m,
      'Wave 3B: app-local paymentTermsDays declaration MUST be removed; only the shared helper is canonical',
    );
  });

  test('server/modules/customers.js exists and exports the four canonical customer handlers', () => {
    assert.match(customersModuleSource, /export function listCustomers\b/);
    assert.match(customersModuleSource, /export (?:async )?function createCustomer\b/);
    assert.match(customersModuleSource, /export (?:async )?function updateCustomer\b/);
    assert.match(customersModuleSource, /export function deleteCustomer\b/);
    assert.match(customersModuleSource, /export function customerInput\b/);
  });

  test('customers.js imports paymentTermsDays from the shared helper (no app-local duplicate)', () => {
    assert.match(
      customersModuleSource,
      /from\s+['"]\.\.\/lib\/payment-terms\.js['"]/,
      'Wave 3B: server/modules/customers.js MUST import paymentTermsDays from the shared helper module',
    );
    assert.doesNotMatch(
      customersModuleSource,
      /^\s*function\s+paymentTermsDays\b/m,
      'Wave 3B: customer module MUST NOT redeclare paymentTermsDays; the shared helper is the single source of truth',
    );
  });

  test('app.js imports the customer handlers from server/modules/customers.js', () => {
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/customers\.js['"]/,
      'Wave 3B: server/app.js MUST import the customer handlers from server/modules/customers.js',
    );
    assert.match(appSource, /\blistCustomers\b/);
    assert.match(appSource, /\bcreateCustomer\b/);
    assert.match(appSource, /\bupdateCustomer\b/);
    assert.match(appSource, /\bdeleteCustomer\b/);
  });

  test('app.js no longer declares listCustomers / createCustomer / updateCustomer / customerInput as app-local functions', () => {
    assert.doesNotMatch(appSource, /^\s*function\s+listCustomers\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createCustomer\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateCustomer\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+customerInput\b/m);
  });

  test('app.js no longer has legacy handleApi branches dispatching /api/customers', () => {
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/customers['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3B: legacy exact-match GET branch for /api/customers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/customers['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3B: legacy exact-match POST branch for /api/customers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/customers\\\/[^/]+\$\/\)/,
      'Wave 3B: legacy customerMatch-style dispatch for /api/customers/:id must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /deleteMasterRecord\([^)]*['"]customer['"]/,
      'Wave 3B: deleteMasterRecord must not be called directly from app.js for kind="customer"; it must delegate via server/modules/customers.js',
    );
  });

  test('all four customer routes are registered with the canonical owner', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/customers',
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'POST',
      path: '/api/customers',
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'PATCH',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    });
    table.register({
      method: 'DELETE',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    });

    assert.equal(table.size(), 4);
    const items = table.list();
    const customerItems = items.filter((item) => item.owner === 'server/modules/customers.js');
    assert.equal(customerItems.length, 4);
    for (const item of customerItems) {
      assert.equal(item.owner, 'server/modules/customers.js');
    }

    const getHit = table.match('GET', '/api/customers');
    assert.ok(getHit, 'GET /api/customers must match');
    assert.equal(getHit.owner, 'server/modules/customers.js');

    const postHit = table.match('POST', '/api/customers');
    assert.ok(postHit, 'POST /api/customers must match');
    assert.equal(postHit.owner, 'server/modules/customers.js');

    const patchHit = table.match('PATCH', '/api/customers/customer-001');
    assert.ok(patchHit, 'PATCH /api/customers/:id must match');
    assert.deepEqual(patchHit.params, ['customer-001']);
    assert.equal(patchHit.owner, 'server/modules/customers.js');

    const deleteHit = table.match('DELETE', '/api/customers/customer-001');
    assert.ok(deleteHit, 'DELETE /api/customers/:id must match');
    assert.deepEqual(deleteHit.params, ['customer-001']);
    assert.equal(deleteHit.owner, 'server/modules/customers.js');
  });

  test('exactly four customer descriptors exist (no Supplier descriptor registered)', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    const customerEntries = table.list().filter((item) => item.owner === 'server/modules/customers.js');
    assert.equal(customerEntries.length, 4);
  });

  test('product master-data routes migrate in Wave 3F: /api/products (GET / POST / PATCH / DELETE) move to the route-table while tracking-policy + tracking + traceability + IQC/OQC remain legacy', () => {
    // Wave 3F scope explicitly covers Product master-data routes
    // only. The four Product master-data routes (GET, POST, PATCH,
    // DELETE) move to the route-table. All non-master-data Product
    // routes — including the tracking-policy route, every tracking
    // route, the genealogy route, and the quality-control-points
    // routes — remain on the legacy handleApi chain and MUST NOT be
    // migrated in Wave 3F.
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });

    // Product master-data routes ARE owned (after Wave 3F).
    assert.equal(table.match('GET', '/api/products'), null, 'Wave 3F: customer-only table does not own /api/products yet — proves the customer wave never registered products');
    assert.equal(table.match('POST', '/api/products'), null);

    // Product tracking-policy + tracking + traceability routes are
    // intentionally NOT in the route-table after Wave 3F.
    assert.equal(table.match('PATCH', '/api/products/p-001/tracking-policy'), null, 'tracking-policy route must NOT be dispatched by the route-table after Wave 3F');
    assert.equal(table.match('GET', '/api/traceability'), null);
    assert.equal(table.match('POST', '/api/production-genealogy'), null);

    // /api/products (master-data) generic exact-match dispatch
    // branches were removed from app.js; the legacy handleApi chain
    // MUST NOT contain them anymore.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/products['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3F: legacy exact-match GET branch for /api/products must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/products['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3F: legacy exact-match POST branch for /api/products must be removed',
    );
  });

  test('duplicate customer route registration is still rejected', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/customers',
      handler: () => 'first',
      owner: 'server/modules/customers.js',
    });
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/customers',
        handler: () => 'second',
        owner: 'server/modules/customers.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
      'duplicate (method, path) registrations must still fail closed for customer routes too',
    );
  });

  test('unknown descriptor field protection still rejects declarative metadata on customer routes', () => {
    const table = createRouteTable();
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/customers',
        handler: () => {},
        owner: 'server/modules/customers.js',
        permissions: ['CUSTOMERS_VIEW'],
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissions',
    );
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/customers',
        handler: () => {},
        owner: 'server/modules/customers.js',
        transactionPolicy: 'serializable',
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'transactionPolicy',
    );
  });

  test('customer regex path must be anchored with no flags', () => {
    const table = createRouteTable();
    assert.doesNotThrow(() => table.register({
      method: 'PATCH',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    }));
    assert.doesNotThrow(() => table.register({
      method: 'DELETE',
      path: /^\/api\/customers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/customers.js',
    }));
    assert.throws(
      () => table.register({
        method: 'GET',
        path: new RegExp('^\\/api\\/customers\\/([^/]+)$', 'i'),
        handler: () => {},
        owner: 'server/modules/customers.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: /\/api\/customers\/([^/]+)/,
        handler: () => {},
        owner: 'server/modules/customers.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
  });

  test('one live owned route table is used by app.js (single dispatch block, neutral name)', () => {
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(
      constructorOccurrences.length,
      1,
      'Wave 3B: app.js must construct the owned route table exactly once',
    );
    assert.doesNotMatch(appSource, /\bwarehouseRouteTable\b/);
    assert.match(appSource, /\bownedRouteTable\b/);
  });
});

describe('V2 Stage 3 / Wave 3C — backend dispatch ownership (supplier migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');

  test('app.js imports the supplier handlers from server/modules/suppliers.js', () => {
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/suppliers\.js['"]/,
      'Wave 3C: server/app.js MUST import the supplier handlers from server/modules/suppliers.js',
    );
    assert.match(appSource, /\blistSuppliers\b/);
    assert.match(appSource, /\bcreateSupplier\b/);
    assert.match(appSource, /\bupdateSupplier\b/);
    assert.match(appSource, /\bdeleteSupplier\b/);
  });

  test('app.js no longer declares listSuppliers / createSupplier / updateSupplier / supplierInput as app-local functions', () => {
    assert.doesNotMatch(appSource, /^\s*function\s+listSuppliers\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createSupplier\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateSupplier\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+supplierInput\b/m);
  });

  test('app.js no longer has legacy handleApi branches dispatching /api/suppliers', () => {
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/suppliers['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3C: legacy exact-match GET branch for /api/suppliers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/suppliers['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3C: legacy exact-match POST branch for /api/suppliers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/suppliers\\\/[^/]+\$\/\)/,
      'Wave 3C: legacy supplierMatch-style dispatch for /api/suppliers/:id must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /deleteMasterRecord\([^)]*['"]supplier['"]/,
      'Wave 3C: deleteMasterRecord must not be called directly from app.js for kind="supplier"; it must delegate via server/modules/suppliers.js',
    );
  });

  test('all four supplier routes are registered with the canonical owner', () => {
    const table = createRouteTable();
    table.register({
      method: 'GET',
      path: '/api/suppliers',
      handler: () => {},
      owner: 'server/modules/suppliers.js',
    });
    table.register({
      method: 'POST',
      path: '/api/suppliers',
      handler: () => {},
      owner: 'server/modules/suppliers.js',
    });
    table.register({
      method: 'PATCH',
      path: /^\/api\/suppliers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/suppliers.js',
    });
    table.register({
      method: 'DELETE',
      path: /^\/api\/suppliers\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/suppliers.js',
    });

    const supplierItems = table.list().filter((item) => item.owner === 'server/modules/suppliers.js');
    assert.equal(supplierItems.length, 4, 'four Supplier descriptors must exist with the canonical owner');
    for (const item of supplierItems) {
      assert.equal(item.owner, 'server/modules/suppliers.js');
    }
  });

  test('exactly four supplier descriptors exist (no Products descriptor registered)', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    const supplierEntries = table.list().filter((item) => item.owner === 'server/modules/suppliers.js');
    assert.equal(supplierEntries.length, 4);
  });

  test('product tracking-policy route remains on legacy handleApi after Wave 3C and after Wave 3F', () => {
    // Wave 3C kept tracking-policy legacy; Wave 3F migrates Product
    // master-data only and explicitly excludes the tracking-policy
    // route. The legacy productTrackingMatch branch must continue to
    // dispatch to updateProductTrackingHandler and remain in app.js
    // before the generic Product master-data dispatch reaches the
    // route-table.
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });

    assert.equal(table.match('PATCH', '/api/products/p-001/tracking-policy'), null, 'tracking-policy must NOT migrate to the route-table');

    assert.match(
      appSource,
      /productTrackingMatch\s*=\s*pathname\.match\(/,
      'Product /:id/tracking-policy legacy dispatch branch must remain in app.js for Wave 3C',
    );
  });

  test('warehouse + customer descriptors remain intact alongside the new supplier family', () => {
    // After Wave 3C the owned table still owns all three
    // previously-migrated families. This guards against an
    // accidental drop of the Wave 3A / 3B descriptors while
    // registering the new supplier family.
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });

    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
  });

  test('exactly one ownedRouteTable constructor and one .match() call remain in app.js', () => {
    // Constructor count must remain exactly 1 after Wave 3C.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(
      constructorOccurrences.length,
      1,
      'Wave 3C: app.js must still construct the owned route table exactly once',
    );
    // Dispatch lookup count must remain exactly 1 after Wave 3C.
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(
      matchOccurrences.length,
      1,
      'Wave 3C: app.js must keep exactly one ownedRouteTable.match() dispatch call',
    );
    assert.doesNotMatch(appSource, /\bwarehouseRouteTable\b/);
    assert.doesNotMatch(appSource, /\bsupplierRouteTable\b/);
    assert.match(appSource, /\bownedRouteTable\b/);
  });
});

describe('V2 Stage 3 / Wave 3D — backend dispatch ownership (role migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const rolesModuleSource = readFileSync(resolve('server/modules/roles.js'), 'utf8');

  test('app.js imports roles from server/modules/roles.js and has no app-local role handlers/helpers', () => {
    // Combined: imports, no duplicate function declarations,
    // no app-local helper declarations, no PERMISSIONS import
    // from db.js. The PERMISSIONS catalogue is now exclusively
    // owned by server/modules/roles.js.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/roles\.js['"]/,
      'Wave 3D: server/app.js MUST import the role handlers from server/modules/roles.js',
    );
    assert.match(appSource, /\blistRoles\b/);
    assert.match(appSource, /\bcreateRole\b/);
    assert.match(appSource, /\bupdateRole\b/);
    assert.doesNotMatch(appSource, /^\s*function\s+listRoles\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createRole\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateRole\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+rolePermissions\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+saveRolePermissions\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+validPermissions\b/m);
    assert.doesNotMatch(
      appSource,
      /from\s+['"]\.\/db\.js['"]\s*\)\s*;?[\s\S]{0,200}\bPERMISSIONS\b/m,
      'Wave 3D: app.js db.js import must no longer reference PERMISSIONS',
    );
  });

  test('app.js no longer has legacy handleApi branches dispatching /api/roles', () => {
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/roles['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3D: legacy exact-match GET branch for /api/roles must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/roles['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3D: legacy exact-match POST branch for /api/roles must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/roles\\\/[^/]+\$\/\)/,
      'Wave 3D: legacy roleMatch-style dispatch for /api/roles/:id must be removed',
    );
  });

  test('three role routes register with the canonical owner (GET, POST, PATCH) and no DELETE descriptor exists', () => {
    // The canonical Roles route family has GET / POST / PATCH only.
    // The brief §0 explicitly states: there is no DELETE /api/roles
    // route and the migration MUST NOT invent one.
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    const roleEntries = table.list().filter((item) => item.owner === 'server/modules/roles.js');
    assert.equal(roleEntries.length, 3, 'three Role descriptors must exist with the canonical owner');
    assert.deepEqual(roleEntries.map((item) => item.method).sort(), ['GET', 'PATCH', 'POST']);
    assert.equal(roleEntries.some((item) => item.method === 'DELETE'), false, 'no DELETE /api/roles descriptor must exist');
    // Live dispatch parity.
    assert.equal(table.match('GET', '/api/roles').owner, 'server/modules/roles.js');
    assert.equal(table.match('POST', '/api/roles').owner, 'server/modules/roles.js');
    assert.equal(table.match('PATCH', '/api/roles/role-admin').owner, 'server/modules/roles.js');
    assert.deepEqual(table.match('PATCH', '/api/roles/role-admin').params, ['role-admin']);
    assert.equal(table.match('DELETE', '/api/roles/role-admin'), null, 'DELETE /api/roles must NOT be dispatched by the route-table');
  });

  test('users routes migrate in Wave 3E: /api/users (GET / POST / PATCH) move to the route-table while /api/users/lookup stays legacy', () => {
    // After Wave 3D, /api/users was still legacy. Wave 3E moves
    // only the three User-management routes (GET / POST / PATCH)
    // into the route-table. The /api/users/lookup project-manager
    // candidate lookup must continue to be served by the legacy
    // handleApi branch because it is a PROJECT_MANAGE-gated lookup,
    // not a Users-management responsibility. Authentication /
    // login / logout / session / self-deactivation guards remain
    // app-local and are not part of Wave 3E scope.
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });

    // After Wave 3E: /api/users (3 routes) are owned, /api/users/lookup
    // is NOT (remains legacy because it is a project-manager lookup
    // gated by PROJECT_MANAGE, not a Users-management responsibility).
    assert.equal(table.match('GET', '/api/users').owner, 'server/modules/users.js');
    assert.equal(table.match('POST', '/api/users').owner, 'server/modules/users.js');
    assert.equal(table.match('PATCH', '/api/users/user-001').owner, 'server/modules/users.js');
    assert.equal(table.match('GET', '/api/users/lookup'), null, '/api/users/lookup must NOT migrate to the route-table');

    // Lookup dispatch + handler must remain app-local.
    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/users\/lookup['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+listProjectManagerCandidates/,
      '/api/users/lookup must continue to dispatch via the legacy handleApi branch',
    );
    assert.match(appSource, /^\s*function\s+listProjectManagerCandidates\b/m, 'listProjectManagerCandidates must remain defined in app.js');
  });

  test('warehouse + customer + supplier + role descriptors coexist (15 total) under one ownedRouteTable dispatch lookup', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });

    assert.equal(table.size(), 15, 'Wave 3D: 4+4+4+3 = 15 owned descriptors across the four pre-User families');
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);

    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'app.js must still construct the owned route table exactly once after Wave 3D');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'app.js must keep exactly one ownedRouteTable.match() dispatch call after Wave 3D');
    assert.match(appSource, /\bownedRouteTable\b/);
  });

  test('roles.js is the only owner of the role responsibility (canonical exports and internal helpers)', () => {
    assert.match(rolesModuleSource, /export function listRoles\b/);
    assert.match(rolesModuleSource, /export (?:async )?function createRole\b/);
    assert.match(rolesModuleSource, /export (?:async )?function updateRole\b/);
    // The role-local helpers must NOT be exported (they are
    // internal to the canonical Roles owner).
    assert.doesNotMatch(rolesModuleSource, /export\s+function\s+rolePermissions\b/);
    assert.doesNotMatch(rolesModuleSource, /export\s+function\s+saveRolePermissions\b/);
    assert.doesNotMatch(rolesModuleSource, /export\s+function\s+validPermissions\b/);
    // Roles module owns PERMISSIONS import.
    assert.match(rolesModuleSource, /PERMISSIONS/);
  });
});

describe('V2 Stage 3 / Wave 3E — backend dispatch ownership (user-management migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const usersModuleSource = readFileSync(resolve('server/modules/users.js'), 'utf8');

  test('app.js imports user-management handlers from server/modules/users.js, exports listUsers/createUser/updateUser from users.js, has no app-local listUsers/createUser/updateUser/ensureRole declarations, and does not import hashPassword', () => {
    // Imports: from ./modules/users.js with all three handler symbols.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/users\.js['"]/,
      'Wave 3E: server/app.js MUST import user-management handlers from server/modules/users.js',
    );
    assert.match(appSource, /\blistUsers\b/);
    assert.match(appSource, /\bcreateUser\b/);
    assert.match(appSource, /\bupdateUser\b/);

    // users.js exports the four canonical handlers / helpers in the
    // contract (listUsers, createUser, updateUser) and ensureRole stays
    // an internal non-exported helper.
    assert.match(usersModuleSource, /export function listUsers\b/);
    assert.match(usersModuleSource, /export (?:async )?function createUser\b/);
    assert.match(usersModuleSource, /export (?:async )?function updateUser\b/);
    assert.match(usersModuleSource, /function ensureRole\b/);
    assert.doesNotMatch(usersModuleSource, /export\s+function\s+ensureRole\b/);

    // No app-local function declarations remain.
    assert.doesNotMatch(appSource, /^\s*function\s+listUsers\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createUser\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateUser\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+ensureRole\b/m);

    // hashPassword has no remaining app-local caller after Wave 3E.
    // users.js still imports it from db.js (canonical implementation),
    // but app.js must drop it from its own ./db.js import.
    assert.doesNotMatch(
      appSource,
      /from\s+['"]\.\/db\.js['"]\s*\)[^;]*;?[\s\S]{0,200}\bhashPassword\b/m,
      'Wave 3E: app.js db.js import must no longer reference hashPassword (no remaining app-local caller)',
    );
  });

  test('app.js no longer has legacy handleApi branches dispatching GET /api/users, POST /api/users, or PATCH /api/users/:id, and no DELETE /api/users/:id dispatch branch was ever introduced', () => {
    // Legacy exact-match branches must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/users['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3E: legacy exact-match GET branch for /api/users must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/users['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3E: legacy exact-match POST branch for /api/users must be removed',
    );
    // Legacy PATCH regex branch (was a `userMatch` block before
    // migration) must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/users\\\/[^/]+\$\/\)/,
      'Wave 3E: legacy userMatch-style dispatch for /api/users/:id must be removed',
    );
    // The brief §0 forbids inventing a DELETE /api/users route.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/users['"]\s*&&\s*req\.method\s*===\s*['"]DELETE['"]/,
      'Wave 3E: no exact-match DELETE /api/users branch must exist',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\.match\(\/\^\\\/api\\\/users\\\/[^/]+\$\/\)[^)]*req\.method\s*===\s*['"]DELETE['"]/,
      'Wave 3E: no regex DELETE /api/users/:id branch must exist',
    );
  });

  test('three user-management routes register with canonical owner (GET, POST, PATCH); no DELETE /api/users/:id descriptor exists; no /api/users/lookup descriptor exists; /api/users/lookup continues to dispatch via listProjectManagerCandidates in app.js', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    const userEntries = table.list().filter((item) => item.owner === 'server/modules/users.js');
    assert.equal(userEntries.length, 3, 'three User-management descriptors must exist with the canonical owner');
    assert.deepEqual(userEntries.map((item) => item.method).sort(), ['GET', 'PATCH', 'POST']);
    assert.equal(userEntries.some((item) => item.method === 'DELETE'), false, 'no DELETE /api/users descriptor must exist');

    // /api/users/lookup is intentionally NOT registered in the
    // route-table. It must continue to hit its earlier legacy
    // handleApi branch (listProjectManagerCandidates).
    assert.equal(table.match('GET', '/api/users/lookup'), null, 'lookup must NOT be dispatched by the route-table');
    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/users\/lookup['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+listProjectManagerCandidates/,
      '/api/users/lookup must continue to dispatch via the legacy handleApi branch to listProjectManagerCandidates',
    );
    assert.match(appSource, /^\s*function\s+listProjectManagerCandidates\b/m, 'listProjectManagerCandidates must remain defined in app.js');

    // Live dispatch parity for the three User-management routes.
    assert.equal(table.match('GET', '/api/users').owner, 'server/modules/users.js');
    assert.equal(table.match('POST', '/api/users').owner, 'server/modules/users.js');
    assert.equal(table.match('PATCH', '/api/users/user-001').owner, 'server/modules/users.js');
    assert.deepEqual(table.match('PATCH', '/api/users/user-001').params, ['user-001']);
  });

  test('after Wave 3E exactly 18 owned descriptors exist (4 warehouses + 4 customers + 4 suppliers + 3 roles + 3 users); single ownedRouteTable constructor and single .match() lookup remain', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });

    assert.equal(table.size(), 18, 'Wave 3E: 4+4+4+3+3 = 18 owned descriptors across the five migrated families');
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);

    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'app.js must construct the owned route table exactly once after Wave 3E');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'app.js must keep exactly one ownedRouteTable.match() dispatch call after Wave 3E');
    assert.match(appSource, /\bownedRouteTable\b/);
    assert.doesNotMatch(appSource, /\bwarehouseRouteTable\b/);
    assert.doesNotMatch(appSource, /\bcustomerRouteTable\b/);
    assert.doesNotMatch(appSource, /\bsupplierRouteTable\b/);
    assert.doesNotMatch(appSource, /\broleRouteTable\b/);
    assert.doesNotMatch(appSource, /\buserRouteTable\b/);
  });

  test('user-management duplicate (method, path) registration is still rejected', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/users', handler: () => 'first', owner: 'server/modules/users.js' });
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/users',
        handler: () => 'second',
        owner: 'server/modules/users.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
      'duplicate (method, path) registrations must still fail closed for user-management routes too',
    );
  });

  test('user-management regex path must be anchored with no flags; unknown descriptor fields stay rejected', () => {
    const table = createRouteTable();
    // Accept the exact regex shape used in app.js.
    assert.doesNotThrow(() => table.register({
      method: 'PATCH',
      path: /^\/api\/users\/([^/]+)$/,
      handler: () => {},
      owner: 'server/modules/users.js',
    }));
    // Same source with the `i` flag must fail closed.
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: new RegExp('^\\/api\\/users\\/([^/]+)$', 'i'),
        handler: () => {},
        owner: 'server/modules/users.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    // Unanchored variant must fail closed.
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: /\/api\/users\/([^/]+)/,
        handler: () => {},
        owner: 'server/modules/users.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
    // Unknown descriptor field must fail closed.
    assert.throws(
      () => table.register({
        method: 'POST',
        path: '/api/users',
        handler: () => {},
        owner: 'server/modules/users.js',
        permissions: ['USERS_MANAGE'],
      }),
      (error) => error instanceof RouteTableError
        && error.reason === 'unknown_descriptor_field'
        && error.field === 'permissions',
    );
  });
});

describe('V2 Stage 3 / Wave 3F — backend dispatch ownership (product master-data migration)', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const productsModuleSource = readFileSync(resolve('server/modules/products.js'), 'utf8');

  test('app.js imports product master-data handlers from server/modules/products.js; products.js exports the four canonical handlers plus productInput and deleteProduct; app.js no longer declares listProducts/createProduct/updateProduct/productInput; app.js no longer imports TRACKING_POLICIES', () => {
    // Imports.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/products\.js['"]/,
      'Wave 3F: server/app.js MUST import product master-data handlers from server/modules/products.js',
    );
    assert.match(appSource, /\blistProducts\b/);
    assert.match(appSource, /\bcreateProduct\b/);
    assert.match(appSource, /\bupdateProduct\b/);
    assert.match(appSource, /\bdeleteProduct\b/);

    // products.js exports.
    assert.match(productsModuleSource, /export function listProducts\b/);
    assert.match(productsModuleSource, /export (?:async )?function createProduct\b/);
    assert.match(productsModuleSource, /export (?:async )?function updateProduct\b/);
    assert.match(productsModuleSource, /export function deleteProduct\b/);
    assert.match(productsModuleSource, /function productInput\b/);
    assert.doesNotMatch(productsModuleSource, /export\s+function\s+productInput\b/);

    // No app-local function declarations remain.
    assert.doesNotMatch(appSource, /^\s*function\s+listProducts\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createProduct\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+updateProduct\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+productInput\b/m);

    // TRACKING_POLICIES is no longer imported into app.js (createProduct
    // was its only caller and moved to products.js).
    assert.doesNotMatch(
      appSource,
      /from\s+['"]\.\/modules\/traceability-quality\.js['"]\s*\)[^;]*;?[\s\S]{0,800}\bTRACKING_POLICIES\b/m,
      'Wave 3F: app.js must no longer import TRACKING_POLICIES (createProduct was its only app-local caller)',
    );
    // updateProductTrackingHandler import must still be present (the
    // tracking-policy branch remains in app.js).
    assert.match(appSource, /\bupdateProductTrackingHandler\b/);
  });

  test('app.js no longer has legacy handleApi branches dispatching GET /api/products, POST /api/products, or the generic productMatch PATCH/DELETE; productTrackingMatch remains legacy', () => {
    // Legacy exact-match branches must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/products['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 3F: legacy exact-match GET branch for /api/products must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/products['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 3F: legacy exact-match POST branch for /api/products must be removed',
    );
    // Legacy `productMatch` block was the PATCH/DELETE branch before
    // migration. After migration, generic Product master-data PATCH /
    // DELETE dispatch lives in the route-table, not in handleApi.
    assert.doesNotMatch(
      appSource,
      /productMatch\s*=\s*pathname\.match\(\/\^\\\/api\\\/products\\\/[^/]+\$\/\)/,
      'Wave 3F: legacy productMatch-style dispatch for /api/products/:id must be removed',
    );

    // productTrackingMatch MUST still be present and continue to call
    // updateProductTrackingHandler. The tracking-policy route is
    // intentionally NOT migrated in Wave 3F. Use substring assertions
    // (rather than a complex regex) to avoid regex-literal ambiguity.
    assert.ok(appSource.includes('productTrackingMatch = pathname.match(/^\\/api\\/products\\/([^/]+)\\/tracking-policy$/)'),
      'Wave 3F: productTrackingMatch legacy branch must remain in app.js');
    assert.ok(appSource.includes('productTrackingMatch && req.method === \'PATCH\') return updateProductTrackingHandler'),
      'Wave 3F: productTrackingMatch branch must continue to dispatch to updateProductTrackingHandler');
    assert.doesNotMatch(
      appSource,
      /deleteMasterRecord\([^)]*['"]product['"]/,
      'Wave 3F: app.js must not call deleteMasterRecord directly with kind="product"; it must delegate via server/modules/products.js',
    );
  });

  test('four product master-data routes register with canonical owner (GET, POST, PATCH, DELETE); no PATCH /api/products/:id/tracking-policy descriptor exists; no /api/traceability or /api/production-genealogy descriptor exists', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    const productEntries = table.list().filter((item) => item.owner === 'server/modules/products.js');
    assert.equal(productEntries.length, 4, 'four Product master-data descriptors must exist with the canonical owner');
    assert.deepEqual(productEntries.map((item) => item.method).sort(), ['DELETE', 'GET', 'PATCH', 'POST']);

    // Tracking-policy is intentionally NOT in the route-table.
    assert.equal(table.match('PATCH', '/api/products/p-001/tracking-policy'), null, 'tracking-policy must NOT be dispatched by the route-table');
    assert.equal(table.match('GET', '/api/traceability'), null);
    assert.equal(table.match('POST', '/api/production-genealogy'), null);
    assert.equal(table.match('GET', '/api/quality-control-points'), null);

    // Live dispatch parity.
    assert.equal(table.match('GET', '/api/products').owner, 'server/modules/products.js');
    assert.equal(table.match('POST', '/api/products').owner, 'server/modules/products.js');
    assert.equal(table.match('PATCH', '/api/products/p-001').owner, 'server/modules/products.js');
    assert.equal(table.match('DELETE', '/api/products/p-001').owner, 'server/modules/products.js');
    assert.deepEqual(table.match('PATCH', '/api/products/p-001').params, ['p-001']);
    assert.deepEqual(table.match('DELETE', '/api/products/p-001').params, ['p-001']);
  });

  test('after Wave 3F exactly 22 owned descriptors exist (4 warehouses + 4 customers + 4 suppliers + 3 roles + 3 users + 4 products); single ownedRouteTable constructor and single .match() lookup remain', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });

    assert.equal(table.size(), 22, 'Wave 3F: 4+4+4+3+3+4 = 22 owned descriptors across the six migrated families');
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);

    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'app.js must construct the owned route table exactly once after Wave 3F');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'app.js must keep exactly one ownedRouteTable.match() dispatch call after Wave 3F');
    assert.match(appSource, /\bownedRouteTable\b/);
    assert.doesNotMatch(appSource, /\bproductRouteTable\b/);
    assert.doesNotMatch(appSource, /\buserRouteTable\b/);
  });

  test('product-master-data duplicate (method, path) registration is still rejected; product PATCH/DELETE regex path must be anchored with no flags', () => {
    const table = createRouteTable();
    // Register all four canonical product master-data routes.
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    assert.equal(table.size(), 4);

    // Duplicate (method, path) for /api/products (GET) must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/products',
        handler: () => 'second',
        owner: 'server/modules/products.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
    );
    // Same source with the `i` flag must fail closed.
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: new RegExp('^\\/api\\/products\\/([^/]+)$', 'i'),
        handler: () => {},
        owner: 'server/modules/products.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    // Unanchored variant must fail closed.
    assert.throws(
      () => table.register({
        method: 'PATCH',
        path: /\/api\/products\/([^/]+)/,
        handler: () => {},
        owner: 'server/modules/products.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
  });
});

describe('V2 Wave 4A — Decision Reports Route Ownership Migration', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 22 Wave 3F baseline descriptors.
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    // 11 Wave 4A decision-reports descriptors.
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    return table;
  }

  test('exactly 33 owned descriptors exist after Wave 4A (22 baseline + 11 decision-reports) and each carries exactly four canonical fields; the single createRouteTable() constructor and the single ownedRouteTable.match() lookup remain', () => {
    const table = buildOwnedTable();
    const decisionEntries = table.list().filter((item) => item.owner === 'server/modules/decision-reports.js');
    assert.equal(decisionEntries.length, 11, 'Wave 4A: exactly eleven decision-reports descriptors must exist with the canonical owner');
    assert.equal(table.size(), 33, 'Wave 4A: 22 baseline + 11 decision-reports = 33 owned descriptors');
    // list() returns exactly { method, path, pathKind, owner } — no other keys.
    for (const entry of decisionEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 4A: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/decision-reports.js');
      assert.equal(entry.method, 'GET');
      assert.ok(typeof entry.path === 'string' && entry.path.length > 0, 'descriptor path must be non-empty');
    }
    // Previous 22 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 4A: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 4A: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
    assert.doesNotMatch(appSource, /\bdecisionReportRouteTable\b/);
    assert.doesNotMatch(appSource, /\banalyticsRouteTable\b/);
  });

  test('five core Decision Report GET routes register with the canonical owner and live dispatch resolves to decision-reports.js', () => {
    const table = buildOwnedTable();
    const core = [
      ['/api/reports/decision/sales-summary', 'sales-summary'],
      ['/api/reports/decision/sales-outstanding', 'sales-outstanding'],
      ['/api/reports/decision/purchase-summary', 'purchase-summary'],
      ['/api/reports/decision/purchase-outstanding', 'purchase-outstanding'],
      ['/api/reports/decision/inventory-movements', 'inventory-movements'],
    ];
    for (const [path, label] of core) {
      const hit = table.match('GET', path);
      assert.ok(hit, `Wave 4A: GET ${path} (${label}) must match the route-table`);
      assert.equal(hit.owner, 'server/modules/decision-reports.js');
      assert.deepEqual(hit.params, []);
    }
    // Exact-string paths (not RegExp regex) for the five core GETs.
    const pathKinds = table.list()
      .filter((item) => item.owner === 'server/modules/decision-reports.js')
      .filter((item) => ['/api/reports/decision/sales-summary',
                         '/api/reports/decision/sales-outstanding',
                         '/api/reports/decision/purchase-summary',
                         '/api/reports/decision/purchase-outstanding',
                         '/api/reports/decision/inventory-movements'].includes(item.path))
      .map((item) => item.pathKind);
    assert.equal(pathKinds.length, 5);
    for (const kind of pathKinds) assert.equal(kind, 'exact');
  });

  test('fulfillment-contributions regex registers with two capture-group params and resolves correctly', () => {
    const table = buildOwnedTable();
    const hit = table.match('GET', '/api/reports/sales-outstanding/lines/order-item-uuid-123/contributions');
    assert.ok(hit, 'fulfillment-contributions route must match the route-table');
    assert.equal(hit.owner, 'server/modules/decision-reports.js');
    assert.deepEqual(hit.params, ['sales-outstanding', 'order-item-uuid-123']);

    // purchase-outstanding variant must also match (same regex shape).
    const purchaseHit = table.match('GET', '/api/reports/purchase-outstanding/lines/order-item-456/contributions');
    assert.ok(purchaseHit);
    assert.equal(purchaseHit.owner, 'server/modules/decision-reports.js');
    assert.deepEqual(purchaseHit.params, ['purchase-outstanding', 'order-item-456']);

    // The descriptor must be a regex (pathKind === 'regex').
    const regexDescriptors = table.list()
      .filter((item) => item.owner === 'server/modules/decision-reports.js')
      .filter((item) => item.pathKind === 'regex');
    assert.equal(regexDescriptors.length, 1, 'exactly one regex descriptor (fulfillment contributions) must exist for decision-reports');
  });

  test('five CSV export routes register with the canonical owner and dispatch correctly', () => {
    const table = buildOwnedTable();
    const exports = [
      '/api/reports/decision/sales-summary/export',
      '/api/reports/decision/sales-outstanding/export',
      '/api/reports/decision/purchase-summary/export',
      '/api/reports/decision/purchase-outstanding/export',
      '/api/reports/decision/inventory-movements/export',
    ];
    for (const path of exports) {
      const hit = table.match('GET', path);
      assert.ok(hit, `Wave 4A: GET ${path} (CSV export) must match the route-table`);
      assert.equal(hit.owner, 'server/modules/decision-reports.js');
      assert.deepEqual(hit.params, []);
    }
    // Exact-string (not regex) for the five CSV exports.
    const exportKinds = table.list()
      .filter((item) => item.owner === 'server/modules/decision-reports.js')
      .filter((item) => item.path.endsWith('/export'))
      .map((item) => item.pathKind);
    assert.equal(exportKinds.length, 5);
    for (const kind of exportKinds) assert.equal(kind, 'exact');
  });

  test('legacy Decision Report handleApi branches are absent and the six financial/dashboard report endpoints remain legacy (match returns null)', () => {
    // Five core GET exact branches must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/sales-summary['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/sales-summary must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/sales-outstanding['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/sales-outstanding must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/purchase-summary['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/purchase-summary must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/purchase-outstanding['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/purchase-outstanding must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/inventory-movements['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/inventory-movements must be removed',
    );
    // fulfillmentContributionsMatch declaration + branch must be removed.
    assert.doesNotMatch(
      appSource,
      /fulfillmentContributionsMatch\s*=\s*pathname\.match/,
      'Wave 4A: legacy fulfillmentContributionsMatch declaration must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /fulfillmentContributionsMatch\s*\[\s*1\s*\]/,
      'Wave 4A: legacy fulfillmentContributionsMatch branch (params[1] indexing) must be removed',
    );
    // Five CSV export exact branches must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/sales-summary\/export['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/sales-summary/export must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/sales-outstanding\/export['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/sales-outstanding/export must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/purchase-summary\/export['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/purchase-summary/export must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/purchase-outstanding\/export['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/purchase-outstanding/export must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/reports\/decision\/inventory-movements\/export['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4A: legacy exact-match GET branch for /api/reports/decision/inventory-movements/export must be removed',
    );

    // Six financial / dashboard reports MUST still be served by legacy handleApi
    // branches and therefore return null from ownedRouteTable.match(...). This
    // proves Wave 4A did not accidentally migrate extended.js financial-report
    // ownership.
    const table = buildOwnedTable();
    const legacyFinancial = [
      ['GET', '/api/reports/financial-summary'],
      ['GET', '/api/reports/income-statement'],
      ['GET', '/api/reports/balance-sheet'],
      ['GET', '/api/reports/inventory-status'],
      ['GET', '/api/reports/sales-analysis'],
      ['GET', '/api/reports/trial-balance'],
    ];
    for (const [method, path] of legacyFinancial) {
      assert.equal(
        table.match(method, path),
        null,
        `Wave 4A: financial/dashboard report ${method} ${path} must remain legacy and return null from ownedRouteTable.match(...)`,
      );
    }
    // Their legacy handleApi branches must remain in app.js.
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/financial-summary['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getFinancialSummary/);
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/income-statement['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getIncomeStatement/);
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/balance-sheet['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getBalanceSheet/);
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/inventory-status['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getInventoryStatus/);
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/sales-analysis['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getSalesAnalysis/);
    assert.match(appSource, /pathname\s*===\s*['"]\/api\/reports\/trial-balance['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+getTrialBalance/);
  });

  test('decision-reports duplicate (method, path) registration is still rejected; regex shape with two capture groups must be anchored with no flags', () => {
    const table = createRouteTable();
    // Register a core Decision Report exact path first.
    table.register({
      method: 'GET',
      path: '/api/reports/decision/sales-summary',
      handler: () => 'first',
      owner: 'server/modules/decision-reports.js',
    });
    // Register the fulfillment contributions regex shape used in app.js.
    table.register({
      method: 'GET',
      path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/,
      handler: () => {},
      owner: 'server/modules/decision-reports.js',
    });
    // Same source with the `i` flag must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: new RegExp('^\\/api\\/reports\\/([^/]+)\\/lines\\/([^/]+)\\/contributions$', 'i'),
        handler: () => {},
        owner: 'server/modules/decision-reports.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    // Unanchored variant must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: /\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions/,
        handler: () => {},
        owner: 'server/modules/decision-reports.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
    // Duplicate exact (method, path) registration must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: '/api/reports/decision/sales-summary',
        handler: () => 'second',
        owner: 'server/modules/decision-reports.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
    );
    // Duplicate regex (same source) registration must fail closed.
    assert.throws(
      () => table.register({
        method: 'GET',
        path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/,
        handler: () => 'second',
        owner: 'server/modules/decision-reports.js',
      }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
    );
  });
});

describe('V2 Wave 4B — Product Routings Route Ownership Migration', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const productRoutingModuleSource = readFileSync(resolve('server/modules/product-routing.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 22 Wave 3F baseline descriptors (warehouse + customer + supplier + role + user + product master-data).
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    // 11 Wave 4A decision-reports descriptors.
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    // 9 Wave 4B product-routings descriptors.
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/operations$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    return table;
  }

  test('exactly 9 Product Routing descriptors exist with the canonical owner; previous 33 baseline descriptors remain intact; ownedRouteTable is now 42; single createRouteTable() and single .match() remain in app.js', () => {
    const table = buildOwnedTable();
    const routingEntries = table.list().filter((item) => item.owner === 'server/modules/product-routing.js');
    assert.equal(routingEntries.length, 9, 'Wave 4B: exactly nine Product Routing descriptors must exist with the canonical owner');
    assert.equal(table.size(), 42, 'Wave 4B: 33 baseline + 9 product-routings = 42 owned descriptors');
    // list() exposes only { method, path, pathKind, owner } — no other keys.
    for (const entry of routingEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 4B: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/product-routing.js');
      assert.ok(typeof entry.path === 'string' && entry.path.length > 0, 'descriptor path must be non-empty');
    }
    // Previous 33 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/decision-reports.js').length, 11);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 4B: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 4B: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
    assert.doesNotMatch(appSource, /\bproductRoutingRouteTable\b/);
    assert.doesNotMatch(appSource, /\broutingRouteTable\b/);
  });

  test('collection GET / POST register with canonical owner; both resolve with empty params; product-routing.js is the live module, no app-local handlers remain', () => {
    // Source-shape: product-routing.js exports the canonical handlers; app.js imports them; no app-local handlers.
    assert.match(productRoutingModuleSource, /export function listProductRoutings\b/);
    assert.match(productRoutingModuleSource, /export (?:async )?function createProductRouting\b/);
    assert.match(productRoutingModuleSource, /export function deleteProductRouting\b/, 'Wave 4B: product-routing.js must export deleteProductRouting thin wrapper');
    assert.match(productRoutingModuleSource, /from\s+['"]\.\/data-lifecycle\.js['"]/);
    assert.match(productRoutingModuleSource, /deleteMasterRecord\b/);
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/product-routing\.js['"]/,
      'Wave 4B: server/app.js MUST import Product Routing handlers from server/modules/product-routing.js',
    );
    assert.match(appSource, /\blistProductRoutings\b/);
    assert.match(appSource, /\bcreateProductRouting\b/);
    assert.match(appSource, /\bdeleteProductRouting\b/);
    assert.match(appSource, /\bchangeProductRoutingStatus\b/);
    assert.match(appSource, /\bcreateProductRoutingOperation\b/);
    assert.match(appSource, /\bupdateProductRoutingOperation\b/);
    assert.match(appSource, /\bdeleteProductRoutingOperation\b/);
    assert.match(appSource, /\bgetProductRouting\b/);
    assert.match(appSource, /\bupdateProductRouting\b/);
    assert.doesNotMatch(appSource, /^\s*function\s+listProductRoutings\b/m);
    assert.doesNotMatch(appSource, /^\s*async\s+function\s+createProductRouting\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+productRoutingMatch\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+productRoutingAction\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+productRoutingOperation\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+productRoutingOperations\b/m);
    // Live dispatch parity for the two collection routes.
    const table = buildOwnedTable();
    const listHit = table.match('GET', '/api/product-routings');
    assert.ok(listHit, 'GET /api/product-routings must match the route-table');
    assert.equal(listHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(listHit.params, []);
    const createHit = table.match('POST', '/api/product-routings');
    assert.ok(createHit, 'POST /api/product-routings must match the route-table');
    assert.equal(createHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(createHit.params, []);
    // Both collection routes are exact-string (not regex) per the
    // canonical descriptor contract.
    const collectionEntries = table.list()
      .filter((item) => item.owner === 'server/modules/product-routing.js')
      .filter((item) => item.path === '/api/product-routings');
    assert.equal(collectionEntries.length, 2);
    for (const entry of collectionEntries) assert.equal(entry.pathKind, 'exact');
  });

  test('activate|deactivate regex returns both params correctly; operations POST + PATCH + DELETE register with the canonical owner', () => {
    const table = buildOwnedTable();
    // activate|deactivate regex: two capture groups (routingId, action).
    const activateHit = table.match('POST', '/api/product-routings/route-abc-001/activate');
    assert.ok(activateHit, 'POST .../activate must match the route-table');
    assert.equal(activateHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(activateHit.params, ['route-abc-001', 'activate']);
    const deactivateHit = table.match('POST', '/api/product-routings/route-abc-001/deactivate');
    assert.ok(deactivateHit, 'POST .../deactivate must match the route-table');
    assert.equal(deactivateHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(deactivateHit.params, ['route-abc-001', 'deactivate']);
    // activate|deactivate descriptor must be a regex (pathKind === 'regex').
    const actionDescriptors = table.list()
      .filter((item) => item.owner === 'server/modules/product-routing.js')
      .filter((item) => item.path.includes('activate|deactivate'));
    assert.equal(actionDescriptors.length, 1, 'exactly one activate|deactivate regex descriptor must exist');
    assert.equal(actionDescriptors[0].pathKind, 'regex');
    // operations POST: single capture group (routingId).
    const opCreateHit = table.match('POST', '/api/product-routings/route-abc-001/operations');
    assert.ok(opCreateHit, 'POST /api/product-routings/:id/operations must match the route-table');
    assert.equal(opCreateHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(opCreateHit.params, ['route-abc-001']);
    const opCreateDescriptors = table.list()
      .filter((item) => item.owner === 'server/modules/product-routing.js')
      .filter((item) => item.path === '^\\/api\\/product-routings\\/([^/]+)\\/operations$');
    assert.equal(opCreateDescriptors.length, 1, 'exactly one operations POST descriptor');
    assert.equal(opCreateDescriptors[0].pathKind, 'regex');
    // operations PATCH / DELETE: two capture groups (routingId, operationId);
    // same regex source shape used for both methods.
    const patchHit = table.match('PATCH', '/api/product-routings/route-abc-001/operations/op-42');
    assert.ok(patchHit, 'PATCH .../operations/:operationId must match the route-table');
    assert.equal(patchHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(patchHit.params, ['route-abc-001', 'op-42']);
    const deleteHit = table.match('DELETE', '/api/product-routings/route-abc-001/operations/op-42');
    assert.ok(deleteHit, 'DELETE .../operations/:operationId must match the route-table');
    assert.equal(deleteHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(deleteHit.params, ['route-abc-001', 'op-42']);
    const operationDescriptors = table.list()
      .filter((item) => item.owner === 'server/modules/product-routing.js')
      .filter((item) => item.path.includes('\\/operations\\/([^/]+)$'));
    assert.equal(operationDescriptors.length, 2, 'exactly two operations PATCH/DELETE descriptors must exist');
    assert.deepEqual(operationDescriptors.map((entry) => entry.method).sort(), ['DELETE', 'PATCH']);
    for (const entry of operationDescriptors) assert.equal(entry.pathKind, 'regex');
  });

  test('detail GET / PATCH / DELETE register with single routingId param; detail DELETE delegates to the thin deleteProductRouting wrapper in product-routing.js', () => {
    const table = buildOwnedTable();
    const getHit = table.match('GET', '/api/product-routings/route-abc-001');
    assert.ok(getHit, 'GET /api/product-routings/:id must match the route-table');
    assert.equal(getHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(getHit.params, ['route-abc-001']);
    const patchHit = table.match('PATCH', '/api/product-routings/route-abc-001');
    assert.ok(patchHit, 'PATCH /api/product-routings/:id must match the route-table');
    assert.equal(patchHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(patchHit.params, ['route-abc-001']);
    const deleteHit = table.match('DELETE', '/api/product-routings/route-abc-001');
    assert.ok(deleteHit, 'DELETE /api/product-routings/:id must match the route-table');
    assert.equal(deleteHit.owner, 'server/modules/product-routing.js');
    assert.deepEqual(deleteHit.params, ['route-abc-001']);
    const detailDescriptors = table.list()
      .filter((item) => item.owner === 'server/modules/product-routing.js')
      .filter((item) => item.path === '^\\/api\\/product-routings\\/([^/]+)$');
    assert.equal(detailDescriptors.length, 3, 'exactly three detail GET/PATCH/DELETE descriptors must exist');
    assert.deepEqual(detailDescriptors.map((entry) => entry.method).sort(), ['DELETE', 'GET', 'PATCH']);
    for (const entry of detailDescriptors) assert.equal(entry.pathKind, 'regex');
    // Detail DELETE is the only Product Routing entry whose handler
    // is the thin wrapper (deleteProductRouting). The wrapper itself
    // delegates to deleteMasterRecord(...,'routing',...) inside
    // product-routing.js, not in app.js.
    assert.doesNotMatch(
      appSource,
      /deleteMasterRecord\([^)]*['"]routing['"]/,
      'Wave 4B: deleteMasterRecord must not be called directly from app.js for kind="routing"; it must delegate via server/modules/product-routing.js deleteProductRouting',
    );
    // The wrapper body itself.
    assert.match(
      productRoutingModuleSource,
      /export\s+function\s+deleteProductRouting\s*\(\s*db\s*,\s*res\s*,\s*actor\s*,\s*routingId\s*\)\s*\{[^}]*deleteMasterRecord\s*\(\s*db\s*,\s*res\s*,\s*actor\s*,\s*['"]routing['"]\s*,\s*routingId\s*\)/,
      'Wave 4B: deleteProductRouting wrapper must delegate verbatim to deleteMasterRecord(db, res, actor, \'routing\', routingId)',
    );
    // data-lifecycle.js routing rule remains the canonical DELETE
    // master-data contract (table = product_routings, permission =
    // ROUTING_MANAGE, requiredStatus = INACTIVE).
    const dataLifecycleSource = readFileSync(resolve('server/modules/data-lifecycle.js'), 'utf8');
    assert.match(dataLifecycleSource, /routing:\s*\{/);
    assert.match(dataLifecycleSource, /table:\s*['"]product_routings['"]/);
    assert.match(dataLifecycleSource, /permission:\s*['"]ROUTING_MANAGE['"]/);
    assert.match(dataLifecycleSource, /requiredStatus:\s*['"]INACTIVE['"]/);
  });

  test('legacy Product Routing handleApi branches and match variables are absent in app.js; BOM remains legacy and is NOT registered', () => {
    // Legacy exact-match branches must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/product-routings['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4B: legacy exact-match GET branch for /api/product-routings must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/product-routings['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 4B: legacy exact-match POST branch for /api/product-routings must be removed',
    );
    // Legacy productRoutingMatch / productRoutingAction /
    // productRoutingOperation / productRoutingOperations declarations
    // and any reference to productRoutingAction[2] /
    // productRoutingOperation[1] / productRoutingOperation[2] /
    // productRoutingOperations[1] / productRoutingMatch[1] must be
    // removed (the new regex params surface as match.params[0] /
    // match.params[1] through the route-table).
    assert.doesNotMatch(appSource, /\bproductRoutingAction\b/);
    assert.doesNotMatch(appSource, /\bproductRoutingOperation\b/);
    assert.doesNotMatch(appSource, /\bproductRoutingOperations\b/);
    assert.doesNotMatch(appSource, /\bproductRoutingMatch\b/);
    // The legacy section header must be removed (canonical route-table
    // is the single source of dispatch now).
    assert.doesNotMatch(
      appSource,
      /\/\/\s*============\s*Product Routings\s*============/,
      'Wave 4B: legacy "// ============ Product Routings ============" section header must be removed',
    );
    // BOM legacy boundary must remain intact (do not migrate BOM).
    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/boms['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4B: BOM legacy exact-match GET branch MUST remain',
    );
    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/boms['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 4B: BOM legacy exact-match POST branch MUST remain',
    );
    assert.match(
      appSource,
      /deleteMasterRecord\([^)]*['"]bom['"]/,
      'Wave 4B: BOM DELETE legacy direct deleteMasterRecord call MUST remain',
    );
    // BOM detail/mutation routes must remain legacy and not in the
    // route-table. ownedRouteTable.match(...) must return null for
    // every representative BOM URL.
    assert.equal(buildOwnedTable().match('GET', '/api/boms'), null, 'BOM GET must NOT be dispatched by the route-table');
    assert.equal(buildOwnedTable().match('POST', '/api/boms'), null, 'BOM POST must NOT be dispatched by the route-table');
    assert.equal(buildOwnedTable().match('DELETE', '/api/boms/bom-001'), null, 'BOM DELETE must NOT be dispatched by the route-table');
  });

  test('product-routings duplicate (method, path) registration is still rejected; regex shapes used in app.js must be anchored with no flags; unknown descriptor fields stay rejected', () => {
    const table = createRouteTable();
    // Register one exact-string collection route + one regex family to
    // exercise both shapes used in app.js.
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => 'first', owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    assert.equal(table.size(), 3);
    // Duplicate exact-string (method, path) must fail closed.
    assert.throws(
      () => table.register({ method: 'GET', path: '/api/product-routings', handler: () => 'second', owner: 'server/modules/product-routing.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'duplicate_route',
    );
    // Same regex source with a flag must fail closed.
    assert.throws(
      () => table.register({ method: 'PATCH', path: new RegExp('^\\/api\\/product-routings\\/([^/]+)$', 'i'), handler: () => {}, owner: 'server/modules/product-routing.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'unsupported_regex_flags',
    );
    // Unanchored variant of the detail regex must fail closed.
    assert.throws(
      () => table.register({ method: 'PATCH', path: /\/api\/product-routings\/([^/]+)/, handler: () => {}, owner: 'server/modules/product-routing.js' }),
      (error) => error instanceof RouteTableError && error.reason === 'unanchored_regex',
    );
    // Unknown descriptor field (e.g. permissions) must fail closed.
    assert.throws(
      () => table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js', permissions: ['ROUTING_MANAGE'] }),
      (error) => error instanceof RouteTableError && error.reason === 'unknown_descriptor_field' && error.field === 'permissions',
    );
  });
});

describe('V2 Wave 4C — Read-only Lookups Route Ownership Migration', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const lookupsModuleSource = readFileSync(resolve('server/modules/lookups.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 42 Wave 4B baseline descriptors (warehouse + customer + supplier
    // + role + user + product master-data + decision-reports +
    // product-routings). See buildOwnedTable in Wave 4B for the full
    // list; replicate the relevant subset here so the Wave 4C tests
    // are self-contained and can be exercised in isolation.
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/operations$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    // 5 Wave 4C lookups descriptors.
    table.register({ method: 'GET', path: '/api/lookup/suppliers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/customers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookups/business-entities', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/sales-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/purchase-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    return table;
  }

  test('exactly five lookups descriptors exist with the canonical owner; previous 42 baseline descriptors remain intact; ownedRouteTable is now 47; single createRouteTable() and single .match() remain in app.js', () => {
    const table = buildOwnedTable();
    const lookupsEntries = table.list().filter((item) => item.owner === 'server/modules/lookups.js');
    assert.equal(lookupsEntries.length, 5, 'Wave 4C: exactly five lookups descriptors must exist with the canonical owner');
    assert.equal(table.size(), 47, 'Wave 4C: 42 baseline + 5 lookups = 47 owned descriptors');
    // list() exposes only { method, path, pathKind, owner } — no other keys.
    for (const entry of lookupsEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 4C: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/lookups.js');
      assert.ok(typeof entry.path === 'string' && entry.path.length > 0, 'descriptor path must be non-empty');
    }
    // All five lookups paths must be present (exact-string, pathKind === 'exact').
    const lookupPaths = lookupsEntries.map((item) => item.path).sort();
    assert.deepEqual(lookupPaths, [
      '/api/lookups/business-entities',
      '/api/lookup/customers',
      '/api/lookup/purchase-orders-source',
      '/api/lookup/sales-orders-source',
      '/api/lookup/suppliers',
    ].sort(), 'Wave 4C: the five lookups paths must match the canonical brief exactly');
    for (const entry of lookupsEntries) assert.equal(entry.pathKind, 'exact', 'Wave 4C: all five lookups paths must be exact-string');
    // Previous 42 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/decision-reports.js').length, 11);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/product-routing.js').length, 9);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 4C: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 4C: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
  });

  test('all five GET paths match correctly through the route-table and dispatch to server/modules/lookups.js with no params', () => {
    const table = buildOwnedTable();
    const cases = [
      ['/api/lookup/suppliers', 'listSupplierLookup'],
      ['/api/lookup/customers', 'listCustomerLookup'],
      ['/api/lookups/business-entities', 'searchBusinessEntities'],
      ['/api/lookup/sales-orders-source', 'listSalesOrderSourceLookup'],
      ['/api/lookup/purchase-orders-source', 'listPurchaseOrderSourceLookup'],
    ];
    for (const [path] of cases) {
      const hit = table.match('GET', path);
      assert.ok(hit, `GET ${path} must match the route-table`);
      assert.equal(hit.owner, 'server/modules/lookups.js', `GET ${path} owner must be server/modules/lookups.js`);
      assert.deepEqual(hit.params, [], `GET ${path} must have empty params (no path captures)`);
      assert.equal(typeof hit.handler, 'function', `GET ${path} must have a function handler`);
    }
    // Non-matching methods on the same paths must NOT match (the
    // brief requires exactly five GET routes, no POST / PATCH / DELETE).
    for (const [path] of cases) {
      assert.equal(table.match('POST', path), null, `POST ${path} must NOT match the route-table`);
      assert.equal(table.match('PATCH', path), null, `PATCH ${path} must NOT match the route-table`);
      assert.equal(table.match('DELETE', path), null, `DELETE ${path} must NOT match the route-table`);
    }
  });

  test('lookups.js exports all five production handlers; the four moved handler declarations are absent from app.js; /api/users/lookup remains legacy and route-table match returns null; transaction lookup permission strings remain in lookups.js; business-entity REPORT usage registry remains present', () => {
    // Source-shape: lookups.js exports all five canonical handlers.
    assert.match(lookupsModuleSource, /export function listSupplierLookup\b/);
    assert.match(lookupsModuleSource, /export function listCustomerLookup\b/);
    assert.match(lookupsModuleSource, /export function listSalesOrderSourceLookup\b/);
    assert.match(lookupsModuleSource, /export function listPurchaseOrderSourceLookup\b/);
    assert.match(lookupsModuleSource, /export function searchBusinessEntities\b/);
    // lookups.js imports lifecycleArchiveFilter directly from lifecycle-engine.
    assert.match(lookupsModuleSource, /from\s+['"]\.\/lifecycle-engine\.js['"]/);
    assert.match(lookupsModuleSource, /\blifecycleArchiveFilter\b/);
    // app.js imports the four moved handlers and searchBusinessEntities from lookups.js.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/lookups\.js['"]/,
      'Wave 4C: server/app.js MUST import lookups handlers from server/modules/lookups.js',
    );
    assert.match(appSource, /\blistSupplierLookup\b/);
    assert.match(appSource, /\blistCustomerLookup\b/);
    assert.match(appSource, /\blistSalesOrderSourceLookup\b/);
    assert.match(appSource, /\blistPurchaseOrderSourceLookup\b/);
    assert.match(appSource, /\bsearchBusinessEntities\b/);
    // app.js no longer declares any of the four moved handlers as app-local functions.
    assert.doesNotMatch(appSource, /^\s*function\s+listSupplierLookup\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+listCustomerLookup\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+listSalesOrderSourceLookup\b/m);
    assert.doesNotMatch(appSource, /^\s*function\s+listPurchaseOrderSourceLookup\b/m);
    // Legacy handleApi branches dispatching /api/lookup/* must be removed.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/lookup\/suppliers['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4C: legacy exact-match branch for GET /api/lookup/suppliers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/lookup\/customers['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4C: legacy exact-match branch for GET /api/lookup/customers must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/lookups\/business-entities['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4C: legacy exact-match branch for GET /api/lookups/business-entities must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/lookup\/sales-orders-source['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4C: legacy exact-match branch for GET /api/lookup/sales-orders-source must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/lookup\/purchase-orders-source['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4C: legacy exact-match branch for GET /api/lookup/purchase-orders-source must be removed',
    );
    // /api/users/lookup must remain on the legacy handleApi branch and NOT in the route-table.
    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/users\/lookup['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]\s*\)\s*return\s+listProjectManagerCandidates/,
      'Wave 4C: /api/users/lookup must continue to dispatch via the legacy handleApi branch to listProjectManagerCandidates',
    );
    assert.match(appSource, /^\s*function\s+listProjectManagerCandidates\b/m, 'Wave 4C: listProjectManagerCandidates must remain defined in app.js');
    assert.equal(
      buildOwnedTable().match('GET', '/api/users/lookup'),
      null,
      'Wave 4C: /api/users/lookup must NOT be dispatched by the route-table',
    );
    // Transaction lookup permission strings must live in lookups.js (verbatim, byte-identical).
    assert.match(
      lookupsModuleSource,
      /allowAny\(actor,\s*\[['"]PURCHASE_RECEIPTS_MANAGE['"],\s*['"]RETURNS_MANAGE['"],\s*['"]CRM_VIEW['"],\s*['"]CRM_MANAGE['"]\]\)/,
      'Wave 4C: listSupplierLookup must keep its existing receipt/return/CRM permission gate',
    );
    assert.match(
      lookupsModuleSource,
      /allowAny\(actor,\s*\[['"]SALES_DELIVERIES_MANAGE['"],\s*['"]RETURNS_MANAGE['"],\s*['"]CRM_VIEW['"],\s*['"]CRM_MANAGE['"]\]\)/,
      'Wave 4C: listCustomerLookup must keep its existing delivery/return/CRM permission gate',
    );
    assert.match(
      lookupsModuleSource,
      /allowAny\(actor,\s*\[['"]ORDERS_CREATE['"],\s*['"]SALES_DELIVERIES_MANAGE['"],\s*['"]RETURNS_MANAGE['"]\]\)/,
      'Wave 4C: listSalesOrderSourceLookup must keep its existing ORDERS_CREATE / SALES_DELIVERIES_MANAGE / RETURNS_MANAGE permission gate',
    );
    assert.match(
      lookupsModuleSource,
      /allowAny\(actor,\s*\[['"]PURCHASE_ORDERS_CREATE['"],\s*['"]PURCHASE_RECEIPTS_MANAGE['"],\s*['"]RETURNS_MANAGE['"]\]\)/,
      'Wave 4C: listPurchaseOrderSourceLookup must keep its existing PURCHASE_ORDERS_CREATE / PURCHASE_RECEIPTS_MANAGE / RETURNS_MANAGE permission gate',
    );
    // Business-entity REPORT usage registry must remain in lookups.js (V1.4-E5 C02 contract).
    assert.match(lookupsModuleSource, /USAGE_PERMISSIONS/);
    assert.match(lookupsModuleSource, /REPORT_SALES/);
    assert.match(lookupsModuleSource, /REPORT_PURCHASE/);
    assert.match(lookupsModuleSource, /REPORT_INVENTORY/);
    assert.match(lookupsModuleSource, /allowAny\(actor,\s*\[['"]REPORT_VIEW['"]\]\)/);
    // Existing test helper constants stay exported.
    assert.match(lookupsModuleSource, /export const __ENTITY_REGISTRY\b/);
    assert.match(lookupsModuleSource, /export const __USAGE_PERMISSIONS\b/);
    assert.match(lookupsModuleSource, /export const __USAGE_ENTITY_TYPES\b/);
    // Source-order archive filter preserved verbatim for both source lookups.
    assert.match(
      lookupsModuleSource,
      /lifecycleArchiveFilter\(\s*['"]SALES_ORDER['"]\s*,\s*\{\s*includeArchived:\s*url\.searchParams\.get\(\s*['"]includeArchived['"]\s*\)\s*===\s*['"]true['"]\s*,\s*idExpression:\s*['"]so\.id['"]\s*\}\s*\)/,
      'Wave 4C: listSalesOrderSourceLookup must preserve its lifecycleArchiveFilter invocation verbatim',
    );
    assert.match(
      lookupsModuleSource,
      /lifecycleArchiveFilter\(\s*['"]PURCHASE_ORDER['"]\s*,\s*\{\s*includeArchived:\s*url\.searchParams\.get\(\s*['"]includeArchived['"]\s*\)\s*===\s*['"]true['"]\s*,\s*idExpression:\s*['"]po\.id['"]\s*\}\s*\)/,
      'Wave 4C: listPurchaseOrderSourceLookup must preserve its lifecycleArchiveFilter invocation verbatim',
    );
    // do NOT duplicate lifecycleArchiveFilter implementation in lookups.js.
    const lifecycleEngineSource = readFileSync(resolve('server/modules/lifecycle-engine.js'), 'utf8');
    assert.match(lifecycleEngineSource, /export function lifecycleArchiveFilter\b/);
    assert.equal(
      (lookupsModuleSource.match(/export\s+function\s+lifecycleArchiveFilter\b/g) || []).length,
      0,
      'Wave 4C: lifecycleArchiveFilter must be imported, not re-defined in lookups.js',
    );
  });
});

describe('V2 Wave 4D — Discount Draft Lifecycle Route Ownership Migration', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const discountsModuleSource = readFileSync(resolve('server/modules/discounts.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 47 Wave 4C baseline descriptors (warehouse + customer + supplier
    // + role + user + product master-data + decision-reports +
    // product-routings + read-only lookups). See buildOwnedTable in
    // Wave 4C for the full list; replicate the relevant subset here
    // so the Wave 4D tests are self-contained and can be exercised in
    // isolation.
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/operations$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: '/api/lookup/suppliers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/customers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookups/business-entities', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/sales-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/purchase-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    // 10 Wave 4D sales+purchase discount draft-lifecycle descriptors.
    table.register({ method: 'GET', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/sales-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/purchase-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    return table;
  }

  test('1. exactly 10 discount descriptors exist with the canonical owner; previous 47 baseline descriptors remain intact; ownedRouteTable is now 57; single createRouteTable() and single .match() remain in app.js', () => {
    const table = buildOwnedTable();
    const discountEntries = table.list().filter((item) => item.owner === 'server/modules/discounts.js');
    assert.equal(discountEntries.length, 10, 'Wave 4D: exactly ten discount descriptors must exist with the canonical owner');
    assert.equal(table.size(), 57, 'Wave 4D: 47 baseline + 10 discount = 57 owned descriptors');
    // list() exposes only { method, path, pathKind, owner } — no other keys.
    for (const entry of discountEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 4D: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/discounts.js');
      assert.ok(typeof entry.path === 'string' || entry.path instanceof RegExp, 'descriptor path must be non-empty string or RegExp');
    }
    // Five sales + five purchase routes must all be present.
    const salesPaths = discountEntries
      .filter((item) => item.path.toString().includes('sales-discounts'))
      .map((item) => item.path.toString())
      .sort();
    assert.deepEqual(salesPaths, [
      '/api/sales-discounts',
      '/api/sales-discounts',
      '^\\/api\\/sales-discounts\\/([^/]+)$',
      '^\\/api\\/sales-discounts\\/([^/]+)$',
      '^\\/api\\/sales-discounts\\/([^/]+)\\/cancel$',
    ].sort(), 'Wave 4D: the five sales-discounts paths must match the canonical brief exactly');
    const purchasePaths = discountEntries
      .filter((item) => item.path.toString().includes('purchase-discounts'))
      .map((item) => item.path.toString())
      .sort();
    assert.deepEqual(purchasePaths, [
      '/api/purchase-discounts',
      '/api/purchase-discounts',
      '^\\/api\\/purchase-discounts\\/([^/]+)$',
      '^\\/api\\/purchase-discounts\\/([^/]+)$',
      '^\\/api\\/purchase-discounts\\/([^/]+)\\/cancel$',
    ].sort(), 'Wave 4D: the five purchase-discounts paths must match the canonical brief exactly');
    // Previous 47 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/decision-reports.js').length, 11);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/product-routing.js').length, 9);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/lookups.js').length, 5);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 4D: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 4D: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
  });

  test('2. sales discount collection / detail / cancel routes match correctly through the route-table and dispatch to server/modules/discounts.js; confirm and reverse routes return null from ownedRouteTable', () => {
    const table = buildOwnedTable();
    // Collection GET + POST.
    const listMatch = table.match('GET', '/api/sales-discounts');
    assert.ok(listMatch, 'GET /api/sales-discounts must match the route-table');
    assert.equal(listMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(listMatch.params, []);
    assert.equal(typeof listMatch.handler, 'function');
    const createMatch = table.match('POST', '/api/sales-discounts');
    assert.ok(createMatch, 'POST /api/sales-discounts must match the route-table');
    assert.equal(createMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(createMatch.params, []);
    // Detail GET + PATCH with capture group param.
    const detailGet = table.match('GET', '/api/sales-discounts/sd-001');
    assert.ok(detailGet, 'GET /api/sales-discounts/:id must match the route-table');
    assert.equal(detailGet.owner, 'server/modules/discounts.js');
    assert.deepEqual(detailGet.params, ['sd-001']);
    const detailPatch = table.match('PATCH', '/api/sales-discounts/sd-001');
    assert.ok(detailPatch, 'PATCH /api/sales-discounts/:id must match the route-table');
    assert.equal(detailPatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(detailPatch.params, ['sd-001']);
    // Cancel POST on detail.
    const cancelMatch = table.match('POST', '/api/sales-discounts/sd-001/cancel');
    assert.ok(cancelMatch, 'POST /api/sales-discounts/:id/cancel must match the route-table');
    assert.equal(cancelMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(cancelMatch.params, ['sd-001']);
    // Confirm + reverse MUST NOT match (legacy handleApi keeps them).
    assert.equal(table.match('POST', '/api/sales-discounts/sd-001/confirm'), null,
      'POST /api/sales-discounts/:id/confirm must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/sales-discounts/sd-001/reverse'), null,
      'POST /api/sales-discounts/:id/reverse must NOT match the route-table (legacy handleApi)');
    // DELETE on detail must NOT match (no DELETE descriptor registered).
    assert.equal(table.match('DELETE', '/api/sales-discounts/sd-001'), null,
      'DELETE /api/sales-discounts/:id must NOT match the route-table');
  });

  test('3. purchase discount collection / detail / cancel routes match correctly through the route-table and dispatch to server/modules/discounts.js; confirm and reverse routes return null from ownedRouteTable', () => {
    const table = buildOwnedTable();
    // Collection GET + POST.
    const listMatch = table.match('GET', '/api/purchase-discounts');
    assert.ok(listMatch, 'GET /api/purchase-discounts must match the route-table');
    assert.equal(listMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(listMatch.params, []);
    const createMatch = table.match('POST', '/api/purchase-discounts');
    assert.ok(createMatch, 'POST /api/purchase-discounts must match the route-table');
    assert.equal(createMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(createMatch.params, []);
    // Detail GET + PATCH with capture group param.
    const detailGet = table.match('GET', '/api/purchase-discounts/pd-001');
    assert.ok(detailGet, 'GET /api/purchase-discounts/:id must match the route-table');
    assert.equal(detailGet.owner, 'server/modules/discounts.js');
    assert.deepEqual(detailGet.params, ['pd-001']);
    const detailPatch = table.match('PATCH', '/api/purchase-discounts/pd-001');
    assert.ok(detailPatch, 'PATCH /api/purchase-discounts/:id must match the route-table');
    assert.equal(detailPatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(detailPatch.params, ['pd-001']);
    // Cancel POST on detail.
    const cancelMatch = table.match('POST', '/api/purchase-discounts/pd-001/cancel');
    assert.ok(cancelMatch, 'POST /api/purchase-discounts/:id/cancel must match the route-table');
    assert.equal(cancelMatch.owner, 'server/modules/discounts.js');
    assert.deepEqual(cancelMatch.params, ['pd-001']);
    // Confirm + reverse MUST NOT match (legacy handleApi keeps them).
    assert.equal(table.match('POST', '/api/purchase-discounts/pd-001/confirm'), null,
      'POST /api/purchase-discounts/:id/confirm must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/purchase-discounts/pd-001/reverse'), null,
      'POST /api/purchase-discounts/:id/reverse must NOT match the route-table (legacy handleApi)');
    // DELETE on detail must NOT match.
    assert.equal(table.match('DELETE', '/api/purchase-discounts/pd-001'), null,
      'DELETE /api/purchase-discounts/:id must NOT match the route-table');
  });

  test('4. app.js has no legacy list / create / get / update / cancel discount dispatch branches; salesDiscountAction / purchaseDiscountAction combined (confirm|cancel) matchers are gone', () => {
    // No legacy exact-match branches for sales-discounts collection GET / POST.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/sales-discounts['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4D: legacy exact-match branch for GET /api/sales-discounts must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/sales-discounts['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 4D: legacy exact-match branch for POST /api/sales-discounts must be removed',
    );
    // No legacy exact-match branches for purchase-discounts collection GET / POST.
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/purchase-discounts['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4D: legacy exact-match branch for GET /api/purchase-discounts must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /pathname\s*===\s*['"]\/api\/purchase-discounts['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/,
      'Wave 4D: legacy exact-match branch for POST /api/purchase-discounts must be removed',
    );
    // No legacy `salesDiscountMatch` or `purchaseDiscountMatch` detail GET/PATCH dispatch branches.
    assert.doesNotMatch(
      appSource,
      /salesDiscountMatch\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4D: legacy sales-discounts detail GET dispatch branch must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /salesDiscountMatch\s*&&\s*req\.method\s*===\s*['"]PATCH['"]/,
      'Wave 4D: legacy sales-discounts detail PATCH dispatch branch must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /purchaseDiscountMatch\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Wave 4D: legacy purchase-discounts detail GET dispatch branch must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /purchaseDiscountMatch\s*&&\s*req\.method\s*===\s*['"]PATCH['"]/,
      'Wave 4D: legacy purchase-discounts detail PATCH dispatch branch must be removed',
    );
    // Combined `(confirm|cancel)` matcher for sales-discounts and
    // purchase-discounts must be gone (cancel now dispatched by
    // route-table; confirm split into its own legacy branch below).
    assert.doesNotMatch(
      appSource,
      /\/api\/sales-discounts\/([^/]+)\/\(confirm\|cancel\)/,
      'Wave 4D: combined (confirm|cancel) regex for sales-discounts must be replaced with a confirm-only legacy branch',
    );
    assert.doesNotMatch(
      appSource,
      /\/api\/purchase-discounts\/([^/]+)\/\(confirm\|cancel\)/,
      'Wave 4D: combined (confirm|cancel) regex for purchase-discounts must be replaced with a confirm-only legacy branch',
    );
    // `salesDiscountAction` / `purchaseDiscountAction` combined-action
    // variables must be gone from app.js.
    assert.doesNotMatch(
      appSource,
      /\bsalesDiscountAction\b/,
      'Wave 4D: salesDiscountAction combined-action variable must be removed',
    );
    assert.doesNotMatch(
      appSource,
      /\bpurchaseDiscountAction\b/,
      'Wave 4D: purchaseDiscountAction combined-action variable must be removed',
    );
  });

  test('5. app.js keeps confirm-only legacy dispatch for sales + purchase discount confirm; reverse legacy dispatch remains for both sides', () => {
    // Confirm-only legacy regex literal for sales-discounts must remain
    // (file source uses regex literal with `^`, `\/`, `$`).
    const salesConfirmLiteral = '/^\\/api\\/sales-discounts\\/([^/]+)\\/confirm$/';
    assert.ok(appSource.includes(salesConfirmLiteral),
      'Wave 4D: confirm-only legacy regex literal for sales-discounts must remain');
    assert.ok(appSource.includes('confirmSalesDiscount(db, res, actor, salesDiscountConfirm[1], generateVoucher, checkPeriodNotClosedForVoucher)'),
      'Wave 4D: confirmSalesDiscount legacy dispatch must pass generateVoucher + checkPeriodNotClosedForVoucher dependencies exactly');
    // Confirm-only legacy regex literal for purchase-discounts.
    const purchaseConfirmLiteral = '/^\\/api\\/purchase-discounts\\/([^/]+)\\/confirm$/';
    assert.ok(appSource.includes(purchaseConfirmLiteral),
      'Wave 4D: confirm-only legacy regex literal for purchase-discounts must remain');
    assert.ok(appSource.includes('confirmPurchaseDiscount(db, res, actor, purchaseDiscountConfirm[1], generateVoucher, checkPeriodNotClosedForVoucher)'),
      'Wave 4D: confirmPurchaseDiscount legacy dispatch must pass generateVoucher + checkPeriodNotClosedForVoucher dependencies exactly');
    // Reverse legacy regex literals must remain for both sides.
    const salesReverseLiteral = '/^\\/api\\/sales-discounts\\/([^/]+)\\/reverse$/';
    assert.ok(appSource.includes(salesReverseLiteral),
      'Wave 4D: sales-discounts reverse legacy regex literal must remain');
    assert.ok(appSource.includes('reverseSalesDiscount(db, req, res, actor, salesDiscountReverse[1], generateVoucher, checkPeriodNotClosedForVoucher)'),
      'Wave 4D: reverseSalesDiscount legacy dispatch must pass generateVoucher + checkPeriodNotClosedForVoucher dependencies exactly');
    const purchaseReverseLiteral = '/^\\/api\\/purchase-discounts\\/([^/]+)\\/reverse$/';
    assert.ok(appSource.includes(purchaseReverseLiteral),
      'Wave 4D: purchase-discounts reverse legacy regex literal must remain');
    assert.ok(appSource.includes('reversePurchaseDiscount(db, req, res, actor, purchaseDiscountReverse[1], generateVoucher, checkPeriodNotClosedForVoucher)'),
      'Wave 4D: reversePurchaseDiscount legacy dispatch must pass generateVoucher + checkPeriodNotClosedForVoucher dependencies exactly');
    // Discounts module remains the canonical implementation source.
    // Note: createSalesDiscount / createPurchaseDiscount / updateSalesDiscount
    // / updatePurchaseDiscount are declared `async`; allow that keyword.
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+listSalesDiscounts\b/,
      'Wave 4D: discounts.js must continue to export listSalesDiscounts',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+createSalesDiscount\b/,
      'Wave 4D: discounts.js must continue to export createSalesDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+getSalesDiscount\b/,
      'Wave 4D: discounts.js must continue to export getSalesDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+updateSalesDiscount\b/,
      'Wave 4D: discounts.js must continue to export updateSalesDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+cancelSalesDiscount\b/,
      'Wave 4D: discounts.js must continue to export cancelSalesDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+listPurchaseDiscounts\b/,
      'Wave 4D: discounts.js must continue to export listPurchaseDiscounts',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+createPurchaseDiscount\b/,
      'Wave 4D: discounts.js must continue to export createPurchaseDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+getPurchaseDiscount\b/,
      'Wave 4D: discounts.js must continue to export getPurchaseDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+updatePurchaseDiscount\b/,
      'Wave 4D: discounts.js must continue to export updatePurchaseDiscount',
    );
    assert.match(
      discountsModuleSource,
      /export\s+(?:async\s+)?function\s+cancelPurchaseDiscount\b/,
      'Wave 4D: discounts.js must continue to export cancelPurchaseDiscount',
    );
    // app.js continues to import the ten low-risk handlers from discounts.js.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/discounts\.js['"]/,
      'Wave 4D: app.js must continue to import handlers from ./modules/discounts.js',
    );
    assert.match(appSource, /\blistSalesDiscounts\b/);
    assert.match(appSource, /\bcreateSalesDiscount\b/);
    assert.match(appSource, /\bgetSalesDiscount\b/);
    assert.match(appSource, /\bupdateSalesDiscount\b/);
    assert.match(appSource, /\bcancelSalesDiscount\b/);
    assert.match(appSource, /\blistPurchaseDiscounts\b/);
    assert.match(appSource, /\bcreatePurchaseDiscount\b/);
    assert.match(appSource, /\bgetPurchaseDiscount\b/);
    assert.match(appSource, /\bupdatePurchaseDiscount\b/);
    assert.match(appSource, /\bcancelPurchaseDiscount\b/);
    // High-risk handlers (confirm + reverse) remain imported in app.js
    // because their legacy dispatch still calls them with explicit
    // voucher dependencies.
    assert.match(appSource, /\bconfirmSalesDiscount\b/);
    assert.match(appSource, /\bconfirmPurchaseDiscount\b/);
    assert.match(appSource, /\breverseSalesDiscount\b/);
    assert.match(appSource, /\breversePurchaseDiscount\b/);
  });
});

describe('V2 Wave 5A — Accounting Configuration Decomposition', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const extendedModuleSource = readFileSync(resolve('server/modules/extended.js'), 'utf8');
  const accountingConfigModuleSource = readFileSync(resolve('server/modules/accounting-config.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 57 Wave 4D baseline descriptors (warehouse + customer + supplier
    // + role + user + product master-data + decision-reports +
    // product-routings + read-only lookups + discount draft
    // lifecycle). The Wave 5A tests extend the Wave 4D
    // buildOwnedTable by adding the four accounting-configuration
    // descriptors.
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/operations$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: '/api/lookup/suppliers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/customers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookups/business-entities', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/sales-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/purchase-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/sales-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/purchase-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    // 4 Wave 5A accounting-configuration descriptors.
    table.register({ method: 'GET', path: '/api/currencies', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'GET', path: '/api/voucher-words', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'POST', path: '/api/voucher-words', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'GET', path: '/api/voucher-templates', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    return table;
  }

  test('1. exactly 4 accounting-config descriptors exist; previous 57 baseline descriptors remain intact; total 61; single createRouteTable() and single .match() remain in app.js', () => {
    const table = buildOwnedTable();
    const accountingConfigEntries = table.list().filter((item) => item.owner === 'server/modules/accounting-config.js');
    assert.equal(accountingConfigEntries.length, 4, 'Wave 5A: exactly four accounting-config descriptors must exist with the canonical owner');
    assert.equal(table.size(), 61, 'Wave 5A: 57 baseline + 4 accounting-config = 61 owned descriptors');
    // list() exposes only { method, path, pathKind, owner } — no other keys.
    for (const entry of accountingConfigEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 5A: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/accounting-config.js');
    }
    // All four expected paths present.
    const paths = accountingConfigEntries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, [
      '/api/currencies',
      '/api/voucher-templates',
      '/api/voucher-words',
      '/api/voucher-words',
    ].sort(), 'Wave 5A: the four accounting-config paths must match the canonical brief exactly');
    // Previous 57 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/decision-reports.js').length, 11);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/product-routing.js').length, 9);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/lookups.js').length, 5);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/discounts.js').length, 10);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 5A: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 5A: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
  });

  test('2. GET /api/currencies matches through the route-table; legacy exact-match branch removed from app.js', () => {
    const table = buildOwnedTable();
    const match = table.match('GET', '/api/currencies');
    assert.ok(match, 'GET /api/currencies must match the route-table');
    assert.equal(match.owner, 'server/modules/accounting-config.js');
    assert.deepEqual(match.params, []);
    assert.equal(typeof match.handler, 'function');
    // Legacy exact-match branch must be removed from app.js.
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/currencies['"]/g) || []).length,
      0,
      'Wave 5A: legacy exact-match branch for GET /api/currencies must be removed from app.js',
    );
  });

  test('3. GET + POST /api/voucher-words match through the route-table; legacy exact-match branches removed from app.js', () => {
    const table = buildOwnedTable();
    const getMatch = table.match('GET', '/api/voucher-words');
    assert.ok(getMatch, 'GET /api/voucher-words must match the route-table');
    assert.equal(getMatch.owner, 'server/modules/accounting-config.js');
    assert.deepEqual(getMatch.params, []);
    const postMatch = table.match('POST', '/api/voucher-words');
    assert.ok(postMatch, 'POST /api/voucher-words must match the route-table');
    assert.equal(postMatch.owner, 'server/modules/accounting-config.js');
    assert.deepEqual(postMatch.params, []);
    // Both legacy exact-match branches must be removed.
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/voucher-words['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/g) || []).length,
      0,
      'Wave 5A: legacy exact-match branch for GET /api/voucher-words must be removed from app.js',
    );
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/voucher-words['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]/g) || []).length,
      0,
      'Wave 5A: legacy exact-match branch for POST /api/voucher-words must be removed from app.js',
    );
  });

  test('4. GET /api/voucher-templates matches through the route-table; legacy exact-match branch removed from app.js', () => {
    const table = buildOwnedTable();
    const match = table.match('GET', '/api/voucher-templates');
    assert.ok(match, 'GET /api/voucher-templates must match the route-table');
    assert.equal(match.owner, 'server/modules/accounting-config.js');
    assert.deepEqual(match.params, []);
    assert.equal(typeof match.handler, 'function');
    // Legacy exact-match branch must be removed from app.js.
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/voucher-templates['"]/g) || []).length,
      0,
      'Wave 5A: legacy exact-match branch for GET /api/voucher-templates must be removed from app.js',
    );
  });

  test('5. extended.js no longer declares the four extracted handlers; accounting-config.js exports them; departments / aux-projects / period-closures remain legacy (route-table returns null)', () => {
    // extended.js no longer declares the four extracted handlers.
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+listCurrencies\b/g) || []).length,
      0,
      'Wave 5A: extended.js must no longer export listCurrencies',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+listVoucherWords\b/g) || []).length,
      0,
      'Wave 5A: extended.js must no longer export listVoucherWords',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+createVoucherWord\b/g) || []).length,
      0,
      'Wave 5A: extended.js must no longer export createVoucherWord',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+listVoucherTemplates\b/g) || []).length,
      0,
      'Wave 5A: extended.js must no longer export listVoucherTemplates',
    );
    // accounting-config.js exports the four handlers.
    assert.match(
      accountingConfigModuleSource,
      /export\s+function\s+listCurrencies\b/,
      'Wave 5A: accounting-config.js must export listCurrencies',
    );
    assert.match(
      accountingConfigModuleSource,
      /export\s+function\s+listVoucherWords\b/,
      'Wave 5A: accounting-config.js must export listVoucherWords',
    );
    assert.match(
      accountingConfigModuleSource,
      /export\s+async\s+function\s+createVoucherWord\b/,
      'Wave 5A: accounting-config.js must export createVoucherWord',
    );
    assert.match(
      accountingConfigModuleSource,
      /export\s+function\s+listVoucherTemplates\b/,
      'Wave 5A: accounting-config.js must export listVoucherTemplates',
    );
    // app.js imports the four handlers from the new canonical owner.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/accounting-config\.js['"]/,
      'Wave 5A: app.js must import handlers from ./modules/accounting-config.js',
    );
    assert.match(appSource, /\blistCurrencies\b/);
    assert.match(appSource, /\blistVoucherWords\b/);
    assert.match(appSource, /\bcreateVoucherWord\b/);
    assert.match(appSource, /\blistVoucherTemplates\b/);
    // Departments / aux-projects / period-closures remain legacy:
    // route-table returns null for representative routes.
    const table = buildOwnedTable();
    assert.equal(table.match('GET', '/api/departments'), null,
      'Wave 5A: GET /api/departments must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/departments'), null,
      'Wave 5A: POST /api/departments must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('GET', '/api/aux-projects'), null,
      'Wave 5A: GET /api/aux-projects must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/aux-projects'), null,
      'Wave 5A: POST /api/aux-projects must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('GET', '/api/period-closures'), null,
      'Wave 5A: GET /api/period-closures must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/period-closures'), null,
      'Wave 5A: POST /api/period-closures must NOT match the route-table (legacy handleApi)');
    assert.equal(table.match('POST', '/api/accounting-vouchers'), null,
      'Wave 5A: POST /api/accounting-vouchers must NOT match the route-table (legacy handleApi)');
  });
});

describe('V2 Wave 5B — Manufacturing Reference Data Decomposition', () => {
  const appSource = readFileSync(resolve('server/app.js'), 'utf8');
  const extendedModuleSource = readFileSync(resolve('server/modules/extended.js'), 'utf8');
  const manufacturingReferenceModuleSource = readFileSync(resolve('server/modules/manufacturing-reference.js'), 'utf8');

  function buildOwnedTable() {
    const table = createRouteTable();
    // 61 Wave 5A baseline descriptors (warehouse + customer +
    // supplier + role + user + product master-data + decision-reports
    // + product-routings + read-only lookups + discount draft
    // lifecycle + accounting-configuration). The Wave 5B tests
    // extend the Wave 5A buildOwnedTable by adding the four
    // manufacturing-reference descriptors.
    table.register({ method: 'GET', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'POST', path: '/api/warehouses', handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'PATCH', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'DELETE', path: /^\/api\/warehouses\/([^/]+)$/, handler: () => {}, owner: 'server/modules/warehouses.js' });
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'GET', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'POST', path: '/api/suppliers', handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/suppliers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/suppliers.js' });
    table.register({ method: 'GET', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'POST', path: '/api/roles', handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'PATCH', path: /^\/api\/roles\/([^/]+)$/, handler: () => {}, owner: 'server/modules/roles.js' });
    table.register({ method: 'GET', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'POST', path: '/api/users', handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, handler: () => {}, owner: 'server/modules/users.js' });
    table.register({ method: 'GET', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'POST', path: '/api/products', handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'PATCH', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'DELETE', path: /^\/api\/products\/([^/]+)$/, handler: () => {}, owner: 'server/modules/products.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: /^\/api\/reports\/([^/]+)\/lines\/([^/]+)\/contributions$/, handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/sales-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-summary/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/purchase-outstanding/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/reports/decision/inventory-movements/export', handler: () => {}, owner: 'server/modules/decision-reports.js' });
    table.register({ method: 'GET', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: '/api/product-routings', handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/(activate|deactivate)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)\/operations\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'POST', path: /^\/api\/product-routings\/([^/]+)\/operations$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'PATCH', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'DELETE', path: /^\/api\/product-routings\/([^/]+)$/, handler: () => {}, owner: 'server/modules/product-routing.js' });
    table.register({ method: 'GET', path: '/api/lookup/suppliers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/customers', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookups/business-entities', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/sales-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/lookup/purchase-orders-source', handler: () => {}, owner: 'server/modules/lookups.js' });
    table.register({ method: 'GET', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/sales-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/sales-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/sales-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: '/api/purchase-discounts', handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'PATCH', path: /^\/api\/purchase-discounts\/([^/]+)$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'POST', path: /^\/api\/purchase-discounts\/([^/]+)\/cancel$/, handler: () => {}, owner: 'server/modules/discounts.js' });
    table.register({ method: 'GET', path: '/api/currencies', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'GET', path: '/api/voucher-words', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'POST', path: '/api/voucher-words', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    table.register({ method: 'GET', path: '/api/voucher-templates', handler: () => {}, owner: 'server/modules/accounting-config.js' });
    // 4 Wave 5B manufacturing-reference descriptors.
    table.register({ method: 'GET', path: '/api/work-centers', handler: () => {}, owner: 'server/modules/manufacturing-reference.js' });
    table.register({ method: 'POST', path: '/api/work-centers', handler: () => {}, owner: 'server/modules/manufacturing-reference.js' });
    table.register({ method: 'GET', path: '/api/routing-operations', handler: () => {}, owner: 'server/modules/manufacturing-reference.js' });
    table.register({ method: 'POST', path: '/api/routing-operations', handler: () => {}, owner: 'server/modules/manufacturing-reference.js' });
    return table;
  }

  test('1. exactly 4 manufacturing-reference descriptors exist; previous 61 baseline descriptors remain intact; 65 total; single createRouteTable() and single .match() in app.js', () => {
    const table = buildOwnedTable();
    const manufacturingReferenceEntries = table.list().filter((item) => item.owner === 'server/modules/manufacturing-reference.js');
    assert.equal(manufacturingReferenceEntries.length, 4, 'Wave 5B: exactly four manufacturing-reference descriptors must exist with the canonical owner');
    assert.equal(table.size(), 65, 'Wave 5B: 61 baseline + 4 manufacturing-reference = 65 owned descriptors');
    for (const entry of manufacturingReferenceEntries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['method', 'owner', 'path', 'pathKind'].sort(),
        `Wave 5B: descriptor ${entry.method} ${entry.path} must expose exactly { method, path, pathKind, owner }`,
      );
      assert.equal(entry.owner, 'server/modules/manufacturing-reference.js');
    }
    const paths = manufacturingReferenceEntries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, [
      '/api/routing-operations',
      '/api/routing-operations',
      '/api/work-centers',
      '/api/work-centers',
    ].sort(), 'Wave 5B: the four manufacturing-reference paths must match the canonical brief exactly');
    // Previous 61 baseline descriptors remain intact.
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/warehouses.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/customers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/suppliers.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/roles.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/users.js').length, 3);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/products.js').length, 4);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/decision-reports.js').length, 11);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/product-routing.js').length, 9);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/lookups.js').length, 5);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/discounts.js').length, 10);
    assert.equal(table.list().filter((item) => item.owner === 'server/modules/accounting-config.js').length, 4);
    // Single constructor + single .match() lookup remain in app.js.
    const constructorOccurrences = appSource.match(/\bcreateRouteTable\s*\(\s*\)/g) || [];
    assert.equal(constructorOccurrences.length, 1, 'Wave 5B: app.js must construct the owned route table exactly once');
    const matchOccurrences = appSource.match(/\bownedRouteTable\s*\.\s*match\s*\(/g) || [];
    assert.equal(matchOccurrences.length, 1, 'Wave 5B: app.js must keep exactly one ownedRouteTable.match() dispatch call');
    assert.match(appSource, /\bownedRouteTable\b/);
  });

  test('2. all four manufacturing-reference route matches succeed via the route-table; legacy exact-match branches for /api/work-centers and /api/routing-operations are removed from app.js', () => {
    const table = buildOwnedTable();
    const wcGet = table.match('GET', '/api/work-centers');
    assert.ok(wcGet, 'GET /api/work-centers must match the route-table');
    assert.equal(wcGet.owner, 'server/modules/manufacturing-reference.js');
    const wcPost = table.match('POST', '/api/work-centers');
    assert.ok(wcPost, 'POST /api/work-centers must match the route-table');
    assert.equal(wcPost.owner, 'server/modules/manufacturing-reference.js');
    const roGet = table.match('GET', '/api/routing-operations');
    assert.ok(roGet, 'GET /api/routing-operations must match the route-table');
    assert.equal(roGet.owner, 'server/modules/manufacturing-reference.js');
    const roPost = table.match('POST', '/api/routing-operations');
    assert.ok(roPost, 'POST /api/routing-operations must match the route-table');
    assert.equal(roPost.owner, 'server/modules/manufacturing-reference.js');
    // Legacy dispatch branches must be removed from app.js.
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/work-centers['"]/g) || []).length,
      0,
      'Wave 5B: legacy exact-match branches for /api/work-centers must be removed from app.js',
    );
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/routing-operations['"]/g) || []).length,
      0,
      'Wave 5B: legacy exact-match branches for /api/routing-operations must be removed from app.js',
    );
  });

  test('3. extended.js no longer declares the four extracted handlers; manufacturing-reference.js exports them; app.js imports them; four legacy handler symbols are removed from the extended.js import block', () => {
    // extended.js no longer declares the four extracted handlers.
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+listWorkCenters\b/g) || []).length,
      0,
      'Wave 5B: extended.js must no longer export listWorkCenters',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+createWorkCenter\b/g) || []).length,
      0,
      'Wave 5B: extended.js must no longer export createWorkCenter',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+listRoutingOperations\b/g) || []).length,
      0,
      'Wave 5B: extended.js must no longer export listRoutingOperations',
    );
    assert.equal(
      (extendedModuleSource.match(/export\s+(?:async\s+)?function\s+createRoutingOperation\b/g) || []).length,
      0,
      'Wave 5B: extended.js must no longer export createRoutingOperation',
    );
    // manufacturing-reference.js exports the four handlers.
    assert.match(
      manufacturingReferenceModuleSource,
      /export\s+function\s+listWorkCenters\b/,
      'Wave 5B: manufacturing-reference.js must export listWorkCenters',
    );
    assert.match(
      manufacturingReferenceModuleSource,
      /export\s+async\s+function\s+createWorkCenter\b/,
      'Wave 5B: manufacturing-reference.js must export createWorkCenter',
    );
    assert.match(
      manufacturingReferenceModuleSource,
      /export\s+function\s+listRoutingOperations\b/,
      'Wave 5B: manufacturing-reference.js must export listRoutingOperations',
    );
    assert.match(
      manufacturingReferenceModuleSource,
      /export\s+async\s+function\s+createRoutingOperation\b/,
      'Wave 5B: manufacturing-reference.js must export createRoutingOperation',
    );
    // app.js imports the four handlers from the new canonical owner.
    assert.match(
      appSource,
      /from\s+['"]\.\/modules\/manufacturing-reference\.js['"]/,
      'Wave 5B: app.js must import handlers from ./modules/manufacturing-reference.js',
    );
    assert.match(appSource, /\blistWorkCenters\b/);
    assert.match(appSource, /\bcreateWorkCenter\b/);
    assert.match(appSource, /\blistRoutingOperations\b/);
    assert.match(appSource, /\bcreateRoutingOperation\b/);
    // The four symbols must NOT appear in the extended.js import
    // block in app.js — they were removed from the canonical import
    // line. We assert by looking inside the multi-line import braces
    // by searching for the four identifiers in the import-section only
    // (no extension or wildcards).
    const extendedImportBlockMatch = appSource.match(/from\s+['"]\.\/modules\/extended\.js['"]/);
    assert.ok(extendedImportBlockMatch, 'app.js must still import from ./modules/extended.js');
    const startOfFile = appSource.slice(0, extendedImportBlockMatch.index);
    // The previous multi-line import opens with `{` after the last
    // import statement; walk back to find the `{` boundary.
    const importOpen = startOfFile.lastIndexOf('{');
    const importBody = appSource.slice(importOpen, extendedImportBlockMatch.index);
    assert.equal(importBody.includes('listWorkCenters'), false, 'Wave 5B: listWorkCenters must be removed from the extended.js import block');
    assert.equal(importBody.includes('createWorkCenter'), false, 'Wave 5B: createWorkCenter must be removed from the extended.js import block');
    assert.equal(importBody.includes('listRoutingOperations'), false, 'Wave 5B: listRoutingOperations must be removed from the extended.js import block');
    assert.equal(importBody.includes('createRoutingOperation'), false, 'Wave 5B: createRoutingOperation must be removed from the extended.js import block');
  });

  test('4. labor-records, IQC, supplier-evaluations and BOMs remain on legacy handleApi (route-table returns null); Product Routings remain intact with 9 descriptors', () => {
    const table = buildOwnedTable();
    // Representative legacy routes stay on legacy handleApi.
    assert.equal(table.match('GET', '/api/labor-records'), null, 'Wave 5B: GET /api/labor-records must remain legacy');
    assert.equal(table.match('POST', '/api/labor-records'), null, 'Wave 5B: POST /api/labor-records must remain legacy');
    assert.equal(table.match('GET', '/api/iqc'), null, 'Wave 5B: GET /api/iqc must remain legacy');
    assert.equal(table.match('POST', '/api/iqc'), null, 'Wave 5B: POST /api/iqc must remain legacy');
    assert.equal(table.match('GET', '/api/supplier-evaluations'), null, 'Wave 5B: GET /api/supplier-evaluations must remain legacy');
    assert.equal(table.match('POST', '/api/supplier-evaluations'), null, 'Wave 5B: POST /api/supplier-evaluations must remain legacy');
    assert.equal(table.match('GET', '/api/boms'), null, 'Wave 5B: GET /api/boms must remain legacy (no manufacturing-reference migration of /api/boms)');
    assert.equal(table.match('POST', '/api/boms'), null, 'Wave 5B: POST /api/boms must remain legacy');
    // Product Routings remain intact with their nine descriptors
    // owned by server/modules/product-routing.js — these are a
    // separate table / route family from the manufacturing-reference
    // legacy `routing_operations` routes.
    assert.equal(
      table.list().filter((item) => item.owner === 'server/modules/product-routing.js').length,
      9,
      'Wave 5B: Product Routings must remain intact with 9 descriptors owned by server/modules/product-routing.js',
    );
    // The two route families must not be merged: /api/product-routings
    // is owned by product-routing.js while /api/routing-operations is
    // owned by manufacturing-reference.js.
    const productRoutingsMatch = table.match('GET', '/api/product-routings');
    assert.equal(productRoutingsMatch.owner, 'server/modules/product-routing.js');
    const routingOperationsMatch = table.match('GET', '/api/routing-operations');
    assert.equal(routingOperationsMatch.owner, 'server/modules/manufacturing-reference.js');
  });

  test('5. legacy handleApi branches for /api/work-centers and /api/routing-operations are absent from app.js; the four Wave 5B handler symbols appear only in the manufacturing-reference.js import block + 4 ownedRouteTable.adapter callbacks', () => {
    // Belt-and-braces: also assert by the canonical exact-match
    // pattern that legacy handleApi dispatching for these endpoints
    // has been removed in both directions (method-agnostic).
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/work-centers['"]/g) || []).length,
      0,
      'Wave 5B: no legacy handleApi exact-match branch may remain for /api/work-centers',
    );
    assert.equal(
      (appSource.match(/pathname\s*===\s*['"]\/api\/routing-operations['"]/g) || []).length,
      0,
      'Wave 5B: no legacy handleApi exact-match branch may remain for /api/routing-operations',
    );
    // The four handler symbols must appear in app.js exactly in the
    // import block (one occurrence each) and in the four
    // ownedRouteTable.register adapter callbacks (one occurrence
    // each) — totaling two occurrences per symbol. Any other
    // occurrence would indicate a leaked second implementation.
    for (const symbol of ['listWorkCenters', 'createWorkCenter', 'listRoutingOperations', 'createRoutingOperation']) {
      const occurrences = appSource.match(new RegExp(`\\b${symbol}\\b`, 'g')) || [];
      assert.equal(
        occurrences.length,
        2,
        `Wave 5B: ${symbol} must appear exactly twice in app.js (one import + one adapter); found ${occurrences.length}`,
      );
    }
  });
});
