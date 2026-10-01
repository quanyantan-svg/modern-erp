import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p8-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p8-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const screenshots = [];
const results = [];
let browser;
let baseUrl;

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200, 'isolated acceptance database must expose the admin fixture');
  return (await response.json()).token;
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installReportFixtures(context) {
  await context.route('**/api/reports/decision/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/export')) {
      return route.fulfill({ status: 200, contentType: 'text/csv', body: 'metric,value\naccepted,1\n' });
    }
    if (path.endsWith('/sales-summary')) {
      return json(route, {
        summary: { orderCount: 1, orderCents: 125000, approvedOrderCount: 1, deliveryCount: 1, deliveryCents: 125000, returnCount: 0, returnCents: 0, netShipmentCents: 125000 },
        byCustomer: [], filters: {}, legacyMissing: { total: 0 }, dateBasis: {}, moneyUnit: 'cents', notes: 'P8 journey fixture',
      });
    }
    if (path.endsWith('/sales-outstanding') || path.endsWith('/purchase-outstanding')) {
      return json(route, { rows: [], population: { matchingLines: 0, hiddenFulfilledLines: 0, returnedLines: 0 }, asOfDate: '2026-10-01', accuracyStatus: 'COMPLETE' });
    }
    if (path.endsWith('/purchase-summary')) {
      return json(route, {
        summary: { orderCount: 0, orderCents: 0, approvedOrderCount: 0, receiptCount: 0, receiptCents: 0, returnCount: 0, returnCents: 0, netReceiptCents: 0 },
        bySupplier: [], filters: {}, legacyMissing: { total: 0 }, dateBasis: {}, moneyUnit: 'cents', notes: 'P8 journey fixture',
      });
    }
    return json(route, { rows: [], filters: {}, legacyMissing: { withoutBusinessDate: 0 }, dateBasis: {}, reconciliation: {} });
  });
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function navigate(page, route) {
  await page.evaluate((nextRoute) => { window.location.hash = nextRoute; }, route);
  await page.locator(`[data-testid="mobile-application-view-${route}"]`).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.location.hash.slice(1)), route);
}

async function openLauncher(page) {
  const back = page.locator('[data-testid="mobile-header-back"]');
  if (await back.count()) await back.click();
  await page.locator('[data-testid="v16-launcher"]').waitFor({ state: 'visible' });
}

async function assertFrame(page, name, errors) {
  await page.waitForTimeout(150);
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    shellWidth: document.querySelector('.mobile-shell')?.getBoundingClientRect().width || 0,
  }));
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${name}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
  assert.ok(metrics.shellWidth <= Math.min(680, metrics.clientWidth) + 1, `${name}: shell exceeds the mobile rail`);
  assert.equal(await page.locator('.mobile-bottom-nav').count(), 1, `${name}: mobile navigation must remain mounted`);
  assert.deepEqual(errors, [], `${name}: browser errors: ${errors.join(' | ')}`);
}

async function runJourney(token, name, routes, finalAssertion) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installReportFixtures(context);
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`${baseUrl}#${routes[0]}`, { waitUntil: 'networkidle' });
  await page.locator(`[data-testid="mobile-application-view-${routes[0]}"]`).waitFor();
  for (const route of routes.slice(1)) await navigate(page, route);
  if (finalAssertion) await finalAssertion(page);
  await assertFrame(page, name, errors);
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  const screenshot = join(outputDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  screenshots.push(screenshot);
  results.push({ name, routes, ok: true });
  await context.close();
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  await runJourney(token, '01-o2c', ['orders', 'sales-deliveries', 'returns', 'accounts-receivable'], async (page) => {
    await page.getByText('应收账款', { exact: true }).first().waitFor();
  });
  await runJourney(token, '02-p2p', ['purchase-requisitions', 'purchase-orders', 'purchase-receipts', 'accounts-payable'], async (page) => {
    await page.getByText('应付账款', { exact: true }).first().waitFor();
  });
  await runJourney(token, '03-production', ['forecasts', 'mrp-runs', 'material-requirements-plan', 'production-instructions', 'production-orders', 'material-issues', 'production-receipts']);
  await runJourney(token, '04-inventory', ['inventory', 'inventory-transactions', 'inventory-scraps', 'inventory-month-end']);
  await runJourney(token, '05-approval', ['orders'], async (page) => {
    await openLauncher(page);
    await page.getByRole('button', { name: '审批' }).click();
    await page.locator('[data-testid="mobile-approval-center"]').waitFor();
  });
  await runJourney(token, '06-analytics', ['decision-reports'], async (page) => {
    await page.locator('[data-testid="decision-reports"]').waitFor();
    assert.equal(await page.locator('[data-testid="decision-report-panel-sales-summary"]').count(), 1, 'sales summary report must render');
  });
  await runJourney(token, '07-contextual', ['accounts-receivable', 'sales-invoices', 'payment-collections', 'accounts-payable', 'supplier-bills', 'payment-disbursements', 'purchase-receipts', 'iqc', 'sales-deliveries', 'oqc']);
  await runJourney(token, '08-master-to-execution', ['products', 'boms', 'product-routings', 'mrp-runs', 'production-orders']);

  process.stdout.write(`${JSON.stringify({ ok: true, journeys: results, screenshots }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
