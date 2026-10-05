// V2 Stage 3 / Wave 3D — focused behavior coverage for the migrated
// /api/roles route family.
//
// Pure ownership-migration tests. Roles are intentionally narrow: the
// canonical route family is GET / POST / PATCH only — there is no
// DELETE /api/roles production route and none is introduced here.
//
// This suite complements — does not duplicate — pre-existing coverage:
//   - server/app.test.js exercises authentication and a broad HTTP smoke;
//   - server/v16-p2-sales-deliveries.test.js etc. do not exercise
//     /api/roles directly;
//   - server/teacher-acceptance-matrix.test.js checks the canonical
//     rolePermissions seed block in server/db.js, but does not cover
//     the live route contract.
// The brief §11 requires that this suite prove the canonical Role
// contract end-to-end after the route-table migration:
//   - GET /api/roles returns the seeded roles list and the canonical
//     PERMISSIONS catalogue (Role-only projection) and rejects roles
//     that lack USERS_MANAGE / ROLES_MANAGE;
//   - POST /api/roles persists a role + its permissions, writes the
//     CREATE ROLE audit inside the same transaction, and surfaces the
//     canonical 400 messages for invalid permission shapes;
//   - PATCH /api/roles/:id updates the role + writes UPDATE ROLE audit,
//     returns 404 for an unknown id, preserves current permissions when body
//     omits them, and rejects ADMIN attempts to drop any canonical
//     PERMISSIONS entry with the exact existing 400 message.
//
// There is intentionally NO DELETE /api/roles test — that endpoint
// does not exist in the production contract and the brief §0
// explicitly forbids inventing one.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { PERMISSIONS, createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;
let warehouseToken;

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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3d-roles-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  warehouseToken = await login('warehouse', 'warehouse123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 3D — role route family behavior preservation', () => {
  test('GET /api/roles returns the canonical seeded roles and the PERMISSIONS catalogue', async () => {
    const result = await request('/api/roles');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.roles));
    assert.ok(result.data.roles.length >= 5);
    const codes = result.data.roles.map((row) => row.code);
    assert.ok(codes.includes('ADMIN'));
    assert.ok(codes.includes('SALES'));
    assert.ok(codes.includes('REVIEWER'));
    assert.ok(codes.includes('WAREHOUSE'));
    assert.ok(codes.includes('ACCOUNTING'));

    // Each role carries its own permissions array, populated by
    // rolePermissions(db, role.id) — admin must hold every canonical
    // PERMISSIONS code.
    const admin = result.data.roles.find((row) => row.code === 'ADMIN');
    assert.ok(Array.isArray(admin.permissions));
    const allPermissionCodes = PERMISSIONS.map(([code]) => code);
    for (const code of allPermissionCodes) {
      assert.ok(admin.permissions.includes(code), `ADMIN role must include ${code}`);
    }
    assert.equal(typeof admin.user_count, 'number');

    // The PERMISSIONS catalogue projection must remain a flat list of
    // { code, name } entries covering every canonical permission.
    assert.ok(Array.isArray(result.data.permissions));
    assert.equal(result.data.permissions.length, PERMISSIONS.length);
    for (const entry of result.data.permissions) {
      assert.equal(typeof entry.code, 'string');
      assert.equal(typeof entry.name, 'string');
    }
  });

  test('GET /api/roles preserves allowAny USERS_MANAGE / ROLES_MANAGE authorization', async () => {
    // admin has both USERS_MANAGE and ROLES_MANAGE — reachable.
    const adminRes = await request('/api/roles', { token: adminToken });
    assert.equal(adminRes.status, 200);

    // sales lacks both — must be rejected.
    const salesRes = await request('/api/roles', { token: salesToken });
    assert.equal(salesRes.status, 403);

    // warehouse lacks both — must be rejected.
    const whRes = await request('/api/roles', { token: warehouseToken });
    assert.equal(whRes.status, 403);
  });

  test('POST /api/roles creates a role, persists its permissions, returns 201 + { id }, and writes the CREATE ROLE audit', async () => {
    const code = `R-W3D-${Date.now()}`;
    const permissions = ['DASHBOARD_VIEW', 'WAREHOUSES_VIEW', 'RETURNS_VIEW'];
    const created = await request('/api/roles', {
      method: 'POST',
      body: {
        code,
        name: 'Wave3D 测试角色',
        description: '角色描述',
        permissions,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(typeof created.data.id, 'string');

    // role row must be persisted with system_role=0 (custom role).
    const roleRow = database.prepare('SELECT id,code,name,description,system_role FROM roles WHERE id=?').get(created.data.id);
    assert.equal(roleRow.code, code);
    assert.equal(roleRow.name, 'Wave3D 测试角色');
    assert.equal(roleRow.description, '角色描述');
    assert.equal(roleRow.system_role, 0, 'custom-created role must have system_role=0');

    // All three permission codes must be persisted into role_permissions.
    const persisted = database.prepare("SELECT permission_code FROM role_permissions WHERE role_id=? ORDER BY permission_code").all(created.data.id)
      .map((row) => row.permission_code);
    assert.deepEqual(persisted, ['DASHBOARD_VIEW', 'RETURNS_VIEW', 'WAREHOUSES_VIEW']);

    // CREATE ROLE audit must be written inside the same transaction.
    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='ROLE' AND entity_id=?").get(created.data.id);
    assert.ok(audit, 'CREATE ROLE audit log must be written');
    assert.equal(audit.detail, 'Wave3D 测试角色');
  });

  test('POST /api/roles preserves the 400 "权限列表格式不正确" message when permissions is not an array', async () => {
    const result = await request('/api/roles', {
      method: 'POST',
      body: {
        code: `R-W3D-BAD-${Date.now()}`,
        name: '权限格式错误',
        permissions: 'NOT_AN_ARRAY',
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '权限列表格式不正确');
  });

  test('POST /api/roles preserves the 400 "包含未知权限" message for unknown permission codes', async () => {
    const result = await request('/api/roles', {
      method: 'POST',
      body: {
        code: `R-W3D-UNK-${Date.now()}`,
        name: '未知权限',
        permissions: ['DASHBOARD_VIEW', 'TOTALLY_UNDEFINED_PERMISSION'],
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '包含未知权限');
  });

  test('POST /api/roles requires ROLES_MANAGE (sales is rejected with 403)', async () => {
    const result = await request('/api/roles', {
      token: salesToken,
      method: 'POST',
      body: {
        code: `R-W3D-403-${Date.now()}`,
        name: '应当被拒绝',
        permissions: ['DASHBOARD_VIEW'],
      },
    });
    assert.equal(result.status, 403);
  });

  test('PATCH /api/roles/:id updates name/description/permissions and writes the UPDATE ROLE audit', async () => {
    const code = `R-W3D-PATCH-${Date.now()}`;
    const created = await request('/api/roles', {
      method: 'POST',
      body: { code, name: '初始名称', permissions: ['DASHBOARD_VIEW'] },
    });
    assert.equal(created.status, 201);

    const patched = await request(`/api/roles/${created.data.id}`, {
      method: 'PATCH',
      body: {
        name: '更新后名称',
        description: '更新后描述',
        permissions: ['DASHBOARD_VIEW', 'WAREHOUSES_VIEW', 'RETURNS_VIEW'],
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.deepEqual(patched.data, { ok: true });

    const roleRow = database.prepare('SELECT name,description FROM roles WHERE id=?').get(created.data.id);
    assert.equal(roleRow.name, '更新后名称');
    assert.equal(roleRow.description, '更新后描述');

    const persisted = database.prepare("SELECT permission_code FROM role_permissions WHERE role_id=? ORDER BY permission_code").all(created.data.id)
      .map((row) => row.permission_code);
    assert.deepEqual(persisted, ['DASHBOARD_VIEW', 'RETURNS_VIEW', 'WAREHOUSES_VIEW']);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='ROLE' AND entity_id=?").get(created.data.id);
    assert.ok(audit, 'UPDATE ROLE audit log must be written');
    assert.equal(audit.detail, '更新后名称');
  });

  test('PATCH /api/roles/:id returns 404 "角色不存在" for a non-existent role', async () => {
    const result = await request('/api/roles/__no_such_role__', {
      method: 'PATCH',
      body: { name: '不存在的角色' },
    });
    assert.equal(result.status, 404);
    assert.match(result.data.error, /角色不存在/);
  });

  test('PATCH /api/roles/:id preserves the existing permissions when body.permissions is omitted', async () => {
    const code = `R-W3D-OMIT-${Date.now()}`;
    const created = await request('/api/roles', {
      method: 'POST',
      body: { code, name: 'omit-perms', permissions: ['DASHBOARD_VIEW', 'RETURNS_VIEW'] },
    });
    assert.equal(created.status, 201);

    const patched = await request(`/api/roles/${created.data.id}`, {
      method: 'PATCH',
      body: { name: '改名但不传权限' },
    });
    assert.equal(patched.status, 200);

    const persisted = database.prepare("SELECT permission_code FROM role_permissions WHERE role_id=? ORDER BY permission_code").all(created.data.id)
      .map((row) => row.permission_code);
    assert.deepEqual(persisted, ['DASHBOARD_VIEW', 'RETURNS_VIEW']);
  });

  test('PATCH of the ADMIN role attempting to remove any canonical permission preserves the exact existing rejection behavior', async () => {
    // role-admin is seeded with every PERMISSIONS entry. Drop one
    // and the handler must reject with the exact 400 message.
    const reduced = PERMISSIONS.map(([code]) => code).filter((code) => code !== 'DASHBOARD_VIEW');
    const result = await request('/api/roles/role-admin', {
      method: 'PATCH',
      body: { name: '系统管理员', permissions: reduced },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '系统管理员必须保留全部权限');

    // ADMIN row and permissions must remain untouched.
    const adminRow = database.prepare('SELECT name,description FROM roles WHERE id=?').get('role-admin');
    assert.ok(adminRow, 'ADMIN role row must remain');
    const adminPerms = database.prepare("SELECT permission_code FROM role_permissions WHERE role_id=? ORDER BY permission_code").all('role-admin')
      .map((row) => row.permission_code);
    const allPermissionCodes = PERMISSIONS.map(([code]) => code);
    assert.equal(adminPerms.length, allPermissionCodes.length);
    for (const code of allPermissionCodes) {
      assert.ok(adminPerms.includes(code), `ADMIN role must still include ${code}`);
    }
  });

  test('PATCH of a non-ADMIN role can drop permissions normally (no false-positive ADMIN guard)', async () => {
    const code = `R-W3D-DROP-${Date.now()}`;
    const created = await request('/api/roles', {
      method: 'POST',
      body: { code, name: 'drop-perms', permissions: ['DASHBOARD_VIEW', 'WAREHOUSES_VIEW', 'RETURNS_VIEW'] },
    });
    assert.equal(created.status, 201);

    const patched = await request(`/api/roles/${created.data.id}`, {
      method: 'PATCH',
      body: { name: 'drop-perms', permissions: ['DASHBOARD_VIEW'] },
    });
    assert.equal(patched.status, 200);

    const roleRow = database.prepare('SELECT code FROM roles WHERE id=?').get(created.data.id);
    assert.equal(roleRow.code, code, 'role code must not change when PATCH omits it');
    const persisted = database.prepare("SELECT permission_code FROM role_permissions WHERE role_id=? ORDER BY permission_code").all(created.data.id)
      .map((row) => row.permission_code);
    assert.deepEqual(persisted, ['DASHBOARD_VIEW']);
  });
});