// V1.4-E5 / V2 Wave 4C — read-only lookup transports.
//
// After V2 Wave 4C this module owns the canonical implementations for
// every read-only lookup endpoint under /api/lookup/* and
// /api/lookups/*. It exposes two intentionally distinct lookup
// categories that share no permission model and no inactiveness contract:
//
//   A. transaction / logistics-scoped lookups (4 handlers):
//     `listSupplierLookup`, `listCustomerLookup`,
//     `listSalesOrderSourceLookup`, `listPurchaseOrderSourceLookup`.
//     They were migrated verbatim from server/app.js so the route-table
//     becomes the single dispatch entry. They retain their existing
//     transaction / CRM / return-workflow permission gates and they
//     continue to filter on `active=1`; downstream warehouse, sales
//     delivery, returns and purchase-receipt workflows rely on this
//     strict active-only contract.
//
//   B. report-filter business-entity lookup (1 handler):
//     `searchBusinessEntities` (V1.4-E5 C02). It is bounded by
//     REPORT_VIEW intersected with the per-usage domain permissions
//     (REPORT_SALES / REPORT_PURCHASE / REPORT_INVENTORY) and is
//     allowed to surface inactive historical records so that report
//     filters can still reference periods where the party is no longer
//     active.
//
// The two categories must NOT be merged into a single endpoint or a
// single permission model: their permission gates, inactiveness /
// archive semantics, and SQL projections are intentionally different.

import { allowAny, HttpError, send } from '../lib/http.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';

// =================================================================
// V2 Wave 4C — transaction / logistics-scoped lookups (migrated from
// server/app.js verbatim). These four handlers were the canonical
// implementations behind /api/lookup/suppliers, /api/lookup/customers,
// /api/lookup/sales-orders-source and /api/lookup/purchase-orders-source
// prior to Wave 4C. The bodies below are byte-identical to the
// pre-migration handlers; only the registration site changed.
// =================================================================

// ============ Narrow Lookups (warehouse / logistics-flavored) ============
// Return minimal id+code+name projections so warehouse workflows (purchase
// receipts, sales deliveries, returns) can populate party pickers without
// granting full master-data *_MANAGE permissions. Gated by INVENTORY_VIEW
// which warehouse already holds. Safe for production: the response body
// contains no PII, no contact info, no balances.
//
// Pattern matches warehouse / logistics-flavored pickers.
export function listSupplierLookup(db, res, actor, url) {
  allowAny(actor, ['PURCHASE_RECEIPTS_MANAGE', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const suppliers = db.prepare("SELECT id, code, name FROM suppliers WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY code").all(search, search);
  return send(res, 200, { suppliers });
}

export function listCustomerLookup(db, res, actor, url) {
  allowAny(actor, ['SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const customers = db.prepare("SELECT id, code, name FROM customers WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY code").all(search, search);
  return send(res, 200, { customers });
}

// Minimal read-only projection of APPROVED sales orders eligible as the
// optional source for Sales Delivery forms. Gated by the logistics
// permission that authorizes creating/managing Sales Delivery (no
// ORDERS_VIEW required) so the warehouse role can populate the optional
// source selector without gaining broad Sales Order module access. Items
// are included so the form can prefill quantities / unit prices from the
// dropdown selection without a follow-up /api/orders/:id call (which
// would require ORDERS_VIEW).
export function listSalesOrderSourceLookup(db, res, actor, url) {
  // V1.3 Phase 1: sales uses ORDERS_CREATE (rather than the logistics
  // execute rights it no longer holds) to source approved sales orders
  // for downstream PR / PO prefill; warehouse / return managers still
  // have their dedicated logistics permissions for the legacy path.
  allowAny(actor, ['ORDERS_CREATE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const archiveFilter = lifecycleArchiveFilter('SALES_ORDER', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'so.id' });
  const headerStmt = db.prepare(`
    SELECT so.id, so.order_no orderNo, so.status, so.total_cents totalCents, so.created_at createdAt,
           c.id customerId, c.code customerCode, c.name customerName
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    WHERE so.status = 'APPROVED'
      ${archiveFilter.clause ? `AND ${archiveFilter.clause}` : ''}
      AND (so.order_no LIKE ? OR c.code LIKE ? OR c.name LIKE ?)
    ORDER BY so.created_at DESC
    LIMIT 100
  `);
  const itemStmt = db.prepare(`
    SELECT soi.id salesOrderItemId, soi.product_id productId, soi.quantity orderedQuantity,
           soi.quantity-COALESCE((SELECT SUM(sdi.quantity) FROM sales_delivery_items sdi JOIN sales_deliveries sd ON sd.id=sdi.delivery_id WHERE sdi.sales_order_item_id=soi.id AND sd.status='CONFIRMED'),0) quantity,
           COALESCE((SELECT SUM(sdi.quantity) FROM sales_delivery_items sdi JOIN sales_deliveries sd ON sd.id=sdi.delivery_id WHERE sdi.sales_order_item_id=soi.id AND sd.status='CONFIRMED'),0) deliveredQuantity,
           soi.unit_price_cents unitPriceCents,
           p.code productCode, p.name productName, p.unit
    FROM sales_order_items soi JOIN products p ON p.id = soi.product_id
    WHERE soi.order_id = ?
    ORDER BY soi.line_no
  `);
  const orders = headerStmt.all(search, search, search).map((row) => ({
    ...row,
    items: itemStmt.all(row.id),
  }));
  return send(res, 200, { orders });
}

// Symmetric to listSalesOrderSourceLookup but for the Purchase Order
// prefill (used by purchase-receipt, sales-delivery/PR/PO generation).
// V1.3 Phase 1: sales uses PURCHASE_ORDERS_CREATE (rather than the
// logistics execute rights it no longer holds) to source approved
// purchase orders for downstream PR / PO prefill; warehouse / return
// managers still have their dedicated logistics permissions for the
// legacy path.
export function listPurchaseOrderSourceLookup(db, res, actor, url) {
  allowAny(actor, ['PURCHASE_ORDERS_CREATE', 'PURCHASE_RECEIPTS_MANAGE', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const archiveFilter = lifecycleArchiveFilter('PURCHASE_ORDER', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'po.id' });
  const headerStmt = db.prepare(`
    SELECT po.id, po.order_no orderNo, po.status, po.total_cents totalCents, po.created_at createdAt,
           s.id supplierId, s.code supplierCode, s.name supplierName
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status = 'APPROVED'
      ${archiveFilter.clause ? `AND ${archiveFilter.clause}` : ''}
      AND (po.order_no LIKE ? OR s.code LIKE ? OR s.name LIKE ?)
    ORDER BY po.created_at DESC
    LIMIT 100
  `);
  const itemStmt = db.prepare(`
    SELECT poi.id purchaseOrderItemId, poi.product_id productId, poi.quantity orderedQuantity,
           poi.quantity-COALESCE((SELECT SUM(pri.quantity) FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id=pri.receipt_id WHERE pri.purchase_order_item_id=poi.id AND pr.status='CONFIRMED'),0) quantity,
           COALESCE((SELECT SUM(pri.quantity) FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id=pri.receipt_id WHERE pri.purchase_order_item_id=poi.id AND pr.status='CONFIRMED'),0) receivedQuantity,
           poi.unit_price_cents unitPriceCents,
           p.code productCode, p.name productName, p.unit
    FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id
    WHERE poi.order_id = ?
    ORDER BY poi.line_no
  `);
  const purchaseOrders = headerStmt.all(search, search, search).map((row) => ({
    ...row,
    items: itemStmt.all(row.id),
  }));
  return send(res, 200, { purchaseOrders });
}

// Each entry binds a public `type` to its master table, the projected
// columns, the join-free boolean expression that marks whether a row
// carries an authoritative active flag, and an optional code-prefix
// column. Adding a new entity type here also requires adding it to the
// `USAGE_PERMISSIONS` registry so that the lookup cannot be repurposed
// outside REPORT_* usages.
const ENTITY_REGISTRY = Object.freeze({
  CUSTOMER: Object.freeze({
    table: 'customers',
    codeColumn: 'code',
    nameColumn: 'name',
    activeColumn: 'active',
  }),
  SUPPLIER: Object.freeze({
    table: 'suppliers',
    codeColumn: 'code',
    nameColumn: 'name',
    activeColumn: 'active',
  }),
  PRODUCT: Object.freeze({
    table: 'products',
    codeColumn: 'code',
    nameColumn: 'name',
    activeColumn: 'active',
  }),
  WAREHOUSE: Object.freeze({
    table: 'warehouses',
    codeColumn: 'code',
    nameColumn: 'name',
    activeColumn: 'active',
  }),
});

// V1.4 scope: REPORT_SALES / REPORT_PURCHASE / REPORT_INVENTORY. The
// per-usage permission set is the intersection required by the report
// the user is filtering for. TRANSACTION_* usages are explicitly
// deferred per solution.md §21.5 and are not accepted here.
const USAGE_PERMISSIONS = Object.freeze({
  REPORT_SALES: Object.freeze([
    'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE',
    'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE',
  ]),
  REPORT_PURCHASE: Object.freeze([
    'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT',
    'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE',
  ]),
  REPORT_INVENTORY: Object.freeze([
    'INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE',
    'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_TRANSFER_CONFIRM',
    'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE',
    'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE',
  ]),
});

const USAGE_ENTITY_TYPES = Object.freeze({
  REPORT_SALES: Object.freeze(['CUSTOMER']),
  REPORT_PURCHASE: Object.freeze(['SUPPLIER']),
  REPORT_INVENTORY: Object.freeze(['PRODUCT', 'WAREHOUSE']),
});

const MAX_QUERY_LENGTH = 50;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeType(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'type 必须是字符串', { code: 'VALIDATION' });
  }
  const upper = value.trim().toUpperCase();
  if (!ENTITY_REGISTRY[upper]) {
    throw new HttpError(400, 'type 不是受支持的实体类型', { code: 'VALIDATION' });
  }
  return upper;
}

function normalizeUsage(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'usage 必须是字符串', { code: 'VALIDATION' });
  }
  const upper = value.trim().toUpperCase();
  if (!USAGE_PERMISSIONS[upper]) {
    throw new HttpError(400, 'usage 不是受支持的报告用途', {
      code: 'BUSINESS_ENTITY_USAGE_UNSUPPORTED',
      resolution: '本查询仅服务 REPORT_SALES / REPORT_PURCHASE / REPORT_INVENTORY 三种报告筛选',
    });
  }
  return upper;
}

function normalizeQuery(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (text.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `查询条件不能超过 ${MAX_QUERY_LENGTH} 个字符`, { code: 'VALIDATION' });
  }
  // Bound wildcard expansion so the prepared statement cannot be
  // coerced into expensive scans by unusual punctuation. Strip the
  // handful of LIKE wildcards users occasionally paste.
  return text.replace(/[%_\\]/g, '').trim();
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, 'limit 必须为正整数', { code: 'VALIDATION' });
  }
  return Math.min(parsed, MAX_LIMIT);
}

function buildWhereClause(query) {
  // Empty query → caller only wants historical hydration for selectedId.
  // Non-empty query → code prefix OR name contains (case-insensitive).
  if (!query) return { clause: '1=1', params: [] };
  const pattern = `%${query}%`;
  const prefix = `${query}%`;
  return {
    clause: '(LOWER(code) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?))',
    params: [prefix, pattern],
  };
}

export function searchBusinessEntities(db, res, actor, url) {
  allowAny(actor, ['REPORT_VIEW']);

  const type = normalizeType(url.searchParams.get('type'));
  const usage = normalizeUsage(url.searchParams.get('usage'));
  if (!USAGE_ENTITY_TYPES[usage].includes(type)) {
    throw new HttpError(400, 'type 不适用于当前报告用途', {
      code: 'BUSINESS_ENTITY_TYPE_UNSUPPORTED',
      resolution: '销售报表仅查找客户，采购报表仅查找供应商，库存报表仅查找产品或仓库',
    });
  }
  const domainPermissions = USAGE_PERMISSIONS[usage];
  if (!domainPermissions.some((permission) => actor.permissions.includes(permission))) {
    throw new HttpError(403, '没有查看此实体的权限', {
      code: 'PERMISSION_DENIED',
      resolution: '本实体查找仅在当前报告权限范围内可见',
    });
  }

  const entry = ENTITY_REGISTRY[type];
  const query = normalizeQuery(url.searchParams.get('q'));
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const selectedIdRaw = url.searchParams.get('selectedId');
  const selectedId = selectedIdRaw ? String(selectedIdRaw).trim() : '';

  const where = buildWhereClause(query);

  // Fetch one extra row so we can derive hasMore without a second round
  // trip. Limit + 1 is the standard "is there another page?" probe.
  const rows = db.prepare(
    `SELECT id, code, name, ${entry.activeColumn} AS active
     FROM ${entry.table}
     WHERE ${where.clause}
     ORDER BY active DESC, code ASC
     LIMIT ?`
  ).all(...where.params, limit + 1);

  let items = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active ? 1 : 0,
    label: row.active ? `${row.code} · ${row.name}` : `${row.code} · ${row.name}（已停用）`,
  }));

  // Historical hydration: if the caller passed a selectedId that did not
  // surface in the page (e.g. inactive historical entity, typo, or the
  // result set pushed it past the limit), look it up directly so the UI
  // can still display the active filter.
  if (selectedId && !items.some((item) => item.id === selectedId)) {
    const hydration = db.prepare(
      `SELECT id, code, name, ${entry.activeColumn} AS active
       FROM ${entry.table}
       WHERE id = ?`
    ).get(selectedId);
    if (hydration) {
      items = [{
        id: hydration.id,
        code: hydration.code,
        name: hydration.name,
        active: hydration.active ? 1 : 0,
        label: hydration.active
          ? `${hydration.code} · ${hydration.name}`
          : `${hydration.code} · ${hydration.name}（已停用）`,
      }, ...items];
    }
  }

  const hasMore = items.length > limit;
  if (hasMore) items = items.slice(0, limit);

  return send(res, 200, {
    type,
    usage,
    items,
    hasMore,
    query,
    limit,
  });
}

export const __ENTITY_REGISTRY = ENTITY_REGISTRY;
export const __USAGE_PERMISSIONS = USAGE_PERMISSIONS;
export const __USAGE_ENTITY_TYPES = USAGE_ENTITY_TYPES;
