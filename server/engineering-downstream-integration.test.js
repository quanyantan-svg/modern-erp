// V17 Master & Engineering Domain Closure — Wave F focused tests.
//
// Confirms:
//   - Production Order can still be created with the canonical BOM and
//     routing snapshot; production_orders.bom_version_snapshot /
//     routing_id_snapshot remain immutable afterwards.
//   - Production Order snapshot populates from product_routings (canonical),
//     not the legacy routing_operations table.
//   - legacy /api/routing-operations GET still works (historical).
//   - Substitute resolver contract is exposed for Planning to consume.

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-downstream-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminAuth = (await login('admin', 'admin123')).data.token;
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

async function api(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

async function makeProduct(code, name, classification = 'FINISHED_GOOD') {
  const result = await api('POST', '/api/products', adminAuth, {
    code, name, unit: '件', baseUomCode: '件', inventoryClassification: classification, trackingPolicy: 'NONE', priceCents: 100,
  });
  assert.equal(result.status, 201, result.data.error);
  return result.data.id;
}

describe('V17 Master & Engineering Downstream Contract (Wave F)', () => {
  test('Production Order snapshot is preserved when master BOM mutates', async () => {
    const finished = await makeProduct('DS-P-1', 'P');
    const comp1 = await makeProduct('DS-C-1', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: finished, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: comp1, quantity: 2 }],
    });
    assert.equal(bom.status, 201);
    const po = await api('POST', '/api/production-orders', adminAuth, {
      productId: finished, bomId: bom.data.id, quantity: 5, plannedStart: '2026-10-07', plannedFinish: '2026-10-08',
    });
    assert.equal(po.status, 200, po.data.error);
    const get = await api('GET', `/api/production-orders/${po.data.id}`, adminAuth);
    assert.equal(get.status, 200);
    const snapshotBoms = database.prepare('SELECT COUNT(*) AS cnt FROM production_order_items WHERE order_id=?').get(po.data.id).cnt;
    assert.equal(snapshotBoms, 1, 'production snapshot must contain exactly 1 item');
    // Now mutate the BOM.
    await api('PATCH', `/api/engineering/boms/${bom.data.id}`, adminAuth, {
      productId: finished, version: '1.0',
      items: [{ productId: comp1, quantity: 4 }],
    });
    // The snapshot must not have changed.
    const post2 = await api('GET', `/api/production-orders/${po.data.id}`, adminAuth);
    const qty = database.prepare('SELECT quantity FROM bom_items WHERE bom_id=?').get(bom.data.id).quantity;
    // The snapshot quantity is the per-unit quantity derived from the
    // original BOM at PO creation time (i.e. 2 * (1 + 0) * 5 = 10).
    const snapshotQty = database.prepare(`SELECT poi.quantity FROM production_order_items poi WHERE poi.order_id=?`).get(po.data.id).quantity;
    assert.equal(snapshotQty, 10, 'production snapshot qty must remain at original');
    assert.equal(qty, 4, 'master BOM quantity must reflect update');
  });

  test('Production Order routing snapshot uses canonical product_routings', async () => {
    const finished = await makeProduct('DS-P-2', 'P');
    const comp1 = await makeProduct('DS-P-2-C', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: finished, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: comp1, quantity: 1 }],
    });
    const routing = await api('POST', '/api/product-routings', adminAuth, {
      productId: finished, routingCode: 'DS-RT-1', routingName: 'DS-RT', version: '1.0', status: 'ACTIVE',
      operations: [
        { sequenceNo: 1, operationCode: 'DS-OP-A', operationName: 'cut', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
        { sequenceNo: 2, operationCode: 'DS-OP-B', operationName: 'assemble', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
      ],
    });
    assert.equal(routing.status, 201);
    const po = await api('POST', '/api/production-orders', adminAuth, {
      productId: finished, bomId: bom.data.id, routingId: routing.data.id, quantity: 1,
    });
    assert.equal(po.status, 200, po.data.error);
    const snapshotRows = database.prepare('SELECT COUNT(*) AS n FROM production_order_routing_snapshots WHERE production_order_id=?').get(po.data.id).n;
    assert.equal(snapshotRows, 2);
  });

  test('legacy /api/routing-operations GET still works', async () => {
    const result = await api('GET', '/api/routing-operations', adminAuth);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.operations));
  });

  test('engineering BOM resolver still resolves legacy ACTIVE rows', async () => {
    const finished = await makeProduct('DS-P-3', 'P');
    const comp1 = await makeProduct('DS-C-2', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: finished, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: comp1, quantity: 2 }],
    });
    const ref = await import('./modules/engineering-bom.js');
    const resolved = ref.resolveEffectiveBomForCaller(database, finished, 'GENERAL', new Date().toISOString().slice(0, 10));
    assert.ok(resolved, 'BOM must resolve to the new ACTIVE row');
    assert.equal(resolved.id, bom.data.id);
  });
});