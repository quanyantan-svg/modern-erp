// M1C-WP0-R1 — focused regression for the outsourcing GL source-level policy
// guard and the receiving-effect permission isolation.
//
// Contract source: MC-REQ-10 / MC-REQ-11 / MC-REQ-15
// (docs/requirements/procurement-outsourcing.md §31.13) and the M1-Core Active
// Design §8.1.2 / §9.4 (docs/design/procurement-outsourcing-m1-core.md).
//
// The suite runs against one disposable, isolated SQLite file that is removed
// after the run. It never touches a project, development or production
// database, and never touches MySQL.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { matchSupplierBill, postSupplierBill } from './modules/commercial-golive.js';

const POLICY_CODE = 'OUTSOURCING_GL_POLICY_NOT_APPROVED';

describe('M1C-WP0-R1 — outsourcing GL source-level policy guard and receiving-effect permission isolation', () => {
  let fixture;
  let outsourcingBillId;
  let outsourcingReceiptId;
  let outsourcingReceiptItemId;
  let outsourcingReceiptItemId2;

  before(async () => {
    fixture = await createFixture();
    const setup = await buildOutsourcingReceipt(fixture);
    outsourcingReceiptId = setup.receiptId;
    outsourcingReceiptItemId = setup.itemId;
    outsourcingReceiptItemId2 = setup.itemId2;
    const bill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-R1-GUARD', billDate: isoDate(0),
      idempotencyKey: 'r1-guard-bill',
      lines: [{ outsourcingReceiptItemId, quantity: 30, unitPriceCents: 500 }],
    });
    assert.equal(bill.status, 201, bill.data.error);
    outsourcingBillId = bill.data.id;
  });
  after(async () => fixture.close());

  test('R1-A 委外加工费账单草稿创建保持合法且零 AP/凭证/成本证据写入', async () => {
    const bill = fixture.db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(outsourcingBillId);
    assert.equal(bill.status, 'DRAFT');
    assert.equal(bill.net_cents, 15000);
    const payable = fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(outsourcingBillId);
    assert.equal(payable.n, 0, '草稿创建不得产生 AP open item');
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(outsourcingReceiptId);
    assert.ok(!evidence || evidence.processing_fee_actual_cents === null, '草稿创建不得刷新成本证据');
    const line = fixture.db.prepare('SELECT * FROM supplier_bill_items WHERE bill_id=?').get(outsourcingBillId);
    assert.equal(line.commercial_source_type, 'OUTSOURCING_RECEIPT_ITEM');
  });

  test('R1-A 正式过账对 admin 与 accounting 一律 409 且业务事实逐字段零变化', async () => {
    for (const actor of ['admin', 'accounting']) {
      const before = snapshotBillState(fixture.db, outsourcingBillId);
      const auditsBefore = countRejectAudits(fixture.db, outsourcingBillId);
      const response = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${outsourcingBillId}/post`, fixture.tokens[actor]);
      assert.equal(response.status, 409, `${actor} 必须被拒绝`);
      assert.equal(response.data.code, POLICY_CODE);
      assert.equal(snapshotBillState(fixture.db, outsourcingBillId), before, `${actor} 拒绝前后业务事实必须逐字段一致`);
      assert.equal(countRejectAudits(fixture.db, outsourcingBillId), auditsBefore + 1, '每次拒绝恰好新增 1 条拒绝审计');
      const audit = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='SUPPLIER_BILL' AND entity_id=? AND action='REJECT' ORDER BY created_at DESC LIMIT 1").get(outsourcingBillId);
      assert.ok(audit, '拒绝审计必须存在');
      assert.ok(audit.detail.includes(POLICY_CODE), '拒绝审计必须含精确 error code');
      assert.ok(audit.entity_id, '拒绝审计必须含业务单据标识');
    }
  });

  test('R1-A 共享过账与共享匹配入口对委外来源一律拒绝且不改写账单', async () => {
    const postBefore = snapshotBillState(fixture.db, outsourcingBillId);
    const post = await fixture.request('POST', `/api/supplier-bills/${outsourcingBillId}/post`, fixture.tokens.accounting);
    assert.equal(post.status, 409, JSON.stringify(post.data));
    assert.equal(post.data.code, POLICY_CODE);
    assert.equal(snapshotBillState(fixture.db, outsourcingBillId), postBefore);

    const matchBefore = snapshotBillState(fixture.db, outsourcingBillId);
    const match = await fixture.request('POST', `/api/supplier-bills/${outsourcingBillId}/match`, fixture.tokens.accounting, { items: [] });
    assert.equal(match.status, 409, JSON.stringify(match.data));
    assert.equal(match.data.code, POLICY_CODE);
    assert.equal(snapshotBillState(fixture.db, outsourcingBillId), matchBefore, '匹配拒绝不得改写 status/grni_cents/variance_cents');
  });

  test('R1-A 内部服务函数调用同一个来源级 Guard，不因内部调用而绕过', () => {
    assert.throws(
      () => postSupplierBill(fixture.db, outsourcingBillId, 'user-admin'),
      (error) => error.code === POLICY_CODE && error.status === 409,
    );
    assert.throws(
      () => matchSupplierBill(fixture.db, outsourcingBillId, { items: [] }, 'user-admin'),
      (error) => error.code === POLICY_CODE && error.status === 409,
    );
    const bill = fixture.db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(outsourcingBillId);
    assert.equal(bill.status, 'DRAFT');
  });

  test('R1-A 403 优先于来源读取：未授权主体得到 403 且不泄露账单来源', async () => {
    const response = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${outsourcingBillId}/post`, fixture.tokens.sales);
    assert.equal(response.status, 403, JSON.stringify(response.data));
    assert.equal(response.data.code, 'PERMISSION_DENIED');
    const body = JSON.stringify(response.data);
    assert.equal(body.includes('OUTSOURCING_RECEIPT_ITEM'), false, '403 响应不得泄露账单来源');
    assert.equal(body.includes(outsourcingBillId), false, '403 响应不得泄露业务单据标识');
  });

  test('R1-A 正式过账 RBAC 只认 SUPPLIER_BILL_MANAGE；OUTSOURCING_MANAGE 持有者草稿合法但过账 403', async () => {
    const draft = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.outsourcingOnly, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-R1-SOD', billDate: isoDate(0),
      idempotencyKey: 'r1-sod-bill',
      lines: [{ outsourcingReceiptItemId: outsourcingReceiptItemId2, quantity: 10, unitPriceCents: 500 }],
    });
    assert.equal(draft.status, 201, draft.data.error);
    const response = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${draft.data.id}/post`, fixture.tokens.outsourcingOnly);
    assert.equal(response.status, 403, JSON.stringify(response.data));
    assert.equal(response.data.code, 'PERMISSION_DENIED');
    const bill = fixture.db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(draft.data.id);
    assert.equal(bill.status, 'DRAFT');
  });

  test('R1-B 收货生效只认 OUTSOURCING_RECEIVING_MANAGE；OUTSOURCING_MANAGE 持有者 403 且零副作用', async () => {
    const before = fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(outsourcingReceiptId);
    const response = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${outsourcingReceiptId}/confirm`, fixture.tokens.outsourcingOnly);
    assert.equal(response.status, 403, JSON.stringify(response.data));
    assert.equal(response.data.code, 'PERMISSION_DENIED');
    const after = fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(outsourcingReceiptId);
    assert.deepEqual(after, before, '收货生效被拒后收货单据必须逐字段一致');
  });

  test('R1-B 收货录入与委外材料执行权限未被收紧动作误伤', async () => {
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingOnly, {
      orderId: fixture.outsourcingOrderId, quantity: 5, receivedDate: isoDate(0), processingFeeCents: 5000,
    });
    assert.equal(receipt.status, 201, receipt.data.error);
  });

  test('R1-B admin 收货生效仍然成功（权限未被反向收紧）', async () => {
    const response = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${outsourcingReceiptId}/confirm`, fixture.tokens.admin);
    assert.equal(response.status, 200, response.data.error);
    const row = fixture.db.prepare('SELECT business_status FROM outsourcing_receipts WHERE id=?').get(outsourcingReceiptId);
    assert.equal(row.business_status, 'EFFECTED');
  });

  test('R1-A 普通采购共享过账链路不受来源级 Guard 影响', async () => {
    const supplierId = 'supplier-001';
    const stamp = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode)
      VALUES('r1-pr','PR-R1',?,'warehouse-001','user-admin','CONFIRMED',2000,?,'','user-admin',?,?,'SEPARATE')`).run(supplierId, isoDate(0), stamp, stamp);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('r1-pr-i','r1-pr','product-001',2,1000,2000,1)`).run();
    const created = await fixture.request('POST', '/api/supplier-bills', fixture.tokens.accounting, {
      supplierId, supplierInvoiceNo: 'INV-R1-PURCHASE', billDate: isoDate(0), taxMode: 'NO_TAX',
      idempotencyKey: 'r1-purchase-bill',
      items: [{ receiptItemId: 'r1-pr-i', quantity: 2, uomCode: 'EA', unitPriceCents: 1000 }],
    });
    assert.equal(created.status, 201, created.data.error);
    const posted = await fixture.request('POST', `/api/supplier-bills/${created.data.id}/post`, fixture.tokens.accounting);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const payable = fixture.db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(created.data.id);
    assert.equal(payable.amount_cents, 2000);
    const bill = fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(created.data.id);
    assert.equal(bill.status, 'POSTED');
  });
});

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function snapshotBillState(db, billId) {
  const bill = db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);
  const payables = db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billId);
  const vouchers = db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(billId);
  const items = db.prepare('SELECT id,commercial_source_type,net_cents,gross_cents,matched_unit_price_cents FROM supplier_bill_items WHERE bill_id=? ORDER BY id').all(billId);
  return JSON.stringify({ bill, payables: payables.n, vouchers: vouchers.n, items });
}

function countRejectAudits(db, billId) {
  return db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SUPPLIER_BILL' AND entity_id=? AND action='REJECT'").get(billId).n;
}

async function buildOutsourcingReceipt(fixture) {
  const qualify = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
    outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
    qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
  });
  assert.equal(qualify.status, 200, qualify.data.error);
  const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
    supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0),
  });
  assert.equal(order.status, 201, order.data.error);
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
    items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
  });
  fixture.outsourcingOrderId = order.data.id;
  const materialListId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(order.data.id).id;
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/issues`, fixture.tokens.admin, {
    materialListId, quantity: 10, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: isoDate(0),
  });
  const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
    orderId: order.data.id, quantity: 30, receivedDate: isoDate(0), processingFeeCents: 30000,
  });
  assert.equal(receipt.status, 201, receipt.data.error);
  const itemId = `ori-r1-${receipt.data.id}`;
  fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
    VALUES(?,?,'product-001',30,500,1)`).run(itemId, receipt.data.id);
  // A second receipt item keeps the billable capacity of the first item free
  // for the responsibility-separation draft case.
  const receipt2 = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
    orderId: order.data.id, quantity: 10, receivedDate: isoDate(0), processingFeeCents: 10000,
  });
  assert.equal(receipt2.status, 201, receipt2.data.error);
  const itemId2 = `ori-r1-b-${receipt2.data.id}`;
  fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
    VALUES(?,?,'product-001',10,500,1)`).run(itemId2, receipt2.data.id);
  return { receiptId: receipt.data.id, itemId, itemId2 };
}

async function createFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m1c-wp0-r1-'));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, token = null, body) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  async function login(username, password) {
    const result = await request('POST', '/api/auth/login', null, { username, password });
    assert.equal(result.status, 200, result.data.error);
    return result.data.token;
  }

  const tokens = {
    admin: await login('admin', 'admin123'),
    accounting: await login('accounting', 'accounting123'),
    sales: await login('sales', 'sales123'),
  };

  // A dedicated role that holds OUTSOURCING_MANAGE and nothing else, so the
  // separation of duties is exercised against a real principal.
  const role = await request('POST', '/api/roles', tokens.admin, {
    code: 'R1_OUTSOURCING_ONLY', name: 'R1 委外操作者', permissions: ['OUTSOURCING_MANAGE'],
  });
  assert.equal(role.status, 201, role.data.error);
  const user = await request('POST', '/api/users', tokens.admin, {
    username: 'r1outsourcing', displayName: 'R1 委外操作者', password: 'r1-outsourcing-1234', roleId: role.data.id,
  });
  assert.equal(user.status, 201, user.data.error);
  tokens.outsourcingOnly = await login('r1outsourcing', 'r1-outsourcing-1234');

  async function close() {
    await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { db, request, tokens, close };
}
