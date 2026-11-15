// Inventory & Warehouse —— 库存作业工作面的参照加载策略（唯一事实来源）。
//
// 合同依据：
//   Requirement docs/requirements/inventory-warehouse.md §32.13（IW-EXPOSURE-01..05）
//   Design      docs/design/inventory-warehouse.md §27.58
//   平台合同    docs/requirements/platform.md §36.18（PL-EXPOSURE-01..07）
//
// 背景：`inventory` route 的 exposure 是 `any:['INVENTORY_VIEW']`，而工作面 hub 曾
// **无条件**加载 4 个参照端点。其中 `/api/inventory-stock-statuses`
// （守卫 `STOCK_STATUS_VIEW` / `STOCK_STATUS_MANAGE`）与 `/api/warehouse-bins`
// （守卫 `WAREHOUSE_BIN_VIEW` / `WAREHOUSE_BIN_MANAGE`）并非所有可见该 route 的角色都持有 ——
// 例如 `role-reviewer` 持有 `INVENTORY_VIEW` 但两者皆无，于是在进入 route 后被后端拒绝。
//
// 本模块只做三件事：
//   1. 登记参照数据源（endpoint / 响应字段 / 读取权限）；
//   2. 按 actor 权限决定**发起哪些请求**（无权的数据源一次请求都不发）；
//   3. 区分「无权读取参照」与「有权但为空」两种状态 —— 二者不得共用同一个空态。
//
// 后端守卫是权限语义的权威；本模块不新增 API、不放宽任何既有守卫。

import {
  dependencyAccess, loadPermittedDependencies, permittedDependencies,
} from './routeApiAuthority.js';

export const INVENTORY_WORK_REFERENCES = [
  { key: 'warehouses', label: '仓库', endpoint: '/api/warehouses', responseKey: 'warehouses', permissions: ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE'] },
  { key: 'products', label: '货品', endpoint: '/api/products', responseKey: 'products', permissions: ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE'] },
  { key: 'stockStatuses', label: '库存状态', endpoint: '/api/inventory-stock-statuses', responseKey: 'stockStatuses', permissions: ['STOCK_STATUS_VIEW', 'STOCK_STATUS_MANAGE'] },
  { key: 'bins', label: '仓位', endpoint: '/api/warehouse-bins', responseKey: 'bins', permissions: ['WAREHOUSE_BIN_VIEW', 'WAREHOUSE_BIN_MANAGE'] },
];

/** actor 有权读取的参照数据源。 */
export function permittedInventoryWorkReferences(permissions) {
  return permittedDependencies(INVENTORY_WORK_REFERENCES, permissions);
}

/** 参照可读性判定：`any` 为 false 表示一个参照都读不到。 */
export function inventoryWorkReferenceAccess(permissions) {
  const access = dependencyAccess(INVENTORY_WORK_REFERENCES, permissions);
  const keys = new Set(access.permitted);
  return {
    any: access.any,
    permitted: access.permitted,
    warehouses: keys.has('warehouses'),
    products: keys.has('products'),
    stockStatuses: keys.has('stockStatuses'),
    bins: keys.has('bins'),
  };
}

/**
 * 按权限加载参照数据。
 *
 * @param {string[]} permissions actor 权限码
 * @param {(endpoint: string) => Promise<any>} request 请求函数（通常为 api）
 */
export async function loadInventoryWorkReferences(permissions, request) {
  const { values, errors, loaded } = await loadPermittedDependencies(
    INVENTORY_WORK_REFERENCES, permissions, request,
  );
  return {
    references: {
      warehouses: values.warehouses || [],
      products: values.products || [],
      stockStatuses: values.stockStatuses || [],
      bins: values.bins || [],
    },
    errors,
    loaded,
  };
}
