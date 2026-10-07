// V17 Master & Engineering Domain Closure — Wave C: Substitute Scheme.
//
// Owner of /api/engineering/substitute-schemes + /api/engineering/substitutes.
// Provides a deterministic resolver (findSubstitutesForPrimary) and a
// preview-only validator. Does NOT consume substitutes in MRP — that
// belongs to the Planning Domain; we only expose a stable contract.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';

const STRATEGIES = new Set(['MIXED', 'MANUAL', 'BATCH', 'BATCH_MIXED']);
const METHODS = new Set(['REPLACE', 'SUPERSEDE', 'PROPORTION']);

function normalizeStrategy(value) {
  const upper = String(value || 'MIXED').toUpperCase();
  if (!STRATEGIES.has(upper)) throw new HttpError(400, '替代策略不正确');
  return upper;
}

function normalizeMethod(value) {
  const upper = String(value || 'REPLACE').toUpperCase();
  if (!METHODS.has(upper)) throw new HttpError(400, '替代方式不正确');
  return upper;
}

function validateDateRange(from, to) {
  if (from && to && from > to) throw new HttpError(400, '生效日期必须早于失效日期');
}

export function listSubstituteSchemes(db, res, actor) {
  allowAny(actor, ['ENGINEERING_SUBSTITUTE_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const schemes = db.prepare('SELECT * FROM engineering_substitute_schemes ORDER BY code').all();
  return send(res, 200, { schemes });
}

export async function createSubstituteScheme(db, req, res, actor) {
  allow(actor, 'ENGINEERING_SUBSTITUTE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '替代方案编码');
  const name = requiredText(body.name, '替代方案名称', 100);
  const strategy = normalizeStrategy(body.strategy);
  const method = normalizeMethod(body.method);
  const schemeId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_substitute_schemes(id,code,name,strategy,method,active,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(schemeId, code, name, strategy, method, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_SUBSTITUTE_SCHEME', schemeId, code);
  });
  return send(res, 201, { id: schemeId });
}

export function listSubstitutes(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_SUBSTITUTE_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const schemeId = url.searchParams.get('scheme_id');
  const where = ['1=1'];
  const params = [];
  if (schemeId) { where.push('s.scheme_id=?'); params.push(schemeId); }
  const sql = `SELECT s.*, sc.code scheme_code, sc.name scheme_name,
      primary_p.code primary_product_code, primary_p.name primary_product_name,
      substitute_p.code substitute_product_code, substitute_p.name substitute_product_name
    FROM engineering_substitutes s
    JOIN engineering_substitute_schemes sc ON sc.id=s.scheme_id
    JOIN products primary_p ON primary_p.id=s.primary_product_id
    JOIN products substitute_p ON substitute_p.id=s.substitute_product_id
    WHERE ${where.join(' AND ')}
    ORDER BY sc.code, s.priority`;
  return send(res, 200, { substitutes: db.prepare(sql).all(...params) });
}

export async function createSubstitute(db, req, res, actor) {
  allow(actor, 'ENGINEERING_SUBSTITUTE_MANAGE');
  const body = await readJson(req);
  const schemeId = body.schemeId ?? body.scheme_id;
  if (!schemeId) throw new HttpError(400, '缺少 scheme_id');
  const scheme = db.prepare('SELECT * FROM engineering_substitute_schemes WHERE id=?').get(schemeId);
  if (!scheme) throw new HttpError(404, '替代方案不存在');
  const primaryProductId = body.primaryProductId ?? body.primary_product_id;
  const substituteProductId = body.substituteProductId ?? body.substitute_product_id;
  if (!primaryProductId || !substituteProductId) throw new HttpError(400, '缺少主料 / 替代料');
  if (primaryProductId === substituteProductId) throw new HttpError(400, '主料与替代料不能相同');
  const primary = db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(primaryProductId);
  if (!primary) throw new HttpError(400, '主料不存在或已停用');
  const substitute = db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(substituteProductId);
  if (!substitute) throw new HttpError(400, '替代料不存在或已停用');
  const priority = Math.round(Number(body.priority ?? 1));
  if (!Number.isInteger(priority) || priority <= 0) throw new HttpError(400, '优先级必须为正整数');
  const ratio = Number(body.ratio ?? 1);
  if (!Number.isFinite(ratio) || ratio <= 0) throw new HttpError(400, '替代比例必须为正数');
  if (scheme.method === 'PROPORTION' && ratio === 0) throw new HttpError(400, '按比例替代方式必须设置比例');
  const effectiveFrom = optionalText(body.effectiveFrom ?? body.effective_from, 10) || null;
  const effectiveTo = optionalText(body.effectiveTo ?? body.effective_to, 10) || null;
  validateDateRange(effectiveFrom, effectiveTo);
  const dup = db.prepare('SELECT 1 FROM engineering_substitutes WHERE scheme_id=? AND priority=?').get(schemeId, priority);
  if (dup) throw new HttpError(409, '该方案中已存在相同优先级的替代关系');
  const subId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_substitutes(id,scheme_id,primary_product_id,substitute_product_id,priority,ratio,effective_from,effective_to,active,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(subId, schemeId, primaryProductId, substituteProductId, priority, ratio,
      effectiveFrom, effectiveTo, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_SUBSTITUTE', subId, `${priority}`);
  });
  return send(res, 201, { id: subId });
}

export async function deleteSubstitute(db, res, actor, subId) {
  allow(actor, 'ENGINEERING_SUBSTITUTE_MANAGE');
  const sub = db.prepare('SELECT * FROM engineering_substitutes WHERE id=?').get(subId);
  if (!sub) throw new HttpError(404, '替代关系不存在');
  transaction(db, () => {
    db.prepare('DELETE FROM engineering_substitutes WHERE id=?').run(subId);
    audit(db, actor.id, 'DELETE', 'ENGINEERING_SUBSTITUTE', subId, '');
  });
  return send(res, 200, { ok: true });
}

export function resolveSubstitutesForPrimary(db, res, url) {
  const primaryProductId = url.searchParams.get('product_id');
  const businessDate = url.searchParams.get('business_date') || new Date().toISOString().slice(0, 10);
  if (!primaryProductId) throw new HttpError(400, '缺少 product_id');
  const results = db.prepare(`SELECT s.*, sc.code scheme_code, sc.strategy, sc.method,
    substitute_p.code substitute_product_code, substitute_p.name substitute_product_name
    FROM engineering_substitutes s
    JOIN engineering_substitute_schemes sc ON sc.id=s.scheme_id
    JOIN products substitute_p ON substitute_p.id=s.substitute_product_id
    WHERE s.primary_product_id=? AND s.active=1 AND sc.active=1
      AND (s.effective_from IS NULL OR s.effective_from <= ?)
      AND (s.effective_to IS NULL OR s.effective_to >= ?)
    ORDER BY s.priority ASC`).all(primaryProductId, businessDate, businessDate);
  return send(res, 200, { product_id: primaryProductId, business_date: businessDate, substitutes: results });
}