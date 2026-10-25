import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
  assertAuthorizedDisposableMySqlTarget,
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

