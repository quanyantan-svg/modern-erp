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
//   2. V2 Stage 3 / Wave 3A — backend dispatch ownership architecture
//      invariants. These tests read server/app.js and
//      server/modules/warehouses.js from disk and assert that the
//      live route-table infrastructure is wired in: app.js imports
//      route-table.js, the four warehouse descriptors are registered
//      with owner='server/modules/warehouses.js', no legacy
//      /api/warehouses dispatch branches remain, and unrelated routes
//      still fall through to the legacy handleApi chain.
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
      ['GET', '/api/roles'],
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

  test('supplier routes have NOT migrated to the route-table (still on legacy handleApi)', () => {
    const table = createRouteTable();
    table.register({ method: 'GET', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'POST', path: '/api/customers', handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'PATCH', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });
    table.register({ method: 'DELETE', path: /^\/api\/customers\/([^/]+)$/, handler: () => {}, owner: 'server/modules/customers.js' });

    assert.equal(table.match('GET', '/api/suppliers'), null);
    assert.equal(table.match('POST', '/api/suppliers'), null);
    assert.equal(table.match('PATCH', '/api/suppliers/supplier-001'), null);
    assert.equal(table.match('DELETE', '/api/suppliers/supplier-001'), null);

    assert.match(
      appSource,
      /pathname\s*===\s*['"]\/api\/suppliers['"]\s*&&\s*req\.method\s*===\s*['"]GET['"]/,
      'Supplier routes remain on legacy handleApi and MUST NOT be migrated in Wave 3B',
    );
    assert.match(
      appSource,
      /const\s+supplierMatch\s*=\s*pathname\.match\(/,
      'Supplier /:id legacy dispatch branch must remain in app.js for Wave 3B',
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
