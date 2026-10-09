// V21 — Stock Status Master (Domain 5 Closure Wave A).
//
// Frozen by `solution.md §27.11 / §27.45` and `document.md §32.3.1 INV-04`.
//
// Canonical stock-status dimension. Quality owns inspection decision;
// Inventory owns the resulting physical stock status.

import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';

function nowIso() { return new Date().toISOString(); }

function rowToStatus(row) {
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    reservable: Boolean(row.reservable),
    issuable: Boolean(row.issuable),
    shippable: Boolean(row.shippable),
    transferable: Boolean(row.transferable),
    active: Boolean(row.active),
  };
}

export function listStockStatuses(db, res, actor) {
  allowAny(actor, ['STOCK_STATUS_VIEW', 'STOCK_STATUS_MANAGE']);
  const rows = db.prepare(`
    SELECT code, name, reservable, issuable, shippable, transferable, active
      FROM inventory_stock_statuses
     ORDER BY code
  `).all().map(rowToStatus);
  return send(res, 200, { stockStatuses: rows });
}

export async function createStockStatus(db, req, res, actor) {
  allow(actor, 'STOCK_STATUS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['code', 'name', 'reservable', 'issuable', 'shippable', 'transferable']);
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code) throw new HttpError(400, '状态编码必填');
  if (['AVAILABLE', 'INSPECTION', 'QUARANTINE', 'HOLD', 'BLOCKED'].includes(code)) {
    throw new HttpError(409, `${code} 是系统预置状态，不可重复创建`);
  }
  const existing = db.prepare('SELECT code FROM inventory_stock_statuses WHERE code=?').get(code);
  if (existing) throw new HttpError(409, `状态 ${code} 已存在`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_stock_statuses(code, name, reservable, issuable, shippable, transferable, active, created_at)
      VALUES(?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      code,
      String(body.name ?? code).trim(),
      body.reservable ? 1 : 0,
      body.issuable ? 1 : 0,
      body.shippable ? 1 : 0,
      body.transferable ? 1 : 0,
      now,
    );
    audit(db, actor.id, 'CREATE', 'STOCK_STATUS', code, `创建库存状态 ${code}`);
  });
  return send(res, 201, { code, active: true });
}

export async function updateStockStatus(db, req, res, actor, code) {
  allow(actor, 'STOCK_STATUS_MANAGE');
  const target = String(code).toUpperCase();
  const existing = db.prepare('SELECT * FROM inventory_stock_statuses WHERE code=?').get(target);
  if (!existing) throw new HttpError(404, '状态不存在');
  const body = await readJson(req);
  assertAllowedFields(body, ['name', 'active', 'reservable', 'issuable', 'shippable', 'transferable']);
  const name = body.name === undefined ? existing.name : String(body.name ?? existing.name).trim();
  const active = body.active === undefined ? Number(existing.active) : (body.active ? 1 : 0);
  const reservable = body.reservable === undefined ? Number(existing.reservable) : (body.reservable ? 1 : 0);
  const issuable = body.issuable === undefined ? Number(existing.issuable) : (body.issuable ? 1 : 0);
  const shippable = body.shippable === undefined ? Number(existing.shippable) : (body.shippable ? 1 : 0);
  const transferable = body.transferable === undefined ? Number(existing.transferable) : (body.transferable ? 1 : 0);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      UPDATE inventory_stock_statuses SET
        name=?, active=?, reservable=?, issuable=?, shippable=?, transferable=?
      WHERE code=?
    `).run(name, active, reservable, issuable, shippable, transferable, target);
    audit(db, actor.id, 'UPDATE', 'STOCK_STATUS', target, `更新库存状态 ${target}`);
  });
  return send(res, 200, { code: target, active: Boolean(active) });
}