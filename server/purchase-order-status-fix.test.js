import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
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

const poPayload = (overrides = {}) => ({
  supplierId: 'supplier-001',
  items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 100000 }],
  ...overrides,
});

async function createPurchaseOrder(baseUrl, token, overrides = {}) {
  const res = await api(baseUrl, token, '/api/purchase-orders', { method: 'POST', body: poPayload(overrides) });
  assert.equal(res.status, 201, res.body.error);
  return res.body;
}

describe('Purchase order status serialization fix', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let salesToken;
  let reviewerToken;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-po-status-'));
    db = createDatabase(join(tmp, 'erp.db'));
    ({ server, baseUrl } = await startApi(db));
    salesToken = await login(baseUrl, 'sales', 'sales123');
    reviewerToken = await login(baseUrl, 'reviewer', 'review123');
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await closeApi(server);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Empty purchase_orders: list returns 200 (regression sentinel)', async () => {
    const res = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=');
    assert.equal(res.status, 200, res.body.error);
    assert.deepEqual(res.body.purchaseOrders, []);
  });

  test('Empty purchase_orders: dashboard returns 200 (no ReferenceError)', async () => {
    const res = await api(baseUrl, salesToken, '/api/dashboard');
    assert.equal(res.status, 200, res.body.error);
    assert.deepEqual(res.body.recentPurchaseOrders, []);
  });

  test('Populated purchase_orders: list returns 200 + statusLabel for each row', async () => {
    // Create four orders, one per canonical status, then verify list serializes all four labels.
    const draftOnly = await createPurchaseOrder(baseUrl, salesToken);
    const submitted = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${submitted.id}/submit`, { method: 'POST' });
    const approved = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${approved.id}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-orders/${approved.id}/approve`, { method: 'POST' });
    const rejected = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${rejected.id}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-orders/${rejected.id}/reject`, {
      method: 'POST',
      body: { reason: 'matrix reject' },
    });

    const res = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(Array.isArray(res.body.purchaseOrders));
    const byStatus = Object.fromEntries(res.body.purchaseOrders.map((row) => [row.id, row]));
    assert.equal(byStatus[draftOnly.id].statusLabel, '草稿');
    assert.equal(byStatus[submitted.id].statusLabel, '待审核');
    assert.equal(byStatus[approved.id].statusLabel, '已审核');
    assert.equal(byStatus[rejected.id].statusLabel, '已驳回');
  });

  test('Per-status serialization: DRAFT', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    const list = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=DRAFT');
    assert.equal(list.status, 200);
    const row = list.body.purchaseOrders.find((r) => r.id === created.id);
    assert.ok(row, 'DRAFT row must be present in DRAFT filter');
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.statusLabel, '草稿');
  });

  test('Per-status serialization: SUBMITTED', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${created.id}/submit`, { method: 'POST' });
    const list = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=SUBMITTED');
    assert.equal(list.status, 200);
    const row = list.body.purchaseOrders.find((r) => r.id === created.id);
    assert.ok(row);
    assert.equal(row.status, 'SUBMITTED');
    assert.equal(row.statusLabel, '待审核');
  });

  test('Per-status serialization: APPROVED', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${created.id}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-orders/${created.id}/approve`, { method: 'POST' });
    const list = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=APPROVED');
    assert.equal(list.status, 200);
    const row = list.body.purchaseOrders.find((r) => r.id === created.id);
    assert.ok(row);
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.statusLabel, '已审核');
  });

  test('Per-status serialization: REJECTED', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${created.id}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-orders/${created.id}/reject`, {
      method: 'POST',
      body: { reason: 'fix test' },
    });
    const list = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=REJECTED');
    assert.equal(list.status, 200);
    const row = list.body.purchaseOrders.find((r) => r.id === created.id);
    assert.ok(row);
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.statusLabel, '已驳回');
  });

  test('Populated dashboard returns 200 with recentPurchaseOrders (no ReferenceError)', async () => {
    // Existing fixture has multiple purchase orders already.
    const res = await api(baseUrl, salesToken, '/api/dashboard');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(Array.isArray(res.body.recentPurchaseOrders));
    for (const row of res.body.recentPurchaseOrders) {
      assert.ok(['草稿', '待审核', '已审核', '已驳回'].includes(row.statusLabel), `unexpected statusLabel ${row.statusLabel}`);
      assert.ok(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(row.status));
    }
  });

  test('Populated dashboard serialized rows preserve canonical fields', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    const res = await api(baseUrl, salesToken, '/api/dashboard');
    assert.equal(res.status, 200, res.body.error);
    const found = res.body.recentPurchaseOrders.find((r) => r.id === created.id);
    assert.ok(found, 'recently created DRAFT must surface in dashboard');
    assert.equal(found.status, 'DRAFT');
    assert.equal(found.statusLabel, '草稿');
    assert.ok(found.orderNo);
    assert.equal(found.supplierId, 'supplier-001');
    assert.equal(found.supplierName, '深圳华强电子市场');
    assert.equal(found.itemCount, 1);
    assert.equal(found.creatorName, '销售专员');
    assert.equal(found.totalCents, 500000);
  });

  test('statusLabel is present on every populated row (canonical API contract preserved)', async () => {
    const created = await createPurchaseOrder(baseUrl, salesToken);
    await api(baseUrl, salesToken, `/api/purchase-orders/${created.id}/submit`, { method: 'POST' });
    const res = await api(baseUrl, salesToken, '/api/purchase-orders');
    assert.equal(res.status, 200);
    for (const row of res.body.purchaseOrders) {
      assert.ok('statusLabel' in row, 'every row must carry statusLabel');
      assert.ok(typeof row.statusLabel === 'string' && row.statusLabel.length > 0, 'statusLabel must be a non-empty string');
    }
  });

  test('role-sales GET /api/dashboard on populated DB returns 200', async () => {
    const res = await api(baseUrl, salesToken, '/api/dashboard');
    assert.equal(res.status, 200, res.body.error);
  });

  test('role-sales GET /api/purchase-orders on populated DB returns 200', async () => {
    const res = await api(baseUrl, salesToken, '/api/purchase-orders?search=&status=');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(Array.isArray(res.body.purchaseOrders));
  });

  test('role-sales retains PURCHASE_ORDERS_VIEW / _CREATE / _SUBMIT (no permission regression)', async () => {
    const me = await api(baseUrl, salesToken, '/api/auth/me');
    assert.equal(me.status, 200);
    for (const code of ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT']) {
      assert.ok(me.body.user.permissions.includes(code), `sales must retain ${code}`);
    }
  });

  test('Status filter route ignores unknown status (returns full list, no crash)', async () => {
    // Unknown status values are silently ignored by the canonical filter (PURCHASE_STATUS_LABELS lookup);
    // the contract is "no crash + full list" — same as the sales-order list endpoint.
    const res = await api(baseUrl, salesToken, '/api/purchase-orders?status=UNKNOWN_STATUS');
    assert.equal(res.status, 200, res.body.error);
    assert.ok(Array.isArray(res.body.purchaseOrders));
    assert.ok(res.body.purchaseOrders.length >= 1, 'unknown status must return the full unfiltered list');
    for (const row of res.body.purchaseOrders) {
      assert.ok('statusLabel' in row);
    }
  });

  test('No ReferenceError reaches client for any populated list call', async () => {
    const list = await api(baseUrl, salesToken, '/api/purchase-orders');
    assert.equal(list.status, 200);
    assert.notEqual(list.body.error?.includes?.('ReferenceError'), true, 'must not surface a ReferenceError to the client');
  });
});

describe('Purchase order status contract — source-level regression', () => {
  test('PURCHASE_STATUS_LABELS is defined at module scope', () => {
    const source = readFileSync(resolve(repoRoot, 'server', 'app.js'), 'utf8');
    assert.match(source, /const\s+PURCHASE_STATUS_LABELS\s*=/);
  });

  test('Canonical purchase-order statuses are exactly DRAFT / SUBMITTED / APPROVED / REJECTED', () => {
    const dbSource = readFileSync(resolve(repoRoot, 'server', 'db.js'), 'utf8');
    assert.match(dbSource, /CHECK\(status IN \('DRAFT','SUBMITTED','APPROVED','REJECTED'\)\)/);
  });
});
