import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  consumeAck4Record, OUT_001_MYSQL_MANIFEST, OUT_001_MYSQL_MANIFEST_NAME,
} from '../scripts/gates/ack4/ack4-runtime.mjs';
import { runOut001MySqlLifecycle } from '../scripts/gates/mysql-out001-root-lifecycle.mjs';
import {
  collectOut001Child, ensureOut001ChildExited, parseOut001OperationOutput,
  parseOut001PostflightOutput, terminateProcessTree,
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

function waitForLine(stream, timeoutMs = 5_000) {
  return new Promise((resolveLine, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('timed out waiting for child output')), timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      stream.off('data', onData);
      resolveLine(output.slice(0, newline).trim());
    };
    stream.on('data', onData);
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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
    assert.match(processLifecycle, /taskkill\.error \|\| taskkill\.exitCode !== 0/);
    assert.doesNotMatch(processLifecycle, /child\.kill\('SIGKILL'\)/);
    assert.doesNotMatch(runner, /markChildExited[^\n]+catch \{\}/);
    assert.match(launcher, /ProtectedData\]::Unprotect/);
    assert.match(launcher, /\$rootState -eq 'CLEANUP_UNVERIFIED'/);
  });

  test('Windows taskkill confirms both parent and grandchild exit before reporting process-tree termination', {
    skip: process.platform === 'win32' ? false : 'Windows-only process-tree evidence',
  }, async () => {
    const parent = spawn(process.execPath, ['-e', [
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });",
      'process.stdout.write(String(grandchild.pid) + "\\n");',
      'setInterval(()=>{},1000);',
    ].join('')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const grandchildPid = Number(await waitForLine(parent.stdout));
    assert.equal(processExists(parent.pid), true, 'parent must be running before termination');
    assert.equal(processExists(grandchildPid), true, 'grandchild must be running before termination');
    try {
      assert.equal(await terminateProcessTree(parent), true,
        'termination may pass only after taskkill and known-tree verification');
      assert.equal(processExists(parent.pid), false, 'parent must have exited');
      assert.equal(processExists(grandchildPid), false, 'grandchild must have exited');
    } finally {
      if (processExists(parent.pid)) spawnSync('taskkill', ['/PID', String(parent.pid), '/T', '/F'], { windowsHide: true });
      else if (processExists(grandchildPid)) spawnSync('taskkill', ['/PID', String(grandchildPid), '/T', '/F'], { windowsHide: true });
    }
  });

  test('Windows PowerShell 5.1 Start-Process preserves every quoted path and embedded quote', {
    skip: process.platform === 'win32' ? false : 'Windows PowerShell 5.1-only argument evidence',
  }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern erp out001 args '));
    try {
      const repositoryPath = join(dir, 'repository path with spaces');
      const childScriptPath = join(repositoryPath, 'child scripts', 'argv echo child.mjs');
      const capabilityPath = join(dir, 'capability path', 'owner capability.json');
      const targetProofPath = join(dir, 'target proof path', 'target proof.json');
      const outputPath = join(dir, 'argument output.json');
      const errorPath = join(dir, 'argument error.txt');
      const harnessPath = join(dir, 'powershell 5.1 argument harness.ps1');
      mkdirSync(join(repositoryPath, 'child scripts'), { recursive: true });
      mkdirSync(join(dir, 'capability path'), { recursive: true });
      mkdirSync(join(dir, 'target proof path'), { recursive: true });
      writeFileSync(capabilityPath, '{}');
      writeFileSync(targetProofPath, '{}');
      writeFileSync(childScriptPath, [
        'process.stdout.write(JSON.stringify({',
        '  scriptPath: process.argv[1], cwd: process.cwd(), argv: process.argv.slice(2),',
        '}));',
      ].join('\n'));

      const launcher = readFileSync(new URL('../scripts/gates/run-out001-mysql-gate.ps1', import.meta.url), 'utf8');
      const functionSource = launcher.match(/function ConvertTo-NativeArgument[\s\S]*?^}/m)?.[0];
      assert.ok(functionSource, 'launcher quoting function must be extractable for the native invocation proof');
      const quotedValue = 'embedded "quote" and trailing slash\\';
      writeFileSync(harnessPath, [
        "$ErrorActionPreference = 'Stop'",
        functionSource,
        '$nativeArguments = @(',
        `  (ConvertTo-NativeArgument ${quotePowerShellLiteral(childScriptPath)}),`,
        "  '--repository-path',", `  (ConvertTo-NativeArgument ${quotePowerShellLiteral(repositoryPath)}),`,
        "  '--ack4-capability',", `  (ConvertTo-NativeArgument ${quotePowerShellLiteral(capabilityPath)}),`,
        "  '--target-proof',", `  (ConvertTo-NativeArgument ${quotePowerShellLiteral(targetProofPath)}),`,
        "  '--quoted-value',", `  (ConvertTo-NativeArgument ${quotePowerShellLiteral(quotedValue)})`,
        ')',
        `$process = Start-Process -FilePath 'node' -ArgumentList $nativeArguments -WorkingDirectory ${quotePowerShellLiteral(repositoryPath)} -NoNewWindow -Wait -PassThru -RedirectStandardOutput ${quotePowerShellLiteral(outputPath)} -RedirectStandardError ${quotePowerShellLiteral(errorPath)}`,
        'exit $process.ExitCode',
      ].join('\r\n'));

      const powershell51 = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const run = spawnSync(powershell51, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath,
      ], { encoding: 'utf8', windowsHide: true });
      assert.equal(run.status, 0, `PowerShell 5.1 harness failed: ${run.stderr || readFileSync(errorPath, 'utf8')}`);
      const echoed = JSON.parse(readFileSync(outputPath, 'utf8'));
      assert.equal(resolve(echoed.scriptPath), resolve(childScriptPath), 'child script path must remain one argv item');
      assert.equal(resolve(echoed.cwd), resolve(repositoryPath), 'repository working path must remain exact');
      assert.deepEqual(echoed.argv, [
        '--repository-path', repositoryPath,
        '--ack4-capability', capabilityPath,
        '--target-proof', targetProofPath,
        '--quoted-value', quotedValue,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Root refuses cleanup when stop succeeds but any registered child lacks exited=true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-child-state-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174024');
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      input.runHttpFixtures = async (context) => {
        calls.push('RUN_OUT001_HTTP_FIXTURES');
        context.issueChild({ childPid: 299, childStartedAt: 'unconfirmed-child' });
        return { passed: true };
      };
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'CLEANUP_UNVERIFIED');
      assert.equal(report.childrenExited, false);
      assert.equal(report.cleanupProven, false);
      assert.equal(report.cleanupAttempts, 0);
      assert.deepEqual(calls, ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_OUT001_HTTP_FIXTURES']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Root propagates child exit registration failure and quarantines without cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-child-mark-fail-'));
    try {
      const root = consumeSimulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174025');
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      input.stopChildren = async () => { throw new Error('OUT_001_MYSQL_UNREGISTERED_CHILD_EXIT'); };
      await assert.rejects(() => runOut001MySqlLifecycle(input), (error) => {
        assert.match(error.message, /UNREGISTERED_CHILD_EXIT/);
        assert.equal(error.out001Lifecycle.state, 'CLEANUP_UNVERIFIED');
        assert.equal(error.out001Lifecycle.childrenExited, false);
        assert.equal(error.out001Lifecycle.cleanupAttempts, 0);
        return true;
      });
      assert.deepEqual(calls, [
        'RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_OUT001_HTTP_FIXTURES',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    if (process.platform === 'win32') {
      assert.equal(await terminateProcessTree(normal), false,
        'an already-exited Windows parent alone cannot prove that its process tree exited');
    }

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
