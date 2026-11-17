// 界面语言回归测试（2026-11-17）
//
// 合同：最终用户界面上不允许出现英文。前端文案位与后端响应消息位都必须中文；
// 领域专名与缩写、内部条目编号、机器可读标识符按 Requirement §36.19
// `PL-LANG-04` 的显式白名单保留。
//
// 检查本体是 `scripts/qa/verify-ui-language.mjs`：只读扫描，不连数据库、不写仓库。
// 本测试**直接 import** 该模块，而不是拉起子进程 —— 避免在 FULL 门禁的
// 并行负载下额外占用进程与内存。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { collectLanguageFindings } from '../scripts/qa/verify-ui-language.mjs';

describe('界面语言一致性（2026-11-17）', () => {
  test('用户可见文案与后端错误消息没有英文残留', () => {
    const report = collectLanguageFindings();
    assert.equal(report.englishFindings, 0,
      `英文残留必须为 0：\n${report.findings.map((f) => `${f.file}:${f.line} ${f.word} — ${f.text}`).join('\n')}`);
  });

  test('守卫确实扫描了前后端两侧', () => {
    const report = collectLanguageFindings();
    assert.ok(report.scannedFrontend > 0, '必须扫描前端源码');
    assert.ok(report.scannedBackend > 0, '必须扫描后端源码');
  });
});
