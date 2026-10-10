import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVE_APPLICATION_ROUTES, APPLICATION_LAUNCHER_GROUPS, APPLICATION_ROUTES,
  DISABLED_APPLICATION_ROUTES, TECHNICAL_ROUTE_ALIASES, applicationRouteFor,
} from '../src/navigation/applicationRegistry.js';
import { MOBILE_APPLICATION_GROUPS } from '../src/navigation/applicationMetadata.js';
import { DISABLED_ROUTE_PRESENTATIONS, ROUTE_PRESENTATIONS } from '../src/navigation/presentationMetadata.js';
import { normalizeRouteLocation, parseRouteLocation, serializeRouteLocation, validateRouteTarget } from '../src/navigation/routeLocation.js';

const read = (path) => readFileSync(resolve(path), 'utf8');

test('P0-A registry owns 59 active and 5 disabled unique routes with valid screens, access and parents', () => {
  // V1.6.2 frozen route catalogue: 59 active + 5 disabled. The Wave E
  // inventory mobile routes are merged into the canonical inventory hub
  // per solution.md §27.43 (≤ 8 inventory routes / ≤ 6 launcher tiles).
  // After Core Scope Cleanup, the registry had 47 active routes
  // (53 minus the 6 removed extension routes: projects, tasks,
  // timesheets, contacts, followups, activities). Master & Engineering
  // Master & Engineering adds 3 workbenches; Manufacturing & Quality adds 3 execution surfaces.
  // Planning adds 2 contextual surfaces (planning-reservations, planning-configuration).
  // Procurement & Outsourcing Domain Closure adds 2 surfaces
  // (sourcing-pricing, outsourcing).
  assert.equal(ACTIVE_APPLICATION_ROUTES.length, 59);
  assert.equal(DISABLED_APPLICATION_ROUTES.length, 5);
  assert.equal(new Set(APPLICATION_ROUTES.map((route) => route.key)).size, APPLICATION_ROUTES.length);
  assert.deepEqual(DISABLED_APPLICATION_ROUTES.map((route) => route.key), ['cash-journals','bills','fixed-assets','workflows','data-cleanup']);
  for (const route of APPLICATION_ROUTES) {
    assert.ok(route.access.permission || route.access.any?.length, `${route.key} access`);
    if (route.enabled) assert.equal(typeof route.screen.loader, 'function', `${route.key} screen loader`);
    if (route.parentRoute) assert.ok(applicationRouteFor(route.parentRoute), `${route.key} parent`);
  }
  // Removed extension routes must not be in the registry.
  for (const removed of ['projects','tasks','timesheets','contacts','followups','activities']) {
    assert.equal(applicationRouteFor(removed), null, `${removed} must be removed from registry`);
  }
});

test('P0-A aliases and launcher entries are conflict-free registry projections', () => {
  assert.deepEqual(TECHNICAL_ROUTE_ALIASES, { mrp: 'material-requirements-plan' });
  assert.equal(new Set(Object.keys(TECHNICAL_ROUTE_ALIASES)).size, Object.keys(TECHNICAL_ROUTE_ALIASES).length);
  const groupKeys = new Set(APPLICATION_LAUNCHER_GROUPS.map((group) => group.key));
  for (const group of APPLICATION_LAUNCHER_GROUPS) for (const entry of group.items) {
    assert.equal(applicationRouteFor(entry.routeKey)?.enabled, true, entry.key);
    assert.equal(entry.group, group.key, `${entry.key} parent group`);
    assert.equal(groupKeys.has(entry.group), true, `${entry.key} valid group`);
  }
  assert.equal(ROUTE_PRESENTATIONS.length, 59);
  assert.equal(DISABLED_ROUTE_PRESENTATIONS.length, 5);
  assert.deepEqual(MOBILE_APPLICATION_GROUPS.map((group) => group.key), APPLICATION_LAUNCHER_GROUPS.map((group) => group.key));
  const corePages = MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'domain').flatMap((group) => group.items.map((item) => item.page));
  assert.equal(corePages.includes('iqc'), false);
  assert.equal(corePages.includes('oqc'), false);
  assert.equal(corePages.includes('material-requirements-plan'), false);
});

test('P0-A registry preserves V1.6 rollout classification and application groups', () => {
  const internal = ['manufacturing-analytics','material-requirements-plan'];
  const contextual = ['bank-accounts','cost-rates','dashboard','iqc','notifications','oqc','payment-collections','payment-disbursements','planning-configuration','planning-reservations','product-costs','purchase-discounts','quality-control-points','sales-discounts','sales-invoices','supplier-bills'];
  assert.deepEqual(ACTIVE_APPLICATION_ROUTES.filter((route) => route.classification === 'INTERNAL').map((route) => route.key).sort(), internal);
  assert.deepEqual(ACTIVE_APPLICATION_ROUTES.filter((route) => route.classification === 'CONTEXTUAL').map((route) => route.key).sort(), contextual);
  assert.deepEqual(
    ACTIVE_APPLICATION_ROUTES.filter((route) => route.classification === 'CORE').map((route) => route.key).sort(),
    ACTIVE_APPLICATION_ROUTES.map((route) => route.key).filter((key) => !internal.includes(key) && !contextual.includes(key)).sort(),
  );
  for (const route of ACTIVE_APPLICATION_ROUTES) {
    assert.equal(route.applicationGroup, route.launcherEntries[0]?.group || 'contextual', `${route.key} application group`);
  }
  assert.equal(applicationRouteFor('orders').applicationGroup, 'sales-customer');
  assert.equal(applicationRouteFor('users').applicationGroup, 'contextual');
  assert.equal(applicationRouteFor('iqc').applicationGroup, 'contextual');
});

test('P0-A stable screen diagnostics preserve important route-to-component mappings', () => {
  const expected = {
    orders: ['../pages/master-data.jsx','Orders'], 'purchase-orders': ['../pages/master-data.jsx','PurchaseOrders'],
    'purchase-receipts': ['../pages/logistics-finance.jsx','PurchaseReceipts'], 'sales-deliveries': ['../pages/logistics-finance.jsx','SalesDeliveries'],
    inventory: ['../pages/master-data.jsx','Inventory'], 'inventory-scraps': ['../pages/inventory-extensions.jsx','InventoryScraps'],
    'inventory-month-end': ['../pages/inventory-extensions.jsx','InventoryMonthEnd'], 'inventory-transactions': ['../pages/logistics-finance.jsx','InventoryTransactions'],
    'production-orders': ['../pages/manufacturing.jsx','ProductionOrders'], 'material-issues': ['../pages/manufacturing.jsx','MaterialIssues'],
    'production-receipts': ['../pages/manufacturing.jsx','ProductionReceipts'], 'decision-reports': ['../pages/decision-reports.jsx','default'],
  };
  for (const [routeKey, [modulePath, exportName]] of Object.entries(expected)) {
    assert.equal(applicationRouteFor(routeKey).screen.modulePath, modulePath, routeKey);
    assert.equal(applicationRouteFor(routeKey).screen.exportName, exportName, routeKey);
    assert.equal(typeof applicationRouteFor(routeKey).screen.loader, 'function', routeKey);
  }
});

test('P0-B RouteLocation round-trips canonical list, detail, contextual and report URLs', () => {
  const cases = [
    ['#orders','#orders'], ['#orders/order-id','#orders/order-id'], ['#purchase-orders/po-id','#purchase-orders/po-id'],
    ['#returns/sr-id?documentType=SALES_RETURN','#returns/sr-id?documentType=SALES_RETURN'],
    ['#returns/pr-id?documentType=PURCHASE_RETURN','#returns/pr-id?documentType=PURCHASE_RETURN'],
    ['#decision-reports?reportKey=sales-summary','#decision-reports?reportKey=sales-summary'],
    ['#mrp','#material-requirements-plan'],
  ];
  for (const [input, expected] of cases) assert.equal(serializeRouteLocation(parseRouteLocation(input)), expected, input);
});

test('P0-B RouteLocation safely handles percent encoding, malformed input, illegal target and stable query order', () => {
  const encoded = serializeRouteLocation(normalizeRouteLocation({ routeKey: 'orders', target: { documentId: '订单/A B' } }));
  assert.equal(encoded, '#orders/%E8%AE%A2%E5%8D%95%2FA%20B');
  assert.equal(parseRouteLocation(encoded).target.documentId, '订单/A B');
  assert.equal(parseRouteLocation('#orders/%E0%A4%A').invalid, true);
  assert.equal(validateRouteTarget(applicationRouteFor('orders'), { unsupported: 'x' }), false);
  assert.equal(validateRouteTarget(applicationRouteFor('orders'), { reportKey: 'sales-summary' }), false);
  assert.equal(parseRouteLocation('#orders?reportKey=sales-summary').invalid, true);
  assert.equal(validateRouteTarget(applicationRouteFor('returns'), { documentType: 'SALES_RETURN' }), true);
  assert.equal(validateRouteTarget(applicationRouteFor('material-requirements-plan'), { documentId: 'run-1', originPage: 'mrp-runs' }), true);
  assert.equal(validateRouteTarget(applicationRouteFor('product-routings'), { productId: 'product-1' }), true);
  assert.equal(validateRouteTarget(applicationRouteFor('iqc'), { documentId: 'iqc-1', documentType: 'IQC_INSPECTION', sourcePage: 'purchase-receipts', sourceDocumentId: 'pr-1' }), true);
  assert.equal(validateRouteTarget(applicationRouteFor('purchase-instructions'), { documentId: 'pi-1' }), true);
  assert.equal(serializeRouteLocation({ routeKey: 'iqc', query: { sourcePage: 'purchase-receipts', documentType: 'IQC_INSPECTION' } }), '#iqc?documentType=IQC_INSPECTION&sourcePage=purchase-receipts');
});

test('P0-C shell resolves registry routes lazily and guards route mount before protected screen APIs', () => {
  const app = read('src/App.jsx');
  const registry = read('src/navigation/applicationRegistry.js');
  assert.doesNotMatch(app, /const pages\s*=\s*\{/);
  assert.doesNotMatch(app, /export const navGroups\s*=\s*\[/);
  assert.match(app, /userCanAccessRoute\(user, route\)/);
  assert.match(app, /if \(!route\.enabled\)/);
  assert.match(app, /<RouteScreen route=\{route\}/);
  assert.match(registry, /const loadScreenModule = \(path\)/);
  assert.match(registry, /return import\('\.\.\/pages\/master-data\.jsx'\)/);
  assert.match(app, /addEventListener\('hashchange', applyBrowserLocation\)/);
  assert.match(app, /history\.replaceState/);
});

test('P0-D AppLink uses exact hrefFor target and route surface derives responsive mode from registry', () => {
  const context = read('src/navigation/AppNavigationContext.jsx');
  const surface = read('src/components/V16RouteSurface.jsx');
  assert.match(context, /href=\{hrefFor\(page, exactTarget\)\}/);
  assert.match(context, /currentLocation/);
  assert.match(context, /currentRoute/);
  assert.match(surface, /applicationRouteFor\(routeKey\)/);
  assert.match(surface, /RESPONSIVE_MODES\.LEGACY_ADAPTER/);
  assert.match(surface, /classification: route\?\.classification/);
  assert.match(read('src/components/RouteScreen.jsx'), /previousProps\.resetKey !== this\.props\.resetKey/);
  assert.match(read('src/App.jsx'), /locationKey=\{serializeRouteLocation\(currentLocation\)\}/);
  assert.match(read('src/pages/logistics-finance.jsx'), /navigateToPage\('returns', \{ documentType: nextTab === 'sales' \? 'SALES_RETURN' : 'PURCHASE_RETURN' \}, \{ replace: true \}\)/);
  assert.match(read('src/components/MobileShell.jsx'), /\['messages', 'approvals', 'apps', 'workspace', 'profile'\]|key: 'messages'/);
});
