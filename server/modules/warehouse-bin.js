// V21 — Warehouse Bin / Location (Domain 5 Closure Wave A).
//
// Frozen by `solution.md §27.9 / §27.45` and `document.md §32.3.1 INV-03`.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';

function nowIso() { return new Date().toISOString(); }

function rowToBin(row) {
  if (!row) return null;
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    code: row.code,
    name: row.name,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWarehouseBins(db, res, actor, url) {
  allowAny(actor, ['WAREHOUSE_BIN_VIEW', 'WAREHOUSE_BIN_MANAGE']);
  const warehouseId = url.searchParams.get('warehouseId');
  const params = [];
  const where = ['1=1'];
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  const rows = db.prepare(`
    SELECT id, warehouse_id, code, name, active, created_at, updated_at
      FROM warehouse_bins
     WHERE ${where.join(' AND ')}
     ORDER BY warehouse_id, code
  `).all(...params).map(rowToBin);
  return send(res, 200, { bins: rows });
}

export async function createWarehouseBin(db, req, res, actor) {
  allow(actor, 'WAREHOUSE_BIN_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['warehouseId', 'code', 'name']);
  const warehouseId = String(body.warehouseId ?? '').trim();
  const code = String(body.code ?? '').trim();
  if (!warehouseId || !code) throw new HttpError(400, '仓库与仓位编码必填');
  const wh = db.prepare('SELECT id, bin_enabled FROM warehouses WHERE id=?').get(warehouseId);
  if (!wh) throw new HttpError(400, '仓库不存在');
  if (!Number(wh.bin_enabled)) throw new HttpError(409, '该仓库未启用仓位管理');
  const existing = db.prepare('SELECT id FROM warehouse_bins WHERE warehouse_id=? AND code=?').get(warehouseId, code);
  if (existing) throw new HttpError(409, `仓位编码 ${code} 在仓库 ${warehouseId} 已存在`);
  const now = nowIso();
  const binId = genId();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO warehouse_bins(id, warehouse_id, code, name, active, created_at, updated_at)
      VALUES(?, ?, ?, ?, 1, ?, ?)
    `).run(binId, warehouseId, code, String(body.name ?? '').trim(), now, now);
    audit(db, actor.id, 'CREATE', 'WAREHOUSE_BIN', binId, `创建仓位 ${code}（仓库 ${warehouseId}）`);
  });
  return send(res, 201, { id: binId, warehouseId, code, active: true });
}

export async function updateWarehouseBin(db, req, res, actor, binId) {
  allow(actor, 'WAREHOUSE_BIN_MANAGE');
  const existing = db.prepare('SELECT * FROM warehouse_bins WHERE id=?').get(binId);
  if (!existing) throw new HttpError(404, '仓位不存在');
  const body = await readJson(req);
  assertAllowedFields(body, ['name', 'active']);
  const name = body.name === undefined ? existing.name : String(body.name ?? '').trim();
  const active = body.active === undefined ? Number(existing.active) : (body.active ? 1 : 0);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE warehouse_bins SET name=?, active=?, updated_at=? WHERE id=?`).run(name, active, now, binId);
    audit(db, actor.id, 'UPDATE', 'WAREHOUSE_BIN', binId, `更新仓位 ${existing.code}`);
  });
  return send(res, 200, { id: binId, active: Boolean(active) });
}

export function deactivateWarehouseBin(db, res, actor, binId) {
  allow(actor, 'WAREHOUSE_BIN_MANAGE');
  const existing = db.prepare('SELECT * FROM warehouse_bins WHERE id=?').get(binId);
  if (!existing) throw new HttpError(404, '仓位不存在');
  // fail-closed: must have no on_hand in this bin
  const onHand = db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE bin_id=? AND active=1`).get(binId);
  if (Number(onHand?.q || 0) > 0) throw new HttpError(409, '仓位仍有在库量，禁止停用');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE warehouse_bins SET active=0, updated_at=? WHERE id=?`).run(now, binId);
    audit(db, actor.id, 'DEACTIVATE', 'WAREHOUSE_BIN', binId, `停用仓位 ${existing.code}`);
  });
  return send(res, 200, { id: binId, active: false });
}