// V2 Stage 3 / Wave 3E — focused behavior coverage for the migrated
// /api/users User-management route family.
//
// Pure ownership-migration tests. The pre-existing
// uat-r2-user-payload.test.js suite already covers:
//   - POST /api/users strict-field allowlist (active rejected, etc.);
//   - PATCH /api/users/:id allowlist (active accepted, username
//     rejected);
//   - PATCH preserves existing password hash when password is
//     omitted;
//   - unknown request field → 400 "不支持的字段: <field>".
// /api/users/lookup was removed together with the Project Management
// extension in Core Scope Cleanup; the legacy lookup continuity proof
// no longer applies and project-manager.test.js was removed.
// The pre-existing v13-phase7c-security-observability.test.js suite
// already covers:
//   - PATCH /api/users/:id rejects mass-assignment of
//     password_hash / active (state remains unchanged on 400).
//
// This suite complements — does not duplicate — those tests by
// proving the canonical User-management contract end-to-end after
// the route-table migration:
//   - GET /api/users returns the canonical users list shape with
//     the joined role fields and active as Boolean, requires
//     USERS_MANAGE, and rejects unauthenticated callers;
//   - POST /api/users persists username lowercased, roleId, hard-
//     coded active=1, password hash (not plaintext), writes CREATE
//     USER audit, rejects password < 6, rejects unknown roleId,
//     rejects unauthorized callers, and rejects / leaks no extra
//     fields;
//   - PATCH /api/users/:id updates displayName, roleId, active
//     (Boolean → 1/0), password (re-hashed), writes UPDATE USER
//     audit, returns 404 for a missing user, returns the exact
//     existing 400 for non-boolean active, returns the exact
//     existing 400 "不能停用当前登录账号" on actor self-deactivation,
//     and rejects an unknown roleId;
//   - session invalidation: changing password / roleId / active on
//     another user invalidates that user's existing sessions via
//     DELETE FROM sessions WHERE user_id=?, while a non-security-
//     sensitive update (displayName only) does not invalidate
//     sessions.
//
// There is intentionally NO DELETE /api/users test — that endpoint
// does not exist in the production contract and the brief §0
// explicitly forbids inventing one.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { hashPassword, createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, `login ${username} failed: ${result.data.error}`);
  return result.data.token;
}

function adminRoleId() {
  return database.prepare("SELECT id FROM roles WHERE code='ADMIN'").get().id;
}

function salesRoleId() {
  return database.prepare("SELECT id FROM roles WHERE code='SALES'").get().id;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3e-users-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 3E — user-management route family behavior preservation', () => {
  test('GET /api/users returns the canonical users list with role join and active as Boolean', async () => {
    const result = await request('/api/users');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.users));
    assert.ok(result.data.users.length >= 5, 'seed data must include at least the five canonical users');

    // Each row must carry exactly the expected shape:
    //   id, username, displayName, active (Boolean), createdAt,
    //   roleId, roleName, roleCode.
    const sample = result.data.users.find((row) => row.username === 'admin');
    assert.ok(sample, 'admin user must be present');
    const keys = Object.keys(sample).sort();
    assert.deepEqual(
      keys,
      ['active', 'createdAt', 'displayName', 'id', 'roleCode', 'roleId', 'roleName', 'username'],
      `GET /api/users row shape must be exactly { id, username, displayName, active, createdAt, roleId, roleName, roleCode }; got ${JSON.stringify(keys)}`,
    );
    assert.equal(typeof sample.active, 'boolean', 'active must be a Boolean (not 0/1)');
    assert.equal(sample.active, true);
    assert.ok(typeof sample.roleId === 'string' && sample.roleId.length > 0);
    assert.ok(typeof sample.roleName === 'string' && sample.roleName.length > 0);
    assert.ok(typeof sample.roleCode === 'string' && sample.roleCode.length > 0);
  });

  test('GET /api/users requires USERS_MANAGE (sales is rejected with 403)', async () => {
    const result = await request('/api/users', { token: salesToken });
    assert.equal(result.status, 403, `sales must NOT access /api/users; got ${result.status}`);
    assert.ok(/权限|操作/.test(result.data?.error || ''), '403 must come from the USERS_MANAGE permission gate');
  });

  test('GET /api/users returns 401 for unauthenticated callers (gate order preserved)', async () => {
    const result = await request('/api/users', { token: '' });
    assert.equal(result.status, 401, `unauthenticated request must 401; got ${result.status}`);
  });

  test('POST /api/users lowercases the username, persists roleId + active=1, writes CREATE USER audit, and stores the password as a hash (no plaintext)', async () => {
    const result = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'W3E-USER-MixedCase',
        displayName: 'W3E Mixed',
        password: 'W3E-Secret-Pwd-123',
        roleId: salesRoleId(),
      },
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(typeof result.data.id, 'string');

    const row = database.prepare('SELECT username, display_name, role_id, active, password_hash, password_salt FROM users WHERE id=?').get(result.data.id);
    assert.equal(row.username, 'w3e-user-mixedcase', 'username must be lowercased on create');
    assert.equal(row.display_name, 'W3E Mixed');
    assert.equal(row.role_id, salesRoleId());
    assert.equal(row.active, 1, 'POST /api/users must hard-code active=1');
    assert.ok(row.password_hash && row.password_hash.length > 0, 'password_hash must be persisted');
    assert.ok(row.password_salt && row.password_salt.length > 0, 'password_salt must be persisted');
    assert.equal(/W3E-Secret-Pwd-123/.test(row.password_hash), false, 'plaintext password must NOT appear in password_hash');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='USER' AND entity_id=?").get(result.data.id);
    assert.ok(audit, 'CREATE USER audit log must be written');
    assert.equal(audit.detail, 'w3e-user-mixedcase');
    assert.equal(audit.user_id, database.prepare("SELECT id FROM users WHERE username='admin'").get().id);
  });

  test('POST /api/users rejects password < 6 with the exact 400 "密码至少需要 6 位" message', async () => {
    const result = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-short',
        displayName: 'W3E Short',
        password: '12345',
        roleId: salesRoleId(),
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '密码至少需要 6 位');
  });

  test('POST /api/users rejects an unknown roleId with the exact 400 "角色不存在" message', async () => {
    const result = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-unknown-role',
        displayName: 'W3E Unknown Role',
        password: 'W3E-Pwd-123456',
        roleId: 'role-does-not-exist',
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '角色不存在');
  });

  test('POST /api/users rejects sales (no USERS_MANAGE) with 403', async () => {
    const result = await request('/api/users', {
      token: salesToken,
      method: 'POST',
      body: {
        username: 'w3e-by-sales',
        displayName: 'W3E By Sales',
        password: 'W3E-Pwd-123456',
        roleId: salesRoleId(),
      },
    });
    assert.equal(result.status, 403);
  });

  test('PATCH /api/users/:id updates displayName / roleId / active (Boolean → 1/0) and writes UPDATE USER audit', async () => {
    // Seed: create a target user with admin role.
    const created = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-patch-target',
        displayName: 'Initial Name',
        password: 'W3E-Init-Pwd-123',
        roleId: adminRoleId(),
      },
    });
    assert.equal(created.status, 201);
    const userId = created.data.id;

    // Activate an existing session for this user so we can later
    // prove session invalidation behaviour.
    const seed = hashPassword('W3E-Session-Pwd-123');
    database.prepare(
      'UPDATE users SET password_hash=?, password_salt=? WHERE id=?',
    ).run(seed.hash, seed.salt, userId);
    const sessionLogin = await request('/api/auth/login', {
      token: '',
      method: 'POST',
      body: { username: 'w3e-patch-target', password: 'W3E-Session-Pwd-123' },
    });
    assert.equal(sessionLogin.status, 200, `target user login must succeed: ${JSON.stringify(sessionLogin.data)}`);
    const targetToken = sessionLogin.data.token;
    assert.ok(targetToken);

    const patched = await request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Renamed Name',
        roleId: salesRoleId(),
        active: false,
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.deepEqual(patched.data, { ok: true });

    const row = database.prepare('SELECT display_name, role_id, active FROM users WHERE id=?').get(userId);
    assert.equal(row.display_name, 'Renamed Name');
    assert.equal(row.role_id, salesRoleId());
    assert.equal(row.active, 0, 'active=false must persist as 0');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='USER' AND entity_id=?").get(userId);
    assert.ok(audit, 'UPDATE USER audit log must be written');
    assert.equal(audit.detail, 'Renamed Name');

    // The target user's existing session must be invalidated by the
    // role change (security-sensitive field).
    const sessionRow = database.prepare('SELECT user_id FROM sessions WHERE token_hash=(SELECT token_hash FROM sessions WHERE user_id=? LIMIT 1)').get(userId);
    assert.equal(sessionRow, undefined, 'sessions for the patched user must be deleted after a roleId change');
  });

  test('PATCH /api/users/:id re-hashes the password when body.password is provided and invalidates existing sessions for another user', async () => {
    // Seed: another user we can change without affecting the actor.
    const created = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-pwd-target',
        displayName: 'Pwd Target',
        password: 'W3E-Orig-Pwd-123',
        roleId: salesRoleId(),
      },
    });
    assert.equal(created.status, 201);
    const userId = created.data.id;

    const before = database.prepare('SELECT password_hash, password_salt FROM users WHERE id=?').get(userId);
    assert.ok(before.password_hash);

    // Activate a session for the target user so we can prove it gets
    // invalidated by a password change.
    const origLogin = await request('/api/auth/login', {
      token: '',
      method: 'POST',
      body: { username: 'w3e-pwd-target', password: 'W3E-Orig-Pwd-123' },
    });
    assert.equal(origLogin.status, 200);
    const beforeSessions = database.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(userId).n;
    assert.equal(beforeSessions, 1, 'target user must have exactly one session before the password change');

    const patched = await request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Pwd Target Renamed',
        roleId: salesRoleId(),
        active: true,
        password: 'W3E-New-Pwd-4567',
      },
    });
    assert.equal(patched.status, 200);

    const after = database.prepare('SELECT password_hash, password_salt FROM users WHERE id=?').get(userId);
    assert.notEqual(after.password_hash, before.password_hash, 'password_hash must change when password is provided');
    assert.notEqual(after.password_salt, before.password_salt, 'password_salt must change when password is provided');

    const afterSessions = database.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(userId).n;
    assert.equal(afterSessions, 0, 'sessions for the patched user must be deleted after a password change');

    // The new password must authenticate the user.
    const newLogin = await request('/api/auth/login', {
      token: '',
      method: 'POST',
      body: { username: 'w3e-pwd-target', password: 'W3E-New-Pwd-4567' },
    });
    assert.equal(newLogin.status, 200, 'new password must authenticate the user after the patch');
  });

  test('PATCH /api/users/:id returns 404 "用户不存在" for a non-existent user', async () => {
    const result = await request('/api/users/__no_such_user__', {
      method: 'PATCH',
      body: { displayName: 'Missing User' },
    });
    assert.equal(result.status, 404);
    assert.equal(result.data.error, '用户不存在');
  });

  test('PATCH /api/users/:id preserves the exact 400 "启用状态必须为布尔值" message when active is not boolean', async () => {
    // Create a target user.
    const created = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-boolean-test',
        displayName: 'Boolean Test',
        password: 'W3E-Bool-Pwd-123',
        roleId: salesRoleId(),
      },
    });
    assert.equal(created.status, 201);
    const userId = created.data.id;

    const result = await request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Boolean Test',
        roleId: salesRoleId(),
        active: 'yes',
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '启用状态必须为布尔值');
  });

  test('PATCH /api/users/:id preserves the exact 400 "不能停用当前登录账号" message when the actor tries to deactivate themselves', async () => {
    const me = await request('/api/auth/me');
    assert.equal(me.status, 200);
    const adminId = me.data.user.id;

    const result = await request(`/api/users/${adminId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Admin',
        roleId: adminRoleId(),
        active: false,
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '不能停用当前登录账号');
  });

  test('PATCH /api/users/:id rejects an unknown roleId with the exact 400 "角色不存在" message', async () => {
    const created = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-role-test',
        displayName: 'Role Test',
        password: 'W3E-Role-Pwd-123',
        roleId: salesRoleId(),
      },
    });
    assert.equal(created.status, 201);
    const userId = created.data.id;

    const result = await request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Role Test',
        roleId: 'role-does-not-exist',
        active: true,
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '角色不存在');
  });

  test('PATCH /api/users/:id on a non-security-sensitive field (displayName only) does not invalidate the target user\'s existing sessions', async () => {
    // Seed: target user + session.
    const created = await request('/api/users', {
      method: 'POST',
      body: {
        username: 'w3e-display-only',
        displayName: 'Display Only',
        password: 'W3E-Disp-Pwd-123',
        roleId: salesRoleId(),
      },
    });
    assert.equal(created.status, 201);
    const userId = created.data.id;

    const loginRes = await request('/api/auth/login', {
      token: '',
      method: 'POST',
      body: { username: 'w3e-display-only', password: 'W3E-Disp-Pwd-123' },
    });
    assert.equal(loginRes.status, 200);
    const beforeSessions = database.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(userId).n;
    assert.equal(beforeSessions, 1, 'target user must have exactly one session before the displayName-only patch');

    // PATCH only displayName (no password / roleId / active change).
    const patched = await request(`/api/users/${userId}`, {
      method: 'PATCH',
      body: {
        displayName: 'Display Only Renamed',
        roleId: salesRoleId(),
        active: true,
      },
    });
    assert.equal(patched.status, 200);

    const afterSessions = database.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(userId).n;
    assert.equal(afterSessions, 1, 'target user\'s existing session must NOT be invalidated by a non-security-sensitive update');
  });
});
