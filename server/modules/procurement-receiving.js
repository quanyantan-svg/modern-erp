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

export function listReceiptNotices(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (supplierId) { where.push('supplier_id=?'); params.push(supplierId); }
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

export async function createReceiptNotice(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['purchaseOrderId', 'supplierId', 'warehouseId', 'noticeDate', 'remark', 'items', 'idempotencyKey']);
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.purchaseOrderId);
  if (!po) throw new HttpError(404, '采购订单不存在');
  if (po.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以创建收货通知');
  if (po.business_type && po.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '普通收货通知仅适用于 STANDARD_PURCHASE 订单');
  const noticeId = randomUUID(); const now = new Date().toISOString();
  const noticeNo = 'RN' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO receipt_notices(id,notice_no,purchase_order_id,business_type,supplier_id,warehouse_id,notice_date,status,handler_id,remark,idempotency_key,creator_id,created_at,updated_at)
      VALUES(?,?,?,'STANDARD_PURCHASE',?,?,?,?,?,?,?,?,?,?)`).run(noticeId, noticeNo, po.id, po.supplier_id, body.warehouseId, body.noticeDate || now.slice(0, 10), 'DRAFT', actor.id, body.remark || '', body.idempotencyKey || null, actor.id, now, now);
    const insertItem = db.prepare('INSERT INTO receipt_notice_items(id,notice_id,purchase_order_item_id,product_id,quantity,line_no) VALUES(?,?,?,?,?,?)');
    (body.items || []).forEach((item, index) => {
      insertItem.run(randomUUID(), noticeId, item.purchaseOrderItemId, item.productId, Number(item.quantity), index + 1);
    });
    audit(db, actor.id, 'CREATE', 'RECEIPT_NOTICE', noticeId, `创建收货通知 ${noticeNo}`);
  });
  return send(res, 201, { id: noticeId, noticeNo });
}

export async function confirmReceiptNotice(db, req, res, actor, noticeId) {
  assertManagePermission(actor);
  const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
  if (!notice) throw new HttpError(404, '收货通知不存在');
  if (notice.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  const now = new Date().toISOString();
  transaction(db, () => {
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
};
