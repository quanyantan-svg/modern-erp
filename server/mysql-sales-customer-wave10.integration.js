// Wave 10 protected real-MySQL formal bootstrap/parity/upgrade acceptance.
// Reachable only through scripts/gates/mysql-sales-wave10-acceptance.mjs.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';
import { bootstrapMySql, captureSqliteSnapshot } from './database/mysql-schema.js';
import { createDatabase } from './db.js';
import { runSalesCustomerMigrations, SALES_CUSTOMER_MIGRATIONS } from './migrations/sales-customer-domain.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import { SALES_WAVE10_TABLES } from './migrations/sales-customer-wave10-credit-check.js';
import { createTempDb } from './test-utils/temp-db.js';
import { createWave10MysqlLifecycle } from './test-utils/mysql-wave10-campaign-target.js';
import {
  assertCheckParity, assertEquivalentCreditMetadata, CHECK_LITERAL_DIALECT, compareWave9SourceTarget,
  createWave9BoundedSnapshot, describeCheckClauseNormalization, normalizedCreditMetadata,
  normalizedSqliteTable, readNormalizedMySqlTable, rowsById,
} from './test-utils/wave10-mysql-schema-fixture.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);

const lifecycle = createWave10MysqlLifecycle();
const handles = new Set();
afterEach(() => {
  for (const handle of [...handles]) {
    try { handle.cleanup(); } finally { handles.delete(handle); }
  }
});

function register(db, cleanup) {
  const handle = { db, cleanup };
  handles.add(handle);
  return handle;
}

// §37.48 — bounded live evidence for the CHECK clause literal dialect.
//
// The MySQL catalogue renders a string literal with its delimiters
// backslash-escaped. The protected campaign that captured that rendering also
// records the server state it was captured against, so the rendering contract
// is re-confirmed against the live server on the next run instead of being
// re-modelled by hand.
//
// The evidence is bounded: the server version, the session sql_mode and the
// raw and the canonical form of the CHECK clauses of the eight compared
// tables. It carries no credential and no other SQL.
const CHECK_METADATA_EVIDENCE_PREFIX = 'WAVE10_CHECK_METADATA_EVIDENCE ';
const CHECK_EVIDENCE_MAX_CLAUSE_CHARS = 512;
const CHECK_EVIDENCE_MAX_REASON_CHARS = 120;

function collectCheckMetadataEvidence(db) {
  const version = String(db.prepare('SELECT VERSION() version').get()?.version ?? '');
  const sqlMode = String(db.prepare('SELECT @@session.sql_mode sql_mode').get()?.sql_mode ?? '');
  const tables = {};
  for (const tableName of [...SALES_WAVE9_TABLES, ...SALES_WAVE10_TABLES]) {
    const rows = db.prepare(`SELECT cc.CHECK_CLAUSE check_clause FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'
      ORDER BY cc.CHECK_CLAUSE`).all(tableName);
    tables[tableName] = rows.map((row) => {
      const described = describeCheckClauseNormalization(row.check_clause, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG });
      return {
        raw: String(row.check_clause ?? '').slice(0, CHECK_EVIDENCE_MAX_CLAUSE_CHARS),
        canonical: String(described.canonical).slice(0, CHECK_EVIDENCE_MAX_CLAUSE_CHARS),
        form: described.form,
        reason: described.reason ? String(described.reason).slice(0, CHECK_EVIDENCE_MAX_REASON_CHARS) : null,
      };
    });
  }
  return {
    version,
    sqlMode,
    // The catalogue rendering convention is only decodable when the session
    // did not disable backslash escapes. Under NO_BACKSLASH_ESCAPES the same
    // bytes denote a different value, so the comparison is refused rather
    // than forced into a canonical form.
    backslashEscapesEnabled: !/NO_BACKSLASH_ESCAPES/i.test(sqlMode),
    literalDialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG,
    tables,
  };
}

let checkMetadataEvidenceEmitted = false;

function emitCheckMetadataEvidence(db) {
  const evidence = collectCheckMetadataEvidence(db);
  if (!evidence.backslashEscapesEnabled) {
    throw new Error(
      'WAVE10 CHECK METADATA EVIDENCE UNSUPPORTED MODE: the acceptance session disables backslash escapes'
      + ` (NO_BACKSLASH_ESCAPES in sql_mode=${evidence.sqlMode}), so the catalogue CHECK rendering cannot be`
      + ' decoded under the mysql_catalog literal dialect and the CHECK parity comparison is refused.',
    );
  }
  checkMetadataEvidenceEmitted = true;
  process.stdout.write(`${CHECK_METADATA_EVIDENCE_PREFIX}${JSON.stringify(evidence)}\n`);
}

function fresh(label) {
  const handle = createTempDb({ label, production: true, mysqlLifecycle: lifecycle });
  handles.add(handle);
  assert.equal(handle.db.dialect, 'mysql');
  // The evidence is emitted once per campaign run, from the first canonical
  // schema the suite creates. It never changes a comparison assertion.
  if (!checkMetadataEvidenceEmitted) emitCheckMetadataEvidence(handle.db);
  return handle;
}

function rawAdapter() {
  const { backend: _backend, ...config } = resolveDatabaseConfig({ backend: 'mysql' });
  lifecycle.beforeCreate(config);
  const db = new MySqlSyncAdapter(config);
  lifecycle.verify(db, config);
  return { db, config };
}

function canonicalSnapshot() {
  return captureSqliteSnapshot((filename) => createDatabase(filename), false);
}

function wave9Upgrade(label = 'wave10-upgrade') {
  const snapshot = createWave9BoundedSnapshot(canonicalSnapshot());
  const { db, config } = rawAdapter();
  bootstrapMySql(db, snapshot);
  lifecycle.verify(db, config);
  const handle = register(db, () => {
    try { lifecycle.reset(db, config); } finally { db.close(); }
  });
  handle.label = label;
  handle.snapshot = snapshot;
  return handle;
}

function seedWave9Graph(db) {
  const now = '2026-10-25T00:00:00.000Z';
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('w10-up-user','w10-up-user','Wave 10 Upgrade','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('w10-up-customer','W10-UP','Wave 10 Upgrade','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,credit_object_type,
    credit_object_id,policy_scope_type,policy_scope_id,created_at)
    VALUES('w10-up-anchor','CREDIT_OBJECT|SALES_ORDER|W10-UP|CUSTOMER|w10-up-customer|SCOPE:AGGREGATE',
    'CREDIT_OBJECT','w10-up-customer',NULL,'SALES_ORDER','W10-UP',NULL,NULL,?)`).run(now);
  db.prepare(`INSERT INTO credit_parameters(id,code,value_bool,effective_from,status,created_at,created_by)
    VALUES('w10-up-param','CREDIT_MANAGEMENT_ENABLED',1,'2026-01-01','ACTIVE',?,'w10-up-user')`).run(now);
  db.prepare(`INSERT INTO credit_parameters(id,code,value_text,value_int,value_bool,value_date,effective_from,status,created_at,created_by)
    VALUES('w10-up-param-null','W10_BOUNDARY_NULL',NULL,NULL,NULL,NULL,'2026-01-02','DRAFT',?,'w10-up-user')`).run(now);
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
    recognition_mode,effective_from,status,result_payload_json,created_at,created_by)
    VALUES('w10-up-rule','W10-UP','SO_SUBMIT','STANDARD','BEFORE_WRITE','BLOCK','ORDER_EXPOSURE',NULL,
    '2026-01-01','ACTIVE','{}',?,'w10-up-user')`).run(now);
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,
    credit_object_id,credit_limit_cents,initial_state,status,rating_grade,overdue_day_policy,rule_id,effective_from,
    created_at,created_by) VALUES('w10-up-profile','w10-up-anchor','w10-up-customer','*',NULL,'SALES_ORDER','W10-UP',
    900000,'NORMAL','ACTIVE','A','15','w10-up-rule','2026-01-01',?,'w10-up-user')`).run(now);
  db.prepare(`INSERT INTO credit_policy_snapshots(id,credit_lock_anchor_id,scope_type,credit_profile_id,
    snapshot_fingerprint,business_date,parameter_set_hash,rule_set_hash,profile_effective_state_hash,captured_at,captured_by,notes_json)
    VALUES('w10-up-snapshot','w10-up-anchor','CUSTOMER_AGGREGATE','w10-up-profile','w10-up-fingerprint','2026-10-25',
    'parameter-hash','rule-hash','profile-hash',?,'w10-up-user','{}')`).run(now);
  db.prepare(`INSERT INTO credit_profile_ratings(id,credit_profile_id,rating_source_type,rating_source_key,
    evaluation_result_id,rating_grade,applied_at,applied_by,superseded_at)
    VALUES('w10-up-rating','w10-up-profile','INITIAL_ASSIGNED','INITIAL_ASSIGNED',NULL,'A',?,'w10-up-user',NULL)`).run(now);
}

function runThroughWave10(db) {
  return runSalesCustomerMigrations(db, SALES_CUSTOMER_MIGRATIONS.filter((step) => step.wave <= 10));
}

test('M-MIG-01 fresh production bootstrap creates exactly the approved Wave 10 additions', () => {
  const db = fresh('wave10-fresh').db;
  const found = db.prepare(`SELECT TABLE_NAME name,ENGINE engine FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?) ORDER BY TABLE_NAME`).all(...SALES_WAVE10_TABLES);
  assert.deepEqual(found.map((row) => row.name), [...SALES_WAVE10_TABLES].sort());
  assert.ok(found.every((row) => row.engine === 'InnoDB'));
  // The Wave 10 additions keep the approved constraint expectations.
  const source = new Map(canonicalSnapshot().tables.map((table) => [table.name, normalizedSqliteTable(table)]));
  for (const tableName of SALES_WAVE10_TABLES) {
    const actual = readNormalizedMySqlTable(db, tableName);
    const expected = source.get(tableName);
    assert.ok(expected, `${tableName}: the canonical SQLite source must declare the table`);
    assert.ok(actual.foreignKeys.length > 0, `${tableName}: the Wave 10 addition must keep its foreign keys`);
    assert.ok(actual.checks.length > 0, `${tableName}: the Wave 10 addition must keep its check constraints`);
    assertCheckParity(expected.checks, actual.checks, tableName);
  }
});

test('M-MIG-02 actual canonical SQLite source and MySQL target have complete Wave 9 metadata parity', () => {
  const db = fresh('wave10-parity').db;
  compareWave9SourceTarget(canonicalSnapshot(), db);
});

test('M-MIG-03/M-MIG-05 formal Wave 9 physical snapshot upgrades through the ordered registry and replays idempotently', () => {
  const handle = wave9Upgrade();
  seedWave9Graph(handle.db);
  const before = Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, rowsById(handle.db, table)]));
  const executed = runThroughWave10(handle.db);
  assert.ok(executed.includes('wave-10-credit-check'));
  assert.deepEqual(Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, rowsById(handle.db, table)])), before, 'I-4 first upgrade');
  runThroughWave10(handle.db);
  assert.deepEqual(Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, rowsById(handle.db, table)])), before, 'I-4 repeated upgrade');
});

test('M-MIG-04 repeated production initialization is idempotent', () => {
  const handle = fresh('wave10-reinitialize');
  const before = normalizedCreditMetadata(handle.db);
  const second = createDatabase(resolveDatabaseConfig({ backend: 'mysql' }));
  try { assert.deepEqual(normalizedCreditMetadata(second), before); } finally { second.close(); }
});

test('M-MIG-06 fresh and formal-upgrade Credit metadata are equivalent', () => {
  const freshHandle = fresh('wave10-equivalence-fresh');
  const expected = normalizedCreditMetadata(freshHandle.db);
  freshHandle.cleanup(); handles.delete(freshHandle);
  const upgraded = wave9Upgrade('wave10-equivalence-upgrade');
  runThroughWave10(upgraded.db);
  assertEquivalentCreditMetadata(normalizedCreditMetadata(upgraded.db), expected, 'M-MIG-06');
});

test('M-MIG-07 I-4 preserves the complete non-empty connected Wave 9 row graph', () => {
  const handle = wave9Upgrade('wave10-i4');
  seedWave9Graph(handle.db);
  const before = Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, rowsById(handle.db, table)]));
  runThroughWave10(handle.db);
  const after = Object.fromEntries(SALES_WAVE9_TABLES.map((table) => [table, rowsById(handle.db, table)]));
  assert.deepEqual(after, before);
});

test('M-MIG-08 I-3 dynamically proves zero orphan references on every actual Credit FK edge', () => {
  const handle = wave9Upgrade('wave10-i3');
  seedWave9Graph(handle.db); runThroughWave10(handle.db);
  const tables = [...SALES_WAVE9_TABLES, ...SALES_WAVE10_TABLES];
  const edges = handle.db.prepare(`SELECT TABLE_NAME child_table,COLUMN_NAME child_column,
      REFERENCED_TABLE_NAME parent_table,REFERENCED_COLUMN_NAME parent_column
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN (${tables.map(() => '?').join(',')}) AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME,COLUMN_NAME`).all(...tables);
  assert.ok(edges.length > 0);
  for (const edge of edges) {
    for (const value of Object.values(edge)) assert.match(value, /^[A-Za-z0-9_]+$/);
    const orphan = handle.db.prepare(`SELECT COUNT(*) count FROM \`${edge.child_table}\` child
      LEFT JOIN \`${edge.parent_table}\` parent ON parent.\`${edge.parent_column}\`=child.\`${edge.child_column}\`
      WHERE child.\`${edge.child_column}\` IS NOT NULL AND parent.\`${edge.parent_column}\` IS NULL`).get();
    assert.equal(Number(orphan.count), 0, `I-3 ${edge.child_table}.${edge.child_column}`);
  }
});
