import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';

// Phase 6E Acceptance UAT — Real disposable-DB end-to-end integration.
//
// Drives the actual HTTP API to exercise the SEPARATE commercial flow
// (PO → Receipt → IQC → GRNI → Supplier Bill → AP, Delivery → Sales
// Invoice → AR / Revenue / Tax), Settlement, Credit Note and System
// Health reconciliation.  Asserts every GL account balances and System
// Health has no BLOCKING FAIL.

describe('V1.3 Phase 6E commercial go-live end-to-end UAT', () => {
  let temp; let db; let server; let baseUrl; const tokens = {};
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
    try { data = await response.json(); } catch { /* empty */ }
    return { status: response.status, data };
  };

  beforeEach(async () => {
    temp = createTempDb({ label: 'p6e-uat', production: true });
    db = temp.db;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('uat-c','CUAT','UAT Customer','Alice','13000000000','SZ',1,?,?)").run(now, now);
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('uat-s','SUAT','UAT Supplier','Bob','13100000000','DG',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('uat-w','WUAT','UAT Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,inventory_classification,valuation_activated_at) VALUES('uat-p','UP','Product','FINISHED_GOOD','EA',50000,0,1,?,?,'EA','NONE','MOVING_AVERAGE','FINISHED_GOODS_INVENTORY',?)").run(now, now, now);
    for (const [name, role] of [['admin', 'role-admin'], ['sales', 'role-sales'], ['reviewer', 'role-reviewer'], ['warehouse', 'role-warehouse'], ['accounting', 'role-accounting']]) {
      const hash = hashPassword(`${name}-uat-1234`);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run(`user-${name}`, name, name, hash.hash, hash.salt, role, now);
    }
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['admin', 'sales', 'reviewer', 'warehouse', 'accounting']) {
      const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name}-uat-1234` }) });
      tokens[name] = (await response.json()).token;
    }
  });
  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    temp.cleanup();
  });

  test('cross-domain flow: PO Receipt IQC Bill GRNI AP Delivery Invoice AR COGS Tax Settlement Credit', async () => {
    const date = '2026-09-25';

    // ============ Purchase Order 100 @ 500 = 50000 ============
    const po = await request('/api/purchase-orders', 'sales', 'POST', {
      supplierId: 'uat-s', orderDate: date, expectedDeliveryDate: date, paymentTerms: '货到 30 天',
      items: [{ productId: 'uat-p', quantity: 100, unitPriceCents: 500 }],
    });
    assert.equal(po.status, 201, po.data.error);
    const poSubmit = await request(`/api/purchase-orders/${po.data.id}/submit`, 'sales', 'POST', {});
    assert.equal(poSubmit.status, 200, `submit failed: ${poSubmit.data.error}`);
    const poApprove = await request(`/api/purchase-orders/${po.data.id}/approve`, 'reviewer', 'POST', {});
    assert.equal(poApprove.status, 200, `approve failed: ${poApprove.data.error}`);

    // ============ Purchase Receipt 100 SEPARATE → Inventory + GRNI ============
    const poItemId = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(po.data.id).id;
    const rec = await request('/api/purchase-receipts', 'warehouse', 'POST', {
      supplierId: 'uat-s', warehouseId: 'uat-w', purchaseOrderId: po.data.id, receiptDate: date, billingMode: 'SEPARATE',
      items: [{ productId: 'uat-p', quantity: 100, unitPriceCents: 500, purchaseOrderItemId: poItemId }],
    });
    assert.equal(rec.status, 201, rec.data.error);

    // IQC PASS (Phase 3 quality gate)
    const iqcCreate = await request('/api/iqc', 'warehouse', 'POST', {
      purchase_receipt_id: rec.data.id, inspectionType: 'NORMAL', inspectionDate: date,
    });
    assert.equal(iqcCreate.status, 201, iqcCreate.data.error);
    const iqcComp = await request(`/api/iqc/${iqcCreate.data.id}/complete`, 'warehouse', 'POST', { result: 'PASS', qualified_quantity: 100, reject_quantity: 0 });
    assert.equal(iqcComp.status, 200, iqcComp.data.error);

    const recConfirm = await request(`/api/purchase-receipts/${rec.data.id}`, 'warehouse', 'POST', { action: 'confirm' });
    assert.equal(recConfirm.status, 200, `confirm failed: ${recConfirm.data.error}`);
    assert.equal(db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=?').get('uat-p', 'uat-w').quantity, 100);
    // Receipt confirm in SEPARATE mode must credit GRNI (Dr inventory / Cr GRNI)
    const grniNet = db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='GRNI')").get().n;
    assert.equal(grniNet, -50000, 'receipt confirm credits GRNI by 50000');

    // ============ Tax code 13% EXCLUSIVE ============
    const tax = await request('/api/tax-codes', 'accounting', 'POST', { code: 'VAT13', name: 'VAT 13%', rateNumerator: 13, rateDenominator: 100, effectiveFrom: '2026-01-01' });
    assert.equal(tax.status, 201, tax.data.error);

    // ============ Supplier Bill 100 EXCLUSIVE 13% → AP + Input Tax + clears GRNI ============
    const bill = await request('/api/supplier-bills', 'accounting', 'POST', {
      supplierId: 'uat-s', supplierInvoiceNo: 'SUAT-001', billDate: date, taxMode: 'EXCLUSIVE',
      items: [{ productId: 'uat-p', quantity: 100, unitPriceCents: 500, taxCode: 'VAT13' }],
    });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    const billItemId = db.prepare('SELECT id FROM supplier_bill_items WHERE bill_id=?').get(billId).id;
    const recItemId = db.prepare('SELECT id FROM purchase_receipt_items WHERE receipt_id=?').get(rec.data.id).id;
    const matchRes = await request(`/api/supplier-bills/${billId}/match`, 'accounting', 'POST', { items: [{ billItemId, receiptItemId: recItemId }] });
    assert.equal(matchRes.status, 200, matchRes.data.error);
    const postBill = await request(`/api/supplier-bills/${billId}/post`, 'accounting', 'POST', {});
    assert.equal(postBill.status, 200, postBill.data.error);
    // Bill: net 50000, tax 6500, gross 56500
    const apCents = Number(db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId).amount_cents);
    assert.equal(apCents, 56500);
    const grniAfterBill = db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='GRNI')").get().n;
    assert.equal(grniAfterBill, 0, 'GRNI must be 0 after bill post');

    // ============ Delivery 60 SEPARATE → Inventory OUT + COGS, NO AR/Revenue ============
    const so = await request('/api/orders', 'sales', 'POST', {
      customerId: 'uat-c', orderDate: date, requestedDeliveryDate: date, paymentTerms: '月结 30 天',
      items: [{ productId: 'uat-p', quantity: 60, unitPriceCents: 50000 }],
    });
    assert.equal(so.status, 201, so.data.error);
    assert.equal((await request(`/api/orders/${so.data.id}/submit`, 'sales', 'POST', {})).status, 200);
    assert.equal((await request(`/api/orders/${so.data.id}/approve`, 'reviewer', 'POST', {})).status, 200);
    const soItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=?').get(so.data.id).id;
    const del = await request('/api/sales-deliveries', 'warehouse', 'POST', {
      customerId: 'uat-c', warehouseId: 'uat-w', salesOrderId: so.data.id, deliveryDate: date, billingMode: 'SEPARATE',
      items: [{ productId: 'uat-p', quantity: 60, unitPriceCents: 50000, salesOrderItemId: soItemId }],
    });
    assert.equal(del.status, 201, del.data.error);
    // OQC PASS (Phase 3 quality gate) — sales delivery is also quality-gated
    const oqcCreate = await request('/api/oqc', 'warehouse', 'POST', {
      sales_delivery_id: del.data.id, inspectionType: 'NORMAL', inspectionDate: date,
    });
    assert.equal(oqcCreate.status, 201, oqcCreate.data.error);
    const oqcComp = await request(`/api/oqc/${oqcCreate.data.id}/complete`, 'warehouse', 'POST', { result: 'PASS', qualified_quantity: 60, reject_quantity: 0 });
    assert.equal(oqcComp.status, 200, oqcComp.data.error);
    const delConfirm = await request(`/api/sales-deliveries/${del.data.id}`, 'warehouse', 'POST', { action: 'confirm' });
    assert.equal(delConfirm.status, 200, delConfirm.data.error);
    // SEPARATE delivery: no AR or Revenue
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY'").get().n, 0);
    assert.equal(db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=?').get('uat-p', 'uat-w').quantity, 40);

    // ============ Sales Invoice EXCLUSIVE 13% → AR / Revenue / Output Tax ============
    const delItemId = db.prepare('SELECT id FROM sales_delivery_items WHERE delivery_id=?').get(del.data.id).id;
    const inv = await request('/api/sales-invoices', 'accounting', 'POST', {
      customerId: 'uat-c', invoiceDate: date, taxMode: 'EXCLUSIVE',
      items: [{ deliveryItemId: delItemId, quantity: 60, unitPriceCents: 50000, taxCode: 'VAT13' }],
    });
    assert.equal(inv.status, 201, inv.data.error);
    const invPost = await request(`/api/sales-invoices/${inv.data.id}/post`, 'accounting', 'POST', {});
    assert.equal(invPost.status, 200, invPost.data.error);
    // Invoice: net = 60*50000 = 3000000, tax 390000, gross 3390000
    const arCents = Number(db.prepare("SELECT amount_cents FROM account_receivables WHERE source_type='SALES_INVOICE' AND source_id=?").get(inv.data.id).amount_cents);
    assert.equal(arCents, 3390000);

    // ============ Settlement: Collection of 1000000 (partial) ============
    const arId = db.prepare("SELECT id FROM account_receivables WHERE source_type='SALES_INVOICE' AND source_id=?").get(inv.data.id).id;
    const col = await request('/api/payment-collections', 'accounting', 'POST', {
      customerId: 'uat-c', collectionDate: date, amountCents: 1000000, paymentMethod: 'CASH', settlementAccountId: 'subject-001',
      allocations: [{ receivableId: arId, amountCents: 1000000 }],
    });
    assert.equal(col.status, 201, col.data.error);
    assert.equal((await request(`/api/payment-collections/${col.data.id}/confirm`, 'accounting', 'POST', {})).status, 200);

    // ============ Sales Credit Note 500000 (DISCOUNT) — gross reduction + tax reversal ============
    const cn = await request('/api/commercial-credit-notes', 'accounting', 'POST', {
      side: 'AR', sourceId: inv.data.id, creditDate: date, grossCents: 500000, reason: '客户折让', adjustmentType: 'DISCOUNT',
    });
    assert.equal(cn.status, 201, cn.data.error);

    // ============ Reconciliation: every GL account balances ============
    const health = await request('/api/system-health', 'admin');
    const checks = health.data.checks;
    const failures = checks.filter((c) => c.status === 'FAIL' && c.severity === 'BLOCKING');
    assert.deepEqual(failures, [], `BLOCKING FAIL: ${failures.map((f) => `${f.code}=${f.difference}`).join(', ')}`);

    const wantCodes = ['AR_TO_GL', 'AP_TO_GL', 'RECEIPT_GRNI_TO_GL', 'OUTPUT_TAX_TO_GL', 'INPUT_TAX_TO_GL', 'COGS_TO_GL', 'SALES_INVOICE_TO_AR_GL', 'SUPPLIER_BILL_TO_AP_GL'];
    for (const code of wantCodes) {
      const c = checks.find((x) => x.code === code);
      assert.ok(c, `missing check ${code}`);
      assert.equal(c.status, 'PASS', `${code} diff=${c.difference}`);
    }

    // AR open balance: 3390000 - 1000000 (collection) - 500000 (credit note) = 1890000
    const openAr = Number(db.prepare("SELECT open_amount_cents FROM account_receivables WHERE source_type='SALES_INVOICE' AND source_id=?").get(inv.data.id).open_amount_cents);
    assert.equal(openAr, 1890000, 'credit note must reduce AR open balance');

    // ============ Supplier Credit Note (post-bill discount): GRNI stays 0 ============
    const scn = await request('/api/commercial-credit-notes', 'accounting', 'POST', {
      side: 'AP', sourceId: billId, creditDate: date, grossCents: 11300, reason: '供应商折让', adjustmentType: 'DISCOUNT',
    });
    assert.equal(scn.status, 201, scn.data.error);
    const grniAfterCredit = db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='GRNI')").get().n;
    assert.equal(grniAfterCredit, 0, 'supplier credit note must NEVER touch GRNI after bill post');
  });
});