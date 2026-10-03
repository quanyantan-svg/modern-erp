import { parentPort } from 'node:worker_threads';
import mysql from 'mysql2/promise';
import { encodeWorkerResponse } from './mysql-worker-protocol.js';
import { createStructuredLogger } from '../lib/logger.js';

const logger = createStructuredLogger();

// Codes that indicate a transport-level connection problem we can recover
// from by establishing a fresh MySQL session. Anything else (SQL constraint
// errors, parse errors, deadlock retries handled by the application layer)
// must not silently trigger a reconnect.
const RECOVERABLE_CONNECTION_CODES = new Set([
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
]);

// Application-required session state. Every newly created connection must
// apply these before being published as usable; otherwise a reconnect could
// silently downgrade isolation, lock waits or time zone semantics.
const SESSION_TIMEZONE = '+00:00';
const SESSION_ISOLATION_LEVEL = 'READ COMMITTED';
const SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2;

export function isRecoverableConnectionError(error) {
  if (!error) return false;
  if (typeof error.code === 'string' && RECOVERABLE_CONNECTION_CODES.has(error.code)) {
    return true;
  }
  // mysql2 sometimes surfaces a wrapped error without `code` but with `errno`
  // for protocol-level conditions.
  const message = String(error.message || '');
  if (/Connection lost|Connection terminated|Server has gone away|Packets out of order/i.test(message)) {
    return true;
  }
  return false;
}

// Conservative read-only classifier. Anything we cannot prove is a read is
// considered a write and is NOT auto-retried after a recoverable error.
export function isReadOnlySql(sql) {
  if (typeof sql !== 'string') return false;
  const head = sql.trim().replace(/^[\s(]+/, '').toUpperCase();
  return /^(SELECT|WITH)\b/.test(head)
    || /^SHOW\b/.test(head)
    || /^DESCRIBE\b/.test(head)
    || /^DESC\b/.test(head)
    || /^EXPLAIN\b/.test(head);
}

export function classifyExecStatement(sql) {
  const head = String(sql || '').trim().replace(/;\s*$/, '').replace(/^[\s(]+/, '').toUpperCase();
  if (/^BEGIN\b/.test(head) || /^START\s+TRANSACTION\b/.test(head)) return 'BEGIN';
  if (/^COMMIT\b/.test(head)) return 'COMMIT';
  if (/^ROLLBACK\b/.test(head)) return 'ROLLBACK';
  return 'OTHER';
}

function serializableError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    errno: error?.errno,
    fatal: error?.fatal,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
    sql: error?.sql,
  };
}

let connection;
let connectionConfig;
let inTransaction = false;
let closed = false;

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
  return conn;
}

function discardStaleConnection(reason) {
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
          encodeWorkerResponse(shared, requestId, { connected: true });
          return;
        }
        connectionConfig = payload;
        connection = await openConnection(payload);
        encodeWorkerResponse(shared, requestId, { connected: true });
        return;
      }

      if (action === 'close') {
        closed = true;
        if (connection) {
          try { await connection.end(); } catch { /* ignore */ }
          connection = undefined;
        }
        inTransaction = false;
        encodeWorkerResponse(shared, requestId, { closed: true });
        return;
      }

      if (action === 'query') {
        const { sql, params } = payload;
        const readOnly = isReadOnlySql(sql);
        try {
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, result);
          return;
        } catch (error) {
          if (!isRecoverableConnectionError(error) || inTransaction || !readOnly) {
            if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code);
            throw error;
          }
          discardStaleConnection(error?.code);
          // Single recovery/retry decision for this failed request.
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, result);
          return;
        }
      }

      if (action === 'allocateSequence') {
        // Mutations are NEVER replayed automatically: the INSERT ON DUPLICATE
        // KEY UPDATE may have already executed and incremented next_value.
        try {
          const result = await runAllocateSequence(payload.documentType, payload.periodKey);
          encodeWorkerResponse(shared, requestId, result);
          return;
        } catch (error) {
          if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code);
          throw error;
        }
      }

      if (action === 'exec') {
        const classification = classifyExecStatement(payload.sql);
        try {
          await runExec(payload.sql);
        } catch (error) {
          if (isRecoverableConnectionError(error)) discardStaleConnection(error?.code);
          throw error;
        }
        if (classification === 'BEGIN') inTransaction = true;
        if (classification === 'COMMIT' || classification === 'ROLLBACK') inTransaction = false;
        encodeWorkerResponse(shared, requestId, { ok: true, inTransaction });
        return;
      }

      throw new Error(`Unknown MySQL worker action: ${action}`);
    } catch (error) {
      encodeWorkerResponse(shared, requestId, serializableError(error), 2);
    }
  });
}
