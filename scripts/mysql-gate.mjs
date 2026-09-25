import { spawnSync } from 'node:child_process';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7a|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing MySQL integration tests for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

const files = [
  'server/v13-phase6e-acceptance-uat.test.js',
  'server/v13-phase6b-traceability-quality.test.js',
  'server/v13-phase6c-manufacturing-execution.test.js',
  'server/v13-phase6d-financial-inventory.test.js',
  'server/v13-phase6e-month-end-uat.test.js',
  'server/mysql-phase7a.integration.js',
];
const env = { ...process.env, ERP_DB_BACKEND: 'mysql', ERP_TEST_DB_BACKEND: 'mysql', NODE_ENV: 'test', ERP_SEED_DEMO: 'false' };
for (const file of files) {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('MYSQL TESTS = PASS');
