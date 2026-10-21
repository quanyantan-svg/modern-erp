// V21 — applyInventoryMutation dispatcher (Wave B).
//
// Frozen by `solution.md §27.6 / §27.7 / §27.8` and the Domain 5 Closure
// micro-closure corrections.
//
// Single authoritative mutation service contract for physical inventory.
// All physical writes MUST go through this dispatcher. Movement evidence
// rows are written with direction='IN'/'OUT' only (NOT 'MOVE'); business
// mutation type is captured by `movement_kind` + `movement_group_id` for
// paired mutations (MOVE / BIN_MOVE / OWNER_CHANGE / STATUS_CHANGE /
// LOT_RECLASS). Idempotency uses plain UNIQUE on `idempotency_key`; no
// partial unique index.
//
// Lock ordering (§27.18):
//   1. business / source document rows by source_type+source_id
//   2. product / reference rows by product_id
//   3. all inventory positions by position_key ASC (deduped)
//   4. LOT / SERIAL identities by (warehouse_id+lot_id) / (product_id+serial_number)
//   5. inventory_locks aggregates
//   6. transfer execution rows
//   7. financial evidence rows
//
// Atomicity:
//   - validate period + master dimensions + owner + tracking
//   - lock source position (SQLite BEGIN IMMEDIATE inside transaction; MySQL
//     SELECT ... FOR UPDATE in adapter)
//   - validate available physical quantity (or capacity for IN)
//   - apply canonical inventory + inventory_transactions +
//     tracked_inventory_movements + tracked_source_allocations
//   - invoke financial-inventory valuation
//   - audit
//   - commit

import { createHash } from 'node:crypto';
import { transaction, id as genId } from '../db.js';
import { audit } from './audit.js';
import { HttpError } from './http.js';
import { canonicalPositionSnapshot, computePositionKey, normalizeOwnerType, parseCanonicalPositionSnapshot, validateOwner, validateStockStatus, validateBin } from './inventory-position.js';
import { issueSourceValue, assertFinancialPeriodsOpen } from '../modules/financial-inventory.js';
import { postCanonicalTrackedLeg } from '../modules/traceability-quality.js';

const MOVEMENT_KINDS = new Set([
  'IN', 'OUT', 'MOVE', 'OWNER_CHANGE', 'STATUS_CHANGE',
  'LOT_RECLASS', 'BIN_MOVE', 'ADJUSTMENT',
]);

const SOURCE_TYPES = new Set([
  'PURCHASE_RECEIPT', 'PRODUCTION_RECEIPT', 'OUTSOURCING_RECEIPT',
  'SALES_DELIVERY', 'OTHER_RECEIPT', 'OTHER_ISSUE',
  'INVENTORY_TRANSFER', 'INVENTORY_STEP_TRANSFER_OUT', 'INVENTORY_STEP_TRANSFER_IN',
  'INVENTORY_STOCK_STATUS_CHANGE', 'INVENTORY_LOT_ADJUSTMENT',
  'INVENTORY_FORM_CONVERSION', 'INVENTORY_ASSEMBLY', 'INVENTORY_DISASSEMBLY',
  'INVENTORY_ADJUSTMENT', 'INVENTORY_SCRAP', 'INVENTORY_STOCKTAKE_DIFF',
  'INVENTORY_BIN_MOVE',
  'VMI_RECEIPT', 'VMI_CONSUMPTION', 'VMI_OWNERSHIP_TRANSFER',
  'OUTSOURCING_ISSUE', 'OUTSOURCING_RETURN', 'OUTSOURCING_RECEIPT',
  'ENTRUSTED_RECEIPT', 'ENTRUSTED_ISSUE',
  'BARCODE_SCAN_CONFIRM', 'OPENING_INVENTORY',
  'SALES_RETURN', 'SALES_RETURN_REVERSAL',
  'CONSIGNMENT_HANDOFF', 'CONSIGNMENT_SETTLEMENT', 'CONSIGNMENT_RETURN',
]);
const CONSIGNMENT_SOURCE_TYPES = new Set(['CONSIGNMENT_HANDOFF', 'CONSIGNMENT_SETTLEMENT', 'CONSIGNMENT_RETURN']);
const CONSIGNMENT_POLICIES = Object.freeze({
  CONSIGNMENT_HANDOFF: 'HANDOFF_VALUE_NEUTRAL_V1',
  CONSIGNMENT_SETTLEMENT: 'SETTLEMENT_COGS_V1',
  CONSIGNMENT_RETURN: 'RETURN_VALUE_NEUTRAL_V1',
});
const MAX_SAFE_MICROS = Number.MAX_SAFE_INTEGER;

function mutationConflict(message, code = 'INVENTORY_MUTATION_IDEMPOTENCY_CONFLICT') {
  return new HttpError(409, message, { code });
}

function consignmentMicros(input) {
  if (!Number.isSafeInteger(input.quantityMicros) || input.quantityMicros <= 0 || input.quantityMicros > MAX_SAFE_MICROS) {
    throw new HttpError(400, 'Consignment quantityMicros must be a positive safe integer');
  }
  if (Number(input.quantity) * 1_000_000 !== input.quantityMicros) {
    throw new HttpError(400, 'Consignment quantity does not round-trip to quantityMicros');
  }
  return String(input.quantityMicros);
}

function canonicalFingerprint(input, businessDate, movementGroupId, fromJson, toJson) {
  const amount = input.commercialAmountCents;
  if (amount !== null && amount !== undefined && !Number.isSafeInteger(amount)) {
    throw new HttpError(400, 'commercialAmountCents must be a safe integer or null');
  }
  const expectedPolicy = CONSIGNMENT_POLICIES[input.sourceType];
  if (input.trackingMode !== 'CANONICAL_STRICT' || input.valuationMode !== 'EXTERNAL'
      || input.valuationPolicy !== expectedPolicy) {
    throw new HttpError(400, 'Consignment strict tracking/valuation policy mismatch');
  }
  const payload = {
    fingerprintVersion: 1,
    sourceType: input.sourceType,
    sourceId: String(input.sourceId),
    sourceItemId: String(input.sourceItemId),
    movementGroupId,
    movementKind: input.movementKind,
    quantityMicros: consignmentMicros(input),
    businessDate,
    fromPosition: fromJson == null ? null : JSON.parse(fromJson),
    toPosition: toJson == null ? null : JSON.parse(toJson),
    trackingMode: 'CANONICAL_STRICT',
    valuationMode: 'EXTERNAL_STRICT',
    valuationPolicy: expectedPolicy,
    commercialAmountCents: amount == null ? null : String(amount),
  };
  return `V1:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function readConsignmentEvidence(db, row) {
  if (Number(row.evidence_schema_version) !== 1 || !row.source_item_id || !row.request_fingerprint) {
    throw mutationConflict('Legacy Consignment evidence is unavailable', 'CONSIGNMENT_LEGACY_EVIDENCE_UNAVAILABLE');
  }
  const from = row.from_position_identity_json == null ? null : parseCanonicalPositionSnapshot(row.from_position_identity_json);
  const to = row.to_position_identity_json == null ? null : parseCanonicalPositionSnapshot(row.to_position_identity_json);
  const movements = [];
  if (row.out_inventory_transaction_id) movements.push({ direction: 'OUT', transactionId: row.out_inventory_transaction_id, positionKey: from?.positionKey });
  if (row.in_inventory_transaction_id) movements.push({ direction: 'IN', transactionId: row.in_inventory_transaction_id, positionKey: to?.positionKey });
  const tracked = movements.flatMap((movement) => db.prepare('SELECT * FROM tracked_inventory_movements WHERE transaction_id=? ORDER BY id').all(movement.transactionId));
  const valuation = movements.flatMap((movement) => db.prepare('SELECT * FROM inventory_valuation_movements WHERE inventory_transaction_id=? ORDER BY id').all(movement.transactionId));
  return { from, to, movements, tracked, valuation };
}

function buildIdentity({ productId, warehouseId, binId, ownerType, ownerId, stockStatus, lotId, serialId }) {
  const ot = normalizeOwnerType(ownerType);
  validateStockStatus({ prepare: () => ({ get: () => null }) }, stockStatus, { allowInsert: true });
  const pk = computePositionKey({
    productId, warehouseId, binId: binId ?? null,
    ownerType: ot, ownerId: ownerId ?? null,
    stockStatus: stockStatus ?? 'AVAILABLE',
    lotId: lotId ?? null, serialId: serialId ?? null,
  });
  return {
    productId, warehouseId, binId: binId ?? null,
    ownerType: ot, ownerId: ownerId ?? null,
    stockStatus: stockStatus ?? 'AVAILABLE',
    lotId: lotId ?? null, serialId: serialId ?? null,
    positionKey: pk,
  };
}

function validateInventoryMaster(db, identity) {
  const wh = db.prepare('SELECT id, bin_enabled, negative_stock_policy FROM warehouses WHERE id=? AND active=1').get(identity.warehouseId);
  if (!wh) throw new HttpError(400, `仓库 ${identity.warehouseId} 不存在或已停用`);
  const prod = db.prepare('SELECT id, tracking_policy, active FROM products WHERE id=?').get(identity.productId);
  if (!prod) throw new HttpError(400, `产品 ${identity.productId} 不存在`);
  if (!prod.active) throw new HttpError(409, `产品 ${identity.productId} 已停用`);
  if (identity.binId) validateBin(db, identity.warehouseId, identity.binId);
  else if (Number(wh.bin_enabled) === 1) {
    // bin-enabled warehouse requires bin
    throw new HttpError(400, `仓库 ${identity.warehouseId} 启用了仓位管理，请提供仓位`);
  }
  if (identity.lotId) {
    const lot = db.prepare('SELECT id, product_id FROM inventory_lots WHERE id=?').get(identity.lotId);
    if (!lot || lot.product_id !== identity.productId) throw new HttpError(400, 'lot 与产品不匹配');
  }
  if (identity.serialId) {
    const s = db.prepare('SELECT id, product_id FROM inventory_serials WHERE id=?').get(identity.serialId);
    if (!s || s.product_id !== identity.productId) throw new HttpError(400, 'serial 与产品不匹配');
  }
  // Application-level owner reference validation against the live DB
  validateOwner(db, identity.ownerType, identity.ownerId);
  // Stock status must exist (not allowInsert for production writes)
  validateStockStatus(db, identity.stockStatus);
}

function readPositionForUpdate(db, identity) {
  const row = db.prepare(`
    SELECT id, position_key, quantity FROM inventory
     WHERE position_key=? AND active=1
  `).get(identity.positionKey);
  if (!row) return null;
  return { id: row.id, positionKey: row.position_key, quantity: Number(row.quantity) };
}

function applyToPosition(db, identity, delta) {
  const existing = db.prepare(`
    SELECT id, quantity FROM inventory WHERE position_key=? AND active=1
  `).get(identity.positionKey);
  if (existing) {
    const newQty = Number(existing.quantity) + Number(delta);
    db.prepare(`UPDATE inventory SET quantity=?, updated_at=? WHERE id=?`).run(newQty, new Date().toISOString(), existing.id);
    return newQty;
  }
  const newId = genId();
  db.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at,
      position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    newId, identity.warehouseId, identity.productId, delta, new Date().toISOString(),
    identity.positionKey, identity.binId, identity.ownerType, identity.ownerId,
    identity.stockStatus, identity.lotId, identity.serialId,
  );
  return delta;
}

function writeInventoryTransaction(db, input, identity, direction, balanceAfter, businessDate) {
  const txId = genId();
  db.prepare(`
    INSERT INTO inventory_transactions
      (id, warehouse_id, product_id, quantity_change, direction, balance_after,
       source_type, source_id, source_no, remark, creator_id, created_at, business_date)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txId, identity.warehouseId, identity.productId, Math.abs(input.quantity), direction,
    balanceAfter, input.sourceType, input.sourceId, input.sourceNo || '',
    input.remark || '', input.actor?.id || null, new Date().toISOString(), businessDate,
  );
  return txId;
}

function writeTrackedMovement(db, input, identity, direction, businessDate, movementKind, transactionId) {
  const tmId = genId();
  db.prepare(`
    INSERT INTO tracked_inventory_movements
      (id, transaction_id, source_type, source_id, source_item_id, product_id,
       warehouse_id, direction, quantity, lot_id, serial_id, business_date,
       reversed, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    tmId, transactionId, input.sourceType, input.sourceId, input.sourceItemId || null,
    identity.productId, identity.warehouseId, direction, Math.abs(input.quantity),
    identity.lotId, identity.serialId, businessDate, new Date().toISOString(),
  );
  return tmId;
}

export function applyInventoryMutation(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'mutation input 必填');
  if (!input.sourceType || !SOURCE_TYPES.has(input.sourceType)) throw new HttpError(400, 'sourceType 不合法');
  if (!input.sourceId) throw new HttpError(400, 'sourceId 必填');
  if (!MOVEMENT_KINDS.has(input.movementKind)) throw new HttpError(400, 'movementKind 不合法');
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) throw new HttpError(400, 'quantity 必须为正数');
  if (!input.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  if (!input.fromPosition && !input.toPosition) throw new HttpError(400, '必须提供 fromPosition 或 toPosition');
  const businessDate = input.businessDate || new Date().toISOString().slice(0, 10);
  const movementGroupId = input.movementGroupId || genId();
  const isConsignment = CONSIGNMENT_SOURCE_TYPES.has(input.sourceType);
  if (isConsignment && (!input.sourceItemId || !input.movementGroupId)) {
    throw new HttpError(400, 'Consignment sourceItemId and stable movementGroupId are required');
  }

  // Movement-kind pairing: paired kinds must have both from and to.
  const pairedKinds = new Set(['MOVE', 'BIN_MOVE', 'OWNER_CHANGE', 'STATUS_CHANGE', 'LOT_RECLASS']);
  if (pairedKinds.has(input.movementKind)) {
    if (!input.fromPosition || !input.toPosition) throw new HttpError(400, `${input.movementKind} 必须同时提供 fromPosition 和 toPosition`);
  }

  // Idempotency replay
  let result = null;
  const runMutation = (db) => {
    const replaySql = `SELECT * FROM inventory_mutation_log WHERE idempotency_key=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`;
    const replay = db.prepare(replaySql).get(input.idempotencyKey);
    if (replay && !isConsignment) {
      result = { replayed: true, movementGroupId: replay.movement_group_id };
      return;
    }
    const fromPos = input.fromPosition ? buildIdentity(input.fromPosition) : null;
    const toPos   = input.toPosition   ? buildIdentity(input.toPosition)   : null;
    if (fromPos) validateInventoryMaster(db, fromPos);
    if (toPos)   validateInventoryMaster(db, toPos);
    const fromPositionIdentityJson = isConsignment && fromPos ? canonicalPositionSnapshot(fromPos) : null;
    const toPositionIdentityJson = isConsignment && toPos ? canonicalPositionSnapshot(toPos) : null;
    const requestFingerprint = isConsignment
      ? canonicalFingerprint(input, businessDate, movementGroupId, fromPositionIdentityJson, toPositionIdentityJson)
      : null;
    if (replay) {
      const stored = readConsignmentEvidence(db, replay);
      const readableMismatch = replay.source_type !== input.sourceType
        || replay.source_id !== String(input.sourceId)
        || replay.source_item_id !== String(input.sourceItemId)
        || replay.movement_group_id !== movementGroupId
        || replay.movement_kind !== input.movementKind
        || replay.business_date !== businessDate
        || Math.round(Number(replay.quantity) * 1_000_000) !== input.quantityMicros
        || replay.from_position_identity_json !== fromPositionIdentityJson
        || replay.to_position_identity_json !== toPositionIdentityJson
        || replay.request_fingerprint !== requestFingerprint;
      if (readableMismatch) throw mutationConflict('Inventory mutation idempotency conflict');
      result = {
        replayed: true,
        mutationId: replay.id,
        movementGroupId: replay.movement_group_id,
        fromPosition: stored.from,
        toPosition: stored.to,
        movements: stored.movements,
        trackedMovements: stored.tracked,
        valuationMovements: stored.valuation,
      };
      return;
    }

    // Lock target positions (canonical order ASC) via SELECT … FOR UPDATE equivalent.
    const positions = [...new Set([fromPos, toPos].filter(Boolean).map((p) => p.positionKey))].sort();
    const placeholders = positions.map(() => '?').join(',');
    if (positions.length) {
      const lockSql = `SELECT id, quantity FROM inventory WHERE position_key IN (${placeholders}) ORDER BY position_key ASC${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`;
      db.prepare(lockSql).all(...positions);
    }

    const movements = [];
    if (fromPos && toPos && fromPos.positionKey === toPos.positionKey) {
      throw new HttpError(400, 'fromPosition 与 toPosition 不能相同');
    }

    // Negative-stock + lock + init-close gate
    if (fromPos && ['OUT', 'MOVE', 'OWNER_CHANGE', 'STATUS_CHANGE', 'LOT_RECLASS', 'BIN_MOVE', 'ADJUSTMENT'].includes(input.movementKind)) {
      const wh = db.prepare('SELECT negative_stock_policy FROM warehouses WHERE id=?').get(fromPos.warehouseId);
      const policy = wh?.negative_stock_policy || 'BLOCK';
      const cur = db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(fromPos.positionKey);
      const current = cur ? Number(cur.quantity) : 0;
      const activeLocked = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE product_id=? AND warehouse_id=? AND position_key=? AND status='ACTIVE'`).get(fromPos.productId, fromPos.warehouseId, fromPos.positionKey)?.q || 0);
      const lockable = Math.max(0, current - activeLocked);
      if (policy === 'BLOCK' && lockable < Number(input.quantity)) {
        throw new HttpError(409, `库存不足：position ${fromPos.positionKey} 可用 ${lockable}，需出 ${input.quantity}`);
      }
    }
    // INV-32: initialization close gate for OPENING_INVENTORY source
    if (input.sourceType === 'OPENING_INVENTORY') {
      const init = db.prepare(`SELECT status FROM inventory_initialization LIMIT 1`).get();
      if (init && init.status === 'CLOSED') {
        throw new HttpError(409, `Initialization status CLOSED; cannot create opening inventory`);
      }
    }

    // Apply to source (decrease)
    let balanceAfterFrom = null;
    if (fromPos) {
      const existing = readPositionForUpdate(db, fromPos);
      const current = existing ? existing.quantity : 0;
      if (current < Number(input.quantity) && input.movementKind !== 'ADJUSTMENT') {
        throw new HttpError(409, `库存不足：position ${fromPos.positionKey} 当前 ${current}`);
      }
      balanceAfterFrom = applyToPosition(db, fromPos, -Number(input.quantity));
      movements.push({ position: fromPos, direction: 'OUT', balanceAfter: balanceAfterFrom });
    }
    // Apply to destination (increase)
    let balanceAfterTo = null;
    if (toPos) {
      balanceAfterTo = applyToPosition(db, toPos, Number(input.quantity));
      movements.push({ position: toPos, direction: 'IN', balanceAfter: balanceAfterTo });
    }

    // Single-direction (IN / OUT / ADJUSTMENT) record a single inventory_transactions + tracked row.
    // Paired kinds record both.
    for (const m of movements) {
      m.transactionId = writeInventoryTransaction(db, input, m.position, m.direction, m.balanceAfter, businessDate);
      if (isConsignment) {
        m.trackedMovement = postCanonicalTrackedLeg(db, {
          transactionId: m.transactionId, sourceType: input.sourceType,
          sourceId: input.sourceId, sourceItemId: input.sourceItemId,
          productId: m.position.productId, warehouseId: m.position.warehouseId,
          lotId: m.position.lotId, serialId: m.position.serialId,
          quantity: input.quantity, direction: m.direction, businessDate,
        });
      } else if (input.trackingMode !== 'EXTERNAL') {
        m.trackedMovementId = writeTrackedMovement(db, input, m.position, m.direction, businessDate, input.movementKind, m.transactionId);
      }
    }

    // Valuation integration (cents-based INTEGER safe) — fires on every quantity-delta.
    if (input.valuationMode !== 'EXTERNAL') {
      try {
        for (const m of movements) {
          issueSourceValue(db, {
            businessDate,
            productId: m.position.productId,
            warehouseId: m.position.warehouseId,
            quantity: Number(input.quantity),
            movementType: input.sourceType,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceItemId: input.sourceItemId,
            inventoryTransactionId: m.transactionId,
          });
        }
      } catch (e) {
        // Legacy callers retain their historical best-effort valuation behavior.
        // Callers using valuationMode=EXTERNAL own a strict valuation step in the
        // same outer transaction and never enter this compatibility branch.
      }
    }

    // Mutation log (idempotency replay key).
    const mutationId = genId();
    const outMovement = movements.find((movement) => movement.direction === 'OUT');
    const inMovement = movements.find((movement) => movement.direction === 'IN');
    db.prepare(`
      INSERT INTO inventory_mutation_log(
        id, idempotency_key, movement_group_id, source_type, source_id, movement_kind,
        quantity, business_date, actor_id, created_at, source_item_id,
        from_position_key, to_position_key, from_position_identity_json,
        to_position_identity_json, out_inventory_transaction_id,
        in_inventory_transaction_id, request_fingerprint, evidence_schema_version)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mutationId, input.idempotencyKey, movementGroupId, input.sourceType, input.sourceId,
      input.movementKind, input.quantity, businessDate, input.actor?.id || null, new Date().toISOString(),
      isConsignment ? input.sourceItemId : null,
      isConsignment ? fromPos?.positionKey ?? null : null,
      isConsignment ? toPos?.positionKey ?? null : null,
      fromPositionIdentityJson, toPositionIdentityJson,
      isConsignment ? outMovement?.transactionId ?? null : null,
      isConsignment ? inMovement?.transactionId ?? null : null,
      requestFingerprint, isConsignment ? 1 : null,
    );

    // Audit
    audit(db, input.actor?.id || null, input.movementKind, input.sourceType, input.sourceId,
      `${input.movementKind} ${input.quantity} ${input.sourceType}/${input.sourceId} movement_group=${movementGroupId}`);

    result = {
      replayed: false,
      mutationId,
      movementGroupId,
      balanceAfterFrom,
      balanceAfterTo,
      movements: movements.map((movement) => ({
        direction: movement.direction,
        transactionId: movement.transactionId,
        positionKey: movement.position.positionKey,
        balanceAfter: movement.balanceAfter,
        trackedMovement: movement.trackedMovement || null,
      })),
    };
  };

  // INV-32 sec 27.41: canonical inventory period gate. Rejects BEFORE mutation
  // when businessDate falls in any CLOSED inventory_period_closure row.
  const assertInventoryPeriodOpen = (db, businessDate) => {
    const rows = db.prepare(`SELECT period_key FROM inventory_period_closures WHERE status='CLOSED' ORDER BY period_key`).all();
    if (!rows.length) return;
    for (const r of rows) {
      const [yyyy, mm] = String(r.period_key).split('-').map(Number);
      if (!yyyy || !mm) continue;
      const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
      const cutoff = `${r.period_key}-${String(lastDay).padStart(2, '0')}`;
      if (businessDate <= cutoff) {
        throw new HttpError(409, `inventory period closed to ${r.period_key}`, {
          code: 'INVENTORY_PERIOD_CLOSED',
          resolution: 'use business date after closed period',
        });
      }
    }
  };

  // Detect an already-open transaction so nested callers (e.g. VMI/transfer
  // owners) can rely on a single outer commit. SQLite's BEGIN IMMEDIATE in a
  // nested transaction is rejected as "cannot start a transaction within a
  // transaction", so we hand control back to the caller's transaction by
  // running the mutation body directly.
  const inOpenTransaction = () => {
    try { return Boolean(input.db.isTransaction) || (input.db.getters?.isTransaction?.() === true); }
    catch { return false; }
  };
  const execute = () => {
    assertInventoryPeriodOpen(input.db, businessDate);
    assertFinancialPeriodsOpen(input.db, businessDate);
    runMutation(input.db);
  };
  if (inOpenTransaction()) {
    execute();
  } else {
    transaction(input.db, execute);
  }
  return result;
}
