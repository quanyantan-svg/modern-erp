import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom, seedPurchasePrice, seedOutsourceSource } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave H/I closure: outsourcing receipt, processing fee bill, finished return, difference, WIP transfer, scan', () => {
  let fixture;
  const receiptSources = new Map();
  before(async () => {
    fixture = await createProcurementFixture('modern-erp-prc-waveh-');
    await seedPurchasePrice(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', unitPriceCents: 1000 }]);
  });
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
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) }]);
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
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, { items: [material] });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
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
    // 收货生效需要可证明的用料供给（背冲容量），因此先发料。
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 10, issuedDate: isoDate(0), idempotencyKey: `issue-out20-${orderId}`,
    });
    assert.equal(issue.status, 201, issue.data.error);
    // 100 finished qty via 2 receipts (60 + 40).
    const r1 = await createReceipt(orderId, { quantity: 60, receivedDate: isoDate(0), processingFeeCents: 60000 });
    const r2 = await createReceipt(orderId, { quantity: 40, receivedDate: isoDate(0), processingFeeCents: 40000 });
    assert.equal(r1.status, 201, r1.data.error);
    assert.equal(r2.status, 201, r2.data.error);
    // confirm both
    const c1 = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${r1.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${r1.data.id}` });
    assert.equal(c1.status, 200, c1.data.error);
    const c2 = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${r2.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': `confirm-${r2.data.id}` });
    assert.equal(c2.status, 200, c2.data.error);
    // Insert receipt items directly so we can simulate multi-bill against the
    // 60-unit processing-fee-eligible quantity of the first receipt.
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
      VALUES('ori-1',?,?,60,500,1)`).run(r1.data.id, 'product-001');
    // Multi-bill test: 20 + 20 + 20 = 60 (must all succeed)
    const billA = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-A', billDate: isoDate(0),
      idempotencyKey: 'bill-A',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 20, unitPriceCents: 500 }],
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
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 20, unitPriceCents: 500 }],
    });
    assert.equal(billC.status, 201, billC.data.error);
    // Over-bill: 20 (eligible 0) → 409
    const overBill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.admin, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'INV-PROC-OVER', billDate: isoDate(0),
      idempotencyKey: 'bill-over',
      lines: [{ outsourcingReceiptItemId: 'ori-1', quantity: 20, unitPriceCents: 500 }],
    });
    assert.equal(overBill.status, 409, JSON.stringify(overBill.data));
    // 正式过账：C-P01..C-P04 已由业务所有者裁定实现，委外加工费走**同一套**
    // canonical 财务原语（应付 + 凭证），来源级 Guard 仍然按行级来源判定。
    const post = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billA.data.id}/post`, fixture.tokens.admin);
    assert.equal(post.status, 200, JSON.stringify(post.data));
    const payable = fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billA.data.id);
    assert.equal(payable.n, 1, '委外加工费过账产生 canonical AP open item');
    assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billA.data.id).status, 'POSTED');
    // 过账后成本证据按 OUT-21 口径刷新：actual 取 canonical 账单实际金额。
    const posted = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(r1.data.id);
    assert.equal(Number(posted.processing_fee_actual_cents), 10000, 'actual 取 canonical 账单实际金额');
    assert.equal(Number(posted.variance_cents), 10000 - Number(posted.processing_fee_provisional_cents));
    // 剩余两张草稿账单仍可正常过账（部分开票是合法的）。
    for (const billId of [billB.data.id, billC.data.id]) {
      const posted2 = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.admin);
      assert.equal(posted2.status, 200, JSON.stringify(posted2.data));
    }
    // 三张账单全部过账后，累计开票数量 60 == 保留加工数量 ⇒ 成本证据 FINAL。
    const finalEvidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(r1.data.id);
    assert.equal(finalEvidence.basis_status, 'FINAL');
    assert.equal(Number(finalEvidence.processing_fee_actual_cents), 30000, 'actual = 20*500 * 3');
    const report = await fixture.request('GET', '/api/reports/outsourcing/execution', fixture.tokens.admin);
    const reportRow = report.data.report.find((entry) => entry.orderId === orderId);
    assert.equal(reportRow.processingFeeActualCents, 30000, '订单级 actual 是各收货 actual 之和');
    // 订单级 FINAL 要求**全部**已生效收货的成本证据都是 FINAL。
    // 第二张收货（40）尚未开票，因此订单级仍是 PROVISIONAL —— 这是 OUT-21 的正确口径。
    assert.equal(reportRow.costEvidenceStatus, 'PROVISIONAL');
    const secondEvidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(r2.data.id);
    assert.equal(secondEvidence.basis_status, 'PROVISIONAL');
    assert.equal(secondEvidence.processing_fee_actual_cents, null);
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

  test('OUT-22 委外加工费已过账时，完工退货仍被未批准能力拒绝且零 AP 信用', async () => {
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
    // C-P01..C-P04 已裁定实现：正式过账产生 canonical AP open item。
    const post = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.data.id}/post`, fixture.tokens.admin);
    assert.equal(post.status, 200, JSON.stringify(post.data));
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(bill.data.id).n, 1);
    // 完工退货本身仍是未批准的独立能力（OUT-22 / C-P03 未裁定）：一律拒绝，
    // 且**零** AP 信用 —— 即使该收货已经开票并过账。
    const ret = await fixture.request('POST', '/api/procurement/outsourcing/finished-returns', fixture.tokens.admin, {
      outsourcingReceiptId: receipt.data.id, quantity: 4, returnDate: isoDate(0),
    });
    assert.equal(ret.status, 409, ret.data.error);
    assert.equal(ret.data.code, 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='SUPPLIER_CREDIT_NOTE'").get().n, 0);
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.data.id);
    assert.equal(Number(evidence.processing_fee_actual_cents), 10000, '过账后 actual 取 canonical 账单实际金额');
    assert.equal(evidence.basis_status, 'FINAL');
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
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(7),
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

/**
 * OUT-20 / OUT-21 —— 委外加工费正式过账与 FINAL 成本证据。
 *
 * 合同来源：MC-REQ-15（`C-P01..C-P04` 已由业务所有者裁定「真正实现」）+
 * Design §26.20 Processing Fee Partial Billing / Cost Evidence (OUT-21)。
 *
 * 断言口径：
 *   - 过账产生 canonical AP open item 与 canonical 系统凭证；
 *   - 成本证据由 PROVISIONAL 转 FINAL，actual 取 canonical 账单实际金额；
 *   - 红冲金额反向、数量守恒；
 *   - 期间未开 / 重复过账 / 来源未生效 一律 409 + 零业务副作用 + 拒绝审计；
 *   - 普通采购账单的共享过账链路**完全不受影响**。
 */
describe('OUT-20 / OUT-21: 委外加工费正式过账与 FINAL 成本证据', () => {
  let fixture;
  const receiptSources = new Map();

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-out20-');
    await seedPurchasePrice(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', unitPriceCents: 1000 }]);
    await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDateOf(-30), qualificationValidTo: isoDateOf(180), supplierWipWarehouseId: 'warehouse-002',
    });
    // OUT-02：委外订单必须消费有效 OUTSOURCE 货源。
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDateOf(-30) }]);
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,100000,?)
      ON CONFLICT(balance_key) DO NOTHING`).run(new Date().toISOString());
  });
  after(async () => fixture.close());

  function isoDateOf(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function buildEffectedReceipt({ quantity = 20, processingFeeCents = 20000, unitPriceCents = 1000 } = {}) {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [
      { productId: 'product-001', requiredQuantity: 0.05 },
    ], `out20-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDateOf(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const orderId = order.data.id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    const matId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: matId, quantity: 10, issuedDate: isoDateOf(0), idempotencyKey: `out20-issue-${orderId}`,
    });
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, quantity, `out20-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
      orderId, ...outsourcingReceiptBody(source, quantity, processingFeeCents, isoDateOf(0)),
    }, { 'idempotency-key': `out20-receipt-${orderId}` });
    assert.equal(receipt.status, 201, receipt.data.error);
    const confirmed = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
      fixture.tokens.admin, {}, { 'idempotency-key': `out20-confirm-${receipt.data.id}` });
    assert.equal(confirmed.status, 200, confirmed.data.error);
    const itemId = fixture.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id).id;
    return { orderId, receiptId: receipt.data.id, itemId, processingFeeCents, unitPriceCents, quantity };
  }

  async function createBill(receipt, { quantity, unitPriceCents, key, supplierInvoiceNo }) {
    return fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.accounting, {
      supplierId: 'supplier-001', supplierInvoiceNo, billDate: isoDateOf(0), idempotencyKey: key,
      lines: [{ outsourcingReceiptItemId: receipt.itemId, quantity, unitPriceCents }],
    });
  }

  function snapshotBusinessFacts(db, billId) {
    return JSON.stringify({
      bill: db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId),
      payables: db.prepare("SELECT * FROM account_payables WHERE source_id=? ORDER BY id").all(billId),
      vouchers: db.prepare("SELECT * FROM accounting_vouchers WHERE source_id=? ORDER BY id").all(billId),
      entries: db.prepare(`SELECT e.* FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
        WHERE v.source_id=? ORDER BY e.id`).all(billId),
      credits: db.prepare("SELECT * FROM financial_credit_adjustments WHERE source_id=? ORDER BY id").all(billId),
      evidence: db.prepare(`SELECT * FROM outsourcing_cost_evidences WHERE finalized_bill_id=? ORDER BY outsourcing_receipt_id`).all(billId),
    });
  }

  test('OUT-20 过账成功：产生 canonical 应付与凭证，且借方走加工费科目（非 GRNI）', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-post-ok', supplierInvoiceNo: 'INV-OUT20-POST-OK' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    assert.equal(fixture.db.prepare('SELECT net_cents FROM supplier_bills WHERE id=?').get(billId).net_cents, 20000);

    const posted = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));

    // 应付：canonical account_payables，来源类型与普通供应商账单一致。
    const payable = fixture.db.prepare("SELECT * FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
    assert.ok(payable, '过账必须产生 canonical AP open item');
    assert.equal(Number(payable.amount_cents), 20000);
    assert.equal(payable.supplier_id, 'supplier-001');
    assert.equal(payable.item_kind, 'FINAL');

    // 凭证：canonical 系统凭证，借贷平衡。
    const voucher = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
    assert.ok(voucher, '过账必须产生 canonical 系统凭证');
    const entries = fixture.db.prepare('SELECT e.*, s.code subject_code FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.id=? ORDER BY e.line_no').all(voucher.id);
    const debit = entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    const credit = entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    assert.equal(debit, 20000);
    assert.equal(credit, 20000);
    const debitCodes = entries.filter((e) => e.direction === 'DEBIT').map((e) => e.subject_code);
    const creditCodes = entries.filter((e) => e.direction === 'CREDIT').map((e) => e.subject_code);
    assert.deepEqual(debitCodes, ['6408'], '借方必须是委外加工费科目，不得照搬普通采购的 GRNI');
    assert.deepEqual(creditCodes, ['2202'], '贷方必须是 canonical 应付账款');

    const billRow = fixture.db.prepare('SELECT status, processing_fee_posting_state FROM supplier_bills WHERE id=?').get(billId);
    assert.equal(billRow.status, 'POSTED');
    assert.equal(billRow.processing_fee_posting_state, 'POSTED');
  });

  test('OUT-21 过账后成本证据转 FINAL，actual 取 canonical 账单实际金额', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-final', supplierInvoiceNo: 'INV-OUT20-FINAL' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;

    const before = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId);
    assert.equal(before.basis_status, 'PROVISIONAL');
    assert.equal(before.processing_fee_actual_cents, null);
    assert.equal(before.variance_cents, null);
    assert.equal(Number(before.processing_fee_basis_cents), 20000, 'C-P01：收货生效时确认的加工费基准金额');

    const posted = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));

    const after = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId);
    assert.equal(after.basis_status, 'FINAL');
    assert.equal(Number(after.processing_fee_actual_cents), 20000, 'actual 必须是 canonical 账单实际金额');
    assert.equal(Number(after.variance_cents), 0, 'variance = actual - 收货生效确认的基准金额');
    assert.equal(after.finalized_bill_id, billId);
    assert.ok(after.finalized_at);
  });

  test('C-P01 草稿只是登记；超开票在过账时被拒（金额上界 = 收货生效确认金额）', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    // 草稿阶段不冻结金额：声称金额高于收货生效确认金额的草稿**可以**登记
    // （草稿只是待结算事实，零 AP / 零凭证 / 零成本证据刷新）。
    const draft = await createBill(receipt, { quantity: 20, unitPriceCents: 1500, key: 'out20-reprice', supplierInvoiceNo: 'INV-OUT20-REPRICE' });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    const draftId = draft.data.id;
    assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(draftId).status, 'DRAFT');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(draftId).n, 0,
      '草稿不得产生 AP open item');
    const draftEvidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId);
    assert.equal(draftEvidence.processing_fee_actual_cents, null, '草稿不得刷新成本证据');
    assert.equal(draftEvidence.basis_status, 'PROVISIONAL');

    // 过账时执行权威上界：20 * 1500 = 30000 > 确认金额 20000 ⇒ 拒绝。
    const before = snapshotBusinessFacts(fixture.db, draftId);
    const rejected = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${draftId}/post`, fixture.tokens.accounting);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'OUTSOURCING_PROCESSING_FEE_PRICE_MISMATCH');
    assert.equal(snapshotBusinessFacts(fixture.db, draftId), before, '被拒过账后业务事实必须逐字段一致');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(draftId).n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(draftId).n, 0);
  });

  test('C-P01 少开票（部分开票）合法：差额进入 OUT-21 的 variance', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    // 声称 500 分/单位 < 确认的 1000 分/单位 ⇒ 少开票，合法。
    const bill = await createBill(receipt, { quantity: 10, unitPriceCents: 500, key: 'out20-under', supplierInvoiceNo: 'INV-OUT20-UNDER' });
    assert.equal(bill.status, 201, JSON.stringify(bill.data));
    const billId = bill.data.id;
    const posted = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId);
    assert.equal(Number(evidence.processing_fee_actual_cents), 5000, 'actual 取 canonical 账单实际金额');
    assert.equal(Number(evidence.variance_cents), 5000 - 20000, 'variance = actual - 收货生效确认金额');
    assert.equal(evidence.basis_status, 'PROVISIONAL', '数量未开满，仍是暂估口径');
  });

  test('C-P03 红冲成功：金额反向、数量守恒、成本证据回到实际口径', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-reverse', supplierInvoiceNo: 'INV-OUT20-REVERSE' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting)).status, 200);
    const billItemId = fixture.db.prepare('SELECT id FROM supplier_bill_items WHERE bill_id=?').get(billId).id;

    const reversal = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/reverse`, fixture.tokens.accounting, {
      items: [{ billItemId, quantity: 20 }], reason: '委外加工费红冲', businessDate: isoDateOf(0),
    }, { 'idempotency-key': 'out20-reverse-1' });
    assert.equal(reversal.status, 200, JSON.stringify(reversal.data));
    assert.equal(reversal.data.amountCents, 20000, '红冲金额必须与原金额等额反向');

    // 冲销凭证：方向与原凭证相反，等额。
    const original = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
    const reversalVoucher = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL_PROCESSING_FEE_REVERSAL' AND source_id=?").get(billId);
    assert.ok(reversalVoucher, '红冲必须产生冲销凭证');
    assert.equal(reversalVoucher.reversal_of_id, original.id);
    const originalEntries = fixture.db.prepare('SELECT subject_id, direction, amount_cents FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(original.id);
    const reversalEntries = fixture.db.prepare('SELECT subject_id, direction, amount_cents FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(reversalVoucher.id);
    assert.equal(reversalEntries.length, originalEntries.length);
    originalEntries.forEach((entry, index) => {
      assert.equal(reversalEntries[index].subject_id, entry.subject_id);
      assert.equal(reversalEntries[index].direction, entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT');
      assert.equal(Number(reversalEntries[index].amount_cents), Number(entry.amount_cents));
    });

    // AP 侧：贷项调整产生，应付 open item 余额归零。
    const credit = fixture.db.prepare("SELECT * FROM financial_credit_adjustments WHERE source_type='SUPPLIER_BILL_PROCESSING_FEE_REVERSAL'").get();
    assert.ok(credit, '红冲必须产生 canonical AP 贷项调整');
    assert.equal(Number(credit.amount_cents), 20000);
    const payable = fixture.db.prepare("SELECT * FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
    assert.equal(Number(payable.open_amount_cents), 0, '红冲后应付 open item 必须归零');

    // 成本证据：实际金额与红冲金额相抵。
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.receiptId);
    assert.equal(Number(evidence.processing_fee_actual_cents), 0);
    assert.equal(Number(evidence.variance_cents), -20000);
    const reversalRow = fixture.db.prepare('SELECT * FROM outsourcing_processing_fee_reversals WHERE supplier_bill_id=?').get(billId);
    assert.equal(Number(reversalRow.reversal_amount_cents), 20000);
    assert.equal(Number(reversalRow.reversal_quantity), 20);

    // 幂等：同一 Idempotency-Key 的精确重放只返回已记录结果，不新增红冲事实。
    const reversalsBefore = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_processing_fee_reversals').get().n;
    const replay = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/reverse`, fixture.tokens.accounting, {
      items: [{ billItemId, quantity: 20 }], reason: '委外加工费红冲', businessDate: isoDateOf(0),
    }, { 'idempotency-key': 'out20-reverse-1' });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_processing_fee_reversals').get().n, reversalsBefore);
  });

  test('C-P03 红冲数量守恒：累计红冲不得超过该行已开票数量', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 10, unitPriceCents: 1000, key: 'out20-reverse-cap', supplierInvoiceNo: 'INV-OUT20-REVERSE-CAP' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting)).status, 200);
    const billItemId = fixture.db.prepare('SELECT id FROM supplier_bill_items WHERE bill_id=?').get(billId).id;

    const over = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/reverse`, fixture.tokens.accounting, {
      items: [{ billItemId, quantity: 11 }], reason: '超额红冲', businessDate: isoDateOf(0),
    }, { 'idempotency-key': 'out20-reverse-over' });
    assert.equal(over.status, 409, JSON.stringify(over.data));
    assert.equal(over.data.code, 'OUTSOURCING_PROCESSING_FEE_REVERSAL_EXCEEDS');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_processing_fee_reversals WHERE supplier_bill_id=?').get(billId).n, 0,
      '被拒红冲不得留下红冲事实');
  });

  test('重复过账被拒：409 + 零业务副作用 + 恰好一条拒绝审计', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-double', supplierInvoiceNo: 'INV-OUT20-DOUBLE' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting)).status, 200);

    const before = snapshotBusinessFacts(fixture.db, billId);
    const auditsBefore = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SUPPLIER_BILL' AND entity_id=? AND action='REJECT'").get(billId).n;
    const second = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(second.status, 409, JSON.stringify(second.data));
    assert.equal(second.data.code, 'OUTSOURCING_PROCESSING_FEE_ALREADY_POSTED');
    assert.equal(snapshotBusinessFacts(fixture.db, billId), before, '重复过账后业务事实必须逐字段一致');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SUPPLIER_BILL' AND entity_id=? AND action='REJECT'").get(billId).n, auditsBefore + 1,
      '每次 409 拒绝恰好新增 1 条拒绝审计');
  });

  test('期间未开被拒：409 + 零业务副作用', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-closed', supplierInvoiceNo: 'INV-OUT20-CLOSED' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    // 关闭会计期间，使过账的会计期间门禁 fail closed。
    const closedPeriod = '2020-01';
    fixture.db.prepare(`INSERT OR IGNORE INTO period_closures(id,period,period_year,period_month,closure_type,status,closed_by,closed_at,created_at)
      VALUES(?,?,2020,1,'MONTH','CLOSED','user-admin',?,?)`)
      .run(`pc-out20-${closedPeriod}`, closedPeriod, new Date().toISOString(), new Date().toISOString());
    fixture.db.prepare('UPDATE supplier_bills SET bill_date=? WHERE id=?').run(`${closedPeriod}-15`, billId);

    const before = snapshotBusinessFacts(fixture.db, billId);
    const rejected = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(snapshotBusinessFacts(fixture.db, billId), before, '期间未开被拒后业务事实必须逐字段一致');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billId).n, 0, '不得产生 AP open item');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(billId).n, 0, '不得产生凭证');
  });

  test('来源收货未生效被拒：409 + 零业务副作用', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    // 造一张未生效的收货（直接回退状态），证明过账不得接受未生效来源。
    fixture.db.prepare("UPDATE outsourcing_receipts SET business_status='PENDING_INSPECTION' WHERE id=?").run(receipt.receiptId);
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-not-effected', supplierInvoiceNo: 'INV-OUT20-NOT-EFFECTED' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;

    const before = snapshotBusinessFacts(fixture.db, billId);
    const rejected = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    assert.equal(rejected.data.details.reason, 'SOURCE_RECEIPT_NOT_EFFECTED', '精确原因放在 details.reason 字段');
    assert.equal(snapshotBusinessFacts(fixture.db, billId), before, '来源未生效被拒后业务事实必须逐字段一致');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billId).n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(billId).n, 0);
    // 恢复生效状态，避免影响后续用例。
    fixture.db.prepare("UPDATE outsourcing_receipts SET business_status='EFFECTED' WHERE id=?").run(receipt.receiptId);
  });

  test('会计档案缺位时 fail closed：409 OUTSOURCING_GL_PROFILE_NOT_APPROVED 且零副作用', async () => {
    const receipt = await buildEffectedReceipt({ quantity: 20, processingFeeCents: 20000, unitPriceCents: 1000 });
    const bill = await createBill(receipt, { quantity: 20, unitPriceCents: 1000, key: 'out20-no-profile', supplierInvoiceNo: 'INV-OUT20-NO-PROFILE' });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    fixture.db.prepare("UPDATE outsourcing_processing_fee_accounting_profiles SET approval_state='SUSPENDED' WHERE scope='GLOBAL'").run();

    const before = snapshotBusinessFacts(fixture.db, billId);
    const rejected = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, fixture.tokens.accounting);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'OUTSOURCING_GL_PROFILE_NOT_APPROVED');
    assert.equal(snapshotBusinessFacts(fixture.db, billId), before, '档案缺位被拒后业务事实必须逐字段一致');
    fixture.db.prepare("UPDATE outsourcing_processing_fee_accounting_profiles SET approval_state='APPROVED' WHERE scope='GLOBAL'").run();
  });

  test('C-P04 普通采购账单共享过账链路完全不受委外来源影响', async () => {
    const supplierId = 'supplier-001';
    const stamp = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode)
      VALUES('out20-pr','PR-OUT20',?,'warehouse-001','user-admin','CONFIRMED',2000,?,'','user-admin',?,?,'SEPARATE')`).run(supplierId, isoDateOf(0), stamp, stamp);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('out20-pr-i','out20-pr','product-001',2,1000,2000,1)`).run();
    const created = await fixture.request('POST', '/api/supplier-bills', fixture.tokens.accounting, {
      supplierId, supplierInvoiceNo: 'INV-OUT20-PURCHASE', billDate: isoDateOf(0), taxMode: 'NO_TAX',
      idempotencyKey: 'out20-purchase-bill',
      items: [{ receiptItemId: 'out20-pr-i', quantity: 2, uomCode: 'EA', unitPriceCents: 1000 }],
    });
    assert.equal(created.status, 201, created.data.error);
    const posted = await fixture.request('POST', `/api/supplier-bills/${created.data.id}/post`, fixture.tokens.accounting);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const payable = fixture.db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(created.data.id);
    assert.equal(Number(payable.amount_cents), 2000);
    // 普通采购账单仍是 Dr GRNI / Cr AP（canonical 采购口径未被委外改动）。
    const purchaseVoucher = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(created.data.id);
    const purchaseEntries = fixture.db.prepare('SELECT s.code FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.id=? ORDER BY e.line_no').all(purchaseVoucher.id);
    assert.deepEqual(purchaseEntries.map((e) => e.code), ['1407', '2202'], '普通采购账单仍走 canonical Dr GRNI / Cr AP');
  });
});
