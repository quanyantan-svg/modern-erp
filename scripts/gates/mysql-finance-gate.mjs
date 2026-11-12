// Finance Operations 域真实 MySQL 8 campaign 的 root orchestrator.
//
// 与 `mysql-accounting-analytics-gate.mjs` 形态相同，但使用本域自己的 ACK-4
// Manifest (`FINANCE_MYSQL_V1`) 与夹具操作名 (`RUN_FINANCE_RACES`)。只有只读
// preflight 发生在一次性 ACK-4 capability 被原子消费之前。
//
// 需求：docs/requirements/finance-operations.md §33.39（15 个 Finance race 必须在
// 真实 MySQL 上实证；SQLite-only evidence 不计入）

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { assertNoAck4Quarantine, consumeAck4Record } from './ack4/ack4-runtime.mjs';
import { hasExited, waitForExit } from './m1-core-g07-child-lifecycle.mjs';
import { runFinanceMySqlLifecycle } from './mysql-finance-root-lifecycle.mjs';
import { createChildFailureError } from './m1-core-g07-diagnostics.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = 'FINANCE_MYSQL_V1';
const registeredSuites = Object.freeze(['server/mysql-finance-operations-concurrency.integration.js']);

const REQUIRED_ENVIRONMENT = Object.freeze([
  'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
  'ERP_DB_BACKEND', 'ERP_TEST_DB_BACKEND', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET',
  'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256',
]);

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function requiredArgument(name) { const value = argument(name); if (!value) throw new Error(`ACK-4 BLOCKED: ${name} is required`); return value; }
function gitText(args) { return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim(); }

function decryptDpapi(bytes) {
  const encoded = bytes.toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue;',
    `$c=[Convert]::FromBase64String('${encoded}');`,
    '$p=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new();[Console]::Write([Text.Encoding]::UTF8.GetString($p));',
  ].join('');
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

function assertStaticPreflight({ target, environment }) {
  for (const key of ['host', 'port', 'database', 'user', 'selectedDatabase', 'currentUser', 'serverUuid', 'grantsSha256']) {
    if (target?.[key] === undefined || target[key] === null || String(target[key]).trim() === '') {
      throw new Error(`FINANCE_MYSQL_STATIC_TARGET_${key.toUpperCase()}_REQUIRED`);
    }
  }
  if (target.database !== target.selectedDatabase || !/^[0-9a-f]{64}$/.test(target.grantsSha256)) {
    throw new Error('FINANCE_MYSQL_STATIC_TARGET_BINDING_INVALID');
  }
  for (const name of REQUIRED_ENVIRONMENT) {
    if (!String(environment[name] || '').trim()) throw new Error(`FINANCE_MYSQL_STATIC_ENV_${name}_REQUIRED`);
  }
  if (environment.ERP_DB_BACKEND !== 'mysql' || environment.ERP_TEST_DB_BACKEND !== 'mysql') {
    throw new Error('FINANCE_MYSQL_STATIC_MYSQL_BACKEND_REQUIRED');
  }
  const operations = ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_FINANCE_RACES', 'CLEANUP_SCHEMA_POST_RUN'];
  if (JSON.stringify(operations) !== JSON.stringify([
    'RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_FINANCE_RACES', 'CLEANUP_SCHEMA_POST_RUN',
  ])) throw new Error('FINANCE_MYSQL_STATIC_OPERATION_MANIFEST_INVALID');
  return Object.freeze({ operations, target: Object.freeze({ ...target }) });
}

async function main() {
  const runId = requiredArgument('--run-id');
  const capabilityPath = requiredArgument('--ack4-capability');
  const targetPath = resolve(requiredArgument('--target-proof'));

  const commitSha = gitText(['rev-parse', 'HEAD']);
  if (gitText(['status', '--porcelain'])) throw new Error('ACK-4 BLOCKED: the Git worktree must be clean');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
  const operations = assertStaticPreflight({ target, environment: process.env }).operations;
  const storeRoot = resolve(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate', 'ack4');
  const quarantineDir = join(storeRoot, 'quarantine');
  assertNoAck4Quarantine(quarantineDir, target);
  const expected = { commitSha, target, manifest };
  const childDir = join(storeRoot, 'children', runId);
  mkdirSync(childDir, { recursive: true });
  const children = [];
  let rootLease;

  const spawnRegistered = async (context, { mode, operation, extraEnv = {} }) => {
    const childStartedAt = new Date().toISOString();
    const leasePath = join(childDir, `${mode}-${children.length}.lease.json`);
    const child = spawn(process.execPath, [join(repoRoot, 'scripts/gates/mysql-finance-child.mjs'), '--mode', mode], {
      cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...process.env, ...extraEnv, ERP_FINANCE_MYSQL_ACK4_CHILD_LEASE: leasePath,
        ERP_FINANCE_MYSQL_ACK4_CHILD_CONSUMED_DIR: join(childDir, 'consumed'),
        ERP_FINANCE_MYSQL_ACK4_ROOT_PUBLIC_KEY: rootLease.childLeasePublicKey,
        ERP_FINANCE_MYSQL_ROOT_PID: String(process.pid), ERP_FINANCE_MYSQL_CHILD_STARTED_AT: childStartedAt,
        ERP_FINANCE_MYSQL_COMMIT_SHA: commitSha, ERP_FINANCE_MYSQL_TARGET_PROOF: targetPath, ERP_FINANCE_MYSQL_OPERATION: operation,
      },
    });
    const lease = context.issuePortableChild({ childPid: child.pid, childStartedAt });
    writeFileSync(leasePath, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
    const entry = { child, context, childStartedAt, mode, operation, stdout: '', stderr: '' };
    child.stdout.on('data', (chunk) => { entry.stdout += chunk; });
    child.stderr.on('data', (chunk) => { entry.stderr += chunk; });
    children.push(entry);
    return entry;
  };
  const finishChild = async (entry) => {
    const code = await waitForExit(entry.child);
    await Promise.all([entry.child.stdout, entry.child.stderr]
      .filter(Boolean).map((stream) => finished(stream, { cleanup: true }).catch(() => {})));
    entry.context.markChildExited(entry.child.pid, entry.childStartedAt);
    if (code !== 0) {
      throw createChildFailureError({
        exitCode: code ?? entry.child.signalCode ?? 'UNKNOWN', mode: entry.mode, operation: entry.operation,
        stdout: entry.stdout, stderr: entry.stderr,
      }, { evidenceRoot: join(resolve(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate'), 'evidence'), runId, childPid: entry.child.pid });
    }
    return entry.stdout;
  };

  const report = await runFinanceMySqlLifecycle({
    consumeRoot: async () => {
      rootLease = consumeAck4Record({
        issuedPath: resolve(capabilityPath), consumedDir: join(storeRoot, 'consumed'), decrypt: decryptDpapi,
        expected: { runId, commitSha, manifest, operations, target, sid: process.env.USER_SID || process.env.USERNAME },
        rootPid: process.pid, rootStartedAt: new Date().toISOString(),
      });
      return rootLease;
    }, expected, quarantineDir,
    reset: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'RESET_SCHEMA_PRE_RUN' })),
    bootstrap: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'BOOTSTRAP_CURRENT_SCHEMA' })),
    runRaces: async (context) => {
      const suite = await spawnRegistered(context, { mode: 'races', operation: 'RUN_FINANCE_RACES' });
      await finishChild(suite);
      return { passed: true };
    },
    stopChildren: async () => {
      for (const entry of children) if (!hasExited(entry.child)) entry.child.kill('SIGTERM');
      for (const entry of children) {
        if (!hasExited(entry.child)) await waitForExit(entry.child);
        try { entry.context.markChildExited(entry.child.pid, entry.childStartedAt); } catch { /* already exited */ }
      }
      return children.every((entry) => hasExited(entry.child));
    },
    cleanup: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'CLEANUP_SCHEMA_POST_RUN' })),
    verifyCleanup: async () => {
      const postflight = spawn(process.execPath, [join(repoRoot, 'scripts/gates/mysql-finance-child.mjs'), '--mode', 'postflight'], {
        cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ERP_FINANCE_MYSQL_TARGET_PROOF: targetPath, ERP_FINANCE_MYSQL_COMMIT_SHA: commitSha, ERP_FINANCE_MYSQL_ROOT_PID: String(process.pid) },
      });
      let stdout = ''; let stderr = '';
      postflight.stdout.on('data', (chunk) => { stdout += chunk; });
      postflight.stderr.on('data', (chunk) => { stderr += chunk; });
      const code = await waitForExit(postflight);
      if (code !== 0) return { clean: false, inventory: [`POSTFLIGHT_EXIT_${code}`] };
      const line = stdout.trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
      const result = line ? JSON.parse(line) : null;
      if (result?.operation !== 'POSTFLIGHT' || !result?.inventory) return { clean: false, inventory: ['POSTFLIGHT_UNVERIFIED'] };
      const inventory = Object.entries(result.inventory).filter(([, count]) => count !== 0).map(([kind, count]) => `${kind}=${count}`);
      return { clean: inventory.length === 0, inventory };
    },
  });
  process.stdout.write(`${JSON.stringify({ ...report, suites: registeredSuites, executionStatus: 'EXECUTED_NOT_ACCEPTED' })}\n`);
}

try {
  await main();
} catch (error) {
  if (error?.financeMySqlLifecycle) process.stdout.write(`${JSON.stringify({ ...error.financeMySqlLifecycle, executionStatus: 'EXECUTED_NOT_ACCEPTED' })}\n`);
  throw error;
}
