import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  collectOut001Child, ensureOut001ChildExited, out001ChildEnvironment, parseOut001OperationOutput,
  parseOut001PostflightOutput, terminateProcessTree,
} from '../scripts/gates/mysql-out001-process-lifecycle.mjs';
import {
  assertOut001MySqlStaticPreflight, OUT_001_MYSQL_REQUIRED_ENVIRONMENT,
  OUT_001_MYSQL_SUITE_FILE,
} from '../scripts/gates/mysql-out001-static-preflight.mjs';
import {
  MYSQL_LOCAL_DISPOSABLE_TARGET, MYSQL_LOCAL_TARGET,
} from '../scripts/gates/mysql-local-target-contract.mjs';
import {
  appendOut001DescendantRegistration, initializeOut001DescendantRegistry, readWindowsProcessIdentity,
  OUT_001_EXPECTED_HTTP_APP_COUNT,
  out001DescendantRegistryPath,
} from '../scripts/gates/mysql-out001-descendant-registry.mjs';
import {
  createOut001EvidenceWriter, out001SuitePassed, parseOut001TapSummary,
} from '../scripts/gates/mysql-out001-evidence.mjs';
import {
  atomicWriteOut001Evidence, persistOut001RootEvidence, readAndValidateOut001LauncherEvidence,
  readAndValidateOut001RootEvidence, rootEvidenceIsPassing,
} from '../scripts/gates/mysql-out001-root-evidence.mjs';
import { reconcileOut001RunEvidence } from '../scripts/gates/reconcile-out001-run-evidence.mjs';
import { assertOldTreeExited } from '../scripts/gates/mysql-out001-recovery.mjs';

const commitSha = 'b'.repeat(40);
const target = Object.freeze({
  ...MYSQL_LOCAL_TARGET,
  selectedDatabase: MYSQL_LOCAL_TARGET.database,
  currentUser: 'modern_erp_test@localhost',
  serverUuid: '00000000-0000-0000-0000-000000000001',
  grantsSha256: 'a'.repeat(64),
});

describe('OUT-001 root evidence and offline reconciliation', () => {
  const rootRunId = '123e4567-e89b-42d3-a456-426614174099';
  const manifest = OUT_001_MYSQL_MANIFEST_NAME;
  const rootReport = (overrides = {}) => ({
    runId: rootRunId, commitSha, manifest, state: 'FINISHED', testsPassed: true,
    cleanupProven: true, childrenExited: true, cleanupAttempts: 1, childCount: 1,
    children: [{ childPid: 123, childStartedAt: '2026-11-09T00:00:00.000Z', operation: 'RESET_SCHEMA_PRE_RUN', exited: true, exitCode: 0 }],
    suites: [OUT_001_MYSQL_SUITE_FILE], evidence: [{ suite: 'test' }], executionStatus: 'EXECUTED_NOT_ACCEPTED',
    ...overrides,
  });
  const withTemp = async (callback) => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-root-'));
    try { return await callback(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  test('successful root report is persisted and validates from disk', () => withTemp((localAppData) => {
    const saved = persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    const verified = readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha, manifest, options: { localAppData } });
    assert.equal(verified.report.state, 'FINISHED');
    assert.equal(saved.manifest.evidenceCount, 1);
  }));
  test('failed root report is persisted before a verdict can be emitted', () => withTemp((localAppData) => {
    persistOut001RootEvidence({ report: rootReport({ state: 'FAILED', testsPassed: false }), options: { localAppData } });
    assert.equal(readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha, manifest, options: { localAppData } }).report.testsPassed, false);
  }));
  test('root report manifest binds exact bytes and SHA-256', () => withTemp((localAppData) => {
    const saved = persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    const bytes = readFileSync(saved.paths.report);
    assert.equal(saved.manifest.reportBytes, bytes.length);
    assert.equal(saved.manifest.reportSha256, createHash('sha256').update(bytes).digest('hex'));
  }));
  test('root evidence never overwrites an existing run', () => withTemp((localAppData) => {
    persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    assert.throws(() => persistOut001RootEvidence({ report: rootReport(), options: { localAppData } }), /OVERWRITE_REFUSED/);
  }));
  test('missing root report blocks launcher authority validation', () => withTemp((localAppData) => {
    assert.throws(() => readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha, manifest, options: { localAppData } }));
  }));
  test('corrupt root report blocks launcher authority validation', () => withTemp((localAppData) => {
    const saved = persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    writeFileSync(saved.paths.report, '{corrupt');
    assert.throws(() => readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha, manifest, options: { localAppData } }), /JSON_INVALID|MANIFEST_INVALID/);
  }));
  test('missing mandatory root field blocks launcher authority validation', () => withTemp((localAppData) => {
    assert.throws(() => persistOut001RootEvidence({ report: rootReport({ childrenExited: undefined }), options: { localAppData } }), /FIELD_INVALID/);
    assert.throws(() => persistOut001RootEvidence({ report: rootReport({ state: undefined }), options: { localAppData } }), /STATE_INVALID/);
  }));
  test('RunId mismatch blocks root evidence validation', () => withTemp((localAppData) => {
    const saved = persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    const index = JSON.parse(readFileSync(saved.paths.manifest, 'utf8'));
    index.runId = '123e4567-e89b-42d3-a456-426614174077';
    writeFileSync(saved.paths.manifest, JSON.stringify(index));
    assert.throws(() => readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha, manifest, options: { localAppData } }), /MANIFEST_INVALID/);
  }));
  test('commit SHA mismatch blocks root evidence validation', () => withTemp((localAppData) => {
    persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    assert.throws(() => readAndValidateOut001RootEvidence({ runId: rootRunId, commitSha: 'c'.repeat(40), manifest, options: { localAppData } }));
  }));
  test('launcher PASS needs exit 0 and all four terminal assertions', () => {
    assert.equal(rootEvidenceIsPassing(rootReport(), 0), true);
    assert.equal(rootEvidenceIsPassing(rootReport(), 1), false);
    assert.equal(rootEvidenceIsPassing(rootReport({ cleanupProven: false }), 0), false);
  });
  test('FAILED is preserved as failure rather than PASS', () => {
    assert.equal(rootEvidenceIsPassing(rootReport({ state: 'FAILED', testsPassed: false }), 0), false);
  });
  test('launcher result has an independently checked byte manifest and root verdict', () => withTemp((localAppData) => {
    const saved = persistOut001RootEvidence({ report: rootReport(), options: { localAppData } });
    const result = { version: 1, runId: rootRunId, commitSha, manifest,
      gateExitCode: 0, rootEvidenceValid: true, rootState: 'FINISHED', result: 'PASS' };
    const bytes = Buffer.from(`${JSON.stringify(result)}\n`);
    atomicWriteOut001Evidence(saved.paths.launcherResult, bytes);
    atomicWriteOut001Evidence(saved.paths.launcherManifest, Buffer.from(JSON.stringify({
      version: 1, runId: rootRunId, commitSha, manifest, resultFile: 'launcher-result.json',
      resultBytes: bytes.length, resultSha256: createHash('sha256').update(bytes).digest('hex'),
    })));
    const input = { runId: rootRunId, commitSha, manifest, options: { localAppData } };
    assert.equal(readAndValidateOut001LauncherEvidence(input).result.result, 'PASS');
    writeFileSync(saved.paths.launcherResult, Buffer.from(`${JSON.stringify({ ...result, gateExitCode: 1 })}\n`));
    assert.throws(() => readAndValidateOut001LauncherEvidence(input), /MANIFEST_INVALID/);
  }));
  test('root evidence redacts password, private key and lease secret bytes', () => withTemp((localAppData) => {
    const secrets = ['db-password-secret', 'private-key-secret', 'lease-secret-value'];
    const saved = persistOut001RootEvidence({
      report: rootReport({ evidence: [{ diagnostic: secrets.join('|') }] }), secrets, options: { localAppData },
    });
    const text = readFileSync(saved.paths.report, 'utf8');
    for (const secret of secrets) assert.ok(!text.includes(secret));
    assert.ok(text.includes('[REDACTED]'));
  }));

  function createReconciliationFixture(localAppData, runId) {
    const evidenceRoot = resolve(localAppData, 'ModernERP', 'mysql-gate', 'evidence', runId);
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const rows = [
      ['operation-RESET_SCHEMA_PRE_RUN', 'RESET_SCHEMA_PRE_RUN', '{"operation":"RESET_SCHEMA_PRE_RUN","dropped":0,"inventory":{"tables":0,"views":0,"triggers":0,"routines":0,"events":0}}\n'],
      ['operation-BOOTSTRAP_CURRENT_SCHEMA', 'BOOTSTRAP_CURRENT_SCHEMA', '{"operation":"BOOTSTRAP_CURRENT_SCHEMA","bootstrapped":true}\n'],
      ['suite-RUN_OUT001_HTTP_FIXTURES', 'RUN_OUT001_HTTP_FIXTURES', '    ok 1 - M1 lock\n    ok 2 - M1b request\n    ok 3 - M2 race\n    ok 4 - M3 state\n    ok 5 - M4 parity\n    ok 6 - M5 unique\n# tests 34\n# pass 34\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'],
      ['operation-CLEANUP_SCHEMA_POST_RUN', 'CLEANUP_SCHEMA_POST_RUN', '{"operation":"CLEANUP_SCHEMA_POST_RUN","dropped":331,"inventory":[]}\n'],
      ['postflight-POSTFLIGHT', 'POSTFLIGHT', '{"operation":"POSTFLIGHT","inventory":{"tables":0,"views":0,"triggers":0,"routines":0,"events":0}}\n'],
    ];
    for (const [label, operation, stdout] of rows) {
      const dir = join(evidenceRoot, 'suites', label); mkdirSync(dir, { recursive: true });
      const stderr = ''; writeFileSync(join(dir, 'stdout.tap'), stdout); writeFileSync(join(dir, 'stderr.log'), stderr);
      const result = { runId, operation, exitCode: 0, failure: null, streamErrors: [],
        stdout: { bytes: Buffer.byteLength(stdout), sha256: digest(Buffer.from(stdout)) },
        stderr: { bytes: 0, sha256: digest(Buffer.alloc(0)) } };
      writeFileSync(join(dir, 'result.json'), JSON.stringify(result));
    }
    writeFileSync(join(evidenceRoot, 'launcher.stdout.log'), 'launcher');
    writeFileSync(join(evidenceRoot, 'launcher-result.json'), '{}');
    const childRoot = resolve(localAppData, 'ModernERP', 'mysql-gate', 'ack4', 'children', runId);
    mkdirSync(join(childRoot, 'consumed'), { recursive: true }); mkdirSync(join(childRoot, 'descendants'), { recursive: true });
    ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_OUT001_HTTP_FIXTURES', 'CLEANUP_SCHEMA_POST_RUN'].forEach((operation, index) => {
      writeFileSync(join(childRoot, 'consumed', `${index}.consumed.json`), JSON.stringify({ runId, commitSha, manifest, rootPid: 9000, childPid: 9100 + index, childStartedAt: `2026-11-09T00:00:0${index}.000Z`, operation }));
    });
    const descendants = Array.from({ length: OUT_001_EXPECTED_HTTP_APP_COUNT }, (_, index) => JSON.stringify({ version: 1, runId, purpose: 'OUT001_HTTP_APP', pid: 9200 + index, processCreatedAt: `2026-11-09T00:01:0${index}.000Z`, registeredAt: '2026-11-09T00:02:00.000Z' })).join('\n');
    writeFileSync(join(childRoot, 'descendants', `${runId}.jsonl`), `${descendants}\n`);
    return evidenceRoot;
  }
  const reconciliationRunId = '123e4567-e89b-42d3-a456-426614174088';
  test('offline reconciliation validates five evidence groups and process records', () => withTemp(async (localAppData) => {
    createReconciliationFixture(localAppData, reconciliationRunId);
    const report = await reconcileOut001RunEvidence({ runId: reconciliationRunId, commitSha, localAppData, write: false });
    assert.equal(report.groups.length, 5); assert.equal(report.processes.leases.length, 4); assert.equal(report.processes.descendants.length, OUT_001_EXPECTED_HTTP_APP_COUNT);
  }));
  test('offline reconciliation rejects a tampered stream', () => withTemp(async (localAppData) => {
    const evidenceRoot = createReconciliationFixture(localAppData, reconciliationRunId);
    writeFileSync(join(evidenceRoot, 'suites', 'operation-RESET_SCHEMA_PRE_RUN', 'stdout.tap'), 'tampered');
    await assert.rejects(reconcileOut001RunEvidence({ runId: reconciliationRunId, commitSha, localAppData, write: false }), /EVIDENCE_INVALID/);
  }));
  test('reconciliation is explicitly not an original root report', () => withTemp(async (localAppData) => {
    createReconciliationFixture(localAppData, reconciliationRunId);
    const report = await reconcileOut001RunEvidence({ runId: reconciliationRunId, commitSha, localAppData, write: false });
    assert.equal(report.status, 'RECONSTRUCTED_NOT_ORIGINAL'); assert.equal(report.originalRootReportPresent, false);
  }));
  test('reconciliation never claims historical process exit re-verification', () => withTemp(async (localAppData) => {
    createReconciliationFixture(localAppData, reconciliationRunId);
    const report = await reconcileOut001RunEvidence({ runId: reconciliationRunId, commitSha, localAppData, write: false });
    assert.ok(report.processes.identities.every((item) => item.historicalExitStatus === 'REPORTED_NOT_REVERIFIED'));
  }));
  test('reconciliation import graph remains offline and contains no database adapter', () => {
    const source = readFileSync(resolve('scripts/gates/reconcile-out001-run-evidence.mjs'), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(mysql2|server\/db|mysql-local-preflight)/);
  });
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
      verifyCleanup: async () => ({ clean, inventory: clean ? [] : ['tables=1'],
        postflightChild: { childPid: 299, childStartedAt: 'postflight-start',
          operation: 'POSTFLIGHT', exited: true, exitCode: 0 } }),
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

function descendantEvidence(dir, runId, { initialize = true } = {}) {
  const childLeasePath = join(dir, 'suite-0.lease.json');
  writeFileSync(childLeasePath, '{}');
  const registryPath = initialize
    ? initializeOut001DescendantRegistry(dir, runId)
    : out001DescendantRegistryPath(dir, runId);
  return Object.freeze({ registryPath, childLeasePath, runId });
}

function spawnSuiteParent({ exitAfterChildren }) {
  const childCode = "setInterval(()=>{},1000)";
  // The descendant registry requires exactly one registration per independent
  // HTTP application process: M1b's application, M2's two, and M3's victim.
  const parentCode = [
    "const { spawn } = require('node:child_process');",
    `const a=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true,detached:true});`,
    `const b=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true,detached:true});`,
    `const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true,detached:true});`,
    `const d=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true,detached:true});`,
    'process.stdout.write(JSON.stringify({pids:[a.pid,b.pid,c.pid,d.pid]})+"\\n");',
    exitAfterChildren
      ? "let left=4;const done=()=>{left-=1;if(left===0)process.exit(0)};a.once('exit',done);b.once('exit',done);c.once('exit',done);d.once('exit',done);"
      : "process.stdin.resume();process.stdin.once('data',()=>process.exit(0));",
  ].join('');
  return spawn(process.execPath, ['-e', parentCode], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
}

async function registerDescendants(evidence, pids) {
  for (const pid of pids) {
    await appendOut001DescendantRegistration({ ...evidence, pid });
  }
}

function killTestProcessTree(pid) {
  if (!processExists(pid)) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}

describe('OUT-001 protected MySQL Gate infrastructure (offline)', () => {
  test('read-only suite and postflight inherit no destructive reset flags', () => {
    const environment = { ERP_DB_PASSWORD: 'unprinted-secret', ERP_MYSQL_TEST_ALLOW_RESET: 'true',
      ERP_MYSQL_TEST_DISPOSABLE_TARGET: 'one-target',
      ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP' };
    for (const mode of ['suite', 'postflight']) {
      const child = out001ChildEnvironment(environment, mode);
      assert.equal(child.ERP_DB_PASSWORD, environment.ERP_DB_PASSWORD);
      for (const key of ['ERP_MYSQL_TEST_ALLOW_RESET', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET',
        'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS']) assert.equal(child[key], undefined);
    }
    assert.equal(out001ChildEnvironment(environment, 'operation').ERP_MYSQL_TEST_ALLOW_RESET, 'true');
  });
  test('recovery has a dedicated executable entry and cannot run the business suite', () => {
    const runner = readFileSync(new URL('../scripts/gates/mysql-out001-recovery.mjs', import.meta.url), 'utf8');
    const launcher = readFileSync(new URL('../scripts/gates/run-out001-mysql-recovery.ps1', import.meta.url), 'utf8');
    assert.match(runner, /recoverAck4Quarantine\(/);
    assert.match(runner, /ACK4_RECOVERY_V1/);
    assert.doesNotMatch(runner, /runHttpFixtures|--mode['"],?\s*['"]suite|operation:\s*['"]RUN_OUT001_HTTP_FIXTURES/);
    assert.match(launcher, /mysql-local-preflight\.mjs/);
    assert.match(launcher, /Global\\ModernERP\.MySqlGate/);
  });
  test('recovery blocks live old processes and missing HTTP descendant proof', async () => {
    const marker = { state: 'CLEANUP_UNVERIFIED', runId: '123e4567-e89b-42d3-a456-426614174066',
      rootPid: 100, rootStartedAt: '2026-11-09T00:00:00.000Z',
      children: [{ childPid: 200, childStartedAt: '2026-11-09T00:01:00.000Z',
        operation: 'CLEANUP_SCHEMA_POST_RUN' }] };
    await assert.rejects(() => assertOldTreeExited(marker, 'unused', async (pid) =>
      pid === 100 ? { pid, processCreatedAt: marker.rootStartedAt } : null), /STILL_ACTIVE/);
    await assert.doesNotReject(() => assertOldTreeExited(marker, 'unused', async () => null));
    await assert.rejects(() => assertOldTreeExited({ ...marker, children: [
      { ...marker.children[0], operation: 'RUN_OUT001_HTTP_FIXTURES' },
    ] }, 'missing-store', async () => null), /DESCENDANT_PROOF_MISSING/);
  });
  test('Windows child lease creation time comes from the operating system', {
    skip: process.platform === 'win32' ? false : 'Windows process identity is required',
  }, async () => {
    const identity = await readWindowsProcessIdentity(process.pid);
    assert.equal(identity.pid, process.pid);
    assert.ok(Number.isFinite(Date.parse(identity.processCreatedAt)));
    const runner = readFileSync(new URL('../scripts/gates/mysql-out001-gate.mjs', import.meta.url), 'utf8');
    assert.match(runner, /childStartedAt = identity\.processCreatedAt/);
  });
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
    assert.match(launcher, /\$item\.tap\.passed/);
    assert.match(launcher, /\$item\.tap\.failed/);
    assert.doesNotMatch(launcher, /\$item\.tap\.pass\b/);
    assert.doesNotMatch(launcher, /\$item\.tap\.fail\b/);
    assert.match(runner, /ERP_OUT_001_DESCENDANT_REGISTRY/);
    assert.match(runner, /await ensureOut001ChildExited\(entry\)/);
  });

  test('A: exited Suite plus two registered exited M2 apps permits Root cleanup', {
    skip: process.platform === 'win32' ? false : 'Windows-only descendant registry evidence',
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-descendants-ok-'));
    const runId = '123e4567-e89b-42d3-a456-426614174030';
    const evidence = descendantEvidence(dir, runId);
    const suite = spawnSuiteParent({ exitAfterChildren: true });
    let pids = [];
    try {
      pids = JSON.parse(await waitForLine(suite.stdout)).pids;
      await registerDescendants(evidence, pids);
      for (const pid of pids) killTestProcessTree(pid);
      assert.equal(await collectOut001Child({
        child: suite, mode: 'suite', operation: 'RUN_OUT001_HTTP_FIXTURES',
      }, { timeoutMs: 5_000 }), 0);
      const entry = { child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: evidence };
      assert.equal(await ensureOut001ChildExited(entry), true,
        'two registered apps with matching identities have exited');

      const root = consumeSimulatedRoot(dir, runId);
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      let registered;
      input.runHttpFixtures = async (context) => {
        calls.push('RUN_OUT001_HTTP_FIXTURES');
        context.issueChild({ childPid: suite.pid, childStartedAt: 'suite-normal' });
        registered = context;
        return { passed: true };
      };
      input.stopChildren = async () => {
        const exited = await ensureOut001ChildExited(entry);
        if (exited) registered.markChildExited(suite.pid, 'suite-normal');
        return exited;
      };
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'FINISHED');
      assert.equal(report.childrenExited, true);
      assert.equal(report.childCount, 5);
      assert.equal(report.cleanupAttempts, 1);
      assert.equal(report.cleanupProven, true);
    } finally {
      for (const pid of pids) killTestProcessTree(pid);
      killTestProcessTree(suite.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('B: exited Suite with registered live M2 descendant blocks cleanup and quarantines', {
    skip: process.platform === 'win32' ? false : 'Windows-only descendant registry evidence',
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-descendants-live-'));
    const runId = '123e4567-e89b-42d3-a456-426614174031';
    const evidence = descendantEvidence(dir, runId);
    const suite = spawnSuiteParent({ exitAfterChildren: false });
    let pids = [];
    try {
      pids = JSON.parse(await waitForLine(suite.stdout)).pids;
      await registerDescendants(evidence, pids);
      suite.stdin.end('EXIT\n');
      assert.equal(await collectOut001Child({
        child: suite, mode: 'suite', operation: 'RUN_OUT001_HTTP_FIXTURES',
      }, { timeoutMs: 5_000 }), 0);
      assert.ok(pids.every(processExists), 'registered descendants must still be running after Suite exit');
      const entry = { child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: evidence };
      assert.equal(await ensureOut001ChildExited(entry), false,
        'parent exit cannot bypass a matching live descendant identity');

      const root = consumeSimulatedRoot(dir, runId);
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      input.runHttpFixtures = async (context) => {
        calls.push('RUN_OUT001_HTTP_FIXTURES');
        context.issueChild({ childPid: suite.pid, childStartedAt: 'suite-live-descendant' });
        return { passed: true };
      };
      input.stopChildren = async () => ensureOut001ChildExited(entry);
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'CLEANUP_UNVERIFIED');
      assert.equal(report.childrenExited, false);
      assert.equal(report.cleanupAttempts, 0);
      assert.equal(report.cleanupProven, false);
      assert.ok(pids.every(processExists), 'read-only verification must not kill a live descendant');
    } finally {
      for (const pid of pids) killTestProcessTree(pid);
      killTestProcessTree(suite.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('C: missing, malformed or wrong-RunId descendant evidence fails closed', {
    skip: process.platform === 'win32' ? false : 'Windows-only descendant registry evidence',
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-descendants-invalid-'));
    const runId = '123e4567-e89b-42d3-a456-426614174032';
    const suite = spawn(process.execPath, ['-e', ''], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    try {
      await collectOut001Child({ child: suite, mode: 'suite', operation: 'RUN_OUT001_HTTP_FIXTURES' }, { timeoutMs: 5_000 });
      const missing = descendantEvidence(dir, runId, { initialize: false });
      assert.equal(await ensureOut001ChildExited({
        child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: missing,
      }), false);

      const malformed = descendantEvidence(dir, runId);
      writeFileSync(malformed.registryPath, '{not-json}\n');
      assert.equal(await ensureOut001ChildExited({
        child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: malformed,
      }), false);

      const wrongRunId = '123e4567-e89b-42d3-a456-426614174033';
      const now = new Date().toISOString();
      const wrongRecords = [41001, 41002, 41003].map((pid) => JSON.stringify({
        version: 1, runId: wrongRunId, purpose: 'OUT001_HTTP_APP', pid,
        processCreatedAt: now, registeredAt: now,
      })).join('\n');
      writeFileSync(malformed.registryPath, `${wrongRecords}\n`);
      assert.equal(await ensureOut001ChildExited({
        child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: malformed,
      }), false);

      const root = consumeSimulatedRoot(dir, runId);
      const { calls, input } = lifecycleDependencies(root);
      input.quarantineDir = join(dir, 'quarantine');
      const invalidEntry = {
        child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: malformed,
      };
      input.runHttpFixtures = async (context) => {
        calls.push('RUN_OUT001_HTTP_FIXTURES');
        context.issueChild({ childPid: suite.pid, childStartedAt: 'suite-invalid-registry' });
        return { passed: true };
      };
      input.stopChildren = async () => ensureOut001ChildExited(invalidEntry);
      const report = await runOut001MySqlLifecycle(input);
      assert.equal(report.state, 'CLEANUP_UNVERIFIED');
      assert.equal(report.childrenExited, false);
      assert.equal(report.cleanupAttempts, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

const EVIDENCE_RUN_ID = '123e4567-e89b-42d3-a456-426614174040';

function tapText({ tests = 1, pass = 1, fail = 0, skipped = 0, cancelled = 0, todo = 0 } = {}) {
  const lines = ['TAP version 13'];
  for (let index = 1; index <= tests; index += 1) {
    lines.push(`${index <= pass ? 'ok' : 'not ok'} ${index} - case ${index}`);
  }
  lines.push(`1..${tests}`);
  lines.push(`# tests ${tests}`);
  lines.push('# suites 0');
  lines.push(`# pass ${pass}`);
  lines.push(`# fail ${fail}`);
  lines.push(`# cancelled ${cancelled}`);
  lines.push(`# skipped ${skipped}`);
  lines.push(`# todo ${todo}`);
  lines.push('');
  return lines.join('\n');
}

async function captureEvidence({
  code, label = 'suite-RUN_OUT001_HTTP_FIXTURES', secrets = [], runId = EVIDENCE_RUN_ID, timeoutMs = 10_000,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-evidence-'));
  const evidence = createOut001EvidenceWriter({ runId, label, secrets, options: { localAppData: dir } });
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  evidence.attach(child);
  let exitCode = null;
  let failure = null;
  try {
    exitCode = await collectOut001Child(
      { child, mode: 'suite', operation: 'RUN_OUT001_HTTP_FIXTURES' },
      { timeoutMs },
    );
  } catch (error) {
    failure = error;
  }
  const result = await evidence.finalize({
    exitCode,
    failure: failure ? { code: failure.code || null, message: failure.message } : null,
  });
  return { dir, evidence, result, exitCode, failure, child };
}

describe('OUT-001 Gate TAP evidence persistence (offline)', () => {
  test('a passing suite persists both streams with digests and a parsed TAP summary', async () => {
    const tap = tapText({ tests: 3, pass: 3 });
    const captured = await captureEvidence({
      code: `process.stdout.write(${JSON.stringify(tap)});process.stderr.write('diagnostic line');`,
    });
    try {
      const { result } = captured;
      assert.equal(result.exitCode, 0);
      assert.equal(result.tapParsed, true);
      assert.deepEqual({ ...result.tap }, {
        tests: 3, passed: 3, failed: 0, skipped: 0, cancelled: 0, todo: 0,
      });
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), true);
      assert.equal(readFileSync(result.stdoutPath, 'utf8'), tap, 'stdout must be persisted completely');
      assert.equal(readFileSync(result.stderrPath, 'utf8'), 'diagnostic line');
      assert.equal(result.stdoutBytes, Buffer.byteLength(tap));
      assert.equal(result.stderrBytes, Buffer.byteLength('diagnostic line'));
      assert.match(result.stdoutSha256, /^[0-9a-f]{64}$/);
      assert.match(result.stderrSha256, /^[0-9a-f]{64}$/);
      assert.ok(result.stdoutPath.includes(EVIDENCE_RUN_ID), 'the evidence path must be bound to the RunId');
      const persisted = JSON.parse(readFileSync(result.resultPath, 'utf8'));
      assert.equal(persisted.suite, 'suite-RUN_OUT001_HTTP_FIXTURES');
      assert.equal(persisted.exitCode, 0);
      assert.equal(persisted.stdout.sha256, result.stdoutSha256);
      assert.equal(persisted.stderr.sha256, result.stderrSha256);
      assert.equal(persisted.tap.tests, 3);
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a failing suite is persisted and can never be reported as PASS', async () => {
    const tap = tapText({ tests: 2, pass: 1, fail: 1 });
    const captured = await captureEvidence({
      code: `process.stdout.write(${JSON.stringify(tap)});process.exitCode=1;`,
    });
    try {
      const { result } = captured;
      assert.equal(result.exitCode, 1);
      assert.equal(result.tapParsed, true);
      assert.equal(result.tap.failed, 1);
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), false);
      assert.equal(readFileSync(result.stdoutPath, 'utf8'), tap, 'a failing suite keeps its full stdout');
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a very large stdout is persisted in full and never truncated', async () => {
    const payloadSize = 4 * 1024 * 1024;
    const tap = tapText({ tests: 1, pass: 1 });
    const captured = await captureEvidence({
      code: [
        `process.stdout.write('x'.repeat(${payloadSize}));`,
        `process.stdout.write(${JSON.stringify(tap)});`,
      ].join(''),
    });
    try {
      const { result } = captured;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdoutBytes, payloadSize + Buffer.byteLength(tap));
      const persisted = readFileSync(result.stdoutPath, 'utf8');
      assert.equal(persisted.length, result.stdoutBytes);
      assert.ok(persisted.startsWith('x'.repeat(1024)), 'the large payload must not be cut');
      assert.ok(persisted.endsWith(tap), 'the TAP summary must be present after the large payload');
      assert.equal(result.tapParsed, true);
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), true);
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a very large stderr is persisted in full and separately from stdout', async () => {
    const payloadSize = 2 * 1024 * 1024;
    const tap = tapText({ tests: 1, pass: 1 });
    const captured = await captureEvidence({
      code: [
        `process.stderr.write('y'.repeat(${payloadSize}));`,
        `process.stdout.write(${JSON.stringify(tap)});`,
      ].join(''),
    });
    try {
      const { result } = captured;
      assert.equal(result.stderrBytes, payloadSize);
      assert.equal(readFileSync(result.stderrPath, 'utf8'), 'y'.repeat(payloadSize));
      assert.ok(!readFileSync(result.stdoutPath, 'utf8').includes('y'.repeat(1024)),
        'stderr must not be mixed into the stdout evidence');
      assert.equal(result.tapParsed, true);
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a non-zero child exit still persists evidence and is never PASS', async () => {
    const captured = await captureEvidence({ code: 'process.exit(3);' });
    try {
      const { result } = captured;
      assert.equal(result.exitCode, 3);
      assert.equal(result.tapParsed, false, 'a child that produced no TAP cannot be parsed');
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), false);
      assert.ok(result.stdoutPath.endsWith('stdout.tap'));
      assert.ok(result.stderrPath.endsWith('stderr.log'));
      assert.ok(result.resultPath.endsWith('result.json'));
      assert.ok(readFileSync(result.resultPath, 'utf8').includes('"exitCode": 3'));
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a child timeout still persists evidence and records the failure', async () => {
    const captured = await captureEvidence({ code: 'setInterval(()=>{},1000);', timeoutMs: 100 });
    try {
      const { result } = captured;
      assert.ok(captured.failure, 'the child collection must fail closed on timeout');
      assert.equal(captured.failure.code, 'OUT_001_MYSQL_CHILD_TIMEOUT');
      assert.equal(result.exitCode, null);
      assert.ok(result.failure, 'the evidence must record the timeout failure');
      assert.equal(result.failure.code, 'OUT_001_MYSQL_CHILD_TIMEOUT');
      assert.equal(result.tapParsed, false);
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), false);
      assert.ok(readFileSync(result.resultPath, 'utf8').includes('OUT_001_MYSQL_CHILD_TIMEOUT'));
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('an output stream exception truncates the evidence and can never be PASS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-evidence-stream-'));
    try {
      const evidence = createOut001EvidenceWriter({
        runId: EVIDENCE_RUN_ID,
        label: 'suite-RUN_OUT001_HTTP_FIXTURES',
        options: { localAppData: dir },
      });
      const child = spawn(process.execPath, ['-e', [
        "process.stdout.write('TAP version 13\\n# tests 1\\n# pass 1\\n# fail 0\\n');",
        'setInterval(()=>{},1000);',
      ].join('')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      evidence.attach(child);
      await new Promise((done) => setTimeout(done, 300));
      // 模拟输出流异常：读端被销毁，管道不再正常结束。
      child.stdout.destroy();
      await new Promise((done) => setTimeout(done, 100));
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      const result = await evidence.finalize({ exitCode: null, failure: { code: 'SIMULATED_STREAM_ERROR', message: 'simulated' } });
      assert.equal(result.tapParsed, false, 'a truncated TAP must not parse');
      assert.equal(out001SuitePassed({ exitCode: result.exitCode, tap: result.tap }), false);
      assert.ok(result.stdoutBytes > 0, 'the partial output must still be persisted');
      assert.ok(readFileSync(result.resultPath, 'utf8').includes('SIMULATED_STREAM_ERROR'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a corrupted TAP summary is rejected instead of being read as "no failures"', () => {
    assert.equal(parseOut001TapSummary('TAP version 13\nok 1 - a\n'), null);
    assert.equal(parseOut001TapSummary('# tests 5\n# pass 2\n# fail 0\n# skipped 0\n'), null,
      'an inconsistent summary must not parse');
    assert.equal(parseOut001TapSummary('# tests notanumber\n# pass 1\n# fail 0\n# skipped 0\n'), null);
    assert.equal(parseOut001TapSummary(''), null);
    assert.equal(out001SuitePassed({ exitCode: 0, tap: null }), false);
    assert.equal(out001SuitePassed({ exitCode: 0, tap: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 } }), true);
    assert.equal(out001SuitePassed({ exitCode: 0, tap: { tests: 2, passed: 1, failed: 1, skipped: 0, cancelled: 0, todo: 0 } }), false);
    assert.equal(out001SuitePassed({ exitCode: 0, tap: { tests: 2, passed: 1, failed: 0, skipped: 0, cancelled: 1, todo: 0 } }), false);
    assert.equal(out001SuitePassed({ exitCode: 0, tap: { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 } }), false,
      'a suite that ran no test at all is never PASS');
  });

  test('the database password and the approval plaintext never reach the evidence files', async () => {
    const password = 'sup3r-secret-db-password';
    const approval = 'exact owner approval summary text';
    const captured = await captureEvidence({
      code: `process.stdout.write(${JSON.stringify(`password=${password} approval=${approval}`)});`,
      secrets: [password, approval],
    });
    try {
      const { result } = captured;
      const stdout = readFileSync(result.stdoutPath, 'utf8');
      assert.ok(!stdout.includes(password), 'the database password must never be persisted');
      assert.ok(!stdout.includes(approval), 'the approval plaintext must never be persisted');
      assert.ok(stdout.includes('[REDACTED]'), 'the redaction marker must be present');
      assert.ok(result.redactions > 0, 'the redaction count must be recorded');
      const persisted = JSON.parse(readFileSync(result.resultPath, 'utf8'));
      assert.equal(persisted.redactions.applied, result.redactions);
    } finally {
      rmSync(captured.dir, { recursive: true, force: true });
    }
  });

  test('a live descendant keeps the evidence but blocks the PASS verdict', {
    skip: process.platform === 'win32' ? false : 'Windows-only descendant registry evidence',
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-evidence-tree-'));
    const registryDir = mkdtempSync(join(tmpdir(), 'modern-erp-out001-evidence-tree-reg-'));
    const runId = '123e4567-e89b-42d3-a456-426614174041';
    const suite = spawnSuiteParent({ exitAfterChildren: false });
    let pids = [];
    try {
      const evidence = createOut001EvidenceWriter({
        runId,
        label: 'suite-RUN_OUT001_HTTP_FIXTURES',
        options: { localAppData: dir },
      });
      // 先接管输出，再读取 PID 行：否则那一行会被读取方吃掉，证据里就没有它。
      evidence.attach(suite);
      pids = JSON.parse(await waitForLine(suite.stdout)).pids;
      // 父进程正常退出，但它的后代继续存活：这正是「进程树未退出」。
      suite.stdin.end('EXIT\n');
      const exitCode = await collectOut001Child(
        { child: suite, mode: 'suite', operation: 'RUN_OUT001_HTTP_FIXTURES' },
        { timeoutMs: 10_000 },
      );
      const result = await evidence.finalize({ exitCode });
      assert.equal(result.exitCode, 0, 'the child itself exited normally');
      assert.ok(result.stdoutBytes > 0, 'the evidence of the exited child must still be persisted');
      const descendant = descendantEvidence(registryDir, runId);
      await registerDescendants(descendant, pids);
      const entry = { child: suite, operation: 'RUN_OUT001_HTTP_FIXTURES', descendantRegistry: descendant };
      assert.equal(await ensureOut001ChildExited(entry), false,
        'a live descendant must block the PASS verdict even when the child exit code is 0');
    } finally {
      for (const pid of pids) killTestProcessTree(pid);
      killTestProcessTree(suite.pid);
      rmSync(dir, { recursive: true, force: true });
      rmSync(registryDir, { recursive: true, force: true });
    }
  });
});
