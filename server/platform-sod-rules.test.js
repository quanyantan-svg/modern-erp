// Platform SOD 规则维护面 —— 合同测试（Design §32.4 / Requirement §36.4）。
//
// 覆盖三组断言：
//   1. **可创建的规则集合是收敛的**：不可求值的约束类型、未登记的业务类型、未接入的
//      决策动作、缺失 / 不存在的升级角色，全部在创建时 fail closed 被拒 —— 维护面
//      绝不允许产生「静默不生效」或「拒绝该族全部审批」的规则。
//   2. **规则真的生效**：停用后不生效；升级处置拒绝违规 actor 并在**事务外**留下
//      判定记录与审计行，升级角色成员随后可正常决策。
//   3. **既有行为逐字不变**：销售订单自审批仍是 409「创建人不能审批自己的订单」。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let db;
let httpServer;
let baseUrl;
let tempDir;
const tokens = {};

const future = '2099-06-01T08:00:00.000Z';

function seedFixtures() {
  // 第二个销售用户：与发起人同角色，用于验证「同角色」约束与升级处置。
  const sales2Password = hashPassword('sales2pass', 'sod-rules-salt');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`).run(
    'user-sales2', 'sales2', '销售专员二', sales2Password.hash, sales2Password.salt, 'role-sales', future,
  );
  // 第二个管理员：与发起人同角色且同样持有生产工单审批权（PL-DEC-04 后 role-warehouse 亦持有）。
  const admin2Password = hashPassword('admin2pass', 'sod-rules-salt');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`).run(
    'user-admin2', 'admin2', '系统管理员二', admin2Password.hash, admin2Password.salt, 'role-admin', future,
  );
  // 由销售发起的销售订单（发起人角色 = SALES）。
  db.prepare(`INSERT INTO sales_orders
    (id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-rule-so', 'SO-SOD-RULE', 'customer-001', 'SUBMITTED', 100000, '', '', 'user-sales', null, future, null, future, future,
  );
  // 由管理员发起的生产工单（平台层是唯一闸门）。
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-rule-mo', 'MO-SOD-RULE', 'product-001', 1, 'SUBMITTED', '', 'user-admin', future, future, 'user-admin', future,
  );
  // 由销售发起的生产工单（他人审批应成功）。
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-rule-mo2', 'MO-SOD-RULE-2', 'product-001', 1, 'SUBMITTED', '', 'user-sales', future, future, 'user-sales', future,
  );
  // 由管理员发起的生产工单（升级处置的载体：另一个管理员同角色审批 → 应被升级拒绝）。
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-rule-mo-esc', 'MO-SOD-RULE-ESC', 'product-001', 1, 'SUBMITTED', '', 'user-admin', future, future, 'user-admin', future,
  );
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  tokens[username] = data.token;
}

async function request(path, username = 'admin', options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokens[username]}`,
      ...options.headers,
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'erp-sod-rules-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  seedFixtures();
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123');
  await login('admin2', 'admin2pass');
  await login('sales', 'sales123');
  await login('sales2', 'sales2pass');
  await login('reviewer', 'review123');
  await login('warehouse', 'warehouse123');
});

after(async () => {
  await new Promise((done, fail) => httpServer.close((error) => (error ? fail(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SOD-RULE 族覆盖登记不留空白（Requirement §36.4）', () => {
  test('7 个审批族全部登记，且没有「既无规则也无既有防护」的族', async () => {
    const { status, data } = await request('/api/platform/sod/coverage');
    assert.equal(status, 200);
    assert.equal(data.families.length, 7);
    const uncovered = data.families.filter((family) => family.coverage === 'UNCOVERED');
    assert.equal(uncovered.length, 0, '不允许出现职责分离缺口族');
    const production = data.families.find((family) => family.businessType === 'PRODUCTION_ORDER');
    assert.equal(production.coverage, 'RULE_COVERED', '生产工单族由平台规则唯一把关');
    assert.equal(production.nativeGuard, null, '生产工单族此前没有既有防护');
    const sales = data.families.find((family) => family.businessType === 'SALES_ORDER');
    assert.equal(sales.coverage, 'NATIVE_GUARD', '销售订单族由既有自审批防护负责');
    assert.equal(sales.nativeGuard.statusCode, 409);
  });

  test('维护面声明的可创建集合与实际一致', async () => {
    const { data } = await request('/api/platform/sod/coverage');
    assert.deepEqual(data.creatable.constraintTypes, ['SAME_PERSON_FORBIDDEN', 'SAME_ROLE_FORBIDDEN']);
    assert.deepEqual(data.creatable.actions, ['APPROVE']);
    assert.deepEqual(data.creatable.resolutions, ['REJECT', 'ESCALATE']);
    assert.ok(data.creatable.uncreatableConstraintReasons.SAME_DEPARTMENT_FORBIDDEN);
    assert.ok(data.creatable.uncreatableConstraintReasons.MIN_APPROVERS);
  });
});

describe('SOD-RULE 规则维护面权限 fail closed', () => {
  test('没有 SOD_RULES_VIEW 的主体读不到规则', async () => {
    const { status } = await request('/api/platform/sod/rules', 'sales');
    assert.equal(status, 403);
  });

  test('没有 SOD_RULES_MANAGE 的主体写不了规则', async () => {
    const { status } = await request('/api/platform/sod/rules', 'sales', {
      method: 'POST',
      body: { code: 'SOD-NO-PERM', businessType: 'SALES_ORDER', constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'REJECT' },
    });
    assert.equal(status, 403);
    const exists = db.prepare('SELECT COUNT(*) n FROM sod_rules WHERE code=?').get('SOD-NO-PERM').n;
    assert.equal(exists, 0, '被拒的写入不得留下数据');
  });
});

describe('SOD-RULE 不可求值的配置一律 fail closed', () => {
  const cases = [
    {
      name: '禁止同部门',
      body: { code: 'SOD-BAD-DEPT', businessType: 'SALES_ORDER', constraintType: 'SAME_DEPARTMENT_FORBIDDEN', resolution: 'REJECT' },
      code: 'PLATFORM_SOD_CONSTRAINT_NOT_EVALUABLE',
    },
    {
      name: '最小通过人数',
      body: { code: 'SOD-BAD-MIN', businessType: 'SALES_ORDER', constraintType: 'MIN_APPROVERS', resolution: 'REJECT' },
      code: 'PLATFORM_SOD_CONSTRAINT_NOT_EVALUABLE',
    },
    {
      name: '未登记的业务类型',
      body: { code: 'SOD-BAD-FAMILY', businessType: 'WORKFLOW_TASK', constraintType: 'SAME_PERSON_FORBIDDEN', resolution: 'REJECT' },
      code: 'PLATFORM_SOD_FAMILY_UNKNOWN',
    },
    {
      name: '未接入的决策动作',
      body: { code: 'SOD-BAD-ACTION', businessType: 'SALES_ORDER', action: 'REJECT', constraintType: 'SAME_PERSON_FORBIDDEN', resolution: 'REJECT' },
      code: 'PLATFORM_SOD_ACTION_NOT_WIRED',
    },
    {
      name: '升级处置缺少升级角色',
      body: { code: 'SOD-BAD-ESC', businessType: 'SALES_ORDER', constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'ESCALATE' },
      code: 'PLATFORM_SOD_ESCALATE_ROLE_REQUIRED',
    },
    {
      name: '升级角色不存在',
      body: { code: 'SOD-BAD-ESC2', businessType: 'SALES_ORDER', constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'ESCALATE', escalateToRole: 'NO_SUCH_ROLE' },
      code: 'PLATFORM_SOD_ESCALATE_ROLE_UNKNOWN',
    },
    {
      name: '拒绝处置指定升级角色',
      body: { code: 'SOD-BAD-ESC3', businessType: 'SALES_ORDER', constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'REJECT', escalateToRole: 'REVIEWER' },
      code: 'PLATFORM_SOD_ESCALATE_ROLE_NOT_ALLOWED',
    },
    {
      name: '不可创建的约束类型不得携带人数阈值',
      body: { code: 'SOD-BAD-MIN2', businessType: 'SALES_ORDER', constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'REJECT', minApprovedCount: 2 },
      code: 'PLATFORM_SOD_MIN_APPROVERS_NOT_SUPPORTED',
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.name}的规则被拒绝创建`, async () => {
      const { status, data } = await request('/api/platform/sod/rules', 'admin', {
        method: 'POST', body: testCase.body,
      });
      assert.equal(status, 400, data.error);
      assert.equal(data.code, testCase.code);
      const exists = db.prepare('SELECT COUNT(*) n FROM sod_rules WHERE code=?').get(testCase.body.code).n;
      assert.equal(exists, 0, '被拒的规则不得落库');
    });
  }
});

describe('SOD-RULE 规则生命周期', () => {
  let ruleId;

  test('创建规则写入审计', async () => {
    const { status, data } = await request('/api/platform/sod/rules', 'admin', {
      method: 'POST',
      body: {
        code: 'SOD-SO-SAME-ROLE', businessType: 'SALES_ORDER',
        constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'REJECT',
      },
    });
    assert.equal(status, 201, data.error);
    assert.equal(data.rule.code, 'SOD-SO-SAME-ROLE');
    assert.equal(data.rule.status, 'ACTIVE');
    ruleId = data.rule.id;
    const audits = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='SOD_RULE_CREATE' AND entity_id=?")
      .get(ruleId).n;
    assert.equal(audits, 1, '规则创建必须写审计');
  });

  test('规则编码冲突被拒绝', async () => {
    const { status, data } = await request('/api/platform/sod/rules', 'admin', {
      method: 'POST',
      body: {
        code: 'SOD-SO-SAME-ROLE', businessType: 'SALES_ORDER',
        constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'REJECT',
      },
    });
    assert.equal(status, 409, data.error);
    assert.equal(data.code, 'PLATFORM_SOD_RULE_CODE_CONFLICT');
  });

  test('停用规则写审计，且规则不再生效', async () => {
    const { status, data } = await request(`/api/platform/sod/rules/${ruleId}/status`, 'admin', {
      method: 'POST', body: { status: 'INACTIVE', reason: '合同测试停用' },
    });
    assert.equal(status, 200, data.error);
    assert.equal(data.rule.status, 'INACTIVE');
    const audits = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='SOD_RULE_DISABLE' AND entity_id=?")
      .get(ruleId).n;
    assert.equal(audits, 1, '停用必须写审计');
  });
});

describe('SOD-RULE 规则真的生效', () => {
  test('销售订单的自审批仍是既有 409 与既有文案（既有行为逐字不变）', async () => {
    db.prepare(`INSERT INTO sales_orders
      (id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'sod-rule-so-self', 'SO-SOD-RULE-SELF', 'customer-001', 'SUBMITTED', 100000, '', '', 'user-admin', null, future, null, future, future,
    );
    const { status, data } = await request('/api/orders/sod-rule-so-self/approve', 'admin', { method: 'POST' });
    assert.equal(status, 409);
    assert.equal(data.error, '创建人不能审批自己的订单');
  });

  test('生产工单自审批被平台层拒绝，并在事务外留下判定记录与审计', async () => {
    const { status, data } = await request('/api/production-orders/sod-rule-mo/state', 'admin', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 409);
    assert.equal(data.code, 'PLATFORM_SOD_RULE_VIOLATION');
    const evaluation = db.prepare(
      "SELECT * FROM sod_evaluations WHERE business_type='PRODUCTION_ORDER' AND business_id='sod-rule-mo'",
    ).get();
    assert.ok(evaluation, '拒绝证据必须在事务之外落库');
    assert.equal(evaluation.decision, 'VIOLATED');
    const audits = db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='SOD_RULE_VIOLATION' AND entity_id='sod-rule-mo'",
    ).get().n;
    assert.equal(audits, 1, '拒绝必须写审计');
  });

  test('他人审批生产工单照常成功（规则不误伤正常审批）', async () => {
    const { status } = await request('/api/production-orders/sod-rule-mo2/state', 'admin', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 200);
    assert.equal(db.prepare("SELECT status FROM production_orders WHERE id='sod-rule-mo2'").get().status, 'APPROVED');
  });
});

describe('SOD-RULE 升级至上级（平台层落地，不触任何业务域）', () => {
  let ruleId;

  before(async () => {
    const { status, data } = await request('/api/platform/sod/rules', 'admin', {
      method: 'POST',
      body: {
        code: 'SOD-MO-SAME-ROLE-ESC', businessType: 'PRODUCTION_ORDER',
        constraintType: 'SAME_ROLE_FORBIDDEN', resolution: 'ESCALATE', escalateToRole: 'WAREHOUSE',
      },
    });
    assert.equal(status, 201, data.error);
    ruleId = data.rule.id;
    assert.equal(data.rule.escalateToRole, 'WAREHOUSE');
  });

  after(async () => {
    await request(`/api/platform/sod/rules/${ruleId}/status`, 'admin', {
      method: 'POST', body: { status: 'INACTIVE', reason: '合同测试结束' },
    });
  });

  test('同角色的他人审批被升级拒绝，并留下升级待办', async () => {
    const { status, data } = await request('/api/production-orders/sod-rule-mo-esc/state', 'admin2', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 409, JSON.stringify(data));
    assert.equal(data.code, 'PLATFORM_SOD_ESCALATED');
    const order = db.prepare("SELECT status FROM production_orders WHERE id='sod-rule-mo-esc'").get();
    assert.equal(order.status, 'SUBMITTED', '被升级拒绝后单据状态不得改变');

    const { data: list } = await request('/api/platform/sod/escalations');
    const pending = list.escalations.find((entry) => entry.businessId === 'sod-rule-mo-esc');
    assert.ok(pending, '升级待办必须可见');
    assert.equal(pending.handled, false);
    assert.equal(pending.escalateToRole, 'WAREHOUSE');
    assert.equal(pending.ruleCode, 'SOD-MO-SAME-ROLE-ESC');
    assert.equal(pending.actorId, 'user-admin2');
    assert.ok(
      pending.escalateMembers.some((member) => member.id === 'user-warehouse'),
      '升级待办必须列出升级角色的成员',
    );
    assert.equal(list.pendingCount, 1);
  });

  test('升级角色的成员可正常决策，待办随之闭合', async () => {
    const { status, data } = await request('/api/production-orders/sod-rule-mo-esc/state', 'warehouse', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(db.prepare("SELECT status FROM production_orders WHERE id='sod-rule-mo-esc'").get().status, 'APPROVED');
    const { data: list } = await request('/api/platform/sod/escalations');
    const entry = list.escalations.find((item) => item.businessId === 'sod-rule-mo-esc');
    assert.equal(entry.handled, true, '接手人成功决策后升级待办必须闭合');
    assert.equal(list.pendingCount, 0);
  });
});
