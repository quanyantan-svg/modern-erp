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

function seedReceipt() {
  const n = ++sequence;
  const poId = `r6-po-${n}`;
  const poItemId = `r6-poi-${n}`;
  const receiptId = `r6-pr-${n}`;
  const receiptItemId = `r6-pri-${n}`;
  db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,?,'APPROVED',1000,'user-admin',?,?)").run(poId, `PO-R6-${n}`, 'supplier-001', at, at);
  db.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(poItemId, poId, 'product-001', 2, 500, 1000);
  db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1000,'DRAFT',?,?, 'user-warehouse',?,?)")
    .run(receiptId, `PR-R6-${n}`, poId, 'supplier-001', 'warehouse-001', 'user-warehouse', '2026-10-15', 'UAT-001 fixture', at, at);
  db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,1,?)')
    .run(receiptItemId, receiptId, 'product-001', 2, 500, 1000, poItemId);
  return { receiptId, receiptItemId, poId, poItemId };
}

function seedBill(receiptId, receiptItemId, supplierId = 'supplier-001', createdAt = at) {
  const n = ++sequence;
  const billId = `r6-bill-${n}`;
  db.prepare("INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,creator_id,created_at) VALUES(?,?,?,?,?,?,'NO_TAX','user-admin',?)").run(billId, `BILL-R6-${n}`, supplierId, `EXT-R6-${n}`, '2026-10-15', 'DRAFT', createdAt);
  db.prepare('INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(`r6-billi-${n}`, billId, receiptId, receiptItemId, 'product-001', 'PCS', 2, 1, 1, 1, 2, 1, 500, 1000, 0, 1000);
  return billId;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-uat-r6-'));
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

describe('UAT-001 purchase receipt supplier bill downstream query', () => {
  test('1. purchase receipt detail loads with single supplier bill relationship', async () => {
    const f = seedReceipt();
    seedBill(f.receiptId, f.receiptItemId);
    const result = await request(`/api/purchase-receipts/${f.receiptId}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const bills = (result.data.purchaseReceipt.relationships.downstream || []).filter((entry) => entry.type === 'SUPPLIER_BILL');
    assert.equal(bills.length, 1);
    assert.equal(typeof bills[0].id, 'string');
    assert.equal(typeof bills[0].documentNo, 'string');
    assert.equal(typeof bills[0].status, 'string');
  });

  test('2. multiple supplier bills referencing the same receipt line are returned exactly once', async () => {
    const f = seedReceipt();
    seedBill(f.receiptId, f.receiptItemId);
    seedBill(f.receiptId, f.receiptItemId);
    seedBill(f.receiptId, f.receiptItemId);
    const result = await request(`/api/purchase-receipts/${f.receiptId}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const bills = (result.data.purchaseReceipt.relationships.downstream || []).filter((entry) => entry.type === 'SUPPLIER_BILL');
    const ids = bills.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `expected distinct supplier bills, got ${JSON.stringify(ids)}`);
  });

  test('3. source contract forbids ORDER BY on non-selected DISTINCT columns', () => {
    const path = resolve('server/app.js');
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /SELECT\s+DISTINCT\s+b\.id,b\.bill_no documentNo,b\.status\s+FROM\s+supplier_bills\s+b\s+JOIN\s+supplier_bill_items\s+i\s+ON\s+i\.bill_id=b\.id\s+WHERE\s+i\.receipt_id=\?\s+ORDER\s+BY\s+b\.created_at/i);
    assert.match(source, /SELECT\s+b\.id,b\.bill_no\s+documentNo,b\.status\s+FROM\s+supplier_bills\s+b\s+WHERE\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+supplier_bill_items\s+i\s+WHERE\s+i\.bill_id=b\.id\s+AND\s+i\.receipt_id=\?\s*\)\s+ORDER\s+BY\s+b\.created_at/i);
  });

  test('4. detail still returns purchase return downstream entries alongside supplier bills', async () => {
    const f = seedReceipt();
    seedBill(f.receiptId, f.receiptItemId);
    db.prepare("INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,status,total_cents,return_date,creator_id,created_at,updated_at) VALUES(?,?,?,?,?, 'DRAFT',500,'2026-10-16','user-admin',?,?)")
      .run(`r6-rt-${++sequence}`, `RT-R6-${sequence}`, f.receiptId, 'supplier-001', 'warehouse-001', at, at);
    const result = await request(`/api/purchase-receipts/${f.receiptId}`);
    assert.equal(result.status, 200);
    const downstream = result.data.purchaseReceipt.relationships.downstream || [];
    assert.ok(downstream.some((entry) => entry.type === 'PURCHASE_RETURN'));
    assert.ok(downstream.some((entry) => entry.type === 'SUPPLIER_BILL'));
  });

  test('5. supplier bill ordering is stable by creation time and id', async () => {
    const f = seedReceipt();
    const late = seedBill(f.receiptId, f.receiptItemId, 'supplier-001', '2026-10-02T10:00:00.000Z');
    const sameTimeA = seedBill(f.receiptId, f.receiptItemId, 'supplier-001', '2026-10-02T09:00:00.000Z');
    const sameTimeB = seedBill(f.receiptId, f.receiptItemId, 'supplier-001', '2026-10-02T09:00:00.000Z');
    const result = await request(`/api/purchase-receipts/${f.receiptId}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const ids = result.data.purchaseReceipt.relationships.downstream
      .filter((entry) => entry.type === 'SUPPLIER_BILL')
      .map((entry) => entry.id);
    assert.deepEqual(ids, [sameTimeA, sameTimeB].sort().concat(late));
  });
});
