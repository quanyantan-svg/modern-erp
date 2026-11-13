// Platform 通用工作流引擎 —— 合同测试（docs/design/platform.md §32.3）。
//
// 覆盖：定义校验、条件白名单求值、参与人解析、绑定解析、实例启动幂等、
// 任务完成的状态机与乐观锁、SOD 拒绝、动作失败的整体回滚、实例控制与重新部署。
//
// 本文件同时锁定两条跨域不变式：
//   - 通用引擎**不得**在 /api/approvals/** 下新增变更入口；
//   - 既有 6 个审批族的 canonical 路径不被通用引擎接管。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createDatabase } from './db.js';
import {
  activateWorkflowBinding, completeWorkflowTask, createWorkflowTemplate, createWorkflowVersion,
  publishWorkflowVersion, redeployWorkflowInstances, registerWorkflowActionHandler,
  resolveWorkflowBinding, resumeWorkflowInstance, retireWorkflowVersion, startWorkflowInstance,
  suspendWorkflowInstance, terminateWorkflowInstance, testWorkflowDefinition,
} from './modules/platform-workflow-engine.js';
import {
  evaluateWorkflowCondition, resolveWorkflowParticipants, validateWorkflowDefinition,
} from './modules/platform-workflow-conditions.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let db;
let tempDir;

const ADMIN = { id: 'user-admin', permissions: ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE', 'WORKFLOW_TASK_VIEW', 'WORKFLOW_TASK_ACT', 'WORKFLOW_INSTANCE_VIEW', 'WORKFLOW_CONTROL', 'WORKFLOW_REDEPLOY'] };
const SALES = { id: 'user-sales', permissions: ['WORKFLOW_VIEW', 'WORKFLOW_TASK_VIEW', 'WORKFLOW_TASK_ACT'] };
const REVIEWER = { id: 'user-reviewer', permissions: ['WORKFLOW_VIEW', 'WORKFLOW_TASK_VIEW', 'WORKFLOW_TASK_ACT'] };

const SIMPLE_DEFINITION = {
  entry: 'approve',
  nodes: [
    { key: 'approve', type: 'APPROVAL', name: '审批', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'END' } },
  ],
};

const CONDITIONAL_DEFINITION = {
  entry: 'check',
  nodes: [
    {
      key: 'check', type: 'CONDITION', name: '金额判定',
      condition: { field: 'amountCents', op: '>', value: 1000 },
      onTrue: { next: 'big' }, onFalse: { next: 'small' },
    },
    { key: 'big', type: 'APPROVAL', name: '大额审批', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'END' } },
    { key: 'small', type: 'APPROVAL', name: '小额审批', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'END' } },
  ],
};

const PARALLEL_DEFINITION = {
  entry: 'joint',
  nodes: [
    {
      key: 'joint', type: 'PARALLEL_APPROVAL', name: '会签',
      participants: [{ type: 'USER', value: 'user-admin' }, { type: 'USER', value: 'user-reviewer' }],
      onApprove: { next: 'END' },
    },
  ],
};

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'erp-workflow-engine-'));
  db = createDatabase(join(tempDir, 'workflow.db'));
});

after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  rmSync(tempDir, { recursive: true, force: true });
});

function publishedTemplate(definition, { code, documentType = 'TEST_DOC' } = {}) {
  const template = createWorkflowTemplate(db, {
    code: code || `TPL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: '测试流程',
    documentType,
    definition,
    actor: ADMIN,
  });
  const version = db.prepare('SELECT * FROM workflow_template_versions WHERE template_id=? ORDER BY version DESC').get(template.id);
  publishWorkflowVersion(db, { versionId: version.id, actor: ADMIN });
  return { template, versionId: version.id };
}

describe('WF-DEF 流程定义校验', () => {
  test('合法定义通过校验', () => {
    const definition = validateWorkflowDefinition(SIMPLE_DEFINITION);
    assert.equal(definition.entry, 'approve');
    assert.equal(definition.nodes.length, 1);
  });

  test('缺入口、未知节点类型、指向不存在节点、无孤立节点、无结束路径、审批节点缺 onApprove 均被拒绝', () => {
    const cases = [
      [{ nodes: SIMPLE_DEFINITION.nodes }, '缺入口'],
      [{ entry: 'a', nodes: [{ key: 'a', type: 'NOPE', participants: [], onApprove: { next: 'END' } }] }, '未知节点类型'],
      [{ entry: 'a', nodes: [{ key: 'a', type: 'APPROVAL', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'ghost' } }] }, '指向不存在的节点'],
      [{
        entry: 'a',
        nodes: [
          { key: 'a', type: 'APPROVAL', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'END' } },
          { key: 'lonely', type: 'APPROVAL', participants: [{ type: 'USER', value: 'user-admin' }], onApprove: { next: 'END' } },
        ],
      }, '孤立节点'],
      [{
        entry: 'a',
        nodes: [{ key: 'a', type: 'APPROVAL', participants: [{ type: 'USER', value: 'user-admin' }] }],
      }, '没有通往结束的路径'],
      [{
        entry: 'a',
        nodes: [{ key: 'a', type: 'APPROVAL', participants: [{ type: 'USER', value: 'user-admin' }] }],
      }, '审批节点缺 onApprove'],
    ];
    for (const [definition, label] of cases) {
      assert.throws(
        () => validateWorkflowDefinition(definition),
        (error) => error.code === 'PLATFORM_WORKFLOW_DEFINITION_INVALID',
        `${label} 必须被判为定义非法`,
      );
    }
  });

  test('条件节点必须声明 onTrue / onFalse', () => {
    assert.throws(
      () => validateWorkflowDefinition({
        entry: 'c',
        nodes: [{ key: 'c', type: 'CONDITION', condition: { field: 'a', op: '=', value: 1 }, onTrue: { next: 'END' } }],
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_DEFINITION_INVALID',
    );
  });

  test('参与人类型 INITIATOR_MANAGER 不在白名单（当前 schema 没有用户↔部门归属）', () => {
    assert.throws(
      () => validateWorkflowDefinition({
        entry: 'a',
        nodes: [{ key: 'a', type: 'APPROVAL', participants: [{ type: 'INITIATOR_MANAGER' }], onApprove: { next: 'END' } }],
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_DEFINITION_INVALID',
      '不得凭空发明没有权威来源的参与人类型',
    );
  });

  test('条件运算符与字段路径受白名单约束', () => {
    assert.throws(
      () => validateWorkflowDefinition({
        entry: 'c',
        nodes: [{
          key: 'c', type: 'CONDITION', condition: { field: 'a', op: 'exec', value: 1 },
          onTrue: { next: 'END' }, onFalse: { next: 'END' },
        }],
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_CONDITION_INVALID',
      '非白名单运算符必须被拒绝',
    );
    assert.throws(
      () => validateWorkflowDefinition({
        entry: 'c',
        nodes: [{
          key: 'c', type: 'CONDITION', condition: { field: '__proto__.polluted', op: '=', value: 1 },
          onTrue: { next: 'END' }, onFalse: { next: 'END' },
        }],
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_CONDITION_INVALID',
      '原型链字段路径必须被拒绝',
    );
  });
});

describe('WF-COND 条件白名单求值', () => {
  test('八个运算符按白名单语义求值', () => {
    const variables = { amountCents: 500, label: 'abc', tag: 'x', list: ['a', 'b'] };
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '=', value: 500 }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '!=', value: 500 }, variables), false);
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '>', value: 100 }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '>=', value: 500 }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '<', value: 100 }, variables), false);
    assert.equal(evaluateWorkflowCondition({ field: 'amountCents', op: '<=', value: 500 }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'tag', op: 'in', value: ['x', 'y'] }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'label', op: 'contains', value: 'bc' }, variables), true);
    assert.equal(evaluateWorkflowCondition({ field: 'list', op: 'contains', value: 'b' }, variables), true);
  });

  test('变量缺失一律 false，且不抛错', () => {
    assert.equal(evaluateWorkflowCondition({ field: 'missing', op: '=', value: 1 }, {}), false);
  });

  test('原型链不可达', () => {
    assert.equal(evaluateWorkflowCondition({ field: '__proto__.polluted', op: '=', value: 1 }, {}), false);
    assert.equal({}.polluted, undefined);
  });
});

describe('WF-PART 参与人解析', () => {
  test('USER / ROLE / INITIATOR / FIELD_USER 四种类型', () => {
    assert.deepEqual(
      resolveWorkflowParticipants(db, [{ type: 'USER', value: 'user-admin' }], {}),
      ['user-admin'],
    );
    const roleMembers = resolveWorkflowParticipants(db, [{ type: 'ROLE', value: 'REVIEWER' }], {});
    assert.ok(roleMembers.includes('user-reviewer'));
    assert.deepEqual(
      resolveWorkflowParticipants(db, [{ type: 'INITIATOR' }], { initiatorId: 'user-sales' }),
      ['user-sales'],
    );
    assert.deepEqual(
      resolveWorkflowParticipants(db, [{ type: 'FIELD_USER', value: 'ownerId' }], { variables: { ownerId: 'user-reviewer' } }),
      ['user-reviewer'],
    );
  });

  test('参与人不存在或已停用时失败即拒绝', () => {
    assert.throws(
      () => resolveWorkflowParticipants(db, [{ type: 'USER', value: 'user-ghost' }], {}),
      (error) => error.code === 'PLATFORM_WORKFLOW_PARTICIPANT_UNRESOLVED',
    );
  });

  test('同一参与人被多��规则命中时只出现一次', () => {
    const resolved = resolveWorkflowParticipants(db, [
      { type: 'USER', value: 'user-admin' },
      { type: 'INITIATOR' },
    ], { initiatorId: 'user-admin' });
    assert.deepEqual(resolved, ['user-admin']);
  });
});

describe('WF-BIND 绑定解析', () => {
  test('组织维度的绑定优先于全局绑定', () => {
    const { versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'BIND-GLOBAL', documentType: 'BIND_DOC' });
    const globalBinding = activateWorkflowBinding(db, {
      documentType: 'BIND_DOC', orgId: '', versionId, actor: ADMIN,
    });
    const { versionId: orgVersionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'BIND-ORG', documentType: 'BIND_DOC' });
    const orgBinding = activateWorkflowBinding(db, {
      documentType: 'BIND_DOC', orgId: 'ORG-1', versionId: orgVersionId, actor: ADMIN,
    });
    const resolved = resolveWorkflowBinding(db, { documentType: 'BIND_DOC', orgId: 'ORG-1' });
    assert.equal(resolved.id, orgBinding.id);
    assert.notEqual(resolved.id, globalBinding.id);
    const fallback = resolveWorkflowBinding(db, { documentType: 'BIND_DOC', orgId: 'ORG-2' });
    assert.equal(fallback.id, globalBinding.id);
  });

  test('没有生效绑定时失败即拒绝（不得静默跳过审批）', () => {
    assert.throws(
      () => resolveWorkflowBinding(db, { documentType: 'NO_BINDING_DOC', orgId: '' }),
      (error) => error.code === 'PLATFORM_WORKFLOW_BINDING_NOT_FOUND',
    );
  });

  test('条件不匹配的绑定不生效，回落到全局绑定', () => {
    const { versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'BIND-COND', documentType: 'COND_DOC' });
    activateWorkflowBinding(db, {
      documentType: 'COND_DOC', orgId: 'ORG-A', versionId,
      condition: { field: 'amountCents', op: '>', value: 100000 }, actor: ADMIN,
    });
    activateWorkflowBinding(db, { documentType: 'COND_DOC', orgId: '', versionId, actor: ADMIN });
    const resolved = resolveWorkflowBinding(db, { documentType: 'COND_DOC', orgId: 'ORG-A', variables: { amountCents: 10 } });
    assert.equal(resolved.org_id, '');
  });
});

describe('WF-INSTANCE 实例与任务', () => {
  test('启动实例：物化节点与首批任务，状态 RUNNING', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-1', documentType: 'INST_DOC' });
    const { instance, replayed } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'INST_DOC', documentId: 'DOC-1',
      variables: {}, actor: ADMIN,
    });
    assert.equal(replayed, false);
    assert.equal(instance.status, 'RUNNING');
    const nodes = db.prepare('SELECT * FROM workflow_node_instances WHERE instance_id=?').all(instance.id);
    assert.equal(nodes.length, 1);
    const tasks = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').all(instance.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assignee_id, 'user-admin');
    assert.equal(tasks[0].status, 'PENDING');
  });

  test('幂等：同一 业务单据 + 版本 重复启动返回既有实例而不是 409', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-IDEM', documentType: 'IDEM_DOC' });
    const first = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'IDEM_DOC', documentId: 'DOC-9', variables: {}, actor: ADMIN,
    });
    const second = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'IDEM_DOC', documentId: 'DOC-9', variables: {}, actor: ADMIN,
    });
    assert.equal(second.replayed, true);
    assert.equal(second.instance.id, first.instance.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_instances WHERE document_id=?').get('DOC-9').n, 1);
  });

  test('未发布的版本不能启动实例', () => {
    const template = createWorkflowTemplate(db, {
      code: 'INST-DRAFT', name: '草稿流程', documentType: 'DRAFT_DOC', definition: SIMPLE_DEFINITION, actor: ADMIN,
    });
    const version = db.prepare('SELECT * FROM workflow_template_versions WHERE template_id=?').get(template.id);
    assert.throws(
      () => startWorkflowInstance(db, {
        templateId: template.id, versionId: version.id, documentType: 'DRAFT_DOC', documentId: 'D-1', variables: {}, actor: ADMIN,
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_VERSION_NOT_PUBLISHED',
    );
  });

  test('完成任务：任务与节点完成，实例走完流程后 COMPLETED', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-DONE', documentType: 'DONE_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'DONE_DOC', documentId: 'DONE-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    const result = completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' });
    assert.equal(result.completed, true);
    const after = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
    assert.equal(after.status, 'COMPLETED');
    assert.equal(db.prepare('SELECT status FROM workflow_tasks WHERE id=?').get(task.id).status, 'COMPLETED');
  });

  test('任务只能完成一次', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-ONCE', documentType: 'ONCE_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'ONCE_DOC', documentId: 'ONCE-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' });
    assert.throws(
      () => completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' }),
      (error) => error.code === 'PLATFORM_WORKFLOW_TASK_ALREADY_COMPLETED'
        || error.code === 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID',
    );
  });

  test('并发完成：过期 row_version 影响 0 行（乐观锁守卫），当前版本仍可正常完成', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-RACE', documentType: 'RACE_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'RACE_DOC', documentId: 'RACE-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    // 引擎的 UPDATE 带 row_version 谓词；过期版本必须影响 0 行 —— 这正是
    // PLATFORM_WORKFLOW_TASK_CONFLICT 的判定依据。
    const stale = db.prepare(
      "UPDATE workflow_tasks SET status='COMPLETED', row_version=row_version+1 WHERE id=? AND status='PENDING' AND row_version=?",
    ).run(task.id, task.row_version + 999);
    assert.equal(stale.changes, 0, '过期 row_version 必须影响 0 行');
    assert.equal(db.prepare('SELECT status FROM workflow_tasks WHERE id=?').get(task.id).status, 'PENDING',
      '乐观锁失败不得改变任务状态');
    // 当前 row_version 未被顶高，因此合法完成必须照常成功（守卫不得误伤）。
    const result = completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' });
    assert.equal(result.completed, true);
    assert.equal(db.prepare('SELECT status FROM workflow_tasks WHERE id=?').get(task.id).status, 'COMPLETED');
  });

  test('条件分支按变量走正确的后继节点', () => {
    const { template, versionId } = publishedTemplate(CONDITIONAL_DEFINITION, { code: 'INST-COND', documentType: 'COND_INST' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'COND_INST', documentId: 'COND-1',
      variables: { amountCents: 5000 }, actor: ADMIN,
    });
    const tasks = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').all(instance.id);
    assert.equal(tasks.length, 1);
    const node = db.prepare('SELECT * FROM workflow_node_instances WHERE instance_id=? AND node_key=?').get(instance.id, 'big');
    assert.equal(node.status, 'ACTIVE');
    const conditionNode = db.prepare('SELECT * FROM workflow_node_instances WHERE instance_id=? AND node_key=?').get(instance.id, 'check');
    assert.equal(conditionNode.branch_taken, 'TRUE');
  });

  test('会签节点：全部任务完成前节点不推进', () => {
    const { template, versionId } = publishedTemplate(PARALLEL_DEFINITION, { code: 'INST-PARA', documentType: 'PARA_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'PARA_DOC', documentId: 'PARA-1', variables: {}, actor: ADMIN,
    });
    const tasks = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=? ORDER BY assignee_id').all(instance.id);
    assert.equal(tasks.length, 2);
    completeWorkflowTask(db, { taskId: tasks[0].id, actor: tasks[0].assignee_id === 'user-admin' ? ADMIN : REVIEWER, action: 'APPROVE' });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'RUNNING',
      '还有一个待办时实例不得完成');
    const remaining = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=? AND status=\'PENDING\'').get(instance.id);
    completeWorkflowTask(db, { taskId: remaining.id, actor: remaining.assignee_id === 'user-admin' ? ADMIN : REVIEWER, action: 'APPROVE' });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'COMPLETED');
  });

  test('SOD 拒绝：发起人不得审批自己发起的任务', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-SOD', documentType: 'SOD_DOC' });
    db.prepare(
      "INSERT INTO sod_rules(id, code, business_type, action, constraint_type, resolution, escalate_to_role, status, created_by, created_at, updated_at)"
      + " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run('sod-rule-wf', 'SOD-WF-SAME-PERSON', 'WORKFLOW_TASK', 'APPROVE', 'SAME_PERSON_FORBIDDEN', 'REJECT', null, 'ACTIVE', 'user-admin', new Date().toISOString(), new Date().toISOString());
    try {
      // 发起人即审批人 → 违反职责分离。
      const { instance } = startWorkflowInstance(db, {
        templateId: template.id, versionId, documentType: 'SOD_DOC', documentId: 'SOD-1', variables: {}, actor: ADMIN,
      });
      const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
      assert.throws(
        () => completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' }),
        (error) => error.code === 'PLATFORM_WORKFLOW_SOD_REJECTED',
      );
      assert.equal(db.prepare('SELECT status FROM workflow_tasks WHERE id=?').get(task.id).status, 'PENDING',
        'SOD 拒绝不得改变任务状态');

      // 发起人是别人 → 不违反，任务正常完成。
      const other = startWorkflowInstance(db, {
        templateId: template.id, versionId, documentType: 'SOD_DOC', documentId: 'SOD-2', variables: {}, actor: SALES,
      });
      const otherTask = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(other.instance.id);
      completeWorkflowTask(db, { taskId: otherTask.id, actor: ADMIN, action: 'APPROVE' });
      assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(other.instance.id).status, 'COMPLETED');
    } finally {
      // 规则一旦产生过判定记录就**物理无法删除**（sod_evaluations.rule_id 外键为 NO ACTION，
      // 判定记录是历史证据）—— 因此只能停用。
      db.prepare("UPDATE sod_rules SET status='INACTIVE' WHERE id=?").run('sod-rule-wf');
    }
  });

  test('只有被指派的参与人可以处理任务', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'INST-ASSIGN', documentType: 'ASSIGN_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'ASSIGN_DOC', documentId: 'ASSIGN-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    assert.equal(task.assignee_id, 'user-admin');
    assert.throws(
      () => completeWorkflowTask(db, { taskId: task.id, actor: REVIEWER, action: 'APPROVE' }),
      (error) => error.code === 'PLATFORM_WORKFLOW_TASK_NOT_ASSIGNED',
      '权限码只说明"可以做这类事"，不代表可以做别人��事',
    );
  });

  test('节点动作失败时整体回滚：任务保持 PENDING，实例不推进', () => {
    const definition = {
      entry: 'approve',
      nodes: [{
        key: 'approve', type: 'APPROVAL', name: '审批',
        participants: [{ type: 'USER', value: 'user-admin' }],
        action: { type: 'FORM_WRITE', target: 'ALWAYS_FAIL' },
        onApprove: { next: 'END' },
      }],
    };
    registerWorkflowActionHandler({
      type: 'FORM_WRITE', target: 'ALWAYS_FAIL', handler: () => { throw new Error('故意失败'); },
    });
    const { template, versionId } = publishedTemplate(definition, { code: 'INST-ACTION', documentType: 'ACTION_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'ACTION_DOC', documentId: 'ACTION-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    assert.throws(
      () => completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' }),
      (error) => error.code === 'PLATFORM_WORKFLOW_ACTION_FAILED',
    );
    assert.equal(db.prepare('SELECT status FROM workflow_tasks WHERE id=?').get(task.id).status, 'PENDING',
      '动作失败必须整体回滚，副作用为零');
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'RUNNING');
  });
});

describe('WF-CONTROL 实例控制', () => {
  test('暂停 → 任务不可完成 → 恢复 → 终止', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'CTL-1', documentType: 'CTL_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'CTL_DOC', documentId: 'CTL-1', variables: {}, actor: ADMIN,
    });
    const task = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').get(instance.id);
    suspendWorkflowInstance(db, { instanceId: instance.id, reason: '等待补充资料', actor: ADMIN });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'SUSPENDED');
    assert.throws(
      () => completeWorkflowTask(db, { taskId: task.id, actor: ADMIN, action: 'APPROVE' }),
      (error) => error.code === 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID',
      '暂停期间任务不得完成',
    );
    const resumed = db.prepare('SELECT * FROM workflow_instances WHERE id=?').get(instance.id);
    assert.equal(resumed.status, 'SUSPENDED');
    resumeWorkflowInstance(db, { instanceId: instance.id, actor: ADMIN });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'RUNNING',
      '恢复后实例回到 RUNNING');
    terminateWorkflowInstance(db, { instanceId: instance.id, reason: '收尾', actor: ADMIN });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'TERMINATED');
  });

  test('终止实例：未完成任务取消，且不产生业务副作用', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'CTL-2', documentType: 'TERM_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'TERM_DOC', documentId: 'TERM-1', variables: {}, actor: ADMIN,
    });
    terminateWorkflowInstance(db, { instanceId: instance.id, reason: '业务取消', actor: ADMIN });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'TERMINATED');
    const tasks = db.prepare('SELECT * FROM workflow_tasks WHERE instance_id=?').all(instance.id);
    assert.equal(tasks[0].status, 'CANCELLED');
  });

  test('终态实例不可再终止', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'CTL-3', documentType: 'TERM2_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'TERM2_DOC', documentId: 'TERM2-1', variables: {}, actor: ADMIN,
    });
    terminateWorkflowInstance(db, { instanceId: instance.id, reason: 'x', actor: ADMIN });
    assert.throws(
      () => terminateWorkflowInstance(db, { instanceId: instance.id, reason: 'again', actor: ADMIN }),
      (error) => error.code === 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID',
    );
  });

  test('重新部署：旧实例终止，新实例按新版本启动', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'CTL-4', documentType: 'REDEP_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'REDEP_DOC', documentId: 'REDEP-1', variables: {}, actor: ADMIN,
    });
    const nextVersion = createWorkflowVersion(db, {
      templateId: template.id, definition: SIMPLE_DEFINITION, changeNote: 'v2', actor: ADMIN,
    });
    publishWorkflowVersion(db, { versionId: nextVersion.id, actor: ADMIN });
    const results = redeployWorkflowInstances(db, {
      instanceIds: [instance.id], versionId: nextVersion.id, actor: ADMIN,
    });
    assert.equal(results.length, 1);
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'TERMINATED');
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(results[0].newInstanceId).status, 'RUNNING');
    assert.equal(db.prepare('SELECT version_id FROM workflow_instances WHERE id=?').get(results[0].newInstanceId).version_id, nextVersion.id);
  });

  test('重新部署必须显式指定实例集合', () => {
    assert.throws(
      () => redeployWorkflowInstances(db, { instanceIds: [], versionId: 'x', actor: ADMIN }),
      (error) => error.status === 400,
    );
  });
});

describe('WF-PUBLISH 版本生命周期', () => {
  test('已发布版本不可再次发布，也不可回到草稿', () => {
    const { versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'PUB-1', documentType: 'PUB_DOC' });
    assert.throws(
      () => publishWorkflowVersion(db, { versionId, actor: ADMIN }),
      (error) => error.code === 'PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID',
    );
  });

  test('停用版本后不能启动新实例，已启动实例不受影响', () => {
    const { template, versionId } = publishedTemplate(SIMPLE_DEFINITION, { code: 'PUB-2', documentType: 'RETIRE_DOC' });
    const { instance } = startWorkflowInstance(db, {
      templateId: template.id, versionId, documentType: 'RETIRE_DOC', documentId: 'RET-1', variables: {}, actor: ADMIN,
    });
    retireWorkflowVersion(db, { versionId, actor: ADMIN });
    assert.equal(db.prepare('SELECT status FROM workflow_instances WHERE id=?').get(instance.id).status, 'RUNNING',
      '停用版本不得影响已启动实例');
    assert.throws(
      () => startWorkflowInstance(db, {
        templateId: template.id, versionId, documentType: 'RETIRE_DOC', documentId: 'RET-2', variables: {}, actor: ADMIN,
      }),
      (error) => error.code === 'PLATFORM_WORKFLOW_VERSION_NOT_PUBLISHED',
    );
  });
});

describe('WF-TEST 试运行', () => {
  test('试运行产出路径与参与人，且不创建任何实例或任务', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n;
    const result = testWorkflowDefinition(db, {
      definition: CONDITIONAL_DEFINITION, variables: { amountCents: 5000 },
    });
    assert.equal(result.entry, 'check');
    assert.equal(result.path[0].nodeKey, 'check');
    assert.equal(result.path[0].branchTaken, 'TRUE');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n, before,
      '试运行不得产生任何实例');
  });
});

describe('WF-ROUTE 路由与跨域不变式', () => {
  test('通用引擎的变更入口不在 /api/approvals/** 之下', () => {
    const appSource = readFileSync(join(root, 'server', 'app.js'), 'utf8');
    const engineRegistrations = appSource.split('\n').filter((line) => line.includes('platform-workflow-engine.js'));
    assert.ok(engineRegistrations.length >= 10, '通用引擎应注册多条路由');
    const engineBlock = appSource.slice(
      appSource.indexOf('// Platform 平台层域 —— 通用工作流引擎'),
      appSource.indexOf('// Platform 平台层域 —— 通用工作流引擎') + 6000,
    );
    assert.ok(!engineBlock.includes("'/api/approvals"), '通用引擎不得在 /api/approvals 下注册路由');
    assert.ok(!engineBlock.includes("'/api/workflows"), '通用引擎不得占用退役中的 /api/workflows 前缀');
  });

  test('通用引擎是工作流能力的唯一 owner —— 既有 6 族审批路径不被接管', () => {
    const approvalsSource = readFileSync(join(root, 'server', 'modules', 'approvals.js'), 'utf8');
    assert.ok(approvalsSource.includes('DOCUMENTS'), '既有审批族注册表必须保持存在');
    const engineSource = readFileSync(join(root, 'server', 'modules', 'platform-workflow-engine.js'), 'utf8');
    assert.ok(!engineSource.includes('approveSalesOrder'), '通用引擎不得接管业务域的状态机');
  });
});
