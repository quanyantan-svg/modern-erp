// 导航可达性守卫（Requirement §36.19 PL-NAVI-01..06 / Design §32.19.4）。
//
// 目的：一条 canonical route 存在、页面能渲染、权限也正确，但如果**没有任何用户界面
// 入口**，最终用户就永远到不了它 —— 2026-10-06 的 commit c77616b 删除
// `utility-system`（系统设置）分组后，「用户与权限」就是这样从界面上消失的，
// 而当时唯一的相关测试反而把「Platform 不得进入启动器」锁成了不变量。
//
// 判定模型（四条可达路径，全部从单一事实来源计算，不依赖任何一次浏览器门禁输出）：
//   ① launcher —— route key 出现在启动器某个分组的条目里；
//   ② tab      —— route 由底部页签承载；
//   ③ parent   —— registry 声明了 parentRoute；
//   ④ link     —— 页面里的导航构造引用了该 route key。
//
// 输三张必须为空的清单：
//   UNREACHABLE_ROUTES      —— 四条路径全部落空的 active route；
//   MISSING_DOMAIN_GROUPS   —— 没有启动器分组的域；
//   NON_CHINESE_GROUP_LABELS —— 标题含英文字母的分组。
//
// 「仅直达 URL」登记：确需保留的 route 必须登记在 DIRECT_URL_ONLY_ROUTES 中，
// 并同时命中路径 ④（有真实链接来源）。登记一个没有链接来源的 route 即失败。
//
// 只读：不连数据库、不写仓库、不改任何业务数据。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');

const { ACTIVE_APPLICATION_ROUTES, APPLICATION_LAUNCHER_GROUPS } = await import(
  pathToFileURL(resolve(root, 'src', 'navigation', 'applicationRegistry.js')).href
);
const { DOMAIN_DEFINITIONS } = await import(
  pathToFileURL(resolve(root, 'src', 'navigation', 'domainMetadata.js')).href
);

/**
 * 确需「仅直达 URL」的 route。每条必须写明理由，且必须在路径 ④（页面内链接）里
 * 找到真实链接来源 —— 否则登记本身失效，守卫转红。
 * 当前为空：本轮修整后 93 条 active route 全部可达。
 */
const DIRECT_URL_ONLY_ROUTES = Object.freeze([]);

/** MobileShell 的 5 个底部页签中承载 route 的 4 个（profile 不承载 route）。 */
const TAB_ROUTES = Object.freeze(['notifications', 'approvals', 'dashboard', 'workflow-tasks']);

/**
 * 路径 ④ 的导航构造判据。只认这些确定性形态，避免「页面上出现过这个字符串」
 * 这类宽判据把 `StatusChip domain="lifecycle"` 之类的状态展示域误判成导航目标。
 */
const NAVIGATION_CONSTRUCTS = Object.freeze([
  /navigateToPage\(\s*['"]([a-z0-9-]+)['"]/g,
  /navigate\(\s*['"]([a-z0-9-]+)['"]/g,
  /hrefFor\(\s*['"]([a-z0-9-]+)['"]/g,
  /canNavigate\(\s*['"]([a-z0-9-]+)['"]/g,
  /\bpage:\s*['"]([a-z0-9-]+)['"]/g,
  /\bpage=['"]([a-z0-9-]+)['"]/g,
  /\brouteKey:\s*['"]([a-z0-9-]+)['"]/g,
  /\bstep\([^)]*?['"]([a-z0-9-]+)['"]\s*\)/g,
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function collectLinkSources() {
  const sources = new Map();
  const files = [...walk(resolve(root, 'src', 'pages')), ...walk(resolve(root, 'src', 'components'))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of NAVIGATION_CONSTRUCTS) {
      for (const match of text.matchAll(pattern)) {
        const key = match[1];
        if (!sources.has(key)) sources.set(key, new Set());
        sources.get(key).add(relative(root, file).replace(/\\/g, '/'));
      }
    }
  }
  return sources;
}

const launcherGroups = new Map();
for (const group of APPLICATION_LAUNCHER_GROUPS) {
  for (const item of group.items) {
    if (!launcherGroups.has(item.routeKey)) launcherGroups.set(item.routeKey, []);
    launcherGroups.get(item.routeKey).push(group.key);
  }
}

const linkSources = collectLinkSources();
const tabRoutes = new Set(TAB_ROUTES);
const registeredDirectOnly = new Map(DIRECT_URL_ONLY_ROUTES.map((entry) => [entry.routeKey, entry.reason]));

const unreachable = [];
for (const route of ACTIVE_APPLICATION_ROUTES) {
  if (!route.enabled) continue;
  const paths = [];
  if (launcherGroups.has(route.key)) paths.push('launcher');
  if (tabRoutes.has(route.key)) paths.push('tab');
  if (route.parentRoute) paths.push('parent');
  if (linkSources.has(route.key)) paths.push('link');
  if (paths.length) continue;
  if (registeredDirectOnly.has(route.key)) {
    // 登记项必须同时有真实链接来源，否则登记无效。
    if (!linkSources.has(route.key)) {
      unreachable.push({ key: route.key, reason: `登记为仅直达 URL，但路径 ④ 没有链接来源：${registeredDirectOnly.get(route.key)}` });
    }
    continue;
  }
  unreachable.push({ key: route.key, reason: '四条可达路径全部落空' });
}

const groupKeys = new Set(APPLICATION_LAUNCHER_GROUPS.map((group) => group.key));
const missingDomainGroups = DOMAIN_DEFINITIONS
  .filter((domain) => !groupKeys.has(domain.key))
  .map((domain) => `${domain.key}（${domain.navigationLabel}）`);

const nonChineseGroupLabels = APPLICATION_LAUNCHER_GROUPS
  .filter((group) => /[A-Za-z]/.test(group.label))
  .map((group) => `${group.key}：${group.label}`);

/**
 * 守卫结论。回归测试直接 import 本函数 —— 不在测试进程里再拉起子进程，
 * 避免在 FULL 门禁的并行负载下额外占用进程与内存。
 */
export function collectNavigationReport() {
  return {
    activeRoutes: ACTIVE_APPLICATION_ROUTES.length,
    launcherCovered: launcherGroups.size,
    launcherGroups: APPLICATION_LAUNCHER_GROUPS.length,
    domains: DOMAIN_DEFINITIONS.length,
    UNREACHABLE_ROUTES: unreachable,
    MISSING_DOMAIN_GROUPS: missingDomainGroups,
    NON_CHINESE_GROUP_LABELS: nonChineseGroupLabels,
  };
}

/** 三张清单必须全部为空；返回非零项数。 */
export function navigationFailures(report = collectNavigationReport()) {
  return report.UNREACHABLE_ROUTES.length
    + report.MISSING_DOMAIN_GROUPS.length
    + report.NON_CHINESE_GROUP_LABELS.length;
}

function main() {
  const report = collectNavigationReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const failed = navigationFailures(report);
  if (failed) {
    process.stdout.write(`\n导航可达性守卫失败：${failed} 项必须为空\n`);
    process.exit(1);
  }
  process.stdout.write('\n导航可达性守卫 PASS：不可达 route / 缺分组域 / 非中文分组标题 三张清单均为空\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
