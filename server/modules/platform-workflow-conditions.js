// Platform 通用工作流引擎 —— 定义校验、条件求值与参与人解析。
//
// 设计来源：docs/design/platform.md §32.3.1（调用与数据流）、§32.3.2（状态机）、
// Requirement §36.3.1（流程定义）。
//
// 三条硬约束：
//   1. 条件求值**不执行任何脚本**。字段路径与运算符都是白名单；字段路径只能读
//      传入的 variables 普通对象，禁止原型链（__proto__ / constructor / prototype）。
//   2. 定义校验是**结构合法性**判定（入口存在、无孤立节点、每条路径都能到达 END），
//      它不判断业务语义 —— 业务语义由业务域的绑定条件负责。
//   3. 参与人解析把结果**物化成快照**：角色成员在解析那一刻确定，之后角色变更
//      不会让已物化的任务漂移（Design §32.3.2）。

import { HttpError } from '../lib/http.js';

export const WORKFLOW_NODE_TYPES = Object.freeze([
  'APPROVAL', 'PARALLEL_APPROVAL', 'CONDITION', 'NOTIFY', 'CC', 'END',
]);

/** 需要人工参与、会阻塞流程的节点类型。 */
export const WORKFLOW_BLOCKING_NODE_TYPES = Object.freeze(['APPROVAL', 'PARALLEL_APPROVAL']);

/** 只知会、不阻塞流程的节点类型。 */
export const WORKFLOW_NOTIFYING_NODE_TYPES = Object.freeze(['NOTIFY', 'CC']);

/**
 * 参与人类型白名单。
 *
 * `INITIATOR_MANAGER` **不可用**：本仓库的 `users` 表没有部门归属，
 * `departments.manager` 是自由文本且从未被查询使用 —— 没有权威的上级来源，
 * 不得凭空发明（AGENTS.md §6「未知历史事实不得伪造」）。
 * 需要「发起人的上级」时，先建立用户↔部门归属，再把该类型加回白名单。
 */
export const WORKFLOW_PARTICIPANT_TYPES = Object.freeze(['ROLE', 'USER', 'INITIATOR', 'FIELD_USER']);

export const WORKFLOW_CONDITION_OPERATORS = Object.freeze(['=', '!=', '>', '>=', '<', '<=', 'in', 'contains']);

const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;
const NODE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROLE_CODE_RE = /^[A-Za-z0-9_-]{1,50}$/;
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 终态节点的保留标识 —— 任何节点都可以把后继指向它。 */
export const WORKFLOW_END_NODE = 'END';

function definitionError(message) {
  return new HttpError(422, message, { code: 'PLATFORM_WORKFLOW_DEFINITION_INVALID' });
}

function conditionError(message) {
  return new HttpError(422, message, { code: 'PLATFORM_WORKFLOW_CONDITION_INVALID' });
}

function participantError(message) {
  return new HttpError(409, message, { code: 'PLATFORM_WORKFLOW_PARTICIPANT_UNRESOLVED' });
}

/** 读取白名单字段路径；只读传入对象的自有属性，禁止原型链。 */
function readVariable(variables, path) {
  const parts = String(path).split('.');
  let current = variables;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    if (FORBIDDEN_PATH_KEYS.has(part)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function sameScalar(left, right) {
  if (left === null || right === null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (typeof left === 'boolean' || typeof right === 'boolean') return left === right;
  return String(left) === String(right);
}

/** 校验一个条件表达式；返回归一化后的条件。 */
export function validateWorkflowCondition(condition, label = '条件') {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw conditionError(`${label} 缺少条件定义`);
  }
  const field = String(condition.field ?? '').trim();
  if (!FIELD_PATH_RE.test(field)) throw conditionError(`${label} 的字段路径非法: ${field}`);
  if (FORBIDDEN_PATH_KEYS.has(field.split('.')[0])) throw conditionError(`${label} 的字段路径非法: ${field}`);
  const op = String(condition.op ?? '').trim();
  if (!WORKFLOW_CONDITION_OPERATORS.includes(op)) throw conditionError(`${label} 的运算符不在白名单: ${op}`);
  if (op === 'in' && !Array.isArray(condition.value)) throw conditionError(`${label} 的 in 运算符要求数组取值`);
  if (op === 'contains' && condition.value === undefined) throw conditionError(`${label} 的 contains 运算符要求取值`);
  return { field, op, value: condition.value };
}

/**
 * 校验一个流程定义（节点图）。
 *
 * 通过条件：入口存在且可达全部节点、每个节点都能到达 END、参与人与条件合法、
 * 审批节点必须声明 onApprove、条件节点必须声明 onTrue / onFalse。
 * 条件分支允许成环 —— 合法性由「可达 END」保证，而不是禁止环。
 *
 * @returns {{entry: string, nodes: object[], edges: Map<string, string[]>}}
 */
export function validateWorkflowDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw definitionError('流程定义必须是对象');
  }
  const nodes = definition.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) throw definitionError('流程定义必须至少包含一个节点');

  const byKey = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw definitionError('流程节点必须是对象');
    const key = String(node.key ?? '').trim();
    if (!NODE_KEY_RE.test(key)) throw definitionError(`节点标识非法: ${key}`);
    if (byKey.has(key)) throw definitionError(`节点标识重复: ${key}`);
    if (!WORKFLOW_NODE_TYPES.includes(node.type)) throw definitionError(`节点类型非法: ${node.type}`);
    byKey.set(key, node);
  }

  const edges = new Map();
  for (const [key, node] of byKey) {
    const targets = [];
    for (const field of ['onApprove', 'onReject', 'onTrue', 'onFalse']) {
      const edge = node[field];
      if (edge === undefined || edge === null) continue;
      const next = typeof edge === 'string' ? edge : edge.next;
      if (typeof next !== 'string' || !next.trim()) throw definitionError(`节点 ${key} 的 ${field} 指向非法`);
      if (next !== WORKFLOW_END_NODE && !byKey.has(next)) {
        throw definitionError(`节点 ${key} 的 ${field} 指向不存在的节点 ${next}`);
      }
      targets.push(next);
    }
    edges.set(key, targets);
  }

  const entry = String(definition.entry ?? '').trim();
  if (!entry || !byKey.has(entry)) throw definitionError('流程定义缺少合法的入口节点');
  if (byKey.get(entry).type === 'END') throw definitionError('入口节点不能是结束节点');

  for (const [key, node] of byKey) {
    const needsParticipants = WORKFLOW_BLOCKING_NODE_TYPES.includes(node.type)
      || WORKFLOW_NOTIFYING_NODE_TYPES.includes(node.type);
    if (needsParticipants) {
      if (!Array.isArray(node.participants) || node.participants.length === 0) {
        throw definitionError(`节点 ${key} 缺少参与人`);
      }
      for (const participant of node.participants) {
        if (!participant || typeof participant !== 'object') throw definitionError(`节点 ${key} 的参与人定义非法`);
        if (!WORKFLOW_PARTICIPANT_TYPES.includes(participant.type)) {
          throw definitionError(`节点 ${key} 的参与人类型非法: ${participant.type}`);
        }
        const value = String(participant.value ?? '').trim();
        if (participant.type === 'USER' && !value) throw definitionError(`节点 ${key} 的参与人缺少用户`);
        if (participant.type === 'ROLE' && !ROLE_CODE_RE.test(value)) {
          throw definitionError(`节点 ${key} 的参与人角色码非法: ${value}`);
        }
        if (participant.type === 'FIELD_USER' && !FIELD_PATH_RE.test(value)) {
          throw definitionError(`节点 ${key} 的参与人字段路径非法: ${value}`);
        }
      }
    }
    if (node.type === 'CONDITION') {
      validateWorkflowCondition(node.condition, `节点 ${key}`);
      if (!node.onTrue || !node.onFalse) throw definitionError(`条件节点 ${key} 必须声明 onTrue 与 onFalse`);
    }
    if (WORKFLOW_BLOCKING_NODE_TYPES.includes(node.type) && !node.onApprove) {
      throw definitionError(`审批节点 ${key} 必须声明 onApprove`);
    }
  }

  // 无孤立节点：从入口可达全部节点。
  const reachable = new Set();
  const walk = (key) => {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const target of edges.get(key) || []) if (target !== WORKFLOW_END_NODE) walk(target);
  };
  walk(entry);
  for (const key of byKey.keys()) {
    if (!reachable.has(key)) throw definitionError(`节点 ${key} 从入口不可达`);
  }

  // 每条路径都能终止：反向可达 END。
  const reverse = new Map();
  for (const [key, targets] of edges) {
    for (const target of targets) {
      if (!reverse.has(target)) reverse.set(target, []);
      reverse.get(target).push(key);
    }
  }
  const reachesEnd = new Set([WORKFLOW_END_NODE]);
  const stack = [WORKFLOW_END_NODE];
  while (stack.length) {
    const current = stack.pop();
    for (const from of reverse.get(current) || []) {
      if (!reachesEnd.has(from)) {
        reachesEnd.add(from);
        stack.push(from);
      }
    }
  }
  for (const key of byKey.keys()) {
    if (!reachesEnd.has(key)) throw definitionError(`节点 ${key} 没有通往结束节点的路径`);
  }

  return { entry, nodes: [...byKey.values()], edges };
}

/** 求值一个已通过校验的条件。变量缺失一律视为 false，不抛错。 */
export function evaluateWorkflowCondition(condition, variables) {
  const value = readVariable(variables || {}, condition.field);
  if (value === undefined) return false;
  const expected = condition.value;
  switch (condition.op) {
    case '=': return sameScalar(value, expected);
    case '!=': return !sameScalar(value, expected);
    case '>': case '>=': case '<': case '<=': {
      if (typeof value !== 'number' || typeof expected !== 'number') return false;
      if (condition.op === '>') return value > expected;
      if (condition.op === '>=') return value >= expected;
      if (condition.op === '<') return value < expected;
      return value <= expected;
    }
    case 'in': return Array.isArray(expected) && expected.some((item) => sameScalar(value, item));
    case 'contains': {
      if (typeof value === 'string') return typeof expected === 'string' && value.includes(expected);
      if (Array.isArray(value)) return value.some((item) => sameScalar(item, expected));
      return false;
    }
    default: return false;
  }
}

function assertActiveUser(db, userId) {
  const user = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(String(userId));
  if (!user) throw participantError(`参与人不存在或已停用: ${userId}`);
  return user.id;
}

/**
 * 解析参与人为具体用户 id 列表（去重且保持顺序）。
 *
 * @param {object} db
 * @param {Array<{type: string, value?: string}>} participants
 * @param {{variables?: object, initiatorId?: string|null}} context
 * @returns {string[]}
 */
export function resolveWorkflowParticipants(db, participants, context) {
  const variables = context?.variables || {};
  const initiatorId = context?.initiatorId || null;
  const resolved = [];
  const add = (userId) => {
    if (!userId) return;
    if (!resolved.includes(userId)) resolved.push(userId);
  };
  for (const participant of participants || []) {
    if (participant.type === 'USER') {
      add(assertActiveUser(db, participant.value));
    } else if (participant.type === 'ROLE') {
      const users = db.prepare(
        'SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code=? AND u.active=1 ORDER BY u.id',
      ).all(String(participant.value).toUpperCase());
      for (const user of users) add(user.id);
    } else if (participant.type === 'INITIATOR') {
      add(initiatorId);
    } else if (participant.type === 'FIELD_USER') {
      const value = readVariable(variables, participant.value);
      if (typeof value === 'string' && value.trim()) add(assertActiveUser(db, value.trim()));
    }
  }
  return resolved;
}

/** 列出角色下的启用用户（供 SOD 升级与任务改派使用）。 */
export function listRoleUserIds(db, roleCode) {
  return db.prepare(
    'SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code=? AND u.active=1 ORDER BY u.id',
  ).all(String(roleCode).toUpperCase()).map((row) => row.id);
}
