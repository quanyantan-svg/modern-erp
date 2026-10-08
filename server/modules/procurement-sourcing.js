import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, requiredText, send,
} from '../lib/http.js';
import { rational, roundRational } from './commercial-golive.js';

const VIEW_PERMISSIONS = ['PROCUREMENT_CONFIG_VIEW', 'PROCUREMENT_CONFIG_MANAGE'];
const SOURCE_TYPES = new Set(['PURCHASE', 'OUTSOURCE']);
const PROPORTION_ZERO = { num: 0, den: 1 };

function assertViewPermission(actor) {
  allowAny(actor, VIEW_PERMISSIONS);
}

function assertManagePermission(actor) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
}

function assertSourcingOverridePermission(actor) {
  allowAny(actor, ['PROCUREMENT_CONFIG_MANAGE']);
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

function assertSupplierQualification(db, supplierId, productId) {
  const row = db.prepare(`SELECT procurement_enabled,outsourcing_enabled,qualification_status,qualification_valid_from,qualification_valid_to FROM suppliers WHERE id=?`).get(supplierId);
  if (!row) throw new HttpError(409, '供应商不存在');
  const date = new Date().toISOString().slice(0, 10);
  if (row.qualification_status !== 'QUALIFIED' || (row.qualification_valid_to && row.qualification_valid_to < date)) {
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
  assertSupplierQualification(db, supplierId, productId);
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
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceType', 'sourceId', 'procurementSourceType', 'productId', 'businessDate', 'quantity', 'manualOverride']);
  const sourceType = body.sourceType === 'PR' ? 'PR' : 'PO';
  const procurementSourceType = normalizeSourceType(body.procurementSourceType ?? 'PURCHASE');
  const productId = requiredText(body.productId, '产品', 100);
  const businessDate = String(body.businessDate || new Date().toISOString().slice(0, 10));
  const required = rational(Number(body.quantity), 1);
  const sourceEntries = listSourceEntries(db, { productId, sourceType: procurementSourceType, date: businessDate });
  if (!sourceEntries.length && !body.manualOverride) {
    throw new HttpError(409, '未找到有效货源，无法分配');
  }
  const quotas = listQuotaRows(db, { productId, sourceType: procurementSourceType, date: businessDate });
  const supplierMap = new Map(sourceEntries.map((entry) => [entry.supplierId, entry]));
  let allocations;
  if (quotas.length && supplierMap.size) {
    allocations = allocateProportional(required, quotas.filter((q) => supplierMap.has(q.supplierId)));
  } else if (sourceEntries.length === 1) {
    allocations = [{ quota: null, allocated: required, sourceEntry: sourceEntries[0] }];
  } else {
    throw new HttpError(409, '没有匹配的货源或配额');
  }
  // For each allocation, ensure supplier is qualified at business date.
  for (const allocation of allocations) {
    const supplierId = allocation.quota?.supplierId || allocation.sourceEntry?.supplierId;
    if (!supplierId) continue;
    assertSupplierQualification(db, supplierId, productId);
  }
  // Manual override must include reason + permission.
  let overrideReason = null;
  if (body.manualOverride) {
    assertSourcingOverridePermission(actor);
    overrideReason = requiredText(body.manualOverride?.reason, '人工覆盖原因', 500);
  }
  const decisionId = randomUUID();
  const hashInput = JSON.stringify({ sourceType, sourceId: body.sourceId, productId, allocations });
  const hash = `sha256:${hashInput.length}`;
  transaction(db, () => {
    db.prepare(`INSERT INTO sourcing_decisions(id,source_type,source_id,procurement_source_type,product_id,status,business_date,hash,override_reason,created_by,created_at,applied_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(decisionId, sourceType, body.sourceId, procurementSourceType, productId, body.manualOverride ? 'OVERRIDDEN' : 'APPLIED', businessDate, hash, overrideReason, actor.id, new Date().toISOString(), new Date().toISOString());
    const insertAllocation = db.prepare(`INSERT INTO sourcing_decision_allocations(id,decision_id,source_list_entry_id,supplier_id,product_id,source_quantity_num,source_quantity_den,allocated_quantity_num,allocated_quantity_den,rule_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    allocations.forEach((allocation, index) => {
      const supplierId = allocation.quota?.supplierId || allocation.sourceEntry?.supplierId;
      insertAllocation.run(randomUUID(), decisionId, allocation.sourceEntry?.id || null, supplierId, productId, required.num, required.den, allocation.allocated.num, allocation.allocated.den, body.manualOverride ? `OVERRIDE:${overrideReason}` : `QUOTA:${allocation.quota?.id || 'single-source'}`);
    });
    audit(db, actor.id, body.manualOverride ? 'OVERRIDE' : 'APPLY', 'SOURCING_DECISION', decisionId, `${sourceType}:${body.sourceId}`);
  });
  return send(res, 200, {
    decisionId,
    allocations: allocations.map((allocation) => ({
      supplierId: allocation.quota?.supplierId || allocation.sourceEntry?.supplierId,
      allocatedQuantity: roundRational(allocation.allocated.num, allocation.allocated.den),
      rule: body.manualOverride ? 'OVERRIDE' : `QUOTA:${allocation.quota?.id || 'single-source'}`,
    })),
  });
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
