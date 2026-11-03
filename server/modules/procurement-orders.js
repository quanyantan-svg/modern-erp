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

export function createPurchaseOrderDraftCanonical(db, actor, command) {
  const businessType = normalizeBusinessType(command.businessType);
  const sourceOutsourcingOrderId = command.sourceOutsourcingOrderId || null;
  if (businessType === 'STANDARD_PURCHASE' && sourceOutsourcingOrderId) {
    throw new HttpError(400, '普通采购订单不得设置委外来源', { code: 'PURCHASE_ORDER_SOURCE_NOT_ALLOWED' });
  }
  if (businessType === 'OUTSOURCE_PROCESSING' && !sourceOutsourcingOrderId) {
    throw new HttpError(400, '加工费采购订单必须绑定委外订单', { code: 'PROCESSING_PO_SOURCE_REQUIRED' });
  }
  if (!Array.isArray(command.items) || !command.items.length) throw new HttpError(400, '采购订单至少需要一条明细');
  if (businessType === 'OUTSOURCE_PROCESSING' && command.items.length !== 1) {
    throw new HttpError(400, '加工费采购订单首期只允许一条来源锁定明细', { code: 'PROCESSING_PO_SINGLE_LINE_REQUIRED' });
  }
  if (!Number.isSafeInteger(command.totalCents) || command.totalCents < 0) throw new HttpError(400, '采购订单总额必须为安全整数分');
  const orderId = command.id || randomUUID();
  const orderNo = command.orderNo || `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const now = command.now || new Date().toISOString();
  db.prepare(`INSERT INTO purchase_orders(
      id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,
      order_date,expected_delivery_date,payment_terms,payment_terms_days,supplier_contact_name,supplier_contact_phone,supplier_address,
      business_type,source_outsourcing_order_id,supplier_contact_snapshot,supplier_address_snapshot,payment_terms_snapshot,purchase_requisition_id)
    VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    orderId, orderNo, command.supplierId, command.totalCents, command.remark || '', actor.id, now, now,
    command.orderDate || null, command.expectedDeliveryDate || null, command.paymentTerms || '', command.paymentTermsDays ?? null,
    command.supplierContactName || '', command.supplierContactPhone || '', command.supplierAddress || '',
    businessType, sourceOutsourcingOrderId, command.supplierContactSnapshot || '', command.supplierAddressSnapshot || '',
    command.paymentTermsSnapshot || '', command.purchaseRequisitionId || null,
  );
  const insert = db.prepare(`INSERT INTO purchase_order_items(
      id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_requisition_item_id,is_gift_line,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [index, item] of command.items.entries()) {
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || !Number.isSafeInteger(item.amountCents) || item.amountCents < 0) {
      throw new HttpError(400, `第 ${index + 1} 行金额必须为安全整数分`);
    }
    insert.run(item.id || randomUUID(), orderId, item.productId, Number(item.quantity), item.unitPriceCents, item.amountCents,
      item.lineNo || index + 1, item.purchaseRequisitionItemId || null, item.isGiftLine ? 1 : 0,
      item.documentUomCode || null, item.documentQuantityNumerator ?? (Number.isSafeInteger(item.quantity) ? item.quantity : null), item.documentQuantityDenominator ?? 1,
      item.conversionNumerator ?? 1, item.conversionDenominator ?? 1,
      item.baseQuantityNumerator ?? (Number.isSafeInteger(item.quantity) ? item.quantity : null), item.baseQuantityDenominator ?? 1);
  }
  audit(db, actor.id, command.auditAction || 'CREATE', 'PURCHASE_ORDER', orderId,
    command.auditDetail || `创建采购订单 ${orderNo}`);
  return { id: orderId, orderNo };
}

function assertProcessingPurchaseOrderChangeAllowed(order) {
  if (order && (order.business_type || 'STANDARD_PURCHASE') === 'OUTSOURCE_PROCESSING') {
    throw new HttpError(409, '首期加工费采购订单不允许 ADD/MODIFY/CANCEL 变更', { code: 'PROCESSING_PO_CHANGE_NOT_ALLOWED' });
  }
}

/**
 * 加工费 PO 商业字段原位更新器（Active Design §3 / §5.5）。
 *
 * 只允许 `DRAFT` / `REJECTED`，只允许商业白名单，且必须原位 UPDATE：
 * `purchase_order_items.id`、来源身份、产品、数量与 UOM/换算快照一律不可变。
 * 调用方负责事务与权限；本函数自身在事务内重读并校验权威委外来源。
 */
export function updateOutsourcingProcessingPurchaseOrderCommercialFields(db, { orderId, actor, input, now }) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  if ((order.business_type || 'STANDARD_PURCHASE') !== 'OUTSOURCE_PROCESSING') {
    throw new HttpError(409, '非加工费采购订单不得使用加工费商业更新器', { code: 'PROCESSING_PO_SOURCE_IMMUTABLE' });
  }
  if (!['DRAFT', 'REJECTED'].includes(order.status)) {
    throw new HttpError(409, '加工费采购订单状态不可修改', { code: 'PROCESSING_PO_STATE_CHANGED' });
  }
  const stored = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const source = order.source_outsourcing_order_id
    ? db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(order.source_outsourcing_order_id)
    : null;
  const requested = input.items[0];
  if (!source || stored.length !== 1 || input.items.length !== 1
    || input.supplierId !== order.supplier_id || input.supplierId !== source.supplier_id
    || requested.productId !== stored[0].product_id || requested.productId !== source.product_id
    || requested.quantity !== Number(stored[0].quantity)
    || requested.documentUomCode !== stored[0].document_uom_code
    || requested.documentQuantityNumerator !== Number(stored[0].document_quantity_num)
    || requested.documentQuantityDenominator !== Number(stored[0].document_quantity_den)
    || requested.conversionNumerator !== Number(stored[0].conversion_numerator)
    || requested.conversionDenominator !== Number(stored[0].conversion_denominator)
    || requested.baseQuantityNumerator !== Number(stored[0].base_quantity_num)
    || requested.baseQuantityDenominator !== Number(stored[0].base_quantity_den)) {
    throw new HttpError(409, '加工费采购订单仅允许修改商业字段，来源、供应商、货品、数量及单位不可变', { code: 'PROCESSING_PO_SOURCE_IMMUTABLE' });
  }
  db.prepare(`UPDATE purchase_orders SET total_cents=?,remark=?,status='DRAFT',rejection_reason='',updated_at=?,
      order_date=?,expected_delivery_date=?,payment_terms=?,payment_terms_days=?,supplier_contact_name=?,supplier_contact_phone=?,supplier_address=?
    WHERE id=?`).run(
    input.totalCents, input.remark, now, input.orderDate, input.expectedDeliveryDate, input.paymentTerms, input.paymentTermsDays,
    input.supplierContactName, input.supplierContactPhone, input.supplierAddress, orderId,
  );
  db.prepare('UPDATE purchase_order_items SET unit_price_cents=?,amount_cents=?,is_gift_line=? WHERE id=?')
    .run(requested.unitPriceCents, requested.amountCents, requested.isGiftLine, stored[0].id);
  audit(db, actor.id, 'UPDATE', 'PURCHASE_ORDER', orderId, `修改加工费采购订单商业字段 ${order.order_no}`);
  return { itemId: stored[0].id };
}

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
  const action = normalizeAction(body.action);
  const changeId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.orderId);
    if (!order) throw new HttpError(404, '采购订单不存在');
    assertProcessingPurchaseOrderChangeAllowed(order);
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
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
    if (!order) throw new HttpError(404, '采购订单不存在');
    assertProcessingPurchaseOrderChangeAllowed(order);
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
  const now = new Date().toISOString();
  transaction(db, () => {
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
    if (!order) throw new HttpError(404, '采购订单不存在');
    assertProcessingPurchaseOrderChangeAllowed(order);
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
