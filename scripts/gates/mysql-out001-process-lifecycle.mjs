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

export function terminateProcessTree(child) {
  if (hasExited(child)) return Promise.resolve(true);
  if (process.platform !== 'win32') {
    try { child.kill('SIGTERM'); } catch {}
    return waitForExitWithin(child, TERMINATION_CONFIRM_TIMEOUT_MS);
  }
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, async () => {
      // Some restricted Windows runners deny taskkill even for a process that
      // Node itself created. Retain a direct-parent kill as a bounded fallback;
      // confirmation below remains mandatory and no cleanup may run without it.
      if (!hasExited(child)) {
        try { child.kill('SIGKILL'); } catch {}
      }
      resolve(await waitForExitWithin(child, TERMINATION_CONFIRM_TIMEOUT_MS));
    });
  });
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
