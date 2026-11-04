// M1-Core G07 root orchestrator. Only read-only preflight occurs before the
// one-time ACK-4 capability is atomically consumed.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertNoAck4Quarantine, consumeAck4Record, M1_CORE_MANIFEST } from './ack4/ack4-runtime.mjs';
import { hasExited, waitForExit } from './m1-core-g07-child-lifecycle.mjs';
import { runM1CoreG07Lifecycle } from './m1-core-g07-root-lifecycle.mjs';
import { buildM1CoreG07HttpFixtures } from '../../server/test-support/m1-core-g07-http-fixture-builder.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = 'M1_CORE_G07_V1';
const registeredSuites = Object.freeze(['server/mysql-m1-core-g07.integration.js']);

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

async function waitForHttp(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (hasExited(child)) throw new Error(`M1_G07_APP_EXITED:${child.exitCode ?? child.signalCode}`);
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.status < 500) return; } catch {}
    await delay(50);
  }
  throw new Error(`M1_G07_APP_START_TIMEOUT:${baseUrl}`);
}

async function main() {
  const runId = requiredArgument('--run-id');
  const capabilityPath = requiredArgument('--ack4-capability');
  const targetPath = resolve(requiredArgument('--target-proof'));
  const portA = Number(requiredArgument('--app-port-a'));
  const portB = Number(requiredArgument('--app-port-b'));
  if (![portA, portB].every((port) => Number.isSafeInteger(port) && port >= 1024 && port <= 65535) || portA === portB) throw new Error('M1_G07_APP_PORTS_INVALID');

  const commitSha = gitText(['rev-parse', 'HEAD']);
  if (gitText(['status', '--porcelain'])) throw new Error('ACK-4 BLOCKED: the Git worktree must be clean');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
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
    const child = spawn(process.execPath, [join(repoRoot, 'scripts/gates/m1-core-g07-child.mjs'), '--mode', mode], {
      cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...process.env, ...extraEnv, ERP_M1_G07_ACK4_CHILD_LEASE: leasePath,
        ERP_M1_G07_ACK4_CHILD_CONSUMED_DIR: join(childDir, 'consumed'),
        ERP_M1_G07_ACK4_ROOT_PUBLIC_KEY: rootLease.childLeasePublicKey,
        ERP_M1_G07_ROOT_PID: String(process.pid), ERP_M1_G07_CHILD_STARTED_AT: childStartedAt,
        ERP_M1_G07_COMMIT_SHA: commitSha, ERP_M1_G07_TARGET_PROOF: targetPath, ERP_M1_G07_OPERATION: operation,
      },
    });
    const lease = context.issuePortableChild({ childPid: child.pid, childStartedAt });
    writeFileSync(leasePath, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
    const entry = { child, context, childStartedAt, stdout: '', stderr: '' };
    child.stdout.on('data', (chunk) => { entry.stdout += chunk; });
    child.stderr.on('data', (chunk) => { entry.stderr += chunk; });
    children.push(entry);
    return entry;
  };
  const finishChild = async (entry) => {
    const code = await waitForExit(entry.child);
    entry.context.markChildExited(entry.child.pid, entry.childStartedAt);
    if (code !== 0) throw new Error(`M1_G07_CHILD_FAILED:${code}:${entry.stderr}`);
    return entry.stdout;
  };

  const report = await runM1CoreG07Lifecycle({
    consumeRoot: async () => {
      rootLease = consumeAck4Record({
        issuedPath: resolve(capabilityPath), consumedDir: join(storeRoot, 'consumed'), decrypt: decryptDpapi,
        expected: { runId, commitSha, manifest, operations: M1_CORE_MANIFEST, target, sid: process.env.USER_SID || process.env.USERNAME },
        rootPid: process.pid, rootStartedAt: new Date().toISOString(),
      });
      return rootLease;
    }, expected, quarantineDir,
    reset: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'RESET_SCHEMA_PRE_RUN' })),
    bootstrap: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'BOOTSTRAP_CURRENT_SCHEMA' })),
    runHttpFixtures: async (context) => {
      const appA = await spawnRegistered(context, { mode: 'app', operation: 'RUN_M1_HTTP_FIXTURES', extraEnv: { PORT: String(portA) } });
      const appB = await spawnRegistered(context, { mode: 'app', operation: 'RUN_M1_HTTP_FIXTURES', extraEnv: { PORT: String(portB) } });
      const applications = { A: `http://127.0.0.1:${portA}`, B: `http://127.0.0.1:${portB}` };
      await Promise.all([waitForHttp(applications.A, appA.child), waitForHttp(applications.B, appB.child)]);
      const fixtureManifest = await buildM1CoreG07HttpFixtures({ applications, request: async (baseUrl, step) => {
        const response = await fetch(baseUrl + step.path, {
          method: step.method, headers: { authorization: `Bearer ${step.token}`, 'content-type': 'application/json', ...step.headers },
          body: JSON.stringify(step.body),
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      } });
      const fixtureManifestPath = join(childDir, 'fixture-manifest.json');
      writeFileSync(fixtureManifestPath, JSON.stringify(fixtureManifest), { flag: 'wx', mode: 0o600 });
      try {
        const suite = await spawnRegistered(context, { mode: 'suite', operation: 'RUN_M1_HTTP_FIXTURES', extraEnv: { ERP_M1_G07_FIXTURE_MANIFEST: fixtureManifestPath } });
        await finishChild(suite);
      } finally { rmSync(fixtureManifestPath, { force: true }); }
      return { passed: true };
    },
    stopChildren: async () => {
      for (const entry of children) if (!hasExited(entry.child)) entry.child.kill('SIGTERM');
      for (const entry of children) {
        if (!hasExited(entry.child)) await waitForExit(entry.child);
        try { entry.context.markChildExited(entry.child.pid, entry.childStartedAt); } catch {}
      }
      return children.every((entry) => hasExited(entry.child));
    },
    cleanup: async (context) => finishChild(await spawnRegistered(context, { mode: 'operation', operation: 'CLEANUP_SCHEMA_POST_RUN' })),
    verifyCleanup: async () => {
      const postflight = spawn(process.execPath, [join(repoRoot, 'scripts/gates/m1-core-g07-child.mjs'), '--mode', 'postflight'], {
        cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ERP_M1_G07_TARGET_PROOF: targetPath, ERP_M1_G07_COMMIT_SHA: commitSha, ERP_M1_G07_ROOT_PID: String(process.pid) },
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

await main();
