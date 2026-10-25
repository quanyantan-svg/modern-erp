import { HttpError } from '../lib/http.js';
import { actorHas, activeSalespersonForActor } from './sales-scope.js';

// Credit authorization per document.md §14 (AP1-AP4.1) and §15 (AP5), as
// designed in solution.md §36.15. The permission registry is flat: no
// permission implies another, so every capability is checked explicitly.

const AGGREGATE_SCOPE_KEY = '*';

export const CREDIT_READ_MODE = Object.freeze({
  ALL: 'ALL',
  DENY: 'DENY',
  CROSS_GROUP: 'CROSS_GROUP',
  AGGREGATE_PLUS_SELF: 'AGGREGATE_PLUS_SELF',
  AGGREGATE_ONLY: 'AGGREGATE_ONLY',
});

const AGGREGATE_ONLY_PREDICATE = `cp.salesperson_scope_key = '${AGGREGATE_SCOPE_KEY}'`;
const AGGREGATE_PLUS_SELF_PREDICATE =
  `(cp.salesperson_scope_key = '${AGGREGATE_SCOPE_KEY}' OR cp.salesperson_scope_key = ?)`;

const NO_PREDICATE = { predicateSql: '', predicateArgs: [] };
// An AGGREGATE_ONLY actor must still be narrowed to the aggregate scope key;
// emitting no predicate would expose every salesperson sub-limit.
const AGGREGATE_ONLY_SCOPE = { predicateSql: AGGREGATE_ONLY_PREDICATE, predicateArgs: [] };

function scope(mode, selfSalespersonId = null, scope = NO_PREDICATE) {
  return { mode, selfSalespersonId, predicateSql: scope.predicateSql, predicateArgs: scope.predicateArgs };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Self-scope eligibility: canonical actor -> active salesperson profile ->
// at least one active, date-applicable membership in an active group. Losing
// eligibility removes only the self-sub-limit privilege; the customer aggregate
// privilege is granted by CREDIT_VIEW alone.
function resolveSelfSalespersonId(db, actor, businessDate) {
  const salesperson = activeSalespersonForActor(db, actor);
  if (!salesperson || !salesperson.id) return null;
  const date = businessDate || today();
  const membership = db.prepare(`SELECT 1 FROM salesperson_group_memberships m
      JOIN sales_groups g ON g.id = m.sales_group_id
      WHERE m.salesperson_id = ? AND m.active = 1 AND g.active = 1
        AND m.effective_from <= ? AND (m.effective_to IS NULL OR m.effective_to >= ?)
      LIMIT 1`).get(salesperson.id, date, date);
  if (!membership) return null;
  return salesperson.id;
}

// Structural guard: never bind a value that could widen AGGREGATE_PLUS_SELF.
function assertBindableSelfId(selfSalespersonId) {
  if (typeof selfSalespersonId !== 'string' || selfSalespersonId === '') {
    throw new HttpError(500, '信用档案数据范围无法解析', { code: 'CREDIT_SCOPE_SELF_ID_INVALID' });
  }
  if (selfSalespersonId === AGGREGATE_SCOPE_KEY) {
    throw new HttpError(500, '信用档案数据范围无法解析', { code: 'CREDIT_SCOPE_SELF_ID_INVALID' });
  }
  return selfSalespersonId;
}

export function resolveCreditProfileReadScope(db, actor, { businessDate } = {}) {
  if (actor?.roleCode === 'ADMIN') return scope(CREDIT_READ_MODE.ALL);
  if (!actorHas(actor, 'CREDIT_VIEW')) {
    throw new HttpError(403, '没有查看信用档案的权限', { code: 'CREDIT_SCOPE_DENIED' });
  }
  if (actorHas(actor, 'SALES_CROSS_GROUP')) return scope(CREDIT_READ_MODE.CROSS_GROUP);
  const selfSalespersonId = resolveSelfSalespersonId(db, actor, businessDate);
  if (!selfSalespersonId) return scope(CREDIT_READ_MODE.AGGREGATE_ONLY, null, AGGREGATE_ONLY_SCOPE);
  return scope(CREDIT_READ_MODE.AGGREGATE_PLUS_SELF, assertBindableSelfId(selfSalespersonId), {
    predicateSql: AGGREGATE_PLUS_SELF_PREDICATE,
    predicateArgs: [selfSalespersonId],
  });
}

export function requireCreditManagementAuthority(actor) {
  if (actor?.roleCode === 'ADMIN') return;
  if (actorHas(actor, 'CREDIT_MANAGE') && actorHas(actor, 'SALES_CROSS_GROUP')) return;
  throw new HttpError(403, '没有管理信用配置的权限', { code: 'CREDIT_MANAGEMENT_DENIED' });
}

export function requireCreditConfigurationRead(actor) {
  if (actor?.roleCode === 'ADMIN') return;
  if (actorHas(actor, 'CREDIT_VIEW')) return;
  throw new HttpError(403, '没有查看信用配置的权限', { code: 'CREDIT_PERMISSION_DENIED' });
}

// §36.9.3 SC111 — the Credit Check evaluation capability.
export function requireCreditEvaluationAuthority(actor) {
  if (actor?.roleCode === 'ADMIN') return;
  if (actorHas(actor, 'CREDIT_EVALUATE')) return;
  throw new HttpError(403, '没有执行信用检查的权限', { code: 'CREDIT_EVALUATE_DENIED' });
}

// §36.9.3 SC111 — requesting a Credit Special Approval.
export function requireCreditSpecialApprovalRequestAuthority(actor) {
  if (actor?.roleCode === 'ADMIN') return;
  if (actorHas(actor, 'CREDIT_SPECIAL_APPROVE')) return;
  throw new HttpError(403, '没有申请信用特别审批的权限', { code: 'CREDIT_SPECIAL_APPROVAL_DENIED' });
}

// §34.7 P2 / P4 — deciding a Credit Special Approval needs an authority that
// is separate from the request authority, and the granted amount stays
// bounded by the authority ceiling frozen at request time.
export function requireCreditSpecialApprovalDecisionAuthority(actor) {
  if (actor?.roleCode === 'ADMIN') return;
  if (actorHas(actor, 'CREDIT_MANAGE')) return;
  throw new HttpError(403, '没有审批信用特别审批的权限', { code: 'CREDIT_SPECIAL_APPROVAL_DENIED' });
}