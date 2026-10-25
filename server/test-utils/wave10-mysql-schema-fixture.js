import assert from 'node:assert/strict';
import { SALES_WAVE9_TABLES } from '../migrations/sales-customer-wave9-credit-foundation.js';
import { SALES_WAVE10_TABLES } from '../migrations/sales-customer-wave10-credit-check.js';

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

export function createWave9BoundedSnapshot(snapshot) {
  const wave10 = new Set(SALES_WAVE10_TABLES);
  const tables = snapshot.tables.filter((table) => !wave10.has(table.name));
  const names = new Set(tables.map((table) => table.name));
  for (const name of SALES_WAVE9_TABLES) assert.ok(names.has(name), `Wave 9 snapshot missing ${name}`);
  for (const name of SALES_WAVE10_TABLES) assert.equal(names.has(name), false, `Wave 9 snapshot contains ${name}`);
  return Object.freeze({ tables });
}

function indexedColumns(table) {
  return new Set(table.indexes.flatMap((index) => index.columns).filter(Boolean));
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

// §37.39.8.2 — the normalized CHECK clause. MySQL adds backticks and charset
// introducers to a clause that SQLite carries verbatim, so those are removed
// before the two sides are compared.
export function normalizeCheckClause(value) {
  return String(value || '')
    .replace(/`/g, '')
    .replace(/_utf8mb4|_utf8|_binary/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractCheckClauses(ddl) {
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
  return checks.map(normalizeCheckClause).sort();
}

export function sqliteColumnToMySqlFamily(column, indexed = false) {
  const declared = String(column.type || '').toUpperCase();
  const name = String(column.name).toLowerCase();
  if (declared.includes('INT')) return 'bigint';
  if (/REAL|FLOA|DOUB|NUM/.test(declared)) return 'decimal';
  if (declared.includes('BLOB')) return 'longblob';
  if (name.endsWith('_json') || name === 'json_payload') return 'json';
  if (name === 'anchor_key' || indexed || column.pk || name === 'id' || name.endsWith('_id')) return 'varchar';
  return 'longtext';
}

export function normalizedSqliteTable(table) {
  const indexed = indexedColumns(table);
  return Object.freeze({
    name: table.name,
    columns: table.columns.map((column) => Object.freeze({
      name: column.name,
      type: sqliteColumnToMySqlFamily(column, indexed.has(column.name)),
      nullable: !Boolean(column.notnull) && !Boolean(column.pk),
      default: normalizeDefault(column.dflt_value),
      primaryOrdinal: Number(column.pk || 0),
    })),
    foreignKeys: table.foreignKeys.map((fk) => Object.freeze({
      column: fk.from, parentTable: fk.table, parentColumn: fk.to,
      onUpdate: normalizeReferentialAction(fk.on_update),
      onDelete: normalizeReferentialAction(fk.on_delete),
    })).sort((a, b) => `${a.column}:${a.parentTable}`.localeCompare(`${b.column}:${b.parentTable}`)),
    indexes: table.indexes.filter((index) => !index.name.startsWith('sqlite_autoindex_') && index.columns.length && index.columns.every(Boolean))
      .map((index) => Object.freeze({ name: index.name, unique: Boolean(index.unique), columns: [...index.columns] }))
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
  const checks = db.prepare(`SELECT cc.CHECK_CLAUSE check_clause FROM information_schema.CHECK_CONSTRAINTS cc
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'
    ORDER BY cc.CHECK_CLAUSE`).all(tableName).map((row) => normalizeCheckClause(row.check_clause));
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
    assert.deepEqual(actual.checks, expected.checks, `${tableName}: check-constraint parity`);
    const actualByName = new Map(actual.indexes.map((index) => [index.name, index]));
    for (const index of expected.indexes) assert.deepEqual(actualByName.get(index.name), index, `${tableName}.${index.name}: index parity`);
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
