import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';

const VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_MANAGE'];
const CHANGE_PERMISSIONS = ['PO_CHANGE_VIEW', 'PO_CHANGE_MANAGE'];
const STANDARD_BUY_TYPES = new Set(['STANDARD_PURCHASE']);
const BUSINESS_TYPES = new Set(['STANDARD_PURCHASE', 'OUTSOURCE_PROCESSING']);
const ACTIONS = new Set(['ADD', 'MODIFY', 'CANCEL']);

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'PURCHASE_ORDERS_MANAGE'); }
function assertChangePermission(actor) { allowAny(actor, CHANGE_PERMISSIONS); }
function assertChangeManagePermission(actor) { allow(actor, 'PO_CHANGE_MANAGE'); }

function normalizeBusinessType(value, fallback = 'STANDARD_PURCHASE') {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toUpperCase();
  if (!BUSINESS_TYPES.has(text)) throw new HttpError(400, '业务类型不正确');
  return text;
}

function normalizeAction(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!ACTIONS.has(text)) throw new HttpError(400, '变更动作不正确');
  return text;
}

function rowToSchedule(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    plannedQuantity: row.planned_quantity,
    plannedDate: row.planned_date,
    receivedQuantity: row.received_quantity,
    upperTolerancePct: row.upper_tolerance_pct,
    lowerTolerancePct: row.lower_tolerance_pct,
  };
}

function rowToChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    action: row.action,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    original: row.original_json ? JSON.parse(row.original_json) : null,
    requested: row.requested_json ? JSON.parse(row.requested_json) : null,
    applied: row.applied_json ? JSON.parse(row.applied_json) : null,
    approverId: row.approver_id,
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Canonical PO Execution Read Model — single source of truth for ordered/notified/received/returned/remaining.
 * Used by MRP / Planner Workbench / Reservation / Receiving. Must NOT be duplicated.
 */
export function getPurchaseOrderExecution(db, orderId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  // Notice qty (PRC-20): count from receipt_notices; with null source fall-back to ZERO (notice infrastructure introduced in Wave D).
  const noticeRows = db.prepare(`SELECT rni.purchase_order_item_id item_id, COALESCE(SUM(rni.quantity),0) qty
    FROM receipt_notices rn JOIN receipt_notice_items rni ON rni.notice_id=rn.id WHERE rn.purchase_order_id=? AND rn.status<>'CANCELLED' GROUP BY rni.purchase_order_item_id`).all(orderId);
  const noticeMap = new Map(noticeRows.map((r) => [r.item_id, r.qty]));
  const receivedRows = db.prepare(`SELECT pri.purchase_order_item_id item_id, COALESCE(SUM(pri.quantity),0) qty
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id=pr.id WHERE pr.purchase_order_id=? AND pr.status='CONFIRMED' GROUP BY pri.purchase_order_item_id`).all(orderId);
  const receivedMap = new Map(receivedRows.map((r) => [r.item_id, r.qty]));
  const returnedRows = db.prepare(`SELECT prei.purchase_order_item_id item_id, COALESCE(SUM(prti.quantity),0) qty
    FROM purchase_returns pr JOIN purchase_receipts prh ON prh.id=pr.receipt_id
    JOIN purchase_return_items prti ON prti.return_id=pr.id
    JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id
    WHERE prh.purchase_order_id=? AND pr.status='CONFIRMED' GROUP BY prei.purchase_order_item_id`).all(orderId);
  const returnedMap = new Map(returnedRows.map((r) => [r.item_id, r.qty]));
  const executionItems = items.map((item) => {
    const ordered = Number(item.quantity);
    const notified = Number(noticeMap.get(item.id) || 0);
    const received = Number(receivedMap.get(item.id) || 0);
    const returned = Number(returnedMap.get(item.id) || 0);
    return {
      orderItemId: item.id,
      productId: item.product_id,
      ordered, notified, received, returned,
      remaining: Math.max(0, ordered - received + returned),
    };
  });
  const aggregate = executionItems.reduce((acc, item) => ({
    ordered: acc.ordered + item.ordered,
    notified: acc.notified + item.notified,
    received: acc.received + item.received,
    returned: acc.returned + item.returned,
    remaining: acc.remaining + item.remaining,
  }), { ordered: 0, notified: 0, received: 0, returned: 0, remaining: 0 });
  return {
    orderId,
    businessType: order.business_type || 'STANDARD_PURCHASE',
    status: order.status,
    items: executionItems,
    aggregate,
  };
}

export function listOpenRemainingBySupplierProduct(db, supplierId, productId) {
  // BUY supply must exclude OUTSOURCE_PROCESSING.
  return db.prepare(`SELECT poi.id order_item_id, po.id order_id, poi.quantity ordered,
    (SELECT COALESCE(SUM(pri.quantity),0) FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id=pri.receipt_id
     WHERE pri.purchase_order_item_id=poi.id AND pr.status='CONFIRMED') received,
    (SELECT COALESCE(SUM(pri.quantity),0) FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id=pri.return_id
     WHERE pri.purchase_order_item_id=poi.id AND pr.status='CONFIRMED') returned
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.order_id=po.id
    WHERE po.supplier_id=? AND poi.product_id=? AND po.status='APPROVED'
      AND (po.business_type IS NULL OR po.business_type='STANDARD_PURCHASE')
    HAVING (ordered - received + returned) > 0`).all(supplierId, productId);
}

export async function createDeliverySchedule(db, req, res, actor, orderId) {
  assertChangePermission(actor);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  if (order.status !== 'APPROVED') throw new HttpError(409, '已审批的采购订单才能维护交货计划');
  const body = await readJson(req);
  assertAllowedFields(body, ['orderItemId', 'plannedQuantity', 'plannedDate', 'upperTolerancePct', 'lowerTolerancePct']);
  const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(body.orderItemId, orderId);
  if (!orderItem) throw new HttpError(404, '订单明细不存在');
  const scheduleId = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_order_delivery_schedules(id,order_id,order_item_id,planned_quantity,planned_date,received_quantity,upper_tolerance_pct,lower_tolerance_pct,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,0,?,?,?,?,?)`).run(scheduleId, orderId, body.orderItemId, Number(body.plannedQuantity), body.plannedDate, Number(body.upperTolerancePct || 0), Number(body.lowerTolerancePct || 0), actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PO_DELIVERY_SCHEDULE', scheduleId, `${orderId}:${body.orderItemId}`);
  });
  return send(res, 201, { id: scheduleId });
}

export function listDeliverySchedules(db, res, actor, orderId) {
  assertViewPermission(actor);
  const schedules = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE order_id=? ORDER BY planned_date').all(orderId).map(rowToSchedule);
  return send(res, 200, { schedules });
}

export async function createPurchaseOrderChange(db, req, res, actor) {
  assertChangeManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['orderId', 'action', 'payload']);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const action = normalizeAction(body.action);
  const changeId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_order_changes(id,order_id,action,status,payload_json,original_json,requested_json,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(changeId, body.orderId, action, 'DRAFT', JSON.stringify(body.payload), JSON.stringify(body.payload), JSON.stringify(body.payload), actor.id, now);
    audit(db, actor.id, 'CREATE', 'PO_CHANGE', changeId, `${body.orderId}:${action}`);
  });
  return send(res, 201, { id: changeId });
}

export async function approvePurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeManagePermission(actor);
  const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
  if (!change) throw new HttpError(404, '变更单不存在');
  if (change.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以审核');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchase_order_changes SET status=?, approver_id=?, approved_at=? WHERE id=?').run('APPROVED', actor.id, now, changeId);
    audit(db, actor.id, 'APPROVE', 'PO_CHANGE', changeId, '');
  });
  return send(res, 200, { ok: true });
}

export async function applyPurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeManagePermission(actor);
  const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
  if (!change) throw new HttpError(404, '变更单不存在');
  if (change.status !== 'APPROVED') throw new HttpError(409, '只有已审核的变更单可以应用');
  const payload = JSON.parse(change.payload_json);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const now = new Date().toISOString();
  transaction(db, () => {
    if (change.action === 'ADD') {
      const itemId = randomUUID();
      db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,is_gift_line)
        VALUES(?,?,?,?,?,?,?,?)`).run(itemId, change.order_id, payload.productId, Number(payload.quantity), Number(payload.unitPriceCents), Number(payload.quantity) * Number(payload.unitPriceCents), payload.lineNo || 99, payload.isGiftLine ? 1 : 0);
    } else if (change.action === 'MODIFY') {
      if (!payload.orderItemId) throw new HttpError(400, 'MODIFY 必须提供 orderItemId');
      // Guard: cannot reduce quantity below already-executed quantity
      const execution = getPurchaseOrderExecution(db, change.order_id);
      const target = execution.items.find((item) => item.orderItemId === payload.orderItemId);
      if (!target) throw new HttpError(404, '订单明细不存在');
      const newQty = Number(payload.quantity);
      const executed = Math.max(target.received - target.returned, 0);
      if (newQty < executed) throw new HttpError(409, `新数量不能小于已执行数量 ${executed}`);
      db.prepare('UPDATE purchase_order_items SET quantity=?,unit_price_cents=? WHERE id=?').run(newQty, Number(payload.unitPriceCents || 0), payload.orderItemId);
    } else if (change.action === 'CANCEL') {
      db.prepare('UPDATE purchase_orders SET status=? WHERE id=?').run('CANCELLED', change.order_id);
    }
    db.prepare('UPDATE purchase_order_changes SET status=?, applied_json=?, applied_at=? WHERE id=?').run('APPLIED', JSON.stringify(payload), now, changeId);
    audit(db, actor.id, 'APPLY', 'PO_CHANGE', changeId, change.action);
  });
  return send(res, 200, { ok: true });
}

export function listPurchaseOrderChanges(db, res, actor, orderId) {
  assertViewPermission(actor);
  const changes = db.prepare('SELECT * FROM purchase_order_changes WHERE order_id=? ORDER BY created_at DESC').all(orderId).map(rowToChange);
  return send(res, 200, { changes });
}

export function getPurchaseOrderExecutionView(db, res, actor, orderId) {
  assertViewPermission(actor);
  return send(res, 200, { execution: getPurchaseOrderExecution(db, orderId) });
}
