// V1.6.2 Phase 2 — Real disposable MySQL connection recovery integration test.
//
// This test only runs when the protected disposable MySQL environment is
// configured (`ERP_DB_HOST` / `ERP_DB_PORT` / `ERP_DB_NAME` / `ERP_DB_USER` /
// `ERP_DB_PASSWORD` / `ERP_MYSQL_TEST_ALLOW_RESET=true`). The disposable
// database name must already match the existing test/disposable safety pattern
// (regex /test|phase7[abc]|disposable/i). This integration test never
// touches production-named databases (modern_erp, modern_erp_uat).
//
// Required behaviour:
//   * KILL the adapter's MySQL session via an independent control connection
//     using the same disposable credentials.
//   * Prove the next SELECT 1 read self-heals without restarting Node.
//   * Prove the connection ID advanced (fresh physical connection).
//   * Prove session settings (time zone, isolation, innodb_lock_wait_timeout)
//     are re-applied after the reconnect.
//   * Prove a transaction lost to a connection error is NOT silently continued
//     on a new connection and a subsequent independent request reconnects.

import assert from 'node:assert/strict';
import { createConnection } from 'mysql2/promise';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { resolveDatabaseConfig } from './database/config.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) {
  throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

const CONFIG = resolveDatabaseConfig({ backend: 'mysql' });
if (!/(?:test|phase7[abc]|disposable)/i.test(CONFIG.database)) {
  throw new Error(`Refusing real MySQL recovery test for non-test database: ${CONFIG.database}`);
}

async function openControlConnection() {
  return createConnection({
    host: CONFIG.host,
    port: CONFIG.port,
    database: CONFIG.database,
    user: CONFIG.user,
    password: CONFIG.password,
    charset: 'utf8mb4',
  });
}

function isolationReadUnquoted(db) {
  // MySQL 8 reports the transaction_isolation variable as a session system
  // variable; the literal may be enclosed in single quotes by @@session.
  const row = db.prepare("SELECT @@session.transaction_isolation AS level").get();
  return String(row.level).replace(/^['"]|['"]$/g, '').trim();
}

function lockWaitRead(db) {
  const row = db.prepare('SELECT @@session.innodb_lock_wait_timeout AS value').get();
  return Number(row.value);
}

describe('V1.6.2 Phase 2 — Real disposable MySQL connection recovery', () => {
  let handle;
  let adapter;
  let control;

  before(async () => {
    handle = createTempDb({ label: 'mysql-v162-recovery', production: true });
    adapter = new MySqlSyncAdapter({
      host: CONFIG.host,
      port: CONFIG.port,
      database: CONFIG.database,
      user: CONFIG.user,
      password: CONFIG.password,
    });
    control = await openControlConnection();
  });

  after(async () => {
    try { await control?.end(); } catch { /* ignore */ }
    try { adapter?.close(); } catch { /* ignore */ }
    handle?.cleanup();
  });

  test('initial session has application-required settings', () => {
    const adapterDb = adapter;
    const tz = adapterDb.prepare("SELECT @@session.time_zone AS value").get().value;
    assert.equal(String(tz).replace(/^['"]|['"]$/g, '').trim(), '+00:00');
    assert.equal(isolationReadUnquoted(adapterDb), 'READ-COMMITTED');
    assert.equal(lockWaitRead(adapterDb), 2);
  });

  test('killing the adapter session lets the next SELECT self-heal without restarting Node', async () => {
    const beforeId = adapter.prepare('SELECT CONNECTION_ID() AS id').get().id;
    assert.ok(Number.isInteger(beforeId) && beforeId > 0);

    // Kill ONLY the adapter's session, never an unrelated connection.
    const killed = await control.query(`KILL CONNECTION ${beforeId}`);
    assert.ok(Array.isArray(killed) || killed === undefined);

    // The next read must self-heal — no Node restart, no application close.
    const row = adapter.prepare('SELECT 1 AS ready').get();
    assert.equal(row?.ready, 1, 'post-kill SELECT 1 must succeed via reconnect');

    const afterId = adapter.prepare('SELECT CONNECTION_ID() AS id').get().id;
    assert.notEqual(afterId, beforeId, 'connection id must advance after a real reconnect');
    assert.ok(Number.isInteger(afterId) && afterId > 0);
  });

  test('session settings are re-applied after the reconnect', () => {
    const tz = adapter.prepare("SELECT @@session.time_zone AS value").get().value;
    assert.equal(String(tz).replace(/^['"]|['"]$/g, '').trim(), '+00:00');
    assert.equal(isolationReadUnquoted(adapter), 'READ-COMMITTED');
    assert.equal(lockWaitRead(adapter), 2);
  });

  test('a transaction lost to a connection error is NOT silently continued on a new connection', async () => {
    const sessionId = adapter.prepare('SELECT CONNECTION_ID() AS id').get().id;
    adapter.exec('START TRANSACTION');
    assert.equal(adapter.isTransaction, true, 'adapter must track open transaction');

    // Kill the transaction-owning session; COMMIT can no longer happen.
    await control.query(`KILL CONNECTION ${sessionId}`);

    // The very next statement fails safely; the worker must NOT pretend the
    // COMMIT succeeded and must reset its internal transaction state.
    assert.throws(
      () => adapter.exec('COMMIT'),
      (err) => err.code === 'PROTOCOL_CONNECTION_LOST'
        || err.code === 'PROTOCOL_ENQUEUE_AFTER_QUIT'
        || err.errno === 2013
        || err.errno === 2006
        || /Connection lost|Connection terminated|Server has gone away/i.test(err.message || ''),
      'transaction COMMIT after a kill must surface a recoverable error',
    );
    assert.equal(adapter.isTransaction, false, 'adapter.isTransaction must reset on worker-side transaction loss');

    // A later independent request must still be able to reconnect normally.
    const row = adapter.prepare('SELECT 1 AS ready').get();
    assert.equal(row?.ready, 1, 'post-transaction-loss SELECT 1 must succeed via reconnect');
  });
});
