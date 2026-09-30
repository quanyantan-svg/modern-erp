import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const appSource = read('src', 'App.jsx');
const dashboardSource = read('src', 'pages', 'master-data.jsx');
const overviewSource = read('src', 'pages', 'business-overview.jsx');
const metadataSource = read('src', 'navigation', 'applicationMetadata.js');
const approvalsSource = read('server', 'modules', 'approvals.js');

let vite;
let BusinessOverview;
let AppNavigationProvider;

before(async () => {
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  BusinessOverview = (await vite.ssrLoadModule('/src/pages/business-overview.jsx')).default;
  AppNavigationProvider = (await vite.ssrLoadModule('/src/navigation/AppNavigationContext.jsx')).AppNavigationProvider;
});

after(async () => { await vite?.close(); });

function renderOverview(allowed = []) {
  return renderToStaticMarkup(createElement(AppNavigationProvider, {
    value: { target: null, canNavigate: (page) => allowed.includes(page), navigateToPage: () => true },
  }, createElement(BusinessOverview)));
}

describe('M9 business overview', () => {
  test('is mounted in canonical navigation without a new permission', () => {
    assert.match(appSource, /key: 'business-overview',[^\n]+permission: 'DASHBOARD_VIEW'/);
    assert.match(appSource, /'business-overview': <BusinessOverview\/>/);
    assert.match(metadataSource, /\['business-overview', '业务总览'/);
  });

  test('renders the teacher-facing principal business areas and stages', () => {
    const html = renderOverview([]);
    for (const label of ['销售履约', '生产执行', '采购履约', '基础资料', '库存作业', '经营分析']) assert.match(html, new RegExp(label));
    for (const label of ['出货 / 退货', '采购入库', '制令单', '应收结算', '应付结算']) assert.match(html, new RegExp(label));
  });

  test('authorized nodes are canonical links and unauthorized nodes are read-only', () => {
    const html = renderOverview(['orders']);
    assert.match(html, /href="#orders"/);
    assert.match(html, /flow-step is-readonly/);
    assert.doesNotMatch(html, /href="#accounts-receivable"/);
  });

  test('implemented inventory controls use their current canonical routes', () => {
    const html = renderOverview(['inventory-scraps', 'inventory-month-end']);
    assert.match(html, /href="#inventory-scraps"/);
    assert.match(html, /href="#inventory-month-end"/);
  });

  test('all overview destinations are registered canonical page keys', () => {
    const destinations = [...overviewSource.matchAll(/\['[^']+', '([^']+)'\]/g)].map((match) => match[1]);
    for (const page of destinations) assert.match(appSource, new RegExp(`(?:key: '${page}'|'${page}':)`, 'm'), page);
  });
});

describe('M9 permission and terminology contracts', () => {
  // V1.6 P1C: workspace rebuild removed the inventory-alerts Promise.all
  // (no longer needed once the dashboard is task-oriented) and replaced
  // decorative AppLink shortcuts with capability-driven native buttons.
  test('V1.6 dashboard no longer requests inventory alerts from inside the workspace', () => {
    assert.doesNotMatch(dashboardSource, /\/api\/inventory\/alerts/);
    assert.doesNotMatch(dashboardSource, /Promise\.all\(\[\s*api\('\/api\/dashboard'\)/);
  });

  test('V1.6 dashboard quick actions use navigation.canNavigate and native buttons', () => {
    assert.match(dashboardSource, /navigation\.canNavigate\(action\.page\)/);
    assert.match(dashboardSource, /v16-quick-action/);
    assert.match(dashboardSource, /navigation\.navigateToPage\(action\.page\)/);
  });

  test('only the five true approval families remain in approval aggregation', () => {
    for (const family of ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']) assert.match(approvalsSource, new RegExp(family));
    for (const operational of ['SALES_DELIVERY', 'PURCHASE_RECEIPT', 'MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'PAYMENT_COLLECTION']) assert.doesNotMatch(approvalsSource, new RegExp(operational));
  });

  test('finance is contextual rather than an eighth primary domain', () => {
    const masterStart = metadataSource.search(/key:\s*'master-data'/);
    const salesStart = metadataSource.search(/key:\s*'sales'/);
    assert.ok(masterStart >= 0 && salesStart > masterStart);
    const master = metadataSource.slice(masterStart, salesStart);
    assert.doesNotMatch(master, /accounts-receivable|payment-collections|accounts-payable|payment-disbursements/);
    assert.doesNotMatch(metadataSource, /key: 'finance', label:/);
    for (const page of ['accounts-receivable', 'payment-collections', 'accounts-payable', 'payment-disbursements']) assert.match(metadataSource, new RegExp(page));
  });

  test('visible labels use the frozen course vocabulary', () => {
    assert.match(appSource, /label: '销售出货'/);
    assert.match(appSource, /label: '库存异动明细'/);
    assert.match(appSource, /label: '制令单'/);
    assert.doesNotMatch(appSource, /label: '销售出库'|label: '库存流水'|label: '生产工单'/);
  });
});
