// R-02 期间控制 operator 面浏览器验收（四档宽度 + 反结账原因强制）。
//
// Requirement: docs/requirements/platform.md §36.15.5（重开必须强制原因）
// Design:    docs/design/accounting-analytics.md §31.16.4、docs/design/finance-operations.md §28.30.3
//
// R-02 收紧了三个 operator 面：
//   * 会计期间（法定）—— 反结账必须提交原因；
//   * 经营会计 —— 反结账必须提交原因（既有 `accounting-analytics-responsive-uat.mjs` 已覆盖）；
//   * 资金管理 —— 新增的业务关账 / 重开工作面（既有 `finance-operations-responsive-uat.mjs` 已覆盖）。
//
// 本脚本覆盖**尚未被既有 UAT 覆盖**的那一处：会计期间的法定期间管理。
// 断言：
//   * 面板真实渲染（选中期间后出现「期间 YYYY-MM 详情」）；
//   * 四档宽度（320 / 390 / 430 / 680 CSS px）无整页横向滚动；
//   * 弹窗打开时同样无整页横向滚动；
//   * **R-02 的具体行为**：反结账弹窗必须出现「重开原因」输入框，且原因为空时「重开」按钮**不可点击**，
//     填写原因后**可点击**；
//   * 无浏览器控制台错误。
//
// Evidence is written to `docs/evidence/r02-period-control/` so the run is re-checkable.

import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-r02-period-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const results = [];
const viewports = [
  { width: 320, height: 900 },
  { width: 390, height: 900 },
  { width: 430, height: 900 },
  { width: 680, height: 900 },
];

// The fixture period is **closed**: the reopen action (and therefore the reason
// requirement) only exists for a closed period. The closure row is written
// directly because this script asserts the operator surface, not the close
// command (the close protocol has its own contract tests).
const FIXTURE_YEAR = 2021;
const FIXTURE_PERIOD = `${FIXTURE_YEAR}-03`;

function seedClosedPeriod() {
  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,closed_by,closed_at,created_at) VALUES('r02-uat-closure',?,?,?,'MONTH','CLOSED','user-admin',?,?)")
    .run(FIXTURE_PERIOD, FIXTURE_YEAR, 3, now, now);
}

async function run(id, label, action, work) {
  try {
    const evidence = await work();
    results.push({ id, label, status: 'PASS', action, evidence });
  } catch (error) {
    results.push({ id, label, status: 'FAIL', action, evidence: error.message });
  }
}

async function main() {
  seedClosedPeriod();
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

    const selectFixturePeriod = async () => {
      await page.goto(`${baseUrl}#accounting`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      // 会计期间是会计页的一个 tab（受 PERIOD_CLOSE_VIEW 权限控制）。
      const periodTab = page.getByRole('button', { name: '会计期间' });
      if (await periodTab.count()) {
        await periodTab.first().click();
        await page.waitForTimeout(300);
      }
      const yearInput = page.locator('input[type="number"]').first();
      await yearInput.fill(String(FIXTURE_YEAR));
      await yearInput.dispatchEvent('change');
      await page.waitForTimeout(500);
      const row = page.locator('tr', { hasText: FIXTURE_PERIOD }).first();
      await row.getByRole('button', { name: '查看' }).click();
      await page.waitForTimeout(400);
    };

    await run('R02-UAT-accounting-period', '会计期间（法定）工作面四档宽度闭环',
      '打开 #accounting，切换到夹具年度并选中已关闭期间，在 320 / 390 / 430 / 680 CSS px 下断言面板已渲染且无整页横向滚动',
      async () => {
        const observed = [];
        for (const viewport of viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await selectFixturePeriod();
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
          if (!evidence.bodyText.includes(`期间 ${FIXTURE_PERIOD} 详情`)) {
            throw new Error(`${viewport.width}px 未渲染期间详情：${evidence.bodyText.replace(/\s+/g, ' ').slice(0, 160)}`);
          }
          observed.push(`${viewport.width}px`);
        }
        await page.setViewportSize({ width: 390, height: 900 });
        return `widths ${observed.join(', ')}: 期间详情已渲染且无整页横向滚动`;
      });

    await run('R02-UAT-reopen-reason-required', '法定期间反结账必须提交原因',
      '打开反结账弹窗，断言「重开原因」输入框存在、且因为空时「重开」按钮不可点击，填写原因后可点击',
      async () => {
        await page.setViewportSize({ width: 390, height: 900 });
        await selectFixturePeriod();
        await page.getByRole('button', { name: '重开期间' }).click();
        await page.waitForTimeout(300);
        // 页面同时挂载了移动端与桌面端的弹层，只有可见的那个属于当前交互。
        const modal = page.locator('.modal-body:visible').first();
        const modalText = await modal.innerText();
        if (!modalText.includes('重开原因')) {
          throw new Error(`反结账弹窗缺少「重开原因」：${modalText.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
        const confirmButton = page.locator('.modal-footer:visible').getByRole('button', { name: '重开' }).first();
        if (!(await confirmButton.isDisabled())) {
          throw new Error('原因为空时「重开」按钮必须不可点击');
        }
        await modal.locator('textarea').fill('R-02 浏览器验收：受控反结账');
        await page.waitForTimeout(200);
        if (await confirmButton.isDisabled()) {
          throw new Error('填写原因后「重开」按钮必须可点击');
        }
        const evidence = await page.evaluate(() => {
          const docEl = document.documentElement;
          return { documentWidth: docEl.scrollWidth, viewportWidth: window.innerWidth };
        });
        if (evidence.documentWidth > evidence.viewportWidth + 1) {
          throw new Error(`弹窗打开时出现整页横向滚动：${evidence.documentWidth} > ${evidence.viewportWidth}`);
        }
        await page.locator('.modal-footer:visible').getByRole('button', { name: '取消' }).first().click();
        return '原因输入框存在；空原因时按钮禁用，填写后按钮可用；弹窗无横向溢出';
      });

    await run('R02-UAT-no-browser-errors', '浏览器控制台无错误',
      '整个流程中不得出现控制台错误或页面异常',
      async () => {
        if (browserErrors.length) {
          throw new Error(`浏览器错误 ${browserErrors.length} 条：${browserErrors.slice(0, 3).join(' | ').slice(0, 240)}`);
        }
        return 'BROWSER_ERRORS 0';
      });
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
    db.close();
  }

  console.log('=== R-02 Period Control Operator Surface Browser UAT ===');
  for (const result of results) {
    console.log(`${result.id} ${result.status} | ${result.label} | ${result.action} | ${result.evidence}`);
  }
  const failed = results.filter((result) => result.status !== 'PASS');
  const evidenceDir = resolve('docs/evidence/r02-period-control');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'r02-period-control-responsive-uat.json'), `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  rmSync(tempDir, { recursive: true, force: true });
  console.log(`TOTAL ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  if (failed.length) process.exitCode = 1;
}

await main();
