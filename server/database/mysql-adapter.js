import { Worker } from 'node:worker_threads';
import { captureSqliteSnapshot, bootstrapMySql } from './mysql-schema.js';

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
  constructor(config) {
    this.dialect = 'mysql';
    this.isTransaction = false;
    this.closed = false;
    this.worker = new Worker(new URL('./mysql-worker.js', import.meta.url), {
      type: 'module',
      // Test runners and hosting shells inject flags that Worker rejects.
      // The database worker needs no parent process flags.
      execArgv: [],
    });
    this._request('connect', config);
  }

  _request(action, payload = {}) {
    if (this.closed && action !== 'close') throw new Error('MySQL database is closed');
    const shared = new SharedArrayBuffer(8 + RESPONSE_BYTES);
    const state = new Int32Array(shared, 0, 2);
    this.worker.postMessage({ action, payload, shared });
    const wait = Atomics.wait(state, 0, 0, 60_000);
    if (wait === 'timed-out') throw new Error(`MySQL ${action} timed out after 60 seconds`);
    const length = Atomics.load(state, 1);
    const decoded = new TextDecoder().decode(new Uint8Array(shared, 8, length));
    const response = decoded ? JSON.parse(decoded) : {};
    if (Atomics.load(state, 0) === 2) {
      const error = new Error(response.message || 'MySQL operation failed');
      Object.assign(error, response);
      throw error;
    }
    return response;
  }

  _query(sql, params) {
    return this._request('query', { sql, params });
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
    return adapter;
  } catch (error) {
    adapter.close();
    throw error;
  }
}
