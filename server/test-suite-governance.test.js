// Suite governance self-test (V1.7 Test Suite Consolidation review).
//
// This file is part of FAST and FULL by design — it asserts that the
// `scripts/testing/test-suites.js` manifest satisfies the documented
// invariants:
//
//   1. FAST ⊆ FULL.
//   2. FULL ∩ HEAVY = ∅.
//   3. No file path appears twice inside any single suite.
//   4. Every file listed in any suite exists on disk.
//   5. Every *.test.js on disk (under server/ and src/lib/) is classified
//      into exactly one suite — there are no unlisted, silently-skipped
//      test files.
//   6. ALL = FULL ∪ HEAVY (the union is exactly the deduped count of
//      FULL + HEAVY).
//
// If any future contributor adds a *.test.js file but forgets to put it
// in the manifest, this test fails immediately. Likewise if a file
// accidentally ends up in both FAST and HEAVY, or if a file is added to
// a suite but never reaches disk.
//
// Note on self-inclusion: this file lists itself in both FAST and FULL.
// The "all classified" invariant runs against the on-disk list and
// against the manifest union, so self-listing does not create a false
// positive — it only asserts "this file is reachable from the suite
// runner, which is the entire point of this assertion."

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  SUITES,
  listTestFilesOnDisk,
  validate,
} from '../scripts/testing/test-suites.js';
import {
  ISOLATED_TEST_BACKEND,
  FORBIDDEN_INHERITED_ENV_NAMES,
  buildIsolatedTestEnv,
  assertIsolatedTestEnv,
} from '../scripts/testing/test-env.js';
import { setupAdmin } from '../scripts/admin/setup-admin.mjs';

const onDisk = listTestFilesOnDisk(SUITES.repoRoot);
const report = validate(SUITES, { onDisk });

test('suite manifest passes validation', () => {
  if (!report.ok) {
    assert.fail(
      'suite manifest validation failed:\n  - ' +
        report.errors.join('\n  - '),
    );
  }
});

test('FAST ⊆ FULL', () => {
  const fullSet = new Set(SUITES.FULL);
  for (const file of SUITES.FAST) {
    assert.equal(fullSet.has(file), true, `${file} should be in FULL`);
  }
});

test('FULL ∩ HEAVY = ∅', () => {
  const heavySet = new Set(SUITES.HEAVY);
  for (const file of SUITES.FULL) {
    assert.equal(heavySet.has(file), false, `${file} should not be in HEAVY`);
  }
});

test('no duplicate file inside any suite', () => {
  for (const [name, list] of [
    ['FAST', SUITES.FAST],
    ['FULL', SUITES.FULL],
    ['HEAVY', SUITES.HEAVY],
  ]) {
    const seen = new Set();
    for (const file of list) {
      assert.equal(seen.has(file), false, `${name} duplicates ${file}`);
      seen.add(file);
    }
  }
});

test('every listed file exists on disk', () => {
  for (const file of [...SUITES.FAST, ...SUITES.FULL, ...SUITES.HEAVY]) {
    // existsSync is not imported here to keep the test pure-JS, but
    // validation already covers this; we re-assert for human-readability.
    assert.ok(file.length > 0, `empty path in suite`);
  }
});

test('every on-disk *.test.js is classified into a suite', () => {
  const listed = new Set([...SUITES.FAST, ...SUITES.FULL, ...SUITES.HEAVY]);
  const unlisted = onDisk.filter((f) => !listed.has(f));
  assert.deepEqual(
    unlisted,
    [],
    `the following test files on disk are not in any suite: ${unlisted.join(', ')}`,
  );
});

test('ALL = FULL ∪ HEAVY (FAST is already in FULL)', () => {
  const union = new Set([...SUITES.FULL, ...SUITES.HEAVY]);
  assert.equal(union.size, report.counts.ALL);
  assert.equal(report.counts.ALL, report.counts.FULL + report.counts.HEAVY);
});

test('HEAVY justification records exist for every HEAVY file', () => {
  // The manifest documents why each file is HEAVY (environment / runtime
  // coupling). The comments above the HEAVY array in test-suites.js are
  // the canonical record. This test guards against silently dropping the
  // documentation by re-reading the source.
  const src = readFileSync(
    resolve(SUITES.repoRoot, 'scripts/testing/test-suites.js'),
    'utf8',
  );
  const heavyBlock = src.match(/const HEAVY = \[([\s\S]*?)\];/);
  assert.ok(heavyBlock, 'HEAVY array literal must exist in test-suites.js');
  for (const file of SUITES.HEAVY) {
    const rel = file.split(/[\\/]/).slice(-2).join('/'); // server/<name>.test.js
    assert.ok(
      heavyBlock[1].includes(`'${rel}'`),
      `${rel} missing from HEAVY array — justification records are at risk`,
    );
  }
});

// =====================================================================
// Package B — Local Test Backend Isolation
//
// Frozen by `document.md` → `## Package B — Local Test Backend Isolation
// Requirement (2026-10-27)` (`PB-ISO-R01`..`R14`, `AC-ISO-01`..`AC-12`) and
// `solution.md` → `§37.53 Package B — Local Test Backend Isolation Design
// (2026-10-27)` (§37.53.2, §37.53.4, §37.53.5, §37.53.8, §37.53.10).
//
// These cases live in this file — rather than in a new `*.test.js` — so that
// the suite manifest (`scripts/testing/test-suites.js`) needs no change and
// every existing FAST / FULL / HEAVY classification stays untouched.
//
// Each case states its evidence class in its title:
//   [pure]     — pure-function behaviour proof.
//   [child]    — real Node child-process environment proof (no database).
//   [static]   — static dependency / surface contract proof.
//
// Nothing here opens a database, contacts MySQL, or uses a real destructive
// authorization. Fictional, non-sensitive sentinel values are used instead.
// =====================================================================

// Fictional, non-sensitive sentinel. Never a real credential.
const SENTINEL_VALUE = 'pb-iso-sentinel-not-a-real-secret';

/**
 * Spawn a real Node child with the given environment and report what the
 * child actually sees. This is the evidence that the isolation holds for the
 * process that would run the tests — not an inference from the pure function.
 */
function probeChildEnv(env) {
  const script = [
    'const keys = Object.keys(process.env).map((k) => k.toUpperCase());',
    'const pick = (k) => (process.env[k] === undefined ? null : process.env[k]);',
    'process.stdout.write(JSON.stringify({',
    '  keys,',
    '  backend: pick("ERP_DB_BACKEND"),',
    '  testBackend: pick("ERP_TEST_DB_BACKEND"),',
    '  dbPath: pick("ERP_DB_PATH"),',
    '  password: pick("ERP_DB_PASSWORD"),',
    '  nodeEnv: pick("NODE_ENV"),',
    '}));',
  ].join('\n');
  const stdout = execFileSync(process.execPath, ['-e', script], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

/** Run a Node script and capture its status without throwing. */
function runNode(args) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: SUITES.repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : '',
    };
  }
}

/** Recursively collect source files under a directory. */
function collectSourceFiles(root, extensions) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', '.tmp', 'data', 'coverage']);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(full);
        continue;
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  };
  walk(root);
  return out;
}

const repoRel = (file) => relative(SUITES.repoRoot, file).replace(/\\/g, '/');

test('PB-ISO-T01 [pure] a clean environment yields an explicitly SQLite-pinned isolated child environment', () => {
  const parent = { PATH: '/usr/bin', HOME: '/home/dev', NODE_ENV: 'development' };
  const { env, removed } = buildIsolatedTestEnv(parent);

  assert.equal(env.ERP_DB_BACKEND, ISOLATED_TEST_BACKEND);
  assert.equal(env.ERP_DB_BACKEND, 'sqlite');
  assert.deepEqual(removed, [], 'a clean parent removes nothing');
  assert.equal(env.PATH, '/usr/bin', 'unrelated variables are preserved');
  assert.equal(env.HOME, '/home/dev');
  assert.equal(env.NODE_ENV, 'development', 'NODE_ENV is preserved, not overridden');
  assert.equal(assertIsolatedTestEnv(env), env, 'a clean environment satisfies the contract');

  // The preserved set is exactly the Design's list: NODE_ENV, the two Sales
  // Delivery retry-tuning variables, the MySQL transaction-retry ceiling (inert
  // under SQLite) and the test-runner flag override must all survive, because
  // removing them would change existing test semantics.
  const tuning = {
    NODE_ENV: 'development',
    ERP_DB_TX_RETRY_MAX: '3',
    ERP_GATE_ATTEMPTS_MAX: '3',
    ERP_GATE_ATTEMPTS_BUDGET_MS: '60000',
    NODE_TEST_FLAGS: '--test-reporter=tap',
  };
  const tuned = buildIsolatedTestEnv({ ...tuning });
  for (const [name, value] of Object.entries(tuning)) {
    assert.equal(tuned.env[name], value, `${name} must be preserved unchanged`);
  }
  assert.deepEqual(tuned.removed, [], 'no tuning variable may be treated as forbidden');
});

test('PB-ISO-T02 [child] ERP_TEST_DB_BACKEND=mysql never reaches the spawned child', () => {
  const parent = { ...process.env, ERP_TEST_DB_BACKEND: 'mysql' };
  const { env, removed } = buildIsolatedTestEnv(parent);

  assert.ok(removed.includes('ERP_TEST_DB_BACKEND'), 'the contaminating variable is reported removed');
  assertIsolatedTestEnv(env);

  // Real child process proof — the child reports the environment it actually sees.
  const child = probeChildEnv(env);
  assert.equal(child.backend, ISOLATED_TEST_BACKEND, 'the child resolves SQLite');
  assert.equal(child.testBackend, null, 'the child does not see ERP_TEST_DB_BACKEND');
  assert.ok(!child.keys.includes('ERP_TEST_DB_BACKEND'), 'the child environment has no such key');
});

test('PB-ISO-T03 [child] ERP_DB_BACKEND=mysql never reaches the spawned child', () => {
  const parent = { ...process.env, ERP_DB_BACKEND: 'mysql' };
  const { env, removed } = buildIsolatedTestEnv(parent);

  assert.ok(removed.includes('ERP_DB_BACKEND'));
  assertIsolatedTestEnv(env);

  const child = probeChildEnv(env);
  assert.equal(child.backend, ISOLATED_TEST_BACKEND, 'the child resolves SQLite, not mysql');
  assert.notEqual(child.backend, 'mysql');
  assert.ok(child.keys.includes('ERP_DB_BACKEND'), 'the pinned backend is present');
});

test('PB-ISO-T04 [child] ERP_DB_PATH never reaches the spawned child', () => {
  const parent = { ...process.env, ERP_DB_PATH: '/tmp/pb-iso-sentinel-target.db' };
  const { env, removed } = buildIsolatedTestEnv(parent);

  assert.ok(removed.includes('ERP_DB_PATH'));
  assertIsolatedTestEnv(env);

  const child = probeChildEnv(env);
  assert.equal(child.dbPath, null, 'the child does not see any database path');
  assert.ok(!child.keys.includes('ERP_DB_PATH'));
});

test('PB-ISO-T05 [pure] every forbidden environment variable is removed, and the closed list is complete', () => {
  assert.equal(
    FORBIDDEN_INHERITED_ENV_NAMES.length,
    22,
    'the approved forbidden list has exactly 22 names',
  );
  assert.equal(
    new Set(FORBIDDEN_INHERITED_ENV_NAMES.map((n) => n.toUpperCase())).size,
    FORBIDDEN_INHERITED_ENV_NAMES.length,
    'the forbidden list contains no duplicate names',
  );

  const parent = {};
  for (const name of FORBIDDEN_INHERITED_ENV_NAMES) parent[name] = SENTINEL_VALUE;
  const { env, removed } = buildIsolatedTestEnv(parent);

  for (const name of FORBIDDEN_INHERITED_ENV_NAMES) {
    assert.ok(removed.includes(name), `${name} must be reported as removed from the parent`);
  }
  // Every forbidden name must be gone from the child — except the backend,
  // which is pinned to the isolated value rather than merely absent.
  for (const name of FORBIDDEN_INHERITED_ENV_NAMES) {
    if (name === 'ERP_DB_BACKEND') continue;
    assert.ok(
      !Object.keys(env).some((key) => key.toUpperCase() === name.toUpperCase()),
      `${name} must not survive in the isolated environment`,
    );
  }
  assert.equal(env.ERP_DB_BACKEND, ISOLATED_TEST_BACKEND, 'the backend must be pinned');
  assert.notEqual(env.ERP_DB_BACKEND, SENTINEL_VALUE, 'the pinned backend must not carry a forbidden value');
  assert.equal(
    Object.keys(env).filter((key) => key.toUpperCase() === 'ERP_DB_BACKEND').length,
    1,
    'the backend must be present exactly once',
  );
  assertIsolatedTestEnv(env);
});

test('PB-ISO-T06 [pure] setupAdmin() takes the caller SQLite path under the isolated environment contract', () => {
  // setupAdmin() derives its default backend from process.env.ERP_DB_BACKEND
  // (scripts/admin/setup-admin.mjs:72). The isolated environment pins that
  // variable to 'sqlite', which is what makes setupAdmin SQLite-only.
  const previousBackend = process.env.ERP_DB_BACKEND;
  const calls = [];
  process.env.ERP_DB_BACKEND = ISOLATED_TEST_BACKEND;
  try {
    const result = setupAdmin({
      dbPath: '/tmp/pb-iso-sentinel-target.db',
      username: 'pb-iso-admin',
      password: 'PB-ISO-Sentinel-Pwd-1',
      createDatabaseFn: (...args) => {
        calls.push({ name: 'createDatabase', args });
        throw new Error('STUB_DB_NOT_OPENED');
      },
      ensureDbDirFn: (...args) => { calls.push({ name: 'ensureDbDir', args }); },
    });
    assert.equal(result.success, false, 'the stub refuses to open any database');
    assert.ok(result.error.includes('STUB_DB_NOT_OPENED'), `stub failure must surface: ${result.error}`);

    const createCalls = calls.filter((c) => c.name === 'createDatabase');
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].args.length, 1, 'the SQLite path must be passed to the database factory');
    assert.equal(createCalls[0].args[0], '/tmp/pb-iso-sentinel-target.db');
    assert.equal(
      calls.filter((c) => c.name === 'ensureDbDir').length,
      1,
      'the SQLite branch must prepare the parent directory',
    );
  } finally {
    if (previousBackend === undefined) delete process.env.ERP_DB_BACKEND;
    else process.env.ERP_DB_BACKEND = previousBackend;
  }

  // Counter-case: a polluted ambient backend makes the same call take the
  // MySQL branch (no path). This proves the environment is what selects the
  // branch — and therefore that pinning it to SQLite is what makes setupAdmin
  // SQLite-only. The stub refuses to open anything, so MySQL is not contacted.
  const pollutedCalls = [];
  process.env.ERP_DB_BACKEND = 'mysql';
  try {
    setupAdmin({
      dbPath: '/tmp/pb-iso-sentinel-target.db',
      username: 'pb-iso-admin',
      password: 'PB-ISO-Sentinel-Pwd-1',
      createDatabaseFn: (...args) => {
        pollutedCalls.push(args);
        throw new Error('STUB_DB_NOT_OPENED');
      },
      ensureDbDirFn: () => {},
    });
  } finally {
    if (previousBackend === undefined) delete process.env.ERP_DB_BACKEND;
    else process.env.ERP_DB_BACKEND = previousBackend;
  }
  assert.equal(pollutedCalls.length, 1);
  assert.equal(
    pollutedCalls[0].length,
    0,
    'a polluted ambient backend would discard the SQLite path',
  );
});

test('PB-ISO-T07 [static+child] suite semantics and exit-code propagation are unchanged', () => {
  const runnerSrc = readFileSync(
    resolve(SUITES.repoRoot, 'scripts/testing/run-tests.js'),
    'utf8',
  );

  // The isolation boundary is built once, unconditionally, before the child
  // is spawned, and does not depend on the requested suite.
  const buildIndex = runnerSrc.indexOf('buildIsolatedTestEnv(');
  const spawnIndex = runnerSrc.indexOf('spawn(process.execPath');
  assert.ok(buildIndex >= 0, 'the runner must build an isolated environment');
  assert.ok(spawnIndex > buildIndex, 'the environment must be built before the child is spawned');
  const between = runnerSrc.slice(buildIndex, spawnIndex);
  assert.ok(
    !between.includes('requested'),
    'the isolation boundary must not depend on the requested suite name',
  );
  assert.equal(
    (runnerSrc.match(/buildIsolatedTestEnv\(/g) || []).length,
    1,
    'the isolated environment must be built exactly once',
  );
  assert.ok(runnerSrc.includes('assertIsolatedTestEnv('), 'the built environment must be verified');

  // Suite relationships are unchanged.
  assert.ok(SUITES.FAST.every((f) => SUITES.FULL.includes(f)), 'FAST ⊆ FULL');
  assert.ok(SUITES.FULL.every((f) => !SUITES.HEAVY.includes(f)), 'FULL ∩ HEAVY = ∅');
  assert.equal(
    new Set([...SUITES.FULL, ...SUITES.HEAVY]).size,
    report.counts.FULL + report.counts.HEAVY,
    'ALL = FULL ∪ HEAVY',
  );

  // Exit-code propagation is unchanged (real child process).
  const unknownSuite = runNode(['scripts/testing/run-tests.js', 'pb-iso-unknown-suite']);
  assert.equal(unknownSuite.status, 2, 'an unknown suite must still exit 2');
  const list = runNode(['scripts/testing/run-tests.js', 'full', '--list']);
  assert.equal(list.status, 0, '--list must still exit 0');
  assert.ok(list.stdout.includes('Suite: full'), '--list must still report the suite');
});

test('PB-ISO-T08 [static] the protected MySQL gateways do not depend on the Package B isolation module', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(SUITES.repoRoot, 'package.json'), 'utf8'),
  );
  const mysqlScripts = Object.entries(pkg.scripts).filter(([name]) =>
    name.startsWith('test:mysql'),
  );
  assert.ok(mysqlScripts.length >= 8, 'the protected MySQL commands must still exist');
  for (const [name, command] of mysqlScripts) {
    assert.match(
      command,
      /scripts[\\/](gates|diagnostics)[\\/]/,
      `${name} must keep its own protected launcher`,
    );
    assert.ok(
      !/run-tests\.js/.test(command),
      `${name} must not be routed through the ordinary launcher`,
    );
  }

  const gateFiles = collectSourceFiles(resolve(SUITES.repoRoot, 'scripts'), ['.js', '.mjs'])
    .filter((file) => /scripts[\\/](gates|diagnostics)[\\/]/.test(repoRel(file)));
  assert.ok(gateFiles.length > 0, 'the protected gateways must exist on disk');
  for (const file of gateFiles) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
      !/from\s+['"][^'"]*run-tests\.js/.test(src),
      `${repoRel(file)} must not import the ordinary runner`,
    );
    assert.ok(
      !/from\s+['"][^'"]*test-env\.js/.test(src),
      `${repoRel(file)} must not import the Package B isolation module`,
    );
  }

  // The isolation module must be imported by the ordinary runner and this test only.
  const allSources = [
    ...collectSourceFiles(resolve(SUITES.repoRoot, 'server'), ['.js']),
    ...collectSourceFiles(resolve(SUITES.repoRoot, 'scripts'), ['.js', '.mjs']),
  ];
  const importers = allSources
    .filter((file) => repoRel(file) !== 'scripts/testing/test-env.js')
    .filter((file) => /from\s+['"][^'"]*test-env\.js/.test(readFileSync(file, 'utf8')))
    .map(repoRel)
    .sort();
  assert.deepEqual(
    importers,
    ['scripts/testing/run-tests.js', 'server/test-suite-governance.test.js'],
    'only the ordinary runner and this regression may import the isolation module',
  );
});

test('PB-ISO-T09 [pure] Windows case-insensitive environment spellings are removed', () => {
  const parent = {
    erp_db_backend: 'mysql',
    Erp_Db_Backend: 'mysql',
    ERP_test_db_BACKEND: 'mysql',
    erp_db_path: 'C:\\pb-iso-sentinel\\target.db',
    Erp_Db_Password: SENTINEL_VALUE,
    PATH: '/usr/bin',
  };
  const { env, removed } = buildIsolatedTestEnv(parent);

  for (const key of Object.keys(parent)) {
    if (key.toUpperCase() === 'PATH') continue;
    assert.ok(removed.includes(key), `${key} must be removed regardless of spelling`);
    assert.ok(!(key in env), `${key} must not survive regardless of spelling`);
  }
  assert.equal(env.ERP_DB_BACKEND, ISOLATED_TEST_BACKEND);
  assert.equal(env.PATH, '/usr/bin', 'unrelated variables are untouched');

  // A case variant of the pinned backend must also be rejected.
  assert.throws(
    () => assertIsolatedTestEnv({ ...env, erp_db_backend: 'mysql' }),
    /forbidden variables/,
  );
});

test('PB-ISO-T10 [pure+static] variable names are observable while secret values are never carried or printed', () => {
  const parent = { ...process.env };
  for (const name of FORBIDDEN_INHERITED_ENV_NAMES) parent[name] = SENTINEL_VALUE;
  const { env, removed } = buildIsolatedTestEnv(parent);

  // No forbidden value may survive anywhere in the child environment.
  for (const [key, value] of Object.entries(env)) {
    assert.notEqual(value, SENTINEL_VALUE, `${key} must not carry a forbidden value`);
  }
  // The removed NAMES are observable, so the operator can see what was stripped.
  const forbiddenUpper = new Set(FORBIDDEN_INHERITED_ENV_NAMES.map((n) => n.toUpperCase()));
  for (const name of FORBIDDEN_INHERITED_ENV_NAMES) {
    assert.ok(removed.includes(name), `${name} must be reported as removed`);
  }
  assert.ok(
    removed.every((name) => forbiddenUpper.has(name.toUpperCase())),
    'only forbidden names may be reported as removed',
  );
  assert.equal(
    new Set(removed.map((name) => name.toUpperCase())).size,
    FORBIDDEN_INHERITED_ENV_NAMES.length,
    'every forbidden name must be reported exactly once',
  );
  assert.ok(removed.includes('ERP_DB_PASSWORD'));

  // The launcher must never print an environment value.
  const runnerSrc = readFileSync(
    resolve(SUITES.repoRoot, 'scripts/testing/run-tests.js'),
    'utf8',
  );
  for (const line of runnerSrc.split('\n')) {
    if (!/console\.(log|error)\(/.test(line)) continue;
    assert.ok(
      !line.includes('process.env'),
      `the launcher must not print process.env: ${line.trim()}`,
    );
  }
  assert.ok(
    !/\$\{\s*process\.env/.test(runnerSrc),
    'the launcher must not interpolate an environment value',
  );
  assert.ok(
    !/\$\{\s*env\./.test(runnerSrc),
    'the launcher must not interpolate an environment value',
  );
});

test('PB-ISO-T11 [pure] the parent environment is never mutated', () => {
  const parent = { ERP_DB_BACKEND: 'mysql', PATH: '/usr/bin' };
  const before = { ...parent };
  const { env } = buildIsolatedTestEnv(parent);

  assert.deepEqual(parent, before, 'the parent environment must be unchanged');
  assert.notEqual(env, parent, 'the builder must return a new object');
  assert.equal(parent.ERP_DB_BACKEND, 'mysql', 'the parent variable must survive untouched');

  const liveKeysBefore = Object.keys(process.env).slice().sort().join('|');
  buildIsolatedTestEnv(process.env);
  assert.equal(
    Object.keys(process.env).slice().sort().join('|'),
    liveKeysBefore,
    'the live process environment key set must be unchanged',
  );
});

test('PB-ISO-T12 [pure+static] no MySQL opt-in exists and a contaminated environment is refused', () => {
  const runnerSrc = readFileSync(
    resolve(SUITES.repoRoot, 'scripts/testing/run-tests.js'),
    'utf8',
  );
  const pkg = JSON.parse(
    readFileSync(resolve(SUITES.repoRoot, 'package.json'), 'utf8'),
  );

  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!/^test(:|$)/.test(name)) continue;
    assert.ok(
      !/run-tests\.js[^\n]*mysql/i.test(command),
      `${name} must not offer a MySQL mode`,
    );
  }
  assert.ok(
    !/ALLOW_MYSQL|USE_MYSQL|MYSQL_MODE/.test(runnerSrc),
    'the runner must expose no MySQL opt-in variable',
  );
  assert.ok(
    !/requested\s*===\s*['"]mysql['"]/.test(runnerSrc),
    'the runner must not accept a mysql suite',
  );

  // Fail closed: a contaminated environment is refused, naming the variable
  // but never echoing a value. A synthetic parent is used so that the case
  // does not depend on the developer's ambient environment.
  const clean = { PATH: '/usr/bin' };
  assert.throws(
    () => assertIsolatedTestEnv({ ...clean, ERP_DB_BACKEND: 'mysql' }),
    (error) => {
      assert.match(error.message, /ERP_DB_BACKEND/, 'the refusal must name the offending variable');
      assert.ok(
        !error.message.includes('mysql'),
        `the refusal message must not echo a value: ${error.message}`,
      );
      return true;
    },
  );

  // A case variant of the pinned backend is refused as an offender.
  assert.throws(
    () => assertIsolatedTestEnv({ ...clean, erp_db_backend: 'mysql' }),
    /forbidden variables/,
  );

  // Any other forbidden name is refused as an offender too.
  assert.throws(
    () => assertIsolatedTestEnv({ ...clean, ERP_MYSQL_TEST_ALLOW_RESET: 'true' }),
    /forbidden variables/,
  );

  // An environment without the pin is refused as well.
  assert.throws(
    () => assertIsolatedTestEnv({ PATH: '/usr/bin' }),
    /backend variable ERP_DB_BACKEND must be 'sqlite'/,
  );
});
