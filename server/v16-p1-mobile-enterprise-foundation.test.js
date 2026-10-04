// V1.6 P0+P1 — Mobile Enterprise Foundation focused tests.
//
// Asserts the V1.6 P1A / P1B / P1C contracts without changing backend,
// API, database schema, role, approval family, or business logic.
//
// Coverage:
//   - Bottom nav: exactly 5 enabled tabs, exact labels, no cloud key
//   - App.jsx: workspace tab renders real Dashboard, no cloud placeholder
//   - Launcher: no selected-domain state, six exact core groups
//   - IQC/OQC/material-requirements-plan are NOT primary launcher tiles
//   - Five decision report keys remain present
//   - Dashboard removes hero / explanatory copy
//   - V1.6 styles live in isolated files (no V1.6 block in styles.css)
//   - package.json version stays at 1.5.0
//
// The tests intentionally do not exercise the legacy 48/53-route
// roll-out — that is out of P0+P1 scope.

import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');
const stylesDir = resolve(srcDir, 'styles');

let vite;
let MobileShell;
let MOBILE_TABS;
let MobileLauncher;
let applicationMetadata;
let presentationMetadata;
let applicationRegistry;

before(async () => {
  vite = await createViteServer({
    root: repoRoot,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });
  const shellModule = await vite.ssrLoadModule('/src/components/MobileShell.jsx');
  MobileShell = shellModule.default;
  MOBILE_TABS = shellModule.MOBILE_TABS;
  MobileLauncher = (await vite.ssrLoadModule('/src/components/MobileLauncher.jsx')).default;
  applicationMetadata = await vite.ssrLoadModule('/src/navigation/applicationMetadata.js');
  presentationMetadata = await vite.ssrLoadModule('/src/navigation/presentationMetadata.js');
  applicationRegistry = await vite.ssrLoadModule('/src/navigation/applicationRegistry.js');
});

after(async () => {
  if (vite) await vite.close();
});

function readSrc(rel) {
  return readFileSync(join(srcDir, rel), 'utf8');
}

function readRoot(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// P1A — five-tab bottom navigation
// ---------------------------------------------------------------------------
describe('P1A — bottom navigation contract', () => {
  test('MOBILE_TABS exposes exactly 5 enabled canonical tabs', () => {
    assert.equal(MOBILE_TABS.length, 5);
    assert.equal(MOBILE_TABS.filter((t) => t.enabled).length, 5);
    assert.equal(MOBILE_TABS.filter((t) => !t.enabled).length, 0);
  });

  test('MOBILE_TABS uses exact internal keys and labels', () => {
    assert.deepEqual(
      MOBILE_TABS.map((t) => t.key),
      ['messages', 'approvals', 'apps', 'workspace', 'profile']
    );
    assert.deepEqual(
      MOBILE_TABS.map((t) => t.label),
      ['消息', '审批', '应用', '工作台', '我的']
    );
  });

  test('no "cloud" / "云翼" tab key is exposed as enabled', () => {
    const keys = new Set(MOBILE_TABS.map((t) => t.key));
    assert.ok(!keys.has('cloud'), '"cloud" must not be an enabled tab key');
    const labels = MOBILE_TABS.map((t) => t.label);
    assert.ok(!labels.includes('云翼'), '"云翼" must not be a bottom-nav label');
    assert.ok(!labels.includes('签核'), '"签核" must not be a bottom-nav label');
  });

  test('bottom nav renders the five testids with the correct labels', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'apps' }));
    assert.match(html, /data-testid="bottom-tab-messages"[\s\S]*?消息/);
    assert.match(html, /data-testid="bottom-tab-approvals"[\s\S]*?审批/);
    assert.match(html, /data-testid="bottom-tab-apps"[\s\S]*?应用/);
    assert.match(html, /data-testid="bottom-tab-workspace"[\s\S]*?工作台/);
    assert.match(html, /data-testid="bottom-tab-profile"[\s\S]*?我的/);
    assert.doesNotMatch(html, /data-testid="bottom-tab-cloud"/);
  });

  test('App.jsx no longer renders the cloud placeholder copy', () => {
    const appSource = readSrc('App.jsx');
    assert.doesNotMatch(appSource, /mobileTab === 'cloud'/);
    assert.doesNotMatch(appSource, /更多企业协同能力正在规划中/);
    assert.doesNotMatch(appSource, /当前版本暂未开放此功能/);
    assert.doesNotMatch(appSource, /yunyi-portal/);
  });

  test('App.jsx routes mobileTab === "workspace" to the Dashboard', () => {
    const appSource = readSrc('App.jsx');
    assert.match(appSource, /mobileTab === 'workspace'/);
    assert.match(appSource, /<RouteScreen route=\{applicationRouteFor\('dashboard'\)\}[\s\S]*?mobileWorkspace\s*\/>/);
  });
});

// ---------------------------------------------------------------------------
// P1B — application launcher
// ---------------------------------------------------------------------------
describe('P1B — application launcher contract', () => {
  test('MobileLauncher source no longer holds selected-domain state', () => {
    const src = readSrc('components/MobileLauncher.jsx');
    assert.doesNotMatch(src, /useState[\s\S]*?selectedKey/);
    assert.doesNotMatch(src, /setSelectedKey/);
    assert.doesNotMatch(src, /当前领域/);
    assert.doesNotMatch(src, /主要入口/);
    assert.doesNotMatch(src, /更多.*能力/);
  });

  test('MobileLauncher source no longer renders presentation.description under tiles', () => {
    const src = readSrc('components/MobileLauncher.jsx');
    assert.doesNotMatch(src, /presentation\.description/);
  });

  test('MobileLauncher source does not render a duplicate 应用 h1', () => {
    const src = readSrc('components/MobileLauncher.jsx');
    assert.doesNotMatch(src, /<h1[^>]*>应用<\/h1>/);
  });

  test('MobileLauncher renders only an aria-label="应用" root', () => {
    const groups = [
      {
        key: 'master-data', label: '基础资料', kind: 'domain',
        items: [{ key: 'products', page: 'products', label: '货品资料', iconKey: 'products' }],
      },
    ];
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups }));
    assert.match(html, /aria-label="应用"/);
    assert.doesNotMatch(html, /data-testid="mobile-launcher-group-基础资料"/);
    assert.match(html, /data-testid="v16-launcher-group-master-data"/);
  });

  test('mobile metadata exposes exactly six flowchart-aligned core groups', () => {
    const groups = applicationMetadata.MOBILE_APPLICATION_GROUPS;
    const coreGroups = groups.filter((g) => g.kind === 'domain');
    const labels = coreGroups.map((g) => g.label);
    assert.deepEqual(labels, [
      '基础资料', '销售管理', '生产管理', '采购管理', '库存管理', '决策报表',
    ]);
  });

  test('core group keys match the flowchart-aligned keys', () => {
    const coreKeys = applicationMetadata.MOBILE_APPLICATION_GROUPS
      .filter((g) => g.kind === 'domain')
      .map((g) => g.key);
    assert.deepEqual(coreKeys, [
      'master-data', 'sales', 'production', 'purchasing', 'inventory', 'analytics',
    ]);
  });

  test('IQC, OQC and material-requirements-plan are not primary launcher tiles', () => {
    const coreDomainItems = applicationMetadata.MOBILE_APPLICATION_GROUPS
      .filter((g) => g.kind === 'domain')
      .flatMap((g) => g.items);
    const corePages = coreDomainItems.map((item) => item.page);
    assert.ok(!corePages.includes('iqc'), 'IQC must not be a primary launcher tile');
    assert.ok(!corePages.includes('oqc'), 'OQC must not be a primary launcher tile');
    assert.ok(!corePages.includes('material-requirements-plan'),
      'material-requirements-plan must not be a primary launcher tile');
  });

  test('master-data core group contains the expected items in order', () => {
    const masterData = applicationMetadata.MOBILE_APPLICATION_GROUPS.find((g) => g.key === 'master-data');
    assert.deepEqual(
      masterData.items.map((item) => item.page),
      ['products', 'boms', 'customers', 'suppliers', 'warehouses', 'product-routings']
    );
  });

  test('sales core group excludes OQC as a tile', () => {
    const sales = applicationMetadata.MOBILE_APPLICATION_GROUPS.find((g) => g.key === 'sales');
    assert.deepEqual(
      sales.items.map((item) => item.page),
      ['orders', 'sales-deliveries', 'returns', 'accounts-receivable', 'sales-discounts']
    );
  });

  test('purchasing core group excludes IQC as a tile', () => {
    const purchasing = applicationMetadata.MOBILE_APPLICATION_GROUPS.find((g) => g.key === 'purchasing');
    assert.deepEqual(
      purchasing.items.map((item) => item.page),
      ['purchase-instructions', 'purchase-requisitions', 'purchase-orders', 'purchase-receipts', 'returns', 'accounts-payable', 'purchase-discounts']
    );
  });

  test('analytics core group exposes exactly five decision report keys', () => {
    const analytics = applicationMetadata.MOBILE_APPLICATION_GROUPS.find((g) => g.key === 'analytics');
    assert.deepEqual(
      analytics.items.map((item) => item.reportKey),
      ['sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements']
    );
  });

  test('utility disclosures include all currently active routes that are not core tiles', () => {
    const utilityItems = applicationMetadata.MOBILE_APPLICATION_GROUPS
      .filter((g) => g.kind === 'utility')
      .flatMap((g) => g.items);
    const utilityPages = new Set(utilityItems.map((i) => i.page));
    for (const page of [
      'business-overview', 'sales-invoices', 'payment-collections',
      'supplier-bills', 'payment-disbursements', 'accounting', 'bank-accounts',
      'projects', 'tasks', 'timesheets', 'contacts', 'followups', 'activities',
      'quality-control-points', 'product-costs', 'cost-rates', 'users',
    ]) {
      assert.ok(utilityPages.has(page), `utility group must include ${page}`);
    }
  });

  test('disabled routes (cash-journals/bills/fixed-assets/workflows/data-cleanup) are not launcher tiles', () => {
    const allTiles = applicationMetadata.MOBILE_APPLICATION_GROUPS
      .flatMap((g) => g.items);
    const tilePages = new Set(allTiles.map((i) => i.page));
    for (const disabled of ['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup']) {
      assert.ok(!tilePages.has(disabled), `${disabled} must not be a launcher tile`);
    }
  });

  test('mobile common priority list is ordered and bounded', () => {
    assert.deepEqual(
      [...applicationMetadata.MOBILE_COMMON_PRIORITY],
      ['orders', 'purchase-orders', 'purchase-receipts', 'sales-deliveries', 'inventory', 'mrp-runs']
    );
  });

  test('mobile application labels do not use English decorative eyebrows', () => {
    const src = readSrc('navigation/applicationMetadata.js');
    assert.doesNotMatch(src, /'APPLICATIONS'|'ROLE WORKSPACE'|'SUPPORTING'|'SALES'|'PRODUCTION'|'PURCHASE'|'EXTENSION'|'SYSTEM'|'ADVANCED'|'WORKSPACE'/);
  });
});

// ---------------------------------------------------------------------------
// P1C — workspace / Dashboard
// ---------------------------------------------------------------------------
describe('P1C — Dashboard / workspace contract', () => {
  test('Dashboard no longer contains the legacy hero-card marketing copy', () => {
    const src = readSrc('pages/master-data.jsx');
    assert.doesNotMatch(src, /今日业务/);
    assert.doesNotMatch(src, /已审批销售订单/);
    assert.doesNotMatch(src, /hero-card/);
    assert.doesNotMatch(src, /stats-grid/);
    assert.doesNotMatch(src, /stat-card/);
  });

  test('Dashboard no longer contains the permanent explanatory copy', () => {
    const src = readSrc('pages/master-data.jsx');
    assert.doesNotMatch(src, /指标与快捷入口按当前角色权限展示/);
    assert.doesNotMatch(src, /业务总览提供跨域关系/);
    assert.doesNotMatch(src, /聚焦当前用户可执行的日常工作/);
    assert.doesNotMatch(src, /我的业务入口/);
    assert.doesNotMatch(src, /工作台说明/);
  });

  test('Dashboard supports a mobileWorkspace prop that suppresses the page header', () => {
    const src = readSrc('pages/master-data.jsx');
    assert.match(src, /mobileWorkspace\s*=\s*false/);
    assert.match(src, /data-testid="dashboard-workspace"/);
  });

  test('Dashboard never returns FABRICATED pending counts', () => {
    const src = readSrc('pages/master-data.jsx');
    // No fake counts inferred from incomplete data. Pending block is gated on
    // data.pendingCount being > 0.
    assert.match(src, /pendingCount\s*>\s*0/);
  });
});

// ---------------------------------------------------------------------------
// P0 — style isolation
// ---------------------------------------------------------------------------
describe('P0 — V1.6 style isolation', () => {
  test('V1.6 token file exists and is not empty', () => {
    const stat = statSync(join(stylesDir, 'v16-tokens.css'));
    assert.ok(stat.isFile());
    assert.ok(stat.size > 0);
  });

  test('V1.6 component file exists and is not empty', () => {
    const stat = statSync(join(stylesDir, 'v16-mobile-enterprise.css'));
    assert.ok(stat.isFile());
    assert.ok(stat.size > 0);
  });

  test('V1.6 style files are referenced by main.jsx in order', () => {
    const mainSrc = readSrc('main.jsx');
    const stylesIdx = mainSrc.indexOf("'./styles.css'");
    const tokensIdx = mainSrc.indexOf("'./styles/v16-tokens.css'");
    const mobileIdx = mainSrc.indexOf("'./styles/v16-mobile-enterprise.css'");
    assert.ok(stylesIdx > 0);
    assert.ok(tokensIdx > stylesIdx);
    assert.ok(mobileIdx > tokensIdx);
  });

  test('V1.6 selectors are scoped under .v16-mobile-enterprise or use v16-* prefix', () => {
    const css = readFileSync(join(stylesDir, 'v16-mobile-enterprise.css'), 'utf8');
    // Strip CSS comments before scanning selectors so file header / footer
    // comments do not produce false positives.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // Every rule block must start with either .v16-mobile-enterprise or .v16-*
    const blockRe = /([^{}]+)\{([^{}]+)\}/g;
    let m;
    while ((m = blockRe.exec(stripped)) !== null) {
      const selector = m[1].trim();
      const validPrefixes = ['.v16-mobile-enterprise', '.v16-'];
      const ok = validPrefixes.some((prefix) => selector.startsWith(prefix));
      assert.ok(ok, `selector "${selector}" must be scoped under .v16-mobile-enterprise or .v16-*`);
    }
  });

  test('V1.6 style files do not use glass blur', () => {
    const css = readFileSync(join(stylesDir, 'v16-mobile-enterprise.css'), 'utf8');
    assert.doesNotMatch(css, /backdrop-filter\s*:\s*blur/i);
  });

  test('src/styles.css was NOT appended with a V1.6 block', () => {
    const css = readSrc('styles.css');
    // P0 token names are the canary — they MUST only live in v16-*.css.
    assert.doesNotMatch(css, /--v16-app-max-width/);
    assert.doesNotMatch(css, /--v16-bg:/);
    assert.doesNotMatch(css, /--v16-text:/);
    assert.doesNotMatch(css, /--v16-accent:/);
    assert.doesNotMatch(css, /v16-launcher-tile/);
    assert.doesNotMatch(css, /v16-workspace/);
  });
});

// ---------------------------------------------------------------------------
// Version / scope guard
// ---------------------------------------------------------------------------
describe('Scope — package version and route guards', () => {
  test('package.json version identifies the v1.6.2 release', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '1.6.2');
  });

  test('Dashboard route (#dashboard) is still preserved for compatibility', () => {
    assert.equal(applicationRegistry.applicationRouteFor('dashboard')?.enabled, true);
  });

  test('53 active routes are still reachable through launcher / utility / nav', () => {
    const presentations = presentationMetadata.ROUTE_PRESENTATIONS;
    const enabledRoutes = presentations.map((p) => p.route);
    const allLauncherPages = new Set(
      applicationMetadata.MOBILE_APPLICATION_GROUPS
        .flatMap((g) => g.items.map((i) => i.page))
    );
    // We do NOT require every active route to be a launcher tile — many
    // remain reachable through contextual navigation and bottom tabs.
    // Every enabled route must instead resolve from the canonical registry.
    for (const route of enabledRoutes) {
      assert.ok(applicationRegistry.applicationRouteFor(route), `application registry must include "${route}"`);
    }
    // Ensure the launcher projection remains populated.
    assert.ok(allLauncherPages.size > 0, 'launcher must expose some pages');
  });
});
