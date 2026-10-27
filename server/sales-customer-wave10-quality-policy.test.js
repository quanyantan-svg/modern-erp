// Wave 10 Gate B — the Sales Delivery OQC quality-policy fixture contract.
//
// solution.md §37.46, document.md §"Wave 10 Gate B OQC quality-policy fixture
// Requirement (2026-10-26)", clauses W10-QCP-R01 .. W10-QCP-R06.
//
// WHAT THIS FILE PROVES. The Sales Delivery OQC gate is a fail-closed
// production prerequisite: with no applicable Quality Control Point the
// canonical resolution freezes `inspection_required = 1` and the real
// confirmation route refuses with HTTP 409. The Wave 10 acceptance fixture
// therefore installs one real, effective and auditable `SALES_DELIVERY`
// control point through the canonical writer, so the acceptance suites can
// traverse the canonical Delivery → Finance → Credit chain. These regressions
// prove that the fixture fact is installed through the canonical path, that
// the production fail-safe still refuses when the fact is absent, and that the
// waiver is policy-driven rather than a constant.
//
// EVIDENCE LEVEL. Every assertion runs on a single disposable SQLite
// connection in production mode — the same initialization mode as the
// protected Wave 10 MySQL target: no demo seed, therefore no shipped global
// `qcp-global-outgoing-v1` default and an empty `quality_control_points`
// table before the fixture installs its own control point. This file is NOT
// real-MySQL row-contention evidence: M-R03, M-R09 and the W10-BUSINESS-MATRIX
// cases stay BLOCKED for the protected Gate B campaign and must never be
// reported as PASS from this file.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createApp } from './app.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import { assertQualityGate, deriveQualityState } from './modules/quality-gates.js';
import { resolveQualityPolicy } from './modules/traceability-quality.js';
import {
  productionOrderBody, readWave10QualityPolicy, seedWave10AcceptanceBase, seedWave10QualityPolicy,
  wave10BusinessDate, wave10DeliveryRequest, wave10HttpLogin, wave10HttpRequest,
  W10_QUALITY_POLICY_CODE, W10_QUALITY_POLICY_REASON,
} from './test-utils/wave10-mysql-acceptance-fixture.js';
import { createTempDb } from './test-utils/temp-db.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverAppSource = readFileSync(join(here, 'app.js'), 'utf8');
const confirmSalesDeliverySource = serverAppSource.slice(
  serverAppSource.indexOf('export async function confirmSalesDelivery('),
  serverAppSource.indexOf('function listSalesReturns('),
);

const PRODUCT_ID = 'w10-race-product';
const CREDIT_OPTIONS = Object.freeze({ aggregateLimit: 1000000, salespersonLimit: 200000 });

// Every scenario gets its own disposable database in production mode, the
// same initialization mode as the protected Wave 10 MySQL target.
async function withScenario(label, options, body) {
  const handle = createTempDb({ label, production: true });
  try {
    const db = handle.db;
    migrateSalesCustomerDomain(db);
    await seedWave10AcceptanceBase(db, { ...CREDIT_OPTIONS, ...options });
    const app = createApp(db, {});
    const creator = await wave10HttpLogin(app, { username: 'w10-race-creator' });
    const approver = await wave10HttpLogin(app, { username: 'w10-race-approver' });
    return await body({ db, app, creator, approver });
  } finally {
    handle.cleanup();
  }
}

// The canonical Sales Order lifecycle, produced by production handlers only.
async function canonicalApprovedOrder({ db, app, creator, approver }, key) {
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-orders', token: creator, body: productionOrderBody(),
    headers: { 'idempotency-key': `${key}-create` },
  });
  assert.equal(created.statusCode, 201, `canonical order creation failed: ${JSON.stringify(created.body)}`);
  const orderId = created.body?.id;
  assert.ok(orderId, 'the canonical order creation must return the order id');
  const submitted = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-orders/${orderId}/submit`, token: creator, body: {},
    headers: { 'idempotency-key': `${key}-submit` },
  });
  assert.equal(submitted.statusCode, 200, `canonical order submission failed: ${JSON.stringify(submitted.body)}`);
  const approved = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-orders/${orderId}/approve`, token: approver, body: {},
    headers: { 'idempotency-key': `${key}-approve` },
  });
  assert.equal(approved.statusCode, 200, `canonical order approval failed: ${JSON.stringify(approved.body)}`);
  const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no,id LIMIT 1').get(orderId).id;
  return { orderId, orderItemId };
}

// The canonical Delivery, created through the real production HTTP route.
async function canonicalDelivery({ app, approver, db }, { orderId, orderItemId, billingMode = 'LEGACY_DIRECT', key }) {
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-deliveries', token: approver,
    body: wave10DeliveryRequest({ orderId, orderItemId, billingMode }),
  });
  assert.equal(created.statusCode, 201, `canonical delivery creation failed: ${JSON.stringify(created.body)}`);
  const deliveryId = created.body?.id;
  assert.ok(deliveryId, 'the canonical delivery creation must return the delivery id');
  const lines = db.prepare('SELECT id,product_id FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no,id').all(deliveryId);
  assert.equal(lines.length, 1, 'the canonical delivery must produce exactly one delivery line');
  return { deliveryId, deliveryItemId: lines[0].id, productId: lines[0].product_id };
}

function frozenSnapshot(db, deliveryId) {
  const rows = db.prepare('SELECT * FROM logistics_quality_policy_snapshots WHERE source_type=? AND source_id=? ORDER BY id')
    .all('SALES_DELIVERY', deliveryId);
  assert.equal(rows.length, 1, `the Delivery must carry exactly one frozen policy snapshot: ${JSON.stringify(rows)}`);
  return rows[0];
}

function countRows(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0);
}

// T01 — negative: with no applicable quality-policy fact the real
// confirmation route still refuses with the production refusal.
test('W10-QCP-T01 — missing OQC evidence keeps the production fail-safe refusal', async () => {
  await withScenario('w10-qcp-t01', { qualityPolicy: false }, async (context) => {
    const { db, app, approver } = context;

    // The missing-evidence condition is real: the shipped global default is
    // not seeded in production mode, so no control point applies at all.
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM quality_control_points'), 0,
      'the negative scenario must carry no quality control point');
    const unresolved = resolveQualityPolicy(db, 'SALES_DELIVERY', PRODUCT_ID, wave10BusinessDate());
    assert.equal(unresolved.inspectionRequired, true, 'the canonical resolution must fail safe');
    assert.equal(unresolved.qcpId, null, 'the canonical resolution must find no control point');
    assert.equal(unresolved.failSafe, true, 'the canonical resolution must be the fail-safe default');

    const order = await canonicalApprovedOrder(context, 'w10-qcp-t01');
    const delivery = await canonicalDelivery(context, {
      orderId: order.orderId, orderItemId: order.orderItemId, key: 'w10-qcp-t01',
    });

    // The canonical creation path froze a required policy on the actual line.
    const snapshot = frozenSnapshot(db, delivery.deliveryId);
    assert.equal(snapshot.source_type, 'SALES_DELIVERY');
    assert.equal(snapshot.source_id, delivery.deliveryId, 'the frozen snapshot must belong to the actual Delivery');
    assert.equal(snapshot.source_item_id, delivery.deliveryItemId, 'the frozen snapshot must belong to the actual Delivery line');
    assert.equal(snapshot.product_id, delivery.productId, 'the frozen snapshot must carry the actual product');
    assert.equal(Number(snapshot.inspection_required), 1, 'the frozen snapshot must require an inspection');
    assert.equal(snapshot.qcp_id, null, 'the frozen snapshot must reference no control point');
    assert.equal(snapshot.qcp_version, null, 'the frozen snapshot must carry no control point version');
    assert.equal(snapshot.waiver_reason, null, 'the frozen snapshot must carry no waiver reason');

    const state = deriveQualityState(db, 'OQC', delivery.deliveryId);
    assert.equal(state.code, 'NOT_INSPECTED', 'the missing evidence must leave the Delivery un-inspected');
    assert.equal(state.label, '未检验');

    // The refusal must be the production refusal produced by the production
    // quality gate, not a test-local status or message.
    let productionRefusal = null;
    try {
      assertQualityGate(db, 'OQC', delivery.deliveryId);
    } catch (error) {
      productionRefusal = { status: error.status, message: error.message };
    }
    assert.ok(productionRefusal, 'the production quality gate must refuse the un-inspected Delivery');
    assert.equal(productionRefusal.status, 409, 'the production refusal must be HTTP 409');
    assert.ok(productionRefusal.message.includes('质量门禁未通过：未检验'),
      `the production refusal must carry the quality-gate text: ${productionRefusal.message}`);

    const confirmed = await wave10HttpRequest(app, {
      method: 'POST', path: `/api/sales-deliveries/${delivery.deliveryId}`, token: approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-qcp-t01-confirm' },
    });
    assert.equal(confirmed.statusCode, 409, `the real confirmation route must refuse: ${JSON.stringify(confirmed.body)}`);
    assert.equal(confirmed.body?.code, 'BUSINESS_RULE_BLOCKED', JSON.stringify(confirmed.body));
    assert.equal(confirmed.body?.message, productionRefusal.message,
      'the HTTP refusal must be the production quality-gate refusal');

    // The Delivery stays a draft and the refusal leaves no confirmation effect.
    const deliveryRow = db.prepare('SELECT status,confirmed_by,confirmed_at FROM sales_deliveries WHERE id=?').get(delivery.deliveryId);
    assert.equal(deliveryRow.status, 'DRAFT', 'the refused Delivery must stay a draft');
    assert.equal(deliveryRow.confirmed_by, null);
    assert.equal(deliveryRow.confirmed_at, null);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_transactions WHERE source_type=? AND source_id=?', 'SALES_DELIVERY', delivery.deliveryId), 0,
      'the refused confirmation must write no inventory transaction');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_valuation_movements WHERE source_type=? AND source_id=?', 'SALES_DELIVERY', delivery.deliveryId), 0,
      'the refused confirmation must write no valuation movement');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM account_receivables WHERE source_type=? AND source_id=?', 'SALES_DELIVERY', delivery.deliveryId), 0,
      'the refused confirmation must write no receivable');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM accounting_vouchers WHERE source_id=?', delivery.deliveryId), 0,
      'the refused confirmation must write no voucher');
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CONFIRM' AND entity_type='SALES_DELIVERY' AND entity_id=?", delivery.deliveryId), 0,
      'the refused confirmation must write no confirmation audit');
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM idempotency_records WHERE operation_type='SALES_DELIVERY_CONFIRM' AND document_id=?", delivery.deliveryId), 0,
      'the refused confirmation must write no confirmation idempotency record');
    // The legitimate creation audit survives the refusal.
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CREATE' AND entity_type='SALES_DELIVERY' AND entity_id=?", delivery.deliveryId), 1,
      'the legitimate creation audit must be preserved');
  });
});

// T02 — positive: the installed control point waives the gate and the real
// confirmation route succeeds with the canonical production effects.
test('W10-QCP-T02 — the installed quality policy waives the gate and the Delivery confirms', async () => {
  await withScenario('w10-qcp-t02', { qualityPolicy: true }, async (context) => {
    const { db, app, approver } = context;

    const qcp = readWave10QualityPolicy(db);
    assert.ok(qcp, 'the canonical test quality control point must be installed');
    assert.equal(qcp.code, W10_QUALITY_POLICY_CODE);
    assert.equal(qcp.operationType, 'SALES_DELIVERY');
    assert.equal(qcp.scope, 'PRODUCT');
    assert.equal(qcp.productId, PRODUCT_ID);
    assert.equal(qcp.active, true);
    assert.equal(qcp.inspectionRequired, false, 'the control point must waive the inspection');
    assert.equal(qcp.reason, W10_QUALITY_POLICY_REASON, 'the control point must carry the declared test-only reason');

    // The canonical resolution reads the installed control point.
    const resolved = resolveQualityPolicy(db, 'SALES_DELIVERY', PRODUCT_ID, wave10BusinessDate());
    assert.equal(resolved.inspectionRequired, false, 'the canonical resolution must waive the inspection');
    assert.equal(resolved.qcpId, qcp.id, 'the canonical resolution must read the installed control point');
    assert.equal(Number(resolved.version), qcp.version, 'the canonical resolution must read the installed version');
    assert.equal(resolved.waiverReason, W10_QUALITY_POLICY_REASON, 'the canonical resolution must read the declared reason');

    const order = await canonicalApprovedOrder(context, 'w10-qcp-t02');
    const delivery = await canonicalDelivery(context, {
      orderId: order.orderId, orderItemId: order.orderItemId, key: 'w10-qcp-t02',
    });

    // The frozen snapshot is policy-derived and matches the actual document.
    const snapshot = frozenSnapshot(db, delivery.deliveryId);
    assert.equal(snapshot.source_type, 'SALES_DELIVERY');
    assert.equal(snapshot.source_id, delivery.deliveryId, 'the frozen snapshot must belong to the actual Delivery');
    assert.equal(snapshot.source_item_id, delivery.deliveryItemId, 'the frozen snapshot must belong to the actual Delivery line');
    assert.equal(snapshot.product_id, delivery.productId, 'the frozen snapshot must carry the actual product');
    assert.equal(snapshot.qcp_id, qcp.id, 'the frozen snapshot must reference the installed control point');
    assert.equal(Number(snapshot.qcp_version), qcp.version, 'the frozen snapshot must carry the installed version');
    assert.equal(Number(snapshot.inspection_required), 0, 'the frozen snapshot must not require an inspection');
    assert.equal(snapshot.waiver_reason, W10_QUALITY_POLICY_REASON, 'the frozen snapshot must carry the declared waiver reason');
    assert.equal(deriveQualityState(db, 'OQC', delivery.deliveryId).code, 'WAIVED',
      'the installed policy must waive the Delivery gate');

    const confirmed = await wave10HttpRequest(app, {
      method: 'POST', path: `/api/sales-deliveries/${delivery.deliveryId}`, token: approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-qcp-t02-confirm' },
    });
    assert.equal(confirmed.statusCode, 200, `the real confirmation route must succeed: ${JSON.stringify(confirmed.body)}`);
    assert.equal(confirmed.body?.ok, true);

    const deliveryRow = db.prepare('SELECT status,confirmed_by,confirmed_at,total_cents FROM sales_deliveries WHERE id=?').get(delivery.deliveryId);
    assert.equal(deliveryRow.status, 'CONFIRMED', 'the confirmed Delivery must reach the confirmed status');
    assert.ok(deliveryRow.confirmed_by, 'the confirmed Delivery must stamp its confirmer');
    assert.ok(deliveryRow.confirmed_at, 'the confirmed Delivery must stamp its confirmation time');
    const totalCents = Number(deliveryRow.total_cents);
    assert.ok(totalCents > 0, 'the confirmed Delivery must carry an amount');

    // Canonical inventory effect: exactly one OUT transaction for the Delivery.
    const inventoryTransactions = db.prepare('SELECT * FROM inventory_transactions WHERE source_type=? AND source_id=?')
      .all('SALES_DELIVERY', delivery.deliveryId);
    assert.equal(inventoryTransactions.length, 1, 'the confirmation must write exactly one inventory transaction');
    assert.equal(inventoryTransactions[0].direction, 'OUT');
    assert.equal(Number(inventoryTransactions[0].quantity_change), 1, 'the OUT transaction must carry the issued quantity');

    // Canonical cost effect: the fixture product carries no valuation basis,
    // so the production writer issues a LEGACY_UNVALUED movement with no cost
    // and therefore writes no COGS voucher. The voucher cardinality is bound
    // to the issued cost, not to a constant.
    const valuationMovements = db.prepare('SELECT * FROM inventory_valuation_movements WHERE source_type=? AND source_id=?')
      .all('SALES_DELIVERY', delivery.deliveryId);
    assert.equal(valuationMovements.length, 1, 'the confirmation must write exactly one valuation movement');
    assert.equal(Number(valuationMovements[0].quantity_delta), -1);
    assert.equal(Number(valuationMovements[0].value_delta_cents), 0, 'the fixture product carries no issued cost');
    assert.equal(valuationMovements[0].valuation_basis, 'LEGACY_UNVALUED');
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id=?", delivery.deliveryId), 0,
      'a zero issued cost must write no COGS voucher');

    // Canonical Finance effect: the LEGACY_DIRECT recognition writes the
    // final unpaid receivable and its system voucher.
    const receivables = db.prepare('SELECT * FROM account_receivables WHERE source_type=? AND source_id=?')
      .all('SALES_DELIVERY', delivery.deliveryId);
    assert.equal(receivables.length, 1, 'the confirmation must write exactly one receivable');
    assert.equal(Number(receivables[0].amount_cents), totalCents, 'the receivable must carry the Delivery amount');
    assert.equal(Number(receivables[0].open_amount_cents), totalCents, 'the receivable must stay unpaid');
    assert.equal(receivables[0].item_class, 'SOURCE');
    assert.equal(receivables[0].item_kind, 'FINAL');
    assert.equal(receivables[0].status, 'PENDING');
    assert.equal(receivables[0].recognition_mode, 'DIRECT_BUSINESS_OPEN_ITEM');
    const vouchers = db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").all(delivery.deliveryId);
    assert.equal(vouchers.length, 1, 'the confirmation must write exactly one recognition voucher');
    assert.equal(vouchers[0].voucher_origin, 'SYSTEM');
    assert.equal(vouchers[0].status, 'POSTED');

    // Canonical audit and idempotency effects.
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CONFIRM' AND entity_type='SALES_DELIVERY' AND entity_id=?", delivery.deliveryId), 1,
      'the confirmation must write exactly one confirmation audit');
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CREATE' AND entity_type='SALES_DELIVERY' AND entity_id=?", delivery.deliveryId), 1,
      'the creation audit must remain the single creation audit');
    const idempotency = db.prepare("SELECT * FROM idempotency_records WHERE operation_type='SALES_DELIVERY_CONFIRM' AND document_id=?").all(delivery.deliveryId);
    assert.equal(idempotency.length, 1, 'the confirmation must write exactly one idempotency record');
    assert.equal(idempotency[0].status, 'SUCCEEDED');
  });
});

// T03 — the gate is genuinely consulted: the outcome is policy-driven, not a
// constant, and the production contract still owns the refusal.
test('W10-QCP-T03 — the waived outcome is policy-driven and the fail-safe default survives', async () => {
  await withScenario('w10-qcp-t03', { qualityPolicy: true }, async (context) => {
    const { db, app, approver } = context;

    const qcp = readWave10QualityPolicy(db);
    assert.ok(qcp, 'the canonical test quality control point must be installed');

    const firstOrder = await canonicalApprovedOrder(context, 'w10-qcp-t03-a');
    const firstDelivery = await canonicalDelivery(context, {
      orderId: firstOrder.orderId, orderItemId: firstOrder.orderItemId, key: 'w10-qcp-t03-a',
    });
    assert.equal(deriveQualityState(db, 'OQC', firstDelivery.deliveryId).code, 'WAIVED',
      'the legitimate control point must waive the Delivery gate');
    const frozenBefore = { ...frozenSnapshot(db, firstDelivery.deliveryId) };

    // Deactivating the control point ends the applicability for future
    // documents; it must not rewrite an already frozen snapshot.
    db.prepare('UPDATE quality_control_points SET active=0 WHERE id=?').run(qcp.id);
    const afterDeactivation = resolveQualityPolicy(db, 'SALES_DELIVERY', PRODUCT_ID, wave10BusinessDate());
    assert.equal(afterDeactivation.inspectionRequired, true,
      'a deactivated control point must fall back to the fail-safe default');
    assert.equal(afterDeactivation.qcpId, null, 'a deactivated control point must not resolve');
    assert.equal(afterDeactivation.failSafe, true, 'the fail-safe default must be restored');

    const frozenAfter = { ...frozenSnapshot(db, firstDelivery.deliveryId) };
    assert.deepEqual(frozenAfter, frozenBefore, 'the deactivated control point must not rewrite the frozen snapshot');
    assert.equal(deriveQualityState(db, 'OQC', firstDelivery.deliveryId).code, 'WAIVED',
      'the frozen snapshot must keep governing the already created Delivery');

    // A document created after the deactivation freezes a required policy and
    // is therefore not inspected.
    const secondOrder = await canonicalApprovedOrder(context, 'w10-qcp-t03-b');
    const secondDelivery = await canonicalDelivery(context, {
      orderId: secondOrder.orderId, orderItemId: secondOrder.orderItemId, key: 'w10-qcp-t03-b',
    });
    const secondSnapshot = frozenSnapshot(db, secondDelivery.deliveryId);
    assert.equal(Number(secondSnapshot.inspection_required), 1,
      'a document created without an applicable waiver must require an inspection');
    assert.equal(secondSnapshot.qcp_id, null, 'a document created without an applicable waiver must reference no control point');
    assert.equal(deriveQualityState(db, 'OQC', secondDelivery.deliveryId).code, 'NOT_INSPECTED',
      'a document without an applicable waiver must stay not inspected');

    // The production confirmation handler still owns the gate.
    assert.match(confirmSalesDeliverySource, /assertQualityGate\(db, ['"]OQC['"], deliveryId\)/,
      'the production Sales Delivery confirmation must still call the OQC quality gate');
  });
});

// T04 — the fixture helper is idempotent and leaves one auditable version.
test('W10-QCP-T04 — the quality policy helper is idempotent and auditable', async () => {
  await withScenario('w10-qcp-t04', { qualityPolicy: true }, async (context) => {
    const { db } = context;

    const installed = readWave10QualityPolicy(db);
    assert.ok(installed, 'the base seed must install the canonical test control point');
    const auditBefore = countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CREATE_VERSION' AND entity_type='QUALITY_CONTROL_POINT'");
    assert.equal(auditBefore, 1, 'the base seed must leave exactly one creation audit');

    const again = await seedWave10QualityPolicy(db);
    assert.equal(again.reused, true, 'the second invocation must report a reused control point');
    assert.equal(again.id, installed.id, 'the reused control point must keep its identity');
    assert.equal(again.qcpId, installed.id, 'the reused control point must keep its identity');
    assert.equal(again.version, installed.version, 'the reused control point must keep its version');
    assert.equal(again.reason, installed.reason, 'the reused control point must keep its reason');

    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM quality_control_points WHERE code=?', W10_QUALITY_POLICY_CODE), 1,
      'the helper must not create a second control point');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM quality_control_points WHERE code=? AND version=?', W10_QUALITY_POLICY_CODE, installed.version), 1,
      'the helper must not create a second version');
    assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CREATE_VERSION' AND entity_type='QUALITY_CONTROL_POINT'"), 1,
      'the helper must not leave a second creation audit');

    // The canonical resolution still reads the reused control point.
    const resolved = resolveQualityPolicy(db, 'SALES_DELIVERY', PRODUCT_ID, wave10BusinessDate());
    assert.equal(resolved.inspectionRequired, false);
    assert.equal(resolved.qcpId, installed.id);
    assert.equal(Number(resolved.version), installed.version);
    assert.equal(resolved.waiverReason, installed.reason);
  });
});
