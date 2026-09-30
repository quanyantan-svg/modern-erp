import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p3-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p3-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [320, 390, 430, 680];
const screenshots = [];
let browser;
let baseUrl;

function buildOrder(fixture) {
  return {
    id: fixture.id,
    orderNo: fixture.orderNo,
    status: fixture.status,
    statusLabel: fixture.statusLabel,
    totalCents: fixture.totalCents,
    rejectionReason: fixture.rejectionReason || null,
    orderDate: fixture.orderDate,
    requestedDeliveryDate: fixture.requestedDeliveryDate,
    paymentTerms: fixture.paymentTerms,
    paymentTermsDays: fixture.paymentTermsDays || 0,
    customerId: fixture.customerId,
    customerCode: fixture.customerCode,
    customerName: fixture.customerName,
    shipToContactName: fixture.shipToContactName,
    shipToPhone: fixture.shipToPhone,
    shipToAddress: fixture.shipToAddress,
    remark: fixture.remark,
    items: fixture.items,
    history: fixture.history || [],
  };
}

const DRAFT_FIXTURE = {
  id: 1001,
  orderNo: 'SO-20260930-101',
  status: 'DRAFT',
  statusLabel: '草稿',
  totalCents: 980000,
  rejectionReason: null,
  orderDate: '2026-09-30',
  requestedDeliveryDate: '2026-10-05',
  paymentTerms: '月结 30 天',
  paymentTermsDays: 30,
  customerId: 1,
  customerCode: 'CUST-001',
  customerName: '福州锐控自动化有限公司',
  shipToContactName: '陈晓',
  shipToPhone: '13900000001',
  shipToAddress: '福州市马尾区保税区 12 号',
  remark: '',
  items: [
    { id: 'l-1', productId: 11, productCode: 'FG-DT100', productName: '桌面终端', unit: '台', quantity: 10, unitPriceCents: 98000, amountCents: 980000, lineNo: 1 },
  ],
  history: [
    { userName: '张三', createdAt: '2026-09-30T08:00:00.000Z', detail: '创建草稿' },
  ],
};

const SUBMITTED_FIXTURE = {
  ...DRAFT_FIXTURE,
  id: 1002,
  orderNo: 'SO-20260930-102',
  status: 'SUBMITTED',
  statusLabel: '待审批',
  history: [
    { userName: '张三', createdAt: '2026-09-30T08:00:00.000Z', detail: '创建草稿' },
    { userName: '张三', createdAt: '2026-09-30T08:30:00.000Z', detail: '提交审批' },
  ],
};

const APPROVED_FIXTURE = {
  ...DRAFT_FIXTURE,
  id: 1003,
  orderNo: 'SO-20260930-103',
  status: 'APPROVED',
  statusLabel: '已审批',
  remark: '请按合同附件 A 的规格交付',
  history: [
    { userName: '张三', createdAt: '2026-09-30T08:00:00.000Z', detail: '创建草稿' },
    { userName: '张三', createdAt: '2026-09-30T08:30:00.000Z', detail: '提交审批' },
    { userName: '王五', createdAt: '2026-09-30T09:15:00.000Z', detail: '审批通过' },
  ],
};

const REJECTED_FIXTURE = {
  ...DRAFT_FIXTURE,
  id: 1004,
  orderNo: 'SO-20260930-104',
  status: 'REJECTED',
  statusLabel: '已驳回',
  rejectionReason: '当前库存不足以满足订单行数量,请拆分或调整订单日期后重新提交。',
  history: [
    { userName: '张三', createdAt: '2026-09-30T08:00:00.000Z', detail: '创建草稿' },
    { userName: '张三', createdAt: '2026-09-30T08:30:00.000Z', detail: '提交审批' },
    { userName: '王五', createdAt: '2026-09-30T09:15:00.000Z', detail: '审批驳回' },
  ],
};

const LONGTEXT_FIXTURE = {
  ...APPROVED_FIXTURE,
  id: 1005,
  orderNo: 'SO-20260930-EXTREMELY-LONG-DOCUMENT-NUMBER-FOR-OVERFLOW-TEST-001',
  customerName: '福州锐控自动化设备有限公司(马尾保税区厂区)制造一部采购二课',
  shipToAddress: '福建省福州市马尾区保税区加工贸易区 12 号楼 A 单元 1501 室(实际收货地址以仓库现场签收为准)',
  paymentTerms: '月结 60 天 + 季度返利 1.5% + 验收合格后 30 日内电汇',
  items: [
    { id: 'l-1', productId: 11, productCode: 'FG-DT100-LONG-CODE-FOR-VISUAL-OVERFLOW', productName: '桌面终端(工业级)适用于 -40°C 至 +70°C 工况', unit: '台', quantity: 12, unitPriceCents: 98000, amountCents: 1176000, lineNo: 1 },
    { id: 'l-2', productId: 12, productCode: 'PCB-A1', productName: '主控板', unit: '块', quantity: 12, unitPriceCents: 80000, amountCents: 960000, lineNo: 2 },
  ],
};

const APPROVED_WORKFLOW = {
  root: { id: APPROVED_FIXTURE.id, orderNo: APPROVED_FIXTURE.orderNo, status: APPROVED_FIXTURE.status },
  upstream: [],
  downstream: [
    {
      id: 'd-1', documentNo: 'SD-20261002-001', type: 'SALES_DELIVERY', status: 'CONFIRMED',
      documentDate: '2026-10-02', amountCents: 980000,
      returns: [],
      voucher: null,
    },
    {
      id: 'd-2', documentNo: 'SD-20261004-002', type: 'SALES_DELIVERY', status: 'DRAFT',
      documentDate: '2026-10-04', amountCents: 0,
      returns: [
        { id: 'r-1', documentNo: 'SR-20261008-001', type: 'SALES_RETURN', status: 'DRAFT', documentDate: '2026-10-08', amountCents: 5000 },
      ],
      voucher: null,
    },
  ],
};

const DRAFT_WORKFLOW = {
  root: { id: DRAFT_FIXTURE.id, orderNo: DRAFT_FIXTURE.orderNo, status: DRAFT_FIXTURE.status },
  upstream: [],
  downstream: [],
};

const SUBMITTED_WORKFLOW = {
  root: { id: SUBMITTED_FIXTURE.id, orderNo: SUBMITTED_FIXTURE.orderNo, status: SUBMITTED_FIXTURE.status },
  upstream: [],
  downstream: [],
};

const REJECTED_WORKFLOW = {
  root: { id: REJECTED_FIXTURE.id, orderNo: REJECTED_FIXTURE.orderNo, status: REJECTED_FIXTURE.status },
  upstream: [],
  downstream: [],
};

const LONGTEXT_WORKFLOW = {
  root: { id: LONGTEXT_FIXTURE.id, orderNo: LONGTEXT_FIXTURE.orderNo, status: LONGTEXT_FIXTURE.status },
  upstream: [],
  downstream: [
    {
      id: 'd-3', documentNo: 'SD-20261005-001', type: 'SALES_DELIVERY', status: 'CONFIRMED',
      documentDate: '2026-10-05', amountCents: 1176000, returns: [], voucher: null,
    },
  ],
};

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200, 'login must succeed');
  return (await response.json()).token;
}

async function captureDetail(token, id, file, { orderFixture, workflowFixture, width }) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route(`**/api/orders/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order: buildOrder(orderFixture) }),
    });
  });
  await context.route(`**/api/workflow/sales-orders/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(workflowFixture),
    });
  });
  await context.route('**/api/orders?**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [buildOrder(orderFixture)] }),
    });
  });
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.locator('.v16-sales-order-list, .v16-sales-order-list-state').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(150);
  // Navigate to detail via the row's open button.
  await page.locator(`[data-testid="sales-order-row-${id}"] .v16-sales-order-row__open`).first().click();
  await page.locator('.v16-sales-order-detail').first().waitFor({ timeout: 12000 });
  await page.waitForTimeout(200);

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    const detail = document.querySelector('.v16-sales-order-detail')?.getBoundingClientRect();
    const action = document.querySelector('.v16-sales-order-detail__action-bar')?.getBoundingClientRect();
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width ?? 0,
      detailBottom: detail?.bottom ?? 0,
      actionTop: action?.top ?? 0,
      actionBottom: action?.bottom ?? 0,
      navTop: nav?.top ?? 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${file} horizontal overflow`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `${file} exceeds 680px`);
  if (width === 680) {
    const centering = await page.evaluate(() => {
      const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
      return { left: shell?.left ?? 0, right: innerWidth - (shell?.right ?? 0) };
    });
    assert.ok(Math.abs(centering.left - centering.right) <= 1, `${file} not centered at 680`);
  }
  if (metrics.actionTop) {
    assert.ok(
      metrics.actionTop <= metrics.navTop - 1,
      `${file} action bar collides with bottom nav (actionTop=${metrics.actionTop}, navTop=${metrics.navTop})`,
    );
  }
  assert.deepEqual(errors, [], `${file} browser/React errors: ${errors.join(' | ')}`);
  // 验证销售详情没有 MobileWorkflowProgress (10 节点)
  const wfCount = await page.locator('.workflow-progress, .mobile-workflow-progress').count();
  assert.equal(wfCount, 0, `${file} must not include legacy MobileWorkflowProgress`);
  // 验证没有 CompactRecord / business-page-header 重复身份
  assert.equal(await page.locator('.compact-record').count(), 0, `${file} must not use CompactRecord in detail`);

  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  await context.close();
}

async function captureEditor(token, file, { width, scenario = {} }) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Provide the minimal customer / product / order payload via API mocks.
  await context.route('**/api/customers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        customers: [
          { id: 1, code: 'CUST-001', name: '福州锐控自动化有限公司', contact: '陈晓', phone: '13900000001', address: '福州市马尾区保税区 12 号', paymentTermsDays: 30, active: true },
        ],
      }),
    });
  });
  await context.route('**/api/products', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        products: [
          { id: 11, code: 'FG-DT100', name: '桌面终端', priceCents: 98000, unit: '台', active: true, trackingPolicy: 'NONE', shelfLifeDays: null },
          { id: 12, code: 'PCB-A1', name: '主控板', priceCents: 80000, unit: '块', active: true, trackingPolicy: 'NONE', shelfLifeDays: null },
        ],
      }),
    });
  });
  if (scenario && scenario.orderId) {
    await context.route(`**/api/orders/${scenario.orderId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ order: buildOrder(scenario.orderFixture) }),
      });
    });
  }
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  // Enter the new editor path.
  await page.evaluate(() => {
    location.hash = '#orders';
  });
  await page.waitForTimeout(150);
  // Open the editor via the new button on the list.
  await page.locator('[data-testid="sales-order-new"]').click();
  await page.locator('.v16-sales-order-editor').first().waitFor({ timeout: 12000 });
  await page.waitForTimeout(200);

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    const editor = document.querySelector('.v16-sales-order-editor')?.getBoundingClientRect();
    const action = document.querySelector('.v16-sales-order-editor__action-bar')?.getBoundingClientRect();
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width ?? 0,
      editorBottom: editor?.bottom ?? 0,
      actionTop: action?.top ?? 0,
      actionBottom: action?.bottom ?? 0,
      navTop: nav?.top ?? 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${file} horizontal overflow`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `${file} exceeds 680px`);
  if (metrics.actionTop) {
    assert.ok(metrics.actionTop <= metrics.navTop - 1, `${file} editor action bar collides with bottom nav`);
  }
  // Editor must not contain the desktop line-table / line-header primitives.
  assert.equal(await page.locator('.line-table').count(), 0, `${file} must not render line-table`);
  assert.equal(await page.locator('.line-row.line-header').count(), 0, `${file} must not render line-header`);
  // Editor must not be wrapped in Modal.
  assert.equal(await page.locator('.modal').count(), 0, `${file} editor must not use Modal wrapper`);
  // Touch targets >= 44px on add / remove / primary / secondary.
  const addBtn = page.locator('.v16-sales-order-editor__add');
  assert.ok(await addBtn.count(), `${file} must render add line button`);
  const addRect = await addBtn.first().evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  assert.ok(addRect.height >= 44, `${file} add button below 44px`);

  assert.deepEqual(errors, [], `${file} browser/React errors: ${errors.join(' | ')}`);

  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  await context.close();
}

async function captureEditorEdit(token, file, { width, orderFixture }) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/api/customers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: [{ id: 1, code: 'CUST-001', name: '福州锐控自动化有限公司', contact: '陈晓', phone: '13900000001', address: '福州市马尾区保税区 12 号', paymentTermsDays: 30, active: true }] }) });
  });
  await context.route('**/api/products', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [{ id: 11, code: 'FG-DT100', name: '桌面终端', priceCents: 98000, unit: '台', active: true, trackingPolicy: 'NONE', shelfLifeDays: null }, { id: 12, code: 'PCB-A1', name: '主控板', priceCents: 80000, unit: '块', active: true, trackingPolicy: 'NONE', shelfLifeDays: null }] }) });
  });
  await context.route(`**/api/orders/${orderFixture.id}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ order: buildOrder({ ...orderFixture, items: [
      { id: 'l-1', productId: 11, productCode: 'FG-DT100', productName: '桌面终端', unit: '台', quantity: 10, unitPriceCents: 98000, amountCents: 980000, lineNo: 1 },
      { id: 'l-2', productId: 12, productCode: 'PCB-A1', productName: '主控板', unit: '块', quantity: 12, unitPriceCents: 80000, amountCents: 960000, lineNo: 2 },
    ] }) }),
    });
  });
  await context.route(`**/api/workflow/sales-orders/${orderFixture.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ root: {}, upstream: [], downstream: [] }),
    });
  });
  await context.route('**/api/orders?**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const listItem = buildOrder({ ...orderFixture, items: [
      { id: 'l-1', productId: 11, productCode: 'FG-DT100', productName: '桌面终端', unit: '台', quantity: 10, unitPriceCents: 98000, amountCents: 980000, lineNo: 1 },
    ] });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [listItem] }),
    });
  });
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.locator('.v16-sales-order-list, .v16-sales-order-list-state').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(150);
  await page.locator(`[data-testid="sales-order-row-${orderFixture.id}"] .v16-sales-order-row__open`).first().click();
  await page.locator('.v16-sales-order-detail').first().waitFor({ timeout: 12000 });
  // Wait for the detail to reach READY state by waiting for the action bar
  // (REJECTED orders always have both primary + secondary actions).
  await page.locator('[data-testid="sales-order-action-secondary"]').first().waitFor({ timeout: 12000 });
  await page.waitForTimeout(150);
  // REJECTED order exposes a secondary "编辑" button.
  await page.locator('[data-testid="sales-order-action-secondary"]').first().click();
  await page.locator('.v16-sales-order-editor').first().waitFor({ timeout: 12000 });
  await page.waitForTimeout(200);

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width ?? 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${file} horizontal overflow`);
  assert.deepEqual(errors, [], `${file} browser/React errors: ${errors.join(' | ')}`);
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  await context.close();
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  for (const width of viewports) {
    await captureDetail(token, DRAFT_FIXTURE.id, `sales-order-detail-draft-${width}.png`, {
      orderFixture: DRAFT_FIXTURE, workflowFixture: DRAFT_WORKFLOW, width,
    });
    await captureDetail(token, SUBMITTED_FIXTURE.id, `sales-order-detail-submitted-${width}.png`, {
      orderFixture: SUBMITTED_FIXTURE, workflowFixture: SUBMITTED_WORKFLOW, width,
    });
    await captureDetail(token, APPROVED_FIXTURE.id, `sales-order-detail-approved-${width}.png`, {
      orderFixture: APPROVED_FIXTURE, workflowFixture: APPROVED_WORKFLOW, width,
    });
    await captureDetail(token, REJECTED_FIXTURE.id, `sales-order-detail-rejected-${width}.png`, {
      orderFixture: REJECTED_FIXTURE, workflowFixture: REJECTED_WORKFLOW, width,
    });
    await captureDetail(token, LONGTEXT_FIXTURE.id, `sales-order-detail-longtext-${width}.png`, {
      orderFixture: LONGTEXT_FIXTURE, workflowFixture: LONGTEXT_WORKFLOW, width,
    });
    await captureEditor(token, `sales-order-editor-new-${width}.png`, { width });
    await captureEditorEdit(token, `sales-order-editor-edit-${width}.png`, { width, orderFixture: REJECTED_FIXTURE });
    await captureEditor(token, `sales-order-editor-longtext-${width}.png`, { width, scenario: { orderId: LONGTEXT_FIXTURE.id, orderFixture: LONGTEXT_FIXTURE } });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, screenshots }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}