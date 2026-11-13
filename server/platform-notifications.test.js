// Platform 通知中心 —— 合同测试（docs/design/platform.md §32.7）。
//
// 核心断言：通知表**不再是空壳** —— 生产者真的会写入；
// 列表与未读计数同源同条件；去重生效；权限用 NOTIFICATION_VIEW（不再用 DASHBOARD_VIEW）；
// 订阅者与角色接收人正确展开；通知失败不影响业务结果。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { notifyEvent } from './modules/platform-notifications.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let db;
let httpServer;
let baseUrl;
let tempDir;
const tokens = {};

const future = '2099-06-01T08:00:00.000Z';

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
  tempDir = mkdtempSync(join(tmpdir(), 'erp-platform-notif-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123');
  await login('sales', 'sales123');
  await login('reviewer', 'review123');
});

after(async () => {
  await new Promise((done, fail) => httpServer.close((error) => (error ? fail(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('NOTIF 通知不再为空壳', () => {
  test('生产者确实写入通知行', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
    const result = notifyEvent(db, {
      eventType: 'TEST_EVENT', category: 'TEST',
      recipients: [{ type: 'USER', value: 'user-admin' }],
      title: '测试通知', content: '内容', dedupeKey: 'test-1',
    });
    assert.equal(result.created, 1, JSON.stringify(result));
    const after = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
    assert.equal(after, before + 1, '通知表必须真的被写入');
    const row = db.prepare("SELECT * FROM notifications WHERE title='测试通知'").get();
    assert.equal(row.type, 'INFO');
    assert.equal(row.priority, 'NORMAL');
    assert.equal(row.is_read, 0);
    assert.ok(row.dedupe_key, '去重键必须落库');
  });

  test('同一业务事件对同一接收人只产生一条通知', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
    const first = notifyEvent(db, {
      eventType: 'TEST_EVENT', category: 'TEST',
      recipients: [{ type: 'USER', value: 'user-sales' }],
      title: '去重通知', dedupeKey: 'dedupe-1',
    });
    const second = notifyEvent(db, {
      eventType: 'TEST_EVENT', category: 'TEST',
      recipients: [{ type: 'USER', value: 'user-sales' }],
      title: '去重通知', dedupeKey: 'dedupe-1',
    });
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, before + 1);
  });

  test('角色接收人展开为该角色的启用用户', () => {
    const result = notifyEvent(db, {
      eventType: 'TEST_EVENT', category: 'TEST',
      recipients: [{ type: 'ROLE', value: 'REVIEWER' }],
      title: '角色通知', dedupeKey: 'role-1',
    });
    assert.equal(result.created, 1);
    const row = db.prepare("SELECT * FROM notifications WHERE title='角色通知'").get();
    assert.equal(row.user_id, 'user-reviewer');
  });

  test('订阅者接收人按 (category, event_type) 展开', async () => {
    const subscribed = await request('/api/platform/notification-subscriptions', 'admin', {
      method: 'POST', body: { category: 'INVENTORY', eventType: 'BLOCKED', subscribed: true },
    });
    assert.equal(subscribed.status, 200, JSON.stringify(subscribed.data));
    const result = notifyEvent(db, {
      eventType: 'BLOCKED', category: 'INVENTORY',
      recipients: [{ type: 'SUBSCRIBERS' }],
      title: '订阅通知', dedupeKey: 'sub-1',
    });
    assert.equal(result.created, 1);
    const row = db.prepare("SELECT * FROM notifications WHERE title='订阅通知'").get();
    assert.equal(row.user_id, 'user-admin');
  });
});

describe('NOTIF 读取一致性与权限', () => {
  test('列表与未读计数同源同条件', async () => {
    const listed = await request('/api/notifications?limit=5', 'admin');
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.ok(typeof listed.data.unreadCount === 'number');
    assert.ok(typeof listed.data.total === 'number');
    assert.equal(listed.data.limit, 5);
    const direct = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get('user-admin').n;
    assert.equal(listed.data.unreadCount, direct, '未读计数必须与列表同条件');
    assert.ok(listed.data.notifications.length <= 5, '列表必须按 limit 截断');
  });

  test('标记已读后未读计数同步下降', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get('user-admin').n;
    const marked = await request('/api/notifications/read', 'admin', { method: 'POST', body: {} });
    assert.equal(marked.status, 200, JSON.stringify(marked.data));
    assert.equal(marked.data.unreadCount, 0, '全部标记已读后未读计数必须为 0');
    const after = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get('user-admin').n;
    assert.equal(after, 0);
    assert.ok(before >= 0);
  });

  test('权限改用 NOTIFICATION_VIEW —— 只有 DASHBOARD_VIEW 的角色读不到', async () => {
    // 销售角色有 DASHBOARD_VIEW 但没有 NOTIFICATION_VIEW（平台权限不自动授予其它角色）。
    const denied = await request('/api/notifications', 'sales');
    assert.equal(denied.status, 403, '仪表盘可见不等于通知可见');
    const allowed = await request('/api/notifications', 'admin');
    assert.equal(allowed.status, 200);
  });

  test('订阅维护需要 NOTIFICATION_MANAGE', async () => {
    const denied = await request('/api/platform/notification-subscriptions', 'sales', {
      method: 'POST', body: { category: 'X', eventType: 'Y', subscribed: true },
    });
    assert.equal(denied.status, 403);
  });
});

describe('NOTIF 生产者接线', () => {
  test('通用工作流引擎：任务生成 → 参与人收到待办通知；任务完成 → 发起人收到结果通知', async () => {
    // 建一个流程模板（审批人是 user-reviewer），发起人是 user-admin。
    const created = await request('/api/platform/workflow-templates', 'admin', {
      method: 'POST',
      body: {
        code: 'NOTIF-TPL-1', name: '通知验证流程', documentType: 'NOTIF_DOC',
        definition: {
          entry: 'approve',
          nodes: [{
            key: 'approve', type: 'APPROVAL', name: '审批',
            participants: [{ type: 'USER', value: 'user-reviewer' }],
            onApprove: { next: 'END' },
          }],
        },
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const templateId = created.data.template.id;
    const versionId = db.prepare('SELECT id FROM workflow_template_versions WHERE template_id=? ORDER BY version DESC').get(templateId).id;
    const published = await request(`/api/platform/workflow-versions/${versionId}/publish`, 'admin', { method: 'POST' });
    assert.equal(published.status, 200, JSON.stringify(published.data));

    const { startWorkflowInstance } = await import('./modules/platform-workflow-engine.js');
    const started = startWorkflowInstance(db, {
      templateId, versionId, documentType: 'NOTIF_DOC', documentId: 'NOTIF-DOC-1',
      variables: {}, actor: { id: 'user-admin' },
    });
    assert.equal(started.replayed, false);

    const pending = db.prepare("SELECT * FROM notifications WHERE user_id='user-reviewer' AND event_type='WORKFLOW_TASK_PENDING'").get();
    assert.ok(pending, '任务生成必须通知参与人');
    assert.equal(pending.source_type, 'WORKFLOW_INSTANCE');
    assert.equal(pending.source_id, started.instance.id);

    const task = db.prepare("SELECT * FROM workflow_tasks WHERE instance_id=?").get(started.instance.id);
    const { completeWorkflowTask } = await import('./modules/platform-workflow-engine.js');
    completeWorkflowTask(db, {
      taskId: task.id, actor: { id: 'user-reviewer' }, action: 'APPROVE',
    });
    const handled = db.prepare("SELECT * FROM notifications WHERE user_id='user-admin' AND event_type='WORKFLOW_TASK_HANDLED'").get();
    assert.ok(handled, '任务完成必须通知流程发起人');
  });

  test('既有审批族：请购单提交 → 审批人收到待办；审批通过 → 发起人收到结果', async () => {
    const requisitionId = 'notif-pr-1';
    db.prepare(`INSERT INTO purchase_requisitions
      (id,requisition_no,status,creator_id,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`).run(requisitionId, 'PR-NOTIF-001', 'DRAFT', 'user-sales', '', future, future);
    db.prepare('INSERT INTO purchase_requisition_items(id,requisition_id,product_id,quantity,created_at) VALUES(?,?,?,?,?)')
      .run('notif-pr-item-1', requisitionId, 'product-001', 5, future);

    const submitted = await request(`/api/purchase-requisitions/${requisitionId}/submit`, 'admin', { method: 'POST' });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    const pending = db.prepare(
      "SELECT * FROM notifications WHERE event_type='APPROVAL_PENDING' AND source_id=? AND source_type='PURCHASE_REQUISITION'",
    ).get(requisitionId);
    assert.ok(pending, '请购单提交必须通知审批人');
    assert.ok(['user-admin', 'user-reviewer'].includes(pending.user_id), '审批人必须是持有审批权限的角色成员');

    const approved = await request(`/api/purchase-requisitions/${requisitionId}/approve`, 'admin', { method: 'POST' });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const handled = db.prepare(
      "SELECT * FROM notifications WHERE event_type='APPROVAL_HANDLED' AND source_id=? AND source_type='PURCHASE_REQUISITION'",
    ).get(requisitionId);
    assert.ok(handled, '审批通过必须通知发起人');
    assert.equal(handled.user_id, 'user-sales');
  });

  test('通知失败不得使业务结果失败', () => {
    // 未知通知类型被拒绝，但生产者只记录、不抛出 —— 调用方的业务结果不受影响。
    const result = notifyEvent(db, {
      eventType: 'TEST_EVENT', category: 'TEST',
      recipients: [{ type: 'USER', value: 'user-admin' }],
      title: '坏类型', type: 'NOT_A_TYPE', dedupeKey: 'bad-1',
    });
    assert.equal(result.created, 0);
    assert.equal(result.failed, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE title='坏类型'").get().n, 0);
  });
});
