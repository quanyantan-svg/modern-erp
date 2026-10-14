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
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-wave1-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sales', password: 'sales123' }),
  });
  assert.equal(response.status, 200); return (await response.json()).token;
}

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login(baseUrl);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const results = [];
  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: 'modern_erp_token', value: token });
    await page.goto(`${baseUrl}#customers`, { waitUntil: 'networkidle' });
    const action = page.getByRole('button', { name: '商业资料' }).first();
    await action.waitFor({ timeout: 12000 });
    await action.click();
    await page.locator('.customer-commercial-panel').waitFor({ timeout: 12000 });
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector('.modal')?.getBoundingClientRect();
      const panel = document.querySelector('.customer-commercial-panel')?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        modalLeft: modal?.left ?? -1,
        modalRight: modal ? innerWidth - modal.right : -1,
        modalWidth: modal?.width ?? 0,
        panelWidth: panel?.width ?? 0,
      };
    });
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px page has horizontal overflow`);
    assert.ok(metrics.modalLeft >= 0 && metrics.modalRight >= 0, `${width}px commercial panel escapes viewport`);
    assert.ok(metrics.panelWidth <= metrics.modalWidth, `${width}px commercial content exceeds modal`);
    assert.ok(await page.getByText('商业扩展', { exact: true }).count(), `${width}px extension section missing`);
    assert.ok(await page.getByText('客户物料对应', { exact: true }).count(), `${width}px xref section missing`);
    assert.ok(await page.getByRole('button', { name: '保存商业扩展' }).count(), `${width}px maintenance action missing`);
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
