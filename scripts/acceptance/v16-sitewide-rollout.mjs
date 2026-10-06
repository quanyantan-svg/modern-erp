import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { ROUTE_PRESENTATIONS } from '../../src/navigation/presentationMetadata.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-sitewide-rollout');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-sitewide-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const routeResults = [];
const responsiveResults = [];
const journeyResults = [];
const screenshots = [];
let browser;
let baseUrl;

const reportEntity = (id, code, name) => ({ id, code, name, active: 1 });
const reportCustomer = reportEntity('customer-1', 'CUS-001', '浏览器验收客户');
const reportSupplier = reportEntity('supplier-1', 'SUP-001', '浏览器验收供应商');
const reportProduct = reportEntity('product-1', 'MAT-001', '浏览器验收产品');
const reportWarehouse = reportEntity('warehouse-1', 'WH-001', '浏览器验收仓库');
const outstandingRow = {
  orderId: 'order-1', orderItemId: 'order-item-1', orderNumber: 'SO-20261001-001', lineNumber: 1,
  orderedQuantity: 100, fulfilledQuantity: 30, remainingQuantity: 70, commitmentDate: '2026-09-30',
  overdue: true, overdueDays: 1, fulfillmentStatus: 'PARTIAL', contributionCount: 1,
  accuracyStatus: 'COMPLETE', legacyAccuracyLimited: false, overFulfilledQuantity: 0,
  customer: reportCustomer, supplier: reportSupplier, product: reportProduct,
};

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200, 'isolated acceptance database must expose the admin fixture');
  return (await response.json()).token;
}

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installDecisionReportFixtures(context) {
  await context.route('**/api/reports/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/export')) return route.fulfill({ status: 200, contentType: 'text/csv', body: 'metric,value\naccepted,1\n' });
    if (/\/contributions$/.test(path)) return json(route, {
      reportKey: 'sales-outstanding',
      orderLine: { orderId: 'order-1', orderNumber: outstandingRow.orderNumber, orderItemId: outstandingRow.orderItemId, lineNumber: 1, orderedQuantity: 100 },
      executedQuantity: 30,
      contributions: [{
        sourceDocumentType: 'SALES_DELIVERY', sourceDocumentLabel: '销售出货', sourceDocumentId: 'delivery-1',
        sourceDocumentNumber: 'SD-20261001-001', sourceLineId: 'delivery-item-1', sourceLineNumber: 1,
        businessDate: '2026-09-30', quantity: 30, warehouse: reportWarehouse, status: 'CONFIRMED', linkage: 'EXACT_ORDER_LINE',
      }],
      accuracyStatus: 'COMPLETE', informationalItems: [],
    });
    if (path.endsWith('/sales-outstanding')) return json(route, {
      rows: [outstandingRow], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 },
      asOfDate: '2026-10-01', accuracyStatus: 'COMPLETE',
    });
    if (path.endsWith('/purchase-outstanding')) return json(route, {
      rows: [{ ...outstandingRow, orderNumber: 'PO-20261001-001', customer: undefined, supplier: reportSupplier }],
      population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01', accuracyStatus: 'COMPLETE',
    });
    if (path.endsWith('/sales-summary')) return json(route, {
      summary: { orderCount: 1, orderCents: 100000, approvedOrderCount: 1, deliveryCount: 1, deliveryCents: 30000, returnCount: 0, returnCents: 0, netShipmentCents: 30000 },
      byCustomer: [], filters: {}, legacyMissing: { total: 0 }, dateBasis: {}, moneyUnit: 'cents',
    });
    if (path.endsWith('/purchase-summary')) return json(route, {
      summary: { orderCount: 1, orderCents: 100000, approvedOrderCount: 1, receiptCount: 1, receiptCents: 30000, returnCount: 0, returnCents: 0, netReceiptCents: 30000 },
      bySupplier: [], filters: {}, legacyMissing: { total: 0 }, dateBasis: {}, moneyUnit: 'cents',
    });
    if (path.endsWith('/inventory-movements')) return json(route, {
      rows: [], filters: {}, legacyMissing: { withoutBusinessDate: 0 }, dateBasis: {}, reconciliation: {},
    });
    return route.continue();
  });
}

function collectErrors(page, currentRoute) {
  const errors = [];
  page.on('pageerror', (error) => errors.push({ route: currentRoute.value, type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ route: currentRoute.value, type: 'console', message: message.text() });
  });
  return errors;
}

async function newPage(token, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installDecisionReportFixtures(context);
  const page = await context.newPage();
  const currentRoute = { value: null };
  return { context, page, currentRoute, errors: collectErrors(page, currentRoute) };
}

async function navigate(page, currentRoute, route) {
  currentRoute.value = route;
  await page.evaluate((nextRoute) => { window.location.hash = nextRoute; }, route);
  await page.locator(`[data-testid="mobile-application-view-${route}"]`).waitFor({ state: 'visible', timeout: 10000 });
  await page.locator(`.v16-route-surface[data-route="${route}"]`).waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(100);
}

async function frameMetrics(page, route) {
  return page.evaluate((routeKey) => {
    const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const headerTitle = document.querySelector('.mobile-header__title')?.textContent?.trim() || '';
    const bodyH1 = [...document.querySelectorAll('.mobile-main h1')].filter(visible).map((element) => element.textContent.trim());
    return {
      route: routeKey,
      hash: window.location.hash.slice(1),
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellCount: document.querySelectorAll('[data-testid="mobile-shell"]').length,
      bottomNavCount: document.querySelectorAll('[data-testid="mobile-bottom-nav"]').length,
      routeSurfaceCount: document.querySelectorAll(`.v16-route-surface[data-route="${routeKey}"]`).length,
      headerTitle,
      visibleH1: bodyH1,
      duplicateTitle: bodyH1.includes(headerTitle),
    };
  }, route);
}

function assertMetrics(metrics, label) {
  assert.equal(metrics.hash, metrics.route, `${label}: invalid route fallback`);
  assert.equal(metrics.shellCount, 1, `${label}: MobileShell missing`);
  assert.equal(metrics.bottomNavCount, 1, `${label}: bottom navigation missing`);
  assert.equal(metrics.routeSurfaceCount, 1, `${label}: route surface missing`);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${label}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
  assert.equal(metrics.duplicateTitle, false, `${label}: duplicate main title ${metrics.headerTitle}`);
}

async function saveScreenshot(page, filename) {
  const path = join(outputDir, filename);
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  return path;
}

async function runAllRouteSmoke(token) {
  const { context, page, currentRoute, errors } = await newPage(token, 390);
  await page.goto(`${baseUrl}#${ROUTE_PRESENTATIONS[0].route}`, { waitUntil: 'networkidle' });
  for (const metadata of ROUTE_PRESENTATIONS) {
    const errorStart = errors.length;
    try {
      await navigate(page, currentRoute, metadata.route);
      const metrics = await frameMetrics(page, metadata.route);
      assertMetrics(metrics, metadata.route);
      const routeErrors = errors.slice(errorStart).filter((error) => error.route === metadata.route);
      assert.deepEqual(routeErrors, [], `${metadata.route}: browser/React errors`);
      routeResults.push({ route: metadata.route, ok: true, metrics });
    } catch (error) {
      const screenshot = await saveScreenshot(page, `failure-${metadata.route}-390.png`).catch(() => null);
      routeResults.push({ route: metadata.route, ok: false, error: error.message, screenshot });
    }
  }
  await context.close();
}

const representativeRoutes = [
  ['customers', 'master-data-list'],
  ['customers-editor', 'master-data-editor'],
  ['sales-deliveries', 'sales-transaction'],
  ['purchase-orders', 'purchase-transaction'],
  ['production-orders', 'production-list-detail'],
  ['inventory', 'inventory-frozen'],
  ['accounts-receivable', 'finance-list-detail'],
  ['accounting', 'accounting-form'],
  ['users', 'utility-admin'],
  ['iqc', 'contextual-quality'],
  ['decision-reports', 'decision-report-frozen'],
];

async function runResponsive(token, width) {
  const { context, page, currentRoute, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#customers`, { waitUntil: 'networkidle' });
  for (const [routeOrScenario, archetype] of representativeRoutes) {
    const route = routeOrScenario === 'customers-editor' ? 'customers' : routeOrScenario;
    const errorStart = errors.length;
    try {
      await navigate(page, currentRoute, route);
      if (routeOrScenario === 'customers-editor') {
        await page.getByRole('button', { name: /新增客户/ }).first().click();
        await page.locator('.modal-backdrop[data-presentation="page"]').waitFor();
        assert.equal(await page.locator('[data-testid="mobile-header-back"]').count(), 1, 'editor must use shell back');
      }
      const metrics = await frameMetrics(page, route);
      assertMetrics(metrics, `${archetype}-${width}`);
      assert.deepEqual(errors.slice(errorStart).filter((error) => error.route === route), [], `${archetype}-${width}: browser errors`);
      const screenshot = await saveScreenshot(page, `${archetype}-${width}.png`);
      responsiveResults.push({ width, route, archetype, ok: true, metrics, screenshot });
      if (routeOrScenario === 'customers-editor') await page.locator('[data-testid="mobile-header-back"]').click();
    } catch (error) {
      const screenshot = await saveScreenshot(page, `failure-${archetype}-${width}.png`).catch(() => null);
      responsiveResults.push({ width, route, archetype, ok: false, error: error.message, screenshot });
    }
  }
  await context.close();
}

async function runJourney(token, name, routes, action) {
  const { context, page, currentRoute, errors } = await newPage(token, 390);
  try {
    await page.goto(`${baseUrl}#${routes[0]}`, { waitUntil: 'networkidle' });
    for (const route of routes) await navigate(page, currentRoute, route);
    await action?.(page, currentRoute);
    const metrics = await frameMetrics(page, currentRoute.value);
    assertMetrics(metrics, name);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    journeyResults.push({ name, routes, ok: true });
  } catch (error) {
    const screenshot = await saveScreenshot(page, `failure-journey-${name}.png`).catch(() => null);
    journeyResults.push({ name, routes, ok: false, error: error.message, screenshot });
  } finally {
    await context.close();
  }
}

async function runJourneys(token) {
  await runJourney(token, 'apps-to-sales', ['orders']);
  await runJourney(token, 'sales-to-approval', ['orders', 'approvals']);
  await runJourney(token, 'mrp-to-material-plan', ['mrp-runs', 'material-requirements-plan']);
  await runJourney(token, 'purchase-receipt-to-iqc', ['purchase-receipts', 'iqc']);
  await runJourney(token, 'inventory-to-transfer', ['inventory'], async (page) => {
    await page.getByRole('button', { name: '调拨' }).first().click().catch(() => null);
    assert.equal(await page.getByText(/审批调拨|批准调拨/).count(), 0);
  });
  await runJourney(token, 'inventory-check-to-approval', ['inventory', 'approvals']);
  await runJourney(token, 'analytics-exact-report', ['decision-reports'], async (page) => {
    await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
    await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
    await page.locator('[data-testid="decision-report-panel-inventory-movements"]').waitFor();
  });
  await runJourney(token, 'outstanding-to-contribution', ['decision-reports'], async (page) => {
    await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
    await page.locator('[data-testid="decision-report-switcher-option-sales-outstanding"]').click();
    await page.locator('[data-testid^="sales-outstanding-contributions-"]').first().click();
    await page.locator('.v16-decision-reports__contribution-list').waitFor();
  });
  await runJourney(token, 'finance-accounting', ['accounts-receivable', 'payment-collections', 'accounting']);
  await runJourney(token, 'production-execution', ['production-instructions', 'production-orders', 'material-issues', 'production-receipts']);
  await runJourney(token, 'utility-admin', ['business-overview', 'notifications', 'users']);
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  await runAllRouteSmoke(token);
  for (const width of [320, 430, 680]) await runResponsive(token, width);
  await runJourneys(token);

  const summary = {
    ok: routeResults.every((result) => result.ok) && responsiveResults.every((result) => result.ok) && journeyResults.every((result) => result.ok),
    viewport: 390,
    enabledRouteSmoke: { total: routeResults.length, passed: routeResults.filter((result) => result.ok).length, results: routeResults },
    responsive: { widths: [320, 430, 680], total: responsiveResults.length, passed: responsiveResults.filter((result) => result.ok).length, results: responsiveResults },
    journeys: { total: journeyResults.length, passed: journeyResults.filter((result) => result.ok).length, results: journeyResults },
    screenshots,
  };
  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  assert.equal(summary.ok, true, 'site-wide browser acceptance has failures; inspect summary.json and failure screenshots');
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
