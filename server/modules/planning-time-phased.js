// Planning — time-phased netting engine.
//
// Design §25.5 / §25.6. This module owns two things and nothing else:
//
//   1. the deterministic ordering of demand / supply events, and
//   2. the running-balance projection that turns those events into a net
//      requirement.
//
// It owns NO business fact. Every event it projects is handed to it by the
// caller, which stays responsible for reading the authoritative source
// (Sales Order, Forecast bucket, Purchase Order, Production Order, Planned
// Order, Inventory). The MRP run (server/modules/planning.js) and the
// dynamic read model (server/modules/planning-domain.js) both consume this
// module so that neither of them can grow a second netting algorithm.
//
// Safety stock is a PROJECTED-BALANCE FLOOR, never an additive demand: it
// creates one replenishment requirement at the first bucket whose projected
// balance falls below the floor, and it is never repeated per bucket.

import { listStandardPurchaseSupplyByProduct } from './procurement-orders.js';

const EPS = 1e-9;

export const PLANNING_BUCKETS = Object.freeze(['DAY', 'WEEK', 'MONTH']);

export function planningBucketStart(date, bucket = 'DAY') {
  const text = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (bucket === 'MONTH') return `${text.slice(0, 7)}-01`;
  if (bucket === 'WEEK') {
    const day = new Date(`${text}T00:00:00Z`);
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - mondayOffset * 86400000).toISOString().slice(0, 10);
  }
  return text;
}

// Deterministic event order (Design §25.6): event_date, then demand before
// supply, then source identity. The order is total so that two runs over
// the same facts always produce the same projection.
export function sortPlanningEvents(events) {
  return [...events].sort((left, right) => {
    const leftDate = String(left.eventDate || '');
    const rightDate = String(right.eventDate || '');
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    if (left.direction !== right.direction) return left.direction === 'DEMAND' ? -1 : 1;
    const leftType = String(left.sourceType || '');
    const rightType = String(right.sourceType || '');
    if (leftType !== rightType) return leftType < rightType ? -1 : 1;
    const leftId = String(left.sourceId || '');
    const rightId = String(right.sourceId || '');
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
    return 0;
  });
}

// projectTimePhasedNetting walks the ordered event stream and returns the
// net requirement plus the per-date breakdown that produced it.
//
//   projected = opening on-hand
//   for each event:
//     supply   -> projected += quantity
//     demand   -> projected -= quantity; a negative balance becomes the
//                 shortage that has to be replenished and the balance
//                 returns to zero (the planned receipt arrives there)
//
// The safety-stock floor is NOT applied inside this walk. The authoritative
// floor requirement is a single per-product / per-horizon replenishment
// computed from the aggregate netting, so that the floor can never be
// counted once per bucket. The walk only reports WHERE the projected
// balance first fell below the floor and how big the gap was at each
// bucket, which is the dated explanation of that single requirement.
//
// `netByDate` carries the requirement that was created at each date. It is
// what lets a parent BOM explosion place the child's demand on the same date
// as the parent's shortage instead of collapsing every shortage into one
// undated quantity.
export function projectTimePhasedNetting({
  openingOnHand = 0,
  safetyStock = 0,
  supplies = [],
  demands = [],
} = {}) {
  const ordered = sortPlanningEvents([
    ...supplies.map((event) => ({ ...event, direction: 'SUPPLY' })),
    ...demands.map((event) => ({ ...event, direction: 'DEMAND' })),
  ]);
  const floor = Math.max(0, Number(safetyStock || 0));
  let projected = Number(openingOnHand || 0);
  let netRequirement = 0;
  let floorBreachDate = null;
  const netByDate = new Map();
  const buckets = new Map();

  for (const event of ordered) {
    const quantity = Number(event.quantity || 0);
    if (event.direction === 'SUPPLY') {
      projected += quantity;
    } else if (quantity > EPS) {
      projected -= quantity;
      if (projected < -EPS) {
        const uncovered = -projected;
        netRequirement += uncovered;
        netByDate.set(event.eventDate, (netByDate.get(event.eventDate) || 0) + uncovered);
        projected = 0;
      }
    }
    if (!floorBreachDate && floor > EPS && projected < floor - EPS) {
      floorBreachDate = event.eventDate;
    }
    const bucket = buckets.get(event.eventDate) || {
      date: event.eventDate,
      projectedBalance: 0,
      shortage: 0,
      netRequirementToDate: 0,
    };
    bucket.projectedBalance = projected;
    bucket.shortage = Math.max(0, floor - projected);
    bucket.netRequirementToDate = netRequirement;
    buckets.set(event.eventDate, bucket);
  }

  return {
    netRequirement,
    netByDate: [...netByDate.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1)),
    buckets: [...buckets.values()].sort((left, right) => (left.date < right.date ? -1 : 1)),
    openingOnHand: Number(openingOnHand || 0),
    projectedEnd: projected,
    safetyFloor: floor,
    floorBreachDate,
  };
}

// Aggregate the projection into the per-date demand map the explosion uses.
export function projectDemandByDate(demands) {
  const map = new Map();
  for (const demand of demands) {
    const date = String(demand.eventDate || '');
    if (!date) continue;
    const quantity = Number(demand.quantity || 0);
    if (!(quantity > EPS)) continue;
    map.set(date, (map.get(date) || 0) + quantity);
  }
  return [...map.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Supply sourcing
// ---------------------------------------------------------------------------
//
// The builders below read the AUTHORITATIVE supply sources and turn them
// into dated supply events. They never write anything.
//
// `warehouseIds` scopes every source to the warehouses the Planning Scheme
// participates in (Design §25.7: "按 scheme warehouse scope 聚合"). A null
// scope means "every warehouse", which is the behaviour for a run without a
// scheme.

function scopeClause(column, warehouseIds, params) {
  if (!Array.isArray(warehouseIds) || warehouseIds.length === 0) return '';
  params.push(...warehouseIds);
  return ` AND ${column} IN (${warehouseIds.map(() => '?').join(',')})`;
}

export function planningOnHandQuantity(db, productId, warehouseIds = null) {
  const product = db.prepare('SELECT tracking_policy FROM products WHERE id=?').get(productId);
  const today = new Date().toISOString().slice(0, 10);
  if (product?.tracking_policy === 'SERIAL') {
    const params = [productId, today];
    const clause = scopeClause('current_warehouse_id', warehouseIds, params);
    return Number(db.prepare(`SELECT COUNT(*) total FROM inventory_serials
      WHERE product_id=? AND lifecycle_state='AVAILABLE' AND (expiry_date IS NULL OR expiry_date>=?)${clause}`).get(...params).total);
  }
  if (product?.tracking_policy === 'LOT') {
    const params = [productId, today];
    const clause = scopeClause('v.warehouse_id', warehouseIds, params);
    return Number(db.prepare(`SELECT COALESCE(SUM(v.quantity),0) total FROM inventory_valuation_balances v
      JOIN inventory_lots l ON l.id=v.lot_id
      WHERE v.product_id=? AND l.status='AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date>=?)${clause}`).get(...params).total);
  }
  const params = [productId];
  const clause = scopeClause('warehouse_id', warehouseIds, params);
  return Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) total FROM inventory WHERE product_id=?${clause}`).get(...params).total);
}

function purchaseDueDate(db, orderId, fallback) {
  const order = db.prepare('SELECT expected_delivery_date, order_date, created_at FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) return fallback;
  return order.expected_delivery_date || order.order_date || String(order.created_at || '').slice(0, 10) || fallback;
}

function productionFirmSupplyRows(db, productId, warehouseIds = null) {
  const ordered = db.prepare(`
    SELECT id, quantity, planned_start, planned_finish
      FROM production_orders
     WHERE product_id=? AND status IN ('RELEASED','IN_PROGRESS')`).all(productId);
  const rows = [];
  for (const order of ordered) {
    const received = Number(db.prepare(`
      SELECT COALESCE(SUM(pr.quantity),0) total FROM production_receipts pr
       WHERE pr.production_order_id=? AND pr.status='CONFIRMED'`).get(order.id).total);
    const remaining = Math.max(0, Number(order.quantity || 0) - received);
    if (remaining <= EPS) continue;
    rows.push({ orderId: order.id, remaining, date: order.planned_start || order.planned_finish || null });
  }
  return rows;
}

function plannedOrderSupplyRows(db, productId, warehouseIds = null) {
  return db.prepare(`
    SELECT id, order_no, quantity, released_quantity, need_date, planned_supply_date, supply_type
      FROM planned_orders
     WHERE product_id=? AND status='CONFIRMED'`).all(productId)
    .map((row) => ({
      orderId: row.id,
      orderNo: row.order_no,
      remaining: Math.max(0, Number(row.quantity || 0) - Number(row.released_quantity || 0)),
      date: row.planned_supply_date || row.need_date || null,
      supplyType: row.supply_type,
    }))
    .filter((row) => row.remaining > EPS);
}

// buildPlanningSupplyEvents returns the opening on-hand balance plus the
// dated supply events for one product inside one horizon.
//
// The aggregate counters are kept because the MRP result row still reports
// them (on_hand / open_purchase_supply / open_production_supply); the dated
// events are what the time-phased projection consumes.
export function buildPlanningSupplyEvents(db, productId, {
  horizonStart,
  horizonEnd,
  warehouseIds = null,
  includePlannedOrders = true,
} = {}) {
  const start = String(horizonStart || '').slice(0, 10);
  const end = String(horizonEnd || '').slice(0, 10);
  const onHand = planningOnHandQuantity(db, productId, warehouseIds);
  const events = [];

  let openPurchase = 0;
  const purchaseLines = listStandardPurchaseSupplyByProduct(db, productId, end ? { expectedThrough: end } : {});
  const purchaseByOrder = new Map();
  for (const line of purchaseLines) {
    const orderId = line.orderId;
    purchaseByOrder.set(orderId, (purchaseByOrder.get(orderId) || 0) + Number(line.remaining || 0));
  }
  for (const [orderId, quantity] of purchaseByOrder.entries()) {
    if (!(quantity > EPS)) continue;
    openPurchase += quantity;
    const date = purchaseDueDate(db, orderId, start);
    if (date && end && date > end) continue;
    events.push({
      eventDate: date || start,
      quantity,
      sourceType: 'PURCHASE_ORDER',
      sourceId: orderId,
      sourceLabel: `采购订单 ${orderId}`,
      firm: 1,
    });
  }

  let openProduction = 0;
  for (const row of productionFirmSupplyRows(db, productId, warehouseIds)) {
    openProduction += row.remaining;
    const date = row.date && (!end || row.date <= end) ? row.date : start;
    events.push({
      eventDate: date || start,
      quantity: row.remaining,
      sourceType: 'PRODUCTION_ORDER',
      sourceId: row.orderId,
      sourceLabel: `生产订单 ${row.orderId}`,
      firm: 1,
    });
  }

  let openPlanned = 0;
  if (includePlannedOrders) {
    for (const row of plannedOrderSupplyRows(db, productId, warehouseIds)) {
      openPlanned += row.remaining;
      const date = row.date && (!end || row.date <= end) ? row.date : start;
      events.push({
        eventDate: date || start,
        quantity: row.remaining,
        sourceType: 'PLANNED_ORDER',
        sourceId: row.orderId,
        sourceLabel: `计划订单 ${row.orderNo || row.orderId}`,
        firm: 1,
      });
    }
  }

  events.sort((left, right) => (left.eventDate < right.eventDate ? -1 : left.eventDate > right.eventDate ? 1 : 0));

  return {
    onHand,
    openPurchase,
    openProduction,
    openPlanned,
    events,
  };
}

// ---------------------------------------------------------------------------
// Demand sourcing
// ---------------------------------------------------------------------------

// The demand rows that the read model projects: the remaining demand of every
// APPROVED Sales Order line and every ACTIVE forecast bucket, dated by their
// contractual need date.
export function buildPlanningDemandEvents(db, productId, { from, to } = {}) {
  const events = [];
  const start = String(from || '').slice(0, 10);
  const end = String(to || '').slice(0, 10);
  const orders = db.prepare(`
    SELECT id, order_no, submitted_at, reviewed_at, created_at,
           requested_delivery_date, order_date
      FROM sales_orders
     WHERE status = 'APPROVED'
  `).all();
  for (const order of orders) {
    const isLegacyOrder = !order.requested_delivery_date && !order.order_date;
    const rawDate = order.requested_delivery_date
      || (isLegacyOrder ? (order.submitted_at || order.reviewed_at || order.created_at || '').slice(0, 10) : '');
    if (!rawDate) continue;
    if (start && rawDate < start) continue;
    if (end && rawDate > end) continue;
    const ordered = db.prepare('SELECT product_id, quantity FROM sales_order_items WHERE order_id=?').all(order.id);
    const delivered = db.prepare(`
      SELECT sdi.product_id, COALESCE(SUM(sdi.quantity), 0) total
        FROM sales_delivery_items sdi
        JOIN sales_deliveries sd ON sd.id = sdi.delivery_id
       WHERE sd.sales_order_id = ? AND sd.status = 'CONFIRMED'
       GROUP BY sdi.product_id
    `).all(order.id);
    const deliveredMap = new Map(delivered.map((row) => [row.product_id, Number(row.total)]));
    for (const line of ordered) {
      if (line.product_id !== productId) continue;
      const remaining = Math.max(0, Number(line.quantity || 0) - (deliveredMap.get(line.product_id) || 0));
      if (remaining <= EPS) continue;
      events.push({
        eventDate: rawDate,
        quantity: remaining,
        sourceType: 'SALES_ORDER',
        sourceId: order.id,
        sourceLabel: `销售订单 ${order.order_no}`,
      });
    }
  }
  const forecastRows = db.prepare(`
    SELECT i.id, i.need_date, i.quantity, f.forecast_code
      FROM planning_forecast_items i
      JOIN planning_forecasts f ON f.id = i.forecast_id
     WHERE f.status = 'ACTIVE' AND i.product_id = ?
       AND i.need_date BETWEEN ? AND ?
  `).all(productId, start, end);
  for (const row of forecastRows) {
    events.push({
      eventDate: row.need_date,
      quantity: Number(row.quantity || 0),
      sourceType: 'FORECAST',
      sourceId: row.id,
      sourceLabel: `计划预测 ${row.forecast_code}`,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Bucketed projection
// ---------------------------------------------------------------------------

// projectBucketedNetting groups the event stream into time buckets and
// projects the balance bucket by bucket. It is the read-model counterpart of
// the run-scoped projection: the same event semantics, a coarser time axis.
export function projectBucketedNetting({
  openingOnHand = 0,
  safetyStock = 0,
  maximumStock = 0,
  bucket = 'DAY',
  supplies = [],
  demands = [],
} = {}) {
  const floor = Math.max(0, Number(safetyStock || 0));
  const maximum = Math.max(0, Number(maximumStock || 0));
  const buckets = new Map();
  const ensure = (key) => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = {
      bucket: key,
      demand: 0,
      supply: 0,
      projectedBalance: Number(openingOnHand || 0),
      shortage: 0,
      excess: 0,
      exception: '',
    };
    buckets.set(key, created);
    return created;
  };
  for (const event of demands) ensure(planningBucketStart(event.eventDate, bucket)).demand += Number(event.quantity || 0);
  for (const event of supplies) ensure(planningBucketStart(event.eventDate, bucket)).supply += Number(event.quantity || 0);
  let projected = Number(openingOnHand || 0);
  const rows = [];
  for (const key of [...buckets.keys()].sort()) {
    const row = buckets.get(key);
    projected += row.supply - row.demand;
    row.projectedBalance = projected;
    row.shortage = Math.max(0, floor - projected);
    row.excess = maximum > 0 ? Math.max(0, projected - maximum) : 0;
    row.exception = projected < floor ? 'SHORTAGE' : (maximum > 0 && projected > maximum ? 'EXCESS' : '');
    rows.push(row);
  }
  return rows;
}
