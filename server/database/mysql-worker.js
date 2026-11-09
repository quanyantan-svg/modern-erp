import { parentPort } from 'node:worker_threads';
import mysql from 'mysql2/promise';
import { encodeWorkerResponse } from './mysql-worker-protocol.js';
import { createStructuredLogger } from '../lib/logger.js';
import {
  classifyExecStatement,
  isReadOnlySql,
  isRecoverableConnectionError,
} from './mysql-worker-policy.js';

const logger = createStructuredLogger();

// The recovery policy lives in ./mysql-worker-policy.js so that test fixture
// Workers can share exactly one source of truth without loading this entry
// point (whose parentPort registration would start a second, real MySQL
// client inside the fixture's Worker thread). The public exports are
// unchanged.
export { classifyExecStatement, isReadOnlySql, isRecoverableConnectionError };

// Application-required session state. Every newly created connection must
// apply these before being published as usable; otherwise a reconnect could
// silently downgrade isolation, lock waits or time zone semantics.
const SESSION_TIMEZONE = '+00:00';
const SESSION_ISOLATION_LEVEL = 'READ COMMITTED';
const SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2;

function serializableError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    errno: error?.errno,
    fatal: error?.fatal,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
    sql: error?.sql,
    // Transaction lifecycle safety (§37.31 R6): the Worker owns the canonical
    // exec classification and the canonical recoverable-connection decision,
    // so both are reported instead of being re-derived by the parent.
    classification: error?.classification,
    sessionLost: error?.sessionLost === true ? true : undefined,
    sessionEpoch,
  };
}

let connection;
let connectionConfig;
let inTransaction = false;
let closed = false;
// Monotonic identity of the current MySQL session. It is incremented by the
// Worker that owns the connection lifecycle, so a parent can prove whether a
// response came from the session that acquired a named lock or from a
// replacement session.
let sessionEpoch = 0;

function isConnectionAlive(conn) {
  if (!conn) return false;
  // mysql2.promise exposes a `stream` property whose destroyed flag is the
  // most reliable indication that the underlying socket is no longer usable.
  const stream = conn.stream;
  if (stream && stream.destroyed) return false;
  if (typeof conn.connection?.stream?.destroyed === 'boolean' && conn.connection.stream.destroyed) return false;
  return true;
}

async function applySession(conn) {
  await conn.query(`SET time_zone = '${SESSION_TIMEZONE}'`);
  await conn.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${SESSION_ISOLATION_LEVEL}`);
  await conn.query(`SET SESSION innodb_lock_wait_timeout = ${SESSION_INNODB_LOCK_WAIT_TIMEOUT}`);
}

async function openConnection(config) {
  const conn = await mysql.createConnection({
    ...config,
    multipleStatements: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    jsonStrings: true,
    charset: 'utf8mb4',
  });
  conn.on('error', (err) => {
    // Asynchronously flag a broken connection so the next request reconnects.
    // We must not throw or call encodeWorkerResponse here — this fires from
    // the event loop, not from the request handler.
    if (connection === conn) {
      connection = undefined;
      logger.warn('mysql_connection_lost', { code: err?.code, reason: 'socket_error' });
    }
  });
  await applySession(conn);
  sessionEpoch += 1;
  return conn;
}

function discardStaleConnection(reason, error) {
  // The owning session is gone. The parent must be able to tell that a named
  // lock held by this session can no longer be released by a replacement
  // session, so the marker travels with the error.
  if (error) error.sessionLost = true;
  if (!connection) return;
  const stale = connection;
  connection = undefined;
  if (inTransaction) {
    // Transaction can no longer be continued on a different socket.
    inTransaction = false;
    logger.warn('mysql_transaction_lost', { reason });
  }
  logger.warn('mysql_connection_lost', { code: reason || 'recoverable' });
  // Best-effort hard cleanup; do not block on a graceful .end() that may hang
  // on a half-broken socket.
  try {
    if (typeof stale.destroy === 'function') stale.destroy();
  } catch { /* ignore */ }
}

async function ensureConnection() {
  if (closed) throw new Error('MySQL adapter is closed');
  if (isConnectionAlive(connection)) return connection;
  if (!connectionConfig) throw new Error('MySQL adapter is not connected');
  logger.info('mysql_reconnect_attempt');
  try {
    connection = await openConnection(connectionConfig);
    logger.info('mysql_reconnect_success');
    return connection;
  } catch (error) {
    logger.warn('mysql_reconnect_failed', { code: error?.code, message: error?.message });
    throw error;
  }
}

async function runQuery(sql, params) {
  const conn = await ensureConnection();
  const [rows] = await conn.query(sql, params || []);
  if (Array.isArray(rows)) return { rows };
  return { result: { changes: rows.affectedRows || 0, lastInsertRowid: rows.insertId || 0 } };
}

async function runAllocateSequence(documentType, periodKey) {
  const conn = await ensureConnection();
  await conn.query(
    `INSERT INTO document_sequences(document_type,period_key,next_value)
     VALUES(?,?,2)
     ON DUPLICATE KEY UPDATE next_value=next_value+1`,
    [documentType, periodKey],
  );
  const [rows] = await conn.query(
    'SELECT next_value-1 allocated FROM document_sequences WHERE document_type=? AND period_key=?',
    [documentType, periodKey],
  );
  return { row: rows[0] };
}

async function runExec(sql) {
  const conn = await ensureConnection();
  await conn.query(sql);
}

if (parentPort) {
  parentPort.on('message', async ({ action, payload, shared, requestId }) => {
    try {
      if (action === 'connect') {
        if (connection) {
          // Re-using a live connection is safe but we re-apply session settings
          // defensively so a manual reconfigure never leaves stale state.
          await applySession(connection);
          encodeWorkerResponse(shared, requestId, { connected: true, sessionEpoch });
          return;
        }
        connectionConfig = payload;
        connection = await openConnection(payload);
        encodeWorkerResponse(shared, requestId, { connected: true, sessionEpoch });
        return;
      }

      if (action === 'close') {
        closed = true;
        if (connection) {
          try { await connection.end(); } catch { /* ignore */ }
          connection = undefined;
        }
        inTransaction = false;
        encodeWorkerResponse(shared, requestId, { closed: true, sessionEpoch });
        return;
      }

      if (action === 'query') {
        const { sql, params } = payload;
        const readOnly = isReadOnlySql(sql);
        try {
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, { ...result, sessionEpoch });
          return;
        } catch (error) {
          if (!isRecoverableConnectionError(error) || inTransaction || !readOnly) {
            if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code, error);
            throw error;
          }
          discardStaleConnection(error?.code);
          // Single recovery/retry decision for this failed request.
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, { ...result, sessionEpoch });
          return;
        }
      }

      if (action === 'allocateSequence') {
        // Mutations are NEVER replayed automatically: the INSERT ON DUPLICATE
        // KEY UPDATE may have already executed and incremented next_value.
        try {
          const result = await runAllocateSequence(payload.documentType, payload.periodKey);
          encodeWorkerResponse(shared, requestId, { ...result, sessionEpoch });
          return;
        } catch (error) {
          if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code, error);
          throw error;
        }
      }

      if (action === 'exec') {
        const classification = classifyExecStatement(payload.sql);
        try {
          await runExec(payload.sql);
        } catch (error) {
          // The classification is reported with the failure so the parent can
          // settle the session state without re-deriving it.
          error.classification = classification;
          if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code, error);
          throw error;
        }
        if (classification === 'BEGIN') inTransaction = true;
        if (classification === 'COMMIT' || classification === 'ROLLBACK') inTransaction = false;
        encodeWorkerResponse(shared, requestId, { ok: true, inTransaction, classification, sessionEpoch });
        return;
      }

      throw new Error(`Unknown MySQL worker action: ${action}`);
    } catch (error) {
      encodeWorkerResponse(shared, requestId, serializableError(error), 2);
    }
  });
}
