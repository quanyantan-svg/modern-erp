// Wave 10 — Sales & Customer Credit Special Approval.
//
// solution.md §36.6.6 contract, §29.26 physical contract and document.md
// §34.7 P4 (a Credit Special Approval needs a bounded authority that is
// separate from the standard approval).
//
// The approval is an append-only, per-scope exception:
//
//   - it binds to exactly one scope of one logical Credit Check
//     (`UNIQUE (source_credit_check_result_id)`);
//   - it is bound to the exact `(credit_policy_snapshots.id, fingerprint)`
//     pair that produced the SPECIAL_APPROVAL_REQUIRED decision, so a later
//     policy mutation can never reinterpret it;
//   - the requested ceiling may never exceed the authority ceiling that was
//     frozen when the request was made;
//   - the expiry may never be in the past;
//   - the requester and the approver may never be the same person (SOD);
//   - approving one scope never releases another scope.
//
// The approval is never a general bypass: it cannot release a fail-closed
// BLOCK, it cannot widen to a second scope, it cannot outlive its expiry and
// it cannot authorise more credit than the evaluated proposal required.

import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, assertAllowedFields, normalizeBusinessDate, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import {
  creditScopePredicate, requireCreditReadScope, requireCreditSpecialApprovalDecisionAuthority,
  requireCreditSpecialApprovalRequestAuthority, resolveCreditReadMode,
} from './credit-scope.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

export const CREDIT_SPECIAL_APPROVAL_SCOPE_MODES = Object.freeze(['ONE_TIME', 'TIME_BOUNDED', 'OBJECT_BOUNDED']);
export const CREDIT_SPECIAL_APPROVAL_DECISIONS = Object.freeze(['PENDING', 'APPROVED', 'REJECTED']);

const REQUEST_OPERATION = 'CREDIT_SPECIAL_APPROVAL_REQUEST';
const DECIDE_OPERATION = 'CREDIT_SPECIAL_APPROVAL_DECIDE';

function toCents(value, label) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new HttpError(400, `${label}必须为安全整数分`);
  return amount;
}

function nonNegativeCents(value, label) {
  const amount = toCents(value, label);
  if (amount < 0) throw new HttpError(400, `${label}不能为负`);
  return amount;
}

function lockSuffix(db) {
  return db.dialect === 'mysql' ? ' FOR UPDATE' : '';
}

function nowIso() {
  return new Date().toISOString();
}

function present(row) {
  return {
    id: row.id,
    sourceCreditCheckResultId: row.source_credit_check_result_id,
    sourceCheckGroupId: row.source_check_group_id,
    scopeType: row.scope_type,
    sourceCreditPolicySnapshotId: row.source_credit_policy_snapshot_id,
    sourcePolicySnapshotFingerprint: row.source_policy_snapshot_fingerprint,
    sourceProfileEffectiveStateHash: row.source_profile_effective_state_hash,
    sourceSalesOrderId: row.source_sales_order_id,
    reason: row.reason,
    requestedOverrideCents: Number(row.requested_override_cents),
    requestedExpiryBusinessDate: row.requested_expiry_business_date,
    requestedCeilingCents: Number(row.requested_ceiling_cents),
    authorityCeilingCents: Number(row.authority_ceiling_cents),
    decision: row.decision,
    approvedOverrideCents: row.approved_override_cents == null ? null : Number(row.approved_override_cents),
    approvedCeilingCents: row.approved_ceiling_cents == null ? null : Number(row.approved_ceiling_cents),
    approvedExpiryBusinessDate: row.approved_expiry_business_date,
    scopeMode: row.scope_mode,
    approverId: row.approver_id,
    decidedAt: row.decided_at,
    auditId: row.audit_id,
  };
}

function approvalNotFound() {
  return new HttpError(404, '信用特别审批不存在', { code: 'CREDIT_SPECIAL_APPROVAL_NOT_FOUND' });
}

function readApproval(db, id, { locked = false } = {}) {
  const row = db.prepare(`SELECT * FROM credit_special_approval WHERE id=?${locked ? lockSuffix(db) : ''}`).get(id);
  if (!row) throw approvalNotFound();
  return row;
}

// §37.54.5.3 / §37.54.7.8 — the Special Approval read shape. An approval is
// attributable only through its source Credit Check, and that source result is
// itself attributable only through the Credit Profile it was evaluated
// against. Both branches therefore anchor on the source result, so an
// approval whose source link is missing or whose scope type contradicts its
// source fails closed instead of being read as aggregate.
const CREDIT_SPECIAL_APPROVAL_SCOPE = Object.freeze({
  aggregateExpr: "scope_type='CUSTOMER_AGGREGATE' AND source_credit_check_result_id IN "
    + "(SELECT id FROM credit_check_results WHERE scope_type='CUSTOMER_AGGREGATE' AND credit_profile_id IS NOT NULL)",
  selfExpr: "scope_type='SALESPERSON_SUB_LIMIT' AND source_credit_check_result_id IN "
    + "(SELECT id FROM credit_check_results WHERE scope_type='SALESPERSON_SUB_LIMIT' AND credit_profile_id IN "
    + '(SELECT id FROM credit_profile WHERE salesperson_scope_key=?))',
});

// The approval request may only be made against a scope that explicitly
// requires an exception. A fail-closed BLOCK is never releasable.
function readSourceResult(db, sourceCreditCheckResultId) {
  const row = db.prepare('SELECT * FROM credit_check_results WHERE id=?').get(sourceCreditCheckResultId);
  if (!row) {
    throw new HttpError(404, '信用检查结果不存在', { code: 'CREDIT_CHECK_RESULT_NOT_FOUND' });
  }
  if (row.decision !== 'SPECIAL_APPROVAL_REQUIRED') {
    throw new HttpError(409, '该信用检查结果不需要特别审批', {
      code: 'CREDIT_SPECIAL_APPROVAL_NOT_APPLICABLE',
      decision: row.decision,
    });
  }
  return row;
}

function normalizeScopeMode(value) {
  const mode = requiredCode(value, '审批范围模式');
  if (!CREDIT_SPECIAL_APPROVAL_SCOPE_MODES.includes(mode)) {
    throw new HttpError(400, '审批范围模式无效');
  }
  return mode;
}

/**
 * The authority ceiling is frozen at request time. It is the highest credit
 * ceiling the approval may ever authorise, derived from the evaluated
 * proposal of the very check result the request binds to: the approval can
 * never authorise more credit than that specific proposal required, so it is
 * structurally incapable of becoming an unlimited or permanent bypass.
 */
function authorityCeilingFor(result) {
  const breakdown = JSON.parse(result.component_breakdown_json || '{}');
  const proposedTotal = Number(breakdown.proposedTotalCents);
  const limit = breakdown.creditLimitCents == null ? null : Number(breakdown.creditLimitCents);
  const proposal = Number.isSafeInteger(proposedTotal) ? proposedTotal : 0;
  if (limit == null) return proposal;
  return Math.max(proposal, limit);
}

export async function requestCreditSpecialApproval(db, req, res, actor) {
  requireCreditSpecialApprovalRequestAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceCreditCheckResultId', 'reason', 'requestedOverrideCents',
    'requestedCeilingCents', 'requestedExpiryBusinessDate', 'scopeMode']);
  const sourceCreditCheckResultId = requiredText(body.sourceCreditCheckResultId, '信用检查结果', 128);
  const reason = requiredText(body.reason, '审批原因', 500);
  const requestedOverrideCents = nonNegativeCents(body.requestedOverrideCents, '申请覆盖金额');
  const requestedCeilingCents = nonNegativeCents(body.requestedCeilingCents, '申请额度上限');
  const requestedExpiryBusinessDate = normalizeBusinessDate(body.requestedExpiryBusinessDate, '申请失效业务日期');
  const scopeMode = normalizeScopeMode(body.scopeMode);

  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, REQUEST_OPERATION, sourceCreditCheckResultId, key, fingerprint);
    if (replay) { response = { approval: replay.approval, replayed: true }; return; }
    const result = readSourceResult(db, sourceCreditCheckResultId);
    // The result row is locked so that a concurrent decision on the same row
    // cannot interleave with this request.
    db.prepare(`SELECT id FROM credit_check_results WHERE id=?${lockSuffix(db)}`).get(sourceCreditCheckResultId);
    const existing = db.prepare('SELECT * FROM credit_special_approval WHERE source_credit_check_result_id=?').get(sourceCreditCheckResultId);
    if (existing) {
      throw new HttpError(409, '该信用检查结果已存在特别审批申请', {
        code: 'CREDIT_SPECIAL_APPROVAL_ALREADY_REQUESTED',
        approvalId: existing.id,
      });
    }
    const authorityCeilingCents = authorityCeilingFor(result);
    if (requestedCeilingCents > authorityCeilingCents || requestedOverrideCents > authorityCeilingCents) {
      throw new HttpError(409, '申请额度超过权限上限', {
        code: 'CREDIT_SPECIAL_APPROVAL_AUTHORITY_EXCEEDED',
        authorityCeilingCents,
        requestedCeilingCents,
        requestedOverrideCents,
      });
    }
    if (requestedExpiryBusinessDate < result.business_date) {
      throw new HttpError(409, '审批失效日期不能早于业务日期', {
        code: 'CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST',
        businessDate: result.business_date,
      });
    }
    const approvalId = randomUUID();
    const auditId = randomUUID();
    db.prepare(`INSERT INTO credit_special_approval(id, source_credit_check_result_id, source_check_group_id,
        scope_type, source_credit_policy_snapshot_id, source_policy_snapshot_fingerprint,
        source_profile_effective_state_hash, source_sales_order_id, reason, requested_override_cents,
        requested_expiry_business_date, requested_ceiling_cents, authority_ceiling_cents, decision,
        approved_override_cents, approved_ceiling_cents, approved_expiry_business_date, scope_mode,
        approver_id, decided_at, audit_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NULL,NULL,NULL,?,NULL,NULL,?)`).run(
      approvalId, sourceCreditCheckResultId, result.check_group_id, result.scope_type,
      result.credit_policy_snapshot_id, result.policy_snapshot_fingerprint, result.profile_effective_state_hash,
      result.sales_order_id, reason, requestedOverrideCents, requestedExpiryBusinessDate, requestedCeilingCents,
      authorityCeilingCents, scopeMode, auditId,
    );
    db.prepare(`INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id, detail, created_at)
      VALUES(?,?,?,'CREDIT_SPECIAL_APPROVAL',?,?,?)`).run(
      auditId, actor.id, 'REQUEST', approvalId, JSON.stringify({
        requesterId: actor.id,
        sourceCreditCheckResultId,
        scopeType: result.scope_type,
        requestedOverrideCents,
        requestedCeilingCents,
        requestedExpiryBusinessDate,
        scopeMode,
        authorityCeilingCents,
        businessDate: result.business_date,
      }), nowIso(),
    );
    response = { approval: present(readApproval(db, approvalId)) };
    saveIdempotency(db, REQUEST_OPERATION, sourceCreditCheckResultId, key, fingerprint, response);
  });
  return send(res, 201, response);
}

export async function decideCreditSpecialApproval(db, req, res, actor, approvalId) {
  // §34.7 P2 / P4 — deciding a Credit Special Approval needs a bounded
  // authority that is separate from the requester's authority.
  requireCreditSpecialApprovalDecisionAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['decision', 'approvedOverrideCents', 'approvedCeilingCents', 'approvedExpiryBusinessDate', 'reason']);
  const decision = requiredCode(body.decision, '审批结论');
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new HttpError(400, '审批结论仅支持 APPROVED / REJECTED');
  }
  const reason = body.reason ? requiredText(body.reason, '审批意见', 500) : null;

  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint({ approvalId, decision, body });
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, DECIDE_OPERATION, approvalId, key, fingerprint);
    if (replay) { response = { approval: replay.approval, replayed: true }; return; }
    const row = readApproval(db, approvalId, { locked: true });
    if (row.decision !== 'PENDING') {
      throw new HttpError(409, '该信用特别审批已被处理', {
        code: 'CREDIT_SPECIAL_APPROVAL_ALREADY_DECIDED',
        decision: row.decision,
      });
    }
    // §36.6.6 — the requester and the approver may never be the same person.
    const requestAudit = row.audit_id
      ? db.prepare(`SELECT user_id, detail FROM audit_logs WHERE id=? AND entity_type='CREDIT_SPECIAL_APPROVAL' AND action='REQUEST'`).get(row.audit_id)
      : null;
    if (requestAudit && requestAudit.user_id === actor.id) {
      throw new HttpError(409, '申请人与审批人必须分离', { code: 'CREDIT_SPECIAL_APPROVAL_SOD' });
    }
    if (decision === 'REJECTED') {
      db.prepare(`UPDATE credit_special_approval SET decision='REJECTED', approver_id=?, decided_at=?,
        approved_override_cents=NULL, approved_ceiling_cents=NULL, approved_expiry_business_date=NULL
        WHERE id=?`).run(actor.id, nowIso(), approvalId);
      audit(db, actor.id, 'REJECT', 'CREDIT_SPECIAL_APPROVAL', approvalId, reason || '拒绝信用特别审批');
    } else {
      const approvedOverrideCents = body.approvedOverrideCents === undefined
        ? Number(row.requested_override_cents)
        : nonNegativeCents(body.approvedOverrideCents, '批准覆盖金额');
      const approvedCeilingCents = body.approvedCeilingCents === undefined
        ? Number(row.requested_ceiling_cents)
        : nonNegativeCents(body.approvedCeilingCents, '批准额度上限');
      const approvedExpiryBusinessDate = body.approvedExpiryBusinessDate === undefined
        ? String(row.requested_expiry_business_date)
        : normalizeBusinessDate(body.approvedExpiryBusinessDate, '批准失效业务日期');
      const authorityCeilingCents = Number(row.authority_ceiling_cents);
      if (approvedCeilingCents > authorityCeilingCents || approvedOverrideCents > authorityCeilingCents) {
        throw new HttpError(409, '批准额度超过权限上限', {
          code: 'CREDIT_SPECIAL_APPROVAL_AUTHORITY_EXCEEDED',
          authorityCeilingCents,
          approvedCeilingCents,
          approvedOverrideCents,
        });
      }
      if (approvedCeilingCents > Number(row.requested_ceiling_cents) || approvedOverrideCents > Number(row.requested_override_cents)) {
        throw new HttpError(409, '批准额度不能超过申请额度', {
          code: 'CREDIT_SPECIAL_APPROVAL_EXCEEDS_REQUEST',
          requestedCeilingCents: Number(row.requested_ceiling_cents),
          requestedOverrideCents: Number(row.requested_override_cents),
        });
      }
      const sourceResult = db.prepare('SELECT business_date FROM credit_check_results WHERE id=?').get(row.source_credit_check_result_id);
      if (!sourceResult) {
        throw new HttpError(409, '来源信用检查结果不存在', { code: 'CREDIT_CHECK_RESULT_NOT_FOUND' });
      }
      if (approvedExpiryBusinessDate < sourceResult.business_date) {
        throw new HttpError(409, '批准失效日期不能早于业务日期', {
          code: 'CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST',
          businessDate: sourceResult.business_date,
        });
      }
      db.prepare(`UPDATE credit_special_approval SET decision='APPROVED', approver_id=?, decided_at=?,
        approved_override_cents=?, approved_ceiling_cents=?, approved_expiry_business_date=? WHERE id=?`).run(
        actor.id, nowIso(), approvedOverrideCents, approvedCeilingCents, approvedExpiryBusinessDate, approvalId,
      );
      audit(db, actor.id, 'APPROVE', 'CREDIT_SPECIAL_APPROVAL', approvalId, JSON.stringify({
        approvedOverrideCents,
        approvedCeilingCents,
        approvedExpiryBusinessDate,
        reason,
      }));
    }
    response = { approval: present(readApproval(db, approvalId)) };
    saveIdempotency(db, DECIDE_OPERATION, approvalId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

export function listCreditSpecialApprovals(db, res, actor, url) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);
  const scopePredicate = creditScopePredicate(readMode.mode, {
    ...CREDIT_SPECIAL_APPROVAL_SCOPE,
    selfValue: readMode.selfSalespersonId,
  });
  // The scope predicate is part of the same statement as the business
  // filters, so a filter can never widen the scope and the ordering and LIMIT
  // are computed over the authorized rows only.
  const where = [scopePredicate.sql];
  const args = [...scopePredicate.args];
  const decision = String(url.searchParams.get('decision') || '').trim().toUpperCase();
  const scopeType = String(url.searchParams.get('scopeType') || '').trim().toUpperCase();
  const salesOrderId = String(url.searchParams.get('salesOrderId') || '').trim();
  if (decision) { where.push('decision=?'); args.push(decision); }
  if (scopeType) { where.push('scope_type=?'); args.push(scopeType); }
  if (salesOrderId) { where.push('source_sales_order_id=?'); args.push(salesOrderId); }
  const rows = db.prepare(`SELECT * FROM credit_special_approval
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN decided_at IS NULL THEN 0 ELSE 1 END ASC, decided_at DESC, id DESC LIMIT 500`).all(...args);
  return send(res, 200, { approvals: rows.map(present) });
}

export function getCreditSpecialApproval(db, res, actor, approvalId) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);
  const scopePredicate = creditScopePredicate(readMode.mode, {
    ...CREDIT_SPECIAL_APPROVAL_SCOPE,
    selfValue: readMode.selfSalespersonId,
  });
  // The detail query carries the very same predicate as the list, so an
  // out-of-scope approval is indistinguishable from an absent one.
  const row = db.prepare(`SELECT * FROM credit_special_approval WHERE id=? AND ${scopePredicate.sql}`).get(approvalId, ...scopePredicate.args);
  if (!row) throw approvalNotFound();
  return send(res, 200, { approval: present(row) });
}

export const __creditSpecialApprovalInternals = Object.freeze({
  CREDIT_SPECIAL_APPROVAL_SCOPE_MODES,
  CREDIT_SPECIAL_APPROVAL_DECISIONS,
  authorityCeilingFor,
  present,
});
