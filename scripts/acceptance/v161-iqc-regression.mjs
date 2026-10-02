import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v161-iqc');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v161-iqc-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const at = '2026-10-02T08:00:00.000Z';
const receiptId = 'v161-iqc-receipt';
const receiptNo = 'PR-20261002-HYTC200';
let browser;

function seed() {
  db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES('v161-iqc-po','PO-20261002-HYTC200','supplier-001','APPROVED',1000,'user-admin',?,?)").run(at, at);
  db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('v161-iqc-poi','v161-iqc-po','product-001',2,500,1000,1)").run();
  db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1000,'DRAFT','2026-10-02','HY-TC200 来料检验','user-warehouse',?,?)")
    .run(receiptId, receiptNo, 'v161-iqc-po', 'supplier-001', 'warehouse-001', 'user-warehouse', at, at);
  db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES('v161-iqc-pri',?,'product-001',2,500,1000,1,'v161-iqc-poi')").run(receiptId);
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

try {
  mkdirSync(outputDir, { recursive: true });
  seed();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login(baseUrl);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  await page.goto(`${baseUrl}#purchase-receipts`, { waitUntil: 'networkidle' });
  await page.getByText(receiptNo, { exact: true }).click();
  await page.getByTestId('purchase-receipt-action-primary').getByText('创建 IQC', { exact: true }).click();
  await page.getByTestId('purchase-receipt-action-primary').getByText('前往 IQC', { exact: true }).waitFor();
  await page.getByTestId('purchase-receipt-action-primary').click();
  await page.getByRole('heading', { name: /IQC 检验单/ }).waitFor();
  await page.getByRole('spinbutton', { name: '合格数量', exact: true }).fill('2');
  await page.getByRole('button', { name: '完成检验', exact: true }).click();
  await page.getByTestId('purchase-receipt-action-primary').getByText('确认入库', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#purchase-receipts');
  await page.getByTestId('purchase-receipt-action-primary').click();
  await page.getByRole('dialog', { name: '确认采购入库？' }).getByRole('button', { name: '确认入库', exact: true }).click();
  await page.getByText('已确认', { exact: true }).first().waitFor();
  assert.equal(db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(receiptId).status, 'CONFIRMED');
  await page.screenshot({ path: join(outputDir, 'iqc-confirmed-390.png'), fullPage: true });
  process.stdout.write(`${JSON.stringify({ ok: true, journey: 'Purchase Order → Purchase Receipt → Create/Go IQC → PASS → return → Confirm Receipt', viewport: [390, 844], outputDir }, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
