// Route literal guard — every `path:` literal in the application route table
// must compile.
//
// Regression: a route added with a regular-expression literal whose escaping
// was lost (`/^/api/…/` instead of `/^\/api\/…/`) makes `server/app.js` throw
// `SyntaxError: Invalid regular expression flags` at import time, so the whole
// application refuses to boot. The defect is invisible to a diff review of a
// single line and only surfaces when the module is imported.
//
// This guard compiles every route literal directly, so a broken literal fails
// with a precise file/line instead of a boot-time SyntaxError.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, 'app.js'), 'utf8');

describe('Route literal guard', () => {
  test('every registered route path literal compiles', () => {
    const lines = appSource.split('\n');
    const broken = [];
    lines.forEach((line, index) => {
      const match = line.match(/^\s*path:\s*(\/.*?),\s*$/);
      if (!match) return;
      try {
        // eslint-disable-next-line no-new-func
        new Function(`return ${match[1]}`);
      } catch (error) {
        broken.push(`server/app.js:${index + 1} → ${match[1]} (${error.message})`);
      }
    });
    assert.deepEqual(broken, [], `路由字面量不可编译：\n${broken.join('\n')}`);
  });

  test('regular-expression route literals escape their path separators', () => {
    const lines = appSource.split('\n');
    const unescaped = [];
    lines.forEach((line, index) => {
      const match = line.match(/^\s*path:\s*(\/.*?\/[a-z]*),\s*$/);
      if (!match) return;
      const literal = match[1];
      // A regex route must not contain a bare `/` **outside** a character class
      // between the leading `^` and the final `/`: that would end the literal
      // early. A `/` inside `[^/]` is the intended "not a separator" form, so
      // character classes are removed before the delimiters are located.
      const withoutClasses = literal.replace(/\[[^\]]*\]/g, 'CLASS');
      const body = withoutClasses.slice(withoutClasses.indexOf('/') + 1, withoutClasses.lastIndexOf('/'));
      // A separator that is not escaped (`\/`) ends the literal early.
      if (/(^|[^\\])\//.test(body)) unescaped.push(`server/app.js:${index + 1} → ${literal}`);
    });
    assert.deepEqual(unescaped, [], `正则路由字面量中的路径分隔符必须转义：\n${unescaped.join('\n')}`);
  });
});
