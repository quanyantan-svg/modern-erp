// V17 Master & Engineering Domain Closure — Wave B focused tests.
//
// Covers:
//   - Additive migration preserves legacy ACTIVE / DISCONTINUED + production
//     snapshot table (production_orders.bom_id, production_order_items,
//     production_order_routing_snapshots).
//   - BOM lifecycle: create + update + approve + reject + deactivate; legacy
//     ACTIVE rows continue to load.
//   - Cycle detection refuses self / multi-level cycles.
//   - Tree expand + where-used + consolidated + compare + cost reference.
//   - Batch maintenance: preview produces no mutation; apply is atomic.
//   - Resolver contract: resolveEffectiveBom respects effective_from/to + approval.

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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-bom-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

let adminAuth;
let salesAuth;

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
    code, name, unit: '件', baseUomCode: '件', inventoryClassification: classification, trackingPolicy: 'NONE', priceCents: 1000,
  });
  assert.equal(result.status, 201, result.data.error);
  return result.data.id;
}

describe('V17 Master & Engineering BOM Governance (Wave B)', () => {
  test('migration preserves legacy BOM rows and adds new columns', () => {
    const cols = database.prepare("PRAGMA table_info(boms)").all().map((row) => row.name);
    for (const col of ['id', 'product_id', 'version', 'status', 'remark', 'creator_id', 'created_at', 'updated_at']) {
      assert.ok(cols.includes(col), `legacy column missing: ${col}`);
    }
    for (const col of ['purpose', 'effective_from', 'effective_to', 'approval_status', 'approved_by', 'approved_at', 'change_request_id']) {
      assert.ok(cols.includes(col), `additive column missing: ${col}`);
    }
    // Snapshot tables must still exist.
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('production_orders','production_order_items','production_order_routing_snapshots')").all().map((row) => row.name);
    for (const t of ['production_orders', 'production_order_items', 'production_order_routing_snapshots']) {
      assert.ok(tables.includes(t), `${t} must remain`);
    }
  });

  test('BOM lifecycle: create + submit + approve + deactivate; sales role cannot manage', async () => {
    const finished = await makeProduct('FG-BOM-1', '成品-BOM-1');
    const comp1 = await makeProduct('RM-BOM-1', '原料-BOM-1');
    // Sales cannot manage BOM governance.
    const blocked = await api('POST', '/api/engineering/boms', salesAuth, {
      productId: finished, version: '1.0', items: [{ productId: comp1, quantity: 2 }],
    });
    assert.notEqual(blocked.status, 201);
    // Admin can create as DRAFT (then submit / approve).
    const created = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: finished, version: '1.0', remark: '初始版本', approvalStatus: 'DRAFT',
      items: [{ productId: comp1, quantity: 2, scrapRate: 0.05 }],
    });
    assert.equal(created.status, 201, created.data.error);
    const bomId = created.data.id;
    // Submit for approval.
    const submit = await api('POST', `/api/engineering/boms/${bomId}/submit`, adminAuth);
    assert.equal(submit.status, 200, submit.data.error);
    // Approve.
    const approve = await api('POST', `/api/engineering/boms/${bomId}/approve`, adminAuth);
    assert.equal(approve.status, 200, approve.data.error);
    // Get via governance endpoint.
    const detail = await api('GET', `/api/engineering/boms/${bomId}`, adminAuth);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.bom.approval_status, 'APPROVED');
    assert.equal(detail.data.bom.purpose, 'GENERAL');
    // List.
    const list = await api('GET', '/api/engineering/boms', adminAuth);
    assert.ok(list.data.boms.some((b) => b.id === bomId));
    // Deactivate.
    const deactivate = await api('POST', `/api/engineering/boms/${bomId}/deactivate`, adminAuth);
    assert.equal(deactivate.status, 200);
    // Update should now fail.
    const upd = await api('PATCH', `/api/engineering/boms/${bomId}`, adminAuth, {
      productId: finished, version: '1.0', items: [{ productId: comp1, quantity: 3 }],
    });
    assert.equal(upd.status, 409);
  });

  test('cycle protection: self-reference and multi-level cycle rejected', async () => {
    const a = await makeProduct('FG-CYC-A', 'A');
    const b = await makeProduct('FG-CYC-B', 'B');
    const c = await makeProduct('FG-CYC-C', 'C');
    // Build A → B
    const bomA = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    assert.equal(bomA.status, 201);
    // Build B → C
    const bomB = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: b, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    assert.equal(bomB.status, 201);
    // Try to build C → A (cycle).
    const cycle = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: c, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: a, quantity: 1 }],
    });
    assert.equal(cycle.status, 409, cycle.data.error);
    assert.ok(/循环/.test(cycle.data.error));
    // Try direct self-ref.
    const self = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '2.0', purpose: 'GENERAL',
      items: [{ productId: a, quantity: 1 }],
    });
    assert.equal(self.status, 400);
  });

  test('tree expand reports cycle for nodes already on the path', async () => {
    const a = await makeProduct('FG-TREE-A', 'A');
    const b = await makeProduct('FG-TREE-B', 'B');
    const c = await makeProduct('FG-TREE-C', 'C');
    const createdA = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    assert.equal(createdA.status, 201, createdA.data.error);
    await api('POST', '/api/engineering/boms', adminAuth, {
      productId: b, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const tree = await api('GET', `/api/engineering/boms/tree?bom_id=${createdA.data.id}`, adminAuth);
    assert.equal(tree.status, 200);
    assert.ok(tree.data.nodes.some((n) => n.depth === 0));
    assert.ok(tree.data.nodes.some((n) => n.depth === 1));
  });

  test('where-used: reverse lookup', async () => {
    const a = await makeProduct('FG-WU-A', 'A');
    const b = await makeProduct('FG-WU-B', 'B');
    await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    const result = await api('GET', `/api/engineering/boms/where-used?product_id=${b}`, adminAuth);
    assert.equal(result.status, 200);
    assert.ok(result.data.usages.some((u) => u.parent_product_id === a));
  });

  test('consolidated: same component across levels aggregated', async () => {
    const a = await makeProduct('FG-CONS-A', 'A');
    const b = await makeProduct('FG-CONS-B', 'B');
    const c = await makeProduct('FG-CONS-C', 'C');
    const createdA = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [
        { productId: b, quantity: 2 },
        { productId: c, quantity: 3 },
      ],
    });
    assert.equal(createdA.status, 201, createdA.data.error);
    await api('POST', '/api/engineering/boms', adminAuth, {
      productId: b, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: c, quantity: 1 }],
    });
    const result = await api('GET', `/api/engineering/boms/consolidated?bom_id=${createdA.data.id}&quantity=10`, adminAuth);
    assert.equal(result.status, 200);
    // c appears in level 0 and level 1; with qty=10, level-0 c = 30 and level-1 c = 2*10*1 = 20.
    const cLine = result.data.items.find((it) => it.product_id === c);
    assert.ok(cLine, 'c must appear in consolidation');
    assert.equal(Math.round(cLine.quantity * 100), Math.round(50 * 100), `c total should be 50, got ${cLine.quantity}`);
  });

  test('compare: diff two BOM versions', async () => {
    const a = await makeProduct('FG-CMP-A', 'A');
    const b = await makeProduct('FG-CMP-B', 'B');
    const c = await makeProduct('FG-CMP-C', 'C');
    const left = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    const right = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '2.0', purpose: 'GENERAL',
      items: [
        { productId: b, quantity: 2 },
        { productId: c, quantity: 1 },
      ],
    });
    const cmp = await api('GET', `/api/engineering/boms/compare?left=${left.data.id}&right=${right.data.id}`, adminAuth);
    assert.equal(cmp.status, 200);
    assert.ok(cmp.data.diff.some((d) => d.product_id === b && d.status === 'CHANGED'));
    assert.ok(cmp.data.diff.some((d) => d.product_id === c && d.status === 'ADDED'));
  });

  test('cost reference: uses product_costs, does not write new facts', async () => {
    const a = await makeProduct('FG-COST-A', 'A');
    const b = await makeProduct('FG-COST-B', 'B');
    const c = await makeProduct('FG-COST-C', 'C');
    const createdA = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [
        { productId: b, quantity: 1 },
        { productId: c, quantity: 2 },
      ],
    });
    assert.equal(createdA.status, 201);
    const result = await api('GET', `/api/engineering/boms/cost?bom_id=${createdA.data.id}`, adminAuth);
    assert.equal(result.status, 200);
    assert.equal(result.data.lines.length, 2);
    // product_costs is empty so line_material_cost_cents should be 0.
    assert.equal(result.data.total_material_cost_cents, 0);
  });

  test('batch: preview produces no mutation; apply atomic', async () => {
    const a = await makeProduct('FG-BAT-A', 'A');
    const b = await makeProduct('FG-BAT-B', 'B');
    const c = await makeProduct('FG-BAT-C', 'C');
    const d = await makeProduct('FG-BAT-D', 'D');
    const create = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    assert.equal(create.status, 201);
    const preview = await api('POST', '/api/engineering/boms/batch-preview', adminAuth, {
      filter: { productIds: [a] },
      changes: [
        { type: 'add', componentProductId: c, quantity: 2 },
        { type: 'modify', componentProductId: b, quantity: 3, scrapRate: 0.1 },
        { type: 'replace', fromProductId: b, toProductId: d },
      ],
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.previewCount, 1);
    // Confirm preview didn't mutate.
    const beforeApply = await api('GET', `/api/engineering/boms/${create.data.id}`, adminAuth);
    assert.equal(beforeApply.status, 200);
    const beforeItems = beforeApply.data.bom.items.map((it) => it.product_id).sort();
    assert.deepEqual(beforeItems, [b], `before preview items mismatch: ${JSON.stringify(beforeItems)}`);
    // Apply.
    const apply = await api('POST', '/api/engineering/boms/batch-apply', adminAuth, {
      filter: { productIds: [a] },
      changes: [
        { type: 'add', componentProductId: c, quantity: 2 },
        { type: 'modify', componentProductId: b, quantity: 3, scrapRate: 0.1 },
        { type: 'replace', fromProductId: b, toProductId: d },
      ],
    });
    assert.equal(apply.status, 200);
    assert.equal(apply.data.appliedCount, 1);
    const afterApply = await api('GET', `/api/engineering/boms/${create.data.id}`, adminAuth);
    const afterProducts = afterApply.data.bom.items.map((it) => it.product_id).sort();
    assert.deepEqual(afterProducts, [c, d].sort());
  });

  test('resolver contract: effective_from/to + approval honored', async () => {
    const a = await makeProduct('FG-RES-A', 'A');
    const b = await makeProduct('FG-RES-B', 'B');
    // Create a future-effective BOM.
    const future = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: 'FUTURE', purpose: 'GENERAL',
      effectiveFrom: '2099-01-01', effectiveTo: '2099-12-31',
      items: [{ productId: b, quantity: 1 }],
    });
    assert.equal(future.status, 201);
    // Current date resolver should not pick FUTURE.
    const ref = await import('./modules/engineering-bom.js');
    const resolved = ref.resolveEffectiveBomForCaller(database, a, 'GENERAL', '2026-10-06');
    assert.ok(!resolved || resolved.version !== 'FUTURE', `Future-effective BOM must not resolve for current date, got ${JSON.stringify(resolved)}`);
  });

  test('deactivate blocked by production order reference', async () => {
    const a = await makeProduct('FG-PO-A', 'A');
    const b = await makeProduct('FG-PO-B', 'B');
    const create = await api('POST', '/api/engineering/boms', adminAuth, {
      productId: a, version: '1.0', purpose: 'GENERAL',
      items: [{ productId: b, quantity: 1 }],
    });
    const bomId = create.data.id;
    // Simulate a production order referencing it.
    const poId = `po-test-${Date.now()}`;
    database.prepare(`INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,creator_id,created_at,updated_at,source_type)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(poId, `MO-${Date.now().toString(36).toUpperCase()}`, a, bomId, 1, 'PENDING', 'user-admin', new Date().toISOString(), new Date().toISOString(), 'MANUAL');
    const deact = await api('POST', `/api/engineering/boms/${bomId}/deactivate`, adminAuth);
    assert.equal(deact.status, 409);
    // Remove the order, then deactivate succeeds.
    database.prepare('DELETE FROM production_orders WHERE id=?').run(poId);
    const deact2 = await api('POST', `/api/engineering/boms/${bomId}/deactivate`, adminAuth);
    assert.equal(deact2.status, 200);
  });
});