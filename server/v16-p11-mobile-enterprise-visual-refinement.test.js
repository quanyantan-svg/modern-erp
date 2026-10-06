import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const readSrc = (path) => readFileSync(join(srcDir, path), 'utf8');

let vite;
let MobileLauncher;
let applicationMetadata;
let MOBILE_TABS;

before(async () => {
  vite = await createViteServer({
    root: repoRoot,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });
  MobileLauncher = (await vite.ssrLoadModule('/src/components/MobileLauncher.jsx')).default;
  applicationMetadata = await vite.ssrLoadModule('/src/navigation/applicationMetadata.js');
  MOBILE_TABS = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).MOBILE_TABS;
});

after(async () => vite?.close());

describe('V1.6 P1.1 application visual contract', () => {
  test('preserves the eight canonical domain groups and explicit module identities', () => {
    const groups = applicationMetadata.MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'domain');
    assert.deepEqual(groups.map(({ label }) => label), [
      'Master & Engineering', 'Sales & Customer', 'Planning', 'Procurement & Outsourcing',
      'Manufacturing & Quality', 'Inventory & Warehouse', 'Finance Operations', 'Accounting & Analytics',
    ]);
    assert.deepEqual(groups.map(({ module }) => module), [
      'master', 'sales', 'planning', 'purchasing', 'production', 'inventory', 'finance', 'analytics',
    ]);
  });

  test('uses short launcher report labels without changing report keys', () => {
    const analytics = applicationMetadata.MOBILE_APPLICATION_GROUPS.find((group) => group.key === 'accounting-analytics');
    const reports = analytics.items.filter(({ reportKey }) => reportKey);
    assert.deepEqual(reports.map(({ mobileLabel }) => mobileLabel), [
      '销售统计', '销售未出货', '采购统计', '采购未交货', '库存异动',
    ]);
    assert.deepEqual(reports.map(({ reportKey }) => reportKey), [
      'sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements',
    ]);
    assert.deepEqual(reports.map(({ formalLabel }) => formalLabel), [
      '销售统计分析表', '销售未出货反应表', '采购统计分析表', '采购未交货反应表', '存货异动明细表',
    ]);
  });

  test('renders module attributes and removes visible utility counts', () => {
    const groups = [
      {
        key: 'sales', label: '销售管理', kind: 'domain', module: 'sales',
        items: [{ key: 'orders', page: 'orders', label: '销售订单', iconKey: 'orders' }],
      },
      {
        key: 'utility-flows', label: '业务流程', kind: 'utility',
        items: [{ key: 'business-overview', page: 'business-overview', label: '业务总览', iconKey: 'overview' }],
      },
    ];
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups }));
    assert.match(html, /data-module="sales"/);
    assert.match(html, /<summary><span>业务流程<\/span><\/summary>/);
    assert.doesNotMatch(html, /v16-utility__count/);
  });

  test('does not restore the V1.5 selector or numbered domain copy', () => {
    const source = readSrc('components/MobileLauncher.jsx');
    assert.doesNotMatch(source, /selectedKey|当前领域|主要入口|业务领域/);
  });
});

describe('V1.6 P1.1 module color and workspace contract', () => {
  test('defines the exact brand and six module colors', () => {
    const tokens = readSrc('styles/v16-tokens.css');
    for (const [name, value] of Object.entries({
      brand: '#1769E0', master: '#64748B', sales: '#1769E0', production: '#0F9F95',
      purchasing: '#5865D8', inventory: '#168AAD', analytics: '#7656D6',
    })) {
      const token = name === 'brand' ? '--v16-brand' : `--v16-module-${name}`;
      assert.match(tokens, new RegExp(`${token}:\\s*${value}`, 'i'));
    }
  });

  test('uses restrained tonal gradients only through module identity variables', () => {
    const css = readSrc('styles/v16-mobile-enterprise.css');
    assert.match(css, /--v16-module-gradient:\s*linear-gradient\(145deg,/);
    assert.match(css, /rgba\(23, 105, 224, 0\.16\)/);
    assert.match(css, /rgba\(118, 86, 214, 0\.05\)/);
    assert.doesNotMatch(css, /backdrop-filter\s*:\s*blur/i);
    assert.doesNotMatch(css, /filter\s*:\s*blur/i);
  });

  test('removes workspace card-wall primitives and keeps enterprise rows plus three columns', () => {
    const css = readSrc('styles/v16-mobile-enterprise.css');
    assert.match(css, /\.v16-task-row\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-bottom:/);
    assert.match(css, /\.v16-record-list\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
    assert.match(css, /\.v16-quick-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
    assert.match(css, /\.v16-quick-action\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;/);
  });

  test('workspace actions carry explicit module identity without changing status semantics', () => {
    const dashboard = readSrc('pages/master-data.jsx');
    assert.match(dashboard, /data-module=\{action\.module\}/);
    assert.match(dashboard, /module:\s*'sales'/);
    assert.match(dashboard, /module:\s*'purchasing'/);
    assert.match(dashboard, /module:\s*'inventory'/);
    assert.doesNotMatch(dashboard, /v16-status-pill[^\n]*data-module/);
    assert.match(dashboard, /pendingCount\s*>\s*0/);
  });

  test('preserves the strict five-tab navigation without cloud', () => {
    assert.deepEqual(MOBILE_TABS.map(({ key }) => key), [
      'messages', 'approvals', 'apps', 'workspace', 'profile',
    ]);
    assert.deepEqual(MOBILE_TABS.map(({ label }) => label), [
      '消息', '审批', '应用', '工作台', '我的',
    ]);
  });
});
