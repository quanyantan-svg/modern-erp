import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allowAny, assertAllowedFields, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey, parseCanonicalPositionSnapshot } from '../lib/inventory-position.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { createSystemVoucher, inventoryAccountRole, issueValue, receiveValue } from './financial-inventory.js';
import { recognizeFinanceExposure } from './finance-recognition.js';
import { RECOGNITION_MODES } from './finance-recognition-policy.js';
import { assertGroupScope, requireSalesPermission } from './sales-scope.js';

const CONSIGNMENT_TYPES = ['CONSIGNMENT_HANDOFF', 'CONSIGNMENT_SETTLEMENT', 'CONSIGNMENT_RETURN'];
const lock = (db) => db.dialect === 'mysql' ? ' FOR UPDATE' : '';
const now = () => new Date().toISOString();
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const qty = (value, label = 'quantityMicros') => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HttpError(422, `${label} must be a positive safe integer`);
  return number;
};
const ver = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(422, 'expectedVersion must be a positive integer');
  return number;
};
const requireRead = (actor) => { allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']); requireSalesPermission(actor, 'CONSIGNMENT_VIEW'); };
const requireWrite = (actor) => { requireSalesPermission(actor, 'SALES_MANAGE'); requireSalesPermission(actor, 'CONSIGNMENT_MANAGE'); };

function scope(db, actor, row, write = false) {
  if (row.sales_group_id) assertGroupScope(db, actor, {
    salesGroupId: row.sales_group_id, businessDate: row.business_date,
    documentType: 'SALES_ORDER', write,
  });
}

function documentRow(db, id, actor, forUpdate = false) {
  const row = db.prepare(`SELECT * FROM consignment_commercial_documents WHERE id=?${forUpdate ? lock(db) : ''}`).get(id);
  if (!row) throw new HttpError(404, 'Consignment document not found');
  scope(db, actor, row, forUpdate);
  return row;
}

function lineRow(db, id, actor, forUpdate = false) {
  const row = db.prepare(`SELECT l.*,d.customer_id,d.sales_group_id,d.source_warehouse_id,d.business_date,d.currency_code,d.status document_status,d.document_no
    FROM consignment_commercial_lines l JOIN consignment_commercial_documents d ON d.id=l.document_id
    WHERE l.id=?${forUpdate ? lock(db) : ''}`).get(id);
  if (!row) throw new HttpError(404, 'Consignment line not found');
  scope(db, actor, row, forUpdate);
  return row;
}

function referenceNotFound() {
  return new HttpError(404, 'Consignment reference context not found', { code: 'CONSIGNMENT_REFERENCE_CONTEXT_NOT_FOUND' });
}

function referenceDocumentRow(db, id, actor) {
  const row = db.prepare('SELECT * FROM consignment_commercial_documents WHERE id=?').get(id);
  if (!row) throw referenceNotFound();
  scope(db, actor, row, true);
  return row;
}

function warehouseBins(db, warehouseId) {
  return db.prepare(`SELECT id,warehouse_id warehouseId,code,name FROM warehouse_bins
    WHERE warehouse_id=? AND active=1 ORDER BY code,id`).all(warehouseId);
}

function projectWarehouseReference(db, warehouse) {
  const bins = Number(warehouse.bin_enabled) === 1 ? warehouseBins(db, warehouse.id) : [];
  return {
    id: warehouse.id, code: warehouse.code, name: warehouse.name,
    binEnabled: Number(warehouse.bin_enabled) === 1, bins,
  };
}

function returnWarehouseCandidates(db) {
  const rows = db.prepare(`SELECT id,code,name,bin_enabled FROM warehouses
    WHERE active=1 AND COALESCE(is_supplier_wip,0)=0 ORDER BY code,id`).all();
  return rows.map((row) => projectWarehouseReference(db, row))
    .filter((row) => !row.binEnabled || row.bins.length > 0);
}

function lockReturnDestination(db, warehouseId, binId) {
  if (!warehouseId) throw new HttpError(409, 'Return destination is required', { code: 'CONSIGNMENT_RETURN_DESTINATION_REQUIRED' });
  const warehouse = db.prepare(`SELECT id,active,bin_enabled,is_supplier_wip FROM warehouses WHERE id=?${lock(db)}`).get(warehouseId);
  if (!warehouse?.active || Number(warehouse.is_supplier_wip || 0) !== 0) {
    throw new HttpError(409, 'Return destination is invalid', { code: 'CONSIGNMENT_RETURN_DESTINATION_INVALID' });
  }
  if (Number(warehouse.bin_enabled) === 0) {
    if (binId) throw new HttpError(409, 'Return destination bin is invalid', { code: 'CONSIGNMENT_RETURN_DESTINATION_BIN_INVALID' });
    return { warehouse, binId: null };
  }
  if (!binId) throw new HttpError(409, 'Return destination bin is required', { code: 'CONSIGNMENT_RETURN_DESTINATION_BIN_REQUIRED' });
  const bin = db.prepare(`SELECT id,warehouse_id,active FROM warehouse_bins WHERE id=?${lock(db)}`).get(binId);
  if (!bin?.active || bin.warehouse_id !== warehouse.id) {
    throw new HttpError(409, 'Return destination bin is invalid', { code: 'CONSIGNMENT_RETURN_DESTINATION_BIN_INVALID' });
  }
  return { warehouse, binId: bin.id };
}

function activeLocation(db, locationId, customerId, businessDate, forUpdate = false) {
  const row = db.prepare(`SELECT * FROM consignment_commodity_locations WHERE id=?${forUpdate ? lock(db) : ''}`).get(locationId);
  if (!row || row.customer_id !== customerId || !row.active || row.effective_from > businessDate || (row.effective_to && row.effective_to < businessDate)) {
    throw new HttpError(409, 'Consignment location is not effective', { code: 'CONSIGNMENT_LOCATION_NOT_EFFECTIVE' });
  }
  const warehouse = db.prepare(`SELECT id,active,bin_enabled FROM warehouses WHERE id=?${forUpdate ? lock(db) : ''}`).get(row.physical_warehouse_id);
  if (!warehouse?.active) throw new HttpError(409, 'Mapped warehouse is inactive', { code: 'CONSIGNMENT_LOCATION_MAPPING_INVALID' });
  if (Number(warehouse.bin_enabled) === 1 && !row.physical_bin_id) throw new HttpError(409, 'Mapped bin is required', { code: 'CONSIGNMENT_LOCATION_MAPPING_INVALID' });
  if (row.physical_bin_id && !db.prepare(`SELECT 1 FROM warehouse_bins WHERE id=? AND warehouse_id=? AND active=1${forUpdate ? lock(db) : ''}`).get(row.physical_bin_id, warehouse.id)) {
    throw new HttpError(409, 'Mapped bin is invalid', { code: 'CONSIGNMENT_LOCATION_MAPPING_INVALID' });
  }
  return row;
}

function lineAmount(totalCents, consumedMicros, nextMicros, capacityMicros) {
  const before = BigInt(totalCents) * BigInt(consumedMicros) / BigInt(capacityMicros);
  const after = BigInt(totalCents) * BigInt(consumedMicros + nextMicros) / BigInt(capacityMicros);
  const amount = Number(after - before);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new HttpError(409, 'Consignment amount is unsafe');
  return amount;
}

// solution.md §35.18.3 / §35.18.10.2 — a SO-backed consignment line may not invent
// its own commercial basis. The authoritative net unit price is derived from the
// approved sales-order line, and it must be exactly representable as an integer
// number of cents per base unit; anything else is CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE.
function unrepresentable(reason) {
  return new HttpError(409, 'Sales-order commercial basis cannot be represented by consignment', {
    code: 'CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE', reason,
  });
}

function baseMicrosOf(source) {
  const num = BigInt(source.base_quantity_num);
  const den = BigInt(source.base_quantity_den ?? 1);
  const docNum = BigInt(source.document_quantity_num);
  const docDen = BigInt(source.document_quantity_den ?? 1);
  if (![num, den, docNum, docDen].every((value) => value > 0n)) throw unrepresentable('BASE_QUANTITY_SNAPSHOT_INVALID');
  const conversionNumerator = source.conversion_numerator == null ? 1n : BigInt(source.conversion_numerator);
  const conversionDenominator = source.conversion_denominator == null ? 1n : BigInt(source.conversion_denominator);
  if (conversionNumerator !== 1n || conversionDenominator !== 1n) throw unrepresentable('SALES_UOM_NOT_ONE_TO_ONE');
  if (num * 1_000_000n % den !== 0n || docNum * 1_000_000n % docDen !== 0n) throw unrepresentable('BASE_QUANTITY_NOT_INTEGER_MICROS');
  const baseMicros = num * 1_000_000n / den;
  if (baseMicros !== docNum * 1_000_000n / docDen) throw unrepresentable('SALES_UOM_NOT_ONE_TO_ONE');
  return baseMicros;
}

export function assertSoBackedConsignmentBasis(db, {
  salesOrderItemId, productId, customerId, quantityMicros, unitPriceCents, forUpdate = false,
}) {
  const source = db.prepare(`SELECT i.*,o.customer_id,o.status order_status,o.order_no,o.sales_group_id
    FROM sales_order_items i JOIN sales_orders o ON o.id=i.order_id
    WHERE i.id=?${forUpdate ? lock(db) : ''}`).get(salesOrderItemId);
  if (!source) throw new HttpError(409, 'Consignment sales-order source is invalid', { code: 'CONSIGNMENT_SALES_ORDER_SOURCE_INVALID' });
  if (source.product_id !== productId || source.customer_id !== customerId || source.order_status !== 'APPROVED') {
    throw new HttpError(409, 'Consignment sales-order source is invalid', { code: 'CONSIGNMENT_SALES_ORDER_SOURCE_INVALID' });
  }

  const orderedMicros = baseMicrosOf(source);
  const netCents = Number(source.amount_cents);
  if (!Number.isSafeInteger(netCents) || netCents < 0) throw unrepresentable('SOURCE_AMOUNT_INVALID');

  // The approved SO line carries an immutable post-discount final amount. It is
  // the only authority for consignment pricing, so it must still agree with the
  // stored discount evidence before it may be reused.
  if (source.discount_snapshot_json) {
    let snapshot;
    try { snapshot = JSON.parse(source.discount_snapshot_json); } catch { throw unrepresentable('DISCOUNT_SNAPSHOT_UNPARSEABLE'); }
    if (Number(snapshot?.finalAmountCents) !== netCents) throw unrepresentable('DISCOUNT_SNAPSHOT_DISAGREES_WITH_SOURCE_AMOUNT');
  }

  const scaled = BigInt(netCents) * 1_000_000n;
  if (scaled % orderedMicros !== 0n) throw unrepresentable('NET_UNIT_PRICE_NOT_INTEGER_CENTS');
  const authoritativeUnitPriceCents = Number(scaled / orderedMicros);
  if (unitPriceCents !== authoritativeUnitPriceCents) {
    throw new HttpError(409, 'Consignment unit price does not match the approved sales-order net unit price', {
      code: 'CONSIGNMENT_SALES_ORDER_BASIS_MISMATCH', salesOrderItemId, authoritativeUnitPriceCents, requestedUnitPriceCents: unitPriceCents,
    });
  }

  const usage = db.prepare(`SELECT COALESCE(SUM(consigned_qty_micros),0) qty,COALESCE(SUM(settled_amount_cents+returned_amount_cents),0) amount
    FROM consignment_commercial_lines WHERE sales_order_item_id=?`).get(salesOrderItemId);
  if (BigInt(usage.qty) + BigInt(quantityMicros) > orderedMicros) {
    throw new HttpError(409, 'Consignment exceeds the remaining approved sales-order source capacity', {
      code: 'CONSIGNMENT_SOURCE_CAPACITY_EXCEEDED', orderedMicros: Number(orderedMicros), alreadyConsignedMicros: Number(usage.qty),
    });
  }
  if (BigInt(usage.amount) > BigInt(netCents)) throw unrepresentable('SOURCE_AMOUNT_ALREADY_EXCEEDED');
  return { salesOrderItemId, orderedMicros, netCents, authoritativeUnitPriceCents };
}

function snapshotPosition(snapshot) {
  return {
    productId: snapshot.productId, warehouseId: snapshot.warehouseId, binId: snapshot.binId,
    ownerType: snapshot.ownerType, ownerId: snapshot.ownerId, stockStatus: snapshot.stockStatus,
    lotId: snapshot.lotId, serialId: snapshot.serialId,
  };
}

// One document/line may hand off from several source bins and may settle or return
// across several partitions, all inside one movement group. V21 identifies a
// valuation movement by (source_type, source_id, source_item_id, lot, serial,
// movement_type), so the canonical source position has to travel in `movementType`
// or the partitions of one document would collide. This is a Wave 8 caller identity
// choice only — V21's schema, index and writers are untouched.
function partitionMovementType(input, direction) {
  const key = computePositionKey(snapshotPosition(input.from));
  return `${input.sourceType}_${direction}:${hash(key).slice(0, 16)}`;
}

function strictValueMove(db, mutation, input, policy) {
  const out = mutation.movements.find((row) => row.direction === 'OUT');
  const into = mutation.movements.find((row) => row.direction === 'IN');
  const issued = issueValue(db, {
    businessDate: input.businessDate, ...snapshotPosition(input.from), quantity: input.quantity,
    movementType: partitionMovementType(input, 'OUT'), sourceType: input.sourceType, sourceId: input.sourceId,
    sourceItemId: input.sourceItemId, inventoryTransactionId: out.transactionId,
  });
  if (issued.valuationMethod === 'LEGACY_UNVALUED') throw new HttpError(409, 'Consignment valuation cannot be legacy-unvalued', { code: 'CONSIGNMENT_VALUATION_REQUIRED' });
  if (policy === 'OUT') return { issued, valueCents: -issued.valueDeltaCents };
  const received = receiveValue(db, {
    businessDate: input.businessDate, ...snapshotPosition(input.to), quantity: input.quantity,
    valueCents: -issued.valueDeltaCents, valuationBasis: issued.valuationMethod,
    movementType: partitionMovementType(input, 'IN'), sourceType: input.sourceType, sourceId: input.sourceId,
    sourceItemId: input.sourceItemId, inventoryTransactionId: into.transactionId,
  });
  if (issued.valueDeltaCents + received.valueDeltaCents !== 0) throw new HttpError(409, 'Consignment value-neutral movement is not conserved');
  return { issued, received, valueCents: -issued.valueDeltaCents };
}

function runPartitionMutation(db, actor, input) {
  const mutation = applyInventoryMutation({
    db, actor, sourceType: input.sourceType, sourceId: input.sourceId, sourceItemId: input.sourceItemId,
    sourceNo: input.sourceNo, movementKind: input.to ? 'MOVE' : 'OUT',
    quantity: input.quantityMicros / 1_000_000, quantityMicros: input.quantityMicros,
    fromPosition: snapshotPosition(input.from), toPosition: input.to ? snapshotPosition(input.to) : null,
    businessDate: input.businessDate, movementGroupId: input.movementGroupId,
    idempotencyKey: input.idempotencyKey, trackingMode: 'CANONICAL_STRICT', valuationMode: 'EXTERNAL',
    valuationPolicy: input.valuationPolicy, commercialAmountCents: input.commercialAmountCents ?? null,
  });
  if (mutation.replayed) return mutation;
  return { ...mutation, valuation: strictValueMove(db, mutation, {
    ...input, quantity: input.quantityMicros / 1_000_000,
  }, input.to ? 'MOVE' : 'OUT') };
}

export function resolveConsignmentHandoffEvidence(db, lineId) {
  const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE id=?').get(lineId);
  if (!line?.handoff_movement_group_id) throw new HttpError(409, 'Handoff evidence is unavailable', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_UNAVAILABLE' });
  const handoffs = db.prepare(`SELECT * FROM inventory_mutation_log
    WHERE source_type='CONSIGNMENT_HANDOFF' AND source_item_id=? AND movement_group_id=?
    ORDER BY business_date,id`).all(lineId, line.handoff_movement_group_id);
  if (!handoffs.length) throw new HttpError(409, 'Handoff evidence is unavailable', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_UNAVAILABLE' });
  const consumed = db.prepare(`SELECT from_position_key,SUM(quantity) quantity FROM inventory_mutation_log
    WHERE source_type IN ('CONSIGNMENT_SETTLEMENT','CONSIGNMENT_RETURN') AND source_item_id=?
    GROUP BY from_position_key`).all(lineId);
  const consumedByKey = new Map(consumed.map((row) => [row.from_position_key, Math.round(Number(row.quantity) * 1_000_000)]));

  // Entitlement is per `(lineId, to_position_key)` bucket, not per handoff mutation:
  // several source bins may hand off into one destination Position, and the bucket's
  // consumption may only be deducted once. Bucketing by the full canonical position
  // key keeps LOT/SERIAL and bin identity separate, and `source_item_id` scoping keeps
  // distinct commercial lines on a shared Position independent.
  const buckets = new Map();
  for (const row of handoffs) {
    if (Number(row.evidence_schema_version) !== 1 || !row.to_position_identity_json || !row.in_inventory_transaction_id) {
      throw new HttpError(409, 'Handoff evidence is incomplete', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_INVALID' });
    }
    const position = parseCanonicalPositionSnapshot(row.to_position_identity_json);
    const handedOffMicros = Math.round(Number(row.quantity) * 1_000_000);
    const outTx = db.prepare('SELECT * FROM inventory_transactions WHERE id=?').get(row.out_inventory_transaction_id);
    const inTx = db.prepare('SELECT * FROM inventory_transactions WHERE id=?').get(row.in_inventory_transaction_id);
    const outSnapshot = parseCanonicalPositionSnapshot(row.from_position_identity_json);
    const physicalValid = outTx?.direction === 'OUT' && inTx?.direction === 'IN'
      && outTx.source_type === 'CONSIGNMENT_HANDOFF' && inTx.source_type === 'CONSIGNMENT_HANDOFF'
      && outTx.source_id === row.source_id && inTx.source_id === row.source_id
      && outTx.product_id === outSnapshot.productId && inTx.product_id === position.productId
      && outTx.warehouse_id === outSnapshot.warehouseId && inTx.warehouse_id === position.warehouseId
      && Math.round(Math.abs(Number(outTx.quantity_change)) * 1_000_000) === handedOffMicros
      && Math.round(Math.abs(Number(inTx.quantity_change)) * 1_000_000) === handedOffMicros;
    const trackedOut = db.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements WHERE transaction_id=? AND direction=\'OUT\' AND source_item_id=?').get(outTx?.id, lineId).n;
    const trackedIn = db.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements WHERE transaction_id=? AND direction=\'IN\' AND source_item_id=?').get(inTx?.id, lineId).n;
    const valueOut = db.prepare("SELECT COALESCE(SUM(quantity_delta),0) quantity,COALESCE(SUM(value_delta_cents),0) value FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'").get(outTx?.id);
    const valueIn = db.prepare("SELECT COALESCE(SUM(quantity_delta),0) quantity,COALESCE(SUM(value_delta_cents),0) value FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'").get(inTx?.id);
    if (!physicalValid || Number(trackedOut) < 1 || Number(trackedIn) < 1
        || Math.round(-Number(valueOut.quantity) * 1_000_000) !== handedOffMicros
        || Math.round(Number(valueIn.quantity) * 1_000_000) !== handedOffMicros
        || Number(valueOut.value) + Number(valueIn.value) !== 0) {
      throw new HttpError(409, 'Handoff transaction/tracking/valuation graph is invalid', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_INVALID' });
    }
    if (!Number.isSafeInteger(handedOffMicros) || handedOffMicros <= 0) throw new HttpError(409, 'Handoff partition capacity is invalid', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_INVALID' });
    const existing = buckets.get(position.positionKey);
    if (existing) {
      existing.handedOffMicros += handedOffMicros;
      existing.mutationIds.push(row.id);
      if (row.business_date < existing.businessDate) existing.businessDate = row.business_date;
      if (row.id < existing.mutationId) existing.mutationId = row.id;
    } else {
      buckets.set(position.positionKey, {
        positionKey: position.positionKey, position, movementGroupId: row.movement_group_id,
        handedOffMicros, mutationIds: [row.id], mutationId: row.id, businessDate: row.business_date,
      });
    }
  }

  return [...buckets.values()].map((bucket) => {
    const remainingMicros = bucket.handedOffMicros - (consumedByKey.get(bucket.positionKey) || 0);
    if (!Number.isSafeInteger(bucket.handedOffMicros) || remainingMicros < 0) throw new HttpError(409, 'Handoff partition capacity is invalid', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_INVALID' });
    return {
      positionKey: bucket.positionKey, mutationId: bucket.mutationId, mutationIds: bucket.mutationIds,
      movementGroupId: bucket.movementGroupId, position: bucket.position,
      handedOffMicros: bucket.handedOffMicros, remainingMicros, businessDate: bucket.businessDate,
    };
  });
}

function selectPartitions(db, line, quantityMicros, serialIds = []) {
  const evidence = resolveConsignmentHandoffEvidence(db, line.id);
  const product = db.prepare('SELECT tracking_policy FROM products WHERE id=?').get(line.product_id);
  let candidates = evidence.filter((row) => row.remainingMicros > 0);
  if (product?.tracking_policy === 'SERIAL') {
    const requested = new Set(serialIds.map(String));
    if (requested.size * 1_000_000 !== quantityMicros) throw new HttpError(409, 'Exact serial allocation is required', { code: 'CONSIGNMENT_SERIAL_EVIDENCE_REQUIRED' });
    candidates = candidates.filter((row) => requested.has(row.position.serialId));
    if (candidates.length !== requested.size) throw new HttpError(409, 'Serial entitlement is unavailable', { code: 'CONSIGNMENT_SERIAL_EVIDENCE_REQUIRED' });
  }
  let remaining = quantityMicros;
  const selected = [];
  for (const partition of candidates.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.mutationId.localeCompare(b.mutationId))) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, partition.remainingMicros);
    selected.push({ ...partition, takeMicros: take });
    remaining -= take;
  }
  if (remaining !== 0) throw new HttpError(409, 'Consignment partition entitlement is insufficient', { code: 'CONSIGNMENT_PARTITION_CAPACITY_EXCEEDED' });
  return selected;
}

function refreshDocumentState(db, documentId) {
  const totals = db.prepare(`SELECT SUM(consigned_qty_micros) consigned,SUM(settled_qty_micros) settled,SUM(returned_qty_micros) returned
    FROM consignment_commercial_lines WHERE document_id=?`).get(documentId);
  const consigned = Number(totals.consigned || 0); const settled = Number(totals.settled || 0); const returned = Number(totals.returned || 0);
  const status = settled === consigned ? 'SETTLED' : returned === consigned ? 'RETURNED' : settled || returned ? 'PARTIAL_SETTLED' : 'INSTRUCTED';
  db.prepare('UPDATE consignment_commercial_documents SET status=?,version=version+1,updated_at=? WHERE id=?').run(status, now(), documentId);
}

export function createConsignmentLocationCommand(db, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required');
  const businessDate = normalizeBusinessDate(input.effectiveFrom, 'effectiveFrom');
  const scopeId = `${input.customerId}:${String(input.locationCode || '').trim()}`;
  const fingerprint = requestFingerprint(input); const replay = idempotencyReplay(db, 'CONSIGNMENT_LOCATION_CREATE', scopeId, key, fingerprint);
  if (replay) return { ...replay, replayed: true };
  let result; transaction(db, () => {
    const warehouse = db.prepare('SELECT active,bin_enabled FROM warehouses WHERE id=?').get(input.physicalWarehouseId);
    if (!warehouse?.active || (Number(warehouse.bin_enabled) === 1 && !input.physicalBinId)) throw new HttpError(409, 'Physical warehouse/bin mapping is invalid');
    if (input.physicalBinId && !db.prepare('SELECT 1 FROM warehouse_bins WHERE id=? AND warehouse_id=? AND active=1').get(input.physicalBinId, input.physicalWarehouseId)) throw new HttpError(409, 'Physical bin mapping is invalid');
    const id = randomUUID(); const stamp = now();
    db.prepare(`INSERT INTO consignment_commodity_locations(id,location_code,customer_id,name,address_text,physical_warehouse_id,physical_bin_id,active,effective_from,effective_to,version,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,1,?,NULL,1,?,?,?,?)`).run(id, String(input.locationCode || '').trim(), input.customerId, String(input.name || '').trim(), String(input.addressText || ''), input.physicalWarehouseId, input.physicalBinId || null, businessDate, stamp, stamp, actor.id, actor.id);
    audit(db, actor.id, 'CREATE', 'CONSIGNMENT_LOCATION', id, input.locationCode);
    result = db.prepare('SELECT * FROM consignment_commodity_locations WHERE id=?').get(id);
    saveIdempotency(db, 'CONSIGNMENT_LOCATION_CREATE', scopeId, key, fingerprint, result);
  }); return result;
}

export function createConsignmentDocumentCommand(db, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required');
  const businessDate = normalizeBusinessDate(input.businessDate, 'businessDate');
  if (input.currencyCode !== 'CNY') throw new HttpError(409, 'Only CNY consignment is supported', { code: 'CONSIGNMENT_CURRENCY_UNSUPPORTED' });
  const fingerprint = requestFingerprint(input); const replay = idempotencyReplay(db, 'CONSIGNMENT_CREATE', input.customerId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    if (!Array.isArray(input.lines) || !input.lines.length) throw new HttpError(422, 'At least one line is required');
    const id = randomUUID(); const stamp = now(); const no = `CS-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
    db.prepare(`INSERT INTO consignment_commercial_documents(id,document_no,customer_id,sales_group_id,source_warehouse_id,instruction_date,business_date,currency_code,status,version,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?, 'DRAFT',1,?,?,?,?)`).run(id, no, input.customerId, input.salesGroupId || null, input.sourceWarehouseId, businessDate, businessDate, 'CNY', stamp, stamp, actor.id, actor.id);
    scope(db, actor, { sales_group_id: input.salesGroupId || null, business_date: businessDate }, true);
    const insert = db.prepare(`INSERT INTO consignment_commercial_lines(id,document_id,line_no,sales_order_item_id,product_id,consignment_commodity_location_id,lot_code,lot_code_key,consigned_qty_micros,unit_price_cents,version,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`);
    input.lines.forEach((raw, index) => {
      const quantity = qty(raw.consignedQtyMicros); const price = Number(raw.unitPriceCents);
      if (!Number.isSafeInteger(price) || price < 0) throw new HttpError(422, 'unitPriceCents is invalid');
      activeLocation(db, raw.consignmentCommodityLocationId, input.customerId, businessDate);
      const product = db.prepare('SELECT id,tracking_policy,base_uom_code FROM products WHERE id=? AND active=1').get(raw.productId);
      if (!product) throw new HttpError(409, 'Product is unavailable');
      const classification = db.prepare('SELECT sales_enabled,service_classification,active FROM product_commercial_classification WHERE product_id=?').get(product.id);
      if (!classification || !classification.active || !classification.sales_enabled || classification.service_classification) {
        throw new HttpError(409, 'Consignment requires an active physical sales classification', { code: 'CONSIGNMENT_PRODUCT_CLASSIFICATION_INVALID' });
      }
      if (raw.salesOrderItemId) {
        assertSoBackedConsignmentBasis(db, {
          salesOrderItemId: raw.salesOrderItemId, productId: product.id, customerId: input.customerId,
          quantityMicros: quantity, unitPriceCents: price, forUpdate: true,
        });
      }
      if (product.tracking_policy === 'SERIAL' && quantity % 1_000_000 !== 0) throw new HttpError(409, 'Serial quantity must be integral');
      const lotId = raw.lotId || null;
      if (product.tracking_policy === 'LOT' && (!lotId || !db.prepare('SELECT 1 FROM inventory_lots WHERE id=? AND product_id=?').get(lotId, product.id))) throw new HttpError(409, 'Canonical LOT id is required');
      if (product.tracking_policy !== 'LOT' && lotId) throw new HttpError(409, 'LOT is not legal for this product');
      insert.run(randomUUID(), id, index + 1, raw.salesOrderItemId || null, product.id, raw.consignmentCommodityLocationId, lotId, lotId || '', quantity, price, stamp, stamp, actor.id, actor.id);
    });
    audit(db, actor.id, 'CREATE', 'CONSIGNMENT_DOCUMENT', id, no);
    result = { id, documentNo: no, status: 'DRAFT' }; saveIdempotency(db, 'CONSIGNMENT_CREATE', input.customerId, key, fingerprint, result);
  });
  return result;
}

export function instructConsignmentCommand(db, documentId, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required');
  const expected = ver(input.expectedVersion); const businessDate = normalizeBusinessDate(input.businessDate, 'businessDate');
  const fingerprint = requestFingerprint(input); const replay = idempotencyReplay(db, 'CONSIGNMENT_HANDOFF', documentId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    requireWrite(actor);
    const doc = documentRow(db, documentId, actor, true);
    if (doc.status !== 'DRAFT' || Number(doc.version) !== expected) throw new HttpError(409, 'Consignment document state/version conflict');
    const lines = db.prepare(`SELECT * FROM consignment_commercial_lines WHERE document_id=? ORDER BY id${lock(db)}`).all(documentId);
    const allocations = Array.isArray(input.allocations) ? input.allocations : [];
    for (const line of lines) {
      const rows = allocations.filter((row) => row.lineId === line.id);
      if (rows.reduce((sum, row) => sum + qty(row.quantityMicros), 0) !== Number(line.consigned_qty_micros)) throw new HttpError(409, 'Handoff allocation is not conserved');
      const location = activeLocation(db, line.consignment_commodity_location_id, doc.customer_id, businessDate, true);
      const group = `CH:${line.id}:${hash(key).slice(0, 32)}`;
      const sourceWarehouse = db.prepare(`SELECT id,active,bin_enabled FROM warehouses WHERE id=?${lock(db)}`).get(doc.source_warehouse_id);
      if (!sourceWarehouse?.active) throw new HttpError(409, 'Consignment source warehouse is inactive', { code: 'CONSIGNMENT_SOURCE_WAREHOUSE_INVALID' });
      rows.forEach((row, index) => {
        const from = { ...row.fromPosition, productId: line.product_id, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: line.lot_code_key || row.fromPosition?.lotId || null, serialId: row.serialId || row.fromPosition?.serialId || null };
        // The physical MOVE must start inside the warehouse the commercial document
        // declared, at a bin that really belongs to it. Verified before V21 runs.
        if (from.warehouseId !== doc.source_warehouse_id) throw new HttpError(409, 'Handoff source position is outside the declared consignment source warehouse', { code: 'CONSIGNMENT_SOURCE_WAREHOUSE_MISMATCH', expectedWarehouseId: doc.source_warehouse_id, actualWarehouseId: from.warehouseId ?? null });
        if (Number(sourceWarehouse.bin_enabled) === 0 && from.binId) {
          throw new HttpError(409, 'Handoff source bin is invalid for a warehouse without bins', { code: 'CONSIGNMENT_SOURCE_BIN_INVALID' });
        }
        if (from.binId && !db.prepare(`SELECT 1 FROM warehouse_bins WHERE id=? AND warehouse_id=? AND active=1${lock(db)}`).get(from.binId, from.warehouseId)) {
          throw new HttpError(409, 'Handoff source bin is invalid for the declared source warehouse', { code: 'CONSIGNMENT_SOURCE_BIN_INVALID' });
        }
        if (Number(sourceWarehouse.bin_enabled) === 1 && !from.binId) throw new HttpError(409, 'Handoff source bin is required for a bin-enabled source warehouse', { code: 'CONSIGNMENT_SOURCE_BIN_REQUIRED' });
        const to = { ...from, warehouseId: location.physical_warehouse_id, binId: location.physical_bin_id || null };
        runPartitionMutation(db, actor, { sourceType: 'CONSIGNMENT_HANDOFF', sourceId: documentId, sourceItemId: line.id, sourceNo: doc.document_no,
          quantityMicros: qty(row.quantityMicros), from, to, businessDate, movementGroupId: group,
          idempotencyKey: `CONSIGNMENT_HANDOFF:${line.id}:${key}:${index}`, valuationPolicy: 'HANDOFF_VALUE_NEUTRAL_V1' });
      });
      db.prepare('UPDATE consignment_commercial_lines SET handoff_movement_group_id=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND handoff_movement_group_id IS NULL').run(group, now(), actor.id, line.id);
    }
    const stamp = now(); db.prepare("UPDATE consignment_commercial_documents SET status='INSTRUCTED',instructed_at=?,instructed_by=?,version=version+1,updated_at=?,updated_by=? WHERE id=?").run(stamp, actor.id, stamp, actor.id, documentId);
    audit(db, actor.id, 'INSTRUCT', 'CONSIGNMENT_DOCUMENT', documentId, `partitions=${allocations.length}`);
    result = { id: documentId, status: 'INSTRUCTED' }; saveIdempotency(db, 'CONSIGNMENT_HANDOFF', documentId, key, fingerprint, result);
  });
  return result;
}

export function settleConsignmentLineCommand(db, lineId, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required');
  const quantity = qty(input.quantityMicros); const expected = ver(input.expectedVersion); const businessDate = normalizeBusinessDate(input.businessDate, 'businessDate');
  const eventId = `CS:${lineId}:${hash(key)}`; const fingerprint = requestFingerprint(input);
  const replay = idempotencyReplay(db, 'CONSIGNMENT_SETTLEMENT', lineId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    const line = lineRow(db, lineId, actor, true);
    if (!['INSTRUCTED','PARTIAL_SETTLED'].includes(line.document_status) || Number(line.version) !== expected) throw new HttpError(409, 'Consignment line state/version conflict');
    const remaining = Number(line.consigned_qty_micros) - Number(line.settled_qty_micros) - Number(line.returned_qty_micros);
    if (quantity > remaining) throw new HttpError(409, 'Consignment commercial capacity exceeded', { code: 'CONSIGNMENT_CAPACITY_EXCEEDED' });
    const partitions = selectPartitions(db, line, quantity, input.serialIds || []);
    const totalCents = Number(BigInt(line.unit_price_cents) * BigInt(line.consigned_qty_micros) / 1_000_000n);
    const eventCents = lineAmount(totalCents, Number(line.settled_qty_micros) + Number(line.returned_qty_micros), quantity, Number(line.consigned_qty_micros));
    // §35.18.10.4 — a zero-price or sub-cent-zero settlement has no legal economic
    // event. Refuse before any commercial, inventory, tracking, valuation, Finance or
    // audit effect exists, so nothing may be issued out of consigned stock for free.
    if (!Number.isSafeInteger(eventCents) || eventCents <= 0) {
      throw new HttpError(409, 'Consignment settlement amount must be a positive integer number of cents', {
        code: 'CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE', lineId, quantityMicros: quantity, amountCents: eventCents,
      });
    }
    let allocatedMicros = 0; let allocatedCents = 0; let cogs = 0; const inventoryCredits = [];
    partitions.forEach((partition, index) => {
      const nextMicros = allocatedMicros + partition.takeMicros;
      const nextCents = Number(BigInt(eventCents) * BigInt(nextMicros) / BigInt(quantity));
      const partCents = nextCents - allocatedCents;
      const mutation = runPartitionMutation(db, actor, { sourceType: 'CONSIGNMENT_SETTLEMENT', sourceId: eventId, sourceItemId: line.id, sourceNo: line.document_no,
        quantityMicros: partition.takeMicros, from: partition.position, to: null, businessDate,
        movementGroupId: `CSG:${line.id}:${hash(key).slice(0, 32)}`, idempotencyKey: `CONSIGNMENT_SETTLEMENT:${line.id}:${key}:${index}`,
        valuationPolicy: 'SETTLEMENT_COGS_V1', commercialAmountCents: partCents });
      if (!mutation.replayed) { cogs += mutation.valuation.valueCents; inventoryCredits.push({ role: inventoryAccountRole(db, line.product_id), direction: 'CREDIT', amountCents: mutation.valuation.valueCents }); }
      allocatedMicros = nextMicros; allocatedCents = nextCents;
    });
    if (allocatedMicros !== quantity || allocatedCents !== eventCents) throw new HttpError(409, 'Settlement allocation is not conserved');
    if (cogs) createSystemVoucher(db, { sourceType: 'CONSIGNMENT_SETTLEMENT_COGS', sourceId: eventId, businessDate, actorId: actor.id,
      entries: [{ role: 'COGS', direction: 'DEBIT', amountCents: cogs }, ...inventoryCredits] });
    // §35.18.7 — Finance receives the same immutable event identity as the V21 mutation.
// The document number is shared by every settlement on a line and would collapse all
// of them onto one AR open item (`voucher_no` is AR-<sourceNo>).
const finance = recognizeFinanceExposure(db, { side: 'AR', amountCents: eventCents, source: { sourceType: 'CONSIGNMENT_SETTLEMENT', sourceId: eventId, sourceNo: eventId },
      partyId: line.customer_id, businessDate, actorId: actor.id, recognitionMode: RECOGNITION_MODES.DIRECT });
    createSystemVoucher(db, { sourceType: 'CONSIGNMENT_SETTLEMENT', sourceId: eventId, businessDate, actorId: actor.id,
      entries: [{ role: 'ACCOUNTS_RECEIVABLE', direction: 'DEBIT', amountCents: eventCents }, { role: 'SALES_REVENUE', direction: 'CREDIT', amountCents: eventCents }] });
    db.prepare('UPDATE consignment_commercial_lines SET settled_qty_micros=settled_qty_micros+?,settled_amount_cents=settled_amount_cents+?,last_finance_reference_id=?,version=version+1,updated_at=?,updated_by=? WHERE id=?')
      .run(quantity, eventCents, finance?.openItemId || null, now(), actor.id, line.id);
    refreshDocumentState(db, line.document_id); audit(db, actor.id, 'SETTLE', 'CONSIGNMENT_LINE', line.id, `qty=${quantity};amount=${eventCents}`);
    result = { id: line.id, quantityMicros: quantity, amountCents: eventCents, financeOpenItemId: finance?.openItemId || null };
    saveIdempotency(db, 'CONSIGNMENT_SETTLEMENT', lineId, key, fingerprint, result);
  }); return result;
}

export function returnConsignmentLineCommand(db, lineId, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required');
  const quantity = qty(input.quantityMicros); const expected = ver(input.expectedVersion); const businessDate = normalizeBusinessDate(input.businessDate, 'businessDate');
  const sourceId = `CR:${lineId}:${hash(key)}`; const fingerprint = requestFingerprint(input);
  const replay = idempotencyReplay(db, 'CONSIGNMENT_RETURN', lineId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    requireWrite(actor);
    const line = lineRow(db, lineId, actor, true);
    if (!['INSTRUCTED','PARTIAL_SETTLED'].includes(line.document_status) || Number(line.version) !== expected) throw new HttpError(409, 'Consignment line state/version conflict');
    const remaining = Number(line.consigned_qty_micros) - Number(line.settled_qty_micros) - Number(line.returned_qty_micros);
    if (quantity > remaining) throw new HttpError(409, 'Consignment commercial capacity exceeded', { code: 'CONSIGNMENT_CAPACITY_EXCEEDED' });
    const destination = lockReturnDestination(db, input.destinationWarehouseId, input.destinationBinId || null);
    const partitions = selectPartitions(db, line, quantity, input.serialIds || []);
    const totalCents = Number(BigInt(line.unit_price_cents) * BigInt(line.consigned_qty_micros) / 1_000_000n);
    const returnCents = lineAmount(totalCents, Number(line.settled_qty_micros) + Number(line.returned_qty_micros), quantity, Number(line.consigned_qty_micros));
    let allocatedMicros = 0; let allocatedCents = 0;
    partitions.forEach((partition, index) => {
      const to = { ...snapshotPosition(partition.position), warehouseId: destination.warehouse.id, binId: destination.binId };
      const nextMicros = allocatedMicros + partition.takeMicros;
      const nextCents = Number(BigInt(returnCents) * BigInt(nextMicros) / BigInt(quantity));
      const partCents = nextCents - allocatedCents;
      runPartitionMutation(db, actor, { sourceType: 'CONSIGNMENT_RETURN', sourceId, sourceItemId: line.id, sourceNo: line.document_no,
        quantityMicros: partition.takeMicros, from: partition.position, to, businessDate,
        movementGroupId: `CRG:${line.id}:${hash(key).slice(0, 32)}`, idempotencyKey: `CONSIGNMENT_RETURN:${line.id}:${key}:${index}`,
        valuationPolicy: 'RETURN_VALUE_NEUTRAL_V1', commercialAmountCents: partCents });
      allocatedMicros = nextMicros; allocatedCents = nextCents;
    });
    if (allocatedMicros !== quantity || allocatedCents !== returnCents) throw new HttpError(409, 'Return allocation is not conserved');
    db.prepare('UPDATE consignment_commercial_lines SET returned_qty_micros=returned_qty_micros+?,returned_amount_cents=returned_amount_cents+?,version=version+1,updated_at=?,updated_by=? WHERE id=?')
      .run(quantity, returnCents, now(), actor.id, line.id);
    refreshDocumentState(db, line.document_id); audit(db, actor.id, 'RETURN', 'CONSIGNMENT_LINE', line.id, `qty=${quantity}`);
    result = { id: line.id, quantityMicros: quantity, returnAmountCents: returnCents };
    saveIdempotency(db, 'CONSIGNMENT_RETURN', lineId, key, fingerprint, result);
  }); return result;
}

export function cancelConsignmentDocumentCommand(db, documentId, expectedVersion, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required'); const expected = ver(expectedVersion);
  const fingerprint = requestFingerprint({ expectedVersion: expected }); const replay = idempotencyReplay(db, 'CONSIGNMENT_CANCEL', documentId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result; transaction(db, () => { const doc = documentRow(db, documentId, actor, true);
    if (doc.status !== 'DRAFT' || Number(doc.version) !== expected || db.prepare('SELECT 1 FROM consignment_commercial_lines WHERE document_id=? AND handoff_movement_group_id IS NOT NULL').get(documentId)) throw new HttpError(409, 'Only an untouched DRAFT may be cancelled');
    const stamp = now(); db.prepare("UPDATE consignment_commercial_documents SET status='CANCELLED',cancelled_at=?,cancelled_by=?,version=version+1,updated_at=?,updated_by=? WHERE id=?").run(stamp, actor.id, stamp, actor.id, documentId);
    audit(db, actor.id, 'CANCEL', 'CONSIGNMENT_DOCUMENT', documentId, ''); result = { id: documentId, status: 'CANCELLED' }; saveIdempotency(db, 'CONSIGNMENT_CANCEL', documentId, key, fingerprint, result);
  }); return result;
}

export function updateConsignmentLocationCommand(db, locationId, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required'); const expected = ver(input.expectedVersion);
  const fingerprint = requestFingerprint(input); const replay = idempotencyReplay(db, 'CONSIGNMENT_LOCATION_UPDATE', locationId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    const row = db.prepare(`SELECT * FROM consignment_commodity_locations WHERE id=?${lock(db)}`).get(locationId);
    if (!row || Number(row.version) !== expected) throw new HttpError(409, 'Consignment location version conflict');
    const nextWarehouse = input.physicalWarehouseId || row.physical_warehouse_id;
    const nextBin = input.physicalBinId === undefined ? row.physical_bin_id : input.physicalBinId || null;
    const nextActive = input.active === undefined ? Number(row.active) : input.active ? 1 : 0;
    const mappingChanges = nextWarehouse !== row.physical_warehouse_id || nextBin !== row.physical_bin_id || nextActive !== Number(row.active);
    if (mappingChanges && db.prepare(`SELECT 1 FROM consignment_commercial_lines l
      WHERE l.consignment_commodity_location_id=? AND l.handoff_movement_group_id IS NOT NULL
        AND l.consigned_qty_micros-l.settled_qty_micros-l.returned_qty_micros>0 LIMIT 1`).get(locationId)) {
      throw new HttpError(409, 'Location mapping has outstanding consigned inventory', { code: 'CONSIGNMENT_LOCATION_HAS_OUTSTANDING_STOCK' });
    }
    const warehouse = db.prepare('SELECT active,bin_enabled FROM warehouses WHERE id=?').get(nextWarehouse);
    if (!warehouse?.active || (Number(warehouse.bin_enabled) === 1 && !nextBin)) throw new HttpError(409, 'Physical warehouse/bin mapping is invalid');
    if (nextBin && !db.prepare('SELECT 1 FROM warehouse_bins WHERE id=? AND warehouse_id=? AND active=1').get(nextBin, nextWarehouse)) throw new HttpError(409, 'Physical bin mapping is invalid');
    db.prepare(`UPDATE consignment_commodity_locations SET name=?,address_text=?,physical_warehouse_id=?,physical_bin_id=?,active=?,effective_to=?,version=version+1,updated_at=?,updated_by=? WHERE id=?`)
      .run(input.name === undefined ? row.name : String(input.name).trim(), input.addressText === undefined ? row.address_text : String(input.addressText), nextWarehouse, nextBin, nextActive, input.effectiveTo === undefined ? row.effective_to : input.effectiveTo || null, now(), actor.id, locationId);
    audit(db, actor.id, nextActive ? 'UPDATE' : 'DEACTIVATE', 'CONSIGNMENT_LOCATION', locationId, '');
    result = db.prepare('SELECT * FROM consignment_commodity_locations WHERE id=?').get(locationId);
    saveIdempotency(db, 'CONSIGNMENT_LOCATION_UPDATE', locationId, key, fingerprint, result);
  }); return result;
}

export function updateConsignmentDocumentCommand(db, documentId, input, actor, key) {
  requireWrite(actor); if (!key) throw new HttpError(422, 'Idempotency-Key is required'); const expected = ver(input.expectedVersion);
  const fingerprint = requestFingerprint(input); const replay = idempotencyReplay(db, 'CONSIGNMENT_DOCUMENT_UPDATE', documentId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    const row = documentRow(db, documentId, actor, true);
    if (row.status !== 'DRAFT' || Number(row.version) !== expected) throw new HttpError(409, 'Only the current DRAFT document may be edited');
    const businessDate = input.businessDate === undefined ? row.business_date : normalizeBusinessDate(input.businessDate, 'businessDate');
    const instructionDate = input.instructionDate === undefined ? row.instruction_date : normalizeBusinessDate(input.instructionDate, 'instructionDate');
    db.prepare('UPDATE consignment_commercial_documents SET business_date=?,instruction_date=?,version=version+1,updated_at=?,updated_by=? WHERE id=?')
      .run(businessDate, instructionDate, now(), actor.id, documentId);
    audit(db, actor.id, 'UPDATE', 'CONSIGNMENT_DOCUMENT', documentId, 'header');
    result = documentRow(db, documentId, actor);
    saveIdempotency(db, 'CONSIGNMENT_DOCUMENT_UPDATE', documentId, key, fingerprint, result);
  }); return result;
}

export function listConsignmentDocuments(db, res, actor) { requireRead(actor); const rows = db.prepare('SELECT * FROM consignment_commercial_documents ORDER BY business_date DESC,created_at DESC').all().filter((row) => { try { scope(db, actor, row); return true; } catch (error) { if (error.status === 403) return false; throw error; } }); return send(res, 200, { documents: rows }); }
export function getConsignmentDocument(db, res, actor, id) { requireRead(actor); const document = documentRow(db, id, actor); const lines = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=? ORDER BY line_no').all(id).map((line) => ({ ...line, partitions: line.handoff_movement_group_id ? resolveConsignmentHandoffEvidence(db, line.id) : [] })); return send(res, 200, { document: { ...document, lines } }); }
export function getConsignmentRemaining(db, res, actor, id) { requireRead(actor); const document = documentRow(db, id, actor); const lines = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=? ORDER BY line_no').all(id).map((line) => ({ lineId: line.id, commercialRemainingMicros: Number(line.consigned_qty_micros) - Number(line.settled_qty_micros) - Number(line.returned_qty_micros), partitions: line.handoff_movement_group_id ? resolveConsignmentHandoffEvidence(db, line.id) : [] })); return send(res, 200, { documentId: document.id, lines }); }
export function getConsignmentHandoffPositionReferences(db, res, actor, documentId) {
  requireWrite(actor);
  const document = referenceDocumentRow(db, documentId, actor);
  if (document.status !== 'DRAFT') throw new HttpError(409, 'Consignment document cannot be handed off', { code: 'CONSIGNMENT_REFERENCE_STATE_CONFLICT' });
  const warehouse = db.prepare('SELECT id,code,name,active,bin_enabled FROM warehouses WHERE id=?').get(document.source_warehouse_id);
  if (!warehouse?.active) throw new HttpError(409, 'Consignment source warehouse is invalid', { code: 'CONSIGNMENT_SOURCE_WAREHOUSE_INVALID' });
  const projected = projectWarehouseReference(db, warehouse);
  if (projected.binEnabled && projected.bins.length === 0) throw new HttpError(409, 'Active source bins are unavailable', { code: 'CONSIGNMENT_REFERENCE_BINS_UNAVAILABLE' });
  return send(res, 200, {
    purpose: 'HANDOFF',
    context: { documentId: document.id, documentVersion: Number(document.version), documentStatus: document.status },
    warehouse: { id: projected.id, code: projected.code, name: projected.name, binEnabled: projected.binEnabled },
    bins: projected.bins,
  });
}
export function getConsignmentReturnPositionReferences(db, res, actor, documentId, lineId) {
  requireWrite(actor);
  const document = referenceDocumentRow(db, documentId, actor);
  const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE id=? AND document_id=?').get(lineId, document.id);
  if (!line) throw referenceNotFound();
  const remaining = Number(line.consigned_qty_micros) - Number(line.settled_qty_micros) - Number(line.returned_qty_micros);
  if (!['INSTRUCTED', 'PARTIAL_SETTLED'].includes(document.status) || remaining <= 0) {
    throw new HttpError(409, 'Consignment line cannot be returned', { code: 'CONSIGNMENT_REFERENCE_STATE_CONFLICT' });
  }
  const evidence = resolveConsignmentHandoffEvidence(db, line.id);
  if (!evidence.some((row) => row.remainingMicros > 0)) throw new HttpError(409, 'Handoff evidence has no remaining entitlement', { code: 'CONSIGNMENT_HANDOFF_EVIDENCE_UNAVAILABLE' });
  const warehouses = returnWarehouseCandidates(db);
  if (!warehouses.length) throw new HttpError(409, 'Return destinations are unavailable', { code: 'CONSIGNMENT_RETURN_DESTINATION_UNAVAILABLE' });
  return send(res, 200, {
    purpose: 'RETURN',
    context: {
      documentId: document.id, documentVersion: Number(document.version), documentStatus: document.status,
      lineId: line.id, lineVersion: Number(line.version),
    },
    warehouses,
  });
}
export function listConsignmentLocations(db, res, actor) { requireRead(actor); return send(res, 200, { locations: db.prepare('SELECT * FROM consignment_commodity_locations ORDER BY customer_id,location_code').all() }); }
export async function createConsignmentLocation(db, req, res, actor) { const body = await readJson(req); return send(res, 201, { location: createConsignmentLocationCommand(db, body, actor, String(req.headers['idempotency-key'] || '').trim()) }); }
export async function updateConsignmentLocation(db, req, res, actor, id) { const body = await readJson(req); return send(res, 200, { location: updateConsignmentLocationCommand(db, id, body, actor, String(req.headers['idempotency-key'] || '').trim()) }); }
export async function createConsignmentDocument(db, req, res, actor) { const body = await readJson(req); return send(res, 201, createConsignmentDocumentCommand(db, body, actor, String(req.headers['idempotency-key'] || '').trim())); }
export async function updateConsignmentDocument(db, req, res, actor, id) { const body = await readJson(req); return send(res, 200, { document: updateConsignmentDocumentCommand(db, id, body, actor, String(req.headers['idempotency-key'] || '').trim()) }); }
export async function consignmentDocumentAction(db, req, res, actor, id, action) { const body = await readJson(req); const key = String(req.headers['idempotency-key'] || '').trim(); const value = action === 'instruct' ? instructConsignmentCommand(db, id, body, actor, key) : cancelConsignmentDocumentCommand(db, id, body.expectedVersion, actor, key); return send(res, 200, value); }
export async function consignmentLineAction(db, req, res, actor, id, action) { const body = await readJson(req); const key = String(req.headers['idempotency-key'] || '').trim(); const value = action === 'settle' ? settleConsignmentLineCommand(db, id, body, actor, key) : returnConsignmentLineCommand(db, id, body, actor, key); return send(res, 200, value); }
// §35.18.8 — the three-layer report is CHECK-only. It never repairs, backfills or
// infers history: an unprovable layer is reported as an explicit discrepancy.
function evidenceState(db, row) {
  if (!row.handoffMovementGroupId) return { physicalEvidenceState: 'NOT_HANDED_OFF', physicalEvidenceDiscrepancy: null, partitionEntitlementMicros: 0 };
  let partitions;
  try {
    partitions = resolveConsignmentHandoffEvidence(db, row.lineId);
  } catch (error) {
    return { physicalEvidenceState: 'DISCREPANCY', physicalEvidenceDiscrepancy: error?.code || 'CONSIGNMENT_HANDOFF_EVIDENCE_UNAVAILABLE', partitionEntitlementMicros: null };
  }
  const entitlement = partitions.reduce((sum, partition) => sum + partition.remainingMicros, 0);
  const commercialRemaining = Number(row.consignedQtyMicros) - Number(row.settledQtyMicros) - Number(row.returnedQtyMicros);
  const discrepancies = [];
  if (entitlement !== commercialRemaining) discrepancies.push('PARTITION_ENTITLEMENT_DIFFERS_FROM_COMMERCIAL');
  if (partitions.length) {
    const warehouseIds = [...new Set(partitions.map((partition) => partition.position.warehouseId))];
    const physical = db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM inventory WHERE product_id=? AND warehouse_id IN (${warehouseIds.map(() => '?').join(',')})
      AND owner_type='ENTERPRISE' AND owner_id IS NULL AND stock_status='AVAILABLE'`).get(row.productId, ...warehouseIds);
    if (Math.round(Number(physical.quantity) * 1_000_000) < entitlement) discrepancies.push('PHYSICAL_BALANCE_BELOW_PARTITION_ENTITLEMENT');
  }
  const finance = db.prepare(`SELECT COUNT(*) n FROM account_receivables WHERE source_type='CONSIGNMENT_SETTLEMENT' AND source_id IN (
    SELECT source_id FROM inventory_mutation_log WHERE source_type='CONSIGNMENT_SETTLEMENT' AND source_item_id=?)`).get(row.lineId).n;
  if (Number(row.settledQtyMicros) > 0 && Number(finance) < 1) discrepancies.push('FINANCE_AR_EVIDENCE_MISSING');
  return {
    physicalEvidenceState: discrepancies.length ? 'DISCREPANCY' : 'RESOLVED',
    physicalEvidenceDiscrepancy: discrepancies.length ? discrepancies.join(';') : null,
    partitionEntitlementMicros: entitlement,
  };
}

export function consignmentReport(db, res, actor) {
  requireRead(actor); let rows;
  transaction(db, () => {
    rows = db.prepare(`SELECT d.id documentId,d.document_no documentNo,d.status,d.customer_id customerId,d.sales_group_id salesGroupId,d.business_date businessDate,l.id lineId,l.product_id productId,l.consigned_qty_micros consignedQtyMicros,l.settled_qty_micros settledQtyMicros,l.returned_qty_micros returnedQtyMicros,l.settled_amount_cents settledAmountCents,l.last_finance_reference_id financeReferenceId,l.handoff_movement_group_id handoffMovementGroupId FROM consignment_commercial_documents d JOIN consignment_commercial_lines l ON l.document_id=d.id ORDER BY d.business_date DESC,d.id,l.line_no`).all()
      .filter((row) => { try { scope(db, actor, { sales_group_id: row.salesGroupId, business_date: row.businessDate }); return true; } catch (error) { if (error.status === 403) return false; throw error; } })
      .map((row) => ({
        ...row,
        ...evidenceState(db, row),
        commercialRemainingMicros: Number(row.consignedQtyMicros) - Number(row.settledQtyMicros) - Number(row.returnedQtyMicros),
        ownership: 'ENTERPRISE',
      }));
    audit(db, actor.id, 'REPORT_QUERY', 'CONSIGNMENT_REPORT', 'CURRENT', `rows=${rows.length}`);
  });
  return send(res, 200, { rows });
}
