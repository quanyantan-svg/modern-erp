import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  assertCompleteG07Contract, assertG07RaceOutcome, G07_SUPPLEMENTAL_ORACLES, M1_CORE_G07_SCENARIOS,
} from './test-support/m1-core-g07-contract.js';
import { compareTableParity, readMySqlInformationSchemaContract } from './test-utils/m1-core-schema-parity.js';

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
    const suite = readFileSync(new URL('./mysql-m1-core-g07.integration.js', import.meta.url), 'utf8');
    for (const source of [runner, suite]) {
      assert.doesNotMatch(source, /race_probe_generic/);
      assert.doesNotMatch(source, /mysql-procurement-outsourcing-concurrency\.integration/);
    }
    assert.match(runner, /mysql-m1-core-g07\.integration\.js/);
    assert.match(suite, /M1_CORE_G07_SCENARIOS/);
    assert.ok(runner.indexOf('M1 G07 BLOCKED_BEFORE_CONSUMPTION') < runner.indexOf('consumeAck4Record({'),
      'sealed readiness runner must refuse before atomically consuming a one-time approval');
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
});
