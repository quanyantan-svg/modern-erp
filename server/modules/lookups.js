// V1.4-E5 — C02 bounded business-object lookup.
//
// Read-only minimal projections of customer / supplier / product /
// warehouse records. Intentionally scoped to the four entity types
// listed in solution.md §21.5, used as report filter selectors only.
//
// Why a separate module instead of the legacy /api/lookup/customers /
// /api/lookup/suppliers endpoints:
//   * Those legacy endpoints filter `active=1` and return full master
//     records. V1.4 reports require INACTIVE historical records so
//     inactive customers/suppliers/products/warehouses can still be
//     selected for historical period filters.
//   * Their permission scopes are tied to transaction-module visibility
//     (PURCHASE_RECEIPTS_MANAGE, CRM_VIEW, ...). Report filters must
//     follow REPORT_VIEW + the same domain intersection the report
//     itself uses, not the transaction-module scope.
//   * This module binds the registry to a fixed `usage` value and
//     rejects `TRANSACTION_*` usages, so it cannot accidentally be
//     repurposed as a master-data enumeration endpoint.

import { allowAny, HttpError, send } from '../lib/http.js';

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
