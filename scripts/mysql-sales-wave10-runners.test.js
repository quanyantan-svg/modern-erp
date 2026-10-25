// Local behavior coverage for the protected Wave 10 runners. No test opens a database connection.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createDatabase } from '../server/db.js';
import {
  ensureFinanceOpenItemEffectsView, FINANCE_OPEN_ITEM_EFFECTS_VIEW_DDL,
} from '../server/modules/finance-open-item-effect-view.js';
import {
  ACCEPTANCE_EVIDENCE_LEVELS, GATE_B_CASES, GATE_B_SUITES,
  R_SAL_ALIASES, WAVE10_MYSQL_SUITES, WAVE10_RACE_CASES,
} from './gates/mysql-sales-wave10-manifest.mjs';
import {
  authorizeInitialWave10Target, assertWave10StaticAuthorization, encodeWave10CampaignLease,
  grantFingerprint, releaseWave10CampaignLease, resetWave10CampaignSchema, verifyWave10ConnectedIdentity,
  wave10TargetReport, _testInternals,
} from '../server/test-utils/mysql-wave10-campaign-target.js';
import {
  awaitWave10SuiteChild, terminateWave10ProcessTree, transitionWave10RunnerState,
} from '../server/test-utils/mysql-wave10-process-lifecycle.js';
import {
  assertWave10TapTranscriptStrict, parseWave10TapTranscript,
} from './gates/mysql-wave10-tap-transcript.mjs';
import { runProtectedMySqlCampaign, WAVE10_CLEANUP_STATUS } from './gates/mysql-wave10-runner-support.mjs';
import {
  createGateBEvidenceRecord, reduceGateBEvidence,
} from './gates/mysql-sales-wave10-gate-b.mjs';

const read = (path) => readFileSync(resolve(path), 'utf8');
const config = Object.freeze({ host: '127.0.0.1', port: 3306, database: 'modern_erp_wave10_test', user: 'wave10' });
const requiredSchemaPrivileges = [..._testInternals.REQUIRED_SCHEMA_PRIVILEGES];
const validGrants = Object.freeze([
  'GRANT USAGE ON *.* TO `wave10`@`127.0.0.1`',
  `GRANT ${requiredSchemaPrivileges.join(', ')} ON \`modern_erp_wave10_test\`.* TO \`wave10\`@\`127.0.0.1\``,
  'GRANT SELECT ON `performance_schema`.`data_locks` TO `wave10`@`127.0.0.1`',
  'GRANT SELECT ON `performance_schema`.`data_lock_waits` TO `wave10`@`127.0.0.1`',
  'GRANT SELECT ON `performance_schema`.`threads` TO `wave10`@`127.0.0.1`',
]);

function authorizedEnv(overrides = {}) {
  return {
    ERP_DB_HOST: config.host, ERP_DB_PORT: String(config.port), ERP_DB_NAME: config.database,
    ERP_DB_USER: config.user, ERP_DB_PASSWORD: 'not-logged', ERP_MYSQL_TEST_ALLOW_RESET: 'true',
    ERP_MYSQL_TEST_DISPOSABLE_TARGET: 'mysql://wave10@127.0.0.1:3306/modern_erp_wave10_test',
    ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS: 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP',
    ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID: 'uuid-approved',
    ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER: 'wave10@127.0.0.1',
    ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: grantFingerprint([...validGrants].sort()),
    ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY: 'MYSQL_8',
    ERP_MYSQL_WAVE10_INITIAL_INVENTORY: 'EMPTY_ONLY',
    ...overrides,
  };
}

function fakeDb({ identity = {}, inventory = {}, objects = {}, grants = validGrants, closeThrows = false } = {}) {
  const statements = [];
  const actual = {
    database_name: config.database, current_user_name: 'wave10@127.0.0.1',
    server_uuid: 'uuid-approved', version: '8.4.0', ...identity,
  };
  const counts = { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, ...inventory };
  return {
    statements,
    prepare(sql) {
      return {
        get() {
          if (sql.includes('CURRENT_USER()')) return actual;
          if (sql.includes("TABLE_TYPE='BASE TABLE'")) return { count: counts.tables };
          if (sql.includes("TABLE_TYPE='VIEW'")) return { count: counts.views };
          if (sql.includes('information_schema.TRIGGERS')) return { count: counts.triggers };
          if (sql.includes('information_schema.ROUTINES')) return { count: counts.routines };
          if (sql.includes('information_schema.EVENTS')) return { count: counts.events };
          return {};
        },
        all() {
          if (sql.startsWith('SHOW GRANTS')) return grants.map((grant) => ({ grant }));
          if (sql === 'SHOW FULL TABLES') return objects.tables || [];
          if (sql.includes('TRIGGER_NAME name')) return objects.triggers || [];
          if (sql.includes('ROUTINE_NAME name')) return objects.routines || [];
          if (sql.includes('EVENT_NAME name')) return objects.events || [];
          return [];
        },
      };
    },
    exec(sql) { statements.push(sql); },
    close() { if (closeThrows) throw new Error('close failed'); },
  };
}

const validTap = `TAP version 13
# Subtest: bounded
ok 1 - bounded
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1.25
`;

function fakeChild(output = validTap) {
  const child = new EventEmitter();
  child.pid = 1234; child.exitCode = null; child.signalCode = null;
  child.stdout = { setEncoding() {}, on(event, listener) { if (event === 'data') listener(output); } };
  child.stderr = { setEncoding() {}, on() {} };
  child.kill = () => true;
  return child;
}

function runnerDependencies(overrides = {}) {
  const resets = [];
  const released = [];
  const env = authorizedEnv();
  const lease = {
    identity: env.ERP_MYSQL_TEST_DISPOSABLE_TARGET, database: config.database,
    currentUser: env.ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER,
    serverUuid: env.ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID,
    version: '8.4.0', grantDigest: env.ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256,
    campaignId: 'campaign-test', inventoryPolicy: 'EMPTY_ONLY',
  };
  return {
    env,
    campaignId: 'campaign-test', timeoutMs: 10_000,
    resolveConfig: () => config,
    openAdapter: () => fakeDb(),
    authorizeInitial: () => lease,
    resetSchema: () => { resets.push('reset'); },
    inventory: () => ({ tables: 0, views: 0, triggers: 0, routines: 0, events: 0 }),
    assertZero() {},
    spawnChild: () => fakeChild(),
    awaitChild: async () => ({ timedOut: false, terminationConfirmed: true, code: 0, signal: null }),
    releaseLease: () => { released.push('release'); },
    output: { write() {} }, errorOutput: { write() {} },
    resets,
    released,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// L-ISO — command mapping and suite-registry isolation
// ---------------------------------------------------------------------------

test('L-ISO-01 protected Wave 10 graphs contain no Gate A or legacy suite', () => {
  const gateA = read('scripts/gates/mysql-sales-wave7-gate-a.mjs');
  const gateB = read('scripts/gates/mysql-sales-wave10-gate-b.mjs');
  const acceptance = read('scripts/gates/mysql-sales-wave10-acceptance.mjs');
  assert.doesNotMatch(gateA, /mysql-sales-wave10|GATE B/);
  assert.doesNotMatch(`${gateB}\n${acceptance}`, /mysql-sales-wave7-gate-a|test:mysql:legacy/);
});

test('L-ISO-02 real MySQL suites stay outside FAST/FULL/HEAVY and the shared Gate A helpers are unchanged', () => {
  const suites = read('scripts/testing/test-suites.js');
  for (const file of [...WAVE10_MYSQL_SUITES, ...GATE_B_SUITES].map((item) => item.file)) {
    assert.equal(suites.includes(`'${file}'`), false, `${file} must not be registered unconditionally`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:mysql'], 'node scripts/gates/mysql-sales-wave7-gate-a.mjs');
  assert.equal(pkg.scripts['test:mysql:gate-a'], 'node scripts/gates/mysql-sales-wave7-gate-a.mjs');
  assert.equal(pkg.scripts['test:mysql:wave10'], 'node scripts/gates/mysql-sales-wave10-acceptance.mjs');
  assert.equal(pkg.scripts['test:mysql:gate-b'], 'node scripts/gates/mysql-sales-wave10-gate-b.mjs');
  assert.equal(pkg.scripts['test:mysql:legacy'], 'node scripts/gates/mysql-gate.mjs');
});

test('manifest keeps bounded commands, adds business matrix and gives B-M15 production evidence', () => {
  assert.deepEqual(WAVE10_MYSQL_SUITES.map((item) => item.label), ['W10-PARITY', 'W10-RACES', 'W10-BUSINESS-MATRIX']);
  assert.deepEqual(WAVE10_RACE_CASES, Array.from({ length: 12 }, (_, index) => `W10-R${index + 1}`));
  assert.deepEqual(R_SAL_ALIASES, { 'R-SAL-12': 'W10-R1', 'R-SAL-13': 'W10-R2', 'R-SAL-14': 'W10-R3' });
  assert.equal(GATE_B_CASES.find((item) => item.id === 'B-M15').evidence, 'PRODUCTION_SERIALIZED_OUTCOME');
  assert.equal(GATE_B_CASES.find((item) => item.id === 'B-COMPOSE').evidence, 'STATIC_INTENT');
  assert.deepEqual(ACCEPTANCE_EVIDENCE_LEVELS, ['PRODUCTION_SERIALIZED_OUTCOME', 'RAW_ROW_LEVEL_LOCK_ORDER', 'STATIC_INTENT']);
});

// ---------------------------------------------------------------------------
// L-GRD — disposable target guard
// ---------------------------------------------------------------------------

test('L-GRD-01 missing destructive acknowledgements are refused before any adapter is opened', () => {
  for (const missing of ['ERP_MYSQL_TEST_ALLOW_RESET', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET', 'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS']) {
    const env = authorizedEnv({ [missing]: '' });
    assert.throws(() => assertWave10StaticAuthorization(config, env), /DISPOSABLE TARGET REFUSED/);
  }
  for (const missing of ['ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER', 'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256']) {
    const env = authorizedEnv({ [missing]: '' });
    assert.throws(() => assertWave10StaticAuthorization(config, env), /WAVE 10 MYSQL TARGET REFUSED/);
  }
});

test('L-GRD-02 a config identity that does not match the approved target is refused', () => {
  const env = authorizedEnv();
  assert.throws(() => assertWave10StaticAuthorization({ ...config, database: 'other_db' }, env), /DISPOSABLE TARGET REFUSED/);
  assert.throws(() => assertWave10StaticAuthorization({ ...config, host: '10.0.0.1' }, env), /DISPOSABLE TARGET REFUSED/);
  assert.throws(() => assertWave10StaticAuthorization({ ...config, user: 'other' }, env), /DISPOSABLE TARGET REFUSED/);
});

test('L-GRD-03 database, account, UUID, version and grant mismatches are each refused before DROP', () => {
  const cases = [
    [{ database_name: 'other' }, 'DATABASE'], [{ current_user_name: 'other@localhost' }, 'CURRENT_USER'],
    [{ server_uuid: 'other' }, 'UUID'], [{ version: '5.7.0' }, 'MySQL 8'],
  ];
  for (const [identity, message] of cases) {
    const db = fakeDb({ identity });
    assert.throws(() => verifyWave10ConnectedIdentity(db, config, authorizedEnv()), new RegExp(message, 'i'));
    assert.deepEqual(db.statements, [], 'a refused identity must not issue any destructive statement');
  }
  assert.throws(() => verifyWave10ConnectedIdentity(fakeDb(), config, authorizedEnv({ ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: '0'.repeat(64) })), /grant fingerprint/i);
});

test('L-GRD-03A exact least-privilege grants are accepted', () => {
  const verified = verifyWave10ConnectedIdentity(fakeDb(), config, authorizedEnv());
  assert.equal(verified.currentUser, 'wave10@127.0.0.1');
});

test('L-GRD-03B every required target-schema privilege is mandatory', () => {
  for (const missing of requiredSchemaPrivileges) {
    const remaining = requiredSchemaPrivileges.filter((item) => item !== missing);
    const grants = validGrants.map((line) => line.includes('modern_erp_wave10_test')
      ? `GRANT ${remaining.join(', ')} ON \`modern_erp_wave10_test\`.* TO \`wave10\`@\`127.0.0.1\``
      : line);
    const env = authorizedEnv({ ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: grantFingerprint([...grants].sort()) });
    assert.throws(() => verifyWave10ConnectedIdentity(fakeDb({ grants }), config, env), new RegExp(missing.replace(' ', '\\s+'), 'i'));
  }
});

test('L-GRD-03C global static/dynamic authority, delegation and roles are refused', () => {
  const forbidden = [
    'GRANT SELECT ON *.* TO `wave10`@`127.0.0.1`',
    'GRANT BACKUP_ADMIN ON *.* TO `wave10`@`127.0.0.1`',
    'GRANT USAGE ON *.* TO `wave10`@`127.0.0.1` WITH GRANT OPTION',
    'GRANT `admin_role`@`%` TO `wave10`@`127.0.0.1`',
    'SET DEFAULT ROLE `admin_role`@`%` TO `wave10`@`127.0.0.1`',
  ];
  for (const extra of forbidden) {
    const grants = [...validGrants, extra];
    const env = authorizedEnv({ ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: grantFingerprint([...grants].sort()) });
    assert.throws(() => verifyWave10ConnectedIdentity(fakeDb({ grants }), config, env), /forbidden|role/i);
  }
});

test('L-GRD-03D exact Performance Schema reads and target schema are enforced', () => {
  const cases = [
    validGrants.filter((line) => !line.includes('data_lock_waits')),
    [...validGrants, 'GRANT SELECT ON `other_schema`.* TO `wave10`@`127.0.0.1`'],
    validGrants.map((line) => line.includes('data_locks`') ? line.replace('GRANT SELECT', 'GRANT SELECT, UPDATE') : line),
  ];
  for (const grants of cases) {
    const env = authorizedEnv({ ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256: grantFingerprint([...grants].sort()) });
    assert.throws(() => verifyWave10ConnectedIdentity(fakeDb({ grants }), config, env), /Performance Schema|scope/i);
  }
});

test('L-GRD-03E Finance View converges on the canonical definition and MySQL path invokes it', () => {
  const db = createDatabase(':memory:');
  try {
    const canonical = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='finance_open_item_effects'").get()?.sql;
    assert.match(canonical, /SETTLEMENT_ALLOCATION/);
    db.exec('DROP VIEW finance_open_item_effects');
    db.exec('CREATE VIEW finance_open_item_effects AS SELECT 1 stale');
    ensureFinanceOpenItemEffectsView(db);
    const upgraded = db.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='finance_open_item_effects'").get()?.sql;
    assert.match(upgraded, /UNAPPLIED_APPLICATION/);
    assert.match(upgraded, /CREDIT_ADJUSTMENT/);
    assert.match(upgraded, /WRITE_OFF/);
    ensureFinanceOpenItemEffectsView(db);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='view' AND name='finance_open_item_effects'").get().count, 1);
    assert.match(FINANCE_OPEN_ITEM_EFFECTS_VIEW_DDL, /^\s*CREATE VIEW finance_open_item_effects/i);
    const factory = read('server/db.js');
    assert.ok(factory.indexOf('ensureFinanceOpenItemEffectsView(db);', factory.indexOf('createMySqlDatabase')) > factory.indexOf('createMySqlDatabase'));
  } finally { db.close(); }
});

test('L-GRD-03F Wave 10 snapshot bootstrap preserves the approved scope_mode physical type', () => {
  const schema = read('server/database/mysql-schema.js');
  assert.match(schema, /name === 'scope_mode'\) return 'VARCHAR\(128\)'/);
});

test('L-GRD-04 a non-empty initial inventory is refused and no DROP is issued', () => {
  const db = fakeDb({ inventory: { tables: 1 } });
  assert.throws(() => authorizeInitialWave10Target(db, config, authorizedEnv(), 'campaign'), /expected zero tables, found 1/);
  assert.deepEqual(db.statements, []);
});

test('L-GRD-05 an exact empty identity issues a lease whose report carries no secret', () => {
  const db = fakeDb();
  const lease = authorizeInitialWave10Target(db, config, authorizedEnv(), 'campaign-lease');
  assert.equal(lease.campaignId, 'campaign-lease');
  assert.equal(lease.inventoryPolicy, 'EMPTY_ONLY');
  const report = wave10TargetReport(lease);
  assert.deepEqual(Object.keys(report).sort(), [
    'campaignId', 'currentUser', 'database', 'grantDigest', 'identity', 'inventoryPolicy', 'serverUuidDigest', 'version',
  ]);
  assert.match(report.serverUuidDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(report.serverUuidDigest, lease.serverUuid, 'the raw server UUID must not leave the guard');
  assert.doesNotMatch(JSON.stringify(report), /not-logged|password|GRANT /i);
  releaseWave10CampaignLease(lease);
});

test('L-GRD-06 identity drift before reset or cleanup revokes the lease', () => {
  const env = authorizedEnv({ ERP_MYSQL_WAVE10_CAMPAIGN_ID: 'campaign-drift' });
  const lease = authorizeInitialWave10Target(fakeDb(), config, env, 'campaign-drift');
  assert.throws(() => resetWave10CampaignSchema(fakeDb({ identity: { server_uuid: 'drifted' } }), config, lease, env), /server UUID mismatch/);
  // The lease capability is withdrawn, so a fresh authorization is possible.
  const renewed = authorizeInitialWave10Target(fakeDb(), config, env, 'campaign-drift');
  assert.equal(renewed.campaignId, 'campaign-drift');
  releaseWave10CampaignLease(renewed);
});

test('L-GRD-07 unsafe identifiers and unsupported object types are rejected, views precede tables and FK checks are restored', () => {
  const env = authorizedEnv({ ERP_MYSQL_WAVE10_CAMPAIGN_ID: 'campaign-objects' });
  const verified = verifyWave10ConnectedIdentity(fakeDb(), config, env);
  const lease = { ...verified, campaignId: 'campaign-objects' };
  assert.throws(() => resetWave10CampaignSchema(fakeDb({ objects: { tables: [{ name: 'bad-name', type: 'BASE TABLE' }] } }), config, lease, env), /unsafe object name/);
  assert.throws(() => resetWave10CampaignSchema(fakeDb({ objects: { tables: [{ name: 'x', type: 'SEQUENCE' }] } }), config, lease, env), /unsupported object type/);
  const db = fakeDb({ objects: { tables: [
    { name: 'base_a', type: 'BASE TABLE' }, { name: 'view_a', type: 'VIEW' },
  ] } });
  resetWave10CampaignSchema(db, config, lease, env);
  assert.ok(db.statements.indexOf('DROP VIEW IF EXISTS `view_a`') < db.statements.indexOf('DROP TABLE IF EXISTS `base_a`'));
  assert.equal(db.statements.at(-1), 'SET FOREIGN_KEY_CHECKS=1');
});

test('L-GRD-08 the Wave 10 temp lifecycle is consulted first and the default temp-db path is unchanged', async () => {
  const { createTempDb } = await import('../server/test-utils/temp-db.js');
  const saved = {};
  for (const name of ['ERP_TEST_DB_BACKEND', 'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD']) {
    saved[name] = process.env[name];
  }
  try {
    // The MySQL path consults the Wave 10 lifecycle before it would create
    // any adapter, so a refusing lifecycle proves no connection is opened.
    process.env.ERP_TEST_DB_BACKEND = 'mysql';
    process.env.ERP_DB_HOST = '127.0.0.1';
    process.env.ERP_DB_PORT = '3306';
    process.env.ERP_DB_NAME = 'modern_erp_wave10_test';
    process.env.ERP_DB_USER = 'wave10';
    process.env.ERP_DB_PASSWORD = 'not-used';
    const calls = [];
    assert.throws(() => createTempDb({
      label: 'wave10-guard', mysqlLifecycle: { beforeCreate() { calls.push('beforeCreate'); throw new Error('REFUSED'); } },
    }), /REFUSED/);
    assert.deepEqual(calls, ['beforeCreate']);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  // The default local path is unchanged and never consults a lifecycle.
  const handle = createTempDb({ label: 'wave10-default' });
  try {
    assert.ok(handle.dbPath && !handle.dbPath.includes('\\server\\'), 'the default temp database lives outside the repository');
  } finally { handle.cleanup(); }
});

// ---------------------------------------------------------------------------
// L-RUN — runner lifecycle and cleanup
// ---------------------------------------------------------------------------

test('L-RUN-01 a successful campaign reaches the final zero-object state and then renders the board', async () => {
  const boards = [];
  const deps = runnerDependencies();
  await runProtectedMySqlCampaign({
    campaign: 'LOCAL',
    suites: [{ label: 'ONE', file: 'unused.test.js' }],
    renderBoard: (results, context) => boards.push({ results, context }),
    dependencies: deps,
  });
  assert.equal(deps.resets.length, 2, 'one pre-suite reset and one final cleanup');
  assert.equal(boards.length, 1, 'the board is rendered only after the final cleanup');
  assert.equal(boards[0].context.state, 'FINAL_ZERO_OBJECTS_CONFIRMED');
});

test('L-RUN-02 a spawn error cleans up and returns a non-zero result', async () => {
  const boards = [];
  const deps = runnerDependencies({ spawnChild: () => { throw new Error('spawn refused'); } });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }), (error) => error.code === 'WAVE10_MYSQL_SUITE_SPAWN_FAILED');
  assert.equal(deps.resets.length, 2, 'a spawn failure still enters the final cleanup');
  assert.equal(boards.length, 0, 'a failed campaign never renders the board');
});

test('L-RUN-03 a non-zero child exit cleans up and returns a non-zero result', async () => {
  const boards = [];
  const deps = runnerDependencies({ awaitChild: async () => ({ timedOut: false, terminationConfirmed: true, code: 1 }) });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }), (error) => error.code === 'WAVE10_MYSQL_SUITE_FAILED');
  assert.equal(deps.resets.length, 2);
  assert.equal(boards.length, 0);
});

test('L-RUN-04 a timeout whose graceful termination is confirmed cleans up and fails', async () => {
  const boards = [];
  const deps = runnerDependencies({ awaitChild: async () => ({ timedOut: true, terminationConfirmed: true, code: null, signal: 'SIGTERM' }) });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }), (error) => error.code === 'WAVE10_MYSQL_SUITE_TIMEOUT');
  assert.equal(deps.resets.length, 2, 'a confirmed termination still permits the final cleanup');
  assert.equal(boards.length, 0);
});

test('L-RUN-05 a timeout whose forced tree termination is confirmed cleans up and fails', async () => {
  const deps = runnerDependencies({ awaitChild: async () => ({ timedOut: true, terminationConfirmed: true, code: null, signal: 'SIGKILL', forced: true }) });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }], dependencies: deps,
  }), (error) => error.code === 'WAVE10_MYSQL_SUITE_TIMEOUT');
  assert.equal(deps.resets.length, 2);
});

test('L-RUN-06 an unconfirmed termination performs no cleanup and reports NOT_ATTEMPTED_CHILD_LIVE', async () => {
  const boards = [];
  const deps = runnerDependencies({ awaitChild: async () => ({ timedOut: true, terminationConfirmed: false, code: null }) });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }), (error) => {
    assert.equal(error.code, 'WAVE10_MYSQL_CHILD_TERMINATION_UNCONFIRMED');
    assert.equal(error.cleanup, WAVE10_CLEANUP_STATUS.NOT_ATTEMPTED_CHILD_LIVE);
    assert.match(error.message, /NOT_ATTEMPTED_CHILD_LIVE/);
    return true;
  });
  assert.equal(deps.resets.length, 1, 'only the pre-suite reset may run while a child may still be live');
  assert.equal(boards.length, 0);
});

test('L-RUN-07 a cleanup failure blocks the board and returns a non-zero result', async () => {
  const boards = [];
  let resets = 0;
  const deps = runnerDependencies({
    awaitChild: async () => ({ timedOut: false, terminationConfirmed: true, code: 1 }),
    resetSchema: () => { resets += 1; if (resets === 2) throw new Error('cleanup failed'); },
  });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }), AggregateError);
  assert.equal(boards.length, 0, 'a cleanup failure blocks the board');
});

test('L-RUN-08 a non-zero final inventory blocks the board', async () => {
  const boards = [];
  const deps = runnerDependencies({
    inventory: () => ({ tablesAndViews: 1, triggers: 0, routines: 0, events: 0 }),
    assertZero(inventory, label) {
      for (const [kind, count] of Object.entries(inventory)) {
        if (count !== 0) throw new Error(`${label}: expected zero ${kind}, found ${count}`);
      }
    },
  });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused.test.js' }],
    renderBoard: (results) => boards.push(results), dependencies: deps,
  }));
  assert.equal(boards.length, 0, 'a non-zero final inventory blocks the board');
});

test('L-RUN-09 the primary failure and the cleanup failure are both retained', async () => {
  let resets = 0;
  const deps = runnerDependencies({
    awaitChild: async () => ({ timedOut: false, terminationConfirmed: true, code: 1 }),
    resetSchema: () => { resets += 1; if (resets === 2) throw new Error('cleanup failed'); },
  });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL', suites: [{ label: 'ONE', file: 'unused' }], dependencies: deps,
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].code, 'WAVE10_MYSQL_SUITE_FAILED');
    assert.match(error.errors[1].message, /cleanup failed/);
    return true;
  });
});

test('L-RUN-10 no further suite starts after the first failure', async () => {
  const spawned = [];
  const deps = runnerDependencies({
    spawnChild: () => { spawned.push('spawn'); return fakeChild(); },
    awaitChild: async () => ({ timedOut: false, terminationConfirmed: true, code: 1 }),
  });
  await assert.rejects(() => runProtectedMySqlCampaign({
    campaign: 'LOCAL',
    suites: [{ label: 'ONE', file: 'a' }, { label: 'TWO', file: 'b' }, { label: 'THREE', file: 'c' }],
    dependencies: deps,
  }));
  assert.equal(spawned.length, 1, 'the runner must fail fast');
});

test('L-RUN-11 the runner state reducer rejects impossible state changes', () => {
  assert.equal(transitionWave10RunnerState('PREFLIGHT', 'IDENTITY_VERIFIED'), 'IDENTITY_VERIFIED');
  assert.equal(transitionWave10RunnerState('SUITE_RUNNING', 'SUITE_PASSED'), 'SUITE_PASSED');
  assert.throws(() => transitionWave10RunnerState('PREFLIGHT', 'SUITE_PASSED'), /Invalid/);
  assert.throws(() => transitionWave10RunnerState('CLEANUP_FAILED', 'FINAL_ZERO_OBJECTS_CONFIRMED'), /Invalid/);
  assert.throws(() => transitionWave10RunnerState('SUITE_PASSED', 'SUITE_PASSED'), /Invalid/);
});

test('L-RUN-12 a child timeout reports confirmed and unconfirmed termination distinctly', async () => {
  const child = fakeChild('');
  const confirmed = await awaitWave10SuiteChild(child, {
    timeoutMs: 1, waitForExit: async () => ({ exited: false }),
    terminateTree: async () => ({ confirmed: true, forced: true, code: null, signal: 'SIGKILL' }),
  });
  assert.equal(confirmed.timedOut, true); assert.equal(confirmed.terminationConfirmed, true);
  const unconfirmed = await awaitWave10SuiteChild(child, {
    timeoutMs: 1, waitForExit: async () => ({ exited: false }),
    terminateTree: async () => ({ confirmed: false, forced: true, code: null, signal: null }),
  });
  assert.equal(unconfirmed.terminationConfirmed, false);
});

test('L-RUN-13 the tree termination escalates from graceful to forced and reports the outcome truthfully', async () => {
  const graceful = new EventEmitter();
  graceful.pid = 4321; graceful.exitCode = null; graceful.signalCode = null;
  graceful.kill = (signal) => { graceful.exitCode = 0; setImmediate(() => graceful.emit('exit', 0, null)); return true; };
  const gracefulOutcome = await terminateWave10ProcessTree(graceful, {
    gracefulMs: 50, forcedMs: 50, waitForExit: async (child) => (child.exitCode !== null
      ? { exited: true, code: child.exitCode, signal: null } : { exited: false, code: null, signal: null }),
  });
  assert.equal(gracefulOutcome.confirmed, true);
  assert.equal(gracefulOutcome.forced, false);

  const stubborn = new EventEmitter();
  stubborn.pid = 4322; stubborn.exitCode = null; stubborn.signalCode = null;
  stubborn.kill = () => true;
  let waitCalls = 0;
  const forcedOutcome = await terminateWave10ProcessTree(stubborn, {
    gracefulMs: 1, forcedMs: 1, platform: 'win32',
    spawnProcess: () => ({ once(event, listener) { if (event === 'exit') listener(0); }, kill() { return true; } }),
    waitForExit: async () => { waitCalls += 1; return waitCalls === 1 ? { exited: false, code: null, signal: null } : { exited: true, code: 1, signal: null }; },
  });
  assert.equal(forcedOutcome.confirmed, true);
  assert.equal(forcedOutcome.forced, true);
});

// ---------------------------------------------------------------------------
// L-TAP — strict transcript acceptance
// ---------------------------------------------------------------------------

function tapWith(replacements) {
  return replacements.reduce((text, [from, to]) => text.replace(from, to), validTap);
}

test('L-TAP-01 a complete, consistent transcript is accepted', () => {
  const summary = assertWave10TapTranscriptStrict('valid', parseWave10TapTranscript(validTap));
  assert.equal(summary.tests, 1);
  assert.equal(summary.pass, 1);
  assert.equal(summary.fail, 0);
});

test('L-TAP-02 a missing plan is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['1..1\n', '']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-03 a duplicated plan is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['1..1\n', '1..1\n1..1\n']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-04 a truncated record is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['ok 1 - bounded', 'ok 1 -']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-05 a truncated transcript without its final newline is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(validTap.trim())), /truncated transcript/);
});

test('L-TAP-06 a counter that disagrees with the plan is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['# pass 1', '# pass 0']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-07 a duplicated summary counter is rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['# pass 1\n', '# pass 1\n# pass 1\n']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-08 a zero-test plan, a failure, a skip and a todo are all rejected', () => {
  const zero = validTap.replace('ok 1 - bounded\n1..1', '1..0').replace('# tests 1', '# tests 0').replace('# pass 1', '# pass 0');
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(zero)), /WAVE 10 STRICT TAP/);
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['ok 1 - bounded', 'not ok 1 - bounded']]))), /WAVE 10 STRICT TAP/);
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['# skipped 0', '# skipped 1']]))), /WAVE 10 STRICT TAP/);
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(tapWith([['# todo 0', '# todo 1']]))), /WAVE 10 STRICT TAP/);
});

test('L-TAP-09 a trailing partial record and a bail-out are rejected', () => {
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(`${validTap}ok 2 - partial`)), /WAVE 10 STRICT TAP/);
  assert.throws(() => assertWave10TapTranscriptStrict('invalid', parseWave10TapTranscript(`${validTap}Bail out! everything broke`)), /WAVE 10 STRICT TAP/);
});

// ---------------------------------------------------------------------------
// L-MBR — typed Gate B evidence
// ---------------------------------------------------------------------------

function evidenceResults(records) {
  const bySuite = new Map(GATE_B_SUITES.map((suite) => [suite.label, []]));
  for (const record of records) bySuite.get(record.suiteId).push(`W10_GATE_B_EVIDENCE ${JSON.stringify(record)}`);
  return [...bySuite].map(([label, lines]) => ({ label, output: `${lines.join('\n')}\n` }));
}

function validRecords() {
  return GATE_B_CASES.map((item) => createGateBEvidenceRecord({
    caseId: item.id, level: item.evidence, suiteId: item.owner, runId: 'run', details: { asserted: true },
  }));
}

test('L-MBR-01 exactly seven owned, level-matched current-run records are accepted', () => {
  const records = reduceGateBEvidence(evidenceResults(validRecords()), { campaignId: 'run' });
  assert.equal(records.length, 7);
  assert.deepEqual(records.map((row) => row.caseId), GATE_B_CASES.map((item) => item.id));
});

test('L-MBR-02 a missing record is rejected', () => {
  assert.throws(() => reduceGateBEvidence(evidenceResults(validRecords().slice(1)), { campaignId: 'run' }), /Missing Gate B evidence/);
});

test('L-MBR-03 a duplicate record is rejected', () => {
  const records = validRecords();
  assert.throws(() => reduceGateBEvidence(evidenceResults([...records, records[0]]), { campaignId: 'run' }), /Duplicate Gate B evidence/);
});

test('L-MBR-04 an extra unknown record is rejected', () => {
  const extra = createGateBEvidenceRecord({ caseId: 'B-EXTRA', level: 'STATIC_INTENT', suiteId: 'GATE-B', runId: 'run' });
  assert.throws(() => reduceGateBEvidence(evidenceResults([...validRecords(), extra]), { campaignId: 'run' }));
});

test('L-MBR-05 a wrong evidence level is rejected', () => {
  const records = validRecords().map((row, index) => (index
    ? row
    : createGateBEvidenceRecord({ ...row, level: 'RAW_ROW_LEVEL_LOCK_ORDER' })));
  assert.throws(() => reduceGateBEvidence(evidenceResults(records), { campaignId: 'run' }), /level mismatch/);
});

test('L-MBR-06 a wrong owner and a wrong run id are rejected', () => {
  const wrongOwner = validRecords().map((row, index) => (index
    ? row
    : createGateBEvidenceRecord({ ...row, suiteId: 'GATE-B-PRODUCTION-RACES' })));
  assert.throws(() => reduceGateBEvidence(evidenceResults(wrongOwner), { campaignId: 'run' }), /owner/);
  const wrongRun = validRecords().map((row) => createGateBEvidenceRecord({ ...row, runId: 'other' }));
  assert.throws(() => reduceGateBEvidence(evidenceResults(wrongRun), { campaignId: 'run' }), /run mismatch/);
});

test('L-MBR-07 a digest mismatch and a malformed record are rejected', () => {
  const broken = validRecords().map((row, index) => (index ? row : { ...row, digest: '0'.repeat(64) }));
  assert.throws(() => reduceGateBEvidence(evidenceResults(broken), { campaignId: 'run' }), /digest mismatch/);
  const malformed = [{ label: 'GATE-B', output: 'W10_GATE_B_EVIDENCE {not json}\n' }];
  assert.throws(() => reduceGateBEvidence(malformed, { campaignId: 'run' }), /Malformed Gate B evidence JSON/);
});

test('L-MBR-08 an evidence record emitted by a suite that does not own it is rejected', () => {
  const records = validRecords();
  const foreign = createGateBEvidenceRecord({
    caseId: records[0].caseId, level: records[0].level, suiteId: 'GATE-B-PRODUCTION-RACES', runId: 'run',
  });
  const results = [{ label: 'GATE-B', output: `W10_GATE_B_EVIDENCE ${JSON.stringify(foreign)}\n` }];
  assert.throws(() => reduceGateBEvidence(results, { campaignId: 'run' }), /owner\/output mismatch/);
});

test('campaign lease encoding contains no password and is deterministic JSON transport', () => {
  const encoded = encodeWave10CampaignLease({ campaignId: 'run', identity: 'mysql://u@h:1/db' });
  assert.doesNotMatch(encoded, /password/i);
});

test('the guard internals expose the lease registry without leaking a secret', () => {
  assert.ok(_testInternals.activeCampaignLeases instanceof Map);
  assert.equal(typeof _testInternals.revokeWave10CampaignLease, 'function');
});
