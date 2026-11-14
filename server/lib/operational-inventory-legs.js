// W10-INV-RISK-01 —— 运营库存腿解析与写入编排。
//
// 它**不是**第二个 mutation owner：数量变化始终只由 `applyInventoryMutation()`
// 完成。本模块只负责两件事：
//   1. 把业务单据证据（跟踪分配 / 估值事件）解析成**显式的 canonical legs**，
//      也就是随后真正扣减的那几个 `position_key`；
//   2. 在事务内按稳定顺序逐腿写入，让「可用量判断」与「实际扣减」落在**同一身份**上。
//
// 硬性约束（Requirement `W10-INV-RISK-01`）：
//   - INV-RISK-R01 任何可用量判断必须读取随后实际扣减的同一个 canonical position；
//   - INV-RISK-R02 默认位置固定为 指定仓库 + 产品 + ENTERPRISE + AVAILABLE +
//     null bin / lot / serial，position_key 由 production `computePositionKey()` 生成；
//   - INV-RISK-R03 真正 mutation 必须在同一 transaction 内、写入前重读并锁定权威状态；
//   - INV-RISK-R04 canonical position 不存在时可用量为零；
//   - INV-RISK-R05 扣减后不得为负；
//   - INV-RISK-R06 只扣除同一 position_key 上的 ACTIVE inventory locks；
//   - INV-RISK-R07 不得绕过 LOT / SERIAL 既有 source allocation 与 tracking gate。
//
// 禁止：按 (warehouse_id, product_id) 取任意第一行；跨 owner / status / bin /
// lot / serial 聚合后写回 default position；用 ORDER BY 挑「看起来正确」的行。

import { HttpError } from './http.js';
import { computePositionKey } from './inventory-position.js';
import { applyInventoryMutation } from './inventory-mutation.js';

/** 本轮四条路径的默认运营位置维度。 */
export const DEFAULT_OPERATIONAL_DIMENSIONS = Object.freeze({
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

/**
 * 构造一个 canonical 位置（维度 + position_key）。
 *
 * position_key 一律由 production `computePositionKey()` 生成，本模块不复制
 * 第二套 hash 或维度默认规则。
 */
export function operationalPosition({ productId, warehouseId, lotId = null, serialId = null, binId = null }) {
  const dimensions = {
    productId,
    warehouseId,
    binId: binId ?? DEFAULT_OPERATIONAL_DIMENSIONS.binId,
    ownerType: DEFAULT_OPERATIONAL_DIMENSIONS.ownerType,
    ownerId: DEFAULT_OPERATIONAL_DIMENSIONS.ownerId,
    stockStatus: DEFAULT_OPERATIONAL_DIMENSIONS.stockStatus,
    lotId: lotId ?? DEFAULT_OPERATIONAL_DIMENSIONS.lotId,
    serialId: serialId ?? DEFAULT_OPERATIONAL_DIMENSIONS.serialId,
  };
  return { ...dimensions, positionKey: computePositionKey(dimensions) };
}

/**
 * 读取仓库与产品的跟踪 / 仓位策略。
 *
 * 只读主数据，不读数量。
 */
export function operationalProductPolicy(db, { warehouseId, productId }) {
  const warehouse = db.prepare('SELECT id, bin_enabled, negative_stock_policy FROM warehouses WHERE id=? AND active=1').get(warehouseId);
  if (!warehouse) throw new HttpError(400, `仓库 ${warehouseId} 不存在或已停用`);
  const product = db.prepare('SELECT id, tracking_policy, active FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(400, `产品 ${productId} 不存在`);
  if (!product.active) throw new HttpError(409, `产品 ${productId} 已停用`);
  return {
    warehouse,
    product,
    trackingPolicy: String(product.tracking_policy || 'NONE').toUpperCase(),
    binEnabled: Number(warehouse.bin_enabled) === 1,
  };
}

/**
 * NONE 跟踪产品的默认运营位置。
 *
 * LOT / SERIAL 产品**不能**使用默认位置 —— 它们的身份来自分配证据。
 */
export function resolveDefaultOperationalPosition(db, { warehouseId, productId }) {
  const policy = operationalProductPolicy(db, { warehouseId, productId });
  if (policy.binEnabled) {
    // 本轮四条业务面没有获批的仓位选择合同；不得退回 null-bin。
    throw new HttpError(409, `仓库 ${warehouseId} 启用仓位管理，无法确定唯一的库存位置`);
  }
  if (policy.trackingPolicy !== 'NONE') {
    throw new HttpError(409, `产品 ${productId} 启用了 ${policy.trackingPolicy} 跟踪，必须按分配证据解析库存位置`);
  }
  return operationalPosition({ productId, warehouseId });
}

/**
 * 把跟踪分配证据解析成腿。
 *
 * @param {Array<{lotId?: string|null, serialId?: string|null, quantity?: number}>} allocations
 * @param {number} quantity 业务基础数量；各腿数量之和必须与它相等。
 */
export function resolveAllocatedLegs({ productId, warehouseId, quantity, allocations, trackingPolicy }) {
  const base = Number(quantity);
  if (!Number.isFinite(base) || base <= 0) throw new HttpError(400, '库存数量不合法');
  const rows = (allocations || []).filter((row) => row && (row.lotId || row.serialId));
  if (!rows.length) {
    throw new HttpError(409, `产品 ${productId} 启用了 ${trackingPolicy} 跟踪，但缺少可用的身份分配证据`);
  }
  const legs = [];
  const seenSerials = new Set();
  for (const row of rows) {
    const lotId = row.lotId ?? null;
    const serialId = row.serialId ?? null;
    const legQuantity = Number(row.quantity ?? 0);
    if (!Number.isFinite(legQuantity) || legQuantity <= 0) {
      throw new HttpError(409, '身份分配数量不合法');
    }
    if (trackingPolicy === 'SERIAL') {
      if (serialId === null) throw new HttpError(409, 'SERIAL 跟踪必须提供序列号身份');
      // lotId 按既有主数据事实携带（序列号可以属于某个批次），不得据此拒绝。
      if (legQuantity !== 1) throw new HttpError(409, 'SERIAL 跟踪的分配数量必须为 1');
      if (seenSerials.has(serialId)) throw new HttpError(409, `序列号 ${serialId} 重复分配`);
      seenSerials.add(serialId);
    } else if (trackingPolicy === 'LOT') {
      if (lotId === null) throw new HttpError(409, 'LOT 跟踪必须提供批次身份');
      if (serialId !== null) throw new HttpError(409, 'LOT 跟踪不允许同时指定序列号');
    }
    legs.push({ ...operationalPosition({ productId, warehouseId, lotId, serialId }), quantity: legQuantity });
  }
  const total = legs.reduce((sum, leg) => sum + leg.quantity, 0);
  if (Math.abs(total - base) > 1e-9) {
    throw new HttpError(409, `身份分配数量 ${total} 与业务数量 ${base} 不一致`);
  }
  return legs;
}

/**
 * 解析一条业务行对应的库存腿。
 *
 * NONE 跟踪产品 → 一条默认位置腿。
 * LOT / SERIAL 产品 → 由分配证据解析出精确的多条腿；身份尚不可确定时 fail closed。
 *
 * @param {Array|null} allocationRows 已持久化的 `tracked_source_allocations` 行，
 *        或经 tracking normalizer 校验后的内存分配。
 */
export function resolveOperationalLegs(db, { warehouseId, productId, quantity, allocationRows = null }) {
  const policy = operationalProductPolicy(db, { warehouseId, productId });
  if (policy.binEnabled) {
    throw new HttpError(409, `仓库 ${warehouseId} 启用仓位管理，无法确定唯一的库存位置`);
  }
  if (policy.trackingPolicy === 'NONE') {
    return [{ ...operationalPosition({ productId, warehouseId }), quantity: Number(quantity) }];
  }
  const legs = resolveLegsFromAllocationRows(db, { warehouseId, productId, quantity, allocationRows });
  if (!legs) {
    throw new HttpError(409, `产品 ${productId} 启用了 ${policy.trackingPolicy} 跟踪，但缺少可确定的身份分配证据`);
  }
  return legs;
}

/**
 * 精确读取每条腿的可用量。
 *
 * - 只读该腿自己的 `position_key` 行；缺行视为零（INV-RISK-R04）。
 * - 只扣除同一 `position_key` 上的 ACTIVE inventory locks（INV-RISK-R06）。
 * - 不跨腿、不跨 owner / status / bin / lot / serial 求和。
 *
 * 本函数**不产生任何副作用**，只用于早期反馈与拒绝判断。
 */
export function readOperationalAvailability(db, { legs }) {
  const detail = [];
  let total = 0;
  for (const leg of legs) {
    const row = db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(leg.positionKey);
    const quantity = row ? Number(row.quantity) : 0;
    const locked = Number(db.prepare(
      "SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE product_id=? AND warehouse_id=? AND position_key=? AND status='ACTIVE'",
    ).get(leg.productId, leg.warehouseId, leg.positionKey)?.q || 0);
    const available = Math.max(0, quantity - locked);
    detail.push({
      positionKey: leg.positionKey,
      lotId: leg.lotId,
      serialId: leg.serialId,
      required: Number(leg.quantity),
      quantity,
      locked,
      available,
    });
    total += available;
  }
  return { available: total, legs: detail };
}

/**
 * 判断一批腿是否全部足量。
 *
 * 拒绝沿用既有 API 合同（HTTP 400 + `库存不足`），不新增错误码，
 * 避免在修复库存身份的同时改变响应体语义。
 *
 * @returns {{available: number, legs: Array}}
 */
export function assertOperationalAvailability(db, { legs, message = '库存不足', status = 400 }) {
  const availability = readOperationalAvailability(db, { legs });
  const shortage = availability.legs.filter((leg) => leg.available + 1e-9 < leg.required);
  if (shortage.length) {
    throw new HttpError(status, message);
  }
  return availability;
}

/**
 * 只读解析：把分配行里的批次号 / 序列号解析成**已有**的身份 id。
 *
 * 不存在则保持 null —— 调用方据此 fail closed，绝不猜测身份。
 */
export function resolveExistingIdentities(db, allocationRows) {
  return (allocationRows || []).map((row) => {
    const lotId = row.lotId ?? row.lot_id ?? null;
    const serialId = row.serialId ?? row.serial_id ?? null;
    const lotCode = String(row.lotCode ?? row.planned_lot_code ?? '').trim();
    const serialNumber = String(row.serialNumber ?? row.planned_serial_number ?? '').trim();
    let resolvedLotId = lotId;
    let resolvedSerialId = serialId;
    if (!resolvedLotId && lotCode) {
      resolvedLotId = db.prepare('SELECT id FROM inventory_lots WHERE lot_code=? AND product_id=?').get(lotCode, row.productId || row.product_id)?.id || null;
    }
    if (!resolvedSerialId && serialNumber) {
      resolvedSerialId = db.prepare('SELECT id FROM inventory_serials WHERE serial_number=? AND product_id=?').get(serialNumber, row.productId || row.product_id)?.id || null;
    }
    return {
      lotId: resolvedLotId,
      serialId: resolvedSerialId,
      lotCode: lotCode || null,
      serialNumber: serialNumber || null,
      quantity: Number(row.quantity ?? 0),
    };
  });
}

/**
 * 从分配证据解析腿；身份尚不可确定时返回 null（由调用方 fail closed）。
 *
 * @param {Array} allocationRows 已持久化的 `tracked_source_allocations` 行，或经
 *        tracking normalizer 校验后的内存分配。
 */
export function resolveLegsFromAllocationRows(db, { warehouseId, productId, quantity, allocationRows, trackingPolicy = null }) {
  const rows = resolveExistingIdentities(db, (allocationRows || []).map((row) => ({ ...row, productId })));
  if (!rows.length) return null;
  if (rows.some((row) => !row.lotId && !row.serialId)) return null;
  const policy = trackingPolicy || (rows.some((row) => row.serialId) ? 'SERIAL' : 'LOT');
  return resolveAllocatedLegs({
    productId,
    warehouseId,
    quantity,
    allocations: rows,
    trackingPolicy: policy,
  });
}

/**
 * 销售退货冲销的库存腿。
 *
 * 身份证据链（按权威性排序）：
 *  1. **原销售退货实际恢复的入库估值事件**（`inventory_valuation_movements`
 *     中 `source_type='SALES_RETURN'` 且 `quantity_delta > 0` 的权威事件）——
 *     与 Option C canonical writer 使用的是同一份证据；
 *  2. **原退货的跟踪入库事件**（`tracked_inventory_movements` 的 IN 行）——
 *     覆盖有跟踪身份但没有估值事件的 legacy 退货；
 *  3. **默认运营位置** —— 仅限 NONE 跟踪产品（它的身份本来就是默认位置）。
 *
 * 数量分配模型：所有冲销（含历史冲销）都按原腿顺序从前往后消耗，
 * 因此某个原腿的「已冲销数量」可以由累计已冲销量确定性地推出来。
 */
export function resolveSalesReturnReversalLegs(db, {
  warehouseId,
  productId,
  returnId,
  returnItemId,
  quantity,
  alreadyReversed = 0,
}) {
  const policy = operationalProductPolicy(db, { warehouseId, productId });
  const valuationRows = db.prepare(`
    SELECT * FROM inventory_valuation_movements
     WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=?
       AND quantity_delta > 0 AND status='POSTED'
     ORDER BY created_at, id
  `).all(returnId, returnItemId);
  const trackedRows = db.prepare(`
    SELECT * FROM tracked_inventory_movements
     WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=?
       AND direction='IN' AND reversed=0
     ORDER BY id
  `).all(returnId, returnItemId);

  let sources = null;
  if (valuationRows.length) {
    sources = valuationRows.map((row) => ({
      lotId: row.lot_id ?? null,
      serialId: row.serial_id ?? null,
      quantity: Number(row.quantity_delta),
    }));
  } else if (trackedRows.length) {
    sources = trackedRows.map((row) => ({
      lotId: row.lot_id ?? null,
      serialId: row.serial_id ?? null,
      quantity: Number(row.quantity),
    }));
  }

  if (!sources) {
    if (policy.trackingPolicy !== 'NONE') {
      throw new HttpError(409, '原退货缺少可确定的库存身份证据，无法冲销');
    }
    return [{ ...operationalPosition({ productId, warehouseId }), quantity: Number(quantity) }];
  }

  let consumed = Number(alreadyReversed) || 0;
  let remaining = Number(quantity);
  const legs = [];
  for (const source of sources) {
    const legQuantity = Number(source.quantity);
    if (!Number.isFinite(legQuantity) || legQuantity <= 0) continue;
    const consumedHere = Math.min(legQuantity, Math.max(0, consumed));
    consumed = Math.max(0, consumed - legQuantity);
    const take = Math.min(legQuantity - consumedHere, remaining);
    if (take <= 1e-9) continue;
    remaining -= take;
    legs.push({
      ...operationalPosition({
        productId,
        warehouseId,
        lotId: source.lotId,
        serialId: source.serialId,
      }),
      quantity: take,
    });
  }
  if (remaining > 1e-9) {
    throw new HttpError(409, '可冲销的库存身份数量不足');
  }
  return legs;
}

/**
 * 在调用方事务内按 `position_key` 稳定顺序逐腿写入。
 *
 * 每条腿都是一次独立的 `applyInventoryMutation()`：
 *   - `trackingMode: 'EXTERNAL'` —— tracking 仍由业务 handler 拥有；
 *   - `valuationMode: 'EXTERNAL'` —— 估值仍由业务 handler 拥有；
 *   - 幂等键固定为 `${prefix}:${positionKey}:OUT:v1`，重放不会重复扣减。
 *
 * @returns {{movements: Array, transactionIds: Array<string>}}
 */
export function applyOperationalInventoryLegs(db, {
  sourceType,
  sourceId,
  sourceItemId,
  businessDate,
  legs,
  actor,
  idempotencyKeyPrefix,
  sourceNo = null,
  remark = null,
  movementKind = 'OUT',
}) {
  const ordered = [...legs].sort((a, b) => (a.positionKey < b.positionKey ? -1 : a.positionKey > b.positionKey ? 1 : 0));
  const movements = [];
  const transactionIds = [];
  for (const leg of ordered) {
    const quantity = Number(leg.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, '库存腿数量不合法');
    }
    const fromPosition = {
      productId: leg.productId,
      warehouseId: leg.warehouseId,
      binId: leg.binId ?? null,
      ownerType: leg.ownerType ?? DEFAULT_OPERATIONAL_DIMENSIONS.ownerType,
      ownerId: leg.ownerId ?? null,
      stockStatus: leg.stockStatus ?? DEFAULT_OPERATIONAL_DIMENSIONS.stockStatus,
      lotId: leg.lotId ?? null,
      serialId: leg.serialId ?? null,
    };
    const result = applyInventoryMutation({
      db,
      sourceType,
      sourceId,
      sourceItemId: sourceItemId ?? null,
      sourceNo,
      remark,
      businessDate,
      actor: actor ? { id: actor.id } : undefined,
      movementKind,
      quantity,
      fromPosition,
      idempotencyKey: `${idempotencyKeyPrefix}:${leg.positionKey}:${movementKind}:v1`,
      trackingMode: 'EXTERNAL',
      valuationMode: 'EXTERNAL',
    });
    for (const movement of result?.movements || []) {
      movements.push(movement);
      if (movement.transactionId) transactionIds.push(movement.transactionId);
    }
  }
  return { movements, transactionIds };
}
