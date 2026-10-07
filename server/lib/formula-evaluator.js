// V17 Master & Engineering Domain Closure — Workshop Formula safe grammar.
//
// Hard requirements:
//   - MUST NOT use eval() / Function() / vm / exec / subprocess.
//   - Tokens: numbers (number literal), identifiers with prefix "e_" only,
//     operators + - * / ^, parentheses.
//   - Reject statement-style syntax (no semicolons, no commas, no function calls).
//   - Length limit: 256 characters.
//   - Parse depth limit: 20.
//   - Errors: DIVIDE_BY_ZERO, UNKNOWN_IDENTIFIER, INVALID_TOKEN, EXCEEDED_LENGTH,
//     EXCEEDED_DEPTH, EMPTY_PARENTHESES.
//
// The parser builds a simple AST then evaluates in pure JavaScript arithmetic
// with a variable resolver passed in by the caller. This is the only allowed
// execution surface for workshop formulas.

const MAX_FORMULA_LENGTH = 256;
const MAX_PARSE_DEPTH = 20;
const IDENTIFIER_PATTERN = /^e_[A-Za-z][A-Za-z0-9_]*$/;
const NUMBER_PATTERN = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export class FormulaError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'FormulaError';
    this.reason = reason;
  }
}

function tokenize(formula) {
  const tokens = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '(' || ch === ')') {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      while (j < formula.length && /[0-9.eE+\-]/.test(formula[j])) {
        // Disallow embedded + / - after first non-digit.
        if ((formula[j] === '+' || formula[j] === '-') && !/[eE]/.test(formula[j - 1])) break;
        j += 1;
      }
      const slice = formula.slice(i, j);
      if (!NUMBER_PATTERN.test(slice)) {
        throw new FormulaError('INVALID_TOKEN', `非法数字字面量 ${slice}`);
      }
      tokens.push({ type: 'NUMBER', value: Number(slice) });
      i = j;
      continue;
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i;
      while (j < formula.length && /[A-Za-z0-9_]/.test(formula[j])) j += 1;
      const ident = formula.slice(i, j);
      tokens.push({ type: 'IDENTIFIER', value: ident });
      i = j;
      continue;
    }
    throw new FormulaError('INVALID_TOKEN', `不允许的字符 ${ch}`);
  }
  return tokens;
}

function parseExpression(tokens, depth) {
  if (depth > MAX_PARSE_DEPTH) throw new FormulaError('EXCEEDED_DEPTH', '公式嵌套深度超出限制');
  let left = parseTerm(tokens, depth);
  while (tokens.length > 0 && (tokens[0].type === '+' || tokens[0].type === '-')) {
    const op = tokens.shift();
    const right = parseTerm(tokens, depth + 1);
    left = { kind: 'binary', op: op.type, left, right };
  }
  return left;
}

function parseTerm(tokens, depth) {
  if (depth > MAX_PARSE_DEPTH) throw new FormulaError('EXCEEDED_DEPTH', '公式嵌套深度超出限制');
  let left = parseFactor(tokens, depth);
  while (tokens.length > 0 && (tokens[0].type === '*' || tokens[0].type === '/' || tokens[0].type === '^')) {
    const op = tokens.shift();
    const right = parseFactor(tokens, depth + 1);
    left = { kind: 'binary', op: op.type, left, right };
  }
  return left;
}

function parseFactor(tokens, depth) {
  if (depth > MAX_PARSE_DEPTH) throw new FormulaError('EXCEEDED_DEPTH', '公式嵌套深度超出限制');
  if (tokens.length === 0) throw new FormulaError('INVALID_TOKEN', '公式未完成');
  const t = tokens[0];
  if (t.type === '(') {
    tokens.shift();
    if (tokens.length > 0 && tokens[0].type === ')') {
      throw new FormulaError('EMPTY_PARENTHESES', '不允许空括号');
    }
    const inner = parseExpression(tokens, depth + 1);
    if (tokens.length === 0 || tokens[0].type !== ')') {
      throw new FormulaError('INVALID_TOKEN', '缺少右括号');
    }
    tokens.shift();
    return inner;
  }
  if (t.type === '+') {
    tokens.shift();
    return parseFactor(tokens, depth + 1);
  }
  if (t.type === '-') {
    tokens.shift();
    return { kind: 'negate', operand: parseFactor(tokens, depth + 1) };
  }
  if (t.type === 'NUMBER') {
    tokens.shift();
    return { kind: 'number', value: t.value };
  }
  if (t.type === 'IDENTIFIER') {
    tokens.shift();
    if (!IDENTIFIER_PATTERN.test(t.value)) {
      throw new FormulaError('UNKNOWN_IDENTIFIER', `非法标识符 ${t.value}`);
    }
    if (tokens.length > 0 && tokens[0].type === '(') {
      throw new FormulaError('INVALID_TOKEN', `不允许函数调用 ${t.value}`);
    }
    return { kind: 'identifier', name: t.value };
  }
  throw new FormulaError('INVALID_TOKEN', `意外的 token ${t.type}`);
}

export function compileFormula(formula) {
  if (typeof formula !== 'string') {
    throw new FormulaError('INVALID_TOKEN', '公式必须是字符串');
  }
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError('EXCEEDED_LENGTH', `公式长度 ${MAX_FORMULA_LENGTH} 限制`);
  }
  const trimmed = trimmedFormula(formula);
  if (!trimmed) throw new FormulaError('INVALID_TOKEN', '公式不能为空');
  const tokens = tokenize(trimmed);
  const ast = parseExpression(tokens, 0);
  if (tokens.length > 0) {
    throw new FormulaError('INVALID_TOKEN', `公式末尾多余 token ${tokens[0].type}`);
  }
  return ast;
}

function trimmedFormula(formula) {
  return formula.replace(/\s+/g, ' ').trim();
}

export function evaluateAst(ast, variables) {
  switch (ast.kind) {
    case 'number':
      return ast.value;
    case 'identifier': {
      const value = variables?.[ast.name];
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        throw new FormulaError('UNKNOWN_IDENTIFIER', `变量 ${ast.name} 未定义或非有限数`);
      }
      return Number(value);
    }
    case 'negate':
      return -evaluateAst(ast.operand, variables);
    case 'binary': {
      const left = evaluateAst(ast.left, variables);
      const right = evaluateAst(ast.right, variables);
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) throw new FormulaError('DIVIDE_BY_ZERO', '除数不能为零');
          return left / right;
        case '^': return Math.pow(left, right);
        default:
          throw new FormulaError('INVALID_TOKEN', `非法运算符 ${ast.op}`);
      }
    }
    default:
      throw new FormulaError('INVALID_TOKEN', `非法 AST 节点 ${ast.kind}`);
  }
}

export function evaluateFormula(formula, variables = {}) {
  const ast = compileFormula(formula);
  return evaluateAst(ast, variables);
}