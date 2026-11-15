// Sales & Customer —— 价格覆盖授权工作面的参照加载策略（唯一事实来源）。
//
// 合同依据：
//   Requirement docs/requirements/sales-customer/01-domain-closure.md §34.16（SC-EXPOSURE-01..05）
//   Design      docs/design/sales-customer/01-domain-technical-design.md §29.53
//
// 背景：`sales-price-override-authorizations` 的 route exposure 是
// `any:['SALES_PRICING_VIEW','SALES_PRICING_OVERRIDE']`，而页面挂载即调用 `/api/customers` 与
// `/api/products`（分别要求 `CUSTOMERS_VIEW`/`CUSTOMERS_MANAGE` 与 `PRODUCTS_VIEW`/`PRODUCTS_MANAGE`）。
// 只持有 `SALES_PRICING_VIEW` 的角色（如会计）因此在进入 route 后被后端拒绝。
//
// 本模块只做三件事：
//   1. 登记参照数据源（endpoint / 响应字段 / 读取权限）；
//   2. 按 actor 权限决定**发起哪些请求**（无权的数据源一次请求都不发）；
//   3. 区分「无权读取参照」与「有权但为空」两种状态 —— 二者不得共用同一个空态。
//
// 后端守卫是权限语义的权威；本模块不新增 API、不放宽任何既有守卫。

export const SALES_PRICE_OVERRIDE_REFERENCES = [
  { key: 'customers', label: '客户', endpoint: '/api/customers', responseKey: 'customers', permissions: ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE'] },
  { key: 'products', label: '物料', endpoint: '/api/products', responseKey: 'products', permissions: ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE'] },
];

/** 权限码集合（数组入参，允许 undefined / 空数组）。 */
function codes(permissions) {
  return Array.isArray(permissions) ? permissions : [];
}

/** actor 有权读取的参照数据源。 */
export function permittedPriceOverrideReferences(permissions) {
  const held = codes(permissions);
  return SALES_PRICE_OVERRIDE_REFERENCES.filter((ref) => ref.permissions.some((code) => held.includes(code)));
}

/**
 * 参照可读性判定。
 * `any` 为 false 时表示该 actor **一个参照都读不到** —— 页面必须呈现「缺少参照读取权限」状态，
 * 且不得把参照呈现为「没有可选客户 / 物料」。
 */
export function priceOverrideReferenceAccess(permissions) {
  const permitted = permittedPriceOverrideReferences(permissions);
  const keys = permitted.map((ref) => ref.key);
  return {
    customers: keys.includes('customers'),
    products: keys.includes('products'),
    any: permitted.length > 0,
    permitted: keys,
  };
}

/**
 * 按权限加载参照数据。
 *
 * 只对 actor **有权读取**的数据源发起请求；无权的数据源一次请求都不发。
 * 单个数据源失败不影响其它数据源：失败项返回空数组并登记在 `errors` 中。
 *
 * @param {string[]} permissions actor 权限码
 * @param {(endpoint: string) => Promise<any>} request 请求函数（通常为 api）
 */
export async function loadPriceOverrideReferences(permissions, request) {
  const permitted = permittedPriceOverrideReferences(permissions);
  const references = { customers: [], products: [] };
  const errors = [];
  await Promise.all(permitted.map(async (ref) => {
    try {
      const payload = await request(ref.endpoint);
      const rows = payload?.[ref.responseKey];
      references[ref.key] = Array.isArray(rows) ? rows : [];
    } catch (cause) {
      references[ref.key] = [];
      errors.push({ key: ref.key, endpoint: ref.endpoint, message: cause?.message || '参照数据加载失败' });
    }
  }));
  return { references, errors, loaded: permitted.map((ref) => ref.key) };
}
