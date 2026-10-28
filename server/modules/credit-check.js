// Wave 10 — Sales & Customer Credit Check engine.
//
// solution.md §36.6.3 runtime sequence (steps 1..10), §36.3.1 scope
// resolution, §36.3.2 PURE_DERIVED exposure projection, §36.3.4 lock
// acquisition order and §36.6.6 Special Approval consumption.
//
// Design boundaries that this module deliberately honours:
//
//   - No `credit_exposure` table and no physical exposure cache exist. The
//     exposure is computed inside the check transaction from canonical Sales
//     and Finance facts only (PURE_DERIVED).
//   - The Credit Check takes NO row lock on any Sales business row. Sales rows
//     are read as canonical facts (§36.3.4.1 C-2).
//   - The Finance PREPAYMENT parent lock is the first lock the Credit Check
//     itself takes, and it is always taken through the frozen
//     discover -> plan -> lock -> assert pattern (§36.3.4.1 C-1).
//   - A missing / ambiguous mandatory profile fails closed. There is no path
//     that turns an unknown state into PASS.

import { createHash } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, assertAllowedFields, normalizeBusinessDate, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import { ensureCreditLockAnchor } from './credit-anchor.js';
import { ensureCreditPolicySnapshot } from './credit-policy.js';
import { resolveEffectiveCreditProfile } from './credit-profile.js';
import { creditScopePredicate, requireCreditEvaluationAuthority, requireCreditReadScope, resolveCreditReadMode } from './credit-scope.js';
import {
  assertPrepaymentParentPlanCurrent,
  discoverEligiblePrepaymentParents,
  lockEligiblePrepaymentParents,
  resolveEligiblePrepaymentForSalesGate,
} from './sales-prepayment-finance-adapter.js';
import { resolveRecognitionPolicy } from './finance-recognition-policy.js';

export const CREDIT_CHECK_STAGES = Object.freeze(['SO_SUBMIT', 'SO_APPROVE', 'SALES_DELIVERY_CONFIRM']);

// §36.3.3 — the four Credit Policy parameter codes owned by Wave 9. They are
// ordinary effective-dated `credit_parameters` rows and every one of them
// fails closed when it is absent.
export const CREDIT_PARAMETERS = Object.freeze({
  MANAGEMENT_ENABLED: 'CREDIT_MANAGEMENT_ENABLED',
  SUB_LIMIT_ONLY_ALLOWED: 'CREDIT_SUB_LIMIT_ONLY_ALLOWED',
  SUB_LIMIT_MANDATORY: 'CREDIT_SUB_LIMIT_MANDATORY',
  SUB_LIMIT_OVERDUE_DAYS: 'CREDIT_SUB_LIMIT_OVERDUE_DAYS',
});

// The customer aggregate is the centrally administered customer credit object
// (document.md §14 AP2). It is the identity used when a customer has no
// explicit credit object yet, so that the missing-profile fail-closed path
// (§29.22.1) is reached deterministically instead of silently.
const DEFAULT_CREDIT_OBJECT_TYPE = 'CUSTOMER';

const AGGREGATE_SCOPE = 'CUSTOMER_AGGREGATE';
const SALESPERSON_SCOPE = 'SALESPERSON_SUB_LIMIT';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
      : item
  ));
}

function toCents(value, label) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new HttpError(400, `${label}必须为安全整数分`);
  return amount;
}

function lockSuffix(db) {
  return db.dialect === 'mysql' ? ' FOR UPDATE' : '';
}

function shareLockSuffix(db) {
  return db.dialect === 'mysql' ? ' FOR SHARE' : '';
}

// ---------------------------------------------------------------------------
// §36.6.3 step 1 — Credit Management enabled gate and effective parameters
// ---------------------------------------------------------------------------

function readEffectiveParameter(db, code, businessDate) {
  const rows = db.prepare(`SELECT * FROM credit_parameters WHERE code=? AND status='ACTIVE' AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id`).all(code, businessDate, businessDate);
  if (rows.length > 1) throw new HttpError(409, '信用参数生效版本不唯一', { code: 'CREDIT_EFFECTIVE_VERSION_AMBIGUOUS' });
  return rows[0] || null;
}

function readBooleanParameter(db, code, businessDate, fallback) {
  const row = readEffectiveParameter(db, code, businessDate);
  if (!row) return fallback;
  if (row.value_bool == null) return fallback;
  return Boolean(Number(row.value_bool));
}

export function isCreditManagementEnabled(db, businessDate) {
  return readBooleanParameter(db, CREDIT_PARAMETERS.MANAGEMENT_ENABLED, businessDate, false);
}

function readSubLimitOnlyAllowed(db, businessDate) {
  return readBooleanParameter(db, CREDIT_PARAMETERS.SUB_LIMIT_ONLY_ALLOWED, businessDate, false);
}

function readSubLimitMandatory(db, businessDate) {
  return readBooleanParameter(db, CREDIT_PARAMETERS.SUB_LIMIT_MANDATORY, businessDate, false);
}

// §36.3.3 — the overdue-day policy is the profile's own `overdue_day_policy`,
// falling back to the global parameter. When neither exists the policy is
// undefined and a mandatory sub-limit fails closed.
function readOverdueDayPolicy(db, profile, businessDate) {
  if (profile && profile.overdue_day_policy != null && String(profile.overdue_day_policy).trim() !== '') {
    const days = Number(String(profile.overdue_day_policy).trim());
    if (Number.isSafeInteger(days) && days >= 0) return days;
  }
  const row = readEffectiveParameter(db, CREDIT_PARAMETERS.SUB_LIMIT_OVERDUE_DAYS, businessDate);
  if (row && row.value_int != null) {
    const days = Number(row.value_int);
    if (Number.isSafeInteger(days) && days >= 0) return days;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §36.3.1 — applicable control scope resolution
// ---------------------------------------------------------------------------

// The Credit Object is the commercial subject the profile governs. It is
// resolved from the effective profiles of the customer so that the anchor,
// the profile and the result row always agree on one identity. A customer
// whose effective profiles span more than one credit object cannot be
// resolved deterministically, so the check fails closed (P6).
export function resolveCustomerCreditObject(db, { customerId, businessDate, creditObjectType = null, creditObjectId = null }) {
  if (creditObjectType && creditObjectId) {
    return { creditObjectType: requiredCode(creditObjectType, '信用对象类型'), creditObjectId: String(creditObjectId) };
  }
  const rows = db.prepare(`SELECT DISTINCT credit_object_type,credit_object_id FROM credit_profile
    WHERE customer_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY credit_object_type,credit_object_id`).all(customerId, businessDate, businessDate);
  if (rows.length > 1) {
    throw new HttpError(409, '客户存在多个信用对象，无法确定适用信用范围', {
      code: 'CREDIT_CREDIT_OBJECT_AMBIGUOUS',
      creditObjects: rows.map((row) => `${row.credit_object_type}:${row.credit_object_id}`),
    });
  }
  if (rows.length === 1) {
    return { creditObjectType: rows[0].credit_object_type, creditObjectId: rows[0].credit_object_id };
  }
  return { creditObjectType: DEFAULT_CREDIT_OBJECT_TYPE, creditObjectId: String(customerId) };
}

function loadScopeProfiles(db, { customerId, salespersonId, creditObjectType, creditObjectId, businessDate }) {
  const aggregate = resolveEffectiveCreditProfile(db, {
    customerId, salespersonId: null, creditObjectType, creditObjectId, businessDate,
  });
  const salesperson = salespersonId
    ? resolveEffectiveCreditProfile(db, {
      customerId, salespersonId, creditObjectType, creditObjectId, businessDate,
    })
    : null;
  return { aggregate, salesperson };
}

// Pure scope resolution (§36.3.1). It performs no locking and no writes; the
// caller supplies the resolved profile rows.
export function resolveApplicableCreditScopes({
  aggregateProfile,
  salespersonProfile,
  salespersonId = null,
  subLimitOnlyAllowed = false,
}) {
  const scopes = [];
  const failClosed = [];
  // §37.36.2 / B-9 O2 — effective-date resolution remains owned by the
  // actor-free Wave 9 resolver.  The Wave 10 consumer decides whether the
  // resolved row is enforceable.  A non-ACTIVE row is authoritative for its
  // interval and must never fall back to an older ACTIVE version or to the
  // aggregate scope.
  for (const [scopeType, profile] of [
    [AGGREGATE_SCOPE, aggregateProfile],
    [SALESPERSON_SCOPE, salespersonProfile],
  ]) {
    if (profile && profile.status !== 'ACTIVE') {
      failClosed.push({
        code: 'CREDIT_PROFILE_NOT_ENFORCEABLE',
        message: '当前生效信用档案不可用于新信用承诺',
        scopeType,
        creditProfileId: profile.id,
        profileStatus: profile.status,
      });
    }
  }
  if (failClosed.length) return { scopes: [], failClosed, applicable: false };
  if (aggregateProfile) {
    scopes.push({ scopeType: AGGREGATE_SCOPE, profile: aggregateProfile, salespersonId: null });
  }
  if (salespersonId && salespersonProfile) {
    scopes.push({ scopeType: SALESPERSON_SCOPE, profile: salespersonProfile, salespersonId });
  }
  if (!scopes.length) {
    failClosed.push({ code: 'CREDIT_PROFILE_MISSING', message: '缺少强制信用档案' });
    return { scopes, failClosed, applicable: false };
  }
  if (!aggregateProfile && salespersonProfile && !subLimitOnlyAllowed) {
    // §36.3.1 — a salesperson-only profile without the P5 permission is not an
    // enforceable scope. It fails closed; it never becomes a PASS.
    failClosed.push({ code: 'P5_SUB_LIMIT_ONLY', message: '仅销售员信用档案且策略不允许单独控制' });
    return { scopes: [], failClosed, applicable: false };
  }
  return { scopes, failClosed, applicable: true };
}

// ---------------------------------------------------------------------------
// §36.3.2 — PURE_DERIVED exposure projection
// ---------------------------------------------------------------------------

function readApprovedOrders(db, customerId, businessDate) {
  return db.prepare(`SELECT id, order_no, total_cents, salesperson_id, commercial_close_state, reviewed_at
    FROM sales_orders WHERE customer_id=? AND status='APPROVED' AND SUBSTR(reviewed_at,1,10)<=?
    ORDER BY id`).all(customerId, businessDate);
}

function readConfirmedDeliveries(db, customerId, businessDate) {
  return db.prepare(`SELECT id, sales_order_id, total_cents FROM sales_deliveries
    WHERE customer_id=? AND status='CONFIRMED' AND SUBSTR(confirmed_at,1,10)<=? ORDER BY id`)
    .all(customerId, businessDate);
}

function readOpenReceivables(db, customerId, businessDate) {
  // Every AR row that has not been converted away is read, including the rows
  // whose open amount is already zero. A settled row still proves that the
  // obligation has left the SO-commitment and delivered stages, and it must
  // never be counted twice.
  return db.prepare(`SELECT id, customer_id, source_type, source_id, amount_cents, open_amount_cents, recognition_mode,
      item_kind, item_class, due_date FROM account_receivables
    WHERE customer_id=? AND conversion_state='OPEN' AND SUBSTR(business_date,1,10)<=?
    ORDER BY id`).all(customerId, businessDate);
}

// §36.3.2.1 — the Sales source chain of an AR row. The chain resolution and
// the attribution classification are separate questions: a row can carry a
// resolvable source chain and still be attribution-ambiguous.
function inconsistentReceivableSource(receivable, reason, evidence = {}) {
  throw new HttpError(409, '应收来源证据不完整或不一致，信用检查已拒绝', {
    code: 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT',
    receivableId: receivable.id,
    reason,
    ...evidence,
  });
}

function resolveInvoiceReceivableSource(db, receivable) {
  const invoice = db.prepare(`SELECT id,customer_id,status,gross_cents FROM sales_invoices WHERE id=?`)
    .get(receivable.source_id);
  if (!invoice || invoice.customer_id !== receivable.customer_id || !['POSTED', 'REVERSED'].includes(invoice.status)) {
    return inconsistentReceivableSource(receivable, 'INVOICE_IDENTITY_INVALID');
  }
  if (Number(invoice.gross_cents) !== Number(receivable.amount_cents)) {
    return inconsistentReceivableSource(receivable, 'INVOICE_AR_AMOUNT_MISMATCH');
  }
  const links = db.prepare(`SELECT id,source_type,source_id,source_line_id,invoiced_amount_cents
    FROM finance_invoice_source_links
    WHERE invoice_id=? AND invoice_side='SALES_INVOICE'
    ORDER BY source_type,source_id,source_line_id,id`).all(invoice.id);
  if (!links.length) return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_LINK_MISSING');

  const logicalLinks = new Set();
  const byOrder = new Map();
  let allocatedCents = 0;
  for (const link of links) {
    const logicalKey = `${link.source_type}|${link.source_id}|${link.source_line_id || ''}`;
    if (logicalLinks.has(logicalKey)) {
      return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_LINK_DUPLICATE', { sourceIdentity: logicalKey });
    }
    logicalLinks.add(logicalKey);
    const amount = Number(link.invoiced_amount_cents);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_AMOUNT_INVALID', { sourceIdentity: logicalKey });
    }
    if (link.source_type !== 'SALES_DELIVERY') {
      return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_TYPE_UNSUPPORTED', { sourceType: link.source_type });
    }
    const delivery = db.prepare(`SELECT id,sales_order_id,customer_id FROM sales_deliveries WHERE id=?`).get(link.source_id);
    const deliveryItem = db.prepare(`SELECT id,delivery_id,sales_order_item_id FROM sales_delivery_items WHERE id=?`).get(link.source_line_id);
    if (!delivery || !deliveryItem || deliveryItem.delivery_id !== delivery.id || !deliveryItem.sales_order_item_id) {
      return inconsistentReceivableSource(receivable, 'DELIVERY_SOURCE_LINE_INVALID', { sourceIdentity: logicalKey });
    }
    const orderItem = db.prepare(`SELECT id,order_id FROM sales_order_items WHERE id=?`).get(deliveryItem.sales_order_item_id);
    const order = orderItem
      ? db.prepare(`SELECT id,customer_id,salesperson_id FROM sales_orders WHERE id=?`).get(orderItem.order_id)
      : null;
    if (!order || order.id !== delivery.sales_order_id) {
      return inconsistentReceivableSource(receivable, 'SALES_ORDER_SOURCE_CHAIN_BROKEN', { sourceIdentity: logicalKey });
    }
    if (delivery.customer_id !== receivable.customer_id || order.customer_id !== receivable.customer_id) {
      return inconsistentReceivableSource(receivable, 'CROSS_CUSTOMER_SOURCE_LINK', { sourceIdentity: logicalKey });
    }
    allocatedCents += amount;
    if (!Number.isSafeInteger(allocatedCents)) {
      return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_AMOUNT_UNSAFE');
    }
    const current = byOrder.get(order.id) || {
      orderId: order.id,
      salespersonId: order.salesperson_id || null,
      transitionedCents: 0,
    };
    if (current.salespersonId !== (order.salesperson_id || null)) {
      return inconsistentReceivableSource(receivable, 'ORDER_SALESPERSON_INCONSISTENT', { orderId: order.id });
    }
    current.transitionedCents += amount;
    byOrder.set(order.id, current);
  }
  if (allocatedCents !== Number(receivable.amount_cents)) {
    return inconsistentReceivableSource(receivable, 'INVOICE_SOURCE_ALLOCATION_NOT_CONSERVED', {
      allocatedCents,
      receivableAmountCents: Number(receivable.amount_cents),
    });
  }
  return { chain: 'RESOLVED', allocations: [...byOrder.values()], invoiceId: invoice.id };
}

function resolveReceivableSource(db, receivable) {
  const sourceType = String(receivable.source_type || '');
  if (sourceType === 'SALES_INVOICE') return resolveInvoiceReceivableSource(db, receivable);
  if (sourceType === 'SALES_DELIVERY') {
    const delivery = db.prepare('SELECT id, sales_order_id FROM sales_deliveries WHERE id=?').get(receivable.source_id);
    if (!delivery || !delivery.sales_order_id) return { orderId: null, salespersonId: null, chain: 'BROKEN' };
    const order = db.prepare('SELECT id, salesperson_id FROM sales_orders WHERE id=?').get(delivery.sales_order_id);
    if (!order) return { orderId: null, salespersonId: null, chain: 'BROKEN' };
    return { orderId: order.id, salespersonId: order.salesperson_id || null, chain: 'RESOLVED' };
  }
  if (sourceType === 'SALES_ORDER') {
    const order = db.prepare('SELECT id, salesperson_id FROM sales_orders WHERE id=?').get(receivable.source_id);
    if (!order) return { orderId: null, salespersonId: null, chain: 'BROKEN' };
    return { orderId: order.id, salespersonId: order.salesperson_id || null, chain: 'RESOLVED' };
  }
  return { orderId: null, salespersonId: null, chain: 'NOT_SALES' };
}

// §36.3.2.1 — salesperson attribution evidence policy.
function resolveReceivableAttribution(db, receivable) {
  if (String(receivable.item_class || '') !== 'SOURCE') {
    return { kind: 'ATTRIBUTION_AMBIGUOUS', reason: 'ITEM_CLASS_NOT_SOURCE' };
  }
  const source = resolveReceivableSource(db, receivable);
  if (source.chain !== 'RESOLVED') return { kind: 'ATTRIBUTION_AMBIGUOUS', reason: 'SOURCE_CHAIN_BROKEN' };
  if (source.allocations) {
    const open = Number(receivable.open_amount_cents || 0);
    const original = Number(receivable.amount_cents || 0);
    const bySalesperson = new Map();
    for (const allocation of source.allocations) {
      if (!allocation.salespersonId) {
        return { kind: 'ATTRIBUTION_AMBIGUOUS', reason: 'SOURCE_SALESPERSON_MISSING' };
      }
      bySalesperson.set(
        allocation.salespersonId,
        (bySalesperson.get(allocation.salespersonId) || 0) + allocation.transitionedCents,
      );
    }
    if (open === original) {
      return {
        kind: 'PROVABLY_ALLOCATED',
        allocations: [...bySalesperson].map(([salespersonId, amountCents]) => ({ salespersonId, amountCents })),
      };
    }
    if (bySalesperson.size === 1) {
      return { kind: 'PROVABLY_ATTRIBUTABLE', salespersonId: [...bySalesperson.keys()][0] };
    }
    return { kind: 'ATTRIBUTION_AMBIGUOUS', reason: 'PARTIAL_MULTI_SALESPERSON_REMAINDER' };
  }
  if (!source.salespersonId) return { kind: 'ATTRIBUTION_AMBIGUOUS', reason: 'SOURCE_SALESPERSON_MISSING', orderId: source.orderId };
  return { kind: 'PROVABLY_ATTRIBUTABLE', salespersonId: source.salespersonId, orderId: source.orderId };
}

// §36.3.2 / §36.3.2.2 — the transition-aware exposure projection. Every
// obligation occupies exactly one stage, so the same economic amount is never
// counted twice.
export function computeCreditExposure(db, { customerId, salespersonId = null, businessDate }) {
  const orders = readApprovedOrders(db, customerId, businessDate);
  const deliveries = readConfirmedDeliveries(db, customerId, businessDate);
  const receivables = readOpenReceivables(db, customerId, businessDate);

  const deliveredByOrder = new Map();
  for (const delivery of deliveries) {
    if (!delivery.sales_order_id) continue;
    deliveredByOrder.set(delivery.sales_order_id, (deliveredByOrder.get(delivery.sales_order_id) || 0) + Number(delivery.total_cents || 0));
  }

  const arByOrder = new Map();
  const arBySalesperson = new Map();
  let arOpenTotal = 0;
  let ambiguousOpenCents = 0;
  for (const receivable of receivables) {
    const open = Number(receivable.open_amount_cents || 0);
    const source = resolveReceivableSource(db, receivable);
    const transitions = source.allocations || (source.orderId
      ? [{ orderId: source.orderId, salespersonId: source.salespersonId, transitionedCents: Number(receivable.amount_cents || 0) }]
      : []);
    for (const transition of transitions) {
      // The transition amount leaves the SO-commitment and delivered stages
      // whether the AR is still open or already settled.
      const entry = arByOrder.get(transition.orderId) || { transitioned: 0, open: 0 };
      entry.transitioned += Number(transition.transitionedCents || 0);
      entry.open += open;
      arByOrder.set(transition.orderId, entry);
    }
    if (open <= 0) continue;
    arOpenTotal += open;
    const attribution = resolveReceivableAttribution(db, receivable);
    if (attribution.kind === 'PROVABLY_ALLOCATED') {
      for (const allocation of attribution.allocations) {
        arBySalesperson.set(
          allocation.salespersonId,
          (arBySalesperson.get(allocation.salespersonId) || 0) + allocation.amountCents,
        );
      }
      continue;
    }
    if (attribution.kind !== 'PROVABLY_ATTRIBUTABLE') {
      ambiguousOpenCents += open;
      continue;
    }
    arBySalesperson.set(attribution.salespersonId, (arBySalesperson.get(attribution.salespersonId) || 0) + open);
  }

  let soCommitmentCents = 0;
  let deliveredNotSettledCents = 0;
  let ambiguousCommitmentCents = 0;
  let salespersonCommitmentCents = 0;
  let salespersonDeliveredNotSettledCents = 0;
  for (const order of orders) {
    const total = Number(order.total_cents || 0);
    const delivered = deliveredByOrder.get(order.id) || 0;
    const ar = arByOrder.get(order.id) || { transitioned: 0, open: 0 };
    if (ar.transitioned > delivered) {
      inconsistentReceivableSource({ id: `ORDER:${order.id}` }, 'TRANSITION_EXCEEDS_DELIVERED_OBLIGATION', {
        orderId: order.id,
        transitionedCents: ar.transitioned,
        deliveredCents: delivered,
      });
    }
    // B-10 O1 — elapsed time never releases a commitment.  A canonical
    // commercial close/cancel does release the undelivered remainder, while
    // already delivered / invoiced / open-AR portions remain represented by
    // their own authoritative stages.
    const stageA = order.commercial_close_state === 'OPEN' ? Math.max(0, total - delivered) : 0;
    const stageB = Math.max(0, delivered - ar.transitioned);
    soCommitmentCents += stageA;
    deliveredNotSettledCents += stageB;
    if (!order.salesperson_id) {
      // §36.3.2.4 — an obligation without salesperson provenance counts in full
      // in the customer aggregate and is attribution-ambiguous for every
      // salesperson sub-limit.
      ambiguousCommitmentCents += stageA + stageB;
      continue;
    }
    if (order.salesperson_id === salespersonId) {
      salespersonCommitmentCents += stageA;
      salespersonDeliveredNotSettledCents += stageB;
    }
  }

  const aggregateComponents = {
    approvedSoCommitmentCents: soCommitmentCents,
    deliveredNotSettledCents: deliveredNotSettledCents,
    arOpenCents: arOpenTotal,
    eligiblePrepaymentCents: 0,
    ambiguousAttributionCents: ambiguousCommitmentCents + ambiguousOpenCents,
  };
  const salespersonComponents = {
    approvedSoCommitmentCents: salespersonCommitmentCents,
    deliveredNotSettledCents: salespersonDeliveredNotSettledCents,
    arOpenCents: arBySalesperson.get(salespersonId) || 0,
    eligiblePrepaymentCents: 0,
    ambiguousAttributionCents: ambiguousCommitmentCents + ambiguousOpenCents,
  };

  return {
    aggregateComponents,
    salespersonComponents,
    ambiguousAttributionCents: ambiguousCommitmentCents + ambiguousOpenCents,
    hasAmbiguousAttribution: (ambiguousCommitmentCents + ambiguousOpenCents) > 0,
    orderCount: orders.length,
    deliveryCount: deliveries.length,
    receivableCount: receivables.length,
  };
}

// ---------------------------------------------------------------------------
// §36.6.3 steps 3..5 — scopes, anchors and the lock chain
// ---------------------------------------------------------------------------

function resolvePolicyScopeAnchors(db) {
  const rows = db.prepare(`SELECT * FROM credit_lock_anchors WHERE anchor_type='POLICY_SCOPE' ORDER BY anchor_key`).all();
  if (!rows.length) {
    throw new HttpError(500, '信用策略范围锚点缺失，信用控制已整体停用', { code: 'CREDIT_POLICY_SCOPE_ANCHOR_MISSING' });
  }
  return rows;
}

function effectiveRuleRows(db, stage, businessDate) {
  return db.prepare(`SELECT * FROM credit_check_rules WHERE business_stage=? AND status='ACTIVE' AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY id`).all(stage, businessDate, businessDate);
}

function ruleAppliesToMode(rule, recognitionMode) {
  const mode = rule.recognition_mode;
  return mode == null || String(mode).trim() === '' || String(mode) === recognitionMode;
}

// §36.6.4 — the outcome a rule produces when the scope is over its ceiling.
function ruleOutcome(rule) {
  if (rule.scenario === 'OVERRIDE_REQUEST') return 'SPECIAL_APPROVAL_REQUIRED';
  if (rule.scenario === 'WARNING_ONLY') return 'WARNING';
  if (rule.scenario === 'BLOCK') return 'BLOCK';
  return rule.control_strength === 'BLOCK' ? 'BLOCK' : 'WARNING';
}

const OUTCOME_RANK = Object.freeze({ PASS: 0, SPECIAL_APPROVAL_REQUIRED: 1, WARNING: 2, BLOCK: 3 });

function strongestOutcome(outcomes) {
  let best = 'PASS';
  for (const outcome of outcomes) {
    if (OUTCOME_RANK[outcome] > OUTCOME_RANK[best]) best = outcome;
  }
  return best;
}

// ---------------------------------------------------------------------------
// §36.6.3 step 6 — per-scope evaluation
// ---------------------------------------------------------------------------

function buildScopeHashes(db, { scopes, businessDate }) {
  const parameters = db.prepare(`SELECT id, code, value_text, value_int, value_bool, value_date, effective_from, effective_to
    FROM credit_parameters WHERE status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY code, effective_from, id`).all(businessDate, businessDate);
  const rules = effectiveRuleRows(db, scopes[0]?.stage, businessDate);
  const profileState = scopes.map((scope) => ({
    scopeType: scope.scopeType,
    id: scope.profile.id,
    anchorId: scope.profile.anchor_id,
    creditLimitCents: scope.profile.credit_limit_cents == null ? null : Number(scope.profile.credit_limit_cents),
    status: scope.profile.status,
    initialState: scope.profile.initial_state,
    ratingGrade: scope.profile.rating_grade,
    ratingEffectiveFrom: scope.profile.rating_effective_from,
    ratingEffectiveTo: scope.profile.rating_effective_to,
    overdueDayPolicy: scope.profile.overdue_day_policy,
    ruleId: scope.profile.rule_id,
    effectiveFrom: scope.profile.effective_from,
    effectiveTo: scope.profile.effective_to,
  }));
  return {
    parameterSetHash: sha256(canonicalJson(parameters)),
    ruleSetHash: sha256(canonicalJson(rules.map((rule) => ({
      id: rule.id, ruleCode: rule.rule_code, businessStage: rule.business_stage, scenario: rule.scenario,
      checkTiming: rule.check_timing, controlStrength: rule.control_strength, creditItem: rule.credit_item,
      recognitionMode: rule.recognition_mode, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to,
      resultPayloadJson: rule.result_payload_json,
    })))),
    profileEffectiveStateHash: sha256(canonicalJson(profileState)),
  };
}

// ---------------------------------------------------------------------------
// §36.6.6 — Special Approval consumption
// ---------------------------------------------------------------------------

function findConsumableApproval(db, scope, snapshot, businessDate) {
  const rows = db.prepare(`SELECT * FROM credit_special_approval
    WHERE decision='APPROVED' AND scope_type=?
      AND source_credit_policy_snapshot_id=?
      AND source_policy_snapshot_fingerprint=?
      AND (source_sales_order_id IS NULL OR source_sales_order_id=?)
    ORDER BY decided_at, id`).all(
    scope.scopeType,
    snapshot.id,
    snapshot.snapshot_fingerprint,
    scope.sourceSalesOrderId || null,
  );
  for (const row of rows) {
    if (row.approved_expiry_business_date && String(row.approved_expiry_business_date) < businessDate) continue;
    if (row.scope_mode === 'ONE_TIME') {
      const consumed = db.prepare(`SELECT 1 present FROM audit_logs
        WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND entity_id=? AND action='CONSUME' LIMIT 1`).get(row.id);
      if (consumed) continue;
    }
    return row;
  }
  return null;
}

function approvalReleasesScope(approval, { proposedTotalCents, overLimitCents }) {
  const ceiling = approval.approved_ceiling_cents == null ? null : Number(approval.approved_ceiling_cents);
  const override = approval.approved_override_cents == null ? null : Number(approval.approved_override_cents);
  if (ceiling == null || override == null) return false;
  if (proposedTotalCents > ceiling) return false;
  if (overLimitCents > override) return false;
  return true;
}

// ---------------------------------------------------------------------------
// §36.6.3 — the engine
// ---------------------------------------------------------------------------

function normalizeSourceRef(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') {
    throw new HttpError(400, '来源单据引用不完整');
  }
  const sourceType = requiredCode(sourceRef.sourceType, '来源类型');
  const sourceId = requiredText(sourceRef.sourceId, '来源单据', 128);
  if (sourceType === 'SALES_ORDER') return { sourceType, sourceId, salesOrderId: sourceId, salesDeliveryId: null };
  if (sourceType === 'SALES_DELIVERY') return { sourceType, sourceId, salesOrderId: null, salesDeliveryId: sourceId };
  throw new HttpError(400, '来源类型仅支持 SALES_ORDER / SALES_DELIVERY');
}

/**
 * Evaluate one Credit Check.
 *
 * The caller MUST already own the transaction. The Credit Check opens no
 * transaction of its own; when it is used from an HTTP endpoint the endpoint
 * wraps it in `transaction()`.
 *
 * Returns `{ enforced, decision, checkGroupId, scopeResults, ... }`.
 * `enforced === false` means Credit Management is disabled for the business
 * date and no control applies (§29.22.1).
 */
export function evaluateCredit(db, input) {
  const stage = requiredCode(input.stage, '信用检查阶段');
  if (!CREDIT_CHECK_STAGES.includes(stage)) throw new HttpError(400, '信用检查阶段无效');
  const businessDate = normalizeBusinessDate(input.businessDate, '业务日期');
  const customerId = requiredText(input.customerId, '客户', 128);
  const salespersonId = input.salespersonId ? String(input.salespersonId) : null;
  const proposedDeltaCents = toCents(input.proposedDeltaCents, '本次信用敞口增量');
  const source = normalizeSourceRef(input.sourceRef);
  const actorId = input.actorId || null;
  const authorizationContext = String(input.authorizationContext ?? actorId ?? 'SYSTEM');
  // A pure evaluation never burns a one-time approval. Only the business
  // decision path consumes one, and it records the consumption in the audit
  // trail inside the same transaction.
  const consumeApprovals = input.consumeApprovals !== false;

  // ---- step 1: Credit Management enabled gate -----------------------------
  if (!isCreditManagementEnabled(db, businessDate)) {
    return {
      enforced: false,
      decision: 'PASS',
      checkGroupId: null,
      scopeResults: [],
      reasonCodes: ['CREDIT_MANAGEMENT_DISABLED'],
    };
  }

  // ---- step 3: the applicable rule set and the control scopes -------------
  // §36.6.1 — a stage is credit-controlled only when an effective rule exists
  // for it. Without a rule the stage carries no Credit control at all, so the
  // check does not run and leaves no evidence behind.
  const recognitionMode = requiredCode(input.recognitionMode, '确认模式');
  const applicableRules = effectiveRuleRows(db, stage, businessDate).filter((rule) => ruleAppliesToMode(rule, recognitionMode));
  if (!applicableRules.length) {
    return {
      enforced: false,
      decision: 'PASS',
      checkGroupId: null,
      scopeResults: [],
      reasonCodes: ['NO_APPLICABLE_EFFECTIVE_RULE'],
    };
  }
  const stageMandatory = applicableRules.some((rule) => rule.control_strength === 'BLOCK');

  const creditObject = resolveCustomerCreditObject(db, {
    customerId,
    businessDate,
    creditObjectType: input.creditObjectType || null,
    creditObjectId: input.creditObjectId || null,
  });
  const { aggregate, salesperson } = loadScopeProfiles(db, {
    customerId, salespersonId, creditObjectType: creditObject.creditObjectType,
    creditObjectId: creditObject.creditObjectId, businessDate,
  });
  const scopeResolution = resolveApplicableCreditScopes({
    aggregateProfile: aggregate,
    salespersonProfile: salesperson,
    salespersonId,
    subLimitOnlyAllowed: readSubLimitOnlyAllowed(db, businessDate),
  });
  if (!scopeResolution.applicable) {
    const reason = scopeResolution.failClosed[0];
    throw new HttpError(409, reason.message || '信用检查无法通过', {
      ...reason,
      code: reason.code,
      reasonCodes: scopeResolution.failClosed.map((item) => item.code),
      customerId,
      stage,
      businessDate,
    });
  }
  const scopes = scopeResolution.scopes.map((scope) => ({ ...scope, stage }));

  // ---- step 1 of the lock chain: the Finance PREPAYMENT parent lock -------
  // §36.3.4 step 1 — the Finance PREPAYMENT parent balance is the first lock
  // the Credit Check itself takes, and it is always taken through the frozen
  // discover -> plan -> lock -> assert pattern (§36.3.4.1 C-1). When the
  // enclosing transaction already holds the parent locks (the Sales Order and
  // Sales Delivery gate phases take them at L1), the Credit Check reuses them
  // instead of re-entering the parent-lock phase.
  if (input.prepaymentParentsLocked !== true) {
    lockCreditPrepaymentParents(db, { customerId, businessDate });
  }

  // ---- step 4 / 5: anchors and the lock chain ----------------------------
  // L2 — POLICY_SCOPE anchors FOR SHARE, anchor_key ASC.
  const policyAnchors = resolvePolicyScopeAnchors(db);
  for (const anchor of policyAnchors) {
    db.prepare(`SELECT id FROM credit_lock_anchors WHERE id=?${shareLockSuffix(db)}`).get(anchor.id);
  }
  // L3 / L4 — the aggregate anchor is always taken before the salesperson anchor.
  const anchorByScope = new Map();
  for (const scope of scopes) {
    const anchor = ensureCreditLockAnchor(db, {
      anchorType: 'CREDIT_OBJECT',
      customerId,
      salespersonId: scope.salespersonId,
      creditObjectType: creditObject.creditObjectType,
      creditObjectId: creditObject.creditObjectId,
    });
    anchorByScope.set(scope.scopeType, anchor);
    scope.anchorId = anchor.id;
    scope.anchorKey = anchor.anchor_key;
  }
  // L5 — the effective profile rows, id ASC.
  const profileIds = scopes.map((scope) => scope.profile.id).sort();
  for (const profileId of profileIds) {
    db.prepare(`SELECT id FROM credit_profile WHERE id=?${lockSuffix(db)}`).get(profileId);
  }

  // ---- step 6: exposure, evaluation and the policy snapshot --------------
  const exposure = computeCreditExposure(db, { customerId, salespersonId, businessDate });
  // §36.3.2 — the eligible prepayment is an aggregate-only offset. It is read
  // through the frozen Finance adapter beneath the L1 parent locks that the
  // caller already holds (or that this engine took for a standalone check).
  const prepayment = resolveEligiblePrepaymentForSalesGate(db, {
    customerId,
    businessDate,
    gateStage: 'CREDIT_CHECK',
    salesOrderId: source.salesOrderId || source.salesDeliveryId,
    remainingRequiredCents: 0,
    lockMode: 'NONE',
  });
  const eligiblePrepaymentCents = Number(prepayment.eligibleAmountCents || 0);
  exposure.aggregateComponents.eligiblePrepaymentCents = eligiblePrepaymentCents;

  const hashes = buildScopeHashes(db, { scopes, businessDate });

  // §36.3.4 step 6 — the snapshot is created or selected before the decision
  // is written, so the evidence always precedes the artifact that cites it.
  const snapshots = new Map();
  for (const scope of scopes) {
    const snapshot = ensureCreditPolicySnapshot(db, {
      creditLockAnchorId: scope.anchorId,
      scopeType: scope.scopeType,
      creditProfileId: scope.profile.id,
      businessDate,
      parameterSetHash: hashes.parameterSetHash,
      ruleSetHash: hashes.ruleSetHash,
      profileEffectiveStateHash: hashes.profileEffectiveStateHash,
      capturedBy: actorId,
      notes: {
        contractVersion: 'CREDIT_POLICY_SNAPSHOT_WAVE10_V1',
        stage,
        recognitionMode,
        checkGroupScope: scopes.map((item) => item.scopeType),
      },
    });
    snapshots.set(scope.scopeType, snapshot);
  }

  // §36.3.4 step 7 — the effective rule rows FOR UPDATE, id ASC. The rule set
  // must not have changed under the snapshot that was just recorded.
  for (const rule of applicableRules) {
    db.prepare(`SELECT id FROM credit_check_rules WHERE id=?${lockSuffix(db)}`).get(rule.id);
  }
  const lockedRuleHash = buildScopeHashes(db, { scopes, businessDate }).ruleSetHash;
  if (lockedRuleHash !== hashes.ruleSetHash) {
    throw new HttpError(409, '信用规则在锁定后发生变化', { code: 'CREDIT_RULE_CHANGED_UNDER_LOCK' });
  }

  const subLimitMandatory = readSubLimitMandatory(db, businessDate);
  const scopeResults = [];
  for (const scope of scopes) {
    const components = scope.scopeType === AGGREGATE_SCOPE ? exposure.aggregateComponents : exposure.salespersonComponents;
    const exposureCents = Number(components.approvedSoCommitmentCents || 0)
      + Number(components.deliveredNotSettledCents || 0)
      + Number(components.arOpenCents || 0)
      - Number(components.eligiblePrepaymentCents || 0);
    const limitCents = scope.profile.credit_limit_cents == null ? null : Number(scope.profile.credit_limit_cents);
    const availableCents = limitCents == null ? null : limitCents - exposureCents;
    const proposedTotalCents = exposureCents + proposedDeltaCents;
    const overLimitCents = limitCents == null ? 0 : Math.max(0, proposedTotalCents - limitCents);
    const overLimit = limitCents != null && proposedTotalCents > limitCents;

    const reasonCodes = [];
    let decision = 'PASS';
    let releasable = false;

    if (scope.scopeType === SALESPERSON_SCOPE && stageMandatory && exposure.hasAmbiguousAttribution) {
      // §36.3.2.1 — an ambiguous obligation can never be discharged from a
      // mandatory sub-limit. The amount is never split and never assigned.
      decision = 'BLOCK';
      reasonCodes.push('UNPROVEN_ATTRIBUTION');
    } else if (scope.scopeType === SALESPERSON_SCOPE && stageMandatory && readOverdueDayPolicy(db, scope.profile, businessDate) === null) {
      // §36.3.3 — an undefined overdue-day policy fails closed.
      decision = 'BLOCK';
      reasonCodes.push('OVERDUE_POLICY_UNDEFINED');
    } else if (!applicableRules.length) {
      // §36.6.4 — a scope with no matching effective rule is never PASS by
      // omission.
      decision = stageMandatory ? 'BLOCK' : 'WARNING';
      reasonCodes.push('NO_MATCHING_EFFECTIVE_RULE');
    } else if (!overLimit) {
      decision = 'PASS';
      reasonCodes.push(limitCents == null ? 'UNLIMITED_PROFILE' : 'WITHIN_LIMIT');
    } else {
      decision = strongestOutcome(applicableRules.map(ruleOutcome));
      // A mandatory BLOCK is a fail-closed outcome and is never released by an
      // approval. Only the explicit exception outcome is releasable.
      releasable = decision === 'SPECIAL_APPROVAL_REQUIRED';
      reasonCodes.push('OVER_LIMIT');
      if (decision === 'SPECIAL_APPROVAL_REQUIRED') reasonCodes.push('SPECIAL_APPROVAL_REQUIRED');
    }
    if (subLimitMandatory && scope.scopeType === SALESPERSON_SCOPE && decision === 'WARNING') {
      // §36.3.3 — an explicitly mandatory sub-limit is enforced with BLOCK
      // strength even when the matched rule only warns.
      decision = 'BLOCK';
      releasable = false;
      reasonCodes.push('OVER_LIMIT');
    }

    scopeResults.push({
      scope,
      snapshot: snapshots.get(scope.scopeType),
      exposureCents,
      availableCents,
      proposedTotalCents,
      overLimitCents,
      limitCents,
      decision,
      releasable,
      reasonCodes,
      components,
    });
  }

  // §36.6.3 step 2 — idempotent resolution of the logical check group. The
  // group identity carries the source, the stage, the business date, the
  // authorization context, the policy snapshot fingerprint and the evaluated
  // exposure, so an exact replay resolves to the same group and a changed
  // fact set produces a new decision instead of a stale one.
  const exposureDigest = sha256(canonicalJson(scopeResults.map((result) => ({
    scopeType: result.scope.scopeType,
    exposureCents: result.exposureCents,
    proposedTotalCents: result.proposedTotalCents,
    availableCents: result.availableCents,
    creditLimitCents: result.limitCents,
  }))));
  const checkGroupId = `CCHK1:${sha256([
    source.sourceType, source.sourceId, stage, businessDate, authorizationContext,
    hashes.parameterSetHash, hashes.ruleSetHash, hashes.profileEffectiveStateHash, exposureDigest,
  ].join('|'))}`;

  const existingRows = db.prepare('SELECT * FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type').all(checkGroupId);
  const isReplay = existingRows.length > 0;

  // §36.6.3 steps 8 and 9 — one result row per applicable scope plus the
  // audit rows carrying the fingerprint and the business date.
  let consumedApprovalId = null;
  for (const result of scopeResults) {
    if (result.releasable) {
      const approval = findConsumableApproval(db, {
        scopeType: result.scope.scopeType,
        sourceSalesOrderId: source.salesOrderId,
      }, result.snapshot, businessDate);
      const releasable = approval && approvalReleasesScope(approval, {
        proposedTotalCents: result.proposedTotalCents,
        overLimitCents: result.overLimitCents,
      });
      result.approvalAvailable = Boolean(releasable);
      if (releasable && consumeApprovals) {
        result.decision = 'PASS';
        result.reasonCodes = result.reasonCodes.filter((code) => code !== 'OVER_LIMIT' && code !== 'SPECIAL_APPROVAL_REQUIRED');
        result.reasonCodes.push('SPECIAL_APPROVAL_CONSUMED');
        consumedApprovalId = approval.id;
        if (!isReplay) {
          audit(db, actorId, 'CONSUME', 'CREDIT_SPECIAL_APPROVAL', approval.id, JSON.stringify({
            checkGroupId, scopeType: result.scope.scopeType, businessDate,
            proposedTotalCents: result.proposedTotalCents, approvedCeilingCents: Number(approval.approved_ceiling_cents),
          }));
        }
      }
    }
    if (isReplay) continue;
    const rowId = `${checkGroupId}:${result.scope.scopeType}`;
    const eligiblePrepaymentIdentity = result.scope.scopeType === AGGREGATE_SCOPE
      ? JSON.stringify(prepayment.sourceBalanceIdentities || [])
      : null;
    db.prepare(`INSERT INTO credit_check_results(id, check_group_id, scope_type, credit_lock_anchor_id,
        credit_profile_id, credit_policy_snapshot_id, policy_snapshot_fingerprint, profile_effective_state_hash,
        sales_order_id, sales_delivery_id, stage, business_date, proposed_delta_cents, recognition_mode,
        decision, reason_codes_json, component_breakdown_json, eligible_prepayment_source_identity,
        evaluated_at, evaluated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rowId, checkGroupId, result.scope.scopeType, result.scope.anchorId,
      result.scope.profile.id, result.snapshot.id, result.snapshot.snapshot_fingerprint, hashes.profileEffectiveStateHash,
      source.salesOrderId, source.salesDeliveryId, stage, businessDate, proposedDeltaCents, recognitionMode,
      result.decision, JSON.stringify(result.reasonCodes), JSON.stringify({
        contractVersion: 'CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1',
        exposureCents: result.exposureCents,
        availableCents: result.availableCents,
        proposedTotalCents: result.proposedTotalCents,
        overLimitCents: result.overLimitCents,
        creditLimitCents: result.limitCents,
        components: result.components,
        exposureDigest,
        consumedSpecialApprovalId: consumedApprovalId,
      }), eligiblePrepaymentIdentity, new Date().toISOString(), actorId,
    );
  }

  if (!isReplay) {
    audit(db, actorId, 'EVALUATE', 'CREDIT_CHECK', checkGroupId, JSON.stringify({
      stage,
      businessDate,
      decision: strongestOutcome(scopeResults.map((result) => result.decision)),
      policySnapshotFingerprint: hashes.profileEffectiveStateHash ? scopeResults[0]?.snapshot?.snapshot_fingerprint : null,
      scopeResults: scopeResults.map((result) => ({
        scopeType: result.scope.scopeType,
        decision: result.decision,
        exposureCents: result.exposureCents,
        availableCents: result.availableCents,
        proposedTotalCents: result.proposedTotalCents,
        reasonCodes: result.reasonCodes,
      })),
      consumedSpecialApprovalId: consumedApprovalId,
    }));
  }

  const decision = strongestOutcome(scopeResults.map((result) => result.decision));
  return {
    enforced: true,
    decision,
    checkGroupId,
    replayed: isReplay,
    scopeResults: scopeResults.map((result) => ({
      scopeType: result.scope.scopeType,
      creditLockAnchorId: result.scope.anchorId,
      creditProfileId: result.scope.profile.id,
      creditPolicySnapshotId: result.snapshot.id,
      policySnapshotFingerprint: result.snapshot.snapshot_fingerprint,
      availableCents: result.availableCents,
      exposureCents: result.exposureCents,
      proposedTotalCents: result.proposedTotalCents,
      decision: result.decision,
      reasonCodes: result.reasonCodes,
      creditLimitCents: result.limitCents,
      approvalAvailable: Boolean(result.approvalAvailable),
      components: result.components,
    })),
    consumedSpecialApprovalId: consumedApprovalId,
    recognitionMode,
    httpStatus: decision === 'PASS' || decision === 'WARNING' ? 200 : 409,
  };
}

/**
 * §36.3.4 step 1 — the Finance PREPAYMENT parent lock. The Credit Check takes
 * it through the frozen discover -> plan -> lock -> assert pattern, and it is
 * always the first row lock the Credit Check itself acquires.
 */
export function lockCreditPrepaymentParents(db, { customerId, businessDate }) {
  const planned = discoverEligiblePrepaymentParents(db, { customerId, businessDate });
  lockEligiblePrepaymentParents(db, planned);
  assertPrepaymentParentPlanCurrent(db, { customerId, businessDate }, planned);
  return planned;
}

/**
 * Business-path helper. The caller MUST already own the transaction and MUST
 * already hold the L1 Finance PREPAYMENT parent locks when the enclosing
 * transaction is a Sales Order or Sales Delivery path.
 */
export function assertCreditAllowsBusinessAction(db, input) {
  const outcome = evaluateCredit(db, input);
  if (!outcome.enforced) return outcome;
  if (outcome.decision === 'PASS' || outcome.decision === 'WARNING') return outcome;
  const code = outcome.decision === 'BLOCK'
    ? 'CREDIT_CHECK_BLOCKED'
    : 'CREDIT_SPECIAL_APPROVAL_REQUIRED';
  throw new HttpError(409, outcome.decision === 'BLOCK' ? '信用检查未通过' : '信用检查需要特别审批', {
    code,
    decision: outcome.decision,
    checkGroupId: outcome.checkGroupId,
    reasonCodes: outcome.scopeResults.flatMap((result) => result.reasonCodes),
    scopeResults: outcome.scopeResults,
  });
}

// ---------------------------------------------------------------------------
// HTTP surface (§36.9.2)
// ---------------------------------------------------------------------------

function presentResultRow(row) {
  return {
    id: row.id,
    checkGroupId: row.check_group_id,
    scopeType: row.scope_type,
    creditLockAnchorId: row.credit_lock_anchor_id,
    creditProfileId: row.credit_profile_id,
    creditPolicySnapshotId: row.credit_policy_snapshot_id,
    policySnapshotFingerprint: row.policy_snapshot_fingerprint,
    profileEffectiveStateHash: row.profile_effective_state_hash,
    salesOrderId: row.sales_order_id,
    salesDeliveryId: row.sales_delivery_id,
    stage: row.stage,
    businessDate: row.business_date,
    proposedDeltaCents: Number(row.proposed_delta_cents),
    recognitionMode: row.recognition_mode,
    decision: row.decision,
    reasonCodes: JSON.parse(row.reason_codes_json || '[]'),
    componentBreakdown: JSON.parse(row.component_breakdown_json || '{}'),
    eligiblePrepaymentSourceIdentity: row.eligible_prepayment_source_identity,
    evaluatedAt: row.evaluated_at,
    evaluatedBy: row.evaluated_by,
  };
}

// §37.54.5.3 — the Credit Check Result read shape. A result row is
// attributable only through the Credit Profile it was evaluated against, so
// `credit_profile_id` is the anchor of both scopes: a result whose profile
// cannot be attributed is excluded (fail closed) instead of being treated as
// aggregate.
const CREDIT_CHECK_RESULT_SCOPE = Object.freeze({
  aggregateExpr: "scope_type='CUSTOMER_AGGREGATE' AND credit_profile_id IS NOT NULL",
  selfExpr: "scope_type='SALESPERSON_SUB_LIMIT' AND credit_profile_id IN (SELECT id FROM credit_profile WHERE salesperson_scope_key=?)",
});

export function listCreditCheckResults(db, res, actor, url) {
  const readMode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(readMode.mode);
  const scopePredicate = creditScopePredicate(readMode.mode, {
    ...CREDIT_CHECK_RESULT_SCOPE,
    selfValue: readMode.selfSalespersonId,
  });
  // The scope predicate is part of the same statement as the business
  // filters, so filtering can never widen the scope and the ordering and
  // LIMIT are computed over the authorized rows only.
  const where = [scopePredicate.sql];
  const args = [...scopePredicate.args];
  const sourceType = String(url.searchParams.get('sourceType') || '').trim().toUpperCase();
  const sourceId = String(url.searchParams.get('sourceId') || '').trim();
  const stage = String(url.searchParams.get('stage') || '').trim().toUpperCase();
  const checkGroupId = String(url.searchParams.get('checkGroupId') || '').trim();
  if (sourceType === 'SALES_ORDER' && sourceId) { where.push('sales_order_id=?'); args.push(sourceId); }
  if (sourceType === 'SALES_DELIVERY' && sourceId) { where.push('sales_delivery_id=?'); args.push(sourceId); }
  if (stage) { where.push('stage=?'); args.push(stage); }
  if (checkGroupId) { where.push('check_group_id=?'); args.push(checkGroupId); }
  const rows = db.prepare(`SELECT * FROM credit_check_results
    WHERE ${where.join(' AND ')} ORDER BY evaluated_at DESC, id DESC LIMIT 500`).all(...args);
  return send(res, 200, { results: rows.map(presentResultRow) });
}

export async function evaluateCreditCheck(db, req, res, actor) {
  requireCreditEvaluationAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['customerId', 'salespersonId', 'creditObjectType', 'creditObjectId', 'stage',
    'businessDate', 'proposedDeltaCents', 'recognitionMode', 'salesOrderId', 'salesDeliveryId']);
  const stage = requiredCode(body.stage, '信用检查阶段');
  const businessDate = normalizeBusinessDate(body.businessDate, '业务日期');
  const customerId = requiredText(body.customerId, '客户', 128);
  const sourceType = body.salesDeliveryId ? 'SALES_DELIVERY' : 'SALES_ORDER';
  const sourceId = requiredText(body.salesDeliveryId || body.salesOrderId, '来源单据', 128);
  const proposedDeltaCents = body.proposedDeltaCents === undefined ? 0 : toCents(body.proposedDeltaCents, '本次信用敞口增量');
  const recognitionMode = body.recognitionMode
    ? requiredCode(body.recognitionMode, '确认模式')
    : resolveRecognitionPolicy(db, 'AR', 'SALES_DELIVERY', body.salesDeliveryId || null, businessDate).mode;

  let outcome;
  transaction(db, () => {
    outcome = evaluateCredit(db, {
      customerId,
      salespersonId: body.salespersonId || null,
      creditObjectType: body.creditObjectType || null,
      creditObjectId: body.creditObjectId || null,
      stage,
      businessDate,
      proposedDeltaCents,
      recognitionMode,
      sourceRef: { sourceType, sourceId },
      actorId: actor.id,
      authorizationContext: actor.id,
      consumeApprovals: false,
    });
    // A BLOCK evaluation is a refusal. It leaves no evidence behind, exactly
    // like every other rejection path (§37.10 G).
    if (outcome.enforced && outcome.decision === 'BLOCK') {
      throw new HttpError(409, '信用检查未通过', {
        code: 'CREDIT_CHECK_BLOCKED',
        decision: outcome.decision,
        checkGroupId: outcome.checkGroupId,
        reasonCodes: outcome.scopeResults.flatMap((result) => result.reasonCodes),
        scopeResults: outcome.scopeResults,
      });
    }
  });
  return send(res, 200, outcome);
}

export const __creditCheckInternals = Object.freeze({
  CREDIT_PARAMETERS,
  DEFAULT_CREDIT_OBJECT_TYPE,
  sha256,
  canonicalJson,
  ruleOutcome,
  strongestOutcome,
  ruleAppliesToMode,
  readEffectiveParameter,
  readBooleanParameter,
  readOverdueDayPolicy,
  resolveReceivableAttribution,
  findConsumableApproval,
  approvalReleasesScope,
  presentResultRow,
});
