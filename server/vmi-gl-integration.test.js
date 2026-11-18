// VMI 收货与消耗的总账接线（Requirement §31.23 `PRC-VGL-01..06`）。
//
// 业务所有者 2026-11-18 裁定：**物权在收货时转移** —— 收货即确认存货与应付
// （`Dr 存货 / Cr 应付账款`）；消耗时对称冲销（`Dr 应付账款 / Cr 存货`）。
//
// 修复前的症状：VMI 收货只入存货（价值子账 +100,000），总账侧**没有任何分录**，
// 于是 `INVENTORY_VALUE_TO_GL` 差一个收货账面价值、`AP_TO_GL` 也因缺应付开项而失配。
//
// 本套件证明：
//   1. 收货产生一张系统凭证（借 存货 / 贷 应付账款）与一条 FINAL 应付开项；
//   2. 消耗产生对称凭证并冲减应付开项；
//   3. 两个权威对账检查（AP_TO_GL / INVENTORY_VALUE_TO_GL）在收货后与消耗后**均为 0**。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { createSystemVoucher, receiveValue } from './modules/financial-inventory.js';
import { runChecks } from './modules/accounting-reconciliation.js';

const UNIT_COST_CENTS = 1000;
const SEED_QUANTITY = 50;
const RECEIVE_QUANTITY = 10;
const CONSUME_QUANTITY = 4;

// 协议单价（Requirement §31.24 `VMI-SET-03` / `VMI-SET-04`）：VMI 的权威金额
// 来源。收货与消耗的存货 / 应付金额**必须** = 协议单价 × 数量，不得回落到
// 估值池单价或冻结标准制造成本。本套件把协议单价设成与既有 `UNIT_COST_CENTS`
// 相同的值，因此「收货 / 消耗金额 = 协议单价 × 数量」与既有断言同时成立。
const VMI_AGREEMENT_PRICE_CENTS = 1000;

describe('VMI 收货与消耗的总账接线（§31.23 PRC-VGL-01..06）', () => {
  let fixture;

  before(async () => { fixture = await createProcurementFixture('modern-erp-vmi-gl-'); });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  const isoDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10);
  };

  function check(code) {
    const line = runChecks(fixture.db, isoDate(0).slice(0, 7)).find((item) => item.checkCode === code);
    assert.ok(line, `对账结果必须包含 ${code}`);
    return line;
  }

  function voucherEntries(sourceType, sourceId) {
    const voucher = fixture.db.prepare("SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type=? AND source_id=?").get(sourceType, sourceId);
    if (!voucher) return [];
    return fixture.db.prepare('SELECT s.code subjectCode, e.direction, e.amount_cents amountCents FROM accounting_entries e JOIN accounting_subjects s ON s.id=e.subject_id WHERE e.voucher_id=? ORDER BY e.line_no').all(voucher.id);
  }

  /** 为货品建立权威库存与估值池，使 VMI 收货能取到既有账面单价。 */
  function seedValuedStock(productId, warehouseId) {
    const sourceId = 'vmi-gl-seed';
    applyInventoryMutation({
      db: fixture.db, sourceType: 'OTHER_RECEIPT', sourceId, sourceItemId: `${sourceId}:item`,
      businessDate: isoDate(0), actor: { id: 'user-admin' }, movementKind: 'IN', quantity: SEED_QUANTITY,
      toPosition: { productId, warehouseId, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'VMI_GL:SEED', remark: 'VMI 总账套件期初',
    });
    const inbound = fixture.db.prepare("SELECT id FROM inventory_transactions WHERE source_type='OTHER_RECEIPT' AND source_id=? AND direction='IN' ORDER BY created_at DESC LIMIT 1").get(sourceId);
    receiveValue(fixture.db, {
      businessDate: isoDate(0), productId, warehouseId, quantity: SEED_QUANTITY,
      valueCents: SEED_QUANTITY * UNIT_COST_CENTS, movementType: 'OPENING_INVENTORY', sourceType: 'OPENING_INVENTORY',
      sourceId, sourceItemId: `${sourceId}:item`, inventoryTransactionId: inbound?.id || null, valuationBasis: 'OPENING_COST',
    });
    // 期初的总账对方腿：期初存货 / 期初权益（否则子账与总账本就不在同一基准上）。
    createSystemVoucher(fixture.db, {
      sourceType: 'OPENING_INVENTORY', sourceId, businessDate: isoDate(0), actorId: 'user-admin',
      entries: [
        { role: 'RAW_MATERIAL_INVENTORY', direction: 'DEBIT', amountCents: SEED_QUANTITY * UNIT_COST_CENTS, summary: '期初存货' },
        { role: 'OPENING_EQUITY', direction: 'CREDIT', amountCents: SEED_QUANTITY * UNIT_COST_CENTS, summary: '期初权益' },
      ],
      remark: 'VMI 总账套件期初',
    });
  }

  test('VMI 收货确认存货与应付，消耗对称冲销：两个权威对账检查全程为 0', async () => {
    // 前置：供应商采购资质 + VMI 协议 + 有账面价的货品。
    await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL',
    });
    seedValuedStock('product-001', 'warehouse-001');
    const agreement = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(-1),
      unitPriceCents: VMI_AGREEMENT_PRICE_CENTS,
    });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.data));

    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-gl-receipt',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    // 收货：一张系统凭证，借 存货 / 贷 应付账款；应付开项为 FINAL。
    // 金额口径 = 协议单价 × 数量（`VMI-SET-04`）。
    const receivedValueCents = RECEIVE_QUANTITY * VMI_AGREEMENT_PRICE_CENTS;
    const receiptEntries = voucherEntries('VMI_RECEIPT', receipt.data.id);
    assert.equal(receiptEntries.length, 2, 'VMI 收货必须产生一张两行凭证');
    const receiptDebit = receiptEntries.find((entry) => entry.direction === 'DEBIT');
    const receiptCredit = receiptEntries.find((entry) => entry.direction === 'CREDIT');
    const classification = fixture.db.prepare('SELECT inventory_classification FROM products WHERE id=?').get('product-001')?.inventory_classification;
    const expectedInventoryCode = classification === 'RAW_MATERIAL' ? '1403' : classification === 'FINISHED_GOOD' ? '1405' : '1406';
    assert.equal(receiptDebit.subjectCode, expectedInventoryCode, '收货必须借记该货品的存货科目');
    assert.equal(receiptCredit.subjectCode, '2202', '收货必须贷记应付账款');
    assert.equal(Number(receiptDebit.amountCents), receivedValueCents);

    const openItem = fixture.db.prepare(
      "SELECT * FROM account_payables WHERE source_type='VMI_RECEIPT' AND source_id=? AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN'",
    ).get(receipt.data.id);
    assert.ok(openItem, '收货必须建立 FINAL 应付开项');
    assert.equal(Number(openItem.open_amount_cents), receivedValueCents);
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '收货后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '收货后 INVENTORY_VALUE_TO_GL 必须为 0');

    // 消耗：对称凭证 + 应付开项冲减。
    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receipt.data.id, quantity: CONSUME_QUANTITY, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-gl-consumption',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));
    const consumedValueCents = CONSUME_QUANTITY * VMI_AGREEMENT_PRICE_CENTS;
    const consumptionEntries = voucherEntries('VMI_CONSUMPTION', consumption.data.id);
    assert.equal(consumptionEntries.length, 2, 'VMI 消耗必须产生一张两行凭证');
    assert.equal(consumptionEntries.find((entry) => entry.direction === 'DEBIT').subjectCode, '2202', '消耗必须借记应付账款');
    assert.equal(consumptionEntries.find((entry) => entry.direction === 'CREDIT').subjectCode, expectedInventoryCode, '消耗必须贷记同一存货科目');
    assert.equal(Number(consumptionEntries.find((entry) => entry.direction === 'DEBIT').amountCents), consumedValueCents);

    const afterConsumption = fixture.db.prepare('SELECT * FROM account_payables WHERE id=?').get(openItem.id);
    assert.equal(Number(afterConsumption.open_amount_cents), receivedValueCents - consumedValueCents,
      '应付开项必须按本次消耗的权威账面价值冲减');
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '消耗后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '消耗后 INVENTORY_VALUE_TO_GL 必须为 0');
  });
});
