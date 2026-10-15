import { HttpError } from '../lib/http.js';
import { lockSuffix } from './sales-scope.js';

export function validateSalesDeliverySource(db, body, salesOrderId) {
  const sourceMode = String(body.sourceMode || '').toUpperCase();
  if (!['DIRECT_ORDER', 'DELIVERY_NOTICE'].includes(sourceMode)) throw new HttpError(422, '新销售出库必须明确选择 DIRECT_ORDER 或 DELIVERY_NOTICE');
  const deliveryNoticeId = body.deliveryNoticeId || null;
  if (sourceMode === 'DIRECT_ORDER' && deliveryNoticeId) throw new HttpError(422, '直接订单出库不得引用发货通知');
  let notice = null;
  if (sourceMode === 'DELIVERY_NOTICE') {
    if (!deliveryNoticeId) throw new HttpError(422, '发货通知出库必须选择发货通知');
    notice = db.prepare('SELECT * FROM delivery_notices WHERE id=?').get(deliveryNoticeId);
    if (!notice || !['CONFIRMED','CLOSED'].includes(notice.state) || notice.sales_order_id !== salesOrderId) throw new HttpError(409, '发货通知不存在、未确认或不属于该销售订单');
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (sourceMode === 'DELIVERY_NOTICE') {
    for (const [index, item] of rawItems.entries()) {
      const lineId = item.deliveryNoticeLineId || item.delivery_notice_line_id;
      const orderItemId = item.salesOrderItemId || item.sales_order_item_id;
      const line = lineId && db.prepare('SELECT * FROM delivery_notice_lines WHERE id=? AND delivery_notice_id=?').get(lineId, deliveryNoticeId);
      if (!line || line.sales_order_item_id !== orderItemId) throw new HttpError(422, `第 ${index + 1} 行发货通知来源不一致`);
    }
  } else if (rawItems.some((item) => item.deliveryNoticeLineId || item.delivery_notice_line_id)) throw new HttpError(422, '直接订单出库行不得引用发货通知行');
  return { sourceMode, deliveryNoticeId, notice };
}

export function persistSalesDeliveryNoticeLineIds(db, deliveryId, rawItems, sourceMode) {
  const rows = db.prepare('SELECT id FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no,id').all(deliveryId);
  rows.forEach((row, index) => db.prepare('UPDATE sales_delivery_items SET delivery_notice_line_id=? WHERE id=?')
    .run(sourceMode === 'DELIVERY_NOTICE' ? rawItems[index].deliveryNoticeLineId || rawItems[index].delivery_notice_line_id : null, row.id));
}

function confirmedOrderQuantity(db, orderItemId, excludeDeliveryId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(i.quantity),0) value FROM sales_delivery_items i JOIN sales_deliveries d ON d.id=i.delivery_id
    WHERE i.sales_order_item_id=? AND d.status='CONFIRMED' AND d.id<>?`).get(orderItemId, excludeDeliveryId).value);
}

export function lockAndConsumeSalesDeliveryCapacity(db, deliveryId) {
  const delivery = db.prepare(`SELECT * FROM sales_deliveries WHERE id=?${lockSuffix(db)}`).get(deliveryId);
  if (!delivery || !['DIRECT_ORDER','DELIVERY_NOTICE'].includes(delivery.source_mode)) throw new HttpError(409, '销售出库缺少合规来源模式');
  const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lockSuffix(db)}`).get(delivery.sales_order_id);
  if (!order || order.status !== 'APPROVED' || order.commercial_close_state !== 'OPEN') throw new HttpError(409, '销售订单不是可交付的已审批开放版本');
  const items = db.prepare('SELECT * FROM sales_delivery_items WHERE delivery_id=? ORDER BY sales_order_item_id').all(deliveryId);
  for (const item of items) {
    const source = db.prepare(`SELECT * FROM sales_order_items WHERE id=? AND order_id=?${lockSuffix(db)}`).get(item.sales_order_item_id, order.id);
    if (!source) throw new HttpError(409, '销售出库订单行来源不存在');
    const upper = Number(source.quantity) * (10000 + Number(source.upper_delivery_tolerance_bps || 0)) / 10000;
    if (confirmedOrderQuantity(db, source.id, deliveryId) + Number(item.quantity) > upper) throw new HttpError(409, '累计销售出库数量超过订单行容差上限', { code: 'SALES_DELIVERY_CAPACITY_EXCEEDED' });
    if (delivery.source_mode === 'DELIVERY_NOTICE') {
      const notice = db.prepare(`SELECT * FROM delivery_notices WHERE id=?${lockSuffix(db)}`).get(delivery.delivery_notice_id);
      const line = db.prepare(`SELECT * FROM delivery_notice_lines WHERE id=? AND delivery_notice_id=?${lockSuffix(db)}`).get(item.delivery_notice_line_id, delivery.delivery_notice_id);
      if (!notice || !['CONFIRMED','CLOSED'].includes(notice.state) || notice.sales_order_id !== order.id || !line || line.sales_order_item_id !== source.id) throw new HttpError(409, '销售出库与发货通知来源链不一致');
      const remaining = Number(line.scheduled_qty_micros) - Number(line.notified_qty_micros) - Number(line.cancelled_notified_qty_micros);
      const quantityMicros = Math.round(Number(item.quantity) * 1_000_000);
      if (quantityMicros > remaining) throw new HttpError(409, '销售出库数量超过发货通知剩余容量', { code: 'DELIVERY_NOTICE_REMAINING_EXCEEDED' });
      db.prepare('UPDATE delivery_notice_lines SET notified_qty_micros=notified_qty_micros+? WHERE id=?').run(quantityMicros, line.id);
    }
  }
  if (delivery.source_mode === 'DELIVERY_NOTICE') {
    const remaining = Number(db.prepare(`SELECT COALESCE(SUM(scheduled_qty_micros-notified_qty_micros-cancelled_notified_qty_micros),0) value
      FROM delivery_notice_lines WHERE delivery_notice_id=?`).get(delivery.delivery_notice_id).value);
    if (remaining === 0) db.prepare("UPDATE delivery_notices SET state='CLOSED',updated_at=? WHERE id=? AND state='CONFIRMED'").run(new Date().toISOString(), delivery.delivery_notice_id);
  }
  return { delivery, order };
}
