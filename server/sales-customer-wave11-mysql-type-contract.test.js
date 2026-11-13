// Wave 11 Sales — MySQL physical type contract guard.
//
// Why this file exists: the Wave 11 credit-evaluation / reconciliation
// migrations each carry a hand-written canonical MySQL DDL AND a declared
// physical type map, while the SQLite snapshot bootstrap derives the very same
// physical type from the SQLite column. Two hand-maintained copies of one
// fact drift apart, and the drift is INVISIBLE on SQLite: it only surfaces on
// a real MySQL server, as the first domain campaign run showed
// (`credit_evaluation_result.profile_effective_state_hash physical type
// drifted`).
//
// This guard proves, entirely OFFLINE and without a MySQL server, that:
//   1. the pinned type map equals what the snapshot bootstrap materializes;
//   2. the hand-written MySQL DDL equals the pinned type map;
//   3. no indexed text column is declared LONGTEXT (InnoDB rejects it);
//   4. the pinned map is itself registered in the canonical type resolver, so
//      the snapshot path cannot silently fall back to the generic heuristic.
//
// Requirement : docs/requirements/sales-customer/05-wave-11-amendments.md
//                (Wave 11 Stage B Requirement Closure)
// Design      : docs/design/sales-customer/05-wave-11-stage-c.md §37.54.12.4

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDatabase } from './db.js';
import { resolveMySqlColumnType } from './database/mysql-schema.js';
import {
  WAVE11_EVALUATION_FOUNDATION_MYSQL_COLUMN_TYPES,
} from './migrations/sales-customer-wave11-credit-evaluation-foundation.js';
import {
  WAVE11_EVALUATION_RESULT_MYSQL_COLUMN_TYPES,
} from './migrations/sales-customer-wave11-credit-evaluation-result-application.js';
import {
  WAVE11_RECONCILIATION_MYSQL_COLUMN_TYPES,
} from './migrations/sales-customer-wave11-credit-reconciliation.js';

const PINNED = Object.freeze({
  ...WAVE11_EVALUATION_FOUNDATION_MYSQL_COLUMN_TYPES,
  ...WAVE11_EVALUATION_RESULT_MYSQL_COLUMN_TYPES,
  ...WAVE11_RECONCILIATION_MYSQL_COLUMN_TYPES,
});

const MIGRATION_FILES = Object.freeze([
  './migrations/sales-customer-wave11-credit-evaluation-foundation.js',
  './migrations/sales-customer-wave11-credit-evaluation-result-application.js',
  './migrations/sales-customer-wave11-credit-reconciliation.js',
]);

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

function readTableShape(db, table) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all();
  const indexes = db.prepare(`PRAGMA index_list(${quote(table)})`).all()
    .filter((index) => index.origin !== 'pk')
    .map((index) => db.prepare(`PRAGMA index_info(${quote(index.name)})`).all()
      .sort((left, right) => left.seqno - right.seqno).map((row) => row.name));
  const indexed = new Set([
    ...indexes.flat(),
    ...foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
  return { sql, columns, indexed };
}

// The MySQL block is the LAST `CREATE TABLE IF NOT EXISTS <table> (` in the
// file: the migration carries the SQLite DDL first and the hand-written MySQL
// DDL after it.
function mysqlCreateBlock(source, table) {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return null;
  const match = source.slice(start).match(/\(([\s\S]*?)\)\s*ENGINE=InnoDB/);
  return match ? match[1] : null;
}

test('Wave 11 MySQL type contract: pinned map, snapshot materialization and the hand-written DDL are one fact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-mysql-types-'));
  let db;
  try {
    db = createDatabase(join(dir, 'types.db'));
    for (const [table, map] of Object.entries(PINNED)) {
      const shape = readTableShape(db, table);
      assert.ok(shape.columns.length > 0, `${table} must exist in the canonical SQLite schema`);
      for (const column of shape.columns) {
        const snapshotType = resolveMySqlColumnType(column, shape.indexed.has(column.name), table);
        assert.equal(
          snapshotType,
          map[column.name],
          `${table}.${column.name}: the pinned type must equal what the snapshot bootstrap materializes`,
        );
        if (shape.indexed.has(column.name)) {
          assert.doesNotMatch(
            String(map[column.name]),
            /^LONGTEXT$/i,
            `${table}.${column.name}: an indexed text column may not be LONGTEXT in InnoDB`,
          );
        }
      }
    }
  } finally {
    try { db?.close(); } catch { /* the fixture may already be closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Wave 11 MySQL type contract: every hand-written MySQL DDL column matches the pinned map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-mysql-ddl-'));
  let db;
  try {
    db = createDatabase(join(dir, 'ddl.db'));
    for (const relative of MIGRATION_FILES) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
      for (const [table, map] of Object.entries(PINNED)) {
        const block = mysqlCreateBlock(source, table);
        if (!block) continue;
        const shape = readTableShape(db, table);
        for (const column of shape.columns) {
          const literal = block.match(new RegExp(`\\b${column.name}\\s+(VARCHAR\\(\\d+\\)|LONGTEXT|BIGINT|JSON|CHAR\\(\\d+\\)|TEXT)`, 'i'));
          assert.ok(literal, `${relative}: ${table}.${column.name} must appear in the MySQL DDL`);
          assert.equal(
            literal[1].toUpperCase(),
            String(map[column.name]).toUpperCase(),
            `${relative}: ${table}.${column.name} DDL type must equal the pinned type`,
          );
        }
      }
    }
  } finally {
    try { db?.close(); } catch { /* the fixture may already be closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Wave 11 MySQL type contract: the pinned tables are registered in the canonical resolver', () => {
  // A pinned table that the resolver does not know about would silently fall
  // back to the generic heuristic, and the snapshot path would then drift
  // from the migration's own DDL again.
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-mysql-pin-'));
  let db;
  try {
    db = createDatabase(join(dir, 'pin.db'));
    for (const [table, map] of Object.entries(PINNED)) {
      const shape = readTableShape(db, table);
      for (const column of shape.columns) {
        const resolved = resolveMySqlColumnType(column, shape.indexed.has(column.name), table);
        assert.equal(
          resolved,
          map[column.name],
          `${table}.${column.name}: the canonical resolver must return the pinned type for a pinned table`,
        );
      }
    }
  } finally {
    try { db?.close(); } catch { /* the fixture may already be closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Wave 11 deferred foreign key: credit_profile_ratings carries EXACTLY ONE deferred foreign key', () => {
  // The SQLite snapshot's MySQL DDL carries every foreign key WITHOUT its
  // constraint name, so MySQL auto-names it. A migration that looks the
  // deferred key up by name alone therefore misses it on a
  // snapshot-bootstrapped database and adds a SECOND foreign key on the same
  // column — which the frozen Wave 9 foreign-key-set assertion then refuses.
  // This guard pins the invariant that makes the fix observable offline:
  // exactly ONE foreign key leaves `evaluation_result_id`.
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-w11-deferred-fk-'));
  let db;
  try {
    db = createDatabase(join(dir, 'deferred.db'));
    const fks = db.prepare('PRAGMA foreign_key_list(credit_profile_ratings)').all();
    const deferred = fks.filter((row) => row.from === 'evaluation_result_id');
    assert.equal(deferred.length, 1, 'exactly one foreign key may leave evaluation_result_id');
    assert.equal(deferred[0].table, 'credit_evaluation_result');
    assert.equal(deferred[0].to, 'id');
    assert.equal(fks.length, 3, 'credit_profile_ratings carries its two base foreign keys plus the deferred one');
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_profile_ratings'").get().sql;
    assert.match(
      ddl,
      /CONSTRAINT\s+fk_credit_profile_ratings_evaluation_result/,
      'the deferred foreign key must carry its canonical constraint name',
    );
  } finally {
    try { db?.close(); } catch { /* the fixture may already be closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
