// W11-A U2-1 — SC101 Credit Query / SC102 Credit Exception History.
//
// solution.md §37.54.8 (API, response structure, zero-side-effect contract),
// §37.54.14.2 (UAT-S-35 evidence map), §37.54.15.3 (package contract) and
// §37.54.5.2 / §37.54.5.3 (canonical read-only computation reuse and the single
// Credit Read Mode decision).
//
// ZERO SIDE EFFECT — this module is a pure reader:
//   * it never calls ensureCreditPolicySnapshot, ensureCreditLockAnchor,
//     evaluateCredit, saveIdempotency or transaction();
//   * it never issues INSERT / UPDATE / DELETE / CREATE / ALTER / DROP;
//   * the policy snapshot identity is COMPUTED with the pure fingerprint
//     function introduced by W11-A U1 and is never persisted.
//
// CANONICAL REUSE — there is no second truth source:
//   * the exposure amount and its components come from computeCreditExposure(),
//     the very derivation the Credit Check uses;
//   * the effective Credit Profile rows are resolved under the canonical
//     Credit Read Scope predicate in the SAME statement;
//   * the read scope comes from the one canonical resolver in credit-scope.js;
//   * the exception history is derived from credit_check_results and
//     credit_special_approval only — no second exception ledger exists.

import { HttpError, normalizeBusinessDate, requiredText, send } from '../lib/http.js';
import {
  CREDIT_CHECK_RESULT_SCOPE,
  CREDIT_CHECK_STAGES,
  buildScopeHashes,
  computeCreditExposure,
  resolveCustomerCreditObject,
} from './credit-check.js';
import { CREDIT_POLICY_HASH_VERSIONS, computePolicySnapshotFingerprint } from './credit-policy.js';
import { resolveEligiblePrepaymentForSalesGate } from './sales-prepayment-finance-adapter.js';
import {
  creditScopePredicate,
  currentBusinessDate,
  requireCreditReadScope,
  resolveCreditProfileReadScope,
  resolveCreditReadMode,
} from './credit-scope.js';

const AGGREGATE_SCOPE_TYPE = 'CUSTOMER_AGGREGATE';
const SALESPERSON_SCOPE_TYPE = 'SALESPERSON_SUB_LIMIT';
const AGGREGATE_SCOPE_KEY = '*';
const EXCEPTION_DECISIONS = Object.freeze(['PASS', 'WARNING', 'BLOCK', 'SPECIAL_APPROVAL_REQUIRED']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// §37.54.8.4 — the exception classification is never re-derived. It comes from
// the persisted decision, the persisted reason codes and the persisted
// approval decision.
function decisionOf(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!EXCEPTION_DECISIONS.includes(text)) {
    throw new HttpError(400, '信用检查结论无效', { code: 'CREDIT_QUERY_INVALID_INPUT' });
  }
  return text;
}

function scopeTypeOf(value) {
  const text = String(value || '').trim().toUpperCase();
  if (![AGGREGATE_SCOPE_TYPE, SALESPERSON_SCOPE_TYPE].includes(text)) {
    throw new HttpError(400, '信用范围类型无效', { code: 'CREDIT_QUERY_INVALID_INPUT' });
  }
  return text;
}

function exposureStageOf(value) {
  const stage = String(value || '').trim().toUpperCase();
  if (!stage || !CREDIT_CHECK_STAGES.includes(stage)) {
    throw new HttpError(400, '信用查询阶段无效', { code: 'CREDIT_QUERY_INVALID_INPUT' });
  }
  return stage;
}

// Pagination is explicit and bounded. A fixed LIMIT may never stand in for a
// complete page set (R102-5).
function readPagination(url) {
  const rawLimit = String(url.searchParams.get('limit') || '').trim();
  const rawOffset = String(url.searchParams.get('offset') || '').trim();
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit)) {
      throw new HttpError(400, '分页参数无效', { code: 'CREDIT_QUERY_INVALID_PAGINATION' });
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new HttpError(400, '分页参数超出允许范围', { code: 'CREDIT_QUERY_INVALID_PAGINATION' });
    }
  }
  if (rawOffset) {
    if (!/^\d+$/.test(rawOffset)) {
      throw new HttpError(400, '分页参数无效', { code: 'CREDIT_QUERY_INVALID_PAGINATION' });
    }
    offset = Number(rawOffset);
    if (offset < 0) {
      throw new HttpError(400, '分页参数超出允许范围', { code: 'CREDIT_QUERY_INVALID_PAGINATION' });
    }
  }
  return { limit, offset };
}

// The effective Credit Profile rows for a customer, resolved under the
// canonical Credit Read Scope predicate.
//
// The effective-date window and the scope predicate are combined in ONE
// statement, so the predicate can never widen the set and the effective
// resolution never happens outside the authorized scope. The predicate is the
// canonical credit_profile projection exposed by resolveCreditProfileReadScope;
// this module writes no scope SQL of its own.
function resolveVisibleProfiles(db, readScope, { customerId, creditObjectType, creditObjectId, businessDate }) {
  const scopeSql = readScope.predicateSql ? ` AND ${readScope.predicateSql}` : '';
  const rows = db.prepare(`SELECT cp.* FROM credit_profile cp
    WHERE cp.customer_id=? AND cp.credit_object_type=? AND cp.credit_object_id=?
      AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)${scopeSql}`)
    .all(customerId, creditObjectType, creditObjectId, businessDate, businessDate,
      ...(readScope.predicateSql ? readScope.predicateArgs : []));
  // More than one effective version for the same scope key is ambiguous, and it
  // is refused exactly like the canonical Wave 9 resolver refuses it.
  const byScopeKey = new Map();
  for (const row of rows) {
    if (byScopeKey.has(row.salesperson_scope_key)) {
      throw new HttpError(409, '信用档案生效版本不唯一', { code: 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS' });
    }
    byScopeKey.set(row.salesperson_scope_key, row);
  }
  return byScopeKey;
}

// §37.54.8.2 — usedCents is the canonical Credit Check amount. The sum is the
// one evaluateCredit uses, so the query and the check can never disagree.
function canonicalExposureCents(components) {
  return Number(components.approvedSoCommitmentCents || 0)
    + Number(components.deliveredNotSettledCents || 0)
    + Number(components.arOpenCents || 0)
    - Number(components.eligiblePrepaymentCents || 0);
}

function presentScope(scopeType, profile, components, factCounts, computedPolicyIdentity) {
  const creditLimitCents = profile.credit_limit_cents == null ? null : Number(profile.credit_limit_cents);
  const usedCents = canonicalExposureCents(components);
  const unlimited = creditLimitCents == null;
  const remainingCents = unlimited ? null : creditLimitCents - usedCents;
  const overLimitCents = unlimited ? 0 : Math.max(0, usedCents - creditLimitCents);
  return {
    scopeType,
    creditProfileId: profile.id,
    creditLimitCents,
    usedCents,
    remainingCents,
    unlimited,
    overLimitCents,
    components: {
      approvedSoCommitmentCents: Number(components.approvedSoCommitmentCents || 0),
      deliveredNotSettledCents: Number(components.deliveredNotSettledCents || 0),
      arOpenCents: Number(components.arOpenCents || 0),
      eligiblePrepaymentCents: Number(components.eligiblePrepaymentCents || 0),
      ambiguousAttributionCents: Number(components.ambiguousAttributionCents || 0),
    },
    hasAmbiguousAttribution: Number(components.ambiguousAttributionCents || 0) > 0,
    factCounts: {
      orders: factCounts.orders,
      deliveries: factCounts.deliveries,
      receivables: factCounts.receivables,
    },
    computedPolicyIdentity,
  };
}

// §37.54.8.3 — the snapshot identity is computed, never created. When a
// matching row already exists its id is reported; otherwise the snapshot is
// reported as not persisted. The query path never inserts a snapshot row.
function readPolicySnapshotIdentity(db, {
  businessDate, fingerprint, scopeType, creditProfileId, creditLockAnchorId,
}) {
  const rows = db.prepare(`SELECT id FROM credit_policy_snapshots
    WHERE business_date=? AND snapshot_fingerprint=? AND scope_type=?
      AND credit_profile_id=? AND credit_lock_anchor_id=?
    ORDER BY captured_at DESC,id DESC`).all(
    businessDate, fingerprint, scopeType, creditProfileId, creditLockAnchorId,
  );
  if (rows.length > 1) {
    throw new HttpError(500, '信用策略快照无法解析', { code: 'CREDIT_POLICY_SNAPSHOT_UNRESOLVABLE' });
  }
  const row = rows[0] || null;
  return {
    fingerprint,
    persisted: Boolean(row),
    creditPolicySnapshotId: row ? row.id : null,
  };
}

// GET /api/credit/exposure
//
// SC101. The scope of the answer is decided by the ONE canonical Credit Read
// Mode resolver; the requested business date only selects the effective
// business facts and never the authorization.
export function getCreditExposure(db, res, actor, url) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);

  const customerId = requiredText(url.searchParams.get('customerId'), '客户', 128);
  const stage = exposureStageOf(url.searchParams.get('stage'));
  const salespersonId = String(url.searchParams.get('salespersonId') || '').trim() || null;
  const rawBusinessDate = String(url.searchParams.get('businessDate') || '').trim();
  // The requested business date selects the effective business facts. It is
  // never an authorization input: the read mode is decided on the server's
  // current calendar day (CORRECTION-1 / R-D2-1).
  const businessDate = rawBusinessDate ? normalizeBusinessDate(rawBusinessDate) : currentBusinessDate();
  const creditObjectTypeInput = String(url.searchParams.get('creditObjectType') || '').trim().toUpperCase() || null;
  const creditObjectIdInput = String(url.searchParams.get('creditObjectId') || '').trim() || null;

  const creditObject = resolveCustomerCreditObject(db, {
    customerId,
    businessDate,
    creditObjectType: creditObjectTypeInput,
    creditObjectId: creditObjectIdInput,
  });

  // The canonical credit_profile projection of the same read mode.
  const readScope = resolveCreditProfileReadScope(db, actor, { businessDate });
  const byScopeKey = resolveVisibleProfiles(db, readScope, {
    customerId,
    creditObjectType: creditObject.creditObjectType,
    creditObjectId: creditObject.creditObjectId,
    businessDate,
  });

  // The candidate salesperson scopes are the requested one, or — when the
  // request names none — every sub-limit scope the canonical predicate admits.
  // A scope the read mode does not admit is simply absent from the answer; it
  // is never reported as empty and never reported as forbidden.
  const aggregateProfile = byScopeKey.get(AGGREGATE_SCOPE_KEY) || null;
  const subLimitProfiles = [...byScopeKey.entries()].filter(([key]) => key !== AGGREGATE_SCOPE_KEY);
  const selectedSubLimits = salespersonId
    ? subLimitProfiles.filter(([key]) => key === salespersonId)
    : subLimitProfiles;

  if (!aggregateProfile && !selectedSubLimits.length) {
    throw new HttpError(409, '缺少强制信用档案', { code: 'CREDIT_PROFILE_MISSING' });
  }

  // One canonical exposure derivation, reused verbatim. The aggregate scope is
  // derived once, and every admitted sub-limit scope is derived with the
  // salesperson it belongs to.
  const derivations = [];
  if (aggregateProfile) {
    const aggregateComponents = computeCreditExposure(db, {
      customerId, salespersonId: null, businessDate,
    }).aggregateComponents;
    const prepayment = resolveEligiblePrepaymentForSalesGate(db, {
      customerId,
      businessDate,
      gateStage: 'CREDIT_CHECK',
      salesOrderId: null,
      remainingRequiredCents: 0,
      lockMode: 'NONE',
    });
    aggregateComponents.eligiblePrepaymentCents = Number(prepayment.eligibleAmountCents || 0);
    derivations.push({
      scopeType: AGGREGATE_SCOPE_TYPE,
      profile: aggregateProfile,
      components: aggregateComponents,
    });
  }
  for (const [key, profile] of selectedSubLimits) {
    derivations.push({
      scopeType: SALESPERSON_SCOPE_TYPE,
      profile,
      components: computeCreditExposure(db, { customerId, salespersonId: key, businessDate }).salespersonComponents,
    });
  }

  const factCounts = (() => {
    const exposure = computeCreditExposure(db, { customerId, salespersonId: null, businessDate });
    return {
      orders: exposure.orderCount,
      deliveries: exposure.deliveryCount,
      receivables: exposure.receivableCount,
    };
  })();

  const scopes = [];
  for (const derivation of derivations) {
    const hashScope = { scopeType: derivation.scopeType, profile: derivation.profile, stage };
    const hashes = buildScopeHashes(db, {
      scopes: [hashScope], businessDate, hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
    });
    const fingerprint = computePolicySnapshotFingerprint({
      hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
      parameterSetHash: hashes.parameterSetHash,
      ruleSetHash: hashes.ruleSetHash,
      profileEffectiveStateHash: hashes.profileEffectiveStateHash,
    });
    const snapshotIdentity = readPolicySnapshotIdentity(db, {
      businessDate,
      fingerprint,
      scopeType: derivation.scopeType,
      creditProfileId: derivation.profile.id,
      creditLockAnchorId: derivation.profile.anchor_id,
    });
    const computedPolicyIdentity = {
      hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
      fingerprintVersion: 'CSP2',
      customerId,
      businessDate,
      stage,
      scopeType: derivation.scopeType,
      creditProfileId: derivation.profile.id,
      creditLockAnchorId: derivation.profile.anchor_id,
      parameterSetHash: hashes.parameterSetHash,
      ruleSetHash: hashes.ruleSetHash,
      profileEffectiveStateHash: hashes.profileEffectiveStateHash,
      fingerprint: snapshotIdentity.fingerprint,
      persisted: snapshotIdentity.persisted,
      creditPolicySnapshotId: snapshotIdentity.creditPolicySnapshotId,
    };
    scopes.push(presentScope(
      derivation.scopeType,
      derivation.profile,
      derivation.components,
      factCounts,
      computedPolicyIdentity,
    ));
  }

  return send(res, 200, {
    exposure: {
      customerId,
      businessDate,
      stage,
      scopes,
    },
  });
}

// §37.54.8.4 — the exception item. The source order and the source delivery
// contribute identity and status only; no commercial amount is copied.
// The canonical Scope predicate names the bare columns of
// credit_check_results. The authorized rows are therefore selected in a
// derived table over that one table, and the display joins are applied
// outside it — so the predicate stays unambiguous and the joins can never
// widen the authorized set.
const EXCEPTION_ALIASES = `e.*,
  a.id AS approval_id, a.source_credit_check_result_id AS approval_source_check_result_id,
  a.source_check_group_id AS approval_source_check_group_id, a.scope_type AS approval_scope_type,
  a.source_credit_policy_snapshot_id AS approval_source_snapshot_id,
  a.source_policy_snapshot_fingerprint AS approval_source_snapshot_fingerprint,
  a.source_profile_effective_state_hash AS approval_source_profile_state_hash,
  a.source_sales_order_id AS approval_source_sales_order_id, a.reason AS approval_reason,
  a.requested_override_cents AS approval_requested_override_cents,
  a.requested_expiry_business_date AS approval_requested_expiry_business_date,
  a.requested_ceiling_cents AS approval_requested_ceiling_cents,
  a.authority_ceiling_cents AS approval_authority_ceiling_cents,
  a.decision AS approval_decision,
  a.approved_override_cents AS approval_approved_override_cents,
  a.approved_ceiling_cents AS approval_approved_ceiling_cents,
  a.approved_expiry_business_date AS approval_approved_expiry_business_date,
  a.scope_mode AS approval_scope_mode, a.approver_id AS approval_approver_id,
  a.decided_at AS approval_decided_at, a.audit_id AS approval_audit_id,
  so.order_no AS source_order_no, so.status AS source_order_status,
  sd.delivery_no AS source_delivery_no, sd.status AS source_delivery_status`;

function exceptionSelect(innerWhere) {
  return `SELECT ${EXCEPTION_ALIASES} FROM (SELECT r.* FROM credit_check_results r WHERE ${innerWhere}) e
    LEFT JOIN credit_special_approval a ON a.source_credit_check_result_id = e.id
    LEFT JOIN sales_orders so ON so.id = e.sales_order_id
    LEFT JOIN sales_deliveries sd ON sd.id = e.sales_delivery_id`;
}

function requirePersistedIdentityVersion(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new HttpError(500, `信用历史身份版本无效：${field}`, {
      code: 'CREDIT_POLICY_IDENTITY_VERSION_INVALID',
    });
  }
  return value;
}

function exceptionItem(row) {
  const checkGroupId = requirePersistedIdentityVersion(row.check_group_id, /^CCHK[12]:[0-9a-f]{64}$/, 'checkGroupId');
  const policySnapshotFingerprint = requirePersistedIdentityVersion(
    row.policy_snapshot_fingerprint,
    /^CSP[12]:[0-9a-f]{64}$/,
    'policySnapshotFingerprint',
  );
  const approvalSourceCheckGroupId = row.approval_id
    ? requirePersistedIdentityVersion(row.approval_source_check_group_id, /^CCHK[12]:[0-9a-f]{64}$/, 'approval.sourceCheckGroupId')
    : null;
  const approvalSourceSnapshotFingerprint = row.approval_id
    ? requirePersistedIdentityVersion(
      row.approval_source_snapshot_fingerprint,
      /^CSP[12]:[0-9a-f]{64}$/,
      'approval.sourcePolicySnapshotFingerprint',
    )
    : null;
  return {
    checkResultId: row.id,
    checkGroupId,
    scopeType: row.scope_type,
    creditProfileId: row.credit_profile_id,
    stage: row.stage,
    businessDate: row.business_date,
    decision: row.decision,
    reasonCodes: JSON.parse(row.reason_codes_json || '[]'),
    recordedBreakdown: JSON.parse(row.component_breakdown_json || '{}'),
    policySnapshotFingerprint,
    profileEffectiveStateHash: row.profile_effective_state_hash,
    sourceOrderId: row.sales_order_id,
    sourceDeliveryId: row.sales_delivery_id,
    evaluatedAt: row.evaluated_at,
    evaluatedBy: row.evaluated_by,
    approval: row.approval_id ? {
      id: row.approval_id,
      sourceCreditCheckResultId: row.approval_source_check_result_id,
      sourceCheckGroupId: approvalSourceCheckGroupId,
      scopeType: row.approval_scope_type,
      sourceCreditPolicySnapshotId: row.approval_source_snapshot_id,
      sourcePolicySnapshotFingerprint: approvalSourceSnapshotFingerprint,
      sourceProfileEffectiveStateHash: row.approval_source_profile_state_hash,
      sourceSalesOrderId: row.approval_source_sales_order_id,
      reason: row.approval_reason,
      requestedOverrideCents: Number(row.approval_requested_override_cents || 0),
      requestedExpiryBusinessDate: row.approval_requested_expiry_business_date,
      requestedCeilingCents: Number(row.approval_requested_ceiling_cents || 0),
      authorityCeilingCents: Number(row.approval_authority_ceiling_cents || 0),
      decision: row.approval_decision,
      approvedOverrideCents: row.approval_approved_override_cents == null ? null : Number(row.approval_approved_override_cents),
      approvedCeilingCents: row.approval_approved_ceiling_cents == null ? null : Number(row.approval_approved_ceiling_cents),
      approvedExpiryBusinessDate: row.approval_approved_expiry_business_date,
      scopeMode: row.approval_scope_mode,
      approverId: row.approval_approver_id,
      decidedAt: row.approval_decided_at,
      auditId: row.approval_audit_id,
    } : null,
    sourceOrder: row.source_order_no ? {
      id: row.sales_order_id,
      orderNo: row.source_order_no,
      status: row.source_order_status,
    } : null,
    sourceDelivery: row.source_delivery_no ? {
      id: row.sales_delivery_id,
      deliveryNo: row.source_delivery_no,
      status: row.source_delivery_status,
    } : null,
  };
}

// The shared WHERE builder. The canonical Scope predicate and the business
// filters are combined in ONE statement, and the COUNT query uses the very
// same WHERE and the very same arguments, so the total is the number of rows
// the caller is actually allowed to see.
function buildExceptionQuery(db, actor, url) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);
  const scopePredicate = creditScopePredicate(readMode.mode, {
    ...CREDIT_CHECK_RESULT_SCOPE,
    selfValue: readMode.selfSalespersonId,
  });

  const where = [scopePredicate.sql];
  const args = [...scopePredicate.args];

  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (customerId) {
    where.push('r.credit_profile_id IN (SELECT id FROM credit_profile WHERE customer_id=?)');
    args.push(customerId);
  }
  const scopeType = String(url.searchParams.get('scopeType') || '').trim();
  if (scopeType) {
    where.push('r.scope_type=?');
    args.push(scopeTypeOf(scopeType));
  }
  const decision = String(url.searchParams.get('decision') || '').trim();
  if (decision) {
    where.push('r.decision=?');
    args.push(decisionOf(decision));
  }
  const stage = String(url.searchParams.get('stage') || '').trim().toUpperCase();
  if (stage) {
    where.push('r.stage=?');
    args.push(stage);
  }
  const hasApproval = String(url.searchParams.get('hasApproval') || '').trim().toLowerCase();
  if (hasApproval) {
    if (hasApproval !== 'true' && hasApproval !== 'false') {
      throw new HttpError(400, '特别审批关联筛选无效', { code: 'CREDIT_QUERY_INVALID_INPUT' });
    }
    const exists = 'EXISTS (SELECT 1 FROM credit_special_approval ha WHERE ha.source_credit_check_result_id = r.id)';
    where.push(hasApproval === 'true' ? exists : `NOT ${exists}`);
  }
  const businessDateFrom = String(url.searchParams.get('businessDateFrom') || '').trim();
  if (businessDateFrom) {
    where.push('r.business_date>=?');
    args.push(normalizeBusinessDate(businessDateFrom));
  }
  const businessDateTo = String(url.searchParams.get('businessDateTo') || '').trim();
  if (businessDateTo) {
    where.push('r.business_date<=?');
    args.push(normalizeBusinessDate(businessDateTo));
  }
  return { where, args };
}

// GET /api/credit/exceptions
//
// SC102. The scope is decided first, the business filters are then combined
// with it inside the same SQL WHERE, and the total is counted over exactly the
// same authorized set.
export function listCreditExceptions(db, res, actor, url) {
  const { where, args } = buildExceptionQuery(db, actor, url);
  const { limit, offset } = readPagination(url);
  const whereSql = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS total FROM credit_check_results r WHERE ${whereSql}`)
    .get(...args).total;

  // The ordering is total and stable: business date, then evaluation time,
  // then the primary key, which is unique.
  const rows = db.prepare(`${exceptionSelect(whereSql)}
    ORDER BY e.business_date DESC, e.evaluated_at DESC, e.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);

  return send(res, 200, {
    exceptions: rows.map(exceptionItem),
    total,
    limit,
    offset,
  });
}

// GET /api/credit/exceptions/:checkResultId
//
// A result outside the caller's scope and a result that does not exist are
// indistinguishable: the same status, the same message and the same code.
function exceptionNotFound() {
  return new HttpError(404, '信用例外记录不存在', { code: 'CREDIT_EXCEPTION_NOT_FOUND' });
}

export function getCreditException(db, res, actor, checkResultId) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);
  const scopePredicate = creditScopePredicate(readMode.mode, {
    ...CREDIT_CHECK_RESULT_SCOPE,
    selfValue: readMode.selfSalespersonId,
  });

  // The detail query carries the very same predicate as the list.
  const row = db.prepare(exceptionSelect(`r.id=? AND ${scopePredicate.sql}`))
    .get(String(checkResultId || ''), ...scopePredicate.args);
  if (!row) throw exceptionNotFound();
  return send(res, 200, { exception: exceptionItem(row) });
}
