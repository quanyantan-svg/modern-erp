// Wave 7 — Sales Reservation Intent canonical writer.
//
// Implements solution.md §29.17 + document.md §34.3.13.
//
// Sales owns ONLY the reservation intent (request / grant / consume / release).
// Canonical reserved quantity truth lives in:
//   * `inventory_locks` (Inventory V21, INVENTORY_LOCK mode)
//   * `planning_reservations` (Planning V19, MANUAL_RESERVATION /
//     ON_HAND_RESERVATION / EXPECTED_SUPPLY_RESERVATION modes)
//
// Sales writes `sales_reservation_intent` only; it does NOT maintain a Sales
// shadow balance. The intent row records the source-link (sales_order_id,
// sales_order_item_id, product_id, warehouse_id), the reservation_mode, the
// authoritative canonical FK (inventory_lock_id / planning_reservation_id), and
// the qty progression (requested / granted / consumed / released).
//
// React-to-event contract (per §29.17.2):
//   SO Change       → adjust/release and re-request delta through the same owner adapter
//   SO Cancel/Close → release remaining canonical lock/reservation
//   Delivery        → consume or release delivered portion; never exceed canonical grant
//   Return          → no automatic recreation; explicit policy may re-request
//   Replacement     → new source-linked intent; does not reopen original intent
//
// EXPECTED_SUPPLY_RESERVATION is bounded by the finite-supply contract: if no
// finite capacity is provided via `expected_supply_capacity`, the writer fails
// closed. The frozen Planning `physicalSupplyQuantity(EXPECTED)` returns
// POSITIVE_INFINITY, so we never delegate to it directly — Sales must compute
// capacity from `expected_supply_capacity` itself.

import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import { computePositionKey } from '../lib/inventory-position.js';
import { authorizeSalesPrepaymentGateWithPlan, discoverSalesPrepaymentGatePlan } from './sales-prepayment-gate.js';
import { isGateRetryAdmissionExpired, startGateRetryAdmission } from './sales-gate-retry-admission.js';
import { lockSuffix } from './sales-scope.js';
import {
  createPlanningReservationCanonical,
  recordPlanningReservationConsumption,
  releasePlanningReservationCanonical,
} from './planning-domain.js';

const now = () => new Date().toISOString();

const RESERVATION_MODES = Object.freeze([
  'INVENTORY_LOCK',
  'MANUAL_RESERVATION',
  'ON_HAND_RESERVATION',
  'EXPECTED_SUPPLY_RESERVATION',
]);
const INTENT_STATES = Object.freeze(['NONE', 'REQUESTED', 'GRANTED', 'RELEASED', 'CONSUMED']);
const CONSUMER_EVENTS = Object.freeze(['SO_CHANGED', 'SO_CANCELLED', 'SO_CLOSED', 'DELIVERY_CONFIRMED', 'RETURNED', 'REPLACEMENT', 'MANUAL']);

function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function loadOrder(db, orderId, { locked = false } = {}) {
  const suffix = locked ? lockSuffix(db) : '';
  const row = db.prepare(`SELECT id, order_no, customer_id, status, sales_group_id, salesperson_id,
      commercial_close_state
    FROM sales_orders WHERE id=?${suffix}`).get(orderId);
  if (!row) throw new HttpError(404, '销售订单不存在');
  return row;
}

function loadOrderItem(db, itemId, { locked = false } = {}) {
  const suffix = locked ? lockSuffix(db) : '';
  const row = db.prepare(`SELECT id, order_id, product_id, line_no, quantity
    FROM sales_order_items WHERE id=?${suffix}`).get(itemId);
  if (!row) throw new HttpError(404, '订单明细不存在');
  return row;
}

function requireSalesGroupScope(db, actor, { salesGroupId, businessDate }) {
  if (!salesGroupId) return;
  const salesperson = db.prepare('SELECT id FROM salesperson_profiles WHERE user_id=?').get(actor.id);
  if (salesperson) {
    const member = db.prepare(`SELECT id FROM salesperson_group_memberships
      WHERE salesperson_id=? AND sales_group_id=? AND active=1`).get(salesperson.id, salesGroupId);
    if (member) return;
  }
  if (actor.roleCode === 'ADMIN') return;
  const group = db.prepare('SELECT id, group_code, name FROM sales_groups WHERE id=?').get(salesGroupId);
  throw new HttpError(403, `不在销售组 ${group?.group_code || salesGroupId} 范围内`, { code: 'SALES_GROUP_SCOPE_DENIED' });
}

function findActiveIntent(db, { salesOrderId, salesOrderItemId, mode, locked = false }) {
  const suffix = locked ? lockSuffix(db) : '';
  const row = db.prepare(`SELECT * FROM sales_reservation_intent
    WHERE sales_order_id=? AND COALESCE(sales_order_item_id,'')=COALESCE(?,'') AND reservation_mode=?
    ORDER BY created_at DESC LIMIT 1${suffix}`).get(salesOrderId, salesOrderItemId || '', mode);
  return row || null;
}

function summarizeIntent(row) {
  if (!row) return null;
  return {
    id: row.id,
    salesOrderId: row.sales_order_id,
    salesOrderItemId: row.sales_order_item_id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    reservationMode: row.reservation_mode,
    intentState: row.intent_state,
    requestedQty: Number(row.requested_qty),
    grantedQty: Number(row.granted_qty),
    consumedQty: Number(row.consumed_qty),
    releasedQty: Number(row.released_qty),
    planningReservationId: row.planning_reservation_id,
    inventoryLockId: row.inventory_lock_id,
    expectedSupplySourceType: row.expected_supply_source_type,
    expectedSupplySourceId: row.expected_supply_source_id,
    expectedSupplyCapacity: row.expected_supply_capacity == null ? null : Number(row.expected_supply_capacity),
    consumerEvent: row.consumer_event,
    requestedAt: row.requested_at,
    grantedAt: row.granted_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function createInventoryLockAdapter(db, actor, args) {
  // Inventory V21 — `inventory_locks` is the canonical lock truth.
  // We mirror its surface for Sales consumers; the caller must already be in a
  // transaction. Returns the lockId.
  const productId = args.productId;
  const warehouseId = args.warehouseId;
  const quantity = Number(args.quantity);
  if (!productId || !warehouseId || !isPositiveNumber(quantity)) throw new HttpError(400, '产品 / 仓库 / 数量必填');
  const onHand = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1 AND stock_status='AVAILABLE'`).get(productId, warehouseId)?.q || 0);
  const positionKey = computePositionKey({
    productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  const alreadyLocked = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE position_key=? AND status='ACTIVE'`).get(positionKey)?.q || 0);
  if (alreadyLocked + quantity > onHand) {
    throw new HttpError(409, `锁库数量超过可锁量：可用 ${onHand - alreadyLocked}，需锁 ${quantity}`);
  }
  const lockId = randomUUID();
  const stamp = now();
  db.prepare(`INSERT INTO inventory_locks(id, product_id, warehouse_id, position_key, quantity, reason, status, locked_by, locked_at, source_type, source_id)
    VALUES(?,?,?,?,?,?, 'ACTIVE', ?, ?, ?, ?)`).run(lockId, productId, warehouseId, positionKey, quantity, `SALES_RESERVATION_INTENT:${args.salesOrderId}`, actor.id, stamp, 'SALES_ORDER', args.salesOrderId);
  audit(db, actor.id, 'INVENTORY_LOCK_CREATE', 'INVENTORY_LOCK', lockId, `${productId}@${warehouseId} ${quantity}`);
  return lockId;
}

function releaseInventoryLockAdapter(db, actor, lockId) {
  if (!lockId) return;
  const lock = db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(lockId);
  if (!lock) return;
  if (lock.status !== 'ACTIVE') return;
  db.prepare(`UPDATE inventory_locks SET status='RELEASED', released_by=?, released_at=? WHERE id=?`).run(actor.id, now(), lockId);
  audit(db, actor.id, 'INVENTORY_LOCK_RELEASE', 'INVENTORY_LOCK', lockId, `${lock.product_id}@${lock.warehouse_id} ${lock.quantity}`);
}

function createPlanningReservationAdapter(db, actor, args) {
  try {
    const result = createPlanningReservationCanonical(db, actor, {
      reservationType: args.reservationType,
      demandSourceType: 'SALES_ORDER',
      demandSourceId: args.salesOrderId,
      demandSourceLineId: args.salesOrderItemId || null,
      supplySourceType: args.supplySourceType,
      supplySourceId: args.supplySourceId || null,
      productId: args.productId,
      warehouseId: args.warehouseId || null,
      quantity: args.quantity,
      priority: args.priority,
      notes: `Sales reservation intent: ${args.salesOrderId}`,
    });
    return result.id;
  } catch (error) {
    // Preserve the approved Sales API error contract while Planning remains the
    // sole owner of validation, locking, capacity calculation and persistence.
    if (error?.code === 'PLANNING_EXPECTED_FINITE_SOURCE_REQUIRED') {
      throw new HttpError(409, 'EXPECTED 模式需要 Planning 端有界集成扩展以提供权威有限供给；当前 fail closed', {
        code: 'SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED',
      });
    }
    if (error?.code === 'PLANNING_RESERVATION_CAPACITY_EXCEEDED') {
      const remaining = Number(error.details?.remaining ?? 0);
      throw new HttpError(409, `可预留供应仅剩 ${remaining}`, {
        code: 'SALES_RESERVATION_CAPACITY_EXCEEDED',
        supplySourceType: args.supplySourceType,
        supplySourceId: args.supplySourceId || null,
        remaining,
        requested: Number(args.quantity),
      });
    }
    throw error;
  }
}

function releasePlanningReservationAdapter(db, actor, reservationId) {
  if (!reservationId) return;
  releasePlanningReservationCanonical(db, actor, reservationId);
}

function consumePlanningReservationAdapter(db, actor, reservationId, qty) {
  if (!reservationId) return;
  recordPlanningReservationConsumption(db, actor, reservationId, qty);
}

const RESERVATION_REDISCOVERY_CODES = new Set([
  'SALES_PREPAYMENT_LOCK_PLAN_STALE',
  'SALES_PREPAYMENT_PARENT_MISSING',
  'SALES_PREPAYMENT_PARENT_CLOSED',
  'SALES_RESERVATION_INTENT_PLAN_STALE',
]);

function reservationOuterAttempts() {
  const configured = Number(process.env.ERP_GATE_ATTEMPTS_MAX ?? 3);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3 ? configured : 3;
}

function isReservationRediscoveryEligible(error) {
  if (!error) return false;
  if (error.transactionRetryExhausted) return true;
  return RESERVATION_REDISCOVERY_CODES.has(error.code)
    || RESERVATION_REDISCOVERY_CODES.has(error?.details?.code);
}

function waitForReservationRediscovery(attempt) {
  const delayMs = Math.min(100, 20 * (2 ** (attempt - 1)));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function readReservationSalesRows(db, { salesOrderId, salesOrderItemId, locked = false }) {
  const order = loadOrder(db, salesOrderId, { locked });
  const item = salesOrderItemId ? loadOrderItem(db, salesOrderItemId, { locked }) : null;
  if (item && item.order_id !== order.id) {
    throw new HttpError(409, '订单行不属于该订单', { code: 'SALES_RESERVATION_INTENT_ITEM_MISMATCH' });
  }
  return { order, item };
}

function reservationSalesFingerprint(order, item) {
  return createHash('sha256').update(JSON.stringify({ order, item })).digest('hex');
}

function assertNoDuplicateRequestedIntent(db, input, { locked = false } = {}) {
  const existing = findActiveIntent(db, { ...input, locked });
  if (existing && existing.intent_state === 'REQUESTED') {
    throw new HttpError(409, '该订单行已存在 REQUESTED 意图，请先释放或消费', { code: 'SALES_RESERVATION_INTENT_DUPLICATE' });
  }
  return existing;
}

function discoverReservationIntentPlan(db, actor, input) {
  const { order, item } = readReservationSalesRows(db, input);
  requireSalesGroupScope(db, actor, {
    salesGroupId: order.sales_group_id,
    businessDate: input.businessDate,
  });
  assertNoDuplicateRequestedIntent(db, input);
  const gatePlan = discoverSalesPrepaymentGatePlan(db, input.salesOrderId, input.businessDate);
  return Object.freeze({
    salesFingerprint: reservationSalesFingerprint(order, item),
    gatePlan: Object.freeze({
      ...gatePlan,
      parentBalanceIds: Object.freeze([...gatePlan.parentBalanceIds]),
    }),
  });
}

// ---------- public API ----------

export function listReservationIntents(db, res, actor, url) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const salesOrderId = url.searchParams.get('salesOrderId');
  const where = [];
  const args = [];
  if (salesOrderId) { where.push('sales_order_id=?'); args.push(salesOrderId); }
  const rows = db.prepare(`SELECT * FROM sales_reservation_intent
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT 500`).all(...args);
  return send(res, 200, { intents: rows.map(summarizeIntent) });
}

export function getReservationIntent(db, res, actor, id) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const row = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '预留意图不存在');
  return send(res, 200, summarizeIntent(row));
}

export async function requestReservationIntent(db, req, res, actor) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const salesOrderId = body.salesOrderId || body.sales_order_id;
  if (!salesOrderId) throw new HttpError(400, 'salesOrderId 必填');
  const mode = String(body.reservationMode || body.reservation_mode || '').toUpperCase();
  if (!RESERVATION_MODES.includes(mode)) throw new HttpError(400, `reservationMode 仅支持 ${RESERVATION_MODES.join(' / ')}`);
  const salesOrderItemId = body.salesOrderItemId || body.sales_order_item_id || null;
  const businessDate = body.businessDate || now().slice(0, 10);
  const order = loadOrder(db, salesOrderId);
  if (salesOrderItemId) {
    const item = loadOrderItem(db, salesOrderItemId);
    if (item.order_id !== order.id) {
      throw new HttpError(409, '订单行不属于该订单', { code: 'SALES_RESERVATION_INTENT_ITEM_MISMATCH' });
    }
  }
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate });

  const productId = body.productId || body.product_id;
  const warehouseId = body.warehouseId || body.warehouse_id || null;
  if (!productId) throw new HttpError(400, 'productId 必填');
  const quantity = Number(body.quantity);
  if (!isPositiveNumber(quantity)) throw new HttpError(400, 'quantity 必须为正数');

  const expectedSupplySourceType = body.expectedSupplySourceType || body.expected_supply_source_type || null;
  const expectedSupplySourceId = body.expectedSupplySourceId || body.expected_supply_source_id || null;
  if (mode === 'EXPECTED_SUPPLY_RESERVATION') {
    // Client-supplied `expectedSupplyCapacity` is NEVER used as authority
    // (per solution.md §29.17.1 + task instruction §4). The canonical
    // authority is the concrete Planning/Purchase/Production source record
    // looked up by the Planning adapter. We persist the source identity
    // here for audit only; the adapter will fail closed if the source is
    // pure EXPECTED (no concrete document).
    if (!expectedSupplySourceType) {
      throw new HttpError(400, 'EXPECTED 模式必须指定 expectedSupplySourceType (PLANNED_ORDER/PURCHASE_ORDER/PRODUCTION_ORDER/EXPECTED)', { code: 'SALES_RESERVATION_EXPECTED_SOURCE_REQUIRED' });
    }
    if (!['EXPECTED', 'PLANNED_ORDER', 'PURCHASE_ORDER', 'PRODUCTION_ORDER'].includes(expectedSupplySourceType)) {
      throw new HttpError(400, `expectedSupplySourceType 不支持: ${expectedSupplySourceType}`, { code: 'SALES_RESERVATION_EXPECTED_SOURCE_UNSUPPORTED' });
    }
  }

  assertNoDuplicateRequestedIntent(db, { salesOrderId, salesOrderItemId, mode });

  const stamp = now();
  const intentId = randomUUID();
  const input = Object.freeze({ salesOrderId, salesOrderItemId, mode, businessDate });
  const maxAttempts = reservationOuterAttempts();
  const admission = startGateRetryAdmission(process.env.ERP_GATE_ATTEMPTS_BUDGET_MS);
  let attemptsStarted = 0;
  const deadlineExhausted = () => new HttpError(503, '预留意图请求重试已耗尽', {
    code: 'SALES_RESERVATION_INTENT_RETRY_EXHAUSTED',
    retryable: true,
    attempts: attemptsStarted,
    causeCode: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
  });
  while (attemptsStarted < maxAttempts) {
    if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
    attemptsStarted += 1;
    const attempt = attemptsStarted;
    const plan = discoverReservationIntentPlan(db, actor, input);
    let result;
    try {
      transaction(db, () => {
        // L1 -> L6 -> L7. The shared helper owns the Finance/Gate prefix.
        authorizeSalesPrepaymentGateWithPlan(db, plan.gatePlan, {
          stage: 'RESERVATION',
          actorId: actor.id,
          mutationKey: `ACTION|RESERVATION|REQUEST|${intentId}`,
        });

        // Sales business rows follow the Gate prefix. Only these locked rows,
        // never the unlocked discovery snapshot, authorize the mutation.
        const { order: lockedOrder, item: lockedItem } = readReservationSalesRows(db, {
          salesOrderId, salesOrderItemId, locked: true,
        });
        if (reservationSalesFingerprint(lockedOrder, lockedItem) !== plan.salesFingerprint) {
          throw new HttpError(409, '预留意图计划已过期，请重试', {
            code: 'SALES_RESERVATION_INTENT_PLAN_STALE',
          });
        }
        requireSalesGroupScope(db, actor, { salesGroupId: lockedOrder.sales_group_id, businessDate });
        assertNoDuplicateRequestedIntent(db, input, { locked: true });

        let inventoryLockId = null;
        let planningReservationId = null;
        if (mode === 'INVENTORY_LOCK') {
          inventoryLockId = createInventoryLockAdapter(db, actor, { salesOrderId, productId, warehouseId, quantity });
        } else if (mode === 'MANUAL_RESERVATION') {
          planningReservationId = createPlanningReservationAdapter(db, actor, {
            salesOrderId, salesOrderItemId, productId, warehouseId, quantity,
            reservationType: 'MANUAL', supplySourceType: body.supplySourceType || body.supply_source_type || 'ON_HAND',
            supplySourceId: body.supplySourceId || body.supply_source_id || null,
          });
        } else if (mode === 'ON_HAND_RESERVATION') {
          planningReservationId = createPlanningReservationAdapter(db, actor, {
            salesOrderId, salesOrderItemId, productId, warehouseId, quantity,
            reservationType: 'STRONG', supplySourceType: 'ON_HAND', supplySourceId: null,
          });
        } else if (mode === 'EXPECTED_SUPPLY_RESERVATION') {
          planningReservationId = createPlanningReservationAdapter(db, actor, {
            salesOrderId, salesOrderItemId, productId, warehouseId, quantity,
            reservationType: 'STRONG',
            supplySourceType: expectedSupplySourceType,
            supplySourceId: expectedSupplySourceId,
          });
        } else {
          throw new HttpError(400, 'reservationMode 不支持');
        }
        db.prepare(`INSERT INTO sales_reservation_intent(id, sales_order_id, sales_order_item_id, product_id,
          warehouse_id, reservation_mode, intent_state, requested_qty, granted_qty, consumed_qty, released_qty,
          planning_reservation_id, inventory_lock_id, expected_supply_source_type, expected_supply_source_id,
          expected_supply_capacity, consumer_event, requested_at, granted_at, released_at, created_at, created_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          intentId, salesOrderId, salesOrderItemId, productId, warehouseId, mode, 'REQUESTED', quantity, 0, 0, 0,
          planningReservationId, inventoryLockId,
          expectedSupplySourceType,
          expectedSupplySourceId,
          null, null, stamp, null, null, stamp, actor.id,
        );
        audit(db, actor.id, 'REQUEST', 'SALES_RESERVATION_INTENT', intentId, `${salesOrderId} ${mode} ${quantity}`);
        result = summarizeIntent(db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId));
      });
      return send(res, 201, result);
    } catch (error) {
      if (!isReservationRediscoveryEligible(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new HttpError(503, '预留意图请求重试已耗尽', {
          code: 'SALES_RESERVATION_INTENT_RETRY_EXHAUSTED',
          retryable: true,
          attempts: attempt,
          causeCode: error?.details?.code || error?.code || null,
        });
      }
      if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
      waitForReservationRediscovery(attempt);
    }
  }
  throw new HttpError(503, '预留意图请求重试已耗尽', {
    code: 'SALES_RESERVATION_INTENT_RETRY_EXHAUSTED', retryable: true,
  });
}

export async function grantReservationIntent(db, req, res, actor, intentId) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const intent = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId);
  if (!intent) throw new HttpError(404, '预留意图不存在');
  if (!['REQUESTED', 'NONE'].includes(intent.intent_state)) throw new HttpError(409, `当前状态 ${intent.intent_state} 不可 GRANTS`);
  const order = loadOrder(db, intent.sales_order_id);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  const grantedQty = Number(body.grantedQty ?? body.granted_qty ?? intent.requested_qty);
  if (!isNonNegativeNumber(grantedQty)) throw new HttpError(400, 'grantedQty 必须是非负数');
  if (grantedQty > Number(intent.requested_qty) + 1e-9) throw new HttpError(409, 'grantedQty 超过 requested_qty');
  const stamp = now();
  transaction(db, () => {
    db.prepare(`UPDATE sales_reservation_intent
      SET intent_state='GRANTED', granted_qty=?, granted_at=?
      WHERE id=?`).run(grantedQty, stamp, intentId);
    audit(db, actor.id, 'GRANT', 'SALES_RESERVATION_INTENT', intentId, `grantedQty=${grantedQty}`);
  });
  return send(res, 200, summarizeIntent(db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId)));
}

export async function consumeReservationIntent(db, req, res, actor, intentId) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const intent = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId);
  if (!intent) throw new HttpError(404, '预留意图不存在');
  if (intent.intent_state !== 'GRANTED') throw new HttpError(409, `当前状态 ${intent.intent_state} 不可消费`);
  const consumeQty = Number(body.quantity ?? body.consumeQty ?? body.qty);
  if (!isPositiveNumber(consumeQty)) throw new HttpError(400, 'quantity 必须为正数');
  if (consumeQty > Number(intent.granted_qty) - Number(intent.consumed_qty) + 1e-9) {
    throw new HttpError(409, 'consume 超过可消费数量');
  }
  const order = loadOrder(db, intent.sales_order_id);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  const stamp = now();
  transaction(db, () => {
    const newConsumed = Number(intent.consumed_qty) + consumeQty;
    const newState = newConsumed >= Number(intent.granted_qty) - 1e-9 ? 'CONSUMED' : 'GRANTED';
    db.prepare(`UPDATE sales_reservation_intent
      SET consumed_qty=?, intent_state=?, consumer_event=?, released_at=?
      WHERE id=?`).run(newConsumed, newState, body.consumerEvent || body.consumer_event || 'DELIVERY_CONFIRMED', newState === 'CONSUMED' ? stamp : null, intentId);
    consumePlanningReservationAdapter(db, actor, intent.planning_reservation_id, consumeQty);
    audit(db, actor.id, 'CONSUME', 'SALES_RESERVATION_INTENT', intentId, `consumed=${consumeQty}`);
  });
  return send(res, 200, summarizeIntent(db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId)));
}

export async function releaseReservationIntent(db, req, res, actor, intentId) {
  allow(actor, 'SALES_MANAGE');
  const body = await readJson(req);
  const intent = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId);
  if (!intent) throw new HttpError(404, '预留意图不存在');
  if (intent.intent_state === 'RELEASED') throw new HttpError(409, '意图已释放');
  const order = loadOrder(db, intent.sales_order_id);
  requireSalesGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: body.businessDate || now().slice(0, 10) });
  const stamp = now();
  transaction(db, () => {
    if (intent.inventory_lock_id) releaseInventoryLockAdapter(db, actor, intent.inventory_lock_id);
    if (intent.planning_reservation_id) releasePlanningReservationAdapter(db, actor, intent.planning_reservation_id);
    db.prepare(`UPDATE sales_reservation_intent
      SET intent_state='RELEASED', released_qty=?, released_at=?, consumer_event=?
      WHERE id=?`).run(
      Number(intent.granted_qty) - Number(intent.consumed_qty),
      stamp,
      body.consumerEvent || body.consumer_event || 'MANUAL',
      intentId,
    );
    audit(db, actor.id, 'RELEASE', 'SALES_RESERVATION_INTENT', intentId, `${body.consumerEvent || 'MANUAL'}`);
  });
  return send(res, 200, summarizeIntent(db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId)));
}

// React-to-event helper: SO change. Adjust by releasing existing intent, then
// create a new REQUESTED intent for the delta. Used by SO change handlers.
export async function adjustReservationIntentOnChange(db, actor, { salesOrderId, salesOrderItemId, mode, newQty, consumerEvent = 'SO_CHANGED' }) {
  const existing = findActiveIntent(db, { salesOrderId, salesOrderItemId, mode });
  if (!existing) return null;
  const previous = summarizeIntent(existing);
  if (newQty == null) return previous;
  if (Math.abs(Number(newQty) - Number(existing.requested_qty)) < 1e-9) return previous;
  if (existing.intent_state !== 'REQUESTED' && existing.intent_state !== 'GRANTED') {
    return previous;
  }
  let result = previous;
  transaction(db, () => {
    if (existing.inventory_lock_id) releaseInventoryLockAdapter(db, actor, existing.inventory_lock_id);
    if (existing.planning_reservation_id) releasePlanningReservationAdapter(db, actor, existing.planning_reservation_id);
    db.prepare(`UPDATE sales_reservation_intent
      SET intent_state='RELEASED', released_qty=?, released_at=?, consumer_event=?
      WHERE id=?`).run(
      Number(existing.granted_qty) - Number(existing.consumed_qty),
      now(),
      consumerEvent,
      existing.id,
    );
    audit(db, actor.id, 'RELEASE_ON_CHANGE', 'SALES_RESERVATION_INTENT', existing.id, consumerEvent);
  });
  return result;
}

export async function releaseReservationIntentsForOrder(db, actor, { salesOrderId, consumerEvent }) {
  const rows = db.prepare(`SELECT * FROM sales_reservation_intent
    WHERE sales_order_id=? AND intent_state IN ('REQUESTED','GRANTED')`).all(salesOrderId);
  for (const row of rows) {
    transaction(db, () => {
      if (row.inventory_lock_id) releaseInventoryLockAdapter(db, actor, row.inventory_lock_id);
      if (row.planning_reservation_id) releasePlanningReservationAdapter(db, actor, row.planning_reservation_id);
      db.prepare(`UPDATE sales_reservation_intent
        SET intent_state='RELEASED', released_qty=?, released_at=?, consumer_event=?
        WHERE id=?`).run(
        Number(row.granted_qty) - Number(row.consumed_qty),
        now(),
        consumerEvent,
        row.id,
      );
      audit(db, actor.id, 'RELEASE_BULK', 'SALES_RESERVATION_INTENT', row.id, consumerEvent);
    });
  }
  return rows.length;
}

export function __salesReservationIntentInternals() {
  return {
    RESERVATION_MODES,
    INTENT_STATES,
    CONSUMER_EVENTS,
    isPositiveNumber,
    isNonNegativeNumber,
    loadOrder,
    loadOrderItem,
    requireSalesGroupScope,
    findActiveIntent,
    summarizeIntent,
    createInventoryLockAdapter,
    releaseInventoryLockAdapter,
    createPlanningReservationAdapter,
    releasePlanningReservationAdapter,
    consumePlanningReservationAdapter,
  };
}
