import { id } from '../db.js';
import { HttpError } from './http.js';

export function audit(db, userId, action, entityType, entityId, detail) {
  db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id(), userId ?? null, action, entityType, entityId ?? null, detail ?? '', new Date().toISOString());
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
