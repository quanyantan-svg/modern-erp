import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import mysql from 'mysql2/promise';
import { resolveDatabaseConfig } from '../server/database/config.js';

process.env.ERP_DB_BACKEND = 'mysql';
process.env.ERP_TEST_DB_BACKEND = 'mysql';
process.env.NODE_ENV = 'production';
process.env.ERP_SEED_DEMO = 'false';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL PERFORMANCE ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7c|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing Phase 7C performance reset for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

class Session {
  constructor(index) {
    this.pending = new Map();
    this.child = spawn(process.execPath, ['scripts/mysql-concurrency-worker.mjs'], {
      cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.ok ? pending.resolve(message.result) : pending.reject(Object.assign(new Error(message.error.message), message.error));
    });
    this.exited = new Promise((resolve) => this.child.once('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`session-${index} exited ${code}: ${this.stderr}`));
      resolve();
    }));
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { this.child.stdin.end(); await this.exited; }
}

function percentile(values, percent) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percent) - 1)] || 0;
}

function classifyError(error, errorClasses) {
  if (error?.transactionRetryExhausted) {
    errorClasses.retryExhausted = (errorClasses.retryExhausted || 0) + 1;
    if (!errorClasses.retryExhaustedSample) {
      errorClasses.retryExhaustedSample = {
        message: error.message, code: error.code, errno: error.errno,
        sqlState: error.sqlState, attempts: error.transactionAttempts,
      };
    }
    return;
  }
  if (error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213) {
    errorClasses.deadlock = (errorClasses.deadlock || 0) + 1;
    return;
  }
  if (error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.errno === 1205) {
    errorClasses.lockTimeout = (errorClasses.lockTimeout || 0) + 1;
    return;
  }
  if (error?.sqlState === '40001') {
    errorClasses.serializationFailure = (errorClasses.serializationFailure || 0) + 1;
    return;
  }
  if (error?.code) {
    const key = `otherCoded:${error.code}`;
    errorClasses[key] = (errorClasses[key] || 0) + 1;
    if (!errorClasses[`${key}Sample`]) {
      errorClasses[`${key}Sample`] = {
        message: error.message, errno: error.errno, sqlState: error.sqlState,
      };
    }
    return;
  }
  errorClasses.otherUnclassified = (errorClasses.otherUnclassified || 0) + 1;
  if (!errorClasses.otherUnclassifiedSample) {
    errorClasses.otherUnclassifiedSample = { message: String(error?.message || error).slice(0, 240) };
  }
}

(async () => {
  const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
  // The harness uses a raw mysql2 connection instead of MySqlSyncAdapter so the
  // parent's V8 isolate never enters the 16 MiB SharedArrayBuffer pool that
  // _request allocates per call. The pool cannot survive bootstrap + 36 setup
  // INSERTs without fragmenting the ArrayBuffer allocator (RangeError observed
  // at mysql-adapter.js:93 from the harness INSERT loop). Each writer subprocess
  // still owns its own MySqlSyncAdapter (see scripts/mysql-concurrency-worker.mjs).
  const conn = await mysql.createConnection(mysqlConfig);
  const sessions = Array.from({ length: 20 }, (_, index) => new Session(index + 1));
  try {
    // Minimal bootstrap: only the gate that transaction() requires.
    await conn.query(`CREATE TABLE IF NOT EXISTS mysql_transaction_gates (
      gate_id BIGINT NOT NULL,
      purpose VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      PRIMARY KEY (gate_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await conn.query(`INSERT IGNORE INTO mysql_transaction_gates(gate_id,purpose,updated_at) VALUES(1,?,?)`,
      ['application-write', new Date().toISOString()]);

    await conn.query(`CREATE TABLE phase7b_concurrency_resources (
      id VARCHAR(128) PRIMARY KEY, kind VARCHAR(64) NOT NULL,
      available_quantity DECIMAL(24,6) NOT NULL DEFAULT 0, used_quantity DECIMAL(24,6) NOT NULL DEFAULT 0,
      available_value_cents BIGINT NOT NULL DEFAULT 0, used_value_cents BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL, version BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
    await conn.query(`CREATE TABLE phase7b_concurrency_effects (
      idempotency_key VARCHAR(128) PRIMARY KEY, payload LONGTEXT NOT NULL, resource_id VARCHAR(128) NOT NULL,
      effect_kind VARCHAR(32) NOT NULL, result_json JSON NOT NULL, created_at VARCHAR(64) NOT NULL,
      INDEX idx_phase7b_effect_resource(resource_id)
    ) ENGINE=InnoDB`);

    const results = [];
    for (const writers of [1, 5, 10, 20]) {
      for (let index = 0; index < writers; index += 1) {
        await conn.query(
          `INSERT INTO phase7b_concurrency_resources
            (id,kind,available_quantity,used_quantity,available_value_cents,used_value_cents,status,version)
            VALUES(?,?,0,0,0,0,'ACTIVE',0)`,
          [`gate-bench-${writers}-${index}`, 'INDEPENDENT'],
        );
      }
      const latencies = [];
      let errors = 0;
      const errorClasses = {};
      const startedAt = performance.now();
      await Promise.all(Array.from({ length: writers }, async (_, writer) => {
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const operationStarted = performance.now();
          try {
            await sessions[writer].run({
              action: 'normal-business', resourceId: `gate-bench-${writers}-${writer}`, delayMs: 5,
            });
          } catch (error) {
            errors += 1;
            classifyError(error, errorClasses);
          }
          latencies.push(performance.now() - operationStarted);
        }
      }));
      const durationMs = performance.now() - startedAt;
      const baseline = percentile(latencies, 0.5);
      results.push({
        writers, operations: latencies.length, transactionWorkMs: 5,
        throughputPerSecond: Math.round((latencies.length / durationMs) * 100_000) / 100,
        p50Ms: Math.round(percentile(latencies, 0.5) * 100) / 100,
        p95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
        p99Ms: Math.round(percentile(latencies, 0.99) * 100) / 100,
        maxMs: Math.round(Math.max(...latencies) * 100) / 100,
        estimatedQueueWaitP95Ms: Math.max(0, Math.round((percentile(latencies, 0.95) - baseline) * 100) / 100),
        errors, errorRate: errors / latencies.length, errorClasses,
      });
    }
    console.log(JSON.stringify({ benchmark: 'singleton-transaction-gate', independentMySqlSessions: true, results }, null, 2));
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      const [tables] = await conn.query('SHOW TABLES');
      for (const row of tables) {
        const table = Object.values(row)[0];
        if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsafe MySQL table name: ${table}`);
        await conn.query(`DROP TABLE \`${table}\``);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (error) {
      console.error('Phase 7C performance cleanup failed:', error.message);
    }
    await conn.end();
  }
})().catch((error) => {
  console.error('Phase 7C performance benchmark failed:', error);
  process.exit(1);
});