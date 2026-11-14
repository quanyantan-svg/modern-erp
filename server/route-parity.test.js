// 前后端路由配对回归测试（2026-11-14）
//
// 合同：前端调用的每个 API 路径都必须由后端分发。
// 一个页面如果调用了不存在的端点，界面只会渲染错误态，业务能力静默丢失，
// 单元测试无法发现。
//
// 检查本体是独立脚本（scripts/qa/verify-route-parity.mjs）：它在一份一次性
// 临时 SQLite 库上启动真实服务器，用「路由自身 404（接口不存在）」作为
// 判定依据，并对模板路径改用后端路由模式匹配。脚本不写仓库、不连 MySQL。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

const SCRIPT = 'scripts/qa/verify-route-parity.mjs';

describe('前后端路由配对（2026-11-14）', () => {
  test('前端调用的 API 路径全部由后端分发', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      failed = true;
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }
    assert.equal(failed, false, `${SCRIPT} 必须通过（存在未匹配的前后端路由）：\n${output.slice(-2000)}`);
    assert.match(output, /未匹配后端路由 0 个/, `${SCRIPT} 的结论摘要不符合预期：\n${output.slice(-2000)}`);
  });
});
