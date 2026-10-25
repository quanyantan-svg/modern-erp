// Wave 7 — Sales Prepayment Gate canonical writer.
//
// Implements solution.md §29.16 + document.md §34.3.12.
//
// The gate evaluates three stages: PLANNING_RELEASE / RESERVATION / DELIVERY.
// For each gate evaluation Sales calls the R-SAL-15 finance adapter to acquire
// the canonical V22 PREPAYMENT parent balance lock (`settlement_unapplied_balances.id`
// WHERE balance_type='PREPAYMENT') FOR UPDATE inside the SAME connection/transaction,
// re-reads canonical child effects, computes the remaining eligible amount per
// balance, and emits PASS / WARN / BLOCK / OVERRIDE_REQUIRED.
//
// Sales also owns a Sales-side `sales_prepayment_requirements` snapshot — the
// required amount per SO / line with effective-dating — and records the gate
// decision in `sales_prepayment_gate_results` (idempotent by snapshot_key).
//
// Finance business semantics, Finance canonical balance rows, and Finance
// recognition model are unchanged. Only the bounded locked-read adapter plus
// the matching Finance mutation-path parent-lock acquisition (see
// `sales-prepayment-finance-adapter.js` and `financial-controls.js`) are added.

import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import {
  assertPrepaymentParentPlanCurrent,
  discoverEligiblePrepaymentParents,
  lockEligiblePrepaymentParents,
  resolveEligiblePrepaymentForSalesGate,
} from './sales-prepayment-finance-adapter.js';
import { assertFinancialPeriodsOpen } from './financial-inventory.js';
import { isGateRetryAdmissionExpired, startGateRetryAdmission } from './sales-gate-retry-admission.js';

function now() { return new Date().toISOString(); }

// solution.md §37.8 / §37.24 — bounded OUTER fresh-discovery retry.
//
// The inner retry already lives in transaction() (ERP_DB_TX_RETRY_MAX, a configurable
// safe integer 0..10) and always re-runs work() against the SAME captured plan, so it
// cannot recover a stale plan. This outer loop is the only mechanism that re-discovers.
//
// No nested transaction is created: transaction() is invoked exactly once per outer
// attempt, and a failed attempt has already rolled back before the catch block runs
// (db.js rolls back before rethrowing), so there is never partial state to inherit.
//
// Only two error classes re-enter discovery: a structured parent/requirement plan drift,
// and an exhausted inner concurrency retry. An ordinary business 409 is never retried.
const GATE_REDISCOVERY_CODES = new Set([
  'SALES_PREPAYMENT_LOCK_PLAN_STALE',
  'SALES_PREPAYMENT_PARENT_MISSING',
  'SALES_PREPAYMENT_PARENT_CLOSED',
  'SALES_PREPAYMENT_PARENT_TYPE_UNSUPPORTED',
]);

function gateOuterAttempts() {
  const configured = Number(process.env.ERP_GATE_ATTEMPTS_MAX ?? 3);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3 ? configured : 3;
}

function isGateRediscoveryEligible(error) {
  if (!error) return false;
  if (error.transactionRetryExhausted) return true;
  return GATE_REDISCOVERY_CODES.has(error.code) || GATE_REDISCOVERY_CODES.has(error?.details?.code);
}

// Short synchronous pause between outer attempts. This mirrors waitForTransactionRetry
// in db.js; it is an admission delay, not an execution deadline — no wall-clock
// completion bound is claimed (§37.24).
function waitForGateRediscovery(attempt) {
  const delayMs = Math.min(100, 20 * (2 ** (attempt - 1)));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

const GATE_STAGES = Object.freeze(['PLANNING_RELEASE', 'RESERVATION', 'DELIVERY']);
const GATE_DECISIONS = Object.freeze(['PASS', 'WARN', 'BLOCK', 'OVERRIDE_REQUIRED']);
const RATIO_BASIS = Object.freeze(['LINE_VALUE', 'ORDER_VALUE']);
const IDEMPOTENCY_SCOPE = 'SALES_PREPAYMENT_GATE';

function isIntegerCents(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function isPositiveInteger(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0; }

function effectiveAtNow(effectiveFrom, effectiveTo, nowIso) {
  if (!effectiveFrom && !effectiveTo) return true;
  const currentDate = (nowIso || now()).slice(0, 10);
  if (effectiveFrom && currentDate < String(effectiveFrom).slice(0, 10)) return false;
  if (effectiveTo && currentDate > String(effectiveTo).slice(0, 10)) return false;
  return true;
}

function lookupRequirementForOrder(db, { salesOrderId, lineNo = null, asOf = null }) {
  const rows = db.prepare(`SELECT id, sales_order_id, line_no, required_amount_cents, ratio_basis,
      effective_from, effective_to, created_at, created_by
    FROM sales_prepayment_requirements
    WHERE sales_order_id=?
    ORDER BY (line_no=0) DESC, line_no ASC, created_at ASC`).all(salesOrderId);
  const candidates = rows.filter((row) => (lineNo == null ? row.line_no === 0 : row.line_no === lineNo));
  const effective = (candidates.length ? candidates : rows).filter((row) => effectiveAtNow(row.effective_from, row.effective_to, asOf));
  return effective[candidates.length ? candidates.length - 1 : effective.length - 1] || null;
}

function loadOrder(db, orderId) {
  const row = db.prepare(`SELECT id, order_no, customer_id, status, total_cents, salesperson_id, sales_group_id,
      required_prepayment_cents, commercial_close_state
    FROM sales_orders WHERE id=?`).get(orderId);
  if (!row) throw new HttpError(404, '销售订单不存在');
  return row;
}

function requireSalesGroupScope(db, actor, { salesGroupId, businessDate, documentType = 'SALES_PREPAYMENT' }) {
  if (!salesGroupId) return;
  // Lookup the salesperson profile attached to this actor via users.id, then
  // confirm membership in the requested sales group.
  const salesperson = db.prepare('SELECT id FROM salesperson_profiles WHERE user_id=?').get(actor.id);
  if (salesperson) {
    const member = db.prepare(`SELECT id FROM salesperson_group_memberships
      WHERE salesperson_id=? AND sales_group_id=? AND active=1`).get(salesperson.id, salesGroupId);
    if (member) return;
  }
  if (actor.roleCode === 'ADMIN') return;
  const group = db.prepare('SELECT id, group_code, name FROM sales_groups WHERE id=?').get(salesGroupId);
  throw new HttpError(403, `不在销售组 ${group?.group_code || salesGroupId} 范围内`, { code: 'SALES_GROUP_SCOPE_DENIED' });
}

function snapshotKeyOf({ stage, requestId, gateRequirementId, businessDate }) {
  return `${stage}|${gateRequirementId || 'NONE'}|${businessDate || 'NOW'}|${requestId || ''}`;
}

function decideGate({ eligible, required, previousResult }) {
  // §29.16.1 / §29.16.2 emit decision: PASS / WARN / BLOCK / OVERRIDE_REQUIRED.
  //   PASS               = eligible >= required                (full coverage, proceed)
  //   WARN               = 0 < eligible <  required            (partial coverage, proceed with audit)
  //   BLOCK              = eligible == 0                       (no eligible balance, refuse)
  //   OVERRIDE_REQUIRED  = prior OVERRIDE_REQUIRED carries forward
  //                        until eligibility rises to PASS. Until then, even
  //                        if cumulative `required_remaining_cents` drops to
  //                        0, the explicit human override decision stays.
  if (eligible >= required) return 'PASS';
  if (previousResult && previousResult.gate_decision === 'OVERRIDE_REQUIRED') return 'OVERRIDE_REQUIRED';
  if (eligible > 0) return 'WARN';
  return 'BLOCK';
}

function summarizeGateResult(row) {
  return {
    id: row.id,
    salesOrderId: row.sales_order_id,
    stage: row.stage,
    gateDecision: row.gate_decision,
    requiredRemainingCents: row.required_remaining_cents,
    eligibleAdvanceCents: row.eligible_advance_cents,
    refundedAmountCents: row.refunded_amount_cents,
    appliedAmountCents: row.applied_amount_cents,
    overrideReason: row.override_reason,
    overriddenBy: row.overridden_by,
    sourceBalanceIdentities: JSON.parse(row.source_balance_identities || '[]'),
    snapshotKey: row.snapshot_key,
    evaluatedAt: row.evaluated_at,
    evaluatedBy: row.evaluated_by,
  };
}

function assertPermittedGateRow(row, { stage, salesOrderId, requiredCents }) {
  if (!row) {
    throw new HttpError(409, `预付门 ${stage} 尚未评估`, {
      code: 'SALES_PREPAYMENT_GATE_NOT_EVALUATED',
      stage,
      salesOrderId,
      requiredCents: Number(requiredCents) || 0,
    });
  }
  if (row.gate_decision === 'BLOCK') {
    throw new HttpError(409, `预付门 ${stage} 未通过：当前 eligible 为 0`, {
      code: 'SALES_PREPAYMENT_GATE_BLOCKED',
      stage,
      salesOrderId,
      gateResultId: row.id,
      eligibleCents: row.eligible_advance_cents,
      requiredRemainingCents: row.required_remaining_cents,
    });
  }
  if (row.gate_decision === 'WARN') {
    return {
      state: 'WARN', stage, salesOrderId, gateResultId: row.id,
      eligibleCents: row.eligible_advance_cents,
      requiredRemainingCents: row.required_remaining_cents,
    };
  }
  if (row.gate_decision === 'OVERRIDE_REQUIRED') {
    if (!row.override_reason || !String(row.override_reason).trim()) {
      throw new HttpError(409, `预付门 ${stage} 缺少覆盖原因`, {
        code: 'SALES_PREPAYMENT_GATE_OVERRIDE_MISSING_REASON',
        stage,
        salesOrderId,
        gateResultId: row.id,
      });
    }
    return {
      state: 'OVERRIDE_REQUIRED', stage, salesOrderId, gateResultId: row.id,
      overrideReason: row.override_reason,
      overriddenBy: row.overridden_by,
    };
  }
  return {
    state: 'PASS', stage, salesOrderId, gateResultId: row.id,
    eligibleCents: row.eligible_advance_cents,
    requiredRemainingCents: row.required_remaining_cents,
  };
}

// Mutation-time authorization. The caller MUST already own the transaction
// that will perform the protected Sales mutation. A prior Gate Result is only
// evidence that the stage was explicitly evaluated (and, for an override, the
// approved reason/actor); it is never reused as current monetary authority.
// Finance balances are locked and re-read here, a new evidence row is written,
// and the caller continues with the business mutation before the same COMMIT.
export function authorizeSalesPrepaymentGateForMutation(db, {
  salesOrderId,
  stage,
  businessDate = null,
  actorId,
  mutationKey,
}) {
  if (!GATE_STAGES.includes(stage)) throw new HttpError(400, 'stage 仅支持 PLANNING_RELEASE / RESERVATION / DELIVERY');
  const asOf = businessDate || now().slice(0, 10);
  const requirement = lookupRequirementForOrder(db, { salesOrderId, asOf });
  if (!requirement) return { state: 'NOT_REQUIRED', stage, salesOrderId };

  // solution.md §35.18.6 step 0/1 — unlocked identity discovery only, then the
  // canonical Finance PREPAYMENT parent locks by id ASC. This must precede every
  // Gate requirement/result and Sales business row lock, or Finance mutation paths
  // (which always lock the parent first) can invert the order and deadlock.
  const discoveredOrder = loadOrder(db, salesOrderId);
  lockEligiblePrepaymentParents(db, discoverEligiblePrepaymentParents(db, {
    customerId: discoveredOrder.customer_id, businessDate: asOf,
  }));

  const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const previous = db.prepare(`SELECT * FROM sales_prepayment_gate_results
    WHERE sales_order_id=? AND stage=?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1${lock}`).get(salesOrderId, stage);
  if (!previous) {
    return assertPermittedGateRow(null, {
      stage, salesOrderId, requiredCents: requirement.required_amount_cents,
    });
  }

  // Requirement validity and amount are re-read beneath the same transaction.
  const lockedRequirement = db.prepare(`SELECT * FROM sales_prepayment_requirements WHERE id=?${lock}`).get(requirement.id);
  if (!lockedRequirement || !effectiveAtNow(lockedRequirement.effective_from, lockedRequirement.effective_to, asOf)) {
    return { state: 'NOT_REQUIRED', stage, salesOrderId, reason: 'OUT_OF_EFFECTIVE_RANGE' };
  }
  const order = loadOrder(db, salesOrderId);
  const required = Number(lockedRequirement.required_amount_cents);
  const evidence = resolveEligiblePrepaymentForSalesGate(db, {
    customerId: order.customer_id,
    businessDate: asOf,
    gateStage: stage,
    salesOrderId,
    remainingRequiredCents: required,
    lockMode: 'FOR_UPDATE',
    snapshotKey: mutationKey,
  });
  const decision = decideGate({ eligible: evidence.eligibleAmountCents, required, previousResult: previous });
  const carriesOverride = decision === 'OVERRIDE_REQUIRED';
  const resultId = randomUUID();
  const snapshotKey = String(mutationKey || `MUTATION|${stage}|${salesOrderId}|${resultId}`);
  db.prepare(`INSERT INTO sales_prepayment_gate_results(id, sales_order_id, stage, gate_decision,
    required_remaining_cents, eligible_advance_cents, refunded_amount_cents, applied_amount_cents,
    override_reason, overridden_by, source_balance_identities, snapshot_key, evaluated_at, evaluated_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    resultId, salesOrderId, stage, decision,
    required, evidence.eligibleAmountCents, evidence.refundedAmountCents, evidence.appliedAmountCents,
    carriesOverride ? previous.override_reason : null,
    carriesOverride ? previous.overridden_by : null,
    JSON.stringify(evidence.sourceBalanceIdentities), snapshotKey, now(), actorId,
  );
  audit(db, actorId, 'AUTHORIZE_MUTATION', 'SALES_PREPAYMENT_GATE', resultId, `${order.order_no} ${stage} ${decision}`);
  return assertPermittedGateRow(db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(resultId), {
    stage, salesOrderId, requiredCents: required,
  });
}

export function discoverSalesPrepaymentGatePlan(db, salesOrderId, businessDate = null) {
  const asOf = businessDate || now().slice(0, 10);
  const order = loadOrder(db, salesOrderId);
  const requirement = lookupRequirementForOrder(db, { salesOrderId, asOf });
  return {
    salesOrderId, businessDate: asOf, customerId: order.customer_id,
    orderFingerprint: `${order.id}|${order.customer_id}|${order.status}|${order.total_cents}|${order.sales_group_id || ''}`,
    requirementId: requirement?.id || null,
    requirementFingerprint: requirement ? `${requirement.id}|${requirement.required_amount_cents}|${requirement.effective_from || ''}|${requirement.effective_to || ''}` : 'NONE',
    parentBalanceIds: requirement ? discoverEligiblePrepaymentParents(db, { customerId: order.customer_id, businessDate: asOf }) : [],
  };
}

export function authorizeSalesPrepaymentGateWithPlan(db, plan, {
  stage = 'DELIVERY', actorId, mutationKey, afterParentLock = null,
} = {}) {
  if (!plan?.salesOrderId || !actorId || !mutationKey) throw new HttpError(400, '预付款门计划上下文不完整');
  if (!GATE_STAGES.includes(stage)) throw new HttpError(400, 'stage 无效');
  const currentOrder = loadOrder(db, plan.salesOrderId);
  const orderFingerprint = `${currentOrder.id}|${currentOrder.customer_id}|${currentOrder.status}|${currentOrder.total_cents}|${currentOrder.sales_group_id || ''}`;
  const currentRequirement = lookupRequirementForOrder(db, { salesOrderId: plan.salesOrderId, asOf: plan.businessDate });
  const requirementFingerprint = currentRequirement ? `${currentRequirement.id}|${currentRequirement.required_amount_cents}|${currentRequirement.effective_from || ''}|${currentRequirement.effective_to || ''}` : 'NONE';
  if (orderFingerprint !== plan.orderFingerprint || requirementFingerprint !== plan.requirementFingerprint) {
    throw new HttpError(409, '预付款门计划已过期，请在新事务重试', { code: 'SALES_PREPAYMENT_LOCK_PLAN_STALE' });
  }
  if (!currentRequirement) {
    // No requirement means an empty parent set, so L1 is skipped entirely.
    // The Credit Check still runs and still fails closed when a mandatory
    // profile is missing: the absence of a prepayment requirement never
    // weakens the Credit gate (§36.14.5 M19).
    if (afterParentLock) afterParentLock({ parentBalanceIds: [] });
    return { state: 'NOT_REQUIRED', stage, salesOrderId: plan.salesOrderId };
  }
  // §35.18.6 step 1 — Finance PREPAYMENT parents by id ASC, before the Gate
  // requirement/result rows below. A stale candidate set rolls the caller back.
  lockEligiblePrepaymentParents(db, plan.parentBalanceIds);
  assertPrepaymentParentPlanCurrent(db, {
    customerId: plan.customerId,
    businessDate: plan.businessDate,
  }, plan.parentBalanceIds);
  // §36.14.3 / §37.3 — the Credit Check composes strictly between L1 and L6.
  // It takes no Sales business-row lock and no Finance business-row lock
  // beyond the parent balances already held here.
  if (afterParentLock) afterParentLock({ parentBalanceIds: plan.parentBalanceIds });
  const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const previous = db.prepare(`SELECT * FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage=? ORDER BY evaluated_at DESC,id DESC LIMIT 1${lock}`).get(plan.salesOrderId, stage);
  if (!previous) return assertPermittedGateRow(null, { stage, salesOrderId: plan.salesOrderId, requiredCents: currentRequirement.required_amount_cents });
  const lockedRequirement = db.prepare(`SELECT * FROM sales_prepayment_requirements WHERE id=?${lock}`).get(currentRequirement.id);
  if (!lockedRequirement || !effectiveAtNow(lockedRequirement.effective_from, lockedRequirement.effective_to, plan.businessDate)) {
    throw new HttpError(409, '预付款门要求在锁定后发生变化', { code: 'SALES_PREPAYMENT_LOCK_PLAN_STALE' });
  }
  const required = Number(lockedRequirement.required_amount_cents);
  // Defence in depth after the Gate locks: compare identities again, but never
  // re-enter the Parent FOR UPDATE phase. Finance evidence is a non-locking read
  // beneath the L1 locks already held by this caller-owned transaction.
  assertPrepaymentParentPlanCurrent(db, {
    customerId: plan.customerId,
    businessDate: plan.businessDate,
  }, plan.parentBalanceIds);
  const evidence = resolveEligiblePrepaymentForSalesGate(db, {
    customerId: currentOrder.customer_id, businessDate: plan.businessDate, gateStage: stage,
    salesOrderId: plan.salesOrderId, remainingRequiredCents: required,
    snapshotKey: mutationKey, lockMode: 'NONE',
  });
  const decision = decideGate({ eligible: evidence.eligibleAmountCents, required, previousResult: previous });
  const resultId = randomUUID();
  db.prepare(`INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,required_remaining_cents,eligible_advance_cents,refunded_amount_cents,applied_amount_cents,override_reason,overridden_by,source_balance_identities,snapshot_key,evaluated_at,evaluated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    resultId, plan.salesOrderId, stage, decision, required, evidence.eligibleAmountCents,
    evidence.refundedAmountCents, evidence.appliedAmountCents,
    decision === 'OVERRIDE_REQUIRED' ? previous.override_reason : null,
    decision === 'OVERRIDE_REQUIRED' ? previous.overridden_by : null,
    JSON.stringify(evidence.sourceBalanceIdentities), mutationKey, now(), actorId,
  );
  audit(db, actorId, 'AUTHORIZE_MUTATION', 'SALES_PREPAYMENT_GATE', resultId, `${currentOrder.order_no} ${stage} ${decision}`);
  return assertPermittedGateRow(db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(resultId), { stage, salesOrderId: plan.salesOrderId, requiredCents: required });
}

// ---------- public API ----------

export function listPrepaymentRequirements(db, res, actor, url) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const salesOrderId = url.searchParams.get('salesOrderId');
  const rows = salesOrderId
    ? db.prepare(`SELECT * FROM sales_prepayment_requirements WHERE sales_order_id=? ORDER BY line_no, created_at`).all(salesOrderId)
    : db.prepare(`SELECT * FROM sales_prepayment_requirements ORDER BY created_at DESC LIMIT 500`).all();
  return send(res, 200, { requirements: rows });
}

export function getPrepaymentRequirement(db, res, actor, id) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const row = db.prepare('SELECT * FROM sales_prepayment_requirements WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '预付要求不存在');
  return send(res, 200, row);
}

export async function createPrepaymentRequirement(db, req, res, actor) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const salesOrderId = body.salesOrderId || body.sales_order_id;
  if (!salesOrderId) throw new HttpError(400, 'salesOrderId 必填');
  const lineNo = Number(body.lineNo ?? body.line_no ?? 0);
  if (!Number.isSafeInteger(lineNo) || lineNo < 0) throw new HttpError(400, 'lineNo 必须是非负整数');
  const requiredAmountCents = Number(body.requiredAmountCents ?? body.required_amount_cents);
  if (!isIntegerCents(requiredAmountCents)) throw new HttpError(400, 'requiredAmountCents 必须是非负整数');
  const ratioBasis = String(body.ratioBasis || body.ratio_basis || 'ORDER_VALUE').toUpperCase();
  if (!RATIO_BASIS.includes(ratioBasis)) throw new HttpError(400, 'ratioBasis 仅支持 LINE_VALUE / ORDER_VALUE');
  const effectiveFrom = body.effectiveFrom || body.effective_from || null;
  const effectiveTo = body.effectiveTo || body.effective_to || null;
  const businessDate = body.businessDate || body.business_date || now().slice(0, 10);
  const order = loadOrder(db, salesOrderId);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate });
  const stamp = now();
  const id = randomUUID();
  transaction(db, () => {
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents,
      ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, salesOrderId, lineNo, requiredAmountCents, ratioBasis, effectiveFrom, effectiveTo, stamp, actor.id);
    audit(db, actor.id, 'CREATE', 'SALES_PREPAYMENT_REQUIREMENT', id, `${order.order_no} ${requiredAmountCents}`);
  });
  return send(res, 201, { id });
}

export async function updatePrepaymentRequirement(db, req, res, actor, id) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const row = db.prepare('SELECT * FROM sales_prepayment_requirements WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '预付要求不存在');
  const order = loadOrder(db, row.sales_order_id);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  const requiredAmountCents = Number(body.requiredAmountCents ?? row.required_amount_cents);
  if (!isIntegerCents(requiredAmountCents)) throw new HttpError(400, 'requiredAmountCents 必须是非负整数');
  const ratioBasis = String(body.ratioBasis || row.ratio_basis || 'ORDER_VALUE').toUpperCase();
  if (!RATIO_BASIS.includes(ratioBasis)) throw new HttpError(400, 'ratioBasis 仅支持 LINE_VALUE / ORDER_VALUE');
  const effectiveFrom = body.effectiveFrom ?? row.effective_from;
  const effectiveTo = body.effectiveTo ?? row.effective_to;
  transaction(db, () => {
    db.prepare(`UPDATE sales_prepayment_requirements
      SET required_amount_cents=?, ratio_basis=?, effective_from=?, effective_to=?
      WHERE id=?`).run(requiredAmountCents, ratioBasis, effectiveFrom, effectiveTo, id);
    audit(db, actor.id, 'UPDATE', 'SALES_PREPAYMENT_REQUIREMENT', id, `${requiredAmountCents}`);
  });
  return send(res, 200, { id, requiredAmountCents, ratioBasis, effectiveFrom, effectiveTo });
}

export async function evaluateSalesPrepaymentGate(db, req, res, actor, salesOrderId, stage) {
  allow(actor, 'SALES_MANAGE');
  if (!salesOrderId) throw new HttpError(400, 'salesOrderId 必填');
  if (!GATE_STAGES.includes(stage)) throw new HttpError(400, 'stage 仅支持 PLANNING_RELEASE / RESERVATION / DELIVERY');
  const body = await readJson(req);
  // solution.md §37.2 phase 0 — unlocked discovery, no business-object lock. `asOf`
  // is bound ONCE so the period check, requirement lookup, parent discovery and the
  // Finance evidence all read one business date for this evaluation.
  const asOf = body.businessDate || now().slice(0, 10);
  const order = loadOrder(db, salesOrderId);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: asOf });
  const requirement = lookupRequirementForOrder(db, { salesOrderId, asOf });
  if (!requirement) throw new HttpError(409, '请先维护预付要求', { code: 'SALES_PREPAYMENT_REQUIREMENT_MISSING' });
  const appliedSnapshotKey = String(body.snapshotKey || body.snapshot_key || snapshotKeyOf({
    stage,
    requestId: body.requestId,
    gateRequirementId: requirement.id,
    businessDate: body.businessDate,
  }));
  const overrideReason = body.overrideReason || null;

  // Preserve exact replay before starting the request-scoped admission clock.
  // The transaction-local probe below remains authoritative for a concurrent
  // request that commits after this read-only probe.
  const committedReplay = db.prepare(`SELECT * FROM sales_prepayment_gate_results
    WHERE snapshot_key=? AND sales_order_id=? AND stage=?`).get(appliedSnapshotKey, salesOrderId, stage);
  if (committedReplay) {
    return send(res, 200, { ...summarizeGateResult(committedReplay), replayed: true });
  }

  let result;
  const maxAttempts = gateOuterAttempts();
  const admission = startGateRetryAdmission(process.env.ERP_GATE_ATTEMPTS_BUDGET_MS);
  let attemptsStarted = 0;
  const deadlineExhausted = () => new HttpError(503, '预付款门评估重试次数已耗尽，请稍后重试', {
    code: 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED',
    retryable: true,
    attempts: attemptsStarted,
    cause: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
  });
  for (;;) {
    if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
    attemptsStarted += 1;
    const attempt = attemptsStarted;
    // Fresh authoritative discovery on EVERY outer attempt. A plan is never reused
    // across attempts even though transaction() may have retried internally.
    const plan = discoverSalesPrepaymentGatePlan(db, salesOrderId, asOf);
    try {
      transaction(db, () => {
        const replay = db.prepare(`SELECT * FROM sales_prepayment_gate_results
          WHERE sales_order_id=? AND stage=? AND snapshot_key=?`).get(salesOrderId, stage, appliedSnapshotKey);
        if (replay) {
          result = summarizeGateResult(replay);
          result.replayed = true;
          return;
        }
        assertFinancialPeriodsOpen(db, asOf);
        const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
        // L1 — canonical Finance PREPAYMENT parents by id ASC, before any Gate row lock.
        lockEligiblePrepaymentParents(db, plan.parentBalanceIds);
        // Candidate-set freshness, checked immediately after the parent locks: a parent
        // that appeared, disappeared or closed since discovery fails closed instead of
        // being silently absorbed.
        assertPrepaymentParentPlanCurrent(db, { customerId: plan.customerId, businessDate: asOf }, plan.parentBalanceIds);
        // L6 — Gate Result, then L7 — Gate Requirement, matching the Path B/B' order.
        const previous = db.prepare(`SELECT * FROM sales_prepayment_gate_results
          WHERE sales_order_id=? AND stage=? ORDER BY evaluated_at DESC, id DESC LIMIT 1${lock}`).get(salesOrderId, stage);
        const currentRequirementId = lookupRequirementForOrder(db, { salesOrderId, asOf })?.id || null;
        const lockedRequirement = currentRequirementId
          ? db.prepare(`SELECT * FROM sales_prepayment_requirements WHERE id=?${lock}`).get(currentRequirementId)
          : null;
        // Requirement identity, amount and effective window must still match the plan
        // this attempt locked against, otherwise the Gate decision would be computed
        // against a requirement that changed mid-attempt.
        const lockedFingerprint = lockedRequirement
          ? `${lockedRequirement.id}|${lockedRequirement.required_amount_cents}|${lockedRequirement.effective_from || ''}|${lockedRequirement.effective_to || ''}`
          : 'NONE';
        if (!lockedRequirement || !effectiveAtNow(lockedRequirement.effective_from, lockedRequirement.effective_to, asOf)
          || lockedFingerprint !== plan.requirementFingerprint) {
          throw new HttpError(409, '预付款门要求在锁定后发生变化', { code: 'SALES_PREPAYMENT_LOCK_PLAN_STALE' });
        }
        // Finance child effects read beneath the parent locks. lockMode NONE on purpose:
        // the parents are already held, so this must not re-enter the parent-lock phase
        // after the Gate locks (§37.2 step D8).
        const required = Number(lockedRequirement.required_amount_cents);
        const evidence = resolveEligiblePrepaymentForSalesGate(db, {
          customerId: plan.customerId,
          businessDate: asOf,
          gateStage: stage,
          salesOrderId,
          remainingRequiredCents: required,
          lockMode: 'NONE',
          snapshotKey: appliedSnapshotKey,
        });
        let decision = decideGate({
          eligible: evidence.eligibleAmountCents,
          required,
          previousResult: previous,
        });
        if (overrideReason && previous?.gate_decision === 'OVERRIDE_REQUIRED' && decision !== 'PASS') {
          decision = 'OVERRIDE_REQUIRED';
        }
        const newRowId = randomUUID();
        db.prepare(`INSERT INTO sales_prepayment_gate_results(id, sales_order_id, stage, gate_decision,
          required_remaining_cents, eligible_advance_cents, refunded_amount_cents, applied_amount_cents,
          override_reason, overridden_by, source_balance_identities, snapshot_key, evaluated_at, evaluated_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          newRowId, salesOrderId, stage, decision,
          required, evidence.eligibleAmountCents, evidence.refundedAmountCents, evidence.appliedAmountCents,
          overrideReason, overrideReason ? actor.id : null, JSON.stringify(evidence.sourceBalanceIdentities), appliedSnapshotKey, now(), actor.id,
        );
        audit(db, actor.id, 'EVALUATE', 'SALES_PREPAYMENT_GATE', newRowId, `${order.order_no} ${stage} ${decision}`);
        result = summarizeGateResult(db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(newRowId));
      });
      break;
    } catch (error) {
      // A business rejection (missing requirement, group scope, bad stage, ...) is a
      // final answer and is never retried. Only plan drift and exhausted concurrency
      // re-enter discovery, and only within the bounded attempt count.
      const rawCause = error?.details?.code || error?.code;
      // An unsupported Parent type is a persistent business rejection, not a plan
      // that can converge through rediscovery. Preserve its original 409 contract.
      if (rawCause === 'SALES_PREPAYMENT_PARENT_TYPE_UNSUPPORTED') throw error;
      if (!isGateRediscoveryEligible(error)) throw error;
      if (attempt >= maxAttempts) {
        let cause = [
          'SALES_PREPAYMENT_LOCK_PLAN_STALE',
          'SALES_PREPAYMENT_PARENT_MISSING',
          'SALES_PREPAYMENT_PARENT_CLOSED',
          'ER_LOCK_DEADLOCK',
          'ER_LOCK_WAIT_TIMEOUT',
        ].includes(rawCause) ? rawCause : null;
        if (!cause && error?.errno === 1213) cause = 'ER_LOCK_DEADLOCK';
        if (!cause && error?.errno === 1205) cause = 'ER_LOCK_WAIT_TIMEOUT';
        if (!cause && error?.sqlState === '40001') cause = '40001';
        // Every approved retryable source has a stable structured code. Refuse to
        // expose exception text or internal SQL if a malformed error lacks one.
        if (!cause) throw error;
        throw new HttpError(503, '预付款门评估重试次数已耗尽，请稍后重试', {
          code: 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED',
          retryable: true,
          attempts: attempt,
          cause,
        });
      }
      if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
      waitForGateRediscovery(attempt);
    }
  }
  // The success response is emitted only after the transaction has durably committed,
  // so a rollback or retry can never deliver a 2xx for work that did not happen.
  return send(res, result.replayed ? 200 : 201, result);
}

export function listPrepaymentGateResults(db, res, actor, url) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const salesOrderId = url.searchParams.get('salesOrderId');
  const stage = url.searchParams.get('stage');
  const where = [];
  const args = [];
  if (salesOrderId) { where.push('sales_order_id=?'); args.push(salesOrderId); }
  if (stage) { where.push('stage=?'); args.push(stage); }
  const rows = db.prepare(`SELECT * FROM sales_prepayment_gate_results
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY evaluated_at DESC LIMIT 500`).all(...args);
  return send(res, 200, { results: rows.map(summarizeGateResult) });
}

export function getPrepaymentGateResult(db, res, actor, id) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const row = db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '预付门结果不存在');
  return send(res, 200, summarizeGateResult(row));
}

export async function overridePrepaymentGateResult(db, req, res, actor, id) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, '请填写覆盖原因');
  const row = db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '预付门结果不存在');
  if (row.gate_decision === 'PASS') throw new HttpError(409, '通过的预付门不能覆盖');
  const order = loadOrder(db, row.sales_order_id);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  transaction(db, () => {
    // An OVERRIDE_REQUIRED consumes the remaining gap: the cumulative
    // required_remaining_cents becomes 0 so subsequent re-evaluations with a
    // different snapshot_key do not underflow to PASS via previous.required_remaining.
    db.prepare(`UPDATE sales_prepayment_gate_results
      SET gate_decision='OVERRIDE_REQUIRED', override_reason=?, overridden_by=?, required_remaining_cents=0
      WHERE id=?`).run(reason, actor.id, id);
    audit(db, actor.id, 'OVERRIDE', 'SALES_PREPAYMENT_GATE', id, reason);
  });
  return send(res, 200, summarizeGateResult(db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(id)));
}

// assertSalesPrepaymentGateAtStage enforces the gate decision at a business
// entry point. The current persisted result for (sales_order_id, stage) must
// be PASS or OVERRIDE_REQUIRED (with non-empty override_reason). The helper
// refuses with a 409 + descriptive code otherwise. The caller MUST be inside
// an open transaction (we acquire FOR UPDATE on the latest gate-result row
// beneath the same lock chain).
//
// If the Sales Order has no `required_prepayment_cents` requirement row at
// all, the gate is not configured and the assertion is a no-op (no-op for
// orders that don't opt in to prepayment). If a requirement exists but no
// evaluation result is persisted yet, the assertion refuses with
// GATE_NOT_EVALUATED.
export function assertSalesPrepaymentGateAtStage(db, salesOrderId, stage, { businessDate = null, currentActorId = null } = {}) {
  const requirement = lookupRequirementForOrder(db, { salesOrderId });
  if (!requirement) return { state: 'NOT_REQUIRED', stage, salesOrderId };
  const asOf = businessDate || now().slice(0, 10);
  if (!effectiveAtNow(requirement.effective_from, requirement.effective_to, asOf)) {
    return { state: 'NOT_REQUIRED', stage, salesOrderId, reason: 'OUT_OF_EFFECTIVE_RANGE' };
  }
  // Lock + re-read the latest gate result row for this stage. snapshot_key
  // idempotency prevents stale PASS from satisfying the gate twice (§29.16.4).
  const lockMode = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM sales_prepayment_gate_results
    WHERE sales_order_id=? AND stage=?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1${lockMode}`).get(salesOrderId, stage);
  return assertPermittedGateRow(row, {
    stage, salesOrderId, requiredCents: requirement.required_amount_cents,
  });
}

export function __salesPrepaymentGateInternals() {
  return {
    GATE_STAGES,
    GATE_DECISIONS,
    RATIO_BASIS,
    IDEMPOTENCY_SCOPE,
    isIntegerCents,
    isPositiveInteger,
    effectiveAtNow,
    lookupRequirementForOrder,
    loadOrder,
    requireSalesGroupScope,
    snapshotKeyOf,
    decideGate,
    summarizeGateResult,
    assertPermittedGateRow,
    assertSalesPrepaymentGateAtStage,
    authorizeSalesPrepaymentGateForMutation,
  };
}
