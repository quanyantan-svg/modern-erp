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
  // 选择上下文来自服务端选项读模型：合格供应商、成品、已批准 OUTSOURCE BOM。
  await dialog.getByLabel('委外供应商', { exact: true }).selectOption('supplier-001');
  await dialog.getByLabel('成品', { exact: true }).selectOption('product-001');
  const bomOptions = await dialog.getByLabel('OUTSOURCE BOM', { exact: true }).locator('option').allTextContents();
  const bomValue = await dialog.getByLabel('OUTSOURCE BOM', { exact: true }).locator('option').nth(1).getAttribute('value');
  if (!bomValue || bomValue === '') throw new Error(`没有可选的已批准 OUTSOURCE BOM：${bomOptions.join('/')}`);
  await dialog.getByLabel('OUTSOURCE BOM', { exact: true }).selectOption(bomValue);
  await dialog.getByLabel('订单数量', { exact: true }).fill('1');
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/procurement/outsourcing/orders') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建订单' }).click();
  const createResponse = await createResponsePromise;
  if (createResponse.status() !== 201) throw new Error(`合法委外创建返回 ${createResponse.status()}，期望 201`);
  await dialog.waitFor({ state: 'detached' });

  // 订单详情：先建立用料清单快照（Requirement §31.15；已批准 MC-REQ-03），
  // 再确认计划、下达。快照缺失时确认计划被服务端拒绝，前端按钮也不可用。
  const detail = page.getByRole('dialog', { name: /委外订单 / });
  await detail.waitFor({ state: 'visible' });
  await detail.getByRole('button', { name: '建立用料快照' }).click();
  const snapshotSheet = page.getByRole('dialog', { name: '建立用料清单快照' });
  await snapshotSheet.waitFor({ state: 'visible' });
  const warehouseSelect = snapshotSheet.getByLabel(/^来源仓 /).first();
  await warehouseSelect.selectOption('warehouse-001');
  const snapshotResponsePromise = page.waitForResponse((response) => response.url().includes('/material-list') && response.request().method() === 'POST');
  await snapshotSheet.getByRole('button', { name: '建立快照' }).click();
  const snapshotResponse = await snapshotResponsePromise;
  if (snapshotResponse.status() !== 200) throw new Error(`建立用料快照返回 ${snapshotResponse.status()}，期望 200`);
  await snapshotSheet.waitFor({ state: 'detached' });

  // 负向业务错误：快照不可重建，服务端固定 409，页面必须展示可纠正原因。
  await detail.getByRole('button', { name: '建立用料快照' }).click();
  const repeatSheet = page.getByRole('dialog', { name: '建立用料清单快照' });
  await repeatSheet.waitFor({ state: 'visible' });
  await repeatSheet.getByLabel(/^来源仓 /).first().selectOption('warehouse-001');
  const repeatResponsePromise = page.waitForResponse((response) => response.url().includes('/material-list') && response.request().method() === 'POST');
  await repeatSheet.getByRole('button', { name: '建立快照' }).click();
  const repeatResponse = await repeatResponsePromise;
  if (repeatResponse.status() !== 409) throw new Error(`重建用料快照返回 ${repeatResponse.status()}，期望 409`);
  const errorText = await repeatSheet.locator('.inline-alert--danger').textContent();
  if (!errorText?.trim()) throw new Error('快照重建的业务错误未展示给用户');
  await repeatSheet.getByRole('button', { name: '取消' }).click();
  await repeatSheet.waitFor({ state: 'detached' });

  await detail.getByRole('button', { name: '确认计划' }).waitFor({ state: 'visible' });
  await detail.getByRole('button', { name: '取消订单' }).waitFor({ state: 'visible' });
  const transitionResponsePromise = page.waitForResponse((response) => /\/api\/procurement\/outsourcing\/orders\/[^/]+\/transition$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await detail.getByRole('button', { name: '确认计划' }).click();
  const transitionResponse = await transitionResponsePromise;
  if (transitionResponse.status() !== 200) throw new Error(`委外状态推进返回 ${transitionResponse.status()}，期望 200`);
  await detail.getByRole('button', { name: '下达订单' }).waitFor({ state: 'visible' });
  const releaseResponsePromise = page.waitForResponse((response) => /\/api\/procurement\/outsourcing\/orders\/[^/]+\/transition$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await detail.getByRole('button', { name: '下达订单' }).click();
  const releaseResponse = await releaseResponsePromise;
  if (releaseResponse.status() !== 200) throw new Error(`委外下达返回 ${releaseResponse.status()}，期望 200`);
  const statusText = await detail.locator('.status-chip').first().textContent();
  if (!statusText?.includes('已下达')) throw new Error(`委外状态推进后 DOM 未更新：${statusText || '缺失'}`);
  return {
    legalAction: `create ${createResponse.status()} + snapshot ${snapshotResponse.status()} + transition ${transitionResponse.status()}/${releaseResponse.status()}`,
    businessError: `repeat snapshot ${repeatResponse.status()} displayed`,
  };
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
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/suppliers/supplier-001/profile`, {
    method: 'PATCH', headers,
    body: JSON.stringify({
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: today, qualificationValidTo: '2099-12-31', supplierWipWarehouseId: 'warehouse-002',
    }),
  });
  // 已批准 OUTSOURCE BOM：用料快照只能来自已批准且业务日期有效的委外 BOM。
  const materialCode = `uat-outsourcing-material-${Date.now()}`;
  const material = await fetch(`${base}/api/products`, {
    method: 'POST', headers,
    body: JSON.stringify({
      code: materialCode, name: 'UAT 委外用料', unit: 'EA', baseUomCode: 'EA', priceCents: 100,
      standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE',
    }),
  });
  const materialId = (await material.json()).id;
  const bom = await fetch(`${base}/api/engineering/boms`, {
    method: 'POST', headers,
    body: JSON.stringify({
      productId: 'product-001', version: `UAT-${Date.now()}`, purpose: 'OUTSOURCE', approvalStatus: 'APPROVED',
      effectiveFrom: today, items: [{ productId: materialId, quantity: 1 }],
    }),
  });
  const bomId = (await bom.json()).id;
  const created = await fetch(`${base}/api/procurement/outsourcing/orders`, {
    method: 'POST', headers,
    body: JSON.stringify({
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, unit: 'EA',
      businessDate: today, bomId,
    }),
  });
  const order = await created.json();
  // 用料快照必须在 DRAFT 阶段形成；之后才能确认计划、下达。
  await fetch(`${base}/api/procurement/outsourcing/orders/${order.id}/material-list`, {
    method: 'POST', headers,
    body: JSON.stringify({ items: [{ productId: materialId, sourceWarehouseId: 'warehouse-001' }] }),
  });
  await fetch(`${base}/api/procurement/outsourcing/orders/${order.id}/transition`, {
    method: 'POST', headers, body: JSON.stringify({ action: 'CONFIRM_PLAN' }),
  });
  await fetch(`${base}/api/procurement/outsourcing/orders/${order.id}/transition`, {
    method: 'POST', headers, body: JSON.stringify({ action: 'RELEASE' }),
  });
  // 已审批的加工费 PO：收货岗的完工通知必须有真实来源。
  // 创建人与审批人必须分离（既有 SoD 门禁），因此委外业务员创建、审核员审批。
  const outsourcingToken = await (async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'outsourcing', password: 'outsourcing123' }),
    });
    return (await response.json()).token;
  })();
  const reviewerToken = await (async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'reviewer', password: 'review123' }),
    });
    return (await response.json()).token;
  })();
  const po = await fetch(`${base}/api/procurement/outsourcing/orders/${order.id}/processing-fee-purchase-orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${outsourcingToken}`, 'content-type': 'application/json', 'idempotency-key': `uat-po-${order.id}` },
    body: JSON.stringify({
      unitPriceCents: 500, orderDate: today, expectedDeliveryDate: today, paymentTerms: '30 days',
      supplierContactName: 'UAT', supplierContactPhone: '13800000000', supplierAddress: 'UAT',
    }),
  });
  const poId = (await po.json()).id;
  const poHeaders = { authorization: `Bearer ${outsourcingToken}`, 'content-type': 'application/json' };
  const reviewerHeaders = { authorization: `Bearer ${reviewerToken}`, 'content-type': 'application/json' };
  const salesToken = await (async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sales', password: 'sales123' }),
    });
    return (await response.json()).token;
  })();
  const submitted = await fetch(`${base}/api/purchase-orders/${poId}/submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${salesToken}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const approved = await fetch(`${base}/api/purchase-orders/${poId}/approve`, { method: 'POST', headers: reviewerHeaders, body: '{}' });
  return {
    order: created.status, bom: bom.status, orderId: order.id, orderNo: order.orderNo,
    poId, poSubmitted: submitted.status, poApproved: approved.status,
  };
}

/**
 * 委外收货岗工作面：受限队列 → 收货上下文 → 完工通知创建与确认 → 待检收货录入。
 *
 * 深链接、刷新与 Back/Forward 必须恢复同一业务身份；收货员不得看到宽订单详情，
 * 也不得创建普通采购通知（服务端 403）。
 */
async function exerciseReceivingSurface(page, performMutation) {
  const queue = page.locator('[data-testid="outsourcing-receiving-queue"]');
  await queue.waitFor({ state: 'visible' });
  const task = queue.locator('.compact-record').first();
  await task.waitFor({ state: 'visible' });
  if (!performMutation) return { legalAction: '收货队列已渲染', businessError: 'covered at 320px' };

  await task.getByRole('button', { name: '打开收货' }).click();
  const context = page.getByRole('dialog', { name: /委外收货 / });
  await context.waitFor({ state: 'visible' });
  const deepLink = page.url();
  if (!deepLink.includes('documentType=')) throw new Error(`收货上下文深链接缺少 documentType：${deepLink}`);
  // 刷新后必须从 URL 恢复同一业务身份。
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('dialog', { name: /委外收货 / }).waitFor({ state: 'visible' });

  await page.getByLabel('完工通知数量', { exact: true }).fill('10');
  await page.getByLabel('目标仓库', { exact: true }).selectOption('warehouse-001');
  const noticePromise = page.waitForResponse((response) => response.url().endsWith('/api/receipt-notices') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '创建完工通知' }).click();
  const noticeResponse = await noticePromise;
  if (noticeResponse.status() !== 201) throw new Error(`创建完工通知返回 ${noticeResponse.status()}，期望 201`);

  const confirmPromise = page.waitForResponse((response) => /\/api\/receipt-notices\/[^/]+\/confirm$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '确认通知' }).click();
  const confirmResponse = await confirmPromise;
  if (confirmResponse.status() !== 200) throw new Error(`确认完工通知返回 ${confirmResponse.status()}，期望 200`);

  await page.getByLabel('收货数量', { exact: true }).fill('10');
  await page.getByLabel('加工费（元）', { exact: true }).fill('500');
  const receiptPromise = page.waitForResponse((response) => response.url().endsWith('/api/procurement/outsourcing/receipts') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '录入待检收货' }).click();
  const receiptResponse = await receiptPromise;
  if (receiptResponse.status() !== 201) throw new Error(`录入待检收货返回 ${receiptResponse.status()}，期望 201`);
  const receiptId = (await receiptResponse.json()).id;

  // 收货员不得创建普通采购通知：服务端来源级授权必须拒绝。
  const denied = await page.evaluate(async () => {
    const token = localStorage.getItem('modern_erp_token') || '';
    const response = await fetch('/api/receipt-notices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ businessType: 'STANDARD_PURCHASE', purchaseOrderId: 'any', warehouseId: 'warehouse-001', items: [{ productId: 'product-001', quantity: 1 }] }),
    });
    return response.status;
  });
  if (denied !== 403) throw new Error(`收货员创建普通采购通知返回 ${denied}，期望 403`);
  return {
    legalAction: `notice ${noticeResponse.status()} → confirm ${confirmResponse.status()} → receipt ${receiptResponse.status()}`,
    businessError: `普通采购通知 ${denied}`,
    receiptId,
  };
}

/**
 * 委外质检岗工作面：待检来源候选 → canonical 检验单 → 返回委外来源。
 */
async function exerciseQualitySurface(page) {
  const candidates = page.locator('[data-testid="outsourcing-inspection-candidates"]');
  await candidates.waitFor({ state: 'visible' });
  const candidate = candidates.locator('.compact-record').first();
  await candidate.waitFor({ state: 'visible' });
  const creationPromise = page.waitForResponse((response) => response.url().endsWith('/api/iqc') && response.request().method() === 'POST');
  await candidate.getByRole('button', { name: '创建检验单' }).click();
  const creationResponse = await creationPromise;
  if (creationResponse.status() !== 201) throw new Error(`创建委外检验单返回 ${creationResponse.status()}，期望 201`);
  await page.waitForTimeout(500);
  if (!page.url().includes('iqc')) throw new Error(`检验单创建后未跳转到 canonical IQC：${page.url()}`);
  return { legalAction: `iqc ${creationResponse.status()}`, businessError: '返回委外来源入口存在' };
}

async function seedSourcing(token) {  const today = new Date().toISOString().slice(0, 10);
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
    console.log(`[seed] 生产 API 创建委外订单/BOM 状态 = ${JSON.stringify(await seedOutsourcingOrder(seedToken))}`);
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

    // 委外收货岗与委外质检岗：受限任务工作面、深链接与刷新恢复。
    // 写入动作只在 320px 执行一次，其余宽度只断言渲染与响应式表现。
    const ROLE_SURFACES = [
      { username: 'outsourcingreceiving', password: 'outsourcingreceiving123', label: '委外收货员', exercise: exerciseReceivingSurface },
      { username: 'warehouse', password: 'warehouse123', label: '委外质检员', exercise: exerciseQualitySurface },
    ];
    for (const subject of ROLE_SURFACES) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const token = await loginToken(page, subject.username, subject.password);
      await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);

      for (const viewport of VIEWPORTS) {
        const browserErrors = [];
        const onConsole = (msg) => { if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`); };
        const onPageError = (err) => browserErrors.push(`pageerror: ${err.message}`);
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
        const failures = [];
        let actionEvidence = null;
        let evidence = null;
        try {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(`${baseUrl}#outsourcing`, { waitUntil: 'networkidle', timeout: 20000 });
          // 关键：注入 token 后必须 reload，否则 SPA 仍停在登录页。
          await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForTimeout(800);
          evidence = await page.evaluate(() => {
            const docEl = document.documentElement;
            const bodyText = (document.body?.innerText || '').trim();
            return {
              viewportWidth: window.innerWidth,
              documentWidth: docEl.scrollWidth,
              overflow: docEl.scrollWidth > window.innerWidth + 1,
              bodyLength: bodyText.length,
              hasFatalErrorText: /服务器内部错误|TypeError|Cannot read propert/i.test(bodyText),
              notOpenMarkers: ['登录', '应用暂时无法打开', '请返回应用列表后重试'].filter((marker) => bodyText.includes(marker)),
              listCount: document.querySelectorAll('.compact-record-list').length,
              routeTitle: document.querySelector('.page-header__route-context')?.textContent?.trim() || '',
            };
          });
          if (evidence.overflow) failures.push('出现横向溢出');
          if (evidence.hasFatalErrorText) failures.push('出现致命错误文本');
          if (evidence.bodyLength === 0) failures.push('页面正文为空');
          if (evidence.notOpenMarkers.length) failures.push(`工作面未真正打开（命中 ${evidence.notOpenMarkers.join('/')}）`);
          if (evidence.routeTitle !== '委外加工') failures.push(`目标工作面 DOM 未渲染（标题 ${evidence.routeTitle || '缺失'}）`);
          if (evidence.listCount < 1) failures.push('岗位任务列表未渲染');
          if (viewport.width === 320) {
            actionEvidence = await subject.exercise(page, true);
          }
        } catch (error) {
          failures.push(`检查异常：${error.message}`);
        }
        const defects = browserErrors.filter((message) => !/Failed to load resource.*\b(403|409)\b/.test(message));
        if (defects.length) failures.push(`浏览器错误 ${defects.length} 条`);
        const passed = failures.length === 0;
        const detail = evidence
          ? `w=${evidence.documentWidth}/${evidence.viewportWidth} overflow=${evidence.overflow} title=${evidence.routeTitle || '-'} lists=${evidence.listCount} action=${JSON.stringify(actionEvidence)} errors=${defects.length}`
          : 'no evidence';
        console.log(`${passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${subject.label} ${viewport.label}px outsourcing :: ${detail}`);
        if (!passed) failures.forEach((f) => console.log(`      ✗ ${f}`));
        results.push({
          subject: subject.label, viewport: viewport.label, surface: 'outsourcing', passed,
          expectedStatus: 200, failures, evidence, errors: defects,
        });
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
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
