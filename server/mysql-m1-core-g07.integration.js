// M1C-G07 real-MySQL executor. This file is intentionally outside FAST/FULL.
// It may run only as an ACK-4 child after the dedicated root runner has reset
// and bootstrapped the exact disposable target and created the fixture
// manifest exclusively through production HTTP.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase } from './db.js';
import { createDatabase as createSqliteDatabase } from './db.js';
import { captureSqliteSnapshot } from './database/mysql-schema.js';
import { assertCompleteG07Contract, assertG07RaceOutcome, M1_CORE_G07_SCENARIOS } from './test-support/m1-core-g07-contract.js';
import { assertM1CoreInformationSchemaParity } from './test-utils/m1-core-schema-parity.js';
import { consumePortableChildLease } from '../scripts/gates/ack4/ack4-runtime.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`M1_G07_BLOCKED:${name}_REQUIRED`);
  return value;
}

function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function validateFixtureManifest(manifest) {
  if (manifest?.version !== 1 || manifest?.provenance !== 'PRODUCTION_HTTP') throw new Error('M1_G07_FIXTURE_PROVENANCE_INVALID');
  if (!Array.isArray(manifest.setupTrace) || manifest.setupTrace.some((entry) => !entry.path?.startsWith('/api/') || entry.status < 200 || entry.status >= 300)) {
    throw new Error('M1_G07_FIXTURE_SETUP_TRACE_INVALID');
  }
  for (const definition of M1_CORE_G07_SCENARIOS) {
    const fixture = manifest.scenarios?.[definition.id];
    if (!fixture || !Array.isArray(fixture.requests) || fixture.requests.length !== 2) throw new Error(`${definition.id}_FIXTURE_MISSING`);
    if (!fixture.requests.every((request) => request.path?.startsWith('/api/') && ['A', 'B'].includes(request.application))) throw new Error(`${definition.id}_REQUEST_INVALID`);
    if (!fixture.expectedSnapshot || Object.keys(fixture.expectedSnapshot).sort().join(',') !== [...definition.snapshotTables].sort().join(',')) {
      throw new Error(`${definition.id}_EXPECTED_SNAPSHOT_INCOMPLETE`);
    }
  }
  return manifest;
}

async function httpRequest(baseUrl, request) {
  const response = await fetch(baseUrl + request.path, {
    method: request.method,
    headers: { authorization: `Bearer ${request.token}`, 'content-type': 'application/json', ...request.headers },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

function primaryKeyColumns(db, tableName) {
  return db.prepare(`SELECT COLUMN_NAME column_name FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`).all(tableName)
    .map((row) => row.column_name);
}

function quoteIdentifier(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`M1_G07_UNSAFE_IDENTIFIER:${value}`);
  return `\`${value}\``;
}

function fullSnapshot(db, tables) {
  return Object.fromEntries(tables.map((tableName) => {
    const order = primaryKeyColumns(db, tableName);
    if (!order.length) throw new Error(`M1_G07_SNAPSHOT_PRIMARY_KEY_REQUIRED:${tableName}`);
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY ${order.map(quoteIdentifier).join(',')}`).all();
    return [tableName, canonical(rows)];
  }));
}

async function waitForBothTransactions(db, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = db.prepare(`SELECT ID id,STATE state,INFO info FROM information_schema.PROCESSLIST
      WHERE DB=DATABASE() AND ID<>CONNECTION_ID() AND INFO LIKE '%mysql_transaction_gates%'`).all();
    if (new Set(rows.map((row) => row.id)).size >= 2) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('M1_G07_BOTH_HTTP_TRANSACTIONS_NOT_OBSERVED_AT_GATE');
}

async function executeRace(db, manifest, definition) {
  const fixture = manifest.scenarios[definition.id];
  db.exec('START TRANSACTION');
  db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
  const pending = fixture.requests.map((request) => httpRequest(
    request.application === 'A' ? manifest.applications.A : manifest.applications.B,
    request,
  ));
  try {
    await waitForBothTransactions(db);
  } finally {
    db.exec('COMMIT');
  }
  const responses = await Promise.all(pending);
  assertG07RaceOutcome(definition, responses);
  assert.deepEqual(fullSnapshot(db, definition.snapshotTables), canonical(fixture.expectedSnapshot), `${definition.id} full field snapshot`);
}

describe('M1C-G07 — production HTTP / real MySQL handler concurrency', () => {
  let db; let manifest;
  before(() => {
    const target = JSON.parse(readFileSync(requiredEnvironment('ERP_M1_G07_TARGET_PROOF'), 'utf8'));
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    consumePortableChildLease({
      leasePath: requiredEnvironment('ERP_M1_G07_ACK4_CHILD_LEASE'),
      consumedDir: resolve(requiredEnvironment('ERP_M1_G07_ACK4_CHILD_CONSUMED_DIR')),
      rootNonce: requiredEnvironment('ERP_M1_G07_ACK4_ROOT_NONCE'),
      expected: {
        rootPid: process.ppid, childPid: process.pid,
        childStartedAt: requiredEnvironment('ERP_M1_G07_CHILD_STARTED_AT'),
        commitSha, target, manifest: 'M1_CORE_G07_V1', operation: 'RUN_M1_HTTP_FIXTURES',
      },
    });
    delete process.env.ERP_M1_G07_ACK4_ROOT_NONCE;
    if (process.env.ERP_DB_BACKEND !== 'mysql' || process.env.ERP_TEST_DB_BACKEND !== 'mysql') throw new Error('M1_G07_BLOCKED:MYSQL_BACKEND_REQUIRED');
    assertCompleteG07Contract();
    manifest = validateFixtureManifest(JSON.parse(readFileSync(requiredEnvironment('ERP_M1_G07_FIXTURE_MANIFEST'), 'utf8')));
    db = createDatabase();
    assert.equal(db.dialect, 'mysql');
  });
  after(() => db?.close());

  test('real information_schema matches the canonical current SQLite schema', () => {
    const snapshot = captureSqliteSnapshot((path) => createSqliteDatabase(path), false);
    const result = assertM1CoreInformationSchemaParity(db, snapshot);
    assert.equal(result.source, 'information_schema');
  });

  for (const definition of M1_CORE_G07_SCENARIOS) {
    test(`${definition.id} ${definition.handler}: exact winner/loser, audit and full snapshot`, async () => {
      await executeRace(db, manifest, definition);
    });
  }
});
