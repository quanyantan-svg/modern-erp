import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APPROVAL_FAMILIES, DISABLED_ROUTE_PRESENTATIONS, PRIMARY_DOMAINS, ROUTE_PRESENTATIONS, TECHNICAL_ROUTE_ALIASES } from '../src/navigation/presentationMetadata.js';
import { ACTIVE_APPLICATION_ROUTES, DISABLED_APPLICATION_ROUTES } from '../src/navigation/applicationRegistry.js';

const read = (path) => readFileSync(resolve(path), 'utf8');

test('D0 route presentation registry is complete and excludes aliases and disabled routes', () => {
  assert.equal(ROUTE_PRESENTATIONS.length, 55);
  assert.equal(new Set(ROUTE_PRESENTATIONS.map((item) => item.route)).size, 55);
  assert.deepEqual(DISABLED_ROUTE_PRESENTATIONS.map((item) => item.route), ['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup']);
  assert.equal(ROUTE_PRESENTATIONS.some((item) => item.route === 'mrp'), false);
  assert.equal(TECHNICAL_ROUTE_ALIASES.mrp, 'material-requirements-plan');
  for (const item of ROUTE_PRESENTATIONS) {
    for (const field of ['title', 'domain', 'semanticLevel', 'template', 'level']) assert.ok(item[field], `${item.route} lacks ${field}`);
  }
});

test('D0 presentation projection reconciles exactly with canonical application registry', () => {
  const active = new Set(ACTIVE_APPLICATION_ROUTES.map((entry) => entry.key));
  assert.equal(active.size, 55);
  assert.deepEqual(active, new Set(ROUTE_PRESENTATIONS.map((item) => item.route)));
  assert.deepEqual(new Set(DISABLED_APPLICATION_ROUTES.map((entry) => entry.key)), new Set(DISABLED_ROUTE_PRESENTATIONS.map((item) => item.route)));
});

test('D0 product semantics freeze eight domains and six approval families', () => {
  assert.deepEqual(PRIMARY_DOMAINS.map((item) => item.key), ['master-engineering','sales-customer','planning','procurement-outsourcing','manufacturing-quality','inventory-warehouse','finance-operations','accounting-analytics']);
  assert.deepEqual(APPROVAL_FAMILIES, ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PRODUCTION_ORDER']);
  assert.equal(APPROVAL_FAMILIES.includes('INVENTORY_TRANSFER'), false);
  const byRoute = Object.fromEntries(ROUTE_PRESENTATIONS.map((item) => [item.route, item]));
  assert.equal(byRoute['material-requirements-plan'].parentRoute, 'mrp-runs');
  assert.equal(byRoute.iqc.parentRoute, 'purchase-receipts');
  assert.equal(byRoute.oqc.parentRoute, 'sales-deliveries');
  assert.equal(byRoute['payment-collections'].parentRoute, 'accounts-receivable');
  assert.equal(byRoute['payment-disbursements'].parentRoute, 'accounts-payable');
});

test('D0 shared components and responsive tokens are reusable foundations', () => {
  const components = read('src/components/design-system.jsx');
  const css = read('src/styles.css');
  for (const name of ['BusinessPageShell', 'BusinessStatusGroup', 'BusinessDetailLayout', 'BusinessSummarySection', 'BusinessRelationSection', 'BusinessAuditSection', 'BusinessDangerZone', 'HelpDisclosure', 'BusinessAction']) assert.match(components, new RegExp(`export function ${name}`));
  for (const kind of ['LOADING', 'EMPTY', 'FILTER_EMPTY', 'PREREQUISITE_REQUIRED', 'PERMISSION_LIMITED', 'BUSINESS_BLOCKED', 'ERROR']) assert.match(components, new RegExp(`${kind}:`));
  for (const token of ['--page-max-width', '--page-padding-mobile', '--page-padding-tablet', '--page-padding-desktop', '--section-spacing', '--radius-container', '--semantic-danger']) assert.match(css, new RegExp(token));
  assert.match(css, /@media \(max-width:1119px\)/);
  assert.match(css, /@media \(max-width:767px\)/);
});

test('D0 mobile catalogue and business overview consume canonical presentation metadata', () => {
  assert.match(read('src/navigation/applicationMetadata.js'), /presentationForRoute\(metadata\.page\)/);
  assert.match(read('src/pages/business-overview.jsx'), /presentationForRoute\(page\)/);
});
