import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  APPROVAL_FAMILIES,
  DISABLED_ROUTE_PRESENTATIONS,
  ROUTE_PRESENTATIONS,
} from '../src/navigation/presentationMetadata.js';
import { MOBILE_APPLICATION_GROUPS } from '../src/navigation/applicationMetadata.js';

const readSrc = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const matrix = readSrc('docs/v1.6-sitewide-rollout-matrix.md');
const app = readSrc('src/App.jsx');
const main = readSrc('src/main.jsx');
const surface = readSrc('src/components/V16RouteSurface.jsx');
const designSystem = readSrc('src/components/design-system.jsx');
const mobileApprovalCenter = readSrc('src/components/MobileApprovalCenter.jsx');
const rolloutCss = readSrc('src/styles/v16-sitewide-rollout.css');

function enabledMatrixRows() {
  return matrix.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\| ([a-z0-9-]+) \| (CORE|UTILITY|CONTEXTUAL|INTERNAL) \|/);
    return match ? [{ route: match[1], line }] : [];
  });
}

describe('V1.6 site-wide rollout source contract', () => {
  test('matrix represents every enabled canonical route exactly once', () => {
    const rows = enabledMatrixRows();
    assert.equal(rows.length, ROUTE_PRESENTATIONS.length);
    assert.equal(new Set(rows.map((row) => row.route)).size, rows.length);
    assert.deepEqual(rows.map((row) => row.route).sort(), ROUTE_PRESENTATIONS.map((route) => route.route).sort());
  });

  test('enabled route metadata remains unique', () => {
    const keys = ROUTE_PRESENTATIONS.map((route) => route.route);
    assert.equal(keys.length, 47);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('the frozen five disabled routes remain disabled and documented', () => {
    assert.deepEqual(DISABLED_ROUTE_PRESENTATIONS.map((route) => route.route).sort(), ['bills', 'cash-journals', 'data-cleanup', 'fixed-assets', 'workflows']);
    for (const route of DISABLED_ROUTE_PRESENTATIONS) {
      assert.match(matrix, new RegExp(`\\| ${route.route} \\| REMOVED \\| false \\| absent \\|`));
    }
  });

  test('backend/internal-only concepts remain outside user navigation', () => {
    const routeKeys = new Set(ROUTE_PRESENTATIONS.map((route) => route.route));
    assert.equal(routeKeys.has('system-health'), false);
    assert.equal(routeKeys.has('commercial-go-live'), false);
    assert.doesNotMatch(app, /['"](?:system-health|commercial-go-live)['"]\s*:/);
  });

  test('eight canonical business groups remain in order', () => {
    assert.deepEqual(MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'domain').map((group) => group.key), [
      'master-engineering','sales-customer','planning','procurement-outsourcing','manufacturing-quality','inventory-warehouse','finance-operations','accounting-analytics',
    ]);
  });

  test('Platform stays outside the business launcher', () => {
    assert.deepEqual(MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'utility').map((group) => group.key), []);
  });

  test('contextual parent relationships all resolve to enabled routes', () => {
    const enabled = new Set(ROUTE_PRESENTATIONS.map((route) => route.route));
    for (const route of ROUTE_PRESENTATIONS.filter((item) => item.parentRoute)) {
      assert.ok(enabled.has(route.parentRoute), `${route.route} parent must remain enabled`);
      assert.match(matrix, new RegExp(`\\| ${route.route} \\|[^\\n]+\\| ${route.parentRoute} \\|`));
    }
  });

  test('five approval families remain exact', () => {
    assert.deepEqual([...APPROVAL_FAMILIES], [
      'SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER',
    ]);
  });

  test('inventory transfer remains excluded from approvals', () => {
    assert.equal(APPROVAL_FAMILIES.includes('INVENTORY_TRANSFER'), false);
    assert.doesNotMatch(mobileApprovalCenter, /documentType === ['"]INVENTORY_TRANSFER['"]/);
  });

  test('five canonical decision-report keys remain valid launcher targets', () => {
    const analytics = MOBILE_APPLICATION_GROUPS.find((group) => group.key === 'accounting-analytics');
    assert.deepEqual(analytics.items.filter((item) => item.reportKey).map((item) => item.reportKey), [
      'sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements',
    ]);
  });

  test('P0-P8 frozen routes remain explicitly marked as regression-only', () => {
    const frozen = ['dashboard', 'orders', 'purchase-receipts', 'mrp-runs', 'material-requirements-plan', 'inventory', 'inventory-scraps', 'inventory-month-end', 'inventory-transactions', 'decision-reports'];
    for (const route of frozen) {
      assert.match(matrix, new RegExp(`\\| ${route} \\|[^\\n]+\\| V1\\.6 FROZEN \\| PASS \\|`));
      assert.match(surface, new RegExp(`['"]${route}['"]`));
    }
  });

  test('every enabled route has a final frozen or migrated implementation classification', () => {
    for (const { route, line } of enabledMatrixRows()) {
      assert.match(line, /\| V1\.6 (?:FROZEN|MIGRATED) \| PASS \|/, `${route} needs final implementation state`);
      assert.doesNotMatch(line, /UNKNOWN|TODO|NOT REVIEWED|FRONTEND-LIMITED/);
    }
  });

  test('site-wide stylesheet is imported after frozen phase styles', () => {
    const frozenIndex = main.indexOf("import './styles/v16-decision-reports.css'");
    const rolloutIndex = main.indexOf("import './styles/v16-sitewide-rollout.css'");
    assert.ok(frozenIndex > -1 && rolloutIndex > frozenIndex);
    assert.match(rolloutCss, /\.v16-mobile-enterprise \.v16-route-surface/);
  });

  test('migrated route CSS does not hide page overflow', () => {
    assert.doesNotMatch(rolloutCss, /overflow-x\s*:\s*hidden/);
    assert.match(rolloutCss, /max-width:\s*var\(--v16-app-max-width\)/);
  });

  test('migrated headers no longer emit duplicate h1 route titles', () => {
    const businessHeader = designSystem.match(/export function BusinessPageHeader[\s\S]*?export function BusinessPageShell/);
    assert.ok(businessHeader);
    assert.doesNotMatch(businessHeader[0], /<h1>/);
    assert.doesNotMatch(app, /standaloneTitle\s*\/?\s*>/);
  });

  test('App wraps application pages in the semantic route surface', () => {
    assert.match(app, /<V16RouteSurface route=\{route\.key\}><RouteScreen route=\{route\}/);
    for (const attribute of ['data-route', 'data-rollout-state', 'data-route-classification', 'data-application-group', 'data-archetype', 'data-module']) {
      assert.match(surface, new RegExp(attribute));
    }
  });

  test('launcher items continue to target legitimate enabled routes', () => {
    const enabled = new Set(ROUTE_PRESENTATIONS.map((route) => route.route));
    for (const group of MOBILE_APPLICATION_GROUPS) {
      for (const item of group.items) assert.ok(enabled.has(item.page), `${group.key}/${item.page}`);
    }
  });
});
