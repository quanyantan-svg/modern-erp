import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabase, hashPassword, transaction } from './db.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  createPrepaymentRequirement, evaluateSalesPrepaymentGate, getPrepaymentGateResult,
  listPrepaymentGateResults, overridePrepaymentGateResult,
  discoverSalesPrepaymentGatePlan, authorizeSalesPrepaymentGateWithPlan,
  __salesPrepaymentGateInternals,
} from './modules/sales-prepayment-gate.js';
import {
  requestReservationIntent, grantReservationIntent, consumeReservationIntent, releaseReservationIntent,
  listReservationIntents, getReservationIntent,
  __salesReservationIntentInternals,
} from './modules/sales-reservation-intent.js';
import {
  resolveEligiblePrepaymentForSalesGate, acquireParentBalanceLock,
  assertPrepaymentParentPlanCurrent, discoverEligiblePrepaymentParents, lockEligiblePrepaymentParents,
  __salesPrepaymentFinanceAdapterInternals,
} from './modules/sales-prepayment-finance-adapter.js';
import { HttpError, serializeError } from './lib/http.js';

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

// ---------------------------------------------------------------------------
// W7-C1 Implementation B — Manual Gate Evaluation lock-order correction
// (solution.md §37.2, §37.9, §37.10 A-STATIC / A-ORDER)
//
// A SQL recorder proves the ORDER in which the canonical path touches the parent,
// Gate Result and Gate Requirement rows. That is ORDER evidence on one SQLite
// connection. It is NOT real-MySQL row-contention evidence, which per §37.10
// A-RAW remains a Gate A obligation on a disposable MySQL.
// ---------------------------------------------------------------------------

function recordingDb(db) {
  const statements = [];
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (text) => { statements.push(String(text)); return target.prepare(text); };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: proxy, statements };
}

function seedExtraBalances(db, userId, now, specs) {
  for (const [id, amountCents] of specs) {
    db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES(?,'CUSTOMER','PREPAYMENT','cus-w7','PAYMENT_COLLECTION',?,?,?,?,NULL,'OPEN',?,?)`).run(id, `pc-${id}`, `PC-${id}`, amountCents, DAY, userId, now);
  }
}

function seedRequirement(db, userId, now, { id = 'req-w7', amount = 50000 } = {}) {
  db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by) VALUES(?,'so-w7',0,?,'ORDER_VALUE',NULL,NULL,?,?)`).run(id, amount, now, userId);
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

function installMonotonicClock(t, readings) {
  let index = 0;
  const last = readings[readings.length - 1];
  return t.mock.method(process.hrtime, 'bigint', () => readings[index++] ?? last);
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

// Injection helper for the outer-retry contract. The hook fires on the same connection
// at the exact discovery -> lock boundary, so a test can create genuine parent or
// requirement drift without a fake clock or a second connection. `outside: true` fires
// before the transaction so the drift PERSISTS; the default fires inside the attempt,
// so the drift is rolled back with the failed attempt. This is a fixture injection,
// NOT real-MySQL contention.
function injectingDb(db, hooks) {
  const state = { attempts: 0, fired: {}, statements: [], depth: 0 };
  const replayProbe = (s) => s.includes('FROM sales_prepayment_gate_results') && s.includes('AND snapshot_key=?');
  const proxy = new Proxy(db, {
    get(target, prop) {
      // The SQLite handle has no isTransaction flag (only the MySQL adapter sets one),
      // so transaction depth is tracked from the BEGIN/COMMIT/ROLLBACK statements.
      if (prop === 'exec') {
        return (text) => {
          const head = String(text).trim().toUpperCase();
          if (head.startsWith('BEGIN')) state.depth += 1;
          else if (head.startsWith('COMMIT') || head.startsWith('ROLLBACK')) state.depth = Math.max(0, state.depth - 1);
          return target.exec(text);
        };
      }
      if (prop === 'prepare') {
        return (text) => {
          const sql = String(text);
          state.statements.push(sql);
          // Each transaction attempt opens with the replay probe (not the INSERT, whose
          // column list also contains snapshot_key).
          if (replayProbe(sql)) state.attempts += 1;
          const fire = (name, match) => {
            const spec = hooks[name];
            if (!spec || !spec.times || !match(sql)) return;
            if (!!spec.outside === (state.depth > 0)) return;
            state.fired[name] = (state.fired[name] || 0) + 1;
            if (state.fired[name] <= spec.times) target.prepare(spec.sql).run(...(spec.args || []));
          };
          fire('parent', (s) => s.includes('settlement_unapplied_balances') && s.includes('WHERE id=?'));
          fire('requirement', (s) => s.includes('sales_prepayment_requirements WHERE id='));
          fire('eligible', (s) => s.includes('settlement_unapplied_balances') && s.includes("balance_type='PREPAYMENT'"));
          return target.prepare(text);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: proxy, state };
}

// ---------- W7-C1 Implementation B: manual gate lock order ----------

test('W7-C1: manual gate locks parent before Gate Result and Gate Requirement, and Result before Requirement', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const rec = recordingDb(db);
    await evaluateSalesPrepaymentGate(rec.db, makeReq({}), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    // Everything before the replay probe is unlocked discovery, not the locked sequence.
    const txStart = rec.statements.findIndex((s) => s.includes('sales_prepayment_gate_results') && s.includes('snapshot_key'));
    assert.ok(txStart > 0, 'the replay probe must be the first in-transaction statement');
    const tx = rec.statements.slice(txStart);
    const firstParent = tx.findIndex((s) => s.includes('settlement_unapplied_balances'));
    const resultLock = tx.findIndex((s) => s.includes('sales_prepayment_gate_results') && s.includes('ORDER BY evaluated_at DESC'));
    const requirementLock = tx.findIndex((s) => s.includes('sales_prepayment_requirements WHERE id='));
    assert.ok(firstParent > 0, 'the parent balance must be touched inside the transaction');
    assert.ok(resultLock > 0 && requirementLock > 0, 'both Gate rows must be locked');
    assert.ok(firstParent < resultLock, 'L1 PARENT must precede L6 GATE_RESULT');
    assert.ok(resultLock < requirementLock, 'L6 GATE_RESULT must precede L7 GATE_REQUIREMENT');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: every eligible parent is locked individually in the deterministic ascending id order', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedExtraBalances(db, userId, now, [['sub-w7-b', 30000], ['sub-w7-a', 20000]]);
    seedRequirement(db, userId, now, { amount: 40000 });
    const actor = actorUser(db, userId);
    const rec = recordingDb(db);
    await evaluateSalesPrepaymentGate(rec.db, makeReq({}), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    const txStart = rec.statements.findIndex((s) => s.includes('sales_prepayment_gate_results') && s.includes('snapshot_key'));
    // The canonical helper issues one WHERE id=? statement per planned parent, sorted.
    const lockSlots = rec.statements.slice(txStart).map((s, i) => ({ s, i }))
      .filter(({ s }) => s.includes('settlement_unapplied_balances') && s.includes('WHERE id=?'));
    assert.equal(lockSlots.length, 3, 'each of the three eligible parents must be locked individually');
    const orderedIds = ['sub-w7', 'sub-w7-a', 'sub-w7-b'];
    assert.deepEqual(orderedIds, [...orderedIds].sort(), 'the canonical ascending order');
    for (let i = 1; i < lockSlots.length; i += 1) {
      assert.ok(lockSlots[i - 1].i < lockSlots[i].i, 'parent lock statements must be issued one after another');
    }
    const decision = db.prepare("SELECT gate_decision, eligible_advance_cents FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7' ORDER BY evaluated_at DESC LIMIT 1").get();
    assert.equal(decision.gate_decision, 'PASS');
    assert.equal(decision.eligible_advance_cents, 150000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: the manual gate never re-enters a parent lock after the Gate locks', () => {
  const source = readFileSync(resolve('server/modules/sales-prepayment-gate.js'), 'utf8');
  const body = source.slice(source.indexOf('export async function evaluateSalesPrepaymentGate'), source.indexOf('export function listPrepaymentGateResults'));
  const lock = body.indexOf('lockEligiblePrepaymentParents(db, plan.parentBalanceIds)');
  const assertCurrent = body.indexOf('assertPrepaymentParentPlanCurrent(db,');
  const resultLock = body.indexOf('ORDER BY evaluated_at DESC, id DESC LIMIT 1${lock}');
  const requirementLock = body.indexOf('sales_prepayment_requirements WHERE id=?${lock}');
  const evidence = body.indexOf("lockMode: 'NONE'");
  assert.ok(lock > 0, 'the canonical parent lock must be taken');
  assert.ok(assertCurrent > lock && assertCurrent < resultLock, 'the candidate set must be asserted current immediately after the parent lock');
  assert.ok(resultLock > assertCurrent && requirementLock > resultLock, 'PARENT -> RESULT -> REQUIREMENT');
  assert.ok(evidence > requirementLock, 'the Finance child-effect read must follow both Gate locks');
  assert.ok(!/lockMode:\s*'FOR_UPDATE'/.test(body), 'a FOR_UPDATE resolve after the Gate locks would reintroduce a late parent lock');
  assert.ok(!body.includes('resolveEligiblePrepaymentWithParentPlan'), 'that helper re-locks parents internally and must not run after the Gate locks');
});

test('W7-C2 shared helper: Parent freshness precedes Result/Requirement and no Parent lock follows L7', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedExtraBalances(db, userId, now, [['sub-w7-b', 30000], ['sub-w7-a', 20000]]);
    seedRequirement(db, userId, now, { amount: 40000 });
    db.prepare(`INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,
      required_remaining_cents,eligible_advance_cents,refunded_amount_cents,applied_amount_cents,
      source_balance_identities,snapshot_key,evaluated_at,evaluated_by)
      VALUES('gate-shared','so-w7','DELIVERY','PASS',40000,150000,0,0,'[]','shared-eval',?,?)`).run(now, userId);
    const plan = discoverSalesPrepaymentGatePlan(db, 'so-w7', DAY);
    const rec = recordingDb(db);
    let result;
    transaction(rec.db, () => {
      result = authorizeSalesPrepaymentGateWithPlan(rec.db, plan, {
        stage: 'DELIVERY', actorId: userId, mutationKey: 'shared-authorize',
      });
    });
    assert.equal(result.state, 'PASS');
    const parentLocks = rec.statements.map((sql, index) => ({ sql, index }))
      .filter(({ sql }) => sql.includes('settlement_unapplied_balances') && sql.includes('WHERE id=?'));
    const resultLock = rec.statements.findIndex((sql) => sql.includes('sales_prepayment_gate_results') && sql.includes('ORDER BY evaluated_at DESC'));
    const requirementLock = rec.statements.findIndex((sql) => sql.includes('sales_prepayment_requirements WHERE id='));
    assert.equal(parentLocks.length, 3, 'each planned Parent is locked exactly once');
    assert.ok(parentLocks.every(({ index }) => index < resultLock), 'all Parent locks precede the Gate Result');
    assert.ok(resultLock > 0 && requirementLock > resultLock, 'Parent -> Result -> Requirement');
    assert.equal(parentLocks.filter(({ index }) => index > requirementLock).length, 0, 'no Parent FOR UPDATE after L7');
    const source = readFileSync(resolve('server/modules/sales-prepayment-gate.js'), 'utf8');
    const body = source.slice(source.indexOf('export function authorizeSalesPrepaymentGateWithPlan'), source.indexOf('// ---------- public API'));
    assert.ok(!body.includes('resolveEligiblePrepaymentWithParentPlan'), 'shared helper must not re-enter the Parent-locking resolver');
    assert.ok(body.includes("lockMode: 'NONE'"), 'Finance evidence must read beneath the existing Parent locks');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Finance adapter: unsupported Parent preserves status/message/code and fails closed', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    db.prepare("UPDATE settlement_unapplied_balances SET balance_type='CREDIT' WHERE id='sub-w7'").run();
    assert.throws(
      () => lockEligiblePrepaymentParents(db, ['sub-w7']),
      (error) => error instanceof HttpError
        && error.status === 409
        && error.message === '结算余额类型不支持预付门: CREDIT'
        && error.details?.code === 'SALES_PREPAYMENT_PARENT_TYPE_UNSUPPORTED',
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: a newly appearing parent fails closed as a stale plan and leaves no Gate result', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const discover = () => discoverEligiblePrepaymentParents(db, { customerId: 'cus-w7', businessDate: DAY });
    const plannedBefore = discover();
    assert.deepEqual(plannedBefore, ['sub-w7']);
    seedExtraBalances(db, userId, now, [['sub-late', 5000]]);
    assert.throws(() => {
      lockEligiblePrepaymentParents(db, plannedBefore);
      assertPrepaymentParentPlanCurrent(db, { customerId: 'cus-w7', businessDate: DAY }, plannedBefore);
    }, (err) => err instanceof HttpError && err.details?.code === 'SALES_PREPAYMENT_LOCK_PLAN_STALE');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0, 'a stale plan must leave no gate result');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE entity_type=\'SALES_PREPAYMENT_GATE\'').get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: a closing parent is refused and an empty planned set skips the lock cleanly', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    db.prepare("UPDATE settlement_unapplied_balances SET status='EXHAUSTED' WHERE id='sub-w7'").run();
    assert.throws(
      () => lockEligiblePrepaymentParents(db, ['sub-w7']),
      (err) => err instanceof HttpError && /已关闭/.test(err.message),
    );
    db.prepare("UPDATE settlement_unapplied_balances SET status='OPEN' WHERE id='sub-w7'").run();
    db.prepare('DELETE FROM settlement_unapplied_balances').run();
    assert.deepEqual(lockEligiblePrepaymentParents(db, []), [], 'an empty planned set takes no parent lock');
    assert.deepEqual(assertPrepaymentParentPlanCurrent(db, { customerId: 'cus-w7', businessDate: DAY }, []), []);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: Finance child effects remain the monetary authority across evaluations', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now, { amount: 40000 });
    const actor = actorUser(db, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'child-1' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    let row = db.prepare("SELECT gate_decision, eligible_advance_cents FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7' AND snapshot_key='child-1'").get();
    assert.equal(row.gate_decision, 'PASS'); assert.equal(row.eligible_advance_cents, 100000);

    db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,status,creator_id,created_at) VALUES('ba-w7','BA-W7','AR','PREPAYMENT','sub-w7','oi-w7',30000,?,'CONFIRMED',?,?)`).run(DAY, userId, now);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'child-2' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    row = db.prepare("SELECT gate_decision, eligible_advance_cents, applied_amount_cents FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7' AND snapshot_key='child-2'").get();
    assert.equal(row.eligible_advance_cents, 70000); assert.equal(row.applied_amount_cents, 30000);

    db.prepare(`INSERT INTO financial_refunds(id,refund_no,side,balance_id,party_id,amount_cents,business_date,settlement_account_id,payment_method,reference,reason,creator_id,created_at) VALUES('fr-w7','FR-W7','CUSTOMER','sub-w7','cus-w7',80000,?,'acc-w7','BANK','','测试退款',?,?)`).run(DAY, userId, now);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'child-3' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    row = db.prepare("SELECT gate_decision, eligible_advance_cents, refunded_amount_cents FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7' AND snapshot_key='child-3'").get();
    assert.equal(row.eligible_advance_cents, 0); assert.equal(row.refunded_amount_cents, 80000);
    assert.equal(row.gate_decision, 'BLOCK', 'zero eligibility must still BLOCK');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: replay returns the original result with no second Gate Result or audit row', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const first = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'replay-w7' }), first, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.replayed, undefined);
    const results = db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n;
    const audits = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE' AND action='EVALUATE'").get().n;
    assert.equal(results, 1); assert.equal(audits, 1);

    const replay = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'replay-w7' }), replay, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, results);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE' AND action='EVALUATE'").get().n, audits);

    const other = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'replay-w7-b' }), other, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(other.statusCode, 201, 'a different snapshot identity is a distinct decision, not a replay');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, results + 1);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: a rejected evaluation emits no success response and leaves no durable Gate effect', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    db.prepare("UPDATE sales_prepayment_requirements SET effective_from='2999-01-01' WHERE id='req-w7'").run();
    const res = makeRes();
    await assert.rejects(
      evaluateSalesPrepaymentGate(db, makeReq({}), res, actor, 'so-w7', 'PLANNING_RELEASE'),
      (err) => err instanceof HttpError && err.details?.code === 'SALES_PREPAYMENT_REQUIREMENT_MISSING',
    );
    assert.equal(res.statusCode, null, 'no response may be emitted for a rejected evaluation');
    assert.equal(res.ended, false, 'the response must not be ended before a commit');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('W7-C1: SALES_MANAGE authorization and stage validation remain fail closed', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const res = makeRes();
    await assert.rejects(
      evaluateSalesPrepaymentGate(db, makeReq({}), res, { id: userId, roleCode: 'SALES', permissions: ['SALES_VIEW'], isSystemAdmin: false }, 'so-w7', 'PLANNING_RELEASE'),
      (err) => err instanceof HttpError && err.status === 403,
    );
    await assert.rejects(
      evaluateSalesPrepaymentGate(db, makeReq({}), res, actorUser(db, userId), 'so-w7', 'NOT_A_STAGE'),
      (err) => err instanceof HttpError && err.status === 400,
    );
    assert.equal(res.statusCode, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- W7-C1 Implementation B completion: bounded outer fresh-discovery retry ----------

test('B-R1: a stale first attempt re-discovers and the second attempt succeeds', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, {
      parent: { times: 1, sql: `INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-drift','CUSTOMER','PREPAYMENT','cus-w7','PAYMENT_COLLECTION','pc-drift','PC-DRIFT',10000,?,NULL,'OPEN',?,?)`, args: [DAY, userId, now] },
    });
    const res = makeRes();
    await evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-1', businessDate: DAY }), res, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(res.statusCode, 201);
    assert.equal(inj.state.attempts, 2, 'the first stale attempt must be followed by exactly one re-discovery');
    const row = db.prepare("SELECT gate_decision, eligible_advance_cents, snapshot_key FROM sales_prepayment_gate_results WHERE snapshot_key='retry-1'").get();
    assert.equal(row.eligible_advance_cents, 100000, 'the retried attempt must use the re-discovered plan, not the drifted one');
    assert.equal(row.snapshot_key, 'retry-1');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, 1, 'the failed attempt must leave no Gate Result');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 1);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R2: a parent appearing between discovery and lock is classified as a stale plan', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, { parent: { times: 99, sql: `INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-drift','CUSTOMER','PREPAYMENT','cus-w7','PAYMENT_COLLECTION','pc-drift','PC-DRIFT',10000,?,NULL,'OPEN',?,?)`, args: [DAY, userId, now] } });
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-2' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE'),
      (err) => err instanceof HttpError
        && err.status === 503
        && err.code === 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED'
        && err.details?.cause === 'SALES_PREPAYMENT_LOCK_PLAN_STALE',
    );
    assert.equal(inj.state.attempts, 3, 'exhaustion must stop at the bounded attempt count');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results").get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R3: a discovered parent that closes mid-attempt yields the structured closed-parent code and retries', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 60000);
    seedExtraBalances(db, userId, now, [['sub-w7-a', 40000]]);
    seedRequirement(db, userId, now, { amount: 50000 });
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, { parent: { times: 1, sql: `UPDATE settlement_unapplied_balances SET status='EXHAUSTED' WHERE id='sub-w7-a'` } });
    const res = makeRes();
    await evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-3' }), res, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(res.statusCode, 201);
    assert.equal(inj.state.attempts, 2, 'a parent closing mid-attempt must be retried, not accepted');
    // The closure is rolled back with the failed attempt, so the committed decision is
    // evaluated against the re-discovered eligible set.
    const row = db.prepare("SELECT eligible_advance_cents, gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='retry-3'").get();
    assert.equal(row.eligible_advance_cents, 100000);
    assert.equal(row.gate_decision, 'PASS');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R3b: the closed-parent refusal carries a structured code, not a message-text contract', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    db.prepare("UPDATE settlement_unapplied_balances SET status='EXHAUSTED' WHERE id='sub-w7'").run();
    assert.throws(
      () => lockEligiblePrepaymentParents(db, ['sub-w7']),
      (err) => err instanceof HttpError && err.status === 409 && err.code === 'SALES_PREPAYMENT_PARENT_CLOSED',
    );
    db.prepare("UPDATE settlement_unapplied_balances SET status='OPEN' WHERE id='sub-w7'").run();
    db.prepare('DELETE FROM settlement_unapplied_balances').run();
    assert.throws(
      () => lockEligiblePrepaymentParents(db, ['sub-w7-gone']),
      (err) => err instanceof HttpError && err.code === 'SALES_PREPAYMENT_PARENT_MISSING',
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R4: a requirement changing during the attempt is a stale plan, and the retry uses the new requirement', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now, { amount: 40000 });
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, { requirement: { times: 1, sql: `UPDATE sales_prepayment_requirements SET required_amount_cents=90000 WHERE id='req-w7'` } });
    const res = makeRes();
    await evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-4' }), res, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(res.statusCode, 201);
    assert.equal(inj.state.attempts, 2, 'a mid-attempt requirement change must be detected and retried');
    // The injected change is rolled back together with the failed attempt, so the
    // committed decision is evaluated against the re-discovered (unchanged) requirement.
    const row = db.prepare("SELECT required_remaining_cents, gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='retry-4'").get();
    assert.equal(row.required_remaining_cents, 40000);
    assert.equal(row.gate_decision, 'PASS');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R5: exhaustion stops at the bound, emits no success response and leaves no durable effect', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, { requirement: { times: 99, sql: `UPDATE sales_prepayment_requirements SET required_amount_cents=required_amount_cents+1 WHERE id='req-w7'` } });
    const res = makeRes();
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-5' }), res, actor, 'so-w7', 'PLANNING_RELEASE'),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 503);
        assert.equal(err.code, 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED');
        assert.equal(err.message, '预付款门评估重试次数已耗尽，请稍后重试');
        assert.deepEqual(err.details, {
          code: 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED',
          retryable: true,
          attempts: 3,
          cause: 'SALES_PREPAYMENT_LOCK_PLAN_STALE',
        });
        const publicError = serializeError(err, 'request-f1');
        assert.equal(publicError.status, 503);
        assert.equal(publicError.code, 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED');
        assert.equal(publicError.error, '预付款门评估重试次数已耗尽，请稍后重试');
        assert.equal(publicError.message, '预付款门评估重试次数已耗尽，请稍后重试');
        assert.deepEqual(publicError.details, err.details);
        return true;
      },
    );
    assert.equal(inj.state.attempts, 3, 'exactly the bounded number of outer attempts');
    assert.equal(res.statusCode, null, 'no success response may be emitted when the bound is exhausted');
    assert.equal(res.ended, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F1: a configured single outer attempt returns the exact exhaustion contract', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previous = process.env.ERP_GATE_ATTEMPTS_MAX;
  process.env.ERP_GATE_ATTEMPTS_MAX = '1';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const inj = injectingDb(db, { requirement: { times: 99, sql: `UPDATE sales_prepayment_requirements SET required_amount_cents=required_amount_cents+1 WHERE id='req-w7'` } });
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'f1-max-one' }), makeRes(), actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => error instanceof HttpError
        && error.status === 503
        && error.details?.code === 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED'
        && error.details?.attempts === 1
        && error.details?.cause === 'SALES_PREPAYMENT_LOCK_PLAN_STALE',
    );
    assert.equal(inj.state.attempts, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 0);
  } finally {
    if (previous === undefined) delete process.env.ERP_GATE_ATTEMPTS_MAX;
    else process.env.ERP_GATE_ATTEMPTS_MAX = previous;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F1/F2-20: classified inner concurrency exhaustion is rediscovered without inflating outer attempts', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previous = process.env.ERP_GATE_ATTEMPTS_MAX;
  process.env.ERP_GATE_ATTEMPTS_MAX = '3';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    let attempts = 0;
    const throwing = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (text) => {
            const sql = String(text);
            if (sql.includes('FROM sales_prepayment_gate_results') && sql.includes('AND snapshot_key=?')) {
              attempts += 1;
              const error = new Error('fault-injected deadlock victim');
              error.code = 'DRIVER_INTERNAL_DEADLOCK_DETAIL';
              error.errno = 1213;
              error.transactionRetryExhausted = true;
              throw error;
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(
      evaluateSalesPrepaymentGate(throwing, makeReq({ snapshotKey: 'f1-inner-exhaust' }), makeRes(), actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => error instanceof HttpError
        && error.status === 503
        && error.details?.code === 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED'
        && error.details?.attempts === 3
        && error.details?.cause === 'ER_LOCK_DEADLOCK',
    );
    assert.equal(attempts, 3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 0);
  } finally {
    if (previous === undefined) delete process.env.ERP_GATE_ATTEMPTS_MAX;
    else process.env.ERP_GATE_ATTEMPTS_MAX = previous;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F1/F2-13: unsupported Parent remains an immediate 409 even if time elapses during the attempt', async (t) => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previous = process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
  process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = '1000';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    installMonotonicClock(t, [0n, 0n, 2_000_000_000n]);
    const inj = injectingDb(db, {
      parent: { times: 99, sql: "UPDATE settlement_unapplied_balances SET balance_type='CREDIT' WHERE id='sub-w7'" },
    });
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'f1-unsupported' }), makeRes(), actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => error instanceof HttpError
        && error.status === 409
        && error.details?.code === 'SALES_PREPAYMENT_PARENT_TYPE_UNSUPPORTED',
    );
    assert.equal(inj.state.attempts, 1, 'unsupported Parent is not rediscovered or converted to exhaustion');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
  } finally {
    if (previous === undefined) delete process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
    else process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = previous;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R6: an ordinary business 409 is never retried', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    let attempts = 0;
    // Force a non-drift business rejection inside the transaction itself.
    const throwing = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (text) => {
            const sql = String(text);
            if (sql.includes('FROM sales_prepayment_gate_results') && sql.includes('AND snapshot_key=?')) attempts += 1;
            if (sql.includes('sales_prepayment_gate_results') && sql.includes('ORDER BY evaluated_at DESC')) {
              throw new HttpError(409, '并发确认冲突', { code: 'SOME_BUSINESS_RULE' });
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(
      evaluateSalesPrepaymentGate(throwing, makeReq({ snapshotKey: 'retry-6' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE'),
      (err) => err instanceof HttpError && err.code === 'SOME_BUSINESS_RULE',
    );
    assert.equal(attempts, 1, 'a business rejection must not trigger re-discovery');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results").get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R7/B-R8: a replay after retried attempts adds no second Gate Result or audit row', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, {
      parent: { times: 1, sql: `INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-drift','CUSTOMER','PREPAYMENT','cus-w7','PAYMENT_COLLECTION','pc-drift','PC-DRIFT',10000,?,NULL,'OPEN',?,?)`, args: [DAY, userId, now] },
    });
    await evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-7', businessDate: DAY }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    const results = db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n;
    const audits = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE' AND action='EVALUATE'").get().n;
    assert.equal(results, 1); assert.equal(audits, 1);
    const replay = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'retry-7', businessDate: DAY }), replay, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get().n, results);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE' AND action='EVALUATE'").get().n, audits);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R9/B-R10: business date and snapshot identity stay stable and the lock order holds on every attempt', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedExtraBalances(db, userId, now, [['sub-w7-a', 20000]]);
    seedRequirement(db, userId, now, { amount: 30000 });
    const actor = actorUser(db, userId);
    const inj = injectingDb(db, { requirement: { times: 1, sql: `UPDATE sales_prepayment_requirements SET required_amount_cents=required_amount_cents+1 WHERE id='req-w7'` } });
    await evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'retry-9', businessDate: DAY }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(inj.state.attempts, 2);
    // Split the recorder into one transaction slice per attempt and assert the order.
    const slices = [];
    let current = null;
    for (const sql of inj.state.statements) {
      if (sql.includes('FROM sales_prepayment_gate_results') && sql.includes('AND snapshot_key=?')) { current = []; slices.push(current); }
      else if (current) current.push(sql);
    }
    assert.equal(slices.length, 2);
    for (const slice of slices) {
      const parent = slice.findIndex((s) => s.includes('settlement_unapplied_balances'));
      const result = slice.findIndex((s) => s.includes('ORDER BY evaluated_at DESC'));
      const requirement = slice.findIndex((s) => s.includes('sales_prepayment_requirements WHERE id='));
      // The drift here is injected at the requirement lock, so BOTH attempts reach all
      // three lock stages and the full order is observable on each of them.
      assert.ok(parent > 0 && result > parent && requirement > result, 'PARENT -> RESULT -> REQUIREMENT on every attempt');
      // No parent lock may be issued after the Gate locks on any attempt.
      const lastRequirement = slice.lastIndexOf(slice.filter((s) => s.includes('sales_prepayment_requirements WHERE id='))[0]);
      const afterRequirement = slice.slice(lastRequirement + 1)
        .filter((s) => s.includes('settlement_unapplied_balances') && s.includes('WHERE id=?'));
      assert.equal(afterRequirement.length, 0, 'no parent lock after the Gate Requirement lock');
    }
    const row = db.prepare("SELECT snapshot_key, eligible_advance_cents FROM sales_prepayment_gate_results WHERE sales_order_id='so-w7'").get();
    assert.equal(row.snapshot_key, 'retry-9', 'snapshot identity is stable across attempts');
    assert.equal(row.eligible_advance_cents, 120000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('B-R12/F2-22: Implementation A authority and the L1-L8 Gate order remain intact', () => {
  const finance = readFileSync(resolve('server/modules/financial-controls.js'), 'utf8');
  const refund = finance.slice(finance.indexOf('export async function createRefund'), finance.indexOf('export async function reverseRefund'));
  const refundLock = refund.indexOf('acquireParentBalanceLock(db, balance.id)');
  const refundAuthority = refund.indexOf('const currentAvailable = unappliedBalanceSnapshot(db, balance.id).remainingCents');
  const refundVoucher = refund.indexOf('generateVoucher(db');
  assert.ok(refundLock > 0 && refundAuthority > refundLock && refundVoucher > refundAuthority,
    'Implementation A: refund capacity authority must stay after the parent lock and before the voucher');

  const gate = readFileSync(resolve('server/modules/sales-prepayment-gate.js'), 'utf8');
  const body = gate.slice(gate.indexOf('export async function evaluateSalesPrepaymentGate'), gate.indexOf('export function listPrepaymentGateResults'));
  assert.ok(body.includes("lockMode: 'NONE'"), 'Implementation B: no FOR_UPDATE resolve may remain after the Gate locks');
  assert.ok(body.includes('discoverSalesPrepaymentGatePlan(db, salesOrderId, asOf)'), 'Implementation B: every outer attempt re-discovers');
  assert.ok(body.includes('isGateRediscoveryEligible(error)'), 'Implementation B: retry admission is classified, never message-matched');
});

test('F2-09/F2-16/F2-17: Manual Gate deadline before attempt 1 returns attempts=0 and exact cause contract', async (t) => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previous = process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
  process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = '1000';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    installMonotonicClock(t, [0n, 1_000_000_000n]);
    const res = makeRes();
    await assert.rejects(
      evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'f2-before-first' }), res, actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED');
        assert.equal(error.message, '预付款门评估重试次数已耗尽，请稍后重试');
        assert.deepEqual(error.details, {
          code: 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED',
          retryable: true,
          attempts: 0,
          cause: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
        });
        return true;
      },
    );
    assert.equal(res.ended, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PREPAYMENT_GATE'").get().n, 0);
  } finally {
    if (previous === undefined) delete process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
    else process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = previous;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F2-10/F2-18/F2-19: one budget spans rollback and blocks attempt 3 with attempts=2', async (t) => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previous = process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
  process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = '1000';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const inj = injectingDb(db, { requirement: { times: 99, sql: "UPDATE sales_prepayment_requirements SET required_amount_cents=required_amount_cents+1 WHERE id='req-w7'" } });
    installMonotonicClock(t, [0n, 0n, 500_000_000n, 500_000_000n, 1_000_000_000n]);
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'f2-two-attempts' }), makeRes(), actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => error.status === 503
        && error.details?.attempts === 2
        && error.details?.cause === 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
    );
    assert.equal(inj.state.attempts, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results').get().n, 0);
  } finally {
    if (previous === undefined) delete process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
    else process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = previous;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F2-11/F2-12: final-count cause wins, while committed success is never rechecked against elapsed time', async (t) => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  const previousMax = process.env.ERP_GATE_ATTEMPTS_MAX;
  const previousBudget = process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
  process.env.ERP_GATE_ATTEMPTS_MAX = '1';
  process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = '1000';
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    installMonotonicClock(t, [0n, 0n, 2_000_000_000n]);
    const inj = injectingDb(db, { requirement: { times: 1, sql: "UPDATE sales_prepayment_requirements SET required_amount_cents=required_amount_cents+1 WHERE id='req-w7'" } });
    await assert.rejects(
      evaluateSalesPrepaymentGate(inj.db, makeReq({ snapshotKey: 'f2-count-wins' }), makeRes(), actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE'),
      (error) => error.details?.attempts === 1 && error.details?.cause === 'SALES_PREPAYMENT_LOCK_PLAN_STALE',
    );
    t.mock.restoreAll();
    const successClock = installMonotonicClock(t, [0n, 0n, 2_000_000_000n]);
    const res = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'f2-success-after' }), res, actorUser(db, userId), 'so-w7', 'PLANNING_RELEASE');
    assert.equal(res.statusCode, 201);
    assert.equal(successClock.mock.callCount(), 2, 'success is returned without a post-commit deadline check');
  } finally {
    if (previousMax === undefined) delete process.env.ERP_GATE_ATTEMPTS_MAX;
    else process.env.ERP_GATE_ATTEMPTS_MAX = previousMax;
    if (previousBudget === undefined) delete process.env.ERP_GATE_ATTEMPTS_BUDGET_MS;
    else process.env.ERP_GATE_ATTEMPTS_BUDGET_MS = previousBudget;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('F2-14/F2-15: Manual Gate committed replay bypasses the clock and transaction-local replay remains present', async (t) => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    seedRequirement(db, userId, now);
    const actor = actorUser(db, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'f2-replay' }), makeRes(), actor, 'so-w7', 'PLANNING_RELEASE');
    const monotonic = installMonotonicClock(t, [0n, 1_000_000_000n]);
    const replay = makeRes();
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'f2-replay' }), replay, actor, 'so-w7', 'PLANNING_RELEASE');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(monotonic.mock.callCount(), 0, 'committed replay returns before admission starts');
    const source = readFileSync(resolve('server/modules/sales-prepayment-gate.js'), 'utf8');
    const body = source.slice(source.indexOf('export async function evaluateSalesPrepaymentGate'), source.indexOf('export function listPrepaymentGateResults'));
    assert.equal((body.match(/WHERE sales_order_id=\? AND stage=\? AND snapshot_key=\?/g) || []).length, 1,
      'the transaction-local replay probe must remain active');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
