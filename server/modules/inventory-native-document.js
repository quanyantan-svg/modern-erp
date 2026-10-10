// V21 — Inventory Other Receipt / Other Issue (Wave C).
//
// Frozen by `solution.md §27.25 / §27.28`.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { transitionSerialForInventoryMovement } from './traceability-quality.js';

function nowIso() { return new Date().toISOString(); }

export async function createNativeDocument(db, req, res, actor) {
  allow(actor, 'INVENTORY_NATIVE_DOCUMENT_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['docKind','businessDate','items','reason','notes']);
  const docKind = String(body.docKind ?? '').trim().toUpperCase();
  if (!['OTHER_RECEIPT','OTHER_ISSUE'].includes(docKind)) {
    throw new HttpError(400, 'docKind 必须为 OTHER_RECEIPT 或 OTHER_ISSUE');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请至少添加一行明细');
  const docId = genId();
  const prefix = docKind === 'OTHER_RECEIPT' ? 'OR' : 'OI';
  const docNo = `${prefix}-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_native_documents(id, doc_no, doc_kind, business_date, status, reason, creator_id, created_at, notes)
      VALUES(?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    `).run(docId, docNo, docKind, body.businessDate || now.slice(0, 10), body.reason || '', actor.id, now, body.notes || '');
    let lineNo = 1;
    for (const item of body.items) {
      const productId = String(item.productId ?? '').trim();
      const warehouseId = String(item.warehouseId ?? '').trim();
      const quantity = Number(item.quantity);
      if (!productId || !warehouseId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, `第${lineNo}行产品 / 仓库 / 数量无效`);
      }
      db.prepare(`
        INSERT INTO inventory_native_items(id, document_id, product_id, warehouse_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, quantity, line_no)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(genId(), docId, productId, warehouseId, item.binId ?? null, item.ownerType ?? 'ENTERPRISE', item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null), item.stockStatus ?? 'AVAILABLE', item.lotId ?? null, item.serialId ?? null, quantity, lineNo++);
    }
    audit(db, actor.id, 'CREATE', 'INVENTORY_NATIVE_DOCUMENT', docId, `Create ${docKind} ${docNo}`);
  });
  return send(res, 201, { id: docId, docNo, docKind, status: 'DRAFT' });
}

export function confirmNativeDocument(db, res, actor, docId) {
  allow(actor, 'INVENTORY_NATIVE_DOCUMENT_MANAGE');
  const doc = db.prepare(`SELECT * FROM inventory_native_documents WHERE id=?`).get(docId);
  if (!doc) throw new HttpError(404, '库存原生单据不存在');
  if (doc.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  const items = db.prepare(`SELECT * FROM inventory_native_items WHERE document_id=? ORDER BY line_no`).all(docId);
  const now = nowIso();
  transaction(db, () => {
    for (const item of items) {
      const sourceType = doc.doc_kind; // 'OTHER_RECEIPT' or 'OTHER_ISSUE'
      const movementKind = sourceType === 'OTHER_RECEIPT' ? 'IN' : 'OUT';
      applyInventoryMutation({
        db,
        sourceType,
        sourceId: docId,
        sourceItemId: item.id,
        sourceNo: doc.doc_no,
        businessDate: doc.business_date,
        actor: { id: actor.id },
        movementKind,
        quantity: Number(item.quantity),
        [movementKind === 'IN' ? 'toPosition' : 'fromPosition']: {
          productId: item.product_id,
          warehouseId: item.warehouse_id,
          binId: item.bin_id,
          ownerType: item.owner_type,
          ownerId: item.owner_id,
          stockStatus: item.stock_status,
          lotId: item.lot_id,
          serialId: item.serial_id,
        },
        idempotencyKey: `${sourceType}:${item.id}`,
        remark: `${sourceType} ${doc.doc_no}`,
      });
      transitionSerialForInventoryMovement(db, {
        serialId: item.serial_id,
        productId: item.product_id,
        warehouseId: item.warehouse_id,
        direction: movementKind,
        sourceType,
      });
    }
    db.prepare(`UPDATE inventory_native_documents SET status='CONFIRMED', confirmed_by=?, confirmed_at=? WHERE id=?`).run(actor.id, now, docId);
    audit(db, actor.id, 'CONFIRM', 'INVENTORY_NATIVE_DOCUMENT', docId, `Confirm ${doc.doc_kind} ${doc.doc_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}
