import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, readJson, send } from '../lib/http.js';

// ============ Notifications ============

export async function listNotifications(db, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(actor.id);
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  return send(res, 200, { notifications, unreadCount });
}

export async function markNotificationRead(db, req, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const body = await readJson(req);
  const { notificationId } = body;
  if (notificationId) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(notificationId, actor.id);
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(actor.id);
  }
  return send(res, 200, { ok: true });
}

// ============ Approval Workflows ============

export async function listWorkflows(db, res, actor) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const workflows = db.prepare('SELECT w.*, u.name creatorName FROM approval_workflows w LEFT JOIN users u ON u.id=w.creator_id ORDER BY w.created_at DESC').all();
  return send(res, 200, { workflows });
}

export async function createWorkflow(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  const { name, entity_type, steps } = body;
  const now = new Date().toISOString();
  const wfId = id();

  db.prepare('INSERT INTO approval_workflows(id,name,entity_type,steps,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(wfId, name, entity_type, JSON.stringify(steps || []), actor.id, now, now);

  audit(db, actor.id, 'CREATE', 'WORKFLOW', wfId, `创建审批流程 ${name}`);
  return send(res, 200, { id: wfId });
}
