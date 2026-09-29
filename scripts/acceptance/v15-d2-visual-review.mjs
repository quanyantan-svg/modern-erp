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
  db.prepare("UPDATE suppliers SET name='深圳市超长供应商名称精密电子元器件与工业自动化解决方案有限公司' WHERE id='supplier-001'").run();
  db.prepare("UPDATE customers SET name='华南地区超长客户名称智能制造联合运营与技术服务有限公司' WHERE id='customer-001'").run();
  db.prepare("UPDATE warehouses SET name='深圳前海保税区超长仓库名称精密零部件中央收货仓' WHERE id='warehouse-001'").run();
  db.prepare("UPDATE products SET name='超长货品名称高可靠工业控制核心模块与多协议边缘计算终端组件' WHERE id='product-001'").run();
  db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES('d2-po','PO-D2-001','supplier-001','APPROVED',360000,'user-admin',?,?)").run(at, at);
  db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('d2-poi','d2-po','product-001',120,3000,360000,1)").run();
  const insertReceipt = db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES(?,?,?,?,?,?,360000,?,?,?,?,?,?,?)');
  const insertLine = db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,1,?)');
  for (const [suffix, status, date] of [['cancelled','CANCELLED','2026-09-29'], ['draft','DRAFT','2026-09-28']]) {
    const receiptNo = suffix === 'cancelled' ? 'PR-D2-001' : 'PR-D2-LONG-20260929-000000000000000001';
    insertReceipt.run(`d2-pr-${suffix}`, receiptNo, 'd2-po', 'supplier-001', 'warehouse-001', 'user-warehouse', status, date, 'D2 visual fixture with deliberately long secondary metadata for overflow validation', 'user-warehouse', at, at, 'SEPARATE');
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
  await assertRail(page, name, viewport.width);
  await assertNoHeaderOverlap(page, name);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${name} has horizontal overflow: ${overflow}px`);
  assert.deepEqual(errors, [], `${name} browser errors`);
  const file = join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  await context.close();
}

async function assertRail(page, name, viewportWidth) {
  const width = await page.locator('.mobile-shell').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(width <= Math.min(680, viewportWidth) + 1, `${name} rail is wider than the canonical 680px: ${width}px`);
}

async function assertNoHeaderOverlap(page, name) {
  const collisions = await page.locator('.compact-record__header').evaluateAll((headers) => headers.flatMap((header, index) => {
    const identity = header.querySelector('.compact-record__identity')?.getBoundingClientRect();
    const status = header.querySelector('.compact-record__status')?.getBoundingClientRect();
    if (!identity || !status) return [];
    const overlaps = identity.right > status.left + 1 && identity.left < status.right - 1 && identity.bottom > status.top + 1 && identity.top < status.bottom - 1;
    return overlaps ? [index] : [];
  }));
  assert.deepEqual(collisions, [], `${name} has title/status overlap`);
}

let baseUrl;
try {
  mkdirSync(outputDir, { recursive: true });
  seedReceipts();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const mobile = { width: 390, height: 844 };
  const rail = { width: 680, height: 1000 };
  const desktop = { width: 1440, height: 1000 };
  await capture(token, 'application-mobile', mobile);
  await capture(token, 'application-desktop', desktop);
  await capture(token, 'business-overview-mobile', mobile, 'business-overview');
  await capture(token, 'business-overview-desktop', desktop, 'business-overview');
  await capture(token, 'purchase-receipts-mobile', mobile, 'purchase-receipts');
  await capture(token, 'purchase-receipts-desktop', desktop, 'purchase-receipts');
  const openDetail = (receiptNo) => async (page) => {
    await page.locator('.receipt-record-list .compact-record').filter({ hasText: receiptNo }).locator('.compact-record__open').click();
    await page.getByRole('heading', { name: receiptNo }).waitFor();
  };
  await capture(token, 'purchase-receipt-detail-mobile', mobile, 'purchase-receipts', openDetail('PR-D2-001'));
  await capture(token, 'purchase-receipt-detail-desktop', desktop, 'purchase-receipts', openDetail('PR-D2-001'));
  await capture(token, 'long-text-list', rail, 'purchase-receipts');
  await capture(token, 'long-text-detail', rail, 'purchase-receipts', openDetail('PR-D2-LONG-20260929-000000000000000001'));
  console.log(JSON.stringify({ ok: true, screenshots }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
