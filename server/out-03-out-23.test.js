// OUT-03 加工费价格来源 / OUT-23 期初委外订单、期初委外 WIP 与期间关闭接入。
//
// 覆盖三组合同：
//   1. OUT-03：加工费 PO 的价格来源可读出。委外价格表条目优先且客户端单价只作
//      断言（不一致 → 稳定 409）；没有有效 OUTSOURCE 条目时冻结为**委外合同**
//      来源（`price_entry_id` 保持 NULL，证据可读出「来源 = 委外合同 + 委外订单号
//      + 金额」）；普通 PURCHASE 价格表不得静默替换委外价格来源。
//   2. OUT-23：期初委外订单可带物料行、数量、身份（LOT/SERIAL）、来源仓与
//      供应商 WIP 位置；期初结余进入**同一本** WIP 身份账，供应商 WIP 余额读模型
//      能反映期初结余；期初不得虚构历史凭证 / 应付。
//   3. OUT-23：委外供给（供应商 WIP 位置 + 委外成品库存）进入既有期间关闭
//      读模型；委外库存流水的业务日期可追溯；委外不改变普通采购/生产的口径。
//
// 证据只通过生产 HTTP API 产生；直接 SQL 只用于构造生产 API 无法表达的
// 历史夹具与断言零副作用的快照。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createProcurementFixture, seedApprovedOutsourceBom,
} from './test-support/procurement-http-fixture.js';
import { migrateProcurementOutsourcingOpeningSchema } from './migrations/procurement-outsourcing-opening-schema.js';

describe('OUT-03 加工费价格来源 / OUT-23 期初委外与期间关闭接入', () => {
  let fixture;
  let sequence = 0;

  const isoDate = (offsetDays = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  };

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-out03-out23-');
    // 期初委外 schema 的迁移是幂等的；这里显式应用一次，使本套件在没有
    // 全局注册（db.js 由集成方统一接线）时也能独立复跑。
    migrateProcurementOutsourcingOpeningSchema(fixture.db);
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
      supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(qualified.status, 200, qualified.data.error);
    // OUT-02 货源控制：委外订单与加工费 PO 都需要业务日期上有效的
    // OUTSOURCE 货源条目。这里直接建立一条来源条目作为业务事实。
    fixture.db.prepare(`INSERT OR IGNORE INTO source_list_entries(
        id,supplier_id,product_id,source_type,enabled,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,'OUTSOURCE',1,?,NULL,1,'user-admin',?)`).run(
      'src-outsource-001', 'supplier-001', 'product-001', isoDate(-30), new Date().toISOString(),
    );
  });
  after(async () => fixture.close());

  // ------------------------------------------------------------------
  // 夹具
  // ------------------------------------------------------------------

  async function createReleasedOrder({ orderQuantity = 10, businessDate = isoDate(0), productId = 'product-001' } = {}) {
    sequence += 1;
    const bomId = seedApprovedOutsourceBom(fixture, productId, [{ productId, requiredQuantity: 0 }], `o3o23-${Date.now()}-${sequence}`);
    const created = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId, orderQuantity, unit: 'EA', businessDate, bomId,
    });
    assert.equal(created.status, 201, created.data.error);
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${created.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId, sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    const confirm = await fixture.request('POST', `/api/procurement/outsourcing/orders/${created.data.id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    assert.equal(confirm.status, 200, confirm.data.error);
    const release = await fixture.request('POST', `/api/procurement/outsourcing/orders/${created.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    assert.equal(release.status, 200, release.data.error);
    return created.data.id;
  }

  function createProcessingPo(orderId, unitPriceCents, key) {
    return fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`, fixture.tokens.admin, {
      unitPriceCents, orderDate: isoDate(0),
      expectedDeliveryDate: isoDate(7), paymentTerms: '30 days',
      supplierContactName: 'Supplier', supplierContactPhone: '13800000000', supplierAddress: 'Address',
    }, { 'idempotency-key': `po-${key}` });
  }

  function priceEntry(sourceType) {
    return fixture.db.prepare(`SELECT * FROM purchase_price_list_entries
      WHERE supplier_id='supplier-001' AND product_id='product-001' AND source_type=?`).get(sourceType);
  }

  function poItem(orderId) {
    return fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(orderId);
  }

  // ------------------------------------------------------------------
  // 1 — OUT-03 加工费价格来源
  // ------------------------------------------------------------------
  describe('OUT-03 加工费价格来源', () => {
    test('没有有效 OUTSOURCE 价格条目时冻结为委外合同来源，price_entry_id 保持 NULL', async () => {
      const orderId = await createReleasedOrder();
      const created = await createProcessingPo(orderId, 500, `contract-${Date.now()}`);
      assert.equal(created.status, 201, created.data.error);
      const item = poItem(created.data.id);
      assert.ok(item, '加工费 PO 必须有唯一来源锁定行');
      assert.equal(item.price_entry_id, null, '没有价格条目时不得编造 price_entry_id');
      assert.equal(item.price_version, null);
      assert.equal(Number(item.unit_price_cents), 500);
      assert.equal(Number(item.amount_cents), 500 * 10);
      const evidence = JSON.parse(item.pricing_evidence_json);
      assert.equal(evidence.sourceKind, 'OUTSOURCE_CONTRACT');
      assert.equal(evidence.sourceType, 'OUTSOURCE');
      assert.equal(evidence.priceEntryId, null);
      assert.equal(evidence.unitPriceCents, 500);
      assert.equal(evidence.amountCents, 5000);
      assert.equal(evidence.outsourcingOrderId, orderId);
      assert.ok(evidence.outsourcingOrderNo, '证据必须能读出委外订单号');
      assert.equal(evidence.businessDate, isoDate(0));
    });

    test('存在有效 OUTSOURCE 价格条目时按价格表定价，price_entry_id 指向该条目', async () => {
      const seeded = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'OUTSOURCE',
        pricingUomCode: 'EA', unitPriceCents: 700, effectiveFrom: isoDate(-1),
      });
      assert.equal(seeded.status, 201, seeded.data.error);
      const entry = priceEntry('OUTSOURCE');
      assert.ok(entry, 'OUTSOURCE 价格条目必须存在');

      const orderId = await createReleasedOrder();
      const created = await createProcessingPo(orderId, 700, `pricelist-${Date.now()}`);
      assert.equal(created.status, 201, created.data.error);
      const item = poItem(created.data.id);
      assert.equal(item.price_entry_id, entry.id, '必须引用权威 OUTSOURCE 价格条目');
      assert.equal(Number(item.price_version), Number(entry.version));
      const evidence = JSON.parse(item.pricing_evidence_json);
      assert.equal(evidence.sourceKind, 'OUTSOURCE_PRICE_LIST');
      assert.equal(evidence.priceEntryId, entry.id);
      assert.equal(evidence.unitPriceCents, 700);
    });

    test('客户端单价与 OUTSOURCE 权威单价不一致固定 409 且业务零副作用', async () => {
      const orderId = await createReleasedOrder();
      const before = fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
      const created = await createProcessingPo(orderId, 999, `mismatch-${Date.now()}`);
      assert.equal(created.status, 409);
      assert.equal(created.data.code, 'OUTSOURCING_PROCESSING_PRICE_ASSERTION_MISMATCH');
      const after = fixture.db.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
      assert.equal(after, before, '被拒的加工费 PO 不得留下任何采购订单事实');
      const order = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      assert.equal(order.status, 'RELEASED', '被拒不得改变委外订单状态');
    });

    test('普通 PURCHASE 价格表不得静默替换委外价格来源（反例）', async () => {
      const purchase = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
        pricingUomCode: 'EA', unitPriceCents: 1234, effectiveFrom: isoDate(-1),
      });
      assert.equal(purchase.status, 201, purchase.data.error);
      const purchaseEntry = priceEntry('PURCHASE');
      assert.ok(purchaseEntry, 'PURCHASE 价格条目必须存在');

      // 委外价格表没有有效条目时，只能走委外合同来源，绝不能取 PURCHASE 条目。
      const outsourceEntry = priceEntry('OUTSOURCE');
      const outsourceEffective = outsourceEntry
        && outsourceEntry.status === 'ACTIVE'
        && outsourceEntry.effective_from <= isoDate(0)
        && (!outsourceEntry.effective_to || outsourceEntry.effective_to >= isoDate(0));
      const orderId = await createReleasedOrder();
      const unitPrice = outsourceEffective ? Number(outsourceEntry.unit_price_cents) : 500;
      const created = await createProcessingPo(orderId, unitPrice, `noswap-${Date.now()}`);
      assert.equal(created.status, 201, created.data.error);
      const item = poItem(created.data.id);
      assert.notEqual(item.price_entry_id, purchaseEntry.id, '加工费 PO 不得引用普通采购价格条目');
      const evidence = JSON.parse(item.pricing_evidence_json);
      assert.equal(evidence.sourceType, 'OUTSOURCE');
      assert.notEqual(evidence.priceEntryId, purchaseEntry.id);
    });

    test('委外价格表条目被停用后退回委外合同来源，不得静默改用 PURCHASE 条目', async () => {
      const entry = priceEntry('OUTSOURCE');
      assert.ok(entry, '前置用例已建立 OUTSOURCE 条目');
      fixture.db.prepare("UPDATE purchase_price_list_entries SET status='INACTIVE' WHERE id=?").run(entry.id);
      const orderId = await createReleasedOrder();
      const created = await createProcessingPo(orderId, 500, `inactive-${Date.now()}`);
      assert.equal(created.status, 201, created.data.error);
      const item = poItem(created.data.id);
      assert.equal(item.price_entry_id, null, '停用条目不得再被引用');
      const evidence = JSON.parse(item.pricing_evidence_json);
      assert.equal(evidence.sourceKind, 'OUTSOURCE_CONTRACT');
      fixture.db.prepare("UPDATE purchase_price_list_entries SET status='ACTIVE' WHERE id=?").run(entry.id);
    });
  });

  // ------------------------------------------------------------------
  // 2 — OUT-23 期初委外订单与期初委外 WIP
  // ------------------------------------------------------------------
  describe('OUT-23 期初委外订单与期初委外 WIP', () => {
    test('期初单据可带物料行与数量，并写入期初物料行头', async () => {
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, unit: 'EA',
        businessDate: isoDate(-1), remark: '上线日历史委外',
        items: [{ productId: 'product-001', quantity: 12.5, sourceWarehouseId: 'warehouse-001' }],
      });
      assert.equal(created.status, 201, created.data.error);
      const order = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(created.data.id);
      assert.equal(Number(order.is_opening), 1, '期初委外订单必须被显式标记');
      assert.equal(order.opening_business_date, isoDate(-1));
      assert.equal(order.status, 'COMPLETED');
      const lines = fixture.db.prepare('SELECT * FROM outsourcing_opening_material_lines WHERE order_id=?').all(created.data.id);
      assert.equal(lines.length, 1);
      assert.equal(Number(lines[0].quantity_num), 12500000);
      assert.equal(Number(lines[0].quantity_den), 1000000);
      assert.equal(lines[0].supplier_wip_warehouse_id, 'warehouse-002', '期初行必须绑定供应商 WIP 位置');
      assert.equal(lines[0].source_warehouse_id, 'warehouse-001');
      const materials = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(created.data.id);
      assert.equal(materials.length, 1);
      assert.equal(Number(materials[0].legacy_unverified_wip_quantity), 12.5);
      assert.equal(materials[0].opening_line_id, lines[0].id);
    });

    test('期初结余进入同一本 WIP 身份账，供应商 WIP 余额读模型能反映期初结余', async () => {
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, unit: 'EA',
        businessDate: isoDate(-1),
        items: [{ productId: 'product-001', quantity: 7, sourceWarehouseId: 'warehouse-001' }],
      });
      assert.equal(created.status, 201, created.data.error);
      const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').get(created.data.id);
      const effects = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE material_list_id=?').all(material.id);
      assert.equal(effects.length, 1, '期初结余必须在身份账上留下恰好一条事实');
      assert.equal(effects[0].event_type, 'OPENING');
      assert.equal(effects[0].effect_direction, 'SUPPLY');
      assert.equal(Number(effects[0].signed_quantity), 7);
      const balances = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?').all(material.id);
      assert.equal(balances.length, 1);
      assert.equal(Number(balances[0].available_quantity), 7);
      assert.equal(Number(balances[0].supplied_quantity), 7);
      assert.equal(Number(balances[0].consumed_quantity), 0);
    });

    test('期初 WIP 的物理事实落在供应商 WIP 位置，期初不产生凭证与应付', async () => {
      const vouchersBefore = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers").get().n;
      const payablesBefore = fixture.db.prepare('SELECT COUNT(*) n FROM account_payables').get().n;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 20, unit: 'EA',
        businessDate: isoDate(-1),
        items: [{ productId: 'product-001', quantity: 3, sourceWarehouseId: 'warehouse-001' }],
      });
      assert.equal(created.status, 201, created.data.error);
      const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').get(created.data.id);
      const wipQuantity = Number(fixture.db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory
        WHERE warehouse_id='warehouse-002' AND product_id='product-001' AND active=1`).get().q);
      assert.ok(wipQuantity >= 3, '期初 WIP 必须落在供应商 WIP 仓的物理库存上');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, vouchersBefore, '期初不得虚构历史凭证');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM account_payables').get().n, payablesBefore, '期初不得虚构历史应付');
      assert.ok(material.id);
    });

    test('期初单据可不带物料行：只有订单、没有供应商 WIP 结余的历史事实', async () => {
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, businessDate: isoDate(-1),
      });
      assert.equal(created.status, 201, created.data.error);
      const order = fixture.db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(created.data.id);
      assert.equal(Number(order.is_opening), 1);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_material_list WHERE order_id=?').get(created.data.id).n, 0);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_opening_material_lines WHERE order_id=?').get(created.data.id).n, 0);
    });

    test('期初物料行格式非法固定拒绝且业务零副作用', async () => {
      const before = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, businessDate: isoDate(-1),
        items: [null],
      });
      assert.equal(created.status, 400);
      assert.equal(created.data.code, 'OUTSOURCING_OPENING_MATERIAL_REQUIRED');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n, before);
    });

    test('期初单据的供应商无委外 WIP 位置时固定拒绝', async () => {
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id=NULL WHERE id='supplier-001'").run();
      const before = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, businessDate: isoDate(-1),
        items: [{ productId: 'product-001', quantity: 1 }],
      });
      assert.equal(created.status, 409);
      assert.equal(created.data.code, 'OUTSOURCING_OPENING_WIP_WAREHOUSE_MISSING');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n, before);
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id='warehouse-002' WHERE id='supplier-001'").run();
    });

    test('期初单据的非跟踪物料携带 LOT 身份固定拒绝', async () => {
      const before = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/opening-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, businessDate: isoDate(-1),
        items: [{ productId: 'product-001', quantity: 1, lotId: 'lot-does-not-exist' }],
      });
      assert.equal(created.status, 409);
      assert.equal(created.data.code, 'WIP_IDENTITY_POLICY_MISMATCH');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_orders').get().n, before);
    });
  });

  // ------------------------------------------------------------------
  // 3 — OUT-23 委外供给接入期间关闭读模型
  // ------------------------------------------------------------------
  describe('OUT-23 委外供给接入期间关闭读模型', () => {
    test('期间关闭预检查包含委外供给一致性检查', async () => {
      const precheck = await fixture.request('POST', '/api/inventory-period-closures/check', fixture.tokens.admin, { period: isoDate(-30).slice(0, 7) });
      assert.equal(precheck.status, 200, precheck.data.error);
      const codes = (precheck.data.precheck?.checks || []).map((check) => check.code);
      assert.ok(codes.includes('OUTSOURCING_SUPPLY_CONSISTENCY'), '期间关闭预检查必须包含委外供给检查');
    });

    test('委外库存流水的业务日期可追溯，不再被判为未登记来源', async () => {
      const precheck = await fixture.request('POST', '/api/inventory-period-closures/check', fixture.tokens.admin, { period: isoDate(0).slice(0, 7) });
      assert.equal(precheck.status, 200, precheck.data.error);
      const legacy = (precheck.data.precheck?.checks || []).find((check) => check.code === 'LEGACY_BUSINESS_DATE_UNKNOWN');
      const outsourcingUnknown = (legacy?.records || []).filter((row) => String(row.sourceType || '').startsWith('OUTSOURCING'));
      assert.deepEqual(outsourcingUnknown, [], '委外库存流水的权威业务日期必须可追溯');
    });

    test('财务业务关闭读模型暴露委外敞口，且不新增关闭轴', async () => {
      const state = await fixture.request('GET', '/api/finance/business-close', fixture.tokens.admin);
      assert.equal(state.status, 200, state.data.error);
      assert.ok(Array.isArray(state.data.state), '既有业务关闭锚点仍然只读返回');
      assert.deepEqual(state.data.state.map((row) => row.close_type).sort(), ['AP', 'AR', 'TREASURY']);
      const exposure = state.data.outsourcingExposure;
      assert.ok(exposure, '业务关闭读模型必须暴露委外敞口');
      assert.ok(Array.isArray(exposure.orders));
      assert.equal(typeof exposure.totals.openProcessingFeeCents, 'number');
      assert.equal(typeof exposure.totals.supplierWipQuantity, 'number');
    });

    test('委外来源不影响普通采购/生产的期间关闭口径', async () => {
      const precheck = await fixture.request('POST', '/api/inventory-period-closures/check', fixture.tokens.admin, { period: isoDate(0).slice(0, 7) });
      assert.equal(precheck.status, 200);
      const codes = (precheck.data.precheck?.checks || []).map((check) => check.code);
      for (const code of ['PERIOD_ENDED', 'PERIOD_SEQUENCE', 'NEGATIVE_INVENTORY', 'PENDING_INVENTORY_DOCUMENTS', 'INVENTORY_CONSISTENCY']) {
        assert.ok(codes.includes(code), `既有期间关闭检查 ${code} 必须保留`);
      }
    });
  });
});
