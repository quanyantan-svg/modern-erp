// Manufacturing & Quality —— 生产执行分析工作面的页签与 API 依赖登记（唯一事实来源）。
//
// 合同依据：
//   Requirement docs/requirements/manufacturing-quality.md §29.11（MQ-EXPOSURE-01..05）
//   Design      docs/design/manufacturing-quality.md §24.27
//
// 背景：`manufacturing-analytics` 的 route exposure 是
// `any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_COSTS_VIEW']`，等于本表全部页签所需权限的并集，
// 因此 **exposure 语义本身正确**。不一致只发生在页面层：页面曾无条件渲染全部页签、并固定以
// `wip` 为默认页签，于是只持有 `PRODUCTION_COSTS_VIEW` 的角色（如会计）进入 route 后，
// 其**首屏默认请求**被后端 `PRODUCTION_ORDERS_VIEW` 守卫拒绝。
//
// 本模块只做三件事：
//   1. 登记每个页签的 key / 标签 / 目标 API / 该 API 要求的权限（唯一事实来源）；
//   2. 按 actor 权限过滤可见页签；
//   3. 选出生效页签（默认页签 = 第一个有权页签），并给出该页签应请求的 endpoint。
//
// 后端守卫是权限语义的权威；本表只登记「哪个页签调用哪个 API、该 API 要求哪个权限」，
// 页面据此**不得**发出 actor 无权调用的请求。前端可见性不是授权：后端继续 fail closed。

export const MANUFACTURING_ANALYTICS_TABS = [
  { key: 'wip', label: '在制', endpoint: '/api/manufacturing/reports/wip', permission: 'PRODUCTION_ORDERS_VIEW', kind: 'report' },
  { key: 'yield', label: '良率 / 报废', endpoint: '/api/manufacturing/reports/yield', permission: 'PRODUCTION_ORDERS_VIEW', kind: 'report' },
  { key: 'capacity', label: '产能', endpoint: '/api/manufacturing/reports/capacity', permission: 'PRODUCTION_ORDERS_VIEW', kind: 'report' },
  { key: 'execution', label: '执行汇总', endpoint: '/api/manufacturing-analytics/execution-summary', permission: 'PRODUCTION_ORDERS_VIEW', kind: 'summary' },
  { key: 'materialIssue', label: '物料领用汇总', endpoint: '/api/manufacturing-analytics/material-issue-summary', permission: 'PRODUCTION_ORDERS_VIEW', kind: 'summary' },
  { key: 'cost', label: '生产成本', endpoint: '/api/manufacturing/reports/cost', permission: 'PRODUCTION_COSTS_VIEW', kind: 'report' },
];

/** 权限码集合（数组入参，允许 undefined / 空数组）。 */
function codes(permissions) {
  return Array.isArray(permissions) ? permissions : [];
}

/** actor 有权访问的页签（保持登记顺序）。 */
export function permittedManufacturingAnalyticsTabs(permissions) {
  const held = codes(permissions);
  return MANUFACTURING_ANALYTICS_TABS.filter((tab) => held.includes(tab.permission));
}

/**
 * 生效页签：当前选中页签若仍可见则保留，否则回落到第一个可见页签。
 * 返回空串表示该 actor 对本页签集合**无任何权限**（调用方必须 fail closed，不得发请求）。
 */
export function effectiveManufacturingAnalyticsTab(permissions, current) {
  const permitted = permittedManufacturingAnalyticsTabs(permissions);
  if (!permitted.length) return '';
  return permitted.some((tab) => tab.key === current) ? current : permitted[0].key;
}

/**
 * 生效页签对应的请求描述；无权时返回 null（调用方不得发起任何请求）。
 * `kind: 'summary'` 的页签额外接受日期区间参数。
 */
export function manufacturingAnalyticsRequest(permissions, current) {
  const key = effectiveManufacturingAnalyticsTab(permissions, current);
  const tab = MANUFACTURING_ANALYTICS_TABS.find((item) => item.key === key);
  if (!tab) return null;
  return { key: tab.key, label: tab.label, endpoint: tab.endpoint, permission: tab.permission, kind: tab.kind };
}
