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
import { openM1CoreG07ExistingAdapter } from '../../server/test-utils/m1-core-g07-existing-adapter.js';
import { changeValuationMethod, receiveValue } from '../../server/modules/financial-inventory.js';
import { postCanonicalTrackedLeg } from '../../server/modules/traceability-quality.js';
import { assertM1CoreG07StaticPreflight } from './m1-core-g07-static-preflight.mjs';

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

// Seeded M1-P-03 test identities. These usernames/passwords are the disposable
// SQLite/MySQL test identities, not production credentials; they mirror
// server/db.js seed and server/test-support/procurement-http-fixture.js.
const SUBJECT_CREDENTIALS = Object.freeze({
  admin: { username: 'admin', password: 'admin123' },
  creator: { username: 'sales', password: 'sales123' },
  approver: { username: 'reviewer', password: 'review123' },
  warehouse: { username: 'warehouse', password: 'warehouse123' },
  outsourcing: { username: 'outsourcing', password: 'outsourcing123' },
  receiving: { username: 'outsourcingreceiving', password: 'outsourcingreceiving123' },
});

async function loginSubject(baseUrl, subject) {
  const credentials = SUBJECT_CREDENTIALS[subject];
  if (!credentials) throw new Error(`M1_G07_SUBJECT_UNKNOWN:${subject}`);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  if (response.status !== 200) throw new Error(`M1_G07_SUBJECT_LOGIN_FAILED:${subject}:http ${response.status}`);
  const data = await response.json();
  if (!data?.token) throw new Error(`M1_G07_SUBJECT_TOKEN_MISSING:${subject}`);
  return data.token;
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
  assertM1CoreG07StaticPreflight({ target, environment: process.env, subjectCredentials: SUBJECT_CREDENTIALS });
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
      // Obtain a real token for every subject through the production login
      // flow. The two app processes share one disposable DB, so tokens issued
      // by app A are valid for app B.
      const subjectTokens = {};
      for (const subject of Object.keys(SUBJECT_CREDENTIALS)) {
        subjectTokens[subject] = await loginSubject(applications.A, subject);
      }
      const l2 = openM1CoreG07ExistingAdapter({ targetProofPath: targetPath });
      let fixtureManifest;
      try {
        fixtureManifest = await buildM1CoreG07HttpFixtures({ applications, subjectTokens, request: async (baseUrl, step) => {
          const response = await fetch(baseUrl + step.path, {
            method: step.method,
            headers: { authorization: `Bearer ${step.token}`, ...(step.body === undefined ? {} : { 'content-type': 'application/json' }), ...step.headers },
            body: step.body === undefined ? undefined : JSON.stringify(step.body),
          });
          return { status: response.status, data: await response.json().catch(() => ({})) };
        }, admitTechnicalL2: async ({ prerequisite, input }) => {
          if (prerequisite !== 'SOURCE_INVENTORY_SEED') throw new Error(`M1_G07_TECHNICAL_L2_NOT_ADMITTED:${prerequisite}`);
          const transaction = l2.db.prepare("SELECT id FROM inventory_transactions WHERE source_type='OTHER_RECEIPT' AND source_id=? AND direction='IN'").get(input.sourceId);
          if (!transaction?.id) throw new Error('M1_G07_SOURCE_INVENTORY_HTTP_EVIDENCE_MISSING');
          postCanonicalTrackedLeg(l2.db, {
            transactionId: transaction.id, sourceType: 'OTHER_RECEIPT', sourceId: input.sourceId,
            sourceItemId: input.sourceId, productId: input.productId, warehouseId: input.warehouseId,
            lotId: input.lotId, serialId: null, quantity: input.quantity, direction: 'IN', businessDate: input.businessDate,
          });
          changeValuationMethod(l2.db, input.productId, 'LOT_SPECIFIC_POOL');
          receiveValue(l2.db, {
            ...input, serialId: null, movementType: 'G07_SOURCE_INVENTORY_L2', sourceType: 'OTHER_RECEIPT',
            sourceItemId: input.sourceId, inventoryTransactionId: transaction.id, valuationBasis: 'G07_DISPOSABLE_L2',
          });
          const balance = l2.db.prepare('SELECT quantity,value_cents FROM inventory_valuation_balances WHERE product_id=? AND warehouse_id=? AND lot_id=?').get(input.productId, input.warehouseId, input.lotId);
          if (Number(balance?.quantity) !== input.quantity || Number(balance?.value_cents) !== input.valueCents) throw new Error('M1_G07_SOURCE_INVENTORY_L2_EVIDENCE_MISMATCH');
          return Object.freeze({ prerequisite, admitted: true, quantity: Number(balance.quantity), valueCents: Number(balance.value_cents), lotId: input.lotId, sourceId: input.sourceId });
        } });
      } finally {
        l2.db.close();
      }
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

try {
  await main();
} catch (error) {
  if (error?.m1G07Lifecycle) process.stdout.write(`${JSON.stringify({ ...error.m1G07Lifecycle, executionStatus: 'EXECUTED_NOT_ACCEPTED' })}\n`);
  throw error;
}
