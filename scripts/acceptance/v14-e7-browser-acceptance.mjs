import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e7-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;
let baseUrl;

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  if (await page.getByTestId('mobile-launcher').count()) {
    await page.getByRole('button', { name: '打开业务总览' }).click();
  } else {
    await page.locator('a[href="#business-overview"]').click();
  }
  await page.locator('.business-overview').waitFor();
}

async function inspectOverview(page, viewportName) {
  const principal = await page.locator('.business-area__heading h2').allTextContents();
  check(JSON.stringify(principal) === JSON.stringify(['基础资料', '销售', '计划 / MRP', '生产', '采购', '库存', '财务衔接', '经营报表']), `${viewportName} Level 1 has the eight principal groups`);
  check(await page.getByText('出货后仍需销售发票过账才形成应收。', { exact: false }).count() > 0, `${viewportName} shipment is not presented as AR`);
  check(await page.getByText('供应商账单过账后才形成应付。', { exact: false }).count() > 0, `${viewportName} receipt is not presented as AP`);
  check(await page.getByText('调拨是仓库确认执行，不进入审批中心', { exact: false }).count() > 0, `${viewportName} transfer remains execution rather than approval`);
  const reportLabels = ['采购统计分析表', '采购未交货反应表', '销售统计分析表', '销售未出货反应表', '存货异动明细表'];
  for (const label of reportLabels) check(await page.getByText(label, { exact: true }).count() === 1, `${viewportName} report entry ${label} is present`);

  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(overflow.scrollWidth <= overflow.clientWidth, `${viewportName} has no page-level horizontal dependency: ${JSON.stringify(overflow)}`);
  const toggle = page.getByRole('button', { name: '展开业务细节' }).first();
  await toggle.focus();
  check(await toggle.evaluate((element) => element === document.activeElement), `${viewportName} detail toggle is keyboard focusable`);
}

async function runAdminViewport(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page, 'admin', 'admin123');
  await inspectOverview(page, `${viewport.width}×${viewport.height}`);
  check(await page.locator('.business-process-node.is-active').count() > 0, `${viewport.width}×${viewport.height} authorized nodes expose actions`);
  check(errors.length === 0, `${viewport.width}×${viewport.height} has no browser errors`);
  await context.close();
}

async function runRoleBoundary(username, password, forbiddenHref, expectedHref) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await login(page, username, password);
  check(await page.locator(`a[href="${expectedHref}"]`).count() > 0, `${username} sees a permitted process action`);
  check(await page.locator(`a[href="${forbiddenHref}"]`).count() === 0, `${username} receives no protected action for ${forbiddenHref}`);
  check(await page.locator('.business-process-node.is-readonly').count() > 0, `${username} still sees explanatory process nodes`);
  await context.close();
}

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  await runAdminViewport({ width: 375, height: 812 });
  await runAdminViewport({ width: 1024, height: 768 });
  await runRoleBoundary('sales', 'sales123', '#sales-deliveries', '#orders');
  await runRoleBoundary('warehouse', 'warehouse123', '#accounts-receivable', '#inventory');
  await runRoleBoundary('accounting', 'accounting123', '#sales-deliveries', '#accounts-receivable');
  console.log('V1.4-E7 BROWSER UAT = PASS');
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
