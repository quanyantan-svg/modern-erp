// V2 Stage 3 / Wave 3A — focused behavior coverage for the migrated
// warehouse route family.
//
// Pure ownership-migration tests. The pre-existing p2-data-lifecycle
// suite already covers:
//   - PATCH 409 WAREHOUSE_NOT_EMPTY on a non-empty warehouse;
//   - DELETE 409 on a warehouse that still has inventory;
//   - DELETE 200 on an empty warehouse.
// This suite complements those tests by proving that the other
// endpoints behave identically after the route-table migration:
//
//   - GET /api/warehouses returns the canonical warehouse list with
//     the historical shape (code, name, address, manager, active
//     Boolean, timestamps) and is searchable by code / name;
//   - GET /api/warehouses requires either WAREHOUSES_VIEW or
//     WAREHOUSES_MANAGE (admin / warehouse / reviewer) and rejects
//     roles that lack both;
//   - POST /api/warehouses returns 201 + { id } on success, audits
//     CREATE WAREHOUSE, and rejects unauthenticated callers;
//   - POST /api/warehouses enforces the canonical field contract
//     (code, name, address, manager) with backend-side validation;
//   - PATCH /api/warehouses/:id returns 200 on a valid update and
//     404 for a non-existent warehouse, without changing the
//     deactivation stock guard;
//   - DELETE /api/warehouses/:id continues to delegate to the
//     canonical deleteMasterRecord lifecycle implementation
//     (RECORD_REFERENCED on a referenced warehouse).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let warehouseToken;
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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3a-wh-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  warehouseToken = await login('warehouse', 'warehouse123');
  salesToken = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 3A — warehouse route family behavior preservation', () => {
  test('GET /api/warehouses returns the canonical seeded warehouses with the historical shape', async () => {
    const result = await request('/api/warehouses');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.warehouses));
    const codes = result.data.warehouses.map((row) => row.code);
    assert.ok(codes.includes('WH-001'));
    assert.ok(codes.includes('WH-002'));
    const wh001 = result.data.warehouses.find((row) => row.code === 'WH-001');
    assert.equal(typeof wh001.id, 'string');
    assert.equal(wh001.name, '深圳总仓');
    assert.equal(wh001.address, '广东省深圳市南山区');
    assert.equal(wh001.manager, '张经理');
    assert.equal(wh001.active, true, 'active must be a true Boolean, not 1/0');
    assert.equal(typeof wh001.createdAt, 'string');
    assert.equal(typeof wh001.updatedAt, 'string');
  });

  test('GET /api/warehouses?search filters by code or name and keeps canonical response shape', async () => {
    const byCode = await request('/api/warehouses?search=WH-001');
    assert.equal(byCode.status, 200);
    assert.equal(byCode.data.warehouses.length, 1);
    assert.equal(byCode.data.warehouses[0].code, 'WH-001');

    const byName = await request('/api/warehouses?search=东莞');
    assert.equal(byName.status, 200);
    assert.equal(byName.data.warehouses.length, 1);
    assert.equal(byName.data.warehouses[0].code, 'WH-002');

    const empty = await request('/api/warehouses?search=__no_match__');
    assert.equal(empty.status, 200);
    assert.equal(empty.data.warehouses.length, 0);
  });

  test('GET /api/warehouses is reachable for warehouse role (WAREHOUSES_VIEW) and rejects sales (no permission)', async () => {
    const whRes = await request('/api/warehouses', { token: warehouseToken });
    assert.equal(whRes.status, 200);
    assert.ok(Array.isArray(whRes.data.warehouses));

    const salesRes = await request('/api/warehouses', { token: salesToken });
    assert.equal(salesRes.status, 403);
  });

  test('POST /api/warehouses creates a warehouse, returns 201 + { id }, and writes an audit log', async () => {
    const code = `WH-W3A-${Date.now()}`;
    const created = await request('/api/warehouses', {
      method: 'POST',
      body: { code, name: 'Wave3A 测试仓', address: '测试地址', manager: '测试负责人' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(typeof created.data.id, 'string');

    const row = database.prepare('SELECT code,name,address,manager,active FROM warehouses WHERE id=?').get(created.data.id);
    assert.equal(row.code, code);
    assert.equal(row.name, 'Wave3A 测试仓');
    assert.equal(row.address, '测试地址');
    assert.equal(row.manager, '测试负责人');
    assert.equal(row.active, 1, 'new warehouses must be active=1 in the DB');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='WAREHOUSE' AND entity_id=?").get(created.data.id);
    assert.ok(audit, 'CREATE WAREHOUSE audit log must be written');
    assert.equal(audit.detail, code);
  });

  test('POST /api/warehouses validates the canonical field contract on the backend', async () => {
    const missingCode = await request('/api/warehouses', {
      method: 'POST',
      body: { name: 'missing code' },
    });
    assert.equal(missingCode.status, 400);

    const missingName = await request('/api/warehouses', {
      method: 'POST',
      body: { code: `WH-NO-NAME-${Date.now()}` },
    });
    assert.equal(missingName.status, 400);

    const invalidCode = await request('/api/warehouses', {
      method: 'POST',
      body: { code: 'WH INVALID', name: 'bad code' },
    });
    assert.equal(invalidCode.status, 400);
  });

  test('POST /api/warehouses requires WAREHOUSES_MANAGE (sales is rejected)', async () => {
    const created = await request('/api/warehouses', {
      token: salesToken,
      method: 'POST',
      body: { code: `WH-SALES-${Date.now()}`, name: 'sales should not create' },
    });
    assert.equal(created.status, 403);
  });

  test('PATCH /api/warehouses/:id returns 200 on a valid update', async () => {
    const patched = await request('/api/warehouses/warehouse-002', {
      method: 'PATCH',
      body: { name: '东莞分仓（改名）', address: '广东省东莞市长安镇工业园', manager: '王主管' },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.deepEqual(patched.data, { ok: true });

    const row = database.prepare('SELECT name,address,manager,active FROM warehouses WHERE id=?').get('warehouse-002');
    assert.equal(row.name, '东莞分仓（改名）');
    assert.equal(row.address, '广东省东莞市长安镇工业园');
    assert.equal(row.manager, '王主管');
    assert.equal(row.active, 1);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='WAREHOUSE' AND entity_id=?").get('warehouse-002');
    assert.ok(audit, 'UPDATE WAREHOUSE audit log must be written');
  });

  test('PATCH /api/warehouses/:id returns 404 for a non-existent warehouse', async () => {
    const result = await request('/api/warehouses/__no_such_warehouse__', {
      method: 'PATCH',
      body: { name: '不存在的仓库' },
    });
    assert.equal(result.status, 404);
    assert.match(result.data.error, /仓库不存在/);
  });

  test('PATCH /api/warehouses/:id preserves the WAREHOUSE_NOT_EMPTY deactivation guard', async () => {
    // warehouse-001 is seeded with non-zero inventory in db.js.
    const result = await request('/api/warehouses/warehouse-001', {
      method: 'PATCH',
      body: { active: false },
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'WAREHOUSE_NOT_EMPTY');
    assert.match(result.data.error, /仓库仍有库存/);

    // The DB row must remain active because the request was rejected.
    const row = database.prepare('SELECT active FROM warehouses WHERE id=?').get('warehouse-001');
    assert.equal(row.active, 1);
  });

  test('PATCH /api/warehouses/:id with active=false succeeds once stock is zero', async () => {
    // Clear the inventory for warehouse-001 so the deactivation guard passes.
    database.prepare('UPDATE inventory SET quantity=0 WHERE warehouse_id=?').run('warehouse-001');
    const result = await request('/api/warehouses/warehouse-001', {
      method: 'PATCH',
      body: { active: false },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const row = database.prepare('SELECT active FROM warehouses WHERE id=?').get('warehouse-001');
    assert.equal(row.active, 0, 'active Boolean false must round-trip to 0 in the DB');
  });

  test('DELETE /api/warehouses/:id on a referenced warehouse returns RECORD_REFERENCED 409 (canonical lifecycle delegation)', async () => {
    // warehouse-001 is seeded and still has downstream inventory
    // transactions / purchase receipts / etc. The canonical
    // deleteMasterRecord must surface the 409.
    const result = await request('/api/warehouses/warehouse-001', { method: 'DELETE' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'RECORD_REFERENCED');
    assert.match(result.data.error, /仓库已有业务引用/);
  });

  test('DELETE /api/warehouses/:id on an empty warehouse returns 200 and writes an audit log', async () => {
    database.prepare("INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at) VALUES ('wave3a-wh-empty', 'W3A-EMPTY', 'W3A 空仓', '', '', 1, ?, ?)").run(
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    );
    const result = await request('/api/warehouses/wave3a-wh-empty', { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(database.prepare('SELECT 1 FROM warehouses WHERE id=?').get('wave3a-wh-empty'), undefined);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_type='WAREHOUSE' AND entity_id=?").get('wave3a-wh-empty');
    assert.ok(audit, 'DELETE WAREHOUSE audit log must be written by the canonical lifecycle implementation');
  });
});
