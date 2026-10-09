import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';

const NOTICE_PERMISSIONS = ['RECEIPT_NOTICE_VIEW', 'RECEIPT_NOTICE_MANAGE'];
const PO_VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_MANAGE'];

function assertViewPermission(actor) { allowAny(actor, NOTICE_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'RECEIPT_NOTICE_MANAGE'); }
function assertPoViewPermission(actor) { allowAny(actor, PO_VIEW_PERMISSIONS); }

function rowToNotice(row) {
  if (!row) return null;
  return {
    id: row.id,
    noticeNo: row.notice_no,
    purchaseOrderId: row.purchase_order_id,
    outsourcingOrderId: row.outsourcing_order_id,
    processingPoId: row.processing_po_id,
    businessType: row.business_type,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    noticeDate: row.notice_date,
    status: row.status,
    handlerId: row.handler_id,
    remark: row.remark,
    creatorId: row.creator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Sum the qty of all notice items linked to an Outsourcing Order,
 * scoped by status. Used to enforce the canonical outsourcing-order
 * "open receiving qty" cap on Completion Receipt Notice creation. */
function sumOutsourcingNoticeQty(db, outsourcingOrderId, statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const row = db.prepare(`SELECT COALESCE(SUM(rni.quantity),0) q
    FROM receipt_notice_items rni
    JOIN receipt_notices rn ON rn.id=rni.notice_id
    WHERE rn.outsourcing_order_id=? AND rn.business_type='OUTSOURCE' AND rn.status IN (${placeholders})`).get(outsourcingOrderId, ...statuses);
  return Number(row?.q || 0);
}

/** Sum the qty of all CONFIRMED / EFFECTED receipts against an
 * Outsourcing Order — used together with notice totals to derive
 * "open receiving qty" against `order_quantity`. */
function sumOutsourcingConfirmedReceiptQty(db, outsourcingOrderId) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts
    WHERE order_id=? AND business_status<>'CANCELLED'`).get(outsourcingOrderId);
  return Number(row?.q || 0);
}

/** Cross-conversion guard. A STANDARD_PURCHASE notice may only seed a
 * Purchase Receipt; an OUTSOURCE notice may only seed an Outsourcing
 * Receipt. Both checks live here so the receipt confirm paths don't
 * have to re-derive notice intent. */
function assertNoticeCompatibleWithReceipt(notice, expectedBusinessType) {
  if (!notice) return;
  if (notice.business_type !== expectedBusinessType) {
    throw new HttpError(409, `通知单 business_type=${notice.business_type} 与收货路径不兼容（期望 ${expectedBusinessType}）`);
  }
}

export function listReceiptNotices(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const businessType = url.searchParams.get('businessType');
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (supplierId) { where.push('supplier_id=?'); params.push(supplierId); }
  if (businessType) { where.push('business_type=?'); params.push(businessType); }
  const rows = db.prepare(`SELECT * FROM receipt_notices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`).all(...params).map(rowToNotice);
  return send(res, 200, { receiptNotices: rows });
}

export function getReceiptNotice(db, res, actor, noticeId) {
  assertViewPermission(actor);
  const row = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
  if (!row) throw new HttpError(404, '收货通知不存在');
  const items = db.prepare('SELECT * FROM receipt_notice_items WHERE notice_id=? ORDER BY line_no').all(noticeId);
  return send(res, 200, { receiptNotice: { ...rowToNotice(row), items } });
}

/**
 * Create a Receipt Notice. The handler is shared across both discriminator
 * modes — the canonical shape of the request body switches on
 * `businessType`:
 *
 *   { businessType: 'STANDARD_PURCHASE', purchaseOrderId, ... }
 *   { businessType: 'OUTSOURCE',         outsourcingOrderId, processingPoId?, ... }
 *
 * Authoritative source resolution:
 *   - STANDARD_PURCHASE: `purchase_orders` (must be APPROVED + business_type=STANDARD_PURCHASE)
 *   - OUTSOURCE:         `outsourcing_orders` (must be RELEASED + non-CANCELLED)
 *
 * Quantity cap (OUTSOURCE only): the sum of ALL active+completed notice
 * line quantities against the outsourcing order must NOT exceed the
 * canonical "open receiving qty" of the order (order.order_quantity −
 * already confirmed receipt qty).
 */
export async function createReceiptNotice(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['businessType', 'purchaseOrderId', 'outsourcingOrderId', 'processingPoId', 'supplierId', 'warehouseId', 'noticeDate', 'remark', 'items', 'idempotencyKey']);
  const businessType = String(body.businessType || 'STANDARD_PURCHASE').toUpperCase();
  if (!['STANDARD_PURCHASE', 'OUTSOURCE'].includes(businessType)) {
    throw new HttpError(400, 'businessType 必须是 STANDARD_PURCHASE 或 OUTSOURCE');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, '通知单至少需要一行明细');
  }
  if (!body.warehouseId) {
    throw new HttpError(400, '必须提供 warehouseId');
  }

  let resolved = null; // { supplierId, purchaseOrderId, outsourcingOrderId, processingPoId, businessType }
  if (businessType === 'STANDARD_PURCHASE') {
    if (!body.purchaseOrderId) throw new HttpError(400, 'STANDARD_PURCHASE 通知单必须提供 purchaseOrderId');
    if (body.outsourcingOrderId) throw new HttpError(400, 'STANDARD_PURCHASE 通知单不允许设置 outsourcingOrderId');
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.purchaseOrderId);
    if (!po) throw new HttpError(404, '采购订单不存在');
    if (po.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以创建收货通知');
    if (po.business_type && po.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '普通收货通知仅适用于 STANDARD_PURCHASE 订单');
    resolved = { supplierId: body.supplierId || po.supplier_id, purchaseOrderId: po.id, outsourcingOrderId: null, processingPoId: null, businessType };
  } else {
    if (!body.outsourcingOrderId) throw new HttpError(400, 'OUTSOURCE 通知单必须提供 outsourcingOrderId');
    if (body.purchaseOrderId) throw new HttpError(400, 'OUTSOURCE 通知单不允许设置 purchaseOrderId');
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.outsourcingOrderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态委外订单可创建完工通知');
    let processingPo = null;
    if (body.processingPoId) {
      processingPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.processingPoId);
      if (!processingPo) throw new HttpError(404, '处理 PO 不存在');
      if (processingPo.business_type !== 'OUTSOURCE_PROCESSING' || processingPo.source_outsourcing_order_id !== order.id) {
        throw new HttpError(409, '处理 PO 与委外订单不兼容');
      }
    }
    if (body.supplierId && body.supplierId !== order.supplier_id) throw new HttpError(409, '委外订单与供应商不一致');
    resolved = { supplierId: order.supplier_id, purchaseOrderId: null, outsourcingOrderId: order.id, processingPoId: processingPo?.id || null, businessType };
  }

  const noticeId = randomUUID(); const now = new Date().toISOString();
  const noticeNo = 'RN' + (businessType === 'OUTSOURCE' ? 'OS-' : '') + Date.now().toString().slice(-10);
  // Quantity cap check FIRST (pre-insert). This avoids the in-transaction
  // double-counting trap: if we INSERT before checking, the new notice
  // contributes both to `activeNotified` (via sumOutsourcingNoticeQty)
  // and to `newNoticeQty`, effectively doubling the value.
  if (businessType === 'OUTSOURCE') {
    const order = db.prepare('SELECT order_quantity, status FROM outsourcing_orders WHERE id=?').get(resolved.outsourcingOrderId);
    const alreadyReceipted = sumOutsourcingConfirmedReceiptQty(db, resolved.outsourcingOrderId);
    const activeNotified = sumOutsourcingNoticeQty(db, resolved.outsourcingOrderId, ['DRAFT', 'CONFIRMED']);
    const newNoticeQty = body.items.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
    const open = Number(order.order_quantity) - alreadyReceipted;
    if (activeNotified + newNoticeQty > open + 1e-9) {
      throw new HttpError(409, `完工通知数量超过委外订单剩余可收量：订单可收 ${open}、已通知 ${activeNotified}、本次 ${newNoticeQty}`);
    }
  }
  transaction(db, () => {
    db.prepare(`INSERT INTO receipt_notices(id,notice_no,purchase_order_id,business_type,supplier_id,warehouse_id,notice_date,status,handler_id,remark,idempotency_key,creator_id,created_at,updated_at,outsourcing_order_id,processing_po_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      noticeId, noticeNo, resolved.purchaseOrderId, resolved.businessType, resolved.supplierId, body.warehouseId, body.noticeDate || now.slice(0, 10),
      'DRAFT', actor.id, body.remark || '', body.idempotencyKey || null, actor.id, now, now,
      resolved.outsourcingOrderId, resolved.processingPoId,
    );
    const insertItem = db.prepare('INSERT INTO receipt_notice_items(id,notice_id,purchase_order_item_id,product_id,quantity,line_no,outsourcing_order_id) VALUES(?,?,?,?,?,?,?)');
    body.items.forEach((item, index) => {
      insertItem.run(
        randomUUID(), noticeId,
        businessType === 'STANDARD_PURCHASE' ? (item.purchaseOrderItemId || null) : null,
        item.productId, Number(item.quantity), index + 1,
        businessType === 'OUTSOURCE' ? resolved.outsourcingOrderId : null,
      );
    });
    audit(db, actor.id, 'CREATE', 'RECEIPT_NOTICE', noticeId, `创建 ${businessType} 通知 ${noticeNo}`);
  });
  return send(res, 201, { id: noticeId, noticeNo, businessType: resolved.businessType });
}

export async function confirmReceiptNotice(db, req, res, actor, noticeId) {
  assertManagePermission(actor);
  const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
  if (!notice) throw new HttpError(404, '收货通知不存在');
  if (notice.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  const now = new Date().toISOString();
  transaction(db, () => {
    // Re-check the open-quantity cap at confirm time so a previously-
    // valid notice cannot become invalid just because another notice
    // advanced.
    if (notice.business_type === 'OUTSOURCE' && notice.outsourcing_order_id) {
      const order = db.prepare('SELECT order_quantity FROM outsourcing_orders WHERE id=?').get(notice.outsourcing_order_id);
      const alreadyReceipted = sumOutsourcingConfirmedReceiptQty(db, notice.outsourcing_order_id);
      const items = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM receipt_notice_items WHERE notice_id=?').get(noticeId);
      const thisQty = Number(items.q || 0);
      const others = sumOutsourcingNoticeQty(db, notice.outsourcing_order_id, ['CONFIRMED']) - thisQty;
      const open = Number(order.order_quantity) - alreadyReceipted;
      if (others + thisQty > open + 1e-9) {
        throw new HttpError(409, `完工通知确认时数量超过委外订单剩余可收量`);
      }
    }
    db.prepare('UPDATE receipt_notices SET status=?,updated_at=? WHERE id=?').run('CONFIRMED', now, noticeId);
    audit(db, actor.id, 'CONFIRM', 'RECEIPT_NOTICE', noticeId, notice.notice_no);
  });
  return send(res, 200, { ok: true });
}

export async function cancelReceiptNotice(db, res, actor, noticeId) {
  assertManagePermission(actor);
  const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
  if (!notice) throw new HttpError(404, '收货通知不存在');
  if (notice.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE receipt_notices SET status=?,updated_at=? WHERE id=?').run('CANCELLED', now, noticeId);
    audit(db, actor.id, 'CANCEL', 'RECEIPT_NOTICE', noticeId, notice.notice_no);
  });
  return send(res, 200, { ok: true });
}

export {
  assertPoViewPermission,
  assertNoticeCompatibleWithReceipt,
  sumOutsourcingNoticeQty,
  sumOutsourcingConfirmedReceiptQty,
};
