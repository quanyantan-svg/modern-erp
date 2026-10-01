import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APPROVAL_FAMILIES, ROUTE_PRESENTATIONS } from '../src/navigation/presentationMetadata.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D9 closes every active route on the shared 680px application rail', () => {
  assert.equal(ROUTE_PRESENTATIONS.length, 53);
  const styles = read('src/styles.css');
  assert.match(styles, /\.mobile-shell \{[\s\S]*--app-max-width: 680px;[\s\S]*--page-max-width: 680px;/);
  assert.match(styles, /\.mobile-application-view \{[\s\S]*max-width: 680px;/);
});

test('D9 uses the real notification center for the mobile messages tab', () => {
  const app = read('src/App.jsx');
  assert.match(app, /if \(mobileTab === 'messages'\) \{\s*return pages\.notifications;/);
  assert.doesNotMatch(app, /emptyText="暂无新消息"/);
  const notifications = read('src/pages/projects-workflow.jsx');
  assert.match(notifications, /className="notifications-v15" width="rail"/);
  assert.match(notifications, /移动端“消息”共享同一数据源和已读状态/);
});

test('D9 unifies desktop approvals across exactly five approved families', () => {
  assert.deepEqual(APPROVAL_FAMILIES, ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']);
  const app = read('src/App.jsx');
  assert.match(app, /approvals: <MobileApprovalCenter/);
  assert.doesNotMatch(app, /approvals: <MobileApprovalCenter[^>]*standaloneTitle/);
  const center = read('src/components/MobileApprovalCenter.jsx');
  assert.match(center, /<h1>业务审批<\/h1>/);
  assert.match(center, /销售订单、采购订单、请购单、库存盘点与会计凭证/);
});

test('D9 gives extension and system routes explicit canonical shells', () => {
  const project = read('src/pages/projects-workflow.jsx');
  for (const name of ['projects', 'project-tasks', 'timesheets', 'notifications']) assert.match(project, new RegExp(`className="${name}-v15" width="rail"`));
  const crm = read('src/pages/crm.jsx');
  assert.match(crm, /className="followups-v15" width="rail"/);
  assert.match(crm, /className="sales-activities-v15" width="rail"/);
  const master = read('src/pages/master-data.jsx');
  assert.match(master, /className="dashboard-v15" width="rail"/);
  assert.match(master, /className="users-roles-v15" width="rail"/);
});
