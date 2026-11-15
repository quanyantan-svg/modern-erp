// Inventory & Warehouse —— 库存作业工作面的页签登记（唯一事实来源）。
//
// 合同依据：
//   Requirement docs/requirements/inventory-warehouse.md §32.13（IW-EXPOSURE-01..05）
//   Design      docs/design/inventory-warehouse.md §27.58
//   平台合同    docs/requirements/platform.md §36.18（PL-EXPOSURE-01..07）
//
// 背景：`inventory` route 的 exposure 是 `any:['INVENTORY_VIEW']`，但工作面内的 21 个页签
// 各自读取不同的库存子域数据，其后端守卫权限各不相同。只持有 `INVENTORY_VIEW` 的角色
// （例如 `role-reviewer`）进入 route 后，逐个打开页签会连续撞上后端 403 ——
// 「可点击但必然报错」不是可用的产品行为（`IW-EXPOSURE-05`）。
//
// 本模块登记每个页签在**打开时**读取的端点，以及这些端点的后端守卫口径。
// 页签对 actor 可见的条件是：该 actor 能读**全部**这些端点 —— 因此打开页签不会产生 403。
//
// 口径说明：
//   `kind: 'all'`  对应后端 `allow(actor, 'X')`（必须全部持有）；
//   `kind: 'any'`  对应后端 `allowAny(actor, ['X','Y'])`（持有其一即可）；
//   `reads: []`    表示该页签打开时不读取任何端点，因此对所有 actor 可见。
//
// 后端守卫是权限语义的权威；本表只登记「哪个页签读哪个端点、该端点要求哪个权限」。

export const INVENTORY_WORK_TABS = [
  { key: 'instant', label: '即时库存', reads: [{ endpoint: '/api/inventory/instant-query', kind: 'all', codes: ['INVENTORY_VIEW'] }] },
  { key: 'bins', label: '仓位', reads: [{ endpoint: '/api/warehouse-bins', kind: 'any', codes: ['WAREHOUSE_BIN_VIEW', 'WAREHOUSE_BIN_MANAGE'] }] },
  { key: 'statuses', label: '库存状态', reads: [{ endpoint: '/api/inventory-stock-statuses', kind: 'any', codes: ['STOCK_STATUS_VIEW', 'STOCK_STATUS_MANAGE'] }] },
  { key: 'owners', label: '所有权', reads: [{ endpoint: '/api/inventory-owner-dimensions', kind: 'any', codes: ['OWNER_DIMENSION_VIEW', 'INVENTORY_PARAMETERS_MANAGE'] }] },
  { key: 'parameters', label: '库存参数', reads: [{ endpoint: '/api/inventory-parameters', kind: 'any', codes: ['INVENTORY_PARAMETERS_VIEW', 'INVENTORY_PARAMETERS_MANAGE'] }] },
  { key: 'stocktake', label: '盘点', reads: [{ endpoint: '/api/inventory-stocktakes', kind: 'all', codes: ['INVENTORY_VIEW'] }] },
  // 批号调整 / 形态转换 / 容器：打开时不读取任何端点（只提供新建表单），因此对所有 actor 可见。
  { key: 'lot', label: '批号调整', reads: [] },
  { key: 'form', label: '形态转换', reads: [] },
  { key: 'assembly', label: '组装拆卸', reads: [{ endpoint: '/api/inventory/assembly-orders', kind: 'any', codes: ['INVENTORY_ASSEMBLY_VIEW', 'INVENTORY_ASSEMBLY_MANAGE'] }] },
  { key: 'abc', label: 'ABC', reads: [{ endpoint: '/api/inventory/abc', kind: 'any', codes: ['INVENTORY_ABC_MANAGE', 'INVENTORY_REPORT_VIEW', 'INVENTORY_VIEW'] }] },
  { key: 'barcode', label: '条码', reads: [{ endpoint: '/api/inventory/barcode/rules', kind: 'any', codes: ['INVENTORY_BARCODE_RULE_VIEW', 'INVENTORY_BARCODE_RULE_MANAGE'] }] },
  { key: 'containers', label: '容器', reads: [] },
  { key: 'scan', label: '扫码', reads: [{ endpoint: '/api/inventory/scan/query', kind: 'all', codes: ['INVENTORY_VIEW'] }] },
  { key: 'transfer', label: '调拨', reads: [{ endpoint: '/api/inventory-transfers', kind: 'all', codes: ['INVENTORY_VIEW'] }] },
  { key: 'adjustment', label: '调整', reads: [{ endpoint: '/api/inventory-adjustments', kind: 'all', codes: ['INVENTORY_ADJUSTMENT_MANAGE'] }] },
  { key: 'initialization', label: '初始化与期初', reads: [{ endpoint: '/api/inventory/opening-documents', kind: 'any', codes: ['INVENTORY_OPENING_VIEW', 'INVENTORY_OPENING_MANAGE'] }] },
  { key: 'native', label: '其他出入库', reads: [{ endpoint: '/api/inventory/native-documents', kind: 'any', codes: ['INVENTORY_NATIVE_DOCUMENT_VIEW', 'INVENTORY_NATIVE_DOCUMENT_MANAGE'] }] },
  { key: 'step', label: '分步调拨', reads: [
    { endpoint: '/api/inventory-transfers', kind: 'all', codes: ['INVENTORY_VIEW'] },
    { endpoint: '/api/inventory-step-transfers/in-transit', kind: 'any', codes: ['INVENTORY_VIEW', 'INVENTORY_TRANSFER_VIEW'] },
  ] },
  // 状态调整：打开时不读取列表端点（表单目标状态取自工作面参照），因此对所有 actor 可见。
  { key: 'status', label: '状态调整', reads: [] },
  { key: 'locks', label: '锁库', reads: [{ endpoint: '/api/inventory-locks', kind: 'any', codes: ['INVENTORY_LOCK_VIEW', 'INVENTORY_LOCK_MANAGE'] }] },
  // 库存报表：后端四个报表端点当前**无权限守卫**（已登记为开放项），因此对所有 actor 可见。
  { key: 'reports', label: '库存报表', reads: [] },
];

/** 权限码集合（数组入参，允许 undefined / 空数组）。 */
function codes(permissions) {
  return Array.isArray(permissions) ? permissions : [];
}

/** actor 的权限是否满足一条读取守卫。 */
export function satisfiesInventoryRead(read, permissions) {
  const held = codes(permissions);
  return read.kind === 'any'
    ? read.codes.some((code) => held.includes(code))
    : read.codes.every((code) => held.includes(code));
}

/** actor 打开该页签时会不会撞上后端 403：必须能读全部读取端点。 */
export function canOpenInventoryWorkTab(tab, permissions) {
  return (tab.reads || []).every((read) => satisfiesInventoryRead(read, permissions));
}

/** actor 可见的页签（保持登记顺序）。 */
export function permittedInventoryWorkTabs(permissions) {
  return INVENTORY_WORK_TABS.filter((tab) => canOpenInventoryWorkTab(tab, permissions));
}

/**
 * 生效页签：当前选中页签若仍可见则保留，否则回落到第一个可见页签。
 * 返回空串表示该 actor 对本工作面**无任何可打开的页签**（调用方必须 fail closed）。
 */
export function effectiveInventoryWorkTab(permissions, current) {
  const permitted = permittedInventoryWorkTabs(permissions);
  if (!permitted.length) return '';
  return permitted.some((tab) => tab.key === current) ? current : permitted[0].key;
}
