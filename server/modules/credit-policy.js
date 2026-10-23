import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { assertAllowedFields, HttpError, normalizeBusinessDate, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';
import { assertDateRange, previousDate, translateConstraintError } from './sales-foundation-common.js';
import { ensureCreditLockAnchor } from './credit-anchor.js';
import { requireCreditConfigurationRead, requireCreditManagementAuthority } from './credit-scope.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

const STATUS = ['DRAFT','ACTIVE','INACTIVE'];
const STAGES = ['SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM'];
const SCENARIOS = ['STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK'];
const TIMINGS = ['BEFORE_WRITE','AFTER_WRITE_DEFERRED'];
const STRENGTHS = ['WARNING','BLOCK'];
const HASH = /^[0-9a-f]{64}$/;

function enumValue(value, values, label) {
  const text = requiredCode(value, label);
  if (!values.includes(text)) throw new HttpError(400, `${label}无效`);
  return text;
}

function optionalDate(value, label) {
  return value == null || value === '' ? null : normalizeBusinessDate(value, label);
}

function lockGlobalPolicy(db) {
  return ensureCreditLockAnchor(db, { anchorType: 'POLICY_SCOPE', policyScopeType: 'GLOBAL', policyScopeId: 'GLOBAL' });
}

function closePredecessorAndAssertRange(db, table, keyColumn, key, effectiveFrom, effectiveTo) {
  const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn}=? ORDER BY effective_from,id${suffix}`).all(key);
  if (rows.some((row) => row.effective_from === effectiveFrom)) {
    throw new HttpError(409, '同一业务身份与生效日期已存在版本', { code: 'CREDIT_VERSION_EXISTS' });
  }
  const predecessor = [...rows].reverse().find((row) => row.effective_from < effectiveFrom);
  if (predecessor && (predecessor.effective_to == null || predecessor.effective_to >= effectiveFrom)) {
    db.prepare(`UPDATE ${table} SET effective_to=? WHERE id=?`).run(previousDate(effectiveFrom), predecessor.id);
  }
  const max = effectiveTo || '9999-12-31';
  const conflict = rows.find((row) => row.id !== predecessor?.id
    && row.effective_from <= max && effectiveFrom <= (row.effective_to || '9999-12-31'));
  if (conflict) throw new HttpError(409, '生效期间与现有版本重叠', { code: 'CREDIT_EFFECTIVE_RANGE_OVERLAP' });
}

function typedParameter(body) {
  const provided = ['valueText','valueInt','valueBool','valueDate'].filter((name) => body[name] !== undefined && body[name] !== null && body[name] !== '');
  if (provided.length !== 1) throw new HttpError(400, '信用参数必须且只能提供一种值');
  let valueText = null; let valueInt = null; let valueBool = null; let valueDate = null;
  if (provided[0] === 'valueText') valueText = requiredText(body.valueText, '参数值', 1000);
  if (provided[0] === 'valueInt') {
    valueInt = Number(body.valueInt);
    if (!Number.isSafeInteger(valueInt)) throw new HttpError(400, '整数参数值必须为安全整数');
  }
  if (provided[0] === 'valueBool') {
    if (![true,false,0,1].includes(body.valueBool)) throw new HttpError(400, '布尔参数值无效');
    valueBool = body.valueBool ? 1 : 0;
  }
  if (provided[0] === 'valueDate') valueDate = normalizeBusinessDate(body.valueDate, '参数日期');
  return { valueText, valueInt, valueBool, valueDate };
}

function presentParameter(row) {
  return {
    id: row.id, code: row.code, valueText: row.value_text, valueInt: row.value_int,
    valueBool: row.value_bool == null ? null : Boolean(row.value_bool), valueDate: row.value_date,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, status: row.status,
    supersededById: row.superseded_by_id, createdAt: row.created_at, createdBy: row.created_by,
  };
}

function presentRule(row) {
  return {
    id: row.id, ruleCode: row.rule_code, businessStage: row.business_stage, scenario: row.scenario,
    checkTiming: row.check_timing, controlStrength: row.control_strength, creditItem: row.credit_item,
    recognitionMode: row.recognition_mode, effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
    status: row.status, resultPayload: JSON.parse(row.result_payload_json), createdAt: row.created_at, createdBy: row.created_by,
  };
}

function effectiveRows(db, table, codeColumn, code, date) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${codeColumn}=? AND status='ACTIVE' AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id`).all(code, date, date);
  if (rows.length > 1) throw new HttpError(409, '信用策略生效版本不唯一', { code: 'CREDIT_EFFECTIVE_VERSION_AMBIGUOUS' });
  return rows;
}

export function resolveCreditParameter(db, code, businessDate) {
  return effectiveRows(db, 'credit_parameters', 'code', requiredCode(code, '参数代码'), normalizeBusinessDate(businessDate))[0] || null;
}

export function resolveCreditRule(db, ruleCode, businessDate) {
  return effectiveRows(db, 'credit_check_rules', 'rule_code', requiredCode(ruleCode, '规则代码'), normalizeBusinessDate(businessDate))[0] || null;
}

export function listCreditParameters(db, res, actor, url) {
  requireCreditConfigurationRead(actor);
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
  const date = String(url.searchParams.get('businessDate') || '').trim();
  let rows;
  if (date && code) rows = effectiveRows(db, 'credit_parameters', 'code', code, normalizeBusinessDate(date));
  else rows = db.prepare(`SELECT * FROM credit_parameters${code ? ' WHERE code=?' : ''} ORDER BY code,effective_from DESC,id`).all(...(code ? [code] : []));
  return send(res, 200, { parameters: rows.map(presentParameter) });
}

export async function createCreditParameter(db, req, res, actor) {
  requireCreditManagementAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['code','valueText','valueInt','valueBool','valueDate','effectiveFrom','effectiveTo','status']);
  const code = requiredCode(body.code, '参数代码');
  const effectiveFrom = normalizeBusinessDate(body.effectiveFrom, '生效日期');
  const effectiveTo = optionalDate(body.effectiveTo, '失效日期');
  assertDateRange(effectiveFrom, effectiveTo);
  const status = enumValue(body.status || 'ACTIVE', STATUS, '状态');
  const value = typedParameter(body);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  let response;
  try {
    transaction(db, () => {
      const replay = idempotencyReplay(db, 'CREDIT_PARAMETER_CREATE', code, key, fingerprint);
      if (replay) { response = replay; return; }
      lockGlobalPolicy(db);
      closePredecessorAndAssertRange(db, 'credit_parameters', 'code', code, effectiveFrom, effectiveTo);
      const parameterId = randomUUID();
      db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,effective_to,status,created_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(parameterId, code, value.valueText, value.valueInt, value.valueBool, value.valueDate,
          effectiveFrom, effectiveTo, status, new Date().toISOString(), actor.id);
      const predecessor = db.prepare('SELECT id FROM credit_parameters WHERE code=? AND id<>? AND effective_to=? ORDER BY effective_from DESC LIMIT 1')
        .get(code, parameterId, previousDate(effectiveFrom));
      if (predecessor) db.prepare('UPDATE credit_parameters SET superseded_by_id=? WHERE id=?').run(parameterId, predecessor.id);
      response = { parameter: presentParameter(db.prepare('SELECT * FROM credit_parameters WHERE id=?').get(parameterId)) };
      audit(db, actor.id, 'CREATE_VERSION', 'CREDIT_PARAMETER', parameterId, `${code}:${effectiveFrom}`);
      saveIdempotency(db, 'CREDIT_PARAMETER_CREATE', code, key, fingerprint, response);
    });
  } catch (error) { translateConstraintError(error, '信用参数版本冲突'); }
  return send(res, 201, response);
}

export function listCreditRules(db, res, actor, url) {
  requireCreditConfigurationRead(actor);
  const code = String(url.searchParams.get('ruleCode') || '').trim().toUpperCase();
  const date = String(url.searchParams.get('businessDate') || '').trim();
  let rows;
  if (date && code) rows = effectiveRows(db, 'credit_check_rules', 'rule_code', code, normalizeBusinessDate(date));
  else rows = db.prepare(`SELECT * FROM credit_check_rules${code ? ' WHERE rule_code=?' : ''} ORDER BY rule_code,effective_from DESC,id`).all(...(code ? [code] : []));
  return send(res, 200, { rules: rows.map(presentRule) });
}

export async function createCreditRule(db, req, res, actor) {
  requireCreditManagementAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['ruleCode','businessStage','scenario','checkTiming','controlStrength','creditItem','recognitionMode','effectiveFrom','effectiveTo','status','resultPayload']);
  const value = {
    ruleCode: requiredCode(body.ruleCode, '规则代码'),
    businessStage: enumValue(body.businessStage, STAGES, '业务阶段'),
    scenario: enumValue(body.scenario, SCENARIOS, '场景'),
    checkTiming: enumValue(body.checkTiming, TIMINGS, '检查时点'),
    controlStrength: enumValue(body.controlStrength, STRENGTHS, '控制强度'),
    creditItem: requiredCode(body.creditItem, '信用项目'),
    recognitionMode: body.recognitionMode ? requiredCode(body.recognitionMode, '确认模式') : null,
    effectiveFrom: normalizeBusinessDate(body.effectiveFrom, '生效日期'),
    effectiveTo: optionalDate(body.effectiveTo, '失效日期'),
    status: enumValue(body.status || 'ACTIVE', STATUS, '状态'),
  };
  assertDateRange(value.effectiveFrom, value.effectiveTo);
  const resultPayload = body.resultPayload && typeof body.resultPayload === 'object' && !Array.isArray(body.resultPayload) ? body.resultPayload : {};
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  let response;
  try {
    transaction(db, () => {
      const replay = idempotencyReplay(db, 'CREDIT_RULE_CREATE', value.ruleCode, key, fingerprint);
      if (replay) { response = replay; return; }
      lockGlobalPolicy(db);
      closePredecessorAndAssertRange(db, 'credit_check_rules', 'rule_code', value.ruleCode, value.effectiveFrom, value.effectiveTo);
      const ruleId = randomUUID();
      db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
        recognition_mode,effective_from,effective_to,status,result_payload_json,created_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ruleId, value.ruleCode, value.businessStage, value.scenario, value.checkTiming,
          value.controlStrength, value.creditItem, value.recognitionMode, value.effectiveFrom, value.effectiveTo, value.status,
          JSON.stringify(resultPayload), new Date().toISOString(), actor.id);
      response = { rule: presentRule(db.prepare('SELECT * FROM credit_check_rules WHERE id=?').get(ruleId)) };
      audit(db, actor.id, 'CREATE_VERSION', 'CREDIT_CHECK_RULE', ruleId, `${value.ruleCode}:${value.effectiveFrom}`);
      saveIdempotency(db, 'CREDIT_RULE_CREATE', value.ruleCode, key, fingerprint, response);
    });
  } catch (error) { translateConstraintError(error, '信用检查规则版本冲突'); }
  return send(res, 201, response);
}

export function ensureCreditPolicySnapshot(db, input) {
  const hashes = [input.parameterSetHash, input.ruleSetHash, input.profileEffectiveStateHash];
  if (!hashes.every((value) => HASH.test(String(value || '')))) throw new HttpError(400, '策略快照哈希必须为 64 位小写十六进制');
  const canonical = hashes.map((value) => `${value.length}:${value}`).join('');
  const fingerprint = `CSP1:${createHash('sha256').update(canonical).digest('hex')}`;
  const businessDate = normalizeBusinessDate(input.businessDate);
  const scopeType = enumValue(input.scopeType, ['CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT'], '信用范围');
  let row = db.prepare(`SELECT * FROM credit_policy_snapshots WHERE credit_lock_anchor_id=? AND business_date=? AND snapshot_fingerprint=?`)
    .get(input.creditLockAnchorId, businessDate, fingerprint);
  if (row) return row;
  try {
    db.prepare(`INSERT INTO credit_policy_snapshots(id,credit_lock_anchor_id,scope_type,credit_profile_id,snapshot_fingerprint,
      business_date,parameter_set_hash,rule_set_hash,profile_effective_state_hash,captured_at,captured_by,notes_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.creditLockAnchorId, scopeType, input.creditProfileId || null,
      fingerprint, businessDate, ...hashes, new Date().toISOString(), input.capturedBy || null,
      input.notes == null ? null : JSON.stringify(input.notes));
  } catch (error) {
    if (!/UNIQUE|duplicate/i.test(String(error?.message || ''))) throw error;
  }
  row = db.prepare(`SELECT * FROM credit_policy_snapshots WHERE credit_lock_anchor_id=? AND business_date=? AND snapshot_fingerprint=?`)
    .get(input.creditLockAnchorId, businessDate, fingerprint);
  if (!row) throw new HttpError(500, '信用策略快照无法解析', { code: 'CREDIT_POLICY_SNAPSHOT_UNRESOLVABLE' });
  return row;
}
