// VMI 结算机制合同测试（Requirement §31.24 / Design §26.45）。
//
// 业务所有者 2026-11-18 裁定（`D-P01` = D-2a、`D-P02` = 协议单价、容差严格 0、
// 首期不开放部分结算 / 多账单）解除 VMI 结算链的 HARD STOP。
//
// 本套件按 `VMI-SET-AC-01..10` 与 `M1-GD01` / `M1-GD02` 的断言定义逐条证明：
//   AC-01 协议无单价 → 收货 409 `VMI_AGREEMENT_PRICE_MISSING`，存货 / 应付 / 凭证零行
//   AC-02 收货金额 = 协议单价 × 数量；消耗冲减 = 协议单价 × 释放数量；两个权威对账为 0
//   AC-03 期间重叠 409；首期期初不可证明 409 且不写 0；可证明时写入快照证据
//   AC-04 五组恒等式全成立才可关期；未分配调整量 → 409 且不关闭
//   AC-05 账单金额 = 协议单价 × 可结算量；来源三元组 `VMI_SETTLEMENT_LINE`；过账产生凭证
//   AC-06 客户端传 `settlementAmountCents` / `supplierBillId` → 400
//   AC-07 重复提交开期 / 生成账单 → 精确重放
//   AC-08 物权转移接口 410 + 业务文案；`vmi_ownership_transfers` 计数为 0
//   AC-09 `getVmiSummary` 有可结算量字段且不暴露结算金额字段
//   AC-10 既有 VMI 套件保持通过（由 FULL 门禁承担）
//
// 每个场景使用**互不重叠**的货品：VMI 协议对同一 supplier+warehouse+product
// 在任一业务日期至多一个有效协议（既有合同 VMI-01），因此不同场景必须使用
// 不同货品，否则会因协议重叠被既有守卫拒绝 —— 那不是结算链的失败。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { runChecks } from './modules/accounting-reconciliation.js';
import { systemHealth } from './modules/financial-inventory.js';

const UNIT_PRICE_CENTS = 1200;
const RECEIVE_QUANTITY = 10;
const CONSUME_QUANTITY = 4;

describe('VMI 结算机制（§31.24 VMI-SET-01..18 / VMI-SET-AC-01..10）', () => {
  let fixture;

  before(async () => { fixture = await createProcurementFixture('modern-erp-vmi-settle-'); });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  const isoDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10);
  };
  const periodKeyOf = (offset = 0) => isoDate(offset).slice(0, 7);

  function check(code) {
    const line = runChecks(fixture.db, isoDate(0).slice(0, 7)).find((item) => item.checkCode === code);
    assert.ok(line, `对账结果必须包含 ${code}`);
    return line;
  }

  async function qualifySupplier(supplierId) {
    const result = await fixture.request('PATCH', `/api/suppliers/${supplierId}/profile`, fixture.tokens.admin, {
      procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), qualificationStatus: 'QUALIFIED',
    });
    assert.equal(result.status, 200, result.data.error);
  }

  async function createAgreement({ supplierId = 'supplier-001', productId, unitPriceCents, effectiveFrom = isoDate(-10) } = {}) {
    const body = {
      supplierId, warehouseId: 'warehouse-001', productId,
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom,
    };
    if (unitPriceCents !== undefined) body.unitPriceCents = unitPriceCents;
    const result = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, body);
    assert.equal(result.status, 201, result.data.error);
    return result.data.id;
  }

  async function createAndConfirmReceipt({ productId, quantity = RECEIVE_QUANTITY, receivedDate = isoDate(0), idempotencyKey }) {
    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId,
      quantity, receivedDate, idempotencyKey,
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    return receipt.data.id;
  }

  /** 消耗 = D-2a 的 SUPPLIER 位单腿物理 OUT，也是商业释放量的来源。 */
  async function createConsumption({ receiptId, quantity = CONSUME_QUANTITY, consumedDate = isoDate(0), idempotencyKey }) {
    const result = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId, quantity, consumedDate, destination: 'PRODUCTION', idempotencyKey,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.id;
  }

  // -------------------------------------------------------------------------
  // AC-01 · 协议无单价 → 收货固定 409，零副作用
  // -------------------------------------------------------------------------
  test('AC-01 协议无单价时收货固定 409 VMI_AGREEMENT_PRICE_MISSING 且零副作用', async () => {
    await qualifySupplier('supplier-001');
    const productId = 'product-001';
    await createAgreement({ productId, unitPriceCents: undefined });

    const before = {
      inventory: fixture.db.prepare("SELECT COUNT(*) n FROM inventory WHERE owner_type='SUPPLIER' AND owner_id='supplier-001'").get().n,
      payable: fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='VMI_RECEIPT'").get().n,
      voucher: fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='VMI_RECEIPT'").get().n,
      transactions: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
    };

    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId,
      quantity: 5, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-no-price',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 409, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.code, 'VMI_AGREEMENT_PRICE_MISSING');

    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM inventory WHERE owner_type='SUPPLIER' AND owner_id='supplier-001'").get().n, before.inventory, '被拒绝的收货不得写库存位');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='VMI_RECEIPT'").get().n, before.payable, '被拒绝的收货不得写应付开项');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='VMI_RECEIPT'").get().n, before.voucher, '被拒绝的收货不得写凭证');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, before.transactions, '被拒绝的收货不得写库存流水');
    assert.equal(fixture.db.prepare('SELECT business_status s FROM vmi_receipts WHERE id=?').get(receipt.data.id).s, 'PENDING', '被拒绝的收货不得被确认');
  });

  // -------------------------------------------------------------------------
  // AC-02 · 收货与消耗金额 = 协议单价 × 数量；两个权威对账为 0
  // -------------------------------------------------------------------------
  test('AC-02 收货与消耗金额精确等于协议单价 × 数量，两个权威对账检查为 0', async () => {
    const productId = 'product-002';
    await createAgreement({ productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'vmi-set-receipt-1' });

    const expectedReceiptCents = RECEIVE_QUANTITY * UNIT_PRICE_CENTS;
    const voucher = fixture.db.prepare("SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type='VMI_RECEIPT' AND source_id=?").get(receiptId);
    assert.ok(voucher, 'VMI 收货必须产生一张系统凭证');
    const entries = fixture.db.prepare('SELECT e.direction, e.amount_cents amount FROM accounting_entries e WHERE e.voucher_id=? ORDER BY e.line_no').all(voucher.id);
    assert.equal(entries.length, 2);
    assert.equal(Number(entries.find((e) => e.direction === 'DEBIT').amount), expectedReceiptCents, '收货借方金额必须 = 协议单价 × 数量');
    assert.equal(Number(entries.find((e) => e.direction === 'CREDIT').amount), expectedReceiptCents, '收货贷方金额必须 = 协议单价 × 数量');

    const openItem = fixture.db.prepare(
      "SELECT * FROM account_payables WHERE source_type='VMI_RECEIPT' AND source_id=? AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN'",
    ).get(receiptId);
    assert.ok(openItem, '收货必须建立 FINAL 应付开项');
    assert.equal(Number(openItem.amount_cents), expectedReceiptCents, '应付开项金额必须 = 协议单价 × 数量');
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '收货后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '收货后 INVENTORY_VALUE_TO_GL 必须为 0');

    // 消耗：对称冲销，金额 = 协议单价 × 释放数量。
    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId, quantity: CONSUME_QUANTITY, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-set-consumption-1',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));
    const expectedConsumeCents = CONSUME_QUANTITY * UNIT_PRICE_CENTS;
    const consumptionVoucher = fixture.db.prepare("SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type='VMI_CONSUMPTION' AND source_id=?").get(consumption.data.id);
    assert.ok(consumptionVoucher, 'VMI 消耗必须产生一张系统凭证');
    const consumptionEntries = fixture.db.prepare('SELECT e.direction, e.amount_cents amount FROM accounting_entries e WHERE e.voucher_id=? ORDER BY e.line_no').all(consumptionVoucher.id);
    assert.equal(Number(consumptionEntries.find((e) => e.direction === 'DEBIT').amount), expectedConsumeCents, '消耗借方金额必须 = 协议单价 × 释放数量');
    assert.equal(Number(consumptionEntries.find((e) => e.direction === 'CREDIT').amount), expectedConsumeCents, '消耗贷方金额必须 = 协议单价 × 释放数量');
    const afterConsumption = fixture.db.prepare('SELECT * FROM account_payables WHERE id=?').get(openItem.id);
    assert.equal(Number(afterConsumption.open_amount_cents), expectedReceiptCents - expectedConsumeCents, '应付开项必须按协议单价 × 释放数量冲减');
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '消耗后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '消耗后 INVENTORY_VALUE_TO_GL 必须为 0');
  });

  // -------------------------------------------------------------------------
  // AC-08 · 物权转移接口退役
  // -------------------------------------------------------------------------
  test('AC-08 物权转移接口已退役：410 + 业务文案，零写入', async () => {
    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-002' AND business_status='CONFIRMED' LIMIT 1`,
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const rejected = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 10, transferDate: isoDate(0),
    });
    assert.equal(rejected.status, 410, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'VMI_OWNERSHIP_TRANSFER_RETIRED');
    const message = String(rejected.data.error || rejected.data.message || '');
    assert.ok(!/尚未批准|政策未批准/.test(message), '拒绝文案不得出现内部治理措辞');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_ownership_transfers').get().n, 0,
      'vmi_ownership_transfers 表必须保持零写入');
  });

  // -------------------------------------------------------------------------
  // AC-06 · 客户端不得决定金额
  // -------------------------------------------------------------------------
  test('AC-06 客户端传 settlementAmountCents / supplierBillId 固定 400', async () => {
    const receipt = fixture.db.prepare(
      `SELECT id FROM vmi_receipts WHERE supplier_id='supplier-001' AND product_id='product-002' AND business_status='CONFIRMED' LIMIT 1`,
    ).get();
    assert.ok(receipt, 'precondition: a CONFIRMED VMI receipt must exist');

    const withAmount = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 10, settlementAmountCents: 10000, transferDate: isoDate(0),
    });
    assert.equal(withAmount.status, 400, JSON.stringify(withAmount.data));

    const withBill = await fixture.request('POST', '/api/procurement/vmi/ownership-transfers', fixture.tokens.admin, {
      vmiReceiptId: receipt.id, settlementQuantity: 10, supplierBillId: 'bill-x', transferDate: isoDate(0),
    });
    assert.equal(withBill.status, 400, JSON.stringify(withBill.data));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_ownership_transfers').get().n, 0);
  });

  // -------------------------------------------------------------------------
  // AC-03 · 结算期开启：重叠 409；期初证据
  // -------------------------------------------------------------------------
  test('AC-03 结算期开启：重叠窗口固定 409，期初证据必须可证明', async () => {
    const productId = 'product-003';
    const agreementId = await createAgreement({ productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'vmi-set-receipt-3' });
    await createConsumption({ receiptId, idempotencyKey: 'vmi-set-consumption-3' });

    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: periodKeyOf(), windowKind: 'CALENDAR_MONTH',
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;

    const period = fixture.db.prepare('SELECT * FROM vmi_settlement_periods WHERE id=?').get(periodId);
    assert.equal(period.opening_source, 'CANONICAL_INVENTORY_POSITION', '首期期初来源必须是 canonical inventory position 快照');
    assert.ok(period.opening_snapshot_at, '必须写入快照时间');
    assert.ok(period.opening_evidence_hash, '必须写入证据摘要');
    assert.ok(period.opening_audit_ref, '必须写入审计引用');
    assert.equal(period.status, 'OPEN');

    // 重叠窗口（含不同 period_key）固定 409。
    const overlapping = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-CUSTOM`, windowKind: 'CUSTOM',
      windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(overlapping.status, 409, JSON.stringify(overlapping.data));
    assert.equal(overlapping.data.code, 'VMI_SETTLEMENT_PERIOD_OVERLAP');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_settlement_periods WHERE agreement_id=?').get(agreementId).n, 1,
      '被拒绝的开期不得写入第二个结算期');
  });

  test('AC-03 首期期初不可证明时固定 409 VMI_OPENING_BALANCE_UNPROVEN 且不写入 0', async () => {
    await qualifySupplier('supplier-002');
    const productId = 'product-004';
    const agreementId = await createAgreement({ supplierId: 'supplier-002', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const rejected = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: periodKeyOf(), windowKind: 'CALENDAR_MONTH',
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'VMI_OPENING_BALANCE_UNPROVEN');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_settlement_periods WHERE agreement_id=?').get(agreementId).n, 0,
      '期初不可证明时不得写入结算期（更不得写入 0）');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_settlement_lines WHERE period_id IN (SELECT id FROM vmi_settlement_periods WHERE agreement_id=?)').get(agreementId).n, 0);
  });

  // -------------------------------------------------------------------------
  // AC-07 · 重复请求精确重放
  // -------------------------------------------------------------------------
  test('AC-07 重复开启同一结算期精确重放，不产生第二个结算期', async () => {
    const productId = 'product-005';
    const agreementId = await createAgreement({ productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'vmi-set-receipt-5' });
    await createConsumption({ receiptId, idempotencyKey: 'vmi-set-consumption-5' });
    const periodKey = `${periodKeyOf()}-REPLAY`;
    const first = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const replay = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.replayed, true, '重复请求必须精确重放');
    assert.equal(replay.data.id, first.data.id, '重放必须返回同一结算期');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_settlement_periods WHERE agreement_id=? AND period_key=?').get(agreementId, periodKey).n, 1);
  });

  // -------------------------------------------------------------------------
  // AC-04 · 结算期关闭：恒等式与容差
  // -------------------------------------------------------------------------
  test('AC-04 关闭结算期：未分配调整量固定 409 且不关闭（正负同等）', async () => {
    const productId = 'product-001';
    // product-001 的协议已在 AC-01 建立（无单价）。这里直接复用它：关期门禁
    // 与单价无关（结算行不带价也能走恒等式断言）。
    const agreement = fixture.db.prepare(
      "SELECT * FROM vmi_agreements WHERE supplier_id='supplier-001' AND product_id='product-001' AND active=1 LIMIT 1",
    ).get();
    assert.ok(agreement, 'precondition: an agreement for product-001 must exist');
    const agreementId = agreement.id;
    // 给这个协议补上单价，使其可以走完结算链。
    fixture.db.prepare('UPDATE vmi_agreements SET unit_price_cents=? WHERE id=?').run(UNIT_PRICE_CENTS, agreementId);
    await createAndConfirmReceipt({ productId, idempotencyKey: 'vmi-set-receipt-1b' });

    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-TOL`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;

    const line = fixture.db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=? LIMIT 1').get(periodId);
    assert.ok(line, '结算期必须有结算行');

    // 制造一个未归属调整量：容差严格 0 → 拒绝关期。
    fixture.db.prepare('UPDATE vmi_settlement_lines SET unallocated_adjusted_qty=7 WHERE id=?').run(line.id);
    const rejected = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'VMI_SETTLEMENT_UNALLOCATED_ADJUSTMENT');
    assert.equal(fixture.db.prepare('SELECT status s FROM vmi_settlement_periods WHERE id=?').get(periodId).s, 'OPEN',
      '被拒绝的关期不得关闭结算期');

    // 负的未归属调整同样阻断（正负同等）。
    fixture.db.prepare('UPDATE vmi_settlement_lines SET unallocated_adjusted_qty=-7 WHERE id=?').run(line.id);
    const negative = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(negative.status, 409, JSON.stringify(negative.data));
    assert.equal(negative.data.code, 'VMI_SETTLEMENT_UNALLOCATED_ADJUSTMENT');

    // 清零后可以关闭：五组恒等式成立。
    fixture.db.prepare('UPDATE vmi_settlement_lines SET unallocated_adjusted_qty=0 WHERE id=?').run(line.id);
    const closed = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.period.status, 'CLOSED');
    const closedRow = fixture.db.prepare('SELECT * FROM vmi_settlement_periods WHERE id=?').get(periodId);
    assert.ok(closedRow.closed_at, '关闭必须写入 closing 时间');
  });

  test('AC-04 恒等式不成立时固定 409 VMI_SETTLEMENT_IDENTITY_MISMATCH 且不关闭', async () => {
    const productId = 'product-002';
    const agreement = fixture.db.prepare(
      "SELECT * FROM vmi_agreements WHERE supplier_id='supplier-001' AND product_id='product-002' AND active=1 LIMIT 1",
    ).get();
    assert.ok(agreement, 'precondition: an agreement for product-002 must exist');
    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId: agreement.id, periodKey: `${periodKeyOf()}-IDENTITY`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;
    const line = fixture.db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=? LIMIT 1').get(periodId);
    assert.ok(line);
    // 期初供应商位被人为抬高 → VMI-S / VMI-P 不成立。
    fixture.db.prepare('UPDATE vmi_settlement_lines SET opening_supplier_qty=opening_supplier_qty+5 WHERE id=?').run(line.id);
    const rejected = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'VMI_SETTLEMENT_IDENTITY_MISMATCH');
    assert.equal(fixture.db.prepare('SELECT status s FROM vmi_settlement_periods WHERE id=?').get(periodId).s, 'OPEN');
  });

  // -------------------------------------------------------------------------
  // AC-05 · 结算账单：canonical 通道 + 来源三元组
  // -------------------------------------------------------------------------
  test('AC-05 结算账单金额 = 协议单价 × 可结算量，来源三元组为 VMI_SETTLEMENT_LINE，过账产生 canonical 凭证', async () => {
    // 用一个只在本用例出现的货品，避免与其它用例的结算期窗口重叠。
    const productId = 'product-004';
    const agreementId = await createAgreement({ productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await createAndConfirmReceipt({ productId, idempotencyKey: 'vmi-set-receipt-4c' });
    await createConsumption({ receiptId, idempotencyKey: 'vmi-set-consumption-4c' });
    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-BILL`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;
    const closed = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.data));

    const lines = fixture.db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=?').all(periodId);
    const billableQty = lines.reduce((sum, row) => sum + Number(row.commercial_released_qty || 0), 0);
    assert.ok(billableQty > 0, '结算行必须有商业释放量才能开票');

    const bill = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/bills`, fixture.tokens.admin, {});
    assert.equal(bill.status, 201, JSON.stringify(bill.data));
    assert.equal(Number(bill.data.grossCents), Math.round(billableQty * UNIT_PRICE_CENTS), '账单金额必须 = 协议单价 × 可结算量');

    // 来源三元组。
    const items = fixture.db.prepare('SELECT * FROM supplier_bill_items WHERE bill_id=?').all(bill.data.id);
    assert.ok(items.length, '账单必须有明细行');
    for (const item of items) {
      assert.equal(item.commercial_source_type, 'VMI_SETTLEMENT_LINE', '来源类型必须是 VMI_SETTLEMENT_LINE');
      assert.equal(item.commercial_source_id, periodId, '来源 id 必须是结算期间 id');
      assert.ok(item.commercial_source_item_id, '来源行 id 必须是结算行 id');
    }
    // 分配事实。
    const allocations = fixture.db.prepare('SELECT * FROM vmi_settlement_bill_allocations WHERE supplier_bill_id=?').all(bill.data.id);
    assert.ok(allocations.length, '必须写分配事实');
    for (const allocation of allocations) {
      assert.equal(Number(allocation.allocated_qty), billableQty, '分配量必须等于可结算量');
      assert.equal(Number(allocation.allocated_amount_cents), Math.round(billableQty * UNIT_PRICE_CENTS));
    }
    // 结算行的 settled_qty 与 bill_id。
    const settled = fixture.db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=?').all(periodId);
    for (const row of settled) {
      assert.equal(Number(row.settled_qty), Number(row.commercial_released_qty), 'settled_qty 必须一次性等于 commercial_released_qty');
      assert.equal(row.bill_id, bill.data.id);
    }
    // canonical 过账：账单状态 + 系统凭证。
    const billRow = fixture.db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(bill.data.id);
    assert.equal(billRow.status, 'POSTED', '结算账单必须走 canonical postSupplierBill');
    // canonical 系统凭证：结算的凭证来源是结算行（`VMI_SETTLEMENT_LINE`），
    // 分录是「借 主营业务成本 / 贷 应付账款」，**不是**委外的 `Dr GRNI / Cr AP`。
    const settlementLine = fixture.db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=? LIMIT 1').get(periodId);
    const voucher = fixture.db.prepare("SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type='VMI_SETTLEMENT_LINE' AND source_id=?").get(settlementLine.id);
    assert.ok(voucher, '过账必须产生 canonical 系统凭证');
    const entries = fixture.db.prepare(`SELECT e.direction, e.amount_cents amount, s.code subject_code
      FROM accounting_entries e JOIN accounting_subjects s ON s.id=e.subject_id WHERE e.voucher_id=? ORDER BY e.line_no`).all(voucher.id);
    assert.equal(entries.length, 2, '结算凭证必须是一张两行凭证');
    const debit = entries.find((entry) => entry.direction === 'DEBIT');
    const credit = entries.find((entry) => entry.direction === 'CREDIT');
    assert.equal(credit.subject_code, '2202', '结算凭证必须贷记应付账款');
    assert.notEqual(debit.subject_code, '1407', '结算凭证不得照搬委外的 Dr GRNI');
    assert.equal(Number(debit.amount), Math.round(billableQty * UNIT_PRICE_CENTS), '凭证金额必须等于账单金额');
    assert.equal(Number(credit.amount), Math.round(billableQty * UNIT_PRICE_CENTS), '凭证金额必须等于账单金额');
    // 权威对账：结算后两个检查仍为 0。
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '结算后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '结算后 INVENTORY_VALUE_TO_GL 必须为 0');
  });

  // -------------------------------------------------------------------------
  // AC-05 增量 · 6401 主营业务成本的权威对账（Accounting & Analytics
  // Requirement §35.14 `AA-COG-01..04` / Design §31.19）
  //
  // 结算凭证是 `Dr 6401 主营业务成本 / Cr 2202 应付账款`。`COGS_TO_GL` 的期望侧
  // 原本只认销售出库成本，于是结算后总账侧有成本、期望侧没有 → 权威结账
  // BLOCKING（客户环境实测 difference=5000）。本断言把「结算链跑完后
  // COGS_TO_GL = 0」端到端固化。
  // -------------------------------------------------------------------------
  test('AC-05 结算链跑完后 COGS_TO_GL 差额为 0（6401 期望侧覆盖 VMI 结算成本）', async () => {
    const health = systemHealth(fixture.db, { asOfDate: '9999-12-31' });
    const cogs = health.checks.find((item) => item.code === 'COGS_TO_GL');
    assert.ok(cogs, '系统健康检查必须包含 COGS_TO_GL');
    assert.equal(Number(cogs.difference), 0,
      `结算链跑完后 COGS_TO_GL 必须为 0；实际 ${JSON.stringify(cogs)}`);
    assert.equal(cogs.status, 'PASS');
  });

  test('AC-07 重复生成结算账单精确重放，不产生第二张账单、不重复写分配', async () => {
    await qualifySupplier('supplier-003');
    const productId = 'product-002';
    const agreementId = await createAgreement({ supplierId: 'supplier-003', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-003', warehouseId: 'warehouse-001', productId,
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-receipt-3c',
    });
    assert.equal(receiptId.status, 201, JSON.stringify(receiptId.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receiptId.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId.data.id, quantity: CONSUME_QUANTITY, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-set-consumption-3c',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));
    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-BILL-REPLAY`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const periodId = opened.data.id;
    await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/close`, fixture.tokens.admin, {});

    const first = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/bills`, fixture.tokens.admin, {});
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const replay = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${periodId}/bills`, fixture.tokens.admin, {});
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.replayed, true, '重复生成账单必须精确重放');
    assert.equal(replay.data.id, first.data.id, '重放必须返回同一张账单');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM vmi_settlement_bill_allocations WHERE supplier_bill_id=?').get(first.data.id).n, 1,
      '重放不得重复写分配');
    const vmiBillCount = fixture.db.prepare(
      "SELECT COUNT(*) n FROM supplier_bill_items WHERE commercial_source_type='VMI_SETTLEMENT_LINE' AND bill_id=?",
    ).get(first.data.id).n;
    assert.equal(vmiBillCount, 1, '同一结算期只能产生一张账单');
  });

  test('AC-05 结算账单必须由已关闭的结算期产生，未关闭时固定拒绝', async () => {
    await qualifySupplier('supplier-003');
    const productId = 'product-004';
    const agreementId = await createAgreement({ supplierId: 'supplier-003', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-003', warehouseId: 'warehouse-001', productId,
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-receipt-4d',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-NOT-CLOSED`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const rejected = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${opened.data.id}/bills`, fixture.tokens.admin, {});
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'VMI_SETTLEMENT_PERIOD_STATE_INVALID');
  });

  // -------------------------------------------------------------------------
  // AC-09 · 读模型
  // -------------------------------------------------------------------------
  test('AC-09 getVmiSummary 新增可结算量字段且不暴露结算金额字段', async () => {
    const summary = await fixture.request('GET', '/api/procurement/vmi/summary/supplier-001', fixture.tokens.admin);
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    const row = summary.data.summary.find((item) => item.productId === 'product-002');
    assert.ok(row, '汇总必须给出该货品的行');
    assert.ok('billableQuantity' in row, '汇总必须暴露可结算量字段');
    assert.ok('billable' in row, '汇总必须给出是否可开票的标注');
    assert.equal(typeof row.billableQuantity, 'number');
    assert.equal(typeof row.billable, 'boolean');
    // 不得暴露结算金额字段。
    for (const forbidden of ['settlementAmountCents', 'billableAmountCents', 'billedAmountCents', 'pendingSettlement', 'transferred']) {
      assert.equal(row[forbidden], undefined, `不得暴露 ${forbidden}`);
    }
  });

  // -------------------------------------------------------------------------
  // 应付构成的可观测性固化（Design §26.45.9 第 1 / 2 项）
  //
  // 本用例**不改**会计语义：它把「收货确认应付 → 消耗对称冲销 → 结算账单另立
  // 应付开项」这三条已批准合同叠加后的**当前**应付构成写死，作为未来业务裁定
  // 的回归锚点。§31.24 未裁定「未消耗的供应商所有存货」是否应留在应付上，
  // 因此本轮**不擅自**改变它（AGENTS.md §4.4）。
  // -------------------------------------------------------------------------
  test('结算后的应付构成可观测：收货开项剩余 + 结算开项，未消耗量仍挂在应付上', async () => {
    await qualifySupplier('supplier-002');
    const productId = 'product-001';
    const agreementId = await createAgreement({ supplierId: 'supplier-002', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-002', warehouseId: 'warehouse-001', productId,
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-ap-obs',
    });
    assert.equal(receiptId.status, 201, JSON.stringify(receiptId.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receiptId.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const consumption = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId.data.id, quantity: CONSUME_QUANTITY, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-set-ap-obs-c',
    });
    assert.equal(consumption.status, 201, JSON.stringify(consumption.data));

    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-AP-OBS`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const closed = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${opened.data.id}/close`, fixture.tokens.admin, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    const bill = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${opened.data.id}/bills`, fixture.tokens.admin, {});
    assert.equal(bill.status, 201, JSON.stringify(bill.data));

    const openItems = fixture.db.prepare(
      "SELECT source_type, open_amount_cents FROM account_payables WHERE supplier_id='supplier-003' AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN' ORDER BY source_type",
    ).all();
    const receiptItem = openItems.find((row) => row.source_type === 'VMI_RECEIPT');
    const settlementItem = openItems.find((row) => row.source_type === 'VMI_SETTLEMENT_LINE');
    assert.ok(receiptItem, '收货开项必须存在');
    assert.ok(settlementItem, '结算账单必须另立自己的应付开项');
    // 收货开项 = 收货金额 − 消耗冲销金额。
    assert.equal(Number(receiptItem.open_amount_cents),
      (RECEIVE_QUANTITY - CONSUME_QUANTITY) * UNIT_PRICE_CENTS,
      '收货开项余额必须 = 收货金额 − 消耗冲销金额');
    // 结算开项 = 协议单价 × 可结算量。
    assert.equal(Number(settlementItem.open_amount_cents), CONSUME_QUANTITY * UNIT_PRICE_CENTS,
      '结算开项金额必须 = 协议单价 × 可结算量');
    // 当前口径：未被消耗的量仍挂在收货开项上（§31.24 未裁定，见 Design §26.45.9）。
    assert.equal(Number(receiptItem.open_amount_cents), (RECEIVE_QUANTITY - CONSUME_QUANTITY) * UNIT_PRICE_CENTS,
      '未消耗量仍挂在收货开项上 —— 本轮未擅自改变该口径');
    // 子账侧与总账侧同步：对账差额仍为 0（矛盾在应付的业务构成，不在对账差额）。
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '结算后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '结算后 INVENTORY_VALUE_TO_GL 必须为 0');
  });

  test('结算后的消耗仍冲减收货开项，结算开项不被消耗核销（§31.23.5(1) 待裁定）', async () => {
    await qualifySupplier('supplier-003');
    const productId = 'product-003';
    const agreementId = await createAgreement({ supplierId: 'supplier-003', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receiptId = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-003', warehouseId: 'warehouse-001', productId,
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-post-c',
    });
    assert.equal(receiptId.status, 201, JSON.stringify(receiptId.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receiptId.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const first = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId.data.id, quantity: CONSUME_QUANTITY, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-set-post-c-1',
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const opened = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey: `${periodKeyOf()}-POST-C`, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${opened.data.id}/close`, fixture.tokens.admin, {});
    const bill = await fixture.request('POST', `/api/procurement/vmi/settlement-periods/${opened.data.id}/bills`, fixture.tokens.admin, {});
    assert.equal(bill.status, 201, JSON.stringify(bill.data));

    const before = fixture.db.prepare(
      "SELECT source_type, open_amount_cents FROM account_payables WHERE supplier_id='supplier-003' AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN' ORDER BY source_type",
    ).all();
    const settlementBefore = before.find((row) => row.source_type === 'VMI_SETTLEMENT_LINE');

    // 结算后的消耗：仍冲减**收货**开项（当前口径）。
    const second = await fixture.request('POST', '/api/procurement/vmi/consumptions', fixture.tokens.admin, {
      vmiReceiptId: receiptId.data.id, quantity: 1, consumedDate: isoDate(0),
      destination: 'PRODUCTION', idempotencyKey: 'vmi-set-post-c-2',
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));

    const after = fixture.db.prepare(
      "SELECT source_type, open_amount_cents FROM account_payables WHERE supplier_id='supplier-003' AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN' ORDER BY source_type",
    ).all();
    const settlementAfter = after.find((row) => row.source_type === 'VMI_SETTLEMENT_LINE');
    assert.equal(Number(settlementAfter.open_amount_cents), Number(settlementBefore.open_amount_cents),
      '结算开项不被结算后的消耗核销 —— §31.24 未裁定该语义（Design §26.45.9）');
    // 对账仍然为 0。
    assert.equal(Number(check('AP_TO_GL').differenceCents), 0, '结算后的消耗后 AP_TO_GL 必须为 0');
    assert.equal(Number(check('INVENTORY_VALUE_TO_GL').differenceCents), 0, '结算后的消耗后 INVENTORY_VALUE_TO_GL 必须为 0');
  });

  // -------------------------------------------------------------------------
  // 权限分离：结算链使用独立权限码
  // -------------------------------------------------------------------------
  test('结算期与结算账单使用独立权限码，VMI 日常维护权限不足以开期', async () => {
    await qualifySupplier('supplier-003');
    const productId = 'product-005';
    const agreementId = await createAgreement({ supplierId: 'supplier-003', productId, unitPriceCents: UNIT_PRICE_CENTS });
    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-003', warehouseId: 'warehouse-001', productId,
      quantity: RECEIVE_QUANTITY, receivedDate: isoDate(0), idempotencyKey: 'vmi-set-receipt-5d',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    const periodKey = `${periodKeyOf()}-PERM`;
    const rejected = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.accounting, {
      agreementId, periodKey, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(rejected.status, 403, JSON.stringify(rejected.data));
    const accepted = await fixture.request('POST', '/api/procurement/vmi/settlement-periods', fixture.tokens.admin, {
      agreementId, periodKey, windowKind: 'CUSTOM', windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  });
});
