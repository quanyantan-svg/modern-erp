import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { centsToYuanInput, yuanToCents } from '../src/lib/money.js';

describe('V1.3 Phase 1 process-integrity contract', () => {
  let temp;
  let db;
  let server;
  let baseUrl;
  const tokens = {};

  const request = async (path, role, method = 'GET', body) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${tokens[role]}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch { /* empty response */ }
    return { status: response.status, data };
  };

  beforeEach(async () => {
    temp = createTempDb({ label: 'v13-phase1', production: true });
    db = temp.db;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS','Customer','Alice','13000000000','Old customer address',1,?,?)").run(now, now);
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('sup','SUP','Supplier','Bob','13100000000','Old supplier address',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH','Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p1','P1','Product','','EA',200000,0,1,?,?)").run(now, now);
    db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('inv','wh','p1',10,?)").run(now);
    for (const [name, role] of [['admin', 'role-admin'], ['sales', 'role-sales'], ['reviewer', 'role-reviewer'], ['warehouse', 'role-warehouse'], ['accounting', 'role-accounting']]) {
      const password = `${name}-phase1-1234`;
      const hash = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
        .run(`user-${name}`, name, name, hash.hash, hash.salt, role, now);
    }
    db.prepare("INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES('EA','EA',1,?,?)").run(now, now);
    db.prepare("UPDATE products SET base_uom_code='EA' WHERE id='p1'").run();
    db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
      active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`).run(now, now, 'user-admin', 'user-admin');
    db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('phase1-group','P1','Phase 1 Sales',1,?,?)").run(now, now);
    db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('phase1-person','P1-SP','Phase 1 Sales','user-sales',1,?,?)").run(now, now);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
      VALUES('phase1-membership','phase1-person','phase1-group','2026-01-01',1,1,?,?,?,?)`).run(now, now, 'user-admin', 'user-admin');
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
      default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
      VALUES('phase1-class','p1',1,'EA','EA',0,0,0,1,?,?)`).run(now, now);
    const priceListId = '55555555-5555-4555-8555-555555555555';
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?,'P1-PL','Phase 1 price','CNY',0,'2026-01-01','ACTIVE',?,'user-reviewer',?,'user-sales',?,'user-sales')`).run(priceListId, now, now, now);
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
      pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
      VALUES('phase1-entry',?,'p1',NULL,'ALL','M:7031','A','EA','U:4541|Q:0000000000000000|D:20260101',0,'2026-01-01',?,'user-sales')`).run(priceListId, now);
    db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('phase1-version','phase1-entry',1,123456,'{}',?,'user-sales')").run(now);
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
      default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,created_by,updated_by,default_pricing_list_id)
      VALUES('cus','2026-01-01','cus','cus','phase1-person','phase1-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`).run(now, now, 'user-admin', 'user-admin', priceListId);
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['admin', 'sales', 'reviewer', 'warehouse', 'accounting']) {
      const response = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name, password: `${name}-phase1-1234` }),
      });
      tokens[name] = (await response.json()).token;
    }
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    temp.cleanup();
  });

  test('canonical role permissions authorize commercial entry and warehouse execution only', async () => {
    const permissions = (role) => new Set(db.prepare('SELECT permission_code FROM role_permissions WHERE role_id=?').all(role).map((row) => row.permission_code));
    const sales = permissions('role-sales');
    assert.ok(sales.has('PURCHASE_REQUISITION_MANAGE'));
    assert.ok(sales.has('PURCHASE_ORDERS_CREATE'));
    assert.ok(sales.has('PURCHASE_ORDERS_SUBMIT'));
    for (const denied of ['PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE', 'INVENTORY_TRANSFER_CREATE']) assert.equal(sales.has(denied), false);
    const warehouse = permissions('role-warehouse');
    assert.ok(warehouse.has('PRODUCTION_MATERIAL_ISSUE_MANAGE'));
    assert.ok(warehouse.has('PRODUCTION_RECEIPT_MANAGE'));
    assert.equal(warehouse.has('MRP_MANAGE'), false);
    assert.ok(permissions('role-reviewer').has('INVENTORY_CHECK_APPROVE'));
    assert.equal(permissions('role-accounting').has('VOUCHER_APPROVE'), false);
    assert.equal((await request('/api/purchase-receipts', 'sales', 'POST', { supplierId: 'sup', warehouseId: 'wh', items: [{ productId: 'p1', quantity: 1, unitPriceCents: 200000 }] })).status, 403);
    assert.equal((await request('/api/inventory-transfers', 'sales', 'POST', {})).status, 403);
  });

  test('yuan values round-trip as exact cents and affected UI exposes no raw-cent labels', () => {
    for (const [yuan, cents, display] of [['0.01', 1, '0.01'], ['1', 100, '1.00'], ['200', 20000, '200.00'], ['2000', 200000, '2000.00'], ['1234.56', 123456, '1234.56']]) {
      assert.equal(yuanToCents(yuan), cents);
      assert.equal(centsToYuanInput(cents), display);
    }
    for (const file of ['src/pages/master-data.jsx', 'src/pages/logistics-finance.jsx', 'src/pages/planning-documents.jsx', 'src/pages/discounts.jsx', 'src/pages/treasury-cost.jsx', 'src/pages/accounting.jsx']) {
      const source = readFileSync(resolve(file), 'utf8');
      assert.doesNotMatch(source, /(?:单价|金额|折让金额)（分）/, file);
    }
  });

  test('SO commercial snapshot survives master edits and MRP uses requested delivery date', async () => {
    const create = await request('/api/orders', 'sales', 'POST', {
      customerId: 'cus', orderDate: '2026-09-22', requestedDeliveryDate: '2026-10-10', paymentTerms: '月结 30 天',
      items: [{ productId: 'p1', quantity: 1, unitPriceCents: 123456 }],
    });
    assert.equal(create.status, 201, create.data.error);
    assert.equal((await request(`/api/orders/${create.data.id}/submit`, 'sales', 'POST', {})).status, 200);
    assert.equal((await request(`/api/orders/${create.data.id}/approve`, 'reviewer', 'POST', {})).status, 200);
    db.prepare("UPDATE customers SET contact='Changed',phone='999',address='New address' WHERE id='cus'").run();
    const detail = await request(`/api/orders/${create.data.id}`, 'sales');
    assert.equal(detail.data.order.shipToContactName, 'Alice');
    assert.equal(detail.data.order.shipToPhone, '13000000000');
    assert.equal(detail.data.order.shipToAddress, 'Old customer address');
    assert.equal(detail.data.order.items[0].unitPriceCents, 123456);
    const approval = await request('/api/approvals?tab=approved', 'reviewer');
    const item = approval.data.items.find((row) => row.documentId === create.data.id);
    assert.equal(item.requestedDeliveryDate, '2026-10-10');
    assert.equal(item.lines[0].unitPriceCents, 123456);

    const run = await request('/api/planning/mrp/runs', 'admin', 'POST', {
      runName: 'V1.3 requested date', horizonStart: '2026-10-01', horizonEnd: '2026-10-31', demandSourceMode: 'SALES_ORDERS',
    });
    assert.equal(run.status, 201, run.data.error);
    assert.equal((await request(`/api/planning/mrp/runs/${run.data.id}/execute`, 'admin', 'POST', {})).status, 200);
    const demand = db.prepare("SELECT need_date FROM mrp_run_demands WHERE run_id=? AND source_type='SALES_ORDER' AND source_id=?").get(run.data.id, create.data.id);
    assert.equal(demand.need_date, '2026-10-10');
  });

  test('PO rejects zero price and preserves supplier commercial snapshot', async () => {
    const body = {
      supplierId: 'sup', orderDate: '2026-09-22', expectedDeliveryDate: '2026-10-12', paymentTerms: '货到 30 天',
      items: [{ productId: 'p1', quantity: 1, unitPriceCents: 0 }],
    };
    const create = await request('/api/purchase-orders', 'sales', 'POST', body);
    assert.equal(create.status, 201, create.data.error);
    assert.equal((await request(`/api/purchase-orders/${create.data.id}/submit`, 'sales', 'POST', {})).status, 400);
    body.items[0].unitPriceCents = 200000;
    assert.equal((await request(`/api/purchase-orders/${create.data.id}`, 'sales', 'PUT', body)).status, 200);
    assert.equal((await request(`/api/purchase-orders/${create.data.id}/submit`, 'sales', 'POST', {})).status, 200);
    db.prepare("UPDATE suppliers SET contact='Changed',phone='999',address='New supplier address' WHERE id='sup'").run();
    const detail = await request(`/api/purchase-orders/${create.data.id}`, 'sales');
    assert.equal(detail.data.order.supplierContactName, 'Bob');
    assert.equal(detail.data.order.supplierContactPhone, '13100000000');
    assert.equal(detail.data.order.supplierAddress, 'Old supplier address');
    assert.equal(detail.data.order.totalCents, 200000);
  });

  test('PR estimate propagates to PO; absent estimate leaves a blocked zero-price draft', async () => {
    const make = async (unitPriceCents, editedUnitPriceCents = null) => {
      const pr = await request('/api/purchase-requisitions', 'sales', 'POST', {
        requestDate: '2026-09-22', requiredDate: '2026-10-15',
        items: [{ productId: 'p1', quantity: 1, preferredSupplierId: 'sup', unitPriceCents }],
      });
      assert.equal(pr.status, 201, pr.data.error);
      if (editedUnitPriceCents !== null) {
        const detail = await request(`/api/purchase-requisitions/${pr.data.id}`, 'sales');
        const edit = await request(`/api/purchase-requisitions/${pr.data.id}`, 'sales', 'PATCH', {
          requestDate: '2026-09-22', requiredDate: '2026-10-15', notes: 'draft estimate edited',
          items: detail.data.requisition.items.map((item) => ({ id: item.id, unitPriceCents: editedUnitPriceCents })),
        });
        assert.equal(edit.status, 200, edit.data.error);
      }
      assert.equal((await request(`/api/purchase-requisitions/${pr.data.id}/submit`, 'sales', 'POST', {})).status, 200);
      if (editedUnitPriceCents !== null) {
        assert.equal((await request(`/api/purchase-requisitions/${pr.data.id}`, 'sales', 'PATCH', { items: [] })).status, 409);
      }
      assert.equal((await request(`/api/purchase-requisitions/${pr.data.id}/approve`, 'reviewer', 'POST', {})).status, 200);
      const po = await request(`/api/purchase-requisitions/${pr.data.id}/generate-purchase-order`, 'sales', 'POST', { supplierId: 'sup', paymentTerms: '月结' });
      assert.equal(po.status, 201, po.data.error);
      return po.data.id;
    };
    const priced = await make(200000, 123456);
    assert.equal(db.prepare('SELECT unit_price_cents FROM purchase_order_items WHERE order_id=?').get(priced).unit_price_cents, 123456);
    const unpriced = await make(0);
    assert.equal(db.prepare('SELECT unit_price_cents FROM purchase_order_items WHERE order_id=?').get(unpriced).unit_price_cents, 0);
    assert.equal((await request(`/api/purchase-orders/${unpriced}/submit`, 'sales', 'POST', {})).status, 400);
  });

  test('manual vouchers require submit authority, positive integer cents, and exact balance', async () => {
    const subjects = db.prepare('SELECT id FROM accounting_subjects ORDER BY id LIMIT 2').all();
    const entries = [
      { subjectId: subjects[0].id, direction: 'DEBIT', amountCents: 200000 },
      { subjectId: subjects[1].id, direction: 'CREDIT', amountCents: 200000 },
    ];
    assert.equal((await request('/api/accounting-vouchers', 'accounting', 'POST', { voucherDate: '2026-09-22', entries })).status, 201);
    assert.equal((await request('/api/accounting-vouchers', 'reviewer', 'POST', { voucherDate: '2026-09-22', entries })).status, 403);
    assert.equal((await request('/api/accounting-vouchers', 'accounting', 'POST', { voucherDate: '2026-09-22', entries: [{ ...entries[0], amountCents: 1.5 }, entries[1]] })).status, 400);
    assert.equal((await request('/api/accounting-vouchers', 'accounting', 'POST', { voucherDate: '2026-09-22', entries: [entries[0], { ...entries[1], amountCents: 199999 }] })).status, 400);
  });
});
