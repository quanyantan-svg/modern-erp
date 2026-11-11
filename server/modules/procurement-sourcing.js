import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, requiredText, send,
} from '../lib/http.js';
import { rational } from './commercial-golive.js';

const VIEW_PERMISSIONS = ['PROCUREMENT_CONFIG_VIEW', 'PROCUREMENT_CONFIG_MANAGE'];
const SOURCE_TYPES = new Set(['PURCHASE', 'OUTSOURCE']);
const PROPORTION_ZERO = { num: 0, den: 1 };

function assertViewPermission(actor) {
  allowAny(actor, VIEW_PERMISSIONS);
}

function assertManagePermission(actor) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
}

function normalizeSourceType(value, label = '货源类型') {
  const text = String(value ?? '').trim().toUpperCase();
  if (!SOURCE_TYPES.has(text)) throw new HttpError(400, `${label}不正确`);
  return text;
}

function normalizeProportion(value, label) {
  const num = Number(value?.num ?? value?.numerator ?? value);
  const den = Number(value?.den ?? value?.denominator ?? 1);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num < 0 || den <= 0) {
    throw new HttpError(400, `${label}必须为非负有理数`);
  }
  return rational(num, den);
}

function rowToSourceEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    sourceType: row.source_type,
    enabled: Boolean(row.enabled),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToQuota(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    sourceType: row.source_type,
    proportion: { num: row.proportion_num, den: row.proportion_den },
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function listSourceEntries(db, { supplierId, productId, sourceType, date }) {
  const conditions = [];
  const params = [];
  if (supplierId) { conditions.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { conditions.push('product_id=?'); params.push(productId); }
  if (sourceType) { conditions.push('source_type=?'); params.push(normalizeSourceType(sourceType)); }
  if (date) { conditions.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'); params.push(date, date); }
  conditions.push('enabled=1');
  const sql = `SELECT * FROM source_list_entries WHERE ${conditions.join(' AND ')} ORDER BY product_id, source_type, version DESC`;
  return db.prepare(sql).all(...params).map(rowToSourceEntry);
}

function listQuotaRows(db, { productId, sourceType, date }) {
  if (!productId) return [];
  const source = normalizeSourceType(sourceType ?? 'PURCHASE');
  const params = [productId, source];
  let sql = `SELECT * FROM quota_assignments WHERE product_id=? AND source_type=?`;
  if (date) { sql += ' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'; params.push(date, date); }
  sql += ' ORDER BY proportion_num*1.0/proportion_den DESC, version DESC';
  return db.prepare(sql).all(...params).map(rowToQuota);
}

function assertSupplierQualification(db, supplierId, sourceType, businessDate) {
  const row = db.prepare(`SELECT procurement_enabled,outsourcing_enabled,qualification_status,qualification_valid_from,qualification_valid_to FROM suppliers WHERE id=?`).get(supplierId);
  if (!row) throw new HttpError(409, '供应商不存在');
  if ((sourceType === 'PURCHASE' && !row.procurement_enabled)
    || (sourceType === 'OUTSOURCE' && !row.outsourcing_enabled)) {
    throw new HttpError(409, '供应商未启用该业务类型');
  }
  if (row.qualification_status !== 'QUALIFIED'
    || (row.qualification_valid_from && row.qualification_valid_from > businessDate)
    || (row.qualification_valid_to && row.qualification_valid_to < businessDate)) {
    throw new HttpError(409, '供应商资质无效或已过期');
  }
  return row;
}

function allocateProportional(required, quotas) {
  if (!quotas.length) throw new HttpError(409, '未配置任何配额');
  const total = quotas.reduce((acc, q) => rationalAdd(acc, q.proportion), { num: 0, den: 1 });
  if (total.num === 0) throw new HttpError(409, '配额合计必须为正');
  const allocations = [];
  let allocated = { num: 0, den: 1 };
  for (const quota of quotas) {
    const share = rationalMul(required, rationalDiv(quota.proportion, total));
    allocations.push({ quota, allocated: share });
    allocated = rationalAdd(allocated, share);
  }
  // Deterministic rounding tie-break: largest share gets the residual.
  const residual = rationalSub(required, allocated);
  if (residual.num !== 0) {
    let idx = 0;
    for (let i = 1; i < allocations.length; i += 1) {
      if (rationalCmp(allocations[i].allocated, allocations[idx].allocated) > 0) idx = i;
    }
    allocations[idx].allocated = rationalAdd(allocations[idx].allocated, residual);
  }
  // Verify conservation
  const sum = allocations.reduce((acc, a) => rationalAdd(acc, a.allocated), { num: 0, den: 1 });
  if (rationalCmp(sum, required) !== 0) {
    throw new HttpError(500, '配额分配未达数量守恒');
  }
  return allocations;
}

function rationalAdd(a, b) {
  const num = BigInt(a.num) * BigInt(b.den) + BigInt(b.num) * BigInt(a.den);
  const den = BigInt(a.den) * BigInt(b.den);
  const r = reduceBig(num, den);
  return { num: Number(r.num), den: Number(r.den) };
}

function rationalSub(a, b) {
  const num = BigInt(a.num) * BigInt(b.den) - BigInt(b.num) * BigInt(a.den);
  const den = BigInt(a.den) * BigInt(b.den);
  const r = reduceBig(num, den);
  return { num: Number(r.num), den: Number(r.den) };
}

function rationalMul(a, b) {
  const num = BigInt(a.num) * BigInt(b.num);
  const den = BigInt(a.den) * BigInt(b.den);
  const r = reduceBig(num, den);
  return { num: Number(r.num), den: Number(r.den) };
}

function rationalDiv(a, b) {
  if (b.num === 0) throw new HttpError(500, '除以零');
  const num = BigInt(a.num) * BigInt(b.den);
  const den = BigInt(a.den) * BigInt(b.num);
  if (den < 0n) { num = -num; den = -den; }
  const r = reduceBig(num, den);
  return { num: Number(r.num), den: Number(r.den) };
}

function reduceBig(num, den) {
  if (num === 0n) return { num: 0n, den: 1n };
  const sign = num < 0n ? -1n : 1n;
  let n = num < 0n ? -num : num;
  let d = den < 0n ? -den : den;
  while (d !== 0n) { [n, d] = [d, n % d]; }
  return { num: sign * (num === 0n ? 0n : num / n), den: den / n };
}

function rationalCmp(a, b) {
  const diff = BigInt(a.num) * BigInt(b.den) - BigInt(b.num) * BigInt(a.den);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

export function listSourcingSourceEntries(db, res, actor, url) {
  assertViewPermission(actor);
  const entries = listSourceEntries(db, {
    supplierId: url.searchParams.get('supplierId'),
    productId: url.searchParams.get('productId'),
    sourceType: url.searchParams.get('sourceType'),
    date: url.searchParams.get('date'),
  });
  return send(res, 200, { sourceEntries: entries });
}

export function listSourcingQuotas(db, res, actor, url) {
  assertViewPermission(actor);
  const quotas = listQuotaRows(db, {
    productId: url.searchParams.get('productId'),
    sourceType: url.searchParams.get('sourceType'),
    date: url.searchParams.get('date'),
  });
  return send(res, 200, { quotas });
}

export async function createSourceEntry(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'enabled', 'effectiveFrom', 'effectiveTo']);
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const productId = requiredText(body.productId, '产品', 100);
  const sourceType = normalizeSourceType(body.sourceType);
  const date = body.effectiveFrom || new Date().toISOString().slice(0, 10);
  const enabled = body.enabled === undefined ? 1 : (body.enabled ? 1 : 0);
  assertSupplierQualification(db, supplierId, sourceType, date);
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM source_list_entries WHERE supplier_id=? AND product_id=? AND source_type=?').get(supplierId, productId, sourceType).n) || 1);
  const entryId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE source_list_entries SET effective_to=? WHERE supplier_id=? AND product_id=? AND source_type=? AND effective_to IS NULL').run(date, supplierId, productId, sourceType);
    db.prepare(`INSERT INTO source_list_entries(id,supplier_id,product_id,source_type,enabled,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(entryId, supplierId, productId, sourceType, enabled, date, body.effectiveTo || null, version, actor.id, now);
    db.prepare(`INSERT INTO source_list_versions(id,entry_id,version,snapshot_json,effective_from,effective_to,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), entryId, version, JSON.stringify({ supplierId, productId, sourceType, enabled, effectiveFrom: date, effectiveTo: body.effectiveTo || null }), date, body.effectiveTo || null, actor.id, now);
    audit(db, actor.id, 'CREATE', 'SOURCE_LIST_ENTRY', entryId, `${supplierId}:${productId}:${sourceType}`);
  });
  return send(res, 201, { id: entryId });
}

export async function disableSourceEntry(db, req, res, actor, entryId) {
  assertManagePermission(actor);
  const row = db.prepare('SELECT * FROM source_list_entries WHERE id=?').get(entryId);
  if (!row) throw new HttpError(404, '货源不存在');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE source_list_entries SET enabled=0, effective_to=? WHERE id=?').run(now, entryId);
    audit(db, actor.id, 'DISABLE', 'SOURCE_LIST_ENTRY', entryId, row.supplier_id);
  });
  return send(res, 200, { ok: true });
}

/**
 * PRC-04 — 货源控制的显式 override。
 *
 * 货源控制启用时，一个在业务日期没有有效货源的供应商不得被静默使用。业务
 * 需要放行时，必须由有权限的人**显式**放行，并且：
 *
 *   - 写明**原因**（必填，不可为空）；
 *   - 指定**放行的业务日期区间**（override 永远是有界的，不是永久放行）；
 *   - 写入**可追溯审计**（谁、何时、为什么、放行哪个供应商 / 货品 / 货源
 *     类型 / 日期区间）。
 *
 * override 不改写 `source_list_entries`，也不影响其它供应商或其它货源类型。
 * 同一供应商 / 货品 / 货源类型上，互不重叠的 override 可以并存。
 */
export async function overrideSourceEntry(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'reason', 'effectiveFrom', 'effectiveTo']);
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const productId = requiredText(body.productId, '产品', 100);
  const sourceType = normalizeSourceType(body.sourceType);
  // 原因必填：没有原因的 override 不是业务事实。
  const reason = requiredText(body.reason, 'override 原因', 500);
  const effectiveFrom = requiredText(body.effectiveFrom, '生效开始日期', 10);
  const effectiveTo = requiredText(body.effectiveTo, '生效结束日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
    throw new HttpError(400, 'override 日期区间格式应为 YYYY-MM-DD');
  }
  if (effectiveTo < effectiveFrom) {
    throw new HttpError(400, 'override 结束日期不能早于开始日期', { code: 'SOURCE_OVERRIDE_WINDOW_INVALID' });
  }
  if (!db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplierId)) throw new HttpError(409, '供应商不存在');
  if (!db.prepare('SELECT id FROM products WHERE id=?').get(productId)) throw new HttpError(409, '产品不存在');
  const overrideId = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    // 同一三元组上不得有重叠的 ACTIVE override：否则「放行区间」不再唯一，
    // 审计会失去确定性含义。
    const overlapping = db.prepare(`SELECT id, effective_from, effective_to FROM source_list_overrides
      WHERE supplier_id=? AND product_id=? AND source_type=? AND status='ACTIVE'
        AND NOT (effective_to < ? OR effective_from > ?)`)
      .all(supplierId, productId, sourceType, effectiveFrom, effectiveTo);
    if (overlapping.length) {
      throw new HttpError(409, '该供应商 / 货品 / 货源类型在所选日期区间已有生效的 override', { code: 'SOURCE_OVERRIDE_OVERLAP' });
    }
    db.prepare(`INSERT INTO source_list_overrides(
        id,supplier_id,product_id,source_type,effective_from,effective_to,reason,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(
      overrideId, supplierId, productId, sourceType, effectiveFrom, effectiveTo, reason, actor.id, now,
    );
    audit(db, actor.id, 'OVERRIDE', 'SOURCE_LIST_OVERRIDE', overrideId, JSON.stringify({
      supplierId, productId, sourceType, effectiveFrom, effectiveTo, reason,
    }));
  });
  return send(res, 201, {
    id: overrideId,
    supplierId, productId, sourceType, effectiveFrom, effectiveTo, reason,
  });
}

/**
 * 列出货源 override（审计可读投影）。
 */
export function listSourceOverrides(db, res, actor, url) {
  assertViewPermission(actor);
  const conditions = [];
  const params = [];
  const supplierId = url.searchParams.get('supplierId');
  const productId = url.searchParams.get('productId');
  const sourceType = url.searchParams.get('sourceType');
  if (supplierId) { conditions.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { conditions.push('product_id=?'); params.push(productId); }
  if (sourceType) { conditions.push('source_type=?'); params.push(normalizeSourceType(sourceType)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM source_list_overrides ${where} ORDER BY created_at DESC, id DESC LIMIT 200`).all(...params);
  return send(res, 200, {
    overrides: rows.map((row) => ({
      id: row.id,
      supplierId: row.supplier_id,
      productId: row.product_id,
      sourceType: row.source_type,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      reason: row.reason,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
  });
}

export async function upsertQuota(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'proportion', 'effectiveFrom', 'effectiveTo']);
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const productId = requiredText(body.productId, '产品', 100);
  const sourceType = normalizeSourceType(body.sourceType);
  const proportion = normalizeProportion(body.proportion, '配额比例');
  if (proportion.num === 0) throw new HttpError(400, '配额比例必须大于零');
  const date = body.effectiveFrom || new Date().toISOString().slice(0, 10);
  const quotaId = randomUUID(); const now = new Date().toISOString();
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM quota_assignments WHERE supplier_id=? AND product_id=? AND source_type=?').get(supplierId, productId, sourceType).n) || 1);
  transaction(db, () => {
    db.prepare('UPDATE quota_assignments SET effective_to=? WHERE supplier_id=? AND product_id=? AND source_type=? AND effective_to IS NULL').run(date, supplierId, productId, sourceType);
    db.prepare(`INSERT INTO quota_assignments(id,supplier_id,product_id,source_type,proportion_num,proportion_den,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(quotaId, supplierId, productId, sourceType, proportion.num, proportion.den, date, body.effectiveTo || null, version, actor.id, now);
    audit(db, actor.id, 'UPSERT', 'QUOTA_ASSIGNMENT', quotaId, `${supplierId}:${productId}:${sourceType}=${proportion.num}/${proportion.den}`);
  });
  return send(res, 201, { id: quotaId });
}

export async function resolveSourcingDecision(db, req, res, actor) {
  assertViewPermission(actor);
  const error = new HttpError(409, '正式寻源决策写入已关闭', { code: 'SOURCING_DECISION_WRITE_CLOSED' });
  auditBusinessRejection(db, actor, { entityType: 'SOURCING_DECISION', entityId: null, action: '正式寻源决策写入' }, error);
  throw error;
}

export function listSourcingDecisions(db, res, actor, url) {
  assertViewPermission(actor);
  const rows = db.prepare('SELECT * FROM sourcing_decisions ORDER BY created_at DESC LIMIT 100').all();
  return send(res, 200, { decisions: rows });
}

export {
  assertSupplierQualification,
  allocateProportional,
  rationalAdd,
  rationalSub,
  rationalMul,
  rationalDiv,
  reduceBig,
  rationalCmp,
};
