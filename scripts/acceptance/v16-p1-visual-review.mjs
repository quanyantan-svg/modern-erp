import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p1-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p1-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [320, 390, 430, 680];
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
  assert.equal(response.status, 200, 'visual fixture login must succeed');
  return (await response.json()).token;
}

async function assertTouchTargets(page, selector, label) {
  const targets = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: node.textContent?.trim() };
  }));
  assert.ok(targets.length > 0, `${label} must render at least one touch target`);
  for (const target of targets) {
    assert.ok(target.width >= 44 && target.height >= 44, `${label} target is below 44px: ${JSON.stringify(target)}`);
  }
}

async function assertFinalActionClear(page, surface) {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(80);
  const result = await page.evaluate((surfaceName) => {
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    const selector = surfaceName === 'application'
      ? '.v16-launcher button'
      : '.v16-workspace button';
    const buttons = [...document.querySelectorAll(selector)].filter((button) => button.offsetParent !== null);
    const last = buttons.at(-1)?.getBoundingClientRect();
    return { navTop: nav?.top ?? 0, lastBottom: last?.bottom ?? 0 };
  }, surface);
  assert.ok(result.lastBottom <= result.navTop + 1, `${surface} final action overlaps bottom navigation`);
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
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${surface}-${width} has page-level horizontal overflow`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `${surface}-${width} exceeds the 680px application rail`);
  if (width === 680) assert.ok(Math.abs(metrics.shellLeft - metrics.shellRight) <= 1, `${surface}-680 is not centered`);

  await assertTouchTargets(page, '.mobile-bottom-nav__item', `${surface}-${width} bottom navigation`);
  if (surface === 'application') {
    await assertTouchTargets(page, '.v16-launcher-tile', `application-${width} tile`);
    if (width === 390) {
      const columns = await page.locator('[data-testid="v16-launcher-group-master-data"] .v16-launcher-tile').evaluateAll((nodes) => (
        new Set(nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().top))).size
      ));
      assert.equal(columns, 1, 'application-390 must visibly retain three tiles on the first grid row');
    }
  } else {
    assert.equal(await page.locator('.hero-card, .stats-grid, .stat-card').count(), 0, 'workspace must not render hero/card-wall presentation');
  }

  await assertFinalActionClear(page, surface);
  assert.deepEqual(errors, [], `${surface}-${width} browser/React errors`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
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
