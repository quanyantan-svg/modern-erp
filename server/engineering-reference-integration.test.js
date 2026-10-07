// V17 Master & Engineering Domain Closure — Wave A integration tests.
//
// Covers:
//   - All 10 master families (shift, shift pattern, calendar template,
//     work calendar, basic activity, workshop formula, resource, equipment,
//     operation, control code) CRUD via HTTP.
//   - Workshop Formula reject unsafe formulas via HTTP (no eval / Function /
//     illegal identifiers).
//   - Work Center PATCH + deactivate endpoint.
//   - Additive migration preserves legacy tables/columns:
//       routing_operations, production_labor_records, work_centers
//       existing columns still exist and respond.
//   - Engineering permission family is registered and admin has it; sales does
//     not (preserving least-privilege for additive family).

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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-engineering-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminAuth = (await login('admin', 'admin123')).data.token;
  salesAuth = (await login('sales', 'sales123')).data.token;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, data: await response.json() };
}

let adminAuth;
let salesAuth;

async function api(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

describe('V17 Master & Engineering Reference Foundation (Wave A)', () => {
  test('migration preserves legacy tables and adds new ones', () => {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('routing_operations', 'production_labor_records', 'work_centers', 'engineering_shifts', 'engineering_shift_patterns', 'engineering_calendar_templates', 'engineering_work_calendars', 'engineering_basic_activities', 'engineering_workshop_formulas', 'engineering_resources', 'engineering_equipment', 'engineering_operations', 'engineering_control_codes')").all().map((row) => row.name).sort();
    for (const expected of ['engineering_basic_activities', 'engineering_calendar_templates', 'engineering_control_codes', 'engineering_equipment', 'engineering_operations', 'engineering_resources', 'engineering_shift_patterns', 'engineering_shifts', 'engineering_work_calendars', 'engineering_workshop_formulas', 'production_labor_records', 'routing_operations', 'work_centers']) {
      assert.ok(tables.includes(expected), `expected table ${expected}`);
    }
    // Work centers additive columns present.
    const wcInfo = database.prepare("PRAGMA table_info(work_centers)").all().map((row) => row.name);
    for (const col of ['calendar_id', 'default_efficiency_pct', 'is_outsource', 'notes', 'updated_at']) {
      assert.ok(wcInfo.includes(col), `work_centers missing column ${col}`);
    }
    // Pre-existing columns still present.
    for (const col of ['id', 'code', 'name', 'capacity_hours', 'unit_cost_cents', 'active']) {
      assert.ok(wcInfo.includes(col), `work_centers legacy column missing ${col}`);
    }
  });

  test('admin can create a shift; non-admin cannot', async () => {
    const created = await api('POST', '/api/engineering/shifts', adminAuth, {
      code: 'SH-DAY', name: '白班', startMinute: 480, endMinute: 1020,
    });
    assert.equal(created.status, 201, created.data.error);
    const list = await api('GET', '/api/engineering/shifts', adminAuth);
    assert.equal(list.status, 200);
    assert.ok(list.data.shifts.some((row) => row.code === 'SH-DAY'));
    const blocked = await api('POST', '/api/engineering/shifts', salesAuth, {
      code: 'SH-X', name: 'X', startMinute: 0, endMinute: 60,
    });
    assert.notEqual(blocked.status, 201);
  });

  test('shift invalid minute range rejected', async () => {
    const bad = await api('POST', '/api/engineering/shifts', adminAuth, {
      code: 'SH-BAD', name: 'Bad', startMinute: 1020, endMinute: 480,
    });
    assert.notEqual(bad.status, 201);
  });

  test('admin can create shift pattern referencing an existing shift', async () => {
    const shift = await api('GET', '/api/engineering/shifts', adminAuth);
    const shiftRow = shift.data.shifts.find((row) => row.code === 'SH-DAY');
    const result = await api('POST', '/api/engineering/shift-patterns', adminAuth, {
      code: 'SP-1', name: '单班制', shiftIds: [shiftRow.id],
    });
    assert.equal(result.status, 201, result.data.error);
  });

  test('shift pattern rejects unknown shift ids', async () => {
    const result = await api('POST', '/api/engineering/shift-patterns', adminAuth, {
      code: 'SP-X', name: 'X', shiftIds: ['no-such-shift'],
    });
    assert.notEqual(result.status, 201);
  });

  test('admin can create calendar template + work calendar', async () => {
    const tmpl = await api('POST', '/api/engineering/calendar-templates', adminAuth, {
      code: 'CT-1', name: '标准日历', workDays: [1, 2, 3, 4, 5],
    });
    assert.equal(tmpl.status, 201, tmpl.data.error);
    const cal = await api('POST', '/api/engineering/work-calendars', adminAuth, {
      code: 'WC-1', name: '2026 工厂日历', templateId: tmpl.data.id,
      startDate: '2026-01-01', endDate: '2026-12-31',
    });
    assert.equal(cal.status, 201, cal.data.error);
    const list = await api('GET', '/api/engineering/work-calendars', adminAuth);
    assert.ok(list.data.calendars.some((row) => row.code === 'WC-1'));
  });

  test('work calendar rejects invalid date range', async () => {
    const cal = await api('POST', '/api/engineering/work-calendars', adminAuth, {
      code: 'WC-INV', name: 'invalid', startDate: '2026-12-31', endDate: '2026-01-01',
    });
    assert.notEqual(cal.status, 201);
  });

  test('admin can create basic activity, resource, equipment, operation, control code', async () => {
    const activity = await api('POST', '/api/engineering/basic-activities', adminAuth, {
      code: 'ACT-1', name: '切割', stage: 'PROCESS', unit: '件',
    });
    assert.equal(activity.status, 201, activity.data.error);
    const resource = await api('POST', '/api/engineering/resources', adminAuth, {
      code: 'R-1', name: '激光切割机', category: 'MACHINE', quantity: 2,
    });
    assert.equal(resource.status, 201, resource.data.error);
    const equipment = await api('POST', '/api/engineering/equipment', adminAuth, {
      code: 'EQ-1', name: '激光切割机-A', model: 'L-9000',
    });
    assert.equal(equipment.status, 201, equipment.data.error);
    const operation = await api('POST', '/api/engineering/operations', adminAuth, {
      code: 'OP-1', name: '切割工序', standardMinutes: 5, activityId: activity.data.id,
    });
    assert.equal(operation.status, 201, operation.data.error);
    const cc = await api('POST', '/api/engineering/control-codes', adminAuth, {
      code: 'CC-1', name: '标准加工', category: 'PROCESSING',
    });
    assert.equal(cc.status, 201, cc.data.error);
  });

  test('resource invalid category and quantity rejected', async () => {
    const bad1 = await api('POST', '/api/engineering/resources', adminAuth, {
      code: 'R-X1', name: 'X', category: 'INVALID',
    });
    assert.notEqual(bad1.status, 201);
    const bad2 = await api('POST', '/api/engineering/resources', adminAuth, {
      code: 'R-X2', name: 'X', category: 'MACHINE', quantity: 0,
    });
    assert.notEqual(bad2.status, 201);
  });

  test('admin can create and evaluate workshop formula; rejects unsafe grammar', async () => {
    const formula = await api('POST', '/api/engineering/workshop-formulas', adminAuth, {
      code: 'F-1', name: '工时公式', formula: '(e_setup + e_qty * e_run) / 60', variables: ['e_setup', 'e_qty', 'e_run'],
    });
    assert.equal(formula.status, 201, formula.data.error);
    const safe = await api('POST', `/api/engineering/workshop-formulas/${formula.data.id}/evaluate`, adminAuth, {
      variables: { e_setup: 30, e_qty: 5, e_run: 2 },
    });
    assert.equal(safe.status, 200);
    assert.equal(safe.data.value, (30 + 5 * 2) / 60);
    const unsafe1 = await api('POST', '/api/engineering/workshop-formulas', adminAuth, {
      code: 'F-EVIL', name: 'evil', formula: 'eval("1+1")',
    });
    assert.notEqual(unsafe1.status, 201);
    const unsafe2 = await api('POST', '/api/engineering/workshop-formulas', adminAuth, {
      code: 'F-NORMAL', name: 'normal', formula: 'qty * 2',
    });
    assert.notEqual(unsafe2.status, 201);
    const divideByZero = await api('POST', '/api/engineering/workshop-formulas', adminAuth, {
      code: 'F-DIV0', name: 'div0', formula: '1/0',
    });
    assert.equal(divideByZero.status, 201);
    const ev = await api('POST', `/api/engineering/workshop-formulas/${divideByZero.data.id}/evaluate`, adminAuth, { variables: {} });
    assert.equal(ev.status, 400, ev.data.error);
  });

  test('work center PATCH updates fields, deactivate guards references', async () => {
    // Create a work center via legacy POST first.
    const created = await api('POST', '/api/work-centers', adminAuth, {
      code: 'WC-T-1', name: 'Test', type: 'ASSEMBLY',
    });
    assert.equal(created.status, 201, created.data.error);
    const wcId = created.data.id;
    // PATCH the new fields.
    const patch = await api('PATCH', `/api/work-centers/${wcId}`, adminAuth, {
      code: 'WC-T-1', name: 'Test updated', type: 'ASSEMBLY', capacityHours: 10,
      defaultEfficiencyPct: 90, isOutsource: false,
    });
    assert.equal(patch.status, 200, `PATCH error: ${patch.data.error} | ${JSON.stringify(patch.data)} | full response: ${JSON.stringify(patch.data)}`);
    const list = await api('GET', '/api/work-centers/enhanced', adminAuth);
    assert.ok(list.data.workCenters.some((row) => row.id === wcId && row.default_efficiency_pct === 90));
    // Create a resource pointing to it.
    const resource = await api('POST', '/api/engineering/resources', adminAuth, {
      code: 'R-WC', name: 'linking', category: 'MACHINE', quantity: 1, workCenterId: wcId,
    });
    assert.equal(resource.status, 201, resource.data.error);
    // Now deactivate should fail because resource is referencing it.
    const fail = await api('POST', `/api/work-centers/${wcId}/deactivate`, adminAuth);
    assert.equal(fail.status, 409, fail.data.error);
    // Delete the resource via SQL, then deactivate succeeds.
    database.prepare('UPDATE engineering_resources SET active=0 WHERE id=?').run(resource.data.id);
    const ok = await api('POST', `/api/work-centers/${wcId}/deactivate`, adminAuth);
    assert.equal(ok.status, 200, ok.data.error);
  });

  test('legacy /api/work-centers GET still works (compat with manufacturing-reference)', async () => {
    const list = await api('GET', '/api/work-centers', adminAuth);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data.workCenters));
  });

  test('engineering permission is admin-only (sales 403 on manage endpoints)', async () => {
    const blocked = await api('POST', '/api/engineering/basic-activities', salesAuth, {
      code: 'ACT-X', name: 'x', stage: 'PROCESS',
    });
    assert.notEqual(blocked.status, 201);
    // sales has no engineering permissions but the additive family does not
    // change baseline behavior for any other endpoint.
    const noEngineerPerms = await api('GET', '/api/engineering/basic-activities', salesAuth);
    assert.notEqual(noEngineerPerms.status, 200);
  });
});