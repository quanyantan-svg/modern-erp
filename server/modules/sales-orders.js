import { createHash } from 'node:crypto';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { resolveOrderTimeDiscount, resolveSalesPrice } from './sales-pricing.js';
import { assertSellableProduct } from './sales-commercial-foundation.js';
import { assertGroupScope, currentCommercialExtension, lockSuffix, requireSalesPermission } from './sales-scope.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';
import { quantityToMicros, toleranceBoundsMicros } from './sales-delivery-source.js';
import { authorizeSalesPrepaymentGateWithPlan, discoverSalesPrepaymentGatePlan } from './sales-prepayment-gate.js';
import { assertCreditAllowsBusinessAction, lockCreditPrepaymentParents } from './credit-check.js';
import { resolveRecognitionPolicy } from './finance-recognition-policy.js';
import { isGateRetryAdmissionExpired, startGateRetryAdmission } from './sales-gate-retry-admission.js';

const DAY = () => new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = (value) => JSON.stringify(value);
const parse = (value, label) => { try { return JSON.parse(value); } catch { throw new HttpError(409, `${label}损坏`, { code: 'SALES_SNAPSHOT_CORRUPT' }); } };
const PRICE_OVERRIDE_CONSUMPTION_OPERATION = 'SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION';
const PRICE_OVERRIDE_CONSUMPTION_KEY = 'consume:v1';

function isUniqueConstraintError(error) {
  if (!error) return false;
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.errno === 19) return true;
  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) return true;
  if (/UNIQUE constraint failed|Duplicate entry/i.test(error.message || '')) return true;
  return false;
}

function recordPriceOverrideAuthorizationConsumption(db, authorizationId, actor, context) {
  try {
    db.prepare(
      `INSERT INTO idempotency_records(id, operation_type, document_id, idempotency_key, request_fingerprint, result_json, status, created_at)
       VALUES(?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`
    ).run(id(), PRICE_OVERRIDE_CONSUMPTION_OPERATION, authorizationId, PRICE_OVERRIDE_CONSUMPTION_KEY,
      hash({ authorizationId, context: context || {}, actorId: actor.id, at: NOW() }),
      JSON.stringify({ authorizationId, actorId: actor.id, consumedAt: NOW(), ...(context || {}) }), NOW());
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError(409, '价格覆盖授权已使用', { code: 'PRICE_OVERRIDE_AUTHORIZATION_USED' });
    }
    throw error;
  }
  audit(db, actor.id, 'CONSUME', PRICE_OVERRIDE_CONSUMPTION_OPERATION, authorizationId, JSON.stringify(context || {}));
}

function readPriceOverrideAuthorizationConsumption(db, authorizationId) {
  return db.prepare(
    `SELECT id, result_json FROM idempotency_records WHERE operation_type=? AND document_id=? AND idempotency_key=?`
  ).get(PRICE_OVERRIDE_CONSUMPTION_OPERATION, authorizationId, PRICE_OVERRIDE_CONSUMPTION_KEY) || null;
}

// R7-P1-02: dialect-aware applied-line guard. The previous LIKE-based pattern
// relied on the textual rendering of the JSON snapshot and was unreliable under
// MySQL native JSON (which normalises whitespace, key order, and quoting).
// SQLite JSON1 and MySQL JSON_EXTRACT both read `$.authorizationEvidence.authorizationId`
// as a canonical text value independent of JSON representation. Historical NULL
// snapshot rows are excluded because json_extract returns NULL for them and
// `NULL = ?` is falsy in WHERE.
function findAppliedAuthorizationLine(db, authorizationId) {
  const sql = db.dialect === 'mysql'
    ? `SELECT 1 FROM sales_order_items
         WHERE price_snapshot_json IS NOT NULL
           AND JSON_UNQUOTE(JSON_EXTRACT(price_snapshot_json, '$.authorizationEvidence.authorizationId')) = ?
         LIMIT 1`
    : `SELECT 1 FROM sales_order_items
         WHERE price_snapshot_json IS NOT NULL
           AND json_extract(price_snapshot_json, '$.authorizationEvidence.authorizationId') = ?
         LIMIT 1`;
  try {
    return db.prepare(sql).get(authorizationId) || null;
  } catch {
    throw new HttpError(409, '无法验证授权是否已用于订单行，禁止释放', {
      code: 'PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_CHECK_FAILED',
    });
  }
}

// R6-P2-01: `expectedOwner` is required so Change / direct-SO release and assert
// paths can never be invoked without a verified ownership contract. The
// previously defaulting `null` is removed and the call sites in
// sales-order-changes.js + authorizedOverrideEvidence already pass
// `expectedOwner` explicitly. The `allowAppliedLine` bypass is removed — no
// caller ever uses it and the LIKE check on `sales_order_items` is always
// enforced as a guard against releasing an already-applied authorization.
function releasePriceOverrideAuthorizationConsumption(db, authorizationId, actor, options) {
  if (!options || typeof options.expectedOwner !== 'string' || options.expectedOwner.length === 0) {
    throw new HttpError(500, 'release() requires an explicit expectedOwner', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED' });
  }
  const { expectedOwner } = options;
  const row = readPriceOverrideAuthorizationConsumption(db, authorizationId);
  if (!row) return false;
  let parsed;
  try { parsed = JSON.parse(row.result_json); } catch { throw new HttpError(409, '授权消费记录解析失败', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH' }); }
  if (parsed.source !== expectedOwner) {
    throw new HttpError(409, '授权消费记录归属与请求方不匹配', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH' });
  }
  if (findAppliedAuthorizationLine(db, authorizationId)) {
    throw new HttpError(409, '授权已被已审批订单行实际消费，禁止释放', { code: 'PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS' });
  }
  db.prepare(`DELETE FROM idempotency_records WHERE id=?`).run(row.id);
  audit(db, actor.id, 'RELEASE', PRICE_OVERRIDE_CONSUMPTION_OPERATION, authorizationId, `released (source=${parsed.source}, expectedOwner=${expectedOwner})`);
  return true;
}

function assertPriceOverrideAuthorizationReserved(db, authorizationId, options) {
  if (!options || typeof options.expectedOwner !== 'string' || options.expectedOwner.length === 0) {
    throw new HttpError(500, 'assertReserved() requires an explicit expectedOwner', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED' });
  }
  const { expectedOwner } = options;
  const row = readPriceOverrideAuthorizationConsumption(db, authorizationId);
  if (!row) throw new HttpError(409, '价格覆盖授权消费记录在审批时缺失', { code: 'PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED' });
  let parsed;
  try { parsed = JSON.parse(row.result_json); } catch { throw new HttpError(409, '授权消费记录解析失败', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH' }); }
  if (parsed.source !== expectedOwner) {
    throw new HttpError(409, '授权消费记录归属与请求方不匹配', { code: 'PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH' });
  }
  return row;
}

export const PRICE_OVERRIDE_CONSUMPTION = Object.freeze({
  OPERATION: PRICE_OVERRIDE_CONSUMPTION_OPERATION,
  KEY: PRICE_OVERRIDE_CONSUMPTION_KEY,
  record: recordPriceOverrideAuthorizationConsumption,
  release: releasePriceOverrideAuthorizationConsumption,
  assertReserved: assertPriceOverrideAuthorizationReserved,
  findAppliedLine: findAppliedAuthorizationLine,
});
const safe = (value, label, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw new HttpError(422, `${label}不正确`); return n; };
const taxInclusiveFlag = (value) => {
  if (value == null) return null;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new HttpError(422, '商业税含价假设必须为布尔值', { code: 'SALES_TAX_ASSUMPTION_INVALID' });
};
const microsDecimal = (micros) => `${Math.trunc(micros / 1_000_000)}.${String(micros % 1_000_000).padStart(6, '0')}`;

function makeNo(prefix) { return `${prefix}-${Date.now()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`; }
function effectiveExtension(db, customerId, businessDate) { return currentCommercialExtension(db, customerId, businessDate); }

function authorizedOverrideEvidence(db, source, actor, expected, { consumedAuthorizationIds = null, changeId = null, previouslyReservedAuthorizationIds = null } = {}) {
  const authorizationId = String(source.priceOverrideAuthorizationId || '').trim();
  if (!authorizationId) return null;
  if (consumedAuthorizationIds) {
    if (consumedAuthorizationIds.has(authorizationId)) {
      throw new HttpError(409, '同一请求中同一价格覆盖授权只能被消费一次', { code: 'PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE' });
    }
    consumedAuthorizationIds.add(authorizationId);
  }
  const row = db.prepare(`SELECT * FROM audit_logs WHERE id=? AND entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION'
    AND action='AUTHORIZE'${lockSuffix(db)}`).get(authorizationId);
  if (!row) throw new HttpError(409, '价格覆盖授权不存在', { code: 'PRICE_OVERRIDE_AUTHORIZATION_INVALID' });
  if (row.user_id === actor.id) throw new HttpError(409, '订单创建人与价格覆盖授权人必须分离', { code: 'SALES_PRICE_OVERRIDE_SOD' });
  const value = parse(row.detail, '价格覆盖授权');
  if (value.customerId !== expected.customerId || value.businessDate !== expected.businessDate
    || value.materialId !== expected.materialId || value.uomCode !== expected.uomCode
    || Number(value.quantityMicros) !== expected.quantityMicros) throw new HttpError(409, '价格覆盖授权与订单行不匹配', { code: 'PRICE_OVERRIDE_AUTHORIZATION_MISMATCH' });
  // R5 owner-aware reservation: a previously-reserved authorization that this change still
  // owns is verified and kept; otherwise a fresh INSERT establishes the DB UNIQUE-protected
  // consumption record. The record's `source` carries the owner so apply/release/assert paths
  // can later verify ownership. The DB constraint enforces uniqueness across requests,
  // documents, dials and warehouses regardless of caller.
  const owner = changeId ? `SALES_ORDER_CHANGE:${changeId}` : 'DIRECT_SALES_LINE';
  if (previouslyReservedAuthorizationIds && previouslyReservedAuthorizationIds.has(authorizationId)) {
    assertPriceOverrideAuthorizationReserved(db, authorizationId, { expectedOwner: owner });
  } else {
    recordPriceOverrideAuthorizationConsumption(db, authorizationId, actor, { source: owner });
  }
  const snapshot = validatePriceSnapshot(db, value.priceSnapshot, { businessDate: expected.businessDate, materialId: expected.materialId,
    uomCode: expected.uomCode, quantityMicros: expected.quantityMicros, unitPriceCents: value.priceSnapshot.unitPriceCents,
    grossCents: value.priceSnapshot.grossAmountCents });
  if (snapshot.evidence.overrideState !== 'OVERRIDDEN' || snapshot.evidence.overrideEvidence?.actorId !== row.user_id
    || snapshot.evidence.overrideEvidence?.authority !== 'SALES_PRICING_OVERRIDE') throw new HttpError(409, '价格覆盖授权证据无效', { code: 'PRICE_OVERRIDE_AUTHORIZATION_INVALID' });
  const authorizationPayload = { contractVersion: 'SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1', authorizationId,
    authorizedByActorId: row.user_id, authority: 'SALES_PRICING_OVERRIDE', customerId: expected.customerId,
    businessDate: expected.businessDate, materialId: expected.materialId, uomCode: expected.uomCode,
    quantityMicros: expected.quantityMicros, pricingEvidenceFingerprint: snapshot.evidence.fingerprint,
    authorizedPriceSnapshotHash: hash(snapshot) };
  return { evidence: snapshot.evidence, authorizationEvidence: { ...authorizationPayload,
    fingerprint: requestFingerprint(authorizationPayload) } };
}

function zeroDiscountEvidence(lineIds, pricing, grossByLine) {
  const final = Object.fromEntries(lineIds.map((lineId) => [lineId, grossByLine[lineId]]));
  const result = {
    contractVersion: 'ORDER_DISCOUNT_V1', explicitZeroDiscount: true,
    lineDiscountCentsByLine: Object.fromEntries(lineIds.map((lineId) => [lineId, 0])),
    headerDiscountCentsTotal: 0, headerAllocationCentsByLine: Object.fromEntries(lineIds.map((lineId) => [lineId, 0])),
    totalDiscountCents: 0, finalLineCentsByLine: final, appliedRuleEvidence: [], pricingEvidenceByLine: pricing,
    roundingEvidence: { contract: 'HALF_UP_CENT_V1', allocation: 'LARGEST_REMAINDER_LINE_NO_LINE_ID' }, manualOverride: null,
  };
  result.fingerprint = requestFingerprint(result);
  return result;
}

export function validatePriceSnapshot(db, snapshot, expected) {
  if (!snapshot || snapshot.contractVersion !== 'SALES_PRICE_SNAPSHOT_V1' || !snapshot.evidence) throw new HttpError(409, '价格快照缺失或版本无效', { code: 'PRICE_SNAPSHOT_REQUIRED' });
  const evidence = snapshot.evidence;
  const { fingerprint, ...fingerprintPayload } = evidence;
  if (!fingerprint || snapshot.requestFingerprint !== fingerprint
    || (requestFingerprint(fingerprintPayload) !== fingerprint && hash(fingerprintPayload) !== fingerprint)
    || evidence.contractVersion !== 'SALES_PRICE_V1') {
    throw new HttpError(409, '价格快照指纹或解析器版本不一致', { code: 'PRICE_SNAPSHOT_MISMATCH' });
  }
  const version = db.prepare(`SELECT v.id,v.entry_id,v.version,v.unit_price_cents,e.price_list_id,e.pricing_uom_code
    FROM sales_price_list_versions v JOIN sales_price_list_entries e ON e.id=v.entry_id WHERE v.id=?`).get(evidence.versionId);
  if (!version || version.entry_id !== evidence.entryId || version.price_list_id !== evidence.priceListId
    || Number(version.version) !== Number(evidence.version)
    || Number(version.unit_price_cents) !== Number(snapshot.catalogUnitPriceCents ?? evidence.resolvedPriceCents)) {
    throw new HttpError(409, '价格版本证据不一致', { code: 'PRICE_SNAPSHOT_MISMATCH' });
  }
  if (snapshot.businessDate !== expected.businessDate || snapshot.materialId !== expected.materialId
    || snapshot.requestedUomCode !== expected.uomCode || safe(snapshot.quantityMicros, '快照数量', 1) !== expected.quantityMicros
    || safe(snapshot.unitPriceCents, '快照单价') !== expected.unitPriceCents || safe(snapshot.grossAmountCents, '快照金额') !== expected.grossCents) {
    throw new HttpError(409, '价格快照与订单行不一致', { code: 'PRICE_SNAPSHOT_MISMATCH' });
  }
  const evidenceRequestedQuantity = safe(evidence.requestedQuantityMicros, '请求数量', 1);
  const normalizedForSnapshot = Number((BigInt(safe(evidence.normalizedPricingQuantityMicros, '计价数量', 1)) * BigInt(expected.quantityMicros)
    + BigInt(evidenceRequestedQuantity) / 2n) / BigInt(evidenceRequestedQuantity));
  const calculatedGross = Number((BigInt(safe(evidence.resolvedPriceCents, '解析单价')) * BigInt(normalizedForSnapshot) + 500000n) / 1000000n);
  if (expected.quantityMicros > evidenceRequestedQuantity
    || evidence.requestedUomEvidence?.uomCode !== expected.uomCode
    || calculatedGross !== expected.grossCents
    || (snapshot.giftLine ? expected.unitPriceCents !== 0 : expected.unitPriceCents !== safe(evidence.resolvedPriceCents, '解析单价'))) {
    throw new HttpError(409, '价格快照数量、计量单位或金额证据不一致', { code: 'PRICE_SNAPSHOT_MISMATCH' });
  }
  if (evidence.overrideState === 'OVERRIDDEN') {
    if (!evidence.overrideEvidence?.actorId || evidence.overrideEvidence.authority !== 'SALES_PRICING_OVERRIDE' || !evidence.overrideEvidence.reason) {
      throw new HttpError(409, '手工价格覆盖证据不完整', { code: 'PRICE_SNAPSHOT_MISMATCH' });
    }
  } else if (evidence.overrideState !== 'NONE' || evidence.overrideEvidence != null || safe(evidence.resolvedPriceCents, '解析单价') !== safe(evidence.catalogUnitPriceCents, '目录单价')) {
    throw new HttpError(409, '价格覆盖状态与版本原价不一致', { code: 'PRICE_SNAPSHOT_MISMATCH' });
  }
  if (snapshot.authorizationEvidence) {
    const authorization = snapshot.authorizationEvidence;
    const { fingerprint: authorizationFingerprint, ...authorizationPayload } = authorization;
    const row = db.prepare(`SELECT * FROM audit_logs WHERE id=? AND entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION'
      AND action='AUTHORIZE'`).get(authorization.authorizationId);
    const detail = row ? parse(row.detail, 'price override authorization') : null;
    const { authorizationEvidence: ignoredAuthorization, ...originalSnapshot } = snapshot;
    if (!row || authorization.contractVersion !== 'SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1'
      || !authorizationFingerprint || requestFingerprint(authorizationPayload) !== authorizationFingerprint
      || authorization.authorizedByActorId !== row.user_id || authorization.authority !== 'SALES_PRICING_OVERRIDE'
      || authorization.customerId !== expected.customerId || authorization.businessDate !== expected.businessDate
      || authorization.materialId !== expected.materialId || authorization.uomCode !== expected.uomCode
      || Number(authorization.quantityMicros) !== expected.quantityMicros
      || authorization.pricingEvidenceFingerprint !== evidence.fingerprint
      || authorization.authorizedPriceSnapshotHash !== hash(originalSnapshot)
      || detail?.authorizationId !== authorization.authorizationId
      || detail?.customerId !== authorization.customerId || detail?.businessDate !== authorization.businessDate
      || detail?.materialId !== authorization.materialId || detail?.uomCode !== authorization.uomCode
      || Number(detail?.quantityMicros) !== Number(authorization.quantityMicros)
      || hash(detail?.priceSnapshot) !== authorization.authorizedPriceSnapshotHash) {
      throw new HttpError(409, 'Price override authorization linkage is invalid', { code: 'PRICE_OVERRIDE_AUTHORIZATION_INVALID' });
    }
  }
  return snapshot;
}

function validateDiscountSnapshot(snapshot, expected) {
  if (!snapshot || snapshot.contractVersion !== 'ORDER_DISCOUNT_SNAPSHOT_V1' || !snapshot.evidence) throw new HttpError(409, '折扣快照缺失或版本无效', { code: 'DISCOUNT_SNAPSHOT_REQUIRED' });
  const { fingerprint, ...fingerprintPayload } = snapshot.evidence;
  if (!fingerprint || snapshot.requestFingerprint !== fingerprint
    || (requestFingerprint(fingerprintPayload) !== fingerprint && hash(fingerprintPayload) !== fingerprint)
    || snapshot.evidence.contractVersion !== 'ORDER_DISCOUNT_V1') {
    throw new HttpError(409, '折扣快照指纹或解析器版本不一致', { code: 'DISCOUNT_SNAPSHOT_MISMATCH' });
  }
  if (snapshot.businessDate !== expected.businessDate || snapshot.lineId !== expected.lineId
    || safe(snapshot.grossAmountCents, '折扣前金额') !== expected.grossCents
    || safe(snapshot.finalAmountCents, '折扣后金额') !== expected.finalCents) {
    throw new HttpError(409, '折扣快照与订单行不一致', { code: 'DISCOUNT_SNAPSHOT_MISMATCH' });
  }
  const gross = safe(snapshot.grossAmountCents, 'discount gross');
  const lineDiscount = safe(snapshot.lineDiscountCents, 'line discount');
  const headerAllocation = safe(snapshot.headerAllocationCents, 'header allocation');
  const final = safe(snapshot.finalAmountCents, 'discount final');
  if (lineDiscount > gross || headerAllocation > gross - lineDiscount || gross - lineDiscount - headerAllocation !== final) {
    throw new HttpError(409, 'Discount snapshot arithmetic is inconsistent', { code: 'DISCOUNT_SNAPSHOT_MISMATCH' });
  }
  if (expected.giftLine) {
    if (lineDiscount !== gross || headerAllocation !== 0 || final !== 0) {
      throw new HttpError(409, 'Gift-line discount evidence is inconsistent', { code: 'DISCOUNT_SNAPSHOT_MISMATCH' });
    }
  } else if (!expected.allowEvidenceProjection) {
    const evidence = snapshot.evidence;
    const candidateIds = Object.keys(evidence.finalLineCentsByLine || {});
    const matched = candidateIds.some((lineId) => Number(evidence.lineDiscountCentsByLine?.[lineId]) === lineDiscount
      && Number(evidence.headerAllocationCentsByLine?.[lineId]) === headerAllocation
      && Number(evidence.finalLineCentsByLine?.[lineId]) === final
      && (!expected.pricingEvidenceFingerprint || evidence.pricingEvidenceByLine?.[lineId]?.fingerprint === expected.pricingEvidenceFingerprint));
    if (!matched) throw new HttpError(409, 'Discount snapshot does not match authoritative resolver evidence', { code: 'DISCOUNT_SNAPSHOT_MISMATCH' });
  }
  return snapshot;
}

export function buildAuthoritativeSalesLines(db, body, actor, businessDate, customerId, salespersonId, { enforceCreatorOverrideSod = true, consumedAuthorizationIds = null, changeId = null, previouslyReservedAuthorizationIds = null } = {}) {
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(422, '销售订单至少需要一条明细');
  const sharedConsumedAuthorizations = consumedAuthorizationIds ?? new Set();
  const lineInputs = body.items.map((source, index) => {
    const lineId = id();
    const quantityMicros = safe(source.quantityMicros ?? Math.round(Number(source.quantityDecimal ?? source.quantity) * 1_000_000), `第${index + 1}行数量`, 1);
    const materialId = String(source.productId || source.materialId || '').trim();
    const uomCode = String(source.uomCode || source.requestedUomCode || db.prepare('SELECT base_uom_code FROM products WHERE id=?').get(materialId)?.base_uom_code || '').trim();
    assertSellableProduct(db, { customerId, salespersonId, productId: materialId, businessDate, documentType: 'SALES_ORDER' });
    const authorized = authorizedOverrideEvidence(db, source, actor, { customerId, businessDate, materialId, uomCode, quantityMicros }, { consumedAuthorizationIds: sharedConsumedAuthorizations, changeId, previouslyReservedAuthorizationIds });
    const evidence = authorized?.evidence || resolveSalesPrice(db, {
      customerId, salespersonId, materialId, pricingUomCode: uomCode, quantityDecimal: microsDecimal(quantityMicros), businessDate,
      explicitPriceListIds: source.explicitPriceListIds || body.explicitPriceListIds,
      manualPriceCents: source.manualPriceCents, overrideReason: source.overrideReason || body.overrideReason,
    }, actor);
    if (enforceCreatorOverrideSod && evidence.overrideState === 'OVERRIDDEN' && evidence.overrideEvidence?.actorId === actor.id) {
      throw new HttpError(409, '订单创建人与价格覆盖人必须分离', { code: 'SALES_PRICE_OVERRIDE_SOD' });
    }
    const gross = Math.floor((evidence.resolvedPriceCents * evidence.normalizedPricingQuantityMicros + 500000) / 1000000);
    if (!Number.isSafeInteger(gross)) throw new HttpError(422, '行金额超出安全范围');
    return { source, lineId, lineNo: index + 1, quantityMicros, materialId, uomCode, evidence,
      authorizationEvidence: authorized?.authorizationEvidence || null, gross };
  });
  const discountInput = body.discount || {};
  let discount;
  try {
    discount = resolveOrderTimeDiscount(db, {
      customerId, salespersonId, businessDate, explicitSchemeIds: discountInput.explicitSchemeIds,
      manualRuleSelections: discountInput.manualRuleSelections, overrideReason: discountInput.overrideReason,
      lines: lineInputs.map((line) => ({ lineId: line.lineId, lineNo: line.lineNo, materialId: line.materialId,
        requestedUomCode: line.uomCode, quantityDecimal: microsDecimal(line.quantityMicros),
        explicitPriceListIds: line.source.explicitPriceListIds || body.explicitPriceListIds,
        manualPriceCents: line.evidence.overrideState === 'OVERRIDDEN' ? line.evidence.resolvedPriceCents : undefined,
        overrideReason: line.evidence.overrideEvidence?.reason,
        expectedPricingEvidence: line.evidence })),
    }, actor, { trustedPricingEvidence: true });
  } catch (error) {
    if (error?.details?.code !== 'DISCOUNT_NOT_CONFIGURED') throw error;
    discount = zeroDiscountEvidence(lineInputs.map((line) => line.lineId), Object.fromEntries(lineInputs.map((line) => [line.lineId, line.evidence])), Object.fromEntries(lineInputs.map((line) => [line.lineId, line.gross])));
  }
  return lineInputs.map((line) => {
    const isGift = Boolean(line.source.isGiftLine);
    const finalCents = isGift ? 0 : safe(discount.finalLineCentsByLine[line.lineId], '最终商业金额');
    const classification = db.prepare('SELECT * FROM product_commercial_classification WHERE product_id=? AND active=1').get(line.materialId);
    const priceSnapshot = { contractVersion: 'SALES_PRICE_SNAPSHOT_V1', businessDate, requestFingerprint: line.evidence.fingerprint,
      materialId: line.materialId, requestedUomCode: line.uomCode, quantityMicros: line.quantityMicros,
      unitPriceCents: isGift ? 0 : line.evidence.resolvedPriceCents, catalogUnitPriceCents: line.evidence.catalogUnitPriceCents,
      grossAmountCents: line.gross, giftLine: isGift, evidence: line.evidence,
      ...(line.authorizationEvidence ? { authorizationEvidence: line.authorizationEvidence } : {}) };
    const discountSnapshot = { contractVersion: 'ORDER_DISCOUNT_SNAPSHOT_V1', businessDate, requestFingerprint: discount.fingerprint,
      lineId: line.lineId, grossAmountCents: line.gross, finalAmountCents: finalCents,
      lineDiscountCents: isGift ? line.gross : safe(discount.lineDiscountCentsByLine[line.lineId], '行折扣'),
      headerAllocationCents: isGift ? 0 : safe(discount.headerAllocationCentsByLine[line.lineId], '整单分摊'), evidence: discount };
    return { id: line.lineId, productId: line.materialId, lineNo: line.lineNo, quantityMicros: line.quantityMicros,
      quantity: line.quantityMicros / 1_000_000, unitPriceCents: priceSnapshot.unitPriceCents, amountCents: finalCents,
      documentUomCode: line.uomCode, documentQuantityNum: line.quantityMicros, documentQuantityDen: 1_000_000,
      conversionNumerator: line.evidence.requestedUomEvidence.numerator, conversionDenominator: line.evidence.requestedUomEvidence.denominator,
      baseQuantityNum: line.quantityMicros * line.evidence.requestedUomEvidence.numerator,
      baseQuantityDen: 1_000_000 * line.evidence.requestedUomEvidence.denominator,
      isGiftLine: isGift ? 1 : 0, taxBasis: line.source.commercialTaxBasis || null,
      taxInclusive: taxInclusiveFlag(line.source.taxInclusiveAssumption), pricingUom: line.evidence.pricingUomEvidence.uomCode,
      qtyMin: line.evidence.qtyBreakApplied.min, qtyMax: line.evidence.qtyBreakApplied.max,
      plannedDate: line.source.plannedDeliveryDate || body.requestedDeliveryDate,
      upperTolerance: classification.default_upper_delivery_tolerance_bps, lowerTolerance: classification.default_lower_delivery_tolerance_bps,
      priceSnapshot, discountSnapshot };
  });
}

function validateFrozenLines(db, lines, businessDate, actor) {
  return lines.map((line, index) => {
    const price = typeof line.priceSnapshot === 'string' ? parse(line.priceSnapshot, '价格快照') : line.priceSnapshot;
    const discount = typeof line.discountSnapshot === 'string' ? parse(line.discountSnapshot, '折扣快照') : line.discountSnapshot;
    const expected = { businessDate, materialId: line.productId, uomCode: line.documentUomCode, quantityMicros: safe(line.quantityMicros, '数量', 1), unitPriceCents: safe(line.unitPriceCents, '单价'), grossCents: safe(line.grossAmountCents, '金额') };
    if (price.evidence?.overrideState === 'OVERRIDDEN' && price.evidence.overrideEvidence?.actorId === actor.id) {
      throw new HttpError(409, '订单创建人与价格覆盖人必须分离', { code: 'SALES_PRICE_OVERRIDE_SOD' });
    }
    validatePriceSnapshot(db, price, expected);
    validateDiscountSnapshot(discount, { businessDate, lineId: line.sourceLineId || line.id, grossCents: expected.grossCents,
      finalCents: safe(line.amountCents, '最终金额'), giftLine: Boolean(price.giftLine),
      pricingEvidenceFingerprint: price.evidence?.fingerprint, allowEvidenceProjection: Boolean(line.sourceLineId) });
    const orderLineId = id();
    return { ...line, id: orderLineId, lineNo: index + 1, quantity: expected.quantityMicros / 1_000_000, quantityMicros: expected.quantityMicros,
      priceSnapshot: price, discountSnapshot: { ...discount, lineId: orderLineId } };
  });
}

function validateStoredOrderSnapshots(db, order, authoritativeLines = null) {
  const lines = authoritativeLines || db.prepare(`SELECT * FROM sales_order_items WHERE order_id=? ORDER BY id${lockSuffix(db)}`).all(order.id);
  if (!lines.length) throw new HttpError(409, '销售订单必须至少包含一条明细', { code: 'SALES_SNAPSHOT_REQUIRED' });
  // Physical snapshot columns are nullable by the approved reopen contract.
  // A wholly NULL set is a pre-Batch-A submitted document and remains
  // approvable; every API-created Batch-A document is stopped at submit if a
  // snapshot is absent. Mixed/partial evidence is never treated as legacy.
  if (lines.every((line) => line.price_snapshot_json == null && line.discount_snapshot_json == null)) return;
  let total = 0;
  for (const line of lines) {
    if (!line.price_snapshot_json || !line.discount_snapshot_json) throw new HttpError(409, '新订单行缺少权威商业快照', { code: 'SALES_SNAPSHOT_REQUIRED' });
    const price = parse(line.price_snapshot_json, '价格快照');
    const discount = parse(line.discount_snapshot_json, '折扣快照');
    const quantityMicros = safe(line.document_quantity_num ?? Math.round(Number(line.quantity) * 1_000_000), '订单行数量', 1);
    validatePriceSnapshot(db, price, { customerId: order.customer_id, businessDate: order.order_date, materialId: line.product_id, uomCode: line.document_uom_code,
      quantityMicros, unitPriceCents: safe(line.unit_price_cents, '订单行单价'), grossCents: safe(price.grossAmountCents, '订单行原价金额') });
    validateDiscountSnapshot(discount, { businessDate: order.order_date, lineId: line.id,
      grossCents: safe(price.grossAmountCents, '订单行原价金额'), finalCents: safe(line.amount_cents, '订单行商业金额'),
      giftLine: Boolean(line.is_gift_line), pricingEvidenceFingerprint: price.evidence?.fingerprint });
    total += Number(line.amount_cents);
  }
  if (!Number.isSafeInteger(total) || total !== Number(order.total_cents)) throw new HttpError(409, '订单行快照金额与订单总额不一致', { code: 'SALES_SNAPSHOT_MISMATCH' });
}

export function insertSalesOrderLines(db, orderId, lines) {
  const stmt = db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
    document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,
    is_gift_line,commercial_tax_basis,tax_inclusive_assumption,pricing_uom_code_applied,qty_break_applied_min,qty_break_applied_max,
    planned_delivery_date,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps,price_snapshot_json,discount_snapshot_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const line of lines) stmt.run(line.id, orderId, line.productId, line.quantity, line.unitPriceCents, line.amountCents, line.lineNo,
    line.documentUomCode, line.documentQuantityNum, line.documentQuantityDen, line.conversionNumerator, line.conversionDenominator,
    line.baseQuantityNum, line.baseQuantityDen, line.isGiftLine, line.taxBasis, line.taxInclusive, line.pricingUom, line.qtyMin, line.qtyMax,
    line.plannedDate ?? null, line.upperTolerance, line.lowerTolerance, json(line.priceSnapshot), json(line.discountSnapshot));
}

export async function authorizeSalesPriceOverride(db, req, res, actor) {
  requireSalesPermission(actor, 'SALES_PRICING_OVERRIDE');
  const body = await readJson(req);
  const businessDate = normalizeBusinessDate(body.businessDate || body.orderDate || DAY(), '订单日期');
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(body.customerId);
  if (!customer) throw new HttpError(422, '客户不存在或已停用');
  const extension = effectiveExtension(db, customer.id, businessDate);
  const salespersonId = body.salespersonId || extension.default_salesperson_id;
  let result;
  transaction(db, () => {
    const lines = buildAuthoritativeSalesLines(db, { customerId: customer.id, orderDate: businessDate,
      requestedDeliveryDate: body.requestedDeliveryDate || businessDate, items: [{ productId: body.productId || body.materialId,
        uomCode: body.uomCode, quantityMicros: body.quantityMicros, quantityDecimal: body.quantityDecimal,
        manualPriceCents: body.manualPriceCents, overrideReason: body.overrideReason }] }, actor,
    businessDate, customer.id, salespersonId, { enforceCreatorOverrideSod: false });
    const line = lines[0]; const authorizationId = id();
    const detail = { contractVersion: 'SALES_PRICE_OVERRIDE_AUTHORIZATION_V1', authorizationId, customerId: customer.id,
      businessDate, materialId: line.productId, uomCode: line.documentUomCode, quantityMicros: line.quantityMicros,
      priceSnapshot: line.priceSnapshot };
    db.prepare("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,'AUTHORIZE','SALES_PRICE_OVERRIDE_AUTHORIZATION',?,?,?)")
      .run(authorizationId, actor.id, authorizationId, JSON.stringify(detail), NOW());
    result = { authorizationId, businessDate, materialId: line.productId, uomCode: line.documentUomCode,
      quantityMicros: line.quantityMicros, manualPriceCents: line.priceSnapshot.unitPriceCents };
  });
  return send(res, 201, result);
}

export function createSalesOrderCanonical(db, { body, actor, quotationLines = null, idempotencyKey = null, idempotencyScope = actor.id }) {
  const businessDate = normalizeBusinessDate(body.orderDate || body.businessDate || DAY(), '订单日期');
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(body.customerId);
  if (!customer) throw new HttpError(422, '客户不存在或已停用');
  const extension = effectiveExtension(db, customer.id, businessDate);
  const salespersonId = body.salespersonId || extension.default_salesperson_id;
  const salesGroupId = body.salesGroupId || extension.default_sales_group_id;
  if (!salespersonId || !salesGroupId) throw new HttpError(409, '客户缺少有效销售员或销售组默认值', { code: 'SALES_COMMERCIAL_DEFAULTS_REQUIRED' });
  assertGroupScope(db, actor, { salesGroupId, businessDate, documentType: 'SALES_ORDER', write: true });
  const lines = quotationLines ? validateFrozenLines(db, quotationLines, businessDate, actor) : buildAuthoritativeSalesLines(db, body, actor, businessDate, customer.id, salespersonId);
  const totalCents = lines.reduce((sum, line) => { const next = sum + line.amountCents; if (!Number.isSafeInteger(next)) throw new HttpError(422, '订单金额超出安全范围'); return next; }, 0);
  const orderId = id(); const orderNo = makeNo('SO'); const stamp = NOW();
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,
    order_date,requested_delivery_date,payment_terms,payment_terms_days,ship_to_contact_name,ship_to_phone,ship_to_address,
    salesperson_id,sales_group_id,settlement_party_id,payer_id,customer_material_xref_id,commercial_tax_code,tax_inclusive,
    required_prepayment_cents,reservation_intent_state,commercial_close_state,gift_summary_cents,commercial_pricing_uom_code,effective_version)
    VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,1)`)
    .run(orderId, orderNo, customer.id, totalCents, String(body.remark || '').slice(0, 500), actor.id, stamp, stamp,
      businessDate, normalizeBusinessDate(body.requestedDeliveryDate || businessDate, '要求交期'), String(body.paymentTerms || extension.default_settlement_method || ''),
      safe(body.paymentTermsDays ?? extension.default_payment_terms_days ?? 0, '付款账期'), body.shipToContactName || customer.contact || '', body.shipToPhone || customer.phone || '', body.shipToAddress || customer.address || '',
      salespersonId, salesGroupId, extension.settlement_party_customer_id || customer.id, extension.payer_customer_id || customer.id,
      body.customerMaterialXrefId || null, body.commercialTaxCode || null, taxInclusiveFlag(body.taxInclusive),
      safe(body.requiredPrepaymentCents ?? 0, '预付款要求'), 'NONE', lines.filter((line) => line.isGiftLine).reduce((sum, line) => sum + line.priceSnapshot.grossAmountCents, 0), lines[0]?.pricingUom || null);
  insertSalesOrderLines(db, orderId, lines);
  audit(db, actor.id, 'CREATE', 'SALES_ORDER', orderId, json({ orderNo, evidenceHash: hash(lines.map((line) => [line.priceSnapshot, line.discountSnapshot])) }));
  if (idempotencyKey) saveIdempotency(db, 'SALES_ORDER_CREATE', idempotencyScope, idempotencyKey, requestFingerprint(body), { id: orderId, orderNo });
  return { id: orderId, orderNo, itemIds: lines.map((line) => line.id), totalCents };
}

export async function createSalesOrder(db, req, res, actor, { requireIdempotencyKey = true } = {}) {
  requireSalesPermission(actor, 'ORDERS_CREATE');
  const body = await readJson(req); const key = String(req.headers['idempotency-key'] || '').trim();
  if (requireIdempotencyKey && !key) throw new HttpError(422, 'Idempotency-Key 必填');
  const fingerprint = requestFingerprint(body);
  const replay = key ? idempotencyReplay(db, 'SALES_ORDER_CREATE', actor.id, key, fingerprint) : null;
  if (replay) return send(res, 200, { ...replay, replayed: true });
  let result; transaction(db, () => { result = createSalesOrderCanonical(db, { body, actor, idempotencyKey: key, idempotencyScope: actor.id }); });
  return send(res, 201, result);
}

export async function updateSalesOrder(db, req, res, actor, orderId) {
  requireSalesPermission(actor, 'ORDERS_CREATE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const current = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lockSuffix(db)}`).get(orderId);
    if (!current) throw new HttpError(404, '销售订单不存在');
    if (!['DRAFT','REJECTED'].includes(current.status)) throw new HttpError(409, '只有草稿或已驳回订单可以编辑');
    if (current.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能编辑自己创建的订单');
    const customerId = body.customerId || current.customer_id; const businessDate = normalizeBusinessDate(body.orderDate || current.order_date, '订单日期');
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(customerId); if (!customer) throw new HttpError(422, '客户不存在或已停用');
    const extension = effectiveExtension(db, customerId, businessDate); const salespersonId = body.salespersonId || current.salesperson_id || extension.default_salesperson_id;
    const salesGroupId = body.salesGroupId || current.sales_group_id || extension.default_sales_group_id;
    assertGroupScope(db, actor, { salesGroupId, businessDate, documentType: 'SALES_ORDER', write: true });
    const lines = buildAuthoritativeSalesLines(db, body, actor, businessDate, customerId, salespersonId);
    const total = lines.reduce((sum, line) => sum + line.amountCents, 0); const stamp = NOW();
    db.prepare('DELETE FROM sales_order_items WHERE order_id=?').run(orderId); insertSalesOrderLines(db, orderId, lines);
    db.prepare(`UPDATE sales_orders SET customer_id=?,total_cents=?,remark=?,updated_at=?,order_date=?,requested_delivery_date=?,
      payment_terms=?,payment_terms_days=?,ship_to_contact_name=?,ship_to_phone=?,ship_to_address=?,salesperson_id=?,sales_group_id=?,
      settlement_party_id=?,payer_id=?,commercial_tax_code=?,tax_inclusive=?,gift_summary_cents=?,commercial_pricing_uom_code=? WHERE id=?`)
      .run(customerId, total, String(body.remark ?? current.remark ?? '').slice(0, 500), stamp, businessDate,
        normalizeBusinessDate(body.requestedDeliveryDate || current.requested_delivery_date || businessDate, '要求交期'),
        String(body.paymentTerms ?? current.payment_terms ?? extension.default_settlement_method ?? ''),
        safe(body.paymentTermsDays ?? current.payment_terms_days ?? extension.default_payment_terms_days ?? 0, '付款账期'),
        body.shipToContactName ?? current.ship_to_contact_name ?? customer.contact ?? '', body.shipToPhone ?? current.ship_to_phone ?? customer.phone ?? '',
        body.shipToAddress ?? current.ship_to_address ?? customer.address ?? '', salespersonId, salesGroupId,
        extension.settlement_party_customer_id || customerId, extension.payer_customer_id || customerId,
        body.commercialTaxCode ?? current.commercial_tax_code, taxInclusiveFlag(body.taxInclusive ?? current.tax_inclusive),
        lines.filter((line) => line.isGiftLine).reduce((sum, line) => sum + line.priceSnapshot.grossAmountCents, 0), lines[0]?.pricingUom || null, orderId);
    audit(db, actor.id, 'UPDATE', 'SALES_ORDER', orderId, JSON.stringify({ evidenceHash: hash(lines.map((line) => [line.priceSnapshot, line.discountSnapshot])) }));
    result = { id: orderId, totalCents: total };
  }); return send(res, 200, result);
}

export async function addSalesOrderGiftLine(db, req, res, actor, orderId) {
  requireSalesPermission(actor, 'ORDERS_CREATE'); const body = await readJson(req); let result;
  transaction(db, () => {
    // Scope is rechecked inside the mutation transaction so a stale UI cannot
    // add a gift line to another sales group's order.
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lockSuffix(db)}`).get(orderId); if (!order) throw new HttpError(404, '销售订单不存在');
    if (order.sales_group_id) assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date || DAY(), documentType: 'SALES_ORDER', write: true });
    if (!['DRAFT','REJECTED'].includes(order.status)) throw new HttpError(409, '已提交或已审批订单只能通过受控变更处理');
    const lines = buildAuthoritativeSalesLines(db, { ...body, requestedDeliveryDate: order.requested_delivery_date,
      items: [{ ...(body.item || body), isGiftLine: true }] }, actor, order.order_date, order.customer_id, order.salesperson_id);
    const line = lines[0]; line.lineNo = Number(db.prepare('SELECT COALESCE(MAX(line_no),0)+1 value FROM sales_order_items WHERE order_id=?').get(orderId).value);
    insertSalesOrderLines(db, orderId, [line]); db.prepare('UPDATE sales_orders SET gift_summary_cents=gift_summary_cents+?,updated_at=? WHERE id=?').run(line.priceSnapshot.grossAmountCents, NOW(), orderId);
    audit(db, actor.id, 'GIFT_LINE_ADDED', 'SALES_ORDER', orderId, JSON.stringify({ itemId: line.id, catalogUnitPriceCents: line.priceSnapshot.catalogUnitPriceCents })); result = { id: orderId, itemId: line.id };
  }); return send(res, 201, result);
}

function projection(db, orderId) {
  const lines = db.prepare(`SELECT i.id,i.quantity,i.upper_delivery_tolerance_bps,i.lower_delivery_tolerance_bps,
    COALESCE((SELECT SUM(di.quantity) FROM sales_delivery_items di JOIN sales_deliveries d ON d.id=di.delivery_id WHERE di.sales_order_item_id=i.id AND d.status='CONFIRMED'),0) delivered
    FROM sales_order_items i WHERE i.order_id=? ORDER BY i.line_no`).all(orderId);
  return lines.map((line) => {
    const bounds = toleranceBoundsMicros(line.quantity, line.upper_delivery_tolerance_bps, line.lower_delivery_tolerance_bps);
    const deliveredMicros = quantityToMicros(line.delivered, '已交付数量');
    return { ...line, orderedMicros: bounds.base, deliveredMicros, lowerToleratedMicros: bounds.lower, upperToleratedMicros: bounds.upper,
      remainingQuantity: Math.max(0, Number(line.quantity) - Number(line.delivered)),
      fulfillmentState: deliveredMicros >= bounds.base ? 'FULLY_DELIVERED' : deliveredMicros > 0 ? 'PARTIALLY_DELIVERED' : 'NOT_DELIVERED',
      controlledCloseEligible: deliveredMicros >= bounds.lower };
  });
}

function assertNoPendingDeliveryNotice(db, orderId) {
  const pending = db.prepare(`SELECT n.id,n.notice_no,n.state FROM delivery_notices n
    WHERE n.sales_order_id=? AND n.state IN ('DRAFT','CONFIRMED')
      AND EXISTS (SELECT 1 FROM delivery_notice_lines l WHERE l.delivery_notice_id=n.id
        AND l.scheduled_qty_micros-l.notified_qty_micros-l.cancelled_notified_qty_micros>0)
    ORDER BY n.created_at,n.id LIMIT 1`).get(orderId);
  if (pending) throw new HttpError(409, `存在待处理发货通知 ${pending.notice_no || pending.id}，不能关闭订单`, { code: 'SALES_ORDER_PENDING_DELIVERY_NOTICE' });
}

export function listSalesOrders(db, res, actor, url) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const where = []; const params = [];
  const archiveFilter = lifecycleArchiveFilter('SALES_ORDER', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'so.id' });
  if (archiveFilter.clause) where.push(archiveFilter.clause);
  const status = String(url.searchParams.get('status') || '').trim();
  if (status) { where.push('so.status=?'); params.push(status); }
  const search = String(url.searchParams.get('search') || '').trim();
  if (search) { where.push('(so.order_no LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const candidates = db.prepare(`SELECT so.*,c.code customer_code,c.name customer_name FROM sales_orders so JOIN customers c ON c.id=so.customer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY so.created_at DESC`).all(...params);
  const rows = candidates.filter((order) => {
    if (!order.sales_group_id) return true;
    try {
      assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date || DAY(), documentType: 'SALES_ORDER' });
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) return false;
      throw error;
    }
  });
  return send(res, 200, { orders: rows });
}
export function getSalesOrder(db, res, actor, orderId) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId); if (!order) throw new HttpError(404, '销售订单不存在');
  if (order.sales_group_id) assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date || DAY(), documentType: 'SALES_ORDER' });
  const items = db.prepare(`SELECT i.*,p.code productCode,p.name productName,p.unit FROM sales_order_items i
    JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.line_no`).all(orderId).map((row) => ({ ...row,
    productId: row.product_id, unitPriceCents: row.unit_price_cents, amountCents: row.amount_cents, lineNo: row.line_no,
    documentUomCode: row.document_uom_code, documentQuantityNumerator: row.document_quantity_num,
    documentQuantityDenominator: row.document_quantity_den, conversionNumerator: row.conversion_numerator,
    conversionDenominator: row.conversion_denominator, baseQuantityNumerator: row.base_quantity_num, baseQuantityDenominator: row.base_quantity_den,
    priceSnapshot: row.price_snapshot_json ? parse(row.price_snapshot_json, '价格快照') : null,
    discountSnapshot: row.discount_snapshot_json ? parse(row.discount_snapshot_json, '折扣快照') : null }));
  const history = db.prepare(`SELECT l.action,l.detail,l.created_at createdAt,u.display_name userName
    FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.entity_type='SALES_ORDER' AND l.entity_id=? ORDER BY l.created_at`).all(orderId);
  const customer = db.prepare('SELECT code,name FROM customers WHERE id=?').get(order.customer_id) || {};
  return send(res, 200, { order: { ...order,
    orderNo: order.order_no, customerId: order.customer_id, customerCode: customer.code, customerName: customer.name,
    totalCents: order.total_cents, orderDate: order.order_date, requestedDeliveryDate: order.requested_delivery_date,
    paymentTerms: order.payment_terms, paymentTermsDays: order.payment_terms_days,
    shipToContactName: order.ship_to_contact_name, shipToPhone: order.ship_to_phone, shipToAddress: order.ship_to_address,
    salespersonId: order.salesperson_id, salesGroupId: order.sales_group_id,
    items, history, fulfillment: projection(db, orderId) } });
}
export function getSalesOrderFulfillment(db, res, actor, orderId) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const order = db.prepare('SELECT id,sales_group_id,order_date FROM sales_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  if (order.sales_group_id) assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date || DAY(), documentType: 'SALES_ORDER' });
  return send(res, 200, { lines: projection(db, orderId) });
}

const SALES_ORDER_SUBMIT_REDISCOVERY_CODES = new Set([
  'SALES_PREPAYMENT_LOCK_PLAN_STALE',
  'SALES_PREPAYMENT_PARENT_MISSING',
  'SALES_PREPAYMENT_PARENT_CLOSED',
  'SALES_ORDER_SUBMIT_PLAN_STALE',
  'SALES_ORDER_APPROVE_PLAN_STALE',
]);

function salesOrderSubmitOuterAttempts() {
  const configured = Number(process.env.ERP_GATE_ATTEMPTS_MAX ?? 3);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3 ? configured : 3;
}

function isSalesOrderSubmitRediscoveryEligible(error) {
  if (!error) return false;
  if (error.transactionRetryExhausted) return true;
  return SALES_ORDER_SUBMIT_REDISCOVERY_CODES.has(error.code)
    || SALES_ORDER_SUBMIT_REDISCOVERY_CODES.has(error?.details?.code);
}

function waitForSalesOrderSubmitRediscovery(attempt) {
  const delayMs = Math.min(100, 20 * (2 ** (attempt - 1)));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function readSalesOrderSubmitRows(db, orderId, { locked = false } = {}) {
  const suffix = locked ? lockSuffix(db) : '';
  const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${suffix}`).get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  const lines = db.prepare(`SELECT * FROM sales_order_items WHERE order_id=? ORDER BY id${suffix}`).all(orderId);
  return { order, lines };
}

function salesOrderSubmitFingerprint(order, lines) {
  return requestFingerprint({ order, lines });
}

function validateSalesOrderSubmit(db, actor, order, lines) {
  if (order.sales_group_id) {
    assertGroupScope(db, actor, {
      salesGroupId: order.sales_group_id,
      businessDate: order.order_date || DAY(),
      documentType: 'SALES_ORDER',
      write: true,
    });
  }
  if (!['DRAFT', 'REJECTED'].includes(order.status)) throw new HttpError(409, '订单状态不可提交');
  if (!order.order_date) throw new HttpError(400, '提交前请填写订单日期');
  if (!order.requested_delivery_date) throw new HttpError(400, '提交前请填写要求交期');
  if (order.requested_delivery_date < order.order_date) throw new HttpError(400, '要求交期不能早于订单日期');
  if (!String(order.ship_to_contact_name || '').trim()) throw new HttpError(400, '提交前请填写收货联系人');
  if (!String(order.ship_to_phone || '').trim()) throw new HttpError(400, '提交前请填写收货电话');
  if (!String(order.ship_to_address || '').trim()) throw new HttpError(400, '提交前请填写收货地址');
  if (!String(order.payment_terms || '').trim()) throw new HttpError(400, '提交前请填写付款条件');
  const invalidLine = lines.some((line) => Number(line.quantity) <= 0
    || Number(line.amount_cents) < 0
    || (!Number(line.is_gift_line || 0) && Number(line.unit_price_cents) <= 0)
    || (Number(line.is_gift_line || 0) === 1 && Number(line.amount_cents) !== 0));
  if (invalidLine) throw new HttpError(409, '订单明细金额或赠品商业属性无效', { code: 'SALES_ORDER_LINE_INVALID' });
  if (lines.some((line) => line.price_snapshot_json == null || line.discount_snapshot_json == null)) {
    throw new HttpError(409, '新订单行缺少权威商业快照', { code: 'SALES_SNAPSHOT_REQUIRED' });
  }
  validateStoredOrderSnapshots(db, order, lines);
}

function discoverSalesOrderSubmitPlan(db, actor, orderId) {
  const { order, lines } = readSalesOrderSubmitRows(db, orderId);
  validateSalesOrderSubmit(db, actor, order, lines);
  const businessDate = order.order_date || DAY();
  const gatePlan = discoverSalesPrepaymentGatePlan(db, orderId, businessDate);
  return Object.freeze({
    orderId,
    businessDate,
    salesFingerprint: salesOrderSubmitFingerprint(order, lines),
    gatePlan: Object.freeze({ ...gatePlan, parentBalanceIds: Object.freeze([...gatePlan.parentBalanceIds]) }),
  });
}

function submitSalesOrder(db, res, actor, orderId, body, key, operation, fingerprint) {
  const maxAttempts = salesOrderSubmitOuterAttempts();
  const admission = startGateRetryAdmission(process.env.ERP_GATE_ATTEMPTS_BUDGET_MS);
  let attemptsStarted = 0;
  const deadlineExhausted = () => new HttpError(503, '销售订单提交重试已耗尽', {
    code: 'SALES_ORDER_SUBMIT_RETRY_EXHAUSTED',
    retryable: true,
    attempts: attemptsStarted,
    causeCode: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
  });
  while (attemptsStarted < maxAttempts) {
    if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
    attemptsStarted += 1;
    const attempt = attemptsStarted;
    const plan = discoverSalesOrderSubmitPlan(db, actor, orderId);
    let result;
    try {
      transaction(db, () => {
        // L1 -> reserved L2..L5 -> L6 -> L7. The shared helper owns the
        // Finance/Gate sequence and performs no Sales business-row lock.
        // The Credit Check is composed into the reserved L2..L5 window
        // (§36.14.3): it runs after the Finance PREPAYMENT parent lock and
        // before the Gate result / requirement locks.
        authorizeSalesPrepaymentGateWithPlan(db, plan.gatePlan, {
          stage: 'PLANNING_RELEASE',
          actorId: actor.id,
          mutationKey: `ACTION|PLANNING_RELEASE|SUBMIT|${orderId}|${key || fingerprint}`,
          afterParentLock: ({ parentBalanceIds }) => {
            const subject = db.prepare('SELECT customer_id, salesperson_id, total_cents, order_date FROM sales_orders WHERE id=?').get(orderId);
            assertCreditAllowsBusinessAction(db, {
              customerId: subject.customer_id,
              salespersonId: subject.salesperson_id,
              stage: 'SO_SUBMIT',
              businessDate: subject.order_date || plan.businessDate,
              proposedDeltaCents: Number(subject.total_cents),
              recognitionMode: resolveRecognitionPolicy(db, 'AR', 'SALES_DELIVERY', null, subject.order_date || plan.businessDate).mode,
              sourceRef: { sourceType: 'SALES_ORDER', sourceId: orderId },
              actorId: actor.id,
              authorizationContext: actor.id,
              prepaymentParentsLocked: parentBalanceIds.length > 0,
            });
          },
        });

        // L8 is unconditionally last: lock the Sales Order, then its items in
        // stable id order, and derive mutation authority only from these rows.
        const { order, lines } = readSalesOrderSubmitRows(db, orderId, { locked: true });
        if (salesOrderSubmitFingerprint(order, lines) !== plan.salesFingerprint) {
          throw new HttpError(409, '销售订单提交计划已过期，请重试', {
            code: 'SALES_ORDER_SUBMIT_PLAN_STALE',
          });
        }
        validateSalesOrderSubmit(db, actor, order, lines);
        db.prepare("UPDATE sales_orders SET status='SUBMITTED',submitted_at=?,updated_at=? WHERE id=?").run(NOW(), NOW(), orderId);
        result = { ok: true, id: orderId, action: 'submit' };
        if (key) saveIdempotency(db, operation, orderId, key, fingerprint, result);
        audit(db, actor.id, 'SUBMIT', 'SALES_ORDER', orderId, String(body.reason || ''));
      });
      return send(res, 200, result);
    } catch (error) {
      if (!isSalesOrderSubmitRediscoveryEligible(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new HttpError(503, '销售订单提交重试已耗尽', {
          code: 'SALES_ORDER_SUBMIT_RETRY_EXHAUSTED',
          retryable: true,
          attempts: attempt,
          causeCode: error?.details?.code || error?.code || null,
        });
      }
      if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
      waitForSalesOrderSubmitRediscovery(attempt);
    }
  }
  throw new HttpError(503, '销售订单提交重试已耗尽', { code: 'SALES_ORDER_SUBMIT_RETRY_EXHAUSTED', retryable: true });
}

function discoverSalesOrderApprovePlan(db, actor, orderId) {
  // Read-only discovery. No business row is locked here; the authoritative
  // decision is taken under the L8 lock and revalidated against this snapshot.
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审批订单可以处理');
  if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审批自己的订单');
  if (order.sales_group_id) {
    assertGroupScope(db, actor, {
      salesGroupId: order.sales_group_id,
      businessDate: order.order_date || DAY(),
      documentType: 'SALES_ORDER',
      write: true,
    });
  }
  return Object.freeze({
    orderId,
    customerId: order.customer_id,
    salespersonId: order.salesperson_id,
    businessDate: order.order_date || DAY(),
    totalCents: Number(order.total_cents),
    orderFingerprint: requestFingerprint({
      status: order.status, customerId: order.customer_id, salespersonId: order.salesperson_id,
      totalCents: Number(order.total_cents), salesGroupId: order.sales_group_id || null,
      orderDate: order.order_date || null, creatorId: order.creator_id,
    }),
  });
}

// §37.19.1 — Wave 10 makes `approve` credit-controlled and its sequence
// becomes L1? -> L2..L5 -> L8. The Sales Order row lock moves to the last
// position; every authority decision is still taken under that lock and
// revalidated against the discovery snapshot.
function approveSalesOrder(db, res, actor, orderId, body, key, operation, fingerprint) {
  const maxAttempts = salesOrderSubmitOuterAttempts();
  const admission = startGateRetryAdmission(process.env.ERP_GATE_ATTEMPTS_BUDGET_MS);
  let attemptsStarted = 0;
  const deadlineExhausted = () => new HttpError(503, '销售订单审批重试已耗尽', {
    code: 'SALES_ORDER_APPROVE_RETRY_EXHAUSTED',
    retryable: true,
    attempts: attemptsStarted,
    causeCode: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
  });
  while (attemptsStarted < maxAttempts) {
    if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
    attemptsStarted += 1;
    const attempt = attemptsStarted;
    const plan = discoverSalesOrderApprovePlan(db, actor, orderId);
    let result;
    try {
      transaction(db, () => {
        // L1 — the Finance PREPAYMENT parent lock. The approve path invokes no
        // Gate phase, so the Credit Check owns the L1 lock here.
        lockCreditPrepaymentParents(db, { customerId: plan.customerId, businessDate: plan.businessDate });
        // L2..L5 — the Credit Check.
        assertCreditAllowsBusinessAction(db, {
          customerId: plan.customerId,
          salespersonId: plan.salespersonId,
          stage: 'SO_APPROVE',
          businessDate: plan.businessDate,
          proposedDeltaCents: plan.totalCents,
          recognitionMode: resolveRecognitionPolicy(db, 'AR', 'SALES_DELIVERY', null, plan.businessDate).mode,
          sourceRef: { sourceType: 'SALES_ORDER', sourceId: orderId },
          actorId: actor.id,
          authorizationContext: actor.id,
          prepaymentParentsLocked: true,
        });
        // L8 — the Sales Order row, unconditionally last.
        const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lockSuffix(db)}`).get(orderId);
        if (!order) throw new HttpError(404, '销售订单不存在');
        if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审批订单可以处理');
        if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审批自己的订单');
        if (order.sales_group_id) {
          assertGroupScope(db, actor, {
            salesGroupId: order.sales_group_id,
            businessDate: order.order_date || DAY(),
            documentType: 'SALES_ORDER',
            write: true,
          });
        }
        if (requestFingerprint({
          status: order.status, customerId: order.customer_id, salespersonId: order.salesperson_id,
          totalCents: Number(order.total_cents), salesGroupId: order.sales_group_id || null,
          orderDate: order.order_date || null, creatorId: order.creator_id,
        }) !== plan.orderFingerprint) {
          throw new HttpError(409, '销售订单审批计划已过期，请重试', { code: 'SALES_ORDER_APPROVE_PLAN_STALE' });
        }
        validateStoredOrderSnapshots(db, order);
        db.prepare("UPDATE sales_orders SET status='APPROVED',reviewer_id=?,reviewed_at=?,updated_at=? WHERE id=?").run(actor.id, NOW(), NOW(), orderId);
        result = { ok: true, id: orderId, action: 'approve' };
        if (key) saveIdempotency(db, operation, orderId, key, fingerprint, result);
        audit(db, actor.id, 'APPROVE', 'SALES_ORDER', orderId, String(body.reason || ''));
      });
      return send(res, 200, result);
    } catch (error) {
      if (!isSalesOrderSubmitRediscoveryEligible(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new HttpError(503, '销售订单审批重试已耗尽', {
          code: 'SALES_ORDER_APPROVE_RETRY_EXHAUSTED',
          retryable: true,
          attempts: attempt,
          causeCode: error?.details?.code || error?.code || null,
        });
      }
      if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
      waitForSalesOrderSubmitRediscovery(attempt);
    }
  }
  throw new HttpError(503, '销售订单审批重试已耗尽', { code: 'SALES_ORDER_APPROVE_RETRY_EXHAUSTED', retryable: true });
}

export async function salesOrderAction(db, req, res, actor, orderId, action, { requireIdempotencyKey = true } = {}) {
  if (action === 'submit') requireSalesPermission(actor, 'ORDERS_SUBMIT');
  else if (action === 'approve') requireSalesPermission(actor, 'ORDERS_APPROVE');
  else if (action === 'reject') requireSalesPermission(actor, 'ORDERS_REJECT');
  else if (action === 'close' || action === 'cancel') requireSalesPermission(actor, 'SALES_MANAGE');
  else throw new HttpError(400, '无效订单动作');
  const body = await readJson(req); const key = String(req.headers['idempotency-key'] || '').trim(); if (requireIdempotencyKey && !key) throw new HttpError(422, 'Idempotency-Key 必填');
  const operation = `SALES_ORDER_${action.toUpperCase()}`; const fingerprint = requestFingerprint({ action, body });
  const replay = key ? idempotencyReplay(db, operation, orderId, key, fingerprint) : null; if (replay) return send(res, 200, { ...replay, replayed: true });
  if (action === 'submit') return submitSalesOrder(db, res, actor, orderId, body, key, operation, fingerprint);
  if (action === 'approve') return approveSalesOrder(db, res, actor, orderId, body, key, operation, fingerprint);
  let result;
  transaction(db, () => {
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lockSuffix(db)}`).get(orderId); if (!order) throw new HttpError(404, '销售订单不存在');
    if (order.sales_group_id) assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date || DAY(), documentType: 'SALES_ORDER', write: true });
    if (action === 'reject') { if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审批订单可以处理'); if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审批自己的订单');
      db.prepare("UPDATE sales_orders SET status='REJECTED',reviewer_id=?,reviewed_at=?,rejection_reason=?,updated_at=? WHERE id=?").run(actor.id, NOW(), String(body.reason || '').trim(), NOW(), orderId);
    } else if (action === 'close' || action === 'cancel') { if (order.status !== 'APPROVED' || order.commercial_close_state !== 'OPEN') throw new HttpError(409, '订单不可关闭'); const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(422, '关闭原因必填');
      const facts = projection(db, orderId);
      assertNoPendingDeliveryNotice(db, orderId);
      if (action === 'cancel' && facts.some((line) => line.deliveredMicros > 0)) throw new HttpError(409, '已有交付事实的订单不能商业取消', { code: 'SALES_ORDER_EXECUTED_CANNOT_CANCEL' });
      if (action === 'close' && facts.some((line) => !line.controlledCloseEligible)) throw new HttpError(409, '交付数量未达到订单行下容差，不能受控关闭', { code: 'SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED' });
      const nextState = action === 'close' ? 'CLOSED' : 'CANCELLED';
      db.prepare('UPDATE sales_orders SET commercial_close_state=?,remark=?,updated_at=? WHERE id=?').run(nextState, `${order.remark || ''}\n${reason}`.trim(), NOW(), orderId);
      body.__closeAudit = { reason, before: { commercialCloseState: order.commercial_close_state, lines: facts.map((line) => ({ id: line.id, orderedMicros: line.orderedMicros, deliveredMicros: line.deliveredMicros, lowerToleratedMicros: line.lowerToleratedMicros, upperToleratedMicros: line.upperToleratedMicros })) }, after: { commercialCloseState: nextState } };
    } else throw new HttpError(400, '无效订单动作');
    result = { ok: true, id: orderId, action }; if (key) saveIdempotency(db, operation, orderId, key, fingerprint, result); audit(db, actor.id, action.toUpperCase(), 'SALES_ORDER', orderId, body.__closeAudit ? JSON.stringify(body.__closeAudit) : String(body.reason || ''));
  });
  return send(res, 200, result);
}
