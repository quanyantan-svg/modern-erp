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
import {
  outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom,
} from './test-support/procurement-http-fixture.js';

async function makeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'prc-exec-suite-'));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: join(tempDir, 'dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function request(method, path, token, body, extraHeaders = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
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
    outsourcing: await login('outsourcing', 'outsourcing123'),
    outsourcingReceiving: await login('outsourcingreceiving', 'outsourcingreceiving123'),
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
    qualificationValidFrom: '2026-01-01', qualificationValidTo: '2027-12-31', supplierWipWarehouseId: 'warehouse-002',
  });
  assert.equal(r.status, 200);
  // M1C-WP-3：委外材料经 canonical 估值写入，权威估值余额是前置事实。
  const now = new Date().toISOString();
  fix.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents,updated_at=excluded.updated_at`)
    .run(`NONE:warehouse-001:product-001`, 'product-001', now);
  fix.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-002', NULL, NULL, 1000, 1000000, ?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents,updated_at=excluded.updated_at`)
    .run(`NONE:warehouse-002:product-001`, 'product-001', now);
  // 委外发料必须真实消耗企业仓库存，演示种子数量不足以覆盖本套件的用量。
  fix.db.prepare("UPDATE inventory SET quantity=1000 WHERE warehouse_id='warehouse-001' AND product_id='product-001'").run();
}

/** M1C-WP-3：委外订单 + 已批准 OUTSOURCE BOM + 用料快照 + 发料。 */
async function createOutsourcingOrderWithMaterial(fix, { orderQuantity, perUnitQuantity, issueQuantity, key }) {
  const bomId = seedApprovedOutsourceBom(fix, 'product-001', [{ productId: 'product-001', requiredQuantity: perUnitQuantity }], key, '2026-10-01');
  const order = await fix.request('POST', '/api/procurement/outsourcing/orders', fix.tokens.admin, {
    supplierId: 'supplier-001', productId: 'product-001', orderQuantity, businessDate: '2026-10-08', bomId,
  });
  assert.equal(order.status, 201);
  const orderId = order.data.id;
  const snapshot = await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fix.tokens.admin, {
    items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
  });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.data));
  await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'CONFIRM_PLAN' });
  await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fix.tokens.admin, { action: 'RELEASE' });
  const matId = fix.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
  const issued = await fix.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fix.tokens.outsourcing, {
    materialListId: matId, quantity: issueQuantity, issuedDate: '2026-10-08', idempotencyKey: `issue-${key}`,
  });
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  return { orderId, matId };
}

/** M1C-WP-2：委外收货必须绑定 CONFIRMED 完工通知、APPROVED 加工费 PO 与明细行。 */
async function createConfirmedReceipt(fix, orderId, quantity, processingFeeCents, key) {
  const source = await prepareOutsourcingReceiptSource(fix, orderId, quantity, key);
  const receipt = await fix.request('POST', '/api/procurement/outsourcing/receipts', fix.tokens.admin, {
    orderId, ...outsourcingReceiptBody(source, quantity, processingFeeCents), receivedDate: '2026-10-09',
  }, { 'idempotency-key': `receipt-${key}` });
  assert.equal(receipt.status, 201, receipt.data.error);
  const itemId = fix.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id).id;
  return { receiptId: receipt.data.id, itemId };
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
    const apRows = fix.db.prepare("SELECT item_kind,conversion_state FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").all(create.data.id);
    assert.equal(apRows.filter((row) => row.item_kind === 'FINAL').length, 0, 'SEPARATE unbilled confirm must NOT create final AP');
    assert.equal(apRows.length, 1, 'SEPARATE unbilled confirm creates one explicit provisional AP');
    assert.equal(apRows[0].item_kind, 'PROVISIONAL');
    assert.equal(apRows[0].conversion_state, 'OPEN');
    // Inventory increased
    const inv = fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
    assert.ok(Number(inv.quantity) >= 10, 'inventory must reflect receipt');
  });

  test('Processing Fee Supplier Bill: 100 qty / 30+20+50 cumulative / 4th > remaining → 409', async () => {
    await qualifyOutsourceSupplier(fix);
    // Create outsourcing order + released + material + issue
    const { orderId } = await createOutsourcingOrderWithMaterial(fix, {
      orderQuantity: 100, perUnitQuantity: 0.05, issueQuantity: 100, key: 'suite-1',
    });
    // Receipt 100 qty — M1C-WP-2：表头 + 明细原子创建并绑定 CONFIRMED 完工通知与 APPROVED 加工费 PO。
    const receipt = await createConfirmedReceipt(fix, orderId, 100, 10000, 'suite-1');
    const r = { data: { id: receipt.receiptId } };
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${receipt.receiptId}/confirm`, fix.tokens.admin, {}, { 'idempotency-key': 'effect-suite-1' });
    const oriSuite1 = receipt.itemId;
    // Bill A: 30
    const billA = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-A', billDate: '2026-10-09', idempotencyKey: 'k-A',
      lines: [{ outsourcingReceiptItemId: oriSuite1, quantity: 30, unitPriceCents: 100 }],
    });
    assert.equal(billA.status, 201, billA.data.error);
    // Bill B: 20
    const billB = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-B', billDate: '2026-10-09', idempotencyKey: 'k-B',
      lines: [{ outsourcingReceiptItemId: oriSuite1, quantity: 20, unitPriceCents: 100 }],
    });
    assert.equal(billB.status, 201, billB.data.error);
    // Bill C: 50 (total 100)
    const billC = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-C', billDate: '2026-10-09', idempotencyKey: 'k-C',
      lines: [{ outsourcingReceiptItemId: oriSuite1, quantity: 50, unitPriceCents: 100 }],
    });
    assert.equal(billC.status, 201, billC.data.error);
    // Bill D: 30 → remaining is 0 → 409
    const billD = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-D', billDate: '2026-10-09', idempotencyKey: 'k-D',
      lines: [{ outsourcingReceiptItemId: oriSuite1, quantity: 30, unitPriceCents: 100 }],
    });
    assert.equal(billD.status, 409, JSON.stringify(billD.data));
    assert.match(billD.data.error || '', /可计费|超出|exceeded|Billable/i);
    // Post Bill A → 委外来源账单的正式过账被来源级业务策略拒绝（MC-REQ-15），且零 AP
    const post = await fix.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billA.data.id}/post`, fix.tokens.admin);
    assert.equal(post.status, 409);
    assert.equal(post.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    const ap = fix.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billA.data.id);
    assert.equal(ap.n, 0, '委外加工费过账不得产生 AP open item');
    assert.equal(fix.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billA.data.id).status, 'DRAFT');
  });

  test('One bill → multiple Outsourcing Receipts (multi-receipt): commercial_source_type per item', async () => {
    await qualifyOutsourceSupplier(fix);
    // Two orders, two receipts (40 + 60)
    const order1 = await createOutsourcingOrderWithMaterial(fix, {
      orderQuantity: 40, perUnitQuantity: 0.025, issueQuantity: 40, key: 'multi-1',
    });
    const order2 = await createOutsourcingOrderWithMaterial(fix, {
      orderQuantity: 60, perUnitQuantity: 1 / 60, issueQuantity: 40, key: 'multi-2',
    });
    const r1 = await createConfirmedReceipt(fix, order1.orderId, 40, 4000, 'multi-1');
    const r2 = await createConfirmedReceipt(fix, order2.orderId, 60, 6000, 'multi-2');
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${r1.receiptId}/confirm`, fix.tokens.admin, {}, { 'idempotency-key': 'effect-multi-1' });
    await fix.request('POST', `/api/procurement/outsourcing/receipts/${r2.receiptId}/confirm`, fix.tokens.admin, {}, { 'idempotency-key': 'effect-multi-2' });
    // ONE bill → TWO receipt items
    const bill = await fix.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fix.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-MULTI', billDate: '2026-10-09', idempotencyKey: 'k-multi',
      lines: [
        { outsourcingReceiptItemId: r1.itemId, quantity: 40, unitPriceCents: 100 },
        { outsourcingReceiptItemId: r2.itemId, quantity: 60, unitPriceCents: 100 },
      ],
    });
    assert.equal(bill.status, 201, bill.data.error);
    const items = fix.db.prepare(`SELECT commercial_source_type, commercial_source_id, commercial_source_item_id FROM supplier_bill_items WHERE bill_id=? ORDER BY line_no`).all(bill.data.id);
    assert.equal(items.length, 2, 'one bill with two receipt items');
    assert.equal(items[0].commercial_source_type, 'OUTSOURCING_RECEIPT_ITEM');
    assert.equal(items[0].commercial_source_id, r1.receiptId, 'first item → first receipt');
    assert.equal(items[0].commercial_source_item_id, r1.itemId);
    assert.equal(items[1].commercial_source_id, r2.receiptId, 'second item → second receipt');
    assert.equal(items[1].commercial_source_item_id, r2.itemId);
    // Header must NOT collapse to one receipt
    assert.notEqual(items[0].commercial_source_id, items[1].commercial_source_id, 'header must not collapse to one receipt source');
  });

  test('Wave H atomicity: failed confirm rolls back (no finished inventory, no cost evidence)', async () => {
    await qualifyOutsourceSupplier(fix);
    const { orderId, matId } = await createOutsourcingOrderWithMaterial(fix, {
      orderQuantity: 100, perUnitQuantity: 0.05, issueQuantity: 2, key: 'wave-h',
    });
    const invBefore = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    const receipt = await createConfirmedReceipt(fix, orderId, 30, 30000, 'wave-h');
    // backflush target for material-1 = 0.05 × 30 = 1.5; netSupplied=2 → 1.5 <= 2 would pass.
    // Force the failure by zeroing the issued quantity: incremental=1.5 > netSupplied=0 → throw.
    fix.db.prepare("UPDATE outsourcing_material_list SET issued_quantity=0 WHERE id=?").run(matId);
    // Attempt confirm: incremental=1.5 > netSupplied=0 → throw
    const confirm = await fix.request('POST', `/api/procurement/outsourcing/receipts/${receipt.receiptId}/confirm`, fix.tokens.admin, {}, { 'idempotency-key': 'wave-h-effect' });
    assert.equal(confirm.status, 409, `expected 409, got ${confirm.status} ${JSON.stringify(confirm.data)}`);
    assert.match(confirm.data.error || '', /INSUFFICIENT|backflush|WIP/i);
    // Verify rollback
    const row = fix.db.prepare("SELECT id, business_status, backflush_material_value_cents, total_cost_cents FROM outsourcing_receipts WHERE id=?").get(receipt.receiptId);
    if (!row) {
      const allReceipts = fix.db.prepare("SELECT id, business_status, backflush_material_value_cents, total_cost_cents FROM outsourcing_receipts").all();
      throw new Error(`receipt id=${receipt.receiptId} not found. all receipts: ${JSON.stringify(allReceipts)}`);
    }
    assert.equal(row.business_status, 'PENDING_INSPECTION', `status must NOT be EFFECTED after rollback (got ${row.business_status}, id=${row.id}, total=${row.total_cost_cents})`);
    // backflush_material_value_cents and total_cost_cents should be at their initial (0).
    assert.equal(row.backflush_material_value_cents, 0, `backflush_material_value_cents must be 0 after rollback (got ${row.backflush_material_value_cents})`);
    const mat = fix.db.prepare("SELECT backflushed_quantity FROM outsourcing_material_list WHERE id=?").get(matId);
    assert.equal(Number(mat.backflushed_quantity), 0, 'no partial backflush on rollback');
    const invAfter = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    assert.equal(invAfter, invBefore, 'no finished inventory increase on rollback');
  });

  test('OUT-22 Finished Return: first phase rejects with zero business side effects and one audit', async () => {
    await qualifyOutsourceSupplier(fix);
    const { orderId } = await createOutsourcingOrderWithMaterial(fix, {
      orderQuantity: 100, perUnitQuantity: 0.05, issueQuantity: 10, key: 'out-22',
    });
    const receipt = await createConfirmedReceipt(fix, orderId, 20, 20000, 'out-22');
    const conf = await fix.request('POST', `/api/procurement/outsourcing/receipts/${receipt.receiptId}/confirm`,
      fix.tokens.admin, {}, { 'idempotency-key': 'effect-out-22' });
    assert.equal(conf.status, 200, `confirm failed: ${JSON.stringify(conf.data)}`);
    const status = fix.db.prepare("SELECT business_status FROM outsourcing_receipts WHERE id=?").get(receipt.receiptId).business_status;
    assert.equal(status, 'EFFECTED', `receipt must be EFFECTED after confirm (got ${status})`);

    const invBefore = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    const evidenceBefore = JSON.stringify(fix.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId));
    const apBefore = JSON.stringify(fix.db.prepare('SELECT * FROM account_payables ORDER BY id').all());
    const auditsBefore = fix.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=?").get(receipt.receiptId).n;
    const ret = await fix.request('POST', '/api/procurement/outsourcing/finished-returns', fix.tokens.admin, {
      outsourcingReceiptId: receipt.receiptId, quantity: 5, returnDate: '2026-10-09',
    });
    assert.equal(ret.status, 409, ret.data.error);
    assert.equal(ret.data.code, 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED');

    const invAfter = Number(fix.db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    assert.equal(invAfter, invBefore, '首期拒绝不得冲回成品库存');
    assert.equal(JSON.stringify(fix.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId)), evidenceBefore,
      '首期拒绝不得改写成本证据任何字段');
    assert.equal(JSON.stringify(fix.db.prepare('SELECT * FROM account_payables ORDER BY id').all()), apBefore,
      '首期拒绝不得改写 AP 任何字段');
    const auditsAfter = fix.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=?").get(receipt.receiptId).n;
    assert.equal(auditsAfter, auditsBefore + 1, '首期拒绝必须恰好新增一条拒绝审计');
    const audit = fix.db.prepare("SELECT detail FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=? ORDER BY created_at DESC LIMIT 1").get(receipt.receiptId);
    assert.match(audit.detail, /OUTSOURCING_FINISHED_RETURN_NOT_APPROVED/);
  });
});
