import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-finance-responsive-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 680, height: 900 }];
const surfaces = ['accounts-receivable', 'payment-collections', 'accounts-payable', 'payment-disbursements', 'finance-invoices', 'finance-treasury'];
const results = [];

async function main() {
  let browser;
  try {
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const token = await page.evaluate(async () => {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
      return (await response.json()).token;
    });
    await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);

    for (const viewport of viewports) for (const route of surfaces) {
      const errors = [];
      const consoleHandler = (message) => { if (message.type() === 'error') errors.push(message.text()); };
      const pageErrorHandler = (error) => errors.push(error.message);
      page.on('console', consoleHandler); page.on('pageerror', pageErrorHandler);
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}#${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(250);
      const evidence = await page.evaluate(() => {
        const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const controls = [...document.querySelectorAll('button, a, input, select')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
        });
        const undersized = controls.filter((element) => {
          const rect = element.getBoundingClientRect();
          return (element.matches('button, a.primary, a.finance-workstream') && rect.height < 44) || rect.width > window.innerWidth + 2;
        }).map((element) => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 32), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) }));
        return { viewportWidth: window.innerWidth, documentWidth, overflow: documentWidth > window.innerWidth + 2, undersized };
      });
      const passed = !evidence.overflow && evidence.undersized.length === 0 && errors.length === 0;
      results.push({ route, width: viewport.width, passed, evidence, errors });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${viewport.width}px ${route} :: width=${evidence.documentWidth}/${evidence.viewportWidth} undersized=${evidence.undersized.length} errors=${errors.length}`);
      page.off('console', consoleHandler); page.off('pageerror', pageErrorHandler);
    }
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`FINANCE_RESPONSIVE_UAT ${passed}/${results.length} PASS`);
  for (const failure of results.filter((result) => !result.passed)) console.log(JSON.stringify(failure));
  if (passed !== 24) process.exitCode = 1;
}

await main();
