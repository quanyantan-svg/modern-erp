// M1C-WP6 — 委外加工 / 寻源与定价 移动端有限修复的真实浏览器验收。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13 MC-REQ-14
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §7
//     （src/pages/outsourcing.jsx、src/pages/sourcing-pricing.jsx：10 处调用点
//      改为 api(path, options)）
//
// 本脚本只验证既有工作面的可执行性与响应式表现，不重做 MobileShell、导航或
// 视觉体系，也不改变业务术语、API 合同、权限、状态机或库存/会计事实。
// 它使用一次性临时 SQLite 与本地构建产物 dist/，不连接任何项目数据库或 MySQL。

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m1c-wp6-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));

const VIEWPORTS = [
  { width: 320, height: 800, label: '320' },
  { width: 390, height: 844, label: '390' },
  { width: 430, height: 900, label: '430' },
  { width: 680, height: 900, label: '680' },
];

// MC-REQ-14 / Active Design §7 指定的两张既有工作面。
const SURFACES = [
  { route: 'outsourcing', label: '委外加工' },
  { route: 'sourcing-pricing', label: '寻源与定价' },
];

// 真实角色主体：委外业务员持有 OUTSOURCING_MANAGE，必须能打开委外工作面。
const SUBJECTS = [
  { username: 'admin', password: 'admin123', label: 'admin' },
  { username: 'outsourcing', password: 'outsourcing123', label: '委外业务员' },
];

const results = [];

async function loginToken(page, username, password) {
  const token = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    return payload.token || '';
  }, { username, password });
  if (!token) throw new Error(`登录失败：${username}`);
  return token;
}

async function checkSurface(page, baseUrl, viewport, surface) {
  const browserErrors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`); };
  const onPageError = (err) => browserErrors.push(`pageerror: ${err.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${baseUrl}#${surface.route}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(600);
    const evidence = await page.evaluate(() => {
      const docEl = document.documentElement;
      const bodyText = (document.body?.innerText || '').trim();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: docEl.scrollWidth,
        overflow: docEl.scrollWidth > window.innerWidth + 1,
        // api.get / api.post 不存在：页面若仍有该调用会抛 TypeError。
        typeError: /api\.(get|post)\b/.test(bodyText) || false,
        bodyLength: bodyText.length,
        hasFatalErrorText: /服务器内部错误|TypeError|Cannot read propert/i.test(bodyText),
      };
    });
    return { ok: true, evidence, errors: browserErrors };
  } catch (error) {
    return { ok: false, error: error.message, errors: browserErrors };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });

  try {
    for (const subject of SUBJECTS) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const token = await loginToken(page, subject.username, subject.password);
      await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);

      for (const viewport of VIEWPORTS) {
        for (const surface of SURFACES) {
          const result = await checkSurface(page, baseUrl, viewport, surface);
          const passed = result.ok
            && !result.evidence.overflow
            && !result.evidence.typeError
            && !result.evidence.hasFatalErrorText
            && result.evidence.bodyLength > 0
            && result.errors.length === 0;
          const detail = result.ok
            ? `w=${result.evidence.documentWidth}/${result.evidence.viewportWidth} overflow=${result.evidence.overflow} typeError=${result.evidence.typeError} errors=${result.errors.length}`
            : `error: ${result.error} errors=${JSON.stringify(result.errors).slice(0, 160)}`;
          console.log(`${passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${subject.label} ${viewport.label}px ${surface.route} :: ${detail}`);
          if (!passed && result.errors.length) console.log(`      errors: ${JSON.stringify(result.errors).slice(0, 400)}`);
          results.push({ subject: subject.label, viewport: viewport.label, surface: surface.route, passed, evidence: result.evidence || result.error, errors: result.errors });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const pass = results.filter((r) => r.passed).length;
  const fail = results.filter((r) => !r.passed).length;
  console.log(`\n=== M1C-WP6 — 委外 / 寻源 移动端有限修复 UAT ===\nPASS=${pass} FAIL=${fail} TOTAL=${results.length}`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of results.filter((r) => !r.passed)) console.log(`  ${f.subject} ${f.viewport}px ${f.surface}: ${JSON.stringify(f.evidence).slice(0, 240)}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
