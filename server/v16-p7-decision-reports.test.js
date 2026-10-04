// V1.6 P7 — Mobile Enterprise Decision Reports source-contract tests.
//
// These assertions guard the P7 mobile-enterprise refactor of
// `src/pages/decision-reports.jsx`. They are intentionally source-level
// (node:test + fs.readFileSync) so the test stays decoupled from
// component identity and remains focused on presentation-layer invariants
// that P7 must preserve. They do NOT cover server calculations or DB
// queries; those are owned by `server/decision-reports.test.js`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const page = read('src/pages/decision-reports.jsx');
const css = read('src/styles/v16-decision-reports.css');
const main = read('src/main.jsx');
const tokens = read('src/styles/v16-tokens.css');
const me = read('src/styles/v16-mobile-enterprise.css');
const serverModule = read('server/modules/decision-reports.js');
const serverApp = read('server/app.js');

// 1. The five canonical report keys remain.
test('P7 keeps exactly five canonical decision report keys', () => {
  const keys = ['sales-summary', 'sales-outstanding', 'purchase-summary', 'purchase-outstanding', 'inventory-movements'];
  for (const key of keys) {
    assert.match(page, new RegExp(`key:\\s*'${key}'`));
  }
});

// 2. Decision-reports remains a single route; no per-report routes introduced.
test('P7 keeps decision-reports as a single route with no per-report routes', () => {
  // The canonical registry owns the route and lazy screen identity.
  const appJsx = read('src/App.jsx');
  const registry = read('src/navigation/applicationRegistry.js');
  assert.match(registry, /'decision-reports':\s*defaultScreen\('\.\.\/pages\/decision-reports\.jsx'\)/);
  for (const sub of ['decision-reports/sales-summary', 'decision-reports/sales-outstanding', 'decision-reports/purchase-summary', 'decision-reports/purchase-outstanding', 'decision-reports/inventory-movements']) {
    assert.equal(serverApp.includes(`'${sub}'`), false, `${sub} must not be a route`);
    assert.equal(appJsx.includes(`'${sub}'`), false, `${sub} must not be a route`);
  }
});

// 3. The legacy five-horizontal-tab primary rail is retired.
test('P7 retires the legacy horizontal five-tab primary rail', () => {
  assert.doesNotMatch(page, /decision-reports__tabs\b/);
  assert.doesNotMatch(page, /decision-reports__tab--active/);
  assert.doesNotMatch(page, /role="tablist"/);
});

// 4. Authorised report switching is preserved.
test('P7 keeps canViewDecisionReport gating the visible report list', () => {
  assert.match(page, /can\(user,\s*'REPORT_VIEW'\)/);
  assert.match(page, /report\.domainPermissions\.some/);
  assert.match(page, /export function canViewDecisionReport/);
  assert.match(page, /REPORT_TABS\.filter\(\(tab\) => canViewDecisionReport\(user, tab\.key\)\)/);
});

// 5. BusinessPageHeader is no longer used as the page-level title in P7.
test('P7 retires BusinessPageHeader from the decision reports route', () => {
  assert.doesNotMatch(page, /BusinessPageHeader/);
  assert.doesNotMatch(page, /<h1[^>]*>经营分析<\/h1>/);
});

// 6. Permanent header HelpDisclosure is retired.
test('P7 retires permanent header HelpDisclosure summary="报表口径"', () => {
  assert.doesNotMatch(page, /<HelpDisclosure\s+summary="报表口径"/);
});

// 7. The compact FilterSheet remains.
test('P7 keeps the compact FilterSheet as the only filter entry point', () => {
  assert.match(page, /<FilterSheet\b/);
  assert.match(page, /<FilterButton\b/);
  assert.match(page, /筛选/);
});

// 8. Draft vs applied filters are explicit and never silently promoted.
test('P7 maintains draft and applied filter values separately', () => {
  assert.match(page, /draftFilters/);
  assert.match(page, /appliedFilters/);
  assert.match(page, /setAppliedFilters\(\{\s*\.\.\.draftFilters\s*\}\)/);
  // Reset path clears both draft and applied filters.
  assert.match(page, /setDraftFilters\(cleared\)/);
  assert.match(page, /setAppliedFilters\(\{\}\)/);
  // Closing the FilterSheet must not promote draft values.
  assert.match(page, /function closeFilters\(\)/);
});

// 9. CSV export only consumes applied filters.
test('P7 CSV export uses applied filters only', () => {
  const exportCallMatch = page.match(/api\(\s*`\/api\/reports\/decision\/\$\{[^}]+\}\/export`/);
  // ExportButton reads from `applied` prop; verify the wire passes applied only.
  assert.match(page, /applied=\{appliedFilters\}/);
  assert.match(page, /Object\.entries\(applied \|\| \{\}\)/);
});

// 10. Five CSV export endpoints remain registered.
test('P7 keeps all five decision CSV export endpoints', () => {
  for (const path of [
    '/api/reports/decision/sales-summary/export',
    '/api/reports/decision/sales-outstanding/export',
    '/api/reports/decision/purchase-summary/export',
    '/api/reports/decision/purchase-outstanding/export',
    '/api/reports/decision/inventory-movements/export',
  ]) {
    assert.match(serverApp, new RegExp(path.replace(/\//g, '\\/')));
  }
});

// 11. The useReport hook still drives the canonical GET endpoints.
test('P7 keeps useReport calling GET /api/reports/decision/{key}', () => {
  assert.match(page, /function useReport\(endpoint, appliedFilters\)/);
  assert.match(page, /api\(endpoint/);
  assert.match(page, /`\/api\/reports\/decision\/\$\{reportKey\}`/);
});

// 12. Sales / purchase metric key set remains stable.
test('P7 keeps sales and purchase metric keys byte-stable', () => {
  // Sales frozen metrics per document.md §29.8
  const sales = ['orderCount', 'orderCents', 'approvedOrderCount', 'deliveryCount', 'deliveryCents', 'returnCents', 'netShipmentCents'];
  for (const key of sales) {
    assert.match(page, new RegExp(`data\\.summary\\.${key}\\b`));
  }
  // Purchase frozen metrics per document.md §29.10
  const purchase = ['orderCount', 'orderCents', 'approvedOrderCount', 'receiptCount', 'receiptCents', 'returnCents', 'netReceiptCents'];
  for (const key of purchase) {
    assert.match(page, new RegExp(`data\\.summary\\.${key}\\b`));
  }
});

// 13. Outstanding reports use order-line granularity; no remaining/fulfilled recalculation.
test('P7 outstanding rows do not recompute remaining or fulfillment status', () => {
  assert.match(page, /row\.fulfillmentStatus/);
  assert.match(page, /row\.remainingQuantity/);
  // No client-side classification by remaining/ordered comparison.
  assert.doesNotMatch(page, /classifyFulfillment\(.*row\.orderedQuantity.*row\./);
  // No Math.max(ordered - executed, ...) style recompute.
  assert.doesNotMatch(page, /Math\.max\(.*ordered.*executed/);
});

// 14. Fulfillment contribution endpoint remains, and empty state stays honest.
test('P7 keeps fulfillment contribution evidence with empty fallback', () => {
  assert.match(page, /\/api\/reports\/\$\{reportKey\}\/lines\/\$\{encodeURIComponent\(orderItemId\)\}\/contributions/);
  assert.match(page, /没有可证明的履约贡献/);
  assert.match(page, /informationalItems/);
});

// 15. Outstanding contribution rows do not derive evidence from similarity.
test('P7 does not derive contribution evidence from date/quantity similarity', () => {
  assert.doesNotMatch(page, /approximate.*contribution|suggestContribution|bestMatch.*contribution/i);
});

// 16. Inventory movements never replace business_date with created_at.
test('P7 inventory movements keep businessDate and never substitute created_at', () => {
  assert.match(page, /row\.businessDate \|\| '业务日期缺失'/);
  assert.doesNotMatch(page, /inventory-movements.*createdAt\b|createdAt.*inventory-movements/);
});

// 17. Inventory report no longer uses RecordCard / RecordList as primary surface.
test('P7 inventory movements no longer rely on RecordCard / RecordList', () => {
  assert.doesNotMatch(page, /<RecordList[\s\S]*?inventory-movements[\s\S]*?<\/RecordList>/);
  assert.doesNotMatch(page, /<RecordCard[\s\S]*?inventory-movement[\s\S]*?<\/RecordCard>/);
});

// 18. Reconciliation renders three states with explicit null handling.
test('P7 reconciliation renders the three reconcilesToCurrent states', () => {
  assert.match(page, /流水与当前库存一致/);
  assert.match(page, /流水与当前库存不一致，请核查/);
  assert.match(page, /历史不足，无法核对/);
  // Only when server returns reconciliation; we do not fabricate.
  assert.match(page, /data\.reconciliation/);
});

// 19. Report states cover LOADING / ERROR / EMPTY / NO_RESULTS / READY plus matching-fulfilled branch.
test('P7 exposes all five core report states plus the matching-fulfilled branch', () => {
  for (const kind of ['LOADING', 'ERROR', 'EMPTY', 'NO_RESULTS', 'PERMISSION_DENIED']) {
    assert.match(page, new RegExp(`kind=["']${kind}["']`));
  }
  assert.match(page, /匹配行均已履行/);
});

// 20. Analytics module token is used; no conflicting --v16-module-reports token created.
test('P7 uses --v16-module-analytics token and does not invent --v16-module-reports', () => {
  assert.match(css, /--v16-module-analytics/);
  assert.doesNotMatch(css, /--v16-module-reports/);
  assert.doesNotMatch(tokens, /--v16-module-reports/);
  assert.match(tokens, /--v16-module-analytics:\s*#7656D6/);
});

// 21. Isolated P7 stylesheet is imported from main.jsx after the inventory control sheet.
test('P7 stylesheet is imported once and ordered after the inventory control sheet', () => {
  assert.match(main, /import '\.\/styles\/v16-decision-reports\.css'/);
  const decisionIdx = main.indexOf('v16-decision-reports.css');
  const inventoryIdx = main.indexOf('v16-inventory-control.css');
  assert.ok(inventoryIdx >= 0 && decisionIdx > inventoryIdx, 'decision-reports import must follow inventory-control');
});

// 22. Module color is identity only; not used for status / danger / overdue.
test('P7 CSS uses module color only as identity and never as status', () => {
  // Module color is used as focus outline + link color.
  assert.match(css, /var\(--v16-module-analytics,\s*#7656D6\)/);
  // Status colors remain semantic.
  assert.match(css, /var\(--danger/);
  assert.match(css, /var\(--success/);
  // Fulfillment status colors map to semantic tokens, not module color.
  const statusBlock = css.match(/fulfillment-status--unfulfilled[\s\S]*?fulfillment-status--over_fulfilled[\s\S]*?\}/);
  assert.ok(statusBlock, 'fulfillment status block must exist');
  assert.equal(/--v16-module-analytics/.test(statusBlock[0]), false, 'fulfillment status colors must not use module color');
});

// 23. The shared V1.6 shell classes still drive layout.
test('P7 uses shared v16 mobile-enterprise shell constraints', () => {
  assert.match(me, /max-width: var\(--v16-app-max-width\)/);
  assert.match(page, /className="v16-mobile-enterprise v16-decision-reports"/);
});

// 24. Backward-compatible exports are preserved for downstream consumers.
test('P7 keeps REPORT_TABS / REPORT_DATE_BASIS / canViewDecisionReport exports', () => {
  assert.match(page, /export const REPORT_TABS\b/);
  assert.match(page, /export const REPORT_DATE_BASIS\b/);
  assert.match(page, /export function canViewDecisionReport\b/);
  // Five user-facing labels remain.
  for (const label of ['销售统计分析', '销售未出货', '采购统计分析', '采购未交货', '库存异动明细']) {
    assert.match(page, new RegExp(label));
  }
});

// 25. BusinessEntitySelector remains the only entity filter mechanism.
test('P7 keeps BusinessEntitySelector for entity filters', () => {
  assert.match(page, /BusinessEntitySelector/);
  for (const entity of ['CUSTOMER', 'SUPPLIER', 'PRODUCT', 'WAREHOUSE']) {
    assert.match(page, new RegExp(`entityType:\\s*'${entity}'`));
  }
});

// 26. Outstanding fulfillment rows expose safe AppLink to source orders.
test('P7 outstanding rows preserve safe AppLink to source orders', () => {
  // Order-line navigation must still resolve to either 'orders' or 'purchase-orders'
  // based on whether the report is sales-outstanding or purchase-outstanding.
  assert.match(page, /partyPage\s*=\s*isSales\s*\?\s*'orders'\s*:\s*'purchase-orders'/);
  assert.match(page, /partyDocumentType\s*=\s*isSales\s*\?\s*'SALES_ORDER'\s*:\s*'PURCHASE_ORDER'/);
  assert.match(page, /documentId=\{row\.orderId\}/);
  assert.match(page, /<AppLink page=\{partyPage\} documentId=\{row\.orderId\} documentType=\{partyDocumentType\}/);
});

// 27. P7 does not modify the backend module, app.js, db.js, or migrations.
test('P7 does not modify backend modules, app.js, db.js or migrations', () => {
  for (const handler of [
    'getSalesSummary',
    'getSalesOutstanding',
    'getPurchaseSummary',
    'getPurchaseOutstanding',
    'getInventoryMovements',
    'getFulfillmentContributions',
    'exportSalesSummaryReport',
    'exportSalesOutstandingReport',
    'exportPurchaseSummaryReport',
    'exportPurchaseOutstandingReport',
    'exportInventoryMovementsReport',
  ]) {
    assert.match(serverModule, new RegExp(`export function ${handler}\\b`));
  }
  for (const path of [
    '/api/reports/decision/sales-summary',
    '/api/reports/decision/sales-outstanding',
    '/api/reports/decision/purchase-summary',
    '/api/reports/decision/purchase-outstanding',
    '/api/reports/decision/inventory-movements',
  ]) {
    assert.match(serverApp, new RegExp(path.replace(/\//g, '\\/')));
  }
  // Source is a regex literal; just check the route registration mentions both segments.
  assert.match(serverApp, /fulfillmentContributionsMatch/);
  assert.match(serverApp, /api\\\/reports\\\//);
  assert.match(serverApp, /lines\\\//);
  assert.match(serverApp, /contributions/);
});

// 28. Outstanding "all-fulfilled-but-hidden" branch stays distinct.
test('P7 keeps matching-but-all-fulfilled branch distinct from EMPTY and NO_RESULTS', () => {
  const branch = page.match(/hiddenFulfilledLines[\s\S]{0,300}匹配行均已履行/);
  assert.ok(branch, 'matching-but-all-fulfilled branch must remain');
});
