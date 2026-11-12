// V21 — Direct Transfer (Wave B). Canonical owner for INV-15.
//
// Frozen by `solution.md §27.19`.
//
// One write entry for the transfer document: the physical movement is applied
// through `applyInventoryMutation` (INV-07 canonical mutation contract) at the
// canonical position identity, the LOT / SERIAL identities move with
// `transferTrackedInventory`, and the value moves with the authoritative
// carrying value of the issued leg.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowInventoryTransferConfirm, assertAllowedFields,
  normalizeBusinessDate, readJson, send,
} from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';
import { issueSourceValue, receiveValue } from './financial-inventory.js';
import { saveTrackedAllocations, sourceTrackingAllocations, transferTrackedInventory } from './traceability-quality.js';

function nowIso() { return new Date().toISOString(); }

const TRANSFER_STATUS = {
  DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核', TRANSFERRED: '已调拨', CANCELLED: '已取消',
};

function makeTransferNo() {
  const now = new Date();
  return `IT-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

// V1.4-E2 DTO compatibility mapping (solution.md §21.8.2): the stored column is
// still `reviewer_id`, the user-facing surface uses confirmed / cancelled
// semantics. Legacy technical statuses stay read-only so historical audit
// data is never silently rewritten.
function applyTransferCompatibility(transfer) {
  if (!transfer) return;
  const status = transfer.status;
  const hasExecutor = !!transfer.reviewer_id;
  if (status === 'TRANSFERRED') {
    transfer.confirmedBy = transfer.reviewer_id || null;
    transfer.confirmedByName = transfer.reviewerName || null;
    transfer.confirmedAt = transfer.updated_at || null;
    transfer.businessDateKnown = !!transfer.business_date;
    transfer.businessDateMissing = !transfer.business_date;
  } else if (status === 'CANCELLED') {
    transfer.cancelledBy = transfer.reviewer_id || null;
    transfer.cancelledByName = transfer.reviewerName || null;
    transfer.cancelledAt = transfer.updated_at || null;
  }
  transfer.executorId = hasExecutor ? transfer.reviewer_id : null;
  transfer.executorName = hasExecutor ? transfer.reviewerName : null;
  transfer.legacyTechnicalStatus = (status === 'SUBMITTED' || status === 'APPROVED');
}

function validateTransferItems(db, items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加明细');
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!item?.productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(item.productId)) {
      throw new HttpError(400, '请选择有效货品');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  }
}

export async function createInventoryTransfer(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CREATE');
  const body = await readJson(req);
  assertAllowedFields(body, ['fromWarehouseId', 'toWarehouseId', 'items', 'remark', 'businessDate']);
  const fromWarehouseId = String(body.fromWarehouseId ?? '').trim();
  const toWarehouseId = String(body.toWarehouseId ?? '').trim();
  if (!fromWarehouseId) throw new HttpError(400, '请选择源仓库');
  if (!toWarehouseId) throw new HttpError(400, '请选择目标仓库');
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, '源仓库和目标仓库不能相同');
  // V1.4-E2: every new transfer must declare an authoritative business date.
  // Empty / malformed values are rejected — never backfilled from created_at.
  const businessDate = normalizeBusinessDate(body.businessDate || body.business_date, '调拨业务日期');
  validateTransferItems(db, body.items);
  const transferId = genId();
  const now = nowIso();
  const transferNo = makeTransferNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO inventory_transfers(id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,business_date)
      VALUES(?,?,?,?,'DRAFT',?,?,?,?,?)`).run(
      transferId, transferNo, fromWarehouseId, toWarehouseId, String(body.remark ?? ''), actor.id, now, now, businessDate,
    );
    const stmt = db.prepare('INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity) VALUES(?,?,?,?)');
    for (const item of body.items) {
      const itemId = genId();
      stmt.run(itemId, transferId, item.productId, Number(item.quantity));
      saveTrackedAllocations(db, {
        sourceType: 'INVENTORY_TRANSFER', sourceId: transferId, sourceItemId: itemId,
        productId: item.productId, quantity: Number(item.quantity),
        allocations: item.trackingAllocations || item.tracking_allocations || [],
      });
    }
    audit(db, actor.id, 'CREATE', 'INVENTORY_TRANSFER', transferId, `创建调拨单 ${transferNo}`);
  });
  return send(res, 201, { id: transferId, transferNo, status: 'DRAFT', businessDate });
}

// The canonical confirm command. The physical movement runs through
// applyInventoryMutation so the negative-stock policy, the inventory lock and
// the period gates of INV-07 / INV-28 / INV-32 apply, and the mutation log
// carries the idempotency key of the transfer line.
//
// This is the shared E2 command used by the HTTP route and by the real
// multi-process MySQL concurrency gate.
export function confirmInventoryTransferCommand(db, actor, transferId, confirmedAt = nowIso()) {
  return transaction(db, () => {
    // Re-read after acquiring the shared SQLite/MySQL transaction gate.
    // Reading before the gate lets two MySQL processes retain the same stale
    // DRAFT snapshot and execute the physical movement twice.
    const transfer = db.prepare('SELECT * FROM inventory_transfers WHERE id=?').get(transferId);
    if (!transfer) throw new HttpError(404, '调拨单不存在');
    if (transfer.status !== 'DRAFT') {
      if (transfer.status === 'TRANSFERRED') {
        throw new HttpError(409, '调拨单已确认，请勿重复操作', {
          code: 'DUPLICATE_CONFIRMATION',
          resolution: '刷新调拨单并查看已完成的确认记录',
        });
      }
      throw new HttpError(409, '只有草稿状态的调拨单可以确认', { code: 'INVALID_DOCUMENT_STATE' });
    }
    // Confirm uses the stored authoritative date. Legacy NULL remains
    // unknown and is never replaced with created_at / updated_at.
    const businessDate = transfer.business_date;
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new HttpError(409, '调拨单缺少权威业务日期，无法确认', { code: 'SOURCE_LINEAGE_MISSING' });
    }
    const items = db.prepare('SELECT * FROM inventory_transfer_items WHERE transfer_id=? ORDER BY id').all(transferId);
    if (!items.length) throw new HttpError(409, '调拨单没有明细');

    for (const item of items) {
      const product = db.prepare('SELECT id, tracking_policy FROM products WHERE id=?').get(item.product_id);
      const trackingAllocations = transferTrackedInventory(db, {
        sourceId: transferId, sourceItemId: item.id, productId: item.product_id,
        fromWarehouseId: transfer.from_warehouse_id, toWarehouseId: transfer.to_warehouse_id,
        quantity: item.quantity, businessDate,
      });
      const legs = trackingAllocations.length
        ? trackingAllocations.map((allocation) => ({
          quantity: Number(allocation.quantity),
          lotId: allocation.lot_id || null,
          serialId: allocation.serial_id || null,
        }))
        : [{ quantity: Number(item.quantity), lotId: null, serialId: null }];

      let outTransactionId = null;
      for (const leg of legs) {
        const result = applyInventoryMutation({
          db,
          sourceType: 'INVENTORY_TRANSFER',
          sourceId: transferId,
          sourceItemId: item.id,
          sourceNo: transfer.transfer_no,
          businessDate,
          actor: { id: actor.id },
          movementKind: 'MOVE',
          quantity: leg.quantity,
          fromPosition: {
            productId: item.product_id, warehouseId: transfer.from_warehouse_id,
            binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
            lotId: leg.lotId, serialId: leg.serialId,
          },
          toPosition: {
            productId: item.product_id, warehouseId: transfer.to_warehouse_id,
            binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
            lotId: leg.lotId, serialId: leg.serialId,
          },
          idempotencyKey: `INVENTORY_TRANSFER:${transferId}:${item.id}:${leg.lotId || leg.serialId || 'PLAIN'}`,
          remark: `直接调拨 ${transfer.transfer_no}`,
          // The caller owns the strict valuation step below, in the same
          // transaction. The default best-effort issuance would post the
          // inbound leg as an issue.
          valuationMode: 'EXTERNAL',
          // transferTrackedInventory owns the LOT / SERIAL identity movement
          // for this line; the mutation must not post a second one.
          trackingMode: 'EXTERNAL',
        });
        const outMovement = result?.movements?.find((movement) => movement.direction === 'OUT');
        if (outMovement && !outTransactionId) outTransactionId = outMovement.transactionId;
      }

      // The value follows the issued leg: the inbound warehouse receives the
      // carrying value of what left the source warehouse.
      const issued = issueSourceValue(db, {
        businessDate,
        productId: item.product_id,
        warehouseId: transfer.from_warehouse_id,
        quantity: Number(item.quantity),
        movementType: 'TRANSFER_OUT',
        sourceType: 'INVENTORY_TRANSFER',
        sourceId: transferId,
        sourceItemId: item.id,
        inventoryTransactionId: outTransactionId,
      });
      issued.forEach((movement) => receiveValue(db, {
        businessDate,
        productId: item.product_id,
        warehouseId: transfer.to_warehouse_id,
        lotId: movement.lotId,
        serialId: movement.serialId,
        quantity: -movement.quantityDelta,
        valueCents: -movement.valueDeltaCents,
        movementType: 'TRANSFER_IN',
        sourceType: 'INVENTORY_TRANSFER',
        sourceId: transferId,
        sourceItemId: item.id,
        inventoryTransactionId: outTransactionId,
        valuationBasis: movement.valuationMethod === 'LEGACY_UNVALUED' ? 'LEGACY_UNVALUED' : 'TRANSFER_CARRYING_VALUE',
      }));
    }

    const updated = db.prepare("UPDATE inventory_transfers SET status='TRANSFERRED',reviewer_id=?,updated_at=? WHERE id=? AND status='DRAFT'")
      .run(actor.id, confirmedAt, transferId);
    if (updated.changes !== 1) throw new HttpError(409, '调拨单状态已变化，请刷新后重试');
    audit(db, actor.id, 'TRANSFER', 'INVENTORY_TRANSFER', transferId, `确认调拨 ${transfer.transfer_no} 业务日期 ${businessDate}`);
    // 同一公司内仓库调拨仅改变估值维度，不形成损益或公司总存货 GL。
    return { id: transferId, status: 'TRANSFERRED', businessDate };
  });
}

export function confirmInventoryTransfer(db, res, actor, transferId) {
  allowInventoryTransferConfirm(actor);
  const result = confirmInventoryTransferCommand(db, actor, transferId);
  return send(res, 200, { ok: true, status: result.status });
}

export function cancelInventoryTransfer(db, res, actor, transferId) {
  // Cancellation terminates an unexecuted draft and belongs to the CREATE
  // capability, not the physical CONFIRM capability.
  allow(actor, 'INVENTORY_TRANSFER_CREATE');
  const now = nowIso();
  transaction(db, () => {
    const transfer = db.prepare('SELECT * FROM inventory_transfers WHERE id=?').get(transferId);
    if (!transfer) throw new HttpError(404, '调拨单不存在');
    if (transfer.status !== 'DRAFT') throw new HttpError(409, `状态 ${transfer.status} 不可取消`, { code: 'INVALID_DOCUMENT_STATE' });
    db.prepare("UPDATE inventory_transfers SET status='CANCELLED',reviewer_id=?,updated_at=? WHERE id=? AND status='DRAFT'")
      .run(actor.id, now, transferId);
    audit(db, actor.id, 'CANCEL', 'INVENTORY_TRANSFER', transferId, `取消调拨 ${transfer.transfer_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

export function listInventoryTransfers(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const where = [];
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('INVENTORY_TRANSFER', {
    includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'it.id',
  });
  if (archiveFilter.clause) where.push(archiveFilter.clause);
  const status = url.searchParams.get('status');
  if (status && TRANSFER_STATUS[status]) { where.push('it.status=?'); params.push(status); }
  const sql = `SELECT it.*,fw.code fromWarehouseCode,fw.name fromWarehouseName,tw.code toWarehouseCode,tw.name toWarehouseName,
    creator.display_name creatorName,reviewer.display_name reviewerName,
    (SELECT count(*) FROM inventory_transfer_items WHERE transfer_id=it.id) itemCount
    FROM inventory_transfers it
    JOIN warehouses fw ON fw.id=it.from_warehouse_id JOIN warehouses tw ON tw.id=it.to_warehouse_id
    JOIN users creator ON creator.id=it.creator_id LEFT JOIN users reviewer ON reviewer.id=it.reviewer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY it.created_at DESC`;
  const transfers = db.prepare(sql).all(...params).map((row) => {
    applyTransferCompatibility(row);
    return { ...row, statusLabel: TRANSFER_STATUS[row.status] };
  });
  return send(res, 200, { inventoryTransfers: transfers });
}

export function getInventoryTransfer(db, res, actor, transferId) {
  allow(actor, 'INVENTORY_VIEW');
  const transfer = db.prepare(`SELECT it.*,fw.code fromWarehouseCode,fw.name fromWarehouseName,tw.code toWarehouseCode,tw.name toWarehouseName,
    creator.display_name creatorName,reviewer.display_name reviewerName
    FROM inventory_transfers it
    JOIN warehouses fw ON fw.id=it.from_warehouse_id JOIN warehouses tw ON tw.id=it.to_warehouse_id
    JOIN users creator ON creator.id=it.creator_id LEFT JOIN users reviewer ON reviewer.id=it.reviewer_id
    WHERE it.id=?`).get(transferId);
  if (!transfer) throw new HttpError(404, '调拨单不存在');
  transfer.items = db.prepare(`SELECT ti.*,p.code productCode,p.name productName,p.unit
    FROM inventory_transfer_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transfer_id=?`).all(transferId)
    .map((item) => ({ ...item, trackingAllocations: sourceTrackingAllocations(db, 'INVENTORY_TRANSFER', transferId, item.id) }));
  transfer.statusLabel = TRANSFER_STATUS[transfer.status];
  applyTransferCompatibility(transfer);
  return send(res, 200, { transfer });
}
