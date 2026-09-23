// M11 — Forecast & MRP planning engine.
//
// Responsibilities:
//   - CRUD for planning_forecasts (master planning data).
//   - DRAFT/ACTIVE/CANCELLED lifecycle with strict immutability for
//     ACTIVE content (M11: editing ACTIVE forecasts is rejected).
//   - Immutability of COMPLETED mrp_runs (cannot execute twice, cannot
//     edit inputs, later forecast or inventory changes never rewrite
//     historical snapshots).
//   - Per-product aggregation of approved sales demand and approved
//     purchase supply via header-level linkage (sales_order_id /
//     purchase_order_id). Section 6 product-level aggregation is safe
//     because the join keys live on the document header, not just on
//     the party or product alone.
//   - BOM explosion with deterministic cycle detection, multi-level
//     recursion, scrap rate, and aggregate-before-netting for shared
//     components.
//   - Make/Buy decision by BOM presence: product with an ACTIVE BOM
//     that survives the cycle check is MAKE; product without a usable
//     BOM is BUY. No invented make/buy attribute.
//   - Suggestion-only output. The engine never touches inventory,
//     accounting, approval center, production orders, purchase orders,
//     purchase requisitions, or material issues.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, HttpError, readJson, requiredText, send } from '../lib/http.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';

const FORECAST_STATUS = { DRAFT: '草稿', ACTIVE: '已生效', CANCELLED: '已取消' };
const MRP_RUN_STATUS = { DRAFT: '草稿', COMPLETED: '已计算', CANCELLED: '已取消' };
const DEMAND_MODES = new Set(['SALES_ORDERS', 'FORECAST', 'SALES_PLUS_FORECAST']);

const MAX_FORECAST_NAME = 80;
const MAX_NOTE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOM_DEPTH = 12;

function normalizePositiveQuantity(value, label) {
  if (value === undefined || value === null || value === '') throw new HttpError(400, `${label}不能为空`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}不是有效数字`);
  if (n <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return n;
}

function normalizeDate(value, label) {
  const text = String(value || '').trim();
  if (!DATE_RE.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  return text;
}

function readString(value, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (text.length > max) throw new HttpError(400, `备注长度不能超过 ${max}`);
  return text;
}

function makeForecastCode(db, today) {
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM planning_forecasts").get().cnt + 1).padStart(4, '0');
  return `FC-${today}-${seq}`;
}

function makeRunCode(db, today) {
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM mrp_runs").get().cnt + 1).padStart(4, '0');
  return `MRP-${today}-${seq}`;
}

function assertActiveProduct(db, productId) {
  const product = db.prepare("SELECT id, code, name FROM products WHERE id=? AND active=1").get(productId);
  if (!product) throw new HttpError(400, '产品不存在或已停用');
  return product;
}

function listForecastItems(db, forecastId) {
  return db.prepare(`
    SELECT i.id, i.forecast_id, i.product_id, i.need_date, i.quantity, i.notes,
           p.code product_code, p.name product_name, p.unit product_unit
      FROM planning_forecast_items i
      JOIN products p ON p.id = i.product_id
     WHERE i.forecast_id = ?
     ORDER BY i.need_date, p.code
  `).all(forecastId);
}

function decorateForecast(forecast) {
  if (!forecast) return forecast;
  return { ...forecast, statusLabel: FORECAST_STATUS[forecast.status] || forecast.status };
}

function decorateRun(run) {
  if (!run) return run;
  let summary = null;
  if (run.summary) {
    try { summary = JSON.parse(run.summary); } catch { summary = null; }
  }
  return { ...run, statusLabel: MRP_RUN_STATUS[run.status] || run.status, summary };
}

export function listPlanningForecasts(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const status = url.searchParams.get('status') || '';
  const where = [];
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('PLANNING_FORECAST', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'f.id' });
  if (archiveFilter.clause) where.push(archiveFilter.clause);
  if (status && FORECAST_STATUS[status]) {
    where.push('f.status = ?');
    params.push(status);
  }
  const rows = db.prepare(`
    SELECT f.*, u.display_name creator_name,
           (SELECT COUNT(*) FROM planning_forecast_items WHERE forecast_id=f.id) item_count,
           (SELECT COALESCE(SUM(quantity), 0) FROM planning_forecast_items WHERE forecast_id=f.id) total_quantity
      FROM planning_forecasts f
      LEFT JOIN users u ON u.id = f.created_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY f.created_at DESC
  `).all(...params).map(decorateForecast);
  return send(res, 200, { forecasts: rows });
}

export function getPlanningForecast(db, res, actor, forecastId) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const forecast = decorateForecast(db.prepare(`
    SELECT f.*, u.display_name creator_name
      FROM planning_forecasts f LEFT JOIN users u ON u.id=f.created_by
     WHERE f.id = ?
  `).get(forecastId));
  if (!forecast) throw new HttpError(404, '计划预测不存在');
  forecast.items = listForecastItems(db, forecastId);
  return send(res, 200, { forecast });
}

function persistForecastItems(db, forecastId, items) {
  db.prepare("DELETE FROM planning_forecast_items WHERE forecast_id=?").run(forecastId);
  if (!Array.isArray(items) || items.length === 0) return;
  const seen = new Set();
  const insert = db.prepare(`
    INSERT INTO planning_forecast_items(id, forecast_id, product_id, need_date, quantity, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const product = assertActiveProduct(db, item.productId);
    const needDate = normalizeDate(item.needDate, `第 ${i + 1} 行需求日期`);
    const quantity = normalizePositiveQuantity(item.quantity, `第 ${i + 1} 行数量`);
    const notes = readString(item.notes, MAX_NOTE);
    const key = `${product.id}|${needDate}`;
    if (seen.has(key)) {
      throw new HttpError(400, `第 ${i + 1} 行与已存在的产品 + 需求日期重复`);
    }
    seen.add(key);
    insert.run(id(), forecastId, product.id, needDate, quantity, notes);
  }
}

function validateForecastPeriod(periodStart, periodEnd) {
  if (periodStart > periodEnd) throw new HttpError(400, '预测开始日期不能晚于结束日期');
}

function validateItemDates(items, periodStart, periodEnd) {
  for (const item of items) {
    if (item.needDate < periodStart || item.needDate > periodEnd) {
      throw new HttpError(400, '需求日期必须在预测期间之内');
    }
  }
}

export async function createPlanningForecast(db, req, res, actor) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const name = requiredText(body.forecastName || body.forecast_name, '预测名称', MAX_FORECAST_NAME);
  const periodStart = normalizeDate(body.periodStart || body.period_start, '开始日期');
  const periodEnd = normalizeDate(body.periodEnd || body.period_end, '结束日期');
  validateForecastPeriod(periodStart, periodEnd);
  const notes = readString(body.notes, MAX_NOTE);
  const items = Array.isArray(body.items) ? body.items : [];
  validateItemDates(items, periodStart, periodEnd);
  const now = nowIsoLocal();
  const today = now.slice(0, 10);
  let forecastId = id();
  let forecastCode = makeForecastCode(db, today);
  // The first item's product FK is validated by assertActiveProduct
  // (no item validation here for an empty forecast). Validate only the
  // shape of the items array; persistForecastItems will reject invalid
  // product references.
  transaction(db, () => {
    db.prepare(`
      INSERT INTO planning_forecasts(id, forecast_code, forecast_name, period_start, period_end, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    `).run(forecastId, forecastCode, name, periodStart, periodEnd, notes, actor.id, now, now);
    persistForecastItems(db, forecastId, items);
    audit(db, actor.id, 'CREATE', 'PLANNING_FORECAST', forecastId, `预测 ${forecastCode}`);
  });
  return send(res, 201, { id: forecastId, forecastCode });
}

export async function updatePlanningForecast(db, req, res, actor, forecastId) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(forecastId);
  if (!forecast) throw new HttpError(404, '计划预测不存在');
  if (forecast.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的预测可以编辑');
  const name = requiredText(body.forecastName ?? forecast.forecast_name, '预测名称', MAX_FORECAST_NAME);
  const periodStart = normalizeDate(body.periodStart ?? forecast.period_start, '开始日期');
  const periodEnd = normalizeDate(body.periodEnd ?? forecast.period_end, '结束日期');
  validateForecastPeriod(periodStart, periodEnd);
  const notes = readString(body.notes, MAX_NOTE);
  const items = Array.isArray(body.items) ? body.items : null;
  if (items) validateItemDates(items, periodStart, periodEnd);
  const now = nowIsoLocal();
  transaction(db, () => {
    db.prepare(`
      UPDATE planning_forecasts
         SET forecast_name=?, period_start=?, period_end=?, notes=?, updated_at=?
       WHERE id=?
    `).run(name, periodStart, periodEnd, notes, now, forecastId);
    if (items) persistForecastItems(db, forecastId, items);
    audit(db, actor.id, 'UPDATE', 'PLANNING_FORECAST', forecastId, `预测 ${forecast.forecast_code}`);
  });
  return send(res, 200, { ok: true });
}

export function activatePlanningForecast(db, res, actor, forecastId) {
  allow(actor, 'MRP_MANAGE');
  const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(forecastId);
  if (!forecast) throw new HttpError(404, '计划预测不存在');
  if (forecast.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的预测可以生效');
  const itemCount = db.prepare("SELECT COUNT(*) c FROM planning_forecast_items WHERE forecast_id=?").get(forecastId).c;
  if (itemCount === 0) throw new HttpError(400, '预测明细为空，无法生效');
  const now = nowIsoLocal();
  transaction(db, () => {
    db.prepare("UPDATE planning_forecasts SET status='ACTIVE', updated_at=? WHERE id=?").run(now, forecastId);
    audit(db, actor.id, 'ACTIVATE', 'PLANNING_FORECAST', forecastId, `预测 ${forecast.forecast_code}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelPlanningForecast(db, res, actor, forecastId) {
  allow(actor, 'MRP_MANAGE');
  const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(forecastId);
  if (!forecast) throw new HttpError(404, '计划预测不存在');
  if (forecast.status === 'CANCELLED') return send(res, 200, { ok: true });
  const now = nowIsoLocal();
  transaction(db, () => {
    db.prepare("UPDATE planning_forecasts SET status='CANCELLED', updated_at=? WHERE id=?").run(now, forecastId);
    audit(db, actor.id, 'CANCEL', 'PLANNING_FORECAST', forecastId, `预测 ${forecast.forecast_code}`);
  });
  return send(res, 200, { ok: true });
}

// =================================================================
// MRP
// =================================================================

function productOnHand(db, productId) {
  const row = db.prepare("SELECT COALESCE(SUM(quantity), 0) total FROM inventory WHERE product_id=?").get(productId);
  return Number(row?.total || 0);
}

function openPurchaseSupply(db, productId) {
  // APPROVED purchase orders - CONFIRMED purchase receipts linked to
  // those orders (product-level aggregation). Receipts without a
  // purchase_order_id do not contribute to "open" supply because the
  // inventory is already on hand.
  const ordered = db.prepare(`
    SELECT COALESCE(SUM(poi.quantity), 0) total
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.order_id
     WHERE poi.product_id = ? AND po.status = 'APPROVED'
  `).get(productId);
  const received = db.prepare(`
    SELECT COALESCE(SUM(pri.quantity), 0) total
      FROM purchase_receipt_items pri
      JOIN purchase_receipts pr ON pr.id = pri.receipt_id
      JOIN purchase_orders po ON po.id = pr.purchase_order_id
     WHERE pri.product_id = ?
       AND pr.status = 'CONFIRMED'
       AND po.status = 'APPROVED'
       AND pr.purchase_order_id IS NOT NULL
  `).get(productId);
  return Math.max(0, Number(ordered?.total || 0) - Number(received?.total || 0));
}

function openProductionSupply(db, productId) {
  // PENDING / IN_PROGRESS production orders minus CONFIRMED production
  // receipts (header-level linkage via production_order_id). COMPLETED
  // and CANCELLED orders do not contribute to future supply.
  const ordered = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) total
      FROM production_orders
     WHERE product_id = ? AND status IN ('PENDING','IN_PROGRESS')
  `).get(productId);
  const received = db.prepare(`
    SELECT COALESCE(SUM(pr.quantity), 0) total
      FROM production_receipts pr
      JOIN production_orders po ON po.id = pr.production_order_id
     WHERE po.product_id = ?
       AND pr.status = 'CONFIRMED'
       AND po.status IN ('PENDING','IN_PROGRESS')
  `).get(productId);
  return Math.max(0, Number(ordered?.total || 0) - Number(received?.total || 0));
}

// SALES open demand (product-level) over APPROVED sales orders minus
// CONFIRMED delivery items joined to those orders. Returns
// [{ productId, quantity, orderId, needDate }] for every positive
// remaining demand line. Returns 0 for fully delivered products and
// silently drops DRAFT/SUBMITTED/REJECTED/CANCELLED orders.
//
// V1.3 Phase 1: need_date precedence is the contractual
// requested_delivery_date first. The workflow timestamp fallback is
// permitted only for legacy rows with neither V1.3 business-date column
// populated. A V1.3 row with order_date but a missing contractual delivery
// date is skipped instead of silently turning workflow time into demand time.
function openSalesDemand(db, horizonStart, horizonEnd) {
  const orders = db.prepare(`
    SELECT id, order_no, submitted_at, reviewed_at, created_at,
           requested_delivery_date, order_date
      FROM sales_orders
     WHERE status = 'APPROVED'
  `).all();
  const result = [];
  for (const order of orders) {
    const ordered = db.prepare(`
      SELECT product_id, quantity FROM sales_order_items WHERE order_id = ?
    `).all(order.id);
    const delivered = db.prepare(`
      SELECT sdi.product_id, COALESCE(SUM(sdi.quantity), 0) total
        FROM sales_delivery_items sdi
        JOIN sales_deliveries sd ON sd.id = sdi.delivery_id
       WHERE sd.sales_order_id = ? AND sd.status = 'CONFIRMED'
       GROUP BY sdi.product_id
    `).all(order.id);
    const deliveredMap = new Map(delivered.map((row) => [row.product_id, Number(row.total)]));
    const isLegacyOrder = !order.requested_delivery_date && !order.order_date;
    const rawDate = order.requested_delivery_date
      || (isLegacyOrder ? (order.submitted_at || order.reviewed_at || order.created_at || '').slice(0, 10) : '');
    const needDate = rawDate || horizonEnd;
    if (!rawDate && !isLegacyOrder) continue;
    // Skip orders whose need_date sits entirely outside the horizon.
    if (needDate < horizonStart || needDate > horizonEnd) continue;
    for (const line of ordered) {
      const remaining = Math.max(0, Number(line.quantity) - (deliveredMap.get(line.product_id) || 0));
      if (remaining > 0) {
        result.push({
          productId: line.product_id,
          quantity: remaining,
          orderId: order.id,
          orderNo: order.order_no,
          needDate,
        });
      }
    }
  }
  return result;
}

function aggregateDemand(rows) {
  const map = new Map();
  for (const row of rows) {
    const cur = map.get(row.productId) || { productId: row.productId, quantity: 0, needDate: row.needDate };
    cur.quantity += row.quantity;
    if (row.needDate && (!cur.needDate || row.needDate < cur.needDate)) cur.needDate = row.needDate;
    map.set(row.productId, cur);
  }
  return [...map.values()];
}

function productBom(db, productId) {
  return db.prepare(`
    SELECT id, product_id, version, status
      FROM boms
     WHERE product_id = ? AND status = 'ACTIVE'
     ORDER BY updated_at DESC
     LIMIT 1
  `).get(productId);
}

function productBomItems(db, bomId) {
  return db.prepare(`
    SELECT id, product_id, quantity, scrap_rate, line_no
      FROM bom_items WHERE bom_id = ? ORDER BY line_no
  `).all(bomId);
}

function productActiveRouting(db, productId) {
  return db.prepare("SELECT id FROM product_routings WHERE product_id = ? AND status = 'ACTIVE' LIMIT 1").get(productId);
}

// Multi-level BOM explosion with cycle detection is implemented by
// explodeBomNet below. This block intentionally has no other helpers;
// the previous recursive `explodeBom` used the parent GROSS to drive
// the walk, which inflated component demand whenever the parent's
// net requirement was smaller than its gross (e.g. on-hand or open
// supply covered part of the demand). The new walker enforces
// net-before-explosion at every level.

// DFS BOM walk with NET-BEFORE-EXPLOSION semantics.
//
// A MAKE parent's gross requirement is first netted against its own
// on-hand stock, open purchase supply, and open production supply.
// Only the resulting NET MAKE quantity is allowed to drive the
// parent's BOM explosion. If the parent has no BOM, or its net is
// zero, or the product is a BUY item, the walk does not contribute
// any child component demand from this parent.
//
// At each step:
//   1. compute parent net = max(0, gross - onHand - openPo - openProd)
//   2. if isMake(parent) AND net > 0:
//        for each BOM child:
//          childGross += net * child.bomQty * (1 + scrapRate)
//          record BOM_EXPLOSION pegging contribution = childGross
//          recurse into the child using childGross as the new gross
//   3. else: no contribution; do not recurse
//
// cycle detection is enforced via `state.active` (DFS ancestors); depth
// is bounded by MAX_BOM_DEPTH. On violation: HttpError 400 and the
// outer transaction does not commit any rows.
//
// componentGross[childId] accumulates the TOTAL child component demand
// from all parents and levels — this is the value reported as
// gross_component_demand and as the child's gross_requirement.
// componentParents[childId] records one entry per (parent, child) edge
// for both BOM components persistence and BOM_EXPLOSION pegging.
function explodeBomNet(db, pid, gross, path, depth, state, componentGross, componentParents) {
  if (depth > MAX_BOM_DEPTH) {
    throw new HttpError(400, 'BOM 展开深度超过限制，可能存在循环');
  }
  if (state.active.has(pid)) {
    throw new HttpError(400, 'BOM 存在循环引用，无法计算');
  }
  state.active.add(pid);
  try {
    if (!Number.isFinite(gross) || gross <= 0) return;
    const netting = computeNetting(db, pid, gross);
    if (netting.net <= 0) return;
    if (decideMakeBuy(db, pid) !== 'MAKE') return;
    const bom = productBom(db, pid);
    if (!bom) return;
    const items = productBomItems(db, bom.id);
    if (items.length === 0) return;
    for (const item of items) {
      assertActiveProduct(db, item.product_id);
      const childPid = item.product_id;
      const childGross = netting.net * Number(item.quantity) * (1 + Number(item.scrap_rate || 0));
      const childPath = path ? `${path} > ${childPid}` : `${pid} > ${childPid}`;
      componentGross.set(childPid, (componentGross.get(childPid) || 0) + childGross);
      const parents = componentParents.get(childPid) || [];
      parents.push({ parentId: pid, qty: childGross, path: childPath, level: depth + 1 });
      componentParents.set(childPid, parents);
      explodeBomNet(db, childPid, childGross, childPath, depth + 1, state, componentGross, componentParents);
    }
  } finally {
    state.active.delete(pid);
  }
}

export function listMrpRuns(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const status = url.searchParams.get('status') || '';
  const where = [];
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('MRP_RUN', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'r.id' });
  if (archiveFilter.clause) where.push(archiveFilter.clause);
  if (status && MRP_RUN_STATUS[status]) {
    where.push('r.status = ?');
    params.push(status);
  }
  const rows = db.prepare(`
    SELECT r.*, u.display_name creator_name,
           f.forecast_code forecast_code, f.forecast_name forecast_name
      FROM mrp_runs r
      LEFT JOIN users u ON u.id = r.created_by
      LEFT JOIN planning_forecasts f ON f.id = r.forecast_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.created_at DESC
  `).all(...params).map(decorateRun);
  return send(res, 200, { runs: rows });
}

export function getMrpRun(db, res, actor, runId) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const run = decorateRun(db.prepare(`
    SELECT r.*, u.display_name creator_name, f.forecast_code, f.forecast_name
      FROM mrp_runs r
      LEFT JOIN users u ON u.id=r.created_by
      LEFT JOIN planning_forecasts f ON f.id=r.forecast_id
     WHERE r.id = ?
  `).get(runId));
  if (!run) throw new HttpError(404, 'MRP 计算不存在');
  run.demands = db.prepare(`
    SELECT d.id, d.product_id, d.need_date, d.source_type, d.source_id, d.source_label, d.quantity,
           p.code product_code, p.name product_name, p.unit product_unit
      FROM mrp_run_demands d
      LEFT JOIN products p ON p.id = d.product_id
     WHERE d.run_id = ?
     ORDER BY d.source_type, d.product_id, d.need_date
  `).all(runId);
  run.results = db.prepare(`
    SELECT r.id, r.product_id, r.gross_sales_demand, r.gross_forecast_demand,
           r.gross_component_demand, r.gross_requirement, r.on_hand,
           r.open_purchase_supply, r.open_production_supply, r.net_requirement,
           r.suggestion_type, r.suggested_quantity, r.need_by_date, r.bom_level, r.warning,
           p.code product_code, p.name product_name, p.unit product_unit
      FROM mrp_run_results r
      LEFT JOIN products p ON p.id = r.product_id
     WHERE r.run_id = ?
     ORDER BY (r.suggestion_type = 'MAKE') DESC, (r.suggestion_type = 'BUY') DESC, p.code
  `).all(runId);
  // Compute read-only conversion metadata (suggested / converted /
  // remaining). Mutating mrp_run_results would violate the M11
  // immutability contract, so these values live only in the response.
  for (const result of run.results) {
    if (result.suggestion_type === 'MAKE') {
      const convertedRow = db.prepare(`
        SELECT COALESCE(SUM(i.quantity), 0) qty
          FROM production_instruction_items i
          JOIN production_instructions h ON h.id = i.instruction_id
         WHERE i.mrp_result_id = ? AND h.status IN ('DRAFT', 'RELEASED')
      `).get(result.id);
      result.converted_quantity = Number(convertedRow.qty);
      result.remaining_quantity = Math.max(0, Number(result.suggested_quantity) - result.converted_quantity);
    } else if (result.suggestion_type === 'BUY') {
      const convertedRow = db.prepare(`
        SELECT COALESCE(SUM(i.quantity), 0) qty
          FROM purchase_instruction_items i
          JOIN purchase_instructions h ON h.id = i.instruction_id
         WHERE i.mrp_result_id = ? AND h.status IN ('DRAFT', 'RELEASED')
      `).get(result.id);
      result.converted_quantity = Number(convertedRow.qty);
      result.remaining_quantity = Math.max(0, Number(result.suggested_quantity) - result.converted_quantity);
    } else {
      result.converted_quantity = 0;
      result.remaining_quantity = Number(result.suggested_quantity);
    }
  }
  run.components = db.prepare(`
    SELECT c.id, c.parent_product_id, c.product_id, c.gross_required, c.bom_path, c.level,
           pp.code parent_code, pp.name parent_name,
           p.code product_code, p.name product_name
      FROM mrp_run_components c
      LEFT JOIN products pp ON pp.id = c.parent_product_id
      LEFT JOIN products p ON p.id = c.product_id
     WHERE c.run_id = ?
     ORDER BY c.bom_path
  `).all(runId);
  run.pegging = db.prepare(`
    SELECT id, result_product_id, source_type, source_id, source_label, product_id, quantity_contribution, note
      FROM mrp_run_pegging
     WHERE run_id = ?
     ORDER BY result_product_id, source_type, id
  `).all(runId);
  return send(res, 200, { run });
}

function validateRunInputs(body) {
  const name = requiredText(body.runName || body.run_name, '计算名称', MAX_FORECAST_NAME);
  const horizonStart = normalizeDate(body.horizonStart || body.horizon_start, '开始日期');
  const horizonEnd = normalizeDate(body.horizonEnd || body.horizon_end, '结束日期');
  if (horizonStart > horizonEnd) throw new HttpError(400, '计算开始日期不能晚于结束日期');
  const mode = body.demandSourceMode || body.demand_source_mode;
  if (!DEMAND_MODES.has(mode)) throw new HttpError(400, '需求来源模式无效');
  return { name, horizonStart, horizonEnd, mode };
}

export async function createMrpRun(db, req, res, actor) {
  allow(actor, 'MRP_MANAGE');
  const body = await readJson(req);
  const { name, horizonStart, horizonEnd, mode } = validateRunInputs(body);
  let forecastId = body.forecastId || body.forecast_id || null;
  if (mode === 'FORECAST' || mode === 'SALES_PLUS_FORECAST') {
    if (!forecastId) throw new HttpError(400, '该需求来源模式必须选择计划预测');
    const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(forecastId);
    if (!forecast) throw new HttpError(404, '计划预测不存在');
    if (forecast.status !== 'ACTIVE') throw new HttpError(400, '只有已生效的预测可用于 MRP');
  } else {
    forecastId = null;
  }
  const now = nowIsoLocal();
  const today = now.slice(0, 10);
  const runId = id();
  const runCode = makeRunCode(db, today);
  transaction(db, () => {
    db.prepare(`
      INSERT INTO mrp_runs(id, run_code, run_name, horizon_start, horizon_end, demand_source_mode, forecast_id, status, summary, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', '', ?, ?)
    `).run(runId, runCode, name, horizonStart, horizonEnd, mode, forecastId, actor.id, now);
    audit(db, actor.id, 'CREATE', 'MRP_RUN', runId, `MRP ${runCode}`);
  });
  return send(res, 201, { id: runId, runCode });
}

export async function updateMrpRun(db, req, res, actor, runId) {
  allow(actor, 'MRP_MANAGE');
  const run = db.prepare("SELECT * FROM mrp_runs WHERE id=?").get(runId);
  if (!run) throw new HttpError(404, 'MRP 计算不存在');
  if (run.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的 MRP 可以修改');
  const body = await readJson(req);
  const { name, horizonStart, horizonEnd, mode } = validateRunInputs({ ...body, runName: body.runName ?? body.run_name ?? run.run_name });
  let forecastId = body.forecastId || body.forecast_id || null;
  if (mode === 'FORECAST' || mode === 'SALES_PLUS_FORECAST') {
    if (!forecastId) throw new HttpError(400, '该需求来源模式必须选择计划预测');
    const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(forecastId);
    if (!forecast) throw new HttpError(404, '计划预测不存在');
    if (forecast.status !== 'ACTIVE') throw new HttpError(400, '只有已生效的预测可用于 MRP');
  } else {
    forecastId = null;
  }
  const now = nowIsoLocal();
  transaction(db, () => {
    db.prepare(`
      UPDATE mrp_runs
         SET run_name=?, horizon_start=?, horizon_end=?, demand_source_mode=?, forecast_id=?, updated_at=?
       WHERE id=?
    `).run(name, horizonStart, horizonEnd, mode, forecastId, now, runId);
    audit(db, actor.id, 'UPDATE', 'MRP_RUN', runId, `MRP ${run.run_code}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelMrpRun(db, res, actor, runId) {
  allow(actor, 'MRP_MANAGE');
  const run = db.prepare("SELECT * FROM mrp_runs WHERE id=?").get(runId);
  if (!run) throw new HttpError(404, 'MRP 计算不存在');
  if (run.status === 'COMPLETED') throw new HttpError(409, '已完成的 MRP 不可取消');
  if (run.status === 'CANCELLED') return send(res, 200, { ok: true });
  const now = nowIsoLocal();
  transaction(db, () => {
    db.prepare("UPDATE mrp_runs SET status='CANCELLED', updated_at=? WHERE id=?").run(now, runId);
    audit(db, actor.id, 'CANCEL', 'MRP_RUN', runId, `MRP ${run.run_code}`);
  });
  return send(res, 200, { ok: true });
}

function buildForecastDemandRows(db, forecastId, horizonStart, horizonEnd) {
  const items = db.prepare(`
    SELECT product_id, need_date, quantity
      FROM planning_forecast_items
     WHERE forecast_id = ?
       AND need_date >= ?
       AND need_date <= ?
  `).all(forecastId, horizonStart, horizonEnd);
  return items.map((row) => ({
    productId: row.product_id,
    needDate: row.need_date,
    quantity: Number(row.quantity),
    orderId: forecastId,
    orderNo: `FC:${forecastId}`,
  }));
}

function upsertDemandRow(db, runId, row, productMap) {
  if (!Number.isFinite(row.quantity) || row.quantity <= 0) return;
  const product = productMap.get(row.productId);
  if (!product) return;
  db.prepare(`
    INSERT INTO mrp_run_demands(id, run_id, product_id, need_date, source_type, source_id, source_label, quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id(),
    runId,
    row.productId,
    row.needDate,
    row.sourceType,
    row.sourceId || null,
    row.sourceLabel || '',
    row.quantity,
  );
}

function upsertPegg(db, runId, productId, sourceType, sourceId, sourceLabel, qty, note) {
  db.prepare(`
    INSERT INTO mrp_run_pegging(id, run_id, result_product_id, source_type, source_id, source_label, product_id, quantity_contribution, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id(), runId, productId, sourceType, sourceId || null, sourceLabel || '', productId, qty, note || '');
}

function ensureProductsActive(db, productIds) {
  for (const pid of productIds) assertActiveProduct(db, pid);
}

function insertOrUpdateResult(db, runId, partial) {
  // Reuse existing row if present so that aggregate-before-netting
  // works across sales demand, forecast demand, and BOM explosion
  // contributions.
  const existing = db.prepare("SELECT id FROM mrp_run_results WHERE run_id=? AND product_id=?").get(runId, partial.productId);
  if (existing) {
    db.prepare(`
      UPDATE mrp_run_results
         SET gross_sales_demand = ?,
             gross_forecast_demand = ?,
             gross_component_demand = ?,
             gross_requirement = ?,
             on_hand = ?,
             open_purchase_supply = ?,
             open_production_supply = ?,
             net_requirement = ?,
             suggestion_type = ?,
             suggested_quantity = ?,
             need_by_date = COALESCE(?, need_by_date),
             bom_level = ?,
             warning = ?
       WHERE id = ?
    `).run(
      partial.gross_sales_demand,
      partial.gross_forecast_demand,
      partial.gross_component_demand,
      partial.gross_requirement,
      partial.on_hand,
      partial.open_purchase_supply,
      partial.open_production_supply,
      partial.net_requirement,
      partial.suggestion_type,
      partial.suggested_quantity,
      partial.need_by_date || null,
      partial.bom_level || 0,
      partial.warning || '',
      existing.id,
    );
  } else {
    db.prepare(`
      INSERT INTO mrp_run_results(id, run_id, product_id, gross_sales_demand, gross_forecast_demand, gross_component_demand, gross_requirement, on_hand, open_purchase_supply, open_production_supply, net_requirement, suggestion_type, suggested_quantity, need_by_date, bom_level, warning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id(), runId, partial.productId,
      partial.gross_sales_demand,
      partial.gross_forecast_demand,
      partial.gross_component_demand,
      partial.gross_requirement,
      partial.on_hand,
      partial.open_purchase_supply,
      partial.open_production_supply,
      partial.net_requirement,
      partial.suggestion_type,
      partial.suggested_quantity,
      partial.need_by_date || null,
      partial.bom_level || 0,
      partial.warning || '',
    );
  }
}

function insertBomComponentEdges(db, runId, componentParents) {
  const stmt = db.prepare(`
    INSERT INTO mrp_run_components(id, run_id, parent_product_id, product_id, gross_required, bom_path, level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [childPid, parents] of componentParents.entries()) {
    for (const parent of parents) {
      stmt.run(id(), runId, parent.parentId, childPid, parent.qty, parent.path, parent.level);
    }
  }
}

function computeNetting(db, productId, gross) {
  const onHand = productOnHand(db, productId);
  const openPo = openPurchaseSupply(db, productId);
  const openProd = openProductionSupply(db, productId);
  const net = Math.max(0, gross - onHand - openPo - openProd);
  return { onHand, openPo, openProd, net };
}

function decideMakeBuy(db, productId) {
  const bom = productBom(db, productId);
  if (!bom) return 'BUY';
  return 'MAKE';
}

function warningFor(db, productId, suggestionType) {
  if (suggestionType !== 'MAKE') return '';
  const routing = productActiveRouting(db, productId);
  if (!routing) return 'ROUTING_MISSING';
  return '';
}

export async function executeMrpRun(db, req, res, actor, runId) {
  allow(actor, 'MRP_MANAGE');
  const run = db.prepare("SELECT * FROM mrp_runs WHERE id=?").get(runId);
  if (!run) throw new HttpError(404, 'MRP 计算不存在');
  if (run.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的 MRP 可以执行');
  const now = nowIsoLocal();
  const summary = await runMrpCalculation(db, run, actor, now);
  return send(res, 200, { ok: true, summary });
}

export async function runMrpCalculation(db, run, actor, nowIso) {
  // Pre-flight: validate forecast when needed.
  if (run.demand_source_mode !== 'SALES_ORDERS') {
    const forecast = db.prepare("SELECT * FROM planning_forecasts WHERE id=?").get(run.forecast_id);
    if (!forecast) throw new HttpError(400, '关联的计划预测已不存在');
    if (forecast.status !== 'ACTIVE') throw new HttpError(400, '只有已生效的预测可用于 MRP');
  }
  const productMap = new Map(
    db.prepare("SELECT id, code, name, unit FROM products WHERE active=1").all().map((p) => [p.id, p]),
  );
  // Snapshot all demands and the explosion result, then commit
  // atomically so that BOM cycle / validation errors do not leave a
  // half-written run.
  let summary = { totalProducts: 0, makeSuggestions: 0, buySuggestions: 0, shortageProducts: 0 };
  const forecastDemand = run.demand_source_mode !== 'SALES_ORDERS'
    ? buildForecastDemandRows(db, run.forecast_id, run.horizon_start, run.horizon_end)
    : [];
  const salesDemand = run.demand_source_mode !== 'FORECAST'
    ? openSalesDemand(db, run.horizon_start, run.horizon_end)
    : [];
  // Aggregate sales + forecast at product level. Need date is the
  // earliest of all contributor dates so MRP result rows show the
  // earliest relevant need.
  const topGross = new Map(); // productId -> { sales, forecast, needDate }
  for (const row of salesDemand) {
    const cur = topGross.get(row.productId) || { sales: 0, forecast: 0, needDate: null };
    cur.sales += row.quantity;
    if (!cur.needDate || row.needDate < cur.needDate) cur.needDate = row.needDate;
    topGross.set(row.productId, cur);
  }
  for (const row of forecastDemand) {
    const cur = topGross.get(row.productId) || { sales: 0, forecast: 0, needDate: null };
    cur.forecast += row.quantity;
    if (!cur.needDate || row.needDate < cur.needDate) cur.needDate = row.needDate;
    topGross.set(row.productId, cur);
  }
  // Validate referenced products (skip silently missing references —
  // already prevented by FK but defensive).
  for (const [pid] of topGross) {
    if (!productMap.has(pid)) throw new HttpError(400, `需求产品 ${pid} 不存在或已停用`);
  }
  // Net-before-explosion walk: each top-level MAKE parent drives its
  // BOM only with its net requirement (gross - on_hand - open_po -
  // open_prod). If parent has no BOM or net <= 0, it contributes
  // nothing to child demand. Children that are themselves MAKE
  // continue the walk using their accumulated component gross as the
  // next-level gross, and the same netting rule applies recursively.
  const componentGross = new Map(); // productId -> total gross from BOM explosions
  const componentParents = new Map(); // productId -> [{parentId, qty, path, level}]
  const walkState = { active: new Set() };
  for (const [pid, info] of topGross.entries()) {
    const totalGross = info.sales + info.forecast;
    if (totalGross <= 0) continue;
    explodeBomNet(db, pid, totalGross, pid, 0, walkState, componentGross, componentParents);
  }
  // Persist demands, BOM components, results, and pegging inside a
  // single transaction so a cycle / validation failure leaves no
  // partial rows behind.
  transaction(db, () => {
    db.prepare("DELETE FROM mrp_run_results WHERE run_id=?").run(run.id);
    db.prepare("DELETE FROM mrp_run_components WHERE run_id=?").run(run.id);
    db.prepare("DELETE FROM mrp_run_demands WHERE run_id=?").run(run.id);
    db.prepare("DELETE FROM mrp_run_pegging WHERE run_id=?").run(run.id);
    insertBomComponentEdges(db, run.id, componentParents);
    for (const row of salesDemand) {
      upsertDemandRow(db, run.id, {
        productId: row.productId,
        needDate: row.needDate,
        sourceType: 'SALES_ORDER',
        sourceId: row.orderId,
        sourceLabel: `销售订单 ${row.orderNo}`,
        quantity: row.quantity,
      }, productMap);
      upsertPegg(db, run.id, row.productId, 'SALES_ORDER', row.orderId, `销售订单 ${row.orderNo}`, row.quantity, '');
    }
    for (const row of forecastDemand) {
      upsertDemandRow(db, run.id, {
        productId: row.productId,
        needDate: row.needDate,
        sourceType: 'FORECAST',
        sourceId: row.orderId,
        sourceLabel: '计划预测',
        quantity: row.quantity,
      }, productMap);
      upsertPegg(db, run.id, row.productId, 'FORECAST', row.orderId, '计划预测', row.quantity, '');
    }
    // Walk end-item demands first so that any product that appears
    // both as a parent and as a component gets its MAKE/BUY decision
    // from the parent side.
    const allProductIds = new Set();
    for (const [pid] of topGross) allProductIds.add(pid);
    for (const [pid] of componentGross) allProductIds.add(pid);
    let totalProducts = 0;
    let makeSuggestions = 0;
    let buySuggestions = 0;
    let shortageProducts = 0;
    for (const pid of allProductIds) {
      const topInfo = topGross.get(pid) || { sales: 0, forecast: 0, needDate: null };
      const parents = componentParents.get(pid);
      const grossFromComponents = parents ? parents.reduce((sum, p) => sum + p.qty, 0) : 0;
      const gross = topInfo.sales + topInfo.forecast + grossFromComponents;
      if (gross <= 0) continue;
      const netting = computeNetting(db, pid, gross);
      const suggestionType = netting.net > 0 ? decideMakeBuy(db, pid) : '';
      const warning = warningFor(db, pid, suggestionType);
      const bomLevel = parents ? parents.reduce((m, p) => Math.max(m, p.level || 0), 0) : 0;
      insertOrUpdateResult(db, run.id, {
        productId: pid,
        gross_sales_demand: topInfo.sales,
        gross_forecast_demand: topInfo.forecast,
        gross_component_demand: grossFromComponents,
        gross_requirement: gross,
        on_hand: netting.onHand,
        open_purchase_supply: netting.openPo,
        open_production_supply: netting.openProd,
        net_requirement: netting.net,
        suggestion_type: suggestionType,
        suggested_quantity: netting.net,
        need_by_date: topInfo.needDate || null,
        bom_level: bomLevel,
        warning,
      });
      // Pegging for component contributions (BOM_EXPLOSION quantities
      // come from parent_net × bom_qty × scrap, never parent_gross).
      if (parents) {
        for (const parent of parents) {
          upsertPegg(db, run.id, pid, 'BOM_EXPLOSION', parent.parentId, `BOM 展开 ${parent.path}`, parent.qty, '');
        }
      }
      totalProducts += 1;
      if (netting.net > 0) {
        if (suggestionType === 'MAKE') makeSuggestions += 1;
        else if (suggestionType === 'BUY') buySuggestions += 1;
        shortageProducts += 1;
      }
    }
    summary = { totalProducts, makeSuggestions, buySuggestions, shortageProducts };
    db.prepare("UPDATE mrp_runs SET status='COMPLETED', completed_at=?, summary=?, updated_at=? WHERE id=?")
      .run(nowIso, JSON.stringify(summary), nowIso, run.id);
    audit(db, actor.id, 'EXECUTE', 'MRP_RUN', run.id, `MRP ${run.run_code} 已完成`);
  });
  return summary;
}

function nowIsoLocal() {
  return new Date().toISOString();
}

export { FORECAST_STATUS, MRP_RUN_STATUS, DEMAND_MODES, MAX_BOM_DEPTH };
