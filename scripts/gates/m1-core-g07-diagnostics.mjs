// Pure diagnostic helpers for M1C-G07 child failures. This module never
// opens a database and never changes ACK-4, cleanup or quarantine state.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SUMMARY_BEGIN = 'M1_G07_DIAGNOSTIC_SUMMARY_BEGIN';
const SUMMARY_END = 'M1_G07_DIAGNOSTIC_SUMMARY_END';
const REDACTED = '[REDACTED]';

function compact(value, maximum = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
}

export function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/Bearer\s+[^\s,"'}]+/gi, `Bearer ${REDACTED}`)
    .replace(/(mysql:\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`)
    .replace(/((?:ERP_DB_PASSWORD|password|token|authorization|capability|ack4-capability)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, `$1${REDACTED}`)
    .replace(/(["'](?:password|token|authorization|capability)["']\s*:\s*["'])[^"']*(["'])/gi, `$1${REDACTED}$2`);
}

function scalar(block, key) {
  const match = block.match(new RegExp(`^\\s*${key}:\\s*['"]?([^\\r\\n'"]+)['"]?\\s*$`, 'mi'));
  return match ? match[1].trim() : '';
}

function blockScalar(block, key) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*(?:\\|-|>)?\\s*$`, 'i').test(line));
  if (start < 0) return scalar(block, key);
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\s*/)[0].length <= baseIndent) break;
    values.push(line);
  }
  const nonEmpty = values.filter((line) => line.trim());
  if (!nonEmpty.length) return '';
  const indent = Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length));
  return values.map((line) => line.slice(Math.min(indent, line.length))).join('\n').trim();
}

function tapBlocks(stdout) {
  const lines = stdout.split(/\r?\n/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)not ok\s+\d+\s+-\s+(.+)$/);
    if (match) starts.push({ index, indent: match[1].length, name: match[2].trim() });
  }
  return starts.map((start, position) => {
    let end = lines.length;
    for (let next = start.index + 1; next < lines.length; next += 1) {
      const status = lines[next].match(/^(\s*)(?:ok|not ok)\s+\d+\s+-\s+/);
      if (status && status[1].length <= start.indent) { end = next; break; }
      if (/^\s*1\.\.\d+\s*$/.test(lines[next]) && lines[next].match(/^\s*/)[0].length <= start.indent) { end = next; break; }
    }
    return { ...start, position, block: lines.slice(start.index, end).join('\n') };
  });
}

export function parseNodeTestTapFailures(stdoutText) {
  const stdout = sanitizeDiagnosticText(stdoutText);
  const declared = [...stdout.matchAll(/^\s*#\s*fail\s+(\d+)\s*$/gmi)].at(-1);
  const parsed = tapBlocks(stdout).map(({ name, block }) => {
    const failureType = scalar(block, 'failureType');
    const errorName = scalar(block, 'name');
    const code = scalar(block, 'code');
    const error = blockScalar(block, 'error');
    const stack = blockScalar(block, 'stack');
    const assertion = ['expected', 'actual', 'operator']
      .map((key) => [key, scalar(block, key)])
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    return Object.freeze({
      name: compact(name, 500), failureType: compact(failureType || errorName || code || 'TAP_FAILURE'),
      code: compact(code), error: compact(error, 1200), assertion: compact(assertion, 700),
      stack: compact(stack.split(/\r?\n/).slice(0, 8).join(' | '), 1400), rawBlock: block,
    });
  });
  const detailed = parsed.filter((item) => item.failureType !== 'subtestsFailed'
    && (item.error || item.code || item.assertion || item.stack));
  const failures = detailed.length ? detailed : parsed;
  return Object.freeze({
    declaredFailureCount: declared ? Number(declared[1]) : null,
    identifiableFailureCount: failures.length,
    failures: Object.freeze(failures),
  });
}

export function diagnoseChildResult({ exitCode, mode = 'unknown', operation = 'unknown', stdout = '', stderr = '' }) {
  const sanitizedStdout = sanitizeDiagnosticText(stdout);
  const sanitizedStderr = sanitizeDiagnosticText(stderr);
  if (exitCode === 0) return Object.freeze({ passed: true, exitCode, mode, operation, sanitizedStdout, sanitizedStderr });
  const tap = parseNodeTestTapFailures(sanitizedStdout);
  return Object.freeze({
    passed: false, exitCode, mode, operation, sanitizedStdout, sanitizedStderr,
    stdoutPresent: Boolean(sanitizedStdout.trim()), stderrPresent: Boolean(sanitizedStderr.trim()), tap,
  });
}

function restrictWindowsFile(filePath) {
  if (process.platform !== 'win32') return;
  const script = [
    "$ErrorActionPreference='Stop';",
    '$p=$env:M1_G07_EVIDENCE_PATH;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;',
    '$acl=New-Object Security.AccessControl.FileSecurity;$acl.SetOwner($sid);',
    '$acl.SetAccessRuleProtection($true,$false);',
    "$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow');",
    '$acl.AddAccessRule($rule);[IO.File]::SetAccessControl($p,$acl);',
  ].join('');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: { ...process.env, M1_G07_EVIDENCE_PATH: filePath },
    stdio: 'pipe',
  });
}

export function writeRestrictedDiagnosticEvidence(diagnostic, {
  evidenceRoot, runId, childPid = 'unknown', restrictFile = restrictWindowsFile,
} = {}) {
  if (diagnostic.passed) return null;
  const root = resolve(evidenceRoot || join(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate', 'evidence'));
  const safeRunId = String(runId || 'unknown-run').replace(/[^a-z0-9-]/gi, '_');
  const directory = join(root, safeRunId);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, `${Date.now()}-${String(diagnostic.mode).replace(/[^a-z0-9-]/gi, '_')}-${childPid}.log`);
  const content = [
    'M1C-G07 SANITIZED CHILD FAILURE EVIDENCE',
    `exitCode=${diagnostic.exitCode} mode=${diagnostic.mode} operation=${diagnostic.operation}`,
    `declaredFailureCount=${diagnostic.tap.declaredFailureCount ?? 'unknown'} identifiableFailureCount=${diagnostic.tap.identifiableFailureCount}`,
    '--- PARSED FAILURES (SANITIZED JSON) ---',
    JSON.stringify(diagnostic.tap.failures.map(({ rawBlock, ...failure }) => failure), null, 2),
    '--- STDOUT (SANITIZED) ---', diagnostic.sanitizedStdout || '[EMPTY]',
    '--- STDERR (SANITIZED) ---', diagnostic.sanitizedStderr || '[EMPTY]', '',
  ].join('\n');
  writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
  try { restrictFile(filePath); }
  catch (error) { rmSync(filePath, { force: true }); throw error; }
  return filePath;
}

export function formatChildDiagnosticSummary(diagnostic, evidencePath = null) {
  if (diagnostic.passed) return '';
  const lines = [
    SUMMARY_BEGIN,
    `CHILD_EXIT=${diagnostic.exitCode} MODE=${diagnostic.mode} OPERATION=${diagnostic.operation}`,
    `TAP_FAILURE_TOTAL=${diagnostic.tap.declaredFailureCount ?? 'UNKNOWN'} IDENTIFIABLE_FAILURES=${diagnostic.tap.identifiableFailureCount}`,
    `STDOUT_PRESENT=${diagnostic.stdoutPresent} STDERR_PRESENT=${diagnostic.stderrPresent}`,
  ];
  diagnostic.tap.failures.forEach((failure, index) => {
    lines.push(`FAILURE[${index + 1}] NAME=${failure.name}`);
    lines.push(`  TYPE=${failure.failureType}${failure.code ? ` CODE=${failure.code}` : ''}`);
    if (failure.error) lines.push(`  ERROR=${failure.error}`);
    if (failure.assertion) lines.push(`  ASSERTION=${failure.assertion}`);
    if (failure.stack) lines.push(`  STACK=${failure.stack}`);
  });
  if (diagnostic.stderrPresent) lines.push(`STDERR_SUMMARY=${compact(diagnostic.sanitizedStderr, 1000)}`);
  lines.push(`FULL_DIAGNOSTIC_FILE=${evidencePath || 'UNAVAILABLE'}`, SUMMARY_END);
  return lines.join('\n');
}

export function createChildFailureError(input, options = {}) {
  const diagnostic = diagnoseChildResult(input);
  if (diagnostic.passed) return null;
  let evidencePath = null;
  let evidenceError = null;
  try { evidencePath = writeRestrictedDiagnosticEvidence(diagnostic, options); }
  catch (error) { evidenceError = sanitizeDiagnosticText(error?.message || error); }
  const summary = formatChildDiagnosticSummary(diagnostic, evidencePath);
  const error = new Error(`M1_G07_CHILD_FAILED:${input.exitCode}\n${summary}${evidenceError ? `\nEVIDENCE_WRITE_ERROR=${compact(evidenceError)}` : ''}`);
  error.code = 'M1_G07_CHILD_FAILED';
  error.m1G07Diagnostic = diagnostic;
  error.m1G07EvidencePath = evidencePath;
  return error;
}

export const M1_G07_DIAGNOSTIC_MARKERS = Object.freeze({ begin: SUMMARY_BEGIN, end: SUMMARY_END });
