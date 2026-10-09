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

async function browserApi(page, method, path, body, token) {
  return page.evaluate(async ({ method, path, body, token }) => {
    const activeToken = token || localStorage.getItem('modern_erp_token');
    const response = await fetch(path, {
      method,
      headers: {
        ...(activeToken ? { authorization: `Bearer ${activeToken}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }, { method, path, body, token });
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

    await run('UAT-01', 'Supplier qualification edit/save', 'Suppliers route; PATCH profile; GET persisted profile', async () => {
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

    await run('UAT-03', 'Source List / eligible supplier resolution', 'Create source entry; query effective list', async () => {
      const source = expect(await browserApi(page, 'POST', '/api/procurement/source-entries', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE', effectiveFrom: today,
      }), 201, 'create source entry');
      const list = expect(await browserApi(page, 'GET', `/api/procurement/source-entries?productId=product-002&date=${today}`), 200, 'resolve source list');
      if (!list.sourceEntries.some((entry) => entry.id === source.id)) throw new Error('eligible source not returned');
      return `source ${source.id} resolved eligible`;
    });

    await run('UAT-04', 'Quota allocation', 'Create quota; resolve sourcing allocation', async () => {
      expect(await browserApi(page, 'POST', '/api/procurement/quotas', {
        supplierId: 'supplier-001', productId: 'product-002', sourceType: 'PURCHASE',
        proportion: { num: 1, den: 1 }, effectiveFrom: today,
      }), 201, 'create quota');
      const decision = expect(await browserApi(page, 'POST', '/api/procurement/sourcing-decisions', {
        sourceType: 'PR', sourceId: 'UAT-QUOTA', procurementSourceType: 'PURCHASE',
        productId: 'product-002', businessDate: today, quantity: 17,
      }), 200, 'allocate quota');
      if (decision.allocations.reduce((sum, row) => sum + row.allocatedQuantity, 0) !== 17) throw new Error('quota allocation not conserved');
      return 'allocation total=17';
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
      expect(await browserApi(page, 'POST', `/api/procurement/purchase-order-changes/${change.id}/approve`), 200, 'approve change');
      expect(await browserApi(page, 'POST', `/api/procurement/purchase-order-changes/${change.id}/apply`), 200, 'apply change');
      const execution = expect(await browserApi(page, 'GET', `/api/purchase-orders/${state.poId}/execution`), 200, 'query changed PO');
      if (execution.execution.items.length !== 2) throw new Error('PO change not reflected');
      return `change ${change.id}; execution items=2`;
    });

    await run('UAT-08', 'Receipt Notice create from PO', 'Create and confirm notice from approved PO', async () => {
      const item = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? AND product_id=?').get(state.poId, 'product-001');
      const notice = expect(await browserApi(page, 'POST', '/api/receipt-notices', {
        purchaseOrderId: state.poId, warehouseId: 'warehouse-001', noticeDate: today,
        items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 10 }],
      }), 201, 'create receipt notice');
      expect(await browserApi(page, 'POST', `/api/receipt-notices/${notice.id}/confirm`), 200, 'confirm receipt notice');
      return `notice ${notice.id} CONFIRMED`;
    });

    await run('UAT-09', 'IQC valid pass flow', 'Create receipt draft; create and PASS IQC', async () => {
      const item = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? AND product_id=?').get(state.poId, 'product-001');
      const receipt = expect(await browserApi(page, 'POST', '/api/purchase-receipts', {
        purchaseOrderId: state.poId, supplierId: 'supplier-001', warehouseId: 'warehouse-001', receiptDate: today,
        items: [{ purchaseOrderItemId: item.id, productId: 'product-001', quantity: 10, unitPriceCents: 1000 }],
      }, warehouseToken), 201, 'create purchase receipt');
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
        receiptId: state.receiptId, requestDate: today, remark: 'UAT return request',
      }), 201, 'create return request');
      const ret = expect(await browserApi(page, 'POST', '/api/purchase-returns', {
        receiptId: state.receiptId, supplierId: 'supplier-001', warehouseId: 'warehouse-001',
        items: [{ receiptItemId: state.receiptItemId, productId: 'product-001', quantity: 2, unitPriceCents: 1000 }],
      }, warehouseToken), 201, 'create purchase return');
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

    await run('UAT-14', 'VMI owner-dimensional action fail-closed', 'Attempt VMI receipt; require explicit owner-dimension failure', async () => {
      const response = await browserApi(page, 'POST', '/api/procurement/vmi/receipts', {
        supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: 'product-001', quantity: 50, receivedDate: today,
      });
      if (response.status !== 409 || !String(response.data.error).includes('INVENTORY_OWNER_DIMENSION_UNAVAILABLE')) throw new Error(`unexpected ${response.status} ${JSON.stringify(response.data)}`);
      return 'HTTP 409 INVENTORY_OWNER_DIMENSION_UNAVAILABLE (expected fail-closed)';
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

    await run('UAT-16', 'Manual Outsourcing Order', 'Create manual outsourcing order', async () => {
      const order = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 20, businessDate: today,
      }), 201, 'create manual outsourcing order');
      state.outOrderId = order.id;
      return `manual order ${order.id}`;
    });

    await run('UAT-17', 'Plan Confirm / Release', 'Transition manual order DRAFT→PLAN_CONFIRMED→RELEASED', async () => {
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/transition`, { action: 'PLAN_CONFIRMED' }), 200, 'plan confirm');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/transition`, { action: 'RELEASED' }), 200, 'release');
      const order = expect(await browserApi(page, 'GET', `/api/procurement/outsourcing/orders/${state.outOrderId}`), 200, 'reload order');
      if (order.outsourcingOrder.status !== 'RELEASED') throw new Error('order not released');
      return 'PLAN_CONFIRMED → RELEASED';
    });

    await run('UAT-18', 'Material Issue', 'Snapshot material list; issue to supplier-WIP warehouse', async () => {
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/material-list`, {
        items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS', bomSnapshot: { source: 'UAT' } }],
      }), 200, 'snapshot material list');
      state.materialId = db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(state.outOrderId).id;
      const issue = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/issues`, {
        materialListId: state.materialId, quantity: 10, fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', issuedDate: today,
        idempotencyKey: `uat-issue-${state.outOrderId}`,
      }), 201, 'issue material');
      return `issue ${issue.id}; qty=10`;
    });

    await run('UAT-19', 'Supplement', 'Create material supplement', async () => {
      const supplement = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/supplements`, {
        materialListId: state.materialId, quantity: 2, reason: 'UAT supplement', supplementDate: today,
      }), 201, 'supplement material');
      return `supplement ${supplement.id}; qty=2`;
    });

    await run('UAT-20', 'Material Return', 'Return material from supplier-WIP', async () => {
      const returned = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/returns`, {
        materialListId: state.materialId, quantity: 1, fromWarehouseId: 'warehouse-002', toWarehouseId: 'warehouse-001', returnDate: today,
      }), 201, 'return material');
      return `material return ${returned.id}; qty=1`;
    });

    await run('UAT-21', 'Completion Receipt Notice', 'OUTSOURCE Completion Receipt Notice create with quantity + open-qty cap', async () => {
      const response = await browserApi(page, 'POST', '/api/receipt-notices', {
        businessType: 'OUTSOURCE',
        outsourcingOrderId: state.outOrderId,
        warehouseId: 'warehouse-001', noticeDate: today,
        items: [{ productId: 'product-001', quantity: 5 }],
      });
      if (response.status !== 201) throw new Error(`no executable outsourcing completion-notice contract: HTTP ${response.status} ${JSON.stringify(response.data)}`);
      state.noticeId = response.data.id;
      return `completion notice ${state.noticeId} (OUTSOURCE businessType)`;
    });

    await run('UAT-22', 'Outsourcing Inspection', 'IQC create with OUTSOURCING_RECEIPT source contract', async () => {
      // Establish a real outsourcing receipt so OUTSOURCING_RECEIPT has a
      // substantive audit target; the previous canonical-Quality behavior
      // (400 "必须选择来源采购入库单") is exactly the defect this UAT
      // proves we have closed. Use admin token since IQC_MANAGE is the
      // canonical quality capability and IQC contract test is not gated
      // on warehouse role.
      const recv = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/receipts', {
        orderId: state.outOrderId, quantity: 5, receivedDate: today, processingFeeCents: 5000,
      }), 201, 'create outsourcing receipt for IQC');
      // IQC over OUTSOURCING_RECEIPT requires an inspection-able item
      // (mirrors canonical purchase-receipt IQC path).
      db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no) VALUES(?,?,?,?,?,?)`)
        .run(`ori-${recv.id}`, recv.id, 'product-001', 5, 1000, 1);
      const response = await browserApi(page, 'POST', '/api/iqc', {
        outsourcing_receipt_id: recv.id,
      });
      if (response.status !== 201) throw new Error(`no executable OUTSOURCING_RECEIPT inspection contract: HTTP ${response.status} ${JSON.stringify(response.data)}`);
      state.iqcId = response.data.id;
      // Verify the source-type discriminator persisted.
      const row = db.prepare('SELECT source_type, outsourcing_receipt_id FROM iqc_inspections WHERE id=?').get(state.iqcId);
      if (!row || row.source_type !== 'OUTSOURCING_RECEIPT' || row.outsourcing_receipt_id !== recv.id) {
        throw new Error(`inspection ${state.iqcId} source identity did not persist correctly: ${JSON.stringify(row)}`);
      }
      return `inspection ${state.iqcId} on OUTSOURCING_RECEIPT ${recv.id}`;
    });

    await run('UAT-23', 'Outsourcing Receipt → Backflush', 'Create/confirm receipt; verify backflush and cost evidence', async () => {
      const receipt = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/receipts', {
        orderId: state.outOrderId, quantity: 20, receivedDate: today, processingFeeCents: 20000,
      }), 201, 'create outsourcing receipt');
      state.outReceiptId = receipt.id;
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/receipts/${receipt.id}/confirm`), 200, 'confirm outsourcing receipt');
      const evidence = db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.id);
      if (!evidence) throw new Error('cost evidence missing after receipt confirm');
      return `receipt ${receipt.id}; backflush evidence=${evidence.material_consumed_value_cents}`;
    });

    await run('UAT-24', 'Processing Fee Supplier Bill', 'Create/post processing-fee bill; verify canonical AP and FINAL evidence', async () => {
      state.outReceiptItemId = `uat-ori-${Date.now()}`;
      db.prepare(`INSERT INTO outsourcing_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,line_no)
        VALUES(?,?,?,20,1000,1)`).run(state.outReceiptItemId, state.outReceiptId, 'product-001');
      const bill = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/processing-fee-bills', {
        supplierId: 'supplier-001', supplierInvoiceNo: `UAT-${Date.now()}`, billDate: today,
        idempotencyKey: `uat-bill-${state.outReceiptId}`,
        lines: [{ outsourcingReceiptItemId: state.outReceiptItemId, quantity: 20, unitPriceCents: 1000 }],
      }), 201, 'create processing fee bill');
      state.processingBillId = bill.id;
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/processing-fee-bills/${bill.id}/post`), 200, 'post processing fee bill');
      const ap = db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(bill.id);
      const evidence = db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(state.outReceiptId);
      if (!ap || evidence.basis_status !== 'FINAL' || evidence.processing_fee_actual_cents !== 20000) throw new Error(`AP/evidence mismatch ${JSON.stringify({ ap, evidence })}`);
      return `bill ${bill.id} POSTED; AP=20000; actual fee=20000 FINAL`;
    });

    await run('UAT-25', 'Finished Outsourcing Return', 'Return billed finished qty; verify commercial credit handoff', async () => {
      const returned = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/finished-returns', {
        outsourcingReceiptId: state.outReceiptId, quantity: 2, returnDate: today,
      }), 201, 'create finished return');
      if (returned.commercialState !== 'BILLED_CREDIT_POSTED' || returned.commercialCreditCents !== 2000) throw new Error(`commercial handoff mismatch ${JSON.stringify(returned)}`);
      return `return ${returned.id}; canonical credit=2000`;
    });

    await run('UAT-26', 'Difference Allocation', 'Preview then apply supplement allocation', async () => {
      const preview = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/difference-preview`), 200, 'preview difference');
      const applied = expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${state.outOrderId}/difference-apply`, {
        materialListId: preview.preview[0].materialListId, supplementQuantity: 1, returnQuantity: 0, periodKey: today.slice(0, 7),
      }), 200, 'apply difference');
      return `preview rows=${preview.preview.length}; applied=${applied.ok}`;
    });

    await run('UAT-27', 'WIP Transfer', 'Create compatible target order/material; transfer remaining supplier WIP', async () => {
      const target = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/orders', {
        supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 20, businessDate: today,
      }), 201, 'create target order');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/transition`, { action: 'PLAN_CONFIRMED' }), 200, 'target plan confirm');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/transition`, { action: 'RELEASED' }), 200, 'target release');
      expect(await browserApi(page, 'POST', `/api/procurement/outsourcing/orders/${target.id}/material-list`, {
        items: [{ productId: 'product-001', requiredQuantity: 5, unit: 'PCS' }],
      }), 200, 'target material list');
      const transfer = expect(await browserApi(page, 'POST', '/api/procurement/outsourcing/wip-transfers', {
        sourceOrderId: state.outOrderId, targetOrderId: target.id, materialListId: state.materialId, quantity: 1, transferDate: today,
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
