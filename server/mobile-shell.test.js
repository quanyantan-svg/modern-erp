// M1 focused tests — Mobile Shell.
//
// These tests cover the M1 UI infrastructure contract:
//   1. CSS breakpoint contract: 767 → mobile, 768 → non-mobile
//   2. MobileShell renders bottom navigation with 4 enabled tabs + 1 disabled
//   3. Disabled 通讯录 tab does not navigate and does not throw
//   4. State preservation on resize (mobileTab + page survive layout switch)
//   5. No duplicate hidden business page mounting
//   6. Role permissions are not changed
//   7. Desktop nav still renders at desktop layout
//   8. Local example assets are not imported into production bundle
//
// The tests intentionally avoid touching any server business handler
// or business page JSX. They are pure UI infrastructure tests.
//
// Vite SSR is used to load .jsx files (Node's native ESM loader
// cannot import JSX directly).

import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer as createViteServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');

let vite;
let MobileShell;
let MobileShellTabs;
let MobilePage;
let MobileLauncher;

before(async () => {
  vite = await createViteServer({
    root: repoRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  MobileShell = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).default;
  MobileShellTabs = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).MOBILE_TABS;
  MobilePage = (await vite.ssrLoadModule('/src/components/MobilePage.jsx')).default;
  MobileLauncher = (await vite.ssrLoadModule('/src/components/MobileLauncher.jsx')).default;
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
// 1. CSS breakpoint contract
// ---------------------------------------------------------------------------
describe('CSS — mobile breakpoint contract', () => {
  const css = readSrc('styles.css');

  test('mobile-only rule uses max-width: 767.98px', () => {
    assert.match(
      css,
      /@media\s*\(max-width:\s*767\.98px\)/,
      'styles.css must contain a @media (max-width: 767.98px) rule'
    );
  });

  test('tablet range uses (min-width: 768px) and (max-width: 1023.98px)', () => {
    assert.match(
      css,
      /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1023\.98px\)/,
      'styles.css must contain a tablet media query'
    );
  });

  test('useMobile hook uses the same breakpoint as CSS', () => {
    const hook = readSrc('hooks/useMediaQuery.js');
    assert.match(
      hook,
      /\(max-width:\s*767\.98px\)/,
      'useMobile hook must use the canonical 767.98px breakpoint'
    );
  });

  test('767px → mobile, 768px → non-mobile (boundary rule)', () => {
    assert.match(css, /max-width:\s*767\.98px/);
    assert.match(css, /min-width:\s*768px/);
    assert.equal(
      /max-width:\s*767\.98px[\s\S]{0,40}?768/.test(css),
      false,
      '768 must not appear within a mobile-only media query'
    );
  });

  test('body min-width is no longer 1100px (mobile blocker removed)', () => {
    assert.equal(
      /body\s*\{[^}]*min-width:\s*1100px/.test(css),
      false,
      'body { min-width: 1100px } must be removed for mobile rendering'
    );
  });

  test('html / body / #root allow 320px rendering', () => {
    assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*min-width:\s*0/, 'must allow 0+ width on root elements');
  });

  test('safe-area-inset-top and safe-area-inset-bottom are used', () => {
    assert.match(css, /env\(safe-area-inset-top/);
    assert.match(css, /env\(safe-area-inset-bottom/);
  });
});

// ---------------------------------------------------------------------------
// 2-3. MobileShell renders bottom navigation correctly
// ---------------------------------------------------------------------------
describe('MobileShell — bottom navigation', () => {
  test('exports exactly 5 tabs (4 enabled + 1 disabled)', () => {
    assert.equal(MobileShellTabs.length, 5, 'MobileShell must render 5 tabs');
    const enabled = MobileShellTabs.filter((t) => t.enabled);
    const disabled = MobileShellTabs.filter((t) => !t.enabled);
    assert.equal(enabled.length, 4, 'MobileShell must have 4 enabled tabs');
    assert.equal(disabled.length, 1, 'MobileShell must have 1 disabled tab');
    assert.equal(disabled[0].key, 'directory', 'The disabled tab must be 通讯录 / directory');
  });

  test('renders the shell wrapper, header, main, and bottom nav', () => {
    const html = renderToStaticMarkup(
      createElement(MobileShell, { activeTab: 'apps' }, createElement('div', null, 'body'))
    );
    assert.match(html, /data-testid="mobile-shell"/);
    assert.match(html, /data-testid="mobile-header"/);
    assert.match(html, /data-testid="mobile-main"/);
    assert.match(html, /data-testid="mobile-bottom-nav"/);
  });

  test('renders all 5 bottom nav buttons with correct labels', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'apps' }));
    assert.match(html, /data-testid="bottom-tab-messages"[\s\S]*?>[\s\S]*?消息/);
    assert.match(html, /data-testid="bottom-tab-approvals"[\s\S]*?>[\s\S]*?审批/);
    assert.match(html, /data-testid="bottom-tab-apps"[\s\S]*?>[\s\S]*?应用/);
    assert.match(html, /data-testid="bottom-tab-directory"[\s\S]*?>[\s\S]*?通讯录/);
    assert.match(html, /data-testid="bottom-tab-profile"[\s\S]*?>[\s\S]*?我的/);
  });

  test('disabled 通讯录 tab is marked aria-disabled and has a hint', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'apps' }));
    assert.match(
      html,
      /data-testid="bottom-tab-directory"[\s\S]*?aria-disabled="true"/,
      'disabled directory tab must expose aria-disabled="true"'
    );
    assert.match(html, /bottom-tab-directory[\s\S]*?敬请期待/);
  });

  test('disabled 通讯录 onClick does not invoke onTabChange', () => {
    const source = readSrc('components/MobileShell.jsx');
    // Find the disabled-button code path
    assert.match(
      source,
      /if\s*\(\s*!tab\.enabled\s*\)\s*\{[\s\S]*?onClick=[\s\S]{0,80}?e\.preventDefault/,
      'disabled tab onClick must call e.preventDefault()'
    );
    // The disabled branch must NOT call onTabChange
    const disabledBranch = source.match(/if\s*\(\s*!tab\.enabled\s*\)\s*\{[\s\S]*?\}\s*\}/);
    assert.ok(disabledBranch, 'disabled branch must exist');
    assert.equal(
      /onTabChange\s*\(/.test(disabledBranch[0]),
      false,
      'disabled branch must not invoke onTabChange'
    );
  });

  test('active tab is visually marked with the active class', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'approvals' }));
    assert.match(
      html,
      /data-testid="bottom-tab-approvals"[\s\S]*?mobile-bottom-nav__item--active/,
      'the approvals tab must carry the active class when selected'
    );
    assert.doesNotMatch(
      html,
      /data-testid="bottom-tab-apps"[\s\S]*?mobile-bottom-nav__item--active/,
      'non-active tab must not carry the active class'
    );
  });

  test('aria-current=page is exposed for the active tab', () => {
    const html = renderToStaticMarkup(createElement(MobileShell, { activeTab: 'profile' }));
    assert.match(
      html,
      /data-testid="bottom-tab-profile"[\s\S]*?aria-current="page"/
    );
  });
});

// ---------------------------------------------------------------------------
// 4-5. State preservation on resize + no duplicate business page mounting
// ---------------------------------------------------------------------------
describe('App.jsx — responsive composition', () => {
  const appSource = readSrc('App.jsx');

  test('uses the useMobile hook for layout switching', () => {
    assert.match(appSource, /useMobile\(\)/, 'App.jsx must use the useMobile hook');
  });

  test('desktop tree and mobile tree are NOT rendered simultaneously', () => {
    assert.match(
      appSource,
      /if\s*\(\s*isMobile\s*\)\s*\{[\s\S]*?return\s*\([\s\S]*?MobileShell/,
      'mobile branch must return <MobileShell> early'
    );
    assert.match(
      appSource,
      /return <div className="app-shell">/,
      'desktop branch (app-shell) must remain as the fallthrough'
    );
  });

  test('mobile branch body does not reference the pages map', () => {
    // The pages map can be defined anywhere, but the mobile branch
    // body (the JSX returned from the if (isMobile) early-return)
    // must NOT reference the pages variable or any business page
    // component, so that no business page is mounted on mobile.
    const mobileIdx = appSource.indexOf('if (isMobile)');
    const mobileEnd = appSource.indexOf('return <div className="app-shell">', mobileIdx);
    assert.ok(mobileIdx > 0, 'mobile branch must exist');
    assert.ok(mobileEnd > mobileIdx, 'desktop branch must exist after mobile branch');
    const mobileBranch = appSource.slice(mobileIdx, mobileEnd);
    assert.equal(
      /\bpages\[/.test(mobileBranch),
      false,
      'mobile branch must not index the pages map (would mount business components)'
    );
    // No business page component should appear in the mobile branch
    const businessComponents = [
      'Dashboard', 'Orders', 'Approvals', 'Customers', 'Suppliers',
      'PurchaseOrders', 'Products', 'Warehouses', 'Inventory',
      'Notifications', 'Accounting', 'ProductionOrders', 'Boms',
    ];
    for (const comp of businessComponents) {
      assert.equal(
        new RegExp(`<${comp}[\\s/>]`).test(mobileBranch),
        false,
        `mobile branch must not render <${comp}> directly`
      );
    }
  });

  test('mobileTab state is preserved across resize (independent of page state)', () => {
    assert.match(appSource, /useState\('apps'\)/, 'mobileTab must default to "apps"');
    assert.match(appSource, /setMobileTab\(/, 'setMobileTab must be wired');
  });

  test('directory tab is not in MOBILE_TAB_KEYS (cannot be navigated to)', () => {
    assert.match(
      appSource,
      /MOBILE_TAB_KEYS\.has\(key\)/,
      'handleMobileTabChange must filter against MOBILE_TAB_KEYS'
    );
  });

  test('App.jsx does not introduce new permission code strings', () => {
    const knownPermissions = [
      'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE', 'DASHBOARD_VIEW', 'USERS_MANAGE',
      'ROLES_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'PRODUCTS_VIEW',
      'PRODUCTS_MANAGE', 'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT',
      'ORDERS_APPROVE', 'ORDERS_REJECT', 'PURCHASE_ORDERS_VIEW',
      'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE',
      'WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE', 'INVENTORY_VIEW',
      'INVENTORY_CHECK_CREATE', 'INVENTORY_CHECK_APPROVE',
      'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE',
      'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE',
      'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE',
      'RETURNS_VIEW', 'RETURNS_MANAGE', 'PRODUCTION_ORDERS_VIEW',
      'PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_START',
      'PRODUCTION_ORDERS_COMPLETE', 'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT',
      'VOUCHER_APPROVE', 'CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE',
      'BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE', 'BILLS_VIEW', 'BILLS_MANAGE',
      'DEPARTMENTS_VIEW', 'DEPARTMENTS_MANAGE', 'PROJECTS_VIEW', 'PROJECTS_MANAGE',
      'PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE', 'BANK_RECONCILE_VIEW',
      'BANK_RECONCILE_MANAGE', 'CURRENCY_VIEW', 'CURRENCY_MANAGE',
      'VOUCHER_WORDS_VIEW', 'VOUCHER_WORDS_MANAGE', 'VOUCHER_TEMPLATES_VIEW',
      'VOUCHER_TEMPLATES_MANAGE', 'OA_VIEW', 'OA_MANAGE', 'ALERT_VIEW', 'ALERT_MANAGE',
      'REPORT_VIEW', 'MRP_VIEW', 'MRP_MANAGE', 'WORK_CENTERS_VIEW',
      'WORK_CENTERS_MANAGE', 'ROUTING_VIEW', 'ROUTING_MANAGE',
      'PRODUCTION_COSTS_VIEW', 'PRODUCTION_COSTS_MANAGE', 'IQC_VIEW', 'IQC_MANAGE',
      'OQC_VIEW', 'OQC_MANAGE', 'SUPPLIER_EVAL_VIEW', 'SUPPLIER_EVAL_MANAGE',
      'OA_LEAVE_VIEW', 'OA_LEAVE_MANAGE', 'OA_EXPENSE_VIEW', 'OA_EXPENSE_MANAGE',
      'ALERT_RULES_VIEW', 'ALERT_RULES_MANAGE', 'COST_VIEW', 'COST_MANAGE',
      'CRM_VIEW', 'CRM_MANAGE', 'PROJECT_VIEW', 'PROJECT_MANAGE',
      'WORKFLOW_VIEW', 'WORKFLOW_MANAGE', 'FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE',
      'PRODUCTION_MATERIAL_ISSUE_MANAGE', 'PRODUCTION_RECEIPT_MANAGE',
      'AR_VIEW', 'COLLECTION_MANAGE', 'AP_VIEW', 'PAYMENT_MANAGE',
      'PRODUCTION_INSTRUCTION_VIEW', 'PRODUCTION_INSTRUCTION_MANAGE',
      'PURCHASE_INSTRUCTION_VIEW', 'PURCHASE_INSTRUCTION_MANAGE',
      'PURCHASE_REQUISITION_VIEW', 'PURCHASE_REQUISITION_MANAGE',
      'PURCHASE_REQUISITION_APPROVE',
    ];
    const refs = new Set();
    const re = /\b([A-Z][A-Z0-9_]+_(?:VIEW|MANAGE|CREATE|SUBMIT|APPROVE|REJECT|START|COMPLETE))\b/g;
    let m;
    while ((m = re.exec(appSource)) !== null) refs.add(m[1]);
    for (const ref of refs) {
      assert.ok(
        knownPermissions.includes(ref),
        `App.jsx references unknown permission code "${ref}" — M1 must not introduce new permissions`
      );
    }
  });

  test('App.jsx does not call any business API endpoint from mobile branches', () => {
    const mobileIdx = appSource.indexOf('function renderMobileContent');
    const mobileEnd = appSource.indexOf('// M1 responsive composition', mobileIdx);
    assert.ok(mobileIdx > 0 && mobileEnd > mobileIdx);
    const mobileBranch = appSource.slice(mobileIdx, mobileEnd);
    assert.equal(/\bapi\s*\(/.test(mobileBranch), false, 'Mobile branch must not call the api() helper');
    assert.equal(/\/api\//.test(mobileBranch), false, 'Mobile branch must not reference /api/ endpoints');
  });
});

// ---------------------------------------------------------------------------
// 6. Role permissions are not changed
// ---------------------------------------------------------------------------
describe('Permissions — canonical registry count', () => {
  test('PERMISSIONS array in server/db.js has 100 entries after M8 settlement additions', async () => {
    const db = await import('../server/db.js');
    const perms = db.PERMISSIONS.filter((p) => Array.isArray(p) && p[0]);
    assert.equal(perms.length, 107, `PERMISSIONS array must have 107 entries after M12 (got ${perms.length})`);
    assert.equal(perms.filter(([code]) => code === 'INVENTORY_ADJUSTMENT_MANAGE').length, 1);
    assert.equal(perms.filter(([code]) => code === 'PRODUCTION_MATERIAL_ISSUE_MANAGE').length, 1);
    assert.equal(perms.filter(([code]) => code === 'PRODUCTION_RECEIPT_MANAGE').length, 1);
  });

  test('role-accounting has 18 permissions after four narrow M8 grants', () => {
    const dbSrc = readRoot('server/db.js');
    const accountingMatch = dbSrc.match(/'role-accounting':\s*\[([^\]]+)\]/);
    assert.ok(accountingMatch, 'role-accounting must exist in db.js');
    const count = (accountingMatch[1].match(/'/g) || []).length;
    assert.equal(count / 2, 18, `role-accounting must have 18 permissions (got ${count / 2})`);
  });
});

// ---------------------------------------------------------------------------
// 7. Desktop nav still renders at desktop layout
// ---------------------------------------------------------------------------
describe('Desktop shell — preserved', () => {
  test('app-shell + sidebar + topbar are unchanged in App.jsx', () => {
    const appSource = readSrc('App.jsx');
    assert.match(appSource, /return <div className="app-shell">/);
    assert.match(appSource, /<aside className="sidebar">/);
    assert.match(appSource, /<header className="topbar">/);
    assert.match(appSource, /<section className="page-content">/);
  });

  test('navGroups array still has all 10 group labels', () => {
    const appSource = readSrc('App.jsx');
    const groupLabels = [
      '概览', '销售与采购', '基础资料', '仓储物流', '财务资金',
      '生产制造', '成本与质量', '项目管理', 'CRM客户关系', '系统设置',
    ];
    for (const label of groupLabels) {
      assert.ok(
        appSource.includes(`label: '${label}'`),
        `navGroups must still include "${label}"`
      );
    }
  });

  test('business page map still contains all canonical pages', () => {
    const appSource = readSrc('App.jsx');
    const pages = [
      'dashboard', 'orders', 'approvals', 'customers', 'suppliers',
      'purchase-orders', 'products', 'warehouses', 'inventory',
      'cash-journals', 'bank-accounts', 'bills', 'fixed-assets',
      'product-costs', 'cost-rates', 'iqc', 'oqc', 'contacts', 'followups',
      'activities', 'projects', 'tasks', 'timesheets', 'notifications',
      'workflows', 'accounting', 'purchase-receipts', 'sales-deliveries',
      'returns', 'inventory-transactions', 'boms', 'production-orders',
      'users',
    ];
    for (const key of pages) {
      // Keys may be quoted ('key':) or unquoted (key:) depending on
      // whether they are valid JS identifiers. Both forms must be
      // accepted.
      assert.ok(
        new RegExp(`(?:['"]${key}['"]|${key}):\\s*<[A-Z]`).test(appSource),
        `pages map must include "${key}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 8. MobilePage + MobileLauncher primitives
// ---------------------------------------------------------------------------
describe('MobilePage — reusable container', () => {
  test('renders title, body, and action bar slots', () => {
    const html = renderToStaticMarkup(
      createElement(
        MobilePage,
        {
          title: '销售订单',
          subtitle: 'M1 placeholder',
          actions: createElement('button', null, '+ 新建'),
          bottomActions: createElement('button', null, '保存草稿'),
        },
        createElement('div', { 'data-testid': 'child' }, 'content')
      )
    );
    assert.match(html, /mobile-page__title[^>]*>销售订单/);
    assert.match(html, /mobile-page__subtitle[^>]*>M1 placeholder/);
    assert.match(html, /data-testid="child"/);
    assert.match(html, /mobile-page__action-bar/);
  });

  test('honors bodyState="empty" with empty text', () => {
    const html = renderToStaticMarkup(
      createElement(MobilePage, { bodyState: 'empty', emptyText: '暂无数据' })
    );
    assert.match(html, /data-testid="mobile-page-empty"[^>]*>[\s\S]*?暂无数据/);
  });

  test('honors bodyState="loading" with loading text', () => {
    const html = renderToStaticMarkup(
      createElement(MobilePage, { bodyState: 'loading', loadingText: '加载中…' })
    );
    assert.match(html, /data-testid="mobile-page-loading"[^>]*>[\s\S]*?加载中/);
  });

  test('honors bodyState="error" with error text', () => {
    const html = renderToStaticMarkup(
      createElement(MobilePage, { bodyState: 'error', errorText: '加载失败' })
    );
    assert.match(html, /data-testid="mobile-page-error"[^>]*>[\s\S]*?加载失败/);
  });
});

describe('MobileLauncher — visual primitive', () => {
  test('renders empty state when no groups provided', () => {
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups: [] }));
    assert.match(html, /data-testid="mobile-launcher-empty"/);
  });

  test('renders items inside a group', () => {
    const groups = [
      {
        label: '基础资料',
        items: [
          { key: 'products', label: '货品', iconKey: 'products' },
          { key: 'customers', label: '客户', iconKey: 'customers' },
          { key: 'warehouses', label: '仓库', iconKey: 'warehouses' },
          { key: 'suppliers', label: '供应商', iconKey: 'suppliers' },
        ],
      },
    ];
    const html = renderToStaticMarkup(createElement(MobileLauncher, { groups }));
    assert.match(html, /data-testid="mobile-launcher-group-基础资料"/);
    assert.match(html, /data-testid="mobile-launcher-item-products"/);
    assert.match(html, /data-testid="mobile-launcher-item-customers"/);
    assert.match(html, /data-testid="mobile-launcher-item-warehouses"/);
    assert.match(html, /data-testid="mobile-launcher-item-suppliers"/);
  });

  test('invokes onItemSelect when an item is clicked (source contract)', () => {
    const src = readSrc('components/MobileLauncher.jsx');
    assert.match(
      src,
      /onItemSelect\s*&&\s*onItemSelect\(item\)/,
      'MobileLauncher must invoke onItemSelect when an item is clicked'
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Local example assets are not imported into the production bundle
// ---------------------------------------------------------------------------
describe('Reference images — must not leak into source or bundle', () => {
  test('no source file imports from example/', () => {
    const SKIP_DIRS = new Set([
      'node_modules', 'dist', 'data', '.git', 'example',
      '.codex-finalizer', '.pptx-build', 'output',
    ]);
    const offenders = [];
    function walk(dir) {
      for (const name of readdirSync(dir)) {
        const p = dir + '/' + name;
        let s;
        try { s = statSync(p); } catch { continue; }
        if (s.isDirectory()) {
          if (SKIP_DIRS.has(name)) continue;
          walk(p);
        } else if (/\.(js|jsx|css|html)$/.test(name)) {
          const content = readFileSync(p, 'utf8');
          if (/from\s+['"]\.\.?\/example\//.test(content)) offenders.push(p);
        }
      }
    }
    walk(repoRoot);
    assert.deepEqual(offenders, [], `no source file may import from example/ — offenders: ${offenders.join(', ')}`);
  });

  test('example/ folder is in .git/info/exclude', () => {
    const exclude = readFileSync(join(repoRoot, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /^example\//m, '.git/info/exclude must list example/');
  });

  test('dist/ bundle does not embed example/ image bytes (when present)', () => {
    let distExists = true;
    try { statSync(join(repoRoot, 'dist', 'index.html')); }
    catch { distExists = false; }
    if (!distExists) return;
    const assetsDir = resolve(repoRoot, 'dist', 'assets');
    let assets = [];
    try { assets = readdirSync(assetsDir).filter((n) => statSync(join(assetsDir, n)).isFile()); }
    catch { return; }
    const combined = readFileSync(join(repoRoot, 'dist', 'index.html'), 'utf8') +
      assets.map((a) => {
        try { return readFileSync(join(assetsDir, a), 'utf8'); }
        catch { return ''; }
      }).join('');
    assert.equal(
      /ERP系统的流程\.png|44af5c629d0674e40e069e31d4d20489|96b3cadcd163096943e1d55caa109a05|9d6316ccc1053d48c18b4c8e2617cf51|d7531b58e1a26ef15e2c84379db204c1|f21796d5c85cbbdea3fc3d04a96a0b74/.test(combined),
      false,
      'dist/ must not embed any example image by name'
    );
  });
});
