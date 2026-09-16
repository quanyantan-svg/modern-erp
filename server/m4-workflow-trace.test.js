import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('M4 sales and purchase workflow trace', () => {
  let tmp; let db; let server; let baseUrl;
  const tokens = {};
  const request = (path, role) => fetch(baseUrl + path, { headers: role ? { authorization: `Bearer ${tokens[role]}` } : {} });

  beforeEach(async () => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-m4-'));
    db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    const now = '2026-09-16T00:00:00.000Z';
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('c','C','客户','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('s','S','供应商','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('w','W','仓库','','',1,?,?)").run(now, now);
    for (const [name, role] of [['admin', 'role-admin'], ['sales', 'role-sales'], ['warehouse', 'role-warehouse']]) {
      const password = `${name}-m4-password`; const hash = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(`u-${name}`, name, name, hash.hash, hash.salt, role, now);
    }
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('so','SO-M4','c','APPROVED',1000,'','u-sales',?,?,?,?)").run(now, now, now, now);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('po','PO-M4','s','APPROVED',1000,'','u-sales',?,?,?,?)").run(now, now, now, now);
    server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['admin', 'sales', 'warehouse']) {
      const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name}-m4-password` }) });
      tokens[name] = (await response.json()).token;
    }
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    db.close(); rmSync(tmp, { recursive: true, force: true });
  });

  test('trace endpoints require authentication', async () => {
    assert.equal((await request('/api/workflow/sales-orders/so')).status, 401);
    assert.equal((await request('/api/workflow/purchase-orders/po')).status, 401);
  });

  test('approved sales order does not fake a completed delivery stage', async () => {
    const response = await request('/api/workflow/sales-orders/so', 'sales');
    assert.equal(response.status, 200);
    const trace = await response.json();
    assert.equal(trace.root.status, 'APPROVED'); assert.deepEqual(trace.downstream, []);
  });

  test('approved purchase order does not fake a completed receipt stage', async () => {
    const trace = await (await request('/api/workflow/purchase-orders/po', 'sales')).json();
    assert.equal(trace.root.status, 'APPROVED'); assert.deepEqual(trace.downstream, []);
  });

  test('sales trace normalizes delivery, return and privileged voucher', async () => {
    const now = '2026-09-16T01:00:00.000Z';
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd','SD-M4','so','c','w','u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd-2','SD-M4-2','so','c','w','u-warehouse',300,'DRAFT','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at) VALUES('sr','SR-M4','SALES','sd','sd','c','w',200,'CONFIRMED','2026-09-16','','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES('v','V-M4','SALES_DELIVERY','sd','2026-09-16','','u-admin',?)").run(now);
    const trace = await (await request('/api/workflow/sales-orders/so', 'admin')).json();
    assert.equal(trace.downstream[0].documentNo, 'SD-M4');
    assert.equal(trace.downstream[0].returns[0].documentNo, 'SR-M4');
    assert.equal(trace.downstream[0].voucher.documentNo, 'V-M4');
    assert.equal(trace.downstream.length, 2);
  });

  test('purchase trace normalizes receipt, return and voucher', async () => {
    const now = '2026-09-16T01:00:00.000Z';
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('pr','PR-M4','po','s','w','u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at) VALUES('pret','PRET-M4','pr','s','w',200,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES('pv','PV-M4','PURCHASE_RECEIPT','pr','2026-09-16','','u-admin',?)").run(now);
    const trace = await (await request('/api/workflow/purchase-orders/po', 'admin')).json();
    assert.equal(trace.downstream[0].documentNo, 'PR-M4');
    assert.equal(trace.downstream[0].returns[0].documentNo, 'PRET-M4');
    assert.equal(trace.downstream[0].voucher.documentNo, 'PV-M4');
  });

  test('finance fields are filtered for non-accounting actor', async () => {
    const now = '2026-09-16T01:00:00.000Z';
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd','SD-M4','so','c','w','u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES('v','SECRET-VOUCHER','SALES_DELIVERY','sd','2026-09-16','','u-admin',?)").run(now);
    const trace = await (await request('/api/workflow/sales-orders/so', 'sales')).json();
    assert.deepEqual(trace.downstream[0].voucher, { type: 'FINANCIAL_RECORD', exists: true });
  });

  test('direct logistics details expose safe direct-business metadata', async () => {
    const now = '2026-09-16T01:00:00.000Z';
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('direct-sd','DIRECT-SD',NULL,'c','w','u-warehouse',1000,'DRAFT','2026-09-16','','u-warehouse',?,?)").run(now, now);
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('direct-pr','DIRECT-PR',NULL,'s','w','u-warehouse',1000,'DRAFT','2026-09-16','','u-warehouse',?,?)").run(now, now);
    assert.equal((await (await request('/api/sales-deliveries/direct-sd', 'warehouse')).json()).salesDelivery.relationships.direct, true);
    assert.equal((await (await request('/api/purchase-receipts/direct-pr', 'warehouse')).json()).purchaseReceipt.relationships.direct, true);
  });

  test('all four canonical source columns remain nullable', () => {
    for (const [table, column] of [['sales_deliveries', 'sales_order_id'], ['purchase_receipts', 'purchase_order_id'], ['return_orders', 'source_id'], ['purchase_returns', 'receipt_id']]) {
      const info = db.prepare(`PRAGMA table_info(${table})`).all().find((item) => item.name === column);
      assert.equal(info.notnull, 0, `${table}.${column}`);
    }
  });

  test('mobile component exposes completed, current, optional and direct presentation states', () => {
    const source = readFileSync(resolve(repoRoot, 'src/components/MobileWorkflowProgress.jsx'), 'utf8');
    for (const state of ['completed', 'current', 'optional', 'direct']) assert.match(source, new RegExp(state));
    assert.doesNotMatch(source, /source_id|foreign key|row handler/i);
  });
});
