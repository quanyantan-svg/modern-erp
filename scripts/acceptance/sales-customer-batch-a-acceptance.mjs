import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const widths = [320, 390, 430, 680];
const routes = ['quotations', 'orders', 'sales-order-changes', 'delivery-notices', 'sales-deliveries', 'oqc'];
const outputDir = resolve('docs/evidence/sales-customer-batch-a');
const uiPriceListId = '00000000-0000-4000-8000-000000000101';
const uiPriceEntryId = '00000000-0000-4000-8000-000000000102';
const uiPriceVersionId = '00000000-0000-4000-8000-000000000103';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-batch-a-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

function seed() {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('batch-ui-group','UI-G','UI Group',1,?,?)").run(now, now);
  db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('batch-ui-salesperson','UI-SP','UI Salesperson','user-admin',1,?,?)").run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('batch-ui-membership','batch-ui-salesperson','batch-ui-group','2026-01-01',1,1,?,?, 'user-admin','user-admin')`).run(now, now);
  db.prepare("INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES('EA','Each',1,?,?)").run(now, now);
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES('batch-ui-classification','product-001',1,'EA','EA',0,0,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'UI-PL','UI Price','CNY',0,'2026-01-01','ACTIVE',?,?,?,'user-admin',?,'user-admin')`).run(uiPriceListId, now, 'user-admin', now, now);
  const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES(?,?,'product-001',NULL,'ALL',?,'A','EA','U:4541|Q:0000000000000000|D:20260101',0,'2026-01-01',?,'user-admin')`).run(uiPriceEntryId, uiPriceListId, materialKey, now);
  db.prepare(`INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by)
    VALUES(?,?,1,1000,'{}',?,'user-admin')`).run(uiPriceVersionId, uiPriceEntryId, now);
  db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
    default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,
    created_at,updated_at,created_by,updated_by,default_pricing_list_id)
    VALUES('customer-001','2026-01-01','customer-001','customer-001','batch-ui-salesperson','batch-ui-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?, 'user-admin','user-admin',?)`).run(now, now, uiPriceListId);
  const directOrder = 'batch-ui-order-direct'; const directItem = 'batch-ui-item-direct';
  const noticeOrder = 'batch-ui-order-notice'; const noticeItem = 'batch-ui-item-notice';
  db.prepare("UPDATE products SET base_uom_code='EA',valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOODS',valuation_activated_at='2026-01-01' WHERE id='product-001'").run();
  const inventory = db.prepare("SELECT id FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get();
  if (inventory) db.prepare('UPDATE inventory SET quantity=100,updated_at=? WHERE id=?').run(now, inventory.id);
  else db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('batch-ui-inventory','warehouse-001','product-001',100,?)").run(now);
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,50000,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=100,value_cents=50000,updated_at=excluded.updated_at`).run(now);
  for (const [orderId, itemId, orderNo] of [[directOrder, directItem, 'SO-UI-DIRECT'], [noticeOrder, noticeItem, 'SO-UI-NOTICE']]) {
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date,
      payment_terms,payment_terms_days,ship_to_contact_name,ship_to_phone,ship_to_address,commercial_close_state,effective_version)
      VALUES(?,?, 'customer-001','APPROVED',2000,'','user-sales',?,?, '2026-10-16','2026-10-20','MONTHLY',30,'测试收货人','13000000000','测试地址','OPEN',1)`)
      .run(orderId, orderNo, now, now);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,upper_delivery_tolerance_bps,
      lower_delivery_tolerance_bps,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den)
      VALUES(?,?, 'product-001',2,1000,2000,1,0,0,'EA',2,1,1,1,2,1)`).run(itemId, orderId);
    db.prepare('UPDATE sales_order_items SET price_snapshot_json=?,discount_snapshot_json=? WHERE id=?')
      .run(JSON.stringify({ quantityMicros: 2_000_000 }), JSON.stringify({ grossAmountCents: 2000, lineDiscountCents: 0 }), itemId);
  }
  const noticeId = 'batch-ui-notice'; const noticeLine = 'batch-ui-notice-line';
  db.prepare(`INSERT INTO delivery_notices(id,notice_no,sales_order_id,state,warehouse_id,ship_to_snapshot_json,planned_delivery_date,business_date,
    customer_id,customer_snapshot_json,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
    VALUES(?,'DN-UI-001',?,'CONFIRMED','warehouse-001','{}','2026-10-20','2026-10-16','customer-001','{}','user-admin',?,?,?,'user-admin')`)
    .run(noticeId, noticeOrder, now, now, now);
  db.prepare(`INSERT INTO delivery_notice_lines(id,delivery_notice_id,sales_order_item_id,scheduled_qty_micros,notified_qty_micros,cancelled_notified_qty_micros,line_no)
    VALUES(?,?,?,1000000,0,0,1)`).run(noticeLine, noticeId, noticeItem);
  return { directOrder, noticeId };
}

async function login(baseUrl, username = 'admin', password = 'admin123') {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200); return (await response.json()).token;
}

async function orderThroughUi(page, browser, baseUrl, reviewerToken) {
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.getByTestId('sales-order-new').click();
  const form = page.locator('.v16-sales-order-editor form');
  await form.locator('select').first().selectOption('customer-001');
  await form.locator('input[type="date"]').last().fill('2026-10-25');
  await form.locator('select').nth(1).selectOption('product-001');
  await form.locator('input[type="number"]').first().fill('1');
  await form.locator('details').evaluate((node) => { node.open = true; });
  await form.getByLabel('付款条件').fill('MONTHLY');
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/orders') && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(created.status(), 201, await created.text());
  const value = await created.json(); const orderId = value.id || value.order?.id;
  assert.ok(orderId, JSON.stringify(value));
  await page.goto(`${baseUrl}#orders/${orderId}`, { waitUntil: 'networkidle' });
  const [submitted] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/orders/${orderId}/submit`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '提交审批' }).click(),
  ]);
  assert.equal(submitted.status(), 200, await submitted.text());
  const reviewer = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  try {
    const reviewPage = await reviewer.newPage();
    await reviewPage.addInitScript((token) => localStorage.setItem('modern_erp_token', token), reviewerToken);
    await reviewPage.goto(`${baseUrl}#approvals`, { waitUntil: 'networkidle' });
    const row = reviewPage.getByText(value.orderNo || value.order?.orderNo || value.order_no).first();
    await row.waitFor();
    await row.click();
    await reviewPage.getByRole('button', { name: '审批通过' }).click();
    const [approved] = await Promise.all([
      reviewPage.waitForResponse((response) => response.url().endsWith(`/api/orders/${orderId}/approve`) && response.request().method() === 'POST'),
      reviewPage.getByRole('dialog').getByRole('button', { name: '确认' }).click(),
    ]);
    assert.equal(approved.status(), 200, await approved.text());
  } finally { await reviewer.close(); }
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(orderId).status, 'APPROVED');
  return { orderId, orderStatus: 'APPROVED' };
}

async function createDeliveryThroughUi(page, baseUrl, sourceMode, sourceId) {
  await page.goto(`${baseUrl}#sales-deliveries`, { waitUntil: 'networkidle' });
  await page.getByTestId('sales-delivery-new').click();
  const form = page.locator('.modal form.form-grid'); await form.waitFor();
  const selects = form.locator('select');
  await selects.nth(0).selectOption(sourceMode);
  await page.waitForFunction(({ index, value }) => [...document.querySelectorAll('.modal form.form-grid select')[index].options].some((option) => option.value === value),
    { index: 1, value: sourceId });
  await selects.nth(1).selectOption(sourceId);
  await page.waitForFunction(() => document.querySelectorAll('.modal table.line-table tbody tr').length > 0);
  if (!await selects.nth(3).inputValue()) await selects.nth(3).selectOption('warehouse-001');
  await form.locator('input[type="date"]').fill('2026-10-16');
  await form.locator('table.line-table input[type="number"]').first().fill('1');
  const validity = await form.evaluate((node) => ({ valid: node.checkValidity(), controls: [...node.elements].map((control) => ({
    tag: control.tagName, type: control.type, value: control.value, required: control.required, disabled: control.disabled, valid: control.checkValidity(),
  })) }));
  assert.ok(validity.valid, `delivery UI form invalid: ${JSON.stringify(validity.controls)}`);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/sales-deliveries') && response.request().method() === 'POST');
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  const response = await responsePromise; const body = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(body));
  const posted = response.request().postDataJSON();
  assert.equal(posted.sourceMode, sourceMode);
  if (sourceMode === 'DIRECT_ORDER') {
    assert.equal(posted.salesOrderId, sourceId); assert.equal(posted.deliveryNoticeId, '');
    assert.ok(posted.items[0].salesOrderItemId); assert.equal(posted.items[0].deliveryNoticeLineId, undefined);
  } else {
    assert.equal(posted.deliveryNoticeId, sourceId); assert.ok(posted.items[0].salesOrderItemId); assert.ok(posted.items[0].deliveryNoticeLineId);
  }
  return body.id;
}

async function oqcAndConfirmThroughUi(page, baseUrl, deliveryId) {
  await page.goto(`${baseUrl}#sales-deliveries`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  const row = page.getByTestId(`sales-delivery-row-${deliveryId}`); await row.waitFor();
  await row.locator('.v16-sales-delivery-row__open').click();
  await page.getByTestId('sales-delivery-action-primary').click();
  await page.getByRole('button', { name: '完成检验', exact: true }).waitFor();
  const form = page.locator('.modal .form-grid');
  await form.locator('input[type="number"]').nth(1).fill('1');
  await form.locator('input[type="number"]').nth(2).fill('0');
  await page.getByRole('button', { name: '完成检验', exact: true }).click();
  await page.getByTestId('sales-delivery-action-primary').waitFor();
  await page.getByTestId('sales-delivery-action-primary').click();
  const confirmButton = page.getByRole('dialog').getByRole('button', { name: '确认出库', exact: true }); await confirmButton.waitFor();
  const [confirmResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-deliveries/${deliveryId}`)
      && response.request().method() === 'POST' && response.request().postData()?.includes('confirm')),
    confirmButton.click(),
  ]);
  assert.equal(confirmResponse.status(), 200);
  await page.waitForFunction(() => document.body.innerText.includes('已确认'));
}

async function noticeAndChangeThroughUi(page, baseUrl, orderId) {
  await page.goto(`${baseUrl}#delivery-notices`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建通知' }).click();
  let form = page.locator('.sales-batch-editor form');
  await form.locator('select').first().selectOption(orderId);
  await form.locator('select').nth(1).selectOption('warehouse-001');
  await form.locator('input[type="number"]').first().waitFor();
  await form.locator('input[type="number"]').first().fill('1');
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/delivery-notices') && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(created.status(), 201, await created.text());
  const notice = (await created.json()).notice;
  await page.getByRole('button', { name: '编辑通知' }).click();
  form = page.locator('.sales-batch-editor form');
  await form.locator('input[type="date"]').last().fill('2026-10-21');
  const [edited] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/delivery-notices/${notice.id}`) && response.request().method() === 'PATCH'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(edited.status(), 200, await edited.text());
  assert.equal((await edited.json()).notice.planned_delivery_date, '2026-10-21');
  await page.getByRole('button', { name: '确认通知' }).waitFor();
  const [confirmed] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/delivery-notices/${notice.id}/confirm`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '确认通知' }).click(),
  ]);
  assert.equal(confirmed.status(), 200, await confirmed.text());

  await page.goto(`${baseUrl}#sales-order-changes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建变更' }).click();
  form = page.locator('.sales-batch-editor form');
  await form.locator('select').nth(1).selectOption(orderId);
  await form.locator('select').nth(2).selectOption('MODIFY');
  await form.locator('select').nth(3).selectOption('batch-ui-item-direct');
  await form.locator('input[type="number"]').fill('3');
  await form.locator('textarea').fill('移动端变更测试');
  const [changeCreated] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/sales-order-changes') && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存' }).click(),
  ]);
  assert.equal(changeCreated.status(), 201, await changeCreated.text());
  const change = await changeCreated.json();
  await page.getByRole('button', { name: '编辑草稿' }).click();
  form = page.locator('.sales-batch-editor form');
  await form.locator('textarea').fill('移动端已编辑变更原因');
  const [changeEdited] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-order-changes/${change.id}`) && response.request().method() === 'PATCH'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(changeEdited.status(), 200, await changeEdited.text());
  const [changeSubmitted] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-order-changes/${change.id}/submit`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '提交审批' }).click(),
  ]);
  assert.equal(changeSubmitted.status(), 200, await changeSubmitted.text());
  const [changeCancelled] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-order-changes/${change.id}/cancel`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '取消变更' }).click(),
  ]);
  assert.equal(changeCancelled.status(), 200, await changeCancelled.text());
  return { noticeId: notice.id, noticeState: db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(notice.id).state,
    changeId: change.id, changeState: db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(change.id).state };
}

async function quotationThroughUi(page, baseUrl) {
  await page.goto(`${baseUrl}#quotations`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建报价' }).click();
  const form = page.locator('.sales-batch-editor form');
  await form.locator('select').first().selectOption('customer-001');
  await form.locator('input[type="date"]').last().fill('2026-12-31');
  await form.locator('select').nth(1).selectOption('product-001');
  await form.locator('input[type="number"]').fill('2');
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/sales-quotations') && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(created.status(), 201, await created.text());
  const quotation = (await created.json()).quotation;
  const [published] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-quotations/${quotation.id}/effective-publish`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '生效发布' }).click(),
  ]);
  assert.equal(published.status(), 200, await published.text());
  await page.locator('.sales-batch-detail input[type="number"]').fill('1');
  const [converted] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-quotations/${quotation.id}/convert-to-so`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '转换所选数量为订单' }).click(),
  ]);
  assert.equal(converted.status(), 201, await converted.text());
  const first = await converted.json();
  await page.waitForFunction((id) => document.querySelector('.sales-batch-detail input[type="number"]')?.value === '1', quotation.id);
  const [convertedAgain] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-quotations/${quotation.id}/convert-to-so`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '转换所选数量为订单' }).click(),
  ]);
  assert.equal(convertedAgain.status(), 201, await convertedAgain.text());
  assert.notEqual((await convertedAgain.json()).salesOrderId, first.salesOrderId);
  assert.equal(Number(db.prepare('SELECT converted_qty_micros n FROM sales_quotation_lines WHERE quotation_id=?').get(quotation.id).n), 2_000_000);
  return { quotationId: quotation.id, convertedMicros: 2_000_000 };
}

async function approvedChangeAndCancelledNoticeThroughUi(page, browser, baseUrl, reviewerToken, orderId) {
  await page.goto(`${baseUrl}#sales-order-changes`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建变更' }).click();
  let form = page.locator('.sales-batch-editor form');
  await form.locator('select').first().selectOption('CONTROLLED_DIRECT');
  await form.locator('select').nth(1).selectOption(orderId);
  await form.locator('select').nth(2).selectOption('MODIFY');
  await form.locator('select').nth(3).selectOption('batch-ui-item-direct');
  await form.locator('input[type="number"]').fill('3');
  await form.locator('textarea').fill('客户追加一件');
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/sales-orders/${orderId}/controlled-change`) && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存' }).click(),
  ]);
  assert.equal(created.status(), 201, await created.text());
  const changeId = (await created.json()).id;
  const reviewer = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  try {
    const reviewPage = await reviewer.newPage();
    await reviewPage.addInitScript((token) => localStorage.setItem('modern_erp_token', token), reviewerToken);
    await reviewPage.goto(`${baseUrl}#sales-order-changes/${changeId}`, { waitUntil: 'networkidle' });
    const [approved] = await Promise.all([
      reviewPage.waitForResponse((response) => response.url().endsWith(`/api/sales-order-changes/${changeId}/approve`) && response.request().method() === 'POST'),
      reviewPage.getByRole('button', { name: '批准并应用' }).click(),
    ]);
    assert.equal(approved.status(), 200, await approved.text());
  } finally { await reviewer.close(); }
  assert.equal(db.prepare('SELECT state FROM sales_order_changes WHERE id=?').get(changeId).state, 'APPLIED');

  await page.goto(`${baseUrl}#delivery-notices`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建通知' }).click();
  form = page.locator('.sales-batch-editor form');
  await form.locator('select').first().selectOption(orderId);
  await form.locator('select').nth(1).selectOption('warehouse-001');
  await form.locator('input[type="number"]').first().fill('1');
  const [noticeCreated] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/delivery-notices') && response.request().method() === 'POST'),
    form.getByRole('button', { name: '保存草稿' }).click(),
  ]);
  assert.equal(noticeCreated.status(), 201, await noticeCreated.text());
  const noticeId = (await noticeCreated.json()).notice.id;
  const [confirmed] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/delivery-notices/${noticeId}/confirm`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '确认通知' }).click(),
  ]);
  assert.equal(confirmed.status(), 200, await confirmed.text());
  const [cancelled] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/delivery-notices/${noticeId}/cancel`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '取消通知' }).click(),
  ]);
  assert.equal(cancelled.status(), 200, await cancelled.text());
  assert.equal(db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(noticeId).state, 'CANCELLED');
  return { appliedChangeId: changeId, cancelledNoticeId: noticeId };
}

const fixture = seed(); const evidence = { responsive: [], functional: {}, browser: edgePath };
try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`; const token = await login(baseUrl); const reviewerToken = await login(baseUrl, 'reviewer', 'review123');
  const noticeProbe = await fetch(`${baseUrl}/api/delivery-notices?state=CONFIRMED`, { headers: { authorization: `Bearer ${token}` } });
  const noticeProbeBody = await noticeProbe.json();
  assert.ok(noticeProbeBody.notices?.some((notice) => notice.id === fixture.noticeId), `seeded notice unavailable: ${JSON.stringify(noticeProbeBody)}`);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
    for (const route of routes) {
      await page.goto(`${baseUrl}#${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      await page.getByText('正在载入应用...').waitFor({ state: 'hidden', timeout: 15_000 });
      await page.waitForTimeout(150);
      assert.ok(!(await page.locator('body').innerText()).includes('正在载入应用...'), `${width}px ${route} remained in loading state`);
      const metrics = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('button,input,select,textarea')].filter((node) => {
          const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        });
        return { clientWidth: document.documentElement.clientWidth, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          minControlHeight: controls.length ? Math.min(...controls.map((node) => node.getBoundingClientRect().height)) : 44,
          smallControls: controls.filter((node) => node.getBoundingClientRect().height < 44).map((node) => ({ tag: node.tagName, text: node.textContent?.trim().slice(0, 35), className: node.className, height: node.getBoundingClientRect().height })).slice(0, 10) };
      });
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `${width}px ${route} horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
      assert.ok(metrics.minControlHeight >= 44, `${width}px ${route} touch target ${metrics.minControlHeight}px ${JSON.stringify(metrics.smallControls)}`);
      evidence.responsive.push({ width, route, ...metrics });
    }
    assert.deepEqual(errors, [], `${width}px browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: join(outputDir, `responsive-${width}.png`), fullPage: true });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); await page.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await page.goto(`${baseUrl}#quotations`, { waitUntil: 'networkidle' });
  await page.goto(`${baseUrl}#orders`, { waitUntil: 'networkidle' });
  await page.goBack({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).hash, '#quotations', 'Back restores the quotation route');
  await page.goForward({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).hash, '#orders', 'Forward restores the order route');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).hash, '#orders', 'Refresh preserves the direct order route');
  evidence.navigation = { direct: true, back: true, forward: true, refresh: true };
  const quotation = await quotationThroughUi(page, baseUrl);
  const order = await orderThroughUi(page, browser, baseUrl, reviewerToken);
  const workflow = await noticeAndChangeThroughUi(page, baseUrl, fixture.directOrder);
  const additional = await approvedChangeAndCancelledNoticeThroughUi(page, browser, baseUrl, reviewerToken, fixture.directOrder);
  const directId = await createDeliveryThroughUi(page, baseUrl, 'DIRECT_ORDER', fixture.directOrder);
  const noticeId = await createDeliveryThroughUi(page, baseUrl, 'DELIVERY_NOTICE', fixture.noticeId);
  await oqcAndConfirmThroughUi(page, baseUrl, directId);
  await oqcAndConfirmThroughUi(page, baseUrl, noticeId);
  await page.screenshot({ path: join(outputDir, 'functional-final-390.png'), fullPage: true });
  evidence.functional = { ...quotation, ...order, ...workflow, ...additional, directId, noticeId, directStatus: db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(directId).status,
    noticeStatus: db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(noticeId).status,
    noticeConsumedMicros: db.prepare("SELECT notified_qty_micros FROM delivery_notice_lines WHERE id='batch-ui-notice-line'").get().notified_qty_micros };
  assert.deepEqual(evidence.functional, { ...quotation, ...order, ...workflow, ...additional, directId, noticeId, directStatus: 'CONFIRMED', noticeStatus: 'CONFIRMED', noticeConsumedMicros: 1_000_000 });
  await context.close();
  writeFileSync(join(outputDir, 'browser-acceptance.json'), JSON.stringify({ ok: true, ...evidence }, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, responsiveChecks: evidence.responsive.length, functional: evidence.functional }, null, 2)}\n`);
} finally {
  await browser?.close(); server.closeAllConnections?.(); if (server.listening) await new Promise((done) => server.close(done));
  db.close(); rmSync(tempDir, { recursive: true, force: true });
}
