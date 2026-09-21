import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  const roleId = `role-crm-${suffix}`;
  const userId = `user-crm-${suffix}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
    .run(roleId, `CRM_${suffix.toUpperCase()}`, suffix, '', now);
  for (const permission of permissions) db.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(roleId, permission);
  const password = `crm-${suffix}-1234`;
  const hashed = hashPassword(password);
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`).run(userId, `crm_${suffix}`, suffix, hashed.hash, hashed.salt, roleId, now);
  return { id: userId, username: `crm_${suffix}`, password };
}

const contactBody = (overrides = {}) => ({
  customer_id: 'customer-001',
  supplier_id: '',
  name: 'CRM 联系人',
  gender: 'MALE',
  position: '采购经理',
  phone: '0755-000000',
  mobile: '13800000000',
  email: 'crm@example.com',
  wechat: 'crm-wechat',
  birthday: '1990-01-02',
  remark: 'created',
  is_primary: true,
  ...overrides,
});

const followupBody = (overrides = {}) => ({
  customer_id: 'customer-001',
  followup_type: 'VISIT',
  followup_date: '2026-09-02',
  content: '首次拜访',
  next_plan: '下周复访',
  next_date: '2026-09-09',
  ...overrides,
});

const activityBody = (overrides = {}) => ({
  activity_type: 'VISIT',
  title: '客户拜访活动',
  content: '拜访重点客户',
  start_date: '2026-09-02',
  end_date: '2026-09-02',
  location: '深圳',
  budget_cents: 10000,
  actual_cost_cents: 7000,
  participants: '销售专员',
  status: 'PLANNING',
  result: '',
  ...overrides,
});

describe('CRM role contract and reconciliation', () => {
  let tmp;
  let db;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-crm-roles-'));
    db = createDatabase(join(tmp, 'erp.db'));
  });

  after(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('role-sales gets CRM_VIEW and CRM_MANAGE', () => {
    const permissions = db.prepare("SELECT permission_code code FROM role_permissions WHERE role_id='role-sales'").all().map((row) => row.code);
    assert.ok(permissions.includes('CRM_VIEW'));
    assert.ok(permissions.includes('CRM_MANAGE'));
  });

  test('admin inherits CRM permissions through all canonical permissions', () => {
    const permissions = db.prepare("SELECT permission_code code FROM role_permissions WHERE role_id='role-admin'").all().map((row) => row.code);
    assert.ok(permissions.includes('CRM_VIEW'));
    assert.ok(permissions.includes('CRM_MANAGE'));
  });

  test('reviewer, warehouse, and accounting do not gain CRM permissions', () => {
    for (const roleId of ['role-reviewer', 'role-warehouse', 'role-accounting']) {
      const count = db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id=? AND permission_code LIKE 'CRM_%'").get(roleId).count;
      assert.equal(count, 0, `${roleId} must not have CRM permissions`);
    }
  });

  test('existing DB role reconciliation is idempotent', () => {
    db.prepare("DELETE FROM role_permissions WHERE role_id='role-sales' AND permission_code IN ('CRM_VIEW','CRM_MANAGE')").run();
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    assert.equal(db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-sales' AND permission_code='CRM_VIEW'").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-sales' AND permission_code='CRM_MANAGE'").get().count, 1);
    db.close();
    db = createDatabase(join(tmp, 'erp.db'));
    assert.equal(db.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-sales' AND permission_code IN ('CRM_VIEW','CRM_MANAGE')").get().count, 2);
  });
});

describe('CRM API canonical behavior', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let salesToken;
  let adminToken;
  let viewToken;
  let reviewerToken;
  let warehouseToken;
  let accountingToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-crm-api-'));
    db = createDatabase(join(tmp, 'erp.db'));
    const view = addActor(db, 'view', ['CRM_VIEW']);
    ({ server, baseUrl } = await startApi(db));
    salesToken = await login(baseUrl, 'sales', 'sales123');
    adminToken = await login(baseUrl, 'admin', 'admin123');
    viewToken = await login(baseUrl, view.username, view.password);
    reviewerToken = await login(baseUrl, 'reviewer', 'review123');
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
    accountingToken = await login(baseUrl, 'accounting', 'accounting123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('CRM_VIEW can list contacts but cannot create', async () => {
    assert.equal((await api(baseUrl, viewToken, '/api/contacts')).status, 200);
    assert.equal((await api(baseUrl, viewToken, '/api/contacts', { method: 'POST', body: contactBody() })).status, 403);
  });

  test('unrelated role cannot list or mutate CRM resources', async () => {
    for (const token of [reviewerToken, warehouseToken, accountingToken]) {
      assert.equal((await api(baseUrl, token, '/api/contacts')).status, 403);
      assert.equal((await api(baseUrl, token, '/api/customer-followups')).status, 403);
      assert.equal((await api(baseUrl, token, '/api/sales-activities')).status, 403);
    }
  });

  test('contacts create and PATCH persist customer and supplier relationships', async () => {
    const created = await api(baseUrl, salesToken, '/api/contacts', { method: 'POST', body: contactBody() });
    assert.equal(created.status, 200, created.body.error);
    assert.equal(db.prepare('SELECT customer_id FROM contacts WHERE id=?').get(created.body.id).customer_id, 'customer-001');

    const patched = await api(baseUrl, salesToken, `/api/contacts/${created.body.id}`, {
      method: 'PATCH',
      body: contactBody({ customer_id: 'customer-002', supplier_id: '', name: '客户 B 联系人' }),
    });
    assert.equal(patched.status, 200, patched.body.error);
    assert.equal(db.prepare('SELECT customer_id,supplier_id FROM contacts WHERE id=?').get(created.body.id).customer_id, 'customer-002');

    const supplierPatch = await api(baseUrl, salesToken, `/api/contacts/${created.body.id}`, {
      method: 'PATCH',
      body: contactBody({ customer_id: '', supplier_id: 'supplier-001', name: '供应商联系人' }),
    });
    assert.equal(supplierPatch.status, 200, supplierPatch.body.error);
    const row = db.prepare('SELECT customer_id,supplier_id FROM contacts WHERE id=?').get(created.body.id);
    assert.equal(row.customer_id, null);
    assert.equal(row.supplier_id, 'supplier-001');
  });

  test('customer follow-up create persists current actor and PATCH updates same row', async () => {
    const created = await api(baseUrl, salesToken, '/api/customer-followups', { method: 'POST', body: followupBody({ handler_id: 'user-admin' }) });
    assert.equal(created.status, 200, created.body.error);
    const originalCount = db.prepare('SELECT count(*) count FROM customer_followups').get().count;
    let row = db.prepare('SELECT handler_id,creator_id,content FROM customer_followups WHERE id=?').get(created.body.id);
    assert.equal(row.handler_id, 'user-sales');
    assert.equal(row.creator_id, 'user-sales');
    assert.equal(row.content, '首次拜访');

    const patched = await api(baseUrl, salesToken, `/api/customer-followups/${created.body.id}`, {
      method: 'PATCH',
      body: followupBody({ customer_id: 'customer-002', content: '更新后的拜访记录', next_date: '2026-09-10' }),
    });
    assert.equal(patched.status, 200, patched.body.error);
    assert.equal(db.prepare('SELECT count(*) count FROM customer_followups').get().count, originalCount);
    row = db.prepare('SELECT customer_id,content,next_date,handler_id FROM customer_followups WHERE id=?').get(created.body.id);
    assert.equal(row.customer_id, 'customer-002');
    assert.equal(row.content, '更新后的拜访记录');
    assert.equal(row.next_date, '2026-09-10');
    assert.equal(row.handler_id, 'user-sales');
  });

  test('follow-up invalid and unauthorized writes return controlled statuses', async () => {
    assert.equal((await api(baseUrl, salesToken, '/api/customer-followups', { method: 'POST', body: followupBody({ content: '' }) })).status, 400);
    assert.equal((await api(baseUrl, viewToken, '/api/customer-followups', { method: 'POST', body: followupBody() })).status, 403);
  });

  test('sales activity create and edit persist exact actual cost cents', async () => {
    const created = await api(baseUrl, salesToken, '/api/sales-activities', { method: 'POST', body: activityBody({ actual_cost_cents: 7000 }) });
    assert.equal(created.status, 200, created.body.error);
    assert.equal(db.prepare('SELECT actual_cost_cents FROM sales_activities WHERE id=?').get(created.body.id).actual_cost_cents, 7000);

    const patched = await api(baseUrl, salesToken, `/api/sales-activities/${created.body.id}`, {
      method: 'PATCH',
      body: activityBody({ title: '完成的活动', status: 'COMPLETED', actual_cost_cents: 12345 }),
    });
    assert.equal(patched.status, 200, patched.body.error);
    const row = db.prepare('SELECT status,actual_cost_cents FROM sales_activities WHERE id=?').get(created.body.id);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.actual_cost_cents, 12345);
  });

  test('sales activity invalid status and invalid cost are rejected', async () => {
    assert.equal((await api(baseUrl, salesToken, '/api/sales-activities', { method: 'POST', body: activityBody({ status: 'DONE' }) })).status, 400);
    assert.equal((await api(baseUrl, salesToken, '/api/sales-activities', { method: 'POST', body: activityBody({ actual_cost_cents: 70.5 }) })).status, 400);
    const missing = activityBody();
    delete missing.actual_cost_cents;
    assert.equal((await api(baseUrl, salesToken, '/api/sales-activities', { method: 'POST', body: missing })).status, 400);
  });

  test('sales activity mutations require CRM_MANAGE', async () => {
    assert.equal((await api(baseUrl, viewToken, '/api/sales-activities', { method: 'POST', body: activityBody() })).status, 403);
    const created = await api(baseUrl, adminToken, '/api/sales-activities', { method: 'POST', body: activityBody({ title: '删除检查' }) });
    assert.equal(created.status, 200, created.body.error);
    assert.equal((await api(baseUrl, viewToken, `/api/sales-activities/${created.body.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await api(baseUrl, adminToken, `/api/sales-activities/${created.body.id}`, { method: 'DELETE' })).status, 200);
  });

  test('CRM lookup endpoints are minimal and full master data APIs are not weakened', async () => {
    const customers = await api(baseUrl, salesToken, '/api/lookup/customers');
    const suppliers = await api(baseUrl, salesToken, '/api/lookup/suppliers');
    assert.equal(customers.status, 200, customers.body.error);
    assert.equal(suppliers.status, 200, suppliers.body.error);
    assert.deepEqual(Object.keys(customers.body.customers[0]).sort(), ['code', 'id', 'name']);
    assert.deepEqual(Object.keys(suppliers.body.suppliers[0]).sort(), ['code', 'id', 'name']);
    assert.equal((await api(baseUrl, reviewerToken, '/api/lookup/customers')).status, 403);
    assert.equal((await api(baseUrl, reviewerToken, '/api/lookup/suppliers')).status, 403);
    assert.equal((await api(baseUrl, warehouseToken, '/api/suppliers')).status, 403);
    assert.equal((await api(baseUrl, accountingToken, '/api/customers')).status, 403);
  });
});

describe('CRM frontend modal stability and gates', () => {
  let vite;
  let ui;
  const crmSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'crm.jsx'), 'utf8');
  const businessSource = readFileSync(resolve(repoRoot, 'server', 'modules', 'business.js'), 'utf8');

  before(async () => {
    vite = await createViteServer({ root: repoRoot, server: { middlewareMode: true }, appType: 'custom' });
    ui = await vite.ssrLoadModule('/src/pages/crm.jsx');
  });

  after(async () => {
    await vite.close();
  });

  test('contact modal renders and uses narrow lookups with controlled notify', () => {
    const html = renderToStaticMarkup(createElement(ui.ContactModal, { value: {}, notify() {}, onClose() {}, onSaved() {} }));
    assert.match(html, /新增联系人/);
    assert.match(html, /客户/);
    assert.match(crmSource, /api\('\/api\/lookup\/customers'\).*catch\(\(e\) => notify\(e\.message, 'error'\)\)/s);
    assert.match(crmSource, /api\('\/api\/lookup\/suppliers'\).*catch\(\(e\) => notify\(e\.message, 'error'\)\)/s);
    assert.doesNotMatch(crmSource, /api\('\/api\/customers'\)/);
    assert.doesNotMatch(crmSource, /api\('\/api\/suppliers'\)/);
  });

  test('follow-up modal renders without user ReferenceError and supports edit PATCH', () => {
    const html = renderToStaticMarkup(createElement(ui.FollowupModal, {
      customers: [{ id: 'customer-001', code: 'C001', name: '客户' }],
      user: { id: 'user-sales' },
      notify() {},
      value: {},
      onClose() {},
      onSaved() {},
    }));
    assert.match(html, /新增跟进记录/);
    assert.match(crmSource, /api\(`\/api\/customer-followups\/\$\{value\.id\}`,\s*\{ method: 'PATCH', body: form \}\)/);
    assert.doesNotMatch(crmSource, /function FollowupModal\(\{ customers, value, onClose, onSaved \}\)/);
  });

  test('sales activity modal renders canonical statuses and actual cost field', () => {
    const html = renderToStaticMarkup(createElement(ui.ActivityModal, { value: {}, notify() {}, onClose() {}, onSaved() {} }));
    for (const label of ['计划中', '进行中', '已完成', '已取消']) assert.match(html, new RegExp(label));
    assert.match(html, /实际费用\(元\)/);
  });

  test('failed save is controlled and does not call onSaved', async () => {
    const notices = [];
    let saved = false;
    const result = await ui.runCrmSave(() => Promise.reject(new Error('保存失败')), () => { saved = true; }, (...args) => notices.push(args));
    assert.equal(result, false);
    assert.equal(saved, false);
    assert.deepEqual(notices, [['保存失败', 'error']]);
  });

  test('sales activity mutation buttons use CRM_MANAGE', () => {
    assert.match(crmSource, /can\(user, 'CRM_MANAGE'\) && <button className="row-action" onClick=\{\(\) => setEditing\(item\)\}>编辑<\/button>/);
    assert.match(crmSource, /can\(user, 'CRM_MANAGE'\) && <ConfirmAction className="row-action danger"/);
  });

  test('CRM authorization no longer falls back to master-data permissions', () => {
    assert.match(businessSource, /export async function listContacts[\s\S]*allowAny\(actor, \['CRM_VIEW', 'CRM_MANAGE'\]\)/);
    assert.doesNotMatch(businessSource, /listContacts[\s\S]{0,250}CUSTOMERS_VIEW/);
  });
});
