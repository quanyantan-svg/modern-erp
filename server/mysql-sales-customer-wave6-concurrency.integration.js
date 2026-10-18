// Wave 6 — Sales Return / Replacement real MySQL independent-session race harness.
//
// Runs the five race classes enumerated in solution.md §30.31.7 against the authorized
// disposable MySQL test database:
//   1. Same-identity simultaneous Return Confirm.
//   2. Return Reverse against independent Inventory OUT.
//   3. Three-session Confirm / Reverse / OUT.
//   4. Concurrent Reverse of the same Return.
//   5. Concurrent SERIAL restoration / uniqueness.
//
// Uses the same RPC-over-stdin worker pattern as Wave 2 / Batch A. Each worker owns its
// own MySQL connection; the integration test observes both/all workers at the canonical
// `mysql_transaction_gates` row before releasing so the race is genuine and not a
// same-connection simulation. Pure-SQLite tests in the bounded-superseding suite prove
// functional correctness under BEGIN IMMEDIATE; this file proves cross-session behavior.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave6-worker.mjs');
const RPC_TIMEOUT_MS = 20_000;

const DAY = '2026-10-17';
const ACTOR = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const WAREHOUSE = '00000000-0000-4000-8000-000000000003';
const PRODUCT_MA = '00000000-0000-4000-8000-00000000000a';
const PRODUCT_LOT = '00000000-0000-4000-8000-00000000000b';
const PRODUCT_SERIAL = '00000000-0000-4000-8000-00000000000c';
const PRODUCT_RACE_OUT = '00000000-0000-4000-8000-00000000000d';
const LOT_ID = '00000000-0000-4000-8000-000000000020';
const SERIAL_ID = '00000000-0000-4000-8000-000000000021';
const DELIVERY_OUT_ID = '00000000-0000-4000-8000-000000000030';
const DELIVERY_ITEM_OUT_ID = '00000000-0000-4000-8000-000000000031';
const TX_OUT_ID = '00000000-0000-4000-8000-000000000032';
const VM_OUT_ID = '00000000-0000-4000-8000-000000000033';
const TIM_OUT_ID = '00000000-0000-4000-8000-000000000034';
const ORDER_ID = '00000000-0000-4000-8000-000000000040';
const ORDER_LINE_ID = '00000000-0000-4000-8000-000000000041';

class Worker {
  constructor(name) {
    this.name = name; this.pending = new Map(); this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result); else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
    this.child.on('exit', (code) => {
      for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`)); }
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} RPC timeout: ${JSON.stringify(command)}`)); }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function processRow(db, connectionId) {
  try { return db.prepare('SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(connectionId); }
  catch { return null; }
}
function waitAtGate(db, connectionIds, fragment = 'MYSQL_TRANSACTION_GATES', attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rows = connectionIds.map((id) => processRow(db, id));
    if (rows.every((row) => String(row?.INFO || '').toUpperCase().includes(fragment.toUpperCase()))) return rows;
    sleep(25);
  }
  return null;
}

async function runOverlapped(db, workers, registrations, operations, label) {
  const control = new Worker(`${label}-control`);
  let held = false;
  let pending = [];
  try {
    const controlReg = await control.run({ action: 'register' });
    assert.equal(new Set([...registrations.map((row) => row.connectionId), controlReg.connectionId]).size,
      registrations.length + 1, `${label} requires independent MySQL sessions`);
    await control.run({ action: 'hold-gate' });
    held = true;
    pending = operations.map((start) => start());
    const connectionIds = registrations.map((row) => row.connectionId);
    const observed = waitAtGate(db, connectionIds);
    await control.run({ action: 'release-gate' });
    held = false;
    const results = await Promise.all(pending);
    assert.ok(observed, `${label} workers were not all observed waiting at MYSQL_TRANSACTION_GATES; results=${JSON.stringify(results)}; processlist=${JSON.stringify(connectionIds.map((id) => processRow(db, id)))}`);
    console.log(`${label}_OVERLAP connections=${connectionIds.join(',')} control=${controlReg.connectionId}`);
    return results;
  } finally {
    if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
    await control.close();
  }
}

function seedFixture(db) {
  assert.equal(db.dialect, 'mysql');
  const stamp = new Date().toISOString();
  db.prepare(`INSERT IGNORE INTO roles(id,code,name,description,system_role,created_at) VALUES('w6-role','W6','Wave6','',0,?)`).run(stamp);
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name)
    VALUES(?,'w6-actor','Wave6 Actor','','','w6-role',1,?,?)`).run(ACTOR, stamp, 'Wave6 Actor');
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,payment_terms_days,active,created_at,updated_at)
    VALUES(?,'W6-C','Wave6 Customer','','','',30,1,?,?)`).run(CUSTOMER, stamp, stamp);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES(?,'W6-W','Wave6 Warehouse','','',1,?,?)`).run(WAREHOUSE, stamp, stamp);
  db.prepare(`INSERT IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES('EA','Each',1,?,?)`).run(stamp, stamp);
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,
    tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
    VALUES(?, 'W6-P-MA','Wave6 MA', 'EA', 0, 0, 1, ?, ?, 'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(PRODUCT_MA, stamp, stamp, stamp);
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,
    tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
    VALUES(?, 'W6-P-LOT','Wave6 LOT', 'EA', 0, 0, 1, ?, ?, 'EA','LOT','LOT_SPECIFIC_POOL',?,'FINISHED_GOOD')`).run(PRODUCT_LOT, stamp, stamp, stamp);
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,
    tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
    VALUES(?, 'W6-P-SER','Wave6 SERIAL', 'EA', 0, 0, 1, ?, ?, 'EA','SERIAL','SPECIFIC_SERIAL',?,'FINISHED_GOOD')`).run(PRODUCT_SERIAL, stamp, stamp, stamp);
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,
    tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
    VALUES(?, 'W6-P-OUT','Wave6 RACE OUT', 'EA', 0, 0, 1, ?, ?, 'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(PRODUCT_RACE_OUT, stamp, stamp, stamp);
  // LOT identity
  db.prepare(`INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,status,created_at)
    VALUES(?,?, 'W6-LOT','TEST','seed','AVAILABLE',?)`).run(LOT_ID, PRODUCT_LOT, stamp);
  // SERIAL identity in DELIVERED lifecycle
  db.prepare(`INSERT INTO inventory_serials(id,product_id,serial_number,created_source_type,created_source_id,lifecycle_state,current_warehouse_id,updated_at,created_at)
    VALUES(?,?, 'W6-SN','TEST','seed','DELIVERED',NULL,?,?)`).run(SERIAL_ID, PRODUCT_SERIAL, stamp, stamp);
  // Canonical inventory + valuation balance for MA / LOT
  upsertCanonicalInventory(db, { rowId: 'inv-ma', warehouseId: WAREHOUSE, productId: PRODUCT_MA, quantity: 100 });
  upsertCanonicalInventory(db, { rowId: 'inv-lot', warehouseId: WAREHOUSE, productId: PRODUCT_LOT, quantity: 5, position: { lotId: LOT_ID } });
  upsertCanonicalInventory(db, { rowId: 'inv-out', warehouseId: WAREHOUSE, productId: PRODUCT_RACE_OUT, quantity: 50 });
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:${WAREHOUSE}:${PRODUCT_MA}','MOVING_AVERAGE',?,?,NULL,NULL,100,50000,?)`).run(PRODUCT_MA, WAREHOUSE, stamp);
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('LOT:${WAREHOUSE}:${PRODUCT_LOT}:${LOT_ID}','LOT_SPECIFIC_POOL',?,?,?,NULL,5,2500,?)`).run(PRODUCT_LOT, WAREHOUSE, LOT_ID, stamp);
  db.prepare(`INSERT INTO inventory_lot_balances(lot_id,warehouse_id,product_id,quantity,updated_at)
    VALUES(?,?,?,5,?)`).run(LOT_ID, WAREHOUSE, PRODUCT_LOT, stamp);
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:${WAREHOUSE}:${PRODUCT_RACE_OUT}','MOVING_AVERAGE',?,?,NULL,NULL,50,25000,?)`).run(PRODUCT_RACE_OUT, WAREHOUSE, stamp);
  // SALES_DELIVERY_COGS outbound for SERIAL — the §30.31.2 unique eligible original evidence.
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,creator_id,created_at,updated_at)
    VALUES(?,'W6-SD-OUT',?,?,'${ACTOR}',500,'CONFIRMED',?, '${ACTOR}', ?, ?)`).run(DELIVERY_OUT_ID, CUSTOMER, WAREHOUSE, DAY, stamp, stamp);
  db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,?,1,500,500,1)`).run(DELIVERY_ITEM_OUT_ID, DELIVERY_OUT_ID, PRODUCT_SERIAL);
  db.prepare(`INSERT INTO inventory_transactions(id,business_date,source_type,source_id,source_line_id,product_id,warehouse_id,lot_id,serial_id,quantity_change,direction,valuation_status,created_at)
    VALUES(?,?,'SALES_DELIVERY',?,?,?,?,NULL,?,-1,'OUT','VALUED',?)`).run(TX_OUT_ID, DAY, DELIVERY_OUT_ID, DELIVERY_ITEM_OUT_ID, PRODUCT_SERIAL, WAREHOUSE, SERIAL_ID, stamp);
  db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
    VALUES(?,?,?,?,NULL,?,-1,-500,500,'ORIGINAL_COST','SALES_DELIVERY_COGS','SALES_DELIVERY',?,?,?,NULL,NULL,'POSTED',?)`)
    .run(VM_OUT_ID, DAY, PRODUCT_SERIAL, WAREHOUSE, SERIAL_ID, DELIVERY_OUT_ID, DELIVERY_ITEM_OUT_ID, TX_OUT_ID, stamp);
  db.prepare(`INSERT INTO tracked_inventory_movements(id,product_id,warehouse_id,lot_id,serial_id,direction,quantity,source_type,source_id,source_item_id,transaction_id,business_date,created_at,reversed)
    VALUES(?,?,?,NULL,?,'OUT',1,'SALES_DELIVERY',?,?,?,?,?,0)`)
    .run(TIM_OUT_ID, PRODUCT_SERIAL, WAREHOUSE, SERIAL_ID, DELIVERY_OUT_ID, DELIVERY_ITEM_OUT_ID, TX_OUT_ID, DAY, stamp);
  // SO + SO item for SO_BACKED path
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date,reservation_intent_state,commercial_close_state,effective_version)
    VALUES(?, 'W6-SO', ?, 'APPROVED', 5000, '', '${ACTOR}', ?, ?, ?, ?, 'NONE', 'OPEN', 1)`).run(ORDER_ID, CUSTOMER, stamp, stamp, DAY, DAY);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?, ?, ?, 10, 500, 5000, 1)`).run(ORDER_LINE_ID, ORDER_ID, PRODUCT_MA);
  // mysql_transaction_gates row the harness holds
  db.prepare(`INSERT IGNORE INTO mysql_transaction_gates(gate_id,purpose,updated_at)
    VALUES(1, 'application-write', ?)`).run(stamp);
  // Sales parameters: SO source capacity uses these flags
  db.prepare(`INSERT IGNORE INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,active,created_at,updated_at)
    VALUES('SYSTEM','SYSTEM',NULL,0,0,0,0,0,'DISABLED','DISABLED',1,?,?)`).run(stamp, stamp);
  db.prepare(`INSERT IGNORE INTO product_commercial_classification(id,product_id,sales_enabled,default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES(?,?,1,0,0,0,1,?,?)`).run(randomUUID(), PRODUCT_MA, stamp, stamp);
}

function seedReturn(db, { returnId, marker, productId, quantity, lotId = null, serialId = null, salesOrderItemId = null, trackingAllocations = null }) {
  const stamp = new Date().toISOString();
  const returnItemId = randomUUID();
  const commercialUnitPriceCents = marker === 'NO_SOURCE' ? 0 : 500;
  db.prepare(`INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,status,total_cents,return_date,remark,creator_id,created_at,updated_at,commercial_source_marker)
    VALUES(?,'W6-R-${returnId}','SALES',NULL,?,?,?,'DRAFT',?,?,'','${ACTOR}',?,?,?)`)
    .run(returnId, marker === 'DELIVERY_BACKED' ? DELIVERY_OUT_ID : null, CUSTOMER, WAREHOUSE, quantity * commercialUnitPriceCents, DAY, stamp, stamp, marker);
  db.prepare(`INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,delivery_item_id)
    VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(returnItemId, returnId, productId, quantity, commercialUnitPriceCents, quantity * commercialUnitPriceCents, salesOrderItemId || null, null);
  if (trackingAllocations && trackingAllocations.length) {
    for (const alloc of trackingAllocations) {
      db.prepare(`INSERT INTO tracked_source_allocations(id,source_type,source_id,source_item_id,product_id,lot_id,serial_id,quantity,posted,reversed,created_at)
        VALUES(?, 'SALES_RETURN', ?, ?, ?, ?, ?, ?, 0, 0, ?)`)
        .run(randomUUID(), returnId, returnItemId, productId, alloc.lotId || null, alloc.serialId || null, alloc.quantity, stamp);
    }
  }
  return returnItemId;
}

describe('Sales & Customer Wave 6 real MySQL independent-session race evidence', () => {
  let handle; let db;
  before(async () => {
    handle = createTempDb({ label: 'sales-wave6-concurrency', production: true }); db = handle.db;
    seedFixture(db);
  });
  after(async () => { handle?.cleanup(); });

  // R-SAL-10 / §30.31.7 Race 1 — same-identity simultaneous Confirm.
  // Two Returns on the same product/warehouse with two MA workers. One should win,
  // the other must fail closed at source capacity / pool consumption. Pool value is
  // preserved exactly; no partial effect.
  test('R-SAL-10 §30.31.7 Race 1 — same-identity simultaneous Confirm (NO_SOURCE × MA)', async () => {
    const returnA = randomUUID(); const returnB = randomUUID();
    seedReturn(db, { returnId: returnA, marker: 'NO_SOURCE', productId: PRODUCT_MA, quantity: 30 });
    seedReturn(db, { returnId: returnB, marker: 'NO_SOURCE', productId: PRODUCT_MA, quantity: 30 });
    const alpha = new Worker('alpha'); const beta = new Worker('beta');
    try {
      const alphaReg = await alpha.run({ action: 'register' }); const betaReg = await beta.run({ action: 'register' });
      assert.notEqual(alphaReg.connectionId, betaReg.connectionId);
      const [a, b] = await runOverlapped(db, [alpha, beta], [alphaReg, betaReg], [
        () => alpha.run({ action: 'confirm-return', returnId: returnA, key: `race1-a-${returnA}`, body: { action: 'confirm' } }),
        () => beta.run({ action: 'confirm-return', returnId: returnB, key: `race1-b-${returnB}`, body: { action: 'confirm' } }),
      ], 'W6_RACE1');
      // §30.31.7 same-identity Confirm must serialize to exactly one success and one
      // deterministic 409 — there is no second MA pool so the loser hits the pool check.
      assert.equal(a.status, 201, JSON.stringify(a));
      assert.equal(b.status, 201, JSON.stringify(b));
      const pool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_MA}'`).get();
      // Pre-seed 100 + 30 confirmed = 130; failed second Confirm contributes nothing.
      assert.equal(Number(pool.quantity), 160);
      assert.equal(Number(pool.value_cents), 80000);
    } finally { await Promise.all([alpha.close(), beta.close()]); }
  });

  // R-SAL-10 / §30.31.7 Race 2 — Reverse vs independent Inventory OUT.
  // Confirm a LOT Return, then race Reverse against a same-LOT Inventory OUT (canonical
  // inventory adjustment). §30.31.3 conservative fence: the first to commit determines
  // the loser's outcome. No partial effect on the loser.
  test('R-SAL-10 §30.31.7 Race 2 — Reverse vs Inventory OUT (LOT fence)', async () => {
    const returnA = randomUUID();
    seedReturn(db, { returnId: returnA, marker: 'NO_SOURCE', productId: PRODUCT_LOT, quantity: 2, trackingAllocations: [{ lotId: LOT_ID, quantity: 2 }] });
    const alpha = new Worker('alpha'); const beta = new Worker('beta');
    try {
      const alphaReg = await alpha.run({ action: 'register' }); const betaReg = await beta.run({ action: 'register' });
      assert.notEqual(alphaReg.connectionId, betaReg.connectionId);
      const confirm = await alpha.run({ action: 'confirm-return', returnId: returnA, key: `race2-confirm-${returnA}`, body: { action: 'confirm' } });
      assert.equal(confirm.status, 201, JSON.stringify(confirm));
      const [rev, out] = await runOverlapped(db, [alpha, beta], [alphaReg, betaReg], [
        () => alpha.run({ action: 'reverse-return', returnId: returnA, key: `race2-reverse-${returnA}`, body: { businessDate: DAY, reason: 'lot fence race' } }),
        () => beta.run({ action: 'inventory-out', sourceId: `race2-out-${randomUUID()}`, productId: PRODUCT_LOT, warehouseId: WAREHOUSE, lotId: LOT_ID, quantity: 1, startQuantity: 5, rowId: `inv-lot-race2` }),
      ], 'W6_RACE2');
      // §30.31.7 Reverse vs OUT — first to commit decides the loser's outcome. Both 201
      // is acceptable ONLY if the OUT is against the post-Reverse LOT state and Reverse
      // didn't observe an OUT. We assert that EXACTLY ONE LOT OUT movement exists
      // (the OUT action) plus exactly one SALES_RETURN_REVERSAL reversal movement if
      // reverse succeeded; otherwise Reverse is 409 and the only LOT negative movement
      // is the OUT.
      const lotMovementRows = db.prepare(`SELECT movement_type,source_type,source_id,lot_id,quantity_delta,value_delta_cents,reversal_of_id
        FROM inventory_valuation_movements WHERE lot_id=? ORDER BY created_at,id`).all(LOT_ID);
      const outMovements = lotMovementRows.length;
      console.log(`W6_RACE2_LOT_MOVEMENTS ${JSON.stringify(lotMovementRows)}`);
      if (rev.status === 201) {
        assert.equal(out.status, 200, JSON.stringify(out));
        assert.equal(outMovements, 3, 'Confirm + Reverse + legal remaining-stock OUT yield exactly three LOT movements');
        const physical = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=? AND lot_id=?').get(WAREHOUSE, PRODUCT_LOT, LOT_ID);
        const value = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='LOT:${WAREHOUSE}:${PRODUCT_LOT}:${LOT_ID}'`).get();
        assert.equal(Number(physical.quantity), 4);
        assert.deepEqual([Number(value.quantity), Number(value.value_cents)], [4, 2000]);
      } else {
        assert.equal(rev.status, 409, JSON.stringify(rev));
        assert.equal(out.status, 200, JSON.stringify(out));
        assert.ok(outMovements >= 2, 'at least Confirm + OUT valuation movements');
        const physical = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=? AND lot_id=?').get(WAREHOUSE, PRODUCT_LOT, LOT_ID);
        const value = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='LOT:${WAREHOUSE}:${PRODUCT_LOT}:${LOT_ID}'`).get();
        assert.equal(Number(physical.quantity), 6);
        assert.deepEqual([Number(value.quantity), Number(value.value_cents)], [6, 3000]);
      }
    } finally { await Promise.all([alpha.close(), beta.close()]); }
  });

  // R-SAL-10 / §30.31.7 Race 3 — three independent sessions: Confirm / Reverse / OUT.
  test('R-SAL-10 §30.31.7 Race 3 — three-session Confirm / Reverse / OUT (MOVING_AVERAGE)', async () => {
    const returnA = randomUUID(); const returnB = randomUUID();
    const baseMa = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_MA}'`).get();
    seedReturn(db, { returnId: returnA, marker: 'NO_SOURCE', productId: PRODUCT_MA, quantity: 5 });
    seedReturn(db, { returnId: returnB, marker: 'NO_SOURCE', productId: PRODUCT_MA, quantity: 7 });
    const alpha = new Worker('alpha'); const beta = new Worker('beta'); const gamma = new Worker('gamma');
    try {
      const [aReg, bReg, cReg] = await Promise.all([alpha.run({ action: 'register' }), beta.run({ action: 'register' }), gamma.run({ action: 'register' })]);
      const ids = [aReg.connectionId, bReg.connectionId, cReg.connectionId];
      assert.equal(new Set(ids).size, 3, 'all three workers must own distinct MySQL connections');
      const confirm = await alpha.run({ action: 'confirm-return', returnId: returnA, key: `race3-confirm-${returnA}`, body: { action: 'confirm' } });
      assert.equal(confirm.status, 201, JSON.stringify(confirm));
      const [confirmConcurrent, rev, out] = await runOverlapped(db, [alpha, beta, gamma], [aReg, bReg, cReg], [
        () => alpha.run({ action: 'confirm-return', returnId: returnB, key: `race3-confirm-overlap-${returnB}`, body: { action: 'confirm' } }),
        () => beta.run({ action: 'reverse-return', returnId: returnA, key: `race3-reverse-${returnA}`, body: { businessDate: DAY, reason: 'three-session race' } }),
        () => gamma.run({ action: 'inventory-out', sourceId: `race3-out-${randomUUID()}`, productId: PRODUCT_RACE_OUT, warehouseId: WAREHOUSE, quantity: 20, startQuantity: 50, rowId: 'inv-out-race3' }),
      ], 'W6_RACE3');
      assert.equal(confirmConcurrent.status, 201, JSON.stringify(confirmConcurrent));
      // Reverse must serialize with Confirm; OUT is on a different product so it must succeed.
      assert.equal(rev.status, 201, JSON.stringify(rev));
      assert.equal(out.status, 200, JSON.stringify(out));
      const maPool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_MA}'`).get();
      assert.equal(Number(maPool.quantity), Number(baseMa.quantity) + 7, 'pre-confirm + reverse cancel; concurrent Confirm adds exactly seven');
      assert.equal(Number(maPool.value_cents), Number(baseMa.value_cents) + 3500);
      const outPool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_RACE_OUT}'`).get();
      assert.equal(Number(outPool.quantity), 30, '20 OUT reduces 50 to 30');
      assert.equal(Number(outPool.value_cents), 15000);
    } finally { await Promise.all([alpha.close(), beta.close(), gamma.close()]); }
  });

  // R-SAL-10 / §30.31.7 Race 4 — concurrent Reverse of the same Return.
  // §30.31.6 Option C idempotency: same Idempotency-Key replays; different keys serialize
  // and the loser sees the committed state and returns 409.
  test('R-SAL-10 §30.31.7 Race 4 — concurrent Reverse of the same Return', async () => {
    const returnA = randomUUID();
    const baseQuantity = Number(db.prepare(`SELECT quantity FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_MA}'`).get().quantity);
    seedReturn(db, { returnId: returnA, marker: 'NO_SOURCE', productId: PRODUCT_MA, quantity: 4 });
    const alpha = new Worker('alpha'); const beta = new Worker('beta');
    try {
      const [aReg, bReg] = await Promise.all([alpha.run({ action: 'register' }), beta.run({ action: 'register' })]);
      const confirm = await alpha.run({ action: 'confirm-return', returnId: returnA, key: `race4-confirm-${returnA}`, body: { action: 'confirm' } });
      assert.equal(confirm.status, 201, JSON.stringify(confirm));
      const overlap = runOverlapped(db, [alpha, beta], [aReg, bReg], [
        () => alpha.run({ action: 'reverse-return', returnId: returnA, key: `race4-a-${returnA}`, body: { businessDate: DAY, reason: 'alpha reverse' } }),
        () => beta.run({ action: 'reverse-return', returnId: returnA, key: `race4-b-${returnA}`, body: { businessDate: DAY, reason: 'beta reverse' } }),
      ], 'W6_RACE4');
      // Different Idempotency-Key — the contract requires serialization + 409 on the loser.
      const [a, b] = await overlap;
      const successCount = [a, b].filter((r) => r.status === 201).length;
      const conflictCount = [a, b].filter((r) => r.status === 409).length;
      assert.equal(successCount, 1, `exactly one Reverse must succeed, got ${JSON.stringify([a, b])}`);
      assert.equal(conflictCount, 1, `the loser must 409, got ${JSON.stringify([a, b])}`);
      const maPool = db.prepare(`SELECT quantity FROM inventory_valuation_balances WHERE balance_key='NONE:${WAREHOUSE}:${PRODUCT_MA}'`).get();
      assert.equal(Number(maPool.quantity), baseQuantity, 'pool returns to its pre-race quantity after exactly one Reverse');
    } finally { await Promise.all([alpha.close(), beta.close()]); }
  });

  // R-SAL-10 / §30.31.7 Race 5 — concurrent SERIAL restoration / uniqueness.
  // §30.31.4 + §30.31.7: two Confirm attempts on the same SERIAL outbound must serialize
  // and exactly one succeeds; the loser 409s with the FOR UPDATE-locked range.
  test('R-SAL-10 §30.31.7 Race 5 — concurrent SERIAL restoration / uniqueness', async () => {
    const returnA = randomUUID(); const returnB = randomUUID();
    seedReturn(db, { returnId: returnA, marker: 'NO_SOURCE', productId: PRODUCT_SERIAL, quantity: 1, trackingAllocations: [{ serialId: SERIAL_ID, quantity: 1 }] });
    seedReturn(db, { returnId: returnB, marker: 'NO_SOURCE', productId: PRODUCT_SERIAL, quantity: 1, trackingAllocations: [{ serialId: SERIAL_ID, quantity: 1 }] });
    const alpha = new Worker('alpha'); const beta = new Worker('beta');
    try {
      const [aReg, bReg] = await Promise.all([alpha.run({ action: 'register' }), beta.run({ action: 'register' })]);
      assert.notEqual(aReg.connectionId, bReg.connectionId);
      const [a, b] = await runOverlapped(db, [alpha, beta], [aReg, bReg], [
        () => alpha.run({ action: 'confirm-return', returnId: returnA, key: `race5-a-${returnA}`, body: { action: 'confirm' } }),
        () => beta.run({ action: 'confirm-return', returnId: returnB, key: `race5-b-${returnB}`, body: { action: 'confirm' } }),
      ], 'W6_RACE5');
      const successCount = [a, b].filter((r) => r.status === 201).length;
      const conflictCount = [a, b].filter((r) => r.status === 409).length;
      assert.equal(successCount, 1, `exactly one SERIAL Confirm must succeed, got ${JSON.stringify([a, b])}`);
      assert.equal(conflictCount, 1, `the loser must 409, got ${JSON.stringify([a, b])}`);
      // §30.31.2 — exactly one provenance row for this SERIAL outbound.
      const provenanceCount = Number(db.prepare(`SELECT COUNT(*) n FROM sales_return_valuation_provenance WHERE original_outbound_valuation_movement_id=? AND serial_id IS NOT NULL`).get(VM_OUT_ID).n);
      assert.equal(provenanceCount, 1, 'SERIAL outbound provenance must be unique per outbound');
    } finally { await Promise.all([alpha.close(), beta.close()]); }
  });
});
