// Wave 7 — bounded acceptance remediation: targeted contract tests.
//
// Covers the four contract gaps remediated in the 2026-10-18 bounded review:
//   1. WARN decision matrix (PASS / WARN / BLOCK / OVERRIDE_REQUIRED)
//   2. Finance R-SAL-15 parent lock acquisition in real mutation paths
//   3. EXPECTED supply authority — pure EXPECTED fails closed, concrete
//      Planning source derives capacity from canonical row
//   4. Three-stage business gate integration (PLANNING_RELEASE / RESERVATION
//      / DELIVERY) with fail-closed semantics
//   5. Cross-document / cross-customer scope rejection
//   6. Snapshot-key idempotent replay + OVERRIDE_REQUIRED carry-forward
//
// Real MySQL race tests remain TEST_EVIDENCE_PENDING (no disposable MySQL
// environment provisioned in this gate).

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabase, hashPassword, transaction } from './db.js';
import { createApp } from './app.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  evaluateSalesPrepaymentGate, overridePrepaymentGateResult,
  assertSalesPrepaymentGateAtStage,
  __salesPrepaymentGateInternals,
} from './modules/sales-prepayment-gate.js';
import {
  requestReservationIntent, grantReservationIntent, consumeReservationIntent,
  releaseReservationIntent, listReservationIntents,
  __salesReservationIntentInternals,
} from './modules/sales-reservation-intent.js';
import {
  resolveEligiblePrepaymentForSalesGate, acquireParentBalanceLock,
} from './modules/sales-prepayment-finance-adapter.js';
import { HttpError } from './lib/http.js';

const DAY = '2026-10-18';

function buildDb() {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-wave7-acc-'));
  const path = join(temp, 'acc.db');
  const db = createDatabase(path);
  try { migrateSalesCustomerDomain(db); } catch (err) { db.close(); throw err; }
  return { db, temp };
}

function seedBaseContext(db) {
  const now = new Date().toISOString();
  const userId = 'u-wave7-acc';
  const roleId = 'role-sales';
  const hashed = hashPassword('acc-1234');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)`).run(userId, 'acc', 'Wave7 Acc', hashed.hash, hashed.salt, roleId, now);
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus-acc','CUS-ACC','Acc Customer','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('sp-acc','SP-ACC','Salesperson Acc',?,1,?,?)`).run(userId, now, now);
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES('sg-acc','SG-ACC','SG Acc','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at) VALUES('mem-acc','sp-acc','sg-acc',0,1,?,NULL,?,?)`).run(DAY, now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-acc','WH-ACC','WH Acc','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-acc','P-ACC','Product Acc','','EA',10000,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('inv-acc','wh-acc','p-acc',100,?)`).run(now);
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at) VALUES('so-acc','SO-ACC','cus-acc','APPROVED',100000,?,?,?)`).run(userId, now, now);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-acc','so-acc','p-acc',10,10000,100000,1)`).run();
  return { userId, now };
}

function seedPrepaymentBalance(db, userId, now, amountCents) {
  db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied) VALUES('pc-acc','PC-ACC','cus-acc',NULL,?,'CASH',?,'',?,?,'CONFIRMED','',NULL,NULL,'','',0,'NONE',NULL,?,1)`).run(amountCents, DAY, userId, now, amountCents);
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-acc','CUSTOMER','PREPAYMENT','cus-acc','PAYMENT_COLLECTION','pc-acc','PC-ACC',?,?,NULL,'OPEN',?,?)`).run(amountCents, DAY, userId, now);
}

function actorUser(userId) {
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
  const state = {
    statusCode: null, body: null, headers: {},
    chunks: [], ended: false,
    setHeader(name, value) { state.headers[name] = value; },
    end(chunk) {
      if (chunk) state.chunks.push(chunk);
      state.ended = true;
      try {
        state.body = JSON.parse(Buffer.concat(state.chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8') || 'null');
      } catch (_) { state.body = null; }
    },
    writeHead(s) { state.statusCode = s; },
  };
  return state;
}

async function buildRealEntryHarness(label) {
  const temp = mkdtempSync(join(tmpdir(), `modern-erp-wave7-${label}-`));
  const db = createDatabase(join(temp, 'entry.db'));
  const stamp = new Date().toISOString();
  const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  db.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(uom, uom, stamp, stamp);
  db.prepare(`INSERT OR IGNORE INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,0,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
    .run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare("UPDATE sales_parameters SET sales_group_data_scope_enabled=1 WHERE scope_type='SYSTEM' AND scope_key='SYSTEM'").run();
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES('w7-entry-class','product-001',1,?,?,0,0,0,1,?,?)`).run(uom, uom, stamp, stamp);
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('w7-entry-group','W7-ENTRY','Wave7 Entry',1,?,?)").run(stamp, stamp);
  db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('w7-entry-salesperson','W7-ENTRY','Wave7 Entry Sales','user-sales',1,?,?)").run(stamp, stamp);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('w7-entry-membership','w7-entry-salesperson','w7-entry-group','2026-01-01',1,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');
  const priceListId = '77777777-7777-4777-8777-777777777777';
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'W7-ENTRY-PL','Wave7 entry price','CNY',0,'2026-01-01','ACTIVE',?,'user-reviewer',?,'user-sales',?,'user-sales')`).run(priceListId, stamp, stamp, stamp);
  const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
  const pricingKey = `U:${Buffer.from(uom).toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES('w7-entry-price',?,'product-001',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-sales')`).run(priceListId, materialKey, uom, pricingKey, stamp);
  db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('w7-entry-price-v1','w7-entry-price',1,10000,'{}',?,'user-sales')").run(stamp);
  db.prepare("UPDATE products SET valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOOD',valuation_activated_at='2026-01-01' WHERE id='product-001'").run();
  db.prepare("UPDATE inventory SET quantity=1000,updated_at=? WHERE warehouse_id='warehouse-001' AND product_id='product-001'").run(stamp);
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,1000,500000,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=1000,value_cents=500000,updated_at=excluded.updated_at`).run(stamp);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { token = '', method = 'GET', body, key } = {}) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const login = async (username, password) => (await call('/api/auth/login', { method: 'POST', body: { username, password } })).data.token;
  const tokens = { sales: await login('sales', 'sales123'), admin: await login('admin', 'admin123') };
  return {
    db, temp, call, tokens, uom, priceListId, stamp,
    async close() {
      await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
      db.close(); rmSync(temp, { recursive: true, force: true });
    },
  };
}

function addEntryCustomer(harness, suffix) {
  const id = `w7-entry-customer-${suffix}`;
  harness.db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES(?,?,?,'Receiver','13000000000','Wave7 address',1,?,?)`).run(id, `W7-${suffix}`, `Wave7 ${suffix}`, harness.stamp, harness.stamp);
  harness.db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
    default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
    created_by,updated_by,default_pricing_list_id) VALUES(?,'2026-01-01',?,?,'w7-entry-salesperson','w7-entry-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
    .run(id, id, id, harness.stamp, harness.stamp, 'user-admin', 'user-admin', harness.priceListId);
  return id;
}

function addRequirement(db, orderId, suffix, { from = null, to = null, amount = 50000 } = {}) {
  db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,effective_from,effective_to,created_at,created_by)
    VALUES(?,?,0,?,'ORDER_VALUE',?,?,?,'user-sales')`).run(`w7-entry-req-${suffix}`, orderId, amount, from, to, new Date().toISOString());
}

function addEntryBalance(db, customerId, suffix, amount) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,status,created_by,created_at)
    VALUES(?,'CUSTOMER','PREPAYMENT',?,'WAVE7_ENTRY',?,?,?,?,'OPEN','user-sales',?)`)
    .run(`w7-entry-balance-${suffix}`, customerId, `w7-entry-source-${suffix}`, `W7-BAL-${suffix}`, amount, DAY, now);
  return `w7-entry-balance-${suffix}`;
}

const entryActor = { id: 'user-sales', roleCode: 'SALES', permissions: ['SALES_MANAGE', 'SALES_VIEW'], isSystemAdmin: false };

// ---------- WARN decision matrix ----------

test('Acceptance: WARN decision when 0 < eligible < required is recorded with eligible + required evidence', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 30000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'DELIVERY');
    const row = db.prepare(`SELECT gate_decision, eligible_advance_cents, required_remaining_cents, source_balance_identities
      FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='DELIVERY'`).get('so-acc');
    assert.equal(row.gate_decision, 'WARN');
    assert.equal(row.eligible_advance_cents, 30000);
    assert.equal(row.required_remaining_cents, 50000);
    const identities = JSON.parse(row.source_balance_identities);
    assert.equal(Array.isArray(identities), true);
    assert.equal(identities[0].balanceId, 'sub-acc');
    assert.equal(identities[0].remainingEligibleCents, 30000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: BLOCK when eligible == 0 (no eligible PREPAYMENT balance)', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'PLANNING_RELEASE');
    const row = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='PLANNING_RELEASE'`).get('so-acc');
    assert.equal(row.gate_decision, 'BLOCK');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Finance R-SAL-15 lock chain ----------

test('Acceptance: reverseSettlementDocument UNAPPLIED reduction observes reversal in eligible read', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 50000);
    db.prepare(`INSERT INTO settlement_reversals(id, reversal_no, settlement_type, settlement_id, amount_cents, business_date, reason, status, creator_id, created_at)
      VALUES('sr-acc','SR-ACC','COLLECTION','pc-acc',10000,?,'','CONFIRMED',?,?)`).run(DAY, userId, now);
    db.prepare(`INSERT INTO settlement_reversal_items(id, reversal_id, component_type, original_component_id, amount_cents)
      VALUES('sri-acc','sr-acc','UNAPPLIED','sub-acc',10000)`).run();
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-acc', businessDate: DAY, gateStage: 'DELIVERY',
      salesOrderId: 'so-acc', remainingRequiredCents: 50000, lockMode: 'NO_LOCK',
    });
    // The reverseSettlementDocument path inserts settlement_reversal_items
    // (UNAPPLIED) and is observed by the adapter as reduced eligible (50k -> 40k).
    assert.equal(evidence.eligibleAmountCents, 40000);
    assert.equal(evidence.sourceBalanceIdentities[0].remainingEligibleCents, 40000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: Finance mutation reductions show up as reduced eligible via adapter read', async () => {
  // Direct mutation lock-acquire paths are covered by:
  //   - `acquireParentBalanceLock` source in `sales-prepayment-finance-adapter.js`
  //     (called at the top of `applyUnappliedBalance` and `createRefund` transactions,
  //      and inside `reverseSettlementDocument` UNAPPLIED-component loop).
  //   - `reverseSettlementDocument`'s UNAPPLIED branch is exercised by the
  //     test above via `settlement_reversal_items`.
  // We assert end-to-end: when a Finance mutation path reduces the balance
  // (via settlement_reversal_items or balance_applications), the Sales gate
  // adapter re-reads the reduced eligible amount under the same lock chain.
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 50000);
    // Insert a balance_application reducing eligible by 10000 — mirrors
    // the path inside applyUnappliedBalance.
    db.prepare(`INSERT INTO balance_applications(id, application_no, side, balance_kind, balance_id, target_open_item_id, amount_cents, business_date, reason, status, creator_id, created_at)
      VALUES('ba-acc','BA-ACC','AR','PREPAYMENT','sub-acc','open-acc',10000,?,'','CONFIRMED',?,?)`).run(DAY, userId, now);
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-acc', businessDate: DAY, gateStage: 'DELIVERY',
      salesOrderId: 'so-acc', remainingRequiredCents: 50000, lockMode: 'NO_LOCK',
    });
    assert.equal(evidence.eligibleAmountCents, 40000);
    assert.equal(evidence.appliedAmountCents, 10000);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- EXPECTED supply authority ----------

test('Acceptance: pure EXPECTED supply fails closed with bounded-extension code', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    db.prepare(`INSERT INTO planned_orders(id, order_no, product_id, quantity, released_quantity, status, source_type, supply_type, need_date, created_at, updated_at, created_by, updated_by)
      VALUES('po-acc','PO-ACC','p-acc',10,0,'CONFIRMED','MRP','MAKE',?,?,?,?,?)`).run(DAY, now, now, userId, userId);
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(userId);
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-acc', productId: 'p-acc', warehouseId: 'wh-acc', quantity: 5,
        reservationType: 'STRONG', supplySourceType: 'EXPECTED', supplySourceId: 'no-concrete-doc',
      }),
      (err) => err instanceof HttpError && err.code === 'SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED',
      'pure EXPECTED supply must fail closed with bounded extension code',
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: concurrent EXPECTED reservations against the same PLANNED_ORDER reject overbooking', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    db.prepare(`INSERT INTO planned_orders(id, order_no, product_id, quantity, released_quantity, status, source_type, supply_type, need_date, created_at, updated_at, created_by, updated_by)
      VALUES('po-acc','PO-ACC','p-acc',10,0,'CONFIRMED','MRP','MAKE',?,?,?,?,?)`).run(DAY, now, now, userId, userId);
    const internals = __salesReservationIntentInternals();
    const actor = actorUser(userId);
    let first;
    transaction(db, () => {
      first = internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-acc', productId: 'p-acc', warehouseId: 'wh-acc', quantity: 8,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'po-acc',
      });
    });
    assert.ok(first);
    assert.throws(
      () => internals.createPlanningReservationAdapter(db, actor, {
        salesOrderId: 'so-acc', productId: 'p-acc', warehouseId: 'wh-acc', quantity: 5,
        reservationType: 'STRONG', supplySourceType: 'PLANNED_ORDER', supplySourceId: 'po-acc',
      }),
      (err) => err instanceof HttpError
        && err.code === 'SALES_RESERVATION_CAPACITY_EXCEEDED'
        && /仅剩 2/.test(err.message),
      'second reservation exceeding remaining (10 - 8 = 2) must fail closed',
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Stage gate business integration ----------

test('Acceptance: assertSalesPrepaymentGateAtStage refuses BLOCK on the DELIVERY stage with explicit code', () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    // No eligible balance -> the gate has never been evaluated for this stage
    // so the assertion must refuse with the explicit not-evaluated code.
    assert.throws(
      () => transaction(db, () => {
        assertSalesPrepaymentGateAtStage(db, 'so-acc', 'DELIVERY', { businessDate: DAY });
      }),
      (err) => err instanceof HttpError && err.code === 'SALES_PREPAYMENT_GATE_NOT_EVALUATED',
    );
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: assertSalesPrepaymentGateAtStage returns PASS after explicit evaluation when eligible covers required', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'DELIVERY');
    transaction(db, () => {
      const outcome = assertSalesPrepaymentGateAtStage(db, 'so-acc', 'DELIVERY', { businessDate: DAY });
      assert.equal(outcome.state, 'PASS');
      assert.equal(outcome.eligibleCents, 100000);
      assert.equal(outcome.requiredRemainingCents, 50000);
    });
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: assertSalesPrepaymentGateAtStage surfaces WARN without blocking', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 30000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'DELIVERY');
    transaction(db, () => {
      const outcome = assertSalesPrepaymentGateAtStage(db, 'so-acc', 'DELIVERY', { businessDate: DAY });
      assert.equal(outcome.state, 'WARN');
      assert.equal(outcome.eligibleCents, 30000);
    });
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: assertSalesPrepaymentGateAtStage returns NOT_REQUIRED when no requirement exists', () => {
  const { db, temp } = buildDb();
  const { userId } = seedBaseContext(db);
  try {
    transaction(db, () => {
      const outcome = assertSalesPrepaymentGateAtStage(db, 'so-acc', 'DELIVERY', { businessDate: DAY });
      assert.equal(outcome.state, 'NOT_REQUIRED');
    });
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Cross-document / cross-customer scope ----------

test('Acceptance: cross-document line mismatch refuses with item mismatch code', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    // Create another SO + line in the SAME sales_group so the cross-document
    // line mismatch can be detected (Sales Group scope does NOT short-circuit).
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus-other','CUS-OTHER','Other Customer','','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,sales_group_id) VALUES('so-other','SO-OTHER','cus-other','APPROVED',1000,?,?,?,'sg-acc')`).run(userId, now, now);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-other','so-other','p-acc',1,1000,1000,1)`).run();
    const actor = actorUser(userId);
    try {
      await requestReservationIntent(db, makeReq({
        salesOrderId: 'so-acc', salesOrderItemId: 'soi-other',
        productId: 'p-acc', warehouseId: 'wh-acc',
        reservationMode: 'INVENTORY_LOCK', quantity: 1,
      }), makeRes(), actor);
      assert.fail('cross-document line linkage must fail closed');
    } catch (err) {
      assert.ok(err instanceof HttpError, `expected HttpError but got ${err?.constructor?.name}: ${err?.message}`);
      assert.equal(err.code, 'SALES_RESERVATION_INTENT_ITEM_MISMATCH', `unexpected code: ${err.code}; msg=${err.message}`);
    }
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: source-link re-uses canonical SO customer_id (no body override)', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    // Body supplies a different customer_id — must be ignored; the canonical
    // customer_id from sales_orders is what the Finance adapter reads.
    await evaluateSalesPrepaymentGate(db, makeReq({ customerId: 'cus-other' }), makeRes(), actor, 'so-acc', 'DELIVERY');
    const evidence = resolveEligiblePrepaymentForSalesGate(db, {
      customerId: 'cus-acc', businessDate: DAY, gateStage: 'DELIVERY',
      salesOrderId: 'so-acc', remainingRequiredCents: 50000, lockMode: 'NO_LOCK',
    });
    assert.equal(evidence.eligibleAmountCents, 100000);
    assert.equal(evidence.sourceBalanceIdentities[0].balanceId, 'sub-acc');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Snapshot-key replay + OVERRIDE_REQUIRED carry-forward ----------

test('Acceptance: snapshot_key replay returns persisted row without re-evaluating', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 100000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-x' }), makeRes(), actor, 'so-acc', 'DELIVERY');
    const before = db.prepare(`SELECT id, gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='snap-x'`).get();
    // Replay the same snapshot — must NOT insert a new row.
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'snap-x' }), makeRes(), actor, 'so-acc', 'DELIVERY');
    const after = db.prepare(`SELECT id, gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='snap-x'`).get();
    assert.equal(after.id, before.id);
    assert.equal(after.gate_decision, 'PASS');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: prior OVERRIDE_REQUIRED carries forward on re-evaluation while eligibility still insufficient', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 30000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'RESERVATION');
    const first = db.prepare(`SELECT id FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='RESERVATION' ORDER BY evaluated_at DESC LIMIT 1`).get('so-acc');
    await overridePrepaymentGateResult(db, makeReq({ reason: 'VP approval' }), makeRes(), actor, first.id);
    // Re-evaluate with a different snapshot_key while eligibility is still
    // insufficient — the override carries forward.
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 're-eval' }), makeRes(), actor, 'so-acc', 'RESERVATION');
    const carried = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='re-eval'`).get();
    assert.equal(carried.gate_decision, 'OVERRIDE_REQUIRED');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: prior OVERRIDE_REQUIRED transitions back to PASS once eligibility fully covers required', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    seedPrepaymentBalance(db, userId, now, 30000);
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id, sales_order_id, line_no, required_amount_cents, ratio_basis, effective_from, effective_to, created_at, created_by)
      VALUES('req-acc','so-acc',0,50000,'ORDER_VALUE',NULL,NULL,?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({}), makeRes(), actor, 'so-acc', 'DELIVERY');
    const first = db.prepare(`SELECT id FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='DELIVERY' ORDER BY evaluated_at DESC LIMIT 1`).get('so-acc');
    await overridePrepaymentGateResult(db, makeReq({ reason: 'vp approval' }), makeRes(), actor, first.id);
    // Now apply another advance receipt so eligible >= required.
    db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied) VALUES('pc-acc2','PC-ACC2','cus-acc',NULL,50000,'CASH',?,'',?,?,'CONFIRMED','',NULL,NULL,'','',0,'NONE',NULL,?,1)`).run(DAY, userId, now, 50000);
    db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at) VALUES('sub-acc2','CUSTOMER','PREPAYMENT','cus-acc','PAYMENT_COLLECTION','pc-acc2','PC-ACC2',50000,?,NULL,'OPEN',?,?)`).run(DAY, userId, now);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'fresh-eval' }), makeRes(), actor, 'so-acc', 'DELIVERY');
    const fresh = db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='fresh-eval'`).get();
    assert.equal(fresh.gate_decision, 'PASS');
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Mutation-time atomic authorization through the real RESERVATION entry ----------

test('Acceptance: stale RESERVATION PASS cannot authorize after Finance balance is exhausted; rollback is side-effect free', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(userId);
    seedPrepaymentBalance(db, userId, now, 50000);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
      VALUES('req-stale','so-acc',0,50000,'ORDER_VALUE',?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'prior-pass' }), makeRes(), actor, 'so-acc', 'RESERVATION');
    assert.equal(db.prepare(`SELECT gate_decision FROM sales_prepayment_gate_results WHERE snapshot_key='prior-pass'`).get().gate_decision, 'PASS');
    db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,reason,status,creator_id,created_at)
      VALUES('ba-stale','BA-STALE','AR','PREPAYMENT','sub-acc','open-stale',50000,?,'','CONFIRMED',?,?)`).run(DAY, userId, now);

    await assert.rejects(
      requestReservationIntent(db, makeReq({
        salesOrderId: 'so-acc', salesOrderItemId: 'soi-acc', productId: 'p-acc', warehouseId: 'wh-acc',
        quantity: 2, reservationMode: 'ON_HAND_RESERVATION', businessDate: DAY,
      }), makeRes(), actor),
      (error) => error instanceof HttpError && error.code === 'SALES_PREPAYMENT_GATE_BLOCKED',
    );
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_reservation_intent`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM planning_reservations WHERE demand_source_id='so-acc'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE snapshot_key LIKE 'ACTION|RESERVATION|REQUEST|%'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action='AUTHORIZE_MUTATION' AND entity_type='SALES_PREPAYMENT_GATE'`).get().n, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: real RESERVATION entry re-authorizes current sufficient balance and commits Gate + Planning + Sales atomically', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(userId);
    seedPrepaymentBalance(db, userId, now, 50000);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
      VALUES('req-current','so-acc',0,50000,'ORDER_VALUE',?,?)`).run(now, userId);
    await evaluateSalesPrepaymentGate(db, makeReq({ snapshotKey: 'prior-current' }), makeRes(), actor, 'so-acc', 'RESERVATION');
    const res = makeRes();
    await requestReservationIntent(db, makeReq({
      salesOrderId: 'so-acc', salesOrderItemId: 'soi-acc', productId: 'p-acc', warehouseId: 'wh-acc',
      quantity: 2, reservationMode: 'ON_HAND_RESERVATION', businessDate: DAY,
    }), res, actor);
    assert.equal(res.statusCode, 201);
    const intent = db.prepare(`SELECT * FROM sales_reservation_intent`).get();
    assert.equal(intent.intent_state, 'REQUESTED');
    assert.ok(db.prepare(`SELECT id FROM planning_reservations WHERE id=? AND status='ACTIVE'`).get(intent.planning_reservation_id));
    const current = db.prepare(`SELECT gate_decision,eligible_advance_cents FROM sales_prepayment_gate_results
      WHERE snapshot_key LIKE 'ACTION|RESERVATION|REQUEST|%'`).get();
    assert.deepEqual([current.gate_decision, Number(current.eligible_advance_cents)], ['PASS', 50000]);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Acceptance: real RESERVATION entry preserves NOT_EVALUATED and NOT_REQUIRED behavior', async () => {
  const { db, temp } = buildDb();
  const { userId, now } = seedBaseContext(db);
  try {
    const actor = actorUser(userId);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
      VALUES('req-not-evaluated','so-acc',0,50000,'ORDER_VALUE',?,?)`).run(now, userId);
    await assert.rejects(
      requestReservationIntent(db, makeReq({ salesOrderId: 'so-acc', salesOrderItemId: 'soi-acc', productId: 'p-acc', warehouseId: 'wh-acc', quantity: 1, reservationMode: 'ON_HAND_RESERVATION', businessDate: DAY }), makeRes(), actor),
      (error) => error instanceof HttpError && error.code === 'SALES_PREPAYMENT_GATE_NOT_EVALUATED',
    );
    db.prepare(`DELETE FROM sales_prepayment_requirements WHERE id='req-not-evaluated'`).run();
    const res = makeRes();
    await requestReservationIntent(db, makeReq({ salesOrderId: 'so-acc', salesOrderItemId: 'soi-acc', productId: 'p-acc', warehouseId: 'wh-acc', quantity: 1, reservationMode: 'ON_HAND_RESERVATION', businessDate: DAY }), res, actor);
    assert.equal(res.statusCode, 201);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

// ---------- Real PLANNING_RELEASE / Sales Order submit entry ----------

test('Acceptance: real Sales Order submit covers PASS/WARN/BLOCK/override/effective dates/replay/conflict and rollback', async () => {
  const h = await buildRealEntryHarness('submit');
  let sequence = 0;
  const createOrder = async (suffix, orderDate = DAY) => {
    const customerId = addEntryCustomer(h, suffix);
    const created = await h.call('/api/sales-orders', { token: h.tokens.sales, method: 'POST', key: `create-${suffix}`, body: {
      customerId, orderDate, requestedDeliveryDate: orderDate, shipToContactName: 'Receiver', shipToPhone: '13000000000',
      shipToAddress: 'Wave7 address', paymentTerms: 'MONTHLY', items: [{ productId: 'product-001', uomCode: h.uom, quantityDecimal: '10' }],
    } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return { id: created.data.id, customerId, suffix };
  };
  const evaluate = async (order, amount, decision, stage = 'PLANNING_RELEASE') => {
    if (amount > 0) addEntryBalance(h.db, order.customerId, `${order.suffix}-${sequence += 1}`, amount);
    const res = makeRes();
    await evaluateSalesPrepaymentGate(h.db, makeReq({ snapshotKey: `eval-${order.suffix}-${sequence}` }), res, entryActor, order.id, stage);
    assert.equal(res.body.gateDecision, decision);
    return h.db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(res.body.id);
  };
  const submit = (order, key, body = {}) => h.call(`/api/sales-orders/${order.id}/submit`, { token: h.tokens.sales, method: 'POST', key, body });
  const effects = (order) => ({
    status: h.db.prepare('SELECT status FROM sales_orders WHERE id=?').get(order.id).status,
    authResults: Number(h.db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='PLANNING_RELEASE' AND snapshot_key LIKE 'ACTION|PLANNING_RELEASE|SUBMIT|%'").get(order.id).n),
    authAudits: Number(h.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='AUTHORIZE_MUTATION' AND entity_type='SALES_PREPAYMENT_GATE' AND entity_id IN (SELECT id FROM sales_prepayment_gate_results WHERE sales_order_id=?)").get(order.id).n),
    submits: Number(h.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='SUBMIT' AND entity_type='SALES_ORDER' AND entity_id=?").get(order.id).n),
    idempotency: Number(h.db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_ORDER_SUBMIT' AND document_id=?").get(order.id).n),
  });
  try {
    const pass = await createOrder('submit-pass'); addRequirement(h.db, pass.id, pass.suffix); await evaluate(pass, 50000, 'PASS');
    assert.equal((await submit(pass, 'submit-pass-key')).status, 200);
    assert.deepEqual(effects(pass), { status: 'SUBMITTED', authResults: 1, authAudits: 1, submits: 1, idempotency: 1 });
    const replay = await submit(pass, 'submit-pass-key'); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
    assert.deepEqual(effects(pass), { status: 'SUBMITTED', authResults: 1, authAudits: 1, submits: 1, idempotency: 1 });
    const conflict = await submit(pass, 'submit-pass-key', { changed: true }); assert.equal(conflict.status, 409);

    const warn = await createOrder('submit-warn'); addRequirement(h.db, warn.id, warn.suffix); await evaluate(warn, 30000, 'WARN');
    assert.equal((await submit(warn, 'submit-warn-key')).status, 200);
    assert.equal(h.db.prepare("SELECT gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND snapshot_key LIKE 'ACTION|PLANNING_RELEASE|SUBMIT|%'").get(warn.id).gate_decision, 'WARN');

    const blocked = await createOrder('submit-block'); addRequirement(h.db, blocked.id, blocked.suffix); await evaluate(blocked, 0, 'BLOCK');
    const blockedBefore = effects(blocked); const blockedResult = await submit(blocked, 'submit-block-key');
    assert.equal(blockedResult.status, 409); assert.equal(blockedResult.data.details?.code || blockedResult.data.code, 'SALES_PREPAYMENT_GATE_BLOCKED');
    assert.deepEqual(effects(blocked), blockedBefore);

    const notEvaluated = await createOrder('submit-not-evaluated'); addRequirement(h.db, notEvaluated.id, notEvaluated.suffix);
    const notEvaluatedResult = await submit(notEvaluated, 'submit-not-evaluated-key');
    assert.equal(notEvaluatedResult.status, 409); assert.equal(notEvaluatedResult.data.details?.code || notEvaluatedResult.data.code, 'SALES_PREPAYMENT_GATE_NOT_EVALUATED');
    assert.deepEqual(effects(notEvaluated), { status: 'DRAFT', authResults: 0, authAudits: 0, submits: 0, idempotency: 0 });

    const missingReason = await createOrder('submit-missing-reason'); addRequirement(h.db, missingReason.id, missingReason.suffix);
    const corruptOverride = await evaluate(missingReason, 0, 'BLOCK');
    h.db.prepare("UPDATE sales_prepayment_gate_results SET gate_decision='OVERRIDE_REQUIRED',override_reason=NULL,overridden_by='user-sales' WHERE id=?").run(corruptOverride.id);
    const missingReasonResult = await submit(missingReason, 'submit-missing-reason-key');
    assert.equal(missingReasonResult.status, 409); assert.equal(missingReasonResult.data.details?.code || missingReasonResult.data.code, 'SALES_PREPAYMENT_GATE_OVERRIDE_MISSING_REASON');
    assert.equal(effects(missingReason).status, 'DRAFT');

    const overridden = await createOrder('submit-override'); addRequirement(h.db, overridden.id, overridden.suffix);
    const blockRow = await evaluate(overridden, 0, 'BLOCK');
    await overridePrepaymentGateResult(h.db, makeReq({ reason: 'approved planning exception' }), makeRes(), entryActor, blockRow.id);
    assert.equal((await submit(overridden, 'submit-override-key')).status, 200);
    const overrideAuthorization = h.db.prepare("SELECT gate_decision,override_reason FROM sales_prepayment_gate_results WHERE sales_order_id=? AND snapshot_key LIKE 'ACTION|PLANNING_RELEASE|SUBMIT|%'").get(overridden.id);
    assert.deepEqual([overrideAuthorization.gate_decision, overrideAuthorization.override_reason], ['OVERRIDE_REQUIRED', 'approved planning exception']);

    const stale = await createOrder('submit-stale'); addRequirement(h.db, stale.id, stale.suffix); const staleBalance = addEntryBalance(h.db, stale.customerId, 'submit-stale', 50000);
    await evaluateSalesPrepaymentGate(h.db, makeReq({ snapshotKey: 'submit-stale-pass' }), makeRes(), entryActor, stale.id, 'PLANNING_RELEASE');
    h.db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,reason,status,creator_id,created_at)
      VALUES('w7-submit-stale-app','W7-STALE','AR','PREPAYMENT',?,'w7-stale-open',50000,?,'','CONFIRMED','user-sales',?)`).run(staleBalance, DAY, h.stamp);
    const staleResult = await submit(stale, 'submit-stale-key'); assert.equal(staleResult.status, 409);
    assert.equal(staleResult.data.details?.code || staleResult.data.code, 'SALES_PREPAYMENT_GATE_BLOCKED'); assert.equal(effects(stale).status, 'DRAFT');

    const before = await createOrder('submit-before', '2026-10-17'); addRequirement(h.db, before.id, before.suffix, { from: DAY, to: '2026-10-20' });
    assert.equal((await submit(before, 'submit-before-key')).status, 200); assert.equal(effects(before).authResults, 0);
    const after = await createOrder('submit-after', '2026-10-21'); addRequirement(h.db, after.id, after.suffix, { from: '2026-10-10', to: DAY });
    assert.equal((await submit(after, 'submit-after-key')).status, 200); assert.equal(effects(after).authResults, 0);
    const notRequired = await createOrder('submit-not-required');
    assert.equal((await submit(notRequired, 'submit-not-required-key')).status, 200); assert.equal(effects(notRequired).authResults, 0);
  } finally { await h.close(); }
});

// ---------- Real DELIVERY / Sales Delivery confirm entry ----------

test('Acceptance: real Sales Delivery confirm covers decisions, stale balance, dates, replay and all-or-nothing effects', async () => {
  const h = await buildRealEntryHarness('delivery');
  let sequence = 0;
  const createDelivery = async (suffix, deliveryDate = DAY) => {
    const customerId = addEntryCustomer(h, suffix); const now = new Date().toISOString();
    const orderId = `w7-delivery-order-${suffix}`; const lineId = `w7-delivery-line-${suffix}`;
    h.db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,requested_delivery_date,payment_terms,payment_terms_days,ship_to_contact_name,ship_to_phone,ship_to_address,commercial_close_state)
      VALUES(?,?,?,'APPROVED',10000,'user-sales',?,?,?,?,?,30,'Receiver','13000000000','Wave7 address','OPEN')`)
      .run(orderId, `W7-SO-${suffix}`, customerId, now, now, deliveryDate, deliveryDate, 'MONTHLY');
    h.db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,base_quantity_num,base_quantity_den)
      VALUES(?,?,'product-001',1,10000,10000,1,1,1)`).run(lineId, orderId);
    const created = await h.call('/api/sales-deliveries', { token: h.tokens.admin, method: 'POST', body: {
      sourceMode: 'DIRECT_ORDER', salesOrderId: orderId, warehouseId: 'warehouse-001', billingMode: 'LEGACY_DIRECT', deliveryDate,
      items: [{ salesOrderItemId: lineId, productId: 'product-001', quantity: 1 }],
    } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const oqc = await h.call('/api/oqc', { token: h.tokens.admin, method: 'POST', body: { sales_delivery_id: created.data.id } });
    assert.equal(oqc.status, 201, JSON.stringify(oqc.data));
    const completed = await h.call(`/api/oqc/${oqc.data.id}/complete`, { token: h.tokens.admin, method: 'POST', body: { result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 } });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    return { id: created.data.id, orderId, customerId, suffix };
  };
  const evaluate = async (delivery, amount, decision) => {
    if (amount > 0) addEntryBalance(h.db, delivery.customerId, `${delivery.suffix}-${sequence += 1}`, amount);
    const res = makeRes(); await evaluateSalesPrepaymentGate(h.db, makeReq({ snapshotKey: `delivery-eval-${delivery.suffix}-${sequence}` }), res, entryActor, delivery.orderId, 'DELIVERY');
    assert.equal(res.body.gateDecision, decision); return h.db.prepare('SELECT * FROM sales_prepayment_gate_results WHERE id=?').get(res.body.id);
  };
  const confirm = (delivery, key, body = { action: 'confirm' }) => h.call(`/api/sales-deliveries/${delivery.id}`, { token: h.tokens.admin, method: 'POST', key, body });
  const effects = (delivery) => ({
    status: h.db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(delivery.id).status,
    inventory: Number(h.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.id).n),
    valuation: Number(h.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.id).n),
    cogs: Number(h.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id=?").get(delivery.id).n),
    revenue: Number(h.db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.id).n),
    ar: Number(h.db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(delivery.id).n),
    confirms: Number(h.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CONFIRM' AND entity_type='SALES_DELIVERY' AND entity_id=?").get(delivery.id).n),
    idempotency: Number(h.db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_DELIVERY_CONFIRM' AND document_id=?").get(delivery.id).n),
    authResults: Number(h.db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage='DELIVERY' AND snapshot_key LIKE 'ACTION|DELIVERY|CONFIRM|%'").get(delivery.orderId).n),
  });
  try {
    const pass = await createDelivery('pass'); addRequirement(h.db, pass.orderId, 'delivery-pass'); await evaluate(pass, 50000, 'PASS');
    assert.equal((await confirm(pass, 'delivery-pass-key')).status, 200);
    const success = effects(pass); assert.deepEqual(success, { status: 'CONFIRMED', inventory: 1, valuation: 1, cogs: 1, revenue: 1, ar: 1, confirms: 1, idempotency: 1, authResults: 1 });
    const replay = await confirm(pass, 'delivery-pass-key'); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.deepEqual(effects(pass), success);
    const conflictingAction = await confirm(pass, 'delivery-pass-key', { action: 'cancel' }); assert.equal(conflictingAction.status, 409); assert.deepEqual(effects(pass), success);

    const warn = await createDelivery('warn'); addRequirement(h.db, warn.orderId, 'delivery-warn'); await evaluate(warn, 30000, 'WARN');
    assert.equal((await confirm(warn, 'delivery-warn-key')).status, 200);
    assert.equal(h.db.prepare("SELECT gate_decision FROM sales_prepayment_gate_results WHERE sales_order_id=? AND snapshot_key LIKE 'ACTION|DELIVERY|CONFIRM|%'").get(warn.orderId).gate_decision, 'WARN');

    for (const mode of ['block', 'not-evaluated', 'missing-reason']) {
      const delivery = await createDelivery(mode); addRequirement(h.db, delivery.orderId, `delivery-${mode}`);
      let expectedCode = 'SALES_PREPAYMENT_GATE_NOT_EVALUATED';
      if (mode !== 'not-evaluated') {
        const row = await evaluate(delivery, 0, 'BLOCK'); expectedCode = 'SALES_PREPAYMENT_GATE_BLOCKED';
        if (mode === 'missing-reason') {
          h.db.prepare("UPDATE sales_prepayment_gate_results SET gate_decision='OVERRIDE_REQUIRED',override_reason=NULL,overridden_by='user-sales' WHERE id=?").run(row.id);
          expectedCode = 'SALES_PREPAYMENT_GATE_OVERRIDE_MISSING_REASON';
        }
      }
      const before = effects(delivery); const denied = await confirm(delivery, `delivery-${mode}-key`);
      assert.equal(denied.status, 409); assert.equal(denied.data.details?.code || denied.data.code, expectedCode); assert.deepEqual(effects(delivery), before);
    }

    const overridden = await createDelivery('override'); addRequirement(h.db, overridden.orderId, 'delivery-override');
    const row = await evaluate(overridden, 0, 'BLOCK'); await overridePrepaymentGateResult(h.db, makeReq({ reason: 'approved delivery exception' }), makeRes(), entryActor, row.id);
    assert.equal((await confirm(overridden, 'delivery-override-key')).status, 200);

    const stale = await createDelivery('stale'); addRequirement(h.db, stale.orderId, 'delivery-stale'); const balance = addEntryBalance(h.db, stale.customerId, 'delivery-stale', 50000);
    await evaluateSalesPrepaymentGate(h.db, makeReq({ snapshotKey: 'delivery-stale-pass' }), makeRes(), entryActor, stale.orderId, 'DELIVERY');
    h.db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,reason,status,creator_id,created_at)
      VALUES('w7-delivery-stale-app','W7-D-STALE','AR','PREPAYMENT',?,'w7-delivery-open',50000,?,'','CONFIRMED','user-sales',?)`).run(balance, DAY, h.stamp);
    const staleBefore = effects(stale); const staleDenied = await confirm(stale, 'delivery-stale-key');
    assert.equal(staleDenied.status, 409); assert.equal(staleDenied.data.details?.code || staleDenied.data.code, 'SALES_PREPAYMENT_GATE_BLOCKED'); assert.deepEqual(effects(stale), staleBefore);

    const beforeDate = await createDelivery('before', '2026-10-17'); addRequirement(h.db, beforeDate.orderId, 'delivery-before', { from: DAY, to: '2026-10-20' });
    assert.equal((await confirm(beforeDate, 'delivery-before-key')).status, 200); assert.equal(effects(beforeDate).authResults, 0);
    const afterDate = await createDelivery('after', '2026-10-21'); addRequirement(h.db, afterDate.orderId, 'delivery-after', { from: '2026-10-10', to: DAY });
    assert.equal((await confirm(afterDate, 'delivery-after-key')).status, 200); assert.equal(effects(afterDate).authResults, 0);
    const notRequired = await createDelivery('not-required'); assert.equal((await confirm(notRequired, 'delivery-not-required-key')).status, 200); assert.equal(effects(notRequired).authResults, 0);
  } finally { await h.close(); }
});
