// Sales & Customer Wave 11-B — Credit Evaluation Foundation (SC103–SC105).
//
// solution.md §37.54.9 (W11-B) and §37.54.12.1 / §37.54.12.2 / §37.54.12.3.
//
// FOUR additive tables, in the dependency order the design fixes:
//
//   credit_evaluation_indicator  -> indicator definition (effective-dated)
//   credit_evaluation_scheme     -> grade scheme (effective-dated)
//   credit_evaluation_model      -> scheme + per-indicator milli-weights
//   credit_evaluation_scoring_sheet -> the bounded multi-scorer scoring sheet
//
// PURELY ADDITIVE.
//
//   - no ALTER of any existing table;
//   - no backfill of any existing credit profile, rating or check result;
//   - no historical row is read, rewritten or deleted by this migration.
//
// The W11-C table `credit_evaluation_result` and the deferred foreign key on
// `credit_profile_ratings` are NOT created here; they belong to
// `sales-customer-wave11-credit-evaluation-result-application.js`.
//
// PHYSICAL TYPE CONTRACT. The MySQL column types below are the ones the
// generic MySQL snapshot bootstrap produces for these tables, so the
// fresh-bootstrap path and this live migration path materialize the SAME
// physical schema. `_json` payload columns become JSON; `*_id` columns and
// `id` become VARCHAR(128); INTEGER score columns become BIGINT; every
// other TEXT column becomes LONGTEXT.

export const SALES_WAVE11_EVALUATION_FOUNDATION_TABLES = Object.freeze([
  'credit_evaluation_indicator',
  'credit_evaluation_scheme',
  'credit_evaluation_model',
  'credit_evaluation_scoring_sheet',
]);

const INDEXES = Object.freeze([
  { table: 'credit_evaluation_indicator', name: 'ix_credit_evaluation_indicator_code_date', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_scheme', name: 'ix_credit_evaluation_scheme_code_date', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_model', name: 'ix_credit_evaluation_model_code_date', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_model', name: 'ix_credit_evaluation_model_scheme', columns: ['scheme_id'] },
  { table: 'credit_evaluation_scoring_sheet', name: 'ix_credit_evaluation_scoring_sheet_profile', columns: ['credit_profile_id'] },
  { table: 'credit_evaluation_scoring_sheet', name: 'ix_credit_evaluation_scoring_sheet_target', columns: ['customer_id', 'profile_scope_key', 'business_date'] },
  { table: 'credit_evaluation_scoring_sheet', name: 'ix_credit_evaluation_scoring_sheet_model', columns: ['model_id'] },
]);

// The approved table-level uniqueness the design fixes by name.
export const WAVE11_EVALUATION_FOUNDATION_UNIQUE_CONSTRAINTS = Object.freeze([
  { table: 'credit_evaluation_indicator', name: 'uq_credit_evaluation_indicator_version', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_scheme', name: 'uq_credit_evaluation_scheme_version', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_model', name: 'uq_credit_evaluation_model_version', columns: ['code', 'effective_from'] },
  { table: 'credit_evaluation_scoring_sheet', name: 'uq_credit_evaluation_scoring_sheet_no', columns: ['sheet_no'] },
]);

// The approved physical type of every column of the four tables. It mirrors
// what the generic snapshot bootstrap resolves, so both MySQL paths agree.
export const WAVE11_EVALUATION_FOUNDATION_MYSQL_COLUMN_TYPES = Object.freeze({
  credit_evaluation_indicator: Object.freeze({
    id: 'VARCHAR(128)',
    code: 'VARCHAR(128)',
    name: 'LONGTEXT',
    indicator_kind: 'VARCHAR(128)',
    description: 'LONGTEXT',
    max_score_milli: 'BIGINT',
    input_spec_json: 'JSON',
    effective_from: 'VARCHAR(128)',
    effective_to: 'LONGTEXT',
    status: 'VARCHAR(128)',
    created_at: 'LONGTEXT',
    created_by: 'VARCHAR(128)',
  }),
  credit_evaluation_scheme: Object.freeze({
    id: 'VARCHAR(128)',
    code: 'VARCHAR(128)',
    name: 'LONGTEXT',
    grade_boundaries_json: 'JSON',
    effective_from: 'VARCHAR(128)',
    effective_to: 'LONGTEXT',
    status: 'VARCHAR(128)',
    created_at: 'LONGTEXT',
    created_by: 'VARCHAR(128)',
  }),
  credit_evaluation_model: Object.freeze({
    id: 'VARCHAR(128)',
    code: 'VARCHAR(128)',
    name: 'LONGTEXT',
    scheme_id: 'VARCHAR(128)',
    indicator_weights_json: 'JSON',
    effective_from: 'VARCHAR(128)',
    effective_to: 'LONGTEXT',
    status: 'VARCHAR(128)',
    created_at: 'LONGTEXT',
    created_by: 'VARCHAR(128)',
  }),
  credit_evaluation_scoring_sheet: Object.freeze({
    id: 'VARCHAR(128)',
    sheet_no: 'VARCHAR(128)',
    model_id: 'VARCHAR(128)',
    credit_object_type: 'VARCHAR(128)',
    credit_object_id: 'VARCHAR(128)',
    customer_id: 'VARCHAR(128)',
    profile_scope_key: 'VARCHAR(128)',
    credit_profile_id: 'VARCHAR(128)',
    business_date: 'VARCHAR(128)',
    status: 'VARCHAR(128)',
    allowed_evaluator_ids_json: 'JSON',
    sheet_data_json: 'JSON',
    evaluator_count: 'BIGINT',
    created_at: 'LONGTEXT',
    created_by: 'VARCHAR(128)',
    updated_at: 'LONGTEXT',
    updated_by: 'VARCHAR(128)',
    submitted_at: 'LONGTEXT',
    finalized_at: 'LONGTEXT',
    finalized_by: 'VARCHAR(128)',
    applied_at: 'LONGTEXT',
  }),
});

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_evaluation_indicator (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    indicator_kind TEXT NOT NULL CHECK(indicator_kind IN ('QUALITATIVE','QUANTITATIVE')),
    description TEXT NOT NULL,
    max_score_milli INTEGER NOT NULL CHECK(max_score_milli > 0),
    input_spec_json TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    CONSTRAINT uq_credit_evaluation_indicator_version UNIQUE (code, effective_from),
    CONSTRAINT ck_credit_evaluation_indicator_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_evaluation_scheme (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    grade_boundaries_json TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    CONSTRAINT uq_credit_evaluation_scheme_version UNIQUE (code, effective_from),
    CONSTRAINT ck_credit_evaluation_scheme_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_evaluation_model (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    scheme_id TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
    indicator_weights_json TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    CONSTRAINT uq_credit_evaluation_model_version UNIQUE (code, effective_from),
    CONSTRAINT ck_credit_evaluation_model_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_evaluation_scoring_sheet (
    id TEXT PRIMARY KEY NOT NULL,
    sheet_no TEXT NOT NULL,
    model_id TEXT NOT NULL REFERENCES credit_evaluation_model(id),
    credit_object_type TEXT NOT NULL,
    credit_object_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    profile_scope_key TEXT NOT NULL,
    credit_profile_id TEXT NOT NULL REFERENCES credit_profile(id),
    business_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','FINALIZED','APPLIED')),
    allowed_evaluator_ids_json TEXT NOT NULL,
    sheet_data_json TEXT NOT NULL,
    evaluator_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluator_count >= 0),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NULL,
    updated_by TEXT NULL REFERENCES users(id),
    submitted_at TEXT NULL,
    finalized_at TEXT NULL,
    finalized_by TEXT NULL REFERENCES users(id),
    applied_at TEXT NULL,
    CONSTRAINT uq_credit_evaluation_scoring_sheet_no UNIQUE (sheet_no),
    CONSTRAINT ck_credit_evaluation_scoring_sheet_dates CHECK (applied_at IS NULL OR applied_at >= created_at)
  );
`;

function mysql(db) {
  // On a fresh MySQL bootstrap these tables have already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_evaluation_indicator (
    id VARCHAR(128) NOT NULL PRIMARY KEY, code VARCHAR(128) NOT NULL, name LONGTEXT NOT NULL,
    indicator_kind VARCHAR(128) NOT NULL, description LONGTEXT NOT NULL,
    max_score_milli BIGINT NOT NULL, input_spec_json JSON NOT NULL,
    effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL,
    status VARCHAR(128) NOT NULL, created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL,
    CHECK(indicator_kind IN ('QUALITATIVE','QUANTITATIVE')),
    CHECK(max_score_milli > 0),
    CHECK(status IN ('ACTIVE','RETIRED')),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_credit_evaluation_indicator_version UNIQUE (code, effective_from),
    FOREIGN KEY(created_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_evaluation_scheme (
    id VARCHAR(128) NOT NULL PRIMARY KEY, code VARCHAR(128) NOT NULL, name LONGTEXT NOT NULL,
    grade_boundaries_json JSON NOT NULL, effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL,
    status VARCHAR(128) NOT NULL, created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL,
    CHECK(status IN ('ACTIVE','RETIRED')),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_credit_evaluation_scheme_version UNIQUE (code, effective_from),
    FOREIGN KEY(created_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_evaluation_model (
    id VARCHAR(128) NOT NULL PRIMARY KEY, code VARCHAR(128) NOT NULL, name LONGTEXT NOT NULL,
    scheme_id VARCHAR(128) NOT NULL, indicator_weights_json JSON NOT NULL,
    effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL,
    status VARCHAR(128) NOT NULL, created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL,
    CHECK(status IN ('ACTIVE','RETIRED')),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_credit_evaluation_model_version UNIQUE (code, effective_from),
    FOREIGN KEY(scheme_id) REFERENCES credit_evaluation_scheme(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_evaluation_scoring_sheet (
    id VARCHAR(128) NOT NULL PRIMARY KEY, sheet_no VARCHAR(128) NOT NULL, model_id VARCHAR(128) NOT NULL,
    credit_object_type VARCHAR(128) NOT NULL, credit_object_id VARCHAR(128) NOT NULL,
    customer_id VARCHAR(128) NOT NULL, profile_scope_key VARCHAR(128) NOT NULL,
    credit_profile_id VARCHAR(128) NOT NULL, business_date VARCHAR(128) NOT NULL,
    status VARCHAR(128) NOT NULL, allowed_evaluator_ids_json JSON NOT NULL,
    sheet_data_json JSON NOT NULL, evaluator_count BIGINT NOT NULL DEFAULT 0,
    created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL,
    updated_at LONGTEXT NULL, updated_by VARCHAR(128) NULL,
    submitted_at LONGTEXT NULL, finalized_at LONGTEXT NULL, finalized_by VARCHAR(128) NULL,
    applied_at LONGTEXT NULL,
    CHECK(status IN ('DRAFT','SUBMITTED','FINALIZED','APPLIED')),
    CHECK (evaluator_count >= 0),
    CHECK (applied_at IS NULL OR applied_at >= created_at),
    CONSTRAINT uq_credit_evaluation_scoring_sheet_no UNIQUE (sheet_no),
    FOREIGN KEY(model_id) REFERENCES credit_evaluation_model(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(credit_profile_id) REFERENCES credit_profile(id),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(updated_by) REFERENCES users(id),
    FOREIGN KEY(finalized_by) REFERENCES users(id)
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
  credit_evaluation_indicator: {
    columns: ['id', 'code', 'name', 'indicator_kind', 'description', 'max_score_milli', 'input_spec_json',
      'effective_from', 'effective_to', 'status', 'created_at', 'created_by'],
    pk: ['id'],
    fks: [['created_by', 'users']],
    checks: 4,
  },
  credit_evaluation_scheme: {
    columns: ['id', 'code', 'name', 'grade_boundaries_json', 'effective_from', 'effective_to', 'status',
      'created_at', 'created_by'],
    pk: ['id'],
    fks: [['created_by', 'users']],
    checks: 2,
  },
  credit_evaluation_model: {
    columns: ['id', 'code', 'name', 'scheme_id', 'indicator_weights_json', 'effective_from', 'effective_to',
      'status', 'created_at', 'created_by'],
    pk: ['id'],
    fks: [['scheme_id', 'credit_evaluation_scheme'], ['created_by', 'users']],
    checks: 2,
  },
  credit_evaluation_scoring_sheet: {
    columns: ['id', 'sheet_no', 'model_id', 'credit_object_type', 'credit_object_id', 'customer_id',
      'profile_scope_key', 'credit_profile_id', 'business_date', 'status', 'allowed_evaluator_ids_json',
      'sheet_data_json', 'evaluator_count', 'created_at', 'created_by', 'updated_at', 'updated_by',
      'submitted_at', 'finalized_at', 'finalized_by', 'applied_at'],
    pk: ['id'],
    fks: [['model_id', 'credit_evaluation_model'], ['customer_id', 'customers'],
      ['credit_profile_id', 'credit_profile'], ['created_by', 'users'], ['updated_by', 'users'],
      ['finalized_by', 'users']],
    checks: 3,
  },
});

// Nullable / non-nullable parity that the design depends on. The scoring
// sheet's lifecycle markers stay nullable so a DRAFT sheet can carry no
// submission, finalization or application timestamp, and the evaluation
// result table can carry an applied profile only together with its actor.
const NULLABILITY = Object.freeze([
  ['credit_evaluation_indicator', 'effective_to', 'YES'],
  ['credit_evaluation_indicator', 'created_by', 'NO'],
  ['credit_evaluation_scheme', 'effective_to', 'YES'],
  ['credit_evaluation_model', 'effective_to', 'YES'],
  ['credit_evaluation_scoring_sheet', 'updated_at', 'YES'],
  ['credit_evaluation_scoring_sheet', 'updated_by', 'YES'],
  ['credit_evaluation_scoring_sheet', 'submitted_at', 'YES'],
  ['credit_evaluation_scoring_sheet', 'finalized_at', 'YES'],
  ['credit_evaluation_scoring_sheet', 'finalized_by', 'YES'],
  ['credit_evaluation_scoring_sheet', 'applied_at', 'YES'],
  ['credit_evaluation_scoring_sheet', 'evaluator_count', 'NO'],
]);

// Indexed / constrained columns whose physical type must agree across engines.
const PHYSICAL_TYPES = Object.freeze([
  ['credit_evaluation_indicator', 'id', 'varchar', 128],
  ['credit_evaluation_indicator', 'code', 'varchar', 128],
  ['credit_evaluation_indicator', 'max_score_milli', 'bigint', null],
  ['credit_evaluation_indicator', 'input_spec_json', 'json', null],
  ['credit_evaluation_indicator', 'created_by', 'varchar', 128],
  ['credit_evaluation_scheme', 'id', 'varchar', 128],
  ['credit_evaluation_scheme', 'code', 'varchar', 128],
  ['credit_evaluation_scheme', 'grade_boundaries_json', 'json', null],
  ['credit_evaluation_scheme', 'created_by', 'varchar', 128],
  ['credit_evaluation_model', 'id', 'varchar', 128],
  ['credit_evaluation_model', 'code', 'varchar', 128],
  ['credit_evaluation_model', 'scheme_id', 'varchar', 128],
  ['credit_evaluation_model', 'indicator_weights_json', 'json', null],
  ['credit_evaluation_model', 'created_by', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'id', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'sheet_no', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'model_id', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'customer_id', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'profile_scope_key', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'credit_profile_id', 'varchar', 128],
  ['credit_evaluation_scoring_sheet', 'allowed_evaluator_ids_json', 'json', null],
  ['credit_evaluation_scoring_sheet', 'sheet_data_json', 'json', null],
  ['credit_evaluation_scoring_sheet', 'evaluator_count', 'bigint', null],
]);

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 11-B evaluation foundation schema conflict: ${message}`); }

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
  for (const constraint of WAVE11_EVALUATION_FOUNDATION_UNIQUE_CONSTRAINTS) {
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
  for (const constraint of WAVE11_EVALUATION_FOUNDATION_UNIQUE_CONSTRAINTS) {
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
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
      ('credit_evaluation_indicator','credit_evaluation_scheme','credit_evaluation_model','credit_evaluation_scoring_sheet')`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  for (const [table, column, expected] of NULLABILITY) {
    if (nullable.get(`${table}.${column}`) !== expected) conflict(`${table}.${column} nullability drifted`);
  }
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
        ('credit_evaluation_indicator','credit_evaluation_scheme','credit_evaluation_model','credit_evaluation_scoring_sheet')`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  for (const [table, column, type, length] of PHYSICAL_TYPES) {
    const actual = physical.get(`${table}.${column}`);
    if (!actual || actual[0] !== type || (length != null && actual[1] !== length)) conflict(`${table}.${column} physical type drifted`);
  }
}

export function migrateSalesCustomerWave11CreditEvaluationFoundation(db) {
  if (!db) throw new Error('migrateSalesCustomerWave11CreditEvaluationFoundation: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
}
