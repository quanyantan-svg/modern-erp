// M1C-WP0-R1 — WP-0 schema dual-engine contract member sets (M-01..M-07).
//
// Contract source: M1-Core Active Design §4.1 (M-01..M-07) and §11
// (SQLite / MySQL 8 相容性: 两端语义对等 + parity 断言), plus MC-REQ-12
// (零历史回填, 历史事实 NULL = 未证明).
//
// The assertion runs entirely offline. It drives the production SQLite→MySQL
// DDL translation (server/database/mysql-schema.js) with a recording mock
// adapter, so the MySQL side is the DDL the system would really emit — not a
// re-implementation of the translator inside the test.
//
// It does NOT connect to MySQL, does NOT execute a MySQL migration and does
// NOT claim a dynamic SQLite/MySQL parity Gate PASS. Runtime acceptance of the
// emitted DDL by a real MySQL 8 server stays NOT_RUN.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDatabase } from './db.js';
import {
  bootstrapMySql,
  captureSqliteSnapshot,
  mysqlTypeFamily,
  planMySqlAdditiveReconciliation,
  planMySqlIndexReconciliation,
} from './database/mysql-schema.js';

const WP0_NEW_TABLES = [
  'receipt_notice_item_sources',
  'schedule_consumption_effects',
  'outsourcing_wip_identity_effects',
  'outsourcing_wip_identity_effect_allocations',
  'outsourcing_wip_identity_balances',
];

const WP0_NEW_COLUMNS = {
  purchase_receipts: ['source_notice_id'],
  purchase_receipt_items: ['source_notice_item_source_id', 'delivery_schedule_id'],
  outsourcing_receipts: ['warehouse_id', 'source_notice_id', 'business_date', 'version'],
  outsourcing_receipt_items: [
    'delivery_schedule_id', 'lot_id', 'serial_id', 'unit_code',
    'processing_po_item_id', 'source_notice_item_source_id',
  ],
  outsourcing_material_list: ['source_warehouse_id', 'legacy_unverified_wip_quantity', 'identity_evidence_state'],
};

const WP0_NEW_INDEXES = [
  'idx_receipt_notice_item_sources_notice',
  'idx_receipt_notice_item_sources_capacity',
  'idx_schedule_consumption_effects_capacity',
  'idx_schedule_consumption_effects_reversal',
  'idx_outsourcing_wip_identity_effects_balance',
  'idx_outsourcing_wip_allocations_source',
];

// SQLite declared type → the MySQL type families that may carry the same
// semantics. The exact families are produced by the production resolver
// (mysqlTypeFamily); this table only proves the family is semantically
// compatible with the SQLite declaration instead of merely "some string type".
const ALLOWED_FAMILIES = {
  TEXT: new Set(['varchar', 'longtext', 'json', 'char']),
  INTEGER: new Set(['bigint', 'tinyint']),
  REAL: new Set(['decimal']),
};

describe('M1C-WP0-R1 — WP-0 schema dual-engine contract member sets', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const emitted = captureMySqlDdl(snapshot);
  const snapshotTables = new Map(snapshot.tables.map((table) => [table.name, table]));

  test('R1-D 快照包含 M-01..M-07 的五张新表且历史行数为零', () => {
    for (const table of WP0_NEW_TABLES) {
      const entry = snapshotTables.get(table);
      assert.ok(entry, `快照缺少新表 ${table}`);
      assert.equal(entry.rows.length, 0, `${table} 必须是零历史回填的新表`);
    }
  });

  test('R1-D M-15 current schema 已纳入 identity_key 与委外部分唯一索引', () => {
    const table = snapshotTables.get('tracked_inventory_movements');
    assert.ok(table);
    const names = table.columns.map((column) => column.name);
    assert.equal(names.includes('identity_key'), true, 'M-15 离线 Implementation 已进入 current schema');
    assert.ok(table.indexes.some((index) => index.name === 'uq_tracked_outsourcing_identity' && index.unique),
      'current schema 必须具备委外身份部分唯一索引；历史库仍需单独 Migration 授权');
  });

  for (const tableName of WP0_NEW_TABLES) {
    test(`R1-D ${tableName} 两端列集合、类型族、NULL/default 合同一致`, () => {
      const sqlite = snapshotTables.get(tableName);
      const mysql = parseMySqlCreateTable(emitted.createTables.get(tableName));
      assert.ok(mysql, `MySQL DDL 缺少 ${tableName}`);

      assert.deepEqual(
        [...mysql.columns.keys()].sort(),
        sqlite.columns.map((column) => column.name).sort(),
        `${tableName} 两端列集合必须一致`,
      );

      const indexedColumns = new Set([
        ...sqlite.indexes.flatMap((index) => index.columns),
        ...sqlite.foreignKeys.map((foreignKey) => foreignKey.from),
      ]);
      const singleColumnPrimaryKey = sqlite.columns.filter((column) => column.pk).length === 1;
      for (const column of sqlite.columns) {
        const mysqlColumn = mysql.columns.get(column.name);
        const declared = String(column.type || '').toUpperCase();
        const familyKey = declared.includes('INT') ? 'INTEGER'
          : declared.includes('REAL') || declared.includes('FLOA') || declared.includes('DOUB') || declared.includes('NUM') ? 'REAL'
            : 'TEXT';
        assert.ok(
          ALLOWED_FAMILIES[familyKey].has(mysqlColumn.family),
          `${tableName}.${column.name} 的 MySQL 类型族 ${mysqlColumn.family} 与 SQLite ${declared} 语义不兼容`,
        );
        assert.equal(
          mysqlColumn.family,
          mysqlTypeFamily(column, indexedColumns.has(column.name), tableName),
          `${tableName}.${column.name} 的实际 MySQL 类型族必须等于生产类型解析器的判定`,
        );
        if (column.notnull) {
          assert.equal(mysqlColumn.notNull, true, `${tableName}.${column.name} 的 NOT NULL 不得在 MySQL 侧丢失`);
        } else if (!(singleColumnPrimaryKey && column.pk)) {
          assert.equal(mysqlColumn.notNull, false, `${tableName}.${column.name} 不得在 MySQL 侧被收紧为 NOT NULL`);
        }
        assert.equal(
          normalizeDefault(mysqlColumn.default),
          normalizeDefault(column.dflt_value),
          `${tableName}.${column.name} 的 DEFAULT 合同两端必须一致`,
        );
      }
    });

    test(`R1-D ${tableName} 两端 PRIMARY KEY / UNIQUE / 索引 / FOREIGN KEY / CHECK 成员集合一致`, () => {
      const sqlite = snapshotTables.get(tableName);
      const mysql = parseMySqlCreateTable(emitted.createTables.get(tableName));

      const sqlitePrimaryKey = sqlite.columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      assert.deepEqual(mysql.primaryKey, sqlitePrimaryKey, `${tableName} 两端主键列序列必须一致`);

      const sqliteUnique = sqlite.indexes
        .filter((index) => index.origin === 'u' && index.unique)
        .map((index) => index.columns.join(','))
        .sort();
      const mysqlUnique = mysql.uniques.map((columns) => columns.join(',')).sort();
      assert.deepEqual(mysqlUnique, sqliteUnique, `${tableName} 两端 UNIQUE 成员集合必须一致`);
      for (const index of sqlite.indexes.filter((candidate) => candidate.origin === 'u')) {
        assert.ok(index.columns.length <= 4, `${tableName}.${index.name} 的 UNIQUE 列数超出 MySQL 内联 UNIQUE 上限`);
      }

      const sqliteIndexes = sqlite.indexes
        .filter((index) => index.origin !== 'u' && index.origin !== 'pk' && index.columns.length)
        .map((index) => `${index.name}:${index.columns.join(',')}`)
        .sort();
      const mysqlIndexes = (emitted.indexes.get(tableName) || [])
        .map((index) => `${index.name}:${index.columns.join(',')}`)
        .sort();
      assert.deepEqual(mysqlIndexes, sqliteIndexes, `${tableName} 两端普通索引成员集合必须一致`);

      const sqliteForeignKeys = sqlite.foreignKeys
        .map((foreignKey) => `${foreignKey.from}->${foreignKey.table}.${foreignKey.to}`)
        .sort();
      const mysqlForeignKeys = mysql.foreignKeys
        .map((foreignKey) => `${foreignKey.from}->${foreignKey.table}.${foreignKey.to}`)
        .sort();
      assert.deepEqual(mysqlForeignKeys, sqliteForeignKeys, `${tableName} 两端外键成员集合必须一致`);
      for (const foreignKey of sqlite.foreignKeys) {
        assert.ok(
          snapshotTables.has(foreignKey.table),
          `${tableName} 的外键目标表 ${foreignKey.table} 在快照中不存在：SQLite 允许建表，MySQL 会直接拒绝`,
        );
      }

      const sqliteChecks = extractCheckBodies(sqlite.sql).map(normalizeWhitespace).sort();
      const mysqlChecks = mysql.checks.map(normalizeWhitespace).sort();
      assert.deepEqual(mysqlChecks, sqliteChecks, `${tableName} 两端 CHECK 成员集合必须一致`);
    });
  }

  test('R1-D additive 迁移路径对既有 MySQL 库只产生五张新表与十六个新列', () => {
    const preWp0Tables = new Set([...snapshotTables.keys()].filter((name) => !WP0_NEW_TABLES.includes(name)));
    const preWp0Columns = new Map();
    for (const [name, table] of snapshotTables) {
      const added = WP0_NEW_COLUMNS[name] || [];
      preWp0Columns.set(name, new Set(table.columns.map((column) => column.name).filter((column) => !added.includes(column))));
    }
    const statements = planMySqlAdditiveReconciliation(snapshot, { tables: preWp0Tables, columns: preWp0Columns });

    const createdTables = statements.filter((statement) => statement.startsWith('CREATE TABLE')).map((statement) => statement.match(/`([^`]+)`/)[1]);
    assert.deepEqual(createdTables.sort(), [...WP0_NEW_TABLES].sort(), 'additive 路径必须只新建 M-01..M-07 的五张表');

    const addedColumns = statements
      .filter((statement) => statement.startsWith('ALTER TABLE'))
      .map((statement) => {
        const match = statement.match(/^ALTER TABLE `([^`]+)` ADD COLUMN `([^`]+)`/);
        return `${match[1]}.${match[2]}`;
      });
    const expectedColumns = Object.entries(WP0_NEW_COLUMNS).flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`));
    assert.deepEqual(addedColumns.sort(), expectedColumns.sort(), 'additive 路径必须只新增 WP-0 声明的十六个列');
    assert.equal(statements.length, WP0_NEW_TABLES.length + expectedColumns.length, 'additive 路径不得产生其他语句');
  });

  test('R1-D additive 索引路径只补建 WP-0 的六个新索引', () => {
    const preWp0Indexes = new Map();
    for (const [name, table] of snapshotTables) {
      preWp0Indexes.set(name, new Set(table.indexes.map((index) => index.name).filter((index) => !WP0_NEW_INDEXES.includes(index))));
    }
    const statements = planMySqlIndexReconciliation(snapshot, preWp0Indexes);
    const names = statements.map((statement) => statement.match(/INDEX `([^`]+)`/)[1]);
    assert.deepEqual(names.sort(), [...WP0_NEW_INDEXES].sort(), '索引补建路径必须只补建 WP-0 的六个新索引');
  });
});

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
  return text;
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      current += character;
      if (character === quote) {
        if (body[index + 1] === quote) { current += body[index + 1]; index += 1; continue; }
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; current += character; continue; }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseColumnList(definition) {
  const match = definition.match(/\(([^)]*)\)/);
  if (!match) return [];
  return match[1].split(',').map((column) => column.trim().replace(/^`|`$/g, '').trim());
}

function parseMySqlCreateTable(statement) {
  const result = { columns: new Map(), primaryKey: [], uniques: [], foreignKeys: [], checks: [] };
  if (!statement) return result;
  const open = statement.indexOf('(');
  const close = statement.lastIndexOf(')');
  for (const part of splitTopLevel(statement.slice(open + 1, close))) {
    if (/^PRIMARY KEY/i.test(part)) { result.primaryKey = parseColumnList(part); continue; }
    if (/^UNIQUE/i.test(part)) { result.uniques.push(parseColumnList(part)); continue; }
    if (/^FOREIGN KEY/i.test(part)) {
      const match = part.match(/^FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s+`([^`]+)`\s*\(([^)]*)\)/i);
      if (match) {
        result.foreignKeys.push({
          from: match[1].trim().replace(/^`|`$/g, ''),
          table: match[2],
          to: match[3].trim().replace(/^`|`$/g, ''),
        });
      }
      continue;
    }
    if (/^CHECK/i.test(part)) {
      result.checks.push(part.slice(part.indexOf('(') + 1, part.lastIndexOf(')')).trim());
      continue;
    }
    const match = part.match(/^`([^`]+)`\s+([A-Za-z]+(?:\([^)]*\))?)([\s\S]*)$/);
    if (!match) continue;
    const rest = match[3] || '';
    const defaultMatch = rest.match(/\bDEFAULT\s+([\s\S]+)$/);
    result.columns.set(match[1], {
      type: match[2].toUpperCase(),
      family: match[2].split('(')[0].toLowerCase(),
      notNull: /\bNOT NULL\b/i.test(rest),
      default: defaultMatch ? defaultMatch[1].replace(/\s+AUTO_INCREMENT$/i, '').trim() : null,
    });
  }
  return result;
}

function extractCheckBodies(sql) {
  const bodies = [];
  const upper = sql.toUpperCase();
  let cursor = 0;
  while ((cursor = upper.indexOf('CHECK', cursor)) >= 0) {
    let start = cursor + 5;
    while (/\s/.test(sql[start] || '')) start += 1;
    if (sql[start] !== '(') { cursor = start; continue; }
    let depth = 0;
    let quote = '';
    for (let index = start; index < sql.length; index += 1) {
      const character = sql[index];
      if (quote) {
        if (character === quote && sql[index + 1] === quote) index += 1;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === "'" || character === '"') { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) { bodies.push(sql.slice(start + 1, index)); cursor = index; break; }
    }
    if (cursor === upper.length) break;
  }
  return bodies;
}

function captureMySqlDdl(snapshot) {
  const statements = [];
  const adapter = {
    prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }),
    exec: (sql) => { statements.push(String(sql)); },
  };
  try {
    bootstrapMySql(adapter, snapshot);
  } catch {
    // bootstrapMySql stops at the information_schema assertions; every DDL
    // statement it would emit is already captured by then.
  }
  const createTables = new Map();
  const indexes = new Map();
  for (const statement of statements) {
    if (statement.startsWith('CREATE TABLE IF NOT EXISTS')) {
      const match = statement.match(/^CREATE TABLE IF NOT EXISTS `([^`]+)`/);
      if (match) createTables.set(match[1], statement);
      continue;
    }
    const indexMatch = statement.match(/^CREATE (?:UNIQUE )?INDEX `([^`]+)` ON `([^`]+)` \(([^)]*)\)/);
    if (indexMatch) {
      const columns = indexMatch[3].split(',').map((column) => column.trim().replace(/^`|`$/g, '').replace(/\(\d+\)$/, ''));
      const list = indexes.get(indexMatch[2]) || [];
      list.push({ name: indexMatch[1], columns });
      indexes.set(indexMatch[2], list);
    }
  }
  return { statements, createTables, indexes };
}
