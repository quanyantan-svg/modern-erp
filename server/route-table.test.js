// V2 Stage 3 / Wave 1 — focused architecture tests for the backend
// dispatch ownership infrastructure.
//
// These tests prove the route-table contract documented in
// server/lib/route-table.js. They are pure-function tests: no DB, no HTTP,
// no Vite. They are intentionally isolated from app.js — Wave 1 does NOT
// wire the dispatcher into handleApi, so behavior at the live API boundary
// remains unchanged. The architectural invariant that handleApi remains
// the sole live dispatcher in Wave 1 is asserted explicitly at the end.

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

  test('handleApi remains the authoritative live dispatcher in Wave 1 (no double-dispatch)', () => {
    // Architectural invariant: server/app.js MUST NOT yet import
    // server/lib/route-table.js, because Wave 1 is infrastructure-only
    // and no business route is migrated. handleApi remains the sole
    // live dispatcher. This static-source check locks the Wave 1
    // cutover contract.
    const appSource = readFileSync(resolve('server/app.js'), 'utf8');
    assert.equal(
      appSource.includes('./lib/route-table.js') || appSource.includes('./lib\\route-table.js'),
      false,
      'Wave 1 must not import route-table into app.js — handleApi remains authoritative',
    );
  });
});
