// Platform 通知中心（PL-11）。
//
// 设计来源：docs/design/platform.md §32.7；Requirement §36.7。
//
// 本模块把"通知"从**空壳**变成**有能力的能力**：
//   此前 `notifications` 表存在、读接口存在、前端页面存在，但**全仓库没有任何一处写入**
//   —— 表运行时永远为空，`unreadCount` 恒为 0，通知中心是一个永远显示"暂无通知"的页面。
//
// 四条硬约束：
//   1. **通知是副作用，不得影响业务结果**。生产者在业务事务**提交之后**调用，
//      自身失败只记日志，绝不向上抛。
//   2. **列表与未读计数必须同源同条件**。此前列表 `LIMIT 50` 而计数取全表，二者可以互相矛盾。
//      现在二者共享同一 WHERE，列表走分页，计数是同一条件下的全量未读数。
//   3. **去重**：同一业务事件对同一接收人只产生一条通知（`user_id` + `dedupe_key`）。
//   4. **权限**：读接口用 `NOTIFICATION_VIEW`，**不再**使用 `DASHBOARD_VIEW`
//      （仪表盘可见 ≠ 通知可见）。

import {
  allow, allowAny, assertAllowedFields, HttpError, optionalText, readJson, requiredCode,
  requiredText, send,
} from '../lib/http.js';
import { id } from '../db.js';
import { audit } from '../lib/audit.js';

/** 通知类型白名单（此前是自由文本，无约束）。 */
export const NOTIFICATION_TYPES = Object.freeze(['INFO', 'WARNING', 'SUCCESS', 'ERROR']);

/** 通知优先级白名单。 */
export const NOTIFICATION_PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH']);

/** 接收人类型白名单。 */
export const NOTIFICATION_RECIPIENT_TYPES = Object.freeze(['USER', 'ROLE', 'SUBSCRIBERS']);

function nowIso() { return new Date().toISOString(); }

function presentNotification(row) {
  return {
    id: row.id, userId: row.user_id, title: row.title, content: row.content,
    type: row.type, priority: row.priority, category: row.category,
    sourceType: row.source_type, sourceId: row.source_id, actionUrl: row.action_url,
    isRead: row.is_read, createdAt: row.created_at, expiresAt: row.expires_at,
    eventType: row.event_type, dedupeKey: row.dedupe_key,
  };
}

/**
 * 把接收人描述展开为用户 id 列表。
 * `USER` 直接取用户；`ROLE` 取该角色下**启用**的用户；`SUBSCRIBERS` 取订阅了该
 * (category, event_type) 的用户。
 */
export function expandNotificationRecipients(db, recipients, { category = null, eventType = null } = {}) {
  const users = new Set();
  for (const recipient of recipients || []) {
    if (recipient.type === 'USER') {
      const row = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(String(recipient.value));
      if (row) users.add(row.id);
    } else if (recipient.type === 'ROLE') {
      const rows = db.prepare(
        'SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code=? AND u.active=1',
      ).all(String(recipient.value).toUpperCase());
      for (const row of rows) users.add(row.id);
    } else if (recipient.type === 'SUBSCRIBERS') {
      if (!category || !eventType) continue;
      const rows = db.prepare(
        'SELECT user_id FROM notification_subscriptions WHERE category=? AND event_type=? AND channel=\'IN_APP\'',
      ).all(category, eventType);
      for (const row of rows) {
        const user = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(row.user_id);
        if (user) users.add(user.id);
      }
    }
  }
  return [...users];
}

/**
 * 产生通知。
 *
 * **必须在业务事务提交之后调用**（副作用与业务结果解耦）。
 * 自身失败时只记录，不抛出 —— 通知失败不得使审批失败。
 *
 * @param {object} db
 * @param {{eventType: string, category: string, recipients: Array, title: string, content?: string,
 *   type?: string, priority?: string, sourceType?: string, sourceId?: string, actionUrl?: string,
 *   dedupeKey?: string, expiresAt?: string, businessDate?: string, requestId?: string}} payload
 * @returns {{created: number, skipped: number}} 产生与去重跳过的条数
 */
export function notifyEvent(db, payload) {
  const {
    eventType, category, recipients, title, content = '', type = 'INFO', priority = 'NORMAL',
    sourceType = null, sourceId = null, actionUrl = null, dedupeKey = null, expiresAt = null,
    businessDate = null, requestId = null,
  } = payload || {};
  try {
    if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`未知通知类型: ${type}`);
    if (!NOTIFICATION_PRIORITIES.includes(priority)) throw new Error(`未知通知优先级: ${priority}`);
    const userIds = expandNotificationRecipients(db, recipients, { category, eventType });
    if (!userIds.length) return { created: 0, skipped: 0 };
    let created = 0;
    let skipped = 0;
    /*
     * **不包在显式事务里** —— 通知是尽力而为的副作用，逐条自提交。
     * 两个理由：
     *   1. 通知失败不得牵连业务结果；自带事务会在业务事务之后多开一次 BEGIN，
     *      干扰既有域对"业务事务开启次数"的既有断言（如销售订单提交的重试契约）。
     *   2. 多接收人之间不具备原子性是可接受的 —— 收件人 B 失败不应抹掉收件人 A 已收到的通知。
     * 去重的并发风险由业务侧承担：产生同一通知的业务事件本身已被业务事务串行化。
     */
    for (const userId of userIds) {
      const key = dedupeKey ? `${eventType}:${dedupeKey}:${userId}` : null;
      if (key) {
        const existing = db.prepare(
          'SELECT id FROM notifications WHERE user_id=? AND dedupe_key=?',
        ).get(userId, key);
        if (existing) { skipped += 1; continue; }
      }
      db.prepare(
        'INSERT INTO notifications(id, user_id, title, content, type, source_type, source_id, is_read, created_at,'
        + ' priority, category, action_url, expires_at, dedupe_key, event_type) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)',
      ).run(
        id(), userId, title, content, type, sourceType, sourceId, nowIso(),
        priority, category, actionUrl, expiresAt, key, eventType,
      );
      created += 1;
    }
    if (created) {
      audit(db, null, 'NOTIFY', 'NOTIFICATION', eventType,
        `产生 ${created} 条通知（${category}）`, { businessDate, requestId });
    }
    return { created, skipped };
  } catch (error) {
    // 通知是副作用：失败只记录，绝不向上抛。
    console.error(`[platform-notifications] 通知产生失败 eventType=${eventType}`, error);
    return { created: 0, skipped: 0, failed: true };
  }
}

/**
 * 展开"持有任一权限的启用用户"为接收人。
 *
 * 既有 6 个审批族没有显式审批人 —— 待办由"持有该族审批权限的角色"推导
 * （审批中心 `server/modules/approvals.js` 也是按状态聚合、由权限过滤可见性）。
 */
export function expandApproverRecipients(db, permissionCodes) {
  const codes = (permissionCodes || []).filter(Boolean);
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  return db.prepare(
    'SELECT DISTINCT u.id FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id'
    + ` WHERE rp.permission_code IN (${placeholders}) AND u.active=1 ORDER BY u.id`,
  ).all(...codes).map((row) => row.id);
}

/** 各审批族的审批权限码 —— 待办通知的接收人推导依据。 */
export const APPROVAL_FAMILY_PERMISSIONS = Object.freeze({
  SALES_ORDER: ['ORDERS_APPROVE'],
  PURCHASE_ORDER: ['PURCHASE_ORDERS_APPROVE'],
  PURCHASE_REQUISITION: ['PURCHASE_REQUISITION_APPROVE'],
  INVENTORY_CHECK: ['INVENTORY_CHECK_APPROVE'],
  ACCOUNTING_VOUCHER: ['VOUCHER_APPROVE'],
  PRODUCTION_ORDER: ['PRODUCTION_ORDERS_APPROVE'],
});

/**
 * 待办通知：单据提交待审时通知该族审批人。
 * 在业务事务**提交之后**调用。
 */
export function notifyApprovalPending(db, { family, documentType, documentId, documentNo, title, businessDate = null, requestId = null }) {
  const recipients = expandApproverRecipients(db, APPROVAL_FAMILY_PERMISSIONS[family] || [])
    .map((value) => ({ type: 'USER', value }));
  if (!recipients.length) return { created: 0, skipped: 0 };
  return notifyEvent(db, {
    eventType: 'APPROVAL_PENDING',
    category: `APPROVAL_${family}`,
    recipients,
    title,
    content: `${documentType} ${documentNo} 待审批`,
    type: 'INFO',
    priority: 'NORMAL',
    sourceType: documentType,
    sourceId: documentId,
    dedupeKey: `${family}:${documentId}:PENDING`,
    businessDate,
    requestId,
  });
}

/**
 * 审批结果通知：通知发起人。
 * 在业务事务**提交之后**调用。
 */
export function notifyApprovalHandled(db, {
  family, documentType, documentId, documentNo, initiatorId, outcome, comment = '', businessDate = null, requestId = null,
}) {
  if (!initiatorId) return { created: 0, skipped: 0 };
  const label = outcome === 'APPROVED' ? '已通过' : outcome === 'REJECTED' ? '已被驳回' : '已处理';
  return notifyEvent(db, {
    eventType: 'APPROVAL_HANDLED',
    category: `APPROVAL_${family}`,
    recipients: [{ type: 'USER', value: initiatorId }],
    title: `${documentType} ${documentNo} ${label}`,
    content: comment ? String(comment).slice(0, 500) : `${documentType} ${documentNo} ${label}`,
    type: outcome === 'REJECTED' ? 'WARNING' : 'SUCCESS',
    priority: 'NORMAL',
    sourceType: documentType,
    sourceId: documentId,
    dedupeKey: `${family}:${documentId}:${outcome}`,
    businessDate,
    requestId,
  });
}

/** 列出当前用户的通知（与未读计数同源同条件）。 */
export async function listNotifications(db, res, actor, url) {
  allow(actor, 'NOTIFICATION_VIEW');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0) || 0, 0);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
  const where = unreadOnly ? 'user_id=? AND is_read=0' : 'user_id=?';
  const rows = db.prepare(
    `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(actor.id, limit, offset);
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  const total = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=?').get(actor.id).cnt;
  return send(res, 200, {
    notifications: rows.map(presentNotification),
    unreadCount,
    total,
    limit,
    offset,
  });
}

/** 标记已读：可指定 id；不指定时标记该用户全部已读。 */
export async function markNotificationRead(db, req, res, actor) {
  allow(actor, 'NOTIFICATION_VIEW');
  const body = await readJson(req);
  assertAllowedFields(body, ['notificationId']);
  if (body.notificationId) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(body.notificationId, actor.id);
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(actor.id);
  }
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  return send(res, 200, { ok: true, unreadCount });
}

/** 列出当前用户的订阅。 */
export async function listNotificationSubscriptions(db, res, actor) {
  allow(actor, 'NOTIFICATION_VIEW');
  const rows = db.prepare(
    'SELECT category, event_type, channel, created_at FROM notification_subscriptions WHERE user_id=? ORDER BY category, event_type',
  ).all(actor.id);
  return send(res, 200, {
    subscriptions: rows.map((row) => ({
      category: row.category, eventType: row.event_type, channel: row.channel, createdAt: row.created_at,
    })),
  });
}

/** 新增 / 取消订阅。 */
export async function manageNotificationSubscription(db, req, res, actor) {
  allow(actor, 'NOTIFICATION_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['category', 'eventType', 'subscribed']);
  const category = requiredText(body.category, '订阅分类', 100);
  const eventType = requiredText(body.eventType, '订阅事件', 100);
  const subscribed = body.subscribed !== false;
  if (subscribed) {
    db.prepare(
      "INSERT OR IGNORE INTO notification_subscriptions(user_id, category, event_type, channel, created_at)"
      + " VALUES(?,?,?,'IN_APP',?)",
    ).run(actor.id, category, eventType, nowIso());
  } else {
    db.prepare(
      "DELETE FROM notification_subscriptions WHERE user_id=? AND category=? AND event_type=? AND channel='IN_APP'",
    ).run(actor.id, category, eventType);
  }
  audit(db, actor.id, 'NOTIFICATION_SUBSCRIBE', 'NOTIFICATION', category,
    `${subscribed ? '订阅' : '取消订阅'} ${category}/${eventType}`);
  return send(res, 200, { ok: true, category, eventType, subscribed });
}

/** 平台级未读汇总（管理视角）：每个有未读的用户一行。 */
export async function listNotificationOverview(db, res, actor) {
  allowAny(actor, ['NOTIFICATION_VIEW', 'NOTIFICATION_MANAGE']);
  const rows = db.prepare(
    'SELECT user_id, COUNT(*) unread FROM notifications WHERE is_read=0 GROUP BY user_id ORDER BY unread DESC',
  ).all();
  return send(res, 200, {
    overview: rows.map((row) => ({ userId: row.user_id, unread: row.unread })),
  });
}
