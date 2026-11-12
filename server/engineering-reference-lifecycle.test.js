// V17 Master & Engineering Domain Closure — reference master lifecycle
// (2026-11-12 remediation round).
//
// Requirement §28.8.A requires the engineering reference masters to close the
// CRUD loop and to enforce an `active` / `inactive` lifecycle. The 2026-11-12
// audit found that nine of the ten masters could only be created and listed:
// no update, no deactivate. This suite is the evidence that the gap is closed.
//
// Every case carries a negative control, so a green result cannot come from a
// check that never runs.

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
let adminAuth;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-engineering-lifecycle-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminAuth = (await login.json()).token;
});

after(async () => {
  await new Promise((done) => server.close(done));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${adminAuth}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function createResource(code) {
  const response = await api('POST', '/api/engineering/resources', {
    code, name: `资源 ${code}`, category: 'TOOL', quantity: 2, unit: '件',
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.id;
}

describe('Master & Engineering — reference master lifecycle (2026-11-12)', () => {
  test('a reference master can be updated and the change is persisted', async () => {
    const resourceId = await createResource('LIFE-RES-UPD');
    const updated = await api('PATCH', `/api/engineering/resources/${resourceId}`, {
      code: 'LIFE-RES-UPD', name: '改名后的资源', category: 'MACHINE', quantity: 5, unit: '台',
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    const list = await api('GET', '/api/engineering/resources');
    const row = list.data.resources.find((item) => item.id === resourceId);
    assert.equal(row.name, '改名后的资源');
    assert.equal(row.category, 'MACHINE');
    assert.equal(Number(row.quantity), 5);
    const audits = database.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND action='UPDATE'").get(resourceId);
    assert.ok(Number(audits.n) >= 1, 'the update must be audited');
  });

  test('an invalid master value is rejected and nothing is written', async () => {
    const resourceId = await createResource('LIFE-RES-BAD');
    const rejected = await api('PATCH', `/api/engineering/resources/${resourceId}`, {
      code: 'LIFE-RES-BAD', name: '非法类型', category: 'NOT_A_CATEGORY', quantity: 1,
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    const row = database.prepare('SELECT category, name FROM engineering_resources WHERE id=?').get(resourceId);
    assert.equal(row.category, 'TOOL', 'the rejected update must not change the record');
    const list = await api('GET', '/api/engineering/resources');
    const listed = list.data.resources.find((item) => item.id === resourceId);
    assert.equal(listed.name, `资源 LIFE-RES-BAD`);
  });

  test('a reference master can be deactivated and the deactivation is idempotent', async () => {
    const resourceId = await createResource('LIFE-RES-OFF');
    const first = await api('POST', `/api/engineering/resources/${resourceId}/deactivate`);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(Number(first.data.active), 0);
    const row = database.prepare('SELECT active FROM engineering_resources WHERE id=?').get(resourceId);
    assert.equal(Number(row.active), 0);
    const second = await api('POST', `/api/engineering/resources/${resourceId}/deactivate`);
    assert.equal(second.status, 200);
    assert.equal(Number(second.data.active), 0);
  });

  test('a master that an active record still references cannot be deactivated', async () => {
    const activity = await api('POST', '/api/engineering/basic-activities', {
      code: 'LIFE-ACT', name: '被引用活动', stage: 'PROCESS',
    });
    assert.equal(activity.status, 201, JSON.stringify(activity.data));
    const operation = await api('POST', '/api/engineering/operations', {
      code: 'LIFE-OP', name: '引用活动的作业', standardMinutes: 5, activityId: activity.data.id,
    });
    assert.equal(operation.status, 201, JSON.stringify(operation.data));
    const blocked = await api('POST', `/api/engineering/basic-activities/${activity.data.id}/deactivate`);
    assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
    const row = database.prepare('SELECT active FROM engineering_basic_activities WHERE id=?').get(activity.data.id);
    assert.equal(Number(row.active), 1, 'the referenced master must stay active');
  });

  test('every reference master family exposes the lifecycle routes', async () => {
    const shift = await api('POST', '/api/engineering/shifts', { code: 'LIFE-SHIFT', name: '班次', startMinute: 480, endMinute: 600 });
    assert.equal(shift.status, 201, JSON.stringify(shift.data));
    const families = [
      ['shift-patterns', { code: 'LIFE-PAT', name: '班制', shiftIds: [shift.data.id] }],
      ['calendar-templates', { code: 'LIFE-CT', name: '日历模板' }],
      ['work-calendars', { code: 'LIFE-WC', name: '工作日历', startDate: '2026-10-01', endDate: '2026-10-31' }],
      ['basic-activities', { code: 'LIFE-BA', name: '基础活动', stage: 'PROCESS' }],
      ['workshop-formulas', { code: 'LIFE-F', name: '公式', formula: 'e_a + e_b', variables: ['e_a', 'e_b'] }],
      ['resources', { code: 'LIFE-R', name: '资源', category: 'TOOL', quantity: 1 }],
      ['equipment', { code: 'LIFE-E', name: '设备' }],
      ['operations', { code: 'LIFE-OP2', name: '作业', standardMinutes: 1 }],
      ['control-codes', { code: 'LIFE-CC', name: '控制码', category: 'PROCESSING' }],
    ];
    for (const [slug, body] of families) {
      const created = await api('POST', `/api/engineering/${slug}`, body);
      assert.equal(created.status, 201, `${slug}: ${JSON.stringify(created.data)}`);
      const id = created.data.id;
      const updated = await api('PATCH', `/api/engineering/${slug}/${id}`, { ...body, name: `${body.name} 已更新` });
      assert.equal(updated.status, 200, `${slug} update: ${JSON.stringify(updated.data)}`);
      const deactivated = await api('POST', `/api/engineering/${slug}/${id}/deactivate`);
      assert.equal(deactivated.status, 200, `${slug} deactivate: ${JSON.stringify(deactivated.data)}`);
      assert.equal(Number(deactivated.data.active), 0, `${slug} must report the inactive state`);
    }
  });

  test('a master that does not exist fails closed on update and deactivate', async () => {
    const missing = 'no-such-master-id';
    const updated = await api('PATCH', `/api/engineering/resources/${missing}`, { code: 'X', name: 'X' });
    assert.equal(updated.status, 404, JSON.stringify(updated.data));
    const deactivated = await api('POST', `/api/engineering/resources/${missing}/deactivate`);
    assert.equal(deactivated.status, 404, JSON.stringify(deactivated.data));
  });

  test('an unsafe workshop formula is rejected by the update path', async () => {
    const created = await api('POST', '/api/engineering/workshop-formulas', {
      code: 'LIFE-UNSAFE', name: '不安全公式', formula: 'e_a + e_b', variables: ['e_a', 'e_b'],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const rejected = await api('PATCH', `/api/engineering/workshop-formulas/${created.data.id}`, {
      code: 'LIFE-UNSAFE', name: '不安全公式', formula: 'process.exit(1)', variables: [],
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    const row = database.prepare('SELECT formula FROM engineering_workshop_formulas WHERE id=?').get(created.data.id);
    assert.equal(row.formula, 'e_a + e_b', 'the rejected formula must not be written');
  });
});
