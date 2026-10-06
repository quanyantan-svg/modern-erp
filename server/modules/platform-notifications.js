import { allow, readJson, send } from '../lib/http.js';

export async function listNotifications(db, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(actor.id);
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  return send(res, 200, { notifications, unreadCount });
}

export async function markNotificationRead(db, req, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const { notificationId } = await readJson(req);
  if (notificationId) db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(notificationId, actor.id);
  else db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(actor.id);
  return send(res, 200, { ok: true });
}
