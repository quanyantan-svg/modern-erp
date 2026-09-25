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
    assert.match(metadataSource, /page: 'business-overview', mobileLabel: '业务总览'/);
  });

  test('renders the five real business chains with teacher-facing terminology', () => {
    const html = renderOverview([]);
    for (const label of ['销售链', '采购链', '库存链', '生产链', '财务结算链']) assert.match(html, new RegExp(label));
    for (const label of ['销售出货', '采购入库', '库存异动', '制令单', '应收账款', '应付账款', '收款单', '付款单']) assert.match(html, new RegExp(label));
  });

  test('authorized nodes are canonical links and unauthorized nodes are read-only', () => {
    const html = renderOverview(['orders']);
    assert.match(html, /href="#orders"/);
    assert.match(html, /aria-disabled="true"/);
    assert.doesNotMatch(html, /href="#accounts-receivable"/);
  });

  test('deferred concepts are never active links', () => {
    const html = renderOverview(['orders', 'inventory', 'production-orders', 'forecasts', 'mrp', 'production-instructions', 'purchase-instructions', 'purchase-requisitions']);
    for (const deferred of ['库存报废', '库存月结', '销售折让', '采购折让']) {
      assert.doesNotMatch(html, new RegExp(`href="[^"]+"[^>]*>[^<]*${deferred}`));
    }
  });

  test('all overview destinations are registered canonical page keys', () => {
    const destinations = [...overviewSource.matchAll(/\['[^']+', '([^']+)'\]/g)].map((match) => match[1]);
    for (const page of destinations) assert.match(appSource, new RegExp(`(?:key: '${page}'|'${page}':)`, 'm'), page);
  });
});

describe('M9 permission and terminology contracts', () => {
  test('accounting dashboard cannot request inventory alerts without INVENTORY_VIEW', () => {
    assert.match(dashboardSource, /can\(user, 'INVENTORY_VIEW'\) \? api\('\/api\/inventory\/alerts'\) : Promise\.resolve/);
    assert.doesNotMatch(dashboardSource, /Promise\.all\(\[\s*api\('\/api\/dashboard'\),\s*api\('\/api\/inventory\/alerts'\)/);
  });

  test('dashboard shortcuts use canonical permission-aware AppLink navigation', () => {
    assert.match(dashboardSource, /navigation\.canNavigate\(page\)/);
    assert.match(dashboardSource, /<AppLink key=\{page\} page=\{page\}>/);
  });

  test('only the four true approval families remain in approval aggregation', () => {
    for (const family of ['SALES_ORDER', 'PURCHASE_ORDER', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']) assert.match(approvalsSource, new RegExp(family));
    for (const operational of ['SALES_DELIVERY', 'PURCHASE_RECEIPT', 'MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'PAYMENT_COLLECTION']) assert.doesNotMatch(approvalsSource, new RegExp(operational));
  });

  test('mobile finance cards are grouped under finance rather than master data', () => {
    const master = metadataSource.match(/key: 'master-data',[\s\S]*?\n  },/)[0];
    const finance = metadataSource.match(/key: 'finance',[\s\S]*?\n  },/)[0];
    assert.doesNotMatch(master, /accounts-receivable|payment-collections|accounts-payable|payment-disbursements/);
    for (const page of ['accounts-receivable', 'payment-collections', 'accounts-payable', 'payment-disbursements']) assert.match(finance, new RegExp(page));
  });

  test('visible labels use the frozen course vocabulary', () => {
    assert.match(appSource, /label: '销售出货'/);
    assert.match(appSource, /label: '库存异动明细'/);
    assert.match(appSource, /label: '制令单'/);
    assert.doesNotMatch(appSource, /label: '销售出库'|label: '库存流水'|label: '生产工单'/);
  });
});
