// M1C-WP-1 — the one and only owner of the receipt notice -> purchase receipt
// conversion.
//
// Contract source: M1-Core Active Design §5.1 / §5.2 / §6 / §7 / §9 and the
// approved Requirement MC-REQ-02 / MC-REQ-09 (docs/requirements/
// procurement-outsourcing.md §31.13).
//
// Invariants of this module:
//   - it NEVER creates a notice source row. Source rows are written by
//     server/modules/procurement-receiving.js::createReceiptNotice() only;
//   - it NEVER resets a non-zero converted quantity. The converted quantity
//     is a monotone, historical cumulative fact;
//   - it reuses the canonical purchase receipt engine
//     (server/modules/purchase-receipt-engine.js) instead of writing a second
//     receipt SQL writer;
//   - the receipt creation and the accumulated converted quantity live in the
//     SAME authoritative transaction, so a replay can never produce a receipt
//     without the matching source accounting (or the other way round).

import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { createPurchaseReceiptCore } from './purchase-receipt-engine.js';
import {
  NOTICE_ERROR_CODES, auditBusinessRejection, noticeBusinessError,
  resolveDeliveryScheduleCapacity, resolveNoticeItemCapacity, resolvePurchaseOrderLineCapacity,
} from './procurement-notice-capacity.js';

const CONVERT_OPERATION = 'RECEIPT_NOTICE_CONVERT';
const EPSILON = 1e-9;

function loadNotice(db, noticeId) {
  const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
  if (!notice) throw new HttpError(404, '收货通知不存在');
  return notice;
}

function loadNoticeSources(db, noticeId) {
  return db.prepare(`SELECT s.* FROM receipt_notice_item_sources s
    JOIN receipt_notice_items i ON i.id = s.notice_item_id
    WHERE i.notice_id=? ORDER BY s.id`).all(noticeId);
}

/**
 * Normalize the requested conversion lines.
 *
 * A line is addressed either by its notice source row id, or by the notice
 * line plus the purchase order line it allocates. Both forms are unambiguous:
 * (notice item, purchase order line) is unique inside a notice.
 */
function normalizeConversionRequests(items, sources) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, '请至少指定一行转换明细');
  }
  const bySourceId = new Map(sources.map((source) => [source.id, source]));
  const byNoticeItem = new Map(sources.map((source) => [`${source.notice_item_id}:${source.purchase_order_item_id}`, source]));
  const seen = new Set();
  return items.map((item, index) => {
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new HttpError(400, `第 ${index + 1} 行转换数量必须为正整数`);
    }
    let source = null;
    if (item?.sourceId) {
      source = bySourceId.get(item.sourceId) || null;
    } else if (item?.noticeItemId && item?.purchaseOrderItemId) {
      source = byNoticeItem.get(`${item.noticeItemId}:${item.purchaseOrderItemId}`) || null;
    } else {
      throw new HttpError(400, `第 ${index + 1} 行必须指定 sourceId 或 noticeItemId 与 purchaseOrderItemId`);
    }
    if (!source) throw new HttpError(400, `第 ${index + 1} 行指定的来源不属于该收料通知`);
    if (seen.has(source.id)) throw new HttpError(400, `第 ${index + 1} 行来源重复`);
    seen.add(source.id);
    return { source, quantity };
  });
}

/**
 * Convert the requested notice source rows into purchase receipts.
 *
 * A purchase receipt carries exactly one purchase order, so a notice that
 * spans several purchase orders is converted into one receipt per order. The
 * line level provenance (notice source row + delivery schedule) stays
 * traceable on every receipt line.
 */
export function convertReceiptNotice(db, actor, {
  noticeId, items, receiptDate, remark, billingMode, idempotencyKey, fingerprint,
}) {
  const notice = loadNotice(db, noticeId);
  if (notice.business_type !== 'STANDARD_PURCHASE') {
    throw new HttpError(409, '只有标准采购收料通知支持转换为采购入库单');
  }
  if (notice.status !== 'CONFIRMED') {
    throw new HttpError(409, '只有已确认的收料通知可以转换为采购入库单');
  }
  const sources = loadNoticeSources(db, noticeId);
  if (!sources.length) {
    throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '收料通知没有可证明的来源行，历史通知不可转换');
  }
  const requests = normalizeConversionRequests(items, sources);

  // ---- source row bound: the converted quantity must be provable ----------
  for (const request of requests) {
    const converted = request.source.converted_quantity;
    if (converted === null || converted === undefined) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '来源行的历史转换量不可证明，不能提供转换容量');
    }
    const remaining = Number(request.source.allocated_quantity) - Number(converted);
    if (remaining <= EPSILON) {
      // The converted quantity is a monotone historical fact: a converted
      // source row never regains capacity, not even after the receipt it
      // created was cancelled (T-11).
      throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '来源行转换容量已用尽，转换后取消不恢复来源容量');
    }
    if (request.quantity > remaining + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '转换数量超过来源行剩余可转换容量');
    }
  }

  // ---- notice line bound --------------------------------------------------
  const perNoticeItem = new Map();
  for (const request of requests) {
    const key = request.source.notice_item_id;
    perNoticeItem.set(key, (perNoticeItem.get(key) || 0) + request.quantity);
  }
  for (const [noticeItemId, quantity] of perNoticeItem) {
    const capacity = resolveNoticeItemCapacity(db, noticeItemId);
    if (!capacity || !capacity.provable) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '通知行的历史转换量不可证明，不能提供转换容量');
    }
    if (quantity > capacity.remainingQuantity + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '转换数量超过通知行可转换剩余容量');
    }
  }

  // ---- purchase order line bound -----------------------------------------
  const perOrderLine = new Map();
  for (const request of requests) {
    const key = request.source.purchase_order_item_id;
    perOrderLine.set(key, (perOrderLine.get(key) || 0) + request.quantity);
  }
  for (const [orderItemId, quantity] of perOrderLine) {
    const capacity = resolvePurchaseOrderLineCapacity(db, orderItemId);
    if (!capacity) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '来源采购订单行不存在，无法证明容量');
    }
    // The requested quantity is already reserved by the notice allocation, so
    // the order line usage does not grow: the check re-verifies that the
    // reservation itself is still within the ordered quantity.
    if (capacity.usedQuantity > capacity.orderedQuantity + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '转换数量超过采购订单剩余可收数量');
    }
  }

  // ---- delivery schedule bound -------------------------------------------
  const perSchedule = new Map();
  for (const request of requests) {
    const scheduleId = request.source.delivery_schedule_id;
    if (!scheduleId) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '来源行没有可证明的交期，无法证明交期容量');
    }
    perSchedule.set(scheduleId, (perSchedule.get(scheduleId) || 0) + request.quantity);
  }
  for (const [scheduleId, quantity] of perSchedule) {
    const capacity = resolveDeliveryScheduleCapacity(db, scheduleId);
    if (!capacity) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '交期不存在，无法证明交期容量');
    }
    if (capacity.usedQuantity > capacity.capacityQuantity + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '转换数量超过交期与容差剩余容量');
    }
  }

  // ---- group the requested lines by their purchase order ------------------
  const groups = new Map();
  for (const request of requests) {
    const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(request.source.purchase_order_item_id);
    if (!orderItem) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '来源采购订单行不存在，无法证明容量');
    }
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderItem.order_id);
    if (!order) throw new HttpError(409, '来源采购订单不存在');
    if (order.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以收货');
    if (order.business_type && order.business_type !== 'STANDARD_PURCHASE') {
      throw new HttpError(409, '收料通知来源必须是标准采购订单');
    }
    if (order.supplier_id !== notice.supplier_id) {
      throw new HttpError(409, '收料通知供应商与来源采购订单不一致');
    }
    if (!groups.has(order.id)) groups.set(order.id, { order, requests: [] });
    groups.get(order.id).requests.push({ request, orderItem });
  }

  const now = new Date().toISOString();
  const receipts = [];
  for (const group of groups.values()) {
    const receiptItems = group.requests.map(({ request, orderItem }) => ({
      purchaseOrderItemId: orderItem.id,
      productId: orderItem.product_id,
      quantity: request.quantity,
      deliveryScheduleId: request.source.delivery_schedule_id,
      sourceNoticeItemSourceId: request.source.id,
    }));
    const created = createPurchaseReceiptCore(db, actor, {
      purchaseOrderId: group.order.id,
      supplierId: notice.supplier_id,
      warehouseId: notice.warehouse_id,
      remark: remark || `由收料通知 ${notice.notice_no} 转换`,
      items: receiptItems,
      receiptDate,
      billingMode,
      sourceNoticeId: notice.id,
      allowDuplicateSourceItems: true,
    });
    // The converted quantity is a cumulative historical fact: it only grows.
    for (const { request } of group.requests) {
      const next = Number(request.source.converted_quantity) + request.quantity;
      db.prepare('UPDATE receipt_notice_item_sources SET converted_quantity=?, updated_at=? WHERE id=?').run(next, now, request.source.id);
    }
    receipts.push({
      id: created.receiptId,
      receiptNo: created.receiptNo,
      purchaseOrderId: group.order.id,
      totalCents: created.totalCents,
      items: group.requests.map(({ request }) => ({
        sourceId: request.source.id,
        purchaseOrderItemId: request.source.purchase_order_item_id,
        deliveryScheduleId: request.source.delivery_schedule_id,
        quantity: request.quantity,
      })),
    });
  }

  audit(db, actor.id, 'CONVERT', 'RECEIPT_NOTICE', notice.id, `收料通知 ${notice.notice_no} 转换为 ${receipts.length} 张采购入库单`);
  saveIdempotency(db, CONVERT_OPERATION, noticeId, idempotencyKey, fingerprint, { ok: true, receipts });
  return { ok: true, noticeId, receipts };
}

/**
 * POST /api/receipt-notices/:id/convert
 */
export async function convertReceiptNoticeToReceipts(db, req, res, actor, noticeId) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  allow(actor, 'RECEIPT_NOTICE_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['items', 'receiptDate', 'remark', 'billingMode', 'idempotencyKey']);
  const rawKey = body.idempotencyKey || req.headers['idempotency-key'];
  if (!rawKey) {
    throw new HttpError(400, '收料通知转换必须提供 Idempotency-Key');
  }
  const key = String(rawKey);
  const fingerprint = requestFingerprint({
    noticeId,
    items: body.items ?? null,
    receiptDate: body.receiptDate ?? null,
    remark: body.remark ?? null,
    billingMode: body.billingMode ?? null,
  });
  const context = { entityType: 'RECEIPT_NOTICE', entityId: noticeId, action: '收料通知转换采购入库' };
  let replay = null;
  try {
    replay = idempotencyReplay(db, CONVERT_OPERATION, noticeId, key, fingerprint);
  } catch (error) {
    auditBusinessRejection(db, actor, context, error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  let result = null;
  try {
    result = transaction(db, () => convertReceiptNotice(db, actor, {
      noticeId, items: body.items, receiptDate: body.receiptDate, remark: body.remark,
      billingMode: body.billingMode, idempotencyKey: key, fingerprint,
    }));
  } catch (error) {
    auditBusinessRejection(db, actor, context, error);
    throw error;
  }
  return send(res, 201, result);
}
