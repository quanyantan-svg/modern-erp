import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p6-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p6-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser; let baseUrl; const screenshots = [];

const warehouse = { id: 'wh-1', code: 'WH-SH-01', name: '上海中心仓', active: 1 };
const warehouse2 = { id: 'wh-2', code: 'WH-SZ-02', name: '苏州装配仓', active: 1 };
const product = { id: 'product-1', code: 'RM-ULTRA-LONG-CONTROL-MODULE-2026', name: '工业智能控制模块耐高温长名称版本', unit: '件', active: 1, trackingPolicy: 'NONE' };
const stock = { warehouse_id: 'wh-1', product_id: 'product-1', warehouseName: warehouse.name, productCode: product.code, productName: product.name, unit: '件', quantity: 123456.123456, recentMovementAt: '2026-10-01T08:30:00Z' };
const transfer = { id: 'transfer-1', transfer_no: 'TR-20261001-000001-LONG', status: 'DRAFT', business_date: '2026-10-01', fromWarehouseName: warehouse.name, toWarehouseName: warehouse2.name, creatorName: '仓库管理员', itemCount: 1, remark: '装配备料调拨', items: [{ id: 'ti-1', productName: product.name, productCode: product.code, unit: '件', quantity: 18, line_no: 1 }] };
const check = { id: 'check-1', check_no: 'IC-20261001-000001', status: 'SUBMITTED', business_date: '2026-10-01', warehouse_id: 'wh-1', product_id: 'product-1', warehouseName: warehouse.name, productCode: product.code, productName: product.name, creatorName: '仓库管理员', system_quantity: 120, actual_quantity: 118, difference: -2, reason: '月度循环盘点', trackingAllocations: [] };
const adjustment = { id: 'adjust-1', adjustment_no: 'IA-20261001-000001', status: 'DRAFT', adjustment_date: '2026-10-01', warehouse_id: 'wh-1', warehouseName: warehouse.name, creatorName: '仓库管理员', reason: '盘盈纠正', itemCount: 1, items: [{ id: 'ai-1', productId: 'product-1', productName: product.name, productCode: product.code, unit: '件', quantityDelta: 3, trackingAllocations: [] }] };
const scrap = { id: 'scrap-1', scrapNo: 'SC-20261001-000001', scrap_no: 'SC-20261001-000001', status: 'DRAFT', scrapDate: '2026-10-01', scrap_date: '2026-10-01', reason: '质量隔离后判废', notes: '整单原子确认验证', itemCount: 1, totalQuantity: 4, creatorName: '仓库管理员', items: [{ id: 'si-1', warehouseId: 'wh-1', productId: 'product-1', warehouseName: warehouse.name, productName: product.name, productCode: product.code, productUnit: '件', quantity: 4, reason: '检测不合格', trackingAllocations: [] }] };
const precheck = { period: '2026-09', overallStatus: 'WARNING', summary: { blockingCount: 0, warningCount: 1, passCount: 7 }, checks: [{ code: 'PERIOD_ENDED', title: '自然月已结束', severity: 'BLOCKING', status: 'PASS', count: 0 }, { code: 'INACTIVE_OR_LEGACY_REFERENCE', title: '停用或遗留主数据引用', severity: 'WARNING', status: 'FAIL', count: 1, resolution: '确认停用仓库仍应纳入历史快照。' }] };
const closure = { id: 'closure-1', period_key: '2026-09', status: 'CLOSED', snapshotCount: 1, closedByName: '系统管理员', closed_at: '2026-10-01T09:00:00Z', periodRange: { startDate: '2026-09-01', endDate: '2026-09-30' }, summary: { warehouseCount: 1, productCount: 1, totalInQuantity: 88, totalOutQuantity: 42 }, closeChecks: precheck, snapshots: [{ id: 'snapshot-1', productName: product.name, productCode: product.code, warehouseName: warehouse.name, periodInQuantity: 88, periodOutQuantity: 42, closingQuantity: 128 }] };
const movement = { id: 'movement-1', business_date: '2026-10-01', tx_type: 'INVENTORY_TRANSFER', source_id: 'transfer-1', ref_no: transfer.transfer_no, warehouseName: warehouse.name, productName: product.name, productCode: product.code, direction: 'OUT', quantity_change: 18, balance: 105.123456, trackingPolicy: 'NONE' };

async function login() { const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) }); assert.equal(response.status, 200); return (await response.json()).token; }
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function installFixtures(context) {
  await context.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path === '/api/warehouses') return json(route, { warehouses: [warehouse, warehouse2] });
    if (path === '/api/products') return json(route, { products: [product] });
    if (path === '/api/inventory') return json(route, { inventory: [stock] });
    if (path === '/api/inventory/wh-1/product-1') return json(route, { stock, transactions: [{ id: 'tx-1', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-20261001-01', direction: 'IN', quantityChange: 30, balanceAfter: 123.123456, createdAt: '2026-10-01T08:30:00Z' }] });
    if (path === '/api/inventory-transfers') return request.method() === 'GET' ? json(route, { inventoryTransfers: [transfer, { ...transfer, id: 'transfer-legacy', status: 'SUBMITTED', transfer_no: 'TR-LEGACY-APPROVAL' }] }) : json(route, { id: 'transfer-1' }, 201);
    if (path === '/api/inventory-transfers/transfer-1') return json(route, { transfer });
    if (path.startsWith('/api/inventory-transfers/')) return json(route, { ok: true });
    if (path === '/api/inventory-checks') return request.method() === 'GET' ? json(route, { inventoryChecks: [check, { ...check, id: 'check-draft', status: 'DRAFT', check_no: 'IC-DRAFT-0002' }] }) : json(route, { id: 'check-1' }, 201);
    if (path.startsWith('/api/inventory-checks/')) return json(route, { ok: true });
    if (path === '/api/inventory-adjustments') return request.method() === 'GET' ? json(route, { inventoryAdjustments: [adjustment] }) : json(route, { id: 'adjust-1' }, 201);
    if (path === '/api/inventory-adjustments/adjust-1') return json(route, { inventoryAdjustment: adjustment });
    if (path.startsWith('/api/inventory-adjustments/')) return json(route, { ok: true });
    if (path === '/api/inventory-scraps') return request.method() === 'GET' ? json(route, { inventoryScraps: [scrap] }) : json(route, { id: 'scrap-1' }, 201);
    if (path === '/api/inventory-scraps/scrap-1') return json(route, { inventoryScrap: scrap });
    if (path.startsWith('/api/inventory-scraps/')) return json(route, { ok: true });
    if (path === '/api/inventory-period-closures/status') return json(route, { status: { closedThrough: '2026-09', latestPeriod: '2026-09', latestStatus: 'CLOSED', nextClosablePeriod: '2026-10', canClose: true } });
    if (path === '/api/inventory-period-closures/check') return json(route, { precheck });
    if (path === '/api/inventory-period-closures') return request.method() === 'GET' ? json(route, { inventoryPeriodClosures: [closure] }) : json(route, { ok: true });
    if (path === '/api/inventory-period-closures/closure-1') return json(route, { inventoryPeriodClosure: closure });
    if (path.startsWith('/api/inventory-period-closures/')) return json(route, { ok: true });
    if (path === '/api/inventory-transactions') return json(route, { inventoryTransactions: [movement, { ...movement, id: 'movement-2', business_date: null, trackingPolicy: 'LOT', trackingIdentities: '' }] });
    return route.continue();
  });
}
function errorsFor(page) { const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); return errors; }
async function pageAt(token, hash, width) { const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 }); await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token); await installFixtures(context); const page = await context.newPage(); const errors = errorsFor(page); await page.goto(`${baseUrl}#${hash}`, { waitUntil: 'networkidle' }); await page.locator('.v16-inventory-shell').waitFor(); return { context, page, errors }; }
async function verify(page, file, errors) { const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, shells: document.querySelectorAll('.v16-inventory-shell').length })); assert.ok(metrics.scroll <= metrics.client, `${file}: overflow ${metrics.scroll}/${metrics.client}`); assert.equal(metrics.shells, 1, `${file}: expected one inventory shell`); assert.equal(await page.locator('[data-testid="mobile-header-back"]').count(), 1, `${file}: shell must own one back action`); assert.equal(await page.locator('.v16-inventory-shell .panel, .v16-inventory-shell .record-card, .v16-inventory-shell .table-wrap, .v16-inventory-shell > .modal').count(), 0, `${file}: legacy primary surface`); const shortTargets = await page.locator('.v16-inventory-shell button, .v16-inventory-shell a, .v16-inventory-shell input:not([type="checkbox"]), .v16-inventory-shell select').evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height })).filter((item) => item.height > 0 && item.height < 43.5)); assert.deepEqual(shortTargets, [], `${file}: targets below 44px ${JSON.stringify(shortTargets)}`); const collision = await page.evaluate(() => { const action = document.querySelector('.v16-inventory-shell .bottom-action-bar')?.getBoundingClientRect(); const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect(); return action && nav ? action.bottom > nav.top + 1 : false; }); assert.equal(collision, false, `${file}: action bar collides with navigation`); assert.deepEqual(errors, [], `${file}: ${errors.join(' | ')}`); }
async function save(page, file) { await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' }); const target = join(outputDir, file); await page.screenshot({ path: target, fullPage: true }); screenshots.push(target); }
async function capture(token, hash, width, name, action) { const { context, page, errors } = await pageAt(token, hash, width); if (action) await action(page); await page.waitForTimeout(100); await verify(page, name, errors); await save(page, name); await context.close(); }

const actions = {
  stockDetail: async (page) => { await page.locator('.v16-inventory-row').first().click(); await page.getByText('最近库存异动', { exact: true }).waitFor(); },
  transferList: async (page) => { await page.getByRole('button', { name: '调拨', exact: true }).click(); await page.locator('.v16-inventory-row').first().waitFor(); },
  transferEditor: async (page) => { await actions.transferList(page); await page.getByRole('button', { name: '新建库存调拨' }).click(); await page.getByRole('heading', { name: '新建调拨' }).waitFor(); },
  transferDetail: async (page) => { await actions.transferList(page); await page.locator('.v16-inventory-row').first().click(); await page.getByText('确认调拨', { exact: true }).waitFor(); },
  checkList: async (page) => { await page.getByRole('button', { name: '盘点', exact: true }).click(); await page.locator('.v16-inventory-row').first().waitFor(); },
  checkEditor: async (page) => { await actions.checkList(page); await page.getByRole('button', { name: '新建库存盘点' }).click(); await page.getByRole('heading', { name: '新建盘点' }).waitFor(); },
  checkDetail: async (page) => { await actions.checkList(page); await page.locator('.v16-inventory-row').first().click(); await page.getByText('前往审批中心', { exact: true }).waitFor(); },
  adjustmentList: async (page) => { await page.getByRole('button', { name: '调整', exact: true }).click(); await page.locator('.v16-inventory-row').first().waitFor(); },
  adjustmentEditor: async (page) => { await actions.adjustmentList(page); await page.getByRole('button', { name: '新建库存调整' }).click(); await page.getByRole('heading', { name: '新建库存调整' }).waitFor(); },
  adjustmentDetail: async (page) => { await actions.adjustmentList(page); await page.locator('.v16-inventory-row').first().click(); await page.getByText('确认调整', { exact: true }).waitFor(); },
  scrapEditor: async (page) => { await page.getByRole('button', { name: '新建', exact: true }).click(); await page.getByRole('heading', { name: '新建存货报废' }).waitFor(); },
  scrapDetail: async (page) => { await page.locator('.v16-inventory-row').first().click(); await page.getByText('确认报废', { exact: true }).waitFor(); },
  monthClose: async (page) => { await page.getByRole('button', { name: '执行月结' }).click(); await page.getByRole('button', { name: '运行预检查' }).click(); await page.getByText('存在警告', { exact: true }).waitFor(); },
  monthDetail: async (page) => { await page.locator('.v16-inventory-row').first().click(); await page.getByText('期末快照', { exact: true }).waitFor(); },
};

try {
  mkdirSync(outputDir, { recursive: true }); await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`; const token = await login(); browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const primary = [['inventory','stock-list',null],['inventory','stock-detail',actions.stockDetail],['inventory','transfer-list',actions.transferList],['inventory','transfer-editor',actions.transferEditor],['inventory','transfer-detail',actions.transferDetail],['inventory','check-list',actions.checkList],['inventory','check-editor',actions.checkEditor],['inventory','check-detail',actions.checkDetail],['inventory','adjustment-list',actions.adjustmentList],['inventory','adjustment-editor',actions.adjustmentEditor],['inventory','adjustment-detail',actions.adjustmentDetail],['inventory-scraps','scrap-list',null],['inventory-scraps','scrap-editor',actions.scrapEditor],['inventory-scraps','scrap-detail',actions.scrapDetail],['inventory-month-end','month-list',null],['inventory-month-end','month-precheck',actions.monthClose],['inventory-month-end','month-detail',actions.monthDetail],['inventory-transactions','transactions',null]];
  for (const [hash, name, action] of primary) await capture(token, hash, 390, `${name}-390.png`, action);
  for (const width of [320, 430, 680]) { await capture(token, 'inventory', width, `stock-list-${width}.png`); await capture(token, 'inventory', width, `transfer-editor-${width}.png`, actions.transferEditor); await capture(token, 'inventory', width, `check-editor-${width}.png`, actions.checkEditor); await capture(token, 'inventory-month-end', width, `month-list-${width}.png`); await capture(token, 'inventory-transactions', width, `transactions-${width}.png`); }
  process.stdout.write(`${JSON.stringify({ ok: true, screenshots }, null, 2)}\n`);
} finally { await browser?.close(); server.closeAllConnections?.(); if (server.listening) await new Promise((done) => server.close(done)); db.close(); rmSync(tempDir, { recursive: true, force: true }); }
