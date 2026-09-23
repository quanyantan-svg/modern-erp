import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { id } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { APPROVAL_DOCUMENT_TYPES } from './modules/approvals.js';
import { deriveProductionCost } from './modules/manufacturing-execution.js';

let handle; let db; let server; let baseUrl; let admin; let warehouse; let sales; let accounting;
async function request(path, { token = admin, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function login(username, password) { const result = await request('/api/auth/login', { token: null, method: 'POST', body: { username, password } }); return result.data.token; }

before(async () => {
  handle = createTempDb({ label: 'v13-p6c' }); db = handle.db;
  server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = await login('admin', 'admin123'); warehouse = await login('warehouse', 'warehouse123'); sales = await login('sales', 'sales123'); accounting = await login('accounting', 'accounting123');
  const now = new Date().toISOString();
  for (const [pid, code, cost] of [['p6c-fg','X100-FG',0],['p6c-pcb','X100-PCB',20000],['p6c-case','X100-CASE',8000],['p6c-psu','X100-PSU',12000]]) db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,standard_manufacturing_cost_cents) VALUES(?,?,?,'测试','件',0,0,1,?,?,?)").run(pid, code, code, now, now, cost);
  db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('p6c-wh','P6C-WH','6C仓','','',1,?,?)").run(now, now);
  db.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES('p6c-bom','p6c-fg','6C','ACTIVE','','user-admin',?,?)").run(now, now);
  for (const [n, pid] of [['pcb','p6c-pcb'],['case','p6c-case'],['psu','p6c-psu']]) db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)').run(`p6c-bi-${n}`, 'p6c-bom', pid, 1, n === 'pcb' ? 1 : n === 'case' ? 2 : 3);
  db.prepare("INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,active,created_at,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour) VALUES('p6c-wc','ASSY','装配中心','PRODUCTION',8,1,0,1,?,480,6000,3000)").run(now);
  db.prepare("INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,notes,created_at,updated_at) VALUES('p6c-route','p6c-fg','X100-R','X100路线','1','ACTIVE','',?,?)").run(now, now);
  for (const [seq, code, name, setup, run] of [[10,'CUT','备料',600,360],[20,'ASSY','装配',300,120],[30,'TEST','测试',0,60]]) db.prepare('INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,updated_at,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(`p6c-rop-${seq}`, 'p6c-route', seq, code, name, 'ASSY', setup / 60, run / 60, '', now, now, 'p6c-wc', setup, run, seq === 10 ? 9800 : 9900);
});
after(async () => { await new Promise((done) => server.close(done)); handle.cleanup(); });

let orderId; let operations;
describe('V1.3 Phase 6C manufacturing execution, yield, capacity and analytical cost', () => {
  test('schema, five roles and no production approval family remain canonical', () => {
    for (const table of ['production_order_operations','production_operation_reports','production_operation_report_reversals','production_cost_baselines','production_cost_summaries']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, 5);
    assert.deepEqual(APPROVAL_DOCUMENT_TYPES, ['SALES_ORDER','PURCHASE_ORDER','INVENTORY_CHECK','ACCOUNTING_VOUCHER','PURCHASE_REQUISITION']);
  });

  test('routing and work-center rates snapshot at start; baseline is integer cents and immutable', async () => {
    const created = await request('/api/production-orders', { method: 'POST', body: { productId: 'p6c-fg', bomId: 'p6c-bom', routingId: 'p6c-route', quantity: 100, plannedStart: '2026-09-24' } }); assert.equal(created.status, 200, created.data.error); orderId = created.data.id;
    assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } })).status, 200);
    operations = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? ORDER BY sequence_no').all(orderId); assert.equal(operations.length, 3); assert.equal(operations[0].labor_rate_cents_per_hour, 6000); assert.deepEqual(operations.map((x) => x.planned_date), ['2026-09-24','2026-09-25','2026-09-26']);
    const baseline = db.prepare('SELECT * FROM production_cost_baselines WHERE production_order_id=?').get(orderId); assert.equal(baseline.standard_material_cents, 4000000); assert.ok(Number.isInteger(baseline.standard_total_cents));
    db.prepare('UPDATE work_centers SET labor_rate_cents_per_hour=99999,daily_capacity_minutes=1 WHERE id=?').run('p6c-wc'); db.prepare('UPDATE products SET standard_manufacturing_cost_cents=1 WHERE id=?').run('p6c-pcb');
    assert.equal(db.prepare('SELECT labor_rate_cents_per_hour FROM production_order_operations WHERE id=?').get(operations[0].id).labor_rate_cents_per_hour, 6000); assert.equal(db.prepare('SELECT standard_material_cents FROM production_cost_baselines WHERE production_order_id=?').get(orderId).standard_material_cents, 4000000);
  });

  test('material support and linear downstream gates refuse excess with zero execution side effect', async () => {
    const now = new Date().toISOString();
    for (const [index, pid] of ['p6c-pcb','p6c-case','p6c-psu'].entries()) { const req = db.prepare('SELECT id FROM production_order_items WHERE order_id=? AND product_id=?').get(orderId, pid); db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at) VALUES(?,?,?,?, 'CONFIRMED','2026-09-24','','user-warehouse',?,?, 'user-warehouse',?)").run(`p6c-mi-${index}`, `P6C-MI-${index}`, orderId, 'p6c-wh', now, now, now); db.prepare('INSERT INTO production_material_issue_items(id,issue_id,product_id,planned_quantity,issue_quantity,line_no,requirement_line_id) VALUES(?,?,?,?,?,?,?)').run(`p6c-mii-${index}`, `p6c-mi-${index}`, pid, 100, 60, 1, req.id); }
    const draft = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: operations[0].id, goodQuantity: 59, scrapQuantity: 2, scrapReason: 'PROCESS_DEFECT' } }); assert.equal(draft.status, 201);
    const before = db.prepare("SELECT COUNT(*) n FROM production_operation_reports WHERE status='CONFIRMED'").get().n; const refused = await request(`/api/manufacturing/operation-reports/${draft.data.id}/confirm`, { method: 'POST' }); assert.equal(refused.status, 409); assert.equal(db.prepare("SELECT COUNT(*) n FROM production_operation_reports WHERE status='CONFIRMED'").get().n, before);
    await request(`/api/manufacturing/operation-reports/${draft.data.id}/cancel`, { method: 'POST' }); const valid = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: operations[0].id, goodQuantity: 58, scrapQuantity: 2, scrapReason: 'PROCESS_DEFECT' } }); assert.equal((await request(`/api/manufacturing/operation-reports/${valid.data.id}/confirm`, { method: 'POST' })).status, 200);
    const downstream = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: operations[1].id, goodQuantity: 59, scrapQuantity: 0 } }); assert.equal((await request(`/api/manufacturing/operation-reports/${downstream.data.id}/confirm`, { method: 'POST' })).status, 409);
    await request(`/api/manufacturing/operation-reports/${downstream.data.id}/cancel`, { method: 'POST' });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type LIKE 'PRODUCTION_OPERATION%'").get().n, 0);
  });

  test('confirmed reports are immutable in effect, idempotent and dependency-safe on reversal', async () => {
    const op2 = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: operations[1].id, goodQuantity: 57, scrapQuantity: 1, scrapReason: 'QUALITY_FAILURE', laborSeconds: 3600, machineSeconds: 3600 } });
    const first = await request(`/api/manufacturing/operation-reports/${op2.data.id}/confirm`, { method: 'POST', headers: { 'idempotency-key': 'p6c-op2-confirm' } }); assert.equal(first.status, 200); const retry = await request(`/api/manufacturing/operation-reports/${op2.data.id}/confirm`, { method: 'POST', headers: { 'idempotency-key': 'p6c-op2-confirm' } }); assert.equal(retry.status, 200); assert.equal(db.prepare("SELECT COUNT(*) n FROM production_operation_reports WHERE id=? AND status='CONFIRMED'").get(op2.data.id).n, 1);
    const blocked = await request(`/api/manufacturing/operation-reports/${db.prepare("SELECT id FROM production_operation_reports WHERE production_operation_id=? AND status='CONFIRMED'").get(operations[0].id).id}/reverse`, { method: 'POST', headers: { 'idempotency-key': 'p6c-up-rev' }, body: { goodQuantity: 2, scrapQuantity: 0, laborSeconds: 0, machineSeconds: 0, reason: '上游更正' } }); assert.equal(blocked.status, 409);
    const reversed = await request(`/api/manufacturing/operation-reports/${op2.data.id}/reverse`, { method: 'POST', headers: { 'idempotency-key': 'p6c-op2-rev' }, body: { goodQuantity: 2, scrapQuantity: 0, laborSeconds: 600, machineSeconds: 600, reason: '报工更正' } }); assert.equal(reversed.status, 200); assert.equal(db.prepare('SELECT COUNT(*) n FROM production_operation_report_reversals WHERE original_report_id=?').get(op2.data.id).n, 1);
  });

  test('routed 100 → good 97 + scrap 3 → receipt 97 completes with no completion stock effect', async () => {
    const now = new Date().toISOString();
    for (const [index, pid] of ['p6c-pcb','p6c-case','p6c-psu'].entries()) { const req = db.prepare('SELECT id FROM production_order_items WHERE order_id=? AND product_id=?').get(orderId, pid); db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at) VALUES(?,?,?,?, 'CONFIRMED','2026-09-24','','user-warehouse',?,?, 'user-warehouse',?)").run(`p6c-mi-rest-${index}`, `P6C-MI-REST-${index}`, orderId, 'p6c-wh', now, now, now); db.prepare('INSERT INTO production_material_issue_items(id,issue_id,product_id,planned_quantity,issue_quantity,line_no,requirement_line_id) VALUES(?,?,?,?,?,?,?)').run(`p6c-mii-rest-${index}`, `p6c-mi-rest-${index}`, pid, 100, 40, 1, req.id); }
    const reportAndConfirm = async (operationId, goodQuantity, scrapQuantity, suffix) => { const draft = await request('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: orderId, productionOperationId: operationId, goodQuantity, scrapQuantity, scrapReason: scrapQuantity ? 'PROCESS_DEFECT' : null, laborSeconds: 3600, machineSeconds: 3600 } }); assert.equal(draft.status, 201, draft.data.error); const confirmed = await request(`/api/manufacturing/operation-reports/${draft.data.id}/confirm`, { method: 'POST', headers: { 'idempotency-key': `p6c-${suffix}` } }); assert.equal(confirmed.status, 200, confirmed.data.error); };
    await reportAndConfirm(operations[0].id, 40, 0, 'op1-rest'); assert.equal((await request(`/api/manufacturing/operations/${operations[0].id}/complete`, { method: 'POST' })).status, 200);
    await reportAndConfirm(operations[1].id, 42, 0, 'op2-rest'); assert.equal((await request(`/api/manufacturing/operations/${operations[1].id}/complete`, { method: 'POST' })).status, 200);
    await reportAndConfirm(operations[2].id, 97, 0, 'op3'); assert.equal((await request(`/api/manufacturing/operations/${operations[2].id}/complete`, { method: 'POST' })).status, 200);
    const overReceipt = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'p6c-wh', quantity: 98 } }); assert.equal((await request(`/api/production-receipts/${overReceipt.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 409);
    await request(`/api/production-receipts/${overReceipt.data.id}/cancel`, { token: warehouse, method: 'POST' });
    const receipt = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'p6c-wh', quantity: 97 } }); assert.equal((await request(`/api/production-receipts/${receipt.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200);
    const txBefore = db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n; const completed = await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } }); assert.equal(completed.status, 200, completed.data.error); assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, txBefore); assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId).status, 'COMPLETED');
    const finalReport = db.prepare("SELECT id FROM production_operation_reports WHERE production_operation_id=? AND status='CONFIRMED'").get(operations[2].id); const lateReverse = await request(`/api/manufacturing/operation-reports/${finalReport.id}/reverse`, { method: 'POST', headers: { 'idempotency-key': 'p6c-late-reverse' }, body: { goodQuantity: 1, scrapQuantity: 0, laborSeconds: 0, machineSeconds: 0, reason: '完工后错误冲销' } }); assert.equal(lateReverse.status, 409);
    const summary = db.prepare('SELECT * FROM production_cost_summaries WHERE production_order_id=?').get(orderId); assert.equal(summary.status, 'FINAL'); assert.equal(summary.good_quantity, 97); assert.equal(summary.scrap_quantity, 3); assert.equal(summary.yield_bps, 9700); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type LIKE 'PRODUCTION_COST%'").get().n, 0);
  });

  test('WIP, yield, capacity and cost reports are derived, role-scoped and analytical-only', async () => {
    const wip = await request('/api/manufacturing/reports/wip'); assert.equal(wip.status, 200); assert.equal(wip.data.rows.some((x) => x.orderId === orderId), false);
    const yieldReport = await request('/api/manufacturing/reports/yield'); assert.equal(yieldReport.status, 200);
    const capacity = await request('/api/manufacturing/reports/capacity?date=2026-09-24'); assert.equal(capacity.status, 200); assert.equal(capacity.data.rows[0].daily_capacity_minutes, 480); assert.equal(capacity.data.rows[0].planned_minutes, 610); assert.equal(capacity.data.rows[0].overloaded, true); assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId).status, 'COMPLETED');
    const cost = await request('/api/manufacturing/reports/cost', { token: accounting }); assert.equal(cost.status, 200); assert.equal(cost.data.analyticalOnly, true); assert.equal(cost.data.rows.find((x) => x.orderId === orderId).materialQuality, 'ESTIMATED');
    assert.equal((await request('/api/manufacturing/operation-reports', { token: sales, method: 'POST', body: {} })).status, 403); assert.equal((await request('/api/manufacturing/operation-reports', { token: warehouse, method: 'POST', body: {} })).status, 403); assert.equal((await request('/api/manufacturing/reports/cost', { token: warehouse })).status, 403);
    assert.equal((await request('/api/manufacturing/costs/reconcile', { token: accounting })).data.checkOnly, true); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type LIKE 'PRODUCTION_COST%'").get().n, 0);
  });

  test('cost formula absorbs process loss into good output and reports missing overhead evidence honestly', () => {
    const cost = deriveProductionCost(db, orderId); assert.equal(cost.goodQuantity, 97); assert.equal(cost.scrapQuantity, 3); assert.equal(cost.yieldBps, 9700); assert.equal(cost.overheadComplete, false); assert.equal(cost.overheadCostCents, null); assert.equal(cost.totalCostCents, null); assert.equal(cost.materialQuality, 'ESTIMATED'); assert.equal(cost.scrapLossCents, Math.round(3 * cost.baseline.standard_unit_cents));
  });

  test('tracked purchased lot derives authoritative material source price; warehouse supplies no cost', () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO production_orders(id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,source_type) VALUES('p6c-cost-order','P6C-COST','p6c-fg',2,'IN_PROGRESS','','user-admin',?,?, 'MANUAL')").run(now, now);
    db.prepare("INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,quantity_per_unit,scrap_rate_snapshot) VALUES('p6c-cost-req','p6c-cost-order','p6c-case',2,0,1,1,0)").run();
    db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at) VALUES('p6c-cost-issue','P6C-COST-MI','p6c-cost-order','p6c-wh','CONFIRMED','2026-09-24','','user-warehouse',?,?, 'user-warehouse',?)").run(now, now, now);
    db.prepare("INSERT INTO production_material_issue_items(id,issue_id,product_id,planned_quantity,issue_quantity,line_no,requirement_line_id) VALUES('p6c-cost-issue-item','p6c-cost-issue','p6c-case',2,2,1,'p6c-cost-req')").run();
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('p6c-source-pri','source-pr','p6c-case',2,12345,24690,1)").run();
    db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,created_source_item_id,status,created_at) VALUES('p6c-cost-lot','p6c-case','P6C-COST-LOT','PURCHASE_RECEIPT','source-pr','p6c-source-pri','CONSUMED',?)").run(now);
    db.prepare("INSERT INTO tracked_source_allocations(id,source_type,source_id,source_item_id,product_id,lot_id,quantity,posted,reversed,created_at) VALUES('p6c-cost-allocation','PRODUCTION_MATERIAL_ISSUE','p6c-cost-issue','p6c-cost-issue-item','p6c-case','p6c-cost-lot',2,1,0,?)").run(now);
    const cost = deriveProductionCost(db, 'p6c-cost-order'); assert.equal(cost.materialCostCents, 24690); assert.equal(cost.materialQuality, 'AUTHORITATIVE');
  });
});
