import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../../server/db.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7[abc]|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing MySQL integration tests for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

// The gate MUST run its reset / verification path with ERP_DB_BACKEND and
// ERP_TEST_DB_BACKEND set in its own process.env. Without these keys the
// in-process createTempDb() falls through to the SQLite branch (server/
// test-utils/temp-db.js lines 76-115 vs 116-165) and the MySQL DB is
// never touched — leaving leftover tables + mysql_backend_metadata
// marker from any prior interrupted or failing run, which is exactly
// what was poisoning the next pnpm test:mysql invocation. Assigning
// here also propagates to the spawned child via the env object below.
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

const files = [
  'server/mysql-v14-e2.integration.js',
  'server/v13-phase6e-acceptance-uat.test.js',
  'server/v13-phase6b-traceability-quality.test.js',
  'server/v13-phase6c-manufacturing-execution.test.js',
  'server/v13-phase6d-financial-inventory.test.js',
  'server/v13-phase6e-month-end-uat.test.js',
  'server/mysql-phase7a.integration.js',
];

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

function resetMySql() {
  // Fail-closed pre-test reset. Per-test temp-db.js afterEach() drops
  // every table on PASS and on assertion failure, but it cannot run
  // after a process crash / kill / Ctrl-C. Bootstrap is idempotent on
  // an existing mysql_backend_metadata marker, so a single interrupted
  // run would otherwise poison the disposable DB for every subsequent
  // gate invocation. This gate-level reset opens the SAME MySQL DB the
  // spawned child will use, verifies SELECT DATABASE() matches, drops
  // every table, and verifies the count is 0 — refusing to spawn if any
  // table survives. If any of these guards fail the gate stops with a
  // diagnostic and never launches the UAT.
  console.error('MYSQL GATE RESET TARGET =');
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
        `MYSQL GATE RESET REFUSED: SELECT DATABASE()=${actualDb} does not match expected ${resetConfig.database}. `
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
        `MYSQL GATE RESET REFUSED: post-reset table count = ${afterCount}, expected 0. `
        + `The disposable MySQL DB still holds tables after the reset; refusing to launch the UAT.`,
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

(async () => {
  resetMySql();
  console.error('CHILD ERP_DB_BACKEND =', childEnv.ERP_DB_BACKEND);
  console.error('CHILD ERP_DB_HOST =', childEnv.ERP_DB_HOST);
  console.error('CHILD ERP_DB_PORT =', childEnv.ERP_DB_PORT);
  console.error('CHILD ERP_DB_NAME =', childEnv.ERP_DB_NAME);
  console.error('CHILD ERP_DB_USER =', childEnv.ERP_DB_USER);
  for (const file of files) {
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
      // configurations only surface the first line. The server-side
      // unhandled_request_error logger writes category + stack (incl.
      // MySQL errno / sqlState inside the message) to stderr; if any of
      // that was clipped by the terminal or interleaved out of view, this
      // dump makes it visible without ever printing credentials (the
      // structured logger redacts them).
      console.error('\n=== MYSQL GATE FAILURE DIAGNOSTIC ===');
      console.error(`File: ${file}`);
      console.error(`Exit code: ${code}`);
      console.error('--- captured output (last 400 lines, no credentials are printed) ---');
      const tail = capture.value.split('\n').slice(-400).join('\n');
      console.error(tail);
      console.error('=== END MYSQL GATE FAILURE DIAGNOSTIC ===');
      process.exit(code || 1);
    }
  }
  console.log('MYSQL TESTS = PASS');
})();
