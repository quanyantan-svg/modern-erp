// Platform 编号服务（PL-09）。
//
// 设计来源：docs/design/platform.md §32.8；Requirement §36.8。
//
// 本模块是编号发放的**唯一 canonical 实现**。它**采纳**既有的两张表
// （`document_sequences` / `document_number_allocations`，结构不变），
// 在其上增加一张**规则表**（`document_number_series`），把前缀、期间模式、补零长度、
// 组织维度从"调用点字面量"变成可维护的配置。
//
// 三条硬约束：
//   1. **既有 6 种单据的单号逐字符不变**（SI / PB / SCN / PCN / OB / PO）。
//      渲染规则必须复现 `${TYPE}-${YYYYMM}-${00000}`，且无组织维度时
//      `period_key` 必须仍是 `YYYYMM`（否则号段会断在旧数据上）。
//   2. **分配必须与单据写入在同一事务内**。否则单据事务回滚会留下孤儿号（PL-DEF-11）。
//      调用方在事务内调用时本服务**内联执行**，不另开事务。
//   3. **幂等必须原子**（PL-DEF-12）：同一幂等键并发取号必须返回**同一单号**，
//      而不是 409。取号本身用原子 upsert，唯一性由 `document_number_allocations` 的
//      UNIQUE 约束兜底；分配记录与号段在同一事务内写入。

import {
  allow, assertAllowedFields, HttpError, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';

const PERIOD_MODES = ['NONE', 'MONTH', 'YEAR'];

function nowIso() { return new Date().toISOString(); }

function conflict(message, code) { return new HttpError(409, message, { code }); }

/** 读取某单据类型 + 组织的编号规则；没有规则时回落到"前缀 = 单据类型、按月、5 位"的既有形态。 */
export function resolveNumberSeries(db, documentType, orgId = '') {
  const row = db.prepare(
    'SELECT * FROM document_number_series WHERE document_type=? AND org_id=? AND active=1',
  ).get(String(documentType), String(orgId || ''));
  if (row) return row;
  return {
    document_type: String(documentType),
    org_id: String(orgId || ''),
    prefix: String(documentType),
    suffix: '',
    period_mode: 'MONTH',
    pad_length: 5,
    active: 1,
  };
}

/** 期间键：与既有实现逐字符一致（`YYYYMM`），有组织维度时前缀组织码。 */
export function computePeriodKey(series, businessDate, orgId = '') {
  const date = String(businessDate || '').slice(0, 10);
  let period = '';
  if (series.period_mode === 'MONTH') period = date.slice(0, 7).replace('-', '');
  else if (series.period_mode === 'YEAR') period = date.slice(0, 4);
  const organization = String(orgId || series.org_id || '');
  return organization ? `${organization}:${period}` : period;
}

/** 渲染单号：复现既有 `${TYPE}-${YYYYMM}-${00000}` 形态。 */
export function renderDocumentNumber(series, allocated, businessDate) {
  const date = String(businessDate || '').slice(0, 10);
  let periodPart = '';
  if (series.period_mode === 'MONTH') periodPart = `-${date.slice(0, 7).replace('-', '')}-`;
  else if (series.period_mode === 'YEAR') periodPart = `-${date.slice(0, 4)}-`;
  const padded = String(allocated).padStart(Number(series.pad_length) || 5, '0');
  return `${series.prefix}${periodPart}${padded}${series.suffix || ''}`;
}

/**
 * 分配单号。
 *
 * @param {object} db
 * @param {string} documentType 单据类型（SI / PB / SCN / PCN / OB / PO / PRQ …）
 * @param {string} businessDate 业务日期（决定期间）
 * @param {string} idempotencyKey 幂等键
 * @param {{orgId?: string, prefix?: string, periodMode?: string, padLength?: number, suffix?: string}} options
 * @returns {{documentNo: string, replayed: boolean}}
 */
export function allocateDocumentNumber(db, documentType, businessDate, idempotencyKey, options = {}) {
  if (!idempotencyKey) throw new HttpError(400, '编号分配必须带幂等键');
  const work = () => {
    // ① 幂等重放：同一键必须返回同一单号（PL-DEF-12）。
    const existing = db.prepare(
      'SELECT document_no FROM document_number_allocations WHERE idempotency_key=?',
    ).get(idempotencyKey);
    if (existing) return { documentNo: existing.document_no, replayed: true };

    // ② 规则。
    const base = resolveNumberSeries(db, documentType, options.orgId || '');
    const series = {
      ...base,
      prefix: options.prefix || base.prefix,
      suffix: options.suffix === undefined ? base.suffix : options.suffix,
      period_mode: options.periodMode || base.period_mode,
      pad_length: options.padLength || base.pad_length,
    };
    const periodKey = computePeriodKey(series, businessDate, options.orgId || '');

    // ③ 原子取号（SQL 形态与既有实现一致，MySQL 适配器按同一形态拦截）。
    const row = db.prepare(
      `INSERT INTO document_sequences(document_type, period_key, next_value) VALUES(?,?,2)
       ON CONFLICT(document_type, period_key) DO UPDATE SET next_value = next_value+1 RETURNING next_value-1 allocated`,
    ).get(String(documentType), periodKey);
    const documentNo = renderDocumentNumber(series, row.allocated, businessDate);

    // ④ 分配记录（唯一约束兜底；冲突即重放同一单号）。
    try {
      db.prepare(
        'INSERT INTO document_number_allocations(idempotency_key, document_type, document_no, created_at) VALUES(?,?,?,?)',
      ).run(idempotencyKey, String(documentType), documentNo, nowIso());
    } catch (error) {
      const replay = db.prepare(
        'SELECT document_no FROM document_number_allocations WHERE idempotency_key=?',
      ).get(idempotencyKey);
      if (replay) return { documentNo: replay.document_no, replayed: true };
      throw error;
    }
    return { documentNo, replayed: false };
  };
  // 调用方已在事务内 → 内联执行，保证分配与单据写入同生共死（PL-DEF-11）。
  return db.isTransaction ? work() : transaction(db, work);
}

/**
 * 尚未纳入编号服务的单据类型（各自造号）。
 * 这些是**已知债务**：清单必须可见，避免"以为已经统一编号"的误判。
 */
export const NUMBERING_PENDING_DOCUMENT_TYPES = Object.freeze([
  { documentType: 'SALES_ORDER', source: 'server/modules/sales-orders.js:141' },
  { documentType: 'PRODUCTION_ORDER', source: 'server/modules/manufacturing-orders.js:143' },
  { documentType: 'QUOTATION', source: 'server/modules/sales-quotations.js:62' },
  { documentType: 'ACCOUNTING_VOUCHER', source: 'server/app.js:5075' },
  { documentType: 'INVENTORY_ADJUSTMENT', source: 'server/app.js:5079' },
  { documentType: 'INVENTORY_TRANSFER', source: 'server/modules/inventory-transfer.js:28' },
  { documentType: 'INVENTORY_SCRAP', source: 'server/modules/inventory-extensions.js:51' },
  { documentType: 'ASSEMBLY', source: 'server/modules/inventory-assembly-disassembly.js:79' },
  { documentType: 'PRODUCTION_INSPECTION', source: 'server/modules/manufacturing-quality.js:207' },
  { documentType: 'FORECAST', source: 'server/modules/planning.js:73' },
  { documentType: 'MRP', source: 'server/modules/planning.js:78' },
  { documentType: 'WIP_TRANSFER', source: 'server/modules/outsourcing-finance.js:953' },
]);

export async function listNumberSeries(db, res, actor) {
  allow(actor, 'NUMBERING_VIEW');
  const rows = db.prepare('SELECT * FROM document_number_series ORDER BY document_type, org_id').all();
  return send(res, 200, {
    series: rows.map((row) => ({
      id: row.id, documentType: row.document_type, orgId: row.org_id,
      prefix: row.prefix, suffix: row.suffix, periodMode: row.period_mode,
      padLength: row.pad_length, active: row.active,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    pendingDocumentTypes: NUMBERING_PENDING_DOCUMENT_TYPES,
  });
}

export async function createNumberSeries(db, req, res, actor) {
  allow(actor, 'NUMBERING_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['documentType', 'orgId', 'prefix', 'suffix', 'periodMode', 'padLength']);
  const documentType = requiredCode(body.documentType, '单据类型');
  const orgId = String(body.orgId || '').trim();
  const prefix = requiredText(body.prefix, '编号前缀', 32);
  const suffix = String(body.suffix || '').trim();
  const periodMode = requiredCode(body.periodMode, '期间模式');
  if (!PERIOD_MODES.includes(periodMode)) throw new HttpError(400, '期间模式无效');
  const padLength = Number(body.padLength ?? 5);
  if (!Number.isSafeInteger(padLength) || padLength < 1 || padLength > 12) {
    throw new HttpError(400, '补零长度必须是 1–12 的整数');
  }
  const row = transaction(db, () => {
    const existing = db.prepare(
      'SELECT id FROM document_number_series WHERE document_type=? AND org_id=?',
    ).get(documentType, orgId);
    if (existing) throw conflict('该单据类型与组织已有编号规则', 'PLATFORM_NUMBER_RULE_CONFLICT');
    const seriesId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO document_number_series(id, document_type, org_id, prefix, suffix, period_mode, pad_length, reset_rule, active, created_at, updated_at)'
      + ' VALUES(?,?,?,?,?,?,?,?,1,?,?)',
    ).run(seriesId, documentType, orgId, prefix, suffix, periodMode, padLength, null, now, now);
    audit(db, actor.id, 'NUMBERING_RULE_CREATE', 'NUMBERING_SERIES', seriesId,
      `创建编号规则 ${documentType}${orgId ? `/${orgId}` : ''}`);
    return db.prepare('SELECT * FROM document_number_series WHERE id=?').get(seriesId);
  });
  return send(res, 201, { series: row });
}

export async function updateNumberSeries(db, req, res, actor, seriesId) {
  allow(actor, 'NUMBERING_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['prefix', 'suffix', 'periodMode', 'padLength', 'active']);
  const row = transaction(db, () => {
    const current = db.prepare('SELECT * FROM document_number_series WHERE id=?').get(seriesId);
    if (!current) throw new HttpError(404, '编号规则不存在', { code: 'PLATFORM_NUMBER_RULE_NOT_FOUND' });
    const periodMode = body.periodMode === undefined
      ? current.period_mode : requiredCode(body.periodMode, '期间模式');
    if (!PERIOD_MODES.includes(periodMode)) throw new HttpError(400, '期间模式无效');
    const padLength = body.padLength === undefined ? current.pad_length : Number(body.padLength);
    if (!Number.isSafeInteger(padLength) || padLength < 1 || padLength > 12) {
      throw new HttpError(400, '补零长度必须是 1–12 的整数');
    }
    const now = nowIso();
    db.prepare(
      'UPDATE document_number_series SET prefix=?, suffix=?, period_mode=?, pad_length=?, active=?, updated_at=? WHERE id=?',
    ).run(
      body.prefix === undefined ? current.prefix : requiredText(body.prefix, '编号前缀', 32),
      body.suffix === undefined ? current.suffix : String(body.suffix || '').trim(),
      periodMode, padLength,
      body.active === undefined ? current.active : (body.active ? 1 : 0),
      now, seriesId,
    );
    audit(db, actor.id, 'NUMBERING_RULE_UPDATE', 'NUMBERING_SERIES', seriesId,
      `更新编号规则 ${current.document_type}`);
    return db.prepare('SELECT * FROM document_number_series WHERE id=?').get(seriesId);
  });
  return send(res, 200, { series: row });
}
