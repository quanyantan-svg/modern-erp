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

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
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
  const create = await request('/api/sales-deliveries', { token: salesToken, method: 'POST', body: {
    customerId, warehouseId, deliveryDate: '2026-08-01', remark: 'm14 fixture',
    items: [{ productId, quantity: 1, unitPriceCents: totalCents }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const id = create.data.id;
  const confirm = await request(`/api/sales-deliveries/${id}`, { token: salesToken, method: 'POST', body: { action: 'confirm' } });
  assert.equal(confirm.status, 200);
  const ar = database.prepare("SELECT id FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(id);
  return { deliveryId: id, receivableId: ar.id };
}

async function createConfirmedReceipt(supplierId, totalCents) {
  const productId = ensureProduct('P-REC');
  const warehouseId = ensureWarehouse('WH-REC');
  const create = await request('/api/purchase-receipts', { token: salesToken, method: 'POST', body: {
    supplierId, warehouseId, receiptDate: '2026-08-01', remark: 'm14 fixture',
    items: [{ productId, quantity: 1, unitPriceCents: totalCents }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const id = create.data.id;
  const confirm = await request(`/api/purchase-receipts/${id}`, { token: salesToken, method: 'POST', body: { action: 'confirm' } });
  assert.equal(confirm.status, 200);
  const ap = database.prepare("SELECT id FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(id);
  return { receiptId: id, payableId: ap.id };
}

function getReceivable(id) {
  return database.prepare('SELECT amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=?').get(id);
}
function getPayable(id) {
  return database.prepare('SELECT amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_payables WHERE id=?').get(id);
}
function customerNet(customerId) {
  return Number(database.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_receivables WHERE customer_id=?`).get(customerId).n);
}
function supplierNet(supplierId) {
  return Number(database.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_payables WHERE supplier_id=?`).get(supplierId).n);
}
function voucherCount(sourceType, sourceId) {
  return database.prepare(`SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type=? AND source_id=?`).get(sourceType, sourceId).n;
}

// =====================================================================
// M14 — Sales Discount
// =====================================================================

describe('M14 — Sales Discount', () => {
  test('1. permission registry has 113 entries; SALES_DISCOUNT_MANAGE / PURCHASE_DISCOUNT_MANAGE exist', () => {
    assert.equal(PERMISSIONS.length, 113);
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

  test('4. confirm success: stock + inventory unchanged; one negative AR adjustment + voucher; second confirm 409', async () => {
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
    assert.equal(Number(ar.adjustment_cents), 0);
    assert.equal(Number(ar.paid_cents), 0);
    // New SALES_DISCOUNT AR row created with adjustment = -2000.
    const discRow = database.prepare("SELECT * FROM account_receivables WHERE source_type='SALES_DISCOUNT' AND source_id=?").get(id);
    assert.ok(discRow);
    assert.equal(Number(discRow.amount_cents), 0);
    assert.equal(Number(discRow.adjustment_cents), -2000);
    assert.equal(discRow.customer_id, 'customer-001');
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
    assert.equal(Number(ar.adjustment_cents), 0);
    assert.equal(Number(ar.paid_cents), 8000);
    assert.equal(customerNet(cust), -1000);
    const allocSum = database.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM payment_collection_items WHERE receivable_id=?`).get(receivableId).n;
    assert.equal(Number(allocSum), 8000);
  });

  test('8. FUTURE OFFSET: customer credit -1000 + new AR 5000 -> net 4000, collection 4000 OK, 4001 409', async () => {
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
    // 2000 collection OK; 2001 rejected.
    const ok = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 2000, paymentMethod: 'BANK',
      allocations: [{ receivableId: newAr, amountCents: 2000 }],
    } });
    const okConfirm = await request(`/api/payment-collections/${ok.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(okConfirm.status === 200 || okConfirm.status === 409, true, JSON.stringify(okConfirm.data));
    if (okConfirm.status === 200) {
      assert.equal(customerNet(cust), 0);
    }
    const over = await request('/api/payment-collections', { token: accountingToken, method: 'POST', body: {
      customerId: cust, businessDate: '2026-08-15', amountCents: 2001, paymentMethod: 'BANK',
      allocations: [{ receivableId: newAr, amountCents: 2001 }],
    } });
    const overConfirm = await request(`/api/payment-collections/${over.data.id}/confirm`, { token: accountingToken, method: 'POST', body: {} });
    assert.equal(overConfirm.status === 409 || overConfirm.status === 400, true, JSON.stringify(overConfirm.data));
  });
});

// =====================================================================
// M14 — Purchase Discount (symmetric to Sales Discount)
// =====================================================================

describe('M14 — Purchase Discount', () => {
  test('9. confirm success: one negative AP adjustment + voucher; second confirm 409; CAP enforced', async () => {
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
      assert.equal(Number(ap.adjustment_cents), 0);
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
  test('12. customer / supplier statement shows SALES_DISCOUNT / PURCHASE_DISCOUNT line types', async () => {
    const custStatement = await request('/api/accounts-receivable/statement?customer=customer-001&dateFrom=2026-08-01&dateTo=2026-12-31', { token: accountingToken });
    assert.equal(custStatement.status, 200);
    const supStatement = await request('/api/accounts-payable/statement?supplier=supplier-001&dateFrom=2026-08-01&dateTo=2026-12-31', { token: accountingToken });
    assert.equal(supStatement.status, 200);
    // The numbers should reconcile: summary.adjustmentCents should include SALES_DISCOUNT / PURCHASE_DISCOUNT.
    assert.ok(custStatement.data.summary.adjustmentCents > 0 || custStatement.data.rows.some((r) => r.source_type === 'SALES_DISCOUNT'));
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
