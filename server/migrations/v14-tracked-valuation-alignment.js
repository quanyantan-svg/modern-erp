// 追踪策略与财务估值方法的对齐（Requirement §36.20 PL-VALUATION-02）。
//
// 背景：v13 的财务库存迁移曾把 products.valuation_method 按 tracking_policy 对齐过一次，
// 但**产品创建路径**没有同步写 valuation_method —— 新建的 LOT / SERIAL 货品会落回列默认值
// MOVING_AVERAGE，于是这类货品的库存估值动作被 valuationMethod() 永久 fail closed
// （409「货品追踪策略与财务估值方法不兼容」）。
//
// 本迁移把存量错配行按 canonical 映射对齐，**幂等**：
//   * 只动 valuation_activated_at IS NULL 的行（估值已激活的货品其方法已冻结，不可改）；
//   * 只动与 canonical 映射不符的行。
// 与 v13 的回填同源，但独立成一步，以便在产品创建修复之后再次执行。

export function alignTrackedValuationMethods(db) {
  db.exec(`
    UPDATE products SET valuation_method=CASE tracking_policy
      WHEN 'LOT' THEN 'LOT_SPECIFIC_POOL' WHEN 'SERIAL' THEN 'SPECIFIC_SERIAL' ELSE 'MOVING_AVERAGE' END
      WHERE valuation_activated_at IS NULL
        AND valuation_method <> CASE tracking_policy
          WHEN 'LOT' THEN 'LOT_SPECIFIC_POOL' WHEN 'SERIAL' THEN 'SPECIFIC_SERIAL' ELSE 'MOVING_AVERAGE' END;
  `);
}
