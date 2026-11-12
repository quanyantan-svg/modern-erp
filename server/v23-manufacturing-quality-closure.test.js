// V23 Manufacturing & Quality Domain Closure — 2026-11-12 remediation round.
//
// Covers the behaviours that the domain audit found missing or not enforced:
//   - Material List controlled edit / approve / release and its refusals
//   - Topology and outsourced boundary fail closed at report CONFIRM and at
//     operation COMPLETE (not only at report creation)
//   - The outsourced hand-off that leaves the internal completion path
//   - The controlled inspection-type vocabulary
//   - The inspection WAIVED path with its provenance
//   - The nonconforming disposition and the LOT / SERIAL HOLD it creates
//   - The pending inspection worklist
//   - The operation transfer by scan and its quantity ceiling
//   - The byproduct maintenance and the byproduct receipt into stock
//
// Every case carries a negative example: a refusal that must stay a refusal.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminAuth;
let counter = 0;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-mq-closure-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminAuth = (await response.json()).token;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function api(method, path, token, body, idempotencyKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

// A product with an approved BOM, an active routing and one operation, plus
// the warehouse and the component stock the material flow needs.
function setupFixture({ outsource = false, topology = 'LINEAR' } = {}) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const productId = `v23-product-${suffix}`;
  const componentId = `v23-comp-${suffix}`;
  const warehouseId = `v23-wh-${suffix}`;
  const routingId = `v23-routing-${suffix}`;
  const now = new Date().toISOString();
  const insertProduct = database.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at)
    VALUES(?,?,?,?,'件',0,0,1,0,?,?)`);
  insertProduct.run(productId, `V23-P-${suffix}`, 'V23 产品', '制造', now, now);
  insertProduct.run(componentId, `V23-C-${suffix}`, 'V23 组件', '原材料', now, now);
  database.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)`)
    .run(warehouseId, `V23-WH-${suffix}`, 'V23 主仓', now, now);
  database.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,approval_status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,'ACTIVE','SELF_MAKE','APPROVED','','user-admin',?,?)`).run(`v23-bom-${suffix}`, productId, '1.0', now, now);
  database.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator)
    VALUES(?,?,?,?,0,1,'件',1,1)`).run(`v23-bomi-${suffix}`, `v23-bom-${suffix}`, componentId, 2);
  database.prepare(`INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,notes,created_at,updated_at)
    VALUES(?,?,?,?,'1.0','ACTIVE','',?,?)`).run(routingId, productId, `V23-R-${suffix}`, 'V23 工艺路线', now, now);
  database.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,updated_at,active,is_outsource,quality_policy,topology)
    VALUES(?,?,1,'OP10','装配工序','WC1',0,1,'',?,?,1,?, 'NONE', ?)`)
    .run(`v23-op-${suffix}`, routingId, now, now, outsource ? 1 : 0, topology);
  database.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,updated_at,active,is_outsource,quality_policy,topology)
    VALUES(?,?,2,'OP20','检验工序','WC1',0,1,'',?,?,1,0,'NONE','LINEAR')`)
    .run(`v23-op2-${suffix}`, routingId, now, now);
  database.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,100,?)`).run(warehouseId, componentId, now);
  return { productId, componentId, warehouseId, routingId, suffix };
}

async function createReleasedOrder(setup, quantity = 10) {
  const created = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const orderId = created.data.id;
  for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
    const transition = await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    assert.equal(transition.status, 200, `${target}: ${JSON.stringify(transition.data)}`);
  }
  const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
  return { orderId, order: detail.data.order };
}

describe('V23 Material List lifecycle', () => {
  test('controlled edit → approve → release, and an approved list refuses further edits', async () => {
    const setup = setupFixture();
    const { orderId, order } = await createReleasedOrder(setup);
    const lineId = order.items[0].id;

    // The order is released, so the controlled edit is refused: after RELEASED
    // only a supplement may add material.
    const late = await api('POST', `/api/production-orders/${orderId}/material-list/edit`, adminAuth, {
      lines: [{ lineId, scrapRate: 0.05 }],
    });
    assert.equal(late.status, 409, `a released material list must refuse edits: ${JSON.stringify(late.data)}`);

    const draft = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 4 });
    const draftId = draft.data.id;
    await api('POST', `/api/production-orders/${draftId}/state`, adminAuth, { target: 'SUBMITTED' });
    await api('POST', `/api/production-orders/${draftId}/state`, adminAuth, { target: 'APPROVED' });
    const detail = await api('GET', `/api/production-orders/${draftId}`, adminAuth);
    const draftLineId = detail.data.order.items[0].id;

    // Changing the frozen BOM identity is refused.
    const identity = await api('POST', `/api/production-orders/${draftId}/material-list/edit`, adminAuth, {
      lines: [{ lineId: draftLineId, productId: setup.productId }],
    });
    assert.equal(identity.status, 409, `the product of a material line must not be editable: ${JSON.stringify(identity.data)}`);

    const edit = await api('POST', `/api/production-orders/${draftId}/material-list/edit`, adminAuth, {
      lines: [{ lineId: draftLineId, scrapRate: 0.05, remark: '受控编辑：提高损耗' }],
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal(edit.data.materialListStatus, 'CONTROLLED_EDIT');

    const approve = await api('POST', `/api/production-orders/${draftId}/material-list/approve`, adminAuth, {});
    assert.equal(approve.status, 200, JSON.stringify(approve.data));
    assert.equal(approve.data.materialListStatus, 'APPROVED');

    // An approved material list refuses further controlled edits.
    const after = await api('POST', `/api/production-orders/${draftId}/material-list/edit`, adminAuth, {
      lines: [{ lineId: draftLineId, scrapRate: 0.09 }],
    });
    assert.equal(after.status, 409, `an approved material list must refuse edits: ${JSON.stringify(after.data)}`);

    const release = await api('POST', `/api/production-orders/${draftId}/material-list/release`, adminAuth, {});
    assert.equal(release.status, 200, JSON.stringify(release.data));
    assert.equal(release.data.materialListStatus, 'RELEASED');
  });

  test('an invalid scrap rate is refused and leaves no partial edit behind', async () => {
    const setup = setupFixture();
    const created = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 3 });
    const orderId = created.data.id;
    await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'SUBMITTED' });
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    const lineId = detail.data.order.items[0].id;
    const invalid = await api('POST', `/api/production-orders/${orderId}/material-list/edit`, adminAuth, {
      lines: [{ lineId, scrapRate: 1.5 }],
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
    const after = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    assert.equal(after.data.order.materialListStatus, 'GENERATED', 'a refused edit must not change the material list state');
  });
});

describe('V23 topology and outsourced boundary enforcement', () => {
  test('a NETWORK operation refuses report confirmation and operation completion', async () => {
    const setup = setupFixture({ topology: 'PARALLEL' });
    const { orderId, order } = await createReleasedOrder(setup);
    const operationId = order.operationPlan[0].id;

    const report = await api('POST', '/api/manufacturing/operation-reports', adminAuth, {
      productionOrderId: orderId,
      productionOperationId: operationId,
      goodQuantity: 1,
    });
    assert.equal(report.status, 201, JSON.stringify(report.data));
    const confirm = await api('POST', `/api/manufacturing/operation-reports/${report.data.id}/confirm`, adminAuth, {});
    assert.equal(confirm.status, 409, `a non-LINEAR operation must refuse report confirmation: ${JSON.stringify(confirm.data)}`);

    const complete = await api('POST', `/api/manufacturing/operations/${operationId}/complete`, adminAuth, {});
    assert.equal(complete.status, 409, `a non-LINEAR operation must refuse completion: ${JSON.stringify(complete.data)}`);
  });

  test('an outsourced operation refuses internal completion and leaves through the hand-off', async () => {
    const setup = setupFixture({ outsource: true });
    const { orderId, order } = await createReleasedOrder(setup);
    const operationId = order.operationPlan[0].id;
    const supplierId = `v23-supplier-${setup.suffix}`;
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,payment_terms_days,created_at,updated_at)
      VALUES(?,?,?,'','','','',1,0,?,?)`).run(supplierId, `V23-S-${setup.suffix}`, 'V23 委外供应商', now, now);

    const complete = await api('POST', `/api/manufacturing/operations/${operationId}/complete`, adminAuth, {});
    assert.equal(complete.status, 409, `an outsourced operation must refuse internal completion: ${JSON.stringify(complete.data)}`);

    const handoff = await api('POST', `/api/production-operations/${operationId}/outsource-handoff`, adminAuth, { supplierId });
    assert.equal(handoff.status, 200, JSON.stringify(handoff.data));
    assert.equal(handoff.data.status, 'OUTSOURCED');

    const after = await api('POST', `/api/manufacturing/operations/${operationId}/complete`, adminAuth, {});
    assert.equal(after.status, 409, `a handed-off operation must still refuse internal completion: ${JSON.stringify(after.data)}`);

    const repeat = await api('POST', `/api/production-operations/${operationId}/outsource-handoff`, adminAuth, { supplierId });
    assert.equal(repeat.status, 409, `a repeated hand-off must be refused: ${JSON.stringify(repeat.data)}`);
  });
});

describe('V23 inspection vocabulary, waiver and nonconforming disposition', () => {
  test('an unknown inspection type is refused and a controlled type is accepted', async () => {
    const setup = setupFixture();
    const { orderId } = await createReleasedOrder(setup);
    const report = await api('POST', '/api/manufacturing/operation-reports', adminAuth, {
      productionOrderId: orderId,
      productionOperationId: (await api('GET', `/api/production-orders/${orderId}`, adminAuth)).data.order.operationPlan[0].id,
      goodQuantity: 1,
    });
    const invalid = await api('POST', '/api/production-inspections', adminAuth, {
      productionOrderId: orderId,
      sourceType: 'OPERATION_REPORT',
      sourceId: report.data.id,
      inspectionType: 'WHATEVER',
    });
    assert.equal(invalid.status, 400, `an unknown inspection type must be refused: ${JSON.stringify(invalid.data)}`);

    const valid = await api('POST', '/api/production-inspections', adminAuth, {
      productionOrderId: orderId,
      sourceType: 'OPERATION_REPORT',
      sourceId: report.data.id,
      inspectionType: 'FIRST_ARTICLE',
    });
    assert.equal(valid.status, 201, JSON.stringify(valid.data));
  });

  test('the pending worklist lists the drafts and a waiver needs a reason', async () => {
    const setup = setupFixture();
    const { orderId } = await createReleasedOrder(setup);
    const operationId = (await api('GET', `/api/production-orders/${orderId}`, adminAuth)).data.order.operationPlan[0].id;
    const report = await api('POST', '/api/manufacturing/operation-reports', adminAuth, {
      productionOrderId: orderId, productionOperationId: operationId, goodQuantity: 1,
    });
    const inspection = await api('POST', '/api/production-inspections', adminAuth, {
      productionOrderId: orderId, sourceType: 'OPERATION_REPORT', sourceId: report.data.id,
    });
    assert.equal(inspection.status, 201, JSON.stringify(inspection.data));

    const pending = await api('GET', '/api/production-inspections/pending', adminAuth);
    assert.equal(pending.status, 200);
    assert.ok(pending.data.inspections.some((row) => row.id === inspection.data.id),
      'the pending worklist must contain the new draft inspection');

    const noReason = await api('POST', `/api/production-inspections/${inspection.data.id}/waive`, adminAuth, {});
    assert.equal(noReason.status, 400, `a waiver without a reason must be refused: ${JSON.stringify(noReason.data)}`);

    const waived = await api('POST', `/api/production-inspections/${inspection.data.id}/waive`, adminAuth, { reason: '客户特批' });
    assert.equal(waived.status, 200, JSON.stringify(waived.data));
    assert.equal(waived.data.result, 'WAIVED');

    const detail = await api('GET', `/api/production-inspections/${inspection.data.id}`, adminAuth);
    assert.equal(detail.data.inspection.waived_by, 'user-admin');
    assert.equal(detail.data.inspection.waive_reason, '客户特批');
  });

  test('a nonconforming receipt is marked and its identities are put on HOLD', async () => {
    const setup = setupFixture();
    const { orderId } = await createReleasedOrder(setup);
    const now = new Date().toISOString();
    const lotId = `v23-lot-${setup.suffix}`;
    const receiptId = `v23-receipt-${setup.suffix}`;
    database.prepare(`INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,status,created_at)
      VALUES(?,?,?,'PRODUCTION_RECEIPT',?,'AVAILABLE',?)`).run(lotId, setup.productId, `LOT-${setup.suffix}`, receiptId, now);
    database.prepare(`INSERT INTO production_receipts(id,receipt_no,production_order_id,product_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,1,'CONFIRMED','2026-11-01','','user-admin',?,?)`)
      .run(receiptId, `V23-PR-${setup.suffix}`, orderId, setup.productId, setup.warehouseId, now, now);
    database.prepare(`INSERT INTO tracked_source_allocations(id,source_type,source_id,source_item_id,product_id,lot_id,quantity,posted,reversed,created_at)
      VALUES(?,'PRODUCTION_RECEIPT',?,?,?,?,1,1,0,?)`).run(`v23-alloc-${setup.suffix}`, receiptId, receiptId, setup.productId, lotId, now);

    const noReason = await api('POST', `/api/production-receipts/${receiptId}/nonconforming`, adminAuth, {});
    assert.equal(noReason.status, 400, `a nonconforming mark without a reason must be refused: ${JSON.stringify(noReason.data)}`);

    const marked = await api('POST', `/api/production-receipts/${receiptId}/nonconforming`, adminAuth, { reason: '外观不合格' });
    assert.equal(marked.status, 200, JSON.stringify(marked.data));
    assert.equal(marked.data.heldIdentities, 1);
    const lot = database.prepare('SELECT status FROM inventory_lots WHERE id=?').get(lotId);
    assert.equal(lot.status, 'HOLD', 'the nonconforming lot must be isolated by a HOLD');
  });
});

describe('V23 operation transfer and byproduct', () => {
  test('a scan transfer may not exceed the released quantity of the source operation', async () => {
    const setup = setupFixture();
    const { orderId, order } = await createReleasedOrder(setup);
    const operationId = order.operationPlan[0].id;
    // The material must be issued before the first operation can report: the
    // available input of the first operation is the supported material.
    const issue = await api('POST', '/api/production-material-issues', adminAuth, {
      productionOrderId: orderId, warehouseId: setup.warehouseId,
      items: [{ requirementLineId: order.items[0].id, productId: setup.componentId, issueQuantity: 20 }],
    });
    assert.equal(issue.status, 201, JSON.stringify(issue.data));
    const issueConfirm = await api('POST', `/api/production-material-issues/${issue.data.id}/confirm`, adminAuth, {}, `v23-issue-${setup.suffix}`);
    assert.equal(issueConfirm.status, 200, JSON.stringify(issueConfirm.data));

    const report = await api('POST', '/api/manufacturing/operation-reports', adminAuth, {
      productionOrderId: orderId, productionOperationId: operationId, goodQuantity: 2,
    });
    assert.equal(report.status, 201, JSON.stringify(report.data));
    const confirm = await api('POST', `/api/manufacturing/operation-reports/${report.data.id}/confirm`, adminAuth, {});
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));

    const targetOperationId = order.operationPlan[1].id;
    const over = await api('POST', '/api/production-scan/transfer', adminAuth, {
      orderToken: order.order_no, sourceOperationToken: operationId, targetOperationToken: targetOperationId, quantity: 5,
    });
    assert.equal(over.status, 409, `a transfer above the released quantity must be refused: ${JSON.stringify(over.data)}`);

    const same = await api('POST', '/api/production-scan/transfer', adminAuth, {
      orderToken: order.order_no, sourceOperationToken: operationId, targetOperationToken: operationId, quantity: 1,
    });
    assert.equal(same.status, 400, `the source and the target operation must differ: ${JSON.stringify(same.data)}`);
  });

  test('a byproduct receipt confirms into stock', async () => {
    const setup = setupFixture();
    const { orderId } = await createReleasedOrder(setup);
    const byproductProductId = `v23-byproduct-${setup.suffix}`;
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at)
      VALUES(?,?,?,'半成品','件',0,0,1,0,?,?)`).run(byproductProductId, `V23-BY-${setup.suffix}`, 'V23 副产品', now, now);

    const created = await api('POST', '/api/production-byproducts', adminAuth, {
      productionOrderId: orderId, productId: byproductProductId, plannedQuantity: 5,
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const receipt = await api('POST', '/api/production-byproduct-receipts', adminAuth, {
      byproductId: created.data.id, warehouseId: setup.warehouseId, quantity: 2,
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));

    const confirmed = await api('POST', `/api/production-byproduct-receipts/${receipt.data.id}/confirm`, adminAuth, {}, 'v23-byproduct-confirm-1');
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const stock = database.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(setup.warehouseId, byproductProductId);
    assert.equal(Number(stock?.quantity), 2, `the confirmed byproduct receipt must be in stock; rows=${JSON.stringify(database.prepare('SELECT warehouse_id,product_id,quantity,position_key FROM inventory').all().filter((r) => r.product_id === byproductProductId))}`);

    const byproducts = await api('GET', `/api/production-byproducts?orderId=${orderId}`, adminAuth);
    assert.equal(byproducts.status, 200);
    assert.equal(Number(byproducts.data.byproducts[0].actualQuantity ?? byproducts.data.byproducts[0].actual_quantity), 2,
      `the byproduct actual quantity must reflect the confirmed receipt: ${JSON.stringify(byproducts.data.byproducts[0])}`);
  });
});
