import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { consumePortableChildLease, issuePortableChildLease } from '../scripts/gates/ack4/ack4-runtime.mjs';
import {
  MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
  assertAuthorizedDisposableMySqlTarget,
  assertDisposableMySqlSchemaEmpty,
  deferMySqlCleanup,
  mysqlCleanupDeferralState,
  mysqlDisposableTargetIdentity,
  resetAuthorizedDisposableMySqlSchema,
} from './test-utils/mysql-disposable-target.js';

const config = Object.freeze({
  host: '127.0.0.1', port: 3306, database: 'modern_erp_gate_a_disposable', user: 'gate_a',
});
const identity = 'mysql://gate_a@127.0.0.1:3306/modern_erp_gate_a_disposable';
const authorized = Object.freeze({
  ERP_MYSQL_TEST_ALLOW_RESET: 'true',
  ERP_MYSQL_TEST_DISPOSABLE_TARGET: identity,
  ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
});

let leaseDir;
before(() => {
  const target = {
    ...config, selectedDatabase: config.database, currentUser: 'gate_a@localhost',
    serverUuid: '00000000-0000-0000-0000-000000000001', grantsSha256: 'a'.repeat(64),
  };
  const root = {
    state: 'CONSUMED', runId: '123e4567-e89b-42d3-a456-426614174000', rootPid: process.ppid,
    rootStartedAt: 'root-start', commitSha: 'b'.repeat(40), target, manifest: 'TEST_RESET_V1',
    operations: ['CLEANUP_SCHEMA_POST_RUN'], nonce: 'unit-test-root-nonce',
  };
  const keys = generateKeyPairSync('ed25519');
  root.childLeasePrivateKey = keys.privateKey;
  root.childLeasePublicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const childStartedAt = 'child-start';
  const child = issuePortableChildLease(root, { childPid: process.pid, childStartedAt, operation: 'CLEANUP_SCHEMA_POST_RUN' });
  leaseDir = mkdtempSync(join(tmpdir(), 'modern-erp-reset-lease-'));
  const leasePath = join(leaseDir, 'lease.json'); writeFileSync(leasePath, JSON.stringify(child));
  consumePortableChildLease({
    leasePath, consumedDir: join(leaseDir, 'consumed'), rootPublicKey: root.childLeasePublicKey,
    expected: { rootPid: process.ppid, childPid: process.pid, childStartedAt, commitSha: root.commitSha, target, manifest: root.manifest, operation: 'CLEANUP_SCHEMA_POST_RUN' },
  });
});
after(() => rmSync(leaseDir, { recursive: true, force: true }));

test('Gate A MySQL guard derives a password-free exact target identity', () => {
  assert.equal(mysqlDisposableTargetIdentity(config), identity);
  assert.doesNotMatch(mysqlDisposableTargetIdentity(config), /password|secret/i);
});

test('Gate A MySQL guard requires reset, exact identity and exact destructive-operation approval', () => {
  assert.deepEqual(assertAuthorizedDisposableMySqlTarget(config, authorized), {
    identity, operations: MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
  });
  for (const env of [
    { ...authorized, ERP_MYSQL_TEST_ALLOW_RESET: 'false' },
    { ...authorized, ERP_MYSQL_TEST_DISPOSABLE_TARGET: '' },
    { ...authorized, ERP_MYSQL_TEST_DISPOSABLE_TARGET: identity + '-other' },
    { ...authorized, ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: 'DROP_ALL_TABLES' },
  ]) assert.throws(() => assertAuthorizedDisposableMySqlTarget(config, env), /REFUSED/);
});

test('Gate A MySQL guard keeps the disposable-name hint as defence in depth, never sole proof', () => {
  const production = { ...config, database: 'modern_erp' };
  const productionIdentity = mysqlDisposableTargetIdentity(production);
  assert.throws(() => assertAuthorizedDisposableMySqlTarget(production, {
    ...authorized, ERP_MYSQL_TEST_DISPOSABLE_TARGET: productionIdentity,
  }), /disposable hint/);
  assert.throws(() => assertAuthorizedDisposableMySqlTarget(config, {
    ERP_MYSQL_TEST_ALLOW_RESET: 'true',
  }), /must exactly equal/);
});

test('Gate A selected local target has the exact approved password-free identity format', () => {
  const selected = {
    host: '127.0.0.1', port: 3306, database: 'modern_erp_domain_test', user: 'modern_erp_test',
  };
  const selectedIdentity = 'mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test';
  assert.equal(mysqlDisposableTargetIdentity(selected), selectedIdentity);
  assert.deepEqual(assertAuthorizedDisposableMySqlTarget(selected, {
    ERP_MYSQL_TEST_ALLOW_RESET: 'true',
    ERP_MYSQL_TEST_DISPOSABLE_TARGET: selectedIdentity,
    ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
  }), { identity: selectedIdentity, operations: MYSQL_DESTRUCTIVE_OPERATIONS_ACK });
});

test('Gate A schema reset rechecks actual identity and drops views before base tables', () => {
  const executed = [];
  const db = {
    prepare(sql) {
      if (sql === 'SELECT DATABASE() database_name') return { get: () => ({ database_name: config.database }) };
      if (sql === 'SHOW FULL TABLES') return { all: () => [
        { Tables_in_test: 'orders', Table_type: 'BASE TABLE' },
        { Tables_in_test: 'finance_open_item_effects', Table_type: 'VIEW' },
      ] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    exec(sql) { executed.push(sql); },
  };
  const result = resetAuthorizedDisposableMySqlSchema(db, config, authorized);
  assert.equal(result.dropped, 2);
  assert.deepEqual(executed, [
    'SET FOREIGN_KEY_CHECKS=0',
    'DROP VIEW IF EXISTS `finance_open_item_effects`',
    'DROP TABLE IF EXISTS `orders`',
    'SET FOREIGN_KEY_CHECKS=1',
  ]);
});

test('Gate A schema reset refuses a connected database mismatch before destructive SQL', () => {
  let executed = false;
  const db = {
    prepare(sql) {
      assert.equal(sql, 'SELECT DATABASE() database_name');
      return { get: () => ({ database_name: 'another_database' }) };
    },
    exec() { executed = true; },
  };
  assert.throws(() => resetAuthorizedDisposableMySqlSchema(db, config, authorized), /SELECT DATABASE/);
  assert.equal(executed, false);
});

function emptyOnlyDb({ tables = [], triggers = 0, routines = 0, events = 0, database = config.database } = {}) {
  const executed = [];
  return {
    executed,
    prepare(sql) {
      if (sql === 'SELECT DATABASE() database_name') return { get: () => ({ database_name: database }) };
      if (sql === 'SHOW FULL TABLES') return { all: () => tables };
      if (sql.includes('information_schema.TRIGGERS')) return { get: () => ({ count: triggers }) };
      if (sql.includes('information_schema.ROUTINES')) return { get: () => ({ count: routines }) };
      if (sql.includes('information_schema.EVENTS')) return { get: () => ({ count: events }) };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    exec(sql) { executed.push(sql); },
  };
}

test('OUT-001 EMPTY_ONLY recheck accepts only a fully empty five-class inventory', () => {
  const db = emptyOnlyDb();
  assert.deepEqual(assertDisposableMySqlSchemaEmpty(db, config), {
    tables: 0, views: 0, triggers: 0, routines: 0, events: 0,
  });
  const result = resetAuthorizedDisposableMySqlSchema(db, config, authorized, { requireEmpty: true });
  assert.equal(result.dropped, 0);
  assert.deepEqual(db.executed, []);
});

test('OUT-001 EMPTY_ONLY recheck rejects every object class before destructive SQL', () => {
  const cases = [
    { tables: [{ Tables_in_test: 't', Table_type: 'BASE TABLE' }] },
    { tables: [{ Tables_in_test: 'v', Table_type: 'VIEW' }] },
    { triggers: 1 }, { routines: 1 }, { events: 1 },
  ];
  for (const inventory of cases) {
    const db = emptyOnlyDb(inventory);
    assert.throws(
      () => resetAuthorizedDisposableMySqlSchema(db, config, authorized, { requireEmpty: true }),
      /EMPTY_ONLY recheck failed/,
    );
    assert.deepEqual(db.executed, []);
  }
});

test('OUT-001 EMPTY_ONLY identity mismatch refuses before inventory or destructive SQL', () => {
  const db = emptyOnlyDb({ database: 'wrong_database' });
  assert.throws(
    () => resetAuthorizedDisposableMySqlSchema(db, config, authorized, { requireEmpty: true }),
    /SELECT DATABASE/,
  );
  assert.deepEqual(db.executed, []);
});

test('protected fixture can defer schema cleanup to the Root without touching the database', () => {
  const deferral = deferMySqlCleanup('unit test: root owns cleanup');
  const db = {
    prepare() { throw new Error('deferred cleanup must not query the database'); },
    exec() { throw new Error('deferred cleanup must not execute SQL'); },
  };
  const result = resetAuthorizedDisposableMySqlSchema(db, config, authorized);
  assert.equal(result.deferred, true);
  assert.equal(result.dropped, 0);
  assert.equal(result.deferral, deferral);
  assert.equal(mysqlCleanupDeferralState(), deferral);
});
