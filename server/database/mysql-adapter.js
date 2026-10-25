import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { captureSqliteSnapshot, bootstrapMySql } from './mysql-schema.js';
import { createStructuredLogger, safeSqlLabel } from '../lib/logger.js';
import {
  ensureV14E2CanonicalRolePermissions,
  ensureV14E2ConfirmPermission,
  migrateV14E2BusinessDate,
} from '../migrations/v14-e2-business-date.js';
import {
  MYSQL_RESPONSE_HEADER_BYTES,
  abandonWorkerRequest,
  beginWorkerRequest,
  readWorkerResponse,
} from './mysql-worker-protocol.js';

const RESPONSE_BYTES = 16 * 1024 * 1024;

export function translateSqliteSql(sql) {
  let translated = String(sql).trim();
  const needsSyntheticId = /\b(?:INSERT(?:\s+OR\s+(?:IGNORE|REPLACE))?|REPLACE)\s+INTO\s+(?:inventory|inventory_period_closures|period_closures)\s*\((?!\s*id\s*,)/i.test(translated);
  translated = translated.replace(
    /SELECT\s+1\s+FROM\s+pragma_table_info\s*\(\s*\?\s*\)\s+WHERE\s+name\s*=\s*('(?:''|[^'])*')/gi,
    'SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=$1',
  );
  translated = translated.replace(
    /^PRAGMA\s+table_info\s*\(\s*([a-zA-Z_][\w]*)\s*\)\s*;?$/i,
    "SELECT column_name name,data_type type,(is_nullable='NO') AS `notnull`,column_default dflt_value,ordinal_position-1 cid FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='$1' ORDER BY ordinal_position",
  );
  translated = translated.replace(
    /SELECT\s+1\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*/gi,
    'SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=',
  );
  translated = translated.replace(
    /SELECT\s+1\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'index'\s+AND\s+name\s*=\s*/gi,
    'SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name=',
  );
  translated = translated.replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'START TRANSACTION');
  translated = translated.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  translated = translated.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE');
  translated = translated.replace(
    /\b(INSERT(?:\s+IGNORE)?|REPLACE)\s+INTO\s+(inventory|inventory_period_closures|period_closures)\s*\((?!\s*id\s*,)/gi,
    '$1 INTO $2(id,',
  );
  if (needsSyntheticId) {
    translated = translated.replace(/\bVALUES\s*\(/i, 'VALUES(UUID(),');
  }
  translated = translated.replace(/\s+COLLATE\s+NOCASE\b/gi, '');
  translated = translated.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  translated = translated.replace(/date\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE');
  translated = translated.replace(/\bMAX\s*\(\s*0\s*,/gi, 'GREATEST(0,');
  translated = translated.replace(/\bMIN\s*\(\s*0\s*,/gi, 'LEAST(0,');
  translated = translated.replace(/CAST\s*\(([^)]+)\s+AS\s+INTEGER\s*\)/gi, 'CAST($1 AS SIGNED)');
  if (/\bON\s+CONFLICT\s*(?:\([^)]+\))?\s+DO\s+NOTHING\b/i.test(translated)) {
    translated = translated.replace(/\s+ON\s+CONFLICT\s*(?:\([^)]+\))?\s+DO\s+NOTHING\b/gi, '');
    translated = translated.replace(/^INSERT\s+INTO\b/i, 'INSERT IGNORE INTO');
  }
  translated = translated.replace(
    /\bON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET\s+([\s\S]+)$/i,
    (_match, assignments) => `ON DUPLICATE KEY UPDATE ${assignments.replace(/\bexcluded\.([a-zA-Z_][\w]*)/gi, 'VALUES($1)')}`,
  );
  return translated;
}

class MySqlStatement {
  constructor(adapter, sql) {
    this.adapter = adapter;
    this.originalSql = String(sql);
    this.sql = translateSqliteSql(sql);
  }

  run(...params) {
    return this.adapter._query(this.sql, params).result;
  }

  get(...params) {
    if (/\bINSERT\s+INTO\s+document_sequences\b/i.test(this.originalSql) && /\bRETURNING\s+next_value\s*-\s*1\s+allocated\b/i.test(this.originalSql)) {
      return this.adapter._request('allocateSequence', { documentType: params[0], periodKey: params[1] }).row;
    }
    return this.adapter._query(this.sql, params).rows?.[0];
  }

  all(...params) {
    return this.adapter._query(this.sql, params).rows || [];
  }
}

export class MySqlSyncAdapter {
  constructor(config, { workerUrl = new URL('./mysql-worker.js', import.meta.url), requestTimeoutMs = 60_000 } = {}) {
    this.dialect = 'mysql';
    this.isTransaction = false;
    this.closed = false;
    this.requestId = 0;
    this.requestTimeoutMs = requestTimeoutMs;
    // Transaction lifecycle safety (§37.31 R6). `sessionState` is a conservative
    // permit derived only from acknowledged Worker responses and from the
    // adapter's own request-outcome classification. It is never a probe of
    // server state and it never overrides `isTransaction`, which remains the
    // canonical transaction mirror.
    this.sessionState = 'FRESH';
    this.sessionEpoch = null;
    this.quarantined = false;
    this.quarantineState = null;
    this.admissionRefusalCount = 0;
    const configuredSlowQueryMs = Number(process.env.SLOW_QUERY_MS || 500);
    this.slowQueryMs = Number.isSafeInteger(configuredSlowQueryMs) && configuredSlowQueryMs >= 1 && configuredSlowQueryMs <= 300_000
      ? configuredSlowQueryMs : 500;
    this.logger = createStructuredLogger();
    // One response buffer per adapter, reused across every _request call.
    // Allocating a fresh large SharedArrayBuffer per call fragmented
    // V8's ArrayBuffer pool and surfaced as "Array buffer allocation failed"
    // under the 20-writer Phase 7C benchmark (real run: 224 otherUnclassified +
    // 38 retryExhausted at 20 writers). Reusing the buffer keeps the same
    // truncation cap and synchronous Atomics.wait/notify contract. The small
    // header also carries request generations so late responses are discarded.
    this.responseBuffer = new SharedArrayBuffer(MYSQL_RESPONSE_HEADER_BYTES + RESPONSE_BYTES);
    this.responseState = beginWorkerRequest(this.responseBuffer, 0);
    this.worker = new Worker(workerUrl, {
      type: 'module',
      // Test runners and hosting shells inject flags that Worker rejects.
      // The database worker needs no parent process flags.
      execArgv: [],
    });
    this._request('connect', config);
  }

  // A quarantined adapter is terminal for this instance. It refuses every
  // further statement, and the Worker thread is terminated so the MySQL
  // session is destroyed and the server reclaims whatever it still held.
  quarantine(reason) {
    if (this.quarantineState) return this.quarantineState;
    this.quarantined = true;
    this.closed = true;
    this.sessionState = 'QUARANTINED';
    const state = {
      reason: String(reason || 'unknown'),
      at: new Date().toISOString(),
      state: 'TERMINATION_PENDING',
      termination: null,
      errorCode: null,
    };
    this.quarantineState = state;
    this.logger.error('mysql_session_quarantined', { reason: state.reason });
    state.termination = Promise.resolve()
      .then(() => this.worker.terminate())
      .then(() => {
        state.state = 'TERMINATION_CONFIRMED';
        this.sessionState = 'TERMINATED';
      })
      .catch((error) => {
        state.state = 'TERMINATION_FAILED';
        state.errorCode = error?.code || null;
        this.logger.error('mysql_session_teardown_failed', { reason: state.reason, code: state.errorCode });
      });
    return state;
  }

  // The session identity is owned by the Worker that owns the connection. A
  // changed epoch proves the session was replaced, so any response describing
  // the new session must never be read as evidence about the old one.
  _observeSessionEpoch(response) {
    if (typeof response?.sessionEpoch !== 'number') return;
    if (this.sessionEpoch !== null && response.sessionEpoch !== this.sessionEpoch) {
      this.sessionState = 'FRESH';
    }
    this.sessionEpoch = response.sessionEpoch;
  }

  _applyRequestFailure(error) {
    if (error?.mysqlRequestTimeout === true) {
      // The Worker may still be executing the statement. Its outcome is
      // indeterminate, so the session is no longer a trusted place to start a
      // transaction.
      this.sessionState = 'UNCERTAIN';
      return;
    }
    if (error?.sessionLost === true) {
      this.sessionState = 'UNCERTAIN';
      return;
    }
    if (error?.classification === 'COMMIT' || error?.classification === 'ROLLBACK') {
      // The server rejected the statement, so the transaction is still open.
      this.sessionState = 'ACTIVE';
    }
  }

  _request(action, payload = {}) {
    if (this.quarantined) {
      const error = new Error(`MySQL adapter is quarantined: ${this.quarantineState?.reason || 'unknown'}`);
      error.code = 'MYSQL_SESSION_QUARANTINED';
      throw error;
    }
    if (this.closed && action !== 'close') throw new Error('MySQL database is closed');
    this.requestId = this.requestId >= 0x7ffffffe ? 1 : this.requestId + 1;
    const requestId = this.requestId;
    const state = beginWorkerRequest(this.responseBuffer, requestId);
    this.worker.postMessage({ action, payload, shared: this.responseBuffer, requestId });
    const wait = Atomics.wait(state, 0, 0, this.requestTimeoutMs);
    if (wait === 'timed-out') {
      abandonWorkerRequest(state, requestId);
      const error = new Error(`MySQL ${action} timed out after ${this.requestTimeoutMs / 1000} seconds`);
      // A request timeout does NOT cancel the underlying MySQL statement.
      error.mysqlRequestTimeout = true;
      error.mysqlRequestTimeoutMs = this.requestTimeoutMs;
      this._applyRequestFailure(error);
      throw error;
    }
    const decoded = readWorkerResponse(this.responseBuffer, requestId);
    if (!decoded) {
      const error = new Error(`MySQL ${action} returned an invalid response generation`);
      this._applyRequestFailure(error);
      throw error;
    }
    const response = decoded.value;
    this._observeSessionEpoch(response);
    if (decoded.status === 2) {
      const error = new Error(response.message || 'MySQL operation failed');
      Object.assign(error, response);
      this._applyRequestFailure(error);
      throw error;
    }
    return response;
  }

  _query(sql, params) {
    const startedAt = performance.now();
    try {
      return this._request('query', { sql, params });
    } finally {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      if (Number.isFinite(this.slowQueryMs) && durationMs >= this.slowQueryMs) {
        this.logger.warn('slow_query', {
          durationMs,
          statement: safeSqlLabel(sql),
          fingerprint: createHash('sha256').update(String(sql).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16),
        });
      }
    }
  }

  prepare(sql) {
    return new MySqlStatement(this, sql);
  }

  exec(sql) {
    const translated = translateSqliteSql(sql);
    const result = this._request('exec', { sql: translated });
    // The Worker is the authoritative source for both the transaction mirror
    // and the exec classification (§37.31 R6). The parent never re-derives
    // the classification, so exactly one classifier exists.
    if (typeof result?.inTransaction === 'boolean') {
      this.isTransaction = result.inTransaction;
    }
    const classification = result?.classification;
    if (classification === 'BEGIN') this.sessionState = 'ACTIVE';
    else if (classification === 'COMMIT' || classification === 'ROLLBACK') this.sessionState = 'IDLE_TRUSTED';
    else if (this.sessionState === 'FRESH') this.sessionState = 'IDLE_TRUSTED';
    return result;
  }

  close() {
    if (this.closed) return;
    try { this._request('close'); } finally {
      this.closed = true;
      void this.worker.terminate();
    }
  }
}

export function createMySqlDatabase(config, { createSqliteSnapshot, seedDemo = false }) {
  const snapshot = captureSqliteSnapshot(createSqliteSnapshot, seedDemo);
  const adapter = new MySqlSyncAdapter({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  });
  try {
    bootstrapMySql(adapter, snapshot);
    // V1.4.1 hotfix — apply the V1.4-E2 additive migration against the LIVE
    // MySQL adapter. bootstrapMySql only manages CREATE TABLE IF NOT EXISTS,
    // which is a no-op for tables that already exist on an upgraded database;
    // on a fresh bootstrap the new columns are already part of the snapshot
    // (each addNullableTextColumn is idempotent — see
    // server/migrations/v14-e2-business-date.js). Re-running the same one
    // authoritative migration implementation guarantees that an existing
    // V1.3-style MySQL database gains the two business-date columns and the
    // canonical INVENTORY_TRANSFER_CONFIRM permission / role mapping without
    // duplicating schema or permission rows.
    migrateV14E2BusinessDate(adapter);
    ensureV14E2ConfirmPermission(adapter);
    ensureV14E2CanonicalRolePermissions(adapter);
    return adapter;
  } catch (error) {
    adapter.close();
    throw error;
  }
}
