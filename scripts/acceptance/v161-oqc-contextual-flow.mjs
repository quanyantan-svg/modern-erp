import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v161-oqc-contextual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v161-oqc-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const at = '2026-10-02T08:00:00.000Z';
const deliveryId = 'v161-browser-sales-delivery';
const deliveryNo = 'SD-20261002-HYTC200';
let browser;

function seedDelivery() {
  db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,total_cents,status,creator_id,created_at,updated_at) VALUES('v161-browser-so','SO-20261002-HYTC200','customer-001',1000,'APPROVED','user-sales',?,?)").run(at, at);
  db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('v161-browser-soi','v161-browser-so','product-001',2,500,1000,1)").run();
  db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES(?,?,?,?,?,?,1000,'DRAFT','2026-10-02','HY-TC200 智能温湿度控制器 OQC 浏览器验收','user-warehouse',?,?,'SEPARATE')")
    .run(deliveryId, deliveryNo, 'v161-browser-so', 'customer-001', 'warehouse-001', 'user-warehouse', at, at);
  db.prepare("INSERT INTO sales_delivery_items(id,delivery_id,sales_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('v161-browser-sdi',?,'v161-browser-soi','product-001',2,500,1000,1)").run(deliveryId);
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function assertLayout(page, label) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(metrics.scrollWidth <= metrics.width, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
}

try {
  mkdirSync(outputDir, { recursive: true });
  seedDelivery();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login(baseUrl);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${baseUrl}#sales-deliveries`, { waitUntil: 'networkidle' });
  await page.getByText(deliveryNo, { exact: true }).click();
  await page.getByRole('button', { name: '创建 OQC', exact: true }).click();
  await page.getByRole('heading', { name: /OQC 检验单/ }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#oqc');
  await page.getByRole('spinbutton', { name: '合格数量', exact: true }).fill('2');
  await page.getByRole('button', { name: '完成检验', exact: true }).click();
  await page.getByText('质量状态：检验合格', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#sales-deliveries');
  await page.getByRole('button', { name: '确认单据', exact: true }).click();
  await page.getByText(deliveryNo, { exact: true }).waitFor();
  await page.locator('tr').filter({ hasText: deliveryNo }).getByText('已确认', { exact: true }).waitFor();
  assert.equal(db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(deliveryId).status, 'CONFIRMED');
  assert.equal(errors.length, 0, errors.join(' | '));
  await assertLayout(page, '390 journey');
  await page.screenshot({ path: join(outputDir, 'oqc-confirmed-390.png'), fullPage: true });
  for (const width of [320, 430, 680]) {
    await page.setViewportSize({ width, height: 844 });
    await assertLayout(page, `${width} confirmed delivery`);
    await page.screenshot({ path: join(outputDir, `oqc-confirmed-${width}.png`), fullPage: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, journey: 'Sales Delivery → Create OQC → PASS → return → Confirm Delivery', viewports: [320, 390, 430, 680], outputDir }, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
