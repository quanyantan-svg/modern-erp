import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { ROUTE_PRESENTATIONS } from '../../src/navigation/presentationMetadata.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v15-d10-final-ux');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v15-d10-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const screenshots = [];
const manifest = [];
let browser;

const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'rail-680', width: 680, height: 1000 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
];

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function visit(token, route, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' });
  await page.getByTestId(`mobile-application-view-${route}`).waitFor({ timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(80);
  const dimensions = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
  }));
  const shellWidth = await page.locator('.mobile-shell').evaluate((element) => element.getBoundingClientRect().width).catch(() => 0);
  const overflow = dimensions.documentScrollWidth - dimensions.documentClientWidth;
  const content = (await page.getByTestId(`mobile-application-view-${route}`).innerText().catch(() => '')) || '';
  const result = overflow <= 1 && errors.length === 0 && content.trim().length > 0 ? 'PASS' : 'FAIL';
  return { viewport: viewport.name, route, overflow, shellWidth, contentLen: content.length, errors: [...errors], result };
}

async function capture(token, name, viewport, route, afterOpen) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${route ? `#${route}` : ''}`, { waitUntil: 'networkidle' });
  await page.getByTestId(route ? `mobile-application-view-${route}` : 'mobile-launcher').waitFor();
  if (afterOpen) await afterOpen(page);
  await page.waitForTimeout(150);
  const file = join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  await context.close();
}

let baseUrl;
try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  console.log(`V1.5 D10 — visiting ${ROUTE_PRESENTATIONS.length} active routes across ${VIEWPORTS.length} viewports`);

  // Visit all 53 routes at all viewports
  for (const viewport of VIEWPORTS) {
    for (const item of ROUTE_PRESENTATIONS) {
      const result = await visit(token, item.route, viewport);
      manifest.push(result);
      const status = result.result === 'PASS' ? '✓' : '✗';
      console.log(`${status} ${viewport.name} ${item.route}  overflow=${result.overflow}  errors=${result.errors.length}`);
    }
  }

  // Capture representative final screenshot pack covering each archetype
  const mobile = { width: 390, height: 844 };
  const rail = { width: 680, height: 1000 };
  const desktop = { width: 1440, height: 1000 };
  await capture(token, 'application-mobile', mobile);
  await capture(token, 'application-desktop', desktop);
  await capture(token, 'business-overview-mobile', mobile, 'business-overview');
  await capture(token, 'business-overview-desktop', desktop, 'business-overview');
  await capture(token, 'orders-list-mobile', mobile, 'orders');
  await capture(token, 'purchase-orders-list-desktop', desktop, 'purchase-orders');
  await capture(token, 'products-list-mobile', mobile, 'products');
  await capture(token, 'inventory-operations-mobile', mobile, 'inventory');
  await capture(token, 'purchase-receipts-mobile', mobile, 'purchase-receipts');
  await capture(token, 'purchase-receipts-desktop', desktop, 'purchase-receipts');
  await capture(token, 'sales-deliveries-mobile', mobile, 'sales-deliveries');
  await capture(token, 'returns-mobile', mobile, 'returns');
  await capture(token, 'accounts-receivable-mobile', mobile, 'accounts-receivable');
  await capture(token, 'accounts-payable-mobile', mobile, 'accounts-payable');
  await capture(token, 'forecast-mobile', mobile, 'forecasts');
  await capture(token, 'mrp-runs-mobile', mobile, 'mrp-runs');
  await capture(token, 'production-orders-mobile', mobile, 'production-orders');
  await capture(token, 'manufacturing-analytics-mobile', mobile, 'manufacturing-analytics');
  await capture(token, 'decision-reports-mobile', mobile, 'decision-reports');
  await capture(token, 'decision-reports-desktop', desktop, 'decision-reports');
  await capture(token, 'iqc-mobile', mobile, 'iqc');
  await capture(token, 'oqc-mobile', mobile, 'oqc');
  await capture(token, 'notifications-mobile', mobile, 'notifications');
  await capture(token, 'approvals-mobile', mobile, 'approvals');
  await capture(token, 'bank-accounts-mobile', mobile, 'bank-accounts');
  await capture(token, 'product-costs-mobile', mobile, 'product-costs');
  await capture(token, 'users-mobile', mobile, 'users');

  const passCount = manifest.filter((m) => m.result === 'PASS').length;
  const failCount = manifest.filter((m) => m.result === 'FAIL').length;
  console.log(`\nV1.5 D10 FINAL UX ACCEPTANCE = ${failCount === 0 ? 'PASS' : 'HOLD'}`);
  console.log(`Total visits: ${manifest.length}, PASS: ${passCount}, FAIL: ${failCount}`);
  console.log(JSON.stringify({ ok: failCount === 0, manifest, screenshots }, null, 2));
  assert.equal(failCount, 0, `Expected 0 failed visits; got ${failCount}`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}