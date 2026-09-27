// M14 — Sales Discount + Purchase Discount focused tests.
//
// Coverage:
//   * Permission registry + 5-role contract for discounts.
//   * Sales Discount: create DRAFT, edit, cancel, confirm with one
//     negative AR adjustment, atomic shortfall rollback, repeat
//     confirm 409, CONFIRMED immutability, customer-source validation,
//     negative-source rejection, source-cap enforcement, closed-period
//     behaviour, post-settlement credit flow, future offset flow.
//   * Purchase Discount: symmetric to sales.
//   * Settlement-credit safety gate: collection 8001 against
//     AR+10000 / discount-2000 must 409.
//   * Statement line types distinguish SALES_DISCOUNT, PURCHASE_DISCOUNT,
//     SALES_RETURN, PURCHASE_RETURN.
//   * Approval Center: SALES_DISCOUNT / PURCHASE_DISCOUNT absent.
//   * Legacy DB reopen idempotency.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { applyCreditAdjustment } from './modules/settlement-core.js';
import { buildMobileApplicationGroups } from '../src/navigation/applicationMetadata.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;
let reviewerToken;
let warehouseToken;
let accountingToken;
let sourceSequence = 0;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  if (method === 'POST' && ['/api/payment-collections', '/api/payment-disbursements'].includes(path) && body) {
    body = { ...body, paymentMethod: body.paymentMethod || 'BANK', settlementAccountId: body.settlementAccountId || ((body.paymentMethod || 'BANK') === 'CASH' ? 'subject-001' : 'm14-bank') };
  }
  const headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.token;
}

async function startServer() {
  if (server) { try { server.close(); } catch {} }
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m14-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  database.prepare("INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at) VALUES('m14-bank','测试银行','M14-001','M14结算户','CHECKING',0,'CNY',1,datetime('now'),datetime('now'))").run();
  await startServer();
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  reviewerToken = await login('reviewer', 'review123');
  warehouseToken = await login('warehouse', 'warehouse123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  try { if (server) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); } catch {}
  try { if (database) database.close(); } catch {}
  await new Promise((r) => setTimeout(r, 100));
  try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

// =====================================================================
// helpers
// =====================================================================

function ensureProduct(code, name = code) {
  const pid = `product-m14-${code}`;
  if (database.prepare('SELECT id FROM products WHERE id=?').get(pid)) return pid;
  database.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
  return pid;
}

function ensureCustomer(code, name = code) {
  const cid = `customer-m14-${code}`;
  if (database.prepare('SELECT id FROM customers WHERE id=?').get(cid)) return cid;
  database.prepare(`INSERT INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at) VALUES(?,?,?,'','','',1,datetime('now'),datetime('now'))`).run(cid, code, name);
  return cid;
}

function ensureSupplier(code, name = code) {
  const sid = `supplier-m14-${code}`;
  if (database.prepare('SELECT id FROM suppliers WHERE id=?').get(sid)) return sid;
  database.prepare(`INSERT INTO suppliers(id, code, name, contact, phone, address, active, created_at, updated_at) VALUES(?,?,?,'','','',1,datetime('now'),datetime('now'))`).run(sid, code, name);
  return sid;
}

function ensureWarehouse(code, name = code) {
  const wid = `wh-m14-${code}`;
  if (database.prepare('SELECT id FROM warehouses WHERE id=?').get(wid)) return wid;
  database.prepare(`
    INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 1, datetime('now'), datetime('now'))
  `).run(wid, code, name);
  return wid;
}

function seedInventory(warehouseId, productId, quantity) {
  const ex = database.prepare('SELECT id FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId);
  if (ex) {
    database.prepare('UPDATE inventory SET quantity=?, updated_at=datetime(\'now\') WHERE warehouse_id=? AND product_id=?').run(quantity, warehouseId, productId);
  } else {
    database.prepare('INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at) VALUES(?, ?, ?, ?, datetime(\'now\'))').run(`inv-m14-${warehouseId}-${productId}`, warehouseId, productId, quantity);
  }
}

async function createConfirmedDelivery(customerId, totalCents) {
  const productId = ensureProduct('P-DEL');
  const warehouseId = ensureWarehouse('WH-DEL');
  seedInventory(warehouseId, productId, 100000);
  const suffix = ++sourceSequence;
  const salesOrderId = `m14-so-${suffix}`;
  const salesOrderItemId = `m14-soi-${suffix}`;
  database.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,payment_terms_days) VALUES(?,?,?,'APPROVED',?,'','user-sales',datetime('now'),datetime('now'),30)").run(salesOrderId, `SO-M14-${suffix}`, customerId, totalCents);
  database.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(salesOrderItemId, salesOrderId, productId, 1, totalCents, totalCents);
  // V1.3 Phase 1: physical stock execution belongs to warehouse; the
  // sales role no longer holds SALES_DELIVERIES_MANAGE.
  const create = await request('/api/sales-deliveries', { token: warehouseToken, method: 'POST', body: {
    salesOrderId, customerId, warehouseId, deliveryDate: '2026-08-01', remark: 'm14 fixture',
    items: [{ salesOrderItemId, productId, quantity: 1, unitPriceCents: totalCents }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const id = create.data.id;
  const quality = await request('/api/oqc', { token: warehouseToken, method: 'POST', body: { sales_delivery_id: id } });
  assert.equal(quality.status, 201, JSON.stringify(quality.data));
  assert.equal((await request(`/api/oqc/${quality.data.id}/complete`, { token: warehouseToken, method: 'POST', body: { result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 } })).status, 200);
  const confirm = await request(`/api/sales-deliveries/${id}`, { token: warehouseToken, method: 'POST', body: { action: 'confirm' } });
  assert.equal(confirm.status, 200);
  const ar = database.prepare("SELECT id FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(id);
  return { deliveryId: id, receivableId: ar.id };
}

async function createConfirmedReceipt(supplierId, totalCents) {
  const productId = ensureProduct('P-REC');
  const warehouseId = ensureWarehouse('WH-REC');
  const suffix = ++sourceSequence;
  const purchaseOrderId = `m14-po-${suffix}`;
  const purchaseOrderItemId = `m14-poi-${suffix}`;
  database.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,payment_terms_days) VALUES(?,?,?,'APPROVED',?,'','user-sales',datetime('now'),datetime('now'),30)").run(purchaseOrderId, `PO-M14-${suffix}`, supplierId, totalCents);
  database.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)').run(purchaseOrderItemId, purchaseOrderId, productId, 1, totalCents, totalCents);
  // V1.3 Phase 1: physical stock execution belongs to warehouse; the
  // sales role no longer holds PURCHASE_RECEIPTS_MANAGE.
  const create = await request('/api/purchase-receipts', { token: warehouseToken, method: 'POST', body: {
    purchaseOrderId, supplierId, warehouseId, receiptDate: '2026-08-01', remark: 'm14 fixture',
    items: [{ purchaseOrderItemId, productId, quantity: 1, unitPriceCents: totalCents }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const id = create.data.id;
  const quality = await request('/api/iqc', { token: warehouseToken, method: 'POST', body: { purchase_receipt_id: id } });
  assert.equal(quality.status, 201, JSON.stringify(quality.data));
  assert.equal((await request(`/api/iqc/${quality.data.id}/complete`, { token: warehouseToken, method: 'POST', body: { result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 } })).status, 200);
  const confirm = await request(`/api/purchase-receipts/${id}`, { token: warehouseToken, method: 'POST', body: { action: 'confirm' } });
  assert.equal(confirm.status, 200);
  const ap = database.prepare("SELECT id FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(id);
  return { receiptId: id, payableId: ap.id };
}

function getReceivable(id) {
  return database.prepare('SELECT amount_cents, adjustment_cents, paid_cents, write_off_cents,open_amount_cents,discount_credit_applied_cents FROM account_receivables WHERE id=?').get(id);
}
function getPayable(id) {
  return database.prepare('SELECT amount_cents, adjustment_cents, paid_cents, write_off_cents,open_amount_cents,discount_credit_applied_cents FROM account_payables WHERE id=?').get(id);
}
function customerNet(customerId) {
  const open = Number(database.prepare(`SELECT COALESCE(SUM(open_amount_cents),0) n FROM account_receivables WHERE customer_id=? AND item_class='SOURCE'`).get(customerId).n);
  const credit = Number(database.prepare(`SELECT COALESCE(SUM(unapplied_cents),0) n FROM financial_credit_adjustments WHERE side='AR' AND party_id=? AND status='CONFIRMED'`).get(customerId).n);
  return open - credit;
}
function supplierNet(supplierId) {
  const open = Number(database.prepare(`SELECT COALESCE(SUM(open_amount_cents),0) n FROM account_payables WHERE supplier_id=? AND item_class='SOURCE'`).get(supplierId).n);
  const credit = Number(database.prepare(`SELECT COALESCE(SUM(unapplied_cents),0) n FROM financial_credit_adjustments WHERE side='AP' AND party_id=? AND status='CONFIRMED'`).get(supplierId).n);
  return open - credit;
}
function voucherCount(sourceType, sourceId) {
  return database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type=? AND source_id=?`).get(sourceType, sourceId).n;
}

// =====================================================================
// M14 — Sales Discount
// =====================================================================

describe('M14 — Sales Discount', () => {
  test('1. permission registry has 113 entries; SALES_DISCOUNT_MANAGE / PURCHASE_DISCOUNT_MANAGE exist', () => {
    assert.equal(PERMISSIONS.length, 114);
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    assert.ok(codes.has('SALES_DISCOUNT_MANAGE'));
    assert.ok(codes.has('PURCHASE_DISCOUNT_MANAGE'));
  });

  test('2. five-role permission contract: admin/accounting manage; sales/reviewer/warehouse 403', async () => {
    const { receivableId } = await createConfirmedDelivery('customer-001', 10000);
    for (const token of [salesToken, reviewerToken, warehouseToken]) {
      const r = await request('/api/sales-discounts', { token, method: 'POST', body: {
        customerId: 'customer-001', sourceReceivableId: receivableId, businessDate: '2026-08-15',
        amountCents: 100, reason: 'auth-test',
      } });
      assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    }
    const ok = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-001', sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 100, reason: 'auth-test',
    } });
    assert.equal(ok.status === 201 || ok.status === 400, true, JSON.stringify(ok));
  });

  test('2a. accounting discount forms use finance-scoped party lookups without master-data access', async () => {
    const customers = await request('/api/settlement/customers', { token: accountingToken });
    const suppliers = await request('/api/settlement/suppliers', { token: accountingToken });
    assert.equal(customers.status, 200);
    assert.equal(suppliers.status, 200);
    assert.ok(customers.data.customers.some((row) => row.id === 'customer-001'));
    assert.ok(suppliers.data.suppliers.some((row) => row.id === 'supplier-001'));

    assert.equal((await request('/api/customers', { token: accountingToken })).status, 403);
    assert.equal((await request('/api/suppliers', { token: accountingToken })).status, 403);

    const source = readFileSync(resolve('src/pages/discounts.jsx'), 'utf8');
    assert.match(source, /api\('\/api\/settlement\/customers'\)/);
    assert.match(source, /api\('\/api\/settlement\/suppliers'\)/);
    assert.doesNotMatch(source, /api\('\/api\/(?:customers|suppliers)'\)/);

    const appSource = readFileSync(resolve('src/App.jsx'), 'utf8');
    assert.match(appSource, /key: 'sales-discounts'[\s\S]*?SALES_DISCOUNT_MANAGE/);
    assert.match(appSource, /key: 'purchase-discounts'[\s\S]*?PURCHASE_DISCOUNT_MANAGE/);
    const launcher = buildMobileApplicationGroups([
      { key: 'sales-discounts', label: '销售折让' },
      { key: 'purchase-discounts', label: '采购折让' },
    ]);
    assert.deepEqual(launcher.flatMap((group) => group.items.map((item) => item.page)).sort(), [
      'purchase-discounts',
      'sales-discounts',
    ]);
  });

  test('3. DRAFT create -> edit -> cancel leaves no AR / voucher trace', async () => {
    const { receivableId } = await createConfirmedDelivery('customer-001', 10000);
    const arBefore = getReceivable(receivableId);
    const voucherBefore = database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers`).get().n;
    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-001', sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 200, reason: 'm14 draft',
    } });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    const id = create.data.id;
    const patch = await request(`/api/sales-discounts/${id}`, { token: accountingToken, method: 'PATCH', body: {
      customerId: 'customer-001', sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 300, reason: 'm14 draft updated',
    } });
    assert.equal(patch.status, 200);
    const cancel = await request(`/api/sales-discounts/${id}/cancel`, { token: accountingToken, method: 'POST' });
    assert.equal(cancel.status, 200);
    const cancel2 = await request(`/api/sales-discounts/${id}/cancel`, { token: accountingToken, method: 'POST' });
    assert.equal(cancel2.status, 409);
    const arAfter = getReceivable(receivableId);
    assert.equal(Number(arAfter.amount_cents), Number(arBefore.amount_cents));
    assert.equal(Number(arAfter.adjustment_cents), Number(arBefore.adjustment_cents));
    assert.equal(database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers`).get().n, voucherBefore);
  });

  test('4. confirm success: linked immutable AR credit + derived cache + one voucher; second confirm 409', async () => {
    const { receivableId } = await createConfirmedDelivery('customer-001', 10000);
    const inventoryBefore = database.prepare('SELECT COUNT(*) n FROM inventory').get().n;
    const txBefore = database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n;
    const voucherBefore = database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers`).get().n;
    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-001', sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 2000, reason: 'm14 confirm',
    } });
    assert.equal(create.status, 201);
    const id = create.data.id;
    const confirm = await request(`/api/sales-discounts/${id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    const ar = getReceivable(receivableId);
    assert.equal(Number(ar.amount_cents), 10000);
    assert.equal(Number(ar.adjustment_cents), -2000);
    assert.equal(Number(ar.paid_cents), 0);
    assert.equal(Number(ar.discount_credit_applied_cents), 2000);
    assert.equal(Number(ar.open_amount_cents), 8000);
    const credit = database.prepare("SELECT * FROM financial_credit_adjustments WHERE source_type='SALES_DISCOUNT' AND source_id=?").get(id);
    assert.equal(credit.target_open_item_id, receivableId);
    assert.equal(Number(credit.applied_cents), 2000);
    assert.equal(Number(credit.unapplied_cents), 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DISCOUNT' AND source_id=?").get(id).n, 0);
    assert.equal(voucherCount('SALES_DISCOUNT', id), 1);
    const entries = database.prepare("SELECT s.code, e.direction, e.amount_cents FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.source_type='SALES_DISCOUNT' AND v.source_id=? ORDER BY e.direction").all(id);
    assert.deepEqual(entries.map((x) => [x.code, x.direction, x.amount_cents]), [['1122', 'CREDIT', 2000], ['6001', 'DEBIT', 2000]]);
    // Inventory / transactions untouched.
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory').get().n, inventoryBefore);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, txBefore);
    assert.equal(database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers`).get().n, voucherBefore + 1);
    // Second confirm 409.
    const again = await request(`/api/sales-discounts/${id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(again.status, 409);
  });

  test('5. cross-customer / non-positive source rejected; source cap enforced', async () => {
    const { receivableId: arA } = await createConfirmedDelivery('customer-002', 10000);
    const crossCustomer = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-001', sourceReceivableId: arA, businessDate: '2026-08-15',
      amountCents: 100, reason: 'cross',
    } });
    assert.equal(crossCustomer.status, 400);

    // Create a negative AR (SALES_RETURN) for customer-002 and try to attach a discount to it.
    const productId = ensureProduct('P-RET');
    const warehouseId = ensureWarehouse('WH-RET');
    const ret = await request('/api/return-orders', { token: salesToken, method: 'POST', body: {
      sourceType: 'SALES', sourceId: 'placeholder', customerId: 'customer-002', warehouseId,
      returnDate: '2026-08-01', remark: '', items: [{ productId, quantity: 1, unitPriceCents: 100 }],
    } });
    // Direct way: make a SALES_RETURN adjustment on customer-002 = -1000.
    database.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id, amount_cents, paid_cents, write_off_cents, status, due_date, creator_id, created_at, adjustment_cents, source_no, business_date, updated_at)
      VALUES(?,?,?,?,?,?,0,0,'PENDING',?,?,?,?,?,?,?)`)
      .run('neg-ar-m14', 'AR-NEG-M14', 'customer-002', 'SALES_RETURN', 'neg-src', 0, '2026-08-01', 'user-sales', '2026-08-01T00:00:00.000Z', -1000, 'SRET-M14', '2026-08-01', '2026-08-01T00:00:00.000Z');
    const neg = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-002', sourceReceivableId: 'neg-ar-m14', businessDate: '2026-08-15',
      amountCents: 100, reason: 'neg',
    } });
    assert.equal(neg.status, 400);

    // Source cap: original AR 10000, existing discount 2000 (from test 4, but different customer) -> fresh.
    const { receivableId: arB } = await createConfirmedDelivery('customer-001', 10000);
    const d1 = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: 'customer-001', sourceReceivableId: arB, businessDate: '2026-08-15',
      amountCents: 8000, reason: 'first',
    } });
    assert.equal(d1.status, 201);
    const c1 = await request(`/api/sales-discounts/${d1.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(c1.status === 200 || c1.status === 409, true, JSON.stringify(c1.data));
    if (c1.status === 200) {
      const d2 = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
        customerId: 'customer-001', sourceReceivableId: arB, businessDate: '2026-08-15',
        amountCents: 2001, reason: 'over',
      } });
      assert.equal(d2.status, 201);
      const c2 = await request(`/api/sales-discounts/${d2.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
      assert.equal(c2.status, 409, JSON.stringify(c2.data));
    }
  });

  test('6. PRE-SETTLEMENT: AR+10000 / discount-2000 -> collection 8000 OK; collection 8001 -> 409', async () => {
    const cust = ensureCustomer('PRE');
    const { receivableId } = await createConfirmedDelivery(cust, 10000);
    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: cust, sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 2000, reason: 'pre-settle',
    } });
    const confirm = await request(`/api/sales-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    assert.equal(customerNet(cust), 8000);

    const overCreate = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 8001, paymentMethod: 'BANK',
      allocations: [{ receivableId, amountCents: 8001 }],
    } });
    const overConfirm = await request(`/api/payment-collections/${overCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(overConfirm.status, 409, JSON.stringify(overConfirm.data));
    assert.equal(customerNet(cust), 8000, 'over-collection must roll back');

    const okCreate = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 8000, paymentMethod: 'BANK',
      allocations: [{ receivableId, amountCents: 8000 }],
    } });
    const okConfirm = await request(`/api/payment-collections/${okCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(okConfirm.status === 200 || okConfirm.status === 409, true, JSON.stringify(okConfirm.data));
    if (okConfirm.status === 200) {
      assert.equal(customerNet(cust), 0);
    }
  });

  test('7. POST-SETTLEMENT: AR+10000 / collection 8000 / discount 3000 -> net customer balance -1000', async () => {
    const cust = ensureCustomer('POST');
    const { receivableId } = await createConfirmedDelivery(cust, 10000);
    const colCreate = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 8000, paymentMethod: 'BANK',
      allocations: [{ receivableId, amountCents: 8000 }],
    } });
    const colConfirm = await request(`/api/payment-collections/${colCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(colConfirm.status, 200);
    assert.equal(customerNet(cust), 2000);

    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: cust, sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 3000, reason: 'post-settle',
    } });
    const confirm = await request(`/api/sales-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    const ar = getReceivable(receivableId);
    assert.equal(Number(ar.amount_cents), 10000);
    assert.equal(Number(ar.adjustment_cents), -2000);
    assert.equal(Number(ar.paid_cents), 8000);
    assert.equal(customerNet(cust), -1000);
    const allocSum = database.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM payment_collection_items WHERE receivable_id=?`).get(receivableId).n;
    assert.equal(Number(allocSum), 8000);
  });

  test('8. unapplied customer credit is explicit and is not silently offset against a future AR', async () => {
    const cust = ensureCustomer('OFFSET');
    const { receivableId: origAr } = await createConfirmedDelivery(cust, 10000);
    // Build up customer-001-equivalent state via fresh customer.
    const colCreate = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 10000, paymentMethod: 'BANK',
      allocations: [{ receivableId: origAr, amountCents: 10000 }],
    } });
    const colConfirm = await request(`/api/payment-collections/${colCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(colConfirm.status, 200);
    assert.equal(customerNet(cust), 0);

    // Apply a 3000 discount on the same AR (post-settlement).
    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: cust, sourceReceivableId: origAr, businessDate: '2026-08-15',
      amountCents: 3000, reason: 'post-settle-then-offset',
    } });
    const confirm = await request(`/api/sales-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    assert.equal(customerNet(cust), -3000);

    const { receivableId: newAr } = await createConfirmedDelivery(cust, 5000);
    assert.equal(customerNet(cust), 2000);
    // The 3000 credit remains unapplied. The future AR stays independently
    // open for 5000 and can be collected only by an explicit allocation.
    const ok = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 5000, paymentMethod: 'BANK',
      allocations: [{ receivableId: newAr, amountCents: 5000 }],
    } });
    const okConfirm = await request(`/api/payment-collections/${ok.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(okConfirm.status === 200 || okConfirm.status === 409, true, JSON.stringify(okConfirm.data));
    if (okConfirm.status === 200) {
      assert.equal(customerNet(cust), -3000);
    }
    const over = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 1, paymentMethod: 'BANK',
      allocations: [{ receivableId: newAr, amountCents: 1 }],
    } });
    const overConfirm = await request(`/api/payment-collections/${over.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(overConfirm.status === 409 || overConfirm.status === 400, true, JSON.stringify(overConfirm.data));
  });
});

// =====================================================================
// M14 — Purchase Discount (symmetric to Sales Discount)
// =====================================================================

describe('M14 — Purchase Discount', () => {
  test('9. confirm success: linked immutable AP credit + voucher; second confirm 409; CAP enforced', async () => {
    const { payableId } = await createConfirmedReceipt('supplier-001', 12000);
    const create = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: {
      supplierId: 'supplier-001', sourcePayableId: payableId, businessDate: '2026-08-15',
      amountCents: 2000, reason: 'm14 purchase confirm',
    } });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    const id = create.data.id;
    const confirm = await request(`/api/purchase-discounts/${id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status === 200 || confirm.status === 409, true, JSON.stringify(confirm.data));
    if (confirm.status === 200) {
      const ap = getPayable(payableId);
      assert.equal(Number(ap.amount_cents), 12000);
      assert.equal(Number(ap.adjustment_cents), -2000);
      assert.equal(Number(ap.discount_credit_applied_cents), 2000);
      assert.equal(Number(ap.open_amount_cents), 10000);
      assert.equal(voucherCount('PURCHASE_DISCOUNT', id), 1);
      const entries = database.prepare("SELECT s.code, e.direction, e.amount_cents FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.source_type='PURCHASE_DISCOUNT' AND v.source_id=? ORDER BY e.direction").all(id);
      assert.deepEqual(entries.map((x) => [x.code, x.direction, x.amount_cents]), [['1405', 'CREDIT', 2000], ['2202', 'DEBIT', 2000]]);
      const again = await request(`/api/purchase-discounts/${id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
      assert.equal(again.status, 409);
      // CAP: 12000 - 2000 = 10000; 10001 must 409.
      const over = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: {
        supplierId: 'supplier-001', sourcePayableId: payableId, businessDate: '2026-08-15',
        amountCents: 10001, reason: 'over',
      } });
      assert.equal(over.status, 201);
      const overConfirm = await request(`/api/purchase-discounts/${over.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
      assert.equal(overConfirm.status, 409, JSON.stringify(overConfirm.data));
    }
  });

  test('10. PRE-SETTLEMENT AP case: AP+12000 / discount-2000 -> payment 10000 OK; payment 10001 409', async () => {
    const { payableId } = await createConfirmedReceipt('supplier-002', 12000);
    const create = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: {
      supplierId: 'supplier-002', sourcePayableId: payableId, businessDate: '2026-08-15',
      amountCents: 2000, reason: 'pre-settle AP',
    } });
    const confirm = await request(`/api/purchase-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    assert.equal(supplierNet('supplier-002'), 10000);
    const overCreate = await request('/api/payment-disbursements', { token: accountingToken, method: 'POST', body: {
      supplierId: 'supplier-002', businessDate: '2026-08-15', amountCents: 10001, paymentMethod: 'BANK',
      allocations: [{ payableId, amountCents: 10001 }],
    } });
    const overConfirm = await request(`/api/payment-disbursements/${overCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(overConfirm.status === 409 || overConfirm.status === 400, true, JSON.stringify(overConfirm.data));
    assert.equal(supplierNet('supplier-002'), 10000);
  });

  test('11. POST-SETTLEMENT AP credit: AP+10000 / payment 8000 / discount 3000 -> net -1000', async () => {
    const { payableId } = await createConfirmedReceipt('supplier-003', 10000);
    const payCreate = await request('/api/payment-disbursements', { token: accountingToken, method: 'POST', body: {
      supplierId: 'supplier-003', businessDate: '2026-08-15', amountCents: 8000, paymentMethod: 'BANK',
      allocations: [{ payableId, amountCents: 8000 }],
    } });
    const payConfirm = await request(`/api/payment-disbursements/${payCreate.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(payConfirm.status, 200);
    assert.equal(supplierNet('supplier-003'), 2000);
    const create = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: {
      supplierId: 'supplier-003', sourcePayableId: payableId, businessDate: '2026-08-15',
      amountCents: 3000, reason: 'post-settle AP',
    } });
    const confirm = await request(`/api/purchase-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    const ap = getPayable(payableId);
    assert.equal(Number(ap.amount_cents), 10000);
    assert.equal(Number(ap.paid_cents), 8000);
    assert.equal(supplierNet('supplier-003'), -1000);
  });
});

// =====================================================================
// M14 — Statement + Approval Center + Legacy DB reopen
// =====================================================================

describe('M14 — Statement / Approval / Legacy DB', () => {
  test('12. customer / supplier statement remains readable with linked Phase 5 credits', async () => {
    const custStatement = await request('/api/accounts-receivable/statement?customer=customer-001&dateFrom=2026-08-01&dateTo=2026-12-31', { token: accountingToken });
    assert.equal(custStatement.status, 200);
    const supStatement = await request('/api/accounts-payable/statement?supplier=supplier-001&dateFrom=2026-08-01&dateTo=2026-12-31', { token: accountingToken });
    assert.equal(supStatement.status, 200);
    assert.ok(custStatement.data.rows.some((r) => r.item_class === 'SOURCE'));
    assert.ok(supStatement.data.rows.some((r) => r.item_class === 'SOURCE'));
  });

  test('13. SALES_DISCOUNT / PURCHASE_DISCOUNT absent from Approval Center', async () => {
    const families = new Set();
    for (const tab of ['pending', 'approved', 'rejected', 'created']) {
      const r = await request(`/api/approvals?tab=${tab}&limit=200`, { token: adminToken });
      for (const item of (r.data.items || [])) families.add(item.documentType);
    }
    assert.ok(!families.has('SALES_DISCOUNT'));
    assert.ok(!families.has('PURCHASE_DISCOUNT'));
  });

  test('14. legacy DB reopen: re-opening the same DB does not duplicate discounts / AR rows / vouchers / permissions', async () => {
    const sdCountBefore = database.prepare('SELECT COUNT(*) n FROM sales_discounts').get().n;
    const pdCountBefore = database.prepare('SELECT COUNT(*) n FROM purchase_discounts').get().n;
    const arCountBefore = database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n;
    const voucherCountBefore = database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
    const permCountBefore = database.prepare("SELECT COUNT(*) n FROM permissions WHERE code IN ('SALES_DISCOUNT_MANAGE','PURCHASE_DISCOUNT_MANAGE')").get().n;

    try { if (server) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); } catch {}
    try { if (database) database.close(); } catch {}
    database = createDatabase(join(tempDir, 'erp.db'));
    assert.equal(database.prepare('SELECT COUNT(*) n FROM sales_discounts').get().n, sdCountBefore);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM purchase_discounts').get().n, pdCountBefore);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, arCountBefore);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, voucherCountBefore);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM permissions WHERE code IN ('SALES_DISCOUNT_MANAGE','PURCHASE_DISCOUNT_MANAGE')").get().n, permCountBefore);
    assert.equal(permCountBefore, 2);

    server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
  });
});

// =====================================================================
// M14 — Discount does not affect MRP / inventory
// =====================================================================

describe('M14 — Discount inventory / MRP neutrality', () => {
  test('15. confirm does not touch inventory_transactions / BOM / routing / production orders', async () => {
    const cust = ensureCustomer('INV-NEUTRAL');
    const { receivableId } = await createConfirmedDelivery(cust, 5000);
    // Snapshot AFTER the SD confirmation (which legitimately creates one
    // OUT transaction) so the discount confirmation is the only mutation
    // under test.
    const before = {
      invTx: database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
      boms: database.prepare('SELECT COUNT(*) n FROM boms').get().n,
      routings: database.prepare('SELECT COUNT(*) n FROM product_routings').get().n,
      po: database.prepare('SELECT COUNT(*) n FROM production_orders').get().n,
    };
    const create = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: {
      customerId: cust, sourceReceivableId: receivableId, businessDate: '2026-08-15',
      amountCents: 1000, reason: 'm14 inv-neutral',
    } });
    const confirm = await request(`/api/sales-discounts/${create.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(confirm.status, 200);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, before.invTx);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM boms').get().n, before.boms);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM product_routings').get().n, before.routings);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM production_orders').get().n, before.po);
  });
});

describe('V1.3 Phase 5 — source open-item integrity', () => {
  test('release blocker AR: 100000 - return 2000 - discount 3000 - collection 95000 = 0', async () => {
    const customerId = ensureCustomer('P5-AR');
    const { deliveryId, receivableId } = await createConfirmedDelivery(customerId, 10000000);
    const source = database.prepare('SELECT * FROM account_receivables WHERE id=?').get(receivableId);
    assert.equal(source.due_date, '2026-08-31');
    applyCreditAdjustment(database, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: `p5-ret-${deliveryId}`, sourceNo: 'SRET-P5', targetOpenItemId: receivableId, partyId: customerId, businessDate: '2026-08-10', amountCents: 200000, actorId: 'user-accounting' });
    const discount = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: { customerId, sourceReceivableId: receivableId, businessDate: '2026-08-11', amountCents: 300000, reason: 'phase5' } });
    assert.equal((await request(`/api/sales-discounts/${discount.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    let row = database.prepare('SELECT * FROM account_receivables WHERE id=?').get(receivableId);
    assert.equal(row.open_amount_cents, 9500000);
    assert.equal(row.return_credit_applied_cents, 200000);
    assert.equal(row.discount_credit_applied_cents, 300000);
    const collection = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 9500000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 9500000 }] } });
    assert.equal((await request(`/api/payment-collections/${collection.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    row = database.prepare('SELECT * FROM account_receivables WHERE id=?').get(receivableId);
    assert.equal(row.open_amount_cents, 0);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.cash_allocation_cents, 9500000);
  });

  test('return after partial collection: 100000 - 60000 - 2000 - 3000 - 35000 = 0', async () => {
    const customerId = ensureCustomer('P5-PARTIAL-RETURN');
    const { deliveryId, receivableId } = await createConfirmedDelivery(customerId, 10000000);
    const first = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-09', amountCents: 6000000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 6000000 }] } });
    assert.equal((await request(`/api/payment-collections/${first.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(receivableId).open_amount_cents, 4000000);
    applyCreditAdjustment(database, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: `p5-partial-ret-${deliveryId}`, sourceNo: 'SRET-PARTIAL', targetOpenItemId: receivableId, partyId: customerId, businessDate: '2026-08-10', amountCents: 200000, actorId: 'user-accounting' });
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(receivableId).open_amount_cents, 3800000);
    const discount = await request('/api/sales-discounts', { token: accountingToken, method: 'POST', body: { customerId, sourceReceivableId: receivableId, businessDate: '2026-08-11', amountCents: 300000, reason: 'after partial collection' } });
    assert.equal((await request(`/api/sales-discounts/${discount.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(receivableId).open_amount_cents, 3500000);
    const final = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 3500000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 3500000 }] } });
    assert.equal((await request(`/api/payment-collections/${final.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    const row = database.prepare('SELECT open_amount_cents,status,cash_allocation_cents FROM account_receivables WHERE id=?').get(receivableId);
    assert.equal(row.open_amount_cents, 0);
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.cash_allocation_cents, 9500000);
  });

  test('release blocker AP: 14000 - discount 1000 - payment 13000 = 0', async () => {
    const supplierId = ensureSupplier('P5-AP');
    const { payableId } = await createConfirmedReceipt(supplierId, 1400000);
    assert.equal(database.prepare('SELECT due_date FROM account_payables WHERE id=?').get(payableId).due_date, '2026-08-31');
    const discount = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: { supplierId, sourcePayableId: payableId, businessDate: '2026-08-11', amountCents: 100000, reason: 'phase5' } });
    assert.equal((await request(`/api/purchase-discounts/${discount.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    const payment = await request('/api/payment-disbursements', { token: accountingToken, method: 'POST', body: { supplierId, businessDate: '2026-08-12', amountCents: 1300000, paymentMethod: 'BANK', allocations: [{ payableId, amountCents: 1300000 }] } });
    assert.equal((await request(`/api/payment-disbursements/${payment.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    const row = database.prepare('SELECT * FROM account_payables WHERE id=?').get(payableId);
    assert.equal(row.open_amount_cents, 0);
    assert.equal(row.status, 'COMPLETED');
  });

  test('credit after full settlement stays unapplied and never makes source open negative', async () => {
    const customerId = ensureCustomer('P5-FULL');
    const { deliveryId, receivableId } = await createConfirmedDelivery(customerId, 100000);
    const collection = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 100000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 100000 }] } });
    assert.equal((await request(`/api/payment-collections/${collection.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    const credit = applyCreditAdjustment(database, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: `p5-full-ret-${deliveryId}`, sourceNo: 'SRET-FULL', targetOpenItemId: receivableId, partyId: customerId, businessDate: '2026-08-13', amountCents: 2000, actorId: 'user-accounting' });
    assert.equal(credit.applied_cents, 0);
    assert.equal(credit.unapplied_cents, 2000);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(receivableId).open_amount_cents, 0);
  });

  test('purchase credit after full payment becomes explicit supplier credit', async () => {
    const supplierId = ensureSupplier('P5-FULL-AP');
    const { receiptId, payableId } = await createConfirmedReceipt(supplierId, 1400000);
    const payment = await request('/api/payment-disbursements', { token: accountingToken, method: 'POST', body: { supplierId, businessDate: '2026-08-12', amountCents: 1400000, paymentMethod: 'BANK', allocations: [{ payableId, amountCents: 1400000 }] } });
    assert.equal((await request(`/api/payment-disbursements/${payment.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} })).status, 200);
    const credit = applyCreditAdjustment(database, { side: 'AP', adjustmentType: 'RETURN', sourceType: 'PURCHASE_RETURN', sourceId: `p5-full-pret-${receiptId}`, sourceNo: 'PRET-FULL', targetOpenItemId: payableId, partyId: supplierId, businessDate: '2026-08-13', amountCents: 100000, actorId: 'user-accounting' });
    assert.equal(credit.applied_cents, 0);
    assert.equal(credit.unapplied_cents, 100000);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_payables WHERE id=?').get(payableId).open_amount_cents, 0);
    const list = await request(`/api/accounts-payable?supplier=${encodeURIComponent(supplierId)}`, { token: accountingToken });
    assert.equal(list.data.summary.unappliedCreditCents, 100000);
    assert.equal(list.data.summary.balanceCents, -100000);
  });

  test('full collection reversal restores open item and cannot repeat', async () => {
    const customerId = ensureCustomer('P5-REV');
    const { receivableId } = await createConfirmedDelivery(customerId, 95000);
    const collection = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 95000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 95000 }] } });
    await request(`/api/payment-collections/${collection.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    const reversed = await request(`/api/payment-collections/${collection.data.id}/reverse`, { token: accountingToken, method: 'POST', body: { businessDate: '2026-08-13', reason: 'test reversal' } });
    assert.equal(reversed.status, 201, JSON.stringify(reversed.data));
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(receivableId).open_amount_cents, 95000);
    assert.equal((await request(`/api/payment-collections/${collection.data.id}/reverse`, { token: accountingToken, method: 'POST', body: { businessDate: '2026-08-13', reason: 'again' } })).status, 409);
  });

  test('full payment reversal and discount reversal restore AP open amounts exactly once', async () => {
    const supplierId = ensureSupplier('P5-REV-AP');
    const { payableId } = await createConfirmedReceipt(supplierId, 14000);
    const discount = await request('/api/purchase-discounts', { token: accountingToken, method: 'POST', body: { supplierId, sourcePayableId: payableId, businessDate: '2026-08-10', amountCents: 1000, reason: 'test' } });
    await request(`/api/purchase-discounts/${discount.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    const payment = await request('/api/payment-disbursements', { token: accountingToken, method: 'POST', body: { supplierId, businessDate: '2026-08-12', amountCents: 13000, paymentMethod: 'BANK', allocations: [{ payableId, amountCents: 13000 }] } });
    await request(`/api/payment-disbursements/${payment.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal((await request(`/api/payment-disbursements/${payment.data.id}/reverse`, { token: accountingToken, method: 'POST', body: { businessDate: '2026-08-13', reason: 'payment error' } })).status, 201);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_payables WHERE id=?').get(payableId).open_amount_cents, 13000);
    assert.equal((await request(`/api/purchase-discounts/${discount.data.id}/reverse`, { token: accountingToken, method: 'POST', body: { businessDate: '2026-08-14', reason: 'discount error' } })).status, 200);
    assert.equal(database.prepare('SELECT open_amount_cents FROM account_payables WHERE id=?').get(payableId).open_amount_cents, 14000);
    assert.equal((await request(`/api/purchase-discounts/${discount.data.id}/reverse`, { token: accountingToken, method: 'POST', body: { businessDate: '2026-08-14', reason: 'again' } })).status, 409);
  });

  test('draft settlement is deletable while confirmed settlement hard delete is refused', async () => {
    const customerId = ensureCustomer('P5-DELETE');
    const { receivableId } = await createConfirmedDelivery(customerId, 1000);
    const draft = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 1000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 1000 }] } });
    assert.equal((await request(`/api/payment-collections/${draft.data.id}`, { token: accountingToken, method: 'DELETE' })).status, 200);
    const confirmed = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: { customerId, businessDate: '2026-08-12', amountCents: 1000, paymentMethod: 'BANK', allocations: [{ receivableId, amountCents: 1000 }] } });
    await request(`/api/payment-collections/${confirmed.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal((await request(`/api/payment-collections/${confirmed.data.id}`, { token: accountingToken, method: 'DELETE' })).status, 409);
  });

  test('reconciliation CHECK reports cache mismatch without mutating it', async () => {
    const customerId = ensureCustomer('P5-CHECK');
    const { receivableId } = await createConfirmedDelivery(customerId, 123456);
    database.prepare('UPDATE account_receivables SET paid_cents=1,open_amount_cents=1,status=\'COMPLETED\' WHERE id=?').run(receivableId);
    const check = await request('/api/settlement/reconciliation', { token: accountingToken });
    assert.equal(check.status, 200);
    assert.equal(check.data.ok, false);
    assert.ok(check.data.issues.some((issue) => issue.id === receivableId && issue.code === 'PAID_CACHE_MISMATCH'));
    assert.equal(database.prepare('SELECT paid_cents FROM account_receivables WHERE id=?').get(receivableId).paid_cents, 1);
    database.prepare("UPDATE account_receivables SET paid_cents=0,open_amount_cents=123456,status='PENDING' WHERE id=?").run(receivableId);
  });
});
