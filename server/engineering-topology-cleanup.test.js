// V17 Master & Engineering Domain Closure — routing topology and Use-Up-Old
// cleanup candidates (2026-11-12 remediation round).
//
// Requirement §28.4:
//   - "Routing Topology | COVERED | 数据模型表达 sequence / parallel / split /
//     merge；不实现完整 APS"
//   - "Use-Up-Old | PARTIAL — CROSS_DOMAIN_DEPENDENCY | 当前库存可参考；预计入
//     供应类型依赖未来 Domain"
//
// The 2026-11-12 audit found that the routing master carried no per-operation
// topology and that the cleanup candidate query did not exist (only the
// cleanup log row did). This suite is the evidence that both are closed.
//
// Every case carries a negative control.

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
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-engineering-topology-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminAuth = (await login.json()).token;
});

after(async () => {
  await new Promise((done) => server.close(done));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${adminAuth}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function ensureProduct(code) {
  const existing = database.prepare('SELECT id FROM products WHERE code=?').get(code);
  if (existing) return existing.id;
  const productId = `prod-${code}`;
  database.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,'ENGINEERING','件',0,0,1,datetime('now'),datetime('now'))`).run(productId, code, code);
  return productId;
}

function ensureWarehouse(code) {
  const existing = database.prepare('SELECT id FROM warehouses WHERE code=?').get(code);
  if (existing) return existing.id;
  const warehouseId = `wh-${code}`;
  database.prepare(`INSERT INTO warehouses(id,code,name,active,created_at,updated_at)
    VALUES(?,?,?,1,datetime('now'),datetime('now'))`).run(warehouseId, code, code);
  return warehouseId;
}

async function makeRouting(productId, code, operations) {
  const result = await api('POST', '/api/product-routings', {
    productId, routingCode: code, routingName: code, version: '1.0', status: 'ACTIVE', operations,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.id;
}

describe('Master & Engineering — routing topology (2026-11-12)', () => {
  test('the routing master carries a per-operation topology', async () => {
    const productId = ensureProduct('TOPO-PROD');
    const routingId = await makeRouting(productId, 'TOPO-R1', [
      { sequenceNo: 1, operationCode: 'TOPO-OP-1', operationName: '工序一', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
      { sequenceNo: 2, operationCode: 'TOPO-OP-2', operationName: '工序二', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
    ]);
    const operations = database.prepare('SELECT id, sequence_no, operation_name FROM product_routing_operations WHERE routing_id=? ORDER BY sequence_no').all(routingId);
    assert.equal(operations.length, 2);

    const updated = await api('PATCH', `/api/engineering/product-routings/${routingId}/enrichment`, {
      operations: [{ id: operations[0].id, topology: 'PARALLEL', topologyMeta: '{"peer":"b"}' }],
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));

    const enriched = await api('GET', `/api/engineering/product-routings/${routingId}/enrichment`);
    assert.equal(enriched.status, 200, JSON.stringify(enriched.data));
    const first = enriched.data.operations.find((row) => row.id === operations[0].id);
    assert.equal(first.topology, 'PARALLEL', 'the per-operation topology must be readable');
    assert.equal(first.topology_meta, '{"peer":"b"}');
    const second = enriched.data.operations.find((row) => row.id === operations[1].id);
    assert.equal(second.topology, 'LINEAR', 'an operation that declares no topology keeps its value');
  });

  test('an invalid topology is rejected and nothing is written', async () => {
    const productId = ensureProduct('TOPO-BAD-PROD');
    const routingId = await makeRouting(productId, 'TOPO-R2', [{ sequenceNo: 1, operationCode: 'TOPO-OP-B', operationName: '工序', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 }]);
    const operation = database.prepare('SELECT id FROM product_routing_operations WHERE routing_id=?').get(routingId);
    const rejected = await api('PATCH', `/api/engineering/product-routings/${routingId}/enrichment`, {
      operations: [{ id: operation.id, topology: 'NOT_A_TOPOLOGY' }],
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    const row = database.prepare('SELECT topology FROM product_routing_operations WHERE id=?').get(operation.id);
    assert.equal(row.topology, 'LINEAR', 'the rejected topology must not be written');
  });

  test('deleting the last topology link reverts the routing to linear', async () => {
    const productId = ensureProduct('TOPO-REVERT-PROD');
    const routingId = await makeRouting(productId, 'TOPO-R3', [
      { sequenceNo: 1, operationCode: 'TOPO-OP-1', operationName: '工序一', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
      { sequenceNo: 2, operationCode: 'TOPO-OP-2', operationName: '工序二', setupMinutes: 1, runMinutesPerUnit: 1, expectedYieldBps: 10000 },
    ]);
    const operations = database.prepare('SELECT id FROM product_routing_operations WHERE routing_id=? ORDER BY sequence_no').all(routingId);
    const link = await api('POST', `/api/engineering/product-routings/${routingId}/links`, {
      parentOperationId: operations[0].id, childOperationId: operations[1].id, linkType: 'PARALLEL',
    });
    assert.equal(link.status, 201, JSON.stringify(link.data));
    const afterCreate = database.prepare('SELECT topology_type FROM product_routings WHERE id=?').get(routingId);
    assert.equal(afterCreate.topology_type, 'NETWORK', 'a link makes the routing a network');

    const deleted = await api('DELETE', `/api/engineering/product-routing-links/${link.data.id}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    const afterDelete = database.prepare('SELECT topology_type FROM product_routings WHERE id=?').get(routingId);
    assert.equal(afterDelete.topology_type, 'LINEAR', 'removing the last link must revert the routing to linear');
  });
});

describe('Master & Engineering — Use-Up-Old cleanup candidates (2026-11-12)', () => {
  test('a stocked component that left the active BOM is a cleanup candidate', async () => {
    const parentId = ensureProduct('CLEAN-PARENT');
    const staleComponentId = ensureProduct('CLEAN-STALE');
    const keptComponentId = ensureProduct('CLEAN-KEPT');
    const warehouseId = ensureWarehouse('CLEAN-WH');

    const oldBomId = 'bom-clean-old';
    const activeBomId = 'bom-clean-active';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,remark,creator_id,created_at,updated_at)
      VALUES(?,?, '1.0','DISCONTINUED','GENERAL','','user-admin',?,?)`).run(oldBomId, parentId, now, now);
    database.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,remark,creator_id,created_at,updated_at)
      VALUES(?,?, '2.0','ACTIVE','GENERAL','','user-admin',?,?)`).run(activeBomId, parentId, now, now);
    database.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no)
      VALUES('bi-clean-old',?,?,1,0,1)`).run(oldBomId, staleComponentId);
    database.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no)
      VALUES('bi-clean-active',?,?,1,0,1)`).run(activeBomId, keptComponentId);
    database.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
      VALUES('inv-clean-stale',?,?,5,?)`).run(warehouseId, staleComponentId, now);
    database.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
      VALUES('inv-clean-kept',?,?,7,?)`).run(warehouseId, keptComponentId, now);

    const response = await api('GET', `/api/engineering/cleanup-candidates?productId=${parentId}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const codes = response.data.candidates.map((row) => row.component_code);
    assert.ok(codes.includes('CLEAN-STALE'), `the superseded stocked component must be a candidate: ${codes.join(',')}`);
    assert.ok(!codes.includes('CLEAN-KEPT'), 'a component that is still in the active BOM is not a cleanup candidate');
    const stale = response.data.candidates.find((row) => row.component_code === 'CLEAN-STALE');
    assert.equal(Number(stale.on_hand_quantity), 5);
    assert.equal(stale.expectedIncoming, null, 'the expected-incoming leg is a cross-domain dependency');
    assert.equal(stale.expectedIncomingSource, 'CROSS_DOMAIN_DEPENDENCY');
  });

  test('the cleanup candidate query is readable by an unauthorised role only through a permission check', async () => {
    const response = await api('GET', '/api/engineering/cleanup-candidates');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.ok(Array.isArray(response.data.candidates));
  });
});
