import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { analyzeArchiveEligibility } from './modules/lifecycle-engine.js';

let db;
let server;
let baseUrl;
let tempDir;
let adminToken;
let warehouseToken;
let reviewerToken;
let accountingToken;
let adminActor;
let sequence = 0;
const at = '2026-09-29T08:00:00.000Z';

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

function actor(userId) {
  const value = db.prepare(`SELECT u.id,r.code roleCode FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(userId);
  value.permissions = db.prepare('SELECT permission_code code FROM role_permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?)').all(userId).map((row) => row.code);
  return value;
}

function seedReceipt(status = 'CANCELLED', receiptDate = '2026-10-15') {
  const n = ++sequence;
  const poId = `d1-po-${n}`;
  const poItemId = `d1-poi-${n}`;
  const receiptId = `d1-pr-${n}`;
  const receiptItemId = `d1-pri-${n}`;
  db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,?,'APPROVED',1000,'user-admin',?,?)").run(poId, `PO-D1-${n}`, 'supplier-001', at, at);
  db.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(poItemId, poId, 'product-001', 2, 500, 1000);
  db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1000,?,?,?, ?,?,?)')
    .run(receiptId, `PR-D1-${n}`, poId, 'supplier-001', 'warehouse-001', 'user-warehouse', status, receiptDate, 'D1 archive fixture', 'user-warehouse', at, at);
  db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,1,?)')
    .run(receiptItemId, receiptId, 'product-001', 2, 500, 1000, poItemId);
  db.prepare("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,'CANCEL','PURCHASE_RECEIPT',?,'取消采购入库',?)")
    .run(`d1-cancel-audit-${n}`, 'user-warehouse', receiptId, at);
  return { receiptId, receiptItemId, poId, poItemId, receiptNo: `PR-D1-${n}`, receiptDate };
}

async function archive(id, token = warehouseToken) {
  return request('/api/lifecycle/archive', { token, method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: id, reason: '从正常业务列表移除测试取消单' } });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v15-d1-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  warehouseToken = await login('warehouse', 'warehouse123');
  reviewerToken = await login('reviewer', 'review123');
  accountingToken = await login('accounting', 'accounting123');
  adminActor = actor('user-admin');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V1.5 D1 purchase receipt safe archive', () => {
  test('eligible CANCELLED receipt archives without mutating authoritative data and default list hides it', async () => {
    const fixture = seedReceipt();
    const before = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(fixture.receiptId);
    const beforeLine = db.prepare('SELECT * FROM purchase_receipt_items WHERE id=?').get(fixture.receiptItemId);
    const result = await archive(fixture.receiptId);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.archived, true);
    assert.equal(result.data.archiveEligibility.allowed, true);
    assert.deepEqual(db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(fixture.receiptId), before);
    assert.deepEqual(db.prepare('SELECT * FROM purchase_receipt_items WHERE id=?').get(fixture.receiptItemId), beforeLine);
    assert.equal(db.prepare('SELECT active FROM lifecycle_archives WHERE entity_type=? AND entity_id=?').get('PURCHASE_RECEIPT', fixture.receiptId).active, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='ARCHIVE'").get(fixture.receiptId).n, 1);
    const hidden = await request(`/api/purchase-receipts?search=${fixture.receiptNo}`, { token: warehouseToken });
    assert.equal(hidden.data.purchaseReceipts.length, 0);
    const visible = await request(`/api/purchase-receipts?search=${fixture.receiptNo}&includeArchived=true`, { token: warehouseToken });
    assert.equal(visible.data.purchaseReceipts.length, 1);
    assert.equal(visible.data.purchaseReceipts[0].archiveState.archived, true);
    const detail = await request(`/api/purchase-receipts/${fixture.receiptId}`, { token: warehouseToken });
    assert.equal(detail.data.purchaseReceipt.status, 'CANCELLED');
    assert.equal(detail.data.purchaseReceipt.archiveState.archived, true);
    assert.equal(detail.data.purchaseReceipt.items.length, 1);
  });

  test('wrong states and a second active archive return deterministic structured errors', async () => {
    const missing = await archive('d1-missing');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.code, 'NOT_FOUND');
    for (const status of ['DRAFT', 'CONFIRMED']) {
      const fixture = seedReceipt(status);
      const result = await archive(fixture.receiptId);
      assert.equal(result.status, 409);
      assert.equal(result.data.code, 'INVALID_STATE');
    }
    const fixture = seedReceipt();
    assert.equal((await archive(fixture.receiptId)).status, 200);
    const second = await archive(fixture.receiptId);
    assert.equal(second.status, 409);
    assert.equal(second.data.code, 'ALREADY_ARCHIVED');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='ARCHIVE'").get(fixture.receiptId).n, 1);
  });

  test('real downstream, stock, tracking, financial and closed-period facts block archive', () => {
    const cases = [
      ['IQC', 'DOWNSTREAM_DEPENDENCY', (f, n) => db.prepare("INSERT INTO iqc_inspections(id,iqc_no,supplier_id,receipt_id,purchase_receipt_id,status,created_at,updated_at) VALUES(?,?,?, ?,?,'PENDING',?,?)").run(`d1-iqc-${n}`, `IQC-D1-${n}`, 'supplier-001', f.receiptId, f.receiptId, at, at)],
      ['PURCHASE_RETURN', 'DOWNSTREAM_DEPENDENCY', (f, n) => db.prepare("INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,status,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT','user-warehouse',?,?)").run(`d1-ret-${n}`, `PRET-D1-${n}`, f.receiptId, 'supplier-001', 'warehouse-001', at, at)],
      ['INVENTORY', 'STOCK_EFFECT_EXISTS', (f, n) => db.prepare("INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,creator_id,created_at,business_date) VALUES(?,?,?,1,'IN','PURCHASE_RECEIPT',?,'user-warehouse',?,?)").run(`d1-tx-${n}`, 'warehouse-001', 'product-001', f.receiptId, at, f.receiptDate)],
      ['TRACKING', 'TRACKING_EFFECT_EXISTS', (f, n) => db.prepare("INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,business_date,created_at) VALUES(?,'PURCHASE_RECEIPT',?,?,?,?, 'IN',1,?,?)").run(`d1-track-${n}`, f.receiptId, f.receiptItemId, 'product-001', 'warehouse-001', f.receiptDate, at)],
      ['VALUATION', 'FINANCIAL_DEPENDENCY', (f, n) => db.prepare("INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,quantity_delta,value_delta_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,created_at) VALUES(?,?,?,?,1,500,'TEST','PURCHASE_RECEIPT','PURCHASE_RECEIPT',?,?,?)").run(`d1-value-${n}`, f.receiptDate, 'product-001', 'warehouse-001', f.receiptId, f.receiptItemId, at)],
      ['AP', 'FINANCIAL_DEPENDENCY', (f, n) => db.prepare("INSERT INTO account_payables(id,voucher_no,supplier_id,source_type,source_id,amount_cents,status,due_date,creator_id,created_at,business_date) VALUES(?,?,?,'PURCHASE_RECEIPT',?,1000,'PENDING',?,'user-admin',?,?)").run(`d1-ap-${n}`, `AP-D1-${n}`, 'supplier-001', f.receiptId, f.receiptDate, at, f.receiptDate)],
      ['CLOSED_PERIOD', 'CLOSED_PERIOD', (f, n) => db.prepare("INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at) VALUES(?,?,'CLOSED','user-admin',?)").run(`d1-close-${n}`, f.receiptDate.slice(0, 7), at)],
    ];
    let n = 0;
    for (const [label, expected, seed] of cases) {
      n += 1;
      const fixture = seedReceipt('CANCELLED', `2027-${String(n).padStart(2, '0')}-15`);
      seed(fixture, n);
      const eligibility = analyzeArchiveEligibility(db, adminActor, 'PURCHASE_RECEIPT', fixture.receiptId);
      assert.equal(eligibility.allowed, false, label);
      assert.ok(eligibility.blockers.some((blocker) => blocker.code === expected), `${label}: ${JSON.stringify(eligibility.blockers)}`);
    }
  });

  test('supplier bill relationship blocks archive without exposing storage details', async () => {
    const f = seedReceipt();
    const n = ++sequence;
    db.prepare("INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,creator_id,created_at) VALUES(?,?,?,?,?,'DRAFT','NO_TAX','user-admin',?)").run(`d1-bill-${n}`, `BILL-D1-${n}`, 'supplier-001', `EXT-D1-${n}`, f.receiptDate, at);
    db.prepare('INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(`d1-billi-${n}`, `d1-bill-${n}`, f.receiptId, f.receiptItemId, 'product-001', 'PCS', 2, 1, 1, 1, 2, 1, 500, 1000, 0, 1000);
    const result = await archive(f.receiptId);
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'FINANCIAL_DEPENDENCY');
    assert.doesNotMatch(JSON.stringify(result.data), /supplier_bill_items|SELECT|JOIN/i);
  });

  test('archive authorization is domain-scoped and restore is ADMIN-only', async () => {
    const denied = seedReceipt();
    for (const token of [reviewerToken, accountingToken]) {
      const result = await archive(denied.receiptId, token);
      assert.equal(result.status, 403);
      assert.equal(result.data.code, 'FORBIDDEN');
    }
    const adminFixture = seedReceipt();
    assert.equal((await archive(adminFixture.receiptId, adminToken)).status, 200);
    const nonAdminRestore = await request('/api/lifecycle/restore', { token: warehouseToken, method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: adminFixture.receiptId } });
    assert.equal(nonAdminRestore.status, 403);
    assert.equal(nonAdminRestore.data.code, 'FORBIDDEN');
  });

  test('ADMIN restore only changes list visibility and appends audit', async () => {
    const f = seedReceipt();
    const before = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(f.receiptId);
    const beforeLine = db.prepare('SELECT * FROM purchase_receipt_items WHERE id=?').get(f.receiptItemId);
    assert.equal((await archive(f.receiptId)).status, 200);
    const restored = await request('/api/lifecycle/restore', { method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: f.receiptId, reason: '恢复正常列表可见性' } });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.deepEqual(db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(f.receiptId), before);
    assert.deepEqual(db.prepare('SELECT * FROM purchase_receipt_items WHERE id=?').get(f.receiptItemId), beforeLine);
    assert.equal(db.prepare('SELECT active FROM lifecycle_archives WHERE entity_type=? AND entity_id=?').get('PURCHASE_RECEIPT', f.receiptId).active, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='RESTORE'").get(f.receiptId).n, 1);
    const list = await request(`/api/purchase-receipts?search=${f.receiptNo}`, { token: warehouseToken });
    assert.equal(list.data.purchaseReceipts.length, 1);
    assert.equal(list.data.purchaseReceipts[0].status, 'CANCELLED');
    const second = await request('/api/lifecycle/restore', { method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: f.receiptId } });
    assert.equal(second.status, 409);
    assert.equal(second.data.code, 'RESTORE_BLOCKED');
  });

  test('concurrent archive and restore requests have one effective transition', async () => {
    const f = seedReceipt();
    const archiveResults = await Promise.all([archive(f.receiptId), archive(f.receiptId)]);
    assert.deepEqual(archiveResults.map((result) => result.status).sort(), [200, 409]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='ARCHIVE'").get(f.receiptId).n, 1);
    const restoreBody = { entityType: 'PURCHASE_RECEIPT', entityId: f.receiptId };
    const restoreResults = await Promise.all([
      request('/api/lifecycle/restore', { method: 'POST', body: restoreBody }),
      request('/api/lifecycle/restore', { method: 'POST', body: restoreBody }),
    ]);
    assert.deepEqual(restoreResults.map((result) => result.status).sort(), [200, 409]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id=? AND action='RESTORE'").get(f.receiptId).n, 1);
  });
});
