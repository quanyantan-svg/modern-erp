import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-e6-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;
let baseUrl;

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

function seedScenario() {
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('e6-uat-c','E6-UAT-C','E6 验收客户','','','',1,'2026-09-01','2026-09-01')`).run();
  db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('e6-uat-s','E6-UAT-S','E6 验收供应商','','','',1,'2026-09-01','2026-09-01')`).run();
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
    VALUES
    ('e6-uat-fg','FG-DT100','桌面终端','UAT','EA',100,0,1,'2026-09-01','2026-09-01','NONE','MOVING_AVERAGE','OTHER_INVENTORY'),
    ('e6-uat-rm','RM-PCB100','PCB 主板','UAT','EA',100,0,1,'2026-09-01','2026-09-01','NONE','MOVING_AVERAGE','OTHER_INVENTORY')`).run();
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('e6-uat-w','E6-UAT-W','E6 验收仓','','',1,'2026-09-01','2026-09-01')`).run();

  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date)
    VALUES('e6-uat-so','E6-UAT-SO-001','e6-uat-c','APPROVED',1000,'','user-admin','2026-09-01','2026-09-01','2026-09-01','2026-09-20')`).run();
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES('e6-uat-soi','e6-uat-so','e6-uat-fg',10,100,1000,1)`).run();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-sd-1','E6-UAT-SD-001','e6-uat-so','e6-uat-c','e6-uat-w','user-admin','CONFIRMED',600,'2026-09-18','','user-admin','2026-09-18','2026-09-18','2026-09-18','user-admin')`).run();
  db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES('e6-uat-sdi-1','e6-uat-sd-1','e6-uat-fg',6,100,600,1,'e6-uat-soi')`).run();

  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date)
    VALUES('e6-uat-so-legacy','E6-UAT-SO-LEGACY','e6-uat-c','APPROVED',1000,'','user-admin','2026-09-01','2026-09-01','2026-09-01','2026-09-10')`).run();
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES('e6-uat-soi-legacy','e6-uat-so-legacy','e6-uat-fg',10,100,1000,1)`).run();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-sd-legacy','E6-UAT-SD-LEGACY','e6-uat-so-legacy','e6-uat-c','e6-uat-w','user-admin','CONFIRMED',400,'2026-09-09','','user-admin','2026-09-09','2026-09-09','2026-09-09','user-admin')`).run();
  db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES('e6-uat-sdi-legacy','e6-uat-sd-legacy','e6-uat-fg',4,100,400,1,NULL)`).run();

  db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date)
    VALUES('e6-uat-po','E6-UAT-PO-001','e6-uat-s','APPROVED',1000,'','user-admin','2026-09-01','2026-09-01','2026-09-01','2026-09-21')`).run();
  db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES('e6-uat-poi','e6-uat-po','e6-uat-rm',10,100,1000,1)`).run();
  db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-pr-1','E6-UAT-PR-001','e6-uat-po','e6-uat-s','e6-uat-w','user-admin','CONFIRMED',600,'2026-09-18','','user-admin','2026-09-18','2026-09-18','2026-09-18','user-admin')`).run();
  db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id)
    VALUES('e6-uat-pri-1','e6-uat-pr-1','e6-uat-rm',6,100,600,1,'e6-uat-poi')`).run();
}

function completeSalesAndReturn() {
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-sd-2','E6-UAT-SD-002','e6-uat-so','e6-uat-c','e6-uat-w','user-admin','CONFIRMED',400,'2026-09-19','','user-admin','2026-09-19','2026-09-19','2026-09-19','user-admin')`).run();
  db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id)
    VALUES('e6-uat-sdi-2','e6-uat-sd-2','e6-uat-fg',4,100,400,1,'e6-uat-soi')`).run();
  db.prepare(`INSERT INTO return_orders(id,return_no,source_type,source_id,customer_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-sret','E6-UAT-SRET-001','SALES','e6-uat-sd-2','e6-uat-c','e6-uat-w',200,'CONFIRMED','2026-09-22','','','user-admin','2026-09-22','2026-09-22','2026-09-22','user-admin')`).run();
  db.prepare(`INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,delivery_item_id)
    VALUES('e6-uat-sreti','e6-uat-sret','e6-uat-fg',2,100,200,1,'e6-uat-sdi-2')`).run();
}

function completePurchaseAndReturn() {
  db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-pr-2','E6-UAT-PR-002','e6-uat-po','e6-uat-s','e6-uat-w','user-admin','CONFIRMED',400,'2026-09-20','','user-admin','2026-09-20','2026-09-20','2026-09-20','user-admin')`).run();
  db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id)
    VALUES('e6-uat-pri-2','e6-uat-pr-2','e6-uat-rm',4,100,400,1,'e6-uat-poi')`).run();
  db.prepare(`INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES('e6-uat-pret','E6-UAT-PRET-001','e6-uat-pr-2','e6-uat-s','e6-uat-w',200,'CONFIRMED','2026-09-22','','','user-admin','2026-09-22','2026-09-22','2026-09-22','user-admin')`).run();
  db.prepare(`INSERT INTO purchase_return_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,receipt_item_id)
    VALUES('e6-uat-preti','e6-uat-pret','e6-uat-rm',2,100,200,1,'e6-uat-pri-2')`).run();
}

async function login(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill('admin');
  await page.locator('input[autocomplete="current-password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByTestId('mobile-launcher').waitFor();
  await page.getByRole('button', { name: '打开销售统计' }).click();
  await page.getByTestId('decision-reports').waitFor();
}

async function applyFilter(page, reportKey, date, includeFulfilled = false) {
  await page.getByRole('button', { name: /筛选报表/ }).click();
  await page.getByTestId('report-filter-dateFrom').fill(date);
  await page.getByTestId('report-filter-dateTo').fill(date);
  const checkbox = page.getByTestId('report-filter-includeFulfilled');
  if (includeFulfilled) await checkbox.check(); else await checkbox.uncheck();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/reports/decision/${reportKey}?`) && response.status() === 200),
    page.getByRole('button', { name: '应用筛选' }).click(),
  ]);
}

async function reopenReport(page, reportKey, alternateKey) {
  await page.getByTestId(`decision-report-tab-${alternateKey}`).click();
  await page.getByTestId(`decision-report-tab-${reportKey}`).click();
  await page.getByTestId(`${reportKey}-body`).waitFor();
}

async function runMobileUat() {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);

  await page.getByTestId('decision-report-tab-sales-outstanding').click();
  await page.getByTestId('sales-outstanding-body').waitFor();
  await applyFilter(page, 'sales-outstanding', '2026-09-20');
  let card = page.getByTestId('sales-outstanding-card-e6-uat-soi');
  await card.waitFor();
  let text = await card.innerText();
  check(/FG-DT100/.test(text) && /剩余数量\s*4/.test(text) && /订货 10/.test(text) && /已出货 6/.test(text), '375px sales line shows ordered 10, shipped 6 and remaining 4');
  check(/2026-09-20/.test(text) && /逾期/.test(text), '375px sales line keeps commitment date and overdue state visible');
  await card.getByRole('button', { name: /查看履约明细/ }).click();
  await card.getByText('E6-UAT-SD-001').waitFor();
  check((await card.innerText()).includes('数量 6'), 'sales lazy contribution shows exact shipment and quantity');

  completeSalesAndReturn();
  await reopenReport(page, 'sales-outstanding', 'sales-summary');
  await applyFilter(page, 'sales-outstanding', '2026-09-20');
  await page.getByText('匹配行均已履行').waitFor();
  check(await card.count() === 0, 'completed sales line disappears by default');
  await applyFilter(page, 'sales-outstanding', '2026-09-20', true);
  card = page.getByTestId('sales-outstanding-card-e6-uat-soi');
  await card.waitFor();
  text = await card.innerText();
  check(/剩余数量\s*0/.test(text) && /已履行/.test(text), 'show-fulfilled restores the sales line after completion and return without reopening it');

  await applyFilter(page, 'sales-outstanding', '2026-09-10');
  const legacy = page.getByTestId('sales-outstanding-card-e6-uat-soi-legacy');
  await legacy.waitFor();
  check((await legacy.innerText()).includes('来源信息不完整'), 'legacy sales line is visibly accuracy-limited');
  await legacy.getByRole('button', { name: /查看履约明细/ }).click();
  await legacy.getByText('没有可证明的履约贡献').waitFor();

  await page.getByTestId('decision-report-tab-purchase-outstanding').click();
  await page.getByTestId('purchase-outstanding-body').waitFor();
  await applyFilter(page, 'purchase-outstanding', '2026-09-21');
  card = page.getByTestId('purchase-outstanding-card-e6-uat-poi');
  await card.waitFor();
  text = await card.innerText();
  check(/RM-PCB100/.test(text) && /剩余数量\s*4/.test(text) && /订货 10/.test(text) && /已收货 6/.test(text), '375px purchase line shows ordered 10, received 6 and remaining 4');
  await card.getByRole('button', { name: /查看履约明细/ }).click();
  await card.getByText('E6-UAT-PR-001').waitFor();
  check((await card.innerText()).includes('数量 6'), 'purchase lazy contribution shows exact receipt and quantity');

  completePurchaseAndReturn();
  await reopenReport(page, 'purchase-outstanding', 'purchase-summary');
  await applyFilter(page, 'purchase-outstanding', '2026-09-21');
  await page.getByText('匹配行均已履行').waitFor();
  check(await card.count() === 0, 'completed purchase line disappears by default');
  await applyFilter(page, 'purchase-outstanding', '2026-09-21', true);
  card = page.getByTestId('purchase-outstanding-card-e6-uat-poi');
  await card.waitFor();
  text = await card.innerText();
  check(/剩余数量\s*0/.test(text) && /已履行/.test(text), 'show-fulfilled restores the purchase line after completion and return without reopening it');

  const overflow = await page.evaluate(() => ({
    amount: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll('body *')]
      .map((element) => ({ tag: element.tagName, className: String(element.className || ''), right: Math.round(element.getBoundingClientRect().right), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
      .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .slice(0, 10),
  }));
  check(overflow.amount <= 0, `375px fulfillment workflow has no page-level horizontal dependency: ${JSON.stringify(overflow)}`);
  check(errors.length === 0, '375px fulfillment workflow has no browser console/page errors');
  await context.close();
}

async function runDesktopSmoke() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);
  await page.getByTestId('decision-report-tab-sales-outstanding').click();
  await applyFilter(page, 'sales-outstanding', '2026-09-20', true);
  const row = page.getByTestId('sales-outstanding-row-e6-uat-soi');
  await row.waitFor();
  const text = await row.innerText();
  check(/E6-UAT-SO-001/.test(text) && /FG-DT100/.test(text) && /已履行/.test(text), 'desktop sales row presents business identifiers and fulfillment state');
  check(errors.length === 0, 'desktop fulfillment report has no browser console/page errors');
  await context.close();
}

try {
  seedScenario();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  await runMobileUat();
  await runDesktopSmoke();
  console.log('V1.4-E6 BROWSER UAT = PASS');
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
