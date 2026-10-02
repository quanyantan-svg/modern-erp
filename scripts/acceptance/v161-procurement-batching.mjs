import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v161-procurement');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v161-procurement-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const at = '2026-10-02T08:00:00.000Z';
let browser;

function seed() {
  db.prepare("INSERT OR IGNORE INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('v161-supplier','SUP-HX','深圳华芯电子科技有限公司','林女士','0592-5550000','福建省厦门市软件园',1,?,?)").run(at, at);
  for (const [id, code, name, price] of [['v161-pcb','RM-PCB-200','TC200控制主板',12800], ['v161-lcd','RM-LCD-240','2.4寸LCD显示模组',8600]]) {
    db.prepare("INSERT OR IGNORE INTO products(id,code,name,unit,price_cents,active,created_at,updated_at) VALUES(?,?,?,'PCS',?,1,?,?)").run(id, code, name, price, at, at);
  }
  db.prepare("INSERT INTO purchase_requisitions(id,requisition_no,status,request_date,required_date,notes,creator_id,reviewer_id,created_at,updated_at) VALUES('v161-req','PREQ-20261002-HYTC200','APPROVED','2026-10-02','2026-10-20','HY-TC200 批量采购','user-sales','user-reviewer',?,?)").run(at, at);
  db.prepare("INSERT INTO purchase_requisition_items(id,requisition_id,product_id,quantity,preferred_supplier_id,unit_price_cents,amount_cents,created_at) VALUES('v161-req-pcb','v161-req','v161-pcb',30,'v161-supplier',12800,384000,?)").run(at);
  db.prepare("INSERT INTO purchase_requisition_items(id,requisition_id,product_id,quantity,preferred_supplier_id,unit_price_cents,amount_cents,created_at) VALUES('v161-req-lcd','v161-req','v161-lcd',25,'v161-supplier',8600,215000,?)").run(at);
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function api(baseUrl, token, path, method = 'GET', body) {
  const response = await fetch(baseUrl + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  mkdirSync(outputDir, { recursive: true });
  seed();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const admin = await login(baseUrl, 'admin', 'admin123');
  const reviewer = await login(baseUrl, 'reviewer', 'review123');
  assert.equal((await api(baseUrl, admin, '/api/purchase-requisitions/v161-req')).requisition.items.length, 2);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), admin);
  const page = await context.newPage();
  const responses = [];
  page.on('response', (response) => { if (response.url().includes('/api/')) responses.push({ url: response.url(), status: response.status() }); });
  page.setDefaultTimeout(5000);
  await page.goto(`${baseUrl}#purchase-requisitions`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '批量生成采购订单', exact: true }).click();
  try {
    await page.getByText('RM-PCB-200', { exact: false }).waitFor();
    await page.getByText('RM-LCD-240', { exact: false }).waitFor();
  } catch (error) {
    throw new Error(`${error.message}\nPAGE=${(await page.locator('body').innerText()).slice(0, 2000)}\nRESPONSES=${JSON.stringify(responses.slice(-20))}`);
  }
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('select')]
    .filter((select) => [...select.options].some((option) => option.textContent.includes('SUP-HX - 深圳华芯电子科技有限公司'))).length), 2);
  await page.getByLabel('付款条件', { exact: true }).fill('月结 30 天');
  await page.getByRole('button', { name: '按供应商生成', exact: true }).click();
  await page.getByText('1 张采购订单草稿', { exact: false }).waitFor();
  const order = db.prepare("SELECT id,status FROM purchase_orders WHERE supplier_id='v161-supplier'").get();
  assert.ok(order);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM purchase_order_items WHERE order_id=?').get(order.id).count, 2);
  await api(baseUrl, admin, `/api/purchase-orders/${order.id}/submit`, 'POST', {});
  await api(baseUrl, reviewer, `/api/purchase-orders/${order.id}/approve`, 'POST', {});
  const detail = (await api(baseUrl, admin, `/api/purchase-orders/${order.id}`)).order;
  const receipt = await api(baseUrl, admin, '/api/purchase-receipts', 'POST', {
    purchaseOrderId: order.id, supplierId: detail.supplierId, warehouseId: 'warehouse-001', receiptDate: '2026-10-20',
    items: detail.items.map((item) => ({ purchaseOrderItemId: item.id, productId: item.productId, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
  });
  assert.equal((await api(baseUrl, admin, `/api/purchase-receipts/${receipt.id}`)).purchaseReceipt.items.length, 2);
  await page.screenshot({ path: join(outputDir, 'procurement-batching-390.png'), fullPage: true });
  process.stdout.write(`${JSON.stringify({ ok: true, journey: 'approved multi-line requisition → UI supplier grouping → one multi-line PO → approval → multi-line receipt', viewport: [390, 844], orderId: order.id, receiptId: receipt.id, outputDir }, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
