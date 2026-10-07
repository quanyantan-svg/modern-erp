// Planning Domain Closure — canonical planning decisions and read models.
// This module never owns product/warehouse/inventory/BOM/substitute or
// downstream execution facts. It stores policy, allocation and decision rows
// that reference those authorities.

import { createHash } from 'node:crypto';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STRATEGIES = new Set(['AUTO', 'MAKE', 'BUY', 'OUTSOURCE']);
const SCOPE_MODES = new Set(['GLOBAL', 'SELECTED', 'PRECISE_SELECTED']);
const RESERVATION_TYPES = new Set(['STRONG', 'WEAK', 'MANUAL']);
const SUPPLY_TYPES = new Set(['MAKE', 'BUY', 'OUTSOURCE']);
const EPS = 1e-9;

const nowIso = () => new Date().toISOString();
const asBool = (value) => value === true || value === 1 || value === '1';
const finiteNonNegative = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, `${label}必须为非负数`);
  return number;
};
const finitePositive = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return number;
};
const dateOrNull = (value, label) => {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  return text;
};
const json = (value) => JSON.stringify(value ?? null);
const parseJson = (value, fallback = null) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const lockRow = (db, table, rowId) => db.prepare(`UPDATE ${table} SET id=id WHERE id=?`).run(rowId);
const makeNumber = (db, table, prefix) => {
  const day = nowIso().slice(0, 10).replaceAll('-', '');
  const count = Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count) + 1;
  return `${prefix}-${day}-${String(count).padStart(4, '0')}`;
};

export function getPlanningParameters(db, res, actor) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const parameters = db.prepare("SELECT * FROM planning_parameters WHERE id='DEFAULT'").get();
  return send(res, 200, { parameters: { ...parameters, reservation_enabled: Boolean(parameters?.reservation_enabled) } });
}

export async function updatePlanningParameters(db, req, res, actor) {
  allow(actor, 'PLANNING_CONFIG_MANAGE');
  const body = await readJson(req);
  if (body.reservationEnabled === undefined && body.reservation_enabled === undefined) throw new HttpError(400, '请提供是否启用预留');
  const enabled = asBool(body.reservationEnabled ?? body.reservation_enabled) ? 1 : 0;
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE planning_parameters SET reservation_enabled=?,updated_by=?,updated_at=? WHERE id='DEFAULT'")
      .run(enabled, actor.id, now);
    audit(db, actor.id, 'UPDATE', 'PLANNING_PARAMETERS', 'DEFAULT', `预留=${enabled ? '启用' : '停用'}`);
  });
  return send(res, 200, { ok: true, reservationEnabled: Boolean(enabled) });
}

export function listMaterialPolicies(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const search = `%${String(url.searchParams.get('search') || '').trim()}%`;
  const rows = db.prepare(`SELECT mp.*,p.code product_code,p.name product_name,p.unit
    FROM planning_material_policies mp JOIN products p ON p.id=mp.product_id
    WHERE p.code LIKE ? OR p.name LIKE ? ORDER BY p.code LIMIT 500`).all(search, search);
  return send(res, 200, { policies: rows });
}

export async function updateMaterialPolicy(db, req, res, actor, productId) {
  allow(actor, 'PLANNING_CONFIG_MANAGE');
  const body = await readJson(req);
  const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(404, '产品不存在或已停用');
  const current = db.prepare('SELECT * FROM planning_material_policies WHERE product_id=?').get(productId);
  if (!current) throw new HttpError(409, '物料计划策略尚未初始化');
  const safety = finiteNonNegative(body.safetyStock ?? body.safety_stock ?? current.safety_stock, '安全库存');
  const reorder = finiteNonNegative(body.reorderPoint ?? body.reorder_point ?? current.reorder_point, '再订货点');
  const maximum = finiteNonNegative(body.maximumStock ?? body.maximum_stock ?? current.maximum_stock, '最高库存');
  const eoq = finiteNonNegative(body.economicOrderQuantity ?? body.economic_order_quantity ?? current.economic_order_quantity, '经济订货批量');
  const lead = finiteNonNegative(body.leadTimeDays ?? body.lead_time_days ?? current.lead_time_days, '提前期');
  if (!Number.isInteger(lead)) throw new HttpError(400, '提前期必须为整数天');
  if (maximum > 0 && safety > maximum) throw new HttpError(400, '安全库存不能高于最高库存');
  if (maximum > 0 && reorder > maximum) throw new HttpError(400, '再订货点不能高于最高库存');
  const strategy = String(body.supplyStrategy ?? body.supply_strategy ?? current.supply_strategy).toUpperCase();
  if (!STRATEGIES.has(strategy)) throw new HttpError(400, '供应策略无效');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE planning_material_policies SET safety_stock=?,reorder_point=?,maximum_stock=?,economic_order_quantity=?,lead_time_days=?,supply_strategy=?,updated_by=?,updated_at=? WHERE product_id=?`)
      .run(safety, reorder, maximum, eoq, lead, strategy, actor.id, now, productId);
    // Compatibility projection for legacy dashboard/reorder reports. This is
    // not an independent write path.
    db.prepare('UPDATE products SET min_stock=?,reorder_point=?,max_stock=?,lead_time_days=?,updated_at=? WHERE id=?')
      .run(safety, reorder, maximum, lead, now, productId);
    audit(db, actor.id, 'UPDATE', 'PLANNING_MATERIAL_POLICY', current.id, `${product.code} ${strategy}`);
  });
  return send(res, 200, { ok: true });
}

function schemeDto(db, row) {
  if (!row) return row;
  const demandSources = db.prepare('SELECT source_type,enabled FROM planning_scheme_demand_sources WHERE scheme_id=? ORDER BY source_type').all(row.id);
  const supplySources = db.prepare('SELECT source_type,enabled FROM planning_scheme_supply_sources WHERE scheme_id=? ORDER BY source_type').all(row.id);
  const warehouses = db.prepare(`SELECT sw.warehouse_id,sw.participates,w.code,w.name
    FROM planning_scheme_warehouses sw JOIN warehouses w ON w.id=sw.warehouse_id WHERE sw.scheme_id=? ORDER BY w.code`).all(row.id);
  return { ...row, demandSources, supplySources, warehouses };
}

export function listPlanningSchemes(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const status = String(url.searchParams.get('status') || '');
  const rows = status
    ? db.prepare('SELECT * FROM planning_schemes WHERE status=? ORDER BY scheme_code').all(status)
    : db.prepare('SELECT * FROM planning_schemes ORDER BY scheme_code').all();
  return send(res, 200, { schemes: rows.map((row) => schemeDto(db, row)) });
}

export function getPlanningScheme(db, res, actor, schemeId) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const row = db.prepare('SELECT * FROM planning_schemes WHERE id=?').get(schemeId);
  if (!row) throw new HttpError(404, '计划方案不存在');
  return send(res, 200, { scheme: schemeDto(db, row) });
}

function validateSchemeBody(body, current = {}) {
  const code = requiredText(body.schemeCode ?? body.scheme_code ?? current.scheme_code, '方案编码', 40).toUpperCase();
  const name = requiredText(body.schemeName ?? body.scheme_name ?? current.scheme_name, '方案名称', 100);
  const horizon = Number(body.horizonDays ?? body.horizon_days ?? current.horizon_days ?? 90);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 3660) throw new HttpError(400, '计划跨度必须为 1-3660 天');
  const mode = String(body.calculationScopeMode ?? body.calculation_scope_mode ?? current.calculation_scope_mode ?? 'GLOBAL').toUpperCase();
  if (!SCOPE_MODES.has(mode)) throw new HttpError(400, '计算范围模式无效');
  const releasePolicy = String(body.reservationReleasePolicy ?? body.reservation_release_policy ?? current.reservation_release_policy ?? 'KEEP_ALL').toUpperCase();
  if (!['KEEP_ALL', 'RELEASE_WEAK'].includes(releasePolicy)) throw new HttpError(400, '预留释放策略无效');
  const force = body.forceSupplyStrategy ?? body.force_supply_strategy ?? current.force_supply_strategy ?? null;
  if (force && !['MAKE', 'BUY', 'OUTSOURCE'].includes(String(force).toUpperCase())) throw new HttpError(400, '强制供应策略无效');
  return { code, name, horizon, mode, releasePolicy, force: force ? String(force).toUpperCase() : null };
}

function replaceSchemeChildren(db, schemeId, body) {
  const demand = body.demandSources ?? body.demand_sources;
  const supply = body.supplySources ?? body.supply_sources;
  const warehouses = body.warehouses;
  if (Array.isArray(demand)) {
    db.prepare('DELETE FROM planning_scheme_demand_sources WHERE scheme_id=?').run(schemeId);
    const insert = db.prepare('INSERT INTO planning_scheme_demand_sources(id,scheme_id,source_type,enabled) VALUES(?,?,?,1)');
    for (const source of [...new Set(demand.map((value) => String(value).toUpperCase()))]) {
      if (!['SALES_ORDER', 'FORECAST', 'SAFETY_STOCK', 'BOM_COMPONENT'].includes(source)) throw new HttpError(400, `需求来源 ${source} 无效`);
      insert.run(id(), schemeId, source);
    }
  }
  if (Array.isArray(supply)) {
    db.prepare('DELETE FROM planning_scheme_supply_sources WHERE scheme_id=?').run(schemeId);
    const insert = db.prepare('INSERT INTO planning_scheme_supply_sources(id,scheme_id,source_type,enabled) VALUES(?,?,?,1)');
    for (const source of [...new Set(supply.map((value) => String(value).toUpperCase()))]) {
      if (!['ON_HAND', 'PURCHASE_ORDER', 'PRODUCTION_ORDER', 'PLANNED_ORDER'].includes(source)) throw new HttpError(400, `供应来源 ${source} 无效`);
      insert.run(id(), schemeId, source);
    }
  }
  if (Array.isArray(warehouses)) {
    db.prepare('DELETE FROM planning_scheme_warehouses WHERE scheme_id=?').run(schemeId);
    const insert = db.prepare('INSERT INTO planning_scheme_warehouses(id,scheme_id,warehouse_id,participates) VALUES(?,?,?,1)');
    for (const warehouseId of [...new Set(warehouses.map((value) => String(value)))]) {
      if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) throw new HttpError(400, '方案包含不存在或停用的仓库');
      insert.run(id(), schemeId, warehouseId);
    }
  }
}

export async function createPlanningScheme(db, req, res, actor) {
  allow(actor, 'PLANNING_CONFIG_MANAGE');
  const body = await readJson(req);
  const value = validateSchemeBody(body);
  const schemeId = id();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`INSERT INTO planning_schemes(id,scheme_code,scheme_name,status,horizon_days,calculation_scope_mode,reservation_release_policy,merge_policy,release_make,release_buy,release_outsource,force_supply_strategy,include_overdue_supply,notes,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',?,?,?,'PRODUCT_DATE',1,1,0,?,0,?,?,?, ?,?)`)
      .run(schemeId, value.code, value.name, value.horizon, value.mode, value.releasePolicy, value.force, String(body.notes || '').slice(0, 500), actor.id, actor.id, now, now);
    replaceSchemeChildren(db, schemeId, {
      demandSources: body.demandSources ?? ['SALES_ORDER', 'FORECAST', 'SAFETY_STOCK', 'BOM_COMPONENT'],
      supplySources: body.supplySources ?? ['ON_HAND', 'PURCHASE_ORDER', 'PRODUCTION_ORDER', 'PLANNED_ORDER'],
      warehouses: body.warehouses ?? db.prepare('SELECT id FROM warehouses WHERE active=1').all().map((row) => row.id),
    });
    audit(db, actor.id, 'CREATE', 'PLANNING_SCHEME', schemeId, `${value.code} ${value.name}`);
  });
  return send(res, 201, { id: schemeId });
}

export async function updatePlanningScheme(db, req, res, actor, schemeId) {
  allow(actor, 'PLANNING_CONFIG_MANAGE');
  const body = await readJson(req);
  const current = db.prepare('SELECT * FROM planning_schemes WHERE id=?').get(schemeId);
  if (!current) throw new HttpError(404, '计划方案不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿计划方案可以编辑');
  const value = validateSchemeBody(body, current);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE planning_schemes SET scheme_code=?,scheme_name=?,horizon_days=?,calculation_scope_mode=?,reservation_release_policy=?,force_supply_strategy=?,notes=?,updated_by=?,updated_at=? WHERE id=?`)
      .run(value.code, value.name, value.horizon, value.mode, value.releasePolicy, value.force, String(body.notes ?? current.notes ?? '').slice(0, 500), actor.id, now, schemeId);
    replaceSchemeChildren(db, schemeId, body);
    audit(db, actor.id, 'UPDATE', 'PLANNING_SCHEME', schemeId, value.code);
  });
  return send(res, 200, { ok: true });
}

export function changePlanningSchemeStatus(db, res, actor, schemeId, target) {
  allow(actor, 'PLANNING_CONFIG_MANAGE');
  const status = String(target).toUpperCase();
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new HttpError(400, '计划方案目标状态无效');
  transaction(db, () => {
    lockRow(db, 'planning_schemes', schemeId);
    const current = db.prepare('SELECT * FROM planning_schemes WHERE id=?').get(schemeId);
    if (!current) throw new HttpError(404, '计划方案不存在');
    if (status === 'ACTIVE') {
      const demandCount = Number(db.prepare('SELECT COUNT(*) count FROM planning_scheme_demand_sources WHERE scheme_id=? AND enabled=1').get(schemeId).count);
      const supplyCount = Number(db.prepare('SELECT COUNT(*) count FROM planning_scheme_supply_sources WHERE scheme_id=? AND enabled=1').get(schemeId).count);
      if (!demandCount || !supplyCount) throw new HttpError(409, '计划方案必须至少包含一个需求来源和一个供应来源');
    }
    const now = nowIso();
    db.prepare('UPDATE planning_schemes SET status=?,updated_by=?,updated_at=? WHERE id=?').run(status, actor.id, now, schemeId);
    audit(db, actor.id, status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', 'PLANNING_SCHEME', schemeId, current.scheme_code);
  });
  return send(res, 200, { ok: true, status });
}

export function loadSchemeSnapshot(db, schemeId) {
  if (!schemeId) return null;
  const row = db.prepare('SELECT * FROM planning_schemes WHERE id=?').get(schemeId);
  if (!row) throw new HttpError(404, '计划方案不存在');
  if (row.status !== 'ACTIVE') throw new HttpError(409, '只有已启用的计划方案可用于 MRP');
  return schemeDto(db, row);
}

export function allocateForecastConsumption(salesRows, forecastRows) {
  const forecast = forecastRows.map((row) => ({ ...row, remaining: Number(row.quantity) }))
    .sort((a, b) => String(a.needDate).localeCompare(String(b.needDate)) || String(a.itemId).localeCompare(String(b.itemId)));
  const allocations = [];
  const salesRemainders = [];
  const sortedSales = [...salesRows].sort((a, b) => String(a.needDate).localeCompare(String(b.needDate)) || String(a.orderId).localeCompare(String(b.orderId)));
  for (const sale of sortedSales) {
    let remaining = Number(sale.quantity);
    const candidates = forecast.filter((bucket) => bucket.productId === sale.productId && bucket.remaining > EPS)
      .sort((a, b) => Number(a.needDate > sale.needDate) - Number(b.needDate > sale.needDate) || a.needDate.localeCompare(b.needDate) || a.itemId.localeCompare(b.itemId));
    for (const bucket of candidates) {
      if (remaining <= EPS) break;
      const quantity = Math.min(remaining, bucket.remaining);
      if (quantity <= EPS) continue;
      allocations.push({ forecastItemId: bucket.itemId, salesOrderId: sale.orderId, productId: sale.productId, salesNeedDate: sale.needDate, quantity });
      bucket.remaining -= quantity;
      remaining -= quantity;
    }
    salesRemainders.push({ ...sale, unconsumedQuantity: Math.max(0, remaining) });
  }
  return { allocations, salesRemainders, forecastRemainders: forecast };
}

export function listForecastConsumption(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const runId = url.searchParams.get('runId') || url.searchParams.get('run_id');
  const where = runId ? 'WHERE fc.run_id=?' : '';
  const rows = db.prepare(`SELECT fc.*,f.forecast_id,f.need_date forecast_need_date,f.quantity original_quantity,
    pf.forecast_code,p.code product_code,p.name product_name,so.order_no,
    (SELECT COALESCE(SUM(x.quantity),0) FROM forecast_consumptions x WHERE x.forecast_item_id=fc.forecast_item_id AND x.run_id=fc.run_id) consumed_quantity
    FROM forecast_consumptions fc JOIN planning_forecast_items f ON f.id=fc.forecast_item_id
    JOIN planning_forecasts pf ON pf.id=f.forecast_id JOIN products p ON p.id=fc.product_id
    JOIN sales_orders so ON so.id=fc.sales_order_id ${where} ORDER BY fc.created_at,fc.id`).all(...(runId ? [runId] : []));
  return send(res, 200, { consumptions: rows.map((row) => ({ ...row, remaining_quantity: Math.max(0, Number(row.original_quantity) - Number(row.consumed_quantity)) })) });
}

function plannedOrderDto(db, row) {
  const sources = db.prepare('SELECT * FROM planned_order_source_links WHERE planned_order_id=? ORDER BY created_at,id').all(row.id);
  const byproducts = db.prepare(`SELECT b.*,p.code product_code,p.name product_name FROM planned_order_byproducts b JOIN products p ON p.id=b.product_id WHERE b.planned_order_id=?`).all(row.id);
  return { ...row, sources, byproducts, remaining_quantity: Math.max(0, Number(row.quantity) - Number(row.released_quantity)) };
}

export function listPlannedOrders(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const status = url.searchParams.get('status');
  const rows = status
    ? db.prepare(`SELECT po.*,p.code product_code,p.name product_name,p.unit FROM planned_orders po JOIN products p ON p.id=po.product_id WHERE po.status=? ORDER BY po.need_date,po.order_no`).all(status)
    : db.prepare(`SELECT po.*,p.code product_code,p.name product_name,p.unit FROM planned_orders po JOIN products p ON p.id=po.product_id ORDER BY po.created_at DESC LIMIT 500`).all();
  return send(res, 200, { plannedOrders: rows.map((row) => plannedOrderDto(db, row)) });
}

export function getPlannedOrder(db, res, actor, orderId) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const row = db.prepare(`SELECT po.*,p.code product_code,p.name product_name,p.unit FROM planned_orders po JOIN products p ON p.id=po.product_id WHERE po.id=?`).get(orderId);
  if (!row) throw new HttpError(404, '计划订单不存在');
  return send(res, 200, { plannedOrder: plannedOrderDto(db, row) });
}

export async function createPlannedOrder(db, req, res, actor) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const productId = requiredText(body.productId ?? body.product_id, '产品', 100);
  if (!db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(productId)) throw new HttpError(400, '产品不存在或已停用');
  const quantity = finitePositive(body.quantity, '计划数量');
  const supplyType = String(body.supplyType ?? body.supply_type ?? 'BUY').toUpperCase();
  if (!SUPPLY_TYPES.has(supplyType)) throw new HttpError(400, '供应类型无效');
  const orderId = id(); const now = nowIso(); const orderNo = makeNumber(db, 'planned_orders', 'PLO');
  transaction(db, () => {
    db.prepare(`INSERT INTO planned_orders(id,order_no,source_type,product_id,quantity,need_date,planned_supply_date,supply_type,status,notes,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,'MANUAL',?,?,?,?,?,'DRAFT',?,?,?,?,?)`).run(orderId, orderNo, productId, quantity,
      dateOrNull(body.needDate ?? body.need_date, '需求日期'), dateOrNull(body.plannedSupplyDate ?? body.planned_supply_date, '计划供应日期'), supplyType,
      String(body.notes || '').slice(0, 500), actor.id, actor.id, now, now);
    db.prepare(`INSERT INTO planned_order_source_links(id,planned_order_id,source_type,source_id,quantity,created_at) VALUES(?,?,'MANUAL',?,?,?)`)
      .run(id(), orderId, orderId, quantity, now);
    audit(db, actor.id, 'CREATE', 'PLANNED_ORDER', orderId, orderNo);
  });
  return send(res, 201, { id: orderId, orderNo });
}

export function materializePlannedOrders(db, runId, actor) {
  const run = db.prepare("SELECT * FROM mrp_runs WHERE id=? AND status='COMPLETED'").get(runId);
  if (!run) throw new HttpError(409, '只有已完成的 MRP 可以形成计划订单');
  const now = nowIso(); let created = 0;
  transaction(db, () => {
    const rows = db.prepare("SELECT * FROM mrp_run_results WHERE run_id=? AND suggested_quantity>0 AND COALESCE(supply_type,suggestion_type)<>'' ORDER BY id").all(runId);
    for (const result of rows) {
      if (db.prepare('SELECT 1 FROM planned_orders WHERE mrp_result_id=?').get(result.id)) continue;
      const orderId = id(); const orderNo = makeNumber(db, 'planned_orders', 'PLO');
      db.prepare(`INSERT INTO planned_orders(id,order_no,source_type,mrp_run_id,mrp_result_id,product_id,quantity,need_date,planned_supply_date,supply_type,status,notes,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,'MRP',?,?,?,?,?,?,?,'DRAFT','',?,?,?,?)`).run(orderId, orderNo, runId, result.id, result.product_id, Number(result.suggested_quantity), result.need_by_date, result.need_by_date, result.supply_type || result.suggestion_type, actor.id, actor.id, now, now);
      db.prepare(`INSERT INTO planned_order_source_links(id,planned_order_id,source_type,source_id,quantity,created_at) VALUES(?,?,'MRP_RESULT',?,?,?)`)
        .run(id(), orderId, result.id, Number(result.suggested_quantity), now);
      audit(db, actor.id, 'CREATE', 'PLANNED_ORDER', orderId, `${orderNo} from ${run.run_code}`);
      created += 1;
    }
  });
  return created;
}

export function confirmPlannedOrder(db, res, actor, orderId) {
  allow(actor, 'MRP_MANAGE');
  transaction(db, () => {
    lockRow(db, 'planned_orders', orderId);
    const row = db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId);
    if (!row) throw new HttpError(404, '计划订单不存在');
    if (row.status === 'CONFIRMED') return;
    if (row.status !== 'DRAFT') throw new HttpError(409, '只有草稿计划订单可以确认');
    const now = nowIso();
    db.prepare("UPDATE planned_orders SET status='CONFIRMED',confirmed_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?").run(now, actor.id, now, orderId);
    audit(db, actor.id, 'CONFIRM', 'PLANNED_ORDER', orderId, row.order_no);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}

export async function changePlannedOrderTarget(db, req, res, actor, orderId) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const target = String(body.supplyType ?? body.supply_type ?? '').toUpperCase();
  if (!SUPPLY_TYPES.has(target)) throw new HttpError(400, '供应类型无效');
  const reason = requiredText(body.reason, '变更原因', 300);
  transaction(db, () => {
    lockRow(db, 'planned_orders', orderId);
    const row = db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId);
    if (!row) throw new HttpError(404, '计划订单不存在');
    if (!['DRAFT', 'CONFIRMED'].includes(row.status) || Number(row.released_quantity) > EPS) throw new HttpError(409, '已释放的计划订单不能改变供应类型');
    const now = nowIso();
    db.prepare('UPDATE planned_orders SET supply_type=?,target_change_reason=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?')
      .run(target, reason, actor.id, now, orderId);
    audit(db, actor.id, 'TARGET_CHANGE', 'PLANNED_ORDER', orderId, `${row.supply_type}→${target}; ${reason}`);
  });
  return send(res, 200, { ok: true, supplyType: target });
}

export async function splitPlannedOrder(db, req, res, actor, orderId) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const childQuantity = finitePositive(body.quantity, '拆分数量');
  let childId; let childNo;
  transaction(db, () => {
    lockRow(db, 'planned_orders', orderId);
    const parent = db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId);
    if (!parent) throw new HttpError(404, '计划订单不存在');
    if (!['DRAFT', 'CONFIRMED'].includes(parent.status)) throw new HttpError(409, '当前状态不能拆分');
    const available = Number(parent.quantity) - Number(parent.released_quantity);
    if (childQuantity >= available - EPS) throw new HttpError(409, '拆分数量必须小于未释放数量');
    childId = id(); childNo = makeNumber(db, 'planned_orders', 'PLO'); const now = nowIso();
    db.prepare('UPDATE planned_orders SET quantity=quantity-?,updated_by=?,updated_at=?,version=version+1 WHERE id=?').run(childQuantity, actor.id, now, orderId);
    db.prepare(`INSERT INTO planned_orders(id,order_no,source_type,mrp_run_id,product_id,quantity,need_date,planned_supply_date,supply_type,status,reservation_state,release_state,notes,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(childId, childNo, parent.source_type, parent.mrp_run_id, parent.product_id, childQuantity, parent.need_date, parent.planned_supply_date,
      parent.supply_type, parent.status, parent.reservation_state, 'NOT_RELEASED', parent.notes, actor.id, actor.id, now, now);
    const links = db.prepare('SELECT * FROM planned_order_source_links WHERE planned_order_id=? ORDER BY id').all(orderId);
    const total = links.reduce((sum, link) => sum + Number(link.quantity), 0) || Number(parent.quantity);
    for (const link of links) {
      const splitQty = childQuantity * Number(link.quantity) / total;
      db.prepare('UPDATE planned_order_source_links SET quantity=quantity-? WHERE id=?').run(splitQty, link.id);
      db.prepare('INSERT INTO planned_order_source_links(id,planned_order_id,source_type,source_id,source_line_id,quantity,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id(), childId, link.source_type, link.source_id, link.source_line_id, splitQty, now);
    }
    audit(db, actor.id, 'SPLIT', 'PLANNED_ORDER', orderId, `${parent.order_no}→${childNo} ${childQuantity}`);
  });
  return send(res, 201, { id: childId, orderNo: childNo });
}

export async function mergePlannedOrders(db, req, res, actor) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const ids = [...new Set((body.ids || []).map(String))].sort();
  if (ids.length < 2) throw new HttpError(400, '至少选择两张计划订单');
  let targetId = ids[0];
  transaction(db, () => {
    for (const orderId of ids) lockRow(db, 'planned_orders', orderId);
    const rows = ids.map((orderId) => db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId));
    if (rows.some((row) => !row)) throw new HttpError(404, '计划订单不存在');
    const first = rows[0];
    if (rows.some((row) => !['DRAFT', 'CONFIRMED'].includes(row.status) || row.status !== first.status || row.product_id !== first.product_id || row.supply_type !== first.supply_type || row.need_date !== first.need_date || Number(row.released_quantity) > EPS)) {
      throw new HttpError(409, '所选计划订单的产品、类型、日期、状态或释放情况不兼容');
    }
    const now = nowIso();
    for (const row of rows.slice(1)) {
      db.prepare('UPDATE planned_orders SET quantity=quantity+?,updated_by=?,updated_at=?,version=version+1 WHERE id=?').run(Number(row.quantity), actor.id, now, targetId);
      db.prepare('UPDATE planned_order_source_links SET planned_order_id=? WHERE planned_order_id=?').run(targetId, row.id);
      db.prepare("UPDATE planned_orders SET status='CLOSED',merged_into_id=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?").run(targetId, actor.id, now, row.id);
    }
    audit(db, actor.id, 'MERGE', 'PLANNED_ORDER', targetId, ids.join(','));
  });
  return send(res, 200, { ok: true, id: targetId });
}

export async function closeOrCancelPlannedOrder(db, res, actor, orderId, target) {
  allow(actor, 'MRP_MANAGE');
  const status = String(target).toUpperCase();
  transaction(db, () => {
    lockRow(db, 'planned_orders', orderId);
    const row = db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId);
    if (!row) throw new HttpError(404, '计划订单不存在');
    if (!['CLOSED', 'CANCELLED'].includes(status)) throw new HttpError(400, '目标状态无效');
    if (status === 'CANCELLED' && Number(row.released_quantity) > EPS) throw new HttpError(409, '已有下游释放的计划订单不能取消');
    if (['CLOSED', 'CANCELLED'].includes(row.status)) return;
    const now = nowIso();
    db.prepare('UPDATE planned_orders SET status=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?').run(status, actor.id, now, orderId);
    audit(db, actor.id, status, 'PLANNED_ORDER', orderId, row.order_no);
  });
  return send(res, 200, { ok: true, status });
}

function ensureInstructionCompatibilitySnapshot(db, row, actorId, now) {
  if (row.mrp_run_id && row.mrp_result_id) return row;
  const runId = id();
  const resultId = id();
  const businessDate = row.need_date || now.slice(0, 10);
  const runCode = `MANUAL-${row.order_no}`;
  db.prepare(`INSERT INTO mrp_runs(id,run_code,run_name,horizon_start,horizon_end,demand_source_mode,status,summary,created_by,created_at,updated_at,completed_at)
    VALUES(?,?,?, ?,?,'SALES_ORDERS','COMPLETED',?,?, ?,?,?)`)
    .run(runId, runCode, `Manual planned order ${row.order_no}`, businessDate, businessDate,
      JSON.stringify({ manualPlannedOrderId: row.id }), actorId, now, now, now);
  const legacySuggestion = row.supply_type === 'MAKE' ? 'MAKE' : 'BUY';
  db.prepare(`INSERT INTO mrp_run_results(id,run_id,product_id,gross_requirement,net_requirement,suggestion_type,suggested_quantity,need_by_date,supply_type)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(resultId, runId, row.product_id, Number(row.quantity), Number(row.quantity),
    legacySuggestion, Number(row.quantity), row.need_date, row.supply_type);
  db.prepare('UPDATE planned_orders SET mrp_run_id=?,mrp_result_id=? WHERE id=?').run(runId, resultId, row.id);
  row.mrp_run_id = runId;
  row.mrp_result_id = resultId;
  return row;
}

export function releasePlannedOrder(db, res, actor, orderId) {
  allow(actor, 'PLANNED_ORDER_RELEASE');
  let output;
  transaction(db, () => {
    lockRow(db, 'planned_orders', orderId);
    const row = db.prepare('SELECT * FROM planned_orders WHERE id=?').get(orderId);
    if (!row) throw new HttpError(404, '计划订单不存在');
    if (row.status === 'RELEASED') { output = { type: row.supply_type, alreadyReleased: true }; return; }
    if (row.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认的计划订单可以释放');
    const remaining = Number(row.quantity) - Number(row.released_quantity);
    if (remaining <= EPS) throw new HttpError(409, '计划订单无剩余可释放数量');
    const now = nowIso();
    if (row.supply_type === 'OUTSOURCE') {
      const handoffId = id();
      db.prepare(`INSERT INTO planning_outsource_handoffs(id,planned_order_id,product_id,quantity,need_date,status,created_by,created_at)
        VALUES(?,?,?,?,?,'PENDING',?,?)`).run(handoffId, row.id, row.product_id, remaining, row.need_date, actor.id, now);
      output = { type: 'OUTSOURCE', handoffId };
    } else {
      ensureInstructionCompatibilitySnapshot(db, row, actor.id, now);
      const headerTable = row.supply_type === 'MAKE' ? 'production_instructions' : 'purchase_instructions';
      const itemTable = row.supply_type === 'MAKE' ? 'production_instruction_items' : 'purchase_instruction_items';
      const prefix = row.supply_type === 'MAKE' ? 'PI' : 'PUI';
      const headerId = id(); const instructionNo = makeNumber(db, headerTable, prefix);
      db.prepare(`INSERT INTO ${headerTable}(id,instruction_no,mrp_run_id,status,planned_date,notes,created_by,created_at,updated_at)
        VALUES(?,?,?,'DRAFT',?,?,?,?,?)`).run(headerId, instructionNo, row.mrp_run_id, row.planned_supply_date, `来自计划订单 ${row.order_no}`, actor.id, now, now);
      if (row.supply_type === 'MAKE') {
        db.prepare(`INSERT INTO ${itemTable}(id,instruction_id,mrp_result_id,product_id,quantity,need_by_date,bom_id,routing_id,planned_order_id,created_at)
          VALUES(?,?,?,?,?,?,NULL,NULL,?,?)`).run(id(), headerId, row.mrp_result_id, row.product_id, remaining, row.need_date, row.id, now);
      } else {
        db.prepare(`INSERT INTO ${itemTable}(id,instruction_id,mrp_result_id,product_id,quantity,need_by_date,planned_order_id,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(id(), headerId, row.mrp_result_id, row.product_id, remaining, row.need_date, row.id, now);
      }
      output = { type: row.supply_type, instructionId: headerId, instructionNo };
    }
    db.prepare("UPDATE planned_orders SET status='RELEASED',released_quantity=quantity,release_state='RELEASED',released_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?")
      .run(now, actor.id, now, orderId);
    audit(db, actor.id, 'RELEASE', 'PLANNED_ORDER', orderId, `${row.order_no} ${row.supply_type}`);
  });
  return send(res, 201, { ok: true, ...output });
}

function physicalSupplyQuantity(db, sourceType, sourceId, productId, warehouseId) {
  if (sourceType === 'ON_HAND') {
    const whereWarehouse = warehouseId ? ' AND warehouse_id=?' : '';
    return Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM inventory WHERE product_id=?${whereWarehouse}`).get(...(warehouseId ? [productId, warehouseId] : [productId])).quantity);
  }
  if (sourceType === 'PLANNED_ORDER') {
    const row = db.prepare('SELECT quantity,released_quantity FROM planned_orders WHERE id=? AND product_id=?').get(sourceId, productId);
    return Math.max(0, Number(row?.quantity || 0) - Number(row?.released_quantity || 0));
  }
  if (sourceType === 'PURCHASE_ORDER') return Number(db.prepare(`SELECT COALESCE(SUM(i.quantity),0) quantity FROM purchase_order_items i JOIN purchase_orders h ON h.id=i.order_id WHERE h.id=? AND i.product_id=? AND h.status='APPROVED'`).get(sourceId, productId).quantity);
  if (sourceType === 'PRODUCTION_ORDER') return Number(db.prepare(`SELECT CASE WHEN status IN ('RELEASED','IN_PROGRESS') THEN quantity ELSE 0 END quantity FROM production_orders WHERE id=? AND product_id=?`).get(sourceId, productId)?.quantity || 0);
  if (sourceType === 'EXPECTED') return Number.POSITIVE_INFINITY;
  return 0;
}

export function listReservations(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const status = url.searchParams.get('status');
  const rows = status
    ? db.prepare(`SELECT r.*,p.code product_code,p.name product_name,w.code warehouse_code FROM planning_reservations r JOIN products p ON p.id=r.product_id LEFT JOIN warehouses w ON w.id=r.warehouse_id WHERE r.status=? ORDER BY r.created_at DESC`).all(status)
    : db.prepare(`SELECT r.*,p.code product_code,p.name product_name,w.code warehouse_code FROM planning_reservations r JOIN products p ON p.id=r.product_id LEFT JOIN warehouses w ON w.id=r.warehouse_id ORDER BY r.created_at DESC LIMIT 500`).all();
  return send(res, 200, { reservations: rows });
}

export async function createReservation(db, req, res, actor) {
  allow(actor, 'PLANNING_RESERVATION_MANAGE');
  const parameters = db.prepare("SELECT reservation_enabled FROM planning_parameters WHERE id='DEFAULT'").get();
  if (!parameters?.reservation_enabled) throw new HttpError(409, '计划预留当前未启用');
  const body = await readJson(req);
  const type = String(body.reservationType ?? body.reservation_type ?? 'STRONG').toUpperCase();
  if (!RESERVATION_TYPES.has(type)) throw new HttpError(400, '预留类型无效');
  const productId = requiredText(body.productId ?? body.product_id, '产品', 100);
  const demandType = requiredText(body.demandSourceType ?? body.demand_source_type, '需求来源类型', 50).toUpperCase();
  const demandId = requiredText(body.demandSourceId ?? body.demand_source_id, '需求来源', 100);
  const supplyType = requiredText(body.supplySourceType ?? body.supply_source_type, '供应来源类型', 50).toUpperCase();
  if (!['ON_HAND', 'PLANNED_ORDER', 'PURCHASE_ORDER', 'PRODUCTION_ORDER', 'EXPECTED'].includes(supplyType)) throw new HttpError(400, '供应来源类型无效');
  const supplyId = body.supplySourceId ?? body.supply_source_id ?? null;
  if (supplyType !== 'ON_HAND' && supplyType !== 'EXPECTED' && !supplyId) throw new HttpError(400, '请选择供应来源');
  const quantity = finitePositive(body.quantity, '预留数量');
  const reservationId = id(); const number = makeNumber(db, 'planning_reservations', 'RSV'); const now = nowIso();
  transaction(db, () => {
    if (supplyId) {
      const table = { PLANNED_ORDER: 'planned_orders', PURCHASE_ORDER: 'purchase_orders', PRODUCTION_ORDER: 'production_orders' }[supplyType];
      if (table) lockRow(db, table, supplyId);
    }
    const available = physicalSupplyQuantity(db, supplyType, supplyId, productId, body.warehouseId ?? body.warehouse_id ?? null);
    const reserved = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM planning_reservations
      WHERE product_id=? AND supply_source_type=? AND COALESCE(supply_source_id,'')=COALESCE(?,'') AND COALESCE(warehouse_id,'')=COALESCE(?,'') AND status='ACTIVE'`)
      .get(productId, supplyType, supplyId, body.warehouseId ?? body.warehouse_id ?? null).quantity);
    if (Number.isFinite(available) && reserved + quantity > available + EPS) throw new HttpError(409, `可预留供应仅剩 ${Math.max(0, available - reserved)}`);
    db.prepare(`INSERT INTO planning_reservations(id,reservation_no,reservation_type,demand_source_type,demand_source_id,demand_source_line_id,supply_source_type,supply_source_id,supply_source_line_id,product_id,warehouse_id,quantity,priority,release_date,status,mrp_run_id,scheme_id,notes,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?)`).run(reservationId, number, type, demandType, demandId, body.demandSourceLineId ?? null,
      supplyType, supplyId, body.supplySourceLineId ?? null, productId, body.warehouseId ?? null, quantity, Number(body.priority ?? 100),
      dateOrNull(body.releaseDate ?? body.release_date, '释放日期'), body.mrpRunId ?? null, body.schemeId ?? null, String(body.notes || '').slice(0, 500), actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PLANNING_RESERVATION', reservationId, `${number} ${type} ${quantity}`);
  });
  return send(res, 201, { id: reservationId, reservationNo: number });
}

export function releaseReservation(db, res, actor, reservationId) {
  allow(actor, 'PLANNING_RESERVATION_MANAGE');
  transaction(db, () => {
    lockRow(db, 'planning_reservations', reservationId);
    const row = db.prepare('SELECT * FROM planning_reservations WHERE id=?').get(reservationId);
    if (!row) throw new HttpError(404, '预留不存在');
    if (row.status !== 'ACTIVE') return;
    const now = nowIso();
    db.prepare("UPDATE planning_reservations SET status='RELEASED',version=version+1,updated_at=? WHERE id=?").run(now, reservationId);
    audit(db, actor.id, 'RELEASE', 'PLANNING_RESERVATION', reservationId, row.reservation_no);
  });
  return send(res, 200, { ok: true, status: 'RELEASED' });
}

export function releaseWeakReservationsForScheme(db, schemeId, actorId) {
  const scheme = db.prepare('SELECT reservation_release_policy FROM planning_schemes WHERE id=?').get(schemeId);
  if (scheme?.reservation_release_policy !== 'RELEASE_WEAK') return 0;
  const now = nowIso();
  const rows = db.prepare("SELECT id,reservation_no FROM planning_reservations WHERE scheme_id=? AND reservation_type='WEAK' AND status='ACTIVE'").all(schemeId);
  for (const row of rows) {
    db.prepare("UPDATE planning_reservations SET status='RELEASED',version=version+1,updated_at=? WHERE id=?").run(now, row.id);
    audit(db, actorId, 'RELEASE', 'PLANNING_RESERVATION', row.id, `${row.reservation_no} scheme rerun`);
  }
  return rows.length;
}

export function assertStrongReservationAvailability(db, { productId, warehouseId = null, quantity, demandSourceType, demandSourceId }) {
  const requested = finitePositive(quantity, '执行数量');
  const physical = physicalSupplyQuantity(db, 'ON_HAND', null, productId, warehouseId);
  const blocked = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM planning_reservations
    WHERE product_id=? AND reservation_type IN ('STRONG','MANUAL') AND status='ACTIVE'
      AND COALESCE(warehouse_id,'')=COALESCE(?,'')
      AND NOT (demand_source_type=? AND demand_source_id=?)`).get(productId, warehouseId, demandSourceType, demandSourceId).quantity);
  if (requested > Math.max(0, physical - blocked) + EPS) throw new HttpError(409, '可用库存已被其它需求强预留');
  return { physical, blocked, available: Math.max(0, physical - blocked) };
}

export function buildPlanningBalanceReadModel(db, { from, to, productId = null }) {
  const start = from || nowIso().slice(0, 10);
  const end = to || new Date(Date.parse(`${start}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10);
  const productWhere = productId ? 'AND p.id=?' : '';
  const params = productId ? [productId] : [];
  const products = db.prepare(`SELECT p.id,p.code,p.name,p.unit,mp.safety_stock,mp.maximum_stock
    FROM products p LEFT JOIN planning_material_policies mp ON mp.product_id=p.id WHERE p.active=1 ${productWhere} ORDER BY p.code`).all(...params);
  const rows = [];
  for (const product of products) {
    const onHand = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM inventory WHERE product_id=?').get(product.id).quantity);
    const sales = Number(db.prepare(`SELECT COALESCE(SUM(soi.quantity),0) quantity FROM sales_order_items soi JOIN sales_orders so ON so.id=soi.order_id
      WHERE soi.product_id=? AND so.status='APPROVED' AND COALESCE(so.requested_delivery_date,so.order_date,substr(so.created_at,1,10)) BETWEEN ? AND ?`).get(product.id, start, end).quantity);
    const delivered = Number(db.prepare(`SELECT COALESCE(SUM(sdi.quantity),0) quantity FROM sales_delivery_items sdi JOIN sales_deliveries sd ON sd.id=sdi.delivery_id
      WHERE sdi.product_id=? AND sd.status='CONFIRMED'`).get(product.id).quantity);
    const purchase = Number(db.prepare(`SELECT COALESCE(SUM(i.quantity),0) quantity FROM purchase_order_items i JOIN purchase_orders h ON h.id=i.order_id
      WHERE i.product_id=? AND h.status='APPROVED' AND COALESCE(h.expected_delivery_date,h.order_date,substr(h.created_at,1,10))<=?`).get(product.id, end).quantity);
    const purchased = Number(db.prepare(`SELECT COALESCE(SUM(i.quantity),0) quantity FROM purchase_receipt_items i JOIN purchase_receipts h ON h.id=i.receipt_id
      WHERE i.product_id=? AND h.status='CONFIRMED'`).get(product.id).quantity);
    const production = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM production_orders WHERE product_id=? AND status IN ('RELEASED','IN_PROGRESS')`).get(product.id).quantity);
    const produced = Number(db.prepare(`SELECT COALESCE(SUM(r.quantity),0) quantity FROM production_receipts r JOIN production_orders o ON o.id=r.production_order_id WHERE o.product_id=? AND r.status='CONFIRMED'`).get(product.id).quantity);
    const planned = Number(db.prepare(`SELECT COALESCE(SUM(quantity-released_quantity),0) quantity FROM planned_orders WHERE product_id=? AND status='CONFIRMED'`).get(product.id).quantity);
    const firmSupply = Math.max(0, purchase - purchased) + Math.max(0, production - produced);
    const demand = Math.max(0, sales - delivered);
    const projected = onHand + firmSupply + planned - demand;
    const safety = Number(product.safety_stock || 0);
    const maximum = Number(product.maximum_stock || 0);
    const strongReserved = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM planning_reservations WHERE product_id=? AND reservation_type IN ('STRONG','MANUAL') AND status='ACTIVE'`).get(product.id).quantity);
    rows.push({ ...product, onHand, demand, firmSupply, plannedSupply: planned, projectedBalance: projected, shortage: Math.max(0, safety - projected), excess: maximum > 0 ? Math.max(0, projected - maximum) : 0, strongReserved,
      exception: projected < safety ? 'SHORTAGE' : (maximum > 0 && projected > maximum ? 'EXCESS' : '') });
  }
  return { from: start, to: end, rows };
}

export function planningWorkbench(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  return send(res, 200, { workbench: buildPlanningBalanceReadModel(db, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), productId: url.searchParams.get('productId') }) });
}

export function planningReport(db, res, actor, url, report) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  if (report === 'forecast-consumption') return listForecastConsumption(db, res, actor, url);
  if (report === 'reservations' || report === 'reservation-trace') return listReservations(db, res, actor, url);
  if (report === 'mrp-log') {
    const runId = url.searchParams.get('runId');
    const rows = runId ? db.prepare('SELECT * FROM mrp_run_logs WHERE run_id=? ORDER BY created_at,id').all(runId) : db.prepare('SELECT * FROM mrp_run_logs ORDER BY created_at DESC LIMIT 500').all();
    return send(res, 200, { logs: rows.map((row) => ({ ...row, detail: parseJson(row.detail, row.detail) })) });
  }
  return send(res, 200, { report, ...buildPlanningBalanceReadModel(db, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), productId: url.searchParams.get('productId') }) });
}

function cascadeImpact(db, sourceType, sourceId) {
  const resultIds = sourceType === 'FORECAST'
    ? db.prepare(`SELECT DISTINCT r.id FROM mrp_run_results r JOIN mrp_run_demands d ON d.run_id=r.run_id WHERE d.source_type='FORECAST' AND d.source_id=?`).all(sourceId).map((row) => row.id)
    : db.prepare(`SELECT DISTINCT r.id FROM mrp_run_results r JOIN mrp_run_demands d ON d.run_id=r.run_id WHERE d.source_type='SALES_ORDER' AND d.source_id=?`).all(sourceId).map((row) => row.id);
  const planned = resultIds.length ? db.prepare(`SELECT id,order_no,status,quantity FROM planned_orders WHERE mrp_result_id IN (${resultIds.map(() => '?').join(',')})`).all(...resultIds) : [];
  const blockers = planned.filter((row) => !['DRAFT', 'CONFIRMED'].includes(row.status)).map((row) => ({ type: 'PLANNED_ORDER', id: row.id, status: row.status }));
  return { sourceType, sourceId, resultIds, plannedOrders: planned, blockers };
}

export async function previewCascade(db, req, res, actor) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const sourceType = String(body.sourceType ?? body.source_type ?? '').toUpperCase();
  if (!['SALES_ORDER', 'FORECAST'].includes(sourceType)) throw new HttpError(400, '级联来源类型无效');
  const sourceId = requiredText(body.sourceId ?? body.source_id, '级联来源', 100);
  const impact = cascadeImpact(db, sourceType, sourceId);
  const snapshot = { ...impact, requestedQuantity: body.quantity ?? null, requestedDate: dateOrNull(body.date, '目标日期') };
  const encoded = json(snapshot); const hash = createHash('sha256').update(encoded).digest('hex'); const changeId = id(); const now = nowIso();
  db.prepare(`INSERT INTO planning_cascade_changes(id,source_type,source_id,requested_quantity,requested_date,preview_snapshot,preview_hash,status,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,'PREVIEWED',?,?)`).run(changeId, sourceType, sourceId, body.quantity ?? null, snapshot.requestedDate, encoded, hash, actor.id, now);
  return send(res, 201, { id: changeId, hash, impact });
}

export async function applyCascade(db, req, res, actor, changeId) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  transaction(db, () => {
    lockRow(db, 'planning_cascade_changes', changeId);
    const change = db.prepare('SELECT * FROM planning_cascade_changes WHERE id=?').get(changeId);
    if (!change) throw new HttpError(404, '级联调整不存在');
    if (change.status !== 'PREVIEWED') throw new HttpError(409, '级联调整已处理');
    if (body.hash !== change.preview_hash) throw new HttpError(409, '级联预览已失效，请重新预览');
    const fresh = cascadeImpact(db, change.source_type, change.source_id);
    if (fresh.blockers.length) throw new HttpError(409, '存在已释放或执行中的下游，不能级联调整');
    const snapshot = parseJson(change.preview_snapshot, {});
    for (const row of fresh.plannedOrders) {
      if (snapshot.requestedDate) db.prepare('UPDATE planned_orders SET need_date=?,planned_supply_date=?,version=version+1,updated_at=? WHERE id=?').run(snapshot.requestedDate, snapshot.requestedDate, nowIso(), row.id);
    }
    const now = nowIso();
    db.prepare("UPDATE planning_cascade_changes SET status='APPLIED',applied_at=? WHERE id=?").run(now, changeId);
    audit(db, actor.id, 'APPLY', 'PLANNING_CASCADE', changeId, `${change.source_type}:${change.source_id}`);
  });
  return send(res, 200, { ok: true, status: 'APPLIED' });
}

export const __test__ = { allocateForecastConsumption, buildPlanningBalanceReadModel, physicalSupplyQuantity };
