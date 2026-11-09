import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { out001EvidenceRoot, redactOut001EvidenceBytes } from './mysql-out001-evidence.mjs';

export const OUT_001_ROOT_EVIDENCE_VERSION = 1;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function required(value, code) { if (!value) throw new Error(code); return value; }

export function out001RootEvidencePaths(runId, options = {}) {
  const root = out001EvidenceRoot(runId, options);
  const dir = join(root, 'root');
  return Object.freeze({
    root, dir,
    report: join(dir, 'root-report.json'),
    manifest: join(dir, 'root-manifest.json'),
    launcherResult: join(dir, 'launcher-result.json'),
    launcherManifest: join(dir, 'launcher-manifest.json'),
    reconciliation: join(dir, 'root-reconciliation.json'),
  });
}

export function atomicWriteOut001Evidence(path, bytes) {
  if (existsSync(path)) throw new Error('OUT_001_ROOT_EVIDENCE_OVERWRITE_REFUSED');
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = openSync(temporary, 'wx', 0o600);
    writeSync(handle, bytes);
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    if (existsSync(path)) throw new Error('OUT_001_ROOT_EVIDENCE_OVERWRITE_REFUSED');
    renameSync(temporary, path);
  } catch (error) {
    if (handle !== undefined) try { closeSync(handle); } catch {}
    try { rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function assertRootReport(report, expected = {}) {
  if (!report || report.version !== OUT_001_ROOT_EVIDENCE_VERSION) throw new Error('OUT_001_ROOT_REPORT_VERSION_INVALID');
  if (!RUN_ID.test(String(report.runId || ''))) throw new Error('OUT_001_ROOT_REPORT_RUN_ID_INVALID');
  if (!SHA.test(String(report.commitSha || ''))) throw new Error('OUT_001_ROOT_REPORT_SHA_INVALID');
  if (!['FINISHED', 'FAILED', 'CLEANUP_UNVERIFIED'].includes(report.state)) throw new Error('OUT_001_ROOT_REPORT_STATE_INVALID');
  if (typeof report.manifest !== 'string' || !report.manifest) throw new Error('OUT_001_ROOT_REPORT_MANIFEST_INVALID');
  if (report.runId !== expected.runId && expected.runId) throw new Error('OUT_001_ROOT_REPORT_RUN_ID_MISMATCH');
  if (report.commitSha !== expected.commitSha && expected.commitSha) throw new Error('OUT_001_ROOT_REPORT_SHA_MISMATCH');
  if (report.manifest !== expected.manifest && expected.manifest) throw new Error('OUT_001_ROOT_REPORT_MANIFEST_MISMATCH');
  for (const field of ['testsPassed', 'cleanupProven', 'childrenExited']) {
    if (typeof report[field] !== 'boolean') throw new Error(`OUT_001_ROOT_REPORT_FIELD_INVALID:${field}`);
  }
  if (!Number.isSafeInteger(report.cleanupAttempts) || report.cleanupAttempts < 0
      || !Number.isSafeInteger(report.childCount) || report.childCount < 0
      || !Array.isArray(report.children) || report.children.length !== report.childCount
      || !Array.isArray(report.suites) || !Array.isArray(report.evidence)
      || typeof report.executionStatus !== 'string' || !report.executionStatus) {
    throw new Error('OUT_001_ROOT_REPORT_FIELDS_INVALID');
  }
  for (const child of report.children) {
    if (!Number.isSafeInteger(child?.childPid) || child.childPid <= 0
        || typeof child?.childStartedAt !== 'string' || !child.childStartedAt
        || typeof child?.operation !== 'string' || typeof child?.exited !== 'boolean'
        || (child.exitCode !== null && !Number.isSafeInteger(child.exitCode))) {
      throw new Error('OUT_001_ROOT_REPORT_CHILD_INVALID');
    }
  }
  return report;
}

export function persistOut001RootEvidence({ report, secrets = [], options = {} }) {
  const paths = out001RootEvidencePaths(report?.runId, options);
  if (existsSync(paths.report) || existsSync(paths.manifest)) throw new Error('OUT_001_ROOT_EVIDENCE_OVERWRITE_REFUSED');
  const normalized = { version: OUT_001_ROOT_EVIDENCE_VERSION, ...report, createdAt: new Date().toISOString() };
  assertRootReport(normalized);
  const redacted = redactOut001EvidenceBytes(`${JSON.stringify(normalized, null, 2)}\n`, secrets);
  const persisted = JSON.parse(redacted.buffer.toString('utf8'));
  assertRootReport(persisted, { runId: report.runId, commitSha: report.commitSha, manifest: report.manifest });
  atomicWriteOut001Evidence(paths.report, redacted.buffer);
  const manifest = {
    version: OUT_001_ROOT_EVIDENCE_VERSION,
    runId: persisted.runId,
    commitSha: persisted.commitSha,
    manifest: persisted.manifest,
    reportFile: basename(paths.report),
    reportBytes: redacted.buffer.length,
    reportSha256: sha256(redacted.buffer),
    evidenceCount: persisted.evidence.length,
    createdAt: new Date().toISOString(),
  };
  atomicWriteOut001Evidence(paths.manifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return Object.freeze({ paths, report: persisted, manifest, redactions: redacted.count });
}

export function readAndValidateOut001RootEvidence({ runId, commitSha, manifest, options = {} }) {
  const paths = out001RootEvidencePaths(runId, options);
  let index;
  let report;
  const bytes = readFileSync(paths.report);
  try { index = JSON.parse(readFileSync(paths.manifest, 'utf8')); report = JSON.parse(bytes); }
  catch { throw new Error('OUT_001_ROOT_EVIDENCE_JSON_INVALID'); }
  if (index?.version !== OUT_001_ROOT_EVIDENCE_VERSION || index.runId !== runId
      || index.commitSha !== commitSha || index.manifest !== manifest
      || index.reportFile !== basename(paths.report) || index.reportBytes !== bytes.length
      || !SHA256.test(String(index.reportSha256 || '')) || index.reportSha256 !== sha256(bytes)
      || index.evidenceCount !== report?.evidence?.length) {
    throw new Error('OUT_001_ROOT_MANIFEST_INVALID');
  }
  assertRootReport(report, { runId, commitSha, manifest });
  return Object.freeze({ paths, report, manifest: index });
}

export function rootEvidenceIsPassing(report, gateExitCode) {
  return gateExitCode === 0 && report?.state === 'FINISHED' && report.testsPassed === true
    && report.cleanupProven === true && report.childrenExited === true;
}

export function readAndValidateOut001LauncherEvidence({ runId, commitSha, manifest, options = {} }) {
  const paths = out001RootEvidencePaths(runId, options);
  const bytes = readFileSync(paths.launcherResult);
  let index;
  let result;
  try {
    index = JSON.parse(readFileSync(paths.launcherManifest, 'utf8'));
    result = JSON.parse(bytes);
  } catch { throw new Error('OUT_001_LAUNCHER_EVIDENCE_JSON_INVALID'); }
  if (index?.version !== 1 || index.runId !== runId || index.commitSha !== commitSha
    || index.manifest !== manifest || index.resultFile !== basename(paths.launcherResult)
    || index.resultBytes !== bytes.length || index.resultSha256 !== sha256(bytes)
    || result?.runId !== runId || result.commitSha !== commitSha || result.manifest !== manifest) {
    throw new Error('OUT_001_LAUNCHER_MANIFEST_INVALID');
  }
  if (result.rootEvidenceValid === true) {
    const root = readAndValidateOut001RootEvidence({ runId, commitSha, manifest, options });
    if (result.rootState !== root.report.state) throw new Error('OUT_001_LAUNCHER_ROOT_STATE_MISMATCH');
    const expected = rootEvidenceIsPassing(root.report, result.gateExitCode)
      ? 'PASS' : root.report.state === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
    if (result.result !== expected) throw new Error('OUT_001_LAUNCHER_RESULT_MISMATCH');
  } else if (result.result !== 'BLOCKED') {
    throw new Error('OUT_001_LAUNCHER_UNVERIFIED_ROOT_CANNOT_PASS');
  }
  return Object.freeze({ valid: true, result, manifest: index });
}

async function cli() {
  const value = (name) => process.argv[process.argv.indexOf(name) + 1];
  const input = {
    runId: required(value('--run-id'), 'OUT_001_ROOT_CLI_RUN_ID_REQUIRED'),
    commitSha: required(value('--commit-sha'), 'OUT_001_ROOT_CLI_SHA_REQUIRED'),
    manifest: required(value('--manifest'), 'OUT_001_ROOT_CLI_MANIFEST_REQUIRED'),
  };
  const verified = process.argv.includes('--launcher')
    ? readAndValidateOut001LauncherEvidence(input)
    : readAndValidateOut001RootEvidence(input);
  process.stdout.write(`${JSON.stringify({ valid: true, report: verified.report, manifest: verified.manifest })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 8; });
}
