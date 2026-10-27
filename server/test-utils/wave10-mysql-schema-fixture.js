import assert from 'node:assert/strict';
import { mysqlTypeFamily } from '../database/mysql-schema.js';
import { SALES_WAVE9_TABLES } from '../migrations/sales-customer-wave9-credit-foundation.js';
import { SALES_WAVE10_TABLES, UNIQUE_CONSTRAINTS } from '../migrations/sales-customer-wave10-credit-check.js';

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

export function createWave9BoundedSnapshot(snapshot) {
  const wave10 = new Set(SALES_WAVE10_TABLES);
  const tables = snapshot.tables.filter((table) => !wave10.has(table.name));
  const names = new Set(tables.map((table) => table.name));
  for (const name of SALES_WAVE9_TABLES) assert.ok(names.has(name), `Wave 9 snapshot missing ${name}`);
  for (const name of SALES_WAVE10_TABLES) assert.equal(names.has(name), false, `Wave 9 snapshot contains ${name}`);
  return Object.freeze({ tables });
}

// §37.50 — the production generator's rule (mysql-schema.js:184-187): a
// foreign-key source column counts as an indexed column.
//
// The narrower index-only rule predicted `LONGTEXT` for five foreign-key
// columns whose names do not end in `_id`. That is not a schema that could
// exist: InnoDB refuses a foreign key whose child column is not type
// compatible with its parent column, and every referenced parent column is
// `VARCHAR(128)`. `isValidColumnName` is the production one-line predicate
// (mysql-schema.js:21-23); it is not exported, so it is reproduced here.
//
// The physical type family itself is still produced by the production
// `mysqlTypeFamily` — this file contains no second type mapping.
function isValidColumnName(value) {
  return typeof value === 'string' && value.length > 0;
}

function mysqlIndexedColumns(table) {
  return new Set([
    ...table.indexes.flatMap((index) => index.columns.filter(isValidColumnName)),
    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
}

function normalizeReferentialAction(value) {
  const action = String(value || 'NO ACTION').toUpperCase();
  return action === 'NO ACTION' ? 'RESTRICT' : action;
}

// §37.39.8.2 — the normalized default. SQLite reports the raw literal text and
// MySQL reports the evaluated default, so the surrounding quotes and the
// `NULL` literal are normalized to one representation.
export function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^null$/i.test(text)) return null;
  const unquoted = /^'(.*)'$/s.exec(text);
  return (unquoted ? unquoted[1] : text).trim();
}

// §37.39.8.2 — the normalized CHECK clause.
//
// SQLite carries the migration DDL verbatim. MySQL re-renders the same
// constraint: it wraps the whole clause in parentheses, parenthesises every
// AND/OR operand, re-spaces the binary operators and adds a charset introducer
// to a literal. Those are representation differences, so the clause is parsed
// into its expression tree and re-rendered in one canonical form. The operator
// structure and the value set are preserved exactly, so a genuinely different
// constraint (a different operator, a different operand, a different value
// set) keeps a different canonical form and never compares equal.
//
// String literals are compared case-insensitively because every Wave 9/10
// column on the MySQL target uses the case-insensitive `utf8mb4_0900_ai_ci`
// collation, under which 'PASS' and 'pass' are the same value. A clause that
// cannot be parsed keeps a distinct `raw:` form, so an unparsed clause never
// silently compares equal to a parsed one.
class CheckClauseSyntaxError extends Error {}

// §37.48 — the literal dialect follows the provenance of the input, never the
// shape of its bytes.
//
// `sql_standard` is the dialect of the canonical SQLite DDL source: inside a
// `'...'` literal only the SQL-standard doubled quote denotes a literal quote.
//
// `mysql_catalog` is the dialect of the live MySQL catalogue rendering
// (`information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`). The server renders a
// string literal with its delimiters themselves backslash-escaped, exactly as
// the protected Wave 10 acceptance campaign captured it, so such a literal
// opens and closes with the two-byte sequence \'. The content between the
// delimiters is taken verbatim.
//
// The two dialects disagree about a backslash, so the dialect is an explicit
// input and is never inferred from the text. A backslash inside a literal is
// refused in BOTH dialects: under `sql_standard` it is not a supported form,
// and under `mysql_catalog` the catalogue's rendering convention for *content*
// escapes was never observed, so decoding one could merge two different
// literals into one value.
export const CHECK_LITERAL_DIALECT = Object.freeze({
  SQL_STANDARD: 'sql_standard',
  MYSQL_CATALOG: 'mysql_catalog',
});

const SQL_STANDARD_LITERAL_QUOTE = "'";
const MYSQL_CATALOG_LITERAL_QUOTE = "\\'";

function literalQuote(dialect) {
  return dialect === CHECK_LITERAL_DIALECT.MYSQL_CATALOG
    ? MYSQL_CATALOG_LITERAL_QUOTE
    : SQL_STANDARD_LITERAL_QUOTE;
}

// Reads one string literal and returns its semantic value.
//
// The SQL-standard dialect accepts the doubled quote (`''` -> `'`). The MySQL
// catalogue dialect does NOT accept a doubled delimiter: the catalogue escapes
// every quote it renders, so a doubled form was never observed and accepting
// one could merge two adjacent literals into a single value.
//
// A literal that is not closed, that carries a quote of another kind, or that
// carries a backslash, is refused. The refusal is a CheckClauseSyntaxError, so
// the caller falls back to the distinct `raw:` form and never treats the
// clause as equivalent to a parsed one.
function readStringLiteral(text, start, dialect) {
  const quote = literalQuote(dialect);
  const mysqlCatalog = dialect === CHECK_LITERAL_DIALECT.MYSQL_CATALOG;
  let cursor = start + quote.length;
  let value = '';
  for (;;) {
    if (cursor >= text.length) throw new CheckClauseSyntaxError('unterminated string literal');
    if (!mysqlCatalog && text.startsWith("''", cursor)) { value += "'"; cursor += 2; continue; }
    if (text.startsWith(quote, cursor)) { cursor += quote.length; break; }
    const char = text[cursor];
    if (char === '\\') throw new CheckClauseSyntaxError('unsupported escape inside string literal');
    if (mysqlCatalog && (char === "'" || char === '"' || char === '`')) {
      throw new CheckClauseSyntaxError('unescaped quote inside string literal');
    }
    value += char; cursor += 1;
  }
  return { value, next: cursor };
}

function tokenizeCheckClause(text, dialect = CHECK_LITERAL_DIALECT.SQL_STANDARD) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (dialect === CHECK_LITERAL_DIALECT.MYSQL_CATALOG) {
      // The catalogue dialect opens a literal only with the escaped delimiter.
      // A plain quote is not a catalogue form, so it is not silently accepted
      // as one: the dialect is never auto-detected from the text.
      if (text.startsWith(MYSQL_CATALOG_LITERAL_QUOTE, index)) {
        const literal = readStringLiteral(text, index, dialect);
        tokens.push({ kind: 'literal', value: literal.value });
        index = literal.next;
        continue;
      }
    } else if (char === "'") {
      const literal = readStringLiteral(text, index, dialect);
      tokens.push({ kind: 'literal', value: literal.value });
      index = literal.next;
      continue;
    }
    if (char === '"' || char === '`') {
      const closing = char;
      let cursor = index + 1;
      let value = '';
      while (cursor < text.length) {
        if (text[cursor] === closing && text[cursor + 1] === closing) { value += closing; cursor += 2; continue; }
        if (text[cursor] === closing) { cursor += 1; break; }
        value += text[cursor]; cursor += 1;
      }
      tokens.push({ kind: 'word', value });
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let cursor = index;
      while (cursor < text.length && /[0-9.]/.test(text[cursor])) cursor += 1;
      tokens.push({ kind: 'literal', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let cursor = index;
      while (cursor < text.length && /[A-Za-z0-9_$]/.test(text[cursor])) cursor += 1;
      tokens.push({ kind: 'word', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }
    if ('<>=!'.includes(char)) {
      let value = char;
      let cursor = index + 1;
      if (text[cursor] === '=') { value += '='; cursor += 1; }
      else if (char === '<' && text[cursor] === '>') { value = '<>'; cursor += 1; }
      tokens.push({ kind: 'operator', value });
      index = cursor;
      continue;
    }
    if ('(),'.includes(char)) { tokens.push({ kind: 'punctuation', value: char }); index += 1; continue; }
    throw new CheckClauseSyntaxError(`unsupported token ${char}`);
  }
  return tokens;
}

class CheckClauseParser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }

  peek(offset = 0) { return this.tokens[this.index + offset] || null; }

  take() {
    const token = this.peek();
    if (token) this.index += 1;
    return token;
  }

  expect(value) {
    const token = this.take();
    if (!token || String(token.value).toLowerCase() !== value) throw new CheckClauseSyntaxError(`expected ${value}`);
    return token;
  }

  isKeyword(value, offset = 0) {
    const token = this.peek(offset);
    return Boolean(token) && token.kind === 'word' && String(token.value).toLowerCase() === value;
  }

  parseExpression() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.isKeyword('or')) {
      this.take();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseUnary();
    while (this.isKeyword('and')) {
      this.take();
      left = { kind: 'and', left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.isKeyword('not') && !this.isKeyword('in', 1)) {
      this.take();
      return { kind: 'not', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new CheckClauseSyntaxError('unexpected end of clause');
    if (token.kind === 'punctuation' && token.value === '(') {
      this.take();
      const expression = this.parseExpression();
      this.expect(')');
      // The grouping is already encoded in the tree, so the redundant
      // parentheses are dropped here and re-created by the canonical renderer
      // only where the operator precedence requires them.
      return expression;
    }
    const operand = this.parseOperand();
    if (this.peek()?.kind === 'operator') {
      const operator = this.take().value;
      return {
        kind: 'comparison',
        operator: operator === '!=' ? '<>' : operator,
        left: operand,
        right: this.parseOperand(),
      };
    }
    if (this.isKeyword('is')) {
      this.take();
      const negated = this.isKeyword('not');
      if (negated) this.take();
      this.expect('null');
      return { kind: negated ? 'isNotNull' : 'isNull', operand };
    }
    if (this.isKeyword('in')) {
      this.take();
      return { kind: 'in', operand, values: this.parseValueList(), negated: false };
    }
    if (this.isKeyword('not') && this.isKeyword('in', 1)) {
      this.take();
      this.take();
      return { kind: 'in', operand, values: this.parseValueList(), negated: true };
    }
    return operand;
  }

  parseValueList() {
    this.expect('(');
    const values = [];
    for (;;) {
      const value = this.take();
      if (!value || (value.kind !== 'literal' && value.kind !== 'word')) throw new CheckClauseSyntaxError('invalid IN list');
      values.push(value);
      const separator = this.take();
      if (!separator) throw new CheckClauseSyntaxError('unterminated IN list');
      if (separator.value === ',') continue;
      if (separator.value === ')') break;
      throw new CheckClauseSyntaxError('invalid IN list separator');
    }
    return values;
  }

  parseOperand() {
    const token = this.take();
    if (!token) throw new CheckClauseSyntaxError('missing operand');
    if (token.kind === 'literal') return { kind: 'literal', value: token.value };
    if (token.kind !== 'word') throw new CheckClauseSyntaxError('invalid operand');
    if (this.peek()?.kind === 'punctuation' && this.peek().value === '(') {
      this.take();
      let depth = 1;
      let args = '';
      while (depth > 0) {
        const part = this.take();
        if (!part) throw new CheckClauseSyntaxError('unterminated function call');
        if (part.kind === 'punctuation' && part.value === '(') depth += 1;
        if (part.kind === 'punctuation' && part.value === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        args += part.value;
      }
      return { kind: 'call', name: String(token.value).toLowerCase(), args };
    }
    return { kind: 'identifier', value: String(token.value).toLowerCase() };
  }
}

function renderCheckOperand(node, parent) {
  if (node.kind === 'or' && parent !== 'or') return `(${renderCheckClause(node)})`;
  if (node.kind === 'and' && parent !== 'and') return `(${renderCheckClause(node)})`;
  return renderCheckClause(node);
}

function renderCheckClause(node) {
  switch (node.kind) {
    case 'or': return `${renderCheckOperand(node.left, 'or')} or ${renderCheckOperand(node.right, 'or')}`;
    case 'and': return `${renderCheckOperand(node.left, 'and')} and ${renderCheckOperand(node.right, 'and')}`;
    case 'not': return `not ${renderCheckOperand(node.operand, 'not')}`;
    case 'comparison': return `${renderCheckOperand(node.left, 'comparison')} ${node.operator} ${renderCheckOperand(node.right, 'comparison')}`;
    case 'isNull': return `${renderCheckOperand(node.operand, 'comparison')} is null`;
    case 'isNotNull': return `${renderCheckOperand(node.operand, 'comparison')} is not null`;
    case 'in': return `${renderCheckOperand(node.operand, 'comparison')} ${node.negated ? 'not in' : 'in'} (${node.values.map((value) => `'${String(value.value).toLowerCase()}'`).join(', ')})`;
    case 'identifier': return node.value;
    case 'literal': return `'${String(node.value).toLowerCase()}'`;
    case 'call': return `${node.name}(${node.args})`;
    default: throw new CheckClauseSyntaxError(`unsupported node ${node.kind}`);
  }
}

// §37.48 — the normalization diagnostic.
//
// `form` is one of `canonical` (the clause was parsed and re-rendered), `raw`
// (the clause could not be parsed and keeps the distinct, distinguishable
// `raw:` form) or `empty`. `reason` retains the parse failure, so that an
// unsupported-syntax fallback can never be confused with a representational
// one. The diagnostic is bounded: it carries the dialect, the canonical form
// and one short fixed phrase — never the surrounding SQL and never a
// credential.
export function describeCheckClauseNormalization(value, options = {}) {
  const dialect = options.dialect === CHECK_LITERAL_DIALECT.MYSQL_CATALOG
    ? CHECK_LITERAL_DIALECT.MYSQL_CATALOG
    : CHECK_LITERAL_DIALECT.SQL_STANDARD;
  const text = String(value || '')
    .replace(/`/g, '')
    .replace(/_utf8mb4|_utf8|_binary/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return Object.freeze({ form: 'empty', dialect, canonical: '', reason: 'empty clause' });
  try {
    const tokens = tokenizeCheckClause(text, dialect);
    const parser = new CheckClauseParser(tokens);
    const expression = parser.parseExpression();
    if (parser.index !== tokens.length) throw new CheckClauseSyntaxError('trailing tokens');
    return Object.freeze({ form: 'canonical', dialect, canonical: renderCheckClause(expression), reason: null });
  } catch (error) {
    if (!(error instanceof CheckClauseSyntaxError)) throw error;
    return Object.freeze({ form: 'raw', dialect, canonical: `raw: ${text.toLowerCase()}`, reason: error.message });
  }
}

// The normalization entry point keeps its existing contract: it returns the
// canonical form of a parsable clause and the distinct `raw:` form of one that
// is not parsable.
export function normalizeCheckClause(value, options = {}) {
  return describeCheckClauseNormalization(value, options).canonical;
}

export function extractCheckClauses(ddl, options = {}) {
  const sql = String(ddl || '');
  const checks = [];
  const upper = sql.toUpperCase();
  let cursor = 0;
  while ((cursor = upper.indexOf('CHECK', cursor)) >= 0) {
    let start = cursor + 5;
    while (/\s/.test(sql[start] || '')) start += 1;
    if (sql[start] !== '(') { cursor = start; continue; }
    let depth = 0;
    let quoteChar = '';
    for (let i = start; i < sql.length; i += 1) {
      const char = sql[i];
      if (quoteChar) {
        if (char === quoteChar && sql[i + 1] === quoteChar) i += 1;
        else if (char === quoteChar) quoteChar = '';
      } else if (char === "'" || char === '"') quoteChar = char;
      else if (char === '(') depth += 1;
      else if (char === ')' && --depth === 0) {
        checks.push(sql.slice(start + 1, i));
        cursor = i + 1;
        break;
      }
    }
  }
  return checks.map((clause) => normalizeCheckClause(clause, options)).sort();
}

// §37.50 — the canonical CHECK comparison.
//
// Two CHECK sets are equal when their normalized canonical forms are equal as a
// multiset. The order of the constraints carries no business meaning — the
// live catalogue's order is a function of the server's rendering, not of the
// schema — but the number of occurrences of each constraint does.
//
// The two sides are therefore compared as sorted arrays and never as sets, so
// a repeated constraint stays a repeated constraint and a missing, an extra or
// a changed constraint is still a difference. The helper never mutates the
// arrays it receives, and it keeps the strict difference detection and the
// diagnostic of `assert.deepEqual`.
export function assertCheckParity(expectedChecks, actualChecks, label) {
  assert.deepEqual([...actualChecks].sort(), [...expectedChecks].sort(),
    `${label}: check-constraint parity`);
}

// The physical type family is decided by the canonical MySQL generator, not by
// a second mapper in this fixture. A second mapper silently disagrees with
// the generator and turns a real schema difference into a parity failure (or,
// worse, hides one).
export function sqliteColumnToMySqlFamily(column, indexed = false, tableName = '') {
  return mysqlTypeFamily(column, indexed, tableName);
}

export function normalizedSqliteTable(table) {
  const indexed = mysqlIndexedColumns(table);
  return Object.freeze({
    name: table.name,
    columns: table.columns.map((column) => Object.freeze({
      name: column.name,
      type: sqliteColumnToMySqlFamily(column, indexed.has(column.name), table.name),
      nullable: !Boolean(column.notnull) && !Boolean(column.pk),
      default: normalizeDefault(column.dflt_value),
      primaryOrdinal: Number(column.pk || 0),
    })),
    foreignKeys: table.foreignKeys.map((fk) => Object.freeze({
      column: fk.from, parentTable: fk.table, parentColumn: fk.to,
      onUpdate: normalizeReferentialAction(fk.on_update),
      onDelete: normalizeReferentialAction(fk.on_delete),
    })).sort((a, b) => `${a.column}:${a.parentTable}`.localeCompare(`${b.column}:${b.parentTable}`)),
    indexes: table.indexes.filter((index) => index.columns.length && index.columns.every(Boolean))
      .map((index) => {
        // A SQLite table-level UNIQUE constraint lives on an auto-index that
        // carries no portable name. When the canonical migration fixes that
        // constraint's identity, the constraint is surfaced under its approved
        // name instead of being dropped, so the declared uniqueness is never
        // silently missing from the comparison.
        const approved = index.unique ? approvedUniqueConstraint(table.name, index.columns) : null;
        if (approved) return Object.freeze({ name: approved.name, unique: true, columns: [...index.columns] });
        if (index.name.startsWith('sqlite_autoindex_')) return null;
        return Object.freeze({ name: index.name, unique: Boolean(index.unique), columns: [...index.columns] });
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
    checks: Object.freeze(extractCheckClauses(table.sql)),
  });
}

export function readNormalizedMySqlTable(db, tableName) {
  assert.match(tableName, /^[A-Za-z0-9_]+$/);
  const columns = db.prepare(`SELECT COLUMN_NAME name,DATA_TYPE type,IS_NULLABLE nullable,
      COLUMN_DEFAULT default_value,COALESCE(ORDINAL_POSITION,0) ordinal_position,COLUMN_KEY column_key
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
    ORDER BY ORDINAL_POSITION`).all(tableName).map((column) => Object.freeze({
    name: column.name,
    type: String(column.type).toLowerCase(),
    nullable: String(column.nullable).toUpperCase() === 'YES',
    default: normalizeDefault(column.default_value),
    primaryOrdinal: String(column.column_key).toUpperCase() === 'PRI' ? Number(column.ordinal_position) : 0,
  }));
  const foreignKeys = db.prepare(`SELECT k.COLUMN_NAME column_name,k.REFERENCED_TABLE_NAME parent_table,
      k.REFERENCED_COLUMN_NAME parent_column,r.UPDATE_RULE update_rule,r.DELETE_RULE delete_rule
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.COLUMN_NAME,k.REFERENCED_TABLE_NAME`).all(tableName).map((fk) => Object.freeze({
    column: fk.column_name, parentTable: fk.parent_table, parentColumn: fk.parent_column,
    onUpdate: normalizeReferentialAction(fk.update_rule), onDelete: normalizeReferentialAction(fk.delete_rule),
  }));
  const indexRows = db.prepare(`SELECT INDEX_NAME index_name,NON_UNIQUE non_unique,SEQ_IN_INDEX seq_in_index,COLUMN_NAME column_name
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME<>'PRIMARY'
    ORDER BY INDEX_NAME,SEQ_IN_INDEX`).all(tableName);
  const indexMap = new Map();
  for (const row of indexRows) {
    if (!indexMap.has(row.index_name)) indexMap.set(row.index_name, { name: row.index_name, unique: !Boolean(row.non_unique), columns: [] });
    indexMap.get(row.index_name).columns.push(row.column_name);
  }
  // §37.48 — the live catalogue rendering is read in the catalogue dialect.
  // The dialect follows the provenance of this read, not the shape of the text:
  // a MySQL catalogue CHECK clause is never decoded as a SQLite DDL source and
  // the other way round.
  const checks = db.prepare(`SELECT cc.CHECK_CLAUSE check_clause FROM information_schema.CHECK_CONSTRAINTS cc
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'
    ORDER BY cc.CHECK_CLAUSE`).all(tableName)
    .map((row) => normalizeCheckClause(row.check_clause, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }))
    // §37.50 — the catalogue's raw order is a function of the server's
    // rendering, not of the schema, so the canonical forms are sorted after
    // the normalization and not before it. The raw text is still read by the
    // query above, and the raw order is still what the acceptance evidence
    // records; only the compared shape is canonical.
    .sort();
  return Object.freeze({
    name: tableName, columns, foreignKeys,
    indexes: [...indexMap.values()].map((index) => Object.freeze(index)).sort((a, b) => a.name.localeCompare(b.name)),
    checks: Object.freeze(checks),
  });
}

export function compareWave9SourceTarget(snapshot, db) {
  const source = new Map(snapshot.tables.filter((table) => SALES_WAVE9_TABLES.includes(table.name))
    .map((table) => [table.name, normalizedSqliteTable(table)]));
  assert.deepEqual([...source.keys()].sort(), [...SALES_WAVE9_TABLES].sort());
  for (const tableName of SALES_WAVE9_TABLES) {
    const expected = source.get(tableName);
    const actual = readNormalizedMySqlTable(db, tableName);
    assert.deepEqual(actual.columns, expected.columns, `${tableName}: complete column parity`);
    assert.deepEqual(actual.foreignKeys, expected.foreignKeys, `${tableName}: foreign-key parity`);
    assertCheckParity(expected.checks, actual.checks, tableName);
    assertIndexParity(expected, actual, `${tableName}: index parity`);
  }
}

// A MySQL index whose name is generated by the server is named after its first
// column, with a numeric suffix on collision. The rule is used only to
// recognise a server-created foreign-key support index; it never excuses a
// renamed declared index.
export function isBackendGeneratedIndexName(name, columns) {
  if (!Array.isArray(columns) || !columns.length) return false;
  const first = String(columns[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${first}(_\\d+)?$`, 'i').test(String(name));
}

function sameColumns(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((column, position) => String(column) === String(right[position]));
}

// The approved Wave 10 table-level UNIQUE constraints have a fixed identity in
// the canonical migration. SQLite stores a table-level UNIQUE constraint on an
// auto-index that carries no portable name, and MySQL names an unnamed UNIQUE
// key after its first column, so for these two the approved contract is the
// constraint identity plus the ordered unique column set. Every other index
// keeps its name.
export function approvedUniqueConstraint(tableName, columns) {
  return UNIQUE_CONSTRAINTS.find((constraint) => constraint.table === tableName
    && sameColumns(constraint.columns, columns)) || null;
}

// A foreign key's supporting index is created by the database server, not by
// the schema contract: MySQL names it after the child column and creates it
// only when no other index already covers the foreign key. Its presence is
// therefore derived from the foreign-key set — which is compared separately —
// and not from the declared index set.
//
// Only a provably redundant, non-unique, single-column foreign-key support
// index may be ignored. A UNIQUE index is never ignored, and an index that
// carries additional business semantics keeps its name contract.
function isRedundantForeignKeySupportIndex(table, index) {
  if (index.unique) return false;
  if (!Array.isArray(index.columns) || index.columns.length !== 1) return false;
  const column = String(index.columns[0]).toLowerCase();
  const supportsForeignKey = (table.foreignKeys || [])
    .some((foreignKey) => String(foreignKey.column).toLowerCase() === column);
  if (!supportsForeignKey) return false;
  return isBackendGeneratedIndexName(index.name, index.columns);
}

function comparableIndexes(table, indexes) {
  return indexes.filter((index) => !isRedundantForeignKeySupportIndex(table, index));
}

function indexShape(index) {
  return `${index.unique ? 'unique' : 'index'}:${index.columns.join(',')}`;
}

// The approved table-level UNIQUE constraint may present either its canonical
// migration-declared name or a name the backend legitimately generates for it.
// That second case is the only legitimate cross-dialect name difference:
// SQLite stores the constraint on a nameless auto-index, and MySQL names an
// unnamed UNIQUE key after its first column. An arbitrary alias is neither, so
// it is rejected.
function isApprovedUniqueRepresentation(constraint, index) {
  return index.name === constraint.name
    || isBackendGeneratedIndexName(index.name, index.columns);
}

// The index contract. Every index shape must exist on both sides with the
// same uniqueness and the same ordered column set, and every declared index
// must keep its name. The single exception is an approved Wave 10 table-level
// UNIQUE constraint, whose identity is the approved constraint name and whose
// two legitimate cross-dialect representations are the canonical name and a
// backend-generated one; each side is validated against that rule. A missing
// index, a different column order, a different uniqueness, a duplicated
// index, an extra index or a renamed declared index all fail here.
export function assertIndexParity(expected, actual, label) {
  const expectedIndexes = comparableIndexes(expected, expected.indexes);
  const actualIndexes = comparableIndexes(actual, actual.indexes);
  assert.deepEqual(actualIndexes.map(indexShape).sort(), expectedIndexes.map(indexShape).sort(),
    `${label}: index shape parity`);
  const actualByShape = new Map();
  for (const index of actualIndexes) {
    const key = indexShape(index);
    if (!actualByShape.has(key)) actualByShape.set(key, []);
    actualByShape.get(key).push(index);
  }
  for (const index of expectedIndexes) {
    const candidates = actualByShape.get(indexShape(index));
    assert.ok(candidates && candidates.length, `${label}: index ${index.name} is missing`);
    const match = candidates.shift();
    // A declared index keeps its name. Only an approved table-level UNIQUE
    // constraint may carry a backend-generated name, and the fact that an
    // actual name happens to equal its first column never excuses a rename.
    const constraint = index.unique ? approvedUniqueConstraint(expected.name, index.columns) : null;
    if (constraint) {
      // Both sides are validated, because the comparison may run between two
      // MySQL materialization paths rather than between SQLite and MySQL.
      assert.ok(isApprovedUniqueRepresentation(constraint, index),
        `${label}: the approved UNIQUE constraint ${constraint.name} must keep its canonical name or a backend-generated name (expected: ${index.name})`);
      assert.ok(isApprovedUniqueRepresentation(constraint, match),
        `${label}: the approved UNIQUE constraint ${constraint.name} must keep its canonical name or a backend-generated name (actual: ${match.name})`);
    } else {
      assert.equal(match.name, index.name,
        `${label}: explicitly named index ${index.name} must keep its name (actual: ${match.name})`);
    }
  }
}

// The fresh bootstrap and the formal upgrade must materialize the same
// physical schema for the same logical table. Every column, foreign key and
// check constraint is compared strictly; the index comparison follows the
// approved cross-backend contract above.
export function assertEquivalentCreditMetadata(actual, expected, label = 'credit metadata') {
  assert.deepEqual([...Object.keys(actual)].sort(), [...Object.keys(expected)].sort(), `${label}: table set`);
  for (const tableName of Object.keys(expected)) {
    const actualTable = actual[tableName];
    const expectedTable = expected[tableName];
    assert.equal(actualTable.name, expectedTable.name, `${label}.${tableName}: table identity`);
    assert.deepEqual(actualTable.columns, expectedTable.columns, `${label}.${tableName}: complete column parity`);
    assert.deepEqual(actualTable.foreignKeys, expectedTable.foreignKeys, `${label}.${tableName}: foreign-key parity`);
    assertCheckParity(expectedTable.checks, actualTable.checks, `${label}.${tableName}`);
    assertIndexParity(expectedTable, actualTable, `${label}.${tableName}: index parity`);
  }
}

export function normalizedCreditMetadata(db) {
  return Object.fromEntries([...SALES_WAVE9_TABLES, ...SALES_WAVE10_TABLES].sort()
    .map((tableName) => [tableName, readNormalizedMySqlTable(db, tableName)]));
}

export function rowsById(db, tableName) {
  assert.match(tableName, /^[A-Za-z0-9_]+$/);
  return db.prepare(`SELECT * FROM ${quote(tableName)} ORDER BY id`).all().map((row) => ({ ...row }));
}
