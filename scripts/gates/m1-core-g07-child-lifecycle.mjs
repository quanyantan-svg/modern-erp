// Child-process lifecycle helpers shared by the M1C-G07 root orchestrator and
// its pure multi-process tests. Pure Node; no MySQL connection is opened here.

export function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Resolves to the child's exit code (or null when it was killed by a signal).
 * Handles the already-exited case so that a child which finished before the
 * waiters attached does not leave the caller hanging forever.
 */
export function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const onExit = (code) => resolve(code ?? null);
    const onError = (error) => reject(error);
    child.once('exit', onExit);
    child.once('error', onError);
    if (hasExited(child)) {
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      resolve(child.exitCode ?? null);
    }
  });
}
