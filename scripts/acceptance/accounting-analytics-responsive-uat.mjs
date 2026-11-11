// Accounting & Analytics — AA 域工作面浏览器验收（四档宽度）。
//
// Requirement: docs/requirements/accounting-analytics.md §35.8.1 第 7 项
// Design:    docs/design/accounting-analytics.md §31.4 / §31.5 / §31.7
//
// The acceptance covers the work surfaces this domain added or reworked —
// 固定资产（AA-W5）、会计事件（AA-W1）、业务财务对账（AA-W1）、报表平台（AA-W4）、
// 存货核算（AA-W6）、经营会计（AA-W7）—— at 320 / 390 / 430 / 680 CSS px:
//
//   - the surface actually renders (the expected label is present);
//   - there is no whole-page horizontal overflow;
//   - no fatal error text is shown.
//
// Evidence is written to `docs/evidence/accounting-analytics/` so the run is
// re-checkable.

import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-aa-responsive-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const results = [];
const viewports = [
  { width: 320, height: 900 },
  { width: 390, height: 900 },
  { width: 430, height: 900 },
  { width: 680, height: 900 },
];

const SURFACES = [
  { route: 'fixed-assets', label: '固定资产', marker: '资产卡片' },
  { route: 'accounting-events', label: '会计事件', marker: '会计事件台账' },
  { route: 'accounting-reconciliation', label: '业务财务对账', marker: '业务财务对账' },
  { route: 'accounting-reports', label: '报表平台', marker: '报表平台' },
  { route: 'accounting-costing', label: '存货核算', marker: '存货核算' },
  { route: 'management-accounting', label: '经营会计', marker: '经营会计' },
];

async function run(id, label, action, work) {
  try {
    const evidence = await work();
    results.push({ id, label, status: 'PASS', action, evidence });
  } catch (error) {
    results.push({ id, label, status: 'FAIL', action, evidence: error.message });
  }
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('input[autocomplete="username"]').fill('admin');
    await page.locator('input[autocomplete="current-password"]').fill('admin123');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForLoadState('networkidle');

    for (const surface of SURFACES) {
      await run(`AA-UAT-${surface.route}`, `${surface.label}工作面四档宽度闭环`,
        `打开 #${surface.route}，在 320 / 390 / 430 / 680 CSS px 下断言面板已渲染且无整页横向滚动`,
        async () => {
          const observed = [];
          for (const viewport of viewports) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.goto(`${baseUrl}#${surface.route}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(400);
            const evidence = await page.evaluate(() => {
              const docEl = document.documentElement;
              const bodyText = (document.body?.innerText || '').trim();
              return {
                documentWidth: docEl.scrollWidth,
                viewportWidth: window.innerWidth,
                bodyText,
                fatal: /服务器内部错误|TypeError|Cannot read propert/i.test(bodyText),
              };
            });
            if (evidence.documentWidth > evidence.viewportWidth + 1) {
              throw new Error(`${viewport.width}px 出现整页横向滚动：${evidence.documentWidth} > ${evidence.viewportWidth}`);
            }
            if (evidence.fatal) {
              throw new Error(`${viewport.width}px 出现致命错误文本：${evidence.bodyText.replace(/\s+/g, ' ').slice(0, 160)}`);
            }
            if (!evidence.bodyText.includes(surface.marker)) {
              throw new Error(`${viewport.width}px 未渲染「${surface.marker}」：${evidence.bodyText.replace(/\s+/g, ' ').slice(0, 160)}`);
            }
            observed.push(`${viewport.width}px`);
          }
          await page.setViewportSize({ width: 390, height: 900 });
          return `widths ${observed.join(', ')}: 工作面已渲染且无整页横向滚动`;
        });
    }

    console.log('=== Accounting & Analytics Responsive Browser UAT ===');
    for (const result of results) {
      console.log(`${result.id} ${result.status} | ${result.label} | ${result.action} | ${result.evidence}`);
    }
    console.log(`TOTAL ${results.filter((row) => row.status === 'PASS').length} PASS / ${results.filter((row) => row.status === 'FAIL').length} FAIL`);
    console.log(`BROWSER_ERRORS ${browserErrors.length}`);
    if (browserErrors.length) console.log(browserErrors.slice(0, 10).join('\n'));

    const evidenceDir = resolve('docs/evidence/accounting-analytics');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, 'responsive-uat.json'), JSON.stringify({
      capturedAt: new Date().toISOString(),
      results,
      browserErrors,
    }, null, 2), 'utf8');

    if (results.some((row) => row.status === 'FAIL')) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await new Promise((done) => server.close(done));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
