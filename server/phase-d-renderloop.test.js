// Regression coverage for the React #301 (Too many re-renders) defect
// discovered in ProductionOrderModal after the Phase D permission hotfix.
//
// Root cause (verified at the source level):
//   `src/pages/manufacturing.jsx` line 220 (pre-fix):
//     if (detail && !form.productId) setForm({ productId: detail.product_id || '', ... });
//   was a state setter invoked directly during the function body render.
//   For a NEW order, `value = {}` makes `detail = {}` (truthy) and
//   `form.productId = ''` (falsy), so the condition is permanently true,
//   setForm is called every render, and React aborts with #301.
//
//   The identical anti-pattern existed in BomModal (line 31, pre-fix) and
//   was fixed in the same commit.
//
// Fix:
//   Move the sync into a useEffect([detail]) gated by value.id. The effect
//   only runs when detail changes; for a new order the condition is
//   `undefined && {...} && true` = false → no setForm. For an existing
//   order, it runs once when the fetch resolves, populates form, and
//   form.productId becomes non-empty so the condition naturally resolves.
//
// This file asserts the regression cannot silently reappear. Because this
// Node-only harness has no jsdom/JSX DOM rendering infrastructure, we
// assert at the source level — the strongest evidence available — that
// no `setX(...)` call appears in the function-body render path of these
// modals and that the replacement useEffect is correctly guarded.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

// Extract the body of a function declaration up to its matching closing
// brace. We must skip past the parameter list `(... )` first, then find
// the function body's opening `{`.
function extractFunctionBody(src, functionName) {
  const sigRe = new RegExp('function\\s+' + functionName + '\\s*\\(');
  const m = src.match(sigRe);
  if (!m) return null;
  // Walk past the parameter list
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr = null;
  while (i < src.length && depth > 0) {
    const c = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  // Skip whitespace and comments
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '{') return null;
  const start = i;
  i++;
  depth = 1;
  inStr = null;
  let inTpl = false;
  while (i < src.length && depth > 0) {
    const c = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
    } else if (inTpl) {
      if (c === '`' && prev !== '\\') inTpl = false;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '`') {
      inTpl = true;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return src.slice(start + 1, i - 1);
}

// Strip JSX blocks and JSX expressions so we can inspect state-setter
// calls that occur OUTSIDE of JSX (i.e., in the function-body JS path).
function stripJsx(body) {
  // remove JSX expressions { ... } that may span across nested braces is
  // already covered by the JSX-aware use of `${...}` template literals
  // outside JSX; for our purposes, we look for `setX(...)` calls that
  // appear at the top level of the body, not inside a `return ( <JSX> )`.
  const returnIdx = body.indexOf('return ');
  if (returnIdx < 0) return body;
  return body.slice(0, returnIdx);
}

describe('ProductionOrderModal — no render-time state setter', () => {
  const src = readSrc('pages/manufacturing.jsx');
  const body = extractFunctionBody(src, 'ProductionOrderModal');
  assert.ok(body, 'ProductionOrderModal must exist');

  test('function-body code (before the JSX return) must not call setForm unconditionally', () => {
    const preJsx = stripJsx(body);
    // Look for the exact anti-pattern: an `if (...) setForm(...)` at top
    // level of the function body. After the fix, no such pattern exists.
    const antiPattern = /if\s*\([^)]*\)\s*setForm\s*\(/;
    assert.equal(antiPattern.test(preJsx), false,
      'ProductionOrderModal must not call setForm(...) directly in an `if (...)` during render');
  });

  test('detail → form sync now lives in a useEffect with [detail] dependency, gated by value.id', () => {
    // Search for: useEffect(...if (value.id && detail && !form.productId){...setForm(..., ..., [detail])
    // Be whitespace-tolerant.
    const hasSyncEffect = /useEffect\s*\([\s\S]*?if\s*\(\s*value\.id\s*&&\s*detail\s*&&\s*!form\.productId\s*\)[\s\S]*?setForm[\s\S]*?\[\s*detail\s*\]\s*\)/.test(body);
    assert.ok(hasSyncEffect,
      'ProductionOrderModal must sync detail→form inside a useEffect([detail]) gated by value.id and !form.productId');
  });

  test('useEffect for products + production-order fetch still runs once on mount', () => {
    // Pre-existing effect that loads /api/products and (for editing) the
    // /api/production-orders/:id detail. Its dependency array must stay
    // empty so it runs once per modal mount, while the form sync effect
    // watches [detail] separately.
    const hasMountEffect = /useEffect\s*\([\s\S]*?\/api\/products[\s\S]*?},\s*\[\s*\]\s*\)/.test(body);
    assert.ok(hasMountEffect,
      'ProductionOrderModal must keep its mount-once products / detail fetch effect');
  });

  test('useEffect for BOMs (by selected product) still watches [form.productId]', () => {
    const hasBomEffect = /useEffect\s*\([\s\S]*?\/api\/boms\?product=[\s\S]*?setBoms[\s\S]*?},\s*\[\s*form\.productId\s*\]\s*\)/.test(body);
    assert.ok(hasBomEffect,
      'ProductionOrderModal must keep its [form.productId]-keyed BOM fetch effect');
  });
});

describe('BomModal — no render-time state setter (same defect class)', () => {
  const src = readSrc('pages/manufacturing.jsx');
  const body = extractFunctionBody(src, 'BomModal');
  assert.ok(body, 'BomModal must exist');

  test('function-body code (before the JSX return) must not call setForm unconditionally', () => {
    const preJsx = stripJsx(body);
    const antiPattern = /if\s*\([^)]*\)\s*setForm\s*\(/;
    assert.equal(antiPattern.test(preJsx), false,
      'BomModal must not call setForm(...) directly in an `if (...)` during render');
  });

  test('detail → form sync now lives in a useEffect with [detail] dependency, gated by value.id', () => {
    const hasSyncEffect = /useEffect\s*\([\s\S]*?if\s*\(\s*value\.id\s*&&\s*detail\s*&&\s*!form\.productId\s*\)[\s\S]*?setForm[\s\S]*?\[\s*detail\s*\]\s*\)/.test(body);
    assert.ok(hasSyncEffect,
      'BomModal must sync detail→form inside a useEffect([detail]) gated by value.id and !form.productId');
  });
});

describe('manufacturing.jsx — global guard', () => {
  const src = readSrc('pages/manufacturing.jsx');

  test('no other function in manufacturing.jsx invokes a setter unconditionally during render', () => {
    // Belt-and-suspenders: scan the entire file for the literal anti-pattern
    //   if (...) setX(...)
    // anywhere at the top level of a component / module function. Setting
    // state inside conditional render is the React #301 pattern.
    //
    // We exclude the `BomModal` / `ProductionOrderModal` / `MRPCalculator`
    // / `ProductionOrders` / `Boms` function bodies we already verified
    // (no anti-pattern remains) and we only flag new occurrences.
    const antiPattern = /if\s*\([^)]*\)\s*set[A-Z]\w*\s*\(/g;
    const matches = [...src.matchAll(antiPattern)];
    for (const m of matches) {
      const line = src.slice(0, m.index).split('\n').length;
      const window = src.slice(Math.max(0, m.index - 200), m.index + 200);
      assert.fail(`Possible render-time setter at line ${line}: ...${window}...`);
    }
    assert.equal(matches.length, 0, 'no render-time `if (...) setX(...)` may exist');
  });

  test('Manufacturing module still uses canonical PRODUCTION_ORDERS_* permission codes (Phase D hotfix preserved)', () => {
    // The previous hotfix changed PRODUCTION_CREATE → PRODUCTION_ORDERS_CREATE etc.
    // Ensure we did not accidentally regress those names.
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_CREATE'\)/.test(src), 'create button must still gate on PRODUCTION_ORDERS_CREATE');
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_START'\)/.test(src), 'start button must still gate on PRODUCTION_ORDERS_START');
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_COMPLETE'\)/.test(src), 'complete button must still gate on PRODUCTION_ORDERS_COMPLETE');
    // Cancel is allowAny of CREATE or START.
    assert.ok(/can\(user,\s*'PRODUCTION_ORDERS_CREATE'\)\s*\|\|\s*can\(user,\s*'PRODUCTION_ORDERS_START'\)/.test(src),
      'cancel must still gate on PRODUCTION_ORDERS_CREATE OR PRODUCTION_ORDERS_START');
    for (const legacy of ['PRODUCTION_CREATE', 'PRODUCTION_START', 'PRODUCTION_COMPLETE', 'PRODUCTION_CANCEL']) {
      assert.equal(new RegExp(`'${legacy}'`).test(src), false, `legacy '${legacy}' must not reappear`);
    }
  });

  test('Production-order form fields remain unchanged (backend contract preserved)', () => {
    // The form must still include { productId, bomId, quantity, plannedStart,
    // plannedFinish, remark } and POST to /api/production-orders with method: 'POST'.
    for (const f of ['productId', 'bomId', 'quantity', 'plannedStart', 'plannedFinish', 'remark']) {
      assert.ok(src.includes(f), `manufacturing.jsx must keep form field "${f}"`);
    }
    assert.ok(src.includes("/api/production-orders") && src.includes("method: 'POST'"),
      'ProductionOrderModal.save must still POST to /api/production-orders');
  });
});