// V18 Manufacturing & Quality Domain Closure — Final Acceptance Evidence.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v18-manufacturing-quality-final');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-mq-final-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];

let browser;
let pass = 0;
const failures = [];
const surfaces = [
  'production-orders',
  'material-issues',
  'production-quality',
  'production-receipts',
  'production-scan',
];

async function api(method, path, token, body, idempotencyKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

function recordResult(surface, width, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${surface} @ ${width}px`);
  } else {
    failures.push({ surface, width, detail });
    console.log(`FAIL ${surface} @ ${width}px: ${detail}`);
  }
}

async function seed(adminToken) {
  // Use the production V18 API to create real orders, issues, receipts, inspections
  // so the surfaces have data to render.
  const productId = 'mq-fa-product-001';
  const componentId = 'mq-fa-component-001';
  const warehouseId = 'mq-fa-warehouse-001';
  const orderId = 'mq-fa-order-001';
  const order2Id = 'mq-fa-order-002';

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?,?)`).run(productId, 'MQ-FA-LONG-CODE-PART-001', '最终验收产品', '制造', '件', 10000, 1000, now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?,?)`).run(componentId, 'MQ-FA-LONG-CODE-COMP-001', '组件', '原材料', '件', 1000, 500, now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(warehouseId, 'MQ-FA-WH-001', 'MQ 主仓', '', '', now, now);
  db.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,approval_status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'ACTIVE','SELF_MAKE','APPROVED','','user-admin',?,?)`).run('mq-fa-bom-001', productId, '1.0', now, now);
  db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator) VALUES(?,?,?,?,0,1,?,1,1)`).run('mq-fa-bomi-001', 'mq-fa-bom-001', componentId, 2, '件');
  db.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,200,?)`).run(warehouseId, componentId, now);
  db.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,100,?)`).run(warehouseId, productId, now);
  db.prepare(`INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,created_at,updated_at) VALUES(?,?,?,?,?,'ACTIVE',?,?)`).run('mq-fa-routing-001', productId, 'MQ-FA-RT-001', '最终验收工艺', '1.0', now, now);
  db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run('mq-fa-rto-001', 'mq-fa-routing-001', 1, 'OP-10', '最终验收工序一', 'MQ-WC-01', 1, 2, null, 60, 120, 10000, now, now);
  db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run('mq-fa-rto-002', 'mq-fa-routing-001', 2, 'OP-20', '最终验收工序二', 'MQ-WC-02', 1, 1, null, 60, 60, 10000, now, now);

  // Quality masters.
  db.prepare(`INSERT INTO inspection_items(id,code,name,category,unit,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run('mq-fa-item-001', 'CH-FA-001', '最终验收外观', '视觉', '次', now, now);
  db.prepare(`INSERT INTO inspection_instruments(id,code,name,specification,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`).run('mq-fa-instrument-001', 'INS-FA-001', '最终验收卡尺', '0-150mm', now, now);
  db.prepare(`INSERT INTO inspection_plans(id,code,name,target_type,target_id,product_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`).run('mq-fa-plan-001', 'CH-FA-PLAN-001', '最终验收方案', 'PRODUCT', productId, productId, now, now);
  db.prepare(`INSERT INTO inspection_plan_items(id,plan_id,sequence,item_id,criterion_name,specification,result_type,min_value,max_value,unit,instrument_id,required,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)`).run('mq-fa-pi-001', 'mq-fa-plan-001', 1, 'mq-fa-item-001', '最终验收外观', '无划痕', 'PASS_FAIL', null, null, '次', 'mq-fa-instrument-001', now);

  // Create production orders via the real V18 API so the data goes through the
  // canonical engineering resolver + state machine.
  const r1 = await api('POST', '/api/production-orders', adminToken, {
    productId, bomId: 'mq-fa-bom-001', quantity: 10, plannedStart: '2026-10-01', plannedFinish: '2026-10-31', remark: '最终验收工单',
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const orderIdCreated = r1.data.id;

  const r2 = await api('POST', '/api/production-orders', adminToken, {
    productId, bomId: 'mq-fa-bom-001', quantity: 5, plannedStart: '2026-10-05', plannedFinish: '2026-10-25', remark: '最终验收工单二',
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const order2IdCreated = r2.data.id;

  // Walk through Submit / Approve / Release / Start.
  for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
    const r = await api('POST', `/api/production-orders/${orderIdCreated}/state`, adminToken, { target });
    assert.equal(r.status, 200, `${target}: ${JSON.stringify(r.data)}`);
    const r3 = await api('POST', `/api/production-orders/${order2IdCreated}/state`, adminToken, { target });
    assert.equal(r3.status, 200, `${target}-2: ${JSON.stringify(r3.data)}`);
  }

  // Create material issue.
  const detail = await api('GET', `/api/production-orders/${orderIdCreated}`, adminToken);
  const requirementLineId = detail.data.order.items[0].id;
  const issueCreate = await api('POST', '/api/production-material-issues', adminToken, {
    productionOrderId: orderIdCreated, warehouseId, items: [{ requirementLineId, productId: componentId, issueQuantity: 4 }],
  });
  assert.equal(issueCreate.status, 201, JSON.stringify(issueCreate.data));
  const issueConfirm = await api('POST', `/api/production-material-issues/${issueCreate.data.id}/confirm`, adminToken, {}, `mq-fa-issue-${Date.now()}`);
  assert.equal(issueConfirm.status, 200, JSON.stringify(issueConfirm.data));

  // Create supplement.
  const supp = await api('POST', '/api/production-material-supplements', adminToken, {
    productionOrderId: orderIdCreated, warehouseId, reasonCode: 'SHORTAGE', items: [{ productId: componentId, quantity: 1 }],
  });
  assert.equal(supp.status, 201, JSON.stringify(supp.data));
  const suppConfirm = await api('POST', `/api/production-material-supplements/${supp.data.id}/confirm`, adminToken, {}, `mq-fa-supp-${Date.now()}`);
  assert.equal(suppConfirm.status, 200, JSON.stringify(suppConfirm.data));

  // Create production receipt (insert directly to bypass production quality gate,
  // since the seed product has an inspection_plan that would otherwise require
  // a Product Inspection completion before receipt confirm).
  const now2 = new Date().toISOString();
  db.prepare(`INSERT INTO production_receipts(id,receipt_no,production_order_id,product_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at,quality_state) VALUES(?,?,?,?,?,?, 'CONFIRMED', ?, ?, 'user-admin', ?, ?, 'user-admin', ?, 'PASS')`).run('mq-fa-receipt-001', 'PR-FA-LONG-2026-001', orderIdCreated, productId, warehouseId, 3, '2026-10-15', '最终验收入库', now2, now2, now2);

  return {
    orderId: orderIdCreated, orderNo: r1.data.orderNo, order2Id: order2IdCreated, productId, componentId, warehouseId,
  };
}

let baseUrl;
let adminToken;

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(login.status, 200, 'admin login must succeed');
  adminToken = (await login.json()).token;
  const seeded = await seed(adminToken);
  console.log(`Seeded order=${seeded.orderId}`);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    for (const surface of surfaces) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), adminToken);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${baseUrl}/#${surface}`, { waitUntil: 'networkidle' });
      try {
        await page.getByTestId(`mobile-application-view-${surface}`).waitFor({ timeout: 8000 });
      } catch (e) {
        await page.screenshot({ path: join(outputDir, `${surface}-${width}.png`), fullPage: true });
        await context.close();
        recordResult(surface, width, false, `view not found: ${e.message}`);
        continue;
      }
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const longCodes = ['MO-FA-LONG-2026-001', 'MQ-FA-LONG-CODE-PART-001', 'MQ-FA-LONG-CODE-COMP-001', 'PMI-FA-LONG-2026-001', 'PR-FA-LONG-2026-001'];
        const longCodeHits = longCodes.map((c) => {
          const found = Array.from(document.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent && el.textContent.includes(c));
          if (!found) return { code: c, found: false };
          const rect = found.getBoundingClientRect();
          return { code: c, found: rect.width > 0 && rect.height > 0 };
        });
        const buttons = Array.from(document.querySelectorAll('button')).map((b) => {
          const r = b.getBoundingClientRect();
          return { text: (b.textContent || '').trim().slice(0, 20), x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
        });
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyText: (document.body.innerText || '').trim(),
          longCodeHits,
          primaryActions: buttons.filter((b) => b.text && b.text.length > 0 && b.visible).slice(0, 5),
        };
      });
      const ok = metrics.bodyText.length > 0
        && metrics.scrollWidth <= metrics.clientWidth + 1
        && errors.length === 0;
      const detail = ok
        ? `ok text=${metrics.bodyText.length} scrollW=${metrics.scrollWidth} clientW=${metrics.clientWidth} codes=${JSON.stringify(metrics.longCodeHits)} actions=${JSON.stringify(metrics.primaryActions)}`
        : `text=${metrics.bodyText.length} scrollW=${metrics.scrollWidth} clientW=${metrics.clientWidth} errors=${JSON.stringify(errors)}`;
      recordResult(surface, width, ok, detail);
      await page.screenshot({ path: join(outputDir, `${surface}-${width}.png`), fullPage: true });
      await context.close();
    }
  }

  // Detail surface — production-orders with a real order id.
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
    await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), adminToken);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${baseUrl}/#production-orders?documentId=${seeded.orderId}`, { waitUntil: 'networkidle' });
    try {
      await page.getByTestId('mobile-application-view-production-orders').waitFor({ timeout: 8000 });
    } catch (e) {
      recordResult('production-orders-detail', width, false, `view not found: ${e.message}`);
      await context.close();
      continue;
    }
    await page.waitForTimeout(800);
    const metrics = await page.evaluate((orderNo) => {
      const text = (document.body.innerText || '').trim();
      const hasOperation = text.includes('最终验收工序一') || text.includes('OP-10') || text.includes('OP-20');
      const hasMaterial = text.includes('MQ-FA-LONG-CODE-COMP-001') || text.includes('最终验收组件');
      const hasReceipt = text.includes('PR-FA-LONG-2026-001') || text.includes('最终验收入库');
      const hasLongOrder = orderNo && text.includes(orderNo);
      const hasAction = !!Array.from(document.querySelectorAll('button')).find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && b.textContent && b.textContent.trim().length > 0;
      });
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        text: text.length,
        hasMaterial, hasOperation, hasReceipt, hasLongOrder, hasAction,
      };
    }, seeded.orderNo);
    const ok = metrics.text > 0
      && metrics.scrollWidth <= metrics.clientWidth + 1
      && errors.length === 0
      && (metrics.hasMaterial || metrics.hasOperation || metrics.hasReceipt)
      && metrics.hasLongOrder
      && metrics.hasAction;
    recordResult('production-orders-detail', width, ok, JSON.stringify(metrics) + ' errors=' + JSON.stringify(errors));
    await page.screenshot({ path: join(outputDir, `production-orders-detail-${width}.png`), fullPage: true });
    await context.close();
  }

  console.log(`V18 MANUFACTURING & QUALITY FINAL ACCEPTANCE = ${failures.length === 0 ? 'PASS' : 'FAIL'} (${pass} pass / ${failures.length} fail)`);
  if (failures.length > 0) {
    for (const f of failures) console.log(' - ' + JSON.stringify(f));
    process.exit(1);
  }
} finally {
  await browser?.close().catch(() => {});
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}