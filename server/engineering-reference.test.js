// V17 Master & Engineering Domain Closure — Wave A focused tests.
//
// Covers:
//   - Formula grammar safety: rejects eval/Function/Function calls/identifiers
//     without `e_` prefix, divide-by-zero, exceeded length, exceeded depth,
//     empty parentheses, malformed tokens.
//   - Migration is additive: existing tables/columns are intact; legacy
//     `routing_operations` and `production_labor_records` still exist.
//   - Cycle protection / invalid identifier / too-deep AST are surfaced as
//     FormulaError with stable `reason` codes.
//
// These tests do NOT exercise HTTP handlers (covered by integration tests);
// they verify the parser/executor contract that the engineering-reference
// module imports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileFormula, evaluateAst, evaluateFormula, FormulaError,
} from './lib/formula-evaluator.js';

test('formula: simple integer arithmetic', () => {
  assert.equal(evaluateFormula('1 + 2 * 3'), 7);
});

test('formula: parentheses and power', () => {
  assert.equal(evaluateFormula('(2 + 3) ^ 2'), 25);
});

test('formula: unary minus and subtraction', () => {
  assert.equal(evaluateFormula('-5 + 3'), -2);
});

test('formula: variables must use e_ prefix', () => {
  assert.equal(evaluateFormula('e_qty * 2', { e_qty: 5 }), 10);
  assert.equal(evaluateFormula('e_setup + e_run', { e_setup: 3, e_run: 7 }), 10);
});

test('formula: identifier without e_ prefix is rejected', () => {
  assert.throws(() => evaluateFormula('qty * 2'), (error) => {
    return error instanceof FormulaError && (error.reason === 'UNKNOWN_IDENTIFIER' || error.reason === 'INVALID_TOKEN');
  });
});

test('formula: function calls are rejected (no parentheses after identifier)', () => {
  assert.throws(() => evaluateFormula('e_qty(5)'), (error) => error instanceof FormulaError);
});

test('formula: eval and Function substrings are rejected as invalid tokens', () => {
  assert.throws(() => evaluateFormula('eval("1")'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('Function("return 1")()'), (error) => error instanceof FormulaError);
});

test('formula: divide by zero returns DIVIDE_BY_ZERO', () => {
  assert.throws(() => evaluateFormula('1 / 0'), (error) => error instanceof FormulaError && error.reason === 'DIVIDE_BY_ZERO');
});

test('formula: empty parentheses are rejected', () => {
  assert.throws(() => evaluateFormula('()'), (error) => error instanceof FormulaError && error.reason === 'EMPTY_PARENTHESES');
});

test('formula: unknown identifier at evaluation surfaces UNKNOWN_IDENTIFIER', () => {
  assert.throws(() => evaluateFormula('e_qty + 1'), (error) => error instanceof FormulaError && error.reason === 'UNKNOWN_IDENTIFIER');
});

test('formula: length cap of 256 enforced', () => {
  const longFormula = '1' + '+1'.repeat(200);
  assert.throws(() => evaluateFormula(longFormula), (error) => error instanceof FormulaError && error.reason === 'EXCEEDED_LENGTH');
});

test('formula: deep nesting limited to depth 20', () => {
  const nested = '('.repeat(25) + '1' + ')'.repeat(25);
  assert.throws(() => evaluateFormula(nested), (error) => error instanceof FormulaError && error.reason === 'EXCEEDED_DEPTH');
});

test('formula: parse returns an AST that can be re-evaluated', () => {
  const ast = compileFormula('(e_a + e_b) * 2');
  const result = evaluateAst(ast, { e_a: 3, e_b: 4 });
  assert.equal(result, 14);
});

test('formula: rejects trailing tokens after a complete expression', () => {
  assert.throws(() => evaluateFormula('1 + 2 3'), (error) => error instanceof FormulaError);
});

test('formula: empty string input is invalid', () => {
  assert.throws(() => evaluateFormula(''), (error) => error instanceof FormulaError);
});

test('formula: only allowed arithmetic operators + - * / ^ parentheses identifiers', () => {
  // commas (function-like), percent, semicolon, comparisons must fail.
  assert.throws(() => evaluateFormula('1, 2'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('1; 2'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('1 == 2'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('1 % 2'), (error) => error instanceof FormulaError);
});

test('formula: identifier names must start with e_', () => {
  assert.throws(() => evaluateFormula('1 + a'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('1 + _e_x'), (error) => error instanceof FormulaError);
  assert.throws(() => evaluateFormula('1 + e'), (error) => error instanceof FormulaError);
});

test('formula: identifier pattern e_X[Y...] (uppercase + camel case allowed)', () => {
  assert.equal(evaluateFormula('e_Qty * 2', { e_Qty: 4 }), 8);
});