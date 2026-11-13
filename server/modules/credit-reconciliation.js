// Wave 11-D — Credit Reconciliation (SC99) & Deterministic Recalculation (SC100).
//
// solution.md §37.54.11 (the primary implementation contract), §37.54.6.4
// (the independent SC99 / SC100 contracts), §37.54.13.4 (idempotency) and
// §37.54.14.1 (the acceptance architecture).
//
// TWO EXECUTABLE OPERATIONS, NEVER MERGED:
//
//   SC99 CHECK-only Reconciliation
//     POST /api/credit/reconciliation/check
//     compares a reference decision and emits a consistency verdict.
//   SC100 Deterministic Recalculation
//     POST /api/credit/reconciliation/recalculate
//     emits deterministic evidence (the fact digest) and no verdict.
//
// Neither operation produces a Credit Check Decision: no `credit_check_results`
// row, no decision, no policy snapshot write.
//
// ONE CREDIT ALGORITHM. Both operations reuse the Wave 10 primitives —
// `computeCreditExposure`, `resolveEffectiveCreditProfile`, `buildScopeHashes`,
// `computePolicySnapshotFingerprint`, `resolveCustomerCreditObject`,
// `resolveApplicableCreditScopes` and `loadScopeProfiles`. There is no second
// exposure algorithm in this file.
//
// TWO-PHASE TRANSACTION DISCIPLINE (§37.54.11.5). The fact read, the exposure
// computation, the scope hashes, the policy snapshot fingerprint, the fact
// digest and the result snapshot are produced inside ONE `readTransaction` so
// they all come from a single coherent snapshot and the digest is provably
// same-source with the snapshot it describes. The history row and the audit
// row are then appended in a SEPARATE write transaction. The split is
// required: a history row must not be time-misaligned with the facts it
// claims to describe, which is exactly why the row carries `fact_digest` and
// `policy_snapshot_fingerprint`.
//
// FAIL CLOSED, ZERO AUTHORITATIVE SIDE EFFECTS (§37.54.11.7). Every failure
// path writes NO history row, NO audit row, and modifies NO canonical fact.
//
// WRITE-ONCE (§37.54.11.4). This module is the only writer of
// `credit_recalculation_history`, and it only ever INSERTs. There is
// deliberately no UPDATE and no DELETE statement against that table in this
// file.

import { createHash, randomUUID } from 'node:crypto';
import { readTransaction, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  assertAllowedFields, HttpError, normalizeBusinessDate, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import {
  buildScopeHashes, computeCreditExposure, loadScopeProfiles,
  resolveApplicableCreditScopes, resolveCustomerCreditObject,
} from './credit-check.js';
import { computePolicySnapshotFingerprint, CREDIT_POLICY_HASH_VERSIONS } from './credit-policy.js';
import { creditObjectAnchorKey } from './credit-anchor.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { requireCreditEvaluationAuthority } from './credit-scope.js';

export const RECONCILIATION_KINDS = Object.freeze({
  CHECK_ONLY: 'CHECK_ONLY',
  DETERMINISTIC_RECALCULATION: 'DETERMINISTIC_RECALCULATION',
});

const RESULT_SNAPSHOT_CONTRACT_VERSION = 'CREDIT_RECONCILIATION_RESULT_SNAPSHOT_WAVE11_V1';

// The contract version of the ALGORITHM / PAYLOAD whose determinism is being
// claimed. Two executions whose contract versions differ are NOT comparable
// (§37.54.11.2 three-state replay semantics).
export const RECONCILIATION_CONTRACT_VERSION = 'CREDIT_RECONCILIATION_WAVE11_V1';

const AGGREGATE_SCOPE = 'CUSTOMER_AGGREGATE';
const SALESPERSON_SCOPE = 'SALESPERSON_SUB_LIMIT';

const REPLAY_EQUALITY = Object.freeze({
  EQUIVALENT: 'EQUIVALENT',
  DRIFTED: 'DRIFTED',
  NOT_COMPARABLE: 'NOT_COMPARABLE',
});

const REFERENCE_COMPARISON = Object.freeze({
  MATCHED: 'MATCHED',
  MISMATCHED: 'MISMATCHED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const CONSISTENCY = Object.freeze({
  CONSISTENT: 'CONSISTENT',
  INCONSISTENT: 'INCONSISTENT',
  UNRESOLVED: 'UNRESOLVED',
});

function sha256(value) {
  // The module owns its own digest helper because the canonical JSON encoding
  // (sorted object keys) is part of the identity contract of this module and
  // must not drift with a change in an unrelated module.
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
      : item
  ));
}

// An out-of-safe-range legacy amount is reported as `null` and never repaired.
// A crash would hide the very inconsistency the reconciliation exists to
// surface, and a silent coercion would fabricate a number.
function safeCents(value) {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) ? amount : null;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

function normalizeInput(body, { allowReference }) {
  assertAllowedFields(body, allowReference
    ? ['customerId', 'salespersonId', 'creditObjectType', 'creditObjectId', 'businessDate', 'referenceCheckGroupId']
    : ['customerId', 'salespersonId', 'creditObjectType', 'creditObjectId', 'businessDate']);
  const customerId = requiredText(body.customerId, '客户', 128);
  const salespersonId = body.salespersonId ? requiredText(body.salespersonId, '销售员', 128) : null;
  const creditObjectType = body.creditObjectType ? requiredCode(body.creditObjectType, '信用对象类型') : null;
  const creditObjectId = body.creditObjectId ? requiredText(body.creditObjectId, '信用对象', 128) : null;
  const businessDate = normalizeBusinessDate(body.businessDate, '业务日期');
  const referenceCheckGroupId = allowReference && body.referenceCheckGroupId
    ? requiredText(body.referenceCheckGroupId, '参考信用检查组', 128)
    : null;
  return { customerId, salespersonId, creditObjectType, creditObjectId, businessDate, referenceCheckGroupId };
}

// The execution identity is the idempotency document identity. It carries the
// kind, the credit object, the customer, the salesperson scope, the business
// date and the optional reference group — NEVER an amount (§37.54.11.6).
function executionIdentity(kind, input) {
  return [
    kind,
    input.creditObjectType || '',
    input.creditObjectId || '',
    input.customerId,
    input.salespersonId || '*',
    input.businessDate,
    input.referenceCheckGroupId || '',
  ].join('|');
}

// ---------------------------------------------------------------------------
// Phase 1 — the coherent read snapshot
// ---------------------------------------------------------------------------

function readPolicySnapshotIfPresent(db, { anchorId, scopeType, profileId, businessDate, fingerprint }) {
  // READ ONLY. `ensureCreditPolicySnapshot` is never called here: it INSERTs,
  // and a reconciliation must not persist a policy snapshot (§37.54.11.3).
  const row = db.prepare(`SELECT id,snapshot_fingerprint,business_date FROM credit_policy_snapshots
    WHERE credit_lock_anchor_id=? AND business_date=? AND snapshot_fingerprint=?`).get(
    anchorId, businessDate, fingerprint,
  );
  if (!row) return { persisted: false, id: null, fingerprint };
  return { persisted: true, id: row.id, fingerprint: row.snapshot_fingerprint };
}

function resolveScopeAnchorId(db, scope) {
  // The effective profile row already carries the canonical anchor identity
  // (`credit_profile.anchor_id`). It is used directly: `ensureCreditLockAnchor`
  // would INSERT and is therefore forbidden on this read-only path.
  if (scope.profile?.anchor_id) return scope.profile.anchor_id;
  const anchor = db.prepare(`SELECT id FROM credit_lock_anchors WHERE anchor_key=?`).get(
    creditObjectAnchorKey({
      customerId: scope.customerId,
      salespersonId: scope.salespersonId || null,
      creditObjectType: scope.creditObjectType,
      creditObjectId: scope.creditObjectId,
    }),
  );
  return anchor?.id || null;
}

/**
 * The whole read phase. It runs inside `readTransaction` and produces every
 * value that the history row claims to describe, from ONE coherent snapshot.
 */
function runReadPhase(db, { kind, input }) {
  const creditObject = resolveCustomerCreditObject(db, {
    customerId: input.customerId,
    businessDate: input.businessDate,
    creditObjectType: input.creditObjectType,
    creditObjectId: input.creditObjectId,
  });
  const { aggregate, salesperson } = loadScopeProfiles(db, {
    customerId: input.customerId,
    salespersonId: input.salespersonId,
    creditObjectType: creditObject.creditObjectType,
    creditObjectId: creditObject.creditObjectId,
    businessDate: input.businessDate,
  });

  // §37.54.11.7 — no effective profile fails closed with 409 and must NOT
  // imply a zero limit. `resolveEffectiveCreditProfile` itself raises
  // CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS when the effective version is not
  // unique; the missing-profile case is the explicit check below.
  const effectiveProfile = aggregate || salesperson;
  if (!effectiveProfile) {
    throw new HttpError(409, '缺少生效信用档案，信用对账已拒绝', {
      code: 'CREDIT_PROFILE_MISSING',
      customerId: input.customerId,
      businessDate: input.businessDate,
    });
  }

  const scopeResolution = resolveApplicableCreditScopes({
    aggregateProfile: aggregate,
    salespersonProfile: salesperson,
    salespersonId: input.salespersonId,
    subLimitOnlyAllowed: false,
  });
  if (!scopeResolution.applicable) {
    const reason = scopeResolution.failClosed[0] || { code: 'CREDIT_PROFILE_MISSING', message: '缺少强制信用档案' };
    throw new HttpError(409, reason.message || '信用对账无法通过', {
      code: reason.code,
      customerId: input.customerId,
      businessDate: input.businessDate,
    });
  }
  const scopes = scopeResolution.scopes.map((scope) => ({
    ...scope,
    stage: 'RECONCILIATION',
    customerId: input.customerId,
    creditObjectType: creditObject.creditObjectType,
    creditObjectId: creditObject.creditObjectId,
  }));

  // The exposure is PURE_DERIVED. A source-chain inconsistency or a transition
  // exceeding the delivered obligation raises a 409 from inside this read
  // phase, which rolls the read transaction back and writes nothing.
  const exposure = computeCreditExposure(db, {
    customerId: input.customerId,
    salespersonId: input.salespersonId,
    businessDate: input.businessDate,
  });

  const hashes = buildScopeHashes(db, {
    scopes,
    businessDate: input.businessDate,
    hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
  });
  const policySnapshotFingerprint = computePolicySnapshotFingerprint({
    hashContractVersion: CREDIT_POLICY_HASH_VERSIONS.V2,
    parameterSetHash: hashes.parameterSetHash,
    ruleSetHash: hashes.ruleSetHash,
    profileEffectiveStateHash: hashes.profileEffectiveStateHash,
  });

  const policySnapshot = {
    persisted: false,
    id: null,
    fingerprint: policySnapshotFingerprint,
    scopeFingerprints: [],
  };
  for (const scope of scopes) {
    const anchorId = resolveScopeAnchorId(db, scope);
    if (!anchorId) continue;
    const found = readPolicySnapshotIfPresent(db, {
      anchorId,
      scopeType: scope.scopeType,
      profileId: scope.profile.id,
      businessDate: input.businessDate,
      fingerprint: policySnapshotFingerprint,
    });
    policySnapshot.scopeFingerprints.push({
      scopeType: scope.scopeType,
      creditProfileId: scope.profile.id,
      anchorId,
      persisted: found.persisted,
      id: found.id,
    });
    if (found.persisted && !policySnapshot.persisted) {
      policySnapshot.persisted = true;
      policySnapshot.id = found.id;
    }
  }

  const scopeRows = scopes.map((scope) => {
    const components = scope.scopeType === AGGREGATE_SCOPE ? exposure.aggregateComponents : exposure.salespersonComponents;
    // An out-of-safe-range legacy amount must NEVER be silently repaired and
    // must NEVER crash the reconciliation. It is reported as `null` and the
    // scope is explicitly marked as amount-unsafe, exactly like the Wave 10
    // overdue evidence treatment (`amountUnsafe`).
    const componentCents = {
      approvedSoCommitmentCents: safeCents(components.approvedSoCommitmentCents),
      deliveredNotSettledCents: safeCents(components.deliveredNotSettledCents),
      arOpenCents: safeCents(components.arOpenCents),
      eligiblePrepaymentCents: safeCents(components.eligiblePrepaymentCents),
      ambiguousAttributionCents: safeCents(components.ambiguousAttributionCents),
    };
    const amountUnsafe = Object.values(componentCents).some((value) => value === null);
    const usedCents = amountUnsafe
      ? null
      : Number(componentCents.approvedSoCommitmentCents || 0)
        + Number(componentCents.deliveredNotSettledCents || 0)
        + Number(componentCents.arOpenCents || 0)
        - Number(componentCents.eligiblePrepaymentCents || 0);
    const creditLimitCents = scope.profile.credit_limit_cents == null
      ? null
      : Number(scope.profile.credit_limit_cents);
    const remainingCents = creditLimitCents == null || usedCents == null ? null : creditLimitCents - usedCents;
    const overLimitCents = creditLimitCents == null || usedCents == null
      ? 0
      : Math.max(0, usedCents - creditLimitCents);
    return {
      scopeType: scope.scopeType,
      creditProfileId: scope.profile.id,
      salespersonScopeKey: scope.salespersonId || '*',
      creditLimitCents,
      usedCents,
      remainingCents,
      overLimitCents,
      amountUnsafe,
      components: componentCents,
    };
  });

  const factCounts = {
    orders: exposure.orderCount,
    deliveries: exposure.deliveryCount,
    receivables: exposure.receivableCount,
  };

  return {
    kind,
    creditObject,
    scopes: scopeRows,
    hashes,
    policySnapshotFingerprint,
    policySnapshot,
    factDigest: exposure.factDigest,
    factCounts,
    hasAmbiguousAttribution: Boolean(exposure.hasAmbiguousAttribution),
    ambiguousAttributionCents: safeCents(exposure.ambiguousAttributionCents),
    input,
  };
}

// ---------------------------------------------------------------------------
// SC99 — the reference comparison
// ---------------------------------------------------------------------------

/**
 * Compare the freshly derived exposure with a reference Credit Check group.
 *
 * The reference group is compared FIELD BY FIELD through the stored
 * `component_breakdown_json`, because the digest alone can never explain
 * WHERE two fact sets differ (§37.54.11.2). The differing items are named
 * explicitly so the caller can act on them.
 */
function compareReference(db, { referenceCheckGroupId, scopes, businessDate }) {
  if (!referenceCheckGroupId) {
    return { comparison: REFERENCE_COMPARISON.NOT_APPLICABLE, differingItems: [], referenceCheckGroupId: null };
  }
  const rows = db.prepare(`SELECT * FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type`)
    .all(referenceCheckGroupId);
  if (!rows.length) {
    throw new HttpError(409, '参考信用检查组不存在，信用对账已拒绝', {
      code: 'CREDIT_REFERENCE_CHECK_GROUP_NOT_FOUND',
      referenceCheckGroupId,
    });
  }
  const dateMismatch = rows.filter((row) => row.business_date !== businessDate);
  if (dateMismatch.length) {
    // A reference group from another business date is not comparable. It is
    // reported as NOT_COMPARABLE, never as a silent "consistent".
    return {
      comparison: REFERENCE_COMPARISON.NOT_APPLICABLE,
      differingItems: [{
        code: 'REFERENCE_BUSINESS_DATE_MISMATCH',
        expected: businessDate,
        actual: dateMismatch.map((row) => row.business_date),
      }],
      referenceCheckGroupId,
      replayEquality: REPLAY_EQUALITY.NOT_COMPARABLE,
    };
  }
  const differingItems = [];
  for (const scope of scopes) {
    const row = rows.find((item) => item.scope_type === scope.scopeType);
    if (!row) {
      differingItems.push({
        code: 'REFERENCE_SCOPE_MISSING',
        scopeType: scope.scopeType,
        expected: scope.usedCents,
        actual: null,
      });
      continue;
    }
    let breakdown = null;
    try { breakdown = JSON.parse(row.component_breakdown_json || '{}'); } catch { breakdown = null; }
    if (!breakdown) {
      differingItems.push({
        code: 'REFERENCE_BREAKDOWN_UNREADABLE',
        scopeType: scope.scopeType,
        expected: scope.usedCents,
        actual: null,
      });
      continue;
    }
    const storedExposure = breakdown.exposureCents == null ? null : Number(breakdown.exposureCents);
    if (storedExposure !== scope.usedCents) {
      differingItems.push({
        code: 'REFERENCE_EXPOSURE_MISMATCH',
        scopeType: scope.scopeType,
        field: 'exposureCents',
        expected: scope.usedCents,
        actual: storedExposure,
      });
    }
    const storedLimit = breakdown.creditLimitCents == null ? null : Number(breakdown.creditLimitCents);
    if (storedLimit !== scope.creditLimitCents) {
      differingItems.push({
        code: 'REFERENCE_LIMIT_MISMATCH',
        scopeType: scope.scopeType,
        field: 'creditLimitCents',
        expected: scope.creditLimitCents,
        actual: storedLimit,
      });
    }
    const storedComponents = breakdown.components || {};
    for (const [name, value] of Object.entries(scope.components)) {
      const stored = storedComponents[name] == null ? null : Number(storedComponents[name]);
      if (stored !== value) {
        differingItems.push({
          code: 'REFERENCE_COMPONENT_MISMATCH',
          scopeType: scope.scopeType,
          field: name,
          expected: value,
          actual: stored,
        });
      }
    }
  }
  const comparison = differingItems.length
    ? REFERENCE_COMPARISON.MISMATCHED
    : REFERENCE_COMPARISON.MATCHED;
  return { comparison, differingItems, referenceCheckGroupId };
}

// ---------------------------------------------------------------------------
// The result snapshot
// ---------------------------------------------------------------------------

function buildResultSnapshot({ kind, read, reference }) {
  return {
    contractVersion: RESULT_SNAPSHOT_CONTRACT_VERSION,
    authoritative: false,
    consumedByCreditCalculation: false,
    scopes: read.scopes.map((scope) => {
      const scopeReference = reference?.differingItems?.filter((item) => item.scopeType === scope.scopeType) || [];
      // An amount-unsafe scope can never be judged CONSISTENT: the amount is
      // unknown, so the consistency is explicitly UNRESOLVED.
      const consistency = scope.amountUnsafe
        ? CONSISTENCY.UNRESOLVED
        : (kind === RECONCILIATION_KINDS.CHECK_ONLY
          ? (scopeReference.length ? CONSISTENCY.INCONSISTENT : CONSISTENCY.CONSISTENT)
          : CONSISTENCY.CONSISTENT);
      return {
        scopeType: scope.scopeType,
        creditLimitCents: scope.creditLimitCents,
        usedCents: scope.usedCents,
        remainingCents: scope.remainingCents,
        overLimitCents: scope.overLimitCents,
        amountUnsafe: scope.amountUnsafe,
        components: scope.components,
        consistency,
        discrepancyCodes: scope.amountUnsafe
          ? [...new Set([...scopeReference.map((item) => item.code), 'AMOUNT_UNSAFE'])]
          : [...new Set(scopeReference.map((item) => item.code))],
      };
    }),
    factCounts: read.factCounts,
    referenceComparison: kind === RECONCILIATION_KINDS.CHECK_ONLY
      ? reference.comparison
      : REFERENCE_COMPARISON.NOT_APPLICABLE,
  };
}

// ---------------------------------------------------------------------------
// The three-state replay semantics (§37.54.11.2 CORRECTION-2)
// ---------------------------------------------------------------------------

/**
 * The replay equality of a historical execution row against the current
 * execution. It is THREE-STATE and never binary:
 *
 *   EQUIVALENT      same contractVersion + same businessDate + same scope
 *                   + same factDigest  -> the recomputed result MUST equal the
 *                   historical snapshot.
 *   DRIFTED         same contractVersion / businessDate / scope but a
 *                   DIFFERENT factDigest -> the source facts changed. The
 *                   differing items are reported and equivalence is never
 *                   claimed.
 *   NOT_COMPARABLE a different contractVersion (or businessDate / scope)
 *                   -> the replay carries no business meaning. It is stated
 *                   explicitly and never silently compared.
 */
export function classifyReplayEquality(previous, current) {
  if (!previous) return { state: REPLAY_EQUALITY.NOT_COMPARABLE, reason: 'NO_HISTORICAL_EXECUTION' };
  if (previous.contractVersion !== current.contractVersion) {
    return { state: REPLAY_EQUALITY.NOT_COMPARABLE, reason: 'CONTRACT_VERSION_MISMATCH' };
  }
  if (previous.businessDate !== current.businessDate) {
    return { state: REPLAY_EQUALITY.NOT_COMPARABLE, reason: 'BUSINESS_DATE_MISMATCH' };
  }
  if (previous.scopeKey !== current.scopeKey) {
    return { state: REPLAY_EQUALITY.NOT_COMPARABLE, reason: 'SCOPE_MISMATCH' };
  }
  if (previous.factDigest !== current.factDigest) {
    return { state: REPLAY_EQUALITY.DRIFTED, reason: 'FACT_DIGEST_MISMATCH' };
  }
  return { state: REPLAY_EQUALITY.EQUIVALENT, reason: null };
}

// ---------------------------------------------------------------------------
// The execution
// ---------------------------------------------------------------------------

function presentScope(scope) {
  return {
    scopeType: scope.scopeType,
    creditProfileId: scope.creditProfileId,
    salespersonScopeKey: scope.salespersonScopeKey,
    creditLimitCents: scope.creditLimitCents,
    usedCents: scope.usedCents,
    remainingCents: scope.remainingCents,
    overLimitCents: scope.overLimitCents,
    amountUnsafe: scope.amountUnsafe,
    components: scope.components,
  };
}

async function executeReconciliation(db, req, res, actor, kind) {
  requireCreditEvaluationAuthority(actor);
  const body = await readJson(req);
  const input = normalizeInput(body, { allowReference: kind === RECONCILIATION_KINDS.CHECK_ONLY });
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint({ ...body, kind });
  const documentId = executionIdentity(kind, input);

  const startedAt = Date.now();
  // PHASE 1 — the coherent read snapshot. Everything the history row claims
  // to describe is produced here, from ONE snapshot.
  const read = readTransaction(db, () => runReadPhase(db, { kind, input }));

  const reference = kind === RECONCILIATION_KINDS.CHECK_ONLY
    ? compareReference(db, {
      referenceCheckGroupId: input.referenceCheckGroupId,
      scopes: read.scopes,
      businessDate: input.businessDate,
    })
    : { comparison: REFERENCE_COMPARISON.NOT_APPLICABLE, differingItems: [], referenceCheckGroupId: null };

  const resultSnapshot = buildResultSnapshot({ kind, read, reference });
  const driftDetected = kind === RECONCILIATION_KINDS.CHECK_ONLY
    && reference.comparison === REFERENCE_COMPARISON.MISMATCHED ? 1 : 0;
  const discrepancyCount = kind === RECONCILIATION_KINDS.CHECK_ONLY ? reference.differingItems.length : 0;
  const scopeFilter = {
    customerId: input.customerId,
    salespersonId: input.salespersonId || null,
    salespersonScopeKey: input.salespersonId || '*',
    creditObjectType: read.creditObject.creditObjectType,
    creditObjectId: read.creditObject.creditObjectId,
    businessDate: input.businessDate,
    scopeTypes: read.scopes.map((scope) => scope.scopeType),
    referenceCheckGroupId: input.referenceCheckGroupId || null,
  };

  const response = {
    kind,
    contractVersion: RECONCILIATION_CONTRACT_VERSION,
    businessDate: input.businessDate,
    creditObject: {
      creditObjectType: read.creditObject.creditObjectType,
      creditObjectId: read.creditObject.creditObjectId,
    },
    customerId: input.customerId,
    scopes: read.scopes.map(presentScope),
    factCounts: read.factCounts,
    hasAmbiguousAttribution: read.hasAmbiguousAttribution,
    ambiguousAttributionCents: read.ambiguousAttributionCents,
    policySnapshot: {
      persisted: read.policySnapshot.persisted,
      id: read.policySnapshot.id,
      fingerprint: read.policySnapshotFingerprint,
      scopes: read.policySnapshot.scopeFingerprints,
    },
    profileEffectiveStateHash: read.hashes.profileEffectiveStateHash,
    driftDetected,
    discrepancyCount,
    ...(kind === RECONCILIATION_KINDS.CHECK_ONLY
      ? {
        referenceComparison: reference.comparison,
        referenceCheckGroupId: input.referenceCheckGroupId || null,
        differingItems: reference.differingItems,
      }
      : {
        // SC100 emits the deterministic evidence and NO verdict.
        factDigest: read.factDigest,
        referenceComparison: REFERENCE_COMPARISON.NOT_APPLICABLE,
      }),
  };

  // PHASE 2 — the write phase. Exactly ONE history row and ONE audit row are
  // appended, in their own transaction. Nothing canonical is touched.
  let historyId = null;
  let replayed = false;
  transaction(db, () => {
    const replay = idempotencyReplay(db, `CREDIT_RECONCILIATION_${kind}`, documentId, key, fingerprint);
    if (replay) {
      replayed = true;
      historyId = replay.historyId ?? null;
      return;
    }
    historyId = randomUUID();
    const triggeredAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - startedAt);
    db.prepare(`INSERT INTO credit_recalculation_history(id,kind,credit_object_type,credit_object_id,customer_id,
        salesperson_scope_key,business_date,fact_digest,policy_snapshot_fingerprint,profile_effective_state_hash,
        scope_filter_json,result_snapshot_json,discrepancy_count,drift_detected,duration_ms,triggered_by,triggered_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      historyId, kind, read.creditObject.creditObjectType, read.creditObject.creditObjectId, input.customerId,
      input.salespersonId || '*', input.businessDate, read.factDigest, read.policySnapshotFingerprint,
      read.hashes.profileEffectiveStateHash, JSON.stringify(scopeFilter), JSON.stringify(resultSnapshot),
      discrepancyCount, driftDetected, durationMs, actor.id, triggeredAt,
    );
    audit(db, actor.id, kind, 'CREDIT_RECALCULATION', historyId, JSON.stringify({
      kind,
      contractVersion: RECONCILIATION_CONTRACT_VERSION,
      businessDate: input.businessDate,
      creditObjectType: read.creditObject.creditObjectType,
      creditObjectId: read.creditObject.creditObjectId,
      customerId: input.customerId,
      salespersonScopeKey: input.salespersonId || '*',
      policySnapshotFingerprint: read.policySnapshotFingerprint,
      profileEffectiveStateHash: read.hashes.profileEffectiveStateHash,
      factDigest: read.factDigest,
      referenceComparison: resultSnapshot.referenceComparison,
      discrepancyCount,
      driftDetected,
      durationMs,
      resultSnapshotId: historyId,
    }));
    // The idempotency store carries the EXECUTION IDENTITY only. It never
    // stores an amount (§37.54.11.6).
    saveIdempotency(db, `CREDIT_RECONCILIATION_${kind}`, documentId, key, fingerprint, {
      historyId,
      kind,
      contractVersion: RECONCILIATION_CONTRACT_VERSION,
      businessDate: input.businessDate,
      scopeKey: input.salespersonId || '*',
      factDigest: read.factDigest,
    });
  });

  if (replayed) {
    // A replay recomputes and returns the CURRENT result without adding a
    // second history row.
    response.replayed = true;
    response.historyId = historyId;
    return send(res, 200, response);
  }

  response.replayed = false;
  response.historyId = historyId;
  return send(res, 200, response);
}

export async function checkCreditReconciliation(db, req, res, actor) {
  return executeReconciliation(db, req, res, actor, RECONCILIATION_KINDS.CHECK_ONLY);
}

export async function recalculateCreditExposure(db, req, res, actor) {
  return executeReconciliation(db, req, res, actor, RECONCILIATION_KINDS.DETERMINISTIC_RECALCULATION);
}

export const __creditReconciliationInternals = Object.freeze({
  RECONCILIATION_KINDS,
  RECONCILIATION_CONTRACT_VERSION,
  RESULT_SNAPSHOT_CONTRACT_VERSION,
  REPLAY_EQUALITY,
  REFERENCE_COMPARISON,
  CONSISTENCY,
  executionIdentity,
  buildResultSnapshot,
  compareReference,
  runReadPhase,
  canonicalJson,
  sha256,
});
