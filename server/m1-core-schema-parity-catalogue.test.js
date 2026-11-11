// The MySQL catalogue rendering of a DEFAULT must compare equal to the
// canonical SQLite text.
//
// Two independent differences between the two engines broke that comparison
// and were both found by the protected Accounting & Analytics campaign:
//
//   1. `information_schema`'s string columns are declared latin1, so the
//      driver decodes the server's utf8mb4 bytes one byte at a time: a Chinese
//      character arrives as its individual bytes rather than as one
//      character, and the value could never equal the SQLite text.
//   2. The catalogue renders a string literal with MySQL's own escaping
//      applied to the delimiters (`_utf8mb4\'value\'`, two backslashes when
//      the value itself carries an escaped backslash), while the literal
//      reader only accepted the single-backslash form and refused the rest.
//
// This suite is entirely offline: it fixes the two renderings, not a live
// server. The end-to-end proof against a real MySQL 8 catalogue is the
// protected campaign `test:mysql:accounting-analytics`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  canonicalDefault,
  canonicalSqliteDefault,
  decodeCatalogueText,
  sqlExpressionTokens,
} from './test-utils/m1-core-schema-parity.js';

const BS = String.fromCharCode(92);
const HAN = '台';
const HAN_UTF8 = [0xe5, 0x8f, 0xb0];
const HAN_LATIN1_FRAGMENTS = HAN_UTF8.map((byte) => String.fromCharCode(byte));

describe('MySQL 目录 DEFAULT 的两处渲染差异', () => {
  test('目录列的 latin1 解码文本按 UTF-8 还原', () => {
    const mangled = '_utf8mb4' + BS + "'" + HAN_LATIN1_FRAGMENTS.join('') + BS + "'";
    assert.notEqual(mangled, '_utf8mb4' + BS + "'" + HAN + BS + "'",
      '负例前提：latin1 逐字节解码后的文本与原文不同');
    const decoded = decodeCatalogueText(mangled);
    assert.equal(decoded, '_utf8mb4' + BS + "'" + HAN + BS + "'");
    assert.equal([...String(decoded)].filter((c) => c === HAN).length, 1,
      '还原后必须是一个完整字符，而不是三个字节片段');
  });

  test('还原是保守的：非 latin1 文本与非法 UTF-8 字节保持原样', () => {
    assert.equal(decodeCatalogueText('plain ascii'), 'plain ascii');
    assert.equal(decodeCatalogueText(null), null);
    assert.equal(decodeCatalogueText(undefined), undefined);
    assert.equal(decodeCatalogueText(''), '');
    const notLatin1 = '台';
    assert.equal(decodeCatalogueText(notLatin1), notLatin1,
      '已经是正确 UTF-8 的文本不得被二次解码');
    const invalidUtf8 = String.fromCharCode(0xff, 0xfe);
    assert.equal(decodeCatalogueText(invalidUtf8), invalidUtf8,
      '非法 UTF-8 字节必须原样保留');
  });

  test('目录的字面量定界符：单反斜杠与双反斜杠两种渲染都规范化为同一形态', () => {
    const single = '_utf8mb4' + BS + "'" + HAN + BS + "'";
    const doubled = '_utf8mb4' + BS + BS + "'" + HAN + BS + BS + "'";
    const plain = "_utf8mb4'" + HAN + "'";
    for (const value of [single, doubled, plain]) {
      assert.equal(sqlExpressionTokens(value, { dialect: 'mysql_catalog' }), 'STRING:"' + HAN + '"',
        `目录渲染 ${JSON.stringify(value)} 必须规范化为同一个字符串`);
      assert.equal(canonicalDefault(value, { catalogue: true, extra: 'DEFAULT_GENERATED', numeric: false }),
        'STRING:"' + HAN + '"');
    }
  });

  test('两端规范化形态相等 —— 这正是 schema 对等比较的判定依据', () => {
    const sqliteCanonical = canonicalSqliteDefault("'" + HAN + "'");
    const mysqlCanonical = canonicalDefault('_utf8mb4' + BS + "'" + HAN + BS + "'", {
      catalogue: true, extra: 'DEFAULT_GENERATED', numeric: false,
    });
    assert.equal(sqliteCanonical, 'STRING:"' + HAN + '"');
    assert.equal(mysqlCanonical, sqliteCanonical);
  });

  test('负例：未经还原的 latin1 片段文本不得与 SQLite 形态相等', () => {
    const mangled = '_utf8mb4' + BS + "'" + HAN_LATIN1_FRAGMENTS.join('') + BS + "'";
    const mangledCanonical = canonicalDefault(mangled, { catalogue: true, extra: 'DEFAULT_GENERATED', numeric: false });
    assert.notEqual(mangledCanonical, canonicalSqliteDefault("'" + HAN + "'"),
      '还原前必须确实不等，否则该守卫没有区分力');
    assert.equal(canonicalDefault(decodeCatalogueText(mangled), { catalogue: true, extra: 'DEFAULT_GENERATED', numeric: false }),
      canonicalSqliteDefault("'" + HAN + "'"));
  });
});
