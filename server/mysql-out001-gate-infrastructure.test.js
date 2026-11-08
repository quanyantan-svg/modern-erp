import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  consumeAck4Record, OUT_001_MYSQL_MANIFEST, OUT_001_MYSQL_MANIFEST_NAME,
} from '../scripts/gates/ack4/ack4-runtime.mjs';
import { runOut001MySqlLifecycle } from '../scripts/gates/mysql-out001-root-lifecycle.mjs';
import {
  collectOut001Child, ensureOut001ChildExited, parseOut001OperationOutput,
  parseOut001PostflightOutput,
} from '../scripts/gates/mysql-out001-process-lifecycle.mjs';
import {
  assertOut001MySqlStaticPreflight, OUT_001_MYSQL_REQUIRED_ENVIRONMENT,
  OUT_001_MYSQL_SUITE_FILE,
} from '../scripts/gates/mysql-out001-static-preflight.mjs';
import {
  MYSQL_LOCAL_DISPOSABLE_TARGET, MYSQL_LOCAL_TARGET,
} from '../scripts/gates/mysql-local-target-contract.mjs';

const commitSha = 'b'.repeat(40);
const target = Object.freeze({
  ...MYSQL_LOCAL_TARGET,
  selectedDatabase: MYSQL_LOCAL_TARGET.database,
  currentUser: 'modern_erp_test@localhost',
  serverUuid: '00000000-0000-0000-0000-000000000001',
  grantsSha256: 'a'.repeat(64),
});

function environment() {
  const env = Object.fromEntries(OUT_001_MYSQL_REQUIRED_ENVIRONMENT.map((name) => [name, 'declared']));
  Object.assign(env, {
    ERP_DB_HOST: target.host,
    ERP_DB_PORT: String(target.port),
    ERP_DB_NAME: target.database,
    ERP_DB_USER: target.user,
    ERP_DB_PASSWORD: 'in-memory-only',
    ERP_DB_BACKEND: 'mysql',
    ERP_TEST_DB_BACKEND: 'mysql',
    ERP_MYSQL_TEST_DISPOSABLE_TARGET: MYSQL_LOCAL_DISPOSABLE_TARGET,
    ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP',
    ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID: target.serverUuid,
    ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER: target.currentUser,
    ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: target.grantsSha256,
    ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY: 'MYSQL_8',
    ERP_MYSQL_WAVE10_INITIAL_INVENTORY: 'EMPTY_ONLY',
  });
  return env;
}

function consumeSimulatedRoot(dir, runId) {
  const now = Date.now();
  const record = {
    version: 1,
    runId,
    commitSha,
    manifest: OUT_001_MYSQL_MANIFEST_NAME,
    operations: [...OUT_001_MYSQL_MANIFEST],
    target,
    approval: { subject: 'owner', channel: 'unit-test', reference: 'out001-gate', summary: 'exact simulated run' },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  };
  const issuedPath = join(dir, `${runId}.issued`);
  writeFileSync(issuedPath, JSON.stringify(record));
  return consumeAck4Record({
    issuedPath,
    consumedDir: join(dir, 'consumed'),
    expected: {
      runId, commitSha, manifest: OUT_001_MYSQL_MANIFEST_NAME,
      operations: OUT_001_MYSQL_MANIFEST, target, sid: 'test-sid',
    },
    decrypt: (bytes) => JSON.parse(bytes),
    rootPid: 100,
    rootStartedAt: 'root-start',
  });
}

function lifecycleDependencies(root, { clean = true } = {}) {
  const calls = [];
  const completeChild = (operation) => async (context) => {
    calls.push(operation);
    const childPid = 200 + calls.length;
    const childStartedAt = `child-${calls.length}`;
    context.issueChild({ childPid, childStartedAt });
    context.markChildExited(childPid, childStartedAt);
  };
  return {
    calls,
    input: {
      consumeRoot: async () => root,
      expected: { commitSha, target, manifest: OUT_001_MYSQL_MANIFEST_NAME },
      quarantineDir: null,
      reset: completeChild('RESET_SCHEMA_PRE_RUN'),
      bootstrap: completeChild('BOOTSTRAP_CURRENT_SCHEMA'),
      runHttpFixtures: async (context) => {
        await completeChild('RUN_OUT001_HTTP_FIXTURES')(context);
        return { passed: true };
      },
      stopChildren: async () => true,
      cleanup: completeChild('CLEANUP_SCHEMA_POST_RUN'),
      verifyCleanup: async () => ({ clean, inventory: clean ? [] : ['tables=1'] }),
    },
  };
}

describe('OUT-001 protected MySQL Gate infrastructure (offline)', () => {
  test('static preflight binds the fixed target, exact Manifest and fixed suite without opening MySQL', () => {
    const proof = assertOut001MySqlStaticPreflight({ target, environment: environment() });
    assert.equal(proof.manifest, 'OUT_001_MYSQL_V1');
    assert.deepEqual(proof.operations, [
      'RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA',
      'RUN_OUT001_HTTP_FIXTURES', 'CLEANUP_SCHEMA_POST_RUN',
    ]);
    assert.equal(proof.suiteFile, 'server/mysql-out001.integration.js');
    assert.equal(OUT_001_MYSQL_SUITE_FILE, 'server/mysql-out001.integration.js');
    assert.throws(() => assertOut001MySqlStaticPreflight({
      target: { ...target, database: 'production', selectedDatabase: 'production' },
      environment: environment(),
    }), /approved local test schema/);
    assert.throws(() => assertOut001MySqlStaticPreflight({
      target,
      environment: { ...environment(), ERP_MYSQL_WAVE10_INITIAL_INVENTORY: 'ALLOW_EXISTING' },
    }), /EMPTY_ONLY/);
  });

  test('Root, Child and launcher expose no arbitrary suite parameter and consume before destructive work', () => {
    const runner = readFileSync(new URL('../scripts/gates/mysql-out001-gate.mjs', import.meta.url), 'utf8');
    const child = readFileSync(new URL('../scripts/gates/mysql-out001-child.mjs', import.meta.url), 'utf8');
    const launcher = readFileSync(new URL('../scripts/gates/run-out001-mysql-gate.ps1', import.meta.url), 'utf8');
    assert.ok(runner.indexOf('assertOut001MySqlStaticPreflight({ target') < runner.indexOf('consumeAck4Record({'));
    assert.ok(child.indexOf('await consume(operation)') < child.indexOf('await openVerifiedAdapter()'));
    assert.match(child, /files: \[resolve\(OUT_001_MYSQL_SUITE_FILE\)\]/);
    assert.doesNotMatch(runner, /--script|--suite|--fixture-plan/);
    assert.doesNotMatch(launcher, /\[string\]\$(?:Script|Suite|FixturePlan)/);
    assert.match(launcher, /Global\\\$name/);
    assert.doesNotMatch(launcher, /Mutex\]::new\(\$false,\s*\$name\)/);
    assert.match(launcher, /GLOBAL_MUTEX_CREATE_FAILED/);
    assert.match(launcher, /ConvertTo-NativeArgument \$gateScript/);
    assert.match(launcher, /GetFullPath\(\$Ack4Capability\)/);
    const processLifecycle = readFileSync(new URL('../scripts/gates/mysql-out001-process-lifecycle.mjs', import.meta.url), 'utf8');
    assert.match(processLifecycle, /'taskkill', \['\/PID', String\(child\.pid\), '\/T', '\/F'\]/);
    assert.match(launcher, /ProtectedData\]::Unprotect/);
    assert.match(launcher, /\$rootState -eq 'CLEANUP_UNVERIFIED'/);
  });

  test('lifecycle executes the exact order and reaches FINISHED only after independent cleanup proof', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-gate-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174020');
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'FINISHED');
      assert.equal(report.testsPassed, true);
      assert.equal(report.cleanupProven, true);
      assert.equal(report.childrenExited, true);
      assert.deepEqual(calls, [...OUT_001_MYSQL_MANIFEST]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failed independent cleanup proof enters quarantine and cannot become PASS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-quarantine-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174021');
      const { input } = lifecycleDependencies(root, { clean: false });
      input.quarantineDir = join(dir, 'quarantine');
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'CLEANUP_UNVERIFIED');
      assert.equal(report.testsPassed, true);
      assert.equal(report.cleanupProven, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('RESET failure preserves the scene and never starts cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-reset-fail-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174022');
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      input.reset = async () => { calls.push('RESET_SCHEMA_PRE_RUN'); throw new Error('reset failed'); };
      await assert.rejects(() => runOut001MySqlLifecycle(input), (error) => {
        assert.equal(error.out001Lifecycle.state, 'CLEANUP_UNVERIFIED');
        assert.equal(error.out001Lifecycle.resetStarted, true);
        assert.equal(error.out001Lifecycle.resetCompleted, false);
        assert.equal(error.out001Lifecycle.cleanupAttempts, 0);
        return true;
      });
      assert.deepEqual(calls, ['RESET_SCHEMA_PRE_RUN']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('successful RESET followed by bootstrap failure permits normal cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-bootstrap-fail-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174023');
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      input.bootstrap = async () => { calls.push('BOOTSTRAP_CURRENT_SCHEMA'); throw new Error('bootstrap failed'); };
      await assert.rejects(() => runOut001MySqlLifecycle(input), (error) => {
        assert.equal(error.out001Lifecycle.state, 'FAILED');
        assert.equal(error.out001Lifecycle.resetCompleted, true);
        assert.equal(error.out001Lifecycle.cleanupAttempts, 1);
        assert.equal(error.out001Lifecycle.cleanupProven, true);
        return true;
      });
      assert.deepEqual(calls, ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'CLEANUP_SCHEMA_POST_RUN']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('child collection waits for complete output and timeout confirms termination', async () => {
    const normal = spawn(process.execPath, ['-e', "process.stdout.write('complete');process.stderr.write('done')"], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    normal.stdout.on('data', (chunk) => { stdout += chunk; });
    normal.stderr.on('data', (chunk) => { stderr += chunk; });
    assert.equal(await collectOut001Child({ child: normal, mode: 'test', operation: 'POSTFLIGHT' }, { timeoutMs: 5_000 }), 0);
    assert.equal(stdout, 'complete');
    assert.equal(stderr, 'done');

    const hanging = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    await assert.rejects(
      () => collectOut001Child({ child: hanging, mode: 'test', operation: 'POSTFLIGHT' }, { timeoutMs: 50 }),
      (error) => error.code === 'OUT_001_MYSQL_CHILD_TIMEOUT' && error.terminationConfirmed === true,
    );
  });

  test('unconfirmed child exit remains fail closed', async () => {
    const hanging = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    try {
      await assert.rejects(
        () => collectOut001Child(
          { child: hanging, mode: 'test', operation: 'RUN_OUT001_HTTP_FIXTURES' },
          { timeoutMs: 20, terminate: async () => false },
        ),
        (error) => error.code === 'OUT_001_MYSQL_CHILD_EXIT_UNVERIFIED' && error.terminationConfirmed === false,
      );
    } finally {
      await ensureOut001ChildExited({ child: hanging });
    }
  });

  test('postflight parser accepts only complete valid JSON output', () => {
    assert.deepEqual(parseOut001PostflightOutput(
      'diagnostic\n{"operation":"POSTFLIGHT","inventory":{"tables":0,"views":0,"triggers":0,"routines":0,"events":0}}\n',
    ), { operation: 'POSTFLIGHT', inventory: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 } });
    assert.equal(parseOut001PostflightOutput('{"operation":"POSTFLIGHT","inventory":'), null);
    assert.equal(parseOut001PostflightOutput('{"operation":"OTHER","inventory":{}}'), null);
    assert.equal(parseOut001PostflightOutput('{"operation":"POSTFLIGHT","inventory":{"tables":0}}'), null);
    assert.equal(parseOut001PostflightOutput(''), null);
  });

  test('operation result validation sets RESET complete only on a proven empty result', () => {
    assert.deepEqual(parseOut001OperationOutput(JSON.stringify({
      operation: 'RESET_SCHEMA_PRE_RUN', dropped: 0,
      inventory: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 },
    }), 'RESET_SCHEMA_PRE_RUN').inventory, {
      tables: 0, views: 0, triggers: 0, routines: 0, events: 0,
    });
    assert.throws(() => parseOut001OperationOutput(JSON.stringify({
      operation: 'RESET_SCHEMA_PRE_RUN', dropped: 1,
      inventory: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 },
    }), 'RESET_SCHEMA_PRE_RUN'), /RESET_RESULT_UNVERIFIED/);
    assert.throws(() => parseOut001OperationOutput('{"operation":"RESET_SCHEMA_PRE_RUN"', 'RESET_SCHEMA_PRE_RUN'),
      /OPERATION_RESULT_UNVERIFIED/);
  });
});
