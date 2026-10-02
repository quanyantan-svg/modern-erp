import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let server;
let baseUrl;
let db;
let tempDir;
let adminToken;
let sequence = 0;
const at = '2026-10-02T08:00:00.000Z';

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}

function seedRoutedOrder() {
  const n = ++sequence;
  const productId = `r6-fin-${n}`;
  const bomId = `r6-bom-${n}`;
  const bomItemId = `r6-bomi-${n}`;
  const routingId = `r6-rt-${n}`;
  const orderId = `r6-po-${n}`;
  const op10Id = `r6-op-${n}-10`;
  const op20Id = `r6-op-${n}-20`;
  const reqId = `r6-req-${n}`;
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,standard_manufacturing_cost_cents,active,created_at,updated_at) VALUES(?,?,?,'PCS',1000,500,1,?,?)").run(productId, `FIN-R6-${n}`, `成品R6-${n}`, at, at);
  db.prepare("INSERT INTO boms(id,product_id,version,status,creator_id,created_at,updated_at) VALUES(?,?,'1.0','ACTIVE','user-admin',?,?)").run(bomId, productId, at, at);
  db.prepare("INSERT INTO bom_items(id,bom_id,product_id,quantity,line_no) VALUES(?,?,?,1,1)").run(bomItemId, bomId, 'product-001');
  db.prepare("INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,created_at,updated_at) VALUES(?,?,?,?, '1.0','ACTIVE',?,?)").run(routingId, productId, `RT-R6-${n}`, `工艺路线R6-${n}`, at, at);
  db.prepare("INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,created_at,updated_at) VALUES(?,?,10,'OP10','组装','WC1',?,?)").run(`r6-rt-op-${n}-10`, routingId, at, at);
  db.prepare("INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,created_at,updated_at) VALUES(?,?,20,'OP20','终检','WC1',?,?)").run(`r6-rt-op-${n}-20`, routingId, at, at);
  db.prepare("INSERT INTO production_orders(id,order_no,product_id,bom_id,routing_id_snapshot,quantity,status,planned_start,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,10,'PENDING','2026-10-15','user-admin',?,?)").run(orderId, `PO-R6-${n}`, productId, bomId, routingId, at, at);
  db.prepare("INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at) VALUES(?,?,?,10,'OP10','组装','WC1',0,0,'',?)").run(`r6-rs-${n}-10`, orderId, routingId, at);
  db.prepare("INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at) VALUES(?,?,?,20,'OP20','终检','WC1',0,0,'',?)").run(`r6-rs-${n}-20`, orderId, routingId, at);
  db.prepare("INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,quantity_per_unit) VALUES(?,?,'product-001',10,0,1,1)").run(reqId, orderId);
  db.prepare("INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,created_at,updated_at) VALUES(?,?,?,10,'OP10','组装','WC1','WC1',0,0,10000,0,0,480,10,'2026-10-15','NOT_STARTED',?,?)").run(op10Id, orderId, `r6-rs-${n}-10`, at, at);
  db.prepare("INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,created_at,updated_at) VALUES(?,?,?,20,'OP20','终检','WC1','WC1',0,0,10000,0,0,480,10,'2026-10-16','NOT_STARTED',?,?)").run(op20Id, orderId, `r6-rs-${n}-20`, at, at);
  return { orderId, op10Id, op20Id, reqId };
}

function seedConfirmedIssue(orderId, reqId, qty = 10) {
  const issueId = `r6-mi-${++sequence}`;
  const issueItemId = `r6-mii-${sequence}`;
  db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,creator_id,created_at,updated_at) VALUES(?,?,?,'warehouse-001','CONFIRMED','2026-10-15','user-admin',?,?)").run(issueId, `MI-R6-${sequence}`, orderId, at, at);
  db.prepare("INSERT INTO production_material_issue_items(id,issue_id,requirement_line_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,'product-001',?,?,1)").run(issueItemId, issueId, reqId, qty, qty);
  return { issueId, issueItemId };
}

function seedConfirmedReceipt(orderId, qty = 10) {
  const receiptId = `r6-pr-${++sequence}`;
  db.prepare("INSERT INTO production_receipts(id,receipt_no,production_order_id,warehouse_id,quantity,status,receipt_date,creator_id,created_at,updated_at) VALUES(?,?,?,'warehouse-001',?,'CONFIRMED','2026-10-16','user-admin',?,?)").run(receiptId, `PROD-R6-${sequence}`, orderId, qty, at, at);
  return { receiptId };
}

async function reportAndConfirm(orderId, opId, qty = 10) {
  const created = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: opId, goodQuantity: qty, scrapQuantity: 0 } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const confirmed = await request(`/api/manufacturing/operation-reports/${created.data.id}/confirm`, { method: 'POST' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-uat-r6-prod-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
});

after(async () => {
  await new Promise((done) => server.close(() => done()));
  db.close();
});

describe('UAT-003 production order completion flow', () => {
  test('1. source contract: ProductionOrderModal exposes per-operation complete action', () => {
    const source = readFileSync(resolve('src/pages/manufacturing.jsx'), 'utf8');
    assert.match(source, /completeOperationAction/);
    assert.match(source, /\/api\/manufacturing\/operations\/\$\{operationId\}\/complete/);
    assert.match(source, /operationCanComplete/);
    assert.match(source, /op\.inputAvailable > 0 && op\.remainingUnprocessed === 0/);
    assert.match(source, /op\.remainingUnprocessed > 0/);
  });

  test('2. source contract: production order 完工 disabled with reason when operations are not done', () => {
    const source = readFileSync(resolve('src/pages/manufacturing.jsx'), 'utf8');
    assert.match(source, /canCompleteOrder\.ready/);
    assert.match(source, /canCompleteOrder\.reason/);
    assert.match(source, /工序 \$\{incomplete\.sequence_no\} · \$\{incomplete\.operation_name\} 尚未完成/);
  });

  test('3. source contract: completeOrder surfaces backend error as actionable notification', () => {
    const source = readFileSync(resolve('src/pages/manufacturing.jsx'), 'utf8');
    assert.match(source, /notify\(`无法完工：\$\{e\.message\}`, 'error'\)/);
  });

  test('4. routed order cannot complete before required operations complete', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 409, JSON.stringify(complete.data));
    assert.match(complete.data.message || '', /工序/);
  });

  test('5. operation completion is exposed and finalizes the operation after reporting', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    const op1Complete = await request(`/api/manufacturing/operations/${ctx.op10Id}/complete`, { method: 'POST' });
    assert.equal(op1Complete.status, 200, JSON.stringify(op1Complete.data));
    const op1 = db.prepare('SELECT status FROM production_order_operations WHERE id=?').get(ctx.op10Id);
    assert.equal(op1.status, 'COMPLETED');
  });

  test('6. sequential operation gating: operation 20 cannot complete before op 10 completes', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    const op2 = await request(`/api/manufacturing/operations/${ctx.op20Id}/complete`, { method: 'POST' });
    assert.equal(op2.status, 409, JSON.stringify(op2.data));
    assert.match(op2.data.message || '', /前工序/);
  });

  test('7. routed order can complete after all required operations complete', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op10Id}/complete`, { method: 'POST' });
    await reportAndConfirm(ctx.orderId, ctx.op20Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op20Id}/complete`, { method: 'POST' });
    seedConfirmedReceipt(ctx.orderId, 10);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 200, JSON.stringify(complete.data));
    const final = db.prepare('SELECT status FROM production_orders WHERE id=?').get(ctx.orderId);
    assert.equal(final.status, 'COMPLETED');
  });

  test('8. insufficient material still blocks completion', async () => {
    const ctx = seedRoutedOrder();
    db.prepare('DELETE FROM production_order_operations WHERE production_order_id=?').run(ctx.orderId);
    db.prepare('DELETE FROM production_order_routing_snapshots WHERE production_order_id=?').run(ctx.orderId);
    db.prepare("UPDATE production_orders SET status='IN_PROGRESS',routing_id_snapshot=NULL WHERE id=?").run(ctx.orderId);
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 5);
    seedConfirmedReceipt(ctx.orderId, 10);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 409, JSON.stringify(complete.data));
    assert.match(complete.data.message || '', /净领料/);
  });

  test('9. unresolved draft material issue blocks completion', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,creator_id,created_at,updated_at) VALUES(?,?,?,'warehouse-001','DRAFT','2026-10-15','user-admin',?,?)").run(`r6-mid-${++sequence}`, `MID-R6-${sequence}`, ctx.orderId, at, at);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op10Id}/complete`, { method: 'POST' });
    await reportAndConfirm(ctx.orderId, ctx.op20Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op20Id}/complete`, { method: 'POST' });
    seedConfirmedReceipt(ctx.orderId, 10);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 409, JSON.stringify(complete.data));
    assert.match(complete.data.message || '', /草稿/);
  });

  test('10. unresolved draft production receipt blocks completion', async () => {
    const ctx = seedRoutedOrder();
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    const start = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'start' } });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    await reportAndConfirm(ctx.orderId, ctx.op10Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op10Id}/complete`, { method: 'POST' });
    await reportAndConfirm(ctx.orderId, ctx.op20Id, 10);
    await request(`/api/manufacturing/operations/${ctx.op20Id}/complete`, { method: 'POST' });
    seedConfirmedReceipt(ctx.orderId, 10);
    db.prepare("INSERT INTO production_receipts(id,receipt_no,production_order_id,warehouse_id,quantity,status,receipt_date,creator_id,created_at,updated_at) VALUES(?,?,?,'warehouse-001',10,'DRAFT','2026-10-17','user-admin',?,?)").run(`r6-prd-${++sequence}`, `PRODD-${sequence}`, ctx.orderId, at, at);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 409, JSON.stringify(complete.data));
    assert.match(complete.data.message || '', /草稿/);
  });

  test('11. non-routed order completion remains unchanged', async () => {
    const ctx = seedRoutedOrder();
    db.prepare('DELETE FROM production_order_operations WHERE production_order_id=?').run(ctx.orderId);
    db.prepare('DELETE FROM production_order_routing_snapshots WHERE production_order_id=?').run(ctx.orderId);
    db.prepare("UPDATE production_orders SET status='IN_PROGRESS',routing_id_snapshot=NULL WHERE id=?").run(ctx.orderId);
    seedConfirmedIssue(ctx.orderId, ctx.reqId, 10);
    seedConfirmedReceipt(ctx.orderId, 10);
    const complete = await request(`/api/production-orders/${ctx.orderId}`, { method: 'POST', body: { action: 'complete' } });
    assert.equal(complete.status, 200, JSON.stringify(complete.data));
    assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(ctx.orderId).status, 'COMPLETED');
  });
});
