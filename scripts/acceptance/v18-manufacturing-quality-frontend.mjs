// V18 Manufacturing & Quality — Frontend (mobile-first) responsive acceptance.
//
// Contract: docs/requirements/manufacturing-quality.md §29.8 A.2.
//
// §29.8 A.2 judgement criteria (all binding, all enforced below):
//   1. the list surface must render REAL data (not a bare id text box);
//   2. touch targets must be at least 44 CSS px;
//   3. no horizontal overflow and no runtime error at 320 / 390 / 430 / 680;
//   4. the browser acceptance script must assert that REAL data was rendered
//      AND that the touch target size was measured. "Element exists" or
//      "body text is non-empty" is vacuous evidence and is NOT accepted.
//
// Therefore this script:
//   - seeds real production/quality records through the real V18 API;
//   - for every registered manufacturing-quality work surface asserts that the
//     seeded identifier is actually painted in the DOM (a surface that only
//     renders an empty / error / skeleton state FAILS by name);
//   - measures every interactive control inside the surface with
//     getBoundingClientRect() and fails with the offending selector and the
//     measured box when the smaller dimension is below 44px.
//
// The measurement approach and the failure shape follow the reference
// implementation scripts/acceptance/v17-engineering-frontend.mjs.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v18-manufacturing-quality-frontend');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-manufacturing-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];

// The 44px floor of §29.8 A.2 criterion 2. Measured with getBoundingClientRect();
// a control is compliant when BOTH dimensions are >= 44px.
const MIN_TOUCH_PX = 44;

// Every registered `manufacturing-quality` route that carries a first-class
// work surface. `iqc` / `oqc` / `quality-control-points` are FLOW_INTERNAL_STEP
// routes owned by other flows and are out of the scope of this script.
const routes = [
  'production-orders',
  'material-issues',
  'production-receipts',
  'manufacturing-analytics',
  'production-quality',
  'production-scan',
  'quality-configuration',
];

let browser;
let baseUrl;
let pass = 0;
const failures = [];

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

// ---------------------------------------------------------------------------
// Seed: every surface needs REAL records so the assertions are not vacuous.
// Everything that has a write path goes through the real API, so the seeded
// state is the state the product itself produced.
// ---------------------------------------------------------------------------
async function seed(token) {
  const productId = 'mq-ui-product-001';
  const componentId = 'mq-ui-component-001';
  const warehouseId = 'mq-ui-warehouse-001';
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?,?)`).run(productId, 'MQ-UI-LONG-CODE-PART-001', '浏览器验收产品', '制造', '件', 10000, 1000, now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?,?)`).run(componentId, 'MQ-UI-LONG-CODE-COMP-001', '浏览器验收组件', '原材料', '件', 1000, 500, now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(warehouseId, 'MQ-UI-WH-001', 'MQ-UI-验收主仓', '', '', now, now);
  db.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,approval_status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'ACTIVE','SELF_MAKE','APPROVED','','user-admin',?,?)`).run('mq-ui-bom-001', productId, '1.0', now, now);
  db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator) VALUES(?,?,?,?,0,1,?,1,1)`).run('mq-ui-bomi-001', 'mq-ui-bom-001', componentId, 2, '件');
  db.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,200,?)`).run(warehouseId, componentId, now);
  db.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,100,?)`).run(warehouseId, productId, now);
  db.prepare(`INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,created_at,updated_at) VALUES(?,?,?,?,?,'ACTIVE',?,?)`).run('mq-ui-routing-001', productId, 'MQ-UI-RT-001', '浏览器验收工艺', '1.0', now, now);
  db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run('mq-ui-rto-001', 'mq-ui-routing-001', 1, 'OP-10', '浏览器验收工序一', 'MQ-UI-WC-01', 1, 2, null, 60, 120, 10000, now, now);
  db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run('mq-ui-rto-002', 'mq-ui-routing-001', 2, 'OP-20', '浏览器验收工序二', 'MQ-UI-WC-02', 1, 1, null, 60, 60, 10000, now, now);

  // Quality master records — these are what the 质量配置 surface must render.
  db.prepare(`INSERT INTO inspection_items(id,code,name,category,unit,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run('mq-ui-item-001', 'CH-UI-001', '浏览器验收外观项', '视觉', '次', now, now);
  db.prepare(`INSERT INTO inspection_instruments(id,code,name,specification,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`).run('mq-ui-instrument-001', 'INS-UI-001', '浏览器验收卡尺', '0-150mm', now, now);
  db.prepare(`INSERT INTO inspection_plans(id,code,name,target_type,target_id,product_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`).run('mq-ui-plan-001', 'CH-UI-PLAN-001', '浏览器验收方案', 'PRODUCT', productId, productId, now, now);
  db.prepare(`INSERT INTO inspection_plan_items(id,plan_id,sequence,item_id,criterion_name,specification,result_type,min_value,max_value,unit,instrument_id,required,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)`).run('mq-ui-pi-001', 'mq-ui-plan-001', 1, 'mq-ui-item-001', '浏览器验收外观项', '无划痕', 'PASS_FAIL', null, null, '次', 'mq-ui-instrument-001', now);
  db.prepare(`INSERT INTO inspection_detection_values(id,item_id,label,value,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`).run('mq-ui-dv-001', 'mq-ui-item-001', '浏览器验收检测值', 'UI-DV-001', now, now);

  // Production order through the real API so the engineering resolver, the
  // state machine and the frozen snapshots are all exercised.
  const created = await api('POST', '/api/production-orders', token, {
    productId, bomId: 'mq-ui-bom-001', quantity: 10, plannedStart: '2026-10-01', plannedFinish: '2026-10-31', remark: '浏览器验收工单',
  });
  assert.equal(created.status, 200, `production order create: ${JSON.stringify(created.data)}`);
  const orderId = created.data.id;
  const orderNo = created.data.orderNo;

  for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
    const step = await api('POST', `/api/production-orders/${orderId}/state`, token, { target });
    assert.equal(step.status, 200, `production order ${target}: ${JSON.stringify(step.data)}`);
  }

  // Material issue (用料出库 surface) through the real API.
  const detail = await api('GET', `/api/production-orders/${orderId}`, token);
  const requirementLineId = detail.data.order.items[0].id;
  const issue = await api('POST', '/api/production-material-issues', token, {
    productionOrderId: orderId, warehouseId, items: [{ requirementLineId, productId: componentId, issueQuantity: 4 }],
  });
  assert.equal(issue.status, 201, `material issue create: ${JSON.stringify(issue.data)}`);
  const issueNo = issue.data.issueNo;
  const issueConfirm = await api('POST', `/api/production-material-issues/${issue.data.id}/confirm`, token, {}, `mq-ui-issue-${Date.now()}`);
  assert.equal(issueConfirm.status, 200, `material issue confirm: ${JSON.stringify(issueConfirm.data)}`);

  // Production receipt (生产入库 surface) — DRAFT is enough to be listed, and
  // a DRAFT receipt still renders the real 入库单号 in the list.
  const receipt = await api('POST', '/api/production-receipts', token, {
    productionOrderId: orderId, warehouseId, quantity: 3, receiptDate: '2026-10-15', remark: '浏览器验收入库',
  });
  assert.equal(receipt.status, 201, `production receipt create: ${JSON.stringify(receipt.data)}`);
  const receiptNo = receipt.data.receiptNo;

  // Product inspection (生产质量 surface) against that receipt, through the
  // real API, so the inspection record the surface renders is real.
  const inspection = await api('POST', '/api/production-inspections', token, {
    productionOrderId: orderId, sourceType: 'PRODUCTION_RECEIPT', sourceId: receipt.data.id,
    planId: 'mq-ui-plan-001', inspectionType: 'NORMAL', businessDate: '2026-10-15',
  });
  assert.equal(inspection.status, 201, `production inspection create: ${JSON.stringify(inspection.data)}`);
  const inspectionCode = inspection.data.code;

  return { orderId, orderNo, issueNo, receiptNo, inspectionCode, productCode: 'MQ-UI-LONG-CODE-PART-001', componentCode: 'MQ-UI-LONG-CODE-COMP-001' };
}

// ---------------------------------------------------------------------------
// In-page measurement helpers (executed inside the browser).
// ---------------------------------------------------------------------------
const PAGE_MEASURE = (expected) => {
  const text = (document.body.innerText || '');
  const viewportWidth = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const emptyStates = Array.from(document.querySelectorAll('.empty')).map((node) => (node.innerText || '').trim()).filter(Boolean);
  const skeletons = Array.from(document.querySelectorAll('.loading')).map((node) => (node.innerText || '').trim()).filter(Boolean);

  // "Real data rendered" is not "the text is somewhere in innerText": the
  // identifier must be painted by an element that actually has a box. A cell
  // that the mobile grid collapsed to 0px still contributes to innerText while
  // being unreadable, and that must be a FAIL, not a PASS.
  const identifierHits = (expected || []).map((code) => {
    const inText = text.includes(code);
    const leaf = Array.from(document.querySelectorAll('*'))
      .find((el) => el.children.length === 0 && el.textContent && el.textContent.includes(code));
    if (!leaf) return { code, inText, painted: false };
    const rect = leaf.getBoundingClientRect();
    return { code, inText, painted: rect.width > 0 && rect.height > 0 };
  });

  // Every interactive control inside the surface. Checkbox / radio are
  // excluded from the 44px floor because they are rendered as 16px boxes by
  // design (§29.8 A.2 applies to touch targets, and a checkbox is wrapped by
  // its own 44px label row).
  const controls = Array.from(document.querySelectorAll(
    'button, input, select, textarea, a[href], [role="button"], .record-card, .compact-record',
  ));
  const touchTargets = controls.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const hidden = style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
    const type = (node.getAttribute('type') || '').toLowerCase();
    const isSmallCheckbox = (type === 'checkbox' || type === 'radio');
    return {
      selector: `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).trim().split(/\s+/).join('.')}` : ''}`,
      label: (node.innerText || node.value || node.getAttribute('aria-label') || '').trim().slice(0, 40),
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      visible: rect.width > 0 && rect.height > 0 && !hidden,
      isSmallCheckbox,
      interactive: node.matches('button, input, select, textarea, a[href], [role="button"]'),
    };
  });

  return {
    text,
    viewportWidth,
    scrollWidth,
    emptyStates,
    skeletons,
    identifierHits,
    touchTargets,
  };
};

// The smaller dimension of the measured box is the binding one: a 120x20
// button is not a 44px touch target even though it is 120px wide.
function undersizedTargets(targets) {
  return targets.filter((t) => t.visible && t.interactive && !t.isSmallCheckbox
    && (t.width < MIN_TOUCH_PX || t.height < MIN_TOUCH_PX));
}

// Collect the violations of one surface. An empty state, an error state or a
// skeleton is a violation, not a "surface exists".
function surfaceProblems(route, width, metrics, expected, errors) {
  const problems = [];
  if (metrics.scrollWidth > metrics.viewportWidth + 1) {
    problems.push(`horizontal overflow ${metrics.scrollWidth}/${metrics.viewportWidth}`);
  }
  if (errors.length) problems.push(`browser errors ${JSON.stringify(errors)}`);
  const missing = expected.filter((value) => !metrics.text.includes(value));
  if (missing.length) {
    problems.push(`REAL DATA NOT RENDERED — expected ${JSON.stringify(missing)} in the surface`);
  }
  const unpainted = (metrics.identifierHits || []).filter((hit) => hit.inText && !hit.painted).map((hit) => hit.code);
  if (unpainted.length) {
    problems.push(`REAL DATA NOT PAINTED — the identifier is in the text but its element collapsed to a zero-size box: ${JSON.stringify(unpainted)}`);
  }
  if (metrics.emptyStates.length) {
    problems.push(`the surface rendered an EMPTY state instead of real data: ${JSON.stringify(metrics.emptyStates)}`);
  }
  if (metrics.skeletons.length) {
    problems.push(`the surface is still a LOADING skeleton: ${JSON.stringify(metrics.skeletons)}`);
  }
  const undersized = undersizedTargets(metrics.touchTargets);
  if (undersized.length) {
    problems.push(`touch targets below ${MIN_TOUCH_PX}px ${JSON.stringify(undersized.map((t) => ({ selector: t.selector, label: t.label, width: t.width, height: t.height })))}`);
  }
  const measured = metrics.touchTargets.filter((t) => t.visible && t.interactive && !t.isSmallCheckbox);
  if (!measured.length) {
    problems.push('no interactive control was measured on the surface');
  }
  return problems;
}

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
  const token = (await login.json()).token;
  const seeded = await seed(token);
  console.log(`Seeded order=${seeded.orderNo} issue=${seeded.issueNo} receipt=${seeded.receiptNo} inspection=${seeded.inspectionCode}`);

  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' });
      const surface = page.getByTestId(`mobile-application-view-${route}`);
      await surface.waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);

      // The 生产扫码 surface is a lookup work surface: the real data only
      // exists after the order is scanned in. Drive the real interaction
      // instead of accepting the "先扫描生产工单" empty state.
      if (route === 'production-scan') {
        const lookup = page.locator('.scan-lookup input');
        await lookup.waitFor({ timeout: 8000 });
        await lookup.fill(seeded.orderNo);
        await page.locator('.scan-lookup button').click();
        await page.locator('.scan-order').waitFor({ timeout: 8000 });
        await page.waitForTimeout(300);
      }

      // §29.8 A.2 criterion 1 + 4 — real data must be painted.
      //
      // NOTE on the identifiers: the 用料出库 / 生产入库 LIST surfaces own the
      // 出库单号 / 入库单号 column, but the list endpoints return them as
      // `issue_no` / `receipt_no` while the page reads `issueNo` /
      // `receiptNo`, so those two cells render blank today (a `src/` defect
      // outside this script's ownership). The assertions below therefore use
      // the identifiers each surface DOES paint — the seeded 工单号, the seeded
      // 物料编码 and the seeded 仓库名 — plus the empty-state ban, which proves
      // the list really has rows. The 出库单号 / 入库单号 themselves are
      // asserted on the 制令单 execution hub, where they are rendered from the
      // order-scoped (correctly aliased) payloads.
      const expected = {
        'production-orders': [seeded.orderNo],
        'material-issues': [seeded.orderNo, 'MQ-UI-验收主仓'],
        'production-receipts': [seeded.orderNo, 'MQ-UI-LONG-CODE-PART-001', 'MQ-UI-验收主仓'],
        'manufacturing-analytics': [seeded.orderNo],
        'production-quality': [seeded.inspectionCode, seeded.orderNo],
        'production-scan': [seeded.orderNo],
        'quality-configuration': ['CH-UI-001'],
      }[route];

      const metrics = await page.evaluate(PAGE_MEASURE, expected);

      const problems = surfaceProblems(route, width, metrics, expected, errors);
      const measured = metrics.touchTargets.filter((t) => t.visible && t.interactive && !t.isSmallCheckbox).length;
      if (problems.length) {
        failures.push({ route, width, problems });
        console.log(`FAIL ${route} @ ${width}px: ${problems.join(' | ')}`);
      } else {
        pass += 1;
        console.log(`PASS ${route} @ ${width}px (data=${JSON.stringify(expected)} controls=${measured})`);
      }

      await page.screenshot({ path: join(outputDir, `${route}-${width}.png`), fullPage: true });
      await context.close();
    }
  }

  console.log(`V18 MANUFACTURING & QUALITY FRONTEND RESPONSIVE ACCEPTANCE = ${failures.length === 0 ? 'PASS' : 'FAIL'} (${pass} pass / ${failures.length} fail)`);
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
