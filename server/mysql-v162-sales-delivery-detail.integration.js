import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

describe('V1.6.2 Phase 1 real MySQL sales-delivery detail relationship query', () => {
  let mysql; let db;
  const at = '2026-10-03T08:00:00.000Z';
  const actor = {
    id: 'v162-mysql-admin',
    roleCode: 'ADMIN',
    permissions: ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE', 'OQC_VIEW', 'OQC_MANAGE'],
  };

  before(() => {
    mysql = createTempDb({ label: 'mysql-v162-sales-delivery', production: true });
    db = mysql.db;
    db.prepare(
      "INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,'role-admin',1,?)",
    ).run(actor.id, actor.id, 'V162 MySQL Admin', 'x', 'x', at);
    db.prepare(
      "INSERT INTO customers(id,code,name,active,created_at,updated_at) VALUES('v162-c','V162-C','V162 Customer',1,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES('v162-w','V162-W','V162 Warehouse',1,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,inventory_classification) VALUES('v162-p','V162-P','V162 Product','EA',500,100,1,?,?,'EA','NONE','MOVING_AVERAGE','OTHER_INVENTORY')",
    ).run(at, at);
    db.prepare(
      "INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,order_date,creator_id,created_at,updated_at) VALUES('v162-so','SO-V162-MYSQL','v162-c','APPROVED',1500,'2026-10-03',?,?,?)",
    ).run(actor.id, at, at);
    db.prepare(
      "INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('v162-soi','v162-so','v162-p',3,500,1500,1)",
    ).run();
    db.prepare(
      "INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,creator_id,created_at,updated_at,billing_mode) VALUES('v162-sd','SD-V162-MYSQL','v162-so','v162-c','v162-w',?,1500,'2026-10-03',?,?,?,?)",
    ).run(actor.id, actor.id, at, at, 'SEPARATE');
    db.prepare(
      "INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,base_quantity_num,base_quantity_den) VALUES('v162-sdi','v162-sd','v162-p',3,500,1500,1,'v162-soi',3,1)",
    ).run();
    // Two invoices pointing at the same delivery through different invoice items
    // (intentionally duplicates to verify the EXISTS query does not emit two rows
    //  for the same invoice even when there are multiple invoice_item rows for it).
    db.prepare(
      "INSERT INTO sales_invoices(id,invoice_no,customer_id,status,total_cents,created_at,updated_at) VALUES('v162-v1','V162-V1','v162-c','DRAFT',800,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO sales_invoices(id,invoice_no,customer_id,status,total_cents,created_at,updated_at) VALUES('v162-v2','V162-V2','v162-c','POSTED',700,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO sales_invoice_items(id,invoice_id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,base_quantity_num,base_quantity_den) VALUES('v162-vi1a','v162-v1','v162-sd','v162-p',2,400,800,2,1)",
    ).run();
    db.prepare(
      "INSERT INTO sales_invoice_items(id,invoice_id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,base_quantity_num,base_quantity_den) VALUES('v162-vi1b','v162-v1','v162-sd','v162-p',1,400,400,1,1)",
    ).run();
    db.prepare(
      "INSERT INTO sales_invoice_items(id,invoice_id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,base_quantity_num,base_quantity_den) VALUES('v162-vi2','v162-v2','v162-sd','v162-p',1,700,700,1,1)",
    ).run();
  });

  after(() => mysql.cleanup());

  test('relationships.downstream SALES_INVOICE has no duplicates and stable ordering on MySQL 8', async () => {
    const { getSalesDelivery } = await import('./app.js');
    let captured;
    const fakeRes = {
      status() { return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      writeHead(status, headers) { captured = { status, headers }; return this; },
      end(body) {
        if (body) {
          try { captured.body = JSON.parse(body); } catch { captured.body = body; }
        } else if (captured) {
          captured.body = undefined;
        }
        return this;
      },
    };
    getSalesDelivery(db, fakeRes, actor, 'v162-sd');
    assert.equal(captured.status, 200);
    assert.equal(captured.headers?.['Cache-Control'], 'no-store');
    assert.equal(captured.headers?.['X-Content-Type-Options'], 'nosniff');
    const delivery = captured.body?.salesDelivery;
    assert.ok(delivery, 'salesDelivery payload must be returned');
    assert.equal(delivery.id, 'v162-sd');
    const downstream = delivery.relationships?.downstream || [];
    const invoices = downstream.filter((row) => row.type === 'SALES_INVOICE');
    assert.ok(invoices.length >= 1, 'at least one SALES_INVOICE relationship must exist');
    const ids = invoices.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate invoices in relationships.downstream');
    for (const row of invoices) {
      assert.match(row, { type: 'SALES_INVOICE' });
      assert.ok(typeof row.id === 'string' && row.id.length > 0);
      assert.ok(typeof row.documentNo === 'string' && row.documentNo.length > 0);
      assert.ok(typeof row.status === 'string' && row.status.length > 0);
    }
    // Replay the call to assert deterministic ordering.
    let capturedReplay;
    const fakeRes2 = {
      status() { return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      writeHead(status) { capturedReplay = { status }; return this; },
      end(body) {
        if (body) {
          try { capturedReplay.body = JSON.parse(body); } catch { capturedReplay.body = body; }
        }
        return this;
      },
    };
    getSalesDelivery(db, fakeRes2, actor, 'v162-sd');
    const downstreamReplay = capturedReplay.body?.salesDelivery?.relationships?.downstream || [];
    assert.deepEqual(
      downstreamReplay,
      downstream,
      'relationships.downstream must be deterministic across calls',
    );
  });

  test('sales-delivery relationship query is portable (no MySQL-only SQL)', () => {
    // The fixed query uses a correlated EXISTS subquery with the order-by column
    // appearing in the SELECT list; this avoids ER_FIELD_IN_ORDER_NOT_SELECT on
    // MySQL 8 and remains SQLite-compatible.
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const { dirname, resolve } = require('node:path');
    const { fileURLToPath } = require('node:url');
    const appSource = readFileSync(
      join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'server/app.js'),
      'utf8',
    );
    assert.doesNotMatch(
      appSource,
      /SELECT DISTINCT v\.id,v\.invoice_no documentNo,v\.status FROM sales_invoices v JOIN sales_invoice_items/,
    );
    assert.match(
      appSource,
      /SELECT v\.id,v\.invoice_no documentNo,v\.status FROM sales_invoices v WHERE EXISTS \(SELECT 1 FROM sales_invoice_items i WHERE i\.invoice_id=v\.id AND i\.delivery_id=\?\) ORDER BY v\.created_at,v\.id/,
    );
  });
});
