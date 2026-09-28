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
// Outstanding reports (V1.4-E6):
//   * each row is one approved order line;
//   * only confirmed execution rows with an exact source-line identity
//     contribute to fulfilled / received quantity;
//   * ordinary returns never reopen the original order obligation;
//   * source-incomplete legacy execution is disclosed, never guessed.
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
const QUANTITY_EPSILON = 1e-9;

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
  const includeFulfilledValue = url.searchParams.get('includeFulfilled');
  if (includeFulfilledValue && !['true', 'false'].includes(includeFulfilledValue)) {
    throw new HttpError(400, 'includeFulfilled 必须为 true 或 false');
  }
  const asOfDate = parseDateParam(url.searchParams.get('asOfDate'), '截至日期') || new Date().toISOString().slice(0, 10);
  return { dateFrom, dateTo, customerId, supplierId, status, includeFulfilled: includeFulfilledValue === 'true', asOfDate };
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
  if (filters.includeFulfilled != null) out.includeFulfilled = Boolean(filters.includeFulfilled);
  if (filters.asOfDate) out.asOfDate = filters.asOfDate;
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

// ---------- 2 / 4. Line-level fulfillment (V1.4-E6) ----------

const FULFILLMENT_REPORTS = Object.freeze({
  'sales-outstanding': {
    kind: 'sales',
    orderTable: 'sales_orders', itemTable: 'sales_order_items', partyTable: 'customers',
    partyIdColumn: 'customer_id', partyFilter: 'customerId', partyKey: 'customer',
    executionTable: 'sales_deliveries', executionItemTable: 'sales_delivery_items',
    executionHeaderFk: 'delivery_id', executionOrderFk: 'sales_order_id', sourceItemColumn: 'sales_order_item_id',
    documentNoColumn: 'delivery_no', businessDateColumn: 'delivery_date',
    commitmentColumn: 'requested_delivery_date', commitmentKey: 'requiredDeliveryDate',
    executedKey: 'fulfilledQuantity', executionLabel: '销售出货',
  },
  'purchase-outstanding': {
    kind: 'purchase',
    orderTable: 'purchase_orders', itemTable: 'purchase_order_items', partyTable: 'suppliers',
    partyIdColumn: 'supplier_id', partyFilter: 'supplierId', partyKey: 'supplier',
    executionTable: 'purchase_receipts', executionItemTable: 'purchase_receipt_items',
    executionHeaderFk: 'receipt_id', executionOrderFk: 'purchase_order_id', sourceItemColumn: 'purchase_order_item_id',
    documentNoColumn: 'receipt_no', businessDateColumn: 'receipt_date',
    commitmentColumn: 'expected_delivery_date', commitmentKey: 'expectedReceiptDate',
    executedKey: 'receivedQuantity', executionLabel: '采购入库',
  },
});

function calendarDayDifference(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function classifyFulfillment(ordered, executed) {
  if (executed > ordered + QUANTITY_EPSILON) return 'OVER_FULFILLED';
  if (executed <= QUANTITY_EPSILON) return 'UNFULFILLED';
  if (executed + QUANTITY_EPSILON < ordered) return 'PARTIAL';
  return 'FULFILLED';
}

function lineSort(left, right) {
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  const leftMissing = !left.commitmentDate;
  const rightMissing = !right.commitmentDate;
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (left.commitmentDate !== right.commitmentDate) return String(left.commitmentDate || '').localeCompare(String(right.commitmentDate || ''));
  if (left.orderNumber !== right.orderNumber) return left.orderNumber.localeCompare(right.orderNumber);
  if (left.lineNumber !== right.lineNumber) return left.lineNumber - right.lineNumber;
  return left.orderItemId.localeCompare(right.orderItemId);
}

function buildFulfillmentWhere(config, filters) {
  const where = ["o.status = 'APPROVED'"];
  const params = [];
  if (filters.dateFrom) { where.push(`o.${config.commitmentColumn} IS NOT NULL AND o.${config.commitmentColumn} <> '' AND o.${config.commitmentColumn} >= ?`); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push(`o.${config.commitmentColumn} IS NOT NULL AND o.${config.commitmentColumn} <> '' AND o.${config.commitmentColumn} <= ?`); params.push(filters.dateTo); }
  if (filters[config.partyFilter]) { where.push(`o.${config.partyIdColumn} = ?`); params.push(filters[config.partyFilter]); }
  return { where, params };
}

function queryLegacyUnattributed(db, config, filters) {
  const where = ["e.status = 'CONFIRMED'", `ei.${config.sourceItemColumn} IS NULL`];
  const params = [];
  if (filters[config.partyFilter]) { where.push(`e.${config.partyIdColumn} = ?`); params.push(filters[config.partyFilter]); }
  const documents = db.prepare(`
    SELECT e.id AS documentId, e.${config.documentNoColumn} AS documentNumber,
           e.${config.executionOrderFk} AS orderId, COUNT(ei.id) AS lineCount
    FROM ${config.executionTable} e
    JOIN ${config.executionItemTable} ei ON ei.${config.executionHeaderFk} = e.id
    WHERE ${where.join(' AND ')}
    GROUP BY e.id, e.${config.documentNoColumn}, e.${config.executionOrderFk}
    ORDER BY e.${config.documentNoColumn}, e.id
    LIMIT 50
  `).all(...params);
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${config.executionTable} e
    JOIN ${config.executionItemTable} ei ON ei.${config.executionHeaderFk} = e.id
    WHERE ${where.join(' AND ')}
  `).get(...params).count);
  return { count: total, documents };
}

function queryFulfillmentLines(db, reportKey, filters, limit) {
  const config = FULFILLMENT_REPORTS[reportKey];
  const { where, params } = buildFulfillmentWhere(config, filters);
  const executionAggregate = `
      SELECT ei.${config.sourceItemColumn} AS orderItemId,
             SUM(ei.quantity) AS executedQuantity, COUNT(*) AS contributionCount
      FROM ${config.executionItemTable} ei
      JOIN ${config.executionTable} e ON e.id = ei.${config.executionHeaderFk}
      WHERE e.status = 'CONFIRMED' AND ei.${config.sourceItemColumn} IS NOT NULL
      GROUP BY ei.${config.sourceItemColumn}`;
  const visibilityClause = filters.includeFulfilled ? '' : `
      AND (COALESCE(exec.executedQuantity, 0) < oi.quantity - ${QUANTITY_EPSILON}
        OR COALESCE(exec.executedQuantity, 0) > oi.quantity + ${QUANTITY_EPSILON})`;
  const raw = db.prepare(`
    SELECT o.id AS orderId, o.order_no AS orderNumber, o.order_date AS orderDate,
           o.${config.commitmentColumn} AS commitmentDate,
           oi.id AS orderItemId, oi.line_no AS lineNumber, oi.quantity AS orderedQuantity,
           party.id AS partyId, party.code AS partyCode, party.name AS partyName,
           p.id AS productId, p.code AS productCode, p.name AS productName, p.unit AS productUnit,
           COALESCE(exec.executedQuantity, 0) AS executedQuantity,
           COALESCE(exec.contributionCount, 0) AS contributionCount,
           COALESCE(legacy.legacyLineCount, 0) AS legacyLineCount
    FROM ${config.orderTable} o
    JOIN ${config.itemTable} oi ON oi.order_id = o.id
    JOIN ${config.partyTable} party ON party.id = o.${config.partyIdColumn}
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN (${executionAggregate}) exec ON exec.orderItemId = oi.id
    LEFT JOIN (
      SELECT e.${config.executionOrderFk} AS orderId, COUNT(ei.id) AS legacyLineCount
      FROM ${config.executionTable} e
      JOIN ${config.executionItemTable} ei ON ei.${config.executionHeaderFk} = e.id
      WHERE e.status = 'CONFIRMED' AND ei.${config.sourceItemColumn} IS NULL
        AND e.${config.executionOrderFk} IS NOT NULL
      GROUP BY e.${config.executionOrderFk}
    ) legacy ON legacy.orderId = o.id
    WHERE ${where.join(' AND ')}${visibilityClause}
    ORDER BY o.order_no, oi.line_no, oi.id
    LIMIT ?
  `).all(...params, limit);

  const population = db.prepare(`
    SELECT COUNT(*) AS matchingLines,
           COALESCE(SUM(CASE WHEN COALESCE(exec.executedQuantity, 0) >= oi.quantity - ${QUANTITY_EPSILON}
                              AND COALESCE(exec.executedQuantity, 0) <= oi.quantity + ${QUANTITY_EPSILON}
                         THEN 1 ELSE 0 END), 0) AS fulfilledLines
    FROM ${config.orderTable} o
    JOIN ${config.itemTable} oi ON oi.order_id = o.id
    LEFT JOIN (${executionAggregate}) exec ON exec.orderItemId = oi.id
    WHERE ${where.join(' AND ')}
  `).get(...params);

  const allRows = raw.map((row) => {
    const orderedQuantity = Number(row.orderedQuantity);
    const executedQuantity = Number(row.executedQuantity);
    const fulfillmentStatus = classifyFulfillment(orderedQuantity, executedQuantity);
    const overFulfilledQuantity = fulfillmentStatus === 'OVER_FULFILLED' ? executedQuantity - orderedQuantity : 0;
    const remainingQuantity = fulfillmentStatus === 'OVER_FULFILLED' ? 0 : Math.max(orderedQuantity - executedQuantity, 0);
    const commitmentDate = row.commitmentDate || null;
    const overdue = remainingQuantity > QUANTITY_EPSILON && Boolean(commitmentDate) && commitmentDate < filters.asOfDate;
    const legacyAccuracyLimited = Number(row.legacyLineCount) > 0;
    const accuracyStatus = fulfillmentStatus === 'OVER_FULFILLED' ? 'INCONSISTENT' : legacyAccuracyLimited ? 'LIMITED' : 'COMPLETE';
    const party = { id: row.partyId, code: row.partyCode, name: row.partyName };
    return {
      id: row.orderId,
      order_no: row.orderNumber,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderItemId: row.orderItemId,
      lineNumber: Number(row.lineNumber),
      orderDate: row.orderDate || null,
      [config.partyKey]: party,
      product: { id: row.productId, code: row.productCode, name: row.productName, unit: row.productUnit },
      orderedQuantity,
      executedQuantity,
      [config.executedKey]: executedQuantity,
      remainingQuantity,
      overFulfilledQuantity,
      commitmentDate,
      [config.commitmentKey]: commitmentDate,
      commitmentDateMissing: !commitmentDate,
      fulfillmentStatus,
      overdue,
      overdueDays: overdue ? calendarDayDifference(commitmentDate, filters.asOfDate) : null,
      accuracyStatus,
      legacyAccuracyLimited,
      legacyReason: legacyAccuracyLimited ? 'LEGACY_SOURCE_MISSING' : null,
      contributionCount: Number(row.contributionCount),
    };
  }).sort(lineSort);
  const rows = allRows;
  return {
    rows,
    population: {
      matchingLines: Number(population.matchingLines),
      hiddenFulfilledLines: filters.includeFulfilled ? 0 : Number(population.fulfilledLines),
      returnedLines: rows.length,
    },
    legacyUnattributed: queryLegacyUnattributed(db, config, filters),
  };
}

function fulfillmentResponse(db, reportKey, filters, limit) {
  const config = FULFILLMENT_REPORTS[reportKey];
  const result = queryFulfillmentLines(db, reportKey, filters, limit);
  const limitedRows = result.rows.filter((row) => row.accuracyStatus !== 'COMPLETE').length;
  return {
    ...result,
    filters: buildFilterEcho(db, filters),
    reportKey,
    granularity: 'ORDER_LINE',
    accuracy: limitedRows || result.legacyUnattributed.count ? 'LIMITED' : 'COMPLETE',
    accuracyNotice: result.legacyUnattributed.count
      ? `历史数据 / 来源行缺失：${result.legacyUnattributed.count} 条已确认${config.executionLabel}明细未计入逐行履约数量。`
      : null,
    asOfDate: filters.asOfDate,
    dateBasis: {
      rangeFilter: config.kind === 'sales' ? '要求交期（sales_orders.requested_delivery_date）' : '预计到货日（purchase_orders.expected_delivery_date）',
      commitmentDate: config.kind === 'sales' ? '要求交期；缺失时显示“未设置交期”' : '预计到货日；缺失时显示“未设置交期”',
      overdue: `剩余数量大于 0 且承诺日期早于截至日期 ${filters.asOfDate}`,
    },
  };
}

export function getSalesOutstanding(db, res, actor, url) {
  requireReportVisibilityWithSales(actor);
  return send(res, 200, fulfillmentResponse(db, 'sales-outstanding', buildOrderFilters(url), MAX_REPORT_ROWS));
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

export function getPurchaseOutstanding(db, res, actor, url) {
  requireReportVisibilityWithPurchase(actor);
  return send(res, 200, fulfillmentResponse(db, 'purchase-outstanding', buildOrderFilters(url), MAX_REPORT_ROWS));
}

export function getFulfillmentContributions(db, res, actor, reportKey, orderItemId) {
  const config = FULFILLMENT_REPORTS[reportKey];
  if (!config) {
    throw new HttpError(400, '不支持的履约报表类型', {
      code: 'UNSUPPORTED_REPORT_KEY',
      resolution: '请从销售未交或采购未收报表打开履约明细',
    });
  }
  if (config.kind === 'sales') requireReportVisibilityWithSales(actor);
  else requireReportVisibilityWithPurchase(actor);
  if (!orderItemId || orderItemId.length > 200) {
    throw new HttpError(400, '订单行标识无效', { code: 'VALIDATION' });
  }
  const orderLine = db.prepare(`
    SELECT oi.id AS orderItemId, oi.order_id AS orderId, oi.line_no AS lineNumber,
           oi.quantity AS orderedQuantity, o.order_no AS orderNumber
    FROM ${config.itemTable} oi
    JOIN ${config.orderTable} o ON o.id = oi.order_id
    WHERE oi.id = ? AND o.status = 'APPROVED'
  `).get(orderItemId);
  if (!orderLine) {
    throw new HttpError(404, '订单行不存在或当前不可访问', {
      code: 'REPORT_LINE_NOT_FOUND',
      resolution: '返回报表并重新选择可访问的订单行',
    });
  }
  const contributions = db.prepare(`
    SELECT e.id AS sourceDocumentId, e.${config.documentNoColumn} AS sourceDocumentNumber,
           ei.id AS sourceLineId, ei.line_no AS sourceLineNumber, ei.quantity,
           e.${config.businessDateColumn} AS businessDate, e.status,
           w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName
    FROM ${config.executionItemTable} ei
    JOIN ${config.executionTable} e ON e.id = ei.${config.executionHeaderFk}
    LEFT JOIN warehouses w ON w.id = e.warehouse_id
    WHERE ei.${config.sourceItemColumn} = ? AND e.status = 'CONFIRMED'
    ORDER BY e.${config.businessDateColumn}, e.${config.documentNoColumn}, ei.line_no, ei.id
  `).all(orderItemId).map((row) => ({
    sourceDocumentType: config.kind === 'sales' ? 'SALES_DELIVERY' : 'PURCHASE_RECEIPT',
    sourceDocumentLabel: config.executionLabel,
    sourceDocumentId: row.sourceDocumentId,
    sourceDocumentNumber: row.sourceDocumentNumber,
    sourceLineId: row.sourceLineId,
    sourceLineNumber: Number(row.sourceLineNumber),
    businessDate: row.businessDate || null,
    quantity: Number(row.quantity),
    warehouse: row.warehouseId ? { id: row.warehouseId, code: row.warehouseCode, name: row.warehouseName } : null,
    status: row.status,
    linkage: 'EXACT_ORDER_LINE',
  }));
  const legacy = db.prepare(`
    SELECT COUNT(ei.id) AS count
    FROM ${config.executionTable} e
    JOIN ${config.executionItemTable} ei ON ei.${config.executionHeaderFk} = e.id
    WHERE e.status = 'CONFIRMED' AND e.${config.executionOrderFk} = ?
      AND ei.${config.sourceItemColumn} IS NULL
  `).get(orderLine.orderId);
  const executedQuantity = contributions.reduce((sum, row) => sum + row.quantity, 0);
  return send(res, 200, {
    reportKey,
    orderLine: {
      orderId: orderLine.orderId,
      orderNumber: orderLine.orderNumber,
      orderItemId: orderLine.orderItemId,
      lineNumber: Number(orderLine.lineNumber),
      orderedQuantity: Number(orderLine.orderedQuantity),
    },
    executedQuantity,
    contributions,
    accuracyStatus: Number(legacy.count) > 0 ? 'LIMITED' : 'COMPLETE',
    informationalItems: Number(legacy.count) > 0 ? [{
      code: 'LEGACY_SOURCE_MISSING',
      message: `该订单存在 ${legacy.count} 条已确认${config.executionLabel}明细缺少来源行，未猜测归属且未计入贡献数量。`,
    }] : [],
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
  const { rows, legacyUnattributed } = queryFulfillmentLines(db, 'sales-outstanding', filters, MAX_EXPORT_ROWS);
  const header = ['销售订单', '行号', '客户编码', '客户名称', '产品编码', '产品名称', '订货数量', '已出货', '剩余数量', '要求交期', '履行状态', '是否逾期', '逾期天数', '准确度', '历史说明'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    tableLines.push([row.orderNumber, row.lineNumber, row.customer.code, row.customer.name, row.product.code, row.product.name,
      row.orderedQuantity, row.fulfilledQuantity, row.remainingQuantity, row.commitmentDate || '未设置交期',
      row.fulfillmentStatus, row.overdue ? '是' : '否', row.overdueDays ?? '', row.accuracyStatus,
      row.legacyAccuracyLimited ? '历史数据 / 来源信息不完整，已确认出货可能未完整归属' : ''].map(csvEscape).join(','));
  }

  writeCsv(res, 'sales-outstanding.csv',
    [...exportHeaderLines('销售未交（V1.4-E6 订单行级）', filters, echo, `日期范围按 requested_delivery_date；截至 ${filters.asOfDate}；已履行${filters.includeFulfilled ? '显示' : '隐藏'}。`),
      `# 未归属 legacy 出货明细: ${legacyUnattributed.count}`],
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
  const { rows, legacyUnattributed } = queryFulfillmentLines(db, 'purchase-outstanding', filters, MAX_EXPORT_ROWS);
  const header = ['采购订单', '行号', '供应商编码', '供应商名称', '产品编码', '产品名称', '订货数量', '已收货', '剩余数量', '预计到货日', '履行状态', '是否逾期', '逾期天数', '准确度', '历史说明'];
  const tableLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    tableLines.push([row.orderNumber, row.lineNumber, row.supplier.code, row.supplier.name, row.product.code, row.product.name,
      row.orderedQuantity, row.receivedQuantity, row.remainingQuantity, row.commitmentDate || '未设置交期',
      row.fulfillmentStatus, row.overdue ? '是' : '否', row.overdueDays ?? '', row.accuracyStatus,
      row.legacyAccuracyLimited ? '历史数据 / 来源信息不完整，已确认入库可能未完整归属' : ''].map(csvEscape).join(','));
  }

  writeCsv(res, 'purchase-outstanding.csv',
    [...exportHeaderLines('采购未收（V1.4-E6 订单行级）', filters, echo, `日期范围按 expected_delivery_date；截至 ${filters.asOfDate}；已履行${filters.includeFulfilled ? '显示' : '隐藏'}。`),
      `# 未归属 legacy 入库明细: ${legacyUnattributed.count}`],
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
