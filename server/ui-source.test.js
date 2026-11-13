import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');

function readFile(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

describe('UI source — production cleanup', () => {
  test('Login page does not preload demo credentials', () => {
    const login = readFile('pages/master-data.jsx');
    assert.equal(
      /useState\(\{\s*username:\s*['"]sales['"]\s*,\s*password:\s*['"]sales123['"]\s*\}\)/.test(login),
      false,
      'Login form must not default to a demo username/password',
    );
    assert.equal(
      /useState\(\{\s*username:\s*['"]admin['"]\s*,\s*password:\s*['"]admin123['"]\s*\}\)/.test(login),
      false,
      'Login form must not default to admin/admin123',
    );
  });

  test('Login page does not expose demo quick-login UI', () => {
    const login = readFile('pages/master-data.jsx');
    for (const forbidden of [
      '快速选择演示角色',
      'demo-accounts',
      'demo-title',
      'demo-title',
      'demo-accounts',
      '使用演示账号进入销售业务中心',
      '仅供本地练习',
      '演示密码',
      '演示环境',
      '开发环境',
      '教学平台',
      '测试账号',
    ]) {
      assert.equal(login.includes(forbidden), false, `Login JSX must not contain "${forbidden}"`);
    }
  });

  test('Login page does not contain hardcoded default passwords', () => {
    const login = readFile('pages/master-data.jsx');
    for (const forbidden of ['sales123', 'admin123', 'review123', 'warehouse123', 'accounting123']) {
      assert.equal(login.includes(forbidden), false, `Login JSX must not contain "${forbidden}"`);
    }
  });

  test('App shell does not advertise demo / dev environment', () => {
    const app = readFile('App.jsx');
    for (const forbidden of [
      '开发环境',
      '现代化重构版',
      '演示账号',
      '本地 SQLite',
      '教学平台',
      '演示环境',
      '快速选择',
      'sidebar-note',
    ]) {
      assert.equal(app.includes(forbidden), false, `App.jsx must not contain "${forbidden}"`);
    }
  });

  test('App shell topbar does not hardcode a page category eyebrow', () => {
    const app = readFile('App.jsx');
    assert.equal(
      /topbar-eyebrow/.test(app),
      false,
      'topbar-eyebrow (hardcoded category label) must be removed; the topbar should only show the current page label.',
    );
  });

  test('styles.css uses system font stack (no Google Fonts)', () => {
    const css = readFile('styles.css');
    assert.equal(/fonts\.googleapis\.com/.test(css), false, 'CSS must not import remote Google Fonts');
    assert.equal(/fonts\.gstatic\.com/.test(css), false, 'CSS must not depend on remote gstatic fonts');
    assert.ok(/-apple-system/.test(css), 'CSS must declare a system font stack');
  });
});

describe('UI source — route surface preserved', () => {
  test('All supported page modules remain importable through the canonical registry', () => {
    // V1.7 P0: route-to-component bindings live in applicationRegistry.js
    // (SCREEN_DEFINITIONS), not as literal imports in App.jsx. Each
    // canonical screen must remain a real export from its module file.
    const registry = readFile('navigation/applicationRegistry.js');
    const expectedExports = [
      ['Login', 'pages/master-data.jsx'],
      ['Dashboard', 'pages/master-data.jsx'],
      ['Suppliers', 'pages/master-data.jsx'],
      ['Customers', 'pages/master-data.jsx'],
      ['Products', 'pages/master-data.jsx'],
      ['Orders', 'pages/master-data.jsx'],
      ['UsersRoles', 'pages/master-data.jsx'],
      ['PurchaseOrders', 'pages/master-data.jsx'],
      ['Warehouses', 'pages/master-data.jsx'],
      ['InventoryWork', 'pages/inventory-work.jsx'],
      ['Accounting', 'pages/accounting.jsx'],
      ['Boms', 'pages/manufacturing.jsx'],
      ['ProductionOrders', 'pages/manufacturing.jsx'],
      ['IQCInspections', 'pages/quality.jsx'],
      ['OQCInspections', 'pages/quality.jsx'],
      ['Notifications', 'pages/platform-notifications.jsx'],
      ['Workflows', 'pages/platform-workflows.jsx'],
      ['CashJournals', 'pages/treasury-cost.jsx'],
      ['BankAccounts', 'pages/treasury-cost.jsx'],
      ['Bills', 'pages/treasury-cost.jsx'],
      ['FixedAssets', 'pages/treasury-cost.jsx'],
      ['ProductCosts', 'pages/treasury-cost.jsx'],
      ['CostRates', 'pages/treasury-cost.jsx'],
      ['PurchaseReceipts', 'pages/logistics-finance.jsx'],
      ['SalesDeliveries', 'pages/logistics-finance.jsx'],
      ['Returns', 'pages/logistics-finance.jsx'],
      ['InventoryTransactions', 'pages/logistics-finance.jsx'],
    ];
    for (const [name, module] of expectedExports) {
      const src = readFile(module);
      const exportMatch = new RegExp(`export\\s+function\\s+${name}\\b`).test(src)
        || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);
      assert.ok(exportMatch, `${module} must still export ${name}`);
    }
    assert.match(registry, /approvals:\s*defaultScreen\('\.\.\/components\/MobileApprovalCenter\.jsx'\)/);
  });

  test('M8 AR/AP and settlement routes are bound through the canonical registry', () => {
    const registry = readFile('navigation/applicationRegistry.js');
    for (const key of ['accounts-receivable', 'accounts-payable', 'payment-collections', 'payment-disbursements']) {
      assert.match(registry, new RegExp(`'${key}':\\s*named\\('../pages/settlement\\.jsx'`));
    }
  });

  test('Permission-based navigation is sourced from the canonical registry', () => {
    const app = readFile('App.jsx');
    const registry = readFile('navigation/applicationRegistry.js');
    assert.ok(/ACTIVE_APPLICATION_ROUTES/.test(app), 'App must consume canonical active routes');
    assert.ok(/userCanAccessRoute/.test(app), 'App must guard route exposure and mount');
    assert.ok(/permission:\s*['"]DASHBOARD_VIEW['"]/.test(registry), 'dashboard permission gate must remain');
    assert.ok(/permission:\s*['"]ORDERS_APPROVE['"]/.test(registry), 'approval permission gate must remain');
    assert.ok(/any:\s*\[\s*['"]SUPPLIERS_VIEW['"]/.test(registry), 'suppliers view gate must remain');
    assert.ok(/any:\s*\[\s*['"]ACCOUNTING_VIEW['"]/.test(registry), 'accounting view gate must remain');
  });

  test('Auth flow surface preserved (login + logout + auth:unauthorized)', () => {
    const api = readFile('api.js');
    assert.ok(/['"]\/api\/auth\/login['"]/.test(api), 'login endpoint constant preserved');
    assert.ok(/erp:unauthorized/.test(api), '401 → erp:unauthorized event preserved');
    const app = readFile('App.jsx');
    assert.ok(/['"]\/api\/auth\/logout['"]/.test(app), 'logout endpoint preserved');
    assert.ok(/['"]\/api\/auth\/me['"]/.test(app), 'session restore endpoint preserved');
    assert.ok(/setToken\(/.test(api), 'token persistence preserved');
  });
});

describe('UI source — file inventory sanity', () => {
  test('src/main.jsx mounts App and imports styles.css', () => {
    const main = readFile('main.jsx');
    assert.ok(/import\s+App\s+from\s+['"]\.\/App\.jsx['"]/.test(main), 'main.jsx imports App');
    assert.ok(/import\s+['"]\.\/styles\.css['"]/.test(main), 'main.jsx imports styles.css');
  });

  test('All key page files exist and are non-empty', () => {
    for (const rel of [
      'pages/master-data.jsx',
      'pages/accounting.jsx',
      'pages/logistics-finance.jsx',
      'pages/manufacturing.jsx',
      'pages/quality.jsx',
      'pages/platform-notifications.jsx',
      'pages/platform-workflows.jsx',
      'pages/treasury-cost.jsx',
      'components/ui.jsx',
      'styles.css',
      'App.jsx',
      'api.js',
      'main.jsx',
    ]) {
      const path = join(srcDir, rel);
      const size = statSync(path).size;
      assert.ok(size > 100, `${rel} must be present and non-trivial (size=${size})`);
    }
  });
});

// ---------------------------------------------------------------------------
// CAP-1 / SC-DEF-08 — Sales & Customer operator work surfaces.
//
// The Sales & Customer capability audit (2026-11-13) recorded that
// `/api/sales/parameters`, `/api/sales/memberships`,
// `/api/sales/sellable-scope-rules` and `/api/sales/product-classifications`
// had a backend but NO operator work surface, and that the SC19 price
// override authorisation had no way to be obtained from the UI.
//
// The repo convention for "the screen exists and is wired" is a source
// assertion plus a registry assertion. These cases cover both.
// ---------------------------------------------------------------------------

describe('UI source — Sales & Customer SC01/SC06/SC07/SC08/SC19 operator work surfaces', () => {
  const page = readFile('pages/sales-parameters.jsx');
  const batchA = readFile('pages/sales-batch-a.jsx');

  test('the Sales operator work-surface module exists and exports every surface', () => {
    for (const name of [
      'SalesParameters',
      'SalesGroupMemberships',
      'SellableScopeRules',
      'ProductClassifications',
      'PriceOverrideAuthorizations',
    ]) {
      assert.match(
        page,
        new RegExp(`export\\s+function\\s+${name}\\b`),
        `pages/sales-parameters.jsx must export ${name}`,
      );
    }
  });

  test('each operator surface reads and writes the existing backend API — no new endpoint', () => {
    for (const endpoint of [
      '/api/sales/parameters',
      '/api/sales/memberships',
      '/api/sales/sellable-scope-rules',
      '/api/sales/product-classifications',
      '/api/sales-price-overrides/authorize',
    ]) {
      assert.ok(
        page.includes(endpoint),
        `pages/sales-parameters.jsx must consume the existing endpoint ${endpoint}`,
      );
    }
  });

  test('the operator surfaces use the real empty-state and error-state primitives', () => {
    // `.canonical-empty-state` / `.business-state` are the repo's real
    // selectors; `.empty-state` does not exist.
    assert.match(page, /BusinessState\s+kind="EMPTY"/, 'the surfaces must render a real BusinessState EMPTY state');
    assert.match(page, /BusinessState\s+kind="LOADING"/, 'the surfaces must render a real BusinessState LOADING state');
    assert.match(page, /<ErrorState\s+error=/, 'the surfaces must render a real error state');
    assert.equal(page.includes('empty-state'), false, '`.empty-state` does not exist in this repo');
  });

  test('the operator surfaces gate every mutation on the backend permission', () => {
    assert.match(page, /can\(user,\s*'SALES_PARAMETERS_MANAGE'\)/);
    assert.match(page, /can\(user,\s*'SALES_FOUNDATION_MANAGE'\)/);
    assert.match(page, /can\(user,\s*'SALES_COMMERCIAL_MANAGE'\)/);
    assert.match(page, /can\(user,\s*'SALES_PRICING_OVERRIDE'\)/);
  });

  test('the surfaces follow the LIST → DETAIL → EDITOR house style of the Sales surfaces', () => {
    assert.match(page, /BusinessPageShell/);
    assert.match(page, /BusinessPageHeader/);
    assert.match(page, /RecordList/);
    assert.match(page, /RecordCard/);
    assert.match(page, /DetailSection/);
    assert.match(page, /<Sheet\s+title=/, 'the editor must use the canonical Sheet component');
    assert.match(page, /BottomActionBar/);
  });

  // NOTE: the ROUTE BINDING assertions for the new Sales operator work
  // surfaces live in server/sales-customer-parameters-closure.test.js (FULL,
  // not FAST). `ui-source.test.js` is a FAST suite, and the registry file is
  // under concurrent edit by another work package — a registry assertion here
  // would make the daily FAST gate depend on an unapplied registry change.

  test('the order change editor accepts a freshly obtained price override authorisation id', () => {
    // SC19 — the operator must be able to enter a NEW authorisation id, not
    // only forward the one already stored in the change snapshot.
    assert.match(
      batchA,
      /priceOverrideAuthorizationId/,
      'the change editor must carry a priceOverrideAuthorizationId field',
    );
    assert.match(
      batchA,
      /setAuthorizations/,
      'the change draft editor must let the operator enter an authorisation id',
    );
    assert.match(
      batchA,
      /api\/sales-price-overrides\/authorize|价格覆盖授权/,
      'the change editor must point the operator at the price override authorisation surface',
    );
  });
});
