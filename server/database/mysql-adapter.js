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

  _request(action, payload = {}) {
    if (this.closed && action !== 'close') throw new Error('MySQL database is closed');
    this.requestId = this.requestId >= 0x7ffffffe ? 1 : this.requestId + 1;
    const requestId = this.requestId;
    const state = beginWorkerRequest(this.responseBuffer, requestId);
    this.worker.postMessage({ action, payload, shared: this.responseBuffer, requestId });
    const wait = Atomics.wait(state, 0, 0, this.requestTimeoutMs);
    if (wait === 'timed-out') {
      abandonWorkerRequest(state, requestId);
      throw new Error(`MySQL ${action} timed out after ${this.requestTimeoutMs / 1000} seconds`);
    }
    const decoded = readWorkerResponse(this.responseBuffer, requestId);
    if (!decoded) throw new Error(`MySQL ${action} returned an invalid response generation`);
    const response = decoded.value;
    if (decoded.status === 2) {
      const error = new Error(response.message || 'MySQL operation failed');
      Object.assign(error, response);
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
    const normalized = translated.replace(/;\s*$/, '').trim().toUpperCase();
    const result = this._request('exec', { sql: translated });
    if (normalized === 'START TRANSACTION' || normalized === 'BEGIN') this.isTransaction = true;
    if (normalized === 'COMMIT' || normalized === 'ROLLBACK') this.isTransaction = false;
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
