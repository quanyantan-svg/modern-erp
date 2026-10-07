import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/b3120-planning-frontend');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-b3120-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];
const routes = ['planned-orders', 'planner-workbench'];
let browser;

async function assertSurface(page, route, width) {
  const surface = page.getByTestId(`mobile-application-view-${route}`);
  await surface.waitFor({ timeout: 8000 });
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    surfaceWidth: document.querySelector('.planning-closure')?.getBoundingClientRect().width || 0,
    bodyText: document.body.innerText,
  }));
  assert.ok(metrics.bodyText.trim().length > 0, `${route}@${width}: empty surface`);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${route}@${width}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
  assert.ok(metrics.surfaceWidth <= Math.min(680, metrics.clientWidth) + 1, `${route}@${width}: surface exceeds rail`);
  const shortTargets = await surface.locator('button, a, input, select').evaluateAll((nodes) => nodes
    .filter((node) => getComputedStyle(node).display !== 'none')
    .map((node) => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height }))
    .filter(({ height }) => height > 0 && height < 43.5));
  assert.deepEqual(shortTargets, [], `${route}@${width}: targets below 44px ${JSON.stringify(shortTargets)}`);
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(login.status, 200, 'admin login must succeed');
  const token = (await login.json()).token;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(`${baseUrl}/#planned-orders`, { waitUntil: 'networkidle' });
    await assertSurface(page, 'planned-orders', width);
    await page.screenshot({ path: join(outputDir, `planned-orders-${width}.png`), fullPage: true });

    await page.goto(`${baseUrl}/#planner-workbench`, { waitUntil: 'networkidle' });
    await assertSurface(page, 'planner-workbench', width);
    await page.goBack({ waitUntil: 'networkidle' });
    await assertSurface(page, 'planned-orders', width);
    await page.goForward({ waitUntil: 'networkidle' });
    await assertSurface(page, 'planner-workbench', width);
    await page.screenshot({ path: join(outputDir, `planner-workbench-${width}.png`), fullPage: true });

    assert.deepEqual(errors, [], `planning@${width}: browser errors ${errors.join(' | ')}`);
    await context.close();
    console.log(`PASS planning routes @ ${width}px`);
  }
  console.log('B3120 PLANNING FRONTEND RESPONSIVE ACCEPTANCE = PASS');
} finally {
  await browser?.close().catch(() => {});
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
