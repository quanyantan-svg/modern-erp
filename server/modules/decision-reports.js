// M7 — Decision Reports.
//
// Pure read-only analytics over the canonical documents (sales_orders,
// purchase_orders, sales_deliveries, purchase_receipts, return_orders,
// inventory_transactions). No schema writes, no synthetic aggregates.
//
// Money: every monetary field is stored as integer cents on the
// canonical documents; SUM is performed in SQL so there is no
// floating-point drift on the server side. The frontend formats cents
// via the existing money() helper.
//
// Date semantics: documented per-handler below.
//
// Outstanding accuracy: schema-level `sales_delivery_items` and
// `purchase_receipt_items` only share `product_id` with their order
// items — there is no `sales_order_item_id` / `purchase_order_item_id`
// foreign key. Per-line outstanding quantity would therefore have to
// guess from product_id alone, which is unsafe when the same product
// appears in multiple order lines. The outstanding reports therefore
// report at document level (linkage count + latest logistics date +
// fulfillment status) and DO NOT claim exact residual quantity.

import { allowAny, HttpError, send } from '../lib/http.js';

const MAX_REPORT_ROWS = 500;

function parseDateParam(value, label) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} 格式必须为 YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} 不是有效日期`);
  }
  return value;
}

function validateDateRange(from, to) {
  if (from && to && from > to) {
    throw new HttpError(400, '开始日期不能晚于结束日期');
  }
}

function requireReportVisibilityWithSales(actor) {
  allowAny(actor, ['REPORT_VIEW']);
  allowAny(actor, ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE']);
}

function requireReportVisibilityWithPurchase(actor) {
  allowAny(actor, ['REPORT_VIEW']);
  allowAny(actor, ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE']);
}

function requireReportVisibilityWithInventory(actor) {
  allowAny(actor, ['REPORT_VIEW']);
  allowAny(actor, ['INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_ADJUSTMENT_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE']);
}

function buildOrderFilters(url, dateColumn) {
  const dateFrom = parseDateParam(url.searchParams.get('dateFrom'), '开始日期');
  const dateTo = parseDateParam(url.searchParams.get('dateTo'), '结束日期');
  validateDateRange(dateFrom, dateTo);
  const customerId = url.searchParams.get('customerId') || null;
  const supplierId = url.searchParams.get('supplierId') || null;
  const status = url.searchParams.get('status') || null;
  if (status && !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new HttpError(400, 'status 不是有效订单状态');
  }
  const where = [];
  const params = [];
  if (dateFrom) { where.push(`${dateColumn} >= ?`); params.push(dateFrom); }
  if (dateTo) { where.push(`${dateColumn} <= ?`); params.push(dateTo); }
  return { where, params, dateFrom, dateTo, customerId, supplierId, status };
}

function buildInventoryFilters(url) {
  const dateFrom = parseDateParam(url.searchParams.get('dateFrom'), '开始日期');
  const dateTo = parseDateParam(url.searchParams.get('dateTo'), '结束日期');
  validateDateRange(dateFrom, dateTo);
  const productId = url.searchParams.get('productId') || null;
  const warehouseId = url.searchParams.get('warehouseId') || null;
  const direction = url.searchParams.get('direction') || null;
  const sourceType = url.searchParams.get('sourceType') || null;
  if (direction && !['IN', 'OUT'].includes(direction)) {
    throw new HttpError(400, 'direction 必须为 IN 或 OUT');
  }
  const where = [];
  const params = [];
  if (dateFrom) { where.push('DATE(t.created_at) >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('DATE(t.created_at) <= ?'); params.push(dateTo); }
  if (productId) { where.push('t.product_id = ?'); params.push(productId); }
  if (warehouseId) { where.push('t.warehouse_id = ?'); params.push(warehouseId); }
  if (direction) { where.push('t.direction = ?'); params.push(direction); }
  if (sourceType) { where.push('t.source_type = ?'); params.push(sourceType); }
  return { where, params, dateFrom, dateTo, productId, warehouseId, direction, sourceType };
}

// ---------- 1. Sales Statistics ----------

// Date semantics: order uses sales_orders.created_at; delivery uses
// sales_deliveries.confirmed_at (the canonical "this delivery actually
// shipped" instant), falling back to delivery_date when confirmed_at is
// not populated yet (defensive — confirmed_at is set on every CONFIRMED
// row by the confirm handler).
export function getSalesSummary(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  const filters = buildOrderFilters(url, 'so.created_at');

  const orderWhere = ['1=1'];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('DATE(so.created_at) >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('DATE(so.created_at) <= ?'); orderParams.push(filters.dateTo); }
  if (filters.customerId) { orderWhere.push('so.customer_id = ?'); orderParams.push(filters.customerId); }
  if (filters.status) { orderWhere.push('so.status = ?'); orderParams.push(filters.status); }

  const deliveryWhere = ["sd.status = 'CONFIRMED'"];
  const deliveryParams = [];
  if (filters.dateFrom) { deliveryWhere.push('DATE(COALESCE(sd.confirmed_at, sd.delivery_date)) >= ?'); deliveryParams.push(filters.dateFrom); }
  if (filters.dateTo) { deliveryWhere.push('DATE(COALESCE(sd.confirmed_at, sd.delivery_date)) <= ?'); deliveryParams.push(filters.dateTo); }
  if (filters.customerId) { deliveryWhere.push('sd.customer_id = ?'); deliveryParams.push(filters.customerId); }

  const returnWhere = ["ro.source_type = 'SALES'", "ro.status = 'CONFIRMED'"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('DATE(COALESCE(ro.confirmed_at, ro.return_date)) >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('DATE(COALESCE(ro.confirmed_at, ro.return_date)) <= ?'); returnParams.push(filters.dateTo); }
  if (filters.customerId) { returnWhere.push('ro.customer_id = ?'); returnParams.push(filters.customerId); }

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sales_orders so WHERE ${orderWhere.join(' AND ')}) AS orderCount,
      (SELECT COALESCE(SUM(so.total_cents), 0) FROM sales_orders so WHERE ${orderWhere.join(' AND ')}) AS orderCents,
      (SELECT COUNT(*) FROM sales_orders so WHERE ${orderWhere.join(' AND ')} AND so.status='APPROVED') AS approvedOrderCount,
      (SELECT COUNT(*) FROM sales_deliveries sd WHERE ${deliveryWhere.join(' AND ')}) AS deliveryCount,
      (SELECT COALESCE(SUM(sd.total_cents), 0) FROM sales_deliveries sd WHERE ${deliveryWhere.join(' AND ')}) AS deliveryCents,
      (SELECT COUNT(*) FROM return_orders ro WHERE ${returnWhere.join(' AND ')}) AS returnCount,
      (SELECT COALESCE(SUM(ro.total_cents), 0) FROM return_orders ro WHERE ${returnWhere.join(' AND ')}) AS returnCents
  `).get(...orderParams, ...orderParams, ...orderParams, ...deliveryParams, ...deliveryParams, ...returnParams, ...returnParams);

  const netShipmentCents = summary.deliveryCents - summary.returnCents;

  const byCustomer = db.prepare(`
    SELECT
      c.id AS customerId,
      c.code AS customerCode,
      c.name AS customerName,
      COUNT(so.id) AS orderCount,
      COALESCE(SUM(so.total_cents), 0) AS orderCents,
      COALESCE((
        SELECT SUM(sd2.total_cents)
        FROM sales_deliveries sd2
        WHERE sd2.customer_id = c.id
          AND sd2.status = 'CONFIRMED'
          ${filters.dateFrom ? 'AND DATE(COALESCE(sd2.confirmed_at, sd2.delivery_date)) >= ?' : ''}
          ${filters.dateTo ? 'AND DATE(COALESCE(sd2.confirmed_at, sd2.delivery_date)) <= ?' : ''}
      ), 0) AS deliveryCents
    FROM customers c
    LEFT JOIN sales_orders so
      ON so.customer_id = c.id
      ${filters.dateFrom ? 'AND DATE(so.created_at) >= ?' : ''}
      ${filters.dateTo ? 'AND DATE(so.created_at) <= ?' : ''}
      ${filters.status ? 'AND so.status = ?' : ''}
    ${filters.customerId ? 'WHERE c.id = ?' : ''}
    GROUP BY c.id
    HAVING orderCount > 0 OR deliveryCents > 0
    ORDER BY orderCents DESC, c.code
    LIMIT ?
  `).all(
    ...(filters.dateFrom ? [filters.dateFrom] : []),
    ...(filters.dateTo ? [filters.dateTo] : []),
    ...(filters.dateFrom ? [filters.dateFrom] : []),
    ...(filters.dateTo ? [filters.dateTo] : []),
    ...(filters.status ? [filters.status] : []),
    ...(filters.customerId ? [filters.customerId] : []),
    MAX_REPORT_ROWS,
  );

  return send(res, 200, {
    summary: {
      orderCount: summary.orderCount,
      orderCents: summary.orderCents,
      approvedOrderCount: summary.approvedOrderCount,
      deliveryCount: summary.deliveryCount,
      deliveryCents: summary.deliveryCents,
      returnCount: summary.returnCount,
      returnCents: summary.returnCents,
      netShipmentCents,
    },
    byCustomer,
    filters: {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      customerId: filters.customerId,
      status: filters.status,
    },
    moneyUnit: 'cents',
    notes: [
      '订单金额来自 sales_orders.total_cents；',
      '实际出货金额来自 CONFIRMED 销售出库；',
      '销售退货金额来自 CONFIRMED source_type=SALES 退货单；',
      '净出货金额 = 出货金额 - 退货金额；',
      '订单金额不等于已实现收入。',
    ].join(''),
  });
}

// ---------- 2. Sales Outstanding (Document Level) ----------

// Accuracy gate: Capability B — line-level residual quantity is not
// derivable because sales_delivery_items does not reference
// sales_order_items. Report shows: APPROVED sales orders, count of
// CONFIRMED linked deliveries, latest delivery date, fulfillment
// status. NEVER claims exact residual line quantity.
export function getSalesOutstanding(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  const filters = buildOrderFilters(url, 'so.created_at');
  const customerId = filters.customerId;

  const where = ["so.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push('DATE(so.created_at) >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('DATE(so.created_at) <= ?'); params.push(filters.dateTo); }
  if (customerId) { where.push('so.customer_id = ?'); params.push(customerId); }

  const rows = db.prepare(`
    SELECT
      so.id,
      so.order_no,
      so.status,
      so.total_cents,
      so.created_at,
      so.remark,
      so.rejection_reason,
      c.id AS customerId,
      c.code AS customerCode,
      c.name AS customerName,
      (SELECT COUNT(*) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'CONFIRMED') AS confirmedDeliveryCount,
      (SELECT MAX(COALESCE(sd.confirmed_at, sd.delivery_date)) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'CONFIRMED') AS latestDeliveryDate,
      (SELECT COUNT(*) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'DRAFT') AS draftDeliveryCount
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY so.created_at DESC
    LIMIT ?
  `).all(...params, MAX_REPORT_ROWS);

  const enriched = rows.map((row) => {
    let fulfillmentState = 'NOT_STARTED';
    let fulfillmentLabel = '尚未出货';
    if (row.confirmedDeliveryCount > 0) {
      fulfillmentState = 'DELIVERED';
      fulfillmentLabel = '已有出货记录';
    } else if (row.draftDeliveryCount > 0) {
      fulfillmentState = 'IN_PROGRESS';
      fulfillmentLabel = '草稿出库单进行中';
    }
    return {
      ...row,
      fulfillmentState,
      fulfillmentLabel,
    };
  });

  return send(res, 200, {
    rows: enriched,
    filters: {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      customerId,
    },
    accuracy: 'DOCUMENT_LEVEL',
    accuracyNotes: [
      '本表为文档级口径，仅显示已审批销售订单与已确认出货单之间的关联计数与最新出货日期。',
      'schema 当前 sales_delivery_items 不引用 sales_order_items，无法安全推导逐行未出库数量；',
      '如需逐行未出库数量，请联系开发先扩展 schema 增加 sales_order_item_id 外键。',
    ].join(''),
  });
}

// ---------- 3. Purchase Statistics ----------

export function getPurchaseSummary(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  const filters = buildOrderFilters(url, 'po.created_at');

  const orderWhere = ['1=1'];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('DATE(po.created_at) >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('DATE(po.created_at) <= ?'); orderParams.push(filters.dateTo); }
  if (filters.supplierId) { orderWhere.push('po.supplier_id = ?'); orderParams.push(filters.supplierId); }
  if (filters.status) { orderWhere.push('po.status = ?'); orderParams.push(filters.status); }

  const receiptWhere = ["pr.status = 'CONFIRMED'"];
  const receiptParams = [];
  if (filters.dateFrom) { receiptWhere.push('DATE(COALESCE(pr.confirmed_at, pr.receipt_date)) >= ?'); receiptParams.push(filters.dateFrom); }
  if (filters.dateTo) { receiptWhere.push('DATE(COALESCE(pr.confirmed_at, pr.receipt_date)) <= ?'); receiptParams.push(filters.dateTo); }
  if (filters.supplierId) { receiptWhere.push('pr.supplier_id = ?'); receiptParams.push(filters.supplierId); }

  const returnWhere = ["1=1", "prt.status = 'CONFIRMED'"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('DATE(COALESCE(prt.confirmed_at, prt.return_date)) >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('DATE(COALESCE(prt.confirmed_at, prt.return_date)) <= ?'); returnParams.push(filters.dateTo); }
  if (filters.supplierId) { returnWhere.push('prt.supplier_id = ?'); returnParams.push(filters.supplierId); }

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM purchase_orders po WHERE ${orderWhere.join(' AND ')}) AS orderCount,
      (SELECT COALESCE(SUM(po.total_cents), 0) FROM purchase_orders po WHERE ${orderWhere.join(' AND ')}) AS orderCents,
      (SELECT COUNT(*) FROM purchase_orders po WHERE ${orderWhere.join(' AND ')} AND po.status='APPROVED') AS approvedOrderCount,
      (SELECT COUNT(*) FROM purchase_receipts pr WHERE ${receiptWhere.join(' AND ')}) AS receiptCount,
      (SELECT COALESCE(SUM(pr.total_cents), 0) FROM purchase_receipts pr WHERE ${receiptWhere.join(' AND ')}) AS receiptCents,
      (SELECT COUNT(*) FROM purchase_returns prt WHERE ${returnWhere.join(' AND ')}) AS returnCount,
      (SELECT COALESCE(SUM(prt.total_cents), 0) FROM purchase_returns prt WHERE ${returnWhere.join(' AND ')}) AS returnCents
  `).get(...orderParams, ...orderParams, ...orderParams, ...receiptParams, ...receiptParams, ...returnParams, ...returnParams);

  const netReceiptCents = summary.receiptCents - summary.returnCents;

  const bySupplier = db.prepare(`
    SELECT
      s.id AS supplierId,
      s.code AS supplierCode,
      s.name AS supplierName,
      COUNT(po.id) AS orderCount,
      COALESCE(SUM(po.total_cents), 0) AS orderCents,
      COALESCE((
        SELECT SUM(pr2.total_cents)
        FROM purchase_receipts pr2
        WHERE pr2.supplier_id = s.id
          AND pr2.status = 'CONFIRMED'
          ${filters.dateFrom ? 'AND DATE(COALESCE(pr2.confirmed_at, pr2.receipt_date)) >= ?' : ''}
          ${filters.dateTo ? 'AND DATE(COALESCE(pr2.confirmed_at, pr2.receipt_date)) <= ?' : ''}
      ), 0) AS receiptCents
    FROM suppliers s
    LEFT JOIN purchase_orders po
      ON po.supplier_id = s.id
      ${filters.dateFrom ? 'AND DATE(po.created_at) >= ?' : ''}
      ${filters.dateTo ? 'AND DATE(po.created_at) <= ?' : ''}
      ${filters.status ? 'AND po.status = ?' : ''}
    ${filters.supplierId ? 'WHERE s.id = ?' : ''}
    GROUP BY s.id
    HAVING orderCount > 0 OR receiptCents > 0
    ORDER BY orderCents DESC, s.code
    LIMIT ?
  `).all(
    ...(filters.dateFrom ? [filters.dateFrom] : []),
    ...(filters.dateTo ? [filters.dateTo] : []),
    ...(filters.dateFrom ? [filters.dateFrom] : []),
    ...(filters.dateTo ? [filters.dateTo] : []),
    ...(filters.status ? [filters.status] : []),
    ...(filters.supplierId ? [filters.supplierId] : []),
    MAX_REPORT_ROWS,
  );

  return send(res, 200, {
    summary: {
      orderCount: summary.orderCount,
      orderCents: summary.orderCents,
      approvedOrderCount: summary.approvedOrderCount,
      receiptCount: summary.receiptCount,
      receiptCents: summary.receiptCents,
      returnCount: summary.returnCount,
      returnCents: summary.returnCents,
      netReceiptCents,
    },
    bySupplier,
    filters: {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      supplierId: filters.supplierId,
      status: filters.status,
    },
    moneyUnit: 'cents',
    notes: [
      '订单金额来自 purchase_orders.total_cents；',
      '实际入库金额来自 CONFIRMED 采购入库单；',
      '采购退货金额来自 CONFIRMED 采购退货单；',
      '净入库金额 = 入库金额 - 退货金额；',
      '订单金额不等于已实现成本。',
    ].join(''),
  });
}

// ---------- 4. Purchase Outstanding (Document Level) ----------

export function getPurchaseOutstanding(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  const filters = buildOrderFilters(url, 'po.created_at');
  const supplierId = filters.supplierId;

  const where = ["po.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push('DATE(po.created_at) >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('DATE(po.created_at) <= ?'); params.push(filters.dateTo); }
  if (supplierId) { where.push('po.supplier_id = ?'); params.push(supplierId); }

  const rows = db.prepare(`
    SELECT
      po.id,
      po.order_no,
      po.status,
      po.total_cents,
      po.created_at,
      po.remark,
      po.rejection_reason,
      s.id AS supplierId,
      s.code AS supplierCode,
      s.name AS supplierName,
      (SELECT COUNT(*) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'CONFIRMED') AS confirmedReceiptCount,
      (SELECT MAX(COALESCE(pr.confirmed_at, pr.receipt_date)) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'CONFIRMED') AS latestReceiptDate,
      (SELECT COUNT(*) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'DRAFT') AS draftReceiptCount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY po.created_at DESC
    LIMIT ?
  `).all(...params, MAX_REPORT_ROWS);

  const enriched = rows.map((row) => {
    let fulfillmentState = 'NOT_STARTED';
    let fulfillmentLabel = '尚未入库';
    if (row.confirmedReceiptCount > 0) {
      fulfillmentState = 'RECEIVED';
      fulfillmentLabel = '已有入库记录';
    } else if (row.draftReceiptCount > 0) {
      fulfillmentState = 'IN_PROGRESS';
      fulfillmentLabel = '草稿入库单进行中';
    }
    return {
      ...row,
      fulfillmentState,
      fulfillmentLabel,
    };
  });

  return send(res, 200, {
    rows: enriched,
    filters: {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      supplierId,
    },
    accuracy: 'DOCUMENT_LEVEL',
    accuracyNotes: [
      '本表为文档级口径，仅显示已审批采购订单与已确认入库单之间的关联计数与最新入库日期。',
      'schema 当前 purchase_receipt_items 不引用 purchase_order_items，无法安全推导逐行未入库数量；',
      '如需逐行未入库数量，请联系开发先扩展 schema 增加 purchase_order_item_id 外键。',
    ].join(''),
  });
}

// ---------- 5. Inventory Movement Detail ----------

const SOURCE_TYPE_LABELS = {
  SALES_DELIVERY: '销售出货',
  PURCHASE_RECEIPT: '采购入库',
  SALES_RETURN: '销售退货',
  PURCHASE_RETURN: '采购退货',
  INVENTORY_TRANSFER: '库存调拨',
  INVENTORY_CHECK: '库存盘点',
  INVENTORY_ADJUSTMENT: '库存调整',
  PRODUCTION_MATERIAL_ISSUE: '用料出库',
  PRODUCTION_RECEIPT: '生产入库',
};

export function getInventoryMovements(db, res, actor, url) {
  requireReportVisibilityWithInventory(actor);
  const filters = buildInventoryFilters(url);

  const where = ['1=1'];
  const params = [];
  if (filters.dateFrom) { where.push('DATE(t.created_at) >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('DATE(t.created_at) <= ?'); params.push(filters.dateTo); }
  if (filters.productId) { where.push('t.product_id = ?'); params.push(filters.productId); }
  if (filters.warehouseId) { where.push('t.warehouse_id = ?'); params.push(filters.warehouseId); }
  if (filters.direction) { where.push('t.direction = ?'); params.push(filters.direction); }
  if (filters.sourceType) { where.push('t.source_type = ?'); params.push(filters.sourceType); }

  const rows = db.prepare(`
    SELECT
      t.id,
      t.created_at,
      t.warehouse_id,
      w.code AS warehouseCode,
      w.name AS warehouseName,
      t.product_id,
      p.code AS productCode,
      p.name AS productName,
      p.unit,
      t.direction,
      t.quantity_change,
      t.balance_after,
      t.source_type,
      t.source_id,
      t.source_no,
      t.remark,
      t.creator_id,
      u.display_name AS creatorName
    FROM inventory_transactions t
    JOIN warehouses w ON w.id = t.warehouse_id
    JOIN products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.creator_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ?
  `).all(...params, MAX_REPORT_ROWS);

  const enriched = rows.map((row) => ({
    ...row,
    source_type_label: SOURCE_TYPE_LABELS[row.source_type] || '其他异动',
    direction_label: row.direction === 'IN' ? '入库' : '出库',
  }));

  let reconciliation = null;
  if (filters.productId && filters.warehouseId) {
    const current = db.prepare(`
      SELECT quantity
      FROM inventory
      WHERE product_id = ? AND warehouse_id = ?
    `).get(filters.productId, filters.warehouseId);
    const latestMovement = db.prepare(`
      SELECT balance_after
      FROM inventory_transactions
      WHERE product_id = ? AND warehouse_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(filters.productId, filters.warehouseId);
    const currentQuantity = current?.quantity ?? 0;
    const latestMovementBalance = latestMovement?.balance_after ?? null;
    reconciliation = {
      currentQuantity,
      latestMovementBalance,
      reconcilesToCurrent: latestMovementBalance == null ? null : latestMovementBalance === currentQuantity,
      note: latestMovementBalance == null
        ? '当前组合没有足够的流水历史，无法推导历史期初；当前库存以 inventory 为准。'
        : '核对使用该货品/仓库的最新完整流水余额；当前库存以 inventory 为准，不推导历史期初。',
    };
  }

  return send(res, 200, {
    rows: enriched,
    reconciliation,
    filters: {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      productId: filters.productId,
      warehouseId: filters.warehouseId,
      direction: filters.direction,
      sourceType: filters.sourceType,
    },
    sourceLabels: SOURCE_TYPE_LABELS,
  });
}

// Exported so focused tests can introspect the canonical label map.
export const DECISION_REPORT_SOURCE_LABELS = Object.freeze(SOURCE_TYPE_LABELS);
