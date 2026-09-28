import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e5-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

async function login(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill('admin');
  await page.locator('input[autocomplete="current-password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByTestId('mobile-launcher').waitFor();
  await page.getByRole('button', { name: '打开销售统计' }).click();
  await page.getByTestId('decision-reports').waitFor();
}

async function openCustomerSelector(page) {
  await page.getByRole('button', { name: /筛选报表/ }).click();
  await page.getByTestId('report-filter-customerId').getByRole('button').first().click();
  await page.getByTestId('report-filter-customerId-panel').waitFor();
}

async function runViewport(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);
  await openCustomerSelector(page);

  const search = page.getByTestId('report-filter-customerId-search');
  await search.fill('C001');
  const activeOption = page.getByRole('option').filter({ hasText: 'C001' }).first();
  await activeOption.waitFor();
  check((await activeOption.innerText()).includes('深圳创想科技有限公司'), `${viewport.width}px selector searches active customer by code`);
  await activeOption.click();
  check((await page.getByTestId('report-filter-customerId-chip').innerText()).includes('C001 · 深圳创想科技有限公司'), `${viewport.width}px selected chip shows code and name`);
  await page.getByRole('button', { name: '应用筛选' }).click();
  await page.getByTestId('sales-summary-body').waitFor();

  await openCustomerSelector(page);
  await page.getByTestId('report-filter-customerId-panel-clear').click();
  await page.getByRole('button', { name: '应用筛选' }).click();
  await page.getByTestId('sales-summary-body').waitFor();
  check(await page.getByTestId('report-filter-customerId-chip').count() === 0, `${viewport.width}px clear restores unrestricted customer dimension`);

  await openCustomerSelector(page);
  await search.fill('E5-UAT-INACTIVE');
  const inactiveOption = page.getByRole('option').filter({ hasText: 'E5-UAT-INACTIVE' });
  await inactiveOption.waitFor();
  check((await inactiveOption.innerText()).includes('已停用'), `${viewport.width}px inactive historical customer is marked`);

  if (viewport.width <= 640) {
    const panel = await page.getByTestId('report-filter-customerId-panel').boundingBox();
    check(panel && panel.x === 0 && panel.y === 0 && Math.round(panel.width) === viewport.width, `${viewport.width}px selector uses full-screen mobile panel`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${viewport.width}px has no horizontal overflow`);
  check(errors.length === 0, `${viewport.width}px has no browser console/page errors`);
  await context.close();
}

let baseUrl;
try {
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('e5-uat-inactive','E5-UAT-INACTIVE','历史停用客户','','','',0,'2026-01-01','2026-01-01')`).run();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  await runViewport({ width: 375, height: 812 });
  await runViewport({ width: 1024, height: 768 });
  console.log('V1.4-E5 BROWSER UAT = PASS');
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
