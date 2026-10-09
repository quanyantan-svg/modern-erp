// V21 — Inventory Parameters (Domain 5 Closure Wave A).
//
// Frozen by `solution.md §27.45` and `document.md §32.3.1 INV-01`.
//
// Singleton table `inventory_parameters` (id='DEFAULT'). Provides
// inventory-domain-wide policy surface that MUST NOT be mixed with
// Planning / Finance parameters.

import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';

const NEGATIVE_POLICIES = new Set(['BLOCK', 'ALLOW', 'WARNING']);

function booleanFlag(value, label) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new HttpError(400, `${label} 必须为布尔值`);
}

function enumValue(value, values, label) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!values.has(text)) throw new HttpError(400, `${label} 不正确`);
  return text;
}

function dto(row) {
  return {
    negativeStockPolicy: row.negative_stock_policy,
    lotDefaultStatus: row.lot_default_status,
    serialDefaultStatus: row.serial_default_status,
    stocktakeWindowDays: Number(row.stocktake_window_days),
    enabledAt: row.enabled_at,
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
  };
}

export function getInventoryParameters(db) {
  const row = db.prepare(`SELECT * FROM inventory_parameters WHERE id='DEFAULT'`).get();
  if (!row) throw new HttpError(500, '库存参数尚未初始化');
  return dto(row);
}

export function getInventoryParametersHandler(db, res, actor) {
  allowAny(actor, ['INVENTORY_PARAMETERS_VIEW', 'INVENTORY_PARAMETERS_MANAGE']);
  return send(res, 200, { parameters: getInventoryParameters(db) });
}

export async function updateInventoryParameters(db, req, res, actor) {
  allow(actor, 'INVENTORY_PARAMETERS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, [
    'negativeStockPolicy', 'lotDefaultStatus', 'serialDefaultStatus', 'stocktakeWindowDays',
  ]);
  const before = getInventoryParameters(db);
  const next = {
    negativeStockPolicy: body.negativeStockPolicy === undefined
      ? before.negativeStockPolicy
      : enumValue(body.negativeStockPolicy, NEGATIVE_POLICIES, '负库存策略'),
    lotDefaultStatus: body.lotDefaultStatus === undefined
      ? before.lotDefaultStatus
      : enumValue(body.lotDefaultStatus, new Set(['AVAILABLE', 'INSPECTION', 'QUARANTINE', 'HOLD', 'BLOCKED']), '批次默认状态'),
    serialDefaultStatus: body.serialDefaultStatus === undefined
      ? before.serialDefaultStatus
      : enumValue(body.serialDefaultStatus, new Set(['AVAILABLE', 'INSPECTION', 'QUARANTINE', 'HOLD', 'BLOCKED']), '序列号默认状态'),
    stocktakeWindowDays: body.stocktakeWindowDays === undefined
      ? before.stocktakeWindowDays
      : (() => { const n = Number(body.stocktakeWindowDays); if (!Number.isFinite(n) || n < 0 || n > 365) throw new HttpError(400, '盘点冲突窗口天数须 0–365'); return n; })(),
  };
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`
      UPDATE inventory_parameters SET
        negative_stock_policy=?,
        lot_default_status=?,
        serial_default_status=?,
        stocktake_window_days=?,
        updated_by=?,
        updated_at=?
      WHERE id='DEFAULT'
    `).run(next.negativeStockPolicy, next.lotDefaultStatus, next.serialDefaultStatus, next.stocktakeWindowDays, actor.id, now);
    audit(db, actor.id, 'UPDATE', 'INVENTORY_PARAMETERS', 'DEFAULT', `更新库存参数`);
  });
  return send(res, 200, { parameters: getInventoryParameters(db) });
}

export function markInventoryEnabled(db, actor, enabledAt) {
  const ts = enabledAt ?? new Date().toISOString();
  db.prepare(`UPDATE inventory_parameters SET enabled_at=?, updated_by=?, updated_at=? WHERE id='DEFAULT'`).run(ts, actor.id, ts);
  audit(db, actor.id, 'ENABLE', 'INVENTORY_PARAMETERS', 'DEFAULT', `启用库存 ${ts}`);
}