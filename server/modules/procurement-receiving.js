import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { requireActiveReference } from './logistics-core.js';
import {
  NOTICE_ERROR_CODES, auditBusinessRejection, noticeBusinessError,
  resolveDeliveryScheduleBinding, resolveDeliveryScheduleCapacity, resolveNoticeItemCapacity,
  resolveOutsourcingOrderCapacity, resolvePurchaseOrderLineCapacity,
  sumOutsourcingNoticeQtyByStatus,
} from './procurement-notice-capacity.js';

const NOTICE_PERMISSIONS = ['RECEIPT_NOTICE_VIEW', 'RECEIPT_NOTICE_MANAGE'];
const PO_VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_MANAGE'];
const NOTICE_CREATE_OPERATION = 'RECEIPT_NOTICE_CREATE';
const EPSILON = 1e-9;

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
  return sumOutsourcingNoticeQtyByStatus(db, outsourcingOrderId, statuses);
}

/** Sum the qty of all CONFIRMED / EFFECTED receipts against an
 * Outsourcing Order — the canonical implementation now lives in
 * server/modules/procurement-notice-capacity.js
 * (resolveOutsourcingOrderCapacity), which also proves the effectiveness of
 * every historical receipt instead of assuming it. */

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
  // The line level source rows carry the traceable provenance and the
  // cumulative converted quantity of every allocated source row.
  const sources = db.prepare(`SELECT s.* FROM receipt_notice_item_sources s
    JOIN receipt_notice_items i ON i.id = s.notice_item_id
    WHERE i.notice_id=? ORDER BY s.id`).all(noticeId);
  const byItem = new Map();
  for (const source of sources) {
    const allocated = Number(source.allocated_quantity || 0);
    const converted = source.converted_quantity === null || source.converted_quantity === undefined ? null : Number(source.converted_quantity);
    const entry = {
      id: source.id,
      noticeItemId: source.notice_item_id,
      purchaseOrderItemId: source.purchase_order_item_id,
      deliveryScheduleId: source.delivery_schedule_id,
      allocatedQuantity: allocated,
      convertedQuantity: converted,
      remainingQuantity: converted === null ? null : allocated - converted,
      convertedProven: converted !== null,
      createdAt: source.created_at,
    };
    if (!byItem.has(source.notice_item_id)) byItem.set(source.notice_item_id, []);
    byItem.get(source.notice_item_id).push(entry);
  }
  return send(res, 200, {
    receiptNotice: {
      ...rowToNotice(row),
      items: items.map((item) => ({
        ...item,
        convertedQuantity: resolveNoticeItemCapacity(db, item.id)?.convertedQuantity ?? null,
        sources: byItem.get(item.id) || [],
      })),
    },
  });
}

/**
 * Normalize the line level source allocations of one notice line.
 *
 * Two input shapes are accepted and both end up in the same authoritative
 * model:
 *   - `items[].sourceAllocations[]` : the multi purchase order form
 *   - `items[].purchaseOrderItemId`  : the compatible single order form
 *
 * When both are present they must express the same fact; a conflict is
 * rejected instead of silently preferring one of them.
 */
function normalizeLineAllocations(item, index, headerPurchaseOrderId) {
  const raw = Array.isArray(item.sourceAllocations) ? item.sourceAllocations : null;
  const legacyItemId = item.purchaseOrderItemId || null;
  if (raw && raw.length === 0) {
    throw new HttpError(400, `第 ${index + 1} 行 sourceAllocations 不能为空`);
  }
  if (raw && legacyItemId) {
    const legacyInAllocations = raw.some((allocation) => allocation?.purchaseOrderItemId === legacyItemId);
    if (!legacyInAllocations) {
      throw noticeBusinessError(
        NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN,
        `第 ${index + 1} 行的 purchaseOrderItemId 与 sourceAllocations 表示冲突的来源事实`,
      );
    }
  }
  const allocations = raw
    ? raw.map((allocation) => ({
      purchaseOrderItemId: allocation?.purchaseOrderItemId || null,
      deliveryScheduleId: allocation?.deliveryScheduleId || null,
      allocatedQuantity: Number(allocation?.allocatedQuantity),
    }))
    : [{
      purchaseOrderItemId: legacyItemId,
      deliveryScheduleId: null,
      allocatedQuantity: Number(item.quantity),
    }];
  if (!raw && !legacyItemId) {
    throw new HttpError(400, `第 ${index + 1} 行必须提供 purchaseOrderItemId 或 sourceAllocations`);
  }
  const seen = new Set();
  for (const allocation of allocations) {
    if (!allocation.purchaseOrderItemId) {
      throw new HttpError(400, `第 ${index + 1} 行来源分配缺少 purchaseOrderItemId`);
    }
    if (seen.has(allocation.purchaseOrderItemId)) {
      throw new HttpError(400, `第 ${index + 1} 行重复分配同一采购订单行`);
    }
    seen.add(allocation.purchaseOrderItemId);
    if (!Number.isFinite(allocation.allocatedQuantity) || allocation.allocatedQuantity <= 0) {
      throw new HttpError(400, `第 ${index + 1} 行来源分配数量必须为有限正数`);
    }
  }
  const total = allocations.reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0);
  const lineQuantity = Number(item.quantity);
  if (!Number.isFinite(lineQuantity) || lineQuantity <= 0) {
    throw new HttpError(400, `第 ${index + 1} 行数量必须为有限正数`);
  }
  if (Math.abs(total - lineQuantity) > EPSILON) {
    throw noticeBusinessError(
      NOTICE_ERROR_CODES.CAPACITY_EXCEEDED,
      `第 ${index + 1} 行来源分配数量合计与通知行数量不一致`,
    );
  }
  return { allocations, headerPurchaseOrderId };
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
 *
 * STANDARD_PURCHASE notices are written with their line level source rows in
 * the SAME transaction. The converted quantity of a freshly created source
 * row is explicitly initialised to 0: that 0 only proves "no conversion
 * happened for this new source row yet", it never rewrites a historical
 * unknown.
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
  requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');

  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
  const fingerprint = requestFingerprint({
    businessType, purchaseOrderId: body.purchaseOrderId ?? null, outsourcingOrderId: body.outsourcingOrderId ?? null,
    processingPoId: body.processingPoId ?? null, supplierId: body.supplierId ?? null, warehouseId: body.warehouseId ?? null,
    noticeDate: body.noticeDate ?? null, remark: body.remark ?? null, items: body.items ?? null,
  });
  const context = { entityType: 'RECEIPT_NOTICE', entityId: null, action: '创建收料通知' };
  if (idempotencyKey) {
    try {
      const replay = idempotencyReplay(db, NOTICE_CREATE_OPERATION, `create-request:${idempotencyKey}`, idempotencyKey, fingerprint);
      if (replay) return send(res, 201, { ...replay, replayed: true });
    } catch (error) {
      auditBusinessRejection(db, actor, context, error);
      throw error;
    }
  }

  let resolved = null; // { supplierId, purchaseOrderId, outsourcingOrderId, processingPoId, businessType }
  if (businessType === 'STANDARD_PURCHASE') {
    if (body.outsourcingOrderId) throw new HttpError(400, 'STANDARD_PURCHASE 通知单不允许设置 outsourcingOrderId');
    if (body.purchaseOrderId) {
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.purchaseOrderId);
      if (!po) throw new HttpError(404, '采购订单不存在');
      if (po.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以创建收货通知');
      if (po.business_type && po.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '普通收货通知仅适用于 STANDARD_PURCHASE 订单');
      if (body.supplierId && body.supplierId !== po.supplier_id) throw new HttpError(409, '供应商与采购订单不一致');
    }
    resolved = { supplierId: body.supplierId || null, purchaseOrderId: body.purchaseOrderId || null, outsourcingOrderId: null, processingPoId: null, businessType };
  } else {
    if (!body.outsourcingOrderId) throw new HttpError(400, 'OUTSOURCE 通知单必须提供 outsourcingOrderId');
    if (body.purchaseOrderId) throw new HttpError(400, 'OUTSOURCE 通知单不允许设置 purchaseOrderId');
    if (!body.processingPoId) throw new HttpError(400, 'OUTSOURCE 完工通知必须提供 processingPoId');
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.outsourcingOrderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态委外订单可创建完工通知');
    let processingPo = null;
    if (body.processingPoId) {
      processingPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.processingPoId);
      if (!processingPo) throw new HttpError(404, '处理 PO 不存在');
      if (processingPo.status !== 'APPROVED' || processingPo.business_type !== 'OUTSOURCE_PROCESSING'
        || processingPo.source_outsourcing_order_id !== order.id || processingPo.supplier_id !== order.supplier_id) {
        throw new HttpError(409, '处理 PO 与委外订单不兼容');
      }
    }
    if (body.supplierId && body.supplierId !== order.supplier_id) throw new HttpError(409, '委外订单与供应商不一致');
    resolved = { supplierId: order.supplier_id, purchaseOrderId: null, outsourcingOrderId: order.id, processingPoId: processingPo.id, businessType };
  }

  const noticeId = randomUUID(); const now = new Date().toISOString();
  const noticeNo = 'RN' + (businessType === 'OUTSOURCE' ? 'OS-' : '') + Date.now().toString().slice(-10);
  try {
    transaction(db, () => {
      if (businessType === 'OUTSOURCE') {
        const lockedOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(resolved.outsourcingOrderId);
        const lockedPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(resolved.processingPoId);
        const processingItems = lockedPo ? db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(lockedPo.id) : [];
        if (!lockedOrder || lockedOrder.status !== 'RELEASED' || !lockedPo || lockedPo.status !== 'APPROVED'
          || lockedPo.business_type !== 'OUTSOURCE_PROCESSING' || lockedPo.source_outsourcing_order_id !== lockedOrder.id
          || lockedPo.supplier_id !== lockedOrder.supplier_id || processingItems.length !== 1) {
          throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '加工费采购订单审批状态或委外来源不可证明');
        }
        // Amendment §8.1：唯一 PO Item 的产品、来源数量与 UOM 快照必须与权威委外来源一致。
        const processingItem = processingItems[0];
        const sourceProduct = db.prepare('SELECT base_uom_code,unit FROM products WHERE id=? AND active=1').get(lockedOrder.product_id);
        const baseUom = String(sourceProduct?.base_uom_code || sourceProduct?.unit || '').toUpperCase();
        const documentQuantity = Number(processingItem.document_quantity_num) / Number(processingItem.document_quantity_den);
        const baseQuantity = Number(processingItem.base_quantity_num) / Number(processingItem.base_quantity_den);
        if (!sourceProduct
          || processingItem.product_id !== lockedOrder.product_id
          || String(processingItem.document_uom_code || '').toUpperCase() !== baseUom
          || Math.abs(documentQuantity - Number(lockedOrder.order_quantity)) > EPSILON
          || Math.abs(baseQuantity - Number(lockedOrder.order_quantity)) > EPSILON) {
          throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '加工费采购订单明细的产品、数量或单位快照与委外来源不一致');
        }
        for (const [index, item] of body.items.entries()) {
          if (item.productId !== lockedOrder.product_id || item.productId !== processingItem.product_id) {
            throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, `第 ${index + 1} 行产品与加工费采购订单来源不匹配`);
          }
        }
        // The outsourcing capacity bound is re-read inside the transaction and
        // the quantity of THIS notice is part of the compared total.
        const capacity = resolveOutsourcingOrderCapacity(db, resolved.outsourcingOrderId);
        if (!capacity) throw new HttpError(404, '委外订单不存在');
        if (!capacity.provable) {
          throw noticeBusinessError(NOTICE_ERROR_CODES.OUTSOURCING_CAPACITY_UNPROVEN, '委外订单历史收货效力不可证明，无法证明剩余可收量');
        }
        const alreadyReceipted = capacity.confirmedReceiptQuantity;
        const activeNotified = sumOutsourcingNoticeQty(db, resolved.outsourcingOrderId, ['DRAFT', 'CONFIRMED']);
        const newNoticeQty = body.items.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
        const open = capacity.orderQuantity - alreadyReceipted;
        if (activeNotified + newNoticeQty > open + EPSILON) {
          throw noticeBusinessError(
            NOTICE_ERROR_CODES.CAPACITY_EXCEEDED,
            `完工通知数量超过委外订单剩余可收量：订单可收 ${open}、已通知 ${activeNotified}、本次 ${newNoticeQty}`,
          );
        }
      }

      // ---- STANDARD_PURCHASE line level source resolution ---------------
      const sourcePlans = [];
      const allocationByOrderLine = new Map();
      const allocationBySchedule = new Map();
      const orderIds = new Set();
      if (businessType === 'STANDARD_PURCHASE') {
        for (const [index, item] of body.items.entries()) {
          const { allocations } = normalizeLineAllocations(item, index, body.purchaseOrderId);
          const productId = item.productId || null;
          for (const allocation of allocations) {
            const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(allocation.purchaseOrderItemId);
            if (!orderItem) throw new HttpError(400, `第 ${index + 1} 行来源采购订单行不存在`);
            const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderItem.order_id);
            if (!order) throw new HttpError(400, `第 ${index + 1} 行来源采购订单不存在`);
            if (order.status !== 'APPROVED') throw new HttpError(409, '只有已审批采购订单可以创建收货通知');
            if (order.business_type && order.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '普通收货通知仅适用于 STANDARD_PURCHASE 订单');
            if (body.purchaseOrderId && order.id !== body.purchaseOrderId) {
              throw noticeBusinessError(
                NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN,
                `第 ${index + 1} 行来源采购订单与表头 purchaseOrderId 表示冲突的来源事实`,
              );
            }
            if (resolved.supplierId && order.supplier_id !== resolved.supplierId) {
              throw new HttpError(409, '来源采购订单与供应商不一致');
            }
            if (productId && orderItem.product_id !== productId) {
              throw new HttpError(409, `第 ${index + 1} 行产品与来源采购订单行不一致`);
            }
            resolved.supplierId = resolved.supplierId || order.supplier_id;
            orderIds.add(order.id);

            // Delivery schedule binding: unique candidate only, or an
            // explicit selection that belongs to this order line. Zero or
            // several candidates without an explicit selection fail closed.
            const binding = resolveDeliveryScheduleBinding(db, {
              purchaseOrderItemId: allocation.purchaseOrderItemId,
              deliveryScheduleId: allocation.deliveryScheduleId,
            });
            if (binding.status === 'MISMATCH') {
              throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, `第 ${index + 1} 行交期不属于对应采购订单行`);
            }
            if (binding.status === 'NOT_APPLICABLE') {
              throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, `第 ${index + 1} 行采购订单行没有有效交期`);
            }
            if (binding.status === 'AMBIGUOUS') {
              throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, `第 ${index + 1} 行采购订单行存在多个交期，必须显式指定交期`);
            }
            const scheduleId = binding.schedule.id;
            allocationByOrderLine.set(orderItem.id, (allocationByOrderLine.get(orderItem.id) || 0) + allocation.allocatedQuantity);
            allocationBySchedule.set(scheduleId, (allocationBySchedule.get(scheduleId) || 0) + allocation.allocatedQuantity);
            sourcePlans.push({ index, noticeItemIndex: index, orderItem, order, scheduleId, allocation });
          }
        }
        // The notice allocates capacity on the order line and on the delivery
        // schedule: both bounds are checked against the authoritative state.
        for (const [orderItemId, quantity] of allocationByOrderLine) {
          const capacity = resolvePurchaseOrderLineCapacity(db, orderItemId);
          if (!capacity) throw noticeBusinessError(NOTICE_ERROR_CODES.SOURCE_CAPACITY_UNKNOWN, '来源采购订单行不存在，无法证明容量');
          if (capacity.usedQuantity + quantity > capacity.orderedQuantity + EPSILON) {
            throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '通知分配数量超过采购订单剩余可收数量');
          }
        }
        for (const [scheduleId, quantity] of allocationBySchedule) {
          const capacity = resolveDeliveryScheduleCapacity(db, scheduleId);
          if (!capacity) throw noticeBusinessError(NOTICE_ERROR_CODES.SCHEDULE_UNPROVEN, '交期不存在，无法证明交期容量');
          if (capacity.usedQuantity + quantity > capacity.capacityQuantity + EPSILON) {
            throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '通知分配数量超过交期与容差剩余容量');
          }
        }
      }

      // The header purchase order is a derived compatibility hint only: it
      // carries the first order of the line level source set.
      const headerOrderId = businessType === 'STANDARD_PURCHASE'
        ? (sourcePlans.length ? [...orderIds].sort()[0] : resolved.purchaseOrderId)
        : null;

      db.prepare(`INSERT INTO receipt_notices(id,notice_no,purchase_order_id,business_type,supplier_id,warehouse_id,notice_date,status,handler_id,remark,idempotency_key,creator_id,created_at,updated_at,outsourcing_order_id,processing_po_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        noticeId, noticeNo, headerOrderId, resolved.businessType, resolved.supplierId, body.warehouseId, body.noticeDate || now.slice(0, 10),
        'DRAFT', actor.id, body.remark || '', idempotencyKey || null, actor.id, now, now,
        resolved.outsourcingOrderId, resolved.processingPoId,
      );
      const insertItem = db.prepare('INSERT INTO receipt_notice_items(id,notice_id,purchase_order_item_id,product_id,quantity,line_no,outsourcing_order_id) VALUES(?,?,?,?,?,?,?)');
      const insertSource = db.prepare(`INSERT INTO receipt_notice_item_sources(id,notice_item_id,purchase_order_item_id,delivery_schedule_id,allocated_quantity,converted_quantity,source_trace_json,business_date,created_at,updated_at)
        VALUES(?,?,?,?,?,0,?,?,?,?)`);
      const noticeItemIds = [];
      body.items.forEach((item, index) => {
        const noticeItemId = randomUUID();
        noticeItemIds.push(noticeItemId);
        const plans = sourcePlans.filter((plan) => plan.noticeItemIndex === index);
        const productId = item.productId || plans[0]?.orderItem?.product_id || null;
        insertItem.run(
          noticeItemId, noticeId,
          businessType === 'STANDARD_PURCHASE' ? (plans[0]?.orderItem?.id ?? item.purchaseOrderItemId ?? null)
            : db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(resolved.processingPoId)?.id,
          productId, Number(item.quantity), index + 1,
          businessType === 'OUTSOURCE' ? resolved.outsourcingOrderId : null,
        );
        for (const plan of plans) {
          // converted_quantity is written explicitly as 0: the row was just
          // created and verified in this transaction, so no conversion
          // happened for it yet. A historical NULL is never rewritten.
          const trace = JSON.stringify({
            purchaseOrderId: plan.order.id,
            purchaseOrderItemId: plan.orderItem.id,
            deliveryScheduleId: plan.scheduleId,
            sourceNoticeId: noticeId,
          });
          insertSource.run(
            randomUUID(), noticeItemId, plan.orderItem.id, plan.scheduleId,
            plan.allocation.allocatedQuantity, trace, now.slice(0, 10), now, now,
          );
        }
      });
      audit(db, actor.id, 'CREATE', 'RECEIPT_NOTICE', noticeId, `创建 ${businessType} 通知 ${noticeNo}`);
      if (idempotencyKey) {
        saveIdempotency(db, NOTICE_CREATE_OPERATION, `create-request:${idempotencyKey}`, idempotencyKey, fingerprint, { id: noticeId, noticeNo, businessType: resolved.businessType });
      }
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { ...context, entityId: noticeId }, error);
    throw error;
  }
  return send(res, 201, { id: noticeId, noticeNo, businessType: resolved.businessType });
}

export async function confirmReceiptNotice(db, req, res, actor, noticeId) {
  assertManagePermission(actor);
  const now = new Date().toISOString();
  const context = { entityType: 'RECEIPT_NOTICE', entityId: noticeId, action: '确认收料通知' };
  try {
    transaction(db, () => {
      // The authoritative notice state is re-read inside the transaction.
      const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
      if (!notice) throw new HttpError(404, '收货通知不存在');
      if (notice.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
      // Re-check the open-quantity cap at confirm time so a previously-
      // valid notice cannot become invalid just because another notice
      // advanced. The capacity is scoped by the notice business type: an
      // OUTSOURCE notice never inherits a purchase order line bound.
      if (notice.business_type === 'OUTSOURCE' && notice.outsourcing_order_id) {
        const capacity = resolveOutsourcingOrderCapacity(db, notice.outsourcing_order_id);
        if (!capacity) throw new HttpError(404, '委外订单不存在');
        if (!capacity.provable) {
          throw noticeBusinessError(NOTICE_ERROR_CODES.OUTSOURCING_CAPACITY_UNPROVEN, '委外订单历史收货效力不可证明，无法证明剩余可收量');
        }
        const items = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM receipt_notice_items WHERE notice_id=?').get(noticeId);
        const thisQty = Number(items.q || 0);
        // The quantity of THIS notice is part of the compared total exactly
        // once: it is removed from the other notices' total and added back
        // as the quantity under confirmation.
        const others = sumOutsourcingNoticeQty(db, notice.outsourcing_order_id, ['DRAFT', 'CONFIRMED']) - thisQty;
        const open = capacity.orderQuantity - capacity.confirmedReceiptQuantity;
        if (others + thisQty > open + EPSILON) {
          throw noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, '完工通知确认时数量超过委外订单剩余可收量');
        }
      }
      db.prepare('UPDATE receipt_notices SET status=?,updated_at=? WHERE id=?').run('CONFIRMED', now, noticeId);
      audit(db, actor.id, 'CONFIRM', 'RECEIPT_NOTICE', noticeId, notice.notice_no);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, context, error);
    throw error;
  }
  return send(res, 200, { ok: true });
}

export async function cancelReceiptNotice(db, res, actor, noticeId) {
  assertManagePermission(actor);
  const now = new Date().toISOString();
  transaction(db, () => {
    const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(noticeId);
    if (!notice) throw new HttpError(404, '收货通知不存在');
    if (notice.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    // Cancelling a notice never restores a converted source capacity
    // (T-11): the converted quantity is a monotone historical fact.
    db.prepare('UPDATE receipt_notices SET status=?,updated_at=? WHERE id=?').run('CANCELLED', now, noticeId);
    audit(db, actor.id, 'CANCEL', 'RECEIPT_NOTICE', noticeId, notice.notice_no);
  });
  return send(res, 200, { ok: true });
}

export {
  assertPoViewPermission,
  assertNoticeCompatibleWithReceipt,
  sumOutsourcingNoticeQty,
};
