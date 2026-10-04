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

let vite;
let BusinessOverview;
let AppNavigationProvider;
let flows;

before(async () => {
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  const overview = await vite.ssrLoadModule('/src/pages/business-overview.jsx');
  BusinessOverview = overview.default;
  flows = overview.BUSINESS_FLOWS;
  AppNavigationProvider = (await vite.ssrLoadModule('/src/navigation/AppNavigationContext.jsx')).AppNavigationProvider;
});

after(async () => { await vite?.close(); });

function render(allowed = []) {
  return renderToStaticMarkup(createElement(AppNavigationProvider, {
    value: { target: null, canNavigate: (page) => allowed.includes(page), navigateToPage: () => true },
  }, createElement(BusinessOverview)));
}

describe('V1.5 D2 flow-aligned business overview', () => {
  test('presents exactly the three frozen principal lanes', () => {
    assert.deepEqual(flows.map((flow) => [flow.key, flow.title]), [
      ['sales', '销售履约'], ['production', '生产执行'], ['purchase', '采购履约'],
    ]);
    assert.equal(flows.some((flow) => flow.key === 'finance'), false);
  });

  test('keeps canonical stages in their correct sequence', () => {
    assert.deepEqual(flows[0].steps.map((item) => item.label), ['销售订单', '销售出货 / 退货', '应收结算']);
    assert.deepEqual(flows[1].steps.map((item) => item.label), ['MRP', '生产指令', '制令单', '用料出库', '生产入库']);
    assert.deepEqual(flows[2].steps.map((item) => item.label), ['MRP', '采购指令', '请购单', '采购订单', '采购入库', '应付结算']);
  });

  test('authorized nodes link while unauthorized nodes remain explanatory', () => {
    const html = render(['orders']);
    assert.match(html, /href="#orders"/);
    assert.match(html, /aria-label="进入销售订单"/);
    assert.match(html, /应收结算[\s\S]*无权限|无权限[\s\S]*应收结算/);
    assert.doesNotMatch(html, /href="#accounts-receivable"/);
    assert.doesNotMatch(overviewSource, /\bapi\s*\(/);
    // D2.2: repetitive "进入应用" copy removed from every node.
    assert.doesNotMatch(html, /<small[^>]*>进入应用<\/small>/);
  });

  test('every lane destination remains a current enabled route', () => {
    // V1.7 P0: route inventory lives in applicationRegistry.js, not in
    // App.jsx navGroups. Each lane step page must remain an enabled
    // canonical route.
    const registry = read('src/navigation/applicationRegistry.js');
    const enabledRoutes = new Set();
    for (const match of registry.matchAll(/route\('([a-z0-9-]+)'/g)) enabledRoutes.add(match[1]);
    for (const page of new Set(flows.flatMap((flow) => flow.steps.map((item) => item.page)))) {
      assert.ok(enabledRoutes.has(page), `${page} must remain a registered route`);
      const entry = registry.match(new RegExp(`route\\('${page}'[^)]+\\),?`))?.[0] || '';
      assert.doesNotMatch(entry, /enabled:\s*false/, `${page} must remain enabled`);
    }
  });

  test('supporting groups are concise and internal steps are not promoted to lanes', () => {
    const html = render([]);
    for (const label of ['基础资料', '库存作业', '经营分析']) assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /<h2[^>]*>IQC/);
    assert.doesNotMatch(html, /<h2[^>]*>OQC/);
    assert.match(html, /审批 ≠ 履约/);
  });

  test('mobile layout stacks flow nodes without horizontal dependency', () => {
    assert.match(overviewCss, /@media \(max-width: 767px\)[\s\S]*\.flow-lane ol\s*\{[^}]*display:grid[^}]*overflow:visible/s);
  });
});
