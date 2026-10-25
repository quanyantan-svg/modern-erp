import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repoRoot, 'scripts/gates/mysql-sales-wave7-gate-a.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

test('Gate A command maps pnpm test:mysql to the bounded integrated runner', () => {
  assert.equal(pkg.scripts['test:mysql'], 'node scripts/gates/mysql-sales-wave7-gate-a.mjs');
  assert.equal(pkg.scripts['test:mysql:gate-a'], pkg.scripts['test:mysql']);
  assert.equal(pkg.scripts['test:mysql:legacy'], 'node scripts/gates/mysql-gate.mjs');
});

test('Gate A MySQL manifest contains A-PARITY, A-PROD, A-RAW and the A-TXLIFE safety suite', () => {
  const files = [...source.matchAll(/file:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(files, [
    'server/mysql-sales-customer-wave7.integration.js',
    'server/mysql-sales-customer-wave7-concurrency.integration.js',
    'server/mysql-sales-customer-wave7-raw-locks.integration.js',
    'server/mysql-transaction-start-safety.integration.js',
  ]);
  const labels = [...source.matchAll(/label:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['A-PARITY', 'A-PROD', 'A-RAW', 'A-TXLIFE']);
  assert.doesNotMatch(source, /mysql-gate\.mjs|mysql-concurrency-gate\.mjs/);
});

test('the real MySQL Transaction Lifecycle Safety fixture is not in the ordinary suite manifest', () => {
  const suites = readFileSync(resolve(repoRoot, 'scripts/testing/test-suites.js'), 'utf8');
  assert.doesNotMatch(suites, /'server\/mysql-transaction-start-safety\.integration\.js'/);
  assert.match(suites, /'server\/db-transaction-start-safety\.test\.js'/);
});

test('Gate A runner guards before reset, verifies DATABASE(), and validates TAP strictly', () => {
  const guard = source.indexOf('assertAuthorizedDisposableMySqlTarget(resetConfig)');
  const reset = source.indexOf('function resetMySql');
  const connection = source.indexOf('new MySqlSyncAdapter');
  assert.ok(guard > 0 && reset > guard && connection > reset);
  assert.match(source, /resetAuthorizedDisposableMySqlSchema\(db, resetConfig\)/);
  assert.match(source, /assertTapSummaryStrict\(label, summary\)/);
  for (const blocked of ['M9', 'M10', 'M11', 'M12', 'M15', 'M19-CREDIT']) {
    assert.match(source, new RegExp(`\\['${blocked}', 'BLOCKED_BY_WAVE10'\\]`));
  }
});
