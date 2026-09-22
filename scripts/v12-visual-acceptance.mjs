import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.ERP_VISUAL_URL || 'http://127.0.0.1:5173';
const outputDir = resolve(process.argv[2] || 'artifacts/v12-visual');
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const widths = [375, 414, 768, 1024, 1440, 1600, 1920];
const consoleErrors = [];
const networkErrors = [];
const results = [];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('requestfailed', (request) => networkErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().includes('/favicon.ico')) networkErrors.push(`${response.status()} ${response.url()}`);
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
if (await page.locator('input[autocomplete="username"]').count()) {
  await page.locator('input[autocomplete="username"]').fill(process.env.ERP_VISUAL_USER || 'admin');
  await page.locator('input[autocomplete="current-password"]').fill(process.env.ERP_VISUAL_PASSWORD || 'admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByTestId('mobile-launcher').waitFor();
}

async function inspect(name) {
  await page.waitForTimeout(180);
  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    const active = document.activeElement;
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      navVisible: Boolean(nav && nav.bottom <= innerHeight + 1 && nav.top >= 0),
      clippedActions: [...document.querySelectorAll('button')]
        .filter((button) => button.offsetWidth > 0 && !button.closest('.mobile-approval-tabs') && (button.scrollWidth > button.clientWidth + 1 || button.getBoundingClientRect().right > innerWidth + 1))
        .map((button) => button.textContent.trim() || button.getAttribute('aria-label')),
      activeElement: active?.tagName || null,
    };
  });
  results.push({ name, ...metrics, overflow: metrics.scrollWidth > metrics.clientWidth });
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true });
}

async function returnToLauncher() {
  const back = page.getByTestId('mobile-header-back');
  if (await back.count()) await back.click();
  else await page.getByTestId('bottom-tab-apps').click();
  await page.getByTestId('mobile-launcher').waitFor();
}

async function openApp(label, screenshotName) {
  await page.getByRole('button', { name: `打开${label}`, exact: true }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await inspect(screenshotName);
  await returnToLauncher();
}

for (const width of widths) {
  await page.setViewportSize({ width, height: width <= 414 ? 896 : 1000 });
  await inspect(`launcher-${width}`);
}

await page.setViewportSize({ width: 414, height: 896 });
await openApp('物料需求计划', 'material-plan');
await page.getByTestId('bottom-tab-approvals').click();
await page.waitForTimeout(250);
await inspect('approval-center');
await page.getByTestId('bottom-tab-apps').click();
await openApp('采购订单', 'purchase-orders');
await openApp('销售订单', 'sales-orders');
await openApp('库存查询 / 调拨 / 盘点', 'inventory');
await openApp('应收账款', 'accounts-receivable');
await openApp('数据整理', 'data-cleanup');

await page.route('**/api/products?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [] }) }));
await openApp('产品', 'empty-products');
await page.route('**/api/orders?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) }));
await openApp('销售订单', 'empty-sales-orders');

await page.locator('body').click({ position: { x: 2, y: 2 } });
await page.keyboard.press('Tab');
const keyboardFocus = await page.evaluate(() => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.matches(':focus-visible') && getComputedStyle(active).outlineStyle !== 'none';
});
await browser.close();

const report = {
  baseUrl,
  outputDir,
  widths,
  results,
  wholePageOverflow: results.some((result) => result.overflow),
  clippedActions: results.flatMap((result) => result.clippedActions.map((label) => `${result.name}: ${label}`)),
  bottomNavOverlap: results.some((result) => !result.navVisible),
  keyboardFocus,
  consoleErrors,
  networkErrors,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.wholePageOverflow || report.clippedActions.length || report.bottomNavOverlap || !keyboardFocus || consoleErrors.length || networkErrors.length) process.exitCode = 1;
