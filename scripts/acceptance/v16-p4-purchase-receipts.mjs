import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p4-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p4-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];
const screenshots = [];
let browser;
let baseUrl;

const baseItem = {
  id: 'receipt-line-1',
  productId: 'product-lot',
  productCode: 'RM-PCB100',
  productName: '核心控制模块',
  unit: '块',
  quantity: 120,
  unitPriceCents: 3000,
  amountCents: 360000,
  lineNo: 1,
  purchaseOrderItemId: 'po-line-1',
  orderedQuantity: 200,
  receivedQuantity: 80,
  remainingQuantity: 120,
  fulfillmentState: 'PARTIALLY_RECEIVED',
  trackingAllocations: [{ lotId: 'lot-1', lotCode: 'LOT-20260930-A', quantity: 120 }],
};

function receipt(overrides = {}) {
  const status = overrides.status || 'DRAFT';
  const id = overrides.id || 'receipt-draft';
  return {
    id,
    receipt_no: overrides.receipt_no || `PR-20260930-${id.slice(-3).toUpperCase()}`,
    purchase_order_id: 'purchase-order-1',
    supplier_id: 'supplier-1',
    supplierCode: 'SUP-001',
    supplierName: '福建精工电子有限公司',
    warehouse_id: 'warehouse-1',
    warehouseCode: 'RM-01',
    warehouseName: '原材料仓',
    receipt_date: '2026-09-30',
    status,
    statusLabel: { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' }[status],
    total_cents: 360000,
    itemCount: 1,
    billedQuantity: status === 'CONFIRMED' ? 60 : 0,
    remainingBillQuantity: status === 'CONFIRMED' ? 60 : 120,
    billMatchStatus: status === 'CONFIRMED' ? 'PARTIALLY_BILLED' : 'UNBILLED',
    billing_mode: 'SEPARATE',
    creatorName: '林宇',
    confirmedByName: status === 'CONFIRMED' ? '陈晨' : null,
    poNo: 'PO-20260928-008',
    qualityState: overrides.qualityState || { code: 'NOT_INSPECTED', label: '未检验' },
    archiveState: overrides.archiveState || { archived: false, archivedAt: null, reason: '' },
    archiveEligibility: { allowed: status === 'CANCELLED', blockers: [] },
    billingSummary: {
      status: status === 'CONFIRMED' ? 'PARTIALLY_BILLED' : 'UNBILLED',
      billedQuantity: status === 'CONFIRMED' ? 60 : 0,
      remainingQuantity: status === 'CONFIRMED' ? 60 : 120,
      grniCents: 360000,
    },
    items: overrides.items || [baseItem],
    relationships: {
      upstream: [{ type: 'PURCHASE_ORDER', id: 'purchase-order-1', documentNo: 'PO-20260928-008' }],
      downstream: status === 'CONFIRMED' ? [{ type: 'SUPPLIER_BILL', id: 'bill-1', documentNo: 'PB-20261001-003', status: 'DRAFT' }] : [],
      subledger: status === 'CONFIRMED' ? { id: 'ap-1', documentNo: 'AP-20261001-003', status: 'OPEN' } : null,
    },
    ...overrides,
  };
}

const fixtures = {
  draft: receipt({ id: 'receipt-draft', qualityState: { code: 'NOT_INSPECTED', label: '未检验' } }),
  draftInspection: receipt({ id: 'receipt-inspection', qualityState: { code: 'INSPECTION_DRAFT', label: '检验草稿' } }),
  draftPass: receipt({ id: 'receipt-pass', qualityState: { code: 'PASS', label: '检验合格' } }),
  draftWaived: receipt({ id: 'receipt-waived', qualityState: { code: 'WAIVED', label: '按质量策略免检' } }),
  draftFail: receipt({ id: 'receipt-fail', qualityState: { code: 'FAIL', label: '检验不合格' } }),
  draftStale: receipt({ id: 'receipt-stale', qualityState: { code: 'STALE', label: '检验已失效，需复检' } }),
  confirmed: receipt({ id: 'receipt-confirmed', status: 'CONFIRMED', qualityState: { code: 'PASS', label: '检验合格' } }),
  cancelled: receipt({ id: 'receipt-cancelled', status: 'CANCELLED', qualityState: { code: 'NOT_INSPECTED', label: '未检验' } }),
  archived: receipt({
    id: 'receipt-archived',
    status: 'CANCELLED',
    qualityState: { code: 'NOT_INSPECTED', label: '未检验' },
    archiveState: { archived: true, archivedAt: '2026-09-30T10:00:00.000Z', reason: '已取消单据不再参与日常业务处理' },
  }),
  longtext: receipt({
    id: 'receipt-longtext',
    receipt_no: 'PR-20260930-EXTREMELY-LONG-DOCUMENT-NUMBER-FOR-OVERFLOW-001',
    supplierName: '福建精工电子自动化设备有限公司长乐临空经济区第二制造中心',
    warehouseName: '福州马尾保税区原材料中央仓一号库位',
    total_cents: 98765432100,
    qualityState: { code: 'STALE', label: '检验已失效，需复检' },
    items: Array.from({ length: 11 }, (_, index) => ({
      ...baseItem,
      id: `long-line-${index}`,
      purchaseOrderItemId: `long-po-line-${index}`,
      productCode: `RM-PCB100-VERY-LONG-PRODUCT-CODE-${index + 1}`,
      productName: `核心控制模块工业级耐高温特别版第 ${index + 1} 批`,
      trackingAllocations: [],
    })),
  }),
};

const listFixtures = [
  fixtures.draft,
  fixtures.draftInspection,
  fixtures.draftPass,
  fixtures.draftWaived,
  fixtures.draftFail,
  fixtures.draftStale,
  fixtures.confirmed,
  receipt({ id: 'receipt-confirmed-full', status: 'CONFIRMED', billedQuantity: 120, remainingBillQuantity: 0, qualityState: { code: 'PASS', label: '检验合格' } }),
  fixtures.cancelled,
  fixtures.archived,
  fixtures.longtext,
];

const suppliers = [{ id: 'supplier-1', code: 'SUP-001', name: '福建精工电子有限公司' }];
const warehouses = [{ id: 'warehouse-1', code: 'RM-01', name: '原材料仓' }];
const products = [{ id: 'product-lot', code: 'RM-PCB100', name: '核心控制模块', unit: '块', active: true, trackingPolicy: 'LOT' }];
const purchaseOrders = [{
  id: 'purchase-order-1',
  orderNo: 'PO-20260928-008',
  supplierId: 'supplier-1',
  supplierName: '福建精工电子有限公司',
  items: [{ ...baseItem, id: undefined, quantity: 120, trackingAllocations: [] }],
}];

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installRoutes(context, { list = listFixtures, detailById = fixtures } = {}) {
  await context.route('**/api/purchase-receipts?**', async (route) => {
    const url = new URL(route.request().url());
    const includeArchived = url.searchParams.get('includeArchived') === 'true';
    const status = url.searchParams.get('status');
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const rows = list.filter((item) =>
      (includeArchived || !item.archiveState?.archived) &&
      (!status || item.status === status) &&
      (!search || item.receipt_no.toLowerCase().includes(search) || item.supplierName.toLowerCase().includes(search)),
    );
    await json(route, { purchaseReceipts: rows });
  });
  await context.route('**/api/purchase-receipts/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    const found = Object.values(detailById).find((item) => item.id === id) || list.find((item) => item.id === id);
    await json(route, { purchaseReceipt: found });
  });
  await context.route('**/api/lookup/suppliers', (route) => json(route, { suppliers }));
  await context.route('**/api/warehouses', (route) => json(route, { warehouses }));
  await context.route('**/api/products', (route) => json(route, { products }));
  await context.route('**/api/lookup/purchase-orders-source', (route) => json(route, { purchaseOrders }));
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function assertLayout(page, file, width, selector, { actionBar = false } = {}) {
  const metrics = await page.evaluate(({ selector, actionBar }) => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    const action = actionBar ? document.querySelector(`${selector}__action-bar`)?.getBoundingClientRect() : null;
    const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width || 0,
      actionBottom: action?.bottom || 0,
      navTop: nav?.top || 0,
    };
  }, { selector, actionBar });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${file}: horizontal overflow`);
  assert.ok(metrics.shellWidth <= Math.min(680, width) + 1, `${file}: shell exceeds rail`);
  if (actionBar && metrics.actionBottom) assert.ok(metrics.actionBottom <= metrics.navTop, `${file}: action bar collides with nav`);
  const smallTargets = await page.locator(`${selector} button`).evaluateAll((nodes) => nodes
    .filter((node) => getComputedStyle(node).display !== 'none')
    .map((node) => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height }))
    .filter((item) => item.height > 0 && item.height < 43.5));
  assert.deepEqual(smallTargets, [], `${file}: touch targets below 44px: ${JSON.stringify(smallTargets)}`);
}

async function saveScreenshot(page, file) {
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
}

async function newPage(token, width, { analyzeAllowed = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installRoutes(context);
  if (analyzeAllowed !== null) {
    await context.route('**/api/lifecycle/analyze?**', (route) => json(route, {
      archiveEligibility: analyzeAllowed
        ? { allowed: true, blockers: [] }
        : { allowed: false, blockers: [{ code: 'DOWNSTREAM_EXISTS', message: '存在下游单据，当前不能归档' }] },
    }));
  }
  const page = await context.newPage();
  const errors = collectErrors(page);
  return { context, page, errors };
}

async function captureList(token, width) {
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
  try {
    await page.locator('.v16-purchase-receipt-list').waitFor({ timeout: 10000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Purchase receipt list did not render at ${width}px. Browser errors: ${errors.join(' | ')}. Body: ${body.slice(0, 1200)}`, { cause: error });
  }
  const file = `purchase-receipts-${width}.png`;
  await assertLayout(page, file, width, '.v16-purchase-receipts');
  assert.equal(await page.locator('.compact-record').count(), 0, `${file}: CompactRecord remains`);
  assert.equal(await page.locator('.business-page-header').count(), 0, `${file}: duplicate title remains`);
  assert.equal(await page.locator('[data-testid="purchase-receipt-row-receipt-archived"]').count(), 0, `${file}: archived row visible by default`);
  await page.locator('[data-testid="purchase-receipt-archive-toggle"]').click();
  await page.locator('[data-testid="purchase-receipt-row-receipt-archived"]').waitFor({ timeout: 5000 });
  assert.ok(await page.locator('[data-testid="purchase-receipt-row-receipt-archived"]').count(), `${file}: archive toggle did not reveal archived row`);
  await page.locator('[data-testid="purchase-receipt-archive-toggle"]').click();
  await page.locator('[data-testid="purchase-receipt-row-receipt-archived"]').waitFor({ state: 'detached', timeout: 5000 });
  await page.locator('.v16-purchase-receipt-list').waitFor({ timeout: 5000 });
  if (width === 390) {
    const useful = await page.locator('.v16-purchase-receipt-row').evaluateAll((rows) => {
      const navTop = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect().top || innerHeight;
      return rows.filter((row) => { const rect = row.getBoundingClientRect(); return rect.top < navTop && rect.bottom > 0; }).length;
    });
    assert.ok(useful >= 5, `390 list shows only ${useful} useful rows`);
  }
  assert.deepEqual(errors, [], `${file}: browser errors: ${errors.join(' | ')}`);
  await saveScreenshot(page, file);
  await context.close();
}

async function captureDetail(token, fixture, scenario, width) {
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
  if (fixture.archiveState?.archived) {
    await page.locator('[data-testid="purchase-receipt-archive-toggle"]').click();
  }
  await page.locator(`[data-testid="purchase-receipt-row-${fixture.id}"] .v16-purchase-receipt-row__open`).click();
  try {
    await page.locator('.v16-purchase-receipt-detail__identity').waitFor({ timeout: 10000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Purchase receipt detail ${scenario} did not render at ${width}px. Browser errors: ${errors.join(' | ')}. Body: ${body.slice(0, 1200)}`, { cause: error });
  }
  const file = `purchase-receipt-detail-${scenario}-${width}.png`;
  await assertLayout(page, file, width, '.v16-purchase-receipt-detail', { actionBar: fixture.status === 'DRAFT' });
  assert.equal(await page.locator('.business-status-group').count(), 0);
  if (fixture.archiveState?.archived) {
    await page.locator('summary', { hasText: '管理' }).click();
    assert.ok(await page.getByText('恢复到业务列表', { exact: true }).count());
  }
  if (fixture.status === 'CANCELLED' && !fixture.archiveState?.archived) {
    await page.locator('summary', { hasText: '管理' }).click();
    assert.ok(await page.getByRole('button', { name: '从列表移除' }).count());
  }
  assert.deepEqual(errors, [], `${file}: browser errors: ${errors.join(' | ')}`);
  await saveScreenshot(page, file);
  await context.close();
}

async function captureEditor(token, width, edit = false) {
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
  if (edit) {
    await page.locator(`[data-testid="purchase-receipt-row-${fixtures.draftPass.id}"] .v16-purchase-receipt-row__open`).click();
    await page.locator('[data-testid="purchase-receipt-action-secondary"]').waitFor({ timeout: 10000 });
    await page.locator('[data-testid="purchase-receipt-action-secondary"]').click();
  } else {
    await page.locator('[data-testid="purchase-receipt-new"]').click();
  }
  await page.locator('.v16-purchase-receipt-editor form').waitFor({ timeout: 10000 });
  if (!edit) await page.locator('select').first().selectOption('purchase-order-1');
  const scenario = edit ? 'edit' : 'new';
  const file = `purchase-receipt-editor-${scenario}-${width}.png`;
  await assertLayout(page, file, width, '.v16-purchase-receipt-editor', { actionBar: true });
  assert.equal(await page.locator('.modal, .line-table, .line-header').count(), 0, `${file}: legacy editor surface remains`);
  assert.ok(await page.locator('.tracking-editor').count(), `${file}: tracking editor unavailable`);
  assert.deepEqual(errors, [], `${file}: browser errors: ${errors.join(' | ')}`);
  await saveScreenshot(page, file);
  await context.close();
}

async function assertQualityMatrix(token) {
  const cases = [
    [fixtures.draft, '创建 IQC'],
    [fixtures.draftInspection, '前往 IQC'],
    [fixtures.draftPass, '确认入库'],
    [fixtures.draftWaived, '确认入库'],
    [fixtures.draftFail, '创建 IQC 复检'],
    [fixtures.draftStale, '创建 IQC 复检'],
  ];
  for (const [fixture, expected] of cases) {
    const { context, page, errors } = await newPage(token, 390);
    await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
    await page.locator(`[data-testid="purchase-receipt-row-${fixture.id}"] .v16-purchase-receipt-row__open`).click();
    const action = page.locator('[data-testid="purchase-receipt-action-primary"]');
    await action.waitFor({ timeout: 10000 });
    assert.equal((await action.innerText()).trim(), expected, `${fixture.qualityState.code}: wrong primary action`);
    assert.deepEqual(errors, [], `${fixture.qualityState.code}: browser errors: ${errors.join(' | ')}`);
    await context.close();
  }
}

async function assertArchiveGate(token) {
  for (const allowed of [false, true]) {
    const { context, page, errors } = await newPage(token, 390, { analyzeAllowed: allowed });
    await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
    await page.locator(`[data-testid="purchase-receipt-row-${fixtures.cancelled.id}"] .v16-purchase-receipt-row__open`).click();
    await page.locator('summary', { hasText: '管理' }).click();
    await page.getByRole('button', { name: '从列表移除' }).click();
    if (allowed) {
      await page.getByText('从业务列表移除？', { exact: true }).waitFor({ timeout: 5000 });
    } else {
      await page.getByText('存在下游单据，当前不能归档', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByText('从业务列表移除？', { exact: true }).count(), 0, 'blocked archive opened confirmation');
    }
    assert.deepEqual(errors, [], `archive allowed=${allowed}: browser errors: ${errors.join(' | ')}`);
    await context.close();
  }
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    await captureList(token, width);
    await captureDetail(token, fixtures.draft, 'draft', width);
    await captureDetail(token, fixtures.confirmed, 'confirmed', width);
    await captureDetail(token, fixtures.cancelled, 'cancelled', width);
    await captureDetail(token, fixtures.archived, 'archived', width);
    await captureDetail(token, fixtures.longtext, 'longtext', width);
    await captureEditor(token, width, false);
    await captureEditor(token, width, true);
  }
  await assertQualityMatrix(token);
  await assertArchiveGate(token);

  process.stdout.write(`${JSON.stringify({ ok: true, screenshots }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
