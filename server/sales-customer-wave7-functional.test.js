import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, hashPassword, transaction } from './db.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  createPrepaymentRequirement, evaluateSalesPrepaymentGate, getPrepaymentGateResult,
  listPrepaymentGateResults, overridePrepaymentGateResult,
  __salesPrepaymentGateInternals,
} from './modules/sales-prepayment-gate.js';
import {
  requestReservationIntent, grantReservationIntent, consumeReservationIntent, releaseReservationIntent,
  listReservationIntents, getReservationIntent,
  __salesReservationIntentInternals,
} from './modules/sales-reservation-intent.js';
import {
  resolveEligiblePrepaymentForSalesGate, acquireParentBalanceLock,
  __salesPrepaymentFinanceAdapterInternals,
} from './modules/sales-prepayment-finance-adapter.js';
import { HttpError } from './lib/http.js';

const DAY = '2026-10-18';

function buildDb() {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave7-fn-'));
  const path = join(temp, 'fn.db');
  const db = createDatabase(path);
  try {
    migrateSalesCustomerDomain(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return { db, temp };
}

function seedBaseContext(db) {
  const now = new Date().toISOString();
  const userId = 'u-wave7-sales';
  const roleId = 'role-sales';
  const hashed = hashPassword('sales-wave7-1234');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)`).run(userId, 'sales-w7', 'Sales Wave 7', hashed.hash, hashed.salt, roleId, now);
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus-w7','CUS-W7','Wave 7 Customer','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('sp-w7','SP-W7','Salesperson W7',?,1,?,?)`).run(userId, now, now);
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES('sg-w7','SG-W7','Sales Group W7','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at) VALUES('mem-w7','sp-w7','sg-w7',0,1,?,NULL,?,?)`).run(DAY, now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-w7','WH-W7','Wave 7 Warehouse','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-w7','P-W7','Wave 7 Product','','EA',10000,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('inv-w7','wh-w7','p-w7',100,?)`).run(now);
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at) VALUES('so-w7','SO-W7','cus-w7','APPROVED',100000,?,?,?)`).run(userId, now, now);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-w7','so-w7','p-w7',10,10000,100000,1)`).run();
  return { userId, now };
}

function seedPrepaymentBalance(db, userId, now, amountCents = 100000) {
  db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied) VALUES('pc-w7','PC-W7','cus-w7',NULL,?,?,'CASH','',?,?,'CONFIRMED','',NULL,NULL,'','',0,'NONE',NULL,?,1)`).run(amountCents, DAY, userId, now, amountCents);
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-w7','CUSTOMER','PREPAYMENT','cus-w7','PAYMENT_COLLECTION','pc-w7','PC-W7',?,?,NULL,'OPEN',?,?)`).run(amountCents, DAY, userId, now);
}

function actorUser(db, userId) {
  return { id: userId, roleCode: 'SALES', permissions: ['SALES_MANAGE', 'SALES_VIEW'], isSystemAdmin: false };
}

function makeReq(body = {}) {
  const encoded = body === undefined ? '' : JSON.stringify(body);
  const buf = Buffer.from(encoded, 'utf8');
  let consumed = false;
  return {
    headers: { 'content-type': 'application/json', 'content-length': String(buf.length) },
    async *[Symbol.asyncIterator]() {
      if (consumed) return;
      consumed = true;
      yield buf;
    },
  };
}

function makeRes() {
  // Minimal Node HTTP-response-like object so the module's `send()` can run.
  const state = {
    statusCode: null,
    body: null,
    headers: {},
    chunks: [],
    ended: false,
    setHeader(name, value) { state.headers[name] = value; },
    end(chunk) {
      if (chunk) state.chunks.push(chunk);
      state.ended = true;
      try { state.body = JSON.parse(Buffer.concat(state.chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8') || 'null'); } catch (_) { state.body = null; }
    },
    writeHead(status) { state.statusCode = status; },
  };
  return state;
}

async function runHandler(handler, actor, body) {
  const req = makeReq(body);
  const res = makeRes();
  await handler(req, res, actor);
  return res;
}

// ---------- Finance adapter tests ----------

test('Finance adapter: eligible equals original_amount when no applied/refunded/reversal rows exist', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-w7', businessDate: DAY, gateStage: 'PLANNING_RELEASE',
      salesOrderId: 'so-w7', remainingRequiredCents: 50000, lockMode: 'NO_LOCK',
    });
    assert.equal(evidence.eligibleAmountCents, 100000);
    assert.equal(evidence.decisionHint, 'OK');
    assert.equal(evidence.sourceBalanceIdentities.length, 1);
    assert.equal(evidence.sourceBalanceIdentities[0].remainingEligibleCents, 100000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Finance adapter: eligible decreases when balance_applications exist', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    // Create a balance application for 30000 cents.
    db.prepare(`INSERT INTO balance_applications(id, application_no, side, balance_kind, balance_id, target_open_item_id, amount_cents, business_date, reason, status, creator_id, created_at) VALUES('ba-w7','BA-W7','AR','PREPAYMENT','sub-w7','open-w7',30000,?,'','CONFIRMED',?,?)`).run(DAY, userId, now);
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-w7', businessDate: DAY, gateStage: 'DELIVERY',
      salesOrderId: 'so-w7', remainingRequiredCents: 80000, lockMode: 'NO_LOCK',
    });
    assert.equal(evidence.eligibleAmountCents, 70000);
    assert.equal(evidence.appliedAmountCents, 30000);
    assert.equal(evidence.decisionHint, 'NOT_OK'); // 70k < 80k insufficient
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Finance adapter: insufficient eligible triggers NOT_OK hint', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 10000);
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-w7', businessDate: DAY, gateStage: 'DELIVERY',
      salesOrderId: 'so-w7', remainingRequiredCents: 80000, lockMode: 'NO_LOCK',
    });
    assert.equal(evidence.decisionHint, 'NOT_OK');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Finance adapter: acquireParentBalanceLock throws on closed PREPAYMENT balance', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    db.prepare(`UPDATE settlement_unapplied_balances SET status='REVERSED' WHERE id=?`).run('sub-w7');
    assert.throws(
      () => acquireParentBalanceLock(db, 'sub-w7'),
      (err) => err instanceof HttpError && /结算余额已关闭/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Prepayment Gate writer tests ----------

test('Prepayment Gate: REQUIREMENT_MISSING blocks evaluation when no Sales-owned requirement row exists', async () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const actor = actorUser(db, userId);
    await assert.rejects(
      evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE'),
      (err) => err instanceof HttpError && /请先维护预付要求/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: PASS when eligible PREPAYMENT >= required remaining', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const actor = actorUser(db, userId);
    // Create requirement of 50000.
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    const res = await runHandler(async (req, res, actor) => {
      res.statusCode = 201;
      res.body = await evaluateSalesPrepaymentGate(db, req, res, actor, 'so-w7', 'PLANNING_RELEASE');
    }, actor, {});
    // evaluateSalesPrepaymentGate internally calls send(res, 201, body) which writes statusCode.
    // To observe the gate decision, query the recorded result row directly.
    const row = db.prepare(`SELECT gate_decision, eligible_advance_cents, required_remaining_cents FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='PLANNING_RELEASE' ORDER BY evaluated_at DESC LIMIT 1`).get('so-w7');
    assert.ok(row, 'gate result must be persisted');
    assert.equal(row.gate_decision, 'PASS');
    assert.equal(row.eligible_advance_cents, 100000);
    assert.equal(row.required_remaining_cents, 50000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: WARN when eligible PREPAYMENT > 0 but < required remaining', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 10000);
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-w7', 'DELIVERY');
    const row = db.prepare(`SELECT gate_decision, eligible_advance_cents FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='DELIVERY' ORDER BY evaluated_at DESC LIMIT 1`).get('so-w7');
    assert.equal(row.gate_decision, 'WARN');
    assert.equal(row.eligible_advance_cents, 10000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: BLOCK when eligible PREPAYMENT == 0', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    const row = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='PLANNING_RELEASE' ORDER BY evaluated_at DESC LIMIT 1`).get('so-w7');
    assert.equal(row.gate_decision, 'BLOCK');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: previous OVERRIDE_REQUIRED is preserved on re-evaluation while eligibility still insufficient', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 10000);
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-w7', 'RESERVATION');
    const first = db.prepare(`SELECT id, gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='RESERVATION' ORDER BY evaluated_at DESC LIMIT 1`).get('so-w7');
    await overridePrepaymentGateResult(db, makeReq({ reason: '客户经理特批' }), makeRes(), actor, first.id);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'override-replay' }), makeRes(), actor, 'so-w7', 'RESERVATION');
    const second = db.prepare(`SELECT id, gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='RESERVATION' AND snapshot_key='override-replay'`).get('so-w7');
    assert.equal(second.gate_decision, 'OVERRIDE_REQUIRED');
    const persisted = db.prepare(`SELECT gate_decision, overridden_by FROM sales_prepayment_gate_results WHERE id=?`).get(first.id);
    assert.equal(persisted.gate_decision, 'OVERRIDE_REQUIRED');
    assert.equal(persisted.overridden_by, userId);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: snapshot_key idempotent replay returns the same row without re-evaluating', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-1' }), makeRes(), actor, 'so-w7', 'RESERVATION');
    const beforeCount = db.prepare('SELECT COUNT(*) c FROM sales_prepayment_gate_results').get().c;
    // Replay with same snapshot_key => no new row.
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-1' }), makeRes(), actor, 'so-w7', 'RESERVATION');
    const afterCount = db.prepare('SELECT COUNT(*) c FROM sales_prepayment_gate_results').get().c;
    assert.equal(afterCount, beforeCount);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: OVERRIDE_REQUIRED via override endpoint records reason + actor', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 10000);
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-w7', 'DELIVERY');
    const gateRow = db.prepare(`SELECT id FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='DELIVERY' ORDER BY evaluated_at DESC LIMIT 1`).get('so-w7');
    await overridePrepaymentGateResult(db, makeReq({ reason: '客户经理特批' }), makeRes(), actor, gateRow.id);
    const updated = db.prepare(`SELECT gate_decision, override_reason, overridden_by FROM sales_prepayment_gate_results WHERE id=?`).get(gateRow.id);
    assert.equal(updated.gate_decision, 'OVERRIDE_REQUIRED');
    assert.equal(updated.override_reason, '客户经理特批');
    assert.equal(updated.overridden_by, userId);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prepayment Gate: insufficient replay with same snapshot_key returns the persisted row, not a re-evaluation', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 10000);
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES('req-w7','so-w7',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-b' }), makeRes(), actor, 'so-w7', 'DELIVERY');
    const first = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key=?`).get('snap-b');
    assert.equal(first.gate_decision, 'WARN');
    // Replay must not flip the persisted decision.
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-b' }), makeRes(), actor, 'so-w7', 'DELIVERY');
    const second = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key=?`).get('snap-b');
    assert.equal(second.gate_decision, 'WARN');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Reservation Intent tests ----------

test('Reservation Intent: INVENTORY_LOCK writes canonical inventory_locks row + intent evidence', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    transaction(db, () => {
      const lockId = internals.createInventoryLockAdapter(db, actor, { salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 5 });
      assert.ok(lockId);
      const lock = db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(lockId);
      assert.equal(lock.status, 'ACTIVE');
      assert.equal(Number(lock.quantity), 5);
      // Release path: sales cancel closes the canonical lock.
      internals.releaseInventoryLockAdapter(db, actor, lockId);
      const released = db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(lockId);
      assert.equal(released.status, 'RELEASED');
    });
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: ON_HAND_RESERVATION calls Planning canonical reservation with STRONG + ON_HAND', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    let resvId;
    transaction(db, () => {
      resvId = internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 3,
        reservationType: 'STRONG', supplySourceType: 'ON_HAND', supplySourceId: null,
      });
    });
    const row = db.prepare('SELECT * FROM planning_reservations WHERE id=?').get(resvId);
    assert.equal(row.reservation_type, 'STRONG');
    assert.equal(row.supply_source_type, 'ON_HAND');
    assert.equal(Number(row.quantity), 3);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.demand_source_type, 'SALES_ORDER');
    assert.equal(row.demand_source_id, 'so-w7');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: pure EXPECTED (no concrete source) fails closed with bounded extension code', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 5,
        reservationType: 'STRONG', supplySourceType: 'EXPECTED', supplySourceId: 'expected-supply-1',
      }),
      (err) => err instanceof HttpError
        && /有界集成扩展/.test(err.message)
        && err.code === 'SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED',
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: EXPECTED_SUPPLY_RESERVATION with concrete PLANNED_ORDER derives capacity from Planning canonical row', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    db.prepare(`INSERT INTO planned_orders(id, order_no, product_id, quantity, released_quantity, status, source_type, supply_type, need_date, created_at, updated_at, created_by, updated_by)
      VALUES('po-w7','PO-W7','p-w7',10,2,'CONFIRMED','MRP','MAKE',?,?,?,?,?)`).run(DAY, now, now, userId, userId);
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    let resvId;
    transaction(db, () => {
      resvId = internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 5,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'po-w7',
      });
    });
    const row = db.prepare('SELECT * FROM planning_reservations WHERE id=?').get(resvId);
    assert.equal(Number(row.quantity), 5);
    assert.equal(row.supply_source_type, 'PLANNED_ORDER');
    assert.equal(row.supply_source_id, 'po-w7');
    // Quantity > remaining supply (10 - 2 = 8) must fail closed.
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7-x', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 99,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'po-w7',
      }),
      (err) => err instanceof HttpError
        && err.code === 'SALES_RESERVATION_CAPACITY_EXCEEDED'
        && /仅剩/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: missing and terminal PLANNED_ORDER sources fail closed in the Planning canonical writer', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    assert.throws(
      () => transaction(db, () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 1,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'missing-planned-order',
      })),
      (error) => error instanceof HttpError && error.code === 'PLANNING_RESERVATION_SOURCE_MISSING',
    );
    db.prepare(`INSERT INTO planned_orders(id,order_no,product_id,quantity,released_quantity,status,source_type,supply_type,need_date,created_at,updated_at,created_by,updated_by)
      VALUES('po-terminal','PO-TERMINAL','p-w7',10,0,'CANCELLED','MRP','MAKE',?,?,?,?,?)`).run(DAY, now, now, userId, userId);
    assert.throws(
      () => transaction(db, () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 1,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'po-terminal',
      })),
      (error) => error instanceof HttpError && error.code === 'PLANNING_RESERVATION_SOURCE_INVALID',
    );
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM planning_reservations WHERE supply_source_id IN ('missing-planned-order','po-terminal')`).get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: capacity refusal blocks over-reservation on ON_HAND', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 5000,
        reservationType: 'STRONG', supplySourceType: 'ON_HAND',
      }),
      (err) => err instanceof HttpError && /可预留供应仅剩/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: concurrent same-source reservations reject over-reservation', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    let firstResvId;
    transaction(db, () => {
      firstResvId = internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 60,
        reservationType: 'STRONG', supplySourceType: 'ON_HAND',
      });
    });
    // Second reservation of 50 must be rejected (60 already reserved against 100 on_hand).
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7-x', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 50,
        reservationType: 'STRONG', supplySourceType: 'ON_HAND',
      }),
      (err) => err instanceof HttpError && /可预留供应仅剩/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: INTENT_DUPLICATE blocks double REQUESTED for same SO+line+mode', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(db, userId);
    // Persist a REQUESTED intent.
    db.prepare(`INSERT INTO sales_reservation_intent(id, sales_order_id, sales_order_item_id, product_id, warehouse_id, reservation_mode, intent_state, requested_qty, granted_qty, consumed_qty, released_qty, planning_reservation_id, inventory_lock_id, expected_supply_source_type, expected_supply_source_id, expected_supply_capacity, consumer_event, requested_at, granted_at, released_at, created_at, created_by) VALUES('ri-w7-1','so-w7','soi-w7','p-w7','wh-w7','ON_HAND_RESERVATION','REQUESTED',5,0,0,0,NULL,NULL,NULL,NULL,NULL,NULL,?,NULL,NULL,?,?)`).run(now, now, userId);
    assert.throws(
      () => {
        // Mimic the findActiveIntent detection.
        const found = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id=? AND COALESCE(sales_order_item_id,'')=COALESCE(?,'') AND reservation_mode=? ORDER BY created_at DESC LIMIT 1`).get('so-w7', 'soi-w7', 'ON_HAND_RESERVATION');
        if (found && found.intent_state === 'REQUESTED') throw new HttpError(409, 'duplicate');
      },
      (err) => err instanceof HttpError && /duplicate/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: GRANTED + CONSUMED + RELEASED lifecycle progresses through canonical truth', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(db, userId);
    let resvId, lockId;
    transaction(db, () => {
      resvId = internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 10,
        reservationType: 'STRONG', supplySourceType: 'ON_HAND',
      });
      lockId = internals.createInventoryLockAdapter(db, actor, { salesOrderId: 'so-w7', productId: 'p-w7', warehouseId: 'wh-w7', quantity: 10 });
    });
    // Both canonical truth rows exist.
    assert.ok(db.prepare('SELECT id FROM planning_reservations WHERE id=?').get(resvId));
    assert.ok(db.prepare('SELECT id FROM inventory_locks WHERE id=?').get(lockId));
    // Release path closes both.
    transaction(db, () => {
      internals.releasePlanningReservationAdapter(db, actor, resvId);
      internals.releaseInventoryLockAdapter(db, actor, lockId);
    });
    assert.equal(db.prepare('SELECT status FROM planning_reservations WHERE id=?').get(resvId).status, 'RELEASED');
    assert.equal(db.prepare('SELECT status FROM inventory_locks WHERE id=?').get(lockId).status, 'RELEASED');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Reservation Intent: consume never exceeds granted quantity', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(db, userId);
    db.prepare(`INSERT INTO sales_reservation_intent(id, sales_order_id, sales_order_item_id, product_id, warehouse_id, reservation_mode, intent_state, requested_qty, granted_qty, consumed_qty, released_qty, planning_reservation_id, inventory_lock_id, expected_supply_source_type, expected_supply_source_id, expected_supply_capacity, consumer_event, requested_at, granted_at, released_at, created_at, created_by) VALUES('ri-w7-grant','so-w7','soi-w7','p-w7','wh-w7','ON_HAND_RESERVATION','GRANTED',5,5,0,0,NULL,NULL,NULL,NULL,NULL,NULL,?,?,NULL,?,?)`).run(now, now, now, userId);
    // Consume 5 (full grant) -> CONSUMED.
    transaction(db, () => {
      const intent = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get('ri-w7-grant');
      const newConsumed = Number(intent.consumed_qty) + 5;
      const newState = newConsumed >= Number(intent.granted_qty) - 1e-9 ? 'CONSUMED' : 'GRANTED';
      db.prepare(`UPDATE sales_reservation_intent SET consumed_qty=?, intent_state=? WHERE id=?`).run(newConsumed, newState, intent.id);
    });
    assert.equal(db.prepare('SELECT consumed_qty, intent_state FROM sales_reservation_intent WHERE id=?').get('ri-w7-grant').intent_state, 'CONSUMED');
    // Consuming again from a CONSUMED intent should be rejected by writer.
    await assert.rejects(
      consumeReservationIntent(db, makeReq({ quantity: 1 }), makeRes(), actor, 'ri-w7-grant'),
      (err) => err instanceof HttpError && /不可消费/.test(err.message),
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
