// Platform 域七个 operator 工作面的浏览器 UAT（Responsive + 非空洞）。
//
// 设计来源：docs/design/platform.md §32.1.2、§32.1.3；Requirement §36.12.2。
//
// 与既有 UAT 脚本同构（playwright-core + 本机 Edge），并保留**防空壳**判定：
//   1. 屏根的 canonical data-testid 必须存在且已绘制 —— 没渲染出来的屏不可能通过；
//   2. 必须画出**真实数据行**，或画出**指名原因的显式空态** —— 两者都没有即失败；
//   3. 权限拒绝态 / 错误态一律算失败（不是空态）；
//   4. 320 / 390 / 430 / 680 四档宽度都不得出现横向溢出；
//   5. 可点击目标的两个轴都不得低于 44 CSS px。
//
// 夹具在临时库中经**真实 API**建立（模板 → 版本 → 发布 → 绑定 → 启动实例），
// 因此「我的流程任务」与「流程监控」有真实数据行，而不是空壳。

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { startWorkflowInstance } from '../../server/modules/platform-workflow-engine.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const dbTempDir = mkdtempSync(join(tmpdir(), 'modern-erp-platform-workfaces-'));
const db = createDatabase(join(dbTempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 680, height: 900 },
];
const MIN_TARGET = 44;

const WORKFLOW_DEFINITION = {
  entry: 'start',
  nodes: [
    {
      key: 'start',
      type: 'APPROVAL',
      participants: [{ type: 'USER', value: 'user-admin' }],
      onApprove: { next: 'END' },
      onReject: { next: 'END' },
    },
  ],
};

const surfaces = [
  { key: 'sod-rules', label: '职责分离规则', testid: 'platform-sod-rules-page' },
  { key: 'organizations', label: '组织与作用域', testid: 'platform-organizations-page' },
  { key: 'numbering', label: '编号规则', testid: 'platform-numbering-page' },
  { key: 'workflow-designer', label: '流程设计', testid: 'platform-workflow-designer-page' },
  { key: 'workflow-bindings', label: '流程绑定', testid: 'platform-workflow-bindings-page' },
  { key: 'workflow-tasks', label: '我的流程任务', testid: 'platform-workflow-tasks-page' },
  { key: 'workflow-monitor', label: '流程监控', testid: 'platform-workflow-monitor-page' },
  { key: 'notifications', label: '通知中心', testid: 'platform-notifications-page' },
].map((surface) => ({
  ...surface,
  rowSelector: ['.platform-ops__card'],
  emptySelector: ['.platform-ops__empty', '.canonical-empty-state'],
}));

const results = [];
let failures = 0;

async function apiCall(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} → ${response.status} ${JSON.stringify(data)}`);
  return data;
}

/** 建立夹具：组织、作用域、流程模板 / 版本 / 发布 / 绑定 / 实例 / 任务。 */
async function seedFixtures(baseUrl, token) {
  await apiCall(baseUrl, token, '/api/platform/organizations', {
    method: 'POST',
    body: { code: 'ORG-UAT', name: 'UAT 法人实体', orgType: 'LEGAL_ENTITY' },
  });
  const scopes = await apiCall(baseUrl, token, '/api/platform/organization-scopes', {
    method: 'POST',
    body: { scopeCode: 'UAT-SCOPE', name: 'UAT 作用域', bindingMode: 'MULTI' },
  });

  const template = await apiCall(baseUrl, token, '/api/platform/workflow-templates', {
    method: 'POST',
    body: {
      code: 'WF-UAT', name: 'UAT 流程模板', documentType: 'SALES_ORDER', definition: WORKFLOW_DEFINITION,
    },
  });
  const version = await apiCall(baseUrl, token, `/api/platform/workflow-templates/${template.template.id}/versions`, {
    method: 'POST',
    body: { definition: WORKFLOW_DEFINITION, changeNote: 'UAT 夹具版本' },
  });
  await apiCall(baseUrl, token, `/api/platform/workflow-versions/${version.version.id}/publish`, { method: 'POST', body: {} });
  await apiCall(baseUrl, token, '/api/platform/workflow-bindings', {
    method: 'POST',
    body: {
      documentType: 'SALES_ORDER', orgId: '', templateId: template.template.id, versionId: version.version.id, priority: 0,
    },
  });

  // 通用工作流引擎**没有**对外的启动入口（平台能力不得成为第二写入口，
  // Design §32.11 约束 #7）：实例由被调域的 canonical 入口启动。UAT 夹具直接
  // 调用引擎的 canonical 启动函数，避免为夹具新增一条业务写入口。
  startWorkflowInstance(db, {
    templateId: template.template.id,
    versionId: version.version.id,
    documentType: 'SALES_ORDER',
    documentId: 'uat-sales-order-001',
    variables: {},
    idempotencyKey: 'uat:sales-order-001',
    actor: { id: 'user-admin' },
  });
  return { scopeId: scopes.scope.id };
}

async function measure(page, surface) {
  return page.evaluate((config) => {
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const docW = Math.max(docEl.scrollWidth, bodyEl.scrollWidth);
    const winW = window.innerWidth;
    const overflow = docW > winW + 2;

    const testidNode = config.testid ? document.querySelector(`[data-testid="${config.testid}"]`) : null;
    const testidBox = testidNode ? testidNode.getBoundingClientRect() : null;
    const testidPresent = Boolean(testidNode) && Boolean(testidBox)
      && testidBox.width > 0 && testidBox.height > 0;

    const painted = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (node.innerText || '').trim().length > 0;
    };
    let renderedRows = 0;
    for (const selector of config.rowSelector) {
      renderedRows += Array.from(document.querySelectorAll(selector)).filter(painted).length;
    }
    let emptyStates = 0;
    for (const selector of config.emptySelector) {
      emptyStates += Array.from(document.querySelectorAll(selector)).filter(painted).length;
    }

    const targets = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          text: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 28),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    const undersized = targets.filter((target) => target.height < config.minTarget || target.width < config.minTarget);

    const routeState = document.querySelector('[data-testid="route-state-permission_denied"]')
      ? 'permission_denied'
      : (document.querySelector('[data-testid="route-state-error"]') ? 'error' : null);

    const heroText = (document.querySelector('.platform-ops__hero h2')?.innerText || '').trim();

    return {
      viewportWidth: winW,
      documentWidth: docW,
      overflow,
      testidPresent,
      renderedRows,
      emptyStates,
      undersized,
      routeState,
      heroText,
    };
  }, { ...surface, minTarget: MIN_TARGET });
}

function judge(surface, evidence, errors) {
  const reasons = [];
  if (!evidence.testidPresent) reasons.push(`canonical data-testid "${surface.testid}" 未绘制`);
  if (evidence.routeState === 'permission_denied') reasons.push('屏渲染了权限拒绝态');
  if (evidence.routeState === 'error') reasons.push('屏渲染了错误态');
  if (evidence.renderedRows === 0 && evidence.emptyStates === 0) reasons.push('既没有真实数据行，也没有显式空态');
  if (evidence.overflow) reasons.push(`横向溢出 ${evidence.documentWidth} > ${evidence.viewportWidth}`);
  if (evidence.undersized.length) reasons.push(`${evidence.undersized.length} 个可点击目标低于 ${MIN_TARGET}px`);
  if (errors.length) reasons.push(`控制台错误 ${errors.length} 条`);
  return reasons;
}

async function main() {
  let browser;
  try {
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    if (!loginResponse.ok) throw new Error(`登录失败: ${loginResponse.status}`);
    const { token } = await loginResponse.json();
    await seedFixtures(baseUrl, token);

    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    // 注入 token → reload：未注入的会话会渲染登录屏，那不是工作面渲染证据。
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);
    await page.reload({ waitUntil: 'networkidle' });
    const session = await page.evaluate(() => ({
      token: Boolean(localStorage.getItem('modern_erp_token')),
      loginVisible: Boolean(document.querySelector('input[type="password"]')),
    }));
    if (!session.token || session.loginVisible) {
      throw new Error(`token 注入失败或未 reload：${JSON.stringify(session)}`);
    }

    for (const viewport of viewports) {
      for (const surface of surfaces) {
        const errors = [];
        const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()); };
        const onPageError = (error) => errors.push(error.message);
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
        await page.setViewportSize(viewport);
        await page.goto(`${baseUrl}#${surface.key}`, { waitUntil: 'networkidle', timeout: 20000 });
        // 等屏真正画出来：**真实数据行或显式空态**。只等屏根 testid 会在数据
        // 还没到达时提前放行 —— 那正是「空洞」的形态。
        await page.waitForFunction((config) => {
          const painted = (node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (node.innerText || '').trim().length > 0;
          };
          const rows = config.rowSelector.some((selector) => Array.from(document.querySelectorAll(selector)).some(painted));
          const empty = config.emptySelector.some((selector) => Array.from(document.querySelectorAll(selector)).some(painted));
          return rows || empty;
        }, { rowSelector: surface.rowSelector, emptySelector: surface.emptySelector }, { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(700);
        const evidence = await measure(page, surface);
        const reasons = judge(surface, evidence, errors);
        const passed = reasons.length === 0;
        if (!passed) failures += 1;
        results.push({ surface: surface.key, width: viewport.width, passed, evidence, errors, reasons });
        console.log(`${passed ? 'PASS' : 'FAIL'} ${viewport.width}px ${surface.key} :: rows=${evidence.renderedRows} empty=${evidence.emptyStates} overflow=${evidence.overflow} undersized=${evidence.undersized.length} errors=${errors.length}${reasons.length ? ` :: ${reasons.join('; ')}` : ''}`);
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
      }
    }
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    if (server.listening) await new Promise((done) => server.close(done));
    db.close();
    rmSync(dbTempDir, { recursive: true, force: true });
  }

  const surfacesCovered = new Set(results.map((entry) => entry.surface));
  console.log(`\n屏覆盖：${surfacesCovered.size}/${surfaces.length}，视口 ${viewports.length} 档，共 ${results.length} 次判定`);
  console.log(`结论：${failures === 0 ? 'PASS' : `FAIL（${failures} 项不通过）`}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
