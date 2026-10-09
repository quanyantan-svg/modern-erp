// V21 — Inventory Stocktake (Wave C).
//
// Frozen by `solution.md §27.29 / §27.30`.

import { id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey } from '../lib/inventory-position.js';

function nowIso() { return new Date().toISOString(); }

export async function createStocktake(db, req, res, actor) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  const body = await readJson(req);
  assertAllowedFields(body, ['warehouseId','checkKind','scopeStrategy','items','abcClassification','cyclePeriodKey']);
  const checkKind = String(body.checkKind ?? 'REGULAR').toUpperCase();
  if (!['REGULAR','CYCLE'].includes(checkKind)) throw new HttpError(400, 'checkKind 必须为 REGULAR 或 CYCLE');
  const warehouseId = String(body.warehouseId ?? '').trim();
  if (!warehouseId) throw new HttpError(400, '仓库必填');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请至少添加一行盘点');
  const checkId = genId();
  const checkNo = `STK-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_checks(id, check_no, warehouse_id, status, checked_at, creator_id, created_at, check_kind, scope_strategy, abc_classification, cycle_period_key, snapshot_at)
      VALUES(?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(checkId, checkNo, warehouseId, now, actor.id, now, checkKind, body.scopeStrategy || 'ALL', body.abcClassification || null, body.cyclePeriodKey || null, now);
    for (const item of body.items) {
      const productId = String(item.productId ?? '').trim();
      const physicalQuantity = Number(item.physicalQuantity);
      if (!productId || !Number.isFinite(physicalQuantity) || physicalQuantity < 0) {
        throw new HttpError(400, '每行产品 / 实盘数量必填');
      }
      const pk = computePositionKey({
        productId, warehouseId,
        binId: item.binId ?? null,
        ownerType: item.ownerType ?? 'ENTERPRISE',
        ownerId: item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null),
        stockStatus: item.stockStatus ?? 'AVAILABLE',
        lotId: item.lotId ?? null,
        serialId: item.serialId ?? null,
      });
      const bookRow = db.prepare(`SELECT quantity FROM inventory WHERE position_key=? AND active=1`).get(pk);
      const snapshotBookQuantity = bookRow ? Number(bookRow.quantity) : 0;
      const diffQuantity = physicalQuantity - snapshotBookQuantity;
      db.prepare(`
        INSERT INTO inventory_check_items(id, check_id, product_id, position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id,
          book_quantity, check_quantity, diff_quantity, snapshot_book_quantity, remark)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(genId(), checkId, productId, pk, item.binId ?? null, item.ownerType ?? 'ENTERPRISE', item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null), item.stockStatus ?? 'AVAILABLE', item.lotId ?? null, item.serialId ?? null,
            snapshotBookQuantity, physicalQuantity, diffQuantity, snapshotBookQuantity, item.remark || '');
    }
    audit(db, actor.id, 'CREATE', 'INVENTORY_CHECK', checkId, `Create stocktake ${checkNo} (${checkKind})`);
  });
  return send(res, 201, { id: checkId, checkNo, checkKind, status: 'SUBMITTED' });
}

export function approveStocktake(db, res, actor, checkId) {
  allow(actor, 'INVENTORY_CHECK_APPROVE');
  const check = db.prepare(`SELECT * FROM inventory_checks WHERE id=?`).get(checkId);
  if (!check) throw new HttpError(404, '盘点单不存在');
  if (check.status !== 'SUBMITTED') throw new HttpError(409, `状态 ${check.status} 不可审批`);
  const items = db.prepare(`SELECT * FROM inventory_check_items WHERE check_id=?`).all(checkId);
  const now = nowIso();
  // Each applyInventoryMutation opens its own transaction; do NOT wrap in
  // an outer transaction (SQLite forbids nested transactions on the same handle).
  for (const item of items) {
    const diff = Number(item.diff_quantity);
    if (Math.abs(diff) < 1e-9) continue; // no adjustment needed
    applyInventoryMutation({
      db,
      sourceType: 'INVENTORY_STOCKTAKE_DIFF',
      sourceId: checkId,
      sourceItemId: item.id,
      sourceNo: check.check_no,
      businessDate: check.checked_at || now.slice(0, 10),
      actor,
      movementKind: 'ADJUSTMENT',
      quantity: Math.abs(diff),
      ...(diff > 0 ? {
        toPosition: {
          productId: item.product_id, warehouseId: check.warehouse_id,
          binId: item.bin_id, ownerType: item.owner_type, ownerId: item.owner_id,
          stockStatus: item.stock_status, lotId: item.lot_id, serialId: item.serial_id,
        },
      } : {
        fromPosition: {
          productId: item.product_id, warehouseId: check.warehouse_id,
          binId: item.bin_id, ownerType: item.owner_type, ownerId: item.owner_id,
          stockStatus: item.stock_status, lotId: item.lot_id, serialId: item.serial_id,
        },
      }),
      idempotencyKey: `STKTAKE_DIFF:${item.id}`,
      remark: `Stocktake diff ${check.check_no}`,
    });
  }
  db.prepare(`UPDATE inventory_checks SET status='APPROVED' WHERE id=?`).run(checkId);
  audit(db, actor.id, 'APPROVE', 'INVENTORY_CHECK', checkId, `Approve stocktake ${check.check_no}`);
  return send(res, 200, { ok: true, status: 'APPROVED' });
}