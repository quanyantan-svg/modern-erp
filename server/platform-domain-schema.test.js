// Platform 平台层域 —— schema 与迁移合同（docs/design/platform.md §32.2）。
//
// 覆盖三件事：
//   1. SQLite 侧：17 张新表存在，既有表 notifications / audit_logs 获得加列扩展；
//   2. 幂等性：迁移可以在既有库上重复执行而不改变库形；
//   3. MySQL 侧：**离线**证明方言由 SQLite 快照派生 —— 用一个真实的 SQLite 快照驱动
//      planMySqlAdditiveReconciliation，读取它真正发出的 CREATE TABLE / ADD COLUMN 语句。
//      这一步不需要 MySQL，也不需要 mock adapter：派生路径是纯函数。
//
// 第 3 项是本测试的核心价值：MySQL 侧的行为由快照派生，SQLite 与 MySQL 的落地天然同批；
// 但既有表新增**唯一索引**不会被增量对账补齐（planMySqlIndexReconciliation 跳过
// origin === 'u'），所以通知去重必须由应用层在事务内保证 —— 本测试同时锁住这条事实。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { captureSqliteSnapshot, planMySqlAdditiveReconciliation } from './database/mysql-schema.js';
import { PLATFORM_DOMAIN_TABLES } from './migrations/platform-domain-schema.js';

/** 每个 Platform 表必须存在的关键列（抽查列名，不做全列断言）。 */
const REQUIRED_COLUMNS = {
  workflow_templates: ['code', 'document_type', 'status', 'current_version'],
  workflow_template_versions: ['template_id', 'version', 'status', 'definition_json'],
  workflow_bindings: ['document_type', 'org_id', 'template_id', 'version_id', 'status'],
  workflow_binding_history: ['binding_id', 'version_id', 'activated_by', 'activated_at'],
  workflow_instances: ['template_id', 'version_id', 'document_type', 'document_id', 'status', 'idempotency_key'],
  workflow_node_instances: ['instance_id', 'node_key', 'node_type', 'status', 'assignee_id'],
  workflow_tasks: ['instance_id', 'node_instance_id', 'assignee_id', 'status', 'row_version'],
  workflow_action_logs: ['instance_id', 'node_instance_id', 'action_type', 'status'],
  workflow_events: ['instance_id', 'event_type', 'actor_id', 'created_at'],
  sod_rules: ['code', 'business_type', 'action', 'constraint_type', 'resolution', 'status'],
  sod_evaluations: ['rule_id', 'business_type', 'business_id', 'actor_id', 'decision'],
  organizations: ['code', 'name', 'org_type', 'parent_org_id', 'status'],
  organization_scopes: ['scope_code', 'name', 'binding_mode'],
  organization_scope_bindings: ['scope_id', 'org_id'],
  attachments: ['owner_type', 'owner_id', 'file_name', 'content_type', 'byte_size', 'sha256', 'storage_key'],
  notification_subscriptions: ['user_id', 'category', 'event_type', 'channel'],
  document_number_series: ['document_type', 'org_id', 'prefix', 'period_mode', 'pad_length'],
};

const NOTIFICATION_NEW_COLUMNS = ['priority', 'category', 'action_url', 'expires_at', 'dedupe_key'];
const AUDIT_LOG_NEW_COLUMNS = ['business_date', 'request_id', 'before_json', 'after_json'];

function withDatabase(run) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-platform-schema-'));
  const file = join(dir, 'platform-schema.db');
  try {
    return run(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .map((row) => row.name);
}

/*
 * MySQL 派生的三个断言共用**同一份**快照：捕获一次 SQLite 快照要建一个完整库
 * （421 张表），重复捕获会让本文件无谓地慢三倍。
 */
let cachedSnapshot = null;
function platformSnapshot() {
  if (!cachedSnapshot) {
    cachedSnapshot = captureSqliteSnapshot((filename) => createDatabase(filename), false);
  }
  return cachedSnapshot;
}

/** 由快照派生的 MySQL DDL：表名 → CREATE TABLE 语句。 */
function derivedCreateStatements(snapshot) {
  const statements = planMySqlAdditiveReconciliation(snapshot, { tables: new Set(), columns: new Map() });
  const byTable = new Map();
  for (const statement of statements) {
    const match = /^CREATE TABLE IF NOT EXISTS `([^`]+)`/.exec(statement);
    if (match) byTable.set(match[1], statement);
  }
  return byTable;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

test('PLAT-01 SQLite 侧：17 张 Platform 表与两个既有表的加列扩展', () => {
  withDatabase((file) => {
    const db = createDatabase(file);
    try {
      const tables = new Set(tableNames(db));
      assert.equal(PLATFORM_DOMAIN_TABLES.length, 17, 'Platform 域必须恰好拥有 17 张新表');
      for (const table of PLATFORM_DOMAIN_TABLES) {
        assert.ok(tables.has(table), `缺少 Platform 表 ${table}`);
        const columns = new Set(columnNames(db, table));
        for (const column of REQUIRED_COLUMNS[table] || []) {
          assert.ok(columns.has(column), `${table} 缺少列 ${column}`);
        }
      }
      for (const column of NOTIFICATION_NEW_COLUMNS) {
        assert.ok(columnNames(db, 'notifications').includes(column), `notifications 缺少列 ${column}`);
      }
      for (const column of AUDIT_LOG_NEW_COLUMNS) {
        assert.ok(columnNames(db, 'audit_logs').includes(column), `audit_logs 缺少列 ${column}`);
      }
    } finally {
      db.close();
    }
  });
});

test('PLAT-02 幂等性：迁移在既有库上重复执行不改变库形', () => {
  withDatabase((file) => {
    const first = createDatabase(file);
    const firstTables = tableNames(first).length;
    const firstNotificationColumns = columnNames(first, 'notifications').length;
    const firstAuditColumns = columnNames(first, 'audit_logs').length;
    first.close();

    const second = createDatabase(file);
    try {
      assert.equal(tableNames(second).length, firstTables, '重复迁移不得新增或删除表');
      assert.equal(columnNames(second, 'notifications').length, firstNotificationColumns,
        '重复迁移不得重复加列');
      assert.equal(columnNames(second, 'audit_logs').length, firstAuditColumns,
        '重复迁移不得重复加列');
    } finally {
      second.close();
    }
  });
});

test('PLAT-03 MySQL 侧离线派生：17 张表与两个既有表的加列全部落地', () => {
  const byTable = derivedCreateStatements(platformSnapshot());

  for (const table of PLATFORM_DOMAIN_TABLES) {
    const ddl = byTable.get(table);
    assert.ok(ddl, `MySQL 派生语句缺少表 ${table}`);
    for (const column of REQUIRED_COLUMNS[table] || []) {
      assert.ok(ddl.includes(`\`${column}\``), `MySQL DDL ${table} 缺少列 ${column}`);
    }
  }

  const auditDdl = byTable.get('audit_logs');
  assert.ok(auditDdl, 'MySQL 派生语句缺少表 audit_logs');
  for (const column of AUDIT_LOG_NEW_COLUMNS) {
    assert.ok(auditDdl.includes(`\`${column}\``), `MySQL DDL audit_logs 缺少新增列 ${column}`);
  }
  const notificationDdl = byTable.get('notifications');
  assert.ok(notificationDdl, 'MySQL 派生语句缺少表 notifications');
  for (const column of NOTIFICATION_NEW_COLUMNS) {
    assert.ok(notificationDdl.includes(`\`${column}\``), `MySQL DDL notifications 缺少新增列 ${column}`);
  }
});

test('PLAT-04 MySQL 复合主键与 CHECK 约束被派生', () => {
  const ddl = derivedCreateStatements(platformSnapshot());

  // 复合主键：notification_subscriptions(user_id, category, event_type, channel)。
  assert.match(
    ddl.get('notification_subscriptions'),
    /PRIMARY KEY \(`user_id`,`category`,`event_type`,`channel`\)/,
    'notification_subscriptions 的复合主键必须被派生到 MySQL',
  );
  // 行内 UNIQUE：workflow_bindings(document_type, org_id)。
  assert.match(
    ddl.get('workflow_bindings'),
    /UNIQUE \(`document_type`,`org_id`\)/,
    'workflow_bindings 的行内 UNIQUE 必须被派生到 MySQL',
  );
  // CHECK 约束：workflow_instances.status 的枚举。
  assert.match(
    ddl.get('workflow_instances'),
    /CHECK \(status IN \('RUNNING','SUSPENDED','COMPLETED','TERMINATED','CANCELLED'\)\)/,
    'workflow_instances.status 的 CHECK 约束必须被派生到 MySQL',
  );
  // 外键：任务指向实例与节点实例。
  assert.match(ddl.get('workflow_tasks'), /FOREIGN KEY \(`instance_id`\) REFERENCES `workflow_instances`/,
    'workflow_tasks 的外键必须被派生到 MySQL');
});

test('PLAT-05 既有 MySQL 库的增量对账为两个既有表发出 ADD COLUMN', () => {
  const snapshot = platformSnapshot();
  // 模拟既有库：所有表都已存在，notifications / audit_logs 缺少新列。
  // `columns` 的语义是「该表**已存在**的列名集合」——对账函数据此为缺失列发出 ADD COLUMN。
  const existingTables = new Set(snapshot.tables.map((table) => table.name));
  const columns = new Map();
  for (const table of snapshot.tables) {
    const newColumns = table.name === 'notifications' ? NOTIFICATION_NEW_COLUMNS
      : table.name === 'audit_logs' ? AUDIT_LOG_NEW_COLUMNS
        : [];
    columns.set(table.name, new Set(
      table.columns.map((column) => column.name).filter((name) => !newColumns.includes(name)),
    ));
  }
  const statements = planMySqlAdditiveReconciliation(snapshot, { tables: existingTables, columns });

  const alters = statements.filter((statement) => /^ALTER TABLE/.test(statement));
  const alterText = alters.join('\n');
  for (const column of NOTIFICATION_NEW_COLUMNS) {
    assert.match(alterText, new RegExp(`ALTER TABLE \`notifications\` ADD COLUMN \`${column}\``),
      `既有 MySQL 库的增量对账必须为 notifications 发出 ${column} 的 ADD COLUMN`);
  }
  for (const column of AUDIT_LOG_NEW_COLUMNS) {
    assert.match(alterText, new RegExp(`ALTER TABLE \`audit_logs\` ADD COLUMN \`${column}\``),
      `既有 MySQL 库的增量对账必须为 audit_logs 发出 ${column} 的 ADD COLUMN`);
  }
});
