// The duplicate-key → 409 mapping must hold on **both** engines.
//
// SQLite reports a duplicate as "UNIQUE constraint failed" in the error
// message; the MySQL driver reports it as the error **code** "ER_DUP_ENTRY"
// with only human-readable text in the message. A handler that only inspects
// the message therefore answers 500 on MySQL where it answers 409 on SQLite.
//
// This suite owns no database and never connects to MySQL: it fixes the
// mapping itself, and the end-to-end proof on a real MySQL 8 server is the
// protected campaign `test:mysql:accounting-analytics`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { isDuplicateKeyConflict } from './app.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('重复键冲突必须映射为 409（跨引擎）', () => {
  test('SQLite 形态：消息里的 UNIQUE constraint failed', () => {
    const error = new Error('UNIQUE constraint failed: accounting_subjects.code');
    assert.equal(isDuplicateKeyConflict(error), true);
  });

  test('MySQL 形态：错误码 ER_DUP_ENTRY，消息里没有可匹配的特征', () => {
    const error = new Error("Duplicate entry 'AA-MY-SCOPE' for key 'accounting_scopes.code'");
    error.code = 'ER_DUP_ENTRY';
    assert.ok(!/UNIQUE constraint failed|ER_DUP_ENTRY/i.test(error.message),
      '负例前提：该消息本身不含可匹配的特征，修复前会漏判');
    assert.equal(isDuplicateKeyConflict(error), true);
  });

  test('与引擎无关：只要消息或错误码表明是重复键即成立', () => {
    assert.equal(isDuplicateKeyConflict({ message: 'ER_DUP_ENTRY: Duplicate entry' }), true);
    assert.equal(isDuplicateKeyConflict({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry' }), true);
  });

  test('负例：无关错误不得被误判为重复键', () => {
    assert.equal(isDuplicateKeyConflict(new Error('accounting subject not found')), false);
    assert.equal(isDuplicateKeyConflict({ code: 'ER_LOCK_DEADLOCK', message: 'Deadlock found' }), false);
    assert.equal(isDuplicateKeyConflict({ code: 'ECONNREFUSED', message: 'connect refused' }), false);
    assert.equal(isDuplicateKeyConflict(null), false);
    assert.equal(isDuplicateKeyConflict(undefined), false);
  });

  test('请求处理器使用该判定，而不是自己的内联判断', () => {
    const source = readFileSync(join(repoRoot, 'server/app.js'), 'utf8');
    assert.match(source, /if \(isDuplicateKeyConflict\(error\)\) \{/,
      '请求处理器必须调用统一的重复键判定');
    assert.match(source, /send\(res, 409, serializeError\(new HttpError\(409/,
      '重复键冲突必须以 409 返回');
  });
});
