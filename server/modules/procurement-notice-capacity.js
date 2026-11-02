// M1C-WP-1 — canonical, business-type scoped capacity resolution for
// procurement receiving.
//
// Contract source: M1-Core Active Design §5.1 / §5.2 / §6 / §9 and the
// approved Requirement MC-REQ-02 / MC-REQ-09 (docs/requirements/
// procurement-outsourcing.md §31.13).
//
// There is no longer "one set of upper bounds for every notice". Each notice
// is constrained only by the capacity it really owns:
//
//   STANDARD_PURCHASE : notice line x supplying PO line x delivery schedule
//   OUTSOURCE         : notice line x outsourcing order remaining receivable
//
// The two domains are never mixed. `confirmReceiptNotice()` and the notice
// conversion flow resolve capacity through this module, so both paths share
// exactly one capacity implementation (Active Design §13.1 CR-01).
//
// Historical facts that cannot be proven never become capacity: a source row
// without a proven converted quantity, a notice line without source rows, or
// an outsourcing receipt without effect evidence all fail closed.

import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { confirmedQuantity } from './logistics-core.js';
import { deriveQualityState } from './quality-gates.js';
import { scheduleConsumedQuantity } from './procurement-schedule-ledger.js';

export const NOTICE_ERROR_CODES = Object.freeze({
  CAPACITY_EXCEEDED: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED',
  SCHEDULE_UNPROVEN: 'RECEIPT_NOTICE_SCHEDULE_UNPROVEN',
  SOURCE_CAPACITY_UNKNOWN: 'RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN',
  OUTSOURCING_CAPACITY_UNPROVEN: 'RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN',
});

const EPSILON = 1e-9;
const RECEIPT_QUANTITY_CONFIG = Object.freeze({
  itemTable: 'purchase_receipt_items',
  sourceColumn: 'purchase_order_item_id',
  headerTable: 'purchase_receipts',
  headerForeignKey: 'receipt_id',
});

export function noticeBusinessError(code, message) {
  return new HttpError(409, message, { code });
}

/**
 * Write the rejection audit for a business-gate rejection.
 *
 * It must be called OUTSIDE the business transaction: the transaction rolls
 * back on rejection, and the audit row has to survive that rollback
 * (Active Design §9.2 — "拒绝审计恰好 1 条").
 */
export function auditBusinessRejection(db, actor, context, error, { onlyCodes = null } = {}) {
  if (!(error instanceof HttpError) || error.status !== 409) return;
  if (onlyCodes && !onlyCodes.includes(error.code)) return;
  audit(
    db,
    actor?.id ?? null,
    'REJECT',
    context.entityType,
    context.entityId ?? null,
    `${context.action} 拒绝：${error.code || 'BUSINESS_RULE_BLOCKED'} ${error.message}`,
  );
}

// ---------------------------------------------------------------------------
// Delivery schedule binding
// ---------------------------------------------------------------------------

export function listDeliverySchedulesForOrderItem(db, purchaseOrderItemId) {
  return db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE order_item_id=? ORDER BY planned_date,id').all(purchaseOrderItemId);
}

/**
 * Resolve the delivery schedule a source line must be bound to.
 *
 *   BOUND          - exactly one provable schedule (explicit or unique)
 *   NOT_APPLICABLE - the order line has no delivery schedule at all
 *   AMBIGUOUS      - several schedules and none was selected
 *   MISMATCH       - the requested schedule does not belong to the order line
 */
export function resolveDeliveryScheduleBinding(db, { purchaseOrderItemId, deliveryScheduleId }) {
  if (deliveryScheduleId) {
    const schedule = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE id=?').get(deliveryScheduleId);
    if (!schedule || schedule.order_item_id !== purchaseOrderItemId) {
      return { status: 'MISMATCH', schedule: null, candidates: [] };
    }
    return { status: 'BOUND', schedule, candidates: [schedule] };
  }
  const candidates = listDeliverySchedulesForOrderItem(db, purchaseOrderItemId);
  if (candidates.length === 1) return { status: 'BOUND', schedule: candidates[0], candidates };
  if (candidates.length === 0) return { status: 'NOT_APPLICABLE', schedule: null, candidates };
  return { status: 'AMBIGUOUS', schedule: null, candidates };
}

/**
 * Delivery schedule capacity.
 *
 * The consumption ledger is the only authoritative consumption source. A
 * notice allocation holds the schedule until it is converted; the conversion
 * hands the reservation over to the ledger (the ledger effect grows by the
 * converted quantity while the allocation shrinks by the same amount), so the
 * schedule is never deducted twice.
 */
export function resolveDeliveryScheduleCapacity(db, deliveryScheduleId) {
  const schedule = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE id=?').get(deliveryScheduleId);
  if (!schedule) return null;
  const plannedQuantity = Number(schedule.planned_quantity || 0);
  const upperTolerancePct = Number(schedule.upper_tolerance_pct || 0);
  const capacityQuantity = plannedQuantity * (1 + upperTolerancePct / 100);
  const ledgerConsumedQuantity = scheduleConsumedQuantity(db, deliveryScheduleId);
  const outstanding = db.prepare(`SELECT COALESCE(SUM(s.allocated_quantity - CASE WHEN s.converted_quantity IS NULL THEN 0 ELSE s.converted_quantity END),0) q
    FROM receipt_notice_item_sources s
    JOIN receipt_notice_items i ON i.id = s.notice_item_id
    JOIN receipt_notices n ON n.id = i.notice_id
    WHERE s.delivery_schedule_id=? AND n.status<>'CANCELLED'`).get(deliveryScheduleId);
  const outstandingAllocatedQuantity = Number(outstanding?.q || 0);
  const usedQuantity = ledgerConsumedQuantity + outstandingAllocatedQuantity;
  return {
    schedule,
    plannedQuantity,
    upperTolerancePct,
    capacityQuantity,
    ledgerConsumedQuantity,
    outstandingAllocatedQuantity,
    usedQuantity,
    remainingQuantity: capacityQuantity - usedQuantity,
  };
}

// ---------------------------------------------------------------------------
// Purchase order line capacity
// ---------------------------------------------------------------------------

/**
 * Purchase order line capacity.
 *
 * The bound is "采购订单行数量 − 已收货量 − 已分配量":
 *   已收货量   = the CONFIRMED receipt lines of the order line
 *   已分配量   = the notice allocations of the order line that are not
 *                received yet. A notice allocation reserves the order line
 *                from the moment the notice is created until the receipt it
 *                is converted into is CONFIRMED, so it is never counted
 *                twice with its own receipt line.
 *
 * A draft receipt of the DIRECT purchase order path does not reserve the
 * order line: that path keeps its established behaviour, and the quantity is
 * still capped when the receipt is confirmed.
 */
export function resolvePurchaseOrderLineCapacity(db, purchaseOrderItemId) {
  const line = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(purchaseOrderItemId);
  if (!line) return null;
  const orderedQuantity = Number(line.quantity || 0);
  const confirmedReceivedQuantity = confirmedQuantity(db, RECEIPT_QUANTITY_CONFIG, purchaseOrderItemId);
  const reserved = db.prepare(`SELECT COALESCE(SUM(s.allocated_quantity - COALESCE(c.confirmed_quantity, 0)),0) q
    FROM receipt_notice_item_sources s
    JOIN receipt_notice_items i ON i.id = s.notice_item_id
    JOIN receipt_notices n ON n.id = i.notice_id
    LEFT JOIN (
      SELECT pri.source_notice_item_source_id source_id, SUM(pri.quantity) confirmed_quantity
      FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id = pri.receipt_id
      WHERE pr.status='CONFIRMED' AND pri.purchase_order_item_id=? AND pri.source_notice_item_source_id IS NOT NULL
      GROUP BY pri.source_notice_item_source_id
    ) c ON c.source_id = s.id
    WHERE s.purchase_order_item_id=? AND n.status<>'CANCELLED'`).get(purchaseOrderItemId, purchaseOrderItemId);
  const noticeReservedQuantity = Number(reserved?.q || 0);
  const usedQuantity = confirmedReceivedQuantity + noticeReservedQuantity;
  return {
    purchaseOrderItemId,
    orderedQuantity,
    confirmedReceivedQuantity,
    noticeReservedQuantity,
    usedQuantity,
    remainingQuantity: orderedQuantity - usedQuantity,
  };
}

// ---------------------------------------------------------------------------
// Notice line capacity
// ---------------------------------------------------------------------------

/**
 * Capacity of one receipt notice line.
 *
 * A notice line without source rows, or with a source row whose converted
 * quantity is NULL, provides NO convertible capacity: the historical
 * converted quantity is unproven and must not be read as zero
 * (Active Design §10, MC-REQ-02).
 */
export function resolveNoticeItemCapacity(db, noticeItemId) {
  const item = db.prepare('SELECT * FROM receipt_notice_items WHERE id=?').get(noticeItemId);
  if (!item) return null;
  const sources = db.prepare('SELECT * FROM receipt_notice_item_sources WHERE notice_item_id=? ORDER BY id').all(noticeItemId);
  const quantity = Number(item.quantity || 0);
  if (!sources.length) {
    return {
      noticeItem: item, quantity, sources: [], convertedQuantity: null,
      remainingQuantity: 0, provable: false, unprovenReason: 'NO_SOURCE_ROWS',
    };
  }
  let convertedQuantity = 0;
  for (const source of sources) {
    if (source.converted_quantity === null || source.converted_quantity === undefined) {
      return {
        noticeItem: item, quantity, sources, convertedQuantity: null,
        remainingQuantity: 0, provable: false, unprovenReason: 'CONVERTED_QUANTITY_UNKNOWN',
      };
    }
    convertedQuantity += Number(source.converted_quantity);
  }
  return {
    noticeItem: item, quantity, sources, convertedQuantity,
    remainingQuantity: quantity - convertedQuantity, provable: true, unprovenReason: null,
  };
}

// ---------------------------------------------------------------------------
// Outsourcing order capacity (OUTSOURCE notices only)
// ---------------------------------------------------------------------------

/**
 * Whether a historical outsourcing receipt carries a completed, effective
 * quality decision.
 *
 * The existence of an IQC record proves nothing: `iqc_inspections.status`
 * defaults to PENDING and `result` stays NULL until the inspection is
 * completed, so a merely created inspection would make an unproven historical
 * receipt look "已生效已确认". Only a completed inspection whose result is
 * PASS / WAIVED is a quality decision, and it must still satisfy the
 * canonical effective quality gate state. Every other shape — DRAFT, PENDING,
 * CANCELLED or a completed FAIL — is "历史未证实" and fails closed.
 */
function hasEffectiveQualityDecision(db, outsourcingReceiptId) {
  const decision = db.prepare(`SELECT id FROM iqc_inspections
    WHERE outsourcing_receipt_id=? AND status='COMPLETED' AND result IN ('PASS','WAIVED')
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(outsourcingReceiptId);
  if (!decision) return false;
  const state = deriveQualityState(db, 'IQC', outsourcingReceiptId, 'OUTSOURCING_RECEIPT');
  return state.code === 'PASS' || state.code === 'WAIVED';
}

/**
 * Outsourcing order remaining receivable quantity.
 *
 * A historical outsourcing receipt only counts as received capacity when its
 * effect is provable (inventory transaction, valuation movement, cost
 * evidence or a completed quality decision). An unprovable receipt makes the
 * whole remaining capacity unprovable, which fails closed instead of
 * assuming an effect that history never proved (Active Design §10).
 */
export function resolveOutsourcingOrderCapacity(db, outsourcingOrderId) {
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(outsourcingOrderId);
  if (!order) return null;
  const orderQuantity = Number(order.order_quantity || 0);
  const receipts = db.prepare(`SELECT * FROM outsourcing_receipts WHERE order_id=? AND business_status<>'CANCELLED' ORDER BY id`).all(outsourcingOrderId);
  let confirmedReceiptQuantity = 0;
  const unprovenReceiptIds = [];
  for (const receipt of receipts) {
    const evidenceProven = db.prepare(`SELECT 1 FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? LIMIT 1`).get(receipt.id)
      || db.prepare(`SELECT 1 FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? LIMIT 1`).get(receipt.id)
      || db.prepare('SELECT 1 FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=? LIMIT 1').get(receipt.id)
      || hasEffectiveQualityDecision(db, receipt.id);
    if (!evidenceProven) {
      unprovenReceiptIds.push(receipt.id);
      continue;
    }
    confirmedReceiptQuantity += Number(receipt.quantity || 0);
  }
  return {
    outsourcingOrderId,
    orderQuantity,
    confirmedReceiptQuantity,
    unprovenReceiptIds,
    provable: unprovenReceiptIds.length === 0,
    remainingQuantity: orderQuantity - confirmedReceiptQuantity,
  };
}

// ---------------------------------------------------------------------------
// Notice quantity aggregation (other notices on the same outsourcing order)
// ---------------------------------------------------------------------------

export function sumOutsourcingNoticeQtyByStatus(db, outsourcingOrderId, statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const row = db.prepare(`SELECT COALESCE(SUM(rni.quantity),0) q
    FROM receipt_notice_items rni
    JOIN receipt_notices rn ON rn.id=rni.notice_id
    WHERE rn.outsourcing_order_id=? AND rn.business_type='OUTSOURCE' AND rn.status IN (${placeholders})`).get(outsourcingOrderId, ...statuses);
  return Number(row?.q || 0);
}
