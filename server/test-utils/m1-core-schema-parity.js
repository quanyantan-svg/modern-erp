import {
  generatedPartialIndex,
  mysqlGeneratedPartialIndexColumnName,
  mysqlTypeFamily,
} from '../database/mysql-schema.js';

export const M1_CORE_PARITY_TABLES = Object.freeze([
  'receipt_notice_item_sources', 'schedule_consumption_effects',
  'outsourcing_orders', 'outsourcing_material_list', 'outsourcing_receipts', 'outsourcing_receipt_items',
  'outsourcing_wip_identity_effects', 'outsourcing_wip_identity_effect_allocations', 'outsourcing_wip_identity_balances',
  'tracked_inventory_movements', 'inventory_transactions', 'inventory_valuation_movements',
  'purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items',
]);

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

function unquoteSqlString(value) {
  const text = String(value);
  if (text.length < 2 || !["'", '"'].includes(text[0]) || text.at(-1) !== text[0]) return null;
  const quote = text[0];
  return text.slice(1, -1).replaceAll(quote + quote, quote);
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

function normalizedDefault(value, column) {
  if (value === null || value === undefined) return null;
  let text = unwrapOuterParentheses(value).replace(/^_[a-z0-9]+\s*(?=['"])/i, '');
  if (/^null$/i.test(text)) return null;
  if (/^current_timestamp(?:\(\))?$/i.test(text)) return 'KEYWORD:CURRENT_TIMESTAMP';
  if (/^current_date(?:\(\))?$/i.test(text)) return 'KEYWORD:CURRENT_DATE';
  const unquoted = unquoteSqlString(text);
  const declared = String(column?.type || '').toUpperCase();
  const numeric = declared.includes('INT') || declared.includes('REAL') || declared.includes('FLOA')
    || declared.includes('DOUB') || declared.includes('NUM');
  if (numeric) {
    const normalized = normalizedNumericDefault(unquoted ?? text);
    return normalized === null ? `EXPR:${text}` : `NUMBER:${normalized}`;
  }
  return `STRING:${unquoted ?? text}`;
}

function sqlExpressionTokens(value, { normalizeGeneratedCastCharset = false } = {}) {
  const text = unwrapOuterParentheses(value);
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const charsetIntroducer = rest.match(/^_(?:utf8mb4|utf8|binary)\s*(?=')/i);
    if (charsetIntroducer) { index += charsetIntroducer[0].length; continue; }
    if (text[index] === "'") {
      let content = '';
      let closed = false;
      index += 1;
      while (index < text.length) {
        if (text[index] === "'" && text[index + 1] === "'") { content += "'"; index += 2; continue; }
        if (text[index] === "'") { index += 1; closed = true; break; }
        content += text[index]; index += 1;
      }
      tokens.push(closed ? `STRING:${JSON.stringify(content)}` : `UNTERMINATED_STRING:${JSON.stringify(content)}`);
      continue;
    }
    if (text[index] === '`' || text[index] === '"') {
      const quote = text[index];
      let identifier = '';
      index += 1;
      while (index < text.length && text[index] !== quote) { identifier += text[index]; index += 1; }
      if (text[index] === quote) index += 1;
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
  return tokens.join('|');
}

function generatedExpression(tableName, index) {
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


function requiresGeneratedDigest(index) {
  return Boolean(index.where)
    || index.columns.length > 4
    || index.columns.some((column) => typeof column !== 'string' || !column)
    || (index.expressions || []).some((expression, position) => expression && expression !== index.columns[position]);
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
  const generatedIndexes = sqliteTable.indexes.filter(requiresGeneratedDigest);
  const expectedGeneratedColumns = new Set(generatedIndexes.map((index) => mysqlGeneratedPartialIndexColumnName(index.name)));
  const physicalColumns = new Map(mysqlContract.columns.map((column) => [column.column_name, column]));
  for (const index of generatedIndexes) {
    const columnName = mysqlGeneratedPartialIndexColumnName(index.name);
    const actual = physicalColumns.get(columnName);
    if (!actual) { errors.push(`GENERATED_COLUMN_MISSING:${columnName}`); continue; }
    if (String(actual.extra || '').trim().toUpperCase() !== 'STORED GENERATED') {
      errors.push(`GENERATED_COLUMN_KIND:${columnName}`);
    }
    const expectedExpression = sqlExpressionTokens(generatedExpression(sqliteTable.name, index), { normalizeGeneratedCastCharset: true });
    const actualExpression = sqlExpressionTokens(actual.generation_expression, { normalizeGeneratedCastCharset: true });
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
    if (normalizedDefault(actual.column_default, column) !== normalizedDefault(column.dflt_value, column)) errors.push(`DEFAULT:${column.name}`);
  }

  const groupedIndexes = new Map();
  for (const row of mysqlContract.indexes) {
    const entry = groupedIndexes.get(row.index_name) || { unique: Number(row.non_unique) === 0, columns: [] };
    entry.columns.push(row.column_name); groupedIndexes.set(row.index_name, entry);
  }
  for (const index of sqliteTable.indexes.filter((item) => item.origin !== 'pk' && item.columns.length)) {
    const generated = requiresGeneratedDigest(index);
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
  const expectedChecks = extractSqliteChecks(sqliteTable.sql).map((check) => sqlExpressionTokens(check)).sort();
  const actualChecks = mysqlContract.checks.map((row) => sqlExpressionTokens(row.check_clause)).sort();
  if (JSON.stringify(actualChecks) !== JSON.stringify(expectedChecks)) errors.push('CHECKS');
  return Object.freeze(errors);
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
  if (failures.length) throw new Error(`M1_SCHEMA_PARITY_MISMATCH\n${failures.join('\n')}`);
  return Object.freeze({ tables: Object.freeze([...tableNames]), source: 'information_schema', status: 'MATCHED' });
}
