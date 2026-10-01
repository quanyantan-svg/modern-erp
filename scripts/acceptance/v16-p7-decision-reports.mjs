import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p7-visual');
const widths = [390, 320, 430, 680];
const screenshots = [];
let browser;
let baseUrl;

const longCustomerName = '上海前海跨国供应链管理服务有限公司华东大区配送结算中心';
const longSupplierName = '深圳光明新区精密电子元器件制造集团采购仓储总仓二十号';
const longProductCode = 'RM-ULTRA-LONG-PART-CODE-2026-P7-MOBILE-EDGE-EXTREME-VARIANT-001';
const longProductName = '工业智能边缘控制终端耐高温高湿防护外壳超长产品名称测试版本';
const longOrderNumber = 'SO-20261001-EXTREMELY-LONG-CONTROL-CODE-2026-P7-EDGE-CHECK-001';
const longSupplierOrderNumber = 'PO-20261001-EXTREMELY-LONG-PURCHASE-CODE-2026-P7-EDGE-CHECK-001';
const longSourceNo = 'PR-20261001-LONG-INVENTORY-MOVEMENT-SOURCE-NUMBER-2026-P7';
const longWarehouseName = '上海松江出口加工区保税仓一号库位';
const customer = { id: 'customer-1', code: 'CUST-LONG-2026-P7', name: longCustomerName, active: 1 };
const supplier = { id: 'supplier-1', code: 'SUP-LONG-2026-P7', name: longSupplierName, active: 1 };
const product = { id: 'product-1', code: longProductCode, name: longProductName, unit: '件', active: 1, trackingPolicy: 'NONE' };
const warehouse = { id: 'warehouse-1', code: 'WH-LONG-2026-P7', name: longWarehouseName, active: 1 };

const longSalesSummary = {
  summary: {
    orderCount: 12345,
    orderCents: 98765432100,
    approvedOrderCount: 10234,
    deliveryCount: 8910,
    deliveryCents: 76543210987,
    returnCount: 56,
    returnCents: 12345678,
    netShipmentCents: 76530865309,
  },
  byCustomer: [
    { customerId: customer.id, customerCode: customer.code, customerName: customer.name, orderCount: 8000, orderCents: 50000000000, deliveryCents: 45000000000 },
    { customerId: 'customer-2', customerCode: 'CUST-002', customerName: '北京永盛', orderCount: 4345, orderCents: 48765432100, deliveryCents: 31543210987 },
  ],
  filters: { dateFrom: '2026-10-01', dateTo: '2026-10-31', customer: { id: customer.id, code: customer.code, name: customer.name, active: 1 } },
  dateBasis: { order: '订单按订单日期（sales_orders.order_date）', shipment: '出货按出货日期（sales_deliveries.delivery_date）', return: '退货按退货日期（return_orders.return_date）' },
  legacyMissing: { orderWithoutDate: 0, deliveryWithoutDate: 0, returnWithoutDate: 0, total: 0 },
  moneyUnit: 'cents',
  notes: '订单金额来自 sales_orders.total_cents，按 order_date 归集；实际出货金额来自 CONFIRMED 销售出库，按 delivery_date 归集；销售退货金额来自 CONFIRMED source_type=SALES 退货单，按 return_date 归集；净出货金额 = 出货金额 - 退货金额；订单金额不等于已实现收入。',
};

const salesSummaryLegacy = { ...longSalesSummary, legacyMissing: { orderWithoutDate: 3, deliveryWithoutDate: 2, returnWithoutDate: 1, total: 6 }, notes: '订单金额来自 sales_orders.total_cents，按 order_date 归集；订单金额不等于已实现收入；业务日期缺失共 6 条，未计入上方指标，已在 legacyMissing 字段按指标分解。' };
const salesSummaryEmpty = { ...longSalesSummary, summary: { ...longSalesSummary.summary, orderCount: 0, orderCents: 0, approvedOrderCount: 0, deliveryCount: 0, deliveryCents: 0, returnCents: 0, netShipmentCents: 0 }, byCustomer: [], legacyMissing: { orderWithoutDate: 0, deliveryWithoutDate: 0, returnWithoutDate: 0, total: 0 }, notes: '订单金额来自 sales_orders.total_cents，按 order_date 归集；订单金额不等于已实现收入。' };

const longPurchaseSummary = {
  summary: {
    orderCount: 6789,
    orderCents: 87654321000,
    approvedOrderCount: 5555,
    receiptCount: 4321,
    receiptCents: 65432109876,
    returnCount: 12,
    returnCents: 4321098,
    netReceiptCents: 65427788778,
  },
  bySupplier: [
    { supplierId: supplier.id, supplierCode: supplier.code, supplierName: supplier.name, orderCount: 4000, orderCents: 50000000000, receiptCents: 42000000000 },
    { supplierId: 'supplier-2', supplierCode: 'SUP-002', supplierName: '苏州精密', orderCount: 2789, orderCents: 37654321000, receiptCents: 23432109876 },
  ],
  filters: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
  dateBasis: { order: '订单按订单日期（purchase_orders.order_date）', receipt: '入库按入库日期（purchase_receipts.receipt_date）', return: '退货按退货日期（purchase_returns.return_date）' },
  legacyMissing: { orderWithoutDate: 0, receiptWithoutDate: 0, returnWithoutDate: 0, total: 0 },
  moneyUnit: 'cents',
  notes: '订单金额来自 purchase_orders.total_cents，按 order_date 归集；实际入库金额来自 CONFIRMED 采购入库单，按 receipt_date 归集；采购退货金额来自 CONFIRMED 采购退货单，按 return_date 归集；净入库金额 = 入库金额 - 退货金额；订单金额不等于已实现成本。',
};

const orderItem = {
  orderItemId: 'oi-1',
  orderId: 'order-1',
  orderNumber: longOrderNumber,
  lineNumber: 1,
  orderedQuantity: 100.500000,
  fulfilledQuantity: 30.250000,
  remainingQuantity: 70.250000,
  commitmentDate: '2026-09-15',
  overdue: true,
  overdueDays: 16,
  fulfillmentStatus: 'PARTIAL',
  contributionCount: 3,
  accuracyStatus: 'COMPLETE',
  legacyAccuracyLimited: false,
  overFulfilledQuantity: 0,
  customer: customer,
  supplier: supplier,
  product: product,
};

const overdueItem = { ...orderItem, orderItemId: 'oi-overdue', orderNumber: 'SO-20261001-OVERDUE', fulfillmentStatus: 'UNFULFILLED', remainingQuantity: 100.500000, fulfilledQuantity: 0, overdue: true, overdueDays: 30 };
const overfulfilledItem = { ...orderItem, orderItemId: 'oi-over', orderNumber: 'SO-20261001-OVER', orderedQuantity: 50, fulfilledQuantity: 60, remainingQuantity: 0, fulfillmentStatus: 'OVER_FULFILLED', overFulfilledQuantity: 10, commitmentDate: '2026-10-15', overdue: false };
const noCommitmentItem = { ...orderItem, orderItemId: 'oi-no-commit', orderNumber: 'SO-20261001-NOCOMMIT', commitmentDate: null, overdue: false, fulfillmentStatus: 'UNFULFILLED', remainingQuantity: 200, fulfilledQuantity: 0 };
const hiddenFulfilledOnly = { rows: [], population: { matchingLines: 8, hiddenFulfilledLines: 8, returnedLines: 0 }, asOfDate: '2026-10-01', accuracyNotice: null, accuracyStatus: 'COMPLETE' };
const purchaseOutstandingReady = {
  rows: [{ ...orderItem, orderNumber: longSupplierOrderNumber, customer: undefined, supplier, remainingQuantity: 50.5 }],
  population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 },
  asOfDate: '2026-10-01',
  accuracyNotice: null,
  accuracyStatus: 'COMPLETE',
};
const purchaseOutstandingOverdue = {
  rows: [{ ...overdueItem, orderNumber: longSupplierOrderNumber, customer: undefined, supplier }],
  population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 },
  asOfDate: '2026-10-01',
  accuracyNotice: null,
  accuracyStatus: 'COMPLETE',
};

const movementRow = {
  id: 'movement-1',
  business_date: '2026-10-01',
  warehouse_id: warehouse.id,
  warehouseCode: warehouse.code,
  warehouseName: warehouse.name,
  product_id: product.id,
  productCode: product.code,
  productName: product.name,
  direction: 'IN',
  quantity_change: 123456.123456,
  balance_after: 999999.876543,
  source_type: 'PURCHASE_RECEIPT',
  source_id: 'pr-1',
  source_no: longSourceNo,
  source_type_label: '采购入库',
  direction_label: '入库',
  businessDate: '2026-10-01',
  businessDateMissing: 0,
};
const movementMissingDate = { ...movementRow, id: 'movement-missing', business_date: null, businessDate: null, businessDateMissing: 1, source_no: null };
const inventoryReady = {
  rows: [movementRow, { ...movementRow, id: 'movement-2', direction: 'OUT', quantity_change: -50.5, balance_after: 999949.376543, source_type: 'SALES_DELIVERY', source_type_label: '销售出货', source_no: 'SO-OUT-20261001-001' }],
  filters: { dateFrom: '2026-10-01', dateTo: '2026-10-31', product: { id: product.id, code: product.code, name: product.name, active: 1 }, warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, active: 1 } },
  dateBasis: { flow: '库存异动按库存交易台账业务日期（inventory_transactions.business_date）；缺失时固定显示"业务日期缺失"。', column: 'inventory_transactions.business_date' },
  legacyMissing: { withoutBusinessDate: 0 },
  reconciliation: { currentQuantity: 999949.376543, latestMovementBalance: 999949.376543, reconcilesToCurrent: true, note: '核对使用该货品/仓库的最新完整流水余额；当前库存以 inventory 为准，不推导历史期初。' },
};
const inventoryReconciled = inventoryReady;
const inventoryMismatch = { ...inventoryReady, reconciliation: { ...inventoryReady.reconciliation, reconcilesToCurrent: false, latestMovementBalance: 999800.123 } };
const inventoryInsufficient = { ...inventoryReady, reconciliation: { ...inventoryReady.reconciliation, latestMovementBalance: null, reconcilesToCurrent: null, note: '当前组合没有足够的流水历史，无法推导历史期初；当前库存以 inventory 为准。' } };
const inventoryMissingDate = { ...inventoryReady, rows: [movementMissingDate, ...inventoryReady.rows.slice(1)], legacyMissing: { withoutBusinessDate: 1 } };

const contributions = {
  reportKey: 'sales-outstanding',
  orderLine: { orderId: 'order-1', orderNumber: longOrderNumber, orderItemId: 'oi-1', lineNumber: 1, orderedQuantity: 100.5 },
  executedQuantity: 30.25,
  contributions: [
    { sourceDocumentType: 'SALES_DELIVERY', sourceDocumentLabel: '销售出货', sourceDocumentId: 'sd-1', sourceDocumentNumber: 'SD-20261001-001', sourceLineId: 'sdi-1', sourceLineNumber: 1, businessDate: '2026-09-28', quantity: 20.5, warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name }, status: 'CONFIRMED', linkage: 'EXACT_ORDER_LINE' },
    { sourceDocumentType: 'SALES_DELIVERY', sourceDocumentLabel: '销售出货', sourceDocumentId: 'sd-2', sourceDocumentNumber: 'SD-20261001-002', sourceLineId: 'sdi-2', sourceLineNumber: 1, businessDate: '2026-09-30', quantity: 9.75, warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name }, status: 'CONFIRMED', linkage: 'EXACT_ORDER_LINE' },
  ],
  accuracyStatus: 'COMPLETE',
  informationalItems: [],
};
const emptyContributions = { ...contributions, contributions: [], executedQuantity: 0 };

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
async function json(route, body, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }

async function installRoutes(context) {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/lookups/business-entities') {
      const type = url.searchParams.get('type') || 'CUSTOMER';
      const map = { CUSTOMER: [customer], SUPPLIER: [supplier], PRODUCT: [product], WAREHOUSE: [warehouse] };
      return json(route, { items: map[type] || [] });
    }
    if (path === '/api/reports/decision/sales-summary') return json(route, scenarioSet.sales);
    if (path === '/api/reports/decision/sales-outstanding') return json(route, scenarioSet.salesOutstanding);
    if (path === '/api/reports/decision/purchase-summary') return json(route, scenarioSet.purchaseSummary);
    if (path === '/api/reports/decision/purchase-outstanding') return json(route, scenarioSet.purchaseOutstanding);
    if (path === '/api/reports/decision/inventory-movements') return json(route, scenarioSet.inventoryMovements);
    if (path === '/api/reports/decision/sales-summary/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="sales-summary.csv"' }, body: '﻿# sales-summary\norder,1234\n' });
    if (path === '/api/reports/decision/sales-outstanding/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="sales-outstanding.csv"' }, body: '﻿# sales-outstanding\norder,1234\n' });
    if (path === '/api/reports/decision/purchase-summary/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="purchase-summary.csv"' }, body: '﻿# purchase-summary\norder,1234\n' });
    if (path === '/api/reports/decision/purchase-outstanding/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="purchase-outstanding.csv"' }, body: '﻿# purchase-outstanding\norder,1234\n' });
    if (path === '/api/reports/decision/inventory-movements/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="inventory-movements.csv"' }, body: '﻿# inventory-movements\norder,1234\n' });
    if (/^\/api\/reports\/[^/]+\/lines\/[^/]+\/contributions$/.test(path)) return json(route, scenarioSet.contributions);
    return route.continue();
  });
}

let scenarioSet = {
  sales: longSalesSummary,
  salesOutstanding: { rows: [orderItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01', accuracyNotice: null, accuracyStatus: 'COMPLETE' },
  purchaseSummary: longPurchaseSummary,
  purchaseOutstanding: purchaseOutstandingReady,
  inventoryMovements: inventoryReady,
  contributions,
};

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function newPage(token, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installRoutes(context);
  const page = await context.newPage();
  return { context, page, errors: collectErrors(page) };
}

async function assertLayout(page, file, { switcherOpen = false, contributionOpen = false } = {}) {
  const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, shell: document.querySelector('.v16-decision-reports')?.getBoundingClientRect().width || 0 }));
  assert.ok(metrics.scroll <= metrics.client, `${file}: horizontal overflow ${metrics.scroll}/${metrics.client}`);
  assert.ok(metrics.shell <= Math.min(680, metrics.client) + 1, `${file}: shell exceeds rail`);
  assert.equal(await page.locator('[data-testid="mobile-header-back"]').count(), 1, `${file}: shell must own one back action`);
  assert.equal(await page.locator('.v16-decision-reports .record-card, .v16-decision-reports .compact-record, .v16-decision-reports .responsive-business-list, .v16-decision-reports .panel, .v16-decision-reports .modal').count(), 0, `${file}: legacy primary surface`);
  const shortTargets = await page.locator('.v16-decision-reports button, .v16-decision-reports input, .v16-decision-reports select').evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height })).filter((item) => item.height > 0 && item.height < 43.5));
  assert.deepEqual(shortTargets, [], `${file}: targets below 44px ${JSON.stringify(shortTargets)}`);
}

async function save(page, file) {
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(outputDir, file);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
}

async function capture(token, width, file, scenario, action) {
  scenarioSet = scenario;
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#decision-reports`, { waitUntil: 'networkidle' });
  await page.locator('.v16-decision-reports').waitFor();
  if (action) await action(page);
  await page.waitForTimeout(120);
  await assertLayout(page, file);
  assert.deepEqual(errors, [], `${file}: browser errors`);
  await save(page, file);
  await context.close();
}

async function captureSwitcher(token, width) {
  scenarioSet = { ...scenarioSet, sales: longSalesSummary };
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#decision-reports`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
  await page.locator('[data-testid="decision-report-switcher-option-purchase-summary"]').waitFor();
  const file = `report-switcher-${width}.png`;
  await assertLayout(page, file);
  assert.deepEqual(errors, [], `${file}: browser errors`);
  await save(page, file);
  await context.close();
}

async function captureContribution(token, width, scenario, file, action) {
  scenarioSet = scenario;
  const { context, page, errors } = await newPage(token, width);
  await page.goto(`${baseUrl}#decision-reports`, { waitUntil: 'networkidle' });
  await page.locator('.v16-decision-reports').waitFor();
  if (action) await action(page);
  await page.waitForTimeout(120);
  await assertLayout(page, file);
  assert.deepEqual(errors, [], `${file}: browser errors`);
  await save(page, file);
  await context.close();
}

async function actionsFor(reportKey) {
  return {
    salesSummary: null,
    salesOutstandingOverdue: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-sales-outstanding"]').click();
      await page.locator('.v16-decision-reports__fulfillment-row').first().waitFor();
    },
    salesOutstandingContributions: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-sales-outstanding"]').click();
      await page.locator('.v16-decision-reports__fulfillment-row').first().waitFor();
      await page.locator('[data-testid^="sales-outstanding-contributions-"]').first().click();
      // Sheet renders as a dialog; wait for the Sheet body to appear with the list.
      await page.locator('.sheet').waitFor();
      await page.locator('.v16-decision-reports__contribution-list').waitFor({ timeout: 5000 }).catch(() => null);
      // If list still not present (e.g. contributions array is empty), check for empty state instead.
      if (await page.locator('.v16-decision-reports__contribution-list').count() === 0) {
        await page.locator('.v16-decision-reports__contribution-empty').waitFor({ timeout: 3000 });
      }
    },
    salesOutstandingAllFulfilled: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-sales-outstanding"]').click();
      await page.getByText('匹配行均已履行', { exact: true }).waitFor();
    },
    purchaseSummary: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-purchase-summary"]').click();
      await page.locator('[data-testid="decision-report-metric-grid"]').first().waitFor();
    },
    purchaseOutstandingOverdue: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-purchase-outstanding"]').click();
      await page.locator('.v16-decision-reports__fulfillment-row').first().waitFor();
    },
    purchaseOutstandingContributions: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-purchase-outstanding"]').click();
      await page.locator('.v16-decision-reports__fulfillment-row').first().waitFor();
      await page.locator('[data-testid^="purchase-outstanding-contributions-"]').first().click();
      await page.locator('.v16-decision-reports__contribution-list').waitFor();
    },
    inventoryMovements: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
      await page.locator('.v16-decision-reports__movement-row').first().waitFor();
    },
    inventoryMovementsReconciled: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
      await page.locator('.v16-decision-reports__movement-row').first().waitFor();
    },
    inventoryMovementsMismatch: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
      await page.locator('.v16-decision-reports__movement-row').first().waitFor();
    },
    inventoryMovementsInsufficient: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
      await page.locator('.v16-decision-reports__movement-row').first().waitFor();
    },
    inventoryMovementsMissingDate: async (page) => {
      await page.locator('[data-testid="decision-report-switcher-trigger"]').click();
      await page.locator('[data-testid="decision-report-switcher-option-inventory-movements"]').click();
      await page.locator('.v16-decision-reports__movement-row').first().waitFor();
    },
  }[reportKey];
}

let server;
let db;
let tempDir;
try {
  mkdirSync(outputDir, { recursive: true });
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p7-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  const scenarios = [
    // 390px primary coverage
    { width: 390, file: 'sales-summary-390.png', scenario: { ...scenarioSet, sales: longSalesSummary } },
    { width: 390, file: 'sales-summary-legacy-390.png', scenario: { ...scenarioSet, sales: salesSummaryLegacy } },
    { width: 390, file: 'sales-summary-empty-390.png', scenario: { ...scenarioSet, sales: salesSummaryEmpty } },
    { width: 390, file: 'sales-outstanding-390.png', scenario: { ...scenarioSet, salesOutstanding: { rows: [orderItem, overdueItem, overfulfilledItem, noCommitmentItem], population: { matchingLines: 4, hiddenFulfilledLines: 0, returnedLines: 4 }, asOfDate: '2026-10-01' } }, action: 'salesOutstandingOverdue' },
    { width: 390, file: 'sales-outstanding-overdue-390.png', scenario: { ...scenarioSet, salesOutstanding: { rows: [overdueItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01' } }, action: 'salesOutstandingOverdue' },
    { width: 390, file: 'sales-outstanding-overfulfilled-390.png', scenario: { ...scenarioSet, salesOutstanding: { rows: [overfulfilledItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01' } }, action: 'salesOutstandingOverdue' },
    { width: 390, file: 'sales-outstanding-all-fulfilled-390.png', scenario: { ...scenarioSet, salesOutstanding: hiddenFulfilledOnly } },
    { width: 390, file: 'purchase-summary-390.png', scenario: { ...scenarioSet, purchaseSummary: longPurchaseSummary } },
    { width: 390, file: 'purchase-outstanding-390.png', scenario: { ...scenarioSet, purchaseOutstanding: purchaseOutstandingReady }, action: 'purchaseOutstandingOverdue' },
    { width: 390, file: 'purchase-outstanding-overdue-390.png', scenario: { ...scenarioSet, purchaseOutstanding: purchaseOutstandingOverdue }, action: 'purchaseOutstandingOverdue' },
    { width: 390, file: 'inventory-movements-390.png', scenario: { ...scenarioSet, inventoryMovements: inventoryReady } },
    { width: 390, file: 'inventory-movements-reconciled-390.png', scenario: { ...scenarioSet, inventoryMovements: inventoryReconciled } },
    { width: 390, file: 'inventory-movements-mismatch-390.png', scenario: { ...scenarioSet, inventoryMovements: inventoryMismatch } },
    { width: 390, file: 'inventory-movements-insufficient-history-390.png', scenario: { ...scenarioSet, inventoryMovements: inventoryInsufficient } },
    { width: 390, file: 'inventory-movements-missing-business-date-390.png', scenario: { ...scenarioSet, inventoryMovements: inventoryMissingDate } },
    // Contribution surfaces
    { width: 390, file: 'contribution-sales-ready-390.png', scenario: { ...scenarioSet, salesOutstanding: { rows: [orderItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01' }, contributions }, action: 'salesOutstandingContributions' },
    { width: 390, file: 'contribution-sales-empty-390.png', scenario: { ...scenarioSet, salesOutstanding: { rows: [orderItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01' }, contributions: emptyContributions }, action: 'salesOutstandingContributions' },
    { width: 390, file: 'contribution-purchase-ready-390.png', scenario: { ...scenarioSet, purchaseOutstanding: purchaseOutstandingReady, contributions: { ...contributions, reportKey: 'purchase-outstanding' } }, action: 'purchaseOutstandingContributions' },
  ];

  for (const { width, file, scenario, action } of scenarios) {
    const actionFn = action ? await actionsFor(action) : null;
    if (actionFn) {
      await captureContribution(token, width, scenario, file, actionFn);
    } else {
      await capture(token, width, file, scenario, null);
    }
  }

  // Switcher coverage
  for (const width of [320, 390]) await captureSwitcher(token, width);

  // Representative responsive coverage at 320 / 430 / 680
  for (const width of [320, 430, 680]) {
    await capture(token, width, `sales-summary-${width}.png`, { ...scenarioSet, sales: longSalesSummary });
    await capture(token, width, `inventory-movements-${width}.png`, { ...scenarioSet, inventoryMovements: inventoryReady });
    await captureContribution(token, width, { ...scenarioSet, salesOutstanding: { rows: [orderItem], population: { matchingLines: 1, hiddenFulfilledLines: 0, returnedLines: 1 }, asOfDate: '2026-10-01' }, contributions }, `contribution-sales-ready-${width}.png`, (await actionsFor('salesOutstandingContributions')));
  }

  process.stdout.write(`${JSON.stringify({ ok: true, screenshots }, null, 2)}\n`);
} finally {
  await browser?.close();
  server?.closeAllConnections?.();
  if (server?.listening) await new Promise((done) => server.close(done));
  if (db) db.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
