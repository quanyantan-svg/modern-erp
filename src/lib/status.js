// Centralized base labels. Domain helpers below deliberately override terms
// where the same internal state has a different business meaning.
export const STATUS_LABEL = Object.freeze({
  DRAFT: '草稿', ENTERED: '草稿', SUBMITTED: '待审批', APPROVED: '已审批',
  POSTED: '已审批', REJECTED: '已驳回', ACTIVE: '已生效', INACTIVE: '已停用',
  DISCONTINUED: '已停用', RELEASED: '已下达', PENDING: '待处理',
  IN_PROGRESS: '进行中', CONFIRMED: '已确认', COMPLETED: '已完成',
  CANCELLED: '已取消', CLOSED: '已结账', OPEN: '未结账', REOPENED: '已重新开放',
});

export const STATUS_DOMAIN_LABEL = Object.freeze({
  master: Object.freeze({ ACTIVE: '启用', INACTIVE: '已停用', DISCONTINUED: '已停用' }),
  forecast: Object.freeze({ ACTIVE: '已生效' }),
  production: Object.freeze({ PENDING: '待生产', IN_PROGRESS: '生产中' }),
  quality: Object.freeze({ PENDING: '待检验' }),
  period: Object.freeze({ OPEN: '未结账', CLOSED: '已结账' }),
});

export function statusLabel(status, domain) {
  if (!status) return '—';
  return STATUS_DOMAIN_LABEL[domain]?.[status] || STATUS_LABEL[status] || '状态待确认';
}

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
  return FORECAST_STATUS_LABEL[status] || statusLabel(status, 'forecast');
}

export function mrpRunStatusLabel(status) {
  return MRP_RUN_STATUS_LABEL[status] || statusLabel(status);
}

export function demandModeLabel(mode) {
  return MRP_DEMAND_MODE_LABEL[mode] || '需求来源待确认';
}

export function demandModeHint(mode) {
  return MRP_DEMAND_MODE_HINT[mode] || '';
}

export function suggestionTypeLabel(type) {
  return SUGGESTION_TYPE_LABEL[type] || SUGGESTION_TYPE_LABEL.NONE;
}

export function warningLabel(warning) {
  return WARNING_LABEL[warning] || (warning ? '请检查相关业务设置' : '');
}
