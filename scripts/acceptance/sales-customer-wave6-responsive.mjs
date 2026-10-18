import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const viewports = [320, 390, 430, 680];
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-wave6-ui-'));
const outputDir = resolve('docs/evidence/sales-customer-wave6');
mkdirSync(outputDir, { recursive: true });
const db = createDatabase(join(tempDir, 'erp.db'));
const now = new Date().toISOString();
db.prepare("UPDATE products SET valuation_method='MOVING_AVERAGE',valuation_activated_at=?,inventory_classification='FINISHED_GOOD' WHERE id='product-001'").run(now);
db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
  VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,20,200000,?)
  ON CONFLICT(balance_key) DO UPDATE SET quantity=20,value_cents=200000,updated_at=excluded.updated_at`).run(now);
db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at)
  VALUES('wave6-replacement-delivery','SD-W6-REPL','customer-001','warehouse-001','user-warehouse',259900,'CONFIRMED','2026-10-17','Wave 6 replacement','user-warehouse',?,?)`).run(now, now);
db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
  VALUES('wave6-replacement-delivery-item','wave6-replacement-delivery','product-001',1,259900,259900,1)`).run();

const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

async function assertLayout(page, width, name) {
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector('.modal');
    const controls = [...document.querySelectorAll('.modal button,.modal input,.modal select,.returns-v15 button,.returns-v15 input,.returns-v15 select')].filter((node) => node.getClientRects().length);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogRight: dialog ? dialog.getBoundingClientRect().right : 0,
      dialogLeft: dialog ? dialog.getBoundingClientRect().left : 0,
      minControlHeight: controls.length ? Math.min(...controls.map((node) => node.getBoundingClientRect().height)) : 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${name}@${width} has page overflow`);
  assert.ok(metrics.dialogLeft >= -1 && metrics.dialogRight <= width + 1, `${name}@${width} dialog escapes viewport`);
  assert.ok(metrics.minControlHeight >= 34, `${name}@${width} contains unusably short control`);
  return metrics;
}

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'warehouse', password: 'warehouse123' }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const responsive = [];

  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ value }) => localStorage.setItem('modern_erp_token', value), { value: token });
    await page.goto(`${baseUrl}/#returns?documentType=SALES_RETURN`, { waitUntil: 'networkidle' });
    try {
      await page.getByText('退货管理', { exact: true }).first().waitFor({ timeout: 12000 });
    } catch (error) {
      throw new Error(`returns page did not render at ${width}px; url=${page.url()}; errors=${errors.join(' | ')}; text=${(await page.locator('body').innerText()).slice(0, 800)}`, { cause: error });
    }
    await page.getByRole('button', { name: '新建销售退货' }).click();
    await page.locator('.modal').waitFor();
    const mode = page.locator('.wave6-mode-picker label').filter({ hasText: 'NO_SOURCE' });
    if (!(await mode.count())) throw new Error(`Wave 6 mode selector missing: ${(await page.locator('.modal').innerText()).slice(0, 1000)}`);
    await mode.click();
    const metrics = await assertLayout(page, width, 'new-no-source-return');
    await page.screenshot({ path: join(outputDir, `return-create-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    responsive.push({ width, ...metrics });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ value }) => localStorage.setItem('modern_erp_token', value), { value: token });
  await page.goto(`${baseUrl}/#returns?documentType=SALES_RETURN`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建销售退货' }).click();
  await page.locator('.wave6-mode-picker label').filter({ hasText: 'NO_SOURCE' }).click();
  await page.getByLabel('客户').selectOption('customer-001');
  await page.getByLabel('仓库').selectOption('warehouse-001');
  await page.getByRole('button', { name: '添加明细' }).click();
  await page.locator('.line-table tbody select').selectOption('product-001');
  await page.locator('.line-table tbody input[type="number"]').fill('1');
  const validity = await page.locator('.modal form').evaluate((form) => ({ valid: form.checkValidity(), invalid: [...form.querySelectorAll(':invalid')].map((node) => ({ name: node.getAttribute('name'), label: node.closest('label')?.innerText, value: node.value })) }));
  assert.equal(validity.valid, true, `NO_SOURCE form invalid: ${JSON.stringify(validity.invalid)}`);
  await page.getByRole('button', { name: '保存草稿' }).click();
  try { await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 8000 }); }
  catch (error) { throw new Error(`NO_SOURCE save did not close: ${(await page.locator('.modal').innerText()).slice(0, 1200)}`, { cause: error }); }
  const created = db.prepare("SELECT id,return_no FROM return_orders WHERE commercial_source_marker='NO_SOURCE' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(created?.id);
  await page.goto(`${baseUrl}/#returns/${created.id}?documentType=SALES_RETURN`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '确认单据' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'));
  assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
  await page.goto(`${baseUrl}/#returns/${created.id}?documentType=SALES_RETURN`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '创建换货义务' }).click();
  await page.locator('.wave6-inline-workflow input[type="number"]').fill('1');
  await page.getByRole('button', { name: '确认创建' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'));
  const replacement = db.prepare('SELECT id,replacement_no FROM sales_order_replacements WHERE source_return_id=?').get(created.id);
  assert.ok(replacement?.id);
  await page.getByRole('button', { name: /换货义务 1/ }).click();
  await page.getByRole('button', { name: replacement.replacement_no }).click();
  const replacementLine = db.prepare('SELECT id FROM sales_order_replacement_lines WHERE replacement_id=?').get(replacement.id);
  await page.getByLabel('换货行').selectOption(replacementLine.id);
  await page.getByLabel('销售出货明细').selectOption('wave6-replacement-delivery-item');
  await page.getByLabel('本次履行数量').fill('1');
  await page.getByRole('button', { name: '登记履行' }).click();
  await page.getByText('FULFILLED', { exact: true }).waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_replacement_fulfillments WHERE replacement_line_id=?').get(replacementLine.id).n, 1);
  await page.screenshot({ path: join(outputDir, 'replacement-fulfilled-390.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();

  process.stdout.write(`${JSON.stringify({ ok: true, responsive, functional: { returnId: created.id, replacementId: replacement.id, state: 'FULFILLED' } }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
