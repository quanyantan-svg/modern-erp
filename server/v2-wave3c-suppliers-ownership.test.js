// V2 Stage 3 / Wave 3C — focused behavior coverage for the migrated
// supplier route family.
//
// Pure ownership-migration tests. The pre-existing
// `server/p2-data-lifecycle.test.js` suite already covers the
// canonical supplier DELETE behavior (referenced → 409
// RECORD_REFERENCED, unreferenced → 200 + DELETE audit). The
// `server/supplier-schema.test.js` suite covers the suppliers
// table column contract and email round-trip. This suite complements
// those tests by proving that the other endpoints behave identically
// after the route-table migration:
//
//   - GET /api/suppliers returns the canonical supplier list with
//     the historical shape (code, name, contact, phone, address,
//     paymentTermsDays, active Boolean, timestamps) and is
//     searchable by code / name / contact;
//   - GET /api/suppliers requires either SUPPLIERS_VIEW or
//     SUPPLIERS_MANAGE (admin / sales) and rejects roles that
//     lack both;
//   - POST /api/suppliers returns 201 + { id } on success, audits
//     CREATE SUPPLIER, persists email and paymentTermsDays, and
//     rejects unauthenticated callers;
//   - POST /api/suppliers enforces the canonical field contract
//     (code, name, contact, phone, address, email,
//     paymentTermsDays) with backend-side validation, including
//     the verbatim paymentTermsDays 400 error message;
//   - POST /api/suppliers requires SUPPLIERS_MANAGE (warehouse is
//     rejected);
//   - PATCH /api/suppliers/:id returns 200 on a valid update,
//     persists email and paymentTermsDays, converts the active
//     Boolean, and returns 404 for a non-existent supplier;
//   - DELETE /api/suppliers/:id continues to delegate to the
//     canonical deleteMasterRecord lifecycle implementation
//     (RECORD_REFERENCED on a referenced supplier, 200 on an
//     unreferenced one with DELETE SUPPLIER audit).
//
// There is intentionally NO GET /api/suppliers/:id in this suite —
// that endpoint does not exist in the current production contract.

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3c-sup-'));
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

describe('V2 Wave 3C — supplier route family behavior preservation', () => {
  test('GET /api/suppliers returns the canonical seeded suppliers with the historical shape', async () => {
    const result = await request('/api/suppliers');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.suppliers));
    const codes = result.data.suppliers.map((row) => row.code);
    assert.ok(codes.includes('S001'));
    assert.ok(codes.includes('S002'));
    assert.ok(codes.includes('S003'));
    const s001 = result.data.suppliers.find((row) => row.code === 'S001');
    assert.equal(typeof s001.id, 'string');
    assert.equal(s001.name, '深圳华强电子市场');
    assert.equal(s001.contact, '刘经理');
    assert.equal(s001.phone, '13500135001');
    assert.equal(s001.address, '广东省深圳市福田区华强北路');
    assert.equal(s001.active, true, 'active must be a true Boolean, not 1/0');
    assert.equal(typeof s001.paymentTermsDays, 'number');
    assert.equal(typeof s001.createdAt, 'string');
    assert.equal(typeof s001.updatedAt, 'string');
  });

  test('GET /api/suppliers?search filters by code, name, or contact and keeps the canonical response shape', async () => {
    const byCode = await request('/api/suppliers?search=S001');
    assert.equal(byCode.status, 200);
    assert.equal(byCode.data.suppliers.length, 1);
    assert.equal(byCode.data.suppliers[0].code, 'S001');

    const byName = await request('/api/suppliers?search=东莞');
    assert.equal(byName.status, 200);
    assert.equal(byName.data.suppliers.length, 1);
    assert.equal(byName.data.suppliers[0].code, 'S002');

    const byContact = await request('/api/suppliers?search=赵经理');
    assert.equal(byContact.status, 200);
    assert.equal(byContact.data.suppliers.length, 1);
    assert.equal(byContact.data.suppliers[0].code, 'S003');

    const empty = await request('/api/suppliers?search=__no_match__');
    assert.equal(empty.status, 200);
    assert.equal(empty.data.suppliers.length, 0);
  });

  test('GET /api/suppliers is reachable for sales role (SUPPLIERS_VIEW) and rejects roles without it', async () => {
    const salesRes = await request('/api/suppliers', { token: salesToken });
    assert.equal(salesRes.status, 200);
    assert.ok(Array.isArray(salesRes.data.suppliers));

    // Warehouse role lacks SUPPLIERS_VIEW / SUPPLIERS_MANAGE → must be rejected.
    const whRes = await request('/api/suppliers', { token: warehouseToken });
    assert.equal(whRes.status, 403);

    // Accounting role lacks SUPPLIERS_VIEW / SUPPLIERS_MANAGE → must be rejected.
    const accRes = await request('/api/suppliers', { token: accountingToken });
    assert.equal(accRes.status, 403);
  });

  test('POST /api/suppliers creates a supplier, returns 201 + { id }, and writes an audit log', async () => {
    const code = `S-W3C-${Date.now()}`;
    const created = await request('/api/suppliers', {
      method: 'POST',
      body: {
        code,
        name: 'Wave3C 测试供应商',
        contact: '王测试',
        phone: '13900139000',
        address: '广东省深圳市福田区',
        email: '[email protected]',
        paymentTermsDays: 30,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(typeof created.data.id, 'string');

    const row = database.prepare('SELECT code,name,contact,phone,address,email,payment_terms_days paymentTermsDays,active FROM suppliers WHERE id=?').get(created.data.id);
    assert.equal(row.code, code);
    assert.equal(row.name, 'Wave3C 测试供应商');
    assert.equal(row.contact, '王测试');
    assert.equal(row.phone, '13900139000');
    assert.equal(row.address, '广东省深圳市福田区');
    assert.equal(row.email, '[email protected]', 'email must round-trip through the shared helper');
    assert.equal(row.paymentTermsDays, 30);
    assert.equal(row.active, 1, 'new suppliers must be active=1 in the DB');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='SUPPLIER' AND entity_id=?").get(created.data.id);
    assert.ok(audit, 'CREATE SUPPLIER audit log must be written');
    assert.equal(audit.detail, code);
  });

  test('POST /api/suppliers validates the canonical field contract on the backend', async () => {
    const missingCode = await request('/api/suppliers', {
      method: 'POST',
      body: { name: 'missing code' },
    });
    assert.equal(missingCode.status, 400);

    const missingName = await request('/api/suppliers', {
      method: 'POST',
      body: { code: `S-NO-NAME-${Date.now()}` },
    });
    assert.equal(missingName.status, 400);

    const invalidCode = await request('/api/suppliers', {
      method: 'POST',
      body: { code: 'S INVALID', name: 'bad code' },
    });
    assert.equal(invalidCode.status, 400);
  });

  test('POST /api/suppliers preserves the exact paymentTermsDays 400 error message on invalid values', async () => {
    // The shared paymentTermsDays helper (extracted in Wave 3B
    // and reused unchanged here) must keep the exact same 400
    // message and 0–3650 boundary semantics for suppliers.
    const tooLarge = await request('/api/suppliers', {
      method: 'POST',
      body: {
        code: `S-OVER-${Date.now()}`,
        name: '超过上限',
        paymentTermsDays: 4000,
      },
    });
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.data.error, /付款条款天数必须是 0–3650 的整数/);

    const negative = await request('/api/suppliers', {
      method: 'POST',
      body: {
        code: `S-NEG-${Date.now()}`,
        name: '负数',
        paymentTermsDays: -1,
      },
    });
    assert.equal(negative.status, 400);
    assert.match(negative.data.error, /付款条款天数必须是 0–3650 的整数/);

    const nonInteger = await request('/api/suppliers', {
      method: 'POST',
      body: {
        code: `S-FRAC-${Date.now()}`,
        name: '非整数',
        paymentTermsDays: 1.5,
      },
    });
    assert.equal(nonInteger.status, 400);
    assert.match(nonInteger.data.error, /付款条款天数必须是 0–3650 的整数/);
  });

  test('POST /api/suppliers defaults paymentTermsDays to 0 when omitted', async () => {
    // The shared paymentTermsDays helper treats
    // undefined / null / '' as 0 — same behavior as the
    // pre-extraction implementation. This is the "valid behavior"
    // branch the brief requires preserving.
    const code = `S-DEF-${Date.now()}`;
    const created = await request('/api/suppliers', {
      method: 'POST',
      body: { code, name: '默认 0 天供应商' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = database.prepare('SELECT payment_terms_days FROM suppliers WHERE id=?').get(created.data.id);
    assert.equal(row.payment_terms_days, 0);
  });

  test('POST /api/suppliers requires SUPPLIERS_MANAGE (warehouse is rejected)', async () => {
    const created = await request('/api/suppliers', {
      token: warehouseToken,
      method: 'POST',
      body: { code: `S-WHSALES-${Date.now()}`, name: 'warehouse should not create' },
    });
    assert.equal(created.status, 403);
  });

  test('PATCH /api/suppliers/:id returns 200 on a valid update', async () => {
    const patched = await request('/api/suppliers/supplier-002', {
      method: 'PATCH',
      body: {
        name: '东莞原料供应商（改名）',
        contact: '陈总改',
        phone: '13611111111',
        address: '广东省东莞市厚街镇工业区',
        email: '[email protected]',
        paymentTermsDays: 45,
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.deepEqual(patched.data, { ok: true });

    const row = database.prepare('SELECT name,contact,phone,address,email,payment_terms_days paymentTermsDays,active FROM suppliers WHERE id=?').get('supplier-002');
    assert.equal(row.name, '东莞原料供应商（改名）');
    assert.equal(row.contact, '陈总改');
    assert.equal(row.phone, '13611111111');
    assert.equal(row.address, '广东省东莞市厚街镇工业区');
    assert.equal(row.email, '[email protected]');
    assert.equal(row.paymentTermsDays, 45);
    assert.equal(row.active, 1);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='SUPPLIER' AND entity_id=?").get('supplier-002');
    assert.ok(audit, 'UPDATE SUPPLIER audit log must be written');
  });

  test('PATCH /api/suppliers/:id returns 404 for a non-existent supplier', async () => {
    const result = await request('/api/suppliers/__no_such_supplier__', {
      method: 'PATCH',
      body: { name: '不存在的供应商' },
    });
    assert.equal(result.status, 404);
    assert.match(result.data.error, /供应商不存在/);
  });

  test('PATCH /api/suppliers/:id converts the active Boolean and persists it as 0 / 1', async () => {
    // active: false must round-trip to active=0 in the DB.
    const disabled = await request('/api/suppliers/supplier-003', {
      method: 'PATCH',
      body: { active: false },
    });
    assert.equal(disabled.status, 200);
    const rowOff = database.prepare('SELECT active FROM suppliers WHERE id=?').get('supplier-003');
    assert.equal(rowOff.active, 0, 'active Boolean false must round-trip to 0 in the DB');

    // active: true must round-trip to active=1 in the DB.
    const enabled = await request('/api/suppliers/supplier-003', {
      method: 'PATCH',
      body: { active: true },
    });
    assert.equal(enabled.status, 200);
    const rowOn = database.prepare('SELECT active FROM suppliers WHERE id=?').get('supplier-003');
    assert.equal(rowOn.active, 1, 'active Boolean true must round-trip to 1 in the DB');
  });

  test('PATCH /api/suppliers/:id preserves the paymentTermsDays boundary behavior through the shared helper', async () => {
    // Re-runs the exact same numeric-input path the
    // pre-extraction implementation used: the PATCH body
    // paymentTermsDays flows through the shared helper, which
    // must yield the same boundary behavior.
    const updated = await request('/api/suppliers/supplier-002', {
      method: 'PATCH',
      body: { paymentTermsDays: 60 },
    });
    assert.equal(updated.status, 200);
    const row = database.prepare('SELECT payment_terms_days FROM suppliers WHERE id=?').get('supplier-002');
    assert.equal(row.payment_terms_days, 60);

    // And invalid paymentTermsDays on PATCH still returns the
    // exact same 400 error message as POST (shared helper).
    const invalid = await request('/api/suppliers/supplier-002', {
      method: 'PATCH',
      body: { paymentTermsDays: 9999 },
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.error, /付款条款天数必须是 0–3650 的整数/);
  });

  test('DELETE /api/suppliers/:id on a referenced supplier returns RECORD_REFERENCED 409 (canonical lifecycle delegation)', async () => {
    // supplier-001 is seeded. Plant a purchase_order that
    // references supplier-001 so the canonical
    // deleteMasterRecord MASTER_RULES.supplier dependency check
    // must surface the 409.
    database.prepare(
      `INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at,order_date,expected_delivery_date,payment_terms,payment_terms_days,supplier_contact_name,supplier_contact_phone,supplier_address) VALUES ('wave3c-po-ref','PO-W3C-REF','supplier-001','APPROVED',0,'user-admin',?,?,?,?,'',0,'','','')`
    ).run('2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-15');

    const result = await request('/api/suppliers/supplier-001', { method: 'DELETE' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'RECORD_REFERENCED');
    assert.match(result.data.error, /供应商已有业务引用/);

    // The DB row must still exist because the delete was rejected.
    assert.ok(
      database.prepare('SELECT 1 FROM suppliers WHERE id=?').get('supplier-001'),
      'rejected DELETE must not remove the supplier row',
    );
  });

  test('DELETE /api/suppliers/:id on an unreferenced supplier returns 200 and writes an audit log', async () => {
    database.prepare(`INSERT INTO suppliers(id, code, name, contact, phone, address, email, active, created_at, updated_at, payment_terms_days) VALUES ('wave3c-sup-empty', 'W3C-SUP-EMPTY', 'W3C 自由供应商', '', '', '', '', 1, ?, ?, 0)`).run(
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    );
    const result = await request('/api/suppliers/wave3c-sup-empty', { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(database.prepare('SELECT 1 FROM suppliers WHERE id=?').get('wave3c-sup-empty'), undefined);

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_type='SUPPLIER' AND entity_id=?").get('wave3c-sup-empty');
    assert.ok(audit, 'DELETE SUPPLIER audit log must be written by the canonical lifecycle implementation');
  });
});
