import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const appSource = readFileSync(join(repoRoot, 'src', 'App.jsx'), 'utf8');
const metadataSource = readFileSync(join(repoRoot, 'src', 'navigation', 'applicationMetadata.js'), 'utf8');
const css = readFileSync(join(repoRoot, 'src', 'styles.css'), 'utf8');

let vite;
let navGroups;
let mobileGroups;
let deferredApplications;
let buildMobileApplicationGroups;
let canViewDecisionReport;
let MobileLauncher;
let MobileShell;
let MobileCrmApplication;
let db;

before(async () => {
  vite = await createViteServer({
    root: repoRoot,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });
  ({ navGroups } = await vite.ssrLoadModule('/src/App.jsx'));
  ({
    MOBILE_APPLICATION_GROUPS: mobileGroups,
    DEFERRED_MOBILE_APPLICATIONS: deferredApplications,
    buildMobileApplicationGroups,
  } = await vite.ssrLoadModule('/src/navigation/applicationMetadata.js'));
  ({ canViewDecisionReport } = await vite.ssrLoadModule('/src/pages/decision-reports.jsx'));
  MobileLauncher = (await vite.ssrLoadModule('/src/components/MobileLauncher.jsx')).default;
  MobileShell = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).default;
  MobileCrmApplication = (await vite.ssrLoadModule('/src/components/MobileCrmApplication.jsx')).default;
  db = createDatabase(':memory:');
});

after(async () => {
  db?.close();
  await vite?.close();
});

function rolePermissions(roleId) {
  return db.prepare(`
    SELECT rp.permission_code AS code
    FROM role_permissions rp
    WHERE rp.role_id = ?
    ORDER BY rp.permission_code
  `).all(roleId).map((row) => row.code);
}

function visibleNavigationFor(roleId) {
  const permissions = rolePermissions(roleId);
  return navGroups.flatMap((group) => group.items || []).filter((item) => (
    item.permission
      ? permissions.includes(item.permission)
      : item.any.some((permission) => permissions.includes(permission))
  ));
}

function applicationPagesFor(roleId) {
  const user = { permissions: rolePermissions(roleId) };
  return buildMobileApplicationGroups(visibleNavigationFor(roleId), {
    isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
  })
    .flatMap((group) => group.items.map((item) => item.page));
}

const EXPECTED_ROLE_PAGES = {
  'role-admin': [
    'business-overview',
    'customers', 'suppliers', 'products', 'warehouses',
    'forecasts', 'mrp-runs', 'material-requirements-plan',
    'production-instructions', 'purchase-instructions', 'purchase-requisitions',
    'production-orders', 'material-issues', 'production-receipts', 'boms', 'product-routings',
    'orders', 'sales-deliveries', 'returns', 'contacts',
    'purchase-orders', 'purchase-receipts', 'returns',
    'inventory', 'inventory-scraps', 'inventory-month-end', 'inventory-transactions', 'traceability',
    'iqc', 'oqc', 'quality-control-points', 'product-costs', 'cost-rates', 'sales-invoices', 'accounts-receivable', 'payment-collections',
    'accounts-payable', 'supplier-bills', 'payment-disbursements', 'sales-discounts', 'purchase-discounts', 'accounting', 'system-health', 'go-live', 'cash-journals', 'bank-accounts',
    'bills', 'fixed-assets', 'decision-reports', 'decision-reports', 'decision-reports', 'decision-reports', 'decision-reports',
    'projects', 'tasks', 'timesheets', 'workflows', 'users', 'data-cleanup', 'notifications',
  ],
  // V1.3 Phase 1: SALES owns commercial entry (customers, suppliers,
  // SO/PO/PR create/submit) and CRM. Logistics execution pages
  // (sales-deliveries, purchase-receipts, returns) are no longer in
  // the sales surface — those moved to warehouse.
  'role-sales': [
    'business-overview', 'customers', 'suppliers', 'products',
    'purchase-requisitions',
    'orders', 'contacts', 'purchase-orders',
    'notifications',
  ],
  'role-reviewer': [
    'business-overview', 'customers', 'products', 'warehouses',
    'purchase-requisitions',
    'orders', 'sales-deliveries', 'returns',
    'purchase-orders', 'purchase-receipts', 'returns', 'inventory', 'inventory-transactions', 'traceability', 'notifications',
  ],
  // V1.3 Phase 1: WAREHOUSE owns physical stock execution including
  // material issue and production receipt; sales-deliveries / returns
  // and purchase-receipts / returns move into the warehouse surface.
  'role-warehouse': [
    'business-overview', 'products', 'warehouses',
    'production-orders', 'material-issues', 'production-receipts',
    'sales-deliveries', 'returns',
    'purchase-receipts', 'returns',
    'inventory', 'inventory-scraps', 'inventory-transactions', 'traceability', 'iqc', 'oqc',
    'notifications',
  ],
  'role-accounting': [
    'business-overview', 'orders', 'purchase-orders',
    'sales-invoices', 'accounts-receivable', 'payment-collections', 'accounts-payable', 'supplier-bills', 'payment-disbursements',
    'sales-discounts', 'purchase-discounts',
    'accounting', 'system-health', 'go-live', 'cash-journals',
    'bank-accounts', 'bills', 'fixed-assets',
    'decision-reports', 'decision-reports', 'decision-reports', 'decision-reports', 'notifications',
  ],
};

describe('M2 application metadata', () => {
  test('defines the teacher-aligned product groups in order (planning added by P1)', () => {
    assert.deepEqual(
      mobileGroups.map(({ key, label }) => [key, label]),
      [
        ['overview', '概览'], ['master-data', '基础资料'],
        ['planning', '计划与生产'],
        ['sales', '销售'],
        ['purchasing', '采购'], ['inventory', '库存'],
        ['quality', '质量'],
        ['finance', '财务'], ['reports', '决策报表'],
        ['projects', '项目'], ['system', '系统'],
      ]
    );
  });

  test('contains no permission definitions or role/username branches', () => {
    assert.doesNotMatch(metadataSource, /permission\s*:/);
    assert.doesNotMatch(metadataSource, /test_(?:admin|sales|reviewer|warehouse|accounting)/i);
    assert.doesNotMatch(metadataSource, /user\.username|username\s*===/);
  });

  test('every application points to a canonical navigation page', () => {
    const navPages = new Set(navGroups.flatMap((group) => group.items || []).map((item) => item.key));
    for (const item of mobileGroups.flatMap((group) => group.items)) {
      assert.ok(navPages.has(item.page), `unknown mobile page: ${item.page}`);
    }
  });

  test('every application page is mounted by the existing App page map', () => {
    for (const item of mobileGroups.flatMap((group) => group.items)) {
      assert.match(
        appSource,
        new RegExp(`(?:['"]${item.page}['"]|${item.page}):\\s*<[A-Z]`),
        `unmounted mobile page: ${item.page}`
      );
    }
  });

  test('application page cards have unique composite keys (reportKey-aware)', () => {
    // M7 decision reports intentionally expose five cards that all point at the
    // same 'decision-reports' page; buildMobileApplicationGroups adds a
    // composite `key` (page:reportKey) so React keys stay unique. The static
    // `page` field is allowed to repeat; the runtime composite `key` is what
    // the launcher uses.
    const items = buildMobileApplicationGroups(visibleNavigationFor('role-admin'))
      .flatMap((group) => group.items);
    const compositeKeys = items.map((item) => item.key || item.page);
    assert.equal(new Set(compositeKeys).size, compositeKeys.length,
      'composite keys must be unique across all launcher cards');
  });

  test('mobile labels do not rename canonical page keys', () => {
    const labels = new Map(mobileGroups.flatMap((group) => group.items.map((item) => [item.page, item.mobileLabel])));
    assert.equal(labels.get('production-orders'), '制令单');
    assert.equal(labels.get('sales-deliveries'), '销售出货');
    assert.equal(labels.get('inventory-transactions'), '库存异动明细');
    assert.ok(!labels.has('制令单'));
  });

  test('sales and purchase returns are distinct launcher entries into one canonical page', () => {
    const returns = mobileGroups.flatMap((group) => group.items).filter((item) => item.page === 'returns');
    assert.deepEqual(returns.map((item) => [item.key, item.mobileLabel, item.target.documentType]), [
      ['returns:sales', '销售退货', 'SALES_RETURN'],
      ['returns:purchase', '采购退货', 'PURCHASE_RETURN'],
    ]);
  });

  test('deferred and fake applications are absent from launcher items', () => {
    const labels = mobileGroups.flatMap((group) => group.items.map((item) => item.mobileLabel));
    for (const deferred of deferredApplications) assert.ok(!labels.includes(deferred), deferred);
  });

  test('empty groups are removed at runtime', () => {
    const groups = buildMobileApplicationGroups(visibleNavigationFor('role-sales'));
    assert.ok(groups.every((group) => group.items.length > 0));
    // role-sales has no REPORT_VIEW, so 决策报表 group must be filtered out.
    assert.ok(!groups.some((group) => group.key === 'reports'));
  });

  test('admin role sees the populated 决策报表 group', () => {
    const user = { permissions: rolePermissions('role-admin') };
    const groups = buildMobileApplicationGroups(visibleNavigationFor('role-admin'), {
      isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
    });
    const reports = groups.find((group) => group.key === 'reports');
    assert.ok(reports, 'admin must see the 决策报表 group');
    assert.ok(reports.items.length >= 5, '决策报表 must expose five report cards');
  });

  test('accounting sees sales and purchase reports but not unauthorized inventory movements', () => {
    const user = { permissions: rolePermissions('role-accounting') };
    const reports = buildMobileApplicationGroups(visibleNavigationFor('role-accounting'), {
      isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
    }).find((group) => group.key === 'reports');
    assert.deepEqual(reports.items.map((item) => item.reportKey), [
      'sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding',
    ]);
  });

  test('visibility is the intersection of mobile metadata and visibleNav', () => {
    const oneVisibleItem = navGroups.flatMap((group) => group.items).find((item) => item.key === 'products');
    assert.deepEqual(applicationPagesFor('role-accounting').includes('products'), false);
    assert.deepEqual(buildMobileApplicationGroups([oneVisibleItem]).flatMap((g) => g.items.map((i) => i.page)), ['products']);
  });
});

describe('M2 canonical role application matrix', () => {
  for (const [roleId, expected] of Object.entries(EXPECTED_ROLE_PAGES)) {
    test(`${roleId} has the exact authorized supported application set`, () => {
      assert.deepEqual(applicationPagesFor(roleId), expected);
    });
  }

  test('non-admin roles do not gain unsupported domains', () => {
    assert.ok(!applicationPagesFor('role-sales').some((page) => ['production-orders', 'iqc', 'accounting', 'users', 'material-issues', 'production-receipts'].includes(page)));
    assert.ok(!applicationPagesFor('role-warehouse').some((page) => ['orders', 'accounting', 'users'].includes(page)));
    assert.ok(!applicationPagesFor('role-accounting').some((page) => ['production-orders', 'iqc', 'users', 'material-issues', 'production-receipts'].includes(page)));
    for (const role of ['role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting']) assert.ok(!applicationPagesFor(role).includes('quality-control-points'));
  });
});

describe('M2 launcher interaction and navigation contracts', () => {
  test('launcher renders semantic three-column application buttons', () => {
    const groups = buildMobileApplicationGroups(visibleNavigationFor('role-sales'));
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups }));
    assert.match(html, /<button[^>]+aria-label="打开销售订单"/);
    assert.match(html, /data-page="orders"/);
    assert.match(css, /\.mobile-launcher__grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  });

  test('launcher item click calls the canonical selection callback with its item', () => {
    const item = { page: 'orders', key: 'orders', label: '销售订单', iconKey: 'orders' };
    let selected = null;
    const tree = MobileLauncher({ groups: [{ key: 'sales', label: '销售管理', items: [item] }], onItemSelect: (value) => { selected = value; } });
    const group = tree.props.children[0];
    const grid = group.props.children[1];
    grid.props.children[0].props.onClick();
    assert.equal(selected, item);
  });

  test('App selection uses the existing hash/page state and back clears the application', () => {
    assert.match(appSource, /location\.hash\s*=\s*authorizedPage\.key/);
    assert.match(appSource, /setPage\(authorizedPage\.key\)/);
    assert.match(appSource, /function returnToMobileApplications\(\)[\s\S]*?setMobileApplication\(null\)[\s\S]*?setMobileTab\('apps'\)/);
  });

  test('the canonical shell defaults to Applications while preserving the page fallback', () => {
    assert.match(appSource, /useState\('apps'\)/);
    assert.match(appSource, /location\.hash\.slice\(1\) \|\| 'dashboard'/);
  });

  test('mobile shell exposes a 44px accessible back action', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'apps', pageTitle: '销售订单', backAction: () => {} }));
    assert.match(html, /data-testid="mobile-header-back"/);
    assert.match(html, /aria-label="返回应用"/);
    assert.match(css, /\.mobile-header__back\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
  });

  test('CRM is one launcher app with accessible internal sub-navigation', () => {
    const crmCards = mobileGroups.flatMap((group) => group.items).filter((item) => ['contacts', 'followups', 'activities'].includes(item.page));
    assert.deepEqual(crmCards.map((item) => [item.page, item.mobileLabel]), [['contacts', '客户关系']]);
    const html = renderToStaticMarkup(createElement(MobileCrmApplication, { user: { permissions: [] }, notify: () => {} }));
    assert.match(html, /role="tablist"/);
    assert.match(html, />联系人</);
    assert.match(html, />客户跟进</);
    assert.match(html, />销售活动</);
  });

  test('all five canonical bottom tabs are enabled', async () => {
    const tabs = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).MOBILE_TABS;
    assert.deepEqual(tabs.map((tab) => tab.label), ['消息', '签核', '应用', '云翼', '我的']);
    assert.equal(tabs.every((tab) => tab.enabled), true);
  });

  test('320px grid has no fixed item width and labels clamp to two lines', () => {
    assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*min-width:\s*0/s);
    assert.match(css, /\.mobile-launcher__item\s*\{[^}]*min-width:\s*0/s);
    assert.match(css, /\.mobile-launcher__item-label\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    assert.doesNotMatch(css, /\.mobile-launcher__item\s*\{[^}]*width:\s*\d+px/s);
  });

  test('canonical responsive shell and business labels remain present', () => {
    assert.match(appSource, /<MobileShell\b/);
    assert.doesNotMatch(appSource, /className="app-shell"/);
    assert.doesNotMatch(appSource, /className="sidebar"/);
    assert.match(appSource, /key: 'business-overview', label: '业务总览'/);
    assert.match(appSource, /key: 'production-orders', label: '制令单'/);
    assert.match(appSource, /key: 'sales-deliveries', label: '销售出货'/);
    assert.match(appSource, /key: 'inventory-transactions', label: '库存异动明细'/);
  });
});
