// Platform 通用工作流引擎 —— 9 张表的运行时、状态机、幂等与动作契约。
//
// 设计来源：docs/design/platform.md §32.3（调用与数据流 / 状态机 / 事务与幂等 /
// 错误行为 / 审计 / RBAC）；Requirement §36.3。
//
// 本模块是工作流能力的**唯一 canonical owner**：
//   - 路由全部通过 ownedRouteTable 注册，描述符只带 method / path / handler / owner；
//   - 权限在 handler 入口用 allow / allowAny 判定（fail closed）；
//   - 事务边界在 handler（transaction(db, work)）；
//   - 审计在 handler（同事务写；拒绝类证据在事务外补写）。
//
// 引擎**不重写任何业务域的状态机**：节点动作通过注册式 handler 委托给业务域的
// canonical 入口（AGENTS.md §8「平台能力不得成为第二写入口」）。

import {
  allow, allowAny, assertAllowedFields, HttpError, optionalText, readJson, requiredCode,
  requiredText, send,
} from '../lib/http.js';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  evaluateWorkflowCondition, listRoleUserIds, resolveWorkflowParticipants,
  validateWorkflowCondition, validateWorkflowDefinition, WORKFLOW_BLOCKING_NODE_TYPES,
  WORKFLOW_END_NODE, WORKFLOW_NOTIFYING_NODE_TYPES,
} from './platform-workflow-conditions.js';
import {
  evaluateSodCompliance, registerSodInitiatorResolver, writeSodEvaluations,
} from './platform-sod.js';
import { notifyEvent } from './platform-notifications.js';

const TEMPLATE_STATUS = ['DRAFT', 'PUBLISHED', 'RETIRED'];
const VERSION_STATUS = ['DRAFT', 'PUBLISHED', 'RETIRED'];
const INSTANCE_STATUS = ['RUNNING', 'SUSPENDED', 'COMPLETED', 'TERMINATED', 'CANCELLED'];
const INSTANCE_TERMINAL = new Set(['COMPLETED', 'TERMINATED', 'CANCELLED']);

/** 人工任务可执行的动作。SKIP 属于自动节点，不在此列。 */
export const WORKFLOW_TASK_ACTIONS = Object.freeze(['APPROVE', 'REJECT', 'RETURN', 'TRANSFER', 'ADD_SIGN']);

/** 动作推进语义：哪些动作会推进节点。 */
const ADVANCING_ACTIONS = new Set(['APPROVE', 'REJECT', 'RETURN']);

/*
 * ---------------------------------------------------------------------------
 * 动作契约（WF-06）
 * ---------------------------------------------------------------------------
 * 节点动作通过**注册式 handler** 执行。handler 在业务事务内运行：
 * 抛出即整体回滚，副作用为零。
 *
 * handler 签名：({ db, instance, node, nodeInstance, task, actor, payload, action, definition })
 */
const actionHandlers = new Map();

export function registerWorkflowActionHandler({ type, target = '', handler }) {
  const actionType = String(type || '').trim();
  if (!actionType) throw new TypeError('动作处理器缺少类型');
  if (typeof handler !== 'function') throw new TypeError('动作处理器必须是函数');
  actionHandlers.set(`${actionType}:${String(target || '').trim()}`, handler);
}

function actionHandlerFor(type, target) {
  const key = String(target || '').trim();
  return actionHandlers.get(`${type}:${key}`) || actionHandlers.get(`${type}:`) || null;
}

// 工作流任务 SOD 的发起人 = 实例的启动人。
registerSodInitiatorResolver('WORKFLOW_TASK', (db, taskId) => {
  const row = db.prepare(
    'SELECT i.started_by FROM workflow_tasks t JOIN workflow_instances i ON i.id=t.instance_id WHERE t.id=?',
  ).get(String(taskId));
  return row ? row.started_by : null;
});

function nowIso() { return new Date().toISOString(); }

function notFound(message, code) {
  return new HttpError(404, message, { code });
}

function conflict(message, code) {
  return new HttpError(409, message, { code });
}

function unprocessable(message, code) {
  return new HttpError(422, message, { code });
}

function enumValue(value, values, label) {
  const text = requiredCode(value, label);
  if (!values.includes(text)) throw new HttpError(400, `${label}无效`);
  return text;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { throw new HttpError(422, '内容不是合法 JSON'); }
}

// ---------------------------------------------------------------------------
// 呈现
// ---------------------------------------------------------------------------

function presentTemplate(row) {
  return {
    id: row.id, code: row.code, name: row.name, documentType: row.document_type,
    status: row.status, currentVersion: row.current_version,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    retiredAt: row.retired_at,
  };
}

function presentVersion(row) {
  return {
    id: row.id, templateId: row.template_id, version: row.version, status: row.status,
    definition: parseJson(row.definition_json, null), changeNote: row.change_note,
    publishedBy: row.published_by, publishedAt: row.published_at, createdAt: row.created_at,
  };
}

function presentBinding(row) {
  return {
    id: row.id, documentType: row.document_type, orgId: row.org_id,
    condition: parseJson(row.condition_json, null), templateId: row.template_id,
    versionId: row.version_id, priority: row.priority, status: row.status,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function presentInstance(row) {
  return {
    id: row.id, templateId: row.template_id, versionId: row.version_id,
    documentType: row.document_type, documentId: row.document_id, orgId: row.org_id,
    status: row.status, variables: parseJson(row.variables_json, null),
    idempotencyKey: row.idempotency_key, startedBy: row.started_by, startedAt: row.started_at,
    completedAt: row.completed_at, suspendedAt: row.suspended_at,
    terminatedAt: row.terminated_at, cancelReason: row.cancel_reason,
  };
}

function presentNodeInstance(row) {
  return {
    id: row.id, instanceId: row.instance_id, nodeKey: row.node_key, nodeType: row.node_type,
    sequenceNo: row.sequence_no, status: row.status, assigneeId: row.assignee_id,
    assigneeRole: row.assignee_role, enteredAt: row.entered_at,
    completedAt: row.completed_at, branchTaken: row.branch_taken,
  };
}

function presentTask(row) {
  return {
    id: row.id, instanceId: row.instance_id, nodeInstanceId: row.node_instance_id,
    assigneeId: row.assignee_id, status: row.status, action: row.action, comment: row.comment,
    createdAt: row.created_at, completedAt: row.completed_at, completedBy: row.completed_by,
    rowVersion: row.row_version,
  };
}

// ---------------------------------------------------------------------------
// 定义与版本
// ---------------------------------------------------------------------------

/**
 * 解析并校验一份流程定义（写入前的唯一入口）。
 * 结构非法 → 422 PLATFORM_WORKFLOW_DEFINITION_INVALID / PLATFORM_WORKFLOW_CONDITION_INVALID。
 */
export function parseWorkflowDefinition(value) {
  const definition = typeof value === 'string' ? parseJson(value, null) : value;
  validateWorkflowDefinition(definition);
  return definition;
}

/** 创建一个流程模板（草稿）。 */
export function createWorkflowTemplate(db, { code, name, documentType, definition, actor }) {
  return transaction(db, () => {
    const templateCode = requiredCode(code, '流程编码');
    const templateName = requiredText(name, '流程名称', 100);
    const docType = requiredCode(documentType, '适用单据类型');
    const parsed = parseWorkflowDefinition(definition);
    const templateId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO workflow_templates(id, code, name, document_type, status, current_version, created_by, created_at, updated_at)'
      + ' VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(templateId, templateCode, templateName, docType, 'DRAFT', 0, actor.id, now, now);
    // 首个草稿版本
    db.prepare(
      'INSERT INTO workflow_template_versions(id, template_id, version, status, definition_json, change_note, created_at)'
      + ' VALUES(?,?,?,?,?,?,?)',
    ).run(id(), templateId, 1, 'DRAFT', JSON.stringify(parsed), '初始版本', now);
    db.prepare('UPDATE workflow_templates SET current_version=1, updated_at=? WHERE id=?').run(now, templateId);
    audit(db, actor.id, 'WORKFLOW_TEMPLATE_CREATE', 'WORKFLOW_TEMPLATE', templateId, `创建流程模板 ${templateCode}`);
    return db.prepare('SELECT * FROM workflow_templates WHERE id=?').get(templateId);
  });
}

/** 在模板下创建一个新草稿版本。 */
export function createWorkflowVersion(db, { templateId, definition, changeNote, actor }) {
  return transaction(db, () => {
    const template = db.prepare('SELECT * FROM workflow_templates WHERE id=?').get(templateId);
    if (!template) throw notFound('流程模板不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    const parsed = parseWorkflowDefinition(definition);
    const nextVersion = Number(template.current_version || 0) + 1;
    const versionId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO workflow_template_versions(id, template_id, version, status, definition_json, change_note, created_at)'
      + ' VALUES(?,?,?,?,?,?,?)',
    ).run(versionId, template.id, nextVersion, 'DRAFT', JSON.stringify(parsed), optionalText(changeNote, 500) || null, now);
    db.prepare('UPDATE workflow_templates SET current_version=?, updated_at=? WHERE id=?').run(nextVersion, now, template.id);
    audit(db, actor.id, 'WORKFLOW_TEMPLATE_CREATE', 'WORKFLOW_VERSION', versionId, `创建流程版本 ${nextVersion}`);
    return db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(versionId);
  });
}

/**
 * 发布一个版本。已发布版本**不可变** —— 再次发布同一个版本是状态非法。
 * PUBLISHED → DRAFT 被禁止（Design §32.3.2）。
 */
export function publishWorkflowVersion(db, { versionId, actor }) {
  return transaction(db, () => {
    const version = db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(versionId);
    if (!version) throw notFound('流程版本不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (version.status !== 'DRAFT') {
      throw conflict('流程版本不是草稿状态，无法发布', 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
    }
    // 发布前重读并校验定义 —— 草稿期间可能被手工改动过。
    const parsed = parseWorkflowDefinition(version.definition_json);
    const now = nowIso();
    db.prepare(
      "UPDATE workflow_template_versions SET status='PUBLISHED', definition_json=?, published_by=?, published_at=? WHERE id=?",
    ).run(JSON.stringify(parsed), actor.id, now, version.id);
    db.prepare("UPDATE workflow_templates SET status='PUBLISHED', updated_at=? WHERE id=?").run(now, version.template_id);
    audit(db, actor.id, 'WORKFLOW_VERSION_PUBLISH', 'WORKFLOW_VERSION', version.id, `发布流程版本 ${version.version}`);
    return db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(version.id);
  });
}

/** 停用一个版本。停用不影响已启动实例，但不可再启动新实例。 */
export function retireWorkflowVersion(db, { versionId, actor }) {
  return transaction(db, () => {
    const version = db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(versionId);
    if (!version) throw notFound('流程版本不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (version.status !== 'PUBLISHED') {
      throw conflict('流程版本不是已发布状态，无法停用', 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
    }
    const now = nowIso();
    db.prepare("UPDATE workflow_template_versions SET status='RETIRED' WHERE id=?").run(version.id);
    const remaining = db.prepare(
      "SELECT COUNT(*) n FROM workflow_template_versions WHERE template_id=? AND status='PUBLISHED'",
    ).get(version.template_id).n;
    if (!remaining) {
      db.prepare("UPDATE workflow_templates SET status='RETIRED', retired_at=?, updated_at=? WHERE id=?")
        .run(now, now, version.template_id);
    }
    audit(db, actor.id, 'WORKFLOW_VERSION_RETIRE', 'WORKFLOW_VERSION', version.id, `停用流程版本 ${version.version}`);
    return db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(version.id);
  });
}

// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

/**
 * 激活一条绑定：同一 (document_type, org_id) 只有一条生效绑定。
 * 换版时旧绑定置为 INACTIVE 并写入历史，不删除。
 */
export function activateWorkflowBinding(db, { documentType, orgId, templateId, versionId, condition, priority, actor }) {
  return transaction(db, () => {
    const docType = requiredCode(documentType, '单据类型');
    const organization = String(orgId ?? '').trim();
    const version = db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(versionId);
    if (!version) throw notFound('流程版本不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (version.status !== 'PUBLISHED') {
      throw conflict('流程版本未发布，不能绑定', 'PLATFORM_WORKFLOW_VERSION_NOT_PUBLISHED');
    }
    const template = db.prepare('SELECT * FROM workflow_templates WHERE id=?').get(version.template_id);
    if (!template) throw notFound('流程模板不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (template.document_type !== docType) {
      throw new HttpError(400, '流程模板的适用单据类型与绑定不一致');
    }
    const conditionJson = condition === undefined || condition === null ? null : JSON.stringify(condition);
    if (conditionJson) validateWorkflowCondition(condition, '绑定条件');
    const now = nowIso();
    const existing = db.prepare(
      "SELECT * FROM workflow_bindings WHERE document_type=? AND org_id=? AND status='ACTIVE'",
    ).get(docType, organization);
    let bindingId;
    if (existing) {
      bindingId = existing.id;
      db.prepare(
        "UPDATE workflow_bindings SET condition_json=?, template_id=?, version_id=?, priority=?, updated_at=? WHERE id=?",
      ).run(conditionJson, version.template_id, version.id, Number(priority || 0), now, bindingId);
      db.prepare(
        'INSERT INTO workflow_binding_history(id, binding_id, version_id, condition_json, activated_by, activated_at, retired_at)'
        + ' VALUES(?,?,?,?,?,?,?)',
      ).run(id(), bindingId, version.id, conditionJson, actor.id, now, now);
    } else {
      bindingId = id();
      db.prepare(
        'INSERT INTO workflow_bindings(id, document_type, org_id, condition_json, template_id, version_id, priority, status, created_by, created_at, updated_at)'
        + ' VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      ).run(bindingId, docType, organization, conditionJson, version.template_id, version.id,
        Number(priority || 0), 'ACTIVE', actor.id, now, now);
      db.prepare(
        'INSERT INTO workflow_binding_history(id, binding_id, version_id, condition_json, activated_by, activated_at)'
        + ' VALUES(?,?,?,?,?,?)',
      ).run(id(), bindingId, version.id, conditionJson, actor.id, now);
    }
    audit(db, actor.id, 'WORKFLOW_BIND_ACTIVATE', 'WORKFLOW_TEMPLATE', bindingId,
      `激活流程绑定 ${docType}/${organization || '全局'}`);
    return db.prepare('SELECT * FROM workflow_bindings WHERE id=?').get(bindingId);
  });
}

/**
 * 解析某单据类型在某组织下生效的绑定。
 *
 * 组织维度优先于全局绑定；条件不匹配的绑定不生效。
 * 无任何生效绑定 → 409 PLATFORM_WORKFLOW_BINDING_NOT_FOUND（**不得**静默跳过审批）。
 */
export function resolveWorkflowBinding(db, { documentType, orgId = '', variables = {} }) {
  const docType = String(documentType);
  const organization = String(orgId || '');
  const candidates = db.prepare(
    "SELECT * FROM workflow_bindings WHERE document_type=? AND status='ACTIVE' AND org_id IN ('', ?)"
    + ' ORDER BY (org_id=\'\') ASC, priority DESC, created_at ASC',
  ).all(docType, organization);

  const matching = [];
  for (const binding of candidates) {
    const condition = parseJson(binding.condition_json, null);
    if (!condition) { matching.push(binding); continue; }
    const validated = validateWorkflowCondition(condition, '绑定条件');
    if (evaluateWorkflowCondition(validated, variables)) matching.push(binding);
  }

  if (!matching.length) {
    throw conflict('该单据类型没有生效的流程绑定', 'PLATFORM_WORKFLOW_BINDING_NOT_FOUND');
  }
  const mostSpecific = matching[0].org_id === '' ? 0 : 1;
  const sameLevel = matching.filter((binding) => (binding.org_id === '' ? 0 : 1) === mostSpecific);
  if (sameLevel.length > 1) {
    throw conflict('该单据类型存在多条生效绑定', 'PLATFORM_WORKFLOW_BINDING_AMBIGUOUS');
  }
  return sameLevel[0];
}

// ---------------------------------------------------------------------------
// 实例与任务
// ---------------------------------------------------------------------------

function insertNodeInstance(db, instance, node, sequenceNo, status) {
  const nodeInstanceId = id();
  db.prepare(
    'INSERT INTO workflow_node_instances(id, instance_id, node_key, node_type, sequence_no, status, entered_at)'
    + ' VALUES(?,?,?,?,?,?,?)',
  ).run(nodeInstanceId, instance.id, node.key, node.type, sequenceNo, status, nowIso());
  return nodeInstanceId;
}

function createTask(db, instance, nodeInstanceId, assigneeId) {
  const taskId = id();
  db.prepare(
    'INSERT INTO workflow_tasks(id, instance_id, node_instance_id, assignee_id, status, created_at)'
    + ' VALUES(?,?,?,?,?,?)',
  ).run(taskId, instance.id, nodeInstanceId, assigneeId, 'PENDING', nowIso());
  return taskId;
}

/** 物化一个节点：激活节点实例 + 建任务（阻塞节点）或执行知会动作（非阻塞节点）。 */
function materializeNode(db, { instance, definition, node, variables, actor, requestId }) {
  // 节点实例在实例启动时已按定义全量物化（PENDING）；进入节点时把它激活。
  // 只有被重复进入的节点（条件分支成环）才需要新建实例。
  const existing = db.prepare('SELECT * FROM workflow_node_instances WHERE instance_id=? AND node_key=?')
    .get(instance.id, node.key);
  let nodeInstanceId;
  if (existing) {
    db.prepare("UPDATE workflow_node_instances SET status='ACTIVE', entered_at=? WHERE id=?")
      .run(nowIso(), existing.id);
    nodeInstanceId = existing.id;
  } else {
    nodeInstanceId = insertNodeInstance(db, instance, node, definition.nodes.indexOf(node), 'ACTIVE');
  }
  const participants = resolveWorkflowParticipants(db, node.participants, {
    variables, initiatorId: instance.started_by,
  });
  if (WORKFLOW_BLOCKING_NODE_TYPES.includes(node.type) && participants.length === 0) {
    // 审批节点解析不到参与人时**失败即拒绝**：静默跳过审批是正确性事故。
    throw conflict(`流程节点 ${node.key} 未能解析出审批参与人`, 'PLATFORM_WORKFLOW_PARTICIPANT_UNRESOLVED');
  }
  if (WORKFLOW_NOTIFYING_NODE_TYPES.includes(node.type)) {
    executeNodeActions(db, {
      instance, node, nodeInstanceId, task: null, actor, payload: null, requestId,
    });
    db.prepare("UPDATE workflow_node_instances SET status='COMPLETED', completed_at=? WHERE id=?")
      .run(nowIso(), nodeInstanceId);
    return { nodeInstanceId, taskIds: [], participants };
  }
  const taskIds = participants.map((assigneeId) => createTask(db, instance, nodeInstanceId, assigneeId));
  return { nodeInstanceId, taskIds, participants };
}

/** 执行节点动作。handler 抛错即整体回滚（副作用为零）。 */
function executeNodeActions(db, { instance, node, nodeInstanceId, task, actor, payload, requestId }) {
  const actions = Array.isArray(node.actions) ? node.actions : (node.action ? [node.action] : []);
  for (const action of actions) {
    const actionType = String(action?.type ?? '').trim();
    if (!actionType) continue;
    const target = String(action?.target ?? '').trim();
    const handler = actionHandlerFor(actionType, target);
    if (!handler) {
      throw conflict(
        `流程动作缺少处理器: ${actionType}${target ? `/${target}` : ''}`,
        'PLATFORM_WORKFLOW_ACTION_FAILED',
      );
    }
    try {
      handler({
        db, instance, node, nodeInstanceId, task, actor, payload, action,
        definition: parseJson(instance.definition_snapshot_json, null),
      });
    } catch (error) {
      // 动作失败一律转成平台错误码：事务会整体回滚，实例不推进。
      // 原始错误码保留在 details.originCode 中，不丢失来源信息。
      const reason = error instanceof HttpError ? error.message : (error?.message ? String(error.message) : '未知错误');
      throw new HttpError(409, `流程动作执行失败: ${reason}`, {
        code: 'PLATFORM_WORKFLOW_ACTION_FAILED',
        originCode: error?.code ?? null,
      });
    }
    db.prepare(
      'INSERT INTO workflow_action_logs(id, instance_id, node_instance_id, action_type, target, payload_json, status, executed_at)'
      + ' VALUES(?,?,?,?,?,?,?,?)',
    ).run(id(), instance.id, nodeInstanceId, actionType, target,
      payload === undefined || payload === null ? null : JSON.stringify(payload), 'SUCCESS', nowIso());
  }
}

function recordWorkflowEvent(db, instance, eventType, fromStatus, toStatus, actor, detail) {
  db.prepare(
    'INSERT INTO workflow_events(id, instance_id, event_type, from_status, to_status, actor_id, detail_json, created_at)'
    + ' VALUES(?,?,?,?,?,?,?,?)',
  ).run(id(), instance.id, eventType, fromStatus, toStatus, actor?.id ?? null,
    detail === undefined ? null : JSON.stringify(detail), nowIso());
}

/**
 * 启动一个流程实例。
 *
 * 幂等键 = document_type + ':' + document_id + ':' + version_id；重复启动**返回既有实例**
 * （replayed=true），不是 409。
 */
export function startWorkflowInstance(db, options) {
  const {
    templateId, versionId, documentType, documentId, orgId = '', variables = {},
    idempotencyKey, actor, requestId = null, businessDate = null,
  } = options;
  const key = idempotencyKey || `${documentType}:${documentId}:${versionId}`;
  const started = transaction(db, () => {
    const existing = db.prepare('SELECT * FROM workflow_instances WHERE idempotency_key=?').get(key);
    if (existing) return { instance: existing, replayed: true, taskIds: [] };

    // 权威状态重读：版本必须存在且已发布。
    const version = db.prepare('SELECT * FROM workflow_template_versions WHERE id=?').get(versionId);
    if (!version) throw notFound('流程版本不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (version.status !== 'PUBLISHED') {
      throw conflict('流程版本未发布，不能启动流程', 'PLATFORM_WORKFLOW_VERSION_NOT_PUBLISHED');
    }
    const template = db.prepare('SELECT * FROM workflow_templates WHERE id=?').get(version.template_id);
    if (!template) throw notFound('流程模板不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
    if (template.document_type !== documentType) {
      throw new HttpError(400, '流程模板的适用单据类型与业务单据不一致');
    }
    const definition = validateWorkflowDefinition(parseJson(version.definition_json, null));

    const instanceId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO workflow_instances(id, template_id, version_id, document_type, document_id, org_id, status,'
      + ' definition_snapshot_json, variables_json, idempotency_key, started_by, started_at)'
      + ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(instanceId, template.id, version.id, documentType, documentId, orgId, 'RUNNING',
      JSON.stringify(definition), JSON.stringify(variables), key, actor.id, now);

    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
    for (const node of definition.nodes) insertNodeInstance(db, instance, node, definition.nodes.indexOf(node), 'PENDING');

    recordWorkflowEvent(db, instance, 'INSTANCE_STARTED', null, 'RUNNING', actor, { idempotencyKey: key });
    audit(db, actor.id, 'WORKFLOW_INSTANCE_START', 'WORKFLOW_INSTANCE', instanceId,
      `启动流程 ${documentType}/${documentId}`, { businessDate, requestId });

    advanceWorkflow(db, { instance, definition, nodeKey: definition.entry, variables, actor, requestId });
    return {
      instance: db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId),
      replayed: false,
      taskIds: db.prepare(
        "SELECT id FROM workflow_tasks WHERE instance_id=? AND status='PENDING'",
      ).all(instanceId).map((row) => row.id),
    };
  });
  // 通知是副作用：在事务**提交之后**产生，失败不影响流程结果。
  if (!started.replayed && started.taskIds.length) {
    const tasks = started.taskIds.map((taskId) => (
      db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(taskId)
    ));
    notifyWorkflowTaskPending(db, started.instance, tasks, { requestId });
  }
  return { instance: started.instance, replayed: started.replayed };
}

/**
 * 从某个节点推进。CONDITION 节点自动求值并继续；人工/知会节点被物化后停下。
 * 走到 END → 实例完成。
 */
function advanceWorkflow(db, { instance, definition, nodeKey, variables, actor, requestId }) {
  let currentKey = nodeKey;
  const visited = new Set();
  while (currentKey && currentKey !== WORKFLOW_END_NODE) {
    if (visited.has(currentKey)) {
      throw unprocessable('流程定义存在无法终止的循环', 'PLATFORM_WORKFLOW_DEFINITION_INVALID');
    }
    visited.add(currentKey);
    const node = definition.nodes.find((candidate) => candidate.key === currentKey);
    if (!node) {
      throw unprocessable(`后继节点不存在: ${currentKey}`, 'PLATFORM_WORKFLOW_NODE_UNREACHABLE');
    }
    if (node.type === 'CONDITION') {
      const condition = validateWorkflowCondition(node.condition, `节点 ${currentKey}`);
      const passed = evaluateWorkflowCondition(condition, variables);
      const next = passed ? node.onTrue?.next : node.onFalse?.next;
      db.prepare(
        "UPDATE workflow_node_instances SET status='COMPLETED', completed_at=?, branch_taken=? WHERE instance_id=? AND node_key=?",
      ).run(nowIso(), passed ? 'TRUE' : 'FALSE', instance.id, currentKey);
      currentKey = next;
      continue;
    }
    materializeNode(db, { instance, definition, node, variables, actor, requestId });
    return currentKey;
  }
  completeWorkflowInstance(db, { instance, actor, requestId, reason: null });
  return null;
}

function completeWorkflowInstance(db, { instance, actor, requestId, reason }) {
  const now = nowIso();
  db.prepare("UPDATE workflow_instances SET status='COMPLETED', completed_at=? WHERE id=?").run(now, instance.id);
  db.prepare("UPDATE workflow_tasks SET status='CANCELLED', completed_at=? WHERE instance_id=? AND status='PENDING'")
    .run(now, instance.id);
  recordWorkflowEvent(db, instance, 'INSTANCE_COMPLETED', instance.status, 'COMPLETED', actor, reason ? { reason } : null);
  audit(db, actor.id, 'WORKFLOW_INSTANCE_COMPLETE', 'WORKFLOW_INSTANCE', instance.id,
    `流程实例完成${reason ? `（${reason}）` : ''}`, { requestId });
}

/** 取节点的后继键。 */
function nextNodeKey(node, action, definition) {
  if (action === 'APPROVE') return node.onApprove?.next ?? WORKFLOW_END_NODE;
  if (action === 'REJECT') return node.onReject?.next ?? WORKFLOW_END_NODE;
  if (action === 'RETURN') return node.onReturn?.next ?? WORKFLOW_END_NODE;
  return null;
}

/**
 * 完成一个流程任务。
 *
 * 事务内顺序（Design §32.3.1）：重读实例状态 → 重读任务状态 + 乐观锁 → SOD 判定 →
 * 任务与节点状态迁移 → 执行节点动作（同一事务）→ 计算后继并物化 → 审计与事件。
 */
export function completeWorkflowTask(db, options) {
  const { taskId, actor, action, comment, payload = null, requestId = null, businessDate = null } = options;
  try {
    const result = transaction(db, () => completeWorkflowTaskInTransaction(db, {
      taskId, actor, action, comment, payload, requestId, businessDate,
    }));
    // 通知是副作用：在事务**提交之后**产生，失败不影响审批结果。
    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?')
      .get(db.prepare('SELECT instance_id FROM workflow_tasks WHERE id=?').get(taskId)?.instance_id || '');
    if (instance && !result.escalated && !result.transferred && !result.addedSign) {
      notifyWorkflowTaskHandled(db, instance, action, { requestId });
    }
    return result;
  } catch (error) {
    // 事务已回滚：拒绝证据必须在事务之外补写，否则会随回滚消失。
    recordTaskFailureEvidence(db, error, { taskId, actor, action, requestId });
    throw error;
  }
}

function completeWorkflowTaskInTransaction(db, { taskId, actor, action, comment, payload, requestId, businessDate }) {
  // ① 重读实例状态（权威状态重读）
  const task = db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(taskId);
  if (!task) throw notFound('流程任务不存在', 'PLATFORM_WORKFLOW_TASK_NOT_FOUND');
  const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(task.instance_id);
  if (!instance) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
  if (instance.status !== 'RUNNING') {
    throw conflict(`流程实例当前状态不允许任务处理: ${instance.status}`, 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
  }

  // ② 重读任务状态 + 乐观锁基准
  if (task.status !== 'PENDING') {
    throw conflict('流程任务已被处理', 'PLATFORM_WORKFLOW_TASK_ALREADY_COMPLETED');
  }
  // 只有被指派的参与人可以处理该任务。权限码只说明"可以做这类事"，
  // 不代表可以做**别人**的事。
  if (task.assignee_id !== actor.id) {
    throw new HttpError(403, '只能处理分配给自己的流程任务', {
      code: 'PLATFORM_WORKFLOW_TASK_NOT_ASSIGNED',
    });
  }

  // ③ SOD 判定
  //
  // 引擎**不引用** SOD 模块的错误码（XDC-01：消费方不得用生产方的错误码做自己的业务判断）。
  // 引擎调用判定原语、读取**结构化判定结果**，并用**自己的**对外错误码表达"职责分离拒绝"。
  const sodOutcome = evaluateSodCompliance(db, {
    businessType: 'WORKFLOW_TASK', businessId: task.id, action: 'APPROVE', actorId: actor.id,
  });
  if (sodOutcome.decision === 'REJECT') {
    const rejection = new HttpError(409, '职责分离规则不允许本次操作', {
      code: 'PLATFORM_WORKFLOW_SOD_REJECTED',
      ruleCode: sodOutcome.rule?.code ?? null,
    });
    rejection.sodOutcome = sodOutcome;
    throw rejection;
  }
  writeSodEvaluations(db, sodOutcome.evaluations);
  if (sodOutcome.decision === 'ESCALATE') {
    const escalateRole = String(sodOutcome.rule?.escalate_to_role || '').trim();
    const members = escalateRole ? listRoleUserIds(db, escalateRole) : [];
    if (!members.length) {
      throw conflict('职责分离规则要求升级，但没有可用的升级对象', 'PLATFORM_SOD_RULE_VIOLATION');
    }
    const now = nowIso();
    db.prepare("UPDATE workflow_tasks SET status='TRANSFERRED', action='TRANSFER', completed_at=?, completed_by=?, row_version=row_version+1 WHERE id=?")
      .run(now, actor.id, task.id);
    const created = members.map((assigneeId) => createTask(db, instance, task.node_instance_id, assigneeId));
    recordWorkflowEvent(db, instance, 'TASK_ESCALATED', 'PENDING', 'TRANSFERRED', actor, { taskId: task.id, escalateRole });
    audit(db, actor.id, 'WORKFLOW_TASK_ESCALATE', 'WORKFLOW_TASK', task.id,
      `流程任务升级至 ${escalateRole}`, { businessDate, requestId });
    return { escalated: true, taskId: task.id, createdTaskIds: created };
  }

  // ④ 任务状态迁移（乐观锁）
  const now = nowIso();
  if (action === 'TRANSFER') {
    const target = String(payload?.assigneeId || '').trim();
    if (!target) throw new HttpError(400, '转办必须指定接收人');
    resolveWorkflowParticipants(db, [{ type: 'USER', value: target }], { variables: {} });
    const updated = db.prepare(
      "UPDATE workflow_tasks SET status='TRANSFERRED', action='TRANSFER', comment=?, completed_at=?, completed_by=?, row_version=row_version+1"
      + " WHERE id=? AND status='PENDING' AND row_version=?",
    ).run(comment ?? null, now, actor.id, task.id, task.row_version);
    if (updated.changes !== 1) throw conflict('流程任务已被并发处理', 'PLATFORM_WORKFLOW_TASK_CONFLICT');
    const created = createTask(db, instance, task.node_instance_id, target);
    recordWorkflowEvent(db, instance, 'TASK_TRANSFERRED', 'PENDING', 'TRANSFERRED', actor, { taskId: task.id, target });
    audit(db, actor.id, 'WORKFLOW_TASK_TRANSFER', 'WORKFLOW_TASK', task.id, `流程任务转办给 ${target}`,
      { businessDate, requestId });
    return { transferred: true, taskId: task.id, createdTaskIds: [created] };
  }

  const updated = db.prepare(
    "UPDATE workflow_tasks SET status='COMPLETED', action=?, comment=?, completed_at=?, completed_by=?, row_version=row_version+1"
    + " WHERE id=? AND status='PENDING' AND row_version=?",
  ).run(action, comment ?? null, now, actor.id, task.id, task.row_version);
  if (updated.changes !== 1) throw conflict('流程任务已被并发处理', 'PLATFORM_WORKFLOW_TASK_CONFLICT');

  const definition = parseJson(instance.definition_snapshot_json, null);
  const variables = parseJson(instance.variables_json, {});
  const nodeInstance = db.prepare('SELECT * FROM workflow_node_instances WHERE id=?').get(task.node_instance_id);
  const node = definition.nodes.find((candidate) => candidate.key === nodeInstance.node_key);
  if (!node) throw unprocessable(`节点不存在: ${nodeInstance.node_key}`, 'PLATFORM_WORKFLOW_NODE_UNREACHABLE');

  if (action === 'ADD_SIGN') {
    const target = String(payload?.assigneeId || '').trim();
    if (!target) throw new HttpError(400, '加签必须指定加签人');
    resolveWorkflowParticipants(db, [{ type: 'USER', value: target }], { variables: {} });
    const created = createTask(db, instance, task.node_instance_id, target);
    recordWorkflowEvent(db, instance, 'TASK_ADD_SIGN', 'PENDING', 'COMPLETED', actor, { taskId: task.id, target });
    audit(db, actor.id, 'WORKFLOW_TASK_ADD_SIGN', 'WORKFLOW_TASK', task.id, `流程任务加签给 ${target}`,
      { businessDate, requestId });
    return { addedSign: true, taskId: task.id, createdTaskIds: [created] };
  }

  // ⑤ 执行节点动作（同一事务；失败即整体回滚）
  executeNodeActions(db, {
    instance, node, nodeInstanceId: task.node_instance_id, task, actor, payload, requestId,
  });

  // 节点是否完成：同一节点上不得再有 PENDING 任务。
  const pending = db.prepare(
    "SELECT COUNT(*) n FROM workflow_tasks WHERE node_instance_id=? AND status='PENDING'",
  ).get(task.node_instance_id).n;

  if (pending > 0) {
    recordWorkflowEvent(db, instance, 'TASK_COMPLETED', 'PENDING', 'COMPLETED', actor, { taskId: task.id, action });
    audit(db, actor.id, 'WORKFLOW_TASK_COMPLETE', 'WORKFLOW_TASK', task.id,
      `完成任务 ${action}（节点仍在等待其他参与人）`, { businessDate, requestId });
    return { completed: true, taskId: task.id, nodeAdvanced: false };
  }

  db.prepare("UPDATE workflow_node_instances SET status='COMPLETED', completed_at=? WHERE id=?")
    .run(now, task.node_instance_id);

  // ⑥ 计算后继节点 → 物化下一批任务
  const nextKey = nextNodeKey(node, action, definition);
  if (!ADVANCING_ACTIONS.has(action)) {
    recordWorkflowEvent(db, instance, 'TASK_COMPLETED', 'PENDING', 'COMPLETED', actor, { taskId: task.id, action });
    audit(db, actor.id, 'WORKFLOW_TASK_COMPLETE', 'WORKFLOW_TASK', task.id, `完成任务 ${action}`,
      { businessDate, requestId });
    return { completed: true, taskId: task.id, nodeAdvanced: false };
  }

  if (nextKey === WORKFLOW_END_NODE) {
    if (action === 'REJECT') {
      db.prepare("UPDATE workflow_instances SET status='CANCELLED', completed_at=?, cancel_reason=? WHERE id=?")
        .run(now, '审批驳回', instance.id);
      db.prepare("UPDATE workflow_tasks SET status='CANCELLED', completed_at=? WHERE instance_id=? AND status='PENDING'")
        .run(now, instance.id);
      recordWorkflowEvent(db, instance, 'INSTANCE_REJECTED', 'RUNNING', 'CANCELLED', actor, { taskId: task.id });
      audit(db, actor.id, 'WORKFLOW_TASK_COMPLETE', 'WORKFLOW_TASK', task.id, '审批驳回，流程终止',
        { businessDate, requestId });
      return { completed: true, taskId: task.id, nodeAdvanced: true, instanceStatus: 'CANCELLED' };
    }
    completeWorkflowInstance(db, { instance, actor, requestId, reason: null });
    return { completed: true, taskId: task.id, nodeAdvanced: true, instanceStatus: 'COMPLETED' };
  }

  advanceWorkflow(db, { instance, definition, nodeKey: nextKey, variables, actor, requestId });
  recordWorkflowEvent(db, instance, 'TASK_COMPLETED', 'PENDING', 'COMPLETED', actor, { taskId: task.id, action, nextKey });
  audit(db, actor.id, 'WORKFLOW_TASK_COMPLETE', 'WORKFLOW_TASK', task.id, `完成任务 ${action}`, { businessDate, requestId });
  return { completed: true, taskId: task.id, nodeAdvanced: true };
}

/** 事务外的失败证据补写（拒绝审计 + 动作失败日志）。 */
function recordTaskFailureEvidence(db, error, { taskId, actor, action, requestId }) {
  try {
    // 判定依据是**结构化载荷**（error.sodOutcome），不是 SOD 模块的错误码 ——
    // 消费方不得用生产方的错误码做自己的业务判断（XDC-01）。
    if (error?.sodOutcome) {
      const outcome = error.sodOutcome;
      if (outcome?.evaluations?.length) writeSodEvaluations(db, outcome.evaluations);
      audit(db, actor?.id ?? null, 'WORKFLOW_TASK_REJECT', 'WORKFLOW_TASK', taskId,
        `职责分离拒绝 ${action}：${error.message}`, { requestId });
      return;
    }
    if (error?.code === 'PLATFORM_WORKFLOW_ACTION_FAILED') {
      const task = db.prepare('SELECT instance_id, node_instance_id FROM workflow_tasks WHERE id=?').get(taskId);
      if (task) {
        db.prepare(
          'INSERT INTO workflow_action_logs(id, instance_id, node_instance_id, action_type, target, payload_json, status, error, executed_at)'
          + ' VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(id(), task.instance_id, task.node_instance_id, 'ACTION', '', null, 'FAILED', error.message, nowIso());
      }
      audit(db, actor?.id ?? null, 'WORKFLOW_TASK_FAILED', 'WORKFLOW_TASK', taskId,
        `流程动作失败：${error.message}`, { requestId });
    }
  } catch (_) {
    // 证据补写失败不得掩盖原始错误。
  }
}

/*
 * ---------------------------------------------------------------------------
 * 通知生产者（Design §32.7 六类生产者之 1～3）
 * ---------------------------------------------------------------------------
 * 通知是**副作用**：一律在业务事务**提交之后**产生，失败不得影响流程结果。
 */

/** 任务生成 → 通知任务参与人。 */
function notifyWorkflowTaskPending(db, instance, tasks, { requestId = null } = {}) {
  const recipients = tasks
    .map((task) => task.assignee_id)
    .filter((assigneeId) => assigneeId && assigneeId !== instance.started_by)
    .map((value) => ({ type: 'USER', value }));
  if (!recipients.length) return { created: 0, skipped: 0 };
  return notifyEvent(db, {
    eventType: 'WORKFLOW_TASK_PENDING',
    category: 'WORKFLOW',
    recipients,
    title: '有一项流程任务待你处理',
    content: `${instance.document_type} ${instance.document_id} 有一项待办`,
    type: 'INFO',
    sourceType: 'WORKFLOW_INSTANCE',
    sourceId: instance.id,
    dedupeKey: `${instance.id}:${tasks.map((task) => task.id).join(',')}:PENDING`,
    requestId,
  });
}

/** 任务完成 / 驳回 / 退回 → 通知流程发起人。 */
function notifyWorkflowTaskHandled(db, instance, action, { requestId = null } = {}) {
  if (!instance.started_by) return { created: 0, skipped: 0 };
  const label = action === 'REJECT' ? '已驳回' : action === 'RETURN' ? '已退回' : '已通过';
  return notifyEvent(db, {
    eventType: 'WORKFLOW_TASK_HANDLED',
    category: 'WORKFLOW',
    recipients: [{ type: 'USER', value: instance.started_by }],
    title: `流程任务${label}`,
    content: `${instance.document_type} ${instance.document_id} 的流程任务${label}`,
    type: action === 'APPROVE' ? 'SUCCESS' : 'WARNING',
    sourceType: 'WORKFLOW_INSTANCE',
    sourceId: instance.id,
    dedupeKey: `${instance.id}:${action}:HANDLED`,
    requestId,
  });
}

/** 实例终止 / 恢复 → 通知发起人与参与人。 */
function notifyWorkflowInstanceState(db, instance, eventType, title, { requestId = null } = {}) {
  const participants = db.prepare(
    "SELECT DISTINCT assignee_id FROM workflow_tasks WHERE instance_id=? AND assignee_id IS NOT NULL",
  ).all(instance.id).map((row) => row.assignee_id);
  const recipients = [...new Set([instance.started_by, ...participants])]
    .filter(Boolean)
    .map((value) => ({ type: 'USER', value }));
  if (!recipients.length) return { created: 0, skipped: 0 };
  return notifyEvent(db, {
    eventType,
    category: 'WORKFLOW',
    recipients,
    title,
    content: `${instance.document_type} ${instance.document_id}：${title}`,
    type: eventType === 'WORKFLOW_INSTANCE_TERMINATED' ? 'WARNING' : 'INFO',
    sourceType: 'WORKFLOW_INSTANCE',
    sourceId: instance.id,
    dedupeKey: `${instance.id}:${eventType}`,
    requestId,
  });
}

// ---------------------------------------------------------------------------
// 实例控制
// ---------------------------------------------------------------------------

/** 暂停实例：SUSPENDED 下当前任务不可完成。 */
export function suspendWorkflowInstance(db, { instanceId, reason, actor, requestId = null }) {
  return transaction(db, () => {
    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
    if (!instance) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
    if (instance.status !== 'RUNNING') {
      throw conflict(`流程实例当前状态不允许暂停: ${instance.status}`, 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
    }
    const now = nowIso();
    db.prepare("UPDATE workflow_instances SET status='SUSPENDED', suspended_at=?, cancel_reason=? WHERE id=?")
      .run(now, optionalText(reason, 200) || null, instance.id);
    recordWorkflowEvent(db, instance, 'INSTANCE_SUSPENDED', 'RUNNING', 'SUSPENDED', actor, { reason: reason ?? null });
    audit(db, actor.id, 'WORKFLOW_INSTANCE_SUSPEND', 'WORKFLOW_INSTANCE', instance.id,
      `暂停流程实例${reason ? `：${reason}` : ''}`, { requestId });
    return db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
  });
}

/** 恢复实例：SUSPENDED → RUNNING。 */
export function resumeWorkflowInstance(db, { instanceId, actor, requestId = null }) {
  return transaction(db, () => {
    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
    if (!instance) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
    if (instance.status !== 'SUSPENDED') {
      throw conflict(`流程实例当前状态不允许恢复: ${instance.status}`, 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
    }
    db.prepare("UPDATE workflow_instances SET status='RUNNING', suspended_at=NULL, cancel_reason=NULL WHERE id=?")
      .run(instance.id);
    recordWorkflowEvent(db, instance, 'INSTANCE_RESUMED', 'SUSPENDED', 'RUNNING', actor, null);
    audit(db, actor.id, 'WORKFLOW_INSTANCE_RESUME', 'WORKFLOW_INSTANCE', instance.id, '恢复流程实例', { requestId });
    return db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
  });
  notifyWorkflowInstanceState(db, instance, 'WORKFLOW_INSTANCE_RESUMED', '流程实例已恢复', { requestId });
  return db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
}

/** 终止实例：未完成任务置 CANCELLED，**不产生任何业务副作用**。 */
export function terminateWorkflowInstance(db, { instanceId, reason, actor, requestId = null }) {
  return transaction(db, () => {
    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
    if (!instance) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
    if (INSTANCE_TERMINAL.has(instance.status)) {
      throw conflict(`流程实例已处于终态: ${instance.status}`, 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID');
    }
    const now = nowIso();
    db.prepare("UPDATE workflow_instances SET status='TERMINATED', terminated_at=?, cancel_reason=? WHERE id=?")
      .run(now, optionalText(reason, 200) || null, instance.id);
    db.prepare("UPDATE workflow_tasks SET status='CANCELLED', completed_at=? WHERE instance_id=? AND status='PENDING'")
      .run(now, instance.id);
    db.prepare("UPDATE workflow_node_instances SET status='CANCELLED', completed_at=? WHERE instance_id=? AND status IN ('PENDING','ACTIVE')")
      .run(now, instance.id);
    recordWorkflowEvent(db, instance, 'INSTANCE_TERMINATED', instance.status, 'TERMINATED', actor, { reason: reason ?? null });
    audit(db, actor.id, 'WORKFLOW_INSTANCE_TERMINATE', 'WORKFLOW_INSTANCE', instance.id,
      `终止流程实例${reason ? `：${reason}` : ''}`, { requestId });
    return db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
  });
  notifyWorkflowInstanceState(db, instance, 'WORKFLOW_INSTANCE_TERMINATED', '流程实例已终止', { requestId });
  return db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
}

/**
 * 重新部署：以模板的新版本对**显式指定**的实例集合重启。
 * 旧实例被终止并保留为历史，新实例以新版本启动。
 */
export function redeployWorkflowInstances(db, { instanceIds, versionId, actor, requestId = null }) {
  const targets = (instanceIds || []).map((value) => String(value).trim()).filter(Boolean);
  if (!targets.length) throw new HttpError(400, '重新部署必须显式指定实例集合');
  const results = [];
  for (const instanceId of targets) {
    const old = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
    if (!old) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
    terminateWorkflowInstance(db, { instanceId, reason: '重新部署', actor, requestId });
    const started = startWorkflowInstance(db, {
      templateId: old.template_id, versionId, documentType: old.document_type,
      documentId: old.document_id, orgId: old.org_id,
      variables: parseJson(old.variables_json, {}),
      idempotencyKey: `${old.document_type}:${old.document_id}:${versionId}`,
      actor, requestId,
    });
    results.push({ oldInstanceId: instanceId, newInstanceId: started.instance.id });
  }
  audit(db, actor.id, 'WORKFLOW_INSTANCE_REDEPLOY', 'WORKFLOW_TEMPLATE', versionId,
    `重新部署 ${targets.length} 个流程实例`, { requestId });
  return results;
}

// ---------------------------------------------------------------------------
// 试运行（定义校验的可视化）
// ---------------------------------------------------------------------------

/**
 * 试运行一个定义：以给定变量走一遍节点图，产出可达路径与每节点参与人解析结果。
 * **不产生任何业务副作用**（不建实例、不建任务）。
 */
export function testWorkflowDefinition(db, { definition, variables, orgId = '' }) {
  const parsed = validateWorkflowDefinition(parseWorkflowDefinition(definition));
  const path = [];
  const currentKey = parsed.entry;
  const visited = new Set();
  let key = currentKey;
  while (key && key !== WORKFLOW_END_NODE) {
    if (visited.has(key)) throw unprocessable('流程定义存在无法终止的循环', 'PLATFORM_WORKFLOW_DEFINITION_INVALID');
    visited.add(key);
    const node = parsed.nodes.find((candidate) => candidate.key === key);
    const participants = node.participants
      ? resolveWorkflowParticipants(db, node.participants, { variables: variables || {}, initiatorId: null })
      : [];
    const entry = { nodeKey: key, nodeType: node.type, participants };
    if (node.type === 'CONDITION') {
      const condition = validateWorkflowCondition(node.condition, `节点 ${key}`);
      const passed = evaluateWorkflowCondition(condition, variables || {});
      entry.branchTaken = passed ? 'TRUE' : 'FALSE';
      entry.matched = passed;
      path.push(entry);
      key = passed ? node.onTrue?.next : node.onFalse?.next;
      continue;
    }
    path.push(entry);
    break; // 人工节点在试运行中不推进 —— 试运行只展示第一跳。
  }
  return { entry: parsed.entry, path, organization: orgId };
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export async function listWorkflowTemplates(db, res, actor) {
  allow(actor, 'WORKFLOW_VIEW');
  const rows = db.prepare('SELECT * FROM workflow_templates ORDER BY code').all();
  return send(res, 200, { templates: rows.map(presentTemplate) });
}

export async function handleCreateWorkflowTemplate(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['code', 'name', 'documentType', 'definition']);
  const row = createWorkflowTemplate(db, {
    code: body.code, name: body.name, documentType: body.documentType,
    definition: body.definition, actor,
  });
  return send(res, 201, { template: presentTemplate(row) });
}

export async function getWorkflowTemplate(db, res, actor, templateId) {
  allow(actor, 'WORKFLOW_VIEW');
  const template = db.prepare('SELECT * FROM workflow_templates WHERE id=?').get(templateId);
  if (!template) throw notFound('流程模板不存在', 'PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND');
  const versions = db.prepare('SELECT * FROM workflow_template_versions WHERE template_id=? ORDER BY version DESC')
    .all(template.id);
  return send(res, 200, { template: presentTemplate(template), versions: versions.map(presentVersion) });
}

export async function handleCreateWorkflowVersion(db, req, res, actor, templateId) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['definition', 'changeNote']);
  const row = createWorkflowVersion(db, {
    templateId, definition: body.definition, changeNote: body.changeNote, actor,
  });
  return send(res, 201, { version: presentVersion(row) });
}

export async function handlePublishWorkflowVersion(db, req, res, actor, versionId) {
  allow(actor, 'WORKFLOW_MANAGE');
  const row = publishWorkflowVersion(db, { versionId, actor });
  return send(res, 200, { version: presentVersion(row) });
}

export async function handleRetireWorkflowVersion(db, req, res, actor, versionId) {
  allow(actor, 'WORKFLOW_MANAGE');
  const row = retireWorkflowVersion(db, { versionId, actor });
  return send(res, 200, { version: presentVersion(row) });
}

export async function listWorkflowBindings(db, res, actor) {
  allow(actor, 'WORKFLOW_VIEW');
  const rows = db.prepare('SELECT * FROM workflow_bindings ORDER BY document_type, org_id').all();
  return send(res, 200, { bindings: rows.map(presentBinding) });
}

export async function handleActivateWorkflowBinding(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['documentType', 'orgId', 'templateId', 'versionId', 'condition', 'priority']);
  const row = activateWorkflowBinding(db, {
    documentType: body.documentType, orgId: body.orgId, templateId: body.templateId,
    versionId: body.versionId, condition: body.condition, priority: body.priority, actor,
  });
  return send(res, 201, { binding: presentBinding(row) });
}

export async function listWorkflowInstances(db, res, actor, url) {
  allow(actor, 'WORKFLOW_INSTANCE_VIEW');
  const filters = [];
  const params = [];
  const status = url.searchParams.get('status');
  if (status) {
    filters.push('status=?');
    params.push(enumValue(status, INSTANCE_STATUS, '实例状态'));
  }
  const documentType = url.searchParams.get('documentType');
  if (documentType) {
    filters.push('document_type=?');
    params.push(requiredCode(documentType, '单据类型'));
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM workflow_instances${where} ORDER BY started_at DESC LIMIT 200`).all(...params);
  return send(res, 200, { instances: rows.map(presentInstance) });
}

export async function getWorkflowInstance(db, res, actor, instanceId) {
  allow(actor, 'WORKFLOW_INSTANCE_VIEW');
  const instance = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instanceId);
  if (!instance) throw notFound('流程实例不存在', 'PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND');
  const nodes = db.prepare('SELECT * FROM workflow_node_instances WHERE instance_id=? ORDER BY sequence_no').all(instance.id);
  const tasks = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=? ORDER BY created_at').all(instance.id);
  const events = db.prepare('SELECT * FROM workflow_events WHERE instance_id=? ORDER BY created_at').all(instance.id);
  return send(res, 200, {
    instance: presentInstance(instance),
    nodes: nodes.map(presentNodeInstance),
    tasks: tasks.map(presentTask),
    events: events.map((event) => ({
      id: event.id, eventType: event.event_type, fromStatus: event.from_status,
      toStatus: event.to_status, actorId: event.actor_id, detail: parseJson(event.detail_json, null),
      createdAt: event.created_at,
    })),
  });
}

export async function handleSuspendWorkflowInstance(db, req, res, actor, instanceId) {
  allow(actor, 'WORKFLOW_CONTROL');
  const body = await readJson(req);
  assertAllowedFields(body, ['reason']);
  const row = suspendWorkflowInstance(db, { instanceId, reason: body.reason, actor });
  return send(res, 200, { instance: presentInstance(row) });
}

export async function handleResumeWorkflowInstance(db, req, res, actor, instanceId) {
  allow(actor, 'WORKFLOW_CONTROL');
  const row = resumeWorkflowInstance(db, { instanceId, actor });
  return send(res, 200, { instance: presentInstance(row) });
}

export async function handleTerminateWorkflowInstance(db, req, res, actor, instanceId) {
  allow(actor, 'WORKFLOW_CONTROL');
  const body = await readJson(req);
  assertAllowedFields(body, ['reason']);
  const row = terminateWorkflowInstance(db, { instanceId, reason: body.reason, actor });
  return send(res, 200, { instance: presentInstance(row) });
}

export async function handleRedeployWorkflowInstances(db, req, res, actor) {
  allow(actor, 'WORKFLOW_REDEPLOY');
  const body = await readJson(req);
  assertAllowedFields(body, ['instanceIds', 'versionId']);
  const results = redeployWorkflowInstances(db, {
    instanceIds: body.instanceIds, versionId: body.versionId, actor,
  });
  return send(res, 200, { redeployed: results });
}

export async function listWorkflowTasks(db, res, actor) {
  allow(actor, 'WORKFLOW_TASK_VIEW');
  const rows = db.prepare(
    "SELECT * FROM workflow_tasks WHERE assignee_id=? ORDER BY (status='PENDING') DESC, created_at DESC LIMIT 200",
  ).all(actor.id);
  return send(res, 200, { tasks: rows.map(presentTask) });
}

export async function handleCompleteWorkflowTask(db, req, res, actor, taskId) {
  allow(actor, 'WORKFLOW_TASK_ACT');
  const body = await readJson(req);
  assertAllowedFields(body, ['action', 'comment', 'payload']);
  const action = enumValue(body.action, WORKFLOW_TASK_ACTIONS, '任务动作');
  const result = completeWorkflowTask(db, {
    taskId, actor, action, comment: body.comment, payload: body.payload ?? null,
  });
  return send(res, 200, { result });
}

export async function testWorkflowRun(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['definition', 'variables', 'orgId']);
  const result = testWorkflowDefinition(db, {
    definition: body.definition, variables: body.variables ?? {}, orgId: body.orgId ?? '',
  });
  return send(res, 200, { result });
}
