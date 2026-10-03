// Test-only worker that mirrors the recovery contract of server/database/mysql-worker.js
// without a real MySQL backend. Control is exposed via the regular adapter
// surface by using two reserved SQL shapes that this fixture recognises:
//   SELECT 1 FROM __recovery_inject_op_error WHERE code = ?
//   SELECT 1 FROM __recovery_inject_session_error WHERE code = ?
//   SELECT 1 FROM __recovery_kill_active_session WHERE reason = ?
//   SELECT 1 FROM __recovery_get_state
//
// The fixtures expose observable session counters so tests can prove:
//   * session settings ran after every reconnect, not only at bootstrap
//   * read-only queries auto-retry exactly once after a recoverable error
//   * mutations and exec never replay
//   * transaction state resets on connection loss
//
// IMPORTANT: This file is intentionally kept in lock-step with the real
// worker's contract. The real worker is exercised end-to-end in the
// disposable MySQL integration test (server/mysql-v162-connection-recovery.integration.js).
// The helpers `isRecoverableConnectionError` / `isReadOnlySql` /
// `classifyExecStatement` are imported from the real worker module to ensure
// a single source of truth for the recovery policy.

import { parentPort } from 'node:worker_threads';
import { encodeWorkerResponse } from '../mysql-worker-protocol.js';
import {
  classifyExecStatement,
  isReadOnlySql,
  isRecoverableConnectionError,
} from '../mysql-worker.js';

const SESSION_TIMEZONE = '+00:00';
const SESSION_ISOLATION_LEVEL = 'READ COMMITTED';
const SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2;

const state = {
  sessionCount: 0,
  failedSessions: 0,
  sessionApplied: [],
  retryObservations: [],
  operationLog: [],
  inTransaction: false,
  closed: false,
  _activeSession: null,
  _storedConfig: null,
  nextOperationError: null,
  nextConnectionError: null,
};

function makeFailingError(code) {
  const err = new Error(`fixture: simulated ${code}`);
  err.code = code;
  err.fatal = true;
  return err;
}

function openSession(config) {
  state.sessionCount += 1;
  state._activeSession = { config, session: state.sessionCount };
  state.sessionApplied.push({
    session: state.sessionCount,
    timeZone: SESSION_TIMEZONE,
    isolation: SESSION_ISOLATION_LEVEL,
    innodbLockWaitTimeout: SESSION_INNODB_LOCK_WAIT_TIMEOUT,
  });
  return state._activeSession;
}

function dropSession(reason) {
  if (!state._activeSession) return;
  state._activeSession = null;
  if (state.inTransaction) state.inTransaction = false;
  state.operationLog.push({ event: 'session_lost', reason });
}

async function ensureSession() {
  if (state.closed) throw new Error('MySQL adapter is closed');
  if (state._activeSession) return state._activeSession;
  if (state.nextConnectionError) {
    const code = state.nextConnectionError;
    state.nextConnectionError = null;
    state.failedSessions += 1;
    throw makeFailingError(code);
  }
  return openSession(state._storedConfig);
}

async function runQuery(sql, params) {
  const session = await ensureSession();
  if (state.nextOperationError) {
    const code = state.nextOperationError;
    state.nextOperationError = null;
    throw makeFailingError(code);
  }

  const head = String(sql || '').trim().replace(/^[\s(]+/, '').toUpperCase();

  // Control surface: the fixture recognises a few reserved SELECT shapes.
  if (/FROM __recovery_inject_op_error\b/i.test(head)) {
    state.nextOperationError = String(params?.[0] || 'PROTOCOL_CONNECTION_LOST');
    state.operationLog.push({ event: 'control', name: 'inject_op_error', code: state.nextOperationError });
    return { rows: [{ ok: 1 }] };
  }
  if (/FROM __recovery_inject_session_error\b/i.test(head)) {
    state.nextConnectionError = String(params?.[0] || 'PROTOCOL_CONNECTION_LOST');
    state.operationLog.push({ event: 'control', name: 'inject_session_error', code: state.nextConnectionError });
    return { rows: [{ ok: 1 }] };
  }
  if (/FROM __recovery_kill_active_session\b/i.test(head)) {
    dropSession(String(params?.[0] || 'fixture_kill'));
    return { rows: [{ ok: 1 }] };
  }
  if (/FROM __recovery_get_state\b/i.test(head)) {
    return { rows: [{ snapshot: JSON.stringify(publicState()) }] };
  }
  if (/FROM __recovery_set_in_transaction\b/i.test(head)) {
    state.inTransaction = String(params?.[0]) === 'true';
    return { rows: [{ ok: 1 }] };
  }

  state.operationLog.push({
    event: 'query',
    session: session.session,
    readOnly: isReadOnlySql(sql),
    head: head.split(/\s+/, 2)[0],
  });

  if (/^SELECT\b/.test(head) || /^WITH\b/.test(head)) {
    return { rows: [{ id: session.session, kind: 'select' }] };
  }
  if (/^SHOW\b/.test(head)) {
    return { rows: [{ value: 'session-set' }] };
  }
  return { result: { changes: 0, lastInsertRowid: 0 } };
}

async function runAllocateSequence(documentType, periodKey) {
  const session = await ensureSession();
  if (state.nextOperationError) {
    const code = state.nextOperationError;
    state.nextOperationError = null;
    throw makeFailingError(code);
  }
  state.operationLog.push({ event: 'allocate_sequence', session: session.session });
  return { row: { allocated: session.session } };
}

async function runExec(sql) {
  const session = await ensureSession();
  if (state.nextOperationError) {
    const code = state.nextOperationError;
    state.nextOperationError = null;
    throw makeFailingError(code);
  }
  const classification = classifyExecStatement(sql);
  state.operationLog.push({ event: 'exec', session: session.session, classification });
  if (classification === 'BEGIN') state.inTransaction = true;
  if (classification === 'COMMIT' || classification === 'ROLLBACK') state.inTransaction = false;
}

function publicState() {
  return {
    sessionCount: state.sessionCount,
    failedSessions: state.failedSessions,
    sessionApplied: state.sessionApplied,
    retryObservations: state.retryObservations,
    operationLog: state.operationLog,
    inTransaction: state.inTransaction,
    closed: state.closed,
    activeSession: state._activeSession?.session || null,
  };
}

if (parentPort) {
  parentPort.on('message', async ({ action, payload, shared, requestId }) => {
    try {
      if (action === 'connect') {
        state._storedConfig = payload;
        openSession(payload);
        encodeWorkerResponse(shared, requestId, { connected: true, session: state.sessionCount });
        return;
      }

      if (action === 'close') {
        state.closed = true;
        state._activeSession = null;
        state.inTransaction = false;
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
          if (!isRecoverableConnectionError(error) || state.inTransaction || !readOnly) {
            if (isRecoverableConnectionError(error)) dropSession(error?.code);
            throw error;
          }
          dropSession(error?.code);
          state.retryObservations.push({ sql: String(sql || ''), code: error?.code });
          const result = await runQuery(sql, params);
          encodeWorkerResponse(shared, requestId, result);
          return;
        }
      }

      if (action === 'allocateSequence') {
        try {
          const result = await runAllocateSequence(payload.documentType, payload.periodKey);
          encodeWorkerResponse(shared, requestId, result);
          return;
        } catch (error) {
          if (isRecoverableConnectionError(error)) dropSession(error?.code);
          throw error;
        }
      }

      if (action === 'exec') {
        const classification = classifyExecStatement(payload.sql);
        try {
          await runExec(payload.sql);
        } catch (error) {
          if (isRecoverableConnectionError(error)) dropSession(error?.code);
          throw error;
        }
        if (classification === 'BEGIN') state.inTransaction = true;
        if (classification === 'COMMIT' || classification === 'ROLLBACK') state.inTransaction = false;
        encodeWorkerResponse(shared, requestId, { ok: true, inTransaction: state.inTransaction });
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
      }, 2);
    }
  });
}
