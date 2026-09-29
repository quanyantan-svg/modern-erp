import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v15-d2-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v15-d2-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const screenshots = [];
let browser;

function seedReceipts() {
  const at = '2026-09-29T08:00:00.000Z';
  db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES('d2-po','PO-D2-001','supplier-001','APPROVED',360000,'user-admin',?,?)").run(at, at);
  db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('d2-poi','d2-po','product-001',120,3000,360000,1)").run();
  const insertReceipt = db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES(?,?,?,?,?,?,360000,?,?,?,?,?,?,?)');
  const insertLine = db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,1,?)');
  for (const [suffix, status, date] of [['cancelled','CANCELLED','2026-09-29'], ['draft','DRAFT','2026-09-28']]) {
    insertReceipt.run(`d2-pr-${suffix}`, `PR-D2-${suffix === 'cancelled' ? '001' : '002'}`, 'd2-po', 'supplier-001', 'warehouse-001', 'user-warehouse', status, date, 'D2 visual fixture', 'user-warehouse', at, at, 'SEPARATE');
    insertLine.run(`d2-pri-${suffix}`, `d2-pr-${suffix}`, 'product-001', 120, 3000, 360000, 'd2-poi');
  }
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function capture(token, name, viewport, route = '', afterOpen) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${baseUrl}/${route ? `#${route}` : ''}`, { waitUntil: 'networkidle' });
  await page.getByTestId(route ? `mobile-application-view-${route}` : 'mobile-launcher').waitFor();
  if (afterOpen) await afterOpen(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${name} has horizontal overflow: ${overflow}px`);
  assert.deepEqual(errors, [], `${name} browser errors`);
  const file = join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  await context.close();
}

let baseUrl;
try {
  mkdirSync(outputDir, { recursive: true });
  seedReceipts();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const viewports = [{ key: '390', width: 390, height: 844 }, { key: '768', width: 768, height: 1024 }, { key: '1440', width: 1440, height: 1000 }];
  for (const viewport of viewports) await capture(token, `application-${viewport.key}`, viewport);
  for (const viewport of viewports) await capture(token, `overview-${viewport.key}`, viewport, 'business-overview');
  await capture(token, 'receipts-390', viewports[0], 'purchase-receipts');
  await capture(token, 'receipts-1440', viewports[2], 'purchase-receipts');
  const openDetail = async (page) => {
    const selector = page.viewportSize().width < 768 ? '.receipt-card-list .record-card' : '.receipt-list-table tbody tr';
    await page.locator(selector).filter({ hasText: 'PR-D2-001' }).click();
    await page.getByRole('heading', { name: 'PR-D2-001' }).waitFor();
  };
  await capture(token, 'receipt-detail-390', viewports[0], 'purchase-receipts', openDetail);
  await capture(token, 'receipt-detail-1440', viewports[2], 'purchase-receipts', openDetail);
  console.log(JSON.stringify({ ok: true, screenshots }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
