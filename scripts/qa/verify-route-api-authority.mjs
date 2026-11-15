// Route 首屏 API 授权一致性穷尽枚举（PL-EXPOSURE-06）。
//
// 目的：判定「route 声明的 exposure 权限集合未覆盖该页面自身依赖的 API 权限集合」
// 这一缺陷形态是否已消除，并产出**可复跑的穷尽清单**。
//
// 为什么需要它：canonical 浏览器门禁（`scripts/acceptance/release-browser-readiness.mjs`）
// 用 hash 跳转 + Back/Forward 遍历 route，其 FAIL 清单会随运行时序漂移
// （同一份代码两次跑的失败列表不同），因此**单次门禁输出不能作为「缺陷已穷尽枚举」的证据**
// （见 `docs/status/PROJECT_STATUS.md` §65.4 第 2 条、§67.6 第 2 条）。
// 本脚本对每个 (角色, route) 做**隔离 reload**，因此清单是确定的、可被第三方重放的。
//
// 合同来源：Requirement `docs/requirements/platform.md` §36.18（`PL-EXPOSURE-01..07`）。
//
// 用法：node scripts/qa/verify-route-api-authority.mjs [--roles admin,sales,...] [--tabs]
//   --tabs  额外逐个点击页面内的页签控件，记录点击后出现的 4xx/5xx（首屏之外的「功能被阻塞」）。
// 退出码：0 = 无非预期 4xx/5xx；1 = 存在非预期 4xx/5xx；2 = 枚举自身无法完成。
//
// 安全：只读枚举。临时 SQLite 库建在系统临时目录并在结束时删除；不写仓库、不连 MySQL、
// 不改动任何业务数据。

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');
const repoRequire = createRequire(pathToFileURL(resolve(root, 'package.json')).href);
const { chromium } = repoRequire('playwright-core');
const { createApp } = await import(pathToFileURL(resolve(root, 'server/app.js')).href);
const { createDatabase, hashPassword } = await import(pathToFileURL(resolve(root, 'server/db.js')).href);
const {
  ACTIVE_APPLICATION_ROUTES, applicationRouteFor,
} = await import(pathToFileURL(resolve(root, 'src/navigation/applicationRegistry.js')).href);

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/** 夹具账号口令：只存在于临时库内，不进入任何证据文件。 */
const FIXTURE_PASSWORD = 'route-api-authority-probe';

/**
 * 五类 canonical 角色。这里只声明**角色身份**，不声明权限集合 ——
 * 权限取自仓库种子的 canonical 角色，可见 route 由 registry 的 access predicate 计算，
 * 与 canonical 浏览器门禁同一口径，脚本内**不**维护第二份 route 或权限清单。
 */
const ROLES = [
  { key: 'admin', roleCode: 'ADMIN' },
  { key: 'sales', roleCode: 'SALES' },
  { key: 'reviewer', roleCode: 'REVIEWER' },
  { key: 'warehouse', roleCode: 'WAREHOUSE' },
  { key: 'accounting', roleCode: 'ACCOUNTING' },
];

function parseArgs(argv) {
  const args = { roles: null, tabs: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--roles') args.roles = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (argv[i] === '--tabs') args.tabs = true;
  }
  return args;
}

/**
 * 页签控件的选择器：语义化 tab 角色，以及位于导航 / 页签容器内的按钮。
 * 只覆盖「切换视图」类控件，不覆盖表单动作按钮。
 */
const TAB_CONTROL_SELECTOR = [
  '[role="tab"]',
  'nav[class*="tab"] button',
  '.tabs button',
  '[class*="segmented-control"] button',
  '[class*="tabs"] > button',
].join(', ');

function seedRoleFixtures(db, roles) {
  const now = new Date().toISOString();
  for (const role of roles) {
    const seeded = db.prepare('SELECT id FROM roles WHERE code=?').get(role.roleCode);
    if (!seeded) { role.fixtureError = `canonical 角色 ${role.roleCode} 不存在`; continue; }
    role.roleId = seeded.id;
    role.permissions = db.prepare('SELECT permission_code FROM role_permissions WHERE role_id=?').all(seeded.id)
      .map((row) => row.permission_code);
    const credentials = hashPassword(FIXTURE_PASSWORD);
    db.prepare(`INSERT OR REPLACE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,?,1,?)`)
      .run(`usr-authority-${role.key}`, `authority-${role.key}`, role.roleCode, credentials.hash, credentials.salt, seeded.id, now);
    role.username = `authority-${role.key}`;
  }
}

function visibleRoutesFor(role) {
  const held = new Set(role.permissions || []);
  return ACTIVE_APPLICATION_ROUTES.filter((route) => {
    const access = route.access || {};
    const codes = access.permission ? [access.permission] : (access.any || []);
    if (!codes.length) return true;
    return codes.some((code) => held.has(code));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roles = args.roles ? ROLES.filter((role) => args.roles.includes(role.key)) : ROLES;
  if (!roles.length) {
    process.stderr.write('没有匹配到任何角色；枚举无法完成。\n');
    process.exit(2);
  }
  const complete = roles.length === ROLES.length;

  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-route-api-authority-'));
  const db = createDatabase(join(tempDir, 'erp.db'));
  seedRoleFixtures(db, roles);
  const server = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const failures = [];
  const consoleErrors = [];
  let visits = 0;
  let tabClicks = 0;
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    for (const role of roles) {
      if (role.fixtureError) {
        failures.push({ role: role.key, route: '(fixture)', endpoint: '-', status: 0, detail: role.fixtureError });
        continue;
      }
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: role.username, password: FIXTURE_PASSWORD }),
      });
      if (!login.ok) {
        failures.push({ role: role.key, route: '(login)', endpoint: '-', status: login.status, detail: '角色无法登录' });
        continue;
      }
      const { token } = await login.json();

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);
      await page.reload({ waitUntil: 'networkidle' });

      for (const route of visibleRoutesFor(role)) {
        if (!applicationRouteFor(route.key)) {
          failures.push({ role: role.key, route: route.key, endpoint: '-', status: 0, detail: 'registry 与枚举不一致' });
          continue;
        }
        // 先导航到位，再挂监听后 reload —— 测的是「该 route 刷新后的首屏」。
        await page.goto(`${baseUrl}#${route.key}`, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
        const bad = [];
        const errors = [];
        const onResponse = (response) => {
          const url = response.url();
          if (!url.includes('/api/')) return;
          const path = url.slice(url.indexOf('/api'));
          if (response.status() >= 400) {
            bad.push({ endpoint: `${response.request().method()} ${path}`, status: response.status() });
          }
        };
        const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()); };
        const onPageError = (error) => errors.push(`pageerror: ${error.message}`);
        page.on('response', onResponse);
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
        await page.reload({ waitUntil: 'networkidle', timeout: 25_000 }).catch(() => {});
        await page.waitForTimeout(350);
        page.off('response', onResponse);
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        visits += 1;
        for (const item of new Map(bad.map((b) => [`${b.status} ${b.endpoint}`, b])).values()) {
          failures.push({ role: role.key, route: route.key, endpoint: item.endpoint, status: item.status, detail: '' });
        }
        for (const message of new Set(errors)) {
          consoleErrors.push({ role: role.key, route: route.key, message });
        }

        // --tabs：逐个点击页签控件，记录点击后出现的 4xx/5xx。
        // 首屏之外的功能被阻塞（例如「页签可点击但打开必 403」）只有这样才能枚举到。
        if (!args.tabs) continue;
        const tabLabels = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector))
          .map((node) => (node.textContent || '').trim().slice(0, 24)), TAB_CONTROL_SELECTOR);
        for (let index = 0; index < tabLabels.length; index += 1) {
          const tabBad = [];
          const onTabResponse = (response) => {
            const url = response.url();
            if (!url.includes('/api/')) return;
            const path = url.slice(url.indexOf('/api'));
            if (response.status() >= 400) {
              tabBad.push({ endpoint: `${response.request().method()} ${path}`, status: response.status() });
            }
          };
          page.on('response', onTabResponse);
          // 每次重新取句柄：切页签会重绘，句柄可能失效。
          const handles = await page.$$(TAB_CONTROL_SELECTOR);
          await handles[index]?.click({ timeout: 5_000 }).catch(() => {});
          tabClicks += 1;
          await page.waitForTimeout(1_200);
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(150);
          page.off('response', onTabResponse);
          for (const item of new Map(tabBad.map((b) => [`${b.status} ${b.endpoint}`, b])).values()) {
            failures.push({
              role: role.key, route: route.key, endpoint: item.endpoint, status: item.status,
              detail: `页签「${tabLabels[index]}」`,
            });
          }
        }
      }
    }
  } catch (error) {
    process.stderr.write(`枚举未能完成: ${error.message}\n`);
    await browser?.close().catch(() => {});
    server.close();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(2);
  }

  await browser.close().catch(() => {});
  server.close();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });

  console.log(`枚举 (角色, route) 组合 ${visits} 个`);
  console.log(`页签点击 ${tabClicks} 次${args.tabs ? '' : '（未启用 --tabs）'}`);
  console.log(`首屏非预期 4xx/5xx ${failures.length} 条；浏览器控制台错误 ${consoleErrors.length} 条`);
  if (failures.length) {
    console.log('非预期 4xx/5xx 明细：');
    for (const item of failures) {
      console.log(`  ${item.role} ${item.route} ${item.status} ${item.endpoint}${item.detail ? ` (${item.detail})` : ''}`);
    }
  }
  if (consoleErrors.length) {
    console.log('浏览器控制台错误明细：');
    for (const item of consoleErrors) console.log(`  ${item.role} ${item.route} ${item.message}`);
  }
  if (!complete) {
    console.log('INCOMPLETE: 角色集合不完整，不得产生 PASS 结论');
    process.exit(2);
  }
  if (failures.length || consoleErrors.length) {
    console.log('FAIL: 存在非预期 4xx/5xx 或浏览器错误');
    process.exit(1);
  }
  console.log('PASS: 全部 (角色, route) 首屏无非预期 4xx/5xx，且无浏览器错误');
}

main();
