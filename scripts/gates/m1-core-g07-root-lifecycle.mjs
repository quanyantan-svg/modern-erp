import {
  assertActiveRootLease, beginAck4RootOperation, finalizeAck4Run,
  issueChildLease, issuePortableChildLease,
} from './ack4/ack4-runtime.mjs';

export const M1_G07_MANIFEST = 'M1_CORE_G07_V1';

function operationContext(rootLease, operation, registeredChildren) {
  return Object.freeze({
    rootLease,
    operation,
    issueChild({ childPid, childStartedAt }) {
      const lease = issueChildLease(rootLease, { childPid, childStartedAt, operations: [operation] });
      registeredChildren.push({ childPid, childStartedAt, operation, exited: false });
      return lease;
    },
    issuePortableChild({ childPid, childStartedAt }) {
      const lease = issuePortableChildLease(rootLease, { childPid, childStartedAt, operation });
      registeredChildren.push({ childPid, childStartedAt, operation, exited: false });
      return lease;
    },
    markChildExited(childPid, childStartedAt) {
      const child = registeredChildren.find((item) => item.childPid === childPid && item.childStartedAt === childStartedAt);
      if (!child) throw new Error('M1_G07_UNREGISTERED_CHILD_EXIT');
      child.exited = true;
    },
  });
}

/**
 * Root-owned lifecycle. Dependencies are explicit so the complete state
 * machine can be proven without opening MySQL; the production CLI supplies
 * the process/database adapters only after ACK-4 has been consumed.
 */
export async function runM1CoreG07Lifecycle({
  consumeRoot, expected, quarantineDir,
  reset, bootstrap, runHttpFixtures, stopChildren, cleanup, verifyCleanup,
}) {
  let rootLease = null;
  let primaryError = null;
  let testsPassed = false;
  let cleanupProven = false;
  let childrenExited = false;
  let cleanupAttempts = 0;
  let inventory = [];
  const registeredChildren = [];

  try {
    // The first externally supplied action is capability consumption. No DB,
    // HTTP fixture or process callback is reachable before this resolves.
    rootLease = await consumeRoot();
    assertActiveRootLease(rootLease, expected);

    beginAck4RootOperation(rootLease, 'RESET_SCHEMA_PRE_RUN', expected);
    await reset(operationContext(rootLease, 'RESET_SCHEMA_PRE_RUN', registeredChildren));

    beginAck4RootOperation(rootLease, 'BOOTSTRAP_CURRENT_SCHEMA', expected);
    await bootstrap(operationContext(rootLease, 'BOOTSTRAP_CURRENT_SCHEMA', registeredChildren));

    beginAck4RootOperation(rootLease, 'RUN_M1_HTTP_FIXTURES', expected);
    const result = await runHttpFixtures(operationContext(rootLease, 'RUN_M1_HTTP_FIXTURES', registeredChildren));
    testsPassed = result?.passed === true;
    if (!testsPassed) throw new Error('M1_G07_SUITE_DID_NOT_PASS');
  } catch (error) {
    primaryError = error;
  } finally {
    if (rootLease) {
      try {
        const stopped = await stopChildren(Object.freeze([...registeredChildren]));
        childrenExited = stopped === true && registeredChildren.every((child) => child.exited || stopped === true);
      } catch (error) {
        primaryError ||= error;
        childrenExited = false;
      }
      if (!childrenExited) {
        inventory = ['CHILD_EXIT_UNVERIFIED'];
        cleanupProven = false;
      } else {
        try {
          cleanupAttempts += 1;
          beginAck4RootOperation(rootLease, 'CLEANUP_SCHEMA_POST_RUN', expected);
          await cleanup(operationContext(rootLease, 'CLEANUP_SCHEMA_POST_RUN', registeredChildren));
          const verification = await verifyCleanup();
          inventory = Array.isArray(verification?.inventory) ? verification.inventory : [];
          cleanupProven = verification?.clean === true && inventory.length === 0;
        } catch (error) {
          primaryError ||= error;
          cleanupProven = false;
        }
      }
    }
  }

  if (!rootLease) throw primaryError || new Error('ACK4_ROOT_LEASE_REQUIRED');
  const state = finalizeAck4Run(rootLease, {
    testsPassed, cleanupProven, childrenExited, quarantineDir, inventory,
  });
  const report = Object.freeze({
    runId: rootLease.runId, state, testsPassed, cleanupProven, childrenExited,
    cleanupAttempts, childCount: registeredChildren.length,
  });
  if (primaryError) {
    primaryError.m1G07Lifecycle = report;
    throw primaryError;
  }
  return report;
}
