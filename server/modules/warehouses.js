// V2 Stage 3 / Wave 3A — Warehouse domain ownership.
//
// First live production route family migrated using the Wave 1
// route-table dispatch infrastructure. This module is the single
// canonical implementation owner for /api/warehouses (GET, POST,
// PATCH, DELETE). Authorization, transaction, and audit remain at
// the handler boundary; the route-table only carries dispatch and
// ownership metadata.
//
// The handler bodies are textually/semantically identical to the
// previous server/app.js implementation. Only the lifecycle
// delegation for DELETE was extracted into a thin wrapper so the
// warehouse route family has one coherent owner after migration.

import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError,
  allow,
  allowAny,
  optionalText,
  readJson,
  requiredCode,
  requiredText,
  send,
} from '../lib/http.js';
import { deleteMasterRecord } from './data-lifecycle.js';

export function listWarehouses(db, res, actor, url) {
  allowAny(actor, ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const warehouses = db.prepare(`SELECT id,code,name,address,manager,active,created_at createdAt,updated_at updatedAt FROM warehouses WHERE code LIKE ? OR name LIKE ? ORDER BY code`).all(search, search).map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { warehouses });
}

export async function createWarehouse(db, req, res, actor) {
  allow(actor, 'WAREHOUSES_MANAGE');
  const body = await readJson(req);
  const warehouse = { id: id(), code: requiredCode(body.code, '仓库编码'), name: requiredText(body.name, '仓库名称', 100), address: optionalText(body.address, 200), manager: optionalText(body.manager, 50) };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(warehouse.id, warehouse.code, warehouse.name, warehouse.address, warehouse.manager, now, now);
  audit(db, actor.id, 'CREATE', 'WAREHOUSE', warehouse.id, warehouse.code);
  return send(res, 201, { id: warehouse.id });
}

export async function updateWarehouse(db, req, res, actor, warehouseId) {
  allow(actor, 'WAREHOUSES_MANAGE');
  const current = db.prepare('SELECT * FROM warehouses WHERE id=?').get(warehouseId);
  if (!current) throw new HttpError(404, '仓库不存在');
  const body = await readJson(req);
  const name = requiredText(body.name ?? current.name, '仓库名称', 100);
  const address = optionalText(body.address ?? current.address, 200);
  const manager = optionalText(body.manager ?? current.manager, 50);
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  if (current.active && !active) {
    const stock = db.prepare('SELECT 1 FROM inventory WHERE warehouse_id=? AND quantity<>0 LIMIT 1').get(warehouseId);
    if (stock) throw new HttpError(409, '仓库仍有库存，清零或转移库存后才能停用', { code: 'WAREHOUSE_NOT_EMPTY' });
  }
  db.prepare('UPDATE warehouses SET name=?,address=?,manager=?,active=?,updated_at=? WHERE id=?').run(name, address, manager, active, new Date().toISOString(), warehouseId);
  audit(db, actor.id, 'UPDATE', 'WAREHOUSE', warehouseId, name);
  return send(res, 200, { ok: true });
}

// Thin delegation wrapper. The lifecycle implementation in
// server/modules/data-lifecycle.js owns all canonical delete
// semantics (permission, reference checks, transaction, audit,
// response); this function only re-routes the warehouse route
// family to that single source of truth. No permission check,
// no validation, no transaction, no audit, and no response
// transformation is added here.
export function deleteWarehouse(db, res, actor, warehouseId) {
  return deleteMasterRecord(db, res, actor, 'warehouse', warehouseId);
}
