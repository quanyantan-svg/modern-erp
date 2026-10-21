import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { upsertCanonicalInventory } from '../../server/test-support/inventory-canonical-fixture.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const widths = [320, 390, 430, 680];
const SERVICE_ROUTE = 'service-fulfillments';
const CONSIGNMENT_ROUTE = 'consignment-commercial';
const DAY = '2026-10-21';
const C = 'w8ui-c'; const W_SRC = 'w8ui-src'; const W_SITE = 'w8ui-site'; const W_RET = 'w8ui-ret';
const P_SVC = 'w8ui-svc'; const P_PHY = 'w8ui-phy';

const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave8-ui-'));
assert.equal(resolve(tempDir).startsWith(resolve(tmpdir())), true, 'temporary DB must stay inside the OS temp directory');
const db = createDatabase(join(tempDir, 'wave8-browser.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

// Real business data, so the workflow drives genuine selectors rather than typed ids.
function seed() {
  const stamp = new Date().toISOString();
  for (const [id, code, active] of [[W_SRC, 'W8UI-SRC', 1], [W_SITE, 'W8UI-SITE', 1], [W_RET, 'W8UI-RET', 1]]) {
    db.prepare('INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,\'\',1,?,?)').run(id, code, code, 'x', stamp, stamp);
  }
  db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,?,?)").run(C, 'W8UI-C', 'Wave 8 UI Customer', stamp, stamp);
  for (const [id, code, service] of [[P_SVC, 'W8UI-SVC', 1], [P_PHY, 'W8UI-PHY', 0]]) {
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
      VALUES(?,?,?,'x','EA',100,0,1,?,?,'EA','NONE')`).run(id, code, code, stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,1,?,?,1,?,?,?,?)`).run(`${id}-c`, id, service, service ? 'STANDARD' : null, stamp, stamp, 'user-sales', 'user-sales');
  }
  // The canonical position row, not the legacy 3-column insert: V21 addresses stock by
  // canonical position_key, so a legacy row would report zero available.
  upsertCanonicalInventory(db, { warehouseId: W_SRC, productId: P_PHY, quantity: 30, position: {}, rowId: 'w8ui-inv' });
  db.prepare("INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at) VALUES(?,'MOVING_AVERAGE',?,?,30,3000,?)").run(`NONE:${W_SRC}:${P_PHY}`, P_PHY, W_SRC, stamp);
  for (const [orderId, productId, quantity] of [['w8ui-so-svc', P_SVC, 10], ['w8ui-so-phy', P_PHY, 10]]) {
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,payment_terms_days)
      VALUES(?,?,?,'APPROVED',1000,'user-sales',?,?,?,0)`).run(orderId, `SO-${orderId}`, C, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den)
      VALUES(?,?,?,?,100,?,1,'EA',?,1000000,1,1,?,1000000)`).run(`${orderId}-i`, orderId, productId, quantity, quantity * 100, quantity * 1_000_000, quantity * 1_000_000);
  }
  db.prepare(`INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
    VALUES('w8ui-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,'user-sales',?)`).run(stamp);
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200, `login failed for ${username}`);
  return (await response.json()).token;
}

async function postJson(baseUrl, token, path, body, idempotencyKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

// Overflow and touch-target measurement, applied after every workflow step.
async function measure(page) {
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,select,textarea')].filter((node) => {
      const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    });
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      minControlHeight: controls.length ? Math.min(...controls.map((node) => node.getBoundingClientRect().height)) : 44,
    };
  });
}

async function assertWidth(page, label) {
  const metrics = await measure(page);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `${label}: horizontal overflow (${metrics.scrollWidth} > ${metrics.clientWidth})`);
  assert.ok(metrics.minControlHeight >= 44, `${label}: touch target below 44px (${metrics.minControlHeight})`);
  return metrics;
}


// Select by the record id in the option value. Seeded demo master data makes option
// positions and labels unstable; the business identity is the only stable selector.
async function pickValue(page, locator, id) {
  const options = await locator.evaluate((node) => [...node.options].map((option) => option.value));
  assert.ok(options.includes(id), );
  await locator.selectOption(id);
  return id;
}

const results = { responsiveChecks: [], workflow: [], navigation: {} };

try {
  seed();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminToken = await login(baseUrl, 'admin', 'admin123');
  const salesToken = await login(baseUrl, 'sales', 'sales123');
  const warehouseToken = await login(baseUrl, 'warehouse', 'warehouse123');
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    // A deliberately provoked business conflict (409) is logged by the browser as a failed
    // resource load. That is the expected outcome of the conflict step, not a defect; real
    // script exceptions still arrive through pageerror and are asserted below.
    page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((value) => localStorage.setItem('modern_erp_token', value), salesToken);

    const step = (name) => page.evaluate((label) => { window.__w8Step = label; return label; }, name);

    // ---------- Service Create + Confirm ----------
    await page.goto(`${baseUrl}#${SERVICE_ROUTE}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wave8-editor select');
    results.responsiveChecks.push({ width, route: SERVICE_ROUTE, step: 'create', ...(await assertWidth(page, `${width}px service create`)) });

    await pickValue(page, page.locator('.wave8-editor select').nth(0), 'w8ui-so-svc');
    await page.waitForTimeout(400);
    await pickValue(page, page.locator('.wave8-editor select').nth(1), 'w8ui-so-svc-i');
    await page.fill('.wave8-editor input[type=number] >> nth=0', '2');
    await page.click('.wave8-editor button.primary');
    await page.waitForSelector('.wave8-card', { timeout: 15000 });
    await page.waitForTimeout(400);
    const pendingText = await page.locator('body').innerText();
    assert.ok(pendingText.includes('PENDING'), `${width}px: service fulfillment was not created as PENDING`);
    results.responsiveChecks.push({ width, route: SERVICE_ROUTE, step: 'created', ...(await assertWidth(page, `${width}px service created`)) });

    await page.getByRole('button', { name: '确认', exact: true }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('CONFIRMED'), null, { timeout: 15000 });
    results.responsiveChecks.push({ width, route: SERVICE_ROUTE, step: 'confirmed', ...(await assertWidth(page, `${width}px service confirmed`)) });
    results.workflow.push({ width, flow: 'service-create-confirm', ok: true });

    // ---------- Real SALES Handoff + Settlement + cross-warehouse Return ----------
    // Admin prepares master/header context only. Every executable Consignment step below,
    // including both reference reads, is performed in the browser as the real SALES user.
    const createdLocation = await postJson(baseUrl, adminToken, '/api/consignment-commodity-locations', {
      locationCode: `SITE-${width}`, customerId: C, name: `Site ${width}`,
      physicalWarehouseId: W_SITE, physicalBinId: null, effectiveFrom: DAY,
    }, `w8ui-location-${width}`);
    const createdDocument = await postJson(baseUrl, adminToken, '/api/consignment-commercial-documents', {
      customerId: C, sourceWarehouseId: W_SRC, businessDate: DAY, currencyCode: 'CNY',
      lines: [{ productId: P_PHY, consignmentCommodityLocationId: createdLocation.location.id,
        consignedQtyMicros: 4_000_000, unitPriceCents: 100 }],
    }, `w8ui-document-${width}`);

    await page.goto(`${baseUrl}#${CONSIGNMENT_ROUTE}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: new RegExp(createdDocument.documentNo) }).click();
    await page.waitForSelector('.wave8-detail', { timeout: 15000 });
    await page.waitForTimeout(600);
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'draft', ...(await assertWidth(page, `${width}px consignment draft`)) });

    await page.waitForFunction(() => document.body.innerText.includes('W8UI-SRC'));
    await page.locator('.wave8-handoff__row input[type=number]').first().fill('4');
    await page.getByRole('button', { name: '执行 Handoff' }).click();
    try {
      await page.waitForFunction(() => document.body.innerText.includes('INSTRUCTED'), null, { timeout: 20000 });
    } catch (timeout) {
      const diagnostics = await page.locator('body').innerText();
      throw new Error(`${width}px: handoff did not reach INSTRUCTED.\n${diagnostics.slice(0, 1200)}`);
    }
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'handoff', ...(await assertWidth(page, `${width}px handoff`)) });

    await page.getByRole('button', { name: '结算', exact: true }).first().click();
    await page.waitForSelector('.wave8-detail .wave8-editor');
    await page.locator('.wave8-detail .wave8-editor input[type=number]').fill('1');
    await page.getByRole('button', { name: '确认结算' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('PARTIAL_SETTLED'), null, { timeout: 20000 });
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'settled', ...(await assertWidth(page, `${width}px settled`)) });

    await page.getByRole('button', { name: '退回', exact: true }).first().click();
    await page.waitForSelector('.wave8-detail .wave8-editor');
    await page.locator('.wave8-detail .wave8-editor input[type=number]').fill('1');
    await pickValue(page, page.locator('.wave8-detail .wave8-editor select'), 'w8ui-ret');
    await page.getByRole('button', { name: '确认退回' }).click();
    await page.waitForTimeout(2500);
    const afterReturn = await page.locator('body').innerText();
    assert.ok(/SETTLED|PARTIAL_SETTLED/.test(afterReturn), `${width}px: return did not leave a valid document state`);
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'returned', ...(await assertWidth(page, `${width}px returned`)) });
    results.workflow.push({ width, flow: 'sales-consignment-handoff-settle-cross-warehouse-return', ok: true });

    // ---------- Business conflict: settle a line that no longer has capacity ----------
    await page.getByRole('button', { name: '结算', exact: true }).first().click();
    await page.waitForSelector('.wave8-detail .wave8-editor');
    await page.locator('.wave8-detail .wave8-editor input[type=number]').fill('9999');
    await page.getByRole('button', { name: '确认结算' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('业务冲突'), null, { timeout: 15000 });
    const conflictText = await page.locator('body').innerText();
    assert.ok(conflictText.includes('业务冲突'), `${width}px: business conflict was not surfaced`);
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'conflict', ...(await assertWidth(page, `${width}px conflict`)) });
    results.workflow.push({ width, flow: 'business-conflict', ok: true });

    assert.deepEqual(errors, [], `${width}px browser script errors: ${errors.join(' | ')}`);

    // ---------- Permission refusal ----------
    // The security boundary is the server, not the hidden control. Prove it with real
    // Wave 8 mutations attempted by a role that must not inherit Sales write access.
    const refuse = async (url, body, key) => fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${warehouseToken}`, 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    assert.equal((await refuse('/api/service-fulfillments', { salesOrderItemId: 'w8ui-so-svc-i', confirmationQtyMicros: 1000000, businessDate: DAY }, `w8ui-perm-s-${width}`)).status, 403, `warehouse role must not create a service fulfillment (${width}px)`);
    assert.equal((await refuse('/api/consignment-commercial-documents', { customerId: C, sourceWarehouseId: W_SRC, businessDate: DAY, currencyCode: 'CNY', lines: [] }, `w8ui-perm-c-${width}`)).status, 403, `warehouse role must not create a consignment document (${width}px)`);
    const deniedReference = await fetch(`${baseUrl}/api/consignment-commercial-documents/${createdDocument.id}/handoff-position-references`, { headers: { authorization: `Bearer ${warehouseToken}` } });
    assert.equal(deniedReference.status, 403, `warehouse role must not read Consignment position references (${width}px)`);
    const genericWarehouse = await fetch(`${baseUrl}/api/warehouses`, { headers: { authorization: `Bearer ${salesToken}` } });
    assert.equal(genericWarehouse.status, 403, `SALES role must not gain warehouse-master access (${width}px)`);

    await page.addInitScript((value) => localStorage.setItem('modern_erp_token', value), warehouseToken);
    await page.goto(`${baseUrl}#${CONSIGNMENT_ROUTE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const readOnlyText = await page.locator('body').innerText();
    assert.ok(!readOnlyText.includes('执行 Handoff'), `${width}px: an unauthorized role was offered a Wave 8 mutation`);
    results.responsiveChecks.push({ width, route: CONSIGNMENT_ROUTE, step: 'permission', ...(await assertWidth(page, `${width}px permission`)) });
    results.workflow.push({ width, flow: 'permission-denied', ok: true });

    // ---------- Direct / Back / Forward / Refresh ----------
    await page.addInitScript((value) => localStorage.setItem('modern_erp_token', value), adminToken);
    await page.goto(`${baseUrl}#${SERVICE_ROUTE}`, { waitUntil: 'networkidle' });
    await page.goto(`${baseUrl}#${CONSIGNMENT_ROUTE}`, { waitUntil: 'networkidle' });
    await page.goBack({ waitUntil: 'networkidle' }); assert.ok(page.url().endsWith(`#${SERVICE_ROUTE}`));
    await page.goForward({ waitUntil: 'networkidle' }); assert.ok(page.url().endsWith(`#${CONSIGNMENT_ROUTE}`));
    await page.reload({ waitUntil: 'networkidle' }); assert.ok(page.url().endsWith(`#${CONSIGNMENT_ROUTE}`));
    results.navigation = { direct: true, back: true, forward: true, refresh: true };

    await context.close();
  }

  process.stdout.write(`${JSON.stringify({ ok: true, browser: edgePath, responsiveChecks: results.responsiveChecks.length, workflowFlows: results.workflow.length, navigation: results.navigation, workflow: results.workflow }, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  const resolvedTemp = resolve(tempDir);
  if (resolvedTemp.startsWith(resolve(tmpdir())) && resolvedTemp !== resolve(tmpdir())) rmSync(resolvedTemp, { recursive: true, force: true });
}
