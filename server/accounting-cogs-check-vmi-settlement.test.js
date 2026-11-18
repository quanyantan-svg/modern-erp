// COGS_TO_GL 期望侧覆盖 VMI 结算成本（Accounting & Analytics Requirement §35.14
// `AA-COG-01..05` / Design §31.19）。
//
// 缺陷事实（客户测试环境实测，真实 MySQL 8）：VMI 结算落地后，`6401 主营业务成本`
// 的**全部**来源已不止「销售出库成本」——VMI 结算账单过账时产生
// `Dr 6401 主营业务成本 / Cr 2202 应付账款` 的系统凭证，但 `COGS_TO_GL` 的期望侧
// 只认 `SALES_DELIVERY_COGS` / `SALES_RETURN_COGS_REVERSAL` 两类价值流水，于是
// 权威结账恒定 BLOCKING（实测 `difference=5000`）。
//
// 本套件证明四件事：
//   1. **已过账结算** → 期望侧 = 已出账结算成本，总账侧 = 同额 → 差额 0；
//   2. **陷阱用例**：消耗已发生但结算未出账 → 期望侧 0、总账侧 0 → 差额仍 0
//      （期望侧若误取「VMI 消耗的价值流水」，此用例必须转红）；
//   3. **无 VMI 结算时既有行为不变**（销售出库成本口径不被改动）；
//   4. **变异对照**：差额非 0 时检查确实 FAIL（断言承重），且 SQL 形态受
//      MySQL 适配器的 `CAST(... AS INTEGER)` 翻译约束保护。
//
// 期望侧的口径（Design §31.19.2）：
//   - 权威脊柱 = **分配事实** `vmi_settlement_bill_allocations`（Procurement
//     Requirement §31.24 `VMI-SET-10`：权威关系只在分配表）。分配事实与结算凭证
//     在**同一事务、同一次循环**内写入，因此期望侧与总账侧必然同时移动；
//   - 金额 = 结算行已结算数量 × 协议单价（与结算凭证金额同源同值）；
//   - **不得**取「VMI 消耗的价值流水」——消耗腿在消耗时就减了存货价值，而成本凭证
//     在结算出账时才记，两侧会错位。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { systemHealth } from './modules/financial-inventory.js';
import { translateSqliteSql } from './database/mysql-adapter.js';

const UNIT_PRICE_CENTS = 1200;
const RECEIVE_QUANTITY = 10;
const CONSUME_QUANTITY = 4;
/** 结算成本 = 4 × 1200 分 = 4800 分。 */
const SETTLEMENT_COST_CENTS = CONSUME_QUANTITY * UNIT_PRICE_CENTS;

describe('COGS_TO_GL 期望侧覆盖 VMI 结算成本（§35.14 AA-COG-01..05）', () => {
  let fixture;

  before(async () => { fixture = await createProcurementFixture('modern-erp-cogs-vmi-'); });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  const isoDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10);
  };
  const periodKeyOf = (offset = 0) => isoDate(offset).slice(0, 7);

  const cogsCheck = (asOfDate = '9999-12-31') => {
    const health = systemHealth(fixture.db, { asOfDate });
    const found = health.checks.find((item) => item.code === 'COGS_TO_GL');
    assert.ok(found, '系统健康检查必须包含 COGS_TO_GL');
    return found;
  };

  /** 总账侧 6401 的余额（借 − 贷），与检查内部口径一致。 */
  const glCogsBalance = (asOfDate = '9999-12-31') => Number(fixture.db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
     FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
     JOIN account_role_mappings m ON m.subject_id=e.subject_id
     WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND m.role_code='COGS'`,
  ).get(asOfDate).n);

  async function qualifySupplier(supplierId) {
    const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, {
      procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), qualificationStatus: 'QUALIFIED',
    });
    assert.equal(result.status, 200, result.data.error);
  }

  async function createAgreement({ supplierId = 'supplier-001', productId, unitPriceCents = UNIT_PRICE_CENTS }) {
    const result = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId, warehouseId: 'warehouse-001', productId,
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(-10), unitPriceCents,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.id;
  }

  async function createAndConfirmReceipt({ productId, idempotencyKey, quantity = RECEIVE_QUANTITY }) {
    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId,
      quantity, receivedDate: isoDate(0), idempotencyKey,
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    return receipt.data.id;
  }

  async function createConsumption({ receiptId, idempotencyKey, quantity = CONSUME_QUANTITY }) {
    const result = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId, quantity, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.id;
  }

  // -------------------------------------------------------------------------
  // AA-COG-AC-02 · 陷阱用例：消耗已发生、结算未出账 → 差额仍为 0
  //
  // 这是本轮的核心防线：期望侧若误取「VMI 消耗的价值流水」，此处的期望侧会多算
  // 4800 分，而总账侧仍是 0 → 差 4800 → 必须转红。
  // -------------------------------------------------------------------------
  test('AA-COG-AC-02 消耗已发生但结算未出账时 COGS_TO_GL 差额仍为 0（陷阱用例）', async () => {
    const productId = 'product-001';
    const agreementId = await createAgreement({ productId });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'cogs-vmi-receipt-1' });
    await createConsumption({ receiptId, idempotencyKey: 'cogs-vmi-consumption-1' });

    // 消耗已在总账侧产生 `Dr 应付 / Cr 存货`，但**没有**成本凭证。
    assert.equal(glCogsBalance(), 0, '消耗不得产生 6401 成本凭证（成本只在结算出账时确认）');
    // 存货价值已被消耗腿带走 —— 若期望侧误取消耗的价值流水，这里就会出现失配。
    const consumedValue = Math.abs(Number(fixture.db.prepare(
      "SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE movement_type='VMI_CONSUMPTION'",
    ).get().n));
    assert.ok(consumedValue > 0, '前提：VMI 消耗必须已产生价值流水（否则本用例不承重）');

    const check = cogsCheck();
    assert.equal(Number(check.difference), 0,
      `消耗已发生、结算未出账时 COGS_TO_GL 必须为 0；实际 ${JSON.stringify(check)}`);
    assert.equal(check.status, 'PASS');
  });

  // -------------------------------------------------------------------------
  // AA-COG-AC-01 · 已过账结算 → 期望侧 = 总账侧 → 差额 0
  // -------------------------------------------------------------------------
  test('AA-COG-AC-01 VMI 结算过账后 COGS_TO_GL 差额为 0，且期望侧金额精确到分', async () => {
    const productId = 'product-002';
    const agreementId = await createAgreement({ productId });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'cogs-vmi-receipt-2' });
    await createConsumption({ receiptId, idempotencyKey: 'cogs-vmi-consumption-2' });

    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-COGS`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;

    const closed = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.data));

    const bill = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/bills`, fixture.tokens.admin, {});
    assert.equal(bill.status, 201, JSON.stringify(bill.data));
    assert.equal(Number(bill.data.grossCents), SETTLEMENT_COST_CENTS, '结算账单金额必须 = 协议单价 × 已结算数量');

    // 总账侧：6401 的余额恰好是结算成本。
    assert.equal(glCogsBalance(), SETTLEMENT_COST_CENTS, '总账侧 6401 余额必须等于结算成本');

    // 期望侧（结算口径）逐行金额必须精确到分。
    const lines = fixture.db.prepare('SELECT settled_qty, unit_price_cents FROM vmi_settlement_lines WHERE period_id=?').all(periodId);
    assert.equal(lines.length, 1);
    assert.equal(Number(lines[0].settled_qty), CONSUME_QUANTITY);
    assert.equal(Number(lines[0].unit_price_cents), UNIT_PRICE_CENTS);
    assert.equal(Math.round(Number(lines[0].settled_qty) * Number(lines[0].unit_price_cents)), SETTLEMENT_COST_CENTS);

    const check = cogsCheck();
    assert.equal(Number(check.difference), 0, `结算过账后 COGS_TO_GL 必须为 0；实际 ${JSON.stringify(check)}`);
    assert.equal(check.status, 'PASS');
  });

  // -------------------------------------------------------------------------
  // AA-COG-AC-03 · 无 VMI 结算时既有行为不变（销售出库成本口径不被改动）
  // -------------------------------------------------------------------------
  test('AA-COG-AC-03 无 VMI 结算时 COGS_TO_GL 仍只以销售出库成本为期望侧', async () => {
    // 用一个**没有**任何 VMI 结算行的货品，证明期望侧的 VMI 项贡献 0。
    const before = cogsCheck();
    assert.equal(Number(before.difference), 0, '基线：无 VMI 结算时差额必须为 0');

    // 静态断言：期望侧的 SQL 仍保留销售出库成本的两类价值流水。
    const source = readFileSync(new URL('./modules/financial-inventory.js', import.meta.url), 'utf8');
    assert.ok(source.includes("movement_type IN ('SALES_DELIVERY_COGS','SALES_RETURN_COGS_REVERSAL')"),
      'COGS_TO_GL 的销售出库成本口径不得被改动');
  });

  // -------------------------------------------------------------------------
  // AA-COG-AC-04 · 变异对照：差额非 0 时检查确实 FAIL（断言承重）
  // -------------------------------------------------------------------------
  test('AA-COG-AC-04 变异对照：篡改总账侧金额后 COGS_TO_GL 必须 FAIL（断言承重）', async () => {
    const before = cogsCheck();
    assert.equal(Number(before.difference), 0, '前置：变异前差额必须为 0');

    // 在总账侧多记 1 分成本 —— 检查必须转红，且差额精确为 1 分。
    const subjectId = fixture.db.prepare("SELECT subject_id FROM account_role_mappings WHERE role_code='COGS'").get().subject_id;
    const voucherId = fixture.db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='VMI_SETTLEMENT_LINE' LIMIT 1").get().id;
    const entryId = fixture.db.prepare("SELECT id FROM accounting_entries WHERE voucher_id=? AND direction='DEBIT' LIMIT 1").get(voucherId).id;
    const original = Number(fixture.db.prepare('SELECT amount_cents FROM accounting_entries WHERE id=?').get(entryId).amount_cents);
    fixture.db.prepare('UPDATE accounting_entries SET amount_cents=? WHERE id=?').run(original + 1, entryId);
    try {
      const mutated = cogsCheck();
      assert.equal(mutated.status, 'FAIL', '总账侧被篡改后检查必须 FAIL（否则断言不承重）');
      assert.equal(Number(mutated.difference), 1, '差额必须精确为被篡改的 1 分');
    } finally {
      fixture.db.prepare('UPDATE accounting_entries SET amount_cents=? WHERE id=?').run(original, entryId);
    }
    assert.equal(Number(cogsCheck().difference), 0, '还原后差额必须回到 0');
  });

  // -------------------------------------------------------------------------
  // AA-COG-AC-05 · 双引擎 SQL 形态守卫
  //
  // MySQL 适配器把 `CAST(... AS INTEGER)` 翻译为 `CAST(... AS SIGNED)`，但该正则
  // **不容许嵌套括号**。因此期望侧的 SQL 必须把 `ROUND(...)` 放在派生表里、
  // 让 `CAST` 的参数保持无嵌套括号，否则真实 MySQL 会收到未翻译的
  // `CAST(... AS INTEGER)`（MySQL 8 不接受该类型名）。
  // -------------------------------------------------------------------------
  test('AA-COG-AC-05 期望侧 SQL 的 CAST 形态必须被 MySQL 适配器正确翻译', () => {
    const source = readFileSync(new URL('./modules/financial-inventory.js', import.meta.url), 'utf8');
    const match = source.match(/const vmiSettlementCogs=Number\(db\.prepare\(`([\s\S]*?)`\)\.get\(asOfDate\)\.n\);/);
    assert.ok(match, '必须能定位期望侧的 SQL');
    const sql = match[1];
    const translated = translateSqliteSql(sql);
    assert.ok(!/AS\s+INTEGER/i.test(translated),
      `期望侧 SQL 的 CAST 必须被翻译为 MySQL 可用的类型；实际翻译结果：${translated}`);
    assert.ok(/CAST\(r\.settled_cents AS SIGNED\)/i.test(translated),
      `期望侧 SQL 必须把 ROUND 放在派生表内、让 CAST 参数无嵌套括号；实际：${translated}`);
  });
});
