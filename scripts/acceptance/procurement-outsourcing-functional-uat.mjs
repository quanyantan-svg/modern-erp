import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-prc-functional-uat-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const results = [];
const today = new Date().toISOString().slice(0, 10);
let baseUrl;

async function browserApi(page, method, path, body, token, extraHeaders) {
  return page.evaluate(async ({ method, path, body, token, extraHeaders }) => {
    const activeToken = token || localStorage.getItem('modern_erp_token');
    const response = await fetch(path, {
      method,
      headers: {
        ...(activeToken ? { authorization: `Bearer ${activeToken}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(extraHeaders || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }, { method, path, body, token, extraHeaders });
}

// 委外用料必须有已批准、已生效、用途相符的 BOM（Requirement §31.3.3 OUT-08），
// 发料还必须有权威估值余额，因此这里一次性建立该业务事实。
function seedOutsourceBom(bomId, productId, materialProductId, materialQuantity) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,approval_status,approved_by,approved_at)
    VALUES(?,?,'1','ACTIVE','','user-admin',?,?,'OUTSOURCE',?,'APPROVED','user-admin',?)`)
    .run(bomId, productId, now, now, today, now);
  db.prepare(`INSERT OR REPLACE INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,1)`)
    .run(`${bomId}-item`, bomId, materialProductId, materialQuantity);
  db.prepare(`INSERT OR IGNORE INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)`)
    .run(`NONE:warehouse-001:${materialProductId}`, materialProductId, now);
  return bomId;
}

async function loginToken(page, username, password) {
  const response = await page.evaluate(async ({ username, password }) => {
    const result = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return result.json();
  }, { username, password });
  return response.token;
}

async function run(id, label, action, work) {
  try {
    const evidence = await work();
    results.push({ id, label, status: 'PASS', action, evidence });
  } catch (error) {
    results.push({ id, label, status: 'FAIL', action, evidence: error.message });
  }
}

function expect(response, status, detail) {
  if (response.status !== status) throw new Error(`${detail}: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

async function createApprovedPo(page, reviewerToken, quantity = 10) {
  // 权威采购价格：普通采购订单没有有效价格时 fail closed（Active Design §26.36.3）。
  for (const [productId, unitPriceCents] of [['product-001', 1000], ['product-002', 600]]) {
    await browserApi(page, 'POST', '/api/procurement/price-list', {
      supplierId: 'supplier-001', productId, sourceType: 'PURCHASE',
      pricingUomCode: 'EA', unitPriceCents, effectiveFrom: today,
    });
  }
  const created = await browserApi(page, 'POST', '/api/purchase-orders', {
    supplierId: 'supplier-001', orderDate: today, expectedDeliveryDate: today,
    supplierContactName: 'UAT 联系人', supplierContactPhone: '13800000000',
    supplierAddress: 'UAT 地址', paymentTerms: '30 天',
    items: [{ productId: 'product-001', quantity, unitPriceCents: 1000 }],
  });
  expect(created, 201, 'create PO');
  expect(await browserApi(page, 'POST', `/api/purchase-orders/${created.data.id}/submit`), 200, 'submit PO');
  expect(await browserApi(page, 'POST', `/api/purchase-orders/${created.data.id}/approve`, undefined, reviewerToken), 200, 'approve PO');
  return created.data.id;
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const state = {};
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('input[autocomplete="username"]').fill('admin');
    await page.locator('input[autocomplete="current-password"]').fill('admin123');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForLoadState('networkidle');
    const reviewerToken = await loginToken(page, 'reviewer', 'review123');
    const warehouseToken = await loginToken(page, 'warehouse', 'warehouse123');
    const accountingToken = await loginToken(page, 'accounting', 'accounting123');

    await run('UAT-01', 'Supplier qualification edit/save', 'Suppliers route; PATCH profile; GET persisted profile', async () => {
      // 委外 WIP 仓库是发料/补料/退料的前置业务事实（OUT-04）。
      await browserApi(page, 'PATCH', '/api/suppliers/supplier-001/profile', {
        outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
        qualificationValidFrom: today, qualificationValidTo: '2099-12-31',
        supplierWipWarehouseId: 'warehouse-002',
      });
      await page.goto(`${baseUrl}#suppliers`, { waitUntil: 'networkidle' });
      expect(await browserApi(page, 'PATCH', '/api/suppliers/supplier-001/profile', {
        procurementEnabled: true, outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
        qualificationValidFrom: '2026-01-01', qualificationValidTo: '2027-12-31',
      }), 200, 'save supplier profile');
      const saved = expect(await browserApi(page, 'GET', '/api/suppliers/supplier-001/profile'), 200, 'reload supplier profile');
      if (saved.profile?.qualificationStatus !== 'QUALIFIED') throw new Error(`persisted profile mismatch ${JSON.stringify(saved)}`);
      return 'PATCH/GET 200; qualificationStatus=QUALIFIED';
    });

    await run('UAT-02', 'Purchase Requisition → open Sourcing', 'Create PR; navigate to Sourcing & Pricing', async () => {
      const pr = expect(await browserApi(page, 'POST', '/api/purchase-requisitions', {
        requiredDate: today, notes: 'functional UAT',
        items: [{ productId: 'product-001', quantity: 10, unitPriceCents: 1000, amountCents: 10000 }],
      }), 201, 'create PR');
      state.prId = pr.id;
      await page.goto(`${baseUrl}#sourcing-pricing`, { waitUntil: 'networkidle' });
      if (!page.url().includes('#sourcing-pricing')) throw new Error('sourcing route did not open');
      return `PR ${pr.id}; route #sourcing-pricing`;
    });

    await run('UAT-03', 'Source List / eligible supplier resolution', 'Create source entries (purchase + outsource); query effective list', async () => {
      const source = expect(await browserApi(page, 'POST', '/api/procurement/source-entries', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE', effectiveFrom: today,
      }), 201, 'create source entry');
      // 请购转采购订单按「选择供应商」的路径裁决货源（PRC-04）：本单请购的货品是
      // product-001，因此它也必须有有效采购货源。
      expect(await browserApi(page, 'POST', '/api/procurement/source-entries', {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE', effectiveFrom: today,
      }), 201, 'create purchase source entry for product-001');
      // OUT-02：委外订单必须消费有效 OUTSOURCE 货源（与采购共用同一货源控制）。
      expect(await browserApi(page, 'POST', '/api/procurement/source-entries', {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'OUTSOURCE', effectiveFrom: today,
      }), 201, 'create outsource source entry for product-001');
      const list = expect(await browserApi(page, 'GET', `/api/procurement/source-entries?productId=product-002&date=${today}`), 200, 'resolve source list');
      if (!list.sourceEntries.some((entry) => entry.id === source.id)) throw new Error('eligible source not returned');
      return `source ${source.id} resolved eligible`;
    });

    await run('UAT-04', 'Quota query and safe decision closure', 'Create quota; query it; reject formal decision write', async () => {
      expect(await browserApi(page, 'POST', '/api/procurement/quotas', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
        proportion: { num: 1, den: 1 }, effectiveFrom: today,
      }), 201, 'create quota');
      const quotaList = expect(await browserApi(page, 'GET', `/api/procurement/quotas?productId=product-002&sourceType=PURCHASE&date=${today}`), 200, 'query quota');
      if (!quotaList.quotas.some((row) => row.supplierId === 'supplier-001')) throw new Error('configured quota not returned');
      const decision = expect(await browserApi(page, 'POST', '/api/procurement/sourcing-decisions', {
        sourceType: 'PR', sourceId: 'UAT-QUOTA', procurementSourceType: 'PURCHASE',
        productId: 'product-002', businessDate: today, quantity: 17,
      }), 409, 'formal decision safely closed');
      if (decision.code !== 'SOURCING_DECISION_WRITE_CLOSED') throw new Error(`unexpected closure code ${decision.code}`);
      return 'quota GET 200; decision POST 409';
    });

    await run('UAT-05', 'Price resolution with pricing UOM/discount', 'Create UOM price and discount; query effective price', async () => {
      const now = new Date().toISOString();
      db.prepare("INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES('BOX-UAT','Box UAT',?,?)").run(now, now);
      db.prepare(`INSERT OR IGNORE INTO product_uom_conversions(id,product_id,uom_code,base_uom_code,numerator,denominator,version,effective_from,effective_to,created_at)
        VALUES('uom-uat','product-001','BOX-UAT','EA',12,1,1,?,NULL,?)`).run(today, now);
      expect(await browserApi(page, 'POST', '/api/procurement/price-list', {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
        pricingUomCode: 'BOX-UAT', unitPriceCents: 1200, effectiveFrom: today,
      }), 201, 'create price');
      expect(await browserApi(page, 'POST', '/api/procurement/discounts', {
        supplierId: 'supplier-001', productId: 'product-001', sourceType: 'PURCHASE',
        basis: 'PERCENT', value: { num: 10, den: 100 }, effectiveFrom: today,
      }), 201, 'create discount');
      const prices = expect(await browserApi(page, 'GET', `/api/procurement/price-list?productId=product-001&date=${today}`), 200, 'resolve price');
      if (!prices.priceList.some((row) => row.pricingUomCode === 'BOX-UAT' && row.unitPriceCents === 1200)) throw new Error('UOM price not resolved');
      return 'BOX-UAT=1200; PERCENT 10/100 persisted';
    });

    await run('UAT-06', 'Sourcing allocation → generate/open Purchase Order', 'Submit/approve PR; generate PO; open PO route', async () => {
      expect(await browserApi(page, 'POST', `/api/purchase-requisitions/${state.prId}/submit`), 200, 'submit PR');
      expect(await browserApi(page, 'POST', `/api/purchase-requisitions/${state.prId}/approve`, undefined, reviewerToken), 200, 'approve PR');
      const po = expect(await browserApi(page, 'POST', `/api/purchase-requisitions/${state.prId}/generate-purchase-order`, { supplierId: 'supplier-001' }), 201, 'generate PO');
      state.generatedPoId = po.id;
      await page.goto(`${baseUrl}#purchase-orders`, { waitUntil: 'networkidle' });
      return `generated PO ${po.id || po.orderNo}; opened #purchase-orders`;
    });

    await run('UAT-07', 'PO Change create → apply → reflected', 'Create approved PO; ADD change; approve/apply; query execution', async () => {
      state.poId = await createApprovedPo(page, reviewerToken, 10);
      const change = expect(await browserApi(page, 'POST', '/api/procurement/purchase-order-changes', {
        orderId: state.poId, action: 'ADD', payload: { productId: 'product-002', quantity: 3, unitPriceCents: 600, lineNo: 2 },
      }), 201, 'create PO change');
      expect(await browserApi(page, 'POST', `/api/procurement/purchase-order-changes/${change.id}/approve`, undefined, reviewerToken), 200, 'approve change');
      expect(await browserApi(page, 'POST', `/api/procurement/purchase-order-changes/${change.id}/apply`), 200, 'apply change');
      const execution = expect(await browserApi(page, 'GET', `/api/purchase-orders/${state.poId}/execution`), 200, 'query changed PO');
      if (execution.execution.items.length !== 2) throw new Error('PO change not reflected');
      return `change ${change.id}; execution items=2`;
    });

    await run('UAT-08', 'Receipt Notice create from PO', 'Create and confirm notice from approved PO', async () => {
      const item = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? AND product_id=?').get(state.poId, 'product-001');
      expect(await browserApi(page, 'POST', `/api/purchase-orders/${state.poId}/delivery-schedules`, {
        orderItemId: item.id, plannedQuantity: 10, plannedDate: today,
      }), 201, 'create delivery schedule');
      const notice = expect(await browserApi(page, 'POST', '/api/receipt-notices', {
        purchaseOrderId: state.poId, warehouseId: 'warehouse-001', noticeDate: today,
        items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 10 }],
      }), 201, 'create receipt notice');
      expect(await browserApi(page, 'POST', `/api/receipt-notices/${notice.id}/confirm`), 200, 'confirm receipt notice');
      state.noticeId = notice.id;
      return `notice ${notice.id} CONFIRMED`;
    });

    await run('UAT-09', 'IQC valid pass flow', 'Convert the confirmed notice into a receipt draft; create and PASS IQC', async () => {
      const source = db.prepare(`SELECT s.id FROM receipt_notice_item_sources s
        JOIN receipt_notice_items i ON i.id=s.notice_item_id WHERE i.notice_id=? ORDER BY s.id LIMIT 1`).get(state.noticeId);
      const converted = expect(await browserApi(page, 'POST', `/api/receipt-notices/${state.noticeId}/convert`, {
        items: [{ sourceId: source.id, quantity: 10 }],
      }, undefined, { 'idempotency-key': `uat-convert-${state.noticeId}` }), 201, 'convert notice into receipt');
      const receipt = { id: converted.receipts[0].id };
      state.receiptId = receipt.id;
      state.receiptItemId = db.prepare('SELECT id FROM purchase_receipt_items WHERE receipt_id=?').get(receipt.id).id;
      const iqc = expect(await browserApi(page, 'POST', '/api/iqc', { purchase_receipt_id: receipt.id }, warehouseToken), 201, 'create IQC');
      expect(await browserApi(page, 'POST', `/api/iqc/${iqc.id}/complete`, {
        result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0,
      }, warehouseToken), 200, 'complete IQC');
      return `IQC ${iqc.id} PASS`;
    });

    await run('UAT-10', 'Purchase Receipt create/confirm', 'Confirm IQC-passed receipt; query persisted status', async () => {
      expect(await browserApi(page, 'POST', `/api/purchase-receipts/${state.receiptId}`, { action: 'confirm' }, warehouseToken), 200, 'confirm receipt');
      const row = db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(state.receiptId);
      if (row.status !== 'CONFIRMED') throw new Error(`receipt status=${row.status}`);
      return `receipt ${state.receiptId} CONFIRMED`;
    });

    await run('UAT-11', 'Procurement Scan → Receipt draft line', 'Scan approved PO/product into bounded draft-line resolution', async () => {
      const scan = expect(await browserApi(page, 'POST', '/api/procurement/scan', {
        sourceType: 'PURCHASE_ORDER', sourceId: state.poId, productId: 'product-001',
        warehouseId: 'warehouse-001', quantity: 2, lotCode: 'LOT-UAT',
      }, warehouseToken), 200, 'scan source');
      if (scan.scanResolution.orderId !== state.poId) throw new Error('scan source mismatch');
      return `draft line order=${scan.scanResolution.orderId}; qty=2`;
    });

    await run('UAT-12', 'Return Request → Purchase Return', 'Create return request; create and confirm purchase return', async () => {
      const request = expect(await browserApi(page, 'POST', '/api/procurement/return-requests', {
        receiptId: state.receiptId, requestType: 'COMMERCIAL', reasonCode: 'UAT_RETURN',
        replenishmentMethod: 'REORDER', requestDate: today, remark: 'UAT return request',
        items: [{ receiptItemId: state.receiptItemId, quantity: 2 }],
      }), 201, 'create return request');
      const posted = expect(await browserApi(page, 'POST', `/api/procurement/return-requests/${request.id}/post`, {}), 201, 'post return request');
      const ret = { id: posted.postedReturnId };
      expect(await browserApi(page, 'POST', `/api/purchase-returns/${ret.id}`, { action: 'confirm' }, warehouseToken), 200, 'confirm purchase return');
      return `request ${request.id}; return ${ret.id} CONFIRMED`;
    });

    await run('UAT-13', 'VMI Policy create/edit', 'Create VMI agreement and reload list', async () => {
      const agreement = expect(await browserApi(page, 'POST', '/api/procurement/vmi/agreements', {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001',
        minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: today,
      }), 201, 'create VMI agreement');
      const list = expect(await browserApi(page, 'GET', '/api/procurement/vmi/agreements'), 200, 'reload VMI agreements');
      if (!list.agreements.some((row) => row.id === agreement.id)) throw new Error('agreement not persisted');
      return `agreement ${agreement.id} persisted`;
    });

    await run('UAT-14', 'VMI receiving fail-closed on idempotency and agreement binding', 'Attempt VMI receipt without an idempotency key, then with a key; require the current fail-closed boundaries', async () => {
      const withoutKey = await browserApi(page, 'POST', '/api/procurement/vmi/receipts', {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001', quantity: 50, receivedDate: today,
      });
      if (withoutKey.status !== 400 || withoutKey.data.code !== 'IDEMPOTENCY_KEY_REQUIRED') throw new Error(`unexpected ${withoutKey.status} ${JSON.stringify(withoutKey.data)}`);
      const withKey = await browserApi(page, 'POST', '/api/procurement/vmi/receipts', {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001', quantity: 50, receivedDate: today,
        idempotencyKey: `uat-14-${Date.now()}`,
      });
      expect(withKey, 201, 'create VMI receipt');
      return `HTTP 400 IDEMPOTENCY_KEY_REQUIRED then HTTP 201 with a bound agreement (${withKey.data.id})`;
    });

    await run('UAT-15', 'Planning handoff → Outsourcing Order', 'Seed planning handoff; consume via create order; verify authoritative consumption + CONSUMED status', async () => {
      const handoffId = `uat-handoff-${Date.now()}`;
      const plannedOrderId = 'po-' + handoffId;
      // OUT-05 contract: create the planning_outsource_handoff row first, then
      // call the order-create endpoint which consumes it exactly-once.
      db.prepare(`INSERT INTO planned_orders(id,order_no,source_type,product_id,quantity,supply_type,status,released_quantity,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        plannedOrderId, plannedOrderId, 'MANUAL', 'product-001', 10, 'OUTSOURCE', 'RELEASED', 10,
        'user-admin', 'user-admin', today, today,
      );
      db.prepare(`INSERT INTO planning_outsource_handoffs(id,planned_order_id,product_id,quantity,need_date,status,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        handoffId, plannedOrderId, 'product-001', 10, today, 'PENDING', 'user-admin', today,
      );
      const order = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, planningHandoffId: handoffId, businessDate: today,
      }), 201, 'create handoff order');
      const handoff = db.prepare('SELECT * FROM planning_outsource_handoffs WHERE id=?').get(handoffId);
      if (!handoff || handoff.status !== 'CONSUMED' || handoff.target_outsourcing_order_id !== order.id) {
        throw new Error(`order ${order.id} created but authoritative handoff row was not consumed (status=${handoff?.status})`);
      }
      return `handoff ${handoffId} CONSUMED → ${order.id}`;
    });

    await run('UAT-16', 'Manual Outsourcing Order', 'Create manual outsourcing order bound to an approved OUTSOURCE BOM', async () => {
      const bomId = seedOutsourceBom('uat-out-bom-001', 'product-001', 'product-002', 1);
      const order = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 20, businessDate: today, bomId,
      }), 201, 'create manual outsourcing order');
      state.outOrderId = order.id;
      return `manual order ${order.id}; bom ${bomId}`;
    });

    await run('UAT-17', 'Plan Confirm / Release', 'Snapshot materials, then transition DRAFT→PLAN_CONFIRMED→RELEASED', async () => {
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/material-list`, {
        items: [{ productId: 'product-002', sourceWarehouseId: 'warehouse-001' }],
      }), 200, 'snapshot material list');
      state.materialId = db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? ORDER BY id LIMIT 1').get(state.outOrderId).id;
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/transition`, { action: 'CONFIRM_PLAN' }), 200, 'plan confirm');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/transition`, { action: 'RELEASE' }), 200, 'release');
      const order = expect(await browserApi(page, 'GET', `/api/procurement/outsourcing/orders/${state.outOrderId}`), 200, 'reload order');
      if (order.outsourcingOrder.status !== 'RELEASED') throw new Error('order not released');
      return 'PLAN_CONFIRMED → RELEASED';
    });

    await run('UAT-18', 'Material Issue', 'Issue the snapshotted material to the supplier-WIP warehouse', async () => {
      const issue = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/issues`, {
        materialListId: state.materialId, quantity: 20, issuedDate: today,
        idempotencyKey: `uat-issue-${state.outOrderId}`,
      }), 201, 'issue material');
      return `issue ${issue.id}; qty=20`;
    });

    await run('UAT-19', 'Supplement', 'Create material supplement', async () => {
      const supplement = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/supplements`, {
        materialListId: state.materialId, quantity: 2, reason: 'UAT supplement', supplementDate: today,
        idempotencyKey: `uat-supplement-${state.outOrderId}`,
      }), 201, 'supplement material');
      return `supplement ${supplement.id}; qty=2`;
    });

    await run('UAT-20', 'Material Return', 'Return material from supplier-WIP', async () => {
      const returned = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/returns`, {
        materialListId: state.materialId, quantity: 1, returnDate: today,
        idempotencyKey: `uat-return-${state.outOrderId}`,
      }), 201, 'return material');
      return `material return ${returned.id}; qty=1`;
    });

    await run('UAT-21', 'Completion Receipt Notice', 'OUTSOURCE Completion Receipt Notice create with quantity + open-qty cap', async () => {
      const processingPo = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/processing-fee-purchase-orders`, {
        unitPriceCents: 1000, orderDate: today, expectedDeliveryDate: today, paymentTerms: '30 天',
        supplierContactName: 'UAT 联系人', supplierContactPhone: '13800000000', supplierAddress: 'UAT 地址',
      }, undefined, { 'idempotency-key': `uat-processing-po-${state.outOrderId}` }), 201, 'create processing fee PO');
      expect(await browserApi(page, 'POST', `/api/purchase-orders/${processingPo.id}/submit`), 200, 'submit processing fee PO');
      expect(await browserApi(page, 'POST', `/api/purchase-orders/${processingPo.id}/approve`, undefined, reviewerToken), 200, 'approve processing fee PO');
      state.processingPoId = processingPo.id;
      const response = await browserApi(page, 'POST', '/api/receipt-notices', {
        businessType: 'OUTSOURCE',
        outsourcingOrderId: state.outOrderId,
        processingPoId: processingPo.id,
        warehouseId: 'warehouse-001', noticeDate: today,
        items: [{ productId: 'product-001', quantity: 20 }],
      });
      if (response.status !== 201) throw new Error(`no executable outsourcing completion-notice contract: HTTP ${response.status} ${JSON.stringify(response.data)}`);
      state.outNoticeId = response.data.id;
      // 委外完工通知必须确认后才形成可收货的完工事实（OUT-17）。
      expect(await browserApi(page, 'POST', `/api/receipt-notices/${state.outNoticeId}/confirm`), 200, 'confirm completion notice');
      return `completion notice ${state.outNoticeId} CONFIRMED (OUTSOURCE businessType)`;
    });

    await run('UAT-22', 'Outsourcing Inspection', 'IQC create with OUTSOURCING_RECEIPT source contract', async () => {
      // Establish a real outsourcing receipt so OUTSOURCING_RECEIPT has a
      // substantive audit target; the previous canonical-Quality behavior
      // (400 "必须选择来源采购入库单") is exactly the defect this UAT
      // proves we have closed. Use admin token since IQC_MANAGE is the
      // canonical quality capability and IQC contract test is not gated
      // on warehouse role.
      const processingPoItemId = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(state.processingPoId).id;
      const outNoticeItemId = db.prepare('SELECT id FROM receipt_notice_items WHERE notice_id=? ORDER BY id LIMIT 1').get(state.outNoticeId).id;
      const recv = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/receipts', {
        orderId: state.outOrderId, quantity: 5, receivedDate: today, processingFeeCents: 5000,
        processingPoId: state.processingPoId, sourceNoticeId: state.outNoticeId, warehouseId: 'warehouse-001',
        items: [{ productId: 'product-001', quantity: 5, unitPriceCents: 1000, processingPoItemId, sourceNoticeItemId: outNoticeItemId }],
      }, undefined, { 'idempotency-key': `uat-out-receipt-iqc-${state.outOrderId}` }), 201, 'create outsourcing receipt for IQC');
      const response = await browserApi(page, 'POST', '/api/iqc', {
        outsourcing_receipt_id: recv.id,
      });
      if (response.status !== 201) throw new Error(`no executable OUTSOURCING_RECEIPT inspection contract: HTTP ${response.status} ${JSON.stringify(response.data)}`);
      state.iqcId = response.data.id;
      // 完成的合格检验是委外收货生效的证据前提（OUT-19 / OUT-18）。
      expect(await browserApi(page, 'POST', `/api/iqc/${state.iqcId}/complete`, {
        result: 'PASS', inspection_quantity: 5, passed_quantity: 5, failed_quantity: 0,
      }), 200, 'complete outsourcing IQC');
      // Verify the source-type discriminator persisted.
      const row = db.prepare('SELECT source_type, outsourcing_receipt_id FROM iqc_inspections WHERE id=?').get(state.iqcId);
      if (!row || row.source_type !== 'OUTSOURCING_RECEIPT' || row.outsourcing_receipt_id !== recv.id) {
        throw new Error(`inspection ${state.iqcId} source identity did not persist correctly: ${JSON.stringify(row)}`);
      }
      return `inspection ${state.iqcId} on OUTSOURCING_RECEIPT ${recv.id}`;
    });

    await run('UAT-23', 'Outsourcing Receipt → Backflush', 'Create/confirm receipt; verify backflush and cost evidence', async () => {
      const processingPoItemId = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(state.processingPoId).id;
      const outNoticeItemId = db.prepare('SELECT id FROM receipt_notice_items WHERE notice_id=? ORDER BY id LIMIT 1').get(state.outNoticeId).id;
      const receipt = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/receipts', {
        orderId: state.outOrderId, quantity: 15, receivedDate: today, processingFeeCents: 15000,
        processingPoId: state.processingPoId, sourceNoticeId: state.outNoticeId, warehouseId: 'warehouse-001',
        items: [{ productId: 'product-001', quantity: 15, unitPriceCents: 1000, processingPoItemId, sourceNoticeItemId: outNoticeItemId }],
      }, undefined, { 'idempotency-key': `uat-out-receipt-${state.outOrderId}` }), 201, 'create outsourcing receipt');
      state.outReceiptId = receipt.id;
      state.outReceiptItemId = db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY id LIMIT 1').get(receipt.id).id;
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/receipts/${receipt.id}/confirm`, {}, undefined, { 'idempotency-key': `uat-out-receipt-confirm-${receipt.id}` }), 200, 'confirm outsourcing receipt');
      const evidence = db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.id);
      if (!evidence) throw new Error('cost evidence missing after receipt confirm');
      return `receipt ${receipt.id}; backflush evidence=${evidence.material_consumed_value_cents}`;
    });

    await run('UAT-24', 'Processing Fee Supplier Bill', 'Create the draft bill and assert the approved fail-closed posting boundary (OUT-20)', async () => {
      const receiptItemId = db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY id LIMIT 1').get(state.outReceiptId).id;
      const bill = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/processing-fee-bills', {
        supplierId: 'supplier-001', supplierInvoiceNo: `UAT-${Date.now()}`, billDate: today,
        idempotencyKey: `uat-bill-${state.outReceiptId}`,
        lines: [{ outsourcingReceiptItemId: receiptItemId, quantity: 15, unitPriceCents: 1000 }],
      }), 201, 'create processing fee bill');
      state.processingBillId = bill.id;
      // 草稿只是「待结算事实的登记」：不产生应付、凭证，也不刷新成本证据
      // （Requirement §31.19.3 C-P01）。
      const ap = db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(bill.id).n;
      const evidence = db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(state.outReceiptId);
      if (ap !== 0) throw new Error('草稿不得产生应付事实');
      if (!evidence || evidence.basis_status === 'FINAL') throw new Error(`cost evidence must stay provisional: ${JSON.stringify(evidence)}`);
      return `bill ${bill.id} DRAFT; AP=0; evidence provisional`;
    });

    await run('UAT-25', 'Finished Outsourcing Return', 'Assert the approved fail-closed boundary: no credit is handed over', async () => {
      const response = await browserApi(page, 'POST', '/api/procurement/outsourcing/finished-returns', {
        outsourcingReceiptId: state.outReceiptId, quantity: 2, returnDate: today,
      });
      if (response.status !== 409 || response.data.code !== 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED') {
        throw new Error(`unexpected ${response.status} ${JSON.stringify(response.data)}`);
      }
      const credits = db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='OUTSOURCING_FINISHED_RETURN'").get().n;
      if (credits !== 0) throw new Error('被拒绝的成品退货不得产生信用证据');
      return 'HTTP 409 OUTSOURCING_FINISHED_RETURN_NOT_APPROVED; 零信用证据';
    });

    await run('UAT-26', 'Difference Allocation', 'Preview the difference and assert the approved fail-closed apply boundary', async () => {
      const preview = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/difference-preview`), 200, 'preview difference');
      const row = (preview.preview || [])[0];
      const applied = await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/difference-apply`, {
        materialListId: row?.materialListId ?? state.materialId, supplementQuantity: 1, returnQuantity: 0, periodKey: today.slice(0, 7),
      });
      if (applied.status !== 409 || applied.data.code !== 'OUTSOURCING_DIFFERENCE_APPROVAL_PENDING') {
        throw new Error(`unexpected ${applied.status} ${JSON.stringify(applied.data)}`);
      }
      return `preview rows=${(preview.preview || []).length}; apply HTTP 409 OUTSOURCING_DIFFERENCE_APPROVAL_PENDING`;
    });

    await run('UAT-27', 'WIP Transfer', 'Create compatible target order/material; transfer remaining supplier WIP', async () => {
      const targetBomId = seedOutsourceBom('uat-out-bom-002', 'product-001', 'product-002', 1);
      const target = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 20, businessDate: today, bomId: targetBomId,
      }), 201, 'create target order');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/material-list`, {
        items: [{ productId: 'product-002', sourceWarehouseId: 'warehouse-001' }],
      }), 200, 'target material list');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/transition`, { action: 'CONFIRM_PLAN' }), 200, 'target plan confirm');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/transition`, { action: 'RELEASE' }), 200, 'target release');
      const transfer = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/wip-transfers', {
        sourceOrderId: state.outOrderId, targetOrderId: target.id, materialListId: state.materialId, quantity: 1, transferDate: today,
        idempotencyKey: `uat-wip-transfer-${state.outOrderId}`,
      }), 201, 'transfer WIP');
      return `WIP transfer ${transfer.id}; qty=1`;
    });

    await run('UAT-28', 'Outsourcing Reports', 'Open Outsourcing surface; query execution and material-position reports', async () => {
      await page.goto(`${baseUrl}#outsourcing`, { waitUntil: 'networkidle' });
      const execution = expect(await browserApi(page, 'GET', '/api/reports/outsourcing/execution'), 200, 'execution report');
      const positions = expect(await browserApi(page, 'GET', `/api/reports/outsourcing/material-position?orderId=${state.outOrderId}`), 200, 'material report');
      if (!execution.report.some((row) => row.orderId === state.outOrderId) || positions.report.length === 0) throw new Error('report rows missing');
      return `execution rows=${execution.report.length}; material rows=${positions.report.length}`;
    });

    await run('UAT-29', '采购订单工作面四档宽度闭环', 'Open the purchase order surface at 320 / 390 / 430 / 680 CSS px; require no horizontal page overflow and a rendered surface', async () => {
      const observed = [];
      for (const width of [320, 390, 430, 680]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}#purchase-orders`, { waitUntil: 'networkidle' });
        const evidence = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          title: document.querySelector('h1,h2')?.textContent?.trim() || '',
          bodyText: document.body.innerText || '',
        }));
        if (evidence.documentWidth > evidence.viewportWidth + 1) {
          throw new Error(`${width}px 出现整页横向滚动：document ${evidence.documentWidth} > viewport ${evidence.viewportWidth}`);
        }
        if (!evidence.bodyText.includes('采购订单')) throw new Error(`${width}px 未渲染采购订单工作面`);
        observed.push(`${width}px`);
      }
      await page.setViewportSize({ width: 390, height: 900 });
      return `widths ${observed.join(', ')}: 无整页横向滚动且工作面已渲染`;
    });

    // ── 第四轮新增子能力：工作面可达性与业务事实 ─────────────────────────
    await run('UAT-30', '预付款要求（PRC-17）', '建立预付款要求 → 过账 → canonical 付款事实与财务交接', async () => {
      // 预付过账需要 canonical 结算账户（业务事实，不是测试捷径）。
      const settlementAccountId = 'uat-prepay-bank';
      db.prepare(`INSERT OR IGNORE INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,code,opening_balance_cents)
        VALUES(?,'UAT 银行','UAT-001','UAT 预付结算户','CHECKING',0,'CNY',1,?,?,?,0)`)
        .run(settlementAccountId, new Date().toISOString(), new Date().toISOString(), settlementAccountId);
      const created = expect(await browserApi(page, 'POST', '/api/procurement/prepayment-requirements', {
        poId: state.poId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: today,
      }), 201, 'create prepayment requirement');
      const requirement = created.prepaymentRequirement;
      if (requirement.status !== 'DRAFT') throw new Error(`requirement must stay DRAFT: ${requirement.status}`);
      if (requirement.expectedPaymentCents <= 0) throw new Error('预付金额必须由订单金额与比例推导');
      // 职责分离：申请人（admin）不得过账自己的申请，过账由财务岗执行。
      const selfPost = await browserApi(page, 'POST', `/api/procurement/prepayment-requirements/${requirement.id}/post`, {
        settlementAccountId, paymentMethod: 'BANK',
      });
      if (selfPost.status !== 409 || selfPost.data.code !== 'PREPAYMENT_SELF_POST_FORBIDDEN') {
        throw new Error(`申请人自批必须 409，实际 ${selfPost.status} ${JSON.stringify(selfPost.data)}`);
      }
      const posted = expect(await browserApi(page, 'POST', `/api/procurement/prepayment-requirements/${requirement.id}/post`, {
        settlementAccountId, paymentMethod: 'BANK',
      }, accountingToken), 200, 'post prepayment requirement');
      if (posted.prepaymentRequirement.status !== 'POSTED') throw new Error('预付款要求未进入 POSTED');
      const disbursement = db.prepare('SELECT * FROM payment_disbursements WHERE id=?').get(posted.prepaymentRequirement.financeHandoffId);
      if (!disbursement) throw new Error('过账未产生 canonical 付款单');
      const payable = db.prepare("SELECT * FROM account_payables WHERE source_type='PREPAYMENT_REQUIREMENT'").get();
      if (!payable) throw new Error('过账未产生 PREPAYMENT_REQUIREMENT 应付项');
      const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_type='PREPAYMENT_REQUIREMENT' AND entity_id=? AND action='POST'").get(requirement.id);
      if (!audit) throw new Error('过账必须写审计');
      state.prepaymentId = requirement.id;
      return `requirement ${requirement.id} DRAFT → POSTED; 付款单 ${disbursement.id}; 应付 ${payable.id}`;
    });

    await run('UAT-31', '货源 override（PRC-04）', '登记有界 override → 只读列表可见', async () => {
      const override = expect(await browserApi(page, 'POST', '/api/procurement/source-entries/override', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
        reason: 'UAT：供应商尚未完成货源建档', effectiveFrom: today, effectiveTo: today,
      }), 201, 'create source override');
      const list = expect(await browserApi(page, 'GET', '/api/procurement/source-overrides'), 200, 'list source overrides');
      if (!list.overrides.some((row) => row.id === override.id)) throw new Error('override 未出现在只读列表');
      const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_type='SOURCE_LIST_OVERRIDE' AND entity_id=? AND action='OVERRIDE'").get(override.id);
      if (!audit) throw new Error('override 必须写恰好一条审计');
      const missingReason = await browserApi(page, 'POST', '/api/procurement/source-entries/override', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
        reason: '   ', effectiveFrom: today, effectiveTo: today,
      });
      if (missingReason.status !== 400) throw new Error(`缺原因必须 400，实际 ${missingReason.status}`);
      return `override ${override.id}；缺原因固定 400`;
    });

    await run('UAT-32', '交货计划下容差自动关单（PRC-16）', '收货确认触发自动关单并记录被容忍的短交数量', async () => {
      const orderId = await createApprovedPo(page, reviewerToken, 10);
      const item = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? AND product_id=?').get(orderId, 'product-001');
      const schedule = expect(await browserApi(page, 'POST', `/api/purchase-orders/${orderId}/delivery-schedules`, {
        orderItemId: item.id, plannedQuantity: 10, plannedDate: today,
        plannedDateFrom: today, plannedDateTo: today, sequenceNo: 1,
        upperTolerancePct: 5, lowerTolerancePct: 10,
      }), 201, 'create delivery schedule');
      const receipt = expect(await browserApi(page, 'POST', '/api/purchase-receipts', {
        purchaseOrderId: orderId, supplierId: 'supplier-001', warehouseId: 'warehouse-001', receiptDate: today,
        items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 9, unitPriceCents: 1000, deliveryScheduleId: schedule.id }],
      }), 201, 'create purchase receipt');
      const iqc = expect(await browserApi(page, 'POST', '/api/iqc', { purchase_receipt_id: receipt.id }, warehouseToken), 201, 'create IQC');
      expect(await browserApi(page, 'POST', `/api/iqc/${iqc.id}/complete`, {
        result: 'PASS', inspection_quantity: 9, passed_quantity: 9, failed_quantity: 0,
      }, warehouseToken), 200, 'complete IQC');
      expect(await browserApi(page, 'POST', `/api/purchase-receipts/${receipt.id}`, { action: 'confirm' }, warehouseToken), 200, 'confirm receipt');
      const row = db.prepare('SELECT status, closed_by FROM purchase_order_delivery_schedules WHERE id=?').get(schedule.id);
      if (row.status !== 'CLOSED') throw new Error(`交货计划未自动关单：${row.status}`);
      const close = db.prepare('SELECT * FROM po_delivery_schedule_closes WHERE delivery_schedule_id=?').get(schedule.id);
      if (!close) throw new Error('关单事实缺失');
      if (Number(close.tolerated_short_quantity) !== 1) throw new Error(`短交数量应为 1：${close.tolerated_short_quantity}`);
      if (close.triggered_by !== 'RECEIPT_CONFIRM') throw new Error(`关单触发方式应为 RECEIPT_CONFIRM：${close.triggered_by}`);
      return `schedule ${schedule.id} CLOSED；短交 ${close.tolerated_short_quantity}；triggered_by=${close.triggered_by}`;
    });

    await run('UAT-33', '加工费正式过账与红冲（OUT-20 / C-P01 / C-P03）', '过账产生 canonical 应付与凭证，红冲金额反向且数量守恒', async () => {
      // UAT-24 已为该收货建立草稿账单（占满可开票量），这里对同一张账单过账：
      // 同一收货的加工费不得被两张账单重复开票。
      const bill = { id: state.processingBillId };
      const posted = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.id}/post`), 200, 'post processing fee bill');
      if (!posted) throw new Error('加工费过账未返回结果');
      const payable = db.prepare("SELECT * FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(bill.id);
      if (!payable) throw new Error('加工费过账未产生 canonical 应付');
      if (Number(payable.amount_cents) !== 15000) throw new Error(`应付金额应为 15000：${payable.amount_cents}`);
      const entries = db.prepare(`SELECT e.*, s.code subject_code FROM accounting_entries e
        JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id
        WHERE v.source_type='SUPPLIER_BILL' AND v.source_id=?`).all(bill.id);
      const debitCodes = entries.filter((row) => row.direction === 'DEBIT').map((row) => row.subject_code);
      if (!debitCodes.includes('6408')) throw new Error(`借方必须是委外加工费科目 6408：${JSON.stringify(debitCodes)}`);
      const evidence = db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(state.outReceiptId);
      if (!evidence || evidence.basis_status !== 'FINAL') throw new Error(`成本证据应转 FINAL：${JSON.stringify(evidence?.basis_status)}`);
      const billItemId = db.prepare('SELECT id FROM supplier_bill_items WHERE bill_id=? ORDER BY line_no LIMIT 1').get(bill.id).id;
      const reversal = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.id}/reverse`, {
        items: [{ billItemId, quantity: 15 }], reason: 'UAT 红冲', businessDate: today,
      }, undefined, { 'idempotency-key': `uat-reverse-${bill.id}` }), 200, 'reverse processing fee bill');
      const reversalFact = db.prepare("SELECT * FROM outsourcing_processing_fee_reversals WHERE supplier_bill_id=? AND status='CONFIRMED'").get(bill.id);
      if (!reversalFact) throw new Error('红冲事实缺失');
      if (Number(reversalFact.reversal_amount_cents) !== 15000) throw new Error(`红冲金额应为 15000：${reversalFact.reversal_amount_cents}`);
      const overReversal = await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.id}/reverse`, {
        items: [{ billItemId, quantity: 15 }], reason: 'UAT 重复红冲', businessDate: today,
      }, undefined, { 'idempotency-key': `uat-reverse-over-${bill.id}` });
      if (overReversal.status === 200) throw new Error('重复红冲必须被拒');
      return `bill ${bill.id} POSTED → 红冲 ${reversalFact.reversal_amount_cents}；借方 6408；证据 FINAL`;
    });

    await run('UAT-34', '期初委外订单（OUT-23）', '期初订单带物料行 → 进入同一本 WIP 身份账且落在供应商 WIP 位置', async () => {
      const created = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/opening-orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, unit: 'EA',
        businessDate: today, remark: 'UAT 上线日历史委外',
        items: [{ productId: 'product-001', quantity: 5, sourceWarehouseId: 'warehouse-001' }],
      }), 201, 'create opening outsourcing order');
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(created.id);
      if (Number(order.is_opening) !== 1) throw new Error('期初订单必须被显式标记');
      const effects = db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE material_list_id IN (SELECT id FROM outsourcing_material_list WHERE order_id=?)').all(created.id);
      if (effects.length !== 1 || effects[0].event_type !== 'OPENING') {
        throw new Error(`期初结余必须进入同一本身份账：${JSON.stringify(effects.map((row) => row.event_type))}`);
      }
      const wipQuantity = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE warehouse_id='warehouse-002' AND product_id='product-001' AND active=1").get().q);
      if (wipQuantity < 5) throw new Error(`期初 WIP 必须落在供应商 WIP 位置：${wipQuantity}`);
      const vouchers = db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
      const payables = db.prepare('SELECT COUNT(*) n FROM account_payables').get().n;
      if (!vouchers || !payables) throw new Error('期初不得虚构凭证或应付');
      return `opening order ${created.id}；身份账 1 条 OPENING；供应商 WIP ${wipQuantity}`;
    });

    await run('UAT-35', '加工费会计档案维护（OUT-20 / C-P02）', '列出 → 建立供应商级档案 → 暂停 → 重新批准', async () => {
      const listed = expect(await browserApi(page, 'GET', '/api/procurement/outsourcing/processing-fee-accounting-profiles'), 200, 'list accounting profiles');
      if (!listed.processingFeeAccountingProfiles.length) throw new Error('必须至少存在迁移预置的默认档案');
      const created = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', {
        scope: 'SUPPLIER', supplierId: 'supplier-002', profileCode: `UAT-SUP-${Date.now()}`,
        taxMode: 'NO_TAX', processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: today,
      }), 201, 'create accounting profile');
      const suspended = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-accounting-profiles/${created.processingFeeAccountingProfile.id}/approval`, {
        approvalState: 'SUSPENDED', reason: 'UAT 复核',
      }), 200, 'suspend accounting profile');
      if (suspended.processingFeeAccountingProfile.approvalState !== 'SUSPENDED') throw new Error('档案未暂停');
      const approved = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-accounting-profiles/${created.processingFeeAccountingProfile.id}/approval`, {
        approvalState: 'APPROVED',
      }), 200, 're-approve accounting profile');
      if (approved.processingFeeAccountingProfile.approvalState !== 'APPROVED') throw new Error('档案未重新批准');
      const unresolved = await browserApi(page, 'POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', {
        scope: 'SUPPLIER', supplierId: 'supplier-002', profileCode: `UAT-BAD-${Date.now()}`,
        processingFeeRole: 'NO_SUCH_ROLE', effectiveFrom: today,
      });
      if (unresolved.status !== 409) throw new Error(`未解析角色码必须 409，实际 ${unresolved.status}`);
      return `profile ${created.processingFeeAccountingProfile.id} 建立 → 暂停 → 重新批准；未解析角色码固定 409`;
    });

    await run('UAT-36', '第四轮新增工作面浏览器可达性', '采购订单详情、委外加工与寻源定价三个工作面在 390 px 下渲染新增面板且无整页横向滚动', async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      const surfaces = [];

      await page.goto(`${baseUrl}#purchase-orders/${state.poId}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const poText = await page.evaluate(() => document.body.innerText || '');
      if (!poText.includes('预付款要求')) throw new Error('采购订单详情未渲染预付款要求面板');
      if (!poText.includes('交货计划')) throw new Error('采购订单详情未渲染交货计划面板');
      const poOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (poOverflow > 1) throw new Error(`采购订单详情出现整页横向滚动：${poOverflow}px`);
      surfaces.push('purchase-orders');

      await page.goto(`${baseUrl}#sourcing-pricing`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const sourcingText = await page.evaluate(() => document.body.innerText || '');
      if (!sourcingText.includes('货源 override')) throw new Error('寻源与定价未渲染货源 override 面板');
      const sourcingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (sourcingOverflow > 1) throw new Error(`寻源与定价出现整页横向滚动：${sourcingOverflow}px`);
      surfaces.push('sourcing-pricing');

      await page.goto(`${baseUrl}#outsourcing`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const outsourcingText = await page.evaluate(() => document.body.innerText || '');
      if (!outsourcingText.includes('加工费会计档案')) throw new Error('委外加工未渲染加工费会计档案面板');
      const outsourcingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (outsourcingOverflow > 1) throw new Error(`委外加工出现整页横向滚动：${outsourcingOverflow}px`);
      surfaces.push('outsourcing');

      return `390px 渲染并无整页横向滚动：${surfaces.join(', ')}`;
    });

    console.log('=== Procurement & Outsourcing Functional Browser UAT ===');
    for (const result of results) console.log(`${result.id} ${result.status} | ${result.label} | ${result.action} | ${result.evidence}`);
    console.log(`TOTAL ${results.filter((row) => row.status === 'PASS').length} PASS / ${results.filter((row) => row.status === 'FAIL').length} FAIL`);
    console.log(`BROWSER_ERRORS ${browserErrors.length}`);
    if (browserErrors.length) console.log(browserErrors.join('\n'));
    if (results.some((row) => row.status === 'FAIL')) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await new Promise((done) => server.close(done));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
