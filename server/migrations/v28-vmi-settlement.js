// V28 — VMI 结算机制（Procurement & Outsourcing）。
//
// Requirement : docs/requirements/procurement-outsourcing.md §31.24
//               （`VMI-SET-01..18`，业务所有者 2026-11-18 裁定）
// Design      : docs/design/procurement-outsourcing.md §26.45
// 素材库       : docs/reviews/m1/procurement-outsourcing-critical-chain-design.md
//               `:1711-1768`（三张结算表 DDL）、`:1773-1778`（期间 / 期初 / 部分结算）
//
// 本迁移是**纯加性**的：
//
//   1. `vmi_agreements.unit_price_cents`（**可空**，历史不回填 0 —— `M1-D-17`）；
//   2. `vmi_settlement_periods`（结算期头）；
//   3. `vmi_settlement_lines`（结算行：七量 + closing + 商业量）；
//   4. `vmi_settlement_bill_allocations`（分配事实：权威的「结算行 ↔ 账单行」关系）。
//
// 本迁移**不改**任何既有列、约束、索引或业务值，**不删**任何表，
// **不回填**任何历史数据。历史 VMI 协议没有协议单价这一事实必须保持「未知」，
// 而不是被写成 0 —— 缺价时业务路径 fail closed（`VMI_AGREEMENT_PRICE_MISSING`）。
//
// 幂等：SQLite 与 MySQL 各写一份 DDL；表用 `CREATE TABLE IF NOT EXISTS`，
// 索引在 SQLite 用 `CREATE INDEX IF NOT EXISTS`、在 MySQL 先查
// `information_schema.STATISTICS` 再建；加列先查列是否存在。
// 升级路径可重复执行，结果一致。
//
// 双引擎差异：MySQL 侧的列类型与 `server/database/mysql-schema.js` 的 `mysqlType()`
// 家族一致（`id` / `*_id` → `VARCHAR(128)`、`INTEGER` → `BIGINT`、`REAL` → `DECIMAL(24,6)`、
// 其它 `TEXT` → `LONGTEXT`），使「快照派生」路径与「实时迁移」路径物化**同一**物理结构。
//
// **类型必须 PINNED**（`VMI_SETTLEMENT_MYSQL_COLUMN_TYPES`）：本迁移自带一份
// 手写 MySQL DDL，而全新 MySQL bootstrap 走的是「SQLite 快照 → 启发式推导」路径。
// 两份副本正是这两条路径漂移的根源 —— 漂移只��在真实 MySQL 上才看得见。
// 把类型表 pin 在 `server/database/mysql-schema.js` 里，两条路径就只有**一份**事实。
// 本表的值由该解析器对**本文件自己的 SQLite DDL** 求值得到（见
// `server/vmi-settlement-mysql-parity.test.js`），不是手抄。
//
// `CHECK` 在 MySQL 8.0.16+ 才真正强制，因此**业务断言不依赖 CHECK**：CHECK 只是形状声明，
// `VMI-SET-*` 的门禁全部在代码里。

import { runMigrationStep } from './migration-runner.js';

export const VMI_SETTLEMENT_MIGRATION_ID = 'v28-vmi-settlement';

const TABLES = Object.freeze([
  'vmi_settlement_periods',
  'vmi_settlement_lines',
  'vmi_settlement_bill_allocations',
]);

/**
 * The approved physical type of every column of the three settlement tables.
 *
 * It is PINNED in the canonical resolver
 * (`server/database/mysql-schema.js` → `PINNED_MYSQL_COLUMN_TYPES`), so the
 * fresh-bootstrap path (which derives the type from the SQLite column) and
 * this live migration path (which takes this table's own literal) materialize
 * the SAME physical schema.
 *
 * Values are the resolver's own output for this file's SQLite DDL — see
 * `server/vmi-settlement-mysql-parity.test.js`, which recomputes them and
 * fails closed on any drift.
 *
 * **Indexed text columns are `VARCHAR(128)`, not `LONGTEXT`.** InnoDB refuses
 * to index a `LONGTEXT` column without a prefix length, so a full-length
 * index on `period_key` / `status` / `window_start` / `window_end` /
 * `idempotency_key` would be rejected by a real MySQL server. The generic
 * heuristic would derive `LONGTEXT` for these (their `UNIQUE` / index
 * membership is table-level, not column-level), so the pin also has to
 * override the heuristic — exactly as `scope_mode` does in
 * `server/database/mysql-schema.js`.
 */
export const VMI_SETTLEMENT_MYSQL_COLUMN_TYPES = Object.freeze({
  vmi_settlement_periods: Object.freeze({
    id: 'VARCHAR(128)',
    agreement_id: 'VARCHAR(128)',
    supplier_id: 'VARCHAR(128)',
    period_key: 'VARCHAR(128)',
    window_kind: 'LONGTEXT',
    window_start: 'VARCHAR(128)',
    window_end: 'VARCHAR(128)',
    opening_source: 'LONGTEXT',
    opening_snapshot_at: 'LONGTEXT',
    opening_evidence_hash: 'LONGTEXT',
    opening_audit_ref: 'LONGTEXT',
    status: 'VARCHAR(128)',
    opened_at: 'LONGTEXT',
    closed_at: 'LONGTEXT',
    created_at: 'LONGTEXT',
    updated_at: 'LONGTEXT',
  }),
  vmi_settlement_lines: Object.freeze({
    id: 'VARCHAR(128)',
    period_id: 'VARCHAR(128)',
    product_id: 'VARCHAR(128)',
    opening_supplier_qty: 'DECIMAL(24,6)',
    opening_enterprise_qty: 'DECIMAL(24,6)',
    received_qty: 'DECIMAL(24,6)',
    supplier_consumed_qty: 'DECIMAL(24,6)',
    enterprise_consumed_qty: 'DECIMAL(24,6)',
    owner_changed_qty: 'DECIMAL(24,6)',
    returned_qty: 'DECIMAL(24,6)',
    adjusted_supplier_qty: 'DECIMAL(24,6)',
    adjusted_enterprise_qty: 'DECIMAL(24,6)',
    unallocated_adjusted_qty: 'DECIMAL(24,6)',
    closing_supplier_qty: 'DECIMAL(24,6)',
    closing_enterprise_qty: 'DECIMAL(24,6)',
    closing_qty: 'DECIMAL(24,6)',
    commercial_released_qty: 'DECIMAL(24,6)',
    settled_qty: 'DECIMAL(24,6)',
    unit_price_cents: 'BIGINT',
    bill_id: 'VARCHAR(128)',
    created_at: 'LONGTEXT',
    updated_at: 'LONGTEXT',
  }),
  vmi_settlement_bill_allocations: Object.freeze({
    id: 'VARCHAR(128)',
    settlement_line_id: 'VARCHAR(128)',
    supplier_bill_id: 'VARCHAR(128)',
    supplier_bill_item_id: 'VARCHAR(128)',
    allocation_event_id: 'VARCHAR(128)',
    allocated_qty: 'DECIMAL(24,6)',
    allocated_amount_cents: 'BIGINT',
    idempotency_key: 'VARCHAR(128)',
    request_fingerprint: 'CHAR(67)',
    created_at: 'LONGTEXT',
  }),
});

const INDEXES = Object.freeze([
  { table: 'vmi_settlement_periods', name: 'idx_vmi_settlement_periods_agreement', columns: ['agreement_id', 'window_start', 'window_end'] },
  { table: 'vmi_settlement_periods', name: 'idx_vmi_settlement_periods_status', columns: ['agreement_id', 'status'] },
  { table: 'vmi_settlement_lines', name: 'idx_vmi_settlement_lines_period', columns: ['period_id', 'product_id'] },
  { table: 'vmi_settlement_bill_allocations', name: 'idx_vmi_settlement_allocations_line', columns: ['settlement_line_id'] },
]);

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS vmi_settlement_periods (
    id TEXT PRIMARY KEY NOT NULL,
    agreement_id TEXT NOT NULL REFERENCES vmi_agreements(id),
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    period_key TEXT NOT NULL,
    window_kind TEXT NOT NULL CHECK(window_kind IN ('CALENDAR_MONTH','CUSTOM')),
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    opening_source TEXT NOT NULL CHECK(opening_source IN ('PRIOR_CLOSED_PERIOD','CANONICAL_INVENTORY_POSITION')),
    opening_snapshot_at TEXT NOT NULL,
    opening_evidence_hash TEXT NOT NULL,
    opening_audit_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(agreement_id, period_key),
    CHECK(window_start <= window_end)
  );

  CREATE TABLE IF NOT EXISTS vmi_settlement_lines (
    id TEXT PRIMARY KEY NOT NULL,
    period_id TEXT NOT NULL REFERENCES vmi_settlement_periods(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    opening_supplier_qty REAL NOT NULL DEFAULT 0,
    opening_enterprise_qty REAL NOT NULL DEFAULT 0,
    received_qty REAL NOT NULL DEFAULT 0,
    supplier_consumed_qty REAL NOT NULL DEFAULT 0,
    enterprise_consumed_qty REAL NOT NULL DEFAULT 0,
    owner_changed_qty REAL NOT NULL DEFAULT 0,
    returned_qty REAL NOT NULL DEFAULT 0,
    adjusted_supplier_qty REAL NOT NULL DEFAULT 0,
    adjusted_enterprise_qty REAL NOT NULL DEFAULT 0,
    unallocated_adjusted_qty REAL NOT NULL DEFAULT 0,
    closing_supplier_qty REAL NOT NULL DEFAULT 0,
    closing_enterprise_qty REAL NOT NULL DEFAULT 0,
    closing_qty REAL NOT NULL DEFAULT 0,
    commercial_released_qty REAL NOT NULL DEFAULT 0,
    settled_qty REAL NOT NULL DEFAULT 0,
    unit_price_cents INTEGER,
    bill_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(period_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS vmi_settlement_bill_allocations (
    id TEXT PRIMARY KEY NOT NULL,
    settlement_line_id TEXT NOT NULL REFERENCES vmi_settlement_lines(id),
    supplier_bill_id TEXT NOT NULL REFERENCES supplier_bills(id),
    supplier_bill_item_id TEXT NOT NULL REFERENCES supplier_bill_items(id),
    allocation_event_id TEXT NOT NULL,
    allocated_qty REAL NOT NULL,
    allocated_amount_cents INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(allocation_event_id),
    UNIQUE(idempotency_key),
    UNIQUE(settlement_line_id, supplier_bill_item_id)
  );
`;

function mysqlDdl(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vmi_settlement_periods (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    agreement_id VARCHAR(128) NOT NULL,
    supplier_id VARCHAR(128) NOT NULL,
    period_key VARCHAR(128) NOT NULL,
    window_kind LONGTEXT NOT NULL,
    window_start VARCHAR(128) NOT NULL,
    window_end VARCHAR(128) NOT NULL,
    opening_source LONGTEXT NOT NULL,
    opening_snapshot_at LONGTEXT NOT NULL,
    opening_evidence_hash LONGTEXT NOT NULL,
    opening_audit_ref LONGTEXT NOT NULL,
    status VARCHAR(128) NOT NULL DEFAULT 'OPEN',
    opened_at LONGTEXT NOT NULL,
    closed_at LONGTEXT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    UNIQUE(agreement_id, period_key),
    CHECK(window_kind IN ('CALENDAR_MONTH','CUSTOM')),
    CHECK(opening_source IN ('PRIOR_CLOSED_PERIOD','CANONICAL_INVENTORY_POSITION')),
    CHECK(status IN ('OPEN','CLOSED')),
    CHECK(window_start <= window_end),
    FOREIGN KEY(agreement_id) REFERENCES vmi_agreements(id),
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  db.exec(`CREATE TABLE IF NOT EXISTS vmi_settlement_lines (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    period_id VARCHAR(128) NOT NULL,
    product_id VARCHAR(128) NOT NULL,
    opening_supplier_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    opening_enterprise_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    received_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    supplier_consumed_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    enterprise_consumed_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    owner_changed_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    returned_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    adjusted_supplier_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    adjusted_enterprise_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    unallocated_adjusted_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    closing_supplier_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    closing_enterprise_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    closing_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    commercial_released_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    settled_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
    unit_price_cents BIGINT NULL,
    bill_id VARCHAR(128) NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    UNIQUE(period_id, product_id),
    FOREIGN KEY(period_id) REFERENCES vmi_settlement_periods(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  db.exec(`CREATE TABLE IF NOT EXISTS vmi_settlement_bill_allocations (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    settlement_line_id VARCHAR(128) NOT NULL,
    supplier_bill_id VARCHAR(128) NOT NULL,
    supplier_bill_item_id VARCHAR(128) NOT NULL,
    allocation_event_id VARCHAR(128) NOT NULL,
    allocated_qty DECIMAL(24,6) NOT NULL,
    allocated_amount_cents BIGINT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint CHAR(67) NOT NULL,
    created_at LONGTEXT NOT NULL,
    UNIQUE(allocation_event_id),
    UNIQUE(idempotency_key),
    UNIQUE(settlement_line_id, supplier_bill_item_id),
    FOREIGN KEY(settlement_line_id) REFERENCES vmi_settlement_lines(id),
    FOREIGN KEY(supplier_bill_id) REFERENCES supplier_bills(id),
    FOREIGN KEY(supplier_bill_item_id) REFERENCES supplier_bill_items(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

function tableExists(db, table) {
  if (db.dialect === 'mysql') {
    return Boolean(db.prepare(`SELECT 1 FROM information_schema.tables
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).get(table));
  }
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function columnExists(db, table, column) {
  if (db.dialect === 'mysql') {
    return Boolean(db.prepare(`SELECT 1 FROM information_schema.columns
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`).get(table, column));
  }
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => String(row.name).toLowerCase() === String(column).toLowerCase());
}

function indexExists(db, table, index) {
  if (db.dialect === 'mysql') {
    return Boolean(db.prepare(`SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`).get(table, index));
  }
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index));
}

function createIndexes(db) {
  for (const index of INDEXES) {
    if (indexExists(db, index.table, index.name)) continue;
    if (db.dialect === 'mysql') {
      db.exec(`CREATE INDEX ${index.name} ON ${index.table} (${index.columns.join(',')})`);
    } else {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns.join(',')})`);
    }
  }
}

/**
 * `unit_price_cents` 是**协议单价**：VMI 的权威成本（`VMI-SET-03`）。
 *
 * 列必须可空：历史协议没有协议单价这一事实是「未知」，迁移**不得**把它写成 0
 * （`M1-D-17`）。缺价时收货 / 消耗 / 结算一律 fail closed。
 */
function ensureAgreementUnitPriceColumn(db) {
  if (columnExists(db, 'vmi_agreements', 'unit_price_cents')) return false;
  if (db.dialect === 'mysql') {
    db.exec('ALTER TABLE vmi_agreements ADD COLUMN unit_price_cents BIGINT NULL');
  } else {
    db.exec('ALTER TABLE vmi_agreements ADD COLUMN unit_price_cents INTEGER');
  }
  return true;
}

function inspect(db) {
  return TABLES.every((table) => tableExists(db, table))
    && columnExists(db, 'vmi_agreements', 'unit_price_cents')
    && INDEXES.every((index) => indexExists(db, index.table, index.name));
}

function apply(db) {
  if (db.dialect === 'mysql') mysqlDdl(db); else db.exec(SQLITE_DDL);
  ensureAgreementUnitPriceColumn(db);
  createIndexes(db);
}

function verify(db) {
  for (const table of TABLES) {
    if (!tableExists(db, table)) throw new Error(`${VMI_SETTLEMENT_MIGRATION_ID}: table ${table} was not created`);
  }
  if (!columnExists(db, 'vmi_agreements', 'unit_price_cents')) {
    throw new Error(`${VMI_SETTLEMENT_MIGRATION_ID}: vmi_agreements.unit_price_cents was not created`);
  }
  for (const index of INDEXES) {
    if (!indexExists(db, index.table, index.name)) {
      throw new Error(`${VMI_SETTLEMENT_MIGRATION_ID}: index ${index.name} was not created`);
    }
  }
  // The historical data must stay untouched: a migrated database must never
  // carry a fabricated price.
  const priced = db.prepare('SELECT COUNT(*) n FROM vmi_agreements WHERE unit_price_cents IS NOT NULL').get();
  if (Number(priced?.n || 0) > 0) {
    throw new Error(`${VMI_SETTLEMENT_MIGRATION_ID}: migration must not backfill a protocol price`);
  }
  return true;
}

/**
 * The migration entry point. Idempotent, additive and fail-closed: an
 * unknown DDL error propagates and aborts the database initialization, so the
 * application never starts against a half-migrated schema.
 */
export function migrateV28VmiSettlement(db) {
  if (!db) throw new Error('migrateV28VmiSettlement: db missing');
  return runMigrationStep(db, {
    id: VMI_SETTLEMENT_MIGRATION_ID,
    inspect,
    apply,
    verify,
  });
}
