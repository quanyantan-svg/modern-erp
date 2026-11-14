import {
  assertActiveRootLease, beginAck4RootOperation, finalizeAck4Run,
  issueChildLease, issuePortableChildLease,
} from './ack4/ack4-runtime.mjs';

// R-02 期间控制真实 MySQL campaign 的 root 生命周期。
//
// 形态与 `mysql-platform-root-lifecycle.mjs` 相同但**独立实现**：其它域 campaign 的
// 生命周期属于那些域已签发的域级 Acceptance 证据（已冻结），本 campaign 的夹具
// 操作名是 `RUN_R02_PERIOD_RACES`，与其它 Manifest 互相独立、互不复用，运行期证据
// 可以唯一地归属本 campaign。
//
// 依赖是显式的：除 ACK-4 消费之外，任何数据库、HTTP 或进程回调都不可达。

export const R02_PERIOD_CONTROL_MYSQL_MANIFEST = 'R02_PERIOD_CONTROL_MYSQL_V1';

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
      if (!child) throw new Error('R02_PERIOD_MYSQL_UNREGISTERED_CHILD_EXIT');
      child.exited = true;
    },
  });
}

export async function runR02PeriodMySqlLifecycle({
  consumeRoot, expected, quarantineDir,
  reset, bootstrap, runRaces, stopChildren, cleanup, verifyCleanup,
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

    beginAck4RootOperation(rootLease, 'RUN_R02_PERIOD_RACES', expected);
    const result = await runRaces(operationContext(rootLease, 'RUN_R02_PERIOD_RACES', registeredChildren));
    testsPassed = result?.passed === true;
    if (!testsPassed) throw new Error('R02_PERIOD_MYSQL_SUITE_DID_NOT_PASS');
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
    primaryError.r02PeriodMySqlLifecycle = report;
    throw primaryError;
  }
  return report;
}
