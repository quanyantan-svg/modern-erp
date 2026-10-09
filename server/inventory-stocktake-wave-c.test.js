// V21 — Wave C focused tests: opening initialization, native documents,
// stocktake (snapshot book qty + diff adjustment).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { createDatabase } from './db.js';
import { openInitialization, closeInitialization, confirmOpeningDocument } from './modules/inventory-opening.js';
import { confirmNativeDocument } from './modules/inventory-native-document.js';
import { approveStocktake } from './modules/inventory-stocktake.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES('wh-S','WH-S','WH S',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-S','P-S','SKU STK','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
}

function clearRows(db) {
  for (const t of ['inventory_mutation_log','inventory_transactions','tracked_inventory_movements','inventory_locks','inventory_step_transfer_in_transit','vmi_ownership_transfers','vmi_consumptions','vmi_receipts','inventory_transfers','inventory_transfer_items','inventory_adjustments','inventory_adjustment_items','inventory_scraps','inventory_scrap_items','inventory_checks','inventory_check_items','opening_inventory_documents','opening_inventory_items','inventory_initialization','inventory_native_documents','inventory_native_items','inventory_stocktakes','inventory_lot_adjustments','inventory_containers','inventory_container_items','inventory_barcode_resolution_log','inventory_abc_classifications','tracked_source_allocations','inventory']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
  }
}

const ADMIN_PERMISSIONS = ['INVENTORY_CHECK_APPROVE','INVENTORY_CHECK_CREATE','INVENTORY_OPENING_MANAGE','INVENTORY_NATIVE_DOCUMENT_MANAGE','INVENTORY_LOCK_MANAGE','INVENTORY_TRANSFER_CONFIRM','WAREHOUSE_BIN_MANAGE','STOCK_STATUS_MANAGE','OWNER_DIMENSION_VIEW','INVENTORY_PARAMETERS_MANAGE'];
const ACTOR = { id: 'u-act', permissions: ADMIN_PERMISSIONS };

function makeReq(bodyObj) {
  // readJson iterates req as a stream of Buffer chunks; emulate an HTTP req.
  const payload = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
  return Readable.from(payload, { objectMode: false });
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() {},
  };
}

describe('V21 Wave C — Opening / Native / Stocktake', () => {
  let db;
  let dbDir;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-wave-c-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
  });
  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('Opening initialization lifecycle', () => {
    clearRows(db);
    const opened = openInitialization(db, ACTOR);
    assert.equal(opened.status, 'OPEN');
    const closed = closeInitialization(db, ACTOR);
    assert.equal(closed.status, 'CLOSED');
  });

  test('Opening via applyInventoryMutation creates ENTERPRISE-owned positions', () => {
    clearRows(db);
    openInitialization(db, ACTOR);
    applyInventoryMutation({
      db,
      sourceType: 'OPENING_INVENTORY',
      sourceId: 'op-1',
      businessDate: '2026-10-10',
      actor: ACTOR,
      movementKind: 'IN',
      quantity: 100,
      toPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OPENING:op-1',
      remark: 'Opening inventory',
    });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-S' AND warehouse_id='wh-S' AND owner_type='ENTERPRISE' AND stock_status='AVAILABLE'`).get();
    assert.equal(Number(pos.quantity), 100);
  });

  test('Other Receipt IN via applyInventoryMutation', () => {
    clearRows(db);
    applyInventoryMutation({
      db,
      sourceType: 'OTHER_RECEIPT',
      sourceId: 'or-1',
      businessDate: '2026-10-10',
      actor: ACTOR,
      movementKind: 'IN',
      quantity: 50,
      toPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_RECEIPT:or-1',
      remark: 'Other receipt',
    });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-S' AND warehouse_id='wh-S'`).get();
    assert.equal(Number(pos.quantity), 50);
  });

  test('Other Issue OUT via applyInventoryMutation', () => {
    clearRows(db);
    applyInventoryMutation({ db, sourceType: 'OTHER_RECEIPT', sourceId: 'or-2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 200,
      toPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_RECEIPT:or-2' });
    applyInventoryMutation({ db, sourceType: 'OTHER_ISSUE', sourceId: 'oi-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'OUT', quantity: 30,
      fromPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_ISSUE:oi-1' });
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-S' AND warehouse_id='wh-S'`).get();
    assert.equal(Number(pos.quantity), 170);
  });

  test('Stocktake APPROVE applies ADJUSTMENT for physical < book', () => {
    clearRows(db);
    applyInventoryMutation({ db, sourceType: 'OTHER_RECEIPT', sourceId: 'or-3', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_RECEIPT:or-3' });
    // Insert inventory_check + items manually (avoiding req body parsing)
    const now = new Date().toISOString();
    const checkId = 'stk-1';
    db.prepare(`INSERT INTO inventory_checks(id, check_no, warehouse_id, status, checked_at, creator_id, created_at, check_kind, scope_strategy, snapshot_at) VALUES(?, 'STK-001', 'wh-S', 'SUBMITTED', ?, 'u-act', ?, 'REGULAR', 'ALL', ?)`).run(checkId, now, now, now);
    db.prepare(`INSERT INTO inventory_check_items(id, check_id, product_id, position_key, owner_type, stock_status, book_quantity, check_quantity, diff_quantity, snapshot_book_quantity) VALUES('stk-item-1', ?, 'p-S', 'pk-1', 'ENTERPRISE', 'AVAILABLE', 100, 95, -5, 100)`).run(checkId);
    approveStocktake(db, makeRes(), ACTOR, checkId);
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-S' AND warehouse_id='wh-S'`).get();
    assert.equal(Number(pos.quantity), 95);
  });

  test('Stocktake APPROVE applies ADJUSTMENT for physical > book (gain)', () => {
    clearRows(db);
    applyInventoryMutation({ db, sourceType: 'OTHER_RECEIPT', sourceId: 'or-4', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 50,
      toPosition: { productId: 'p-S', warehouseId: 'wh-S', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_RECEIPT:or-4' });
    const now = new Date().toISOString();
    const checkId = 'stk-2';
    db.prepare(`INSERT INTO inventory_checks(id, check_no, warehouse_id, status, checked_at, creator_id, created_at, check_kind, scope_strategy, snapshot_at) VALUES(?, 'STK-002', 'wh-S', 'SUBMITTED', ?, 'u-act', ?, 'REGULAR', 'ALL', ?)`).run(checkId, now, now, now);
    db.prepare(`INSERT INTO inventory_check_items(id, check_id, product_id, position_key, owner_type, stock_status, book_quantity, check_quantity, diff_quantity, snapshot_book_quantity) VALUES('stk-item-2', ?, 'p-S', 'pk-2', 'ENTERPRISE', 'AVAILABLE', 50, 75, 25, 50)`).run(checkId);
    approveStocktake(db, makeRes(), ACTOR, checkId);
    const pos = db.prepare(`SELECT quantity FROM inventory WHERE product_id='p-S' AND warehouse_id='wh-S'`).get();
    assert.equal(Number(pos.quantity), 75);
  });
});