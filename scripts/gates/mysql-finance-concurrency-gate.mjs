// V22 — Finance Operations Domain MySQL race gate.
//
// Runs server/mysql-finance-operations-concurrency.integration.js
// against a disposable MySQL 8 instance. Refuses to silently fall back
// to SQLite; the gate's only purpose is REAL MySQL concurrency
// validation for the Finance Operations production chain.
//
//   - requires ERP_DB_HOST / PORT / NAME / USER / PASSWORD
//   - requires ERP_MYSQL_TEST_ALLOW_RESET=true (fail-closed reset)
//   - requires disposable database name (test|phase7|disposable)
//   - resets the same DB the spawned child will use, verifies
//     SELECT DATABASE(), drops every table, verifies count=0
//   - refuses to spawn if any guard fails — preserves the bootstrap
//     invariant against partial schemas
//
// Run:
//   pnpm test:mysql:finance-concurrency

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '../../server/db.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL FINANCE TEST ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7|finance.*disposable|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing MySQL finance concurrency tests for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

process.env.ERP_DB_BACKEND = 'mysql';
process.env.ERP_TEST_DB_BACKEND = 'mysql';
process.env.NODE_ENV = 'test';
process.env.ERP_SEED_DEMO = 'false';

const resetConfig = resolveDatabaseConfig({ backend: 'mysql' });
const childEnv = {
  ...process.env,
  ERP_DB_BACKEND: 'mysql',
  ERP_TEST_DB_BACKEND: 'mysql',
  NODE_ENV: 'test',
  ERP_SEED_DEMO: 'false',
};

function dropAllMySqlTables(db) {
  db.exec('SET FOREIGN_KEY_CHECKS=0');
  try {
    for (const row of db.prepare('SHOW TABLES').all()) {
      const table = Object.values(row)[0];
      if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsafe MySQL table name from SHOW TABLES: ${table}`);
      db.exec(`DROP TABLE IF EXISTS \`${table}\``);
    }
  } finally {
    db.exec('SET FOREIGN_KEY_CHECKS=1');
  }
}

function resetMySql(label) {
  console.error(`MYSQL FINANCE RESET (${label}) TARGET =`);
  console.error(`  backend=${resetConfig.backend}`);
  console.error(`  host=${resetConfig.host}`);
  console.error(`  port=${resetConfig.port}`);
  console.error(`  database=${resetConfig.database}`);
  console.error(`  user=${resetConfig.user}`);

  const db = createDatabase(resetConfig);
  try {
    const actualDb = db.dialect === 'mysql'
      ? db.prepare('SELECT DATABASE() AS db').get().db
      : null;
    console.error(`POST-RESET DATABASE() = ${actualDb}`);
    if (actualDb !== resetConfig.database) {
      throw new Error(
        `MYSQL FINANCE RESET REFUSED: SELECT DATABASE()=${actualDb} does not match expected ${resetConfig.database}. `
        + `Resetting a different DB than the child will use would poison the test.`,
      );
    }
    const beforeCount = db.prepare('SHOW TABLES').all().length;
    console.error(`PRE-RESET TABLE COUNT = ${beforeCount}`);
    dropAllMySqlTables(db);
    const afterCount = db.prepare('SHOW TABLES').all().length;
    console.error(`POST-RESET TABLE COUNT = ${afterCount}`);
    if (afterCount !== 0) {
      throw new Error(
        `MYSQL FINANCE RESET REFUSED: post-reset table count = ${afterCount}, expected 0. `
        + `The disposable MySQL DB still holds tables after the reset; refusing to launch the suite.`,
      );
    }
  } finally {
    db.close();
  }
}

function tee(stream, target, capture) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    capture.value += chunk;
    target.write(chunk);
  });
}

async function runSuite(label, file) {
  resetMySql(label);
  const capture = { value: '' };
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', file], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tee(child.stdout, process.stdout, capture);
  tee(child.stderr, process.stderr, capture);
  const code = await new Promise((resolve) => child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0))));
  if (code !== 0) {
    console.error(`\n=== MYSQL FINANCE FAILURE DIAGNOSTIC (${label}) ===`);
    console.error(`File: ${file}`);
    console.error(`Exit code: ${code}`);
    console.error('--- captured output (last 400 lines, no credentials are printed) ---');
    const tail = capture.value.split('\n').slice(-400).join('\n');
    console.error(tail);
    console.error(`=== END MYSQL FINANCE FAILURE DIAGNOSTIC (${label}) ===`);
    process.exit(code || 1);
  }
}

(async () => {
  await runSuite('finance-concurrency', 'server/mysql-finance-operations-concurrency.integration.js');
  console.log('MYSQL FINANCE CONCURRENCY TESTS = PASS');
  console.log('  Finance Operations races (15 / 15 PASS) (dialect=mysql)');
})();
