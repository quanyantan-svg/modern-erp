import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  assertCompleteG07Contract, assertG07RaceOutcome, G07_SUPPLEMENTAL_ORACLES, M1_CORE_G07_SCENARIOS,
} from './test-support/m1-core-g07-contract.js';
import { compareTableParity, readMySqlInformationSchemaContract } from './test-utils/m1-core-schema-parity.js';
import { buildM1CoreG07HttpFixtures } from './test-support/m1-core-g07-http-fixture-builder.js';
import { runM1CoreG07Lifecycle } from '../scripts/gates/m1-core-g07-root-lifecycle.mjs';
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
    assert.match(runner, /buildM1CoreG07HttpFixtures/);
    assert.match(child, /readWave10ConnectedIdentity/);
    assert.ok(child.indexOf("await consume(operation)") < child.indexOf('await openVerifiedAdapter()'),
      'child must consume its lease before opening any target connection');
    assert.match(launcher, /FixturePlan/);
    assert.match(launcher, /--fixture-plan/);
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

  test('production HTTP fixture builder covers CR-01..CR-09 and refuses SQL or incomplete provenance', async () => {
    const plans = M1_CORE_G07_SCENARIOS.map((definition) => ({
      id: definition.id,
      setup: [{ id: 'base', application: 'A', method: 'POST', path: '/api/products', body: { code: definition.id } }],
      requests: ['A', 'B'].map((application) => ({
        application, method: definition.method,
        path: definition.path.replace(/\{[^}]+\}/g, 'fixture').replaceAll(':id', 'fixture'),
        body: { idempotencyKey: `${definition.id}-${application}` }, token: `${application}-token`,
      })),
      businessObjects: [{ kind: `${definition.id}-positive-object`, source: 'SETUP_HTTP', stepId: 'base' }],
      expectedSnapshot: Object.fromEntries(definition.snapshotTables.map((table) => [table, []])),
    }));
    const calls = [];
    const manifest = await buildM1CoreG07HttpFixtures({
      applications: { A: 'http://127.0.0.1:3101', B: 'http://127.0.0.1:3102' }, plans,
      request: async (baseUrl, step) => { calls.push({ baseUrl, step }); return { status: 201, data: { id: step.body.code } }; },
    });
    assert.equal(manifest.executionStatus, 'NOT_RUN');
    assert.equal(calls.length, 9);
    assert.equal(Object.keys(manifest.scenarios).length, 9);
    for (const fixture of Object.values(manifest.scenarios)) {
      assert.ok(fixture.businessObjectProvenance.every((item) => item.channel === 'PRODUCTION_HTTP'));
    }
    const unsafe = structuredClone(plans); unsafe[0].setup[0].sql = 'INSERT INTO forbidden VALUES(1)';
    await assert.rejects(() => buildM1CoreG07HttpFixtures({ applications: { A: 'a', B: 'b' }, plans: unsafe, request: async () => ({ status: 201, data: {} }) }), /SQL_FORBIDDEN/);
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
});
