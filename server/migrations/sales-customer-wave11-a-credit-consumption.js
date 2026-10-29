// Sales & Customer Wave 11-A — ONE_TIME Special Approval Consumption Ledger.
//
// solution.md §37.54.22.4 and document.md
// `## W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正 Requirement（2026-10-29）`.
//
// The ledger is the machine-verifiable authority for the fact "this Special
// Approval was consumed by this business action on this scope". It exists
// because the previous implementation derived that fact from the CONSUME audit
// row alone, while the write of that row was gated by an unrelated key (the
// check group's replay flag). The two keys diverged, so a replay could return
// `PASS` while no consumption was ever recorded, and the approval stayed
// reusable.
//
// The ledger is PURELY ADDITIVE:
//
//   - exactly one new table;
//   - no ALTER of any existing table;
//   - no backfill of any existing approval, check result or audit row;
//   - no historical row is read, rewritten or deleted by this migration.
//
// The pre-existing CONSUME audit rows remain the authority for the consumptions
// that happened before this table existed; the runtime reads them back. This
// migration never migrates them.
//
// PHYSICAL TYPE CONTRACT. The MySQL column types below are the ones the
// generic MySQL snapshot bootstrap produces for this table, so the
// fresh-bootstrap path and this live migration path materialize the SAME
// physical schema without a per-table type map. `scope_type` and
// `business_date` are therefore LONGTEXT, exactly like the non-indexed enum and
// date columns of the Wave 9 credit tables. `CHECK` over a LONGTEXT column is
// the proven Wave 9 shape (`credit_check_rules.scenario`).

export const SALES_WAVE11_CONSUMPTION_TABLES = Object.freeze([
  'credit_special_approval_consumption',
]);

const INDEXES = Object.freeze([
  { table: 'credit_special_approval_consumption', name: 'ix_credit_special_approval_consumption_group', columns: ['check_group_id'] },
]);

// The one uniqueness the whole design rests on. `consumption_key` is never
// NULL: for ONE_TIME it is the constant 'SINGLE', so a ONE_TIME approval can
// carry at most one consumption row; for the repeatable scope modes it is the
// action key, so one approval can be consumed once per business action.
export const CONSUMPTION_UNIQUE_CONSTRAINTS = Object.freeze([
  { table: 'credit_special_approval_consumption', name: 'uq_credit_special_approval_consumption', columns: ['approval_id', 'consumption_key'] },
]);

// The approved physical type of every column of the ledger. It mirrors what
// the generic snapshot bootstrap resolves, so both MySQL paths agree.
export const WAVE11_CONSUMPTION_MYSQL_COLUMN_TYPES = Object.freeze({
  credit_special_approval_consumption: Object.freeze({
    id: 'VARCHAR(128)',
    approval_id: 'VARCHAR(128)',
    scope_mode: 'VARCHAR(128)',
    consumption_key: 'VARCHAR(128)',
    check_group_id: 'VARCHAR(128)',
    scope_type: 'LONGTEXT',
    business_date: 'LONGTEXT',
    consumed_at: 'LONGTEXT',
    consumed_by: 'VARCHAR(128)',
    audit_id: 'VARCHAR(128)',
  }),
});

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_special_approval_consumption (
    id TEXT NOT NULL PRIMARY KEY,
    approval_id TEXT NOT NULL REFERENCES credit_special_approval(id),
    scope_mode TEXT NOT NULL CHECK(scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
    consumption_key TEXT NOT NULL,
    check_group_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    business_date TEXT NOT NULL,
    consumed_at TEXT NOT NULL,
    consumed_by TEXT NULL REFERENCES users(id),
    audit_id TEXT NULL,
    CONSTRAINT uq_credit_special_approval_consumption UNIQUE (approval_id, consumption_key),
    CONSTRAINT ck_credit_special_approval_consumption_one_time
      CHECK (scope_mode <> 'ONE_TIME' OR consumption_key = 'SINGLE')
  );
`;

function mysql(db) {
  // On a fresh MySQL bootstrap this table has already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_special_approval_consumption (
    id VARCHAR(128) NOT NULL PRIMARY KEY, approval_id VARCHAR(128) NOT NULL,
    scope_mode VARCHAR(128) NOT NULL, consumption_key VARCHAR(128) NOT NULL,
    check_group_id VARCHAR(128) NOT NULL, scope_type LONGTEXT NOT NULL,
    business_date LONGTEXT NOT NULL, consumed_at LONGTEXT NOT NULL,
    consumed_by VARCHAR(128) NULL, audit_id VARCHAR(128) NULL,
    CHECK(scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
    CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    CHECK (scope_mode <> 'ONE_TIME' OR consumption_key = 'SINGLE'),
    CONSTRAINT uq_credit_special_approval_consumption UNIQUE (approval_id, consumption_key),
    FOREIGN KEY(approval_id) REFERENCES credit_special_approval(id),
    FOREIGN KEY(consumed_by) REFERENCES users(id)
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
  credit_special_approval_consumption: {
    columns: ['id', 'approval_id', 'scope_mode', 'consumption_key', 'check_group_id', 'scope_type',
      'business_date', 'consumed_at', 'consumed_by', 'audit_id'],
    pk: ['id'],
    fks: [['approval_id', 'credit_special_approval'], ['consumed_by', 'users']],
    checks: 3,
  },
});

// Nullable / non-nullable parity. The consumption identity columns are NOT
// NULL in both engines, and the two provenance columns stay nullable so a
// consumption recorded without an actor or without its audit pointer stays
// representable.
const NULLABILITY = Object.freeze([
  ['credit_special_approval_consumption', 'id', 'NO'],
  ['credit_special_approval_consumption', 'approval_id', 'NO'],
  ['credit_special_approval_consumption', 'scope_mode', 'NO'],
  ['credit_special_approval_consumption', 'consumption_key', 'NO'],
  ['credit_special_approval_consumption', 'check_group_id', 'NO'],
  ['credit_special_approval_consumption', 'scope_type', 'NO'],
  ['credit_special_approval_consumption', 'business_date', 'NO'],
  ['credit_special_approval_consumption', 'consumed_at', 'NO'],
  ['credit_special_approval_consumption', 'consumed_by', 'YES'],
  ['credit_special_approval_consumption', 'audit_id', 'YES'],
]);

// Indexed / constrained columns whose physical type must agree across engines.
const PHYSICAL_TYPES = Object.freeze([
  ['credit_special_approval_consumption', 'id', 'varchar', 128],
  ['credit_special_approval_consumption', 'approval_id', 'varchar', 128],
  ['credit_special_approval_consumption', 'scope_mode', 'varchar', 128],
  ['credit_special_approval_consumption', 'consumption_key', 'varchar', 128],
  ['credit_special_approval_consumption', 'check_group_id', 'varchar', 128],
  ['credit_special_approval_consumption', 'scope_type', 'longtext', null],
  ['credit_special_approval_consumption', 'business_date', 'longtext', null],
  ['credit_special_approval_consumption', 'consumed_at', 'longtext', null],
  ['credit_special_approval_consumption', 'consumed_by', 'varchar', 128],
  ['credit_special_approval_consumption', 'audit_id', 'varchar', 128],
]);

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 11-A consumption schema conflict: ${message}`); }

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
  }
  for (const constraint of CONSUMPTION_UNIQUE_CONSTRAINTS) {
    const uniques = db.prepare(`PRAGMA index_list(${constraint.table})`).all().filter((row) => Boolean(row.unique));
    const matched = uniques.some((row) => {
      const columns = db.prepare(`PRAGMA index_info(${row.name})`).all().sort((a, b) => a.seqno - b.seqno).map((item) => item.name);
      return same(columns, constraint.columns);
    });
    if (!matched) conflict(`${constraint.table} unique constraint ${constraint.name} drifted`);
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
  for (const constraint of CONSUMPTION_UNIQUE_CONSTRAINTS) {
    // The snapshot bootstrap reconstructs SQLite table-level UNIQUE constraints
    // without a portable constraint name, so MySQL may choose the index name.
    // The approved cross-backend contract is the ordered unique column set.
    const rows = db.prepare(`SELECT INDEX_NAME index_name,COLUMN_NAME name,SEQ_IN_INDEX seq_in_index
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
        AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY' ORDER BY INDEX_NAME,SEQ_IN_INDEX`).all(constraint.table);
    const byIndex = new Map();
    for (const row of rows) {
      if (!byIndex.has(row.index_name)) byIndex.set(row.index_name, []);
      byIndex.get(row.index_name).push(row.name);
    }
    if (![...byIndex.values()].some((columns) => same(columns, constraint.columns))) {
      conflict(`${constraint.table} unique constraint ${constraint.name} column set drifted`);
    }
  }
  for (const index of INDEXES) {
    const rows = db.prepare(`SELECT COLUMN_NAME name,NON_UNIQUE non_unique FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX`).all(index.table, index.name);
    if (!same(rows.map((row) => row.name), index.columns) || rows.some((row) => Number(row.non_unique) !== (index.unique ? 0 : 1))) {
      conflict(`${index.table}.${index.name} index drifted`);
    }
  }
  const nullable = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,IS_NULLABLE nullable
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_special_approval_consumption'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  for (const [table, column, expected] of NULLABILITY) {
    if (nullable.get(`${table}.${column}`) !== expected) conflict(`${table}.${column} nullability drifted`);
  }
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_special_approval_consumption'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  for (const [table, column, type, length] of PHYSICAL_TYPES) {
    const actual = physical.get(`${table}.${column}`);
    if (!actual || actual[0] !== type || (length != null && actual[1] !== length)) conflict(`${table}.${column} physical type drifted`);
  }
}

export function migrateSalesCustomerWave11ACreditConsumption(db) {
  if (!db) throw new Error('migrateSalesCustomerWave11ACreditConsumption: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
}
