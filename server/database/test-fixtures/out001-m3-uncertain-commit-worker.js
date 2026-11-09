// Test-only Worker for the OUT-001 M3 uncertain-COMMIT offline regression.
//
// It mirrors the recovery contract of server/database/mysql-worker.js — the
// classifiers are imported from the real worker so there is exactly one source
// of truth — and adds the two observable facts the M3 evidence needs:
//
//   · every opened session is reported to the parent, so a test can prove that
//     an uncertain COMMIT opened **no** new Worker session;
//   · every executed statement is reported with its canonical classification,
//     so a test can prove that no ROLLBACK was ever issued on the original
//     adapter and that the transaction work was not replayed.
//
// Control surface (recognised on the query path):
//   SELECT 1 FROM __m3_inject_op_error WHERE code = ?
//     → arms the next statement (query or exec) to fail with `code`. The
//     control statement itself always succeeds.
//
// IMPORTANT: this fixture never opens a real MySQL connection. It proves the
// control flow and the Worker/adapter contract only. The protected real-server
// evidence is the OUT-001 M3 case in server/mysql-out001.integration.js.

import { parentPort } from 'node:worker_threads';
import { encodeWorkerResponse } from '../mysql-worker-protocol.js';
import {
  classifyExecStatement,
  isReadOnlySql,
  isRecoverableConnectionError,
} from '../mysql-worker-policy.js';

const state = {
  sessionCount: 0,
  inTransaction: false,
  closed: false,
  nextOperationError: null,
  operationLog: [],
};

// The live session of this Worker. It is replaced only when the connection is
// discarded, exactly like the real worker's `connection` variable.
let activeSession = null;

function makeFailingError(code) {
  const error = new Error(`M3 fixture: simulated ${code}`);
  error.code = code;
  error.fatal = true;
  return error;
}

function openSession() {
  state.sessionCount += 1;
  parentPort?.postMessage({ event: 'session-opened', count: state.sessionCount });
  return { session: state.sessionCount };
}

function dropSession(reason, error) {
  // The real worker marks the surfaced error with `sessionLost` whenever it
  // discards a stale connection, so the parent can tell that the response
  // describes a replacement session and not the original one.
  if (error) error.sessionLost = true;
  activeSession = null;
  if (state.inTransaction) {
    state.inTransaction = false;
    state.operationLog.push({ event: 'session_lost', reason });
  }
}

async function ensureSession() {
  if (state.closed) throw new Error('MySQL adapter is closed');
  if (!activeSession) activeSession = openSession();
  // Every request reports the session it ran on. The parent may attach its
  // listener after the connect, so the session count is reported per request
  // and not only when a session is opened.
  parentPort?.postMessage({ event: 'session', count: activeSession.session });
  return activeSession;
}

async function runQuery(sql, params) {
  const session = await ensureSession();
  const head = String(sql || '').trim().replace(/^[\s(]+/, '').toUpperCase();
  if (/FROM __m3_inject_op_error\b/i.test(head)) {
    state.nextOperationError = String(params?.[0] || 'PROTOCOL_CONNECTION_LOST');
    state.operationLog.push({ event: 'control', name: 'inject_op_error', code: state.nextOperationError });
    return { rows: [{ ok: 1 }] };
  }
  if (/mysql_transaction_gates/i.test(head)) {
    // The canonical transaction gate row. A missing gate row would abort the
    // transaction before the business work runs.
    state.operationLog.push({ event: 'query', session: session.session, head: 'TRANSACTION_GATE' });
    return { rows: [{ gate_id: 1 }] };
  }
  if (state.nextOperationError) {
    const code = state.nextOperationError;
    state.nextOperationError = null;
    state.operationLog.push({ event: 'query_failed', session: session.session, code });
    throw makeFailingError(code);
  }
  state.operationLog.push({
    event: 'query', session: session.session, readOnly: isReadOnlySql(sql),
  });
  return { rows: [] };
}

async function runExec(sql) {
  const session = await ensureSession();
  const classification = classifyExecStatement(sql);
  parentPort?.postMessage({ event: 'statement', classification, session: session.session });
  if (state.nextOperationError) {
    const code = state.nextOperationError;
    state.nextOperationError = null;
    state.operationLog.push({ event: 'exec_failed', session: session.session, classification, code });
    throw makeFailingError(code);
  }
  state.operationLog.push({ event: 'exec', session: session.session, classification });
  if (classification === 'BEGIN') state.inTransaction = true;
  if (classification === 'COMMIT' || classification === 'ROLLBACK') state.inTransaction = false;
}

if (parentPort) {
  parentPort.on('message', async ({ action, payload, shared, requestId }) => {
    try {
      if (action === 'connect') {
        const session = await ensureSession();
        encodeWorkerResponse(shared, requestId, { connected: true, sessionEpoch: session.session });
        return;
      }
      if (action === 'close') {
        state.closed = true;
        state.inTransaction = false;
        encodeWorkerResponse(shared, requestId, { closed: true, sessionEpoch: state.sessionCount });
        return;
      }
      if (action === 'query') {
        const { sql, params } = payload;
        const readOnly = isReadOnlySql(sql);
        try {
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, { ...result, sessionEpoch: state.sessionCount });
          return;
        } catch (error) {
          if (!isRecoverableConnectionError(error) || state.inTransaction || !readOnly) {
            if (isRecoverableConnectionError(error)) dropSession(error?.code, error);
            throw error;
          }
          dropSession(error?.code);
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, { ...result, sessionEpoch: state.sessionCount });
          return;
        }
      }
      if (action === 'exec') {
        const classification = classifyExecStatement(payload.sql);
        try {
          await runExec(payload.sql);
        } catch (error) {
          error.classification = classification;
          if (isRecoverableConnectionError(error)) dropSession(error?.code, error);
          throw error;
        }
        if (classification === 'BEGIN') state.inTransaction = true;
        if (classification === 'COMMIT' || classification === 'ROLLBACK') state.inTransaction = false;
        encodeWorkerResponse(shared, requestId, {
          ok: true, inTransaction: state.inTransaction, classification, sessionEpoch: state.sessionCount,
        });
        return;
      }
      throw new Error(`Unknown fixture MySQL worker action: ${action}`);
    } catch (error) {
      encodeWorkerResponse(shared, requestId, {
        message: error?.message || String(error),
        code: error?.code,
        errno: error?.errno,
        sqlState: error?.sqlState,
        fatal: error?.fatal,
        classification: error?.classification,
        sessionLost: error?.sessionLost === true ? true : undefined,
        sessionEpoch: state.sessionCount,
      }, 2);
    }
  });
}
