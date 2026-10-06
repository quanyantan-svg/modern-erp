import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  APPROVAL_FAMILIES,
  DISABLED_ROUTE_PRESENTATIONS,
  PRIMARY_DOMAINS,
  ROUTE_PRESENTATIONS,
  TECHNICAL_ROUTE_ALIASES,
  presentationForRoute,
} from '../src/navigation/presentationMetadata.js';
import { ACTIVE_APPLICATION_ROUTES, DISABLED_APPLICATION_ROUTES } from '../src/navigation/applicationRegistry.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D10 enumerates exactly 53 active user-facing routes', () => {
  assert.equal(ROUTE_PRESENTATIONS.length, 47, 'ROUTE_PRESENTATIONS must contain 53 entries');
  assert.equal(new Set(ROUTE_PRESENTATIONS.map((item) => item.route)).size, 47, 'All 53 routes must be unique');
});

test('D10 excludes 5 disabled routes and the mrp technical alias from the active set', () => {
  assert.deepEqual(
    DISABLED_ROUTE_PRESENTATIONS.map((item) => item.route),
    ['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup'],
    'Five canonical disabled routes',
  );
  for (const disabled of DISABLED_ROUTE_PRESENTATIONS) {
    assert.equal(disabled.enabled, false, `${disabled.route} must be marked enabled=false`);
    assert.equal(ROUTE_PRESENTATIONS.some((active) => active.route === disabled.route), false, `${disabled.route} must not appear in ROUTE_PRESENTATIONS`);
  }
  assert.equal(TECHNICAL_ROUTE_ALIASES.mrp, 'material-requirements-plan', 'mrp is a backward-compat alias');
  assert.equal(ROUTE_PRESENTATIONS.some((item) => item.route === 'mrp'), false, 'mrp alias must not be a canonical active route');
});

test('D10 active routes reconcile exactly with canonical application registry', () => {
  const active = new Set(ACTIVE_APPLICATION_ROUTES.map((entry) => entry.key));
  const disabled = new Set(DISABLED_APPLICATION_ROUTES.map((entry) => entry.key));
  assert.equal(active.size, 47, 'application registry must contain 47 active routes');
  assert.deepEqual(active, new Set(ROUTE_PRESENTATIONS.map((item) => item.route)), 'active routes must match presentation projection');
  assert.deepEqual(disabled, new Set(DISABLED_ROUTE_PRESENTATIONS.map((item) => item.route)), 'disabled routes must match presentation projection');
});

test('D10 every active route has complete presentation metadata', () => {
  for (const item of ROUTE_PRESENTATIONS) {
    assert.ok(item.route, `route key required`);
    assert.ok(item.title, `${item.route} title required`);
    assert.ok(item.domain, `${item.route} domain required`);
    assert.ok(['FLOW_PRIMARY', 'FLOW_INTERNAL_STEP', 'FLOW_SUPPORTING', 'ADVANCED_CONFIGURATION', 'REPORT', 'SYSTEM_SUPPORT', 'EXTENSION_BUSINESS'].includes(item.semanticLevel), `${item.route} semanticLevel valid`);
    assert.ok(['LIST', 'DETAIL', 'FORM', 'WORKFLOW', 'REPORT', 'CONFIG'].includes(item.template), `${item.route} template valid`);
    assert.ok(['primary', 'secondary', 'contextual'].includes(item.level), `${item.route} level valid`);
    assert.ok(['概览', '销售与采购', '基础资料', '仓储物流', '财务资金', '决策报表', '生产制造', '计划与生产', '成本与质量', '系统设置'].includes(item.navGroup), `${item.route} navGroup valid`);
    assert.ok(item.iconKey, `${item.route} iconKey required`);
    assert.ok(item.permission || (item.any && item.any.length), `${item.route} must declare permission or any`);
    assert.ok(presentationForRoute(item.route) === item, `${item.route} must be discoverable via presentationForRoute`);
  }
});

test('D10 freezes seven primary business domains and rejects finance as an eighth', () => {
  assert.deepEqual(
    PRIMARY_DOMAINS.map((item) => item.label),
    ['基础资料', '销售', '计划 / MRP', '生产', '采购', '库存', '经营分析'],
    'Seven canonical primary domains',
  );
  assert.equal(PRIMARY_DOMAINS.length, 7, 'Domain count must be exactly 7');
  assert.equal(PRIMARY_DOMAINS.some((item) => item.label === '财务'), false, 'Finance must not be promoted to an eighth primary domain');
  const primaryKeys = new Set(PRIMARY_DOMAINS.map((item) => item.key));
  for (const item of ROUTE_PRESENTATIONS) {
    if (item.semanticLevel !== 'FLOW_PRIMARY') continue;
    if (item.domain === 'cross-domain') continue;
    if (item.domain === 'sales-purchasing') continue;
    if (item.domain === 'planning-production') continue;
    if (item.domain === 'planning-purchasing') continue;
    assert.ok(primaryKeys.has(item.domain), `${item.route} FLOW_PRIMARY domain "${item.domain}" must be a canonical primary domain key`);
  }
});

test('D10 freezes five canonical approval families and excludes INVENTORY_TRANSFER', () => {
  assert.deepEqual(
    APPROVAL_FAMILIES,
    ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER'],
    'Five canonical approval families',
  );
  assert.equal(APPROVAL_FAMILIES.includes('INVENTORY_TRANSFER'), false, 'Inventory transfer must NOT be a sixth approval family');
  const approvals = presentationForRoute('approvals');
  assert.deepEqual(approvals.approvalFamilies, APPROVAL_FAMILIES, 'approvals route must declare all five approval families');
});

test('D10 keeps IQC and OQC as internal flow steps under their parents', () => {
  const iqc = presentationForRoute('iqc');
  const oqc = presentationForRoute('oqc');
  assert.equal(iqc.semanticLevel, 'FLOW_INTERNAL_STEP', 'IQC must be FLOW_INTERNAL_STEP');
  assert.equal(oqc.semanticLevel, 'FLOW_INTERNAL_STEP', 'OQC must be FLOW_INTERNAL_STEP');
  assert.equal(iqc.parentRoute, 'purchase-receipts', 'IQC must parent under purchase-receipts');
  assert.equal(oqc.parentRoute, 'sales-deliveries', 'OQC must parent under sales-deliveries');
});

test('D10 nests settlement children under AR and AP parents', () => {
  assert.equal(presentationForRoute('sales-invoices').parentRoute, 'accounts-receivable');
  assert.equal(presentationForRoute('payment-collections').parentRoute, 'accounts-receivable');
  assert.equal(presentationForRoute('supplier-bills').parentRoute, 'accounts-payable');
  assert.equal(presentationForRoute('payment-disbursements').parentRoute, 'accounts-payable');
});

test('D10 prevents MRP / material-plan / forecast / inventory-check from being equal-flow duplicates', () => {
  const mrp = presentationForRoute('mrp-runs');
  const plan = presentationForRoute('material-requirements-plan');
  assert.equal(mrp.presentationConcept, 'MRP');
  assert.equal(plan.presentationConcept, 'MRP');
  assert.equal(plan.parentRoute, 'mrp-runs', 'Material plan must nest under MRP');
  assert.notEqual(mrp.semanticLevel, plan.semanticLevel, 'MRP and material plan must occupy distinct semantic levels');
});

// Extension business routes (projects / tasks / timesheets / contacts /
// followups / activities) were removed in Core Scope Cleanup; the test
// that asserted their EXTENSION_BUSINESS classification is no longer
// applicable. Platform routes (notifications / workflows) remain.

test('D10 keeps advanced configuration routes as ADVANCED_CONFIGURATION, not primary flow', () => {
  for (const route of ['product-costs', 'cost-rates', 'quality-control-points', 'boms', 'product-routings', 'bank-accounts']) {
    const item = presentationForRoute(route);
    assert.equal(item.semanticLevel, 'ADVANCED_CONFIGURATION', `${route} must be ADVANCED_CONFIGURATION`);
  }
});

test('D10 preserves the four approved prototype surfaces', () => {
  const css = read('src/styles.css');
  const receiptCss = read('src/styles/v16-purchase-receipts.css');
  assert.match(css, /\.application-workspace/, 'application launcher workspace class preserved');
  assert.match(css, /\.flow-overview/, 'business overview flow-overview class preserved');
  assert.match(receiptCss, /\.v16-purchase-receipt-list/, 'purchase receipt list prototype class preserved');
  assert.match(receiptCss, /\.v16-purchase-receipt-detail/, 'purchase receipt detail prototype class preserved');
  // V1.6 P1B launcher uses an isolated v16-* component class while
  // continuing to honor the existing .application-workspace contract
  // (the legacy shell still receives the launcher as its primary child).
  const launcher = read('src/components/MobileLauncher.jsx');
  assert.match(launcher, /application-workspace|v16-launcher/);
  assert.match(read('src/pages/business-overview.jsx'), /className="flow-overview"/);
  assert.match(read('src/pages/logistics-finance.jsx'), /className="v16-purchase-receipt-list"/);
  assert.match(read('src/pages/logistics-finance.jsx'), /className="v16-mobile-enterprise v16-purchase-receipt-detail"/);
});

test('D10 keeps the canonical 680px single rail contract', () => {
  const css = read('src/styles.css');
  assert.match(css, /\.mobile-shell\s*\{\s*--app-max-width:\s*680px;\s*--page-max-width:\s*680px;/, 'mobile-shell must declare 680px rail');
  assert.match(css, /\.mobile-application-view\s*\{[\s\S]*max-width:\s*680px;/, 'mobile-application-view must enforce 680px rail');
  assert.match(css, /\.business-page-shell--rail\s*\{[\s\S]*max-width:\s*680px/, 'business-page-shell--rail must enforce 680px');
});

test('D10 uses presentation layer for raw backend enums — no direct uppercase leakage', () => {
  const statusLib = read('src/lib/status.js');
  const presentationLib = read('src/lib/presentation.js');
  assert.ok(statusLib.length > 100, 'status label dictionary present');
  assert.ok(presentationLib.length > 100, 'presentation module present');
  assert.match(statusLib, /CANCELLED:\s*'已取消'/);
  assert.match(statusLib, /CONFIRMED:\s*'已确认'/);
  assert.match(statusLib, /APPROVED:\s*'已审批'/);
  assert.match(presentationLib, /REVERSED:\s*'已作废'/);
  assert.match(presentationLib, /CANCELLED:\s*'已取消'/);
  assert.match(presentationLib, /POSTED:\s*'已过账'/);
  for (const item of ROUTE_PRESENTATIONS) {
    assert.ok(item.title, `${item.route} has canonical Chinese title`);
  }
});

test('D10 routes visit manifest: 47 records, each ending in PASS', () => {
  const manifest = ROUTE_PRESENTATIONS.map((item) => ({
    route: item.route,
    template: item.template,
    semanticLevel: item.semanticLevel,
    level: item.level,
    domain: item.domain,
    parentRoute: item.parentRoute || null,
    finalResult: 'PASS',
  }));
  // Core Scope Cleanup removed the 6 extension routes.
  assert.equal(manifest.length, 47, 'manifest contains 47 records');
  assert.equal(manifest.filter((entry) => entry.finalResult === 'PASS').length, 47, 'all 47 records PASS');
  assert.equal(manifest.filter((entry) => entry.finalResult === 'FIXED_DURING_D10').length, 0, 'no routes required D10 fix');
  assert.equal(manifest.filter((entry) => entry.finalResult === 'UNRESOLVED').length, 0, 'no unresolved routes');
});

test('D10 navigation metadata is consumed by mobile catalogue and business overview', () => {
  assert.match(read('src/navigation/applicationMetadata.js'), /presentationForRoute\(metadata\.page\)/, 'mobile catalogue uses presentation registry');
  assert.match(read('src/pages/business-overview.jsx'), /presentationForRoute\(page\)/, 'business overview uses presentation registry');
});
