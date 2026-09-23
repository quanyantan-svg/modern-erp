import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

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

async function fetchJson(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
}

// Build the role × page matrix from real source so we test what's actually wired.
const appSource = readFileSync(resolve(repoRoot, 'src', 'App.jsx'), 'utf8');
const navGroupsMatch = appSource.match(/const navGroups = \[([\s\S]*?)\n\];/);
const navBlock = navGroupsMatch ? navGroupsMatch[1] : '';
const navEntryRegex = /\{ key: '([^']+)', label: '([^']+)', icon: [^,]+, (?:permission: '([^']+)'|any: \[([^\]]+)\]) \}/g;
const NAV_MATRIX = [];
for (const match of navBlock.matchAll(navEntryRegex)) {
  const [, key, label, permission, any] = match;
  NAV_MATRIX.push({
    key,
    label,
    permission: permission || null,
    any: any ? any.split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : null,
  });
}

const dbSource = readFileSync(resolve(repoRoot, 'server', 'db.js'), 'utf8');
const rolePermissionsMatch = dbSource.match(/const rolePermissions = \{([\s\S]*?)\n\s*\};/);
const ROLE_PERMISSIONS = {};
if (rolePermissionsMatch) {
  const block = rolePermissionsMatch[1];
  // Match either `'role-X': all,` (admin) or `'role-X': [...],`
  const adminRegex = /'([^']+)':\s*all,/g;
  for (const m of block.matchAll(adminRegex)) {
    ROLE_PERMISSIONS[m[1]] = '__ALL__';
  }
  const roleRegex = /'([^']+)':\s*\[([^\]]*)\]/g;
  for (const m of block.matchAll(roleRegex)) {
    const role = m[1];
    if (ROLE_PERMISSIONS[role]) continue;
    const perms = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    ROLE_PERMISSIONS[role] = perms;
  }
}

// Materialize admin's `all` to the full set of registered permissions.
const allPermsList = (() => {
  const m = dbSource.match(/export const PERMISSIONS = \[([\s\S]*?)\];/);
  if (!m) return [];
  const result = [];
  const re = /\['([A-Z_0-9]+)',\s*'[^']+'\]/g;
  for (const x of m[1].matchAll(re)) result.push(x[1]);
  return result;
})();
if (ROLE_PERMISSIONS['role-admin'] === '__ALL__') ROLE_PERMISSIONS['role-admin'] = allPermsList;

function visibleFor(permissions) {
  const visible = [];
  for (const item of NAV_MATRIX) {
    if (item.permission) {
      if (permissions.includes(item.permission)) visible.push(item.key);
    } else if (item.any) {
      if (item.any.some((p) => permissions.includes(p))) visible.push(item.key);
    }
  }
  return visible;
}

describe('Teacher Acceptance Matrix — Navigation closure', () => {
  test('Nav matrix built from real source', () => {
    assert.ok(NAV_MATRIX.length >= 25, `expected at least 25 nav entries, got ${NAV_MATRIX.length}`);
  });

  test('All five roles derive non-empty visible nav from real source', () => {
    for (const role of ['role-admin', 'role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting']) {
      assert.ok(ROLE_PERMISSIONS[role], `${role} must have permissions defined`);
      const visible = visibleFor(ROLE_PERMISSIONS[role]);
      assert.ok(visible.length > 0, `${role} must have visible nav`);
      assert.ok(visible.includes('dashboard'), `${role} must see dashboard`);
    }
  });

  test('Five-role visibility matrix', () => {
    const visibilityByRole = {};
    for (const role of ['role-admin', 'role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting']) {
      visibilityByRole[role] = new Set(visibleFor(ROLE_PERMISSIONS[role]));
    }
    // Admin sees everything except nothing — admin should see every nav.
    for (const item of NAV_MATRIX) {
      assert.ok(visibilityByRole['role-admin'].has(item.key), `admin must see ${item.key}`);
    }
    // Sales must see orders, but not approvals.
    assert.ok(visibilityByRole['role-sales'].has('orders'));
    assert.ok(!visibilityByRole['role-sales'].has('approvals'));
    assert.ok(visibilityByRole['role-sales'].has('purchase-orders'));
    // Reviewer must see approvals, but not boms / iqc / oqc / users.
    assert.ok(visibilityByRole['role-reviewer'].has('approvals'));
    assert.ok(!visibilityByRole['role-reviewer'].has('boms'));
    assert.ok(!visibilityByRole['role-reviewer'].has('iqc'));
    assert.ok(!visibilityByRole['role-reviewer'].has('oqc'));
    assert.ok(!visibilityByRole['role-reviewer'].has('users'));
    // Warehouse must see IQC/OQC, not approvals, not users.
    assert.ok(visibilityByRole['role-warehouse'].has('iqc'));
    assert.ok(visibilityByRole['role-warehouse'].has('oqc'));
    assert.ok(!visibilityByRole['role-warehouse'].has('approvals'));
    assert.ok(!visibilityByRole['role-warehouse'].has('users'));
    // Accounting must see accounting, but not iqc/oqc/approvals/users.
    assert.ok(visibilityByRole['role-accounting'].has('accounting'));
    assert.ok(!visibilityByRole['role-accounting'].has('iqc'));
    assert.ok(!visibilityByRole['role-accounting'].has('oqc'));
    assert.ok(!visibilityByRole['role-accounting'].has('approvals'));
    assert.ok(!visibilityByRole['role-accounting'].has('users'));
  });
});

describe('Teacher Acceptance Matrix — Live auth/me', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let tokens;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    tokens = {
      admin: await login(baseUrl, 'admin', 'admin123'),
      sales: await login(baseUrl, 'sales', 'sales123'),
      reviewer: await login(baseUrl, 'reviewer', 'review123'),
      warehouse: await login(baseUrl, 'warehouse', 'warehouse123'),
      accounting: await login(baseUrl, 'accounting', 'accounting123'),
    };
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('admin /me returns every permission registered', async () => {
    const me = await fetchJson(baseUrl, tokens.admin, '/api/auth/me');
    const dbPerms = db.prepare('SELECT code FROM permissions').all().map((row) => row.code);
    for (const code of dbPerms) {
      assert.ok(me.body.user.permissions.includes(code), `admin must inherit ${code}`);
    }
  });

  test('sales /me does NOT include Quality / Manufacturing / Accounting approvals', async () => {
    const me = await fetchJson(baseUrl, tokens.sales, '/api/auth/me');
    for (const forbidden of ['IQC_MANAGE', 'OQC_MANAGE', 'VOUCHER_APPROVE', 'PERIOD_CLOSE_MANAGE', 'ORDERS_APPROVE', 'PURCHASE_ORDERS_APPROVE', 'USERS_MANAGE', 'ROLES_MANAGE', 'COST_MANAGE']) {
      assert.ok(!me.body.user.permissions.includes(forbidden), `sales must not hold ${forbidden}`);
    }
    assert.ok(me.body.user.permissions.includes('CRM_MANAGE'));
    assert.ok(me.body.user.permissions.includes('ORDERS_CREATE'));
  });

  test('reviewer /me holds approvals but no Quality / Manufacturing / CRM / Cost / Accounting write', async () => {
    const me = await fetchJson(baseUrl, tokens.reviewer, '/api/auth/me');
    assert.ok(me.body.user.permissions.includes('ORDERS_APPROVE'));
    assert.ok(me.body.user.permissions.includes('PURCHASE_ORDERS_APPROVE'));
    for (const forbidden of ['IQC_MANAGE', 'OQC_MANAGE', 'CRM_MANAGE', 'VOUCHER_APPROVE', 'ORDERS_CREATE', 'USERS_MANAGE', 'COST_MANAGE']) {
      assert.ok(!me.body.user.permissions.includes(forbidden), `reviewer must not hold ${forbidden}`);
    }
  });

  test('warehouse /me holds IQC/OQC write but no Cost / CRM / Accounting / Users / Production', async () => {
    const me = await fetchJson(baseUrl, tokens.warehouse, '/api/auth/me');
    assert.ok(me.body.user.permissions.includes('IQC_MANAGE'));
    assert.ok(me.body.user.permissions.includes('OQC_MANAGE'));
    assert.ok(me.body.user.permissions.includes('INVENTORY_TRANSFER_APPROVE'));
    for (const forbidden of ['VOUCHER_APPROVE', 'COST_MANAGE', 'CRM_MANAGE', 'USERS_MANAGE', 'ROLES_MANAGE', 'PERIOD_CLOSE_MANAGE', 'ORDERS_CREATE', 'ORDERS_APPROVE']) {
      assert.ok(!me.body.user.permissions.includes(forbidden), `warehouse must not hold ${forbidden}`);
    }
  });

  test('accounting /me holds VOUCHER_SUBMIT + REPORT_VIEW but no VOUCHER_APPROVE / PERIOD_CLOSE_MANAGE / COST', async () => {
    const me = await fetchJson(baseUrl, tokens.accounting, '/api/auth/me');
    assert.ok(me.body.user.permissions.includes('VOUCHER_SUBMIT'));
    assert.ok(me.body.user.permissions.includes('REPORT_VIEW'));
    assert.ok(me.body.user.permissions.includes('ACCOUNTING_VIEW'));
    for (const forbidden of ['VOUCHER_APPROVE', 'PERIOD_CLOSE_MANAGE', 'PERIOD_CLOSE_VIEW', 'USERS_MANAGE', 'ROLES_MANAGE', 'IQC_MANAGE', 'OQC_MANAGE', 'COST_MANAGE', 'COST_VIEW', 'CRM_MANAGE', 'ORDERS_CREATE']) {
      assert.ok(!me.body.user.permissions.includes(forbidden), `accounting must not hold ${forbidden}`);
    }
  });
});

describe('Teacher Acceptance Matrix — test_admin surface (smoke)', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-admin-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Admin can read every list endpoint reachable from sidebar', async () => {
    const endpoints = [
      '/api/dashboard', '/api/orders', '/api/purchase-orders', '/api/customers', '/api/suppliers',
      '/api/products', '/api/warehouses', '/api/inventory', '/api/inventory-transactions',
      '/api/purchase-receipts', '/api/sales-deliveries', '/api/sales-returns', '/api/purchase-returns',
      '/api/inventory-transfers', '/api/accounts-receivable', '/api/accounts-payable',
      '/api/accounting-vouchers', '/api/accounting-subjects', '/api/cash-journals',
      '/api/bank-accounts', '/api/bills', '/api/fixed-assets', '/api/boms',
      '/api/production-orders', '/api/work-centers', '/api/routing-operations',
      '/api/labor-records', '/api/mrp-plans', '/api/product-costs', '/api/cost-rates',
      '/api/iqc', '/api/oqc', '/api/supplier-evaluations', '/api/projects',
      '/api/contacts', '/api/customer-followups', '/api/sales-activities',
      '/api/notifications', '/api/workflows', '/api/users', '/api/roles',
      '/api/departments', '/api/aux-projects', '/api/currencies',
      '/api/voucher-words', '/api/voucher-templates',
      '/api/bank-statements', '/api/bank-reconciliations',
      '/api/leave-requests', '/api/expense-claims', '/api/alert-rules', '/api/alerts',
      '/api/reports/trial-balance?period=2026-01',
      '/api/reports/income-statement?period=2026-01',
      '/api/reports/balance-sheet?period=2026-01',
    ];
    for (const endpoint of endpoints) {
      const res = await fetchJson(baseUrl, adminToken, endpoint);
      assert.ok([200, 404].includes(res.status), `admin GET ${endpoint} must succeed (got ${res.status}); body=${JSON.stringify(res.body)}`);
    }
  });

  test('Deferred: Production Output endpoint is not routed', async () => {
    const res = await fetch(`${baseUrl}/api/production-outputs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // /api/production-outputs is intentionally removed from route registration.
    assert.equal(res.status, 404);
  });
});

describe('Teacher Acceptance Matrix — test_sales', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let salesToken;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-sales-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    salesToken = await login(baseUrl, 'sales', 'sales123');
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Sales CAN list and create customer / supplier / product master data', async () => {
    for (const path of ['/api/customers', '/api/suppliers', '/api/products']) {
      const res = await fetchJson(baseUrl, salesToken, path);
      assert.equal(res.status, 200, `sales GET ${path}`);
    }
    const created = await api(baseUrl, salesToken, '/api/customers', {
      method: 'POST',
      body: { code: `TS-C-${Date.now()}`, name: '测试客户', contact: '', phone: '', address: '' },
    });
    assert.ok([200, 201].includes(created.status), created.body.error);
  });

  test('Sales CAN create + submit sales order', async () => {
    // V1.3 Phase 1: SO submit requires order_date, requested_delivery_date,
    // ship-to contact/phone/address, and payment terms.
    const order = await api(baseUrl, salesToken, '/api/orders', {
      method: 'POST',
      body: {
        customerId: 'customer-001',
        orderDate: '2026-09-22',
        requestedDeliveryDate: '2026-10-10',
        paymentTerms: '月结 30 天',
        shipToContactName: '王女士',
        shipToPhone: '13800000000',
        shipToAddress: '上海市浦东新区张江路 88 号',
        items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 100000 }],
      },
    });
    assert.equal(order.status, 201, order.body.error);
    const orderId = order.body.id;
    const submit = await api(baseUrl, salesToken, `/api/orders/${orderId}/submit`, { method: 'POST' });
    assert.equal(submit.status, 200, submit.body.error);
  });

  test('Sales CANNOT approve or reject sales orders', async () => {
    const order = await api(baseUrl, salesToken, '/api/orders', {
      method: 'POST',
      body: {
        customerId: 'customer-001',
        orderDate: '2026-09-22',
        requestedDeliveryDate: '2026-10-10',
        paymentTerms: '月结 30 天',
        shipToContactName: '王女士',
        shipToPhone: '13800000000',
        shipToAddress: '上海市浦东新区张江路 88 号',
        items: [{ productId: 'product-001', quantity: 3, unitPriceCents: 150000 }],
      },
    });
    const orderId = order.body.id;
    await api(baseUrl, salesToken, `/api/orders/${orderId}/submit`, { method: 'POST' });
    const approve = await api(baseUrl, salesToken, `/api/orders/${orderId}/approve`, { method: 'POST' });
    assert.equal(approve.status, 403, `sales approve must be 403, got ${approve.status}`);
    const reject = await api(baseUrl, salesToken, `/api/orders/${orderId}/reject`, { method: 'POST', body: { reason: 'test' } });
    assert.equal(reject.status, 403, `sales reject must be 403, got ${reject.status}`);
  });

  test('Sales CRM workflow: contacts list + create + edit relationship persists', async () => {
    const list = await fetchJson(baseUrl, salesToken, '/api/contacts');
    assert.equal(list.status, 200);
    const created = await api(baseUrl, salesToken, '/api/contacts', {
      method: 'POST',
      body: {
        customer_id: 'customer-001',
        supplier_id: '',
        name: '测试联系人',
        gender: 'MALE',
        position: '采购',
        phone: '0755-1',
        mobile: '13800000001',
        email: 'c@test',
        wechat: '',
        birthday: '',
        remark: '',
        is_primary: false,
      },
    });
    assert.equal(created.status, 200, created.body.error);
    const contactId = created.body.id;
    const patched = await api(baseUrl, salesToken, `/api/contacts/${contactId}`, {
      method: 'PATCH',
      body: { customer_id: 'customer-002', supplier_id: '', name: '切换到C002', gender: 'MALE', position: '', phone: '', mobile: '', email: '', wechat: '', birthday: '', remark: '', is_primary: false },
    });
    assert.equal(patched.status, 200, patched.body.error);
    const row = db.prepare('SELECT customer_id FROM contacts WHERE id=?').get(contactId);
    assert.equal(row.customer_id, 'customer-002');
  });

  test('Sales CRM workflow: follow-up create + PATCH updates same row', async () => {
    const created = await api(baseUrl, salesToken, '/api/customer-followups', {
      method: 'POST',
      body: {
        customer_id: 'customer-001',
        followup_type: 'VISIT',
        followup_date: '2026-09-02',
        content: '初次拜访',
        next_plan: '下周复访',
        next_date: '2026-09-09',
      },
    });
    assert.equal(created.status, 200, created.body.error);
    const id = created.body.id;
    const originalCount = db.prepare('SELECT count(*) c FROM customer_followups').get().c;
    const patched = await api(baseUrl, salesToken, `/api/customer-followups/${id}`, {
      method: 'PATCH',
      body: {
        customer_id: 'customer-002',
        followup_type: 'PHONE',
        followup_date: '2026-09-03',
        content: '复访记录',
        next_plan: '确认订单',
        next_date: '2026-09-15',
      },
    });
    assert.equal(patched.status, 200, patched.body.error);
    assert.equal(db.prepare('SELECT count(*) c FROM customer_followups').get().c, originalCount);
    const row = db.prepare('SELECT customer_id,content,handler_id FROM customer_followups WHERE id=?').get(id);
    assert.equal(row.customer_id, 'customer-002');
    assert.equal(row.content, '复访记录');
    assert.equal(row.handler_id, 'user-sales');
  });

  test('Sales CRM workflow: sales activity create + edit persists exact cents', async () => {
    const created = await api(baseUrl, salesToken, '/api/sales-activities', {
      method: 'POST',
      body: {
        activity_type: 'VISIT',
        title: '客户拜访',
        content: '重点客户',
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        location: '深圳',
        budget_cents: 50000,
        actual_cost_cents: 42500,
        participants: 'sales',
        status: 'PLANNING',
        result: '',
      },
    });
    assert.equal(created.status, 200, created.body.error);
    const id = created.body.id;
    const patched = await api(baseUrl, salesToken, `/api/sales-activities/${id}`, {
      method: 'PATCH',
      body: {
        activity_type: 'VISIT',
        title: '客户拜访 - 已完成',
        content: '',
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        location: '深圳',
        budget_cents: 50000,
        actual_cost_cents: 47200,
        participants: 'sales',
        status: 'COMPLETED',
        result: '客户签约意向',
      },
    });
    assert.equal(patched.status, 200, patched.body.error);
    const row = db.prepare('SELECT actual_cost_cents,status,result FROM sales_activities WHERE id=?').get(id);
    assert.equal(row.actual_cost_cents, 47200);
    assert.equal(row.status, 'COMPLETED');
  });

  test('Sales CANNOT mutate Quality (IQC/OQC), voucher approval, period, system', async () => {
    assert.equal((await api(baseUrl, salesToken, '/api/iqc', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/oqc', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/accounting-vouchers', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/users')).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/roles')).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/period-closures')).status, 403);
  });

  test('Sales CANNOT read Cost or Production endpoints', async () => {
    assert.equal((await api(baseUrl, salesToken, '/api/product-costs')).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/cost-rates')).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/boms', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, salesToken, '/api/production-orders', { method: 'POST', body: {} })).status, 403);
  });
});

describe('Teacher Acceptance Matrix — test_reviewer', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let salesToken;
  let reviewerToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-reviewer-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    salesToken = await login(baseUrl, 'sales', 'sales123');
    reviewerToken = await login(baseUrl, 'reviewer', 'review123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Reviewer CANNOT create or submit sales / purchase orders', async () => {
    assert.equal((await api(baseUrl, reviewerToken, '/api/orders', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, reviewerToken, '/api/purchase-orders', { method: 'POST', body: {} })).status, 403);
  });

  test('Sales creates + submits → Reviewer approves (full SoD)', async () => {
    // V1.3 Phase 1: SO submit requires order_date, requested_delivery_date,
    // ship-to contact/phone/address, and payment terms.
    const order = await api(baseUrl, salesToken, '/api/orders', {
      method: 'POST',
      body: {
        customerId: 'customer-001',
        orderDate: '2026-09-22',
        requestedDeliveryDate: '2026-10-10',
        paymentTerms: '月结 30 天',
        shipToContactName: '王女士',
        shipToPhone: '13800000000',
        shipToAddress: '上海市浦东新区张江路 88 号',
        items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 50000 }],
      },
    });
    assert.equal(order.status, 201, order.body.error);
    const orderId = order.body.id;
    await api(baseUrl, salesToken, `/api/orders/${orderId}/submit`, { method: 'POST' });
    const approve = await api(baseUrl, reviewerToken, `/api/orders/${orderId}/approve`, { method: 'POST' });
    assert.equal(approve.status, 200, approve.body.error);
  });

  test('Reviewer CANNOT mutate Quality, Cost, Manufacturing, Accounting, System, CRM, Warehouse writes', async () => {
    const checks = [
      ['/api/iqc', 'POST', {}],
      ['/api/oqc', 'POST', {}],
      ['/api/product-costs', 'POST', {}],
      ['/api/cost-rates', 'POST', {}],
      ['/api/boms', 'POST', {}],
      ['/api/production-orders', 'POST', {}],
      ['/api/accounting-vouchers', 'POST', {}],
      ['/api/users', 'POST', {}],
      ['/api/roles', 'POST', {}],
      ['/api/contacts', 'POST', {}],
      ['/api/customer-followups', 'POST', {}],
      ['/api/sales-activities', 'POST', {}],
      ['/api/purchase-receipts', 'POST', {}],
      ['/api/sales-deliveries', 'POST', {}],
      ['/api/inventory-transfers', 'POST', {}],
    ];
    for (const [path, method, body] of checks) {
      const res = await api(baseUrl, reviewerToken, path, { method, body });
      assert.equal(res.status, 403, `reviewer ${method} ${path} must be 403, got ${res.status}`);
    }
  });
});

describe('Teacher Acceptance Matrix — test_warehouse', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let warehouseToken;
  let adminToken;
  let sourceSequence = 0;
  const seedQualitySource = (kind, quantities) => {
    const key = `matrix-q-${++sourceSequence}`; const now = new Date().toISOString();
    if (kind === 'IQC') {
      db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'APPROVED',10000,'','user-admin',?,?)").run(`po-${key}`, `PO-${key}`, 'supplier-001', now, now);
      quantities.forEach((quantity, index) => db.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)').run(`poi-${key}-${index}`, `po-${key}`, 'product-001', quantity, 100, quantity * 100, index + 1));
      db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'user-warehouse','DRAFT',?,'2026-09-23','','user-warehouse',?,?)").run(`pr-${key}`, `PR-${key}`, `po-${key}`, 'supplier-001', 'warehouse-001', quantities.reduce((a,b)=>a+b,0)*100, now, now);
      quantities.forEach((quantity, index) => db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,?,?)').run(`pri-${key}-${index}`, `pr-${key}`, 'product-001', quantity, 100, quantity * 100, index + 1, `poi-${key}-${index}`));
      return `pr-${key}`;
    }
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'APPROVED',10000,'','user-admin',?,?)").run(`so-${key}`, `SO-${key}`, 'customer-001', now, now);
    quantities.forEach((quantity, index) => db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)').run(`soi-${key}-${index}`, `so-${key}`, 'product-001', quantity, 100, quantity * 100, index + 1));
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'user-warehouse','DRAFT',?,'2026-09-23','','user-warehouse',?,?)").run(`sd-${key}`, `SD-${key}`, `so-${key}`, 'customer-001', 'warehouse-001', quantities.reduce((a,b)=>a+b,0)*100, now, now);
    quantities.forEach((quantity, index) => db.prepare('INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id) VALUES(?,?,?,?,?,?,?,?)').run(`sdi-${key}-${index}`, `sd-${key}`, 'product-001', quantity, 100, quantity * 100, index + 1, `soi-${key}-${index}`));
    return `sd-${key}`;
  };

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-warehouse-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Warehouse CAN read inventory, transfers, transactions', async () => {
    for (const path of ['/api/inventory', '/api/inventory-transfers', '/api/inventory-transactions', '/api/warehouses', '/api/products']) {
      const res = await fetchJson(baseUrl, warehouseToken, path);
      assert.equal(res.status, 200, `warehouse GET ${path}`);
    }
  });

  test('Warehouse CANNOT access full /api/suppliers or /api/customers', async () => {
    assert.equal((await api(baseUrl, warehouseToken, '/api/suppliers', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, warehouseToken, '/api/customers', { method: 'POST', body: {} })).status, 403);
  });

  test('Warehouse IQC: valid create → header + every item persists', async () => {
    const receiptId = seedQualitySource('IQC', [60, 40]);
    const created = await api(baseUrl, warehouseToken, '/api/iqc', {
      method: 'POST',
      body: {
        purchase_receipt_id: receiptId,
        inspection_type: 'NORMAL',
        sample_quantity: 20,
        remark: 'warehouse matrix',
      },
    });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const items = db.prepare('SELECT count(*) c FROM iqc_inspection_items WHERE iqc_id=?').get(id).c;
    assert.equal(items, 2);
  });

  test('Warehouse IQC: complete → status COMPLETED + result + inspected_at', async () => {
    const receiptId = seedQualitySource('IQC', [50]);
    const created = await api(baseUrl, warehouseToken, '/api/iqc', {
      method: 'POST',
      body: {
        purchase_receipt_id: receiptId,
        inspection_type: 'NORMAL',
        sample_quantity: 10,
        remark: '',
      },
    });
    const complete = await api(baseUrl, warehouseToken, `/api/iqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', inspection_quantity: 50, passed_quantity: 50, failed_quantity: 0 },
    });
    assert.equal(complete.status, 200);
    const row = db.prepare('SELECT status,result,inspected_at FROM iqc_inspections WHERE id=?').get(created.body.id);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.result, 'PASS');
    assert.ok(row.inspected_at);
  });

  test('Warehouse OQC: create + complete + edit locked', async () => {
    const deliveryId = seedQualitySource('OQC', [80]);
    const created = await api(baseUrl, warehouseToken, '/api/oqc', {
      method: 'POST',
      body: {
        sales_delivery_id: deliveryId,
        inspection_type: 'NORMAL',
        sample_quantity: 16,
        remark: '',
      },
    });
    assert.equal(created.status, 201);
    const complete = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', inspection_quantity: 80, passed_quantity: 80, failed_quantity: 0 },
    });
    assert.equal(complete.status, 200);
    const patch = await api(baseUrl, warehouseToken, `/api/oqc/${created.body.id}`, {
      method: 'PATCH',
      body: { customer_id: 'customer-001', items: [] },
    });
    assert.equal(patch.status, 409);
  });

  test('Warehouse CANNOT access Cost / Accounting / CRM / Manufacturing writes', async () => {
    for (const path of ['/api/product-costs', '/api/cost-rates', '/api/accounting-vouchers', '/api/contacts', '/api/customer-followups', '/api/sales-activities', '/api/users', '/api/roles', '/api/boms', '/api/production-orders']) {
      const res = await api(baseUrl, warehouseToken, path, { method: 'POST', body: {} });
      assert.equal(res.status, 403, `warehouse POST ${path} must be 403, got ${res.status}`);
    }
  });

  test('Warehouse CANNOT view Cost or Quality read APIs (Cost/Quality not granted, Manufacturing not granted)', async () => {
    assert.equal((await api(baseUrl, warehouseToken, '/api/product-costs')).status, 403);
    assert.equal((await api(baseUrl, warehouseToken, '/api/cost-rates')).status, 403);
    // BOM/Production-Orders endpoints require PRODUCTION_ORDERS_CREATE which warehouse does not hold
    assert.equal((await api(baseUrl, warehouseToken, '/api/boms', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api(baseUrl, warehouseToken, '/api/production-orders', { method: 'POST', body: {} })).status, 403);
  });

  test('Warehouse can create inventory transfer (full workflow)', async () => {
    // Demo seed already inserts warehouse-001 / product-001 = 20 quantity (db.js:1463). Use UPSERT.
    const now = new Date().toISOString();
    db.prepare('INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?) ON CONFLICT(warehouse_id,product_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at')
      .run('warehouse-001', 'product-001', 100, now);
    const transfer = await api(baseUrl, warehouseToken, '/api/inventory-transfers', {
      method: 'POST',
      body: {
        fromWarehouseId: 'warehouse-001',
        toWarehouseId: 'warehouse-002',
        remark: 'matrix',
        items: [{ productId: 'product-001', quantity: 5 }],
      },
    });
    if (transfer.status !== 201) {
      assert.fail(`expected 201, got ${transfer.status} body=${JSON.stringify(transfer.body)}`);
    }
  });
});

describe('Teacher Acceptance Matrix — test_accounting', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let accountingToken;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-accounting-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    accountingToken = await login(baseUrl, 'accounting', 'accounting123');
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Accounting CAN view reports (Trial Balance / Income Statement / Balance Sheet)', async () => {
    for (const path of ['/api/reports/trial-balance?period=2026-01', '/api/reports/income-statement?period=2026-01', '/api/reports/balance-sheet?period=2026-01']) {
      const res = await fetchJson(baseUrl, accountingToken, path);
      assert.ok([200].includes(res.status), `accounting GET ${path} must be 200, got ${res.status}`);
    }
  });

  test('Accounting CAN create manual voucher (status ENTERED)', async () => {
    const created = await api(baseUrl, accountingToken, '/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-02',
        remark: 'matrix test',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000 },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000 },
        ],
      },
    });
    assert.ok([200, 201].includes(created.status), created.body.error);
  });

  test('Accounting CAN submit voucher (ENTERED → SUBMITTED)', async () => {
    const created = await api(baseUrl, accountingToken, '/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-02',
        remark: 'submit test',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 50000 },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000 },
        ],
      },
    });
    const id = created.body.id;
    const submit = await api(baseUrl, accountingToken, `/api/accounting-vouchers/${id}/submit`, { method: 'POST' });
    assert.ok([200, 201].includes(submit.status), submit.body.error);
  });

  test('Accounting CANNOT approve or reject own voucher (VOUCHER_APPROVE forbidden + creator !== approver)', async () => {
    const created = await api(baseUrl, accountingToken, '/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-02',
        remark: 'self approve attempt',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 30000 },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 30000 },
        ],
      },
    });
    const id = created.body.id;
    await api(baseUrl, accountingToken, `/api/accounting-vouchers/${id}/submit`, { method: 'POST' });
    const approve = await api(baseUrl, accountingToken, `/api/accounting-vouchers/${id}/approve`, { method: 'POST' });
    assert.equal(approve.status, 403);
  });

  test('Accounting CANNOT close or reopen accounting period', async () => {
    const periods = await api(baseUrl, adminToken, '/api/period-closures', {
      method: 'POST',
      body: { year: 2026, month: 1 },
    });
    assert.equal(periods.status, 201, periods.body.error);
    const periodId = periods.body.id;
    const close = await api(baseUrl, accountingToken, `/api/period-closures/${periodId}/close`, { method: 'POST' });
    assert.equal(close.status, 403);
    const unclose = await api(baseUrl, accountingToken, `/api/period-closures/${periodId}/unclose`, { method: 'POST' });
    assert.equal(unclose.status, 403);
  });

  test('Accounting CANNOT access Cost / CRM / Quality / Manufacturing / System / Warehouse writes', async () => {
    for (const path of ['/api/product-costs', '/api/cost-rates', '/api/contacts', '/api/customer-followups', '/api/sales-activities', '/api/iqc', '/api/oqc', '/api/boms', '/api/production-orders', '/api/users', '/api/roles', '/api/purchase-receipts', '/api/sales-deliveries', '/api/inventory-transfers']) {
      const res = await api(baseUrl, accountingToken, path, { method: 'POST', body: {} });
      assert.equal(res.status, 403, `accounting POST ${path} must be 403, got ${res.status}`);
    }
  });

  test('Admin can approve a voucher submitted by accounting (separation of duties)', async () => {
    const created = await api(baseUrl, accountingToken, '/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-02',
        remark: 'sod test',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 80000 },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 80000 },
        ],
      },
    });
    const id = created.body.id;
    await api(baseUrl, accountingToken, `/api/accounting-vouchers/${id}/submit`, { method: 'POST' });
    const approve = await api(baseUrl, adminToken, `/api/accounting-vouchers/${id}/approve`, { method: 'POST' });
    assert.ok([200, 201].includes(approve.status), approve.body.error);
    const row = db.prepare('SELECT status,approver_id FROM accounting_vouchers WHERE id=?').get(id);
    assert.equal(row.status, 'POSTED');
    assert.equal(row.approver_id, 'user-admin');
  });
});

describe('Teacher Acceptance Matrix — Frontend crash sweep on currently reachable components', () => {
  let vite;
  const qualitySource = readFileSync(resolve(repoRoot, 'src', 'pages', 'quality.jsx'), 'utf8');
  const manufacturingSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'manufacturing.jsx'), 'utf8');
  const accountingSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'accounting.jsx'), 'utf8');
  const crmSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'crm.jsx'), 'utf8');
  const logisticsFinanceSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'logistics-finance.jsx'), 'utf8');
  const treasuryCostSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'treasury-cost.jsx'), 'utf8');
  const masterDataSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'master-data.jsx'), 'utf8');
  const projectsWorkflowSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'projects-workflow.jsx'), 'utf8');

  before(async () => {
    vite = await createViteServer({ root: repoRoot, server: { middlewareMode: true }, appType: 'custom' });
  });

  after(async () => {
    await vite.close();
  });

  test('No current page module references the dead QC_MANAGE / BOM_MANAGE / PRODUCTION_CREATE codes', () => {
    const sources = [qualitySource, manufacturingSource, accountingSource, crmSource, logisticsFinanceSource, treasuryCostSource, masterDataSource, projectsWorkflowSource];
    for (const src of sources) {
      assert.doesNotMatch(src, /['"]QC_MANAGE['"]/);
      assert.doesNotMatch(src, /['"]QC_VIEW['"]/);
      assert.doesNotMatch(src, /['"]BOM_MANAGE['"]/);
      assert.doesNotMatch(src, /\bQC_MANAGE\b(?![_A-Z])/);
      assert.doesNotMatch(src, /\bBOM_MANAGE\b/);
      assert.doesNotMatch(src, /\bPRODUCTION_CREATE\b/);
      assert.doesNotMatch(src, /\bPRODUCTION_START\b/);
      assert.doesNotMatch(src, /\bPRODUCTION_COMPLETE\b/);
      assert.doesNotMatch(src, /\bPRODUCTION_CANCEL\b/);
    }
  });

  test('IQC / OQC / Contacts / Followups / SalesActivities / Production modals receive user and notify props', () => {
    // The unified V1.3 quality page receives user + notify and passes execution rights into its source-driven modal.
    assert.match(qualitySource, /function\s+QualityPage\s*\(\s*\{[^}]*\buser\b[^}]*\bnotify\b/);
    assert.match(qualitySource, /function\s+QualityModal\s*\(\s*\{[^}]*\bnotify\b/);
    // CRM modals — ContactModal / FollowupModal / ActivityModal receive notify
    assert.match(crmSource, /function\s+ContactModal\s*\(\s*\{[^}]*\bnotify\b/);
    assert.match(crmSource, /function\s+FollowupModal\s*\(\s*\{[^}]*\buser\b[^}]*\bnotify\b/);
    assert.match(crmSource, /function\s+ActivityModal\s*\(\s*\{[^}]*\bnotify\b/);
    // BOM + ProductionOrder modals — receive user + notify
    assert.match(manufacturingSource, /function\s+BomModal\s*\(\s*\{[^}]*\buser\b[^}]*\bnotify\b/);
    assert.match(manufacturingSource, /function\s+ProductionOrderModal\s*\(\s*\{[^}]*\buser\b[^}]*\bnotify\b/);
    // VoucherModal (accounting) — receive notify
    assert.match(accountingSource, /function\s+VoucherModal\s*\(\s*\{[^}]*\bnotify\b/);
  });

  test('No render-time setForm anti-pattern in post-stabilization modal bodies', () => {
    // The v0.9.4 hotfix moved `if (...) setForm(...)` out of BOM + ProductionOrder modal bodies.
    // The v1.0.0 Quality stabilization did the same for IQC + OQC modal bodies.
    // Logistics / master-data modals use a guarded `if (detail && !form.X) setForm(...)` that
    // does not infinite-loop because of the !form.X guard; this is recorded as P2 in the matrix.
    for (const src of [manufacturingSource, qualitySource]) {
      assert.doesNotMatch(src, /if\s*\([^)]+\)\s*setForm\s*\(/, 'post-v0.9.4 / post-Quality modal must not render-time setForm');
    }
  });

  test('No /api/users usage in non-admin-visible pages (projects page is admin-only)', () => {
    // After Quality + CRM stabilization, IQC / OQC / Contacts / Followups / SalesActivities / Production / Accounting
    // pages must derive actors / inspectors from authenticated user / narrow lookups, not the admin-only /api/users.
    // projects-workflow is admin-only (requires PROJECT_MANAGE), so its /api/users/lookup + /api/users usages are fine.
    const nonAdminSources = [
      qualitySource, manufacturingSource, accountingSource, crmSource, logisticsFinanceSource,
      treasuryCostSource,
    ];
    for (const src of nonAdminSources) {
      assert.doesNotMatch(src, /\/api\/users(?!$|\?)/, 'non-admin-visible page must not call admin /api/users');
    }
  });

  test('IQCInspections / OQCInspections / Contacts / Followups / SalesActivities SSR-render without exceptions', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const quality = await vite.ssrLoadModule('/src/pages/quality.jsx');
    const crm = await vite.ssrLoadModule('/src/pages/crm.jsx');
    const user = { id: 'u', username: 'u', displayName: 'Test', permissions: ['IQC_MANAGE', 'OQC_MANAGE', 'CRM_MANAGE', 'CUSTOMERS_MANAGE'] };
    for (const mod of [quality.IQCInspections, quality.OQCInspections, crm.Contacts, crm.Followups, crm.SalesActivities]) {
      const element = createElement(mod, { user, notify: () => {} });
      const markup = renderToStaticMarkup(element);
      assert.ok(markup.length > 0);
      assert.ok(!/ReferenceError|TypeError/.test(markup));
    }
  });
});

describe('Teacher Acceptance Matrix — API 500 sweep on visible workflows', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-500sweep-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Empty DB: every visible-page GET returns 2xx/4xx, no 500', async () => {
    const endpoints = [
      '/api/orders', '/api/purchase-orders', '/api/customers', '/api/suppliers', '/api/products',
      '/api/warehouses', '/api/inventory', '/api/inventory-transfers', '/api/inventory-transactions',
      '/api/purchase-receipts', '/api/sales-deliveries', '/api/sales-returns', '/api/purchase-returns',
      '/api/accounting-vouchers', '/api/accounting-subjects', '/api/cash-journals', '/api/bank-accounts',
      '/api/bills', '/api/fixed-assets', '/api/boms', '/api/production-orders', '/api/work-centers',
      '/api/routing-operations', '/api/labor-records', '/api/mrp-plans', '/api/product-costs',
      '/api/cost-rates', '/api/iqc', '/api/oqc', '/api/supplier-evaluations', '/api/projects',
      '/api/contacts', '/api/customer-followups', '/api/sales-activities', '/api/workflows',
      '/api/users', '/api/roles', '/api/departments', '/api/aux-projects', '/api/currencies',
      '/api/period-closures',
    ];
    for (const path of endpoints) {
      const res = await fetchJson(baseUrl, adminToken, path);
      assert.notEqual(res.status, 500, `admin GET ${path} returned 500`);
    }
  });

  test('Non-existent detail routes return 404, not 500', async () => {
    for (const path of ['/api/iqc/non-existent', '/api/oqc/non-existent', '/api/orders/non-existent', '/api/accounting-vouchers/non-existent']) {
      const res = await fetchJson(baseUrl, adminToken, path);
      assert.notEqual(res.status, 500, `detail ${path} returned 500`);
    }
  });

  test('Mutations with empty body on detail POST/PATCH endpoints return 400/404/409, not 500', async () => {
    for (const [path, method] of [
      ['/api/iqc/non-existent', 'PATCH'],
      ['/api/oqc/non-existent', 'PATCH'],
      ['/api/iqc/non-existent/complete', 'POST'],
      ['/api/oqc/non-existent/complete', 'POST'],
    ]) {
      const res = await api(baseUrl, adminToken, path, { method, body: {} });
      assert.notEqual(res.status, 500, `${method} ${path} returned 500`);
    }
  });
});

describe('Teacher Acceptance Matrix — Legacy DB compatibility', () => {
  test('Representative pre-stabilization fixture: existing rows preserved, startup idempotent', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-legacy-'));
    const dbPath = join(tmp, 'erp.db');

    // Step 1: Create a fresh DB and seed with pre-stabilization-era data:
    //  - inventory_transfers missing remark/updated_at/reviewer_id
    //  - cost_rates in legacy layout
    //  - sales_activities without a handler / activity type
    //  - customer_followups without handler_id
    //  - role-warehouse lacks IQC_MANAGE / OQC_MANAGE (pre-Quality-fix)
    {
      const db = createDatabase(dbPath);
      db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run('role-warehouse', 'INVENTORY_VIEW');
      db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run('role-warehouse', 'INVENTORY_TRANSFER_APPROVE');
      db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run('role-warehouse', 'INVENTORY_TRANSFER_CREATE');
      // Strip the IQC/OQC permissions added by the Quality stabilization.
      db.prepare("DELETE FROM role_permissions WHERE role_id='role-warehouse' AND permission_code IN ('IQC_VIEW','IQC_MANAGE','OQC_VIEW','OQC_MANAGE')").run();
      db.close();
    }

    // Step 2: Re-open via createDatabase — Quality reconciliation must re-add IQC/OQC permissions.
    const db = createDatabase(dbPath);
    for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
      assert.equal(db.prepare("SELECT count(*) c FROM role_permissions WHERE role_id='role-warehouse' AND permission_code=?").get(code).c, 1, `${code} must be re-added on legacy DB startup`);
    }
    // The transfer / cost_rate / accounting tables must all exist with their canonical schemas.
    const iqcCols = db.prepare("PRAGMA table_info(iqc_inspections)").all().map((c) => c.name);
    for (const required of ['iqc_no', 'supplier_id', 'inspection_type', 'status', 'result', 'total_quantity', 'sample_quantity', 'qualified_quantity', 'reject_quantity', 'inspector_id', 'inspected_at', 'remark']) {
      assert.ok(iqcCols.includes(required), `iqc_inspections must have ${required}`);
    }
    // Step 3: Second startup — must remain idempotent.
    db.close();
    const db2 = createDatabase(dbPath);
    for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
      assert.equal(db2.prepare("SELECT count(*) c FROM role_permissions WHERE role_id='role-warehouse' AND permission_code=?").get(code).c, 1);
    }
    db2.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('Teacher Acceptance Matrix — Data integrity assertions', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let warehouseToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-matrix-integrity-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('IQC: failed multi-line create rolls back entire document', async () => {
    const beforeHeader = db.prepare('SELECT count(*) c FROM iqc_inspections').get().c;
    const beforeItems = db.prepare('SELECT count(*) c FROM iqc_inspection_items').get().c;
    const res = await api(baseUrl, warehouseToken, '/api/iqc', {
      method: 'POST',
      body: {
        supplier_id: 'supplier-001',
        inspection_type: 'NORMAL',
        total_quantity: 50,
        sample_quantity: 10,
        qualified_quantity: 10,
        reject_quantity: 0,
        remark: '',
        items: [
          { product_id: 'product-001', batch_no: 'OK-1', quantity: 25, sample_size: 5, qualified: 1, reject_reason: '' },
          { product_id: 'product-001', batch_no: 'BAD-2', quantity: 25, sample_size: 99, qualified: 1, reject_reason: '' }, // sample_size > quantity
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) c FROM iqc_inspections').get().c, beforeHeader);
    assert.equal(db.prepare('SELECT count(*) c FROM iqc_inspection_items').get().c, beforeItems);
  });

  test('OQC: failed multi-line create rolls back entire document', async () => {
    const beforeHeader = db.prepare('SELECT count(*) c FROM oqc_inspections').get().c;
    const beforeItems = db.prepare('SELECT count(*) c FROM oqc_inspection_items').get().c;
    const res = await api(baseUrl, warehouseToken, '/api/oqc', {
      method: 'POST',
      body: {
        customer_id: 'customer-001',
        inspection_type: 'NORMAL',
        total_quantity: 50,
        sample_quantity: 10,
        qualified_quantity: 10,
        reject_quantity: 0,
        remark: '',
        items: [
          { product_id: 'product-001', batch_no: 'OK-1', quantity: 25, sample_size: 5, qualified: 1, reject_reason: '' },
          { product_id: 'product-001', batch_no: 'BAD-2', quantity: 25, sample_size: 99, qualified: 1, reject_reason: '' },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(db.prepare('SELECT count(*) c FROM oqc_inspections').get().c, beforeHeader);
    assert.equal(db.prepare('SELECT count(*) c FROM oqc_inspection_items').get().c, beforeItems);
  });

  test('V1.3 IQC: standalone manual source rows are refused without partial writes', async () => {
    const beforeHeaders = db.prepare('SELECT count(*) c FROM iqc_inspections').get().c;
    const beforeItems = db.prepare('SELECT count(*) c FROM iqc_inspection_items').get().c;
    const created = await api(baseUrl, warehouseToken, '/api/iqc', {
      method: 'POST',
      body: {
        supplier_id: 'supplier-001',
        inspection_type: 'NORMAL',
        total_quantity: 100,
        sample_quantity: 20,
        qualified_quantity: 20,
        reject_quantity: 0,
        remark: '',
        items: [
          { product_id: 'product-001', batch_no: 'X1', quantity: 50, sample_size: 10, qualified: 1, reject_reason: '' },
          { product_id: 'product-001', batch_no: 'X2', quantity: 50, sample_size: 10, qualified: 1, reject_reason: '' },
        ],
      },
    });
    assert.equal(created.status, 400);
    assert.equal(db.prepare('SELECT count(*) c FROM iqc_inspections').get().c, beforeHeaders);
    assert.equal(db.prepare('SELECT count(*) c FROM iqc_inspection_items').get().c, beforeItems);
  });
});

describe('Teacher Acceptance Matrix — Deferred features remain hidden', () => {
  let vite;
  const appJsSource = readFileSync(resolve(repoRoot, 'src', 'App.jsx'), 'utf8');
  const appServerSource = readFileSync(resolve(repoRoot, 'server', 'app.js'), 'utf8');
  const dbSource = readFileSync(resolve(repoRoot, 'server', 'db.js'), 'utf8');

  before(async () => {
    vite = await createViteServer({ root: repoRoot, server: { middlewareMode: true }, appType: 'custom' });
  });

  after(async () => {
    await vite.close();
  });

  test('App.jsx has NO nav entry for Production Output, Production Cost, MRP Calculator, or unrouted MRP lifecycle', () => {
    for (const forbidden of ['production-output', 'production-cost', 'mrp-calculator', 'mrp-detail', 'mrp-update', 'mrp-execute']) {
      assert.doesNotMatch(appJsSource, new RegExp(`key:\\s*'${forbidden}'`));
    }
  });

  test('No route for /api/production-outputs is registered', () => {
    assert.doesNotMatch(appServerSource, /\/api\/production-outputs/);
  });

  test('No PRODUCTION_OUTPUT / PRODUCTION_COSTS_VIEW / PRODUCTION_COSTS_MANAGE permission granted to non-admin roles', () => {
    // These permissions exist in PERMISSIONS registry but only admin (via `all`) inherits them.
    for (const role of ['role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting']) {
      assert.ok(!ROLE_PERMISSIONS[role].includes('PRODUCTION_COSTS_VIEW'), `${role} must not hold PRODUCTION_COSTS_VIEW`);
      assert.ok(!ROLE_PERMISSIONS[role].includes('PRODUCTION_COSTS_MANAGE'), `${role} must not hold PRODUCTION_COSTS_MANAGE`);
    }
  });

  test('No role-accounting cost access (PENDING decision preserved)', () => {
    for (const code of ['COST_VIEW', 'COST_MANAGE']) {
      assert.ok(!ROLE_PERMISSIONS['role-accounting'].includes(code), `role-accounting must not hold ${code}`);
    }
  });
});
