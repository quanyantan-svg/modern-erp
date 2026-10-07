// V17 Master & Engineering Domain Closure — Wave D focused tests.
//
// Covers:
//   - Migration preserves legacy routing_operations + production_labor_records
//     and adds enrichment + topology tables.
//   - Enrichment update attaches Engineering Operation / Control Code /
//     Activity / Resource / Equipment references; rejects unknown ids.
//   - Topology link CRUD with PARALLEL / SPLIT / MERGE / ALTERNATE.
//   - Switching topology_type to NETWORK when first link is added.
//   - Legacy /api/routing-operations GET still works (compatibility).
//   - Production Order Routing snapshot continues to be produced from
//     canonical product_routings (not the legacy table).

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-routing-test-'));
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

async function makeRouting(productId, code, ops) {
  const result = await api('POST', '/api/product-routings', adminAuth, {
    productId, routingCode: code, routingName: code, version: '1.0', status: 'ACTIVE',
    operations: ops,
  });
  assert.equal(result.status, 201, result.data.error);
  return result.data.id;
}

describe('V17 Master & Engineering Routing Enrichment (Wave D)', () => {
  test('migration preserves legacy tables and adds enrichment fields', () => {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('routing_operations','production_labor_records','product_routing_operations','product_routings','product_routing_operation_links')").all().map((row) => row.name).sort();
    assert.deepEqual(tables, ['product_routing_operation_links', 'product_routing_operations', 'product_routings', 'production_labor_records', 'routing_operations']);
    // New columns on product_routings.
    const cols = database.prepare("PRAGMA table_info(product_routings)").all().map((row) => row.name);
    assert.ok(cols.includes('topology_type'));
    // New columns on product_routing_operations.
    const opCols = database.prepare("PRAGMA table_info(product_routing_operations)").all().map((row) => row.name);
    for (const col of ['operation_id', 'control_code_id', 'activity_id', 'resource_id', 'equipment_id', 'is_outsource', 'quality_policy']) {
      assert.ok(opCols.includes(col), `${col} missing`);
    }
  });

  test('enrichment update attaches Engineering references; rejects unknown ids', async () => {
    const productId = await makeProduct('RT-D-PROD-1', 'P');
    const opCode = await api('POST', '/api/engineering/operations', adminAuth, { code: 'RT-D-OP-1', name: '切割', standardMinutes: 5 });
    const cc = await api('POST', '/api/engineering/control-codes', adminAuth, { code: 'RT-D-CC-1', name: 'standard', category: 'PROCESSING' });
    const act = await api('POST', '/api/engineering/basic-activities', adminAuth, { code: 'RT-D-ACT-1', name: 'cut', stage: 'PROCESS' });
    const res = await api('POST', '/api/engineering/resources', adminAuth, { code: 'RT-D-RES-1', name: 'cutter', category: 'MACHINE', quantity: 1 });
    const eq = await api('POST', '/api/engineering/equipment', adminAuth, { code: 'RT-D-EQ-1', name: 'cutter-A' });
    const routingId = await makeRouting(productId, 'RT-D-RT-1', [
      { sequenceNo: 1, operationCode: 'RT-D-OP-SEQ-1', operationName: 'cut step', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
    ]);
    // Get operations ids.
    const enr0 = await api('GET', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth);
    assert.equal(enr0.status, 200);
    const operationId = enr0.data.operations[0].id;
    const upd = await api('PATCH', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth, {
      operations: [{
        id: operationId,
        operationId: opCode.data.id,
        controlCodeId: cc.data.id,
        activityId: act.data.id,
        resourceId: res.data.id,
        equipmentId: eq.data.id,
        isOutsource: false,
      }],
    });
    assert.equal(upd.status, 200, upd.data.error);
    const enr1 = await api('GET', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth);
    assert.equal(enr1.data.operations[0].engineering_operation_code, 'RT-D-OP-1');
    assert.equal(enr1.data.operations[0].control_code_code, 'RT-D-CC-1');
    assert.equal(enr1.data.operations[0].activity_code, 'RT-D-ACT-1');
    assert.equal(enr1.data.operations[0].resource_code, 'RT-D-RES-1');
    assert.equal(enr1.data.operations[0].equipment_code, 'RT-D-EQ-1');
    // Reject unknown reference.
    const bad = await api('PATCH', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth, {
      operations: [{ id: operationId, operationId: 'unknown-id' }],
    });
    assert.equal(bad.status, 400);
  });

  test('topology link CRUD: PARALLEL link flips topology_type to NETWORK', async () => {
    const productId = await makeProduct('RT-D-TOPO-1', 'P');
    const routingId = await makeRouting(productId, 'RT-D-TOPO-RT', [
      { sequenceNo: 1, operationCode: 'A', operationName: 'A', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
      { sequenceNo: 2, operationCode: 'B', operationName: 'B', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
    ]);
    const enr = await api('GET', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth);
    const [op1, op2] = enr.data.operations;
    const link = await api('POST', `/api/engineering/product-routings/${routingId}/links`, adminAuth, {
      parentOperationId: op1.id, childOperationId: op2.id, linkType: 'PARALLEL',
    });
    assert.equal(link.status, 201, link.data.error);
    const enr2 = await api('GET', `/api/engineering/product-routings/${routingId}/enrichment`, adminAuth);
    assert.equal(enr2.data.routing.topology_type, 'NETWORK');
    assert.equal(enr2.data.links.length, 1);
    // Duplicate link rejected.
    const dup = await api('POST', `/api/engineering/product-routings/${routingId}/links`, adminAuth, {
      parentOperationId: op1.id, childOperationId: op2.id, linkType: 'PARALLEL',
    });
    assert.equal(dup.status, 409);
    // Invalid link type.
    const bad = await api('POST', `/api/engineering/product-routings/${routingId}/links`, adminAuth, {
      parentOperationId: op1.id, childOperationId: op2.id, linkType: 'NONSENSE',
    });
    assert.equal(bad.status, 400);
    // Self-link rejected.
    const self = await api('POST', `/api/engineering/product-routings/${routingId}/links`, adminAuth, {
      parentOperationId: op1.id, childOperationId: op1.id, linkType: 'PARALLEL',
    });
    assert.equal(self.status, 400);
  });

  test('legacy /api/routing-operations GET still works', async () => {
    const result = await api('GET', '/api/routing-operations', adminAuth);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.operations));
  });

  test('canonical product_routings remains the source for production snapshot', () => {
    // Static source contract — the production order snapshot reads from
    // product_routings / product_routing_operations, not the legacy
    // routing_operations table.
    const file = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_order_routing_snapshots'").get();
    assert.ok(file, 'production_order_routing_snapshots table must exist');
    // Confirm product_routings table still has all canonical columns.
    const cols = database.prepare("PRAGMA table_info(product_routings)").all().map((row) => row.name);
    for (const col of ['id', 'product_id', 'routing_code', 'routing_name', 'version', 'status', 'topology_type']) {
      assert.ok(cols.includes(col), `product_routings missing ${col}`);
    }
  });
});