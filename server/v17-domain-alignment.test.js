import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVE_APPLICATION_ROUTES, APPLICATION_LAUNCHER_GROUPS, APPLICATION_ROUTES,
  DISABLED_APPLICATION_ROUTES, applicationRouteFor,
} from '../src/navigation/applicationRegistry.js';
import { BUSINESS_DOMAIN_KEYS, CANONICAL_DOMAIN_KEYS, PLATFORM_DOMAIN } from '../src/navigation/domainMetadata.js';

const repoRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

test('Domain Alignment keeps 59 active and 5 disabled routes on canonical domains (after Procurement & Outsourcing closure: +sourcing-pricing +outsourcing)', () => {
  assert.equal(ACTIVE_APPLICATION_ROUTES.length, 59);
  assert.equal(DISABLED_APPLICATION_ROUTES.length, 5);
  const canonical = new Set(CANONICAL_DOMAIN_KEYS);
  for (const route of APPLICATION_ROUTES) assert.ok(canonical.has(route.domain), `${route.key}: ${route.domain}`);
  const activeDomains = new Set(ACTIVE_APPLICATION_ROUTES.map((route) => route.domain));
  for (const legacy of ['master-data','sales','production','purchasing','inventory','analytics','extension','cross-domain','sales-purchasing','planning-production','planning-purchasing']) {
    assert.equal(activeDomains.has(legacy), false, `legacy domain ${legacy}`);
  }
});

test('Business Launcher is exactly eight non-empty canonical groups and excludes Platform', () => {
  assert.deepEqual(APPLICATION_LAUNCHER_GROUPS.map((group) => group.key), BUSINESS_DOMAIN_KEYS);
  assert.ok(APPLICATION_LAUNCHER_GROUPS.every((group) => group.kind === 'domain' && group.items.length > 0));
  const activeKeys = new Set(ACTIVE_APPLICATION_ROUTES.map((route) => route.key));
  for (const entry of APPLICATION_LAUNCHER_GROUPS.flatMap((group) => group.items)) assert.ok(activeKeys.has(entry.routeKey), entry.key);
  const platformRoutes = new Set(ACTIVE_APPLICATION_ROUTES.filter((route) => route.domain === PLATFORM_DOMAIN.key).map((route) => route.key));
  for (const entry of APPLICATION_LAUNCHER_GROUPS.flatMap((group) => group.items)) assert.equal(platformRoutes.has(entry.routeKey), false, entry.key);
});

test('representative routes have one target owner across domain boundaries', () => {
  const expected = {
    'sales-invoices': 'finance-operations', 'accounts-receivable': 'finance-operations',
    'supplier-bills': 'finance-operations', 'accounts-payable': 'finance-operations',
    accounting: 'accounting-analytics', 'decision-reports': 'accounting-analytics',
    products: 'master-engineering', boms: 'master-engineering', 'product-routings': 'master-engineering',
    forecasts: 'planning', 'mrp-runs': 'planning', 'production-instructions': 'planning',
    'production-orders': 'manufacturing-quality', iqc: 'manufacturing-quality', oqc: 'manufacturing-quality',
    approvals: 'platform', notifications: 'platform', users: 'platform', workflows: 'platform',
  };
  for (const [routeKey, domain] of Object.entries(expected)) assert.equal(applicationRouteFor(routeKey)?.domain, domain, routeKey);
  assert.equal(applicationRouteFor('workflows').enabled, false);
});

test('cleanup removals and shared route targets remain compatible', () => {
  for (const removed of ['projects','tasks','timesheets','contacts','followups','activities']) assert.equal(applicationRouteFor(removed), null);
  assert.deepEqual(applicationRouteFor('returns').targetContract.queryKeys, ['documentType']);
  assert.deepEqual(applicationRouteFor('decision-reports').targetContract.queryKeys, ['reportKey']);
  const returns = APPLICATION_LAUNCHER_GROUPS.flatMap((group) => group.items).filter((entry) => entry.routeKey === 'returns');
  assert.deepEqual(returns.map((entry) => entry.target.documentType), ['SALES_RETURN','PURCHASE_RETURN']);
});

test('misleading Project and Business owners are replaced by coherent Platform modules', () => {
  for (const path of ['src/pages/platform-notifications.jsx','src/pages/platform-workflows.jsx','server/modules/platform-notifications.js','server/modules/platform-workflows.js']) {
    assert.equal(existsSync(resolve(repoRoot, path)), true, path);
  }
  assert.equal(existsSync(resolve(repoRoot, 'src/pages/projects-workflow.jsx')), false);
  assert.equal(existsSync(resolve(repoRoot, 'server/modules/business.js')), false);
  assert.equal(applicationRouteFor('notifications').screen.modulePath, '../pages/platform-notifications.jsx');
  assert.equal(applicationRouteFor('workflows').screen.modulePath, '../pages/platform-workflows.jsx');
  const app = read('server/app.js');
  assert.doesNotMatch(app, /modules\/business\.js|pages\/projects-workflow\.jsx/);
  assert.match(app, /owner: 'server\/modules\/platform-notifications\.js'/);
  assert.match(app, /owner: 'server\/modules\/platform-workflows\.js'/);
});
