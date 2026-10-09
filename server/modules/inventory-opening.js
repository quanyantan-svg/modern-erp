// V21 — Inventory Initialization / Opening (Wave C).
//
// Frozen by `solution.md §27.24 / §27.25`.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey } from '../lib/inventory-position.js';

function nowIso() { return new Date().toISOString(); }

export function getOrCreateInitialization(db) {
  let row = db.prepare(`SELECT * FROM inventory_initialization LIMIT 1`).get();
  if (row) return row;
  const id = genId();
  db.prepare(`INSERT INTO inventory_initialization(id, status, notes) VALUES(?, 'NOT_STARTED', '')`).run(id);
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(id);
}

export function openInitialization(db, actor) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'NOT_STARTED') throw new HttpError(409, `Initialization 状态为 ${init.status}`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='OPEN', opened_by=?, opened_at=?, enabled_at=? WHERE id=?`).run(actor.id, now, now, init.id);
    db.prepare(`UPDATE inventory_parameters SET enabled_at=?, updated_by=?, updated_at=? WHERE id='DEFAULT'`).run(now, actor.id, now);
    audit(db, actor.id, 'OPEN', 'INVENTORY_INITIALIZATION', init.id, 'Open inventory initialization');
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export function closeInitialization(db, actor) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `Initialization 状态为 ${init.status}`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='CLOSED', closed_by=?, closed_at=? WHERE id=?`).run(actor.id, now, init.id);
    audit(db, actor.id, 'CLOSE', 'INVENTORY_INITIALIZATION', init.id, 'Close inventory initialization');
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export function reopenInitialization(db, actor, reason) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'CLOSED') throw new HttpError(409, `Initialization 状态为 ${init.status}`);
  if (!reason || String(reason).trim() === '') throw new HttpError(400, '重开原因必填');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='OPEN', closed_by=NULL, closed_at=NULL, reopen_count=reopen_count+1 WHERE id=?`).run(init.id);
    audit(db, actor.id, 'REOPEN', 'INVENTORY_INITIALIZATION', init.id, `Reopen: ${reason}`);
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export async function createOpeningDocument(db, req, res, actor) {
  allow(actor, 'INVENTORY_OPENING_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['businessDate','items','notes']);
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `Initialization 状态 ${init.status} 不可录入期初`);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请至少添加一行期初');
  const docId = genId();
  const docNo = `OPEN-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO opening_inventory_documents(id, doc_no, initialization_id, business_date, status, creator_id, created_at, notes)
      VALUES(?, ?, ?, ?, 'DRAFT', ?, ?, ?)
    `).run(docId, docNo, init.id, body.businessDate || now.slice(0, 10), actor.id, now, body.notes || '');
    let lineNo = 1;
    for (const item of body.items) {
      const productId = String(item.productId ?? '').trim();
      const warehouseId = String(item.warehouseId ?? '').trim();
      const quantity = Number(item.quantity);
      if (!productId || !warehouseId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, `第${lineNo}行产品 / 仓库 / 数量无效`);
      }
      const pk = computePositionKey({
        productId,
        warehouseId,
        binId: item.binId ?? null,
        ownerType: item.ownerType ?? 'ENTERPRISE',
        ownerId: item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null),
        stockStatus: item.stockStatus ?? 'AVAILABLE',
        lotId: item.lotId ?? null,
        serialId: item.serialId ?? null,
      });
      db.prepare(`
        INSERT INTO opening_inventory_items(id, document_id, product_id, warehouse_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, quantity, position_key, line_no)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(genId(), docId, productId, warehouseId, item.binId ?? null, item.ownerType ?? 'ENTERPRISE', item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null), item.stockStatus ?? 'AVAILABLE', item.lotId ?? null, item.serialId ?? null, quantity, pk, lineNo++);
    }
    audit(db, actor.id, 'CREATE', 'OPENING_INVENTORY', docId, `Create opening ${docNo}`);
  });
  return send(res, 201, { id: docId, docNo, status: 'DRAFT' });
}

export function confirmOpeningDocument(db, res, actor, docId) {
  allow(actor, 'INVENTORY_OPENING_MANAGE');
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `Initialization 状态 ${init.status} 不可确认期初`);
  const doc = db.prepare(`SELECT * FROM opening_inventory_documents WHERE id=?`).get(docId);
  if (!doc) throw new HttpError(404, '期初单据不存在');
  if (doc.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  const items = db.prepare(`SELECT * FROM opening_inventory_items WHERE document_id=?`).all(docId);
  const now = nowIso();
  transaction(db, () => {
    for (const item of items) {
      applyInventoryMutation({
        db,
        sourceType: 'OPENING_INVENTORY',
        sourceId: docId,
        sourceItemId: item.id,
        sourceNo: doc.doc_no,
        businessDate: doc.business_date,
        actor: { id: actor.id },
        movementKind: 'IN',
        quantity: Number(item.quantity),
        toPosition: {
          productId: item.product_id,
          warehouseId: item.warehouse_id,
          binId: item.bin_id,
          ownerType: item.owner_type,
          ownerId: item.owner_id,
          stockStatus: item.stock_status,
          lotId: item.lot_id,
          serialId: item.serial_id,
        },
        idempotencyKey: `OPENING:${item.id}`,
        remark: `Opening ${doc.doc_no}`,
      });
    }
    db.prepare(`UPDATE opening_inventory_documents SET status='CONFIRMED', confirmed_by=?, confirmed_at=? WHERE id=?`).run(actor.id, now, docId);
    audit(db, actor.id, 'CONFIRM', 'OPENING_INVENTORY', docId, `Confirm opening ${doc.doc_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}