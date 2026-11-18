// VMI 结算机制 —— MySQL 物理类型契约守卫。
//
// 为什么需要这个文件：V28 迁移自带一份**手写** canonical MySQL DDL，而全新 MySQL
// bootstrap 走的是「SQLite 快照 → 启发式推导」路径（`bootstrapMySql` →
// `tableDefinition` → `mysqlType()`）。同一条事实的两份手工副本必然漂移，而且
// 漂移在 SQLite 上**完全不可见** —— 只有在真实 MySQL 服务器上，它才表现为
// 「全新装的库」与「升级上去的库」列类型不一致。
//
// 本守卫**完全离线**证明（不需要 MySQL 服务器）：
//   1. pinned 类型表 == 快照 bootstrap 实际物化的类型；
//   2. 手写 MySQL DDL 的每一列 == pinned 类型表；
//   3. 被索引的文本列不得声明为 LONGTEXT（InnoDB 拒绝索引 LONGTEXT）；
//   4. pinned 表已登记进 canonical 类型解析器，否则快照路径会静默回落到
//      通用启发式，两条路径再次漂移。
//
// Requirement : docs/requirements/procurement-outsourcing.md §31.24
//                （`VMI-SET-11` / `VMI-SET-17`：canonical 通道 + 纯加性双端）
// Design      : docs/design/procurement-outsourcing.md §26.45.2

import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDatabase } from './db.js';
import { resolveMySqlColumnType } from './database/mysql-schema.js';
import { migrateV28VmiSettlement, VMI_SETTLEMENT_MYSQL_COLUMN_TYPES } from './migrations/v28-vmi-settlement.js';

const MIGRATION_FILE = './migrations/v28-vmi-settlement.js';

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

/**
 * 读出 canonical SQLite 表的形状：列定义 + 参与键的列集合。
 *
 * 「参与键」的口径与 `mysqlType()` 内部一致：显式索引列 + 外键列。
 */
function readTableShape(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all();
  const indexes = db.prepare(`PRAGMA index_list(${quote(table)})`).all()
    .filter((index) => index.origin !== 'pk')
    .map((index) => db.prepare(`PRAGMA index_info(${quote(index.name)})`).all()
      .sort((left, right) => left.seqno - right.seqno).map((row) => row.name));
  const indexed = new Set([
    ...indexes.flat(),
    ...foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
  return { columns, indexed };
}

/**
 * 手写 MySQL DDL 里 `CREATE TABLE IF NOT EXISTS <table> (` 的最后一个块。
 *
 * 迁移先写 SQLite DDL、后写手写 MySQL DDL，因此取最后一次出现。
 */
function mysqlCreateBlock(source, table) {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return null;
  const match = source.slice(start).match(/\(([\s\S]*?)\)\s*ENGINE=InnoDB/);
  return match ? match[1] : null;
}

function withFreshDatabase(prefix, work) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  let db;
  try {
    db = createDatabase(join(dir, 'parity.db'));
    work(db);
  } finally {
    try { db?.close(); } catch { /* the fixture may already be closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('VMI 结算 MySQL 类型契约：pinned 类型表 == 快照 bootstrap 实际物化的类型', () => {
  withFreshDatabase('modern-erp-vmi-mysql-types-', (db) => {
    for (const [table, map] of Object.entries(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      const shape = readTableShape(db, table);
      assert.ok(shape.columns.length > 0, `${table} 必须存在于 canonical SQLite schema`);
      for (const column of shape.columns) {
        // 快照 bootstrap 走的就是 canonical 解析器；对 pinned 表，解析器返回
        // pinned 类型。因此「快照物化的类型」== pinned 类型。
        const snapshotType = resolveMySqlColumnType(column, shape.indexed.has(column.name), table);
        assert.equal(
          snapshotType,
          map[column.name],
          `${table}.${column.name}: pinned 类型必须等于快照 bootstrap 物化的类型`,
        );
        if (shape.indexed.has(column.name)) {
          assert.doesNotMatch(
            String(map[column.name]),
            /^LONGTEXT$/i,
            `${table}.${column.name}: 被索引的文本列在 InnoDB 下不得是 LONGTEXT`,
          );
        }
      }
    }
  });
});

test('VMI 结算 MySQL 类型契约：索引列的文本类型不得退化为 LONGTEXT', () => {
  // InnoDB 拒绝在没有前缀长度的情况下索引 LONGTEXT 列。通用启发式对本迁移的
  // 索引文本列（`period_key` / `status` / `window_start` / `window_end` /
  // `idempotency_key`）会给出 LONGTEXT —— 真实 MySQL 会直接拒绝建表。
  // 因此 pinned 类型必须把这些列固定为 VARCHAR(128)。
  withFreshDatabase('modern-erp-vmi-mysql-indexed-', (db) => {
    for (const [table, map] of Object.entries(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      const shape = readTableShape(db, table);
      for (const column of shape.columns) {
        if (!shape.indexed.has(column.name)) continue;
        assert.doesNotMatch(
          String(map[column.name]),
          /^LONGTEXT$/i,
          `${table}.${column.name}: 被索引的文本列必须固定为 VARCHAR(128)，否则真实 MySQL 拒绝建表`,
        );
      }
    }
  });
});

test('VMI 结算 MySQL 类型契约：手写 MySQL DDL 的每一列 == pinned 类型表', () => {
  withFreshDatabase('modern-erp-vmi-mysql-ddl-', (db) => {
    const source = readFileSync(new URL(MIGRATION_FILE, import.meta.url), 'utf8');
    for (const [table, map] of Object.entries(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      const block = mysqlCreateBlock(source, table);
      assert.ok(block, `${MIGRATION_FILE}: 必须存在 ${table} 的手写 MySQL DDL`);
      const shape = readTableShape(db, table);
      for (const column of shape.columns) {
        const literal = block.match(new RegExp(`\\b${column.name}\\s+(VARCHAR\\(\\d+\\)|LONGTEXT|BIGINT|JSON|CHAR\\(\\d+\\)|DECIMAL\\(\\d+,\\d+\\)|TEXT)`, 'i'));
        assert.ok(literal, `${MIGRATION_FILE}: ${table}.${column.name} 必须出现在 MySQL DDL 中`);
        assert.equal(
          literal[1].toUpperCase(),
          String(map[column.name]).toUpperCase(),
          `${MIGRATION_FILE}: ${table}.${column.name} 的 DDL 类型必须等于 pinned 类型`,
        );
      }
    }
  });
});

test('VMI 结算 MySQL 类型契约：pinned 表已登记进 canonical 类型解析器', () => {
  // 未登记的 pinned 表会静默回落到通用启发式，快照路径与迁移自带 DDL 再次漂移。
  withFreshDatabase('modern-erp-vmi-mysql-pin-', (db) => {
    for (const [table, map] of Object.entries(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      const shape = readTableShape(db, table);
      for (const column of shape.columns) {
        const resolved = resolveMySqlColumnType(column, shape.indexed.has(column.name), table);
        assert.equal(
          resolved,
          map[column.name],
          `${table}.${column.name}: canonical 解析器必须为 pinned 表返回 pinned 类型`,
        );
      }
    }
  });
});

test('VMI 结算迁移：纯加性、幂等，且历史协议价不得被回填', () => {
  withFreshDatabase('modern-erp-vmi-mysql-additive-', (db) => {
    // 迁移已随数据库初始化执行过；三张表与协议价列都在。
    for (const table of Object.keys(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      assert.ok(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
        `${table} 必须被迁移创建`,
      );
    }
    const priceColumn = db.prepare("PRAGMA table_info(vmi_agreements)").all()
      .find((row) => String(row.name).toLowerCase() === 'unit_price_cents');
    assert.ok(priceColumn, 'vmi_agreements 必须有协议单价列');
    assert.equal(priceColumn.notnull, 0, '协议单价列必须可空（历史协议无价是「未知」，不是 0）');
    // 历史数据不回填 0 / 不虚构值。
    const priced = db.prepare('SELECT COUNT(*) n FROM vmi_agreements WHERE unit_price_cents IS NOT NULL').get();
    assert.equal(Number(priced.n), 0, '迁移不得回填任何协议单价');

    // 幂等：重复执行不产生第二列、不产生第二个索引。
    migrateV28VmiSettlement(db);
    migrateV28VmiSettlement(db);
    const priceColumns = db.prepare("PRAGMA table_info(vmi_agreements)").all()
      .filter((row) => String(row.name).toLowerCase() === 'unit_price_cents');
    assert.equal(priceColumns.length, 1, '重复执行迁移不得产生第二个协议单价列');
    for (const [table, map] of Object.entries(VMI_SETTLEMENT_MYSQL_COLUMN_TYPES)) {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?").all(table);
      const names = indexes.map((row) => row.name);
      assert.equal(new Set(names).size, names.length, `${table}: 重复执行迁移不得产生重名索引`);
      for (const column of Object.keys(map)) {
        const columnCount = db.prepare(`PRAGMA table_info("${table}")`).all()
          .filter((row) => String(row.name).toLowerCase() === column.toLowerCase()).length;
        assert.equal(columnCount, 1, `${table}.${column}: 重复执行迁移不得产生重复列`);
      }
    }
  });
});
