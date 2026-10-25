import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import {
  assertWave10StaticAuthorization, authorizeInitialWave10Target, encodeWave10CampaignLease,
  resetWave10CampaignSchema, wave10ObjectInventory, assertWave10ZeroObjects, releaseWave10CampaignLease,
} from '../../server/test-utils/mysql-wave10-campaign-target.js';
import { awaitWave10SuiteChild, transitionWave10RunnerState } from '../../server/test-utils/mysql-wave10-process-lifecycle.js';
import { parseWave10TapTranscript, assertWave10TapTranscriptStrict } from './mysql-wave10-tap-transcript.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRED_ENV = Object.freeze(['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD']);

function defaultOpenAdapter(config) {
  return new MySqlSyncAdapter({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, ssl: config.ssl,
  });
}

function suiteTimeoutMs(env) {
  const configured = Number(env.ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(configured) || configured < 10_000 || configured > 3_600_000) {
    throw new Error('WAVE 10 MYSQL RUNNER: ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS must be 10000..3600000');
  }
  return configured;
}

function tee(stream, target, capture) {
  if (!stream) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => { capture.value += chunk; target?.write?.(chunk); });
}

function closeAdapter(db, label) {
  try { db.close(); }
  catch (error) { throw new Error(`${label}: adapter close failed`, { cause: error }); }
}

async function awaitChildOrSpawnError(child, options) {
  try {
    return await Promise.race([
      options.awaitChild(child, { timeoutMs: options.timeoutMs, terminateTree: options.terminateTree }),
      new Promise((_, reject) => child.once('error', reject)),
    ]);
  } catch (error) {
    throw wave10CampaignError('suite child failed before it could run', {
      code: 'WAVE10_MYSQL_SUITE_SPAWN_FAILED', cause: error,
    });
  }
}

function combineErrors(primary, secondary, message) {
  return primary ? new AggregateError([primary, secondary], message) : secondary;
}

// §37.39.4 — a terminal campaign failure carries the cleanup outcome so a
// refusal can never be reported as a clean run. `NOT_ATTEMPTED_CHILD_LIVE`
// means the runner refused to touch the target because a child could still be
// using it.
export const WAVE10_CLEANUP_STATUS = Object.freeze({
  CONFIRMED: 'CLEANUP_CONFIRMED',
  FAILED: 'CLEANUP_FAILED',
  NOT_ATTEMPTED_CHILD_LIVE: 'NOT_ATTEMPTED_CHILD_LIVE',
  NOT_REQUIRED: 'NOT_REQUIRED',
});

export function wave10CampaignError(message, { code = 'WAVE10_MYSQL_CAMPAIGN_FAILED', cleanup = 'NOT_REQUIRED', cause } = {}) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, cleanup, wave10: true });
}

export async function runProtectedMySqlCampaign({ campaign, suites, renderBoard = null, dependencies = {} }) {
  const env = dependencies.env ?? process.env;
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`${campaign} MYSQL ENVIRONMENT = UNAVAILABLE (${missing.join(', ')} missing)`);
  env.ERP_DB_BACKEND = 'mysql';
  env.ERP_TEST_DB_BACKEND = 'mysql';
  env.NODE_ENV = 'test';
  env.ERP_SEED_DEMO = 'false';

  const resolveConfig = dependencies.resolveConfig ?? ((overrides) => resolveDatabaseConfig(overrides));
  const openAdapter = dependencies.openAdapter ?? defaultOpenAdapter;
  const spawnChild = dependencies.spawnChild ?? spawn;
  const awaitChild = dependencies.awaitChild ?? awaitWave10SuiteChild;
  const terminateTree = dependencies.terminateTree;
  const authorizeInitial = dependencies.authorizeInitial ?? authorizeInitialWave10Target;
  const resetSchema = dependencies.resetSchema ?? resetWave10CampaignSchema;
  const inventory = dependencies.inventory ?? wave10ObjectInventory;
  const assertZero = dependencies.assertZero ?? assertWave10ZeroObjects;
  const releaseLease = dependencies.releaseLease ?? releaseWave10CampaignLease;
  const parseTap = dependencies.parseTap ?? parseWave10TapTranscript;
  const assertTap = dependencies.assertTap ?? assertWave10TapTranscriptStrict;
  const output = dependencies.output ?? process.stdout;
  const errorOutput = dependencies.errorOutput ?? process.stderr;
  const campaignId = dependencies.campaignId ?? randomUUID();
  const timeoutMs = dependencies.timeoutMs ?? suiteTimeoutMs(env);
  const config = resolveConfig({ backend: 'mysql' });
  assertWave10StaticAuthorization(config, env);

  let state = 'PREFLIGHT';
  let lease = null;
  let childMayBeLive = false;
  let cleanupBlocked = false;
  let cleanupStatus = WAVE10_CLEANUP_STATUS.NOT_REQUIRED;
  let primaryError = null;
  const results = [];

  const preflightDb = openAdapter(config);
  try {
    lease = authorizeInitial(preflightDb, config, env, campaignId);
    state = transitionWave10RunnerState(state, 'IDENTITY_VERIFIED');
  } finally {
    closeAdapter(preflightDb, `${campaign} preflight`);
  }

  const childEnv = {
    ...env,
    ERP_MYSQL_WAVE10_CAMPAIGN_ID: campaignId,
    ERP_MYSQL_WAVE10_CAMPAIGN_LEASE: encodeWave10CampaignLease(lease),
  };

  const protectedReset = (label) => {
    state = transitionWave10RunnerState(state, 'CLEANUP_RUNNING');
    const db = openAdapter(config);
    let resetError = null;
    try {
      resetSchema(db, config, lease, childEnv);
      assertZero(inventory(db), label);
    } catch (error) { resetError = error; }
    try { closeAdapter(db, label); }
    catch (error) { resetError = combineErrors(resetError, error, `${label}: reset and close failed`); }
    if (resetError) {
      state = transitionWave10RunnerState(state, 'CLEANUP_FAILED');
      cleanupBlocked = true;
      cleanupStatus = WAVE10_CLEANUP_STATUS.FAILED;
      throw resetError;
    }
    state = transitionWave10RunnerState(state, 'CLEANUP_CONFIRMED');
  };

  try {
    for (const suite of suites) {
      protectedReset(`${campaign} ${suite.label} pre-suite reset`);
      state = transitionWave10RunnerState(state, 'SUITE_RUNNING');
      const capture = { value: '' };
      let child;
      try {
        child = spawnChild(process.execPath, ['--test', '--test-concurrency=1', resolve(repoRoot, suite.file)], {
          cwd: repoRoot, env: childEnv, detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        });
      } catch (error) {
        state = transitionWave10RunnerState(state, 'SUITE_FAILED');
        throw wave10CampaignError(`${campaign} ${suite.label} could not be spawned`, {
          code: 'WAVE10_MYSQL_SUITE_SPAWN_FAILED', cause: error,
        });
      }
      tee(child.stdout, output, capture);
      tee(child.stderr, errorOutput, capture);
      const outcome = await awaitChildOrSpawnError(child, { awaitChild, terminateTree, timeoutMs });
      if (outcome.spawnError) {
        state = transitionWave10RunnerState(state, 'SUITE_FAILED');
        throw wave10CampaignError(`${campaign} ${suite.label} could not be spawned`, {
          code: 'WAVE10_MYSQL_SUITE_SPAWN_FAILED', cause: outcome.error,
        });
      }
      if (outcome.timedOut) {
        state = transitionWave10RunnerState(state, 'CHILD_TIMEOUT');
        state = transitionWave10RunnerState(state, 'CHILD_TERMINATION_PENDING');
        if (!outcome.terminationConfirmed) {
          childMayBeLive = true;
          cleanupStatus = WAVE10_CLEANUP_STATUS.NOT_ATTEMPTED_CHILD_LIVE;
          state = transitionWave10RunnerState(state, 'CHILD_TERMINATION_FAILED');
          throw wave10CampaignError(
            `${campaign} ${suite.label} timed out and child termination is unconfirmed; `
            + `cleanup ${WAVE10_CLEANUP_STATUS.NOT_ATTEMPTED_CHILD_LIVE}`,
            { code: 'WAVE10_MYSQL_CHILD_TERMINATION_UNCONFIRMED', cleanup: cleanupStatus },
          );
        }
        state = transitionWave10RunnerState(state, 'CHILD_TERMINATION_CONFIRMED');
        throw wave10CampaignError(`${campaign} ${suite.label} timed out after ${timeoutMs}ms`, {
          code: 'WAVE10_MYSQL_SUITE_TIMEOUT',
        });
      }
      if (outcome.code !== 0) {
        state = transitionWave10RunnerState(state, 'SUITE_FAILED');
        throw wave10CampaignError(`${campaign} ${suite.label} failed with exit ${outcome.code} (${suite.file})`, {
          code: 'WAVE10_MYSQL_SUITE_FAILED',
        });
      }
      const transcript = parseTap(capture.value);
      const summary = assertTap(suite.label, transcript);
      state = transitionWave10RunnerState(state, 'SUITE_PASSED');
      results.push(Object.freeze({ ...suite, summary, output: capture.value }));
    }
  } catch (error) {
    if (state === 'SUITE_RUNNING') state = transitionWave10RunnerState(state, 'SUITE_FAILED');
    primaryError = error;
  } finally {
    if (lease && !childMayBeLive && !cleanupBlocked) {
      try {
        protectedReset(`${campaign} final cleanup`);
        cleanupStatus = WAVE10_CLEANUP_STATUS.CONFIRMED;
        state = transitionWave10RunnerState(state, 'FINAL_ZERO_OBJECTS_CONFIRMED');
        output.write?.(`${campaign} FINAL ZERO OBJECTS = ${JSON.stringify({ tables: 0, views: 0, triggers: 0, routines: 0, events: 0 })}\n`);
      } catch (cleanupError) {
        cleanupStatus = WAVE10_CLEANUP_STATUS.FAILED;
        primaryError = combineErrors(primaryError, cleanupError, `${campaign} failed and cleanup failed`);
      }
    }
  }

  if (lease && !childMayBeLive) {
    try { releaseLease(lease); }
    catch (releaseError) { primaryError = combineErrors(primaryError, releaseError, `${campaign} failed and lease release failed`); }
  }

  if (primaryError) {
    if (primaryError.wave10) primaryError.cleanup = primaryError.cleanup === WAVE10_CLEANUP_STATUS.NOT_REQUIRED ? cleanupStatus : primaryError.cleanup;
    throw primaryError;
  }
  if (state !== 'FINAL_ZERO_OBJECTS_CONFIRMED') {
    throw wave10CampaignError(`${campaign}: final zero-object state not confirmed`, {
      code: 'WAVE10_MYSQL_FINAL_INVENTORY_NOT_ZERO', cleanup: cleanupStatus,
    });
  }
  output.write?.(`${campaign} TARGET = ${lease.identity}\n`);
  for (const result of results) {
    const { summary } = result;
    output.write?.(`${campaign} ${result.label} = PASS (${summary.pass}/${summary.tests}; skipped=${summary.skipped}; cancelled=${summary.cancelled}; todo=${summary.todo})\n`);
  }
  if (renderBoard) renderBoard(results, { campaignId, state });
  output.write?.(`${campaign} = PASS\n`);
  return results;
}

export const _testInternals = Object.freeze({ awaitChildOrSpawnError, closeAdapter, combineErrors, suiteTimeoutMs });
