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
import { mysqlGeneratedPartialIndexColumnName } from './database/mysql-schema.js';
import { gateWaiterIds, M1_G07_GATE_WAITER_SQL, runG07GateRace } from './test-utils/m1-core-g07-lock-wait.js';
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

  test('information_schema reader queries generated columns, indexes, FK rules and enforced CHECK clauses', () => {
    const calls = [];
    const foreignKey = {
      constraint_name: 'fk_item', column_name: 'item_id', referenced_table_name: 'items',
      referenced_column_name: 'id', update_rule: 'CASCADE', delete_rule: 'RESTRICT', ordinal_position: 1,
    };
    const db = { prepare(sql) { calls.push(sql); return { all: () => (/REFERENTIAL_CONSTRAINTS/.test(sql) ? [foreignKey] : []) }; } };
    const contract = readMySqlInformationSchemaContract(db, 'tracked_inventory_movements');
    assert.equal(calls.length, 4);
    assert.ok(calls.some((sql) => /information_schema\.COLUMNS/.test(sql)));
    assert.ok(calls.some((sql) => /information_schema\.STATISTICS/.test(sql)));
    assert.ok(calls.some((sql) => /REFERENTIAL_CONSTRAINTS/.test(sql)));
    assert.ok(calls.some((sql) => /CHECK_CONSTRAINTS/.test(sql)));
    const columnSql = calls.find((sql) => /information_schema\.COLUMNS/.test(sql));
    assert.match(columnSql, /EXTRA extra/);
    assert.match(columnSql, /GENERATION_EXPRESSION generation_expression/);
    assert.match(calls.find((sql) => /CHECK_CONSTRAINTS/.test(sql)), /tc\.ENFORCED enforced/);
    const foreignKeySql = calls.find((sql) => /REFERENTIAL_CONSTRAINTS/.test(sql));
    for (const column of ['CONSTRAINT_NAME', 'COLUMN_NAME', 'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME', 'ORDINAL_POSITION']) {
      assert.match(foreignKeySql, new RegExp(`k\\.${column}\\b`), `${column} must come from KEY_COLUMN_USAGE k`);
    }
    for (const column of ['UPDATE_RULE', 'DELETE_RULE']) {
      assert.match(foreignKeySql, new RegExp(`r\\.${column}\\b`), `${column} must come from REFERENTIAL_CONSTRAINTS r`);
    }
    assert.deepEqual(contract.foreignKeys, [foreignKey], 'the existing foreign-key comparison shape must be preserved');
  });

  test('G07 lock observation binds the requesting InnoDB waiter to the current schema, gate table and PRIMARY index', () => {
    const rows = [
      { thread_id: 11, lock_thread_id: 11, engine: 'INNODB', lock_status: 'WAITING', object_schema: 'target_db', selected_database: 'target_db', object_name: 'mysql_transaction_gates', index_name: 'PRIMARY' },
      { thread_id: 12, lock_thread_id: 12, engine: 'INNODB', lock_status: 'WAITING', object_schema: 'other_db', selected_database: 'target_db', object_name: 'mysql_transaction_gates', index_name: 'PRIMARY' },
      { thread_id: 13, lock_thread_id: 13, engine: 'INNODB', lock_status: 'WAITING', object_schema: 'target_db', selected_database: 'target_db', object_name: 'other_table', index_name: 'PRIMARY' },
      { thread_id: 14, lock_thread_id: 14, engine: 'INNODB', lock_status: 'WAITING', object_schema: 'target_db', selected_database: 'target_db', object_name: 'mysql_transaction_gates', index_name: 'other_index' },
      { thread_id: 15, lock_thread_id: 15, engine: 'INNODB', lock_status: 'GRANTED', object_schema: 'target_db', selected_database: 'target_db', object_name: 'mysql_transaction_gates', index_name: 'PRIMARY' },
      { thread_id: 16, lock_thread_id: 99, engine: 'INNODB', lock_status: 'WAITING', object_schema: 'target_db', selected_database: 'target_db', object_name: 'mysql_transaction_gates', index_name: 'PRIMARY' },
    ];
    const db = { prepare(sql) { assert.equal(sql, M1_G07_GATE_WAITER_SQL); return { all: () => rows }; } };
    assert.deepEqual([...gateWaiterIds(db)], ['11']);
    assert.doesNotMatch(M1_G07_GATE_WAITER_SQL, /rl\.TABLE_NAME/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.OBJECT_SCHEMA=DATABASE\(\)/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.OBJECT_NAME='mysql_transaction_gates'/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.INDEX_NAME='PRIMARY'/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.ENGINE=w\.ENGINE/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.ENGINE_LOCK_ID=w\.REQUESTING_ENGINE_LOCK_ID/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.ENGINE_TRANSACTION_ID=w\.REQUESTING_ENGINE_TRANSACTION_ID/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.THREAD_ID=w\.REQUESTING_THREAD_ID/);
    assert.match(M1_G07_GATE_WAITER_SQL, /rl\.LOCK_STATUS='WAITING'/);
  });

  test('G07 gate race proves two distinct waiters and commits only after both are observed', async () => {
    const events = [];
    const db = {
      exec(sql) { events.push(sql); },
      prepare(sql) {
        if (sql === M1_G07_GATE_WAITER_SQL) return { all: () => [] };
        assert.match(sql, /FOR UPDATE/); return { get: () => events.push('GATE_HELD') };
      },
    };
    const observed = [];
    const result = await runG07GateRace({
      db, label: 'CR-TEST',
      requestA: async () => { events.push('REQUEST_A'); return { status: 201 }; },
      requestB: async () => { events.push('REQUEST_B'); return { status: 409 }; },
      observeWaiter: async (_db, excluded, label) => {
        await Promise.resolve();
        observed.push({ label, excluded: [...excluded] });
        events.push(`OBSERVED_${label}`);
        return label.endsWith('_A') ? 'thread-a' : 'thread-b';
      },
    });
    assert.deepEqual(result.responses, [{ status: 201 }, { status: 409 }]);
    assert.deepEqual(observed, [
      { label: 'CR-TEST_A', excluded: [] },
      { label: 'CR-TEST_B', excluded: ['thread-a'] },
    ]);
    assert.ok(events.indexOf('COMMIT') > events.indexOf('OBSERVED_CR-TEST_B'));
    assert.ok(events.indexOf('REQUEST_A') < events.indexOf('OBSERVED_CR-TEST_A'));
    assert.ok(events.indexOf('REQUEST_B') < events.indexOf('OBSERVED_CR-TEST_B'));
    assert.ok(!events.includes('ROLLBACK'));
  });

  test('G07 gate race rolls back and drains pending requests when lock observation fails', async () => {
    const original = new Error('LOCK_OBSERVATION_FAILED');
    const events = [];
    const db = {
      exec(sql) { events.push(sql); },
      prepare(sql) {
        if (sql === M1_G07_GATE_WAITER_SQL) return { all: () => [] };
        return { get: () => events.push('GATE_HELD') };
      },
    };
    await assert.rejects(() => runG07GateRace({
      db, label: 'CR-FAIL',
      requestA: (signal) => new Promise((resolve) => {
        events.push('REQUEST_A');
        signal.addEventListener('abort', () => { events.push('ABORT_A'); resolve({ status: 499 }); }, { once: true });
      }),
      requestB: async () => { throw new Error('MUST_NOT_START'); },
      observeWaiter: async () => { await Promise.resolve(); throw original; },
    }), (error) => error === original);
    assert.deepEqual(events, ['START TRANSACTION', 'GATE_HELD', 'REQUEST_A', 'ABORT_A', 'ROLLBACK']);
    assert.deepEqual(original.m1G07RequestSettlement, {
      status: 'REQUEST_PROMISES_SETTLED', pendingLabels: [], timeoutMs: 5000,
      abortRequested: true, businessEffectsProven: false, cleanupProven: false,
    });
  });

  test('G07 rollback failure plus permanently pending HTTP ends bounded and reports settlement unverified', async () => {
    const original = new Error('WAITER_TIMEOUT');
    const releaseFailure = new Error('ROLLBACK_FAILED');
    releaseFailure.code = 'ROLLBACK_FAILED';
    let aborted = false;
    const db = {
      exec(sql) { if (sql === 'ROLLBACK') throw releaseFailure; },
      prepare(sql) { return sql === M1_G07_GATE_WAITER_SQL ? { all: () => [] } : { get: () => ({ gate_id: 1 }) }; },
    };
    const startedAt = Date.now();
    await assert.rejects(() => runG07GateRace({
      db, label: 'CR-FAIL', settlementTimeoutMs: 25,
      requestA: (signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); }),
      requestB: async () => ({ status: 0 }),
      observeWaiter: async () => { throw original; },
    }), (error) => error === original
      && error.m1G07GateReleaseError === releaseFailure
      && error.message.includes('M1_G07_HTTP_SETTLEMENT_UNVERIFIED')
      && error.message.includes('M1_G07_GATE_RELEASE_FAILED code=ROLLBACK_FAILED')
      && error.m1G07RequestSettlement.status === 'UNVERIFIED'
      && error.m1G07RequestSettlement.cleanupProven === false);
    assert.equal(aborted, true, 'the permanent request must receive an abort request');
    assert.ok(Date.now() - startedAt < 500, 'the failure path must not wait forever');
  });

  test('G07 HTTP request timeout aborts the request, preserves its diagnostic and cannot become PASS', async () => {
    const events = [];
    const db = {
      exec(sql) { events.push(sql); },
      prepare(sql) {
        if (sql === M1_G07_GATE_WAITER_SQL) return { all: () => [] };
        return { get: () => events.push('GATE_HELD') };
      },
    };
    await assert.rejects(() => runG07GateRace({
      db, label: 'CR-TIMEOUT', requestTimeoutMs: 15, settlementTimeoutMs: 50,
      requestA: (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      requestB: async () => ({ status: 0 }),
    }), (error) => error.code === 'M1_G07_HTTP_REQUEST_TIMEOUT'
      && error.message.includes('CR-TIMEOUT_A_HTTP_REQUEST_TIMEOUT:15')
      && error.m1G07RequestSettlement.status === 'REQUEST_PROMISES_SETTLED'
      && error.m1G07RequestSettlement.businessEffectsProven === false
      && error.m1G07RequestSettlement.cleanupProven === false);
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
  });

  test('G07 request that ignores timeout abort and later returns 201 is permanently rejected', async () => {
    const events = [];
    let abortObserved = false;
    let lateSuccessObserved = false;
    const db = {
      exec(sql) { events.push(sql); },
      prepare(sql) {
        if (sql === M1_G07_GATE_WAITER_SQL) return { all: () => [] };
        return { get: () => events.push('GATE_HELD') };
      },
    };
    await assert.rejects(() => runG07GateRace({
      db, label: 'CR-LATE-SUCCESS', requestTimeoutMs: 10, settlementTimeoutMs: 100,
      requestA: (signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { abortObserved = true; }, { once: true });
        setTimeout(() => { lateSuccessObserved = true; resolve({ status: 201 }); }, 30);
      }),
      requestB: async () => ({ status: 409 }),
      observeWaiter: async (_db, _excluded, waiterLabel) => waiterLabel.endsWith('_A') ? 'thread-a' : 'thread-b',
    }), (error) => error.code === 'M1_G07_HTTP_REQUEST_TIMEOUT'
      && error.message.includes('CR-LATE-SUCCESS_A_HTTP_REQUEST_TIMEOUT:10')
      && error.m1G07RequestSettlement.status === 'REQUEST_PROMISES_SETTLED'
      && error.m1G07RequestSettlement.cleanupProven === false);
    assert.equal(abortObserved, true, 'the timed-out request must receive abort');
    assert.equal(lateSuccessObserved, true, 'the negative control must really produce a late 201');
    assert.ok(events.includes('COMMIT'), 'both waiters were observed before the request timed out');
    assert.ok(!events.includes('ROLLBACK'), 'the already committed test gate is not reported as rolled back');
  });

  test('G07 HTTP rejection preserves the original error and releases the gate', async () => {
    const original = new Error('SYNTHETIC_HTTP_REJECTION');
    original.code = 'SYNTHETIC_HTTP_REJECTION';
    const events = [];
    const db = {
      exec(sql) { events.push(sql); },
      prepare(sql) { return sql === M1_G07_GATE_WAITER_SQL ? { all: () => [] } : { get: () => events.push('GATE_HELD') }; },
    };
    await assert.rejects(() => runG07GateRace({
      db, label: 'CR-REJECT', requestA: async () => { throw original; }, requestB: async () => ({ status: 0 }),
    }), (error) => error === original && error.m1G07RequestSettlement.cleanupProven === false);
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
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
      ], indexes: [], foreignKeys: [], checks: [{ check_clause: 'amount >= 0', enforced: 'YES' }],
    };
    assert.deepEqual(compareTableParity(sqlite, mysql), ['NULLABLE:amount', 'DEFAULT:amount']);
  });

  test('parity accepts only verified MySQL metadata representations for defaults, inline UNIQUE and CHECK strings', () => {
    const sqlite = {
      name: 'sample',
      sql: "CREATE TABLE sample(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED')))",
      columns: [
        { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { name: 'code', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { name: 'amount', type: 'REAL', notnull: 1, dflt_value: '0', pk: 0 },
        { name: 'status', type: 'TEXT', notnull: 1, dflt_value: "'DRAFT'", pk: 0 },
      ],
      indexes: [{ name: 'sqlite_autoindex_sample_2', unique: true, origin: 'u', columns: ['code'], expressions: [], where: '' }],
      foreignKeys: [],
    };
    const mysql = {
      columns: [
        { column_name: 'id', data_type: 'varchar', is_nullable: 'NO', column_default: null },
        { column_name: 'code', data_type: 'varchar', is_nullable: 'NO', column_default: null },
        { column_name: 'amount', data_type: 'decimal', is_nullable: 'NO', column_default: '0.000000' },
        { column_name: 'status', data_type: 'longtext', is_nullable: 'NO', column_default: 'DRAFT' },
      ],
      indexes: [{ index_name: 'code', column_name: 'code', seq_in_index: 1, non_unique: 0 }],
      foreignKeys: [],
      checks: [{ check_clause: "(`status` in (_utf8mb4'DRAFT',_utf8mb4'POSTED'))", enforced: 'YES' }],
    };
    assert.deepEqual(compareTableParity(sqlite, mysql), []);
  });

  test('parity still fails on a real missing column, missing UNIQUE, missing CHECK and wrong default', () => {
    const sqlite = {
      name: 'negative_sample',
      sql: "CREATE TABLE negative_sample(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED')))",
      columns: [
        { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { name: 'code', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { name: 'status', type: 'TEXT', notnull: 1, dflt_value: "'DRAFT'", pk: 0 },
      ],
      indexes: [{ name: 'sqlite_autoindex_negative_sample_2', unique: true, origin: 'u', columns: ['code'], expressions: [], where: '' }],
      foreignKeys: [],
    };
    const valid = {
      columns: [
        { column_name: 'id', data_type: 'varchar', is_nullable: 'NO', column_default: null },
        { column_name: 'code', data_type: 'varchar', is_nullable: 'NO', column_default: null },
        { column_name: 'status', data_type: 'longtext', is_nullable: 'NO', column_default: 'DRAFT' },
      ],
      indexes: [{ index_name: 'code', column_name: 'code', seq_in_index: 1, non_unique: 0 }],
      foreignKeys: [],
      checks: [{ check_clause: "status in (_utf8mb4'DRAFT',_utf8mb4'POSTED')", enforced: 'YES' }],
    };
    assert.ok(compareTableParity(sqlite, { ...valid, columns: valid.columns.filter((column) => column.column_name !== 'code') }).includes('COLUMN_SEQUENCE'));
    assert.ok(compareTableParity(sqlite, { ...valid, indexes: [] }).includes('UNIQUE_MISSING:code'));
    assert.ok(compareTableParity(sqlite, { ...valid, checks: [] }).includes('CHECKS'));
    assert.ok(compareTableParity(sqlite, {
      ...valid,
      checks: [{ check_clause: "status in (_utf8mb4'draft',_utf8mb4'POSTED')", enforced: 'YES' }],
    }).includes('CHECKS'), 'business string literal case changes must not normalize away');
    assert.ok(compareTableParity(sqlite, {
      ...valid,
      checks: valid.checks.map((check) => ({ ...check, enforced: 'NO' })),
    }).includes('CHECK_NOT_ENFORCED'));
    const wrongDefault = valid.columns.map((column) => column.column_name === 'status' ? { ...column, column_default: 'POSTED' } : column);
    assert.ok(compareTableParity(sqlite, { ...valid, columns: wrongDefault }).includes('DEFAULT:status'));
  });

  test('parity validates the approved digest generated column kind, expression and exact UNIQUE index reference', () => {
    const indexName = 'uq_digest_sample_active';
    const generated = mysqlGeneratedPartialIndexColumnName(indexName);
    const sqlite = {
      name: 'digest_sample', sql: 'CREATE TABLE digest_sample(id TEXT PRIMARY KEY, state TEXT NOT NULL)',
      columns: [
        { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { name: 'state', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      ],
      indexes: [{
        name: indexName, unique: true, origin: 'c', columns: ['id', 'state'],
        expressions: ['id', 'state'], where: "state='ACTIVE'",
      }],
      foreignKeys: [],
    };
    const valid = {
      columns: [
        { column_name: 'id', data_type: 'varchar', is_nullable: 'NO', column_default: null, extra: '', generation_expression: '' },
        { column_name: 'state', data_type: 'varchar', is_nullable: 'NO', column_default: null, extra: '', generation_expression: '' },
        {
          column_name: generated, data_type: 'char', is_nullable: 'YES', column_default: null,
          extra: 'STORED GENERATED',
          generation_expression: "CASE WHEN (`state` = 'ACTIVE') THEN SHA2(CONCAT_WS(CHAR(31),COALESCE(CAST(`id` AS CHAR CHARSET utf8mb4),CHAR(30)),COALESCE(CAST(`state` AS CHAR CHARSET utf8mb4),CHAR(30))),256) ELSE NULL END",
        },
      ],
      indexes: [{ index_name: indexName, column_name: generated, seq_in_index: 1, non_unique: 0 }],
      foreignKeys: [], checks: [],
    };
    assert.deepEqual(compareTableParity(sqlite, valid), []);
    const ordinary = valid.columns.map((column) => column.column_name === generated ? { ...column, extra: '' } : column);
    assert.ok(compareTableParity(sqlite, { ...valid, columns: ordinary }).includes(`GENERATED_COLUMN_KIND:${generated}`));
    const wrongExpression = valid.columns.map((column) => column.column_name === generated
      ? { ...column, generation_expression: column.generation_expression.replace("'ACTIVE'", "'INACTIVE'") } : column);
    assert.ok(compareTableParity(sqlite, { ...valid, columns: wrongExpression }).includes(`GENERATED_COLUMN_EXPRESSION:${generated}`));
    assert.ok(compareTableParity(sqlite, {
      ...valid,
      indexes: [{ index_name: indexName, column_name: 'state', seq_in_index: 1, non_unique: 0 }],
    }).includes(`INDEX_COLUMNS:${indexName}`));
    assert.ok(compareTableParity(sqlite, { ...valid, indexes: [] }).includes(`UNIQUE_MISSING:${indexName}`));
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

  test('CR-02 approved IQC repair is the unique fixed fixture and pins the Owner-approved digest', () => {
    const active = M1_CORE_G07_FIXED_SCENARIOS.find((scenario) => scenario.id === 'CR-02');
    assert.deepEqual(active.setup.map((step) => step.id).slice(-4), ['noticeGet', 'convert', 'iqc', 'iqcComplete']);
    assert.deepEqual(active.setup.at(-2), {
      id: 'iqc', subject: 'warehouse', method: 'POST', route: '/api/iqc', headers: {},
      body: { purchase_receipt_id: { $ref: 'setup.convert.receipts.0.id' } },
    });
    assert.equal(active.setup.at(-1).subject, 'warehouse');
    assert.equal(active.setup.at(-1).route, '/api/iqc/{setup.iqc.id}/complete');
    assert.deepEqual(active.setup.at(-1).body, { result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0 });
    assert.equal(M1_CORE_G07_FIXED_FIXTURE_DIGEST, '9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091');
    assert.equal(computeM1CoreG07FixtureDigest(), M1_CORE_G07_FIXED_FIXTURE_DIGEST);
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
