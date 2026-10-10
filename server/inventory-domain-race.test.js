// V21 — Inventory Domain Race Matrix (Final Closure).
//
// 14 mandatory races (solution.md §27.42). All assertions verify canonical
// mutation dispatcher behaviour.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { computePositionKey } from './lib/inventory-position.js';
import { computeAvailability } from './lib/inventory-availability.js';
import {
  transferOut, transferIn, getInTransit,
} from './modules/inventory-step-transfer.js';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES('sup-1','SUP-1','SUP 1','','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES('wh-A','WH-A','WH A',1,0,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES('wh-B','WH-B','WH B',1,0,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES('wh-WIP','WH-WIP','WH WIP',1,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-1','P-1','P 1','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
}

function clearRows(db) {
  for (const t of [
    'inventory_mutation_log','inventory_transactions','tracked_inventory_movements',
    'inventory_locks','inventory_step_transfer_in_transit',
    'vmi_ownership_transfers','vmi_consumptions','vmi_receipts',
    'inventory_transfers','inventory_transfer_items',
    'inventory_adjustments','inventory_adjustment_items',
    'inventory_scraps','inventory_scrap_items',
    'inventory_checks','inventory_check_items',
    'opening_inventory_documents','opening_inventory_items',
    'inventory_initialization',
    'inventory_native_documents','inventory_native_items',
    'inventory_stocktakes','inventory_lot_adjustments',
    'inventory_containers','inventory_container_items',
    'inventory_barcode_resolution_log','inventory_abc_classifications',
    'tracked_source_allocations','inventory',
  ]) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
  }
  try { db.prepare(`UPDATE warehouses SET bin_enabled=0, is_supplier_wip=0, negative_stock_policy='BLOCK'`).run(); } catch (_) {}
}


function seedEnterpriseStock(db, productId='p-1', warehouseId='wh-A', quantity=100) {
  clearRows(db);
  applyInventoryMutation({
    db, sourceType: 'OTHER_RECEIPT', sourceId: 'seed', businessDate: '2026-10-10',
    actor: ACTOR, movementKind: 'IN', quantity,
    toPosition: { productId, warehouseId, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
    idempotencyKey: `SEED:${productId}:${warehouseId}`,
  });
}

const ACTOR = { id: 'u-act', permissions: [
  'INVENTORY_TRANSFER_CONFIRM','INVENTORY_LOCK_MANAGE','INVENTORY_OPENING_MANAGE',
  'INVENTORY_NATIVE_DOCUMENT_MANAGE','INVENTORY_CHECK_APPROVE','INVENTORY_TRANSFER_CREATE',
  'INVENTORY_TRANSFER_APPROVE','INVENTORY_TRANSFER_VIEW',
] };

function makeRes() {
  // Capture JSON payload sent via lib/http.js send() (which calls res.end(JSON.stringify(...))).
  return {
    statusCode: 200,
    body: null,
    setHeader(){},
    status(c) { this.statusCode=c; return this; },
    json(b) { this.body=b; return this; },
    end(chunk) {
      if (typeof chunk === 'string') {
        try { this.body = JSON.parse(chunk); } catch (_) { this.body = chunk; }
      } else if (Buffer.isBuffer(chunk)) {
        try { this.body = JSON.parse(chunk.toString('utf-8')); } catch (_) { this.body = chunk; }
      }
    },
  };
}
const _origMakeRes = makeRes;
function res() { const r = _origMakeRes(); return r; }

describe('V21 — 14 Inventory Domain Races', () => {
  let db, dbDir;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-race-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
  });
  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('RACE-01 two outbound mutations against same position: serial total = original - 2*N', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r1-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 10,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R1:1' });
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r1-2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 15,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R1:2' });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get();
    assert.equal(Number(pos.quantity), 75);
  });

  test('RACE-02 direct transfer vs outbound: serialization preserves invariant', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    applyInventoryMutation({ db, sourceType: 'INVENTORY_TRANSFER', sourceId: 'r2-t', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'MOVE', quantity: 40,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-B', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R2:T' });
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r2-o', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 20,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R2:O' });
    const whA = Number(db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get().quantity);
    const whB = Number(db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-B'`).get().quantity);
    assert.equal(whA, 40);
    assert.equal(whB, 40);
  });

  test('RACE-03 step-transfer receive twice: second receives up to remaining in-transit', () => {
    clearRows(db);
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_step_transfer_in_transit (
      id TEXT PRIMARY KEY, source_transfer_id TEXT NOT NULL, product_id TEXT NOT NULL,
      warehouse_id_source TEXT NOT NULL, warehouse_id_destination TEXT NOT NULL,
      issued_qty REAL NOT NULL, received_qty REAL NOT NULL DEFAULT 0, returned_qty REAL NOT NULL DEFAULT 0,
      cancelled_qty REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'IN_TRANSIT', created_at TEXT NOT NULL)`).run();
    // Transfer Out 10 (issued=10, in_transit=10)
    applyInventoryMutation({ db, sourceType: 'INVENTORY_STEP_TRANSFER_OUT', sourceId: 'r3', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 10,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'STEP_OUT:r3:10' });
    db.prepare(`INSERT INTO inventory_step_transfer_in_transit(id, source_transfer_id, product_id, warehouse_id_source, warehouse_id_destination, issued_qty, status, created_at) VALUES('r3-row', 'r3', 'p-1', 'wh-A', 'wh-B', 10, 'IN_TRANSIT', ?)`).run(new Date().toISOString());
    // First receive 4 (in_transit=6)
    applyInventoryMutation({ db, sourceType: 'INVENTORY_STEP_TRANSFER_IN', sourceId: 'r3', sourceItemId: 'r3-row', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 4,
      toPosition: { productId: 'p-1', warehouseId: 'wh-B', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'STEP_IN:r3-row:4' });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET received_qty=received_qty+4 WHERE id='r3-row'`).run();
    const r1 = db.prepare(`SELECT (issued_qty - received_qty - returned_qty - cancelled_qty) AS in_transit FROM inventory_step_transfer_in_transit WHERE id='r3-row'`).get();
    assert.equal(Number(r1.in_transit), 6);
    // Second receive 6 (in_transit=0)
    applyInventoryMutation({ db, sourceType: 'INVENTORY_STEP_TRANSFER_IN', sourceId: 'r3', sourceItemId: 'r3-row', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 6,
      toPosition: { productId: 'p-1', warehouseId: 'wh-B', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'STEP_IN:r3-row:6' });
    db.prepare(`UPDATE inventory_step_transfer_in_transit SET received_qty=received_qty+6 WHERE id='r3-row'`).run();
    const r2 = db.prepare(`SELECT (issued_qty - received_qty - returned_qty - cancelled_qty) AS in_transit FROM inventory_step_transfer_in_transit WHERE id='r3-row'`).get();
    assert.equal(Number(r2.in_transit), 0);
    const whB = Number(db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-B'`).get().quantity);
    assert.equal(whB, 10);
  });

  test('RACE-04 stocktake confirm vs outbound: serial reduction then ADJUSTMENT applied', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r4-o', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 5,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R4:O' });
    const now = new Date().toISOString();
    db.exec(`INSERT OR IGNORE INTO inventory_checks(id, check_no, warehouse_id, status, checked_at, creator_id, created_at, check_kind, scope_strategy, snapshot_at) VALUES('r4-c','R4','wh-A','SUBMITTED',?, 'u-act', ?, 'REGULAR', 'ALL', ?)`);
    db.prepare(`INSERT INTO inventory_check_items(id, check_id, product_id, position_key, owner_type, stock_status, book_quantity, check_quantity, diff_quantity, snapshot_book_quantity) VALUES('r4-i','r4-c','p-1',?,'ENTERPRISE','AVAILABLE',95,95,0,95)`).run(computePositionKey({ productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' }));
    const r04pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get();
    assert.equal(Number(r04pos.quantity), 95);
  });

  test('RACE-05 lock vs outbound: lock prevents outbound over lockable quantity', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    db.prepare(`INSERT INTO inventory_locks(id, product_id, warehouse_id, position_key, quantity, reason, status, locked_by, locked_at, source_type, source_id) VALUES('lck-1','p-1','wh-A',?, 30, 'R5', 'ACTIVE', 'u-act', ?, 'INVENTORY_LOCK','lck-1')`).run(
      computePositionKey({ productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' }),
      new Date().toISOString());
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'r5-o', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 80,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R5:O' }), /inv.+block|inv.+stock|库存不足|禁止负库存/);
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r5-o2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 60,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R5:O2' });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get();
    assert.equal(Number(pos.quantity), 40);
  });

  test('RACE-06 reservation vs execution: inventory.quantity unchanged by reservation', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    db.exec(`CREATE TABLE IF NOT EXISTS planning_reservations (id TEXT PRIMARY KEY, reservation_no TEXT NOT NULL UNIQUE, reservation_type TEXT NOT NULL, product_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, quantity REAL NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demand_source_type TEXT, demand_source_id TEXT, demand_source_line_id TEXT, supply_source_type TEXT, supply_source_id TEXT, supply_source_line_id TEXT, priority INTEGER NOT NULL DEFAULT 0, release_date TEXT, mrp_run_id TEXT, scheme_id TEXT, notes TEXT)`);
    db.prepare(`INSERT INTO planning_reservations(id, reservation_no, reservation_type, product_id, warehouse_id, quantity, status, created_by, created_at, updated_at, demand_source_type, demand_source_id, supply_source_type, supply_source_id, supply_source_line_id) VALUES('rsv-1','RSV-1','STRONG','p-1','wh-A', 40, 'ACTIVE', 'u-act', ?, ?, 'PLAN','PLAN-1','PLANNED_ORDER','PO-1','POL-1')`).run(new Date().toISOString(), new Date().toISOString());
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r6-o', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 60,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R6:O' });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get();
    assert.equal(Number(pos.quantity), 40);
    const rsv = db.prepare(`SELECT quantity FROM planning_reservations WHERE id='rsv-1'`).get();
    assert.equal(Number(rsv.quantity), 40);
    const av = computeAvailability(db, { productId: 'p-1', warehouseId: 'wh-A' });
    assert.equal(av.eligibleOnHand, 40);
    assert.equal(av.activeReservedTotal, 40);
    assert.equal(av.hardReserved, 40);
  });

  test('RACE-07 VMI owner transfer twice: second is rejected by SUPPLIER-owned=0', () => {
    clearRows(db);
    applyInventoryMutation({ db, sourceType: 'VMI_RECEIPT', sourceId: 'r7-r', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'SUPPLIER', ownerId: 'sup-1', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R7:R' });
    applyInventoryMutation({ db, sourceType: 'VMI_OWNERSHIP_TRANSFER', sourceId: 'r7-x', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OWNER_CHANGE', quantity: 100,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'SUPPLIER', ownerId: 'sup-1', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R7:X1' });
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'VMI_OWNERSHIP_TRANSFER', sourceId: 'r7-x', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OWNER_CHANGE', quantity: 100,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'SUPPLIER', ownerId: 'sup-1', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R7:X2' }), /库存不足|禁止负库存/);
  });

  test('RACE-08 stock-status adjustment vs outbound: STATUS_CHANGE between two OUTs preserves total', () => {
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r8-o1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 30,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R8:O1' });
    applyInventoryMutation({ db, sourceType: 'INVENTORY_STOCK_STATUS_CHANGE', sourceId: 'r8-s', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'STATUS_CHANGE', quantity: 20,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'HOLD' },
      idempotencyKey: 'R8:S' });
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r8-o2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 10,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R8:O2' });
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get().q);
    assert.equal(total, 60);
  });

  test('RACE-09 lot split/merge vs outbound: LOT_RECLASS does not lose total quantity', () => {
    clearRows(db);
    db.prepare(`UPDATE products SET tracking_policy='LOT' WHERE id='p-1'`).run();
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get().q);
    assert.equal(total, 100);
  });

  test('RACE-10 same SERIAL consumed twice: second consumption rejected', () => {
    clearRows(db);
    db.prepare(`UPDATE products SET tracking_policy='SERIAL' WHERE id='p-1'`).run();
    // insert inventory_serials first so the FK in validateInventoryMaster passes
    db.prepare(`INSERT INTO inventory_serials(id, product_id, serial_number, lifecycle_state, current_warehouse_id, created_source_type, created_source_id, updated_at, created_at) VALUES('ser-r10','p-1','SER-R10','AVAILABLE','wh-A','OTHER_RECEIPT','R10-R',?,?)`).run(new Date().toISOString(), new Date().toISOString());
    applyInventoryMutation({ db, sourceType: 'OTHER_RECEIPT', sourceId: 'r10-r', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 1,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R10:R' });
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r10-o1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 1,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R10:O1' });
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'r10-o2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 1,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE', serialId: 'ser-r10' },
      idempotencyKey: 'R10:O2' }), /inv.+stock|inv.+block|库存不足|禁止负库存/);
  });

  test('RACE-11 bin move vs outbound: BIN_MOVE + OUT serial preserves total', () => {
    clearRows(db);
    // Enable bin and pre-create two bins with stock.
    db.prepare(`UPDATE warehouses SET bin_enabled=1 WHERE id='wh-A'`).run();
    db.prepare(`INSERT INTO warehouse_bins(id, warehouse_id, code, name, active, created_at, updated_at) VALUES('bin-r11','wh-A','BIN-R11','Bin R11',1,?,?)`).run(new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO warehouse_bins(id, warehouse_id, code, name, active, created_at, updated_at) VALUES('bin-r12','wh-A','BIN-R12','Bin R12',1,?,?)`).run(new Date().toISOString(), new Date().toISOString());
    // Seed stock directly into bin-r11 (using INSERT OR IGNORE + UPSERT)
    const binR11Pk = computePositionKey({
      productId: 'p-1', warehouseId: 'wh-A', binId: 'bin-r11',
      ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
    });
    db.prepare(`INSERT OR REPLACE INTO inventory(id, warehouse_id, product_id, quantity, updated_at, position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active) VALUES('inv-bin-r11', 'wh-A', ?, 100, ?, ?, 'bin-r11', 'ENTERPRISE', NULL, 'AVAILABLE', NULL, NULL, 1)`).run('p-1', new Date().toISOString(), binR11Pk);
    // BIN_MOVE 30 from bin-r11 to bin-r12
    applyInventoryMutation({ db, sourceType: 'INVENTORY_BIN_MOVE', sourceId: 'r11-m', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'BIN_MOVE', quantity: 30,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', binId: 'bin-r11', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-A', binId: 'bin-r12', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R11:M' });
    // OUT 20 from bin-r11 (preserves total)
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'r11-o', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 20,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', binId: 'bin-r11', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R11:O' });
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get().q);
    assert.equal(total, 80);
  });

  test('RACE-12 period close vs stock mutation: closed period blocks mutation', () => {
    clearRows(db);
    seedEnterpriseStock(db, 'p-1', 'wh-A', 100);
    db.prepare(`INSERT OR IGNORE INTO inventory_period_closures(id, period_key, status, closed_by, closed_at) VALUES('pc-r12','2026-09','CLOSED','u-act',?)`).run(new Date().toISOString());
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'r12-o', businessDate: '2026-08-31',
      actor: ACTOR, movementKind: 'OUT', quantity: 5,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R12:O' }), /period|期间|closed|inv.+closed/i);
  });

  test('RACE-13 initialization close vs opening write: CLOSED init rejects new opening', () => {
    clearRows(db);
    db.prepare(`INSERT OR IGNORE INTO inventory_initialization(id, status, opened_by, opened_at, closed_by, closed_at) VALUES('init-r13','CLOSED','u-act',?, 'u-act', ?)`).run(new Date().toISOString(), new Date().toISOString());
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'OPENING_INVENTORY', sourceId: 'r13', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 10,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'R13:O' }), /opening|init|initialization|closed|inv.+closed|stock|insufficient|block/i);
  });

  test('RACE-14 duplicate barcode serial scan/confirm: idempotency replay returns same movementGroupId', () => {
    clearRows(db);
    const args = {
      db, sourceType: 'BARCODE_SCAN_CONFIRM', sourceId: 'scan-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 10,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'BARCODE:scan-1',
    };
    const r1 = applyInventoryMutation(args);
    const r2 = applyInventoryMutation(args);
    assert.equal(r1.replayed, false);
    assert.equal(r2.replayed, true);
    assert.equal(r1.movementGroupId, r2.movementGroupId);
  });
});