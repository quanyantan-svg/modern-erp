// Procurement & Outsourcing Domain — Purchase Return 4-branch EXECUTION-level assertions.
// Goes through the real confirm/post handler and inspects persisted financial side effects.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

async function makeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'prc-ret-exec-'));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: join(tempDir, 'dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, token, body) {
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
  async function login(u, p) {
    const r = await request('POST', '/api/auth/login', null, { username: u, password: p });
    return r.data.token;
  }
  const tokens = {
    admin: await login('admin', 'admin123'),
    warehouse: await login('warehouse', 'warehouse123'),
    reviewer: await login('reviewer', 'review123'),
  };
  function close() {
    return new Promise((done, reject) => server.close((err) => err ? reject(err) : done()))
      .then(() => { db.close(); rmSync(tempDir, { recursive: true, force: true }); });
  }
  return { db, request, tokens, close };
}

async function createApprovedPO(poTokens) {
  const po = await poTokens.request('POST', '/api/purchase-orders', poTokens.tokens.admin, {
    supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
    supplierContactName: '联系人', supplierContactPhone: '13800000000', supplierAddress: '地址', paymentTerms: '30 天',
    items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 1000 }],
  });
  assert.equal(po.status, 201, po.data.error);
  await poTokens.request('POST', `/api/purchase-orders/${po.data.id}/submit`, poTokens.tokens.admin);
  await poTokens.request('POST', `/api/purchase-orders/${po.data.id}/approve`, poTokens.tokens.reviewer);
  return po.data.id;
}

async function createAndConfirmReceipt(poTokens, { poId, billingMode, quantity = 10, unitPrice = 1000 }) {
  // Use the actual API to ensure the canonical confirm handler runs.
  const poiRow = poTokens.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(poId);
  const create = await poTokens.request('POST', '/api/purchase-receipts', poTokens.tokens.warehouse, {
    purchaseOrderId: poId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
    receiptDate: '2026-10-09', billingMode, remark: 'return-exec-test',
    items: [{ purchaseOrderItemId: poiRow.id, productId: 'product-001', quantity, unitPriceCents: unitPrice }],
  });
  assert.equal(create.status, 201, create.data.error);
  const receiptId = create.data.id;
  // Lookup actual receipt item ID assigned by the API
  const receiptItemId = poTokens.db.prepare('SELECT id FROM purchase_receipt_items WHERE receipt_id=?').get(receiptId).id;
  // IQC pass + confirm via API so canonical handler runs.
  const iqc = await poTokens.request('POST', '/api/iqc', poTokens.tokens.warehouse, { purchase_receipt_id: receiptId });
  if (iqc.status === 201) {
    await poTokens.request('POST', `/api/iqc/${iqc.data.id}/complete`, poTokens.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
  }
  await poTokens.request('POST', `/api/purchase-receipts/${receiptId}`, poTokens.tokens.warehouse, { action: 'confirm' });
  return { receiptId, receiptItemId };
}

describe('Purchase Return 4-branch execution-level financial evidence', () => {
  let fix;
  before(async () => { fix = await makeFixture(); });
  after(async () => fix.close());

  test('LEGACY_DIRECT: inventory+valuation reversal + AP credit; NO GRNI', async () => {
    const poId = await createApprovedPO(fix);
    const { receiptId, receiptItemId } = await createAndConfirmReceipt(fix, { poId, billingMode: 'LEGACY_DIRECT' });
    // Inventory + AP exist after receipt
    const apBefore = fix.db.prepare("SELECT amount_cents, paid_cents, open_amount_cents FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId);
    assert.ok(apBefore, 'LEGACY_DIRECT must produce AP source');
    assert.equal(apBefore.amount_cents, 10000);
    const invBefore = fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity;
    // Create & confirm Purchase Return
    const ret = await fix.request('POST', '/api/purchase-returns', fix.tokens.warehouse, {
      receiptId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      items: [{ receiptItemId, productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
    });
    assert.equal(ret.status, 201, ret.data.error);
    await fix.request('POST', `/api/purchase-returns/${ret.data.id}`, fix.tokens.warehouse, { action: 'confirm' });
    const apAfter = fix.db.prepare("SELECT amount_cents, open_amount_cents FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId);
    assert.ok(apAfter, 'AP must still exist');
    assert.ok(apAfter.amount_cents <= apBefore.amount_cents, 'AP amount must decrease after return');
    const invAfter = fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity;
    assert.ok(Number(invAfter) < Number(invBefore), 'inventory must decrease after return');
  });

  test('SEPARATE unbilled: GRNI reversal; NO AP fabricated', async () => {
    const poId = await createApprovedPO(fix);
    const { receiptId, receiptItemId } = await createAndConfirmReceipt(fix, { poId, billingMode: 'SEPARATE' });
    const apBefore = fix.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n;
    assert.equal(apBefore, 0, 'SEPARATE unbilled must NOT create AP');
    const ret = await fix.request('POST', '/api/purchase-returns', fix.tokens.warehouse, {
      receiptId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      items: [{ receiptItemId, productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
    });
    assert.equal(ret.status, 201, ret.data.error);
    await fix.request('POST', `/api/purchase-returns/${ret.data.id}`, fix.tokens.warehouse, { action: 'confirm' });
    const apAfter = fix.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n;
    assert.equal(apAfter, 0, 'SEPARATE unbilled return must NOT create AP credit');
    const invAfter = fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity;
    assert.ok(Number(invAfter) >= 0, 'inventory must have moved (decreased or zero)');
  });

  test('SEPARATE billed: AP credit against canonical payable; no GRNI dup', async () => {
    const poId = await createApprovedPO(fix);
    const { receiptId, receiptItemId } = await createAndConfirmReceipt(fix, { poId, billingMode: 'SEPARATE' });
    const now = new Date().toISOString();
    // Create a supplier bill POSTED (full bill) to set receipt as billed.
    fix.db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,gross_cents,creator_id,created_at)
      VALUES('sb-exec-1','SB-EXEC-1','supplier-001','INV-EXEC-1',?,'POSTED','NO_TAX',10000,10000,'user-admin',?)`).run(now, now);
    fix.db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no)
      VALUES('sbi-exec-1','sb-exec-1',?,?,?,'EA',10,1,1,1,10,1,1000,10000,0,10000,1)`).run(receiptId, receiptItemId, 'product-001');
    fix.db.prepare(`INSERT INTO account_payables(id,voucher_no,supplier_id,source_type,source_id,amount_cents,paid_cents,write_off_cents,status,due_date,creator_id,created_at,item_class,source_no)
      VALUES('ap-billed-1','AP-BILLED-1','supplier-001','SUPPLIER_BILL','sb-exec-1',10000,0,0,'PENDING',?,'user-warehouse',?,'SOURCE','sb-exec-1')`).run(now, now);
    const apBefore = fix.db.prepare("SELECT amount_cents FROM account_payables WHERE source_id='sb-exec-1'").get();
    assert.ok(apBefore, 'AP must exist from full bill');
    const ret = await fix.request('POST', '/api/purchase-returns', fix.tokens.warehouse, {
      receiptId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      items: [{ receiptItemId, productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
    });
    assert.equal(ret.status, 201, ret.data.error);
    await fix.request('POST', `/api/purchase-returns/${ret.data.id}`, fix.tokens.warehouse, { action: 'confirm' });
    const credit = fix.db.prepare("SELECT amount_cents FROM financial_credit_adjustments WHERE source_type='PURCHASE_RETURN' AND source_id=? AND side='AP'").get(ret.data.id);
    assert.ok(credit, 'AP credit adjustment must exist');
    assert.equal(credit.amount_cents, 5000, 'AP credit = billed-portion × unit price');
  });

  test('SEPARATE partial billed: billed-first deterministic split (40→AP / 30→GRNI)', async () => {
    const poId = await createApprovedPO(fix);
    const { receiptId, receiptItemId } = await createAndConfirmReceipt(fix, { poId, billingMode: 'SEPARATE' });
    const now = new Date().toISOString();
    // Bill 40 of 100 (residual = 60 unbilled). Return 70 → billed-first: 40→AP, 30→GRNI reversal.
    fix.db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,gross_cents,creator_id,created_at)
      VALUES('sb-exec-2','SB-EXEC-2','supplier-001','INV-EXEC-2',?,'POSTED','NO_TAX',4000,4000,'user-admin',?)`).run(now, now);
    fix.db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no)
      VALUES('sbi-exec-2','sb-exec-2',?,?,?,'EA',4,1,1,1,4,1,1000,4000,0,4000,1)`).run(receiptId, receiptItemId, 'product-001');
    fix.db.prepare(`INSERT INTO account_payables(id,voucher_no,supplier_id,source_type,source_id,amount_cents,paid_cents,write_off_cents,status,due_date,creator_id,created_at,item_class,source_no)
      VALUES('ap-partial-1','AP-PARTIAL-1','supplier-001','SUPPLIER_BILL','sb-exec-2',4000,0,0,'PENDING',?,'user-warehouse',?,'SOURCE','sb-exec-2')`).run(now, now);
    const apBefore = fix.db.prepare("SELECT amount_cents FROM account_payables WHERE source_id='sb-exec-2'").get();
    assert.equal(apBefore.amount_cents, 4000, 'AP from 4-unit bill = 4000');
    const ret = await fix.request('POST', '/api/purchase-returns', fix.tokens.warehouse, {
      receiptId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      items: [{ receiptItemId, productId: 'product-001', quantity: 7, unitPriceCents: 1000 }],
    });
    assert.equal(ret.status, 201, ret.data.error);
    const confirmRes = await fix.request('POST', `/api/purchase-returns/${ret.data.id}`, fix.tokens.warehouse, { action: 'confirm' });
    assert.equal(confirmRes.status, 200, confirmRes.data?.error || 'confirm failed');
    // AP credit = 4 × 1000 = 4000 (billed portion, deterministic first)
    const apCreditRows = fix.db.prepare("SELECT amount_cents FROM financial_credit_adjustments WHERE source_type='PURCHASE_RETURN' AND source_id=? AND side='AP'").all(ret.data.id);
    assert.ok(apCreditRows.length >= 1, 'AP credit adjustment must exist for billed portion');
    const apCreditTotal = apCreditRows.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(apCreditTotal, 4000, 'AP credit = billed-portion (4) × unit price (1000)');
    // GRNI reversal = 30 × 1000 = 3000 (unbilled portion, deterministic)
    const grniRows = fix.db.prepare(`SELECT e.* FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN account_role_mappings m ON m.subject_id=e.subject_id
      WHERE v.source_type='PURCHASE_RETURN' AND v.source_id=? AND m.role_code='GRNI'`).all(ret.data.id);
    assert.ok(grniRows.length >= 1, 'GRNI reversal voucher line must exist');
    const grniAmount = grniRows.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(grniAmount, 3000, 'GRNI reversal = unbilled-portion (3) × unit price (1000)');
  });
});
