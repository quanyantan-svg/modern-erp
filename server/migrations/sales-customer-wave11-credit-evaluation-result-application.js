// Sales & Customer Wave 11-C — Credit Evaluation Result + deferred FK.
//
// solution.md §37.54.10 (W11-C) and §37.54.12.1 / §37.54.12.2 / §37.54.12.3.
//
// ONE new table plus ONE deferred foreign key:
//
//   credit_evaluation_result                            -> the single aggregate
//   credit_profile_ratings.evaluation_result_id         -> deferred FK
//
// The deferred foreign key is the §37.54.10.7 / §37.54.10.8 enablement of the
// `EVALUATED` branch of the frozen Wave 9 CHECK on `credit_profile_ratings`.
// The Wave 9 CHECK itself is NOT modified, NOT relaxed and NOT extended: the
// `EVALUATED` branch is satisfied BY CONSTRUCTION because the single rating
// writer `applyCreditRating()` writes `evaluation_result_id` non-null and
// equal to `rating_source_key`.
//
// ROW-PRESERVING COMPATIBILITY EXTENSION. Adding the foreign key is a
// COMPATIBILITY schema extension of a frozen table, not a "no change at all"
// claim: SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so the table is
// rebuilt (new table -> copy -> drop -> rename -> recreate the unique index).
// The column set, both CHECK constraints and every existing row stay
// equivalent; only one named FK constraint is added.
//
// PRE-CONDITION ASSERTION. `credit_profile_ratings` must not contain a
// single row with a non-null `evaluation_result_id` before the FK is added.
// Wave 9 / Wave 10 never wrote an `EVALUATED` row. If the count is not 0 the
// migration ABORTS and reports; it never migrates, fabricates or clears rows.
//
// POST-CONDITION ASSERTION. Every row with a non-null `evaluation_result_id`
// must resolve to an existing `credit_evaluation_result` row.
//
// IDEMPOTENCY. The SQLite rebuild is skipped when the new FK is already
// present, so a repeated full replay is a verified no-op. The MySQL
// `ALTER TABLE ... ADD CONSTRAINT` is skipped when the constraint already
// exists.

export const SALES_WAVE11_EVALUATION_RESULT_TABLES = Object.freeze([
  'credit_evaluation_result',
]);

export const DEFERRED_EVALUATION_RESULT_FK = Object.freeze('fk_credit_profile_ratings_evaluation_result');

const INDEXES = Object.freeze([
  { table: 'credit_evaluation_result', name: 'ix_credit_evaluation_result_profile', columns: ['credit_profile_id'] },
  { table: 'credit_evaluation_result', name: 'ix_credit_evaluation_result_model', columns: ['model_id'] },
  { table: 'credit_evaluation_result', name: 'ix_credit_evaluation_result_business_date', columns: ['business_date'] },
]);

export const WAVE11_EVALUATION_RESULT_UNIQUE_CONSTRAINTS = Object.freeze([
  { table: 'credit_evaluation_result', name: 'uq_credit_evaluation_result_sheet', columns: ['sheet_id'] },
]);

// The approved physical type of every column of the result table.
export const WAVE11_EVALUATION_RESULT_MYSQL_COLUMN_TYPES = Object.freeze({
  credit_evaluation_result: Object.freeze({
    id: 'VARCHAR(128)',
    sheet_id: 'VARCHAR(128)',
    model_id: 'VARCHAR(128)',
    scheme_id: 'VARCHAR(128)',
    credit_profile_id: 'VARCHAR(128)',
    profile_effective_state_hash: 'VARCHAR(64)',
    policy_snapshot_fingerprint: 'VARCHAR(128)',
    business_date: 'VARCHAR(128)',
    total_score_milli: 'BIGINT',
    max_score_milli: 'BIGINT',
    rating_grade: 'VARCHAR(128)',
    evaluator_count: 'BIGINT',
    created_at: 'LONGTEXT',
    created_by: 'VARCHAR(128)',
    applied_to_profile_id: 'VARCHAR(128)',
    applied_at: 'LONGTEXT',
    applied_by: 'VARCHAR(128)',
  }),
});

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_evaluation_result (
    id TEXT PRIMARY KEY NOT NULL,
    sheet_id TEXT NOT NULL REFERENCES credit_evaluation_scoring_sheet(id),
    model_id TEXT NOT NULL REFERENCES credit_evaluation_model(id),
    scheme_id TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
    credit_profile_id TEXT NOT NULL REFERENCES credit_profile(id),
    profile_effective_state_hash TEXT NOT NULL,
    policy_snapshot_fingerprint TEXT NOT NULL,
    business_date TEXT NOT NULL,
    total_score_milli INTEGER NOT NULL CHECK(total_score_milli >= 0),
    max_score_milli INTEGER NOT NULL CHECK(max_score_milli >= 0),
    rating_grade TEXT NOT NULL,
    evaluator_count INTEGER NOT NULL CHECK(evaluator_count > 0),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    applied_to_profile_id TEXT NULL REFERENCES credit_profile(id),
    applied_at TEXT NULL,
    applied_by TEXT NULL REFERENCES users(id),
    CONSTRAINT uq_credit_evaluation_result_sheet UNIQUE (sheet_id),
    CONSTRAINT ck_credit_evaluation_result_application CHECK (
      (applied_to_profile_id IS NULL AND applied_at IS NULL AND applied_by IS NULL)
      OR (applied_to_profile_id IS NOT NULL AND applied_at IS NOT NULL AND applied_by IS NOT NULL)
    ),
    CONSTRAINT ck_credit_evaluation_result_target CHECK (applied_to_profile_id IS NULL OR applied_to_profile_id = credit_profile_id)
  );
`;

// The row-preserving SQLite rebuild of `credit_profile_ratings`. The new
// table is column-identical to the Wave 9 table plus the single deferred FK;
// both Wave 9 CHECK constraints are reproduced verbatim.
const SQLITE_RATINGS_REBUILD = `
  CREATE TABLE credit_profile_ratings_new (
    id TEXT PRIMARY KEY NOT NULL,
    credit_profile_id TEXT NOT NULL REFERENCES credit_profile(id),
    rating_source_type TEXT NOT NULL CHECK(rating_source_type IN ('INITIAL_ASSIGNED','EVALUATED')),
    rating_source_key TEXT NOT NULL,
    evaluation_result_id TEXT,
    rating_grade TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    applied_by TEXT NOT NULL REFERENCES users(id),
    superseded_at TEXT,
    CHECK((rating_source_type='INITIAL_ASSIGNED' AND rating_source_key='INITIAL_ASSIGNED' AND evaluation_result_id IS NULL) OR (rating_source_type='EVALUATED' AND evaluation_result_id IS NOT NULL AND rating_source_key=evaluation_result_id)),
    CHECK(superseded_at IS NULL OR superseded_at>=applied_at),
    CONSTRAINT fk_credit_profile_ratings_evaluation_result FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)
  );
  INSERT INTO credit_profile_ratings_new(id,credit_profile_id,rating_source_type,rating_source_key,
    evaluation_result_id,rating_grade,applied_at,applied_by,superseded_at)
    SELECT id,credit_profile_id,rating_source_type,rating_source_key,
      evaluation_result_id,rating_grade,applied_at,applied_by,superseded_at FROM credit_profile_ratings;
  DROP TABLE credit_profile_ratings;
  ALTER TABLE credit_profile_ratings_new RENAME TO credit_profile_ratings;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_profile_ratings_application
    ON credit_profile_ratings(credit_profile_id, rating_source_key);
`;

function mysql(db) {
  // On a fresh MySQL bootstrap this table has already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_evaluation_result (
    id VARCHAR(128) NOT NULL PRIMARY KEY, sheet_id VARCHAR(128) NOT NULL,
    model_id VARCHAR(128) NOT NULL, scheme_id VARCHAR(128) NOT NULL,
    credit_profile_id VARCHAR(128) NOT NULL, profile_effective_state_hash VARCHAR(64) NOT NULL,
    policy_snapshot_fingerprint VARCHAR(128) NOT NULL, business_date VARCHAR(128) NOT NULL,
    total_score_milli BIGINT NOT NULL, max_score_milli BIGINT NOT NULL,
    rating_grade VARCHAR(128) NOT NULL, evaluator_count BIGINT NOT NULL,
    created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NOT NULL,
    applied_to_profile_id VARCHAR(128) NULL, applied_at LONGTEXT NULL, applied_by VARCHAR(128) NULL,
    CHECK(total_score_milli >= 0),
    CHECK(max_score_milli >= 0),
    CHECK(evaluator_count > 0),
    CHECK (
      (applied_to_profile_id IS NULL AND applied_at IS NULL AND applied_by IS NULL)
      OR (applied_to_profile_id IS NOT NULL AND applied_at IS NOT NULL AND applied_by IS NOT NULL)
    ),
    CHECK (applied_to_profile_id IS NULL OR applied_to_profile_id = credit_profile_id),
    CONSTRAINT uq_credit_evaluation_result_sheet UNIQUE (sheet_id),
    FOREIGN KEY(sheet_id) REFERENCES credit_evaluation_scoring_sheet(id),
    FOREIGN KEY(model_id) REFERENCES credit_evaluation_model(id),
    FOREIGN KEY(scheme_id) REFERENCES credit_evaluation_scheme(id),
    FOREIGN KEY(credit_profile_id) REFERENCES credit_profile(id),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(applied_to_profile_id) REFERENCES credit_profile(id),
    FOREIGN KEY(applied_by) REFERENCES users(id)
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

// §37.54.10.8 — the FK pre-condition. It is asserted OUTSIDE any repair
// path: a non-zero count aborts the migration instead of migrating,
// fabricating or clearing rows.
function assertNoOrphanEvaluationRatings(db) {
  const row = db.prepare('SELECT COUNT(*) count FROM credit_profile_ratings WHERE evaluation_result_id IS NOT NULL').get();
  const count = Number(row?.count || 0);
  if (count !== 0) {
    throw new Error(
      `Wave 11-C deferred FK pre-condition failed: credit_profile_ratings carries ${count} row(s) with a non-null `
      + 'evaluation_result_id. The migration ABORTS without migrating, fabricating or clearing any row.',
    );
  }
  return count;
}

// §37.54.10.8 — the FK post-condition. Every referenced row must resolve.
function assertEvaluationRatingsResolve(db) {
  const row = db.prepare(`SELECT COUNT(*) count FROM credit_profile_ratings r
    WHERE r.evaluation_result_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM credit_evaluation_result e WHERE e.id = r.evaluation_result_id)`).get();
  const count = Number(row?.count || 0);
  if (count !== 0) {
    throw new Error(`Wave 11-C deferred FK post-condition failed: ${count} credit_profile_ratings row(s) reference a missing credit_evaluation_result.`);
  }
  return count;
}

function sqliteDeferredForeignKeyPresent(db) {
  const fks = db.prepare('PRAGMA foreign_key_list(credit_profile_ratings)').all();
  return fks.some((row) => row.table === 'credit_evaluation_result' && row.from === 'evaluation_result_id');
}

function sqliteAddDeferredForeignKey(db) {
  if (sqliteDeferredForeignKeyPresent(db)) return false;
  assertNoOrphanEvaluationRatings(db);
  // The rebuild copies rows 1:1. `PRAGMA foreign_keys` cannot be toggled
  // inside a transaction, so the migration runs outside one and the rebuild
  // itself keeps every row.
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec(SQLITE_RATINGS_REBUILD);
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
  return true;
}

// The deferred foreign key, located by WHAT IT REFERENCES rather than by its
// name.
//
// The SQLite snapshot's MySQL DDL carries every foreign key WITHOUT its
// constraint name, so MySQL auto-names it (`credit_profile_ratings_ibfk_N`).
// Looking the constraint up by name alone therefore misses it on a
// snapshot-bootstrapped database, and adding the named constraint on top would
// leave the table with TWO foreign keys on the same column — which the frozen
// Wave 9 foreign-key-set assertion then (correctly) refuses.
//
// The named constraint is the one the contract asserts, so an existing
// unnamed equivalent is dropped and re-added under the canonical name. The
// table therefore ends with exactly ONE deferred foreign key, always named.
function mysqlDeferredForeignKeyRow(db) {
  return db.prepare(`SELECT CONSTRAINT_NAME constraint_name FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_profile_ratings'
      AND COLUMN_NAME='evaluation_result_id' AND REFERENCED_TABLE_NAME='credit_evaluation_result'
      AND REFERENCED_COLUMN_NAME='id' LIMIT 1`).get();
}

function mysqlAddDeferredForeignKey(db) {
  const existing = mysqlDeferredForeignKeyRow(db);
  if (existing && existing.constraint_name === DEFERRED_EVALUATION_RESULT_FK) return false;
  if (existing) {
    db.exec(`ALTER TABLE credit_profile_ratings DROP FOREIGN KEY ${existing.constraint_name}`);
  }
  assertNoOrphanEvaluationRatings(db);
  db.exec(`ALTER TABLE credit_profile_ratings ADD CONSTRAINT ${DEFERRED_EVALUATION_RESULT_FK}
    FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)`);
  return true;
}

const CONTRACTS = Object.freeze({
  credit_evaluation_result: {
    columns: ['id', 'sheet_id', 'model_id', 'scheme_id', 'credit_profile_id', 'profile_effective_state_hash',
      'policy_snapshot_fingerprint', 'business_date', 'total_score_milli', 'max_score_milli', 'rating_grade',
      'evaluator_count', 'created_at', 'created_by', 'applied_to_profile_id', 'applied_at', 'applied_by'],
    pk: ['id'],
    fks: [['sheet_id', 'credit_evaluation_scoring_sheet'], ['model_id', 'credit_evaluation_model'],
      ['scheme_id', 'credit_evaluation_scheme'], ['credit_profile_id', 'credit_profile'],
      ['created_by', 'users'], ['applied_to_profile_id', 'credit_profile'], ['applied_by', 'users']],
    checks: 5,
  },
});

const NULLABILITY = Object.freeze([
  ['credit_evaluation_result', 'applied_to_profile_id', 'YES'],
  ['credit_evaluation_result', 'applied_at', 'YES'],
  ['credit_evaluation_result', 'applied_by', 'YES'],
  ['credit_evaluation_result', 'evaluator_count', 'NO'],
  ['credit_evaluation_result', 'total_score_milli', 'NO'],
  ['credit_evaluation_result', 'max_score_milli', 'NO'],
]);

// The physical type assertion is DERIVED from the pinned type map above, so
// the map, the hand-written MySQL DDL and the assertion can never be three
// different facts. A hand-maintained third copy of the same list is exactly
// how the snapshot path and the live path drift apart.
const PHYSICAL_TYPES = Object.freeze(
  Object.entries(WAVE11_EVALUATION_RESULT_MYSQL_COLUMN_TYPES).flatMap(([table, columns]) => Object.entries(columns).map(([column, type]) => {
    const sized = /^VARCHAR\((\d+)\)$/i.exec(String(type));
    return sized
      ? [table, column, 'varchar', Number(sized[1])]
      : [table, column, String(type).toLowerCase(), null];
  })),
);

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 11-C evaluation result schema conflict: ${message}`); }

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
  for (const constraint of WAVE11_EVALUATION_RESULT_UNIQUE_CONSTRAINTS) {
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
  // The rebuilt `credit_profile_ratings` must keep the Wave 9 unique index.
  const ratingUnique = db.prepare(`PRAGMA index_list(credit_profile_ratings)`).all().find((item) => item.name === 'uq_credit_profile_ratings_application');
  if (!ratingUnique || !Boolean(ratingUnique.unique)) conflict('uq_credit_profile_ratings_application index drifted');
  const ratingColumns = db.prepare('PRAGMA index_info(uq_credit_profile_ratings_application)').all()
    .sort((a, b) => a.seqno - b.seqno).map((item) => item.name);
  if (!same(ratingColumns, ['credit_profile_id', 'rating_source_key'])) conflict('uq_credit_profile_ratings_application columns drifted');
  // The deferred FK must be present after the migration.
  if (!sqliteDeferredForeignKeyPresent(db)) conflict('fk_credit_profile_ratings_evaluation_result is missing');
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
  for (const constraint of WAVE11_EVALUATION_RESULT_UNIQUE_CONSTRAINTS) {
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
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_evaluation_result'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  for (const [table, column, expected] of NULLABILITY) {
    if (nullable.get(`${table}.${column}`) !== expected) conflict(`${table}.${column} nullability drifted`);
  }
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_evaluation_result'`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  for (const [table, column, type, length] of PHYSICAL_TYPES) {
    const actual = physical.get(`${table}.${column}`);
    if (!actual || actual[0] !== type || (length != null && actual[1] !== length)) conflict(`${table}.${column} physical type drifted`);
  }
  // The deferred FK must be present after the migration.
  const fk = db.prepare(`SELECT 1 present FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_profile_ratings' AND CONSTRAINT_NAME=? LIMIT 1`)
    .get(DEFERRED_EVALUATION_RESULT_FK);
  if (!fk) conflict('fk_credit_profile_ratings_evaluation_result is missing');
}

export function migrateSalesCustomerWave11CreditEvaluationResultApplication(db) {
  if (!db) throw new Error('migrateSalesCustomerWave11CreditEvaluationResultApplication: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') mysqlAddDeferredForeignKey(db); else sqliteAddDeferredForeignKey(db);
  assertEvaluationRatingsResolve(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
}
