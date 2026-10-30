import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { assertAllowedFields, HttpError, normalizeBusinessDate, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';
import { foldSearchText } from '../lib/search-fold.js';
import { assertDateRange, previousDate, translateConstraintError } from './sales-foundation-common.js';
import { ensureCreditLockAnchor } from './credit-anchor.js';
import { requireCreditManagementAuthority, resolveCreditProfileReadScope } from './credit-scope.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

const PROFILE_STATUS = ['ACTIVE','SUSPENDED','CLOSED'];

function optionalDate(value, label) { return value == null || value === '' ? null : normalizeBusinessDate(value, label); }
function enumValue(value, values, label) {
  const text = requiredCode(value, label);
  if (!values.includes(text)) throw new HttpError(400, `${label}无效`);
  return text;
}

function presentRating(row) {
  return row && {
    id: row.id, creditProfileId: row.credit_profile_id, ratingSourceType: row.rating_source_type,
    ratingSourceKey: row.rating_source_key, evaluationResultId: row.evaluation_result_id,
    ratingGrade: row.rating_grade, appliedAt: row.applied_at, appliedBy: row.applied_by,
    supersededAt: row.superseded_at,
  };
}

function present(row, ratings = undefined) {
  return {
    id: row.id, anchorId: row.anchor_id, customerId: row.customer_id,
    salespersonScopeKey: row.salesperson_scope_key, salespersonId: row.salesperson_id,
    scopeType: row.salesperson_id ? 'SALESPERSON_SUB_LIMIT' : 'CUSTOMER_AGGREGATE',
    creditObjectType: row.credit_object_type, creditObjectId: row.credit_object_id,
    creditLimitCents: row.credit_limit_cents, unlimited: row.credit_limit_cents == null,
    initialState: row.initial_state, status: row.status, ratingGrade: row.rating_grade,
    ratingEffectiveFrom: row.rating_effective_from, ratingEffectiveTo: row.rating_effective_to,
    overdueDayPolicy: row.overdue_day_policy, ruleId: row.rule_id,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
    createdAt: row.created_at, createdBy: row.created_by,
    ...(ratings === undefined ? {} : { ratings: ratings.map(presentRating) }),
  };
}

export function resolveEffectiveCreditProfile(db, { customerId, salespersonId = null, creditObjectType, creditObjectId, businessDate }) {
  const scopeKey = salespersonId || '*';
  const date = normalizeBusinessDate(businessDate);
  const rows = db.prepare(`SELECT * FROM credit_profile WHERE customer_id=? AND salesperson_scope_key=?
    AND credit_object_type=? AND credit_object_id=? AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id`)
    .all(customerId, scopeKey, requiredCode(creditObjectType, '信用对象类型'), creditObjectId, date, date);
  if (rows.length > 1) throw new HttpError(409, '信用档案生效版本不唯一', { code: 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS' });
  return rows[0] || null;
}

export function listCreditProfiles(db, res, actor, url) {
  const date = String(url.searchParams.get('businessDate') || '').trim();
  const businessDate = date ? normalizeBusinessDate(date) : null;
  const readScope = resolveCreditProfileReadScope(db, actor, { businessDate });
  const filters = [];
  const args = [];
  for (const [query, column] of [['customerId','customer_id'],['salespersonId','salesperson_id'],['creditObjectType','credit_object_type'],['creditObjectId','credit_object_id']]) {
    const value = String(url.searchParams.get(query) || '').trim();
    if (value) { filters.push(`${column}=?`); args.push(query === 'creditObjectType' ? value.toUpperCase() : value); }
  }
  if (businessDate) {
    filters.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)');
    args.push(businessDate, businessDate);
  }
  if (readScope.predicateSql) {
    filters.push(readScope.predicateSql);
    args.push(...readScope.predicateArgs);
  }
  const rows = db.prepare(`SELECT cp.* FROM credit_profile cp${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY cp.customer_id,cp.salesperson_scope_key,cp.credit_object_type,cp.credit_object_id,cp.effective_from DESC,cp.id`).all(...args);
  return send(res, 200, { profiles: rows.map((row) => present(row)) });
}

export function getCreditProfile(db, res, actor, profileId) {
  const readScope = resolveCreditProfileReadScope(db, actor);
  const row = readScope.predicateSql
    ? db.prepare(`SELECT * FROM credit_profile cp WHERE cp.id=? AND ${readScope.predicateSql}`).get(profileId, ...readScope.predicateArgs)
    : db.prepare('SELECT * FROM credit_profile WHERE id=?').get(profileId);
  // Absent and out-of-scope rows are indistinguishable, so the endpoint cannot
  // be used to enumerate profile ids.
  if (!row) throw new HttpError(404, '信用档案不存在', { code: 'CREDIT_PROFILE_NOT_FOUND' });
  const ratings = db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=? ORDER BY applied_at,id').all(profileId);
  return send(res, 200, { profile: present(row, ratings) });
}

function normalizeInput(body) {
  const customerId = requiredText(body.customerId, '客户', 128);
  const salespersonId = body.salespersonId ? requiredText(body.salespersonId, '销售员', 128) : null;
  const creditObjectType = requiredCode(body.creditObjectType, '信用对象类型');
  const creditObjectId = requiredText(body.creditObjectId, '信用对象', 128);
  const effectiveFrom = normalizeBusinessDate(body.effectiveFrom, '生效日期');
  const effectiveTo = optionalDate(body.effectiveTo, '失效日期');
  assertDateRange(effectiveFrom, effectiveTo);
  let creditLimitCents = null;
  if (body.creditLimitCents !== undefined && body.creditLimitCents !== null && body.creditLimitCents !== '') {
    creditLimitCents = Number(body.creditLimitCents);
    if (!Number.isSafeInteger(creditLimitCents) || creditLimitCents < 0) throw new HttpError(400, '信用额度必须为非负安全整数分，留空表示不设上限');
  }
  return {
    customerId, salespersonId, salespersonScopeKey: salespersonId || '*', creditObjectType, creditObjectId,
    creditLimitCents, initialState: requiredCode(body.initialState, '初始状态'),
    status: enumValue(body.status || 'ACTIVE', PROFILE_STATUS, '档案状态'),
    ratingGrade: requiredText(body.ratingGrade, '初始评级', 50),
    ratingEffectiveFrom: optionalDate(body.ratingEffectiveFrom, '评级生效日期') || effectiveFrom,
    ratingEffectiveTo: optionalDate(body.ratingEffectiveTo, '评级失效日期'),
    overdueDayPolicy: optionalText(body.overdueDayPolicy || '', 500) || null,
    ruleId: body.ruleId ? requiredText(body.ruleId, '适用规则', 128) : null,
    effectiveFrom, effectiveTo,
  };
}

function assertReferences(db, value) {
  if (!db.prepare('SELECT id FROM customers WHERE id=?').get(value.customerId)) throw new HttpError(404, '客户不存在');
  if (value.salespersonId && !db.prepare('SELECT id FROM salesperson_profiles WHERE id=? AND active=1').get(value.salespersonId)) {
    throw new HttpError(409, '销售员不存在或未启用', { code: 'CREDIT_SALESPERSON_UNAVAILABLE' });
  }
  if (value.ruleId && !db.prepare('SELECT id FROM credit_check_rules WHERE id=?').get(value.ruleId)) throw new HttpError(409, '适用信用规则不存在');
}

function closePredecessorAndAssertNoOverlap(db, anchorId, effectiveFrom, effectiveTo) {
  const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const rows = db.prepare(`SELECT * FROM credit_profile WHERE anchor_id=? ORDER BY effective_from,id${suffix}`).all(anchorId);
  if (rows.some((row) => row.effective_from === effectiveFrom)) throw new HttpError(409, '该范围同一生效日期已存在档案版本', { code: 'CREDIT_PROFILE_VERSION_EXISTS' });
  const predecessor = [...rows].reverse().find((row) => row.effective_from < effectiveFrom);
  if (predecessor && (predecessor.effective_to == null || predecessor.effective_to >= effectiveFrom)) {
    db.prepare('UPDATE credit_profile SET effective_to=? WHERE id=?').run(previousDate(effectiveFrom), predecessor.id);
  }
  const max = effectiveTo || '9999-12-31';
  if (rows.some((row) => row.id !== predecessor?.id && row.effective_from <= max && effectiveFrom <= (row.effective_to || '9999-12-31'))) {
    throw new HttpError(409, '信用档案生效期间与现有版本重叠', { code: 'CREDIT_PROFILE_EFFECTIVE_OVERLAP' });
  }
}

export async function createCreditProfile(db, req, res, actor) {
  requireCreditManagementAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['customerId','salespersonId','creditObjectType','creditObjectId','creditLimitCents','initialState','status','ratingGrade','ratingEffectiveFrom','ratingEffectiveTo','overdueDayPolicy','ruleId','effectiveFrom','effectiveTo']);
  const value = normalizeInput(body);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  const documentId = `${value.creditObjectType}:${value.creditObjectId}:${value.customerId}:${value.salespersonScopeKey}`;
  let response;
  try {
    transaction(db, () => {
      const replay = idempotencyReplay(db, 'CREDIT_PROFILE_CREATE', documentId, key, fingerprint);
      if (replay) { response = replay; return; }
      assertReferences(db, value);
      const anchor = ensureCreditLockAnchor(db, {
        anchorType: 'CREDIT_OBJECT', customerId: value.customerId, salespersonId: value.salespersonId,
        creditObjectType: value.creditObjectType, creditObjectId: value.creditObjectId,
      });
      closePredecessorAndAssertNoOverlap(db, anchor.id, value.effectiveFrom, value.effectiveTo);
      const profileId = randomUUID();
      const ratingId = randomUUID();
      const now = new Date().toISOString();
      // W11-A U3 — the derived Credit Object search keys are written in the
      // same statement, so a new Profile version is searchable at once. The
      // predecessor closure above never touches these fields.
      db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,
        credit_object_id,credit_object_type_search_key,credit_object_id_search_key,
        credit_limit_cents,initial_state,status,rating_grade,rating_effective_from,rating_effective_to,
        overdue_day_policy,rule_id,effective_from,effective_to,created_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(profileId, anchor.id, value.customerId, value.salespersonScopeKey,
        value.salespersonId, value.creditObjectType, value.creditObjectId,
        foldSearchText(value.creditObjectType), foldSearchText(value.creditObjectId),
        value.creditLimitCents, value.initialState,
        value.status, value.ratingGrade, value.ratingEffectiveFrom, value.ratingEffectiveTo, value.overdueDayPolicy,
        value.ruleId, value.effectiveFrom, value.effectiveTo, now, actor.id);
      db.prepare(`INSERT INTO credit_profile_ratings(id,credit_profile_id,rating_source_type,rating_source_key,
        evaluation_result_id,rating_grade,applied_at,applied_by,superseded_at)
        VALUES(?,?,'INITIAL_ASSIGNED','INITIAL_ASSIGNED',NULL,?,?,?,NULL)`)
        .run(ratingId, profileId, value.ratingGrade, now, actor.id);
      const ratings = db.prepare('SELECT * FROM credit_profile_ratings WHERE credit_profile_id=? ORDER BY applied_at,id').all(profileId);
      response = { profile: present(db.prepare('SELECT * FROM credit_profile WHERE id=?').get(profileId), ratings) };
      audit(db, actor.id, 'CREATE_VERSION', 'CREDIT_PROFILE', profileId, `${anchor.anchor_key}:${value.effectiveFrom}`);
      audit(db, actor.id, 'INITIAL_ASSIGNED', 'CREDIT_PROFILE_RATING', ratingId, `${profileId}:${value.ratingGrade}`);
      saveIdempotency(db, 'CREDIT_PROFILE_CREATE', documentId, key, fingerprint, response);
    });
  } catch (error) { translateConstraintError(error, '信用档案版本或初始评级冲突'); }
  return send(res, 201, response);
}

export { presentRating as presentCreditProfileRating };
