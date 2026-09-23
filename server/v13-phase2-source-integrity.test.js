import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';

describe('V1.3 Phase 2 authoritative source integrity', () => {
  let temp; let db; let server; let baseUrl;
  const tokens = {};
  const request = async (path, role, method = 'GET', body) => {
    const response = await fetch(baseUrl + path, { method, headers: { authorization: `Bearer ${tokens[role]}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {}; try { data = await response.json(); } catch { /* empty */ }
    return { status: response.status, data };
  };
  const insertSo = (id, status = 'APPROVED', quantity = 100, price = 2500) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date,payment_terms,ship_to_contact_name,ship_to_phone,ship_to_address) VALUES(?,?,?,?,?,'','user-sales',?,?,?,?,?,'Alice','130','Address')")
      .run(id, `SO-${id}`, 'cus', status, quantity * price, now, now, '2026-09-23', '2026-09-30', 'COD');
    db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(`${id}-line`, id, 'p1', quantity, price, quantity * price);
  };
  const insertPo = (id, status = 'APPROVED', quantity = 70, price = 20000) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date,payment_terms,supplier_contact_name,supplier_contact_phone,supplier_address) VALUES(?,?,?,?,?,'','user-sales',?,?,?,?,?,'Bob','131','Address')")
      .run(id, `PO-${id}`, 'sup', status, quantity * price, now, now, '2026-09-23', '2026-09-30', 'COD');
    db.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(`${id}-line`, id, 'p1', quantity, price, quantity * price);
  };

  beforeEach(async () => {
    temp = createTempDb({ label: 'v13-phase2', production: true }); db = temp.db;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS','Customer','Alice','130','Address',1,?,?),('cus2','CUS2','Other','','','',1,?,?)").run(now, now, now, now);
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('sup','SUP','Supplier','Bob','131','Address',1,?,?),('sup2','SUP2','Other','','','',1,?,?)").run(now, now, now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH','Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p1','P1','Product','','EA',20000,0,1,?,?),('p2','P2','Other','','EA',100,0,1,?,?)").run(now, now, now, now);
    db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('inv','wh','p1',1000,?)").run(now);
    for (const [name, role] of [['sales','role-sales'],['reviewer','role-reviewer'],['warehouse','role-warehouse'],['admin','role-admin']]) {
      const hash = hashPassword(`${name}-phase2-1234`);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(`user-${name}`, name, name, hash.hash, hash.salt, role, now);
    }
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['sales','reviewer','warehouse','admin']) {
      const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name}-phase2-1234` }) });
      tokens[name] = (await response.json()).token;
    }
  });
  afterEach(async () => { await new Promise((done, fail) => server.close((e) => e ? fail(e) : done())); temp.cleanup(); });

  test('sales delivery refuses invalid provenance and confirms 60/100 then 40 exactly once', async () => {
    insertSo('draft', 'DRAFT'); insertSo('submitted', 'SUBMITTED'); insertSo('so');
    const base = { salesOrderId: 'so', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-09-23', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 60, unitPriceCents: 2500 }] };
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, salesOrderId: 'draft', items: [{ ...base.items[0], salesOrderItemId: 'draft-line' }] })).status, 409);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, salesOrderId: 'submitted', items: [{ ...base.items[0], salesOrderItemId: 'submitted-line' }] })).status, 409);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, customerId: 'cus2' })).status, 400);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], productId: 'p2' }] })).status, 400);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], unitPriceCents: 1 }] })).status, 400);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { customerId: 'cus', warehouseId: 'wh', items: base.items })).status, 400);
    const first = await request('/api/sales-deliveries', 'warehouse', 'POST', base); assert.equal(first.status, 201, first.data.error);
    assert.equal((await request(`/api/sales-deliveries/${first.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    assert.equal((await request(`/api/sales-deliveries/${first.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 409);
    const stale = await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 40 }] });
    const second = await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 40 }] });
    assert.equal((await request(`/api/sales-deliveries/${second.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    const before = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity;
    assert.equal((await request(`/api/sales-deliveries/${stale.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 409);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 1 }] })).status, 409);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity, before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY'").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY'").get().n, 2);
  });

  test('purchase receipt inherits PO price, enforces partial quantity, and posts exact AP', async () => {
    insertPo('draft', 'DRAFT'); insertPo('submitted', 'SUBMITTED'); insertPo('po');
    const base = { purchaseOrderId: 'po', supplierId: 'sup', warehouseId: 'wh', receiptDate: '2026-09-23', items: [{ purchaseOrderItemId: 'po-line', productId: 'p1', quantity: 30, unitPriceCents: 20000 }] };
    for (const source of ['draft','submitted']) assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, purchaseOrderId: source, items: [{ ...base.items[0], purchaseOrderItemId: `${source}-line` }] })).status, 409);
    assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, supplierId: 'sup2' })).status, 400);
    assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], unitPriceCents: 200 }] })).status, 400);
    assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', { supplierId: 'sup', warehouseId: 'wh', items: base.items })).status, 400);
    const first = await request('/api/purchase-receipts', 'warehouse', 'POST', base); assert.equal(first.status, 201, first.data.error);
    assert.equal((await request(`/api/purchase-receipts/${first.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    const stale = await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 40 }] });
    const second = await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 40 }] });
    assert.equal((await request(`/api/purchase-receipts/${second.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    assert.equal(db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(second.data.id).amount_cents, 800000);
    assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT'").get().n, 1400000);
    assert.equal((await request(`/api/purchase-receipts/${stale.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 409);
    assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', { ...base, items: [{ ...base.items[0], quantity: 1 }] })).status, 409);
  });

  test('sales and purchase returns require confirmed sources and cap cumulative reversal', async () => {
    insertSo('so', 'APPROVED', 10, 2500); insertPo('po', 'APPROVED', 10, 20000);
    const sd = await request('/api/sales-deliveries', 'warehouse', 'POST', { salesOrderId: 'so', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-09-23', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 10, unitPriceCents: 2500 }] });
    const sdItem = db.prepare('SELECT id FROM sales_delivery_items WHERE delivery_id=?').get(sd.data.id).id;
    assert.equal((await request('/api/sales-returns', 'warehouse', 'POST', { deliveryId: sd.data.id, customerId: 'cus', warehouseId: 'wh', items: [{ deliveryItemId: sdItem, productId: 'p1', quantity: 1, unitPriceCents: 2500 }] })).status, 409);
    await request(`/api/sales-deliveries/${sd.data.id}`, 'warehouse', 'POST', { action: 'confirm' });
    assert.equal((await request('/api/sales-returns', 'warehouse', 'POST', { customerId: 'cus', warehouseId: 'wh', items: [] })).status, 400);
    assert.equal((await request('/api/sales-returns', 'warehouse', 'POST', { deliveryId: sd.data.id, customerId: 'cus2', warehouseId: 'wh', items: [{ deliveryItemId: sdItem, productId: 'p1', quantity: 1 }] })).status, 400);
    const sr = await request('/api/sales-returns', 'warehouse', 'POST', { deliveryId: sd.data.id, customerId: 'cus', warehouseId: 'wh', items: [{ deliveryItemId: sdItem, productId: 'p1', quantity: 2, unitPriceCents: 2500 }] });
    assert.equal((await request(`/api/sales-returns/${sr.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    assert.equal(db.prepare('SELECT total_cents FROM return_orders WHERE id=?').get(sr.data.id).total_cents, 5000);
    assert.equal((await request('/api/sales-returns', 'warehouse', 'POST', { deliveryId: sd.data.id, customerId: 'cus', warehouseId: 'wh', items: [{ deliveryItemId: sdItem, productId: 'p1', quantity: 9 }] })).status, 409);

    const pr = await request('/api/purchase-receipts', 'warehouse', 'POST', { purchaseOrderId: 'po', supplierId: 'sup', warehouseId: 'wh', receiptDate: '2026-09-23', items: [{ purchaseOrderItemId: 'po-line', productId: 'p1', quantity: 10, unitPriceCents: 20000 }] });
    await request(`/api/purchase-receipts/${pr.data.id}`, 'warehouse', 'POST', { action: 'confirm' });
    const prItem = db.prepare('SELECT id FROM purchase_receipt_items WHERE receipt_id=?').get(pr.data.id).id;
    const ret = await request('/api/purchase-returns', 'warehouse', 'POST', { receiptId: pr.data.id, supplierId: 'sup', warehouseId: 'wh', items: [{ receiptItemId: prItem, productId: 'p1', quantity: 2, unitPriceCents: 20000 }] });
    assert.equal((await request(`/api/purchase-returns/${ret.data.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    assert.equal(db.prepare('SELECT total_cents FROM purchase_returns WHERE id=?').get(ret.data.id).total_cents, 40000);
    assert.equal((await request('/api/purchase-returns', 'warehouse', 'POST', { receiptId: pr.data.id, supplierId: 'sup', warehouseId: 'wh', items: [{ receiptItemId: prItem, productId: 'p1', quantity: 9 }] })).status, 409);
  });

  test('source ids and commercial identities are immutable while operational quantity remains editable', async () => {
    insertSo('so');
    const delivery = await request('/api/sales-deliveries', 'warehouse', 'POST', { salesOrderId: 'so', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-09-23', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 5, unitPriceCents: 2500 }] });
    assert.equal((await request(`/api/sales-deliveries/${delivery.data.id}`, 'warehouse', 'PATCH', { salesOrderId: 'other', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-09-23', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 4, unitPriceCents: 2500 }] })).status, 409);
    assert.equal((await request(`/api/sales-deliveries/${delivery.data.id}`, 'warehouse', 'PATCH', { salesOrderId: 'so', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-09-23', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 4, unitPriceCents: 2500 }] })).status, 200);
  });

  test('purchase instruction to PR to PO preserves source identity and manual PR stays explicit', async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO mrp_runs(id,run_code,run_name,horizon_start,horizon_end,demand_source_mode,status,summary,created_by,created_at,updated_at) VALUES('run','RUN','Run','2026-09-01','2026-10-31','SALES_ORDERS','COMPLETED','','user-admin',?,?)").run(now, now);
    db.prepare("INSERT INTO mrp_run_results(id,run_id,product_id,suggestion_type,suggested_quantity,need_by_date) VALUES('result','run','p1','BUY',12,'2026-10-10')").run();
    db.prepare("INSERT INTO purchase_instructions(id,instruction_no,mrp_run_id,status,planned_date,notes,created_by,released_by,created_at,updated_at,released_at) VALUES('pi','PI-1','run','RELEASED','2026-09-23','','user-admin','user-admin',?,?,?)").run(now, now, now);
    db.prepare("INSERT INTO purchase_instruction_items(id,instruction_id,mrp_result_id,product_id,quantity,need_by_date,created_at) VALUES('pi-line','pi','result','p1',12,'2026-10-10',?)").run(now);
    const sourced = await request('/api/purchase-requisitions', 'sales', 'POST', { sourceInstructionId: 'pi', requestDate: '2026-09-23', requiredDate: '2026-10-10', items: [{ purchaseInstructionItemId: 'pi-line', productId: 'p1', quantity: 12, preferredSupplierId: 'sup', unitPriceCents: 20000 }] });
    assert.equal(sourced.status, 201, sourced.data.error);
    let detail = await request(`/api/purchase-requisitions/${sourced.data.id}`, 'sales');
    assert.equal(detail.data.requisition.sourceType, 'PURCHASE_INSTRUCTION');
    assert.equal(detail.data.requisition.source_instruction_id, 'pi');
    assert.equal(detail.data.requisition.items[0].purchaseInstructionItemId, 'pi-line');
    assert.equal((await request(`/api/purchase-requisitions/${sourced.data.id}`, 'sales', 'PATCH', { sourceInstructionId: 'other', requestDate: '2026-09-23', requiredDate: '2026-10-10', items: [{ id: detail.data.requisition.items[0].id, unitPriceCents: 20000 }] })).status, 409);
    assert.equal(db.prepare('SELECT source_instruction_id FROM purchase_requisitions WHERE id=?').get(sourced.data.id).source_instruction_id, 'pi');
    await request(`/api/purchase-requisitions/${sourced.data.id}/submit`, 'sales', 'POST', {});
    await request(`/api/purchase-requisitions/${sourced.data.id}/approve`, 'reviewer', 'POST', {});
    const po = await request(`/api/purchase-requisitions/${sourced.data.id}/generate-purchase-order`, 'sales', 'POST', { supplierId: 'sup', paymentTerms: 'COD' });
    assert.equal(po.status, 201, po.data.error);
    assert.equal(db.prepare('SELECT purchase_requisition_id FROM purchase_orders WHERE id=?').get(po.data.id).purchase_requisition_id, sourced.data.id);
    const poLine = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(po.data.id);
    assert.equal(poLine.purchase_requisition_item_id, detail.data.requisition.items[0].id);
    assert.equal((await request(`/api/purchase-orders/${po.data.id}`, 'sales', 'PUT', { purchaseRequisitionId: 'other', supplierId: 'sup', orderDate: '2026-09-23', expectedDeliveryDate: '2026-10-10', paymentTerms: 'COD', items: [{ purchaseRequisitionItemId: poLine.purchase_requisition_item_id, productId: 'p1', quantity: 12, unitPriceCents: 20000 }] })).status, 409);

    const manual = await request('/api/purchase-requisitions', 'sales', 'POST', { requestDate: '2026-09-23', requiredDate: '2026-10-10', items: [{ productId: 'p1', quantity: 1, unitPriceCents: 0 }] });
    detail = await request(`/api/purchase-requisitions/${manual.data.id}`, 'sales');
    assert.equal(detail.data.requisition.sourceType, 'MANUAL');
    assert.equal(detail.data.requisition.source_instruction_id, null);
    assert.equal(detail.data.requisition.items[0].purchase_instruction_item_id, null);
  });

  test('role boundaries keep commercial creation and warehouse execution separate', async () => {
    insertSo('so'); insertPo('po');
    const sdBody = { salesOrderId: 'so', customerId: 'cus', warehouseId: 'wh', items: [{ salesOrderItemId: 'so-line', productId: 'p1', quantity: 1 }] };
    const prBody = { purchaseOrderId: 'po', supplierId: 'sup', warehouseId: 'wh', items: [{ purchaseOrderItemId: 'po-line', productId: 'p1', quantity: 1 }] };
    assert.equal((await request('/api/sales-deliveries', 'sales', 'POST', sdBody)).status, 403);
    assert.equal((await request('/api/purchase-receipts', 'sales', 'POST', prBody)).status, 403);
    assert.equal((await request('/api/sales-deliveries', 'warehouse', 'POST', sdBody)).status, 201);
    assert.equal((await request('/api/purchase-receipts', 'warehouse', 'POST', prBody)).status, 201);
  });
});
