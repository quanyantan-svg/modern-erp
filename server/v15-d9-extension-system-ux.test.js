import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APPROVAL_FAMILIES, ROUTE_PRESENTATIONS } from '../src/navigation/presentationMetadata.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D9 closes every active route on the shared 680px application rail', () => {
  assert.equal(ROUTE_PRESENTATIONS.length, 47);
  const styles = read('src/styles.css');
  assert.match(styles, /\.mobile-shell \{[\s\S]*--app-max-width: 680px;[\s\S]*--page-max-width: 680px;/);
  assert.match(styles, /\.mobile-application-view \{[\s\S]*max-width: 680px;/);
});

test('D9 uses the real notification center for the mobile messages tab', () => {
  const app = read('src/App.jsx');
  assert.match(app, /mobileTab === 'messages'.*<RouteScreen route=\{applicationRouteFor\('notifications'\)\}/);
  assert.doesNotMatch(app, /emptyText="暂无新消息"/);
  const notifications = read('src/pages/platform-notifications.jsx');
  assert.match(notifications, /className="notifications-v15" width="rail"/);
  assert.match(notifications, /移动端“消息”共享同一数据源和已读状态/);
});

test('D9 unifies desktop approvals across exactly five approved families', () => {
  assert.deepEqual(APPROVAL_FAMILIES, ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']);
  const app = read('src/App.jsx');
  assert.match(app, /mobileTab === 'approvals'.*<RouteScreen route=\{applicationRouteFor\('approvals'\)\}/);
  assert.doesNotMatch(app, /standaloneTitle/);
  const center = read('src/components/MobileApprovalCenter.jsx');
  assert.match(center, /<h1>业务审批<\/h1>/);
  assert.match(center, /销售订单、采购订单、请购单、库存盘点与会计凭证/);
});

test('D9 gives Platform system routes explicit canonical shells', () => {
  const project = read('src/pages/platform-notifications.jsx');
  assert.match(project, /className="notifications-v15" width="rail"/);
  const master = read('src/pages/master-data.jsx');
  assert.match(master, /className="dashboard-v15" width="rail"/);
  assert.match(master, /className="users-roles-v15" width="rail"/);
});
