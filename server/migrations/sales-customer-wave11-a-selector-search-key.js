// W11-A U3 — the additive Selector Search Key migration.
//
// Requirement : document.md R-U3-SEARCH-05, R-U3-SEARCH-10
// Design      : solution.md §37.54.39.5, §37.54.40.5
//
// The migration adds four DERIVED search columns and nothing else:
//
//   customers.code_search_key
//   customers.name_search_key
//   credit_profile.credit_object_type_search_key
//   credit_profile.credit_object_id_search_key
//
// The columns are matching artifacts. They are never an identity, never a
// uniqueness constraint and never a source of truth for a business value. No
// existing column, constraint, index or business value is changed.
//
// The columns carry a byte-exact collation on both engines, because the folded
// value is already normalized and any further folding by the collation would
// reintroduce the very difference the policies remove:
//
//   SQLite : TEXT COLLATE BINARY
//   MySQL  : LONGTEXT COLLATE utf8mb4_0900_bin
//
// No index is added: a containment match with a leading wildcard cannot use an
// index.
//
// The migration is additive, idempotent, retryable and deterministic. It never
// swallows an error: a failed statement aborts the migration and therefore
// aborts the database initialization, so the application never starts against
// a half-migrated schema.

import { SEARCH_FOLD_VERSION, foldSearchText } from '../lib/search-fold.js';

const MYSQL_SEARCH_KEY_COLLATION = 'utf8mb4_0900_bin';
const BATCH_SIZE = 500;

const TABLE_SPECS = Object.freeze([
  Object.freeze({
    table: 'customers',
    keys: Object.freeze([
      Object.freeze({ column: 'code_search_key', source: 'code' }),
      Object.freeze({ column: 'name_search_key', source: 'name' }),
    ]),
  }),
  Object.freeze({
    table: 'credit_profile',
    keys: Object.freeze([
      Object.freeze({ column: 'credit_object_type_search_key', source: 'credit_object_type' }),
      Object.freeze({ column: 'credit_object_id_search_key', source: 'credit_object_id' }),
    ]),
  }),
]);

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
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function mysqlColumnDefinition(db, table, column) {
  return db.prepare(`SELECT DATA_TYPE data_type,IS_NULLABLE is_nullable,COLLATION_NAME collation_name
    FROM information_schema.columns
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`).get(table, column);
}

function sqliteColumnHasCanonicalDeclaration(db, table, column) {
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identifier = `(?:${escaped}|"${escaped}"|\\[${escaped}\\]|\`${escaped}\`)`;
  return new RegExp(
    `(?:\\(|,)\\s*${identifier}\\s+TEXT\\s+COLLATE\\s+BINARY(?:\\s+NULL)?\\s*(?=,|\\))`,
    'i',
  ).test(ddl);
}

function verifySelectorSearchKeyColumnDefinitions(db) {
  for (const spec of TABLE_SPECS) {
    for (const key of spec.keys) {
      if (db.dialect === 'mysql') {
        const definition = mysqlColumnDefinition(db, spec.table, key.column);
        const valid = definition
          && String(definition.data_type).toLowerCase() === 'longtext'
          && definition.is_nullable === 'YES'
          && definition.collation_name === MYSQL_SEARCH_KEY_COLLATION;
        if (!valid) {
          throw new Error(`W11-A selector search key migration: ${spec.table}.${key.column} physical definition invalid`);
        }
        continue;
      }
      const definition = db.prepare(`PRAGMA table_info(${spec.table})`).all()
        .find((row) => row.name === key.column);
      const valid = definition
        && String(definition.type).toUpperCase() === 'TEXT'
        && Number(definition.notnull) === 0
        && sqliteColumnHasCanonicalDeclaration(db, spec.table, key.column);
      if (!valid) {
        throw new Error(`W11-A selector search key migration: ${spec.table}.${key.column} physical definition invalid`);
      }
    }
  }
}

/**
 * Add the four derived columns and enforce their byte-exact collation.
 * @returns {{ added: string[], collationFixed: string[] }}
 */
export function ensureSelectorSearchKeyColumns(db) {
  const added = [];
  const collationFixed = [];
  for (const spec of TABLE_SPECS) {
    if (!tableExists(db, spec.table)) {
      throw new Error(`W11-A selector search key migration: table ${spec.table} does not exist`);
    }
    for (const key of spec.keys) {
      const exists = columnExists(db, spec.table, key.column);
      if (!exists) {
        if (db.dialect === 'mysql') {
          db.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${key.column} LONGTEXT
            CHARACTER SET utf8mb4 COLLATE ${MYSQL_SEARCH_KEY_COLLATION}`);
        } else {
          db.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${key.column} TEXT COLLATE BINARY`);
        }
        added.push(`${spec.table}.${key.column}`);
        continue;
      }
      // The MySQL bootstrap copies the additive column from the SQLite
      // snapshot without its collation, so a live deployment may carry the
      // table default. The fold is byte exact and the collation must be too.
      if (db.dialect === 'mysql') {
        const definition = mysqlColumnDefinition(db, spec.table, key.column);
        if (String(definition?.data_type).toLowerCase() !== 'longtext' || definition?.is_nullable !== 'YES') {
          throw new Error(`W11-A selector search key migration: ${spec.table}.${key.column} physical definition invalid`);
        }
        if (definition.collation_name === MYSQL_SEARCH_KEY_COLLATION) continue;
        db.exec(`ALTER TABLE ${spec.table} MODIFY COLUMN ${key.column} LONGTEXT
          CHARACTER SET utf8mb4 COLLATE ${MYSQL_SEARCH_KEY_COLLATION} NULL`);
        collationFixed.push(`${spec.table}.${key.column}`);
      }
    }
  }
  return { added, collationFixed };
}

function computeKeys(spec, row) {
  const computed = {};
  for (const key of spec.keys) computed[key.column] = foldSearchText(row[key.source]);
  return computed;
}

function updateKeys(db, spec, rowId, computed) {
  const assignments = spec.keys.map((key) => `${key.column}=?`).join(',');
  const values = spec.keys.map((key) => computed[key.column]);
  db.prepare(`UPDATE ${spec.table} SET ${assignments} WHERE id=?`).run(...values, rowId);
}

/**
 * Reconcile the stored keys against the source columns. The key is always
 * recomputed from the source, so a missing key and a stale key are both
 * repaired, the operation is idempotent and a retry converges. Only the rows
 * whose stored key differs are written, so a healthy database is never
 * rewritten. The read and the write are bounded by batches.
 * @returns {{ updated: number, ids: string[] }}
 */
export function backfillSelectorSearchKeys(db) {
  let updated = 0;
  const touched = [];
  for (const spec of TABLE_SPECS) {
    const sources = spec.keys.map((key) => key.source).join(', ');
    const columns = spec.keys.map((key) => key.column).join(', ');
    let cursor = '';
    for (;;) {
      const rows = db.prepare(`SELECT id, ${sources}, ${columns} FROM ${spec.table}
        WHERE id > ? ORDER BY id LIMIT ${BATCH_SIZE}`).all(cursor);
      if (!rows.length) break;
      for (const row of rows) {
        const computed = computeKeys(spec, row);
        const differs = spec.keys.some((key) => row[key.column] !== computed[key.column]);
        if (differs) {
          updateKeys(db, spec, row.id, computed);
          updated += 1;
          touched.push(`${spec.table}:${row.id}`);
        }
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH_SIZE) break;
    }
  }
  return { updated, ids: touched };
}

/**
 * Verify the stored keys. Without `only` the whole table is verified; with
 * `only` only the named rows are checked.
 * @returns {{ version: string, checked: number, missing: number, stale: number, samples: string[] }}
 */
export function verifySelectorSearchKeys(db, { only = null } = {}) {
  const result = { version: SEARCH_FOLD_VERSION, checked: 0, missing: 0, stale: 0, samples: [] };
  for (const spec of TABLE_SPECS) {
    const sources = spec.keys.map((key) => key.source).join(', ');
    const columns = spec.keys.map((key) => key.column).join(', ');
    let rows;
    if (only && only.length) {
      const placeholders = only.map(() => '?').join(',');
      rows = db.prepare(`SELECT id, ${sources}, ${columns} FROM ${spec.table}
        WHERE id IN (${placeholders})`).all(...only);
    } else {
      rows = db.prepare(`SELECT id, ${sources}, ${columns} FROM ${spec.table}`).all();
    }
    for (const row of rows) {
      result.checked += 1;
      let missing = false;
      let stale = false;
      for (const key of spec.keys) {
        const stored = row[key.column];
        const expected = foldSearchText(row[key.source]);
        if (stored === null || stored === undefined) missing = true;
        else if (stored !== expected) stale = true;
      }
      if (missing) {
        result.missing += 1;
        if (result.samples.length < 5) result.samples.push(`${spec.table}:${row.id}:missing`);
      } else if (stale) {
        result.stale += 1;
        if (result.samples.length < 5) result.samples.push(`${spec.table}:${row.id}:stale`);
      }
    }
  }
  return result;
}

/**
 * The migration entry point. It adds the columns, enforces the collation,
 * backfills the missing keys and verifies the result. It throws on any
 * failure; it never swallows an error.
 */
export function migrateW11ASelectorSearchKey(db) {
  const columns = ensureSelectorSearchKeyColumns(db);
  verifySelectorSearchKeyColumnDefinitions(db);
  const backfill = backfillSelectorSearchKeys(db);
  const verification = verifySelectorSearchKeys(db);
  if (verification.missing > 0 || verification.stale > 0) {
    throw new Error(`W11-A selector search key migration failed: ${verification.missing} missing and `
      + `${verification.stale} stale key(s) after the backfill; samples=${verification.samples.join(',')}`);
  }
  return {
    version: SEARCH_FOLD_VERSION,
    added: columns.added,
    collationFixed: columns.collationFixed,
    backfilled: backfill.updated,
    verified: verification.checked,
  };
}
