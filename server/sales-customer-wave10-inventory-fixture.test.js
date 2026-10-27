// Wave 10 Inventory Fixture — the canonical stock seeding regression.
//
// document.md → "Wave 10 Inventory Fixture Requirement (2026-10-27)", clauses
// W10-INV-R01..R14 and acceptance conditions AC-INV-01..AC-INV-08;
// solution.md → §37.51 and §37.51.14.
//
// WHAT THIS FILE PROVES. The Wave 10 shared acceptance fixture seeded the
// acceptance stock with a legacy-shaped row (`position_key IS NULL`). The
// canonical production write path cannot match such a row, so the canonical
// upsert inserted a SECOND row carrying the movement delta, and the unfiltered
// availability read could select that negative shadow row and refuse a
// satisfiable Delivery. These eight cases pin the corrected fixture contract —
// exactly one canonical inventory position, seeded through the production
// absolute writer — and they keep the reproduction of the original defect
// strictly separate from the proof that the new contract holds.
//
// CLASSIFICATION. Every case declares exactly one class (document.md
// W10-INV-R14):
//   - FIXTURE_CONTRACT_PROOF     : the new canonical seed contract (T02, T03, T07)
//   - NEGATIVE_BUSINESS_CONTRACT : the production refusal when stock is absent (T04)
//   - WRITE_IDENTITY_CONTRACT    : the canonical writer moves only its own position (T05, T06)
//   - DOWNSTREAM_CONTRACT_PROOF  : the canonical chain still completes (T08)
//   - KNOWN_DEFECT_REPRODUCTION  : the original defect is still reachable (T01)
// A KNOWN_DEFECT_REPRODUCTION result is NEVER evidence that the new contract
// holds.
//
// EVIDENCE LEVEL. Every case runs on its own disposable SQLite database in
// production mode — the same initialization mode as the protected Wave 10 MySQL
// target: no demo seed, therefore no shipped global OQC default and an empty
// quality-control-point table before the fixture installs its own control
// point. This file is NOT real-MySQL row-contention evidence: the protected
// Gate B campaign and the W10-BUSINESS-MATRIX cases stay BLOCKED until they
// are separately authorized and must never be reported as PASS from this file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';
import { computePositionKey } from './lib/inventory-position.js';
import { adjustInventory } from './lib/stock.js';
import { deriveQualityState } from './modules/quality-gates.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  productionOrderBody, seedWave10AcceptanceBase, seedWave10Inventory,
  wave10DeliveryRequest, wave10HttpLogin, wave10HttpRequest,
} from './test-utils/wave10-mysql-acceptance-fixture.js';
import { createTempDb } from './test-utils/temp-db.js';

const WAREHOUSE_ID = 'w10-race-warehouse';
const PRODUCT_ID = 'w10-race-product';
const CREDIT_OPTIONS = Object.freeze({ aggregateLimit: 1000000, salespersonLimit: 400000 });

// The canonical default stock position of the fixture pair, derived with the
// PRODUCTION key function. The regression imports `computePositionKey` for
// ASSERTION purposes only (solution.md §37.51.4): the expectation is stated
// independently of the writer instead of being read back from the row it
// produced. The fixture itself never computes a key.
const CANONICAL_POSITION_KEY = computePositionKey({
  productId: PRODUCT_ID,
  warehouseId: WAREHOUSE_ID,
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

// Every scenario owns one disposable database in the OS temp directory.
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

function countRows(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0);
}

function inventoryRows(db) {
  return db.prepare('SELECT * FROM inventory WHERE warehouse_id=? AND product_id=? ORDER BY id')
    .all(WAREHOUSE_ID, PRODUCT_ID);
}

function canonicalRow(db) {
  return inventoryRows(db).find((row) => row.position_key === CANONICAL_POSITION_KEY) || null;
}

function now() {
  return new Date().toISOString();
}

// The canonical Sales Order lifecycle, produced by production handlers only.
async function canonicalApprovedOrder({ db, app, creator, approver }, key, { quantityMicros = 1_000_000 } = {}) {
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-orders', token: creator,
    body: productionOrderBody({ quantityMicros }),
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

// The canonical Delivery, created and confirmed through the real production
// HTTP routes.
async function canonicalConfirmedDelivery(context, { orderId, orderItemId, key, billingMode = 'LEGACY_DIRECT' }) {
  const { db, app, approver } = context;
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-deliveries', token: approver,
    body: wave10DeliveryRequest({ orderId, orderItemId, billingMode }),
  });
  assert.equal(created.statusCode, 201, `canonical delivery creation failed: ${JSON.stringify(created.body)}`);
  const deliveryId = created.body?.id;
  assert.ok(deliveryId, 'the canonical delivery creation must return the delivery id');
  const confirmed = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, token: approver,
    body: { action: 'confirm' }, headers: { 'idempotency-key': `${key}-confirm` },
  });
  assert.equal(confirmed.statusCode, 200, `canonical delivery confirmation failed: ${JSON.stringify(confirmed.body)}`);
  const lines = db.prepare('SELECT id,product_id FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no,id').all(deliveryId);
  assert.equal(lines.length, 1, 'the canonical delivery must produce exactly one delivery line');
  return { deliveryId, deliveryItemId: lines[0].id, productId: lines[0].product_id };
}

// T01 — KNOWN_DEFECT_REPRODUCTION. The legacy shape and the canonical writer
// produce two different position identities. This case proves the ORIGINAL
// defect mechanism; it is never evidence that the corrected fixture holds.
test('W10-INV-T01 — a legacy NULL-key row and the canonical writer stay two distinct positions', async () => {
  await withScenario('w10-inv-t01', {}, async ({ db }) => {
    // The reproduction row carries every canonical dimension except the
    // position identity — exactly the shape the defective fixture produced.
    db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
    db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)')
      .run('w10-inv-t01-legacy', WAREHOUSE_ID, PRODUCT_ID, 100, now());
    const seeded = db.prepare('SELECT * FROM inventory WHERE id=?').get('w10-inv-t01-legacy');
    assert.equal(seeded.position_key, null, 'the reproduction row must carry a NULL position_key');
    assert.equal(seeded.owner_type, 'ENTERPRISE');
    assert.equal(seeded.owner_id, null);
    assert.equal(seeded.stock_status, 'AVAILABLE');
    assert.equal(Number(seeded.quantity), 100);

    // The production canonical adjustment path — the same writer the Delivery
    // confirmation uses.
    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, -1, now());

    const rows = inventoryRows(db);
    assert.equal(rows.length, 2, 'the legacy row and the canonical row must coexist as two distinct positions');
    const legacy = rows.find((row) => row.id === 'w10-inv-t01-legacy');
    const canonical = rows.find((row) => row.id !== 'w10-inv-t01-legacy');
    assert.ok(canonical, 'the canonical writer must have created its own row');
    assert.notEqual(canonical.position_key, legacy.position_key,
      'the two rows must carry different position identities');
    assert.equal(legacy.position_key, null, 'the legacy row must not have acquired a canonical key');
    assert.equal(Number(legacy.quantity), 100, 'the legacy row must not have been decremented');
    assert.equal(canonical.position_key, CANONICAL_POSITION_KEY, 'the canonical row must carry the production position key');
    assert.equal(Number(canonical.quantity), -1,
      'the canonical row must carry the movement delta, not a balance — the shadow-row defect');
  });
});

// T02 — FIXTURE_CONTRACT_PROOF. The corrected seed establishes exactly one
// canonical inventory position.
test('W10-INV-T02 — the seeded stock row carries the canonical production position identity', async () => {
  await withScenario('w10-inv-t02', {}, async ({ db }) => {
    const rows = inventoryRows(db);
    assert.equal(rows.length, 1, 'the corrected seed must leave exactly one row for the pair');
    const row = rows[0];
    assert.equal(row.position_key, CANONICAL_POSITION_KEY,
      'the seeded row must carry the production canonical position key');
    assert.match(String(row.position_key), /^[0-9a-f]{64}$/,
      'the position key must be a 64-character lowercase hex SHA-256');
    assert.equal(row.owner_type, 'ENTERPRISE', 'the canonical owner_type must be ENTERPRISE');
    assert.equal(row.owner_id, null, 'the canonical owner_id must be NULL');
    assert.equal(row.stock_status, 'AVAILABLE', 'the canonical stock_status must be AVAILABLE');
    assert.equal(row.bin_id, null, 'the canonical bin_id must be NULL');
    assert.equal(row.lot_id, null, 'the canonical lot_id must be NULL');
    assert.equal(row.serial_id, null, 'the canonical serial_id must be NULL');
    assert.equal(Number(row.active), 1, 'the canonical row must be active');
    assert.equal(Number(row.quantity), 100, 'the seeded balance must be the absolute requested quantity');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key IS NULL', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no legacy NULL-key row may remain for the pair');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key<>?', WAREHOUSE_ID, PRODUCT_ID, CANONICAL_POSITION_KEY), 0,
      'no foreign position may exist for the pair');
    // The legacy fixed id is gone: the identity is the position, not the row id.
    assert.notEqual(row.id, 'w10-race-inventory',
      'the seed must no longer write the legacy fixed inventory id');
    assert.ok(String(row.id).length > 0, 'the seeded row must carry a generated identity');
  });
});

// T03 — FIXTURE_CONTRACT_PROOF. Two canonical deductions move one canonical
// row from 100 to 99 to 98 and never create a second position.
test('W10-INV-T03 — two canonical deductions move one canonical row from 100 to 99 to 98', async () => {
  await withScenario('w10-inv-t03', {}, async ({ db }) => {
    const seeded = canonicalRow(db);
    assert.ok(seeded, 'the corrected seed must leave a canonical row');
    assert.equal(Number(seeded.quantity), 100);

    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, -1, now());
    const afterFirst = canonicalRow(db);
    assert.ok(afterFirst, 'the first deduction must land on the canonical position');
    assert.equal(Number(afterFirst.quantity), 99, 'the first deduction must leave 99 EA');
    assert.equal(afterFirst.position_key, CANONICAL_POSITION_KEY, 'the position identity must not change');
    assert.equal(inventoryRows(db).length, 1, 'the first deduction must not create a second position');

    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, -1, now());
    const afterSecond = canonicalRow(db);
    assert.ok(afterSecond, 'the second deduction must land on the canonical position');
    assert.equal(Number(afterSecond.quantity), 98, 'the second deduction must leave 98 EA');
    assert.equal(afterSecond.position_key, CANONICAL_POSITION_KEY, 'the position identity must not change');
    assert.equal(inventoryRows(db).length, 1, 'no shadow row may be created by the deductions');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND quantity < 0', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no negative shadow row may exist');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key IS NULL', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no NULL-key row may exist');
  });
});

// T04 — NEGATIVE_BUSINESS_CONTRACT. With no stock the PRODUCTION availability
// check refuses the Delivery creation. The stock writers are not a sufficiency
// API, so the refusal is proven on the real production route.
test('W10-INV-T04 — with no stock the production availability check refuses the Delivery creation', async () => {
  await withScenario('w10-inv-t04', {}, async (context) => {
    const { db, app, approver } = context;
    // The missing condition is real: no inventory row exists for the pair.
    db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=?', WAREHOUSE_ID, PRODUCT_ID), 0,
      'the missing-stock scenario must carry no inventory row');

    const order = await canonicalApprovedOrder(context, 'w10-inv-t04');
    const created = await wave10HttpRequest(app, {
      method: 'POST', path: '/api/sales-deliveries', token: approver,
      body: wave10DeliveryRequest({ orderId: order.orderId, orderItemId: order.orderItemId }),
    });
    assert.equal(created.statusCode, 400, `the production availability check must refuse: ${JSON.stringify(created.body)}`);
    assert.equal(created.body?.error, 'W10-RACE-P 库存不足',
      'the refusal must be the production availability message');
    assert.equal(created.body?.message, 'W10-RACE-P 库存不足',
      'the refusal must carry the production message');
    assert.equal(created.body?.code, 'VALIDATION', 'the refusal must be a production validation refusal');

    // The refusal leaves no Delivery and no inventory effect behind.
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM sales_deliveries WHERE sales_order_id=?', order.orderId), 0,
      'the refused creation must write no Delivery');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_transactions'), 0,
      'the refused creation must write no inventory transaction');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory'), 0,
      'the refused creation must not create any inventory row');
  });
});

// T05 — WRITE_IDENTITY_CONTRACT. With a legacy row beside the canonical row,
// only the canonical position is decremented. The case is deterministic by
// construction: both candidate rows carry a quantity that satisfies a single
// unit demand, so the unfiltered availability read cannot change the outcome,
// and the assertions are keyed by position identity — never by row order.
test('W10-INV-T05 — a legacy row beside the canonical row is never decremented', async () => {
  await withScenario('w10-inv-t05', {}, async ({ db }) => {
    // Declared direct-DML setup fact: the case owns its inventory state, so
    // the seeded row is removed first and the two candidate rows below are the
    // only rows for the pair. The contract under test is the WRITE identity,
    // not the seed, so the case must not depend on which row the seed left.
    db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
    // The canonical position is established by the production writer itself.
    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, 100, now());
    // The legacy row carries a quantity that satisfies the same single unit
    // demand, so the case never depends on which row an availability read
    // would select.
    db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)')
      .run('w10-inv-t05-legacy', WAREHOUSE_ID, PRODUCT_ID, 100, now());
    const before = inventoryRows(db);
    assert.equal(before.length, 2, 'the scenario must carry exactly two candidate rows');
    for (const row of before) {
      assert.ok(Number(row.quantity) >= 1,
        'both candidate rows must satisfy a single unit demand so the read cannot decide the outcome');
    }

    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, -1, now());

    const after = inventoryRows(db);
    assert.equal(after.length, 2, 'the canonical deduction must not create a third position');
    const canonical = after.filter((row) => row.position_key === CANONICAL_POSITION_KEY);
    const legacy = after.filter((row) => row.position_key === null);
    assert.equal(canonical.length, 1, 'exactly one canonical position must exist');
    assert.equal(legacy.length, 1, 'exactly one legacy NULL-key row must exist');
    assert.equal(Number(canonical[0].quantity), 99, 'only the canonical position may be decremented');
    assert.equal(Number(legacy[0].quantity), 100, 'the legacy row quantity must stay untouched');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND quantity < 0', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no negative row may be created');
  });
});

// T06 — WRITE_IDENTITY_CONTRACT. A differently identified position for the
// same warehouse/product pair is never modified by the canonical writer.
test('W10-INV-T06 — the canonical writer never modifies a differently identified position', async () => {
  await withScenario('w10-inv-t06', {}, async ({ db }) => {
    // Declared direct-DML setup fact: the case owns its inventory state, so
    // the seeded row is removed first. The contract under test is the WRITE
    // identity, not the seed.
    db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
    // A second, differently identified canonical position: another owner
    // dimension for the same pair.
    const wrongKey = computePositionKey({
      productId: PRODUCT_ID,
      warehouseId: WAREHOUSE_ID,
      binId: null,
      ownerType: 'CUSTOMER',
      ownerId: 'w10-race-customer',
      stockStatus: 'AVAILABLE',
      lotId: null,
      serialId: null,
    });
    assert.notEqual(wrongKey, CANONICAL_POSITION_KEY, 'the two positions must carry different identities');
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,
      owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,?,?,?,NULL,'CUSTOMER','w10-race-customer','AVAILABLE',NULL,NULL,1)`)
      .run('w10-inv-t06-wrong', WAREHOUSE_ID, PRODUCT_ID, 100, now(), wrongKey);

    adjustInventory(db, WAREHOUSE_ID, PRODUCT_ID, -1, now());

    const rows = inventoryRows(db);
    assert.equal(rows.length, 2, 'the canonical writer must not create a third position');
    const wrong = rows.find((row) => row.id === 'w10-inv-t06-wrong');
    assert.ok(wrong, 'the differently identified position must still exist');
    assert.equal(wrong.position_key, wrongKey, 'the differently identified position must keep its identity');
    assert.equal(Number(wrong.quantity), 100, 'the differently identified position must not be modified');
    assert.equal(wrong.owner_type, 'CUSTOMER');
    assert.equal(wrong.owner_id, 'w10-race-customer');
    const canonical = rows.find((row) => row.position_key === CANONICAL_POSITION_KEY);
    assert.ok(canonical, 'the canonical writer must have written its own position');
    assert.equal(Number(canonical.quantity), -1, 'the canonical writer must land the delta on its own position');
    // This case proves the WRITE identity only. It says nothing about the
    // unfiltered availability read, which is the independent production risk
    // W10-INV-RISK-01.
  });
});

// T07 — FIXTURE_CONTRACT_PROOF. The repeated seed is idempotent on the
// canonical position. The legacy DELETE+INSERT path also produced a single
// row, so the row count alone is NOT the proof: the canonical position
// identity, the balance and the absence of a NULL-key row are.
test('W10-INV-T07 — the repeated seed is idempotent on the canonical position', async () => {
  await withScenario('w10-inv-t07', {}, async ({ db }) => {
    const first = canonicalRow(db);
    assert.ok(first, 'the corrected seed must leave a canonical row');
    assert.equal(first.position_key, CANONICAL_POSITION_KEY);
    assert.equal(Number(first.quantity), 100);

    seedWave10Inventory(db);

    const rows = inventoryRows(db);
    assert.equal(rows.length, 1, 'the repeated seed must leave exactly one row for the pair');
    assert.equal(rows[0].position_key, CANONICAL_POSITION_KEY,
      'the repeated seed must keep the canonical position identity');
    assert.equal(Number(rows[0].quantity), 100, 'the repeated seed must keep the absolute balance');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key IS NULL', WAREHOUSE_ID, PRODUCT_ID), 0,
      'the repeated seed must leave no NULL-key row');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key<>?', WAREHOUSE_ID, PRODUCT_ID, CANONICAL_POSITION_KEY), 0,
      'the repeated seed must leave no duplicate or foreign position');
    // The row id is generated by the production writer and is therefore NOT
    // required to be byte-stable across the repeated seed.
    assert.ok(String(rows[0].id).length > 0, 'the repeated seed must leave a row with an identity');
  });
});

// T08 — DOWNSTREAM_CONTRACT_PROOF. The canonical seed supports the real
// canonical chain: one approved order, two confirmed Deliveries of 1 EA each,
// 98 EA remaining on one canonical row, and the OQC / Credit / Sales Order /
// Delivery / Finance constraints all still enforced.
test('W10-INV-T08 — the canonical seed supports two canonical out-bound Deliveries and leaves 98 EA', async () => {
  await withScenario('w10-inv-t08', {}, async (context) => {
    const { db, app, approver } = context;
    const order = await canonicalApprovedOrder(context, 'w10-inv-t08', { quantityMicros: 2_000_000 });

    // The Sales Order is a real approved production document.
    const orderRow = db.prepare('SELECT status,reviewer_id,total_cents FROM sales_orders WHERE id=?').get(order.orderId);
    assert.equal(orderRow.status, 'APPROVED', 'the canonical order must be approved');
    assert.ok(orderRow.reviewer_id, 'the canonical approval must stamp its reviewer');

    // The Credit check really ran at the approval stage and passed.
    const creditResults = db.prepare("SELECT * FROM credit_check_results WHERE stage='SO_APPROVE' AND sales_order_id=?").all(order.orderId);
    assert.ok(creditResults.length > 0, 'the order approval must have run the production credit check');
    assert.ok(creditResults.every((row) => row.decision === 'PASS'),
      'the production credit check must have passed');

    const first = await canonicalConfirmedDelivery(context, {
      orderId: order.orderId, orderItemId: order.orderItemId, key: 'w10-inv-t08-a',
    });
    const afterFirst = canonicalRow(db);
    assert.ok(afterFirst, 'the first confirmation must land on the canonical position');
    assert.equal(Number(afterFirst.quantity), 99, 'the first confirmed Delivery must leave 99 EA');
    assert.equal(inventoryRows(db).length, 1, 'the first confirmed Delivery must not create a shadow row');

    const second = await canonicalConfirmedDelivery(context, {
      orderId: order.orderId, orderItemId: order.orderItemId, key: 'w10-inv-t08-b',
    });
    const afterSecond = canonicalRow(db);
    assert.ok(afterSecond, 'the second confirmation must land on the canonical position');
    assert.equal(Number(afterSecond.quantity), 98, 'the second confirmed Delivery must leave 98 EA');
    assert.equal(afterSecond.position_key, CANONICAL_POSITION_KEY, 'the position identity must be stable');

    // The physical inventory row: exactly one, canonical, no shadow, no NULL.
    const rows = inventoryRows(db);
    assert.equal(rows.length, 1, 'the canonical chain must not create a shadow row');
    assert.equal(rows[0].position_key, CANONICAL_POSITION_KEY);
    assert.equal(Number(rows[0].quantity), 98);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND quantity < 0', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no negative row may exist');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key IS NULL', WAREHOUSE_ID, PRODUCT_ID), 0,
      'no NULL-key row may exist');

    // Both Deliveries reached the confirmed state through the production route.
    for (const delivery of [first, second]) {
      const row = db.prepare('SELECT status,confirmed_by,confirmed_at FROM sales_deliveries WHERE id=?').get(delivery.deliveryId);
      assert.equal(row.status, 'CONFIRMED', 'the Delivery must be confirmed');
      assert.ok(row.confirmed_by, 'the confirmed Delivery must stamp its confirmer');
      assert.ok(row.confirmed_at, 'the confirmed Delivery must stamp its confirmation time');
      // The OQC gate was consulted and waived by the installed control point.
      assert.equal(deriveQualityState(db, 'OQC', delivery.deliveryId).code, 'WAIVED',
        'the installed control point must waive the OQC gate');
      // Canonical inventory effect: exactly one OUT transaction per Delivery.
      const transactions = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id=?").all(delivery.deliveryId);
      assert.equal(transactions.length, 1, 'each confirmed Delivery must write exactly one inventory transaction');
      assert.equal(transactions[0].direction, 'OUT');
      assert.equal(Number(transactions[0].quantity_change), 1, 'the OUT transaction must carry the issued quantity');
      // Canonical valuation effect: one unvalued movement, no issued cost.
      const movements = db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type='SALES_DELIVERY' AND source_id=?").all(delivery.deliveryId);
      assert.equal(movements.length, 1, 'each confirmed Delivery must write exactly one valuation movement');
      assert.equal(movements[0].valuation_basis, 'LEGACY_UNVALUED');
      assert.equal(Number(movements[0].value_delta_cents), 0, 'the fixture product carries no issued cost');
      // Canonical audit effect.
      assert.equal(countRows(db, "SELECT COUNT(*) count FROM audit_logs WHERE action='CONFIRM' AND entity_type='SALES_DELIVERY' AND entity_id=?", delivery.deliveryId), 1,
        'each confirmed Delivery must write exactly one confirmation audit');
    }

    // The recorded balances are 99 for the first Delivery and 98 for the
    // second, keyed by their own source document.
    const balances = new Map(inventoryRows(db).length === 1
      ? db.prepare("SELECT source_id,balance_after FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id IN (?,?)").all(first.deliveryId, second.deliveryId)
        .map((row) => [row.source_id, Number(row.balance_after)])
      : []);
    assert.equal(balances.get(first.deliveryId), 99, 'the first Delivery must record the 99 EA balance');
    assert.equal(balances.get(second.deliveryId), 98, 'the second Delivery must record the 98 EA balance');

    // Canonical Finance effect: one receivable per confirmed Delivery, and the
    // invoiced obligation is conserved against the order.
    const receivables = db.prepare("SELECT * FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id IN (?,?)").all(first.deliveryId, second.deliveryId);
    assert.equal(receivables.length, 2, 'each confirmed Delivery must write exactly one receivable');
    const receivableCents = receivables.reduce((sum, row) => sum + Number(row.amount_cents), 0);
    assert.equal(receivableCents, Number(orderRow.total_cents),
      'the confirmed obligation must be conserved against the approved order');
    assert.ok(receivables.every((row) => row.status === 'PENDING'), 'the receivables must stay open');
  });
});
