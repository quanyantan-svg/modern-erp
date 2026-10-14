import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const viewports = [320, 390, 430, 680];
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-wave2-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sales', password: 'sales123' }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const results = [];
  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: 'modern_erp_token', value: token });
    await page.goto(`${baseUrl}#sales-pricing`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="sales-pricing-page"]').waitFor({ timeout: 12000 });
    const metrics = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('.sales-pricing-page button,.sales-pricing-page input,.sales-pricing-page select')];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        pageRight: innerWidth - document.querySelector('.sales-pricing-page').getBoundingClientRect().right,
        minControlHeight: controls.length ? Math.min(...controls.map((control) => control.getBoundingClientRect().height)) : 0,
      };
    });
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px page has horizontal overflow`);
    assert.ok(metrics.pageRight >= 0, `${width}px page escapes viewport`);
    assert.ok(metrics.minControlHeight >= 44, `${width}px contains a touch target below 44px`);
    assert.equal(await page.getByRole('heading', { name: '销售定价与订单时折扣' }).count(), 1);
    results.push({ width, ...metrics });
    await context.close();
  }
  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
