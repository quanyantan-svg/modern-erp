// Procurement & Outsourcing Domain — SEPARATE default runtime proof,
// Processing Fee AP race / multi-bill / multi-receipt / AP posting,
// Wave H atomicity regression.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

async function makeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'prc-exec-suite-'));
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
  return {
    db, request, tokens,
    close: () => new Promise((done, reject) => server.close((err) => err ? reject(err) : done()))
      .then(() => { db.close(); rmSync(tempDir, { recursive: true, force: true }); }),
  };
}

async function createApprovedPO(fix, { quantity = 10, unitPriceCents = 1000 } = {}) {
  const po = await fix.request('POST', '/api/purchase-orders', fix.tokens.admin, {
    supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
    supplierContactName: '联系人', supplierContactPhone: '13800000000', supplierAddress: '地址', paymentTerms: '30 天',
    items: [{ productId: 'product-001', quantity, unitPriceCents }],
  });
  assert.equal(po.status, 201, po.data.error);
  await fix.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fix.tokens.admin);
  await fix.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fix.tokens.reviewer);
  return po.data.id;
}

async function qualifyOutsourceSupplier(fix) {
  const r = await fix.request('PATCH', '/api/suppliers/supplier-001/profile', fix.tokens.admin, {
    outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
    qualificationValidFrom: '2026-01-01', qualificationValidTo: '2027-12-31',
  });
  assert.equal(r.status, 200);
}

describe('SEPARATE default runtime proof + Processing Fee AP execution + Wave H atomicity', () => {
  let fix;
  before(async () => { fix = await makeFixture(); });
  after(async () => fix.close());

  test('SEPARATE default: new receipt without explicit billingMode → SEPARATE', async () => {
    const poId = await createApprovedPO(fix);
    const poiRow = fix.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(poId);
    const create = await fix.request('POST', '/api/purchase-receipts', fix.tokens.warehouse, {
      purchaseOrderId: poId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
      receiptDate: '2026-10-09',
      // NOTE: billingMode NOT provided → uses parameter default
      items: [{ purchaseOrderItemId: poiRow.id, productId: 'product-001', quantity: 10, unitPriceCents: 1000 }],
    });
    assert.equal(create.status, 201, create.data.error);
    const persisted = fix.db.prepare('SELECT billing_mode FROM purchase_receipts WHERE id=?').get(create.data.id);
    assert.equal(persisted.billing_mode, 'SEPARATE', 'SEPARATE default without explicit billingMode');
    // Confirm and verify: GRNI reversal side effects, no AP fabrication
    const iqc = await fix.request('POST', '/api/iqc', fix.tokens.warehouse, { purchase_receipt_id: create.data.id });
    if (iqc.status === 201) {
      await fix.request('POST', `/api/iqc/${iqc.data.id}/complete`, fix.tokens.warehouse, {
        result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0,
      });
    }
    await fix.request('POST', `/api/purchase-receipts/${create.data.id}`, fix.tokens.warehouse, { action: 'confirm' });
    const apCount = fix.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(create.data.id).n;
    assert.equal(apCount, 0, 'SEPARATE unbilled confirm must NOT create AP');
    // Inventory increased
    const inv = fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
    assert.ok(Number(inv.quantity) >= 10, 'inventory must reflect receipt');
  });

  test('Processing Fee Supplier Bill: 100 qty / 30+20+50 cumulative / 4th > remaining → 409', async () => {
    await qualifyOutsourceSupplier(fix);
    // Create outsourcing order + released + material + issue
    const order = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: '2026-10-08',
    });
    assert.equal(order.status, 201);
    const orderId = order.data.id;
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'RELEASED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fix.tokens.admin, {
      items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
    });
    const matId = fix.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fix.tokens.warehouse, {
      materialListId: matId, quantity: 100, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: '2026-10-08',
    });
    // Receipt 100 qty
    const r = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
      orderId, quantity: 100, receivedDate: '2026-10-09', processingFeeCents: 10000,
    });
    assert.equal(r.status, 201);
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${r.data.id}/confirm`, fix.tokens.admin);
    // Add receipt_item (100 qty)
    fix.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
      VALUES('ori-suite-1',?,?,100,100,1)`).run(r.data.id, 'product-001');
    // Bill A: 30
    const billA = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-A', billDate: '2026-10-09', idempotencyKey: 'k-A',
      lines: [{ outsourcingReceiptItemId: 'ori-suite-1', quantity: 30, unitPriceCents: 100 }],
    });
    assert.equal(billA.status, 201, billA.data.error);
    // Bill B: 20
    const billB = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-B', billDate: '2026-10-09', idempotencyKey: 'k-B',
      lines: [{ outsourcingReceiptItemId: 'ori-suite-1', quantity: 20, unitPriceCents: 100 }],
    });
    assert.equal(billB.status, 201, billB.data.error);
    // Bill C: 50 (total 100)
    const billC = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-C', billDate: '2026-10-09', idempotencyKey: 'k-C',
      lines: [{ outsourcingReceiptItemId: 'ori-suite-1', quantity: 50, unitPriceCents: 100 }],
    });
    assert.equal(billC.status, 201, billC.data.error);
    // Bill D: 30 → remaining is 0 → 409
    const billD = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-D', billDate: '2026-10-09', idempotencyKey: 'k-D',
      lines: [{ outsourcingReceiptItemId: 'ori-suite-1', quantity: 30, unitPriceCents: 100 }],
    });
    assert.equal(billD.status, 409, JSON.stringify(billD.data));
    assert.match(billD.data.error || '', /可计费|超出|exceeded|Billable/i);
    // Post Bill A → AP opens
    const post = await fix.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billA.data.id}/post`, fix.tokens.admin);
    assert.equal(post.status, 200);
    const ap = fix.db.prepare("SELECT amount_cents, supplier_id, source_id FROM account_payables WHERE source_id=?").get(billA.data.id);
    assert.ok(ap, 'canonical AP must exist after posting');
    assert.equal(ap.amount_cents, 3000);
    assert.equal(ap.supplier_id, 'supplier-001');
  });

  test('One bill → multiple Outsourcing Receipts (multi-receipt): commercial_source_type per item', async () => {
    await qualifyOutsourceSupplier(fix);
    // Two orders, two receipts (40 + 60)
    const order1 = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 40, businessDate: '2026-10-08',
    });
    const order2 = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 60, businessDate: '2026-10-08',
    });
    for (const oid of [order1.data.id, order2.data.id]) {
      await fix.request('POST', `/api/procurement/outsourcing/orders/${oid}/transition`, fix.tokens.admin, { action: 'PLAN_CONFIRMED' });
      await fix.request('POST', `/api/procurement/outsourcing/orders/${oid}/transition`, fix.tokens.admin, { action: 'RELEASED' });
      await fix.request('POST', `/api/procurement/outsourcing/orders/${oid}/material-list`, fix.tokens.admin, {
        items: [{ productId: 'product-001', requiredQuantity: 1, unit: 'PCS' }],
      });
      const matId = fix.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(oid).id;
      await fix.request('POST', `/api/procurement/outsourcing/orders/${oid}/issues`, fix.tokens.warehouse, {
        materialListId: matId, quantity: 40, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: '2026-10-08',
      });
    }
    const r1 = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
      orderId: order1.data.id, quantity: 40, receivedDate: '2026-10-09', processingFeeCents: 4000,
    });
    const r2 = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
      orderId: order2.data.id, quantity: 60, receivedDate: '2026-10-09', processingFeeCents: 6000,
    });
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${r1.data.id}/confirm`, fix.tokens.admin);
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${r2.data.id}/confirm`, fix.tokens.admin);
    fix.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no) VALUES('ori-multi-1',?,?,40,100,1)`).run(r1.data.id, 'product-001');
    fix.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no) VALUES('ori-multi-2',?,?,60,100,1)`).run(r2.data.id, 'product-001');
    // ONE bill → TWO receipt items
    const bill = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-MULTI', billDate: '2026-10-09', idempotencyKey: 'k-multi',
      lines: [
        { outsourcingReceiptItemId: 'ori-multi-1', quantity: 40, unitPriceCents: 100 },
        { outsourcingReceiptItemId: 'ori-multi-2', quantity: 60, unitPriceCents: 100 },
      ],
    });
    assert.equal(bill.status, 201, bill.data.error);
    const items = fix.db.prepare(`SELECT commercial_source_type, commercial_source_id, commercial_source_item_id FROM supplier_bill_items WHERE bill_id=? ORDER BY line_no`).all(bill.data.id);
    assert.equal(items.length, 2, 'one bill with two receipt items');
    assert.equal(items[0].commercial_source_type, 'OUTSOURCING_RECEIPT_ITEM');
    assert.equal(items[0].commercial_source_id, r1.data.id, 'first item → first receipt');
    assert.equal(items[0].commercial_source_item_id, 'ori-multi-1');
    assert.equal(items[1].commercial_source_id, r2.data.id, 'second item → second receipt');
    assert.equal(items[1].commercial_source_item_id, 'ori-multi-2');
    // Header must NOT collapse to one receipt
    assert.notEqual(items[0].commercial_source_id, items[1].commercial_source_id, 'header must not collapse to one receipt source');
  });

  test('Wave H atomicity: failed confirm rolls back (no finished inventory, no cost evidence)', async () => {
    await qualifyOutsourceSupplier(fix);
    const order = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: '2026-10-08',
    });
    assert.equal(order.status, 201);
    const orderId = order.data.id;
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'RELEASED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fix.tokens.admin, {
      items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
    });
    const matId = fix.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    // Insufficient issue: only 2 units (need 5 for backflush at 30% cumulative)
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fix.tokens.warehouse, {
      materialListId: matId, quantity: 2, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: '2026-10-08',
    });
    const invBefore = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    const r = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
      orderId, quantity: 30, receivedDate: '2026-10-09', processingFeeCents: 30000,
    });
    assert.equal(r.status, 201);
    // backflush target for material-1 = 5 × 30/100 = 1.5; incremental = 1.5; netSupplied=2; remaining=2; 1.5 <= 2 OK
    // But we need to test FAILED case. Let's use 0 issued to ensure insufficient.
    // Since we already issued 2, we can't go below. Force failure by setting issued back to 0:
    fix.db.prepare("UPDATE outsourcing_material_list SET issued_quantity=0 WHERE id=?").run(matId);
    // Attempt confirm: incremental=1.5 > netSupplied=0 → throw
    const confirm = await fix.request('POST', `/api/procurement/outsourcing/receipts/${r.data.id}/confirm`, fix.tokens.admin);
    assert.equal(confirm.status, 409, `expected 409, got ${confirm.status} ${JSON.stringify(confirm.data)}`);
    assert.match(confirm.data.error || '', /INSUFFICIENT|backflush/i);
    // Verify rollback
    const row = fix.db.prepare("SELECT id, business_status, backflush_material_value_cents, total_cost_cents FROM outsourcing_receipts WHERE id=?").get(r.data.id);
    if (!row) {
      // check if there's an unrelated receipt - probably the issue
      const allReceipts = fix.db.prepare("SELECT id, business_status, backflush_material_value_cents, total_cost_cents FROM outsourcing_receipts").all();
      throw new Error(`receipt id=${r.data.id} not found. all receipts: ${JSON.stringify(allReceipts)}`);
    }
    assert.equal(row.business_status, 'CONFIRMED', `status must NOT be EFFECTED after rollback (got ${row.business_status}, id=${row.id}, total=${row.total_cost_cents})`);
    // backflush_material_value_cents and total_cost_cents should be at their initial (0).
    assert.equal(row.backflush_material_value_cents, 0, `backflush_material_value_cents must be 0 after rollback (got ${row.backflush_material_value_cents})`);
    const mat = fix.db.prepare("SELECT backflushed_quantity FROM outsourcing_material_list WHERE id=?").get(matId);
    assert.equal(Number(mat.backflushed_quantity), 0, 'no partial backflush on rollback');
    const invAfter = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    assert.equal(invAfter, invBefore, 'no finished inventory increase on rollback');
  });

  test('OUT-22 Finished Return: source confirmed receipt + inventory reversal + qty cap', async () => {
    await qualifyOutsourceSupplier(fix);
    const order = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: '2026-10-08',
    });
    assert.equal(order.status, 201);
    const orderId = order.data.id;
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'RELEASED' });
    await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fix.tokens.admin, {
      items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
    });
    const matId = fix.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    const issueRes = await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fix.tokens.admin, {
      materialListId: matId, quantity: 10, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: '2026-10-08',
    });
    assert.equal(issueRes.status, 201, `issue failed: ${JSON.stringify(issueRes.data)}`);
    const mat = fix.db.prepare("SELECT issued_quantity, supplemented_quantity, returned_quantity, backflushed_quantity FROM outsourcing_material_list WHERE id=?").get(matId);
    assert.equal(Number(mat.issued_quantity), 10, `issue must set issued=10 (got ${mat.issued_quantity})`);
    const r = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
      orderId, quantity: 20, receivedDate: '2026-10-09', processingFeeCents: 20000,
    });
    assert.equal(r.status, 201, r.data.error);
    const conf = await fix.request('POST', `/api/procurement/outsourcing/receipts/${r.data.id}/confirm`, fix.tokens.admin);
    assert.equal(conf.status, 200, `confirm failed: ${JSON.stringify(conf.data)}`);
    const status = fix.db.prepare("SELECT business_status FROM outsourcing_receipts WHERE id=?").get(r.data.id).business_status;
    assert.equal(status, 'EFFECTED', `receipt must be EFFECTED after confirm (got ${status})`);
    const invBefore = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    const ret = await fix.request('POST', '/api/procurement/outsourcing/finished-returns', fix.tokens.admin, {
      outsourcingReceiptId: r.data.id, quantity: 5, returnDate: '2026-10-09',
    });
    assert.equal(ret.status, 201, ret.data.error);
    const invAfter = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    assert.equal(invBefore - invAfter, 5, 'finished inventory reversal must equal return qty');
    // Over-return blocked
    const over = await fix.request('POST', '/api/procurement/outsourcing/finished-returns', fix.tokens.admin, {
      outsourcingReceiptId: r.data.id, quantity: 9999, returnDate: '2026-10-09',
    });
    assert.equal(over.status, 409);
  });
});
