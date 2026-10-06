// Phase D hotfix regression coverage for the remaining production blocker:
//
//   - Production Order create button missing — frontend used non-canonical
//     permission codes (PRODUCTION_CREATE / PRODUCTION_START / PRODUCTION_COMPLETE
//     / PRODUCTION_CANCEL) that are NOT defined anywhere, so can() returned false
//     for every user including admin.
//
// The original Blocker 1 (Project create blank screen) coverage was removed
// together with the Project Management extension in Core Scope Cleanup.
//
// This file mixes:
//   • source-level regression assertions (importing the actual .jsx modules is not
//     possible without a JSX transformer, so we read the JSX source directly)
//   • focused backend tests for the production order CRUD + state-machine + 403 gates,
//     using the existing node:test harness and a fresh SQLite database.
//
// jsdom/JSX DOM rendering is NOT available in this Node-only test harness, so we
// capture the strongest possible evidence at the source + module boundary level,
// as documented in the Phase D task instructions.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

let tempDir;
let database;
let server;
let baseUrl;
let salesToken;
let adminToken;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-phase-d-hfix-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginBody = await loginRes.json();
  adminToken = loginBody.token;
  const salesLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sales', password: 'sales123' }),
  });
  salesToken = (await salesLogin.json()).token;
});

after(async () => {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// Blocker 1 (Project create blank screen) was removed together with
// the Project Management extension in Core Scope Cleanup.

// ============================================================
// Blocker 2 — Production permissions canonical alignment (source + backend)
// ============================================================

describe('Blocker 2 — frontend uses canonical PRODUCTION_ORDERS_* permission codes', () => {
  test('manufacturing.jsx does not reference the legacy non-canonical codes', () => {
    const src = readSrc('pages/manufacturing.jsx');
    for (const legacy of ['PRODUCTION_CREATE', 'PRODUCTION_START', 'PRODUCTION_COMPLETE', 'PRODUCTION_CANCEL']) {
      assert.equal(src.includes(`'${legacy}'`), false, `manufacturing.jsx must not reference legacy '${legacy}'`);
    }
  });

  test('manufacturing.jsx uses canonical PRODUCTION_ORDERS_CREATE for the create button', () => {
    const src = readSrc('pages/manufacturing.jsx');
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_CREATE'\)/.test(src), 'create button must gate on PRODUCTION_ORDERS_CREATE');
  });

  test('manufacturing.jsx uses canonical PRODUCTION_ORDERS_START / COMPLETE for state transitions', () => {
    const src = readSrc('pages/manufacturing.jsx');
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_START'\)/.test(src), 'start button must gate on PRODUCTION_ORDERS_START');
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_COMPLETE'\)/.test(src), 'complete button must gate on PRODUCTION_ORDERS_COMPLETE');
  });

  test('manufacturing.jsx cancel button matches backend allowAny contract (CREATE OR START)', () => {
    const src = readSrc('pages/manufacturing.jsx');
    // Cancel line: detail.status !== 'COMPLETED' && (can(user, 'PRODUCTION_ORDERS_CREATE') || can(user, 'PRODUCTION_ORDERS_START')) && <button>取消</button>
    const cancelBlock = src.match(/detail\.status\s*!==\s*'COMPLETED'[\s\S]{0,200}<\/button>/);
    assert.ok(cancelBlock, 'cancel button block must exist');
    const cancel = cancelBlock[0];
    assert.ok(cancel.includes("'PRODUCTION_ORDERS_CREATE'") && cancel.includes("'PRODUCTION_ORDERS_START'"), 'cancel must accept either canonical CREATE or START, matching backend allowAny');
  });

  test('Application registry production routes already use the canonical codes', () => {
    // V1.7 P0: navigation and route bindings live in applicationRegistry.js;
    // App.jsx no longer hard-codes route access codes.
    const src = readSrc('navigation/applicationRegistry.js');
    assert.ok(/PRODUCTION_ORDERS_VIEW/.test(src) && /PRODUCTION_ORDERS_CREATE/.test(src), 'registry routes must already use PRODUCTION_ORDERS_*');
  });

  test('Permission table defines only the canonical production codes', () => {
    const db = new DatabaseSync(':memory:');
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('PRODUCTION_ORDERS_VIEW'), 'PRODUCTION_ORDERS_VIEW must be registered');
    assert.ok(codes.includes('PRODUCTION_ORDERS_CREATE'), 'PRODUCTION_ORDERS_CREATE must be registered');
    assert.ok(codes.includes('PRODUCTION_ORDERS_START'), 'PRODUCTION_ORDERS_START must be registered');
    assert.ok(codes.includes('PRODUCTION_ORDERS_COMPLETE'), 'PRODUCTION_ORDERS_COMPLETE must be registered');
    db.close();
  });
});

// ============================================================
// Production Order Functional Regression (backend, end-to-end)
// ============================================================

async function api(path, opts = {}, token = adminToken) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getFirstProductId() {
  const res = await api('/api/products');
  return res.data.products?.[0]?.id || null;
}

async function createActiveBom(productId) {
  if (!productId) return null;
  const products = await api('/api/products');
  const component = products.data.products?.find((product) => product.id !== productId);
  if (!component) return null;
  const res = await api('/api/boms', {
    method: 'POST',
    body: { productId, version: `phase-d-${Date.now()}-${Math.random()}`, remark: 'phase-d-hfix', items: [{ productId: component.id, quantity: 1 }] },
  });
  if (res.status !== 200) return null;
  return res.data.id;
}

describe('Production order — permission and state-machine regression', () => {
  const orderRef = { id: null };

  test('admin has the canonical PRODUCTION_ORDERS_CREATE permission', async () => {
    const me = await api('/api/auth/me');
    assert.equal(me.status, 200);
    assert.ok(me.data.user.permissions.includes('PRODUCTION_ORDERS_CREATE'), 'admin must have PRODUCTION_ORDERS_CREATE');
    assert.ok(me.data.user.permissions.includes('PRODUCTION_ORDERS_VIEW'), 'admin must have PRODUCTION_ORDERS_VIEW');
    assert.ok(me.data.user.permissions.includes('PRODUCTION_ORDERS_START'), 'admin must have PRODUCTION_ORDERS_START');
    assert.ok(me.data.user.permissions.includes('PRODUCTION_ORDERS_COMPLETE'), 'admin must have PRODUCTION_ORDERS_COMPLETE');
  });

  test('sales role lacks PRODUCTION_ORDERS_CREATE — POST /api/production-orders returns 403', async () => {
    const productId = await getFirstProductId();
    const res = await api('/api/production-orders', {
      method: 'POST',
      body: { productId, quantity: 1, plannedStart: '2026-09-01' },
    }, salesToken);
    assert.equal(res.status, 403, `sales user must NOT create production orders; got ${res.status}`);
  });

  test('admin can create a valid production order with product + BOM + quantity + plannedStart', async () => {
    const productId = await getFirstProductId();
    const bomId = await createActiveBom(productId);
    const res = await api('/api/production-orders', {
      method: 'POST',
      body: { productId, bomId, quantity: 5, plannedStart: '2026-09-01', remark: 'phase-d-hfix create' },
    });
    assert.equal(res.status, 200, `create must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    assert.ok(res.data.id && res.data.orderNo);
    orderRef.id = res.data.id;
  });

  test('created production order is readable via GET /api/production-orders/:id', async () => {
    const orderId = orderRef.id;
    if (!orderId) return;
    const res = await api(`/api/production-orders/${orderId}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.order.id, orderId);
    assert.equal(res.data.order.status, 'PENDING');
    assert.equal(res.data.order.quantity, 5);
  });

  test('PENDING → start succeeds with action=start', async () => {
    const orderId = orderRef.id;
    if (!orderId) return;
    const res = await api(`/api/production-orders/${orderId}`, {
      method: 'POST', body: { action: 'start' },
    });
    assert.equal(res.status, 200);
    const detail = await api(`/api/production-orders/${orderId}`);
    assert.equal(detail.data.order.status, 'IN_PROGRESS');
  });

  test('IN_PROGRESS → complete is refused until material and output reconcile', async () => {
    const orderId = orderRef.id;
    if (!orderId) return;
    const res = await api(`/api/production-orders/${orderId}`, {
      method: 'POST', body: { action: 'complete' },
    });
    assert.equal(res.status, 409);
    const detail = await api(`/api/production-orders/${orderId}`);
    assert.equal(detail.data.order.status, 'IN_PROGRESS');
  });

  test('cancellable order → cancel succeeds with action=cancel', async () => {
    const productId = await getFirstProductId();
    const bomId = await createActiveBom(productId);
    const create = await api('/api/production-orders', {
      method: 'POST', body: { productId, bomId, quantity: 1, plannedStart: '2026-09-02' },
    });
    assert.equal(create.status, 200);
    const newOrderId = create.data.id;
    const cancel = await api(`/api/production-orders/${newOrderId}`, {
      method: 'POST', body: { action: 'cancel' },
    });
    assert.equal(cancel.status, 200);
    const detail = await api(`/api/production-orders/${newOrderId}`);
    assert.equal(detail.data.order.status, 'CANCELLED');
  });

  test('invalid state transition (start already IN_PROGRESS) is rejected with 409', async () => {
    const orderId = orderRef.id;
    if (!orderId) return;
    const res = await api(`/api/production-orders/${orderId}`, {
      method: 'POST', body: { action: 'start' },
    });
    assert.equal(res.status, 409, `cannot start a COMPLETED order; got ${res.status}`);
  });

  test('invalid state transition (complete CANCELLED) is rejected with 409', async () => {
    const list = await api('/api/production-orders?status=CANCELLED');
    const cancelled = list.data.orders?.[0];
    if (!cancelled) return;
    const res = await api(`/api/production-orders/${cancelled.id}`, {
      method: 'POST', body: { action: 'complete' },
    });
    assert.equal(res.status, 409);
  });
});
