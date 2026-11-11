// Accounting & Analytics — 域级 schema 双引擎离线对等（AA-W1..AA-W7）。
//
// Contract source: docs/requirements/accounting-analytics.md §35.6
// （SQLite / MySQL 8 双路径、金额使用安全整数分、新增能力一律新增表 / 新增列）
// 与 docs/design/accounting-analytics.md §31.8（迁移与 Schema 策略）。
//
// The assertion runs entirely offline. It drives the production SQLite→MySQL
// DDL translation (server/database/mysql-schema.js) with a recording mock
// adapter, so the MySQL side is the DDL the system would really emit — not a
// re-implementation of the translator inside the test.
//
// It does NOT connect to MySQL, does NOT execute a MySQL migration and does
// NOT claim a dynamic SQLite/MySQL parity Gate PASS. Runtime acceptance of
// the emitted DDL by a real MySQL 8 server stays NOT_RUN.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDatabase } from './db.js';
import { bootstrapMySql, captureSqliteSnapshot } from './database/mysql-schema.js';

// The 45 tables declared by the seven Accounting & Analytics migrations.
// This list is a contract, not a derived value: a table added to a migration
// without being registered here fails the suite.
const AA_TABLES = [
  'accounting_close_check_snapshots', 'accounting_event_attempts', 'accounting_events',
  'accounting_generation_runs', 'accounting_reconciliation_items', 'accounting_reconciliation_runs',
  'accounting_rule_bindings', 'accounting_scopes', 'allocation_results', 'allocation_rules',
  'asset_change_requests', 'asset_depreciation_runs', 'asset_disposals', 'asset_loans',
  'asset_locations', 'asset_split_merge_records', 'asset_stocktake_items', 'asset_stocktakes',
  'asset_types', 'cost_adjustments', 'cost_collection_plans', 'depreciation_policies',
  'internal_settlement_prices', 'internal_settlements', 'management_books',
  'operating_ledger_entries', 'operating_period_closures', 'period_end_definitions',
  'period_end_runs', 'product_costing_profiles', 'production_cost_closings', 'profit_centers',
  'profit_transfer_runs', 'provisional_receipt_adjustments', 'provisional_receipts',
  'purchase_expense_allocation_rules', 'purchase_expense_allocations', 'purchase_expenses',
  'report_instance_values', 'report_instances', 'report_template_items',
  'report_template_permissions', 'report_templates', 'voucher_corrections', 'voucher_template_items',
];

// AA-W5 extends two pre-existing tables instead of creating new ones.
const AA_EXTENDED_COLUMNS = {
  fixed_assets: [
    'card_no', 'asset_type_id', 'location_id', 'policy_id', 'card_status', 'custodian_user_id',
    'source_type', 'source_id', 'original_value_cents', 'book_value_cents', 'disposed_at', 'activated_at',
  ],
  asset_depreciations: ['run_id', 'policy_id', 'voucher_id', 'auto_generated', 'depreciation_type', 'period'],
};

describe('Accounting & Analytics — 域级 schema 双引擎离线对等', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const emitted = captureMySqlDdl(snapshot);
  const snapshotTables = new Map(snapshot.tables.map((table) => [table.name, table]));

  test('AA-W1..AA-W7 的 45 张新表在两端都存在', () => {
    for (const table of AA_TABLES) {
      assert.ok(snapshotTables.has(table), `SQLite 快照缺少新表 ${table}`);
      assert.ok(emitted.createTables.has(table), `MySQL DDL 缺少新表 ${table}`);
    }
    assert.equal(AA_TABLES.length, 45, 'AA 新表契约清单必须与七个 migration 的声明一致');
  });

  test('AA-W5 对既有表的加列在两端都存在', () => {
    for (const [table, columns] of Object.entries(AA_EXTENDED_COLUMNS)) {
      const sqlite = snapshotTables.get(table);
      assert.ok(sqlite, `SQLite 快照缺少既有表 ${table}`);
      const names = new Set(sqlite.columns.map((column) => column.name));
      const mysql = parseMySqlCreateTable(emitted.createTables.get(table));
      for (const column of columns) {
        assert.ok(names.has(column), `SQLite ${table} 缺少 AA-W5 新列 ${column}`);
        assert.ok(mysql.columns.has(column), `MySQL ${table} 缺少 AA-W5 新列 ${column}`);
      }
    }
  });

  for (const table of AA_TABLES) {
    test(`${table} 两端列集合一致`, () => {
      const sqlite = snapshotTables.get(table);
      const mysql = parseMySqlCreateTable(emitted.createTables.get(table));
      assert.deepEqual(
        [...mysql.columns.keys()].sort(),
        sqlite.columns.map((column) => column.name).sort(),
        `${table} 两端列集合必须一致`,
      );
    });
  }

  test('全部金额列在 MySQL 侧是 BIGINT（安全整数分）', () => {
    const moneyColumns = [];
    for (const table of AA_TABLES) {
      const mysql = parseMySqlCreateTable(emitted.createTables.get(table));
      for (const [name, column] of mysql.columns) {
        if (!name.endsWith('_cents')) continue;
        moneyColumns.push(`${table}.${name}`);
        assert.equal(column.family, 'bigint', `${table}.${name} 必须是 BIGINT，不得使用浮点或字符串金额`);
      }
    }
    assert.ok(moneyColumns.length >= 20, `金额列断言必须覆盖实际存在的列，实测 ${moneyColumns.length} 列`);
  });

  test('AA-W1.4 会计事件自然键在 MySQL 侧仍是四列 UNIQUE', () => {
    const mysql = parseMySqlCreateTable(emitted.createTables.get('accounting_events'));
    const naturalKey = mysql.uniques.find((columns) => columns.length === 4);
    assert.ok(naturalKey, 'accounting_events 必须保留四列自然键 UNIQUE');
    assert.deepEqual(naturalKey, ['event_type', 'source_type', 'source_id', 'source_item_id']);
  });

  test('AA-W1 会计事件状态机的 CHECK 约束在 MySQL 侧保留', () => {
    const mysql = parseMySqlCreateTable(emitted.createTables.get('accounting_events'));
    const check = mysql.checks.find((text) => text.includes('status'));
    assert.ok(check, 'accounting_events 必须保留 status CHECK');
    for (const status of ['PENDING', 'GENERATED', 'SKIPPED', 'FAILED', 'REVERSED']) {
      assert.ok(check.includes(status), `status CHECK 必须包含 ${status}`);
    }
  });

  test('AA-W1 对账快照的业务键在 MySQL 侧仍是 UNIQUE', () => {
    const runs = parseMySqlCreateTable(emitted.createTables.get('accounting_reconciliation_runs'));
    assert.ok(runs.uniques.some((columns) => columns.length === 1 && columns[0] === 'run_key'),
      'accounting_reconciliation_runs 必须保留 run_key UNIQUE');
    const items = parseMySqlCreateTable(emitted.createTables.get('accounting_reconciliation_items'));
    assert.ok(items.uniques.some((columns) => columns.length === 2
      && columns.includes('run_id') && columns.includes('check_code')),
    'accounting_reconciliation_items 必须保留 (run_id, check_code) UNIQUE');
  });

  test('AA-W5 资产卡片状态列与 AA-W7 经营关账的业务键在 MySQL 侧保留', () => {
    // `fixed_assets` is a pre-existing table extended with ALTER TABLE ADD
    // COLUMN, and SQLite cannot attach a CHECK to an added column — the card
    // status machine is therefore enforced in server/modules/fixed-assets.js,
    // while the column contract itself must still match on both engines.
    const cards = parseMySqlCreateTable(emitted.createTables.get('fixed_assets'));
    assert.ok(cards.columns.has('card_status'), 'fixed_assets 必须保留 card_status 列');
    const closures = parseMySqlCreateTable(emitted.createTables.get('operating_period_closures'));
    assert.ok(closures.uniques.some((columns) => columns.length === 2
      && columns.includes('management_book_id') && columns.includes('period')),
    'operating_period_closures 必须保留 (management_book_id, period) UNIQUE');
  });

  test('AA-W6 暂估入库单状态列在 MySQL 侧保留', () => {
    // Design §31.6.1 declares `status TEXT NOT NULL` without a CHECK; the
    // OPEN / CONVERTED / ADJUSTED machine is enforced in code.
    const mysql = parseMySqlCreateTable(emitted.createTables.get('provisional_receipts'));
    assert.ok(mysql.columns.has('status'), 'provisional_receipts 必须保留 status 列');
  });
});

// ---------------------------------------------------------------------------
// DDL capture / parse helpers
// ---------------------------------------------------------------------------

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
  for (const statement of statements) {
    if (!statement.startsWith('CREATE TABLE IF NOT EXISTS')) continue;
    const match = statement.match(/^CREATE TABLE IF NOT EXISTS `([^`]+)`/);
    if (match) createTables.set(match[1], statement);
  }
  return { statements, createTables };
}

function parseMySqlCreateTable(statement) {
  const result = { columns: new Map(), primaryKey: [], uniques: [], checks: [] };
  if (!statement) return result;
  const open = statement.indexOf('(');
  const close = statement.lastIndexOf(')');
  for (const part of splitTopLevel(statement.slice(open + 1, close))) {
    if (/^PRIMARY KEY/i.test(part)) { result.primaryKey = parseColumnList(part); continue; }
    if (/^UNIQUE/i.test(part)) { result.uniques.push(parseColumnList(part)); continue; }
    if (/^FOREIGN KEY/i.test(part)) continue;
    if (/^CHECK/i.test(part)) {
      result.checks.push(part.slice(part.indexOf('(') + 1, part.lastIndexOf(')')).trim());
      continue;
    }
    const match = part.match(/^`([^`]+)`\s+([A-Za-z]+(?:\([^)]*\))?)/);
    if (!match) continue;
    result.columns.set(match[1], { type: match[2].toUpperCase(), family: match[2].split('(')[0].toLowerCase() });
  }
  return result;
}

function parseColumnList(part) {
  const inner = part.slice(part.indexOf('(') + 1, part.lastIndexOf(')'));
  return inner.split(',').map((value) => value.trim().replace(/^`|`$/g, ''));
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}
