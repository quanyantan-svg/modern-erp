import { spawn } from 'node:child_process';

export const WAVE10_RUNNER_STATES = Object.freeze([
  'PREFLIGHT', 'IDENTITY_VERIFIED', 'SUITE_RUNNING', 'SUITE_PASSED', 'SUITE_FAILED',
  'CHILD_TIMEOUT', 'CHILD_TERMINATION_PENDING', 'CHILD_TERMINATION_CONFIRMED',
  'CHILD_TERMINATION_FAILED', 'CLEANUP_RUNNING', 'CLEANUP_CONFIRMED', 'CLEANUP_FAILED',
  'FINAL_ZERO_OBJECTS_CONFIRMED',
]);

const TRANSITIONS = Object.freeze({
  PREFLIGHT: ['IDENTITY_VERIFIED'],
  IDENTITY_VERIFIED: ['CLEANUP_RUNNING'],
  SUITE_RUNNING: ['SUITE_PASSED', 'SUITE_FAILED', 'CHILD_TIMEOUT'],
  SUITE_PASSED: ['CLEANUP_RUNNING', 'SUITE_RUNNING'],
  SUITE_FAILED: ['CLEANUP_RUNNING'],
  CHILD_TIMEOUT: ['CHILD_TERMINATION_PENDING'],
  CHILD_TERMINATION_PENDING: ['CHILD_TERMINATION_CONFIRMED', 'CHILD_TERMINATION_FAILED'],
  CHILD_TERMINATION_CONFIRMED: ['CLEANUP_RUNNING'],
  CLEANUP_RUNNING: ['CLEANUP_CONFIRMED', 'CLEANUP_FAILED'],
  CLEANUP_CONFIRMED: ['FINAL_ZERO_OBJECTS_CONFIRMED', 'SUITE_RUNNING'],
});

export function transitionWave10RunnerState(current, next) {
  if (!WAVE10_RUNNER_STATES.includes(current) || !WAVE10_RUNNER_STATES.includes(next)) {
    throw new Error(`Unknown Wave 10 runner state transition: ${current} -> ${next}`);
  }
  if (!(TRANSITIONS[current] || []).includes(next)) throw new Error(`Invalid Wave 10 runner state transition: ${current} -> ${next}`);
  return next;
}

export function waitForChildExit(child, timeoutMs, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve({ exited: true, code: child.exitCode, signal: child.signalCode ?? null });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimer(timer); resolve(value); };
    const timer = setTimer(() => finish({ exited: false, code: null, signal: null }), timeoutMs);
    child.once('exit', (code, signal) => finish({ exited: true, code, signal }));
    // A spawn failure never produces an exit event. Settling here releases the
    // deadline timer instead of leaving it pending for the whole timeout.
    child.once('error', (error) => finish({ exited: false, code: null, signal: null, error }));
  });
}

function waitForCommand(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, timeoutMs);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

export async function terminateWave10ProcessTree(child, {
  gracefulMs = 5_000,
  forcedMs = 5_000,
  platform = process.platform,
  spawnProcess = spawn,
  waitForExit = waitForChildExit,
} = {}) {
  try { child.kill('SIGTERM'); } catch {}
  const graceful = await waitForExit(child, gracefulMs);
  if (graceful.exited) return Object.freeze({ confirmed: true, forced: false, ...graceful });

  try {
    if (platform === 'win32') {
      const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await waitForCommand(killer, forcedMs);
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
  const forced = await waitForExit(child, forcedMs);
  return Object.freeze({ confirmed: forced.exited, forced: true, ...forced });
}

export async function awaitWave10SuiteChild(child, {
  timeoutMs,
  terminateTree = terminateWave10ProcessTree,
  waitForExit = waitForChildExit,
} = {}) {
  const outcome = await waitForExit(child, timeoutMs);
  if (outcome.error) {
    // The child never started. There is nothing to terminate and nothing to
    // clean up against, so the failure is reported as a spawn failure.
    return Object.freeze({ timedOut: false, spawnError: true, terminationConfirmed: true, code: null, signal: null, error: outcome.error });
  }
  if (outcome.exited) return Object.freeze({ timedOut: false, terminationConfirmed: true, ...outcome });
  const termination = await terminateTree(child);
  return Object.freeze({
    timedOut: true,
    terminationConfirmed: termination.confirmed,
    code: termination.code,
    signal: termination.signal,
    forced: termination.forced,
  });
}
