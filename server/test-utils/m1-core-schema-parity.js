import {
  generatedPartialIndex,
  mysqlGeneratedPartialIndexColumnName,
  mysqlTypeFamily,
  usesGeneratedDigest,
} from '../database/mysql-schema.js';

export const M1_CORE_PARITY_TABLES = Object.freeze([
  'receipt_notice_item_sources', 'schedule_consumption_effects',
  'outsourcing_orders', 'outsourcing_material_list', 'outsourcing_receipts', 'outsourcing_receipt_items',
  'outsourcing_wip_identity_effects', 'outsourcing_wip_identity_effect_allocations', 'outsourcing_wip_identity_balances',
  'tracked_inventory_movements', 'inventory_transactions', 'inventory_valuation_movements',
  'purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items',
]);

// The literal dialect follows the PROVENANCE of the text, never the shape of
// its bytes.
//
// `sql_standard` is the dialect of the canonical SQLite DDL source and of the
// production-emitted MySQL DDL: inside a `'...'` literal only the SQL-standard
// doubled quote denotes a literal quote.
//
// `mysql_catalog` is the dialect of the live MySQL 8 catalogue rendering
// (`information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`,
// `information_schema.COLUMNS.GENERATION_EXPRESSION` and the expression form
// of `information_schema.COLUMNS.COLUMN_DEFAULT`). The server renders a
// string literal with its delimiters themselves backslash-escaped, so such a
// literal opens and closes with the two-byte sequence \'. This was captured
// from the protected Wave 10 acceptance campaign and re-observed read-only on
// the live MySQL 8.0.37 instance, whose own generated column renders as
//   (case `cost_name` when _utf8mb4\'io_block_read_cost\' then 1.0 ... end)
// A plain quote is also accepted on the catalogue side, because the catalogue
// never doubles a delimiter: accepting it must not merge two adjacent
// literals into one value, so the plain form closes at the FIRST plain quote.
//
// A backslash inside a literal is refused in BOTH dialects: under
// `sql_standard` it is not a supported form, and under `mysql_catalog` the
// catalogue's rendering convention for *content* escapes was never observed,
// so decoding one could merge two different literals into one value.
export const M1_CORE_SQL_LITERAL_DIALECT = Object.freeze({
  SQL_STANDARD: 'sql_standard',
  MYSQL_CATALOG: 'mysql_catalog',
});

const SQL_STANDARD_LITERAL_QUOTE = "'";
const MYSQL_CATALOG_LITERAL_QUOTE = "\\'";

function unwrapOuterParentheses(value) {
  let text = String(value).trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0; let quote = ''; let wrapsWholeExpression = true;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (character === quote && text[index + 1] === quote) index += 1;
        else if (character === quote) quote = '';
      } else if (character === "'" || character === '"') quote = character;
      else if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0 && index !== text.length - 1) { wrapsWholeExpression = false; break; }
    }
    if (!wrapsWholeExpression || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

// Reads one literal and returns its canonical token.
//
// The returned token keeps the literal CONTENT verbatim, so the case of a
// business string literal stays significant: 'DRAFT' and 'draft' are different
// values and must never normalise to the same token.
function readLiteralToken(text, start, dialect) {
  const catalogue = dialect === M1_CORE_SQL_LITERAL_DIALECT.MYSQL_CATALOG;
  const escaped = text.startsWith(MYSQL_CATALOG_LITERAL_QUOTE, start);
  const quote = catalogue
    ? (escaped ? MYSQL_CATALOG_LITERAL_QUOTE : SQL_STANDARD_LITERAL_QUOTE)
    : SQL_STANDARD_LITERAL_QUOTE;
  let cursor = start + quote.length;
  let content = '';
  let closed = false;
  let refused = false;
  while (cursor < text.length) {
    if (!catalogue && text.startsWith("''", cursor)) { content += "'"; cursor += 2; continue; }
    if (text.startsWith(quote, cursor)) { cursor += quote.length; closed = true; break; }
    const character = text[cursor];
    if (character === '\\') { refused = true; cursor += 1; continue; }
    if (catalogue && escaped && (character === "'" || character === '"' || character === '`')) {
      refused = true; cursor += 1; continue;
    }
    content += character; cursor += 1;
  }
  if (refused) {
    // A refused literal keeps a distinct, distinguishable form, so it can
    // never compare equal to a parsed one.
    return { token: `REFUSED_LITERAL:${JSON.stringify(text.slice(start + quote.length, cursor))}`, next: cursor };
  }
  return { token: closed ? `STRING:${JSON.stringify(content)}` : `UNTERMINATED_STRING:${JSON.stringify(content)}`, next: cursor };
}

export function sqlExpressionTokens(value, options = {}) {
  return sqlExpressionTokenList(value, options).join('|');
}

function sqlExpressionTokenList(value, {
  normalizeGeneratedCastCharset = false,
  dialect = M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD,
} = {}) {
  const text = unwrapOuterParentheses(value);
  const catalogue = dialect === M1_CORE_SQL_LITERAL_DIALECT.MYSQL_CATALOG;
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    // The catalogue renders a literal as `_utf8mb4\'value\'`: the introducer
    // precedes the (possibly escaped) delimiter.
    const charsetIntroducer = rest.match(/^_(?:utf8mb4|utf8|binary)\s*(?=(?:\\)?')/i);
    if (charsetIntroducer) { index += charsetIntroducer[0].length; continue; }
    if (text[index] === "'" || (catalogue && text.startsWith(MYSQL_CATALOG_LITERAL_QUOTE, index))) {
      const literal = readLiteralToken(text, index, dialect);
      tokens.push(literal.token);
      index = literal.next;
      continue;
    }
    if (text[index] === '`' || text[index] === '"') {
      const quote = text[index];
      let identifier = '';
      index += 1;
      while (index < text.length && text[index] !== quote) { identifier += text[index]; index += 1; }
      if (index < text.length && text[index] === quote) index += 1;
      tokens.push(`WORD:${identifier.toLowerCase()}`);
      continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_$]*/);
    if (word) { tokens.push(`WORD:${word[0].toLowerCase()}`); index += word[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push(`NUMBER:${number[0]}`); index += number[0].length; continue; }
    const operator = rest.match(/^(?:<>|!=|<=|>=|==|[-+*/%=<>,().])/);
    if (operator) { tokens.push(`SYMBOL:${operator[0]}`); index += operator[0].length; continue; }
    tokens.push(`CHAR:${text[index]}`); index += 1;
  }
  if (normalizeGeneratedCastCharset) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== 'WORD:char') continue;
      if (tokens[index + 1] === 'WORD:charset' && tokens[index + 2] === 'WORD:utf8mb4') tokens.splice(index + 1, 2);
      if (tokens[index + 1] === 'WORD:character' && tokens[index + 2] === 'WORD:set'
          && tokens[index + 3] === 'WORD:utf8mb4') tokens.splice(index + 1, 3);
    }
    for (let index = 0; index < tokens.length - 2; index += 1) {
      if (tokens[index] !== 'WORD:when' || tokens[index + 1] !== 'SYMBOL:(') continue;
      let depth = 0;
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor] === 'SYMBOL:(') depth += 1;
        else if (tokens[cursor] === 'SYMBOL:)' && --depth === 0) {
          if (tokens[cursor + 1] === 'WORD:then') {
            tokens.splice(cursor, 1);
            tokens.splice(index + 1, 1);
          }
          break;
        }
      }
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// The canonical expression form.
//
// The MySQL catalogue re-renders an expression: it parenthesises every
// operand of a boolean expression, wraps a whole clause, and parenthesises an
// arithmetic operand of a comparison. Those are representation differences,
// not semantic ones, so the comparison must be made on the EXPRESSION TREE,
// not on the raw token stream.
//
// The tree is rendered as an S-expression, so the structure IS the semantics:
//   `a AND (b OR c)`  ->  (and a (or b c))
//   `(a AND b) OR c`  ->  (or (and a b) c)
// The two can never render alike, so a regrouped predicate can never be
// normalised away.
//
// The parser is deliberately scope-limited to the constructs the M1-Core
// parity set actually uses: boolean composition, NOT, comparisons, IS [NOT]
// NULL, [NOT] IN, [NOT] BETWEEN, [NOT] LIKE, arithmetic, unary minus,
// literals, identifiers, function calls, CAST ... AS and the searched CASE
// WHEN form. ANY construct it cannot parse is REFUSED: the caller then
// compares the raw token streams, so an unrecognised expression can only ever
// match an identical one.
//
// A literal keeps its content verbatim, so the case of a business string
// literal stays significant. The literal CLASS is part of the tree as well:
// a string literal, a numeric literal and NULL are three different nodes, so
// `status = '1'` can never render like `status = 1`, and an IN list can never
// merge a string element with a numeric one.
//
// A CAST keeps its type parameters (length, precision, scale): `CHAR` and
// `CHAR(8)` are different expressions, because the length truncates.
// ---------------------------------------------------------------------------

const M1_CORE_EXPRESSION_WORD = 'WORD:';
const M1_CORE_EXPRESSION_SYMBOL = 'SYMBOL:';

function wordToken(token, word) {
  return token === `${M1_CORE_EXPRESSION_WORD}${word}`;
}

function symbolToken(token, symbol) {
  return token === `${M1_CORE_EXPRESSION_SYMBOL}${symbol}`;
}

function tokenWord(token) {
  return token && token.startsWith(M1_CORE_EXPRESSION_WORD) ? token.slice(M1_CORE_EXPRESSION_WORD.length) : null;
}

function tokenSymbol(token) {
  return token && token.startsWith(M1_CORE_EXPRESSION_SYMBOL) ? token.slice(M1_CORE_EXPRESSION_SYMBOL.length) : null;
}

const COMPARISON_OPERATORS = Object.freeze(['=', '<>', '<', '<=', '>', '>=']);

function parseExpressionTokens(tokens) {
  let position = 0;
  const peek = (offset = 0) => tokens[position + offset];
  const word = (value, offset = 0) => wordToken(peek(offset), value);
  const symbol = (value, offset = 0) => symbolToken(peek(offset), value);

  function parseOr() {
    const items = [parseAnd()];
    if (!items[0]) return null;
    while (word('or')) {
      position += 1;
      const item = parseAnd();
      if (!item) return null;
      items.push(item);
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  function parseAnd() {
    const items = [parseNot()];
    if (!items[0]) return null;
    while (word('and')) {
      position += 1;
      const item = parseNot();
      if (!item) return null;
      items.push(item);
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  function parseNot() {
    if (word('not')) {
      position += 1;
      const item = parseNot();
      return item ? { kind: 'not', item } : null;
    }
    return parseComparison();
  }

  function parseComparison() {
    const left = parseAdditive();
    if (!left) return null;
    const operator = tokenSymbol(peek());
    if (operator && COMPARISON_OPERATORS.includes(operator)) {
      position += 1;
      const right = parseAdditive();
      return right ? { kind: 'cmp', op: operator, left, right } : null;
    }
    if (word('is')) {
      position += 1;
      const negated = word('not');
      if (negated) position += 1;
      if (!word('null')) return null;
      position += 1;
      return { kind: 'isnull', item: left, negated };
    }
    if (word('not') && (word('in', 1) || word('between', 1) || word('like', 1))) {
      position += 1;
      return parseMembership(left, true);
    }
    if (word('in')) { position += 1; return parseMembership(left, false); }
    if (word('between')) { position += 1; return parseBetween(left, false); }
    if (word('like')) { position += 1; const pattern = parseAdditive(); return pattern ? { kind: 'like', item: left, pattern, negated: false } : null; }
    return left;
  }

  function parseMembership(left, negated) {
    if (!symbol('(')) return null;
    position += 1;
    const values = [];
    for (;;) {
      const token = peek();
      if (token && token.startsWith('STRING:')) {
        values.push({ kind: 'str', value: JSON.parse(token.slice('STRING:'.length)) });
        position += 1;
      } else if (token && token.startsWith('NUMBER:')) {
        values.push({ kind: 'num', value: token.slice('NUMBER:'.length) });
        position += 1;
      } else {
        return null;
      }
      if (symbol(',')) { position += 1; continue; }
      break;
    }
    if (!symbol(')')) return null;
    position += 1;
    return { kind: 'in', item: left, values, negated };
  }

  function parseBetween(left, negated) {
    const low = parseAdditive();
    if (!low || !word('and')) return null;
    position += 1;
    const high = parseAdditive();
    return high ? { kind: 'between', item: left, low, high, negated } : null;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    if (!left) return null;
    for (;;) {
      const operator = tokenSymbol(peek());
      if (operator !== '+' && operator !== '-') break;
      position += 1;
      const right = parseMultiplicative();
      if (!right) return null;
      left = { kind: 'arith', op: operator, left, right };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    if (!left) return null;
    for (;;) {
      const operator = tokenSymbol(peek());
      if (operator !== '*' && operator !== '/' && operator !== '%') break;
      position += 1;
      const right = parseUnary();
      if (!right) return null;
      left = { kind: 'arith', op: operator, left, right };
    }
    return left;
  }

  function parseUnary() {
    if (symbol('-')) {
      position += 1;
      const item = parseUnary();
      return item ? { kind: 'neg', item } : null;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return null;
    if (token.startsWith('STRING:')) {
      position += 1;
      return { kind: 'str', value: JSON.parse(token.slice('STRING:'.length)) };
    }
    if (token.startsWith('NUMBER:')) {
      position += 1;
      return { kind: 'num', value: token.slice('NUMBER:'.length) };
    }
    if (symbol('(')) {
      position += 1;
      const inner = parseOr();
      if (!inner || !symbol(')')) return null;
      position += 1;
      return inner;
    }
    if (symbol('-')) {
      position += 1;
      const item = parseUnary();
      return item ? { kind: 'neg', item } : null;
    }
    const name = tokenWord(token);
    if (name === null) return null;
    if (name === 'case') return parseCase();
    if (symbol('(', 1)) {
      if (name === 'cast') return parseCast();
      position += 2;
      const args = [];
      if (!symbol(')')) {
        for (;;) {
          const arg = parseOr();
          if (!arg) return null;
          args.push(arg);
          if (symbol(',')) { position += 1; continue; }
          break;
        }
      }
      if (!symbol(')')) return null;
      position += 1;
      return { kind: 'fn', name, args };
    }
    position += 1;
    // NULL is a literal, not an identifier: it must never compare equal to a
    // column reference, and it must never be confused with the string 'NULL'.
    if (name === 'null') return { kind: 'null' };
    return { kind: 'id', name };
  }

  function parseCast() {
    position += 2;
    const item = parseOr();
    if (!item || !word('as')) return null;
    position += 1;
    const type = tokenWord(peek());
    if (type === null) return null;
    position += 1;
    let typeParameters = null;
    if (symbol('(')) {
      position += 1;
      // The type parameters (length, precision, scale) are part of the
      // semantics: `CHAR(8)` truncates where `CHAR` does not. They are kept
      // verbatim, so two casts of different arity can never render alike.
      const parameters = [];
      for (;;) {
        const parameter = peek();
        if (!parameter || !parameter.startsWith('NUMBER:')) return null;
        parameters.push(parameter.slice('NUMBER:'.length));
        position += 1;
        if (symbol(',')) { position += 1; continue; }
        break;
      }
      if (!symbol(')')) return null;
      position += 1;
      typeParameters = parameters;
    }
    if (word('charset') || word('character')) {
      position += 1;
      if (word('set')) position += 1;
      if (tokenWord(peek()) === null) return null;
      position += 1;
    }
    if (!symbol(')')) return null;
    position += 1;
    return { kind: 'cast', item, type, parameters: typeParameters };
  }

  function parseCase() {
    position += 1;
    const whens = [];
    while (word('when')) {
      position += 1;
      const condition = parseOr();
      if (!condition || !word('then')) return null;
      position += 1;
      const value = parseOr();
      if (!value) return null;
      whens.push({ condition, value });
    }
    if (!whens.length) return null;
    let alternate = null;
    if (word('else')) {
      position += 1;
      alternate = parseOr();
      if (!alternate) return null;
    }
    if (!word('end')) return null;
    position += 1;
    return { kind: 'case', whens, alternate };
  }

  const ast = parseOr();
  if (!ast || position !== tokens.length) return null;
  return ast;
}

function renderExpressionAst(node) {
  const render = (child) => renderExpressionAst(child);
  switch (node.kind) {
    case 'or': return `(or ${node.items.map(render).join(' ')})`;
    case 'and': return `(and ${node.items.map(render).join(' ')})`;
    case 'not': return `(not ${render(node.item)})`;
    case 'cmp': return `(${node.op} ${render(node.left)} ${render(node.right)})`;
    case 'isnull': return `(${node.negated ? 'isnotnull' : 'isnull'} ${render(node.item)})`;
    case 'in': return `(${node.negated ? 'notin' : 'in'} ${render(node.item)} (${node.values.map(render).join(' ')}))`;
    case 'between': return `(${node.negated ? 'notbetween' : 'between'} ${render(node.item)} ${render(node.low)} ${render(node.high)})`;
    case 'like': return `(${node.negated ? 'notlike' : 'like'} ${render(node.item)} ${render(node.pattern)})`;
    case 'arith': return `(${node.op} ${render(node.left)} ${render(node.right)})`;
    case 'neg': return `(neg ${render(node.item)})`;
    case 'str': return `(str ${JSON.stringify(node.value)})`;
    case 'num': return `(num ${JSON.stringify(node.value)})`;
    case 'null': return '(null)';
    case 'id': return `(id ${node.name})`;
    case 'fn': return `(fn ${node.name}${node.args.length ? ` ${node.args.map(render).join(' ')}` : ''})`;
    case 'cast': return `(cast ${render(node.item)} ${node.type}${node.parameters ? ` ${node.parameters.map((value) => `(num ${JSON.stringify(value)})`).join(' ')}` : ''})`;
    case 'case': return `(case ${node.whens.map((entry) => `(when ${render(entry.condition)} ${render(entry.value)})`).join(' ')}${node.alternate ? ` (else ${render(node.alternate)})` : ''})`;
    default: throw new Error('M1_SCHEMA_PARITY_AST_INVALID');
  }
}

// The canonical form of one expression.
//
// `C:` marks a parsed expression, `R:` marks an expression the scope-limited
// parser REFUSED. The two forms can never be equal, so a refused expression
// can only ever match another refused expression with the very same token
// stream: an unrecognised expression fails closed.
export function canonicalExpression(value, {
  dialect = M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD,
  normalizeGeneratedCastCharset = false,
} = {}) {
  const tokens = sqlExpressionTokenList(value, { dialect, normalizeGeneratedCastCharset });
  const ast = parseExpressionTokens(tokens);
  if (!ast) return `R:${tokens.join('|')}`;
  return `C:${renderExpressionAst(ast)}`;
}

function normalizedNumericDefault(value) {
  const match = String(value).match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = String(match[3] || '').replace(/0+$/, '');
  const zero = integer === '0' && !fraction;
  if (zero) return '0';
  return `${match[1] === '-' ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

// The production translator maps these SQLite default expressions onto the
// MySQL keyword of the same meaning, so both sides must agree on one key.
function defaultKeyword(value) {
  const text = String(value).trim();
  if (/^current_timestamp(?:\(\))?$/i.test(text)) return 'KEYWORD:CURRENT_TIMESTAMP';
  if (/^current_date(?:\(\))?$/i.test(text)) return 'KEYWORD:CURRENT_DATE';
  if (/^datetime\s*\(\s*'now'\s*\)$/i.test(text)) return 'KEYWORD:CURRENT_TIMESTAMP';
  if (/^date\s*\(\s*'now'\s*\)$/i.test(text)) return 'KEYWORD:CURRENT_DATE';
  return null;
}

function isNumericColumn(column) {
  const declared = String(column?.type || '').toUpperCase();
  return declared.includes('INT') || declared.includes('REAL') || declared.includes('FLOA')
    || declared.includes('DOUB') || declared.includes('NUM');
}

// The canonical form of a DEFAULT.
//
// The canonical form keeps every distinction the contract depends on:
//   NONE           the column has no default at all
//   EMPTY          the default is the empty string (NOT the same as NONE)
//   STRING:<json>  a text literal, case significant
//   NUMBER:<n>     a numeric literal, in one normalised representation
//   KEYWORD:<kw>   a calendar keyword
//   EXPR:<tokens>  any other expression
//
// The SQLite side reports the raw literal text of the DDL; the MySQL side
// reports either the evaluated value of a LITERAL default or the expression
// text of an EXPRESSION default (EXTRA carries DEFAULT_GENERATED for the
// latter). The two sides are therefore canonicalised through the dialect of
// their own provenance.
export function canonicalDefault(value, { catalogue = false, extra = '', numeric = false } = {}) {
  if (value === null || value === undefined) return 'NONE';
  const text = String(value).trim();
  if (text === '') return 'EMPTY';
  const expression = String(extra || '').toUpperCase().includes('DEFAULT_GENERATED');
  if (!expression) {
    // A literal default: the catalogue reports the evaluated value, bare.
    // Whether that value is a number or text is decided by the column's own
    // declared kind, so the text default '0' of a text column never compares
    // equal to the numeric default 0 of a numeric column.
    const keyword = defaultKeyword(text);
    if (keyword) return keyword;
    if (numeric) {
      const number = normalizedNumericDefault(text);
      return `NUMBER:${number === null ? text : number}`;
    }
    return `STRING:${JSON.stringify(text)}`;
  }
  const tokens = sqlExpressionTokenList(text, {
    dialect: catalogue ? M1_CORE_SQL_LITERAL_DIALECT.MYSQL_CATALOG : M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD,
  });
  if (tokens.length === 1) {
    const token = tokens[0];
    if (token.startsWith('STRING:')) return token === 'STRING:""' ? 'EMPTY' : token;
    if (token.startsWith('NUMBER:')) {
      const number = normalizedNumericDefault(token.slice('NUMBER:'.length));
      return `NUMBER:${number === null ? token.slice('NUMBER:'.length) : number}`;
    }
  }
  const keyword = defaultKeyword(text);
  if (keyword) return keyword;
  return `EXPR:${tokens.join('|')}`;
}

// The SQLite side of a DEFAULT, in the same canonical vocabulary.
export function canonicalSqliteDefault(value) {
  if (value === null || value === undefined) return 'NONE';
  const text = String(value).trim();
  if (text === '') return 'NONE';
  const tokens = sqlExpressionTokenList(text, { dialect: M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD });
  if (tokens.length === 1) {
    const token = tokens[0];
    if (token.startsWith('STRING:')) return token === 'STRING:""' ? 'EMPTY' : token;
    if (token.startsWith('NUMBER:')) {
      const number = normalizedNumericDefault(token.slice('NUMBER:'.length));
      return `NUMBER:${number === null ? token.slice('NUMBER:'.length) : number}`;
    }
  }
  const keyword = defaultKeyword(text);
  if (keyword) return keyword;
  return `EXPR:${tokens.join('|')}`;
}

export function generatedExpression(tableName, index) {
  const ddl = generatedPartialIndex(tableName, index)[0];
  const marker = 'GENERATED ALWAYS AS (';
  const open = ddl.indexOf(marker);
  if (open < 0) throw new Error(`SCHEMA_PARITY_GENERATED_RULE_INVALID:${tableName}.${index.name}`);
  const start = open + marker.length - 1;
  let depth = 0;
  for (let cursor = start; cursor < ddl.length; cursor += 1) {
    if (ddl[cursor] === '(') depth += 1;
    else if (ddl[cursor] === ')' && --depth === 0) return ddl.slice(start + 1, cursor);
  }
  throw new Error(`SCHEMA_PARITY_GENERATED_RULE_INVALID:${tableName}.${index.name}`);
}

export function readMySqlInformationSchemaContract(db, tableName) {
  const columns = db.prepare(`SELECT COLUMN_NAME column_name,DATA_TYPE data_type,IS_NULLABLE is_nullable,
      COLUMN_DEFAULT column_default,ORDINAL_POSITION ordinal_position,COLUMN_KEY column_key,
      EXTRA extra,GENERATION_EXPRESSION generation_expression
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`).all(tableName);
  const indexes = db.prepare(`SELECT INDEX_NAME index_name,COLUMN_NAME column_name,SEQ_IN_INDEX seq_in_index,NON_UNIQUE non_unique
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`).all(tableName);
  const foreignKeys = db.prepare(`SELECT k.CONSTRAINT_NAME constraint_name,k.COLUMN_NAME column_name,
      k.REFERENCED_TABLE_NAME referenced_table_name,k.REFERENCED_COLUMN_NAME referenced_column_name,
      r.UPDATE_RULE update_rule,r.DELETE_RULE delete_rule,k.ORDINAL_POSITION ordinal_position
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`).all(tableName);
  const checks = db.prepare(`SELECT cc.CHECK_CLAUSE check_clause,tc.ENFORCED enforced
    FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'
    ORDER BY tc.CONSTRAINT_NAME`).all(tableName);
  return Object.freeze({ tableName, columns, indexes, foreignKeys, checks });
}

function extractSqliteChecks(sql) {
  const result = [];
  const source = String(sql || '');
  for (let cursor = 0; cursor < source.length;) {
    const match = /\bCHECK\s*\(/ig;
    match.lastIndex = cursor;
    const found = match.exec(source);
    if (!found) break;
    const start = match.lastIndex - 1;
    let depth = 0; let quote = ''; let end = -1;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index + 1] === quote) index += 1;
        else if (character === quote) quote = '';
      } else if (character === "'" || character === '"') quote = character;
      else if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) { end = index; break; }
    }
    if (end < 0) throw new Error('SCHEMA_PARITY_SQLITE_CHECK_PARSE_FAILED');
    result.push(source.slice(start + 1, end)); cursor = end + 1;
  }
  return result;
}

export function compareTableParity(sqliteTable, mysqlContract) {
  const errors = [];
  // The physical implementation plan is the ONE rule of the production
  // generator. A plain non-unique multi-column index is a plain physical
  // index, however many columns it spans.
  const generatedIndexes = sqliteTable.indexes.filter(usesGeneratedDigest);
  const expectedGeneratedColumns = new Set(generatedIndexes.map((index) => mysqlGeneratedPartialIndexColumnName(index.name)));
  const physicalColumns = new Map(mysqlContract.columns.map((column) => [column.column_name, column]));
  for (const index of generatedIndexes) {
    const columnName = mysqlGeneratedPartialIndexColumnName(index.name);
    const actual = physicalColumns.get(columnName);
    if (!actual) { errors.push(`GENERATED_COLUMN_MISSING:${columnName}`); continue; }
    if (String(actual.extra || '').trim().toUpperCase() !== 'STORED GENERATED') {
      errors.push(`GENERATED_COLUMN_KIND:${columnName}`);
    }
    const expectedExpression = canonicalExpression(generatedExpression(sqliteTable.name, index), {
      normalizeGeneratedCastCharset: true,
      dialect: M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD,
    });
    const actualExpression = canonicalExpression(actual.generation_expression, {
      normalizeGeneratedCastCharset: true,
      dialect: M1_CORE_SQL_LITERAL_DIALECT.MYSQL_CATALOG,
    });
    if (actualExpression !== expectedExpression) errors.push(`GENERATED_COLUMN_EXPRESSION:${columnName}`);
  }
  const logicalMySqlColumns = mysqlContract.columns.filter((column) => !expectedGeneratedColumns.has(column.column_name));
  const mysqlColumns = new Map(logicalMySqlColumns.map((column) => [column.column_name, column]));
  const expectedNames = sqliteTable.columns.map((column) => column.name);
  const actualNames = logicalMySqlColumns.map((column) => column.column_name);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) errors.push('COLUMN_SEQUENCE');
  const indexed = new Set([...sqliteTable.indexes.flatMap((index) => index.columns), ...sqliteTable.foreignKeys.map((fk) => fk.from)]);
  for (const column of sqliteTable.columns) {
    const actual = mysqlColumns.get(column.name);
    if (!actual) continue;
    if (String(actual.data_type).toLowerCase() !== mysqlTypeFamily(column, indexed.has(column.name), sqliteTable.name)) errors.push(`TYPE:${column.name}`);
    const expectedNullable = column.notnull || column.pk ? 'NO' : 'YES';
    if (actual.is_nullable !== expectedNullable) errors.push(`NULLABLE:${column.name}`);
    const expectedDefault = canonicalSqliteDefault(column.dflt_value);
    const actualDefault = canonicalDefault(actual.column_default, {
      catalogue: true,
      extra: actual.extra,
      numeric: isNumericColumn(column),
    });
    if (actualDefault !== expectedDefault) errors.push(`DEFAULT:${column.name}`);
  }

  const groupedIndexes = new Map();
  for (const row of mysqlContract.indexes) {
    const entry = groupedIndexes.get(row.index_name) || { unique: Number(row.non_unique) === 0, columns: [] };
    entry.columns.push(row.column_name); groupedIndexes.set(row.index_name, entry);
  }
  for (const index of sqliteTable.indexes.filter((item) => item.origin !== 'pk' && item.columns.length)) {
    const generated = usesGeneratedDigest(index);
    if (index.origin === 'u' && !generated) {
      const actual = [...groupedIndexes.values()].find((candidate) => candidate.unique
        && JSON.stringify(candidate.columns) === JSON.stringify(index.columns));
      if (!actual) errors.push(`UNIQUE_MISSING:${index.columns.join('+')}`);
      continue;
    }
    const actual = groupedIndexes.get(index.name);
    if (!actual) { errors.push(`${index.unique ? 'UNIQUE' : 'INDEX'}_MISSING:${index.name}`); continue; }
    if (actual.unique !== Boolean(index.unique)) errors.push(`INDEX_UNIQUE:${index.name}`);
    const expectedColumns = generated ? [mysqlGeneratedPartialIndexColumnName(index.name)] : index.columns;
    if (JSON.stringify(actual.columns) !== JSON.stringify(expectedColumns)) errors.push(`INDEX_COLUMNS:${index.name}`);
  }

  const actualFks = mysqlContract.foreignKeys.map((fk) => `${fk.column_name}->${fk.referenced_table_name}.${fk.referenced_column_name}:${fk.update_rule}:${fk.delete_rule}`).sort();
  const expectedFks = sqliteTable.foreignKeys.map((fk) => `${fk.from}->${fk.table}.${fk.to}:${fk.on_update || 'NO ACTION'}:${fk.on_delete || 'NO ACTION'}`).sort();
  if (JSON.stringify(actualFks) !== JSON.stringify(expectedFks)) errors.push('FOREIGN_KEYS');

  if (mysqlContract.checks.some((row) => String(row.enforced || '').toUpperCase() !== 'YES')) errors.push('CHECK_NOT_ENFORCED');
  const expectedChecks = extractSqliteChecks(sqliteTable.sql)
    .map((check) => canonicalExpression(check, { dialect: M1_CORE_SQL_LITERAL_DIALECT.SQL_STANDARD })).sort();
  const actualChecks = mysqlContract.checks
    .map((row) => canonicalExpression(row.check_clause, { dialect: M1_CORE_SQL_LITERAL_DIALECT.MYSQL_CATALOG })).sort();
  if (JSON.stringify(actualChecks) !== JSON.stringify(expectedChecks)) errors.push('CHECKS');
  return Object.freeze(errors);
}

// The sanitised, read-only structural evidence of a parity failure.
//
// It carries the live catalogue rendering of the constructs that differ, so a
// failing Gate states WHAT the server actually reports instead of only the
// difference code. It carries schema metadata only: never a row, never a
// credential, never a token.
export function describeM1CoreStructuralDifference(db, sqliteSnapshot, tableNames = M1_CORE_PARITY_TABLES) {
  const tables = new Map(sqliteSnapshot.tables.map((table) => [table.name, table]));
  const lines = [];
  for (const tableName of tableNames) {
    const sqlite = tables.get(tableName);
    if (!sqlite) continue;
    const contract = readMySqlInformationSchemaContract(db, tableName);
    const errors = compareTableParity(sqlite, contract);
    if (!errors.length) continue;
    lines.push(`TABLE ${tableName}`);
    for (const error of errors) {
      const [kind, detail = ''] = error.split(':');
      if (kind === 'DEFAULT') {
        const column = contract.columns.find((item) => item.column_name === detail);
        if (column) {
          lines.push(`  DEFAULT ${detail} mysql_column_default=${JSON.stringify(String(column.column_default ?? ''))} mysql_extra=${JSON.stringify(String(column.extra ?? ''))} mysql_data_type=${JSON.stringify(String(column.data_type ?? ''))}`);
        }
      } else if (kind === 'CHECKS') {
        for (const check of contract.checks) {
          lines.push(`  CHECK mysql_check_clause=${JSON.stringify(String(check.check_clause ?? ''))} mysql_enforced=${JSON.stringify(String(check.enforced ?? ''))}`);
        }
      } else if (kind === 'GENERATED_COLUMN_EXPRESSION' || kind === 'GENERATED_COLUMN_MISSING' || kind === 'GENERATED_COLUMN_KIND') {
        const column = contract.columns.find((item) => item.column_name === detail);
        if (column) {
          lines.push(`  GENERATED ${detail} mysql_generation_expression=${JSON.stringify(String(column.generation_expression ?? ''))} mysql_extra=${JSON.stringify(String(column.extra ?? ''))}`);
        }
      } else if (kind === 'INDEX_COLUMNS' || kind === 'INDEX_UNIQUE' || kind === 'INDEX_MISSING' || kind === 'UNIQUE_MISSING') {
        const rows = contract.indexes.filter((item) => item.index_name === detail);
        lines.push(`  INDEX ${detail} mysql_index_rows=${JSON.stringify(rows.map((row) => `${row.index_name}:${row.column_name}:${row.non_unique}`))}`);
      }
    }
  }
  const bounded = lines.join('\n').slice(0, 6000);
  return bounded;
}

export function assertM1CoreInformationSchemaParity(db, sqliteSnapshot, tableNames = M1_CORE_PARITY_TABLES) {
  if (db?.dialect !== 'mysql') throw new Error('M1_SCHEMA_PARITY_REQUIRES_REAL_MYSQL');
  const tables = new Map(sqliteSnapshot.tables.map((table) => [table.name, table]));
  const failures = [];
  for (const tableName of tableNames) {
    const sqlite = tables.get(tableName);
    if (!sqlite) { failures.push(`${tableName}:SQLITE_TABLE_MISSING`); continue; }
    const errors = compareTableParity(sqlite, readMySqlInformationSchemaContract(db, tableName));
    if (errors.length) failures.push(`${tableName}:${errors.join(',')}`);
  }
  if (failures.length) {
    const structural = describeM1CoreStructuralDifference(db, sqliteSnapshot, tableNames);
    throw new Error(`M1_SCHEMA_PARITY_MISMATCH\n${failures.join('\n')}\nM1_SCHEMA_PARITY_STRUCTURAL_EVIDENCE\n${structural}`);
  }
  return Object.freeze({ tables: Object.freeze([...tableNames]), source: 'information_schema', status: 'MATCHED' });
}
