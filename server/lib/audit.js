import { id } from '../db.js';
import { HttpError } from './http.js';

/**
 * 写审计。
 *
 * `extra` 是**可选**的结构化证据（Design §32.9）：`businessDate` / `requestId` /
 * `before` / `after`。既有调用点一律不改 —— 缺省时新增列写 NULL，
 * 因此 8 个已冻结域的审计行为完全不变（向后兼容契约）。
 */
export function audit(db, userId, action, entityType, entityId, detail, extra = null) {
  const businessDate = extra?.businessDate ?? null;
  const requestId = extra?.requestId ?? null;
  const beforeJson = extra?.before === undefined || extra?.before === null ? null : JSON.stringify(extra.before);
  const afterJson = extra?.after === undefined || extra?.after === null ? null : JSON.stringify(extra.after);
  db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at,business_date,request_id,before_json,after_json)'
    + ' VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id(), userId ?? null, action, entityType, entityId ?? null, detail ?? '',
      new Date().toISOString(), businessDate, requestId, beforeJson, afterJson,
    );
}

/**
 * 业务门禁拒绝审计（MC-REQ-11 / Active Design §9.2）。
 *
 * 必须在业务事务**之外**调用：事务回滚后拒绝审计行仍需保留。
 * `businessRejectionAudited` 标记保证同一次拒绝只落一条审计。
 */
export function auditBusinessRejection(db, actor, context, error, { onlyCodes = null } = {}) {
  if (!(error instanceof HttpError) || error.status !== 409) return;
  if (error.businessRejectionAudited) return;
  if (onlyCodes && !onlyCodes.includes(error.code)) return;
  audit(
    db,
    actor?.id ?? null,
    'REJECT',
    context.entityType,
    context.entityId ?? null,
    `${context.action} 拒绝：${error.code || 'BUSINESS_RULE_BLOCKED'} ${error.message}`,
  );
  error.businessRejectionAudited = true;
}
