// Sales & Customer Wave 10 — Credit Check + Credit Special Approval.
//
// Exactly two additive tables, matching solution.md §36.2.7 and §36.2.8.
// No historical Sales, Finance or Credit row is rewritten, no backfill runs,
// and no Wave 11 table is created here.
//
// Dialect notes:
//   - `credit_check_results` is created BEFORE `credit_special_approval`
//     because the approval row carries the FK to the check result row
//     (§36.2.8 `fk_credit_special_approval_check`).
//   - Table-level UNIQUE constraints are declared with the §36.2.7 / §36.2.8
//     constraint names. SQLite does not preserve a table-constraint name on
//     its auto-index, so the parity assertions compare the constrained column
//     set instead of the index name on both engines.

export const SALES_WAVE10_TABLES = Object.freeze([
  'credit_check_results',
  'credit_special_approval',
]);

const INDEXES = Object.freeze([
  { table: 'credit_check_results', name: 'ix_credit_check_results_source', columns: ['sales_order_id', 'sales_delivery_id'] },
  { table: 'credit_check_results', name: 'ix_credit_check_results_group', columns: ['check_group_id'] },
  { table: 'credit_check_results', name: 'ix_credit_check_results_stage_date', columns: ['stage', 'business_date'] },
  { table: 'credit_special_approval', name: 'ix_credit_special_approval_decision', columns: ['decision'] },
  { table: 'credit_special_approval', name: 'ix_credit_special_approval_order', columns: ['source_sales_order_id'] },
]);

// Table-level uniqueness that the design fixes by name. SQLite stores these as
// auto-indexes, so the assertions compare column sets rather than index names.
// The approved constraint identity is exported because the cross-dialect
// comparison uses it to decide which table-level UNIQUE constraint may carry a
// backend-generated name.
export const UNIQUE_CONSTRAINTS = Object.freeze([
  { table: 'credit_check_results', name: 'uq_credit_check_results_group_scope', columns: ['check_group_id', 'scope_type'] },
  { table: 'credit_special_approval', name: 'uq_credit_special_approval_source', columns: ['source_credit_check_result_id'] },
]);

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_check_results (
    id TEXT PRIMARY KEY NOT NULL,
    check_group_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    credit_lock_anchor_id TEXT NOT NULL REFERENCES credit_lock_anchors(id),
    credit_profile_id TEXT NULL REFERENCES credit_profile(id),
    credit_policy_snapshot_id TEXT NOT NULL REFERENCES credit_policy_snapshots(id),
    policy_snapshot_fingerprint TEXT NOT NULL,
    profile_effective_state_hash TEXT NOT NULL,
    sales_order_id TEXT NULL REFERENCES sales_orders(id),
    sales_delivery_id TEXT NULL REFERENCES sales_deliveries(id),
    stage TEXT NOT NULL,
    business_date TEXT NOT NULL,
    proposed_delta_cents BIGINT NOT NULL,
    recognition_mode TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED')),
    reason_codes_json TEXT NOT NULL,
    component_breakdown_json TEXT NOT NULL,
    eligible_prepayment_source_identity TEXT NULL,
    evaluated_at TEXT NOT NULL,
    evaluated_by TEXT NULL REFERENCES users(id),
    CONSTRAINT uq_credit_check_results_group_scope UNIQUE (check_group_id, scope_type),
    CONSTRAINT ck_credit_check_results_source CHECK (sales_order_id IS NOT NULL OR sales_delivery_id IS NOT NULL)
  );
  CREATE TABLE IF NOT EXISTS credit_special_approval (
    id TEXT PRIMARY KEY NOT NULL,
    source_credit_check_result_id TEXT NOT NULL,
    source_check_group_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    source_credit_policy_snapshot_id TEXT NOT NULL REFERENCES credit_policy_snapshots(id),
    source_policy_snapshot_fingerprint TEXT NOT NULL,
    source_profile_effective_state_hash TEXT NOT NULL,
    source_sales_order_id TEXT NULL REFERENCES sales_orders(id),
    reason TEXT NOT NULL,
    requested_override_cents BIGINT NOT NULL,
    requested_expiry_business_date TEXT NOT NULL,
    requested_ceiling_cents BIGINT NOT NULL,
    authority_ceiling_cents BIGINT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('PENDING','APPROVED','REJECTED')),
    approved_override_cents BIGINT NULL,
    approved_ceiling_cents BIGINT NULL,
    approved_expiry_business_date TEXT NULL,
    scope_mode TEXT NOT NULL CHECK(scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
    approver_id TEXT NULL REFERENCES users(id),
    decided_at TEXT NULL,
    audit_id TEXT NULL,
    CONSTRAINT uq_credit_special_approval_source UNIQUE (source_credit_check_result_id),
    CONSTRAINT fk_credit_special_approval_check FOREIGN KEY (source_credit_check_result_id) REFERENCES credit_check_results(id),
    CONSTRAINT ck_credit_special_approval_decided CHECK (
      (decision = 'PENDING'  AND decided_at IS NULL     AND approver_id IS NULL)
      OR (decision <> 'PENDING' AND decided_at IS NOT NULL AND approver_id IS NOT NULL)
    )
  );
`;

function mysql(db) {
  // On fresh MySQL bootstrap these tables have already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_check_results (
    id VARCHAR(128) NOT NULL PRIMARY KEY, check_group_id VARCHAR(128) NOT NULL,
    scope_type VARCHAR(128) NOT NULL, credit_lock_anchor_id VARCHAR(128) NOT NULL,
    credit_profile_id VARCHAR(128) NULL, credit_policy_snapshot_id VARCHAR(128) NOT NULL,
    policy_snapshot_fingerprint VARCHAR(128) NOT NULL, profile_effective_state_hash VARCHAR(64) NOT NULL,
    sales_order_id VARCHAR(128) NULL, sales_delivery_id VARCHAR(128) NULL,
    stage VARCHAR(128) NOT NULL, business_date VARCHAR(128) NOT NULL,
    proposed_delta_cents BIGINT NOT NULL, recognition_mode VARCHAR(128) NOT NULL,
    decision VARCHAR(128) NOT NULL, reason_codes_json JSON NOT NULL, component_breakdown_json JSON NOT NULL,
    eligible_prepayment_source_identity TEXT NULL, evaluated_at LONGTEXT NOT NULL,
    evaluated_by VARCHAR(128) NULL,
    CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    CHECK(decision IN ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED')),
    CHECK(sales_order_id IS NOT NULL OR sales_delivery_id IS NOT NULL),
    CONSTRAINT uq_credit_check_results_group_scope UNIQUE (check_group_id, scope_type),
    FOREIGN KEY(credit_lock_anchor_id) REFERENCES credit_lock_anchors(id),
    FOREIGN KEY(credit_profile_id) REFERENCES credit_profile(id),
    FOREIGN KEY(credit_policy_snapshot_id) REFERENCES credit_policy_snapshots(id),
    FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY(sales_delivery_id) REFERENCES sales_deliveries(id),
    FOREIGN KEY(evaluated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_special_approval (
    id VARCHAR(128) NOT NULL PRIMARY KEY, source_credit_check_result_id VARCHAR(128) NOT NULL,
    source_check_group_id VARCHAR(128) NOT NULL, scope_type VARCHAR(128) NOT NULL,
    source_credit_policy_snapshot_id VARCHAR(128) NOT NULL,
    source_policy_snapshot_fingerprint VARCHAR(128) NOT NULL,
    source_profile_effective_state_hash VARCHAR(64) NOT NULL,
    source_sales_order_id VARCHAR(128) NULL, reason LONGTEXT NOT NULL,
    requested_override_cents BIGINT NOT NULL, requested_expiry_business_date VARCHAR(128) NOT NULL,
    requested_ceiling_cents BIGINT NOT NULL, authority_ceiling_cents BIGINT NOT NULL,
    decision VARCHAR(128) NOT NULL, approved_override_cents BIGINT NULL,
    approved_ceiling_cents BIGINT NULL, approved_expiry_business_date VARCHAR(128) NULL,
    scope_mode VARCHAR(128) NOT NULL, approver_id VARCHAR(128) NULL, decided_at LONGTEXT NULL,
    audit_id VARCHAR(128) NULL,
    CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    CHECK(decision IN ('PENDING','APPROVED','REJECTED')),
    CHECK(scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
    CHECK(
      (decision = 'PENDING'  AND decided_at IS NULL     AND approver_id IS NULL)
      OR (decision <> 'PENDING' AND decided_at IS NOT NULL AND approver_id IS NOT NULL)
    ),
    CONSTRAINT uq_credit_special_approval_source UNIQUE (source_credit_check_result_id),
    CONSTRAINT fk_credit_special_approval_check FOREIGN KEY (source_credit_check_result_id) REFERENCES credit_check_results(id),
    FOREIGN KEY(source_credit_policy_snapshot_id) REFERENCES credit_policy_snapshots(id),
    FOREIGN KEY(source_sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY(approver_id) REFERENCES users(id)
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
  credit_check_results: {
    columns: ['id','check_group_id','scope_type','credit_lock_anchor_id','credit_profile_id','credit_policy_snapshot_id',
      'policy_snapshot_fingerprint','profile_effective_state_hash','sales_order_id','sales_delivery_id','stage','business_date',
      'proposed_delta_cents','recognition_mode','decision','reason_codes_json','component_breakdown_json',
      'eligible_prepayment_source_identity','evaluated_at','evaluated_by'],
    pk: ['id'],
    fks: [['credit_lock_anchor_id','credit_lock_anchors'],['credit_profile_id','credit_profile'],
      ['credit_policy_snapshot_id','credit_policy_snapshots'],['sales_order_id','sales_orders'],
      ['sales_delivery_id','sales_deliveries'],['evaluated_by','users']],
    checks: 3,
  },
  credit_special_approval: {
    columns: ['id','source_credit_check_result_id','source_check_group_id','scope_type','source_credit_policy_snapshot_id',
      'source_policy_snapshot_fingerprint','source_profile_effective_state_hash','source_sales_order_id','reason',
      'requested_override_cents','requested_expiry_business_date','requested_ceiling_cents','authority_ceiling_cents',
      'decision','approved_override_cents','approved_ceiling_cents','approved_expiry_business_date','scope_mode',
      'approver_id','decided_at','audit_id'],
    pk: ['id'],
    fks: [['source_credit_check_result_id','credit_check_results'],['source_credit_policy_snapshot_id','credit_policy_snapshots'],
      ['source_sales_order_id','sales_orders'],['approver_id','users']],
    checks: 4,
  },
});

// Nullable / non-nullable parity that the design depends on: the approval
// decided-state CHECK is only satisfiable when `decided_at` and `approver_id`
// are genuinely nullable, and the two money columns stay nullable so a
// PENDING row cannot carry an approved amount.
const NULLABILITY = Object.freeze([
  ['credit_check_results','credit_profile_id','YES'],
  ['credit_check_results','sales_order_id','YES'],
  ['credit_check_results','sales_delivery_id','YES'],
  ['credit_check_results','evaluated_by','YES'],
  ['credit_check_results','check_group_id','NO'],
  ['credit_check_results','scope_type','NO'],
  ['credit_special_approval','source_sales_order_id','YES'],
  ['credit_special_approval','approved_override_cents','YES'],
  ['credit_special_approval','approved_ceiling_cents','YES'],
  ['credit_special_approval','approved_expiry_business_date','YES'],
  ['credit_special_approval','approver_id','YES'],
  ['credit_special_approval','decided_at','YES'],
  ['credit_special_approval','scope_mode','NO'],
]);

// Indexed / constrained columns whose physical type must agree across engines.
const PHYSICAL_TYPES = Object.freeze([
  ['credit_check_results','check_group_id','varchar',128],
  ['credit_check_results','scope_type','varchar',128],
  ['credit_check_results','proposed_delta_cents','bigint',null],
  ['credit_check_results','reason_codes_json','json',null],
  ['credit_check_results','component_breakdown_json','json',null],
  ['credit_special_approval','source_credit_check_result_id','varchar',128],
  ['credit_special_approval','requested_override_cents','bigint',null],
  ['credit_special_approval','authority_ceiling_cents','bigint',null],
  ['credit_special_approval','approved_override_cents','bigint',null],
  ['credit_special_approval','scope_mode','varchar',128],
]);

// The complete approved Wave 10 MySQL physical column contract. It is the
// single authority for the physical type of every Wave 10 column, so the live
// migration DDL above and the snapshot bootstrap that materializes the same
// two tables on a fresh MySQL database cannot drift apart. The snapshot
// bootstrap consumes this table instead of its generic TEXT heuristic; a
// generic fallback would produce LONGTEXT for the unbounded-looking columns
// and VARCHAR(128) for the indexed ones, which is a different physical schema
// for the same logical table.
export const WAVE10_MYSQL_COLUMN_TYPES = Object.freeze({
  credit_check_results: Object.freeze({
    id: 'VARCHAR(128)',
    check_group_id: 'VARCHAR(128)',
    scope_type: 'VARCHAR(128)',
    credit_lock_anchor_id: 'VARCHAR(128)',
    credit_profile_id: 'VARCHAR(128)',
    credit_policy_snapshot_id: 'VARCHAR(128)',
    policy_snapshot_fingerprint: 'VARCHAR(128)',
    profile_effective_state_hash: 'VARCHAR(64)',
    sales_order_id: 'VARCHAR(128)',
    sales_delivery_id: 'VARCHAR(128)',
    stage: 'VARCHAR(128)',
    business_date: 'VARCHAR(128)',
    proposed_delta_cents: 'BIGINT',
    recognition_mode: 'VARCHAR(128)',
    decision: 'VARCHAR(128)',
    reason_codes_json: 'JSON',
    component_breakdown_json: 'JSON',
    eligible_prepayment_source_identity: 'TEXT',
    evaluated_at: 'LONGTEXT',
    evaluated_by: 'VARCHAR(128)',
  }),
  credit_special_approval: Object.freeze({
    id: 'VARCHAR(128)',
    source_credit_check_result_id: 'VARCHAR(128)',
    source_check_group_id: 'VARCHAR(128)',
    scope_type: 'VARCHAR(128)',
    source_credit_policy_snapshot_id: 'VARCHAR(128)',
    source_policy_snapshot_fingerprint: 'VARCHAR(128)',
    source_profile_effective_state_hash: 'VARCHAR(64)',
    source_sales_order_id: 'VARCHAR(128)',
    reason: 'LONGTEXT',
    requested_override_cents: 'BIGINT',
    requested_expiry_business_date: 'VARCHAR(128)',
    requested_ceiling_cents: 'BIGINT',
    authority_ceiling_cents: 'BIGINT',
    decision: 'VARCHAR(128)',
    approved_override_cents: 'BIGINT',
    approved_ceiling_cents: 'BIGINT',
    approved_expiry_business_date: 'VARCHAR(128)',
    scope_mode: 'VARCHAR(128)',
    approver_id: 'VARCHAR(128)',
    decided_at: 'LONGTEXT',
    audit_id: 'VARCHAR(128)',
  }),
});

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 10 schema conflict: ${message}`); }

function assertSqlite(db) {
  for (const [table, contract] of Object.entries(CONTRACTS)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!same(columns.map((row) => row.name), contract.columns)) conflict(`${table} column identity/order drifted`);
    if (!same(columns.filter((row) => row.pk).sort((a,b) => a.pk-b.pk).map((row) => row.name), contract.pk)) conflict(`${table} primary key drifted`);
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    for (const [column, target] of contract.fks) {
      if (!fks.some((row) => row.from === column && row.table === target && row.to === 'id')) conflict(`${table}.${column} foreign key drifted`);
    }
    if (fks.length !== contract.fks.length) conflict(`${table} foreign key set drifted`);
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
    if ((ddl.match(/\bCHECK\s*\(/gi) || []).length !== contract.checks) conflict(`${table} CHECK set drifted`);
  }
  for (const constraint of UNIQUE_CONSTRAINTS) {
    const uniques = db.prepare(`PRAGMA index_list(${constraint.table})`).all().filter((row) => Boolean(row.unique));
    const matched = uniques.some((row) => {
      const columns = db.prepare(`PRAGMA index_info(${row.name})`).all().sort((a,b) => a.seqno-b.seqno).map((item) => item.name);
      return same(columns, constraint.columns);
    });
    if (!matched) conflict(`${constraint.table} unique constraint ${constraint.name} drifted`);
  }
  for (const index of INDEXES) {
    const row = db.prepare(`PRAGMA index_list(${index.table})`).all().find((item) => item.name === index.name);
    if (!row || Boolean(row.unique) !== Boolean(index.unique)) conflict(`${index.table}.${index.name} index drifted`);
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all().sort((a,b) => a.seqno-b.seqno).map((item) => item.name);
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
  for (const constraint of UNIQUE_CONSTRAINTS) {
    // Snapshot bootstrap reconstructs SQLite table-level UNIQUE constraints
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
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('credit_check_results','credit_special_approval')`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  for (const [table, column, expected] of NULLABILITY) {
    if (nullable.get(`${table}.${column}`) !== expected) conflict(`${table}.${column} nullability drifted`);
  }
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('credit_check_results','credit_special_approval')`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  for (const [table, column, type, length] of PHYSICAL_TYPES) {
    const actual = physical.get(`${table}.${column}`);
    if (!actual || actual[0] !== type || (length != null && actual[1] !== length)) conflict(`${table}.${column} physical type drifted`);
  }
}

export function migrateSalesCustomerWave10CreditCheck(db) {
  if (!db) throw new Error('migrateSalesCustomerWave10CreditCheck: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
}
