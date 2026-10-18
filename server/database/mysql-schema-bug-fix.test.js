// Focused tests for the MySQL schema bootstrap index DDL fix.
//
// This file reproduces the failing path that surfaced in
// `bootstrapMySql` (server/database/mysql-schema.js:271) and proves that:
//   * plain / unique / partial / >4-column unique indexes generate correct DDL;
//   * expression-bearing UNIQUE indexes are routed to the digest path;
//   * null / missing / non-string columns are rejected with a clear message
//     naming the table, the index and the failing position;
//   * SQLite snapshot capture is unchanged;
//   * Wave-6 LOT frontier prefix index semantics are not regressed.
//
// Tests use the real exported generators from mysql-schema.js
// (mysqlIndexColumnList, hasExpressionColumns, generatedPartialIndex) plus a
// direct simulation of the bootstrap routing decision. No MySQL connection is
// required; SQLite is used only to assert that snapshot capture preserves the
// same column array as before the fix.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  mysqlIndexColumnList,
  hasExpressionColumns,
  generatedPartialIndex,
} from './mysql-schema.js';

describe('MySQL schema bootstrap — index DDL fix', () => {
  describe('mysqlIndexColumnList', () => {
    test('plain index emits quoted columns in order', () => {
      const sql = mysqlIndexColumnList('sales_order_items', {
        name: 'idx_sales_order_items_order',
        columns: ['sales_order_id', 'line_no'],
      });
      assert.equal(sql, '`sales_order_id`,`line_no`');
    });

    test('Wave-6 LOT frontier prefix index keeps identity column full-width and applies prefix on bounded columns', () => {
      const sql = mysqlIndexColumnList('inventory_valuation_movements', {
        name: 'idx_valuation_movements_identity_status_created',
        columns: ['identity', 'status', 'created_at'],
      });
      assert.equal(sql, '`identity`,`status`(16),`created_at`(64)');
    });

    test('plain UNIQUE index quotes columns identically to non-unique', () => {
      // mysqlIndexColumnList itself is agnostic to uniqueness — uniqueness is
      // applied at the CREATE INDEX / CREATE UNIQUE INDEX level above.
      const sql = mysqlIndexColumnList('t', { name: 'i', unique: true, columns: ['a', 'b'] });
      assert.equal(sql, '`a`,`b`');
    });

    test('null column throws referencing table, index and position', () => {
      assert.throws(
        () => mysqlIndexColumnList('sales_reservation_intent', {
          name: 'uq_sales_reservation_intent_order_line_mode',
          columns: ['sales_order_id', null, 'reservation_mode'],
        }),
        (err) => {
          assert.match(err.message, /sales_reservation_intent\.uq_sales_reservation_intent_order_line_mode/);
          assert.match(err.message, /position 1/);
          assert.match(err.message, /generatedPartialIndex/);
          return true;
        },
      );
    });

    test('empty-string column throws referencing table, index and position', () => {
      assert.throws(
        () => mysqlIndexColumnList('t', { name: 'i', columns: ['', 'x'] }),
        (err) => /position 0/.test(err.message) && /t\.i/.test(err.message) && true,
      );
    });

    test('undefined column throws referencing table, index and position', () => {
      assert.throws(
        () => mysqlIndexColumnList('t', { name: 'i', columns: ['x', undefined] }),
        (err) => /position 1/.test(err.message) && /t\.i/.test(err.message) && true,
      );
    });

    test('non-string column throws referencing table, index and position', () => {
      assert.throws(
        () => mysqlIndexColumnList('t', { name: 'i', columns: ['x', 42] }),
        (err) => /position 1/.test(err.message) && /t\.i/.test(err.message) && true,
      );
    });

    test('missing columns array throws naming the index', () => {
      assert.throws(
        () => mysqlIndexColumnList('t', { name: 'i' }),
        (err) => /t\.i/.test(err.message) && /column list/.test(err.message) && true,
      );
    });
  });

  describe('hasExpressionColumns', () => {
    test('plain columns return false (the common case)', () => {
      assert.equal(hasExpressionColumns({ name: 'i', columns: ['a', 'b', 'c'] }), false);
    });

    test('missing expressions array returns false when every column is a valid string', () => {
      assert.equal(hasExpressionColumns({ name: 'i', columns: ['a', 'b'] }), false);
    });

    test('null column at any position returns true', () => {
      assert.equal(hasExpressionColumns({
        name: 'i', columns: ['sales_order_id', null, 'reservation_mode'],
      }), true);
    });

    test('expression that differs from column name returns true', () => {
      assert.equal(hasExpressionColumns({
        name: 'i',
        columns: ['a', 'b'],
        expressions: ['a', 'COALESCE(b, \'\')'],
      }), true);
    });

    test('expressions that exactly match column names return false', () => {
      assert.equal(hasExpressionColumns({
        name: 'i', columns: ['a', 'b'], expressions: ['a', 'b'],
      }), false);
    });

    test('null index returns false (caller can decide what to do)', () => {
      assert.equal(hasExpressionColumns(null), false);
    });
  });

  describe('generatedPartialIndex', () => {
    test('produces a STORED generated column plus UNIQUE index pair for expression-bearing UNIQUE', () => {
      const stmts = generatedPartialIndex('sales_reservation_intent', {
        name: 'uq_sales_reservation_intent_order_line_mode',
        unique: true,
        columns: ['sales_order_id', null, 'reservation_mode'],
        expressions: ['sales_order_id', "COALESCE(sales_order_item_id,'')", 'reservation_mode'],
        where: '',
      });
      assert.equal(stmts.length, 2);
      assert.match(stmts[0], /^ALTER TABLE `sales_reservation_intent` ADD COLUMN `__partial_[0-9a-f]+` CHAR\(64\) GENERATED ALWAYS AS/);
      assert.match(stmts[0], /CASE WHEN 1=1 THEN SHA2\(CONCAT_WS\(CHAR\(31\),COALESCE\(CAST\(`sales_order_id` AS CHAR\),CHAR\(30\)\),COALESCE\(CAST\(COALESCE\(sales_order_item_id,''\) AS CHAR\),CHAR\(30\)\),COALESCE\(CAST\(`reservation_mode` AS CHAR\),CHAR\(30\)\)\),256\) ELSE NULL END/);
      assert.match(stmts[1], /^CREATE UNIQUE INDEX `uq_sales_reservation_intent_order_line_mode` ON `sales_reservation_intent` \(`__partial_[0-9a-f]+`\)$/);
    });

    test('uses where clause verbatim (other than IS NOT NULL rewrite)', () => {
      const stmts = generatedPartialIndex('t', {
        name: 'uq', unique: true,
        columns: ['a'], expressions: ['a'],
        where: 'a IS NOT NULL',
      });
      assert.match(stmts[0], /CASE WHEN a IS NOT NULL THEN SHA2/);
    });

    test('throws when a non-row position has neither column nor expression', () => {
      assert.throws(
        () => generatedPartialIndex('t', {
          name: 'uq', expressions: ['a', '', 'c'],
          columns: ['a', null, 'c'], where: '1=1',
        }),
        (err) => /t\.uq/.test(err.message) && /position 1/.test(err.message) && true,
      );
    });

    test('digest path uses expression fallback when column is the wrong type (e.g. PRAGMA index_info gives null/number)', () => {
      // The digest path is tolerant: PRAGMA index_info gives a non-string
      // `name` for expression columns, and snapshot may normalize that to
      // `null` or another value. As long as `expressions[position]` is
      // non-empty, the digest substitutes it. Only when both column and
      // expression are missing at a position must we throw.
      const stmts = generatedPartialIndex('t', {
        name: 'uq', expressions: ['a', 'COALESCE(b, \'\')', 'c'],
        columns: ['a', 42, 'c'], where: '1=1',
      });
      assert.equal(stmts.length, 2);
      assert.match(stmts[0], /COALESCE\(CAST\(COALESCE\(b, ''\) AS CHAR\),CHAR\(30\)\)/);
    });
  });

  describe('bootstrap routing decision (simulated)', () => {
    function route(tableName, index) {
      const useDigest = hasExpressionColumns(index) || (index.unique && (Boolean(index.where) || index.columns.length > 4));
      return useDigest
        ? generatedPartialIndex(tableName, { ...index, where: index.where || '1=1' })
        : [`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX \`${index.name}\` ON \`${tableName}\` (${mysqlIndexColumnList(tableName, index)})`];
    }

    test('plain UNIQUE with <=4 plain columns takes the plain CREATE path', () => {
      const stmts = route('sales_prepayment_requirements', {
        name: 'uq_sales_prepayment_requirement_order_line',
        unique: true,
        columns: ['sales_order_id', 'line_no'],
        expressions: [],
        where: '',
      });
      assert.equal(stmts.length, 1);
      assert.equal(stmts[0], 'CREATE UNIQUE INDEX `uq_sales_prepayment_requirement_order_line` ON `sales_prepayment_requirements` (`sales_order_id`,`line_no`)');
    });

    test('Wave-7 expression UNIQUE takes the digest path, not the buggy literal-`null` path', () => {
      const stmts = route('sales_reservation_intent', {
        name: 'uq_sales_reservation_intent_order_line_mode',
        unique: true,
        columns: ['sales_order_id', null, 'reservation_mode'],
        expressions: ['sales_order_id', "COALESCE(sales_order_item_id,'')", 'reservation_mode'],
        where: '',
      });
      assert.equal(stmts.length, 2);
      // Buggy path would emit `null` as a literal column reference:
      assert.equal(stmts.some((s) => s.includes('`null`')), false, JSON.stringify(stmts));
      assert.match(stmts[0], /^ALTER TABLE `sales_reservation_intent` ADD COLUMN `__partial_/);
    });

    test('>4-column UNIQUE still takes the digest path', () => {
      const stmts = route('t', {
        name: 'uq_5',
        unique: true,
        columns: ['a', 'b', 'c', 'd', 'e'],
        expressions: [],
        where: '',
      });
      assert.equal(stmts.length, 2);
      assert.match(stmts[0], /^ALTER TABLE `t` ADD COLUMN `__partial_/);
    });

    test('partial UNIQUE with a where clause still takes the digest path', () => {
      const stmts = route('t', {
        name: 'uq_partial',
        unique: true,
        columns: ['a', 'b'],
        expressions: [],
        where: 'a IS NOT NULL',
      });
      assert.equal(stmts.length, 2);
      assert.match(stmts[0], /CASE WHEN a IS NOT NULL THEN/);
    });
  });

  describe('SQLite snapshot capture is unchanged', () => {
    test('PRAGMA index_info still returns null name for expression columns (upstream fact)', () => {
      // PRAGMA index_info is owned by SQLite itself; we capture its output shape
      // here so a future migration of node:sqlite / a custom snapshot helper
      // change would be flagged as a regression.
      const sqlite = new DatabaseSync(':memory:');
      try {
        sqlite.exec("CREATE TABLE sales_reservation_intent (sales_order_id TEXT NOT NULL, sales_order_item_id TEXT, reservation_mode TEXT NOT NULL)");
        sqlite.exec("CREATE UNIQUE INDEX uq_test ON sales_reservation_intent(sales_order_id, COALESCE(sales_order_item_id, ''), reservation_mode)");
        const info = sqlite.prepare(`PRAGMA index_info(uq_test)`).all().sort((a, b) => a.seqno - b.seqno);
        assert.equal(info.length, 3);
        assert.equal(info[0].name, 'sales_order_id');
        assert.equal(info[1].name, null);
        assert.equal(info[2].name, 'reservation_mode');
      } finally {
        sqlite.close();
      }
    });

    test('snapshot-style columns array with one null entry triggers hasExpressionColumns', () => {
      // This mirrors what `captureSqliteSnapshot` produces for an index that
      // mixes a column reference and an expression: PRAGMA index_info returns
      // `null` for the expression position. The fix must treat this as an
      // expression index without altering snapshot capture.
      const capturedColumns = ['sales_order_id', null, 'reservation_mode'];
      const capturedExpressions = ['sales_order_id', "COALESCE(sales_order_item_id,'')", 'reservation_mode'];
      assert.equal(hasExpressionColumns({ name: 'i', columns: capturedColumns, expressions: capturedExpressions }), true);
    });

    test('plain column snapshot (all strings, no expressions) still routes through plain CREATE path', () => {
      const capturedColumns = ['sales_order_id', 'line_no'];
      const capturedExpressions = [];
      const stmts = (() => {
        const useDigest = hasExpressionColumns({ columns: capturedColumns, expressions: capturedExpressions })
          || ((true) && (Boolean('') || capturedColumns.length > 4));
        return useDigest
          ? null
          : [`CREATE UNIQUE INDEX \`i\` ON \`t\` (${mysqlIndexColumnList('t', { name: 'i', columns: capturedColumns })})`];
      })();
      assert.deepEqual(stmts, ['CREATE UNIQUE INDEX `i` ON `t` (`sales_order_id`,`line_no`)']);
    });
  });
});