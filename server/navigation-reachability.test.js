// 导航可达性回归测试（2026-11-17）
//
// 合同：每条 canonical route 都必须至少有一条用户界面可达路径
// （启动器分组条目 / 底部页签 / 父路由声明 / 页面内导航链接）。
// 一条 route 存在、页面能渲染、权限也正确，但没有任何界面入口时，
// 最终用户永远到不了它 —— 2026-10-06 的 commit c77616b 删除
// `utility-system`（系统设置）分组后，「用户与权限」就是这样从界面上消失的。
//
// 检查本体是 `scripts/qa/verify-navigation-reachability.mjs`：判定完全来自
// registry 与源码的静态枚举，不依赖任何一次浏览器门禁输出，不连数据库、不写仓库。
// 本测试**直接 import** 该模块，而不是拉起子进程 —— 避免在 FULL 门禁的
// 并行负载下额外占用进程与内存。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  collectNavigationReport,
  navigationFailures,
} from '../scripts/qa/verify-navigation-reachability.mjs';

describe('导航可达性（2026-11-17）', () => {
  test('没有 route 缺少用户界面入口', () => {
    const report = collectNavigationReport();
    assert.deepEqual(report.UNREACHABLE_ROUTES, [],
      `不可达 route 清单必须为空：${JSON.stringify(report.UNREACHABLE_ROUTES)}`);
  });

  test('每个域都有启动器分组，且分组标题是中文', () => {
    const report = collectNavigationReport();
    assert.deepEqual(report.MISSING_DOMAIN_GROUPS, [],
      `缺分组域清单必须为空：${JSON.stringify(report.MISSING_DOMAIN_GROUPS)}`);
    assert.deepEqual(report.NON_CHINESE_GROUP_LABELS, [],
      `非中文分组标题清单必须为空：${JSON.stringify(report.NON_CHINESE_GROUP_LABELS)}`);
    assert.equal(navigationFailures(report), 0);
  });

  test('九个域、九个分组，与 canonical 域清单一一对应', () => {
    const report = collectNavigationReport();
    assert.equal(report.launcherGroups, 9, '启动器分组必须是 9 个');
    assert.equal(report.domains, 9, 'canonical 域必须是 9 个');
  });

  test('启动器覆盖的 route 数不少于规范条目数', () => {
    const report = collectNavigationReport();
    assert.ok(report.launcherCovered >= 62,
      `启动器覆盖应不少于 62 条 route（当前 ${report.launcherCovered}）`);
  });
});
