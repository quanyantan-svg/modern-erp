// V17 Master & Engineering Domain Closure — Wave E focused tests.

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-eco-test-'));
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

async function makeProduct(code, name, classification = 'RAW_MATERIAL') {
  const result = await api('POST', '/api/products', adminAuth, {
    code, name, unit: '件', baseUomCode: '件', inventoryClassification: classification, trackingPolicy: 'NONE', priceCents: 100,
  });
  assert.equal(result.status, 201, result.data.error);
  return result.data.id;
}

describe('V17 Master & Engineering Change (Wave E)', () => {
  test('ECO lifecycle: DRAFT -> PENDING -> APPROVED -> APPLIED; impact preview', async () => {
    const productId = await makeProduct('ECO-P-1', 'P');
    const componentA = await makeProduct('ECO-C-1', 'C1');
    const componentB = await makeProduct('ECO-C-2', 'C2');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: componentA, quantity: 1 }],
    });
    assert.equal(bom.status, 201);
    const create = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-1', title: 'replace A with B', changeType: 'IMMEDIATE', targetBomId: bom.data.id,
      items: [
        { opType: 'DELETE_COMPONENT', productId: componentA },
        { opType: 'ADD_COMPONENT', productId: componentB, quantity: 2 },
      ],
    });
    assert.equal(create.status, 201, create.data.error);
    const changeList = await api('GET', '/api/engineering/changes', adminAuth);
    assert.equal(changeList.status, 200, changeList.data.error);
    assert.equal(changeList.data.changes.find((item) => item.id === create.data.id)?.target_bom_product_code, 'ECO-P-1');
    const submit = await api('POST', `/api/engineering/changes/${create.data.id}/submit`, adminAuth);
    assert.equal(submit.status, 200);
    const approve = await api('POST', `/api/engineering/changes/${create.data.id}/approve`, adminAuth);
    assert.equal(approve.status, 200);
    const preview = await api('POST', `/api/engineering/changes/${create.data.id}/impact-preview`, adminAuth);
    assert.equal(preview.status, 200);
    assert.ok(preview.data.diff.length > 0);
    const apply = await api('POST', `/api/engineering/changes/${create.data.id}/apply`, adminAuth);
    assert.equal(apply.status, 200);
    assert.ok(apply.data.appliedBomId);
    // The original BOM is DISCONTINUED; new BOM is ACTIVE.
    const list = await api('GET', '/api/engineering/boms?product=' + productId, adminAuth);
    const active = list.data.boms.find((b) => b.id === apply.data.appliedBomId);
    assert.equal(active.status, 'ACTIVE');
    // The original BOM should now be DISCONTINUED.
    const orig = list.data.boms.find((b) => b.id === bom.data.id);
    assert.equal(orig.status, 'DISCONTINUED');
  });

  test('allowed ops by type: EFFECTIVE_DATE rejects DELETE_COMPONENT', async () => {
    const productId = await makeProduct('ECO-P-2', 'P');
    const c = await makeProduct('ECO-C-3', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const eco = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-2', title: 'effective date change', changeType: 'EFFECTIVE_DATE', targetBomId: bom.data.id, effectiveDate: '2026-12-01',
      items: [{ opType: 'DELETE_COMPONENT', productId: c }],
    });
    assert.equal(eco.status, 409, JSON.stringify(eco.data));
  });

  test('USE_UP_OLD only allows MODIFY_COMPONENT and MODIFY_HEADER', async () => {
    const productId = await makeProduct('ECO-P-3', 'P');
    const c = await makeProduct('ECO-C-4', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const ok = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-3', title: 'use up old', changeType: 'USE_UP_OLD', targetBomId: bom.data.id,
      items: [{ opType: 'MODIFY_COMPONENT', productId: c, quantity: 1.5 }],
    });
    assert.equal(ok.status, 201);
    const bad = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-4', title: 'use up old bad', changeType: 'USE_UP_OLD', targetBomId: bom.data.id,
      items: [{ opType: 'ADD_COMPONENT', productId: c }],
    });
    assert.equal(bad.status, 409);
  });

  test('cleanup log: USE_UP_OLD accepts recordCleanup', async () => {
    const productId = await makeProduct('ECO-P-4', 'P');
    const c = await makeProduct('ECO-C-5', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const eco = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-5', title: 'use up old cleanup', changeType: 'USE_UP_OLD', targetBomId: bom.data.id,
      items: [{ opType: 'MODIFY_COMPONENT', productId: c, quantity: 1.5 }],
    });
    assert.equal(eco.status, 201);
    const cleanup = await api('POST', `/api/engineering/changes/${eco.data.id}/cleanup`, adminAuth, {
      productId: c, reason: 'inventory exhausted',
    });
    assert.equal(cleanup.status, 201);
  });

  test('reject without reason returns 400', async () => {
    const productId = await makeProduct('ECO-P-5', 'P');
    const c = await makeProduct('ECO-C-6', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const eco = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-6', title: 'reject test', changeType: 'IMMEDIATE', targetBomId: bom.data.id,
      items: [{ opType: 'MODIFY_HEADER' }],
    });
    await api('POST', `/api/engineering/changes/${eco.data.id}/submit`, adminAuth);
    const reject = await api('POST', `/api/engineering/changes/${eco.data.id}/reject`, adminAuth, {});
    assert.equal(reject.status, 400);
  });

  test('apply without APPROVED returns 409', async () => {
    const productId = await makeProduct('ECO-P-6', 'P');
    const c = await makeProduct('ECO-C-7', 'C');
    const bom = await api('POST', '/api/engineering/boms', adminAuth, {
      productId, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const eco = await api('POST', '/api/engineering/changes', adminAuth, {
      docNo: 'ECO-7', title: 'no approve', changeType: 'IMMEDIATE', targetBomId: bom.data.id,
      items: [{ opType: 'MODIFY_HEADER' }],
    });
    const apply = await api('POST', `/api/engineering/changes/${eco.data.id}/apply`, adminAuth);
    assert.equal(apply.status, 409);
  });
});
