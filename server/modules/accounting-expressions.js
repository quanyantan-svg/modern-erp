// Accounting & Analytics Domain Closure — restricted expression grammar.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.2 AA-W2.11 /
//   AA-W2.12, §35.4.4 AA-W4.4..AA-W4.7
// Design:    docs/design/accounting-analytics.md §31.2.2 / §31.4.2
//
// This module is the **single** safe expression surface of the domain:
//
//   - `evaluateTemplateCondition` / `evaluateTemplateAmount` — voucher template
//     condition / amount grammar. Its identifier namespace is the fixed
//     whitelist SOURCE_AMOUNT / SOURCE_TAX / SOURCE_COUNT / PERIOD.
//   - `evaluateReportExpression` — report item formula grammar. Its identifier
//     namespace is the **caller supplied binding map** only, and the template
//     namespace names are explicitly rejected so the two grammars never share
//     an identifier namespace.
//
// Hard constraints (both grammars):
//   - NEVER eval / Function / vm / new Function / child_process.
//   - Length limit 512 characters, parse depth limit 24.
//   - Explicit error codes; a failed evaluation throws instead of degrading
//     to 0 or silently skipping a line.
//
// This module is deliberately **independent** from
// `server/lib/formula-evaluator.js` (Master & Engineering workshop formula
// grammar). Requirement §35.1.3 forbids reusing or widening that grammar for
// report data fetching, and the two grammars share neither an entry point nor
// an identifier namespace.

const MAX_EXPRESSION_LENGTH = 512;
const MAX_PARSE_DEPTH = 24;

// Template grammar identifiers — the only names a template may read.
const TEMPLATE_IDENTIFIERS = Object.freeze([
  'SOURCE_AMOUNT',
  'SOURCE_TAX',
  'SOURCE_COUNT',
  'PERIOD',
]);

const TEMPLATE_IDENTIFIER_SET = new Set(TEMPLATE_IDENTIFIERS);

export class AccountingExpressionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountingExpressionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AccountingExpressionError(code, message);
}

// ---------------------------------------------------------------------------
// Tokenizer — shared lexing rules, per-grammar identifier validation.
// ---------------------------------------------------------------------------

const COMPARISON_OPERATORS = Object.freeze(['>=', '<=', '!=', '==', '>', '<']);

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      index += 1;
      continue;
    }
    if (character === '(' || character === ')') {
      tokens.push({ type: character, value: character });
      index += 1;
      continue;
    }
    if (character === '+' || character === '-' || character === '*' || character === '/') {
      tokens.push({ type: 'OP', value: character });
      index += 1;
      continue;
    }
    if (character === '=') {
      tokens.push({ type: 'OP', value: '==' });
      index += 1;
      continue;
    }
    if (character === '!' || character === '>' || character === '<') {
      const candidate = source.slice(index, index + 2);
      if (candidate === '!=' || candidate === '>=' || candidate === '<=') {
        tokens.push({ type: 'OP', value: candidate });
        index += 2;
        continue;
      }
      if (character === '!') fail('INVALID_TOKEN', '不允许的字符 !');
      tokens.push({ type: 'OP', value: character });
      index += 1;
      continue;
    }
    if (character >= '0' && character <= '9') {
      let end = index;
      while (end < source.length && source[end] >= '0' && source[end] <= '9') end += 1;
      tokens.push({ type: 'NUMBER', value: Number(source.slice(index, end)) });
      index = end;
      continue;
    }
    if ((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || character === '_') {
      let end = index;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      const identifier = source.slice(index, end);
      const upper = identifier.toUpperCase();
      if (upper === 'AND' || upper === 'OR') {
        tokens.push({ type: 'LOGIC', value: upper });
      } else if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'BOOLEAN', value: upper === 'TRUE' });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: identifier });
      }
      index = end;
      continue;
    }
    fail('INVALID_TOKEN', '不允许的字符 ' + character);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser — precedence climbing, identifier policy injected per grammar.
// ---------------------------------------------------------------------------

function createParser(tokens, { validateIdentifier, allowComparison, allowLogic, grammarName }) {
  let cursor = 0;

  function peek() {
    return cursor < tokens.length ? tokens[cursor] : null;
  }

  function next() {
    if (cursor >= tokens.length) fail('INVALID_EXPRESSION', grammarName + ' 表达式未完成');
    const token = tokens[cursor];
    cursor += 1;
    return token;
  }

  function parseExpression(depth) {
    let left = parseComparison(depth);
    while (allowLogic && peek() && peek().type === 'LOGIC') {
      const operator = next().value;
      const right = parseComparison(depth + 1);
      left = { kind: 'logic', operator, left, right };
    }
    return left;
  }

  function parseComparison(depth) {
    const left = parseAdditive(depth);
    if (!allowComparison) return left;
    const token = peek();
    if (!token || token.type !== 'OP' || !COMPARISON_OPERATORS.includes(token.value)) return left;
    const operator = next().value;
    const right = parseAdditive(depth + 1);
    return { kind: 'comparison', operator, left, right };
  }

  function parseAdditive(depth) {
    let left = parseMultiplicative(depth);
    while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const operator = next().value;
      const right = parseMultiplicative(depth + 1);
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  }

  function parseMultiplicative(depth) {
    let left = parseUnary(depth);
    while (peek() && peek().type === 'OP' && (peek().value === '*' || peek().value === '/')) {
      const operator = next().value;
      const right = parseUnary(depth + 1);
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  }

  function parseUnary(depth) {
    if (depth > MAX_PARSE_DEPTH) fail('EXCEEDED_DEPTH', grammarName + ' 表达式嵌套深度超出限制');
    const token = peek();
    if (token && token.type === 'OP' && (token.value === '+' || token.value === '-')) {
      next();
      const operand = parseUnary(depth + 1);
      return token.value === '-' ? { kind: 'negate', operand } : operand;
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth) {
    if (depth > MAX_PARSE_DEPTH) fail('EXCEEDED_DEPTH', grammarName + ' 表达式嵌套深度超出限制');
    const token = peek();
    if (!token) fail('INVALID_EXPRESSION', grammarName + ' 表达式未完成');
    if (token.type === '(') {
      next();
      if (peek() && peek().type === ')') fail('INVALID_EXPRESSION', '不允许空括号');
      const inner = parseExpression(depth + 1);
      if (!peek() || peek().type !== ')') fail('INVALID_EXPRESSION', '缺少右括号');
      next();
      return inner;
    }
    if (token.type === 'NUMBER') {
      next();
      return { kind: 'number', value: token.value };
    }
    if (token.type === 'BOOLEAN') {
      next();
      return { kind: 'boolean', value: token.value };
    }
    if (token.type === 'IDENTIFIER') {
      next();
      validateIdentifier(token.value);
      if (peek() && peek().type === '(') fail('INVALID_EXPRESSION', '不允许函数调用 ' + token.value);
      return { kind: 'identifier', name: token.value };
    }
    fail('INVALID_TOKEN', '意外的 token ' + token.type);
    return null;
  }

  return {
    parse() {
      if (!tokens.length) fail('INVALID_EXPRESSION', grammarName + ' 表达式不能为空');
      const ast = parseExpression(0);
      if (cursor < tokens.length) fail('INVALID_EXPRESSION', grammarName + ' 表达式末尾多余 token');
      return ast;
    },
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function evaluateNode(node, bindings) {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'identifier': {
      const value = bindings ? bindings[node.name] : undefined;
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        fail('UNKNOWN_IDENTIFIER', '变量 ' + node.name + ' 未定义或非有限数');
      }
      return Number(value);
    }
    case 'negate':
      return -evaluateNode(node.operand, bindings);
    case 'binary': {
      const left = evaluateNode(node.left, bindings);
      const right = evaluateNode(node.right, bindings);
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) fail('DIVIDE_BY_ZERO', '除数不能为零');
          return left / right;
        default: fail('INVALID_TOKEN', '非法运算符 ' + node.operator);
      }
      return null;
    }
    case 'comparison': {
      const left = evaluateNode(node.left, bindings);
      const right = evaluateNode(node.right, bindings);
      switch (node.operator) {
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '==': return left === right;
        case '!=': return left !== right;
        default: fail('INVALID_TOKEN', '非法比较符 ' + node.operator);
      }
      return null;
    }
    case 'logic': {
      const left = evaluateNode(node.left, bindings);
      const right = evaluateNode(node.right, bindings);
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        fail('INVALID_EXPRESSION', 'AND / OR 两侧必须是条件');
      }
      return node.operator === 'AND' ? (left && right) : (left || right);
    }
    default:
      fail('INVALID_EXPRESSION', '非法 AST 节点 ' + node.kind);
      return null;
  }
}

function assertExpressionLength(source, grammarName) {
  if (typeof source !== 'string') fail('INVALID_EXPRESSION', grammarName + ' 表达式必须是字符串');
  if (source.length > MAX_EXPRESSION_LENGTH) {
    fail('EXCEEDED_LENGTH', grammarName + ' 表达式长度 ' + MAX_EXPRESSION_LENGTH + ' 限制');
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Voucher template condition grammar. Evaluates to a boolean; identifiers are
 * restricted to the fixed whitelist so a template can never read an arbitrary
 * binding.
 */
export function evaluateTemplateCondition(source, bindings = {}) {
  assertExpressionLength(source, '凭证模板条件');
  const trimmed = source.trim();
  if (!trimmed) fail('INVALID_EXPRESSION', '凭证模板条件不能为空');
  const tokens = tokenize(trimmed);
  const parser = createParser(tokens, {
    grammarName: '凭证模板条件',
    allowComparison: true,
    allowLogic: true,
    validateIdentifier: (identifier) => {
      if (!TEMPLATE_IDENTIFIER_SET.has(identifier.toUpperCase())) {
        fail('UNKNOWN_IDENTIFIER', '凭证模板条件不允许的标识符 ' + identifier);
      }
    },
  });
  const result = evaluateNode(parser.parse(), bindings);
  if (typeof result !== 'boolean') fail('INVALID_EXPRESSION', '凭证模板条件必须求值为布尔值');
  return result;
}

/**
 * Voucher template amount grammar. Evaluates to a finite number; the caller
 * owns the safe-integer cent conversion.
 */
export function evaluateTemplateAmount(source, bindings = {}) {
  assertExpressionLength(source, '凭证模板金额');
  const trimmed = source.trim();
  if (!trimmed) fail('INVALID_EXPRESSION', '凭证模板金额不能为空');
  const tokens = tokenize(trimmed);
  const parser = createParser(tokens, {
    grammarName: '凭证模板金额',
    allowComparison: false,
    allowLogic: false,
    validateIdentifier: (identifier) => {
      if (!TEMPLATE_IDENTIFIER_SET.has(identifier.toUpperCase())) {
        fail('UNKNOWN_IDENTIFIER', '凭证模板金额不允许的标识符 ' + identifier);
      }
    },
  });
  const result = evaluateNode(parser.parse(), bindings);
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    fail('EXPRESSION_RUNTIME_ERROR', '凭证模板金额求值结果不是有限数');
  }
  return result;
}

/**
 * Report item formula grammar. The identifier namespace is the caller
 * supplied binding map; the template namespace is explicitly rejected so the
 * report grammar can never shadow it.
 */
export function evaluateReportExpression(source, bindings = {}) {
  assertExpressionLength(source, '报表公式');
  const trimmed = source.trim();
  if (!trimmed) fail('INVALID_EXPRESSION', '报表公式不能为空');
  const tokens = tokenize(trimmed);
  const parser = createParser(tokens, {
    grammarName: '报表公式',
    allowComparison: true,
    allowLogic: true,
    validateIdentifier: (identifier) => {
      const upper = identifier.toUpperCase();
      if (TEMPLATE_IDENTIFIER_SET.has(upper)) {
        fail('UNKNOWN_IDENTIFIER', '报表公式不允许使用模板标识符 ' + identifier);
      }
      if (!Object.prototype.hasOwnProperty.call(bindings, identifier)) {
        fail('UNKNOWN_IDENTIFIER', '报表公式标识符 ' + identifier + ' 未绑定');
      }
    },
  });
  const result = evaluateNode(parser.parse(), bindings);
  if (typeof result !== 'number' && typeof result !== 'boolean') {
    fail('EXPRESSION_RUNTIME_ERROR', '报表公式求值结果不是数值');
  }
  return result;
}

export function isAccountingExpressionError(error) {
  return error instanceof AccountingExpressionError;
}

export const ACCOUNTING_EXPRESSION_LIMITS = Object.freeze({
  maxLength: MAX_EXPRESSION_LENGTH,
  maxDepth: MAX_PARSE_DEPTH,
  templateIdentifiers: TEMPLATE_IDENTIFIERS,
});
