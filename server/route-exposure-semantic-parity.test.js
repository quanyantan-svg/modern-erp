// Route exposure 与页面自身 API 权限一致性 —— 有界合同 focused 测试。
//
// 合同依据：
//   Requirement docs/requirements/manufacturing-quality.md §29.11（MQ-EXPOSURE-01..05）
//   Requirement docs/requirements/sales-customer/01-domain-closure.md §34.16（SC-EXPOSURE-01..05）
//   Design      docs/design/manufacturing-quality.md §24.27
//   Design      docs/design/sales-customer/01-domain-technical-design.md §29.53
//
// 这个测试**不**触碰任何业务 handler 的数据语义。它只断言三件事：
//   A. 页面登记的页签 / 参照，与**后端实际守卫**逐项一致（登记错一处即转红）；
//   B. 逐角色断言：页面会发出的请求集合 ⊆ 该角色权限；默认页签 / 首屏端点一定可调用；
//   C. 逐角色断言：无权的数据源一次请求都不发，且「无权态」与「空态」互不混淆。
//
// 角色权限取自**真实种子库**（role_permissions），不是手抄名单 —— 迁移追加的权限
// （例如 role-accounting 的 PRODUCTION_COSTS_VIEW）必须被看见。

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createDatabase } from './db.js';
import {
  MANUFACTURING_ANALYTICS_TABS,
  permittedManufacturingAnalyticsTabs,
  effectiveManufacturingAnalyticsTab,
  manufacturingAnalyticsRequest,
} from '../src/lib/manufacturingAnalyticsTabs.js';
import {
  SALES_PRICE_OVERRIDE_REFERENCES,
  permittedPriceOverrideReferences,
  priceOverrideReferenceAccess,
  loadPriceOverrideReferences,
} from '../src/lib/salesPriceOverrideReferences.js';
import {
  INVENTORY_WORK_REFERENCES,
  permittedInventoryWorkReferences,
  inventoryWorkReferenceAccess,
  loadInventoryWorkReferences,
} from '../src/lib/inventoryWorkReferences.js';
import {
  INVENTORY_WORK_TABS,
  permittedInventoryWorkTabs,
  effectiveInventoryWorkTab,
  canOpenInventoryWorkTab,
} from '../src/lib/inventoryWorkTabs.js';

const repoRoot = resolve(import.meta.dirname, '..');

const CANONICAL_ROLES = [
  'role-admin',
  'role-sales',
  'role-reviewer',
  'role-warehouse',
  'role-accounting',
];

function readSource(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** 取某个导出函数的函数体（到下一个导出为止；`export async function` 同样算导出边界）。 */
function functionBody(source, name) {
  const pattern = new RegExp(`export (?:async )?function ${name}\\(`);
  const match = pattern.exec(source);
  assert.ok(match, `找不到导出函数 ${name}`);
  const start = match.index;
  const next = source.indexOf('\nexport ', start + match[0].length);
  return source.slice(start, next < 0 ? source.length : next);
}

/** 取某个 React 组件的源码片段（到下一个导出函数为止）。 */
function componentSource(relativePath, exportName) {
  const source = readSource(relativePath);
  const pattern = new RegExp(`export (?:async )?function ${exportName}\\(`);
  const match = pattern.exec(source);
  assert.ok(match, `找不到组件 ${exportName}`);
  const start = match.index;
  const next = source.indexOf('\nexport ', start + match[0].length);
  return source.slice(start, next < 0 ? source.length : next);
}

/** 取某个模块内函数的源码片段（到下一个函数声明为止）。 */
function plainFunctionBody(relativePath, name) {
  const source = readSource(relativePath);
  const pattern = new RegExp(`(?:export\\s+)?function ${name}\\(`);
  const match = pattern.exec(source);
  assert.ok(match, `找不到函数 ${name}`);
  const start = match.index;
  const next = source.indexOf('\nfunction ', start + match[0].length);
  return source.slice(start, next < 0 ? source.length : next);
}

/**
 * 从函数体里解析后端实际要求的权限。
 * `allow(actor, 'X')`      → 需求 `{ kind: 'all', codes: ['X'] }`（必须全部持有）
 * `allowAny(actor, ['X','Y'])` → 需求 `{ kind: 'any', codes: ['X','Y'] }`（持有其一即可）
 */
function guardRequirements(body) {
  const requirements = [];
  for (const match of body.matchAll(/allow(Any)?\(\s*actor\s*,\s*(\[[^\]]*\]|'[A-Z0-9_]+')/g)) {
    const codes = [...match[2].matchAll(/'([A-Z0-9_]+)'/g)].map((code) => code[1]);
    if (codes.length) requirements.push({ kind: match[1] ? 'any' : 'all', codes });
  }
  return requirements;
}

/** 某个 endpoint 的后端实际守卫需求。 */
function backendGuard(endpoint) {
  const { handler, owner } = endpointHandler(endpoint);
  const body = functionBody(readSource(owner), handler);
  const requirements = guardRequirements(body);
  assert.ok(requirements.length > 0, `${endpoint} 的 handler ${handler} 没有可识别的权限守卫`);
  return { handler, owner, requirements };
}

/** actor 的权限是否满足某一条守卫需求。 */
function satisfies(requirement, permissions) {
  return requirement.kind === 'any'
    ? requirement.codes.some((code) => permissions.includes(code))
    : requirement.codes.every((code) => permissions.includes(code));
}

/** endpoint → handler 名与 owner 模块（兼容 ownedRouteTable 与内联 dispatch 两种登记形态）。 */
function endpointHandler(endpoint) {
  const source = readSource('server/app.js');
  const index = source.indexOf(`'${endpoint}'`);
  assert.ok(index >= 0, `app.js 未登记路由 ${endpoint}`);
  const tail = source.slice(index, index + 400);
  const call = tail.match(/([A-Za-z0-9_]+)\s*\(/);
  assert.ok(call, `无法解析 ${endpoint} 的 handler`);
  const handler = call[1];
  const owner = handlerModule(handler);
  assert.ok(owner, `找不到 ${handler} 的 owner 模块`);
  return { handler, owner };
}

// ---------------------------------------------------------------------------
// 精确的 endpoint → 后端守卫解析（平台合同 PL-EXPOSURE-02 的判定基础）。
//
// 上面的 endpointHandler 只处理「具名 handler 写在 owner 模块」这一种形态；
// 实际登记还有两种：ownedRouteTable 的**内联** handler，以及 app.js 的**旧 dispatch 分支**
// （handler 直接定义在 app.js 里）。三种形态必须解析出同一个守卫口径，
// 否则前端登记无法与后端逐项核对。
// ---------------------------------------------------------------------------

const APP_SOURCE = readSource('server/app.js');

/** server/modules/** 与 server/lib/** 下的模块源码。 */
function serverModuleSources() {
  const dirs = ['server/modules', 'server/lib'];
  const out = [];
  for (const dir of dirs) {
    for (const name of readdirSync(resolve(repoRoot, dir)).filter((n) => n.endsWith('.js'))) {
      out.push({ file: `${dir}/${name}`, text: readFileSync(resolve(repoRoot, dir, name), 'utf8') });
    }
  }
  return out;
}
const SERVER_MODULES = serverModuleSources();

/** 在函数体内取权限守卫；找不到函数时返回 null。 */
function guardOfFunction(handler) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function ${handler}\\s*\\(`);
  const candidates = [...SERVER_MODULES, { file: 'server/app.js', text: APP_SOURCE }];
  for (const { file, text } of candidates) {
    const match = pattern.exec(text);
    if (!match) continue;
    const rest = text.slice(match.index + match[0].length);
    const end = rest.search(/\n(?:export\s+)?(?:async\s+)?function \w+\s*\(/);
    const body = end < 0 ? text.slice(match.index) : text.slice(match.index, match.index + match[0].length + end);
    const requirements = guardRequirements(body);
    return { file, requirements };
  }
  return null;
}

/**
 * endpoint → 后端实际守卫。
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} endpoint
 * @returns {{kind:'any'|'all', codes:string[], handler:string}|null}
 */
function resolveBackendGuard(method, endpoint) {
  // 1. ownedRouteTable.register({ method, path: '<literal>', ... })
  for (const block of APP_SOURCE.matchAll(/ownedRouteTable\.register\(\{([\s\S]*?)\}\);/g)) {
    const body = block[1];
    const declaredMethod = body.match(/method:\s*['"]([A-Z]+)['"]/)?.[1];
    const declaredPath = body.match(/path:\s*['"]([^'"]+)['"]/)?.[1];
    if (declaredMethod !== method || declaredPath !== endpoint) continue;
    const inline = body.match(/allow(Any)?\(\s*actor\s*,\s*(\[[^\]]*\]|'[A-Z0-9_]+')/);
    if (inline) {
      const codes = [...inline[2].matchAll(/'([A-Z0-9_]+)'/g)].map((c) => c[1]);
      return { kind: inline[1] ? 'any' : 'all', codes, handler: '(inline)' };
    }
    const named = body.match(/handler:\s*\(\{[^)]*\)\s*=>\s*([A-Za-z0-9_]+)/)?.[1];
    if (!named) return null;
    const found = guardOfFunction(named);
    if (!found || found.requirements.length === 0) return null;
    return { ...found.requirements[0], handler: named };
  }

  // 2. 旧 dispatch 分支：pathname === '<path>' && req.method === '<METHOD>'
  //    分支体可能跨多行（`{ ... return fn(...); }`），因此取到下一个 dispatch 分支为止再找 handler。
  const legacyMarker = `pathname === '${endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' && req.method === '${method}'`;
  const legacyIndex = APP_SOURCE.indexOf(legacyMarker);
  if (legacyIndex >= 0) {
    const tail = APP_SOURCE.slice(legacyIndex, legacyIndex + 800);
    const nextBranch = tail.indexOf('\n  if (pathname');
    const branch = nextBranch >= 0 ? tail.slice(0, nextBranch) : tail;
    const inline = branch.match(/allow(Any)?\(\s*actor\s*,\s*(\[[^\]]*\]|'[A-Z0-9_]+')/);
    if (inline) {
      const codes = [...inline[2].matchAll(/'([A-Z0-9_]+)'/g)].map((c) => c[1]);
      return { kind: inline[1] ? 'any' : 'all', codes, handler: '(inline)' };
    }
    const named = branch.match(/return\s+([A-Za-z0-9_]+)\s*\(/) || branch.match(/=>\s*([A-Za-z0-9_]+)\s*\(/);
    if (named) {
      const found = guardOfFunction(named[1]);
      if (found && found.requirements.length > 0) return { ...found.requirements[0], handler: named[1] };
    }
  }
  return null;
}

/** 在 server/modules/** 中找出导出该函数的模块。 */
function handlerModule(handler) {
  const modulesDir = resolve(repoRoot, 'server/modules');
  const pattern = new RegExp(`export (?:async )?function ${handler}\\(`);
  for (const file of readdirSync(modulesDir).filter((name) => name.endsWith('.js'))) {
    const relativePath = `server/modules/${file}`;
    if (pattern.test(readSource(relativePath))) return relativePath;
  }
  return null;
}

describe('A. 页签 / 参照登记与后端守卫一致（MQ-EXPOSURE-01 / SC-EXPOSURE-04）', () => {
  test('A1. 生产执行分析的 6 个页签与后端守卫逐项一致', () => {
    assert.equal(MANUFACTURING_ANALYTICS_TABS.length, 6);
    for (const tab of MANUFACTURING_ANALYTICS_TABS) {
      const { requirements } = backendGuard(tab.endpoint);
      assert.equal(requirements.length, 1, `${tab.endpoint} 应当只有一条守卫`);
      assert.equal(requirements[0].kind, 'all', `${tab.endpoint} 的守卫应当是单一权限`);
      assert.deepEqual(
        requirements[0].codes,
        [tab.permission],
        `页签 ${tab.key} 登记的权限 ${tab.permission} 与后端守卫 ${requirements[0].codes.join(',')} 不一致`,
      );
    }
  });

  test('A2. 生产执行分析的页签 key 唯一、endpoint 唯一', () => {
    assert.equal(new Set(MANUFACTURING_ANALYTICS_TABS.map((tab) => tab.key)).size, MANUFACTURING_ANALYTICS_TABS.length);
    assert.equal(new Set(MANUFACTURING_ANALYTICS_TABS.map((tab) => tab.endpoint)).size, MANUFACTURING_ANALYTICS_TABS.length);
  });

  test('A3. 价格覆盖授权的 2 个参照与后端守卫逐项一致', () => {
    assert.equal(SALES_PRICE_OVERRIDE_REFERENCES.length, 2);
    for (const ref of SALES_PRICE_OVERRIDE_REFERENCES) {
      const { requirements } = backendGuard(ref.endpoint);
      assert.equal(requirements.length, 1, `${ref.endpoint} 应当只有一条守卫`);
      assert.equal(requirements[0].kind, 'any', `${ref.endpoint} 的守卫应当是择一许可`);
      assert.deepEqual(
        [...requirements[0].codes].sort(),
        [...ref.permissions].sort(),
        `参照 ${ref.key} 登记的权限 ${ref.permissions.join(',')} 与后端守卫 ${requirements[0].codes.join(',')} 不一致`,
      );
    }
  });

  test('A4. 两条 route 的 exposure 未被改动（MQ-EXPOSURE-04 / SC-EXPOSURE-04）', () => {
    const source = readSource('src/navigation/applicationRegistry.js');
    const exposureOf = (routeKey) => {
      const line = source.split('\n').find((item) => item.includes(`route('${routeKey}'`));
      assert.ok(line, `registry 未登记 route ${routeKey}`);
      const group = line.match(/\{(any|permission):\s*(\[[^\]]*\]|'[A-Z0-9_]+')/);
      assert.ok(group, `无法解析 ${routeKey} 的 exposure`);
      return [...group[2].matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]).sort();
    };
    assert.deepEqual(
      exposureOf('manufacturing-analytics'),
      ['PRODUCTION_COSTS_VIEW', 'PRODUCTION_ORDERS_VIEW'],
      'manufacturing-analytics 的 exposure 不得被改动',
    );
    assert.deepEqual(
      exposureOf('sales-price-override-authorizations'),
      ['SALES_PRICING_OVERRIDE', 'SALES_PRICING_VIEW'],
      'sales-price-override-authorizations 的 exposure 不得被改动',
    );
  });

  test('A5. exposure 权限集合等于该 route 全部页签所需权限的并集', () => {
    const union = [...new Set(MANUFACTURING_ANALYTICS_TABS.map((tab) => tab.permission))].sort();
    assert.deepEqual(union, ['PRODUCTION_COSTS_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  });
});

describe('B. 页签可见性与默认页签按 actor 权限派生（MQ-EXPOSURE-02 / 03）', () => {
  test('B1. 只有 PRODUCTION_COSTS_VIEW 的角色可见页签只有「生产成本」', () => {
    const permitted = permittedManufacturingAnalyticsTabs(['PRODUCTION_COSTS_VIEW']);
    assert.deepEqual(permitted.map((tab) => tab.key), ['cost']);
    assert.equal(effectiveManufacturingAnalyticsTab(['PRODUCTION_COSTS_VIEW'], 'wip'), 'cost');
  });

  test('B2. 只有 PRODUCTION_ORDERS_VIEW 的角色可见 5 个执行类页签，默认「在制」', () => {
    const permitted = permittedManufacturingAnalyticsTabs(['PRODUCTION_ORDERS_VIEW']);
    assert.deepEqual(permitted.map((tab) => tab.key), ['wip', 'yield', 'capacity', 'execution', 'materialIssue']);
    assert.equal(effectiveManufacturingAnalyticsTab(['PRODUCTION_ORDERS_VIEW'], 'wip'), 'wip');
  });

  test('B3. 两个权限都持有时 6 个页签全部可见，默认「在制」', () => {
    const permitted = permittedManufacturingAnalyticsTabs(['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_COSTS_VIEW']);
    assert.equal(permitted.length, 6);
    assert.equal(effectiveManufacturingAnalyticsTab(['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_COSTS_VIEW'], 'wip'), 'wip');
  });

  test('B4. 没有任何权限时不得产生任何请求', () => {
    assert.equal(manufacturingAnalyticsRequest([], 'wip'), null);
    assert.equal(manufacturingAnalyticsRequest(undefined, 'wip'), null);
    assert.equal(effectiveManufacturingAnalyticsTab([], 'wip'), '');
  });

  test('B5. 生效请求的端点权限一定在 actor 权限内', () => {
    const held = ['PRODUCTION_COSTS_VIEW'];
    const request = manufacturingAnalyticsRequest(held, 'wip');
    assert.ok(request);
    assert.ok(held.includes(request.permission));
    assert.equal(request.key, 'cost');
  });
});

describe('C. 参照加载以 actor 权限为前置（SC-EXPOSURE-01 / 02 / 03）', () => {
  test('C1. 无参照读取权限时一次请求都不发', async () => {
    const calls = [];
    const result = await loadPriceOverrideReferences(['SALES_PRICING_VIEW'], async (endpoint) => { calls.push(endpoint); return {}; });
    assert.deepEqual(calls, [], '无权读取参照时不得发起任何请求');
    assert.deepEqual(result.loaded, []);
    assert.deepEqual(result.references, { customers: [], products: [] });
  });

  test('C2. 只有客户读取权时只请求客户参照', async () => {
    const calls = [];
    const result = await loadPriceOverrideReferences(['CUSTOMERS_VIEW'], async (endpoint) => {
      calls.push(endpoint);
      return { customers: [{ id: 'c1' }] };
    });
    assert.deepEqual(calls, ['/api/customers']);
    assert.deepEqual(result.loaded, ['customers']);
    assert.equal(result.references.customers.length, 1);
    assert.deepEqual(result.references.products, []);
  });

  test('C3. 两个参照都可读时按登记顺序请求两个端点', async () => {
    const calls = [];
    const result = await loadPriceOverrideReferences(
      ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'PRODUCTS_VIEW', 'PRODUCTS_MANAGE'],
      async (endpoint) => { calls.push(endpoint); return endpoint === '/api/customers' ? { customers: [{ id: 'c1' }] } : { products: [{ id: 'p1' }] }; },
    );
    assert.deepEqual(calls.sort(), ['/api/customers', '/api/products']);
    assert.equal(result.references.customers.length, 1);
    assert.equal(result.references.products.length, 1);
  });

  test('C4. 单个参照失败不阻断其它参照，失败被登记而不是静默', async () => {
    const result = await loadPriceOverrideReferences(['CUSTOMERS_VIEW', 'PRODUCTS_VIEW'], async (endpoint) => {
      if (endpoint === '/api/customers') throw new Error('boom');
      return { products: [{ id: 'p1' }] };
    });
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].key, 'customers');
    assert.deepEqual(result.references.customers, []);
    assert.equal(result.references.products.length, 1);
  });

  test('C5. 参照可读性判定区分「无权」与「有权」', () => {
    assert.equal(priceOverrideReferenceAccess(['SALES_PRICING_VIEW']).any, false);
    assert.equal(priceOverrideReferenceAccess(['CUSTOMERS_VIEW']).any, true);
    assert.equal(priceOverrideReferenceAccess(['CUSTOMERS_VIEW']).customers, true);
    assert.equal(priceOverrideReferenceAccess(['CUSTOMERS_VIEW']).products, false);
    assert.equal(permittedPriceOverrideReferences([]).length, 0);
  });
});

describe('D. 页面必须使用唯一登记，不得自带第二份端点清单', () => {
  test('D1. 生产执行分析页使用共享页签登记，不再自行拼接报表端点', () => {
    const source = componentSource('src/pages/manufacturing.jsx', 'ManufacturingAnalytics');
    assert.ok(readSource('src/pages/manufacturing.jsx').includes("from '../lib/manufacturingAnalyticsTabs.js'"), '页面必须引用唯一登记模块');
    assert.ok(!source.includes('/api/manufacturing/reports/'), '页面不得自行拼接报表端点');
    assert.ok(!source.includes("useState('wip')"), '页面不得把默认页签写死为 wip');
  });

  test('D2. 价格覆盖授权页不再无条件加载客户 / 物料参照', () => {
    const source = componentSource('src/pages/sales-parameters.jsx', 'PriceOverrideAuthorizations');
    assert.ok(readSource('src/pages/sales-parameters.jsx').includes("from '../lib/salesPriceOverrideReferences.js'"), '页面必须引用唯一登记模块');
    assert.ok(!source.includes("api('/api/customers')"), '页面不得无条件调用 /api/customers');
    assert.ok(!source.includes("api('/api/products')"), '页面不得无条件调用 /api/products');
  });
});

describe('E. 逐角色的请求集合必须落在该角色权限内（真实种子库）', () => {
  let db;
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-route-exposure-'));
    db = createDatabase(join(tempDir, 'erp.db'));
  });

  after(() => {
    try { db?.close?.(); } catch { /* 关闭失败不影响结论 */ }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const permissionsOf = (roleId) => db
    .prepare('SELECT permission_code FROM role_permissions WHERE role_id=?')
    .all(roleId)
    .map((row) => row.permission_code);

  test('E1. 每个 canonical 角色的可见页签，其后端守卫都满足', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      for (const tab of permittedManufacturingAnalyticsTabs(permissions)) {
        const { requirements } = backendGuard(tab.endpoint);
        for (const requirement of requirements) {
          assert.ok(satisfies(requirement, permissions), `${roleId} 可见页签 ${tab.key} 的守卫 ${requirement.codes.join('/')} 不被该角色满足`);
        }
      }
    }
  });

  test('E2. 每个 canonical 角色的默认页签，其端点一定可调用（这是 403 的根因断言）', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      const request = manufacturingAnalyticsRequest(permissions, 'wip');
      if (!request) continue; // 无任何页签权限 → 页面 fail closed，不发请求
      const { requirements } = backendGuard(request.endpoint);
      for (const requirement of requirements) {
        assert.ok(satisfies(requirement, permissions), `${roleId} 的默认页签 ${request.key} 需要 ${requirement.codes.join('/')}，该角色没有`);
      }
    }
  });

  test('E3. 会计角色的默认页签是「生产成本」，不是「在制」', () => {
    const permissions = permissionsOf('role-accounting');
    assert.ok(!permissions.includes('PRODUCTION_ORDERS_VIEW'), '会计角色不应持有 PRODUCTION_ORDERS_VIEW');
    assert.ok(permissions.includes('PRODUCTION_COSTS_VIEW'), '会计角色应持有 PRODUCTION_COSTS_VIEW');
    assert.equal(effectiveManufacturingAnalyticsTab(permissions, 'wip'), 'cost');
  });

  test('E4. 每个 canonical 角色加载的参照端点，其守卫都被该角色满足', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      for (const ref of permittedPriceOverrideReferences(permissions)) {
        const { requirements } = backendGuard(ref.endpoint);
        for (const requirement of requirements) {
          assert.ok(satisfies(requirement, permissions), `${roleId} 加载参照 ${ref.key} 的守卫 ${requirement.codes.join('/')} 不被该角色满足`);
        }
      }
    }
  });

  test('E5. 会计角色不加载任何参照（一次请求都不发）', () => {
    const permissions = permissionsOf('role-accounting');
    assert.equal(priceOverrideReferenceAccess(permissions).any, false);
  });

  test('E6. 销售与审核角色可加载参照，且其端点守卫权限齐备', () => {
    for (const roleId of ['role-sales', 'role-reviewer']) {
      const permissions = permissionsOf(roleId);
      const access = priceOverrideReferenceAccess(permissions);
      assert.equal(access.any, true, `${roleId} 应可读取参照`);
      assert.equal(access.customers, true);
      assert.equal(access.products, true);
    }
  });
});

// ---------------------------------------------------------------------------
// 平台级合同（Requirement §36.18，PL-EXPOSURE-01..07）。
// 这组断言把「三个域各自修过一次的同一缺陷形态」收敛为一条平台级不变式：
// 角色可见某条 route ⇒ 该 route 首屏与页签打开时发出的请求全部落在该角色的权限内。
// ---------------------------------------------------------------------------

const INVENTORY_ROUTE_KEY = 'inventory';
/** 本域 21 个页签的 key 与标签在 §32.13 中被锁定为「只改可见性、不改集合」。 */
const INVENTORY_WORK_TAB_LABELS = [
  ['instant', '即时库存'], ['bins', '仓位'], ['statuses', '库存状态'], ['owners', '所有权'],
  ['parameters', '库存参数'], ['stocktake', '盘点'], ['lot', '批号调整'], ['form', '形态转换'],
  ['assembly', '组装拆卸'], ['abc', 'ABC'], ['barcode', '条码'], ['containers', '容器'],
  ['scan', '扫码'], ['transfer', '调拨'], ['adjustment', '调整'], ['initialization', '初始化与期初'],
  ['native', '其他出入库'], ['step', '分步调拨'], ['status', '状态调整'], ['locks', '锁库'],
  ['reports', '库存报表'],
];

/** 前端登记条目 → 与后端守卫同形的口径。 */
function declaredGuard(entry) {
  if (Array.isArray(entry.permissions)) return { kind: 'any', codes: [...entry.permissions] };
  if (typeof entry.permission === 'string') return { kind: 'all', codes: [entry.permission] };
  return null;
}

/** 后端实际守卫 → 同形口径。 */
function backendGuardShape(method, endpoint) {
  const guard = resolveBackendGuard(method, endpoint);
  assert.ok(guard, `${method} ${endpoint} 在后端没有可解析的权限守卫`);
  return { kind: guard.kind, codes: [...guard.codes] };
}

describe('F. 平台级：登记必须与后端实际守卫逐项一致（PL-EXPOSURE-01 / 02）', () => {
  test('F1. 生产执行分析的页签登记与后端守卫逐项一致', () => {
    for (const tab of MANUFACTURING_ANALYTICS_TABS) {
      assert.deepEqual(
        backendGuardShape('GET', tab.endpoint),
        declaredGuard(tab),
        `页签 ${tab.key} 的登记与后端守卫不一致`,
      );
    }
  });

  test('F2. 价格覆盖授权的参照登记与后端守卫逐项一致', () => {
    for (const ref of SALES_PRICE_OVERRIDE_REFERENCES) {
      assert.deepEqual(
        backendGuardShape('GET', ref.endpoint),
        declaredGuard(ref),
        `参照 ${ref.key} 的登记与后端守卫不一致`,
      );
    }
  });

  test('F3. 库存作业的参照登记与后端守卫逐项一致', () => {
    for (const ref of INVENTORY_WORK_REFERENCES) {
      assert.deepEqual(
        backendGuardShape('GET', ref.endpoint),
        declaredGuard(ref),
        `参照 ${ref.key} 的登记与后端守卫不一致`,
      );
    }
  });

  test('F4. 库存作业的页签读取登记与后端守卫逐项一致', () => {
    for (const tab of INVENTORY_WORK_TABS) {
      for (const read of tab.reads || []) {
        assert.deepEqual(
          backendGuardShape('GET', read.endpoint),
          { kind: read.kind, codes: [...read.codes] },
          `页签 ${tab.key} 的读取登记 ${read.endpoint} 与后端守卫不一致`,
        );
      }
    }
  });

  test('F5. 登记模块内部的 key 与端点各自唯一', () => {
    const groups = [MANUFACTURING_ANALYTICS_TABS, SALES_PRICE_OVERRIDE_REFERENCES, INVENTORY_WORK_REFERENCES];
    for (const group of groups) {
      const keys = group.map((item) => item.key);
      assert.equal(new Set(keys).size, keys.length, '登记条目 key 必须唯一');
      const endpoints = group.map((item) => item.endpoint);
      assert.equal(new Set(endpoints).size, endpoints.length, '同一登记模块内的端点不得重复登记');
    }
    // 跨模块复用同一端点是允许的（例如 /api/products 同时是价格覆盖授权与库存作业的依赖）：
    // 单一事实来源的口径是「一条 route 的依赖只有一个登记处」，不是「一个端点只能被登记一次」。
  });
});

describe('G. 平台级：逐角色的请求集合必须落在该角色权限内（PL-EXPOSURE-03）', () => {
  let db;
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-route-api-authority-'));
    db = createDatabase(join(tempDir, 'erp.db'));
  });

  after(() => {
    try { db?.close?.(); } catch { /* 关闭失败不影响结论 */ }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const permissionsOf = (roleId) => db
    .prepare('SELECT permission_code FROM role_permissions WHERE role_id=?')
    .all(roleId)
    .map((row) => row.permission_code);

  test('G1. 每个 canonical 角色可加载的库存参照，其后端守卫都被该角色满足', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      for (const ref of permittedInventoryWorkReferences(permissions)) {
        const guard = backendGuardShape('GET', ref.endpoint);
        assert.ok(satisfies(guard, permissions), `${roleId} 加载参照 ${ref.key} 时守卫不被满足`);
      }
    }
  });

  test('G2. 每个 canonical 角色可打开的库存页签，其全部读取端点的守卫都被该角色满足', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      for (const tab of permittedInventoryWorkTabs(permissions)) {
        for (const read of tab.reads || []) {
          const guard = backendGuardShape('GET', read.endpoint);
          assert.ok(satisfies(guard, permissions), `${roleId} 打开页签 ${tab.key} 时 ${read.endpoint} 的守卫不被满足`);
        }
      }
    }
  });

  test('G3. 不可打开的页签，必然存在一个该角色读不了的读取端点', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      for (const tab of INVENTORY_WORK_TABS) {
        if (canOpenInventoryWorkTab(tab, permissions)) continue;
        const unreadable = (tab.reads || []).some((read) => {
          const guard = backendGuardShape('GET', read.endpoint);
          return !satisfies(guard, permissions);
        });
        assert.ok(unreadable, `${roleId} 不该被隐藏页签 ${tab.key} —— 它读得了全部读取端点`);
      }
    }
  });

  test('G4. 审核员在库存作业内看不到需要库存子域读取权限的页签', () => {
    const permissions = permissionsOf('role-reviewer');
    const permitted = permittedInventoryWorkTabs(permissions).map((tab) => tab.key);
    for (const key of ['bins', 'statuses', 'owners', 'parameters', 'adjustment', 'initialization', 'native', 'locks', 'assembly', 'barcode']) {
      assert.ok(!permitted.includes(key), `审核员不应看到页签 ${key}（它需要该角色没有的读取权限）`);
    }
    assert.ok(permitted.includes('instant'), '审核员应能看到「即时库存」（INVENTORY_VIEW）');
    assert.ok(permitted.includes('stocktake'), '审核员应能看到「盘点」（INVENTORY_VIEW）');
  });

  test('G5. 生效页签必须是可打开的页签；可进入该 route 的角色必有生效页签', () => {
    for (const roleId of CANONICAL_ROLES) {
      const permissions = permissionsOf(roleId);
      const effective = effectiveInventoryWorkTab(permissions, 'bins');
      assert.ok(effective, `${roleId} 至少应有一个可打开的页签`);
      const tab = INVENTORY_WORK_TABS.find((item) => item.key === effective);
      assert.ok(canOpenInventoryWorkTab(tab, permissions), `${roleId} 的生效页签 ${effective} 必须可打开`);
    }
    // `inventory` route 的 exposure 是 INVENTORY_VIEW，而「即时库存」页签的读取守卫也是
    // INVENTORY_VIEW —— 因此凡能进入该 route 的角色，必有可打开的页签，页面不会走到 fail closed 分支。
    const inventoryExposure = readSource('src/navigation/applicationRegistry.js')
      .split('\n').find((item) => item.includes("route('inventory'"))
      ?.match(/\{any:\[([^\]]*)\]/)?.[1] || '';
    assert.ok(inventoryExposure.includes('INVENTORY_VIEW'), 'inventory 的 exposure 必须是 INVENTORY_VIEW');
  });

  test('G6. 无参照读取权限时一次请求都不发，且无权态与空态可区分', async () => {
    const calls = [];
    const result = await loadInventoryWorkReferences(['INVENTORY_VIEW'], async (endpoint) => {
      calls.push(endpoint); return {};
    });
    assert.deepEqual(calls, [], '无参照读取权限时不得发起任何请求');
    assert.deepEqual(result.loaded, []);
    const access = inventoryWorkReferenceAccess(['INVENTORY_VIEW']);
    assert.equal(access.any, false);
    assert.equal(access.warehouses, false);
    assert.equal(access.products, false);
    assert.equal(access.stockStatuses, false);
    assert.equal(access.bins, false);
  });

  test('G7. 只有仓库读取权时只请求仓库参照，其余数据源一次请求都不发', async () => {
    const calls = [];
    const result = await loadInventoryWorkReferences(['WAREHOUSES_VIEW'], async (endpoint) => {
      calls.push(endpoint); return { warehouses: [{ id: 'w1' }] };
    });
    assert.deepEqual(calls, ['/api/warehouses']);
    assert.deepEqual(result.loaded, ['warehouses']);
    assert.equal(result.references.warehouses.length, 1);
    assert.deepEqual(result.references.bins, []);
    const access = inventoryWorkReferenceAccess(['WAREHOUSES_VIEW']);
    assert.equal(access.warehouses, true);
    assert.equal(access.bins, false);
    assert.equal(access.any, true);
  });
});

describe('H. 页面必须使用唯一登记，不得自带第二份端点清单（PL-EXPOSURE-01）', () => {
  test('H1. 库存工作面的参照加载不得自带端点清单', () => {
    const source = readSource('src/pages/inventory-work.jsx');
    assert.ok(source.includes("from '../lib/inventoryWorkReferences.js'"), '页面必须引用唯一登记模块');
    assert.ok(source.includes("from '../lib/inventoryWorkTabs.js'"), '页面必须引用唯一页签登记模块');
    const loader = plainFunctionBody('src/pages/inventory-work.jsx', 'useInventoryReferences');
    for (const ref of INVENTORY_WORK_REFERENCES) {
      assert.ok(!loader.includes(ref.endpoint), `参照加载不得自行调用 ${ref.endpoint}`);
    }
  });

  test('H1b. 页签登记的读取端点必须在页面中真实出现（登记不得凭空声明）', () => {
    const source = readSource('src/pages/inventory-work.jsx');
    for (const tab of INVENTORY_WORK_TABS) {
      for (const read of tab.reads || []) {
        assert.ok(source.includes(read.endpoint), `页签 ${tab.key} 登记的读取端点 ${read.endpoint} 未在页面出现`);
      }
    }
  });

  test('H2. 库存工作面的页签标签必须来自登记模块，不得在页面内维护第二份清单', () => {
    const source = readSource('src/pages/inventory-work.jsx');
    assert.ok(!source.includes('const WORK_TABS'), '页面不得维护第二份页签清单');
    for (const [key, label] of INVENTORY_WORK_TAB_LABELS) {
      const tab = INVENTORY_WORK_TABS.find((item) => item.key === key);
      assert.ok(tab, `页签登记缺少 ${key}`);
      assert.equal(tab.label, label, `页签 ${key} 的标签被改动`);
    }
    assert.equal(INVENTORY_WORK_TABS.length, INVENTORY_WORK_TAB_LABELS.length, '页签数量被改动');
  });

  test('H3. 库存 route 的 exposure 未被改动（PL-EXPOSURE-04）', () => {
    const source = readSource('src/navigation/applicationRegistry.js');
    const line = source.split('\n').find((item) => item.includes(`route('${INVENTORY_ROUTE_KEY}'`));
    assert.ok(line, 'registry 未登记 route inventory');
    const group = line.match(/\{(any|permission):\s*(\[[^\]]*\]|'[A-Z0-9_]+')/);
    assert.ok(group, '无法解析 inventory 的 exposure');
    assert.deepEqual([...group[2].matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]), ['INVENTORY_VIEW']);
  });
});
