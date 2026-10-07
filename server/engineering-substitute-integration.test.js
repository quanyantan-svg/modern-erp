// V17 Master & Engineering Domain Closure — Wave C focused tests.
//
// Covers:
//   - Substitute scheme lifecycle: create / list.
//   - Substitute validation: same primary + substitute rejected, duplicate
//     priority rejected, PROPORTION method requires ratio > 0.
//   - Deterministic resolver: respects priority, effective range, lifecycle.
//   - Configurable BOM: preview + validate contracts.

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
let salesAuth;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sub-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = await new Promise((resolveBase) => {
    server.address();
    resolveBase(`http://127.0.0.1:${server.address().port}`);
  });
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

describe('V17 Master & Engineering Substitute Scheme (Wave C)', () => {
  test('migration adds substitute scheme tables', () => {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('engineering_substitute_schemes','engineering_substitutes')").all().map((row) => row.name).sort();
    assert.deepEqual(tables, ['engineering_substitute_schemes', 'engineering_substitutes']);
  });

  test('scheme create / list', async () => {
    const created = await api('POST', '/api/engineering/substitute-schemes', adminAuth, {
      code: 'SUB-1', name: '标准替代方案', strategy: 'MIXED', method: 'REPLACE',
    });
    assert.equal(created.status, 201, created.data.error);
    const list = await api('GET', '/api/engineering/substitute-schemes', adminAuth);
    assert.ok(list.data.schemes.some((s) => s.code === 'SUB-1'));
  });

  test('substitute validation: same primary/substitute rejected', async () => {
    const p = await makeProduct('SUB-P-1', 'P');
    const scheme = await api('POST', '/api/engineering/substitute-schemes', adminAuth, { code: 'SUB-V1', name: '验证方案' });
    const same = await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: p, priority: 1,
    });
    assert.equal(same.status, 400);
  });

  test('substitute validation: PROPORTION method requires ratio > 0', async () => {
    const p = await makeProduct('SUB-P-2', 'P');
    const sub = await makeProduct('SUB-S-2', 'S');
    const scheme = await api('POST', '/api/engineering/substitute-schemes', adminAuth, { code: 'SUB-PR', name: '按比例方案', method: 'PROPORTION' });
    const bad = await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: sub, priority: 1, ratio: 0,
    });
    assert.equal(bad.status, 400);
    const ok = await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: sub, priority: 1, ratio: 0.5,
    });
    assert.equal(ok.status, 201, ok.data.error);
  });

  test('substitute validation: duplicate priority rejected', async () => {
    const p = await makeProduct('SUB-P-3', 'P');
    const s1 = await makeProduct('SUB-S-3A', 'S1');
    const s2 = await makeProduct('SUB-S-3B', 'S2');
    const scheme = await api('POST', '/api/engineering/substitute-schemes', adminAuth, { code: 'SUB-DUP', name: 'dup' });
    const a = await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: s1, priority: 1,
    });
    assert.equal(a.status, 201);
    const b = await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: s2, priority: 1,
    });
    assert.equal(b.status, 409);
  });

  test('substitute resolver: deterministic priority order', async () => {
    const p = await makeProduct('SUB-P-4', 'P');
    const s1 = await makeProduct('SUB-S-4A', 'A');
    const s2 = await makeProduct('SUB-S-4B', 'B');
    const scheme = await api('POST', '/api/engineering/substitute-schemes', adminAuth, { code: 'SUB-ORD', name: 'order' });
    await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: s2, priority: 5,
    });
    await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: s1, priority: 1,
    });
    const result = await api('GET', `/api/engineering/substitutes/resolve?product_id=${p}`, adminAuth);
    assert.equal(result.status, 200);
    assert.equal(result.data.substitutes.length, 2);
    assert.equal(result.data.substitutes[0].substitute_product_id, s1, 'priority 1 first');
    assert.equal(result.data.substitutes[1].substitute_product_id, s2, 'priority 5 second');
  });

  test('substitute resolver: future-effective row not returned', async () => {
    const p = await makeProduct('SUB-P-5', 'P');
    const s1 = await makeProduct('SUB-S-5', 'A');
    const scheme = await api('POST', '/api/engineering/substitute-schemes', adminAuth, { code: 'SUB-FUT', name: 'future' });
    await api('POST', '/api/engineering/substitutes', adminAuth, {
      schemeId: scheme.data.id, primaryProductId: p, substituteProductId: s1, priority: 1, effectiveFrom: '2099-01-01',
    });
    const result = await api('GET', `/api/engineering/substitutes/resolve?product_id=${p}`, adminAuth);
    assert.equal(result.data.substitutes.length, 0);
  });

  test('configurable BOM preview: non-replaceable swap is rejected', async () => {
    const a = await makeProduct('CFG-A', 'A');
    const b = await makeProduct('CFG-B', 'B');
    const c = await makeProduct('CFG-C', 'C');
    // Create BOM where b is not replaceable.
    const create = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [
        { productId: b, quantity: 1, isReplaceable: false },
        { productId: c, quantity: 1, isReplaceable: true },
      ],
    });
    assert.equal(create.status, 201);
    const preview = await api('POST', '/api/engineering/configurable-boms/preview', adminAuth, {
      bomId: create.data.id,
      choices: { '1': c, '2': b },
    });
    assert.equal(preview.status, 200);
    // line 1 has b not replaceable; choice tries c → warning emitted.
    assert.ok(preview.data.warnings.some((w) => /不允许/.test(w)));
    // line 2 had c, choice tries b which is valid.
    const item2 = preview.data.items.find((it) => it.line_no === 2);
    assert.equal(item2.product_id, b);
  });

  test('configurable BOM validate: config_group requires at least one selection', async () => {
    const a = await makeProduct('CFG-V-A', 'A');
    const b = await makeProduct('CFG-V-B', 'B');
    const c = await makeProduct('CFG-V-C', 'C');
    const create = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [
        { productId: b, quantity: 1, configGroup: 'COLOR', isSelectable: false },
        { productId: c, quantity: 1, configGroup: 'COLOR', isSelectable: false },
      ],
    });
    assert.equal(create.status, 201);
    const empty = await api('POST', '/api/engineering/configurable-boms/validate', adminAuth, {
      bomId: create.data.id, choices: {},
    });
    assert.equal(empty.status, 200);
    assert.equal(empty.data.ok, false);
    assert.ok(empty.data.errors.length > 0);
    const ok = await api('POST', '/api/engineering/configurable-boms/validate', adminAuth, {
      bomId: create.data.id, choices: { '1': b },
    });
    assert.equal(ok.data.ok, true);
  });
});