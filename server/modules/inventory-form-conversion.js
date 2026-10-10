// V21 — Inventory Form / Attribute Conversion (Wave C closure).
//
// Frozen by `solution.md §27.20` (Domain 5 Closure Design).
// Same physical quantity, source position ↓ + target position ↑ with same
// movement_group. Owner / location preserved unless conversion explicitly
// requires it (canonical: not). No second stock balance.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_form_conversions (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      from_form TEXT NOT NULL,
      to_form TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      business_date TEXT NOT NULL,
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );
  `);
}

export async function createFormConversion(db, req, res, actor) {
  allow(actor, 'INVENTORY_FORM_CONVERSION_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['productId','warehouseId','quantity','fromForm','toForm','reason','businessDate']);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, 'quantity must be positive');
  const id = genId();
  const docNo = `FC-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`
      INSERT INTO inventory_form_conversions(id, doc_no, status, product_id, warehouse_id, quantity, from_form, to_form, reason, business_date, creator_id, created_at)
      VALUES(?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, docNo, body.productId, body.warehouseId, quantity, body.fromForm, body.toForm, body.reason || '', body.businessDate || now.slice(0, 10), actor.id, now);
    audit(db, actor.id, 'CREATE', 'INVENTORY_FORM_CONVERSION', id, `Create form conversion ${docNo}`);
  });
  return send(res, 201, { id, docNo, status: 'DRAFT' });
}

export function confirmFormConversion(db, res, actor, docId) {
  allow(actor, 'INVENTORY_FORM_CONVERSION_MANAGE');
  const doc = db.prepare(`SELECT * FROM inventory_form_conversions WHERE id=?`).get(docId);
  if (!doc) throw new HttpError(404, 'Form conversion not found');
  if (doc.status !== 'DRAFT') throw new HttpError(409, `Status ${doc.status} not confirmable`);
  const now = nowIso();
  const idempotencyKey = `FORM_CONV:${docId}`;
  // Same quantity, source position ↓ (fromForm) + target position ↑ (toForm).
  // Owner / location preserved.
  applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_FORM_CONVERSION',
      sourceId: docId,
      sourceItemId: `${docId}:main`,
      businessDate: doc.business_date,
      actor: { id: actor.id },
      movementKind: 'STATUS_CHANGE', // acknowledged as paired mutation (form conversion = available → inspection)
      quantity: Number(doc.quantity),
      fromPosition: {
        productId: doc.product_id, warehouseId: doc.warehouse_id,
        binId: null, ownerType: 'ENTERPRISE', ownerId: null,
        stockStatus: doc.from_form, lotId: null, serialId: null,
      },
      toPosition: {
        productId: doc.product_id, warehouseId: doc.warehouse_id,
        binId: null, ownerType: 'ENTERPRISE', ownerId: null,
        stockStatus: doc.to_form, lotId: null, serialId: null,
      },
      idempotencyKey,
      remark: `Form conversion ${doc.doc_no} ${doc.from_form} → ${doc.to_form}`,
    });
  db.prepare(`UPDATE inventory_form_conversions SET status='CONFIRMED', confirmed_by=?, confirmed_at=? WHERE id=?`).run(actor.id, now, docId);
  audit(db, actor.id, 'CONFIRM', 'INVENTORY_FORM_CONVERSION', docId, `Confirm form conversion ${doc.doc_no}`);
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}