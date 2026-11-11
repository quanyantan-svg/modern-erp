import {
  assertActiveRootLease, beginAck4RootOperation, finalizeAck4Run,
  issueChildLease, issuePortableChildLease,
} from './ack4/ack4-runtime.mjs';

// Accounting & Analytics 域真实 MySQL campaign 的 root 生命周期。
//
// 这段状态机与 `m1-core-g07-root-lifecycle.mjs` 形态相同但**独立实现**：M1-Core G07
// 的生命周期属于采购与委外域已签发的域级 Acceptance 证据（已冻结），其操作名固定为
// `RUN_M1_HTTP_FIXTURES`。本域 campaign 的夹具操作名是 `RUN_AA_HTTP_FIXTURES`，两者
// 的 ACK-4 Manifest 互相独立、互不复用。为避免改动已冻结的共享模块，这里保留一份
// 独立实现，而不是给 M1-Core 的生命周期加参数。
//
// 依赖是显式的：除 ACK-4 消费之外，任何数据库、HTTP 或进程回调都不可达。

export const AA_MYSQL_MANIFEST = 'ACCOUNTING_ANALYTICS_MYSQL_V1';

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
      if (!child) throw new Error('AA_MYSQL_UNREGISTERED_CHILD_EXIT');
      child.exited = true;
    },
  });
}

export async function runAccountingAnalyticsMySqlLifecycle({
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

    beginAck4RootOperation(rootLease, 'RUN_AA_HTTP_FIXTURES', expected);
    const result = await runHttpFixtures(operationContext(rootLease, 'RUN_AA_HTTP_FIXTURES', registeredChildren));
    testsPassed = result?.passed === true;
    if (!testsPassed) throw new Error('AA_MYSQL_SUITE_DID_NOT_PASS');
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
    primaryError.aaMySqlLifecycle = report;
    throw primaryError;
  }
  return report;
}
