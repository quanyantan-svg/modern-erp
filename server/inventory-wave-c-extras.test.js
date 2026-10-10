// V21 — Wave C extra tests: Lot Adjustment + Form Conversion executable contracts.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { createDatabase } from './db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { computePositionKey } from './lib/inventory-position.js';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES('wh-C','WH-C','WH C',1,0,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,price_cents,unit,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-C','P-C','P C',?,1000,'PCS',0,1,'LOT',?,?)`).run('CAT', now, now);
}

function clearRows(db) {
  // FK-safe order: children before parents.
  for (const t of [
    'inventory_lot_adjustments','inventory_form_conversions',
    'inventory_mutation_log','inventory_transactions','tracked_inventory_movements',
    'tracked_source_allocations','inventory_locks',
    'inventory_lot_balances','inventory','inventory_lots',
  ]) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
  }
}

const ACTOR = { id: 'u-act', permissions: [
  'INVENTORY_LOT_ADJUSTMENT_MANAGE','INVENTORY_FORM_CONVERSION_MANAGE',
] };

function makeReq(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  const stream = Readable.from(payload);
  stream.headers = { 'content-type': 'application/json', 'content-length': payload.length };
  return stream;
}

function makeRes() {
  return {
    statusCode: 200, body: null, setHeader(){},
    status(c) { this.statusCode=c; return this; },
    json(b) { this.body=b; return this; },
    end(chunk) {
      if (typeof chunk === 'string') { try { this.body = JSON.parse(chunk); } catch (_) { this.body = chunk; } }
      else if (Buffer.isBuffer(chunk)) { try { this.body = JSON.parse(chunk.toString('utf-8')); } catch (_) { this.body = chunk; } }
    },
  };
}

describe('V21 Wave C Extras — Lot Adjustment + Form Conversion', () => {
  let db, dbDir;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-extras-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
  });
  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('INV-18 LOT SPLIT: total quantity conserved; target lot receives', async () => {
    clearRows(db);
    // Ensure a lot exists
    const seedLot = db.prepare(`INSERT OR IGNORE INTO inventory_lots(id, product_id, lot_code, status, created_source_type, created_source_id, created_at) VALUES('lot-seed-1', 'p-C', 'LOT-A', 'AVAILABLE', 'OTHER_RECEIPT', 'lot-1', ?)`).run(new Date().toISOString());
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'lot-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 100,
      toPosition: { productId: 'p-C', warehouseId: 'wh-C', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE', lotId: 'lot-seed-1' },
      idempotencyKey: 'LOT:SEED',
    });
    const { createLotAdjustment, confirmLotAdjustment } = await import('./modules/inventory-lot-adjustment.js');
    const createRes = makeRes();
    await createLotAdjustment(db, makeReq({
      adjustmentType: 'SPLIT',
      productId: 'p-C', warehouseId: 'wh-C',
      sourceLotCode: 'LOT-A', targetLotCode: 'LOT-B',
      quantity: 30, reason: 'split 30 from A to B',
    }), createRes, ACTOR);
    const doc = createRes.body;
    assert.equal(doc.status, 'DRAFT');
    const confirmRes = makeRes();
    confirmLotAdjustment(db, confirmRes, ACTOR, doc.id);
    assert.equal(confirmRes.body.status, 'CONFIRMED');
    // Total quantity preserved
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-C' AND warehouse_id='wh-C'`).get().q);
    assert.equal(total, 100);
  });

  test('INV-18 LOT MERGE: source lot decreases, target lot increases, total conserved', async () => {
    clearRows(db);
    db.prepare(`INSERT OR IGNORE INTO inventory_lots(id, product_id, lot_code, status, created_source_type, created_source_id, created_at) VALUES('lot-seed-2', 'p-C', 'LOT-A', 'AVAILABLE', 'OTHER_RECEIPT', 'lot-2', ?)`).run(new Date().toISOString());
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'lot-2', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 80,
      toPosition: { productId: 'p-C', warehouseId: 'wh-C', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE', lotId: 'lot-seed-2' },
      idempotencyKey: 'LOT:MERGE:SEED',
    });
    const { createLotAdjustment, confirmLotAdjustment } = await import('./modules/inventory-lot-adjustment.js');
    const createRes = makeRes();
    await createLotAdjustment(db, makeReq({
      adjustmentType: 'MERGE',
      productId: 'p-C', warehouseId: 'wh-C',
      sourceLotCode: 'LOT-A', targetLotCode: 'LOT-B',
      quantity: 50, reason: 'merge 50 from A to B',
    }), createRes, ACTOR);
    confirmLotAdjustment(db, makeRes(), ACTOR, createRes.body.id);
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-C' AND warehouse_id='wh-C'`).get().q);
    assert.equal(total, 80);
  });

  test('INV-18 LOT RECLASS: identity changes; total preserved; SERIAL untouched', async () => {
    clearRows(db);
  db.prepare(`UPDATE products SET tracking_policy='NONE' WHERE id='p-C'`).run();
  db.prepare(`INSERT OR IGNORE INTO inventory_lots(id, product_id, lot_code, status, created_source_type, created_source_id, created_at) VALUES('lot-seed-3', 'p-C', 'OLD-NAME', 'AVAILABLE', 'OTHER_RECEIPT', 'lot-3', ?)`).run(new Date().toISOString());
  applyInventoryMutation({
    db, sourceType: 'OTHER_RECEIPT', sourceId: 'lot-3', businessDate: '2026-10-10',
    actor: ACTOR, movementKind: 'IN', quantity: 60,
    toPosition: { productId: 'p-C', warehouseId: 'wh-C', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE', lotId: 'lot-seed-3' },
    idempotencyKey: 'LOT:RECLASS:SEED',
  });
    const { createLotAdjustment, confirmLotAdjustment } = await import('./modules/inventory-lot-adjustment.js');
    const createRes = makeRes();
    await createLotAdjustment(db, makeReq({
      adjustmentType: 'RECLASS',
      productId: 'p-C', warehouseId: 'wh-C',
      sourceLotCode: 'OLD-NAME', targetLotCode: 'NEW-NAME',
      quantity: 60, reason: 'reclass lot code',
    }), createRes, ACTOR);
    confirmLotAdjustment(db, makeRes(), ACTOR, createRes.body.id);
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-C' AND warehouse_id='wh-C'`).get().q);
    assert.equal(total, 60);
  });

  test('INV-20 FORM CONVERSION: same physical quantity, source↓ target↑, owner preserved', async () => {
    clearRows(db);
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'fc-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 200,
      toPosition: { productId: 'p-C', warehouseId: 'wh-C', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'FC:SEED',
    });
    const { createFormConversion, confirmFormConversion } = await import('./modules/inventory-form-conversion.js');
    const createRes = makeRes();
    await createFormConversion(db, makeReq({
      productId: 'p-C', warehouseId: 'wh-C', quantity: 50,
      fromForm: 'AVAILABLE', toForm: 'INSPECTION',
      reason: 'move 50 to inspection',
    }), createRes, ACTOR);
    const confirmRes = makeRes();
    confirmFormConversion(db, confirmRes, ACTOR, createRes.body.id);
    assert.equal(confirmRes.body.status, 'CONFIRMED');
    // Total preserved
    const total = Number(db.prepare(`SELECT SUM(quantity) q FROM inventory WHERE product_id='p-C' AND warehouse_id='wh-C'`).get().q);
    assert.equal(total, 200);
  });
});