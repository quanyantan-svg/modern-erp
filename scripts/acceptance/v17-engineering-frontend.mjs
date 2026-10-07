import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v17-engineering-frontend');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-engineering-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];
const routes = ['engineering-reference', 'boms', 'engineering-substitute', 'engineering-change'];
let browser;

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(login.status, 200, 'admin login must succeed');
  const token = (await login.json()).token;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' });
      const surface = page.getByTestId(`mobile-application-view-${route}`);
      await surface.waitFor({ timeout: 8000 });
      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyText: document.body.innerText,
      }));
      assert.ok(metrics.bodyText.trim().length > 0, `${route}@${width}: empty surface`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${route}@${width}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
      assert.deepEqual(errors, [], `${route}@${width}: browser errors`);
      await page.screenshot({ path: join(outputDir, `${route}-${width}.png`), fullPage: true });
      await context.close();
      console.log(`PASS ${route} @ ${width}px`);
    }
  }
  console.log('V17 ENGINEERING FRONTEND RESPONSIVE ACCEPTANCE = PASS');
} finally {
  await browser?.close().catch(() => {});
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
