import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

describe('v1.0.1-rc.3 business document integrity', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  const tokens = {};

  const request = (path, role, method = 'GET', body) => fetch(baseUrl + path, {
    method,
    headers: { authorization: `Bearer ${tokens[role]}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const passQuality = async (sourceType, sourceId, quantity) => {
    const kind = sourceType === 'PURCHASE_RECEIPT' ? 'iqc' : 'oqc';
    const sourceField = kind === 'iqc' ? 'purchase_receipt_id' : 'sales_delivery_id';
    const createdResponse = await request(`/api/${kind}`, 'warehouse', 'POST', { [sourceField]: sourceId });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const completed = await request(`/api/${kind}/${created.id}/complete`, 'warehouse', 'POST', { result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0 });
    assert.equal(completed.status, 200);
  };

  beforeEach(async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-rc3-'));
    db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;

    const now = new Date().toISOString();
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('sup','SUP','Supplier','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS','Customer','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH','Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p1','P1','Product 1','','EA',12345,0,1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p2','P2','Product 2','','EA',500,0,1,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p1', quantity: 100, position: {}, rowId: 'inv1' });
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p2', quantity: 100, position: {}, rowId: 'inv2' });

    for (const [name, role, password] of [['warehouse', 'role-warehouse', 'warehouse-test-1234'], ['admin', 'role-admin', 'admin-test-1234'], ['sales', 'role-sales', 'sales-test-1234'], ['reviewer', 'role-reviewer', 'reviewer-test-1234']]) {
      const hash = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
        .run(`user-${name}`, name, name, hash.hash, hash.salt, role, now);
    }
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES('so-source','SO-SOURCE','cus','APPROVED',1234500,'','user-sales',?,?)").run(now, now);
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-source','so-source','p1',100,12345,1234500,1)").run();
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES('po-source','PO-SOURCE','sup','APPROVED',1234500,'','user-sales',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('poi-source','po-source','p1',100,12345,1234500,1)").run();
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd-source','SD-SOURCE','so-source','cus','wh','user-warehouse',1234500,'CONFIRMED','2026-09-01','','user-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('sdi-source','sd-source','p1',100,12345,1234500,1)").run();
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('pr-source','PR-SOURCE','po-source','sup','wh','user-warehouse',1234500,'CONFIRMED','2026-09-01','','user-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('pri-source','pr-source','p1',100,12345,1234500,1)").run();
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['warehouse', 'warehouse-test-1234'], ['admin', 'admin-test-1234'], ['sales', 'sales-test-1234'], ['reviewer', 'reviewer-test-1234']]) {
      const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password }) });
      tokens[name] = (await response.json()).token;
    }
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const documents = [
    { name: 'purchase receipt', path: '/api/purchase-receipts', table: 'purchase_receipts', itemTable: 'purchase_receipt_items', fk: 'receipt_id', party: { purchaseOrderId: 'po-source', supplierId: 'sup' }, sourceItem: { purchaseOrderItemId: 'poi-source' }, date: { receiptDate: '2026-09-03' }, delta: 1, voucher: 'PURCHASE_RECEIPT', result: 'purchaseReceipt' },
    { name: 'sales delivery', path: '/api/sales-deliveries', table: 'sales_deliveries', itemTable: 'sales_delivery_items', fk: 'delivery_id', party: { salesOrderId: 'so-source', customerId: 'cus' }, sourceItem: { salesOrderItemId: 'soi-source' }, date: { deliveryDate: '2026-09-03' }, delta: -1, voucher: 'SALES_DELIVERY', result: 'salesDelivery' },
    { name: 'sales return', path: '/api/sales-returns', table: 'return_orders', itemTable: 'return_order_items', fk: 'return_id', party: { deliveryId: 'sd-source', customerId: 'cus' }, sourceItem: { deliveryItemId: 'sdi-source' }, date: { returnDate: '2026-09-03' }, delta: 1, voucher: 'SALES_RETURN', result: 'salesReturn' },
    { name: 'purchase return', path: '/api/purchase-returns', table: 'purchase_returns', itemTable: 'purchase_return_items', fk: 'return_id', party: { receiptId: 'pr-source', supplierId: 'sup' }, sourceItem: { receiptItemId: 'pri-source' }, date: { returnDate: '2026-09-03' }, delta: -1, voucher: 'PURCHASE_RETURN', result: 'purchaseReturn' },
  ];

  for (const spec of documents) test(`${spec.name}: create, refresh, atomic edit, confirm and voucher use exact cents`, async () => {
    const createBody = { ...spec.party, warehouseId: 'wh', ...spec.date, totalCents: 1, items: [{ ...spec.sourceItem, productId: 'p1', quantity: 2, unitPriceCents: 12345 }] };
    let response = await request(spec.path, 'warehouse', 'POST', createBody);
    assert.equal(response.status, 201);
    const created = await response.json();
    const original = db.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(created.id);
    assert.equal(original.status, 'DRAFT');
    assert.equal(original.total_cents, 24690);
    assert.equal(db.prepare(`SELECT unit_price_cents,amount_cents FROM ${spec.itemTable} WHERE ${spec.fk}=?`).get(created.id).amount_cents, 24690);

    response = await request(`${spec.path}/${created.id}`, 'warehouse');
    assert.equal(response.status, 200);
    const detail = (await response.json())[spec.result];
    assert.equal(detail.total_cents, 24690);
    assert.equal(detail.items[0].productId, 'p1');
    assert.equal(detail.items[0].unitPriceCents, 12345);

    const editBody = { ...spec.party, warehouseId: 'wh', ...spec.date, totalCents: 999999, remark: 'edited', items: [{ ...spec.sourceItem, productId: 'p1', quantity: 3, unitPriceCents: 12345 }] };
    response = await request(`${spec.path}/${created.id}`, 'warehouse', 'PATCH', editBody);
    assert.equal(response.status, 200);
    const edited = db.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(created.id);
    assert.equal(edited.total_cents, 37035);
    assert.equal(db.prepare(`SELECT count(*) count FROM ${spec.itemTable} WHERE ${spec.fk}=?`).get(created.id).count, 1);
    assert.equal(db.prepare(`SELECT product_id,amount_cents FROM ${spec.itemTable} WHERE ${spec.fk}=?`).get(created.id).product_id, 'p1');

    response = await request(`${spec.path}/${created.id}`, 'warehouse', 'PATCH', { ...editBody, remark: 'must rollback', items: [{ ...spec.sourceItem, productId: 'missing', quantity: 1, unitPriceCents: 12345 }] });
    assert.equal(response.status, 400);
    assert.equal(db.prepare(`SELECT remark FROM ${spec.table} WHERE id=?`).get(created.id).remark, 'edited');
    assert.equal(db.prepare(`SELECT count(*) count FROM ${spec.itemTable} WHERE ${spec.fk}=?`).get(created.id).count, 1);

    const before = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity;
    if (['PURCHASE_RECEIPT', 'SALES_DELIVERY'].includes(spec.voucher)) await passQuality(spec.voucher, created.id, 3);
    response = await request(`${spec.path}/${created.id}`, 'warehouse', 'POST', { action: 'confirm' });
    assert.equal(response.status, 200);
    assert.equal(db.prepare(`SELECT status,total_cents FROM ${spec.table} WHERE id=?`).get(created.id).status, 'CONFIRMED');
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity, before + spec.delta * 3);
    const transaction = db.prepare('SELECT * FROM inventory_transactions WHERE source_type=? AND source_id=?').get(spec.voucher, created.id);
    assert.equal(transaction.quantity_change, 3);
    assert.equal(transaction.balance_after, before + spec.delta * 3);
    const voucher = db.prepare('SELECT id FROM accounting_vouchers WHERE source_type=? AND source_id=?').get(spec.voucher, created.id);
    const totals = db.prepare("SELECT SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END) debit,SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END) credit FROM accounting_entries WHERE voucher_id=?").get(voucher.id);
    assert.equal(totals.debit, 37035);
    assert.equal(totals.credit, 37035);

    response = await request(`${spec.path}/${created.id}`, 'warehouse', 'POST', { action: 'confirm' });
    assert.equal(response.status, ['PURCHASE_RECEIPT', 'SALES_DELIVERY'].includes(spec.voucher) ? 200 : 409);
    assert.equal(db.prepare('SELECT count(*) count FROM inventory_transactions WHERE source_type=? AND source_id=?').get(spec.voucher, created.id).count, 1);
    assert.equal(db.prepare('SELECT count(*) count FROM accounting_vouchers WHERE source_type=? AND source_id=?').get(spec.voucher, created.id).count, 1);
    assert.equal((await request(`${spec.path}/${created.id}`, 'warehouse', 'PATCH', editBody)).status, 409);
    assert.equal((await request(`${spec.path}/${created.id}`, 'warehouse', 'POST', { action: 'cancel' })).status, 409);
  });

  test('money inputs never coerce missing, invalid, zero or negative prices and ignore injected totals', async () => {
    for (const unitPriceCents of [undefined, '', 'NaN', 0, -1, Number.MAX_SAFE_INTEGER]) {
      const response = await request('/api/purchase-receipts', 'warehouse', 'POST', { supplierId: 'sup', warehouseId: 'wh', totalCents: 77, items: [{ productId: 'p1', quantity: 2, ...(unitPriceCents === undefined ? {} : { unitPriceCents }) }] });
      assert.equal(response.status, 400, `price ${String(unitPriceCents)} must be rejected`);
    }
  });

  test('draft cancellation has no stock or voucher effect and cancelled documents stay immutable', async () => {
    const response = await request('/api/purchase-receipts', 'warehouse', 'POST', { purchaseOrderId: 'po-source', supplierId: 'sup', warehouseId: 'wh', items: [{ purchaseOrderItemId: 'poi-source', productId: 'p1', quantity: 1, unitPriceCents: 12345 }] });
    const created = await response.json();
    assert.equal((await request(`/api/purchase-receipts/${created.id}`, 'warehouse', 'POST', { action: 'cancel' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(created.id).status, 'CANCELLED');
    assert.equal(db.prepare('SELECT count(*) count FROM inventory_transactions WHERE source_id=?').get(created.id).count, 0);
    assert.equal(db.prepare('SELECT count(*) count FROM accounting_vouchers WHERE source_id=?').get(created.id).count, 0);
    assert.equal((await request(`/api/purchase-receipts/${created.id}`, 'warehouse', 'PATCH', { supplierId: 'sup', warehouseId: 'wh', items: [{ productId: 'p1', quantity: 1, unitPriceCents: 1 }] })).status, 409);
  });

  test('V1.3 Phase 1: role-sales no longer posts purchase receipts (logistics execution belongs to warehouse)', async () => {
    // role-sales used to be able to create / edit / cancel purchase receipts.
    // After V1.3 Phase 1 role remediation, sales owns commercial entry
    // (customer/supplier master + SO/PR/PO create/submit) and CRM, but
    // physical stock execution is restricted to warehouse / admin. So
    // /api/purchase-receipts POST as sales must be 403, not 201.
    const response = await request('/api/purchase-receipts', 'sales', 'POST', { supplierId: 'sup', warehouseId: 'wh', items: [{ productId: 'p1', quantity: 1, unitPriceCents: 12345 }] });
    assert.equal(response.status, 403, `sales POST /api/purchase-receipts must be 403 after V1.3, got ${response.status}`);
  });

  test('closed-period inbound and outbound confirmations roll back all effects', async () => {
    db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,status,created_at) VALUES('closed','2026-08',2026,8,'CLOSED',datetime('now'))").run();
    for (const [path, body, table] of [
      ['/api/purchase-receipts', { purchaseOrderId: 'po-source', supplierId: 'sup', warehouseId: 'wh', receiptDate: '2026-08-15', items: [{ purchaseOrderItemId: 'poi-source', productId: 'p1', quantity: 2, unitPriceCents: 12345 }] }, 'purchase_receipts'],
      ['/api/sales-deliveries', { salesOrderId: 'so-source', customerId: 'cus', warehouseId: 'wh', deliveryDate: '2026-08-15', items: [{ salesOrderItemId: 'soi-source', productId: 'p1', quantity: 2, unitPriceCents: 12345 }] }, 'sales_deliveries'],
    ]) {
      const created = await (await request(path, 'warehouse', 'POST', body)).json();
      await passQuality(path.includes('purchase') ? 'PURCHASE_RECEIPT' : 'SALES_DELIVERY', created.id, 2);
      const stockBefore = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity;
      const txBefore = db.prepare('SELECT count(*) count FROM inventory_transactions').get().count;
      const voucherBefore = db.prepare('SELECT count(*) count FROM accounting_vouchers').get().count;
      const response = await request(`${path}/${created.id}`, 'warehouse', 'POST', { action: 'confirm' });
      assert.equal(response.status, 409);
      assert.equal(db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(created.id).status, 'DRAFT');
      assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity, stockBefore);
      assert.equal(db.prepare('SELECT count(*) count FROM inventory_transactions').get().count, txBefore);
      assert.equal(db.prepare('SELECT count(*) count FROM accounting_vouchers').get().count, voucherBefore);
    }
  });

  test('representative pre-rc.3 stocktake data and approval permission reconcile idempotently', () => {
    const filename = join(tmp, 'legacy-stocktake.db');
    let legacy = createDatabase(filename);
    const now = new Date().toISOString();
    const password = hashPassword('legacy-stocktake-1234');
    legacy.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('legacy-wh','LEG-WH','Legacy Warehouse','','',1,?,?)").run(now, now);
    legacy.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run('legacy-user', 'legacy-stocktake', 'Legacy Stocktake', password.hash, password.salt, 'role-warehouse', now);
    legacy.prepare("INSERT INTO inventory_checks(id,check_no,warehouse_id,status,checked_at,creator_id,created_at,reason) VALUES('legacy-check','IC-LEGACY-001','legacy-wh','DRAFT',NULL,'legacy-user',?,'keep me')").run(now);
    legacy.prepare("DELETE FROM role_permissions WHERE permission_code='INVENTORY_CHECK_APPROVE'").run();
    legacy.prepare("DELETE FROM permissions WHERE code='INVENTORY_CHECK_APPROVE'").run();
    legacy.close();

    legacy = createDatabase(filename);
    const preserved = legacy.prepare("SELECT check_no,status,reason FROM inventory_checks WHERE id='legacy-check'").get();
    assert.equal(preserved.check_no, 'IC-LEGACY-001');
    assert.equal(preserved.status, 'DRAFT');
    assert.equal(preserved.reason, 'keep me');
    assert.equal(legacy.prepare("SELECT count(*) count FROM permissions WHERE code='INVENTORY_CHECK_APPROVE'").get().count, 1);
    // V1.3 Phase 1: INVENTORY_CHECK_APPROVE is held by both admin
    // (all-permissions inheritance) and reviewer (canonical approver).
    // warehouse must NOT hold it.
    assert.equal(legacy.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-admin' AND permission_code='INVENTORY_CHECK_APPROVE'").get().count, 1);
    assert.equal(legacy.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-reviewer' AND permission_code='INVENTORY_CHECK_APPROVE'").get().count, 1);
    assert.equal(legacy.prepare("SELECT count(*) count FROM role_permissions WHERE role_id='role-warehouse' AND permission_code='INVENTORY_CHECK_APPROVE'").get().count, 0);
    legacy.close();

    legacy = createDatabase(filename);
    assert.equal(legacy.prepare("SELECT count(*) count FROM inventory_checks WHERE id='legacy-check'").get().count, 1);
    // Idempotency: a second open must not duplicate the row.
    assert.equal(legacy.prepare("SELECT count(*) count FROM role_permissions WHERE permission_code='INVENTORY_CHECK_APPROVE'").get().count, 2);
    legacy.close();
  });

  test('stocktake follows DRAFT -> SUBMITTED -> APPROVED with role separation and traceable adjustment', async () => {
    let response = await request('/api/inventory-checks', 'warehouse', 'POST', { warehouseId: 'wh', productId: 'p1', actualQuantity: 95, reason: 'count', businessDate: '2026-09-22' });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.match(created.checkNo, /^IC-/);
    assert.equal(db.prepare('SELECT status,check_no FROM inventory_checks WHERE id=?').get(created.id).status, 'DRAFT');
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'warehouse', 'PATCH', { action: 'UPDATE', warehouseId: 'wh', productId: 'p1', actualQuantity: 94, reason: 'recount', businessDate: '2026-09-22' })).status, 200);
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'warehouse', 'PATCH', { action: 'APPROVE' })).status, 403);
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'warehouse', 'PATCH', { action: 'SUBMIT' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(created.id).status, 'SUBMITTED');
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'warehouse', 'PATCH', { action: 'SUBMIT' })).status, 409);
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'admin', 'PATCH', { action: 'APPROVE' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(created.id).status, 'APPROVED');
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity, 94);
    const movement = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_CHECK' AND source_id=?").get(created.id);
    assert.equal(movement.direction, 'OUT');
    assert.equal(movement.quantity_change, 6);
    assert.equal(movement.balance_after, 94);
    assert.equal((await request(`/api/inventory-checks/${created.id}`, 'admin', 'PATCH', { action: 'APPROVE' })).status, 409);
  });

  test('new stocktake without businessDate is rejected with zero side effects', async () => {
    const beforeChecks = db.prepare('SELECT COUNT(*) count FROM inventory_checks').get().count;
    const beforeInventory = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity;
    const beforeMovements = db.prepare("SELECT COUNT(*) count FROM inventory_transactions WHERE source_type='INVENTORY_CHECK'").get().count;
    const beforeAudit = db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_CHECK'").get().count;
    const response = await request('/api/inventory-checks', 'warehouse', 'POST', { warehouseId: 'wh', productId: 'p1', actualQuantity: 93, reason: 'missing date' });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM inventory_checks').get().count, beforeChecks);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1'").get().quantity, beforeInventory);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM inventory_transactions WHERE source_type='INVENTORY_CHECK'").get().count, beforeMovements);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='INVENTORY_CHECK'").get().count, beforeAudit);
  });

  test('sales order approval authorizes only; delivery confirmation is the single revenue trigger', async () => {
    // V1.3 Phase 1: SO submit requires order_date, requested_delivery_date,
    // ship-to contact/phone/address, and payment terms. The test now
    // supplies them so SUBMIT passes; the assertion of "no voucher at
    // approval" remains the focus of this case.
    let response = await request('/api/orders', 'sales', 'POST', {
      customerId: 'cus',
      orderDate: '2026-09-22',
      requestedDeliveryDate: '2026-10-10',
      paymentTerms: '月结 30 天',
      shipToContactName: '王女士',
      shipToPhone: '13800000000',
      shipToAddress: '上海市浦东新区张江路 88 号',
      items: [{ productId: 'p1', quantity: 2, unitPriceCents: 12345 }],
    });
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal((await request(`/api/orders/${order.id}/submit`, 'sales', 'POST', {})).status, 200);
    assert.equal((await request(`/api/orders/${order.id}/approve`, 'reviewer', 'POST', {})).status, 200);
    assert.equal(db.prepare("SELECT count(*) count FROM accounting_vouchers WHERE source_type='SALES_ORDER' AND source_id=?").get(order.id).count, 0);
    const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(order.id).id;
    response = await request('/api/sales-deliveries', 'warehouse', 'POST', { salesOrderId: order.id, customerId: 'cus', warehouseId: 'wh', items: [{ salesOrderItemId: orderItemId, productId: 'p1', quantity: 2, unitPriceCents: 12345 }] });
    const delivery = await response.json();
    await passQuality('SALES_DELIVERY', delivery.id, 2);
    assert.equal((await request(`/api/sales-deliveries/${delivery.id}`, 'warehouse', 'POST', { action: 'confirm' })).status, 200);
    assert.equal(db.prepare("SELECT count(*) count FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.id).count, 1);
  });
});
