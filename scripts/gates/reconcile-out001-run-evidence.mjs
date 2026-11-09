#!/usr/bin/env node
// Offline-only forensic reconciliation. This module deliberately imports no DB adapter.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteOut001Evidence, out001RootEvidencePaths } from './mysql-out001-root-evidence.mjs';
import { out001EvidenceRoot, parseOut001TapSummary } from './mysql-out001-evidence.mjs';
import { OUT_001_EXPECTED_HTTP_APP_COUNT, readWindowsProcessIdentity } from './mysql-out001-descendant-registry.mjs';

export const OUT_001_RECONCILIATION_VERSION = 1;
const OPERATIONS = Object.freeze([
  ['reset', 'operation-RESET_SCHEMA_PRE_RUN', 'RESET_SCHEMA_PRE_RUN'],
  ['bootstrap', 'operation-BOOTSTRAP_CURRENT_SCHEMA', 'BOOTSTRAP_CURRENT_SCHEMA'],
  ['suite', 'suite-RUN_OUT001_HTTP_FIXTURES', 'RUN_OUT001_HTTP_FIXTURES'],
  ['cleanup', 'operation-CLEANUP_SCHEMA_POST_RUN', 'CLEANUP_SCHEMA_POST_RUN'],
  ['postflight', 'postflight-POSTFLIGHT', 'POSTFLIGHT'],
]);
const HISTORICAL = Object.freeze({
  runId: '0adfecb6-7db9-4015-9c41-cc36ad42ec48',
  launcherStdoutSha256: '8580c507442214523f3e8910b1a4d4880d25ce13cab4ad6f4dd35beb27993a35',
  launcherResultSha256: '81c7b5c9d02ab7209f989a7bec76e4aa18c632dedc0cde1e1deb49e4a805e813',
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fileProof(path) {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: sha(bytes) };
}
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function finalJson(text) {
  const line = String(text).trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
  return line ? JSON.parse(line) : null;
}
function fiveZero(inventory) {
  return ['tables', 'views', 'triggers', 'routines', 'events'].every((key) => inventory?.[key] === 0);
}

function verifySuiteEvidence(evidenceRoot, runId, [name, label, operation]) {
  const dir = join(evidenceRoot, 'suites', label);
  const paths = { result: join(dir, 'result.json'), stdout: join(dir, 'stdout.tap'), stderr: join(dir, 'stderr.log') };
  const result = json(paths.result);
  const stdoutProof = fileProof(paths.stdout);
  const stderrProof = fileProof(paths.stderr);
  const resultProof = fileProof(paths.result);
  const integrity = result?.runId === runId && result?.operation === operation && result.exitCode === 0 && result.failure === null
    && Array.isArray(result.streamErrors) && result.streamErrors.length === 0
    && result.stdout?.bytes === stdoutProof.bytes && result.stdout?.sha256 === stdoutProof.sha256
    && result.stderr?.bytes === stderrProof.bytes && result.stderr?.sha256 === stderrProof.sha256;
  if (!integrity) throw new Error(`OUT_001_RECONCILIATION_EVIDENCE_INVALID:${operation}`);
  const stdout = readFileSync(paths.stdout, 'utf8');
  let business;
  if (name === 'suite') {
    const tap = parseOut001TapSummary(stdout);
    const markers = Object.fromEntries(['M1 ', 'M1b ', 'M2 ', 'M3 ', 'M4 ', 'M5 ']
      .map((marker) => [marker.trim(), new RegExp(`^\\s*ok \\d+ - ${marker}`, 'm').test(stdout)]));
    business = { tap, markers, passed: tap?.tests === 34 && tap.passed === 34 && tap.failed === 0
      && tap.cancelled === 0 && tap.skipped === 0 && tap.todo === 0 && Object.values(markers).every(Boolean) };
  } else {
    const parsed = finalJson(stdout);
    business = { parsed, passed: name === 'reset' ? parsed?.dropped === 0 && fiveZero(parsed.inventory)
      : name === 'bootstrap' ? parsed?.bootstrapped === true
        : name === 'cleanup' ? parsed?.dropped === 331
          : name === 'postflight' ? fiveZero(parsed?.inventory) : false };
  }
  if (!business.passed) throw new Error(`OUT_001_RECONCILIATION_BUSINESS_INVALID:${operation}`);
  return { name, operation, integrity: true, files: { result: resultProof, stdout: stdoutProof, stderr: stderrProof }, business };
}

async function processProof(runId, commitSha, localAppData) {
  const childRoot = join(localAppData, 'ModernERP', 'mysql-gate', 'ack4', 'children', runId);
  const consumedDir = join(childRoot, 'consumed');
  const { readdirSync } = await import('node:fs');
  const leaseFiles = readdirSync(consumedDir).filter((file) => file.endsWith('.consumed.json')).sort();
  if (leaseFiles.length !== 4) throw new Error('OUT_001_RECONCILIATION_CHILD_LEASE_COUNT_INVALID');
  const leases = leaseFiles.map((file) => json(join(consumedDir, file)));
  const expected = ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_OUT001_HTTP_FIXTURES', 'CLEANUP_SCHEMA_POST_RUN'];
  if (leases.some((lease) => lease.runId !== runId || lease.commitSha !== commitSha
      || lease.manifest !== 'OUT_001_MYSQL_V1' || !Number.isSafeInteger(lease.rootPid)
      || !Number.isSafeInteger(lease.childPid) || !lease.childStartedAt || !expected.includes(lease.operation))
      || new Set(leases.map((lease) => lease.operation)).size !== 4) {
    throw new Error('OUT_001_RECONCILIATION_CHILD_LEASE_INVALID');
  }
  const descendantPath = join(childRoot, 'descendants', `${runId}.jsonl`);
  const descendants = readFileSync(descendantPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  if (descendants.length !== OUT_001_EXPECTED_HTTP_APP_COUNT || descendants.some((item) => item.runId !== runId || !Number.isSafeInteger(item.pid)
      || !item.processCreatedAt || item.purpose !== 'OUT001_HTTP_APP')) {
    throw new Error('OUT_001_RECONCILIATION_DESCENDANTS_INVALID');
  }
  const identities = [];
  for (const record of [...leases.map((item) => ({ pid: item.childPid, processCreatedAt: item.childStartedAt })), ...descendants]) {
    let current = null;
    let query = 'UNAVAILABLE';
    try { current = await readWindowsProcessIdentity(record.pid); query = 'QUERIED'; } catch {}
    if (current?.processCreatedAt === record.processCreatedAt) throw new Error('OUT_001_RECONCILIATION_PROCESS_STILL_RUNNING');
    identities.push({ ...record, currentIdentity: current, historicalExitStatus: 'REPORTED_NOT_REVERIFIED', query });
  }
  return { leases: leases.map(({ runId: id, rootPid, childPid, childStartedAt, operation }) => ({ runId: id, rootPid, childPid, childStartedAt, operation })), descendants, identities };
}

export async function reconcileOut001RunEvidence({ runId, commitSha, localAppData = process.env.LOCALAPPDATA, write = true }) {
  const evidenceRoot = out001EvidenceRoot(runId, { localAppData });
  const paths = out001RootEvidencePaths(runId, { localAppData });
  const groups = OPERATIONS.map((entry) => verifySuiteEvidence(evidenceRoot, runId, entry));
  const processes = await processProof(runId, commitSha, localAppData);
  const launcher = {
    stdout: fileProof(join(evidenceRoot, 'launcher.stdout.log')),
    result: fileProof(join(evidenceRoot, 'launcher-result.json')),
  };
  launcher.expected = runId === HISTORICAL.runId ? HISTORICAL : null;
  launcher.matchesExpected = !launcher.expected || (launcher.stdout.sha256 === launcher.expected.launcherStdoutSha256
    && launcher.result.sha256 === launcher.expected.launcherResultSha256);
  if (!launcher.matchesExpected) throw new Error('OUT_001_RECONCILIATION_LAUNCHER_HASH_INVALID');
  const originalRootReportPresent = existsSync(paths.report);
  const report = {
    version: OUT_001_RECONCILIATION_VERSION, status: 'RECONSTRUCTED_NOT_ORIGINAL', runId, commitSha,
    manifest: 'OUT_001_MYSQL_V1', originalRootReportPresent, groups, processes, launcher,
    inferred: { state: 'FINISHED', testsPassed: true, cleanupProven: true, childrenExited: 'REPORTED_NOT_REVERIFIED' },
    unproven: ['original root-report.json was not persisted', 'historical process exits cannot be independently reverified without risking PID reuse'],
    executionStatus: 'EXECUTED_NOT_ACCEPTED', createdAt: new Date().toISOString(),
  };
  if (originalRootReportPresent) report.unproven = report.unproven.filter((item) => !item.startsWith('original'));
  if (write) atomicWriteOut001Evidence(paths.reconciliation, Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  return report;
}

async function cli() {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const report = await reconcileOut001RunEvidence({ runId: arg('--run-id'), commitSha: arg('--commit-sha') });
  process.stdout.write(`${JSON.stringify({ status: report.status, path: out001RootEvidencePaths(report.runId).reconciliation })}\n`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
