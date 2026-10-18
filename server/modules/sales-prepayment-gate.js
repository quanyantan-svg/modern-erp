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
import { resolveEligiblePrepaymentForSalesGate } from './sales-prepayment-finance-adapter.js';
import { assertFinancialPeriodsOpen } from './financial-inventory.js';

function now() { return new Date().toISOString(); }

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
  const order = loadOrder(db, salesOrderId);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  const requirement = lookupRequirementForOrder(db, { salesOrderId });
  if (!requirement) throw new HttpError(409, '请先维护预付要求', { code: 'SALES_PREPAYMENT_REQUIREMENT_MISSING' });
  const appliedSnapshotKey = String(body.snapshotKey || body.snapshot_key || snapshotKeyOf({
    stage,
    requestId: body.requestId,
    gateRequirementId: requirement.id,
    businessDate: body.businessDate,
  }));
  const overrideReason = body.overrideReason || null;

  let result;
  transaction(db, () => {
    const replay = db.prepare(`SELECT * FROM sales_prepayment_gate_results
      WHERE sales_order_id=? AND stage=? AND snapshot_key=?`).get(salesOrderId, stage, appliedSnapshotKey);
    if (replay) {
      result = summarizeGateResult(replay);
      result.replayed = true;
      send(res, 200, result);
      return;
    }
    assertFinancialPeriodsOpen(db, body.businessDate || now().slice(0, 10));
    // Acquire FOR UPDATE on the Sales-side requirement row.
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    db.prepare(`SELECT id FROM sales_prepayment_requirements WHERE id=?${lock}`).get(requirement.id);
    const previous = db.prepare(`SELECT * FROM sales_prepayment_gate_results
      WHERE sales_order_id=? AND stage=? ORDER BY evaluated_at DESC, id DESC LIMIT 1${lock}`).get(salesOrderId, stage);
    // Call the R-SAL-15 finance adapter (with FOR UPDATE). The adapter acquires the
    // canonical V22 PREPAYMENT parent balance locks in this same transaction.
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: order.customer_id,
      businessDate: body.businessDate || now().slice(0, 10),
      gateStage: stage,
      salesOrderId,
      remainingRequiredCents: Number(requirement.required_amount_cents),
      lockMode: 'FOR_UPDATE',
      snapshotKey: appliedSnapshotKey,
    });
    const required = Number(requirement.required_amount_cents);
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
    send(res, 201, result);
  });
  return undefined;
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
