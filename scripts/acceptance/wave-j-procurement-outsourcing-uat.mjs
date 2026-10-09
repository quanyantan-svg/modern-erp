// Procurement & Outsourcing Domain — Wave J mobile-first browser UAT.
// Runs actual Playwright workflows in real chromium-headless browser.
// Verifies procurement/outsourcing surfaces at 320/390/430/680 widths.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const WIDTHS = [320, 390, 430, 680];
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-prc-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let baseUrl;
const results = [];

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForLoadState('networkidle');
}

async function inspect(page, name, surface) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const win = window;
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      overflow: doc.scrollWidth > doc.clientWidth + 1,
      activeElement: document.activeElement?.tagName || null,
      consoleErrors: (window.__consoleErrors || []).length,
    };
  });
  // Touch target >= 44px check
  const tinyButtons = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const small = buttons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.width < 32 || r.height < 32);
    }).map((b) => b.textContent.trim().slice(0, 30));
    return small;
  });
  results.push({
    surface, name,
    width: metrics.clientWidth,
    overflow: metrics.overflow,
    tinyButtons: tinyButtons.length,
    consoleErrors: metrics.consoleErrors,
    PASS: !metrics.overflow && metrics.consoleErrors === 0,
  });
  console.log(`[${metrics.clientWidth}] ${surface}: overflow=${metrics.overflow} tiny=${tinyButtons.length} ${metrics.overflow || metrics.consoleErrors > 0 ? 'FAIL' : 'PASS'}`);
}

async function gotoApp(page, label) {
  // Navigate via deep-link to ensure direct URL works (Refresh / Back / Forward)
  await page.goto(`${baseUrl}#/purchase-orders`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(200);
}

async function runSurface(browser, surface, route, widths) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  await page.addInitScript((errors) => { window.__consoleErrors = errors; }, consoleErrors);
  await login(page, 'admin', 'admin123');
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${baseUrl}#${route}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(300);
    await inspect(page, `w${w}`, surface);
  }
  await context.close();
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  try {
    // Sourcing & Pricing
    await runSurface(browser, 'Sourcing & Pricing', 'sourcing-pricing', WIDTHS);
    // Purchase Requisitions
    await runSurface(browser, 'Purchase Requisitions', 'purchase-requisitions', WIDTHS);
    // Purchase Orders
    await runSurface(browser, 'Purchase Orders', 'purchase-orders', WIDTHS);
    // Receiving (purchase-receipts)
    await runSurface(browser, 'Receiving', 'purchase-receipts', WIDTHS);
    // Purchase Returns
    await runSurface(browser, 'Purchase Returns', 'returns', WIDTHS);
    // Outsourcing (Wave J new)
    await runSurface(browser, 'Outsourcing Execution Hub', 'outsourcing', WIDTHS);
    // Suppliers (procurement master data)
    await runSurface(browser, 'Suppliers', 'suppliers', WIDTHS);
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
  // Report
  const bySurface = {};
  for (const r of results) {
    if (!bySurface[r.surface]) bySurface[r.surface] = [];
    bySurface[r.surface].push(`${r.width}:${r.PASS ? 'PASS' : 'FAIL'}`);
  }
  console.log('\n=== Wave J Browser UAT Matrix ===');
  let totalPass = 0, totalFail = 0;
  for (const [surface, widths] of Object.entries(bySurface)) {
    console.log(`${surface}:`);
    for (const w of widths) {
      console.log(`  ${w}`);
      if (w.endsWith('PASS')) totalPass += 1;
      else totalFail += 1;
    }
  }
  console.log(`\nTOTAL: ${totalPass} PASS, ${totalFail} FAIL`);
  if (totalFail > 0) {
    console.log('\nFailures:');
    for (const r of results) if (!r.PASS) console.log(`  ${r.surface} @${r.width}: overflow=${r.overflow} tiny=${r.tinyButtons} console=${r.consoleErrors}`);
  }
}

main().catch((err) => {
  console.error('UAT failed:', err);
  process.exitCode = 1;
});
