import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function startApi(db) {
  const server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeApi(server) {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.token;
}

async function api(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

function addActor(db, suffix, permissions) {
  const roleId = `role-quality-${suffix}`;
  const userId = `user-quality-${suffix}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
    .run(roleId, `QUALITY_${suffix.toUpperCase()}`, suffix, '', now);
  for (const permission of permissions) db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(roleId, permission);
  const password = `quality-${suffix}-1234`;
  const hashed = hashPassword(password);
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`).run(userId, `quality_${suffix}`, suffix, hashed.hash, hashed.salt, roleId, now);
  return { id: userId, username: `quality_${suffix}`, password };
}

const productCode = () => `P${Date.now()}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const supplierCode = () => `S${Date.now()}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const customerCode = () => `C${Date.now()}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

function seedFixtures(db) {
  const now = new Date().toISOString();
  const productId = `product-${productCode()}`;
  const productCode1 = productCode();
  const supplierId = `supplier-${supplierCode()}`;
  const customerId = `customer-${customerCode()}`;
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`)
    .run(productId, productCode1, '测试产品', '件', 1000, now, now);
  db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(supplierId, supplierCode(), '测试供应商', '', '', '', now, now);
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(customerId, customerCode(), '测试客户', '', '', '', now, now);
  return { productId, productCode1, supplierId, customerId };
}

const iqcBody = (fixtures, overrides = {}) => ({
  supplier_id: fixtures.supplierId,
  inspection_type: 'NORMAL',
  total_quantity: 100,
  sample_quantity: 20,
  qualified_quantity: 18,
  reject_quantity: 1,
  remark: '',
  items: [
    {
      product_id: fixtures.productId,
      batch_no: 'BATCH-A',
      quantity: 60,
      sample_size: 12,
      qualified: 1,
      reject_reason: '',
    },
    {
      product_id: fixtures.productId,
      batch_no: 'BATCH-B',
      quantity: 40,
      sample_size: 8,
      qualified: 0,
      reject_reason: '外观不良',
    },
  ],
  ...overrides,
});

const oqcBody = (fixtures, overrides = {}) => ({
  customer_id: fixtures.customerId,
  inspection_type: 'NORMAL',
  total_quantity: 80,
  sample_quantity: 16,
  qualified_quantity: 15,
  reject_quantity: 1,
  remark: '',
  items: [
    {
      product_id: fixtures.productId,
      batch_no: 'OUT-A',
      quantity: 50,
      sample_size: 10,
      qualified: 1,
      reject_reason: '',
    },
    {
      product_id: fixtures.productId,
      batch_no: 'OUT-B',
      quantity: 30,
      sample_size: 6,
      qualified: 0,
      reject_reason: '尺寸偏差',
    },
  ],
  ...overrides,
});

describe('Quality permission registry and reconciliation', () => {
  let tmp;
  let db;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-quality-roles-'));
    db = createDatabase(join(tmp, 'erp.db'));
  });

  after(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('IQC_VIEW / IQC_MANAGE / OQC_VIEW / OQC_MANAGE are registered', () => {
    const codes = db.prepare('SELECT code FROM permissions').all().map((row) => row.code);
    assert.ok(codes.includes('IQC_VIEW'));
    assert.ok(codes.includes('IQC_MANAGE'));
    assert.ok(codes.includes('OQC_VIEW'));
    assert.ok(codes.includes('OQC_MANAGE'));
  });

  test('role-warehouse receives IQC and OQC permissions', () => {
    const permissions = db.prepare("SELECT permission_code code FROM role_permissions WHERE role_id='role-warehouse'").all().map((row) => row.code);
    assert.ok(permissions.includes('IQC_VIEW'));
    assert.ok(permissions.includes('IQC_MANAGE'));
    assert.ok(permissions.includes('OQC_VIEW'));
    assert.ok(permissions.includes('OQC_MANAGE'));
  });

  test('role-sales, role-reviewer, role-accounting do not receive Quality permissions', () => {
    for (const roleId of ['role-sales', 'role-reviewer', 'role-accounting']) {
      const count = db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id=? AND (permission_code LIKE 'IQC_%' OR permission_code LIKE 'OQC_%')").get(roleId).count;
      assert.equal(count, 0, `${roleId} must not hold IQC/OQC permissions`);
    }
  });

  test('role-admin inherits Quality permissions through all-canonical-permissions rule', () => {
    const permissions = db.prepare("SELECT permission_code code FROM role_permissions WHERE role_id='role-admin'").all().map((row) => row.code);
    for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
      assert.ok(permissions.includes(code), `admin must inherit ${code}`);
    }
  });

  test('existing DB role reconciliation is idempotent for warehouse Quality permissions', () => {
    db.prepare("DELETE FROM role_permissions WHERE role_id='role-warehouse' AND permission_code IN ('IQC_VIEW','IQC_MANAGE','OQC_VIEW','OQC_MANAGE')").run();
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
      assert.equal(db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-warehouse' AND permission_code=?").get(code).count, 1, `${code} must be re-added`);
    }
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
      assert.equal(db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-warehouse' AND permission_code=?").get(code).count, 1, `${code} must remain a single row after rerun`);
    }
  });
});

describe('IQC canonical contract', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let warehouseToken;
  let salesToken;
  let accountingToken;
  let fixtures;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-iqc-'));
    db = createDatabase(join(tmp, 'erp.db'));
    fixtures = seedFixtures(db);
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
    salesToken = await login(baseUrl, 'sales', 'sales123');
    accountingToken = await login(baseUrl, 'accounting', 'accounting123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse GET /api/iqc returns 200', async () => {
    const res = await api(baseUrl, warehouseToken, '/api/iqc');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(Array.isArray(res.body.inspections));
  });

  test('sales and accounting are forbidden from listing IQC', async () => {
    for (const token of [salesToken, accountingToken]) {
      assert.equal((await api(baseUrl, token, '/api/iqc')).status, 403);
    }
  });

  test('valid IQC create persists header + every item transactionally (P0 regression)', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.ok(id);
    const header = db.prepare('SELECT iqc_no,supplier_id,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,status FROM iqc_inspections WHERE id=?').get(id);
    assert.ok(header);
    assert.equal(header.supplier_id, fixtures.supplierId);
    assert.equal(header.total_quantity, 100);
    assert.equal(header.sample_quantity, 20);
    assert.equal(header.qualified_quantity, 18);
    assert.equal(header.reject_quantity, 1);
    assert.equal(header.inspector_id, 'user-warehouse');
    assert.equal(header.status, 'PENDING');
    const items = db.prepare('SELECT product_id,batch_no,quantity,sample_size,qualified,reject_reason FROM iqc_inspection_items WHERE iqc_id=? ORDER BY batch_no').all(id);
    assert.equal(items.length, 2);
    assert.equal(items[0].batch_no, 'BATCH-A');
    assert.equal(items[0].quantity, 60);
    assert.equal(items[0].sample_size, 12);
    assert.equal(items[0].qualified, 1);
    assert.equal(items[1].batch_no, 'BATCH-B');
    assert.equal(items[1].qualified, 0);
    assert.equal(items[1].reject_reason, '外观不良');
  });

  test('IQC create with no items rolls back entire transaction', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM iqc_inspections').get().count;
    const beforeItems = db.prepare('SELECT count(*) count FROM iqc_inspection_items').get().count;
    const res = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures, { items: [] }) });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM iqc_inspections').get().count, beforeCount, 'header must not be persisted on validation failure');
    assert.equal(db.prepare('SELECT count(*) count FROM iqc_inspection_items').get().count, beforeItems, 'items must not be persisted on validation failure');
  });

  test('IQC create with malformed quantities rejects and rolls back', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM iqc_inspections').get().count;
    const bad = iqcBody(fixtures, { sample_quantity: -5 });
    const res = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: bad });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM iqc_inspections').get().count, beforeCount);
  });

  test('IQC create with sample > inspected rejects and rolls back', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM iqc_inspections').get().count;
    const bad = iqcBody(fixtures, { sample_quantity: 500 });
    const res = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: bad });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM iqc_inspections').get().count, beforeCount);
  });

  test('IQC create with qualified + reject > sample rejects and rolls back', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM iqc_inspections').get().count;
    const bad = iqcBody(fixtures, { sample_quantity: 10, qualified_quantity: 8, reject_quantity: 5 });
    const res = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: bad });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM iqc_inspections').get().count, beforeCount);
  });

  test('IQC GET /:id returns header + items', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    const detail = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.inspection);
    assert.equal(detail.body.inspection.id, created.body.id);
    assert.equal(detail.body.inspection.supplier_name, '测试供应商');
    assert.equal(detail.body.inspection.items.length, 2);
  });

  test('IQC PATCH replaces items without duplicating rows', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    const newItems = [
      { product_id: fixtures.productId, batch_no: 'UPDATED-1', quantity: 30, sample_size: 6, qualified: 1, reject_reason: '' },
      { product_id: fixtures.productId, batch_no: 'UPDATED-2', quantity: 20, sample_size: 4, qualified: 0, reject_reason: '再次检验' },
      { product_id: fixtures.productId, batch_no: 'UPDATED-3', quantity: 10, sample_size: 2, qualified: 1, reject_reason: '' },
    ];
    const patched = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}`, {
      method: 'PATCH',
      body: { ...iqcBody(fixtures), items: newItems },
    });
    assert.equal(patched.status, 200, patched.body.error);
    const itemCount = db.prepare('SELECT count(*) count FROM iqc_inspection_items WHERE iqc_id=?').get(created.body.id).count;
    assert.equal(itemCount, 3, 'PATCH should not duplicate items');
    const docCount = db.prepare('SELECT count(*) count FROM iqc_inspections WHERE id=?').get(created.body.id).count;
    assert.equal(docCount, 1, 'PATCH should not duplicate header');
  });

  test('IQC POST /:id/complete transitions PENDING -> COMPLETED with result and persisted quantities', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    const complete = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 19, reject_quantity: 1 },
    });
    assert.equal(complete.status, 200, complete.body.error);
    const row = db.prepare('SELECT status,result,qualified_quantity,reject_quantity,inspected_at FROM iqc_inspections WHERE id=?').get(created.body.id);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.result, 'PASS');
    assert.equal(row.qualified_quantity, 19);
    assert.equal(row.reject_quantity, 1);
    assert.ok(row.inspected_at, 'inspected_at must be set on completion');
  });

  test('repeated IQC complete returns 409', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 18, reject_quantity: 2 },
    });
    const second = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'FAIL', qualified_quantity: 5, reject_quantity: 15 },
    });
    assert.equal(second.status, 409);
  });

  test('IQC complete with unknown result returns 400', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    const res = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASSED', qualified_quantity: 0, reject_quantity: 0 },
    });
    assert.equal(res.status, 400);
  });

  test('IQC PATCH on COMPLETED inspection returns 409', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 20, reject_quantity: 0 },
    });
    const patched = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}`, {
      method: 'PATCH',
      body: iqcBody(fixtures),
    });
    assert.equal(patched.status, 409);
  });

  test('IQ_GET /:id for non-existent inspection returns 404 not 500', async () => {
    const res = await api(baseUrl, warehouseToken, '/api/iqc/does-not-exist');
    assert.equal(res.status, 404);
  });

  test('sales cannot mutate IQC resources', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    const post = await api(baseUrl, salesToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    assert.equal(post.status, 403);
    const patch = await api(baseUrl, salesToken, `/api/iqc/${created.body.id}`, { method: 'PATCH', body: iqcBody(fixtures) });
    assert.equal(patch.status, 403);
    const complete = await api(baseUrl, salesToken, `/api/iqc/${created.body.id}/complete`, { method: 'POST', body: { result: 'PASS' } });
    assert.equal(complete.status, 403);
  });

  test('admin inherits IQC permissions', async () => {
    const res = await api(baseUrl, adminToken, '/api/iqc', { method: 'POST', body: iqcBody(fixtures) });
    assert.equal(res.status, 201, res.body.error);
  });
});

describe('OQC canonical contract', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let warehouseToken;
  let salesToken;
  let accountingToken;
  let fixtures;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-oqc-'));
    db = createDatabase(join(tmp, 'erp.db'));
    fixtures = seedFixtures(db);
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
    salesToken = await login(baseUrl, 'sales', 'sales123');
    accountingToken = await login(baseUrl, 'accounting', 'accounting123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse GET /api/oqc returns 200', async () => {
    const res = await api(baseUrl, warehouseToken, '/api/oqc');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.inspections));
  });

  test('sales and accounting are forbidden from listing OQC', async () => {
    for (const token of [salesToken, accountingToken]) {
      assert.equal((await api(baseUrl, token, '/api/oqc')).status, 403);
    }
  });

  test('valid OQC create persists header + every item transactionally (P0 regression)', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    const header = db.prepare('SELECT oqc_no,customer_id,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,status FROM oqc_inspections WHERE id=?').get(id);
    assert.equal(header.customer_id, fixtures.customerId);
    assert.equal(header.total_quantity, 80);
    assert.equal(header.sample_quantity, 16);
    assert.equal(header.qualified_quantity, 15);
    assert.equal(header.reject_quantity, 1);
    assert.equal(header.inspector_id, 'user-warehouse');
    assert.equal(header.status, 'PENDING');
    const items = db.prepare('SELECT product_id,batch_no,quantity,sample_size,qualified,reject_reason FROM oqc_inspection_items WHERE oqc_id=? ORDER BY batch_no').all(id);
    assert.equal(items.length, 2);
    assert.equal(items[0].batch_no, 'OUT-A');
    assert.equal(items[1].batch_no, 'OUT-B');
    assert.equal(items[1].qualified, 0);
  });

  test('OQC create with no items rolls back entire transaction', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM oqc_inspections').get().count;
    const res = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures, { items: [] }) });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM oqc_inspections').get().count, beforeCount);
  });

  test('OQC create with malformed quantities rejects and rolls back', async () => {
    const beforeCount = db.prepare('SELECT count(*) count FROM oqc_inspections').get().count;
    const bad = oqcBody(fixtures, { sample_quantity: -1 });
    const res = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: bad });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) count FROM oqc_inspections').get().count, beforeCount);
  });

  test('OQC GET /:id returns header + items', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    const detail = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.inspection);
    assert.equal(detail.body.inspection.customer_name, '测试客户');
    assert.equal(detail.body.inspection.items.length, 2);
  });

  test('OQC PATCH replaces items without duplicating rows', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    const newItems = [
      { product_id: fixtures.productId, batch_no: 'NEW-1', quantity: 25, sample_size: 5, qualified: 1, reject_reason: '' },
      { product_id: fixtures.productId, batch_no: 'NEW-2', quantity: 15, sample_size: 3, qualified: 0, reject_reason: '更新后不合格' },
    ];
    const patched = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}`, {
      method: 'PATCH',
      body: { ...oqcBody(fixtures), items: newItems },
    });
    assert.equal(patched.status, 200);
    const itemCount = db.prepare('SELECT count(*) count FROM oqc_inspection_items WHERE oqc_id=?').get(created.body.id).count;
    assert.equal(itemCount, 2);
  });

  test('OQC POST /:id/complete transitions PENDING -> COMPLETED', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    const complete = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'FAIL', qualified_quantity: 10, reject_quantity: 6 },
    });
    assert.equal(complete.status, 200);
    const row = db.prepare('SELECT status,result,qualified_quantity,reject_quantity,inspected_at FROM oqc_inspections WHERE id=?').get(created.body.id);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.result, 'FAIL');
    assert.equal(row.qualified_quantity, 10);
    assert.equal(row.reject_quantity, 6);
    assert.ok(row.inspected_at);
  });

  test('repeated OQC complete returns 409', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 16, reject_quantity: 0 },
    });
    const second = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 16, reject_quantity: 0 },
    });
    assert.equal(second.status, 409);
  });

  test('OQC PATCH on COMPLETED inspection returns 409', async () => {
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', qualified_quantity: 16, reject_quantity: 0 },
    });
    const patched = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}`, {
      method: 'PATCH',
      body: oqcBody(fixtures),
    });
    assert.equal(patched.status, 409);
  });

  test('sales cannot mutate OQC resources', async () => {
    const post = await api(baseUrl, salesToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    assert.equal(post.status, 403);
    const created = await api(baseUrl, warehouseToken, '/api/oqc', { method: 'POST', body: oqcBody(fixtures) });
    const patch = await api(baseUrl, salesToken, `/api/oqc/${created.body.id}`, { method: 'PATCH', body: oqcBody(fixtures) });
    assert.equal(patch.status, 403);
  });
});

describe('Quality lookups accessible to warehouse actor', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let warehouseToken;
  let reviewerToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-quality-lookups-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
    reviewerToken = await login(baseUrl, 'reviewer', 'review123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('warehouse can resolve IQC supplier dependency via narrow lookup', async () => {
    const res = await api(baseUrl, warehouseToken, '/api/lookup/suppliers');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(res.body.suppliers.length >= 1);
    assert.deepEqual(Object.keys(res.body.suppliers[0]).sort(), ['code', 'id', 'name']);
  });

  test('warehouse can resolve OQC customer dependency via narrow lookup', async () => {
    const res = await api(baseUrl, warehouseToken, '/api/lookup/customers');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(res.body.customers.length >= 1);
    assert.deepEqual(Object.keys(res.body.customers[0]).sort(), ['code', 'id', 'name']);
  });

  test('reviewer (no IQC/OQC) cannot use narrow lookups for quality workflows', async () => {
    assert.equal((await api(baseUrl, reviewerToken, '/api/lookup/suppliers')).status, 403);
    assert.equal((await api(baseUrl, reviewerToken, '/api/lookup/customers')).status, 403);
  });

  test('warehouse does not gain full master-data MANAGE permissions', async () => {
    assert.equal((await api(baseUrl, warehouseToken, '/api/suppliers')).status, 403);
    assert.equal((await api(baseUrl, warehouseToken, '/api/customers')).status, 403);
  });
});

describe('Quality frontend modal stability and contract alignment', () => {
  let vite;
  const qualitySource = readFileSync(resolve(repoRoot, 'src', 'pages', 'quality.jsx'), 'utf8');
  const appSource = readFileSync(resolve(repoRoot, 'src', 'App.jsx'), 'utf8');
  const extendedSource = readFileSync(resolve(repoRoot, 'server', 'modules', 'extended.js'), 'utf8');
  const appJsSource = readFileSync(resolve(repoRoot, 'server', 'app.js'), 'utf8');

  before(async () => {
    vite = await createViteServer({ root: repoRoot, server: { middlewareMode: true }, appType: 'custom' });
  });

  after(async () => {
    await vite.close();
  });

  test('IQCModal and OQCModal accept user and notify props (no undeclared reference)', () => {
    assert.match(qualitySource, /function\s+IQCModal\s*\(\s*\{\s*user\s*,\s*notify/);
    assert.match(qualitySource, /function\s+OQCModal\s*\(\s*\{\s*user\s*,\s*notify/);
    assert.match(qualitySource, /<IQCModal[^>]*user=\{user\}/);
    assert.match(qualitySource, /<IQCModal[^>]*notify=\{notify\}/);
    assert.match(qualitySource, /<OQCModal[^>]*user=\{user\}/);
    assert.match(qualitySource, /<OQCModal[^>]*notify=\{notify\}/);
  });

  test('frontend IQC/OQC buttons no longer reference the nonexistent QC_MANAGE', () => {
    // Standalone QC_MANAGE (as a permission code) must be absent — IQC_MANAGE / OQC_MANAGE are canonical.
    assert.doesNotMatch(qualitySource, /['"]QC_MANAGE['"]/);
    assert.doesNotMatch(qualitySource, /\bQC_MANAGE\b/);
  });

  test('frontend uses canonical IQC/OQC permission codes', () => {
    assert.match(qualitySource, /can\(user,\s*'IQC_MANAGE'\)/);
    assert.match(qualitySource, /can\(user,\s*'OQC_MANAGE'\)/);
  });

  test('frontend uses canonical iqc_no / oqc_no / supplier_name / customer_name / inspector_name field names', () => {
    assert.match(qualitySource, /item\.iqc_no/);
    assert.match(qualitySource, /item\.oqc_no/);
    assert.match(qualitySource, /item\.supplier_name/);
    assert.match(qualitySource, /item\.customer_name/);
    assert.match(qualitySource, /item\.inspector_name/);
    assert.doesNotMatch(qualitySource, /supplierName|inspectorName|customerName/);
    assert.doesNotMatch(qualitySource, /inspection_no|inspection_date/);
    assert.doesNotMatch(qualitySource, /sampled_quantity|defective_quantity|defect_rate|inspection_result/);
  });

  test('frontend uses canonical PENDING / COMPLETED status and PASS / FAIL result enums', () => {
    assert.match(qualitySource, /'PENDING'/);
    assert.match(qualitySource, /'COMPLETED'/);
    assert.match(qualitySource, /'PASS'/);
    assert.match(qualitySource, /'FAIL'/);
    assert.doesNotMatch(qualitySource, /'PASSED'|'FAILED'|'ACCEPTED_WITH_REMARK'|'ACCEPT'/);
  });

  test('frontend uses canonical IQC item field names (sample_size, qualified, reject_reason)', () => {
    assert.match(qualitySource, /sample_size/);
    assert.match(qualitySource, /reject_reason/);
    assert.match(qualitySource, /qualified/);
  });

  test('frontend uses narrow lookups for supplier/customer pickers', () => {
    assert.match(qualitySource, /\/api\/lookup\/suppliers/);
    assert.match(qualitySource, /\/api\/lookup\/customers/);
  });

  test('frontend derives inspector from authenticated user, no /api/users lookup', () => {
    assert.doesNotMatch(qualitySource, /\/api\/users/);
    assert.match(qualitySource, /user\?\.displayName\s*\|\|\s*user\?\.username/);
  });

  test('frontend catches fetch failures and routes them through notify', () => {
    assert.match(qualitySource, /\.catch\(\(e\)\s*=>\s*notifyError/);
  });

  test('App.jsx IQC/OQC nav still uses canonical permission codes', () => {
    assert.match(appSource, /key:\s*'iqc'[\s\S]{0,80}IQC_VIEW[\s\S]{0,80}IQC_MANAGE/);
    assert.match(appSource, /key:\s*'oqc'[\s\S]{0,80}OQC_VIEW[\s\S]{0,80}OQC_MANAGE/);
  });

  test('IQCModal SSR-renders into markup (no render exception)', async () => {
    const mod = await vite.ssrLoadModule('/src/pages/quality.jsx');
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const element = createElement(mod.IQCInspections, {
      user: { id: 'user-warehouse', username: 'warehouse', displayName: '仓库管理员', permissions: ['IQC_MANAGE', 'IQC_VIEW'] },
      notify: () => {},
    });
    const markup = renderToStaticMarkup(element);
    assert.ok(markup.includes('IQC 来料检验'));
    assert.ok(!/ReferenceError|TypeError|SyntaxError/.test(markup));
  });

  test('OQCModal SSR-renders into markup (no render exception)', async () => {
    const mod = await vite.ssrLoadModule('/src/pages/quality.jsx');
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const element = createElement(mod.OQCInspections, {
      user: { id: 'user-warehouse', username: 'warehouse', displayName: '仓库管理员', permissions: ['OQC_MANAGE', 'OQC_VIEW'] },
      notify: () => {},
    });
    const markup = renderToStaticMarkup(element);
    assert.ok(markup.includes('OQC 出货检验'));
  });

  test('backend does not register or authorize QC_MANAGE / QC_VIEW', () => {
    assert.doesNotMatch(extendedSource, /['"]QC_MANAGE['"]/);
    assert.doesNotMatch(extendedSource, /['"]QC_VIEW['"]/);
    assert.doesNotMatch(appJsSource, /['"]QC_MANAGE['"]/);
    assert.doesNotMatch(appJsSource, /['"]QC_VIEW['"]/);
  });

  test('backend wires GET /:id, PATCH /:id, POST /:id/complete for both IQC and OQC', () => {
    const iqcRoutes = [
      "/api/iqc' && req.method === 'GET'",
      "req.method === 'GET'.*getIqcInspection|getIqcInspection.*req\\.method === 'GET'",
      "req.method === 'PATCH'.*updateIqcInspection|updateIqcInspection.*req\\.method === 'PATCH'",
      "/complete'.*completeIqcInspection|completeIqcInspection.*complete'",
    ];
    assert.match(appJsSource, /\/api\/iqc'\s*&&\s*req\.method\s*===\s*'GET'.*listIqcInspections/s);
    assert.match(appJsSource, /req\.method\s*===\s*'PATCH'.*updateIqcInspection|updateIqcInspection.*req\.method\s*===\s*'PATCH'/s);
    assert.match(appJsSource, /completeIqcInspection/s);
    assert.match(appJsSource, /\/api\/oqc'\s*&&\s*req\.method\s*===\s*'GET'.*listOqcInspections/s);
    assert.match(appJsSource, /req\.method\s*===\s*'PATCH'.*updateOqcInspection|updateOqcInspection.*req\.method\s*===\s*'PATCH'/s);
    assert.match(appJsSource, /completeOqcInspection/s);
  });

  test('supplier evaluation route remains untouched (non-regression)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modern-erp-quality-se-'));
    const localDb = createDatabase(join(tmp, 'erp.db'));
    const now = new Date().toISOString();
    localDb.prepare('INSERT INTO suppliers(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run('supplier-se-1', 'SE-1', 'SE供应商', now, now);
    const localApp = createApp(localDb, { distDir: resolve(repoRoot, 'dist') });
    const localServer = createServer(localApp);
    await new Promise((res) => localServer.listen(0, '127.0.0.1', res));
    const localUrl = `http://127.0.0.1:${localServer.address().port}`;
    const token = await login(localUrl, 'admin', 'admin123');
    const created = await api(localUrl, token, '/api/supplier-evaluations', {
      method: 'POST',
      body: {
        supplier_id: 'supplier-se-1',
        evaluation_type: 'REGULAR',
        evaluation_date: '2026-09-02',
        quality_score: 90,
        delivery_score: 80,
        price_score: 70,
        service_score: 60,
        remark: '',
      },
    });
    assert.equal(created.status, 201, created.body.error);
    const list = await api(localUrl, token, '/api/supplier-evaluations');
    assert.equal(list.status, 200);
    assert.equal(list.body.evaluations.length, 1);
    assert.equal(list.body.evaluations[0].supplier_id, 'supplier-se-1');
    await closeApi(localServer);
    localDb.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});
