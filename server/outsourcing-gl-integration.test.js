// 委外库存异动的总账接线（Requirement §31.22 `PRC-GL-01..13`，Design §26.43）。
//
// 权威结账检查 `INVENTORY_VALUE_TO_GL` 取「总账存货角色余额 − 估值流水合计」。
// 委外的发料 / 倒冲 / 收货都改变权威估值池；若不同步改变总账，该差额恒等于加工费
// （客户环境 2026-11-18 实测 −1600：两个委外订单各 800）。
//
// 本套件证明：
//   1. 每个委外库存事件都产生 canonical 系统凭证，分录方向与金额符合 §31.22.2；
//   2. `INVENTORY_VALUE_TO_GL` 在「发料后 / 倒冲后 / 收货后」三个时点**均为 0**，
//      且 system-health 与结账清单**两处实现同时**为 0（`PRC-GL-07`）；
//   3. `6408 委外加工费` 的余额轨迹为「倒冲 +V → 收货 −加工费」（`PRC-GL-12`）；
//   4. 重复执行不产生第二张凭证（`PRC-GL-08`）；
//   5. 凭证写入失败时零副作用（`PRC-GL-09`）。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource,
  releaseOutsourcingOrder, seedApprovedOutsourceBom, seedOutsourceSource,
} from './test-support/procurement-http-fixture.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { createSystemVoucher, receiveValue, systemHealth } from './modules/financial-inventory.js';
import { runChecks } from './modules/accounting-reconciliation.js';

const MATERIAL_PRODUCT = 'product-gl-rm';
const FINISHED_PRODUCT = 'product-gl-fg';
const SOURCE_WAREHOUSE = 'warehouse-001';
const UNIT_COST_CENTS = 1000;
const OPENING_QUANTITY = 100;
const PROCESSING_FEE_CENTS = 800;

describe('委外库存异动的总账接线（§31.22 PRC-GL-01..13）', () => {
  let fixture;
  let orderId;
  let materialListId;
  let material;

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-outsourcing-gl-');
    seedProducts();
    seedOpeningInventory();
    await qualifyOutsourceSupplier();
    orderId = await createOrder();
    material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').get(orderId);
    materialListId = material.id;
  });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function period() { return isoDate(0).slice(0, 7); }

  function seedProducts() {
    const now = new Date().toISOString();
    const insert = fixture.db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,inventory_classification,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run(MATERIAL_PRODUCT, 'P-GL-RM', '委外用料', 'CAT', 'EA', UNIT_COST_CENTS, 0, 1, 'NONE', 'MOVING_AVERAGE', 'RAW_MATERIAL', now, now);
    insert.run(FINISHED_PRODUCT, 'P-GL-FG', '委外成品', 'CAT', 'EA', 2000, 0, 1, 'NONE', 'MOVING_AVERAGE', 'FINISHED_GOOD', now, now);
  }

  /** 期初：估值流水与总账**同步**建立（否则基线本身就不满足 `INVENTORY_VALUE_TO_GL`）。 */
  function seedOpeningInventory() {
    const businessDate = isoDate(0);
    const sourceId = 'gl-opening';
    applyInventoryMutation({
      db: fixture.db, sourceType: 'OTHER_RECEIPT', sourceId, sourceItemId: `${sourceId}-item`,
      businessDate, actor: { id: 'user-admin' }, movementKind: 'IN', quantity: OPENING_QUANTITY,
      toPosition: { productId: MATERIAL_PRODUCT, warehouseId: SOURCE_WAREHOUSE, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'GL:OPENING:IN', remark: '委外总账套件期初',
    });
    const valueCents = UNIT_COST_CENTS * OPENING_QUANTITY;
    receiveValue(fixture.db, {
      businessDate, productId: MATERIAL_PRODUCT, warehouseId: SOURCE_WAREHOUSE,
      quantity: OPENING_QUANTITY, valueCents, movementType: 'OPENING_INVENTORY', sourceType: 'OPENING_INVENTORY',
      sourceId, sourceItemId: `${sourceId}-item`, valuationBasis: 'OPENING_COST',
    });
    createSystemVoucher(fixture.db, {
      sourceType: 'OPENING_INVENTORY', sourceId, businessDate, actorId: 'user-admin',
      entries: [
        { role: 'RAW_MATERIAL_INVENTORY', direction: 'DEBIT', amountCents: valueCents, summary: '期初存货' },
        { role: 'OPENING_EQUITY', direction: 'CREDIT', amountCents: valueCents, summary: '期初权益' },
      ],
      remark: '委外总账套件期初',
    });
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    await seedOutsourceSource(fixture, [
      { supplierId: 'supplier-001', productId: FINISHED_PRODUCT, effectiveFrom: isoDate(-30) },
      { supplierId: 'supplier-001', productId: MATERIAL_PRODUCT, effectiveFrom: isoDate(-30) },
    ]);
  }

  async function createOrder() {
    const bomId = seedApprovedOutsourceBom(fixture, FINISHED_PRODUCT, [{ productId: MATERIAL_PRODUCT, requiredQuantity: 1 }], `gl-${Date.now()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: FINISHED_PRODUCT, orderQuantity: 10, unit: 'EA', businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    await releaseOutsourcingOrder(fixture, order.data.id, { materials: [{ productId: MATERIAL_PRODUCT, sourceWarehouseId: SOURCE_WAREHOUSE }] });
    return order.data.id;
  }

  function vouchers(sourceType) {
    return fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type=? ORDER BY created_at").all(sourceType);
  }

  function voucherEntries(voucherId) {
    return fixture.db.prepare('SELECT s.code subjectCode, e.direction, e.amount_cents amountCents FROM accounting_entries e JOIN accounting_subjects s ON s.id=e.subject_id WHERE e.voucher_id=? ORDER BY e.line_no').all(voucherId);
  }

  function roleSubjectId(roleCode) {
    return fixture.db.prepare('SELECT subject_id FROM account_role_mappings WHERE role_code=?').get(roleCode)?.subject_id || null;
  }

  function roleBalanceCents(roleCode) {
    const subjectId = roleSubjectId(roleCode);
    if (!subjectId) return null;
    return Number(fixture.db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND e.subject_id=?").get(subjectId).n);
  }

  /** 权威结账检查的两处实现必须**同时**归零。 */
  function inventoryValueToGl() {
    const health = systemHealth(fixture.db, { asOfDate: isoDate(0) });
    const healthCheck = health.checks.find((check) => check.code === 'INVENTORY_VALUE_TO_GL');
    const reconCheck = runChecks(fixture.db, period()).find((line) => line.checkCode === 'INVENTORY_VALUE_TO_GL');
    return { healthDifference: Number(healthCheck.difference), healthStatus: healthCheck.status, reconDifference: Number(reconCheck.differenceCents), reconStatus: reconCheck.status };
  }

  async function issueMaterial(quantity, key) {
    return fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId, quantity, issuedDate: isoDate(0), idempotencyKey: key,
    });
  }

  test('发料产生一张系统凭证：借 发出商品(1406) / 贷 物料存货角色，且总账与估值池同域', async () => {
    const issued = await issueMaterial(2, 'gl-issue-1');
    assert.equal(issued.status, 201, JSON.stringify(issued.data));

    const list = vouchers('OUTSOURCING_ISSUE');
    assert.equal(list.length, 1, '一次发料必须产生且只产生一张系统凭证');
    const entries = voucherEntries(list[0].id);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.subjectCode).sort(), ['1403', '1406']);
    const debit = entries.find((entry) => entry.direction === 'DEBIT');
    const credit = entries.find((entry) => entry.direction === 'CREDIT');
    assert.equal(debit.subjectCode, '1406', '发出商品必须是借方');
    assert.equal(credit.subjectCode, '1403', '物料自身存货必须是贷方');
    // 金额必须等于该次出库的权威账面价值（2 × 1000），不是估算值。
    assert.equal(Number(debit.amountCents), 2 * UNIT_COST_CENTS);
    assert.equal(Number(credit.amountCents), 2 * UNIT_COST_CENTS);

    const check = inventoryValueToGl();
    assert.equal(check.healthStatus, 'PASS', `system-health 差额 ${check.healthDifference}`);
    assert.equal(check.reconStatus, 'PASS', `结账清单差额 ${check.reconDifference}`);
  });

  test('收货生效：倒冲与收货各一张凭证，6408 轨迹为「倒冲 +V → 收货 −加工费」', async () => {
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 2, `gl-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin,
      { ...outsourcingReceiptBody(source, 2, PROCESSING_FEE_CENTS), orderId }, { 'idempotency-key': 'gl-receipt-1' });
    assert.equal(receipt.status, 201, receipt.data.error);
    const confirmed = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': 'gl-effect-1' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const backflush = vouchers('OUTSOURCING_BACKFLUSH');
    assert.equal(backflush.length, 1, '一次倒冲必须产生一张系统凭证');
    const backflushEntries = voucherEntries(backflush[0].id);
    const backflushDebit = backflushEntries.find((entry) => entry.direction === 'DEBIT');
    const backflushCredit = backflushEntries.find((entry) => entry.direction === 'CREDIT');
    assert.equal(backflushDebit.subjectCode, '6408', '倒冲必须借记过桥科目');
    assert.equal(backflushCredit.subjectCode, '1406', '倒冲必须贷记发出商品');
    assert.equal(Number(backflushDebit.amountCents), 2 * UNIT_COST_CENTS);

    const received = vouchers('OUTSOURCING_RECEIPT');
    assert.equal(received.length, 1, '一张收货单必须产生且只产生一张系统凭证');
    const receivedEntries = voucherEntries(received[0].id);
    const receivedDebit = receivedEntries.find((entry) => entry.direction === 'DEBIT');
    const receivedCredit = receivedEntries.find((entry) => entry.direction === 'CREDIT');
    assert.equal(receivedDebit.subjectCode, '1405', '成品必须是借方');
    assert.equal(receivedCredit.subjectCode, '6408', '收货必须贷记过桥科目');
    // 成品账面价值 = 材料价值 + 加工费。
    assert.equal(Number(receivedDebit.amountCents), 2 * UNIT_COST_CENTS + PROCESSING_FEE_CENTS);
    assert.equal(Number(receivedCredit.amountCents), 2 * UNIT_COST_CENTS + PROCESSING_FEE_CENTS);

    // `PRC-GL-12`：过桥科目余额 = 倒冲 +V → 收货后 −加工费。
    assert.equal(roleBalanceCents('OUTSOURCING_PROCESSING_FEE'), -PROCESSING_FEE_CENTS);
    // `PRC-GL-07`：收货后总账与估值池仍同域。
    const check = inventoryValueToGl();
    assert.equal(check.healthStatus, 'PASS', `system-health 差额 ${check.healthDifference}`);
    assert.equal(check.reconStatus, 'PASS', `结账清单差额 ${check.reconDifference}`);
  });

  test('重复执行同一发料不产生第二张凭证，SYSTEM_VOUCHER_UNIQUENINESS 保持 0', async () => {
    const before = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE voucher_origin='SYSTEM'").get().n;
    const replay = await issueMaterial(2, 'gl-issue-1');
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    const after = fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE voucher_origin='SYSTEM'").get().n;
    assert.equal(Number(after), Number(before), '重复执行不得产生新的系统凭证');
    const duplicate = systemHealth(fixture.db, { asOfDate: isoDate(0) }).checks.find((check) => check.code === 'SYSTEM_VOUCHER_UNIQUENESS');
    assert.equal(Number(duplicate.difference), 0, '系统凭证必须按 (source_type, source_id) 唯一');
  });

  test('凭证写入失败时整体回滚：库存、估值与凭证均无新增行', async () => {
    const mapping = fixture.db.prepare("SELECT * FROM account_role_mappings WHERE role_code='OTHER_INVENTORY'").get();
    const before = {
      vouchers: fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n,
      movements: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements').get().n,
      transactions: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
      issues: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_issues').get().n,
    };
    // 移除发出商品的科目角色映射，使凭证生产 fail closed。
    fixture.db.prepare("DELETE FROM account_role_mappings WHERE role_code='OTHER_INVENTORY'").run();
    try {
      const failed = await issueMaterial(1, 'gl-issue-fail-closed');
      assert.equal(failed.status, 409, JSON.stringify(failed.data));
    } finally {
      fixture.db.prepare('INSERT OR REPLACE INTO account_role_mappings(role_code,subject_id,updated_by,updated_at) VALUES(?,?,?,?)')
        .run(mapping.role_code, mapping.subject_id, mapping.updated_by, mapping.updated_at);
    }
    const after = {
      vouchers: fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n,
      movements: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements').get().n,
      transactions: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
      issues: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_issues').get().n,
    };
    assert.deepEqual(after, before, '凭证写入失败必须零副作用');
  });
});
