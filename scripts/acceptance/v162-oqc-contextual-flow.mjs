import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v162-oqc-visual');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v162-oqc-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));

const widths = [320, 390, 430, 680];
const results = [];
let browser;
let baseUrl;

// In-memory stateful mocks backing /api/sales-deliveries and /api/oqc
const inspectionByDelivery = new Map(); // deliveryId -> inspection id
const inspectionState = new Map(); // inspectionId -> { status, result, ... }
let nextInspectionSeq = 1;

function baseDelivery(overrides = {}) {
  const id = overrides.id || 'sd-flow-1';
  return {
    id,
    delivery_no: overrides.delivery_no || 'SD-20261003-001',
    sales_order_id: 'sales-order-1',
    customer_id: 'customer-1',
    customerCode: 'C-001',
    customerName: '福州青松机电有限公司',
    warehouse_id: 'warehouse-1',
    warehouseCode: 'WH-OUT-01',
    warehouseName: '主出货仓',
    delivery_date: '2026-10-03',
    status: 'DRAFT',
    statusLabel: '草稿',
    total_cents: 360000,
    itemCount: 1,
    billedQuantity: 0,
    remainingBillQuantity: 3,
    billing_mode: 'SEPARATE',
    creatorName: '林宇',
    confirmedByName: null,
    soNo: 'SO-20261002-001',
    qualityState: overrides.qualityState || { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null },
    archiveState: { archived: false, archivedAt: null, reason: '' },
    archiveEligibility: { allowed: false, blockers: [] },
    billingSummary: { status: 'UNBILLED', billedQuantity: 0, remainingQuantity: 3 },
    items: overrides.items || [
      {
        id: 'sdi-1',
        delivery_id: id,
        productId: 'product-1',
        productCode: 'FG-MOTOR',
        productName: '工业电机',
        unit: '台',
        quantity: 3,
        unitPriceCents: 120000,
        amountCents: 360000,
        lineNo: 1,
        salesOrderItemId: 'soi-1',
        orderedQuantity: 3,
        deliveredQuantity: 0,
        remainingQuantity: 3,
        fulfillmentState: 'NOT_DELIVERED',
        trackingAllocations: [],
      },
    ],
    relationships: {
      upstream: [{ type: 'SALES_ORDER', id: 'sales-order-1', documentNo: 'SO-20261002-001' }],
      downstream: [],
      subledger: null,
    },
    ...overrides,
  };
}

const delivery = baseDelivery();

function refreshQuality() {
  const inspectionId = inspectionByDelivery.get(delivery.id) || null;
  if (delivery.status !== 'DRAFT') {
    delivery.qualityState = { code: 'PASS', label: '检验合格', inspectionId };
    return;
  }
  if (!inspectionId) {
    delivery.qualityState = { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
    return;
  }
  const insp = inspectionState.get(inspectionId);
  if (insp.status === 'DRAFT' || insp.status === 'PENDING') {
    delivery.qualityState = { code: 'INSPECTION_DRAFT', label: '检验草稿', inspectionId };
    return;
  }
  if (insp.status === 'CANCELLED') {
    delivery.qualityState = { code: 'NOT_INSPECTED', label: '未检验（最近检验已取消）', inspectionId };
    return;
  }
  if (insp.result === 'PASS') {
    delivery.qualityState = { code: 'PASS', label: '检验合格', inspectionId };
    return;
  }
  if (insp.result === 'FAIL') {
    delivery.qualityState = { code: 'FAIL', label: '检验不合格', inspectionId };
    return;
  }
  delivery.qualityState = { code: 'INSPECTION_DRAFT', label: '检验草稿', inspectionId };
}

function inspectionToJson(id) {
  const insp = inspectionState.get(id);
  return {
    inspection: {
      id,
      oqc_no: `OQC-${String(id).padStart(3, '0')}`,
      sales_delivery_id: delivery.id,
      sales_order_id: delivery.sales_order_id,
      source_document_no: delivery.delivery_no,
      source_order_no: delivery.soNo,
      customer_id: delivery.customer_id,
      customer_name: delivery.customerName,
      source_warehouse_code: delivery.warehouseCode,
      source_warehouse_name: delivery.warehouseName,
      source_business_date: delivery.delivery_date,
      inspection_date: insp.inspection_date,
      inspection_type: 'NORMAL',
      sample_quantity: insp.sample_quantity,
      total_quantity: insp.total_quantity,
      qualified_quantity: insp.passed_quantity,
      reject_quantity: insp.failed_quantity,
      result: insp.result,
      status: insp.status,
      inspector_name: insp.inspector_name || '—',
      disposition: insp.disposition || '',
      defect_reason: insp.defect_reason || '',
      remark: insp.remark || '',
      authoritative: true,
      items: [
        {
          id: 'oqc-item-1',
          product_code: 'FG-MOTOR',
          product_name: '工业电机',
          specification: '—',
          snapshot_quantity: 3,
          quantity: 3,
          unit: '台',
          snapshot_warehouse_id: delivery.warehouse_id,
          snapshot_batch_no: '',
        },
      ],
    },
  };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installRoutes(context) {
  // List endpoint
  await context.route('**/api/sales-deliveries?**', async (route) => {
    await json(route, { salesDeliveries: [delivery] });
  });

  // Detail endpoint (POST confirm/cancel) and GET detail
  await context.route('**/api/sales-deliveries/*', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (method === 'GET') {
      refreshQuality();
      await json(route, { salesDelivery: { ...delivery } });
      return;
    }
    if (method === 'POST' && path.endsWith('/api/sales-deliveries/' + delivery.id)) {
      const body = JSON.parse(route.request().postData() || '{}');
      const action = body.action;
      if (action === 'confirm') {
        if (delivery.qualityState.code !== 'PASS' && delivery.qualityState.code !== 'WAIVED') {
          await json(route, { error: '质量门禁未通过' }, 409);
          return;
        }
        delivery.status = 'CONFIRMED';
        delivery.statusLabel = '已确认';
        refreshQuality();
        await json(route, { ok: true, id: delivery.id, status: 'CONFIRMED' });
        return;
      }
      if (action === 'cancel') {
        delivery.status = 'CANCELLED';
        delivery.statusLabel = '已取消';
        refreshQuality();
        await json(route, { ok: true });
        return;
      }
    }
    await route.continue();
  });

  // OQC list
  await context.route('**/api/oqc?**', async (route) => {
    const list = [...inspectionState.entries()].map(([id, insp]) => ({
      id,
      oqc_no: `OQC-${String(id).padStart(3, '0')}`,
      ...insp,
    }));
    await json(route, { inspections: list });
  });

  // OQC POST (create)
  await context.route('**/api/oqc', async (route) => {
    if (route.request().method() === 'GET') return route.continue();
    const body = JSON.parse(route.request().postData() || '{}');
    const id = `oqc-insp-${nextInspectionSeq++}`;
    inspectionByDelivery.set(body.sales_delivery_id, id);
    inspectionState.set(id, {
      status: 'DRAFT',
      result: 'PASS',
      passed_quantity: 3,
      failed_quantity: 0,
      sample_quantity: 3,
      total_quantity: 3,
      inspection_date: '2026-10-03',
      inspector_name: '陈晨',
      disposition: '',
      defect_reason: '',
      remark: '',
    });
    refreshQuality();
    await json(route, { id, oqc_no: `OQC-${String(id).padStart(3, '0')}` }, 201);
  });

  // OQC inspection detail
  await context.route('**/api/oqc/*', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    if (method === 'GET' && inspectionState.has(id)) {
      await json(route, inspectionToJson(id));
      return;
    }
    if (method === 'POST' && url.pathname.endsWith('/complete')) {
      const body = JSON.parse(route.request().postData() || '{}');
      const insp = inspectionState.get(id);
      insp.status = 'COMPLETED';
      insp.result = body.result || 'PASS';
      insp.passed_quantity = body.passed_quantity ?? insp.passed_quantity;
      insp.failed_quantity = body.failed_quantity ?? insp.failed_quantity;
      insp.remark = body.remark ?? insp.remark;
      insp.defect_reason = body.defect_reason ?? insp.defect_reason;
      insp.disposition = body.disposition ?? insp.disposition;
      refreshQuality();
      await json(route, { ok: true, status: 'COMPLETED', result: insp.result });
      return;
    }
    if (method === 'POST' && url.pathname.endsWith('/cancel')) {
      const insp = inspectionState.get(id);
      insp.status = 'CANCELLED';
      refreshQuality();
      await json(route, { ok: true });
      return;
    }
    await route.continue();
  });

  // Lookups and inventory lookups the editor might request.
  await context.route('**/api/customers', (route) =>
    json(route, { customers: [{ id: 'customer-1', code: 'C-001', name: '福州青松机电有限公司' }] }),
  );
  await context.route('**/api/warehouses', (route) =>
    json(route, { warehouses: [{ id: 'warehouse-1', code: 'WH-OUT-01', name: '主出货仓' }] }),
  );
  await context.route('**/api/products', (route) =>
    json(route, {
      products: [
        {
          id: 'product-1',
          code: 'FG-MOTOR',
          name: '工业电机',
          unit: '台',
          active: true,
          trackingPolicy: 'NONE',
        },
      ],
    }),
  );
  await context.route('**/api/lookup/sales-orders-source', (route) =>
    json(route, {
      orders: [
        {
          id: 'sales-order-1',
          orderNo: 'SO-20261002-001',
          customerId: 'customer-1',
          customerName: '福州青松机电有限公司',
          items: [
            {
              salesOrderItemId: 'soi-1',
              productId: 'product-1',
              quantity: 3,
              orderedQuantity: 3,
              deliveredQuantity: 0,
              unitPriceCents: 120000,
            },
          ],
        },
      ],
    }),
  );
  await context.route('**/api/users', (route) =>
    json(route, {
      users: [{ id: 'u-admin', username: 'admin', displayName: '管理员' }],
    }),
  );
  await context.route('**/api/roles', (route) =>
    json(route, { roles: [{ id: 'role-admin', code: 'ADMIN', name: '系统管理员' }] }),
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.mobile-shell')?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shellWidth: shell?.width || 0,
    };
  });
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth,
    `${label}: horizontal overflow (scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth})`,
  );
}

async function captureState(page, label) {
  return await page.evaluate(() => {
    const identityNumber = document.querySelector('.v16-sales-delivery-detail__number')?.textContent || '';
    const qualityLabel = document.querySelector('.v16-sales-delivery-quality')?.textContent?.trim() || '';
    const primary = document.querySelector('[data-testid="sales-delivery-action-primary"]')?.textContent?.trim() || '';
    const secondary = document.querySelector('[data-testid="sales-delivery-action-secondary"]')?.textContent?.trim() || '';
    const statusChip = document.querySelector('.v16-sales-delivery-status')?.textContent?.trim() || '';
    return { identityNumber, qualityLabel, primary, secondary, statusChip };
  });
}

async function newPage(token, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  await installRoutes(context);
  const page = await context.newPage();
  const errors = collectErrors(page);
  return { context, page, errors };
}

async function runJourneyWithToken(token, width) {
  const { context, page, errors } = await newPage(token, width);
  try {
    // Step 1: open sales-delivery list
    await page.goto(`${baseUrl}#sales-deliveries`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="sales-delivery-row-' + delivery.id + '"]').waitFor({ timeout: 15000 });
    await assertNoOverflow(page, `${width} list`);

    // Step 2: open detail
    await page.locator('[data-testid="sales-delivery-row-' + delivery.id + '"] .v16-sales-delivery-row__open').click();
    await page.locator('.v16-sales-delivery-detail__identity').waitFor({ timeout: 15000 });
    let state = await captureState(page);
    assert.equal(state.identityNumber, delivery.delivery_no, `${width}: delivery number mismatch`);
    assert.match(state.qualityLabel, /未检验/, `${width}: initial quality should be 未检验, got "${state.qualityLabel}"`);
    assert.equal(state.primary, '创建 OQC', `${width}: initial primary action should be 创建 OQC, got "${state.primary}"`);
    await page.screenshot({ path: join(outputDir, `v162-oqc-detail-not-inspected-${width}.png`), fullPage: true });

    // Step 3: click 创建 OQC → triggers POST /api/oqc + navigateToPage('oqc', {documentId})
    await page.locator('[data-testid="sales-delivery-action-primary"]').click();
    await page.waitForTimeout(1500);
    const expectedInspectionId = inspectionByDelivery.get(delivery.id);
    assert.ok(expectedInspectionId, `${width}: inspection id should be assigned after 创建 OQC`);
    // The navigateToPage sets location.hash to the page key; the documentId
    // is held in React state and consumed by QualityPage. Verify the OQC
    // inspection modal is rendered.
    await page.locator(`.modal[aria-label*="OQC"]`).first().waitFor({ timeout: 15000 }).catch(async () => {
      // Fallback: the modal may be rendered under a different selector
      await page.locator('.sheet').first().waitFor({ timeout: 5000 });
    });
    // Verify the inspection detail API was hit with our expected id
    const apiHits = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/oqc/')).map((r) => r.name));
    assert.ok(
      apiHits.some((url) => url.includes(`/api/oqc/${expectedInspectionId}`)),
      `${width}: should fetch /api/oqc/${expectedInspectionId}, got ${JSON.stringify(apiHits)}`,
    );

    await assertNoOverflow(page, `${width} oqc`);
    await page.screenshot({ path: join(outputDir, `v162-oqc-inspection-draft-${width}.png`), fullPage: true });

    // Step 5: complete PASS via direct API + then navigate back to sales-delivery
    const inspId = expectedInspectionId;
    const completeResp = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/oqc/${id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inspection_date: '2026-10-03',
          inspection_type: 'NORMAL',
          sample_quantity: 3,
          result: 'PASS',
          passed_quantity: 3,
          failed_quantity: 0,
          remark: '',
          defect_reason: '',
          disposition: '',
          inspection_quantity: 3,
        }),
      });
      return { status: resp.status, body: await resp.text() };
    }, inspId);
    assert.equal(completeResp.status, 200, `${width}: OQC complete must succeed, got ${completeResp.status}: ${completeResp.body}`);

    // Step 6: navigate back to originating sales delivery
    await page.goto(`${baseUrl}#sales-deliveries`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="sales-delivery-row-' + delivery.id + '"]').waitFor({ timeout: 10000 });
    await page.locator('[data-testid="sales-delivery-row-' + delivery.id + '"] .v16-sales-delivery-row__open').click();
    await page.locator('.v16-sales-delivery-detail__identity').waitFor({ timeout: 10000 });
    state = await captureState(page);
    assert.match(state.qualityLabel, /检验合格/, `${width}: after PASS quality should be 检验合格, got "${state.qualityLabel}"`);
    assert.equal(state.primary, '确认出库', `${width}: after PASS primary should be 确认出库, got "${state.primary}"`);
    await page.screenshot({ path: join(outputDir, `v162-oqc-detail-pass-${width}.png`), fullPage: true });

    // Step 7: click 确认出库 → confirms delivery, status = CONFIRMED
    await page.locator('[data-testid="sales-delivery-action-primary"]').click();
    await page.getByRole('button', { name: '确认出库', exact: true }).click();
    await page.waitForTimeout(800);
    state = await captureState(page);
    assert.match(state.statusChip, /已确认/, `${width}: after confirm status should be 已确认, got "${state.statusChip}"`);
    await page.screenshot({ path: join(outputDir, `v162-oqc-detail-confirmed-${width}.png`), fullPage: true });

    if (errors.length) {
      throw new Error(`browser errors at ${width}px: ${errors.join(' | ')}`);
    }
    return { width, ok: true };
  } catch (error) {
    return {
      width,
      ok: false,
      error: error.message,
    };
  } finally {
    await context.close();
  }
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login(baseUrl);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    // Reset delivery state between viewports
    delivery.status = 'DRAFT';
    delivery.statusLabel = '草稿';
    delivery.confirmedByName = null;
    delivery.relationships.downstream = [];
    inspectionByDelivery.clear();
    inspectionState.clear();
    nextInspectionSeq = 1;
    refreshQuality();

    const result = await runJourneyWithToken(token, width);
    results.push(result);
    console.log(`${width}=${result.ok ? 'PASS' : 'FAIL'} ${result.error || ''}`);
  }
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}

const summary = {
  widths: results.map((r) => ({ width: r.width, ok: r.ok, error: r.error || null })),
  allPassed: results.every((r) => r.ok),
};
process.stdout.write('\n' + JSON.stringify(summary, null, 2) + '\n');
process.exit(summary.allPassed ? 0 : 1);
