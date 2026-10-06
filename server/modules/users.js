// V2 Stage 3 / Wave 3E — User-management domain ownership.
//
// Fifth live production route family migrated using the Wave 1
// route-table dispatch infrastructure (after Wave 3A's warehouses,
// Wave 3B's customers, Wave 3C's suppliers, and Wave 3D's roles).
// This module is the single canonical implementation owner for
// /api/users (GET, POST, PATCH). Authorization, transaction, and
// audit remain at the handler boundary; the route-table only carries
// dispatch and ownership metadata.
//
// The handler bodies and ensureRole helper behavior are textually /
// semantically identical to the previous server/app.js implementation.
// Username is lowercased on create. The hashPassword import comes
// from server/db.js (the canonical implementation shared with the
// db.js seed and all auth/login paths). No DELETE /api/users route
// exists in production; none is introduced here. The updateUser
// session-invalidation SQL
//     DELETE FROM sessions WHERE user_id=?
// stays scoped exactly to its pre-migration condition: another user
// (not the actor) whose password, role, or active flag actually
// changed. The actor's own session is never invalidated.
//
// No /api/users/lookup project-manager candidate lookup exists in
// the active API surface; the helper was removed together with the
// Project Management extension in Core Scope Cleanup.

import { hashPassword, id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError,
  allow,
  assertAllowedFields,
  readJson,
  requiredCode,
  requiredText,
  send,
} from '../lib/http.js';

export function listUsers(db, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const users = db.prepare(`
    SELECT u.id,u.username,u.display_name displayName,u.active,u.created_at createdAt,
           r.id roleId,r.name roleName,r.code roleCode
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at
  `).all().map((user) => ({ ...user, active: Boolean(user.active) }));
  return send(res, 200, { users });
}

export async function createUser(db, req, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['username', 'displayName', 'password', 'roleId']);
  const username = requiredCode(body.username, '登录账号').toLowerCase();
  const displayName = requiredText(body.displayName, '用户姓名', 40);
  const passwordText = requiredText(body.password, '初始密码', 100);
  if (passwordText.length < 6) throw new HttpError(400, '密码至少需要 6 位');
  ensureRole(db, body.roleId);
  const password = hashPassword(passwordText);
  const userId = id();
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)`)
    .run(userId, username, displayName, password.hash, password.salt, body.roleId, new Date().toISOString());
  audit(db, actor.id, 'CREATE', 'USER', userId, username);
  return send(res, 201, { id: userId });
}

export async function updateUser(db, req, res, actor, userId) {
  allow(actor, 'USERS_MANAGE');
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!current) throw new HttpError(404, '用户不存在');
  const body = await readJson(req);
  assertAllowedFields(body, ['displayName', 'password', 'roleId', 'active']);
  const displayName = requiredText(body.displayName ?? current.display_name, '用户姓名', 40);
  const roleId = body.roleId ?? current.role_id;
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new HttpError(400, '启用状态必须为布尔值');
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  ensureRole(db, roleId);
  if (userId === actor.id && !active) throw new HttpError(400, '不能停用当前登录账号');
  transaction(db, () => {
    db.prepare('UPDATE users SET display_name=?,role_id=?,active=? WHERE id=?').run(displayName, roleId, active, userId);
    if (body.password) {
      if (String(body.password).length < 6) throw new HttpError(400, '密码至少需要 6 位');
      const password = hashPassword(String(body.password));
      db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(password.hash, password.salt, userId);
    }
    if (userId !== actor.id && (body.password || roleId !== current.role_id || active !== current.active)) {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    }
    audit(db, actor.id, 'UPDATE', 'USER', userId, displayName);
  });
  return send(res, 200, { ok: true });
}

function ensureRole(db, roleId) {
  if (!db.prepare('SELECT id FROM roles WHERE id=?').get(roleId)) throw new HttpError(400, '角色不存在');
}
