import { HttpError } from '../lib/http.js';
import { receiveValue } from './financial-inventory.js';

/**
 * 单腿入库异动的**自持计值**（Requirement §32.18 `IW-VAL-05`）。
 *
 * 「只有入库腿、没有出库腿」的异动，其入库价值**不得**由写入器「出库计值」推导
 * —— 那会从目标池扣掉价值（值离开来源池却不到目标池）。这类异动的入库价值必须由
 * 调用方按**权威成本**自持。本模块是该自持计值的唯一实现点。
 *
 * 权威成本的三种来源（`IW-VAL-05` 修订清单）：
 *   1. 组装：本次**组件出库**的权威账面价值合计；
 *   2. 拆卸：本次**母件出库**的权威账面价值按数量分摊；
 *   3. 步进调拨（入库与退回）：**调出腿**的权威账面价值；
 *   4. VMI 收货：产品自身的既有账面单价或冻结标准成本（`receivePositiveSourceValue`）。
 */

/** 某来源下若干明细行已发出的权威账面价值合计（负数 = 价值离开）。 */
export function issuedCarryingValueCentsByItems(db, { sourceType, sourceId, sourceItemIds }) {
  const ids = (Array.isArray(sourceItemIds) ? sourceItemIds : []).map((id) => String(id));
  if (!ids.length) return 0;
  const marks = ids.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements
      WHERE status='POSTED' AND source_type=? AND source_id=? AND source_item_id IN (${marks})`,
  ).get(sourceType, String(sourceId), ...ids);
  return Number(row.n);
}

/** 某来源下、某货品在某仓位已发出的权威账面价值合计（负数 = 价值离开）。 */
export function issuedCarryingValueCentsByPosition(db, { sourceType, sourceId, productId, warehouseId }) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements
      WHERE status='POSTED' AND source_type=? AND source_id=? AND product_id=? AND warehouse_id=?`,
  ).get(sourceType, String(sourceId), productId, warehouseId);
  return Number(row.n);
}

/**
 * 把权威成本写入单腿入库腿。
 *
 * - 金额必须是**非负整数分**（入账价值恒为正）；
 * - 金额为 0 表示**没有权威价值**：该腿维持未估值（`LEGACY_UNVALUED`），由关账异常
 *   清单标记，而不是伪造一个 0 值流水把「已估值」的假象写进账；
 * - 写入的是**权威估值流水 + 身份级估值池**（`receiveValue`），因此在库数量与估值池
 *   数量同步变化，`INVENTORY_QUANTITY_VS_VALUATION` 不再失配；
 * - `movementType` 参与估值流水的唯一索引，必须与同来源的出库腿**不同**。
 */
export function receiveSingleLegInboundValue(db, {
  businessDate, productId, warehouseId, quantity, valueCents, valuationBasis,
  sourceType, sourceId, sourceItemId, inventoryTransactionId,
  movementType, lotId = null, serialId = null,
}) {
  const value = Math.round(Number(valueCents));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(409, '单腿入库的自持计值金额必须是非负整数分');
  }
  if (value === 0) return null;
  const moved = Number(quantity);
  if (!Number.isFinite(moved) || moved <= 0) {
    throw new HttpError(409, '单腿入库的自持计值数量必须为正');
  }
  return receiveValue(db, {
    businessDate, productId, warehouseId, lotId, serialId,
    quantity: moved, valueCents: value,
    movementType, sourceType, sourceId, sourceItemId,
    inventoryTransactionId, valuationBasis,
  });
}
