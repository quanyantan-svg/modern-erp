#!/usr/bin/env node
// Explicit ACK-4 recovery for an OUT-001 CLEANUP_UNVERIFIED quarantine.
// It cannot run the business suite or bootstrap. A fresh, exact recovery
// capability is consumed only after the old process tree is proven gone.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACK4_RECOVERY_MANIFEST, ack4QuarantineMarkerPath, beginAck4RootOperation, consumeAck4Record,
  issuePortableChildLease, recoverAck4Quarantine,
} from './ack4/ack4-runtime.mjs';
import { OUT_001_EXPECTED_HTTP_APP_COUNT, readWindowsProcessIdentity } from './mysql-out001-descendant-registry.mjs';
import { collectOut001Child, ensureOut001ChildExited, out001ChildEnvironment, parseOut001OperationOutput,
  parseOut001PostflightOutput, OUT_001_CHILD_TIMEOUT_MS } from './mysql-out001-process-lifecycle.mjs';
import { createOut001EvidenceWriter } from './mysql-out001-evidence.mjs';
import { persistOut001RootEvidence } from './mysql-out001-root-evidence.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = 'ACK4_RECOVERY_V1';
const arg = (key) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? null : process.argv[index + 1];
};
const required = (key) => {
  const value = arg(key);
  if (!value) throw new Error(`OUT_001_RECOVERY_REQUIRED:${key}`);
  return value;
};
const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();

function decryptDpapi(bytes) {
  const encoded = bytes.toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue;',
    `$c=[Convert]::FromBase64String('${encoded}');`,
    '$p=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new();[Console]::Write([Text.Encoding]::UTF8.GetString($p));',
  ].join('');
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true }));
}

export async function assertOldTreeExited(marker, store, readIdentity = readWindowsProcessIdentity) {
  if (marker?.state !== 'CLEANUP_UNVERIFIED'
    || !Number.isSafeInteger(marker.rootPid) || marker.rootPid <= 0
    || typeof marker.rootStartedAt !== 'string' || !Array.isArray(marker.children)) {
    throw new Error('OUT_001_RECOVERY_MARKER_PROCESS_PROOF_MISSING');
  }
  const processes = [
    { pid: marker.rootPid, createdAt: marker.rootStartedAt },
    ...marker.children.map((child) => ({ pid: child.childPid, createdAt: child.childStartedAt })),
  ];
  if (marker.children.some((child) => child.operation === 'RUN_OUT001_HTTP_FIXTURES')) {
    const registry = join(store, 'children', marker.runId, 'descendants', `${marker.runId}.jsonl`);
    if (!existsSync(registry)) throw new Error('OUT_001_RECOVERY_DESCENDANT_PROOF_MISSING');
    const lines = readFileSync(registry, 'utf8').trim().split(/\r?\n/);
    if (lines.length !== OUT_001_EXPECTED_HTTP_APP_COUNT) throw new Error('OUT_001_RECOVERY_DESCENDANT_PROOF_INCOMPLETE');
    for (const line of lines) {
      const item = JSON.parse(line);
      if (item.runId !== marker.runId || item.purpose !== 'OUT001_HTTP_APP') {
        throw new Error('OUT_001_RECOVERY_DESCENDANT_SCOPE_INVALID');
      }
      processes.push({ pid: item.pid, createdAt: item.processCreatedAt });
    }
  }
  for (const entry of processes) {
    if (!Number.isSafeInteger(entry.pid) || !Number.isFinite(Date.parse(entry.createdAt))) {
      throw new Error('OUT_001_RECOVERY_MARKER_PROCESS_PROOF_INVALID');
    }
    const active = await readIdentity(entry.pid);
    if (active && active.processCreatedAt === entry.createdAt) {
      throw new Error('OUT_001_RECOVERY_OLD_PROCESS_STILL_ACTIVE');
    }
  }
}

async function childRun({ runId, rootLease, targetPath, childDir, operation, mode, evidence }) {
  const leasePath = join(childDir, `${operation}.lease.json`);
  const readyPath = join(childDir, `${operation}.ready`);
  const child = spawn(process.execPath, [join(repoRoot, 'scripts/gates/mysql-out001-child.mjs'), '--mode', mode], {
    cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...out001ChildEnvironment(process.env, mode),
      ERP_OUT_001_ACK4_CHILD_LEASE: leasePath,
      ERP_OUT_001_ACK4_CHILD_CONSUMED_DIR: join(childDir, 'consumed'),
      ERP_OUT_001_ACK4_ROOT_PUBLIC_KEY: rootLease.childLeasePublicKey,
      ERP_OUT_001_ROOT_PID: String(process.pid),
      ERP_OUT_001_COMMIT_SHA: rootLease.commitSha,
      ERP_OUT_001_TARGET_PROOF: targetPath,
      ERP_OUT_001_MANIFEST: manifest,
      ERP_OUT_001_OPERATION: operation,
      ERP_OUT_001_POSTFLIGHT_READY: readyPath,
    },
  });
  evidence.attach(child);
  const identity = await readWindowsProcessIdentity(child.pid);
  if (!identity) { child.kill(); throw new Error('OUT_001_RECOVERY_CHILD_IDENTITY_UNVERIFIED'); }
  if (mode === 'operation') {
    const lease = issuePortableChildLease(rootLease, {
      childPid: child.pid, childStartedAt: identity.processCreatedAt, operation,
    });
    writeFileSync(leasePath, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
  } else {
    writeFileSync(readyPath, '', { flag: 'wx', mode: 0o600 });
  }
  let code = null;
  let failure = null;
  try { code = await collectOut001Child({ child, mode, operation }, { timeoutMs: OUT_001_CHILD_TIMEOUT_MS[operation] }); }
  catch (error) { failure = error; }
  const persisted = await evidence.finalize({ exitCode: code, failure });
  const exited = await ensureOut001ChildExited({ child, mode, operation });
  const active = await readWindowsProcessIdentity(child.pid);
  const provenExited = exited && (!active || active.processCreatedAt !== identity.processCreatedAt);
  if (failure || code !== 0 || !provenExited) {
    throw new Error(`OUT_001_RECOVERY_CHILD_UNVERIFIED:${operation}:${failure?.code || code}`);
  }
  return { persisted, stdout: readFileSync(persisted.stdoutPath, 'utf8'),
    child: { childPid: child.pid, childStartedAt: identity.processCreatedAt,
      operation, exited: true, exitCode: code } };
}

async function main() {
  const runId = required('--run-id');
  const capabilityPath = resolve(required('--ack4-capability'));
  const targetPath = resolve(required('--target-proof'));
  const commitSha = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain'])) throw new Error('OUT_001_RECOVERY_WORKTREE_NOT_CLEAN');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
  const store = resolve(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate', 'ack4');
  const quarantineDir = join(store, 'quarantine');
  const markerPath = ack4QuarantineMarkerPath(quarantineDir, target);
  if (!existsSync(markerPath)) throw new Error('OUT_001_RECOVERY_QUARANTINE_MISSING');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.runId === runId || marker.manifest !== 'OUT_001_MYSQL_V1') {
    throw new Error('OUT_001_RECOVERY_MARKER_SCOPE_INVALID');
  }
  await assertOldTreeExited(marker, store);
  const { openOut001MySqlAdapter } = await import('../../server/test-utils/mysql-out001-target.js');
  const readOnly = openOut001MySqlAdapter({ targetProofPath: targetPath });
  readOnly.db.close();
  const rootIdentity = await readWindowsProcessIdentity(process.pid);
  if (!rootIdentity) throw new Error('OUT_001_RECOVERY_ROOT_IDENTITY_UNVERIFIED');
  const rootLease = consumeAck4Record({
    issuedPath: capabilityPath, consumedDir: join(store, 'consumed'), decrypt: decryptDpapi,
    expected: { runId, commitSha, target, manifest, operations: ACK4_RECOVERY_MANIFEST,
      sid: process.env.USER_SID || process.env.USERNAME },
    rootPid: process.pid, rootStartedAt: rootIdentity.processCreatedAt,
  });
  const childDir = join(store, 'children', runId);
  mkdirSync(childDir, { recursive: true });
  const evidence = [];
  const children = [];
  let cleanupProven = false;
  try {
    const expected = { commitSha, target, manifest };
    beginAck4RootOperation(rootLease, 'INSPECT_QUARANTINE', expected);
    beginAck4RootOperation(rootLease, 'CLEANUP_SCHEMA_RECOVERY', expected);
    const cleanupWriter = createOut001EvidenceWriter({ runId, label: 'recovery-CLEANUP_SCHEMA_RECOVERY',
      operation: 'CLEANUP_SCHEMA_RECOVERY', secrets: [process.env.ERP_DB_PASSWORD] });
    const cleanup = await childRun({ runId, rootLease, targetPath, childDir,
      operation: 'CLEANUP_SCHEMA_RECOVERY', mode: 'operation', evidence: cleanupWriter });
    evidence.push(cleanup.persisted); children.push(cleanup.child);
    parseOut001OperationOutput(cleanup.stdout, 'CLEANUP_SCHEMA_RECOVERY');
    const postWriter = createOut001EvidenceWriter({ runId, label: 'recovery-POSTFLIGHT',
      operation: 'POSTFLIGHT', secrets: [process.env.ERP_DB_PASSWORD] });
    const postflight = await childRun({ runId, rootLease, targetPath, childDir,
      operation: 'POSTFLIGHT', mode: 'postflight', evidence: postWriter });
    evidence.push(postflight.persisted); children.push(postflight.child);
    const inventory = parseOut001PostflightOutput(postflight.stdout)?.inventory;
    cleanupProven = inventory && Object.values(inventory).every((count) => count === 0);
    if (!cleanupProven) throw new Error('OUT_001_RECOVERY_POSTFLIGHT_NONEMPTY');
    const result = recoverAck4Quarantine(rootLease, { quarantineDir, target,
      cleanupProven: true, childrenExited: true });
    persistOut001RootEvidence({ report: { runId, commitSha, manifest, state: 'FINISHED',
      testsPassed: true, cleanupProven: true, childrenExited: true, cleanupAttempts: 1,
      childCount: children.length, children, resetStarted: false, resetCompleted: false,
      suites: [], evidence, executionStatus: 'RECOVERY_EXECUTED' },
    secrets: [process.env.ERP_DB_PASSWORD] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    rootLease.state = 'CLEANUP_UNVERIFIED';
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 8;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
