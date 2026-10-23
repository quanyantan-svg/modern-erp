import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { assertAllowedFields, HttpError, readJson, requiredCode, requiredText, send } from '../lib/http.js';
import { actorHas } from './sales-scope.js';
import { requireCreditManagementAuthority } from './credit-scope.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

function cleanId(value, label) {
  const text = requiredText(value, label, 128);
  if (text.includes('|')) throw new HttpError(400, `${label}不能包含竖线`);
  return text;
}

export function creditObjectAnchorKey({ customerId, salespersonId = null, creditObjectType, creditObjectId }) {
  const customer = cleanId(customerId, '客户');
  const objectType = requiredCode(creditObjectType, '信用对象类型');
  const objectId = cleanId(creditObjectId, '信用对象');
  const scope = salespersonId
    ? `SCOPE:SALESPERSON|${cleanId(salespersonId, '销售员')}`
    : 'SCOPE:AGGREGATE';
  return `CREDIT_OBJECT|${objectType}|${objectId}|CUSTOMER|${customer}|${scope}`;
}

export function policyScopeAnchorKey(scopeType = 'GLOBAL', scopeId = 'GLOBAL') {
  return `POLICY_SCOPE|${requiredCode(scopeType, '策略范围类型')}|${cleanId(scopeId, '策略范围')}`;
}

function normalizeShape(shape) {
  const anchorType = requiredCode(shape.anchorType, '锚点类型');
  if (anchorType === 'CREDIT_OBJECT') {
    const customerId = cleanId(shape.customerId, '客户');
    const salespersonId = shape.salespersonId ? cleanId(shape.salespersonId, '销售员') : null;
    const creditObjectType = requiredCode(shape.creditObjectType, '信用对象类型');
    const creditObjectId = cleanId(shape.creditObjectId, '信用对象');
    return {
      anchorType, customerId, salespersonId, creditObjectType, creditObjectId,
      policyScopeType: null, policyScopeId: null,
      anchorKey: creditObjectAnchorKey({ customerId, salespersonId, creditObjectType, creditObjectId }),
    };
  }
  if (anchorType === 'POLICY_SCOPE') {
    const policyScopeType = requiredCode(shape.policyScopeType || 'GLOBAL', '策略范围类型');
    const policyScopeId = cleanId(shape.policyScopeId || 'GLOBAL', '策略范围');
    return {
      anchorType, customerId: null, salespersonId: null, creditObjectType: null, creditObjectId: null,
      policyScopeType, policyScopeId, anchorKey: policyScopeAnchorKey(policyScopeType, policyScopeId),
    };
  }
  throw new HttpError(400, '锚点类型仅支持 CREDIT_OBJECT 或 POLICY_SCOPE');
}

function validateReferences(db, shape) {
  if (shape.customerId && !db.prepare('SELECT id FROM customers WHERE id=?').get(shape.customerId)) {
    throw new HttpError(404, '客户不存在');
  }
  if (shape.salespersonId && !db.prepare('SELECT id FROM salesperson_profiles WHERE id=? AND active=1').get(shape.salespersonId)) {
    throw new HttpError(409, '销售员不存在或未启用', { code: 'CREDIT_SALESPERSON_UNAVAILABLE' });
  }
}

function sameShape(row, shape) {
  return row.anchor_type === shape.anchorType
    && row.customer_id === shape.customerId
    && row.salesperson_id === shape.salespersonId
    && row.credit_object_type === shape.creditObjectType
    && row.credit_object_id === shape.creditObjectId
    && row.policy_scope_type === shape.policyScopeType
    && row.policy_scope_id === shape.policyScopeId;
}

export function ensureCreditLockAnchor(db, rawShape) {
  const shape = normalizeShape(rawShape);
  validateReferences(db, shape);
  const anchorId = randomUUID();
  try {
    db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,
      credit_object_type,credit_object_id,policy_scope_type,policy_scope_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(anchorId, shape.anchorKey, shape.anchorType, shape.customerId,
        shape.salespersonId, shape.creditObjectType, shape.creditObjectId, shape.policyScopeType,
        shape.policyScopeId, new Date().toISOString());
  } catch (error) {
    if (!/UNIQUE|duplicate/i.test(String(error?.message || ''))) throw error;
  }
  const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM credit_lock_anchors WHERE anchor_key=?${suffix}`).get(shape.anchorKey);
  if (!row) throw new HttpError(500, '信用锁锚点无法解析', { code: 'CREDIT_ANCHOR_UNRESOLVABLE' });
  if (!sameShape(row, shape)) throw new HttpError(409, '信用锁锚点身份冲突', { code: 'CREDIT_ANCHOR_SHAPE_CONFLICT' });
  return row;
}

function present(row) {
  return {
    id: row.id, anchorKey: row.anchor_key, anchorType: row.anchor_type,
    customerId: row.customer_id, salespersonId: row.salesperson_id,
    creditObjectType: row.credit_object_type, creditObjectId: row.credit_object_id,
    policyScopeType: row.policy_scope_type, policyScopeId: row.policy_scope_id,
    createdAt: row.created_at,
  };
}

export function listCreditAnchors(db, res, actor, url) {
  // Anchor rows carry customer_id and salesperson_id, so the whole inventory
  // is an administrative surface: CREDIT_VIEW plus cross-group scope, or ADMIN.
  // A group-derived "only my group's anchors" rule is forbidden by AP1.
  if (actor?.roleCode !== 'ADMIN' && !(actorHas(actor, 'CREDIT_VIEW') && actorHas(actor, 'SALES_CROSS_GROUP'))) {
    throw new HttpError(403, '没有查看信用锚点的权限', { code: 'CREDIT_SCOPE_DENIED' });
  }
  const type = String(url.searchParams.get('anchorType') || '').trim().toUpperCase();
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  const where = [];
  const args = [];
  if (type) { where.push('anchor_type=?'); args.push(type); }
  if (customerId) { where.push('customer_id=?'); args.push(customerId); }
  const rows = db.prepare(`SELECT * FROM credit_lock_anchors${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY anchor_key`).all(...args);
  return send(res, 200, { anchors: rows.map(present) });
}

export async function provisionCreditAnchor(db, req, res, actor) {
  requireCreditManagementAuthority(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['anchorType','customerId','salespersonId','creditObjectType','creditObjectId','policyScopeType','policyScopeId']);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const fingerprint = requestFingerprint(body);
  let response;
  transaction(db, () => {
    const documentId = body.anchorType === 'POLICY_SCOPE'
      ? policyScopeAnchorKey(body.policyScopeType || 'GLOBAL', body.policyScopeId || 'GLOBAL')
      : creditObjectAnchorKey(body);
    const replay = idempotencyReplay(db, 'CREDIT_ANCHOR_PROVISION', documentId, key, fingerprint);
    if (replay) { response = replay; return; }
    const anchor = ensureCreditLockAnchor(db, body);
    response = { anchor: present(anchor) };
    audit(db, actor.id, 'PROVISION', 'CREDIT_LOCK_ANCHOR', anchor.id, anchor.anchor_key);
    saveIdempotency(db, 'CREDIT_ANCHOR_PROVISION', documentId, key, fingerprint, response);
  });
  return send(res, 200, response);
}

export const presentCreditAnchor = present;
