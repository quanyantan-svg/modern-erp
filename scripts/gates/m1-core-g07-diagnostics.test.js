import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  createChildFailureError, diagnoseChildResult, parseNodeTestTapFailures,
  sanitizeDiagnosticText, writeRestrictedDiagnosticEvidence,
} from './m1-core-g07-diagnostics.mjs';

function failure(name, { error = 'Expected values to be strictly equal', expected = '200', actual = '409', stack = 'at test (suite.js:10:2)' } = {}) {
  return `not ok 1 - ${name}\n  ---\n  failureType: 'testCodeFailure'\n  error: |-\n    ${error}\n  code: 'ERR_ASSERTION'\n  name: 'AssertionError'\n  expected: ${expected}\n  actual: ${actual}\n  operator: 'strictEqual'\n  stack: |-\n    ${stack}\n  ...`;
}

function createError({ stdout, stderr = '', exitCode = 1 }) {
  const directory = mkdtempSync(join(tmpdir(), 'm1-g07-diagnostic-'));
  const error = createChildFailureError({ exitCode, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES', stdout, stderr }, {
    evidenceRoot: directory, runId: '123e4567-e89b-42d3-a456-426614174000', childPid: 42, restrictFile: () => {},
  });
  return { directory, error };
}

async function runSyntheticSuite(source) {
  const directory = mkdtempSync(join(tmpdir(), 'm1-g07-suite-events-'));
  const filePath = join(directory, 'synthetic.test.mjs');
  writeFileSync(filePath, source);
  try {
    const runner = [
      '(async () => {',
      "const { run } = await import('node:test');",
      "const { emitNodeTestTap } = await import('./scripts/gates/m1-core-g07-suite-reporter.mjs');",
      'const result = await emitNodeTestTap(run({ files: [process.argv[1]], isolation: \'none\' }));',
      'if (result.failed) process.exitCode = 1;',
      '})().catch((error) => { console.error(error); process.exitCode = 2; });',
    ].join('\n');
    const child = spawn(process.execPath, ['-e', runner, filePath], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    return { failed: exitCode !== 0, exitCode, stdout, stderr };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('M1C-G07 child failure diagnostics (pure Node, no MySQL)', () => {
  test('suite stdout not ok with empty stderr preserves the test, assertion and stack', () => {
    const { directory, error } = createError({ stdout: `TAP version 13\n${failure('CR-04 exact race outcome')}\n# fail 1\n` });
    try {
      assert.match(error.message, /TAP_FAILURE_TOTAL=1/);
      assert.match(error.message, /CR-04 exact race outcome/);
      assert.match(error.message, /ERR_ASSERTION/);
      assert.match(error.message, /expected=200 actual=409 operator=strictEqual/);
      assert.match(error.message, /suite\.js:10:2/);
      assert.match(error.message, /STDOUT_PRESENT=true STDERR_PRESENT=false/);
      assert.match(readFileSync(error.m1G07EvidencePath, 'utf8'), /--- STDOUT \(SANITIZED\) ---/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('multiple TAP failures are all identified and counted', () => {
    const stdout = `TAP version 13\n${failure('CR-03 confirm race')}\n${failure('SCHEMA-PARITY column drift', { error: 'column type mismatch', expected: 'VARCHAR(191)', actual: 'VARCHAR(128)', stack: 'at parity (suite.js:40:9)' })}\n# fail 2\n`;
    const parsed = parseNodeTestTapFailures(stdout);
    assert.equal(parsed.declaredFailureCount, 2);
    assert.equal(parsed.identifiableFailureCount, 2);
    assert.deepEqual(parsed.failures.map((item) => item.name), ['CR-03 confirm race', 'SCHEMA-PARITY column drift']);
    const { directory, error } = createError({ stdout });
    try {
      assert.match(error.message, /TAP_FAILURE_TOTAL=2 IDENTIFIABLE_FAILURES=2/);
      assert.match(error.message, /FAILURE\[1\] NAME=CR-03 confirm race/);
      assert.match(error.message, /FAILURE\[2\] NAME=SCHEMA-PARITY column drift/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('stdout assertion remains primary while non-empty stderr is separately summarized', () => {
    const { directory, error } = createError({
      stdout: `${failure('CR-08 LOT conservation', { error: 'identity balance became negative' })}\n# fail 1\n`,
      stderr: 'ExperimentalWarning: SQLite is experimental\nsecondary worker warning',
    });
    try {
      assert.match(error.message, /CR-08 LOT conservation/);
      assert.match(error.message, /identity balance became negative/);
      assert.match(error.message, /STDOUT_PRESENT=true STDERR_PRESENT=true/);
      assert.match(error.message, /STDERR_SUMMARY=ExperimentalWarning/);
      const evidence = readFileSync(error.m1G07EvidencePath, 'utf8');
      assert.match(evidence, /--- STDOUT \(SANITIZED\) ---/);
      assert.match(evidence, /--- STDERR \(SANITIZED\) ---/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('exit zero stays PASS and never creates a failure error', () => {
    const result = diagnoseChildResult({ exitCode: 0, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES', stdout: 'ok 1 - CR-01' });
    assert.equal(result.passed, true);
    assert.equal(createChildFailureError({ exitCode: 0, stdout: 'ok 1 - CR-01' }), null);
  });

  test('diagnostic text redacts bearer, password, token, capability and MySQL URL secrets', () => {
    const sanitized = sanitizeDiagnosticText('Bearer abc.def password=secret "token":"tok" capability=blob mysql://u:p@127.0.0.1/db');
    assert.doesNotMatch(sanitized, /abc\.def|secret|"tok"|blob|u:p@/);
    assert.match(sanitized, /\[REDACTED\]/);
  });

  test('production evidence writer creates a readable sanitized file with platform restriction applied', () => {
    const directory = mkdtempSync(join(tmpdir(), 'm1-g07-restricted-'));
    try {
      const diagnostic = diagnoseChildResult({
        exitCode: 1, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES',
        stdout: `${failure('CR-01 capacity')}\n# fail 1\nBearer should-not-survive`, stderr: 'password=should-not-survive',
      });
      const filePath = writeRestrictedDiagnosticEvidence(diagnostic, {
        evidenceRoot: directory, runId: '123e4567-e89b-42d3-a456-426614174000', childPid: 9,
      });
      const evidence = readFileSync(filePath, 'utf8');
      assert.match(evidence, /CR-01 capacity/);
      assert.doesNotMatch(evidence, /should-not-survive/);
      assert.match(evidence, /\[REDACTED\]/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('node:test event reporter emits readable TAP and preserves successful suite behavior', async () => {
    const result = await runSyntheticSuite(`
      import test from 'node:test';
      test('synthetic pass', () => {});
    `);
    assert.equal(result.failed, false, result.stderr || result.stdout);
    assert.match(result.stdout, /ok 1 - synthetic pass/);
    assert.match(result.stdout, /# pass 1/);
    assert.equal(parseNodeTestTapFailures(result.stdout).identifiableFailureCount, 0);
  });

  test('node:test event reporter preserves assertion name, values, operator and stack', async () => {
    const result = await runSyntheticSuite(`
      import assert from 'node:assert/strict';
      import test from 'node:test';
      test('CR-SYNTH assertion fidelity', () => assert.equal(409, 200));
    `);
    const parsed = parseNodeTestTapFailures(result.stdout);
    assert.equal(result.failed, true);
    assert.equal(parsed.declaredFailureCount, 1);
    assert.equal(parsed.identifiableFailureCount, 1);
    assert.equal(parsed.failures[0].name, 'CR-SYNTH assertion fidelity');
    assert.equal(parsed.failures[0].code, 'ERR_ASSERTION');
    assert.equal(parsed.failures[0].assertion, 'expected=200 actual=409 operator=strictEqual');
    assert.match(parsed.failures[0].stack, /synthetic\.test\.mjs/);
  });

  test('node:test event reporter preserves before hook failures', async () => {
    const result = await runSyntheticSuite(`
      import { before, test } from 'node:test';
      before(() => { throw new Error('synthetic before hook failure'); });
      test('CR-SYNTH blocked by before', () => {});
    `);
    const parsed = parseNodeTestTapFailures(result.stdout);
    assert.equal(result.failed, true);
    assert.equal(parsed.failures[0].name, 'CR-SYNTH blocked by before');
    assert.equal(parsed.failures[0].failureType, 'hookFailed');
    assert.equal(parsed.failures[0].error, 'synthetic before hook failure');
    assert.match(parsed.failures[0].stack, /synthetic\.test\.mjs/);
  });

  test('node:test event reporter preserves multiple failures and sanitizes captured output', async () => {
    const result = await runSyntheticSuite(`
      import assert from 'node:assert/strict';
      import test from 'node:test';
      test('CR-SYNTH first failure', () => assert.deepEqual({ status: 409 }, { status: 200 }));
      test('CR-SYNTH secret failure', () => { throw new Error('Bearer synthetic-secret password=synthetic-password'); });
    `);
    const diagnostic = diagnoseChildResult({
      exitCode: 1, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES', stdout: result.stdout,
    });
    assert.equal(result.failed, true);
    assert.equal(diagnostic.tap.declaredFailureCount, 2);
    assert.deepEqual(diagnostic.tap.failures.map((item) => item.name), [
      'CR-SYNTH first failure', 'CR-SYNTH secret failure',
    ]);
    assert.doesNotMatch(diagnostic.sanitizedStdout, /synthetic-secret|synthetic-password/);
    assert.match(diagnostic.sanitizedStdout, /\[REDACTED\]/);
  });
});
