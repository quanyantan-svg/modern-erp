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
  test('All supported page modules remain importable from App.jsx', () => {
    const app = readFile('App.jsx');
    // every page component referenced in App.jsx must be present in the corresponding module
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
      ['Inventory', 'pages/master-data.jsx'],
      ['Accounting', 'pages/accounting.jsx'],
      ['Boms', 'pages/manufacturing.jsx'],
      ['ProductionOrders', 'pages/manufacturing.jsx'],
      ['IQCInspections', 'pages/quality.jsx'],
      ['OQCInspections', 'pages/quality.jsx'],
      ['Contacts', 'pages/crm.jsx'],
      ['Followups', 'pages/crm.jsx'],
      ['SalesActivities', 'pages/crm.jsx'],
      ['Projects', 'pages/projects-workflow.jsx'],
      ['ProjectTasks', 'pages/projects-workflow.jsx'],
      ['Timesheets', 'pages/projects-workflow.jsx'],
      ['Notifications', 'pages/projects-workflow.jsx'],
      ['Workflows', 'pages/projects-workflow.jsx'],
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
      assert.ok(app.includes(name), `App.jsx must still reference ${name}`);
      const src = readFile(module);
      const exportMatch = new RegExp(`export\\s+function\\s+${name}\\b`).test(src)
        || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);
      assert.ok(exportMatch, `${module} must still export ${name}`);
    }
    assert.ok(app.includes('MobileApprovalCenter'), 'App.jsx must use the canonical aggregated approval center');
  });

  test('M8 AR/AP and settlement pages are mounted and advertised in App.jsx', () => {
    const app = readFile('App.jsx');
    for (const name of ['Receivables', 'Payables', 'Collections', 'Payments']) assert.equal(app.includes(name), true);
    for (const key of ['accounts-receivable', 'accounts-payable', 'payment-collections', 'payment-disbursements']) assert.equal(app.includes(key), true);
  });

  test('Permission-based navigation logic (navGroups + can) preserved', () => {
    const app = readFile('App.jsx');
    assert.ok(/navGroups\.flatMap/.test(app), 'navGroups flatMap filter for visible items must remain');
    assert.ok(/visibleNav\.some/.test(app), 'visibleNav.some must remain the active-page guard');
    assert.ok(/permission:\s*['"]DASHBOARD_VIEW['"]/.test(app), 'dashboard permission gate must remain');
    assert.ok(/permission:\s*['"]ORDERS_APPROVE['"]/.test(app), 'order approval permission gate must remain');
    assert.ok(/any:\s*\[\s*['"]SUPPLIERS_VIEW['"]/.test(app), 'suppliers view gate must remain');
    assert.ok(/any:\s*\[\s*['"]ACCOUNTING_VIEW['"]/.test(app), 'accounting view gate must remain');
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
      'pages/crm.jsx',
      'pages/projects-workflow.jsx',
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
