// V1.4-E5 — Decision reports with C01 authoritative business dates
// and C02 entity-lookup transport.
//
// Date semantics (C01, period-activity):
//   * orders use order_date; shipments use delivery_date; receipts use
//     receipt_date; returns use return_date. created_at / confirmed_at
//     remain audit timestamps and are never substituted for these dates.
//   * inventory movements use inventory_transactions.business_date
//     directly. Rows without that authoritative value fall into the
//     `legacyMissing` bucket.
//
// Outstanding reports:
//   * sales-outstanding filters by requested_delivery_date and purchase-
//     outstanding filters by expected_delivery_date. No E6 line-level
//     redesign is included here.
//
// Filter transport (C02):
//   * Reports accept canonical internal IDs as their entity filter
//     parameter. UI uses BusinessEntitySelector which only ever
//     submits canonical IDs after a successful select.
//   * The response `filters` envelope echoes the resolved
//     code/name pair so exports can show the business-readable
//     label rather than the UUID.
//   * `customerId` / `supplierId` / `productId` / `warehouseId`
//     must resolve to an existing row. Free-text inputs are no
//     longer supported and are rejected upstream.

import { allowAny, HttpError, send } from '../lib/http.js';

const MAX_REPORT_ROWS = 500;
const MAX_EXPORT_ROWS = 5000;

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

function resolveEntity(db, table, id, label) {
  const row = db.prepare(`SELECT id, code, name, active FROM ${table} WHERE id = ?`).get(id);
  if (!row) {
    throw new HttpError(400, `${label} 不是受支持的业务对象`, {
      code: 'BUSINESS_ENTITY_NOT_FOUND',
      resolution: '请通过客户/供应商/产品/仓库筛选器选择有效对象，或清除该筛选',
    });
  }
  return row;
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
  allowAny(actor, ['INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE']);
}

function buildOrderFilters(url) {
  const dateFrom = parseDateParam(url.searchParams.get('dateFrom'), '开始日期');
  const dateTo = parseDateParam(url.searchParams.get('dateTo'), '结束日期');
  validateDateRange(dateFrom, dateTo);
  const customerId = url.searchParams.get('customerId') || null;
  const supplierId = url.searchParams.get('supplierId') || null;
  const status = url.searchParams.get('status') || null;
  if (status && !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new HttpError(400, 'status 不是有效订单状态');
  }
  return { dateFrom, dateTo, customerId, supplierId, status };
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
  return { dateFrom, dateTo, productId, warehouseId, direction, sourceType };
}

function buildFilterEcho(db, filters) {
  const out = {
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
  };
  if (filters.customerId) {
    const row = resolveEntity(db, 'customers', filters.customerId, '客户');
    out.customer = { id: row.id, code: row.code, name: row.name, active: row.active ? 1 : 0 };
  }
  if (filters.supplierId) {
    const row = resolveEntity(db, 'suppliers', filters.supplierId, '供应商');
    out.supplier = { id: row.id, code: row.code, name: row.name, active: row.active ? 1 : 0 };
  }
  if (filters.productId) {
    const row = resolveEntity(db, 'products', filters.productId, '产品');
    out.product = { id: row.id, code: row.code, name: row.name, active: row.active ? 1 : 0 };
  }
  if (filters.warehouseId) {
    const row = resolveEntity(db, 'warehouses', filters.warehouseId, '仓库');
    out.warehouse = { id: row.id, code: row.code, name: row.name, active: row.active ? 1 : 0 };
  }
  if (filters.status) out.status = filters.status;
  if (filters.direction) out.direction = filters.direction;
  if (filters.sourceType) out.sourceType = filters.sourceType;
  return out;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function writeCsv(res, filename, headerLines, tableLines) {
  const bom = '﻿';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(bom + headerLines.join('\r\n') + '\r\n\r\n' + tableLines.join('\r\n') + '\r\n');
}

function formatFilterEchoForCsv(echo) {
  const lines = [];
  if (echo.customer) lines.push(`客户: ${echo.customer.code} · ${echo.customer.name}${echo.customer.active ? '' : '（已停用）'}`);
  if (echo.supplier) lines.push(`供应商: ${echo.supplier.code} · ${echo.supplier.name}${echo.supplier.active ? '' : '（已停用）'}`);
  if (echo.product) lines.push(`产品: ${echo.product.code} · ${echo.product.name}${echo.product.active ? '' : '（已停用）'}`);
  if (echo.warehouse) lines.push(`仓库: ${echo.warehouse.code} · ${echo.warehouse.name}${echo.warehouse.active ? '' : '（已停用）'}`);
  if (echo.status) lines.push(`订单状态: ${echo.status}`);
  if (echo.direction) lines.push(`方向: ${echo.direction === 'IN' ? '入库' : '出库'}`);
  if (echo.sourceType) lines.push(`来源类型: ${SOURCE_TYPE_LABELS[echo.sourceType] || '其他异动'}`);
  return lines;
}

// ---------- 1. Sales Statistics ----------

const SALES_DATE_BASIS = {
  order: '订单按订单日期（sales_orders.order_date）',
  shipment: '出货按出货日期（sales_deliveries.delivery_date）',
  return: '退货按退货日期（return_orders.return_date）',
};

export function getSalesSummary(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  const filters = buildOrderFilters(url);

  const orderWhere = ["so.order_date IS NOT NULL", "so.order_date <> ''"];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('so.order_date >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('so.order_date <= ?'); orderParams.push(filters.dateTo); }
  if (filters.customerId) { orderWhere.push('so.customer_id = ?'); orderParams.push(filters.customerId); }
  if (filters.status) { orderWhere.push('so.status = ?'); orderParams.push(filters.status); }

  // Shipment / return metrics require confirmed documents, but period
  // placement uses their explicit delivery_date / return_date. Audit
  // confirmation timestamps never substitute for business dates.
  const deliveryWhere = ["sd.status = 'CONFIRMED'", "sd.delivery_date IS NOT NULL", "sd.delivery_date <> ''"];
  const deliveryParams = [];
  if (filters.dateFrom) { deliveryWhere.push('sd.delivery_date >= ?'); deliveryParams.push(filters.dateFrom); }
  if (filters.dateTo) { deliveryWhere.push('sd.delivery_date <= ?'); deliveryParams.push(filters.dateTo); }
  if (filters.customerId) { deliveryWhere.push('sd.customer_id = ?'); deliveryParams.push(filters.customerId); }

  const returnWhere = ["ro.source_type = 'SALES'", "ro.status = 'CONFIRMED'", "ro.return_date IS NOT NULL", "ro.return_date <> ''"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('ro.return_date >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('ro.return_date <= ?'); returnParams.push(filters.dateTo); }
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

  // legacyMissing counts: rows whose authoritative business date is
  // NULL (or empty string). These are surfaced for audit but are NOT
  // folded into the KPI totals above.
  const orderLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM sales_orders so
    WHERE (so.order_date IS NULL OR so.order_date = '')
      ${filters.customerId ? 'AND so.customer_id = ?' : ''}
      ${filters.status ? 'AND so.status = ?' : ''}
  `).get(...(filters.customerId ? [filters.customerId] : []), ...(filters.status ? [filters.status] : [])).count;

  const deliveryLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM sales_deliveries sd
    WHERE sd.status = 'CONFIRMED' AND (sd.delivery_date IS NULL OR sd.delivery_date = '')
      ${filters.customerId ? 'AND sd.customer_id = ?' : ''}
  `).get(...(filters.customerId ? [filters.customerId] : [])).count;

  const returnLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM return_orders ro
    WHERE ro.source_type = 'SALES' AND ro.status = 'CONFIRMED' AND (ro.return_date IS NULL OR ro.return_date = '')
      ${filters.customerId ? 'AND ro.customer_id = ?' : ''}
  `).get(...(filters.customerId ? [filters.customerId] : [])).count;

  const netShipmentCents = summary.deliveryCents - summary.returnCents;
  const legacyMissingTotal = orderLegacyMissing + deliveryLegacyMissing + returnLegacyMissing;

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
          AND sd2.delivery_date IS NOT NULL AND sd2.delivery_date <> ''
          ${filters.dateFrom ? 'AND sd2.delivery_date >= ?' : ''}
          ${filters.dateTo ? 'AND sd2.delivery_date <= ?' : ''}
      ), 0) AS deliveryCents
    FROM customers c
    LEFT JOIN sales_orders so
      ON so.customer_id = c.id
      AND so.order_date IS NOT NULL AND so.order_date <> ''
      ${filters.dateFrom ? 'AND so.order_date >= ?' : ''}
      ${filters.dateTo ? 'AND so.order_date <= ?' : ''}
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
    filters: buildFilterEcho(db, filters),
    dateBasis: SALES_DATE_BASIS,
    legacyMissing: {
      orderWithoutDate: orderLegacyMissing,
      deliveryWithoutDate: deliveryLegacyMissing,
      returnWithoutDate: returnLegacyMissing,
      total: legacyMissingTotal,
    },
    moneyUnit: 'cents',
    notes: [
      '订单金额来自 sales_orders.total_cents，按 order_date 归集；',
      '实际出货金额来自 CONFIRMED 销售出库，按 delivery_date 归集；',
      '销售退货金额来自 CONFIRMED source_type=SALES 退货单，按 return_date 归集；',
      '净出货金额 = 出货金额 - 退货金额；',
      '订单金额不等于已实现收入；',
      `业务日期缺失共 ${legacyMissingTotal} 条，未计入上方指标，已在 legacyMissing 字段按指标分解。`,
    ].join(''),
  });
}

// ---------- 2. Sales Outstanding (Document Level) ----------

export function getSalesOutstanding(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  const filters = buildOrderFilters(url);
  const customerId = filters.customerId;

  const where = ["so.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push("so.requested_delivery_date IS NOT NULL AND so.requested_delivery_date <> '' AND so.requested_delivery_date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push("so.requested_delivery_date IS NOT NULL AND so.requested_delivery_date <> '' AND so.requested_delivery_date <= ?"); params.push(filters.dateTo); }
  if (customerId) { where.push('so.customer_id = ?'); params.push(customerId); }

  const rows = db.prepare(`
    SELECT
      so.id,
      so.order_no,
      so.status,
      so.total_cents,
      so.created_at,
      so.order_date,
      so.requested_delivery_date,
      so.remark,
      so.rejection_reason,
      c.id AS customerId,
      c.code AS customerCode,
      c.name AS customerName,
      (SELECT COUNT(*) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'CONFIRMED') AS confirmedDeliveryCount,
      (SELECT MAX(sd.delivery_date) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'CONFIRMED' AND sd.delivery_date IS NOT NULL AND sd.delivery_date <> '') AS latestDeliveryDate,
      (SELECT COUNT(*) FROM sales_deliveries sd
        WHERE sd.sales_order_id = so.id AND sd.status = 'DRAFT') AS draftDeliveryCount
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN so.requested_delivery_date IS NULL OR so.requested_delivery_date = '' THEN 1 ELSE 0 END,
             so.requested_delivery_date ASC, so.order_no ASC
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
      orderDate: row.order_date || null,
      commitmentDate: row.requested_delivery_date || null,
      commitmentDateMissing: !row.requested_delivery_date,
      fulfillmentState,
      fulfillmentLabel,
    };
  });

  return send(res, 200, {
    rows: enriched,
    filters: buildFilterEcho(db, filters),
    accuracy: 'DOCUMENT_LEVEL',
    dateBasis: {
      rangeFilter: '要求交期（sales_orders.requested_delivery_date）',
      orderDate: '订单日期（sales_orders.order_date）',
      shipmentLinked: '已确认出货按 sales_deliveries.delivery_date',
      commitmentDate: '要求交期；缺失时显示"业务日期缺失"',
    },
    accuracyNotes: [
      '本表为文档级口径，仅显示已审批销售订单与已确认出货单之间的关联计数与最新出货日期。',
      '本阶段保持文档级口径，不在 E5 中引入逐行未出库数量计算；',
      '日期范围按 requested_delivery_date 起止日包含过滤；缺失要求交期的 legacy 订单只在未限定日期时显示，并明确标记。',
      '逐行订货/已执行/剩余数量计算属于 E6，本阶段不改变文档级粒度。',
    ].join(''),
  });
}

// ---------- 3. Purchase Statistics ----------

const PURCHASE_DATE_BASIS = {
  order: '订单按订单日期（purchase_orders.order_date）',
  receipt: '入库按入库日期（purchase_receipts.receipt_date）',
  return: '退货按退货日期（purchase_returns.return_date）',
};

export function getPurchaseSummary(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  const filters = buildOrderFilters(url);

  const orderWhere = ["po.order_date IS NOT NULL", "po.order_date <> ''"];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('po.order_date >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('po.order_date <= ?'); orderParams.push(filters.dateTo); }
  if (filters.supplierId) { orderWhere.push('po.supplier_id = ?'); orderParams.push(filters.supplierId); }
  if (filters.status) { orderWhere.push('po.status = ?'); orderParams.push(filters.status); }

  const receiptWhere = ["pr.status = 'CONFIRMED'", "pr.receipt_date IS NOT NULL", "pr.receipt_date <> ''"];
  const receiptParams = [];
  if (filters.dateFrom) { receiptWhere.push('pr.receipt_date >= ?'); receiptParams.push(filters.dateFrom); }
  if (filters.dateTo) { receiptWhere.push('pr.receipt_date <= ?'); receiptParams.push(filters.dateTo); }
  if (filters.supplierId) { receiptWhere.push('pr.supplier_id = ?'); receiptParams.push(filters.supplierId); }

  const returnWhere = ["prt.status = 'CONFIRMED'", "(prt.return_date IS NOT NULL AND prt.return_date <> '')"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('prt.return_date >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('prt.return_date <= ?'); returnParams.push(filters.dateTo); }
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

  const orderLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM purchase_orders po
    WHERE (po.order_date IS NULL OR po.order_date = '')
      ${filters.supplierId ? 'AND po.supplier_id = ?' : ''}
      ${filters.status ? 'AND po.status = ?' : ''}
  `).get(...(filters.supplierId ? [filters.supplierId] : []), ...(filters.status ? [filters.status] : [])).count;

  const receiptLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM purchase_receipts pr
    WHERE pr.status = 'CONFIRMED' AND (pr.receipt_date IS NULL OR pr.receipt_date = '')
      ${filters.supplierId ? 'AND pr.supplier_id = ?' : ''}
  `).get(...(filters.supplierId ? [filters.supplierId] : [])).count;

  const returnLegacyMissing = db.prepare(`
    SELECT COUNT(*) AS count FROM purchase_returns prt
    WHERE prt.status = 'CONFIRMED' AND (prt.return_date IS NULL OR prt.return_date = '')
      ${filters.supplierId ? 'AND prt.supplier_id = ?' : ''}
  `).get(...(filters.supplierId ? [filters.supplierId] : [])).count;

  const netReceiptCents = summary.receiptCents - summary.returnCents;
  const legacyMissingTotal = orderLegacyMissing + receiptLegacyMissing + returnLegacyMissing;

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
          AND pr2.receipt_date IS NOT NULL AND pr2.receipt_date <> ''
          ${filters.dateFrom ? 'AND pr2.receipt_date >= ?' : ''}
          ${filters.dateTo ? 'AND pr2.receipt_date <= ?' : ''}
      ), 0) AS receiptCents
    FROM suppliers s
    LEFT JOIN purchase_orders po
      ON po.supplier_id = s.id
      AND po.order_date IS NOT NULL AND po.order_date <> ''
      ${filters.dateFrom ? 'AND po.order_date >= ?' : ''}
      ${filters.dateTo ? 'AND po.order_date <= ?' : ''}
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
    filters: buildFilterEcho(db, filters),
    dateBasis: PURCHASE_DATE_BASIS,
    legacyMissing: {
      orderWithoutDate: orderLegacyMissing,
      receiptWithoutDate: receiptLegacyMissing,
      returnWithoutDate: returnLegacyMissing,
      total: legacyMissingTotal,
    },
    moneyUnit: 'cents',
    notes: [
      '订单金额来自 purchase_orders.total_cents，按 order_date 归集；',
      '实际入库金额来自 CONFIRMED 采购入库单，按 receipt_date 归集；',
      '采购退货金额来自 CONFIRMED 采购退货单，按 return_date 归集；',
      '净入库金额 = 入库金额 - 退货金额；',
      '订单金额不等于已实现成本；',
      `业务日期缺失共 ${legacyMissingTotal} 条，未计入上方指标，已在 legacyMissing 字段按指标分解。`,
    ].join(''),
  });
}

// ---------- 4. Purchase Outstanding (Document Level) ----------

export function getPurchaseOutstanding(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  const filters = buildOrderFilters(url);
  const supplierId = filters.supplierId;

  const where = ["po.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push("po.expected_delivery_date IS NOT NULL AND po.expected_delivery_date <> '' AND po.expected_delivery_date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push("po.expected_delivery_date IS NOT NULL AND po.expected_delivery_date <> '' AND po.expected_delivery_date <= ?"); params.push(filters.dateTo); }
  if (supplierId) { where.push('po.supplier_id = ?'); params.push(supplierId); }

  const rows = db.prepare(`
    SELECT
      po.id,
      po.order_no,
      po.status,
      po.total_cents,
      po.created_at,
      po.order_date,
      po.expected_delivery_date,
      po.remark,
      po.rejection_reason,
      s.id AS supplierId,
      s.code AS supplierCode,
      s.name AS supplierName,
      (SELECT COUNT(*) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'CONFIRMED') AS confirmedReceiptCount,
      (SELECT MAX(pr.receipt_date) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'CONFIRMED' AND pr.receipt_date IS NOT NULL AND pr.receipt_date <> '') AS latestReceiptDate,
      (SELECT COUNT(*) FROM purchase_receipts pr
        WHERE pr.purchase_order_id = po.id AND pr.status = 'DRAFT') AS draftReceiptCount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN po.expected_delivery_date IS NULL OR po.expected_delivery_date = '' THEN 1 ELSE 0 END,
             po.expected_delivery_date ASC, po.order_no ASC
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
      orderDate: row.order_date || null,
      commitmentDate: row.expected_delivery_date || null,
      commitmentDateMissing: !row.expected_delivery_date,
      fulfillmentState,
      fulfillmentLabel,
    };
  });

  return send(res, 200, {
    rows: enriched,
    filters: buildFilterEcho(db, filters),
    accuracy: 'DOCUMENT_LEVEL',
    dateBasis: {
      rangeFilter: '预计到货日（purchase_orders.expected_delivery_date）',
      orderDate: '订单日期（purchase_orders.order_date）',
      receiptLinked: '已确认入库按 purchase_receipts.receipt_date',
      commitmentDate: '预计到货日；缺失时显示"业务日期缺失"',
    },
    accuracyNotes: [
      '本表为文档级口径，仅显示已审批采购订单与已确认入库单之间的关联计数与最新入库日期。',
      '本阶段保持文档级口径，不在 E5 中引入逐行未入库数量计算；',
      '日期范围按 expected_delivery_date 起止日包含过滤；缺失预计到货日的 legacy 订单只在未限定日期时显示，并明确标记。',
      '逐行订货/已执行/剩余数量计算属于 E6，本阶段不改变文档级粒度。',
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
  INVENTORY_SCRAP: '库存报废',
  PRODUCTION_MATERIAL_ISSUE: '用料出库',
  PRODUCTION_MATERIAL_RETURN: '生产退料',
  PRODUCTION_RECEIPT: '生产入库',
  PRODUCTION_RECEIPT_REVERSAL: '生产入库冲销',
  INVENTORY_ADJUSTMENT_REVERSAL: '库存调整冲销',
  INVENTORY_CHECK_REVERSAL: '库存盘点冲销',
};

const INVENTORY_DATE_BASIS = {
  flow: '库存异动按库存交易台账业务日期（inventory_transactions.business_date）；缺失时固定显示“业务日期缺失”。',
  column: 'inventory_transactions.business_date',
};

export function getInventoryMovements(db, res, actor, url) {
  requireReportVisibilityWithInventory(actor);
  const filters = buildInventoryFilters(url);

  const where = ['1=1'];
  const params = [];
  if (filters.dateFrom) { where.push('t.business_date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('t.business_date <= ?'); params.push(filters.dateTo); }
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
      u.display_name AS creatorName,
      t.business_date,
      (t.business_date IS NULL OR t.business_date = '') AS business_date_missing
    FROM inventory_transactions t
    JOIN warehouses w ON w.id = t.warehouse_id
    JOIN products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.creator_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.business_date DESC, t.id DESC
    LIMIT ?
  `).all(...params, MAX_REPORT_ROWS);

  const enriched = rows.map((row) => ({
    ...row,
    businessDate: row.business_date || null,
    businessDateMissing: row.business_date_missing ? 1 : 0,
    source_type_label: SOURCE_TYPE_LABELS[row.source_type] || '其他异动',
    direction_label: row.direction === 'IN' ? '入库' : '出库',
  }));

  const legacyMissing = db.prepare(`
    SELECT COUNT(*) AS count
    FROM inventory_transactions t
    WHERE (t.business_date IS NULL OR t.business_date = '')
      ${filters.productId ? 'AND t.product_id = ?' : ''}
      ${filters.warehouseId ? 'AND t.warehouse_id = ?' : ''}
      ${filters.direction ? 'AND t.direction = ?' : ''}
      ${filters.sourceType ? 'AND t.source_type = ?' : ''}
  `).get(
    ...(filters.productId ? [filters.productId] : []),
    ...(filters.warehouseId ? [filters.warehouseId] : []),
    ...(filters.direction ? [filters.direction] : []),
    ...(filters.sourceType ? [filters.sourceType] : []),
  ).count;

  let reconciliation = null;
  if (filters.productId && filters.warehouseId) {
    const current = db.prepare(`
      SELECT quantity
      FROM inventory
      WHERE product_id = ? AND warehouse_id = ?
    `).get(filters.productId, filters.warehouseId);
    const latestMovement = db.prepare(`
      SELECT business_date, balance_after
      FROM inventory_transactions t
      WHERE t.product_id = ? AND t.warehouse_id = ?
        AND t.business_date IS NOT NULL AND t.business_date <> ''
      ORDER BY t.business_date DESC, t.id DESC
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
    filters: buildFilterEcho(db, filters),
    dateBasis: INVENTORY_DATE_BASIS,
    legacyMissing: { withoutBusinessDate: legacyMissing },
    sourceLabels: SOURCE_TYPE_LABELS,
  });
}

// ---------- Export endpoints ----------

function readExportFormat(url) {
  const format = String(url.searchParams.get('format') || 'csv').trim().toLowerCase();
  if (format !== 'csv') {
    throw new HttpError(400, 'format 仅支持 csv', { code: 'VALIDATION' });
  }
  return format;
}

function exportHeaderLines(title, filters, echo, dateBasis) {
  const lines = [`# ${title}`, `# 生成时间: ${nowIso()}`];
  lines.push(`# 期间: ${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}`);
  for (const line of formatFilterEchoForCsv(echo)) lines.push(`# ${line}`);
  if (dateBasis) lines.push(`# 口径: ${dateBasis}`);
  return lines;
}

export function exportSalesSummaryReport(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  readExportFormat(url);
  const filters = buildOrderFilters(url);
  const echo = buildFilterEcho(db, filters);

  const orderWhere = ["so.order_date IS NOT NULL", "so.order_date <> ''"];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('so.order_date >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('so.order_date <= ?'); orderParams.push(filters.dateTo); }
  if (filters.customerId) { orderWhere.push('so.customer_id = ?'); orderParams.push(filters.customerId); }
  if (filters.status) { orderWhere.push('so.status = ?'); orderParams.push(filters.status); }
  const orderRows = db.prepare(`
    SELECT so.order_no AS orderNo, c.code AS customerCode, c.name AS customerName,
           so.status, so.total_cents AS totalCents, so.order_date AS orderDate
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${orderWhere.join(' AND ')}
    ORDER BY so.order_date DESC
    LIMIT ?
  `).all(...orderParams, MAX_EXPORT_ROWS);

  const deliveryWhere = ["sd.status = 'CONFIRMED'", "sd.delivery_date IS NOT NULL", "sd.delivery_date <> ''"];
  const deliveryParams = [];
  if (filters.dateFrom) { deliveryWhere.push('sd.delivery_date >= ?'); deliveryParams.push(filters.dateFrom); }
  if (filters.dateTo) { deliveryWhere.push('sd.delivery_date <= ?'); deliveryParams.push(filters.dateTo); }
  if (filters.customerId) { deliveryWhere.push('sd.customer_id = ?'); deliveryParams.push(filters.customerId); }
  const deliveryRows = db.prepare(`
    SELECT sd.delivery_no AS deliveryNo, c.code AS customerCode, c.name AS customerName,
           sd.status, sd.total_cents AS totalCents, sd.delivery_date AS deliveryDate
    FROM sales_deliveries sd
    JOIN customers c ON c.id = sd.customer_id
    WHERE ${deliveryWhere.join(' AND ')}
    ORDER BY sd.delivery_date DESC
    LIMIT ?
  `).all(...deliveryParams, MAX_EXPORT_ROWS);

  const returnWhere = ["ro.source_type = 'SALES'", "ro.status = 'CONFIRMED'", "ro.return_date IS NOT NULL", "ro.return_date <> ''"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('ro.return_date >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('ro.return_date <= ?'); returnParams.push(filters.dateTo); }
  if (filters.customerId) { returnWhere.push('ro.customer_id = ?'); returnParams.push(filters.customerId); }
  const returnRows = db.prepare(`
    SELECT ro.return_no AS returnNo, c.code AS customerCode, c.name AS customerName,
           ro.status, ro.total_cents AS totalCents, ro.return_date AS returnDate
    FROM return_orders ro
    JOIN customers c ON c.id = ro.customer_id
    WHERE ${returnWhere.join(' AND ')}
    ORDER BY ro.return_date DESC
    LIMIT ?
  `).all(...returnParams, MAX_EXPORT_ROWS);

  const header = ['类别', '单号', '客户编码', '客户名称', '状态', '金额（分）', '业务日期'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of orderRows) tableLines.push(['订单', row.orderNo, row.customerCode, row.customerName, row.status, row.totalCents, row.orderDate].map(csvEscape).join(','));
  for (const row of deliveryRows) tableLines.push(['出货', row.deliveryNo, row.customerCode, row.customerName, row.status, row.totalCents, row.deliveryDate].map(csvEscape).join(','));
  for (const row of returnRows) tableLines.push(['退货', row.returnNo, row.customerCode, row.customerName, row.status, row.totalCents, row.returnDate].map(csvEscape).join(','));

  writeCsv(res, 'sales-summary.csv',
    exportHeaderLines('销售统计（V1.4-E5 期间业务活动）', filters, echo, '订单按 order_date；出货按 delivery_date；退货按 return_date；legacy 缺日期未纳入。'),
    tableLines);
}

export function exportSalesOutstandingReport(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  readExportFormat(url);
  const filters = buildOrderFilters(url);
  const echo = buildFilterEcho(db, filters);

  const where = ["so.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push("so.requested_delivery_date IS NOT NULL AND so.requested_delivery_date <> '' AND so.requested_delivery_date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push("so.requested_delivery_date IS NOT NULL AND so.requested_delivery_date <> '' AND so.requested_delivery_date <= ?"); params.push(filters.dateTo); }
  if (filters.customerId) { where.push('so.customer_id = ?'); params.push(filters.customerId); }

  const rows = db.prepare(`
    SELECT so.order_no AS orderNo, c.code AS customerCode, c.name AS customerName,
           so.total_cents AS totalCents, so.order_date AS orderDate,
           so.requested_delivery_date AS commitmentDate,
           (SELECT COUNT(*) FROM sales_deliveries sd
             WHERE sd.sales_order_id = so.id AND sd.status = 'CONFIRMED') AS confirmedDeliveryCount
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN so.requested_delivery_date IS NULL OR so.requested_delivery_date = '' THEN 1 ELSE 0 END,
             so.requested_delivery_date ASC, so.order_no ASC
    LIMIT ?
  `).all(...params, MAX_EXPORT_ROWS);

  const header = ['订单号', '客户编码', '客户名称', '订单金额（分）', '订单日期', '要求交期', '已确认出货单数'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    tableLines.push([row.orderNo, row.customerCode, row.customerName, row.totalCents, row.orderDate || '业务日期缺失', row.commitmentDate || '业务日期缺失', row.confirmedDeliveryCount].map(csvEscape).join(','));
  }

  writeCsv(res, 'sales-outstanding.csv',
    exportHeaderLines('销售未交（V1.4-E5 文档级）', filters, echo, '日期范围按 requested_delivery_date 起止日包含过滤；缺失值明确显示"业务日期缺失"。'),
    tableLines);
}

export function exportPurchaseSummaryReport(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  readExportFormat(url);
  const filters = buildOrderFilters(url);
  const echo = buildFilterEcho(db, filters);

  const orderWhere = ["po.order_date IS NOT NULL", "po.order_date <> ''"];
  const orderParams = [];
  if (filters.dateFrom) { orderWhere.push('po.order_date >= ?'); orderParams.push(filters.dateFrom); }
  if (filters.dateTo) { orderWhere.push('po.order_date <= ?'); orderParams.push(filters.dateTo); }
  if (filters.supplierId) { orderWhere.push('po.supplier_id = ?'); orderParams.push(filters.supplierId); }
  if (filters.status) { orderWhere.push('po.status = ?'); orderParams.push(filters.status); }
  const orderRows = db.prepare(`
    SELECT po.order_no AS orderNo, s.code AS supplierCode, s.name AS supplierName,
           po.status, po.total_cents AS totalCents, po.order_date AS orderDate
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE ${orderWhere.join(' AND ')}
    ORDER BY po.order_date DESC
    LIMIT ?
  `).all(...orderParams, MAX_EXPORT_ROWS);

  const receiptWhere = ["pr.status = 'CONFIRMED'", "pr.receipt_date IS NOT NULL", "pr.receipt_date <> ''"];
  const receiptParams = [];
  if (filters.dateFrom) { receiptWhere.push('pr.receipt_date >= ?'); receiptParams.push(filters.dateFrom); }
  if (filters.dateTo) { receiptWhere.push('pr.receipt_date <= ?'); receiptParams.push(filters.dateTo); }
  if (filters.supplierId) { receiptWhere.push('pr.supplier_id = ?'); receiptParams.push(filters.supplierId); }
  const receiptRows = db.prepare(`
    SELECT pr.receipt_no AS receiptNo, s.code AS supplierCode, s.name AS supplierName,
           pr.status, pr.total_cents AS totalCents, pr.receipt_date AS receiptDate
    FROM purchase_receipts pr
    JOIN suppliers s ON s.id = pr.supplier_id
    WHERE ${receiptWhere.join(' AND ')}
    ORDER BY pr.receipt_date DESC
    LIMIT ?
  `).all(...receiptParams, MAX_EXPORT_ROWS);

  const returnWhere = ["prt.status = 'CONFIRMED'", "(prt.return_date IS NOT NULL AND prt.return_date <> '')"];
  const returnParams = [];
  if (filters.dateFrom) { returnWhere.push('prt.return_date >= ?'); returnParams.push(filters.dateFrom); }
  if (filters.dateTo) { returnWhere.push('prt.return_date <= ?'); returnParams.push(filters.dateTo); }
  if (filters.supplierId) { returnWhere.push('prt.supplier_id = ?'); returnParams.push(filters.supplierId); }
  const returnRows = db.prepare(`
    SELECT prt.return_no AS returnNo, s.code AS supplierCode, s.name AS supplierName,
           prt.status, prt.total_cents AS totalCents, prt.return_date AS returnDate
    FROM purchase_returns prt
    JOIN suppliers s ON s.id = prt.supplier_id
    WHERE ${returnWhere.join(' AND ')}
    ORDER BY prt.return_date DESC
    LIMIT ?
  `).all(...returnParams, MAX_EXPORT_ROWS);

  const header = ['类别', '单号', '供应商编码', '供应商名称', '状态', '金额（分）', '业务日期'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of orderRows) tableLines.push(['订单', row.orderNo, row.supplierCode, row.supplierName, row.status, row.totalCents, row.orderDate].map(csvEscape).join(','));
  for (const row of receiptRows) tableLines.push(['入库', row.receiptNo, row.supplierCode, row.supplierName, row.status, row.totalCents, row.receiptDate].map(csvEscape).join(','));
  for (const row of returnRows) tableLines.push(['退货', row.returnNo, row.supplierCode, row.supplierName, row.status, row.totalCents, row.returnDate].map(csvEscape).join(','));

  writeCsv(res, 'purchase-summary.csv',
    exportHeaderLines('采购统计（V1.4-E5 期间业务活动）', filters, echo, '订单按 order_date；入库按 receipt_date；退货按 return_date；legacy 缺日期未纳入。'),
    tableLines);
}

export function exportPurchaseOutstandingReport(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  readExportFormat(url);
  const filters = buildOrderFilters(url);
  const echo = buildFilterEcho(db, filters);

  const where = ["po.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push("po.expected_delivery_date IS NOT NULL AND po.expected_delivery_date <> '' AND po.expected_delivery_date >= ?"); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push("po.expected_delivery_date IS NOT NULL AND po.expected_delivery_date <> '' AND po.expected_delivery_date <= ?"); params.push(filters.dateTo); }
  if (filters.supplierId) { where.push('po.supplier_id = ?'); params.push(filters.supplierId); }

  const rows = db.prepare(`
    SELECT po.order_no AS orderNo, s.code AS supplierCode, s.name AS supplierName,
           po.total_cents AS totalCents, po.order_date AS orderDate,
           po.expected_delivery_date AS commitmentDate,
           (SELECT COUNT(*) FROM purchase_receipts pr
             WHERE pr.purchase_order_id = po.id AND pr.status = 'CONFIRMED') AS confirmedReceiptCount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN po.expected_delivery_date IS NULL OR po.expected_delivery_date = '' THEN 1 ELSE 0 END,
             po.expected_delivery_date ASC, po.order_no ASC
    LIMIT ?
  `).all(...params, MAX_EXPORT_ROWS);

  const header = ['订单号', '供应商编码', '供应商名称', '订单金额（分）', '订单日期', '预计到货日', '已确认入库单数'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    tableLines.push([row.orderNo, row.supplierCode, row.supplierName, row.totalCents, row.orderDate || '业务日期缺失', row.commitmentDate || '业务日期缺失', row.confirmedReceiptCount].map(csvEscape).join(','));
  }

  writeCsv(res, 'purchase-outstanding.csv',
    exportHeaderLines('采购未交（V1.4-E5 文档级）', filters, echo, '日期范围按 expected_delivery_date 起止日包含过滤；缺失值明确显示"业务日期缺失"。'),
    tableLines);
}

export function exportInventoryMovementsReport(db, res, actor, url) {
  requireReportVisibilityWithInventory(actor);
  readExportFormat(url);
  const filters = buildInventoryFilters(url);
  const echo = buildFilterEcho(db, filters);

  const where = ['1=1'];
  const params = [];
  if (filters.dateFrom) { where.push('t.business_date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('t.business_date <= ?'); params.push(filters.dateTo); }
  if (filters.productId) { where.push('t.product_id = ?'); params.push(filters.productId); }
  if (filters.warehouseId) { where.push('t.warehouse_id = ?'); params.push(filters.warehouseId); }
  if (filters.direction) { where.push('t.direction = ?'); params.push(filters.direction); }
  if (filters.sourceType) { where.push('t.source_type = ?'); params.push(filters.sourceType); }

  const rows = db.prepare(`
    SELECT
      t.business_date,
      t.direction, t.quantity_change, t.balance_after,
      t.source_type, t.source_no, t.remark,
      p.code AS productCode, p.name AS productName,
      w.code AS warehouseCode, w.name AS warehouseName
    FROM inventory_transactions t
    JOIN warehouses w ON w.id = t.warehouse_id
    JOIN products p ON p.id = t.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.business_date DESC, t.id DESC
    LIMIT ?
  `).all(...params, MAX_EXPORT_ROWS);

  const header = ['业务日期', '产品编码', '产品名称', '仓库编码', '仓库名称', '方向', '变动数量', '结存', '来源类型', '来源单号', '备注'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    tableLines.push([
      row.business_date || '业务日期缺失',
      row.productCode,
      row.productName,
      row.warehouseCode,
      row.warehouseName,
      row.direction === 'IN' ? '入库' : '出库',
      row.quantity_change,
      row.balance_after,
      SOURCE_TYPE_LABELS[row.source_type] || row.source_type,
      row.source_no || '',
      row.remark || '',
    ].map(csvEscape).join(','));
  }

  writeCsv(res, 'inventory-movements.csv',
    exportHeaderLines('库存异动明细（V1.4-E5 按来源业务日期）', filters, echo, '按各 source_type 业务日期；缺权威日期的记录固定显示"业务日期缺失"。'),
    tableLines);
}

// Exported so focused tests can introspect the canonical label map.
export const DECISION_REPORT_SOURCE_LABELS = Object.freeze(SOURCE_TYPE_LABELS);
