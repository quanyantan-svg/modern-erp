// Sales & Customer Wave 9 — Credit foundation.
// Exactly six additive tables. No historical Sales or Finance row is rewritten.

import { mysqlIndexColumnList } from '../database/mysql-schema.js';

export const SALES_WAVE9_TABLES = Object.freeze([
  'credit_lock_anchors',
  'credit_parameters',
  'credit_check_rules',
  'credit_profile',
  'credit_policy_snapshots',
  'credit_profile_ratings',
]);

const INDEXES = Object.freeze([
  { table: 'credit_lock_anchors', name: 'uq_credit_lock_anchors_anchor_key', columns: ['anchor_key'], unique: true },
  { table: 'credit_lock_anchors', name: 'ix_credit_lock_anchors_lookup', columns: ['anchor_type', 'customer_id', 'credit_object_type', 'credit_object_id'] },
  { table: 'credit_parameters', name: 'uq_credit_parameters_version', columns: ['code', 'effective_from'], unique: true },
  { table: 'credit_parameters', name: 'ix_credit_parameters_code_date', columns: ['code', 'effective_from'] },
  { table: 'credit_check_rules', name: 'uq_credit_check_rules_version', columns: ['rule_code', 'effective_from'], unique: true },
  { table: 'credit_check_rules', name: 'ix_credit_check_rules_stage_date', columns: ['business_stage', 'effective_from'] },
  { table: 'credit_profile', name: 'uq_credit_profile_scope_version', columns: ['anchor_id', 'effective_from'], unique: true },
  { table: 'credit_profile', name: 'ix_credit_profile_customer_scope', columns: ['customer_id', 'salesperson_scope_key', 'effective_from'] },
  { table: 'credit_policy_snapshots', name: 'uq_credit_policy_snapshots_identity', columns: ['credit_lock_anchor_id', 'business_date', 'snapshot_fingerprint'], unique: true },
  { table: 'credit_profile_ratings', name: 'uq_credit_profile_ratings_application', columns: ['credit_profile_id', 'rating_source_key'], unique: true },
]);

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS credit_lock_anchors (
    id TEXT PRIMARY KEY NOT NULL,
    anchor_key TEXT NOT NULL,
    anchor_type TEXT NOT NULL CHECK(anchor_type IN ('CREDIT_OBJECT','POLICY_SCOPE')),
    customer_id TEXT REFERENCES customers(id),
    salesperson_id TEXT REFERENCES salesperson_profiles(id),
    credit_object_type TEXT,
    credit_object_id TEXT,
    policy_scope_type TEXT,
    policy_scope_id TEXT,
    created_at TEXT NOT NULL,
    CHECK(
      (anchor_type='CREDIT_OBJECT' AND customer_id IS NOT NULL AND credit_object_type IS NOT NULL AND credit_object_id IS NOT NULL AND policy_scope_type IS NULL AND policy_scope_id IS NULL)
      OR
      (anchor_type='POLICY_SCOPE' AND policy_scope_type IS NOT NULL AND policy_scope_id IS NOT NULL AND customer_id IS NULL AND salesperson_id IS NULL AND credit_object_type IS NULL AND credit_object_id IS NULL)
    )
  );
  CREATE TABLE IF NOT EXISTS credit_parameters (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    value_text TEXT,
    value_int BIGINT,
    value_bool INTEGER,
    value_date TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','INACTIVE')),
    created_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    superseded_by_id TEXT REFERENCES credit_parameters(id),
    CHECK(effective_to IS NULL OR effective_to>=effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_check_rules (
    id TEXT PRIMARY KEY NOT NULL,
    rule_code TEXT NOT NULL,
    business_stage TEXT NOT NULL CHECK(business_stage IN ('SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM')),
    scenario TEXT NOT NULL CHECK(scenario IN ('STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK')),
    check_timing TEXT NOT NULL CHECK(check_timing IN ('BEFORE_WRITE','AFTER_WRITE_DEFERRED')),
    control_strength TEXT NOT NULL CHECK(control_strength IN ('WARNING','BLOCK')),
    credit_item TEXT NOT NULL,
    recognition_mode TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL,
    result_payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    CHECK(effective_to IS NULL OR effective_to>=effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_profile (
    id TEXT PRIMARY KEY NOT NULL,
    anchor_id TEXT NOT NULL REFERENCES credit_lock_anchors(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    salesperson_scope_key TEXT NOT NULL,
    salesperson_id TEXT REFERENCES salesperson_profiles(id),
    credit_object_type TEXT NOT NULL,
    credit_object_id TEXT NOT NULL,
    credit_limit_cents BIGINT,
    initial_state TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED')),
    rating_grade TEXT,
    rating_effective_from TEXT,
    rating_effective_to TEXT,
    overdue_day_policy TEXT,
    rule_id TEXT REFERENCES credit_check_rules(id),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    CHECK((salesperson_scope_key='*' AND salesperson_id IS NULL) OR (salesperson_scope_key<>'*' AND salesperson_id IS NOT NULL AND salesperson_scope_key=salesperson_id)),
    CHECK(effective_to IS NULL OR effective_to>=effective_from)
  );
  CREATE TABLE IF NOT EXISTS credit_policy_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    credit_lock_anchor_id TEXT NOT NULL REFERENCES credit_lock_anchors(id),
    scope_type TEXT NOT NULL CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    credit_profile_id TEXT REFERENCES credit_profile(id),
    snapshot_fingerprint TEXT NOT NULL,
    business_date TEXT NOT NULL,
    parameter_set_hash TEXT NOT NULL,
    rule_set_hash TEXT NOT NULL,
    profile_effective_state_hash TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    captured_by TEXT REFERENCES users(id),
    notes_json TEXT
  );
  CREATE TABLE IF NOT EXISTS credit_profile_ratings (
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
    CHECK(superseded_at IS NULL OR superseded_at>=applied_at)
  );
`;

function createIndexes(db) {
  for (const index of INDEXES) {
    if (db.dialect === 'mysql') {
      const found = db.prepare(`SELECT 1 present FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`).get(index.table, index.name);
      if (!found) db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${index.name} ON ${index.table} (${mysqlIndexColumnList(index.table, index)})`);
    } else {
      db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns.join(',')})`);
    }
  }
}

function mysql(db) {
  // On fresh MySQL bootstrap these tables have already been materialized from
  // the canonical SQLite snapshot. This block is the live-upgrade path.
  db.exec(`CREATE TABLE IF NOT EXISTS credit_lock_anchors (
    id VARCHAR(128) NOT NULL PRIMARY KEY, anchor_key VARCHAR(512) NOT NULL,
    anchor_type VARCHAR(128) NOT NULL, customer_id VARCHAR(128) NULL,
    salesperson_id VARCHAR(128) NULL, credit_object_type VARCHAR(128) NULL,
    credit_object_id VARCHAR(128) NULL, policy_scope_type LONGTEXT NULL,
    policy_scope_id LONGTEXT NULL, created_at LONGTEXT NOT NULL,
    CHECK(anchor_type IN ('CREDIT_OBJECT','POLICY_SCOPE')),
    CHECK((anchor_type='CREDIT_OBJECT' AND customer_id IS NOT NULL AND credit_object_type IS NOT NULL AND credit_object_id IS NOT NULL AND policy_scope_type IS NULL AND policy_scope_id IS NULL) OR (anchor_type='POLICY_SCOPE' AND policy_scope_type IS NOT NULL AND policy_scope_id IS NOT NULL AND customer_id IS NULL AND salesperson_id IS NULL AND credit_object_type IS NULL AND credit_object_id IS NULL)),
    FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(salesperson_id) REFERENCES salesperson_profiles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_parameters (
    id VARCHAR(128) NOT NULL PRIMARY KEY, code VARCHAR(128) NOT NULL, value_text LONGTEXT NULL,
    value_int BIGINT NULL, value_bool BIGINT NULL, value_date LONGTEXT NULL,
    effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL, status LONGTEXT NOT NULL,
    created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NULL, superseded_by_id VARCHAR(128) NULL,
    CHECK(status IN ('DRAFT','ACTIVE','INACTIVE')), CHECK(effective_to IS NULL OR effective_to>=effective_from),
    FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(superseded_by_id) REFERENCES credit_parameters(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_check_rules (
    id VARCHAR(128) NOT NULL PRIMARY KEY, rule_code VARCHAR(128) NOT NULL,
    business_stage VARCHAR(128) NOT NULL, scenario LONGTEXT NOT NULL, check_timing LONGTEXT NOT NULL,
    control_strength LONGTEXT NOT NULL, credit_item LONGTEXT NOT NULL, recognition_mode LONGTEXT NULL,
    effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL, status LONGTEXT NOT NULL,
    result_payload_json JSON NOT NULL, created_at LONGTEXT NOT NULL, created_by VARCHAR(128) NULL,
    CHECK(business_stage IN ('SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM')),
    CHECK(scenario IN ('STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK')),
    CHECK(check_timing IN ('BEFORE_WRITE','AFTER_WRITE_DEFERRED')),
    CHECK(control_strength IN ('WARNING','BLOCK')),
    CHECK(effective_to IS NULL OR effective_to>=effective_from), FOREIGN KEY(created_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_profile (
    id VARCHAR(128) NOT NULL PRIMARY KEY, anchor_id VARCHAR(128) NOT NULL,
    customer_id VARCHAR(128) NOT NULL, salesperson_scope_key VARCHAR(128) NOT NULL,
    salesperson_id VARCHAR(128) NULL, credit_object_type LONGTEXT NOT NULL,
    credit_object_id VARCHAR(128) NOT NULL, credit_limit_cents BIGINT NULL,
    initial_state LONGTEXT NOT NULL, status LONGTEXT NOT NULL, rating_grade LONGTEXT NULL,
    rating_effective_from LONGTEXT NULL, rating_effective_to LONGTEXT NULL,
    overdue_day_policy LONGTEXT NULL, rule_id VARCHAR(128) NULL,
    effective_from VARCHAR(128) NOT NULL, effective_to LONGTEXT NULL, created_at LONGTEXT NOT NULL,
    created_by VARCHAR(128) NULL, CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED')),
    CHECK((salesperson_scope_key='*' AND salesperson_id IS NULL) OR (salesperson_scope_key<>'*' AND salesperson_id IS NOT NULL AND salesperson_scope_key=salesperson_id)),
    CHECK(effective_to IS NULL OR effective_to>=effective_from),
    FOREIGN KEY(anchor_id) REFERENCES credit_lock_anchors(id), FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(salesperson_id) REFERENCES salesperson_profiles(id), FOREIGN KEY(rule_id) REFERENCES credit_check_rules(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_policy_snapshots (
    id VARCHAR(128) NOT NULL PRIMARY KEY, credit_lock_anchor_id VARCHAR(128) NOT NULL,
    scope_type LONGTEXT NOT NULL, credit_profile_id VARCHAR(128) NULL,
    snapshot_fingerprint VARCHAR(128) NOT NULL, business_date VARCHAR(128) NOT NULL,
    parameter_set_hash LONGTEXT NOT NULL, rule_set_hash LONGTEXT NOT NULL,
    profile_effective_state_hash LONGTEXT NOT NULL, captured_at LONGTEXT NOT NULL,
    captured_by VARCHAR(128) NULL, notes_json JSON NULL,
    CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
    FOREIGN KEY(credit_lock_anchor_id) REFERENCES credit_lock_anchors(id),
    FOREIGN KEY(credit_profile_id) REFERENCES credit_profile(id), FOREIGN KEY(captured_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  db.exec(`CREATE TABLE IF NOT EXISTS credit_profile_ratings (
    id VARCHAR(128) NOT NULL PRIMARY KEY, credit_profile_id VARCHAR(128) NOT NULL,
    rating_source_type LONGTEXT NOT NULL, rating_source_key VARCHAR(128) NOT NULL,
    evaluation_result_id VARCHAR(128) NULL, rating_grade LONGTEXT NOT NULL,
    applied_at LONGTEXT NOT NULL, applied_by VARCHAR(128) NOT NULL, superseded_at LONGTEXT NULL,
    CHECK(rating_source_type IN ('INITIAL_ASSIGNED','EVALUATED')),
    CHECK((rating_source_type='INITIAL_ASSIGNED' AND rating_source_key='INITIAL_ASSIGNED' AND evaluation_result_id IS NULL) OR (rating_source_type='EVALUATED' AND evaluation_result_id IS NOT NULL AND rating_source_key=evaluation_result_id)),
    CHECK(superseded_at IS NULL OR superseded_at>=applied_at),
    FOREIGN KEY(credit_profile_id) REFERENCES credit_profile(id), FOREIGN KEY(applied_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

const CONTRACTS = Object.freeze({
  credit_lock_anchors: { columns: ['id','anchor_key','anchor_type','customer_id','salesperson_id','credit_object_type','credit_object_id','policy_scope_type','policy_scope_id','created_at'], pk: ['id'], fks: [['customer_id','customers'],['salesperson_id','salesperson_profiles']], checks: 2 },
  credit_parameters: { columns: ['id','code','value_text','value_int','value_bool','value_date','effective_from','effective_to','status','created_at','created_by','superseded_by_id'], pk: ['id'], fks: [['created_by','users'],['superseded_by_id','credit_parameters']], checks: 2 },
  credit_check_rules: { columns: ['id','rule_code','business_stage','scenario','check_timing','control_strength','credit_item','recognition_mode','effective_from','effective_to','status','result_payload_json','created_at','created_by'], pk: ['id'], fks: [['created_by','users']], checks: 5 },
  credit_profile: { columns: ['id','anchor_id','customer_id','salesperson_scope_key','salesperson_id','credit_object_type','credit_object_id','credit_limit_cents','initial_state','status','rating_grade','rating_effective_from','rating_effective_to','overdue_day_policy','rule_id','effective_from','effective_to','created_at','created_by'], pk: ['id'], fks: [['anchor_id','credit_lock_anchors'],['customer_id','customers'],['salesperson_id','salesperson_profiles'],['rule_id','credit_check_rules'],['created_by','users']], checks: 3 },
  credit_policy_snapshots: { columns: ['id','credit_lock_anchor_id','scope_type','credit_profile_id','snapshot_fingerprint','business_date','parameter_set_hash','rule_set_hash','profile_effective_state_hash','captured_at','captured_by','notes_json'], pk: ['id'], fks: [['credit_lock_anchor_id','credit_lock_anchors'],['credit_profile_id','credit_profile'],['captured_by','users']], checks: 1 },
  credit_profile_ratings: { columns: ['id','credit_profile_id','rating_source_type','rating_source_key','evaluation_result_id','rating_grade','applied_at','applied_by','superseded_at'], pk: ['id'], fks: [['credit_profile_id','credit_profile'],['applied_by','users']], checks: 3 },
});

// WAVE9_ADDITIVE_SCHEMA_COMPATIBILITY_EXCEPTION
//
// Wave 9 still owns the exact nineteen-column Credit Profile base contract.
// U3 Search Semantics may append only this exact ordered suffix. Zero, one or
// two suffix columns are accepted so a non-transactional additive migration
// can resume from V0/V1/V2; no other table receives an additive exception.
const CREDIT_PROFILE_APPROVED_ADDITIVE_SUFFIX = Object.freeze([
  'credit_object_type_search_key',
  'credit_object_id_search_key',
]);

function same(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
function conflict(message) { throw new Error(`Wave 9 schema conflict: ${message}`); }

function matchesWave9ColumnIdentity(table, actual, base) {
  if (table !== 'credit_profile') return same(actual, base);
  if (actual.length < base.length || actual.length > base.length + CREDIT_PROFILE_APPROVED_ADDITIVE_SUFFIX.length) {
    return false;
  }
  if (!same(actual.slice(0, base.length), base)) return false;
  const suffix = actual.slice(base.length);
  return same(suffix, CREDIT_PROFILE_APPROVED_ADDITIVE_SUFFIX.slice(0, suffix.length));
}

function assertSqlite(db) {
  for (const [table, contract] of Object.entries(CONTRACTS)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!matchesWave9ColumnIdentity(table, columns.map((row) => row.name), contract.columns)) conflict(`${table} column identity/order drifted`);
    if (!same(columns.filter((row) => row.pk).sort((a,b) => a.pk-b.pk).map((row) => row.name), contract.pk)) conflict(`${table} primary key drifted`);
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    for (const [column, target] of contract.fks) {
      if (!fks.some((row) => row.from === column && row.table === target && row.to === 'id')) conflict(`${table}.${column} foreign key drifted`);
    }
    if (fks.length !== contract.fks.length) conflict(`${table} foreign key set drifted`);
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
    if ((ddl.match(/\bCHECK\s*\(/gi) || []).length !== contract.checks) conflict(`${table} CHECK set drifted`);
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
    const columns = db.prepare(`SELECT COLUMN_NAME name,IS_NULLABLE nullable FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`).all(table);
    if (!matchesWave9ColumnIdentity(table, columns.map((row) => row.name), contract.columns)) conflict(`${table} column identity/order drifted`);
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
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND
      ((TABLE_NAME='credit_profile' AND COLUMN_NAME IN ('salesperson_scope_key','salesperson_id')) OR
       (TABLE_NAME='credit_profile_ratings' AND COLUMN_NAME='evaluation_result_id'))`).all()
    .map((row) => [`${row.table_name}.${row.name}`, row.nullable]));
  if (nullable.get('credit_profile.salesperson_scope_key') !== 'NO'
      || nullable.get('credit_profile.salesperson_id') !== 'YES'
      || nullable.get('credit_profile_ratings.evaluation_result_id') !== 'YES') conflict('nullable-scope/FK parity drifted');
  const physical = new Map(db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH max_length FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND
      ((TABLE_NAME='credit_lock_anchors' AND COLUMN_NAME='anchor_key') OR
       (TABLE_NAME='credit_profile_ratings' AND COLUMN_NAME='evaluation_result_id') OR
       (TABLE_NAME='credit_check_rules' AND COLUMN_NAME='result_payload_json') OR
       (TABLE_NAME='credit_policy_snapshots' AND COLUMN_NAME='notes_json'))`).all()
    .map((row) => [`${row.table_name}.${row.name}`, [row.data_type, row.max_length == null ? null : Number(row.max_length)]]));
  if (!same(physical.get('credit_lock_anchors.anchor_key'), ['varchar', 512])
      || !same(physical.get('credit_profile_ratings.evaluation_result_id'), ['varchar', 128])
      || !same(physical.get('credit_check_rules.result_payload_json'), ['json', null])
      || !same(physical.get('credit_policy_snapshots.notes_json'), ['json', null])) conflict('MySQL physical type parity drifted');
}

function provisionGlobalPolicyAnchor(db) {
  const values = ['credit-anchor-policy-global', 'POLICY_SCOPE|GLOBAL|GLOBAL', 'POLICY_SCOPE', 'GLOBAL', 'GLOBAL', new Date().toISOString()];
  if (db.dialect === 'mysql') {
    db.prepare(`INSERT IGNORE INTO credit_lock_anchors(id,anchor_key,anchor_type,policy_scope_type,policy_scope_id,created_at)
      VALUES(?,?,?,?,?,?)`).run(...values);
  } else {
    db.prepare(`INSERT OR IGNORE INTO credit_lock_anchors(id,anchor_key,anchor_type,policy_scope_type,policy_scope_id,created_at)
      VALUES(?,?,?,?,?,?)`).run(...values);
  }
  const row = db.prepare('SELECT * FROM credit_lock_anchors WHERE anchor_key=?').get(values[1]);
  if (!row || row.id !== values[0] || row.anchor_type !== 'POLICY_SCOPE' || row.policy_scope_type !== 'GLOBAL' || row.policy_scope_id !== 'GLOBAL') {
    conflict('GLOBAL policy anchor identity drifted');
  }
}

export function migrateSalesCustomerWave9CreditFoundation(db) {
  if (!db) throw new Error('migrateSalesCustomerWave9CreditFoundation: db missing');
  if (db.dialect === 'mysql') mysql(db); else db.exec(SQLITE_DDL);
  createIndexes(db);
  if (db.dialect === 'mysql') assertMySql(db); else assertSqlite(db);
  provisionGlobalPolicyAnchor(db);
}
