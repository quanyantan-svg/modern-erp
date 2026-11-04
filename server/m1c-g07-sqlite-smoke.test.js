// M1C-G07 Phase-5 — low-cost real-HTTP smoke verification.
//
// Drives CR-01..CR-09 setup chains through the real createApp HTTP handler
// against an isolated disposable SQLite DB, and asserts the pre-race business
// state (IDs, sources, quantities, identities). It proves business
// reachability of the fixed fixture chains; it does NOT simulate MySQL
// concurrency (MYSQL_CONCURRENCY stays NOT_RUN by design).
//
// This file is registered in FULL only (it owns a disposable SQLite DB).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import {
  createApprovedProcessingPo, prepareOutsourcingReceiptSource, outsourcingReceiptBody, seedApprovedOutsourceBom,
} from './test-support/procurement-http-fixture.js';

const isoDate = (offset = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

describe('M1C-G07 SQLite HTTP smoke (production createApp)', () => {
  let fx;
  before(async () => { fx = await createProcurementFixture('modern-erp-m1c-g07-smoke-'); });
  after(async () => { await fx.close(); });

  async function qualifySupplier() {
    const r = await fx.request('PATCH', '/api/suppliers/supplier-001/profile', fx.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }

  async function seedValuation(productId, qty = 1000, cents = 1000000) {
    const now = new Date().toISOString();
    fx.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, ?, ?, ?)
      ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:${productId}`, productId, qty, cents, now);
  }

  async function seedSourceInventory(productId, qty) {
    // Technical L2: authoritative valuation balance required by issueValue.
    await seedValuation(productId, qty, qty * 100);
  }

  async function releaseOutsourceOrder(productId, orderQty, materials, key) {
    const bomId = materials.length ? seedApprovedOutsourceBom(fx, productId, materials, key) : null;
    const order = await fx.request('POST', '/api/procurement/outsourcing/orders', fx.tokens.outsourcing, {
      supplierId: 'supplier-001', productId, orderQuantity: orderQty, unit: 'EA', businessDate: isoDate(),
      ...(bomId ? { bomId } : {}),
    });
    assert.equal(order.status, 201, JSON.stringify(order.data));
    const id = order.data.id;
    assert.equal((await fx.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fx.tokens.outsourcing, { action: 'PLAN_CONFIRMED' })).status, 200);
    assert.equal((await fx.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fx.tokens.outsourcing, { action: 'RELEASED' })).status, 200);
    return id;
  }

  async function snapshotMaterials(orderId, productIds) {
    const snap = await fx.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fx.tokens.outsourcing, {
      items: productIds.map((productId) => ({ productId, sourceWarehouseId: 'warehouse-001' })),
    });
    assert.equal(snap.status, 200, JSON.stringify(snap.data));
    return productIds.map((productId) => fx.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, productId).id);
  }

  async function issueMaterial(orderId, materialListId, quantity, key) {
    const r = await fx.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fx.tokens.outsourcing, {
      materialListId, quantity, idempotencyKey: `issue-${key}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }

  async function createAndCompleteIqc(receiptId, quantity) {
    const created = await fx.request('POST', '/api/iqc', fx.tokens.warehouse, { outsourcing_receipt_id: receiptId });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const done = await fx.request('POST', `/api/iqc/${created.data.id}/complete`, fx.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
    assert.equal(done.status, 200, JSON.stringify(done.data));
  }

  async function createPendingReceipt(orderId, quantity, processingPoId, sourceNoticeId, warehouseId, productId, unitCode, sourceNoticeItemId, key) {
    const body = {
      orderId, quantity, receivedDate: isoDate(), businessDate: isoDate(), processingFeeCents: 0,
      processingPoId, sourceNoticeId, warehouseId,
      items: [{ productId, quantity, unitCode, unitPriceCents: 0,
        processingPoItemId: fx.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(processingPoId).id,
        sourceNoticeItemId }],
    };
    const r = await fx.request('POST', '/api/procurement/outsourcing/receipts', fx.tokens.outsourcingReceiving, body, { 'idempotency-key': `receipt-${key}` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.id;
  }

  test('CR-01: standard PO notice creation chain is reachable (capacity 10, 6+6 race setup)', async () => {
    await qualifySupplier();
    const po = await fx.request('POST', '/api/purchase-orders', fx.tokens.sales, {
      supplierId: 'supplier-001',
      items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 100 }],
      orderDate: isoDate(), expectedDeliveryDate: isoDate(30),
      supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A', paymentTerms: '30 days',
    });
    assert.equal(po.status, 201, JSON.stringify(po.data));
    assert.equal((await fx.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fx.tokens.sales)).status, 200);
    assert.equal((await fx.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fx.tokens.reviewer)).status, 200);
    const poItem = fx.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(po.data.id);
    const schedule = await fx.request('POST', `/api/purchase-orders/${po.data.id}/delivery-schedules`, fx.tokens.admin, {
      orderItemId: poItem.id, plannedQuantity: 10, plannedDate: isoDate(30),
    });
    assert.equal(schedule.status, 201, JSON.stringify(schedule.data));
    // Notice creation requires RECEIPT_NOTICE_MANAGE (admin-only in seeded matrix).
    const notice = await fx.request('POST', '/api/receipt-notices', fx.tokens.admin, {
      businessType: 'STANDARD_PURCHASE', purchaseOrderId: po.data.id, warehouseId: 'warehouse-001',
      items: [{ productId: 'product-001', quantity: 6, sourceAllocations: [{ purchaseOrderItemId: poItem.id, deliveryScheduleId: schedule.data.id, allocatedQuantity: 6 }] }],
      idempotencyKey: `cr01-notice-${Date.now()}`,
    });
    assert.equal(notice.status, 201, JSON.stringify(notice.data));
  });

  test('CR-02: notice → convert → DRAFT purchase receipt chain is reachable', async () => {
    const po = await fx.request('POST', '/api/purchase-orders', fx.tokens.sales, {
      supplierId: 'supplier-001',
      items: [{ productId: 'product-002', quantity: 10, unitPriceCents: 50 }],
      orderDate: isoDate(), expectedDeliveryDate: isoDate(30),
      supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A', paymentTerms: '30 days',
    });
    assert.equal(po.status, 201, JSON.stringify(po.data));
    await fx.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fx.tokens.sales);
    await fx.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fx.tokens.reviewer);
    const poItem = fx.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(po.data.id);
    const schedule = await fx.request('POST', `/api/purchase-orders/${po.data.id}/delivery-schedules`, fx.tokens.admin, {
      orderItemId: poItem.id, plannedQuantity: 10, plannedDate: isoDate(30),
    });
    assert.equal(schedule.status, 201, JSON.stringify(schedule.data));
    const notice = await fx.request('POST', '/api/receipt-notices', fx.tokens.admin, {
      businessType: 'STANDARD_PURCHASE', purchaseOrderId: po.data.id, warehouseId: 'warehouse-001',
      items: [{ productId: 'product-002', quantity: 10, sourceAllocations: [{ purchaseOrderItemId: poItem.id, deliveryScheduleId: schedule.data.id, allocatedQuantity: 10 }] }],
      idempotencyKey: `cr02-notice-${Date.now()}`,
    });
    assert.equal(notice.status, 201, JSON.stringify(notice.data));
    assert.equal((await fx.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fx.tokens.admin)).status, 200);
    const source = fx.db.prepare('SELECT s.id FROM receipt_notice_item_sources s JOIN receipt_notice_items i ON i.id=s.notice_item_id WHERE i.notice_id=?').get(notice.data.id);
    const converted = await fx.request('POST', `/api/receipt-notices/${notice.data.id}/convert`, fx.tokens.admin, {
      items: [{ sourceId: source.id, quantity: 10 }], idempotencyKey: `cr02-convert-${Date.now()}`,
    }, { 'idempotency-key': `cr02-convert-${Date.now()}` });
    assert.equal(converted.status, 201, JSON.stringify(converted.data));
    assert.ok(converted.data.receipts?.length === 1, 'convert must produce one DRAFT purchase receipt');
  });

  test('CR-03/CR-04/CR-05/CR-06: outsourcing order/material/receipt chain is reachable', async () => {
    await qualifySupplier();
    await seedSourceInventory('product-002', 100);
    const orderId = await releaseOutsourceOrder('product-001', 10, [{ productId: 'product-002', requiredQuantity: 1 }], `cr04-${Date.now()}`);
    const [materialId] = await snapshotMaterials(orderId, ['product-002']);
    await issueMaterial(orderId, materialId, 10, `cr06-${Date.now()}`);
    // receipt + IQC
    const poId = await createApprovedProcessingPo(fx, orderId, `cr03-po-${Date.now()}`);
    const src = await prepareOutsourcingReceiptSource(fx, orderId, 4, `cr03-n-${Date.now()}`);
    const receiptId = await createPendingReceipt(orderId, 4, poId, src.sourceNoticeId, src.warehouseId, src.productId, src.unitCode, src.sourceNoticeItemId, `cr03-r-${Date.now()}`);
    await createAndCompleteIqc(receiptId, 4);
    assert.ok(receiptId, 'pending-inspection receipt must exist');
  });

  test('CR-07: two distinct IQC-PASS receipts competing for WIP=6 is reachable', async () => {
    await qualifySupplier();
    await seedSourceInventory('product-002', 100);
    const orderId = await releaseOutsourceOrder('product-001', 10, [{ productId: 'product-002', requiredQuantity: 1 }], `cr07-${Date.now()}`);
    const [materialId] = await snapshotMaterials(orderId, ['product-002']);
    await issueMaterial(orderId, materialId, 6, `cr07-issue-${Date.now()}`); // WIP=6
    const poId = await createApprovedProcessingPo(fx, orderId, `cr07-po-${Date.now()}`);
    const a = await prepareOutsourcingReceiptSource(fx, orderId, 4, `cr07-a-${Date.now()}`);
    const b = await prepareOutsourcingReceiptSource(fx, orderId, 4, `cr07-b-${Date.now()}`);
    const receiptA = await createPendingReceipt(orderId, 4, poId, a.sourceNoticeId, a.warehouseId, a.productId, a.unitCode, a.sourceNoticeItemId, `cr07-ra-${Date.now()}`);
    const receiptB = await createPendingReceipt(orderId, 4, poId, b.sourceNoticeId, b.warehouseId, b.productId, b.unitCode, b.sourceNoticeItemId, `cr07-rb-${Date.now()}`);
    await createAndCompleteIqc(receiptA, 4);
    await createAndCompleteIqc(receiptB, 4);
    assert.ok(receiptA && receiptB && receiptA !== receiptB);
  });

  test('CR-08: LOT identity issue chain (receipt backflush vs return, WIP identity=1) is reachable', async () => {
    await qualifySupplier();
    // LOT material product + lot + authoritative lot/valuation balance (L2).
    const lotMaterial = await fx.request('POST', '/api/products', fx.tokens.admin, {
      code: `cr08-lot-${Date.now()}`, name: 'CR08 LOT material', unit: 'EA', baseUomCode: 'EA', priceCents: 100,
      inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'LOT',
    });
    assert.equal(lotMaterial.status, 201, JSON.stringify(lotMaterial.data));
    fx.db.prepare('UPDATE products SET valuation_method=? WHERE id=?').run('LOT_SPECIFIC_POOL', lotMaterial.data.id);
    const lot = await fx.request('POST', '/api/inventory-lots', fx.tokens.warehouse, { productId: lotMaterial.data.id, lotCode: `CR08-LOT-${Date.now()}` });
    assert.equal(lot.status, 201, JSON.stringify(lot.data));
    const lotId = lot.data.id;
    const receive = await fx.request('POST', '/api/inventory/native-documents', fx.tokens.warehouse, {
      docKind: 'OTHER_RECEIPT', businessDate: isoDate(), items: [{ productId: lotMaterial.data.id, warehouseId: 'warehouse-001', quantity: 10, lotId }],
    });
    assert.equal(receive.status, 201, JSON.stringify(receive.data));
    assert.equal((await fx.request('POST', `/api/inventory/native-documents/${receive.data.id}/confirm`, fx.tokens.warehouse, {})).status, 200);
    const now = new Date().toISOString();
    fx.db.prepare(`INSERT INTO inventory_lot_balances(warehouse_id,product_id,lot_id,quantity,updated_at) VALUES('warehouse-001',?,?,10,?) ON CONFLICT(warehouse_id,lot_id) DO UPDATE SET quantity=excluded.quantity`).run(lotMaterial.data.id, lotId, now);
    fx.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'LOT_SPECIFIC_POOL', ?, 'warehouse-001', ?, NULL, 10, 10000, ?) ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents`).run(`LOT:warehouse-001:${lotMaterial.data.id}:${lotId}`, lotMaterial.data.id, lotId, now);
    const finished = await fx.request('POST', '/api/products', fx.tokens.admin, {
      code: `cr08-fg-${Date.now()}`, name: 'CR08 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE',
    });
    assert.equal(finished.status, 201, JSON.stringify(finished.data));
    const orderId = await releaseOutsourceOrder(finished.data.id, 1, [{ productId: lotMaterial.data.id, requiredQuantity: 1 }], `cr08-${Date.now()}`);
    const [materialId] = await snapshotMaterials(orderId, [lotMaterial.data.id]);
    const issue = await fx.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fx.tokens.outsourcing, {
      materialListId: materialId, quantity: 1, idempotencyKey: `cr08-issue-${Date.now()}`, lotId,
    });
    assert.equal(issue.status, 201, JSON.stringify(issue.data));
    const wip = fx.db.prepare('SELECT identity_key,available_quantity FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(materialId);
    assert.equal(wip.identity_key, `LOT:${lotId}`);
    assert.equal(Number(wip.available_quantity), 1);
  });

  test('CR-09: RELEASED order → processing-fee PO lifetime-single is reachable', async () => {
    await qualifySupplier();
    const orderId = await releaseOutsourceOrder('product-001', 10, [], `cr09-${Date.now()}`);
    const po = await fx.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`, fx.tokens.outsourcing, {
      unitPriceCents: 500, orderDate: isoDate(), expectedDeliveryDate: isoDate(30), paymentTerms: '30 days',
      supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A',
    }, { 'idempotency-key': `cr09-po-${Date.now()}` });
    assert.equal(po.status, 201, JSON.stringify(po.data));
    assert.ok(po.data.id, 'processing-fee PO id');
  });
});
