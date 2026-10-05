// V2 Stage 3 / Wave 3D — Role domain ownership.
//
// Fourth live production route family migrated using the Wave 1
// route-table dispatch infrastructure (after Wave 3A's warehouses,
// Wave 3B's customers, and Wave 3C's suppliers). This module is the
// single canonical implementation owner for /api/roles (GET, POST,
// PATCH). Authorization, transaction, and audit remain at the
// handler boundary; the route-table only carries dispatch and
// ownership metadata.
//
// The handler bodies and helper behavior are textually / semantically
// identical to the previous server/app.js implementation. No DELETE
// route exists for /api/roles; the canonical route family is GET /
// POST / PATCH only.
//
// The PERMISSIONS catalogue is imported from server/db.js and is used
// only by the Roles responsibility (listRoles catalogue projection,
// updateRole ADMIN all-permission invariant, validPermissions
// whitelist). After this wave the catalogue is no longer imported
// directly into server/app.js — its consumers all live here.

import { PERMISSIONS, id, transaction } from '../db.js';
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

export function listRoles(db, res, actor) {
  allowAny(actor, ['USERS_MANAGE', 'ROLES_MANAGE']);
  const roles = db.prepare(`
    SELECT r.*, count(DISTINCT u.id) user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id
    GROUP BY r.id ORDER BY r.system_role DESC, r.name
  `).all().map((role) => ({ ...role, permissions: rolePermissions(db, role.id) }));
  return send(res, 200, { roles, permissions: PERMISSIONS.map(([code, name]) => ({ code, name })) });
}

export async function createRole(db, req, res, actor) {
  allow(actor, 'ROLES_MANAGE');
  const body = await readJson(req);
  const role = {
    id: id(), code: requiredCode(body.code, '角色编码'), name: requiredText(body.name, '角色名称', 40),
    description: optionalText(body.description, 200), permissions: validPermissions(body.permissions)
  };
  transaction(db, () => {
    db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
      .run(role.id, role.code, role.name, role.description, new Date().toISOString());
    saveRolePermissions(db, role.id, role.permissions);
    audit(db, actor.id, 'CREATE', 'ROLE', role.id, role.name);
  });
  return send(res, 201, { id: role.id });
}

export async function updateRole(db, req, res, actor, roleId) {
  allow(actor, 'ROLES_MANAGE');
  const current = db.prepare('SELECT * FROM roles WHERE id=?').get(roleId);
  if (!current) throw new HttpError(404, '角色不存在');
  const body = await readJson(req);
  const name = requiredText(body.name ?? current.name, '角色名称', 40);
  const description = optionalText(body.description ?? current.description, 200);
  const permissions = body.permissions ? validPermissions(body.permissions) : rolePermissions(db, roleId);
  if (current.code === 'ADMIN' && !PERMISSIONS.every(([code]) => permissions.includes(code))) throw new HttpError(400, '系统管理员必须保留全部权限');
  transaction(db, () => {
    db.prepare('UPDATE roles SET name=?,description=? WHERE id=?').run(name, description, roleId);
    saveRolePermissions(db, roleId, permissions);
    audit(db, actor.id, 'UPDATE', 'ROLE', roleId, name);
  });
  return send(res, 200, { ok: true });
}

function rolePermissions(db, roleId) {
  return db.prepare('SELECT permission_code code FROM role_permissions WHERE role_id=? ORDER BY permission_code').all(roleId).map((row) => row.code);
}

function saveRolePermissions(db, roleId, permissions) {
  db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
  const insert = db.prepare('INSERT INTO role_permissions(role_id, permission_code) VALUES(?,?)');
  for (const permission of permissions) insert.run(roleId, permission);
}

function validPermissions(value) {
  if (!Array.isArray(value)) throw new HttpError(400, '权限列表格式不正确');
  const valid = new Set(PERMISSIONS.map(([code]) => code));
  const result = [...new Set(value.map(String))];
  if (result.some((permission) => !valid.has(permission))) throw new HttpError(400, '包含未知权限');
  return result;
}