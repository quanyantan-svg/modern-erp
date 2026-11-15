// Platform —— route 首屏 API 授权一致性通用原语（唯一事实来源：机制层）。
//
// 合同依据：
//   Requirement docs/requirements/platform.md §36.18（PL-EXPOSURE-01..07）
//   Design      docs/design/platform.md §32.18
//
// 背景：route 声明的 exposure 权限集合与页面自身依赖的 API 权限集合之间没有合同，
// 于是同一个后端主体被前端判定为「可进入该 route」，又被后端判定为「无权调用该 route
// 加载时必调的 API」——同一缺陷形态已在 Manufacturing & Quality（§29.11）、
// Sales & Customer（§34.16）与 Inventory & Warehouse（§32.13）三个域各暴露一处。
//
// 本模块只提供**机制**，不持有任何具体 route 的依赖数据：
//   1. 把各域登记的依赖条目归一化为与后端守卫同形的口径（kind / codes）；
//   2. 按 actor 权限过滤依赖；
//   3. 只对有权读取的依赖发起请求，并区分「无权」与「有权但为空」。
//
// 各域的依赖数据仍由各域自己的登记模块持有（单一事实来源按 route 划分）：
//   src/lib/manufacturingAnalyticsTabs.js       （Manufacturing & Quality）
//   src/lib/salesPriceOverrideReferences.js      （Sales & Customer）
//   src/lib/inventoryWorkReferences.js           （Inventory & Warehouse）
//
// 后端守卫是权限语义的权威；本模块不新增 API、不放宽任何既有守卫。
// 前端隐藏不构成授权：后端继续 fail closed。

/** 权限码集合（数组入参，允许 undefined / 空数组）。 */
function codes(permissions) {
  return Array.isArray(permissions) ? permissions : [];
}

/**
 * 把一条依赖登记归一化为与后端守卫同形的口径。
 *
 *   { permission: 'X' }            → { kind: 'all', codes: ['X'] }   （对应 allow(actor, 'X')）
 *   { permissions: ['X','Y'] }     → { kind: 'any', codes: ['X','Y'] }（对应 allowAny(actor, [...])）
 *
 * 归一化后与后端 handler 内解析出的守卫逐项比较；口径不一致即判定失败。
 */
export function normalizeDependency(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('依赖登记条目必须是对象');
  const { key, endpoint, method = 'GET', responseKey } = entry;
  if (!key || !endpoint) throw new Error('依赖登记条目必须含 key 与 endpoint');
  const base = { key, endpoint, method, responseKey };
  if (Array.isArray(entry.permissions)) {
    if (!entry.permissions.length) throw new Error(`依赖 ${key} 的 permissions 不得为空`);
    return { ...base, kind: 'any', codes: [...entry.permissions] };
  }
  if (typeof entry.permission === 'string') {
    return { ...base, kind: 'all', codes: [entry.permission] };
  }
  throw new Error(`依赖 ${key} 必须声明 permission 或 permissions`);
}

/** 归一化一组依赖登记。 */
export function normalizeDependencies(entries) {
  return (Array.isArray(entries) ? entries : []).map(normalizeDependency);
}

/** actor 的权限是否满足某一条归一化守卫。 */
export function satisfiesDependency(dependency, permissions) {
  const held = codes(permissions);
  return dependency.kind === 'any'
    ? dependency.codes.some((code) => held.includes(code))
    : dependency.codes.every((code) => held.includes(code));
}

/** actor 有权读取的依赖（保持登记顺序）。 */
export function permittedDependencies(dependencies, permissions) {
  const normalized = normalizeDependencies(dependencies);
  return normalized.filter((dependency) => satisfiesDependency(dependency, permissions));
}

/**
 * 依赖可读性判定。
 * `any` 为 false 表示该 actor **一个依赖都读不到** —— 页面必须呈现明确的「无权限」状态，
 * 且不得把依赖呈现为「没有可选数据」。
 */
export function dependencyAccess(dependencies, permissions) {
  const permitted = permittedDependencies(dependencies, permissions);
  const keys = permitted.map((dependency) => dependency.key);
  return { any: permitted.length > 0, permitted: keys };
}

/**
 * 按权限加载依赖。
 *
 * 只对 actor **有权读取**的依赖发起请求；无权的数据源一次请求都不发。
 * 单个依赖失败不影响其它依赖：失败项返回空数组并登记在 `errors` 中。
 *
 * @param {object[]} dependencies 依赖登记
 * @param {string[]} permissions actor 权限码
 * @param {(endpoint: string) => Promise<any>} request 请求函数（通常为 api）
 */
export async function loadPermittedDependencies(dependencies, permissions, request) {
  const normalized = normalizeDependencies(dependencies);
  const permitted = normalized.filter((dependency) => satisfiesDependency(dependency, permissions));
  const values = {};
  const errors = [];
  for (const dependency of normalized) values[dependency.key] = [];
  await Promise.all(permitted.map(async (dependency) => {
    try {
      const payload = await request(dependency.endpoint);
      const rows = payload?.[dependency.responseKey];
      values[dependency.key] = Array.isArray(rows) ? rows : [];
    } catch (cause) {
      values[dependency.key] = [];
      errors.push({ key: dependency.key, endpoint: dependency.endpoint, message: cause?.message || '依赖加载失败' });
    }
  }));
  return { values, errors, loaded: permitted.map((dependency) => dependency.key) };
}
