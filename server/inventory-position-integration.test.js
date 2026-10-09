// V21 — Wave A integration tests: migration, legacy compatibility reads,
// owner dimension aggregates, fail-closed reconciliation.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { migrateInventoryPositionSchema } from './migrations/inventory-position-schema.js';
import { computePositionKey } from './lib/inventory-position.js';
import { aggregateInventoryByWarehouseProduct, listCanonicalInventoryPositions } from './lib/inventory-compat-read.js';

describe('V21 Wave A — Inventory Position Foundation', () => {
  let db;
  let dbDir;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-pos-'));
    const path = join(dbDir, 'test.db');
    db = createDatabase(path);
  });

  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('migration creates new tables', () => {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_parameters','inventory_stock_statuses','warehouse_bins','inventory_locks','inventory_reconciliation_results') ORDER BY name`).all().map(r => r.name);
    assert.ok(tables.includes('inventory_parameters'));
    assert.ok(tables.includes('inventory_stock_statuses'));
    assert.ok(tables.includes('warehouse_bins'));
    assert.ok(tables.includes('inventory_locks'));
    assert.ok(tables.includes('inventory_reconciliation_results'));
  });

  test('stock statuses seeded with required canonical set', () => {
    const codes = db.prepare(`SELECT code FROM inventory_stock_statuses ORDER BY code`).all().map(r => r.code);
    for (const code of ['AVAILABLE', 'INSPECTION', 'QUARANTINE', 'HOLD', 'BLOCKED']) {
      assert.ok(codes.includes(code), `Missing seeded status: ${code}`);
    }
    const available = db.prepare(`SELECT * FROM inventory_stock_statuses WHERE code='AVAILABLE'`).get();
    assert.equal(Number(available.reservable), 1);
    assert.equal(Number(available.issuable), 1);
    assert.equal(Number(available.shippable), 1);
    assert.equal(Number(available.transferable), 1);
    const quarantine = db.prepare(`SELECT * FROM inventory_stock_statuses WHERE code='QUARANTINE'`).get();
    assert.equal(Number(quarantine.reservable), 0);
    assert.equal(Number(quarantine.issuable), 0);
    assert.equal(Number(quarantine.transferable), 0);
  });

  test('inventory_parameters DEFAULT row exists with frozen defaults', () => {
    const row = db.prepare(`SELECT * FROM inventory_parameters WHERE id='DEFAULT'`).get();
    assert.ok(row);
    assert.equal(row.negative_stock_policy, 'BLOCK');
    assert.equal(row.stocktake_window_days, 30);
    assert.equal(row.lot_default_status, 'AVAILABLE');
    assert.equal(row.serial_default_status, 'AVAILABLE');
  });

  test('warehouses additive columns present', () => {
    const cols = db.prepare(`PRAGMA table_info(warehouses)`).all().map(r => r.name);
    for (const c of ['bin_enabled', 'is_supplier_wip', 'negative_stock_policy', 'mrp_participation', 'inventory_lock_enabled']) {
      assert.ok(cols.includes(c), `Missing warehouses.${c}`);
    }
  });

  test('inventory additive columns present + position_key backfilled', () => {
    const cols = db.prepare(`PRAGMA table_info(inventory)`).all().map(r => r.name);
    for (const c of ['position_key', 'bin_id', 'owner_type', 'owner_id', 'stock_status', 'lot_id', 'serial_id', 'active']) {
      assert.ok(cols.includes(c), `Missing inventory.${c}`);
    }
    const noPk = db.prepare(`SELECT COUNT(*) c FROM inventory WHERE position_key IS NULL OR position_key=''`).get();
    assert.equal(Number(noPk.c), 0);
  });

  test('UNIQUE(position_key) index present', () => {
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='inventory'`).all().map(r => r.name);
    assert.ok(indexes.includes('uq_inventory_position_key'));
    assert.ok(indexes.includes('idx_inventory_product_wh_status'));
    assert.ok(indexes.includes('idx_inventory_owner'));
  });

  test('fail-closed reconciliation: LOT product with inventory but no lot balance produces mismatch row', () => {
    // Seed required master rows
    const productId  = 'TEST-PROD-LOT';
    const warehouseId = 'TEST-WH-LOT';
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run(warehouseId, 'WH-LOT', 'WH LOT', new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,'LOT',?,?)`).run(productId, 'PROD-LOT', 'PROD LOT', 'CAT', 'PCS', 1000, 0, new Date().toISOString(), new Date().toISOString());

    const pk = computePositionKey({ productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' });
    // Clean up any prior conflicting row from a previous run (idempotent).
    db.prepare(`DELETE FROM inventory WHERE id='inv-lot-1'`).run();
    db.prepare(`INSERT INTO inventory(id, warehouse_id, product_id, quantity, position_key, owner_type, owner_id, stock_status, updated_at) VALUES('inv-lot-1',?,?,10,?,'ENTERPRISE',NULL,'AVAILABLE',?)`).run(warehouseId, productId, pk, new Date().toISOString());

    // Re-run migration to trigger reconciliation (idempotent; safe).
    migrateInventoryPositionSchema(db);

    const rec = db.prepare(`SELECT * FROM inventory_reconciliation_results WHERE product_id=? AND warehouse_id=? AND kind='LOT'`).get(productId, warehouseId);
    assert.ok(rec, 'Expected fail-closed reconciliation row for LOT mismatch');
    assert.equal(Number(rec.expected_quantity), 10);
    assert.equal(Number(rec.derived_quantity), 0);
    assert.notEqual(Number(rec.difference), 0);
  });

  test('compatibility read: aggregateInventoryByWarehouseProduct sums canonical positions', () => {
    const productId = 'TEST-PROD-AGG';
    const warehouseId = 'TEST-WH-AGG';
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run(warehouseId, 'WH-AGG', 'WH AGG', new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,'NONE',?,?)`).run(productId, 'PROD-AGG', 'PROD AGG', 'CAT', 'PCS', 1000, 0, new Date().toISOString(), new Date().toISOString());

    const ent  = computePositionKey({ productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' });
    const hold = computePositionKey({ productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'HOLD' });
    db.prepare(`DELETE FROM inventory WHERE id IN ('inv-ent-agg','inv-hold-agg')`).run();
    db.prepare(`INSERT INTO inventory(id, warehouse_id, product_id, quantity, position_key, owner_type, owner_id, stock_status, updated_at) VALUES('inv-ent-agg',?,?,20,?,'ENTERPRISE',NULL,'AVAILABLE',?)`).run(warehouseId, productId, ent, new Date().toISOString());
    db.prepare(`INSERT INTO inventory(id, warehouse_id, product_id, quantity, position_key, owner_type, owner_id, stock_status, updated_at) VALUES('inv-hold-agg',?,?,5,?,'ENTERPRISE',NULL,'HOLD',?)`).run(warehouseId, productId, hold, new Date().toISOString());

    const rows = aggregateInventoryByWarehouseProduct(db, { warehouseId, productId });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.totalQuantity, 25);
    assert.equal(row.availableQuantity, 20);
    assert.equal(row.enterpriseOwnedQuantity, 25);
    assert.equal(row.positionCount, 2);
  });

  test('compatibility read: listCanonicalInventoryPositions filters by SUPPLIER owner', () => {
    const supplierId = 'TEST-SUP-LIST';
    const productId = 'TEST-PROD-LIST';
    const warehouseId = 'TEST-WH-LIST';
    db.prepare(`INSERT OR IGNORE INTO suppliers(id,code,name,outsourcing_enabled,active,created_at,updated_at) VALUES(?,?,?,1,1,?,?)`).run(supplierId, 'SUP-LIST', 'SUP LIST', new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES(?,?,?,1,0,?,?)`).run(warehouseId, 'WH-LIST', 'WH LIST', new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,'NONE',?,?)`).run(productId, 'PROD-LIST', 'PROD LIST', 'CAT', 'PCS', 1000, 0, new Date().toISOString(), new Date().toISOString());

    const supPk = computePositionKey({ productId, warehouseId, binId: null, ownerType: 'SUPPLIER', ownerId: supplierId, stockStatus: 'AVAILABLE' });
    db.prepare(`DELETE FROM inventory WHERE id='inv-sup-list'`).run();
    db.prepare(`INSERT INTO inventory(id, warehouse_id, product_id, quantity, position_key, owner_type, owner_id, stock_status, updated_at) VALUES('inv-sup-list',?,?,7,?,'SUPPLIER',?,'AVAILABLE',?)`).run(warehouseId, productId, supPk, supplierId, new Date().toISOString());

    const rows = listCanonicalInventoryPositions(db, { ownerType: 'SUPPLIER', ownerId: supplierId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ownerType, 'SUPPLIER');
    assert.equal(rows[0].ownerId, supplierId);
    assert.equal(rows[0].quantity, 7);
  });
});