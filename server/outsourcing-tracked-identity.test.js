// F-03 —— 委外跟踪物料的身份链路（Requirement §31.15 `OUT-WB-REQ-03/05`）。
//
// 修复前的客户症状：
//   1. 批次料点「发料」→ 409「LOT 物料必须提供唯一批次身份」；
//   2. 点「收货生效」→ 同一个 409（界面没有身份来源）。
// API 层是通的，断的是**身份来源**：界面不提供身份，服务端也没有在受限岗位
// 看不见 WIP 身份明细的前提下替它解析身份。
//
// 本套件证明三件事：
//   1. 发料必须带身份：缺身份固定 409，带身份 201（WIP 身份账按该身份记账）；
//   2. 收货生效时，界面不提供身份则由服务端从该物料行**自己已登记的供给事实**
//      继承身份（最早供给优先），倒冲按该身份消费；
//   3. 收货明细可以带「计划身份」（批次号），由 canonical 跟踪写入器登记。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  createProcurementFixture, prepareOutsourcingReceiptSource, releaseOutsourcingOrder,
  seedApprovedOutsourceBom, seedOutsourceSource,
} from './test-support/procurement-http-fixture.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { receiveValue } from './modules/financial-inventory.js';

const TRACKED_PRODUCT = 'product-lot-f03';
const TRACKED_LOT = 'lot-f03';
const SOURCE_WAREHOUSE = 'warehouse-001';

describe('F-03 · 委外跟踪物料的身份链路（§31.15 OUT-WB-REQ-03/05）', () => {
  let fixture;
  const receiptSources = new Map();

  before(async () => { fixture = await createProcurementFixture('modern-erp-f03-'); });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

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
    assert.equal(result.status, 200, result.data.error);
    await seedOutsourceSource(fixture, [
      { supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) },
      { supplierId: 'supplier-001', productId: TRACKED_PRODUCT, effectiveFrom: isoDate(-30) },
    ]);
  }

  /** 带批次的原材料：库存、身份投影与估值池都走 canonical 写入器。 */
  let trackedMaterialSeeded = false;
  function seedTrackedMaterial() {
    if (trackedMaterialSeeded) return;
    trackedMaterialSeeded = true;
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      TRACKED_PRODUCT, 'P-LOT-F03', '委外批次料', 'CAT', 'EA', 1000, 0, 1, 'LOT', 'LOT_SPECIFIC_POOL', now, now,
    );
    fixture.db.prepare(`INSERT OR IGNORE INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
      VALUES(?,?,?,'AVAILABLE','MANUAL','seed',?)`).run(TRACKED_LOT, TRACKED_PRODUCT, 'LOT-F03-001', now);
    applyInventoryMutation({
      db: fixture.db, sourceType: 'OTHER_RECEIPT', sourceId: 'f03-opening', sourceItemId: 'f03-opening-item',
      businessDate: isoDate(0), actor: { id: 'user-admin' }, movementKind: 'IN', quantity: 100,
      toPosition: { productId: TRACKED_PRODUCT, warehouseId: SOURCE_WAREHOUSE, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE', lotId: TRACKED_LOT },
      idempotencyKey: 'F03:OPENING:IN', remark: 'f03',
    });
    receiveValue(fixture.db, {
      businessDate: isoDate(0), productId: TRACKED_PRODUCT, warehouseId: SOURCE_WAREHOUSE, lotId: TRACKED_LOT,
      quantity: 100, valueCents: 500000, movementType: 'OTHER_RECEIPT', sourceType: 'OTHER_RECEIPT',
      sourceId: 'f03-opening', sourceItemId: 'f03-opening-item', valuationBasis: 'STANDARD_COST',
    });
  }

  /** 成品是普通货品、用料是批次料：发料必须带批次身份。 */
  async function createOrderWithTrackedMaterial() {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: TRACKED_PRODUCT, requiredQuantity: 0.02 }], `f03-${Date.now()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    await releaseOutsourcingOrder(fixture, order.data.id, { materials: [{ productId: TRACKED_PRODUCT, sourceWarehouseId: SOURCE_WAREHOUSE }] });
    receiptSources.set(order.data.id, await prepareOutsourcingReceiptSource(fixture, order.data.id, 10, `f03-${order.data.id}`));
    return order.data.id;
  }

  test('发料缺身份固定 409，带批次身份 201 并按该身份记账', async () => {
    seedTrackedMaterial();
    await qualifyOutsourceSupplier();
    const orderId = await createOrderWithTrackedMaterial();
    const material = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId);

    const withoutIdentity = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: material.id, quantity: 2, issuedDate: isoDate(0), idempotencyKey: 'f03-issue-no-identity',
    });
    assert.equal(withoutIdentity.status, 409, JSON.stringify(withoutIdentity.data));
    assert.match(withoutIdentity.data.error, /批次身份/);
    // 负向对照：拒绝不得留下任何 WIP 身份事实。
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects WHERE material_list_id=?').get(material.id).n, 0);

    const withIdentity = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: material.id, quantity: 2, issuedDate: isoDate(0), idempotencyKey: 'f03-issue-with-identity', lotId: TRACKED_LOT,
    });
    assert.equal(withIdentity.status, 201, withIdentity.data.error);
    const balance = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(material.id);
    assert.equal(balance.lot_id, TRACKED_LOT);
    assert.equal(Number(balance.supplied_quantity), 2);
    assert.equal(Number(balance.available_quantity), 2);
  });

  test('收货生效：界面不提供身份时由服务端继承该物料行已登记的供给身份', async () => {
    seedTrackedMaterial();
    await qualifyOutsourceSupplier();
    const orderId = await createOrderWithTrackedMaterial();
    const material = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId);
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: material.id, quantity: 2, issuedDate: isoDate(0), idempotencyKey: 'f03-issue-for-effect', lotId: TRACKED_LOT,
    });
    assert.equal(issued.status, 201, issued.data.error);

    const source = receiptSources.get(orderId);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
      orderId, quantity: 10, receivedDate: isoDate(0), businessDate: isoDate(0), processingFeeCents: 10000,
      processingPoId: source.processingPoId, sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
      items: [{ productId: source.productId, quantity: 10, unitCode: source.unitCode, unitPriceCents: 1000, processingPoItemId: source.processingPoItemId, sourceNoticeItemId: source.sourceNoticeItemId }],
    }, { 'idempotency-key': 'f03-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);

    // 不带 materialIdentities：服务端必须自己解析出继承身份，而不是 409。
    const confirmed = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': 'f03-effect' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const after = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(material.id);
    assert.equal(after.lot_id, TRACKED_LOT, '倒冲必须消费继承到的同一身份');
    assert.ok(Number(after.consumed_quantity) > 0, '倒冲必须真实消费该身份的可用量');
    assert.equal(Number(after.available_quantity), Number(after.supplied_quantity) - Number(after.consumed_quantity));
    // 负向对照：倒冲不得凭空产生第二个身份。
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(material.id).n, 1);
  });

  test('收货明细可带计划批次身份：成品 Writer 在收货生效时登记该批次', async () => {
    seedTrackedMaterial();
    await qualifyOutsourceSupplier();
    // 成品本身是批次料：用料是普通货品。
    const bomId = seedApprovedOutsourceBom(fixture, TRACKED_PRODUCT, [{ productId: 'product-001', requiredQuantity: 1 }], `f03-finished-${Date.now()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: TRACKED_PRODUCT, orderQuantity: 5, unit: 'EA', businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    await releaseOutsourcingOrder(fixture, order.data.id, { materials: [{ productId: 'product-001', sourceWarehouseId: SOURCE_WAREHOUSE }] });
    const material = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(order.data.id);
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/issues`, fixture.tokens.admin, {
      materialListId: material.id, quantity: 5, issuedDate: isoDate(0), idempotencyKey: 'f03-finished-issue',
    });
    assert.equal(issued.status, 201, issued.data.error);
    const source = await prepareOutsourcingReceiptSource(fixture, order.data.id, 5, `f03-finished-${order.data.id}`);

    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
      orderId: order.data.id, quantity: 5, receivedDate: isoDate(0), businessDate: isoDate(0), processingFeeCents: 5000,
      processingPoId: source.processingPoId, sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
      items: [{ productId: TRACKED_PRODUCT, quantity: 5, unitCode: source.unitCode, unitPriceCents: 1000, processingPoItemId: source.processingPoItemId, sourceNoticeItemId: source.sourceNoticeItemId, lotCode: 'LOT-FINISHED-001' }],
    }, { 'idempotency-key': 'f03-finished-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);
    // 建单只登记计划值：身份主档由成品 Writer 在生效时登记（成品唯一 Writer 合同）。
    const planned = fixture.db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id);
    assert.equal(planned.planned_lot_code, 'LOT-FINISHED-001');
    assert.equal(planned.lot_id, null);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_lots WHERE lot_code=?').get('LOT-FINISHED-001').n, 0);

    const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': 'f03-finished-effect' });
    assert.equal(effected.status, 200, JSON.stringify(effected.data));
    const lot = fixture.db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code=?').get(TRACKED_PRODUCT, 'LOT-FINISHED-001');
    assert.ok(lot, '计划批次必须由 canonical 成品 Writer 登记');
    const item = fixture.db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id);
    assert.equal(item.lot_id, lot.id);
    assert.equal(item.serial_id, null);
    // 成品入库腿必须带该身份。
    const leg = fixture.db.prepare("SELECT * FROM tracked_inventory_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receipt.data.id);
    assert.equal(leg.lot_id, lot.id);
  });
});
