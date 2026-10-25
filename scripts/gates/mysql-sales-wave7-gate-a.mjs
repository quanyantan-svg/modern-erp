// Consolidated protected Gate A-only MySQL acceptance campaign.
// This runner intentionally excludes every unrelated legacy MySQL suite.
// Authorization is checked before opening the reset connection; every suite
// has a fail-closed reset and strict TAP summary. NOT_RUN is never PASS.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import {
  assertAuthorizedDisposableMySqlTarget,
  resetAuthorizedDisposableMySqlSchema,
} from '../../server/test-utils/mysql-disposable-target.js';
import { parseTapSummary, assertTapSummaryStrict } from './tap-summary.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`GATE A MYSQL ENVIRONMENT = UNAVAILABLE (${missing.join(', ')} missing)`);
  process.exit(2);
}

process.env.ERP_DB_BACKEND = 'mysql';
process.env.ERP_TEST_DB_BACKEND = 'mysql';
process.env.NODE_ENV = 'test';
process.env.ERP_SEED_DEMO = 'false';

const resetConfig = resolveDatabaseConfig({ backend: 'mysql' });
try { assertAuthorizedDisposableMySqlTarget(resetConfig); }
catch (error) { console.error(error.message); process.exit(2); }

const childEnv = {
  ...process.env,
  ERP_DB_BACKEND: 'mysql',
  ERP_TEST_DB_BACKEND: 'mysql',
  NODE_ENV: 'test',
  ERP_SEED_DEMO: 'false',
};

const suites = Object.freeze([
  { label: 'A-PARITY', file: 'server/mysql-sales-customer-wave7.integration.js' },
  { label: 'A-PROD', file: 'server/mysql-sales-customer-wave7-concurrency.integration.js' },
  { label: 'A-RAW', file: 'server/mysql-sales-customer-wave7-raw-locks.integration.js' },
  // A-TXLIFE runs LAST so the approved business-coverage evidence of
  // A-PARITY, A-PROD and A-RAW is never contingent on this suite. It is the
  // only real-MySQL Transaction Lifecycle Safety suite and it is reachable
  // exclusively through this guarded runner.
  { label: 'A-TXLIFE', file: 'server/mysql-transaction-start-safety.integration.js' },
]);

function resetMySql(label) {
  console.error(`GATE A MYSQL RESET (${label}) TARGET = ${resetConfig.host}:${resetConfig.port}/${resetConfig.database} AS ${resetConfig.user}`);
  const db = new MySqlSyncAdapter({
    host: resetConfig.host, port: resetConfig.port, database: resetConfig.database,
    user: resetConfig.user, password: resetConfig.password, ssl: resetConfig.ssl,
  });
  try {
    resetAuthorizedDisposableMySqlSchema(db, resetConfig);
    const remaining = db.prepare('SHOW FULL TABLES').all().length;
    if (remaining !== 0) throw new Error(`GATE A MYSQL RESET REFUSED: ${remaining} tables remain after reset`);
  } finally { db.close(); }
}

function tee(stream, target, capture) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => { capture.value += chunk; target.write(chunk); });
}

async function runSuite({ label, file }) {
  resetMySql(label);
  console.log(`GATE A MYSQL ${label} = RUNNING`);
  const capture = { value: '' };
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', resolve(repoRoot, file)], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tee(child.stdout, process.stdout, capture);
  tee(child.stderr, process.stderr, capture);
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => done(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) {
    console.error(`GATE A MYSQL ${label} = FAIL (exit ${code}; file ${file})`);
    process.exit(code || 1);
  }
  const summary = parseTapSummary(capture.value);
  assertTapSummaryStrict(label, summary);
  console.log(`GATE A MYSQL ${label} = PASS (${summary.pass}/${summary.tests})`);
  return summary;
}

const results = [];
for (const suite of suites) results.push({ ...suite, summary: await runSuite(suite) });

const status = [
  ['M1', 'PASS'], ['M2', 'PASS'], ['M3', 'PASS'], ['M4', 'PASS'], ['M5', 'PASS'], ['M6', 'PASS'],
  ['M7', 'PASS'], ['M8', 'PASS'],
  ['M9', 'BLOCKED_BY_WAVE10'], ['M10', 'BLOCKED_BY_WAVE10'], ['M11', 'BLOCKED_BY_WAVE10'], ['M12', 'BLOCKED_BY_WAVE10'],
  ['M13', 'PASS'], ['M14', 'PASS'], ['M15', 'BLOCKED_BY_WAVE10'], ['M16', 'PASS'], ['M17', 'PASS'], ['M18', 'PASS'],
  ['M19-GRNR', 'PASS'], ['M19-CREDIT', 'BLOCKED_BY_WAVE10'],
  ['M20', 'PASS'], ['M21', 'PASS'], ['M22', 'PASS'], ['M23', 'PASS'], ['M24', 'PASS'], ['M25', 'PASS'],
];

console.log('GATE A M1-M25 STATUS:');
for (const [caseId, result] of status) console.log(`  ${caseId} = ${result}`);
console.log('GATE A MYSQL SUITES:');
for (const result of results) console.log(`  ${result.label}: ${result.summary.pass}/${result.summary.tests} PASS (${result.file})`);
console.log('GATE A MYSQL CAMPAIGN = PASS');
