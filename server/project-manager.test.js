// Regression coverage for the project manager selector defect.
//
// Original defect (Phase D production browser verification):
//   ProjectModal renders a <select> for `manager_id`, but the dropdown
//   contains no visible options. Two root causes:
//
//     1. The option label read `{u.name}`, but `/api/users` returns
//        `displayName` (not `name`), so every option rendered empty text.
//        Combined with the placeholder "选择经理", the user perceived an
//        empty dropdown.
//     2. `/api/users` requires `USERS_MANAGE` (admin-only). Any role that
//        has `PROJECT_MANAGE` but not `USERS_MANAGE` would have a 403
//        hidden failure that left `users` as `[]`. Future RBAC changes
//        could re-introduce the same defect.
//
// Fix:
//   - New endpoint `GET /api/users/lookup` gated by `PROJECT_MANAGE`,
//     returning only `{ id, username, displayName, active }` for active
//     users. No role info, no password hashes, no created_at.
//   - ProjectModal switched from `/api/users` to `/api/users/lookup` and
//     from `{u.name}` to `{u.displayName || u.username}`.
//   - Fetch wrapped in `.catch` so 4xx / 5xx surfaces a notify() instead
//     of an unhandled rejection.
//
// Scope:
//   - This Node-only harness has no jsdom / JSX DOM, so the modal itself
//     is asserted at source level.
//   - Backend assertions run end-to-end against a fresh SQLite + local
//     HTTP server (same harness as the other Phase D suites).

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');
const serverSrc = resolve(repoRoot, 'server');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }
function readServerSrc(rel) { return readFileSync(join(serverSrc, rel), 'utf8'); }

let tempDir;
let database;
let server;
let baseUrl;
let adminToken;
let salesToken;
let accountingToken;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-project-manager-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: undefined }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminToken = (await adminLogin.json()).token;

  const salesLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sales', password: 'sales123' }),
  });
  salesToken = (await salesLogin.json()).token;

  const accountingLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
  });
  accountingToken = (await accountingLogin.json()).token;
});

after(async () => {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function api(path, opts = {}, token = adminToken) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ============================================================
// Frontend source-level regression — ProjectModal wiring
// ============================================================

describe('Frontend — ProjectModal manager selector wiring', () => {
  test('ProjectModal still destructures { user, notify, value, onClose, onSaved } (no Phase D regression)', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const sig = src.match(/function\s+ProjectModal\s*\(\s*\{([^}]+)\}/);
    assert.ok(sig, 'ProjectModal signature must be present');
    const params = sig[1].split(',').map((s) => s.trim());
    for (const required of ['user', 'notify', 'value', 'onClose', 'onSaved']) {
      assert.ok(params.includes(required), `ProjectModal must accept "${required}"`);
    }
  });

  test('Projects parent passes user + notify to ProjectModal (no Phase D regression)', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const callSite = src.match(/<ProjectModal\b([^/>]*)\/?\s*>/);
    assert.ok(callSite, 'ProjectModal must be invoked from Projects');
    const props = callSite[1];
    assert.ok(/\buser=\{user\}/.test(props), 'ProjectModal invocation must include user={user}');
    assert.ok(/\bnotify=\{notify\}/.test(props), 'ProjectModal invocation must include notify={notify}');
  });

  test('ProjectModal uses /api/users/lookup (project-scoped, NOT the admin /api/users endpoint)', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    // The lookup must be inside the ProjectModal function body, not at module scope.
    const modal = src.match(/function\s+ProjectModal\s*\([\s\S]*?\n\}/);
    assert.ok(modal, 'ProjectModal body must be present');
    assert.ok(/api\(['"]\/api\/users\/lookup['"]\)/.test(modal[0]), 'ProjectModal must call /api/users/lookup');
    // Defense in depth: ProjectModal must NOT use the admin /api/users endpoint
    // (would re-introduce the admin-only gate).
    assert.equal(/api\(['"]\/api\/users['"]\)/.test(modal[0]), false, 'ProjectModal must not call /api/users directly');
  });

  test('manager <option> label uses displayName with username fallback (NOT u.name)', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const modal = src.match(/function\s+ProjectModal\s*\([\s\S]*?\n\}/);
    assert.ok(modal, 'ProjectModal body must be present');
    // The map call inside the select must reference displayName (with username fallback).
    assert.ok(/u\.displayName\s*\|\|\s*u\.username/.test(modal[0]), 'option label must fall back from displayName to username');
    // The legacy broken `u.name` reference inside the manager select must be gone.
    assert.equal(/\{u\.name\}/.test(modal[0]), false, 'manager option label must not reference the undefined u.name');
  });

  test('manager_id default still derives from the authenticated user (no global / hardcoded admin)', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const modal = src.match(/function\s+ProjectModal\s*\([\s\S]*?\n\}/);
    assert.ok(modal, 'ProjectModal body must be present');
    assert.ok(/manager_id:\s*user\?\.id/.test(modal[0]), 'manager_id default must derive from user?.id');
    // Defense in depth: no global user object.
    assert.equal(/window\.user|globalThis\.user/.test(modal[0]), false, 'must not reference a global user');
  });

  test('ProjectModal fetches users with .catch so a 4xx / 5xx surfaces via notify() and never crashes', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const modal = src.match(/function\s+ProjectModal\s*\([\s\S]*?\n\}/);
    assert.ok(modal, 'ProjectModal body must be present');
    // The lookup call must have a .catch (notify-based error handling), not an unhandled rejection.
    const lookupRe = /api\(\s*['"]\/api\/users\/lookup['"]\s*\)[\s\S]*?\.catch\(/;
    assert.ok(lookupRe.test(modal[0]), '/api/users/lookup must have a .catch handler');
    // After the lookup call there must be a notify-bearing .catch.
    // Allow one level of nested parens in the arrow body (e.g. notify(e.message, 'error')).
    const notifyCatchRe = /\.catch\(\s*(?:\([^)]*\)\s*=>\s*)?[^{}]*?\bnotify\b/;
    assert.ok(notifyCatchRe.test(modal[0]), 'lookup .catch must reference notify to surface the error');
  });

  test('ProjectModal does not regress the `user is not defined` / `notify is not defined` defect class', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    // Heuristic: every `user?.id` reference lives inside ProjectModal / TimesheetModal
    // (the two known consumers) and the corresponding function signatures destructure `user`.
    const usesUser = [...src.matchAll(/\buser\?\.id\b/g)].length;
    assert.ok(usesUser >= 1, 'user?.id must still be referenced');
    const destructured = [...src.matchAll(/function\s+\w+\s*\(\s*\{[^}]*\buser\b[^}]*\}\s*\)/g)].length;
    assert.ok(destructured >= 2, 'user must be destructured in at least 2 component signatures');
    // notify must be destructured wherever save() references it.
    const usesNotify = [...src.matchAll(/\bnotify\s*\(/g)].length;
    const notifyDestructured = [...src.matchAll(/function\s+\w+\s*\(\s*\{[^}]*\bnotify\b[^}]*\}\s*\)/g)].length;
    assert.ok(usesNotify >= 4, 'notify must still be referenced from the modal save() paths');
    assert.ok(notifyDestructured >= 4, 'notify must be destructured in every save() consumer');
  });

  test('editing an existing project preserves the existing manager via ...value spread', () => {
    const src = readSrc('pages/projects-workflow.jsx');
    const modal = src.match(/function\s+ProjectModal\s*\([\s\S]*?\n\}/);
    assert.ok(modal, 'ProjectModal body must be present');
    // The useState initializer must spread `...value` AFTER the manager_id
    // default, so an edit with value.manager_id wins.
    const init = modal[0].match(/useState\(\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(init, 'useState initializer must be present');
    assert.ok(/manager_id:\s*user\?\.id[\s\S]*\.\.\.\s*value/.test(init[0]), 'useState must spread ...value AFTER the default manager_id so edit-mode wins');
  });
});

// ============================================================
// Backend source-level regression — route registration + handler
// ============================================================

describe('Backend — /api/users/lookup route + handler', () => {
  test('app.js routes GET /api/users/lookup to the manager-candidate handler', () => {
    const src = readServerSrc('app.js');
    assert.ok(/pathname\s*===\s*'\/api\/users\/lookup'\s*&&\s*req\.method\s*===\s*'GET'\s*\)\s*return\s+listProjectManagerCandidates/.test(src),
      'GET /api/users/lookup must dispatch to listProjectManagerCandidates');
  });

  test('listProjectManagerCandidates gates by PROJECT_MANAGE (NOT USERS_MANAGE)', () => {
    const src = readServerSrc('app.js');
    const handler = src.match(/function\s+listProjectManagerCandidates\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(handler, 'listProjectManagerCandidates must be defined');
    assert.ok(/allow\(actor,\s*'PROJECT_MANAGE'\)/.test(handler[0]), 'handler must gate on PROJECT_MANAGE');
    assert.equal(/allow\(actor,\s*'USERS_MANAGE'\)/.test(handler[0]), false, 'handler must NOT require USERS_MANAGE');
  });

  test('lookup response SELECT returns only minimal fields (no password_hash / role / createdAt)', () => {
    const src = readServerSrc('app.js');
    const handler = src.match(/function\s+listProjectManagerCandidates\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(handler, 'listProjectManagerCandidates must be defined');
    const sql = handler[0].match(/SELECT[\s\S]*?FROM\s+users/);
    assert.ok(sql, 'lookup SELECT must be present');
    assert.ok(/u\.id/.test(sql[0]) && /u\.username/.test(sql[0]) && /u\.display_name\s+displayName/.test(sql[0]) && /u\.active/.test(sql[0]),
      'lookup SELECT must include id, username, displayName, active');
    assert.equal(/password_hash|password_salt/.test(sql[0]), false, 'lookup must not return password fields');
    assert.equal(/role|created_at|createdAt/.test(sql[0]), false, 'lookup must not return role / createdAt');
  });

  test('lookup filters out inactive users', () => {
    const src = readServerSrc('app.js');
    const handler = src.match(/function\s+listProjectManagerCandidates\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(handler, 'listProjectManagerCandidates must be defined');
    assert.ok(/WHERE\s+u\.active\s*=\s*1/.test(handler[0]), 'lookup must filter active=1');
  });

  test('existing /api/users endpoint is unchanged — still admin-only via USERS_MANAGE (now owned by server/modules/users.js after Wave 3E)', () => {
    // After Wave 3E migration the User-management route family lives
    // in server/modules/users.js. listUsers must still gate on
    // USERS_MANAGE and the GET /api/users route must remain admin-only.
    // The legacy /api/users/lookup branch and listProjectManagerCandidates
    // remain app-local because the lookup is a PROJECT_MANAGE-gated
    // helper, not part of the User-management responsibility.
    const usersSrc = readFileSync(resolve(serverSrc, 'modules', 'users.js'), 'utf8');
    const listUsers = usersSrc.match(/function\s+listUsers\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(listUsers, 'listUsers must be defined in server/modules/users.js');
    assert.ok(/allow\(actor,\s*'USERS_MANAGE'\)/.test(listUsers[0]), 'listUsers must still gate on USERS_MANAGE');

    const appSrc = readServerSrc('app.js');
    // /api/users lookup must STILL be served by the legacy
    // listProjectManagerCandidates handler (NOT the route-table).
    assert.match(
      appSrc,
      /pathname\s*===\s*'\/api\/users\/lookup'\s*&&\s*req\.method\s*===\s*'GET'\s*\)\s*return\s+listProjectManagerCandidates/,
      'GET /api/users/lookup must still dispatch to listProjectManagerCandidates in app.js',
    );
    assert.match(appSrc, /function\s+listProjectManagerCandidates\b/, 'listProjectManagerCandidates must remain defined in app.js');
  });
});

// ============================================================
// Backend end-to-end regression — HTTP behavior
// ============================================================

describe('Backend — /api/users/lookup HTTP behavior', () => {
  test('admin (PROJECT_MANAGE) gets 200 and a non-empty candidate list', async () => {
    const res = await api('/api/users/lookup');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.users), 'response must include a users array');
    assert.ok(res.data.users.length >= 1, 'candidate list must include at least the seeded admin');
  });

  test('response fields are exactly { id, username, displayName, active } (no leakage)', async () => {
    const res = await api('/api/users/lookup');
    assert.equal(res.status, 200);
    const sample = res.data.users[0];
    const keys = Object.keys(sample).sort();
    assert.deepEqual(keys, ['active', 'displayName', 'id', 'username'],
      `lookup response must expose only id / username / displayName / active; got ${JSON.stringify(keys)}`);
    // Belt-and-suspenders: ensure no sensitive string slipped in anywhere in the payload.
    const blob = JSON.stringify(res.data);
    assert.equal(/password_hash|password_salt|token_hash|secret/i.test(blob), false,
      'lookup payload must not contain password / token / secret fields');
  });

  test('sales role (no PROJECT_MANAGE) gets 403 — admin-only /api/users not weakened, lookup not opened up', async () => {
    const res = await api('/api/users/lookup', {}, salesToken);
    assert.equal(res.status, 403, `sales role must NOT access /api/users/lookup; got ${res.status}`);
    assert.equal(res.data?.error?.includes('权限') || res.data?.error?.includes('操作'), true,
      '403 must come from the permission gate, not some other failure');
  });

  test('accounting role (no PROJECT_MANAGE) also gets 403', async () => {
    const res = await api('/api/users/lookup', {}, accountingToken);
    assert.equal(res.status, 403);
  });

  test('unauthenticated request returns 401, not 403 (gate order preserved)', async () => {
    const res = await api('/api/users/lookup', {}, null);
    assert.equal(res.status, 401, `unauthenticated request must 401; got ${res.status}`);
  });

  test('inactive users are excluded from the candidate list', async () => {
    // Deactivate the sales seed user directly via the DB layer (admin only operation,
    // done at the model layer rather than via /api/users to keep this test focused
    // on the lookup filter, not on the user-management endpoint).
    database.prepare('UPDATE users SET active = 0 WHERE username = ?').run('sales');
    const res = await api('/api/users/lookup');
    assert.equal(res.status, 200);
    const usernames = res.data.users.map((u) => u.username);
    assert.equal(usernames.includes('sales'), false, 'deactivated user must be filtered out');
    assert.ok(usernames.includes('admin'), 'admin must remain in the list');
    // Restore so other tests are unaffected.
    database.prepare('UPDATE users SET active = 1 WHERE username = ?').run('sales');
  });

  test('PERMISSIONS registry still contains USERS_MANAGE (admin gate intact) and PROJECT_MANAGE', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('USERS_MANAGE'), 'USERS_MANAGE must remain registered');
    assert.ok(codes.includes('PROJECT_MANAGE'), 'PROJECT_MANAGE must remain registered');
  });
});

// ============================================================
// Project create / update / read contract — manager_id survives
// ============================================================

describe('Project create / update / read — manager_id round-trip', () => {
  let projectId;

  test('admin can POST /api/projects with manager_id set to a valid user', async () => {
    const me = await api('/api/auth/me');
    const adminId = me.data.user.id;
    const res = await api('/api/projects', {
      method: 'POST',
      body: {
        name: 'PM-hotfix-project',
        description: '',
        project_type: 'IT',
        start_date: '2026-09-01',
        end_date: '2026-12-31',
        budget_cents: 100000,
        manager_id: adminId,
      },
    });
    assert.equal(res.status, 200, `create must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    assert.ok(res.data.id, 'create must return project id');
    projectId = res.data.id;
  });

  test('GET /api/projects/:id returns the managerName joined from the manager_id', async () => {
    if (!projectId) return;
    const res = await api(`/api/projects/${projectId}`);
    assert.equal(res.status, 200);
    assert.ok(res.data.project, 'project payload must exist');
    assert.equal(res.data.project.manager_id, 'user-admin', 'manager_id must round-trip');
    assert.equal(res.data.project.managerName, '系统管理员', 'managerName must be the joined display_name / name');
  });

  test('PATCH /api/projects/:id can change the manager to another valid user', async () => {
    if (!projectId) return;
    const salesRow = database.prepare('SELECT id FROM users WHERE username = ?').get('sales');
    assert.ok(salesRow?.id, 'seed sales user must exist');
    const res = await api(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: {
        name: 'PM-hotfix-project',
        description: '',
        project_type: 'IT',
        start_date: '2026-09-01',
        end_date: '2026-12-31',
        budget_cents: 100000,
        manager_id: salesRow.id,
        status: 'PLANNING',
      },
    });
    assert.equal(res.status, 200, `update must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    const verify = await api(`/api/projects/${projectId}`);
    assert.equal(verify.data.project.manager_id, salesRow.id, 'manager_id must update');
    assert.equal(verify.data.project.managerName, '销售专员', 'managerName must reflect the new manager');
  });

  test('refresh after edit still returns the selected manager (no stale cache)', async () => {
    if (!projectId) return;
    const res = await api('/api/projects');
    assert.equal(res.status, 200);
    const found = res.data.projects.find((p) => p.id === projectId);
    assert.ok(found, 'edited project must still be listed');
    const salesRow = database.prepare('SELECT id FROM users WHERE username = ?').get('sales');
    assert.equal(found.manager_id, salesRow.id, 'list endpoint must return the latest manager_id');
  });

  test('invalid manager_id is rejected by the FK constraint (cannot silently persist)', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      body: {
        name: 'PM-hotfix-bad-manager',
        description: '',
        project_type: 'IT',
        start_date: '2026-09-01',
        end_date: null,
        budget_cents: 0,
        manager_id: 'definitely-not-a-real-user-id',
      },
    });
    // The backend exposes FK errors as 500 via the global handler.
    // The exact contract is "must NOT return 200/201 with an invalid FK".
    assert.notEqual(res.status, 200, `invalid manager_id must NOT persist; got ${res.status}`);
    assert.notEqual(res.status, 201, `invalid manager_id must NOT persist; got ${res.status}`);
    assert.ok(res.status >= 400, `invalid manager_id must fail; got ${res.status}`);
  });

  test('existing /api/projects behavior is unchanged (project list still loads with managerName join)', async () => {
    const res = await api('/api/projects');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.projects));
    // The joined managerName column is still present on every row (even when null).
    for (const p of res.data.projects) {
      assert.ok('managerName' in p, `row must carry managerName key; got ${JSON.stringify(Object.keys(p))}`);
    }
  });
});