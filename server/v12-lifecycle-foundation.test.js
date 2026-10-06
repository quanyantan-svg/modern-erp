import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { APPROVAL_DOCUMENT_TYPES } from './modules/approvals.js';
import { analyzeLifecycleGraph, LIFECYCLE_CLASSIFICATIONS } from './modules/lifecycle-engine.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let accountingToken;
const now = '2026-09-21T08:00:00.000Z';

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.token;
}

function insert(table, values) {
  const columns = Object.keys(values);
  database.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(values));
}

function seedDraftPurchaseChain(suffix = 'foundation') {
  const poId = `v12-po-${suffix}`;
  const reqId = `v12-preq-${suffix}`;
  const instructionId = `v12-pui-${suffix}`;
  const runId = `v12-run-${suffix}`;
  insert('mrp_runs', {
    id: runId, run_code: `MRP-V12-${suffix}`, run_name: 'V1.2 lifecycle', horizon_start: '2026-09-01', horizon_end: '2026-09-30',
    demand_source_mode: 'SALES_ORDERS', status: 'COMPLETED', created_by: 'user-admin', created_at: now, updated_at: now,
  });
  insert('purchase_orders', {
    id: poId, order_no: `PO-V12-${suffix}`, supplier_id: 'supplier-001', status: 'DRAFT', total_cents: 0,
    creator_id: 'user-admin', created_at: now, updated_at: now,
  });
  insert('purchase_instructions', {
    id: instructionId, instruction_no: `PUI-V12-${suffix}`, mrp_run_id: runId, status: 'RELEASED', planned_date: '2026-09-22',
    created_by: 'user-admin', created_at: now, updated_at: now,
  });
  insert('purchase_requisitions', {
    id: reqId, requisition_no: `PREQ-V12-${suffix}`, source_instruction_id: instructionId, status: 'DRAFT', purchase_order_id: poId,
    creator_id: 'user-admin', created_at: now, updated_at: now,
  });
  return { runId, instructionId, reqId, poId };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v12-lifecycle-foundation-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V1.2 lifecycle schema foundation', () => {
  test('additive centralized metadata tables exist and startup is idempotent', () => {
    for (const table of ['lifecycle_archives', 'cleanup_events', 'cleanup_event_items']) {
      assert.equal(database.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1);
    }
    const reopened = createDatabase(join(tempDir, 'erp.db'));
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    reopened.close();
  });

  test('permission, role and approval contracts remain unchanged', () => {
    assert.equal(PERMISSIONS.length, 110);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM roles').get().n, 5);
    assert.deepEqual(APPROVAL_DOCUMENT_TYPES, ['SALES_ORDER', 'PURCHASE_ORDER', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PURCHASE_REQUISITION']);
    assert.deepEqual(LIFECYCLE_CLASSIFICATIONS, ['SAFE_DELETE', 'SAFE_CHAIN_DELETE', 'SAFE_REVERSAL_CLEANUP', 'ARCHIVE_ONLY', 'BLOCKED']);
  });
});

describe('V1.2 dependency analyzer and archive foundation', () => {
  test('a standalone draft is SAFE_DELETE with structured node fields', () => {
    insert('sales_orders', {
      id: 'v12-so-draft', order_no: 'SO-V12-DRAFT', customer_id: 'customer-001', status: 'DRAFT', total_cents: 0,
      creator_id: 'user-admin', created_at: now, updated_at: now,
    });
    const graph = analyzeLifecycleGraph(database, { entityType: 'SALES_ORDER', entityId: 'v12-so-draft' });
    assert.equal(graph.classification, 'SAFE_DELETE');
    assert.equal(graph.nodes.length, 1);
    assert.deepEqual(Object.keys(graph.root).sort(), [
      'archived', 'documentNo', 'effective', 'entityId', 'entityType', 'externalDependency', 'financialEffect', 'inventoryEffect',
      'key', 'label', 'period', 'periodClosed', 'relationship', 'selectedForCleanup', 'status',
    ].sort());
  });

  test('instruction -> requisition -> draft PO is a selected SAFE_CHAIN_DELETE graph', () => {
    const chain = seedDraftPurchaseChain();
    const graph = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_INSTRUCTION', entityId: chain.instructionId });
    assert.equal(graph.classification, 'SAFE_CHAIN_DELETE');
    assert.deepEqual(graph.nodes.filter((node) => node.selectedForCleanup).map((node) => node.entityType).sort(), [
      'PURCHASE_INSTRUCTION', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION',
    ]);
    assert.ok(graph.edges.some((edge) => edge.relationship === 'GENERATED'));
  });

  test('analysis/archive/restore are admin-only and archive never changes business effects', async () => {
    const before = {
      inventory: database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
      ar: database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n,
      ap: database.prepare('SELECT COUNT(*) n FROM account_payables').get().n,
      vouchers: database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n,
    };
    assert.equal((await request('/api/lifecycle/analyze?entityType=SALES_ORDER&entityId=v12-so-draft', { token: accountingToken })).status, 403);
    const analysis = await request('/api/lifecycle/analyze?entityType=SALES_ORDER&entityId=v12-so-draft');
    assert.equal(analysis.status, 200);
    assert.equal(analysis.data.graph.classification, 'SAFE_DELETE');

    assert.equal((await request('/api/lifecycle/archive', { token: accountingToken, method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'v12-so-draft' } })).status, 403);
    assert.equal((await request('/api/lifecycle/archive', { method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'v12-so-draft', reason: '测试记录' } })).status, 200);
    assert.equal(database.prepare("SELECT active FROM lifecycle_archives WHERE entity_type='SALES_ORDER' AND entity_id='v12-so-draft'").get().active, 1);
    assert.equal((await request('/api/lifecycle/restore', { method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'v12-so-draft' } })).status, 200);
    assert.equal(database.prepare("SELECT active FROM lifecycle_archives WHERE entity_type='SALES_ORDER' AND entity_id='v12-so-draft'").get().active, 0);
    assert.deepEqual({
      inventory: database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
      ar: database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n,
      ap: database.prepare('SELECT COUNT(*) n FROM account_payables').get().n,
      vouchers: database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n,
    }, before);
  });
});
