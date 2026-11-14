// Canonical 浏览器发布门禁（PL-RI-04）。
//
// 目的：用一个**统一**门禁覆盖四档 mobile-first 宽度 × 五类 canonical 角色，
// 而不是让各业务域的 UAT 脚本各自为政。
//
// 合同（Requirement §36.16.5、Design §32.16.6）：
//   1. route key、权限 exposure 与当前移动端 tab 一律取自
//      `src/navigation/applicationRegistry.js` —— 脚本内**不**维护第二份 route 清单；
//   2. 角色夹具**只声明权限集合**；期望可见的 route 由 registry 的 access predicate 计算，
//      direct URL 由 `applicationRouteFor()` 生成；
//   3. 基线 390 CSS px，必须同时覆盖 320 / 390 / 430 / 680；
//   4. 每类角色都要验证：launcher 可见性、direct URL / refresh、权限拒绝、
//      无整页横向滚动、关键控件触控高度、浏览器错误；
//   5. 失败分三类 —— `PRODUCT_FAILURE` / `FIXTURE_FAILURE` / `CONTRACT_DRIFT`，
//      **三类都非零**；被中止、缺角色、缺尺寸或未验证 direct URL 一律 `INCOMPLETE`，
//      不得产生 PASS 结论；
//   6. 无 `NOTIFICATION_VIEW` / `WORKFLOW_TASK_VIEW` 的账号不得产生预期外 403 ——
//      门禁**不**把这类 403 放进 allowlist。
//
// 用法：node scripts/acceptance/release-browser-readiness.mjs [--roles admin,sales,...]
// 退出码：0 = 全部通过；1 = 有失败；2 = 门禁自身无法完成（INCOMPLETE）。

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase, hashPassword } from '../../server/db.js';
import {
  ACTIVE_APPLICATION_ROUTES, applicationRouteFor, userCanAccessRoute,
} from '../../src/navigation/applicationRegistry.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIN_TARGET = 44;

/** 门禁夹具账号的密码（临时库内使用，不进入任何证据文件）。 */
const GATE_PASSWORD = 'rel-readiness-gate';

/** mobile-first 四档：基线 390 必须覆盖，桌面宽度可补充但不能替代。 */
const VIEWPORTS = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 680, height: 900 },
];

/**
 * 五类 canonical 角色。
 *
 * 这里只声明**角色身份**（canonical role code），**不**声明权限集合，
 * 更不声明 must / deny route 的第二份清单：
 *   - 权限集合取自仓库种子的 canonical 角色（`role_permissions`）；
 *   - 期望可见的 route 由 registry 的 access predicate 计算。
 * 这样门禁测的是**真实产品角色**，而不是脚本自己造出来的权限宇宙。
 */
const ROLES = [
  { key: 'admin', roleCode: 'ADMIN', label: '管理员' },
  { key: 'sales', roleCode: 'SALES', label: '销售' },
  { key: 'reviewer', roleCode: 'REVIEWER', label: '业务审核员' },
  { key: 'warehouse', roleCode: 'WAREHOUSE', label: '仓管员' },
  { key: 'accounting', roleCode: 'ACCOUNTING', label: '会计' },
];

/** 判定分类。 */
const PRODUCT_FAILURE = 'PRODUCT_FAILURE';
const FIXTURE_FAILURE = 'FIXTURE_FAILURE';
const CONTRACT_DRIFT = 'CONTRACT_DRIFT';

const results = [];
let failures = 0;
let incomplete = false;

function record({ role, width, route, check, ok, classification, detail, notApplicable = false }) {
  results.push({ role, width, route, check, ok, classification, detail, notApplicable });
  if (!ok) {
    failures += 1;
    process.stdout.write(`FAIL ${role} ${width}px ${route} ${check} [${classification}] ${detail}\n`);
  }
}

function parseArgs(argv) {
  const args = { roles: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--roles') args.roles = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

/** 角色 fixture：复用仓库种子的 canonical 角色，只新增夹具账号。 */
function seedRoleFixtures(db, roles) {
  const now = new Date().toISOString();
  for (const role of roles) {
    const seeded = db.prepare('SELECT id FROM roles WHERE code=?').get(role.roleCode);
    if (!seeded) {
      role.fixtureError = `canonical 角色 ${role.roleCode} 不存在`;
      continue;
    }
    role.roleId = seeded.id;
    role.permissions = db.prepare('SELECT permission_code FROM role_permissions WHERE role_id=?').all(seeded.id)
      .map((row) => row.permission_code);
    const userId = `usr-rel-${role.key}`;
    // 用户名必须与既有种子账号区分：`INSERT OR REPLACE` 会先删除同名旧行，
    // 而旧行被其他表引用时会触发外键失败。
    const username = `rel-${role.key}`;
    const credentials = hashPassword(GATE_PASSWORD);
    db.prepare(`INSERT OR REPLACE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,?,1,?)`)
      .run(userId, username, role.label, credentials.hash, credentials.salt, seeded.id, now);
    role.userId = userId;
    role.username = username;
  }
}

/** 该角色按 registry access predicate 可见的 route。 */
function visibleRoutesFor(role) {
  const user = { permissions: role.permissions || [] };
  return ACTIVE_APPLICATION_ROUTES.filter((route) => {
    const access = route.access || {};
    const codes = access.permission ? [access.permission] : (access.any || []);
    if (!codes.length) return true;
    return codes.some((code) => user.permissions.includes(code));
  });
}

/** 该角色**不可**见的、但确实存在于 registry 的 route（用于权限拒绝验证）。 */
function deniedRoutesFor(role) {
  const visible = new Set(visibleRoutesFor(role).map((route) => route.key));
  return ACTIVE_APPLICATION_ROUTES.filter((route) => !visible.has(route.key));
}

/** 采集页面事实：渲染标记、横向溢出、触控目标。 */
async function measure(page) {
  return page.evaluate((minTarget) => {
    const painted = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const view = document.querySelector('[data-testid^="mobile-application-view"], [data-testid^="route-state-"]');
    const state = document.querySelector('[data-testid^="route-state-"]');
    const interactive = Array.from(document.querySelectorAll('button, a[href], [role="button"], input, select, textarea'))
      .filter(painted);
    const undersized = interactive
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          testid: node.getAttribute('data-testid') || null,
          tag: node.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((item) => item.width < minTarget || item.height < minTarget);
    return {
      rendered: Boolean(view),
      state: state ? state.getAttribute('data-testid') : null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      undersized,
      interactiveCount: interactive.length,
      launcherVisible: Boolean(document.querySelector('[data-testid="v16-launcher"]')),
    };
  }, MIN_TARGET);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roles = args.roles ? ROLES.filter((role) => args.roles.includes(role.key)) : ROLES;
  if (!roles.length) {
    process.stderr.write('没有匹配到任何角色；门禁无法完成。\n');
    process.exit(2);
  }
  if (roles.length !== ROLES.length) {
    process.stderr.write(`角色集合不完整（${roles.length}/${ROLES.length}）：门禁不得给出 PASS 结论。\n`);
    incomplete = true;
  }
  if (VIEWPORTS.length !== 4 || !VIEWPORTS.some((v) => v.width === 390)) {
    process.stderr.write('宽度集合不完整或缺少 390 基线：门禁不得给出 PASS 结论。\n');
    incomplete = true;
  }

  const dbTempDir = mkdtempSync(join(tmpdir(), 'modern-erp-release-readiness-'));
  const db = createDatabase(join(dbTempDir, 'erp.db'));
  seedRoleFixtures(db, roles);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    for (const role of roles) {
      if (role.fixtureError) {
        record({
          role: role.key, width: 390, route: '(fixture)', check: 'canonical 角色存在',
          ok: false, classification: FIXTURE_FAILURE,
          detail: role.fixtureError,
        });
        continue;
      }
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: role.username, password: GATE_PASSWORD }),
      });
      if (!loginResponse.ok) {
        record({
          role: role.key, width: 390, route: '(login)', check: '角色可登录',
          ok: false, classification: FIXTURE_FAILURE,
          detail: `登录失败: ${loginResponse.status}`,
        });
        continue;
      }
      const { token, user } = await loginResponse.json();

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.evaluate((value) => localStorage.setItem('modern_erp_token', value), token);
      await page.reload({ waitUntil: 'networkidle' });

      const visible = visibleRoutesFor(role);
      const denied = deniedRoutesFor(role);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);

        /* 1. launcher 可见性 */
        await page.goto(`${baseUrl}#`, { waitUntil: 'networkidle' });
        const launcher = await page.evaluate(() => ({
          visible: Boolean(document.querySelector('[data-testid="v16-launcher"]')),
          tiles: document.querySelectorAll('[data-testid^="v16-launcher-tile-"]').length,
        }));
        record({
          role: role.key, width: viewport.width, route: '(launcher)', check: 'launcher 可见',
          ok: launcher.visible && launcher.tiles > 0,
          classification: PRODUCT_FAILURE,
          detail: launcher.visible ? `可见，${launcher.tiles} 个入口` : 'launcher 未渲染',
        });

        /* 2. 每个可见 route 的 direct URL + refresh */
        for (const route of visible) {
          const errors = [];
          const badResponses = [];
          const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()); };
          const onPageError = (error) => errors.push(error.message);
          const onResponse = (response) => {
            if (response.url().includes('/api/') && response.status() >= 400) {
              badResponses.push(`${response.status()} ${response.url().split('/api')[1]}`);
            }
          };
          page.on('console', onConsole);
          page.on('pageerror', onPageError);
          page.on('response', onResponse);

          const target = applicationRouteFor(route.key);
          if (!target) {
            record({
              role: role.key, width: viewport.width, route: route.key, check: 'direct URL 可解析',
              ok: false, classification: CONTRACT_DRIFT,
              detail: 'applicationRouteFor() 返回 null：registry 与门禁不一致',
            });
            continue;
          }
          await page.goto(`${baseUrl}#${route.key}`, { waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForTimeout(300);
          const direct = await measure(page);
          const driftState = direct.state && direct.state.startsWith('route-state-')
            && direct.state !== 'route-state-permission_denied' ? CONTRACT_DRIFT
            : direct.state === 'route-state-permission_denied' ? CONTRACT_DRIFT
              : PRODUCT_FAILURE;
          record({
            role: role.key, width: viewport.width, route: route.key, check: 'direct URL 渲染',
            ok: direct.rendered && !direct.state,
            classification: driftState,
            detail: direct.rendered ? `state=${direct.state || '(已渲染)'}` : '页面没有画出任何路由内容',
          });
          record({
            role: role.key, width: viewport.width, route: route.key, check: '无整页横向滚动',
            ok: !direct.overflow,
            classification: PRODUCT_FAILURE,
            detail: direct.overflow ? `scrollWidth=${direct.scrollWidth} clientWidth=${direct.clientWidth}` : '',
          });
          record({
            role: role.key, width: viewport.width, route: route.key, check: '关键控件触控高度 ≥44px',
            ok: direct.undersized.length === 0,
            classification: PRODUCT_FAILURE,
            detail: direct.undersized.length ? JSON.stringify(direct.undersized.slice(0, 3)) : '',
          });
          record({
            role: role.key, width: viewport.width, route: route.key, check: '无浏览器错误',
            ok: errors.length === 0,
            classification: PRODUCT_FAILURE,
            detail: errors.slice(0, 2).join(' | '),
          });
          record({
            role: role.key, width: viewport.width, route: route.key, check: '无预期外 4xx/5xx',
            ok: badResponses.length === 0,
            classification: PRODUCT_FAILURE,
            detail: badResponses.slice(0, 3).join(' | '),
          });

          /* refresh */
          await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForTimeout(300);
          const afterRefresh = await measure(page);
          record({
            role: role.key, width: viewport.width, route: route.key, check: 'refresh 后仍渲染',
            ok: afterRefresh.rendered && !afterRefresh.state,
            classification: PRODUCT_FAILURE,
            detail: afterRefresh.rendered ? `state=${afterRefresh.state || '(已渲染)'}` : '刷新后没有内容',
          });

          /* Back / Forward */
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
          await page.goForward({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(200);
          const afterHistory = await measure(page);
          record({
            role: role.key, width: viewport.width, route: route.key, check: 'Back/Forward 后仍渲染',
            ok: afterHistory.rendered,
            classification: PRODUCT_FAILURE,
            detail: afterHistory.rendered ? '' : '前进后退后没有内容',
          });

          page.off('console', onConsole);
          page.off('pageerror', onPageError);
          page.off('response', onResponse);
        }

        /* 3. 权限拒绝：无权 route 必须 fail closed */
        const deniedRoute = denied[0];
        if (deniedRoute) {
          await page.goto(`${baseUrl}#${deniedRoute.key}`, { waitUntil: 'networkidle', timeout: 20_000 });
          await page.waitForTimeout(300);
          const denial = await measure(page);
          record({
            role: role.key, width: viewport.width, route: deniedRoute.key, check: '无权 route 必须 fail closed',
            ok: denial.state === 'route-state-permission_denied',
            classification: PRODUCT_FAILURE,
            detail: denial.state === 'route-state-permission_denied' ? '' : `state=${denial.state || '(未渲染拒绝态)'}`,
          });
        } else {
          // 该角色可见全部 route（例如管理员）：权限拒绝对它**不适用**。
          // 它的拒绝语义由上面的「direct URL 渲染」检查覆盖 ——
          // 可见 route 不得被渲染成 permission_denied。
          record({
            role: role.key, width: viewport.width, route: '(none)', check: '存在可验证的拒绝 route',
            ok: true, classification: FIXTURE_FAILURE, notApplicable: true,
            detail: '该角色可见全部 route：权限拒绝不适用（由 direct URL 不得误判为拒绝覆盖）',
          });
        }
      }
      void user;
    }
  } catch (error) {
    incomplete = true;
    process.stderr.write(`门禁未能完成: ${error.message}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    db.close();
    rmSync(dbTempDir, { recursive: true, force: true });
  }

  const byClass = (cls) => results.filter((r) => !r.ok && r.classification === cls).length;
  process.stdout.write('\n=== 结论 ===\n');
  process.stdout.write(`判定 ${results.length} 项，失败 ${failures} 项\n`);
  process.stdout.write(`PRODUCT_FAILURE=${byClass(PRODUCT_FAILURE)} FIXTURE_FAILURE=${byClass(FIXTURE_FAILURE)} CONTRACT_DRIFT=${byClass(CONTRACT_DRIFT)}\n`);
  process.stdout.write(`角色 ${roles.length}/${ROLES.length}，宽度 ${VIEWPORTS.length}/4\n`);
  if (incomplete) {
    process.stdout.write('INCOMPLETE: 门禁未覆盖全部角色或宽度，不得产生 PASS 结论\n');
    process.exit(2);
  }
  if (failures) {
    process.stdout.write('FAIL: canonical 浏览器门禁未通过\n');
    process.exit(1);
  }
  process.stdout.write('PASS: canonical 浏览器门禁全部通过\n');
}

main();
