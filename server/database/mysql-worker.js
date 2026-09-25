import { parentPort } from 'node:worker_threads';
import mysql from 'mysql2/promise';

let connection;

function encode(shared, value, status = 1) {
  const state = new Int32Array(shared, 0, 2);
  const output = new Uint8Array(shared, 8);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > output.length) {
    const fallback = new TextEncoder().encode(JSON.stringify({ message: `MySQL adapter response exceeded ${output.length} bytes` }));
    output.set(fallback.subarray(0, output.length));
    Atomics.store(state, 1, Math.min(fallback.length, output.length));
    Atomics.store(state, 0, 2);
  } else {
    output.set(bytes);
    Atomics.store(state, 1, bytes.length);
    Atomics.store(state, 0, status);
  }
  Atomics.notify(state, 0);
}

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

parentPort.on('message', async ({ action, payload, shared }) => {
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
      encode(shared, { connected: true });
      return;
    }
    if (!connection) throw new Error('MySQL adapter is not connected');
    if (action === 'query') {
      const [rows] = await connection.query(payload.sql, payload.params || []);
      if (Array.isArray(rows)) encode(shared, { rows });
      else encode(shared, { result: { changes: rows.affectedRows || 0, lastInsertRowid: rows.insertId || 0 } });
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
      encode(shared, { row: rows[0] });
      return;
    }
    if (action === 'exec') {
      await connection.query(payload.sql);
      encode(shared, { ok: true });
      return;
    }
    if (action === 'close') {
      await connection.end();
      connection = undefined;
      encode(shared, { closed: true });
      return;
    }
    throw new Error(`Unknown MySQL worker action: ${action}`);
  } catch (error) {
    encode(shared, serializableError(error), 2);
  }
});
