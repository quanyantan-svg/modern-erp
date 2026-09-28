import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

describe('V1.4-E5 MySQL report dates and business selectors', () => {
  let handle; let db; let server; let baseUrl; let token;
  const createdAt = '2026-10-01T09:00:00.000Z';

  before(async () => {
    handle = createTempDb({ label: 'mysql-v14-e5', production: true });
    db = handle.db;
    const password = hashPassword('e5-admin-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('e5-admin','e5-admin','E5 Admin',?,?,'role-admin',1,?)`).run(password.hash, password.salt, createdAt);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES
      ('e5-customer','E5M-C001','MySQL 客户','','','',1,?,?),
      ('e5-customer-old','E5M-C002','MySQL 历史客户','','','',0,?,?)`).run(createdAt, createdAt, createdAt, createdAt);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('e5-supplier','E5M-S001','MySQL 供应商','','','',1,?,?)`).run(createdAt, createdAt);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
      VALUES('e5-product','E5M-P001','MySQL 产品','TEST','EA',100,0,1,?,?,'NONE','MOVING_AVERAGE','OTHER_INVENTORY')`).run(createdAt, createdAt);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES('e5-warehouse','E5M-W001','MySQL 仓库','','',1,?,?)`).run(createdAt, createdAt);

    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,requested_delivery_date)
      VALUES('e5-so','E5M-SO-001','e5-customer','APPROVED',10000,'e5-admin',?,?, '2026-09-30','2026-10-15')`).run(createdAt, createdAt);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('e5-soi','e5-so','e5-product',10,1000,10000,1)`).run();
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES('e5-sd','E5M-SD-001','e5-so','e5-customer','e5-warehouse','e5-admin','CONFIRMED',10000,'2026-10-02','','e5-admin',?,?,?,'e5-admin')`).run(createdAt, createdAt, createdAt);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
      VALUES('e5-sdi','e5-sd','e5-product',6,1000,6000,1,'e5-soi')`).run();
    db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at,order_date,expected_delivery_date)
      VALUES('e5-po','E5M-PO-001','e5-supplier','APPROVED',20000,'e5-admin',?,?, '2026-09-30','2026-10-16')`).run(createdAt, createdAt);
    db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('e5-poi','e5-po','e5-product',10,2000,20000,1)`).run();
    db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES('e5-pr','E5M-PR-001','e5-po','e5-supplier','e5-warehouse','e5-admin','CONFIRMED',20000,'2026-10-03','','e5-admin',?,?,?,'e5-admin')`).run(createdAt, createdAt, createdAt);
    db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id)
      VALUES('e5-pri','e5-pr','e5-product',6,2000,12000,1,'e5-poi')`).run();
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES('e5-tx','e5-warehouse','e5-product',1,'IN',1,'PURCHASE_RECEIPT','e5-pr','E5M-PR-001','','e5-admin',?,'2026-09-30')`).run(createdAt);

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'e5-admin', password: 'e5-admin-1234' }),
    });
    assert.equal(login.status, 200);
    token = (await login.json()).token;
  });

  after(async () => {
    server?.closeAllConnections?.();
    if (server) await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    handle?.cleanup();
  });

  async function get(path, csv = false) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { response, payload: csv ? await response.text() : await response.json() };
  }

  test('period activity uses order, shipment, receipt and inventory business dates', async () => {
    const salesSep = await get('/api/reports/decision/sales-summary?dateFrom=2026-09-01&dateTo=2026-09-30&customerId=e5-customer');
    assert.equal(salesSep.response.status, 200, JSON.stringify(salesSep.payload));
    assert.equal(salesSep.payload.summary.orderCount, 1);
    assert.equal(salesSep.payload.summary.deliveryCount, 0);
    const salesOct = await get('/api/reports/decision/sales-summary?dateFrom=2026-10-01&dateTo=2026-10-31&customerId=e5-customer');
    assert.equal(salesOct.payload.summary.orderCount, 0);
    assert.equal(salesOct.payload.summary.deliveryCount, 1);

    const purchaseSep = await get('/api/reports/decision/purchase-summary?dateFrom=2026-09-01&dateTo=2026-09-30&supplierId=e5-supplier');
    assert.equal(purchaseSep.payload.summary.orderCount, 1);
    assert.equal(purchaseSep.payload.summary.receiptCount, 0);
    const inventorySep = await get('/api/reports/decision/inventory-movements?dateFrom=2026-09-30&dateTo=2026-09-30&productId=e5-product&warehouseId=e5-warehouse');
    assert.equal(inventorySep.payload.rows.length, 1);
    assert.equal(inventorySep.payload.rows[0].businessDate, '2026-09-30');
  });

  test('lookup searches code/name, includes inactive history, and echoes canonical selections', async () => {
    const lookup = await get('/api/lookups/business-entities?type=CUSTOMER&usage=REPORT_SALES&q=E5M-C');
    assert.equal(lookup.response.status, 200, JSON.stringify(lookup.payload));
    assert.deepEqual(lookup.payload.items.map((row) => [row.code, row.active]), [['E5M-C001', 1], ['E5M-C002', 0]]);
    assert.match(lookup.payload.items[1].label, /已停用/);
    const report = await get('/api/reports/decision/sales-summary?customerId=e5-customer-old');
    assert.equal(report.payload.filters.customer.id, 'e5-customer-old');
    assert.equal(report.payload.filters.customer.active, 0);
  });

  test('unfulfilled ranges use commitment dates and export keeps readable labels', async () => {
    const sales = await get('/api/reports/decision/sales-outstanding?dateFrom=2026-10-15&dateTo=2026-10-15&customerId=e5-customer');
    assert.equal(sales.payload.rows.length, 1);
    assert.equal(sales.payload.rows[0].commitmentDate, '2026-10-15');
    const purchase = await get('/api/reports/decision/purchase-outstanding?dateFrom=2026-10-16&dateTo=2026-10-16&supplierId=e5-supplier');
    assert.equal(purchase.payload.rows.length, 1);
    assert.equal(purchase.payload.rows[0].commitmentDate, '2026-10-16');
    const exported = await get('/api/reports/decision/sales-summary/export?customerId=e5-customer&dateFrom=2026-09-30&dateTo=2026-09-30', true);
    assert.equal(exported.response.status, 200);
    assert.match(exported.payload, /# 客户: E5M-C001 · MySQL 客户/);
    assert.match(exported.payload, /订单,E5M-SO-001/);
    assert.doesNotMatch(exported.payload, /e5-customer/);
  });
});
