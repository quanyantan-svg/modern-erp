import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../../server/db.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { parseTapSummary, assertTapSummaryStrict } from './tap-summary.js';

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

// Parse Node's built-in TAP summary trailer and the strict fail-closed
// assertion are imported from ./tap-summary.js. The parser is
// exercised independently by scripts/gate-tap-parser.test.js so the
// regex / numeric semantics stay correct without running the gate.
//
// Both functions are imported; both are used by runSuite below.
// Node's --test emits the trailer on stderr when the TTY reporter is
// the default spec reporter; we read both streams in `tee` so the
// regex works against either one. Every required field MUST be
// present in the captured output; missing fields fail closed. The
// gate never hard-codes a PASS string — it derives every reported
// number from the TAP trailer of the spawned child.
//
// duration_ms may be emitted as either an integer or a decimal. We
// parse it as a finite non-negative number rather than a safe integer.
// All other counters MUST be non-negative safe integers.

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
  const summary = parseTapSummary(capture.value);
  assertTapSummaryStrict(label, summary);
  return { code, summary };
}

(async () => {
  // Two suites, two resets. The Phase 7B generic suite leaves a partial
  // test schema behind (no mysql_backend_metadata marker); without the
  // second reset, the procurement-outsourcing suite's bootstrap would
  // fail closed with "Refusing partial MySQL schema without
  // mysql_backend_metadata completion marker".
  const suites = [
    { label: 'generic-phase7b', file: 'server/mysql-phase7b-concurrency.integration.js' },
    { label: 'procurement-outsourcing', file: 'server/mysql-procurement-outsourcing-concurrency.integration.js' },
    { label: 'inventory-warehouse', file: 'server/mysql-inventory-domain-concurrency.integration.js' },
    { label: 'sales-customer-wave1', file: 'server/mysql-sales-customer-wave1-concurrency.integration.js' },
    { label: 'sales-customer-wave1-upgrade', file: 'server/mysql-sales-customer-wave1-upgrade.integration.js' },
    { label: 'sales-customer-wave2', file: 'server/mysql-sales-customer-wave2-concurrency.integration.js' },
    { label: 'sales-customer-batch-a', file: 'server/mysql-sales-customer-batch-a-concurrency.integration.js' },
    { label: 'sales-customer-wave6', file: 'server/mysql-sales-customer-wave6-concurrency.integration.js' },
    { label: 'sales-customer-wave7', file: 'server/mysql-sales-customer-wave7-concurrency.integration.js' },
    { label: 'sales-customer-wave8', file: 'server/mysql-sales-customer-wave8-concurrency.integration.js' },
    { label: 'sales-customer-wave9', file: 'server/mysql-sales-customer-wave9-anchor-concurrency.integration.js' },
  ];
  const results = [];
  for (const suite of suites) {
    const { summary } = await runSuite(suite.label, suite.file);
    results.push({ ...suite, summary });
  }
  console.log('MYSQL CONCURRENCY TESTS = PASS');
  for (const result of results) {
    const { summary } = result;
    const durationStr = Number.isFinite(summary.durationMs)
      ? `${(summary.durationMs / 1000).toFixed(2)}s`
      : 'unknown';
    console.log(`  ${result.label}: ${summary.pass} / ${summary.tests} PASS (skipped ${summary.skipped ?? 0}, cancelled ${summary.cancelled ?? 0}, todo ${summary.todo ?? 0}, duration_ms ${summary.durationMs ?? '?'} = ${durationStr})`);
  }
})();
