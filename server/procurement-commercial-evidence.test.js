// Procurement & Outsourcing — 采购取价证据与采购订单变更合同回归。
//
// 覆盖 Active Design §26.36 的三个可验收合同：
//   1. 采购取价原语 resolvePurchaseLinePricing() 是唯一金额口径；
//   2. PO Change 是正式命令，金额在应用事务内重新解析并冻结证据；
//   3. canonical PO execution 是 MRP / 工作台 / 预留 / 收货 / 变更的唯一余量口径。
//
// 本文件补齐 §31.16 PRC-DLV-01..09 的缺口证据：错误场景、权限分离、幂等、
// 执行下界与失败零副作用。每个用例使用独立货品，互不污染价格版本链。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { resolvePurchaseLinePricing } from './modules/procurement-pricing.js';

const BOX_PRODUCT = 'pc-commercial-box';
const PO_PRODUCT = 'pc-commercial-po';
const FRACTION_PRODUCT = 'pc-commercial-frac';
const EA_PRODUCT = 'pc-commercial-ea';
const FREE_PRODUCT = 'pc-commercial-free';

describe('Procurement commercial evidence: pricing primitive and PO change', () => {
  let fixture;

  function isoDate(offsetDays = 0) {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-prc-commercial-');
    const now = new Date().toISOString();
    fixture.db.prepare("INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES('BOX','Box',?,?)").run(now, now);
    const insertProduct = fixture.db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code)
      VALUES(?,?,?,'测试货品','EA',0,0,1,?,?,'EA')`);
    for (const [id, code] of [
      [BOX_PRODUCT, 'PCB-001'], [PO_PRODUCT, 'PCB-005'], [FRACTION_PRODUCT, 'PCB-002'],
      [EA_PRODUCT, 'PCB-003'], [FREE_PRODUCT, 'PCB-004'],
    ]) insertProduct.run(id, code, `商业证据货品 ${code}`, now, now);
    const insertConversion = fixture.db.prepare(`INSERT OR IGNORE INTO product_uom_conversions(id,product_id,uom_code,base_uom_code,numerator,denominator,version,effective_from,effective_to,created_at)
      VALUES(?,?,'BOX','EA',12,1,1,?,NULL,?)`);
    for (const productId of [BOX_PRODUCT, PO_PRODUCT, FRACTION_PRODUCT]) {
      insertConversion.run(`uom-conv-commercial-${productId}`, productId, isoDate(-60), now);
    }
    for (const [productId, pricingUomCode, unitPriceCents] of [
      [BOX_PRODUCT, 'BOX', 1200], [PO_PRODUCT, 'BOX', 1200], [FRACTION_PRODUCT, 'BOX', 1], [EA_PRODUCT, 'EA', 600],
    ]) {
      const created = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId, sourceType: 'PURCHASE', pricingUomCode, unitPriceCents,
        effectiveFrom: isoDate(-30),
      });
      assert.equal(created.status, 201, created.data.error);
    }
  });

  after(async () => fixture.close());

  async function createOrder(items, { orderDate = isoDate(0) } = {}) {
    return fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate, expectedDeliveryDate: isoDate(7),
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
      supplierAddress: '测试地址', paymentTerms: '30 天', items,
    });
  }

  async function approvedOrder(items, options) {
    const created = await createOrder(items, options);
    assert.equal(created.status, 201, created.data.error);
    const orderId = created.data.id;
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/approve`, fixture.tokens.reviewer)).status, 200);
    return orderId;
  }

  async function createChange(body, token = fixture.tokens.admin) {
    return fixture.request('POST', '/api/procurement/purchase-order-changes', token, body);
  }

  async function approveChange(changeId, token = fixture.tokens.reviewer) {
    return fixture.request('POST', `/api/procurement/purchase-order-changes/${changeId}/approve`, token);
  }

  async function applyChange(changeId, token = fixture.tokens.admin) {
    return fixture.request('POST', `/api/procurement/purchase-order-changes/${changeId}/apply`, token);
  }

  function insertReceipt(orderId, itemId, productId, quantity, receiptId) {
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
      VALUES(?,?,?,'supplier-001','warehouse-001','user-admin','CONFIRMED',0,?,'user-admin',?,?,'SEPARATE')`)
      .run(receiptId, `PR-${receiptId}`, orderId, isoDate(0), now, now);
    fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?,1)`).run(`${receiptId}-item`, receiptId, itemId, productId, quantity, 600, quantity * 600);
    return `${receiptId}-item`;
  }

  function rowCount(table) {
    return Number(fixture.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  }

  // ------------------------------------------------------------------
  // A. 采购取价原语
  // ------------------------------------------------------------------
  describe('A. 采购取价原语', () => {
    test('A1. 24 EA = 2 BOX 的计价数量与金额精确可重演', () => {
      const resolved = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: BOX_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 24, den: 1 }, businessDate: isoDate(0),
      });
      assert.deepEqual(resolved.baseQuantity, { num: 24, den: 1 });
      assert.deepEqual(resolved.pricingQuantity, { num: 2, den: 1 });
      assert.equal(resolved.netCents, 2400);
      assert.equal(resolved.grossCents, 2400);
      assert.equal(resolved.roundingContract, 'HALF_UP_CENT_V1');
      assert.equal(resolved.pricingUomCode, 'BOX');
    });

    test('A2. 分数比例与半分边界按 HALF_UP_CENT_V1 舍入', () => {
      const half = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: FRACTION_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 6, den: 1 }, businessDate: isoDate(0),
      });
      assert.deepEqual(half.pricingQuantity, { num: 1, den: 2 });
      assert.equal(half.netCents, 1, '0.5 分必须进位到 1 分');
      const quarter = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: FRACTION_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 3, den: 1 }, businessDate: isoDate(0),
      });
      assert.deepEqual(quarter.pricingQuantity, { num: 1, den: 4 });
      assert.equal(quarter.netCents, 0, '0.25 分必须舍去');
    });

    test('A3. PERCENT 与 FLAT 折扣都产出可重演证据', async () => {
      const percent = await fixture.request('POST', '/api/procurement/discounts', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: BOX_PRODUCT, sourceType: 'PURCHASE',
        basis: 'PERCENT', value: { num: 10, den: 100 }, effectiveFrom: isoDate(-20),
      });
      assert.equal(percent.status, 201, percent.data.error);
      const resolved = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: BOX_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 24, den: 1 }, businessDate: isoDate(0),
      });
      assert.equal(resolved.netCents, 2400);
      assert.equal(resolved.discountCents, 240);
      assert.equal(resolved.grossCents, 2160);
      assert.equal(resolved.appliedDiscount.basis, 'PERCENT');
      const flat = await fixture.request('POST', '/api/procurement/discounts', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: BOX_PRODUCT, sourceType: 'PURCHASE',
        basis: 'FLAT', value: { num: 100, den: 1 }, effectiveFrom: isoDate(1),
      });
      assert.equal(flat.status, 201, flat.data.error);
      const later = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: BOX_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 24, den: 1 }, businessDate: isoDate(2),
      });
      assert.equal(later.appliedDiscount.basis, 'FLAT');
      assert.equal(later.discountCents, 200, '固定额折扣按每个计价单位的分金额计算');
      assert.equal(later.grossCents, 2200);
    });

    test('A4. 没有有效价格时普通行 fail closed，赠品为零价', () => {
      assert.throws(
        () => resolvePurchaseLinePricing(fixture.db, {
          supplierId: 'supplier-001', productId: FREE_PRODUCT, sourceType: 'PURCHASE',
          documentUomCode: 'EA', documentQuantity: { num: 2, den: 1 }, businessDate: isoDate(0),
        }),
        (error) => error.status === 409 && error.code === 'PURCHASE_PRICE_NOT_CONFIGURED',
      );
      const gift = resolvePurchaseLinePricing(fixture.db, {
        supplierId: 'supplier-001', productId: FREE_PRODUCT, sourceType: 'PURCHASE',
        documentUomCode: 'EA', documentQuantity: { num: 2, den: 1 }, businessDate: isoDate(0), giftLine: true,
      });
      assert.equal(gift.grossCents, 0);
      assert.equal(gift.unitPriceCents, 0);
      assert.equal(gift.priceEntryId, null);
    });
  });

  // ------------------------------------------------------------------
  // B. 采购订单创建：价格证据冻结与客户端金额失权
  // ------------------------------------------------------------------
  describe('B. 采购订单创建冻结价格证据', () => {
    test('B1. 订单行冻结价格条目、计价单位与换算证据', async () => {
      const created = await createOrder([{ productId: PO_PRODUCT, quantity: 24, uomCode: 'EA' }]);
      assert.equal(created.status, 201, created.data.error);
      const line = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(created.data.id);
      assert.equal(line.unit_price_cents, 1200);
      assert.equal(line.amount_cents, 2400);
      assert.equal(line.pricing_uom_code, 'BOX');
      assert.equal(line.pricing_quantity_num, 2);
      assert.equal(line.pricing_quantity_den, 1);
      assert.ok(line.price_entry_id, '必须冻结价格条目');
      const evidence = JSON.parse(line.pricing_evidence_json);
      assert.equal(evidence.roundingContract, 'HALF_UP_CENT_V1');
      assert.equal(evidence.businessDate, isoDate(0));
      assert.deepEqual(evidence.documentQuantity, { num: 24, den: 1 });
      assert.deepEqual(evidence.pricingQuantity, { num: 2, den: 1 });
      const header = fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(created.data.id);
      assert.equal(header.total_cents, 2400, '表头总额等于有效行金额之和');
    });

    test('B2. 客户端单价与权威价格不一致时拒绝且零业务写入', async () => {
      const orders = rowCount('purchase_orders');
      const items = rowCount('purchase_order_items');
      const created = await createOrder([{ productId: EA_PRODUCT, quantity: 5, unitPriceCents: 999 }]);
      assert.equal(created.status, 409);
      assert.equal(created.data.code, 'PURCHASE_PRICE_EVIDENCE_MISMATCH');
      assert.equal(rowCount('purchase_orders'), orders, '拒绝不得留下采购订单');
      assert.equal(rowCount('purchase_order_items'), items, '拒绝不得留下采购订单行');
    });

    test('B3. 没有有效价格时普通采购订单 fail closed 且零业务写入', async () => {
      const orders = rowCount('purchase_orders');
      const items = rowCount('purchase_order_items');
      const created = await createOrder([{ productId: FREE_PRODUCT, quantity: 5 }]);
      assert.equal(created.status, 409);
      assert.equal(created.data.code, 'PURCHASE_PRICE_NOT_CONFIGURED');
      assert.equal(rowCount('purchase_orders'), orders);
      assert.equal(rowCount('purchase_order_items'), items);
    });

    test('B4. 合法赠品为零价并记录赠品证据', async () => {
      const created = await createOrder([{ productId: FREE_PRODUCT, quantity: 5, isGiftLine: true }]);
      assert.equal(created.status, 201, created.data.error);
      const line = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(created.data.id);
      assert.equal(line.unit_price_cents, 0);
      assert.equal(line.amount_cents, 0);
      assert.equal(line.is_gift_line, 1);
      assert.equal(JSON.parse(line.pricing_evidence_json).giftLine, true);
    });

    test('B5. 历史已批准订单不因价格版本变化被重算', async () => {
      const orderId = await approvedOrder([{ productId: PO_PRODUCT, quantity: 24, uomCode: 'EA' }]);
      const before = fixture.db.prepare('SELECT unit_price_cents,amount_cents FROM purchase_order_items WHERE order_id=?').get(orderId);
      assert.equal(before.amount_cents, 2400);
      const adjusted = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId: PO_PRODUCT, sourceType: 'PURCHASE',
        pricingUomCode: 'BOX', unitPriceCents: 9999, effectiveFrom: isoDate(-1),
      });
      assert.equal(adjusted.status, 201, adjusted.data.error);
      const after = fixture.db.prepare('SELECT unit_price_cents,amount_cents FROM purchase_order_items WHERE order_id=?').get(orderId);
      assert.deepEqual(after, before, '既有订单不得被价格版本变化重算');
    });
  });

  // ------------------------------------------------------------------
  // C. PO Change：正式命令、证据冻结与执行下界
  // ------------------------------------------------------------------
  describe('C. 采购订单变更', () => {
    test('C1. before 快照来自服务端真实订单而不是请求回填', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      const created = await createChange({
        orderId, action: 'MODIFY', payload: { orderItemId: itemId, quantity: 7 },
      });
      assert.equal(created.status, 201, created.data.error);
      const change = fixture.db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(created.data.id);
      const snapshot = JSON.parse(change.snapshot_before_json);
      assert.equal(snapshot.items[0].quantity, 10, '改前数量必须来自订单本身');
      assert.equal(snapshot.order.total_cents, 6000);
      const item = fixture.db.prepare('SELECT * FROM po_change_items WHERE change_id=?').get(created.data.id);
      assert.equal(JSON.parse(item.snapshot_before_json).quantity, 10);
      assert.equal(JSON.parse(item.requested_json).target.quantity, 7);
    });

    test('C2. ADD 在应用事务内重新取价并原子更新表头总额', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 4 }]);
      const created = await createChange({
        orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 6 },
      });
      assert.equal(created.status, 201, created.data.error);
      assert.equal((await approveChange(created.data.id)).status, 200);
      const applied = await applyChange(created.data.id);
      assert.equal(applied.status, 200, JSON.stringify(applied.data));
      const lines = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
      assert.equal(lines.length, 2);
      assert.equal(lines[1].amount_cents, 3600, '新增行金额必须由权威价格解析得到');
      assert.equal(lines[1].price_entry_id !== null, true);
      const header = fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(orderId);
      assert.equal(header.total_cents, 2400 + 3600);
      const versions = fixture.db.prepare('SELECT COUNT(*) n FROM purchase_order_item_versions WHERE order_id=?').get(orderId).n;
      assert.equal(versions, 1, '每次应用都必须留下不可变行版本');
    });

    test('C3. MODIFY 低于已收货执行下界时拒绝且零副作用', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      insertReceipt(orderId, itemId, EA_PRODUCT, 5, 'receipt-commercial-floor');
      const before = fixture.db.prepare('SELECT quantity,amount_cents FROM purchase_order_items WHERE id=?').get(itemId);
      const created = await createChange({
        orderId, action: 'MODIFY', payload: { orderItemId: itemId, quantity: 3 },
      });
      assert.equal(created.status, 201, created.data.error);
      assert.equal((await approveChange(created.data.id)).status, 200);
      const applied = await applyChange(created.data.id);
      assert.equal(applied.status, 409);
      assert.equal(applied.data.code, 'PO_CHANGE_EXECUTION_FLOOR_EXCEEDED');
      const after = fixture.db.prepare('SELECT quantity,amount_cents FROM purchase_order_items WHERE id=?').get(itemId);
      assert.deepEqual(after, before, '被拒绝的变更不得改动订单行');
      const header = fixture.db.prepare('SELECT total_cents,version FROM purchase_orders WHERE id=?').get(orderId);
      assert.equal(header.total_cents, 6000);
    });

    test('C4. 行级取消关闭未执行余量并保留订单历史', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      const created = await createChange({
        orderId, action: 'CANCEL', scope: 'LINE', payload: { orderItemId: itemId },
      });
      assert.equal(created.status, 201, created.data.error);
      assert.equal((await approveChange(created.data.id)).status, 200);
      assert.equal((await applyChange(created.data.id)).status, 200);
      const line = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(itemId);
      assert.equal(line.execution_status, 'CANCELLED');
      const execution = await fixture.request('GET', `/api/purchase-orders/${orderId}/execution`, fixture.tokens.admin);
      assert.equal(execution.status, 200);
      assert.equal(execution.data.execution.items[0].remaining, 0);
      const header = fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(orderId);
      assert.equal(header.total_cents, 0, '被取消的行不再计入订单总额');
    });

    test('C5. 整单取消在存在已收货事实时拒绝', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      insertReceipt(orderId, itemId, EA_PRODUCT, 2, 'receipt-commercial-header');
      const created = await createChange({ orderId, action: 'CANCEL', scope: 'HEADER', payload: {} });
      assert.equal(created.status, 201, created.data.error);
      assert.equal((await approveChange(created.data.id)).status, 200);
      const applied = await applyChange(created.data.id);
      assert.equal(applied.status, 409);
      assert.equal(applied.data.code, 'PO_CHANGE_CANCEL_EXECUTED');
      const header = fixture.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(orderId);
      assert.equal(header.status, 'APPROVED', '被拒绝的整单取消不得改写订单状态');
    });

    test('C6. 申请与审批必须分离', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 4 }]);
      const created = await createChange({ orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 1 } });
      assert.equal(created.status, 201, created.data.error);
      const selfApproved = await approveChange(created.data.id, fixture.tokens.admin);
      assert.equal(selfApproved.status, 409);
      assert.equal(selfApproved.data.code, 'PO_CHANGE_SELF_APPROVAL_FORBIDDEN');
      const forbidden = await createChange(
        { orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 1 } },
        fixture.tokens.sales,
      );
      assert.equal(forbidden.status, 403, '没有 PO_CHANGE_MANAGE 的用户不得申请变更');
    });

    test('C7. 陈旧订单版本在应用时被拒绝', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 4 }]);
      const first = await createChange({ orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 1 } });
      assert.equal((await approveChange(first.data.id)).status, 200);
      const second = await createChange({ orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 2 } });
      assert.equal((await approveChange(second.data.id)).status, 200);
      assert.equal((await applyChange(second.data.id)).status, 200);
      const stale = await applyChange(first.data.id);
      assert.equal(stale.status, 409);
      assert.equal(stale.data.code, 'PO_CHANGE_STALE_VERSION');
    });

    test('C8. 幂等键重放返回原结果，异请求冲突', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 4 }]);
      const body = { orderId, action: 'ADD', idempotencyKey: `idem-${orderId}`, payload: { productId: EA_PRODUCT, quantity: 1 } };
      const first = await createChange(body);
      assert.equal(first.status, 201, first.data.error);
      const replay = await createChange(body);
      assert.equal(replay.status, 200);
      assert.equal(replay.data.id, first.data.id);
      assert.equal(replay.data.replay, true);
      const conflict = await createChange({ ...body, payload: { productId: EA_PRODUCT, quantity: 9 } });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, 'PO_CHANGE_IDEMPOTENCY_CONFLICT');
    });

    test('C9. 已应用的变更重复应用返回原快照且不二次执行', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 4 }]);
      const created = await createChange({ orderId, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 3 } });
      assert.equal((await approveChange(created.data.id)).status, 200);
      const applied = await applyChange(created.data.id);
      assert.equal(applied.status, 200);
      const linesAfterFirst = rowCount('purchase_order_items');
      const totalAfterFirst = fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(orderId).total_cents;
      const again = await applyChange(created.data.id);
      assert.equal(again.status, 200);
      assert.equal(again.data.replay, true);
      assert.deepEqual(again.data.applied.totalCents, applied.data.applied.totalCents);
      assert.equal(rowCount('purchase_order_items'), linesAfterFirst, '重复应用不得重复新增行');
      assert.equal(fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(orderId).total_cents, totalAfterFirst);
    });

    test('C10. 历史缺少价格证据的采购行不允许商业变更', async () => {
      const now = new Date().toISOString();
      fixture.db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date,business_type)
        VALUES('legacy-po-commercial','PO-LEGACY-COM','supplier-001','APPROVED',5000,'','user-admin',?,?,?,?,'STANDARD_PURCHASE')`)
        .run(now, now, isoDate(-1), isoDate(1));
      fixture.db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES('legacy-po-commercial-item','legacy-po-commercial',?,10,500,5000,1)`).run(EA_PRODUCT);
      const created = await createChange({
        orderId: 'legacy-po-commercial', action: 'MODIFY', payload: { orderItemId: 'legacy-po-commercial-item', quantity: 12 },
      });
      assert.equal(created.status, 201, created.data.error);
      assert.equal((await approveChange(created.data.id)).status, 200);
      const applied = await applyChange(created.data.id);
      assert.equal(applied.status, 409);
      assert.equal(applied.data.code, 'PO_CHANGE_PRICE_EVIDENCE_MISSING');
      const line = fixture.db.prepare('SELECT quantity FROM purchase_order_items WHERE id=?').get('legacy-po-commercial-item');
      assert.equal(line.quantity, 10, '历史行不得被改写');
    });

    test('C11. 非已批准订单不得创建正式变更', async () => {
      const created = await createOrder([{ productId: EA_PRODUCT, quantity: 2 }]);
      assert.equal(created.status, 201, created.data.error);
      const change = await createChange({
        orderId: created.data.id, action: 'ADD', payload: { productId: EA_PRODUCT, quantity: 1 },
      });
      assert.equal(change.status, 409);
      assert.equal(change.data.code, 'PO_CHANGE_ORDER_STATE_INVALID');
    });
  });

  // ------------------------------------------------------------------
  // E. 采购到货及时率口径
  // ------------------------------------------------------------------
  describe('E. 采购到货及时率口径', () => {
    test('E1. 及时率按承诺交期计算，完成比单独暴露且不得混用', async () => {
      const created = await createOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      assert.equal(created.status, 201, created.data.error);
      const orderId = created.data.id;
      fixture.db.prepare('UPDATE purchase_orders SET expected_delivery_date=? WHERE id=?').run(isoDate(0), orderId);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      const now = new Date().toISOString();
      // 交期内确认收货 4 件，交期后确认收货 2 件。
      for (const [receiptId, quantity, receiptDate] of [
        ['receipt-commercial-ontime', 4, isoDate(0)],
        ['receipt-commercial-late', 2, isoDate(5)],
      ]) {
        fixture.db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,creator_id,created_at,updated_at,billing_mode)
          VALUES(?,?,?,'supplier-001','warehouse-001','user-admin','CONFIRMED',0,?,'user-admin',?,?,'SEPARATE')`).run(receiptId, `PR-${receiptId}`, orderId, receiptDate, now, now);
        fixture.db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
          VALUES(?,?,?,?,?,600,?,1)`).run(`${receiptId}-item`, receiptId, itemId, EA_PRODUCT, quantity, quantity * 600);
      }
      const report = await fixture.request('GET', '/api/reports/procurement/execution', fixture.tokens.admin);
      assert.equal(report.status, 200, JSON.stringify(report.data));
      const row = report.data.report.find((item) => item.orderId === orderId);
      assert.ok(row, '报表必须给出该采购订单');
      assert.equal(row.ordered, 10);
      assert.equal(row.received, 6);
      assert.equal(row.onTimeReceived, 4, '及时收货数量只统计承诺交期当天或之前的确认收货');
      assert.equal(row.onTimeRate, 0.4, '及时率 = 及时收货数量 / 订单数量');
      assert.equal(row.fulfilmentRate, 0.6, '完成比是另一件事，必须单独暴露');
      assert.notEqual(row.onTimeRate, row.fulfilmentRate, '及时率与完成比不得是同一个口径');
    });
  });
  describe('D. 采购订单执行余量口径', () => {
    test('D1. 加工费采购订单不形成普通采购供给', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 8 }]);
      fixture.db.prepare("UPDATE purchase_orders SET business_type='OUTSOURCE_PROCESSING' WHERE id=?").run(orderId);
      const execution = await fixture.request('GET', `/api/purchase-orders/${orderId}/execution`, fixture.tokens.admin);
      assert.equal(execution.status, 200);
      assert.equal(execution.data.execution.businessType, 'OUTSOURCE_PROCESSING');
      assert.equal(execution.data.execution.eligibleForBuySupply, false);
    });

    test('D2. 部分收货后的余量与预留扣除', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 10 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      insertReceipt(orderId, itemId, EA_PRODUCT, 4, 'receipt-commercial-partial');
      const execution = await fixture.request('GET', `/api/purchase-orders/${orderId}/execution`, fixture.tokens.admin);
      assert.equal(execution.status, 200);
      assert.equal(execution.data.execution.items[0].received, 4);
      assert.equal(execution.data.execution.items[0].remaining, 6);
      assert.equal(execution.data.execution.items[0].availableRemaining, 6);
    });

    test('D3. 采购退货只作披露，不重新打开原订单供给', async () => {
      const orderId = await approvedOrder([{ productId: EA_PRODUCT, quantity: 8 }]);
      const itemId = fixture.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(orderId).id;
      const receiptItemId = insertReceipt(orderId, itemId, EA_PRODUCT, 5, 'receipt-commercial-return');
      const now = new Date().toISOString();
      fixture.db.prepare(`INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
        VALUES('return-commercial','PRT-COMMERCIAL','receipt-commercial-return','supplier-001','warehouse-001',1200,'CONFIRMED',?,'','','user-admin',?,?,?,'user-admin')`)
        .run(isoDate(0), now, now, now);
      fixture.db.prepare(`INSERT INTO purchase_return_items(id,return_id,receipt_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES('return-commercial-item','return-commercial',?,?,2,600,1200,1)`).run(receiptItemId, EA_PRODUCT);
      const execution = await fixture.request('GET', `/api/purchase-orders/${orderId}/execution`, fixture.tokens.admin);
      assert.equal(execution.status, 200);
      assert.equal(execution.data.execution.items[0].returned, 2, '退货数量必须作为披露项可读');
      assert.equal(execution.data.execution.items[0].remaining, 3, '退货不得重新打开原订单供给');
    });
  });
});
