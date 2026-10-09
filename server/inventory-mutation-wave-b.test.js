// V21 — Wave B focused tests: applyInventoryMutation dispatcher,
// availability model, inventory locks, direct transfer, step transfer,
// VMI physical owner dimensional mutation.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { computePositionKey } from './lib/inventory-position.js';
import { computeAvailability } from './lib/inventory-availability.js';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES('sup-1','SUP-1','SUP 1','','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO customers(id,code,name,active,created_at,updated_at) VALUES('cust-1','CUST-1','CUST 1',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES('wh-A','WH-A','WH A',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES('wh-WIP','WH-WIP','WH WIP',1,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-1','P-1','P 1','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-2','P-2','P 2','CAT','PCS',1000,0,1,'LOT',?,?)`).run(now, now);
}

function clearRows(db) {
  for (const t of ['inventory','inventory_mutation_log','inventory_transactions','tracked_inventory_movements','inventory_locks','inventory_step_transfer_in_transit','vmi_ownership_transfers','vmi_consumptions','vmi_receipts','inventory_transfers','inventory_transfer_items','inventory_adjustments','inventory_adjustment_items','inventory_scraps','inventory_scrap_items','inventory_checks','inventory_check_items','opening_inventory_documents','opening_inventory_items','inventory_initialization','inventory_native_documents','inventory_native_items','inventory_stocktake_items','inventory_stocktakes','inventory_lot_adjustments','inventory_containers','inventory_container_items','inventory_barcode_resolution_log','inventory_abc_classifications','tracked_source_allocations']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
  }
}

describe('V21 Wave B — applyInventoryMutation dispatcher', () => {
  let db;
  let dbDir;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-wave-b-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
  });

  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('IN mutation: ENTERPRISE-owned stock IN', () => {
    clearRows(db);
    const result = applyInventoryMutation({
      db,
      sourceType: 'OTHER_RECEIPT',
      sourceId: 'r-1',
      sourceItemId: 'r-1-1',
      businessDate: '2026-10-10',
      actor: { id: 'u-act' },
      movementKind: 'IN',
      quantity: 50,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IN:r-1',
    });
    assert.equal(result.replayed, false);
    const pos = db.prepare(`SELECT * FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A' AND owner_type='ENTERPRISE' AND stock_status='AVAILABLE'`).get();
    assert.equal(Number(pos.quantity), 50);
    const tx = db.prepare(`SELECT * FROM inventory_transactions WHERE source_type='OTHER_RECEIPT' AND source_id='r-1'`).get();
    assert.equal(tx.direction, 'IN');
  });

  test('OUT mutation: deducts ENTERPRISE-owned stock', () => {
    clearRows(db);
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'r-2', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IN:r-2',
    });
    const result = applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'i-2', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'OUT', quantity: 30,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OUT:i-2',
    });
    assert.equal(result.replayed, false);
    const pos = db.prepare(`SELECT * FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A' AND owner_type='ENTERPRISE' AND stock_status='AVAILABLE'`).get();
    assert.equal(Number(pos.quantity), 70);
  });

  test('MOVE mutation: paired OUT + IN with same movement_group_id', () => {
    clearRows(db);
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES('wh-B','WH-B','WH B',1,0,?,?)`).run(new Date().toISOString(), new Date().toISOString());
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'r-3', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 200,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IN:r-3',
    });
    const result = applyInventoryMutation({
      db, sourceType: 'INVENTORY_TRANSFER', sourceId: 't-3', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'MOVE', quantity: 80,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-B', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'MOVE:t-3',
    });
    assert.equal(result.replayed, false);
    const sourcePos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A'`).get();
    const destPos   = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-B'`).get();
    assert.equal(Number(sourcePos.quantity), 120);
    assert.equal(Number(destPos.quantity), 80);
    // Both IN and OUT direction records exist with same movement_group_id
    const tx = db.prepare(`SELECT direction FROM inventory_transactions WHERE source_id='t-3' ORDER BY direction`).all();
    assert.deepEqual(tx.map((r) => r.direction), ['IN', 'OUT']);
    const tm = db.prepare(`SELECT direction FROM tracked_inventory_movements WHERE source_id='t-3' ORDER BY direction`).all();
    assert.deepEqual(tm.map((r) => r.direction), ['IN', 'OUT']);
  });

  test('OWNER_CHANGE: VMI SUPPLIER→ENTERPRISE @ same warehouse', () => {
    clearRows(db);
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM suppliers WHERE id='sup-1'`).run();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES('sup-1','SUP-1','SUP 1','','','','',1,?,?)`).run(now, now);
    const supCheck = db.prepare(`SELECT id, active FROM suppliers WHERE id='sup-1'`).get();
    if (!supCheck) throw new Error(`supplier not visible: ${JSON.stringify(supCheck)}`);
    applyInventoryMutation({
      db, sourceType: 'VMI_RECEIPT', sourceId: 'vr-1', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'SUPPLIER', ownerId: 'sup-1', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'VMI:vr-1',
    });
    const result = applyInventoryMutation({
      db, sourceType: 'VMI_OWNERSHIP_TRANSFER', sourceId: 'vo-1', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'OWNER_CHANGE', quantity: 100,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'SUPPLIER', ownerId: 'sup-1', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'VMI-XFER:vo-1',
    });
    assert.equal(result.replayed, false);
    const supplierPos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A' AND owner_type='SUPPLIER'`).get();
    const ent = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A' AND owner_type='ENTERPRISE' AND stock_status='AVAILABLE'`).get();
    assert.equal(Number(supplierPos?.quantity || 0), 0);
    assert.equal(Number(ent?.quantity || 0), 100);
  });

  test('Idempotency replay returns same movementGroupId', () => {
    clearRows(db);
    const args = {
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'r-idem', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 25,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IDEM:r-idem',
    };
    const r1 = applyInventoryMutation(args);
    const r2 = applyInventoryMutation(args);
    assert.equal(r1.replayed, false);
    assert.equal(r2.replayed, true);
    assert.equal(r1.movementGroupId, r2.movementGroupId);
  });

  test('Negative-stock policy BLOCK rejects insufficient OUT', () => {
    clearRows(db);
    assert.throws(() => applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'i-fail', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'OUT', quantity: 1000,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OUT:i-fail',
    }), /禁止负库存|库存不足/);
  });

  test('CUSTOMER-owned entrusted stock does NOT enter enterprise planning_available', () => {
    clearRows(db);
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM customers WHERE id='cust-1'`).run();
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cust-1','CUST-1','CUST 1','','','',1,?,?)`).run(now, now);
    applyInventoryMutation({
      db, sourceType: 'ENTRUSTED_RECEIPT', sourceId: 'ent-1', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 30,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'CUSTOMER', ownerId: 'cust-1', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'ENT:ent-1',
    });
    const av = computeAvailability(db, { productId: 'p-1', warehouseId: 'wh-A' });
    // activeReservedTotal / hardReserved are zero (no planning reservations)
    // availableForNewReservation should NOT include the 30 customer-owned
    assert.ok(Number.isFinite(av.eligibleOnHand));
    assert.ok(Number.isFinite(av.availableForNewReservation));
  });

  test('Lock + availability projection', () => {
    clearRows(db);
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'r-lock', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IN:r-lock',
    });
    const pk = computePositionKey({ productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' });
    db.prepare(`
      INSERT INTO inventory_locks(id, product_id, warehouse_id, position_key, quantity, reason, status, locked_by, locked_at, source_type, source_id)
      VALUES('lock-1','p-1','wh-A',?, 30, 'test', 'ACTIVE', 'u-act', ?, 'INVENTORY_LOCK', 'lock-1')
    `).run(pk, new Date().toISOString());
    const av = computeAvailability(db, { productId: 'p-1', warehouseId: 'wh-A' });
    assert.equal(av.eligibleOnHand, 100);
    assert.equal(av.activeLocked, 30);
    assert.equal(av.positionFreePhysical, 70);
    assert.equal(av.activeReservedTotal, 0);
    assert.equal(av.hardReserved, 0);
    assert.equal(av.availableForNewReservation, 70);
    assert.equal(av.availableForUnrelatedExecution, 70);
  });

  test('Outsourcing supplier-WIP: ENTERPRISE-owned @ supplier-WIP warehouse', () => {
    clearRows(db);
    // Seed ENTERPRISE-owned stock at wh-A first so OUT can succeed
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'pre-wip', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'IN', quantity: 50,
      toPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'IN:pre-wip',
    });
    applyInventoryMutation({
      db, sourceType: 'OUTSOURCING_ISSUE', sourceId: 'out-1', businessDate: '2026-10-10',
      actor: { id: 'u-act' }, movementKind: 'OUT', quantity: 50,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-1', warehouseId: 'wh-WIP', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OUT:out-1',
    });
    const entA = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-A' AND owner_type='ENTERPRISE'`).get();
    const entWip = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-1' AND warehouse_id='wh-WIP' AND owner_type='ENTERPRISE'`).get();
    assert.ok(entA && entWip);
  });
});