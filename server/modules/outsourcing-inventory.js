import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { postCanonicalTrackedLeg } from './traceability-quality.js';
import { issueValue, receiveValue } from './financial-inventory.js';

const EPS = 1e-9;

function codedConflict(code, message) {
  return new HttpError(409, message, { code });
}

function fingerprint(value) {
  return `V1:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function resolveOutsourcingIdentity(db, productId, { lotId = null, serialId = null } = {}) {
  const product = db.prepare('SELECT id,tracking_policy,base_uom_code,unit FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(404, '委外物料不存在或已停用');
  const policy = String(product.tracking_policy || 'NONE').toUpperCase();
  if (policy === 'LOT') {
    if (!lotId || serialId) throw codedConflict('WIP_IDENTITY_EVIDENCE_MISSING', 'LOT 物料必须提供唯一批次身份');
    const lot = db.prepare('SELECT id,product_id FROM inventory_lots WHERE id=?').get(lotId);
    if (!lot || lot.product_id !== productId) throw codedConflict('WIP_IDENTITY_POLICY_MISMATCH', 'LOT 与物料不匹配');
    return { identityKey: `LOT:${lotId}`, identityType: 'LOT', lotId, serialId: null, evidenceState: 'TRACKED' };
  }
  if (policy === 'SERIAL') {
    if (!serialId || lotId) throw codedConflict('WIP_IDENTITY_EVIDENCE_MISSING', 'SERIAL 物料必须提供唯一序列号身份');
    const serial = db.prepare('SELECT id,product_id FROM inventory_serials WHERE id=?').get(serialId);
    if (!serial || serial.product_id !== productId) throw codedConflict('WIP_IDENTITY_POLICY_MISMATCH', 'SERIAL 与物料不匹配');
    return { identityKey: `SERIAL:${serialId}`, identityType: 'SERIAL', lotId: null, serialId, evidenceState: 'TRACKED' };
  }
  if (lotId || serialId) throw codedConflict('WIP_IDENTITY_POLICY_MISMATCH', '非跟踪物料不得携带 LOT/SERIAL 身份');
  return { identityKey: 'NONE', identityType: 'NONE', lotId: null, serialId: null, evidenceState: 'QUANTITY_ONLY' };
}

function assertUnit(product, unitCode) {
  const canonical = String(product.base_uom_code || product.unit || 'EA').toUpperCase();
  if (String(unitCode || canonical).toUpperCase() !== canonical) {
    throw codedConflict('OUTSOURCING_WIP_UOM_MISMATCH', '委外物料单位与产品基础单位不一致');
  }
  return canonical;
}

export function resolveOutsourcingWarehouses(db, order, material) {
  const supplier = db.prepare('SELECT id,supplier_wip_warehouse_id FROM suppliers WHERE id=? AND active=1').get(order.supplier_id);
  if (!supplier?.supplier_wip_warehouse_id) {
    throw codedConflict('OUTSOURCING_WIP_WAREHOUSE_MISSING', '供应商未配置委外 WIP 仓库');
  }
  if (!material.source_warehouse_id) {
    throw codedConflict('OUTSOURCING_WIP_SOURCE_WAREHOUSE_UNPROVEN', '物料行缺少已验证来源仓绑定');
  }
  for (const warehouseId of [material.source_warehouse_id, supplier.supplier_wip_warehouse_id]) {
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) {
      throw codedConflict('OUTSOURCING_WIP_WAREHOUSE_MISSING', '委外来源仓或供应商 WIP 仓不存在/已停用');
    }
  }
  return { sourceWarehouseId: material.source_warehouse_id, wipWarehouseId: supplier.supplier_wip_warehouse_id };
}

function effectRow(db, materialListId, identityKey) {
  return db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key=?').get(materialListId, identityKey);
}

function recordSupply(db, { material, identity, eventType, eventId, eventItemId, quantity, businessDate, idempotencyKey }) {
  const existing = db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE idempotency_key=?').get(idempotencyKey);
  const requestFingerprint = fingerprint({ materialListId: material.id, identityKey: identity.identityKey, eventType, eventId, eventItemId, quantity, businessDate });
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) throw codedConflict('INVENTORY_MUTATION_UNEXPECTED_REPLAY', 'WIP 身份供给幂等键发生非预期重放');
    return existing;
  }
  const now = new Date().toISOString();
  const effectId = randomUUID();
  db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
    id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
    event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at
  ) VALUES(?,?,?,?,?,?,'SUPPLY',?,?,?,?,NULL,?,?,?,?)`).run(
    effectId, material.id, identity.identityKey, identity.identityType, identity.lotId, identity.serialId,
    quantity, eventType, eventId, eventItemId, businessDate, idempotencyKey, requestFingerprint, now,
  );
  const current = effectRow(db, material.id, identity.identityKey);
  const supplied = Number(current?.supplied_quantity || 0) + quantity;
  const consumed = Number(current?.consumed_quantity || 0);
  db.prepare(`INSERT INTO outsourcing_wip_identity_balances(
    material_list_id,identity_key,identity_type,lot_id,serial_id,evidence_state,
    supplied_quantity,consumed_quantity,available_quantity,last_effect_id,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(material_list_id,identity_key) DO UPDATE SET
    supplied_quantity=excluded.supplied_quantity,consumed_quantity=excluded.consumed_quantity,
    available_quantity=excluded.available_quantity,last_effect_id=excluded.last_effect_id,updated_at=excluded.updated_at`).run(
    material.id, identity.identityKey, identity.identityType, identity.lotId, identity.serialId,
    identity.evidenceState, supplied, consumed, supplied - consumed, effectId, current?.created_at || now, now,
  );
  return db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE id=?').get(effectId);
}

function recordConsumption(db, { material, identity, eventType, eventId, eventItemId, quantity, businessDate, idempotencyKey }) {
  const existing = db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE idempotency_key=?').get(idempotencyKey);
  const requestFingerprint = fingerprint({ materialListId: material.id, identityKey: identity.identityKey, eventType, eventId, eventItemId, quantity, businessDate });
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) throw codedConflict('INVENTORY_MUTATION_UNEXPECTED_REPLAY', 'WIP 身份消费幂等键发生非预期重放');
    return existing;
  }
  const balance = effectRow(db, material.id, identity.identityKey);
  if (!balance || Number(balance.available_quantity) + EPS < quantity) {
    throw codedConflict('WIP_IDENTITY_EVIDENCE_MISSING', '本订单对应身份的可用 WIP 不足');
  }
  if ((identity.identityType === 'NONE' && balance.evidence_state !== 'QUANTITY_ONLY')
      || (identity.identityType !== 'NONE' && balance.evidence_state !== 'TRACKED')) {
    throw codedConflict('WIP_IDENTITY_POLICY_MISMATCH', 'WIP 身份证据与产品跟踪策略不一致');
  }
  const supplies = db.prepare(`SELECT e.*,
    e.signed_quantity-COALESCE((SELECT SUM(a.allocated_quantity) FROM outsourcing_wip_identity_effect_allocations a WHERE a.source_supply_effect_id=e.id),0) remaining
    FROM outsourcing_wip_identity_effects e
    WHERE e.material_list_id=? AND e.identity_key=? AND e.effect_direction='SUPPLY'
    ORDER BY e.created_at,e.id`).all(material.id, identity.identityKey);
  let remaining = quantity;
  const allocations = [];
  for (const supply of supplies) {
    const available = Number(supply.remaining);
    if (available <= EPS) continue;
    const allocated = Math.min(remaining, available);
    allocations.push({ sourceEffectId: supply.id, quantity: allocated });
    remaining -= allocated;
    if (remaining <= EPS) break;
  }
  if (remaining > EPS) throw codedConflict('WIP_IDENTITY_EVIDENCE_MISSING', 'WIP 供给身份证据无法覆盖本次消费');
  const now = new Date().toISOString();
  const effectId = randomUUID();
  db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
    id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
    event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at
  ) VALUES(?,?,?,?,?,?,'CONSUME',?,?,?,?,NULL,?,?,?,?)`).run(
    effectId, material.id, identity.identityKey, identity.identityType, identity.lotId, identity.serialId,
    -quantity, eventType, eventId, eventItemId, businessDate, idempotencyKey, requestFingerprint, now,
  );
  const insertAllocation = db.prepare(`INSERT INTO outsourcing_wip_identity_effect_allocations(
    id,effect_id,source_supply_effect_id,allocation_kind,allocated_quantity,created_at
  ) VALUES(?,?,?,'CONSUMPTION',?,?)`);
  for (const allocation of allocations) insertAllocation.run(randomUUID(), effectId, allocation.sourceEffectId, allocation.quantity, now);
  const consumed = Number(balance.consumed_quantity) + quantity;
  db.prepare(`UPDATE outsourcing_wip_identity_balances SET consumed_quantity=?,available_quantity=supplied_quantity-?,last_effect_id=?,updated_at=?
    WHERE material_list_id=? AND identity_key=?`).run(consumed, consumed, effectId, now, material.id, identity.identityKey);
  return db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE id=?').get(effectId);
}

function postTrackingAndValuation(db, mutation, { sourceType, sourceId, sourceItemId, productId, identity, quantity, businessDate, moveValue = true }) {
  if (mutation.replayed) return { replayed: true, issuedValueCents: 0 };
  for (const movement of mutation.movements) {
    postCanonicalTrackedLeg(db, {
      transactionId: movement.transactionId, sourceType, sourceId, sourceItemId,
      productId, warehouseId: movement.direction === 'OUT' ? mutation.fromWarehouseId : mutation.toWarehouseId,
      lotId: identity.lotId, serialId: identity.serialId, quantity, direction: movement.direction, businessDate,
    });
  }
  const out = mutation.movements.find((movement) => movement.direction === 'OUT');
  const inbound = mutation.movements.find((movement) => movement.direction === 'IN');
  let issuedValueCents = 0;
  if (out) {
    const issued = issueValue(db, {
      businessDate, productId, warehouseId: mutation.fromWarehouseId, lotId: identity.lotId, serialId: identity.serialId,
      quantity, movementType: sourceType, sourceType, sourceId, sourceItemId,
      inventoryTransactionId: out.transactionId,
    });
    if (issued.valuationMethod === 'LEGACY_UNVALUED') throw codedConflict('OUTSOURCING_VALUATION_UNVERIFIED', '委外物料缺少权威估值余额');
    issuedValueCents = -Number(issued.valueDeltaCents);
  }
  if (inbound && moveValue) {
    const received = receiveValue(db, {
      businessDate, productId, warehouseId: mutation.toWarehouseId, lotId: identity.lotId, serialId: identity.serialId,
      quantity, valueCents: issuedValueCents, movementType: `${sourceType}_WIP_IN`, sourceType, sourceId, sourceItemId,
      inventoryTransactionId: inbound.transactionId, valuationBasis: 'ORIGINAL_COST',
    });
    if (received.valuationMethod === 'LEGACY_UNVALUED') throw codedConflict('OUTSOURCING_VALUATION_UNVERIFIED', '委外 WIP 入库未形成权威估值');
  }
  for (const movement of mutation.movements) {
    const tx = db.prepare('SELECT valuation_status FROM inventory_transactions WHERE id=?').get(movement.transactionId);
    const valuation = db.prepare("SELECT status FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'").get(movement.transactionId);
    if (tx?.valuation_status !== 'VALUED' || !valuation) {
      throw codedConflict('OUTSOURCING_VALUATION_UNVERIFIED', '委外库存腿未完成权威估值');
    }
  }
  return { replayed: false, issuedValueCents };
}

export function executeOutsourcingMove(db, {
  actor, order, material, sourceType, eventType, eventId, quantity, businessDate,
  identityInput, direction, idempotencyKey,
}) {
  const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(material.product_id);
  if (!product) throw new HttpError(404, '委外物料不存在或已停用');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  if (product.tracking_policy === 'SERIAL' && Math.abs(quantity - 1) > EPS) {
    throw codedConflict('WIP_IDENTITY_POLICY_MISMATCH', 'SERIAL 物料每次执行数量必须为 1');
  }
  assertUnit(product, material.unit);
  const identity = resolveOutsourcingIdentity(db, material.product_id, identityInput);
  const { sourceWarehouseId, wipWarehouseId } = resolveOutsourcingWarehouses(db, order, material);
  const fromWarehouseId = direction === 'SUPPLY' ? sourceWarehouseId : wipWarehouseId;
  const toWarehouseId = direction === 'SUPPLY' ? wipWarehouseId : sourceWarehouseId;
  const mutationKey = `${sourceType}:${eventId}:${material.id}:MOVE:${identity.identityKey}`;
  const mutation = applyInventoryMutation({
    db, actor, sourceType, sourceId: eventId, sourceItemId: material.id,
    sourceNo: order.order_no, movementKind: 'MOVE', movementGroupId: eventId,
    quantity, businessDate, idempotencyKey: mutationKey,
    fromPosition: { productId: material.product_id, warehouseId: fromWarehouseId, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: identity.lotId, serialId: identity.serialId },
    toPosition: { productId: material.product_id, warehouseId: toWarehouseId, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: identity.lotId, serialId: identity.serialId },
    trackingMode: 'EXTERNAL', valuationMode: 'EXTERNAL',
    ...(direction === 'SUPPLY' ? { insufficientStockCode: 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT' } : {}),
  });
  mutation.fromWarehouseId = fromWarehouseId;
  mutation.toWarehouseId = toWarehouseId;
  const valuation = postTrackingAndValuation(db, mutation, {
    sourceType, sourceId: eventId, sourceItemId: material.id, productId: material.product_id,
    identity, quantity, businessDate,
  });
  const effectKey = `${eventType}:${eventId}:${material.id}:${identity.identityKey}`;
  const effect = direction === 'SUPPLY'
    ? recordSupply(db, { material, identity, eventType, eventId, eventItemId: material.id, quantity, businessDate, idempotencyKey: effectKey })
    : recordConsumption(db, { material, identity, eventType, eventId, eventItemId: material.id, quantity, businessDate, idempotencyKey: effectKey });
  return { mutation, valuation, effect, identity, fromWarehouseId, toWarehouseId };
}

export function executeOutsourcingBackflush(db, {
  actor, order, material, receipt, quantity, businessDate, identityInput,
}) {
  const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(material.product_id);
  if (!product) throw new HttpError(404, '委外物料不存在或已停用');
  assertUnit(product, material.unit);
  const identity = resolveOutsourcingIdentity(db, material.product_id, identityInput);
  const { wipWarehouseId } = resolveOutsourcingWarehouses(db, order, material);
  const sourceType = 'OUTSOURCING_BACKFLUSH';
  const mutationKey = `${sourceType}:${receipt.id}:${material.id}:OUT:${identity.identityKey}`;
  const mutation = applyInventoryMutation({
    db, actor, sourceType, sourceId: receipt.id, sourceItemId: material.id,
    sourceNo: receipt.receipt_no, movementKind: 'OUT', movementGroupId: receipt.id,
    quantity, businessDate, idempotencyKey: mutationKey,
    fromPosition: { productId: material.product_id, warehouseId: wipWarehouseId, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: identity.lotId, serialId: identity.serialId },
    trackingMode: 'EXTERNAL', valuationMode: 'EXTERNAL',
  });
  mutation.fromWarehouseId = wipWarehouseId;
  mutation.toWarehouseId = null;
  const valuation = postTrackingAndValuation(db, mutation, {
    sourceType, sourceId: receipt.id, sourceItemId: material.id, productId: material.product_id,
    identity, quantity, businessDate, moveValue: false,
  });
  const effect = recordConsumption(db, {
    material, identity, eventType: 'BACKFLUSH', eventId: receipt.id, eventItemId: material.id,
    quantity, businessDate, idempotencyKey: `BACKFLUSH:${receipt.id}:${material.id}:${identity.identityKey}`,
  });
  return { mutation, valuation, effect, identity, wipWarehouseId };
}

export function receiveOutsourcingFinishedGoods(db, {
  actor, order, receipt, item, valueCents, businessDate,
}) {
  const identity = resolveOutsourcingIdentity(db, item.product_id, { lotId: item.lot_id, serialId: item.serial_id });
  const mutationKey = `OUTSOURCING_RECEIPT:${receipt.id}:${item.id}:IN:${identity.identityKey}`;
  const mutation = applyInventoryMutation({
    db, actor, sourceType: 'OUTSOURCING_RECEIPT', sourceId: receipt.id, sourceItemId: item.id,
    sourceNo: receipt.receipt_no, movementKind: 'IN', movementGroupId: receipt.id,
    quantity: Number(item.quantity), businessDate, idempotencyKey: mutationKey,
    toPosition: { productId: item.product_id, warehouseId: receipt.warehouse_id, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: identity.lotId, serialId: identity.serialId },
    trackingMode: 'EXTERNAL', valuationMode: 'EXTERNAL',
  });
  if (!mutation.replayed) {
    const inbound = mutation.movements.find((movement) => movement.direction === 'IN');
    postCanonicalTrackedLeg(db, {
      transactionId: inbound.transactionId, sourceType: 'OUTSOURCING_RECEIPT', sourceId: receipt.id, sourceItemId: item.id,
      productId: item.product_id, warehouseId: receipt.warehouse_id, lotId: identity.lotId, serialId: identity.serialId,
      quantity: Number(item.quantity), direction: 'IN', businessDate,
    });
    receiveValue(db, {
      businessDate, productId: item.product_id, warehouseId: receipt.warehouse_id,
      lotId: identity.lotId, serialId: identity.serialId, quantity: Number(item.quantity), valueCents,
      movementType: 'OUTSOURCING_RECEIPT', sourceType: 'OUTSOURCING_RECEIPT', sourceId: receipt.id,
      sourceItemId: item.id, inventoryTransactionId: inbound.transactionId, valuationBasis: 'OUTSOURCING_ACTUAL_COST',
    });
    const tx = db.prepare('SELECT valuation_status FROM inventory_transactions WHERE id=?').get(inbound.transactionId);
    const valuation = db.prepare("SELECT status FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'").get(inbound.transactionId);
    if (tx?.valuation_status !== 'VALUED' || !valuation) throw codedConflict('OUTSOURCING_VALUATION_UNVERIFIED', '委外成品入库未完成权威估值');
  }
  return { mutation, identity };
}
