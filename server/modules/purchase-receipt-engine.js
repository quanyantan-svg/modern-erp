// M1C-WP-1 — canonical purchase receipt engine.
//
// The engine owns the single production writer for purchase receipts. Its
// business core is extracted from server/app.js so that the notice conversion
// flow (server/modules/procurement-notice-conversion.js) can reuse the very
// same writer inside its own transaction instead of duplicating the receipt
// SQL (Active Design §5.1, AGENTS.md §6 "one active canonical implementation").
//
// The HTTP entry points in server/app.js stay the public contract: same
// routes, same response bodies, same direct PO -> purchase receipt behaviour.
//
// Neither core function opens a transaction. The caller owns the transaction
// boundary, so the notice conversion can create the receipt and accumulate the
// converted quantity in ONE authoritative transaction.

import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, optionalText } from '../lib/http.js';
import { adjustInventory } from '../lib/stock.js';
import { getActiveParameters } from './procurement-parameters.js';
import { setSourceRecognitionPolicy, RECOGNITION_MODES } from './finance-recognition-policy.js';
import { recognizeFinanceExposure } from './finance-recognition.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, inventoryAccountRole, receiveSourceValue } from './financial-inventory.js';
import { postTrackedMovement } from './traceability-quality.js';
import { autoBillReceipt } from './commercial-golive.js';
import { assertQualityGate } from './quality-gates.js';
import { saveIdempotency } from './financial-controls.js';
import {
  authoritativeLogisticsTotal, configureTrackedDraftLines, normalizeDocumentDate,
  normalizeSourcedLogisticsItems, replaceLogisticsItems, requireActiveReference,
} from './logistics-core.js';
import {
  NOTICE_ERROR_CODES, noticeBusinessError, resolveDeliveryScheduleBinding,
  resolveDeliveryScheduleCapacity, resolvePurchaseOrderLineCapacity,
} from './procurement-notice-capacity.js';
import { recordScheduleConsumption, recordScheduleConsumptionReversal, SCHEDULE_EFFECT_BUSINESS_EVENT_TYPE } from './procurement-schedule-ledger.js';

const EPSILON = 1e-9;

/**
 * Authoritative remaining quantity of a purchase order line.
 *
 * The bound is "采购订单行数量 − 已收货量 − 已分配量":
 *   已收货量   = CONFIRMED receipt lines of the order line
 *   已分配量   = DRAFT receipt lines + notice allocations that are not
 *                converted yet (the converted part of a notice allocation is
 *                carried by its receipt line instead, so it is never counted
 *                twice)
 */
function assertPurchaseOrderLineRemaining(db, purchaseOrderItemId, additionalQuantity, alreadyReserved = 0) {
  const capacity = resolvePurchaseOrderLineCapacity(db, purchaseOrderItemId);
  if (!capacity) throw new HttpError(400, '采购订单明细不存在');
  if (capacity.usedQuantity + additionalQuantity - alreadyReserved > capacity.orderedQuantity + EPSILON) {
    throw noticeBusinessError(
      NOTICE_ERROR_CODES.CAPACITY_EXCEEDED,
      '收货数量超过采购订单剩余可收数量',
    );
  }
}

/**
 * Bind the delivery schedule of every receipt line.
 *
 * A schedule is bound when it is provable: the caller selected it explicitly,
 * or the order line owns exactly one schedule. An order line without any
 * delivery schedule is simply not schedule bound — the direct PO -> purchase
 * receipt path stays legal for those orders. Several schedules without an
 * explicit selection are ambiguous and fail closed.
 */
function bindDeliverySchedules(db, normalizedItems, rawItems) {
  return normalizedItems.map((item, index) => {
    const requested = rawItems?.[index]?.deliveryScheduleId ?? rawItems?.[index]?.delivery_schedule_id ?? null;
    const binding = resolveDeliveryScheduleBinding(db, {
      purchaseOrderItemId: item.sourceItemId,
      deliveryScheduleId: requested || null,
    });
    if (binding.status === 'MISMATCH') {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '收货明细指定的交期不属于对应采购订单行');
    }
    if (binding.status === 'AMBIGUOUS') {
      throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '采购订单行存在多个交期，必须显式指定交期');
    }
    return { ...item, deliveryScheduleId: binding.status === 'BOUND' ? binding.schedule.id : null };
  });
}

function assertScheduleCapacity(db, normalizedItems, reservedBySchedule = new Map()) {
  const perSchedule = new Map();
  for (const item of normalizedItems) {
    if (!item.deliveryScheduleId) continue;
    perSchedule.set(item.deliveryScheduleId, (perSchedule.get(item.deliveryScheduleId) || 0) + Number(item.quantity));
  }
  for (const [scheduleId, quantity] of perSchedule) {
    const capacity = resolveDeliveryScheduleCapacity(db, scheduleId);
    if (!capacity) throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '交期不存在，无法证明交期容量');
    const reserved = reservedBySchedule.get(scheduleId) || 0;
    if (capacity.usedQuantity + quantity - reserved > capacity.capacityQuantity + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '收货数量超过交期与容差剩余容量');
    }
  }
}

/**
 * The quantities a receipt line already holds from a notice allocation.
 *
 * A notice converted receipt line does not add new capacity: the quantity
 * was already reserved by the notice source row, so the order line and the
 * delivery schedule usage stays unchanged when the receipt line appears.
 */
function reservedAmountByBoundItems(items) {
  const perOrderLine = new Map();
  const perSchedule = new Map();
  for (const item of items) {
    if (!item.sourceNoticeItemSourceId) continue;
    const quantity = Number(item.quantity);
    perOrderLine.set(item.sourceItemId, (perOrderLine.get(item.sourceItemId) || 0) + quantity);
    if (item.deliveryScheduleId) {
      perSchedule.set(item.deliveryScheduleId, (perSchedule.get(item.deliveryScheduleId) || 0) + quantity);
    }
  }
  return { perOrderLine, perSchedule };
}

/**
 * Create the purchase receipt. The caller owns the transaction.
 *
 * `sourceNoticeId` links the receipt to the receipt notice it was converted
 * from; the per-line notice source row and delivery schedule are carried by
 * the normalized items.
 */
export function createPurchaseReceiptCore(db, actor, {
  purchaseOrderId, supplierId, warehouseId, remark, items, receiptDate, billingMode, sourceNoticeId = null,
  allowDuplicateSourceItems = false,
}) {
  const mode = billingMode || getActiveParameters(db).defaultReceiptBillingMode;
  if (!['SEPARATE', 'AUTO_BILL', 'LEGACY_DIRECT'].includes(mode)) throw new HttpError(400, '无效采购计费模式');
  const businessDate = normalizeDocumentDate(receiptDate || new Date().toISOString().slice(0, 10), '收货日期');
  if (!purchaseOrderId) throw new HttpError(400, '正常采购收货必须选择已审批采购订单');
  const source = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(purchaseOrderId);
  if (!source) throw new HttpError(400, '采购订单不存在');
  if (source.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以收货');
  if (supplierId !== undefined && supplierId !== source.supplier_id) throw new HttpError(400, '供应商与采购订单不一致');
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');

  const normalized = normalizeSourcedLogisticsItems(db, items, {
    sourceTable: 'purchase_order_items', sourceHeaderColumn: 'order_id', sourceHeaderId: purchaseOrderId,
    sourceIdCamel: 'purchaseOrderItemId', sourceIdSnake: 'purchase_order_item_id',
    allowDuplicateSourceItems,
  });
  // Only a receipt that is converted from a receipt notice may carry a
  // notice source row. A direct client request can never forge that link.
  const normalizedItems = sourceNoticeId
    ? normalized.items
    : normalized.items.map((item) => ({ ...item, sourceNoticeItemSourceId: null }));
  const bound = bindDeliverySchedules(db, normalizedItems, items);

  // Canonical remaining-quantity check, re-read inside the caller's transaction.
  const reserved = reservedAmountByBoundItems(bound);
  const perOrderLine = new Map();
  for (const item of bound) {
    perOrderLine.set(item.sourceItemId, (perOrderLine.get(item.sourceItemId) || 0) + Number(item.quantity));
  }
  for (const [orderItemId, quantity] of perOrderLine) {
    assertPurchaseOrderLineRemaining(db, orderItemId, quantity, reserved.perOrderLine.get(orderItemId) || 0);
  }
  assertScheduleCapacity(db, bound, reserved.perSchedule);

  const receiptId = id();
  const now = new Date().toISOString();
  const receiptNo = 'PR' + Date.now().toString().slice(-10);
  db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode,source_notice_id)
    VALUES(?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)`).run(
    receiptId, receiptNo, purchaseOrderId, source.supplier_id, warehouseId, actor.id, normalized.totalCents, businessDate,
    optionalText(remark, 500), actor.id, now, now, mode, sourceNoticeId,
  );
  setSourceRecognitionPolicy(db, {
    side: 'AP', sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId,
    recognitionMode: mode === 'LEGACY_DIRECT' ? RECOGNITION_MODES.DIRECT : RECOGNITION_MODES.PROVISIONAL,
    effectiveDate: businessDate, actorId: actor.id,
  });
  const insertedItems = replaceLogisticsItems(db, 'purchase_receipt_items', 'receipt_id', receiptId, bound, 'purchase_order_item_id');
  configureTrackedDraftLines(db, {
    sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, itemTable: 'purchase_receipt_items',
    foreignKey: 'receipt_id', rawItems: items, businessDate,
  });

  // Delivery schedule consumption ledger: the receipt line reserves the
  // schedule capacity it is bound to. The ledger is the only authoritative
  // consumption source; the legacy received_quantity column is never written.
  for (const item of insertedItems) {
    if (!item.deliveryScheduleId) continue;
    recordScheduleConsumption(db, {
      purchaseOrderItemId: item.sourceItemId,
      deliveryScheduleId: item.deliveryScheduleId,
      sourceType: 'PURCHASE_RECEIPT',
      sourceItemId: item.id,
      businessEventType: SCHEDULE_EFFECT_BUSINESS_EVENT_TYPE,
      businessEventId: receiptId,
      businessEventItemId: item.id,
      signedQuantity: Number(item.quantity),
      businessDate,
    });
  }

  audit(db, actor.id, 'CREATE', 'PURCHASE_RECEIPT', receiptId, '创建采购入库单 ' + receiptNo);
  return { receiptId, receiptNo, totalCents: normalized.totalCents, items: insertedItems };
}

/**
 * Confirm the purchase receipt. The caller owns the transaction.
 */
export function confirmPurchaseReceiptCore(db, actor, receiptId, { idempotencyKey, fingerprint }) {
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id = ?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  const now = new Date().toISOString();
  const locked = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  if (!locked.purchase_order_id) throw new HttpError(409, '旧版无来源采购入库不可确认，请使用库存调整单');
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(locked.purchase_order_id);
  if (!po || po.status !== 'APPROVED') throw new HttpError(409, '来源采购订单不存在或未审批');
  if (locked.supplier_id !== po.supplier_id) throw new HttpError(409, '入库供应商与来源采购订单不一致');
  assertQualityGate(db, 'IQC', receiptId);
  assertFinancialPeriodsOpen(db, locked.receipt_date);
  const authoritative = authoritativeLogisticsTotal(db, 'purchase_receipt_items', 'receipt_id', receiptId);
  const inventoryEntries = [];
  const perOrderLine = new Map();
  for (const item of authoritative.items) {
    const key = item.purchase_order_item_id;
    const entry = perOrderLine.get(key) || { quantity: 0, reserved: 0 };
    entry.quantity += Number(item.quantity);
    if (item.source_notice_item_source_id) entry.reserved += Number(item.quantity);
    perOrderLine.set(key, entry);
  }
  for (const [orderItemId, entry] of perOrderLine) {
    const capacity = resolvePurchaseOrderLineCapacity(db, orderItemId);
    if (!capacity) throw new HttpError(409, '入库明细与采购订单来源不一致');
    // The quantity of a notice converted receipt line is already reserved by
    // its notice allocation, so it must not be counted twice.
    if (capacity.usedQuantity + entry.quantity - entry.reserved > capacity.orderedQuantity + EPSILON) {
      throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '收货数量超过采购订单剩余可收数量');
    }
  }
  for (const item of authoritative.items) {
    const sourceItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(item.purchase_order_item_id, po.id);
    if (!sourceItem || item.product_id !== sourceItem.product_id || item.unit_price_cents !== sourceItem.unit_price_cents) throw new HttpError(409, '入库明细与采购订单来源不一致');
    const baseQuantity = (item.base_quantity_num != null && Number(item.base_quantity_num) > 0)
      ? Number(item.base_quantity_num) / Number(item.base_quantity_den || 1)
      : Number(item.quantity);
    postTrackedMovement(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, sourceItemId: item.id, productId: item.product_id, warehouseId: locked.warehouse_id, quantity: baseQuantity, direction: 'IN', businessDate: locked.receipt_date });
    const balance = adjustInventory(db, locked.warehouse_id, item.product_id, baseQuantity, now);
    const transactionId = id();
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date) VALUES(?,?,?,?,'IN',?,'PURCHASE_RECEIPT',?,?,?,?,?,?)`).run(transactionId, locked.warehouse_id, item.product_id, baseQuantity, balance, receiptId, locked.receipt_no, '采购入库', actor.id, now, locked.receipt_date);
    receiveSourceValue(db, { businessDate: locked.receipt_date, productId: item.product_id, warehouseId: locked.warehouse_id, quantity: baseQuantity, valueCents: Number(item.amount_cents), movementType: 'PURCHASE_RECEIPT', sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, sourceItemId: item.id, inventoryTransactionId: transactionId, valuationBasis: 'APPROVED_PO_PRICE' });
    inventoryEntries.push({ role: inventoryAccountRole(db, item.product_id), direction: 'DEBIT', amountCents: Number(item.amount_cents), summary: '采购入库 ' + locked.receipt_no });
  }
  db.prepare('UPDATE purchase_receipts SET total_cents=?,status=\'CONFIRMED\', confirmed_at=?, confirmed_by=?, updated_at=? WHERE id=?').run(authoritative.totalCents, now, actor.id, now, receiptId);
  const recognition = recognizeFinanceExposure(db, {
    side: 'AP', source: { sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, sourceNo: locked.receipt_no },
    invoice: null, amountCents: authoritative.totalCents, businessDate: locked.receipt_date,
    partyId: locked.supplier_id, paymentTermsDays: po.payment_terms_days,
    actorId: actor.id, createdAt: locked.created_at,
  });
  if (recognition.recognitionMode === RECOGNITION_MODES.DIRECT) {
    const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(locked.supplier_id)?.name || '';
    createSystemVoucher(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, businessDate: locked.receipt_date, actorId: actor.id, entries: [...inventoryEntries, { role: 'ACCOUNTS_PAYABLE', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '采购入库 ' + locked.receipt_no + ' ' + supplierName }] });
  } else {
    createSystemVoucher(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: receiptId, businessDate: locked.receipt_date, actorId: actor.id, entries: [...inventoryEntries, { role: 'GRNI', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '采购收货 GRNI ' + locked.receipt_no }] });
    if (locked.billing_mode === 'AUTO_BILL') autoBillReceipt(db, receiptId, actor.id, `AUTO_BILL:${receiptId}`);
  }
  saveIdempotency(db, 'PURCHASE_RECEIPT_CONFIRM', receiptId, idempotencyKey, fingerprint, { ok: true, id: receiptId, status: 'CONFIRMED' });
  audit(db, actor.id, 'CONFIRM', 'PURCHASE_RECEIPT', receiptId, '确认采购入库 ' + locked.receipt_no);
  return { receiptId, status: 'CONFIRMED' };
}

/**
 * Cancel a draft purchase receipt. The schedule reservation it holds is
 * released with a signed reversal effect; the original effect is never
 * mutated.
 */
export function cancelPurchaseReceiptCore(db, actor, receiptId) {
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  if (receipt.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
  const now = new Date().toISOString();
  const items = db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  for (const item of items) {
    if (!item.delivery_schedule_id) continue;
    const effect = db.prepare(`SELECT * FROM schedule_consumption_effects
      WHERE business_event_type=? AND business_event_id=? AND business_event_item_id=? AND reverses_effect_key=''`)
      .get(SCHEDULE_EFFECT_BUSINESS_EVENT_TYPE, receiptId, item.id);
    if (!effect) continue;
    recordScheduleConsumptionReversal(db, {
      purchaseOrderItemId: item.purchase_order_item_id,
      deliveryScheduleId: item.delivery_schedule_id,
      sourceType: 'PURCHASE_RECEIPT',
      sourceItemId: item.id,
      businessEventType: 'PURCHASE_RECEIPT_CANCEL',
      businessEventId: receiptId,
      businessEventItemId: item.id,
      signedQuantity: Number(effect.signed_quantity),
      reversesEffectId: effect.id,
      businessDate: receipt.receipt_date,
    });
  }
  db.prepare("UPDATE purchase_receipts SET status='CANCELLED', updated_at=? WHERE id=?").run(now, receiptId);
  audit(db, actor.id, 'CANCEL', 'PURCHASE_RECEIPT', receiptId, '取消采购入库 ' + receipt.receipt_no);
  return { receiptId, status: 'CANCELLED' };
}
