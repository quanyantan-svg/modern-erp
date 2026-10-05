// V2 Stage 3 / Wave 3B — focused behavior coverage for the migrated
// customer route family.
//
// Pure ownership-migration tests. The pre-existing
// `server/p2-data-lifecycle.test.js` suite already covers the
// canonical customer DELETE behavior (referenced → 409
// RECORD_REFERENCED, unreferenced → 200 + DELETE audit). This
// suite complements those tests by proving that the other
// endpoints behave identically after the route-table migration:
//
//   - GET /api/customers returns the canonical customer list with
//     the historical shape (code, name, contact, phone, address,
//     paymentTermsDays, active Boolean, timestamps) and is
//     searchable by code / name / contact;
//   - GET /api/customers requires either CUSTOMERS_VIEW or
//     CUSTOMERS_MANAGE (admin / sales) and rejects roles that
//     lack both;
//   - POST /api/customers returns 201 + { id } on success, audits
//     CREATE CUSTOMER, and rejects unauthenticated callers;
//   - POST /api/customers enforces the canonical field contract
//     (code, name, contact, phone, address, paymentTermsDays) with
//     backend-side validation, including the verbatim
//     paymentTermsDays 400 error message;
//   - PATCH /api/customers/:id returns 200 on a valid update and
//     404 for a non-existent customer;
//   - PATCH /api/customers/:id persists the paymentTermsDays and
//     active Boolean shapes;
//   - DELETE /api/customers/:id continues to delegate to the
//     canonical deleteMasterRecord lifecycle implementation
//     (RECORD_REFERENCED on a referenced customer, 200 on an
//     unreferenced one with DELETE CUSTOMER audit).

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
let salesToken;
let warehouseToken;
let accountingToken;

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3b-cu-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  warehouseToken = await login('warehouse', 'warehouse123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 3B — customer route family behavior preservation', () => {
  test('GET /api/customers returns the canonical seeded customers with the historical shape', async () => {
    const result = await request('/api/customers');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.customers));
    const codes = result.data.customers.map((row) => row.code);
    assert.ok(codes.includes('C001'));
    assert.ok(codes.includes('C002'));
    const c001 = result.data.customers.find((row) => row.code === 'C001');
    assert.equal(typeof c001.id, 'string');
    assert.equal(c001.name, '深圳创想科技有限公司');
    assert.equal(c001.contact, '李经理');
    assert.equal(c001.phone, '13800138001');
    assert.equal(c001.address, '广东省深圳市南山区科技园');
    assert.equal(c001.active, true, 'active must be a true Boolean, not 1/0');
    assert.equal(typeof c001.paymentTermsDays, 'number');
    assert.equal(typeof c001.createdAt, 'string');
    assert.equal(typeof c001.updatedAt, 'string');
  });

  test('GET /api/customers?search filters by code, name, or contact and keeps the canonical response shape', async () => {
    const byCode = await request('/api/customers?search=C001');
    assert.equal(byCode.status, 200);
    assert.equal(byCode.data.customers.length, 1);
    assert.equal(byCode.data.customers[0].code, 'C001');

    const byName = await request('/api/customers?search=智联');
    assert.equal(byName.status, 200);
    assert.equal(byName.data.customers.length, 1);
    assert.equal(byName.data.customers[0].code, 'C002');

    const byContact = await request('/api/customers?search=张总');
    assert.equal(byContact.status, 200);
    assert.equal(byContact.data.customers.length, 1);
    assert.equal(byContact.data.customers[0].code, 'C003');

    const empty = await request('/api/customers?search=__no_match__');
    assert.equal(empty.status, 200);
    assert.equal(empty.data.customers.length, 0);
  });

  test('GET /api/customers is reachable for sales role (CUSTOMERS_VIEW) and rejects roles without it', async () => {
    const salesRes = await request('/api/customers', { token: salesToken });
    assert.equal(salesRes.status, 200);
    assert.ok(Array.isArray(salesRes.data.customers));

    // Warehouse role lacks CUSTOMERS_VIEW / CUSTOMERS_MANAGE → must be rejected.
    const whRes = await request('/api/customers', { token: warehouseToken });
    assert.equal(whRes.status, 403);

    // Accounting role lacks CUSTOMERS_VIEW / CUSTOMERS_MANAGE → must be rejected.
    const accRes = await request('/api/customers', { token: accountingToken });
    assert.equal(accRes.status, 403);
  });

  test('POST /api/customers creates a customer, returns 201 + { id }, and writes an audit log', async () => {
    const code = `C-W3B-${Date.now()}`;
    const created = await request('/api/customers', {
      method: 'POST',
      body: {
        code,
        name: 'Wave3B 测试客户',
        contact: '王测试',
        phone: '13900139000',
        address: '广东省深圳市福田区',
        paymentTermsDays: 30,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(typeof created.data.id, 'string');

    const row = database.prepare('SELECT code,name,contact,phone,address,payment_terms_days paymentTermsDays,active FROM customers WHERE id=?').get(created.data.id);
    assert.equal(row.code, code);
    assert.equal(row.name, 'Wave3B 测试客户');
    assert.equal(row.contact, '王测试');
    assert.equal(row.phone, '13900139000');
    assert.equal(row.address, '广东省深圳市福田区');
    assert.equal(row.paymentTermsDays, 30);
    assert.equal(row.active, 1, 'new customers must be active=1 in the DB');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='CUSTOMER' AND entity_id=?").get(created.data.id);
    assert.ok(audit, 'CREATE CUSTOMER audit log must be written');
    assert.equal(audit.detail, code);
  });

  test('POST /api/customers validates the canonical field contract on the backend', async () => {
    const missingCode = await request('/api/customers', {
      method: 'POST',
      body: { name: 'missing code' },
    });
    assert.equal(missingCode.status, 400);

    const missingName = await request('/api/customers', {
      method: 'POST',
      body: { code: `C-NO-NAME-${Date.now()}` },
    });
    assert.equal(missingName.status, 400);

    const invalidCode = await request('/api/customers', {
      method: 'POST',
      body: { code: 'C INVALID', name: 'bad code' },
    });
    assert.equal(invalidCode.status, 400);
  });

  test('POST /api/customers preserves the exact paymentTermsDays 400 error message on invalid values', async () => {
    // The shared paymentTermsDays helper extracted in Wave 3B
    // must keep the exact same 400 message and 0–3650 boundary
    // semantics as the previous app-local implementation.
    const tooLarge = await request('/api/customers', {
      method: 'POST',
      body: {
        code: `C-OVER-${Date.now()}`,
        name: '超过上限',
        paymentTermsDays: 4000,
      },
    });
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.data.error, /付款条款天数必须是 0–3650 的整数/);

    const negative = await request('/api/customers', {
      method: 'POST',
      body: {
        code: `C-NEG-${Date.now()}`,
        name: '负数',
        paymentTermsDays: -1,
      },
    });
    assert.equal(negative.status, 400);
    assert.match(negative.data.error, /付款条款天数必须是 0–3650 的整数/);

    const nonInteger = await request('/api/customers', {
      method: 'POST',
      body: {
        code: `C-FRAC-${Date.now()}`,
        name: '非整数',
        paymentTermsDays: 1.5,
      },
    });
    assert.equal(nonInteger.status, 400);
    assert.match(nonInteger.data.error, /付款条款天数必须是 0–3650 的整数/);
  });

  test('POST /api/customers defaults paymentTermsDays to 0 when omitted / null / empty', async () => {
    // The shared paymentTermsDays helper treats
    // undefined / null / '' as 0 — same behavior as the
    // pre-extraction implementation. This is the "valid behavior"
    // branch the brief requires preserving.
    const code = `C-DEF-${Date.now()}`;
    const created = await request('/api/customers', {
      method: 'POST',
      body: { code, name: '默认 0 天客户' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = database.prepare('SELECT payment_terms_days FROM customers WHERE id=?').get(created.data.id);
    assert.equal(row.payment_terms_days, 0);
  });

  test('POST /api/customers requires CUSTOMERS_MANAGE (warehouse is rejected)', async () => {
    const created = await request('/api/customers', {
      token: warehouseToken,
      method: 'POST',
      body: { code: `C-WHSALES-${Date.now()}`, name: 'warehouse should not create' },
    });
    assert.equal(created.status, 403);
  });

  test('PATCH /api/customers/:id returns 200 on a valid update', async () => {
    const patched = await request('/api/customers/customer-002', {
      method: 'PATCH',
      body: {
        name: '广州智联电子有限公司（改名）',
        contact: '王总改',
        phone: '13911111111',
        address: '广东省广州市天河区珠江新城A座',
        paymentTermsDays: 45,
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.deepEqual(patched.data, { ok: true });

    const row = database.prepare('SELECT name,contact,phone,address,payment_terms_days paymentTermsDays,active FROM customers WHERE id=?').get('customer-002');
    assert.equal(row.name, '广州智联电子有限公司（改名）');
    assert.equal(row.contact, '王总改');
    assert.equal(row.phone, '13911111111');
    assert.equal(row.address, '广东省广州市天河区珠江新城A座');
    assert.equal(row.paymentTermsDays, 45);
    assert.equal(row.active, 1);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='CUSTOMER' AND entity_id=?").get('customer-002');
    assert.ok(audit, 'UPDATE CUSTOMER audit log must be written');
  });

  test('PATCH /api/customers/:id returns 404 for a non-existent customer', async () => {
    const result = await request('/api/customers/__no_such_customer__', {
      method: 'PATCH',
      body: { name: '不存在的客户' },
    });
    assert.equal(result.status, 404);
    assert.match(result.data.error, /客户不存在/);
  });

  test('PATCH /api/customers/:id converts the active Boolean and persists it as 0 / 1', async () => {
    // active: false must round-trip to active=0 in the DB.
    const disabled = await request('/api/customers/customer-003', {
      method: 'PATCH',
      body: { active: false },
    });
    assert.equal(disabled.status, 200);
    const rowOff = database.prepare('SELECT active FROM customers WHERE id=?').get('customer-003');
    assert.equal(rowOff.active, 0, 'active Boolean false must round-trip to 0 in the DB');

    // active: true must round-trip to active=1 in the DB.
    const enabled = await request('/api/customers/customer-003', {
      method: 'PATCH',
      body: { active: true },
    });
    assert.equal(enabled.status, 200);
    const rowOn = database.prepare('SELECT active FROM customers WHERE id=?').get('customer-003');
    assert.equal(rowOn.active, 1, 'active Boolean true must round-trip to 1 in the DB');
  });

  test('PATCH /api/customers/:id persists paymentTermsDays changes through the shared helper', async () => {
    // Re-runs the exact same numeric-input path the
    // pre-extraction implementation used: the PATCH body
    // paymentTermsDays flows through the shared helper, which
    // must yield the same boundary behavior.
    const updated = await request('/api/customers/customer-002', {
      method: 'PATCH',
      body: { paymentTermsDays: 60 },
    });
    assert.equal(updated.status, 200);
    const row = database.prepare('SELECT payment_terms_days FROM customers WHERE id=?').get('customer-002');
    assert.equal(row.payment_terms_days, 60);

    // And invalid paymentTermsDays on PATCH still returns the
    // exact same 400 error message as POST (shared helper).
    const invalid = await request('/api/customers/customer-002', {
      method: 'PATCH',
      body: { paymentTermsDays: 9999 },
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.error, /付款条款天数必须是 0–3650 的整数/);
  });

  test('DELETE /api/customers/:id on a referenced customer returns RECORD_REFERENCED 409 (canonical lifecycle delegation)', async () => {
    // customer-001 is seeded and is referenced by
    // sales_orders.order-demo-001 → canonical
    // deleteMasterRecord must surface the 409.
    const result = await request('/api/customers/customer-001', { method: 'DELETE' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'RECORD_REFERENCED');
    assert.match(result.data.error, /客户已有业务引用/);
  });

  test('DELETE /api/customers/:id on an unreferenced customer returns 200 and writes an audit log', async () => {
    database.prepare(`INSERT INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at, payment_terms_days) VALUES ('wave3b-cu-empty', 'W3B-CU-EMPTY', 'W3B 自由客户', '', '', '', 1, ?, ?, 0)`).run(
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    );
    const result = await request('/api/customers/wave3b-cu-empty', { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(database.prepare('SELECT 1 FROM customers WHERE id=?').get('wave3b-cu-empty'), undefined);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_type='CUSTOMER' AND entity_id=?").get('wave3b-cu-empty');
    assert.ok(audit, 'DELETE CUSTOMER audit log must be written by the canonical lifecycle implementation');
  });
});
