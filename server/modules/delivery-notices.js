import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { actorHas, assertGroupScope, lockSuffix, requireSalesPermission } from './sales-scope.js';

const NOW = () => new Date().toISOString();
const DAY = () => NOW().slice(0, 10);
const makeNo = () => `DN-${Date.now()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
const safe = (value, label, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw new HttpError(422, `${label}不正确`); return n; };

function requireView(actor) {
  if (!actorHas(actor, 'ORDERS_VIEW') && !actorHas(actor, 'SALES_DELIVERIES_VIEW')) throw new HttpError(403, '没有查看发货通知的权限');
}

function detail(db, noticeId) {
  const notice = db.prepare('SELECT * FROM delivery_notices WHERE id=?').get(noticeId); if (!notice) throw new HttpError(404, '发货通知不存在');
  const lines = db.prepare(`SELECT l.*,l.scheduled_qty_micros-l.notified_qty_micros-l.cancelled_notified_qty_micros remaining_notified_qty_micros,
    i.product_id,i.quantity order_quantity,i.planned_delivery_date FROM delivery_notice_lines l
    JOIN sales_order_items i ON i.id=l.sales_order_item_id WHERE l.delivery_notice_id=? ORDER BY l.line_no`).all(noticeId);
  return { ...notice, shipToSnapshot: JSON.parse(notice.ship_to_snapshot_json), customerSnapshot: JSON.parse(notice.customer_snapshot_json), lines };
}

function scopedOrder(db, orderId, actor, lock = false) {
  const order = db.prepare(`SELECT so.*,c.code customer_code,c.name customer_name,c.contact customer_contact,c.phone customer_phone,c.address customer_address
    FROM sales_orders so JOIN customers c ON c.id=so.customer_id WHERE so.id=?${lock ? lockSuffix(db) : ''}`).get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在'); if (order.status !== 'APPROVED' || order.commercial_close_state !== 'OPEN') throw new HttpError(409, '销售订单不可创建发货通知');
  assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date, documentType: 'DELIVERY_NOTICE', write: true }); return order;
}

function normalizedLines(db, orderId, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(422, '至少需要一条发货通知明细'); const seen = new Set();
  return lines.map((source, index) => {
    const itemId = String(source.salesOrderItemId || ''); if (!itemId || seen.has(itemId)) throw new HttpError(422, '订单明细身份缺失或重复'); seen.add(itemId);
    const item = db.prepare('SELECT * FROM sales_order_items WHERE id=? AND order_id=?').get(itemId, orderId); if (!item) throw new HttpError(422, '销售订单明细不存在');
    const quantity = safe(source.scheduledQtyMicros, '通知数量', 1); const base = Math.round(Number(item.quantity) * 1_000_000);
    const upper = Math.floor(base * (10000 + Number(item.upper_delivery_tolerance_bps || 0)) / 10000);
    if (quantity > upper) throw new HttpError(409, '通知数量超过订单行上限'); return { item, quantity, upper, lineNo: index + 1 };
  });
}

function validateCapacity(db, noticeId, lines) {
  for (const line of lines) {
    db.prepare(`SELECT id FROM sales_order_items WHERE id=?${lockSuffix(db)}`).get(line.item.id);
    const committed = Number(db.prepare(`SELECT COALESCE(SUM(l.scheduled_qty_micros),0) value FROM delivery_notice_lines l
      JOIN delivery_notices n ON n.id=l.delivery_notice_id WHERE l.sales_order_item_id=? AND l.delivery_notice_id<>?
        AND n.state IN ('CONFIRMED','CLOSED')`).get(line.item.id, noticeId).value);
    if (committed + line.quantity > line.upper) throw new HttpError(409, '累计发货通知数量超过订单行容差上限', { code: 'DELIVERY_NOTICE_CAPACITY_EXCEEDED' });
  }
}

export function listDeliveryNotices(db, res, actor, url) {
  requireView(actor); const state = String(url.searchParams.get('state') || '');
  const rows = db.prepare(`SELECT n.*,so.order_no,c.name customer_name FROM delivery_notices n JOIN sales_orders so ON so.id=n.sales_order_id
    JOIN customers c ON c.id=n.customer_id WHERE (?='' OR n.state=?) ORDER BY n.created_at DESC`).all(state, state)
    .filter((row) => { try { assertGroupScope(db, actor, { salesGroupId: db.prepare('SELECT sales_group_id FROM sales_orders WHERE id=?').get(row.sales_order_id)?.sales_group_id, businessDate: row.business_date, documentType: 'DELIVERY_NOTICE' }); return true; } catch (error) { if (error.status === 403) return false; throw error; } });
  return send(res, 200, { notices: rows });
}

export function getDeliveryNotice(db, res, actor, noticeId) {
  requireView(actor); const value = detail(db, noticeId); const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(value.sales_order_id);
  assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date, documentType: 'DELIVERY_NOTICE' });
  return send(res, 200, { notice: value });
}

export async function createDeliveryNotice(db, req, res, actor) {
  requireSalesPermission(actor, 'SALES_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const order = scopedOrder(db, body.salesOrderId, actor, true); const lines = normalizedLines(db, order.id, body.lines);
    const warehouse = db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(body.warehouseId); if (!warehouse) throw new HttpError(422, '仓库不存在或已停用');
    const noticeId = id(); const noticeNo = makeNo(); const stamp = NOW(); const businessDate = normalizeBusinessDate(body.businessDate || DAY(), '通知业务日期');
    const plannedDate = normalizeBusinessDate(body.plannedDeliveryDate || order.requested_delivery_date || businessDate, '计划交货日期');
    const ship = { name: order.ship_to_contact_name || order.customer_contact || '', phone: order.ship_to_phone || order.customer_phone || '', address: order.ship_to_address || order.customer_address || '' };
    const customer = { id: order.customer_id, code: order.customer_code, name: order.customer_name };
    db.prepare(`INSERT INTO delivery_notices(id,notice_no,sales_order_id,state,warehouse_id,ship_to_snapshot_json,planned_delivery_date,
      business_date,customer_id,customer_snapshot_json,creator_id,created_at,updated_at) VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?)`)
      .run(noticeId, noticeNo, order.id, warehouse.id, JSON.stringify(ship), plannedDate, businessDate, order.customer_id, JSON.stringify(customer), actor.id, stamp, stamp);
    const insert = db.prepare(`INSERT INTO delivery_notice_lines(id,delivery_notice_id,sales_order_item_id,scheduled_qty_micros,
      notified_qty_micros,cancelled_notified_qty_micros,line_no) VALUES(?,?,?,?,0,0,?)`);
    lines.forEach((line) => insert.run(id(), noticeId, line.item.id, line.quantity, line.lineNo)); audit(db, actor.id, 'CREATE', 'DELIVERY_NOTICE', noticeId, noticeNo);
    result = { notice: detail(db, noticeId) };
  }); return send(res, 201, result);
}

export async function updateDeliveryNotice(db, req, res, actor, noticeId) {
  requireSalesPermission(actor, 'SALES_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const notice = db.prepare(`SELECT * FROM delivery_notices WHERE id=?${lockSuffix(db)}`).get(noticeId); if (!notice) throw new HttpError(404, '发货通知不存在'); if (notice.state !== 'DRAFT') throw new HttpError(409, '只有草稿发货通知可以编辑');
    const order = scopedOrder(db, notice.sales_order_id, actor, true); const lines = normalizedLines(db, order.id, body.lines);
    db.prepare('DELETE FROM delivery_notice_lines WHERE delivery_notice_id=?').run(noticeId); const insert = db.prepare(`INSERT INTO delivery_notice_lines(id,delivery_notice_id,sales_order_item_id,scheduled_qty_micros,notified_qty_micros,cancelled_notified_qty_micros,line_no) VALUES(?,?,?,?,0,0,?)`);
    lines.forEach((line) => insert.run(id(), noticeId, line.item.id, line.quantity, line.lineNo)); db.prepare('UPDATE delivery_notices SET planned_delivery_date=?,updated_at=? WHERE id=?').run(normalizeBusinessDate(body.plannedDeliveryDate || notice.planned_delivery_date, '计划交货日期'), NOW(), noticeId);
    audit(db, actor.id, 'UPDATE', 'DELIVERY_NOTICE', noticeId, 'draft lines'); result = { notice: detail(db, noticeId) };
  }); return send(res, 200, result);
}

export async function deliveryNoticeAction(db, req, res, actor, noticeId, action) {
  requireSalesPermission(actor, 'SALES_MANAGE'); const body = await readJson(req); const key = String(req.headers['idempotency-key'] || '').trim();
  if (action === 'confirm' && !key) throw new HttpError(422, 'Idempotency-Key 必填'); const fingerprint = requestFingerprint(body);
  if (action === 'confirm') { const replay = idempotencyReplay(db, 'DELIVERY_NOTICE_CONFIRM', noticeId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true }); }
  let result; transaction(db, () => {
    const notice = db.prepare(`SELECT * FROM delivery_notices WHERE id=?${lockSuffix(db)}`).get(noticeId); if (!notice) throw new HttpError(404, '发货通知不存在'); scopedOrder(db, notice.sales_order_id, actor, true);
    if (action === 'confirm') {
      if (notice.state !== 'DRAFT') throw new HttpError(409, '只有草稿发货通知可以确认'); const raw = db.prepare('SELECT * FROM delivery_notice_lines WHERE delivery_notice_id=? ORDER BY sales_order_item_id').all(noticeId);
      const lines = raw.map((line) => { const item = db.prepare('SELECT * FROM sales_order_items WHERE id=?').get(line.sales_order_item_id); const base = Math.round(Number(item.quantity) * 1_000_000); return { item, quantity: Number(line.scheduled_qty_micros), upper: Math.floor(base * (10000 + Number(item.upper_delivery_tolerance_bps || 0)) / 10000) }; });
      validateCapacity(db, noticeId, lines); db.prepare("UPDATE delivery_notices SET state='CONFIRMED',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?").run(NOW(), actor.id, NOW(), noticeId);
      result = { id: noticeId, state: 'CONFIRMED' }; saveIdempotency(db, 'DELIVERY_NOTICE_CONFIRM', noticeId, key, fingerprint, result); audit(db, actor.id, 'CONFIRM', 'DELIVERY_NOTICE', noticeId, '');
    } else if (action === 'cancel') {
      if (!['DRAFT','CONFIRMED'].includes(notice.state)) throw new HttpError(409, '发货通知当前不可取消'); const consumed = db.prepare('SELECT 1 FROM delivery_notice_lines WHERE delivery_notice_id=? AND notified_qty_micros>cancelled_notified_qty_micros LIMIT 1').get(noticeId); if (consumed) throw new HttpError(409, '已被销售出库使用的发货通知不可取消'); const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(422, '取消原因必填');
      db.prepare("UPDATE delivery_notices SET state='CANCELLED',close_reason=?,cancelled_at=?,cancelled_by=?,updated_at=? WHERE id=?").run(reason, NOW(), actor.id, NOW(), noticeId); audit(db, actor.id, 'CANCEL', 'DELIVERY_NOTICE', noticeId, reason); result = { id: noticeId, state: 'CANCELLED' };
    } else throw new HttpError(400, '无效发货通知动作');
  }); return send(res, 200, result);
}
