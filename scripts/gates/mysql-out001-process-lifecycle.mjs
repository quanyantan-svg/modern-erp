import { execFile } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { hasExited, waitForExit } from './m1-core-g07-child-lifecycle.mjs';

export const OUT_001_CHILD_TIMEOUT_MS = Object.freeze({
  RESET_SCHEMA_PRE_RUN: 2 * 60_000,
  BOOTSTRAP_CURRENT_SCHEMA: 10 * 60_000,
  RUN_OUT001_HTTP_FIXTURES: 30 * 60_000,
  CLEANUP_SCHEMA_POST_RUN: 5 * 60_000,
  POSTFLIGHT: 2 * 60_000,
});

const TERMINATION_CONFIRM_TIMEOUT_MS = 15_000;
const WINDOWS_PROCESS_QUERY = [
  "$ErrorActionPreference='Stop'",
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
].join(';');

function timeout(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
}

async function waitForExitWithin(child, timeoutMs) {
  if (hasExited(child)) return true;
  const result = await Promise.race([
    waitForExit(child).then(() => ({ exited: true })).catch(() => ({ exited: false })),
    timeout(timeoutMs),
  ]);
  return result?.exited === true || hasExited(child);
}

function execFileResult(file, args) {
  return new Promise((resolve) => {
    let exitCode = null;
    const process = execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, exitCode, stdout, stderr });
    });
    process.once('exit', (code) => { exitCode = code; });
  });
}

async function readWindowsProcessTable() {
  const result = await execFileResult('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PROCESS_QUERY,
  ]);
  if (result.error || result.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim() || '[]');
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      pid: Number(row.ProcessId),
      parentPid: Number(row.ParentProcessId),
    })).filter((row) => Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parentPid));
  } catch {
    return null;
  }
}

function collectWindowsProcessTree(processTable, rootPid) {
  if (!processTable.some((row) => row.pid === rootPid)) return null;
  const processIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of processTable) {
      if (processIds.has(row.parentPid) && !processIds.has(row.pid)) {
        processIds.add(row.pid);
        changed = true;
      }
    }
  }
  return processIds;
}

async function waitForWindowsProcessTreeExit(processIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const processTable = await readWindowsProcessTable();
    if (!processTable) return false;
    const active = new Set(processTable.map((row) => row.pid));
    if ([...processIds].every((pid) => !active.has(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function terminateProcessTree(child) {
  if (process.platform !== 'win32') {
    if (hasExited(child)) return true;
    try { child.kill('SIGTERM'); } catch {}
    return waitForExitWithin(child, TERMINATION_CONFIRM_TIMEOUT_MS);
  }
  // Once the Windows parent has already disappeared there is no trustworthy
  // way to reconstruct descendants that may have been re-parented. Parent exit
  // alone is therefore never accepted as process-tree termination evidence.
  if (hasExited(child)) return false;
  const processTable = await readWindowsProcessTable();
  const knownProcessTree = processTable && collectWindowsProcessTree(processTable, child.pid);
  if (!knownProcessTree) return false;

  const taskkill = await execFileResult('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  if (taskkill.error || taskkill.exitCode !== 0) return false;
  if (!await waitForExitWithin(child, TERMINATION_CONFIRM_TIMEOUT_MS)) return false;
  return waitForWindowsProcessTreeExit(knownProcessTree, TERMINATION_CONFIRM_TIMEOUT_MS);
}

export async function collectOut001Child(entry, {
  timeoutMs = OUT_001_CHILD_TIMEOUT_MS[entry.operation],
  terminate = terminateProcessTree,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`OUT_001_MYSQL_TIMEOUT_INVALID:${entry.operation}`);
  }
  const outcome = await Promise.race([
    waitForExit(entry.child).then((code) => ({ code })),
    timeout(timeoutMs),
  ]);
  if (outcome?.timedOut) {
    const terminationConfirmed = await terminate(entry.child);
    const error = new Error(`OUT_001_MYSQL_CHILD_TIMEOUT:${entry.mode}:${entry.operation}`);
    error.code = terminationConfirmed ? 'OUT_001_MYSQL_CHILD_TIMEOUT' : 'OUT_001_MYSQL_CHILD_EXIT_UNVERIFIED';
    error.terminationConfirmed = terminationConfirmed;
    throw error;
  }
  await Promise.all([entry.child.stdout, entry.child.stderr]
    .filter(Boolean).map((stream) => finished(stream, { cleanup: true })));
  return outcome.code;
}

export async function ensureOut001ChildExited(entry, { terminate = terminateProcessTree } = {}) {
  if (!hasExited(entry.child)) return terminate(entry.child);
  return true;
}

export function parseOut001PostflightOutput(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
  if (!line) return null;
  try {
    const result = JSON.parse(line);
    const kinds = ['tables', 'views', 'triggers', 'routines', 'events'];
    if (result?.operation !== 'POSTFLIGHT' || !result?.inventory
        || kinds.some((kind) => !Number.isSafeInteger(result.inventory[kind]) || result.inventory[kind] < 0)) return null;
    return result;
  } catch {
    return null;
  }
}

export function parseOut001OperationOutput(stdout, operation) {
  const line = String(stdout || '').trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
  let result;
  try { result = line ? JSON.parse(line) : null; } catch {}
  if (result?.operation !== operation) {
    throw new Error(`OUT_001_MYSQL_OPERATION_RESULT_UNVERIFIED:${operation}`);
  }
  if (operation === 'RESET_SCHEMA_PRE_RUN') {
    const inventory = result.inventory;
    const counts = ['tables', 'views', 'triggers', 'routines', 'events'].map((kind) => inventory?.[kind]);
    if (result.dropped !== 0 || counts.some((count) => !Number.isSafeInteger(count) || count !== 0)) {
      throw new Error('OUT_001_MYSQL_RESET_RESULT_UNVERIFIED');
    }
  } else if (operation === 'BOOTSTRAP_CURRENT_SCHEMA') {
    if (result.bootstrapped !== true) throw new Error('OUT_001_MYSQL_BOOTSTRAP_RESULT_UNVERIFIED');
  } else if (operation === 'CLEANUP_SCHEMA_POST_RUN') {
    if (!Number.isSafeInteger(result.dropped) || result.dropped < 0) {
      throw new Error('OUT_001_MYSQL_CLEANUP_RESULT_UNVERIFIED');
    }
  }
  return result;
}
