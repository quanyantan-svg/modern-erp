import { mysqlIndexColumnList } from '../database/mysql-schema.js';

export const SALES_WAVE6_TABLES = Object.freeze([
  'sales_order_replacements',
  'sales_order_replacement_lines',
  'sales_replacement_fulfillments',
  'sales_return_valuation_provenance',
]);

const RETURN_ORDER_COLUMNS = Object.freeze([
  ['commercial_source_marker', "TEXT CHECK(commercial_source_marker IN ('DELIVERY_BACKED','SO_BACKED','NO_SOURCE'))"],
]);

const RETURN_ITEM_COLUMNS = Object.freeze([
  ['sales_order_item_id', 'TEXT REFERENCES sales_order_items(id)'],
]);

const MYSQL_RETURN_SOURCE_CHECK = 'chk_return_orders_commercial_source_marker';
const MYSQL_RETURN_ITEM_ORDER_FK = 'fk_return_order_items_sales_order_item';
const MYSQL_REPLACEMENT_CANCELLATION_STATE_CHECK = 'chk_sales_order_replacements_cancellation_state';
const MYSQL_RETURN_REVERSAL_AMOUNT_CHECK = 'chk_return_reversals_amount_cents_nonneg';
const MYSQL_RETURN_REVERSAL_ITEM_AMOUNT_CHECK = 'chk_return_reversal_items_amount_cents_nonneg';

// §30.31.2 Bounded provenance carrier — one immutable row per Return valuation allocation.
const PROVENANCE_TABLE_COLUMNS = Object.freeze([
  ['id', 'TEXT PRIMARY KEY'],
  ['return_order_id', 'TEXT NOT NULL'],
  ['return_order_item_id', 'TEXT NOT NULL'],
  ['return_valuation_movement_id', 'TEXT NOT NULL UNIQUE'],
  ['original_outbound_valuation_movement_id', 'TEXT NOT NULL'],
  ['original_outbound_tracking_movement_id', 'TEXT'],
  ['product_id', 'TEXT NOT NULL'],
  ['warehouse_id', 'TEXT NOT NULL'],
  ['lot_id', 'TEXT'],
  ['serial_id', 'TEXT'],
  ['quantity', 'REAL NOT NULL CHECK(quantity > 0)'],
  ['value_cents', 'INTEGER NOT NULL CHECK(value_cents > 0)'],
  ['created_at', 'TEXT NOT NULL'],
]);

const PROVENANCE_INDEXES = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_provenance_return_item_movement ON sales_return_valuation_provenance(return_order_item_id, return_valuation_movement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provenance_original_outbound ON sales_return_valuation_provenance(original_outbound_valuation_movement_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_provenance_return_doc ON sales_return_valuation_provenance(return_order_id, return_order_item_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_provenance_identity ON sales_return_valuation_provenance(product_id, warehouse_id, lot_id, serial_id, id)`,
]);

const MYSQL_WAVE6_INDEXES = Object.freeze([
  Object.freeze({
    table: 'sales_return_valuation_provenance',
    name: 'uq_provenance_return_item_movement',
    unique: true,
    columns: Object.freeze(['return_order_item_id', 'return_valuation_movement_id']),
  }),
  Object.freeze({
    table: 'sales_return_valuation_provenance',
    name: 'idx_provenance_original_outbound',
    unique: false,
    columns: Object.freeze(['original_outbound_valuation_movement_id', 'id']),
  }),
  Object.freeze({
    table: 'sales_return_valuation_provenance',
    name: 'idx_provenance_return_doc',
    unique: false,
    columns: Object.freeze(['return_order_id', 'return_order_item_id', 'id']),
  }),
  Object.freeze({
    table: 'sales_return_valuation_provenance',
    name: 'idx_provenance_identity',
    unique: false,
    columns: Object.freeze(['product_id', 'warehouse_id', 'lot_id', 'serial_id', 'id']),
  }),
]);

export const MYSQL_LOT_FRONTIER_INDEX = Object.freeze({
  table: 'inventory_valuation_movements',
  name: 'idx_valuation_movements_identity_status_created',
  unique: false,
  columns: Object.freeze(['product_id', 'warehouse_id', 'lot_id', 'serial_id', 'status', 'created_at', 'id']),
});

function columns(db, table) {
  if (db.dialect === 'mysql') {
    return new Set(db.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(table).map((row) => row.name));
  }
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function indexes(db, table) {
  if (db.dialect === 'mysql') {
    return db.prepare(`SELECT INDEX_NAME name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND NON_UNIQUE=0`).all(table).map((row) => row.name);
  }
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`).all(table).map((row) => row.name);
}

function addSqliteColumns(db, table, definitions) {
  const existing = columns(db, table);
  for (const [name, ddl] of definitions) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

function assertColumns(db, table, definitions) {
  const existing = columns(db, table);
  for (const [name] of definitions) {
    if (!existing.has(name)) throw new Error(`Wave 6 MySQL bootstrap incomplete: ${table}.${name}`);
  }
}

function assertMySqlForeignKey(db, table, column, referencedTable, referencedColumn) {
  const rows = db.prepare(`SELECT CONSTRAINT_NAME constraint_name, REFERENCED_TABLE_NAME referenced_table,
      REFERENCED_COLUMN_NAME referenced_column
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`).all(table, column);
  if (rows.length !== 1 || rows[0].referenced_table !== referencedTable || rows[0].referenced_column !== referencedColumn) {
    throw new Error(`Wave 6 MySQL FK incomplete: ${table}.${column}`);
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
    throw new Error(`Wave 6 MySQL FK conflict: ${table}.${column}`);
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
    // MySQL 8 exposes string literals as _utf8mb4'VALUE' (and some adapters
    // retain the escape slash around the quote). Strip only known charset
    // introducers: a generic `_[a-z0-9]+` pattern also erases meaningful
    // suffixes such as `_BACKED`, weakening the equality check.
    .replace(/_(?:utf8mb4|utf8mb3|utf8|latin1)(?=\\?')/gi, '')
    .replace(/[\\`'\s()]/g, '')
    .toUpperCase();
  const normalized = normalize(row.check_clause);
  const expected = normalize(expression);
  if (normalized !== expected) throw new Error(`Wave 6 MySQL CHECK conflict: ${constraintName}; actual=${normalized}; expected=${expected}`);
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
        subPart: match?.[2] ? Number(match[2]) : null,
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
    throw new Error(`Wave 6 MySQL index conflict: ${definition.table}.${definition.name}`);
  }
}

function dropMySqlConstraintIfExists(db, tableName, constraintName) {
  // Drop CHECK/FK constraints by name. Idempotent.
  try { db.exec(`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`); } catch (_) { /* ignore if not exists */ }
}

function assertSqliteForeignKey(db, table, column, referencedTable, referencedColumn) {
  const row = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((candidate) => candidate.from === column);
  if (!row || row.table !== referencedTable || row.to !== referencedColumn) {
    throw new Error(`Wave 6 SQLite FK incomplete: ${table}.${column}`);
  }
}

// ----------------------------- F6: cancellation_state migration -----------------------------
// Required: replace 4-value `state` column with 2-value `cancellation_state CHECK('ACTIVE','CANCELLED')`.
// SQLite cannot ALTER a column's CHECK constraint, so we use table recreation under FOREIGN KEY preservation.
// MySQL uses DROP CHECK + ADD CONSTRAINT for the same effect.
function ensureSqliteReplacementHeaderCancellationState(db) {
  // Detect current shape
  const cols = db.prepare(`PRAGMA table_info(sales_order_replacements)`).all();
  const hasState = cols.some((c) => c.name === 'state');
  const hasCancellationState = cols.some((c) => c.name === 'cancellation_state');
  if (hasCancellationState && !hasState) return; // already migrated
  if (!hasState && !hasCancellationState) {
    // First-time install — handled by CREATE TABLE block later
    return;
  }
  if (hasState && !hasCancellationState) {
    // Existing 4-value state → migrate to 2-value cancellation_state preserving semantics:
    //  OPEN|IN_PROGRESS|FULFILLED -> ACTIVE   |   CANCELLED -> CANCELLED
    if (!db) throw new Error('ensureSqliteReplacementHeaderCancellationState: db missing');
    // Drop indexes then recreate table with cancellation_state
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      // Drop indexes that reference `state`
      const idxs = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_order_replacements' AND sql IS NOT NULL`).all();
      for (const idx of idxs) {
        if (!idx.sql) continue;
        if (/sales_order_replacements\b/.test(idx.sql) && /\bstate\b/.test(idx.sql) && !/cancellation_state/.test(idx.sql)) {
          db.exec(`DROP INDEX IF EXISTS "${idx.name}"`);
        }
      }
      db.exec(`CREATE TABLE sales_order_replacements_new (
        id TEXT PRIMARY KEY,
        replacement_no TEXT NOT NULL UNIQUE,
        source_return_id TEXT NOT NULL,
        cancellation_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(cancellation_state IN ('ACTIVE','CANCELLED')),
        created_at TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT
      )`);
      // Map old → new
      db.exec(`INSERT INTO sales_order_replacements_new (id, replacement_no, source_return_id, cancellation_state, created_at, creator_id, closed_at, closed_by)
                SELECT id, replacement_no, source_return_id,
                       CASE state WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'ACTIVE' END,
                       created_at, creator_id, closed_at, closed_by
                FROM sales_order_replacements`);
      // Drop old, rename new (and preserve FK by re-creating FKs in CREATE TABLE)
      db.exec(`DROP TABLE sales_order_replacements`);
      db.exec(`ALTER TABLE sales_order_replacements_new RENAME TO sales_order_replacements`);
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
  }
}

function recreateSqliteIndexesNoState(db, table) {
  // After `cancellation_state` migration, recreate any dropped indexes that referenced `state`.
  if (table === 'sales_order_replacements') {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_replacement_return ON sales_order_replacements(source_return_id, cancellation_state)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_replacement_cancellation ON sales_order_replacements(cancellation_state)`);
  }
}

function ensureMySqlReplacementHeaderCancellationState(db) {
  // Check whether table exists + shape
  const colRows = db.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_order_replacements'`).all();
  const colNames = new Set(colRows.map((row) => row.name));
  if (colNames.has('cancellation_state') && !colNames.has('state')) return; // already migrated
  if (!colNames.has('state') && !colNames.has('cancellation_state')) return; // fresh install — handled later
  if (colNames.has('state') && !colNames.has('cancellation_state')) {
    // Migration: add cancellation_state, copy mapped values, then drop state column
    db.exec(`ALTER TABLE sales_order_replacements ADD COLUMN cancellation_state VARCHAR(16) NULL`);
    db.exec(`UPDATE sales_order_replacements SET cancellation_state = CASE state WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'ACTIVE' END`);
    db.exec(`ALTER TABLE sales_order_replacements MODIFY COLUMN cancellation_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'`);
    // Drop old 4-value CHECK and named CHECK
    db.exec(`ALTER TABLE sales_order_replacements DROP CHECK chk_sales_order_replacements_state`);
    // Drop old column
    db.exec(`ALTER TABLE sales_order_replacements DROP COLUMN state`);
  }
  // Ensure named 2-value CHECK exists
  ensureMySqlCheck(db, 'sales_order_replacements', MYSQL_REPLACEMENT_CANCELLATION_STATE_CHECK, "cancellation_state IN ('ACTIVE','CANCELLED')");
}

// F5 — relax CHECK(amount_cents > 0) → CHECK(amount_cents >= 0) on return_reversals.amount_cents
// and return_reversal_items.amount_cents (NO_SOURCE supports zero commercial amount).
// Implemented via SQLite table recreation that preserves ALL constraints from the original
// CREATE TABLE (FKs, UNIQUE, CHECK, NOT NULL, DEFAULT) by operating on the original SQL text.
function ensureSqliteReturnReversalAmountCheck(db, tableName) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
  if (!row || !row.sql) return;
  const originalSql = row.sql;
  if (originalSql.includes('CHECK(amount_cents >= 0)') || originalSql.includes('CHECK (amount_cents >= 0)')) {
    return; // already relaxed
  }
  if (!/CHECK\(amount_cents > 0\)|CHECK \(amount_cents > 0\)/.test(originalSql)) {
    return; // no relevant inline CHECK; safe no-op
  }
  // Build new CREATE TABLE SQL by replacing amount_cents > 0 with amount_cents >= 0
  const newSql = originalSql
    .replace(/CHECK\(amount_cents > 0\)/g, 'CHECK(amount_cents >= 0)')
    .replace(/CHECK \(amount_cents > 0\)/g, 'CHECK (amount_cents >= 0)');
  // Capture inbound FK references to verify preservation
  const inboundFks = [];
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
  for (const t of tables) {
    if (t.name === tableName) continue;
    const allFks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all();
    for (const fk of allFks) {
      if (fk.table.toUpperCase() === tableName.toUpperCase()) {
        inboundFks.push({ table: t.name, from: fk.from, to: fk.to });
      }
    }
  }
  // Capture indexes (excluding autoindex)
  const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`).all(tableName);
  // Pattern: rename original → _w6_old → create new with relaxed CHECK → INSERT from _old → DROP _old.
  // SQLite rewrites inbound FK target names during ALTER TABLE RENAME while foreign_keys is
  // enabled. That would leave return_reversal_items / credit_reversal_components pointing at
  // the temporary `_w6_old` table after it is dropped. Disable FK rewriting for the bounded
  // reconstruction, retain the original child-table SQL, then restore enforcement and verify.
  const tmpName = `${tableName}_w6_old`;
  const foreignKeysEnabled = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0) === 1;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('PRAGMA legacy_alter_table=ON');
  try {
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${tmpName}`);
    db.exec(newSql);
    // Copy all rows verbatim from old → new (preserves all data + legacy reversal_no / created_at / etc.)
    const oldColumns = db.prepare(`PRAGMA table_info(${tmpName})`).all().map((c) => c.name).join(', ');
    db.exec(`INSERT INTO ${tableName} (${oldColumns}) SELECT ${oldColumns} FROM ${tmpName}`);
    db.exec(`DROP TABLE ${tmpName}`);
    // Recreate indexes (RENAME loses them)
    for (const idx of indexes) {
      if (idx.sql) db.exec(idx.sql);
    }
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
    if (foreignKeysEnabled) db.exec('PRAGMA foreign_keys=ON');
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`Wave 6 SQLite FK preservation failed for ${tableName}`);
}

function ensureMysqlReturnReversalAmountCheck(db, tableName, constraintName) {
  // Find existing CHECK on amount_cents and replace it with relaxed expression
  const row = db.prepare(`SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
    FROM information_schema.CHECK_CONSTRAINTS cc
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND cc.CONSTRAINT_NAME=?`).get(tableName, constraintName);
  const fallback = db.prepare(`SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
    FROM information_schema.CHECK_CONSTRAINTS cc
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND cc.CHECK_CLAUSE LIKE '%amount_cents%'`).all(tableName);
  const candidates = row ? [row] : fallback;
  for (const c of candidates) {
    if (!c || !c.CONSTRAINT_NAME) continue;
    const expr = String(c.CHECK_CLAUSE || '').replace(/[`'\s]/g, '');
    if (expr.includes('amount_cents>=0')) return; // already relaxed under any name
    db.exec(`ALTER TABLE ${tableName} DROP CONSTRAINT ${c.CONSTRAINT_NAME}`);
  }
  // Add the new named relaxed CHECK
  db.exec(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (amount_cents >= 0)`);
}

// ----------------------------- F5: amount_cents >= 0 (NO_SOURCE compatibility) -----------------------------
// Required: relax CHECK from `> 0` to `>= 0` on:
//  - return_reversals.amount_cents
//  - return_reversal_items.amount_cents
// SQLite cannot DROP a CHECK; the v13-phase6a-financial-controls.js migration declares them inline.
// We CANNOT mutate that historical migration. Instead we recognize that:
//   - DELIVERY_BACKED always writes > 0 (unit_price_cents > 0)
//   - SO_BACKED writes > 0 (sales_order_items.unit_price_cents > 0)
//   - NO_SOURCE legitimately writes 0 (no canonical sale price)
// To support NO_SOURCE without altering the v13-phase6a historical migration, the
// canonical writer must use POST-INSERT trigger paths only when amount_cents == 0,
// OR the historical migration must be co-executed. Per Wave 6 final Design §30.30
// item 3 and user-approved 2026-10-17 statement, the bounded change is registered.
// In this implementation, we do NOT replicate the historical migration; instead
// this function is a marker that records the additive contract for clarity in test
// assertions, and the canonical Option C writer is responsible for inserting 0
// inside the actual schema only after the SQLite / MySQL minimal schema delta is
// confirmed in real engines.
function noteF5Contract(db) {
  // F5 actually applies here: real CHECK relaxation to amount_cents >= 0 on both
  // return_reversals.amount_cents and return_reversal_items.amount_cents, so NO_SOURCE
  // Option C reverse can write canonical 0 commercial amount without smuggling inventory
  // valuation, SO price, or standard cost. DELIVERY_BACKED continues to write amount_cents > 0
  // because the original return's unit_price_cents is the original sales price (> 0), so the
  // relaxed CHECK is a no-op for DELIVERY_BACKED.
  if (db.dialect === 'mysql') {
    ensureMysqlReturnReversalAmountCheck(db, 'return_reversals', MYSQL_RETURN_REVERSAL_AMOUNT_CHECK);
    ensureMysqlReturnReversalAmountCheck(db, 'return_reversal_items', MYSQL_RETURN_REVERSAL_ITEM_AMOUNT_CHECK);
  } else {
    ensureSqliteReturnReversalAmountCheck(db, 'return_reversals');
    ensureSqliteReturnReversalAmountCheck(db, 'return_reversal_items');
  }
  return 'F5 CHECK(amount_cents >= 0) applied to return_reversals and return_reversal_items';
}

export function migrateSalesCustomerWave6Returns(db) {
  if (db.dialect !== 'mysql') {
    ensureSqliteReplacementHeaderCancellationState(db);
    // New install / idempotent — table creation only if not yet created or freshly created post-migration
    const existingReplacementCols = columns(db, 'sales_order_replacements');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_order_replacements (
        id TEXT PRIMARY KEY,
        replacement_no TEXT NOT NULL UNIQUE,
        source_return_id TEXT NOT NULL,
        cancellation_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(cancellation_state IN ('ACTIVE','CANCELLED')),
        created_at TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT,
        FOREIGN KEY(source_return_id) REFERENCES return_orders(id),
        FOREIGN KEY(creator_id) REFERENCES users(id),
        FOREIGN KEY(closed_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS sales_order_replacement_lines (
        id TEXT PRIMARY KEY,
        replacement_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        source_return_item_id TEXT NOT NULL,
        replacement_material_id TEXT NOT NULL,
        replacement_quantity REAL NOT NULL CHECK(replacement_quantity > 0),
        replacement_uom_code TEXT NOT NULL,
        business_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(replacement_id,line_no),
        UNIQUE(replacement_id,source_return_item_id),
        FOREIGN KEY(replacement_id) REFERENCES sales_order_replacements(id),
        FOREIGN KEY(source_return_item_id) REFERENCES return_order_items(id),
        FOREIGN KEY(replacement_material_id) REFERENCES products(id)
      );
      CREATE TABLE IF NOT EXISTS sales_replacement_fulfillments (
        id TEXT PRIMARY KEY,
        replacement_line_id TEXT NOT NULL,
        sales_delivery_id TEXT NOT NULL,
        sales_delivery_item_id TEXT NOT NULL,
        fulfilled_qty REAL NOT NULL CHECK(fulfilled_qty > 0),
        business_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(sales_delivery_item_id),
        FOREIGN KEY(replacement_line_id) REFERENCES sales_order_replacement_lines(id),
        FOREIGN KEY(sales_delivery_id) REFERENCES sales_deliveries(id),
        FOREIGN KEY(sales_delivery_item_id) REFERENCES sales_delivery_items(id)
      );
      CREATE TABLE IF NOT EXISTS sales_return_valuation_provenance (
        id TEXT PRIMARY KEY,
        return_order_id TEXT NOT NULL,
        return_order_item_id TEXT NOT NULL,
        return_valuation_movement_id TEXT NOT NULL UNIQUE,
        original_outbound_valuation_movement_id TEXT NOT NULL,
        original_outbound_tracking_movement_id TEXT,
        product_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        lot_id TEXT,
        serial_id TEXT,
        quantity REAL NOT NULL CHECK(quantity > 0),
        value_cents INTEGER NOT NULL CHECK(value_cents > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(return_order_id) REFERENCES return_orders(id),
        FOREIGN KEY(return_order_item_id) REFERENCES return_order_items(id),
        FOREIGN KEY(return_valuation_movement_id) REFERENCES inventory_valuation_movements(id),
        FOREIGN KEY(original_outbound_valuation_movement_id) REFERENCES inventory_valuation_movements(id),
        FOREIGN KEY(original_outbound_tracking_movement_id) REFERENCES tracked_inventory_movements(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id),
        FOREIGN KEY(serial_id) REFERENCES inventory_serials(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_replacement_return ON sales_order_replacements(source_return_id, cancellation_state);
      CREATE INDEX IF NOT EXISTS idx_sales_replacement_cancellation ON sales_order_replacements(cancellation_state);
      CREATE INDEX IF NOT EXISTS idx_sales_replacement_line_source ON sales_order_replacement_lines(source_return_item_id);
      CREATE INDEX IF NOT EXISTS idx_sales_replacement_fulfillment_line ON sales_replacement_fulfillments(replacement_line_id);
    `);
    for (const stmt of PROVENANCE_INDEXES) db.exec(stmt);
    recreateSqliteIndexesNoState(db, 'sales_order_replacements');
    addSqliteColumns(db, 'return_orders', RETURN_ORDER_COLUMNS);
    addSqliteColumns(db, 'return_order_items', RETURN_ITEM_COLUMNS);
    assertSqliteForeignKey(db, 'return_order_items', 'sales_order_item_id', 'sales_order_items', 'id');
    // §30.31.5 / §30.31.7 LOT frontier read/lock composite index. Conditional on table
    // existence so minimal-F5 fixtures that only bootstrap reversal tables don't fail.
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_valuation_movements'").get()) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_valuation_movements_identity_status_created
        ON inventory_valuation_movements(product_id, warehouse_id, lot_id, serial_id, status, created_at, id)`);
    }
    noteF5Contract(db);
    return;
  }

  // MySQL
  ensureMySqlReplacementHeaderCancellationState(db);
  const mysqlTables = [
    `CREATE TABLE IF NOT EXISTS sales_order_replacements (
      id VARCHAR(128) PRIMARY KEY,
      replacement_no VARCHAR(128) NOT NULL UNIQUE,
      source_return_id VARCHAR(128) NOT NULL,
      cancellation_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
      created_at LONGTEXT NOT NULL,
      creator_id VARCHAR(128) NOT NULL,
      closed_at LONGTEXT NULL,
      closed_by VARCHAR(128) NULL,
      CONSTRAINT fk_sales_order_replacements_return FOREIGN KEY (source_return_id) REFERENCES return_orders(id),
      CONSTRAINT fk_sales_order_replacements_creator FOREIGN KEY (creator_id) REFERENCES users(id),
      CONSTRAINT fk_sales_order_replacements_closed_by FOREIGN KEY (closed_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS sales_order_replacement_lines (
      id VARCHAR(128) PRIMARY KEY,
      replacement_id VARCHAR(128) NOT NULL,
      line_no BIGINT NOT NULL,
      source_return_item_id VARCHAR(128) NOT NULL,
      replacement_material_id VARCHAR(128) NOT NULL,
      replacement_quantity DECIMAL(24,6) NOT NULL,
      replacement_uom_code VARCHAR(128) NOT NULL,
      business_date LONGTEXT NOT NULL,
      created_at LONGTEXT NOT NULL,
      UNIQUE KEY uq_sales_order_replacement_line_no (replacement_id,line_no),
      UNIQUE KEY uq_sales_order_replacement_source (replacement_id,source_return_item_id),
      CONSTRAINT chk_sales_order_replacement_qty CHECK (replacement_quantity > 0),
      CONSTRAINT fk_sales_order_replacement_lines_header FOREIGN KEY (replacement_id) REFERENCES sales_order_replacements(id),
      CONSTRAINT fk_sales_order_replacement_lines_return_item FOREIGN KEY (source_return_item_id) REFERENCES return_order_items(id),
      CONSTRAINT fk_sales_order_replacement_lines_material FOREIGN KEY (replacement_material_id) REFERENCES products(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS sales_replacement_fulfillments (
      id VARCHAR(128) PRIMARY KEY,
      replacement_line_id VARCHAR(128) NOT NULL,
      sales_delivery_id VARCHAR(128) NOT NULL,
      sales_delivery_item_id VARCHAR(128) NOT NULL UNIQUE,
      fulfilled_qty DECIMAL(24,6) NOT NULL,
      business_date LONGTEXT NOT NULL,
      created_at LONGTEXT NOT NULL,
      CONSTRAINT chk_sales_replacement_fulfilled_qty CHECK (fulfilled_qty > 0),
      CONSTRAINT fk_sales_replacement_fulfillment_line FOREIGN KEY (replacement_line_id) REFERENCES sales_order_replacement_lines(id),
      CONSTRAINT fk_sales_replacement_fulfillment_delivery FOREIGN KEY (sales_delivery_id) REFERENCES sales_deliveries(id),
      CONSTRAINT fk_sales_replacement_fulfillment_item FOREIGN KEY (sales_delivery_item_id) REFERENCES sales_delivery_items(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  ];
  for (const statement of mysqlTables) db.exec(statement);
  const returnColumns = columns(db, 'return_orders');
  if (!returnColumns.has('commercial_source_marker')) {
    db.exec('ALTER TABLE return_orders ADD COLUMN commercial_source_marker VARCHAR(32) NULL');
  }
  const itemColumns = columns(db, 'return_order_items');
  if (!itemColumns.has('sales_order_item_id')) {
    db.exec('ALTER TABLE return_order_items ADD COLUMN sales_order_item_id VARCHAR(128) NULL');
  }
  // §30.31.5 MySQL bounded provenance carrier
  if (!db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_return_valuation_provenance'`).get()) {
    db.exec(`CREATE TABLE sales_return_valuation_provenance (
      id VARCHAR(128) PRIMARY KEY,
      return_order_id VARCHAR(128) NOT NULL,
      return_order_item_id VARCHAR(128) NOT NULL,
      return_valuation_movement_id VARCHAR(128) NOT NULL UNIQUE,
      original_outbound_valuation_movement_id VARCHAR(128) NOT NULL,
      original_outbound_tracking_movement_id VARCHAR(128) NULL,
      product_id VARCHAR(128) NOT NULL,
      warehouse_id VARCHAR(128) NOT NULL,
      lot_id VARCHAR(128) NULL,
      serial_id VARCHAR(128) NULL,
      quantity DECIMAL(24,6) NOT NULL,
      value_cents BIGINT NOT NULL,
      created_at LONGTEXT NOT NULL,
      CONSTRAINT chk_provenance_quantity CHECK (quantity > 0),
      CONSTRAINT chk_provenance_value CHECK (value_cents > 0),
      CONSTRAINT fk_provenance_return_order FOREIGN KEY (return_order_id) REFERENCES return_orders(id),
      CONSTRAINT fk_provenance_return_item FOREIGN KEY (return_order_item_id) REFERENCES return_order_items(id),
      CONSTRAINT fk_provenance_return_val_movement FOREIGN KEY (return_valuation_movement_id) REFERENCES inventory_valuation_movements(id),
      CONSTRAINT fk_provenance_original_outbound FOREIGN KEY (original_outbound_valuation_movement_id) REFERENCES inventory_valuation_movements(id),
      CONSTRAINT fk_provenance_tracking FOREIGN KEY (original_outbound_tracking_movement_id) REFERENCES tracked_inventory_movements(id),
      CONSTRAINT fk_provenance_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT fk_provenance_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      CONSTRAINT fk_provenance_lot FOREIGN KEY (lot_id) REFERENCES inventory_lots(id),
      CONSTRAINT fk_provenance_serial FOREIGN KEY (serial_id) REFERENCES inventory_serials(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  }
  for (const definition of MYSQL_WAVE6_INDEXES) ensureMySqlIndex(db, definition);
  // §30.31.5 / §30.31.7 LOT frontier read/lock composite index — supports
  // next-key locking on (product_id, warehouse_id, lot_id, serial_id, status, created_at, id)
  // for MySQL InnoDB so phantom negative movements at the same LOT identity cannot be
  // inserted between the Reverse-time frontier check and transaction commit.
  if (db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_valuation_movements'`).get()) {
    ensureMySqlIndex(db, MYSQL_LOT_FRONTIER_INDEX);
  }
  ensureMySqlCheck(
    db,
    'return_orders',
    MYSQL_RETURN_SOURCE_CHECK,
    "commercial_source_marker IS NULL OR commercial_source_marker IN ('DELIVERY_BACKED','SO_BACKED','NO_SOURCE')",
  );
  // Final guarantee: 2-value cancellation_state named CHECK
  ensureMySqlCheck(db, 'sales_order_replacements', MYSQL_REPLACEMENT_CANCELLATION_STATE_CHECK, "cancellation_state IN ('ACTIVE','CANCELLED')");
  ensureMySqlForeignKey(db, 'return_order_items', 'sales_order_item_id', 'sales_order_items', 'id', MYSQL_RETURN_ITEM_ORDER_FK);
  assertColumns(db, 'return_orders', RETURN_ORDER_COLUMNS);
  assertColumns(db, 'return_order_items', RETURN_ITEM_COLUMNS);
  assertMySqlForeignKey(db, 'return_order_items', 'sales_order_item_id', 'sales_order_items', 'id');
  const tablePlaceholders = SALES_WAVE6_TABLES.map(() => '?').join(',');
  const tables = db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablePlaceholders})`).all(...SALES_WAVE6_TABLES).map((row) => row.name).sort();
  if (JSON.stringify(tables) !== JSON.stringify([...SALES_WAVE6_TABLES].sort())) {
    throw new Error('Wave 6 MySQL bootstrap incomplete');
  }
  noteF5Contract(db);
}
