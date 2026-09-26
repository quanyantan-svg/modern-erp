import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { assertAllowedFields, HttpError } from './lib/http.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-r2-user-payload-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(loginRes.status, 200, `admin login must succeed; got ${loginRes.status}`);
  adminToken = (await loginRes.json()).token;
  assert.ok(adminToken, 'admin token must be present');
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function postJson(path, body, token = adminToken) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function patchJson(path, body, token = adminToken) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function adminRoleId() {
  return database.prepare("SELECT id FROM roles WHERE code='ADMIN'").get().id;
}

describe('UAT R2 — user-management payload contract', () => {
  test('assertAllowedFields: empty allowed list rejects every key', () => {
    try { assertAllowedFields({ foo: 1 }, []); throw new Error('must throw'); }
    catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 400);
      assert.match(e.message, /不支持的字段: foo/);
    }
  });

  test('assertAllowedFields: POST /api/users allowlist rejects active', () => {
    const allowed = ['username', 'displayName', 'password', 'roleId'];
    try {
      assertAllowedFields({ username: 'x', displayName: 'X', password: 'longerpassword', roleId: 'r', active: true }, allowed);
      throw new Error('must throw');
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 400);
      assert.match(e.message, /不支持的字段: active/);
    }
  });

  test('assertAllowedFields: PATCH /api/users/:id allowlist accepts active and rejects username', () => {
    const allowed = ['displayName', 'password', 'roleId', 'active'];
    // accept path
    assertAllowedFields({ displayName: 'New', roleId: 'r', active: false }, allowed);
    // reject username because PATCH does not allow it
    try {
      assertAllowedFields({ username: 'newone', displayName: 'New', roleId: 'r', active: true }, allowed);
      throw new Error('must throw');
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.match(e.message, /不支持的字段: username/);
    }
  });

  test('POST /api/users rejects {active:true} with the strict-field 400 contract', async () => {
    const response = await postJson('/api/users', {
      username: 'r2user1',
      displayName: 'R2 User 1',
      password: 'S3cure-Pwd-Long-Enough',
      roleId: adminRoleId(),
      active: true,
    });
    assert.equal(response.status, 400, `expected 400, got ${response.status}`);
    const body = await response.json();
    assert.match(body.error, /不支持的字段: active/);
  });

  test('POST /api/users succeeds when payload contains only the four supported create fields', async () => {
    const response = await postJson('/api/users', {
      username: 'r2user2',
      displayName: 'R2 User 2',
      password: 'S3cure-Pwd-Long-Enough',
      roleId: adminRoleId(),
    });
    assert.equal(response.status, 201, `expected 201, got ${response.status}`);
  });

  test('POST /api/users rejects accidental displayName/roleId tampering with strict-field contract', async () => {
    // baseline payload + an unexpected id field
    const response = await postJson('/api/users', {
      username: 'r2user3',
      displayName: 'R2 User 3',
      password: 'S3cure-Pwd-Long-Enough',
      roleId: adminRoleId(),
      id: 'user-fake',
    });
    assert.equal(response.status, 400, `expected 400, got ${response.status}`);
    const body = await response.json();
    assert.match(body.error, /不支持的字段: id/);
  });

  test('PATCH /api/users/:id accepts active and updates the row', async () => {
    // seed: create a target user first
    const create = await postJson('/api/users', {
      username: 'r2user4',
      displayName: 'R2 User 4',
      password: 'S3cure-Pwd-Long-Enough',
      roleId: adminRoleId(),
    });
    assert.equal(create.status, 201);
    const { id } = await create.json();

    const patch = await patchJson(`/api/users/${id}`, { displayName: 'R2 User 4 Renamed', roleId: adminRoleId(), active: false });
    assert.equal(patch.status, 200, `expected 200, got ${patch.status}`);

    const row = database.prepare('SELECT display_name, active FROM users WHERE id=?').get(id);
    assert.equal(row.display_name, 'R2 User 4 Renamed');
    assert.equal(row.active, 0);
  });

  test('PATCH /api/users/:id without password preserves the existing password hash', async () => {
    const create = await postJson('/api/users', {
      username: 'r2user5',
      displayName: 'R2 User 5',
      password: 'Original-Long-Pwd-123',
      roleId: adminRoleId(),
    });
    assert.equal(create.status, 201);
    const { id } = await create.json();

    const before = database.prepare('SELECT password_hash, password_salt FROM users WHERE id=?').get(id);

    const patch = await patchJson(`/api/users/${id}`, { displayName: 'R2 User 5 Renamed', roleId: adminRoleId(), active: true });
    assert.equal(patch.status, 200);

    const after = database.prepare('SELECT password_hash, password_salt FROM users WHERE id=?').get(id);
    assert.equal(after.password_hash, before.password_hash, 'password hash must be unchanged when password is omitted');
    assert.equal(after.password_salt, before.password_salt, 'password salt must be unchanged when password is omitted');
  });

  test('PATCH /api/users/:id rejects an unexpected username field with strict-field 400', async () => {
    const create = await postJson('/api/users', {
      username: 'r2user6',
      displayName: 'R2 User 6',
      password: 'S3cure-Pwd-Long-Enough',
      roleId: adminRoleId(),
    });
    assert.equal(create.status, 201);
    const { id } = await create.json();

    const patch = await patchJson(`/api/users/${id}`, { username: 'r2user6-renamed', displayName: 'x', roleId: adminRoleId(), active: true });
    assert.equal(patch.status, 400, `expected 400, got ${patch.status}`);
    const body = await patch.json();
    assert.match(body.error, /不支持的字段: username/);
  });
});