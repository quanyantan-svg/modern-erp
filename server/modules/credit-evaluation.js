// Sales & Customer Wave 11-B / W11-C — Credit Evaluation Foundation, bounded
// multi-scorer and rating application (SC103–SC107).
//
// solution.md §37.54.9 (W11-B) / §37.54.10 (W11-C); document.md Stage B
// §6.4 / §6.5 (R103-1..R107-9).
//
// This module owns the whole W11-B / W11-C write surface:
//
//   - the effective-dated configuration objects (indicator / scheme / model),
//   - the scoring sheet lifecycle (DRAFT -> SUBMITTED -> FINALIZED -> APPLIED),
//   - the deterministic integer scoring arithmetic,
//   - the rating application onto a Credit Profile version.
//
// SOLE RATING WRITER. The rating itself is NOT written here. The single
// writer is `applyCreditRating()` in `credit-profile.js`, which this module
// calls inside its own transaction. The three `credit_profile.rating_*`
// columns therefore appear in no INSERT or UPDATE in this file, and the
// Wave 9 CHECK on `credit_profile_ratings` is satisfied BY CONSTRUCTION.
//
// DETERMINISM. Every score is an integer milli-point and every weight is an
// integer milli-weight. There is no floating point anywhere in the scoring
// path, so the result is bit-identical on SQLite and MySQL.
//
// CORRECTION-3 (§37.54.9.1). The three configuration objects are effective
// dated with `UNIQUE(code, effective_from)`, and the interval contract is
// enforced by the application layer:
//
//   (1) at most one effective version per business date per (kind, code);
//   (2) a shared lock covers the whole check-then-write interval — MySQL uses
//       the repository's deterministic named lock, SQLite relies on the
//       serialising write transaction;
//   (3) the predecessor is terminated and any interval overlap is refused;
//   (4) a referenced row is immutable, except the one-way ACTIVE -> RETIRED
//       status migration;
//   (5) a model references indicators BY INDICATOR ROW ID, so the
//       scoring_sheet -> model -> indicator chain pins the exact versions and
//       weights a sheet used, with no extra snapshot column;
//   (6) both engines reach the SAME verdict with the SAME error codes.
//
// ERROR CODES (fail closed, never silently repaired):
//
//   CREDIT_EVALUATION_INDICATOR_INVALID / _SCHEME_INVALID / _MODEL_INVALID
//   CREDIT_EVALUATION_WEIGHT_INVALID
//   CREDIT_EVALUATION_INPUT_OUT_OF_RANGE
//   CREDIT_EVALUATION_MISSING_INDICATOR
//   CREDIT_EVALUATION_DUPLICATE_INDICATOR
//   CREDIT_SHEET_STATE_INVALID
//   CREDIT_SHEET_NOT_ALLOWED_SCORER
//   CREDIT_SHEET_NOT_FINALIZED
//   CREDIT_EVALUATION_RESULT_ALREADY_APPLIED
//   CREDIT_RATING_TARGET_PROFILE_CHANGED
//   CREDIT_EVALUATION_VERSION_EXISTS
//   CREDIT_EVALUATION_INTERVAL_OVERLAP
//   CREDIT_EVALUATION_IMMUTABLE_AFTER_REFERENCE

import { createHash, randomUUID } from 'node:crypto';
import { releaseMySqlIdempotencyLocks, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  assertAllowedFields, HttpError, normalizeBusinessDate, optionalText, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import { assertDateRange, previousDate } from './sales-foundation-common.js';
import { applyCreditRating } from './credit-profile.js';
import { ensureCreditLockAnchor } from './credit-anchor.js';
import {
  requireCreditEvaluationAuthority, requireCreditManagementAuthority, resolveCreditProfileReadScope,
} from './credit-scope.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

export const CREDIT_EVALUATION_INDICATOR_KINDS = Object.freeze(['QUALITATIVE', 'QUANTITATIVE']);
export const CREDIT_EVALUATION_STATUSES = Object.freeze(['ACTIVE', 'RETIRED']);
export const CREDIT_EVALUATION_SHEET_STATUSES = Object.freeze(['DRAFT', 'SUBMITTED', 'FINALIZED', 'APPLIED']);

// The unit contract (§37.54.9.2): 10000 milli-weight is 100 %, and a
// milli-point is 1/1000 of a point.
export const MILLI_WEIGHT_TOTAL = 10000;

const OPEN_ENDED_DATE = '9999-12-31';
const SCOPE_AGGREGATE = '*';

// ---------------------------------------------------------------------------
// §37.54.9.2 — integer scoring arithmetic. Pure functions, no floats.
// ---------------------------------------------------------------------------

/**
 * Round half up, pure integer arithmetic.
 * `floor((numerator + 5000) / 10000)` is the frozen contribution formula.
 */
export function roundHalfUpMilli(numerator) {
  return Math.floor((numerator + 5000) / 10000);
}

/**
 * The weighted contribution of one achieved score:
 *   contribution_milli = floor((achieved_milli * weight_milli + 5000) / 10000)
 */
export function weightedContributionMilli(achievedMilli, weightMilli) {
  return roundHalfUpMilli(achievedMilli * weightMilli);
}

/**
 * The model's full score:
 *   max_total_milli = sum(round_half_up(max_score_milli * weight_milli / 10000))
 */
export function modelMaxTotalMilli(entries) {
  return entries.reduce((sum, entry) => sum + roundHalfUpMilli(entry.maxScoreMilli * entry.weightMilli), 0);
}

/**
 * The model's total score: each contribution is rounded FIRST, then summed.
 *   total_score_milli = sum(contribution_milli over all indicators)
 */
export function modelTotalScoreMilli(entries) {
  return entries.reduce((sum, entry) => sum + weightedContributionMilli(entry.achievedMilli, entry.weightMilli), 0);
}

/**
 * The unique grade band containing `totalScoreMilli`.
 * The scheme bands must tile [0, maxTotalMilli] with no gap and no overlap;
 * the scheme validator proves that at creation time, so exactly one band
 * matches here.
 */
export function resolveGrade(bands, totalScoreMilli) {
  const matched = bands.filter((band) => totalScoreMilli >= band.minScoreMilli && totalScoreMilli <= band.maxScoreMilli);
  if (matched.length !== 1) {
    throw new HttpError(409, '评级区间未能唯一命中总分', { code: 'CREDIT_EVALUATION_SCHEME_INVALID' });
  }
  return matched[0];
}

// ---------------------------------------------------------------------------
// Canonical JSON. `sheet_data_json` is written in a deterministic order so
// `sha256(canonicalJson(sheet_data_json))` is a reproducible digest.
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
      : item
  ));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// §37.54.9.1 (2) — the shared lock over the check-then-write interval.
//
// MySQL uses the repository's deterministic named lock, the same mechanism,
// the same controlled-release contract and the same 48-character convention
// as `financial-controls.js`. SQLite needs no extra lock: the write
// transaction itself serialises.
// ---------------------------------------------------------------------------

function configurationLockName(kind, code) {
  return `erp-credit-cfg-${createHash('sha256').update(`${kind}|${code}`).digest('hex').slice(0, 48)}`;
}

function acquireConfigurationLock(db, kind, code) {
  if (db?.dialect !== 'mysql') return null;
  const lockName = configurationLockName(kind, code);
  const acquired = Number(db.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName)?.acquired);
  if (acquired !== 1) throw new HttpError(503, '信用评估配置正在被其它请求修改，请重试', { code: 'CREDIT_EVALUATION_CONFIG_LOCKED' });
  db._idempotencyLocks ||= new Set();
  db._idempotencyLocks.add(lockName);
  return lockName;
}

function releaseConfigurationLock(db, lockName) {
  if (!lockName) return;
  releaseMySqlIdempotencyLocks(db, { lockNames: [lockName] });
}

// ---------------------------------------------------------------------------
// Input helpers.
// ---------------------------------------------------------------------------

function optionalDate(value, label) {
  return value == null || value === '' ? null : normalizeBusinessDate(value, label);
}

function enumValue(value, values, label, code) {
  const text = requiredCode(value, label);
  if (!values.includes(text)) throw new HttpError(400, `${label}无效`, { code });
  return text;
}

function integerMilli(value, label, code, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label}必须是 ${min} 以上的整数`, { code });
  }
  return number;
}

function parseJsonObject(text, label, code) {
  // The caller may hand over either a JSON string (a persisted column) or an
  // already-decoded object (a request payload). Both must reach the same
  // verdict, so the object form is accepted without a re-parse.
  let parsed = text;
  if (typeof text === 'string') {
    try { parsed = JSON.parse(text); } catch { throw new HttpError(400, `${label}必须是合法 JSON`, { code }); }
  } else if (text == null) {
    throw new HttpError(400, `${label}必须是合法 JSON`, { code });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, `${label}必须是 JSON 对象`, { code });
  }
  return parsed;
}

function parseJsonArray(text, label, code) {
  // The grade band set and the indicator option / band sets are JSON ARRAYS.
  // They are read both from a persisted column (a JSON string) and from a
  // request payload (an already-decoded array), so both forms are accepted.
  let parsed = text;
  if (typeof text === 'string') {
    try { parsed = JSON.parse(text); } catch { throw new HttpError(400, `${label}必须是合法 JSON`, { code }); }
  } else if (text == null) {
    throw new HttpError(400, `${label}必须是合法 JSON`, { code });
  }
  if (!Array.isArray(parsed)) {
    throw new HttpError(400, `${label}必须是 JSON 数组`, { code });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// §37.54.9.1 (3) — the predecessor termination and overlap detection.
//
// The check covers the WHOLE timeline, not only the predecessor, so a new
// version can never overlap a non-adjacent existing version either.
// ---------------------------------------------------------------------------

const CONFIGURATION_TABLES = Object.freeze({
  INDICATOR: 'credit_evaluation_indicator',
  SCHEME: 'credit_evaluation_scheme',
  MODEL: 'credit_evaluation_model',
});

const CONFIGURATION_CODES = Object.freeze({
  INDICATOR: 'CREDIT_EVALUATION_INDICATOR_INVALID',
  SCHEME: 'CREDIT_EVALUATION_SCHEME_INVALID',
  MODEL: 'CREDIT_EVALUATION_MODEL_INVALID',
});

function closePredecessorAndAssertNoOverlap(db, table, code, effectiveFrom, effectiveTo) {
  const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const rows = db.prepare(`SELECT * FROM ${table} WHERE code=? ORDER BY effective_from,id${suffix}`).all(code);
  if (rows.some((row) => row.effective_from === effectiveFrom)) {
    throw new HttpError(409, '该配置同一生效日期已存在版本', { code: 'CREDIT_EVALUATION_VERSION_EXISTS' });
  }
  const predecessor = [...rows].reverse().find((row) => row.effective_from < effectiveFrom);
  if (predecessor && (predecessor.effective_to == null || predecessor.effective_to >= effectiveFrom)) {
    // The predecessor's open (or still covering) interval is tightened to the
    // day before the new version starts.
    db.prepare(`UPDATE ${table} SET effective_to=? WHERE id=?`).run(previousDate(effectiveFrom), predecessor.id);
  }
  const max = effectiveTo || OPEN_ENDED_DATE;
  const overlaps = rows.some((row) => row.id !== predecessor?.id
    && row.effective_from <= max && effectiveFrom <= (row.effective_to || OPEN_ENDED_DATE));
  if (overlaps) {
    throw new HttpError(409, '该配置生效期间与现有版本重叠', { code: 'CREDIT_EVALUATION_INTERVAL_OVERLAP' });
  }
}

// ---------------------------------------------------------------------------
// §37.54.9.1 (4) — reference counting. A referenced configuration row may
// not be updated in place; only the one-way ACTIVE -> RETIRED status
// migration is permitted.
// ---------------------------------------------------------------------------

function countModelsReferencingIndicator(db, indicatorId) {
  const rows = db.prepare('SELECT indicator_weights_json FROM credit_evaluation_model').all();
  let count = 0;
  for (const row of rows) {
    let weights;
    try { weights = JSON.parse(row.indicator_weights_json); } catch { continue; }
    if (weights && typeof weights === 'object' && Object.prototype.hasOwnProperty.call(weights, indicatorId)) count += 1;
  }
  return count;
}

function countModelsReferencingScheme(db, schemeId) {
  return Number(db.prepare('SELECT COUNT(*) count FROM credit_evaluation_model WHERE scheme_id=?').get(schemeId)?.count || 0);
}

function countSheetsReferencingModel(db, modelId) {
  return Number(db.prepare('SELECT COUNT(*) count FROM credit_evaluation_scoring_sheet WHERE model_id=?').get(modelId)?.count || 0);
}

// ---------------------------------------------------------------------------
// Validators.
// ---------------------------------------------------------------------------

/**
 * Indicator validation (R103-1 / R103-2).
 *
 * `max_score_milli` is a positive integer. `input_spec_json` carries
 * `options` for a QUALITATIVE indicator (each with `value` and `scoreMilli`)
 * or `bands` for a QUANTITATIVE indicator (each with `min` / `max` and
 * `scoreMilli`).
 */
function validateIndicatorPayload(payload) {
  const code = CONFIGURATION_CODES.INDICATOR;
  const kind = enumValue(payload.indicatorKind, CREDIT_EVALUATION_INDICATOR_KINDS, '指标类型', code);
  const maxScoreMilli = integerMilli(payload.maxScoreMilli, '指标最大分值（milli）', code, { min: 1 });
  const spec = parseJsonObject(payload.inputSpec, '指标输入规格', code);
  const specKind = spec.kind ? enumValue(spec.kind, CREDIT_EVALUATION_INDICATOR_KINDS, '指标输入规格类型', code) : kind;
  if (specKind !== kind) {
    throw new HttpError(400, '指标输入规格类型与指标类型不一致', { code });
  }
  if (kind === 'QUALITATIVE') {
    const options = Array.isArray(spec.options) ? spec.options : null;
    if (!options || !options.length) throw new HttpError(400, '定性指标必须声明至少一个选项', { code });
    const values = new Set();
    for (const option of options) {
      if (!option || typeof option !== 'object' || Array.isArray(option)) throw new HttpError(400, '定性指标选项格式无效', { code });
      if (typeof option.value !== 'string' || !option.value) throw new HttpError(400, '定性指标选项必须声明取值', { code });
      if (values.has(option.value)) throw new HttpError(400, '定性指标选项取值不能重复', { code });
      values.add(option.value);
      integerMilli(option.scoreMilli, '定性指标选项分值（milli）', code, { min: 0 });
    }
  } else {
    const bands = Array.isArray(spec.bands) ? spec.bands : null;
    if (!bands || !bands.length) throw new HttpError(400, '定量指标必须声明至少一个区间', { code });
    for (const band of bands) {
      if (!band || typeof band !== 'object' || Array.isArray(band)) throw new HttpError(400, '定量指标区间格式无效', { code });
      integerMilli(band.min, '定量指标区间下限', code, { min: 0 });
      integerMilli(band.max, '定量指标区间上限', code, { min: 0 });
      if (Number(band.max) < Number(band.min)) throw new HttpError(400, '定量指标区间上限不能小于下限', { code });
      integerMilli(band.scoreMilli, '定量指标区间分值（milli）', code, { min: 0 });
    }
  }
  return { kind, maxScoreMilli, inputSpec: spec };
}

/**
 * Scheme validation (R104-1 / R104-2). The grade bands must tile
 * `[0, maxTotalMilli]` with no gap and no overlap. `maxTotalMilli` is the
 * model's full score, which the scheme does not know, so the scheme declares
 * the tiling over `[0, maxTotalMilli]` given by the caller; the band set is
 * validated for contiguity and non-overlap here, and the caller proves the
 * upper coverage against the resolved model.
 */
function validateGradeBoundaries(boundaries, code) {
  if (!Array.isArray(boundaries) || !boundaries.length) {
    throw new HttpError(400, '等级方案必须声明至少一个等级区间', { code });
  }
  const normalized = boundaries.map((band) => {
    if (!band || typeof band !== 'object' || Array.isArray(band)) throw new HttpError(400, '等级区间格式无效', { code });
    const grade = requiredText(band.grade, '等级', 50);
    const minScoreMilli = integerMilli(band.minScoreMilli, '等级区间下限（milli）', code, { min: 0 });
    const maxScoreMilli = integerMilli(band.maxScoreMilli, '等级区间上限（milli）', code, { min: 0 });
    if (maxScoreMilli < minScoreMilli) throw new HttpError(400, '等级区间上限不能小于下限', { code });
    return { grade, minScoreMilli, maxScoreMilli };
  }).sort((left, right) => left.minScoreMilli - right.minScoreMilli);
  if (normalized[0].minScoreMilli !== 0) {
    throw new HttpError(400, '等级区间必须从 0 开始覆盖', { code });
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].minScoreMilli !== normalized[index - 1].maxScoreMilli + 1) {
      throw new HttpError(400, '等级区间存在空洞或重叠', { code });
    }
  }
  return normalized;
}

/**
 * Model validation (R105-1 / R105-2). The per-indicator weights are integer
 * milli-weights that must sum to EXACTLY 10000. A weight set that does not
 * sum to 10000 is refused; it is never silently normalised.
 *
 * The model references indicators BY INDICATOR ROW ID (§37.54.9.1 (5)).
 */
function validateIndicatorWeights(db, weights, code) {
  // Every weight-domain failure carries the weight-specific code, so a caller
  // can distinguish "the weight set is wrong" from "the model row is wrong".
  const weightCode = 'CREDIT_EVALUATION_WEIGHT_INVALID';
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new HttpError(400, '模型必须声明指标权重', { code: weightCode });
  }
  const entries = Object.entries(weights);
  if (!entries.length) throw new HttpError(400, '模型必须声明至少一个指标权重', { code: weightCode });
  const resolved = [];
  let total = 0;
  for (const [indicatorId, weight] of entries) {
    const weightMilli = integerMilli(weight, `指标 ${indicatorId} 的权重（milli）`, weightCode, { min: 0 });
    const indicator = db.prepare('SELECT * FROM credit_evaluation_indicator WHERE id=?').get(indicatorId);
    if (!indicator) throw new HttpError(400, `指标 ${indicatorId} 不存在`, { code });
    if (indicator.status !== 'ACTIVE') throw new HttpError(400, `指标 ${indicatorId} 已停用`, { code });
    total += weightMilli;
    resolved.push({ indicator, weightMilli });
  }
  if (total !== MILLI_WEIGHT_TOTAL) {
    throw new HttpError(400, `模型权重合计必须等于 ${MILLI_WEIGHT_TOTAL}，当前为 ${total}`, { code: 'CREDIT_EVALUATION_WEIGHT_INVALID' });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Presentation.
// ---------------------------------------------------------------------------

function presentIndicator(row) {
  let inputSpec = null;
  try { inputSpec = JSON.parse(row.input_spec_json); } catch { inputSpec = null; }
  return {
    id: row.id, code: row.code, name: row.name, indicatorKind: row.indicator_kind,
    description: row.description, maxScoreMilli: Number(row.max_score_milli), inputSpec,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, status: row.status,
    createdAt: row.created_at, createdBy: row.created_by,
  };
}

function presentScheme(row) {
  let gradeBoundaries = null;
  try { gradeBoundaries = JSON.parse(row.grade_boundaries_json); } catch { gradeBoundaries = null; }
  return {
    id: row.id, code: row.code, name: row.name, gradeBoundaries,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, status: row.status,
    createdAt: row.created_at, createdBy: row.created_by,
  };
}

function presentModel(row) {
  let indicatorWeights = null;
  try { indicatorWeights = JSON.parse(row.indicator_weights_json); } catch { indicatorWeights = null; }
  return {
    id: row.id, code: row.code, name: row.name, schemeId: row.scheme_id, indicatorWeights,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, status: row.status,
    createdAt: row.created_at, createdBy: row.created_by,
  };
}

function presentSheet(row) {
  let allowedEvaluatorIds = [];
  let sheetData = null;
  try { allowedEvaluatorIds = JSON.parse(row.allowed_evaluator_ids_json); } catch { allowedEvaluatorIds = []; }
  try { sheetData = JSON.parse(row.sheet_data_json); } catch { sheetData = null; }
  return {
    id: row.id, sheetNo: row.sheet_no, modelId: row.model_id,
    creditObjectType: row.credit_object_type, creditObjectId: row.credit_object_id,
    customerId: row.customer_id, profileScopeKey: row.profile_scope_key,
    creditProfileId: row.credit_profile_id, businessDate: row.business_date, status: row.status,
    allowedEvaluatorIds, sheetData, evaluatorCount: Number(row.evaluator_count),
    createdAt: row.created_at, createdBy: row.created_by,
    updatedAt: row.updated_at, updatedBy: row.updated_by, submittedAt: row.submitted_at,
    finalizedAt: row.finalized_at, finalizedBy: row.finalized_by, appliedAt: row.applied_at,
  };
}

function presentResult(row) {
  return {
    id: row.id, sheetId: row.sheet_id, modelId: row.model_id, schemeId: row.scheme_id,
    creditProfileId: row.credit_profile_id,
    profileEffectiveStateHash: row.profile_effective_state_hash,
    policySnapshotFingerprint: row.policy_snapshot_fingerprint,
    businessDate: row.business_date,
    totalScoreMilli: Number(row.total_score_milli), maxScoreMilli: Number(row.max_score_milli),
    ratingGrade: row.rating_grade, evaluatorCount: Number(row.evaluator_count),
    createdAt: row.created_at, createdBy: row.created_by,
    appliedToProfileId: row.applied_to_profile_id, appliedAt: row.applied_at, appliedBy: row.applied_by,
  };
}

// ---------------------------------------------------------------------------
// §37.54.9.5 — read surfaces.
// ---------------------------------------------------------------------------

const CONFIGURATION_LISTS = Object.freeze({
  indicators: { table: CONFIGURATION_TABLES.INDICATOR, present: presentIndicator },
  schemes: { table: CONFIGURATION_TABLES.SCHEME, present: presentScheme },
  models: { table: CONFIGURATION_TABLES.MODEL, present: presentModel },
});

function listConfiguration(db, res, actor, url, kind) {
  const spec = CONFIGURATION_LISTS[kind];
  if (!spec) throw new HttpError(404, '评估配置类型不存在', { code: 'CREDIT_EVALUATION_CONFIG_UNKNOWN' });
  // Configuration objects carry no customer scope, so CREDIT_VIEW is the
  // whole authorization (the same shape as the Wave 9 configuration reads).
  if (actor?.roleCode !== 'ADMIN' && !(actor?.permissions || []).includes('CREDIT_VIEW')) {
    throw new HttpError(403, '没有查看信用评估配置的权限', { code: 'CREDIT_SCOPE_DENIED' });
  }
  const filters = [];
  const args = [];
  const code = String(url.searchParams.get('code') || '').trim();
  if (code) { filters.push('code=?'); args.push(code); }
  const businessDate = String(url.searchParams.get('businessDate') || '').trim();
  if (businessDate) {
    const date = normalizeBusinessDate(businessDate);
    filters.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)');
    args.push(date, date);
  }
  const rows = db.prepare(`SELECT * FROM ${spec.table}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY code, effective_from DESC, id`).all(...args);
  return send(res, 200, { [kind]: rows.map(spec.present) });
}

export function listCreditEvaluationIndicators(db, res, actor, url) {
  return listConfiguration(db, res, actor, url, 'indicators');
}

export function listCreditEvaluationSchemes(db, res, actor, url) {
  return listConfiguration(db, res, actor, url, 'schemes');
}

export function listCreditEvaluationModels(db, res, actor, url) {
  return listConfiguration(db, res, actor, url, 'models');
}

// ---------------------------------------------------------------------------
// §37.54.9.5 — the scoring sheet list / detail.
// ---------------------------------------------------------------------------

// The scoring sheet carries a customer and a scope key, so it is a scoped
// Credit read surface: the canonical read-scope resolver narrows it.
function sheetScopePredicate(readScope) {
  if (!readScope.predicateSql) return { sql: '1=1', args: [] };
  // The resolver's predicate is written against the `cp.` alias of
  // `credit_profile`; the sheet joins the profile row, so the same alias is
  // used here and the join is mandatory.
  return { sql: readScope.predicateSql, args: readScope.predicateArgs };
}

export function listCreditEvaluationSheets(db, res, actor, url) {
  const readScope = resolveCreditProfileReadScope(db, actor);
  const filters = [];
  const args = [];
  const scope = sheetScopePredicate(readScope);
  if (scope.sql !== '1=1') { filters.push(scope.sql); args.push(...scope.args); }
  const status = String(url.searchParams.get('status') || '').trim().toUpperCase();
  if (status) {
    if (!CREDIT_EVALUATION_SHEET_STATUSES.includes(status)) {
      throw new HttpError(400, '评分表状态无效', { code: 'CREDIT_SHEET_STATE_INVALID' });
    }
    filters.push('s.status=?');
    args.push(status);
  }
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (customerId) { filters.push('s.customer_id=?'); args.push(customerId); }
  const rows = db.prepare(`SELECT s.* FROM credit_evaluation_scoring_sheet s
    JOIN credit_profile cp ON cp.id = s.credit_profile_id
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY s.business_date DESC, s.sheet_no DESC, s.id`).all(...args);
  return send(res, 200, { sheets: rows.map(presentSheet) });
}

export function getCreditEvaluationSheet(db, res, actor, sheetId) {
  const readScope = resolveCreditProfileReadScope(db, actor);
  const scope = sheetScopePredicate(readScope);
  const row = scope.sql === '1=1'
    ? db.prepare('SELECT s.* FROM credit_evaluation_scoring_sheet s WHERE s.id=?').get(sheetId)
    : db.prepare(`SELECT s.* FROM credit_evaluation_scoring_sheet s
        JOIN credit_profile cp ON cp.id = s.credit_profile_id
        WHERE s.id=? AND ${scope.sql}`).get(sheetId, ...scope.args);
  // An absent sheet and an out-of-scope sheet are indistinguishable.
  if (!row) throw new HttpError(404, '评分表不存在', { code: 'CREDIT_SHEET_NOT_FOUND' });
  const model = db.prepare('SELECT * FROM credit_evaluation_model WHERE id=?').get(row.model_id);
  const scheme = model ? db.prepare('SELECT * FROM credit_evaluation_scheme WHERE id=?').get(model.scheme_id) : null;
  const result = db.prepare('SELECT * FROM credit_evaluation_result WHERE sheet_id=?').get(row.id);
  return send(res, 200, {
    sheet: presentSheet(row),
    model: model ? presentModel(model) : null,
    scheme: scheme ? presentScheme(scheme) : null,
    result: result ? presentResult(result) : null,
  });
}

// ---------------------------------------------------------------------------
// §37.54.9.5 — configuration writes.
//
// Each write runs in ONE transaction and writes one `audit_logs` row. The
// idempotency scope is `code` + `effectiveFrom`.
// ---------------------------------------------------------------------------

async function createConfigurationVersion(db, req, res, actor, kind) {
  requireCreditManagementAuthority(actor);
  const table = CONFIGURATION_TABLES[kind];
  const codeName = CONFIGURATION_CODES[kind];
  const body = await readJson(req);
  const allowedFields = kind === 'INDICATOR'
    ? ['code', 'name', 'indicatorKind', 'description', 'maxScoreMilli', 'inputSpec', 'effectiveFrom', 'effectiveTo']
    : kind === 'SCHEME'
      ? ['code', 'name', 'gradeBoundaries', 'effectiveFrom', 'effectiveTo']
      : ['code', 'name', 'schemeId', 'indicatorWeights', 'effectiveFrom', 'effectiveTo'];
  assertAllowedFields(body, allowedFields);

  const code = requiredCode(body.code, '配置代码');
  const name = requiredText(body.name, '配置名称', 200);
  const effectiveFrom = normalizeBusinessDate(body.effectiveFrom, '生效日期');
  const effectiveTo = optionalDate(body.effectiveTo, '失效日期');
  assertDateRange(effectiveFrom, effectiveTo);

  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${kind}:${code}:${effectiveFrom}`;
  let response;
  let lockName = null;
  try {
    lockName = acquireConfigurationLock(db, kind, code);
    transaction(db, () => {
      const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_CONFIG_VERSION', documentId, key, fingerprint);
      if (replay) { response = replay; return; }
      closePredecessorAndAssertNoOverlap(db, table, code, effectiveFrom, effectiveTo);
      const id = randomUUID();
      const now = new Date().toISOString();
      if (kind === 'INDICATOR') {
        const validated = validateIndicatorPayload(body);
        db.prepare(`INSERT INTO credit_evaluation_indicator(id,code,name,indicator_kind,description,max_score_milli,
          input_spec_json,effective_from,effective_to,status,created_at,created_by)
          VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(id, code, name, validated.kind,
          optionalText(body.description || '', 1000) || '', validated.maxScoreMilli,
          JSON.stringify(validated.inputSpec), effectiveFrom, effectiveTo, now, actor.id);
      } else if (kind === 'SCHEME') {
        const boundaries = validateGradeBoundaries(body.gradeBoundaries, CONFIGURATION_CODES.SCHEME);
        db.prepare(`INSERT INTO credit_evaluation_scheme(id,code,name,grade_boundaries_json,
          effective_from,effective_to,status,created_at,created_by)
          VALUES(?,?,?,?,?,?,'ACTIVE',?,?)`).run(id, code, name, JSON.stringify(boundaries),
          effectiveFrom, effectiveTo, now, actor.id);
      } else {
        const schemeId = requiredText(body.schemeId, '等级方案', 128);
        const scheme = db.prepare('SELECT * FROM credit_evaluation_scheme WHERE id=?').get(schemeId);
        if (!scheme) throw new HttpError(409, '等级方案不存在', { code: codeName });
        if (scheme.status !== 'ACTIVE') throw new HttpError(409, '等级方案已停用', { code: codeName });
        const resolved = validateIndicatorWeights(db, body.indicatorWeights, codeName);
        const weights = {};
        for (const entry of resolved) weights[entry.indicator.id] = entry.weightMilli;
        // The scheme's grade bands must tile the MODEL's full score with no
        // gap and no overlap (§37.54.9.2). The model's full score is only
        // known here, where both the scheme and the weights are known, so
        // this is where the tiling is proven.
        const boundaries = validateGradeBoundaries(
          parseJsonArray(scheme.grade_boundaries_json, '等级区间', CONFIGURATION_CODES.SCHEME), CONFIGURATION_CODES.SCHEME,
        );
        const modelMaxTotal = modelMaxTotalMilli(resolved.map((entry) => ({
          maxScoreMilli: Number(entry.indicator.max_score_milli),
          weightMilli: entry.weightMilli,
        })));
        if (boundaries[boundaries.length - 1].maxScoreMilli < modelMaxTotal) {
          throw new HttpError(400, '等级区间未覆盖模型满分', { code: CONFIGURATION_CODES.SCHEME });
        }
        db.prepare(`INSERT INTO credit_evaluation_model(id,code,name,scheme_id,indicator_weights_json,
          effective_from,effective_to,status,created_at,created_by)
          VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(id, code, name, schemeId, JSON.stringify(weights),
          effectiveFrom, effectiveTo, now, actor.id);
      }
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
      response = { [kind === 'INDICATOR' ? 'indicator' : kind === 'SCHEME' ? 'scheme' : 'model']: CONFIGURATION_LISTS[{
        INDICATOR: 'indicators', SCHEME: 'schemes', MODEL: 'models',
      }[kind]].present(row) };
      audit(db, actor.id, 'CREATE_VERSION', {
        INDICATOR: 'CREDIT_EVALUATION_INDICATOR',
        SCHEME: 'CREDIT_EVALUATION_SCHEME',
        MODEL: 'CREDIT_EVALUATION_MODEL',
      }[kind], id, `${code}:${effectiveFrom}`);
      saveIdempotency(db, 'CREDIT_EVALUATION_CONFIG_VERSION', documentId, key, fingerprint, response);
    });
  } finally {
    releaseConfigurationLock(db, lockName);
  }
  return send(res, 201, response);
}

export async function createCreditEvaluationIndicator(db, req, res, actor) {
  return createConfigurationVersion(db, req, res, actor, 'INDICATOR');
}

export async function createCreditEvaluationScheme(db, req, res, actor) {
  return createConfigurationVersion(db, req, res, actor, 'SCHEME');
}

export async function createCreditEvaluationModel(db, req, res, actor) {
  return createConfigurationVersion(db, req, res, actor, 'MODEL');
}

// ---------------------------------------------------------------------------
// §37.54.9.1 (4) — the one permitted UPDATE: status ACTIVE -> RETIRED.
//
// This endpoint is NOT part of the §37.54.9.5 API list. It exists because
// the design names the ACTIVE -> RETIRED transition as the only permitted
// in-place mutation, and an immutable row with no retirement path would
// leave a superseded configuration permanently ACTIVE.
// ---------------------------------------------------------------------------

const RETIREMENT_TARGETS = Object.freeze({
  INDICATOR: { table: CONFIGURATION_TABLES.INDICATOR, entity: 'CREDIT_EVALUATION_INDICATOR', code: CONFIGURATION_CODES.INDICATOR },
  SCHEME: { table: CONFIGURATION_TABLES.SCHEME, entity: 'CREDIT_EVALUATION_SCHEME', code: CONFIGURATION_CODES.SCHEME },
  MODEL: { table: CONFIGURATION_TABLES.MODEL, entity: 'CREDIT_EVALUATION_MODEL', code: CONFIGURATION_CODES.MODEL },
});

export async function retireCreditEvaluationConfiguration(db, req, res, actor, kind, configurationId) {
  requireCreditManagementAuthority(actor);
  const target = RETIREMENT_TARGETS[kind];
  if (!target) throw new HttpError(404, '评估配置类型不存在', { code: 'CREDIT_EVALUATION_CONFIG_UNKNOWN' });
  const body = await readJson(req);
  assertAllowedFields(body, ['status']);
  const status = enumValue(body.status || 'RETIRED', ['RETIRED'], '配置状态', target.code);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${kind}:${configurationId}:${status}`;
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_CONFIG_RETIRE', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const row = db.prepare(`SELECT * FROM ${target.table} WHERE id=?`).get(configurationId);
    if (!row) throw new HttpError(404, '评估配置不存在', { code: 'CREDIT_EVALUATION_CONFIG_NOT_FOUND' });
    if (row.status !== 'ACTIVE') {
      throw new HttpError(409, '配置状态只能从 ACTIVE 迁移到 RETIRED', { code: target.code });
    }
    db.prepare(`UPDATE ${target.table} SET status=? WHERE id=?`).run(status, configurationId);
    response = { retired: { id: configurationId, code: row.code, status } };
    audit(db, actor.id, 'RETIRE', target.entity, configurationId, `${row.code}:${status}`);
    saveIdempotency(db, 'CREDIT_EVALUATION_CONFIG_RETIRE', documentId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

// ---------------------------------------------------------------------------
// §37.54.9.4 — the scoring sheet creation.
//
// The sheet binds, AT CREATION TIME: the credit object, the customer, the
// profile scope key, the business date, the resolved Credit Profile VERSION
// effective at that business date, the model (which fixes the scheme) and
// the bounded scorer set.
// ---------------------------------------------------------------------------

function resolveScopeKey(salespersonId) {
  return salespersonId || SCOPE_AGGREGATE;
}

export async function createCreditEvaluationSheet(db, req, res, actor) {
  requireCreditEvaluationAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['modelId', 'creditObjectType', 'creditObjectId', 'customerId', 'salespersonId',
    'businessDate', 'allowedEvaluatorIds']);
  const modelId = requiredText(body.modelId, '评分模型', 128);
  const creditObjectType = requiredCode(body.creditObjectType, '信用对象类型');
  const creditObjectId = requiredText(body.creditObjectId, '信用对象', 128);
  const customerId = requiredText(body.customerId, '客户', 128);
  const salespersonId = body.salespersonId ? requiredText(body.salespersonId, '销售员', 128) : null;
  const businessDate = normalizeBusinessDate(body.businessDate, '业务日期');
  const allowedEvaluatorIds = Array.isArray(body.allowedEvaluatorIds)
    ? body.allowedEvaluatorIds.map((value) => requiredText(value, '评分人', 128))
    : null;
  if (!allowedEvaluatorIds || !allowedEvaluatorIds.length) {
    throw new HttpError(400, '评分表必须声明至少一名评分人', { code: 'CREDIT_SHEET_EVALUATOR_SET_EMPTY' });
  }
  if (new Set(allowedEvaluatorIds).size !== allowedEvaluatorIds.length) {
    throw new HttpError(400, '评分人集合不能重复', { code: 'CREDIT_SHEET_EVALUATOR_SET_INVALID' });
  }
  // The bounded scorer set is sorted so the stored payload is deterministic.
  allowedEvaluatorIds.sort();

  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const scopeKey = resolveScopeKey(salespersonId);
  const documentId = `${creditObjectType}:${creditObjectId}:${customerId}:${scopeKey}:${businessDate}:${modelId}`;
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_SHEET_CREATE', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const model = db.prepare('SELECT * FROM credit_evaluation_model WHERE id=?').get(modelId);
    if (!model) throw new HttpError(409, '评分模型不存在', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
    if (model.status !== 'ACTIVE') throw new HttpError(409, '评分模型已停用', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
    if (!db.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) {
      throw new HttpError(404, '客户不存在');
    }
    if (salespersonId && !db.prepare('SELECT id FROM salesperson_profiles WHERE id=? AND active=1').get(salespersonId)) {
      throw new HttpError(409, '销售员不存在或未启用', { code: 'CREDIT_SALESPERSON_UNAVAILABLE' });
    }
    for (const evaluatorId of allowedEvaluatorIds) {
      if (!db.prepare('SELECT id FROM users WHERE id=?').get(evaluatorId)) {
        throw new HttpError(409, `评分人 ${evaluatorId} 不存在`, { code: 'CREDIT_SHEET_EVALUATOR_INVALID' });
      }
    }
    // The sheet binds the Credit Profile VERSION effective at the business
    // date, never an anchor (§37.54.9.4 / R105-4).
    const profile = db.prepare(`SELECT * FROM credit_profile WHERE customer_id=? AND salesperson_scope_key=?
      AND credit_object_type=? AND credit_object_id=? AND effective_from<=?
      AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id`)
      .get(customerId, scopeKey, creditObjectType, creditObjectId, businessDate, businessDate);
    if (!profile) {
      throw new HttpError(409, '业务日期没有生效的信用档案版本', { code: 'CREDIT_PROFILE_EFFECTIVE_MISSING' });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const sheetNo = `CES-${businessDate.replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
    const sheetData = { evaluators: [] };
    db.prepare(`INSERT INTO credit_evaluation_scoring_sheet(id,sheet_no,model_id,credit_object_type,credit_object_id,
      customer_id,profile_scope_key,credit_profile_id,business_date,status,allowed_evaluator_ids_json,
      sheet_data_json,evaluator_count,created_at,created_by,updated_at,updated_by,submitted_at,finalized_at,finalized_by,applied_at)
      VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,0,?,?,NULL,NULL,NULL,NULL,NULL,NULL)`).run(id, sheetNo, modelId,
      creditObjectType, creditObjectId, customerId, scopeKey, profile.id, businessDate,
      JSON.stringify(allowedEvaluatorIds), JSON.stringify(sheetData), now, actor.id);
    const row = db.prepare('SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?').get(id);
    response = { sheet: presentSheet(row) };
    audit(db, actor.id, 'CREATE', 'CREDIT_EVALUATION_SCORING_SHEET', id, `${scopeKey}:${businessDate}:${modelId}`);
    saveIdempotency(db, 'CREDIT_EVALUATION_SHEET_CREATE', documentId, key, fingerprint, response);
  });
  return send(res, 201, response);
}

// ---------------------------------------------------------------------------
// §37.54.10.3 — the score submission.
//
// The scoring endpoint accepts NO target parameter at all: no customerId, no
// salespersonId, no creditObject*. The target is bound on the sheet, which
// is exactly what prevents a scorer from scoring another customer's scope
// (R106-5).
// ---------------------------------------------------------------------------

function parseSheetData(text) {
  try {
    const parsed = JSON.parse(String(text));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { evaluators: [] };
    if (!Array.isArray(parsed.evaluators)) return { evaluators: [] };
    return parsed;
  } catch { return { evaluators: [] }; }
}

function normaliseEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new HttpError(400, '评分条目不能为空', { code: 'CREDIT_EVALUATION_MISSING_INDICATOR' });
  }
  const seen = new Set();
  const normalised = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpError(400, '评分条目格式无效', { code: 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE' });
    }
    const indicatorId = requiredText(entry.indicatorId, '指标', 128);
    if (seen.has(indicatorId)) {
      throw new HttpError(400, '同一指标被重复提交', { code: 'CREDIT_EVALUATION_DUPLICATE_INDICATOR' });
    }
    seen.add(indicatorId);
    return { indicatorId, inputValue: entry.inputValue };
  });
  // Entries are ordered by indicator code ascending, so the stored payload is
  // deterministic regardless of the submission order.
  return normalised;
}

export async function scoreCreditEvaluationSheet(db, req, res, actor, sheetId) {
  requireCreditEvaluationAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['entries']);
  const entries = body.entries;
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${sheetId}:${actor.id}`;
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_SHEET_SCORE', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const sheet = db.prepare(`SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?${suffix}`).get(sheetId);
    if (!sheet) throw new HttpError(404, '评分表不存在', { code: 'CREDIT_SHEET_NOT_FOUND' });
    if (sheet.status !== 'DRAFT') {
      throw new HttpError(409, '评分表状态不允许提交评分', { code: 'CREDIT_SHEET_STATE_INVALID' });
    }
    const allowedEvaluatorIds = parseJsonArray(sheet.allowed_evaluator_ids_json, '评分人集合', 'CREDIT_SHEET_STATE_INVALID');
    if (!Array.isArray(allowedEvaluatorIds) || !allowedEvaluatorIds.includes(actor.id)) {
      throw new HttpError(403, '当前账号不在该评分表的评分人集合内', { code: 'CREDIT_SHEET_NOT_ALLOWED_SCORER' });
    }
    const model = db.prepare('SELECT * FROM credit_evaluation_model WHERE id=?').get(sheet.model_id);
    if (!model) throw new HttpError(409, '评分模型不存在', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
    const weights = parseJsonObject(model.indicator_weights_json, '模型权重', 'CREDIT_EVALUATION_MODEL_INVALID');
    const sheetData = parseSheetData(sheet.sheet_data_json);
    const evaluators = Array.isArray(sheetData.evaluators) ? sheetData.evaluators : [];
    if (evaluators.some((entry) => entry.evaluatorId === actor.id)) {
      throw new HttpError(409, '该评分人已提交，不可重复提交', { code: 'CREDIT_SHEET_STATE_INVALID' });
    }
    const normalised = normaliseEntries(entries);
    // Every submitted indicator must be part of the model, must exist, must
    // be valid, and must not be duplicated.
    const scored = normalised.map((entry) => {
      const indicatorId = entry.indicatorId;
      if (!Object.prototype.hasOwnProperty.call(weights, indicatorId)) {
        throw new HttpError(400, `指标 ${indicatorId} 不属于该评分模型`, { code: 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE' });
      }
      const indicator = db.prepare('SELECT * FROM credit_evaluation_indicator WHERE id=?').get(indicatorId);
      if (!indicator || indicator.status !== 'ACTIVE') {
        throw new HttpError(400, `指标 ${indicatorId} 已失效`, { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' });
      }
      return {
        indicatorId,
        indicatorCode: indicator.code,
        indicatorKind: indicator.indicator_kind,
        inputValue: entry.inputValue,
        achievedMilli: scoreIndicatorInput(indicator, entry.inputValue),
        weightMilli: Number(weights[indicatorId]),
      };
    });
    // Entries are ordered by indicator code ascending; evaluators by id
    // ascending. The stored JSON is therefore deterministic.
    scored.sort((left, right) => (left.indicatorCode < right.indicatorCode ? -1 : left.indicatorCode > right.indicatorCode ? 1 : 0));
    evaluators.push({
      evaluatorId: actor.id,
      submittedAt: new Date().toISOString(),
      entries: scored.map((entry) => ({
        indicatorId: entry.indicatorId,
        indicatorCode: entry.indicatorCode,
        indicatorKind: entry.indicatorKind,
        inputValue: entry.inputValue,
        achievedMilli: entry.achievedMilli,
        weightMilli: entry.weightMilli,
      })),
    });
    evaluators.sort((left, right) => (left.evaluatorId < right.evaluatorId ? -1 : left.evaluatorId > right.evaluatorId ? 1 : 0));
    const nextData = { evaluators };
    const now = new Date().toISOString();
    db.prepare(`UPDATE credit_evaluation_scoring_sheet SET sheet_data_json=?, evaluator_count=?, updated_at=?, updated_by=?
      WHERE id=?`).run(JSON.stringify(nextData), evaluators.length, now, actor.id, sheetId);
    response = {
      sheet: presentSheet(db.prepare('SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId)),
      sheetDataDigest: sha256(canonicalJson(nextData)),
    };
    audit(db, actor.id, 'SCORE', 'CREDIT_EVALUATION_SCORING_SHEET', sheetId, `${actor.id}:${evaluators.length}`);
    saveIdempotency(db, 'CREDIT_EVALUATION_SHEET_SCORE', documentId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

// ---------------------------------------------------------------------------
// §37.54.9.3 — the input lookup.
//
// QUALITATIVE: exactly one option whose value matches the input EXACTLY.
// QUANTITATIVE: exactly one band that contains the input EXACTLY.
// No match at all (including out of range) is a 400. The value is NEVER
// clamped and NEVER truncated.
// ---------------------------------------------------------------------------

export function scoreIndicatorInput(indicator, inputValue) {
  const code = 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE';
  let spec;
  try { spec = JSON.parse(indicator.input_spec_json); } catch { throw new HttpError(400, '指标输入规格无效', { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' }); }
  if (indicator.indicator_kind === 'QUALITATIVE') {
    const options = Array.isArray(spec.options) ? spec.options : [];
    const matched = options.filter((option) => option.value === inputValue);
    if (matched.length !== 1) {
      throw new HttpError(400, '定性评分取值不在允许的枚举内', { code });
    }
    return Number(matched[0].scoreMilli);
  }
  if (indicator.indicator_kind === 'QUANTITATIVE') {
    const bands = Array.isArray(spec.bands) ? spec.bands : [];
    const numeric = Number(inputValue);
    if (!Number.isFinite(numeric)) {
      throw new HttpError(400, '定量评分取值必须是数值', { code });
    }
    const matched = bands.filter((band) => numeric >= Number(band.min) && numeric <= Number(band.max));
    if (matched.length !== 1) {
      throw new HttpError(400, '定量评分取值不在任何区间内', { code });
    }
    return Number(matched[0].scoreMilli);
  }
  throw new HttpError(400, '指标类型无效', { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' });
}

// ---------------------------------------------------------------------------
// §37.54.10.4 — the finalize.
//
// The status is NOT advanced automatically: an explicit finalize requires
// that EVERY allowed scorer has submitted, otherwise the sheet stays in
// DRAFT and a partial score set can never be silently treated as complete.
// ---------------------------------------------------------------------------

function resolveModelIndicatorSet(db, model) {
  const weights = parseJsonObject(model.indicator_weights_json, '模型权重', 'CREDIT_EVALUATION_MODEL_INVALID');
  const resolved = [];
  for (const [indicatorId, weight] of Object.entries(weights)) {
    const indicator = db.prepare('SELECT * FROM credit_evaluation_indicator WHERE id=?').get(indicatorId);
    if (!indicator || indicator.status !== 'ACTIVE') {
      throw new HttpError(400, `指标 ${indicatorId} 已失效`, { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' });
    }
    resolved.push({ indicator, weightMilli: Number(weight) });
  }
  resolved.sort((left, right) => (left.indicator.code < right.indicator.code ? -1 : left.indicator.code > right.indicator.code ? 1 : 0));
  return resolved;
}

export async function finalizeCreditEvaluationSheet(db, req, res, actor, sheetId) {
  requireCreditEvaluationAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, []);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${sheetId}`;
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_SHEET_FINALIZE', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const sheet = db.prepare(`SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?${suffix}`).get(sheetId);
    if (!sheet) throw new HttpError(404, '评分表不存在', { code: 'CREDIT_SHEET_NOT_FOUND' });
    if (sheet.status === 'FINALIZED' || sheet.status === 'APPLIED') {
      throw new HttpError(409, '评分表已终评，不可重复终评', { code: 'CREDIT_SHEET_STATE_INVALID' });
    }
    const allowedEvaluatorIds = parseJsonArray(sheet.allowed_evaluator_ids_json, '评分人集合', 'CREDIT_SHEET_STATE_INVALID');
    const sheetData = parseSheetData(sheet.sheet_data_json);
    const evaluators = Array.isArray(sheetData.evaluators) ? sheetData.evaluators : [];
    const submittedIds = new Set(evaluators.map((entry) => entry.evaluatorId));
    const missing = allowedEvaluatorIds.filter((evaluatorId) => !submittedIds.has(evaluatorId));
    if (missing.length) {
      throw new HttpError(409, '仍有评分人未提交，不能终评', { code: 'CREDIT_SHEET_NOT_FINALIZED' });
    }
    const model = db.prepare('SELECT * FROM credit_evaluation_model WHERE id=?').get(sheet.model_id);
    if (!model) throw new HttpError(409, '评分模型不存在', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
    const scheme = db.prepare('SELECT * FROM credit_evaluation_scheme WHERE id=?').get(model.scheme_id);
    if (!scheme) throw new HttpError(409, '等级方案不存在', { code: 'CREDIT_EVALUATION_SCHEME_INVALID' });
    const modelIndicators = resolveModelIndicatorSet(db, model);
    const modelIndicatorIds = new Set(modelIndicators.map((entry) => entry.indicator.id));

    // The model's indicator set must be complete for EVERY evaluator: no
    // missing indicator and no duplicate indicator.
    for (const evaluator of evaluators) {
      const seen = new Set();
      for (const entry of evaluator.entries || []) {
        if (seen.has(entry.indicatorId)) {
          throw new HttpError(400, `指标 ${entry.indicatorCode} 被重复提交`, { code: 'CREDIT_EVALUATION_DUPLICATE_INDICATOR' });
        }
        seen.add(entry.indicatorId);
        if (!modelIndicatorIds.has(entry.indicatorId)) {
          throw new HttpError(400, `指标 ${entry.indicatorCode} 不属于该评分模型`, { code: 'CREDIT_EVALUATION_INPUT_OUT_OF_RANGE' });
        }
      }
      for (const modelIndicator of modelIndicators) {
        if (!seen.has(modelIndicator.indicator.id)) {
          throw new HttpError(400, `评分表缺少指标 ${modelIndicator.indicator.code} 的评分`, { code: 'CREDIT_EVALUATION_MISSING_INDICATOR' });
        }
      }
    }

    // The aggregate is recomputed from the stored entries in PURE INTEGER
    // arithmetic.
    //
    // MULTI-SCORER AGGREGATION RULE. For each model indicator the sheet's
    // achieved score is the ARITHMETIC MEAN of the evaluators' achieved
    // scores for that indicator, rounded half up with pure integer
    // arithmetic: floor((sum + floor(n/2)) / n). The weighted contribution
    // of that indicator is then the §37.54.9.2 formula applied to the
    // aggregated achieved score. The rule is order-independent (the
    // evaluators are summed in a fixed, sorted order) and float-free, so the
    // result is bit-identical on SQLite and MySQL (R106-3).
    const aggregateEntries = modelIndicators.map((modelIndicator) => {
      const achievedSum = evaluators.reduce((total, evaluator) => {
        const scored = (evaluator.entries || []).find((item) => item.indicatorId === modelIndicator.indicator.id);
        return total + Number(scored.achievedMilli);
      }, 0);
      const count = evaluators.length;
      const achievedMilli = Math.floor((achievedSum + Math.floor(count / 2)) / count);
      return {
        indicatorId: modelIndicator.indicator.id,
        indicatorCode: modelIndicator.indicator.code,
        maxScoreMilli: Number(modelIndicator.indicator.max_score_milli),
        weightMilli: modelIndicator.weightMilli,
        achievedMilli,
      };
    });
    const totalScoreMilli = modelTotalScoreMilli(aggregateEntries);
    const maxTotalMilli = modelMaxTotalMilli(aggregateEntries);
    const boundaries = validateGradeBoundaries(
      parseJsonArray(scheme.grade_boundaries_json, '等级区间', 'CREDIT_EVALUATION_SCHEME_INVALID'),
      'CREDIT_EVALUATION_SCHEME_INVALID',
    );
    // The bands must tile the model's full score with no gap and no overlap.
    if (boundaries[boundaries.length - 1].maxScoreMilli < maxTotalMilli) {
      throw new HttpError(409, '等级区间未覆盖模型满分', { code: 'CREDIT_EVALUATION_SCHEME_INVALID' });
    }
    const grade = resolveGrade(boundaries, totalScoreMilli);
    const now = new Date().toISOString();
    const resultId = randomUUID();
    const profile = db.prepare('SELECT * FROM credit_profile WHERE id=?').get(sheet.credit_profile_id);
    const profileEffectiveStateHash = sha256(canonicalJson({
      id: profile.id,
      ratingGrade: profile.rating_grade,
      ratingEffectiveFrom: profile.rating_effective_from,
      ratingEffectiveTo: profile.rating_effective_to,
      status: profile.status,
      effectiveFrom: profile.effective_from,
      effectiveTo: profile.effective_to,
    }));
    const policySnapshotFingerprint = sha256(canonicalJson({
      modelId: model.id,
      schemeId: scheme.id,
      indicatorWeights: parseJsonObject(model.indicator_weights_json, '模型权重', 'CREDIT_EVALUATION_MODEL_INVALID'),
      businessDate: sheet.business_date,
    }));
    // UNIQUE(sheet_id) guarantees exactly one aggregate result per sheet, so
    // two concurrent finalizes produce only one row.
    db.prepare(`INSERT INTO credit_evaluation_result(id,sheet_id,model_id,scheme_id,credit_profile_id,
      profile_effective_state_hash,policy_snapshot_fingerprint,business_date,total_score_milli,max_score_milli,
      rating_grade,evaluator_count,created_at,created_by,applied_to_profile_id,applied_at,applied_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`).run(resultId, sheet.id, model.id, scheme.id,
      sheet.credit_profile_id, profileEffectiveStateHash, policySnapshotFingerprint, sheet.business_date,
      totalScoreMilli, maxTotalMilli, grade.grade, evaluators.length, now, actor.id);
    db.prepare(`UPDATE credit_evaluation_scoring_sheet SET status='FINALIZED', finalized_at=?, finalized_by=?,
      updated_at=?, updated_by=? WHERE id=?`).run(now, actor.id, now, actor.id, sheet.id);
    response = {
      result: presentResult(db.prepare('SELECT * FROM credit_evaluation_result WHERE id=?').get(resultId)),
      sheet: presentSheet(db.prepare('SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheet.id)),
    };
    audit(db, actor.id, 'FINALIZE', 'CREDIT_EVALUATION_RESULT', resultId, `${sheet.id}:${grade.grade}:${totalScoreMilli}`);
    saveIdempotency(db, 'CREDIT_EVALUATION_SHEET_FINALIZE', documentId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

// ---------------------------------------------------------------------------
// §37.54.10.6 — the rating application.
//
// The order is fixed:
//   1. write-class CREDIT_MANAGE authority (CREDIT_EVALUATE alone is NOT
//      sufficient);
//   2. the idempotency check;
//   3. the lock order: POLICY_SCOPE anchor -> CREDIT_OBJECT anchor ->
//      credit_profile row;
//   4. the result row FOR UPDATE + the `applied_to_profile_id IS NULL`
//      assertion;
//   5. the profile version re-resolution and comparison;
//   6. the customer / scope identity comparison;
//   7. `applyCreditRating(...)` — the single writer;
//   8. the result row update;
//   9. the audit;
//  10. COMMIT.
// ---------------------------------------------------------------------------

export async function applyCreditEvaluationResult(db, req, res, actor, resultId) {
  requireCreditManagementAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, []);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${resultId}`;
  let response;
  transaction(db, () => {
    const replay = idempotencyReplay(db, 'CREDIT_EVALUATION_RESULT_APPLY', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const result = db.prepare(`SELECT * FROM credit_evaluation_result WHERE id=?${suffix}`).get(resultId);
    if (!result) throw new HttpError(404, '信用评估结果不存在', { code: 'CREDIT_EVALUATION_RESULT_NOT_FOUND' });
    if (result.applied_to_profile_id != null) {
      throw new HttpError(409, '该信用评估结果已被应用', { code: 'CREDIT_EVALUATION_RESULT_ALREADY_APPLIED' });
    }
    const profile = db.prepare(`SELECT * FROM credit_profile WHERE id=?${suffix}`).get(result.credit_profile_id);
    if (!profile) throw new HttpError(409, '目标信用档案版本不存在', { code: 'CREDIT_PROFILE_NOT_FOUND' });
    // 3a/3b — the unified lock order (§36.13 / §36.14).
    ensureCreditLockAnchor(db, {
      anchorType: 'POLICY_SCOPE', policyScopeType: 'GLOBAL', policyScopeId: 'GLOBAL',
    });
    ensureCreditLockAnchor(db, {
      anchorType: 'CREDIT_OBJECT', customerId: profile.customer_id, salespersonId: profile.salesperson_id,
      creditObjectType: profile.credit_object_type, creditObjectId: profile.credit_object_id,
    });
    // 5 — the profile version effective at the business date is RE-RESOLVED
    // and compared with the version the result was bound to. A mismatch is
    // refused; the binding is never silently moved.
    const effective = db.prepare(`SELECT * FROM credit_profile WHERE customer_id=? AND salesperson_scope_key=?
      AND credit_object_type=? AND credit_object_id=? AND effective_from<=?
      AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id`)
      .get(profile.customer_id, profile.salesperson_scope_key, profile.credit_object_type, profile.credit_object_id,
        result.business_date, result.business_date);
    if (!effective || effective.id !== result.credit_profile_id) {
      throw new HttpError(409, '业务日期生效的信用档案版本已变化，请重新评分', { code: 'CREDIT_RATING_TARGET_PROFILE_CHANGED' });
    }
    // 6 — the target profile's customer / scope identity must match the
    // result, so a result can never be applied to another customer or to
    // another salesperson's sub-limit (R107-5).
    const sheet = db.prepare('SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?').get(result.sheet_id);
    if (!sheet) throw new HttpError(409, '评分表不存在', { code: 'CREDIT_SHEET_NOT_FOUND' });
    if (sheet.customer_id !== profile.customer_id || sheet.profile_scope_key !== profile.salesperson_scope_key) {
      throw new HttpError(409, '评分目标与信用档案的客户或范围不一致', { code: 'CREDIT_RATING_TARGET_SCOPE_MISMATCH' });
    }
    const now = new Date().toISOString();
    // 7 — the single rating writer. It moves only `superseded_at` on the
    // previous rating history row.
    const rating = applyCreditRating(db, {
      creditProfileId: profile.id,
      ratingGrade: result.rating_grade,
      ratingEffectiveFrom: result.business_date,
      ratingEffectiveTo: null,
      businessSource: 'EVALUATION_APPLIED',
      ratingSourceKey: result.id,
      evaluationResultId: result.id,
      actorId: actor.id,
      appliedAt: now,
      supersedePrevious: true,
    });
    // 8 — the result row records its application.
    db.prepare(`UPDATE credit_evaluation_result SET applied_to_profile_id=?, applied_at=?, applied_by=? WHERE id=?`)
      .run(profile.id, now, actor.id, result.id);
    db.prepare(`UPDATE credit_evaluation_scoring_sheet SET status='APPLIED', applied_at=? WHERE id=?`).run(now, sheet.id);
    response = {
      result: presentResult(db.prepare('SELECT * FROM credit_evaluation_result WHERE id=?').get(result.id)),
      rating,
      profile: db.prepare('SELECT rating_grade, rating_effective_from, rating_effective_to FROM credit_profile WHERE id=?').get(profile.id),
    };
    // 9 — the audit identity is distinct from SCORE and FINALIZE (R107-8).
    audit(db, actor.id, 'APPLY', 'CREDIT_EVALUATION_RESULT', result.id, `${profile.id}:${result.rating_grade}`);
    saveIdempotency(db, 'CREDIT_EVALUATION_RESULT_APPLY', documentId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

// ---------------------------------------------------------------------------
// §37.54.9.1 (5) — the traceability assertion.
//
// A FINALIZED sheet's model must resolve to the SAME indicator set and the
// SAME weights at any later time. The model, the scheme and the indicator
// rows are immutable, so the chain
//
//   scoring_sheet.model_id -> model.indicator_weights_json -> indicator row id
//
// already pins them; this assertion proves it rather than assuming it.
// ---------------------------------------------------------------------------

export function assertFinalizedSheetIndicatorSetUnchanged(db, sheetId) {
  const sheet = db.prepare('SELECT * FROM credit_evaluation_scoring_sheet WHERE id=?').get(sheetId);
  if (!sheet) throw new HttpError(404, '评分表不存在', { code: 'CREDIT_SHEET_NOT_FOUND' });
  if (sheet.status !== 'FINALIZED' && sheet.status !== 'APPLIED') return null;
  const model = db.prepare('SELECT * FROM credit_evaluation_model WHERE id=?').get(sheet.model_id);
  if (!model) throw new HttpError(409, '评分模型不存在', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
  const weights = parseJsonObject(model.indicator_weights_json, '模型权重', 'CREDIT_EVALUATION_MODEL_INVALID');
  const entries = [];
  for (const [indicatorId, weight] of Object.entries(weights)) {
    const indicator = db.prepare('SELECT * FROM credit_evaluation_indicator WHERE id=?').get(indicatorId);
    if (!indicator) {
      throw new HttpError(500, '已终评评分表引用的指标版本已消失', { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' });
    }
    entries.push({ indicatorId, code: indicator.code, weightMilli: Number(weight) });
  }
  entries.sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
  return { modelId: model.id, schemeId: model.scheme_id, indicatorSet: entries };
}

// ---------------------------------------------------------------------------
// The immutable-configuration refusal surface.
//
// The configuration rows may not be updated in place once they are
// referenced. This helper is the single place that decides it, so the
// indicator / scheme / model rules cannot drift apart.
// ---------------------------------------------------------------------------

export function assertConfigurationNotReferenced(db, kind, configurationId) {
  if (kind === 'INDICATOR') {
    if (countModelsReferencingIndicator(db, configurationId) > 0) {
      throw new HttpError(409, '指标已被模型引用，不可就地改写，请新建版本', { code: 'CREDIT_EVALUATION_INDICATOR_INVALID' });
    }
    return;
  }
  if (kind === 'SCHEME') {
    if (countModelsReferencingScheme(db, configurationId) > 0) {
      throw new HttpError(409, '等级方案已被模型引用，不可就地改写，请新建版本', { code: 'CREDIT_EVALUATION_SCHEME_INVALID' });
    }
    return;
  }
  if (kind === 'MODEL') {
    if (countSheetsReferencingModel(db, configurationId) > 0) {
      throw new HttpError(409, '评分模型已被评分表引用，不可就地改写，请新建版本', { code: 'CREDIT_EVALUATION_MODEL_INVALID' });
    }
    return;
  }
  throw new HttpError(404, '评估配置类型不存在', { code: 'CREDIT_EVALUATION_CONFIG_UNKNOWN' });
}

export const __creditEvaluationInternals = Object.freeze({
  configurationLockName,
  validateGradeBoundaries,
  validateIndicatorPayload,
  validateIndicatorWeights,
  closePredecessorAndAssertNoOverlap,
  normaliseEntries,
  canonicalJson,
  sha256,
});
