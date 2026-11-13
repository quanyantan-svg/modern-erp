// Platform 通用 SOD 引擎 —— 规则求值的**唯一 canonical 实现**。
//
// 设计来源：docs/design/platform.md §32.4；Requirement §36.4。
//
// 本文件提供**判定原语**（规则读取、发起人解析、约束求值、判定记录）。
// 规则的维护面（CRUD API 与前端）与既有 6 个审批族的接线在后续单元实现；
// 业务域只应调用 assertSodCompliance，不得自行实现第二份职责分离判定
// （AGENTS.md §6「同一业务原语只允许一个 active canonical implementation」）。
//
// 事务边界上的重要约定：
//   判定记录（sod_evaluations）的**写入责任在调用方**。
//   - PASS / ESCALATE：调用方在自己的事务内写入 → 与业务变更一同提交；
//   - REJECT：业务事务会回滚，判定记录必须在**事务之外**补写，
//     否则拒绝证据会随回滚一起消失（与 auditBusinessRejection 的处置同源）。
//
// 求值一律**失败即拒绝**：无法求值的约束类型不得被当作通过。

import { HttpError } from '../lib/http.js';
import { id } from '../db.js';

/** 约束类型。数据库 CHECK 允许 4 种，但只有前两种在当前 schema 下可求值。 */
export const SOD_CONSTRAINT_TYPES = Object.freeze([
  'SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN', 'SAME_DEPARTMENT_FORBIDDEN', 'MIN_APPROVERS',
]);

/** 在当前 schema 下可求值的约束类型。 */
export const SOD_EVALUABLE_CONSTRAINT_TYPES = Object.freeze([
  'SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN', 'MIN_APPROVERS',
]);

export const SOD_RESOLUTIONS = Object.freeze(['REJECT', 'ESCALATE']);

/**
 * 发起人解析注册表：business_type → (db, businessId) => userId | null。
 *
 * 6 个既有审批族的发起人列统一为 `creator_id`；信用特批的请求人存于 audit_logs。
 * 这张映射表是 **Platform 域的合同**（Design §32.4.1 逐行列明），因此集中登记在
 * Platform 自己的模块里 —— 业务域只提供文档 id，不参与"谁是发起人"的判定。
 */
const initiatorResolvers = new Map();

export function registerSodInitiatorResolver(businessType, resolver) {
  if (typeof resolver !== 'function') throw new TypeError('发起人解析器必须是函数');
  initiatorResolvers.set(String(businessType), resolver);
}

export function listSodInitiatorResolverTypes() {
  return [...initiatorResolvers.keys()].sort();
}

/** 以文档表的 creator_id 作为发起人（既有 6 个审批族的统一形态）。 */
function creatorIdResolver(table) {
  return (db, documentId) => {
    const row = db.prepare(`SELECT creator_id FROM ${table} WHERE id=?`).get(String(documentId));
    return row ? row.creator_id : null;
  };
}

/*
 * Design §32.4.1 的发起人映射表。信用特批的表中**没有请求人列** ——
 * 请求人只存在于 audit_logs（action='REQUEST'），由该模块自己写入。
 */
registerSodInitiatorResolver('SALES_ORDER', creatorIdResolver('sales_orders'));
registerSodInitiatorResolver('PURCHASE_ORDER', creatorIdResolver('purchase_orders'));
registerSodInitiatorResolver('PURCHASE_REQUISITION', creatorIdResolver('purchase_requisitions'));
registerSodInitiatorResolver('INVENTORY_CHECK', creatorIdResolver('inventory_checks'));
registerSodInitiatorResolver('ACCOUNTING_VOUCHER', creatorIdResolver('accounting_vouchers'));
registerSodInitiatorResolver('PRODUCTION_ORDER', creatorIdResolver('production_orders'));
registerSodInitiatorResolver('CREDIT_SPECIAL_APPROVAL', (db, approvalId) => {
  const row = db.prepare(
    "SELECT user_id FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND action='REQUEST'"
    + ' AND id=(SELECT audit_id FROM credit_special_approval WHERE id=?)',
  ).get(String(approvalId));
  return row ? row.user_id : null;
});

function resolveInitiator(db, businessType, businessId) {
  const resolver = initiatorResolvers.get(String(businessType));
  if (!resolver) return null;
  const value = resolver(db, businessId);
  return value ? String(value) : null;
}

function roleCodeOf(db, userId) {
  if (!userId) return null;
  const row = db.prepare(
    'SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?',
  ).get(String(userId));
  return row ? row.code : null;
}

/**
 * 求值一条规则。
 *
 * @returns {{violated: boolean, evaluable: boolean, reason?: string}}
 */
export function evaluateSodRule(rule, context) {
  const { initiatorId, actorId, actorRole, approvedCount } = context;
  switch (rule.constraint_type) {
    case 'SAME_PERSON_FORBIDDEN': {
      // 发起人解析不出来时**失败即拒绝**：静默放行等于没有职责分离。
      if (!initiatorId) return { violated: true, evaluable: false, reason: '无法解析发起人' };
      return { violated: initiatorId === String(actorId), evaluable: true };
    }
    case 'SAME_ROLE_FORBIDDEN': {
      if (!initiatorId) return { violated: false, evaluable: false, reason: '无法解析发起人' };
      const initiatorRole = context.initiatorRole ?? roleCodeOf(context.db, initiatorId);
      if (!initiatorRole || !actorRole) return { violated: false, evaluable: false, reason: '无法解析角色' };
      return { violated: initiatorRole === actorRole, evaluable: true };
    }
    case 'MIN_APPROVERS': {
      if (typeof approvedCount !== 'number') return { violated: false, evaluable: false, reason: '无法解析已通过人数' };
      const required = Number(rule.min_approved_count ?? 1);
      return { violated: approvedCount < required, evaluable: true };
    }
    default:
      // 无法求值的约束类型一律不得被当作通过。
      return { violated: true, evaluable: false, reason: `约束类型不可求值: ${rule.constraint_type}` };
  }
}

/**
 * 求值某业务类型在某动作上的全部生效 SOD 规则。
 *
 * **不写库** —— 写入由调用方按事务边界决定（见文件头约定）。
 *
 * @returns {{decision: 'PASS'|'REJECT'|'ESCALATE', rule: object|null, evaluations: object[]}}
 */
export function evaluateSodCompliance(db, { businessType, businessId, action, actorId, approvedCount = undefined }) {
  const rules = db.prepare(
    "SELECT * FROM sod_rules WHERE business_type=? AND action=? AND status='ACTIVE' ORDER BY code",
  ).all(String(businessType), String(action));
  const evaluations = [];
  if (!rules.length) return { decision: 'PASS', rule: null, evaluations };

  const initiatorId = resolveInitiator(db, businessType, businessId);
  const actorRole = roleCodeOf(db, actorId);
  const context = { db, initiatorId, actorId, actorRole, approvedCount };

  for (const rule of rules) {
    const outcome = evaluateSodRule(rule, context);
    evaluations.push({
      id: id(),
      rule_id: rule.id,
      business_type: String(businessType),
      business_id: String(businessId),
      actor_id: String(actorId),
      decision: outcome.violated ? 'VIOLATED' : 'PASS',
      detail_json: JSON.stringify({
        constraintType: rule.constraint_type,
        resolution: rule.resolution,
        evaluable: outcome.evaluable,
        reason: outcome.reason ?? null,
        initiatorId: initiatorId ?? null,
        actorRole: actorRole ?? null,
      }),
      evaluated_at: new Date().toISOString(),
    });
    if (!outcome.violated) continue;

    if (rule.resolution === 'ESCALATE') {
      const escalated = evaluations.map((evaluation) => (
        evaluation.decision === 'VIOLATED' ? { ...evaluation, decision: 'ESCALATED' } : evaluation
      ));
      return { decision: 'ESCALATE', rule, evaluations: escalated };
    }
    return { decision: 'REJECT', rule, evaluations };
  }
  return { decision: 'PASS', rule: null, evaluations };
}

/**
 * 断言 SOD 合规。不合规时抛出 409，并带上判定记录供调用方在事务外补写。
 */
export function assertSodCompliance(db, context) {
  const outcome = evaluateSodCompliance(db, context);
  if (outcome.decision === 'REJECT') {
    const error = new HttpError(409, '职责分离规则不允许本次操作', {
      code: 'PLATFORM_SOD_RULE_VIOLATION',
      ruleCode: outcome.rule?.code ?? null,
    });
    error.sodOutcome = outcome;
    throw error;
  }
  return outcome;
}

/**
 * 审批决策点的职责分离断言（既有 7 个族的接线入口）。
 *
 * 调用位置约定（Design §32.4.3）：
 *   - **既有自审批防护之后**接入 → 既有防护先抛错并返回，既有族的状态码与文案逐字不变；
 *   - 没有既有防护的族（当前只有 PRODUCTION_ORDER）→ 本函数是唯一闸门。
 *
 * 判定必须在**事务内**进行：权威发起人在事务内从数据库重读，不使用请求方传入的标识。
 * 被拒绝时事务回滚，判定记录随之消失 —— 这与既有 5 族自审批拒绝**不留审计行**的现状一致；
 * 若要为 SOD 拒绝补事务外审计，须按 `auditBusinessRejection` 的模式另行实现。
 *
 * @param {object} db
 * @param {{businessType: string, businessId: string, actorId: string, action?: string, approvedCount?: number}} context
 */
export function assertApprovalSod(db, { businessType, businessId, actorId, action = 'APPROVE', approvedCount = undefined }) {
  const outcome = evaluateSodCompliance(db, { businessType, businessId, action, actorId, approvedCount });
  if (outcome.decision === 'REJECT') {
    const error = new HttpError(409, '职责分离规则不允许本次操作', {
      code: 'PLATFORM_SOD_RULE_VIOLATION',
      ruleCode: outcome.rule?.code ?? null,
    });
    error.sodOutcome = outcome;
    throw error;
  }
  writeSodEvaluations(db, outcome.evaluations);
  return outcome;
}

/** 写入判定记录。调用方决定事务边界。 */
export function writeSodEvaluations(db, evaluations) {
  for (const evaluation of evaluations || []) {
    db.prepare(
      'INSERT INTO sod_evaluations(id, rule_id, business_type, business_id, actor_id, decision, detail_json, evaluated_at)'
      + ' VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      evaluation.id, evaluation.rule_id, evaluation.business_type, evaluation.business_id,
      evaluation.actor_id, evaluation.decision, evaluation.detail_json, evaluation.evaluated_at,
    );
  }
}
