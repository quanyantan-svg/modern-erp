import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const appSource = read('src/App.jsx');
const overviewSource = read('src/pages/business-overview.jsx');
const overviewCss = read('src/styles.css');
const orderSource = read('src/pages/master-data.jsx');
const approvalsSource = read('server/modules/approvals.js');

let vite;
let BusinessOverview;
let AppNavigationProvider;
let groups;

before(async () => {
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  const overview = await vite.ssrLoadModule('/src/pages/business-overview.jsx');
  BusinessOverview = overview.default;
  groups = overview.BUSINESS_OVERVIEW_GROUPS;
  AppNavigationProvider = (await vite.ssrLoadModule('/src/navigation/AppNavigationContext.jsx')).AppNavigationProvider;
});

after(async () => { await vite?.close(); });

function render(allowed = []) {
  return renderToStaticMarkup(createElement(AppNavigationProvider, {
    value: { target: null, canNavigate: (page) => allowed.includes(page), navigateToPage: () => true },
  }, createElement(BusinessOverview)));
}

describe('V1.4-E7 two-level business overview', () => {
  test('Level 1 contains the eight frozen principal groups', () => {
    assert.deepEqual(groups.map((group) => group.title), ['基础资料', '销售', '计划 / MRP', '生产', '采购', '库存', '财务衔接', '经营报表']);
  });

  test('original master data, sales, purchase, production, inventory and report stages remain recognizable', () => {
    const labels = groups.flatMap((group) => group.level1.map((item) => item.label));
    for (const label of ['货品资料', 'BOM', '客户资料', '供应商资料', '仓库资料', '制品工序标准', '销售订单', '仓库出货', '应收结账', '计划预测', 'MRP', '生产指令', '制令单', '用料出库', '生产入库', '采购指令', '请购单', '采购订单', '仓库验收', '应付结账', '存货调整', '存货调拨', '存货报废', '存货盘点', '存货月结', '采购统计分析表', '采购未交货反应表', '销售统计分析表', '销售未出货反应表', '存货异动明细表']) assert.ok(labels.includes(label), label);
  });

  test('Level 2 encodes canonical semantic boundaries instead of false equivalences', () => {
    const sales = groups.find((group) => group.key === 'sales');
    const purchase = groups.find((group) => group.key === 'purchase');
    const inventory = groups.find((group) => group.key === 'inventory');
    assert.deepEqual(sales.level2.map((item) => item.label).slice(1, 8), ['审批', 'OQC 出货检验', '确认出货', '销售退货（条件分支）', '销售发票', '应收账款', '收款 / 贷项 / 退款 / 核销']);
    assert.deepEqual(purchase.level2.map((item) => item.label).slice(3, 11), ['请购 / 订单审批', '采购订单', 'IQC 来料检验', '确认入库', '采购退货（条件分支）', '供应商账单', '应付账款', '付款 / 贷项 / 退款 / 核销']);
    assert.match(sales.boundary, /审批只授权后续执行/);
    assert.match(sales.boundary, /出货后仍需销售发票过账才形成应收/);
    assert.match(purchase.boundary, /订单审批不等于收货/);
    assert.match(purchase.boundary, /供应商账单过账后才形成应付/);
    assert.match(inventory.boundary, /调拨是仓库确认执行，不进入审批中心/);
  });

  test('canonical roles and exactly five approval families remain unchanged', () => {
    for (const role of ['ADMIN', 'SALES', 'REVIEWER', 'WAREHOUSE', 'ACCOUNTING']) assert.match(read('server/db.js'), new RegExp(role));
    for (const family of ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']) assert.match(approvalsSource, new RegExp(family));
    for (const forbidden of ['INVENTORY_TRANSFER', 'INVENTORY_CLOSE', 'SHIPMENT', 'RECEIPT']) assert.doesNotMatch(approvalsSource, new RegExp(`type:\s*['\"]${forbidden}['\"]`));
  });

  test('authorized nodes are links and unauthorized nodes are explanatory only', () => {
    const html = render(['orders']);
    assert.match(html, /href="#orders"/);
    assert.match(html, /销售发票，流程说明，需要对应权限/);
    assert.doesNotMatch(html, /href="#sales-invoices"/);
    assert.doesNotMatch(overviewSource, /\bapi\s*\(/);
  });

  test('every overview destination is a current enabled application route', () => {
    const destinations = new Set(groups.flatMap((group) => [...group.level1, ...group.level2].map((item) => item.page).filter(Boolean)));
    for (const page of destinations) {
      assert.match(appSource, new RegExp(`(?:key: '${page}'|'${page}':)`), page);
      const navEntry = appSource.match(new RegExp(`\\{ key: '${page}'[^\\n]+`))?.[0] || '';
      assert.doesNotMatch(navEntry, /enabled:\s*false/, page);
    }
    assert.doesNotMatch(overviewSource, /system-health|go-live/);
  });

  test('all five original report links target the E5/E6 report tabs', () => {
    const reportTargets = groups.find((group) => group.key === 'reports').level1.map((item) => item.target?.reportKey);
    assert.deepEqual(reportTargets, ['purchase-summary', 'purchase-outstanding', 'sales-summary', 'sales-outstanding', 'inventory-movements']);
    assert.match(read('src/navigation/AppNavigationContext.jsx'), /target \|\| null/);
  });

  test('order detail removes source-optional wording and separates quality, logistics, commercial, subledger and settlement stages', () => {
    assert.doesNotMatch(orderSource, /来源可选/);
    for (const key of ["key: 'quality'", "key: 'logistics'", "key: 'commercial'", "key: 'subledger'", "key: 'settlement'", "key: 'voucher'"]) assert.match(orderSource, new RegExp(key));
    assert.match(orderSource, /必须引用已批准订单行生成/);
  });

  test('responsive and accessible interaction has no mobile horizontal flow dependency', () => {
    const html = render([]);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-controls="business-detail-sales"/);
    assert.match(overviewCss, /@media \(max-width: 767\.98px\)[\s\S]*business-level-one__track[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
    assert.doesNotMatch(overviewCss.match(/\/\* Teacher-facing business map[\s\S]*?\/\* M10/)?.[0] || '', /overflow-x:\s*auto/);
  });
});
