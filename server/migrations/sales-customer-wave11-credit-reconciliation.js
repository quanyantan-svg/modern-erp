// Sales & Customer Wave 11-D — Credit Reconciliation & Deterministic Recalculation.
//
// solution.md §37.54.11 (W11-D) and §37.54.12.1 / §37.54.12.2 / §37.54.12.3.
//
// The table is the ONLY physical artefact of W11-D. It is an append-only
// execution-evidence ledger:
//
//   - exactly one new table;
//   - no ALTER of any existing table;
//   - no backfill of any existing check result, policy snapshot or approval;
//   - no historical row is read, rewritten or deleted by this migration.
//
// WRITE-ONCE, TERMINAL STATE. There is deliberately no UPDATE and no DELETE
// path for `credit_recalculation_history` anywhere in the repository
// (§37.54.11.4 "写入即终态；该表不得存在 UPDATE / DELETE 路径"). This file
// only ever CREATEs the table and CREATEs its indexes.
//
// NO TOP-LEVEL AMOUNT COLUMN (§37.54.6.5 G-1 / §37.54.12.9 G-5). The
// execution-time amounts live exclusively inside the single immutable
// `result_snapshot_json` payload, so there is no aggregable balance surface on
// this table. The column contract below is asserted on both engines, so a
// future change that adds an amount-shaped column fails closed.
//
// NO CREDIT WRITER READS THIS TABLE (§37.54.6.5 G-3). The table carries no
// foreign key into `credit_check_results` / `credit_special_approval` /
// `credit_profile_ratings` (G-2), so it cannot be back-referenced as decision
// evidence.
//
// PHYSICAL TYPE CONTRACT. The MySQL column types below are the ones the
// generic MySQL snapshot bootstrap produces for this table, so the
// fresh-bootstrap path and this live migration path materialize the SAME
// physical schema without a per-table type map.

export const SALES_WAVE11_RECONCILIATION_TABLES = Object.freeze([
  'credit_recalculation_history',
]);

const INDEXES = Object.freeze([
  { table: 'credit_recalculation_history', name: 'ix_credit_recalculation_history_object', columns: ['credit_object_type', 'credit_object_id'] },
  { table: 'credit_recalculation_history', name: 'ix_credit_recalculation_history_date', columns: ['business_date'] },
  { table: 'credit_recalculation_history', name: 'ix_credit_recalculation_history_kind', columns: ['kind', 'business_date'] },
]);

// The approved physical type of every column of the ledger. It mirrors what
// the generic snapshot bootstrap resolves, so both MySQL paths agree.
export const WAVE11_RECONCILIATION_MYSQL_COLUMN_TYPES = Object.freeze({
  credit_recalculation_history: Object.freeze({
    id: 'VARCHAR(128)',
    kind: 'VARCHAR(128)',
    credit_object_type: 'VARCHAR(128)',
    credit_object_id: 'VARCHAR(128)',
    customer_id: 'VARCHAR(128)',
    salesperson_scope_key: 'VARCHAR(128)',
    business_date: 'LONGTEXT',
    fact_digest: 'VARCHAR(128)',
    policy_snapshot_fingerprint: 'VARCHAR(128)',
    profile_effective_state_hash: 'VARCHAR(64)',
    scope_filter_json: 'JSON',
    result_snapshot_json: 'JSON',
    discrepancy_count: 'BIGINT',
    drift_detected: 'BIGINT',
    duration_ms: 'BIGINT',
    triggered_by: 'VARCHAR(128)',
    triggered_at: 'LONGTEXT',
  }),
});

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_recalculation_history (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('CHECK_ONLY','DETERMINISTIC_RECALCULATION')),
    credit_object_type TEXT NOT NULL,
    credit_object_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    salesperson_scope_key TEXT NOT NULL,
    business_date TEXT NOT NULL,
    fact_digest TEXT NOT NULL,
    policy_snapshot_fingerprint TEXT NOT NULL,
    profile_effective_state_hash TEXT NOT NULL,
    scope_filter_json TEXT NOT NULL,
    result_snapshot_json TEXT NOT NULL,
    discrepancy_count INTEGER NOT NULL DEFAULT 0 CHECK(discrepancy_count >= 0),
    drift_detected INTEGER NOT NULL DEFAULT 0 CHECK(drift_detected IN (0,1)),
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
    triggered_by TEXT NOT NULL REFERENCES users(id),
    triggered_at TEXT NOT NULL
  );
`;

function mysql(db) {
  // On a fresh MySQL bootstrap this table has already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_recalculation_history (
    id VARCHAR(128) NOT NULL PRIMARY KEY, kind VARCHAR(128) NOT NULL,
    credit_object_type VARCHAR(128) NOT NULL, credit_object_id VARCHAR(128) NOT NULL,
    customer_id VARCHAR(128) NOT NULL, salesperson_scope_key VARCHAR(128) NOT NULL,
    business_date LONGTEXT NOT NULL, fact_digest VARCHAR(128) NOT NULL,
    policy_snapshot_fingerprint VARCHAR(128) NOT NULL,
    profile_effective_state_hash VARCHAR(64) NOT NULL,
    scope_filter_json JSON NOT NULL, result_snapshot_json JSON NOT NULL,
    discrepancy_count BIGINT NOT NULL DEFAULT 0, drift_detected BIGINT NOT NULL DEFAULT 0,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    triggered_by VARCHAR(128) NOT NULL, triggered_at LONGTEXT NOT NULL,
    CHECK(kind IN ('CHECK_ONLY','DETERMINISTIC_RECALCULATION')),
    CHECK(discrepancy_count >= 0),
    CHECK(drift_detected IN (0,1)),
    CHECK(duration_ms >= 0),
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(triggered_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

function createIndexes(db) {
  for (const index of INDEXES) {
    if (db.dialect === 'mysql') {
      const found = db.prepare(`SELECT 1 present FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`).get(index.table, index.name);
      if (!found) db.exec(`CREATE INDEX ${index.name} ON ${index.table} (${index.columns.join(',')})`);
    } else {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns.join(',')})`);
    }
  }
}

const CONTRACTS = Object.freeze({
  credit_recalculation_history: {
    columns: ['id', 'kind', 'credit_object_type', 'credit_object_id', 'customer_id', 'salesperson_scope_key',
      'business_date', 'fact_digest', 'policy_snapshot_fingerprint', 'profile_effective_state_hash',
      'scope_filter_json', 'result_snapshot_json', 'discrepancy_count', 'drift_detected', 'duration_ms',
      'triggered_by', 'triggered_at'],
    pk: ['id'],
    fks: [['customer_id', 'customers'], ['triggered_by', 'users']],
    checks: 4,
  },
});

// §37.54.6.5 G-1 / §37.54.12.9 G-5 — the negative column contract. There is
// NO top-level amount-shaped column on this table: every execution-time amount
// is carried inside the single immutable `result_snapshot_json` payload. A
// future change that adds one of these columns fails closed on both engines.
export const FORBIDDEN_AMOUNT_COLUMN_PATTERN = /(^|_)(amount|balance|exposure|used|remaining|over_limit|limit|cents)($|_)/;

const NULLABILITY = Object.freeze([
  ['credit_recalculation_history', 'id', 'NO'],
  ['credit_recalculation_history', 'kind', 'NO'],
  ['credit_recalculation_history', 'credit_object_type', 'NO'],
  ['credit_recalculation_history', 'credit_object_id', 'NO'],
  ['credit_recalculation_history', 'customer_id', 'NO'],
  ['credit_recalculation_history', 'salesperson_scope_key', 'NO'],
  ['credit_recalculation_history', 'business_date', 'NO'],
  ['credit_recalculation_history', 'fact_digest', 'NO'],
  ['credit_recalculation_history', 'policy_snapshot_fingerprint', 'NO'],
  ['credit_recalculation_history', 'profile_effective_state_hash', 'NO'],
  ['credit_recalculation_history', 'scope_filter_json', 'NO'],
  ['credit_recalculation_history', 'result_snapshot_json', 'NO'],
  ['credit_recalculation_history', 'discrepancy_count', 'NO'],
  ['credit_recalculation_history', 'drift_detected', 'NO'],
  ['credit_recalculation_history', 'duration_ms', 'NO'],
  ['credit_recalculation_history', 'triggered_by', 'NO'],
  ['credit_recalculation_history', 'triggered_at', 'NO'],
]);

// Indexed / constrained columns whose physical type must agree across engines.
const PHYSICAL_TYPES = Object.freeze([
  ['credit_recalculation_history', 'id', 'varchar', 128],
  ['credit_recalculation_history', 'kind', 'varchar', 128],
  ['credit_recalculation_history', 'credit_object_type', 'varchar', 128],
  ['credit_recalculation_history', 'credit_object_id', 'varchar', 128],
  ['credit_recalculation_history', 'customer_id', 'varchar', 128],
  ['credit_recalculation_history', 'salesperson_scope_key', 'varchar', 128],
  ['credit_recalculation_history', 'business_date', 'longtext', null],
  ['credit_recalculation_history', 'fact_digest', 'varchar', 128],
  ['credit_recalculation_history', 'policy_snapshot_fingerprint', 'varchar', 128],
  ['credit_recalculation_history', 'profile_effective_state_hash', 'varchar', 64],
  ['credit_recalculation_history', 'scope_filter_json', 'json', null],
  ['credit_recalculation_history', 'result_snapshot_json', 'json', null],
  ['credit_recalculation_history', 'discrepancy_count', 'bigint', null],
  ['credit_recalculation_history', 'drift_detected', 'bigint', null],
  ['credit_recalculation_history', 'duration_ms', 'bigint', null],
  ['credit_recalculation_history', 'triggered_by', 'varchar', 128],
  ['credit_recalculation_history', 'triggered_at', 'longtext', null],
]);

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 11-D reconciliation schema conflict: ${message}`); }

// G-5 — the negative amount-column assertion, shared by both engines so the
// contract is proved identically everywhere.
function assertNoAmountColumn(table, columns) {
  for (const column of columns) {
    if (FORBIDDEN_AMOUNT_COLUMN_PATTERN.test(column)) {
      conflict(`${table}.${column} is a top-level amount column, which the design forbids`);
    }
  }
}

function assertSqlite(db) {
  for (const [table, contract] of Object.entries(CONTRACTS)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!same(columns.map((row) => row.name), contract.columns)) conflict(`${table} column identity/order drifted`);
    if (!same(columns.filter((row) => row.pk).sort((a, b) => a.pk - b.pk).map((row) => row.name), contract.pk)) conflict(`${table} primary key drifted`);
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    for (const [column, target] of contract.fks) {
      if (!fks.some((row) => row.from === column && row.table === target && row.to === 'id')) conflict(`${table}.${column} foreign key drifted`);
    }
    if (fks.length !== contract.fks.length) conflict(`${table} foreign key set drifted`);
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
    if ((ddl.match(/\bCHECK\s*\(/gi) || []).length !== contract.checks) conflict(`${table} CHECK set drifted`);
    assertNoAmountColumn(table, columns.map((row) => row.name));
  }
  for (const index of INDEXES) {
    const row = db.prepare(`PRAGMA index_list(${index.table})`).all().find((item) => item.name === index.name);
    if (!row || Boolean(row.unique) !== Boolean(index.unique)) conflict(`${index.table}.${index.name} index drifted`);
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all().sort((a, b) => a.seqno - b.seqno).map((item) => item.name);
    if (!same(columns, index.columns)) conflict(`${index.table}.${index.name} columns drifted`);
  }
}

function assertMySql(db) {
  for (const [table, contract] of Object.entries(CONTRACTS)) {
    const columns = db.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`).all(table);
    if (!same(columns.map((row) => row.name), contract.columns)) conflict(`${table} column identity/order drifted`);
    assertNoAmountColumn(table, columns.map((row) => row.name));
    const pk = db.prepare(`SELECT COLUMN_NAME name FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`).all(table).map((row) => row.name);
    if (!same(pk, contract.pk)) conflict(`${table} primary key drifted`);
    const fks = db.prepare(`SELECT COLUMN_NAME name,REFERENCED_TABLE_NAME target,REFERENCED_COLUMN_NAME target_column
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`).all(table);
    for (const [column, target] of contract.fks) {
      if (!fks.some((row) => row.name === column && row.target === target && row.target_column === 'id')) conflict(`${table}.${column} foreign key drifted`);
    }
    if (fks.length !== contract.fks.length) conflict(`${table} foreign key set drifted`);
    const checks = db.prepare(`SELECT COUNT(*) count FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='CHECK'`).get(table);
    if (Number(checks.count) !== contract.checks) conflict(`${table} CHECK set drifted`);
  }
  for (const index of INDEXES) {
    const rows = db.prepare(`SELECT COLUMN_NAME name,NON_UNIQUE non_unique FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX`).all(index.table, index.name);
    if (!same(rows.map((row) => row.name), index.columns) || rows.some((row) => Number(row.non_unique) !== (index.unique ? 0 : 1))) {
      conflict(`${index.table}.${index.name} index drifted`);
    }
  }
  const nullable = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,IS_NULLABLE nullable
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_recalculation_history'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  for (const [table, column, expected] of NULLABILITY) {
    if (nullable.get(`${table}.${column}`) !== expected) conflict(`${table}.${column} nullability drifted`);
  }
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_recalculation_history'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  for (const [table, column, type, length] of PHYSICAL_TYPES) {
    const actual = physical.get(`${table}.${column}`);
    if (!actual || actual[0] !== type || (length != null && actual[1] !== length)) conflict(`${table}.${column} physical type drifted`);
  }
}

export function migrateSalesCustomerWave11CreditReconciliation(db) {
  if (!db) throw new Error('migrateSalesCustomerWave11CreditReconciliation: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
}
