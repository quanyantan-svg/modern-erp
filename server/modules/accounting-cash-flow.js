// Accounting & Analytics Domain Closure — AA-W3 cash-flow statement.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.3 (AA-29)
// Design:    docs/design/accounting-analytics.md §31.3.4
//
// Single responsibility: 现金流量表（主表）+ 与资金子账的同口径对账。
//
// Contracts:
//   - AA-W3.8  现金流量分类挂在分录行；未指定分类的现金 / 银行分录必须
//              **显式** 出现在「未分类 / 差异」组，不得被静默排除。
//   - AA-W3.9  只取 `status='POSTED'` 的凭证，期间口径与资产负债表、利润表一致。
//   - AA-W3.10 现金及现金等价物净增加额必须与资金子账
//              (`settlement_account_movements`) 同期间同口径对账，差异可解释。
//
// Boundaries:
//   - This module never mutates the ledger. It is a pure read model.
//   - It never uses the cash journal (`/api/cash-journals`) as a substitute;
//     the cash-flow statement is derived from posted GL entries only.

import { HttpError, allow, send } from '../lib/http.js';

export const CASH_FLOW_CATEGORY_NAMES = Object.freeze({
  OPERATING: '经营活动现金流量',
  INVESTING: '投资活动现金流量',
  FINANCING: '筹资活动现金流量',
});

export const CASH_FLOW_CATEGORY_ORDER = Object.freeze(['OPERATING', 'INVESTING', 'FINANCING']);

// The treasury roles that hold cash and cash equivalents. The mapping is
// read from `account_role_mappings` — never hardcoded subject codes.
const TREASURY_ROLES = Object.freeze(['CASH', 'BANK']);

function signedAmount(entry) {
  const amount = entry.cash_flow_amount_cents === null || entry.cash_flow_amount_cents === undefined
    ? Number(entry.amountCents || 0)
    : Number(entry.cashFlowAmountCents || 0);
  return entry.direction === 'DEBIT' ? amount : -amount;
}

function treasurySubjectIds(db) {
  const rows = db.prepare(
    `SELECT DISTINCT m.subject_id subjectId FROM account_role_mappings m
     JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1
     WHERE m.role_code IN (${TREASURY_ROLES.map(() => '?').join(',')})`,
  ).all(...TREASURY_ROLES);
  return new Set(rows.map((row) => row.subjectId));
}

/**
 * AA-W3.9 — every posted entry of the period, with the cash-flow dimension
 * and the treasury flag resolved. Only POSTED vouchers are read.
 */
function loadEntries(db, period) {
  return db.prepare(`
    SELECT e.id, e.voucher_id voucherId, e.subject_id subjectId, e.direction,
           e.amount_cents amountCents, e.summary,
           e.cash_flow_category cashFlowCategory, e.cash_flow_item cashFlowItem,
           e.cash_flow_amount_cents cashFlowAmountCents,
           s.code subjectCode, s.name subjectName,
           v.voucher_no voucherNo, v.business_date businessDate, v.voucher_date voucherDate
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id=e.voucher_id
    JOIN accounting_subjects s ON s.id=e.subject_id
    WHERE v.status='POSTED' AND v.period=?
    ORDER BY e.voucher_id, e.line_no, e.id
  `).all(period);
}

/**
 * AA-W3.9 / AA-W3.10 — build the cash-flow statement for one period.
 */
export function buildCashFlowStatement(db, period) {
  const entries = loadEntries(db, period);
  const treasurySubjects = treasurySubjectIds(db);

  const sections = new Map(CASH_FLOW_CATEGORY_ORDER.map((category) => [category, new Map()]));
  const unclassifiedItems = [];
  let classifiedTotalCents = 0;
  let unclassifiedTotalCents = 0;
  let glCashNetCents = 0;
  let classifiedCashNetCents = 0;

  for (const entry of entries) {
    const isTreasury = treasurySubjects.has(entry.subjectId);
    const signed = signedAmount(entry);
    if (isTreasury) glCashNetCents += signed;

    const category = entry.cashFlowCategory ? String(entry.cashFlowCategory).toUpperCase() : null;
    if (category && !CASH_FLOW_CATEGORY_ORDER.includes(category)) {
      // An unknown category is a data defect; it must be visible, not silent.
      unclassifiedItems.push({
        voucherId: entry.voucherId,
        voucherNo: entry.voucherNo,
        subjectCode: entry.subjectCode,
        subjectName: entry.subjectName,
        summary: entry.summary,
        amountCents: signed,
        reason: 'UNKNOWN_CATEGORY:' + category,
      });
      if (isTreasury) unclassifiedTotalCents += signed;
      continue;
    }
    if (category) {
      classifiedTotalCents += signed;
      if (isTreasury) classifiedCashNetCents += signed;
      const items = sections.get(category);
      const itemKey = entry.cashFlowItem || '未指定项目';
      items.set(itemKey, (items.get(itemKey) || 0) + signed);
      continue;
    }
    if (isTreasury) {
      // AA-W3.8 — an unclassified cash entry is explicitly reported.
      unclassifiedItems.push({
        voucherId: entry.voucherId,
        voucherNo: entry.voucherNo,
        subjectCode: entry.subjectCode,
        subjectName: entry.subjectName,
        summary: entry.summary,
        amountCents: signed,
        reason: 'NOT_CLASSIFIED',
      });
      unclassifiedTotalCents += signed;
    }
  }

  const treasuryNetCents = Number(db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN direction='OUT' THEN -amount_cents ELSE amount_cents END),0) n FROM settlement_account_movements WHERE business_date>=? AND business_date<=?",
  ).get(period + '-01', period + '-31').n);

  const differenceCents = glCashNetCents - treasuryNetCents;

  const sectionPayload = CASH_FLOW_CATEGORY_ORDER.map((category) => {
    const items = sections.get(category);
    const rows = [...items.entries()].map(([item, amountCents]) => ({ item, amountCents }));
    return {
      category,
      name: CASH_FLOW_CATEGORY_NAMES[category],
      items: rows,
      totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    };
  });

  const unclassifiedRows = unclassifiedItems.map((row) => ({ ...row }));
  if (differenceCents !== 0) {
    unclassifiedRows.push({
      item: '资金子账差异',
      amountCents: differenceCents,
      reason: 'CASH_FLOW_TO_TREASURY',
    });
  }

  return {
    period,
    sections: sectionPayload,
    classifiedTotalCents,
    unclassified: {
      items: unclassifiedRows,
      totalCents: unclassifiedTotalCents + differenceCents,
    },
    // 现金及现金等价物净增加额（GL 口径）。
    cashMovementNetCents: glCashNetCents,
    // 分类命中现金科目的净额（用于解释「已分类」与「现金净增加额」的关系）。
    classifiedCashNetCents,
    treasuryNetCents,
    reconciliation: {
      code: 'CASH_FLOW_TO_TREASURY',
      differenceCents,
      passed: differenceCents === 0,
      explanation: differenceCents === 0
        ? '现金及现金等价物净增加额与资金子账一致'
        : '现金及现金等价物净增加额与资金子账相差 ' + differenceCents + ' 分，差异已计入「未分类 / 差异」行',
    },
  };
}

/**
 * AA-W3.9 — the HTTP entry point.
 */
export function getCashFlow(db, res, actor, url) {
  allow(actor, 'CASH_FLOW_VIEW');
  const period = url.searchParams.get('period');
  if (!period) throw new HttpError(400, '请指定期间，格式: YYYY-MM', { code: 'CASH_FLOW_PERIOD_REQUIRED' });
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, '期间格式应为 YYYY-MM', { code: 'CASH_FLOW_PERIOD_INVALID' });
  }
  return send(res, 200, buildCashFlowStatement(db, period));
}
