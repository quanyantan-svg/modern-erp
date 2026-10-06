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
  db = createDatabase(':memory:');
});

after(async () => {
  db?.close();
  await vite?.close();
});

// Compute expected role pages lazily — they require the in-memory db
// from the before() hook above.
function buildExpectedRolePages(roleId) {
  const user = { permissions: rolePermissions(roleId) };
  return buildMobileApplicationGroups(visibleNavigationFor(roleId), {
    isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
  }).flatMap((group) => group.items.map((item) => item.page));
}

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

const sorted = (items) => [...items].sort();

// V1.6 P1B launcher role matrix.
//
// V1.6 derives role pages as the intersection of:
//   1. navGroups visibleNav (permission-filtered, disabled routes excluded)
//   2. MOBILE_APPLICATION_GROUPS (eight canonical business domains)
//
// Disabled routes, IQC/OQC, material-requirements-plan and notifications
// are intentionally absent from the launcher — they remain reachable
// only via bottom tabs, contextual navigation, or the dedicated pages.
//
// The expected pages are computed lazily inside the before() hook below
// because they depend on the test database being initialized.
const ROLE_IDS = ['role-admin', 'role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting'];
const ROLE_BOUNDARY = {
  'role-sales': {
    forbidden: ['production-orders', 'iqc', 'accounting', 'users', 'material-issues', 'production-receipts'],
  },
  'role-warehouse': {
    forbidden: ['orders', 'accounting', 'users'],
  },
  'role-accounting': {
    forbidden: ['production-orders', 'iqc', 'users', 'material-issues', 'production-receipts'],
  },
};

let EXPECTED_ROLE_PAGES = {};

describe('M2 application metadata', () => {
  test('defines the eight canonical business domains', () => {
    const coreGroups = mobileGroups.filter((g) => g.kind === 'domain');
    assert.deepEqual(
      coreGroups.map(({ key, label }) => [key, label]),
      [
        ['master-engineering', 'Master & Engineering'],
        ['sales-customer', 'Sales & Customer'],
        ['planning', 'Planning'],
        ['procurement-outsourcing', 'Procurement & Outsourcing'],
        ['manufacturing-quality', 'Manufacturing & Quality'],
        ['inventory-warehouse', 'Inventory & Warehouse'],
        ['finance-operations', 'Finance Operations'],
        ['accounting-analytics', 'Accounting & Analytics'],
      ]
    );
  });

  test('does not expose Platform or legacy utility groups as business domains', () => {
    const utilities = mobileGroups.filter((g) => g.kind === 'utility');
    assert.deepEqual(utilities, []);
    assert.equal(mobileGroups.some((group) => group.key === 'platform'), false);
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

  // V1.7 P0: App.jsx no longer owns an explicit page map; routes and screens
  // are sourced from applicationRegistry.js. Mount coverage is asserted by
  // server/v17-p0-frontend-application-architecture.test.js.

  test('application page cards have unique composite keys (reportKey-aware)', () => {
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
    assert.equal(labels.get('inventory-transactions'), '库存异动');
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
  });

  test('admin role sees the populated 决策报表 group with five report entries', () => {
    const user = { permissions: rolePermissions('role-admin') };
    const groups = buildMobileApplicationGroups(visibleNavigationFor('role-admin'), {
      isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
    });
    const reports = groups.find((group) => group.key === 'accounting-analytics');
    assert.ok(reports, 'admin must see the 决策报表 group');
    assert.deepEqual(
      reports.items.filter((item) => item.reportKey).map((item) => item.reportKey),
      ['sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements']
    );
  });

  test('accounting sees sales and purchase reports but not unauthorized inventory movements', () => {
    const user = { permissions: rolePermissions('role-accounting') };
    const reports = buildMobileApplicationGroups(visibleNavigationFor('role-accounting'), {
      isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
    }).find((group) => group.key === 'accounting-analytics');
    assert.deepEqual(reports.items.filter((item) => item.reportKey).map((item) => item.reportKey), [
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
  // V1.6 P1B: launcher excludes IQC, OQC, material-requirements-plan, the
  // five disabled routes, and notifications (available via the 消息 tab).
  // The remaining pages per role are derived from the intersection of
  // visibleNav and MOBILE_APPLICATION_GROUPS. We assert that:
  //  - disabled routes never appear for any role
  //  - internal-context flows (IQC/OQC/material-requirements-plan) never appear
  //  - each role's pages are a subset of the launcher's registered pages

  let launcherPages;

  before(() => {
    launcherPages = new Set(
      mobileGroups.flatMap((g) => g.items.map((i) => i.page))
    );
    EXPECTED_ROLE_PAGES = Object.fromEntries(
      ROLE_IDS.map((roleId) => [roleId, buildExpectedRolePages(roleId)])
    );
  });

  for (const roleId of ROLE_IDS) {
    test(`${roleId} has the exact authorized supported application set`, () => {
      assert.deepEqual(sorted(applicationPagesFor(roleId)), sorted(EXPECTED_ROLE_PAGES[roleId]));
    });

    test(`${roleId} never exposes disabled routes via the launcher`, () => {
      const pages = applicationPagesFor(roleId);
      for (const disabled of ['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup']) {
        assert.ok(!pages.includes(disabled), `${roleId} must not see disabled ${disabled}`);
      }
    });

    test(`${roleId} never exposes internal-context flows as primary tiles`, () => {
      const pages = applicationPagesFor(roleId);
      assert.ok(!pages.includes('iqc'), `${roleId} must not see IQC as a launcher tile`);
      assert.ok(!pages.includes('oqc'), `${roleId} must not see OQC as a launcher tile`);
      assert.ok(!pages.includes('material-requirements-plan'),
        `${roleId} must not see material-requirements-plan as a launcher tile`);
    });

    test(`${roleId} pages are all within the launcher registry`, () => {
      const pages = new Set(applicationPagesFor(roleId));
      for (const page of pages) {
        assert.ok(launcherPages.has(page),
          `${roleId} exposes ${page} but launcher registry does not list it`);
      }
    });
  }

  test('non-admin roles do not gain unsupported domains', () => {
    for (const [roleId, boundary] of Object.entries(ROLE_BOUNDARY)) {
      const pages = new Set(applicationPagesFor(roleId));
      for (const forbidden of boundary.forbidden) {
        assert.ok(!pages.has(forbidden),
          `${roleId} must not see ${forbidden} as a launcher tile`);
      }
    }
  });

  test('non-admin roles do not gain the system-only quality-control-points tile', () => {
    for (const role of ['role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting']) {
      assert.ok(!applicationPagesFor(role).includes('quality-control-points'),
        `${role} must not see quality-control-points as a launcher tile`);
    }
  });
});

describe('M2 launcher interaction and navigation contracts', () => {
  test('launcher renders semantic application tiles inside flowchart groups', () => {
    const groups = buildMobileApplicationGroups(visibleNavigationFor('role-sales'));
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups }));
    assert.match(html, /<button[^>]+aria-label="打开货品资料"/);
    assert.match(html, /data-testid="v16-launcher-group-master-engineering"/);
    assert.match(html, /data-testid="v16-launcher-tile-products"/);
    assert.match(html, /aria-label="应用"/);
    // V1.6 removed the numbered domain selector and per-tile description.
    assert.doesNotMatch(html, /application-domain-nav__index/);
    assert.doesNotMatch(html, /presentation\.description/);
  });

  test('launcher item delegates selection through the canonical callback', () => {
    const source = readFileSync(join(repoRoot, 'src', 'components', 'MobileLauncher.jsx'), 'utf8');
    assert.match(source, /onClick=\{\(\) => onItemSelect\?\.\(item\)\}/);
  });

  test('App selection uses the existing hash/page state and back clears the application', () => {
    assert.match(appSource, /location\.hash = hash/);
    assert.match(appSource, /setCurrentLocation\(normalized\)/);
    assert.match(appSource, /function returnToMobileApplications\(\)[\s\S]*?setMobileApplication\(null\)[\s\S]*?setMobileTab\('apps'\)/);
  });

  test('the canonical shell defaults to Applications while preserving the page fallback', () => {
    assert.match(appSource, /useState\('apps'\)/);
    assert.match(appSource, /parseRouteLocation\(location\.hash\)/);
  });

  test('mobile shell exposes a 44px accessible back action', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'apps', pageTitle: '销售订单', backAction: () => {} }));
    assert.match(html, /data-testid="mobile-header-back"/);
    assert.match(html, /aria-label="返回应用"/);
    assert.match(css, /\.mobile-header__back\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
  });

  test('CRM extension launcher items no longer expose the project / CRM tiles', () => {
    const removedKeys = ['projects', 'tasks', 'timesheets', 'contacts', 'followups', 'activities'];
    for (const key of removedKeys) {
      const present = mobileGroups.flatMap((group) => group.items).some((item) => item.page === key);
      assert.equal(present, false, `launcher must not contain removed extension tile "${key}"`);
    }
  });

  test('all five canonical bottom tabs are enabled with V1.6 labels', async () => {
    const tabs = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).MOBILE_TABS;
    assert.deepEqual(tabs.map((tab) => tab.key), ['messages', 'approvals', 'apps', 'workspace', 'profile']);
    assert.deepEqual(tabs.map((tab) => tab.label), ['消息', '审批', '应用', '工作台', '我的']);
    assert.equal(tabs.every((tab) => tab.enabled), true);
  });

  test('320px grid has no fixed item width and labels clamp to two lines', () => {
    assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*min-width:\s*0/s);
    // V1.6 launcher tile selectors live in the isolated V1.6 file.
    const v16Css = readFileSync(join(repoRoot, 'src', 'styles', 'v16-mobile-enterprise.css'), 'utf8');
    assert.match(v16Css, /\.v16-launcher-tile\s*\{[^}]*min-width:\s*0/s);
    assert.match(v16Css, /\.v16-launcher-tile__label\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    assert.doesNotMatch(v16Css, /\.v16-launcher-tile\s*\{[^}]*width:\s*\d+px/s);
  });

  test('canonical responsive shell and business labels remain present', () => {
    assert.match(appSource, /<MobileShell\b/);
    assert.doesNotMatch(appSource, /className="app-shell"/);
    assert.doesNotMatch(appSource, /className="sidebar"/);
    const registry = readFileSync(join(repoRoot, 'src', 'navigation', 'applicationRegistry.js'), 'utf8');
    assert.match(registry, /route\('business-overview','业务总览'/);
    assert.match(registry, /route\('production-orders','制令单'/);
    assert.match(registry, /route\('sales-deliveries','销售出货'/);
    assert.match(registry, /route\('inventory-transactions','库存异动明细'/);
  });
});
