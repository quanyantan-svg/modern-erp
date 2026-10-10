// V21 — Inventory Lot Adjustment (Wave C closure).
//
// Frozen by `solution.md §27.26` (Domain 5 Closure Design).
// Supports split / merge / reclass. Total quantity conserved. SERIAL identity
// NEVER modified (Domain 2 frozen). All mutations route through applyInventoryMutation.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_lot_adjustments (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('SPLIT','MERGE','RECLASS')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      source_lot_id TEXT,
      source_lot_code TEXT,
      target_lot_id TEXT,
      target_lot_code TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );
  `);
}

function ensureLot(db, productId, lotCode) {
  // Ensure inventory_lots row exists for product/lot_code; if not, create a new LOT.
  const existing = db.prepare(`SELECT id FROM inventory_lots WHERE product_id=? AND lot_code=?`).get(productId, lotCode);
  if (existing) return existing.id;
  const id = genId();
  db.prepare(`
    INSERT INTO inventory_lots(id, product_id, lot_code, status, created_source_type, created_source_id, created_at)
    VALUES(?, ?, ?, 'AVAILABLE', 'LOT_ADJUSTMENT', ?, ?)
  `).run(id, productId, lotCode, `LOT_ADJ:${lotCode}`, nowIso());
  return id;
}

export async function createLotAdjustment(db, req, res, actor) {
  allow(actor, 'INVENTORY_LOT_ADJUSTMENT_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['adjustmentType','productId','warehouseId','sourceLotCode','targetLotCode','quantity','reason']);
  if (!['SPLIT', 'MERGE', 'RECLASS'].includes(body.adjustmentType)) {
    throw new HttpError(400, 'adjustmentType must be SPLIT/MERGE/RECLASS');
  }
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, 'quantity must be positive');
  const id = genId();
  const docNo = `LA-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`
      INSERT INTO inventory_lot_adjustments(id, doc_no, adjustment_type, status, product_id, warehouse_id, reason, creator_id, created_at, source_lot_code, target_lot_code, quantity)
      VALUES(?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, docNo, body.adjustmentType, body.productId, body.warehouseId, body.reason || '', actor.id, now, body.sourceLotCode || null, body.targetLotCode || null, quantity);
    audit(db, actor.id, 'CREATE', 'LOT_ADJUSTMENT', id, `Create ${body.adjustmentType} ${docNo}`);
  });
  return send(res, 201, { id, docNo, adjustmentType: body.adjustmentType, status: 'DRAFT' });
}

export function confirmLotAdjustment(db, res, actor, docId) {
  allow(actor, 'INVENTORY_LOT_ADJUSTMENT_MANAGE');
  const doc = db.prepare(`SELECT * FROM inventory_lot_adjustments WHERE id=?`).get(docId);
  if (!doc) throw new HttpError(404, 'Lot adjustment not found');
  if (doc.status !== 'DRAFT') throw new HttpError(409, `Status ${doc.status} not confirmable`);
  const now = nowIso();
  // Compute source and target lot identities
  const sourceLotId = doc.source_lot_code ? ensureLot(db, doc.product_id, doc.source_lot_code) : null;
  const targetLotId = doc.target_lot_code ? ensureLot(db, doc.product_id, doc.target_lot_code) : null;
  const idempotencyKey = `LOT_ADJ:${docId}`;
  const movementKind = 'LOT_RECLASS';
  // Each applyInventoryMutation opens its own transaction; do NOT wrap in outer.
  {
    if (doc.adjustment_type === 'MERGE') {
      // MERGE: from multiple source lots into single target lot.
      // For simplicity (only one source_lot_code in this minimal model), treat source as single.
      applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_LOT_ADJUSTMENT',
        sourceId: docId,
        sourceItemId: `${docId}:source`,
        businessDate: now.slice(0, 10),
        actor: { id: actor.id },
        movementKind,
        quantity: Number(doc.quantity),
        fromPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: sourceLotId, serialId: null,
        },
        toPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: targetLotId, serialId: null,
        },
        idempotencyKey,
        remark: `LOT MERGE ${doc.doc_no}`,
      });
    } else if (doc.adjustment_type === 'SPLIT') {
      // SPLIT: from one source lot to two — split quantity into source (qty - amount) + target (amount).
      // For this minimal model we record source reduction + target addition as paired moves.
      const splitAmount = Number(doc.quantity);
      applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_LOT_ADJUSTMENT',
        sourceId: docId,
        sourceItemId: `${docId}:split`,
        businessDate: now.slice(0, 10),
        actor: { id: actor.id },
        movementKind,
        quantity: splitAmount,
        fromPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: sourceLotId, serialId: null,
        },
        toPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: targetLotId, serialId: null,
        },
        idempotencyKey,
        remark: `LOT SPLIT ${doc.doc_no}`,
      });
    } else if (doc.adjustment_type === 'RECLASS') {
      // RECLASS: legal lot reclass (e.g., lot_code rename). Implemented as LOT_RECLASS
      // move from old lot_id to new lot_id; identical lot — only identity changes.
      applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_LOT_ADJUSTMENT',
        sourceId: docId,
        sourceItemId: `${docId}:reclass`,
        businessDate: now.slice(0, 10),
        actor: { id: actor.id },
        movementKind,
        quantity: Number(doc.quantity),
        fromPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: sourceLotId, serialId: null,
        },
        toPosition: {
          productId: doc.product_id, warehouseId: doc.warehouse_id,
          binId: null, ownerType: 'ENTERPRISE', ownerId: null,
          stockStatus: 'AVAILABLE', lotId: targetLotId, serialId: null,
        },
        idempotencyKey,
        remark: `LOT RECLASS ${doc.doc_no}`,
      });
    }
  }
  db.prepare(`UPDATE inventory_lot_adjustments SET status='CONFIRMED', confirmed_by=?, confirmed_at=?, source_lot_id=?, target_lot_id=? WHERE id=?`).run(
    actor.id, now, sourceLotId, targetLotId, docId);
  audit(db, actor.id, 'CONFIRM', 'LOT_ADJUSTMENT', docId, `Confirm ${doc.doc_no}`);
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}