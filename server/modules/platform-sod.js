// Platform 通用 SOD 引擎 —— 规则求值与规则维护面的**唯一 canonical 实现**。
//
// 设计来源：docs/design/platform.md §32.4；Requirement §36.4。
//
// 本文件提供两件事：
//   1. **判定原语**：规则读取、发起人解析、约束求值、判定记录；
//   2. **规则维护面**：规则 CRUD、族覆盖登记、求值记录、升级待办。
//
// 业务域只应调用 assertApprovalSod，不得自行实现第二份职责分离判定
// （AGENTS.md §6「同一业务原语只允许一个 active canonical implementation」）。
//
// 事务边界上的重要约定：
//   判定记录（sod_evaluations）的**写入责任在调用方**。
//   - PASS：调用方在自己的事务内写入 → 与业务变更一同提交；
//   - REJECT / ESCALATE 触发：业务事务回滚，判定记录必须在**事务之外**补写
//     （recordSodRejectionEvidence），否则拒绝证据会随回滚一起消失
//     （与 auditBusinessRejection 的处置同源）。
//
// 求值一律**失败即拒绝**：无法求值的约束类型不得被当作通过。

import {
  allow, assertAllowedFields, HttpError, optionalText, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { listRoleUserIds } from './platform-workflow-conditions.js';

/** 约束类型。数据库 CHECK 允许 4 种，但只有两种在当前接线点可求值。 */
export const SOD_CONSTRAINT_TYPES = Object.freeze([
  'SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN', 'SAME_DEPARTMENT_FORBIDDEN', 'MIN_APPROVERS',
]);

/**
 * 在当前 schema 下**形式上可求值**的约束类型。
 *
 * 注意与 SOD_CREATABLE_CONSTRAINT_TYPES 的区别：本表回答「引擎能算出结论」，
 * 那张表回答「在当前 7 个审批决策点上算出的结论是否有业务意义」。
 * `MIN_APPROVERS` 形式上可求值，但接线点不提供「已通过人数」，因此不可创建。
 */
export const SOD_EVALUABLE_CONSTRAINT_TYPES = Object.freeze([
  'SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN', 'MIN_APPROVERS',
]);

export const SOD_RESOLUTIONS = Object.freeze(['REJECT', 'ESCALATE']);

/**
 * **可创建的**约束类型。
 *
 * 维护面只能创建这两种 —— 其余两种在本轮的接线点上不可求值，创建出来要么永远
 * 不触发（静默空转），要么按 fail-closed 拒绝该族全部审批（生产地雷）。
 * 两种都不得以「先创建以后再说」的方式进入配置（AGENTS.md §4.4「禁止静默忽略」）。
 */
export const SOD_CREATABLE_CONSTRAINT_TYPES = Object.freeze([
  'SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN',
]);

/** 不可求值的约束类型及其**不可创建的原因**（面向管理员的解释，不是内部术语）。 */
export const SOD_UNCREATABLE_CONSTRAINT_REASONS = Object.freeze({
  SAME_DEPARTMENT_FORBIDDEN:
    '用户与单据都没有部门维度，该约束在引擎里按「求值失败即拒绝」处理，会把该族的全部审批都拒掉。',
  MIN_APPROVERS:
    '7 个审批决策点都是单步审批，接线点没有提供「已通过人数」，该约束不会触发。',
});

/** 已接线的决策动作。只有审批（同意）这一动作接入了 SOD 判定。 */
export const SOD_ACTIONS = Object.freeze(['APPROVE']);

/**
 * 审批族注册表（7 个族）。
 *
 * 这是 Platform 域对「哪些审批族受 SOD 管辖」的**唯一权威声明**，与 §32.4.1 的
 * initiator resolver 注册表一一对应：
 *   - `nativeGuard` —— 该族**既有**的自审批防护（状态码 / 文案 / 位置）。
 *     既有防护在 SOD 之前触发（§32.4.3），因此既有族的拒绝状态码与文案逐字不变；
 *   - `nativeGuard: null` —— 该族此前没有防护，平台层是唯一闸门（生产工单族，PL-DEF-01）。
 *
 * 维护面**只允许**为本表登记的族创建规则：发起人解析器只覆盖这 7 个族，
 * 未登记的族解析不出发起人，求值会按 fail-closed 拒绝 —— 那是一条会拒绝全部
 * 审批却看不出原因的配置。
 */
export const SOD_FAMILY_REGISTRY = Object.freeze([
  {
    businessType: 'SALES_ORDER',
    label: '销售订单',
    table: 'sales_orders',
    noColumn: 'order_no',
    nativeGuard: {
      enforced: true, statusCode: 409, message: '创建人不能审批自己的订单',
      location: 'server/modules/sales-orders.js',
    },
  },
  {
    businessType: 'PURCHASE_ORDER',
    label: '采购订单',
    table: 'purchase_orders',
    noColumn: 'order_no',
    nativeGuard: {
      enforced: true, statusCode: 409, message: '创建人不能审核自己的订单',
      location: 'server/app.js',
    },
  },
  {
    businessType: 'PURCHASE_REQUISITION',
    label: '请购单',
    table: 'purchase_requisitions',
    noColumn: 'requisition_no',
    nativeGuard: {
      enforced: true, statusCode: 409, message: '创建人不能审核自己的请购单',
      location: 'server/modules/planning-documents.js',
    },
  },
  {
    businessType: 'INVENTORY_CHECK',
    label: '库存盘点',
    table: 'inventory_checks',
    noColumn: 'check_no',
    nativeGuard: {
      enforced: true, statusCode: 409, message: '盘点单创建人不能审批自己的单据',
      location: 'server/modules/inventory-stocktake.js',
    },
  },
  {
    businessType: 'ACCOUNTING_VOUCHER',
    label: '记账凭证',
    table: 'accounting_vouchers',
    noColumn: 'voucher_no',
    nativeGuard: {
      enforced: true, statusCode: 403, message: '不能审核自己录入的凭证',
      location: 'server/app.js',
    },
  },
  {
    businessType: 'PRODUCTION_ORDER',
    label: '生产工单',
    table: 'production_orders',
    noColumn: 'order_no',
    nativeGuard: null,
  },
  {
    businessType: 'CREDIT_SPECIAL_APPROVAL',
    label: '信用特别审批',
    table: 'credit_special_approval',
    noColumn: null,
    nativeGuard: {
      enforced: true, statusCode: 409, message: '申请人与审批人必须分离',
      location: 'server/modules/credit-special-approval.js',
    },
  },
]);

const FAMILY_BY_TYPE = new Map(SOD_FAMILY_REGISTRY.map((family) => [family.businessType, family]));

export function listSodFamilyTypes() {
  return SOD_FAMILY_REGISTRY.map((family) => family.businessType);
}

function familyOf(businessType) {
  return FAMILY_BY_TYPE.get(String(businessType)) ?? null;
}

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
      // 升级处置的豁免：升级角色的成员不再受「同角色」约束。
      // 否则当升级角色恰好与发起人同角色时，升级后仍会被同一条规则拦下 —— 死锁。
      if (rule.resolution === 'ESCALATE' && rule.escalate_to_role
        && String(actorRole).toUpperCase() === String(rule.escalate_to_role).toUpperCase()) {
        return { violated: false, evaluable: true, reason: '升级角色成员对同角色约束豁免' };
      }
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
        ruleCode: rule.code,
        constraintType: rule.constraint_type,
        resolution: rule.resolution,
        escalateToRole: rule.escalate_to_role ?? null,
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
 * 断言 SOD 合规（硬断言）：只处理「拒绝」，不实现升级。
 *
 * 新接线点一律使用 assertApprovalSod —— 只有它实现完整的处置语义。
 */
export function assertSodCompliance(db, context) {
  const outcome = evaluateSodCompliance(db, context);
  if (outcome.decision === 'REJECT') {
    const error = new HttpError(409, '职责分离规则不允许本次操作', {
      code: 'PLATFORM_SOD_RULE_VIOLATION',
      ruleCode: outcome.rule?.code ?? null,
    });
    error.sodOutcome = outcome;
    error.sodEvidenceRequired = true;
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
 * 被拒绝时事务回滚，判定记录随之消失 —— 因此拒绝证据必须由调用方在**事务之外**
 * 补写（recordSodRejectionEvidence）。
 *
 * 处置语义：
 *   - PASS      → 判定记录随业务事务一同提交；
 *   - REJECT    → 409 拒绝该决策；
 *   - ESCALATE  → 409 拒绝该决策，并把升级待办交给 escalate_to_role 角色
 *                 （6 个既有族的待办是实时计算的，没有任务行可改派；升级待办由
 *                 平台侧的「升级待办」视图承载）。
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
    error.sodEvidenceRequired = true;
    throw error;
  }
  if (outcome.decision === 'ESCALATE') {
    const escalateToRole = String(outcome.rule?.escalate_to_role || '').trim();
    const error = new HttpError(409, `本次决策须由 ${escalateToRole || '指定角色'} 角色处理`, {
      code: 'PLATFORM_SOD_ESCALATED',
      ruleCode: outcome.rule?.code ?? null,
      escalateToRole: escalateToRole || null,
    });
    error.sodOutcome = outcome;
    error.sodEvidenceRequired = true;
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

/**
 * 事务外的拒绝 / 升级证据补写。
 *
 * 事务回滚后判定记录会随之消失 —— 拒绝证据必须补写，否则「为什么被拒」永远查不到。
 * 由 HTTP 生命周期的中央 catch 调用（回滚之后），因此天然在事务之外。
 *
 * 通用工作流引擎有**自己**的事务外留证路径（recordTaskFailureEvidence），
 * 它的拒绝错误不置 `sodEvidenceRequired`，因此不会被重复补写。
 */
export function recordSodRejectionEvidence(db, actor, error) {
  const outcome = error?.sodOutcome;
  if (!outcome || !Array.isArray(outcome.evaluations) || !outcome.evaluations.length) return false;
  const evaluation = outcome.evaluations.find((entry) => entry.decision === 'ESCALATED')
    ?? outcome.evaluations.find((entry) => entry.decision === 'VIOLATED');
  if (!evaluation) return false;
  writeSodEvaluations(db, [evaluation]);
  const escalated = evaluation.decision === 'ESCALATED';
  audit(
    db,
    actor?.id ?? null,
    escalated ? 'SOD_RULE_ESCALATED' : 'SOD_RULE_VIOLATION',
    evaluation.business_type,
    evaluation.business_id,
    escalated
      ? `职责分离升级：规则 ${readRuleCode(evaluation)} 要求由 ${readEscalateRole(evaluation)} 角色处理`
      : `职责分离拒绝：命中规则 ${readRuleCode(evaluation)}`,
  );
  return true;
}

function parseDetail(evaluation) {
  try {
    return evaluation?.detail_json ? JSON.parse(evaluation.detail_json) : {};
  } catch (_) {
    return {};
  }
}

function readRuleCode(evaluation) {
  return parseDetail(evaluation).ruleCode ?? evaluation?.rule_id ?? '未知规则';
}

function readEscalateRole(evaluation) {
  return parseDetail(evaluation).escalateToRole ?? '未指定角色';
}

// ============================================================================
// 规则维护面（Design §32.1.1「SOD 规则 CRUD」/ §32.4.4）
// ============================================================================

const RULE_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

function nowIso() { return new Date().toISOString(); }

function notFound(message, code) { return new HttpError(404, message, { code }); }
function conflict(message, code) { return new HttpError(409, message, { code }); }

function presentRule(row) {
  const family = familyOf(row.business_type);
  return {
    id: row.id,
    code: row.code,
    businessType: row.business_type,
    businessTypeLabel: family ? family.label : row.business_type,
    action: row.action,
    constraintType: row.constraint_type,
    resolution: row.resolution,
    escalateToRole: row.escalate_to_role ?? null,
    minApprovedCount: row.min_approved_count ?? null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentEvaluation(row) {
  const detail = parseDetail(row);
  const family = familyOf(row.business_type);
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleCode: detail.ruleCode ?? null,
    businessType: row.business_type,
    businessTypeLabel: family ? family.label : row.business_type,
    businessId: row.business_id,
    actorId: row.actor_id,
    decision: row.decision,
    constraintType: detail.constraintType ?? null,
    resolution: detail.resolution ?? null,
    escalateToRole: detail.escalateToRole ?? null,
    reason: detail.reason ?? null,
    initiatorId: detail.initiatorId ?? null,
    actorRole: detail.actorRole ?? null,
    evaluatedAt: row.evaluated_at,
  };
}

/** 校验并归一化一条规则的输入。创建与更新共用同一套判定。 */
function normalizeRuleInput(db, body, { current = null } = {}) {
  const businessType = current
    ? current.business_type
    : requiredCode(body.businessType, '业务类型');
  if (!familyOf(businessType)) {
    throw new HttpError(400, `业务类型 ${businessType} 未登记在审批族注册表中，无法为其配置职责分离规则`, {
      code: 'PLATFORM_SOD_FAMILY_UNKNOWN',
    });
  }

  const action = current ? current.action : (body.action === undefined ? 'APPROVE' : requiredCode(body.action, '决策动作'));
  if (!SOD_ACTIONS.includes(action)) {
    throw new HttpError(400, `决策动作 ${action} 尚未接入职责分离判定，当前只支持 ${SOD_ACTIONS.join(' / ')}`, {
      code: 'PLATFORM_SOD_ACTION_NOT_WIRED',
    });
  }

  const constraintType = current
    ? current.constraint_type
    : requiredCode(body.constraintType, '约束类型');
  if (!SOD_CONSTRAINT_TYPES.includes(constraintType)) {
    throw new HttpError(400, `约束类型 ${constraintType} 无效`);
  }
  if (!SOD_CREATABLE_CONSTRAINT_TYPES.includes(constraintType)) {
    throw new HttpError(
      400,
      `约束类型 ${constraintType} 当前不可求值，无法创建规则。${SOD_UNCREATABLE_CONSTRAINT_REASONS[constraintType]}`,
      { code: 'PLATFORM_SOD_CONSTRAINT_NOT_EVALUABLE' },
    );
  }

  const resolution = current
    ? current.resolution
    : requiredCode(body.resolution, '违规处置');
  if (!SOD_RESOLUTIONS.includes(resolution)) {
    throw new HttpError(400, `违规处置 ${resolution} 无效`);
  }

  let escalateToRole = current ? (current.escalate_to_role ?? null) : null;
  if (!current || body.escalateToRole !== undefined) {
    const raw = body.escalateToRole === undefined || body.escalateToRole === null
      ? ''
      : requiredCode(body.escalateToRole, '升级角色');
    if (resolution === 'ESCALATE') {
      if (!raw) throw new HttpError(400, '升级处置必须指定升级角色', { code: 'PLATFORM_SOD_ESCALATE_ROLE_REQUIRED' });
      const role = db.prepare('SELECT id FROM roles WHERE code=?').get(raw);
      if (!role) {
        throw new HttpError(400, `升级角色 ${raw} 不存在`, { code: 'PLATFORM_SOD_ESCALATE_ROLE_UNKNOWN' });
      }
      escalateToRole = raw;
    } else {
      if (raw) {
        throw new HttpError(400, '拒绝处置不指定升级角色', { code: 'PLATFORM_SOD_ESCALATE_ROLE_NOT_ALLOWED' });
      }
      escalateToRole = null;
    }
  }

  if (body.minApprovedCount !== undefined && body.minApprovedCount !== null) {
    throw new HttpError(400, '当前可创建的约束类型都不使用「已通过人数」阈值', {
      code: 'PLATFORM_SOD_MIN_APPROVERS_NOT_SUPPORTED',
    });
  }

  return { businessType, action, constraintType, resolution, escalateToRole };
}

export async function listSodRules(db, res, actor, url) {
  allow(actor, 'SOD_RULES_VIEW');
  const filters = [];
  const params = [];
  const businessType = url.searchParams.get('businessType');
  if (businessType) {
    filters.push('business_type=?');
    params.push(requiredCode(businessType, '业务类型'));
  }
  const status = url.searchParams.get('status');
  if (status) {
    filters.push('status=?');
    params.push(requiredCode(status, '规则状态'));
  }
  const action = url.searchParams.get('action');
  if (action) {
    filters.push('action=?');
    params.push(requiredCode(action, '决策动作'));
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM sod_rules${where} ORDER BY business_type, code`).all(...params);
  return send(res, 200, { rules: rows.map(presentRule) });
}

export async function getSodRule(db, res, actor, ruleId) {
  allow(actor, 'SOD_RULES_VIEW');
  const row = db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
  if (!row) throw notFound('职责分离规则不存在', 'PLATFORM_SOD_RULE_NOT_FOUND');
  const evaluations = db.prepare(
    'SELECT * FROM sod_evaluations WHERE rule_id=? ORDER BY evaluated_at DESC LIMIT 50',
  ).all(row.id).map(presentEvaluation);
  return send(res, 200, { rule: presentRule(row), evaluations });
}

export async function createSodRule(db, req, res, actor) {
  allow(actor, 'SOD_RULES_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, [
    'code', 'businessType', 'action', 'constraintType', 'resolution', 'escalateToRole', 'status', 'minApprovedCount',
  ]);
  const code = requiredCode(body.code, '规则编码');
  const normalized = normalizeRuleInput(db, body);
  const status = body.status === undefined ? 'ACTIVE' : requiredCode(body.status, '规则状态');
  if (!RULE_STATUSES.includes(status)) throw new HttpError(400, '规则状态无效');

  const row = transaction(db, () => {
    const existing = db.prepare('SELECT id FROM sod_rules WHERE code=?').get(code);
    if (existing) throw conflict('规则编码已存在', 'PLATFORM_SOD_RULE_CODE_CONFLICT');
    const ruleId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO sod_rules(id, code, business_type, action, constraint_type, resolution,'
      + ' escalate_to_role, min_approved_count, status, created_by, created_at, updated_at)'
      + ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      ruleId, code, normalized.businessType, normalized.action, normalized.constraintType,
      normalized.resolution, normalized.escalateToRole, null, status, actor.id, now, now,
    );
    audit(db, actor.id, 'SOD_RULE_CREATE', 'SOD_RULE', ruleId,
      `创建职责分离规则 ${code}：${normalized.businessType} / ${normalized.constraintType} / ${normalized.resolution}`);
    return db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
  });
  return send(res, 201, { rule: presentRule(row) });
}

export async function updateSodRule(db, req, res, actor, ruleId) {
  allow(actor, 'SOD_RULES_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['action', 'constraintType', 'resolution', 'escalateToRole', 'minApprovedCount']);
  const row = transaction(db, () => {
    const current = db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
    if (!current) throw notFound('职责分离规则不存在', 'PLATFORM_SOD_RULE_NOT_FOUND');
    const normalized = normalizeRuleInput(db, body, { current });
    const now = nowIso();
    db.prepare(
      'UPDATE sod_rules SET action=?, constraint_type=?, resolution=?, escalate_to_role=?, updated_at=? WHERE id=?',
    ).run(
      normalized.action, normalized.constraintType, normalized.resolution, normalized.escalateToRole, now, ruleId,
    );
    audit(db, actor.id, 'SOD_RULE_UPDATE', 'SOD_RULE', ruleId,
      `更新职责分离规则 ${current.code}：${normalized.constraintType} / ${normalized.resolution}`);
    return db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
  });
  return send(res, 200, { rule: presentRule(row) });
}

export async function setSodRuleStatus(db, req, res, actor, ruleId) {
  allow(actor, 'SOD_RULES_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['status', 'reason']);
  const status = requiredCode(body.status, '规则状态');
  if (!RULE_STATUSES.includes(status)) throw new HttpError(400, '规则状态无效');
  const row = transaction(db, () => {
    const current = db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
    if (!current) throw notFound('职责分离规则不存在', 'PLATFORM_SOD_RULE_NOT_FOUND');
    db.prepare('UPDATE sod_rules SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), ruleId);
    audit(
      db, actor.id,
      status === 'INACTIVE' ? 'SOD_RULE_DISABLE' : 'SOD_RULE_UPDATE',
      'SOD_RULE', ruleId,
      `职责分离规则 ${current.code} 状态置为 ${status}${body.reason ? `：${optionalText(body.reason, 200)}` : ''}`,
    );
    return db.prepare('SELECT * FROM sod_rules WHERE id=?').get(ruleId);
  });
  return send(res, 200, { rule: presentRule(row) });
}

/**
 * 族覆盖登记（Requirement §36.4「全部 7 个族必须至少被一条规则覆盖或显式登记为
 * 该族无 SOD 约束」）。
 *
 * 覆盖结论只有三种：
 *   - RULE_COVERED  —— 存在生效规则；
 *   - NATIVE_GUARD  —— 平台层无规则，职责分离由既有自审批防护负责（显式登记）；
 *   - UNCOVERED     —— 既无平台规则也无既有防护 —— 这是缺口，不允许出现。
 */
export async function listSodCoverage(db, res, actor) {
  allow(actor, 'SOD_RULES_VIEW');
  const families = SOD_FAMILY_REGISTRY.map((family) => {
    const rules = db.prepare(
      'SELECT * FROM sod_rules WHERE business_type=? ORDER BY code',
    ).all(family.businessType);
    const active = rules.filter((rule) => rule.status === 'ACTIVE');
    let coverage;
    if (active.length) coverage = 'RULE_COVERED';
    else if (family.nativeGuard) coverage = 'NATIVE_GUARD';
    else coverage = 'UNCOVERED';
    return {
      businessType: family.businessType,
      label: family.label,
      coverage,
      ruleCount: rules.length,
      activeRuleCount: active.length,
      rules: rules.map(presentRule),
      nativeGuard: family.nativeGuard,
      note: coverage === 'RULE_COVERED'
        ? (family.nativeGuard
          ? '平台规则生效；该族的自审批由既有防护先行拦截，平台层是第二道闸门。'
          : '平台规则是该族唯一的职责分离闸门。')
        : (coverage === 'NATIVE_GUARD'
          ? '该族无平台职责分离规则，职责分离由既有自审批防护负责。'
          : '该族既无平台规则也无既有防护 —— 职责分离缺口。'),
    };
  });
  return send(res, 200, {
    families,
    creatable: {
      constraintTypes: SOD_CREATABLE_CONSTRAINT_TYPES,
      uncreatableConstraintReasons: SOD_UNCREATABLE_CONSTRAINT_REASONS,
      resolutions: SOD_RESOLUTIONS,
      actions: SOD_ACTIONS,
      businessTypes: listSodFamilyTypes(),
    },
  });
}

export async function listSodEvaluations(db, res, actor, url) {
  allow(actor, 'SOD_RULES_VIEW');
  const filters = [];
  const params = [];
  const businessType = url.searchParams.get('businessType');
  if (businessType) {
    filters.push('business_type=?');
    params.push(requiredCode(businessType, '业务类型'));
  }
  const decision = url.searchParams.get('decision');
  if (decision) {
    filters.push('decision=?');
    params.push(requiredCode(decision, '判定结果'));
  }
  const businessId = url.searchParams.get('businessId');
  if (businessId) {
    filters.push('business_id=?');
    params.push(requiredText(businessId, '业务对象', 128));
  }
  const actorId = url.searchParams.get('actorId');
  if (actorId) {
    filters.push('actor_id=?');
    params.push(requiredText(actorId, '操作人', 128));
  }
  const requestedLimit = Number(url.searchParams.get('limit') || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 500)) : 100;
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM sod_evaluations${where} ORDER BY evaluated_at DESC, id DESC LIMIT ?`,
  ).all(...params, limit);
  return send(res, 200, { evaluations: rows.map(presentEvaluation) });
}

/** 升级角色下的启用成员（角色→成员的解析复用参与人解析的 canonical 实现）。 */
function listEscalationMembers(db, roleCode) {
  const ids = listRoleUserIds(db, roleCode);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, display_name FROM users WHERE id IN (${placeholders}) ORDER BY display_name`).all(...ids);
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

function documentNoOf(db, family, businessId) {
  if (!family || !family.noColumn) return null;
  const row = db.prepare(`SELECT ${family.noColumn} FROM ${family.table} WHERE id=?`).get(businessId);
  return row ? row[family.noColumn] : null;
}

/**
 * 升级待办。
 *
 * 6 个既有审批族的待办是**实时计算**的（server/modules/approvals.js），没有任务行
 * 可以改派；因此升级的载体是平台侧的这份待办：违规的决策被拒绝并留痕后，由
 * `escalate_to_role` 角色的成员接手，走该族**原有的**审批入口完成决策。
 *
 * 「已处理」的判定：该单据在该次升级之后出现了 PASS 判定记录 —— 那是接手人
 * 成功决策的证据（PASS 记录由 assertApprovalSod 在业务事务内写入）。
 */
export async function listSodEscalations(db, res, actor) {
  allow(actor, 'SOD_RULES_VIEW');
  const rows = db.prepare(
    "SELECT * FROM sod_evaluations WHERE decision='ESCALATED' ORDER BY evaluated_at DESC LIMIT 100",
  ).all();
  const items = rows.map((row) => {
    const detail = parseDetail(row);
    const family = familyOf(row.business_type);
    const escalateToRole = detail.escalateToRole ?? null;
    const handled = db.prepare(
      "SELECT COUNT(*) n FROM sod_evaluations WHERE business_type=? AND business_id=? AND decision='PASS' AND evaluated_at>?",
    ).get(row.business_type, row.business_id, row.evaluated_at).n > 0;
    const actor = db.prepare('SELECT display_name FROM users WHERE id=?').get(row.actor_id);
    return {
      key: `${row.business_type}:${row.business_id}`,
      businessType: row.business_type,
      businessTypeLabel: family ? family.label : row.business_type,
      businessId: row.business_id,
      documentNo: documentNoOf(db, family, row.business_id),
      actorId: row.actor_id,
      actorName: actor ? actor.display_name : row.actor_id,
      ruleCode: detail.ruleCode ?? null,
      constraintType: detail.constraintType ?? null,
      escalateToRole,
      escalateMembers: escalateToRole ? listEscalationMembers(db, escalateToRole) : [],
      evaluatedAt: row.evaluated_at,
      handled,
    };
  });
  return send(res, 200, { escalations: items, pendingCount: items.filter((item) => !item.handled).length });
}
