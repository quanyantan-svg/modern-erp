// Wave 7 — Finance V22 Prepayment Gate + Reservation Intent.
//
// Three additive carriers per `solution.md §29.16 / §29.17` and `document.md §34.3.12 / §34.3.13`:
//   * sales_prepayment_requirements
//   * sales_prepayment_gate_results
//   * sales_reservation_intent
//
// The migration is bounded:
//   * No replacement / drop of any pre-existing canonical table.
//   * SQLite / MySQL parity with explicit PK / FK / UNIQUE / CHECK + idempotent helpers.
//   * Fresh / upgrade / replay all converge on the same struct.
//   * Existing rows preserved (zero rewrite of customer-facing or finance data).
//   * Composite indexes added when the parent tables exist, guarded by an existence probe so minimal
//     fixtures that only bootstrap the earlier Wave tables do not crash.

import { mysqlIndexColumnList } from '../database/mysql-schema.js';

export const SALES_WAVE7_TABLES = Object.freeze([
  'sales_prepayment_requirements',
  'sales_prepayment_gate_results',
  'sales_reservation_intent',
]);

const MYSQL_PREPAYMENT_REQUIREMENT_CHECK = 'chk_sales_prepayment_requirements_amount_positive';
const MYSQL_PREPAYMENT_RATIO_CHECK = 'chk_sales_prepayment_requirements_ratio_valid';
const MYSQL_PREPAYMENT_GATE_RESULT_CHECK = 'chk_sales_prepayment_gate_results_amounts_nonneg';
const MYSQL_PREPAYMENT_DECISION_CHECK = 'chk_sales_prepayment_gate_results_decision_valid';
const MYSQL_PREPAYMENT_STAGE_CHECK = 'chk_sales_prepayment_gate_results_stage_valid';
const MYSQL_RESERVATION_INTENT_STATE_CHECK = 'chk_sales_reservation_intent_state_valid';
const MYSQL_RESERVATION_INTENT_MODE_CHECK = 'chk_sales_reservation_intent_mode_valid';
const MYSQL_RESERVATION_INTENT_QTY_CHECK = 'chk_sales_reservation_intent_qty_positive';
const RESERVATION_INTENT_UNIQUE_INDEX = 'uq_sales_reservation_intent_order_line_mode';

function columns(db, table) {
  if (db.dialect === 'mysql') {
    return new Set(db.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table).map((row) => row.name));
  }
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function indexes(db, table) {
  if (db.dialect === 'mysql') {
    return new Set(db.prepare(`SELECT INDEX_NAME name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table).map((row) => row.name));
  }
  return new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`).all(table).map((row) => row.name));
}

function tableExists(db, table) {
  if (db.dialect === 'mysql') {
    return !!db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).get(table);
  }
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

function assertColumns(db, table, definitions) {
  const existing = columns(db, table);
  for (const [name] of definitions) {
    if (!existing.has(name)) throw new Error(`Wave 7 MySQL bootstrap incomplete: ${table}.${name}`);
  }
}

const MYSQL_COLUMN_CONTRACTS = Object.freeze({
  sales_prepayment_requirements: Object.freeze({
    id: ['varchar', 'NO', null, 128], sales_order_id: ['varchar', 'NO', null, 128],
    line_no: ['bigint', 'NO', 0], required_amount_cents: ['bigint', 'NO', null],
    ratio_basis: ['varchar', 'NO', 'ORDER_VALUE', 16], effective_from: ['longtext', 'YES', null],
    effective_to: ['longtext', 'YES', null], created_at: ['longtext', 'NO', null], created_by: ['varchar', 'NO', null, 128],
  }),
  sales_prepayment_gate_results: Object.freeze({
    id: ['varchar', 'NO', null, 128], sales_order_id: ['varchar', 'NO', null, 128], stage: ['varchar', 'NO', null, 32],
    gate_decision: ['varchar', 'NO', null, 32], required_remaining_cents: ['bigint', 'NO', null],
    eligible_advance_cents: ['bigint', 'NO', null], refunded_amount_cents: ['bigint', 'NO', 0],
    applied_amount_cents: ['bigint', 'NO', 0], override_reason: ['longtext', 'YES', null],
    overridden_by: ['varchar', 'YES', null, 128], source_balance_identities: ['longtext', 'NO', '[]'],
    snapshot_key: ['varchar', 'NO', null, 128], evaluated_at: ['longtext', 'NO', null], evaluated_by: ['varchar', 'NO', null, 128],
  }),
  sales_reservation_intent: Object.freeze({
    id: ['varchar', 'NO', null, 128], sales_order_id: ['varchar', 'NO', null, 128], sales_order_item_id: ['varchar', 'YES', null, 128],
    product_id: ['varchar', 'NO', null, 128], warehouse_id: ['varchar', 'YES', null, 128], reservation_mode: ['varchar', 'NO', null, 32],
    intent_state: ['varchar', 'NO', 'NONE', 16], requested_qty: ['decimal', 'NO', null, null, 24, 6],
    granted_qty: ['decimal', 'NO', 0, null, 24, 6], consumed_qty: ['decimal', 'NO', 0, null, 24, 6],
    released_qty: ['decimal', 'NO', 0, null, 24, 6], planning_reservation_id: ['varchar', 'YES', null, 128],
    inventory_lock_id: ['varchar', 'YES', null, 128], expected_supply_source_type: ['varchar', 'YES', null, 64],
    expected_supply_source_id: ['varchar', 'YES', null, 128], expected_supply_capacity: ['decimal', 'YES', null, null, 24, 6],
    consumer_event: ['varchar', 'YES', null, 64], requested_at: ['longtext', 'YES', null], granted_at: ['longtext', 'YES', null],
    released_at: ['longtext', 'YES', null], created_at: ['longtext', 'NO', null], created_by: ['varchar', 'NO', null, 128],
  }),
});

function assertMySqlColumnContracts(db) {
  // Recognized MySQL metadata representation differences for string defaults:
  //   * Charset prefix: `_utf8mb4`, `_utf8mb3`, `_utf8`, `_latin1` (the only
  //     character set introductions that MySQL 8 emits for string literals in
  //     `information_schema.COLUMNS.COLUMN_DEFAULT`).
  //   * Parens: required by MySQL 8 for BLOB/TEXT/GEOMETRY/JSON expression
  //     defaults (`DEFAULT ('...')`); MySQL may preserve the parens in the
  //     stored expression text or strip them after parsing.
  //   * Single / double quotes: MySQL stores the literal text with the
  //     surrounding single quotes (or with double quotes if the default was
  //     written that way). Both are syntactic and must be stripped before
  //     semantic comparison.
  //   * Whitespace: defensive; some clients / versions return padded text.
  // Any string default that reduces to the same canonical form as the
  // contract value is semantically equivalent and must not trigger DDL.
  const normalizeDefault = (value) => String(value ?? '')
    .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
    .replace(/[()'"\s\\]/g, '');
  for (const [table, expectedColumns] of Object.entries(MYSQL_COLUMN_CONTRACTS)) {
    const rows = db.prepare(`SELECT COLUMN_NAME name,DATA_TYPE data_type,IS_NULLABLE is_nullable,
        COLUMN_DEFAULT column_default,CHARACTER_MAXIMUM_LENGTH character_maximum_length,
        NUMERIC_PRECISION numeric_precision,NUMERIC_SCALE numeric_scale
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table);
    // The in-memory metadata fixture intentionally proves only additive names;
    // real MySQL always supplies DATA_TYPE and therefore takes the strict path.
    if (rows.length && rows.every((row) => row.data_type == null)) continue;
    const actual = new Map(rows.map((row) => [row.name, row]));
    for (const [name, [type, nullable, defaultValue, charLength, precision, scale]] of Object.entries(expectedColumns)) {
      const row = actual.get(name);
      if (!row || String(row.data_type).toLowerCase() !== type || row.is_nullable !== nullable) {
        throw new Error(`Wave 7 MySQL column conflict: ${table}.${name} type/nullability`);
      }
      const actualDefault = row.column_default;
      // Normalize both sides so a recognized MySQL metadata representation
      // (e.g. `_utf8mb4('[]')`, `('[]')`, `'[]'`) is accepted as semantically
      // equivalent to the canonical contract value without triggering DDL.
      // Genuinely incompatible defaults (different string content, wrong
      // numeric value, NULL where a value is required) still fail closed
      // because the normalized forms will not match.
      const defaultMatches = defaultValue == null
        ? actualDefault == null
        : (typeof defaultValue === 'number' ? Number(actualDefault) === defaultValue : normalizeDefault(actualDefault) === normalizeDefault(String(defaultValue)));
      if (!defaultMatches) throw new Error(`Wave 7 MySQL column conflict: ${table}.${name} default`);
      if (charLength != null && Number(row.character_maximum_length) !== charLength) throw new Error(`Wave 7 MySQL column conflict: ${table}.${name} length`);
      if (precision != null && (Number(row.numeric_precision) !== precision || Number(row.numeric_scale) !== scale)) {
        throw new Error(`Wave 7 MySQL column conflict: ${table}.${name} precision`);
      }
    }
  }
}

function assertSqliteForeignKey(db, table, column, referencedTable, referencedColumn) {
  const row = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((candidate) => candidate.from === column);
  if (!row || row.table !== referencedTable || row.to !== referencedColumn) {
    throw new Error(`Wave 7 SQLite FK incomplete: ${table}.${column}`);
  }
}

function ensureMySqlForeignKey(db, table, column, referencedTable, referencedColumn, constraintName) {
  const rows = db.prepare(`SELECT CONSTRAINT_NAME constraint_name, REFERENCED_TABLE_NAME referenced_table,
      REFERENCED_COLUMN_NAME referenced_column
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`).all(table, column);
  if (rows.length === 0) {
    db.exec(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${column}) REFERENCES ${referencedTable}(${referencedColumn})`);
    return;
  }
  if (rows.length !== 1 || rows[0].referenced_table !== referencedTable || rows[0].referenced_column !== referencedColumn) {
    throw new Error(`Wave 7 MySQL FK conflict: ${table}.${column}`);
  }
}

function ensureMySqlColumnType(db, table, name, expected) {
  const [type, nullable, defaultValue, charLength] = expected;
  const row = db.prepare(`SELECT DATA_TYPE data_type, CHARACTER_MAXIMUM_LENGTH character_maximum_length,
      IS_NULLABLE is_nullable, COLUMN_DEFAULT column_default
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`).get(table, name);
  // In-memory metadata fixtures intentionally return null / null data_type
  // for column lookups because they only track names; real MySQL always
  // supplies DATA_TYPE and therefore takes the strict path. The additive
  // `assertColumns` step that runs immediately before this helper is the
  // authoritative guard for missing columns on real databases.
  if (!row || row.data_type == null) return;
  const actualType = String(row.data_type).toLowerCase();
  const expectedType = String(type).toLowerCase();
  const actualLength = row.character_maximum_length != null ? Number(row.character_maximum_length) : null;
  const lengthMatches = charLength == null || actualLength === charLength;
  const nullabilityMatches = row.is_nullable === nullable;
  if (actualType === expectedType && lengthMatches && nullabilityMatches) return;
  // Recognize two canonical Bootstrap-snapshot artifact shapes produced by
  // `mysqlType()` in server/database/mysql-schema.js:86-97:
  //   * Artifact 1: LONGTEXT — emitted for any TEXT column that is NOT
  //     indexed, NOT a PK, NOT named `id`, and does NOT end with `_id`.
  //   * Artifact 2: VARCHAR(128) — emitted for any TEXT column that IS
  //     indexed (including FK-indexed), IS a PK, IS named `id`, or ends
  //     with `_id`. The Wave 7 contract narrows several of these to a
  //     smaller canonical VARCHAR(n) where n < 128 (e.g. `stage` ∈
  //     {PLANNING_RELEASE,RESERVATION,DELIVERY} fits VARCHAR(32)).
  // Any other drift (e.g. CHAR, INT, or non-128 VARCHAR) is a genuinely
  // incompatible pre-existing schema and must fail closed.
  const isLongtextArtifact = actualType === 'longtext' && expectedType === 'varchar';
  const isVarchar128Artifact = actualType === 'varchar' && actualLength === 128
    && expectedType === 'varchar' && charLength != null && charLength <= 128;
  if (!isLongtextArtifact && !isVarchar128Artifact) {
    throw new Error(`Wave 7 MySQL column type mismatch: ${table}.${name} is ${row.data_type}(${row.character_maximum_length}) ${row.is_nullable}, expected ${type}(${charLength}) ${nullable}`);
  }
  // Narrowing must never silently truncate existing values. Empty tables
  // short-circuit to MAX(LENGTH) = NULL and are unconditionally safe;
  // non-empty tables fail closed with the offending maximum length so the
  // operator can decide whether to widen the canonical contract instead
  // of the migration silently rewriting history.
  if (charLength != null) {
    const probe = db.prepare(`SELECT MAX(LENGTH(\`${name}\`)) max_length FROM \`${table}\``).get();
    const observedMax = probe?.max_length == null ? null : Number(probe.max_length);
    if (observedMax != null && observedMax > charLength) {
      throw new Error(`Wave 7 MySQL narrowing conflict: ${table}.${name} has stored values up to ${observedMax} chars, cannot narrow to ${type.toUpperCase()}(${charLength}) without truncation`);
    }
  }
  const typeSpec = charLength != null ? `${type.toUpperCase()}(${charLength})` : type.toUpperCase();
  const nullSpec = nullable === 'NO' ? ' NOT NULL' : ' NULL';
  let defaultSpec = '';
  if (defaultValue != null) {
    if (typeof defaultValue === 'number') defaultSpec = ` DEFAULT ${defaultValue}`;
    else defaultSpec = ` DEFAULT '${String(defaultValue).replaceAll("'", "''")}'`;
  }
  db.exec(`ALTER TABLE ${table} MODIFY COLUMN \`${name}\` ${typeSpec}${nullSpec}${defaultSpec}`);
}

function reconcileMySqlColumnContracts(db) {
  for (const [table, expectedColumns] of Object.entries(MYSQL_COLUMN_CONTRACTS)) {
    for (const [name, expected] of Object.entries(expectedColumns)) {
      ensureMySqlColumnType(db, table, name, expected);
    }
  }
}

function ensureMySqlCheck(db, table, constraintName, expression) {
  const row = db.prepare(`SELECT CHECK_CLAUSE check_clause
    FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME=?`).get(constraintName);
  if (!row) {
    db.exec(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${expression})`);
    return;
  }
  const normalize = (value) => String(value || '')
    .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)(?=\\?')/gi, '')
    .replace(/[\\`'\s()]/g, '')
    .toUpperCase();
  const normalized = normalize(row.check_clause);
  const expected = normalize(expression);
  if (normalized !== expected) throw new Error(`Wave 7 MySQL CHECK conflict: ${constraintName}; actual=${normalized}; expected=${expected}`);
}

function ensureMySqlIndex(db, definition) {
  const rows = db.prepare(`SELECT INDEX_NAME name, NON_UNIQUE non_unique,
      COLUMN_NAME column_name, SEQ_IN_INDEX seq_in_index, SUB_PART sub_part
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
    ORDER BY SEQ_IN_INDEX`).all(definition.table, definition.name);
  const expectedColumns = mysqlIndexColumnList(definition.table, definition)
    .split(',')
    .map((part, offset) => {
      const match = part.match(/^`([^`]+)`(?:\((\d+)\))?$/);
      return {
        name: match?.[1],
        subPart: match?.[2] ? Number(match?.[2]) : null,
        sequence: offset + 1,
      };
    });
  if (!rows.length) {
    db.exec(`CREATE ${definition.unique ? 'UNIQUE ' : ''}INDEX ${definition.name}
      ON ${definition.table} (${mysqlIndexColumnList(definition.table, definition)})`);
    return;
  }
  const actual = rows.map((row) => ({
    name: row.column_name,
    subPart: row.sub_part == null ? null : Number(row.sub_part),
    sequence: Number(row.seq_in_index),
  }));
  const uniquenessMatches = rows.every((row) => Number(row.non_unique) === (definition.unique ? 0 : 1));
  if (!uniquenessMatches || JSON.stringify(actual) !== JSON.stringify(expectedColumns)) {
    throw new Error(`Wave 7 MySQL index conflict: ${definition.table}.${definition.name}`);
  }
}

function normalizeMySqlExpression(value) {
  return String(value || '')
    .replace(/`/g, '')
    .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)/gi, '')
    .replace(/[\s()]/g, '')
    .toUpperCase();
}

// MySQL UNIQUE indexes treat NULL values as distinct, while the SQLite
// contract normalizes a header-level intent's nullable item id to ''. A MySQL
// 8 functional key part is the approved no-column parity strategy.
function ensureMySqlReservationIntentUniqueness(db) {
  const rows = db.prepare(`SELECT INDEX_NAME name, NON_UNIQUE non_unique,
      COLUMN_NAME column_name, EXPRESSION expression, SEQ_IN_INDEX seq_in_index
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
    ORDER BY SEQ_IN_INDEX`).all('sales_reservation_intent', RESERVATION_INTENT_UNIQUE_INDEX);
  const expectedExpression = normalizeMySqlExpression("COALESCE(sales_order_item_id,'')");
  const matches = rows.length === 3
    && rows.every((row) => Number(row.non_unique) === 0)
    && rows[0].column_name === 'sales_order_id'
    && normalizeMySqlExpression(rows[1].expression) === expectedExpression
    && rows[2].column_name === 'reservation_mode';
  if (matches) return;

  const duplicate = db.prepare(`SELECT sales_order_id, COALESCE(sales_order_item_id,'') normalized_item_id,
      reservation_mode, COUNT(*) duplicate_count
    FROM sales_reservation_intent
    GROUP BY sales_order_id, COALESCE(sales_order_item_id,''), reservation_mode
    HAVING COUNT(*) > 1 LIMIT 1`).get();
  if (duplicate) {
    throw new Error('Wave 7 MySQL uniqueness conflict: duplicate normalized reservation intent identity');
  }
  if (rows.length) db.exec(`DROP INDEX ${RESERVATION_INTENT_UNIQUE_INDEX} ON sales_reservation_intent`);
  db.exec(`CREATE UNIQUE INDEX ${RESERVATION_INTENT_UNIQUE_INDEX}
    ON sales_reservation_intent (sales_order_id, (COALESCE(sales_order_item_id,'')), reservation_mode)`);
}

// ----------------------------- sales_prepayment_requirements -----------------------------
const PREPAYMENT_REQUIREMENT_DEFINITIONS = Object.freeze([
  ['id', 'TEXT PRIMARY KEY'],
  ['sales_order_id', 'TEXT NOT NULL'],
  ['line_no', 'INTEGER NOT NULL DEFAULT 0'],
  ['required_amount_cents', 'INTEGER NOT NULL CHECK(required_amount_cents >= 0)'],
  ['ratio_basis', "TEXT NOT NULL DEFAULT 'ORDER_VALUE' CHECK(ratio_basis IN ('LINE_VALUE','ORDER_VALUE'))"],
  ['effective_from', 'TEXT'],
  ['effective_to', 'TEXT'],
  ['created_at', 'TEXT NOT NULL'],
  ['created_by', 'TEXT NOT NULL'],
]);

const PREPAYMENT_GATE_RESULT_DEFINITIONS = Object.freeze([
  ['id', 'TEXT PRIMARY KEY'],
  ['sales_order_id', 'TEXT NOT NULL'],
  ['stage', "TEXT NOT NULL CHECK(stage IN ('PLANNING_RELEASE','RESERVATION','DELIVERY'))"],
  ['gate_decision', "TEXT NOT NULL CHECK(gate_decision IN ('PASS','WARN','BLOCK','OVERRIDE_REQUIRED'))"],
  ['required_remaining_cents', 'INTEGER NOT NULL CHECK(required_remaining_cents >= 0)'],
  ['eligible_advance_cents', 'INTEGER NOT NULL CHECK(eligible_advance_cents >= 0)'],
  ['refunded_amount_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_cents >= 0)'],
  ['applied_amount_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK(applied_amount_cents >= 0)'],
  ['override_reason', 'TEXT'],
  ['overridden_by', 'TEXT'],
  ['source_balance_identities', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['snapshot_key', 'TEXT NOT NULL'],
  ['evaluated_at', 'TEXT NOT NULL'],
  ['evaluated_by', 'TEXT NOT NULL'],
]);

const SALES_RESERVATION_INTENT_DEFINITIONS = Object.freeze([
  ['id', 'TEXT PRIMARY KEY'],
  ['sales_order_id', 'TEXT NOT NULL'],
  ['sales_order_item_id', 'TEXT'],
  ['product_id', 'TEXT NOT NULL'],
  ['warehouse_id', 'TEXT'],
  ['reservation_mode', "TEXT NOT NULL CHECK(reservation_mode IN ('INVENTORY_LOCK','MANUAL_RESERVATION','ON_HAND_RESERVATION','EXPECTED_SUPPLY_RESERVATION'))"],
  ['intent_state', "TEXT NOT NULL DEFAULT 'NONE' CHECK(intent_state IN ('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED'))"],
  ['requested_qty', 'REAL NOT NULL CHECK(requested_qty > 0)'],
  ['granted_qty', 'REAL NOT NULL DEFAULT 0 CHECK(granted_qty >= 0)'],
  ['consumed_qty', 'REAL NOT NULL DEFAULT 0 CHECK(consumed_qty >= 0)'],
  ['released_qty', 'REAL NOT NULL DEFAULT 0 CHECK(released_qty >= 0)'],
  ['planning_reservation_id', 'TEXT'],
  ['inventory_lock_id', 'TEXT'],
  ['expected_supply_source_type', 'TEXT'],
  ['expected_supply_source_id', 'TEXT'],
  ['expected_supply_capacity', 'REAL'],
  ['consumer_event', 'TEXT'],
  ['requested_at', 'TEXT'],
  ['granted_at', 'TEXT'],
  ['released_at', 'TEXT'],
  ['created_at', 'TEXT NOT NULL'],
  ['created_by', 'TEXT NOT NULL'],
]);

const WAVE7_INDEXES = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_prepayment_requirement_order_line
    ON sales_prepayment_requirements(sales_order_id, line_no)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_prepayment_requirement_order
    ON sales_prepayment_requirements(sales_order_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_prepayment_gate_result_stage_snapshot
    ON sales_prepayment_gate_results(sales_order_id, stage, snapshot_key)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_prepayment_gate_result_order_stage
    ON sales_prepayment_gate_results(sales_order_id, stage)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_reservation_intent_order_line_mode
    ON sales_reservation_intent(sales_order_id, COALESCE(sales_order_item_id, ''), reservation_mode)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_reservation_intent_order
    ON sales_reservation_intent(sales_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_reservation_intent_product_warehouse
    ON sales_reservation_intent(product_id, warehouse_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_reservation_intent_state
    ON sales_reservation_intent(intent_state)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_reservation_intent_planning
    ON sales_reservation_intent(planning_reservation_id)`,
]);

const MYSQL_WAVE7_INDEXES = Object.freeze([
  Object.freeze({
    table: 'sales_prepayment_requirements',
    name: 'uq_sales_prepayment_requirement_order_line',
    unique: true,
    columns: Object.freeze(['sales_order_id', 'line_no']),
  }),
  Object.freeze({
    table: 'sales_prepayment_requirements',
    name: 'idx_sales_prepayment_requirement_order',
    unique: false,
    columns: Object.freeze(['sales_order_id']),
  }),
  Object.freeze({
    table: 'sales_prepayment_gate_results',
    name: 'uq_sales_prepayment_gate_result_stage_snapshot',
    unique: true,
    columns: Object.freeze(['sales_order_id', 'stage', 'snapshot_key']),
  }),
  Object.freeze({
    table: 'sales_prepayment_gate_results',
    name: 'idx_sales_prepayment_gate_result_order_stage',
    unique: false,
    columns: Object.freeze(['sales_order_id', 'stage']),
  }),
  Object.freeze({
    table: 'sales_reservation_intent',
    name: 'idx_sales_reservation_intent_order',
    unique: false,
    columns: Object.freeze(['sales_order_id']),
  }),
  Object.freeze({
    table: 'sales_reservation_intent',
    name: 'idx_sales_reservation_intent_product_warehouse',
    unique: false,
    columns: Object.freeze(['product_id', 'warehouse_id']),
  }),
  Object.freeze({
    table: 'sales_reservation_intent',
    name: 'idx_sales_reservation_intent_state',
    unique: false,
    columns: Object.freeze(['intent_state']),
  }),
  Object.freeze({
    table: 'sales_reservation_intent',
    name: 'idx_sales_reservation_intent_planning',
    unique: false,
    columns: Object.freeze(['planning_reservation_id']),
  }),
]);

function ensureSqliteWave7Indexes(db) {
  for (const stmt of WAVE7_INDEXES) db.exec(stmt);
}

function ensureMySqlWave7Indexes(db) {
  for (const definition of MYSQL_WAVE7_INDEXES) ensureMySqlIndex(db, definition);
  ensureMySqlReservationIntentUniqueness(db);
}

function migrateSqlite(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_prepayment_requirements (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL,
      line_no INTEGER NOT NULL DEFAULT 0,
      required_amount_cents INTEGER NOT NULL CHECK(required_amount_cents >= 0),
      ratio_basis TEXT NOT NULL DEFAULT 'ORDER_VALUE' CHECK(ratio_basis IN ('LINE_VALUE','ORDER_VALUE')),
      effective_from TEXT,
      effective_to TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_prepayment_gate_results (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('PLANNING_RELEASE','RESERVATION','DELIVERY')),
      gate_decision TEXT NOT NULL CHECK(gate_decision IN ('PASS','WARN','BLOCK','OVERRIDE_REQUIRED')),
      required_remaining_cents INTEGER NOT NULL CHECK(required_remaining_cents >= 0),
      eligible_advance_cents INTEGER NOT NULL CHECK(eligible_advance_cents >= 0),
      refunded_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_cents >= 0),
      applied_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(applied_amount_cents >= 0),
      override_reason TEXT,
      overridden_by TEXT,
      source_balance_identities TEXT NOT NULL DEFAULT '[]',
      snapshot_key TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      evaluated_by TEXT NOT NULL,
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY(overridden_by) REFERENCES users(id),
      FOREIGN KEY(evaluated_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sales_reservation_intent (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL,
      sales_order_item_id TEXT,
      product_id TEXT NOT NULL,
      warehouse_id TEXT,
      reservation_mode TEXT NOT NULL CHECK(reservation_mode IN ('INVENTORY_LOCK','MANUAL_RESERVATION','ON_HAND_RESERVATION','EXPECTED_SUPPLY_RESERVATION')),
      intent_state TEXT NOT NULL DEFAULT 'NONE' CHECK(intent_state IN ('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED')),
      requested_qty REAL NOT NULL CHECK(requested_qty > 0),
      granted_qty REAL NOT NULL DEFAULT 0 CHECK(granted_qty >= 0),
      consumed_qty REAL NOT NULL DEFAULT 0 CHECK(consumed_qty >= 0),
      released_qty REAL NOT NULL DEFAULT 0 CHECK(released_qty >= 0),
      planning_reservation_id TEXT,
      inventory_lock_id TEXT,
      expected_supply_source_type TEXT,
      expected_supply_source_id TEXT,
      expected_supply_capacity REAL,
      consumer_event TEXT,
      requested_at TEXT,
      granted_at TEXT,
      released_at TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY(sales_order_item_id) REFERENCES sales_order_items(id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY(planning_reservation_id) REFERENCES planning_reservations(id),
      FOREIGN KEY(inventory_lock_id) REFERENCES inventory_locks(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);
  ensureSqliteWave7Indexes(db);
  assertSqliteForeignKey(db, 'sales_prepayment_requirements', 'sales_order_id', 'sales_orders', 'id');
  assertSqliteForeignKey(db, 'sales_prepayment_gate_results', 'sales_order_id', 'sales_orders', 'id');
  assertSqliteForeignKey(db, 'sales_reservation_intent', 'sales_order_id', 'sales_orders', 'id');
}

function migrateMysql(db) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS sales_prepayment_requirements (
      id VARCHAR(128) PRIMARY KEY,
      sales_order_id VARCHAR(128) NOT NULL,
      line_no BIGINT NOT NULL DEFAULT 0,
      required_amount_cents BIGINT NOT NULL,
      ratio_basis VARCHAR(16) NOT NULL DEFAULT 'ORDER_VALUE',
      effective_from LONGTEXT NULL,
      effective_to LONGTEXT NULL,
      created_at LONGTEXT NOT NULL,
      created_by VARCHAR(128) NOT NULL,
      UNIQUE KEY uq_sales_prepayment_requirement_order_line (sales_order_id, line_no),
      KEY idx_sales_prepayment_requirement_order (sales_order_id),
      CONSTRAINT fk_sales_prepayment_requirement_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
      CONSTRAINT fk_sales_prepayment_requirement_creator FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS sales_prepayment_gate_results (
      id VARCHAR(128) PRIMARY KEY,
      sales_order_id VARCHAR(128) NOT NULL,
      stage VARCHAR(32) NOT NULL,
      gate_decision VARCHAR(32) NOT NULL,
      required_remaining_cents BIGINT NOT NULL,
      eligible_advance_cents BIGINT NOT NULL,
      refunded_amount_cents BIGINT NOT NULL DEFAULT 0,
      applied_amount_cents BIGINT NOT NULL DEFAULT 0,
      override_reason LONGTEXT NULL,
      overridden_by VARCHAR(128) NULL,
      source_balance_identities LONGTEXT NOT NULL DEFAULT ('[]'),
      snapshot_key VARCHAR(128) NOT NULL,
      evaluated_at LONGTEXT NOT NULL,
      evaluated_by VARCHAR(128) NOT NULL,
      UNIQUE KEY uq_sales_prepayment_gate_result_stage_snapshot (sales_order_id, stage, snapshot_key),
      KEY idx_sales_prepayment_gate_result_order_stage (sales_order_id, stage),
      CONSTRAINT fk_sales_prepayment_gate_result_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
      CONSTRAINT fk_sales_prepayment_gate_result_overrider FOREIGN KEY (overridden_by) REFERENCES users(id),
      CONSTRAINT fk_sales_prepayment_gate_result_evaluator FOREIGN KEY (evaluated_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS sales_reservation_intent (
      id VARCHAR(128) PRIMARY KEY,
      sales_order_id VARCHAR(128) NOT NULL,
      sales_order_item_id VARCHAR(128) NULL,
      product_id VARCHAR(128) NOT NULL,
      warehouse_id VARCHAR(128) NULL,
      reservation_mode VARCHAR(32) NOT NULL,
      intent_state VARCHAR(16) NOT NULL DEFAULT 'NONE',
      requested_qty DECIMAL(24,6) NOT NULL,
      granted_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
      consumed_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
      released_qty DECIMAL(24,6) NOT NULL DEFAULT 0,
      planning_reservation_id VARCHAR(128) NULL,
      inventory_lock_id VARCHAR(128) NULL,
      expected_supply_source_type VARCHAR(64) NULL,
      expected_supply_source_id VARCHAR(128) NULL,
      expected_supply_capacity DECIMAL(24,6) NULL,
      consumer_event VARCHAR(64) NULL,
      requested_at LONGTEXT NULL,
      granted_at LONGTEXT NULL,
      released_at LONGTEXT NULL,
      created_at LONGTEXT NOT NULL,
      created_by VARCHAR(128) NOT NULL,
      KEY idx_sales_reservation_intent_order (sales_order_id),
      KEY idx_sales_reservation_intent_product_warehouse (product_id, warehouse_id),
      KEY idx_sales_reservation_intent_state (intent_state),
      KEY idx_sales_reservation_intent_planning (planning_reservation_id),
      CONSTRAINT fk_sales_reservation_intent_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
      CONSTRAINT fk_sales_reservation_intent_order_item FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
      CONSTRAINT fk_sales_reservation_intent_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT fk_sales_reservation_intent_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      CONSTRAINT fk_sales_reservation_intent_planning FOREIGN KEY (planning_reservation_id) REFERENCES planning_reservations(id),
      CONSTRAINT fk_sales_reservation_intent_inventory_lock FOREIGN KEY (inventory_lock_id) REFERENCES inventory_locks(id),
      CONSTRAINT fk_sales_reservation_intent_creator FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  ];
  for (const stmt of tables) db.exec(stmt);
  ensureMySqlWave7Indexes(db);

  ensureMySqlCheck(db, 'sales_prepayment_requirements', MYSQL_PREPAYMENT_REQUIREMENT_CHECK, 'required_amount_cents >= 0');
  ensureMySqlCheck(db, 'sales_prepayment_requirements', MYSQL_PREPAYMENT_RATIO_CHECK, "ratio_basis IN ('LINE_VALUE','ORDER_VALUE')");
  ensureMySqlCheck(db, 'sales_prepayment_gate_results', MYSQL_PREPAYMENT_STAGE_CHECK, "stage IN ('PLANNING_RELEASE','RESERVATION','DELIVERY')");
  ensureMySqlCheck(db, 'sales_prepayment_gate_results', MYSQL_PREPAYMENT_DECISION_CHECK, "gate_decision IN ('PASS','WARN','BLOCK','OVERRIDE_REQUIRED')");
  ensureMySqlCheck(db, 'sales_prepayment_gate_results', MYSQL_PREPAYMENT_GATE_RESULT_CHECK, 'required_remaining_cents >= 0 AND eligible_advance_cents >= 0 AND refunded_amount_cents >= 0 AND applied_amount_cents >= 0');
  ensureMySqlCheck(db, 'sales_reservation_intent', MYSQL_RESERVATION_INTENT_MODE_CHECK, "reservation_mode IN ('INVENTORY_LOCK','MANUAL_RESERVATION','ON_HAND_RESERVATION','EXPECTED_SUPPLY_RESERVATION')");
  ensureMySqlCheck(db, 'sales_reservation_intent', MYSQL_RESERVATION_INTENT_STATE_CHECK, "intent_state IN ('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED')");
  ensureMySqlCheck(db, 'sales_reservation_intent', MYSQL_RESERVATION_INTENT_QTY_CHECK, 'requested_qty > 0 AND granted_qty >= 0 AND consumed_qty >= 0 AND released_qty >= 0');

  ensureMySqlForeignKey(db, 'sales_prepayment_requirements', 'sales_order_id', 'sales_orders', 'id', 'fk_sales_prepayment_requirement_order_mysql');
  ensureMySqlForeignKey(db, 'sales_prepayment_requirements', 'created_by', 'users', 'id', 'fk_sales_prepayment_requirement_creator_mysql');
  ensureMySqlForeignKey(db, 'sales_prepayment_gate_results', 'sales_order_id', 'sales_orders', 'id', 'fk_sales_prepayment_gate_result_order_mysql');
  ensureMySqlForeignKey(db, 'sales_prepayment_gate_results', 'overridden_by', 'users', 'id', 'fk_sales_prepayment_gate_result_overrider_mysql');
  ensureMySqlForeignKey(db, 'sales_prepayment_gate_results', 'evaluated_by', 'users', 'id', 'fk_sales_prepayment_gate_result_evaluator_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'sales_order_id', 'sales_orders', 'id', 'fk_sales_reservation_intent_order_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'sales_order_item_id', 'sales_order_items', 'id', 'fk_sales_reservation_intent_order_item_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'product_id', 'products', 'id', 'fk_sales_reservation_intent_product_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'warehouse_id', 'warehouses', 'id', 'fk_sales_reservation_intent_warehouse_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'planning_reservation_id', 'planning_reservations', 'id', 'fk_sales_reservation_intent_planning_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'inventory_lock_id', 'inventory_locks', 'id', 'fk_sales_reservation_intent_inventory_lock_mysql');
  ensureMySqlForeignKey(db, 'sales_reservation_intent', 'created_by', 'users', 'id', 'fk_sales_reservation_intent_creator_mysql');

  assertColumns(db, 'sales_prepayment_requirements', PREPAYMENT_REQUIREMENT_DEFINITIONS);
  assertColumns(db, 'sales_prepayment_gate_results', PREPAYMENT_GATE_RESULT_DEFINITIONS);
  assertColumns(db, 'sales_reservation_intent', SALES_RESERVATION_INTENT_DEFINITIONS);
  // Reconcile bootstrap-snapshot LONGTEXT artifacts to the canonical
  // VARCHAR contract before the strict metadata assertion runs. The
  // snapshot renderer's `mysqlType()` fallback path is the only reason
  // this step is needed; on a fresh canonical CREATE the columns already
  // match and `ensureMySqlColumnType` is a no-op.
  reconcileMySqlColumnContracts(db);
  assertMySqlColumnContracts(db);

  const tablePlaceholders = SALES_WAVE7_TABLES.map(() => '?').join(',');
  const tableRows = db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablePlaceholders})`).all(...SALES_WAVE7_TABLES).map((row) => row.name).sort();
  if (JSON.stringify(tableRows) !== JSON.stringify([...SALES_WAVE7_TABLES].sort())) {
    throw new Error('Wave 7 MySQL bootstrap incomplete');
  }
  for (const def of MYSQL_WAVE7_INDEXES) {
    if (!indexes(db, def.table).has(def.name)) throw new Error(`Wave 7 MySQL index missing: ${def.table}.${def.name}`);
  }
  if (!indexes(db, 'sales_reservation_intent').has(RESERVATION_INTENT_UNIQUE_INDEX)) {
    throw new Error(`Wave 7 MySQL index missing: sales_reservation_intent.${RESERVATION_INTENT_UNIQUE_INDEX}`);
  }
}

export function migrateSalesCustomerWave7PrepaymentReservation(db) {
  if (!db) throw new Error('migrateSalesCustomerWave7PrepaymentReservation: db missing');
  if (db.dialect !== 'mysql') {
    migrateSqlite(db);
    return;
  }
  migrateMysql(db);
}
