import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p2-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p2-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const viewports = [320, 390, 430, 680];
const screenshots = [];
const results = [];
let browser;
let baseUrl;

const FIXTURE_ORDERS = [
  {
    id: 18,
    orderNo: 'SO-20260930-018',
    status: 'SUBMITTED',
    statusLabel: '待审批',
    totalCents: 980000,
    rejectionReason: null,
    createdAt: '2026-09-30T08:01:00.000Z',
    updatedAt: '2026-09-30T08:01:00.000Z',
    submittedAt: '2026-09-30T08:01:00.000Z',
    reviewedAt: null,
    orderDate: '2026-09-30',
    requestedDeliveryDate: '2026-10-02',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 1,
    customerCode: 'CUST-001',
    customerName: '福州锐控自动化有限公司',
    creatorName: '李四',
    reviewerName: null,
    itemCount: 3,
    deliveryCount: 0,
  },
  {
    id: 17,
    orderNo: 'SO-20260930-017',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 540000,
    rejectionReason: null,
    createdAt: '2026-09-29T14:22:00.000Z',
    updatedAt: '2026-09-30T09:15:00.000Z',
    submittedAt: '2026-09-29T15:00:00.000Z',
    reviewedAt: '2026-09-30T09:15:00.000Z',
    orderDate: '2026-09-29',
    requestedDeliveryDate: '2026-10-03',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 2,
    customerCode: 'CUST-002',
    customerName: '福建XX科技有限公司',
    creatorName: '张三',
    reviewerName: '王五',
    itemCount: 2,
    deliveryCount: 0,
  },
  {
    id: 16,
    orderNo: 'SO-20260930-016',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 1265000,
    rejectionReason: null,
    createdAt: '2026-09-28T09:10:00.000Z',
    updatedAt: '2026-09-30T10:30:00.000Z',
    submittedAt: '2026-09-28T10:00:00.000Z',
    reviewedAt: '2026-09-29T08:00:00.000Z',
    orderDate: '2026-09-28',
    requestedDeliveryDate: '2026-10-05',
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 3,
    customerCode: 'CUST-003',
    customerName: '厦门智控电子有限公司',
    creatorName: '赵六',
    reviewerName: '王五',
    itemCount: 6,
    deliveryCount: 1,
  },
  {
    id: 15,
    orderNo: 'SO-20260930-015',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 320000,
    rejectionReason: null,
    createdAt: '2026-09-27T11:00:00.000Z',
    updatedAt: '2026-09-30T11:30:00.000Z',
    submittedAt: '2026-09-27T12:00:00.000Z',
    reviewedAt: '2026-09-28T08:00:00.000Z',
    orderDate: '2026-09-27',
    requestedDeliveryDate: '2026-10-01',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 4,
    customerCode: 'CUST-004',
    customerName: '上海自动化设备股份有限公司',
    creatorName: '李四',
    reviewerName: '王五',
    itemCount: 1,
    deliveryCount: 2,
  },
  {
    id: 14,
    orderNo: 'SO-20260930-014',
    status: 'REJECTED',
    statusLabel: '已驳回',
    totalCents: 760000,
    rejectionReason: '当前库存不足以满足订单行数量,请拆分或调整订单日期后重新提交。',
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-29T16:30:00.000Z',
    submittedAt: '2026-09-26T10:30:00.000Z',
    reviewedAt: '2026-09-29T16:30:00.000Z',
    orderDate: '2026-09-26',
    requestedDeliveryDate: '2026-09-30',
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 5,
    customerCode: 'CUST-005',
    customerName: '福州市鼓楼区闽江精密机械制造有限公司',
    creatorName: '李四',
    reviewerName: '王五',
    itemCount: 4,
    deliveryCount: 0,
  },
  {
    id: 13,
    orderNo: 'SO-20260930-013',
    status: 'DRAFT',
    statusLabel: '草稿',
    totalCents: 145000,
    rejectionReason: null,
    createdAt: '2026-09-25T13:45:00.000Z',
    updatedAt: '2026-09-25T13:45:00.000Z',
    submittedAt: null,
    reviewedAt: null,
    orderDate: '2026-09-25',
    requestedDeliveryDate: null,
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 6,
    customerCode: 'CUST-006',
    customerName: '龙岩新罗区东南机电有限公司',
    creatorName: '张三',
    reviewerName: null,
    itemCount: 2,
    deliveryCount: 0,
  },
  {
    id: 12,
    orderNo: 'SO-20260930-012',
    status: 'SUBMITTED',
    statusLabel: '待审批',
    totalCents: 2310000,
    rejectionReason: null,
    createdAt: '2026-09-24T08:00:00.000Z',
    updatedAt: '2026-09-24T08:00:00.000Z',
    submittedAt: '2026-09-24T08:00:00.000Z',
    reviewedAt: null,
    orderDate: '2026-09-24',
    requestedDeliveryDate: '2026-10-08',
    paymentTerms: '月结 60 天',
    paymentTermsDays: 60,
    customerId: 7,
    customerCode: 'CUST-007',
    customerName: '宁德新能源科技有限公司',
    creatorName: '赵六',
    reviewerName: null,
    itemCount: 12,
    deliveryCount: 0,
  },
  {
    id: 11,
    orderNo: 'SO-20260930-011',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 880000,
    rejectionReason: null,
    createdAt: '2026-09-23T09:00:00.000Z',
    updatedAt: '2026-09-30T07:30:00.000Z',
    submittedAt: '2026-09-23T10:00:00.000Z',
    reviewedAt: '2026-09-24T08:30:00.000Z',
    orderDate: '2026-09-23',
    requestedDeliveryDate: '2026-10-04',
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 8,
    customerCode: 'CUST-008',
    customerName: '苏州工业园区智造装备有限公司',
    creatorName: '李四',
    reviewerName: '王五',
    itemCount: 5,
    deliveryCount: 0,
  },
  {
    id: 10,
    orderNo: 'SO-20260930-010',
    status: 'DRAFT',
    statusLabel: '草稿',
    totalCents: 0,
    rejectionReason: null,
    createdAt: '2026-09-22T14:00:00.000Z',
    updatedAt: '2026-09-22T14:00:00.000Z',
    submittedAt: null,
    reviewedAt: null,
    orderDate: '2026-09-22',
    requestedDeliveryDate: '2026-10-12',
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 9,
    customerCode: 'CUST-009',
    customerName: '莆田市涵江区精密五金制品厂',
    creatorName: '张三',
    reviewerName: null,
    itemCount: 1,
    deliveryCount: 0,
  },
];

const LONGTEXT_ORDERS = [
  {
    id: 1,
    orderNo: 'SO-20260930-EXTREMELY-LONG-DOC-NUMBER-FOR-OVERFLOW-TEST-001',
    status: 'SUBMITTED',
    statusLabel: '待审批',
    totalCents: 99880000,
    rejectionReason: null,
    createdAt: '2026-09-30T08:01:00.000Z',
    updatedAt: '2026-09-30T08:01:00.000Z',
    submittedAt: '2026-09-30T08:01:00.000Z',
    reviewedAt: null,
    orderDate: '2026-09-30',
    requestedDeliveryDate: '2026-10-02',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 1,
    customerCode: 'CUST-001',
    customerName: '福州锐控自动化设备有限公司(马尾保税区厂区)制造一部采购二课',
    creatorName: '李四',
    reviewerName: null,
    itemCount: 42,
    deliveryCount: 0,
  },
  {
    id: 2,
    orderNo: 'SO-20260930-002',
    status: 'REJECTED',
    statusLabel: '已驳回',
    totalCents: 123400,
    rejectionReason: '当前库存不足,且客户付款条款尚未通过财务复核,请调整付款条件或拆分订单后重新提交审批',
    createdAt: '2026-09-29T14:22:00.000Z',
    updatedAt: '2026-09-30T09:15:00.000Z',
    submittedAt: '2026-09-29T15:00:00.000Z',
    reviewedAt: '2026-09-30T09:15:00.000Z',
    orderDate: '2026-09-29',
    requestedDeliveryDate: '2026-10-03',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 2,
    customerCode: 'CUST-002',
    customerName: '福建XX科技股份有限公司',
    creatorName: '张三',
    reviewerName: '王五',
    itemCount: 99,
    deliveryCount: 0,
  },
  {
    id: 3,
    orderNo: 'SO-20260930-003',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 560000,
    rejectionReason: null,
    createdAt: '2026-09-28T09:10:00.000Z',
    updatedAt: '2026-09-30T10:30:00.000Z',
    submittedAt: '2026-09-28T10:00:00.000Z',
    reviewedAt: '2026-09-29T08:00:00.000Z',
    orderDate: '2026-09-28',
    requestedDeliveryDate: '2026-10-05',
    paymentTerms: '现金',
    paymentTermsDays: 0,
    customerId: 3,
    customerCode: 'CUST-003',
    customerName: '厦门智控电子有限公司',
    creatorName: '赵六',
    reviewerName: '王五',
    itemCount: 5,
    deliveryCount: 1,
  },
  {
    id: 4,
    orderNo: 'SO-20260930-004',
    status: 'APPROVED',
    statusLabel: '已审批',
    totalCents: 999900,
    rejectionReason: null,
    createdAt: '2026-09-27T11:00:00.000Z',
    updatedAt: '2026-09-30T11:30:00.000Z',
    submittedAt: '2026-09-27T12:00:00.000Z',
    reviewedAt: '2026-09-28T08:00:00.000Z',
    orderDate: '2026-09-27',
    requestedDeliveryDate: '2026-10-01',
    paymentTerms: '月结 30 天',
    paymentTermsDays: 30,
    customerId: 4,
    customerCode: 'CUST-004',
    customerName: '上海自动化设备股份有限公司',
    creatorName: '李四',
    reviewerName: '王五',
    itemCount: 8,
    deliveryCount: 2,
  },
];

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200, 'visual fixture login must succeed');
  return (await response.json()).token;
}

function interceptOrders(context, fixture) {
  return context.route('**/api/orders**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: fixture }),
    });
  });
}

async function gotoOrders(page, fixture) {
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: fixture }),
    });
  });
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.locator('.v16-sales-order-list, .v16-sales-order-list-state').first().waitFor({ timeout: 12000 });
}

async function assertListContract(page, width, { expectReady = true } = {}) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width ?? 0,
      shellLeft: shell?.left ?? 0,
      shellRight: shell ? innerWidth - shell.right : 0,
      navTop: nav?.top ?? 0,
      navBottom: nav?.bottom ?? 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `sales-orders-${width} has horizontal overflow (${metrics.scrollWidth} > ${metrics.clientWidth})`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `sales-orders-${width} shell exceeds 680px rail`);
  if (width === 680) assert.ok(Math.abs(metrics.shellLeft - metrics.shellRight) <= 1, `sales-orders-680 is not centered`);
  if (expectReady) {
    const newButton = page.locator('[data-testid="sales-order-new"]');
    assert.ok(await newButton.count(), `sales-orders-${width} must render new button`);
    const newRect = await newButton.first().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(newRect.height >= 44 && newRect.width >= 44, `sales-orders-${width} new button below 44px`);
    const segmentButtons = page.locator('.v16-sales-order-segments .segmented-control button');
    const count = await segmentButtons.count();
    assert.equal(count, 5, `sales-orders-${width} must show 5 status segments, got ${count}`);
    const segmentRects = await segmentButtons.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    for (const h of segmentRects) assert.ok(h >= 30, `sales-orders-${width} segment below 30px`);
    const rowOpenButtons = page.locator('.v16-sales-order-row__open');
    const rowCount = await rowOpenButtons.count();
    assert.ok(rowCount > 0, `sales-orders-${width} must render at least one row`);
    const openRects = await rowOpenButtons.first().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(openRects.height >= 44, `sales-orders-${width} row open area below 44px (${openRects.height})`);
    const overflow = page.locator('.v16-sales-order-row__overflow .canonical-action-menu summary').first();
    const overflowRect = await overflow.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(overflowRect.height >= 44, `sales-orders-${width} overflow below 44px`);
  }
}

async function capture(token, width, file, { fixture = FIXTURE_ORDERS, route } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  if (route) await route(context);
  else await interceptOrders(context, fixture);
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.locator('.v16-sales-order-list, .v16-sales-order-list-state').first().waitFor({ timeout: 12000 });
  // Wait until every order row has been rendered so visibility checks are stable.
  const expected = fixture.length;
  if (expected > 0) {
    await page.waitForFunction(
      (n) => document.querySelectorAll('.v16-sales-order-row').length >= n,
      expected,
      { timeout: 12000 },
    );
  }
  await assertListContract(page, width);
  // 390 must show at least 5 normal rows in the seeded fixture (not longtext).
  if (width === 390 && file === 'sales-orders-390.png') {
    await page.waitForTimeout(500);
    const debugInfo = await page.evaluate(() => {
      const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
      const listItems = document.querySelectorAll('.v16-sales-order-row');
      const itemsData = [...listItems].map((node) => {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      });
      return {
        navTop: nav?.top ?? 0,
        navHeight: nav?.height ?? 0,
        rowCount: listItems.length,
        rows: itemsData,
      };
    });
    const visibleRows = debugInfo.rows.filter((r) => r.bottom > 0 && r.top < debugInfo.navTop - 1).length;
    assert.ok(
      visibleRows >= 5,
      `sales-orders-390 must show at least 5 rows above bottom nav, got ${visibleRows} (debugInfo=${JSON.stringify(debugInfo)})`,
    );
  }
  assert.deepEqual(errors, [], `sales-orders-${width} browser/React errors: ${errors.join(' | ')}`);
  // Reposition fixed bottom-nav before viewport screenshot to avoid it bisecting
  // a long list capture; the layout contract above already proves no overlap.
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  results.push({ file, width, ...await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })) });
  await context.close();
}

async function captureEmpty(token) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await interceptOrders(context, []);
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.locator('.v16-sales-order-list-state').first().waitFor({ timeout: 8000 });
  const title = await page.locator('.v16-sales-order-list-state__title').first().textContent();
  assert.match(title || '', /暂无销售订单/);
  assert.deepEqual(errors, [], `sales-orders-empty-390 browser/React errors: ${errors.join(' | ')}`);
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  const path = join(outputDir, 'sales-orders-empty-390.png');
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
    await capture(token, width, `sales-orders-${width}.png`);
  }
  await capture(token, 390, 'sales-orders-longtext-390.png', { fixture: LONGTEXT_ORDERS });
  await captureEmpty(token);
  process.stdout.write(`${JSON.stringify({ ok: true, screenshots, results }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}