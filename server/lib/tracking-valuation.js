// 追踪策略 → 财务估值方法的 canonical 映射（Requirement §36.20 PL-VALUATION-01）。
//
// 单一事实来源：产品创建、追踪策略变更、存量对齐迁移、按需修正入口都读这里，
// 避免第二份手维护副本（第二份副本正是缺陷漂移的来源）。
//
// 语义：估值方法必须与追踪策略匹配 —— NONE 货品用移动加权平均；LOT 货品按批次池估值；
// SERIAL 货品按单序列估值。不匹配时库存估值动作一律 fail closed
// （server/modules/financial-inventory.js 的 valuationMethod()）。

export const VALUATION_BY_TRACKING = Object.freeze({
  NONE: 'MOVING_AVERAGE',
  LOT: 'LOT_SPECIFIC_POOL',
  SERIAL: 'SPECIFIC_SERIAL',
});

/** 某个追踪策略对应的 canonical 估值方法；未知策略回退到 MOVING_AVERAGE。 */
export function canonicalValuationMethod(trackingPolicy) {
  return VALUATION_BY_TRACKING[String(trackingPolicy || '').toUpperCase()] || 'MOVING_AVERAGE';
}
