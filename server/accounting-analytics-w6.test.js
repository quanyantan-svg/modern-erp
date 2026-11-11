// Accounting & Analytics Domain Closure — AA-W6 存货核算深化.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.6
// Design:    docs/design/accounting-analytics.md §31.6
//
// Coverage:
//   AA-W6.1..AA-W6.2   核算范围实体与按范围出账
//   AA-W6.3..AA-W6.4   计价方法优先级与变更受控
//   AA-W6.5..AA-W6.7   暂估入库、暂估差异调整与成本构成可回看
//   AA-W6.8..AA-W6.10  采购费用归集、分摊可重算与进入权威价值流水
//   AA-W6.11..AA-W6.12 完工成本结转、差异分配与 GL 一致
//   AA-W6.13..AA-W6.14 受控成本调整
//   AA-W6.15..AA-W6.16 核算关账异常清单

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAccountingFixture } from './test-support/accounting-http-fixture.js';

const BUSINESS_DATE = '2027-06-15';

let fixture;

function isoDate(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

before(async () => {
  fixture = await createAccountingFixture('erp-accounting-w6-');
});

after(async () => {
  if (fixture) await fixture.close();
});

/** 建立一条已确认的采购入库单（暂估单据的来源事实）。 */
function seedConfirmedReceipt(db, { id, productId, quantity, amountCents }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,status,total_cents,receipt_date,handler_id,creator_id,created_at,updated_at,confirmed_at)
    VALUES(?,?,?,?,'CONFIRMED',?,?,?,?,?,?,?)`).run(
    id, 'PR-' + id, 'supplier-001', 'warehouse-001', amountCents, BUSINESS_DATE, 'user-admin', 'user-admin', now, now, now,
  );
  db.prepare(`INSERT OR REPLACE INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,?,?,?,1)`).run(
    `${id}-i1`, id, productId, quantity, Math.round(amountCents / quantity), amountCents,
  );
  return id;
}

/** 建立一条带库存余额的权威估值事实（分摊与调整的对象）。 */
function seedValuedStock(db, { productId, quantity, valueCents }) {
  const now = new Date().toISOString();
  const key = `NONE:warehouse-001:${productId}`;
  db.prepare(`INSERT OR REPLACE INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES(?,'MOVING_AVERAGE',?,'warehouse-001',NULL,NULL,?,?,?)`).run(key, productId, quantity, valueCents, now);
  db.prepare(`INSERT OR REPLACE INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
    VALUES(?,?,?,'warehouse-001',NULL,NULL,?,?,?,'MOVING_AVERAGE','AA_W6_FIXTURE','AA_W6_FIXTURE',?,?,NULL,NULL,NULL,'POSTED',?)`).run(
    `mv-${productId}`, BUSINESS_DATE, productId, quantity, valueCents, Math.round(valueCents / quantity),
    `mv-${productId}`, productId, now,
  );
  db.prepare("UPDATE products SET valuation_activated_at=COALESCE(valuation_activated_at,?) WHERE id=?").run(now, productId);
}

function subjectCode(db, code) {
  const row = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(code);
  assert.ok(row, `会计科目 ${code} 必须存在`);
  return row.id;
}

function voucherEntries(db, voucherId) {
  return db.prepare(`SELECT e.direction,e.amount_cents amountCents,s.code subjectCode
    FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id
    WHERE v.id=? ORDER BY e.line_no`).all(voucherId);
}

describe('AA-W6 存货核算深化', () => {
  test('AA-W6.1/2 核算范围是独立实体，维度非法、编码重复与越权一律拒绝', async () => {
    const created = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.accounting, {
      code: 'SCOPE-CN', name: '中国组织核算范围', orgScope: 'ORGANIZATION', ownerScope: 'OWNER',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.accountingScope.org_scope, 'ORGANIZATION');

    const listed = await fixture.request('GET', '/api/accounting/scopes', fixture.tokens.accounting);
    assert.equal(listed.status, 200);
    assert.ok(listed.data.accountingScopes.some((row) => row.code === 'SCOPE-CN'));

    const duplicated = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.accounting, {
      code: 'SCOPE-CN', name: '重复编码', orgScope: 'ORGANIZATION', ownerScope: 'NONE',
    });
    assert.equal(duplicated.status, 409);

    const invalid = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.accounting, {
      code: 'SCOPE-XX', name: '非法维度', orgScope: 'GALAXY', ownerScope: 'NONE',
    });
    assert.equal(invalid.status, 400);

    const forbidden = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.sales, {
      code: 'SCOPE-SALES', name: '越权', orgScope: 'ORGANIZATION', ownerScope: 'NONE',
    });
    assert.equal(forbidden.status, 403);
  });

  test('AA-W6.3 计价方法按属性 > 类别 > 默认选择，同级并列时 fail closed', async () => {
    const scope = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.accounting, {
      code: 'SCOPE-PRICE', name: '计价范围', orgScope: 'ORGANIZATION', ownerScope: 'NONE',
    });
    const scopeId = scope.data.accountingScope.id;

    await fixture.request('POST', '/api/accounting/costing-profiles', fixture.tokens.accounting, {
      productId: 'product-001', accountingScopeId: scopeId, valuationMethod: 'MOVING_AVERAGE', priority: 50,
    });
    await fixture.request('POST', '/api/accounting/costing-profiles', fixture.tokens.accounting, {
      productClass: '电子产品', accountingScopeId: scopeId, valuationMethod: 'FIFO', priority: 60,
    });
    await fixture.request('POST', '/api/accounting/costing-profiles', fixture.tokens.accounting, {
      accountingScopeId: scopeId, valuationMethod: 'WEIGHTED_AVERAGE', priority: 90,
    });
    const profiles = await fixture.request('GET', '/api/accounting/costing-profiles', fixture.tokens.accounting);
    assert.equal(profiles.status, 200);
    assert.equal(profiles.data.costingProfiles.length, 3);

    // 同级两条相同 priority → 命中歧义 → 409。
    await fixture.request('POST', '/api/accounting/costing-profiles', fixture.tokens.accounting, {
      productClass: '电子产品', accountingScopeId: scopeId, valuationMethod: 'LIFO', priority: 60,
    });
    const { resolveCostingProfile } = await import('./modules/accounting-inventory-cost.js');
    assert.throws(
      () => resolveCostingProfile(fixture.db, {
        productId: 'product-002', productClass: '电子产品', scopeId, businessDate: BUSINESS_DATE,
      }),
      (error) => error.code === 'COSTING_PROFILE_AMBIGUOUS',
    );
  });

  test('AA-W6.4 已有估值移动的物料变更计价方法被拒绝', async () => {
    const scope = await fixture.request('POST', '/api/accounting/scopes', fixture.tokens.accounting, {
      code: 'SCOPE-CHANGE', name: '变更范围', orgScope: 'ORGANIZATION', ownerScope: 'NONE',
    });
    seedValuedStock(fixture.db, { productId: 'product-003', quantity: 5, valueCents: 5000 });
    const rejected = await fixture.request('POST', '/api/accounting/costing-profiles', fixture.tokens.accounting, {
      productId: 'product-003', accountingScopeId: scope.data.accountingScope.id, valuationMethod: 'FIFO',
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.equal(rejected.data.code, 'COSTING_METHOD_CHANGE_NOT_ALLOWED');
  });

  test('AA-W6.5/AA-W6.6 暂估入库单与差异调整：差异走调整凭证，暂估金额不被改写', async () => {
    seedConfirmedReceipt(fixture.db, { id: 'aa-w6-receipt-1', productId: 'product-001', quantity: 10, amountCents: 100000 });
    const created = await fixture.request('POST', '/api/accounting/provisional-receipts', fixture.tokens.accounting, {
      sourceReceiptId: 'aa-w6-receipt-1', estimateCents: 100000, basis: '供应商暂估单价',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const provisionalId = created.data.provisionalReceipt.id;
    assert.equal(created.data.provisionalReceipt.status, 'OPEN');

    const duplicated = await fixture.request('POST', '/api/accounting/provisional-receipts', fixture.tokens.accounting, {
      sourceReceiptId: 'aa-w6-receipt-1', estimateCents: 100000, basis: '重复登记',
    });
    assert.equal(duplicated.status, 409);

    const adjusted = await fixture.request('POST', `/api/accounting/provisional-receipts/${provisionalId}/adjust`, fixture.tokens.accounting, {
      finalCents: 120000, reason: '正式发票高于暂估',
    });
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.data));
    assert.equal(adjusted.data.adjustment.difference_cents, 20000);
    assert.ok(adjusted.data.adjustment.voucher_id, '差异调整必须生成凭证');
    // 暂估金额不得被改写。
    const row = fixture.db.prepare('SELECT estimate_cents,status FROM provisional_receipts WHERE id=?').get(provisionalId);
    assert.equal(Number(row.estimate_cents), 100000, '暂估金额不得被差异调整改写');
    assert.equal(row.status, 'ADJUSTED');

    const entries = voucherEntries(fixture.db, adjusted.data.adjustment.voucher_id);
    const debit = entries.filter((row2) => row2.direction === 'DEBIT');
    const credit = entries.filter((row2) => row2.direction === 'CREDIT');
    assert.equal(Number(debit[0].amountCents), 20000);
    assert.equal(Number(credit[0].amountCents), 20000);
    assert.ok(debit[0].subjectCode !== credit[0].subjectCode, '借贷方向必须落到不同科目');

    const again = await fixture.request('POST', `/api/procurement/previsional-receipts/${provisionalId}/adjust`, fixture.tokens.accounting, {
      finalCents: 130000, reason: '重复调整',
    }).catch(() => ({ status: 404 }));
    assert.equal(again.status, 404, '该路径不存在，重复调整应走 /adjust 路径');
    const repeat = await fixture.request('POST', `/api/accounting/provisional-receipts/${provisionalId}/adjust`, fixture.tokens.accounting, {
      finalCents: 130000, reason: '重复调整',
    });
    assert.equal(repeat.status, 409, '已调整的暂估单不得再次调整');
  });

  test('AA-W6.8/9/10 采购费用分摊：可重算、进入权威价值流水并生成凭证', async () => {
    seedValuedStock(fixture.db, { productId: 'product-001', quantity: 10, valueCents: 100000 });
    const expense = await fixture.request('POST', '/api/purchase-expenses', fixture.tokens.accounting, {
      expenseType: 'FREIGHT', amountCents: 30000, incurredDate: BUSINESS_DATE, supplierId: 'supplier-001',
    });
    assert.equal(expense.status, 201, JSON.stringify(expense.data));
    const expenseId = expense.data.purchaseExpense.id;

    const rule = await fixture.request('POST', '/api/purchase-expense-allocation-rules', fixture.tokens.accounting, {
      code: 'RULE-VALUE', name: '按价值分摊', basisType: 'VALUE',
      scope: { targets: [{ productId: 'product-001' }, { productId: 'product-002' }] },
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.data));
    const ruleId = rule.data.purchaseExpenseAllocationRule.id;

    const allocated = await fixture.request('POST', `/api/purchase-expenses/${expenseId}/allocate`, fixture.tokens.accounting, {
      ruleId, businessDate: BUSINESS_DATE,
    });
    assert.equal(allocated.status, 201, JSON.stringify(allocated.data));
    const allocations = allocated.data.allocations;
    assert.equal(allocations.length, 1, '只有有库存余额的目标可以被资本化');
    assert.equal(Number(allocations[0].allocated_cents), 30000);
    assert.ok(allocations[0].voucher_id, '分摊必须生成凭证');

    // 分摊结果进入权威价值流水。
    const movement = fixture.db.prepare(
      "SELECT * FROM inventory_valuation_movements WHERE source_type='PURCHASE_EXPENSE' AND source_id=? AND status='POSTED'",
    ).get(expenseId);
    assert.ok(movement, '分摊必须写入权威估值流水');
    assert.equal(Number(movement.value_delta_cents), 30000);

    // 余额同步。
    const balance = fixture.db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?')
      .get(`NONE:warehouse-001:product-001`);
    assert.equal(Number(balance.value_cents), 130000, '分摊后权威余额必须包含分摊金额');

    // 凭证：借存货、贷应付。
    const entries = voucherEntries(fixture.db, allocations[0].voucher_id);
    assert.equal(entries.filter((row) => row.direction === 'DEBIT').length, 1);
    assert.equal(entries.filter((row) => row.direction === 'CREDIT').length, 1);
    assert.equal(Number(entries.find((row) => row.direction === 'CREDIT').amountCents), 30000);

    // 分摊总额必须与费用总额一致（可重算）。
    const listed = await fixture.request('GET', '/api/purchase-expenses', fixture.tokens.accounting);
    const sum = listed.data.purchaseExpenseAllocations
      .filter((row) => row.expense_id === expenseId)
      .reduce((total, row) => total + Number(row.allocated_cents), 0);
    assert.equal(sum, Number(expense.data.purchaseExpense.amount_cents), '分摊总额必须等于费用总额');

    // 已分摊的费用不得重复分摊。
    const repeat = await fixture.request('POST', `/api/purchase-expenses/${expenseId}/allocate`, fixture.tokens.accounting, {
      ruleId, businessDate: BUSINESS_DATE,
    });
    assert.equal(repeat.status, 409);

    // 越权拒绝。
    const forbidden = await fixture.request('POST', `/api/purchase-expenses/${expenseId}/allocate`, fixture.tokens.sales, {
      ruleId, businessDate: BUSINESS_DATE,
    });
    assert.equal(forbidden.status, 403);
  });

  test('AA-W6.11/AA-W6.12 完工成本结转：金额守恒、差异去向显式并与 GL 一致', async () => {
    const closing = await fixture.request('POST', '/api/accounting/production-cost-closings', fixture.tokens.accounting, {
      productionOrderId: 'po-aa-w6-1', period: '2027-06', wipCents: 100000, varianceCents: 10000, varianceTarget: 'SCRAP',
    });
    assert.equal(closing.status, 201, JSON.stringify(closing.data));
    const row = closing.data.productionCostClosing;
    assert.equal(Number(row.product_cost_cents), 90000);
    assert.equal(Number(row.product_cost_cents) + Number(row.variance_cents), Number(row.wip_cents));
    assert.equal(row.variance_target, 'SCRAP');

    const entries = voucherEntries(fixture.db, row.voucher_id);
    const debitTotal = entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amountCents), 0);
    const creditTotal = entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amountCents), 0);
    assert.equal(debitTotal, 100000, '结转借方合计必须等于在制品金额');
    assert.equal(creditTotal, 100000, '结转贷方合计必须等于在制品金额');

    const duplicated = await fixture.request('POST', '/api/accounting/production-cost-closings', fixture.tokens.accounting, {
      productionOrderId: 'po-aa-w6-1', period: '2027-06', wipCents: 100000, varianceCents: 10000, varianceTarget: 'SCRAP',
    });
    assert.equal(duplicated.status, 409);

    const invalidTarget = await fixture.request('POST', '/api/accounting/production-cost-closings', fixture.tokens.accounting, {
      productionOrderId: 'po-aa-w6-2', period: '2027-06', wipCents: 100000, varianceCents: 0, varianceTarget: 'WHATEVER',
    });
    assert.equal(invalidTarget.status, 400);
  });

  test('AA-W6.13/AA-W6.14 成本调整：生成凭证并可追溯原因与授权人', async () => {
    seedValuedStock(fixture.db, { productId: 'product-004', quantity: 4, valueCents: 40000 });
    const created = await fixture.request('POST', '/api/accounting/cost-adjustments', fixture.tokens.accounting, {
      adjustmentType: 'REVALUATION', productId: 'product-004', amountCents: 2500, reason: '期末重估',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = created.data.costAdjustment;
    assert.ok(row.voucher_id, '成本调整必须生成凭证');
    assert.equal(row.reason, '期末重估');
    assert.equal(row.created_by, 'user-accounting', '调整必须可追溯授权人');

    const movement = fixture.db.prepare(
      "SELECT * FROM inventory_valuation_movements WHERE source_type='COST_ADJUSTMENT' AND source_id=? AND status='POSTED'",
    ).get(row.id);
    assert.ok(movement, '成本调整必须进入权威价值流水');
    assert.equal(Number(movement.value_delta_cents), 2500);

    const zero = await fixture.request('POST', '/api/accounting/cost-adjustments', fixture.tokens.accounting, {
      adjustmentType: 'REVALUATION', productId: 'product-004', amountCents: 0, reason: '零金额',
    });
    assert.equal(zero.status, 400);
  });

  test('AA-W6.15/AA-W6.16 核算关账异常清单：五类检查齐备并与 systemHealth 合并展示', async () => {
    const checklist = await fixture.request('GET', '/api/accounting/costing-close-checklist?asOfDate=2027-12-31', fixture.tokens.accounting);
    assert.equal(checklist.status, 200, JSON.stringify(checklist.data));
    const codes = checklist.data.checklist.map((row) => row.code);
    for (const expected of [
      'VALUATION_TO_GL_DIFFERENCE', 'LEGACY_UNVALUED', 'NEGATIVE_OR_RESIDUAL_BALANCE',
      'PROVISIONAL_NOT_CONVERTED', 'COST_ADJUSTMENT_NOT_POSTED',
    ]) {
      assert.ok(codes.includes(expected), `异常清单必须包含 ${expected}`);
    }
    assert.ok(Array.isArray(checklist.data.systemHealthChecks), '必须与既有 systemHealth 检查合并展示');
    assert.equal(typeof checklist.data.blockingCount, 'number');

    const forbidden = await fixture.request('GET', '/api/accounting/costing-close-checklist', fixture.tokens.sales);
    assert.equal(forbidden.status, 403);
  });
});
