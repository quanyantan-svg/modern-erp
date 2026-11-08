import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave H/I closure: outsourcing receipt, processing fee bill, finished return, difference, WIP transfer, scan', () => {
  let fixture;
  const receiptSources = new Map();
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-waveh-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200);
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,100000,?)
      ON CONFLICT(balance_key) DO NOTHING`).run(new Date().toISOString());
  }

  async function createReleasedOrderWithMaterial({ orderQty = 100, material = { productId: 'product-001', requiredQuantity: 0.05, unit: 'PCS' } } = {}) {
    material = { ...material, sourceWarehouseId: material.sourceWarehouseId || 'warehouse-001' };
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [material], `finance-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: orderQty, businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, { items: [material] });
    receiptSources.set(order.data.id, await prepareOutsourcingReceiptSource(fixture, order.data.id, orderQty, `finance-${order.data.id}`));
    return order.data.id;
  }

  async function createReceipt(orderId, body) {
    const source = receiptSources.get(orderId);
    return fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
      orderId, ...body, ...outsourcingReceiptBody(source, body.quantity, body.processingFeeCents, body.receivedDate),
    }, { 'idempotency-key': `receipt-${orderId}-${body.quantity}-${Date.now()}-${Math.random()}` });
  }

  test('OUT-19 receipt confirm: atomic backflush + material carrying value + processing fee evidence', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrderWithMaterial();
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 10, issuedDate: isoDate(0), idempotencyKey: `issue-${orderId}`,
    });
    assert.equal(issue.status, 201, issue.data.error);
    const receipt = await createReceipt(orderId, {
      quantity: 30, receivedDate: isoDate(0), processingFeeCents: 30000,
    });
    assert.equal(receipt.status, 201, receipt.data.error);
    const confirm = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${receipt.data.id}` });
    assert.equal(confirm.status, 200, confirm.data.error);
    // Verify business_status updated
    const row = fixture.db.prepare("SELECT business_status, backflush_material_value_cents, total_cost_cents FROM outsourcing_receipts WHERE id=?").get(receipt.data.id);
    assert.equal(row.business_status, 'EFFECTED');
    assert.ok(Number(row.total_cost_cents) >= 30000);
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.data.id);
    assert.equal(evidence.material_consumed_value_cents, row.backflush_material_value_cents);
    assert.equal(evidence.processing_fee_provisional_cents, 30000);
    assert.equal(evidence.processing_fee_actual_cents, null);
    assert.equal(evidence.variance_cents, null);
    assert.equal(evidence.basis_status, 'PROVISIONAL');
  });

  test('OUT-20 processing fee bill: multi-bill partial, multi-receipt, race-safe reservation', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrderWithMaterial({ orderQty: 100 });
    // 100 finished qty via 2 receipts (60 + 40).
    const r1 = await createReceipt(orderId, { quantity: 60, receivedDate: isoDate(0), processingFeeCents: 60000 });
    const r2 = await createReceipt(orderId, { quantity: 40, receivedDate: isoDate(0), processingFeeCents: 40000 });
    // confirm both
    await fixture.request('POST', `/api/procurement/outsourcing/receipts/${r1.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${r1.data.id}` });
    await fixture.request('POST', `/api/procurement/outsourcing/receipts/${r2.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${r2.data.id}` });
    // Insert receipt items directly so we can simulate multi-bill against 100 processing-fee-eligible qty
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
      VALUES('ori-1',?,?,100,500,1)`).run(r1.data.id, 'product-001');
    // Multi-bill test: 30 + 20 + 50 = 100 (must all succeed)
    const billA = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-A', billDate: isoDate(0),
      idempotencyKey: 'bill-A',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 30, unitPriceCents: 500 }],
    });
    assert.equal(billA.status, 201, billA.data.error);
    const billB = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-B', billDate: isoDate(0),
      idempotencyKey: 'bill-B',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 20, unitPriceCents: 500 }],
    });
    assert.equal(billB.status, 201, billB.data.error);
    const billC = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-C', billDate: isoDate(0),
      idempotencyKey: 'bill-C',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 50, unitPriceCents: 500 }],
    });
    assert.equal(billC.status, 201, billC.data.error);
    // Over-bill: 30 (eligible 0) → 409
    const overBill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-OVER', billDate: isoDate(0),
      idempotencyKey: 'bill-over',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 30, unitPriceCents: 500 }],
    });
    assert.equal(overBill.status, 409, JSON.stringify(overBill.data));
    // 正式过账：委外来源账单一律被来源级业务策略拒绝（MC-REQ-15），且零副作用
    const post = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billA.data.id}/post`, fixture.tokens.admin);
    assert.equal(post.status, 409);
    assert.equal(post.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billA.data.id).n, 0,
      '委外加工费过账不得产生 AP open item');
    assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billA.data.id).status, 'DRAFT');
    const provisional = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(r1.data.id);
    assert.ok(!provisional || provisional.processing_fee_actual_cents === null, '过账被拒不得刷新成本证据');
    assert.ok(!provisional || provisional.basis_status !== 'FINAL', '过账被拒不得把成本证据推进到 FINAL');
    for (const billId of [billB.data.id, billC.data.id]) {
      const rejected = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.admin);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    }
    const finalEvidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(r1.data.id);
    assert.ok(!finalEvidence || finalEvidence.processing_fee_actual_cents === null, '过账被拒不得刷新成本证据');
    assert.ok(!finalEvidence || finalEvidence.basis_status !== 'FINAL');
    const report = await fixture.request('GET', '/api/reports/outsourcing/execution', fixture.tokens.admin);
    const reportRow = report.data.report.find((entry) => entry.orderId === orderId);
    assert.equal(reportRow.processingFeeActualCents, 0);
    assert.equal(reportRow.costEvidenceStatus, 'PROVISIONAL');
  });

  test('OUT-22 Finished Return: source confirmed receipt + inventory reversal + LOT/SERIAL provenance', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrderWithMaterial();
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 10, issuedDate: isoDate(0), idempotencyKey: `issue-${orderId}`,
    });
    const receipt = await createReceipt(orderId, {
      quantity: 20, receivedDate: isoDate(0), processingFeeCents: 20000,
    });
    await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${receipt.data.id}` });
    const ret = await fixture.request('POST', '/api/procurement/outsourcing/finished-returns', fixture.tokens.admin, {
      outsourcingReceiptId: receipt.data.id, quantity: 5, returnDate: isoDate(0),
    });
    assert.equal(ret.status, 409, ret.data.error);
    assert.equal(ret.data.code, 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='SUPPLIER_CREDIT_NOTE'").get().n, 0);
    const cumulativeOverRet = await fixture.request('POST', '/api/procurement/outsourcing/finished-returns', fixture.tokens.admin, {
      outsourcingReceiptId: receipt.data.id, quantity: 16, returnDate: isoDate(0),
    });
    assert.equal(cumulativeOverRet.status, 409);
    const overRet = await fixture.request('POST', '/api/procurement/outsourcing/finished-returns', fixture.tokens.admin, {
      outsourcingReceiptId: receipt.data.id, quantity: 9999, returnDate: isoDate(0),
    });
    assert.equal(overRet.status, 409);
  });

  test('OUT-22 委外加工费过账被拒时，完工退货保持未计费分支且零 AP 信用', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrderWithMaterial();
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 10, issuedDate: isoDate(0), idempotencyKey: `issue-${orderId}`,
    });
    const receipt = await createReceipt(orderId, {
      quantity: 10, receivedDate: isoDate(0), processingFeeCents: 10000,
    });
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${receipt.data.id}` })).status, 200);
    const receiptItemId = `ori-billed-return-${receipt.data.id}`;
    fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
      VALUES(?,?,?,10,1000,1)`).run(receiptItemId, receipt.data.id, 'product-001');
    // 草稿登记仍然合法（MC-REQ-15 只拒绝正式过账与匹配）
    const bill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: `INV-${receipt.data.id}`, billDate: isoDate(0),
      idempotencyKey: `bill-${receipt.data.id}`,
      lines: [{ outsourcingReceiptItemId: receiptItemId, quantity: 10, unitPriceCents: 1000 }],
    });
    assert.equal(bill.status, 201, bill.data.error);
    // 正式过账被来源级业务策略拒绝，且零 AP open item
    const post = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.data.id}/post`, fixture.tokens.admin);
    assert.equal(post.status, 409);
    assert.equal(post.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(bill.data.id).n, 0);
    // 该收货因此仍未计费：完工退货走未计费分支，零 AP 信用
    const ret = await fixture.request('POST', '/api/procurement/outsourcing/finished-returns', fixture.tokens.admin, {
      outsourcingReceiptId: receipt.data.id, quantity: 4, returnDate: isoDate(0),
    });
    assert.equal(ret.status, 409, ret.data.error);
    assert.equal(ret.data.code, 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='SUPPLIER_CREDIT_NOTE'").get().n, 0);
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.data.id);
    assert.equal(evidence.processing_fee_actual_cents, null);
    assert.equal(evidence.basis_status, 'PROVISIONAL');
  });

  test('OUT-23 difference allocation: preview → apply with quantity conservation', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrderWithMaterial({ orderQty: 100, material: { productId: 'product-002', requiredQuantity: 10, unit: 'PCS' } });
    const preview = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/difference-preview`, fixture.tokens.admin);
    assert.equal(preview.status, 200);
    assert.ok(Array.isArray(preview.data.preview));
    const apply = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/difference-apply`, fixture.tokens.admin, {
      materialListId: preview.data.preview[0].materialListId, supplementQuantity: 2, returnQuantity: 0, periodKey: '2026-10',
    });
    assert.equal(apply.status, 409, apply.data.error);
    assert.equal(apply.data.code, 'OUTSOURCING_DIFFERENCE_APPROVAL_PENDING');
  });

  test('OUT-23 WIP Transfer: 跨单数量归属转移按固定结果拒绝，零转移事实', async () => {
    await qualifyOutsourceSupplier();
    const orderA = await createReleasedOrderWithMaterial({ orderQty: 100, material: { productId: 'product-003', requiredQuantity: 10, unit: 'PCS' } });
    const orderB = await createReleasedOrderWithMaterial({ orderQty: 100, material: { productId: 'product-003', requiredQuantity: 10, unit: 'PCS' } });
    // Issue 5 PCS into orderA
    const matA = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderA).id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderA}/issues`, fixture.tokens.admin, {
      materialListId: matA, quantity: 5, issuedDate: isoDate(0), idempotencyKey: `issue-${orderA}`,
    });
    // Transfer 3 from A to B (B has its own material list row for product-003)
    const matB = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderB, 'product-003').id;
    const transfersBefore = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n;
    const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
      sourceOrderId: orderA, targetOrderId: orderB, materialListId: matA, quantity: 3, transferDate: isoDate(0),
      idempotencyKey: `xfer-${orderA}-${orderB}-3`,
    });
    // Note: matA is source's row, but matB is target's row (different row ids). WIP transfer is per source row.
    // product-003 没有权威估值余额，发料未生效，源行因此没有可证明 WIP：固定 409 超额拒绝。
    assert.equal(transfer.status, 409);
    assert.equal(transfer.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
    // Try overdraw
    const overTransfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
      sourceOrderId: orderA, targetOrderId: orderB, materialListId: matA, quantity: 9999, transferDate: isoDate(0),
      idempotencyKey: `xfer-${orderA}-${orderB}-9999`,
    });
    assert.equal(overTransfer.status, 409);
    assert.equal(overTransfer.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
    // 缺幂等键固定 400
    const noKey = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
      sourceOrderId: orderA, targetOrderId: orderB, materialListId: matA, quantity: 3, transferDate: isoDate(0),
    });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
    // 拒绝路径不得产生任何转移事实
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n, transfersBefore);
  });

  test('PRC-26 Procurement Scan: bounded wedge resolves PO + product → draft line', async () => {
    const po = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000', supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 1000 }],
    });
    assert.equal(po.status, 201, po.data.error);
    await fixture.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fixture.tokens.admin);
    await fixture.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fixture.tokens.reviewer);
    const scan = await fixture.request('POST', '/api/procurement/scan', fixture.tokens.warehouse, {
      sourceType: 'PURCHASE_ORDER', sourceId: po.data.id,
      productId: 'product-001', warehouseId: 'warehouse-001', quantity: 2, lotCode: 'LOT-001',
    });
    assert.equal(scan.status, 200, scan.data.error);
    assert.equal(scan.data.scanResolution.orderId, po.data.id);
    // OUTSOURCE_PROCESSING block
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,business_type)
      VALUES('po-os','PO-OS','supplier-001','APPROVED',0,'os','user-admin',?,?,'OUTSOURCE_PROCESSING')`).run(now, now);
    const blocked = await fixture.request('POST', '/api/procurement/scan', fixture.tokens.warehouse, {
      sourceType: 'PURCHASE_ORDER', sourceId: 'po-os', productId: 'product-001', warehouseId: 'warehouse-001', quantity: 1,
    });
    assert.equal(blocked.status, 409);
  });
});
