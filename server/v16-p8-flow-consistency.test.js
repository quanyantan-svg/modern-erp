// V1.6 P8 — Flowchart & Prototype Consistency Acceptance source contract.
//
// P8 re-derives the route / launcher / approval architecture from the
// authoritative metadata in `src/navigation/{application,presentation}
// Metadata.js` and asserts the navigation/foundation invariants frozen
// by document.md §30 + solution.md §31.
//
// P8 does NOT duplicate per-phase semantics that P0..P7 already cover.
// It asserts metadata-level agreements and the few source changes that
// P8 STAGE 3B introduces (P8-CONS-001: confirm-button class).
//
// P8 does NOT touch backend, API, database, role, approval family,
// calculation, CSV or P0..P7 prototype semantics.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ROUTE_PRESENTATIONS,
  DISABLED_ROUTE_PRESENTATIONS,
  APPROVAL_FAMILIES,
  TECHNICAL_ROUTE_ALIASES,
} from '../src/navigation/presentationMetadata.js';
import { MOBILE_APPLICATION_GROUPS, MOBILE_COMMON_PRIORITY } from '../src/navigation/applicationMetadata.js';
import { applicationRouteFor } from '../src/navigation/applicationRegistry.js';

const readSrc = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const app = readSrc('src/App.jsx');
const masterData = readSrc('src/pages/master-data.jsx');
const decisionReports = readSrc('src/pages/decision-reports.jsx');
const inventoryExtensions = readSrc('src/pages/inventory-extensions.jsx');
const mobileApprovalCenter = readSrc('src/components/MobileApprovalCenter.jsx');
const styles = readSrc('src/styles.css');

const enabledByRoute = new Map(ROUTE_PRESENTATIONS.map((route) => [route.route, route]));
const launcherItems = MOBILE_APPLICATION_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupKey: group.key, groupKind: group.kind })),
);

function assertRouteScreen(routeKey, modulePath, exportName) {
  const screen = applicationRouteFor(routeKey)?.screen;
  assert.equal(screen?.identity, routeKey, `${routeKey} screen identity`);
  assert.equal(screen?.modulePath, modulePath, `${routeKey} screen module`);
  assert.equal(screen?.exportName, exportName, `${routeKey} screen export`);
}

// ----- 1. Route inventory assertions (derived from authoritative source) -----

test('P8 route inventory: 50 enabled + 5 disabled = 55 entries', () => {
  // Core Scope Cleanup removed the 6 extension routes
  // (projects, tasks, timesheets, contacts, followups, activities).
  assert.equal(ROUTE_PRESENTATIONS.length, 50, 'ROUTE_PRESENTATIONS must hold 50 enabled canonical routes');
  assert.equal(DISABLED_ROUTE_PRESENTATIONS.length, 5, 'DISABLED_ROUTE_PRESENTATIONS must hold 5 removed/disabled routes');
  assert.equal(ROUTE_PRESENTATIONS.length + DISABLED_ROUTE_PRESENTATIONS.length, 55);
});

test('P8 route inventory: enabled route keys are unique and no collision with disabled keys', () => {
  const enabledKeys = ROUTE_PRESENTATIONS.map((r) => r.route);
  const disabledKeys = DISABLED_ROUTE_PRESENTATIONS.map((r) => r.route);
  assert.equal(new Set(enabledKeys).size, enabledKeys.length, 'enabled keys must be unique');
  assert.equal(new Set(disabledKeys).size, disabledKeys.length, 'disabled keys must be unique');
  const overlap = enabledKeys.filter((k) => disabledKeys.includes(k));
  assert.deepEqual(overlap, [], 'no enabled route may also appear as disabled');
});

test('P8 route inventory: every enabled route has a concrete Registry screen registration', () => {
  for (const { route } of ROUTE_PRESENTATIONS) {
    const registeredRoute = applicationRouteFor(route);
    assert.ok(registeredRoute, `${route} must exist in the Application Registry`);
    assert.ok(registeredRoute.screen, `${route} must have a screen registration`);
    assert.equal(typeof registeredRoute.screen.loader, 'function', `${route} screen loader`);
    assert.ok(registeredRoute.screen.identity, `${route} screen identity must be non-empty`);
  }
});

test('P8 route inventory: every disabled route is one of the frozen five', () => {
  const expected = ['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup'].sort();
  const actual = DISABLED_ROUTE_PRESENTATIONS.map((r) => r.route).sort();
  assert.deepEqual(actual, expected);
});

// ----- 2. Eight canonical launcher groups -----

test('P8 launcher: eight canonical business groups present in order', () => {
  const keys = MOBILE_APPLICATION_GROUPS.filter((g) => g.kind === 'domain').map((g) => g.key);
  assert.deepEqual(keys, ['master-engineering','sales-customer','planning','procurement-outsourcing','manufacturing-quality','inventory-warehouse','finance-operations','accounting-analytics']);
});

test('P8 launcher: every launcher tile references a legitimate enabled route', () => {
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  const disabled = new Set(DISABLED_ROUTE_PRESENTATIONS.map((r) => r.route));
  const issues = [];
  for (const group of MOBILE_APPLICATION_GROUPS) {
    for (const item of group.items) {
      if (!enabled.has(item.page)) issues.push(`${group.key}: ${item.page} not in enabled routes`);
      if (disabled.has(item.page)) issues.push(`${group.key}: ${item.page} is disabled but in launcher`);
    }
  }
  assert.deepEqual(issues, [], JSON.stringify(issues));
});

test('P8 launcher: every tile inherits a valid presentation permission contract', () => {
  const issues = [];
  for (const item of launcherItems) {
    const route = enabledByRoute.get(item.page);
    if (!route?.permission && !route?.any?.length) issues.push(`${item.groupKey}/${item.page}: missing route permission`);
  }
  assert.deepEqual(issues, [], JSON.stringify(issues));
});

test('P8 launcher: target and documentType affordances are limited to canonical return creation', () => {
  const targeted = launcherItems.filter((item) => item.target);
  assert.deepEqual(
    targeted.map(({ page, target }) => ({ page, target })),
    [
      { page: 'returns', target: { documentType: 'SALES_RETURN' } },
      { page: 'returns', target: { documentType: 'PURCHASE_RETURN' } },
    ],
  );
});

test('P8 launcher: Accounting & Analytics has the 5 canonical decision-report targets', () => {
  const analytics = MOBILE_APPLICATION_GROUPS.find((g) => g.key === 'accounting-analytics');
  assert.ok(analytics, 'analytics group must exist');
  const reportItems = analytics.items.filter((item) => item.reportKey);
  assert.equal(reportItems.length, 5, 'analytics launcher must have exactly 5 decision-report tiles');
  const keys = reportItems.map((item) => item.reportKey);
  assert.deepEqual(keys, ['sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements']);
  const pages = new Set(reportItems.map((item) => item.page));
  assert.deepEqual([...pages], ['decision-reports'], 'analytics tiles must share a single decision-reports page');
});

test('P8 launcher: Platform is not represented as a utility business group', () => {
  const utilityKeys = MOBILE_APPLICATION_GROUPS.filter((g) => g.kind === 'utility').map((g) => g.key);
  // utility-extension held the project / CRM launcher tiles; the
  // Core Scope Cleanup removed the group entirely when its last
  // tile was deleted.
  assert.deepEqual(utilityKeys, []);
});

test('P8 launcher: disabled routes do not appear in any launcher group', () => {
  const disabled = new Set(DISABLED_ROUTE_PRESENTATIONS.map((r) => r.route));
  for (const group of MOBILE_APPLICATION_GROUPS) {
    for (const item of group.items) {
      assert.equal(disabled.has(item.page), false, `${item.page} is disabled but appears in ${group.key}`);
    }
  }
});

test('P8 launcher: COMMON_PRIORITY contains only existing page keys', () => {
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  for (const key of MOBILE_COMMON_PRIORITY) {
    assert.ok(enabled.has(key), `COMMON_PRIORITY key ${key} must be enabled`);
  }
});

// ----- 3. Contextual/internal/removed classification -----

test('P8 contextual: every route with parentRoute references an enabled parent route', () => {
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  const issues = [];
  let contextualCount = 0;
  for (const route of ROUTE_PRESENTATIONS) {
    if (route.parentRoute) {
      contextualCount += 1;
      if (!enabled.has(route.parentRoute)) issues.push(`${route.route} -> ${route.parentRoute}`);
    }
  }
  assert.deepEqual(issues, [], JSON.stringify(issues));
  // P8-CONS-002 audit correction: there are 9 routes with parentRoute
  // (8 O2C/P2P quality and settlement children + material-requirements-plan).
  // The tasks/timesheets project children were removed with the Project
  // Management extension in Core Scope Cleanup.
  assert.equal(contextualCount, 9, 'contextual routes with parentRoute must total 9');
});

test('P8 contextual: frozen O2C/P2P settlement and quality children keep their route relationships', () => {
  const expected = {
    'sales-discounts': 'accounts-receivable',
    'purchase-discounts': 'accounts-payable',
    'sales-invoices': 'accounts-receivable',
    'payment-collections': 'accounts-receivable',
    'payment-disbursements': 'accounts-payable',
    'supplier-bills': 'accounts-payable',
    iqc: 'purchase-receipts',
    oqc: 'sales-deliveries',
  };
  for (const [route, parentRoute] of Object.entries(expected)) {
    const metadata = enabledByRoute.get(route);
    assert.ok(metadata, `${route} must remain enabled`);
    assert.equal(metadata.parentRoute, parentRoute, `${route} parentRoute`);
  }
});

test('P8 classification: launcher exposure never promotes an internal route', () => {
  const launcherPages = new Set(launcherItems.map((item) => item.page));
  for (const route of ROUTE_PRESENTATIONS.filter((item) => item.level === 'internal')) {
    assert.equal(launcherPages.has(route.route), false, `${route.route} is internal and must not be launcher-visible`);
  }
});

test('P8 internal: manufacturing-analytics and material-requirements-plan are not promoted to launcher core apps', () => {
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  const launcherPages = new Set();
  for (const group of MOBILE_APPLICATION_GROUPS) {
    for (const item of group.items) launcherPages.add(item.page);
  }
  for (const key of ['manufacturing-analytics', 'material-requirements-plan']) {
    assert.equal(launcherPages.has(key), false, `${key} must not be a direct launcher tile`);
    assert.ok(enabled.has(key), `${key} must still be a reachable enabled route`);
  }
});

test('P8 MRP alias: TECHNICAL_ROUTE_ALIASES.mrp resolves to material-requirements-plan', () => {
  assert.equal(TECHNICAL_ROUTE_ALIASES.mrp, 'material-requirements-plan');
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  assert.ok(enabled.has('material-requirements-plan'));
});

test('P8 MRP: planning remains a production child and uses the canonical permission', () => {
  const mrp = enabledByRoute.get('material-requirements-plan');
  assert.ok(mrp, 'material-requirements-plan must remain enabled');
  assert.equal(mrp.parentRoute, 'mrp-runs');
  assert.deepEqual(mrp.any, ['MRP_VIEW', 'MRP_MANAGE']);
});

// ----- 4. Removed/internal capability safety -----

test('P8 removed: system-health and commercial-go-live are not registered as user routes', () => {
  const enabled = new Set(ROUTE_PRESENTATIONS.map((r) => r.route));
  assert.equal(enabled.has('system-health'), false);
  assert.equal(enabled.has('commercial-go-live'), false);
  // Pages dictionary in App.jsx must not include them either.
  assert.equal(/'system-health':\s*</.test(app), false);
  assert.equal(/'commercial-go-live':\s*</.test(app), false);
  // Launcher must not mention them.
  for (const group of MOBILE_APPLICATION_GROUPS) {
    for (const item of group.items) {
      assert.notEqual(item.page, 'system-health');
      assert.notEqual(item.page, 'commercial-go-live');
    }
  }
});

// ----- 5. Approval family assertions -----

test('P8 approval families: exactly the five canonical families in the frozen order', () => {
  assert.deepEqual(
    [...APPROVAL_FAMILIES],
    ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER'],
  );
});

test('P8 approval families: INVENTORY_TRANSFER is not registered as an approval family', () => {
  assert.equal(APPROVAL_FAMILIES.includes('INVENTORY_TRANSFER'), false);
});

test('P8 MobileApprovalCenter handles only the 5 canonical document types', () => {
  const expected = ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER'];
  for (const family of expected) {
    assert.match(mobileApprovalCenter, new RegExp(`item\\.documentType === ['"]${family}['"]`));
  }
  assert.doesNotMatch(mobileApprovalCenter, /item\.documentType === ['"]INVENTORY_TRANSFER['"]/);
});

test('P8 transfer UI: current-action labels use 确认调拨 / 取消调拨 and not 审批 / 审核 / 批准 调拨', () => {
  // master-data.jsx has the V1.6 P6 detail labels; allow transferStatusLabel
  // exception for legacy historical compatibility per OD-V14C-17.
  assert.match(masterData, />确认调拨</);
  assert.match(masterData, />取消调拨</);
  // No "审批调拨" / "审核调拨" / "批准调拨" labels in current-action paths.
  assert.doesNotMatch(masterData, />审批调拨</);
  assert.doesNotMatch(masterData, />审核调拨</);
  assert.doesNotMatch(masterData, />批准调拨</);
  // Historical compatibility labels remain acceptable.
  assert.match(masterData, /历史待审核/);
  assert.match(masterData, /历史已审核/);
});

// ----- 6. Decision reports consistency -----

test('P8 decision reports: P7 switcher only renders the 5 canonical reportKeys', () => {
  // Verify the 5 canonical reportKey strings are present.
  for (const key of ['sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements']) {
    assert.match(decisionReports, new RegExp(`key:\\s*'${key}'`));
  }
  // Verify REPORT_TABS export still has exactly 5 entries (no 6th report).
  const tabsMatch = decisionReports.match(/export const REPORT_TABS\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(tabsMatch, 'REPORT_TABS must be exported');
  const tabCount = (tabsMatch[1].match(/key:\s*'/g) || []).length;
  assert.equal(tabCount, 5, 'REPORT_TABS must contain exactly 5 entries');
});

test('P8 decision reports: report endpoints are registered server-side (V2 Wave 4A ownedRouteTable dispatch)', () => {
  const paths = [
    '/api/reports/decision/sales-summary',
    '/api/reports/decision/sales-outstanding',
    '/api/reports/decision/purchase-summary',
    '/api/reports/decision/purchase-outstanding',
    '/api/reports/decision/inventory-movements',
  ];
  const server = readSrc('server/app.js');
  // V2 Wave 4A: routes are owned by server/modules/decision-reports.js through
  // ownedRouteTable.register descriptors. The five core paths must still be
  // present as exact-string descriptors; the five CSV exports as well.
  for (const path of paths) {
    const escaped = path.replace(/\//g, '\\/');
    assert.match(
      server,
      new RegExp(`path:\\s*['"]${escaped}['"]`),
      `server/app.js must keep registering ${path} as an ownedRouteTable descriptor`,
    );
  }
  // Five CSV exports.
  for (const path of paths) {
    const escaped = (`${path}/export`).replace(/\//g, '\\/');
    assert.match(
      server,
      new RegExp(`path:\\s*['"]${escaped}['"]`),
      `server/app.js must keep registering ${path}/export as an ownedRouteTable descriptor`,
    );
  }
  // Contributions endpoint registers as a regex descriptor (no longer as a
  // legacy runtime `fulfillmentContributionsMatch = pathname.match(...)`
  // branch). The descriptor must include the regex literal plus the handler
  // and the canonical owner.
  const contributionsRegex = new RegExp(
    "path:\\s*/\\^\\\\/api\\\\/reports\\\\/\\(\\[\\^/\\]\\+\\)\\\\/lines\\\\/\\(\\[\\^/\\]\\+\\)\\\\/contributions\\$/",
  );
  assert.match(server, contributionsRegex);
  assert.match(server, /getFulfillmentContributions\(/);
  assert.match(server, /owner:\s*['"]server\/modules\/decision-reports\.js['"]/);
  // Legacy dispatch must be gone.
  assert.doesNotMatch(server, /fulfillmentContributionsMatch\s*=\s*pathname\.match\(/);
});

// ----- 7. P0..P7 prototype invariants (high-level) -----

test('P8 prototype: MobileShell still exposes exactly 5 enabled tabs in frozen order', () => {
  const mobileShell = readSrc('src/components/MobileShell.jsx');
  // Find TABS array literal block.
  const tabsBlock = mobileShell.match(/const TABS\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(tabsBlock, 'MobileShell must declare a TABS array');
  const enabledLines = [...tabsBlock[1].matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'[^']+',\s*icon:\s*'[^']+',\s*enabled:\s*true\s*\}/g)];
  assert.equal(enabledLines.length, 5, 'MobileShell must have exactly 5 enabled tabs');
  assert.deepEqual(enabledLines.map((m) => m[1]), ['messages', 'approvals', 'apps', 'workspace', 'profile']);
});

test('P8 prototype: P7 decision-reports route identity is preserved', () => {
  assertRouteScreen('decision-reports', '../pages/decision-reports.jsx', 'default');
});

test('P8 prototype: P2/P3 sales list and document remain one canonical orders route', () => {
  assertRouteScreen('orders', '../pages/master-data.jsx', 'Orders');
  assert.doesNotMatch(app, /['"]sales-order-(?:list|detail)['"]\s*:/);
});

test('P8 prototype: purchasing receipt and production execution routes remain distinct canonical pages', () => {
  for (const [route, modulePath, component] of [
    ['purchase-receipts', '../pages/logistics-finance.jsx', 'PurchaseReceipts'],
    ['production-orders', '../pages/manufacturing.jsx', 'ProductionOrders'],
    ['material-issues', '../pages/manufacturing.jsx', 'MaterialIssues'],
    ['production-receipts', '../pages/manufacturing.jsx', 'ProductionReceipts'],
  ]) {
    assertRouteScreen(route, modulePath, component);
  }
});

test('P8 prototype: inventory four-tab model in master-data inventory section is preserved', () => {
  // P6 inventory routes retain their distinct source modules and exports.
  assertRouteScreen('inventory', '../pages/master-data.jsx', 'Inventory');
  assertRouteScreen('inventory-scraps', '../pages/inventory-extensions.jsx', 'InventoryScraps');
  assertRouteScreen('inventory-month-end', '../pages/inventory-extensions.jsx', 'InventoryMonthEnd');
  assertRouteScreen('inventory-transactions', '../pages/logistics-finance.jsx', 'InventoryTransactions');
  assert.ok(inventoryExtensions.length > 0, 'inventory-extensions.jsx must exist for scraps / month-end');
  // Inventory-transactions must NOT be the same as the P7 decision-reports
  // inventory-movements route. They are two distinct user-visible contexts.
  assert.notEqual(applicationRouteFor('inventory-transactions'), applicationRouteFor('decision-reports'));
});

// ----- 8. P8-CONS-001 bounded fix verification -----

test('P8-CONS-001: confirm-button class exists with same visual rules as approve-button', () => {
  // .confirm-button CSS class is added.
  assert.match(styles, /\.confirm-button\s*\{/);
  assert.match(styles, /\.confirm-button:hover\s*\{/);
  // .approve-button still exists (used by real approvals + stocktake submission).
  assert.match(styles, /\.approve-button\s*\{/);
});

test('P8-CONS-001: transfer confirmation no longer uses approve-button class', () => {
  // P8-CONS-001 anchors on the V1.1 transfer LIST row button (after `transfers.map`).
  const anchor = masterData.indexOf('transfers.map((t)');
  assert.ok(anchor > -1, 'transfers.map list anchor must exist');
  const nextIdx = masterData.indexOf('确认调拨</button>', anchor);
  assert.ok(nextIdx > -1, 'transfer list 确认调拨 button must be discoverable after transfers.map');
  const window = masterData.slice(anchor, nextIdx + 30);
  assert.match(window, /className="confirm-button"/);
  assert.doesNotMatch(window, /className="approve-button"/);
});

test('P8-CONS-001: adjustment confirmation no longer uses approve-button class', () => {
  // P8-CONS-001 anchors on the adjustment form-actions block.
  const anchor = masterData.indexOf('form-actions');
  assert.ok(anchor > -1, 'form-actions anchor must exist');
  const nextIdx = masterData.indexOf('确认调整</button>', anchor);
  assert.ok(nextIdx > -1, 'adjustment 确认调整 button must be discoverable after form-actions');
  const window = masterData.slice(anchor, nextIdx + 30);
  assert.match(window, /className="confirm-button"/);
  assert.doesNotMatch(window, /className="approve-button"/);
});

test('P8-CONS-001: real approval buttons keep approve-button (sales order approval / stocktake submission)', () => {
  // Sales order 审批通过 (real approval action) must stay on approve-button.
  const approvalMatch = masterData.match(/ConfirmAction className="approve-button" buttonLabel="审批通过"[\s\S]{0,400}/);
  assert.ok(approvalMatch, 'sales order 审批通过 ConfirmAction must remain on approve-button');
  // Stocktake 提交审批 (submits to INVENTORY_CHECK approval family) must stay on approve-button.
  // Anchor on the changeState(c, 'SUBMIT') submit call (list row action).
  const submitAnchor = masterData.indexOf("changeState(c, 'SUBMIT')");
  assert.ok(submitAnchor > -1, 'changeState(c, SUBMIT) anchor must exist');
  const submitStart = masterData.lastIndexOf('<button', submitAnchor);
  const submitEnd = masterData.indexOf('</button>', submitAnchor);
  assert.ok(submitStart > -1 && submitEnd > submitStart, 'stocktake submit button bounds must exist');
  const submitWindow = masterData.slice(submitStart, submitEnd + 10);
  assert.match(submitWindow, /className="approve-button"/);
  assert.match(submitWindow, /提交审批<\/button>/);
});
