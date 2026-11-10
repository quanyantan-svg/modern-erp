// M1C-G07 execution-readiness — same-source SQLite HTTP setup proof.
// This calls the exact builder/fixed scenarios used by the MySQL gate. SQLite
// proves setup reachability only; it does not prove MySQL concurrency.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { buildM1CoreG07HttpFixtures } from './test-support/m1-core-g07-http-fixture-builder.js';
import {
  computeM1CoreG07FixtureDigest,
  M1_CORE_G07_FIXED_FIXTURE_DIGEST,
  M1_CORE_G07_FIXED_SCENARIOS,
  resolveRoute,
} from './test-support/m1-core-g07-fixtures.js';
import { changeValuationMethod, receiveValue } from './modules/financial-inventory.js';
import { deriveQualityState } from './modules/quality-gates.js';
import { postCanonicalTrackedLeg } from './modules/traceability-quality.js';

function scalar(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.value || 0);
}

describe('M1C-G07 same-source SQLite HTTP setup', () => {
  let fx;
  let manifest;

  before(async () => {
    fx = await createProcurementFixture('modern-erp-m1c-g07-same-source-');
    manifest = await buildM1CoreG07HttpFixtures({
      applications: { A: fx.baseUrl, B: fx.baseUrl },
      subjectTokens: {
        admin: fx.tokens.admin, creator: fx.tokens.sales, approver: fx.tokens.reviewer,
        warehouse: fx.tokens.warehouse, outsourcing: fx.tokens.outsourcing,
        receiving: fx.tokens.outsourcingReceiving,
      },
      request: async (_baseUrl, step) => {
        if (step.method === 'GET') assert.equal(step.body, undefined, `${step.path}: GET must not carry a body`);
        return fx.request(step.method, step.path, step.token, step.body, step.headers);
      },
      admitTechnicalL2: async ({ prerequisite, input }) => {
        assert.equal(prerequisite, 'SOURCE_INVENTORY_SEED');
        const transaction = fx.db.prepare("SELECT id FROM inventory_transactions WHERE source_type='OTHER_RECEIPT' AND source_id=? AND direction='IN'").get(input.sourceId);
        assert.ok(transaction?.id, 'physical source inventory must already exist through production HTTP');
        postCanonicalTrackedLeg(fx.db, {
          transactionId: transaction.id, sourceType: 'OTHER_RECEIPT', sourceId: input.sourceId,
          sourceItemId: input.sourceId, productId: input.productId, warehouseId: input.warehouseId,
          lotId: input.lotId, serialId: null, quantity: input.quantity, direction: 'IN', businessDate: input.businessDate,
        });
        changeValuationMethod(fx.db, input.productId, 'LOT_SPECIFIC_POOL');
        receiveValue(fx.db, {
          ...input, serialId: null, movementType: 'G07_SOURCE_INVENTORY_L2', sourceType: 'OTHER_RECEIPT',
          sourceItemId: input.sourceId, inventoryTransactionId: transaction.id, valuationBasis: 'G07_DISPOSABLE_L2',
        });
        const balance = fx.db.prepare('SELECT quantity,value_cents FROM inventory_valuation_balances WHERE product_id=? AND warehouse_id=? AND lot_id=?').get(input.productId, input.warehouseId, input.lotId);
        return Object.freeze({ prerequisite, admitted: true, quantity: Number(balance.quantity), valueCents: Number(balance.value_cents), lotId: input.lotId, sourceId: input.sourceId });
      },
    });
  });

  after(async () => { await fx?.close(); });

  test('CR-01: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-01'].setup;
    const itemId = s.poGet.order.items[0].id;
    assert.equal(s.poGet.order.status, 'APPROVED');
    assert.equal(scalar(fx.db, 'SELECT quantity value FROM purchase_order_items WHERE id=?', itemId), 10);
    assert.equal(scalar(fx.db, 'SELECT planned_quantity value FROM purchase_order_delivery_schedules WHERE id=? AND order_item_id=?', s.schedule.id, itemId), 10);
    assert.equal(scalar(fx.db, 'SELECT COUNT(*) value FROM receipt_notice_item_sources WHERE purchase_order_item_id=?', itemId), 0);
  });

  test('CR-02: approved fixed IQC steps pass real production SQLite HTTP before receipt confirm', async () => {
    const s = manifest.scenarios['CR-02'].setup;
    const receiptId = s.convert.receipts[0].id;
    const receipt = fx.db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(receiptId);
    assert.deepEqual({ status: receipt.status, quantity: scalar(fx.db, 'SELECT SUM(quantity) value FROM purchase_receipt_items WHERE receipt_id=?', receiptId) }, { status: 'DRAFT', quantity: 10 });
    assert.equal(scalar(fx.db, 'SELECT converted_quantity value FROM receipt_notice_item_sources WHERE id=?', s.noticeGet.receiptNotice.items[0].sources[0].id), 10);

    const active = M1_CORE_G07_FIXED_SCENARIOS.find((scenario) => scenario.id === 'CR-02');
    const [createStep, completeStep] = active.setup.slice(-2);
    assert.equal(computeM1CoreG07FixtureDigest(), M1_CORE_G07_FIXED_FIXTURE_DIGEST);
    // 2026-11-10：委外流转改为精确动作、用料快照前置到 DRAFT 阶段后，固定场景必须沿新合同重写，
    // 冻结摘要随之重新计算；该重新冻结待业务所有者显式确认。
    assert.equal(M1_CORE_G07_FIXED_FIXTURE_DIGEST, 'aa024bd56ae4eccd53242171f46bbd741bd1586f986d7d3ce92a8f5a53b8019f');
    assert.deepEqual(active.setup.map((step) => step.id).slice(-4), ['noticeGet', 'convert', 'iqc', 'iqcComplete']);
    assert.deepEqual(createStep.body, { purchase_receipt_id: { $ref: 'setup.convert.receipts.0.id' } });
    assert.deepEqual(completeStep.body, {
      result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0,
    });

    const createTrace = manifest.setupTrace.find((step) => step.scenario === 'CR-02' && step.stepId === 'iqc');
    const completeTrace = manifest.setupTrace.find((step) => step.scenario === 'CR-02' && step.stepId === 'iqcComplete');
    assert.deepEqual({ status: createTrace.status, subject: createTrace.subject, method: createTrace.method, path: createTrace.path },
      { status: 201, subject: 'warehouse', method: 'POST', path: '/api/iqc' });
    assert.deepEqual({ status: completeTrace.status, subject: completeTrace.subject, method: completeTrace.method },
      { status: 200, subject: 'warehouse', method: 'POST' });
    assert.equal(completeTrace.path, `/api/iqc/${s.iqc.id}/complete`);
    assert.deepEqual(s.iqcComplete, { ok: true, result: 'PASS' });
    const fetched = await fx.request('GET', `/api/iqc/${s.iqc.id}`, fx.tokens.warehouse);
    assert.equal(fetched.status, 200, JSON.stringify(fetched.data));
    assert.equal(fetched.data.inspection.purchase_receipt_id, receiptId);
    assert.equal(deriveQualityState(fx.db, 'IQC', receiptId).code, 'PASS');

    const confirmStep = active.raceRequests[0];
    const confirmPath = resolveRoute(confirmStep.route, { setup: s });
    const confirmed = await fx.request(confirmStep.method, confirmPath, fx.tokens[confirmStep.subject], confirmStep.body, confirmStep.headers);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.deepEqual(confirmed.data, { ok: true });
    assert.equal(fx.db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(receiptId).status, 'CONFIRMED');
  });

  test('CR-03: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-03'].setup;
    const receipt = fx.db.prepare('SELECT business_status,quantity,source_notice_id,processing_po_id FROM outsourcing_receipts WHERE id=?').get(s.receipt.id);
    assert.deepEqual({ status: receipt.business_status, quantity: Number(receipt.quantity), notice: receipt.source_notice_id, po: receipt.processing_po_id },
      { status: 'PENDING_INSPECTION', quantity: 4, notice: s.notice.id, po: s.po.id });
    assert.equal(fx.db.prepare('SELECT result FROM iqc_inspections WHERE id=?').get(s.iqc.id).result, 'PASS');
    assert.equal(scalar(fx.db, "SELECT available_quantity value FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key='NONE'", s.orderGet.materials[0].id), 10);
  });

  for (const id of ['CR-04', 'CR-05']) {
    test(`${id}: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS`, () => {
      const s = manifest.scenarios[id].setup;
      assert.equal(s.orderGet.outsourcingOrder.status, 'RELEASED');
      assert.equal(scalar(fx.db, "SELECT COALESCE(SUM(quantity),0) value FROM inventory WHERE product_id=? AND warehouse_id='warehouse-001'", s.material.id), 10);
      assert.equal(scalar(fx.db, 'SELECT COALESCE(SUM(available_quantity),0) value FROM outsourcing_wip_identity_balances WHERE material_list_id=?', s.orderGet.materials[0].id), 0);
      assert.equal(scalar(fx.db, "SELECT quantity value FROM inventory_valuation_balances WHERE product_id=? AND warehouse_id='warehouse-001'", s.material.id), 10);
    });
  }

  test('CR-06: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-06'].setup;
    assert.equal(s.orderGet.outsourcingOrder.status, 'RELEASED');
    assert.equal(scalar(fx.db, "SELECT available_quantity value FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key='NONE'", s.orderGet.materials[0].id), 10);
    assert.equal(scalar(fx.db, "SELECT COALESCE(SUM(quantity),0) value FROM inventory WHERE product_id=? AND warehouse_id='warehouse-001'", s.material.id), 0);
  });

  test('CR-07: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-07'].setup;
    assert.notEqual(s.receiptA.id, s.receiptB.id);
    assert.equal(scalar(fx.db, "SELECT available_quantity value FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key='NONE'", s.orderGet.materials[0].id), 6);
    assert.equal(scalar(fx.db, "SELECT COUNT(*) value FROM outsourcing_receipts WHERE id IN (?,?) AND business_status='PENDING_INSPECTION'", s.receiptA.id, s.receiptB.id), 2);
    assert.equal(scalar(fx.db, "SELECT COUNT(*) value FROM iqc_inspections WHERE id IN (?,?) AND result='PASS'", s.iqcA.id, s.iqcB.id), 2);
  });

  test('CR-08: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-08'].setup;
    const balance = fx.db.prepare('SELECT identity_key,available_quantity FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(s.orderGet.materials[0].id);
    assert.deepEqual({ identity: balance.identity_key, quantity: Number(balance.available_quantity) }, { identity: `LOT:${s.lot.id}`, quantity: 1 });
    assert.equal(fx.db.prepare('SELECT result FROM iqc_inspections WHERE id=?').get(s.iqc.id).result, 'PASS');
    assert.equal(fx.db.prepare('SELECT source_notice_id FROM outsourcing_receipts WHERE id=?').get(s.receipt.id).source_notice_id, s.notice.id);
  });

  test('CR-09: FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS', () => {
    const s = manifest.scenarios['CR-09'].setup;
    assert.equal(s.release.status, 'RELEASED');
    assert.equal(scalar(fx.db, 'SELECT COUNT(*) value FROM purchase_orders WHERE source_outsourcing_order_id=?', s.order.id), 0);
    assert.equal(scalar(fx.db, 'SELECT order_quantity value FROM outsourcing_orders WHERE id=?', s.order.id), 10);
  });
});
