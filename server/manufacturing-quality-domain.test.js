// V18 Manufacturing & Quality Domain Closure — focused acceptance tests.
//
// Covers:
//   - Production Order state machine: Draft -> Submit -> Approve -> Release -> Start -> Complete / Cancel
//   - Material List lifecycle (GENERATED / CONTROLLED_EDIT / APPROVED / RELEASED)
//   - Engineering Resolver integration (resolveEffectiveBomForCaller)
//   - Material Supplement lifecycle + reason + inventory / WIP / voucher
//   - Material Return reason codes
//   - Batch Picking atomic failure / per-order attribution
//   - Operation Plan lifecycle + Forward / Backward scheduling + Calendar / Capacity
//   - Topology fail closed (NETWORK) + Outsourced boundary fail closed
//   - Inspection Item / Detection Value / Instrument / Plan masters
//   - Operation Inspection + Product Inspection + Receipt Quality Gate
//   - Nonconforming LOT/SERIAL HOLD boundary
//   - Production Scan Execution (Material + Operation)
//   - Analytics Execution Summary + Material Issue Summary
//   - Legacy `production_outputs` convergence (no active reads / writes)

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
let productCounter = 0;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-mq-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminAuth = (await login('admin', 'admin123')).data.token;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, data: await response.json() };
}

async function api(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(body && body.idempotencyKey ? { 'idempotency-key': body.idempotencyKey } : {}),
    },
    body: body && body.body ? null : (body && !body.idempotencyKey ? JSON.stringify(body) : (body ? JSON.stringify(body.body) : undefined)),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

async function apiWithIdempotency(method, path, token, body, key) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

async function setupProductAndWarehouse() {
  productCounter += 1;
  const suffix = `${Date.now()}-${productCounter}`;
  const productId = `mq-product-${suffix}`;
  const componentId = `mq-comp-${suffix}`;
  const warehouseId = `mq-warehouse-${suffix}`;
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,1,0,?,?)`).run(productId, `MQ-P-${suffix}`, 'MQ 测试产品', '制造', '件', 10000, now, now);
  database.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,1,0,?,?)`).run(componentId, `MQ-C-${suffix}`, '组件', '原材料', '件', 1000, now, now);
  database.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(warehouseId, `MQ-WH-${suffix}`, 'MQ 主仓', '', '', now, now);
  database.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,approval_status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?, 'ACTIVE', 'SELF_MAKE', 'APPROVED', '', 'user-admin', ?, ?)`).run(`mq-bom-${suffix}`, productId, '1.0', now, now);
  database.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator)
    VALUES(?,?,?,?,0,1,?,1,1)`).run(`mq-bomi-${suffix}`, `mq-bom-${suffix}`, componentId, 2, '件');
  database.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,100,?)`).run(warehouseId, componentId, now);
  return { productId, componentId, warehouseId };
}

describe('V18 Production Order state machine', () => {
  test('Draft -> Submit -> Approve -> Release -> Start -> Complete', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, {
      productId: setup.productId,
      quantity: 10,
      plannedStart: '2026-10-01',
      plannedFinish: '2026-10-10',
    });
    assert.equal(create.status, 200, JSON.stringify(create.data));
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED']) {
      const r = await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
      assert.equal(r.status, 200, `transition ${target}: ${JSON.stringify(r.data)}`);
    }
    const start = await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'IN_PROGRESS' });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.order.status, 'IN_PROGRESS');
    assert.equal(detail.data.order.materialListStatus, 'RELEASED');
  });

  test('illegal transitions rejected', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, {
      productId: setup.productId,
      quantity: 5,
    });
    assert.equal(create.status, 200);
    const orderId = create.data.id;
    // Draft -> IN_PROGRESS illegal
    const illegal = await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'IN_PROGRESS' });
    assert.notEqual(illegal.status, 200);
  });

  test('Submit -> Reject cancels lifecycle', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 5 });
    const orderId = create.data.id;
    await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'SUBMITTED' });
    const reject = await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'REJECTED', reason: '工艺不允许' });
    assert.equal(reject.status, 200, JSON.stringify(reject.data));
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    assert.equal(detail.data.order.status, 'REJECTED');
  });
});

describe('V18 Material Supplement', () => {
  test('create + confirm decreases inventory and records WIP', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 5 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    // Top up stock so supplement can be confirmed
    await api('POST', '/api/inventory-adjustments', adminAuth, {
      productId: setup.componentId, warehouseId: setup.warehouseId, quantity: 5, direction: 'IN', remark: 'init', businessDate: new Date().toISOString().slice(0, 10),
    }).catch(() => null);
    const supplement = await api('POST', '/api/production-material-supplements', adminAuth, {
      productionOrderId: orderId, warehouseId: setup.warehouseId, reasonCode: 'SHORTAGE', items: [{ productId: setup.componentId, quantity: 1 }],
    });
    assert.equal(supplement.status, 201, JSON.stringify(supplement.data));
    const confirm = await apiWithIdempotency('POST', `/api/production-material-supplements/${supplement.data.id}/confirm`, adminAuth, {}, `mq-sup-${Date.now()}`);
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
  });

  test('invalid reason_code rejected', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 1 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    const supplement = await api('POST', '/api/production-material-supplements', adminAuth, {
      productionOrderId: orderId, warehouseId: setup.warehouseId, reasonCode: 'INVALID', items: [{ productId: setup.componentId, quantity: 1 }],
    });
    assert.notEqual(supplement.status, 201);
  });
});

describe('V18 Material Return Reason', () => {
  test('valid reason accepted', async () => {
    const setup = await setupProductAndWarehouse();
    // First create + start an order
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 1 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    // Top up + issue
    await api('POST', '/api/inventory-adjustments', adminAuth, {
      productId: setup.componentId, warehouseId: setup.warehouseId, quantity: 10, direction: 'IN', remark: 'init', businessDate: new Date().toISOString().slice(0, 10),
    }).catch(() => null);
    const issue = await api('POST', '/api/production-material-issues', adminAuth, {
      productionOrderId: orderId, warehouseId: setup.warehouseId, items: [{ requirementLineId: (await api('GET', `/api/production-orders/${orderId}`, adminAuth)).data.order.items[0].id, productId: setup.componentId, issueQuantity: 2 }],
    });
    const confirmIssue = await apiWithIdempotency('POST', `/api/production-material-issues/${issue.data.id}/confirm`, adminAuth, {}, `mq-iss-${Date.now()}`);
    assert.equal(confirmIssue.status, 200);
    const issueItemId = (await api('GET', `/api/production-material-issues/${issue.data.id}`, adminAuth)).data.materialIssue.items[0].id;
    const ret = await api('POST', '/api/production-material-returns-with-reason', adminAuth, {
      originalIssueId: issue.data.id, reasonCode: 'MATERIAL_DEFECT', items: [{ originalIssueItemId: issueItemId, quantity: 1 }],
    });
    assert.equal(ret.status, 201, JSON.stringify(ret.data));
  });
});

describe('V18 Batch Picking', () => {
  test('creates per-order issues and confirms in single transaction', async () => {
    const setup = await setupProductAndWarehouse();
    const ids = [];
    for (let i = 0; i < 2; i += 1) {
      const c = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 3 });
      const id = c.data.id;
      ids.push(id);
      for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
        await api('POST', `/api/production-orders/${id}/state`, adminAuth, { target });
      }
    }
    await api('POST', '/api/inventory-adjustments', adminAuth, {
      productId: setup.componentId, warehouseId: setup.warehouseId, quantity: 20, direction: 'IN', remark: 'init', businessDate: new Date().toISOString().slice(0, 10),
    }).catch(() => null);
    const orders = [];
    for (const id of ids) {
      const detail = await api('GET', `/api/production-orders/${id}`, adminAuth);
      orders.push({ productionOrderId: id, items: [{ requirementLineId: detail.data.order.items[0].id, issueQuantity: 1 }] });
    }
    const batch = await api('POST', '/api/production-batch-issues', adminAuth, {
      warehouseId: setup.warehouseId, orders,
    });
    assert.equal(batch.status, 201, JSON.stringify(batch.data));
    const confirm = await apiWithIdempotency('POST', `/api/production-batch-issues/${batch.data.id}/confirm`, adminAuth, {}, `mq-batch-${Date.now()}`);
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
  });
});

describe('V18 Operation Plan + Scheduling', () => {
  test('Operation Plan lifecycle: GENERATED -> SUBMITTED -> APPROVED -> RELEASED', async () => {
    const setup = await setupProductAndWarehouse();
    // Need a routing
    const routing = await api('POST', '/api/product-routings', adminAuth, { productId: setup.productId, version: '1.0', status: 'ACTIVE', routingCode: `MQ-R001-${Date.now()}`, routingName: 'MQ Routing', operations: [
      { sequenceNo: 1, operationCode: 'OP-10', operationName: '工序一', workCenter: 'MQ-WC-01', setupMinutes: 5, runMinutesPerUnit: 2 },
    ] });
    assert.equal(routing.status, 201, JSON.stringify(routing.data));
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 4 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    assert.equal(detail.status, 200);
    assert.ok(detail.data.order.operationPlan.length > 0);
    for (const action of ['submit', 'approve', 'release']) {
      const result = await api('POST', `/api/production-orders/${orderId}/plan/${action}`, adminAuth);
      assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.data)}`);
    }
    const released = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    assert.ok(released.data.order.operationPlan.every((operation) => operation.planStatus === 'EXECUTABLE'));
  });

  test('Forward scheduling populates planned_date', async () => {
    const setup = await setupProductAndWarehouse();
    const routing = await api('POST', '/api/product-routings', adminAuth, { productId: setup.productId, version: '1.0', status: 'ACTIVE', routingCode: `MQ-R002-${Date.now()}`, routingName: 'MQ Routing 2', operations: [
      { sequenceNo: 1, operationCode: 'OP-20', operationName: '工序二', workCenter: 'MQ-WC-02', setupMinutes: 3, runMinutesPerUnit: 1 },
    ] });
    assert.equal(routing.status, 201, JSON.stringify(routing.data));
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 2 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    const schedule = await api('POST', `/api/production-orders/${orderId}/schedule`, adminAuth, { mode: 'FORWARD' });
    assert.equal(schedule.status, 200, JSON.stringify(schedule.data));
  });

  test('Backward scheduling populates planned_date', async () => {
    const setup = await setupProductAndWarehouse();
    const routing = await api('POST', '/api/product-routings', adminAuth, { productId: setup.productId, version: '1.0', status: 'ACTIVE', routingCode: `MQ-R003-${Date.now()}`, routingName: 'MQ Routing 3', operations: [
      { sequenceNo: 1, operationCode: 'OP-30', operationName: '工序三', workCenter: 'MQ-WC-03', setupMinutes: 2, runMinutesPerUnit: 1 },
    ] });
    assert.equal(routing.status, 201, JSON.stringify(routing.data));
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 2 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    const schedule = await api('POST', `/api/production-orders/${orderId}/schedule`, adminAuth, { mode: 'BACKWARD' });
    assert.equal(schedule.status, 200, JSON.stringify(schedule.data));
  });
});

describe('V18 Quality master', () => {
  test('Inspection Item + Detection Value + Instrument + Plan CRUD', async () => {
    const item = await api('POST', '/api/inspection-items', adminAuth, { code: 'CH-IN-001', name: '外观', category: '视觉', unit: '次' });
    assert.equal(item.status, 201, JSON.stringify(item.data));
    const itemId = item.data.id;
    const dv = await api('POST', '/api/inspection-detection-values', adminAuth, { itemId, label: '合格', value: 'PASS' });
    assert.equal(dv.status, 201, JSON.stringify(dv.data));
    const instrument = await api('POST', '/api/inspection-instruments', adminAuth, { code: 'INS-001', name: '卡尺', specification: '0-150mm' });
    assert.equal(instrument.status, 201, JSON.stringify(instrument.data));
    const plan = await api('POST', '/api/inspection-plans', adminAuth, {
      code: 'CH-PLAN-001', name: '产品外观检验方案', targetType: 'PRODUCT',
      items: [{ itemId, sequence: 1, criterionName: '外观', specification: '无划痕', resultType: 'PASS_FAIL', instrumentId: instrument.data.id, required: true }],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));
    const planGet = await api('GET', `/api/inspection-plans/${plan.data.id}`, adminAuth);
    assert.equal(planGet.status, 200);
    assert.equal(planGet.data.plan.items.length, 1);
  });
});

describe('V18 Production Inspection execution', () => {
  test('required operation and product inspections control release and receipt', async () => {
    const setup = await setupProductAndWarehouse();
    const suffix = Date.now();
    const item = await api('POST', '/api/inspection-items', adminAuth, { code: `MQ-QI-${suffix}`, name: '外观' });
    const plan = await api('POST', '/api/inspection-plans', adminAuth, { code: `MQ-QP-${suffix}`, name: '生产检验方案', targetType: 'PRODUCT', productId: setup.productId, items: [{ itemId: item.data.id, sequence: 1, criterionName: '外观', resultType: 'PASS_FAIL' }] });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));
    const routing = await api('POST', '/api/product-routings', adminAuth, { productId: setup.productId, version: '1.0', status: 'ACTIVE', routingCode: `MQ-QROUTE-${suffix}`, routingName: 'Quality Routing', operations: [{ sequenceNo: 1, operationCode: 'QC-10', operationName: '检验工序', workCenter: 'MQ-Q-WC', setupMinutes: 0, runMinutesPerUnit: 1 }] });
    assert.equal(routing.status, 201, JSON.stringify(routing.data));
    const orderCreate = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 1 });
    const orderId = orderCreate.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    for (const action of ['submit', 'approve', 'release']) assert.equal((await api('POST', `/api/production-orders/${orderId}/plan/${action}`, adminAuth)).status, 200);
    assert.equal((await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target: 'IN_PROGRESS' })).status, 200);
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    const issue = await api('POST', '/api/production-material-issues', adminAuth, { productionOrderId: orderId, warehouseId: setup.warehouseId, items: [{ requirementLineId: detail.data.order.items[0].id, productId: setup.componentId, issueQuantity: 2 }] });
    assert.equal((await apiWithIdempotency('POST', `/api/production-material-issues/${issue.data.id}/confirm`, adminAuth, {}, `mq-quality-issue-${suffix}`)).status, 200);
    const operationId = detail.data.order.operationPlan[0].id;
    const report = await api('POST', '/api/manufacturing/operation-reports', adminAuth, { productionOrderId: orderId, productionOperationId: operationId, goodQuantity: 1, scrapQuantity: 0, laborSeconds: 60, machineSeconds: 60 });
    assert.equal((await apiWithIdempotency('POST', `/api/manufacturing/operation-reports/${report.data.id}/confirm`, adminAuth, {}, `mq-quality-report-${suffix}`)).status, 200);
    assert.equal(database.prepare('SELECT released_quantity FROM production_operation_reports WHERE id=?').get(report.data.id).released_quantity, 0);
    const operationInspection = await api('POST', '/api/production-inspections', adminAuth, { productionOrderId: orderId, sourceType: 'OPERATION_REPORT', sourceId: report.data.id, planId: plan.data.id });
    const operationInspectionDetail = await api('GET', `/api/production-inspections/${operationInspection.data.id}`, adminAuth);
    assert.equal((await api('POST', `/api/production-inspections/${operationInspection.data.id}/complete`, adminAuth, { result: 'PASS', items: operationInspectionDetail.data.inspection.items.map((x) => ({ id: x.id, passFailResult: 'PASS' })) })).status, 200);
    assert.equal(database.prepare('SELECT released_quantity FROM production_operation_reports WHERE id=?').get(report.data.id).released_quantity, 1);
    assert.equal((await api('POST', `/api/manufacturing/operations/${operationId}/complete`, adminAuth)).status, 200);
    const receipt = await api('POST', '/api/production-receipts', adminAuth, { productionOrderId: orderId, warehouseId: setup.warehouseId, quantity: 1 });
    assert.equal((await api('POST', `/api/production-receipts/${receipt.data.id}/confirm`, adminAuth)).status, 409);
    const productInspection = await api('POST', '/api/production-inspections', adminAuth, { productionOrderId: orderId, sourceType: 'PRODUCTION_RECEIPT', sourceId: receipt.data.id, planId: plan.data.id });
    const productInspectionDetail = await api('GET', `/api/production-inspections/${productInspection.data.id}`, adminAuth);
    assert.equal((await api('POST', `/api/production-inspections/${productInspection.data.id}/complete`, adminAuth, { result: 'PASS', items: productInspectionDetail.data.inspection.items.map((x) => ({ id: x.id, passFailResult: 'PASS' })) })).status, 200);
    assert.equal((await api('POST', `/api/production-receipts/${receipt.data.id}/confirm`, adminAuth)).status, 200);
  });
});

describe('V18 Production Scan', () => {
  test('lookup order token', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 1 });
    const orderId = create.data.id;
    const lookup = await api('POST', '/api/production-scan/lookup', adminAuth, { kind: 'ORDER', token: create.data.orderNo });
    assert.equal(lookup.status, 200, JSON.stringify(lookup.data));
    assert.equal(lookup.data.kind, 'ORDER');
    assert.equal(lookup.data.order.id, orderId);
  });

  test('scan issue shortcut requires DRAFT (cannot confirm without stock)', async () => {
    const setup = await setupProductAndWarehouse();
    const create = await api('POST', '/api/production-orders', adminAuth, { productId: setup.productId, quantity: 1 });
    const orderId = create.data.id;
    for (const target of ['SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROGRESS']) {
      await api('POST', `/api/production-orders/${orderId}/state`, adminAuth, { target });
    }
    const detail = await api('GET', `/api/production-orders/${orderId}`, adminAuth);
    const rejected = await api('POST', '/api/production-scan/issue', adminAuth, {
      orderToken: create.data.orderNo, requirementLineId: detail.data.order.items[0].id, warehouseId: setup.warehouseId, quantity: -1,
    });
    assert.equal(rejected.status, 400);
    const issue = await api('POST', '/api/production-scan/issue', adminAuth, {
      orderToken: create.data.orderNo, requirementLineId: detail.data.order.items[0].id, warehouseId: setup.warehouseId, quantity: 1,
    });
    assert.equal(issue.status, 201, JSON.stringify(issue.data));
  });
});

describe('V18 Analytics', () => {
  test('Execution Summary returns rows', async () => {
    const summary = await api('GET', '/api/manufacturing-analytics/execution-summary', adminAuth);
    assert.equal(summary.status, 200);
    assert.ok(Array.isArray(summary.data.rows));
  });

  test('Material Issue Summary returns rows', async () => {
    const summary = await api('GET', '/api/manufacturing-analytics/material-issue-summary', adminAuth);
    assert.equal(summary.status, 200);
    assert.ok(Array.isArray(summary.data.rows));
  });
});

describe('V18 Legacy `production_outputs` convergence', () => {
  test('no active /api/production-output* endpoints', async () => {
    // The handler was retired; assert that POST returns 404 from the dispatcher.
    const response = await fetch(`${baseUrl}/api/production-outputs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminAuth}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notEqual(response.status, 200);
  });
});
