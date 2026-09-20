// Centralized domain-aware status / suggestion / warning labels.
//
// P1 introduces this helper for planning screens only. The full
// system-wide refactor belongs to P4 (copy/polish). Pages MUST use
// these helpers instead of inlining Chinese status strings or leaking
// raw enum values to the UI.

export const FORECAST_STATUS_LABEL = Object.freeze({
  DRAFT: '草稿',
  ACTIVE: '已生效',
  CANCELLED: '已取消',
});

export const MRP_RUN_STATUS_LABEL = Object.freeze({
  DRAFT: '草稿',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
});

export const MRP_DEMAND_MODE_LABEL = Object.freeze({
  SALES_ORDERS: '销售订单',
  FORECAST: '需求预测',
  SALES_PLUS_FORECAST: '销售订单 + 需求预测',
});

export const MRP_DEMAND_MODE_HINT = Object.freeze({
  SALES_ORDERS: '按已审批销售订单的未交付数量计算',
  FORECAST: '按已生效的需求预测数量计算',
  SALES_PLUS_FORECAST: '销售订单需求与预测需求将叠加计算',
});

export const SUGGESTION_TYPE_LABEL = Object.freeze({
  MAKE: '生产建议',
  BUY: '采购建议',
  NONE: '无需补充',
});

export const WARNING_LABEL = Object.freeze({
  ROUTING_MISSING: '尚未设置生产工序标准',
});

export function forecastStatusLabel(status) {
  return FORECAST_STATUS_LABEL[status] || status || '—';
}

export function mrpRunStatusLabel(status) {
  return MRP_RUN_STATUS_LABEL[status] || status || '—';
}

export function demandModeLabel(mode) {
  return MRP_DEMAND_MODE_LABEL[mode] || mode || '—';
}

export function demandModeHint(mode) {
  return MRP_DEMAND_MODE_HINT[mode] || '';
}

export function suggestionTypeLabel(type) {
  return SUGGESTION_TYPE_LABEL[type] || SUGGESTION_TYPE_LABEL.NONE;
}

export function warningLabel(warning) {
  return WARNING_LABEL[warning] || warning || '';
}
