import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  assertCompleteG07Contract, assertG03EvidenceLayering, assertG07AuthoritativeEvidence, assertG07RaceOutcome, assertG07Result,
  assertProcessingPoItemStable, assertProcessingPoRejected, assertSafeIntegerCents, assertUat14VmiReceiptOracle,
  G07_SUPPLEMENTAL_ORACLES, M1_CORE_G07_SCENARIOS,
} from './test-support/m1-core-g07-contract.js';
import { compareTableParity, readMySqlInformationSchemaContract } from './test-utils/m1-core-schema-parity.js';
import {
  assertFixedFixtureManifest, computeM1CoreG07FixtureDigest, M1_CORE_G07_FIXED_FIXTURE_DIGEST,
  M1_CORE_G07_FIXED_SCENARIOS, M1_CORE_G07_TECHNICAL_L2_PREREQUISITES,
} from './test-support/m1-core-g07-fixtures.js';
import { buildM1CoreG07HttpFixtures } from './test-support/m1-core-g07-http-fixture-builder.js';
import { runM1CoreG07Lifecycle } from '../scripts/gates/m1-core-g07-root-lifecycle.mjs';
import { createChildFailureError } from '../scripts/gates/m1-core-g07-diagnostics.mjs';
import { assertM1CoreG07StaticPreflight, M1_G07_REQUIRED_ENVIRONMENT } from '../scripts/gates/m1-core-g07-static-preflight.mjs';
import { assertNoAck4Quarantine, consumeAck4Record, M1_CORE_MANIFEST } from '../scripts/gates/ack4/ack4-runtime.mjs';

const target = Object.freeze({
  host: '127.0.0.1', port: 3306, database: 'modern_erp_m1_test', user: 'erp_test',
  selectedDatabase: 'modern_erp_m1_test', currentUser: 'erp_test@localhost',
  serverUuid: '00000000-0000-0000-0000-000000000001', grantsSha256: 'a'.repeat(64),
});
const commitSha = 'b'.repeat(40);

function simulatedRoot(dir, runId = '123e4567-e89b-42d3-a456-426614174000') {
  const now = Date.now();
  const record = {
    version: 1, runId, commitSha, manifest: 'M1_CORE_G07_V1', operations: [...M1_CORE_MANIFEST], target,
    approval: { subject: 'owner', channel: 'session', reference: 'approval', summary: 'exact run' },
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  };
  const issuedPath = join(dir, `${runId}.issued`); writeFileSync(issuedPath, JSON.stringify(record));
  return consumeAck4Record({
    issuedPath, consumedDir: join(dir, 'consumed'), expected: {
      runId, commitSha, manifest: 'M1_CORE_G07_V1', operations: M1_CORE_MANIFEST, target, sid: 'test-sid',
    }, decrypt: (bytes) => JSON.parse(bytes), rootPid: 100, rootStartedAt: 'root-start',
  });
}

describe('M1C-G07 dedicated offline infrastructure', () => {
  test('CR-01..CR-09 are complete and every race uses production HTTP plus full ordered snapshots', () => {
    assert.equal(assertCompleteG07Contract(), true);
    assert.deepEqual(M1_CORE_G07_SCENARIOS.map((item) => item.id), [
      'CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06', 'CR-07', 'CR-08', 'CR-09',
    ]);
    for (const item of M1_CORE_G07_SCENARIOS) {
      assert.equal(item.fixtureChannel, 'PRODUCTION_HTTP');
      assert.equal(item.synchronization, 'MYSQL_TRANSACTION_GATE_AND_LOCK_WAIT');
      assert.equal(item.snapshotMode, 'FULL_ORDERED_ROWS');
      assert.equal(item.exactRejectAuditCount, 1);
      assert.equal(item.loserBusinessSideEffects, 0);
    }
  });

  test('exact outcome oracle rejects wrong status, wrong code, double success and double rejection', () => {
    const cr01 = M1_CORE_G07_SCENARIOS[0];
    assert.doesNotThrow(() => assertG07RaceOutcome(cr01, [
      { status: 201, data: { id: 'winner' } },
      { status: 409, data: { code: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED' } },
    ]));
    for (const responses of [
      [{ status: 201, data: {} }, { status: 201, data: {} }],
      [{ status: 409, data: { code: cr01.failureCode } }, { status: 409, data: { code: cr01.failureCode } }],
      [{ status: 201, data: {} }, { status: 409, data: { code: 'WRONG' } }],
    ]) assert.throws(() => assertG07RaceOutcome(cr01, responses), /OUTCOME_MISMATCH/);
  });

  test('supplemental oracles cover stable item, injection, PO Change, UAT-14, evidence levels, safe cents and real parity', () => {
    assert.deepEqual(G07_SUPPLEMENTAL_ORACLES.map((item) => item.id), [
      'PO-ITEM-STABLE', 'PO-INJECTION', 'PO-CHANGE', 'UAT-14', 'G03-L1-L2', 'SAFE-INTEGER', 'SCHEMA-PARITY',
    ]);
  });

  test('dedicated runner and suite never register race_probe_generic or the superseded generic procurement suite', () => {
    const runner = readFileSync(new URL('../scripts/gates/mysql-m1-core-gate.mjs', import.meta.url), 'utf8');
    const child = readFileSync(new URL('../scripts/gates/m1-core-g07-child.mjs', import.meta.url), 'utf8');
    const launcher = readFileSync(new URL('../scripts/gates/run-mysql-local-gate.ps1', import.meta.url), 'utf8');
    const suite = readFileSync(new URL('./mysql-m1-core-g07.integration.js', import.meta.url), 'utf8');
    for (const source of [runner, child, suite]) {
      assert.doesNotMatch(source, /race_probe_generic/);
      assert.doesNotMatch(source, /mysql-procurement-outsourcing-concurrency\.integration/);
    }
    assert.match(runner, /mysql-m1-core-g07\.integration\.js/);
    assert.match(suite, /M1_CORE_G07_SCENARIOS/);
    assert.doesNotMatch(runner, /BLOCKED_BEFORE_CONSUMPTION|READY_TO_EXECUTE/);
    assert.ok(runner.indexOf('consumeAck4Record({') < runner.indexOf("operation: 'RESET_SCHEMA_PRE_RUN'"),
      'root runner must consume ACK-4 before the first destructive child can be launched');
    assert.match(runner, /runM1CoreG07Lifecycle/);
    assert.ok(runner.indexOf('assertM1CoreG07StaticPreflight({') < runner.indexOf('consumeAck4Record({'),
      'all pure static checks must finish before ACK-4 consumption');
    assert.match(runner, /buildM1CoreG07HttpFixtures/);
    assert.match(child, /openM1CoreG07ExistingAdapter/);
    assert.ok(child.indexOf("await consume(operation)") < child.indexOf('await openVerifiedAdapter()'),
      'child must consume its lease before opening any target connection');
    assert.match(child, /postflightProcess/);
    assert.match(child, /wave10ObjectInventory/);
    assert.match(child, /emitNodeTestTap\(stream\)/);
    assert.doesNotMatch(child, /stream\.pipe\(process\.stdout\)/,
      'suite child must convert structured node:test events before Root captures stdout');
    // The app child must boot against the already-bootstrapped schema, never
    // import server/index.js (whose createDatabase() re-runs MySQL migration /
    // view reconciliation that would exceed RUN_M1_HTTP_FIXTURES scope).
    assert.doesNotMatch(child, /server\/index\.js/);
    assert.match(child, /createApp\(verified\.db/);
    assert.match(runner, /--mode', 'postflight'/);
    assert.doesNotMatch(suite, /createDatabase\(config\)|createDatabase\(\)/);
    assert.match(suite, /openM1CoreG07ExistingAdapter/);
    assert.doesNotMatch(runner, /--fixture-plan/);
    assert.doesNotMatch(launcher, /FixturePlan/);
    assert.match(launcher, /ACK-4 STATE/);
    assert.match(launcher, /\$gateExit -eq 0 -and \$rootState -eq 'FINISHED'/);
    assert.match(launcher, /\$rootReport\.testsPassed -eq \$true/);
    assert.match(launcher, /\$rootReport\.cleanupProven -eq \$true/);
    assert.match(launcher, /\$rootReport\.childrenExited -eq \$true/);
    assert.match(launcher, /if \(\$gateExit -eq 0\) \{ exit 8 \}/, 'UNKNOWN/CLEANUP_UNVERIFIED may never inherit exit 0');
    assert.match(launcher, /Write-RootFailureDiagnostics/);
    assert.match(launcher, /M1_G07_DIAGNOSTIC_SUMMARY_BEGIN/);
    assert.match(launcher, /\$rootState -eq 'CLEANUP_UNVERIFIED'/);
    assert.doesNotMatch(launcher, /ROOT FAILURE DETAILS:[\s\S]*Select-Object -Last 40[\s\S]*exit 5/,
      'FAILED must prefer the complete marked summary instead of blindly tailing 40 lines');
  });

  test('ACK-4 static preflight binds digest, nine CRs, routes/bodies, roles, L2, environment, operations and target before consumption', () => {
    const environment = Object.fromEntries(M1_G07_REQUIRED_ENVIRONMENT.map((name) => [name, 'declared']));
    environment.ERP_DB_BACKEND = 'mysql'; environment.ERP_TEST_DB_BACKEND = 'mysql';
    const credentials = Object.fromEntries(Object.entries({ admin: 'admin', creator: 'sales', approver: 'reviewer', warehouse: 'warehouse', outsourcing: 'outsourcing', receiving: 'outsourcingreceiving' })
      .map(([subject, username]) => [subject, { username }]));
    const proof = assertM1CoreG07StaticPreflight({ target, environment, subjectCredentials: credentials });
    assert.equal(proof.crCount, 9);
    assert.equal(proof.fixtureDigest, M1_CORE_G07_FIXED_FIXTURE_DIGEST);
    assert.deepEqual(proof.operations, M1_CORE_MANIFEST);
    assert.throws(() => assertM1CoreG07StaticPreflight({ target, environment: { ...environment, ERP_DB_NAME: '' }, subjectCredentials: credentials }), /ERP_DB_NAME/);
    assert.throws(() => assertM1CoreG07StaticPreflight({ target: { ...target, selectedDatabase: 'other' }, environment, subjectCredentials: credentials }), /TARGET_BINDING/);
  });

  test('information_schema reader queries columns, indexes, FK rules and CHECK clauses', () => {
    const calls = [];
    const db = { prepare(sql) { calls.push(sql); return { all: () => [] }; } };
    readMySqlInformationSchemaContract(db, 'tracked_inventory_movements');
    assert.equal(calls.length, 4);
    assert.ok(calls.some((sql) => /information_schema\.COLUMNS/.test(sql)));
    assert.ok(calls.some((sql) => /information_schema\.STATISTICS/.test(sql)));
    assert.ok(calls.some((sql) => /REFERENTIAL_CONSTRAINTS/.test(sql)));
    assert.ok(calls.some((sql) => /CHECK_CONSTRAINTS/.test(sql)));
  });

  test('field-level parity reports exact column drift instead of accepting table presence', () => {
    const sqlite = {
      name: 'sample', sql: 'CREATE TABLE sample(id TEXT PRIMARY KEY, amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0))',
      columns: [
        { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { name: 'amount', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
      ],
      indexes: [], foreignKeys: [],
    };
    const mysql = {
      columns: [
        { column_name: 'id', data_type: 'varchar', is_nullable: 'NO', column_default: null },
        { column_name: 'amount', data_type: 'bigint', is_nullable: 'YES', column_default: '1' },
      ], indexes: [], foreignKeys: [], checks: [{ check_clause: 'amount >= 0' }],
    };
    assert.deepEqual(compareTableParity(sqlite, mysql), ['NULLABLE:amount', 'DEFAULT:amount']);
  });

  test('fixed fixture builder runs the embedded HTTP chain and pins the SHA digest', async () => {
    const calls = [];
    // Rich mock data satisfies every array-indexed $ref path (order.items.0.id,
    // materials.0.id, receipts.0.id, receiptNotice.items.0.sources.0.id).
    const richData = {
      id: 'id', rowId: 'rowId', orderNo: 'no',
      order: { items: [{ id: 'poi', productId: 'p' }] },
      materials: [{ id: 'mat', productId: 'p' }],
      receipts: [{ id: 'rcpt' }],
      receiptNotice: { items: [{ id: 'ni', sources: [{ id: 'src' }] }] },
    };
    const subjectTokens = { admin: 't-admin', creator: 't-creator', approver: 't-approver', warehouse: 't-warehouse', outsourcing: 't-outsourcing', receiving: 't-receiving' };
    const manifest = await buildM1CoreG07HttpFixtures({
      applications: { A: 'http://127.0.0.1:3101', B: 'http://127.0.0.1:3102' },
      subjectTokens,
      request: async (baseUrl, step) => {
        calls.push({ baseUrl, step });
        const status = ['GET', 'PATCH', 'PUT'].includes(step.method)
          || /\/(submit|approve|confirm|complete|transition|material-list)$/.test(step.path)
          || /^\/api\/purchase-receipts\/[^/]+$/.test(step.path) ? 200 : 201;
        return { status, data: richData };
      },
      admitTechnicalL2: async ({ prerequisite }) => ({ admitted: true, prerequisite }),
    });
    assert.equal(manifest.executionStatus, 'NOT_RUN');
    assert.equal(manifest.provenance, 'PRODUCTION_HTTP');
    assert.equal(manifest.fixtureDigest, M1_CORE_G07_FIXED_FIXTURE_DIGEST);
    assert.equal(Object.keys(manifest.scenarios).length, 9);
    assert.ok(calls.length > 0, 'setup steps must be driven through production HTTP');
    for (const [id, fixture] of Object.entries(manifest.scenarios)) {
      assert.equal(fixture.requests.length, 2, `${id} must race two requests`);
      assert.ok(fixture.requests.every((request) => request.path.startsWith('/api/') && !/[:{}]/.test(request.path)), `${id} requests must be concrete`);
      assert.ok(fixture.businessObjectProvenance.every((item) => item.channel === 'PRODUCTION_HTTP'));
    }
  });

  test('fixed fixture manifest is complete, digest-pinned and technical L2 enumerated', () => {
    const manifest = assertFixedFixtureManifest();
    assert.equal(manifest.version, 1);
    assert.equal(manifest.scenarioCount, 9);
    assert.equal(manifest.digest, M1_CORE_G07_FIXED_FIXTURE_DIGEST);
    assert.equal(computeM1CoreG07FixtureDigest(), M1_CORE_G07_FIXED_FIXTURE_DIGEST);
    assert.deepEqual(manifest.technicalL2Prerequisites, M1_CORE_G07_TECHNICAL_L2_PREREQUISITES.map((item) => item.id));
    assert.deepEqual(M1_CORE_G07_FIXED_SCENARIOS.map((item) => item.id), ['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06', 'CR-07', 'CR-08', 'CR-09']);
    assert.ok(M1_CORE_G07_TECHNICAL_L2_PREREQUISITES.length >= 4, 'technical L2 prerequisites must be enumerated');
  });

  test('assertG07Result negative controls: double success, wrong code, duplicate audit, extra idempotency and loser side effect all FAIL', () => {
    const cr01 = M1_CORE_G07_SCENARIOS[0];
    const ok = {
      responses: [{ status: 201, data: { id: 'w' } }, { status: 409, data: { code: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED' } }],
      rejectAuditCount: 1, winnerIdempotencyCount: 1, loserSideEffectCount: 0,
    };
    assert.doesNotThrow(() => assertG07Result(cr01, ok));
    for (const outcome of [
      { ...ok, responses: [{ status: 201, data: {} }, { status: 201, data: {} }] },
      { ...ok, responses: [{ status: 201, data: {} }, { status: 409, data: { code: 'WRONG' } }] },
      { ...ok, rejectAuditCount: 2 },
      { ...ok, winnerIdempotencyCount: 2 },
      { ...ok, loserSideEffectCount: 1 },
    ]) assert.throws(() => assertG07Result(cr01, outcome));
  });

  test('authoritative Oracle negative controls: inventory, WIP, cost, PO item, reject audit and business source corruption all FAIL', () => {
    const evidence = (definition, effects, legs = [{ kind: 'inventory', opening: 10, change: -6, closing: 4, sourceId: 'doc-1', identity: 'NONE' }]) => ({
      before: { full: [] }, after: { full: [] }, effects: { ...effects, winnerBusinessRowDelta: 1, loserBusinessRowDelta: 0 },
      legs, audit: { count: 1, exactRequestReject: true }, idempotency: { winnerSucceeded: 1, loserAbsent: true }, sources: { allMatched: true },
    });
    const cr04 = M1_CORE_G07_SCENARIOS[3];
    const ok04 = evidence(cr04, { documentDelta: 1, quantityDelta: 6, identityDelta: 1, amountDeltaCents: 600 });
    assert.doesNotThrow(() => assertG07AuthoritativeEvidence(cr04, ok04));
    assert.throws(() => assertG07AuthoritativeEvidence(cr04, { ...ok04, legs: [{ ...ok04.legs[0], closing: 5 }] }), /CONSERVATION/,
      'tampered inventory leg must fail');
    assert.throws(() => assertG07AuthoritativeEvidence(cr04, { ...ok04, legs: [{ ...ok04.legs[0], identity: '' }] }), /PROVENANCE/,
      'tampered WIP identity must fail');
    assert.throws(() => assertG07AuthoritativeEvidence(cr04, { ...ok04, effects: { ...ok04.effects, amountDeltaCents: 599 } }), /AMOUNTDELTACENTS/,
      'tampered cost must fail');
    const cr09 = M1_CORE_G07_SCENARIOS[8];
    const ok09 = evidence(cr09, { documentDelta: 1, quantityDelta: 10, identityDelta: 1, amountDeltaCents: 5000 },
      [{ kind: 'quantity', opening: 0, change: 10, closing: 10, sourceId: 'order-1', identity: 'po-item-1' }]);
    assert.throws(() => assertG07AuthoritativeEvidence(cr09, { ...ok09, effects: { ...ok09.effects, identityDelta: 2 } }), /IDENTITYDELTA/,
      'tampered PO item must fail');
    assert.throws(() => assertG07AuthoritativeEvidence(cr04, { ...ok04, audit: { count: 1, exactRequestReject: false } }), /AUDIT/,
      'tampered rejection audit must fail');
    assert.throws(() => assertG07AuthoritativeEvidence(cr04, { ...ok04, sources: { allMatched: false } }), /SOURCE/,
      'tampered business source must fail');
  });

  test('supplemental oracles are real assertions, not stored constants', () => {
    assert.doesNotThrow(() => assertSafeIntegerCents({ price_cents: 12345, qty: 6 }, 'money'));
    assert.throws(() => assertSafeIntegerCents({ price_cents: 1.5 }, 'money'), /UNSAFE_MONEY/);
    assert.doesNotThrow(() => assertProcessingPoItemStable({ beforeItemIds: ['a'], afterItemIds: ['a'] }));
    assert.throws(() => assertProcessingPoItemStable({ beforeItemIds: ['a'], afterItemIds: ['b'] }), /ITEM_ID_DRIFT/);
    assert.doesNotThrow(() => assertProcessingPoRejected({ responses: [{ status: 409 }, { status: 409 }] }));
    assert.throws(() => assertProcessingPoRejected({ responses: [{ status: 201 }] }), /REJECTION_MISSING/);
    assert.doesNotThrow(() => assertUat14VmiReceiptOracle({ createStatus: 201, confirmStatus: 200 }));
    assert.throws(() => assertUat14VmiReceiptOracle({ createStatus: 409, confirmStatus: 200 }), /UAT14_VMI_ORACLE_MISMATCH/);
    assert.doesNotThrow(() => assertG03EvidenceLayering({ l1FactCount: 9, l2FactCount: 4, l2Enumerated: ['a', 'b', 'c', 'd'] }));
    assert.throws(() => assertG03EvidenceLayering({ l1FactCount: 9, l2FactCount: 5, l2Enumerated: ['a', 'b', 'c', 'd'] }), /NOT_ENUMERATED/);
  });

  test('root lifecycle blocks before every write without ACK-4 and owns ordered one-time cleanup', async () => {
    const events = [];
    const expected = { commitSha, target, manifest: 'M1_CORE_G07_V1' };
    await assert.rejects(() => runM1CoreG07Lifecycle({
      consumeRoot: async () => { throw new Error('ACK4_MISSING'); }, expected, quarantineDir: 'unused',
      reset: async () => events.push('reset'), bootstrap: async () => events.push('bootstrap'),
      runHttpFixtures: async () => { events.push('run'); return { passed: true }; },
      stopChildren: async () => true, cleanup: async () => events.push('cleanup'),
      verifyCleanup: async () => ({ clean: true, inventory: [] }),
    }), /ACK4_MISSING/);
    assert.deepEqual(events, []);

    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-root-'));
    try {
      const report = await runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir), expected, quarantineDir: join(dir, 'quarantine'),
        reset: async () => events.push('reset'), bootstrap: async () => events.push('bootstrap'),
        runHttpFixtures: async (context) => {
          events.push('run');
          context.issueChild({ childPid: 201, childStartedAt: 'app-a' });
          context.issueChild({ childPid: 202, childStartedAt: 'app-b' });
          return { passed: true };
        },
        stopChildren: async () => { events.push('stop'); return true; },
        cleanup: async () => events.push('cleanup'),
        verifyCleanup: async () => ({ clean: true, inventory: [] }),
      });
      assert.deepEqual(events, ['reset', 'bootstrap', 'run', 'stop', 'cleanup']);
      assert.deepEqual(report, {
        runId: '123e4567-e89b-42d3-a456-426614174000', state: 'FINISHED', testsPassed: true,
        cleanupProven: true, childrenExited: true, cleanupAttempts: 1, childCount: 2,
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('root lifecycle never starts cleanup while a registered child exit is unverified', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-child-exit-'));
    let cleanupCalled = false;
    try {
      await assert.rejects(() => runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174099'),
        expected: { commitSha, target, manifest: 'M1_CORE_G07_V1' }, quarantineDir: join(dir, 'quarantine'),
        reset: async () => {}, bootstrap: async () => {},
        runHttpFixtures: async (context) => {
          context.issueChild({ childPid: 301, childStartedAt: 'lost-child' });
          throw new Error('SIMULATED_SUITE_FAILURE');
        },
        stopChildren: async () => false,
        cleanup: async () => { cleanupCalled = true; }, verifyCleanup: async () => ({ clean: true, inventory: [] }),
      }), (error) => error.message === 'SIMULATED_SUITE_FAILURE'
        && error.m1G07Lifecycle.state === 'CLEANUP_UNVERIFIED'
        && error.m1G07Lifecycle.cleanupAttempts === 0);
      assert.equal(cleanupCalled, false);
      assert.throws(() => assertNoAck4Quarantine(join(dir, 'quarantine'), target), /quarantined/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('root lifecycle quarantines when the independent postflight reports residual objects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-postflight-'));
    try {
      const report = await runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174088'),
        expected: { commitSha, target, manifest: 'M1_CORE_G07_V1' }, quarantineDir: join(dir, 'quarantine'),
        reset: async () => {}, bootstrap: async () => {},
        runHttpFixtures: async () => ({ passed: true }),
        stopChildren: async () => true,
        cleanup: async () => {},
        verifyCleanup: async () => ({ clean: false, inventory: ['tables=3'] }),
      });
      assert.equal(report.state, 'CLEANUP_UNVERIFIED');
      assert.equal(report.cleanupProven, false);
      assert.throws(() => assertNoAck4Quarantine(join(dir, 'quarantine'), target), /quarantined/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('root lifecycle reports FAILED only after child exit and independently proven cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-failed-terminal-'));
    const events = [];
    try {
      await assert.rejects(() => runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174077'),
        expected: { commitSha, target, manifest: 'M1_CORE_G07_V1' }, quarantineDir: join(dir, 'quarantine'),
        reset: async () => {}, bootstrap: async () => {},
        runHttpFixtures: async () => { throw new Error('SIMULATED_ORACLE_FAILURE'); },
        stopChildren: async () => { events.push('stop'); return true; },
        cleanup: async () => events.push('cleanup'), verifyCleanup: async () => { events.push('postflight'); return { clean: true, inventory: [] }; },
      }), (error) => error.message === 'SIMULATED_ORACLE_FAILURE'
        && error.m1G07Lifecycle.state === 'FAILED'
        && error.m1G07Lifecycle.testsPassed === false
        && error.m1G07Lifecycle.childrenExited === true
        && error.m1G07Lifecycle.cleanupProven === true);
      assert.deepEqual(events, ['stop', 'cleanup', 'postflight']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('diagnostic TAP failure survives Root FAILED with cleanupProven', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-diagnostic-failed-'));
    const diagnosticError = createChildFailureError({
      exitCode: 1, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES',
      stdout: "not ok 1 - CR-08 conservation\n  ---\n  failureType: 'testCodeFailure'\n  error: |-\n    expected non-negative LOT balance\n  code: 'ERR_ASSERTION'\n  stack: |-\n    at oracle (suite.js:88:4)\n  ...\n# fail 1\n",
      stderr: '',
    }, { evidenceRoot: dir, runId: '123e4567-e89b-42d3-a456-426614174066', restrictFile: () => {} });
    try {
      await assert.rejects(() => runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174066'),
        expected: { commitSha, target, manifest: 'M1_CORE_G07_V1' }, quarantineDir: join(dir, 'quarantine'),
        reset: async () => {}, bootstrap: async () => {}, runHttpFixtures: async () => { throw diagnosticError; },
        stopChildren: async () => true, cleanup: async () => {}, verifyCleanup: async () => ({ clean: true, inventory: [] }),
      }), (error) => error.message.includes('CR-08 conservation')
        && error.message.includes('expected non-negative LOT balance')
        && error.m1G07Lifecycle.state === 'FAILED'
        && error.m1G07Lifecycle.cleanupProven === true
        && error.m1G07Lifecycle.childrenExited === true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('diagnostic TAP failure survives Root CLEANUP_UNVERIFIED without becoming PASS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm1-g07-diagnostic-cleanup-'));
    const diagnosticError = createChildFailureError({
      exitCode: 1, mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES',
      stdout: "not ok 1 - SCHEMA-PARITY drift\n  ---\n  failureType: 'testCodeFailure'\n  error: |-\n    idempotency_key type mismatch\n  code: 'ERR_ASSERTION'\n  ...\n# fail 1\n",
      stderr: 'worker warning',
    }, { evidenceRoot: dir, runId: '123e4567-e89b-42d3-a456-426614174055', restrictFile: () => {} });
    try {
      await assert.rejects(() => runM1CoreG07Lifecycle({
        consumeRoot: async () => simulatedRoot(dir, '123e4567-e89b-42d3-a456-426614174055'),
        expected: { commitSha, target, manifest: 'M1_CORE_G07_V1' }, quarantineDir: join(dir, 'quarantine'),
        reset: async () => {}, bootstrap: async () => {}, runHttpFixtures: async () => { throw diagnosticError; },
        stopChildren: async () => true, cleanup: async () => {},
        verifyCleanup: async () => ({ clean: false, inventory: ['tables=1'] }),
      }), (error) => error.message.includes('SCHEMA-PARITY drift')
        && error.m1G07Lifecycle.state === 'CLEANUP_UNVERIFIED'
        && error.m1G07Lifecycle.testsPassed === false
        && error.m1G07Lifecycle.cleanupProven === false);
      assert.throws(() => assertNoAck4Quarantine(join(dir, 'quarantine'), target), /quarantined/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
