import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { roundRational } from './commercial-golive.js';
import { resolvePurchaseLinePricing } from './procurement-pricing.js';

const VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_MANAGE'];
const CHANGE_PERMISSIONS = ['PO_CHANGE_VIEW', 'PO_CHANGE_MANAGE'];
const STANDARD_BUY_TYPES = new Set(['STANDARD_PURCHASE']);
const BUSINESS_TYPES = new Set(['STANDARD_PURCHASE', 'OUTSOURCE_PROCESSING']);
const ACTIONS = new Set(['ADD', 'MODIFY', 'CANCEL']);

function insertPurchaseOrderItem(db, { id: itemId, orderId, item, lineNo, pricing, version = 1 }) {
  db.prepare(`INSERT INTO purchase_order_items(
      id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_requisition_item_id,is_gift_line,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,
      pricing_uom_code,pricing_quantity_num,pricing_quantity_den,price_entry_id,price_version,pricing_evidence_json,version,execution_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    itemId, orderId, item.productId, Number(item.quantity), pricing.unitPriceCents, pricing.amountCents,
    lineNo, item.purchaseRequisitionItemId || null, item.isGiftLine ? 1 : 0,
    item.documentUomCode || null,
    item.documentQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.documentQuantityDenominator ?? 1,
    item.conversionNumerator ?? 1, item.conversionDenominator ?? 1,
    item.baseQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.baseQuantityDenominator ?? 1,
    pricing.pricingUomCode || null,
    pricing.pricingQuantityNum ?? null, pricing.pricingQuantityDen ?? null,
    pricing.priceEntryId || null, pricing.priceVersion ?? null,
    pricing.evidence ? JSON.stringify(pricing.evidence) : null, version, 'OPEN',
  );
}

/**
 * Resolve the authoritative commercial price of one purchase order line.
 *
 * `PURCHASE_RESOLVER` is the only mode an ordinary purchase order may use:
 * the effective supplier price, the discount and the rounding evidence are
 * resolved inside the write transaction and frozen onto the line. A client
 * supplied unit price is only an assertion — it must agree with the resolved
 * price or the write is rejected (Active Design §26.36.3).
 *
 * `FROZEN_COMMERCIAL` belongs to the processing-fee purchase order, whose
 * commercial amount is locked by the approved outsourcing contract and must
 * never be replaced by the ordinary purchase price list.
 */
function resolveOrderLineCommercial(db, { businessType, supplierId, businessDate, item, index }) {
  if (businessType === 'OUTSOURCE_PROCESSING') {
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0
      || !Number.isSafeInteger(item.amountCents) || item.amountCents < 0) {
      throw new HttpError(400, `第 ${index + 1} 行金额必须为安全整数分`);
    }
    return {
      unitPriceCents: item.unitPriceCents, amountCents: item.amountCents,
      pricingUomCode: item.pricingUomCode || null, pricingQuantityNum: null, pricingQuantityDen: null,
      priceEntryId: null, priceVersion: null, evidence: item.pricingEvidence || null,
    };
  }
  const pricing = resolvePurchaseLinePricing(db, {
    supplierId, productId: item.productId, sourceType: 'PURCHASE',
    businessDate: businessDate || new Date().toISOString().slice(0, 10),
    documentUomCode: item.documentUomCode,
    documentQuantity: {
      num: item.documentQuantityNumerator ?? item.quantity,
      den: item.documentQuantityDenominator ?? 1,
    },
    explicitPriceEntryId: item.priceEntryId || undefined,
    giftLine: Boolean(item.isGiftLine),
  });
  if (item.assertedUnitPriceCents !== undefined && item.assertedUnitPriceCents !== null
    && Number(item.assertedUnitPriceCents) !== Number(pricing.unitPriceCents)) {
    throw new HttpError(409, `第 ${index + 1} 行客户端单价与权威价格不一致`, { code: 'PURCHASE_PRICE_EVIDENCE_MISMATCH' });
  }
  return {
    unitPriceCents: pricing.unitPriceCents, amountCents: pricing.grossCents,
    pricingUomCode: pricing.pricingUomCode,
    pricingQuantityNum: pricing.pricingQuantity ? pricing.pricingQuantity.num : null,
    pricingQuantityDen: pricing.pricingQuantity ? pricing.pricingQuantity.den : null,
    priceEntryId: pricing.priceEntryId, priceVersion: pricing.priceVersion, evidence: pricing,
  };
}

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
  const orderId = command.id || randomUUID();
  const orderNo = command.orderNo || `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const now = command.now || new Date().toISOString();
  const pricedItems = command.items.map((item, index) => ({
    item,
    commercial: resolveOrderLineCommercial(db, {
      businessType, supplierId: command.supplierId, businessDate: command.orderDate, item, index,
    }),
  }));
  const totalCents = pricedItems.reduce((sum, entry) => sum + entry.commercial.amountCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new HttpError(400, '采购订单总额必须为安全整数分');
  db.prepare(`INSERT INTO purchase_orders(
      id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,
      order_date,expected_delivery_date,payment_terms,payment_terms_days,supplier_contact_name,supplier_contact_phone,supplier_address,
      business_type,source_outsourcing_order_id,supplier_contact_snapshot,supplier_address_snapshot,payment_terms_snapshot,purchase_requisition_id)
    VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    orderId, orderNo, command.supplierId, totalCents, command.remark || '', actor.id, now, now,
    command.orderDate || null, command.expectedDeliveryDate || null, command.paymentTerms || '', command.paymentTermsDays ?? null,
    command.supplierContactName || '', command.supplierContactPhone || '', command.supplierAddress || '',
    businessType, sourceOutsourcingOrderId, command.supplierContactSnapshot || '', command.supplierAddressSnapshot || '',
    command.paymentTermsSnapshot || '', command.purchaseRequisitionId || null,
  );
  for (const [index, entry] of pricedItems.entries()) {
    insertPurchaseOrderItem(db, {
      id: entry.item.id || randomUUID(), orderId, item: entry.item, lineNo: entry.item.lineNo || index + 1,
      pricing: entry.commercial,
    });
  }
  audit(db, actor.id, command.auditAction || 'CREATE', 'PURCHASE_ORDER', orderId,
    command.auditDetail || `创建采购订单 ${orderNo}`);
  return { id: orderId, orderNo, totalCents };
}

/**
 * Canonical rewrite of the lines of a DRAFT purchase order.
 *
 * A draft line has no approved commercial history, so the rewrite is allowed
 * to replace the lines — but never a line that already carries an applied
 * change version, because that version is immutable history.
 */
export function replacePurchaseOrderItemsCanonical(db, { orderId, items, businessType, supplierId, businessDate }) {
  const versioned = db.prepare('SELECT COUNT(*) n FROM purchase_order_item_versions WHERE order_id=?').get(orderId).n;
  if (Number(versioned) > 0) {
    throw new HttpError(409, '采购订单行存在已应用的变更历史，不可整体改写', { code: 'PO_ITEM_VERSION_HISTORY_EXISTS' });
  }
  const pricedItems = items.map((item, index) => ({
    item,
    commercial: resolveOrderLineCommercial(db, {
      businessType, supplierId, businessDate, item, index,
    }),
  }));
  db.prepare('DELETE FROM purchase_order_items WHERE order_id=?').run(orderId);
  for (const [index, entry] of pricedItems.entries()) {
    insertPurchaseOrderItem(db, {
      id: entry.item.id || randomUUID(), orderId, item: entry.item, lineNo: entry.item.lineNo || index + 1,
      pricing: entry.commercial,
    });
  }
  const totalCents = pricedItems.reduce((sum, entry) => sum + entry.commercial.amountCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new HttpError(400, '采购订单总额必须为安全整数分');
  db.prepare('UPDATE purchase_orders SET total_cents=? WHERE id=?').run(totalCents, orderId);
  return { totalCents };
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
function assertChangeApprovePermission(actor) { allow(actor, 'PURCHASE_ORDERS_APPROVE'); }

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
    scope: row.scope || 'LINE',
    orderVersionBefore: row.order_version_before,
    idempotencyKey: row.idempotency_key,
    snapshotBefore: row.snapshot_before_json ? JSON.parse(row.snapshot_before_json) : null,
    snapshotAfter: row.snapshot_after_json ? JSON.parse(row.snapshot_after_json) : null,
  };
}

function stableFingerprint(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    return input;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function orderSnapshot(db, orderId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no,id').all(orderId);
  return { order, items, execution: getPurchaseOrderExecution(db, orderId) };
}

function saveItemVersion(db, item, changeId, actorId, now) {
  db.prepare(`INSERT INTO purchase_order_item_versions(id,order_item_id,order_id,version,snapshot_json,source_change_id,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), item.id, item.order_id, Number(item.version || 1), JSON.stringify(item), changeId || null, actorId, now);
}

function recalculateOrderTotal(db, orderId) {
  const total = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM purchase_order_items WHERE order_id=? AND COALESCE(execution_status,'OPEN')='OPEN'").get(orderId).total || 0);
  if (!Number.isSafeInteger(total)) throw new HttpError(409, '采购订单总额超出安全整数范围', { code: 'PURCHASE_ORDER_TOTAL_UNSAFE' });
  db.prepare('UPDATE purchase_orders SET total_cents=? WHERE id=?').run(total, orderId);
  return total;
}

function resolveChangeLinePricing(db, order, payload, currentItem = null) {
  const productId = payload.productId || currentItem?.product_id;
  const product = db.prepare('SELECT id,base_uom_code,unit FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(409, '采购订单变更产品不存在或已停用', { code: 'PO_CHANGE_PRODUCT_INVALID' });
  const documentUomCode = payload.documentUomCode || currentItem?.document_uom_code || product.base_uom_code || product.unit || 'EA';
  const item = {
    productId,
    quantity: Number(payload.quantity),
    documentUomCode,
    documentQuantityNumerator: payload.quantityNumerator ?? payload.quantity,
    documentQuantityDenominator: payload.quantityDenominator ?? 1,
    isGiftLine: Boolean(payload.isGiftLine ?? currentItem?.is_gift_line),
    assertedUnitPriceCents: payload.unitPriceCents,
    priceEntryId: payload.priceEntryId || undefined,
  };
  return resolveOrderLineCommercial(db, {
    businessType: 'STANDARD_PURCHASE', supplierId: order.supplier_id, businessDate: order.order_date, item, index: 0,
  });
}

function normalizeChangeRequest(body) {
  const payload = body.payload || {};
  const request = {
    action: normalizeAction(body.action),
    scope: String(body.scope || (body.action && String(body.action).toUpperCase() === 'CANCEL' && !payload.orderItemId ? 'HEADER' : 'LINE')).toUpperCase(),
    orderId: body.orderId,
    target: null,
    add: null,
  };
  if (request.action === 'ADD') {
    request.add = {
      productId: payload.productId || null,
      quantity: payload.quantity ?? null,
      quantityNumerator: payload.quantityNumerator ?? null,
      quantityDenominator: payload.quantityDenominator ?? null,
      documentUomCode: payload.documentUomCode || null,
      unitPriceCents: payload.unitPriceCents ?? null,
      priceEntryId: payload.priceEntryId || null,
      isGiftLine: Boolean(payload.isGiftLine),
      lineNo: payload.lineNo ?? null,
    };
    return request;
  }
  if (request.action === 'MODIFY') {
    request.target = {
      orderItemId: payload.orderItemId || null,
      quantity: payload.quantity ?? null,
      quantityNumerator: payload.quantityNumerator ?? null,
      quantityDenominator: payload.quantityDenominator ?? null,
      documentUomCode: payload.documentUomCode || null,
      unitPriceCents: payload.unitPriceCents ?? null,
      priceEntryId: payload.priceEntryId || null,
      isGiftLine: payload.isGiftLine ?? null,
    };
    return request;
  }
  request.target = { orderItemId: payload.orderItemId || null };
  return request;
}

/**
 * Canonical PO Execution Read Model — single source of truth for
 * ordered / notified / received / returned / reserved / remaining.
 *
 * Every consumer (MRP, Planner Workbench, Planning reservation, Receiving,
 * PO Change) reads this model. No consumer may assemble its own PO quantity
 * SQL: a second口径 would silently diverge from the applied commercial truth
 * (Active Design §26.36.5).
 */
function loadOrderExecutionFacts(db, orderId) {
  const noticeRows = db.prepare(`SELECT rni.purchase_order_item_id item_id, COALESCE(SUM(rni.quantity),0) qty
    FROM receipt_notices rn JOIN receipt_notice_items rni ON rni.notice_id=rn.id
    WHERE rn.purchase_order_id=? AND rn.status<>'CANCELLED' GROUP BY rni.purchase_order_item_id`).all(orderId);
  const noticeMap = new Map(noticeRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  const receivedRows = db.prepare(`SELECT pri.purchase_order_item_id item_id, COALESCE(SUM(pri.quantity),0) qty
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id=pr.id
    WHERE pr.purchase_order_id=? AND pr.status='CONFIRMED' AND pri.purchase_order_item_id IS NOT NULL
    GROUP BY pri.purchase_order_item_id`).all(orderId);
  const receivedMap = new Map(receivedRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  // Historical receipts may only reference the PO header. Their product total
  // is allocated deterministically across the matching lines without ever
  // rewriting history; new receipts always carry the authoritative line FK.
  const legacyReceivedRows = db.prepare(`SELECT pri.product_id, COALESCE(SUM(pri.quantity),0) qty
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id=pr.id
    WHERE pr.purchase_order_id=? AND pr.status='CONFIRMED' AND pri.purchase_order_item_id IS NULL
    GROUP BY pri.product_id`).all(orderId);
  const legacyReceived = new Map(legacyReceivedRows.map((row) => [row.product_id, Number(row.qty || 0)]));
  const returnedRows = db.prepare(`SELECT prei.purchase_order_item_id item_id, COALESCE(SUM(prti.quantity),0) qty
    FROM purchase_returns pr JOIN purchase_receipts prh ON prh.id=pr.receipt_id
    JOIN purchase_return_items prti ON prti.return_id=pr.id
    JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id
    WHERE prh.purchase_order_id=? AND pr.status='CONFIRMED' AND prei.purchase_order_item_id IS NOT NULL
    GROUP BY prei.purchase_order_item_id`).all(orderId);
  const returnedMap = new Map(returnedRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  const legacyReturnedRows = db.prepare(`SELECT prti.product_id, COALESCE(SUM(prti.quantity),0) qty
    FROM purchase_returns pr JOIN purchase_receipts prh ON prh.id=pr.receipt_id
    JOIN purchase_return_items prti ON prti.return_id=pr.id
    LEFT JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id
    WHERE prh.purchase_order_id=? AND pr.status='CONFIRMED' AND prei.purchase_order_item_id IS NULL
    GROUP BY prti.product_id`).all(orderId);
  const legacyReturned = new Map(legacyReturnedRows.map((row) => [row.product_id, Number(row.qty || 0)]));
  const reservationRows = db.prepare(`SELECT COALESCE(supply_source_line_id,'') line_id, product_id, COALESCE(SUM(quantity),0) quantity
    FROM planning_reservations
    WHERE supply_source_type='PURCHASE_ORDER' AND supply_source_id=? AND status='ACTIVE'
    GROUP BY COALESCE(supply_source_line_id,''), product_id`).all(orderId);
  const scheduleRows = db.prepare(`SELECT order_item_id item_id, COALESCE(SUM(planned_quantity - received_quantity),0) qty
    FROM purchase_order_delivery_schedules WHERE order_id=? GROUP BY order_item_id`).all(orderId);
  return {
    noticeMap, receivedMap, legacyReceived, returnedMap, legacyReturned,
    reservations: reservationRows.map((row) => ({
      lineId: row.line_id || null,
      productId: row.product_id,
      quantity: Number(row.quantity || 0),
    })),
    scheduleMap: new Map(scheduleRows.map((row) => [row.item_id, Number(row.qty || 0)])),
  };
}

function takeFromPool(pool, productId, capacity) {
  const available = Number(pool.get(productId) || 0);
  const taken = Math.min(Math.max(0, capacity), available);
  pool.set(productId, Math.max(0, available - taken));
  return taken;
}

function buildLineExecution(order, item, facts) {
  const ordered = Number(item.quantity);
  const notified = Number(facts.noticeMap.get(item.id) || 0);
  const linkedReceived = Number(facts.receivedMap.get(item.id) || 0);
  const legacyReceived = takeFromPool(facts.legacyReceived, item.product_id, Math.max(0, ordered - linkedReceived));
  const received = linkedReceived + legacyReceived;
  const linkedReturned = Number(facts.returnedMap.get(item.id) || 0);
  const legacyReturned = takeFromPool(facts.legacyReturned, item.product_id, Math.max(0, ordered - linkedReturned));
  const returned = linkedReturned + legacyReturned;
  const cancelled = (item.execution_status || 'OPEN') === 'CANCELLED';
  const reserved = facts.reservations
    .filter((row) => row.productId === item.product_id && (!row.lineId || row.lineId === item.id))
    .reduce((total, row) => total + row.quantity, 0);
  const scheduled = Number(facts.scheduleMap.get(item.id) || 0);
  const remaining = cancelled ? 0 : Math.max(0, ordered - received);
  return {
    orderId: order.id,
    orderItemId: item.id,
    lineNo: Number(item.line_no || 0),
    productId: item.product_id,
    businessType: order.business_type || 'STANDARD_PURCHASE',
    eligibleForBuySupply: (order.business_type || 'STANDARD_PURCHASE') === 'STANDARD_PURCHASE',
    ordered, notified, received, returned, reserved, scheduled,
    cancelled, remaining, availableRemaining: Math.max(0, remaining - reserved),
    version: Number(item.version || 1),
    executionStatus: cancelled ? 'CANCELLED'
      : remaining > 0 ? (received > 0 ? 'PARTIALLY_RECEIVED' : 'OPEN') : 'FULFILLED',
  };
}

/**
 * Line-level canonical execution across the purchase order supply.
 *
 * `includeClosed=false` keeps only the lines that still contribute open
 * supply. A cancelled line never contributes; an `OUTSOURCE_PROCESSING` order
 * is never eligible for BUY supply.
 */
export function getPurchaseOrderLineExecution(db, {
  orderId = null, orderItemId = null, productId = null, supplierId = null, includeClosed = false,
} = {}) {
  const conditions = [];
  const params = [];
  if (orderId) { conditions.push('po.id=?'); params.push(orderId); }
  if (orderItemId) { conditions.push('poi.id=?'); params.push(orderItemId); }
  if (productId) { conditions.push('poi.product_id=?'); params.push(productId); }
  if (supplierId) { conditions.push('po.supplier_id=?'); params.push(supplierId); }
  const rows = db.prepare(`SELECT poi.*, po.id order_id, po.order_no, po.supplier_id, po.status order_status,
      po.business_type, po.expected_delivery_date, po.order_date, po.created_at order_created_at
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.order_id
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    ORDER BY po.id, poi.line_no, poi.id`).all(...params);
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.order_id)) {
      orders.set(row.order_id, {
        order: {
          id: row.order_id, order_no: row.order_no, supplier_id: row.supplier_id,
          status: row.order_status, business_type: row.business_type,
          expected_delivery_date: row.expected_delivery_date, order_date: row.order_date,
        },
        items: [],
      });
    }
    orders.get(row.order_id).items.push(row);
  }
  const lines = [];
  for (const entry of orders.values()) {
    const facts = loadOrderExecutionFacts(db, entry.order.id);
    for (const item of entry.items) lines.push(buildLineExecution(entry.order, item, facts));
  }
  if (includeClosed) return lines;
  return lines.filter((line) => !line.cancelled && line.remaining > 0);
}

export function getPurchaseOrderExecution(db, orderId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const facts = loadOrderExecutionFacts(db, orderId);
  const executionItems = items.map((item) => buildLineExecution(order, item, facts));
  const aggregate = executionItems.reduce((acc, item) => ({
    ordered: acc.ordered + item.ordered,
    notified: acc.notified + item.notified,
    received: acc.received + item.received,
    returned: acc.returned + item.returned, reserved: acc.reserved + item.reserved,
    scheduled: acc.scheduled + item.scheduled,
    remaining: acc.remaining + item.remaining,
    availableRemaining: acc.availableRemaining + item.availableRemaining,
  }), { ordered: 0, notified: 0, received: 0, returned: 0, reserved: 0, scheduled: 0, remaining: 0, availableRemaining: 0 });
  return {
    orderId,
    businessType: order.business_type || 'STANDARD_PURCHASE',
    eligibleForBuySupply: (order.business_type || 'STANDARD_PURCHASE') === 'STANDARD_PURCHASE',
    status: executionItems.length && executionItems.every((item) => item.cancelled) ? 'CANCELLED'
      : executionItems.length && executionItems.every((item) => item.remaining === 0) ? 'FULFILLED'
        : executionItems.some((item) => item.received > 0) ? 'PARTIALLY_RECEIVED' : order.status,
    items: executionItems,
    aggregate,
  };
}

export function listOpenRemainingBySupplierProduct(db, supplierId, productId) {
  return getPurchaseOrderLineExecution(db, { supplierId, productId })
    .filter((line) => line.eligibleForBuySupply)
    .map((line) => ({
      order_id: line.orderId, order_item_id: line.orderItemId, ordered: line.ordered,
      received: line.received, returned: line.returned, reserved: line.reserved,
      remaining: line.remaining, available_remaining: line.availableRemaining,
    }));
}

export function listStandardPurchaseSupplyByProduct(db, productId, { expectedThrough = null } = {}) {
  const rows = db.prepare(`SELECT DISTINCT po.id FROM purchase_orders po JOIN purchase_order_items poi ON poi.order_id=po.id
    WHERE poi.product_id=? AND po.status='APPROVED'
      AND (po.business_type IS NULL OR po.business_type='STANDARD_PURCHASE')`).all(productId);
  const lines = [];
  for (const { id: orderId } of rows) {
    const execution = getPurchaseOrderExecution(db, orderId);
    if (!execution.eligibleForBuySupply) continue;
    if (expectedThrough) {
      const order = db.prepare('SELECT expected_delivery_date,order_date,created_at FROM purchase_orders WHERE id=?').get(orderId);
      const dueDate = order.expected_delivery_date || order.order_date || String(order.created_at || '').slice(0, 10);
      if (!dueDate || dueDate > expectedThrough) continue;
    }
    for (const line of execution.items) {
      if (line.productId !== productId || line.remaining <= 0) continue;
      lines.push({ orderId, ...line });
    }
  }
  return lines;
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
  assertAllowedFields(body, ['orderId', 'action', 'payload', 'scope', 'idempotencyKey']);
  const request = normalizeChangeRequest(body);
  if (!['HEADER', 'LINE'].includes(request.scope)) throw new HttpError(400, '变更范围不正确');
  if (request.action === 'ADD' && request.scope !== 'LINE') throw new HttpError(400, '新增行变更只能是行级范围');
  if (request.action === 'CANCEL' && request.scope === 'LINE' && !request.target?.orderItemId) {
    throw new HttpError(400, '行级取消必须指定 orderItemId');
  }
  const idempotencyKey = String(body.idempotencyKey || '').trim() || null;
  const fingerprint = stableFingerprint(request);
  const changeId = randomUUID(); const now = new Date().toISOString();
  let replay = null;
  try {
    transaction(db, () => {
      if (idempotencyKey) {
        const existing = db.prepare('SELECT * FROM purchase_order_changes WHERE created_by=? AND idempotency_key=?').get(actor.id, idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new HttpError(409, '幂等键已用于不同采购变更', { code: 'PO_CHANGE_IDEMPOTENCY_CONFLICT' });
          }
          replay = existing;
          return;
        }
      }
      const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.orderId);
      if (!order) throw new HttpError(404, '采购订单不存在');
      assertProcessingPurchaseOrderChangeAllowed(order);
      if (order.status !== 'APPROVED') throw new HttpError(409, '只有已批准采购订单可以创建正式变更', { code: 'PO_CHANGE_ORDER_STATE_INVALID' });
      const before = orderSnapshot(db, body.orderId);
      const payload = body.payload || {};
      const target = request.target?.orderItemId ? before.items.find((item) => item.id === request.target.orderItemId) : null;
      if (request.scope === 'LINE' && request.action !== 'ADD' && !target) throw new HttpError(404, '采购订单变更目标行不存在');
      const lineNo = Number(request.add?.lineNo ?? target?.line_no ?? (before.items.length + 1));
      db.prepare(`INSERT INTO purchase_order_changes(id,order_id,action,status,payload_json,original_json,requested_json,created_by,created_at,
        scope,order_version_before,idempotency_key,request_fingerprint,snapshot_before_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(changeId, body.orderId, request.action, 'DRAFT', JSON.stringify(payload), JSON.stringify(before),
        JSON.stringify(request), actor.id, now, request.scope, Number(order.version || 1), idempotencyKey, fingerprint, JSON.stringify(before), now);
      db.prepare(`INSERT INTO po_change_items(id,change_id,order_item_id,line_no,action,requested_json,snapshot_before_json)
        VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), changeId, target?.id || null, lineNo, request.action,
        JSON.stringify(request), target ? JSON.stringify(target) : null);
      audit(db, actor.id, 'CREATE', 'PO_CHANGE', changeId, `${body.orderId}:${request.action}`);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'PO_CHANGE', entityId: body.orderId, action: '创建采购订单变更' }, error);
    throw error;
  }
  if (replay) return send(res, 200, { id: replay.id, replay: true });
  return send(res, 201, { id: changeId });
}

export async function approvePurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeApprovePermission(actor);
  const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
  if (!change) throw new HttpError(404, '变更单不存在');
  if (change.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以审核');
  if (change.created_by === actor.id) throw new HttpError(409, '采购订单变更申请人不能审批自己的申请', { code: 'PO_CHANGE_SELF_APPROVAL_FORBIDDEN' });
  const now = new Date().toISOString();
  transaction(db, () => {
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
    if (!order) throw new HttpError(404, '采购订单不存在');
    assertProcessingPurchaseOrderChangeAllowed(order);
    if (Number(order.version || 1) !== Number(change.order_version_before || 1)) throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
    db.prepare('UPDATE purchase_order_changes SET status=?, approver_id=?, approved_at=?,updated_at=? WHERE id=?').run('APPROVED', actor.id, now, now, changeId);
    audit(db, actor.id, 'APPROVE', 'PO_CHANGE', changeId, '');
  });
  return send(res, 200, { ok: true });
}

export async function applyPurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeManagePermission(actor);
  const now = new Date().toISOString();
  let after = null;
  let replay = false;
  try {
    transaction(db, () => {
      const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
      if (!change) throw new HttpError(404, '变更单不存在');
      if (change.status === 'APPLIED') {
        after = change.snapshot_after_json ? JSON.parse(change.snapshot_after_json) : null;
        replay = true;
        return;
      }
      if (change.status !== 'APPROVED') throw new HttpError(409, '只有已审核的变更单可以应用');
      const changeItem = db.prepare('SELECT * FROM po_change_items WHERE change_id=? ORDER BY line_no LIMIT 1').get(changeId);
      if (!changeItem) throw new HttpError(409, '采购订单变更缺少变更明细', { code: 'PO_CHANGE_ITEM_MISSING' });
      const request = JSON.parse(changeItem.requested_json);
      const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
      if (!order) throw new HttpError(404, '采购订单不存在');
      assertProcessingPurchaseOrderChangeAllowed(order);
      if (order.status !== 'APPROVED') throw new HttpError(409, '采购订单状态已变化', { code: 'PO_CHANGE_ORDER_STATE_INVALID' });
      if (Number(order.version || 1) !== Number(change.order_version_before || 1)) {
        throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
      }
      const execution = getPurchaseOrderExecution(db, change.order_id);
      if (change.action === 'ADD') {
        const requested = request.add || {};
        const quantity = Number(requested.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '新增行数量不正确');
        const commercial = resolveChangeLinePricing(db, order, requested);
        const maxLineNo = Number(db.prepare('SELECT COALESCE(MAX(line_no),0) n FROM purchase_order_items WHERE order_id=?').get(change.order_id).n || 0);
        const lineNo = Number(requested.lineNo || maxLineNo + 1);
        if (db.prepare('SELECT 1 FROM purchase_order_items WHERE order_id=? AND line_no=?').get(change.order_id, lineNo)) {
          throw new HttpError(409, '新增行行号已存在', { code: 'PO_CHANGE_LINE_NO_CONFLICT' });
        }
        const itemId = randomUUID();
        insertPurchaseOrderItem(db, {
          id: itemId, orderId: change.order_id,
          item: {
            productId: requested.productId, quantity, documentUomCode: requested.documentUomCode,
            documentQuantityNumerator: requested.quantityNumerator ?? quantity,
            documentQuantityDenominator: requested.quantityDenominator ?? 1,
            isGiftLine: Boolean(requested.isGiftLine),
          },
          lineNo, pricing: commercial,
        });
        saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(itemId), changeId, actor.id, now);
      } else if (change.action === 'MODIFY') {
        const requested = request.target || {};
        if (!requested.orderItemId) throw new HttpError(400, 'MODIFY 必须提供 orderItemId');
        const target = execution.items.find((item) => item.orderItemId === requested.orderItemId);
        if (!target) throw new HttpError(404, '订单明细不存在');
        const currentItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(requested.orderItemId);
        if (!currentItem) throw new HttpError(404, '订单明细不存在');
        if (!currentItem.pricing_evidence_json) {
          throw new HttpError(409, '历史采购行缺少冻结价格证据，不能直接商业变更', { code: 'PO_CHANGE_PRICE_EVIDENCE_MISSING' });
        }
        const newQty = Number(requested.quantity);
        if (!Number.isFinite(newQty) || newQty <= 0) throw new HttpError(400, '变更数量不正确');
        const committed = target.received + target.reserved;
        if (newQty < committed) {
          throw new HttpError(409, `新数量不能低于已执行或已冻结数量 ${committed}`, { code: 'PO_CHANGE_EXECUTION_FLOOR_EXCEEDED' });
        }
        const commercial = resolveChangeLinePricing(db, order, requested, currentItem);
        const updated = db.prepare(`UPDATE purchase_order_items SET quantity=?,unit_price_cents=?,amount_cents=?,
          document_uom_code=?,document_quantity_num=?,document_quantity_den=?,conversion_numerator=?,conversion_denominator=?,
          base_quantity_num=?,base_quantity_den=?,pricing_uom_code=?,pricing_quantity_num=?,pricing_quantity_den=?,
          price_entry_id=?,price_version=?,pricing_evidence_json=?,version=version+1
          WHERE id=? AND version=? AND COALESCE(execution_status,'OPEN')='OPEN'`).run(
          newQty, commercial.unitPriceCents, commercial.amountCents,
          commercial.evidence?.documentUomCode ?? currentItem.document_uom_code,
          commercial.evidence?.documentQuantity?.num ?? currentItem.document_quantity_num,
          commercial.evidence?.documentQuantity?.den ?? currentItem.document_quantity_den,
          commercial.evidence?.conversion?.num ?? currentItem.conversion_numerator,
          commercial.evidence?.conversion?.den ?? currentItem.conversion_denominator,
          commercial.evidence?.baseQuantity?.num ?? currentItem.base_quantity_num,
          commercial.evidence?.baseQuantity?.den ?? currentItem.base_quantity_den,
          commercial.pricingUomCode, commercial.pricingQuantityNum, commercial.pricingQuantityDen,
          commercial.priceEntryId, commercial.priceVersion, JSON.stringify(commercial.evidence), requested.orderItemId, target.version,
        );
        if (Number(updated.changes || updated.affectedRows) !== 1) {
          throw new HttpError(409, '采购订单行版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
        }
        saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(requested.orderItemId), changeId, actor.id, now);
      } else if (change.action === 'CANCEL') {
        const targets = change.scope === 'HEADER'
          ? execution.items
          : execution.items.filter((item) => item.orderItemId === request.target?.orderItemId);
        if (!targets.length) throw new HttpError(404, '取消目标不存在');
        for (const target of targets) {
          if (target.received > 0 || target.notified > 0 || target.reserved > 0 || target.scheduled > 0) {
            throw new HttpError(409, '存在已执行、通知、预留或交期事实，不能取消', { code: 'PO_CHANGE_CANCEL_EXECUTED' });
          }
          if (target.cancelled) throw new HttpError(409, '目标行已取消', { code: 'PO_CHANGE_LINE_ALREADY_CANCELLED' });
          const item = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(target.orderItemId);
          const result = db.prepare("UPDATE purchase_order_items SET execution_status='CANCELLED',version=version+1 WHERE id=? AND version=? AND COALESCE(execution_status,'OPEN')='OPEN'")
            .run(item.id, Number(item.version || 1));
          if (Number(result.changes || result.affectedRows) !== 1) {
            throw new HttpError(409, '采购订单行版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
          }
          saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(item.id), changeId, actor.id, now);
        }
        if (change.scope === 'HEADER') {
          db.prepare("UPDATE purchase_orders SET status='CANCELLED',updated_at=? WHERE id=? AND status='APPROVED'").run(now, change.order_id);
        }
      }
      const total = recalculateOrderTotal(db, change.order_id);
      const orderUpdate = db.prepare('UPDATE purchase_orders SET version=version+1,updated_at=? WHERE id=? AND version=?').run(now, change.order_id, order.version);
      if (Number(orderUpdate.changes || orderUpdate.affectedRows) !== 1) {
        throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
      }
      after = orderSnapshot(db, change.order_id);
      db.prepare('UPDATE po_change_items SET snapshot_after_json=? WHERE change_id=?').run(JSON.stringify(after), changeId);
      db.prepare('UPDATE purchase_order_changes SET status=?,applied_json=?,snapshot_after_json=?,applied_at=?,applied_by=?,updated_at=? WHERE id=?')
        .run('APPLIED', JSON.stringify({ totalCents: total }), JSON.stringify(after), now, actor.id, now, changeId);
      audit(db, actor.id, 'APPLY', 'PO_CHANGE', changeId, change.action);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'PO_CHANGE', entityId: changeId, action: '应用采购订单变更' }, error);
    throw error;
  }
  return send(res, 200, { ok: true, applied: after, replay });
}

export function listPurchaseOrderChanges(db, res, actor, orderId) {
  assertViewPermission(actor);
  const changes = db.prepare('SELECT * FROM purchase_order_changes WHERE order_id=? ORDER BY created_at DESC').all(orderId).map(rowToChange);
  const itemRows = db.prepare('SELECT * FROM po_change_items WHERE change_id=? ORDER BY line_no').all(...changes.map((change) => change.id));
  const itemsByChange = new Map();
  for (const row of itemRows) {
    if (!itemsByChange.has(row.change_id)) itemsByChange.set(row.change_id, []);
    itemsByChange.get(row.change_id).push({
      id: row.id,
      orderItemId: row.order_item_id,
      lineNo: Number(row.line_no || 0),
      action: row.action,
      requested: JSON.parse(row.requested_json),
      snapshotBefore: row.snapshot_before_json ? JSON.parse(row.snapshot_before_json) : null,
      snapshotAfter: row.snapshot_after_json ? JSON.parse(row.snapshot_after_json) : null,
    });
  }
  for (const change of changes) change.items = itemsByChange.get(change.id) || [];
  return send(res, 200, { changes });
}

export function getPurchaseOrderExecutionView(db, res, actor, orderId) {
  assertViewPermission(actor);
  return send(res, 200, { execution: getPurchaseOrderExecution(db, orderId) });
}
