// M1C-WP6 / M1C-WP7-A — 委外加工 / 寻源与定价 移动端浏览器验收。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13 MC-REQ-14
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §7、§13.1（M1C-G05）
//
// 本脚本只验证既有工作面的可执行性与响应式表现，不重做 MobileShell、导航或
// 视觉体系，也不改变业务术语、API 合同、权限、状态机或库存/会计事实。
// 它使用一次性临时 SQLite 与本地构建产物 dist/，不连接任何项目数据库或 MySQL。
//
// M1C-WP7-A 加固（2026-11-03）：旧版本的三处断言全部是**空断言**，必须先修：
//   1) 旧版本在写入 localStorage 后没有 reload，SPA 从未离开登录页 —— 被测的
//      其实是登录页，不是委外 / 寻源工作面。本版本在注入 token 后 reload，
//      并断言目标工作面确实渲染（不接受登录页或「应用暂时无法打开」）。
//   2) 旧版本只断言「没有 api.get/api.post TypeError」，工作面打不开时该断言
//      依然成立。本版本额外断言工作面真实渲染，并逐工作面探测服务端 RBAC 状态。
//   3) 旧版本没有覆盖「无权用户 → 服务端 403 + 页面级处理」。本版本新增
//      销售专员主体与 API 状态探测。
//
// 脚本退出码：存在失败项时返回 1，并逐条打印失败明细。

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
// apiPath 是该工作面自身调用的读接口 —— 用它探测服务端的来源级 RBAC 判定。
const SURFACES = [
  {
    route: 'outsourcing', label: '委外加工', apiPath: '/api/procurement/outsourcing/orders',
    mutationPath: '/api/procurement/outsourcing/orders',
  },
  {
    route: 'sourcing-pricing', label: '寻源与定价', apiPath: '/api/procurement/source-entries',
    mutationPath: '/api/procurement/sourcing-decisions',
  },
];

// 真实角色主体：
//   admin          —— 拥有全部权限
//   委外业务员      —— 持有 OUTSOURCING_MANAGE；**不**持有 PROCUREMENT_CONFIG_VIEW，
//                      因此寻源与定价的读接口必须由服务端 403
//   销售专员        —— 不持有任何采购 / 委外权限，两个工作面都必须由服务端 403
const SUBJECTS = [
  {
    username: 'admin', password: 'admin123', label: 'admin',
    expectApiStatus: { outsourcing: 200, 'sourcing-pricing': 200 },
  },
  {
    username: 'outsourcing', password: 'outsourcing123', label: '委外业务员',
    expectApiStatus: { outsourcing: 200, 'sourcing-pricing': 403 },
  },
  {
    username: 'sales', password: 'sales123', label: '销售专员',
    expectApiStatus: { outsourcing: 403, 'sourcing-pricing': 403 },
  },
];

// 工作面必须真的打开：登录页或「应用暂时无法打开」都不算通过。
const SURFACE_NOT_OPEN_MARKERS = ['登录', '应用暂时无法打开', '请返回应用列表后重试'];

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

// 用页面自身的 token 探测服务端对该工作面读接口的 RBAC 判定。
async function probeApiStatus(page, apiPath) {
  return page.evaluate(async (path) => {
    const token = localStorage.getItem('modern_erp_token') || '';
    try {
      const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return response.status;
    } catch {
      return 0;
    }
  }, apiPath);
}

async function probeMutationStatus(page, surface) {
  return page.evaluate(async ({ route, path }) => {
    const token = localStorage.getItem('modern_erp_token') || '';
    const body = route === 'outsourcing'
      ? { supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 1, unit: 'EA' }
      : { sourceType: 'PR', sourceId: 'DENIED-PROBE', productId: 'product-001', quantity: 1 };
    const response = await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  }, { route: surface.route, path: surface.mutationPath });
}

async function exerciseAuthorizedSurface(page, surface, performMutation) {
  if (surface.route === 'sourcing-pricing') {
    if (await page.getByRole('button', { name: '模拟寻源分配' }).count()) throw new Error('危险演示写入按钮仍可见');
    const posts = [];
    const onRequest = (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/procurement/sourcing-decisions') posts.push(request.url());
    };
    page.on('request', onRequest);
    try {
      for (const tab of ['Quota', 'Price List', 'Pricing Discount', 'Source List']) {
        await page.locator('select').selectOption({ label: tab });
        await page.locator('.compact-record-list').waitFor({ state: 'attached' });
      }
    } finally {
      page.off('request', onRequest);
    }
    if (posts.length) throw new Error('只读查询触发了正式寻源写入');
    return { legalAction: '四个只读页签可切换', businessError: '危险演示入口不存在' };
  }

  const create = page.getByRole('button', { name: '新建委外订单' });
  await create.waitFor({ state: 'visible' });
  if (await create.isDisabled()) throw new Error('新建委外订单动作不可用');
  if (!performMutation) return { legalAction: 'button visible and enabled', businessError: 'covered at 320px' };
  await create.click();
  let dialog = page.getByRole('dialog', { name: '新建委外订单' });
  await dialog.getByLabel('供应商 ID').fill('supplier-does-not-exist');
  await dialog.getByLabel('产品 ID').fill('product-001');
  const invalidResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/procurement/outsourcing/orders') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建' }).click();
  const invalidResponse = await invalidResponsePromise;
  if (invalidResponse.status() !== 409) throw new Error(`非法供应商业务错误返回 ${invalidResponse.status()}，期望 409`);
  const disclosure = dialog.locator('.help-disclosure');
  await disclosure.waitFor({ state: 'visible' });
  if (!(await disclosure.textContent())?.trim()) throw new Error('委外表单业务错误未展示');
  // 业务错误后直接纠正同一表单，证明页面可恢复，而不是靠关闭页面绕过错误。
  await dialog.getByLabel('供应商 ID').fill('supplier-001');
  await dialog.getByLabel('产品 ID').fill('product-001');
  await dialog.getByLabel('数量').fill('1');
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/procurement/outsourcing/orders') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建' }).click();
  const createResponse = await createResponsePromise;
  if (createResponse.status() !== 201) throw new Error(`合法委外创建返回 ${createResponse.status()}，期望 201`);
  await dialog.waitFor({ state: 'detached' });

  const newestOrder = page.locator('[data-testid="outsourcing-order-list"] .compact-record__open').first();
  await newestOrder.waitFor({ state: 'visible' });
  await newestOrder.click();
  const detail = page.getByRole('dialog', { name: /委外订单 / });
  await detail.getByRole('button', { name: '确认计划' }).waitFor({ state: 'visible' });
  await detail.getByRole('button', { name: '取消' }).waitFor({ state: 'visible' });
  const transitionResponsePromise = page.waitForResponse((response) => /\/api\/procurement\/outsourcing\/orders\/[^/]+\/transition$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await detail.getByRole('button', { name: '确认计划' }).click();
  const transitionResponse = await transitionResponsePromise;
  if (transitionResponse.status() !== 200) throw new Error(`委外状态推进返回 ${transitionResponse.status()}，期望 200`);
  await detail.getByRole('button', { name: '下达' }).waitFor({ state: 'visible' });
  await detail.getByRole('button', { name: '取消' }).waitFor({ state: 'visible' });
  const stateContext = await detail.locator('.page-header__context').textContent();
  if (!stateContext?.includes('已确认 / 数量 1')) throw new Error(`委外状态推进后 DOM 未更新：${stateContext || '缺失'}`);
  return { legalAction: `create ${createResponse.status()} + transition ${transitionResponse.status()}`, businessError: `invalid supplier ${invalidResponse.status()} displayed` };
}

async function checkSurface(page, baseUrl, viewport, surface, expectedStatus, performMutation) {
  const browserErrors = [];
  const pageReads = [];
  const onConsole = (msg) => { if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`); };
  const onPageError = (err) => browserErrors.push(`pageerror: ${err.message}`);
  const onResponse = (response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === 'GET' && path === surface.apiPath) pageReads.push(response.status());
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${baseUrl}#${surface.route}`, { waitUntil: 'networkidle', timeout: 20000 });
    // 关键：注入 token 后必须 reload，否则 SPA 仍停在登录页，被测对象错误。
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(800);
    const evidence = await page.evaluate(({ expectedLabel, authorized }) => {
      const docEl = document.documentElement;
      const bodyText = (document.body?.innerText || '').trim();
      const markers = ['登录', '应用暂时无法打开', '请返回应用列表后重试'];
      return {
        viewportWidth: window.innerWidth,
        documentWidth: docEl.scrollWidth,
        overflow: docEl.scrollWidth > window.innerWidth + 1,
        // api.get / api.post 不存在：页面若仍有该调用会抛 TypeError。
        typeError: /api\.(get|post)\b/.test(bodyText) || false,
        bodyLength: bodyText.length,
        bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 160),
        hasFatalErrorText: /服务器内部错误|TypeError|Cannot read propert/i.test(bodyText),
        // 工作面是否真的打开
        notOpenMarkers: markers.filter((marker) => bodyText.includes(marker)),
        // 页面级错误展示：负向 HelpDisclosure 的正文
        errorDisclosureText: [...document.querySelectorAll('.help-disclosure')]
          .map((el) => el.textContent.trim()).join(' | '),
        listCount: document.querySelectorAll('.compact-record-list').length,
        actionButtonCount: document.querySelectorAll('.business-action-bar button').length,
        routeTitle: document.querySelector('.page-header__route-context')?.textContent?.trim() || '',
        permissionDenied: bodyText.includes('无权访问') && bodyText.includes('当前账号没有打开该应用的权限。'),
        expectedLabelPresent: bodyText.includes(expectedLabel),
      };
    }, { expectedLabel: surface.label, authorized: expectedStatus === 200 });
    const applicationReadStatuses = [...pageReads];
    const apiStatus = await probeApiStatus(page, surface.apiPath);
    let mutationStatus = null;
    let actionEvidence = null;
    if (expectedStatus === 200) {
      actionEvidence = await exerciseAuthorizedSurface(page, surface, performMutation);
    } else {
      mutationStatus = await probeMutationStatus(page, surface);
    }
    // 服务端 403 是预期的 RBAC 判定，浏览器会记录一条资源加载失败 —— 它不是缺陷。
    // 委外表单还会有一条被明确断言为 409 且已展示给用户的负向业务请求。
    const defects = browserErrors.filter((message) => !/Failed to load resource.*\b(403|409)\b/.test(message));
    return { ok: true, evidence, apiStatus, mutationStatus, actionEvidence, applicationReadStatuses, errors: defects, allErrors: browserErrors };
  } catch (error) {
    return { ok: false, error: error.message, errors: browserErrors, apiStatus: 0 };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

async function seedOutsourcingOrder(token) {
  const today = new Date().toISOString().slice(0, 10);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  await fetch(`http://127.0.0.1:${server.address().port}/api/suppliers/supplier-001/profile`, {
    method: 'PATCH', headers,
    body: JSON.stringify({
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: today, qualificationValidTo: '2099-12-31', supplierWipWarehouseId: 'warehouse-002',
    }),
  });
  const created = await fetch(`http://127.0.0.1:${server.address().port}/api/procurement/outsourcing/orders`, {
    method: 'POST', headers,
    body: JSON.stringify({ supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, unit: 'EA', businessDate: today }),
  });
  return created.status;
}

async function seedSourcing(token) {
  const today = new Date().toISOString().slice(0, 10);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const source = await fetch(`http://127.0.0.1:${server.address().port}/api/procurement/source-entries`, {
    method: 'POST', headers,
    body: JSON.stringify({ supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE', enabled: true, effectiveFrom: today }),
  });
  const quota = await fetch(`http://127.0.0.1:${server.address().port}/api/procurement/quotas`, {
    method: 'POST', headers,
    body: JSON.stringify({ supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE', proportion: { num: 1, den: 1 }, effectiveFrom: today }),
  });
  return { source: source.status, quota: quota.status };
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });

  try {
    // 先用生产 API 造一条真实委外订单，保证工作面列表有真实内容可渲染。
    const seedToken = await (async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      return (await response.json()).token;
    })();
    console.log(`[seed] 生产 API 创建委外订单状态 = ${await seedOutsourcingOrder(seedToken)}`);
    const sourcingSeed = await seedSourcing(seedToken);
    console.log(`[seed] 生产 API 创建寻源/配额状态 = ${sourcingSeed.source}/${sourcingSeed.quota}`);

    for (const subject of SUBJECTS) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const token = await loginToken(page, subject.username, subject.password);
      await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);

      for (const viewport of VIEWPORTS) {
        for (const surface of SURFACES) {
          const expectedStatus = subject.expectApiStatus[surface.route];
          const result = await checkSurface(page, baseUrl, viewport, surface, expectedStatus, viewport.width === 320);
          const failures = [];
          if (!result.ok) {
            failures.push(`检查异常：${result.error}`);
          } else {
            const e = result.evidence;
            if (e.overflow) failures.push('出现横向溢出');
            if (e.typeError) failures.push('出现 api.get/api.post TypeError');
            if (e.hasFatalErrorText) failures.push('出现致命错误文本');
            if (e.bodyLength === 0) failures.push('页面正文为空');
            if (e.notOpenMarkers.length) failures.push(`工作面未真正打开（命中 ${e.notOpenMarkers.join('/')}）`);
            if (result.errors.length) failures.push(`浏览器错误 ${result.errors.length} 条`);
            if (result.apiStatus !== expectedStatus) {
              failures.push(`服务端 RBAC 判定为 ${result.apiStatus}，期望 ${expectedStatus}`);
            }
            if (expectedStatus === 200) {
              if (e.routeTitle !== surface.label) failures.push(`目标工作面 DOM 未渲染（标题 ${e.routeTitle || '缺失'}）`);
              if (!result.applicationReadStatuses.includes(200)) failures.push(`页面自身未完成真实 GET（${result.applicationReadStatuses.join('/') || '无'}）`);
              if (!result.actionEvidence) failures.push('授权用户未完成合法动作');
              if (surface.route === 'outsourcing' && e.listCount < 1) failures.push('委外真实订单列表未渲染');
              if (surface.route === 'sourcing-pricing' && e.listCount < 1) failures.push('寻源真实货源列表未渲染');
            } else {
              if (!e.permissionDenied) failures.push('无权用户未获得页面级无权处理');
              if (result.mutationStatus !== 403) failures.push(`无权写操作返回 ${result.mutationStatus}，期望 403`);
              if (e.routeTitle || e.actionButtonCount) failures.push('无权用户仍可见目标工作面或动作按钮');
            }
          }
          const passed = failures.length === 0;
          const detail = result.ok
            ? `w=${result.evidence.documentWidth}/${result.evidence.viewportWidth} overflow=${result.evidence.overflow} typeError=${result.evidence.typeError} api=${result.apiStatus}(期望${expectedStatus}) pageGET=[${result.applicationReadStatuses.join('/')}] mutation=${result.mutationStatus ?? '-'} title=${result.evidence.routeTitle || '-'} lists=${result.evidence.listCount} action=${JSON.stringify(result.actionEvidence)} errors=${result.errors.length}`
            : `error: ${result.error} errors=${JSON.stringify(result.errors).slice(0, 160)}`;
          console.log(`${passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${subject.label} ${viewport.label}px ${surface.route} :: ${detail}`);
          if (!passed) {
            failures.forEach((f) => console.log(`      ✗ ${f}`));
            if (result.errors?.length) console.log(`      errors: ${JSON.stringify(result.errors).slice(0, 400)}`);
          }
          results.push({
            subject: subject.label, viewport: viewport.label, surface: surface.route, passed,
            apiStatus: result.apiStatus, expectedStatus, failures,
            evidence: result.evidence || result.error, errors: result.errors,
          });
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
  console.log(`\n=== M1C-G05 — 委外 / 寻源 移动端浏览器验收 ===\nPASS=${pass} FAIL=${fail} TOTAL=${results.length}`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`  ${f.subject} ${f.viewport}px ${f.surface}: ${f.failures.join('; ')}`);
      console.log(`      evidence: ${JSON.stringify(f.evidence).slice(0, 300)}`);
      if (f.errors?.length) console.log(`      errors: ${JSON.stringify(f.errors).slice(0, 400)}`);
    }
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
