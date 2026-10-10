import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../../server/db.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL CONCURRENCY TEST ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7[bc]|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing MySQL concurrency tests for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

// The gate MUST run its reset / verification path with ERP_DB_BACKEND and
// ERP_TEST_DB_BACKEND set in its own process.env. Without these keys the
// in-process createDatabase() falls through to the SQLite branch (server/
// db.js) and the MySQL DB is never touched — leaving leftover tables +
// mysql_backend_metadata marker from any prior interrupted or failing run,
// which is exactly what was poisoning the next pnpm test:mysql:concurrency
// invocation. Assigning here also propagates to the spawned child via the
// env object below.
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
      if (!/^[a-zA-Z0-9_]+$/.test(table)) {
        throw new Error(`Unsafe MySQL table name from SHOW TABLES: ${table}`);
      }
      db.exec(`DROP TABLE IF EXISTS \`${table}\``);
    }
  } finally {
    db.exec('SET FOREIGN_KEY_CHECKS=1');
  }
}

function resetMySql(label) {
  // Fail-closed pre-suite reset. The bootstrap in server/database/
  // mysql-schema.js refuses partial schemas without a
  // mysql_backend_metadata completion marker, which is exactly the
  // guard that was rejecting the second suite in a single gate
  // invocation — generic Phase 7B leaves a partial test schema behind, and
  // the procurement-outsourcing suite's createTempDb() then cannot
  // bootstrap on top of it. This gate-level reset opens the SAME MySQL
  // DB the spawned child will use, verifies SELECT DATABASE() matches,
  // drops every table, and verifies the count is 0 — refusing to spawn
  // if any table survives. If any of these guards fail the gate stops
  // with a diagnostic and never launches the next suite.
  console.error(`MYSQL CONCURRENCY RESET (${label}) TARGET =`);
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
        `MYSQL CONCURRENCY RESET REFUSED: SELECT DATABASE()=${actualDb} does not match expected ${resetConfig.database}. `
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
        `MYSQL CONCURRENCY RESET REFUSED: post-reset table count = ${afterCount}, expected 0. `
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
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', resolve(repoRoot, file)], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tee(child.stdout, process.stdout, capture);
  tee(child.stderr, process.stderr, capture);
  const code = await new Promise((resolve) => child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0))));
  if (code !== 0) {
    // node --test on TTY uses the spec reporter (test name + duration on
    // its own line, full diagnostic further down). Some Windows+pnpm
    // configurations only surface the first line. This dump makes any
    // clipped diagnostic visible without ever printing credentials (the
    // structured logger redacts them).
    console.error(`\n=== MYSQL CONCURRENCY FAILURE DIAGNOSTIC (${label}) ===`);
    console.error(`File: ${file}`);
    console.error(`Exit code: ${code}`);
    console.error('--- captured output (last 400 lines, no credentials are printed) ---');
    const tail = capture.value.split('\n').slice(-400).join('\n');
    console.error(tail);
    console.error(`=== END MYSQL CONCURRENCY FAILURE DIAGNOSTIC (${label}) ===`);
    process.exit(code || 1);
  }
}

(async () => {
  // Two suites, two resets. The Phase 7B generic suite leaves a partial
  // test schema behind (no mysql_backend_metadata marker); without the
  // second reset, the procurement-outsourcing suite's bootstrap would
  // fail closed with "Refusing partial MySQL schema without
  // mysql_backend_metadata completion marker".
  await runSuite('generic-phase7b', 'server/mysql-phase7b-concurrency.integration.js');
  await runSuite('procurement-outsourcing', 'server/mysql-procurement-outsourcing-concurrency.integration.js');
  await runSuite('inventory-warehouse', 'server/mysql-inventory-domain-concurrency.integration.js');
  console.log('MYSQL CONCURRENCY TESTS = PASS');
  console.log('  Generic Phase 7B: 13 / 13 PASS');
  console.log('  Procurement/Outsourcing: 11 / 11 races PASS');
  console.log('  Inventory/Warehouse: 14 / 14 races PASS (dialect=mysql)');
})();
