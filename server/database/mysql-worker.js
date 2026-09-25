import { parentPort } from 'node:worker_threads';
import mysql from 'mysql2/promise';
import { encodeWorkerResponse } from './mysql-worker-protocol.js';

let connection;

function serializableError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
    sql: error?.sql,
  };
}

parentPort.on('message', async ({ action, payload, shared, requestId }) => {
  try {
    if (action === 'connect') {
      connection = await mysql.createConnection({
        ...payload,
        multipleStatements: true,
        decimalNumbers: true,
        supportBigNumbers: true,
        bigNumberStrings: false,
        jsonStrings: true,
        charset: 'utf8mb4',
      });
      await connection.query("SET time_zone = '+00:00'");
      // READ COMMITTED avoids unnecessary gap locks for ERP point lookups while
      // explicit row locks protect every mutable business invariant.
      await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.query('SET SESSION innodb_lock_wait_timeout = 2');
      encodeWorkerResponse(shared, requestId, { connected: true });
      return;
    }
    if (!connection) throw new Error('MySQL adapter is not connected');
    if (action === 'query') {
      const [rows] = await connection.query(payload.sql, payload.params || []);
      if (Array.isArray(rows)) encodeWorkerResponse(shared, requestId, { rows });
      else encodeWorkerResponse(shared, requestId, { result: { changes: rows.affectedRows || 0, lastInsertRowid: rows.insertId || 0 } });
      return;
    }
    if (action === 'allocateSequence') {
      await connection.query(
        `INSERT INTO document_sequences(document_type,period_key,next_value)
         VALUES(?,?,2)
         ON DUPLICATE KEY UPDATE next_value=next_value+1`,
        [payload.documentType, payload.periodKey],
      );
      const [rows] = await connection.query(
        'SELECT next_value-1 allocated FROM document_sequences WHERE document_type=? AND period_key=?',
        [payload.documentType, payload.periodKey],
      );
      encodeWorkerResponse(shared, requestId, { row: rows[0] });
      return;
    }
    if (action === 'exec') {
      await connection.query(payload.sql);
      encodeWorkerResponse(shared, requestId, { ok: true });
      return;
    }
    if (action === 'close') {
      await connection.end();
      connection = undefined;
      encodeWorkerResponse(shared, requestId, { closed: true });
      return;
    }
    throw new Error(`Unknown MySQL worker action: ${action}`);
  } catch (error) {
    encodeWorkerResponse(shared, requestId, serializableError(error), 2);
  }
});
