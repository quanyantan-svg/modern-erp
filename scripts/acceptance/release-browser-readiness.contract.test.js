// PL-RI-04 —— canonical 浏览器门禁的**结构合同**回归。
//
// 门禁本身需要 Edge 与构建产物，无法在单元层运行；本文件锁定的是它的
// **静态合同**，防止后续修改把门禁悄悄退化：
//   1. route key / 权限 exposure 一律取自 `src/navigation/applicationRegistry.js`；
//   2. 脚本内**不得**出现第二份 route 清单或权限清单；
//   3. 宽度集合必须包含 390 基线与 320 / 430 / 680；
//   4. 角色集合必须覆盖五类 canonical 角色；
//   5. 三类失败分类与 INCOMPLETE 语义必须存在。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_APPLICATION_ROUTES, applicationRouteFor, userCanAccessRoute,
} from '../../src/navigation/applicationRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const GATE = join(here, 'release-browser-readiness.mjs');

function gateSource() {
  return readFileSync(GATE, 'utf8');
}

test('T1 门禁的 route / 权限来源必须是 canonical registry', () => {
  const source = gateSource();
  assert.ok(source.includes("from '../../src/navigation/applicationRegistry.js'"),
    '门禁必须从 applicationRegistry.js 导入');
  assert.ok(source.includes('ACTIVE_APPLICATION_ROUTES'), '门禁必须使用 registry 的 route 集合');
  assert.ok(source.includes('userCanAccessRoute'), '门禁必须使用 registry 的 access predicate');
  assert.ok(source.includes('applicationRouteFor'), '门禁必须用 registry 生成 direct URL');
});

test('T2 门禁内不得维护第二份 route 清单', () => {
  // 角色声明块里的角色键不是 route 清单，先剔除再扫描。
  const source = gateSource().replace(/const ROLES = \[[\s\S]*?\n\];/, '');
  // registry 里的 route key 不得在门禁源码里以字符串字面量出现（避免第二份清单）。
  const offenders = ACTIVE_APPLICATION_ROUTES
    .map((route) => route.key)
    .filter((key) => new RegExp(`['"\`]${key}['"\`]`).test(source));
  assert.deepEqual(offenders, [], `门禁不得硬编码 route key: ${offenders.join(', ')}`);
});

test('T3 门禁内不得维护第二份权限清单', () => {
  const source = gateSource();
  // 权限码必须来自仓库种子的 canonical 角色，不得在脚本里另写一份。
  assert.ok(!/permissions\s*:\s*\[/.test(source), '门禁不得声明自己的权限集合');
  assert.ok(source.includes('role_permissions'), '门禁必须从 canonical 角色读取权限集合');
});

test('T4 宽度集合覆盖 mobile-first 四档且含 390 基线', () => {
  const source = gateSource();
  for (const width of [320, 390, 430, 680]) {
    assert.ok(source.includes(`width: ${width}`), `门禁必须覆盖 ${width} CSS px`);
  }
});

test('T5 角色集合覆盖五类 canonical 角色', () => {
  const source = gateSource();
  for (const code of ['ADMIN', 'SALES', 'REVIEWER', 'WAREHOUSE', 'ACCOUNTING']) {
    assert.ok(source.includes(`'${code}'`), `门禁必须覆盖 canonical 角色 ${code}`);
  }
});

test('T6 三类失败分类与 INCOMPLETE 语义齐备', () => {
  const source = gateSource();
  assert.ok(source.includes('PRODUCT_FAILURE'));
  assert.ok(source.includes('FIXTURE_FAILURE'));
  assert.ok(source.includes('CONTRACT_DRIFT'));
  assert.ok(source.includes('INCOMPLETE'));
});

test('T7 registry 投影自洽：可见 route 必须能被 access predicate 判定', () => {
  const user = { permissions: ['INVENTORY_VIEW'] };
  const visible = ACTIVE_APPLICATION_ROUTES.filter((route) => userCanAccessRoute(user, route));
  assert.ok(visible.length > 0, '至少有一个 route 对该权限可见');
  for (const route of visible) {
    assert.ok(applicationRouteFor(route.key), `可见 route ${route.key} 必须能解析出 route 对象`);
  }
  const denied = ACTIVE_APPLICATION_ROUTES.filter((route) => !userCanAccessRoute(user, route));
  assert.ok(denied.length > 0, '至少有一个 route 对该权限不可见（否则权限拒绝无法验证）');
});
