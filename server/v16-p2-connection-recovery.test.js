import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  classifyExecStatement,
  isReadOnlySql,
  isRecoverableConnectionError,
} from './database/mysql-worker.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';

const FIXTURE_WORKER = new URL(
  './database/test-fixtures/recovery-mysql-worker.js',
  import.meta.url,
);

function controlSql(name) {
  switch (name) {
    case 'injectOpError':
      return 'SELECT 1 FROM __recovery_inject_op_error WHERE code = ?';
    case 'injectSessionError':
      return 'SELECT 1 FROM __recovery_inject_session_error WHERE code = ?';
    case 'killActiveSession':
      return 'SELECT 1 FROM __recovery_kill_active_session WHERE reason = ?';
    case 'getState':
      return 'SELECT 1 FROM __recovery_get_state';
    case 'setInTransaction':
      return 'SELECT 1 FROM __recovery_set_in_transaction WHERE flag = ?';
    default:
      throw new Error(`unknown control: ${name}`);
  }
}

function parseSnapshot(adapter) {
  const row = adapter.prepare(controlSql('getState')).get();
  return JSON.parse(row.snapshot);
}

const ALLOCATE_SQL = "INSERT INTO document_sequences(document_type,period_key,next_value) VALUES(?,?,1) RETURNING next_value-1 allocated";

describe('V1.6.2 Phase 2 — MySQL connection recovery helpers', { concurrency: false }, () => {
  test('isRecoverableConnectionError recognises transport / connection errors only', () => {
    for (const code of [
      'PROTOCOL_CONNECTION_LOST',
      'PROTOCOL_PACKETS_OUT_OF_ORDER',
      'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
      'PROTOCOL_ENQUEUE_AFTER_QUIT',
      'PROTOCOL_SEQUENCE_TIMEOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
    ]) {
      assert.equal(
        isRecoverableConnectionError({ code }),
        true,
        `expected ${code} to be a recoverable connection error`,
      );
    }
  });

  test('isRecoverableConnectionError also matches the textual "Server has gone away" / "Connection lost" family', () => {
    assert.equal(isRecoverableConnectionError({ message: 'Connection lost: The server closed the connection.' }), true);
    assert.equal(isRecoverableConnectionError({ message: 'Connection terminated unexpectedly' }), true);
    assert.equal(isRecoverableConnectionError({ message: 'Server has gone away' }), true);
    assert.equal(isRecoverableConnectionError({ message: 'Packets out of order' }), true);
  });

  test('isRecoverableConnectionError explicitly rejects business / SQL errors', () => {
    for (const code of [
      'ER_DUP_ENTRY',
      'ER_NO_REFERENCED_ROW_2',
      'ER_BAD_FIELD_ERROR',
      'ER_PARSE_ERROR',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'ER_ROW_IS_REFERENCED_2',
      'ER_TRUNCATED_WRONG_VALUE',
      'ER_SUBQUERY_NO_1_ROW',
    ]) {
      assert.equal(
        isRecoverableConnectionError({ code }),
        false,
        `${code} must NOT be classified as recoverable`,
      );
    }
    assert.equal(isRecoverableConnectionError({ message: 'syntax error at or near "FROM"' }), false);
    assert.equal(isRecoverableConnectionError({ message: 'Duplicate entry "x" for key "PRIMARY"' }), false);
    assert.equal(isRecoverableConnectionError(null), false);
    assert.equal(isRecoverableConnectionError(undefined), false);
  });

  test('isReadOnlySql conservatively classifies reads and rejects writes', () => {
    for (const sql of [
      'SELECT 1',
      'select id from users',
      '  SELECT * FROM orders',
      '(\nSELECT 1\n)',
      'WITH x AS (SELECT 1) SELECT * FROM x',
      'SHOW TABLES',
      'SHOW VARIABLES LIKE "version"',
      'DESCRIBE users',
      'DESC users',
      'EXPLAIN SELECT id FROM users',
      'explain select id from users',
    ]) {
      assert.equal(isReadOnlySql(sql), true, `expected read-only for: ${sql}`);
    }
    for (const sql of [
      'INSERT INTO users(name) VALUES (?)',
      'UPDATE users SET name = ?',
      'DELETE FROM users WHERE id = ?',
      'REPLACE INTO users(name) VALUES (?)',
      'TRUNCATE users',
      'CREATE TABLE x(id INT)',
      'DROP TABLE x',
      'ALTER TABLE x ADD COLUMN y INT',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      '',
      null,
    ]) {
      assert.equal(isReadOnlySql(sql), false, `expected write for: ${sql}`);
    }
  });

  test('classifyExecStatement identifies BEGIN / COMMIT / ROLLBACK vs OTHER', () => {
    assert.equal(classifyExecStatement('BEGIN'), 'BEGIN');
    assert.equal(classifyExecStatement('begin'), 'BEGIN');
    assert.equal(classifyExecStatement('START TRANSACTION'), 'BEGIN');
    assert.equal(classifyExecStatement('COMMIT'), 'COMMIT');
    assert.equal(classifyExecStatement('commit'), 'COMMIT');
    assert.equal(classifyExecStatement('ROLLBACK'), 'ROLLBACK');
    assert.equal(classifyExecStatement('COMMIT;'), 'COMMIT');
    assert.equal(classifyExecStatement('INSERT INTO x VALUES (1)'), 'OTHER');
    assert.equal(classifyExecStatement('SET time_zone = "+00:00"'), 'OTHER');
    assert.equal(classifyExecStatement(''), 'OTHER');
  });
});

describe('V1.6.2 Phase 2 — MySQL connection recovery worker behavior (fixture)', { concurrency: false }, () => {
  let adapter;

  beforeEach(() => {
    adapter = new MySqlSyncAdapter(
      { host: 'fixture', port: 0, user: 'fixture', password: 'fixture', database: 'fixture' },
      { workerUrl: FIXTURE_WORKER },
    );
  });
  afterEach(() => {
    try { adapter.close(); } catch { /* ignore */ }
  });

  test('1. session settings are retained and re-applied on every reconnect', () => {
    const initial = parseSnapshot(adapter);
    assert.equal(initial.sessionCount, 1, 'first session opened by connect action');
    assert.equal(initial.sessionApplied.length, 1);
    assert.equal(initial.sessionApplied[0].timeZone, '+00:00');
    assert.equal(initial.sessionApplied[0].isolation, 'READ COMMITTED');
    assert.equal(initial.sessionApplied[0].innodbLockWaitTimeout, 2);

    // Drop the active session and let the next read reconnect, twice. Each
    // reconnect must apply the canonical session settings again.
    adapter.prepare(controlSql('killActiveSession')).run('fixture_kill');
    adapter.prepare('SELECT 1 ready').get();
    adapter.prepare(controlSql('killActiveSession')).run('fixture_kill');
    adapter.prepare('SELECT 1 ready').get();

    const after = parseSnapshot(adapter);
    assert.equal(after.sessionApplied.length, 3, 'three total session-applied snapshots');
    for (const applied of after.sessionApplied) {
      assert.equal(applied.timeZone, '+00:00');
      assert.equal(applied.isolation, 'READ COMMITTED');
      assert.equal(applied.innodbLockWaitTimeout, 2);
    }
  });

  test('2. recoverable connection errors propagate the simulated code for exec (writes are NOT replayed)', () => {
    // A recoverable connection error on a write-class operation must surface
    // the simulated error code to the caller and MUST NOT silently replay the
    // statement on a fresh connection.
    adapter.prepare(controlSql('injectOpError')).run('PROTOCOL_CONNECTION_LOST');
    assert.throws(
      () => adapter.exec('COMMIT'),
      (err) => {
        assert.equal(err.code, 'PROTOCOL_CONNECTION_LOST');
        assert.ok(/simulated PROTOCOL_CONNECTION_LOST|fixture/.test(err.message));
        return true;
      },
    );
  });

  test('3. SELECT is classified conservatively as read-only and may retry at most once after reconnect', () => {
    const before = parseSnapshot(adapter);
    adapter.prepare(controlSql('injectOpError')).run('PROTOCOL_CONNECTION_LOST');
    const row = adapter.prepare('SELECT id FROM orders').get();
    assert.ok(row, 'read must succeed after one reconnect');
    const after = parseSnapshot(adapter);
    assert.equal(
      after.retryObservations.length,
      before.retryObservations.length + 1,
      'exactly one retry recorded',
    );
    assert.ok(row.id > before.sessionCount, 'connection id advanced past pre-failure session');
  });

  test('4. mutations / allocateSequence are NEVER replayed after an ambiguous connection error', () => {
    const before = parseSnapshot(adapter);
    adapter.prepare(controlSql('injectOpError')).run('PROTOCOL_CONNECTION_LOST');
    assert.throws(
      () => adapter.prepare(ALLOCATE_SQL).get('TEST', '2026-10-03'),
      (err) => err.code === 'PROTOCOL_CONNECTION_LOST',
    );
    const after = parseSnapshot(adapter);
    assert.equal(
      after.operationLog.filter((entry) => entry.event === 'allocate_sequence').length,
      before.operationLog.filter((entry) => entry.event === 'allocate_sequence').length,
      'allocateSequence must NOT silently replay after a recoverable error',
    );
    assert.equal(
      after.retryObservations.length,
      before.retryObservations.length,
      'no read-style retry may be applied to a mutation',
    );
  });

  test('5. exec (transaction control) is not silently replayed after a recoverable connection error', () => {
    const before = parseSnapshot(adapter);
    adapter.prepare(controlSql('injectOpError')).run('PROTOCOL_CONNECTION_LOST');
    assert.throws(() => adapter.exec('COMMIT'), (err) => err.code === 'PROTOCOL_CONNECTION_LOST');
    const after = parseSnapshot(adapter);
    assert.equal(
      after.operationLog.filter((entry) => entry.event === 'exec').length,
      before.operationLog.filter((entry) => entry.event === 'exec').length,
      'no silent replay of transaction-control exec',
    );
  });

  test('6. stale connection is cleared on error; a subsequent independent operation reconnects', () => {
    const before = parseSnapshot(adapter);
    const beforeSession = before.sessionCount;

    // Simulate MySQL closing the socket out from under us.
    adapter.prepare(controlSql('killActiveSession')).run('fixture_kill');

    // The very next read must re-establish the connection with a new session.
    const row = adapter.prepare('SELECT 1 ready').get();
    assert.ok(row, 'post-kill read succeeds via automatic reconnect');

    const after = parseSnapshot(adapter);
    assert.equal(after.activeSession, after.sessionCount, 'a fresh session is now active');
    assert.ok(after.sessionCount > beforeSession, 'session counter advanced after the kill');
  });

  test('7. explicit close() prevents future reconnect and surfaces "MySQL database is closed" semantics', () => {
    adapter.close();
    // Once closed, every operation must surface "MySQL database is closed"
    // and must NOT trigger another session.
    assert.throws(() => adapter.prepare('SELECT 1').all(), /MySQL database is closed/);
    assert.throws(() => adapter.exec('BEGIN'), /MySQL database is closed/);
    assert.throws(() => adapter.prepare(controlSql('getState')).get(), /MySQL database is closed/);
  });

  test('8. reads that occur inside an open transaction are NOT auto-retried', () => {
    // Start a transaction; the worker must remember it is in-transaction and
    // must not silently replay the read on a fresh connection.
    adapter.exec('START TRANSACTION');
    const before = parseSnapshot(adapter);
    assert.equal(before.inTransaction, true);

    adapter.prepare(controlSql('injectOpError')).run('PROTOCOL_CONNECTION_LOST');
    assert.throws(
      () => adapter.prepare('SELECT 1').get(),
      (err) => err.code === 'PROTOCOL_CONNECTION_LOST',
    );
    const after = parseSnapshot(adapter);
    assert.equal(
      after.retryObservations.length,
      before.retryObservations.length,
      'in-transaction reads must not be silently retried',
    );
    adapter.exec('ROLLBACK');
  });

  test('9. ordinary SQL errors never trigger a reconnect', () => {
    // Inject a non-recoverable business error code; the worker must surface
    // it and leave the session intact for subsequent calls.
    adapter.prepare(controlSql('injectOpError')).run('ER_DUP_ENTRY');
    assert.throws(
      () => adapter.prepare('SELECT 1').get(),
      (err) => err.code === 'ER_DUP_ENTRY',
    );
    // Subsequent call still works without an extra session-open.
    const row = adapter.prepare('SELECT 1 ready').get();
    assert.ok(row, 'healthy read after a non-recoverable error must keep working');
    const after = parseSnapshot(adapter);
    assert.equal(after.failedSessions, 0, 'no reconnect was triggered by a non-recoverable error');
  });
});
