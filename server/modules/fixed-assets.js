// Accounting & Analytics Domain Closure — AA-W5 fixed-asset lifecycle.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.5
//   AA-W5.1..AA-W5.19
// Design:    docs/design/accounting-analytics.md §31.5 / §31.8 / §31.9 / §31.10
//
// Single responsibility: 资产卡片生命周期、字典与折旧政策、采购转固、受控变更单、
// 拆分 / 合并、借用与盘点、按政策自动计提折旧、资产处置。
//
// Boundaries enforced by this module:
//   - It never owns purchase receipts. The transfer reads the authoritative
//     procurement fact read-only and never writes to the procurement tables.
//   - It never writes `accounting_entries` directly. Depreciation and disposal
//     postings go through the canonical `createSystemVoucher` path, so the
//     GL, the voucher chain and the idempotency guard stay single-sourced.
//   - Depreciation amounts are **never** taken from the caller. They are
//     derived from the depreciation policy, the card's original value and the
//     depreciation already booked for that card.
//   - Every mutation runs in a transaction, re-reads the authoritative state
//     and writes an audit row. Split / merge are value-conserving; a
//     non-conserving request fails closed with FIXED_ASSET_VALUE_NOT_BALANCED.
//
// Money is always a safe-integer cent amount.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { createSystemVoucher } from './financial-inventory.js';

export const ASSET_CARD_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'IDLE', 'DISPOSING', 'DISPOSED']);
export const DEPRECIATION_METHODS = Object.freeze(['STRAIGHT_LINE', 'DOUBLE_DECLINING', 'WORKLOAD']);
export const DEPRECIATION_START_RULES = Object.freeze(['FROM_PURCHASE', 'FROM_TRANSFER', 'NEXT_PERIOD']);
export const CHANGE_TYPES = Object.freeze(['LOCATION', 'CUSTODIAN', 'VALUE', 'POLICY', 'TYPE']);
export const DISPOSAL_TYPES = Object.freeze(['SCRAP', 'SALE', 'REDUCTION']);

const LEGACY_STATUS_BY_CARD = Object.freeze({
  DRAFT: 'IN_USE',
  ACTIVE: 'IN_USE',
  IDLE: 'IDLE',
  DISPOSING: 'IN_USE',
  DISPOSED: 'DISPOSED',
});

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function requiredPeriod(value, label = '会计期间') {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, `${label}格式必须为 YYYY-MM`, { code: 'FIXED_ASSET_PERIOD_INVALID' });
  }
  return period;
}

function requiredCents(value, label) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new HttpError(400, `${label}必须是非负整数分`, { code: 'FIXED_ASSET_AMOUNT_INVALID' });
  }
  return cents;
}

function optionalCents(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return requiredCents(value, label);
}

function periodEnd(period) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

function monthIndex(month) {
  const [year, mon] = month.split('-').map(Number);
  return year * 12 + (mon - 1);
}

function monthsBetween(fromMonth, toMonth) {
  return monthIndex(toMonth) - monthIndex(fromMonth);
}

function subjectForRole(db, role) {
  const row = db.prepare(
    'SELECT s.id,s.code,s.name FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?',
  ).get(role);
  if (!row) {
    throw new HttpError(409, '缺少会计科目角色映射：' + role, { code: 'ACCOUNTING_ROLE_MAPPING_MISSING' });
  }
  return row;
}

function loadAsset(db, assetId) {
  const asset = db.prepare('SELECT * FROM fixed_assets WHERE id=?').get(assetId);
  if (!asset) throw new HttpError(404, '资产不存在', { code: 'FIXED_ASSET_NOT_FOUND' });
  return asset;
}

function cardStatus(asset) {
  return asset.card_status || 'DRAFT';
}

function assertNotDisposed(asset) {
  const status = cardStatus(asset);
  if (status === 'DISPOSED' || status === 'DISPOSING') {
    throw new HttpError(409, '资产已处置或处置中，禁止该操作', { code: 'FIXED_ASSET_DISPOSED' });
  }
}

function originalValueCents(asset) {
  const value = Number(asset.original_value_cents ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : Number(asset.purchase_amount_cents || 0);
}

function accumulatedCents(asset) {
  return Number(asset.accumulated_depreciation_cents || 0);
}

function bookValueCents(asset) {
  const value = Number(asset.book_value_cents);
  if (Number.isSafeInteger(value) && value > 0) return value;
  return originalValueCents(asset) - accumulatedCents(asset);
}

function resolvePolicy(db, asset) {
  if (!asset.policy_id) return null;
  const policy = db.prepare('SELECT * FROM depreciation_policies WHERE id=?').get(asset.policy_id);
  if (!policy) {
    throw new HttpError(409, '资产引用的折旧政策不存在', { code: 'FIXED_ASSET_POLICY_NOT_FOUND' });
  }
  if (policy.status !== 'ACTIVE') {
    throw new HttpError(409, '资产引用的折旧政策已停用', { code: 'FIXED_ASSET_POLICY_INACTIVE' });
  }
  return policy;
}

function depreciationStartMonth(asset, policy) {
  const rule = policy.start_rule || 'FROM_PURCHASE';
  const anchorDate = rule === 'FROM_TRANSFER' || rule === 'NEXT_PERIOD'
    ? (asset.activated_at || asset.created_at || '').slice(0, 10)
    : (asset.purchase_date || asset.created_at || '').slice(0, 10);
  if (!anchorDate) return null;
  const month = anchorDate.slice(0, 7);
  if (rule === 'NEXT_PERIOD') {
    const [year, mon] = month.split('-').map(Number);
    const next = new Date(Date.UTC(year, mon, 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return month;
}

// ---------------------------------------------------------------------------
// Depreciation math (AA-W5.13 / AA-W5.16)
//
// The amount of a period is derived from the policy and the card, never from
// the caller. `chargedMonths` is the number of months already billed to the
// card, so the computation is restartable and idempotent.
// ---------------------------------------------------------------------------

function monthlySequence(policy, originalCents, residualCents, months) {
  const lifeMonths = Number(policy.useful_life_months || 0);
  const sequence = [];
  if (lifeMonths <= 0 || months <= 0) return sequence;
  if (policy.method === 'DOUBLE_DECLINING') {
    let book = originalCents;
    for (let index = 0; index < months; index += 1) {
      let amount = Math.floor((book * 2) / lifeMonths);
      if (book - amount < residualCents) amount = book - residualCents;
      if (amount <= 0) {
        sequence.push(0);
        continue;
      }
      book -= amount;
      sequence.push(amount);
    }
    return sequence;
  }
  const depreciable = Math.max(originalCents - residualCents, 0);
  const perMonth = Math.floor(depreciable / lifeMonths);
  for (let index = 0; index < months; index += 1) {
    sequence.push(perMonth);
  }
  return sequence;
}

function computePeriodDepreciation(db, asset, policy, period) {
  const original = originalValueCents(asset);
  const residual = residualFor(asset, policy);
  const depreciable = Math.max(original - residual, 0);
  if (depreciable <= 0) {
    return { amountCents: 0, months: 0, residualCents: residual };
  }
  if (policy.method === 'WORKLOAD') {
    throw new HttpError(409, '工作量法折旧需要业务工作量数据，当前能力不支持自动计提', {
      code: 'FIXED_ASSET_POLICY_METHOD_UNSUPPORTED',
    });
  }
  const startMonth = depreciationStartMonth(asset, policy);
  if (!startMonth) {
    throw new HttpError(409, '资产缺少起算日期，无法计算折旧', { code: 'FIXED_ASSET_START_DATE_MISSING' });
  }
  const lifeMonths = Number(policy.useful_life_months || 0);
  const elapsed = Math.min(monthsBetween(startMonth, period) + 1, lifeMonths);
  if (elapsed <= 0) return { amountCents: 0, months: 0, residualCents: residual };

  const booked = db.prepare(
    "SELECT COUNT(*) AS charged FROM asset_depreciations WHERE asset_id=? AND depreciation_type='AUTO' AND period IS NOT NULL AND period<=?",
  ).get(asset.id, period);
  const chargedMonths = Number(booked?.charged || 0);

  // The period amount is the **difference** between the cumulative amount the
  // policy would have produced through this period and the amount already
  // booked on the card. A manual adjustment therefore reduces the remaining
  // depreciation instead of being silently ignored, and a card can never be
  // depreciated twice for the same policy history.
  const sequence = monthlySequence(policy, original, residual, elapsed);
  const cumulative = sequence.reduce((sum, value) => sum + value, 0);
  const alreadyBooked = accumulatedCents(asset);
  const remaining = depreciable - alreadyBooked;
  const amountCents = Math.max(Math.min(cumulative - alreadyBooked, remaining), 0);
  return { amountCents, months: Math.max(elapsed - chargedMonths, 0), residualCents: residual };
}

// ---------------------------------------------------------------------------
// Dictionaries (AA-W5.1 / AA-W5.2)
// ---------------------------------------------------------------------------

function listAssetTypes(db, res, actor) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const types = db.prepare('SELECT * FROM asset_types ORDER BY code').all();
  return send(res, 200, { assetTypes: types });
}

async function createAssetType(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '类别编码', 50);
  const name = requiredText(body.name, '类别名称', 100);
  if (db.prepare('SELECT 1 FROM asset_types WHERE code=?').get(code)) {
    throw new HttpError(409, '资产类别编码已存在：' + code, { code: 'FIXED_ASSET_TYPE_EXISTS' });
  }
  const usefulLife = body.useful_life_months === undefined || body.useful_life_months === null
    ? null
    : Number(body.useful_life_months);
  if (usefulLife !== null && (!Number.isSafeInteger(usefulLife) || usefulLife <= 0)) {
    throw new HttpError(400, '类别默认使用年限必须是正整数月', { code: 'FIXED_ASSET_LIFE_INVALID' });
  }
  const typeId = id();
  db.prepare(
    'INSERT INTO asset_types(id,code,name,useful_life_months,status,created_at) VALUES(?,?,?,?,?,?)',
  ).run(typeId, code, name, usefulLife, 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'ASSET_TYPE', typeId, '新建资产类别 ' + code);
  return send(res, 201, { id: typeId });
}

function listAssetLocations(db, res, actor) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const locations = db.prepare('SELECT * FROM asset_locations ORDER BY code').all();
  return send(res, 200, { assetLocations: locations });
}

async function createAssetLocation(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '位置编码', 50);
  const name = requiredText(body.name, '位置名称', 100);
  if (db.prepare('SELECT 1 FROM asset_locations WHERE code=?').get(code)) {
    throw new HttpError(409, '资产位置编码已存在：' + code, { code: 'FIXED_ASSET_LOCATION_EXISTS' });
  }
  const locationId = id();
  db.prepare('INSERT INTO asset_locations(id,code,name,status,created_at) VALUES(?,?,?,?,?)')
    .run(locationId, code, name, 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'ASSET_LOCATION', locationId, '新建资产位置 ' + code);
  return send(res, 201, { id: locationId });
}

function listDepreciationPolicies(db, res, actor) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const policies = db.prepare('SELECT * FROM depreciation_policies ORDER BY code').all();
  return send(res, 200, { policies });
}

async function createDepreciationPolicy(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '政策编码', 50);
  const name = requiredText(body.name, '政策名称', 100);
  const method = requiredText(body.method, '折旧方法', 30).toUpperCase();
  if (!DEPRECIATION_METHODS.includes(method)) {
    throw new HttpError(400, '折旧方法非法：' + method, { code: 'FIXED_ASSET_METHOD_INVALID' });
  }
  const startRule = requiredText(body.start_rule, '起算规则', 30).toUpperCase();
  if (!DEPRECIATION_START_RULES.includes(startRule)) {
    throw new HttpError(400, '起算规则非法：' + startRule, { code: 'FIXED_ASSET_START_RULE_INVALID' });
  }
  const lifeMonths = Number(body.useful_life_months);
  if (!Number.isSafeInteger(lifeMonths) || lifeMonths <= 0) {
    throw new HttpError(400, '使用年限必须是正整数月', { code: 'FIXED_ASSET_LIFE_INVALID' });
  }
  const residualRateBp = Number(body.residual_rate_bp ?? 0);
  if (!Number.isSafeInteger(residualRateBp) || residualRateBp < 0 || residualRateBp > 10000) {
    throw new HttpError(400, '残值率必须是 0..10000 的基点整数', { code: 'FIXED_ASSET_RESIDUAL_INVALID' });
  }
  if (db.prepare('SELECT 1 FROM depreciation_policies WHERE code=?').get(code)) {
    throw new HttpError(409, '折旧政策编码已存在：' + code, { code: 'FIXED_ASSET_POLICY_EXISTS' });
  }
  const policyId = id();
  db.prepare(
    `INSERT INTO depreciation_policies(id,code,name,method,useful_life_months,residual_rate_bp,start_rule,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(policyId, code, name, method, lifeMonths, residualRateBp, startRule, 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'DEPRECIATION_POLICY', policyId, '新建折旧政策 ' + code);
  return send(res, 201, { id: policyId });
}

async function updateDepreciationPolicy(db, req, res, actor, policyId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const policy = db.prepare('SELECT * FROM depreciation_policies WHERE id=?').get(policyId);
  if (!policy) throw new HttpError(404, '折旧政策不存在', { code: 'FIXED_ASSET_POLICY_NOT_FOUND' });
  const body = await readJson(req);
  const name = body.name === undefined ? policy.name : requiredText(body.name, '政策名称', 100);
  const lifeMonths = body.useful_life_months === undefined
    ? Number(policy.useful_life_months)
    : Number(body.useful_life_months);
  if (!Number.isSafeInteger(lifeMonths) || lifeMonths <= 0) {
    throw new HttpError(400, '使用年限必须是正整数月', { code: 'FIXED_ASSET_LIFE_INVALID' });
  }
  const residualRateBp = body.residual_rate_bp === undefined
    ? Number(policy.residual_rate_bp || 0)
    : Number(body.residual_rate_bp);
  if (!Number.isSafeInteger(residualRateBp) || residualRateBp < 0 || residualRateBp > 10000) {
    throw new HttpError(400, '残值率必须是 0..10000 的基点整数', { code: 'FIXED_ASSET_RESIDUAL_INVALID' });
  }
  const status = body.status === undefined ? policy.status : requiredText(body.status, '状态', 20).toUpperCase();
  if (!['ACTIVE', 'DISABLED'].includes(status)) {
    throw new HttpError(400, '折旧政策状态非法：' + status, { code: 'FIXED_ASSET_POLICY_STATUS_INVALID' });
  }
  db.prepare(
    'UPDATE depreciation_policies SET name=?, useful_life_months=?, residual_rate_bp=?, status=? WHERE id=?',
  ).run(name, lifeMonths, residualRateBp, status, policyId);
  audit(db, actor.id, 'UPDATE', 'DEPRECIATION_POLICY', policyId, '更新折旧政策 ' + policy.code);
  return send(res, 200, { success: true });
}

// ---------------------------------------------------------------------------
// Asset cards (AA-W5.1..AA-W5.3 / AA-W5.19)
// ---------------------------------------------------------------------------

function listAssets(db, res, actor, url) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const where = [];
  const params = [];
  const status = url.searchParams.get('status');
  const assetType = url.searchParams.get('asset_type');
  const cardStatusFilter = url.searchParams.get('card_status');

  if (status) { where.push('fa.status = ?'); params.push(status); }
  if (assetType) { where.push('fa.asset_type = ?'); params.push(assetType); }
  if (cardStatusFilter) { where.push('fa.card_status = ?'); params.push(cardStatusFilter); }

  const sql = `SELECT fa.asset_code, fa.asset_name, fa.asset_type AS category, fa.purchase_date,
    fa.purchase_amount_cents, fa.status, fa.net_value_cents, fa.accumulated_depreciation_cents,
    fa.depreciation_method, fa.service_years, fa.residual_value_cents,
    fa.id, fa.card_no, fa.card_status, fa.asset_type_id, fa.location_id, fa.policy_id,
    fa.custodian_user_id, fa.source_type, fa.source_id,
    fa.original_value_cents, fa.book_value_cents, fa.activated_at, fa.disposed_at,
    u.display_name creatorName,
    COALESCE((SELECT SUM(depreciation_amount_cents) FROM asset_depreciations WHERE asset_id = fa.id), 0) AS totalDepreciatedCents
    FROM fixed_assets fa
    JOIN users u ON u.id = fa.creator_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY fa.created_at DESC LIMIT 100`;

  const assets = db.prepare(sql).all(...params);

  const summary = {
    totalCount: assets.length,
    totalOriginal: assets.reduce((s, a) => s + a.purchase_amount_cents, 0),
    totalDepreciation: assets.reduce((s, a) => s + a.accumulated_depreciation_cents, 0),
    totalNetValue: assets.reduce((s, a) => s + a.net_value_cents, 0),
  };

  return send(res, 200, { assets, summary });
}

function ensureAssetType(db, actor, assetTypeId, legacyText) {
  if (assetTypeId) {
    const found = db.prepare('SELECT * FROM asset_types WHERE id=?').get(assetTypeId);
    if (!found) {
      throw new HttpError(400, '资产类别不存在：' + assetTypeId, { code: 'FIXED_ASSET_TYPE_NOT_FOUND' });
    }
    if (found.status !== 'ACTIVE') {
      throw new HttpError(409, '资产类别已停用：' + found.code, { code: 'FIXED_ASSET_TYPE_INACTIVE' });
    }
    return found;
  }
  const text = String(legacyText ?? '').trim();
  if (!text) {
    throw new HttpError(400, '请填写资产类别', { code: 'FIXED_ASSET_TYPE_REQUIRED' });
  }
  const existing = db.prepare('SELECT * FROM asset_types WHERE code=? OR name=?').get(text, text);
  if (existing) return existing;
  const typeId = id();
  db.prepare(
    'INSERT INTO asset_types(id,code,name,useful_life_months,status,created_at) VALUES(?,?,?,?,?,?)',
  ).run(typeId, text, text, null, 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'ASSET_TYPE', typeId, '按历史资产类别自动登记字典项 ' + text);
  return db.prepare('SELECT * FROM asset_types WHERE id=?').get(typeId);
}

function ensureAssetLocation(db, actor, locationId, legacyText) {
  if (locationId) {
    const found = db.prepare('SELECT * FROM asset_locations WHERE id=?').get(locationId);
    if (!found) {
      throw new HttpError(400, '资产位置不存在：' + locationId, { code: 'FIXED_ASSET_LOCATION_NOT_FOUND' });
    }
    if (found.status !== 'ACTIVE') {
      throw new HttpError(409, '资产位置已停用：' + found.code, { code: 'FIXED_ASSET_LOCATION_INACTIVE' });
    }
    return found;
  }
  const text = String(legacyText ?? '').trim();
  if (!text) return null;
  const existing = db.prepare('SELECT * FROM asset_locations WHERE code=? OR name=?').get(text, text);
  if (existing) return existing;
  const location = id();
  db.prepare('INSERT INTO asset_locations(id,code,name,status,created_at) VALUES(?,?,?,?,?)')
    .run(location, text, text, 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'ASSET_LOCATION', location, '按历史资产位置自动登记字典项 ' + text);
  return db.prepare('SELECT * FROM asset_locations WHERE id=?').get(location);
}

function ensurePolicy(db, actor, { assetCode, policyId, method, serviceYears, residualCents, originalCents }) {
  if (policyId) {
    const policy = db.prepare('SELECT * FROM depreciation_policies WHERE id=?').get(policyId);
    if (!policy) {
      throw new HttpError(400, '折旧政策不存在：' + policyId, { code: 'FIXED_ASSET_POLICY_NOT_FOUND' });
    }
    if (policy.status !== 'ACTIVE') {
      throw new HttpError(409, '折旧政策已停用：' + policy.code, { code: 'FIXED_ASSET_POLICY_INACTIVE' });
    }
    return policy;
  }
  const methodCode = DEPRECIATION_METHODS.includes(String(method || '').toUpperCase())
    ? String(method).toUpperCase()
    : 'STRAIGHT_LINE';
  const years = Number.isSafeInteger(Number(serviceYears)) && Number(serviceYears) > 0
    ? Number(serviceYears)
    : 5;
  const lifeMonths = years * 12;
  const residual = Number(residualCents || 0);
  const basis = Number(originalCents || 0);
  const residualRateBp = basis > 0 ? Math.round((residual / basis) * 10000) : 0;
  const code = 'AUTO-' + assetCode;
  const existing = db.prepare('SELECT * FROM depreciation_policies WHERE code=?').get(code);
  if (existing) return existing;
  const policy = id();
  db.prepare(
    `INSERT INTO depreciation_policies(id,code,name,method,useful_life_months,residual_rate_bp,start_rule,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(policy, code, '自动派生折旧政策 ' + assetCode, methodCode, lifeMonths, residualRateBp, 'FROM_PURCHASE', 'ACTIVE', nowIso());
  audit(db, actor.id, 'CREATE', 'DEPRECIATION_POLICY', policy, '按历史资产参数派生折旧政策 ' + code);
  return db.prepare('SELECT * FROM depreciation_policies WHERE id=?').get(policy);
}

function cardSnapshot(asset) {
  return {
    asset_code: asset.asset_code,
    asset_name: asset.asset_name,
    asset_type_id: asset.asset_type_id,
    location_id: asset.location_id,
    policy_id: asset.policy_id,
    custodian_user_id: asset.custodian_user_id,
    original_value_cents: originalValueCents(asset),
    residual_value_cents: Number(asset.residual_value_cents || 0),
    service_years: Number(asset.service_years || 0),
    depreciation_method: asset.depreciation_method,
    card_status: cardStatus(asset),
  };
}

/**
 * Insert one asset card.
 *
 * The column list and the value list are kept side by side and the helper
 * fails loudly when they drift apart: a silent mismatch would either shift
 * every later column or truncate the card, which is exactly the kind of
 * corruption the fixed-asset ledger must never accept.
 */
function insertAssetCard(db, columns, values) {
  if (columns.length !== values.length) {
    throw new Error(`fixed asset card insert mismatch: ${columns.length} columns / ${values.length} values`);
  }
  const sql = `INSERT INTO fixed_assets(${columns.join(', ')}) VALUES(${columns.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...values);
}

async function createAsset(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const assetCode = requiredText(body.asset_code, '资产编号', 50);
  const assetName = requiredText(body.asset_name, '资产名称', 100);
  if (db.prepare('SELECT 1 FROM fixed_assets WHERE asset_code=?').get(assetCode)) {
    throw new HttpError(409, '资产编号已存在：' + assetCode, { code: 'FIXED_ASSET_CODE_EXISTS' });
  }

  // The legacy contract posts `purchase_amount` / `residual_value` in yuan.
  // The new contract posts integer cents. Both are accepted; cents win.
  const originalCents = body.original_value_cents !== undefined && body.original_value_cents !== null
    ? requiredCents(body.original_value_cents, '资产原值')
    : requiredCents(Math.round(Number(body.purchase_amount || 0) * 100), '资产原值');
  const residualCents = body.residual_value_cents !== undefined && body.residual_value_cents !== null
    ? requiredCents(body.residual_value_cents, '残值')
    : requiredCents(Math.round(Number(body.residual_value || 0) * 100), '残值');
  if (residualCents > originalCents) {
    throw new HttpError(400, '残值不能大于资产原值', { code: 'FIXED_ASSET_RESIDUAL_EXCEEDS_ORIGINAL' });
  }

  const type = ensureAssetType(db, actor, body.asset_type_id, body.asset_type);
  const location = ensureAssetLocation(db, actor, body.location_id, body.location);
  const policy = ensurePolicy(db, actor, {
    assetCode,
    policyId: body.policy_id,
    method: body.depreciation_method,
    serviceYears: body.service_years,
    residualCents,
    originalCents,
  });

  const assetId = id();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(
      `INSERT INTO fixed_assets(
         id, asset_code, asset_name, asset_type, spec, unit, purchase_date, purchase_amount_cents,
         service_years, depreciation_method, residual_value_cents, accumulated_depreciation_cents,
         net_value_cents, status, location, custodian, remark, creator_id, created_at, updated_at,
         card_no, asset_type_id, location_id, policy_id, card_status, custodian_user_id, source_type,
         source_id, original_value_cents, book_value_cents, activated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      assetId,
      assetCode,
      assetName,
      type.code,
      body.spec || '',
      body.unit || '台',
      body.purchase_date || null,
      originalCents,
      Math.max(1, Math.round(policy.useful_life_months / 12)),
      policy.method,
      residualCents,
      originalCents - residualCents,
      LEGACY_STATUS_BY_CARD.DRAFT,
      location?.name || body.location || '',
      body.custodian || '',
      body.remark || '',
      actor.id,
      now,
      now,
      assetCode,
      type.id,
      location?.id || null,
      policy.id,
      'DRAFT',
      body.custodian_user_id || null,
      body.source_type || 'MANUAL',
      body.source_id || null,
      originalCents,
      originalCents - residualCents,
      null,
    );
    audit(db, actor.id, 'CREATE', 'FIXED_ASSET', assetId, '建立资产卡片 ' + assetCode + '（草稿）');
  });

  return send(res, 201, { id: assetId });
}

async function updateAsset(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  const body = await readJson(req);
  const now = nowIso();
  const depreciated = accumulatedCents(asset) > 0;
  const status = cardStatus(asset);

  const wantsValueChange = body.purchase_amount !== undefined
    || body.original_value_cents !== undefined
    || body.service_years !== undefined
    || body.depreciation_method !== undefined
    || body.residual_value !== undefined
    || body.residual_value_cents !== undefined
    || body.policy_id !== undefined
    || body.asset_type_id !== undefined;

  if (depreciated && wantsValueChange) {
    throw new HttpError(409, '资产已计提折旧，价值类变更必须走变更单审批', {
      code: 'FIXED_ASSET_CHANGE_REQUIRES_REQUEST',
    });
  }
  if (status !== 'DRAFT' && !depreciated && wantsValueChange) {
    throw new HttpError(409, '资产已生效，价值类变更必须走变更单审批', {
      code: 'FIXED_ASSET_CHANGE_REQUIRES_REQUEST',
    });
  }
  if (status === 'DRAFT' && wantsValueChange) {
    throw new HttpError(409, '草稿资产的价值变更必须通过变更单受控生效', {
      code: 'FIXED_ASSET_CHANGE_REQUIRES_REQUEST',
    });
  }

  transaction(db, () => {
    const nextType = body.asset_type_id !== undefined
      ? ensureAssetType(db, actor, body.asset_type_id, null)
      : null;
    const nextLocation = body.location_id !== undefined
      ? ensureAssetLocation(db, actor, body.location_id, null)
      : null;
    const nextPolicy = body.policy_id !== undefined
      ? ensurePolicy(db, actor, { assetCode: asset.asset_code, policyId: body.policy_id })
      : null;

    const originalCents = body.original_value_cents !== undefined
      ? requiredCents(body.original_value_cents, '资产原值')
      : (body.purchase_amount !== undefined
        ? requiredCents(Math.round(Number(body.purchase_amount || 0) * 100), '资产原值')
        : originalValueCents(asset));
    const residualCents = body.residual_value_cents !== undefined
      ? requiredCents(body.residual_value_cents, '残值')
      : (body.residual_value !== undefined
        ? requiredCents(Math.round(Number(body.residual_value || 0) * 100), '残值')
        : Number(asset.residual_value_cents || 0));
    if (residualCents > originalCents) {
      throw new HttpError(400, '残值不能大于资产原值', { code: 'FIXED_ASSET_RESIDUAL_EXCEEDS_ORIGINAL' });
    }

    const legacyStatus = body.status && ['IN_USE', 'IDLE', 'DISPOSED', 'SCRAPPED'].includes(body.status)
      ? body.status
      : asset.status;
    const nextCardStatus = body.card_status && ASSET_CARD_STATUSES.includes(body.card_status)
      ? body.card_status
      : status;
    if (nextCardStatus !== status && nextCardStatus !== 'IDLE' && nextCardStatus !== 'ACTIVE') {
      throw new HttpError(409, '该状态只能通过受控流程流转', { code: 'FIXED_ASSET_STATUS_TRANSITION_INVALID' });
    }

    db.prepare(
      `UPDATE fixed_assets SET asset_name=?, asset_type=?, spec=?, unit=?, purchase_date=?,
         purchase_amount_cents=?, service_years=?, depreciation_method=?, residual_value_cents=?,
         net_value_cents=?, status=?, location=?, custodian=?, remark=?, updated_at=?,
         asset_type_id=?, location_id=?, policy_id=?, card_status=?, custodian_user_id=?,
         original_value_cents=?, book_value_cents=?
       WHERE id=?`,
    ).run(
      body.asset_name !== undefined ? requiredText(body.asset_name, '资产名称', 100) : asset.asset_name,
      nextType ? nextType.code : asset.asset_type,
      body.spec !== undefined ? body.spec : asset.spec,
      body.unit !== undefined ? body.unit : asset.unit,
      body.purchase_date !== undefined ? body.purchase_date : asset.purchase_date,
      originalCents,
      nextPolicy ? nextPolicy.useful_life_months / 12 : asset.service_years,
      nextPolicy ? nextPolicy.method : asset.depreciation_method,
      residualCents,
      originalCents - residualCents - accumulatedCents(asset),
      legacyStatus,
      nextLocation ? nextLocation.name : (body.location !== undefined ? body.location : asset.location),
      body.custodian !== undefined ? body.custodian : asset.custodian,
      body.remark !== undefined ? body.remark : asset.remark,
      now,
      nextType ? nextType.id : asset.asset_type_id,
      nextLocation ? nextLocation.id : asset.location_id,
      nextPolicy ? nextPolicy.id : asset.policy_id,
      nextCardStatus,
      body.custodian_user_id !== undefined ? body.custodian_user_id : asset.custodian_user_id,
      originalCents,
      originalCents - residualCents - accumulatedCents(asset),
      assetId,
    );
    audit(db, actor.id, 'UPDATE', 'FIXED_ASSET', assetId, '更新固定资产 ' + asset.asset_code);
  });

  return send(res, 200, { success: true });
}

// ---------------------------------------------------------------------------
// Purchase transfer (AA-W5.4..AA-W5.6)
// ---------------------------------------------------------------------------

async function transferFromReceipt(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const receiptId = requiredText(body.receipt_id, '采购收货单', 64);
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (!receipt) {
    throw new HttpError(404, '采购收货单不存在', { code: 'PURCHASE_RECEIPT_NOT_FOUND' });
  }
  if (receipt.status !== 'CONFIRMED') {
    throw new HttpError(409, '只有已确认的采购收货单可以转固', { code: 'PURCHASE_RECEIPT_NOT_CONFIRMED' });
  }
  const already = db.prepare(
    "SELECT asset_code FROM fixed_assets WHERE source_type='PURCHASE_RECEIPT' AND source_id=?",
  ).get(receiptId);
  if (already) {
    throw new HttpError(409, '该采购收货单已转固，不能重复转固', {
      code: 'FIXED_ASSET_ALREADY_TRANSFERRED',
    });
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    throw new HttpError(400, '请选择需要转固的收货明细', { code: 'FIXED_ASSET_TRANSFER_LINES_REQUIRED' });
  }

  const receiptItems = db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=?').all(receiptId);
  const itemById = new Map(receiptItems.map((item) => [item.id, item]));

  const prepared = [];
  for (const line of lines) {
    const itemId = requiredText(line.item_id, '收货明细', 64);
    const item = itemById.get(itemId);
    if (!item) {
      throw new HttpError(400, '收货明细不属于该采购收货单：' + itemId, {
        code: 'FIXED_ASSET_TRANSFER_ITEM_INVALID',
      });
    }
    const assetCode = requiredText(line.asset_code, '资产编号', 50);
    if (db.prepare('SELECT 1 FROM fixed_assets WHERE asset_code=?').get(assetCode)) {
      throw new HttpError(409, '资产编号已存在：' + assetCode, { code: 'FIXED_ASSET_CODE_EXISTS' });
    }
    // The amount is taken from the authoritative receipt line. A caller may
    // not provide or override it.
    if (line.amount_cents !== undefined || line.purchase_amount !== undefined) {
      throw new HttpError(400, '转固金额必须取自采购收货单，不能由调用方提供', {
        code: 'FIXED_ASSET_TRANSFER_AMOUNT_NOT_ALLOWED',
      });
    }
    // The asset category is taken from the authoritative product master when
    // the caller does not point at a dictionary entry. The card still ends up
    // referencing a dictionary entity (AA-W5.1).
    const product = db.prepare('SELECT category FROM products WHERE id=?').get(item.product_id);
    const type = ensureAssetType(db, actor, line.asset_type_id, line.asset_type || product?.category);
    const location = ensureAssetLocation(db, actor, line.location_id, line.location);
    const policy = ensurePolicy(db, actor, {
      assetCode,
      policyId: line.policy_id,
      method: line.depreciation_method,
      serviceYears: line.service_years,
      residualCents: 0,
      originalCents: Number(item.amount_cents || 0),
    });
    prepared.push({
      item,
      assetCode,
      assetName: requiredText(line.asset_name || item.product_id, '资产名称', 100),
      type,
      location,
      policy,
      originalCents: Number(item.amount_cents || 0),
      custodianUserId: line.custodian_user_id || null,
      remark: line.remark || '',
      unit: line.unit || '台',
      spec: line.spec || '',
    });
  }

  const created = transaction(db, () => {
    const results = [];
    for (const entry of prepared) {
      const assetId = id();
      const now = nowIso();
      db.prepare(
        `INSERT INTO fixed_assets(
           id, asset_code, asset_name, asset_type, spec, unit, purchase_date, purchase_amount_cents,
           service_years, depreciation_method, residual_value_cents, accumulated_depreciation_cents,
           net_value_cents, status, location, custodian, remark, creator_id, created_at, updated_at,
           card_no, asset_type_id, location_id, policy_id, card_status, custodian_user_id,
           source_type, source_id, original_value_cents, book_value_cents, activated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        assetId,
        entry.assetCode,
        entry.assetName,
        entry.type.code,
        entry.spec,
        entry.unit,
        receipt.receipt_date || null,
        entry.originalCents,
        Math.max(1, Math.round(entry.policy.useful_life_months / 12)),
        entry.policy.method,
        0,
        entry.originalCents,
        LEGACY_STATUS_BY_CARD.DRAFT,
        entry.location?.name || '',
        '',
        entry.remark,
        actor.id,
        now,
        now,
        entry.assetCode,
        entry.type.id,
        entry.location?.id || null,
        entry.policy.id,
        'DRAFT',
        entry.custodianUserId,
        'PURCHASE_RECEIPT',
        receiptId,
        entry.originalCents,
        entry.originalCents,
        null,
      );
      audit(db, actor.id, 'CREATE', 'FIXED_ASSET', assetId, '采购转固建立资产卡片 ' + entry.assetCode);
      db.prepare(
        "UPDATE fixed_assets SET card_status='ACTIVE', status=?, activated_at=?, updated_at=? WHERE id=?",
      ).run(LEGACY_STATUS_BY_CARD.ACTIVE, now, now, assetId);
      audit(db, actor.id, 'ACTIVATE', 'FIXED_ASSET', assetId, '资产卡片生效 ' + entry.assetCode);
      results.push({ id: assetId, asset_code: entry.assetCode, item_id: entry.item.id });
    }
    return results;
  });

  return send(res, 201, { assets: created, receipt_id: receiptId });
}

// ---------------------------------------------------------------------------
// Controlled change requests (AA-W5.7 / AA-W5.8)
// ---------------------------------------------------------------------------

function changeRequestSnapshot(body) {
  const snapshot = {};
  for (const key of ['location_id', 'custodian_user_id', 'original_value_cents', 'policy_id', 'asset_type_id']) {
    if (body[key] !== undefined) snapshot[key] = body[key];
  }
  if (snapshot.original_value_cents !== undefined) {
    snapshot.original_value_cents = requiredCents(snapshot.original_value_cents, '变更后原值');
  }
  return snapshot;
}

async function createChangeRequest(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  const body = await readJson(req);
  const changeType = requiredText(body.change_type, '变更类型', 20).toUpperCase();
  if (!CHANGE_TYPES.includes(changeType)) {
    throw new HttpError(400, '变更类型非法：' + changeType, { code: 'FIXED_ASSET_CHANGE_TYPE_INVALID' });
  }
  const reason = requiredText(body.reason, '变更原因', 200);
  const after = changeRequestSnapshot(body);
  if (!Object.keys(after).length) {
    throw new HttpError(400, '变更单必须包含变更后取值', { code: 'FIXED_ASSET_CHANGE_EMPTY' });
  }
  if (after.original_value_cents !== undefined && after.original_value_cents < originalValueCents(asset) - accumulatedCents(asset)) {
    throw new HttpError(409, '变更后净值不能为负', { code: 'FIXED_ASSET_CHANGE_NEGATIVE_BOOK_VALUE' });
  }

  const requestId = id();
  const now = nowIso();
  const requestNo = 'CR-' + Date.now() + '-' + requestId.slice(0, 6);
  transaction(db, () => {
    db.prepare(
      `INSERT INTO asset_change_requests(id,asset_id,request_no,change_type,status,before_json,after_json,reason,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      requestId,
      assetId,
      requestNo,
      changeType,
      'DRAFT',
      JSON.stringify(cardSnapshot(asset)),
      JSON.stringify(after),
      reason,
      now,
    );
    audit(db, actor.id, 'CREATE', 'ASSET_CHANGE_REQUEST', requestId, '发起资产变更单 ' + requestNo);
  });
  return send(res, 201, { id: requestId, request_no: requestNo, status: 'DRAFT' });
}

async function submitChangeRequest(db, req, res, actor, requestId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const request = db.prepare('SELECT * FROM asset_change_requests WHERE id=?').get(requestId);
  if (!request) throw new HttpError(404, '变更单不存在', { code: 'FIXED_ASSET_CHANGE_REQUEST_NOT_FOUND' });
  if (request.status !== 'DRAFT') {
    throw new HttpError(409, '变更单当前状态不可提交：' + request.status, { code: 'FIXED_ASSET_CHANGE_STATUS_INVALID' });
  }
  const now = nowIso();
  db.prepare("UPDATE asset_change_requests SET status='SUBMITTED', submitted_by=?, submitted_at=? WHERE id=?")
    .run(actor.id, now, requestId);
  audit(db, actor.id, 'SUBMIT', 'ASSET_CHANGE_REQUEST', requestId, '提交资产变更单 ' + request.request_no);
  return send(res, 200, { id: requestId, status: 'SUBMITTED' });
}

async function approveChangeRequest(db, req, res, actor, requestId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const request = db.prepare('SELECT * FROM asset_change_requests WHERE id=?').get(requestId);
  if (!request) throw new HttpError(404, '变更单不存在', { code: 'FIXED_ASSET_CHANGE_REQUEST_NOT_FOUND' });
  if (request.status !== 'SUBMITTED') {
    throw new HttpError(409, '变更单当前状态不可审核：' + request.status, { code: 'FIXED_ASSET_CHANGE_STATUS_INVALID' });
  }
  if (request.submitted_by && request.submitted_by === actor.id) {
    throw new HttpError(409, '变更单审核人不得是制单人', { code: 'FIXED_ASSET_CHANGE_SOD_VIOLATION' });
  }
  const body = await readJson(req);
  const action = String(body.action || 'APPROVE').toUpperCase();
  const now = nowIso();

  if (action === 'REJECT') {
    const reason = requiredText(body.reason || request.reason, '驳回原因', 200);
    db.prepare("UPDATE asset_change_requests SET status='REJECTED', approved_by=?, approved_at=? WHERE id=?")
      .run(actor.id, now, requestId);
    audit(db, actor.id, 'REJECT', 'ASSET_CHANGE_REQUEST', requestId, '驳回资产变更单 ' + request.request_no + '：' + reason);
    return send(res, 200, { id: requestId, status: 'REJECTED' });
  }
  if (action !== 'APPROVE') {
    throw new HttpError(400, '审核动作非法：' + action, { code: 'FIXED_ASSET_CHANGE_ACTION_INVALID' });
  }

  const asset = loadAsset(db, request.asset_id);
  assertNotDisposed(asset);
  const after = JSON.parse(request.after_json || '{}');
  const before = JSON.parse(request.before_json || '{}');

  transaction(db, () => {
    const originalCents = after.original_value_cents !== undefined
      ? Number(after.original_value_cents)
      : originalValueCents(asset);
    const nextType = after.asset_type_id ? ensureAssetType(db, actor, after.asset_type_id, null) : null;
    const nextLocation = after.location_id ? ensureAssetLocation(db, actor, after.location_id, null) : null;
    const nextPolicy = after.policy_id ? ensurePolicy(db, actor, { assetCode: asset.asset_code, policyId: after.policy_id }) : null;
    const accumulated = accumulatedCents(asset);
    db.prepare(
      `UPDATE fixed_assets SET asset_type_id=?, location_id=?, policy_id=?, custodian_user_id=?,
         original_value_cents=?, purchase_amount_cents=?, book_value_cents=?, net_value_cents=?,
         asset_type=?, location=?, service_years=?, depreciation_method=?, updated_at=?
       WHERE id=?`,
    ).run(
      nextType ? nextType.id : asset.asset_type_id,
      nextLocation ? nextLocation.id : asset.location_id,
      nextPolicy ? nextPolicy.id : asset.policy_id,
      after.custodian_user_id !== undefined ? after.custodian_user_id : asset.custodian_user_id,
      originalCents,
      originalCents,
      originalCents - accumulated,
      originalCents - accumulated,
      nextType ? nextType.code : asset.asset_type,
      nextLocation ? nextLocation.name : asset.location,
      nextPolicy ? Math.max(1, Math.round(nextPolicy.useful_life_months / 12)) : asset.service_years,
      nextPolicy ? nextPolicy.method : asset.depreciation_method,
      now,
      asset.id,
    );
    db.prepare("UPDATE asset_change_requests SET status='EFFECTIVE', approved_by=?, approved_at=? WHERE id=?")
      .run(actor.id, now, requestId);
    audit(db, actor.id, 'APPROVE', 'ASSET_CHANGE_REQUEST', requestId,
      '资产变更单生效 ' + request.request_no + '：' + JSON.stringify({ before, after }));
    audit(db, actor.id, 'UPDATE', 'FIXED_ASSET', asset.id, '按变更单 ' + request.request_no + ' 更新资产卡片');
  });

  return send(res, 200, { id: requestId, status: 'EFFECTIVE' });
}

// ---------------------------------------------------------------------------
// Split / merge (AA-W5.9 / AA-W5.10)
// ---------------------------------------------------------------------------

async function splitAsset(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  const body = await readJson(req);
  const reason = requiredText(body.reason, '拆分原因', 200);
  const targets = Array.isArray(body.targets) ? body.targets : [];
  if (targets.length < 2) {
    throw new HttpError(400, '拆分至少需要两个目标卡片', { code: 'FIXED_ASSET_SPLIT_TARGETS_REQUIRED' });
  }

  const beforeValue = originalValueCents(asset);
  const beforeAccumulated = accumulatedCents(asset);
  const prepared = targets.map((target) => ({
    assetCode: requiredText(target.asset_code, '资产编号', 50),
    assetName: requiredText(target.asset_name || asset.asset_name, '资产名称', 100),
    originalCents: requiredCents(target.original_value_cents, '拆分后原值'),
    type: target.asset_type_id ? ensureAssetType(db, actor, target.asset_type_id, null) : null,
    location: target.location_id ? ensureAssetLocation(db, actor, target.location_id, null) : null,
    policyId: target.policy_id || asset.policy_id,
  }));

  const totalAfter = prepared.reduce((sum, target) => sum + target.originalCents, 0);
  if (totalAfter !== beforeValue) {
    throw new HttpError(409, '拆分不满足价值守恒：拆分后合计必须等于拆分前原值', {
      code: 'FIXED_ASSET_VALUE_NOT_BALANCED',
    });
  }

  const created = transaction(db, () => {
    const now = nowIso();
    const results = [];
    let allocated = 0;
    for (let index = 0; index < prepared.length; index += 1) {
      const target = prepared[index];
      const isLast = index === prepared.length - 1;
      const share = isLast
        ? beforeAccumulated - allocated
        : Math.floor((beforeAccumulated * target.originalCents) / beforeValue);
      allocated += share;
      const targetId = index === 0 ? asset.id : id();
      if (index === 0) {
        db.prepare(
          `UPDATE fixed_assets SET asset_code=?, asset_name=?, original_value_cents=?, purchase_amount_cents=?,
             accumulated_depreciation_cents=?, net_value_cents=?, book_value_cents=?, asset_type_id=?,
             location_id=?, policy_id=?, updated_at=? WHERE id=?`,
        ).run(
          target.assetCode,
          target.assetName,
          target.originalCents,
          target.originalCents,
          share,
          target.originalCents - share,
          target.originalCents - share,
          target.type ? target.type.id : asset.asset_type_id,
          target.location ? target.location.id : asset.location_id,
          target.policyId,
          now,
          targetId,
        );
      } else {
        db.prepare(
          `INSERT INTO fixed_assets(
             id, asset_code, asset_name, asset_type, spec, unit, purchase_date, purchase_amount_cents,
             service_years, depreciation_method, residual_value_cents, accumulated_depreciation_cents,
             net_value_cents, status, location, custodian, remark, creator_id, created_at, updated_at,
             card_no, asset_type_id, location_id, policy_id, card_status, custodian_user_id,
             source_type, source_id, original_value_cents, book_value_cents, activated_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          targetId,
          target.assetCode,
          target.assetName,
          asset.asset_type,
          asset.spec,
          asset.unit,
          asset.purchase_date,
          target.originalCents,
          asset.service_years,
          asset.depreciation_method,
          asset.residual_value_cents,
          share,
          target.originalCents - share,
          LEGACY_STATUS_BY_CARD.ACTIVE,
          asset.location,
          asset.custodian,
          '由 ' + asset.asset_code + ' 拆分产生',
          actor.id,
          now,
          now,
          target.assetCode,
          target.type ? target.type.id : asset.asset_type_id,
          target.location ? target.location.id : asset.location_id,
          target.policyId,
          cardStatus(asset),
          asset.custodian_user_id,
          asset.source_type,
          asset.source_id,
          target.originalCents,
          target.originalCents - share,
          asset.activated_at,
        );
      }
      audit(db, actor.id, 'SPLIT', 'FIXED_ASSET', targetId, '资产拆分：' + asset.asset_code + ' → ' + target.assetCode);
      results.push({ id: targetId, asset_code: target.assetCode, original_value_cents: target.originalCents });
    }
    db.prepare(
      `INSERT INTO asset_split_merge_records(id,asset_id,action,status,before_json,after_json,before_value_cents,after_value_cents,reason,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id(), assetId, 'SPLIT', 'EFFECTIVE',
      JSON.stringify({ asset_code: asset.asset_code, original_value_cents: beforeValue, accumulated_depreciation_cents: beforeAccumulated }),
      JSON.stringify(results),
      beforeValue, totalAfter, reason, actor.id, now,
    );
    return results;
  });

  return send(res, 201, { assets: created });
}

async function mergeAssets(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const targetAssetId = requiredText(body.target_asset_id, '合并目标资产', 64);
  const reason = requiredText(body.reason, '合并原因', 200);
  const sourceIds = Array.isArray(body.asset_ids) ? body.asset_ids.map(String) : [];
  if (!sourceIds.length) {
    throw new HttpError(400, '合并必须指定待合并资产', { code: 'FIXED_ASSET_MERGE_SOURCES_REQUIRED' });
  }
  const target = loadAsset(db, targetAssetId);
  assertNotDisposed(target);
  const sources = sourceIds.map((sourceId) => loadAsset(db, sourceId));
  for (const source of sources) {
    if (source.id === target.id) {
      throw new HttpError(400, '合并目标不能同时作为待合并资产', { code: 'FIXED_ASSET_MERGE_TARGET_INVALID' });
    }
    assertNotDisposed(source);
  }

  const beforeValue = originalValueCents(target) + sources.reduce((sum, source) => sum + originalValueCents(source), 0);
  const beforeAccumulated = accumulatedCents(target) + sources.reduce((sum, source) => sum + accumulatedCents(source), 0);

  const merged = transaction(db, () => {
    const now = nowIso();
    db.prepare(
      `UPDATE fixed_assets SET original_value_cents=?, purchase_amount_cents=?, accumulated_depreciation_cents=?,
         net_value_cents=?, book_value_cents=?, updated_at=? WHERE id=?`,
    ).run(beforeValue, beforeValue, beforeAccumulated, beforeValue - beforeAccumulated, beforeValue - beforeAccumulated, now, target.id);
    for (const source of sources) {
      db.prepare(
        `UPDATE fixed_assets SET card_status='IDLE', status=?, original_value_cents=0, purchase_amount_cents=0,
           accumulated_depreciation_cents=0, net_value_cents=0, book_value_cents=0,
           remark=?, updated_at=? WHERE id=?`,
      ).run(LEGACY_STATUS_BY_CARD.IDLE, '已合并至资产卡片 ' + target.asset_code, now, source.id);
      audit(db, actor.id, 'MERGE', 'FIXED_ASSET', source.id, '资产合并至 ' + target.asset_code);
    }
    db.prepare(
      `INSERT INTO asset_split_merge_records(id,asset_id,action,status,before_json,after_json,before_value_cents,after_value_cents,reason,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id(), target.id, 'MERGE', 'EFFECTIVE',
      JSON.stringify({
        target: { asset_code: target.asset_code, original_value_cents: originalValueCents(target) },
        sources: sources.map((source) => ({ id: source.id, asset_code: source.asset_code, original_value_cents: originalValueCents(source) })),
      }),
      JSON.stringify({ asset_code: target.asset_code, original_value_cents: beforeValue, accumulated_depreciation_cents: beforeAccumulated }),
      beforeValue, beforeValue, reason, actor.id, now,
    );
    audit(db, actor.id, 'MERGE', 'FIXED_ASSET', target.id, '资产合并完成 ' + target.asset_code);
    return { id: target.id, asset_code: target.asset_code, original_value_cents: beforeValue };
  });

  return send(res, 201, { asset: merged });
}

// ---------------------------------------------------------------------------
// Loans and stocktakes (AA-W5.11 / AA-W5.12)
// ---------------------------------------------------------------------------

async function createLoan(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  const body = await readJson(req);
  const borrowerUserId = requiredText(body.borrower_user_id, '借用人', 64);
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(borrowerUserId)) {
    throw new HttpError(400, '借用人不存在：' + borrowerUserId, { code: 'FIXED_ASSET_BORROWER_NOT_FOUND' });
  }
  const open = db.prepare("SELECT 1 FROM asset_loans WHERE asset_id=? AND status<>'RETURNED'").get(assetId);
  if (open) {
    throw new HttpError(409, '该资产存在未归还的借用记录', { code: 'FIXED_ASSET_LOAN_OPEN' });
  }
  const loanId = id();
  const now = nowIso();
  const loanNo = 'LN-' + Date.now() + '-' + loanId.slice(0, 6);
  transaction(db, () => {
    db.prepare(
      `INSERT INTO asset_loans(id,asset_id,loan_no,borrower_user_id,status,loaned_at,due_at,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(
      loanId,
      assetId,
      loanNo,
      borrowerUserId,
      'OPEN',
      now,
      body.due_at || null,
      now,
    );
    audit(db, actor.id, 'CREATE', 'ASSET_LOAN', loanId, '资产借出 ' + asset.asset_code + ' → ' + borrowerUserId);
  });
  return send(res, 201, { id: loanId, loan_no: loanNo, status: 'OPEN' });
}

async function returnLoan(db, req, res, actor, loanId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const loan = db.prepare('SELECT * FROM asset_loans WHERE id=?').get(loanId);
  if (!loan) throw new HttpError(404, '借用记录不存在', { code: 'FIXED_ASSET_LOAN_NOT_FOUND' });
  if (loan.status === 'RETURNED') {
    throw new HttpError(409, '借用记录已归还', { code: 'FIXED_ASSET_LOAN_ALREADY_RETURNED' });
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE asset_loans SET status='RETURNED', returned_at=? WHERE id=?").run(now, loanId);
    audit(db, actor.id, 'RETURN', 'ASSET_LOAN', loanId, '资产归还 ' + loan.loan_no);
  });
  return send(res, 200, { id: loanId, status: 'RETURNED' });
}

async function createStocktake(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const period = requiredPeriod(body.period, '盘点期间');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    throw new HttpError(400, '盘点单必须包含盘点明细', { code: 'FIXED_ASSET_STOCKTAKE_ITEMS_REQUIRED' });
  }
  const stocktakeId = id();
  const now = nowIso();
  const stocktakeNo = 'ST-' + Date.now() + '-' + stocktakeId.slice(0, 6);
  transaction(db, () => {
    db.prepare(
      'INSERT INTO asset_stocktakes(id,stocktake_no,period,status,created_by,created_at) VALUES(?,?,?,?,?,?)',
    ).run(stocktakeId, stocktakeNo, period, 'DRAFT', actor.id, now);
    for (const item of items) {
      const assetId = requiredText(item.asset_id, '资产', 64);
      const asset = loadAsset(db, assetId);
      db.prepare(
        `INSERT INTO asset_stocktake_items(id,stocktake_id,asset_id,book_location_id,actual_location_id,book_custodian_id,actual_custodian_id,difference_type,status)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(
        id(),
        stocktakeId,
        assetId,
        asset.location_id,
        item.actual_location_id || null,
        asset.custodian_user_id,
        item.actual_custodian_id || null,
        null,
        'PENDING',
      );
    }
    audit(db, actor.id, 'CREATE', 'ASSET_STOCKTAKE', stocktakeId, '建立盘点单 ' + stocktakeNo);
  });
  return send(res, 201, { id: stocktakeId, stocktake_no: stocktakeNo, status: 'DRAFT' });
}

async function completeStocktake(db, req, res, actor, stocktakeId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const stocktake = db.prepare('SELECT * FROM asset_stocktakes WHERE id=?').get(stocktakeId);
  if (!stocktake) throw new HttpError(404, '盘点单不存在', { code: 'FIXED_ASSET_STOCKTAKE_NOT_FOUND' });
  if (stocktake.status !== 'DRAFT') {
    throw new HttpError(409, '盘点单当前状态不可完成：' + stocktake.status, { code: 'FIXED_ASSET_STOCKTAKE_STATUS_INVALID' });
  }
  const body = await readJson(req);
  const items = db.prepare('SELECT * FROM asset_stocktake_items WHERE stocktake_id=?').all(stocktakeId);
  const reported = new Map((Array.isArray(body.items) ? body.items : []).map((item) => [String(item.id), item]));

  const differences = [];
  transaction(db, () => {
    const now = nowIso();
    for (const item of items) {
      const report = reported.get(String(item.id)) || {};
      const actualLocation = report.actual_location_id !== undefined ? report.actual_location_id : item.actual_location_id;
      const actualCustodian = report.actual_custodian_id !== undefined ? report.actual_custodian_id : item.actual_custodian_id;
      let differenceType = null;
      if (!actualLocation && !actualCustodian) differenceType = 'MISSING';
      else if (actualLocation && item.book_location_id && actualLocation !== item.book_location_id) differenceType = 'LOCATION_MISMATCH';
      else if (actualCustodian && item.book_custodian_id && actualCustodian !== item.book_custodian_id) differenceType = 'CUSTODIAN_MISMATCH';
      db.prepare(
        `UPDATE asset_stocktake_items SET actual_location_id=?, actual_custodian_id=?, difference_type=?, status=?, handled_at=?, handled_by=? WHERE id=?`,
      ).run(
        actualLocation ?? null,
        actualCustodian ?? null,
        differenceType,
        differenceType ? 'DIFFERENCE' : 'MATCHED',
        differenceType ? now : null,
        differenceType ? actor.id : null,
        item.id,
      );
      if (differenceType) differences.push({ id: item.id, asset_id: item.asset_id, difference_type: differenceType });
    }
    db.prepare("UPDATE asset_stocktakes SET status='COMPLETED', completed_at=? WHERE id=?").run(now, stocktakeId);
    audit(db, actor.id, 'COMPLETE', 'ASSET_STOCKTAKE', stocktakeId,
      '盘点完成 ' + stocktake.stocktake_no + '，差异 ' + differences.length + ' 项');
  });
  return send(res, 200, { id: stocktakeId, status: 'COMPLETED', differences });
}

// ---------------------------------------------------------------------------
// Depreciation (AA-W5.13..AA-W5.16)
// ---------------------------------------------------------------------------

function effectivePolicy(asset, policy) {
  if (policy) return policy;
  const method = DEPRECIATION_METHODS.includes(String(asset.depreciation_method || '').toUpperCase())
    ? String(asset.depreciation_method).toUpperCase()
    : 'STRAIGHT_LINE';
  const years = Number(asset.service_years || 5);
  return {
    id: null,
    code: 'LEGACY-' + asset.asset_code,
    method,
    useful_life_months: Math.max(1, Math.round(years * 12)),
    residual_rate_bp: 0,
    start_rule: 'FROM_PURCHASE',
    status: 'ACTIVE',
  };
}

function residualFor(asset, policy) {
  const cardResidual = Number(asset.residual_value_cents || 0);
  if (cardResidual > 0) return cardResidual;
  const original = originalValueCents(asset);
  return Math.floor((original * Number(policy.residual_rate_bp || 0)) / 10000);
}

function depreciationVoucherEntries(db, amountCents, summary) {
  const expense = subjectForRole(db, 'DEPRECIATION_EXPENSE');
  const accumulated = subjectForRole(db, 'ACCUMULATED_DEPRECIATION');
  return [
    { subjectId: expense.id, direction: 'DEBIT', amountCents, summary },
    { subjectId: accumulated.id, direction: 'CREDIT', amountCents, summary },
  ];
}

/**
 * Write the depreciation run header.
 *
 * The run table carries a UNIQUE(period) key, so the row is written with an
 * explicit select-then-write instead of an upsert: the SQLite and MySQL
 * adapters do not share an upsert dialect and the domain must stay portable.
 */
function writeDepreciationRun(db, { runId, period, status, totalCents, voucherId, startedAt, finishedAt, actorId }) {
  const existing = db.prepare('SELECT id FROM asset_depreciation_runs WHERE period=?').get(period);
  if (existing) {
    db.prepare(
      `UPDATE asset_depreciation_runs SET status=?, total_cents=?, voucher_id=?, started_at=?, finished_at=?, created_by=? WHERE id=?`,
    ).run(status, totalCents, voucherId ?? null, startedAt, finishedAt ?? null, actorId, existing.id);
    return existing.id;
  }
  db.prepare(
    'INSERT INTO asset_depreciation_runs(id,period,status,total_cents,voucher_id,started_at,finished_at,created_by) VALUES(?,?,?,?,?,?,?,?)',
  ).run(runId, period, status, totalCents, voucherId ?? null, startedAt, finishedAt ?? null, actorId);
  return runId;
}

async function runDepreciationForPeriod(db, res, actor, period) {
  const existing = db.prepare('SELECT * FROM asset_depreciation_runs WHERE period=?').get(period);
  if (existing && existing.status === 'COMPLETED') {
    return send(res, 200, { id: existing.id, run: existing, idempotent: true, depreciations: [] });
  }

  const runId = existing?.id || id();
  const now = nowIso();
  const assets = db.prepare("SELECT * FROM fixed_assets WHERE card_status='ACTIVE'").all();

  const planned = [];
  const failures = [];
  for (const asset of assets) {
    try {
      const policy = effectivePolicy(asset, resolvePolicy(db, asset));
      const calc = computePeriodDepreciation(db, asset, policy, period);
      if (calc.amountCents <= 0) continue;
      planned.push({ asset, policy, calc });
    } catch (error) {
      failures.push({
        asset_id: asset.id,
        asset_code: asset.asset_code,
        code: error.code || 'FIXED_ASSET_DEPRECIATION_FAILED',
        message: error.message,
      });
    }
  }

  if (failures.length) {
    transaction(db, () => {
      writeDepreciationRun(db, {
        runId, period, status: 'FAILED', totalCents: 0, startedAt: now, finishedAt: now, actorId: actor.id,
      });
    });
    audit(db, actor.id, 'FAIL', 'ASSET_DEPRECIATION_RUN', runId, '折旧计提失败：' + JSON.stringify(failures));
    throw new HttpError(409, '折旧计提失败，未落任何折旧数据', {
      code: 'FIXED_ASSET_DEPRECIATION_FAILED',
      failures,
    });
  }

  let voucherId = null;
  let totalCents = 0;
  try {
    transaction(db, () => {
      writeDepreciationRun(db, {
        runId, period, status: 'RUNNING', totalCents: 0, startedAt: now, finishedAt: null, actorId: actor.id,
      });

      const depreciationDate = periodEnd(period);
      for (const entry of planned) {
        const accumulatedBefore = accumulatedCents(entry.asset);
        const accumulatedAfter = accumulatedBefore + entry.calc.amountCents;
        const bookAfter = originalValueCents(entry.asset) - accumulatedAfter;
        db.prepare(
          `INSERT INTO asset_depreciations(id,asset_id,depreciation_date,depreciation_amount_cents,accumulated_amount_cents,net_value_cents,remark,creator_id,created_at,run_id,policy_id,voucher_id,auto_generated,depreciation_type,period)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,'AUTO',?)`,
        ).run(
          id(),
          entry.asset.id,
          depreciationDate,
          entry.calc.amountCents,
          accumulatedAfter,
          bookAfter,
          '按政策自动计提 ' + entry.policy.code,
          actor.id,
          now,
          runId,
          entry.policy.id,
          null,
          period,
        );
        db.prepare(
          'UPDATE fixed_assets SET accumulated_depreciation_cents=?, net_value_cents=?, book_value_cents=?, updated_at=? WHERE id=?',
        ).run(accumulatedAfter, bookAfter, bookAfter, now, entry.asset.id);
        totalCents += entry.calc.amountCents;
        audit(db, actor.id, 'DEPRECIATE', 'FIXED_ASSET', entry.asset.id,
          '自动计提折旧 ' + entry.asset.asset_code + ' 期间 ' + period);
      }

      if (totalCents > 0) {
        voucherId = createSystemVoucher(db, {
          sourceType: 'FIXED_ASSET_DEPRECIATION_RUN',
          sourceId: runId,
          businessDate: depreciationDate,
          actorId: actor.id,
          remark: '固定资产折旧计提 ' + period,
          entries: depreciationVoucherEntries(db, totalCents, '计提固定资产折旧 ' + period),
        });
      }

      db.prepare(
        'UPDATE asset_depreciation_runs SET status=?, total_cents=?, voucher_id=?, finished_at=? WHERE id=?',
      ).run('COMPLETED', totalCents, voucherId, nowIso(), runId);
    });
  } catch (error) {
    try {
      transaction(db, () => {
        writeDepreciationRun(db, {
          runId, period, status: 'FAILED', totalCents: 0, startedAt: now, finishedAt: nowIso(), actorId: actor.id,
        });
      });
    } catch {
      // The failure record is best effort; the original error is authoritative.
    }
    audit(db, actor.id, 'FAIL', 'ASSET_DEPRECIATION_RUN', runId, '折旧计提失败：' + (error.message || ''));
    throw error;
  }

  const run = db.prepare('SELECT * FROM asset_depreciation_runs WHERE id=?').get(runId);
  const depreciations = db.prepare(
    "SELECT id,asset_id,depreciation_amount_cents,accumulated_amount_cents,net_value_cents,period FROM asset_depreciations WHERE run_id=?",
  ).all(runId);
  return send(res, 201, { id: runId, run, depreciations, voucher_id: voucherId });
}

async function recordDepreciationAdjustment(db, body, res, actor) {
  allow(actor, 'FIXED_ASSET_DEPRECIATE');
  const assetId = requiredText(body.asset_id, '资产', 64);
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  if (cardStatus(asset) !== 'ACTIVE') {
    throw new HttpError(409, '只有在用资产可以计提折旧', { code: 'FIXED_ASSET_NOT_ACTIVE' });
  }
  const amountCents = requiredCents(Math.round(Number(body.depreciation_amount || 0) * 100), '折旧金额');
  if (amountCents <= 0) {
    throw new HttpError(400, '折旧金额必须大于 0', { code: 'FIXED_ASSET_AMOUNT_INVALID' });
  }
  const policy = effectivePolicy(asset, resolvePolicy(db, asset));
  const original = originalValueCents(asset);
  const residual = residualFor(asset, policy);
  const remaining = original - residual - accumulatedCents(asset);
  if (amountCents > remaining) {
    throw new HttpError(409, '折旧金额超过剩余可折旧金额', {
      code: 'FIXED_ASSET_DEPRECIATION_EXCEEDS_REMAINING',
    });
  }

  const reason = String(body.reason || '手工折旧调整').slice(0, 200);
  const depreciationId = id();
  const now = nowIso();
  let voucherId = null;
  transaction(db, () => {
    const accumulatedAfter = accumulatedCents(asset) + amountCents;
    const bookAfter = original - accumulatedAfter;
    db.prepare(
      `INSERT INTO asset_depreciations(id,asset_id,depreciation_date,depreciation_amount_cents,accumulated_amount_cents,net_value_cents,remark,creator_id,created_at,run_id,policy_id,voucher_id,auto_generated,depreciation_type,period)
       VALUES(?,?,?,?,?,?,?,?,?,NULL,?,NULL,0,'ADJUSTMENT',NULL)`,
    ).run(
      depreciationId,
      assetId,
      today(),
      amountCents,
      accumulatedAfter,
      bookAfter,
      reason,
      actor.id,
      now,
      policy.id,
    );
    db.prepare(
      'UPDATE fixed_assets SET accumulated_depreciation_cents=?, net_value_cents=?, book_value_cents=?, updated_at=? WHERE id=?',
    ).run(accumulatedAfter, bookAfter, bookAfter, now, assetId);
    voucherId = createSystemVoucher(db, {
      sourceType: 'FIXED_ASSET_DEPRECIATION_ADJUSTMENT',
      sourceId: depreciationId,
      businessDate: today(),
      actorId: actor.id,
      remark: '固定资产折旧调整 ' + asset.asset_code,
      entries: depreciationVoucherEntries(db, amountCents, '折旧调整 ' + asset.asset_code),
    });
    db.prepare('UPDATE asset_depreciations SET voucher_id=? WHERE id=?').run(voucherId, depreciationId);
    audit(db, actor.id, 'DEPRECIATE', 'FIXED_ASSET', assetId,
      '手工折旧调整 ' + asset.asset_code + '，金额 ' + amountCents + ' 分，原因：' + reason);
  });

  return send(res, 200, { id: depreciationId, voucher_id: voucherId });
}

async function postDepreciation(db, req, res, actor) {
  allow(actor, 'FIXED_ASSET_DEPRECIATE');
  const body = await readJson(req);
  if (body.period) {
    return runDepreciationForPeriod(db, res, actor, requiredPeriod(body.period));
  }
  return recordDepreciationAdjustment(db, body, res, actor);
}

function listDepreciations(db, res, actor, assetId) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  loadAsset(db, assetId);
  const depreciations = db.prepare(
    `SELECT ad.*, COALESCE(u.display_name, u.name) AS creatorName
     FROM asset_depreciations ad LEFT JOIN users u ON u.id = ad.creator_id
     WHERE ad.asset_id = ? ORDER BY ad.depreciation_date DESC, ad.created_at DESC`,
  ).all(assetId);
  return send(res, 200, { depreciations });
}

// ---------------------------------------------------------------------------
// Disposal (AA-W5.17 / AA-W5.18)
// ---------------------------------------------------------------------------

async function createDisposal(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSET_DISPOSE');
  const asset = loadAsset(db, assetId);
  assertNotDisposed(asset);
  const body = await readJson(req);
  const disposalType = requiredText(body.disposal_type, '处置方式', 20).toUpperCase();
  if (!DISPOSAL_TYPES.includes(disposalType)) {
    throw new HttpError(400, '处置方式非法：' + disposalType, { code: 'FIXED_ASSET_DISPOSAL_TYPE_INVALID' });
  }
  const disposalDate = requiredText(body.disposal_date, '处置日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disposalDate)) {
    throw new HttpError(400, '处置日期格式必须为 YYYY-MM-DD', { code: 'FIXED_ASSET_DISPOSAL_DATE_INVALID' });
  }
  const proceedsCents = optionalCents(body.proceeds_cents, '处置价') ?? 0;
  const reason = requiredText(body.reason, '处置原因', 200);

  const disposalId = id();
  const now = nowIso();
  const disposalNo = 'DP-' + Date.now() + '-' + disposalId.slice(0, 6);
  transaction(db, () => {
    db.prepare(
      `INSERT INTO asset_disposals(id,disposal_no,asset_id,disposal_type,status,disposal_date,proceeds_cents,reason,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(disposalId, disposalNo, assetId, disposalType, 'DRAFT', disposalDate, proceedsCents, reason, now);
    db.prepare("UPDATE fixed_assets SET card_status='DISPOSING', status=?, updated_at=? WHERE id=?")
      .run(LEGACY_STATUS_BY_CARD.DISPOSING, now, assetId);
    audit(db, actor.id, 'CREATE', 'ASSET_DISPOSAL', disposalId, '发起资产处置 ' + disposalNo);
    audit(db, actor.id, 'DISPOSING', 'FIXED_ASSET', assetId, '资产进入处置中 ' + asset.asset_code);
  });
  return send(res, 201, { id: disposalId, disposal_no: disposalNo, status: 'DRAFT' });
}

async function submitDisposal(db, req, res, actor, disposalId) {
  allow(actor, 'FIXED_ASSET_DISPOSE');
  const disposal = db.prepare('SELECT * FROM asset_disposals WHERE id=?').get(disposalId);
  if (!disposal) throw new HttpError(404, '处置单不存在', { code: 'FIXED_ASSET_DISPOSAL_NOT_FOUND' });
  if (disposal.status !== 'DRAFT') {
    throw new HttpError(409, '处置单当前状态不可提交：' + disposal.status, { code: 'FIXED_ASSET_DISPOSAL_STATUS_INVALID' });
  }
  const now = nowIso();
  db.prepare("UPDATE asset_disposals SET status='SUBMITTED', submitted_by=?, submitted_at=? WHERE id=?")
    .run(actor.id, now, disposalId);
  audit(db, actor.id, 'SUBMIT', 'ASSET_DISPOSAL', disposalId, '提交资产处置单 ' + disposal.disposal_no);
  return send(res, 200, { id: disposalId, status: 'SUBMITTED' });
}

async function approveDisposal(db, req, res, actor, disposalId) {
  allow(actor, 'FIXED_ASSET_DISPOSE');
  const disposal = db.prepare('SELECT * FROM asset_disposals WHERE id=?').get(disposalId);
  if (!disposal) throw new HttpError(404, '处置单不存在', { code: 'FIXED_ASSET_DISPOSAL_NOT_FOUND' });
  if (disposal.status !== 'SUBMITTED') {
    throw new HttpError(409, '处置单当前状态不可审核：' + disposal.status, { code: 'FIXED_ASSET_DISPOSAL_STATUS_INVALID' });
  }
  if (disposal.submitted_by && disposal.submitted_by === actor.id) {
    throw new HttpError(409, '处置单审核人不得是制单人', { code: 'FIXED_ASSET_DISPOSAL_SOD_VIOLATION' });
  }
  const asset = loadAsset(db, disposal.asset_id);
  if (cardStatus(asset) === 'DISPOSED') {
    throw new HttpError(409, '资产已处置', { code: 'FIXED_ASSET_DISPOSED' });
  }

  const original = originalValueCents(asset);
  const accumulated = accumulatedCents(asset);
  const book = original - accumulated;
  const proceeds = Number(disposal.proceeds_cents || 0);
  const difference = book - proceeds;

  const now = nowIso();
  let voucherId = null;
  transaction(db, () => {
    const entries = [];
    const originalSubject = subjectForRole(db, 'FIXED_ASSET_ORIGINAL');
    const accumulatedSubject = subjectForRole(db, 'ACCUMULATED_DEPRECIATION');
    const gainLossSubject = subjectForRole(db, 'DISPOSAL_GAIN_LOSS');
    if (accumulated > 0) {
      entries.push({ subjectId: accumulatedSubject.id, direction: 'DEBIT', amountCents: accumulated, summary: '转销累计折旧 ' + asset.asset_code });
    }
    if (proceeds > 0) {
      const bank = subjectForRole(db, 'BANK');
      entries.push({ subjectId: bank.id, direction: 'DEBIT', amountCents: proceeds, summary: '处置资产收款 ' + asset.asset_code });
    }
    if (difference > 0) {
      entries.push({ subjectId: gainLossSubject.id, direction: 'DEBIT', amountCents: difference, summary: '处置资产损失 ' + asset.asset_code });
    } else if (difference < 0) {
      entries.push({ subjectId: gainLossSubject.id, direction: 'CREDIT', amountCents: -difference, summary: '处置资产收益 ' + asset.asset_code });
    }
    entries.push({ subjectId: originalSubject.id, direction: 'CREDIT', amountCents: original, summary: '转销固定资产原值 ' + asset.asset_code });

    voucherId = createSystemVoucher(db, {
      sourceType: 'FIXED_ASSET_DISPOSAL',
      sourceId: disposal.id,
      businessDate: disposal.disposal_date,
      actorId: actor.id,
      remark: '固定资产处置 ' + disposal.disposal_no,
      entries,
    });

    db.prepare(
      "UPDATE asset_disposals SET status='POSTED', approved_by=?, approved_at=?, voucher_id=? WHERE id=?",
    ).run(actor.id, now, voucherId, disposal.id);
    db.prepare(
      `UPDATE fixed_assets SET card_status='DISPOSED', status=?, original_value_cents=0, purchase_amount_cents=0,
         accumulated_depreciation_cents=0, net_value_cents=0, book_value_cents=0, disposed_at=?, updated_at=? WHERE id=?`,
    ).run(
      disposal.disposal_type === 'SCRAP' ? 'SCRAPPED' : 'DISPOSED',
      now,
      now,
      asset.id,
    );
    audit(db, actor.id, 'POST', 'ASSET_DISPOSAL', disposal.id, '资产处置过账 ' + disposal.disposal_no);
    audit(db, actor.id, 'DISPOSE', 'FIXED_ASSET', asset.id, '资产已处置 ' + asset.asset_code);
  });

  return send(res, 200, { id: disposal.id, status: 'POSTED', voucher_id: voucherId });
}

export const fixedAssetsHandlers = {
  listAssetTypes,
  createAssetType,
  listAssetLocations,
  createAssetLocation,
  listDepreciationPolicies,
  createDepreciationPolicy,
  updateDepreciationPolicy,
  listAssets,
  createAsset,
  updateAsset,
  transferFromReceipt,
  createChangeRequest,
  submitChangeRequest,
  approveChangeRequest,
  splitAsset,
  mergeAssets,
  createLoan,
  returnLoan,
  createStocktake,
  completeStocktake,
  postDepreciation,
  listDepreciations,
  createDisposal,
  submitDisposal,
  approveDisposal,
};
