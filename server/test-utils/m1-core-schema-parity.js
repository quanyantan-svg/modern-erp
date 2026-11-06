import {
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

function normalizedExpression(value) {
  return String(value || '')
    .replace(/_[a-z0-9]+\s*(?=['"])/gi, '')
    .replace(/[`"\s()]/g, '')
    .toLowerCase();
}


function requiresGeneratedDigest(index) {
  return Boolean(index.where)
    || index.columns.length > 4
    || index.columns.some((column) => typeof column !== 'string' || !column)
    || (index.expressions || []).some((expression, position) => expression && expression !== index.columns[position]);
}

export function readMySqlInformationSchemaContract(db, tableName) {
  const columns = db.prepare(`SELECT COLUMN_NAME column_name,DATA_TYPE data_type,IS_NULLABLE is_nullable,
      COLUMN_DEFAULT column_default,ORDINAL_POSITION ordinal_position,COLUMN_KEY column_key
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
  const checks = db.prepare(`SELECT cc.CHECK_CLAUSE check_clause
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
  const expectedGeneratedColumns = new Set(sqliteTable.indexes.filter(requiresGeneratedDigest)
    .map((index) => mysqlGeneratedPartialIndexColumnName(index.name)));
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

  const expectedChecks = extractSqliteChecks(sqliteTable.sql).map(normalizedExpression).sort();
  const actualChecks = mysqlContract.checks.map((row) => normalizedExpression(row.check_clause)).sort();
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
