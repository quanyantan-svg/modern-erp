import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { id } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';

let handle; let db; let server; let baseUrl; let admin; let warehouse; let sales; let accounting;

async function request(path, { token = admin, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function login(username, password) { const result = await request('/api/auth/login', { token: null, method: 'POST', body: { username, password } }); assert.equal(result.status, 200); return result.data.token; }

before(async () => {
  handle = createTempDb({ label: 'v13-p4' }); db = handle.db;
  server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = await login('admin', 'admin123'); warehouse = await login('warehouse', 'warehouse123'); sales = await login('sales', 'sales123'); accounting = await login('accounting', 'accounting123');
});
after(async () => { await new Promise((done) => server.close(done)); handle.cleanup(); });

function seedX100() {
  const now = new Date().toISOString();
  const products = [['fg-x100', 'X100-FG', 'X100成品'], ['pcb-x100', 'X100-PCB', 'PCB'], ['case-x100', 'X100-CASE', '机箱'], ['psu-x100', 'X100-PSU', '电源']];
  for (const [pid, code, name] of products) db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES(?,?,?,'测试','件',0,0,1,?,?)").run(pid, code, name, now, now);
  db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-x100','WH-X100','X100仓','','',1,?,?)").run(now, now);
  db.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES('bom-x100','fg-x100','1.0','ACTIVE','','user-admin',?,?)").run(now, now);
  for (const [line, product] of [['bi-pcb', 'pcb-x100'], ['bi-case', 'case-x100'], ['bi-psu', 'psu-x100']]) db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)').run(line, 'bom-x100', product, 1, products.findIndex((p) => p[0] === product));
  for (const [product, quantity] of [['pcb-x100', 100], ['case-x100', 100], ['psu-x100', 100], ['fg-x100', 20]]) db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)').run(id(), 'wh-x100', product, quantity, now);
}

describe('V1.3 Phase 4 production source and snapshot contracts', () => {
  test('A-F instruction conversion requires RELEASED, supports 60+40, refuses 41, and preserves provenance', async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO mrp_runs(id,run_code,run_name,horizon_start,horizon_end,demand_source_mode,status,summary,created_by,created_at,updated_at) VALUES('mrp-p4','MRP-P4','P4','2026-09-01','2026-09-30','SALES_ORDERS','COMPLETED','','user-admin',?,?)").run(now, now);
    db.prepare("INSERT INTO mrp_run_results(id,run_id,product_id,gross_requirement,net_requirement,suggestion_type,suggested_quantity,need_by_date) VALUES('mrpr-p4','mrp-p4','product-001',100,100,'MAKE',100,'2026-09-30')").run();
    const bom = id(); db.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,'product-001','P4-I','ACTIVE','','user-admin',?,?)").run(bom, now, now);
    db.prepare("INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,'product-002',1,0,1)").run(id(), bom);
    db.prepare("INSERT INTO production_instructions(id,instruction_no,mrp_run_id,status,planned_date,notes,created_by,created_at,updated_at) VALUES('pi-p4','PI-P4','mrp-p4','DRAFT','2026-09-30','','user-admin',?,?)").run(now, now);
    db.prepare("INSERT INTO production_instruction_items(id,instruction_id,mrp_result_id,product_id,quantity,need_by_date,bom_id,created_at) VALUES('pii-p4','pi-p4','mrpr-p4','product-001',100,'2026-09-30',?,?)").run(bom, now);
    const unreleased = await request('/api/production-instructions/pi-p4/generate-production-order', { method: 'POST', body: { itemId: 'pii-p4', quantity: 60 } }); assert.equal(unreleased.status, 409);
    await request('/api/production-instructions/pi-p4/release', { method: 'POST' });
    const first = await request('/api/production-instructions/pi-p4/generate-production-order', { method: 'POST', body: { itemId: 'pii-p4', quantity: 60 } }); assert.equal(first.status, 201, first.data.error);
    const second = await request('/api/production-instructions/pi-p4/generate-production-order', { method: 'POST', body: { itemId: 'pii-p4', quantity: 40 } }); assert.equal(second.status, 201, second.data.error);
    const excess = await request('/api/production-instructions/pi-p4/generate-production-order', { method: 'POST', body: { itemId: 'pii-p4', quantity: 41 } }); assert.equal(excess.status, 409);
    const rows = db.prepare('SELECT * FROM production_orders WHERE production_instruction_item_id=? ORDER BY quantity DESC').all('pii-p4'); assert.deepEqual(rows.map((r) => Number(r.quantity)), [60, 40]); assert.ok(rows.every((r) => r.source_type === 'INSTRUCTION' && r.production_instruction_id === 'pi-p4'));
  });

  test('G-I manual order is explicit MANUAL and its BOM snapshot does not follow master edits', async () => {
    const created = await request('/api/production-orders', { method: 'POST', body: { productId: 'product-001', bomId: db.prepare("SELECT id FROM boms WHERE product_id='product-001' AND version='P4-I'").get().id, quantity: 10 } }); assert.equal(created.status, 200, created.data.error);
    const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(created.data.id); assert.equal(order.source_type, 'MANUAL'); assert.equal(order.production_instruction_id, null);
    const snapshot = db.prepare('SELECT * FROM production_order_items WHERE order_id=?').get(order.id); assert.equal(Number(snapshot.quantity), 10); assert.equal(Number(snapshot.quantity_per_unit), 1);
    db.prepare('UPDATE bom_items SET quantity=2 WHERE bom_id=?').run(order.bom_id);
    assert.equal(Number(db.prepare('SELECT quantity FROM production_order_items WHERE id=?').get(snapshot.id).quantity), 10);
    const next = await request('/api/production-orders', { method: 'POST', body: { productId: 'product-001', bomId: order.bom_id, quantity: 10 } }); assert.equal(Number(db.prepare('SELECT quantity FROM production_order_items WHERE order_id=?').get(next.data.id).quantity), 20);
  });
});

describe('V1.3 Phase 4 X100 execution, correction, completion and zero-side-effect gates', () => {
  test('J-BR full authoritative flow', async () => {
    seedX100();
    const created = await request('/api/production-orders', { method: 'POST', body: { productId: 'fg-x100', bomId: 'bom-x100', quantity: 100, plannedStart: '2026-09-23' } }); assert.equal(created.status, 200, created.data.error); const orderId = created.data.id;
    const txBeforeStart = db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n; const started = await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'start' } }); assert.equal(started.status, 200); assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, txBeforeStart);
    const reqs = db.prepare('SELECT * FROM production_order_items WHERE order_id=? ORDER BY line_no').all(orderId); assert.equal(reqs.length, 3); assert.ok(reqs.every((r) => Number(r.quantity) === 100));

    const unrelated = await request('/api/production-material-issues', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', items: [{ productId: 'product-005', issueQuantity: 1 }] } }); assert.equal(unrelated.status, 400);
    const over = await request('/api/production-material-issues', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', items: [{ requirementLineId: reqs[0].id, issueQuantity: 101 }] } }); assert.equal(over.status, 201); const beforeOver = db.prepare("SELECT quantity q FROM inventory WHERE warehouse_id='wh-x100' AND product_id='pcb-x100'").get().q; const overConfirm = await request(`/api/production-material-issues/${over.data.id}/confirm`, { token: warehouse, method: 'POST' }); assert.equal(overConfirm.status, 409); assert.equal(db.prepare("SELECT quantity q FROM inventory WHERE warehouse_id='wh-x100' AND product_id='pcb-x100'").get().q, beforeOver); assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=?").get(over.data.id).n, 0);
    await request(`/api/production-material-issues/${over.data.id}/cancel`, { token: warehouse, method: 'POST' }); const deleted = await request(`/api/production-material-issues/${over.data.id}`, { token: warehouse, method: 'DELETE' }); assert.equal(deleted.status, 200);

    const issue = await request('/api/production-material-issues', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', items: reqs.map((r) => ({ requirementLineId: r.id, issueQuantity: 100 })) } }); assert.equal(issue.status, 201); assert.equal((await request(`/api/production-material-issues/${issue.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200);
    for (const pid of ['pcb-x100', 'case-x100', 'psu-x100']) assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-x100' AND product_id=?").get(pid).quantity), 0);
    assert.equal((await request(`/api/production-material-issues/${issue.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 409);

    const returnDraft = await request('/api/production-material-returns', { token: warehouse, method: 'POST', body: { originalIssueId: issue.data.id, items: [{ originalIssueItemId: db.prepare('SELECT id FROM production_material_issue_items WHERE issue_id=? AND product_id=?').get(issue.data.id, 'pcb-x100').id, quantity: 10 }] } }); assert.equal(returnDraft.status, 201); assert.equal((await request(`/api/production-material-returns/${returnDraft.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200);
    const receiptBlocked = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 100 } }); assert.equal(receiptBlocked.status, 201); const txCount = db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n; assert.equal((await request(`/api/production-receipts/${receiptBlocked.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 409); assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, txCount); await request(`/api/production-receipts/${receiptBlocked.data.id}/cancel`, { token: warehouse, method: 'POST' });

    const reissue = await request('/api/production-material-issues', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', items: [{ requirementLineId: reqs.find((r) => r.product_id === 'pcb-x100').id, issueQuantity: 10 }] } }); assert.equal((await request(`/api/production-material-issues/${reissue.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200);
    const receipt = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 100 } }); assert.equal((await request(`/api/production-receipts/${receipt.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200); assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-x100' AND product_id='fg-x100'").get().quantity), 120);
    const reversal = await request('/api/production-receipt-reversals', { token: warehouse, method: 'POST', body: { originalReceiptId: receipt.data.id, quantity: 10 } }); assert.equal((await request(`/api/production-receipt-reversals/${reversal.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200); assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-x100' AND product_id='fg-x100'").get().quantity), 110);
    const tooMuch = await request('/api/production-receipt-reversals', { token: warehouse, method: 'POST', body: { originalReceiptId: receipt.data.id, quantity: 91 } }); assert.equal(tooMuch.status, 201); const beforeInvalid = db.prepare("SELECT quantity q FROM inventory WHERE warehouse_id='wh-x100' AND product_id='fg-x100'").get().q; assert.equal((await request(`/api/production-receipt-reversals/${tooMuch.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 409); assert.equal(db.prepare("SELECT quantity q FROM inventory WHERE warehouse_id='wh-x100' AND product_id='fg-x100'").get().q, beforeInvalid);
    const finalReceipt = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 10 } }); assert.equal((await request(`/api/production-receipts/${finalReceipt.data.id}/confirm`, { token: warehouse, method: 'POST' })).status, 200);
    const draft = await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 1 } }); assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } })).status, 409); await request(`/api/production-receipts/${draft.data.id}/cancel`, { token: warehouse, method: 'POST' });
    const beforeComplete = db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n; assert.equal((await request(`/api/production-orders/${orderId}`, { method: 'POST', body: { action: 'complete' } })).status, 200); assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, beforeComplete); assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId).status, 'COMPLETED');
    assert.equal((await request('/api/production-receipts', { token: warehouse, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 1 } })).status, 409);
    assert.equal((await request('/api/production-material-issues', { token: sales, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', items: [] } })).status, 403);
    assert.equal((await request('/api/production-receipts', { token: accounting, method: 'POST', body: { productionOrderId: orderId, warehouseId: 'wh-x100', quantity: 1 } })).status, 403);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh-x100' AND product_id='fg-x100'").get().quantity), 120);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PRODUCTION_RECEIPT' AND source_id IN (?,?)").get(receipt.data.id, finalReceipt.data.id).n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type LIKE 'PRODUCTION%' OR source_type LIKE 'MATERIAL_%'").get().n, 0);
  });
});
