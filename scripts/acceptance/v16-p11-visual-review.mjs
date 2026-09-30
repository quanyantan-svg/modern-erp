import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p11-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p11-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [320, 390, 430, 680];
const results = [];
const screenshots = [];
let browser;
let baseUrl;

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200, 'visual fixture login must succeed');
  return (await response.json()).token;
}

async function assertTargets(page, selector, label) {
  const targets = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: node.textContent?.trim() };
  }));
  assert.ok(targets.length, `${label} must render targets`);
  for (const target of targets) {
    assert.ok(target.width >= 44 && target.height >= 44, `${label} target below 44px: ${JSON.stringify(target)}`);
  }
}

async function assertBottomClear(page, surface) {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(80);
  const metrics = await page.evaluate((surfaceName) => {
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    const selector = surfaceName === 'application' ? '.v16-launcher button' : '.v16-workspace button';
    const buttons = [...document.querySelectorAll(selector)].filter((button) => button.offsetParent !== null);
    const last = buttons.at(-1)?.getBoundingClientRect();
    return { navTop: nav?.top ?? 0, lastBottom: last?.bottom ?? 0 };
  }, surface);
  assert.ok(metrics.lastBottom <= metrics.navTop + 1, `${surface} final action overlaps bottom navigation`);
}

async function assertApplication(page, width) {
  await assertTargets(page, '.v16-launcher-tile', `application-${width}`);
  assert.equal(await page.locator('.v16-launcher-group').count(), 6, 'application must keep six business groups');
  assert.equal(await page.locator('.v16-utility__count').count(), 0, 'utility counts must not render');
  assert.equal(await page.locator('.v16-launcher-group').evaluateAll((groups) => (
    groups.every((group) => getComputedStyle(group.querySelector('.v16-section-title'), '::before').width === '3px')
  )), true, 'each business section must expose the 3px module marker');
  const firstRowTops = await page.locator('[data-testid="v16-launcher-group-master-data"] .v16-launcher-tile').evaluateAll((nodes) => (
    nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().top))
  ));
  assert.equal(new Set(firstRowTops).size, 1, `application-${width} must keep three columns`);
  assert.equal(await page.locator('.v16-launcher-tile__label').evaluateAll((labels) => labels.every((label) => {
    const style = getComputedStyle(label);
    return label.scrollHeight <= (Number.parseFloat(style.lineHeight) * 2) + 2;
  })), true, `application-${width} labels must fit within two lines`);
  const moduleColors = await page.locator('.v16-launcher-group .v16-launcher-tile__icon').evaluateAll((icons) => (
    new Set(icons.map((icon) => getComputedStyle(icon).color)).size
  ));
  assert.ok(moduleColors >= 6, 'six business modules must retain distinct restrained icon tones');
  assert.equal(await page.locator('.v16-launcher-tile__icon').evaluateAll((icons) => (
    icons.every((icon) => getComputedStyle(icon).backgroundImage.includes('linear-gradient'))
  )), true, 'launcher icon tiles must use tonal gradients');
}

async function assertWorkspace(page, width) {
  await assertTargets(page, '.v16-task-row, .v16-record, .v16-quick-action', `workspace-${width}`);
  assert.equal(await page.locator('.hero-card, .stats-grid, .stat-card').count(), 0, 'workspace must not restore hero/stat cards');
  assert.equal(await page.locator('.v16-workspace__section-title').allTextContents().then((items) => items.join('|')), '待处理|最近业务|常用操作');
  const styles = await page.evaluate(() => {
    const task = getComputedStyle(document.querySelector('.v16-task-row'));
    const list = getComputedStyle(document.querySelector('.v16-record-list'));
    const quick = getComputedStyle(document.querySelector('.v16-quick-action'));
    return {
      taskRadius: task.borderRadius,
      listRadius: list.borderRadius,
      quickBorder: quick.borderTopWidth,
      quickBackground: quick.backgroundColor,
    };
  });
  assert.equal(styles.taskRadius, '0px', 'pending task must be an enterprise row, not a rounded card');
  assert.equal(styles.listRadius, '0px', 'recent list must not be a rounded card');
  assert.equal(styles.quickBorder, '0px', 'quick actions must not use bordered cards');
  const quickRowTops = await page.locator('.v16-quick-action').evaluateAll((nodes) => (
    nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().top))
  ));
  assert.equal(new Set(quickRowTops).size, 1, `workspace-${width} must keep a three-column quick-action grid`);
  assert.equal(await page.locator('.v16-quick-action__icon').evaluateAll((icons) => (
    icons.every((icon) => getComputedStyle(icon).backgroundImage.includes('linear-gradient'))
  )), true, 'workspace shortcuts must share launcher icon gradients');
}

async function capture(token, surface, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('v16-launcher').waitFor();
  if (surface === 'workspace') {
    await page.getByTestId('bottom-tab-workspace').click();
    await page.getByTestId('dashboard-workspace').waitFor();
  }

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width ?? 0,
      shellLeft: shell?.left ?? 0,
      shellRight: shell ? innerWidth - shell.right : 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${surface}-${width} has horizontal overflow`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `${surface}-${width} exceeds 680px rail`);
  if (width === 680) assert.ok(Math.abs(metrics.shellLeft - metrics.shellRight) <= 1, `${surface}-680 is not centered`);
  await assertTargets(page, '.mobile-bottom-nav__item', `${surface}-${width} bottom navigation`);
  if (surface === 'application') await assertApplication(page, width);
  else await assertWorkspace(page, width);
  await assertBottomClear(page, surface);
  assert.deepEqual(errors, [], `${surface}-${width} browser/React errors`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  // Full-page captures otherwise paint a fixed bottom nav at the initial
  // viewport edge, which visually bisects a long launcher screenshot even
  // though the real scrolling surface passed the collision assertion above.
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  const file = join(outputDir, `${surface}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  results.push({ surface, width, ...metrics });
  await context.close();
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  for (const surface of ['application', 'workspace']) {
    for (const width of viewports) await capture(token, surface, width);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, screenshots, results }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
