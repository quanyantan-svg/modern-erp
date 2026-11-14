// 治理守卫的回归测试（2026-11-12）
//
// 三个只读治理检查必须始终通过；它们把三个系统性问题变成门禁：
//   1. 跨域错误码耦合 —— 一个域的内部错误码被另一个域当作合同依赖。
//   2. 历史验收记录的有效性 —— 验收记录引用了已不存在或未登记漂移的路径。
//   3. 期间守卫覆盖 —— 生产 mutation 必须登记具名期间动作，旧闸门不得复活，
//      mutation owner 不得自己读期间表（docs/design/platform.md §32.15.6）。
//
// 检查本身是独立脚本（scripts/qa/），此处只负责把它们纳入常规门禁。
// 三个脚本都是只读的：不写文件、不碰数据库。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

const CHECKS = [
  {
    label: 'cross-domain error-code coupling guard',
    script: 'scripts/qa/verify-error-code-coupling.mjs',
    expect: /已登记 \d+ \/ 未登记 0 \/ 死引用 0/,
  },
  {
    label: 'acceptance record pointer guard',
    script: 'scripts/qa/verify-acceptance-records.mjs',
    expect: /BROKEN 0$/m,
  },
  {
    label: 'period guard coverage guard',
    script: 'scripts/qa/verify-period-guard-coverage.mjs',
    expect: /旧闸门 0 处活跃调用/,
  },
];

describe('治理守卫（2026-11-12）', () => {
  for (const check of CHECKS) {
    test(`${check.label} passes`, () => {
      let output = '';
      let failed = false;
      try {
        output = execFileSync(process.execPath, [check.script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      } catch (error) {
        failed = true;
        output = `${error.stdout || ''}${error.stderr || ''}`;
      }
      assert.equal(failed, false, `${check.script} 必须通过（退出码非 0）：\n${output.slice(-2000)}`);
      assert.match(output, check.expect, `${check.script} 的结论摘要不符合预期：\n${output.slice(-2000)}`);
    });
  }
});
