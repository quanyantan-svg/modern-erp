import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { MOBILE_APPLICATION_GROUPS } from '../../src/navigation/applicationMetadata.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e8-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;
let baseUrl;

const originalScopeRoutes = [
  'business-overview', 'customers', 'suppliers', 'products', 'warehouses', 'boms', 'product-routings',
  'orders', 'sales-deliveries', 'returns', 'accounts-receivable',
  'forecasts', 'mrp-runs', 'material-requirements-plan', 'production-instructions', 'purchase-instructions',
  'purchase-requisitions', 'production-orders', 'material-issues', 'production-receipts',
  'purchase-orders', 'purchase-receipts', 'accounts-payable', 'inventory', 'inventory-scraps',
  'inventory-month-end', 'inventory-transactions', 'traceability', 'decision-reports',
];

const disabledRoutes = new Set(['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup']);
const allCurrentRoutes = [...new Set(MOBILE_APPLICATION_GROUPS.flatMap((group) => group.items.map((item) => item.page)))]
  .filter((route) => !disabledRoutes.has(route));

const viewportRoutes = {
  '375×812': allCurrentRoutes,
  '390×844': ['business-overview', 'orders', 'purchase-orders', 'inventory', 'inventory-month-end', 'traceability', 'decision-reports'],
  '768×1024': ['business-overview', 'orders', 'purchase-orders', 'inventory', 'inventory-month-end', 'decision-reports'],
  '1024×768': ['business-overview', 'orders', 'purchase-orders', 'inventory', 'inventory-month-end', 'decision-reports'],
  '1280×800': ['business-overview', 'orders', 'purchase-orders', 'inventory', 'inventory-month-end', 'decision-reports'],
};

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

async function login(page, username = 'admin', password = 'admin123') {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByTestId('mobile-launcher').waitFor();
}

async function openRoute(page, route) {
  await page.evaluate((nextRoute) => { window.location.hash = nextRoute; }, route);
  await page.getByTestId(`mobile-application-view-${route}`).waitFor();
  await page.waitForTimeout(120);
}

async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);

  for (const route of viewportRoutes[name]) {
    await openRoute(page, route);
    const dimensions = await page.evaluate(() => ({
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    check(dimensions.documentScrollWidth <= dimensions.documentClientWidth && dimensions.bodyScrollWidth <= dimensions.bodyClientWidth,
      `${name} ${route} has no page-level horizontal overflow: ${JSON.stringify(dimensions)}`);
    const view = page.getByTestId(`mobile-application-view-${route}`);
    check((await view.innerText()).trim().length > 0, `${name} ${route} renders meaningful page content`);
  }

  check(errors.length === 0, `${name} has no uncaught browser errors`);
  await context.close();
}

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  await runViewport('375×812', { width: 375, height: 812 });
  await runViewport('390×844', { width: 390, height: 844 });
  await runViewport('768×1024', { width: 768, height: 1024 });
  await runViewport('1024×768', { width: 1024, height: 768 });
  await runViewport('1280×800', { width: 1280, height: 800 });
  check(allCurrentRoutes.length === 48, 'all 48 currently enabled user-facing routes are included in the browser audit');
  check(!allCurrentRoutes.includes('system-health') && !allCurrentRoutes.includes('commercial-go-live'), 'System Health and go-live remain absent from user-facing navigation');
  console.log('V1.4-E8 PRODUCT CONSISTENCY UAT = PASS');
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
