// Wave 6 — Sales Return / Replacement canonical writer per solution.md §29.13.11 / §30.30 / §30.31.
// Provides Option A confirm (SO_BACKED / NO_SOURCE), Option C reverse, Replacement lifecycle.
// ALL canonical writes pass through Inventory V21 / Finance V22 / Accounting canonical primitives.
// §30.31 LOT/SERIAL bounded superseding correction: Option C uses conservative no-subsequent-
// negative-movement fence for LOT, unique eligible outbound provenance for SERIAL; Option C
// requires explicit non-empty Idempotency-Key header (no random / body / server fallback).

import { randomUUID } from 'node:crypto';
import { HttpError, readJson, send, allow, allowAny } from '../lib/http.js';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { requestFingerprint, idempotencyReplay, saveIdempotency } from './financial-controls.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, reverseSystemVoucher, consumeOriginalInboundValue, inventoryAccountRole, receiveValue, allocateProportionalCents } from './financial-inventory.js';
import { applyCreditAdjustment, reverseCreditAdjustment, refreshOpenItem } from './settlement-core.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { postTrackedMovement, reverseTrackedSource } from './traceability-quality.js';

function safeInt(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.trunc(Number(value));
}

function nowIso() {
  return new Date().toISOString();
}

function dateOnly(input) {
  const value = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || new Date().toISOString().slice(0, 10);
  return value;
}

function number(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${stamp}-${suffix}`;
}

// §30.31.3 MOVING_AVERAGE_GUARD — strict negative-movement frontier. canonical 谓词:
// quantity_delta < 0 on the same (product, warehouse, lot NULL, serial NULL) pool, with
// strict temporal `created_at > m.created_at` and same-transaction exclusion.
function strictNegativePostCheck(db, original) {
  return db.prepare(`SELECT COALESCE(SUM(quantity_delta), 0) AS strict_negative_post
    FROM inventory_valuation_movements
    WHERE product_id = ? AND warehouse_id = ? AND lot_id IS NULL AND serial_id IS NULL
      AND quantity_delta < 0 AND status = 'POSTED'
      AND created_at > ? AND IFNULL(inventory_transaction_id, '00000000-0000-0000-0000-000000000000') <> ?`).get(
      original.product_id, original.warehouse_id, original.created_at, original.inventory_transaction_id || '00000000-0000-0000-0000-000000000000'
    ).strict_negative_post;
}

// §30.31.3 LOT_GUARD — conservative no-subsequent-negative-movement fence. Aggregate
// pool equality is FORBIDDEN. Sufficient current quantity/value is necessary but never
// sufficient. The frontier rejects every negative valuation movement with created_at
// >= original.created_at from another transaction; same-timestamp rows from another
// transaction are treated as ambiguous and reject (UUID/id ordering never used).
function lotGuard(db, original) {
  const balance = db.prepare(`SELECT * FROM inventory_valuation_balances WHERE warehouse_id=? AND product_id=? AND lot_id=?`).get(original.warehouse_id, original.product_id, original.lot_id);
  if (!balance) throw new HttpError(409, 'LOT 池不存在');
  if (balance.lot_id !== original.lot_id) throw new HttpError(409, 'LOT 身份不匹配');
  // Per R1: balance >= is necessary but never sufficient. Reject aggregate equality as authority.
  if (Number(balance.quantity) < Number(original.quantity_delta) - 1e-9) throw new HttpError(409, 'LOT 当前数量不足以精确反转');
  if (Number(balance.value_cents) < Number(original.value_delta_cents) - 1) throw new HttpError(409, 'LOT 当前价值不足以精确反转');
  // Conservative frontier: any POSTED negative valuation movement at the exact LOT identity
  // whose created_at >= original.created_at AND comes from another transaction blocks reverse.
  // Same-timestamp rows from another transaction are ambiguous and reject.
  // §30.31.7 — FOR UPDATE the frontier so MySQL InnoDB next-key locks the
  // (product_id, warehouse_id, lot_id, status, created_at, id) range via
  // idx_valuation_movements_identity_status_created; SQLite's BEGIN IMMEDIATE
  // already serializes the whole transaction.
  const frontier = db.prepare(`SELECT 1 FROM inventory_valuation_movements${db.dialect === 'mysql' ? ' FORCE INDEX (idx_valuation_movements_identity_status_created)' : ''}
    WHERE warehouse_id=? AND product_id=? AND lot_id=? AND quantity_delta < 0 AND status='POSTED'
      AND created_at >= ? AND IFNULL(inventory_transaction_id, '00000000-0000-0000-0000-000000000000') <> ?
    LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.warehouse_id, original.product_id, original.lot_id,
    original.created_at, original.inventory_transaction_id || '00000000-0000-0000-0000-000000000000'
  );
  if (frontier) throw new HttpError(409, 'LOT 同身份存在下游负 movement，无法精确反转');
  // §30.31.3 dependency proof — active exact-position inventory_locks block. Position_key
  // does not encode lot_id; check via product/warehouse (canonical lock truth).
  // §30.31.7 lock the range so a phantom insert cannot appear between proof and commit.
  const lock = db.prepare(`SELECT 1 FROM inventory_locks WHERE warehouse_id=? AND product_id=? AND status='ACTIVE' LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.warehouse_id, original.product_id
  );
  if (lock) throw new HttpError(409, 'LOT 同身份存在活动 inventory_locks，无法精确反转');
  // §30.31.3 reservation dependency: planning_reservations has no LOT dimension, so any
  // ACTIVE reservation for the product/warehouse cannot prove it excludes this LOT → block.
  const reservation = db.prepare(`SELECT 1 FROM planning_reservations
    WHERE product_id=? AND warehouse_id=? AND status='ACTIVE' LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.product_id, original.warehouse_id
  );
  if (reservation) throw new HttpError(409, 'LOT 同产品/仓库存在活动 reservation，无法精确反转');
  // Any later tracked_identity_hold_history action blocks (HOLD only allowed when unchanged Return-created).
  // §30.31.7 — FOR UPDATE locks the LOT identity range so a phantom HOLD insert cannot
  // appear between proof and commit. MySQL InnoDB next-key locks via the
  // tracked_identity_hold_history (identity_type, identity_id, created_at) index path.
  const hold = db.prepare(`SELECT 1 FROM tracked_identity_hold_history
    WHERE identity_type='LOT' AND identity_id=? AND created_at >= ? LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.lot_id, original.created_at
  );
  if (hold) throw new HttpError(409, 'LOT 在 Return 之后被加 HOLD，无法精确反转');
}

// §30.31.4 SERIAL_GUARD — unique eligible original outbound valuation evidence is the
// Confirm authority; current positive same-serial pool is NEVER authority. Reverse consumes
// only the restored unit identified by the bounded provenance row.
function serialGuard(db, original, provenanceRow) {
  if (!provenanceRow) throw new HttpError(409, 'SERIAL 缺少 §30.31.2 唯一确定的 provenance，无法精确反转');
  // The restored unit must still be the only active in-stock instance at the same warehouse/product.
  const serialRows = db.prepare(`SELECT id, lifecycle_state, current_warehouse_id FROM inventory_serials WHERE id=? AND product_id=?`).all(
    original.serial_id, original.product_id
  );
  if (serialRows.length !== 1) throw new HttpError(409, 'SERIAL 身份不存在或不唯一');
  const serial = serialRows[0];
  if (!['AVAILABLE', 'HOLD'].includes(serial.lifecycle_state)) throw new HttpError(409, 'SERIAL lifecycle 不在合法 IN-STOCK 状态');
  if (serial.current_warehouse_id !== original.warehouse_id) throw new HttpError(409, 'SERIAL 已不在 Return 仓库');
  // Provenance row's outbound identity must match the original.
  if (provenanceRow.serial_id !== original.serial_id) throw new HttpError(409, 'SERIAL provenance 身份不匹配');
  if (provenanceRow.product_id !== original.product_id || provenanceRow.warehouse_id !== original.warehouse_id) {
    throw new HttpError(409, 'SERIAL provenance product/warehouse 不匹配');
  }
  // Original outbound valuation movement must still be POSTED and not reversed.
  const outbound = db.prepare(`SELECT * FROM inventory_valuation_movements WHERE id=? AND status='POSTED'`).get(provenanceRow.original_outbound_valuation_movement_id);
  if (!outbound) throw new HttpError(409, 'SERIAL 原 outbound 估值事件不可用');
  if (db.prepare(`SELECT 1 FROM inventory_valuation_movements WHERE reversal_of_id=? AND status='POSTED' LIMIT 1`).get(outbound.id)) {
    throw new HttpError(409, 'SERIAL 原 outbound 已被反向');
  }
  // No duplicate restoration: cumulative active restoration for this outbound must be zero.
  // §30.31.7 SERIAL outbound range is FOR UPDATE-locked so concurrent Confirm of another
  // Return for the same outbound cannot phantom-insert between this read and the writer's
  // commit. SQLite's BEGIN IMMEDIATE serializes the whole transaction; MySQL InnoDB takes a
  // next-key lock on the indexed outbound identity, blocking competing INSERTs.
  const cumulativeRows = db.prepare(`SELECT 1 FROM sales_return_valuation_provenance
    WHERE original_outbound_valuation_movement_id=? AND id <> ?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).all(
      provenanceRow.original_outbound_valuation_movement_id, provenanceRow.id
    );
  if (cumulativeRows.length > 0) throw new HttpError(409, 'SERIAL 原 outbound 已被其他 Return 引用');
  // No later OUT/MOVE/transfer/hold-history/reservation/lock/reversal at the same identity after the provenance.
  // §30.31.7 — FOR UPDATE locks the serial identity range so a phantom post-OUT or
  // post-HOLD insert cannot appear between proof and commit.
  const postOut = db.prepare(`SELECT 1 FROM tracked_inventory_movements
    WHERE serial_id=? AND direction='OUT' AND created_at >= ? AND reversed=0 LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.serial_id, provenanceRow.created_at
  );
  if (postOut) throw new HttpError(409, 'SERIAL 在 provenance 之后存在下游 OUT/MOVE');
  const postHold = db.prepare(`SELECT 1 FROM tracked_identity_hold_history
    WHERE identity_type='SERIAL' AND identity_id=? AND created_at >= ? LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
    original.serial_id, provenanceRow.created_at
  );
  if (postHold) throw new HttpError(409, 'SERIAL 在 provenance 之后被加 HOLD');
  const lock = db.prepare(`SELECT 1 FROM inventory_locks WHERE product_id=? AND warehouse_id=? AND status='ACTIVE' LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(original.product_id, original.warehouse_id);
  if (lock) throw new HttpError(409, 'SERIAL 存在活动 inventory_locks');
}

function basisGuard(db, original, provenanceRow) {
  const basis = String(original.valuation_basis || '');
  if (basis === 'LEGACY_UNVALUED') throw new HttpError(409, 'LEGACY_UNVALUED 不可冲销');
  if (!original.lot_id && !original.serial_id) {
    const neg = Number(strictNegativePostCheck(db, original));
    if (neg < 0) throw new HttpError(409, 'MOVING_AVERAGE 已发生下游消耗，无法精确反转');
  } else if (original.lot_id) {
    lotGuard(db, original);
  } else if (original.serial_id) {
    serialGuard(db, original, provenanceRow);
  } else {
    throw new HttpError(409, '未知估值 basis');
  }
  if (db.prepare(`SELECT 1 FROM inventory_valuation_movements WHERE reversal_of_id=? AND status='POSTED'`).get(original.id)) {
    throw new HttpError(409, '原始估值已被反向');
  }
}

// §30.31.2 Eligible original outbound valuation evidence is deliberately narrow:
// status='POSTED', quantity_delta<0, value_delta_cents<0,
// source_type='SALES_DELIVERY', movement_type='SALES_DELIVERY_COGS',
// real inventory_transaction_id, exact product/warehouse and applicable LOT/SERIAL.
// SERIAL additionally requires exactly one matching unreversed tracked OUT row.
function resolveOriginalOutboundEvidence(db, item, allocation, candidateOutboundId) {
  const product = db.prepare(`SELECT tracking_policy FROM products WHERE id=?`).get(item.product_id);
  if (!product) throw new HttpError(409, '产品不存在');
  // Find eligible outbound valuation movements for this product/warehouse/identity.
  const candidates = db.prepare(`SELECT * FROM inventory_valuation_movements
    WHERE status='POSTED' AND quantity_delta < 0 AND value_delta_cents < 0
      AND source_type='SALES_DELIVERY' AND movement_type='SALES_DELIVERY_COGS'
      AND product_id=? AND warehouse_id=?
      AND COALESCE(lot_id,'')=COALESCE(?,'')
      AND COALESCE(serial_id,'')=COALESCE(?,'')
      AND inventory_transaction_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_valuation_movements r WHERE r.reversal_of_id=inventory_valuation_movements.id AND r.status='POSTED')
    ORDER BY created_at, id`).all(item.product_id, item.warehouse_id, allocation.lotId || '', allocation.serialId || '');
  // If client provided a candidate outbound id, narrow to that.
  let filtered = candidates;
  if (candidateOutboundId) {
    filtered = candidates.filter((c) => c.id === candidateOutboundId);
    if (!filtered.length) throw new HttpError(409, '候选原 outbound 估值事件不存在或不满足 §30.31.2 资格');
  }
  // LOT: client must supply a candidate when multiple exist; auto-resolve only when exactly one.
  if (!filtered.length) return null;
  if (filtered.length > 1 && !candidateOutboundId) {
    if (product.tracking_policy === 'SERIAL') {
      throw new HttpError(409, 'SERIAL 存在多个 eligible outbound，必须显式提供候选');
    }
    return null; // MA/LOT can rely on existing positive pool (legacy path)
  }
  return filtered[0];
}

// §30.31.2 Freeze the bounded provenance row. Insert-only, no UPDATE/DELETE.
function freezeProvenance(db, { returnOrderId, returnOrderItemId, returnValuationMovementId, originalOutbound, allocation }) {
  // §30.31.4 / §30.31.7 SERIAL outbound range must be locked before INSERT. Without this,
  // two concurrent Confirm transactions on the same outbound would each pass the
  // application-level candidate filter (because no prior provenance row exists yet) and
  // each freezeProvenance would succeed (UNIQUE(return_valuation_movement_id) only protects
  // the same Return valuation movement). MySQL InnoDB next-key locks on the indexed
  // outbound identity block competing INSERTs; SQLite's BEGIN IMMEDIATE serializes the
  // transaction. LOT/MA partial allocations remain free to share an outbound because the
  // check is intentionally scoped to serial_id IS NOT NULL.
  if (allocation.serialId) {
    const serialOutboundExists = db.prepare(`SELECT 1 FROM sales_return_valuation_provenance
      WHERE original_outbound_valuation_movement_id=? AND serial_id IS NOT NULL LIMIT 1${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(
        originalOutbound.id
      );
    if (serialOutboundExists) throw new HttpError(409, 'SERIAL 原 outbound 已被其他 Return 引用');
  }
  const provenanceId = randomUUID();
  // value_cents must be positive safe integer cents — the absolute outbound value is the
  // original outbound valuation, which IS the canonical source of value for this Return.
  const positiveValueCents = Math.abs(Number(originalOutbound.value_delta_cents));
  if (!Number.isSafeInteger(positiveValueCents) || positiveValueCents <= 0) {
    throw new HttpError(409, '原 outbound 价值非正整数分，无法 freeze provenance');
  }
  // Resolve the paired tracked_inventory_movements row for the original outbound.
  // LOT: nullable per §30.31.2; SERIAL: mandatory — exactly one matching tracked OUT row.
  let trackedMovementId = null;
  if (allocation.serialId) {
    const tracked = db.prepare(`SELECT id FROM tracked_inventory_movements
      WHERE source_type='SALES_DELIVERY' AND source_id=? AND product_id=? AND warehouse_id=?
        AND serial_id=? AND direction='OUT' AND reversed=0`).get(
      originalOutbound.source_id, allocation.productId, allocation.warehouseId, allocation.serialId
    );
    if (!tracked) throw new HttpError(409, 'SERIAL 缺少 paired tracked_inventory_movements 行');
    trackedMovementId = tracked.id;
  } else if (allocation.lotId) {
    const tracked = db.prepare(`SELECT id FROM tracked_inventory_movements
      WHERE source_type='SALES_DELIVERY' AND source_id=? AND product_id=? AND warehouse_id=?
        AND lot_id=? AND direction='OUT' AND reversed=0 LIMIT 1`).get(
      originalOutbound.source_id, allocation.productId, allocation.warehouseId, allocation.lotId
    );
    trackedMovementId = tracked ? tracked.id : null;
  }
  db.prepare(`INSERT INTO sales_return_valuation_provenance(
      id, return_order_id, return_order_item_id, return_valuation_movement_id,
      original_outbound_valuation_movement_id, original_outbound_tracking_movement_id,
      product_id, warehouse_id, lot_id, serial_id, quantity, value_cents, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    provenanceId, returnOrderId, returnOrderItemId, returnValuationMovementId,
    originalOutbound.id, trackedMovementId,
    allocation.productId, allocation.warehouseId,
    allocation.lotId || null, allocation.serialId || null,
    allocation.quantity, positiveValueCents, nowIso()
  );
  return provenanceId;
}

function resolveOptionALinePlan(db, header, item, serialIds, candidateOutboundIds = {}) {
  const product = db.prepare(`SELECT tracking_policy,valuation_method,valuation_activated_at FROM products WHERE id=? AND active=1`).get(item.product_id);
  if (!product) throw new HttpError(409, 'Wave6 Option A: product unavailable');
  const policy = String(product.tracking_policy || 'NONE').toUpperCase();
  const expectedMethod = { NONE: 'MOVING_AVERAGE', LOT: 'LOT_SPECIFIC_POOL', SERIAL: 'SPECIFIC_SERIAL' }[policy];
  if (!expectedMethod || product.valuation_method !== expectedMethod) throw new HttpError(409, 'Wave6 Option A: tracking and valuation method mismatch');
  if (!product.valuation_activated_at) throw new HttpError(409, 'Wave6 Option A Gate: valuation is not activated');
  const tracked = db.prepare(`SELECT * FROM tracked_source_allocations
    WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=? AND posted=0 AND reversed=0
    ORDER BY created_at,id`).all(header.id, item.id);
  let allocations;
  if (policy === 'NONE') {
    if (tracked.length) throw new HttpError(409, 'Wave6 Option A: untracked product cannot carry LOT/SERIAL allocations');
    allocations = [{ quantity: Number(item.quantity), lotId: null, serialId: null, productId: item.product_id, warehouseId: header.warehouse_id }];
  } else {
    if (!tracked.length) throw new HttpError(409, `Wave6 Option A: ${policy} allocation is required`);
    const total = tracked.reduce((sum, row) => sum + Number(row.quantity), 0);
    if (Math.abs(total - Number(item.quantity)) > 1e-9) throw new HttpError(409, 'Wave6 Option A: tracking allocation quantity mismatch');
    allocations = tracked.map((row) => {
      if (policy === 'LOT') {
        const lot = db.prepare('SELECT id,product_id FROM inventory_lots WHERE id=?').get(row.lot_id);
        if (!lot || lot.product_id !== item.product_id) throw new HttpError(409, 'Wave6 Option A: LOT identity mismatch');
        return { quantity: Number(row.quantity), lotId: lot.id, serialId: null, productId: item.product_id, warehouseId: header.warehouse_id };
      }
      const serial = db.prepare('SELECT id,product_id,lifecycle_state,current_warehouse_id FROM inventory_serials WHERE id=?').get(row.serial_id);
      if (!serial || serial.product_id !== item.product_id || !['DELIVERED','CONSUMED'].includes(serial.lifecycle_state)) {
        throw new HttpError(409, 'Wave6 Option A: SERIAL identity is not returnable');
      }
      // §30.31.4 Confirm precheck: lifecycle DELIVERED implies current_warehouse_id IS NULL.
      // Any non-null current_warehouse_id indicates an in-stock duplicate and must fail closed.
      if (serial.current_warehouse_id) throw new HttpError(409, 'Wave6 Option A: SERIAL still shows an active in-stock warehouse');
      if (Number(row.quantity) !== 1 || serialIds.has(serial.id)) throw new HttpError(409, 'Wave6 Option A: SERIAL allocation must be unique and quantity 1');
      serialIds.add(serial.id);
      return { quantity: 1, lotId: null, serialId: serial.id, productId: item.product_id, warehouseId: header.warehouse_id };
    });
  }
  return allocations.map((allocation) => {
    const key = expectedMethod === 'LOT_SPECIFIC_POOL'
      ? `LOT:${header.warehouse_id}:${item.product_id}:${allocation.lotId}`
      : expectedMethod === 'SPECIFIC_SERIAL'
        ? `SERIAL:${allocation.serialId}`
        : `NONE:${header.warehouse_id}:${item.product_id}`;
    const pool = db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?').get(key);
    if (allocation.serialId) {
      // §30.31.4 item 1: pre-Confirm SPECIFIC_SERIAL pool MUST be zero/absent.
      // §30.31.4 item 4: value comes from outbound, NOT from the pool.
      // Existing positive pool is a stale authoritative contradiction and must fail closed.
      if (pool && (Number(pool.quantity) > 0 || Number(pool.value_cents) > 0)) {
        throw new HttpError(409, 'Wave6 Option A Gate: SERIAL 同一身份已存在正数估值池，禁止重复入库');
      }
      // Resolve authoritative original outbound evidence and use its value verbatim.
      const originalOutbound = resolveOriginalOutboundEvidence(
        db, { ...item, warehouse_id: header.warehouse_id }, allocation,
        (allocation.serialId && candidateOutboundIds[allocation.serialId]) || null,
      );
      if (!originalOutbound) throw new HttpError(409, 'Wave6 Option A: SERIAL 缺少唯一确定的 eligible outbound provenance');
      if (Math.abs(Number(originalOutbound.quantity_delta) + 1) > 1e-9) {
        throw new HttpError(409, 'Wave6 Option A: SERIAL 原 outbound 数量必须为 -1');
      }
      const valueCents = Math.abs(Number(originalOutbound.value_delta_cents));
      if (!Number.isSafeInteger(valueCents) || valueCents <= 0) {
        throw new HttpError(409, 'Wave6 Option A: SERIAL 原 outbound 价值非正整数分');
      }
      return {
        ...allocation,
        valueCents,
        valuationBasis: 'SERIAL_ORIGINAL_COST',
        originalOutbound,
      };
    }
    // MA / LOT — existing positive-pool authority.
    if (!pool || pool.valuation_method !== expectedMethod || pool.product_id !== item.product_id || pool.warehouse_id !== header.warehouse_id
      || Number(pool.quantity) <= 0 || Number(pool.value_cents) <= 0 || Number(allocation.quantity) > Number(pool.quantity) + 1e-9
      || (allocation.lotId && pool.lot_id !== allocation.lotId)) {
      throw new HttpError(409, 'Wave6 Option A Gate: no legal positive valuation pool for exact identity');
    }
    const valueCents = Math.abs(Number(pool.quantity) - Number(allocation.quantity)) <= 1e-9
      ? Number(pool.value_cents)
      : allocateProportionalCents(Number(pool.value_cents), Number(allocation.quantity), Number(pool.quantity));
    if (!Number.isSafeInteger(valueCents) || valueCents <= 0) throw new HttpError(409, 'Wave6 Option A Gate: allocated value must be positive safe integer cents');
    return {
      ...allocation,
      valueCents,
      valuationBasis: expectedMethod === 'LOT_SPECIFIC_POOL' ? 'LOT_CARRYING' : 'MOVING_AVERAGE',
    };
  });
}

// ----------------------------- Option A Confirm -----------------------------

export async function confirmOptionAReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotencyKey || `document-${returnId}`);
  const fingerprint = requestFingerprint({ action: 'confirm' });
  const replay = idempotencyReplay(db, 'SALES_RETURN_CONFIRM_OPTION_A', returnId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });

  transaction(db, () => {
    const header = db.prepare(`SELECT * FROM return_orders WHERE id=?`).get(returnId);
    if (!header) throw new HttpError(404, '销售退货单不存在');
    if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿可确认');
    const marker = header.commercial_source_marker || '';
    if (marker !== 'SO_BACKED' && marker !== 'NO_SOURCE') {
      throw new HttpError(409, '该 marker 必走 DELIVERY_BACKED 路径');
    }
    assertFinancialPeriodsOpen(db, header.return_date);

    const items = db.prepare(`SELECT * FROM return_order_items WHERE return_id=? ORDER BY id`).all(returnId);
    if (!items.length) throw new HttpError(409, '退货单无明细');

    if (marker === 'SO_BACKED') {
      for (const item of items) {
        if (!item.sales_order_item_id) throw new HttpError(409, 'SO_BACKED 必须提供 sales_order_item_id');
        const soi = db.prepare(`SELECT soi.id, soi.product_id, soi.quantity, soi.unit_price_cents, so.customer_id, so.status FROM sales_order_items soi JOIN sales_orders so ON so.id=soi.order_id WHERE soi.id=?`).get(item.sales_order_item_id);
        if (!soi) throw new HttpError(409, 'SO 行不存在');
        if (soi.product_id !== item.product_id) throw new HttpError(409, 'product 不匹配');
        if (soi.customer_id !== header.customer_id) throw new HttpError(409, 'customer 不匹配');
        if (soi.status !== 'APPROVED') throw new HttpError(409, 'SO 未审批');
        const executed = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM sales_delivery_items WHERE sales_order_item_id=?`).get(item.sales_order_item_id).n);
        const confirmed = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM return_order_items WHERE sales_order_item_id=? AND return_id<>?`).get(item.sales_order_item_id, returnId).n);
        const available = Number(soi.quantity) - executed - confirmed;
        if (Number(item.quantity) > available + 1e-9) throw new HttpError(409, 'SO 行容量不足');
      }
    } else {
      for (const item of items) {
        if (item.sales_order_item_id || item.delivery_item_id) throw new HttpError(409, 'NO_SOURCE 必须不含 SO/Delivery 来源');
      }
    }

    const serialIds = new Set();
    const plans = items.map((item) => ({ item, allocations: resolveOptionALinePlan(db, header, item, serialIds) }));

    for (const { item, allocations } of plans) {
      if (allocations.some((allocation) => allocation.lotId || allocation.serialId)) {
        postTrackedMovement(db, {
          sourceType: 'SALES_RETURN', sourceId: returnId, sourceItemId: item.id,
          productId: item.product_id, warehouseId: header.warehouse_id,
          quantity: Number(item.quantity), direction: 'IN', businessDate: header.return_date,
          returnToHold: true,
        });
      }
      for (const [allocationIndex, allocation] of allocations.entries()) {
      const physical = applyInventoryMutation({
        db,
        sourceType: 'SALES_RETURN',
        sourceId: returnId,
        sourceItemId: item.id,
        sourceNo: header.return_no,
        businessDate: header.return_date,
        actor: { id: actor.id },
        movementKind: 'IN',
        quantity: allocation.quantity,
        toPosition: {
          productId: item.product_id,
          warehouseId: header.warehouse_id,
          ownerType: 'ENTERPRISE',
          ownerId: null,
          stockStatus: 'AVAILABLE',
          binId: null,
          lotId: allocation.lotId,
          serialId: allocation.serialId,
        },
        idempotencyKey: `SALES_RETURN:${returnId}:${item.id}:${allocationIndex}`,
        valuationMode: 'EXTERNAL',
        trackingMode: 'EXTERNAL',
        remark: `销售退货 ${header.return_no}`,
      });
      const txId = physical.movements?.find((movement) => movement.direction === 'IN')?.transactionId;
      if (!txId) throw new HttpError(409, '销售退货库存入库流水创建失败');
      const movementResult = receiveValue(db, {
        businessDate: header.return_date,
        productId: item.product_id,
        warehouseId: header.warehouse_id,
        lotId: allocation.lotId,
        serialId: allocation.serialId,
        quantity: allocation.quantity,
        valueCents: allocation.valueCents,
        valuationBasis: allocation.valuationBasis,
        movementType: 'SALES_RETURN',
        sourceType: 'SALES_RETURN',
        sourceId: returnId,
        sourceItemId: item.id,
        inventoryTransactionId: txId,
      });
      // §30.31.2 SERIAL: freeze one immutable provenance row per allocation pointing to
      // the unique eligible original outbound SALES_DELIVERY_COGS valuation movement.
      // For SERIAL the authoritative originalOutbound was already resolved and cached
      // on the allocation by resolveOptionALinePlan; freezeProvenance re-validates and
      // inserts the provenance row.
      if (allocation.serialId) {
        freezeProvenance(db, {
          returnOrderId: returnId,
          returnOrderItemId: item.id,
          returnValuationMovementId: movementResult.id,
          originalOutbound: allocation.originalOutbound,
          allocation,
        });
      }
      }
    }

    const entries = [];
    let credit = 0;
    for (const item of items) {
      const alloc = db.prepare(`SELECT COALESCE(SUM(value_delta_cents),0) AS v FROM inventory_valuation_movements WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=?`).get(returnId, item.id);
      const value = Number(alloc.v);
      if (!Number.isFinite(value) || value <= 0) throw new HttpError(409, '估值金额无效');
      const role = inventoryAccountRole(db, item.product_id);
      entries.push({ role, direction: 'DEBIT', amountCents: value });
      credit += value;
    }
    entries.push({ role: 'INVENTORY_GAIN_LOSS', direction: 'CREDIT', amountCents: credit });
    const voucherId = createSystemVoucher(db, {
      sourceType: 'SALES_RETURN',
      sourceId: returnId,
      businessDate: header.return_date,
      actorId: actor.id,
      remark: `Sales Return confirm ${header.return_no} (${marker})`,
      entries,
    });

    db.prepare(`UPDATE return_orders SET status='CONFIRMED', confirmed_by=?, confirmed_at=? WHERE id=?`).run(actor.id, nowIso(), returnId);
    audit(db, actor.id, 'CONFIRM', 'SALES_RETURN', returnId, `确认销售退货 ${header.return_no} ${marker}`);
    saveIdempotency(db, 'SALES_RETURN_CONFIRM_OPTION_A', returnId, idempotencyKey, fingerprint, { id: returnId, status: 'CONFIRMED', voucherId, mode: marker });
  });

  return send(res, 201, { id: returnId, status: 'CONFIRMED', mode: 'OPTION_A' });
}

// ----------------------------- Option C Reverse -----------------------------

export async function reverseOptionCReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, '请填写冲销原因');
  const businessDate = dateOnly(body.businessDate);
  // §30.31.6 / Option C Idempotency-Key addendum: explicit non-empty header required.
  // No body / random / server fallback. Missing → HTTP 400 before any business mutation.
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) {
    throw new HttpError(400, 'Option C 冲销要求显式 Idempotency-Key header');
  }
  const fingerprint = requestFingerprint({ reason, businessDate });
  const replay = idempotencyReplay(db, 'SALES_RETURN_REVERSAL_OPTION_C', returnId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });

  let response = null;
  transaction(db, () => {
    const header = db.prepare(`SELECT * FROM return_orders WHERE id=?`).get(returnId);
    if (!header) throw new HttpError(404, '退货单不存在');
    if (header.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认退货单可冲销');
    const marker = header.commercial_source_marker || '';
    if (marker !== 'SO_BACKED' && marker !== 'NO_SOURCE') {
      throw new HttpError(409, '该 marker 不允许 Option C 冲销');
    }
    assertFinancialPeriodsOpen(db, businessDate);

    const fulfillmentRows = db.prepare(`
      SELECT rf.id FROM sales_replacement_fulfillments rf
      JOIN sales_order_replacement_lines rl ON rl.id = rf.replacement_line_id
      WHERE rl.source_return_item_id IN (SELECT id FROM return_order_items WHERE return_id=?)
    `).all(returnId);
    if (fulfillmentRows.length) throw new HttpError(409, 'Gate-A.3 已确认 Replacement Fulfillment 存在，禁止冲销');

    const replacementRows = db.prepare(`
      SELECT rl.id, rl.replacement_quantity, sr.cancellation_state
      FROM sales_order_replacement_lines rl
      JOIN sales_order_replacements sr ON sr.id = rl.replacement_id
      WHERE rl.source_return_item_id IN (SELECT id FROM return_order_items WHERE return_id=?)
    `).all(returnId);
    for (const row of replacementRows) {
      if (row.cancellation_state === 'ACTIVE') throw new HttpError(409, 'Gate-A.2 存在 ACTIVE 未履行 Replacement');
    }

    const items = db.prepare(`SELECT * FROM return_order_items WHERE return_id=? ORDER BY id`).all(returnId);
    const reversalId = randomUUID();
    const reversalNo = number('SRR-OC');
    const at = nowIso();

    const reversalPlans = items.map((item) => {
      const originals = db.prepare(`SELECT * FROM inventory_valuation_movements WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=? AND quantity_delta > 0 AND status='POSTED' ORDER BY created_at, id`).all(returnId, item.id);
      if (!originals.length) throw new HttpError(409, 'Gate-B 原入库缺少权威估值事件');
      for (const m of originals) {
        // §30.31.2 SERIAL: pass provenance row from same allocation; LOT uses conservative fence.
        const provenanceRow = m.serial_id
          ? db.prepare(`SELECT * FROM sales_return_valuation_provenance WHERE return_order_item_id=? AND return_valuation_movement_id=?`).get(item.id, m.id)
          : null;
        basisGuard(db, m, provenanceRow);
      }
      const total = originals.reduce((sum, movement) => sum + Number(movement.quantity_delta), 0);
      if (Math.abs(total - Number(item.quantity)) > 1e-9) throw new HttpError(409, 'Gate-B original valuation quantity mismatch');
      return { item, originals };
    });

    reverseTrackedSource(db, {
      originalSourceType: 'SALES_RETURN', originalSourceId: returnId,
      reversalSourceType: 'SALES_RETURN_REVERSAL', reversalSourceId: reversalId, businessDate,
    });

    for (const { item, originals } of reversalPlans) {
      for (const [movementIndex, original] of originals.entries()) {

      const physical = applyInventoryMutation({
        db,
        sourceType: 'SALES_RETURN_REVERSAL',
        sourceId: reversalId,
        sourceItemId: item.id,
        sourceNo: reversalNo,
        businessDate,
        actor: { id: actor.id },
        movementKind: 'OUT',
        quantity: Number(original.quantity_delta),
        fromPosition: {
          productId: item.product_id,
          warehouseId: header.warehouse_id,
          ownerType: 'ENTERPRISE',
          ownerId: null,
          stockStatus: 'AVAILABLE',
          binId: null,
          lotId: original.lot_id,
          serialId: original.serial_id,
        },
        idempotencyKey: `SALES_RETURN_REVERSAL:${reversalId}:${item.id}:${movementIndex}`,
        valuationMode: 'EXTERNAL',
        trackingMode: 'EXTERNAL',
        remark: `销售退货冲销 ${reversalNo}`,
      });

      const txId = physical.movements?.find((movement) => movement.direction === 'OUT')?.transactionId;
      if (!txId) throw new HttpError(409, 'Gate-C inventory reversal transaction missing');
      const result = consumeOriginalInboundValue(db, {
        businessDate,
        productId: item.product_id,
        warehouseId: header.warehouse_id,
        lotId: original.lot_id,
        serialId: original.serial_id,
        quantity: Number(original.quantity_delta),
        originalSourceType: 'SALES_RETURN',
        originalSourceId: returnId,
        originalSourceItemId: item.id,
        sourceType: 'SALES_RETURN_REVERSAL',
        sourceId: reversalId,
        sourceItemId: item.id,
        movementType: 'INVENTORY_VALUATION_REVERSAL',
        inventoryTransactionId: txId,
        createdAt: at,
      });
      if (!result || !result.length) throw new HttpError(409, 'Gate-C 反向估值失败');
    }

    }

    const originalVoucher = db.prepare(`SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type='SALES_RETURN' AND source_id=? AND status='POSTED'`).get(returnId);
    if (!originalVoucher) throw new HttpError(409, 'Gate-D 缺少原始凭证');
    reverseSystemVoucher(db, {
      originalSourceType: 'SALES_RETURN',
      originalSourceId: returnId,
      reversalSourceType: 'SALES_RETURN_REVERSAL',
      reversalSourceId: reversalId,
      businessDate,
      actorId: actor.id,
      reason,
      transactionIdByOriginal: new Map(),
    });

    const credit = db.prepare(`SELECT * FROM financial_credit_adjustments WHERE source_type='SALES_RETURN' AND source_id=? AND status='CONFIRMED'`).get(returnId);
    if (credit) {
      const balance = db.prepare(`SELECT id FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id=?`).get(credit.id);
      if (balance) {
        const consumed = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'`).get(balance.id).n)
          + Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'`).get(balance.id).n);
        if (consumed > 0) throw new HttpError(409, 'Gate-E Credit 已被消费');
      }
      reverseCreditAdjustment(db, 'AR', 'SALES_RETURN', returnId, actor.id, businessDate, reason);
    }

    // Commercial Return Amount (audit mirror) = sum(quantity * item.unit_price_cents).
    //   - SO_BACKED: sales_order_items.unit_price_cents (canonical commercial sales-side).
    //   - NO_SOURCE: 0 (canonical "no commercial amount" per DR-SAL-04 + §29.13.5/§30.29).
    // NEVER derived from inventory valuation, inventory carrying value, standard cost,
    // moving average, SO price without valid SO source, or any other back-fill.
    let commercialTotal = 0;
    for (const item of items) {
      const commercialUnitPrice = Number(item.unit_price_cents || 0);
      if (marker === 'NO_SOURCE' && commercialUnitPrice !== 0) {
        throw new HttpError(409, 'Commercial independence: NO_SOURCE 不允许 unit_price_cents != 0 (防混淆库存估值或标准成本到商业字段)');
      }
      commercialTotal += Math.round(Number(item.quantity) * commercialUnitPrice);
    }
    // Inventory Valuation Reverse Amount (separate from commercial, used by voucher reverse):
    const inventoryValuationReverseTotal = Number(db.prepare(`
      SELECT COALESCE(SUM(-value_delta_cents), 0) AS s
      FROM inventory_valuation_movements
      WHERE reversal_of_id IN (SELECT id FROM inventory_valuation_movements WHERE source_type='SALES_RETURN' AND source_id=? AND quantity_delta > 0)
        AND status='POSTED'
    `).get(returnId).s);

    db.prepare(`INSERT INTO return_reversals(id, reversal_no, side, return_id, amount_cents, business_date, reason, status, creator_id, created_at) VALUES(?,?,?,?,?,?,?, 'CONFIRMED', ?, ?)`).run(
      reversalId, reversalNo, 'SALES', returnId, commercialTotal, businessDate, reason, actor.id, at
    );
    for (const item of items) {
      const commercialUnitPrice = Number(item.unit_price_cents || 0);
      const itemAmount = Math.round(Number(item.quantity) * commercialUnitPrice);
      db.prepare(`INSERT INTO return_reversal_items(id, reversal_id, original_return_item_id, quantity, amount_cents) VALUES(?,?,?,?,?)`).run(
        randomUUID(), reversalId, item.id, Number(item.quantity), itemAmount
      );
    }
    if (credit) {
      // Credit reverse amount is independent; uses Finance canonical reversal (already applied above via reverseCreditAdjustment).
      // credit_reversal_components records the canonical distributed amount derived from real Credit balance.
      db.prepare(`INSERT INTO credit_reversal_components(id, credit_id, return_reversal_id, applied_cents, unapplied_cents) VALUES(?,?,?,?,?)`).run(
        randomUUID(), credit.id, reversalId, Math.max(0, commercialTotal), 0
      );
    }

    audit(db, actor.id, 'REVERSE', 'SALES_RETURN', returnId, `${reversalNo} ${reason} ${marker} commercial=${commercialTotal}c valuation=${inventoryValuationReverseTotal}c`);
    saveIdempotency(db, 'SALES_RETURN_REVERSAL_OPTION_C', returnId, idempotencyKey, fingerprint, {
      id: reversalId, reversalNo, status: 'CONFIRMED', amountCents: commercialTotal, inventoryValuationReverseTotal, mode: marker,
    });
    response = { id: reversalId, reversalNo, status: 'CONFIRMED', amountCents: commercialTotal, mode: 'OPTION_C' };
  });

  return send(res, 201, response);
}

// ----------------------------- Replacement Lifecycle -----------------------------

function deriveFulfillmentState(db, replacementId) {
  const header = db.prepare(`SELECT cancellation_state FROM sales_order_replacements WHERE id=?`).get(replacementId);
  if (!header) return 'UNKNOWN';
  if (header.cancellation_state === 'CANCELLED') return 'CANCELLED';
  const total = Number(db.prepare(`SELECT COALESCE(SUM(replacement_quantity),0) AS q FROM sales_order_replacement_lines WHERE replacement_id=?`).get(replacementId).q);
  if (total <= 0) return 'CANCELLED';
  const fulfilled = Number(db.prepare(`SELECT COALESCE(SUM(rf.fulfilled_qty), 0) AS q FROM sales_replacement_fulfillments rf JOIN sales_order_replacement_lines rl ON rl.id=rf.replacement_line_id WHERE rl.replacement_id=? AND EXISTS (SELECT 1 FROM sales_delivery_items sdi WHERE sdi.id=rf.sales_delivery_item_id)`).get(replacementId).q);
  if (fulfilled <= 0) return 'OPEN';
  if (fulfilled + 1e-9 >= total) return 'FULFILLED';
  return 'PARTIAL';
}

export function listSalesReplacements(db, res, actor, url) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const rows = db.prepare(`SELECT r.*, ro.return_no AS source_return_no, ro.customer_id, c.code AS customer_code, c.name AS customer_name
    FROM sales_order_replacements r
    JOIN return_orders ro ON ro.id=r.source_return_id
    JOIN customers c ON c.id=ro.customer_id
    ORDER BY r.created_at DESC, r.id`).all();
  const enriched = rows.map((row) => projectReplacement(db, row));
  return send(res, 200, { replacements: enriched });
}

function projectReplacement(db, row) {
    const totalLines = Number(db.prepare(`SELECT COALESCE(SUM(replacement_quantity),0) AS q FROM sales_order_replacement_lines WHERE replacement_id=?`).get(row.id).q);
    const totalFulfilled = Number(db.prepare(`SELECT COALESCE(SUM(rf.fulfilled_qty), 0) AS q FROM sales_replacement_fulfillments rf JOIN sales_order_replacement_lines rl ON rl.id=rf.replacement_line_id WHERE rl.replacement_id=? AND EXISTS (SELECT 1 FROM sales_delivery_items sdi WHERE sdi.id=rf.sales_delivery_item_id)`).get(row.id).q);
    const lines = db.prepare(`SELECT rl.*, p.code AS product_code, p.name AS product_name,
      COALESCE((SELECT SUM(rf.fulfilled_qty) FROM sales_replacement_fulfillments rf WHERE rf.replacement_line_id=rl.id),0) AS fulfilled_quantity
      FROM sales_order_replacement_lines rl JOIN products p ON p.id=rl.replacement_material_id
      WHERE rl.replacement_id=? ORDER BY rl.line_no,rl.id`).all(row.id).map((line) => ({
        ...line,
        remainingQuantity: Math.max(0, Number(line.replacement_quantity) - Number(line.fulfilled_quantity)),
        fulfillments: db.prepare(`SELECT rf.*,sd.delivery_no FROM sales_replacement_fulfillments rf
          JOIN sales_deliveries sd ON sd.id=rf.sales_delivery_id WHERE rf.replacement_line_id=? ORDER BY rf.created_at,rf.id`).all(line.id),
      }));
    return {
      ...row,
      replacementQuantity: totalLines,
      fulfilledQuantity: totalFulfilled,
      remainingQuantity: Math.max(0, totalLines - totalFulfilled),
      fulfillmentState: deriveFulfillmentState(db, row.id),
      lines,
    };
}

export function getSalesReplacement(db, res, actor, replacementId) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const row = db.prepare(`SELECT r.*, ro.return_no AS source_return_no, ro.customer_id, c.code AS customer_code, c.name AS customer_name
    FROM sales_order_replacements r
    JOIN return_orders ro ON ro.id=r.source_return_id
    JOIN customers c ON c.id=ro.customer_id WHERE r.id=?`).get(replacementId);
  if (!row) throw new HttpError(404, '补货义务不存在');
  return send(res, 200, { replacement: projectReplacement(db, row) });
}

export async function createSalesOrderReplacement(db, req, res, actor) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  const sourceReturnId = String(body.sourceReturnId || '');
  const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotencyKey || `replace-${sourceReturnId}-${randomUUID()}`);
  const fingerprint = requestFingerprint({ sourceReturnId, lines: (body.lines || []).map((l) => ({ returnItemId: l.returnItemId, qty: l.qty, materialId: l.materialId })) });
  const replay = idempotencyReplay(db, 'SALES_ORDER_REPLACEMENT_CREATE', sourceReturnId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });

  const replacementId = randomUUID();
  const replacementNo = number('SOR');
  const at = nowIso();
  transaction(db, () => {
    const header = db.prepare(`SELECT * FROM return_orders WHERE id=?`).get(sourceReturnId);
    if (!header) throw new HttpError(404, '来源退货单不存在');
    if (header.status !== 'CONFIRMED') throw new HttpError(409, '来源退货必须 CONFIRMED');
    const lines = (body.lines || []).map((line) => {
      const ri = db.prepare(`SELECT * FROM return_order_items WHERE id=? AND return_id=?`).get(line.returnItemId, sourceReturnId);
      if (!ri) throw new HttpError(404, '来源退货明细不存在');
      const totalReplaced = Number(db.prepare(`SELECT COALESCE(SUM(rl.replacement_quantity),0) AS q FROM sales_order_replacement_lines rl WHERE rl.source_return_item_id=? AND EXISTS (SELECT 1 FROM sales_order_replacements sr WHERE sr.id=rl.replacement_id AND sr.cancellation_state='ACTIVE')`).get(line.returnItemId).q);
      const fulfilledAvailable = Math.max(0, Number(ri.quantity) - totalReplaced);
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'replacement qty 必须大于 0');
      if (qty > fulfilledAvailable + 1e-9) throw new HttpError(409, 'replacement qty 超过剩余可补货量');
      return { ri, qty, materialId: String(line.materialId), uomCode: String(line.uomCode || 'EA') };
    });
    if (!lines.length) throw new HttpError(400, '至少一条补货明细');
    db.prepare(`INSERT INTO sales_order_replacements(id, replacement_no, source_return_id, cancellation_state, created_at, creator_id) VALUES(?,?,?,?,?,?)`).run(
      replacementId, replacementNo, sourceReturnId, 'ACTIVE', at, actor.id
    );
    let lineNo = 1;
    for (const line of lines) {
      db.prepare(`INSERT INTO sales_order_replacement_lines(id, replacement_id, line_no, source_return_item_id, replacement_material_id, replacement_quantity, replacement_uom_code, business_date, created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), replacementId, lineNo++, line.ri.id, line.materialId, line.qty, line.uomCode, header.return_date, at
      );
    }
    audit(db, actor.id, 'CREATE', 'SALES_ORDER_REPLACEMENT', replacementId, `创建补货义务 ${replacementNo}`);
    saveIdempotency(db, 'SALES_ORDER_REPLACEMENT_CREATE', sourceReturnId, idempotencyKey, fingerprint, { id: replacementId, replacementNo, status: 'ACTIVE' });
  });
  return send(res, 201, { id: replacementId, replacementNo, status: 'ACTIVE' });
}

export async function cancelSalesOrderReplacement(db, req, res, actor, replacementId) {
  allow(actor, 'RETURNS_MANAGE');
  transaction(db, () => {
    const header = db.prepare(`SELECT * FROM sales_order_replacements WHERE id=?`).get(replacementId);
    if (!header) throw new HttpError(404, '补货义务不存在');
    if (header.cancellation_state === 'CANCELLED') throw new HttpError(409, '已取消');
    // Per solution.md §29.14.1: cancellation closes only the unfulfilled remainder and
    // never erases confirmed Delivery execution. Existing fulfillment evidence
    // rows remain immutable; the header becomes CANCELLED to block new fulfillments.
    // The canonical Delivery reversal (future bounded work) may reduce fulfillment
    // separately; it does NOT modify this replacement header.
    db.prepare(`UPDATE sales_order_replacements SET cancellation_state='CANCELLED', closed_at=?, closed_by=? WHERE id=?`).run(nowIso(), actor.id, replacementId);
    audit(db, actor.id, 'CANCEL', 'SALES_ORDER_REPLACEMENT', replacementId, `取消补货义务（保留已履行历史）`);
  });
  return send(res, 200, { id: replacementId, status: 'CANCELLED' });
}

export async function fulfillSalesOrderReplacement(db, req, res, actor, replacementId) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  transaction(db, () => {
    const header = db.prepare(`SELECT * FROM sales_order_replacements WHERE id=?`).get(replacementId);
    if (!header) throw new HttpError(404, '补货义务不存在');
    if (header.cancellation_state !== 'ACTIVE') throw new HttpError(409, '已取消的补货义务不能再履行');
    const links = body.lines || [];
    if (!Array.isArray(links) || !links.length) throw new HttpError(400, '请选择已确认的 Delivery 明细');
    for (const link of links) {
      const sdi = db.prepare(`SELECT sdi.*, sd.status, sd.customer_id AS delivery_customer_id FROM sales_delivery_items sdi JOIN sales_deliveries sd ON sd.id=sdi.delivery_id WHERE sdi.id=?`).get(link.salesDeliveryItemId);
      if (!sdi) throw new HttpError(404, 'Sales Delivery 明细不存在');
      if (sdi.status !== 'CONFIRMED') throw new HttpError(409, 'Sales Delivery 必须为已确认');
      const existing = db.prepare(`SELECT id FROM sales_replacement_fulfillments WHERE sales_delivery_item_id=?`).get(sdi.id);
      if (existing) throw new HttpError(409, '同一 Delivery 明细已被其他补货履行占用');
      const rl = db.prepare(`SELECT * FROM sales_order_replacement_lines WHERE id=? AND replacement_id=?`).get(link.replacementLineId, replacementId);
      if (!rl) throw new HttpError(404, '补货行不存在');
      if (sdi.product_id !== rl.replacement_material_id) throw new HttpError(409, 'material 不匹配');
      // R2 — cross-document provenance: source Return customer identity must match Delivery customer
      const sourceReturn = db.prepare(`SELECT customer_id FROM return_orders WHERE id=?`).get(header.source_return_id);
      if (!sourceReturn) throw new HttpError(409, '源退货单不存在');
      if (sdi.delivery_customer_id !== sourceReturn.customer_id) {
        throw new HttpError(409, 'Delivery customer 与 Replacement 源退货客户不一致 (跨文档身份不匹配)');
      }
      const fulfilled = Number(db.prepare(`SELECT COALESCE(SUM(rf.fulfilled_qty),0) n FROM sales_replacement_fulfillments rf WHERE rf.replacement_line_id=?`).get(rl.id).n);
      const remaining = Number(rl.replacement_quantity) - fulfilled;
      const qty = Number(link.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty 必须大于 0');
      if (qty > remaining + 1e-9) throw new HttpError(409, 'qty 超过行剩余');
      db.prepare(`INSERT INTO sales_replacement_fulfillments(id, replacement_line_id, sales_delivery_id, sales_delivery_item_id, fulfilled_qty, business_date, created_at) VALUES(?,?,?,?,?,?,?)`).run(
        randomUUID(), rl.id, sdi.delivery_id, sdi.id, qty, header.created_at, nowIso()
      );
      audit(db, actor.id, 'FULFILL', 'SALES_ORDER_REPLACEMENT', replacementId, `补货履行 ${qty}`);
    }
  });
  return send(res, 201, { id: replacementId, status: 'ACTIVE', fulfillmentState: deriveFulfillmentState(db, replacementId) });
}
