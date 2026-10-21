// Wave 7 — Sales × Finance R-SAL-15 bounded integration contract extension.
//
// solution.md §29.16 / document.md §34.3.12 — Prepayment Gate must read ONE
// canonical Finance-side eligible prepayment value AND acquire the canonical
// Finance balance locks in the SAME database connection/transaction as the
// Sales gate mutation.
//
// Canonical parent balance lock identity (Final Two-Point Closure):
//   settlement_unapplied_balances.id   WHERE balance_type = 'PREPAYMENT'
//
// This adapter:
//   1. resolves eligible PREPAYMENT balance rows for a customer / business_date,
//   2. acquires FOR UPDATE on the canonical parent balance rows (lexicographic
//      by id order for stable dead-lock avoidance),
//   3. re-reads canonical child effects (balance_applications / financial_refunds
//      / applicable reversal effects) beneath the parent locks,
//   4. calculates per-balance remaining eligible amount per §29.16.3.2,
//   5. returns evidence for the Sales gate writer to record and decide.
//
// Finance business semantics are unchanged. Finance canonical balance rows are
// unchanged. Only the bounded Sales locked-read adapter is added. Finance
// mutation paths that reduce remaining eligible prepayment (applyUnappliedBalance,
// createRefund, reverseSettlementDocument PREPAYMENT/UNAPPLIED reduction) are
// also extended to acquire the same parent lock so the Sales gate and the
// Finance mutation serialize on the same canonical balance identity.

import { HttpError } from '../lib/http.js';

const PREPAYMENT_BALANCE_TYPES = Object.freeze(['PREPAYMENT']);
const REVERSAL_STATUSES = Object.freeze(['POSTED', 'CONFIRMED']);
const DECISION_HINT = Object.freeze({
  OK: 'OK',
  WATCH: 'WATCH',
  NOT_OK: 'NOT_OK',
});

function isFiniteCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function lockSuffix(db) {
  return db.dialect === 'mysql' ? ' FOR UPDATE' : '';
}

function lockParentBalances(db, balanceIds) {
  if (!balanceIds.length) return;
  const ordered = [...new Set(balanceIds)].sort();
  for (const id of ordered) {
    const row = db.prepare(`SELECT id, status, side, balance_type FROM settlement_unapplied_balances WHERE id=?${lockSuffix(db)}`).get(id);
    if (!row) throw new HttpError(409, `结算余额不存在: ${id}`);
    if (row.status !== 'OPEN') throw new HttpError(409, `结算余额已关闭: ${id}`);
    if (!PREPAYMENT_BALANCE_TYPES.includes(row.balance_type)) {
      throw new HttpError(409, `结算余额类型不支持预付门: ${row.balance_type}`);
    }
  }
}

function readEligibleBalances(db, { customerId, businessDate }) {
  const rows = db.prepare(`SELECT id, side, balance_type, party_id, source_type, source_id, source_no,
      original_amount_cents, business_date, settlement_account_id, status, created_by, created_at
    FROM settlement_unapplied_balances
    WHERE balance_type='PREPAYMENT' AND status='OPEN' AND party_id=? AND business_date<=?
    ORDER BY business_date, created_at, id`).all(customerId, businessDate);
  return rows;
}

export function discoverEligiblePrepaymentParents(db, { customerId, businessDate }) {
  return readEligibleBalances(db, { customerId, businessDate }).map((row) => row.id).sort();
}

// §35.18.6 phase 1/2 split. `lockEligiblePrepaymentParents` must be the FIRST
// row lock any Sales gate path takes: Finance PREPAYMENT parents are locked
// before any Gate requirement/result or Sales business row. `resolveEligiblePrepaymentWithParentPlan`
// then re-reads the eligible set beneath those locks and refuses a stale plan
// instead of silently locking a parent that appeared after discovery.
export function lockEligiblePrepaymentParents(db, plannedParentIds) {
  const planned = [...new Set(plannedParentIds || [])].sort();
  lockParentBalances(db, planned);
  return planned;
}

export function assertPrepaymentParentPlanCurrent(db, input, planned) {
  const currentIds = readEligibleBalances(db, input).map((row) => row.id).sort();
  if (JSON.stringify(planned) !== JSON.stringify(currentIds)) {
    throw new HttpError(409, '预付款父级锁计划已过期，请在新事务重试', {
      code: 'SALES_PREPAYMENT_LOCK_PLAN_STALE', plannedParentIds: planned, currentParentIds: currentIds,
    });
  }
  return planned;
}

export function resolveEligiblePrepaymentWithParentPlan(db, input, plannedParentIds) {
  const planned = lockEligiblePrepaymentParents(db, plannedParentIds);
  assertPrepaymentParentPlanCurrent(db, input, planned);
  return resolveEligiblePrepaymentForSalesGate(db, { ...input, lockMode: 'NONE' });
}

function readAppliedCents(db, balanceId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'`).get(balanceId).n);
}

function readRefundedCents(db, balanceId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'`).get(balanceId).n);
}

function readReversalCents(db, balanceId) {
  // Settlement-reversal components that reduce eligible prepayment (V22 §33).
  // The canonical UNAPPLIED-reduction path in the frozen V22 is
  // `settlement_reversal_items` rows with component_type='UNAPPLIED' whose
  // `original_component_id` points back at the `settlement_unapplied_balances.id`.
  // The companion `settlement_reversals.status` must be 'CONFIRMED' for the
  // reduction to be authoritative.
  return Number(db.prepare(`SELECT COALESCE(SUM(sri.amount_cents),0) n
    FROM settlement_reversal_items sri
    JOIN settlement_reversals sr ON sr.id = sri.reversal_id
    WHERE sri.component_type='UNAPPLIED'
      AND sri.original_component_id=?
      AND sr.status='CONFIRMED'`).get(balanceId)?.n || 0);
}

function remainingEligible(original, applied, refunded, reversal) {
  const remaining = Number(original) - Number(applied) - Number(refunded) - Number(reversal);
  return Math.max(0, remaining);
}

function decideHint(eligible, requiredRemaining) {
  if (eligible >= requiredRemaining) return DECISION_HINT.OK;
  return DECISION_HINT.NOT_OK;
}

export function resolveEligiblePrepaymentForSalesGate(db, {
  customerId,
  businessDate,
  gateStage,
  salesOrderId,
  remainingRequiredCents,
  lockMode = 'FOR_UPDATE',
  snapshotKey = null,
}) {
  if (!customerId) throw new HttpError(400, 'customerId 必填');
  if (!businessDate) throw new HttpError(400, 'businessDate 必填');
  if (!gateStage) throw new HttpError(400, 'gateStage 必填');
  if (!isFiniteCents(Number(remainingRequiredCents))) throw new HttpError(400, 'remainingRequiredCents 必填正整数');

  const balances = readEligibleBalances(db, { customerId, businessDate });
  const balanceIds = balances.map((row) => row.id);

  if (lockMode === 'FOR_UPDATE') {
    lockParentBalances(db, balanceIds);
  }

  const evidenceRows = [];
  let eligibleTotal = 0;
  let appliedTotal = 0;
  let refundedTotal = 0;
  for (const balance of balances) {
    const applied = lockMode === 'FOR_UPDATE' ? readAppliedCents(db, balance.id) : readAppliedCents(db, balance.id);
    const refunded = readRefundedCents(db, balance.id);
    const reversal = readReversalCents(db, balance.id);
    const remaining = remainingEligible(balance.original_amount_cents, applied, refunded, reversal);
    eligibleTotal += remaining;
    appliedTotal += applied;
    refundedTotal += refunded;
    evidenceRows.push({
      balanceId: balance.id,
      sourceType: balance.source_type,
      sourceId: balance.source_id,
      originalAmountCents: Number(balance.original_amount_cents),
      appliedAmountCents: Number(applied),
      refundedAmountCents: Number(refunded),
      reversalAmountCents: Number(reversal),
      remainingEligibleCents: Number(remaining),
      businessDate: balance.business_date,
    });
  }
  const required = Number(remainingRequiredCents);
  const decisionHint = decideHint(eligibleTotal, required);

  return {
    customerId,
    businessDate,
    gateStage,
    salesOrderId,
    remainingRequiredCents: required,
    eligibleAmountCents: eligibleTotal,
    appliedAmountCents: appliedTotal,
    refundedAmountCents: refundedTotal,
    remainingEligibleCents: eligibleTotal,
    sourceBalanceIdentities: evidenceRows,
    decisionHint,
    contractVersion: 'V22-R-SAL-15-WAVE7',
    snapshotKey: snapshotKey || null,
    locked: lockMode === 'FOR_UPDATE',
  };
}

// ------------- Finance mutation paths (bounded extension) -------------

// acquireParentBalanceLock must be called at the very start of any Finance
// mutation path that reduces remaining eligible PREPAYMENT. It acquires the
// canonical V22 parent balance lock (settlement_unapplied_balances.id) FOR UPDATE
// in the SAME connection/transaction. The caller MUST already be inside a
// transaction — we do not open one here.
//
// Real call-chain audit (2026-10-18):
//   applyUnappliedBalance          server/modules/financial-controls.js
//   createRefund                   server/modules/financial-controls.js
//   reverseSettlementDocument      server/modules/settlement.js
//     (UNAPPLIED component only; ALLOCATION components do not touch PREPAYMENT)
// `reverseOperationalReturn` in financial-controls.js reduces CREDIT balances
// (credit_reversal_components) and is NOT a PREPAYMENT-eligible reduction path,
// so it intentionally does not invoke this helper.
export function acquireParentBalanceLock(db, balanceId) {
  if (!balanceId) throw new HttpError(400, 'balanceId 必填');
  const row = db.prepare(`SELECT id, status, balance_type FROM settlement_unapplied_balances WHERE id=?${lockSuffix(db)}`).get(balanceId);
  if (!row) throw new HttpError(409, `结算余额不存在: ${balanceId}`);
  if (row.status !== 'OPEN') throw new HttpError(409, `结算余额已关闭: ${balanceId}`);
  if (!PREPAYMENT_BALANCE_TYPES.includes(row.balance_type)) return null;
  return row;
}

export function __salesPrepaymentFinanceAdapterInternals() {
  return {
    PREPAYMENT_BALANCE_TYPES,
    REVERSAL_STATUSES,
    DECISION_HINT,
    isFiniteCents,
    lockSuffix,
    lockParentBalances,
    readEligibleBalances,
    readAppliedCents,
    readRefundedCents,
    readReversalCents,
    remainingEligible,
    decideHint,
  };
}
