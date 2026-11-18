// 用户可见文案回归测试（2026-11-18）
//
// 合同：最终用户界面上不出现研发内部语言（Requirement §36.22 PL-UX-01/02）。
// 禁止实施批次词、合同编号与权限码；源码追溯注释必须保留，不得为通过本守卫
// 而删除（Requirement §36.22 PL-UX-08）。
//
// 检查本体是 `scripts/qa/verify-user-facing-copy.mjs`：只读扫描，不连数据库、
// 不写仓库。本测试**直接 import** 该模块，而不是拉起子进程。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { collectCopyFindings } from '../scripts/qa/verify-user-facing-copy.mjs';

describe('用户可见文案一致性（2026-11-18）', () => {
  test('用户可见文案没有研发内部标识残留', () => {
    const report = collectCopyFindings();
    assert.equal(report.copyFindings, 0,
      `研发内部标识残留必须为 0：\n${report.findings.map((f) => `${f.file}:${f.line} ${f.hits.join('、')} — ${f.text}`).join('\n')}`);
  });

  test('守卫确实扫描了前后端两侧并读到了权限码目录', () => {
    const report = collectCopyFindings();
    assert.ok(report.scannedFrontend > 0, '必须扫描前端源码');
    assert.ok(report.scannedBackend > 0, '必须扫描后端源码');
    assert.ok(report.permissionCodeCount > 0, '必须读到权限码目录');
  });
});
