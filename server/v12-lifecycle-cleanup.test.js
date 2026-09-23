import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { analyzeLifecycleGraph, cleanupLifecycleGraph } from './modules/lifecycle-engine.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let accountingToken;
let sequence = 0;
const stamp = '2026-09-21T08:00:00.000Z';

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

function seedPurchaseChain() {
  const suffix = ++sequence;
  const runId = `v12-clean-run-${suffix}`;
  const instructionId = `v12-clean-pui-${suffix}`;
  const requisitionId = `v12-clean-preq-${suffix}`;
  const purchaseOrderId = `v12-clean-po-${suffix}`;
  insert('mrp_runs', {
    id: runId, run_code: `MRP-CLEAN-${suffix}`, run_name: '错误测试链', horizon_start: '2026-09-01', horizon_end: '2026-09-30',
    demand_source_mode: 'SALES_ORDERS', status: 'COMPLETED', created_by: 'user-admin', created_at: stamp, updated_at: stamp,
  });
  insert('purchase_orders', {
    id: purchaseOrderId, order_no: `PO-CLEAN-${suffix}`, supplier_id: 'supplier-001', status: 'DRAFT', total_cents: 0,
    creator_id: 'user-admin', created_at: stamp, updated_at: stamp,
  });
  insert('purchase_instructions', {
    id: instructionId, instruction_no: `PUI-CLEAN-${suffix}`, mrp_run_id: runId, status: 'RELEASED', planned_date: '2026-09-22',
    created_by: 'user-admin', created_at: stamp, updated_at: stamp,
  });
  insert('purchase_requisitions', {
    id: requisitionId, requisition_no: `PREQ-CLEAN-${suffix}`, source_instruction_id: instructionId, status: 'DRAFT',
    purchase_order_id: purchaseOrderId, creator_id: 'user-admin', created_at: stamp, updated_at: stamp,
  });
  return { instructionId, requisitionId, purchaseOrderId };
}

async function createConfirmedReceipt(quantity, receiptDate = '2026-09-21') {
  const before = Number(database.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get()?.quantity || 0);
  const suffix = ++sequence;
  const poId = `v12-receipt-po-${suffix}`;
  const poItemId = `v12-receipt-poi-${suffix}`;
  insert('purchase_orders', { id: poId, order_no: `PO-RECEIPT-${suffix}`, supplier_id: 'supplier-001', status: 'APPROVED', total_cents: quantity * 200, creator_id: 'user-admin', created_at: stamp, updated_at: stamp });
  insert('purchase_order_items', { id: poItemId, order_id: poId, product_id: 'product-001', quantity, unit_price_cents: 200, amount_cents: quantity * 200, line_no: 1 });
  const create = await request('/api/purchase-receipts', { method: 'POST', body: {
    purchaseOrderId: poId, supplierId: 'supplier-001', warehouseId: 'warehouse-001', receiptDate,
    remark: 'V1.2 lifecycle isolated fixture', items: [{ purchaseOrderItemId: poItemId, productId: 'product-001', quantity, unitPriceCents: 200 }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const quality = await request('/api/iqc', { method: 'POST', body: { purchase_receipt_id: create.data.id } });
  assert.equal(quality.status, 201, JSON.stringify(quality.data));
  const completeQuality = await request(`/api/iqc/${quality.data.id}/complete`, { method: 'POST', body: { result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0 } });
  assert.equal(completeQuality.status, 200, JSON.stringify(completeQuality.data));
  const confirm = await request(`/api/purchase-receipts/${create.data.id}`, { method: 'POST', body: { action: 'confirm' } });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
  return { id: create.data.id, before };
}

async function createConsumedProductionFlow(quantity) {
  const suffix = ++sequence;
  const orderId = `v12-mo-${suffix}`;
  insert('production_orders', {
    id: orderId, order_no: `MO-V12-${suffix}`, product_id: 'product-002', quantity: 1, status: 'IN_PROGRESS',
    creator_id: 'user-admin', created_at: stamp, updated_at: stamp,
  });
  insert('production_order_items', {
    id: `v12-moi-${suffix}`, order_id: orderId, product_id: 'product-001', quantity,
    consumed_quantity: 0, line_no: 1, quantity_per_unit: quantity,
  });
  const issue = await request('/api/production-material-issues', { method: 'POST', body: {
    productionOrderId: orderId, warehouseId: 'warehouse-001', issueDate: '2026-09-21',
    items: [{ productId: 'product-001', plannedQuantity: quantity, issueQuantity: quantity }],
  } });
  assert.equal(issue.status, 201, JSON.stringify(issue.data));
  const confirm = await request(`/api/production-material-issues/${issue.data.id}/confirm`, { method: 'POST', body: {} });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
  database.prepare("UPDATE inventory_transactions SET created_at='2026-09-21T23:59:59.000Z' WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_id=?").run(issue.data.id);
  return { orderId, issueId: issue.data.id };
}

function cleanupBody(entityType, entityId, extra = {}) {
  return { entityType, entityId, reason: '隔离测试错误业务', confirm: true, ...extra };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v12-lifecycle-cleanup-'));
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

describe('V1.2 simple and non-effective lifecycle cleanup', () => {
  test('simple bad draft deletes directly and leaves permanent structured cleanup audit', async () => {
    insert('sales_orders', {
      id: 'v12-clean-so', order_no: 'SO-V12-CLEAN', customer_id: 'customer-001', status: 'DRAFT', total_cents: 0,
      creator_id: 'user-admin', created_at: stamp, updated_at: stamp,
    });
    const result = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('SALES_ORDER', 'v12-clean-so') });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.classification, 'SAFE_DELETE');
    assert.equal(database.prepare("SELECT 1 FROM sales_orders WHERE id='v12-clean-so'").get(), undefined);
    const event = database.prepare('SELECT * FROM cleanup_events WHERE id=?').get(result.data.cleanupEventId);
    assert.equal(event.root_document_no, 'SO-V12-CLEAN');
    assert.equal(event.reason, '隔离测试错误业务');
    assert.equal(event.success_state, 'SUCCEEDED');
    assert.equal(database.prepare('SELECT COUNT(*) n FROM cleanup_event_items WHERE cleanup_event_id=?').get(event.id).n, 1);
  });

  test('instruction -> requisition -> draft PO deletes as one atomic chain', async () => {
    const chain = seedPurchaseChain();
    const result = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_INSTRUCTION', chain.instructionId) });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.classification, 'SAFE_CHAIN_DELETE');
    assert.equal(result.data.affectedRecords, 3);
    assert.equal(database.prepare('SELECT 1 FROM purchase_instructions WHERE id=?').get(chain.instructionId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM purchase_requisitions WHERE id=?').get(chain.requisitionId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM purchase_orders WHERE id=?').get(chain.purchaseOrderId), undefined);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM cleanup_event_items WHERE cleanup_event_id=?').get(result.data.cleanupEventId).n, 3);
  });

  test('approved purchase order with no stock or finance effect is not treated as effective', () => {
    insert('purchase_orders', {
      id: 'v12-approved-po', order_no: 'PO-V12-APPROVED', supplier_id: 'supplier-001', status: 'APPROVED', total_cents: 0,
      creator_id: 'user-admin', reviewer_id: 'user-reviewer', created_at: stamp, updated_at: stamp,
    });
    const graph = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_ORDER', entityId: 'v12-approved-po' });
    assert.equal(graph.root.effective, false);
    assert.equal(graph.classification, 'SAFE_DELETE');
  });

  test('non-admin cleanup and missing destructive confirmation are rejected', async () => {
    assert.equal((await request('/api/lifecycle/cleanup', { token: accountingToken, method: 'POST', body: cleanupBody('PURCHASE_ORDER', 'v12-approved-po') })).status, 403);
    const missing = await request('/api/lifecycle/cleanup', { method: 'POST', body: { entityType: 'PURCHASE_ORDER', entityId: 'v12-approved-po', reason: 'test' } });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.details.code, 'CLEANUP_CONFIRMATION_REQUIRED');
  });
});

describe('V1.2 effective purchase chain reversal safety', () => {
  test('confirmed purchase receipt reverses stock + AP + balanced voucher atomically', async () => {
    const receipt = await createConfirmedReceipt(70);
    const beforeEffects = {
      ap: database.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      voucher: database.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
    };
    assert.deepEqual(beforeEffects, { ap: 1, voucher: 1 });
    const analysis = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_RECEIPT', entityId: receipt.id });
    assert.equal(analysis.classification, 'SAFE_REVERSAL_CLEANUP');
    const result = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id) });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.classification, 'SAFE_REVERSAL_CLEANUP');
    assert.equal(database.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity, receipt.before);
    assert.equal(database.prepare('SELECT 1 FROM purchase_receipts WHERE id=?').get(receipt.id), undefined);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n, 0);
    assert.ok(database.prepare('SELECT 1 FROM cleanup_events WHERE id=?').get(result.data.cleanupEventId));
  });

  test('partial cleanup is blocked after valid production consumed stock', async () => {
    const receipt = await createConfirmedReceipt(70);
    const flow = await createConsumedProductionFlow(30);
    const analysis = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_RECEIPT', entityId: receipt.id });
    assert.equal(analysis.classification, 'BLOCKED');
    assert.ok(analysis.blockers.some((item) => item.code === 'EXTERNAL_DEPENDENCY'));
    assert.ok(analysis.nodes.some((node) => node.entityId === flow.issueId && node.selectedForCleanup === false));
    const blocked = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id) });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.details.code, 'LIFECYCLE_CLEANUP_BLOCKED');
    assert.ok(database.prepare('SELECT 1 FROM purchase_receipts WHERE id=?').get(receipt.id));

    const expanded = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_RECEIPT', entityId: receipt.id, includeExternal: true });
    assert.equal(expanded.classification, 'SAFE_REVERSAL_CLEANUP');
    assert.ok(expanded.nodes.some((node) => node.entityId === flow.orderId && node.selectedForCleanup));
    const cleaned = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id, { includeExternal: true }) });
    assert.equal(cleaned.status, 200, JSON.stringify(cleaned.data));
    assert.equal(database.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity, receipt.before);
    assert.equal(database.prepare('SELECT 1 FROM production_material_issues WHERE id=?').get(flow.issueId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM production_orders WHERE id=?').get(flow.orderId), undefined);
  });

  test('closed inventory period blocks cleanup until explicitly reopened', async () => {
    const receipt = await createConfirmedReceipt(10, '2026-08-15');
    insert('inventory_period_closures', {
      id: 'v12-closed-period', period_key: '2026-08', status: 'CLOSED', closed_by: 'user-admin', closed_at: stamp,
    });
    const analysis = analyzeLifecycleGraph(database, { entityType: 'PURCHASE_RECEIPT', entityId: receipt.id });
    assert.equal(analysis.classification, 'BLOCKED');
    assert.ok(analysis.blockers.some((item) => item.code === 'CLOSED_PERIOD'));
    assert.equal((await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id) })).status, 409);
    database.prepare("UPDATE inventory_period_closures SET status='REOPENED',reopened_by='user-admin',reopened_at=? WHERE id='v12-closed-period'").run(stamp);
    assert.equal(analyzeLifecycleGraph(database, { entityType: 'PURCHASE_RECEIPT', entityId: receipt.id }).classification, 'SAFE_REVERSAL_CLEANUP');
    assert.equal((await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id) })).status, 200);
  });

  test('forced failure after reversal work rolls back documents, effects, balances and audit event', async () => {
    const receipt = await createConfirmedReceipt(12);
    const actor = database.prepare(`
      SELECT u.id,u.username,u.display_name displayName,r.id roleId,r.name roleName,r.code roleCode
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id='user-admin'
    `).get();
    actor.permissions = database.prepare("SELECT permission_code code FROM role_permissions WHERE role_id='role-admin'").all().map((row) => row.code);
    const before = {
      quantity: database.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity,
      tx: database.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      ap: database.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      voucher: database.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      events: database.prepare('SELECT COUNT(*) n FROM cleanup_events').get().n,
    };
    assert.throws(() => cleanupLifecycleGraph(database, actor, cleanupBody('PURCHASE_RECEIPT', receipt.id), { failAfterEffects: true }), /SIMULATED_LIFECYCLE_FAILURE/);
    assert.ok(database.prepare('SELECT 1 FROM purchase_receipts WHERE id=?').get(receipt.id));
    assert.deepEqual({
      quantity: database.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity,
      tx: database.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      ap: database.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      voucher: database.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receipt.id).n,
      events: database.prepare('SELECT COUNT(*) n FROM cleanup_events').get().n,
    }, before);
    const final = await request('/api/lifecycle/cleanup', { method: 'POST', body: cleanupBody('PURCHASE_RECEIPT', receipt.id) });
    assert.equal(final.status, 200, JSON.stringify(final.data));
  });

  test('database integrity remains valid after all lifecycle cases', () => {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  });
});
