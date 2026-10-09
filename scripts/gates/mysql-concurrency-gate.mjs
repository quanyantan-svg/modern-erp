import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const child = spawn(process.execPath, [
  '--test',
  resolve(repoRoot, 'server/mysql-phase7b-concurrency.integration.js'),
  resolve(repoRoot, 'server/mysql-procurement-outsourcing-concurrency.integration.js'),
], {
  cwd: repoRoot, env: { ...process.env, ERP_TEST_DB_BACKEND: 'mysql', NODE_ENV: 'test', ERP_SEED_DEMO: 'false' }, stdio: 'inherit',
});
child.on('exit', (code) => {
  if (code === 0) console.log('MYSQL CONCURRENCY TESTS = PASS');
  process.exit(code ?? 1);
});
