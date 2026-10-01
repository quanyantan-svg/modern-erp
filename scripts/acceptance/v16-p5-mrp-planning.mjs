import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v16-p5-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v16-p5-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];
const screenshots = [];
let browser;
let baseUrl;

const results = Array.from({ length: 13 }, (_, index) => ({
  id: `result-${index + 1}`,
  product_id: `product-${index + 1}`,
  product_code: index === 0 ? 'FG-ULTRA-LONG-PRODUCT-CODE-2026-PLANNING-001' : `RM-${String(index + 1).padStart(4, '0')}`,
  product_name: index === 0 ? '工业智能边缘控制终端耐高温防护特别版本超长产品名称' : `规划物料 ${index + 1}`,
  product_unit: index % 2 ? '件' : '套',
  gross_sales_demand: index === 0 ? 123456.123456 : 10 + index,
  gross_forecast_demand: index === 0 ? 9876.654321 : 4,
  gross_component_demand: index * 2,
  gross_requirement: index === 0 ? 133332.777777 : 14 + index * 3,
  on_hand: index === 0 ? 333.333333 : index,
  open_purchase_supply: index % 3,
  open_production_supply: index % 2,
  net_requirement: index === 0 ? 132999.444444 : 12 + index,
  suggestion_type: index % 2 ? 'BUY' : 'MAKE',
  suggested_quantity: index === 0 ? 132999.444444 : 12 + index,
  converted_quantity: index === 1 ? 5.5 : index === 2 ? 14 : 0,
  remaining_quantity: index === 1 ? 7.5 : index === 2 ? 0 : (index === 0 ? 132999.444444 : 12 + index),
  need_by_date: index === 12 ? null : `2026-10-${String(2 + index).padStart(2, '0')}`,
  warning: index === 0 ? 'ROUTING_MISSING' : '',
}));

function run(overrides = {}) {
  const status = overrides.status || 'COMPLETED';
  const id = overrides.id || 'run-completed';
  return {
    id,
    run_code: overrides.run_code || `MRP-20261001-${id.toUpperCase()}`,
    run_name: overrides.run_name || '十月主生产与采购规划运行',
    horizon_start: '2026-10-01',
    horizon_end: '2026-12-31',
    demand_source_mode: overrides.demand_source_mode || 'SALES_PLUS_FORECAST',
    forecast_id: 'forecast-1',
    forecast_code: 'FC-2026-Q4',
    forecast_name: '第四季度渠道滚动需求预测',
    status,
    creator_name: '系统管理员',
    created_at: '2026-10-01T08:30:00.000Z',
    completed_at: status === 'COMPLETED' ? '2026-10-01T08:32:00.000Z' : null,
    summary: overrides.summary || (status === 'COMPLETED' ? { totalProducts: results.length, makeSuggestions: 7, buySuggestions: 6, shortageProducts: 12 } : null),
    results: overrides.results || (status === 'COMPLETED' ? results : []),
    demands: [],
    components: [{ product_id: 'product-1', parent_product_id: 'parent-1', parent_code: 'FG-PARENT-001', parent_name: '工业控制柜完整装配总成', bom_path: 'FG-PARENT-001>FG-ULTRA-LONG-PRODUCT-CODE-2026-PLANNING-001' }],
    pegging: [{ result_product_id: 'product-1', source_label: '销售订单 SO-20261001-001 · 华东渠道交付' }],
    ...overrides,
  };
}

const fixtures = {
  completed: run(),
  draft: run({ id: 'run-draft', run_code: 'MRP-20261001-DRAFT-LONG-001', run_name: '待复核的渠道与直销联合需求草稿', status: 'DRAFT', demand_source_mode: 'SALES_ORDERS' }),
  cancelled: run({ id: 'run-cancelled', status: 'CANCELLED', run_name: '已取消的历史规划草稿' }),
  zero: run({ id: 'run-zero', run_name: '无需求期间验证', summary: { totalProducts: 0, makeSuggestions: 0, buySuggestions: 0, shortageProducts: 0 }, results: [] }),
};
const listFixtures = [fixtures.completed, fixtures.draft, fixtures.cancelled, fixtures.zero];
const forecasts = [{ id: 'forecast-1', forecast_code: 'FC-2026-Q4', forecast_name: '第四季度渠道滚动需求预测', status: 'ACTIVE' }];

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
async function json(route, body, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }

async function installRoutes(context, list = listFixtures) {
  await context.route('**/api/planning/mrp/runs**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') return json(route, { ok: true, id: 'run-new' });
    const parts = url.pathname.split('/'); const id = parts.length > 5 ? decodeURIComponent(parts.at(-1)) : null;
    if (id) return json(route, { run: list.find((item) => item.id === id) || fixtures[id.replace('run-', '')] || fixtures.completed });
    const status = url.searchParams.get('status');
    return json(route, { runs: status ? list.filter((item) => item.status === status) : list });
  });
  await context.route('**/api/planning/forecasts?**', (route) => json(route, { forecasts }));
}
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function newPage(token, width, list = listFixtures) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installRoutes(context, list);
  const page = await context.newPage();
  return { context, page, errors: collectErrors(page) };
}
async function assertLayout(page, file, { back = false, actionBar = false } = {}) {
  const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, shell: document.querySelector('.mobile-shell')?.getBoundingClientRect().width || 0 }));
  assert.ok(metrics.scroll <= metrics.client, `${file}: horizontal overflow ${metrics.scroll}/${metrics.client}`);
  assert.ok(metrics.shell <= Math.min(680, metrics.client) + 1, `${file}: shell exceeds rail`);
  const shortTargets = await page.locator('.v16-mrp-planning button, .v16-mrp-planning a, .v16-mrp-planning select, .v16-mrp-planning input').evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => ({ text: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height })).filter((item) => item.height > 0 && item.height < 43.5));
  assert.deepEqual(shortTargets, [], `${file}: targets below 44px ${JSON.stringify(shortTargets)}`);
  assert.equal(await page.locator('[data-testid="mobile-header-back"]').count(), back ? 1 : 1, `${file}: shell must own one back action`);
  assert.equal(await page.locator('.v16-mrp-planning .modal, .v16-mrp-planning .record-card, .v16-mrp-planning .panel').count(), 0, `${file}: legacy primary surface remains`);
  if (actionBar) {
    const collision = await page.evaluate(() => { const action = document.querySelector('.v16-mrp-planning .bottom-action-bar')?.getBoundingClientRect(); const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect(); return action && nav ? action.bottom > nav.top + 1 : false; });
    assert.equal(collision, false, `${file}: action bar collides with navigation`);
  }
}
async function save(page, file) {
  await page.addStyleTag({ content: '.mobile-bottom-nav { position: absolute !important; }' });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(outputDir, file); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
}
async function capture(token, width, scenario) {
  const { context, page, errors } = await newPage(token, width);
  if (scenario === 'plan' || scenario === 'sheet') {
    await page.goto(`${baseUrl}#material-requirements-plan`, { waitUntil: 'networkidle' });
    await page.locator('.v16-material-result-row').first().waitFor();
    if (scenario === 'sheet') { await page.locator('.v16-material-result-row').first().click(); await page.locator('.v16-material-trace-sheet').waitFor(); }
  } else {
    await page.goto(`${baseUrl}#mrp-runs`, { waitUntil: 'networkidle' });
    await page.locator('.v16-mrp-run-list').waitFor();
    if (scenario === 'detail') { await page.locator('.v16-mrp-run-row__open').first().click(); await page.locator('.v16-mrp-detail__identity').waitFor(); }
    if (scenario === 'editor') { await page.getByRole('button', { name: '新建 MRP 运算' }).click(); await page.locator('.v16-mrp-editor__form').waitFor(); }
  }
  const file = `mrp-${scenario}-${width}.png`;
  await assertLayout(page, file, { back: scenario !== 'list', actionBar: scenario === 'detail' || scenario === 'editor' });
  assert.deepEqual(errors, [], `${file}: browser errors ${errors.join(' | ')}`);
  await save(page, file); await context.close();
}
async function captureZero(token) {
  const { context, page, errors } = await newPage(token, 390, [fixtures.zero]);
  await page.goto(`${baseUrl}#material-requirements-plan`, { waitUntil: 'networkidle' });
  await page.getByText('本次没有物料需求', { exact: true }).waitFor();
  const file = 'mrp-plan-zero-390.png'; await assertLayout(page, file, { back: true }); assert.deepEqual(errors, []); await save(page, file); await context.close();
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  for (const width of widths) for (const scenario of ['list', 'detail', 'editor', 'plan', 'sheet']) await capture(token, width, scenario);
  await captureZero(token);
  process.stdout.write(`${JSON.stringify({ ok: true, screenshots }, null, 2)}\n`);
} finally {
  await browser?.close(); server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close(); rmSync(tempDir, { recursive: true, force: true });
}
