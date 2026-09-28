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

describe('V1.4-E6 MySQL line-level fulfillment reporting', () => {
  let handle; let db; let server; let baseUrl; let token;
  const timestamp = '2026-09-28T08:00:00.000Z';

  before(async () => {
    handle = createTempDb({ label: 'mysql-v14-e6', production: true });
    db = handle.db;
    const password = hashPassword('e6-admin-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('e6-admin','e6-admin','E6 Admin',?,?,'role-admin',1,?)`).run(password.hash, password.salt, timestamp);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('e6-customer','E6-C001','E6 客户','','','',1,?,?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('e6-supplier','E6-S001','E6 供应商','','','',1,?,?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
      VALUES
      ('e6-fg','FG-DT100','成品 DT100','TEST','EA',100,0,1,?,?,'NONE','MOVING_AVERAGE','OTHER_INVENTORY'),
      ('e6-rm','RM-PCB100','原料 PCB100','TEST','EA',100,0,1,?,?,'NONE','MOVING_AVERAGE','OTHER_INVENTORY')`).run(timestamp, timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES('e6-warehouse','E6-W001','E6 仓库','','',1,?,?)`).run(timestamp, timestamp);

    const addSalesOrder = (id, no, date, productId, quantity) => {
      db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date)
        VALUES(?,?, 'e6-customer','APPROVED',0,'','e6-admin',?,?,'2026-09-01',?)`).run(id, no, timestamp, timestamp, date);
      db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES(?,?,?, ?,100,0,1)`).run(`${id}-item`, id, productId, quantity);
    };
    const addSalesDelivery = (id, no, orderId, date, quantity, sourceId) => {
      db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
        VALUES(?,?,?,'e6-customer','e6-warehouse','e6-admin','CONFIRMED',0,?,'','e6-admin',?,?,?,'e6-admin')`).run(id, no, orderId, date, timestamp, timestamp, timestamp);
      db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
        VALUES(?,?, 'e6-fg',?,100,0,1,?)`).run(`${id}-item`, id, quantity, sourceId);
    };
    addSalesOrder('e6-so-partial', 'E6-SO-001', '2026-09-20', 'e6-fg', 10);
    addSalesDelivery('e6-sd-partial', 'E6-SD-001', 'e6-so-partial', '2026-09-18', 6, 'e6-so-partial-item');
    addSalesOrder('e6-so-today', 'E6-SO-002', '2026-09-28', 'e6-fg', 10);
    addSalesOrder('e6-so-future', 'E6-SO-003', '2026-10-10', 'e6-fg', 10);
    addSalesOrder('e6-so-missing', 'E6-SO-004', null, 'e6-fg', 10);
    addSalesOrder('e6-so-full', 'E6-SO-005', '2026-09-10', 'e6-fg', 10);
    addSalesDelivery('e6-sd-full', 'E6-SD-005', 'e6-so-full', '2026-09-09', 10, 'e6-so-full-item');
    addSalesOrder('e6-so-over', 'E6-SO-006', '2026-09-11', 'e6-fg', 1.5);
    addSalesDelivery('e6-sd-over', 'E6-SD-006', 'e6-so-over', '2026-09-10', 1.75, 'e6-so-over-item');
    addSalesOrder('e6-so-legacy', 'E6-SO-007', '2026-09-12', 'e6-fg', 10);
    addSalesDelivery('e6-sd-legacy', 'E6-SD-007', 'e6-so-legacy', '2026-09-11', 4, null);
    db.prepare(`INSERT INTO return_orders(id,return_no,source_type,source_id,customer_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES('e6-sret','E6-SRET-001','SALES','e6-sd-full','e6-customer','e6-warehouse',0,'CONFIRMED','2026-09-12','','','e6-admin',?,?,?,'e6-admin')`).run(timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,delivery_item_id)
      VALUES('e6-sreti','e6-sret','e6-fg',2,100,0,1,'e6-sd-full-item')`).run();

    const addPurchaseOrder = (id, no, date, quantity) => {
      db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date)
        VALUES(?,?, 'e6-supplier','APPROVED',0,'','e6-admin',?,?,'2026-09-01',?)`).run(id, no, timestamp, timestamp, date);
      db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES(?,?, 'e6-rm',?,100,0,1)`).run(`${id}-item`, id, quantity);
    };
    const addReceipt = (id, no, orderId, date, quantity, sourceId) => {
      db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
        VALUES(?,?,?,'e6-supplier','e6-warehouse','e6-admin','CONFIRMED',0,?,'','e6-admin',?,?,?,'e6-admin')`).run(id, no, orderId, date, timestamp, timestamp, timestamp);
      db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id)
        VALUES(?,?, 'e6-rm',?,100,0,1,?)`).run(`${id}-item`, id, quantity, sourceId);
    };
    addPurchaseOrder('e6-po-partial', 'E6-PO-001', '2026-09-20', 10);
    addReceipt('e6-pr-partial', 'E6-PR-001', 'e6-po-partial', '2026-09-18', 6, 'e6-po-partial-item');
    addPurchaseOrder('e6-po-full', 'E6-PO-002', '2026-09-10', 10);
    addReceipt('e6-pr-full', 'E6-PR-002', 'e6-po-full', '2026-09-09', 10, 'e6-po-full-item');
    addPurchaseOrder('e6-po-legacy', 'E6-PO-003', null, 10);
    addReceipt('e6-pr-legacy', 'E6-PR-003', 'e6-po-legacy', '2026-09-11', 4, null);
    db.prepare(`INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES('e6-pret','E6-PRET-001','e6-pr-full','e6-supplier','e6-warehouse',0,'CONFIRMED','2026-09-12','','','e6-admin',?,?,?,'e6-admin')`).run(timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO purchase_return_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,receipt_item_id)
      VALUES('e6-preti','e6-pret','e6-rm',2,100,0,1,'e6-pr-full-item')`).run();

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'e6-admin', password: 'e6-admin-1234' }),
    });
    assert.equal(login.status, 200);
    token = (await login.json()).token;
  });

  after(async () => {
    server?.closeAllConnections?.();
    if (server) await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    handle?.cleanup();
  });

  async function get(path) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { response, body: await response.json() };
  }

  test('sales aggregation, decimal exceptions, legacy accuracy and sorting match SQLite semantics', async () => {
    const { response, body } = await get('/api/reports/decision/sales-outstanding?asOfDate=2026-09-28');
    assert.equal(response.status, 200, JSON.stringify(body));
    const partial = body.rows.find((row) => row.orderItemId === 'e6-so-partial-item');
    const over = body.rows.find((row) => row.orderItemId === 'e6-so-over-item');
    const legacy = body.rows.find((row) => row.orderItemId === 'e6-so-legacy-item');
    assert.deepEqual([partial.orderedQuantity, partial.fulfilledQuantity, partial.remainingQuantity, partial.overdueDays], [10, 6, 4, 8]);
    assert.deepEqual([over.remainingQuantity, over.overFulfilledQuantity, over.fulfillmentStatus], [0, 0.25, 'OVER_FULFILLED']);
    assert.deepEqual([legacy.fulfilledQuantity, legacy.accuracyStatus], [0, 'LIMITED']);
    const ids = body.rows.map((row) => row.orderItemId);
    assert.ok(ids.indexOf('e6-so-partial-item') < ids.indexOf('e6-so-today-item'));
    assert.ok(ids.indexOf('e6-so-future-item') < ids.indexOf('e6-so-missing-item'));
    assert.equal(ids.includes('e6-so-full-item'), false);
    assert.equal((await get('/api/reports/decision/sales-outstanding?includeFulfilled=true&asOfDate=2026-09-28')).body.rows.some((row) => row.orderItemId === 'e6-so-full-item'), true);
  });

  test('purchase quantities and returns retain the original fulfilled obligation', async () => {
    const hidden = (await get('/api/reports/decision/purchase-outstanding?asOfDate=2026-09-28')).body;
    const partial = hidden.rows.find((row) => row.orderItemId === 'e6-po-partial-item');
    const legacy = hidden.rows.find((row) => row.orderItemId === 'e6-po-legacy-item');
    assert.deepEqual([partial.orderedQuantity, partial.receivedQuantity, partial.remainingQuantity, partial.fulfillmentStatus], [10, 6, 4, 'PARTIAL']);
    assert.deepEqual([legacy.receivedQuantity, legacy.accuracyStatus], [0, 'LIMITED']);
    const shown = (await get('/api/reports/decision/purchase-outstanding?includeFulfilled=true&asOfDate=2026-09-28')).body;
    const full = shown.rows.find((row) => row.orderItemId === 'e6-po-full-item');
    assert.deepEqual([full.receivedQuantity, full.remainingQuantity, full.fulfillmentStatus], [10, 0, 'FULFILLED']);
  });

  test('lazy contribution endpoints return only exact line-linked evidence', async () => {
    let result = await get('/api/reports/sales-outstanding/lines/e6-so-partial-item/contributions');
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.executedQuantity, result.body.contributions[0].sourceDocumentNumber, result.body.contributions[0].quantity], [6, 'E6-SD-001', 6]);
    result = await get('/api/reports/purchase-outstanding/lines/e6-po-partial-item/contributions');
    assert.deepEqual([result.body.executedQuantity, result.body.contributions[0].sourceDocumentNumber, result.body.contributions[0].quantity], [6, 'E6-PR-001', 6]);
    result = await get('/api/reports/sales-outstanding/lines/e6-so-legacy-item/contributions');
    assert.deepEqual([result.body.contributions.length, result.body.accuracyStatus, result.body.informationalItems[0].code], [0, 'LIMITED', 'LEGACY_SOURCE_MISSING']);
  });
});
