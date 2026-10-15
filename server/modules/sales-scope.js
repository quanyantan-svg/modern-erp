import { HttpError } from '../lib/http.js';
import { resolveSalesParameters } from './sales-parameters.js';

export function actorHas(actor, permission) {
  return actor?.roleCode === 'ADMIN' || actor?.permissions?.includes(permission);
}

export function requireSalesPermission(actor, permission, label = '无权执行该销售操作') {
  if (!actorHas(actor, permission)) throw new HttpError(403, label, { code: 'SALES_PERMISSION_DENIED' });
}

export function activeSalespersonForActor(db, actor) {
  return db.prepare('SELECT * FROM salesperson_profiles WHERE user_id=? AND active=1').get(actor.id) || null;
}

export function assertGroupScope(db, actor, { salesGroupId, businessDate, documentType, write = false }) {
  const params = resolveSalesParameters(db, documentType);
  if (actorHas(actor, 'SALES_CROSS_GROUP')) return;
  const salesperson = activeSalespersonForActor(db, actor);
  if (!salesperson) throw new HttpError(403, '当前用户未关联有效销售员，不能访问销售组单据', { code: 'SALES_GROUP_ACTOR_UNMAPPED' });
  if (!params.salesGroupDataScopeEnabled) {
    throw new HttpError(403, '销售组数据范围未启用，普通用户不得访问组单据', { code: 'SALES_GROUP_SCOPE_DISABLED' });
  }
  const membership = db.prepare(`SELECT m.* FROM salesperson_group_memberships m JOIN sales_groups g ON g.id=m.sales_group_id
    WHERE m.salesperson_id=? AND m.sales_group_id=? AND m.active=1 AND g.active=1 AND m.effective_from<=?
      AND (m.effective_to IS NULL OR m.effective_to>=?)`).get(salesperson.id, salesGroupId, businessDate, businessDate);
  if (!membership) throw new HttpError(403, '单据销售组不在当前用户有效范围内', { code: 'SALES_GROUP_SCOPE_DENIED' });
  if (write && !membership.is_default) {
    const active = db.prepare(`SELECT COUNT(*) count FROM salesperson_group_memberships
      WHERE salesperson_id=? AND active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).get(salesperson.id, businessDate, businessDate);
    if (Number(active.count) === 1) throw new HttpError(409, '唯一有效销售组必须标记为默认组', { code: 'SALES_DEFAULT_GROUP_INVALID' });
  }
  return salesperson;
}

export function currentCommercialExtension(db, customerId, businessDate) {
  const rows = db.prepare(`SELECT * FROM customer_commercial_extensions WHERE customer_id=? AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC`).all(customerId, businessDate, businessDate);
  if (rows.length !== 1) throw new HttpError(409, '客户商业扩展必须唯一有效', { code: 'CUSTOMER_COMMERCIAL_EXTENSION_UNAVAILABLE' });
  return rows[0];
}

export function lockSuffix(db) { return db.dialect === 'mysql' ? ' FOR UPDATE' : ''; }
